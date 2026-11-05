# Laufzeit-Verträge zwischen den Bausteinen (Phase 0 und 1)

Diese Datei legt fest, wie Core, Worker, Web-App, iPad-App und `sg`-CLI zusammenspielen. So können die Teile parallel gebaut werden (`AGENTS.md`, Regel 4).
Änderungen nur durch den Lead. Datenformate selbst stehen in `packages/schemas`.

§1–5 gelten seit Phase 0. §6–16 sind die Verträge und der Ticketplan für Phase 1.

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
  Ausnahmen: `setting` (Schlüssel `key` statt `id`), `idempotency_key` und die Sync-Tabellen `sync_stream`, `sync_op`, `sync_meta`. Sie haben genau die Spalten aus §6.1, ohne `id`, `user_id` und `deleted_at`.

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
- **Ergebnis** enthält `job_duration_ms` (Laufzeit des Jobs) getrennt von `audio_duration_ms` (Länge der Datei).
- **Ausführung (Worker):** Chunks nach `seq` lesen. Bei `chunks_independent = false` als ein Bytestrom aneinanderhängen, sonst jeden Chunk einzeln decodieren. Dann mit `ffmpeg` nach `full.m4a` (AAC, 48 kHz, mono) umwandeln. Lücken (fehlende `seq` oder Sprünge in `start_ms`) werden als Stille mit korrekter Länge eingefügt. Zum Schluss `recording.duration_ms` und `recording.state` (`vollstaendig` bzw. `mit_luecken`) setzen.
- **Session-Fortschritt (Worker):** Nach jedem Job mit `session_id` setzt der Worker `session.processing[<job.type>] = <job.state>`. Hat die Session danach keinen Job mehr in `wartet` oder `laeuft` und ist sie `beendet`, setzt er `state = 'verarbeitet'`. Danach folgt `pg_notify('sg_session', '<session_id>')`. Der Core hört darauf und sendet das Ereignis `session.updated` (§11.6).

### IDs im Worker (ab Phase 1)

`psycopg` liefert `uuid`-Spalten als `uuid.UUID`. Die Pydantic-Modelle aus `sg_schemas` erwarten IDs als `str` in Kleinbuchstaben (`Uuid`, `docs/ENTWICKLUNG.md`). Darum vor der Validierung bzw. beim Schreiben von `job.result` immer `str(value)` verwenden (T1-06w, T1-18).

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
| Tafel-Foto (Phase 1) | `media/photos/<photo_id>.heic` (`image/heic`) bzw. `.jpg` (`image/jpeg`) |
| PencilKit-Sicherung (Phase 1) | `media/pages/<page_id>.pkdrawing` |
| Logs | `logs/core.log`, `logs/worker.log` |

In der DB steht `file_path` relativ zu `SG_DATA_DIR`. So lässt sich der Datenordner verschieben.

**Schreiben:** Hochgeladene Dateien schreibt der Core zuerst nach `<ziel>.part` und benennt sie nach erfolgreicher sha256-Prüfung atomar um. Halbe Dateien bleiben so nie unter dem Zielnamen liegen.

## 5. HTTP-Konventionen des Core

- Basis `/api/v1`, Fehlerformat `ApiError`, Listen mit `?cursor&limit` (08 §1).
- **Lokal oder Netz** entscheidet allein die Socket-Adresse (`request.socket.remoteAddress` ist `127.0.0.1` oder `::1`). `trustProxy` bleibt aus. `Host` und `X-Forwarded-For` werden dafür **nie** ausgewertet.
- Lokale Anfragen brauchen kein Token. Anfragen aus dem Netz brauchen `Authorization: Bearer <device_token>`. In Phase 0 werden sie mit `401 device_token_required` abgelehnt, weil es noch keine Kopplung gibt (T1-10).
- **Ab Phase 1 (T1-10):** Der Core vergleicht `sha256(token)` mit `device.token_hash` gekoppelter, nicht gelöschter Geräte. Fehlt das Token: `401 device_token_required`. Ist es unbekannt oder widerrufen: `401 device_token_invalid`. Bei Erfolg setzt der Core `device.last_seen_at`, höchstens einmal pro Minute. Ohne Token aus dem Netz erreichbar sind nur `POST /devices/pair/start` und `POST /devices/pair/confirm`. Der WebSocket `/sync` ist eine Netzroute wie alle anderen: Token im `Authorization`-Header des Upgrades (§11.1). Für alle anderen Routen gelten lokale Anfragen und Anfragen mit gültigem Token gleich, außer den als **lokal** markierten (§7).
- **Schutz gegen DNS-Rebinding:** Gilt nur für Anfragen über Loopback, also lokale Anfragen. Ist ihr `Host` nicht `localhost`, `127.0.0.1` oder `[::1]` (jeweils mit `SG_CORE_PORT`), antwortet der Core mit `421 host_not_allowed`. Anfragen aus dem Netz, etwa vom iPad über die IP oder `<rechnername>.local`, prüft er stattdessen über das Geräte-Token.
- **Schutz gegen CSRF:** Zustandsändernde Anfragen (`POST`, `PUT`, `PATCH`, `DELETE`) mit `Origin`-Header werden mit `403 origin_not_allowed` abgelehnt. Ausgenommen sind die eigene Herkunft (`http://<erlaubter Host>:<SG_CORE_PORT>`) und `SG_DEV_WEB_ORIGIN`. Ohne `Origin`-Header (z. B. `curl`, iPad-App) gilt nur die Token-Regel.
- Statische Web-App unter `/`. Unbekannte Pfade außerhalb von `/api` liefern `index.html` bzw. die passende `.html`-Datei aus dem Export.
- Die Web-App nutzt Routen mit Query-Parametern statt dynamischer Segmente (`/modul?id=<uuid>`), weil der Static Export die IDs beim Build nicht kennt.

---

# Phase 1

## 6. Grundsätze

- **Datenformate** stehen in `packages/schemas/src`: `calendar`, `session`, `ink`, `sync`, `system`, `settings` sowie Ergänzungen in `common` und `jobs`. Diese Datei regelt alles, was nicht im Schema steht: Endpunkte, Statuscodes, Abläufe, Reihenfolge und Grenzen.
- **Ein Schreibweg pro Datenart.**
  - Neue freie Notizbücher, Seiten, Striche, Seitenelemente, Folienwechsel, Marker, Fotos und die Session-Steuerung vom iPad laufen als **Sync-Operation** über den WebSocket (§11). So funktioniert alles auch offline.
  - Notizbücher **umbenennen, verschieben und löschen** geht in Phase 1 nur per REST, also nur mit Verbindung (`PATCH`/`DELETE /notebooks/{id}`). Der Core meldet solche Änderungen als Server-Operation im Notizbuch-Strom (§11.3). Die Web-App legt Notizbücher per `POST /notebooks` an.
  - Die Web-App sendet Folienwechsel und Marker **ebenfalls als Operation** über den WebSocket. Es gibt keinen REST-Weg dafür und damit nur eine Implementierung im Core.
  - Start, Pause, Fortsetzen, Stopp und Verlängern kommen aus der Web-App per REST (§9), weil sie eine sofortige Antwort braucht. Der Core legt für Zustandswechsel selbst eine Operation in den Strom `session:<id>` (`origin = server`), damit alle Clients sie sehen.
- **Zeit:** REST liefert ISO 8601 UTC mit `Z`, Millisekunden nur, wenn sie nicht 0 sind. Im Sync-Protokoll sind alle absoluten Zeiten Epochen-ms (`EpochMs`). Sitzungszeiten heißen `t_ms` bzw. `*_ms` (`SessionMs`). Eingebettete REST-Objekte, etwa `Session` im Ereignis `session.updated`, behalten ihr REST-Format.
- **IDs:** Clients erzeugen UUIDv7 für alles, was sie offline anlegen (Notizbücher, Seiten, Striche, Marker, Fotos, spontane Sessions, Aufnahmen). **Alle UUIDs werden in Kleinbuchstaben erzeugt und übertragen.** Der Server normalisiert nicht: Großbuchstaben verletzen das Schema (`Uuid`) und werden abgelehnt. Alle Create-Bodies haben ein optionales `id`. Ist die `id` schon vergeben, antwortet der Core mit `409 <objekt>_exists`. Wiederholte Anfragen sichert der `Idempotency-Key` ab (08 §1).
- **Pfadparameter** prüft der Core mit dem Schema: `{id}` als `Uuid`, `{seq}` als Ganzzahl ≥ 0. Ein ungültiger Wert ergibt `400 validation_failed`, nicht 404.
- **Verweise über Stromgrenzen** (`slide_id`, `background_slide_id`, `attached_slide_id`, `page.session_id`, `marker.page_id`, `photo.page_id`, `photo_id` in Bildelementen, `marker_id` in Stempeln): Der Core speichert sie **ohne Fremdschlüssel** und löst sie beim Lesen auf (F-SYN-03: Folie kommt später, Session wurde offline angelegt). Fremdschlüssel gibt es nur innerhalb eines Stroms, z. B. `page.notebook_id`, `stroke.page_id` und `marker.session_id`. `sync_op.device_id` hat ebenfalls keinen Fremdschlüssel, damit der Verlauf nach dem Entfernen eines Geräts lesbar bleibt.
- **Löschen** ist weich (03 §1). Abhängige Objekte bekommen **denselben** `deleted_at`-Zeitstempel (Kaskaden in §13). Darüber stellt der Papierkorb genau den Löschvorgang wieder her.

### 6.1 Neue Tabellen und Ergänzungen zu 03

Eigentümer der Tabellen bleibt der Core. Alle Tabellen legt **T1-DB** in einer Migration an (§16). Spalten nach 03 §3, §5, §6 und §13, dazu:

| Tabelle | Ergänzung | Grund |
|---|---|---|
| `module` | `settings jsonb NOT NULL DEFAULT '{}'` (`ModuleSettings`) | W-06 Option A, übernommen in 03 §3 |
| `calendar_source` | `name text`, `last_error text NULL` | Anzeige mehrerer Quellen, Fehler beim URL-Abgleich |
| `calendar_event` | `description text NULL`, `all_day bool`, `assigned_by text` (`auto`/`manuell`) | Zuordnung über die Beschreibung (F-KAL-02), ganztägige Termine (Testfall ics/08), manuelle Zuordnung bleibt beim Abgleich erhalten |
| `calendar_event` | Unique-Index `(source_id, external_uid, recurrence_id) NULLS NOT DISTINCT WHERE source_id IS NOT NULL` (`calendar_event_sync_uq`). Upsert mit `ON CONFLICT (source_id, external_uid, recurrence_id) WHERE source_id IS NOT NULL` | Abgleichschlüssel (F-KAL-01). Manuelle Termine (`source_id NULL`) fallen nicht darunter |
| `session` | `UNIQUE (calendar_event_id) WHERE deleted_at IS NULL` | Eine Session pro Termin |
| `session` | `start_offsets jsonb NOT NULL DEFAULT '[]'` (`SessionStartOffset[]`), `auto_stop_extended_until timestamptz NULL` | Abweichender Offline-Start (§9.3), Verlängerung (§9.4) |
| `recording` | `chunks_independent bool`, `completed_at timestamptz NULL`, `completed_last_seq int NULL`, `completed_duration_ms int8 NULL` (Angaben aus `RecordingComplete`) | Spike S4, Abschluss durch den Client. `completed_last_seq` braucht `recording_seq_conflict` (§7.3) und `audio.finalize` für fehlende Chunks am Ende (§10.2) |
| `audio_chunk` | `size_bytes int8` | Antwort `AudioChunk` |
| `photo` | `mime text`, `sha256 text`, `size_bytes int8`, `file_path` erst nach Upload gesetzt | Upload unabhängig von `photo.add` |
| `device` | `kind`: `ipad` \| `iphone`. `clock_offset_ms` nullbar, `NULL` = noch nicht gemessen | 03 §13 lässt die Werte offen |
| `page_element` | `frame jsonb NOT NULL` (`[x, y, w, h]`) | `PageElement.frame` der API |
| `backup_run` | `trigger text`, `stand text NULL` | Anzeige, Name für `sg restore <stand>` |
| `sync_stream` (neu) | `stream text PRIMARY KEY`, `head_seq int8 NOT NULL DEFAULT 0` | Vergabe von `seq` mit Zeilensperre (§11.2) |
| `sync_op` (neu) | `stream text`, `seq int8`, `op_id uuid UNIQUE`, `kind`, `at int8`, `clock_uncertain`, `data jsonb`, `origin`, `device_id NULL`, `received_at`; `UNIQUE (stream, seq)` | Nachlieferung ab `from_seq` und Idempotenz (§11). Aufbewahrung §13 |
| `sync_meta` (neu) | eine Zeile mit `db_epoch uuid` | Epoche für `welcome` (§11.1). `sg restore` setzt sie neu. Die Migration legt die Zeile an |
| `setting` | Schlüssel `general`, `lecture`, `pen`, `data`, Wert je Bereich (§14) | F-EIN-01 |

