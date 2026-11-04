# Laufzeit-Verträge zwischen den Bausteinen (Phase 0 und 1)

Diese Datei legt fest, wie Core, Worker, Web-App, iPad-App und `sg`-CLI zusammenspielen. So können die Teile parallel gebaut werden (`AGENTS.md`, Regel 4).
Änderungen nur durch den Lead. Datenformate selbst stehen in `packages/schemas`.

§1–5 gelten seit Phase 0. §6–15 sind die Verträge für Phase 1.

## 1. Umgebungsvariablen

| Variable | Standard | Wer liest sie |
|---|---|---|
| `SG_DATA_DIR` | `~/StudienGehirn` | Core, Worker, CLI |
| `DATABASE_URL` | `postgres://sg:sg@127.0.0.1:5432/sg` | Core, Worker, CLI |
| `SG_CORE_PORT` | `4710` | Core, CLI |
| `SG_CORE_HOST` | `0.0.0.0` (iPad muss den Core erreichen, 02 §3) | Core |
| `SG_WEB_DIR` | `<repo>/apps/web/out` | Core (liefert den Static Export aus) |
| `SG_DEV_WEB_ORIGIN` | leer. In der Entwicklung `http://localhost:3000` | Core (CORS nur für diesen Origin) |
| `NEXT_PUBLIC_SG_API_BASE` | `/api/v1`. In der Entwicklung `http://localhost:4710/api/v1` | Web-App |
| `SG_LOG_LEVEL` | `info` | Core, Worker |
| `TZ` | Zeitzone des Systems | Core (Ortszeit für ICS-Termine ohne Zeitzone, Backup-Uhrzeit). Tests laufen mit `TZ=Europe/Zurich` |

Geheimnisse wie API-Schlüssel stehen in `$SG_DATA_DIR/config/.env` mit Rechten 600 (02 §3). Die Prozesse lesen diese Datei beim Start.

## 2. Befehle, die jeder Baustein anbietet

| Baustein | Befehl | Bedeutung |
|---|---|---|
| Core | `pnpm --filter @sg/core start` | Startet die API auf `SG_CORE_PORT`. Läuft im Vordergrund und beendet sich bei SIGTERM/SIGINT sauber |
| Core | `pnpm --filter @sg/core migrate` | Führt die Drizzle-Migrationen gegen `DATABASE_URL` aus. Idempotent |
| Core | `pnpm --filter @sg/core dev` | Startet mit Watch-Modus |
| Worker | `uv run --project services/worker sg-worker` | Job-Schleife im Vordergrund. Beendet sich bei SIGTERM/SIGINT nach dem laufenden Job |
| Web | `pnpm --filter @sg/web build` | Static Export nach `apps/web/out` |
| Web | `pnpm --filter @sg/web dev` | Next-Dev-Server auf Port 3000 |
| CLI | `pnpm sg start\|stop\|migrate\|doctor` | Siehe T0-03 |

**Gesundheitsprüfung:** `GET /api/v1/health` liefert den Typ `Health` aus `packages/schemas`. Die CLI wartet beim Start darauf.

## 3. Datenbank

- **Eigentümer des Schemas ist der Core** (Drizzle-Migrationen unter `services/core/drizzle/`). Der Worker legt keine Tabellen an.
- Die erste Migration aktiviert `CREATE EXTENSION IF NOT EXISTS vector` und `pgcrypto`.
- Jede Tabelle hat die Pflichtfelder aus 03 §1. IDs sind UUIDv7 und werden in der Anwendung erzeugt, nicht in der DB.

### Tabelle `job` (verbindlich für Core und Worker)

```sql
CREATE TABLE job (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  type          text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  state         text NOT NULL DEFAULT 'wartet'
                CHECK (state IN ('wartet','laeuft','fertig','fehler','abgebrochen')),
  priority      integer NOT NULL DEFAULT 0,          -- höher = früher
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 3,
  depends_on    uuid[] NOT NULL DEFAULT '{}',
  session_id    uuid,
  locked_by     text,
  locked_at     timestamptz,
  error         text,
  result        jsonb,
  run_after     timestamptz
);
CREATE INDEX job_pick_idx ON job (priority DESC, created_at) WHERE state = 'wartet' AND deleted_at IS NULL;
```

**Job anlegen (Core):** Eintrag in derselben Transaktion wie die fachliche Änderung. Nach dem Commit folgt `SELECT pg_notify('sg_jobs', '<job_id>')`.

**Job abholen (Worker):**
- Der Worker hört auf `LISTEN sg_jobs`. Zusätzlich fragt er alle 30 s nach, falls eine Benachrichtigung verloren geht.
- Geholt wird ein Job mit `state='wartet'`, ohne `deleted_at`, mit `run_after` leer oder fällig und mit `depends_on`, deren Jobs alle `fertig` sind.
- Reihenfolge: `ORDER BY priority DESC, created_at`, dazu `FOR UPDATE SKIP LOCKED LIMIT 1`.
- Beim Abholen setzt er `state='laeuft'`, `locked_by=<hostname:pid>` und `locked_at=now()` und erhöht `attempts` um 1.

**Ergebnis:**
- **Erfolg:** `state='fertig'`, `result` als Zusammenfassung, Lock-Felder leeren.
- **Fehler mit `attempts < max_attempts`:** `state='wartet'`, `run_after = now() + 30s * 2^(attempts-1)`, `error` setzen.
- **Fehler sonst:** `state='fehler'`.
- **Hängende Jobs:** `laeuft` mit `locked_at` älter als 3 min (dreifaches Heartbeat-Intervall) gilt als abgestürzt; der Worker prüft das beim Start und danach jede Minute. Hat der Job `attempts >= max_attempts`, wird er `fehler`, sonst wieder `wartet`.

Ein laufender Job erneuert `locked_at` alle 60 s (Heartbeat). Ergebnis und Fehler schreibt nur der Worker, dessen `locked_by` noch eingetragen ist.

**Unbekannter Job-Typ:** Der Worker setzt `state='fehler'` mit `error='unbekannter Job-Typ'` und läuft weiter.

**Ungültiges Payload:** Verletzt das Payload das Schema, setzt der Worker den Job sofort auf `fehler`, ohne Retry. Ein neuer Versuch würde nichts ändern.

**Unbekannte Abhängigkeit:** Verweist `depends_on` auf eine Job-ID, die es nicht gibt oder die gelöscht ist (`deleted_at`), setzt der Worker den abhängigen Job auf `abgebrochen`. Als `error` steht dann `Abhängigkeit <job_id> unbekannt`.

**Abhängigkeit fehlgeschlagen:** Ist ein Job aus `depends_on` im Zustand `fehler` oder `abgebrochen`, setzt der Worker den abhängigen Job auf `abgebrochen`. Als `error` steht dann `Abhängigkeit <job_id> fehlgeschlagen`. Sonst würde der Job ewig warten.

### Job `audio.finalize` (ab Phase 1)

