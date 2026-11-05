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
| `SG_MOODLE_URL` | leer (Moodle-Anbindung aus). Beim Owner `https://moodle2.uni-potsdam.de` | Core, CLI |
| `TZ` | Zeitzone des Systems | Core (Ortszeit für ICS-Termine ohne Zeitzone, Backup-Uhrzeit). Tests laufen mit `TZ=Europe/Zurich` |

Geheimnisse wie API-Schlüssel stehen in `$SG_DATA_DIR/config/.env` mit Rechten 600 (02 §3). Die Prozesse lesen diese Datei beim Start.
**Ausnahme Moodle:** Der Moodle-Token liegt nur im macOS-Schlüsselbund (Dienst `studiengehirn-moodle`), nie in `.env`. Nur der Core liest ihn (08 §9.1).

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
- **Ergänzung T1-06 (Anlegen und Nachzügler, verbindlich für Core):**
  - Aufnahmen ohne Chunks bekommen keinen Job (§10.2).
  - `complete` ohne vorhandenen Job legt (bei mindestens einem Chunk) einen Job an, auch solange die Session `laeuft`. Der Stopp legt nur dann einen an, wenn für die Aufnahme noch keiner existiert (`ensureFinalizeOnStop`, §16.2). Ein Job in `wartet`, `laeuft` oder `fertig` bleibt unberührt, nach `fehler` oder `abgebrochen` entsteht ein neuer.
  - Chunk nach einem Job, der nicht mehr `wartet` (`laeuft`, `fertig`, `fehler`, `abgebrochen`): neuer Job. Ist die Aufnahme noch nicht abgeschlossen, mit `run_after = jetzt + 60 s`, damit ein Rückstau aus IndexedDB nicht jedes Mal die ganze Datei neu erzeugt. Ein Job, der `laeuft`, wird als `depends_on` des neuen eingetragen.
  - Eine nachträglich angelegte Aufnahme (§10.1, Session schon `beendet`) ist beim Anlegen leer und bekommt ihren Job mit dem ersten Chunk, mit `run_after = jetzt + 10 min`.
  - Der Core entscheidet unter `lockRecording` und liest den letzten Job mit `FOR UPDATE`. Der Worker holt Jobs mit `FOR UPDATE SKIP LOCKED`.
- **Ergebnis** enthält `job_duration_ms` (Laufzeit des Jobs) getrennt von `audio_duration_ms` (Länge der Datei).
- **Ausführung (Worker):** Chunks nach `seq` lesen. Bei `chunks_independent = false` als ein Bytestrom aneinanderhängen, sonst jeden Chunk einzeln decodieren. Dann mit `ffmpeg` nach `full.m4a` (AAC, 48 kHz, mono) umwandeln. Lücken (fehlende `seq` oder Sprünge in `start_ms`) werden als Stille mit korrekter Länge eingefügt. Zum Schluss `recording.duration_ms` und `recording.state` (`vollstaendig` bzw. `mit_luecken`) setzen.
- **Session-Fortschritt (Worker):** Die Job-Schleife zieht den Fortschritt nach jedem Job mit `session_id` nach, in **derselben Transaktion**, in der der Job final wird (`fertig`, endgültig `fehler`, `abgebrochen` durch `depends_on`; bei Retry `wartet`; auch für abgestürzte Jobs). Handler schreiben ihn nicht selbst. Ablauf: (1) Session-Zeile `FOR NO KEY UPDATE` sperren, **bevor** Jobs gezählt werden, damit zwei gleichzeitig endende Jobs nacheinander laufen und der zweite den ersten sieht. (2) `session.processing[<job.type>]` aus **allen** Jobs dieses Typs der Session setzen: `fehler`, sobald einer endgültig gescheitert ist, sonst `laeuft`, dann `wartet`, sonst `fertig`; `abgebrochen` zählt nicht mit, nur abgebrochene Jobs ergeben `abgebrochen`. (3) Ist die Session `beendet` und hat sie keinen Job mehr in `wartet` oder `laeuft`, setzt der Worker `state = 'verarbeitet'`, auch wenn Jobs `fehler` sind; eine `verarbeitet`e Session ändert ihren Zustand nicht mehr, nur `processing`. (4) `pg_notify('sg_session', '<session_id>')`. Der Core hört darauf und sendet das Ereignis `session.updated` (§11.6). Doppelte Läufe sind harmlos.

**Ergänzungen zu `audio.finalize` im Worker (T1-06w):**

- **Fehlend** ist ein Chunk, wenn seine `seq` fehlt, die Datei fehlt, Größe oder sha256 nicht zur Zeile passen oder `ffmpeg` ihn bzw. seinen Lauf nicht dekodieren kann. Er macht den Job nicht zum `fehler`, die Aufnahme wird `mit_luecken` und die `seq` steht in `missing_seqs`.
- **Abhängige Chunks** (`chunks_independent = false`): Läufe mit lückenlosen `seq` und ohne Sprung in `start_ms` werden einzeln dekodiert, jeweils mit dem Init-Segment aus Chunk 0 davor (WebM bis zum ersten Cluster, MP4 `ftyp`+`moov`). Chunks müssen nicht an Cluster- oder Fragmentgrenzen beginnen: Bei Läufen mit `seq > 0` wird der angeschnittene Anfang bis zur nächsten Cluster- bzw. Fragmentgrenze verworfen, als Lücke `fehlender_chunk` gemeldet (ab 1 s Verlust) und der Lauf rechtsbündig ausgeglichen (Stille vorn). Ergibt ein Lauf 0 ms, gelten seine Chunks als fehlend. **Unabhängige Chunks:** jeder Chunk wird einzeln dekodiert.
- **Platzierung:** Jedes Stück liegt bei seinem `start_ms` (relativ zu `recording.started_ms`) und wird auf seine angegebene Länge gebracht (Summe `duration_ms`): zu kurz mit Stille aufgefüllt, zu lang gekürzt, bei Überlappung entfällt der Anfang. Encoder-Priming und Rotationslücken summieren sich so nicht auf. Die **Toleranz von 50 ms** gilt nur für die Meldung in `gaps` (`zeitluecke`), nicht für die Platzierung.
- **Ende:** Fehlen Chunks nach dem letzten verwendbaren, füllt der Worker bis `started_ms + completed_duration_ms` auf (nur mit `complete`). **Ohne `complete`** ist ein fehlendes Ende nicht erkennbar; ein beschädigter letzter Chunk liefert dann über seine `duration_ms` die Endlücke, sonst gilt die Aufnahme ohne erkennbare Lücke als `vollstaendig`.
- **Null verwertbare Chunks**, oder bei abhängigen Chunks fehlender bzw. beschädigter Chunk 0: kein `full.m4a` (eine alte wird entfernt), `chunk_count = 0`, `state = mit_luecken`, Job `fertig`. Ein nachgelieferter Chunk 0 macht einen späteren Lauf möglich (§3, neuer Job durch den Core).
- **Plausibilitätsgrenzen** führen zu `fehler` ohne Retry: mehr als 10000 fehlende `seq`, eine einzelne oder alle Lücken zusammen länger als `completed_duration_ms` plus 1 h (ohne `complete`: 12 h).
- **Voraussetzung:** `ffmpeg` und `ffprobe` müssen auf dem Mac installiert sein (PATH). Aufrufe ohne Shell, mit Zeitlimit, festem Eingabeformat (`-f matroska` bzw. `mov`) und `-protocol_whitelist file`.
- **`processing` bei mehreren Aufnahmen:** Eine Session kann mehrere Aufnahmen und damit mehrere `audio.finalize`-Jobs haben. `processing['audio.finalize']` fasst alle zusammen: `fehler`, sobald einer endgültig gescheitert ist, sonst `laeuft` bzw. `wartet`, solange einer offen ist, sonst `fertig` (`abgebrochen` zählt nicht mit).
- **MP4-Läufe:** Ein Lauf wird vor dem Dekodieren auf die letzte vollständige Top-Level-Box gekürzt; eine unvollständige `moof`/`mdat` am Ende entfällt.
- **Ignorierte Chunks:** Chunks mit `seq > completed_last_seq` (nach `complete` nicht mehr zu erwarten) ignoriert der Worker mit einer Warnung.
- **Session-Fortschritt bei Fehlern:** Gilt generisch für jeden Jobtyp (siehe „Session-Fortschritt (Worker)“ oben), auch bei endgültigem Scheitern von `audio.finalize`.

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
- **Nachtrag T1-10 (Umsetzung):**
  - Ob eine Route lokal ist bzw. ohne Token erreichbar, steht an der Route (`config.sgAccess = 'local' | 'pairing'`) und wird nach dem Routing gelesen, nie per Textvergleich mit der URL. Unbekannte Pfade brauchen aus dem Netz immer ein Token.
  - Reihenfolge aus dem Netz: Token fehlt → `401 device_token_required`, Token ungültig → `401 device_token_invalid`, erst danach `403 local_only`. Bei `pair/start` und `pair/confirm` (nur `POST`) wird ein mitgesendetes Token ignoriert.
  - Ein Token, das nicht dem Format aus `PairResponse` entspricht (43 Zeichen base64url), gilt ohne Datenbankabfrage als ungültig. Die Prüfung liest ohne Cache: Ein widerrufenes Gerät ist mit dem Commit von `DELETE /devices/{id}` ungültig.
  - Abgelehnte WebSocket-Upgrades bekommen `Connection: close`, der Core schließt den Socket nach der Antwort.
  - **Schutz gegen DNS-Rebinding auf die LAN-IP** (Security-Review zu T1-10): Eine Webseite kann ihren Namen auf die IP des Macs umbiegen und dann mit eigenem `Host` und passendem `Origin` Anfragen „aus dem Netz“ stellen.
    - **Host aus dem Netz:** Erlaubt sind nur IP-Literale (IPv4 bzw. `[IPv6]`, jeweils mit optionalem Port) und `<name>.local`. Alles andere, auch `localhost`, ergibt `421 host_not_allowed`. Das gilt für alle Netzanfragen, mit und ohne Token, und für den WebSocket. Das iPad verbindet sich über die IP aus dem QR-Code oder den `.local`-Namen aus Bonjour. Damit kann die Origin-Regel „eigene Herkunft `http://<Host>`“ für Geräte mit Token bleiben: Eine IP oder ein `.local`-Name lässt sich über öffentliches DNS nicht umbiegen.
    - **`pair/start` und `pair/confirm` mit `Origin`-Header** (egal welcher) ergeben `403 origin_not_allowed`. Die iPad-App sendet keinen `Origin`, ein Browser immer. Keine Webseite kann so eine Anfrage anlegen oder Codes raten. Abgewiesene Aufrufe zählen nicht zum Budget aus §12.