Die Kopplung braucht **keine Tabelle**. Codes leben nur im Speicher des Core (§12).

Abgeleitete Felder der API, etwa `event_count`, `session_id` am Termin, `planned_starts_at`, `chunk_count`, `page_count`, `has_pkdrawing` und `connected`, sind keine Spalten.

## 7. REST-Endpunkte Phase 1

Basis `/api/v1`, Konventionen aus §5 und 08 §1. Fehlerkörper immer `ApiError`. Für alle Routen gelten außerdem `400 validation_failed`, `401 device_token_required|device_token_invalid` (aus dem Netz), `403 origin_not_allowed` und `421 host_not_allowed`. Mit **lokal** markierte Routen lehnen Anfragen aus dem Netz mit `403 local_only` ab, auch mit gültigem Token.
Listen mit `?cursor&limit` (Standard 50, höchstens 200).

**Lösch-Routen aus Phase 0:** `DELETE /semesters/{id}` (neu mit T1-18), `DELETE /modules/{id}`, `/slide-decks/{id}`, `/exercise-sheets/{id}` rufen `softDelete` (Kaskade §13). `DELETE /modules/{id}` und `DELETE /semesters/{id}` antworten ab T1-18 (Umstellung auf `softDelete`) mit `409 session_active` und `details.session_ids`, wenn die Kaskade eine laufende oder pausierte Session enthält. Dann wird nichts gelöscht.

### 7.1 Kalender (T1-01)

| Methode und Pfad | Body | Antwort | Fehler |
|---|---|---|---|
| `GET /calendar/sources` | – | 200 `CalendarSourceList` | |
| `POST /calendar/sources` | JSON `CalendarSourceCreate` (URL) **oder** multipart `file` (.ics, ≤ 5 MB), `name?` | 201 `IcsImportResult` | 409 `calendar_source_exists` (gleiche URL, `details.id`), 413 `file_too_large`, 422 `ics_invalid`, 502 `ics_fetch_failed` |
| `POST /calendar/sources/{id}/sync` | URL-Quelle: leer. Datei-Quelle: multipart `file` (neue Fassung) | 200 `IcsImportResult` | 404 `calendar_source_not_found`, 422 `ics_invalid`, 502 `ics_fetch_failed` (setzt `last_error`) |
| `DELETE /calendar/sources/{id}` | – | 204 (Kaskade §13) | 404 |
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
| `DELETE /sessions/{id}` | – | 204 (Papierkorb, Kaskade §13) | 404, 409 `session_active` (läuft oder pausiert) |
| `GET /sessions/{id}/snapshot` | – | 200 `SessionSnapshot` | 404 |
| `POST /sessions/{id}/start` | `SessionStartRequest` | 200 `SessionStartResult` | 404, 409 `session_transition_invalid` |
| `POST /sessions/{id}/pause` | – | 200 `Session` | 404, 409 `session_transition_invalid` |
| `POST /sessions/{id}/resume` | – | 200 `Session` | 404, 409 `session_transition_invalid` |
| `POST /sessions/{id}/stop` | `SessionStopRequest` | 200 `Session` | 404, 409 `session_transition_invalid` |
| `POST /sessions/{id}/extend` | `SessionExtendRequest` | 200 `Session` mit neuem `auto_stop_extended_until` | 404, 409 `session_not_active` |

- `state` ist eine Komma-Liste, z. B. `state=laeuft,pausiert` für die aktive Session nach einem Neuladen (F-SES-05).
- Sortierung: aufsteigend nach `coalesce(started_at, planned_starts_at, created_at)`, bei Gleichstand nach `id`.
- `from`/`to` filtern auf denselben Zeitpunkt. Der Heute-Bildschirm (T1-03) fragt `from=<heute 00:00>&to=<morgen 00:00>` ab.

### 7.3 Audio (T1-06)

| Methode und Pfad | Body | Antwort | Fehler |
|---|---|---|---|
| `POST /sessions/{id}/recordings` | `RecordingCreate` | 201 `Recording` | 404 `session_not_found`, 409 `session_not_active`, 409 `recording_exists` |
| `GET /recordings/{id}` | – | 200 `Recording` | 404 `recording_not_found` |
| `PUT /recordings/{id}/chunks/{seq}` | Rohdaten (§10.2) | 201 `AudioChunk`, 200 bei Duplikat | §10.2 |
| `POST /recordings/{id}/complete` | `RecordingComplete` | 200 `Recording` | 404, 409 `recording_seq_conflict` (`last_seq` kleiner als schon empfangene `seq`) |
| `GET /recordings/{id}/audio?from_ms&to_ms` | – | `audio/mp4` mit Range-Unterstützung (ab Phase 2 genutzt) | 404 `audio_not_ready` |

### 7.4 Notizen, Fotos (Core-Ink, T1-14, T1-15, T1-16)

| Methode und Pfad | Body | Antwort | Fehler |
|---|---|---|---|
| `GET /notebooks?module_id` | – | 200 `NotebookList` (ohne gelöschte Notizbücher und ohne Notizbücher gelöschter Module) | |
| `GET /notebooks/{id}` | – | 200 `Notebook` | 404 `notebook_not_found` |
| `POST /notebooks` | `NotebookCreate` | 201 `Notebook` | 404 `module_not_found`, 409 `notebook_kind_exists` (zweites Notizbuch `vorlesung`/`uebung` im Modul) |
| `PATCH /notebooks/{id}` | `NotebookUpdate` | 200 `Notebook`, dazu Operation `notebook.update` (nur bei einer Änderung) | 404 `notebook_not_found`, 404 `module_not_found` (Zielmodul), 409 `notebook_default` („Vorlesung“ und „Übung“ lassen sich umbenennen, aber nicht in ein anderes Modul verschieben) |
| `DELETE /notebooks/{id}` | – | 204, dazu Operation `notebook.delete` | 404, 409 `notebook_default` (die Notizbücher „Vorlesung“ und „Übung“ eines Moduls lassen sich nicht löschen) |
| `GET /notebooks/{id}/pages` | – | 200 `NotebookPages`, sortiert nach `index`, dann `created_at`, dann `id` | 404 |
| `GET /pages/{id}` | – | 200 `PageDetail` | 404 `page_not_found` |
| `GET /pages/{id}/strokes` | – | 200 `PageStrokes`, sortiert nach `created_at`, dann `client_id` | 404 |
| `PUT /pages/{id}/pkdrawing` | Rohdaten `application/octet-stream`, Header `X-Sha256` | 200 `FileReceipt` | 404 `page_not_found` (Upload erst nach dem `ack` von `page.create`), 413 `file_too_large` (50 MB), 422 `checksum_mismatch` |
| `GET /pages/{id}/pkdrawing` | – | Datei | 404 `pkdrawing_not_found` |
| `GET /photos/{id}` | – | 200 `Photo` | 404 `photo_not_found` |
| `PUT /photos/{id}/file` | Rohdaten `image/heic` \| `image/jpeg`, Header `X-Sha256` | 201 `FileReceipt`, 200 bei Duplikat | 409 `photo_file_conflict` (anderes sha256 oder anderer Typ als schon gespeichert bzw. als in `photo.add`), 413 (30 MB), 415 `unsupported_media_type`, 422 `checksum_mismatch` |
| `GET /photos/{id}/file` | – | Datei | 404 `photo_file_missing` |

- **Abweichung von 08 §1:** Statt `POST /photos` (multipart) gibt es `PUT /photos/{id}/file` mit der vom iPad vergebenen `photo_id`. Das ist wiederholbar und passt zu Chunks und `pkdrawing`. Die Metadaten entstehen über die Operation `photo.add`, egal ob vor oder nach der Datei.
- `PUT /photos/{id}/file` für eine noch unbekannte `photo_id` ist erlaubt: Die Datei wird abgelegt, die Zeile entsteht mit `photo.add`. Verwaiste Dateien ohne Zeile räumt `maintenance.nightly` nach 30 Tagen weg.
- Der Upload von `pkdrawing` und Fotos ist auch für weich gelöschte Seiten bzw. Fotos erlaubt (sie kommen mit der Datei aus dem Papierkorb zurück). `GET` liefert für gelöschte Objekte 404. Ein Foto, dessen Typ von `photo.add` abweicht (HEIC hochgeladen, JPEG gemeldet), wird beim Anlegen der Zeile als verwaiste Datei entfernt.
- **`page.index` ist nicht eindeutig.** Das iPad ist der einzige Schreiber und hält die Reihenfolge. Bei Gleichstand gilt die Sortierung oben.
- Der Core legt für jedes Modul die Notizbücher „Vorlesung“ (`vorlesung`) und „Übung“ (`uebung`) an: beim Anlegen des Moduls und, für ältere Module, beim ersten `GET /notebooks?module_id`. Das ist idempotent (F-INK-02).

### 7.5 Geräte, Daten, Einstellungen (T1-10, T1-18, T1-19)

| Methode und Pfad | Body | Antwort | Fehler |
|---|---|---|---|
| `GET /devices` | – | 200 `DeviceList` | |
| `DELETE /devices/{id}` | – | 204. Token sofort ungültig, offene WebSockets des Geräts werden mit Code 4401 geschlossen | 404 `device_not_found` |
| `POST /devices/pairings` (**lokal**) | – | 201 `PairingCode`, öffnet das Kopplungsfenster (§12) | |
| `POST /devices/pair/start` (Netz ohne Token) | `PairStartRequest` | 201 `PairStartResponse` | 409 `pairing_window_closed`, 423 `pairing_locked`, 429 `pairing_rate_limited` |
| `DELETE /devices/pairings/requests/{request_id}` (**lokal**) | – | 204, Anfrage abgelehnt | 404 `pairing_request_not_found` |
| `POST /devices/pair/confirm` (Netz ohne Token) | `PairConfirmRequest` | 201 `PairResponse` | 403 `pairing_code_invalid`, 403 `pairing_request_rejected`, 409 `pairing_window_closed`, 423 `pairing_locked`, 429 `pairing_rate_limited` |
| `GET /backups` | – | 200 `BackupOverview` | |
| `POST /backup` | – | 202 `BackupRun` | 409 `backup_running`, 409 `backup_target_missing` |
| `GET /trash?kind&cursor&limit` | – | 200 `TrashList`, nach `deleted_at` absteigend | |
| `DELETE /trash/{id}` | – | 204. Löscht das direkt gelöschte Objekt samt Teilbaum, Strömen (`sync_op`) und Dateien endgültig | 404 `trash_item_not_found` (auch für mitgelöschte Teile), 409 `session_active` |
| `DELETE /trash?kind` | – | 200 `{ purged_count }` (inline in der Route, kein Schema): leert den Papierkorb, optional nur eine Art | 409 `session_active` |
| `POST /trash/{id}/restore` | – | 200 `TrashRestoreResult` | 404 `trash_item_not_found`, 409 `restore_parent_deleted` (`details.parent`), 409 `restore_conflict` (`details.constraint`, `details.conflicting_id`) |
| `GET /settings` | – | 200 `Settings` | |
| `PATCH /settings` | `SettingsUpdate` | 200 `Settings` | 400 `backup_target_invalid` (Pfad nicht absolut oder nicht beschreibbar) |