- **Payload** `AudioFinalizePayload` `{ recording_id }`, **Ergebnis** `AudioFinalizeResult`. `job.session_id` ist die Session der Aufnahme.
- **Anlegen (Core):**
  - Beim Stopp der Session je Aufnahme ein Job. Ist die Aufnahme schon abgeschlossen (`POST /recordings/{id}/complete`), sofort; sonst mit `run_after = Stopp + 10 min`, weil der Browser noch Chunks aus IndexedDB nachliefern kann.
  - Kommt `complete`, während dieser Job noch `wartet`, setzt der Core `run_after = now()`. Es entsteht kein zweiter Job.
  - Kommt nach einem fertigen `audio.finalize` noch ein Chunk an, legt der Core einen neuen Job an. Das gilt nicht, wenn für die Aufnahme schon einer `wartet`. Der Job ist idempotent und erzeugt `full.m4a` neu.
- **Ausführung (Worker):** Chunks nach `seq` lesen. Bei `chunks_independent = false` als ein Bytestrom aneinanderhängen, sonst jeden Chunk einzeln decodieren. Dann mit `ffmpeg` nach `full.m4a` (AAC, 48 kHz, mono) umwandeln. Lücken (fehlende `seq` oder Sprünge in `start_ms`) werden als Stille mit korrekter Länge eingefügt. Zum Schluss `recording.duration_ms` und `recording.state` (`vollstaendig` bzw. `mit_luecken`) setzen.
- **Session-Fortschritt (Worker):** Nach jedem Job mit `session_id` setzt der Worker `session.processing[<job.type>] = <job.state>`. Hat die Session danach keinen Job mehr in `wartet` oder `laeuft` und ist sie `beendet`, setzt er `state = 'verarbeitet'`. Danach folgt `pg_notify('sg_session', '<session_id>')`. Der Core hört darauf und sendet das Ereignis `session.updated` (§11.6).

### Spalten mit Zahlen

`numeric`-Spalten wie `module.ects` werden in Drizzle mit `{ mode: 'number' }` gelesen. Die API liefert JSON-Zahlen, keine Strings.

## 4. Dateiablage (08 §7)

Pfade relativ zu `SG_DATA_DIR`:

| Inhalt | Pfad |
|---|---|
| Foliensatz | `media/decks/<deck_id>/original.pdf`, `slides/<index>.png` (2×), `thumbs/<index>.webp` |
| Übungsblatt | `media/sheets/<sheet_id>/original.pdf`, `pages/<index>.png`, `thumbs/<index>.webp` |
| Audio-Chunk (Phase 1) | `media/recordings/<recording_id>/chunks/<seq>.webm` bzw. `.mp4`. Die Endung kommt aus dem Basistyp von `recording.mime`, `seq` ohne führende Nullen |
| Audio gesamt (Phase 1) | `media/recordings/<recording_id>/full.m4a`, geschrieben von `audio.finalize` |
| Tafel-Foto (Phase 1) | `media/photos/<photo_id>.heic` bzw. `.jpg` |
| PencilKit-Sicherung (Phase 1) | `media/pages/<page_id>.pkdrawing` |
| Logs | `logs/core.log`, `logs/worker.log` |

In der DB steht `file_path` relativ zu `SG_DATA_DIR`. So lässt sich der Datenordner verschieben.

**Schreiben:** Hochgeladene Dateien schreibt der Core zuerst nach `<ziel>.part` und benennt sie nach erfolgreicher sha256-Prüfung atomar um. Halbe Dateien bleiben so nie unter dem Zielnamen liegen.

## 5. HTTP-Konventionen des Core

- Basis `/api/v1`, Fehlerformat `ApiError`, Listen mit `?cursor&limit` (08 §1).
- **Lokal oder Netz** entscheidet allein die Socket-Adresse (`request.socket.remoteAddress` ist `127.0.0.1` oder `::1`). `trustProxy` bleibt aus. `Host` und `X-Forwarded-For` werden dafür **nie** ausgewertet.
- Lokale Anfragen brauchen kein Token. Anfragen aus dem Netz brauchen `Authorization: Bearer <device_token>`. In Phase 0 werden sie mit `401 device_token_required` abgelehnt, weil es noch keine Kopplung gibt (T1-10).
- **Ab Phase 1 (T1-10):** Der Core vergleicht `sha256(token)` mit `device.token_hash` gekoppelter, nicht gelöschter Geräte. Fehlt das Token: `401 device_token_required`. Ist es unbekannt oder widerrufen: `401 device_token_invalid`. Bei Erfolg setzt der Core `device.last_seen_at`, höchstens einmal pro Minute. Ohne Token aus dem Netz erreichbar sind nur `POST /devices/pair/start` und `POST /devices/pair/confirm`. Für alle anderen Routen gelten lokale Anfragen und Anfragen mit gültigem Token gleich.
- **Schutz gegen DNS-Rebinding:** Gilt nur für Anfragen über Loopback, also lokale Anfragen. Ist ihr `Host` nicht `localhost`, `127.0.0.1` oder `[::1]` (jeweils mit `SG_CORE_PORT`), antwortet der Core mit `421 host_not_allowed`. Anfragen aus dem Netz, etwa vom iPad über die IP oder `<rechnername>.local`, prüft er stattdessen über das Geräte-Token.
- **Schutz gegen CSRF:** Zustandsändernde Anfragen (`POST`, `PUT`, `PATCH`, `DELETE`) mit `Origin`-Header werden mit `403 origin_not_allowed` abgelehnt. Ausgenommen sind die eigene Herkunft (`http://<erlaubter Host>:<SG_CORE_PORT>`) und `SG_DEV_WEB_ORIGIN`. Ohne `Origin`-Header (z. B. `curl`, iPad-App) gilt nur die Token-Regel.
- Statische Web-App unter `/`. Unbekannte Pfade außerhalb von `/api` liefern `index.html` bzw. die passende `.html`-Datei aus dem Export.
- Die Web-App nutzt Routen mit Query-Parametern statt dynamischer Segmente (`/modul?id=<uuid>`), weil der Static Export die IDs beim Build nicht kennt.

---

# Phase 1

## 6. Grundsätze

- **Datenformate** stehen in `packages/schemas/src`: `calendar`, `session`, `ink`, `sync`, `system`, `settings` sowie Ergänzungen in `common` und `jobs`. Diese Datei regelt alles, was nicht im Schema steht: Endpunkte, Statuscodes, Abläufe, Reihenfolge und Grenzen.
- **Ein Schreibweg pro Datenart.**
  - Striche, Seiten, Seitenelemente, Folienwechsel, Marker, Fotos und die Session-Steuerung vom iPad laufen als **Sync-Operation** über den WebSocket (§11). So funktioniert alles auch offline.
  - Die Web-App sendet Folienwechsel und Marker **ebenfalls als Operation** über den WebSocket. Es gibt keinen REST-Weg dafür und damit nur eine Implementierung im Core.
  - Start, Pause, Fortsetzen und Stopp kommen aus der Web-App per REST (§9), weil sie eine sofortige Antwort braucht. Der Core legt dafür selbst eine Operation in den Strom `session:<id>` (`origin = server`), damit alle Clients sie sehen.