- **Nachtrag Logging (#87):** Vom Wächter abgelehnte Anfragen aus dem Netz (401, 403, 421) erzeugen keine Logzeile je Anfrage (weder `incoming request`/`request completed` noch Fehlerzeilen). Der Core zählt sie je Quelladresse (IPv6 je /64) und schreibt höchstens eine Zeile je Quelle und Minute (`Abgelehnte Netzanfragen (zusammengefasst)`: `source`, `count`, `statuses`, `first`, `last`). Die Zähler sind auf 4096 Quellen begrenzt (die älteste geht in einen Sammelzähler), je Minute erscheinen höchstens 64 Quellzeilen plus eine Sammelzeile. Lokale und angenommene Netzanfragen loggen unverändert, die Schwärzung geheimer Query-Parameter (#91/#95) gilt weiter. `logs/core.log` rotiert zusätzlich bei 50 MB zu `core-<Tag>-<Zeitstempel>.log`; alle `core*.log` zusammen bleiben unter 500 MB (die ältesten Archive werden gelöscht, zusätzlich zur Aufbewahrung von 14 Tagen). Die Größe wird nach je etwa 1 MB geschriebener Logzeilen geprüft.
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
| `backup_run` | `trigger text`, `stand text NULL`, `dump_sha256 text NULL` (64 Hex-Zeichen, CHECK) | Anzeige, Name für `sg restore <stand>`; `dump_sha256` ist die Vertrauensquelle für den automatischen Restore-Test (§13), von `sg backup` aus den Bytes von `pg_dump` gebildet, nie API-Feld |
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
| `POST /calendar/sources` | JSON `CalendarSourceCreate` (URL) **oder** multipart `file` (.ics, ≤ 5 MB), `name?` | 201 `IcsImportResult` | 400 `validation_failed` (u. a. ungültige URL, Zugangsdaten in der URL, ungültige `id`), 400 `file_missing`, 400 `unexpected_file`, 400 `upload_aborted`, 400 `ics_too_complex`, 409 `calendar_source_exists` (gleiche URL oder vergebene `id`, `details.id`), 413 `file_too_large`, 422 `ics_invalid`, 502 `ics_fetch_failed` |
| `POST /calendar/sources/{id}/sync` | URL-Quelle: leer. Datei-Quelle: multipart `file` (neue Fassung) | 200 `IcsImportResult` | 400 `file_missing` (Datei-Quelle ohne Datei), 400 `unexpected_file` (Datei an eine URL-Quelle), 400 `source_not_syncable` (Art `google`), 400 `ics_too_complex`, 404 `calendar_source_not_found`, 422 `ics_invalid`, 502 `ics_fetch_failed`. Bei URL-Quellen setzt jeder Fehler `last_error` |
| `DELETE /calendar/sources/{id}` | – | 204 (Kaskade §13) | 404 |
| `POST /calendar/reassign` | – | 200 `{ changed, ohne_modul }` | 403 `local_only` (**lokal**) |
| `GET /calendar/events?from&to&module_id&unassigned&include_cancelled` | – | 200 `CalendarEventList`, nach `starts_at` aufsteigend | 400 |
| `GET /calendar/events/{id}` | – | 200 `CalendarEvent` | 404 `calendar_event_not_found` |
| `PATCH /calendar/events/{id}` | `CalendarEventUpdate` | 200 `CalendarEventList` (alle geänderten Termine, ohne Cursor) | 404 `calendar_event_not_found`, 404 `module_not_found` |

`POST /calendar/reassign` bestimmt Modul und Art aller Termine mit `assigned_by = auto` neu (wie beim Abgleich, ohne ICS) und ruft `ensurePlannedSessions` für die geänderten auf. `changed` = Termine mit neuem Modul oder neuer Art, `ohne_modul` = nicht abgesagte automatisch zugeordnete Termine ohne Modul danach. Manuelle Zuordnungen bleiben unangetastet, ein zweiter Aufruf ändert nichts (`changed = 0`). Die Route wartet auf laufende Abgleiche und Löschungen der Quellen (Sperre je Quelle). Antwort: `CalendarReassignResult`. Die Web-App ruft die Route nach „Modul anlegen“ (aus einem Vorschlag) auf. **Fehlerschlüssel `ics_too_complex`** (400): Die Datei hat das Zeitbudget (§8) überschritten.

`from`/`to` sind ISO-Zeitpunkte. `from` ist einschließlich, `to` ausschließlich; ein Termin zählt, wenn er im Zeitraum liegt oder hineinreicht. Ohne `include_cancelled=true` fehlen abgesagte Termine. `unassigned=true` liefert Termine ohne Modul.

### 7.2 Sessions (T1-02)

| Methode und Pfad | Body | Antwort | Fehler |
|---|---|---|---|
| `GET /sessions?module_id&state&from&to` | – | 200 `SessionList` | |
| `POST /sessions` | `SessionCreate` | 201 `Session` (Zustand `bereit`) | 404 `module_not_found`, 404 `slide_deck_not_found`, 400 `slide_deck_module_mismatch` (Foliensatz eines anderen Moduls), 409 `session_exists` |
| `GET /sessions/{id}` | – | 200 `Session` | 404 `session_not_found` |
| `PATCH /sessions/{id}` | `SessionUpdate` | 200 `Session` | 404 |
| `DELETE /sessions/{id}` | – | 204 (Papierkorb über `softDeleteWithOps`, Kaskade §13, dann `session.updated` mit `deleted_at`) | 404, 409 `session_active` (läuft oder pausiert) |
| `GET /sessions/{id}/snapshot` | – | 200 `SessionSnapshot` | 404 |
| `POST /sessions/{id}/start` | `SessionStartRequest` | 200 `SessionStartResult` | 404, 409 `session_transition_invalid` |
| `POST /sessions/{id}/pause` | – | 200 `Session` | 404, 409 `session_transition_invalid` |
| `POST /sessions/{id}/resume` | – | 200 `Session` | 404, 409 `session_transition_invalid` |
| `POST /sessions/{id}/stop` | `SessionStopRequest` | 200 `Session` | 404, 409 `session_transition_invalid` |
| `POST /sessions/{id}/extend` | `SessionExtendRequest` | 200 `Session` mit neuem `auto_stop_extended_until` | 404, 409 `session_not_active` |

- `state` ist eine Komma-Liste, z. B. `state=laeuft,pausiert` für die aktive Session nach einem Neuladen (F-SES-05).
- Sortierung: aufsteigend nach `coalesce(started_at, planned_starts_at, created_at)`, bei Gleichstand nach `id`.
- `from`/`to` filtern auf denselben Zeitpunkt. Der Heute-Bildschirm (T1-03) fragt `from=<heute 00:00>&to=<morgen 00:00>` ab. Zusätzlich holt er `GET /sessions?state=laeuft,pausiert` (eine laufende Session vom Vortag) und `GET /calendar/events?from&to` für den Raum (`location`), verknüpft über `calendar_event_id`; danach hält `session.updated` die Liste aktuell. Das ist kein neuer Endpunkt.

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
| `POST /devices/pair/start` (Netz ohne Token) | `PairStartRequest` | 201 `PairStartResponse` | 409 `pairing_window_closed`, 423 `pairing_locked`, 429 `pairing_rate_limited`, 429 `pairing_requests_full` |
| `GET /devices/pairings/requests` (**lokal**) | – | 200 `PairingRequestList`, offene Anfragen des aktuellen Fensters (leer ohne Fenster) | |
| `DELETE /devices/pairings/requests/{request_id}` (**lokal**) | – | 204, Anfrage abgelehnt | 404 `pairing_request_not_found` |
| `POST /devices/pair/confirm` (Netz ohne Token) | `PairConfirmRequest` | 201 `PairResponse` | 403 `pairing_code_invalid`, 403 `pairing_request_rejected`, 409 `pairing_window_closed`, 423 `pairing_locked`, 429 `pairing_rate_limited` |
| `GET /backups` | – | 200 `BackupOverview` | |
| `POST /backup` | – | 202 `BackupRun` | 409 `backup_running`, 409 `restore_test_running`, 409 `backup_target_missing` |
| `POST /restore-test` | – | 202 `RestoreTest` (Zustand `laeuft`) | 403 `local_only` (**lokal**, auch mit Geräte-Token), 409 `restore_test_running`, 409 `backup_running`, 409 `backup_target_missing`, 409 `restore_test_no_backup` (§13) |
| `GET /trash?kind&cursor&limit` | – | 200 `TrashList`, nach `deleted_at` absteigend | |
| `DELETE /trash/{id}` | – | 204. Löscht das direkt gelöschte Objekt samt Teilbaum, Strömen (`sync_op`) und Dateien endgültig | 404 `trash_item_not_found` (auch für mitgelöschte Teile), 409 `session_active` |
| `DELETE /trash?kind` | – | 200 `{ purged_count }` (inline in der Route, kein Schema): leert den Papierkorb, optional nur eine Art | 409 `session_active` |
| `POST /trash/{id}/restore` | – | 200 `TrashRestoreResult` | 404 `trash_item_not_found`, 409 `restore_parent_deleted` (`details.parent`), 409 `restore_conflict` (`details.constraint`, `details.conflicting_id`) |
| `GET /settings` | – | 200 `Settings` | |
| `PATCH /settings` | `SettingsUpdate` | 200 `Settings` | 400 `backup_target_invalid` (Pfad leer, nicht absolut, kein vorhandener beschreibbarer Ordner, `SG_DATA_DIR` oder darin, Systemordner), 403 `local_only` (**`data.backup_target` nur lokal**: jede Änderung dieses Feldes aus dem Netz, auch mit Geräte-Token) |

Modul-Einstellungen laufen über `PATCH /modules/{id}` (§14.2).

**Nachtrag T1-10:**
- `GET /devices` liefert gekoppelte, nicht entfernte Geräte, älteste zuerst. Entfernte Geräte kommen **nicht** in den Papierkorb: Ein Wiederherstellen würde ein widerrufenes Token wieder gültig machen.
- `DELETE /devices/{id}`: Lokal ist jedes Gerät entfernbar. **Aus dem Netz darf ein Gerät nur sich selbst entfernen** (ID = Gerät des Tokens), sonst `403 local_only`. Geprüft wird vor der Suche, auch eine unbekannte ID ergibt 403.
- **Neu:** `DELETE /devices/pairings` (**lokal**, optional `?pairing_id=<uuid>`) → 204. Schließt das offene Kopplungsfenster sofort und verwirft seine offenen Anfragen. Danach antworten `pair/start` und `pair/confirm` mit `409 pairing_window_closed`. Idempotent: ohne offenes Fenster ebenfalls 204. Mit `pairing_id` nur, wenn es genau dieses Fenster ist; ein anderswo neu geöffnetes bleibt offen. Ein Code, der gerade eingelöst wird, läuft zu Ende. Sperre und Zähler bleiben bis zum nächsten `POST /devices/pairings`. Die Web-App ruft die Route bei „Schließen“, beim Verlassen der Ansicht und beim Schließen des Tabs (`pagehide`, `keepalive`) auf.
- `GET /devices/pairings/requests` setzt zusätzlich zwei Header für die Web-App (das Schema `PairingRequestList` bleibt unverändert):
  - `SG-Pairing-State`: `none` (kein Fenster seit dem Start), `open`, `qr_only` (zu viele Fehlversuche über `pair/start`, §12 Schritt 4), `confirming` (ein richtiger Code wird gerade eingelöst, Nachtrag #100), `expired`, `paired`, `closed_failures` (zu viele Fehlversuche über den QR-Weg), `closed` (am Mac mit `DELETE /devices/pairings` geschlossen), `locked` (`423`)
  - `SG-Pairing-Id`: `pairing_id` des aktuellen Fensters. Weicht sie von der eigenen ab, wurde das Fenster an anderer Stelle ersetzt.
- `POST /devices/pairings`, `pair/start` und `pair/confirm` speichern **keine** Antwort unter einem `Idempotency-Key` (08 §1), der Header wird ignoriert. Sonst stünden Code bzw. Geräte-Token im Klartext in `idempotency_key`. Antworten mit Code oder Token tragen `Cache-Control: no-store`.

## 8. Kalender: Import und Abgleich (T1-01)

**Der Abgleich ist kein Job.** Der Core erledigt ihn synchron. Begründung:
- Die Einrichtung (F-KAL-04) braucht das Ergebnis mit den Vorschlägen sofort.
- Das Parsen eines Semesters dauert Millisekunden und braucht keine KI.
- Die Logik schreibt nur Core-Tabellen und legt Sessions an (§9.2).

Bibliothek: `ical.js` (Entscheidung des Leads), Begründung und Version im Lockfile mit T1-DB. **Abnahme für T1-01:** Alle Erwartungen in `tests/fixtures/ics/*.json` müssen in einem Core-Test bestehen, inklusive Fall 6b (`TZID=Europe/Zurich` ohne `VTIMEZONE`). Dort wird die Zone als IANA-Name über die zoneinfo-Daten der Laufzeit aufgelöst (`Intl` in Node bzw. ein Paket mit IANA-Daten), nicht als UTC oder floating.

Zeitplan: URL-Quellen beim Core-Start und danach alle 6 h. Datei-Quellen nur bei neuem Upload.

**URL-Abruf:** nur `http`/`https` (keine Zugangsdaten in der URL, keine Adressen im lokalen Netz) (`webcal://` wird zu `https://`). Höchstens 5 MB, 15 s Gesamtzeit und 3 Weiterleitungen, und zwar nur auf `http`/`https`. Bei Verstoß: `502 ics_fetch_failed` mit `details.reason` (`too_large`, `timeout`, `too_many_redirects`, `status_<code>`, `blocked_address` (Ziel ist eine private, Loopback-, Link-Local- oder sonst nicht öffentliche Adresse, auch nach der DNS-Auflösung und nach jeder Weiterleitung), `invalid_url` (Weiterleitung auf ein anderes Schema oder mit Zugangsdaten), `unsupported_encoding`, `network_error`).

**Auflösen**
- **Zeitbudget:** Das Auflösen läuft in einem eigenen Thread (höchstens 2 gleichzeitig, weitere warten; höchstens 256 MB Heap je Thread) und darf höchstens 5 s ab dem Start des Threads dauern (`ics_too_complex`, 400; bei URL-Quellen steht der Fehler in `last_error`). Der Core bleibt währenddessen ansprechbar. Mehrere `VCALENDAR` in einer Datei werden alle gelesen.
- **Unterstützte Wiederholungen:** `FREQ` = `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY` mit den üblichen `BY…`-Regeln. `SECONDLY`, `MINUTELY` und `HOURLY` werden nicht aufgelöst (Warnung `rrule_unsupported`, nur der erste Termin zählt). Bei `RDATE` ohne `RRULE` ist auch `DTSTART` ein Vorkommen (RFC 5545).
- RFC 5545 mit `RRULE`, `RDATE`, `EXDATE` und `RECURRENCE-ID` (verschobene Einzelvorkommen). `STATUS:CANCELLED` setzt `cancelled = true`.
- `TZID` mit `VTIMEZONE`: deren Regeln. `TZID` ohne `VTIMEZONE`: als IANA-Name lesen. Unbekannte Zone: `TZ` des Systems, dazu eine Warnung `timezone_unknown`. Termine ohne Zone (floating) gelten in `TZ`.
- `VALUE=DATE` ergibt `all_day = true`, `starts_at`/`ends_at` auf 00:00 UTC des Datums (Testfall ics/08).
- Serien ohne `UNTIL`/`COUNT` werden für den Zeitraum **heute − 1 Jahr bis heute + 180 Tage** aufgelöst und bei jedem Abgleich fortgeschrieben. Ältere Termine **solcher Serien** zählt der Abgleich nicht als „entfallen“; für endliche Serien gilt das Fenster nicht. Lange offene Serien (`DAILY`/`WEEKLY`) beginnen die Auflösung kurz vor dem Fenster, in derselben Phase wie `DTSTART`.
- Mehrdeutige Ortszeit (Ende der Sommerzeit, z. B. 02:30) gilt als das **erste** Vorkommen, eine Zeit in der Lücke (Beginn der Sommerzeit) als die Zeit nach dem Sprung. Höchstens 5000 Vorkommen pro Quelle, darüber Warnung `too_many_events` (der Rest wird nicht mehr aufgelöst, und der Abgleich sagt dann **keine** Termine ab).
- `recurrence_id` = ursprünglicher Beginn des Vorkommens: in der Zeitzone von `DTSTART` mit Offset (`2026-10-27T10:15:00+01:00`), bei UTC-Serien mit `Z`, bei ganztägigen Serien als Datum. Einzeltermine: `null`.

**Abgleich** über `(source_id, external_uid, recurrence_id)`:
- **neu:** anlegen.
- **geändert:** `title`, `location`, `description`, `starts_at`, `ends_at`, `all_day` und `cancelled` übernehmen. Eine schon gestartete Session behält ihre Daten (F-KAL-01).
- **entfallen** (fehlt in der Quelle): `cancelled = true`. Nie löschen.
- Bei `assigned_by = auto` laufen Modul- und Artzuordnung neu, bei `manuell` nie.

**Warnungen (`IcsImportResult.warnings`):** Codes `uid_missing`, `uid_duplicate`, `event_invalid`, `rrule_unsupported`, `timezone_unknown`, `too_many_events`. Je Code stehen höchstens 5 Einträge in der Liste. Gab es mehr, folgt eine Sammelzeile des Codes (`external_uid = null`, „n weitere Hinweise dieser Art (insgesamt m)“).

**Zählweise:** `geaendert` zählt Änderungen an Titel, Ort, Beginn, Ende und ganztägig. Eine Änderung der **Beschreibung** wird übernommen, zählt aber nicht. Wird ein Termin abgesagt (`STATUS:CANCELLED`) oder fehlt er in der Quelle, zählt er als `entfallen`. Wird ein abgesagter Termin wieder aktiv, zählt er als `geaendert`. `zugeordnet` zählt nur automatische Zuordnungen in diesem Lauf.

**Zuordnung (F-KAL-02)**
- **Kandidaten** sind die Module, deren Semester den Termin enthält (`starts_on ≤ Datum ≤ ends_on`). Gibt es keins, die Module des aktuellen Semesters. Gelöschte und archivierte Semester zählen nicht.
- **Modul:** Treffer über Name, Kürzel und Dozent in Titel, Ort oder Beschreibung, unabhängig von Groß-/Kleinschreibung und Umlautschreibweise. Nur ein **eindeutiger** Treffer wird gesetzt. Sonst bleibt `module_id` leer, und die Serie erscheint in `module_suggestions`.
- **Art:** über Schlüsselwörter (Übung/UE/Ü, Tutorium/Tut, Prüfung/Klausur/Exam, Vorlesung/VL/Lecture). Ganztägig ohne Modul: `fest`. Sonst `vorlesung`.
- **Manuell:** `PATCH /calendar/events/{id}` setzt `assigned_by = manuell` (mindestens `module_id` oder `kind` ist nötig, sonst 400). Mit `scope = serie` (Standard) gilt das für alle Termine mit gleicher `source_id` und `external_uid`. Später hinzukommende Vorkommen erben die Zuordnung, **wenn alle vorhandenen Termine der Serie manuell und gleich zugeordnet sind**. Wurde nur ein Termin einzeln geändert (`scope = einzeln`), erbt kein neues Vorkommen.
- **Modulvorschläge (`IcsModuleSuggestion`):** Termine ohne Modul (nur `assigned_by = auto`, nicht abgesagt, nicht `fest`) werden nach dem bereinigten Titel gruppiert. Nennen Titel dasselbe Modul lang und abgekürzt (Stat I / Statistik I, WI / Wirtschaftsinformatik, OR / Operations Research, DBS / Datenbanksysteme), bilden sie **einen** Vorschlag mit dem Langnamen in `name` und dem Kürzel in `short` (nur wenn die Abkürzung zu genau einem Langnamen passt, höchstens 12 Zeichen). `short` gehört in `short_name` des neuen Moduls. Danach ordnet `POST /calendar/reassign` alle automatisch zugeordneten Termine neu zu, `series_event_ids` brauchen dann keinen `PATCH` mehr.
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
| `laeuft`, `pausiert` | `stop` (manuell oder Auto-Stopp aus dem Browser) | `beendet` | Mac, iPad | `ended_at`, `stop_reason`, Jobs `audio.finalize` über `ensureFinalizeOnStop` (§16.2). Zielzustand `beendet`, wenn danach noch ein Job der Session in `wartet`/`laeuft` ist, sonst gleich `verarbeitet` (geprüft nach den Aufrufen) |
| `laeuft`, `pausiert` | Start einer **später** begonnenen Session | `beendet` | Core | `stop_reason = kalenderende`, `ended_at = min(planned_ends_at, started_at der neuen Session)` |
| `laeuft`, `pausiert` | Core-Takt: Auto-Stopp-Regel 2 oder 4 greift, obwohl der Browser nicht gestoppt hat (§9.4) | `beendet` | Core | `stop_reason = kalenderende` bzw. `maximaldauer`. `ended_at` ist die **überschrittene Grenze** (bzw. `auto_stop_extended_until`, falls später), nicht die Zeit des Takts |
| `laeuft`, `pausiert` | Core-Start, und die Grenze der vorigen Zeile lag in der Zeit, in der der Core nicht lief | `beendet` | Core | `stop_reason = absturz_wiederhergestellt`, `ended_at` = letzte Aktivität (Ende des letzten Chunks oder `at` der letzten Operation, mindestens `started_at`) |
| `beendet` | alle Jobs vom Stopp durch (`fertig` oder `fehler`, kein Job mehr in `wartet`/`laeuft`) | `verarbeitet` | Worker (§3) | Ist beim Stopp kein Job der Session in `wartet`/`laeuft` (keine Aufnahme mit Chunk, oder der Job ist kurz vorher fertig geworden), setzt der Core sofort `verarbeitet`: Der Worker zöge die Session sonst nicht mehr nach. Spätere `audio.finalize`-Jobs (Nachzügler, nachträgliche Offline-Aufnahme) ändern den Zustand nicht mehr, sie aktualisieren nur `processing` |

- **Server-Operationen:** Jeder Übergang nach `laeuft`, `pausiert` oder `beendet`, den der Core selbst auslöst oder per REST ausführt, steht als `session.start`/`.pause`/`.resume`/`.stop` mit `origin = server` im Strom der Session. `bereit`, `verpasst` und `verarbeitet` haben keine Operation, sie kommen nur als Ereignis `session.updated`.
- **Nachgelieferter Stopp korrigiert den Takt:** Kommt nach einem Stopp durch Core-Takt oder Core-Start (`kalenderende`, `maximaldauer`, `absturz_wiederhergestellt` mit `origin = server`) ein `session.stop` eines Geräts mit **früherem** `at`, übernimmt der Core dessen `ended_at` und `stop_reason`. Das ist eine Korrektur ohne Zustandswechsel, mit `session.updated`. Ein späterer `at` ändert nichts (gleicher Zielzustand).
- **Gleicher Zielzustand ist kein Fehler:** `start` auf `laeuft`, `pause` auf `pausiert`, `resume` auf `laeuft` und `stop` auf `beendet`/`verarbeitet` liefern 200 bzw. `ack` ohne Änderung. Das fängt den Doppel-Tipp an Mac und iPad ab.
- **Nachgelieferte `pause`/`resume`** eines Geräts mit `at < ended_at` auf eine Session, die der Core beendet hat (`stop_reason` `kalenderende`, `maximaldauer`, `absturz_wiederhergestellt`), werden nur bestätigt, ohne Änderung.
- **Jeder andere Übergang** wird abgelehnt: `409 session_transition_invalid` mit `details: { state, action }`. Im Sync: `error` mit gleichem Code, `retryable = false`.
- **Invariante 1** gilt für `laeuft` **und** `pausiert` zusammen: höchstens eine aktive Session.
- `beendet` und `verarbeitet` lassen sich nicht wieder starten. Eine verpasste Vorlesung ohne Offline-Start bekommt Aufnahmen über den Import (F-SES-06, Phase 2).
- **Core-Neustart:** `laeuft` bleibt `laeuft` (F-SES-05), solange die Grenzen aus Auto-Stopp-Regel 2 und 4 nicht überschritten sind. Der Core-Takt prüft sie beim Start und danach jede Minute.
- **Pause und Aufnahme (T1-06):** Bei `pausiert` schließt die Web-App die laufende Aufnahme ab (`complete`), das Mikrofon bleibt offen, `MediaRecorder.pause()` wird nicht benutzt. Bei `resume` beginnt sie eine **neue** Aufnahme mit `started_ms` = aktuelle Sitzungszeit. Die Pause bleibt so als Lücke auf der Zeitachse (§10.1).
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
- **Nachgelieferter Start beendet nie eine spätere Session:** Ist beim Eintreffen eines `session.start` schon eine **andere** Session aktiv, die **später** gestartet wurde, startet der Core die nachgelieferte Session und beendet sie sofort wieder: `stop_reason = kalenderende`, `ended_at = started_at` der aktiven Session. Im Strom steht erst der `session.start` des Geräts (Client-Operation), danach der Server-`session.stop`. Ein REST-Start gilt immer als „jetzt“ und ist nie nachgeliefert. Wurde die aktive Session **früher** gestartet, gilt die normale Zeile aus §9.1.
- **`number` (VL 7):** Bei Sessions zu Terminen der Art `vorlesung` die Position in zeitlicher Reihenfolge unter den nicht abgesagten `vorlesung`-Terminen desselben Moduls. Der Core rechnet sie bei jedem Abgleich neu, solange die Session nicht gestartet wurde, danach bleibt sie fest. Sonst `null`.
- **Folien:** Wird ein Foliensatz mit `session_id` hochgeladen und hat die Session noch kein `slide_deck_id`, setzt der Core es. Ohne Folien läuft der folienlose Modus (F-SES-02).
- **Sitzungszeit:** `t_ms = Ereigniszeit − started_at`. Pausen ändern sie nicht.

### 9.3 Abweichender Offline-Start

Startet ein Gerät eine Session offline, während sie auf dem Server schon mit anderem `started_at` gestartet wurde, gilt:

- **Das `started_at` des Servers bleibt.** `session.start` auf `laeuft`/`pausiert` wird wie in §9.1 ohne Zustandsänderung bestätigt. Auf `beendet`/`verarbeitet` wird `session.start` eines Geräts ebenfalls **bestätigt** (kein Fehler, sonst ginge der Offset mit dem Rollback verloren). Ein REST-Start dort bleibt `session_transition_invalid`.
- **Die `t_ms` der Operationen dieses Geräts rechnet der Core nicht um.** Sie bleiben, wie das Gerät sie bezogen auf sein eigenes `started_at` berechnet hat.
- In diesen Fällen speichert der Core in `session.start_offsets` einen Eintrag `{ device_id, offset_ms }`, falls die beiden Startzeiten voneinander abweichen. Dabei ist `offset_ms` = `started_at` aus der Operation − `started_at` der Session (in ms). Pro Gerät gibt es höchstens einen Eintrag, der erste gilt **dauerhaft**.
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
- **`ended_at` bei Auto-Stopp aus dem Browser** ist der Zeitpunkt des Stopps, auch bei `stop_reason = stille` (kein Zurückdatieren auf den Beginn der Stille; `SessionStopRequest` kennt nur `reason`). Eine fälschlich erkannte Stille würde sonst echtes Audio aus dem Session-Zeitraum abschneiden (Lead-Entscheidung 05.11.).

## 10. Audio (T1-06)

### 10.1 Aufnahmen

- **Eine Aufnahme ist ein MediaRecorder-Strom.** Nach Neuladen oder Absturz legt die Web-App eine **neue** Aufnahme an (`started_ms` = aktuelle Sitzungszeit). Die Lücke dazwischen bleibt erhalten (02 §5).
- Aufnahmen gibt es für Sessions in `laeuft` oder `pausiert`. Chunks und `complete` sind auch danach noch erlaubt (Nachlieferung aus IndexedDB).
- **Nachträglich angelegte Aufnahme (T1-06, Lead-Entscheidung):** Hat die Web-App offline begonnen und erreicht den Core erst nach dem Ende der Session, ist `POST /sessions/{id}/recordings` auch in `beendet`/`verarbeitet` erlaubt, wenn `started_ms ≤ (Grenze − started_at) + 5 min` (`started_ms ≥ 0` gilt immer).
  - **Grenze** = `ended_at`. Ist `auto_stop_extended_until` gesetzt und später, gilt dieses. Bei `stop_reason = absturz_wiederhergestellt` ist `ended_at` nur die letzte Aktivität; dort gilt die Auto-Stopp-Grenze aus §9 (Lead-Entscheidung 05.11.): `G = max(min(planned_ends_at + lecture.auto_stop_hard_after_end_min, started_at + lecture.auto_stop_max_duration_min), auto_stop_extended_until)`, der erste Term nur bei Sessions mit Termin. Berechnet wird sie mit **derselben Funktion** wie der Core-Takt (T1-02). Umgesetzt als `autoStopBoundary(session, limits)` in `services/core/src/services/auto-stop.ts`; die Grenze aus `ended_at` bzw. `auto_stop_extended_until` gilt unverändert. `started_at + 12 h` bleibt nur Rückfall, falls die Einstellungen fehlen.
  - Sonst `409 session_not_active` mit `details.ended_at`.
  - Der Core legt `audio.finalize` mit `run_after = jetzt + 10 min` an, sobald der erste Chunk kommt (§3, §10.2). `complete` und Nachzügler ziehen ihn wie gewohnt vor.
  - Der Sessionstatus und `ended_at` bleiben unverändert (Zustandsmaschine gehört T1-02). Offen für T1-04: ob die Weiterverarbeitung einer schon `verarbeitet`en Session danach neu läuft.
- **Pause:** Siehe §9.1. Jede Pause beendet die Aufnahme, das Fortsetzen beginnt eine neue.
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
- **Nach `complete`:** Ein neuer Chunk mit `seq > completed_last_seq` wird mit `409 recording_completed` abgelehnt. Ein Chunk mit `seq ≤ last_seq` (Lücke füllen) und ein Duplikat bleiben erlaubt.
- **Leere Aufnahme:** Eine Aufnahme ohne einen einzigen Chunk (Pause oder Stopp vor dem ersten Chunk) löscht die Web-App lokal und schließt sie **nicht** mit `complete` ab. Der Core legt für Aufnahmen ohne Chunks **keinen** `audio.finalize`-Job an, weder beim Stopp (`ensureFinalizeOnStop`) noch bei `complete`; die leere Zeile bleibt bestehen (`chunk_count = 0`, `state = laeuft`). Kommt später doch ein Chunk, entsteht der erste Job: sofort bei abgeschlossener Aufnahme, mit `run_after = jetzt + 10 min` bei beendeter Session, sonst keiner (§3). Der Rückfall des Workers (`mit_luecken` bei `chunk_count 0`) bleibt.
- Nach dem letzten Chunk: `POST /recordings/{id}/complete` mit `last_seq` und `duration_ms`. Fehlt eine `seq ≤ last_seq` beim Finalisieren, wird die Aufnahme `mit_luecken`. Was sonst als fehlend gilt und wie `audio.finalize` Lücken behandelt, steht in §3.

## 11. Sync-Protokoll (T1-08, T1-09)

Ergänzt 08 §2. Alle Nachrichten: `SyncClientMessage` bzw. `SyncServerMessage`. Eine Nachricht = ein Text-Frame mit einem JSON-Objekt, höchstens 1 MB. Der Server liest das als 1 MiB (1 048 576 Byte), damit beide Lesarten des Clients passen. Größere Nachrichten schließt er mit 1009, Binär-Frames mit `error message_invalid` und 1003.

### 11.1 Verbindung und Anmeldung

- **Pfad:** `ws://<mac>:4710/sync`, außerhalb von `/api/v1`, aber eine **Netzroute** wie alle anderen (§5).
- **Prüfung beim Upgrade** (vor dem Wechsel auf WebSocket, Ablehnung als HTTP-Antwort). Das erledigt allein der Wächter (§5, `plugins/security.ts`, T1-10). Der Sync-Server liest nur `request.sgDevice` (§16.2):
  - Host-Prüfung (`421`) und **Origin-Prüfung** (`403`) wie §5. Browser senden beim Upgrade immer `Origin`. Eine fremde Webseite darf sich nicht über `localhost` verbinden (Cross-Site WebSocket Hijacking).
  - **Aus dem Netz:** `Authorization: Bearer <device_token>` ist Pflicht (`401 device_token_required|device_token_invalid`). `URLSessionWebSocketTask` setzt den Header über den `URLRequest`.
  - **Lokal** (Web-App): ohne Token.
  - Fehlt `request.sgDevice` (darf für `/sync` nicht vorkommen), sendet der Server `error device_token_invalid` (fatal) und schließt mit 4401.
- **Widerruf während des Upgrades:** `DELETE /devices/{id}` schließt offene Verbindungen des Geräts mit 4401 (§7.5). Eine Verbindung, deren Upgrade den Wächter kurz vor dem Widerruf passiert hat und erst danach beim Sync-Server ankommt, sieht `closeDeviceConnections` nicht. Darum:
  1. Der Sync-Server merkt sich widerrufene Geräte im Speicher (über `onDeviceRevoked`, §16.2) und prüft das direkt nach dem Annehmen der Verbindung, synchron. Treffer: `error device_token_invalid` (fatal), 4401.
  2. Vor `welcome` prüft er das Gerät noch einmal in der Datenbank (`device.deleted_at`). Das deckt auch einen Widerruf ab, den der Speicher nicht kennt (z. B. über einen Neustart hinweg). Treffer: wie oben.
- **Kein Token in `hello`.** `hello.device_id` ist optional und dient nur als Gegenprobe. Passt sie nicht zum Token: `error device_token_invalid` (fatal), Code 4401. Lokal gibt es kein Token zum Vergleichen: Der Server ignoriert `hello.device_id`, und `welcome.device_id` ist `null`.
- **Erste Nachricht** muss innerhalb von 5 s `hello` sein, sonst `error hello_required` und Schließen mit Code 4408. `protocol` ≠ 1: `error protocol_unsupported` (fatal), Code 4426. Verletzt `hello` das Schema: `error hello_invalid` (fatal), ebenfalls Code 4408 („kein gültiges `hello`“).
- **Antwort** `welcome` mit `server_time`, `db_epoch` und je Strom einem `resume`-Eintrag. Danach sendet der Server:
  1. die fehlenden Operationen jedes Stroms ab `from_seq` bis `head_seq` in `seq`-Reihenfolge,
  2. die aktuellen `presence`- und `device.connection`-Ereignisse der anderen Clients.
- **Resume-Fälle** je Strom aus `hello.streams` bzw. `subscribe`:

| Client meldet | Server hat | Antwort |
|---|---|---|
| `last_seq = 0`, `last_op_id = null` | beliebig | `from_seq = 1`, `reset = false` |
| `last_seq = n`, `last_op_id = x` | Operation `n` mit `op_id = x` | `from_seq = n + 1`, `reset = false` |
| `last_seq = n` | `head_seq < n`, oder Operation `n` hat eine andere `op_id` | `from_seq = 1`, `reset = true`. Für diesen Strom sendet der Server **nichts** |
| `last_seq = 0`, `last_op_id ≠ null` | beliebig | `from_seq = 1`, `reset = true` (passt zu keiner Zeile oben) |
| `last_seq = n > 0`, `last_op_id = null` | beliebig | `from_seq = 1`, `reset = true` (zählt als „andere `op_id`“) |

Bei `reset` legt der Server kein Abo an. Der Client abonniert nach dem REST-Abgleich neu.

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
- **`origin`** einer Client-Operation ist `hello.client` der Verbindung. `device_id` kommt aus dem Token (lokal `null`).
- **Kein Handler registriert** für eine bekannte `kind` (Lücke im Server, kein Fehler des Clients): `error internal_error` mit `details.reason = handler_missing`, wiederholbar, Code 4503. Nach 5 Versuchen greift die Regel für giftige Operationen.
- **Fatale, nicht wiederholbare Fehler:** `session_superseded` schließt immer mit 4409. Setzt ein Handler `fatal` bei einem anderen Code (`SyncOpError`, §16.2), schließt der Server mit 1008, bei `device_token_invalid` mit 4401. Vor jedem fatalen `error` bekommen alle früher auf dieser Verbindung empfangenen Operationen ihre Antwort.
- **`ack`-Watchdog:** Bleibt das `ack` einer committeten Operation 30 s aus (Auslieferung gestört), sendet der Server `error internal_error` (wiederholbar, `details.reason = ack_timeout`) und schließt mit 4503. Der Client sendet erneut und bekommt das Duplikat bestätigt.
- **Schutzgrenzen pro Verbindung:**
  - Rate-Limit nur für Nachrichten, die keine Operation sind (`ping`, `time.*`, `presence`, `subscribe` …): Eimer mit 200 Marken, 50 pro Sekunde nachgefüllt. Darüber: `error message_invalid` (fatal) und Code 1008.
  - Operationen begrenzt das Pending-Limit (200). Zusätzlich pausiert der Server das Lesen, solange mehr als 8 MiB empfangene Operationen auf die Bearbeitung warten. Unter 2 MiB liest er weiter.
  - Leerlauf (§11.4): Schließen mit 1001.
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
- Schließen mit 1008, 1003 oder 1009 (Schutzgrenze, Binär-Frame, zu groß) → mit Wartezeit wie nach 4503 neu verbinden. Eine Operation, die selbst über der Grenze liegt (1009) oder nicht wiederholbar abgelehnt wurde, kommt in die Fehlerablage. Sonst entstünde eine Schleife.
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
- `session.updated` geht bei jeder Änderung einer Session raus, auch bei zeitgesteuerten und vom Worker gemeldeten (§3, `pg_notify('sg_session', …)`). Den Kanal `sg_session` hört das Sync-Plugin über `listenCommittedOps(…, { channels })` und sendet den aktuellen Stand der Session (`notifySessionUpdated`). `Session.updated_at` steigt bei jeder Änderung **durch jeden Schreiber** streng monoton (`greatest(clock_timestamp(), updated_at + interval '1 millisecond')`), auch durch den Worker (`progress.py`) und beim Löschen und Wiederherstellen (`trash.ts`): Clients verwerfen ältere Fassungen darüber, und `now()` (Beginn der Transaktion) liegt bei wartenden Transaktionen vor dem Stand, auf den sie gewartet haben. Löschen und Wiederherstellen (`softDeleteWithOps`, `restoreWithOps`) senden `session.updated` für jede betroffene Session.
- `pairing.requested` geht **nur an lokale Web-Clients** (§12).
- Ereignisse werden nicht nachgeliefert. Wer neu verbindet, holt den Stand per REST (`GET /sessions`, `GET /devices` mit `connected`).
- **Reihenfolge je Verbindung:** Ein Ereignis aus `publishAfterCommit` kommt nie vor den Operationen an, die vor ihm committet wurden. Es läuft dafür über dieselbe serielle Kette wie die Operationen (§16.2). Läuft für einen abonnierten Strom der Verbindung gerade eine Nachlieferung, warten alle Ereignisse hinter ihr, auch direkte. Direkte Ereignisse (`publishEvent` bzw. `broadcastEvent` außerhalb des Listeners, z. B. `presence`, `device.connection`, `pairing.requested`) gehören zu keiner Transaktion. Sie können eine schon committete Operation überholen, deren Weitergabe über den Listener noch aussteht: ohne laufende Nachlieferung sofort, aber auch nachdem sie hinter einer Nachlieferung gewartet haben, wenn deren letzte Abfrage vor dem Commit lief (#118). Clients dürfen aus einem direkten Ereignis darum nie auf eine bereits angekommene Operation schließen. Spätere Operationen dürfen vor einem Ereignis ankommen.
- Ereignisse gehen erst nach `welcome` an eine Verbindung. Die anderen Clients erfahren von einem neuen Client direkt nach dessen `welcome` (`device.connection`).

### 11.7 Swift (iPad): Pflichten und Hilfsschicht

quicktype fasst Unions zu einem Struct mit optionalen Feldern zusammen. Außerdem lässt synthetisiertes `Codable` `nil` weg. Darum gilt für die iPad-App:

1. **Hilfsschicht nutzen:** `packages/schemas/swift-support/Sources/SyncMessages.swift` zusammen mit `generated/swift/Schemas.swift` übernehmen. Sie decodiert Nachrichten zuerst über `type`/`kind`/`name` und dann die passende Variante (`SGServerMessage`, `SGClientMessage`, `SGSyncOp`, `SGSyncEvent`, `SGPageElement`). Nie die zusammengefassten Structs `SyncOp`, `SyncServerMessage`, `PageElement` usw. zum Kodieren verwenden.
2. **Pflichtfelder mit `null` explizit kodieren:** `gen.mjs` erzeugt dafür je Struct ein `encode(to:)`. Pflichtfelder (auch nullbare) kommen per `encode`, optionale per `encodeIfPresent`. Verschachtelte Unions (`element` in `element.upsert`) laufen über die Hilfsschicht (`SGElementUpsertOp`).
3. **Datum:** Immer `newJSONDecoder()`/`newJSONEncoder()` aus `Schemas.swift` bzw. `SGSync.decoder()`/`encoder()` verwenden. Sie lesen ISO 8601 mit und ohne Sekundenbruchteile und schreiben UTC mit `Z`, Millisekunden nur, wenn sie nicht 0 sind. `.iso8601` allein kann keine Millisekunden.
4. **Unbekanntes ignorieren:** Unbekannte `type`, `kind` oder `name` ergeben `.unknown` und einen Eintrag über `SGSync.log`, keinen Fehler. Eine bekannte Operation, die sich nicht decodieren lässt (z. B. neuer Enum-Wert), ergibt ebenfalls `SGSyncOp.unknown(kind, stream, seq)`. Der Client zählt deren `seq` trotzdem mit (§11.2).
5. **Fehlercodes als String:** Unbekannte `SyncErrorCode` ergeben `.unknownError(SGUnknownSyncError)` mit `code` als String, `retryable` und `fatal`.
6. **UUIDs klein:** `UUID().uuidString` liefert Großbuchstaben, darum immer `.lowercased()`.

Nachweis: CI-Job **Swift-Contract** (`bash packages/schemas/swift-support/check.sh`). Er kompiliert `Schemas.swift` mit der Hilfsschicht und decodiert alle gültigen Beispiele der Sync-Typen, `Stroke` und `PageElement`, der REST-Typen des iPads (`Device`, `DeviceList`, `PairStartResponse`, `PairResponse`, `Notebook`, `NotebookList`, `NotebookPages`, `Page`, `PageStrokes`, `PageDetail` über `SGPageDetail`, `Session`, `SessionList`, `SessionSnapshot`, `Settings`, `FileReceipt`) sowie `tests/fixtures/strokes/*.json`. Dann kodiert er sie wieder und vergleicht sie mit dem Original, `null`-Felder und Millisekunden eingeschlossen. Dazu prüft er das Ignorieren unbekannter Nachrichten und Fehlercodes. Kompiliert wird im **Swift-6-Sprachmodus**, damit die iPad-App mit dem Xcode-Standard bauen kann. Einschränkung: `SGServerMessage` ist noch nicht `Sendable` (wegen `JSONAny` in `SyncError.details`) und darf deshalb nicht über Isolationsgrenzen gereicht werden. Das wird in #97 nachgezogen. Auf dem Mac prüft das Skript die Dateien zusätzlich gegen das iOS-SDK.

### 11.8 Mehrere Browser-Tabs (Web-Sync-Client)

Nur **ein** Tab synchronisiert: Er hält die Verbindung, sendet die Warteschlange und empfängt Operationen und Ereignisse.
- **Leader** ist der Tab, der das Lock (`navigator.locks`) hält. Ohne Web Locks ist ein Tab immer Leader.
- `connect()` löst auf, sobald die Rolle feststeht. Bis dahin ist der Zustand `acquiring`. Liegt das Lock nachweislich in einem anderen Tab, ist er `other_tab`.
- **Folge-Tabs synchronisieren nicht.** Sie schreiben nichts in die Warteschlange und abonnieren nichts. `send()` wirft dort `SyncNotLeaderError`, ohne `connect()` `SyncNotConnectedError`.
- **Hier übernehmen** (`takeOver()`, Web Locks `steal`): Der alte Leader trennt sauber und zeigt `other_tab`. Seine offenen `send()`-Aufrufe enden mit `SyncHandedOverError` (die Operation liegt in der Warteschlange und wird vom neuen Leader gesendet, **nicht neu senden**) bzw. `SyncNotLeaderError` (noch nicht gespeichert). Der neue Leader liest die Warteschlange vollständig aus der IndexedDB. Schließt der Leader-Tab, übernimmt der wartende Tab.
- Der `BroadcastChannel` meldet nur „Leader hat gewechselt“ (Client-Ereignis `leader.changed`; der Fachcode lädt seinen Stand per REST neu). Operationen werden nicht zwischen Tabs weitergeleitet.
- **Restfenster beim Wechsel:** Hat der alte Leader ein `append` gestartet, bevor er den Verlust der Rolle bemerkt, und der neue Leader die Warteschlange schon gelesen, würde die Operation bis zur nächsten Übernahme liegen bleiben. Darum sendet der alte Tab nach einem solchen `append` den Hinweis `enqueued` über denselben `BroadcastChannel`. Nur der Leader wertet ihn aus: Er liest die Warteschlange erneut und hängt unbekannte Einträge an (Einträge im Speicher und gerade bestätigte bleiben unberührt). Kommt der Hinweis, während er noch liest, liest er nach, sobald er Leader ist. Das ist ein Hinweis zum Nachlesen, keine weitergeleitete Operation.
- **Rückfälle:** Ohne `BroadcastChannel` bleibt das Restfenster bis zur nächsten Übernahme bestehen (die Operation geht nicht verloren, sie wird dann beim Lesen gefunden). Ohne Web Locks ist jeder Tab Leader (kein Hinweis nötig, aber auch keine Abstimmung).
- **Bedeutung der Ergebnisse von `send()`** (für den Fachcode):

| Ergebnis | Bedeutung | Fachcode |
|---|---|---|
| `ack` | Der Server hat die Operation angenommen. Auch bei einem Wechsel mitten in der Bestätigung. | fertig |
| `SyncRejectedError` | Endgültig abgelehnt, liegt in der Fehlerablage. | nicht neu senden, Fehlerablage zeigt es |
| `SyncHandedOverError` | Liegt in der Warteschlange und wird von einem anderen Tab gesendet. | **nicht** neu senden |
| `SyncNotLeaderError`, `SyncNotConnectedError` | **Nicht** gespeichert (Folge-Tab bzw. kein `connect()`). | nur im Leader-Tab bzw. nach `connect()` erneut versuchen |

#### Aufnahme nur im Leader-Tab (Issue #106, Lead-Entscheidung)

Im Live-Dashboard nimmt **nur der Sync-Leader-Tab** auf (F-AUD-01). Das gilt zusätzlich zu §9.1 (Pause) und §10.1 (Aufnahmen); REST und Sync-Verträge ändern sich nicht.
- **Leader** heißt hier: Der Verbindungszustand des `SyncClient` ist nicht `idle`, `acquiring`, `other_tab` oder `closed`. Auch offline (`backoff`, `failed`) bleibt der Leader-Tab Aufnahme-Tab.
- **Start und Fortsetzen:** Läuft die Session (`laeuft`) und der Tab ist Leader, öffnet er das Mikrofon und beginnt eine Aufnahme. Der Browser-Dialog erscheint nur nach einer Nutzeraktion („Aufnahme starten“); ist die Berechtigung schon erteilt (`navigator.permissions`), startet die Aufnahme von selbst. `pausiert` beendet die Aufnahme (`complete`, Mikrofon bleibt offen), `beendet` stoppt sie samt letztem Chunk.
- **Leader-Wechsel (`takeOver`, Tab geschlossen):** Der alte Tab beendet seine Aufnahme sauber (letzter Chunk, `complete`) und gibt das Mikrofon frei. Der neue Leader beginnt eine **neue** Aufnahme mit `started_ms` = aktuelle Sitzungszeit. Die Lücke dazwischen gilt als Stille (F-AUD-01).
- **Nie zwei Tabs gleichzeitig:** Vor `start()` holt der Tab die Aufnahme-Sperre `sg-recording` (Web Locks) und gibt sie erst nach dem Stopp frei. Ein neuer Leader wartet also, bis der alte Tab fertig ist; schließt der alte Tab, gibt der Browser die Sperre frei. Ohne Web Locks gilt nur die Leader-Regel.
- **Folge-Tabs** nehmen nicht auf und zeigen in der Statusleiste „Aufnahme in anderem Tab“. Ohne Mikrofon (verweigert, fehlt) läuft die Session weiter, Notizen gehen weiter; die Statusleiste zeigt „Zugriff verweigert“ bzw. „Mikrofon fehlt“.
- **Auto-Stopp:** Die Pegel (§16.2) stammen nur vom aufnehmenden Tab. Folge-Tabs und Tabs ohne Mikrofon liefern keine Pegel; dort gelten nur die harten Grenzen (§9.4).

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
   - **Höchstens 10 offene Anfragen pro Fenster.** Offen heißt: nicht abgelehnt. Die elfte `pair/start`-Anfrage bekommt `429 pairing_requests_full`. Lehnt der Nutzer eine Anfrage ab, wird ein Platz frei.
   - Die Web-App bekommt `pairing.requested` (Nutzlast `PairingRequest`) und listet die Anfragen. Nach dem Neuladen holt sie sich die offenen Anfragen über `GET /devices/pairings/requests` (nur lokal, `PairingRequestList`). Das ist eine eigene Route statt einer Erweiterung von `POST /devices/pairings`: Die Antwort des POST gibt es nur einmal beim Öffnen, Anfragen kommen aber erst danach, und das Neuladen darf kein neues Fenster öffnen (das würde das alte ersetzen, Schritt 1).
   - Eine fremde Anfrage kann der Nutzer ablehnen (`DELETE /devices/pairings/requests/{request_id}`, nur lokal).
   - **Phishing:** `device_name` ist frei wählbar, jeder im Netz kann sich „iPad von Ilian“ nennen. Die Web-App empfiehlt darum den **QR-Weg** und zeigt bei Anfragen aus dem Bonjour-Weg einen Hinweis, dass Name und Absender nicht geprüft sind. Der Code bleibt das Geheimnis.
3. **Bestätigen:** Der Nutzer tippt den Code am iPad ein, oder der QR-Scan liefert `pairing_id` und Code. Das iPad ruft `POST /devices/pair/confirm` auf.
   - `pairing_id` muss das offene Fenster sein. **Das Geheimnis ist der Code.** Die Nonce wird nicht gegen fremde `pair/start`-Anfragen geprüft, ein QR-Scan klappt also auch, wenn sich vorher jemand anderes angemeldet hat.
   - Gehört `public_nonce` zu einer **abgelehnten** Anfrage: `403 pairing_request_rejected`.
   - Antwort: `device_token`, 32 Byte Zufall, base64url. Gespeichert wird nur `sha256` als `token_hash`. Danach ist das Fenster geschlossen.
4. **Fehlversuche** (falscher Code zur gültigen, offenen `pairing_id`) zählen pro Nonce, pro Fenster **und** global. Unbekannte `pairing_id` und abgelehnte Nonces zählen nicht zum Budget, sie werden nur abgewiesen.
   - **Pro Nonce:** Nach 5 falschen Codes wird diese Nonce abgewiesen (`pairing_code_invalid`). Andere Geräte sind nicht betroffen.
   - **Pro Fenster:** Nach 20 falschen Codes ist das Fenster geschlossen (`pairing_window_closed`). Die Web-App zeigt „Viele Fehlversuche“.
   - **Global:** Bei mehr als 20 falschen Codes pro Stunde sind alle `pair/*`-Aufrufe gesperrt (`423 pairing_locked`), bis am Mac ein neues Fenster geöffnet wird.
   - **Neues Fenster setzt zurück:** Ein neues, **lokal** geöffnetes Fenster (`POST /devices/pairings`) setzt den globalen Stundenzähler und die Sperre zurück, ebenso die Zähler pro Nonce und pro Fenster. Sonst reichte ein falscher Code pro neuem Fenster, um wieder mit `423` zu sperren. Da nur der Nutzer am Mac das Fenster öffnen kann (`local_only`), kann ein Angreifer die Zähler nicht selbst zurücksetzen.
   - **Restrisiko (DoS):** Ein Angreifer im selben WLAN kann die Kopplung durch Raten oder durch Anfragen **blockieren, solange er im Netz ist**: Er verbraucht das Budget (20 falsche Codes schließen das Fenster) und kann nach jedem neuen Fenster erneut raten. Ohne Code übernehmen kann er sie nicht. Abhilfe: in einem anderen Netz koppeln (Heim-WLAN oder Hotspot). Ein neues Fenster am Mac hebt die Sperre auf, hilft aber nicht gegen einen Angreifer, der weiter raten darf.
   - **Pro Absenderadresse:** höchstens 10 `pair/*`-Aufrufe pro Minute (`429 pairing_rate_limited`).
5. **Speicherung des Codes:** nur **im Speicher** des Core-Prozesses, nie in der Datenbank. Der Code wird mit `crypto.randomInt` erzeugt und mit `crypto.timingSafeEqual` verglichen.
   - Gründe: Er lebt höchstens 5 min, und es gibt genau einen Core-Prozess.
   - Ein Hash eines 6-stelligen Codes wäre offline in Sekunden durchprobiert. HMAC bräuchte ein weiteres Server-Geheimnis, das verwaltet werden müsste.
   - Folge: Ein Neustart des Core schließt das Fenster, der Nutzer öffnet es neu.
6. Gerät entfernen (`DELETE /devices/{id}`) widerruft das Token sofort und schließt seine Verbindungen (08 §3).
7. **Nachtrag T1-10: Schutz gegen Blockade (DoS) und Präzisierungen.**
   - **Problem:** `pair/start` gibt jedem im WLAN die `pairing_id`. Damit konnte ein Angreifer mit 20 falschen Codes das ganze Fenster schließen, nach jedem neuen Fenster wieder (Restrisiko aus Schritt 4). Das echte iPad kam so auch per QR-Code nicht durch.
   - **Lösung: zwei Kennungen pro Fenster.**
     - Die `pairing_id` aus `PairingCode` und dem QR-Code ist **geheim**: eine zufällige UUID (v4, 122 Bit). Sie steht nur im QR-Code und in der lokalen Web-App, nie in einer Antwort an das Netz.
     - `pair/start` antwortet mit einer zweiten, **öffentlichen** `pairing_id` desselben Fensters. Diese steht auch in `PairingRequest.pairing_id`. Für das iPad ändert sich nichts: Es schickt bei `confirm` die `pairing_id`, die es hat (QR oder `pair/start`).
     - Fehlversuche zählen **je Weg**: 20 falsche Codes über die öffentliche Kennung schließen nur den Weg über `pair/start` (Bonjour und manuelle Eingabe: `409 pairing_window_closed`, Zustand `qr_only`). Der QR-Weg bleibt offen. 20 falsche Codes über die geheime Kennung schließen das Fenster (`closed_failures`), das kann nur, wer den QR-Code sieht.
     - Pro Nonce (5) und global (mehr als 20 pro Stunde → `423`) gelten wie in Schritt 4, gezählt über beide Wege. Ein Angreifer ohne QR-Code kommt pro Fenster auf höchstens 20 Fehlversuche und löst die Sperre darum nicht allein aus.
     - Brute-Force bleibt bei höchstens 20 Versuchen pro Fenster (Trefferchance ≤ 2·10⁻⁵). Die geheime Kennung zu raten ist aussichtslos. Unbekannte Kennungen zählen weiterhin nicht zum Budget.
     - **Restrisiko:** Den Weg über `pair/start` (Bonjour, manuelle Eingabe) kann ein Angreifer im selben WLAN weiter blockieren, solange er dort ist. Die Web-App empfiehlt dann den QR-Code bzw. ein anderes Netz.
   - **Ablauf im Core:** Alle Prüfungen und Zähler ändern sich synchron im Speicher. Ein richtiger Code schließt das Fenster sofort für alle anderen, bevor das Gerät angelegt wird. Von gleichzeitigen `confirm`-Aufrufen gewinnt genau einer, die anderen bekommen `409 pairing_window_closed`. Scheitert das Anlegen, ist das Fenster wieder offen, außer ein `DELETE /devices/pairings` kam während des Anlegens: Dieses Schließen wird gemerkt und beim Scheitern angewendet (#91).
   - **Nonce:** `pair/start` mit einer Nonce, die im Fenster schon eine Anfrage hat, liefert dieselbe Anfrage (auch eine abgelehnte, sie wird nicht wieder geöffnet). Eine abgelehnte Nonce wird auch über den QR-Weg abgewiesen (`403 pairing_request_rejected`).
   - **Rate-Limit:** „Absenderadresse“ ist die Socket-Adresse. IPv4-mapped (`::ffff:a.b.c.d`) zählt wie IPv4, IPv6 je /64-Netz. Abgewiesene Aufrufe zählen nicht mit. Der Core merkt sich höchstens 4096 Adressen. Heute lauscht der Core nur auf IPv4 (`SG_CORE_HOST=0.0.0.0`). Wird er auf `::` umgestellt, muss die /64-Regel neu bewertet werden: Ein Angreifer mit einem eigenen Präfix hat viele /64-Netze, ein Heimnetz teilt sich eins.
   - **Gerätename und `app_version`:** NFKC-normalisiert. Leerraum wird zu einem Leerzeichen. Entfernt werden alle Zeichen der Kategorien Cc, Cf, Zl und Zp, also auch Bidi-Steuerung, U+200B–U+200D, U+061C, U+2060, U+FEFF und Tag-Zeichen. Der Name hat höchstens 64 Zeichen, `app_version` wird auf 64 Zeichen gekürzt (wie `maxAppVersionLength` in T1-08). Bleibt vom Namen nichts übrig: „Unbenanntes Gerät“. Nachtrag #91: Zusätzlich entfernt werden `Default_Ignorable_Code_Point` (U+3164, U+FFA0, Variation Selectors …) und U+2800; ohne sichtbares `\p{L}`, `\p{N}`, `\p{P}` oder `\p{S}` gilt der Name als leer, und mehr als 2 Kombinationszeichen pro Basiszeichen werden auf 2 gekürzt.
   - **Unbemerkte Übernahme** (jemand fotografiert Code oder QR-Code ab und koppelt schneller): Die Web-App meldet jede Kopplung mit Name und Art („‚X‘ (iPad) wurde gekoppelt. Nicht du?“) und bietet direkt „Entfernen“ an. Geräte, die jünger als 24 h sind, sind in der Liste als „Neu gekoppelt“ markiert. Wird die Ansicht verlassen, schließt die Web-App das Fenster (`DELETE /devices/pairings`), ein Code gilt dann nicht mehr bis zum Ablauf weiter.
   - **Host:** IPv4 der Schnittstelle `en0`, sonst einer anderen `en*`, sonst einer sonstigen. VPN-Tunnel, Docker, Bridges und AirDrop zählen nicht, Link-Local (169.254.x.x) nur als letzter Ausweg. Ohne Netz: `127.0.0.1`.
   - **Bonjour:** Name `Studien-Gehirn (<Macname>)`, TXT `v=1`, `name=<Macname>` (Rechnername ohne `.local`). Startet nur, wenn `SG_CORE_HOST` nicht Loopback ist. `SG_BONJOUR=0` schaltet die Ankündigung ab. Fehler (kein Multicast) werden nur protokolliert.
   - Code und Token stehen in keinem Log und in keiner Fehlermeldung. Das Request-Log schwärzt Query-Parameter, deren Name an Namensgrenzen (`_`, `-`) `pairing_id`, `token`, `wstoken`, `access_token`, `secret`, `password`, `nonce`, `code`, `api_key` oder `auth` entspricht (`author`, `sort_key`, `session_id` bleiben lesbar), auf allen Routen (`[Redacted]`, auch in Meldungstexten wie „Route … not found“); die Kennung bleibt darum in `DELETE /devices/pairings?pairing_id=` (#91). Jeder falsche Code bekommt dieselbe Antwort.
     - Nachtrag #100 (H-1): Die Query wird dabei zerlegt wie von Fastify (find-my-way und Query-Parser): Sie beginnt beim ersten `?` **oder** `#`, je nachdem, was zuerst kommt (`DELETE /devices/pairings#pairing_id=…` liest Fastify als Query). Paare trennt nur `&`, ein Wert reicht bis zum nächsten `&` (auch über ein weiteres `#` oder `?` hinweg). So bleibt kein Rest eines geheimen Werts stehen. Führende `?`/`#` im Namen zählen beim Vergleich nicht (`#?pairing_id=` wird geschwärzt). Integrationstests prüfen die echte Logausgabe von `DELETE /devices/pairings?pairing_id=…` (204, 400, 404) und `…pairings#pairing_id=…` (roh über TCP, weil `inject` `#` abschneidet) mit den Logger-Optionen des Betriebs; ein Unit-Test vergleicht die Zerlegung direkt mit der von Fastify.
   - **Zustand während des Einlösens (#100, H-4):** Zwischen richtigem Code und angelegtem Gerät meldet `SG-Pairing-State` `confirming` (nicht mehr `open`), auch wenn das Fenster in dieser Zeit abläuft. Danach folgt `paired`. Scheitert das Anlegen, folgt wieder `open` bzw. `qr_only`, `closed`, wenn währenddessen geschlossen wurde, oder `expired`, wenn das Fenster währenddessen abgelaufen ist. Die Web-App kennt den Wert und zeigt währenddessen das Fenster unverändert an.
   - **Keine Drosselung falscher Geräte-Tokens je Adresse (#100, H-3, bewusst nicht umgesetzt):** Ein formal gültiges, aber unbekanntes Token kostet eine Abfrage über den eindeutigen Index auf `token_hash`. Raten ist bei 256 Bit aussichtslos, übrig bleibt nur Last (Gegen-Review: 200 parallele Verbindungen aus dem LAN heben den Median einer lokalen `GET /devices` von 1,7 auf 37 ms, der Core bleibt bedienbar). Eine Drosselung je Quelladresse müsste entweder auch gültige Tokens dieser Adresse abweisen, ohne sie zu prüfen (neue Blockade gegen das echte iPad, wenn es sich die Adresse mit dem Angreifer teilt: NAT, Hotspot, gemeinsames IPv6-/64), oder gültige Tokens im Speicher halten (widerspricht „Prüfung ohne Cache“ aus §5, der Widerruf soll sofort wirken). Die Log-Flut durch abgelehnte Anfragen ist seit #87/#101 begrenzt (eine Zeile je Quelle und Minute). Gegen reine Lastangriffe aus demselben WLAN (Verbindungsflut) hilft ohnehin nur ein anderes Netz.
   - **Restrisiko Relay über mDNS (#100, H-5):** Bonjour ist nicht authentisiert. Ein Angreifer im selben WLAN kann auf die mDNS-Anfrage antworten und einen eigenen `_studiengehirn._tcp`-Dienst (gleicher Name) anbieten. Das iPad schickt `pair/start` und den eingetippten Code dann an ihn, er reicht beides an den echten Mac weiter (Relay/MITM) und bekommt das Geräte-Token. Am Core ist das nicht erkennbar: Code und Ablauf sind gültig, nur der Absender ist der Angreifer. Der Mac zeigt die Anfrage zwar an, mit frei gewähltem Namen (Phishing, Schritt 2). Abhilfe: **Für das iPad den QR-Weg nehmen.** Der QR-Code enthält die IP des Macs und die geheime `pairing_id`, das iPad verbindet sich direkt, ohne Bonjour. Auch eine von Hand eingetippte IP des Macs umgeht Bonjour und damit diesen Angriff. Gegen einen Angreifer, der den Verkehr im WLAN selbst umleitet (ARP-Spoofing), hilft auch das nicht; das deckt das Restrisiko Klartext ab (TLS in Phase 2). Die Web-App empfiehlt den QR-Weg schon (Schritt 2); in der iPad-App soll der QR-Scan der vorgeschlagene Weg sein, die Bonjour-Liste mit manueller Code-Eingabe nur die Ausweichmöglichkeit.
   - **Restrisiko Klartext:** Token, Code und Sync laufen in Phase 1 unverschlüsselt über HTTP bzw. WS. In einem offenen WLAN oder einem WLAN mit gemeinsamem Passwort (WPA2-PSK) kann jemand im selben Netz mitlesen und ein Token übernehmen. Abhilfe bis dahin: Gerät entfernen und neu koppeln, sensible Arbeit im Heimnetz oder über den Hotspot. TLS kommt in Phase 2.

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
- **Wiederherstellung:** `pnpm sg restore <stand>` bei gestopptem Core. Sie setzt eine neue `sync_meta.db_epoch` (§11.1). Test von Hand: `pnpm sg restore --test <stand>` in eine Wegwerf-Datenbank mit Zählung der Objekte (F-DAT-02). Monatlich automatisch: siehe „Automatischer Restore-Test“ unten.

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
  - `backup_encryption = true` lässt den Lauf mit Hinweis scheitern (`age` ist P1, nie unverschlüsselt sichern, wenn Verschlüsselung gewünscht ist). Neu setzen lässt es sich nicht mehr (`PATCH /settings` → `400 backup_encryption_unavailable`, §14.1). Ein Altbestand `true` bleibt bewusst fail-closed: Der Lauf scheitert mit klarer Meldung, die Oberfläche zeigt einen Hinweis mit Knopf „Ohne Verschlüsselung sichern“ (setzt ausdrücklich `false`).
  - **Backup-Ziel:** `sg backup` prüft das Ziel mit demselben Helfer wie der Core (`@sg/shared/backup-target`, §14.1): absoluter Pfad, `realpath`, kein Systemordner, **der ganze Datenordner ist gesperrt** (auch `backups/` darin und `sg backup --ziel <datenordner>/backups`; ein Backup dort schützt nicht gegen Plattendefekt). Einziger Unterschied: Die CLI legt einen fehlenden Zielordner an (Elternordner muss existieren). `copyTree` überspringt zusätzlich `*.partial` als zweite Schutzlinie. Der Datenordner enthält kein `backups/` mehr.
  - `sg migrate`/`sg start` sichern vor ausstehenden Migrationen (`vor_migration`), wenn ein Ziel gesetzt ist; scheitert es, wird nicht migriert (`--ohne-backup` übergeht das).
  - `sg restore` (ohne Stand: Liste) spielt in eine neue Datenbank und neue Ordner ein und tauscht danach. Die alte Datenbank (`<db>_vor_restore_<zeit>`) und Ordner (`media.vor-restore-<zeit>`) bleiben liegen.

- **Automatischer Restore-Test (F-DAT-02, #78):**
  - **Zeitplan:** Der minütliche Takt des Core (`tickRestoreTest`) startet den Test, wenn ein Ziel gesetzt ist, kein Backup und kein Test läuft und der Test fällig ist: noch keiner gelaufen, **30 Tage nach dem letzten bestandenen** (auch ein von Hand gestarteter zählt) oder nach einem fehlgeschlagenen am nächsten Kalendertag (kein Dauerfeuer). War der Mac zum Termin aus, holt der nächste Takt nach dem Start es nach. Gibt es noch kein testbares Backup (siehe unten), wird nichts protokolliert und im nächsten Takt erneut versucht.
  - **Backup und Test schließen sich in beide Richtungen aus** (das Ausdünnen könnte sonst den getesteten Stand löschen): Beide Starts im Core laufen unter derselben Sperre (`BACKUP_LOCK_KEY`). `POST /backup` antwortet `409 restore_test_running`, solange ein Test läuft, `POST /restore-test` und der Zeitplan weichen einem laufenden Backup (`backup_running`), `tickBackup` wartet auf das Ende des Tests. `sg backup` direkt auf der CLI (auch `sg migrate`/`sg start` vor Migrationen) bricht mit Exit 4 und klarer Meldung ab, wenn `restore_test.state = laeuft` (jünger als 2 Stunden). Umgekehrt prüft ein direkt gestartetes `sg restore --automatisch` nicht auf ein laufendes Backup (Grenze: ein gleichzeitiges Ausdünnen lässt den Test mit `beschaedigt`/`kein_backup` scheitern, es ist kein Sicherheitsproblem).
  - **Start:** Der Core legt den Eintrag `laeuft` selbst an und startet `node infra/sg/src/main.ts restore --automatisch --trigger zeitplan|manuell` (Ausgabe in `logs/restore-test.log`). Die CLI läuft ohne Rückfrage und bei laufendem Core. Ein `laeuft` älter als 2 Stunden gilt als `abgebrochen`. Endet die CLI mit Fehlercode, ohne ihr Ergebnis geschrieben zu haben, setzt der Core `fehler`/`intern`.
  - **Vertrauen (Sicherheit):** `pg_restore` führt SQL als Datenbank-Superuser aus. Ein Stand im Ziel ist nicht authentisch, das Ziel (externer Datenträger, iCloud, Netzlaufwerk) kann für Dritte beschreibbar sein. Die Zusage gilt ausdrücklich nur, wenn **alle** folgenden Punkte halten:
    1. `--automatisch` nimmt weder `<stand>` noch `--ziel` an, sondern nur das Ziel aus `data.backup_target` und nur einen Stand, zu dem es einen **eigenen, protokollierten Lauf** gibt: `backup_run` mit `state = fertig`, diesem Ziel, `stand` und `dump_sha256` (Migration `0004_restore_test`). Läufe vor dieser Version haben keine Prüfsumme und werden nie automatisch getestet. Geprüft werden die jüngsten 5 solchen Läufe, deren Stand noch im Ziel liegt.
    2. **`dump_sha256` entsteht aus den Bytes, die `pg_dump` geschrieben hat** (nicht aus einer Datei im Ziel): `sg backup` lässt `pg_dump` in einen privaten Ordner schreiben (`<Datenordner>/tmp/backup-…`, Ordner 0700), liest die Datei **einmal** und bildet dabei die Prüfsumme und die Kopie ins Ziel (`wx`: eine im Ziel vorab angelegte Datei lässt den Lauf scheitern, statt durch einen Symlink zu schreiben). Eine Manipulation des Ziels während oder nach dem Dump ändert die Prüfsumme in der Datenbank nicht (B2, TOCTOU).
    3. **Prüfen und Einspielen betreffen dieselben Bytes:** Vor jedem Einspielen (`restore --automatisch`, `restore --test <stand>` **und** `restore <stand>`) liest die CLI den Dump **einmal** aus dem Ziel und schreibt dabei eine Kopie in einen privaten Ordner (`<Datenordner>/tmp/restore-…`, Ordner 0700, Datei 0600), bildet im selben Lesevorgang die Prüfsumme und vergleicht sie mit dem Manifest (beim automatischen Test zusätzlich: das Manifest muss exakt die Prüfsumme aus `backup_run.dump_sha256` tragen, sonst `nicht_authentisch`). Erst danach wird **genau diese Kopie** an `pg_restore` gegeben (lokal und im Docker-Modus), und sie wird danach immer gelöscht, auch bei Fehlern (B1, TOCTOU: Der Pfad im Ziel wird nach dem Prüfen nie wieder geöffnet). Das gilt seit #78 auch für den bereits bestehenden manuellen Restore aus T1-18.
    4. Die Datenbank ist die Vertrauensquelle, das Ziel nicht. Wer nur das Ziel beschreiben kann, kann weder die Prüfsumme in der Datenbank noch den privaten Ordner ändern.
    Grenzen: Wer als derselbe Benutzer am Mac läuft oder die Datenbank beschreiben kann, ist nicht Teil des Modells. `restore --test <stand>` und `restore <stand>` von Hand vertrauen weiterhin dem Aufrufer bei der Wahl des Standes (nur die Bytes sind gegen Austausch zwischen Prüfen und Einspielen gesichert, das Manifest ist dort nicht verankert). Der private Ordner braucht Platz für eine Kopie des Dumps.
  - **Ablauf:** Dieselbe Prüflogik wie `restore --test` (`restoreIntoScratch`): neue Wegwerf-Datenbank `<db>_autotest_<zufall>`, `pg_restore` der geprüften Kopie, Objekte zählen, Tabellen des Manifests vorhanden, Dateizahl und Größe von `media/` und `vault/` gegen das Manifest (Zeilen-Abweichungen sind nur ein Hinweis im Log). Die Wegwerf-Datenbank wird **immer** gelöscht (`finally`), übrig gebliebene `<db>_autotest_*` eines abgestürzten Tests räumt der nächste Lauf weg. Die echte Datenbank und der Datenordner werden vom Test nie geändert. Das gilt für einen authentischen Dump; ein nicht authentischer wird nach Punkt 1 bis 3 gar nicht erst eingespielt.
  - **Ergebnis:** `setting`-Schlüssel `restore_test` (nicht in `GET /settings`), geschrieben von der CLI, ausgeliefert als `BackupStatus.restore_test` (`RestoreTest`, `null` = noch keiner): `state` `laeuft | ok | fehler`, `trigger` `zeitplan | manuell`, `started_at`, `finished_at`, `stand`, `is_latest` (`true` = der getestete Stand war der jüngste erfolgreiche Lauf, `false` = ein älterer, weil der jüngste nicht testbar war oder nicht mehr im Ziel liegt, `null` = unbekannt), `reason`, `error` (höchstens 500 Zeichen, ohne Passwort und Datenordner). `reason` ist bei `fehler` einer von `kein_ziel`, `kein_backup`, `ziel_nicht_erreichbar`, `nicht_authentisch`, `beschaedigt`, `dateien_abweichend`, `tabellen_fehlen`, `restore_fehlgeschlagen`, `abgebrochen`, `intern`. Die Oberfläche (Einstellungen → Daten) zeigt daraus „Letzter Restore-Test: <Datum>, erfolgreich“, den getesteten Stand (mit Warnhinweis bei `is_latest = false`) bzw. einen deutschen Hinweis mit Handlungsempfehlung je `reason`.
  - **`POST /restore-test`** („Jetzt testen“) ist **nur lokal** (`403 local_only` aus dem Netz, auch mit Geräte-Token) und startet denselben Ablauf mit `trigger = manuell`. 409: `restore_test_running`, `backup_running`, `backup_target_missing`, `restore_test_no_backup` (noch kein Lauf mit Prüfsumme für das aktuelle Ziel).
- **Restore im Detail (T1-18):**
  - Vor jeder Änderung prüft `sg restore` Prüfsumme des Dumps, Dateianzahl und Größen gegen das Manifest (`.DS_Store`, `*.part`, `.tmp` zählen nie) und die Schemaversion: Ist der Stand **neuer** als der Code (`manifest.migrations` > Migrationen im Repo), bricht er ab (erst die App aktualisieren), **älter** ist erlaubt, die Migration läuft danach beim nächsten `sg start`/`sg migrate`.
  - Der Tausch ist atomar: Die beiden `ALTER DATABASE … RENAME` laufen in **einer** Transaktion (der Commit-Punkt), davor liegen die neue Datenbank und die Ordner `*.neu-<zeit>` bereit. Vor der ersten Änderung steht `restore.journal.json` im Datenordner (Phase, Namen).
  - `sg start` und `sg restore` erkennen ein offenes Journal: Ist die Datenbank getauscht, werden die Ordner fertig getauscht, sonst wird alles zurückgebaut. Beides ist beliebig wiederholbar.
  - Backups sind nicht signiert oder authentifiziert: Eingespielt werden dürfen nur eigene Backups (steht auch in `pnpm sg --help`).
- **Backup-Details (T1-18):**
  - Aufbewahrung: Zusätzlich zu 14/8/6 bleiben die **letzten 3 Stände mit `trigger = vor_migration`** unabhängig von der Ausdünnung erhalten.
  - Dateien, die während des Kopierens verschwinden, werden übersprungen und als Hinweis gezählt. Das Ziel wird per `realpath` aufgelöst, bevor geprüft wird, ob es in `media/` oder `vault/` liegt.
  - Das Backup vor einer Migration ist fail-closed: Lässt es sich nicht ausführen oder scheitert es, wird **nicht** migriert (`pnpm sg migrate --ohne-backup` überspringt es ausdrücklich). Ausnahme ohne Fehler: Es ist kein Backup-Ziel eingestellt (dann nur ein Hinweis) oder es steht keine Migration an.
- **`purged_count` / `DELETE /trash`:** `DELETE /trash` zählt direkt gelöschte Objekte wie in der Liste (auch solche, die als Teil eines anderen Objekts verschwinden) und prüft vorab, dass keine laufende Session im Teilbaum liegt (`409 session_active`, dann wird nichts gelöscht). `MaintenanceNightlyResult.purged_count` dagegen zählt gelöschte **Zeilen** der Papierkorb-Tabellen (ohne Folien, Striche, Chunks usw.), `purged_by_kind` je Tabelle.

**`maintenance.nightly`** (Worker, T1-18)
- **Anlegen:** Der Core legt den Job täglich um 03:30 Ortszeit an, mit Payload `MaintenanceNightlyPayload` (Standard `{}` = 30 Tage, ohne `dry_run`). Ergebnis: `MaintenanceNightlyResult`.
- **Umfang in Phase 1:**
  1. Objekte mit `deleted_at` älter als `purge_older_than_days` endgültig löschen, Kinder vor Eltern, samt ihrer Dateien.
  2. `sync_op` und `sync_stream` der dabei gelöschten Notizbücher und Sessions entfernen. Sonst bleibt `sync_op` erhalten, solange das Objekt des Stroms existiert, auch im Papierkorb.
  3. Verwaiste Dateien entfernen: Fotos ohne `photo`-Zeile nach 30 Tagen, `*.part`-Dateien älter als 1 Tag.
- **Ablauf je Wurzel:** eine eigene Transaktion pro Wurzel. Zuerst die Ströme sperren, dann die Wurzelzeile `FOR UPDATE` und unter der Sperre erneut prüfen (`deleted_at IS NOT NULL` und älter als die Frist): Eine inzwischen wiederhergestellte Wurzel wird übersprungen. Ebenso eine Wurzel mit laufender oder pausierter Session (Meldung im Log). Dateien gehen erst nach dem Commit der jeweiligen Wurzel weg. Dasselbe gilt für `purgeTrashItems` im Core.
- Spätere Phasen ergänzen Schnappschüsse und Dubletten-Vorschläge (08 §5).

## 14. Einstellungen (F-EIN-01, T1-19)

### 14.1 Globale Einstellungen

- Speicherung in `setting` mit je einem Schlüssel pro Bereich (`general`, `lecture`, `pen`, `data`). Der Wert ist das Bereichsobjekt **ohne** Standardwerte.
- `GET /settings` füllt fehlende Felder mit den Standards. `PATCH /settings` führt Feld für Feld zusammen.
- `general.data_dir` ist nur lesbar (`SG_DATA_DIR`).
- **Keine feldübergreifenden Regeln in Phase 1.** Es gelten nur die Schemaregeln je Feld (z. B. darf „Stopp spätestens“ vor „Stopp nach Kalenderende“ liegen).
- **`data.backup_encryption`:** `true` ist nicht setzbar, solange Verschlüsselung (`age`) nicht eingebunden ist: `400 backup_encryption_unavailable`. `false` ist immer erlaubt. Die Oberfläche bietet die Option nicht an. Altbestand `true`: siehe §13 (Backup scheitert klar, Hinweis mit Umschalter in der Oberfläche; keine stille Migration, damit nie unbemerkt unverschlüsselt gesichert wird).
- **`data.backup_target`:** Die Prüfung liegt im gemeinsamen Helfer `packages/shared/src/backup-target.ts` (Import `@sg/shared/backup-target`, nicht im Barrel, weil er `node:fs` nutzt und die Web-App den Barrel bündelt). Der Core prüft asynchron (`checkBackupTargetAsync`, blockiert die Event-Loop bei hängenden Netz-/iCloud-Laufwerken nicht), die CLI synchron (`checkBackupTarget`), beide mit denselben Regeln. Der Core speichert den aufgelösten Pfad: Der vorhandene Teil wird Komponente für Komponente aufgelöst (relative Symlinks gegen den echten Ordner des Links, `..` nach einem Symlink gilt für dessen Ziel wie beim Kernel, also `<B>/l1/../vault` mit `l1 → <daten>/media` ergibt `<daten>/vault`), danach liefert das native `realpath` die Schreibweise des Dateisystems. Ab der ersten nicht vorhandenen Komponente wird `..` textlich ausgewertet. Zusätzlich werden `dev`/`ino` aller vorhandenen Vorfahren mit Datenordner, `media/` und `vault/` verglichen (Groß-/Kleinschreibung und NFD auf macOS, Bind-Mounts, Firmlinks). Abgelehnt werden `SG_DATA_DIR` und Ordner darin sowie `/proc`, `/sys`, `/dev`, unter macOS `/System` und `/private/var/db`. Symlinks sind erlaubt (gespeichert wird das Ziel); T1-18 prüft das Ziel beim Backup erneut. Änderungen nur lokal (§7.5).
- `lecture.microphone_id`: höchstens 256 Zeichen.
- **`general.appearance`** ist die Standard-Darstellung. Die Web-App wendet sie an, solange auf dem Gerät keine eigene Wahl („Hell“/„Dunkel“) gespeichert ist; „Wie Standard“ löscht die Geräte-Wahl.

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
| `recording_completed` | 409 | Chunk hinter `last_seq` einer abgeschlossenen Aufnahme (§10.2) |
| `range_not_satisfiable` | 416 | `Range` liegt außerhalb der Datei (`GET …/file`, `GET …/audio`) |
| `backup_running`, `backup_target_missing`, `restore_test_running` (läuft gerade ein Restore-Test bzw. ein Backup), `restore_test_no_backup` (noch kein Backup-Lauf mit Prüfsumme für das aktuelle Ziel), `restore_parent_deleted`, `restore_conflict` | 409 | Daten (§13) |
| `pairing_window_closed` | 409 | Kopplungsfenster zu oder abgelaufen (§12) |
| `chunk_header_invalid`, `backup_target_invalid`, `backup_encryption_unavailable`, `upload_aborted`, `slide_deck_module_mismatch` | 400 | Anfrage ungültig (`upload_aborted`: der Client hat den Upload abgebrochen; `backup_encryption_unavailable`: Backup-Verschlüsselung lässt sich nicht einschalten, §14.1) |
| `slide_deck_not_found` | 404 | Foliensatz fehlt oder ist gelöscht (Session-Routen) |
| `pairing_code_invalid`, `pairing_request_rejected`, `local_only` | 403 | Code falsch, Anfrage abgelehnt bzw. Route nur lokal |
| `pairing_request_not_found` | 404 | Kopplungsanfrage unbekannt |
| `file_too_large`, `chunk_too_large` | 413 | Größe |
| `unsupported_media_type`, `chunk_mime_mismatch` | 415 | Dateityp |
| `ics_invalid`, `checksum_mismatch` | 422 | Inhalt ungültig |
| `ics_too_complex` | 400 | ICS-Datei hat das Zeitbudget beim Auflösen überschritten (§8) |
| `file_missing`, `unexpected_file`, `upload_aborted`, `source_not_syncable` | 400 | Upload: Datei fehlt, falsches Feld/mehrere Dateien bzw. Datei an eine URL-Quelle, Upload abgebrochen; Quelle nicht abgleichbar |
| `pairing_locked` | 423 | Kopplung gesperrt, neues Fenster am Mac öffnen |
| `pairing_rate_limited` | 429 | zu viele Versuche |
| `pairing_requests_full` | 429 | 10 offene Kopplungsanfragen im Fenster, eine ablehnen oder neues Fenster öffnen (§12) |
| `ics_fetch_failed` | 502 | ICS-URL nicht erreichbar oder über den Grenzen |

**Nachtrag T1-10:** Keine neuen Codes. `device_token_invalid` (401) aus §5 gehört in diese Liste: Token unbekannt oder widerrufen.

**Sync-Fehler:** `SyncErrorCode` im Schema.

**WebSocket-Schließcodes:**
- 4401: Token ungültig oder widerrufen
- 4408: kein `hello`
- 4426: Protokollversion
- 4409: nach `session_superseded`, Warteschlange umschreiben und neu verbinden
- 4503: nach einem wiederholbaren Fehler, mit Wartezeit neu verbinden und erneut senden
- 4408 auch bei `hello_invalid`
- 1001: Leerlauf (60 s ohne Nachricht) oder Herunterfahren des Core
- 1003: Binär-Frame
- 1008: Schutzgrenze verletzt (Rate-Limit, zu viele Nachrichten vor `welcome`) oder fataler, nicht wiederholbarer Fehler einer Operation (§11.2)
- 1009: Nachricht über 1 MiB
- Bei 1001, 1003, 1008 und 1009 verbindet der Client mit Wartezeit neu (§11.2, Client-Pflichten)

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
| Operation anhängen | `services/core/src/sync/append.ts` | `appendOp(tx: Tx, stream: string, op: { kind: SyncOp['kind']; data: unknown; at: number; clockUncertain: boolean; origin: SyncOrigin; opId?: string; deviceId?: string \| null }): Promise<{ seq: number; opId: string; duplicate: boolean }>`. Sperrt `sync_stream`, prüft unter der Sperre die `op_id`, schreibt `sync_op` und meldet die Operation per `pg_notify('sg_sync_op')`. Postgres stellt das erst nach dem Commit zu. `listenCommittedOps(sql, db, onError?)` ruft dann `onOpCommitted` auf, je Strom lückenlos in `seq`-Reihenfolge, auch nach einem Neuverbinden. Wirft der Hook, wiederholt er später ab derselben `seq`. Gelesen und ausgeliefert wird in Paketen zu 500. Optional `listenCommittedOps(sql, db, onError?, { channels })`: weitere LISTEN-Kanäle (z. B. `sg_event`) auf derselben seriellen Kette. Setter: `setOnOpCommitted(hook)`, Standard: nichts. `findOpById(db, opId)` liefert eine gespeicherte Operation, `toCommitted(row)` macht aus einer `sync_op`-Zeile die Form des Hooks | **T1-DB**. T1-08 startet `listenCommittedOps` beim Core-Start und setzt den Hook für Versand und `ack` (§11.2) |
| Duplikate und Ablauf | Dispatcher in `services/core/src/sync/**` | **Ablauf je Client-Operation (einzige Beschreibung):** (1) `findOpById` vor der Transaktion. Gleiche Operation (Strom, Art, Daten): ursprüngliches `ack` ohne Handler, erst wenn der Versand des Stroms die ursprüngliche `seq` erreicht hat. Abweichende: `error op_id_reused`. (2) In **einer** Transaktion optional `preLock(tx, op)`. (3) `appendOp` mit der Client-Operation **vor** dem Handler. Bei `duplicate = true` (gleichzeitiges Duplikat) Rollback und das ursprüngliche `ack`. Dieselbe neue `op_id` gleichzeitig in zwei Strömen ergibt `internal_error` (wiederholbar). (4) Handler. (5) Bei `SyncOpError` Rollback, es wird keine `seq` vergeben. Handler prüfen Duplikate nie selbst. Sie gehen davon aus, dass die Client-Operation schon in `sync_op` steht, und schreiben selbst nur Server-Operationen | T1-08 |
| Op-Handler | `services/core/src/sync/handlers.ts` | `registerOpHandler(kind, handler: (tx: Tx, op: SyncOp, ctx: { deviceId: string \| null; origin: SyncOrigin }) => Promise<void>, opts?: { preLock?: (tx: Tx, op: SyncOp) => Promise<void> })`, ein Handler pro Art, Ablauf siehe „Duplikate und Ablauf“. `preLock` sperrt vor `appendOp` die Zeilen, die auch andere Wege vor dem Strom sperren. Fehler über `throw new SyncOpError(code: SyncErrorCode, retryable: boolean, details?, opts?: { fatal?: boolean })`: `retryable` → fatal, 4503. `session_superseded` → immer fatal, 4409. `fatal` bei anderen Codes → 1008 (`device_token_invalid` → 4401). Sonst nicht fatal. Server-Operationen stehen in `SERVER_ONLY_KINDS` (`handlers.ts`), einer **Liste von Hand**: Neue Server-Operationen müssen dort eingetragen werden. Ein Unit-Test vergleicht sie mit den Schema-Varianten, deren Beschreibung mit „Nur vom Server“ beginnt. Von einem Client lehnt der Dispatcher sie mit `op_not_allowed` ab, bevor ein Handler läuft | Registry T1-08, Handler die Fachtickets. Registrieren beim Start im Sync-Plugin (`sync/server.ts`), beim Beenden wieder abmelden. Core-Ink: `registerInkHandlers({ dataDir })` in `sync/handlers/ink.ts`, `dataDir` aus der Konfiguration. Die Session-Handler (`registerSessionHandlers()`, T1-02) registriert das Sync-Plugin ebenso, mit `preLock`. Aktiv seit T1-02 |
| Sperr-Reihenfolge | alle Schreibwege mit `appendOp` | **Einzige Beschreibung.** Allgemein: zuerst den Strom sperren (`appendOp`), dann die Fachzeilen. REST-Wege wie `PATCH`/`DELETE /notebooks/{id}` sperren darum zuerst den Strom und danach das Notizbuch. **Ausnahme:** Was ein Handler in `preLock` sperrt, wird in **allen** Wegen (auch über REST) vor dem Strom gesperrt, z. B. `lockSessionTransitions` (T1-02). **Auch Kaskaden, die Session-Zeilen sperren** (`DELETE` auf Modul, Semester, Kalenderquelle und Session über `softDeleteWithOps`), nehmen als `before` zuerst `lockSessionTransitions`; beim Semester nach der Semester-Sperre. Sonst droht ein Deadlock mit REST-Start/-Stopp, Takt und „spätere Session“. Session-Zeilen nur mit `FOR NO KEY UPDATE`. Wer Server-Operationen in **andere** Ströme schreibt, nimmt in `preLock` die Sperren der Fachzeilen, die andere Wege vor diesem Strom nehmen. Sonst droht ein Deadlock (40P01) | alle |
| Ereignisse | `services/core/src/sync/events.ts` | `publishEvent(event: SyncEvent, opts?: { localOnly?: boolean }): void` und `publishAfterCommit(tx: Tx, event: SyncEvent): Promise<void>`. `publishAfterCommit` nutzt denselben Weg wie `appendOp`: `pg_notify('sg_event', <Event-JSON>)` in `tx`, das Ereignis vollständig in der Nutzlast, über 7000 Byte (UTF-8) wirft es. Ein Listener auf `sg_event` ruft `publishEvent` auf | T1-08 |
| Verbindungen | `services/core/src/sync/connections.ts` | `closeDeviceConnections(deviceId: string, code: number): void`, `isDeviceConnected(deviceId: string): boolean` | T1-08 |
| Session-Übergang | `services/core/src/services/sessions.ts` | `transitionSession(tx: Tx, sessionId: string, action: 'start' \| 'pause' \| 'resume' \| 'stop', input: { at: Date; origin: SyncOrigin; deviceId?: string \| null; startedFrom?: ClientDevice; reason?: StopReason; moduleId?: string; calendarEventId?: string \| null; slideDeckId?: string \| null; now?: Date }): Promise<{ session: Session; endedSession: Session \| null }>` (schreibt selbst die Server-Operationen und sendet `session.updated`; `now` ist die Uhr für Folgezeiten, Standard Systemzeit). Aus dem Sync wird sie nur für Geräte-Operationen mit `origin ≠ server` gerufen. `lockSessionTransitions(tx)` und `SESSION_PRELOCKS` (`sync/handlers/session.ts`) sind die Sperren für Zustandswechsel | T1-02 |
| Kalender → Session | `services/core/src/services/sessions.ts` | `ensurePlannedSessions(tx: Tx, eventIds: string[], now?: Date): Promise<void>` (anlegen, löschen, `module_id`, VL-Nummer neu). Sendet `session.updated` für jede angelegte, geänderte oder gelöschte Session. Zu einer **gestarteten** Session eines berührten Termins hebt sie `updated_at` an und sendet `session.updated` (der Termin kann verschoben sein, `planned_*` stammen aus ihm) | T1-02, aufgerufen von T1-01 |
| Token prüfen | `services/core/src/services/devices.ts` | `verifyDeviceToken(db: Db, token: string): Promise<{ deviceId: string } \| null>` | T1-10 |
| Wächter → Route | `services/core/src/plugins/security.ts` | `DeviceTokenVerifier` liefert `Promise<{ deviceId: string } \| null>`. Der Wächter setzt `request.sgDevice: { deviceId: string } \| null` (`null` = lokal). Für `GET /sync` mit `Upgrade: websocket` prüft er zusätzlich `Origin` wie bei zustandsändernden Anfragen | T1-10. T1-08 liest `request.sgDevice` beim Upgrade, nur in `resolveDevice(request)` (`services/core/src/sync/server.ts`). Host, Origin und Token prüft allein der Wächter |
| Widerruf (Nachtrag T1-10) | `services/core/src/services/devices.ts` | `onDeviceRevoked(listener: (deviceId: string) => void): () => void`. Wird nach dem Commit von `DELETE /devices/{id}` synchron aufgerufen, Rückgabe meldet ab. Die Route ruft außerdem selbst `closeDeviceConnections(id, 4401)` auf. Fehler eines Zuhörers werden protokolliert und stören die Antwort nicht | T1-10. Der Sync-Server hängt sich ein und merkt sich widerrufene Geräte (§11.1, Widerruf während des Upgrades) |
| Upgrade prüfen (Nachtrag T1-10) | `services/core/src/plugins/security.ts` | Der Wächter läuft als `onRequest`-Hook auch für Upgrades über `@fastify/websocket` und setzt `request.sgDevice`. Bei `pair/*` aus dem Netz bleibt `sgDevice` **undefiniert**. Für einen rohen `server.on('upgrade')`-Handler: `app.authenticateUpgrade(req: IncomingMessage): Promise<{ deviceId } \| null>` (wirft `HttpError` 421/403/401, ohne Ausnahmen für Routen) | T1-10 |
| Einstellungen | `services/core/src/services/settings.ts` | `getSettings(db: DbOrTx, config: Pick<Config, 'dataDir'>): Promise<Settings>`. `general.data_dir` kommt aus der App-Konfiguration | **T1-DB**. T1-19 baut `PATCH`. Genutzt von T1-02 (Auto-Stopp) und T1-18 |
| Papierkorb | `services/core/src/services/trash.ts` | `softDelete(tx: Tx, kind: TrashKind, id: string): Promise<Date>` (Kaskade §13; wirft `HttpError` 404 `<kind>_not_found`, 409 `session_active`, 409 `notebook_default`), `restoreFromTrash(tx: Tx, id: string): Promise<TrashRestoreResult>` (404 `trash_item_not_found`, 409 `restore_parent_deleted`, 409 `restore_conflict`) | **T1-DB**. T1-18 baut die Routen und schreibt Server-Operationen bei der Wiederherstellung. Alle Lösch-Routen rufen `softDelete` |
| Papierkorb-Hülle | `services/core/src/services/trash-ops.ts` | `softDeleteWithOps(db, kind, id, before?)`, `restoreWithOps(db, id)`, `purgeTrashItems(db, dataDir, roots)`, `lockStreams(tx, streams)`, außerdem `listTrash`, `emptyTrash`, `purgeOne`. Sperrt vor `softDelete`/`restoreFromTrash` die Ströme der betroffenen Notizbücher und Sessions (sortiert), beim Löschen von Modul/Semester danach die Modulzeilen `FOR UPDATE`, und schreibt `notebook.delete`/`.restore`, `page.restore`. **Künftige Lösch-Routen rufen `softDeleteWithOps`** (Ausnahme: ein Op-Handler, der den Strom schon hält, ruft `softDelete` direkt). `DELETE /calendar/sources` (T1-01) und `DELETE /sessions` (T1-02) stellt der Lead um, Tickets fassen sie nicht an | **T1-18** |
| Fotos | `services/core/src/services/photos.ts` | `upsertPhotoMeta(tx: Tx, data: PhotoAddData, env: { dataDir: string }): Promise<void>` und `storePhotoFile(id, stream, sha256, mime, env: { db: Db; dataDir: string }): Promise<FileReceipt>` (der letzte Parameter `env` ist nötig, weil beide Datenordner bzw. Datenbank brauchen) prüfen sich gegenseitig (sha256, Typ) | Core-Ink (Handler `photo.add` und `PUT /photos`) |
| Recorder → Auto-Stopp | `apps/web/src/lib/recorder/level.ts` | `subscribeAudioLevel(fn: (s: { at: number; rms: number }) => void): () => void`, alle 250 ms während der Aufnahme. Die Spracherkennung baut T1-07 darauf. Der Stopp läuft per `POST /sessions/{id}/stop`. Der Recorder reagiert auf `session.updated` (`beendet`) und schließt die Aufnahme ab (`complete`) | T1-06 liefert, T1-07 nutzt |
| Web-Sync-Client | `apps/web/src/lib/sync/client.ts` | `class SyncClient { connect(); subscribe(stream: string, from: { lastSeq: number; lastOpId: string \| null }, onOp: (op: SyncOp) => void); send(op): Promise<SyncAck>; onEvent(name, fn); }`. `from` stammt aus `stream_seq`/`stream_op_id` des REST-Stands. Dazu Warteschlange in IndexedDB, Uhrabgleich, Wartezeit nach 4503, Fehlerablage | T1-WS |

**Aufnahme-Job beim Stopp (T1-06, verbindlich für T1-02):** `ensureFinalizeOnStop(tx: Tx, recordingId: string, stoppedAt: Date): Promise<void>` in `services/core/src/services/recordings.ts`. Sie nimmt `lockRecording`, legt keinen Job an für Aufnahmen ohne Chunks und auch nicht, wenn einer in `wartet`, `laeuft` oder `fertig` existiert, sonst sofort (Aufnahme abgeschlossen) bzw. mit `run_after = stoppedAt + 10 min`. Der Stopp ruft sie für jede Aufnahme der Session auf, in aufsteigender ID-Reihenfolge.

**Sperrreihenfolge** (gilt für Stopp, Sync-Handler und REST gleich, sonst droht ein Deadlock): `lockSessionTransitions` → Session-Zeile (`FOR NO KEY UPDATE` bzw. `FOR SHARE`) → `sync_stream` → `lockRecording` (nach ID sortiert) → Job-Zeilen. Die Aufnahme-Routen sperren die Session **nie nach** `lockRecording`: Das Anlegen liest sie mit `FOR SHARE` davor; der Chunk-Upload liest sie ohne Sperre erst nach `lockRecording` (unter Read Committed sieht er dann entweder den committeten Stopp oder der Stopp zählt den Chunk mit).

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

**Dashboard-Platzhalter (T1-04 → T1-05, T1-17):** Das Live-Dashboard (`/session?id=<session_id>`) bindet je eine Komponente aus den beiden Ordnern ein. T1-05 und T1-17 ersetzen **nur den Inhalt der Datei** und behalten Dateiname, Exportname und Props bei. Weitere Dateien in ihrem Ordner dürfen sie frei anlegen.

| Ticket | Datei | Export und Props | Sitz im Dashboard |
|---|---|---|---|
| T1-05 | `dashboard/slides/SlidesPanel.tsx` | `SlidesPanel({ sessionId: string; moduleId: string; slideDeckId: string \| null; active: boolean; startedAt: number \| null; client: SyncClient \| null })` | Spalte „Folie“, füllt sie ganz (`h-full`). `slideDeckId === null`: folienloser Modus. `active`: Session läuft oder ist pausiert. `startedAt` = `session.started_at` in ms; `slide.change` braucht `t_ms` = Ereigniszeit − `startedAt`. |
| T1-17 | `dashboard/markers/MarkerControls.tsx` | `MarkerControls({ sessionId: string; active: boolean; startedAt: number \| null; client: SyncClient \| null })` | Statusleiste, nach der Aufnahmeanzeige (Zähler ❓ ⚠️ 🔗, Tasten F, K, L). `startedAt` = `session.started_at` in ms. Einzeilig, höchstens drei Wörter Text. |

`SyncClient` kommt aus `apps/web/src/lib/sync/client.ts` (`useSyncClient()` des Dashboards, `null` vor dem ersten Effekt). Tastenkürzel setzen die Komponenten selbst (T1-05: `←` `→` Leertaste; T1-17: `F` `K` `L`); das Dashboard belegt nur `1` bis `4` (Layout) und lässt Tasten in Eingabefeldern in Ruhe.

**Regeln für die Platzhalter-Komponenten:**
- Das Dashboard belegt die Tasten `1` bis `4` (nach `e.code`, also `Digit1` bis `Digit4`) und die Pfeiltasten, Home und End auf den Trennlinien (`role="separator"`). Eigene Tastenkürzel prüfen `e.defaultPrevented` und ignorieren Fokus auf Eingabefeldern (`isEditableTarget` aus `lib/shortcuts.ts`) sowie auf `role="separator"` und `role="tab"`; dort gehören die Pfeiltasten dem Element.
- Unter `lg` (1024 px) zeigt das Dashboard nur eine Spalte (Reiter) und hängt die anderen Panels aus. Zustand, der den Wechsel überleben muss (aktuelle Folie, Zähler, Entwürfe), gehört darum in den Query-Cache (`@tanstack/react-query`) bzw. an die Session, nicht in den lokalen State der Komponente. Die Komponente muss beim erneuten Einhängen ohne Flackern denselben Stand zeigen.
- Das Dashboard klappt die Seitenleiste auf `/session` ein (ohne `localStorage`) und stellt sie beim Verlassen wieder her; die Folienspalte soll im Standard-Layout bei 1440 px mindestens 640 px breit sein.

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