Modul-Einstellungen laufen über `PATCH /modules/{id}` (§14.2).

## 8. Kalender: Import und Abgleich (T1-01)

**Der Abgleich ist kein Job.** Der Core erledigt ihn synchron. Begründung:
- Die Einrichtung (F-KAL-04) braucht das Ergebnis mit den Vorschlägen sofort.
- Das Parsen eines Semesters dauert Millisekunden und braucht keine KI.
- Die Logik schreibt nur Core-Tabellen und legt Sessions an (§9.2).

Bibliothek: `ical.js` (Entscheidung des Leads), Begründung und Version im Lockfile mit T1-DB. **Abnahme für T1-01:** Alle Erwartungen in `tests/fixtures/ics/*.json` müssen in einem Core-Test bestehen, inklusive Fall 6b (`TZID=Europe/Zurich` ohne `VTIMEZONE`). Dort wird die Zone als IANA-Name über die zoneinfo-Daten der Laufzeit aufgelöst (`Intl` in Node bzw. ein Paket mit IANA-Daten), nicht als UTC oder floating.

Zeitplan: URL-Quellen beim Core-Start und danach alle 6 h. Datei-Quellen nur bei neuem Upload.

**URL-Abruf:** nur `http`/`https` (`webcal://` wird zu `https://`). Höchstens 5 MB, 15 s Gesamtzeit und 3 Weiterleitungen, und zwar nur auf `http`/`https`. Bei Verstoß: `502 ics_fetch_failed` mit `details.reason` (`too_large`, `timeout`, `too_many_redirects`, `status_<code>`).

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
- Nach jeder Änderung von Zuordnung oder Termin ruft der Kalender `ensurePlannedSessions` auf (§9.2, §16.2).

## 9. Sessions (T1-02)

### 9.1 Zustandsautomat (F-SES-01)

| Von | Auslöser | Nach | Wer | Nebenwirkung |
|---|---|---|---|---|
| `geplant` | 15 min vor `planned_starts_at` | `bereit` | Core-Takt (jede Minute) | Ereignis `session.updated` |
| `geplant`, `bereit` | `planned_ends_at` vorbei, nie gestartet | `verpasst` | Core-Takt | `session.updated` |
| `geplant`, `bereit` | `start` (REST oder `session.start`) | `laeuft` | Mac, iPad | `started_at`, `started_from`. Eine andere aktive Session wird vorher beendet (siehe unten) |
| `verpasst` | nachgelieferter `session.start` mit `started_at < planned_ends_at` | `laeuft` | iPad | wie oben. Der Offline-Start lag vor dem Terminende, `verpasst` war nur eine Folge der fehlenden Verbindung |
| `laeuft` | `pause` | `pausiert` | Mac, iPad | |
| `pausiert` | `resume` | `laeuft` | Mac, iPad | |
| `laeuft`, `pausiert` | `stop` (manuell oder Auto-Stopp aus dem Browser) | `beendet` | Mac, iPad | `ended_at`, `stop_reason`, Jobs `audio.finalize` (§3) |
| `laeuft`, `pausiert` | Start einer **später** begonnenen Session | `beendet` | Core | `stop_reason = kalenderende`, `ended_at = min(planned_ends_at, started_at der neuen Session)` |
| `laeuft`, `pausiert` | Core-Takt: Auto-Stopp-Regel 2 oder 4 greift, obwohl der Browser nicht gestoppt hat (§9.4) | `beendet` | Core | `stop_reason = kalenderende` bzw. `maximaldauer`. `ended_at` ist die **überschrittene Grenze** (bzw. `auto_stop_extended_until`, falls später), nicht die Zeit des Takts |
| `laeuft`, `pausiert` | Core-Start, und die Grenze der vorigen Zeile lag in der Zeit, in der der Core nicht lief | `beendet` | Core | `stop_reason = absturz_wiederhergestellt`, `ended_at` = letzte Aktivität (Ende des letzten Chunks oder `at` der letzten Operation, mindestens `started_at`) |
| `beendet` | alle Jobs der Session fertig | `verarbeitet` | Worker (§3) | Wurde beim Stopp kein Job angelegt, setzt der Core sofort `verarbeitet` |

- **Server-Operationen:** Jeder Übergang nach `laeuft`, `pausiert` oder `beendet`, den der Core selbst auslöst oder per REST ausführt, steht als `session.start`/`.pause`/`.resume`/`.stop` mit `origin = server` im Strom der Session. `bereit`, `verpasst` und `verarbeitet` haben keine Operation, sie kommen nur als Ereignis `session.updated`.
- **Nachgelieferter Stopp korrigiert den Takt:** Kommt nach einem Stopp durch Core-Takt oder Core-Start (`kalenderende`, `maximaldauer`, `absturz_wiederhergestellt` mit `origin = server`) ein `session.stop` eines Geräts mit **früherem** `at`, übernimmt der Core dessen `ended_at` und `stop_reason`. Das ist eine Korrektur ohne Zustandswechsel, mit `session.updated`. Ein späterer `at` ändert nichts (gleicher Zielzustand).
- **Gleicher Zielzustand ist kein Fehler:** `start` auf `laeuft`, `pause` auf `pausiert`, `resume` auf `laeuft` und `stop` auf `beendet`/`verarbeitet` liefern 200 bzw. `ack` ohne Änderung. Das fängt den Doppel-Tipp an Mac und iPad ab.
- **Jeder andere Übergang** wird abgelehnt: `409 session_transition_invalid` mit `details: { state, action }`. Im Sync: `error` mit gleichem Code, `retryable = false`.
- **Invariante 1** gilt für `laeuft` **und** `pausiert` zusammen: höchstens eine aktive Session.
- `beendet` und `verarbeitet` lassen sich nicht wieder starten. Eine verpasste Vorlesung ohne Offline-Start bekommt Aufnahmen über den Import (F-SES-06, Phase 2).
- **Core-Neustart:** `laeuft` bleibt `laeuft` (F-SES-05), solange die Grenzen aus Auto-Stopp-Regel 2 und 4 nicht überschritten sind. Der Core-Takt prüft sie beim Start und danach jede Minute.
- **Session-Daten in jedem Zustand:** `slide.change`, `marker.add` und `photo.add` nimmt der Core in **jedem** Zustand an, auch nach `beendet` (verspätet gesendete Daten aus der Warteschlange). Ist die Session weich gelöscht, gilt §11.2 (Speichern mit Löschzustand).

### 9.2 Woher Sessions kommen

- **Aus dem Kalender:** Der Core legt für jeden nicht abgesagten Termin der Art `vorlesung`, `uebung` oder `tutorium` mit Modul eine Session `geplant` an. Das passiert beim Abgleich und wenn ein Termin später ein Modul bekommt. Sie ist idempotent über `UNIQUE (calendar_event_id)`. `module_id` folgt der Zuordnung, solange die Session nicht gestartet wurde.
- **Abgesagt:** Wird ein Termin abgesagt oder verliert er sein Modul, löscht der Core die Session weich, solange sie nie gestartet wurde. Gestartete Sessions bleiben unverändert.
- **Spontan (F-SES-04):** `POST /sessions` legt eine Session in `bereit` an, ohne `planned_*`. Sie wird darum nie `verpasst`.
- **Offline auf dem iPad:** `session.start` mit unbekannter `session_id` legt die Session an.
  - Ohne `calendar_event_id`: spontane Session.
  - Mit `calendar_event_id` und einer **nie gestarteten** Session desselben Termins: Die neue ersetzt sie, die alte wird weich gelöscht. `slide_deck_id` der alten Session geht auf die neue über (falls die neue keins hat). Foliensätze mit `slide_deck.session_id` der alten zeigen danach auf die neue. `number` wird übernommen.
  - Mit `calendar_event_id` und einer Session desselben Termins, die **läuft oder lief**: `error session_superseded` (`retryable = false`, `fatal = true`, `details.session_id` = bestehende Session). Der Server **schließt die Verbindung** mit Code 4409 und verarbeitet danach nichts mehr. Damit kann keine Folge-Operation mit der alten ID ankommen. Der Client schreibt **alle** unbestätigten Operationen auf die bestehende ID um (Strom `session:<id>`, `session_id` in allen Daten, auch `page.session_id` in `page.create`/`page.update`), verbindet neu und sendet erneut. Der erneute `session.start` trifft dann §9.3.
- **Weich gelöschte Session:** `session.start` (und `pause`/`resume`/`stop`) auf eine weich gelöschte Session wird bestätigt, ändert aber nichts am Zustand. Die Session bleibt gelöscht. Ihre Session-Daten werden nach §11.2 mit Löschzustand gespeichert und kommen mit ihr aus dem Papierkorb.
- **Nachgelieferter Start beendet nie eine spätere Session:** Ist beim Eintreffen eines `session.start` schon eine **andere** Session aktiv, die **später** gestartet wurde, startet der Core die nachgelieferte Session und beendet sie sofort wieder: `stop_reason = kalenderende`, `ended_at = started_at` der aktiven Session. Beide Übergänge stehen als Server-Operationen im Strom. Wurde die aktive Session **früher** gestartet, gilt die normale Zeile aus §9.1.
- **`number` (VL 7):** Bei Sessions zu Terminen der Art `vorlesung` die Position in zeitlicher Reihenfolge unter den nicht abgesagten `vorlesung`-Terminen desselben Moduls. Der Core rechnet sie bei jedem Abgleich neu, solange die Session nicht gestartet wurde, danach bleibt sie fest. Sonst `null`.
- **Folien:** Wird ein Foliensatz mit `session_id` hochgeladen und hat die Session noch kein `slide_deck_id`, setzt der Core es. Ohne Folien läuft der folienlose Modus (F-SES-02).
- **Sitzungszeit:** `t_ms = Ereigniszeit − started_at`. Pausen ändern sie nicht.

### 9.3 Abweichender Offline-Start

Startet ein Gerät eine Session offline, während sie auf dem Server schon mit anderem `started_at` gestartet wurde, gilt:

- **Das `started_at` des Servers bleibt.** `session.start` auf `laeuft`/`pausiert` wird wie in §9.1 ohne Zustandsänderung bestätigt. Auf `beendet`/`verarbeitet` bleibt es ein `session_transition_invalid`.
- **Die `t_ms` der Operationen dieses Geräts rechnet der Core nicht um.** Sie bleiben, wie das Gerät sie bezogen auf sein eigenes `started_at` berechnet hat.
- In beiden Fällen speichert der Core in `session.start_offsets` einen Eintrag `{ device_id, offset_ms }`, falls die beiden Startzeiten voneinander abweichen. Dabei ist `offset_ms` = `started_at` aus der Operation − `started_at` der Session (in ms). Pro Gerät gibt es höchstens einen Eintrag, der erste gilt **dauerhaft**.
- Die Ausrichtung in Phase 2 rechnet damit um: Sitzungszeit nach Serveruhr = `t_ms + offset_ms`. Das betrifft `t_start_ms`/`t_end_ms` der Striche, `t_ms` von Folienwechseln, Markern, Fotos und Seitenelementen.
- `device_id` kommt aus der Verbindung (Token). Die Web-App startet nur per REST mit Serverzeit und erzeugt darum keinen Eintrag.