- **Zeit:** REST liefert ISO 8601 UTC. Im Sync-Protokoll sind alle absoluten Zeiten Epochen-ms (`EpochMs`). Sitzungszeiten heißen `t_ms` bzw. `*_ms` (`SessionMs`). Eingebettete REST-Objekte, etwa `Session` im Ereignis `session.updated`, behalten ihr REST-Format.
- **IDs:** Clients erzeugen UUIDv7 für alles, was sie offline anlegen (Seiten, Striche, Marker, Fotos, spontane Sessions, Aufnahmen). Alle Create-Bodies haben ein optionales `id`. Ist die `id` schon vergeben, antwortet der Core mit `409 <objekt>_exists`. Wiederholte Anfragen sichert der `Idempotency-Key` ab (08 §1).
- **Verweise über Stromgrenzen** (`slide_id`, `background_slide_id`, `attached_slide_id`, `page.session_id`, `photo_id` in Bildelementen, `marker_id` in Stempeln): Der Core speichert sie **ohne Fremdschlüssel** und löst sie beim Lesen auf (F-SYN-03: Folie kommt später, Session wurde offline angelegt). Fremdschlüssel gibt es nur innerhalb eines Stroms, z. B. `stroke.page_id` und `marker.session_id`.
- **Löschen** ist weich (03 §1). Abhängige Objekte bekommen **denselben** `deleted_at`-Zeitstempel. Darüber stellt der Papierkorb genau den Löschvorgang wieder her (§13).

### 6.1 Neue Tabellen und Ergänzungen zu 03

Eigentümer der Tabellen bleibt der Core. Spalten nach 03 §3, §5, §6 und §13, dazu:

| Tabelle | Ergänzung | Grund |
|---|---|---|
| `module` | `settings jsonb NOT NULL DEFAULT '{}'` (`ModuleSettings`) | W-06 Option A, übernommen in 03 §3 |
| `calendar_source` | `name text`, `last_error text NULL` | Anzeige mehrerer Quellen, Fehler beim URL-Abgleich |
| `calendar_event` | `description text NULL`, `all_day bool`, `assigned_by text` (`auto`/`manuell`) | Zuordnung über die Beschreibung (F-KAL-02), ganztägige Termine (Testfall ics/08), manuelle Zuordnung bleibt beim Abgleich erhalten |
| `calendar_event` | `UNIQUE (source_id, external_uid, recurrence_id)` mit `NULLS NOT DISTINCT` | Abgleichschlüssel (F-KAL-01) |
| `session` | `UNIQUE (calendar_event_id) WHERE deleted_at IS NULL` | Eine Session pro Termin |
| `recording` | `chunks_independent bool`, `completed_at timestamptz NULL` | Spike S4, Abschluss durch den Client |
| `audio_chunk` | `size_bytes int8` | Antwort `AudioChunk` |
| `photo` | `mime text`, `sha256 text`, `size_bytes int8`, `file_path` erst nach Upload gesetzt | Upload unabhängig von `photo.add` |
| `device` | `kind`: `ipad` \| `iphone` | 03 §13 lässt die Werte offen |
| `backup_run` | `trigger text`, `stand text NULL` | Anzeige, Name für `sg restore <stand>` |
| `pairing` (neu) | `id`, `code_hash`, `public_nonce NULL`, `device_name NULL`, `expires_at`, `attempts int`, `used_at NULL` | Kopplung (§12). Der Code wird nur gehasht gespeichert |
| `sync_op` (neu) | `stream text`, `seq int8`, `op_id uuid UNIQUE`, `kind`, `at int8`, `clock_uncertain`, `data jsonb`, `origin`, `device_id NULL`, `received_at`; `UNIQUE (stream, seq)` | Nachlieferung ab `from_seq` und Idempotenz (§11). Wird nicht gelöscht |
| `setting` | Schlüssel `general`, `lecture`, `pen`, `data`, Wert je Bereich (§14) | F-EIN-01 |

Abgeleitete Felder der API, etwa `event_count`, `session_id` am Termin, `planned_starts_at`, `chunk_count`, `page_count`, `has_pkdrawing` und `connected`, sind keine Spalten.

## 7. REST-Endpunkte Phase 1

Basis `/api/v1`, Konventionen aus §5 und 08 §1. Fehlerkörper immer `ApiError`. Für alle Routen gelten außerdem `400 validation_failed`, `401 device_token_required|device_token_invalid` (aus dem Netz), `403 origin_not_allowed` und `421 host_not_allowed`.
Listen mit `?cursor&limit` (Standard 50, höchstens 200).

### 7.1 Kalender (T1-01)

| Methode und Pfad | Body | Antwort | Fehler |
|---|---|---|---|
| `GET /calendar/sources` | – | 200 `CalendarSourceList` | |
| `POST /calendar/sources` | JSON `CalendarSourceCreate` (URL) **oder** multipart `file` (.ics, ≤ 5 MB), `name?` | 201 `IcsImportResult` | 409 `calendar_source_exists` (gleiche URL, `details.id`), 413 `file_too_large`, 422 `ics_invalid`, 502 `ics_fetch_failed` |
| `POST /calendar/sources/{id}/sync` | URL-Quelle: leer. Datei-Quelle: multipart `file` (neue Fassung) | 200 `IcsImportResult` | 404 `calendar_source_not_found`, 422 `ics_invalid`, 502 `ics_fetch_failed` (setzt `last_error`) |
| `DELETE /calendar/sources/{id}` | – | 204 | 404 |
| `GET /calendar/events?from&to&module_id&unassigned&include_cancelled` | – | 200 `CalendarEventList`, nach `starts_at` aufsteigend | 400 |
| `GET /calendar/events/{id}` | – | 200 `CalendarEvent` | 404 `calendar_event_not_found` |
| `PATCH /calendar/events/{id}` | `CalendarEventUpdate` | 200 `CalendarEventList` (alle geänderten Termine, ohne Cursor) | 404 `calendar_event_not_found`, 404 `module_not_found` |

`from`/`to` sind ISO-Zeitpunkte. Ohne `include_cancelled=true` fehlen abgesagte Termine. `unassigned=true` liefert Termine ohne Modul.

### 7.2 Sessions (T1-02)

| Methode und Pfad | Body | Antwort | Fehler |
|---|---|---|---|
| `GET /sessions?module_id&state&from&to` | – | 200 `SessionList` | |
| `POST /sessions` | `SessionCreate` | 201 `Session` (Zustand `bereit`) | 404 `module_not_found`, 409 `session_exists` |
| `GET /sessions/{id}` | – | 200 `Session` | 404 `session_not_found` |
| `PATCH /sessions/{id}` | `SessionUpdate` | 200 `Session` | 404 |
| `DELETE /sessions/{id}` | – | 204 (Papierkorb) | 404, 409 `session_active` (läuft oder pausiert) |
| `GET /sessions/{id}/snapshot` | – | 200 `SessionSnapshot` | 404 |
| `POST /sessions/{id}/start` | `SessionStartRequest` | 200 `SessionStartResult` | 404, 409 `session_transition_invalid` |
| `POST /sessions/{id}/pause` | – | 200 `Session` | 404, 409 `session_transition_invalid` |
| `POST /sessions/{id}/resume` | – | 200 `Session` | 404, 409 `session_transition_invalid` |
| `POST /sessions/{id}/stop` | `SessionStopRequest` | 200 `Session` | 404, 409 `session_transition_invalid` |

- `state` ist eine Komma-Liste, z. B. `state=laeuft,pausiert` für die aktive Session nach einem Neuladen (F-SES-05).
- Sortierung: aufsteigend nach `coalesce(started_at, planned_starts_at, created_at)`.
- `from`/`to` filtern auf denselben Zeitpunkt. Der Heute-Bildschirm (T1-03) fragt `from=<heute 00:00>&to=<morgen 00:00>` ab.

### 7.3 Audio (T1-06)

| Methode und Pfad | Body | Antwort | Fehler |
|---|---|---|---|
| `POST /sessions/{id}/recordings` | `RecordingCreate` | 201 `Recording` | 404 `session_not_found`, 409 `session_not_active`, 409 `recording_exists` |
| `GET /recordings/{id}` | – | 200 `Recording` | 404 `recording_not_found` |
| `PUT /recordings/{id}/chunks/{seq}` | Rohdaten (§10.2) | 201 `AudioChunk`, 200 bei Duplikat | §10.2 |
| `POST /recordings/{id}/complete` | `RecordingComplete` | 200 `Recording` | 404, 409 `recording_seq_conflict` (`last_seq` kleiner als schon empfangene `seq`) |
| `GET /recordings/{id}/audio?from_ms&to_ms` | – | `audio/mp4` mit Range-Unterstützung (ab Phase 2 genutzt) | 404 `audio_not_ready` |

### 7.4 Notizen, Fotos (T1-11, T1-14, T1-15, T1-16)

| Methode und Pfad | Body | Antwort | Fehler |
|---|---|---|---|
| `GET /notebooks?module_id` | – | 200 `NotebookList` | |
| `POST /notebooks` | `NotebookCreate` | 201 `Notebook` | 404 `module_not_found`, 409 `notebook_kind_exists` (zweites Notizbuch `vorlesung`/`uebung` im Modul) |
| `PATCH /notebooks/{id}` | `NotebookUpdate` | 200 `Notebook` | 404 `notebook_not_found` |
| `DELETE /notebooks/{id}` | – | 204 | 404, 409 `notebook_default` (die Notizbücher „Vorlesung“ und „Übung“ eines Moduls lassen sich nicht löschen) |
| `GET /notebooks/{id}/pages` | – | 200 `NotebookPages` | 404 |
| `GET /pages/{id}` | – | 200 `PageDetail` | 404 `page_not_found` |
| `GET /pages/{id}/strokes` | – | 200 `PageStrokes` | 404 |
| `PUT /pages/{id}/pkdrawing` | Rohdaten `application/octet-stream`, Header `X-Sha256` | 200 `FileReceipt` | 404, 413 `file_too_large` (50 MB), 422 `checksum_mismatch` |
| `GET /pages/{id}/pkdrawing` | – | Datei | 404 `pkdrawing_not_found` |
| `GET /photos/{id}` | – | 200 `Photo` | 404 `photo_not_found` |
| `PUT /photos/{id}/file` | Rohdaten `image/heic` \| `image/jpeg`, Header `X-Sha256` | 201 `FileReceipt`, 200 bei Duplikat | 409 `photo_file_conflict` (anderes sha256 als schon gespeichert oder als in `photo.add`), 413 (30 MB), 415 `unsupported_media_type`, 422 `checksum_mismatch` |
| `GET /photos/{id}/file` | – | Datei | 404 `photo_file_missing` |

- **Abweichung von 08 §1:** Statt `POST /photos` (multipart) gibt es `PUT /photos/{id}/file` mit der vom iPad vergebenen `photo_id`. Das ist wiederholbar und passt zu Chunks und `pkdrawing`. Die Metadaten entstehen über die Operation `photo.add`, egal ob vor oder nach der Datei.
- `PUT /photos/{id}/file` für eine noch unbekannte `photo_id` ist erlaubt: Die Datei wird abgelegt, die Zeile entsteht mit `photo.add`. Verwaiste Dateien ohne Zeile nach 30 Tagen räumt `maintenance.nightly` weg.
- Der Core legt für jedes Modul die Notizbücher „Vorlesung“ (`vorlesung`) und „Übung“ (`uebung`) an: beim Anlegen des Moduls und, für ältere Module, beim ersten `GET /notebooks?module_id`. Das ist idempotent (F-INK-02).

### 7.5 Geräte, Daten, Einstellungen (T1-10, T1-18, T1-19)

| Methode und Pfad | Body | Antwort | Fehler |
|---|---|---|---|
| `GET /devices` | – | 200 `DeviceList` | |
| `DELETE /devices/{id}` | – | 204. Token sofort ungültig, offene WebSockets des Geräts werden mit Code 4401 geschlossen | 404 `device_not_found` |
| `POST /devices/pairings` | – | 201 `PairingCode` (für den QR-Code) | |
| `POST /devices/pair/start` | `PairStartRequest` | 201 `PairStartResponse` | 429 `pairing_rate_limited` |
| `POST /devices/pair/confirm` | `PairConfirmRequest` | 201 `PairResponse` | 403 `pairing_code_invalid`, 429 `pairing_rate_limited` |
| `GET /backups` | – | 200 `BackupOverview` | |
| `POST /backup` | – | 202 `BackupRun` | 409 `backup_running`, 409 `backup_target_missing` |
| `GET /trash?kind` | – | 200 `TrashList`, nach `deleted_at` absteigend | |
| `POST /trash/{id}/restore` | – | 200 `TrashRestoreResult` | 404 `trash_item_not_found`, 409 `restore_parent_deleted` (`details.parent`) |
| `GET /settings` | – | 200 `Settings` | |
| `PATCH /settings` | `SettingsUpdate` | 200 `Settings` | 400 `backup_target_invalid` (Pfad nicht absolut oder nicht beschreibbar) |

Modul-Einstellungen laufen über `PATCH /modules/{id}` (§14.2).

## 8. Kalender: Import und Abgleich (T1-01)

**Der Abgleich ist kein Job.** Der Core erledigt ihn synchron. Begründung:
- Die Einrichtung (F-KAL-04) braucht das Ergebnis mit den Vorschlägen sofort.
- Das Parsen eines Semesters dauert Millisekunden und braucht keine KI.
- Die Logik schreibt nur Core-Tabellen und legt Sessions an (§9.2).

Bibliothek: `ical.js` und `rrule` oder ein gleichwertiges Paket, mit Begründung im PR (`AGENTS.md`, Regel 9). Abnahme: die Erwartungen in `tests/fixtures/ics/*.json`.

Zeitplan: URL-Quellen beim Core-Start und danach alle 6 h. Datei-Quellen nur bei neuem Upload.

**Auflösen**
- RFC 5545 mit `RRULE`, `RDATE`, `EXDATE` und `RECURRENCE-ID` (verschobene Einzelvorkommen). `STATUS:CANCELLED` setzt `cancelled = true`.
- `TZID` mit `VTIMEZONE`: deren Regeln. `TZID` ohne `VTIMEZONE`: als IANA-Name lesen. Unbekannte Zone: `TZ` des Systems, dazu eine Warnung `timezone_unknown`. Termine ohne Zone (floating) gelten in `TZ`.
- `VALUE=DATE` ergibt `all_day = true`, `starts_at`/`ends_at` auf 00:00 UTC des Datums (Testfall ics/08).
- Serien ohne `UNTIL`/`COUNT` werden bis heute + 180 Tage aufgelöst und bei jedem Abgleich fortgeschrieben. Höchstens 5000 Vorkommen pro Quelle, darüber Warnung `too_many_events`.
- `recurrence_id` = ursprünglicher Beginn des Vorkommens: in der Zeitzone von `DTSTART` mit Offset (`2026-10-27T10:15:00+01:00`), bei UTC-Serien mit `Z`, bei ganztägigen Serien als Datum. Einzeltermine: `null`.