### 9.4 Auto-Stopp und Verlängerung (F-SES-03, T1-07)

| Regel (F-SES-03) | Auslöser | `stop_reason` | Wer prüft |
|---|---|---|---|
| 1 | Kalenderende + `auto_stop_after_end_min` und `auto_stop_quiet_window_min` ohne Sprache | `kalenderende` | Browser |
| 2 | Kalenderende + `auto_stop_hard_after_end_min` | `kalenderende` | Browser, Core-Takt als Rückfallebene |
| 3 | Stille ≥ `auto_stop_silence_min` außerhalb der Pause | `stille` | Browser |
| 4 | `started_at` + `auto_stop_max_duration_min` | `maximaldauer` | Browser, Core-Takt als Rückfallebene |

- Spontane Sessions kennen nur die Regeln 3 und 4.
- **Verlängern:** Der Tipp auf „weiter aufnehmen“ ruft `POST /sessions/{id}/extend` auf. Der Core setzt `auto_stop_extended_until = max(jetzt, bisheriger Wert) + minutes` (Standard `lecture.auto_stop_extend_min`). Vor diesem Zeitpunkt stoppt **keine** Regel, weder im Browser noch im Core-Takt. Danach gelten die Regeln normal weiter. Das Ereignis `session.updated` informiert die anderen Clients.

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

- Die Web-App löscht einen Chunk aus IndexedDB erst nach 200 oder 201. Bei 409 oder 422 versucht sie es **nicht** erneut, sondern verschiebt den Chunk in ihre Fehlerablage (§11.2) und meldet ihn. Bei 5xx und Netzfehlern wiederholt sie mit exponentiellem Warten bis 30 s.
- Nach dem letzten Chunk: `POST /recordings/{id}/complete` mit `last_seq` und `duration_ms`. Fehlt eine `seq ≤ last_seq` beim Finalisieren, wird die Aufnahme `mit_luecken`.

## 11. Sync-Protokoll (T1-08, T1-09)

Ergänzt 08 §2. Alle Nachrichten: `SyncClientMessage` bzw. `SyncServerMessage`. Eine Nachricht = ein Text-Frame mit einem JSON-Objekt, höchstens 1 MB.

### 11.1 Verbindung und Anmeldung

- **Pfad:** `ws://<mac>:4710/sync`, außerhalb von `/api/v1`, aber eine **Netzroute** wie alle anderen (§5).
- **Prüfung beim Upgrade** (vor dem Wechsel auf WebSocket, Ablehnung als HTTP-Antwort):
  - Host-Prüfung (`421`) und **Origin-Prüfung** (`403`) wie §5. Browser senden beim Upgrade immer `Origin`. Eine fremde Webseite darf sich nicht über `localhost` verbinden (Cross-Site WebSocket Hijacking).
  - **Aus dem Netz:** `Authorization: Bearer <device_token>` ist Pflicht (`401 device_token_required|device_token_invalid`). `URLSessionWebSocketTask` setzt den Header über den `URLRequest`.
  - **Lokal** (Web-App): ohne Token.
- **Kein Token in `hello`.** `hello.device_id` ist optional und dient nur als Gegenprobe. Passt sie nicht zum Token: `error device_token_invalid` (fatal), Code 4401.
- **Erste Nachricht** muss innerhalb von 5 s `hello` sein, sonst `error hello_required` und Schließen mit Code 4408. `protocol` ≠ 1: `error protocol_unsupported` (fatal), Code 4426.
- **Antwort** `welcome` mit `server_time`, `db_epoch` und je Strom einem `resume`-Eintrag. Danach sendet der Server:
  1. die fehlenden Operationen jedes Stroms ab `from_seq` bis `head_seq` in `seq`-Reihenfolge,
  2. die aktuellen `presence`- und `device.connection`-Ereignisse der anderen Clients.
- **Resume-Fälle** je Strom aus `hello.streams` bzw. `subscribe`:

| Client meldet | Server hat | Antwort |
|---|---|---|
| `last_seq = 0`, `last_op_id = null` | beliebig | `from_seq = 1`, `reset = false` |
| `last_seq = n`, `last_op_id = x` | Operation `n` mit `op_id = x` | `from_seq = n + 1`, `reset = false` |
| `last_seq = n` | `head_seq < n`, oder Operation `n` hat eine andere `op_id` | `from_seq = 1`, `reset = true`. Für diesen Strom sendet der Server **nichts** |

- **`last_seq = 0`** meldet ein Client nur für Ströme, die er selbst gerade anlegt (neues Notizbuch, neue Session) oder die nachweislich leer sind. Für einen bestehenden Strom ohne lokalen Stand lädt er **zuerst per REST** und abonniert dann mit `last_seq = stream_seq` und `last_op_id = stream_op_id`. Ein vollständiges Abspielen ab `seq = 1` ist so die Ausnahme. Der Server liefert es aber, wenn danach gefragt wird.
- **`db_epoch`** ändert sich bei jeder Wiederherstellung (`sg restore` schreibt eine neue Zufalls-UUID in `sync_meta`). Weicht sie vom zuletzt gespeicherten Wert ab, behandelt der Client **alle** Ströme wie `reset`, auch solche, die er nicht in `hello` gemeldet hat.
- **Bei `reset`** verwirft der Client seine Daten **nicht**. Stattdessen:
  1. Er lädt den Strom per REST (`NotebookPages` + `PageStrokes`/`PageDetail` bzw. `SessionSnapshot`).
  2. Er gleicht den lokalen Stand damit ab. Was er selbst angelegt hat und dem Server fehlt (Seiten, Striche, Elemente, Marker, Folienwechsel, Fotos), sendet er als neue Operationen mit neuer `op_id` erneut. Das ist idempotent über die eigenen IDs (`stroke.add` ist Upsert, Marker über `marker_id`). Was er lokal gelöscht hat und der Server noch hat, entfernt er mit `stroke.remove` bzw. `element.remove`.
  3. Danach abonniert er den Strom mit `last_seq = stream_seq` und `last_op_id = stream_op_id` des Snapshots. Unbestätigte Operationen aus der Warteschlange sendet er wie gewohnt.
- **Ströme** entstehen implizit. Ein unbekannter Strom hat `head_seq = 0`. `subscribe`/`unsubscribe` ändern Abos ohne neue Verbindung. Schreiben darf ein Client in jeden Strom, Weitergaben bekommt er nur für abonnierte.
- **Phase 1:** Der Strom `user` trägt noch keine Operationen. Server-Ereignisse gehen ohne `seq` an die Clients (§11.6).
- **Snapshot und Strom zusammensetzen:** REST-Antworten mit `stream_seq` (`SessionSnapshot`, `NotebookPages`, `PageStrokes`, `PageDetail`) tragen auch `stream_op_id`, die `op_id` der Operation `stream_seq` (`null` bei 0). Der Core liest beides in **einer** Transaktion mit `REPEATABLE READ` zusammen mit den Daten. Der Client wendet danach nur Operationen mit `seq > stream_seq` an und abonniert mit genau diesem Paar. So passt die Prüfung aus der Resume-Tabelle, und es entsteht keine Reset-Schleife.

### 11.2 Operationen, `seq` und `ack`

- `at` ist die synchronisierte Zeit, **zu der die Operation auf dem Gerät entstanden ist**, nicht der Sendezeitpunkt. Verspätet gesendete Operationen behalten `at` und `t_ms` (08 §2.3).
- Der Server prüft jede Operation gegen `SyncOp`. **`seq` und `origin` setzt nur der Server.** Schickt ein Client sie mit, folgt `error message_invalid` (`retryable = false`). Stimmen Strom und Inhalt nicht überein, etwa `stroke.add` auf eine Seite eines anderen Notizbuchs oder `marker.add` mit anderer `session_id` als der Strom, folgt `error stream_mismatch`. Server-Operationen (`notebook.update`, `notebook.delete`, `notebook.restore`, `page.restore`) von einem Client ergeben `error op_not_allowed`.
- **Vergabe von `seq`:** In derselben Transaktion wie die fachliche Änderung: `sync_stream`-Zeile des Stroms mit `SELECT … FOR UPDATE` sperren (bzw. anlegen), `head_seq + 1` vergeben, `sync_op` schreiben, Kopf hochzählen, Commit. So ist `seq` pro Strom lückenlos und die Reihenfolge entspricht der Commit-Reihenfolge.
- **Reihenfolge:** Der Server verarbeitet die Operationen einer Verbindung strikt in Empfangsreihenfolge, eine nach der anderen. Auch das `ack` geht über dieselbe geordnete Auslieferung nach dem Commit (Hook `onOpCommitted`, §16.2) wie die Weitergaben. So kommt `ack n+1` beim Client nie vor der Operation `n` eines anderen Absenders an. Pro Verbindung gehen `ack` und Weitergaben eines Stroms **in `seq`-Reihenfolge** raus, auch wenn Commits anderer Verbindungen dazwischenliegen. Die Weitergabe an andere Abonnenten trägt `seq` und `origin`. Der Absender bekommt seine eigene Operation nicht zurück.
- **`last_seq`** ist beim Client die höchste `seq`, bis zu der er **lückenlos** alle Operationen erhalten und angewendet hat (eigene über `ack`, fremde über Weitergabe). Sieht er eine Lücke, wartet er kurz und abonniert bei Bedarf neu ab `last_seq`.
- **Idempotenz:** Ist eine `op_id` schon bekannt, sendet der Server das ursprüngliche `ack` erneut. Gleiche `op_id` mit anderem `stream`, `kind` oder `data` ergibt `error op_id_reused` (`retryable = false`).
- **Wiederholbare Fehler gelten für die Verbindung.** `too_many_pending`, `internal_error` und jeder andere Fehler mit `retryable = true` kommen immer mit `fatal = true`. Der Server **schließt die Verbindung** danach mit Code 4503 und verarbeitet keine weiteren Nachrichten dieser Verbindung. Der Client verbindet neu und sendet ab der betroffenen Operation in der Originalreihenfolge. So kann keine spätere Operation eines Stroms vor einer früheren ankommen.
- **„Unbestätigt“** heißt beim Server: auf **dieser Verbindung** empfangen und noch nicht mit `ack` oder `error` beantwortet. Ein Client, der höchstens 200 Operationen ohne Antwort im Flug hat, bekommt `too_many_pending` also nie.
- **Wartezeit nach 4503:** Der Client wartet vor dem Neuverbinden exponentiell (1 s, 2 s, 4 s … höchstens 30 s, mit Zufallsanteil). Nach einem `ack` beginnt die Folge von vorn.
- **Giftige Operation:** Scheitert dieselbe `op_id` 5-mal mit `internal_error`, verschiebt der Client sie samt abhängigen Operationen in die Fehlerablage und zeigt das an. Danach sendet er die übrigen weiter. So blockiert eine Operation die Warteschlange nicht auf Dauer.
- **Kein Zurückhalten.** Die Reihenfolge pro Verbindung ist garantiert, und der Client sendet Eltern immer vor Kindern (Notizbuch vor Seite vor Strich, `session.start` vor Markern).
- **Weich gelöschte Eltern** (Notizbuch, Seite, Session, Modul): Inhalts-Operationen werden **angenommen und bestätigt**. Das gilt auch für `notebook.create` in ein gelöschtes Modul. Das neue bzw. per Upsert geänderte Objekt bekommt den `deleted_at` des gelöschten Elternobjekts (auch ein `stroke.add` auf einer gelöschten Seite, nicht `NULL`) und kommt mit ihm aus dem Papierkorb zurück (§13).
- **Eltern nicht (mehr) vorhanden**, also nie angelegt oder schon endgültig gelöscht: nicht wiederholbarer Fehler (`module_not_found`, `notebook_not_found`, `page_not_found`, `session_not_found`).
- **Notizbuch-Strom:** `notebook.create` läuft im Strom des **neuen** Notizbuchs, also `notebook:<notebook_id>`. Darum stehen Anlegen und alle folgenden `page.create` dieses Notizbuchs im selben Strom, in fester Reihenfolge. Andere Clients erfahren neue Notizbücher, weil sie den Strom abonnieren, sobald sie die ID per REST (`GET /notebooks`) oder aus `presence` kennen.