**Abgleich** über `(source_id, external_uid, recurrence_id)`:
- **neu:** anlegen.
- **geändert:** `title`, `location`, `description`, `starts_at`, `ends_at`, `all_day` und `cancelled` übernehmen. Eine schon gestartete Session behält ihre Daten (F-KAL-01).
- **entfallen** (fehlt in der Quelle): `cancelled = true`. Nie löschen.
- Bei `assigned_by = auto` laufen Modul- und Artzuordnung neu, bei `manuell` nie.

**Zuordnung (F-KAL-02)**
- **Kandidaten** sind die Module, deren Semester den Termin enthält (`starts_on ≤ Datum ≤ ends_on`). Gibt es keins, die Module des aktuellen Semesters. Gelöschte und archivierte Semester zählen nicht.
- **Modul:** Treffer über Name, Kürzel und Dozent in Titel, Ort oder Beschreibung, unabhängig von Groß-/Kleinschreibung und Umlautschreibweise. Nur ein **eindeutiger** Treffer wird gesetzt. Sonst bleibt `module_id` leer, und die Serie erscheint in `module_suggestions`.
- **Art:** über Schlüsselwörter (Übung/UE/Ü, Tutorium/Tut, Prüfung/Klausur/Exam, Vorlesung/VL/Lecture). Ganztägig ohne Modul: `fest`. Sonst `vorlesung`.
- **Manuell:** `PATCH /calendar/events/{id}` setzt `assigned_by = manuell`. Mit `scope = serie` (Standard) gilt das für alle Termine mit gleicher `source_id` und `external_uid`, auch für später hinzukommende Vorkommen.

## 9. Sessions (T1-02)

### 9.1 Zustandsautomat (F-SES-01)

| Von | Auslöser | Nach | Wer | Nebenwirkung |
|---|---|---|---|---|
| `geplant` | 15 min vor `planned_starts_at` | `bereit` | Core-Takt (jede Minute) | Ereignis `session.updated` |
| `geplant`, `bereit` | `planned_ends_at` vorbei, nie gestartet | `verpasst` | Core-Takt | `session.updated` |
| `geplant`, `bereit` | `start` (REST oder `session.start`) | `laeuft` | Mac, iPad | `started_at`, `started_from`. Eine andere `laeuft`/`pausiert`-Session wird vorher beendet (siehe unten) |
| `laeuft` | `pause` | `pausiert` | Mac, iPad | |
| `pausiert` | `resume` | `laeuft` | Mac, iPad | |
| `laeuft`, `pausiert` | `stop` (manuell oder Auto-Stopp aus dem Browser) | `beendet` | Mac, iPad | `ended_at`, `stop_reason`, Jobs `audio.finalize` (§3) |
| `laeuft`, `pausiert` | Start einer anderen Session | `beendet` | Core | `stop_reason = kalenderende`, `ended_at = planned_ends_at`, falls dieser Zeitpunkt vorbei ist, sonst jetzt |
| `laeuft`, `pausiert` | Core-Takt: `planned_ends_at + auto_stop_hard_after_end_min` bzw. `started_at + auto_stop_max_duration_min` überschritten, obwohl der Browser nicht gestoppt hat | `beendet` | Core | `stop_reason = kalenderende` bzw. `maximaldauer` |
| `laeuft`, `pausiert` | Core-Start, und die Grenze der vorigen Zeile lag in der Zeit, in der der Core nicht lief | `beendet` | Core | `stop_reason = absturz_wiederhergestellt`, `ended_at` = letzte Aktivität (Ende des letzten Chunks oder `at` der letzten Operation, mindestens `started_at`) |
| `beendet` | alle Jobs der Session fertig | `verarbeitet` | Worker (§3) | Wurde beim Stopp kein Job angelegt, setzt der Core sofort `verarbeitet` |

- **Gleicher Zielzustand ist kein Fehler:** `start` auf `laeuft`, `pause` auf `pausiert`, `resume` auf `laeuft` und `stop` auf `beendet`/`verarbeitet` liefern 200 bzw. `ack` ohne Änderung. Das fängt den Doppel-Tipp an Mac und iPad ab.
- **Jeder andere Übergang** wird abgelehnt: `409 session_transition_invalid` mit `details: { state, action }`. Im Sync: `error` mit gleichem Code, `retryable = false`.
- **Invariante 1** gilt für `laeuft` **und** `pausiert` zusammen: höchstens eine aktive Session.
- `verpasst`, `beendet` und `verarbeitet` lassen sich nicht wieder starten. Eine verpasste Vorlesung bekommt Aufnahmen über den Import (F-SES-06, Phase 2).
- **Core-Neustart:** `laeuft` bleibt `laeuft` (F-SES-05), solange die Grenzen aus Auto-Stopp-Regel 2 und 4 nicht überschritten sind. Der Core-Takt prüft sie beim Start und danach jede Minute.

### 9.2 Woher Sessions kommen

- **Aus dem Kalender:** Der Core legt für jeden nicht abgesagten Termin der Art `vorlesung`, `uebung` oder `tutorium` mit Modul eine Session `geplant` an. Das passiert beim Abgleich und wenn ein Termin später ein Modul bekommt. Sie ist idempotent über `UNIQUE (calendar_event_id)`. `module_id` folgt der Zuordnung, solange die Session nicht gestartet wurde.
- **Abgesagt:** Wird ein Termin abgesagt oder verliert er sein Modul, löscht der Core die Session weich, solange sie nie gestartet wurde. Gestartete Sessions bleiben unverändert.
- **Spontan (F-SES-04):** `POST /sessions` legt eine Session in `bereit` an, ohne `planned_*`. Sie wird darum nie `verpasst`.
- **Offline auf dem iPad:** `session.start` mit unbekannter `session_id` legt die Session an. Mit `calendar_event_id` ersetzt sie eine nie gestartete Session desselben Termins (die alte wird weich gelöscht). Läuft die Session zu diesem Termin schon, ist das ein `session_transition_invalid`.
- **`number` (VL 7):** Bei Sessions zu Terminen der Art `vorlesung` die Position in zeitlicher Reihenfolge unter den nicht abgesagten `vorlesung`-Terminen desselben Moduls. Der Core rechnet sie bei jedem Abgleich neu, solange die Session nicht gestartet wurde, danach bleibt sie fest. Sonst `null`.
- **Folien:** Wird ein Foliensatz mit `session_id` hochgeladen und hat die Session noch kein `slide_deck_id`, setzt der Core es. Ohne Folien läuft der folienlose Modus (F-SES-02).
- **Sitzungszeit:** `t_ms = Ereigniszeit − started_at`. Pausen ändern sie nicht.

## 10. Audio (T1-06)

### 10.1 Aufnahmen

- **Eine Aufnahme ist ein MediaRecorder-Strom.** Nach Neuladen oder Absturz legt die Web-App eine **neue** Aufnahme an (`started_ms` = aktuelle Sitzungszeit). Die Lücke dazwischen bleibt erhalten (02 §5).
- Aufnahmen gibt es nur für Sessions in `laeuft` oder `pausiert` (`409 session_not_active`). Chunks und `complete` sind auch danach noch erlaubt (Nachlieferung aus IndexedDB).
- `chunks_independent` legt die Web-App nach Spike S4 fest. Der Worker muss beide Fälle können (§3).

### 10.2 Chunk-Upload `PUT /recordings/{id}/chunks/{seq}`

- **Body:** Rohdaten. `Content-Type` = Basistyp von `recording.mime` (`audio/webm` bzw. `audio/mp4`, Parameter wie `codecs` egal).
- **Header** (Pflicht, als `AudioChunkMeta` geparst):
  - `X-Start-Ms`: Sitzungszeit des Chunk-Beginns, Dezimalzahl ≥ 0
  - `X-Duration-Ms`: Länge, Dezimalzahl ≥ 1
  - `X-Sha256`: SHA-256 des Bodys, hex in Kleinbuchstaben
- `seq` beginnt pro Aufnahme bei 0 und wird lückenlos hochgezählt (Invariante 2). Die Reihenfolge der Uploads ist egal.
- **Antworten:**

| Fall | Status | Code |
|---|---|---|
| neu gespeichert | 201 | `AudioChunk` |
| gleiche `seq`, gleiches sha256 | 200 | `AudioChunk` mit `duplicate = true` |
| gleiche `seq`, anderes sha256 | 409 | `chunk_conflict` |
| Header fehlt oder ungültig | 400 | `chunk_header_invalid` |
| sha256 passt nicht zum Body | 422 | `checksum_mismatch` |
| `Content-Type` passt nicht zur Aufnahme | 415 | `chunk_mime_mismatch` |
| Body > 10 MB | 413 | `chunk_too_large` |
| Aufnahme unbekannt | 404 | `recording_not_found` |

- Die Web-App löscht einen Chunk aus IndexedDB erst nach 200 oder 201. Bei 409 oder 422 versucht sie es **nicht** erneut, sondern meldet den Fehler. Bei 5xx und Netzfehlern wiederholt sie mit exponentiellem Warten bis 30 s.
- Nach dem letzten Chunk: `POST /recordings/{id}/complete` mit `last_seq` und `duration_ms`. Fehlt eine `seq ≤ last_seq` beim Finalisieren, wird die Aufnahme `mit_luecken`.

## 11. Sync-Protokoll (T1-08, T1-09)

Ergänzt 08 §2. Alle Nachrichten: `SyncClientMessage` bzw. `SyncServerMessage`. Eine Nachricht = ein Text-Frame mit einem JSON-Objekt, höchstens 1 MB.

### 11.1 Verbindung und Anmeldung

- **Pfad:** `ws://<mac>:4710/sync`, außerhalb von `/api/v1`. Beim Upgrade gelten die Host- und Origin-Prüfung aus §5. Eine fremde Webseite im Browser darf sich nicht über `localhost` verbinden (Cross-Site WebSocket Hijacking). Ein `Origin`, der nicht erlaubt ist, wird mit HTTP 403 abgewiesen.
- **Erste Nachricht** muss innerhalb von 5 s `hello` sein, sonst `error hello_required` und Schließen mit Code 4408.
  - **Aus dem Netz:** `token` ist Pflicht und muss einem gekoppelten Gerät gehören. Sonst `error device_token_invalid` (fatal) und Code 4401. Ist `device_id` angegeben, muss sie zum Token passen.
  - **Lokal** (Web-App): ohne Token, `device_id` leer.
- `protocol` ≠ 1: `error protocol_unsupported` (fatal), Code 4426.
- **Antwort** `welcome` mit `server_time` und je abonniertem Strom einem `resume`-Eintrag. Danach sendet der Server:
  1. die fehlenden Operationen jedes Stroms ab `from_seq` bis `head_seq` in `seq`-Reihenfolge,
  2. die aktuellen `presence`- und `device.connection`-Ereignisse der anderen Clients.
- **`reset = true`** (der Client kennt eine höhere `seq`, als der Server hat, z. B. nach einer Wiederherstellung): Der Client verwirft seinen Stand dieses Stroms und lädt per REST neu (`NotebookPages`/`PageStrokes` bzw. `SessionSnapshot`). Dann abonniert er ab dem dortigen `stream_seq` mit `subscribe`. Unbestätigte eigene Operationen schickt er trotzdem, sie sind idempotent.
- **Ströme** entstehen implizit. Ein unbekannter Strom hat `head_seq = 0`. `subscribe`/`unsubscribe` ändern Abos ohne neue Verbindung. Schreiben darf ein Client in jeden Strom, Weitergaben bekommt er nur für abonnierte.
- **Phase 1:** Der Strom `user` trägt noch keine Operationen. Server-Ereignisse gehen ohne `seq` an alle Clients (§11.6).
- **Snapshot und Strom zusammensetzen:** REST-Antworten mit `stream_seq` liest der Core in **einer** Transaktion mit dem Stromkopf. Der Client wendet danach nur Operationen mit `seq > stream_seq` an.

### 11.2 Operationen, `seq` und `ack`

- `at` ist die synchronisierte Zeit, **zu der die Operation auf dem Gerät entstanden ist**, nicht der Sendezeitpunkt. Verspätet gesendete Operationen behalten `at` und `t_ms` (08 §2.3).
- Der Server prüft jede Operation gegen `SyncOp`. Stimmen Strom und Inhalt nicht überein, etwa `stroke.add` auf eine Seite eines anderen Notizbuchs oder `marker.add` mit anderer `session_id` als der Strom, folgt `error stream_mismatch`.
- **Reihenfolge:** Der Server verarbeitet die Operationen einer Verbindung in Empfangsreihenfolge und vergibt `seq` pro Strom lückenlos ab 1 beim Commit. Danach sendet er `ack` an den Absender und die Operation mit `seq` und `origin` an alle anderen Abonnenten. Der Absender bekommt seine eigene Operation nicht zurück.
- **Idempotenz:** Ist eine `op_id` schon bekannt, sendet der Server das ursprüngliche `ack` erneut. Gleiche `op_id` mit anderem `stream`, `kind` oder `data` ergibt `error op_id_reused` (`retryable = false`).
- **Höchstens 200 unbestätigte Operationen** pro Verbindung. Darüber folgt `error too_many_pending` mit `op_id` und `retryable = true`. Die Operation wird nicht angewendet.
- **Zurückhalten:** `stroke.add`, `stroke.remove`, `element.*`, `page.update`, `page.delete` und `drawing.snapshot` für eine Seite, die der Core noch nicht kennt, hält er im Speicher der Verbindung zurück (kein `ack`), bis `page.create` kommt. Endet die Verbindung vorher, verwirft er sie. Der Client sendet sie beim nächsten Verbinden erneut.
- **`error` mit `op_id`:** Bei `retryable = false` entfernt der Client die Operation endgültig aus der Ausgangswarteschlange und protokolliert sie. Bei `true` sendet er sie später erneut. `error` ohne `op_id` betrifft die Verbindung. Bei `fatal = true` schließt der Server sie.
- **Neu verbinden:** Der Client sendet alle unbestätigten Operationen erneut, in der ursprünglichen Reihenfolge und in Paketen bis 200 (F-SYN-03).