**Client-Pflichten (iPad und Web)**
- Ausgangswarteschlange append-only, Senden in Entstehungsreihenfolge, Eltern vor Kindern.
- Nach dem Verbinden zuerst Uhrabgleich (§11.5), dann die Warteschlange in Paketen bis 200 (F-SYN-03).
- `ack` → Operation aus der Warteschlange entfernen.
- `error` mit `op_id` und `retryable = false` → diese Operation **und alle davon abhängigen** wandern in eine lokale **Fehlerablage**. Abhängig ist jede Operation, die eine ID verwendet, die erst durch die abgelehnte Operation entstanden wäre, transitiv. Beispiel: `page.create` abgelehnt, also alle Operationen mit dieser `page_id`. Ausnahmen:
  - `session_superseded`: Warteschlange umschreiben und neu verbinden (§9.2).
  - `page_version_conflict`: Seite per REST neu laden, die eigenen geänderten Felder auf den Serverstand legen und mit dessen `version` erneut senden. Mehrere Offline-Änderungen einer Seite zählen `version` lokal hoch, jede beruht auf der vorigen.
- Die Fehlerablage wird **nie automatisch gelöscht**. Sie ist sichtbar: iPad unter Einstellungen → Sync, Web in der Statusleiste mit Zähler. Sie lässt sich als JSON exportieren (iPad über das Teilen-Menü an den Mac, Web als Datei-Download). **Bewusste Lücke in Phase 1:** Es gibt kein Wiedereinspielen. Ein Export wird bei Bedarf von Hand ausgewertet.
- `error` mit `retryable = true` → Verbindung ist zu, nach der Wartezeit neu verbinden und ab dieser Operation erneut senden.
- **Unbekannte Server-Nachrichten:** Unbekannte Operationen (`kind`) und bekannte Operationen mit unbekannten Enum-Werten (neuere Server-Version) überspringt der Client, **zählt ihre `seq` aber als empfangen**. Sonst entstünde eine Lücke und ein endloses Neu-Abonnieren. Unbekannte Nachrichtentypen und Ereignisse ignoriert er.

### 11.3 Wirkung der Operationen

| `kind` | Wirkung im Core |
|---|---|
| `notebook.create` | Freies Notizbuch anlegen (`kind` nur `frei`). `created_at` aus den Daten. Strom muss `notebook:<notebook_id>` sein, sonst `stream_mismatch`. Existiert die `notebook_id` schon: `ack` ohne Änderung. Unbekanntes Modul: `module_not_found` |
| `notebook.update` / `.delete` / `.restore` | **Nur Server.** Nach `PATCH`/`DELETE /notebooks/{id}` bzw. Wiederherstellung aus dem Papierkorb. Bei `delete` blenden Clients das Notizbuch aus, bei `restore` laden sie es per REST neu |
| `page.create` | Seite anlegen, `version = 1`, `created_at = at` der Operation. `width_pt`/`height_pt` müssen im float4-Bereich liegen (Betrag ≤ 3,4e38), sonst `message_invalid`. Strom muss `notebook:<notebook_id>` sein. Existiert die `page_id` schon: `ack` ohne Änderung. Unbekanntes Notizbuch: `notebook_not_found` |
| `page.update` | `fields` (vollständiger Stand) übernehmen, wenn `version` der aktuellen entspricht, dann `version + 1`. Sonst `error page_version_conflict` (`retryable = false`). Der Client verfährt wie in §11.2 (neu laden, Felder auflegen, erneut senden) |
| `page.delete` | Seite mit Strichen und Elementen weich löschen (gleiches `deleted_at`). Vom iPad oder als Server-Operation |
| `page.restore` | **Nur Server**, nach Wiederherstellung aus dem Papierkorb. Clients laden die Seite per REST neu |
| `stroke.add` | **Upsert** über `(page_id, client_id)`, letzter Stand gewinnt. Ein gelöschter Strich wird dabei wiederbelebt. Lasso, Umfärben und Skalieren schicken nur `stroke.add` mit gleicher `client_id` (08 §4.3). Ungültige Striche ergeben `message_invalid` (`retryable = false`): `points` kein Base64, kein ganzes Vielfaches von 24 Byte, leer, über 750 000 Byte oder mit NaN/Unendlich; `width`, `transform` und `bbox` nicht endlich oder außerhalb von float4 (Betrag ≤ 3,4e38), `width ≤ 0`. `clock_uncertain` aus dem Umschlag wird in `stroke.clock_uncertain` gespeichert, `created_at` (ms) als `timestamptz` |
| `stroke.remove` | `deleted_at` setzen. Unbekannte `client_id` werden ignoriert |
| `element.upsert` / `element.remove` | Upsert über `element_id` bzw. weich löschen. Liegt die `element_id` schon auf einer anderen Seite, folgt `stream_mismatch` (nie stillschweigend verschieben) |
| `drawing.snapshot` | Hinweis an andere iPads, dass `PUT /pages/{id}/pkdrawing` mit diesem sha256 hochgeladen wurde. Der Core bestätigt immer. Ob die Datei vorliegt, zeigt `Page.has_pkdrawing` |
| `session.start` / `.pause` / `.resume` / `.stop` | wie die REST-Aktionen (§9). `started_at` aus den Daten bzw. `ended_at = at`, nicht die Serverzeit. Sonderfälle in §9.2 und §9.3 |
| `slide.change` | `slide_event` anlegen, `source` aus `device` (`manuell_mac`/`manuell_ipad`). Idempotent über `event_id` |
| `marker.add` / `marker.remove` | Marker anlegen bzw. weich löschen. Idempotent über `marker_id`: Existiert er schon, `ack` ohne Änderung. Unbekannter Marker beim Entfernen: `ack` |
| `photo.add` | Handler gehört Core-Ink (§16.3), wie `PUT /photos/{id}/file`. `photo`-Zeile anlegen, `has_file` aus der Ablage. Idempotent über `photo_id`. `file_ref.mime` ist laut Schema nur `image/heic` oder `image/jpeg`. Kommt die Datei später, prüft der Core sha256 und Typ gegen `file_ref` |

Im Sync gibt es **keine Felder, die zugleich optional und nullbar sind**. Was in 08 §2.3 mit `?` markiert ist, ist ein Pflichtfeld mit Wert `null`. `page.update` und `notebook.update` tragen darum den vollständigen Stand der änderbaren Felder (§11.7).

### 11.4 Keepalive

Der Client sendet alle 15 s `ping`, der Server antwortet mit `pong`. Bleibt die Antwort 45 s aus, trennt der Client und verbindet neu. Er wartet dabei exponentiell länger, höchstens 30 s. Der Server schließt Verbindungen, von denen 60 s nichts kam.

### 11.5 Uhrabgleich (F-SYN-02, T1-09)

- Nach `welcome` sendet der Client 5 × `time.ping` nacheinander. Jedes nächste geht erst nach dem `time.pong` des vorigen raus. **Erst danach** sendet er die Warteschlange.
- Versatz = Median von `ts − (t0 + t1) / 2`, mit `t1` = lokale Empfangszeit. Ergebnis per `time.offset` an den Server, der es in `device.clock_offset_ms` speichert. Das wiederholt sich alle 5 min.
- **Synchronisierte Zeit** = lokale Uhr + Versatz. Ohne gemessenen Versatz gilt Versatz 0 und `clock_uncertain = true`.
- **Korrektur noch nicht gesendeter Operationen** mit `clock_uncertain = true`, sobald ein Versatz vorliegt (02 §5):
  - `at`, `stroke.created_at` und `session.start.started_at` immer korrigieren.
  - `t_*` (Sitzungszeiten) **nur**, wenn sie gegen ein `started_at` einer **fremden Uhr** gerechnet wurden, also gegen eine Session, die Server oder Mac gestartet haben. Hat das Gerät die Session selbst gestartet, stammen Ereignis und Start von derselben Uhr, und die Differenz stimmt schon.
  - Danach `clock_uncertain = false`. Gesendete Operationen werden nicht nachträglich korrigiert.
- `start_offsets` (§9.3) gelten pro Gerät dauerhaft für die Session.
- Die Web-App läuft auf dem Mac des Cores und nutzt Versatz 0. Den Abgleich macht sie trotzdem, um Fehler zu erkennen.

### 11.6 Anwesenheit und Server-Ereignisse

- Das iPad sendet `presence` bei jedem Wechsel von Session, Notizbuch oder Seite. Der Server gibt das als Ereignis `presence` an alle anderen weiter. Die Notizen-Spalte folgt `page_id` des iPads (F-DSH-04).
- `device.connection` geht bei jeder An- und Abmeldung eines Clients raus (iPad-Punkt in der Statusleiste, F-DSH-06).
- `session.updated` geht bei jeder Änderung einer Session raus, auch bei zeitgesteuerten und vom Worker gemeldeten (§3, `pg_notify('sg_session', …)`).
- `pairing.requested` geht **nur an lokale Web-Clients** (§12).
- Ereignisse werden nicht nachgeliefert. Wer neu verbindet, holt den Stand per REST (`GET /sessions`, `GET /devices` mit `connected`).

### 11.7 Swift (iPad): Pflichten und Hilfsschicht

quicktype fasst Unions zu einem Struct mit optionalen Feldern zusammen. Außerdem lässt synthetisiertes `Codable` `nil` weg. Darum gilt für die iPad-App:

1. **Hilfsschicht nutzen:** `packages/schemas/swift-support/Sources/SyncMessages.swift` zusammen mit `generated/swift/Schemas.swift` übernehmen. Sie decodiert Nachrichten zuerst über `type`/`kind`/`name` und dann die passende Variante (`SGServerMessage`, `SGClientMessage`, `SGSyncOp`, `SGSyncEvent`, `SGPageElement`). Nie die zusammengefassten Structs `SyncOp`, `SyncServerMessage`, `PageElement` usw. zum Kodieren verwenden.
2. **Pflichtfelder mit `null` explizit kodieren:** `gen.mjs` erzeugt dafür je Struct ein `encode(to:)`. Pflichtfelder (auch nullbare) kommen per `encode`, optionale per `encodeIfPresent`. Verschachtelte Unions (`element` in `element.upsert`) laufen über die Hilfsschicht (`SGElementUpsertOp`).
3. **Datum:** Immer `newJSONDecoder()`/`newJSONEncoder()` aus `Schemas.swift` bzw. `SGSync.decoder()`/`encoder()` verwenden. Sie lesen ISO 8601 mit und ohne Sekundenbruchteile und schreiben UTC mit `Z`, Millisekunden nur, wenn sie nicht 0 sind. `.iso8601` allein kann keine Millisekunden.
4. **Unbekanntes ignorieren:** Unbekannte `type`, `kind` oder `name` ergeben `.unknown` und einen Eintrag über `SGSync.log`, keinen Fehler. Eine bekannte Operation, die sich nicht decodieren lässt (z. B. neuer Enum-Wert), ergibt ebenfalls `SGSyncOp.unknown(kind, stream, seq)`. Der Client zählt deren `seq` trotzdem mit (§11.2).
5. **Fehlercodes als String:** Unbekannte `SyncErrorCode` ergeben `.unknownError(SGUnknownSyncError)` mit `code` als String, `retryable` und `fatal`.
6. **UUIDs klein:** `UUID().uuidString` liefert Großbuchstaben, darum immer `.lowercased()`.

Nachweis: CI-Job **Swift-Contract** (`bash packages/schemas/swift-support/check.sh`). Er kompiliert `Schemas.swift` mit der Hilfsschicht und decodiert alle gültigen Beispiele der Sync-Typen, `Stroke` und `PageElement`, der REST-Typen des iPads (`Device`, `DeviceList`, `PairStartResponse`, `PairResponse`, `Notebook`, `NotebookList`, `NotebookPages`, `Page`, `PageStrokes`, `PageDetail` über `SGPageDetail`, `Session`, `SessionList`, `SessionSnapshot`, `Settings`, `FileReceipt`) sowie `tests/fixtures/strokes/*.json`. Dann kodiert er sie wieder und vergleicht sie mit dem Original, `null`-Felder und Millisekunden eingeschlossen. Dazu prüft er das Ignorieren unbekannter Nachrichten und Fehlercodes.

### 11.8 Mehrere Browser-Tabs (Web-Sync-Client)

Nur **ein** Tab synchronisiert: Er hält die Verbindung, sendet die Warteschlange und empfängt Operationen und Ereignisse.
- **Leader** ist der Tab, der das Lock (`navigator.locks`) hält. Ohne Web Locks ist ein Tab immer Leader.
- `connect()` löst auf, sobald die Rolle feststeht. Bis dahin ist der Zustand `acquiring`. Liegt das Lock nachweislich in einem anderen Tab, ist er `other_tab`.
- **Folge-Tabs synchronisieren nicht.** Sie schreiben nichts in die Warteschlange und abonnieren nichts. `send()` wirft dort `SyncNotLeaderError`, ohne `connect()` `SyncNotConnectedError`.
- **Hier übernehmen** (`takeOver()`, Web Locks `steal`): Der alte Leader trennt sauber und zeigt `other_tab`. Seine offenen `send()`-Aufrufe enden mit `SyncHandedOverError` (die Operation liegt in der Warteschlange und wird vom neuen Leader gesendet, **nicht neu senden**) bzw. `SyncNotLeaderError` (noch nicht gespeichert). Der neue Leader liest die Warteschlange vollständig aus der IndexedDB. Schließt der Leader-Tab, übernimmt der wartende Tab.
- Der `BroadcastChannel` meldet nur „Leader hat gewechselt“ (Client-Ereignis `leader.changed`; der Fachcode lädt seinen Stand per REST neu). Operationen werden nicht zwischen Tabs weitergeleitet.

## 12. Kopplung (F-INK-13, T1-10)

1. **Kopplungsfenster öffnen (nur am Mac):** Die Web-App (Einstellungen → Geräte) ruft `POST /devices/pairings` auf. Das geht **nur lokal**.
   - Es gibt höchstens **ein** offenes Fenster. Ein neuer Aufruf ersetzt das alte und hebt eine Sperre (Schritt 5) auf.
   - Das Fenster gilt 5 min.
   - Die Antwort `PairingCode` zeigt die Web-App als QR-Code (`qr_url`) und als Text (Code, `host`, `port`).
   - QR-Inhalt, festes Format: `sg://pair?v=1&host=<host>&port=<port>&pairing_id=<uuid>&code=<6 Ziffern>`. Das sind genau dieselben Daten wie im Text.
   - `host` ist die IPv4-Adresse der aktiven Netzwerkschnittstelle des Macs (bevorzugt `en0`), weil `.local`-Namen im Uni-WLAN oft nicht auflösen.
2. **Bonjour-Weg:** Der Core kündigt `_studiengehirn._tcp` an (TXT `v=1`, `name=<Macname>`). Das iPad ruft `POST /devices/pair/start` auf.
   - Das geht nur bei offenem Fenster, sonst `409 pairing_window_closed`. Es belegt das Fenster **nicht exklusiv**: Mehrere Anfragen sind möglich.
   - Der Core legt eine Anfrage (`PairingRequest`) mit `device_name` und `public_nonce` an und antwortet mit `request_id` und `pairing_id`. Der Code steht **nicht** in der Antwort.
   - Die Web-App bekommt `pairing.requested` und listet die Anfragen. Eine fremde Anfrage kann der Nutzer ablehnen (`DELETE /devices/pairings/requests/{request_id}`, nur lokal).
3. **Bestätigen:** Der Nutzer tippt den Code am iPad ein, oder der QR-Scan liefert `pairing_id` und Code. Das iPad ruft `POST /devices/pair/confirm` auf.
   - `pairing_id` muss das offene Fenster sein. **Das Geheimnis ist der Code.** Die Nonce wird nicht gegen fremde `pair/start`-Anfragen geprüft, ein QR-Scan klappt also auch, wenn sich vorher jemand anderes angemeldet hat.
   - Gehört `public_nonce` zu einer **abgelehnten** Anfrage: `403 pairing_request_rejected`.
   - Antwort: `device_token`, 32 Byte Zufall, base64url. Gespeichert wird nur `sha256` als `token_hash`. Danach ist das Fenster geschlossen.
4. **Fehlversuche** (falscher Code zur gültigen, offenen `pairing_id`) zählen pro Nonce, pro Fenster **und** global. Unbekannte `pairing_id` und abgelehnte Nonces zählen nicht zum Budget, sie werden nur abgewiesen.
   - **Pro Nonce:** Nach 5 falschen Codes wird diese Nonce abgewiesen (`pairing_code_invalid`). Andere Geräte sind nicht betroffen.
   - **Pro Fenster:** Nach 20 falschen Codes ist das Fenster geschlossen (`pairing_window_closed`). Die Web-App zeigt „Viele Fehlversuche“.
   - **Global:** Bei mehr als 20 falschen Codes pro Stunde sind alle `pair/*`-Aufrufe gesperrt (`423 pairing_locked`), bis am Mac ein neues Fenster geöffnet wird.
   - **Restrisiko:** Ein Angreifer im selben WLAN kann die Kopplung durch Raten **verzögern**, aber ohne Code nicht übernehmen. Ein neues Fenster am Mac hebt jede Sperre auf.
   - **Pro Absenderadresse:** höchstens 10 `pair/*`-Aufrufe pro Minute (`429 pairing_rate_limited`).
5. **Speicherung des Codes:** nur **im Speicher** des Core-Prozesses, nie in der Datenbank. Der Code wird mit `crypto.randomInt` erzeugt und mit `crypto.timingSafeEqual` verglichen.
   - Gründe: Er lebt höchstens 5 min, und es gibt genau einen Core-Prozess.
   - Ein Hash eines 6-stelligen Codes wäre offline in Sekunden durchprobiert. HMAC bräuchte ein weiteres Server-Geheimnis, das verwaltet werden müsste.
   - Folge: Ein Neustart des Core schließt das Fenster, der Nutzer öffnet es neu.
6. Gerät entfernen (`DELETE /devices/{id}`) widerruft das Token sofort und schließt seine Verbindungen (08 §3).

## 13. Backups, Papierkorb, Aufräumen (F-DAT-01/02/04, T1-18)

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
- **Wiederherstellung:** `pnpm sg restore <stand>` bei gestopptem Core. Sie setzt eine neue `sync_meta.db_epoch` (§11.1). Monatlicher Test: `pnpm sg restore --test <stand>` in eine Wegwerf-Datenbank mit Zählung der Objekte (F-DAT-02).

**Papierkorb**
- Löschen per REST oder Operation setzt `deleted_at` am Objekt und an allen Teilen **mit demselben Zeitstempel**.
- **Kaskaden** je `TrashKind`:

| Gelöscht | Mitgelöscht (gleiches `deleted_at`) | Bleibt unverändert |
|---|---|---|
| `semester` | seine Module mit deren Kaskade | – |
| `module` | Foliensätze und Folien, Übungsblätter und Aufgaben, Sessions mit deren Kaskade, Notizbücher mit deren Kaskade | Kalendertermine (verweisen auf das gelöschte Modul und gelten in der Anzeige als „ohne Modul“) |
| `slide_deck` | Folien | Sessions mit `slide_deck_id` (Verweis bleibt, Anzeige ohne Folien) |
| `exercise_sheet` | Aufgaben | – |
| `calendar_source` | ihre Termine. Dazu die nie gestarteten Sessions dieser Termine (`geplant`, `bereit`, `verpasst`) | gestartete Sessions. Ihr `calendar_event_id` zeigt auf den gelöschten Termin, `planned_*` bleiben lesbar |
| `session` (nur nicht aktiv) | Folienwechsel, Marker, Fotos, Aufnahmen mit Chunks | Seiten mit `session_id` (gehören zum Notizbuch) |
| `notebook` (nicht `vorlesung`/`uebung`) | Seiten, Striche, Seitenelemente | – |
| `page` | Striche, Seitenelemente | – |
| `marker`, `photo` | – | Stempel- bzw. Bildelemente, die darauf verweisen (Anzeige als Platzhalter) |

- `GET /trash` zeigt nur **direkt** gelöschte Objekte. Das sind die, deren Elternobjekt nicht mit demselben Zeitstempel gelöscht wurde. `purge_at = deleted_at + 30 Tage`.
- `POST /trash/{id}/restore` stellt das Objekt und alle Teile mit **genau** diesem `deleted_at` wieder her. Die ID ist die Objekt-ID (UUIDs sind tabellenübergreifend eindeutig). Ist das Elternobjekt selbst gelöscht, folgt `409 restore_parent_deleted`. Für Notizbücher und Seiten schreibt der Core `notebook.restore` bzw. `page.restore` in den Strom (§11.3).
- **Konflikte beim Wiederherstellen:** Wäre danach ein partieller Unique-Index verletzt, etwa weil der Termin inzwischen eine neue Session hat, antwortet der Core mit `409 restore_conflict` und `details: { constraint, conflicting_id }`. Dann wird nichts wiederhergestellt. `conflicting_id` ist `null`, wenn der Konflikt erst beim Schreiben auffällt.
  - Ausnahme Semester: Ist inzwischen ein anderes Semester aktuell, kommt das wiederhergestellte mit `is_current = false` zurück. Das ist kein Fehler.
- „Rückgängig“ im Toast (10 s, F-DAT-04) nutzt denselben Endpunkt. Für Marker nutzt die Web-App stattdessen `marker.remove` im Sync.
- Dateien (Fotos, Chunks, `pkdrawing`, PDFs) bleiben bis zum endgültigen Löschen liegen.
- **Entscheidungen T1-18 (vormals offene Punkte):**
  - `task_slide_link`: keine Kaskade. Verknüpfungen gelöschter Folien oder Aufgaben bleiben stehen, Leser filtern über Join auf nicht gelöschte `slide` und `task` (heute liest sie niemand). Endgültig gelöscht werden sie per Fremdschlüssel (CASCADE).
  - Sessions, die mit ihrer `calendar_source` gelöscht wurden: Elternobjekt ist für Liste und Wiederherstellen die Quelle (über den Termin mit gleichem `deleted_at`). Sie stehen nicht einzeln in `GET /trash`, `POST /trash/{session}/restore` liefert `409 restore_parent_deleted` mit `details.parent` (Art `calendar_source`), einzeln endgültig löschen ist `404`.
  - Gleiches `deleted_at` in derselben Millisekunde: nur dokumentiert, nicht behoben (bei einem Nutzer praktisch ausgeschlossen).
  - **Server-Operationen:** Löschen eines Moduls/Semesters schreibt `notebook.delete` für jedes mitgelöschte Notizbuch, Wiederherstellen `notebook.restore` je Notizbuch bzw. `page.restore` für eine einzelne Seite. Vorher werden die Ströme der betroffenen Notizbücher und Sessions gesperrt (Strom vor Zeile, §16.2), ebenso beim endgültigen Löschen.
  - **Endgültig löschen** entfernt den ganzen Teilbaum unabhängig vom `deleted_at` der Kinder (ein früher gelöschtes Kind geht mit, wenn sein Elternobjekt endgültig geht) sowie `sync_stream`/`sync_op` der Notizbücher und Sessions. Dateien (Foliensatz-, Blatt-, Aufnahme-Ordner, Fotos, `pkdrawing`) gehen nach dem Commit weg, nur über `resolveDataPath`.