### 11.3 Wirkung der Operationen

| `kind` | Wirkung im Core |
|---|---|
| `page.create` | Seite anlegen, `version = 1`. Der Strom muss `notebook:<notebook_id>` sein. Existiert die `page_id` schon: `ack` ohne Änderung. Unbekanntes oder gelöschtes Notizbuch: `error notebook_not_found` (`retryable = false`) |
| `page.update` | `fields` übernehmen, wenn `version` der aktuellen entspricht, dann `version + 1`. Sonst `error page_version_conflict` (`retryable = false`), der Client lädt die Seite neu |
| `page.delete` | Seite mit Strichen und Elementen weich löschen (gleiches `deleted_at`) |
| `stroke.add` | **Upsert** über `(page_id, client_id)`. Ein gelöschter Strich wird dabei wiederbelebt. Damit funktioniert Lasso = `stroke.remove` + `stroke.add` mit gleicher `client_id` (08 §4.3). `clock_uncertain` aus dem Umschlag wird in `stroke.clock_uncertain` gespeichert, `created_at` (ms) als `timestamptz` |
| `stroke.remove` | `deleted_at` setzen. Unbekannte `client_id` werden ignoriert |
| `element.upsert` / `element.remove` | Upsert über `element_id` bzw. weich löschen |
| `drawing.snapshot` | Hinweis an andere iPads, dass `PUT /pages/{id}/pkdrawing` mit diesem sha256 hochgeladen wurde. Der Core bestätigt immer. Ob die Datei vorliegt, zeigt `Page.has_pkdrawing` |
| `session.start` / `.pause` / `.resume` / `.stop` | wie die REST-Aktionen (§9.1). `started_at` aus den Daten bzw. `ended_at = at`, nicht die Serverzeit. Unbekanntes Modul: `module_not_found`, unbekannte Session bei pause/resume/stop: `session_not_found` (beide `retryable = false`) |
| `slide.change` | `slide_event` anlegen, `source` aus `device` (`manuell_mac`/`manuell_ipad`). Idempotent über `event_id` |
| `marker.add` / `marker.remove` | Marker anlegen bzw. weich löschen. Unbekannter Marker beim Entfernen: `ack` |
| `photo.add` | `photo`-Zeile anlegen, `has_file` aus der Ablage. Kommt die Datei später, prüft der Core ihr sha256 gegen `file_ref` |

REST-Aktionen der Session erzeugen dieselben Operationen mit `origin = server` und einer neuen `op_id`. Die REST-Antwort kommt erst nach dem Commit der Operation.

### 11.4 Keepalive

Der Client sendet alle 15 s `ping`, der Server antwortet mit `pong`. Bleibt die Antwort 45 s aus, trennt der Client und verbindet neu. Er wartet dabei exponentiell länger, höchstens 30 s. Der Server schließt Verbindungen, von denen 60 s nichts kam.

### 11.5 Uhrabgleich (F-SYN-02, T1-09)

- Nach `welcome` sendet der Client 5 × `time.ping` nacheinander. Jedes nächste geht erst nach dem `time.pong` des vorigen raus.
- Versatz = Median von `ts − (t0 + t1) / 2`, mit `t1` = lokale Empfangszeit. Ergebnis per `time.offset` an den Server, der es in `device.clock_offset_ms` speichert. Das wiederholt sich alle 5 min.
- **Synchronisierte Zeit** = lokale Uhr + Versatz. Ohne gemessenen Versatz gilt Versatz 0 und `clock_uncertain = true`.
- Liegt beim Verbinden ein Versatz vor, korrigiert der Client `at`, `created_at` und `t_*` noch nicht gesendeter Operationen mit `clock_uncertain = true` vor dem Senden und setzt die Markierung zurück (02 §5). Gesendete Operationen werden nicht nachträglich korrigiert.
- Die Web-App läuft auf dem Mac des Cores und nutzt Versatz 0. Den Abgleich macht sie trotzdem, um Fehler zu erkennen.

### 11.6 Anwesenheit und Server-Ereignisse

- Das iPad sendet `presence` bei jedem Wechsel von Session, Notizbuch oder Seite. Der Server gibt das als Ereignis `presence` an alle anderen weiter. Die Notizen-Spalte folgt `page_id` des iPads (F-DSH-04).
- `device.connection` geht bei jeder An- und Abmeldung eines Clients raus (iPad-Punkt in der Statusleiste, F-DSH-06).
- `session.updated` geht bei jeder Änderung einer Session raus, auch bei zeitgesteuerten und vom Worker gemeldeten (§3, `pg_notify('sg_session', …)`).
- `pairing.requested` geht nach `POST /devices/pair/start` an alle Clients. Die Web-App zeigt den Code an.
- Ereignisse werden nicht nachgeliefert. Wer neu verbindet, holt den Stand per REST (`GET /sessions`, `GET /devices` mit `connected`).

### 11.7 Hinweise zum Swift-Codegen

quicktype fasst Unions wie `SyncOp` zu **einer** Struktur mit optionalen Feldern zusammen. Die einzelnen Varianten (`StrokeAddOp`, `MarkerAddOp`, …) gibt es aber als eigene, strikte Structs. Das iPad decodiert darum zuerst nur `type` und `kind` und danach die passende Variante. Gleiches gilt für `PageElement` (über `kind`) und `SyncEvent` (über `name`).

## 12. Kopplung (F-INK-13, T1-10)

1. **QR-Weg:** Die Web-App (Einstellungen → Geräte) ruft `POST /devices/pairings` auf und zeigt `qr_url` als QR-Code und dazu den Code. Ein neuer Aufruf macht den vorigen Code ungültig.
2. **Bonjour-Weg:** Der Core kündigt `_studiengehirn._tcp` an (TXT `v=1`, `name=<Macname>`). Das iPad ruft `POST /devices/pair/start` auf. Der Core erzeugt einen Code, an `public_nonce` gebunden, und sendet `pairing.requested` an die Web-App. Der Code steht **nicht** in der Antwort an das iPad.
3. Der Nutzer tippt den Code am iPad ein bzw. der QR-Scan liefert ihn. Das iPad ruft `POST /devices/pair/confirm` auf.
   - Code aus Schritt 2: `public_nonce` muss passen.
   - Code aus Schritt 1: das iPad schickt seinen eigenen Nonce.
   - Antwort: `device_token`, 32 Byte Zufall, base64url. Gespeichert wird nur `sha256` als `token_hash`.
4. **Grenzen:** Ein Code gilt 5 min und nur einmal. Nach 5 falschen Versuchen ist die Kopplung ungültig. Pro Absenderadresse höchstens 10 `pair/*`-Aufrufe pro Minute (`429 pairing_rate_limited`). Codes werden mit `crypto.randomInt` erzeugt und nur gehasht gespeichert.
5. Gerät entfernen (`DELETE /devices/{id}`) widerruft das Token sofort (08 §3).

## 13. Backups und Papierkorb (F-DAT-01/02/04, T1-18)