- **Backup-Ablauf (T1-18):**
  - Aufbau eines Standes: `<ziel>/<stand>/{db.dump, media/, vault/, manifest.json}`. Unveränderte Dateien sind Hardlinks auf den vorigen Stand. Geschrieben wird nach `.<stand>.partial` und erst am Ende umbenannt.
  - `POST /backup` legt die `backup_run`-Zeile selbst an und startet `node infra/sg/src/main.ts backup --trigger … --run-id …` (Ausgabe in `logs/backup.log`). Ein `laeuft` älter als 6 Stunden gilt als abgestürzt.
  - `stale` ist auch ohne jedes erfolgreiche Backup `true`.
  - Der Zeitplan (Backup und `maintenance.nightly` um 03:30) läuft minütlich im Core und holt Verpasstes nach. Ein fehlgeschlagener geplanter Lauf wird am selben Tag nicht wiederholt.
  - `backup_encryption = true` lässt den Lauf mit Hinweis scheitern (`age` ist P1, nie unverschlüsselt sichern, wenn Verschlüsselung gewünscht ist).
  - `sg migrate`/`sg start` sichern vor ausstehenden Migrationen (`vor_migration`), wenn ein Ziel gesetzt ist; scheitert es, wird nicht migriert (`--ohne-backup` übergeht das).
  - `sg restore` (ohne Stand: Liste) spielt in eine neue Datenbank und neue Ordner ein und tauscht danach. Die alte Datenbank (`<db>_vor_restore_<zeit>`) und Ordner (`media.vor-restore-<zeit>`) bleiben liegen. Der monatliche automatische Test (`sg restore --test`) ist noch nicht eingeplant.

**`maintenance.nightly`** (Worker, T1-18)
- **Anlegen:** Der Core legt den Job täglich um 03:30 Ortszeit an, mit Payload `MaintenanceNightlyPayload` (Standard `{}` = 30 Tage, ohne `dry_run`). Ergebnis: `MaintenanceNightlyResult`.
- **Umfang in Phase 1:**
  1. Objekte mit `deleted_at` älter als `purge_older_than_days` endgültig löschen, Kinder vor Eltern, samt ihrer Dateien.
  2. `sync_op` und `sync_stream` der dabei gelöschten Notizbücher und Sessions entfernen. Sonst bleibt `sync_op` erhalten, solange das Objekt des Stroms existiert, auch im Papierkorb.
  3. Verwaiste Dateien entfernen: Fotos ohne `photo`-Zeile nach 30 Tagen, `*.part`-Dateien älter als 1 Tag.
- Spätere Phasen ergänzen Schnappschüsse und Dubletten-Vorschläge (08 §5).

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
- **Schema-Änderung mit T1-DB** (§16): `Module` bekommt `settings: ModuleSettings` als Pflichtfeld, `ModuleUpdate` bekommt `settings?: ModuleSettingsUpdate`. Beides kommt im selben PR wie Migration und die kleine Core-Änderung in `services/organisation.ts`, damit `main` grün bleibt. Diese Änderung an `packages/schemas` ist für T1-DB vorab freigegeben.
- `PATCH /modules/{id}` mit `settings` führt Schlüssel für Schlüssel zusammen, `null` entfernt einen Schlüssel. Die Web-App schreibt `layout`/`column_widths` (F-DSH-01), das iPad `ink_mode` (F-INK-03). Die beiden überschreiben sich nicht gegenseitig.

## 15. Fehlercodes Phase 1 (Übersicht)

| Code | HTTP | Bedeutung |
|---|---|---|
| `calendar_source_not_found`, `calendar_event_not_found`, `session_not_found`, `recording_not_found`, `notebook_not_found`, `page_not_found`, `photo_not_found`, `device_not_found`, `trash_item_not_found` | 404 | Objekt fehlt oder ist gelöscht |
| `photo_file_missing`, `pkdrawing_not_found`, `audio_not_ready`, `file_not_found` | 404 | Datei (noch) nicht vorhanden |
| `calendar_source_exists`, `session_exists`, `recording_exists`, `notebook_exists`, `notebook_kind_exists` | 409 | Doppelt angelegt |
| `notebook_default` | 409 | Standard-Notizbuch lässt sich nicht löschen |
| `session_transition_invalid`, `session_not_active`, `session_active` | 409 | Zustandsautomat (§9.1) |
| `chunk_conflict`, `recording_seq_conflict`, `photo_file_conflict` | 409 | Gleiche ID, anderer Inhalt |
| `backup_running`, `backup_target_missing`, `restore_parent_deleted`, `restore_conflict` | 409 | Daten (§13) |
| `pairing_window_closed` | 409 | Kopplungsfenster zu oder abgelaufen (§12) |
| `chunk_header_invalid`, `backup_target_invalid`, `upload_aborted` | 400 | Anfrage ungültig (`upload_aborted`: der Client hat den Upload abgebrochen) |
| `pairing_code_invalid`, `pairing_request_rejected`, `local_only` | 403 | Code falsch, Anfrage abgelehnt bzw. Route nur lokal |
| `pairing_request_not_found` | 404 | Kopplungsanfrage unbekannt |
| `file_too_large`, `chunk_too_large` | 413 | Größe |
| `unsupported_media_type`, `chunk_mime_mismatch` | 415 | Dateityp |
| `ics_invalid`, `checksum_mismatch` | 422 | Inhalt ungültig |
| `pairing_locked` | 423 | Kopplung gesperrt, neues Fenster am Mac öffnen |
| `pairing_rate_limited` | 429 | zu viele Versuche |
| `ics_fetch_failed` | 502 | ICS-URL nicht erreichbar oder über den Grenzen |

**Sync-Fehler:** `SyncErrorCode` im Schema.

**WebSocket-Schließcodes:**
- 4401: Token ungültig oder widerrufen
- 4408: kein `hello`
- 4426: Protokollversion
- 4409: nach `session_superseded`, Warteschlange umschreiben und neu verbinden
- 4503: nach einem wiederholbaren Fehler, mit Wartezeit neu verbinden und erneut senden

## 16. Phase-1-Ticketplan

### 16.1 Reihenfolge

1. **T1-DB (zuerst, Claude-Subagent Opus).** Besitzt `services/core/src/db/schema/**`, `services/core/drizzle/**`, `pnpm-lock.yaml`, `package.json` der Pakete und die Schema-Änderung an `Module`/`ModuleUpdate` mit der kleinen Anpassung in `services/core/src/services/organisation.ts` (§14.2).
   - **Inhalt:** **alle** Phase-1-Tabellen aus §6.1, 03 §3, §5, §6 und §13 in einer Migration. `transcript_segment` und `slide_segment` (03 §5) gehören zu Phase 2 und kommen mit deren Migration.
   - **Fertig gebaut und getestet** (DB-nah, von vielen Tickets zur Laufzeit gebraucht): `appendOp` (ohne Versand, der Versand nach dem Commit läuft über einen Hook, den T1-08 einhängt), `softDelete`/`restoreFromTrash` mit den Kaskaden aus §13 und `getSettings` mit den Standards aus §14.1.
   - **Nur als Gerüst** (`throw new Error('nicht umgesetzt')`): die übrigen Schnittstellen aus §16.2.
   - **Abhängigkeiten im Lockfile:** `ical.js` (T1-01), `@fastify/websocket` (T1-08), `bonjour-service` (T1-10), `perfect-freehand` (T1-16).
   - Danach ändert kein anderes Ticket Tabellen oder das Lockfile. Braucht ein Ticket doch etwas, meldet es das als „Offener Punkt“, und der Lead plant einen Nachtrag.
2. **Parallel danach.** Jedes Ticket besitzt die genannten Dateien. `services/core/src/app.ts` (Routen registrieren) und `apps/web/src/lib/nav.ts` sind gemeinsame Dateien. Dort fügt jedes Ticket nur eine Zeile an, Konflikte löst der später Mergende.

### 16.2 Interne Schnittstellen im Core

T1-DB legt alle an: `appendOp`, `softDelete`/`restoreFromTrash` und `getSettings` fertig, die übrigen als Gerüst, das die genannten Tickets füllen. So hängen T1-02 und Core-Ink zur Laufzeit nur von T1-DB ab und können ihre Handler direkt testen, ohne T1-08. Signaturen ändern nur mit Zustimmung des Leads.

| Schnittstelle | Datei | Signatur | Füllt |
|---|---|---|---|
| Operation anhängen | `services/core/src/sync/append.ts` | `appendOp(tx: Tx, stream: string, op: { kind: SyncOp['kind']; data: unknown; at: number; clockUncertain: boolean; origin: SyncOrigin; opId?: string; deviceId?: string \| null }): Promise<{ seq: number; opId: string; duplicate: boolean }>`. Sperrt `sync_stream`, prüft unter der Sperre die `op_id`, schreibt `sync_op` und meldet die Operation per `pg_notify('sg_sync_op')`. Postgres stellt das erst nach dem Commit zu. `listenCommittedOps(sql, db, onError?)` ruft dann `onOpCommitted` auf, je Strom lückenlos in `seq`-Reihenfolge, auch nach einem Neuverbinden. Wirft der Hook, wiederholt er später ab derselben `seq`. Setter: `setOnOpCommitted(hook)`, Standard: nichts. `findOpById(db, opId)` liefert eine gespeicherte Operation | **T1-DB**. T1-08 startet `listenCommittedOps` beim Core-Start und setzt den Hook für Versand und `ack` (§11.2) |
| Duplikate | Dispatcher in `services/core/src/sync/**` | Der Dispatcher von T1-08 ruft **zentral vor dem Handler** `findOpById` auf. Gleiche Operation (Strom, Art, Daten): ursprüngliches `ack` ohne Handler. Abweichende: `error op_id_reused`. Handler prüfen das nie selbst. **Ablauf je Operation in einer Transaktion:** (1) `findOpById`, bei einem Duplikat das ursprüngliche `ack` senden; (2) optional `preLock(tx, op)` aus `registerOpHandler(kind, handler, { preLock })`; (3) `appendOp` mit der Client-Operation **vor** dem Handler, bei `duplicate = true` Rollback und das ursprüngliche `ack`; (4) Handler; (5) bei `SyncOpError` Rollback, es wird keine `seq` vergeben. Handler gehen davon aus, dass die Client-Operation schon in `sync_op` steht, und schreiben sie nie selbst, nur Server-Operationen. Lockreihenfolge überall: zuerst das, was `preLock` sperrt (in **allen** Wegen, auch über REST, immer vor dem Strom), dann der Strom, dann die Fachzeilen. REST-Wege wie `PATCH`/`DELETE /notebooks/{id}` sperren darum zuerst den Strom und danach das Notizbuch. Gleichzeitige Duplikate fängt `appendOp` ab (`duplicate = true` bzw. `internal_error`, wiederholbar) | T1-08 |
| Op-Handler | `services/core/src/sync/handlers.ts` | `registerOpHandler(kind, handler: (tx: Tx, op: SyncOp, ctx: { deviceId: string \| null; origin: SyncOrigin }) => Promise<void>, opts?: { preLock?: (tx: Tx, op: SyncOp) => Promise<void> })`. `preLock` sperrt vor dem `appendOp` die Zeilen, die auch andere Wege vor dem Strom sperren. Fehler über `throw new SyncOpError(code: SyncErrorCode, retryable: boolean, details?)` | Registry T1-08, Handler die Fachtickets. Core-Ink: `registerInkHandlers({ dataDir })` in `sync/handlers/ink.ts` (T1-08 ruft es beim Start auf, `dataDir` aus der Konfiguration) |
| Ereignisse | `services/core/src/sync/events.ts` | `publishEvent(event: SyncEvent, opts?: { localOnly?: boolean }): void` und `publishAfterCommit(tx: Tx, event: SyncEvent): Promise<void>`. `publishAfterCommit` nutzt denselben Weg wie `appendOp`: `pg_notify('sg_event', <Event-JSON>)` in `tx`, das Ereignis vollständig in der Nutzlast, über 7000 Byte (UTF-8) wirft es. Ein Listener auf `sg_event` ruft `publishEvent` auf | T1-08 |
| Verbindungen | `services/core/src/sync/connections.ts` | `closeDeviceConnections(deviceId: string, code: number): void`, `isDeviceConnected(deviceId: string): boolean` | T1-08 |
| Session-Übergang | `services/core/src/services/sessions.ts` | `transitionSession(tx: Tx, sessionId: string, action: 'start' \| 'pause' \| 'resume' \| 'stop', input: { at: Date; origin: SyncOrigin; deviceId?: string \| null; startedFrom?: ClientDevice; reason?: StopReason; moduleId?: string; calendarEventId?: string \| null; slideDeckId?: string \| null }): Promise<{ session: Session; endedSession: Session \| null }>` (schreibt selbst die Server-Operationen) | T1-02 |
| Kalender → Session | `services/core/src/services/sessions.ts` | `ensurePlannedSessions(tx: Tx, eventIds: string[]): Promise<void>` (anlegen, löschen, `module_id`, VL-Nummer neu) | T1-02, aufgerufen von T1-01 |
| Token prüfen | `services/core/src/services/devices.ts` | `verifyDeviceToken(db: Db, token: string): Promise<{ deviceId: string } \| null>` | T1-10 |
| Wächter → Route | `services/core/src/plugins/security.ts` | `DeviceTokenVerifier` liefert künftig `Promise<{ deviceId: string } \| null>`. Der Wächter setzt `request.sgDevice: { deviceId: string } \| null` (`null` = lokal). Für `GET /sync` mit `Upgrade: websocket` prüft er zusätzlich `Origin` wie bei zustandsändernden Anfragen | T1-10. T1-08 liest `request.sgDevice` beim Upgrade |
| Einstellungen | `services/core/src/services/settings.ts` | `getSettings(db: DbOrTx, config: Pick<Config, 'dataDir'>): Promise<Settings>`. `general.data_dir` kommt aus der App-Konfiguration | **T1-DB**. T1-19 baut `PATCH`. Genutzt von T1-02 (Auto-Stopp) und T1-18 |
| Papierkorb | `services/core/src/services/trash.ts` | `softDelete(tx: Tx, kind: TrashKind, id: string): Promise<Date>` (Kaskade §13; wirft `HttpError` 404 `<kind>_not_found`, 409 `session_active`, 409 `notebook_default`), `restoreFromTrash(tx: Tx, id: string): Promise<TrashRestoreResult>` (404 `trash_item_not_found`, 409 `restore_parent_deleted`, 409 `restore_conflict`) | **T1-DB**. T1-18 baut die Routen und schreibt Server-Operationen bei der Wiederherstellung. Alle Lösch-Routen rufen `softDelete` |
| Fotos | `services/core/src/services/photos.ts` | `upsertPhotoMeta(tx: Tx, data: PhotoAddData, env: { dataDir: string }): Promise<void>` und `storePhotoFile(id, stream, sha256, mime, env: { db: Db; dataDir: string }): Promise<FileReceipt>` (der letzte Parameter `env` ist nötig, weil beide Datenordner bzw. Datenbank brauchen) prüfen sich gegenseitig (sha256, Typ) | Core-Ink (Handler `photo.add` und `PUT /photos`) |
| Recorder → Auto-Stopp | `apps/web/src/lib/recorder/level.ts` | `subscribeAudioLevel(fn: (s: { at: number; rms: number }) => void): () => void`, alle 250 ms während der Aufnahme. Die Spracherkennung baut T1-07 darauf. Der Stopp läuft per `POST /sessions/{id}/stop`. Der Recorder reagiert auf `session.updated` (`beendet`) und schließt die Aufnahme ab (`complete`) | T1-06 liefert, T1-07 nutzt |
| Web-Sync-Client | `apps/web/src/lib/sync/client.ts` | `class SyncClient { connect(); subscribe(stream: string, from: { lastSeq: number; lastOpId: string \| null }, onOp: (op: SyncOp) => void); send(op): Promise<SyncAck>; onEvent(name, fn); }`. `from` stammt aus `stream_seq`/`stream_op_id` des REST-Stands. Dazu Warteschlange in IndexedDB, Uhrabgleich, Wartezeit nach 4503, Fehlerablage | T1-WS |

### 16.3 Tickets und Besitz

| Ticket | Inhalt | Besitzt (Dateien) | Abhängig von |
|---|---|---|---|
| T1-DB | Tabellen, Lockfile, Gerüste, `Module.settings` | siehe §16.1 | – |
| T1-01 | Kalender (§8) | `services/core/src/{routes,services}/calendar.ts`, Tests mit `tests/fixtures/ics`, `apps/web/src/components/Calendar*.tsx`, `apps/web/src/lib/calendar.ts` | T1-DB, für Sessions T1-02 |
| T1-02 | Sessions, Automat, Auto-Stopp-Rückfallebene, `extend` (§9), `slide_deck_id` beim Folien-Upload | `services/core/src/{routes,services}/sessions.ts`, Op-Handler `session.*`, `slide.change`, `marker.*` in `services/core/src/sync/handlers/session.ts`. In `services/core/src/services/material.ts` nur `createSlideDeck` | T1-DB |
| **Core-Ink** (neu) | Notizbücher, Seiten, Striche, Elemente, `pkdrawing`, Fotos (REST §7.4 und Op-Handler `notebook.*`, `page.*`, `stroke.*`, `element.*`, `drawing.snapshot`, `photo.add`), Standard-Notizbücher beim Anlegen eines Moduls | `services/core/src/{routes,services}/{notebooks,pages,photos}.ts`, `services/core/src/sync/handlers/ink.ts`. In `services/core/src/services/organisation.ts` nur `createModule` | T1-DB |
| T1-06 | Audio: REST §7.3, Recorder und Upload im Browser | `services/core/src/{routes,services}/recordings.ts`, `apps/web/src/lib/recorder/**` | T1-DB |
| **T1-06w** | Worker `audio.finalize` (§3) | `services/worker/src/sg_worker/handlers/audio_finalize.py` und Tests. Eine Zeile in `handlers/__init__.py` | T1-DB |
| T1-07 | Auto-Stopp im Browser (§9.4) | `apps/web/src/lib/autostop/**` | T1-02, T1-06 |
| T1-08 | Sync-Server (§11), Server-Teil von T1-09 | `services/core/src/sync/**` außer `handlers/session.ts` und `handlers/ink.ts` | T1-DB |
| **T1-WS** (neu) | Gemeinsamer Web-Sync-Client (§16.2), Fehlerablage-Anzeige | `apps/web/src/lib/sync/**` | Vertrag. Gegen T1-08 testen |
| T1-10 | Kopplung (§12), Token-Prüfung, `request.sgDevice`, Origin-Prüfung beim WS-Upgrade | `services/core/src/{routes,services}/devices.ts`, `services/core/src/plugins/security.ts`, `apps/web/src/components/settings/Devices*.tsx` | T1-DB. Danach Security-Gegen-Review durch Argon |
| T1-18 | Backups, Papierkorb-Routen, `maintenance.nightly`, Umstellung der vorhandenen Lösch-Routen auf `softDelete` | `infra/sg/**` (backup, restore), `services/core/src/routes/{backups,trash}.ts`, die Lösch-Funktionen (`delete*`) in `services/core/src/services/{organisation,material}.ts`, `services/worker/src/sg_worker/handlers/maintenance.py` mit einer Zeile in `handlers/__init__.py`, `apps/web/src/components/settings/{Data,Trash}*.tsx` | T1-DB |
| T1-19 | Einstellungen (§14) | `services/core/src/{routes,services}/settings.ts`, `apps/web/src/components/settings/{General,Lecture,Pen}*.tsx` | T1-DB |
| T1-03 | Heute-Bildschirm | `apps/web/src/components/HeuteView.tsx`, `apps/web/src/components/today/**` | T1-02 (gegen Beispiele vorab) |
| T1-04 | Live-Dashboard, Layout, Statusleiste mit Platzhaltern für Folie und Marker | `apps/web/src/app/session/**`, `apps/web/src/components/dashboard/**` **außer** `dashboard/slides/**` und `dashboard/markers/**` | T1-02, T1-WS |
| T1-05 / T1-17 | Folien blättern, Marker vom Mac | `apps/web/src/components/dashboard/slides/**` bzw. `dashboard/markers/**` (ersetzen die Platzhalter aus T1-04) | T1-04, T1-WS |
| T1-16 | Notizen-Spalte, Strich-Renderer | `apps/web/src/components/ink/**` | Renderer sofort (Testdaten), Live mit T1-WS |
| T1-11 bis T1-15 | iPad-App | `apps/ipad/**`, übernimmt `Schemas.swift` und `swift-support/Sources` | Spike S1, T1-08 |

**Gemeinsam genutzte Core- und Worker-Dateien**
- `services/core/src/services/organisation.ts` und `material.ts`: T1-DB (`Module.settings`), T1-18 (`delete*`), Core-Ink (`createModule`) und T1-02 (`createSlideDeck`) ändern je **nur ihre Funktion**. Merge-Reihenfolge: T1-DB, dann T1-18, dann Core-Ink, dann T1-02. Wer später kommt, rebased.
- `services/worker/uv.lock` gehört T1-DB. Python-Pakete für Phase 1 sind nicht geplant (`ffmpeg` ist ein Systemprogramm). Braucht T1-06w oder T1-18 doch eins, meldet es den Bedarf an den Lead.
- `services/worker/src/sg_worker/handlers/__init__.py`: T1-06w und T1-18 fügen je eine Importzeile an.

**Gemeinsam genutzte Web-Dateien:**
- `apps/web/src/components/AppShell.tsx` und `apps/web/src/lib/api.ts` (API-Client) gehören dem Lead. Tickets fügen nur Funktionen in eigene Dateien unter `apps/web/src/lib/<bereich>.ts` hinzu.
- `apps/web/src/components/SettingsView.tsx` bekommt in **T1-19** Reiter mit je einer Komponente pro Bereich. Die Bereiche Geräte (T1-10) und Daten/Papierkorb (T1-18) liefern nur ihre Komponente unter `apps/web/src/components/settings/`.

**Nur der Owner kann testen:**
- die Spikes S1 bis S5
- alle iPad-Tickets (bauen und starten, PencilKit, Kamera, Bonjour, Local-Network-Freigabe)
- den Blindtest gegen GoodNotes
- lange Aufnahmen in Safari und Chrome
- die Latenzziele
- Backups auf externe Platte bzw. iCloud
- den Hörsaaltest T1-20