**Backups**
- Ausführung durch die CLI: `pnpm sg backup` (Datenbank mit `pg_dump -Fc`, dazu inkrementelle Kopie von `media/` und `vault/` nach `<ziel>/<stand>/`). Sie schreibt `backup_run` selbst.
- **Der Core startet die CLI:**
  - täglich zur Zeit aus `data.backup_time` (`trigger = zeitplan`),
  - beim Start, falls der letzte Termin verpasst wurde,
  - über `POST /backup` (`manuell`).
- Ohne `data.backup_target` gibt es keine Backups, `BackupStatus.target = null`.
- `sg migrate` erstellt vorher ein Backup mit `trigger = vor_migration`.
- **Aufbewahrung:** 14 tägliche, 8 wöchentliche, 6 monatliche Stände. Das Ausdünnen erledigt `sg backup` nach jedem erfolgreichen Lauf.
- `stale = true`, wenn das letzte erfolgreiche Backup älter als 3 Tage ist (Hinweis im Tagesbriefing, F-DAT-01).
- **Wiederherstellung:** `pnpm sg restore <stand>` bei gestopptem Core. Monatlicher Test: `pnpm sg restore --test <stand>` in eine Wegwerf-Datenbank mit Zählung der Objekte (F-DAT-02). Nach einer Wiederherstellung meldet der Sync bei abweichenden `seq` `reset = true` (§11.1).

**Papierkorb**
- Löschen per REST oder Operation setzt `deleted_at` am Objekt und an allen Teilen **mit demselben Zeitstempel**. Teile sind z. B. die Module, Foliensätze und Sessions eines Semesters oder die Seiten, Striche und Elemente eines Notizbuchs.
- `GET /trash` zeigt nur **direkt** gelöschte Objekte. Das sind die, deren Elternobjekt nicht mit demselben Zeitstempel gelöscht wurde. `purge_at = deleted_at + 30 Tage`.
- `POST /trash/{id}/restore` stellt das Objekt und alle Teile mit **genau** diesem `deleted_at` wieder her. Die ID ist die Objekt-ID (UUIDs sind tabellenübergreifend eindeutig). Ist das Elternobjekt selbst gelöscht, folgt `409 restore_parent_deleted`.
- „Rückgängig“ im Toast (10 s, F-DAT-04) nutzt denselben Endpunkt. Für Marker nutzt die Web-App stattdessen `marker.remove` im Sync.
- Endgültiges Löschen nach 30 Tagen erledigt `maintenance.nightly` (Worker, Payload `{}`). Der Core legt den Job täglich um 03:30 an.

## 14. Einstellungen (F-EIN-01, T1-19)

### 14.1 Globale Einstellungen

- Speicherung in `setting` mit je einem Schlüssel pro Bereich (`general`, `lecture`, `pen`, `data`). Der Wert ist das Bereichsobjekt **ohne** Standardwerte.
- `GET /settings` füllt fehlende Felder mit den Standards. `PATCH /settings` führt Feld für Feld zusammen.
- `general.data_dir` ist nur lesbar (`SG_DATA_DIR`).

| Feld | Standard |
|---|---|
| `general.content_lang` / `appearance` | `de` / `system` |
| `lecture.microphone_id` | `null` (Standardmikrofon) |
| `lecture.auto_stop_*` | Ende + 10 min bei 3 min ohne Sprache · Ende + 30 min · Stille 15 min · max. 240 min · Hinweis 60 s · Verlängerung 15 min (F-SES-03) |
| `lecture.default_layout` / `default_ink_mode` / `toolbar_side` | `standard` / `freie_seite` / `rechts` |
| `pen.double_tap` / `squeeze` / `shape_recognition` | `radierer` / `werkzeugpalette` / `false` |
| `pen.favorite_colors` | `#1E2A44FF`, `#C92A2AFF`, `#1864ABFF`, `#2B8A3EFF`, `#E67700FF`, `#5F3DC4FF`, `#495057FF`, `#000000FF` |
| `data.backup_target` / `backup_encryption` / `backup_time` | `null` / `false` / `03:00` |

Die Bereiche KI, Lernen und Planer kommen in späteren Phasen als eigene Schlüssel dazu.

### 14.2 Modul-Einstellungen (W-06 Option A)

- `module.settings jsonb NOT NULL DEFAULT '{}'` mit dem Inhalt `ModuleSettings`: `layout`, `column_widths`, `ink_mode`. Ein fehlender Schlüssel bedeutet: globaler Standard aus `lecture.default_layout` bzw. `default_ink_mode`.
- **Schema-Änderung im Ticket der Migration** (T1-04): `Module` bekommt `settings: ModuleSettings` als Pflichtfeld, `ModuleUpdate` bekommt `settings?: ModuleSettingsUpdate`. Beides kommt im selben PR wie Migration und Core-Änderung. So bleibt `main` grün, weil der Core das Feld vorher nicht liefert. Diese Änderung an `packages/schemas` ist für T1-04 vorab freigegeben.
- `PATCH /modules/{id}` mit `settings` führt Schlüssel für Schlüssel zusammen, `null` entfernt einen Schlüssel. Die Web-App schreibt `layout`/`column_widths` (F-DSH-01), das iPad `ink_mode` (F-INK-03). Die beiden überschreiben sich nicht gegenseitig.

## 15. Fehlercodes Phase 1 (Übersicht)

| Code | HTTP | Bedeutung |
|---|---|---|
| `calendar_source_not_found`, `calendar_event_not_found`, `session_not_found`, `recording_not_found`, `notebook_not_found`, `page_not_found`, `photo_not_found`, `device_not_found`, `trash_item_not_found` | 404 | Objekt fehlt oder ist gelöscht |
| `photo_file_missing`, `pkdrawing_not_found`, `audio_not_ready` | 404 | Datei (noch) nicht vorhanden |
| `calendar_source_exists`, `session_exists`, `recording_exists`, `notebook_kind_exists` | 409 | Doppelt angelegt |
| `notebook_default` | 409 | Standard-Notizbuch lässt sich nicht löschen |
| `session_transition_invalid`, `session_not_active`, `session_active` | 409 | Zustandsautomat (§9.1) |
| `chunk_conflict`, `recording_seq_conflict`, `photo_file_conflict` | 409 | Gleiche ID, anderer Inhalt |
| `backup_running`, `backup_target_missing`, `restore_parent_deleted` | 409 | Daten (§13) |
| `chunk_header_invalid`, `backup_target_invalid` | 400 | Anfrage ungültig |
| `pairing_code_invalid` | 403 | Code falsch, abgelaufen oder verbraucht |
| `file_too_large`, `chunk_too_large` | 413 | Größe |
| `unsupported_media_type`, `chunk_mime_mismatch` | 415 | Dateityp |
| `ics_invalid`, `checksum_mismatch` | 422 | Inhalt ungültig |
| `pairing_rate_limited` | 429 | zu viele Versuche |
| `ics_fetch_failed` | 502 | ICS-URL nicht erreichbar |

Codes im Sync-Protokoll: `SyncErrorCode` im Schema. WebSocket-Schließcodes: 4401 Token ungültig oder widerrufen, 4408 kein `hello`, 4426 Protokollversion.
