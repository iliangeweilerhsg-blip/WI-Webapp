# Laufzeit-Verträge zwischen den Bausteinen (Phase 0 bis 2)

Diese Datei legt fest, wie Core, Worker, Web-App, iPad-App und `sg`-CLI zusammenspielen. So können die Teile parallel gebaut werden (`AGENTS.md`, Regel 4).
Änderungen nur durch den Lead. Datenformate selbst stehen in `packages/schemas`.

§1–5 gelten seit Phase 0. §6–16 sind die Verträge und der Ticketplan für Phase 1, §17 ist der Moodle-Abgleich. Ab §18 folgt Phase 2: §18 Transkription und Rückblick, §19 Suche, §20 Konzepte, Inbox und Zusammenfassung.

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
| `SG_TRANSCRIBER` | `mlx-whisper`. In CI und auf Linux `fake` | Worker (§18.6) |
| `SG_WHISPER_MODEL` | `mlx-community/whisper-large-v3-turbo` | Worker (§18.6) |
| `SG_EMBEDDER` | `bge-m3`. In CI und auf Linux `fake` | Worker (§19.2) |
| `SG_EMBED_MODEL` | `BAAI/bge-m3` | Worker (§19.2) |
| `SG_WORKER_PORT` | `4711` | Worker (bindet `127.0.0.1`) und Core (ruft fest `http://127.0.0.1:<port>` auf, nie `localhost`, §19.4) |
| `SG_LLM` | `anthropic`. In CI und Tests `fake` | Worker (§20.5) |
| `ANTHROPIC_API_KEY` | leer. Nur in `config/.env` | nur Worker (§20.5). Der Core überspringt alle `ANTHROPIC_*` aus `.env` und entfernt den Schlüssel aus seiner Umgebung |
| `SG_MODEL_FAST` / `SG_MODEL_STANDARD` / `SG_MODEL_DEEP` | `claude-haiku-5-5` / `claude-sonnet-5-5` / `claude-opus-5-5` | Worker (§20.5, K-01) |
| `SG_USD_EUR` | `0.92` | Worker (Kosten in Euro, §20.5) |

Geheimnisse wie API-Schlüssel stehen in `$SG_DATA_DIR/config/.env` mit Rechten 600 (02 §3). Die Prozesse lesen diese Datei beim Start.
**Ausnahme Moodle:** Der Moodle-Token liegt nur im macOS-Schlüsselbund (Dienst `studiengehirn-moodle`), nie in `.env`. Nur der Core liest ihn (08 §9.1). Einzige Ausnahme: `pnpm sg moodle login` liest den Eintrag direkt nach dem Speichern einmal zurück, um zu prüfen, dass der Core genau diesen Token findet. `pnpm sg moodle status` und `logout` lesen den Token nie.

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
- **Session-Fortschritt (Worker):** Die Job-Schleife zieht den Fortschritt nach jedem Job mit `session_id` nach, in **derselben Transaktion**, in der der Job final wird (`fertig`, endgültig `fehler`, `abgebrochen` durch `depends_on`; bei Retry `wartet`; auch für abgestürzte Jobs). Handler schreiben ihn nicht selbst. Ablauf: (1) Session-Zeile `FOR NO KEY UPDATE` sperren, **bevor** Jobs gezählt werden, damit zwei gleichzeitig endende Jobs nacheinander laufen und der zweite den ersten sieht. (2) `session.processing[<job.type>]` aus **allen** Jobs dieses Typs der Session setzen: `fehler`, sobald einer endgültig gescheitert ist, sonst `laeuft`, dann `wartet`, sonst `fertig`; `abgebrochen` zählt nicht mit, nur abgebrochene Jobs ergeben `abgebrochen`. **Ab T2-02a gilt stattdessen die Zusammenfassung über den jeweils neuesten Job aus §18.2.** (3) Ist die Session `beendet` und hat sie keinen Job mehr in `wartet` oder `laeuft`, setzt der Worker `state = 'verarbeitet'`, auch wenn Jobs `fehler` sind; eine `verarbeitet`e Session ändert ihren Zustand nicht mehr, nur `processing`. (4) `pg_notify('sg_session', '<session_id>')`. Der Core hört darauf und sendet das Ereignis `session.updated` (§11.6). Doppelte Läufe sind harmlos.

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
| `backup_run` | `trigger text`, `stand text NULL`, `dump_sha256 text NULL` (64 Hex-Zeichen, CHECK), `thin_left text[] NULL`, `warning text NULL` (höchstens 500 Zeichen, CHECK; Migration `0008_backup_warning`, #124) | Anzeige, Name für `sg restore <stand>`; `dump_sha256` ist die Vertrauensquelle für den automatischen Restore-Test (§13), von `sg backup` aus den Bytes von `pg_dump` gebildet, nie API-Feld. `thin_left`: Reste des Ausdünnens nach diesem Lauf, nur intern (Vergleich mit dem nächsten Lauf). `warning` ist API-Feld von `BackupRun` (§13, „Reste beim Ausdünnen“) |
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
| `POST /backup` | – | 202 `BackupRun` | 403 `local_only` (**lokal**, auch mit Geräte-Token, #113), 409 `backup_running`, 409 `restore_test_running`, 409 `backup_target_missing` |
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
- **Reihenfolge je Verbindung:** Ein Ereignis aus `publishAfterCommit` kommt nie vor den Operationen an, die vor ihm committet wurden. Es läuft dafür über dieselbe serielle Kette wie die Operationen (§16.2). Läuft für einen abonnierten Strom der Verbindung gerade eine Nachlieferung, warten alle Ereignisse hinter ihr, auch direkte. Direkte Ereignisse (`publishEvent` bzw. `broadcastEvent` außerhalb des Listeners, z. B. `presence`, `device.connection`, `pairing.requested`) gehören zu keiner Transaktion. Sie können eine schon committete Operation überholen, deren Weitergabe über den Listener noch aussteht: ohne laufende Nachlieferung sofort, aber auch nachdem sie hinter einer Nachlieferung gewartet haben, wenn deren letzte Abfrage vor dem Commit lief (#118). Clients dürfen aus einem direkten Ereignis darum nie auf eine bereits angekommene Operation schließen. Spätere Operationen dürfen vor einem Ereignis ankommen. **Ausnahme nach einem Abbruch der LISTEN-Verbindung des Core:** Direkt nach dem Neuverbinden kann ein Ereignis aus `publishAfterCommit` (heute nur `session.updated`) vor Operationen **anderer** Ströme ankommen, die während der Unterbrechung committet wurden und erst der Abgleich nachliefert (#143, Review von #154). Operationen aus derselben Transaktion wie das Ereignis kommen weiterhin vorher an, je Strom bleibt alles lückenlos. `session.updated` ist ein vollständiger Stand (Schutz über `updated_at`). Clients dürfen daraus ohnehin nicht auf bereits angekommene Operationen schließen.
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
- **Nie zwei Tabs gleichzeitig:** Vor `start()` holt der Tab die Aufnahme-Sperre `sg-recording` (Web Locks) und gibt sie erst nach dem Stopp frei. Ein neuer Leader wartet also, bis der alte Tab fertig ist; schließt der alte Tab, gibt der Browser die Sperre frei. Ohne Web Locks (`navigator.locks` fehlt) ist **jeder** Tab Leader (§11.8, oben); dann gibt es weder eine Abstimmung noch die Aufnahme-Sperre, und mehrere offene Tabs nehmen jeweils selbst auf. Das ist der bekannte Rückfall, kein Fehler.
- **Wartet ein neuer Leader auf die Sperre** (der alte Tab hält sie, z. B. bei offener Mikrofon-Abfrage), zeigt die Statusleiste nach 1,5 s „Wartet auf anderen Tab“. Die Abfrage `getUserMedia` hat eine Zeitgrenze von 30 s; danach gilt das Mikrofon als fehlend („Mikrofon fehlt“, Knopf „Erneut versuchen“), und eine spät beantwortete Abfrage gibt das Mikrofon sofort wieder frei.
- **Hochladen nur im Leader (Issue #115):** Chunks gehen aus der gemeinsamen IndexedDB nur vom Leader-Tab an den Core (`PUT …/chunks/{seq}`, `POST …/complete`). Folge-Tabs laden nichts hoch. Wer die Rolle verliert, beendet die Aufnahme lokal (letzter Chunk und `complete` stehen in IndexedDB) und meldet über den `BroadcastChannel` `sg-recorder-uploads`, dass Chunks bereitliegen; der Leader holt sie ab. Ein neuer Leader holt bei der Übernahme alles Ungesendete nach.
- **App-weites Nachholen:** Ab dem App-Start (App-Shell) lädt der Leader-Tab ungesendete Chunks und abgeschlossene Aufnahmen nach (`resumePendingUploads`), auch ohne das Dashboard zu öffnen. Aufnahmen, die in diesem Tab noch laufen, schließt er nicht ab. Er stößt das Hochladen außerdem bei der Nachricht „Chunks liegen bereit“ (Seite verlassen, Rollenverlust) und alle 45 s an, falls eine Nachricht verloren ging oder der Core nicht erreichbar war. Nach einem harten Abbruch eines Tabs (kein sauberer Stopp) schließt er dessen offene Aufnahme nach `abandonAfterMs` als verwaist ab.
- **Seite verlassen:** Verlässt der Leader das Live-Dashboard (SPA-Navigation), beendet das die **Aufnahme**, nicht die Session. Die Aufnahme wird sauber abgeschlossen (letzter Chunk, `complete`, Mikrofon frei); die Session läuft weiter. Kommt der Nutzer zurück, beginnt eine neue Aufnahme (Lücke = Stille).
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
  - über `POST /backup` (`manuell`), **nur lokal** (`403 local_only` aus dem Netz, auch mit Geräte-Token, #113): Ein gekoppeltes Gerät soll keine Backups in Folge auslösen, die auch den monatlichen Restore-Test verdrängen würden.
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
| `session` (nur nicht aktiv) | Folienwechsel, Marker, Fotos, Aufnahmen mit Chunks. Ab Phase 2 auch `transcript`, `transcript_segment` und `slide_segment` (§18.1) | Seiten mit `session_id` (gehören zum Notizbuch) |
| `notebook` (nicht `vorlesung`/`uebung`) | Seiten, Striche, Seitenelemente | – |
| `page` | Striche, Seitenelemente | – |
| `marker`, `photo` | – | Stempel- bzw. Bildelemente, die darauf verweisen (Anzeige als Platzhalter) |

- `GET /trash` zeigt nur **direkt** gelöschte Objekte. Das sind die, deren Elternobjekt nicht mit demselben Zeitstempel gelöscht wurde. `purge_at = deleted_at + 30 Tage`.
- `dependent_count` zählt nur Objekte, die der Nutzer kennt; Maschinenausgaben (`transcript`, `transcript_segment`, `slide_segment`, `search_chunk`) werden mitgelöscht und mitwiederhergestellt, aber nicht mitgezählt. `restored_count` zählt alle wiederhergestellten Zeilen.
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
  - `POST /backup` legt die `backup_run`-Zeile selbst an und startet `node infra/sg/src/main.ts backup --trigger … --run-id …` (Ausgabe in `logs/backup.log`). Ein `laeuft` älter als 6 Stunden gilt als abgestürzt. Früher erkennt die CLI einen abgestürzten Lauf über seine PID-Datei (siehe „Hängendes `laeuft`“ unten).
  - `stale` ist auch ohne jedes erfolgreiche Backup `true`.
  - Der Zeitplan (Backup und `maintenance.nightly` um 03:30) läuft minütlich im Core und holt Verpasstes nach. Ein fehlgeschlagener geplanter Lauf wird am selben Tag nicht wiederholt.
  - `backup_encryption = true` lässt den Lauf mit Hinweis scheitern (`age` ist P1, nie unverschlüsselt sichern, wenn Verschlüsselung gewünscht ist). Neu setzen lässt es sich nicht mehr (`PATCH /settings` → `400 backup_encryption_unavailable`, §14.1). Ein Altbestand `true` bleibt bewusst fail-closed: Der Lauf scheitert mit klarer Meldung, die Oberfläche zeigt einen Hinweis mit Knopf „Ohne Verschlüsselung sichern“ (setzt ausdrücklich `false`).
  - **Backup-Ziel:** `sg backup` prüft das Ziel mit demselben Helfer wie der Core (`@sg/shared/backup-target`, §14.1): absoluter Pfad, `realpath`, kein Systemordner, **der ganze Datenordner ist gesperrt** (auch `backups/` darin und `sg backup --ziel <datenordner>/backups`; ein Backup dort schützt nicht gegen Plattendefekt). Einziger Unterschied: Die CLI legt einen fehlenden Zielordner an (Elternordner muss existieren). `copyTree` überspringt zusätzlich `*.partial` als zweite Schutzlinie. Der Datenordner enthält kein `backups/` mehr.
  - **Schreiben ins Ziel ohne Symlink-Folgen (#113):** Wer das Ziel beschreiben kann, kann dort jederzeit Einträge umbenennen oder durch Symlinks ersetzen, auch im eigenen `.<stand>.partial`. Alles, was `sg backup` im Ziel anlegt, läuft darum über `NoFollowWriter` (`infra/sg/src/nofollow.ts`):
    - `.partial` und jeder Unterordner (`media/`, `vault/` und darunter) entstehen einzeln mit `mkdir` ohne `recursive`. Liegt dort schon etwas (auch ein Symlink oder ein `.partial` gleichen Namens), scheitert der Lauf. Ein schon vorhandener Stand gleichen Namens wird per `lstat` erkannt. Gelöscht wird dabei nichts.
    - **Verankert statt über Pfade:** Node kennt kein `openat`/`unlinkat`, Ersatz ist das Arbeitsverzeichnis, das an der Inode hängt, nicht am Pfad. Jeder Zugriff wechselt per `chdir` in den Ordner und prüft mit `lstat('.')` dessen Identität (`dev`/`ino`) gegen die beim Anlegen gespeicherte (das Ziel selbst wird nach der `realpath`-Prüfung übernommen). Stimmt sie nicht, war ein Ordner im Pfad ausgetauscht: Abbruch. Danach arbeitet er nur mit relativen Namen (`open`, `mkdir`, `link`, `rename`, `unlink`, `rmdir`). Ein Tausch irgendeines Ordners im Pfad nach der Prüfung, etwa per `renameat2(RENAME_EXCHANGE)` in einer Schleife, trifft so nie einen fremden Ordner (B1 aus dem Review zu #116). Alles im gewechselten Verzeichnis ist synchron (kein `await`), danach geht es per `finally` zurück. Die CLI nutzt sonst nur absolute Pfade.
    - Dateien (`db.dump`, `manifest.json`, Kopien aus `media/` und `vault/`) entstehen exklusiv mit `O_CREAT | O_EXCL | O_NOFOLLOW`, Zeiten werden über den Deskriptor gesetzt (`futimes`). Ein Hardlink auf den vorigen Stand wird nur behalten, wenn er danach genau auf die geprüfte Datei zeigt, sonst wird kopiert.
    - Neu angelegte Ordner werden direkt nach `mkdir` per `lstat` geprüft (echter Ordner, kein Symlink). Die Umbenennung `.partial` → `<stand>` prüft vorher, dass `.partial` der eigene Ordner ist, und danach, dass unter `<stand>` genau dieser Ordner liegt.
    - **Fail-closed:** Jeder Verstoß beendet den Lauf als `fehler`. Aufgeräumt wird nur, was der Lauf selbst angelegt hat und `lstat` im verankerten Ordner unverändert zeigt (Dateien per `unlink`, Ordner per `rmdir`, nur leere). Fremde Einträge und ausgetauschte Ordner bleiben liegen (das Ausdünnen entfernt alte `.partial` nach einem Tag).
    - **Ziel-Identität (#124, H2):** `validateTarget` liefert neben dem aufgelösten Pfad die Identität des Ziels (`dev`/`ino` per `lstat` direkt nach der Prüfung, ein Symlink an seiner Stelle ist ein Fehler). Schreiber, Leser und Ausdünnen verankern das Ziel mit genau dieser Identität, statt es später per `stat` neu zu übernehmen (das folgte Symlinks). Wird das Ziel nach der Prüfung ausgetauscht, scheitert jeder Zugriff, und im fremden Ordner wird nichts gelöscht.
    - **Ausdünnen ohne Symlink-Folgen (#119):** `removeStand` und `removeStalePartials` löschen verankert (`NoFollowRemover`): Jede Ebene wird per `chdir` betreten und mit `lstat('.')` gegen den zuvor im Elternordner per `lstat` gesehenen Eintrag geprüft, Einträge werden mit `readdir('.')` gelesen und nur relativ entfernt (`unlink`, `rmdir`). Ein Symlink wird als Eintrag gelöscht, nie verfolgt. Weicht ein Ordner beim Betreten ab (Tausch, etwa `<alter Stand>/media/photos` gegen einen Link per `renameat2(RENAME_EXCHANGE)`), steigt das Löschen dort nicht weiter ab: Der Rest bleibt stehen (fail-closed), das Log meldet „nicht vollständig entfernt“. `manifest.json` eines Standes wird zuletzt gelöscht und nur, wenn bis dahin nichts stehen blieb: Ein abgebrochener Rest bleibt so ein gültiger Stand und wird beim nächsten Ausdünnen erneut verankert gelöscht, statt als Waise ohne Manifest liegen zu bleiben.
    - **Hardlink-Quelle (#119, N2):** Ob eine Datei im vorigen Stand unverändert ist (Größe, Zeit), wird verankert im vorigen Stand nachgesehen (`NoFollowReader`). Der Hardlink selbst nennt die Quelle über ihren absoluten Pfad (`link` mit zwei Ordnern geht ohne `linkat` nicht verankert).
    - **Hardlink im privaten Ordner (#124, H1):** Wird in diesem Moment ein Ordner im Pfad der Quelle gegen einen Symlink getauscht, entsteht ein Link auf eine fremde Datei. Darum entsteht der Link nie direkt an seinem Platz, sondern zuerst im privaten Unterordner `.sg-link.partial` des Zielordners (mit `mkdir(…, 0700)` angelegt, danach per `lstat` geprüft: keine Rechte für Gruppe und andere, Besitzer ist der Lauf). Der Schreiber betritt ihn verankert, legt den Link relativ als `neu` an und prüft ihn dort (`lstat`, `dev`/`ino` gleich der verankert gesehenen Datei). Ein falscher Link wird dort entfernt und kopiert, er war für keinen anderen Benutzer erreichbar. Ein geprüfter Link bekommt seinen Platz mit `link('neu', '../<name>')` aus dem verankerten privaten Ordner und danach `unlink('neu')`. `..` ist der aktuelle Elternordner dieser Inode und kann umgehängt werden, wenn jemand den privaten Ordner verschiebt. Dann landet der geprüfte, eigene Link woanders, und die Prüfung danach bricht den Lauf ab. Das ersetzt das ursprünglich geplante `rename`: `rename` überschreibt einen vorhandenen Eintrag stillschweigend, `link` scheitert mit `EEXIST` (dann bricht der Lauf ab). Zum Schluss muss im verankerten Zielordner unter `<name>` genau die geprüfte Datei liegen, sonst bricht der Lauf ab. Der private Ordner wird nach dem letzten Link eines Ordners entfernt (`rmdir`, nur leer, Identität geprüft) und endet nie im Stand. Meldet das Dateisystem ihn nicht als privat (Dateisystem ohne Unix-Rechte), wird in diesem Ordner nicht verlinkt, sondern kopiert. Grenzen: Auf Dateisystemen, die Rechte zwar melden, aber für andere Clients nicht durchsetzen (manche SMB-Freigaben), schützt 0700 nicht; dort hängt der Schutz an der Prüfung danach (wie vorher). Auf APFS bzw. macOS kann eine **ACL** (geerbt vom Ziel, z. B. „everyone allow list,search,file_inherit,directory_inherit“) anderen Zugriff geben, obwohl `lstat` 0700 meldet. Die Prüfung sieht ACLs nicht. Darum gehört `ls -lde <ziel>` in die Prüfung des Ziels (siehe „Dateisysteme des Ziels“, Schritt 5).
    - **Reste beim Ausdünnen (#124, H3):** Bleibt beim Löschen etwas stehen, merkt sich der Remover die tatsächliche Ursache je Eintrag: `getauscht` (Identität weicht ab), `hinzugekommen` (während des Löschens kam etwas in den Stand), oder den Systemfehler (`EACCES`/`EPERM` etwa durch Rechte, ACLs oder immutable-Flags auf einem NAS, `ENOTEMPTY`, `EROFS`, …). Ein `chdir`, das an `EACCES`/`EPERM` scheitert, gilt als „nicht zugänglich“, nicht als Tausch. Das Log nennt die tiefste Ursache mit Fehlercode und dem betroffenen Eintrag relativ zum Stand, z. B. „Alten Stand 20261001T030000Z nicht vollständig entfernt: Keine Berechtigung (EPERM), etwa durch Zugriffsrechte, ACLs oder eine Sperre (immutable) (bei media/photos/f2.jpg)“. Bleibt der Stand-Ordner selbst stehen, fehlt der Eintrag. Namen aus dem Stand sind nicht vertrauenswürdig: Zeilenumbrüche und Steuerzeichen werden zu `?`. Das gilt auch für alte `.partial`-Ordner (vorher ohne Meldung). Nach dem Ausdünnen trägt `sg backup` die Namen der Reste in `backup_run.thin_left` ein. Stand ein Rest schon nach dem vorigen fertigen Lauf mit demselben Ziel (`target`) in `thin_left`, setzt es `backup_run.warning` und schreibt sie zusätzlich als „Warnung: …“ auf stderr. Die Warnung ist für die Oberfläche geschrieben, ohne Fehlercodes (die stehen im Log): „Ein alter Backup-Stand lässt sich seit mehreren Läufen nicht löschen (keine Berechtigung). Prüfe das Backup-Ziel und lösche den Ordner „<stand>“ von Hand.“ Ein `.partial` heißt dort „unvollständiger Stand“. Bei mehreren Resten folgen die Ordnernamen, passen sie nicht in 500 Zeichen, mit „und N weitere“. Die Namen sind geprüfte Muster (Stand bzw. `.<stand>.partial`), nie Namen aus dem Stand. Der Lauf bleibt `fertig` mit Exit 0. Fehlen die Spalten (Backup vor der Migration, die sie anlegt), wird nichts eingetragen. Die Oberfläche (Einstellungen → Daten) zeigt nur die Warnung des jüngsten fertigen Laufs als Hinweis über der Liste, auf eine Zeile gebracht (Zeilenumbrüche und Steuerzeichen als Leerzeichen). Ältere Warnungen erscheinen nicht, der jüngste Lauf hat es erneut versucht.
  - **Lesen aus dem Ziel:** `db.dump` (Prüfen und Kopieren, siehe Punkt 3 unten) und `manifest.json` werden mit `O_NOFOLLOW | O_NONBLOCK` geöffnet und per `fstat` geprüft. Ein Symlink, eine FIFO oder ein Gerät an ihrer Stelle blockiert nicht, sondern gilt als `beschaedigt` bzw. als fehlendes Manifest (höchstens 1 MB).
  - **Restore liest den Stand ohne Symlink-Folgen (#119):** `sg restore` (von Hand, `--test` und `--automatisch`) betritt den Stand-Ordner, `media/`, `vault/` und alles darunter verankert (`NoFollowReader`: `chdir` plus Identität, `readdir('.')`, `lstat`, Dateien relativ mit `O_NOFOLLOW | O_NONBLOCK` und Vergleich von `fstat` mit dem gesehenen `lstat`). Das gilt für das Zählen gegen das Manifest und für das Kopieren in den Datenordner. Ein Symlink oder eine Sonderdatei im Stand, ein Stand-Ordner als Symlink oder ein Tausch während des Lesens ergibt `beschaedigt` (Restore-Test: `reason = beschaedigt`, von Hand: Abbruch vor jeder Änderung bzw. Rückbau). Vorher folgte das Lesen einem Symlink `<stand>/media` und holte mit passend gefälschtem Manifest fremde Dateien vom Mac in den Datenordner.
  - **Dateisysteme des Ziels (vom Owner auf dem Mac zu prüfen, #119 N3):** Die Verankerung setzt voraus, dass `dev`/`ino` eines Ordners stabil sind (gleicher Wert über den Pfad und nach `chdir` über `.`). Getestet ist das bisher nur unter Linux (ext4); APFS ist sehr wahrscheinlich stabil, gehört aber in dieselbe Prüfung. Auf **exFAT, FAT32 und SMB-Freigaben (NAS)** unter macOS erzeugt der Kernel die Inode-Nummern selbst bzw. übernimmt sie vom Server. Ist sie dort nicht stabil, scheitert jedes Backup sicher (fail-closed), aber Backups wären dann unmöglich. Prüfung je Ziel-Dateisystem:
    1. Ziel einhängen und einen Testordner anlegen, z. B. `mkdir /Volumes/USB/sg-test/a`.
    2. Identität prüfen: `node -e "const fs=require('fs');const d=process.argv[1];const a=fs.lstatSync(d);process.chdir(d);const b=fs.lstatSync('.');console.log(a.dev===b.dev&&a.ino===b.ino?'OK':'ABWEICHUNG',a.dev,a.ino,b.dev,b.ino)" /Volumes/USB/sg-test/a`. Erwartet: `OK`. Danach Datenträger aus- und wieder einhängen und dasselbe noch einmal: wieder `OK` (die Nummern dürfen sich ändern, müssen aber in sich gleich sein).
    3. Ziel in den Einstellungen auf diesen Datenträger setzen, zweimal `pnpm sg backup` ausführen: beide mit „fertig“. Danach `pnpm sg restore --test <stand>`: „Test bestanden“.
    4. Ausdünnen prüfen: Unter dem Ziel zwei alte Stände am selben Tag anlegen lassen (oder vorhandene alte Stände abwarten) und im Log nach „Alten Stand … entfernt“ bzw. „nicht vollständig entfernt“ sehen. „nicht vollständig … ausgetauscht“ ohne Angreifer heißt: Identität auf diesem Dateisystem nicht stabil, bitte als Issue melden. Eine andere Ursache (etwa `EACCES` oder `EPERM`) nennt das Log ausdrücklich (#124). Achtung: Auch `EACCES` kann von einem Tausch stammen (ein Ordner wird gegen einen Link auf einen Ordner ohne Zugriff getauscht). Das Verhalten bleibt in beiden Fällen fail-closed: Gelöscht wird nichts Fremdes, der Rest bleibt stehen.
    5. ACLs prüfen (APFS/macOS): `ls -lde <ziel>` zeigt Rechte und ACL des Ziels. Erwartet: keine ACL-Einträge, die anderen Benutzern Zugriff geben (Zeilen wie `0: group:everyone allow …` mit `file_inherit`/`directory_inherit`). Sonst erben die privaten Ordner der Hardlinks (H1) diese ACL, und 0700 schützt nicht. Dann die ACL entfernen (`chmod -N <ziel>`) oder ein anderes Ziel wählen.
  - **Hängendes `laeuft` (#113):** Ein abgestürzter Restore-Test (2 Stunden) oder ein abgestürztes Backup (6 Stunden) würde bis zur Frist das Backup vor Migrationen und damit `sg start` blockieren. Darum legt jeder CLI-Prozess für die Dauer seines Laufs eine eigene PID-Datei in den Datenordner: `<Datenordner>/tmp/lauf-restore-test.<pid>.json` mit `started_at` aus `setting.restore_test` bzw. `lauf-backup-<id>.<pid>.json` mit der ID aus `backup_run`. Die PID steht im Namen, so teilen sich zwei von Hand parallel gestartete Prozesse nie eine Datei. Findet `sg backup` ein `laeuft` und gehört **keiner** der Prozesse mit einer Datei zu genau diesem Lauf mehr zu den lebenden (`kill(pid, 0)` → `ESRCH`), setzt es den Eintrag sofort auf `fehler` (Restore-Test: `reason = abgebrochen`) und läuft weiter. Fehlt jede Datei oder lebt einer der Prozesse, gilt wie bisher die Frist. Nach diesen Prüfungen räumt `sg backup` die Dateien toter Prozesse weg (verwaiste nach `kill -9`). Die Meldung nennt dann den Zeitpunkt, ab dem der Lauf als abgebrochen gilt, und den Ausweg `pnpm sg migrate --ohne-backup`. Grenze: Eine nach einem Neustart wiederverwendete PID gilt als lebend (vorsichtige Richtung).
  - `sg migrate`/`sg start` sichern vor ausstehenden Migrationen (`vor_migration`), wenn ein Ziel gesetzt ist; scheitert es, wird nicht migriert (`--ohne-backup` übergeht das).
  - `sg restore` (ohne Stand: Liste) spielt in eine neue Datenbank und neue Ordner ein und tauscht danach. Die alte Datenbank (`<db>_vor_restore_<zeit>`) und Ordner (`media.vor-restore-<zeit>`) bleiben liegen.

- **Automatischer Restore-Test (F-DAT-02, #78):**
  - **Zeitplan:** Der minütliche Takt des Core (`tickRestoreTest`) startet den Test, wenn ein Ziel gesetzt ist, kein Backup und kein Test läuft und der Test fällig ist: noch keiner gelaufen, **30 Tage nach dem letzten bestandenen** (auch ein von Hand gestarteter zählt) oder nach einem fehlgeschlagenen am nächsten Kalendertag (kein Dauerfeuer). War der Mac zum Termin aus, holt der nächste Takt nach dem Start es nach. Gibt es noch kein testbares Backup (siehe unten), wird nichts protokolliert und im nächsten Takt erneut versucht.
  - **Backup und Test schließen sich in beide Richtungen aus** (das Ausdünnen könnte sonst den getesteten Stand löschen): Beide Starts im Core laufen unter derselben Sperre (`BACKUP_LOCK_KEY`). `POST /backup` antwortet `409 restore_test_running`, solange ein Test läuft, `POST /restore-test` und der Zeitplan weichen einem laufenden Backup (`backup_running`), `tickBackup` wartet auf das Ende des Tests. `sg backup` direkt auf der CLI (auch `sg migrate`/`sg start` vor Migrationen) bricht mit Exit 4 und klarer Meldung ab, wenn `restore_test.state = laeuft` (jünger als 2 Stunden und der Prozess des Tests nicht nachweislich tot, siehe „Hängendes `laeuft`“). Umgekehrt prüft ein direkt gestartetes `sg restore --automatisch` nicht auf ein laufendes Backup (Grenze: ein gleichzeitiges Ausdünnen lässt den Test mit `beschaedigt`/`kein_backup` scheitern, es ist kein Sicherheitsproblem).
  - **Start:** Der Core legt den Eintrag `laeuft` selbst an und startet `node infra/sg/src/main.ts restore --automatisch --trigger zeitplan|manuell` (Ausgabe in `logs/restore-test.log`). Die CLI läuft ohne Rückfrage und bei laufendem Core. Ein `laeuft` älter als 2 Stunden gilt als `abgebrochen`. Endet die CLI mit Fehlercode, ohne ihr Ergebnis geschrieben zu haben, setzt der Core `fehler`/`intern`.
  - **Vertrauen (Sicherheit):** `pg_restore` führt SQL als Datenbank-Superuser aus. Ein Stand im Ziel ist nicht authentisch, das Ziel (externer Datenträger, iCloud, Netzlaufwerk) kann für Dritte beschreibbar sein. Die Zusage gilt ausdrücklich nur, wenn **alle** folgenden Punkte halten:
    1. `--automatisch` nimmt weder `<stand>` noch `--ziel` an, sondern nur das Ziel aus `data.backup_target` und nur einen Stand, zu dem es einen **eigenen, protokollierten Lauf** gibt: `backup_run` mit `state = fertig`, diesem Ziel, `stand` und `dump_sha256` (Migration `0004_restore_test`). Läufe vor dieser Version haben keine Prüfsumme und werden nie automatisch getestet. Geprüft werden die jüngsten 5 solchen Läufe, deren Stand noch im Ziel liegt.
    2. **`dump_sha256` entsteht aus den Bytes, die `pg_dump` geschrieben hat** (nicht aus einer Datei im Ziel): `sg backup` lässt `pg_dump` in einen privaten Ordner schreiben (`<Datenordner>/tmp/backup-…`, Ordner 0700), liest die Datei **einmal** und bildet dabei die Prüfsumme und die Kopie ins Ziel (`O_CREAT | O_EXCL | O_NOFOLLOW`: eine im Ziel vorab angelegte Datei lässt den Lauf scheitern, statt durch einen Symlink zu schreiben). Die Datei im Ziel wird danach **nie wieder gelesen**: Eine Manipulation des Ziels während oder nach dem Dump ändert die Prüfsumme in der Datenbank nicht (B2, TOCTOU). Ein Test tauscht die Zieldatei direkt nach dem Kopieren aus und verlangt trotzdem die Prüfsumme der `pg_dump`-Bytes (#113).
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
| Operation anhängen | `services/core/src/sync/append.ts` | `appendOp(tx: Tx, stream: string, op: { kind: SyncOp['kind']; data: unknown; at: number; clockUncertain: boolean; origin: SyncOrigin; opId?: string; deviceId?: string \| null }): Promise<{ seq: number; opId: string; duplicate: boolean }>`. Sperrt `sync_stream`, prüft unter der Sperre die `op_id`, schreibt `sync_op` und meldet die Operation per `pg_notify('sg_sync_op')`. Postgres stellt das erst nach dem Commit zu. `listenCommittedOps(sql, db, onError?)` ruft dann `onOpCommitted` auf, je Strom lückenlos in `seq`-Reihenfolge, auch nach einem Neuverbinden. **Über Ströme hinweg gibt es keine Reihenfolge** (nach einem Neuverbinden kann ein anderer Strom vor den nachgelieferten Operationen eines Stroms ankommen, #143). Wirft der Hook, wiederholt er später ab derselben `seq`. Gelesen und ausgeliefert wird in Paketen zu 500. Optional `listenCommittedOps(sql, db, onError?, { channels })`: weitere LISTEN-Kanäle (z. B. `sg_event`) auf derselben seriellen Kette. Setter: `setOnOpCommitted(hook)`, Standard: nichts. `findOpById(db, opId)` liefert eine gespeicherte Operation, `toCommitted(row)` macht aus einer `sync_op`-Zeile die Form des Hooks | **T1-DB**. T1-08 startet `listenCommittedOps` beim Core-Start und setzt den Hook für Versand und `ack` (§11.2) |
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

## 17. Moodle: Kurszuordnung und Abgleich (T1-23, F-MDL-03/-04)

Ergänzt 08 §9. Datenformate in `packages/schemas/src/moodle.schema.json`. Tabellen aus 08 §9.4 in der Migration `0005_moodle`, die automatische Zuordnung (#141, §17.7) in `0007_moodle_auto`. Die Lead-Entscheidungen aus dem Review von #133 sind hier und in 08 §9.1, §9.2 und §9.4 eingearbeitet.

### 17.1 Festlegungen aus PR #128 (Lead-Entscheidungen in #127)

| Thema | Festlegung |
|---|---|
| Unbekannter, gültiger `ref` | `404 moodle_file_not_found`, `details.reason = "unknown_ref"` |
| Zu große Antwort bzw. Datei | `502 moodle_unreachable`, `details.reason = "too_large"` |
| Grenzen | JSON 16 MiB, Datei 512 MiB (Übernahme als Material: 200 MB wie beim Upload), `limit` 1–50 (Standard 20), `from` Standard „jetzt“ |
| „Bekannte“ Dateien für `GET /moodle/file` | aus Kursinhalt, Aufgaben-Intro, eigener Abgabe und Forenanhängen (im Speicher) **und** dauerhaft alle `moodle_item.file_ref` |
| `MoodleCourse.module_id` | Zuordnung aus `moodle_course_link` (von Hand oder automatisch, §17.7), sonst `null` |
| `MoodleNotification.text` | Klartext (`smallmessage`, sonst `fullmessage`), nie HTML |
| Kurs- und Kategoriesumme | leerer Name erlaubt, die Web-App zeigt „Kurs gesamt“ |

### 17.2 Tabellen (Ergänzungen zu 08 §9.4)

| Tabelle | Ergänzung | Grund |
|---|---|---|
| `moodle_course_link` | `module_id` mit `ON DELETE CASCADE`, eindeutig über `moodle_course_id`. Lösen löscht die Zeile hart. `auto` (`zugeordnet`/`angelegt`, `NULL` = von Hand, #141) | Einstellung, kein Inhalt. Ein Modul kann mehrere Kurse haben |
| `moodle_course_decided` | `moodle_course_id` (eindeutig), `reason` (`auto`/`manuell`/`geloest`/`entfernt`). Kurse, über die schon entschieden ist. Kein Papierkorb (#141). Die Migration trägt bestehende Zuordnungen als `manuell` ein | Die Automatik behandelt jeden Kurs genau einmal, auch nach endgültigem Löschen des Moduls nie wieder |
| `moodle_item` | `activity_name`, `filename` (Anzeige, ≤ 255 Byte UTF-8, Endung bleibt), `mime_type`, `kind_source` (`auto`/`manuell`), `kind_decided_at` (Zeitpunkt der Inbox-Entscheidung, die jüngste gilt für die Aktivität), `last_error` (`kein_pdf`, `zu_gross`, `nicht_gefunden`, `download_fehlgeschlagen`). `sha256` ist `NULL`, solange die Datei nicht geladen wurde. `slide_deck_id`/`exercise_sheet_id` mit `ON DELETE SET NULL` | Anzeige, Inbox-Regel je Aktivität, Wiederholung nach Fehlern |
| `moodle_deadline` | `source` (`aufgabe`/`termin`), `moodle_course_id`, `cmid`, `url`, `removed_in_moodle_at`. Eindeutig je `moodle_assignment_id` bzw. `moodle_event_id` (Teilindex) | Upsert beim Abgleich, keine Dublette Aufgabe ↔ Kalenderereignis |

Die Dateien selbst liegen nur unter der ID des Materials (`media/decks/<id>/original.pdf`, `media/sheets/<id>/original.pdf`, 08 §7), nie unter dem Moodle-Namen. Der Moodle-Name wird nur bereinigt (`sanitizeFilename`) und gekürzt angezeigt bzw. als Titel genutzt.

### 17.3 Endpunkte

Basis `/api/v1`. Die Pfade sind festgelegt (Lead, Review #133).
- **Lokale Endpunkte antworten immer**, auch ohne eingerichtetes Moodle: `GET /moodle/links`, `PUT`/`DELETE /moodle/links/{course_id}`, `DELETE /moodle/links/{course_id}/module`, `GET`/`PATCH /moodle/items`, `GET /moodle/sync`, `GET /moodle/synced-deadlines`. Nur Endpunkte, die Moodle aufrufen, antworten ohne Zugang mit `503 moodle_not_configured` (08 §9.1).
- **Listen** ohne Cursor, mit `limit` (die Menge ist durch die Kursinhalte begrenzt).
- **Inbox:** vorerst `GET /moodle/items?kind=offen` und `PATCH /moodle/items/{id}`. Mit Phase 2 wechseln die offenen Moodle-Dateien zu `inbox_item` (03 §8).
- `items` und `synced-deadlines` zeigen nur Einträge **zugeordneter Kurse mit `sync_enabled`** und nicht gelöschtem Modul. Die Zeilen gelöster oder ausgeschalteter Kurse bleiben in der Datenbank.

| Endpunkt | Body / Query | Antwort | Fehler |
|---|---|---|---|
| `GET /moodle/courses` | – | `MoodleCourseList` mit `module_id`, `suggested_module_id`, `category`. Nur lesend | wie 08 §9.2 |
| `POST /moodle/auto-assign` | – | `MoodleAutoAssignResult` (`assigned`, `created`). Automatische Zuordnung (§17.7). Origin-Schutz wie alle POSTs | `503 moodle_not_configured`, Fehler der Kursliste wie 08 §9.2 |
| `GET /moodle/links` | – | `MoodleCourseLinkList` mit `auto` und `module_removable` | – |
| `PUT /moodle/links/{course_id}` | `MoodleCourseLinkUpdate` | `MoodleCourseLink`. Startet einen Abgleich des Kurses im Hintergrund. Anderes Modul → `auto = null` | `404 module_not_found` |
| `DELETE /moodle/links/{course_id}` | – | `204`. Fristen des Kurses fallen weg, Dateien und Material bleiben. Danach keine Automatik mehr für den Kurs | `404 moodle_link_not_found` |
| `DELETE /moodle/links/{course_id}/module` | – | `204`. „Modul entfernen“: automatisch angelegtes, leeres Modul per Soft-Delete in den Papierkorb (§17.7) | `404 moodle_link_not_found`, `409 moodle_module_not_removable`, `409 session_active` |
| `GET /moodle/items` | `course_id?`, `module_id?`, `kind?`, `include_removed?`, `limit?` (1–1000, Standard 500) | `MoodleItemList`, neueste zuerst. `kind=offen` = Einträge der Inbox | – |
| `PATCH /moodle/items/{id}` | `MoodleItemUpdate` (`folien`/`uebung`/`ignoriert`, `offen` = rückgängig) | `MoodleItem`. Startet bei Folien/Übung einen Abgleich des Kurses. `offen` setzt die Datei und alle mit derselben Entscheidung eingeordneten Dateien der Aktivität zurück (R15), schon angelegtes Material bleibt | `404 moodle_item_not_found` |
| `GET /moodle/sync` | – | `MoodleSyncStatus` | – |
| `POST /moodle/sync` | `MoodleSyncRequest` (`course_id?`) | `202 MoodleSyncStatus`. Läuft schon ein Abgleich oder wartet einer, wird genau einer danach angehängt | `404 moodle_link_not_found` (Kurs nicht zugeordnet), `409 moodle_link_disabled` (zugeordnet, aber `sync_enabled = false`), `503 moodle_not_configured` |
| `GET /moodle/synced-deadlines` | `module_id?`, `from?` (Standard jetzt), `to?`, `limit?` (1–200, Standard 50) | `MoodleSyncedDeadlineList` nach `due_at`, ohne in Moodle entfernte | – |

### 17.4 Ablauf des Abgleichs

- **Wann:** beim Start des Core, danach alle 2 h, auf Knopfdruck (`POST /moodle/sync`), nach dem Bestätigen einer Zuordnung und nach einer Entscheidung in der Inbox. Immer nur ein Lauf gleichzeitig. Direkt gestartet wird nur, wenn weder einer läuft noch einer wartet. Sonst geht die Anfrage im angehängten Lauf auf (Kurse zusammengefasst).
- **Beenden des Core:** Neue Läufe starten nicht mehr, der angehängte wird verworfen. Der laufende bricht zwischen zwei Dateien bzw. Kursen ab (`error_code = abgebrochen`). Das Beenden wartet höchstens `SHUTDOWN_WAIT_MS` (7 s, unter der harten Frist von 10 s in `main.ts`).
- **Zugang:** `nicht_eingerichtet` → kein Lauf (`MoodleSyncStatus.state = aus`). `ungueltig`/`abgelaufen` oder `moodle_token_invalid` während des Laufs → Lauf endet sofort mit `error_code = moodle_token_invalid`, `state = pausiert` (F-MDL-01).
- **Automatik:** Ein voller Lauf (Start, Zeitplan, „Jetzt abgleichen“ ohne `course_id`) ordnet zuerst neue Kurse automatisch zu (§17.7). Die neuen Zuordnungen gleicht derselbe Lauf schon ab. Scheitert die Automatik, gleicht der Lauf die bestehenden Zuordnungen trotzdem ab (`ok = false`).
- **Kurse:** nur Zuordnungen mit `sync_enabled` zu nicht gelöschten Modulen. Ein Fehler in einem Kurs (z. B. `moodle_unreachable`) beendet nur diesen Kurs (`failed_courses`), `last_synced_at` bleibt dann stehen.
- **Dateien:** sichtbare Dateien sichtbarer Abschnitte und Aktivitäten, wiedererkannt über `file_ref`.
  - Neu: Einordnung nach 17.5, dann laden und anlegen. Nicht-PDF → `ignoriert` (nur gelistet). Eine `.pdf` ohne `%PDF` im Inhalt → `ignoriert` mit `last_error = kein_pdf`. Das gilt nur für diese Fassung: Ändern sich `timemodified` oder Größe, wird neu eingeordnet und geprüft.
  - Eine neue Revision im Pfad (`…/content/<rev>/…`) ergibt einen neuen `file_ref` und damit eine neue Datei. Die alte wird als „in Moodle entfernt“ markiert.
  - Geändert (`timemodified` oder Größe): bei Folien/Übung neu laden. Gleicher `sha256` → nur Metadaten. Anderer → neuer Foliensatz bzw. neues Blatt, das alte bleibt. Die Abbildung von Notizen auf die neue Fassung (F-ORG-02) ist noch nicht umgesetzt.
  - Unverändert: nichts laden und keine Zeile schreiben.
  - Weg oder versteckt: `removed_in_moodle_at` setzen, lokal nichts löschen. Taucht die Datei wieder auf, wird die Markierung entfernt.
- **Anlegen** über `createSlideDeck` bzw. `createExerciseSheet` (wie beim Upload, mit `pdf.ingest`). Gleicher `sha256` schon im Modul → keine Kopie, nur Verknüpfung. Titel = Dateiname ohne `.pdf`, Blattnummer aus dem Namen.
- **Fristen:** Aufgaben der Kurse mit `duedate` (`aufgabe`) und kommende Kalenderereignisse (`termin`, höchstens 50), außer Ereignissen zu einer schon übernommenen Aufgabe (gleiche `cmid`). Weggefallene Aufgaben bzw. kommende Ereignisse → `removed_in_moodle_at`.
- **Blatt ↔ Aufgabe:** gleiche Aktivität, sonst gleiche Blattnummer, sonst gleicher Name im selben Modul, jeweils nur eindeutig. Das Blatt bekommt das Abgabedatum, wenn es noch keins hat. Ändert Moodle die Frist, zieht das Blatt nur mit, solange es noch das alte Datum trägt.

### 17.5 Einordnung (08 §9.4, F-MDL-04)

Zuerst der Dateiname, dann der Name der Aktivität. Vorher NFC (Namen aus macOS kommen oft als NFD, nie NFKC), dann normalisiert (ü → ue) und an Grenzen zwischen Buchstaben und ASCII-Ziffern `[0-9]` getrennt.
- **Folien:** Folie(n), Vorlesung(en), VL, Slide(s), Lecture(s), auch in Zusammensetzungen („Vorlesungsfolien“).
- **Übung:** Übung(en), Blatt/Blätter, Aufgabe(n), Exercise(s), Sheet(s), Muster `u05`, `ue3`, `Ü 05`, auch in Zusammensetzungen („Übungsblatt“, „Hausaufgabe“).
- **Inbox (`offen`):** keine oder beide Arten, oder ein Hinweis auf eine Lösung („Lösung“, „Solution“). Musterlösungen landen so bewusst in der Inbox, nicht als Übungsblatt (Lead, Review #133).
- Eine Entscheidung in der Inbox (`kind_source = manuell`) gilt für die Datei, alle offenen Dateien derselben Aktivität und künftige Dateien der Aktivität.

### 17.6 Kurszuordnung (F-MDL-03)

- `category`: `organisatorisch` bei Wortteilen wie „Klausurtermin“, „Prüfungsamt“, „Fachschaft“, „Informationen“. `alt`, wenn der Kurs mehr als `SEMESTER_START_TOLERANCE_DAYS` = 30 Tage vor dem Beginn des aktuellen Semesters startet (Konstante in `services/core/src/moodle/classify.ts`; ohne Semesterbeginn: schon beendet). Sonst `aktuell`.
- `suggested_module_id` nur für `aktuell` ohne Zuordnung: Name bzw. Kürzel eines Moduls des aktuellen Semesters im Kursnamen (wie F-KAL-02), sonst eindeutige Abkürzung. Ein Vorschlag ist keine Zuordnung, abgeglichen wird erst nach `PUT /moodle/links/{course_id}` bzw. nach der automatischen Zuordnung (§17.7).

### 17.7 Automatische Zuordnung (#141, Owner-Wunsch vom 05.11.2026)

Bewusste Abweichung von F-MDL-03 („jede Zuordnung bestätigen“): Kurse werden ohne Handarbeit zugeordnet, sichtbar und umkehrbar (R15). Keine KI. Code: `services/core/src/moodle/auto.ts` und `course-name.ts`.

- **Wann:** beim vollen Abgleich (§17.4) und auf `POST /moodle/auto-assign`. Die Web-App ruft ihn beim Öffnen von Einstellungen › Moodle auf, wenn Moodle eingerichtet ist. `GET /moodle/courses` schreibt nie.
- **Wer:** jeder Kurs der Art `aktuell` ohne Zuordnung (auch keine zu einem gelöschten Modul) und ohne Eintrag in `moodle_course_decided`. Jeder behandelte Kurs bekommt dort sofort `auto`: Die Automatik behandelt ihn genau einmal. Ein endgültig gelöschtes Modul kommt nie zurück.
- **Ohne aktuelles Semester** (nicht gelöscht, nicht archiviert): nichts, auch keine Zuordnung zu bestehenden Modulen. Die Web-App zeigt in Einstellungen › Moodle „Lege zuerst das Semester an.“ (gibt es Semester, aber keines ist aktuell: „Wähle zuerst das aktuelle Semester.“) mit Link zu den Semestern.
- **Treffer** gegen die Module des aktuellen Semesters. Automatisch zählen nur zwei sichere Wege:
  - Name bzw. Kürzel des Moduls als ganze Wortfolge im Kursnamen (Stufe 1 aus F-KAL-02, der genauere Treffer gewinnt)
  - Moodle-Kürzel gleich dem Kürzel des Moduls

  Genau ein Modul → zuordnen, `auto = zugeordnet`. Alles Unsichere, das der Vorschlag (§17.6) noch findet (Abkürzungen wie „STA“ → „Statistik“, Wortanfänge, Ort), und mehrere Treffer gelten als mehrdeutig: keine Automatik, kein neues Modul, der Kurs bleibt Vorschlag. Mehrdeutig ist auch eine andere Stufe: römische Zahl, Zahl oder Buchstabe A–F als eigenes Wort, die das Modul nicht hat („Statistik II“, „Statistik Teil B“ ↛ „Statistik“).
- **Kein Treffer:** neues Modul im aktuellen Semester über `createModule` (Farbe, Notizbücher wie von Hand), `auto = angelegt`, nur mit dem bereinigten Namen, **ohne Kürzel** (die Seitenleiste zeigt das Kürzel statt des Namens). Kurse mit gleichem bereinigtem Namen teilen sich ein Modul („Statistik“ und „Übung Statistik“). Module desselben Laufs zählen beim Treffer nicht mit, so entscheidet die Reihenfolge der Kurse nichts. Bleibt nach der Bereinigung kein Name bzw. kein Schlüssel übrig („-“, „???“), entsteht kein Modul.
- **Modulname** aus dem Kursnamen (NFC, nie NFKC):
  - Semesterzusätze weg: WiSe/SoSe/Wintersemester/Sommersemester mit oder ohne Jahr, WS/SS/Winter/Sommer nur mit Jahr. Jahresfolgen (`JJ/JJ`, `JJJJ/JJ`, `JJJJ/JJJJ`, auch länger wie `2026/2027/2028`) nur, wenn die Jahre aufeinanderfolgen und zwischen 2015 und 2040 liegen („Kapitel 12/13“ bleibt). Groß- und Kleinschreibung zählt. Klammern werden aufgeräumt: „Marketing (WiSe 26/27, Gruppe 1)“ → „Marketing (Gruppe 1)“.
  - Terminarten weg (`KIND_WORD_RE` aus F-KAL-02: Vorlesung, VL, Übung, Ü, Tutorium, Tut, Prüfung, Klausur, Exam, Lecture), nur als ganze Wörter.
  - Unterstriche → Leerzeichen. Führender Kurs-Code (Großbuchstaben mit Ziffern, z. B. `BMBWL110`) weg, wenn danach noch Text kommt.
  - `ae/oe/ue` → Umlaut nur in Wörtern ohne Umlaut und nur für die Wortstämme in `UMLAUT_STEMS` (Einführung, Führung, Übung, Prüfung, Ökonom…, Geschäft, künstlich, öffentlich, Gründung, Überblick, Übersicht).
  - Sonst bleibt der Name, wie Moodle ihn schreibt, auch mit Tippfehlern. Höchstens 120 Zeichen (Codepoints, kein Surrogat-Paar wird zerschnitten).
- **Idempotent:** Der ganze Lauf ist eine Transaktion unter der Advisory-Sperre `MOODLE_AUTO_LOCK_KEY` (`lib/locks.ts`). `PUT`/`DELETE /moodle/links/{course_id}` und „Modul entfernen“ nehmen dieselbe Sperre. Gleichzeitige Läufe ergeben keine doppelten Module.
- **Umkehrbar:**
  - „Lösen“ (`DELETE /moodle/links/{course_id}`) setzt `reason = geloest`. Von Hand zuordnen geht weiter (`PUT` trägt `manuell` ein, wenn noch keine Entscheidung besteht).
  - Wechselt das Modul von Hand, wird `auto = null`. Der Schalter „Abgleichen“ lässt den Vermerk stehen.
  - „Modul entfernen“ (`DELETE /moodle/links/{course_id}/module`) nur bei `auto = angelegt` und leerem Modul (`module_removable`): keine Session, keine Seite, kein freies Notizbuch, kein Material außer dem aus Moodle übernommenen, kein von Hand zugeordneter Termin (`calendar_event.assigned_by = manuell`), kein weiterer Kurs. Prüfen, Soft-Delete und `reason = entfernt` laufen in einer Transaktion unter der Sperre. Die Zuordnung bleibt und lebt mit dem Wiederherstellen aus dem Papierkorb wieder auf.
- **Web-App:** Jede automatisch zugeordnete Zeile trägt „automatisch zugeordnet“ bzw. „Modul automatisch angelegt“. Nach „Modul entfernen“ bietet ein Toast „Rückgängig“ (`POST /trash/{id}/restore`).

**Neue Fehlercodes:** `moodle_link_not_found`, `moodle_item_not_found` (404), `moodle_link_disabled` (409), `moodle_module_not_removable` (409, #141). `MoodleSyncRun.error_code` kann außerdem `abgebrochen` sein (Beenden des Core).

**Zeitformat:** Die neuen Antworten liefern Zeiten nach §6 (ohne `.000`). Die Lese-Endpunkte aus T1-22 liefern noch `.000Z`, das gleicht Folge-Issue #129 an.

---

# Phase 2

## 18. Transkription und Rückblick (T2-01, F-NAC-01/-02)

Erster Schnitt von Phase 2: **Aufnahme → Transkript → Folienzuordnung → Rückblick**. Ergänzt 03 §5, 05 §2, P4 und P5a, 08 §1 und §5.
Datenformate in `packages/schemas/src/transcript.schema.json` und `jobs.schema.json`, Tabellen in der Migration `0006_transcript`.
Nicht Teil dieses Schnitts: `align.content` (F-NAC-03), Konzepte, Karten, Suche, `GET /sessions/{id}/timeline`.

### 18.1 Tabellen

| Tabelle | Inhalt | Schreiber |
|---|---|---|
| `transcript` | Ein Transkript **je Aufnahme**: `session_id`, `recording_id` (eindeutig), `job_id` (schreibender `transcribe`-Job), `finalize_job_id` (der `audio.finalize`-Job, dessen `full.m4a` transkribiert wurde), `provider` (`mlx-whisper` \| `fake`), `model`, `language` (erkannt, ISO 639-1, nullbar), `initial_prompt` (≤ 200 Whisper-Tokens nach §18.6, die Datenbank prüft nur ≤ 2 000 Zeichen), `input_hash`, `audio_sha256`, `audio_duration_ms`, `segment_count`, `word_count` | Worker (`transcribe`) |
| `transcript_segment` | Abschnitt nach der Nachbearbeitung (§18.2): `transcript_id`, `session_id`, `recording_id`, `seq` (ab 0, eindeutig je Transkript), `start_ms`, `end_ms` (Sitzungszeit, `end_ms ≥ start_ms`), `text`, `lang`, `speaker` (Phase 2: immer `NULL`), `avg_logprob`, `no_speech_prob`, `words jsonb` (`TranscriptWord[]` oder `NULL`), `embedding vector(1024)` (bis zu einem späteren Ticket `NULL`, noch ohne Index) | Worker (`transcribe`) |
| `slide_segment` | Welche Folie wann lief: `session_id`, `slide_id` (ohne FK, wie §6), `slide_index`, `start_ms`, `end_ms` (ausschließlich, `end_ms > start_ms`), `source` (`log` \| `ausrichtung` \| `manuell`), `confidence` (0..1), `job_id` (nullbar) | Worker (`align.log`, später `align.content`), später Core (`manuell`) |

- Alle drei Tabellen haben die Pflichtfelder aus 03 §1 und den `updated_at`-Trigger. Fremdschlüssel auf `session` und `transcript` → `recording` mit `ON DELETE CASCADE`: Endgültiges Löschen der Session (§13) nimmt alles mit.
- `transcript_segment` zeigt mit einem **zusammengesetzten** Fremdschlüssel `(transcript_id, recording_id, session_id)` → `transcript(id, recording_id, session_id)` (Unique-Constraint `transcript_id_recording_session_uq`, `ON DELETE CASCADE`). Ein Abschnitt kann so nie zu einer anderen Aufnahme oder Session gehören als sein Transkript.
- **Speicherform: DB-Zeilen je Abschnitt, Wörter als `jsonb` am Abschnitt** (03 §5 sieht das so vor). Keine JSON-Datei mit Index. Gründe: Lesen einer Folie ist eine Indexabfrage `(session_id, start_ms)`; Backup, Papierkorb und Wiederherstellung funktionieren ohne Sonderweg; Belege und Suche können später auf Zeilen zeigen.
- **Größe (gemessen, Migration 0006, Postgres 16):** 90 min mit 450 Abschnitten und 11 700 Wörtern belegen ≈ 0,6 MB (Tabelle mit TOAST). Die Wörter allein ≈ 0,27 MB komprimiert, als JSON-Text ≈ 0,84 MB, der reine Text ≈ 80 KB. Die Testdaten waren sehr gleichförmig. Bei echtem Text komprimiert `jsonb` schlechter, gerechnet wird darum mit **≤ 1 MB je Vorlesung** (≈ 100 MB für 100 Vorlesungen). Die API liefert Wörter nur auf Anfrage (§18.4).
- **Ersetzen ist hart, Löschen weich.** `transcribe` und `align.log` ersetzen ihre eigenen früheren Ergebnisse mit `DELETE` (05 §1, kein Papierkorb für Maschinenausgaben). Das weiche Löschen einer Session setzt auf allen drei Tabellen **denselben** `deleted_at` (Kaskade §13). Die Wiederherstellung holt sie mit zurück.
- **Segment-IDs sind nicht stabil.** Ein neuer `transcribe`-Lauf vergibt neue IDs. Spätere Belege auf das Transkript verweisen darum auf Session und Zeitraum: Bei `evidence.kind = transcript` ist `ref_id` die `session_id`, dazu `t_start_ms` und `t_end_ms` (03 §7). Nie `transcript_segment.id`.

### 18.2 Kette, Fortschritt und `transcribe`

**Kette nach dem Session-Ende** (05 §2): `audio.finalize → transcribe` und `audio.finalize → align.log`. `align.log` hängt **nicht** von `transcribe` ab (Lead-Entscheidung im Review von #142). Die Folienzuordnung kommt so auch dann, wenn die Transkription scheitert.

| Job | Payload | `priority` | `depends_on` | Ergebnis (`job.result`) |
|---|---|---|---|---|
| `audio.finalize` | `AudioFinalizePayload` (§3, unverändert) | 0 | §3 | `AudioFinalizeResult` |
| `transcribe` | `TranscribePayload` `{ session_id, force? }` | 20 | alle `audio.finalize`-Jobs der Session in `wartet`/`laeuft`, dazu ein laufender `transcribe` der Session | `TranscribeResult` |
| `align.log` | `AlignLogPayload` `{ session_id }` | 10 | alle `audio.finalize`-Jobs der Session in `wartet`/`laeuft`, dazu ein laufender `align.log` der Session | `AlignLogResult` |

`job.session_id` ist immer gesetzt. `max_attempts` bleibt 3. `transcribe` (20) wird bei freiem Worker vor `align.log` (10) geholt. **Ein neuer Job erbt den Fehlschlag eines gleichzeitig laufenden:** Er hängt von ihm ab und wird nach §3 `abgebrochen`, wenn jener scheitert. Abweichung von 08 §5: `transcribe` hat kein `provider` im Payload, den Anbieter wählt der Worker (`SG_TRANSCRIBER`, §18.6).

**Kette anlegen (Core):** `ensurePipelineJobs(tx, sessionId, { fromStep, force })` in `services/core/src/services/pipeline.ts`. Der Aufrufer hält die Session-Zeile (`FOR NO KEY UPDATE`). Sperrreihenfolge wie §16.2: Session → `lockRecording` (nur bei `fromStep = audio.finalize`, nach ID sortiert) → Job-Zeilen.

1. **`audio.finalize`** (nur bei `fromStep = audio.finalize`): für jede nicht gelöschte Aufnahme mit mindestens einem Chunk der neueste `audio.finalize`-Job. `wartet` → wiederverwenden, `run_after = now()`. `laeuft` → wiederverwenden. `fertig` → nur mit `force` ein neuer Job. `fehler`, `abgebrochen` oder keiner → neuer Job ohne Wartezeit.
2. **`transcribe`** (bei `fromStep` `audio.finalize` oder `transcribe`): Wartet schon ein `transcribe` der Session, wird er wiederverwendet. `payload.force` wird dann zu `alter Wert ODER force`, die `depends_on` werden um die offenen `audio.finalize`-Jobs ergänzt. **Vorher fallen alte Abhängigkeiten weg, die in `fehler` oder `abgebrochen` stehen, gelöscht sind oder nicht mehr existieren** (sonst bricht der Worker den Job nach §3 ab, und „Mit vorhandenem Audio fortfahren“ scheitert still). Sonst entsteht ein neuer Job mit `depends_on` laut Tabelle.
3. **`align.log`** (immer): Wartet schon einer, wird er wiederverwendet, die `depends_on` werden wie bei `transcribe` bereinigt und um die offenen `audio.finalize`-Jobs ergänzt. Sonst entsteht ein neuer Job mit `depends_on` laut Tabelle.
4. **Fortschritt:** Für jeden Typ, zu dem ein Job angelegt oder wiederverwendet wurde, `session.processing[<typ>]` mit **derselben Zusammenfassung wie der Worker** neu berechnen (unten, „Zusammenfassung“). Nie pauschal `wartet` setzen: Ein laufender Job bleibt `laeuft`. Danach `updated_at` anheben und `session.updated` senden (wie §11.6).

Rückgabe: die Jobs in Ketten-Reihenfolge. Aufgerufen wird die Funktion an zwei Stellen:
- **Beim Stopp** (`finishSession`, §9.1) nach den `ensureFinalizeOnStop`-Aufrufen mit `fromStep = transcribe`. Das gilt nur, wenn die Session danach mindestens einen `audio.finalize`-Job in `wartet`, `laeuft` oder `fertig` hat. Dann ist ein Job offen, die Session wird `beendet` und erst `verarbeitet`, wenn `transcribe` und `align.log` fertig oder gescheitert sind (§3). Ohne Audio entsteht keine Kette, und die Session wird wie bisher sofort `verarbeitet`. Beim Stopp wird zusätzlich `processing['audio.finalize']` aus der Zusammenfassung gesetzt, sobald es einen Job dieses Typs gibt. So zeigt die Schrittliste „Audio“ auch in der Gnadenfrist, solange `audio.finalize` noch `wartet`.
- **Bei `POST /sessions/{id}/reprocess`** (§18.5).

**Nachzügler:** Audio, das erst nach dem Stopp kommt (eine nachträglich angelegte Aufnahme oder ein später Chunk), setzt nur `stale` und löst **keine** automatische Kette aus. Es entsteht nur `audio.finalize` wie bisher (§3). Das Transkript gilt dann als veraltet (`stale`, §18.4), und der Rückblick bietet „Transkript aktualisieren“ an. Damit ist die offene Frage aus §10.1 („Offen für T1-04“) beantwortet.

**Fortschritt (`session.processing`):**
- **Zusammenfassung (verbindlich für Core und Worker, ersetzt Schritt 2 in §3):** Je Job-Typ zählt in jeder **Einheit** nur der neueste nicht gelöschte Job (`created_at`, dann `id`, absteigend). Läuft in der Einheit ein Job, gilt sie als `laeuft`, auch wenn dahinter ein neuerer wartet. Einheit ist bei `audio.finalize` die Aufnahme (`payload->>'recording_id'`), bei `transcribe` und `align.log` die Session. Über die Einheiten hinweg gilt: `fehler` vor `laeuft` vor `wartet` vor `fertig`, `abgebrochen` nur, wenn alle Einheiten `abgebrochen` sind. Ohne Job bleibt der Schlüssel unverändert. Ein gescheiterter Job, dem ein neuer folgt (`reprocess`), zählt so nicht mehr. Referenz-SQL (`%(sid)s` = Session, `%(type)s` = Job-Typ):

```sql
WITH j AS (
  SELECT state, created_at, id,
         CASE WHEN type = 'audio.finalize' THEN payload->>'recording_id' ELSE '' END AS unit
  FROM job WHERE session_id = %(sid)s AND type = %(type)s AND deleted_at IS NULL
), u AS (
  SELECT DISTINCT ON (unit)
         CASE WHEN bool_or(state = 'laeuft') OVER (PARTITION BY unit) THEN 'laeuft' ELSE state END AS state
  FROM j ORDER BY unit, created_at DESC, id DESC
)
SELECT CASE WHEN count(*) = 0 THEN NULL
            WHEN bool_or(state = 'fehler') THEN 'fehler'
            WHEN bool_or(state = 'laeuft') THEN 'laeuft'
            WHEN bool_or(state = 'wartet') THEN 'wartet'
            WHEN bool_or(state = 'fertig') THEN 'fertig'
            ELSE 'abgebrochen' END
FROM u;
```

- Der Core rechnet beim Anlegen nach dieser Regel (oben, Schritt 4). Der Worker zieht den Stand nach jedem Endzustand nach (§3) und ersetzt dafür `_SUMMARY_SQL` in `progress.py` durch diese Regel (T2-02a).
- **Neu (T2-02a):** Der Worker zieht den Stand auch beim Abholen nach. Direkt nach dem Commit von `claim_next` folgt in einer eigenen Transaktion `progress.refresh(conn, session_id, [type])` (Session zuerst gesperrt). So erscheint `laeuft`. Gilt für jeden Job mit `session_id`.
- **Anzeige** (07 §6 „ruhige Schrittliste“): Schritte in der Reihenfolge von `PipelineStep`, nur die, die als Schlüssel in `processing` stehen. Texte: `audio.finalize` „Audio“, `transcribe` „Transkript“, `align.log` „Folien zuordnen“. Zustände: `fertig` „✓“, `laeuft` „…“, `wartet` „–“, `fehler` und `abgebrochen` „nicht fertig“ mit „Erneut versuchen“ (§18.5, `from_step` = erster Schritt in `fehler`/`abgebrochen`). Steht `audio.finalize` auf `fehler`, gibt es zusätzlich „Mit vorhandenem Audio fortfahren“ (`from_step: "transcribe"`). Keine Prozentangaben, keine Benachrichtigungen.

**`transcribe` im Worker** (`services/worker/src/sg_worker/handlers/transcribe.py`):

1. Payload mit `TranscribePayload` prüfen (`PayloadError` → `fehler` ohne Retry).
2. Ohne Sperre lesen: Session (fehlt die Zeile ganz → `NonRetryableError("Session unbekannt")`. Ist sie weich gelöscht → `fertig` mit `session_deleted = true`, nichts schreiben), Modul (`name`, `lang`), Foliensatz der Session, nicht gelöschte Aufnahmen nach `started_ms`, `id`. Je Aufnahme der neueste `audio.finalize`-Job in `fertig`.
3. `initial_prompt` und Sprache nach §18.6 bilden.
4. Je Aufnahme:
   - **Ohne Audio:** Kein fertiger `audio.finalize`, `recording.duration_ms` ist `NULL` oder 0, oder `media/recordings/<recording_id>/full.m4a` fehlt (Pfad nur aus der ID, nie aus einer Spalte). Ergebnis `ohne_audio`, ein vorhandenes Transkript wird entfernt.
   - `audio_sha256` = SHA-256 der Datei. `input_hash` = SHA-256 (hex) über UTF-8 von `pipeline_version \n audio_sha256 \n provider \n model \n sprache \n initial_prompt`, fehlende Werte als leere Zeichenkette. `pipeline_version` ist eine Konstante im Worker (`PIPELINE_VERSION = "p4-v1"`). Sie steigt, wenn sich Nachbearbeitung, Prompt-Regeln oder die Fensterung ändern. Dann wird beim nächsten Lauf neu transkribiert.
   - **Unverändert:** Gibt es ein Transkript mit gleichem `input_hash` und ist `force` nicht gesetzt, wird nichts transkribiert. Nur `finalize_job_id` wird auf den aktuellen Job gesetzt (Ergebnis `unveraendert`).
   - **Sonst:** Transcriber aufrufen (§18.6), **außerhalb** einer Transaktion. Der Heartbeat läuft weiter. Danach die Nachbearbeitung (unten). Dann **eine Transaktion je Aufnahme**: Session sperren (`progress.lock_session`, gelöscht → wie Schritt 2), prüfen, dass der Job noch diesem Worker gehört (`SELECT … FROM job WHERE id = … AND state = 'laeuft' AND locked_by = … FOR UPDATE`, sonst `LockLostError`), altes Transkript der Aufnahme löschen (Segmente per Kaskade), neues mit Segmenten einfügen, Commit. Ein Abbruch danach verliert so keine fertige Aufnahme, der nächste Versuch überspringt sie über `input_hash`.
5. Abschluss in einer Transaktion: Session sperren, Transkripte der Session zu gelöschten Aufnahmen und zu Aufnahmen `ohne_audio` löschen (`removed_transcripts`), `ctx.finish(TranscribeResult)`.

**Zeiten:** Whisper liefert Sekunden ab Dateibeginn. `full.m4a` beginnt bei `recording.started_ms` (§3, Lücken sind Stille). Darum gilt Sitzungszeit = `recording.started_ms + round(s · 1000)`, für Abschnitte und Wörter.

**Nachbearbeitung (05 §P4), in dieser Reihenfolge:**
1. Abschnitte mit `no_speech_prob > 0,6` verwerfen, ebenso Abschnitte mit leerem Text (nach `trim`).
2. Wiederholung verwerfen: Abschnitt, dessen normierter Text (klein, Satzzeichen entfernt, Leerraum zusammengefasst) dem des zuletzt behaltenen gleicht, **wenn die Lücke dazu höchstens 2 000 ms beträgt** (Lead-Entscheidung im Review von #148). Ein „Okay.“ bei 0 s und eines bei 600 s bleiben beide.
3. Zusammenführen: Der nächste Abschnitt wird an die laufende Gruppe angehängt, wenn alle drei Bedingungen gelten. (a) Die Lücke ist ≤ 2 000 ms. (b) Die Gruppe ist kürzer als 5 000 ms oder ihr Text endet nicht auf `.`, `?`, `!` oder `…`. (c) Die Gruppe wird dadurch nicht länger als 30 000 ms. Sonst beginnt eine neue Gruppe.
4. Je Gruppe: `text` = Texte mit einem Leerzeichen verbunden, `avg_logprob` = nach Dauer gewichtetes Mittel, `no_speech_prob` = Maximum, `lang` = erkannte Sprache der Aufnahme, `words` = Wörter der Gruppe oder `NULL`, wenn der Transcriber keine liefert.
5. Wörter: `text` ohne Leerraum am Rand (Whisper liefert führende Leerzeichen), leere Wörter verwerfen, `prob` auf 0..1 begrenzen, Zeiten in den Abschnitt klemmen, `end_ms ≥ start_ms`.

**Fehler und Wiederholung:**

| Fall | Ergebnis |
|---|---|
| Payload ungültig | `fehler` sofort (§3) |
| Session-Zeile fehlt | `fehler` sofort (`NonRetryableError`) |
| Session weich gelöscht | `fertig`, `session_deleted = true`, nichts geschrieben |
| Keine Aufnahme mit Audio | `fertig`, alle Aufnahmen `ohne_audio`. Der Rückblick zeigt „Keine Aufnahme“ |
| Transcriber nicht verfügbar (`mlx_whisper` lässt sich nicht importieren, unbekannter `SG_TRANSCRIBER`) | `fehler` sofort, `error = "Transkription nicht verfügbar: <Grund>"` |
| Audiodatei lässt sich nicht dekodieren | `fehler` sofort, `error` nennt die `recording_id`, keinen Pfad |
| Alles andere (Speicher, Modell-Download ohne Netz, Absturz) | Retry nach §3 (30 s, 60 s), danach `fehler` |
| Lock verloren | `LockLostError`, nichts mehr schreiben. Schon geschriebene Aufnahmen bleiben |

`fehler` in `transcribe` lässt `align.log` unberührt (keine Abhängigkeit). Die Session wird trotzdem `verarbeitet`. Der Rückblick zeigt die Folien mit „Transkript nicht fertig · Erneut versuchen“. `fehler` in `audio.finalize` bricht beide über `depends_on` ab (§3).

### 18.3 `align.log` (05 §P5a)

`services/worker/src/sg_worker/handlers/align_log.py`. Der ganze Job läuft in **einer** Transaktion (schnell, keine KI), Session zuerst gesperrt.

1. Payload prüfen. Fehlt die Session-Zeile: `fehler` sofort. Ist sie weich gelöscht: `fertig` mit `session_deleted = true`.
2. **Ende der Zeitleiste** `timeline_end_ms` = Maximum aus `ended_at − started_at` (wenn beide gesetzt) und, über alle nicht gelöschten Aufnahmen, `started_ms + coalesce(duration_ms, completed_duration_ms, 0)`.
3. **Kein Foliensatz** (`session.slide_deck_id` leer oder gelöscht): alte `log`-Segmente löschen, `mode = folienlos`, fertig.
4. **Folienwechsel:** nicht gelöschte `slide_event` der Session. Zeit `t = t_ms + offset_ms`. Den Versatz gibt es nur für `device = ipad`: Das Gerät findet sich über `sync_op` (Strom `session:<id>`, `kind = slide.change`, `data->>'event_id' = slide_event.id`), `offset_ms` dann aus `session.start_offsets` (§9.3). Sonst ist der Versatz 0. `t` auf `[0, timeline_end_ms]` klemmen und nach `(t, created_at, id)` sortieren.
5. **Folie bestimmen** immer über den Foliensatz der Session und `slide_index` (nicht gelöschte `slide` mit diesem `index`), nicht über `slide_event.slide_id`. Gibt es die Folie nicht, fällt der Wechsel weg (`unresolved_events`).
6. **Start:** Vor dem ersten Wechsel gilt Folie 1, wie im Dashboard ohne Wechsel. Dafür steht ein gedachter Wechsel bei `t = 0` vorn, wenn Folie 1 existiert. Er zählt nicht in `event_count` und nicht in `skipped_events`. Fällt er als Durchgang weg, übernimmt der erste stabile Wechsel den Anfang (Schritt 7).
7. **Durchgänge:** Ein Wechsel, dessen Standzeit (bis zum nächsten Wechsel bzw. bis `timeline_end_ms`) unter 1 500 ms liegt, fällt weg (`skipped_events`). Die Standzeiten werden einmal aus der Liste von Schritt 5 berechnet, nicht wiederholt. **Danach beginnt der erste verbleibende Wechsel bei `t = 0`:** Die Zeit vom Aufnahmestart bis zur ersten stabilen Folie gehört zu dieser Folie (Lead-Entscheidung im Review von #148). Bleibt kein Wechsel übrig und ist `timeline_end_ms > 0`, gilt der letzte Eintrag der Liste (ggf. der gedachte Start) ab 0. Er zählt dann nicht in `skipped_events`.
8. **Segmente:** Jeder verbleibende Wechsel gilt bis zum nächsten, der letzte bis `timeline_end_ms`. Aufeinanderfolgende Segmente derselben Folie werden verschmolzen, leere entfallen. `source = log`, `confidence = 1`, `job_id` = dieser Job.
9. **Ersetzen:** `DELETE FROM slide_segment WHERE session_id = … AND source = 'log'`, neue Zeilen einfügen, `ctx.finish(AlignLogResult)`. `mode = log`, wenn mindestens ein echter Wechsel übrig ist, sonst `ohne_wechsel` (ganze Session auf Folie 1).

`align.log` nutzt das Transkript nicht. Die Teilung eines Abschnitts an der Foliengrenze (05 §P5a) passiert beim Lesen (§18.4). So bleiben Transkript und Ausrichtung unabhängig, und `align.content` (später) muss das Transkript nicht umschreiben.

### 18.4 `GET /sessions/{id}/transcript`

| Query | Bedeutung |
|---|---|
| `slide_id` (optional, `Uuid`) | nur Zeilen dieser Folie. Eine unbekannte Folie ergibt leere `lines`, keinen Fehler |
| `include_words` (optional, `true`/`false`, Standard `false`) | `words` an jeder Zeile mitliefern, genau die Wörter dieser Zeile (bei Regel 4 alle des Abschnitts, bei Regel 3 die des Teils), `[]` ohne Wort-Zeitstempel (≈ 0,9 MB je 90 min statt ≈ 0,2 MB) |

Antwort 200 `SessionTranscript`. Fehler: `404 session_not_found` (auch weich gelöscht), `400 validation_failed`. Keine Route nur für lokal.

- **`slide_source`:** Zuerst entfallen gelöschte Segmente und Segmente gelöschter Folien. **Danach** wird die erste Quelle aus `manuell`, `ausrichtung`, `log` gewählt, die noch Segmente hat, sonst `null`. Hängen alle `manuell`-Segmente an gelöschten Folien, gilt also `ausrichtung` (und nicht eine leere Liste). `slide_segments` enthält nur Segmente dieser Quelle, nach `start_ms` sortiert.
- **`transcripts`:** nicht gelöschte `transcript` der Session als `TranscriptInfo`. `stale` ist `true`, wenn der neueste `audio.finalize`-Job der Aufnahme (derselben Session) in `fertig` nicht `finalize_job_id` ist. **Gibt es keinen fertigen `audio.finalize`-Job, ist das Transkript nicht `stale`** (ein wartender, laufender oder gescheiterter Job ändert daran nichts).
- **`recordings`:** nicht gelöschte Aufnahmen als `Recording` (wie im Snapshot), nach `started_ms`. Audio liefert `GET /recordings/{id}/audio` (§7.3, mit `Range`). `from_ms`/`to_ms` bleiben ungenutzt.
- **`stale` (oben):** `true`, wenn ein Transkript `stale` ist oder eine Aufnahme mit `duration_ms > 0` und fertigem `audio.finalize` kein Transkript hat.
- **`lines`:** aus den nicht gelöschten Abschnitten, sortiert nach `(start_ms, recording_id, seq)`. **Teilung an Foliengrenzen**, für jeden Abschnitt `G` mit den Segmenten `S` aus `slide_segments`:
  1. Überlappend sind die `s` mit `s.start_ms < G.end_ms` und `G.start_ms < s.end_ms`. Bei `G.start_ms = G.end_ms` gilt `s.start_ms ≤ G.start_ms < s.end_ms`.
  2. Kein überlappendes Segment: eine Zeile mit `slide_id = null`.
  3. Mindestens zwei überlappende Segmente **und** `words` vorhanden (nicht `NULL` und nicht leer): Jedes Wort gehört zum Segment, das `floor((start_ms + end_ms) / 2)` enthält. Liegt der Punkt in keinem, gehört es zum nächstgelegenen überlappenden Segment (bei Gleichstand zum früheren). Aufeinanderfolgende Wörter derselben Folie bilden eine Zeile: `text` = Wörter mit Leerzeichen, `start_ms`/`end_ms` = erstes bzw. letztes Wort.
  4. Sonst eine Zeile mit dem ganzen Abschnitt, Folie = Segment, das die Mitte von `G` enthält, ersatzweise das mit der größten Überlappung (bei Gleichstand das frühere).
  5. `part` zählt die Zeilen eines Abschnitts ab 0. `lang` kommt vom Abschnitt.
- **Leistung:** Der Rückblick lädt die Antwort einmal je Session (ohne `slide_id`) und filtert je Folie lokal. Ziel: Antwort für 90 min in < 300 ms, Folienwechsel im Rückblick < 500 ms (F-NAC-02, 09 §1).

### 18.5 `POST /sessions/{id}/reprocess`

| Body | Antwort | Fehler |
|---|---|---|
| `SessionReprocessRequest` `{ from_step?, force? }` (Standard `transcribe`, `false`) | 202 `SessionReprocessResult` (`session` nach der Änderung, `jobs` aus `ensurePipelineJobs`) | `404 session_not_found`, `409 session_not_ended` (`details.state`, Session nicht `beendet`/`verarbeitet`), `409 session_no_audio` (bei `from_step` `audio.finalize` oder `transcribe`: keine nicht gelöschte Aufnahme mit mindestens einem Chunk), `400 validation_failed` |

- Sperrt die Session (`FOR NO KEY UPDATE`) und ruft `ensurePipelineJobs` (§18.2). Wiederholt man den Aufruf, entstehen keine doppelten wartenden Jobs. Zusätzlich gilt `Idempotency-Key` (08 §1).
- `from_step = align.log` braucht kein Audio (Folienzuordnung ohne Transkript).
- Der Zustand der Session ändert sich nicht. Eine `verarbeitet`e Session bleibt `verarbeitet`, nur `processing` zeigt die neuen Schritte (§3).
- Die Web-App schickt bei „Erneut versuchen“ den ersten Schritt in `fehler`/`abgebrochen`, bei „Transkript aktualisieren“ (`stale`) `{ from_step: "transcribe" }`. Steht `audio.finalize` auf `fehler`, bietet sie zusätzlich „Mit vorhandenem Audio fortfahren“ an (`{ from_step: "transcribe" }`). Transkribiert werden dann die Aufnahmen, die schon ein `full.m4a` haben. Gibt es keine Aufnahme mit Chunks, antwortet der Core mit `409 session_no_audio`. `force` setzt sie nur bei einer ausdrücklichen Aktion „Neu transkribieren“.
- Ersetzt für diese Schritte das allgemeine `POST /jobs/{id}/retry` aus 08 §1, das es noch nicht gibt.

### 18.6 Worker ↔ Core

**Datenfluss.** Der Worker spricht nicht per HTTP mit dem Core. Er liest Postgres und den Datenordner und schreibt seine Tabellen direkt (wie `audio.finalize`):

| Was | Quelle |
|---|---|
| Audio | `media/recordings/<recording_id>/full.m4a` (§4), eine Datei je Aufnahme, Zeitbezug `recording.started_ms` |
| Folientitel | `slide.title` der nicht gelöschten Folien des Foliensatzes der Session, nach `index` |
| Fachbegriffe | Titel und `slide.text` aller nicht gelöschten Folien aller nicht gelöschten Foliensätze des Moduls |
| Sprache | `module.lang`: `de` → `de`, `en` → `en`, `mixed` oder leer → automatisch (`None`) |
| Ergebnis | `transcript`, `transcript_segment`, `slide_segment`, `job.result`. Fortschritt über `session.processing` und `pg_notify('sg_session')` (§3) |

**`initial_prompt`** (05 §P4: Folientitel und die 50 häufigsten Fachbegriffe des Moduls):
- **Ziel:** Der Hinweis wirkt in **jedem** 30-s-Fenster, nicht nur im ersten. Mit `condition_on_previous_text=False` übergibt `mlx-whisper` `initial_prompt` nur dem ersten Fenster. Wie T2-02a das erreicht (etwa mit einer eigenen Fensterschleife, die den Hinweis je Fenster mitgibt), entscheidet T2-02a. Das Ergebnis muss die Zeiten weiter auf die ganze Datei beziehen.
  **Umsetzung (T2-02a):** eigene Fensterschleife im Adapter (`ai/transcriber.py`). Die Datei wird einmal nach 16 kHz mono dekodiert, dann je Fenster (≤ 30 s) `mlx_whisper.transcribe` mit dem Hinweis aufgerufen und die Zeiten um den Fensterbeginn verschoben. Ein Abschnitt, der weniger als 1 s vor dem Fensterende endet und mindestens 10 s nach dem Fensterbeginn anfängt, gilt als angeschnitten: Er wird verworfen, das nächste Fenster beginnt an seinem Anfang. Ändert sich das, steigt `PIPELINE_VERSION`. Den Tokenizer stellt der Adapter als optionale Methode `count_tokens(text)` bereit, ohne sie gilt die Schätzung.
- **Grenze: ≤ 200 Tokens** des Whisper-Tokenizers (multilingual) **und ≤ 2 000 Zeichen** (Nachtrag N1 aus dem Review von #142, passend zum CHECK auf `transcript.initial_prompt`). Whisper behält von einem längeren Hinweis nur die letzten ≈ 223 Tokens. Darum steht das Wichtigste **am Ende**. Ohne Tokenizer (Fake, Linux) gilt die Schätzung `ceil(UTF-8-Bytes / 3)` Tokens.
- **Form** Deutsch (und `mixed`): `Vorlesung <Modulname>. Begriffe: <Begriff>, …, <Begriff>. Folien: <Titel>, …, <Titel>.` Englisch: `Lecture <name>. Terms: …. Slides: ….` Leere Teile entfallen samt Überschrift.
- **Titel** in Folienreihenfolge: getrimmt, leere weg, Dubletten (ohne Groß-/Kleinschreibung) weg, der erste gewinnt.
- **Fachbegriffe:** Wörter nach dem Muster `[^\W\d_][\w-]{3,}` (Unicode, also mindestens 4 Zeichen, beginnend mit einem Buchstaben), gezählt ohne Groß-/Kleinschreibung. Angezeigt wird die häufigste Schreibweise. Ausgeschlossen sind eine feste Stoppwortliste (Deutsch und Englisch, im Worker) und Wörter, die schon in einem Titel des Prompts vorkommen. Nur Begriffe, die mindestens zweimal vorkommen, höchstens 50. Sie stehen **aufsteigend nach Häufigkeit** im Prompt (der häufigste zuletzt), bei Gleichstand alphabetisch absteigend.
- **Kürzen**, solange eine der beiden Grenzen überschritten ist: zuerst Begriffe vom Anfang der Liste entfernen (die seltensten), dann Titel vom Anfang, zuletzt den Modulteil.
- Später (Konzepte, Phase 2) ersetzen die Konzeptnamen des Moduls die gezählten Begriffe. Der Prompt landet in `transcript.initial_prompt` und geht in den `input_hash` ein.

**Transcriber-Schnittstelle** (`services/worker/src/sg_worker/ai/interfaces.py`, erweitert 02 §7):

```python
@dataclass(frozen=True)
class Word:
    start: float          # Sekunden ab Dateibeginn
    end: float
    text: str
    prob: float

@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    text: str
    language: str | None = None
    avg_logprob: float | None = None
    no_speech_prob: float | None = None
    words: tuple[Word, ...] = ()

class Transcriber(Protocol):
    provider: str         # "mlx-whisper" | "fake" (TranscriptProvider)
    model: str
    def transcribe(self, audio: Path, *, language: str | None, initial_prompt: str | None,
                   duration_ms: int) -> list[Segment]: ...
```

- Abweichung von 02 §7: `language: str | None` statt `language_hint: list[str]`, dazu `initial_prompt` und `duration_ms` (= `recording.duration_ms`. Der Fake braucht sie, echte Anbieter dürfen sie ignorieren). Die erkannte Sprache steht in `Segment.language`.
- **`mlx-whisper`** (Standard, Spike S5): `mlx_whisper.transcribe(audio, path_or_hf_repo=SG_WHISPER_MODEL, language=…, initial_prompt=…, word_timestamps=True, condition_on_previous_text=False, hallucination_silence_threshold=2.0, no_speech_threshold=0.6, compression_ratio_threshold=2.4)`. Ob in 10-Minuten-Stücken gearbeitet wird (Speicher) und wie der Hinweis jedes Fenster erreicht (oben), entscheidet T2-02a nach der S5-Messung. Die Zeiten müssen danach trotzdem auf die ganze Datei bezogen sein. `mlx-whisper` kommt als Abhängigkeit nur für `sys_platform == 'darwin' and platform_machine == 'arm64'` dazu (Begründung im PR von T2-02a). Beim ersten Lauf lädt es das Modell (≈ 1,6 GB) von Hugging Face. Audio verlässt den Mac nie.
- **Fake** (`SG_TRANSCRIBER=fake`, für CI und Linux): deterministisch, ohne `ffmpeg`, liest die Datei nicht. `provider = "fake"`, `model = "fake-1"`. Für `n = ceil(duration_ms / 10 000)` Abschnitte: Abschnitt `k` (ab 0) von `10·k` s bis `min(10·k + 10, duration_ms / 1000)` s, Text `Testabschnitt <k+1> mit erfundenem Inhalt.`. Die Wörter sind die durch Leerzeichen getrennten Teile, gleichmäßig über den Abschnitt verteilt, `prob = 1.0`. Dazu `avg_logprob = -0.1`, `no_speech_prob = 0.0`, `language` = übergebene Sprache oder `de`. Nach der Nachbearbeitung bleibt jeder Abschnitt einzeln (10 s, endet mit Punkt).
- Unbekannter Wert in `SG_TRANSCRIBER`: Der Worker protokolliert den Fehler beim Start, `transcribe`-Jobs enden mit `fehler` (§18.2).

### 18.7 Sync-Ereignisse

Es gibt **kein neues Ereignis**. Den Fortschritt trägt `session.updated` (§11.6), denn `Session.processing` ist darin enthalten und der Worker meldet jede Änderung über `sg_session`. Das in 08 §2.4 geplante `session.processing` entfällt.
Die Web-App lädt `GET /sessions/{id}/transcript` neu, wenn in `session.updated` `processing.transcribe` oder `processing['align.log']` auf `fertig` wechselt. Nach einem Neuverbinden lädt sie ohnehin per REST neu (§11.6). Das iPad ist nicht betroffen.

### 18.8 Neue Fehlercodes

| Code | HTTP | Bedeutung |
|---|---|---|
| `session_not_ended` | 409 | `reprocess` nur für `beendet`/`verarbeitet` (`details.state`) |
| `session_no_audio` | 409 | `reprocess` ab `audio.finalize`/`transcribe` ohne Aufnahme mit Chunks |

### 18.9 Tickets und Besitz

| Ticket | Inhalt | Besitzt (Dateien) | Abhängig von |
|---|---|---|---|
| **T2-01** | Diese Verträge, Schemas, Migration `0006_transcript` | `packages/schemas/src/**`, `services/core/src/db/schema/transcript.ts`, `services/core/drizzle/0006_*`, dieser Abschnitt | – |
| **T2-02a** (Worker) | `transcribe`, `align.log`, Transcriber (`mlx-whisper`, Fake), Zusammenfassung des Fortschritts nach §18.2 in `progress.py`, Fortschritt beim Abholen | `services/worker/src/sg_worker/handlers/{transcribe,align_log}.py`, `services/worker/src/sg_worker/ai/**`, `services/worker/src/sg_worker/progress.py`, in `services/worker/src/sg_worker/loop.py` nur der Fortschritt beim Abholen, `services/worker/pyproject.toml`, `services/worker/uv.lock`, je eine Zeile in `handlers/__init__.py`, Tests unter `services/worker/tests/` | T2-01 |
| **T2-02b** (Core) | `ensurePipelineJobs` mit derselben Zusammenfassung, Aufruf in `finishSession`, `GET /sessions/{id}/transcript` (mit `stale` und Teilung an Foliengrenzen), `POST /sessions/{id}/reprocess`, Kaskade der Session beim Löschen und Wiederherstellen, Payload-Schemas in `JOB_PAYLOAD_SCHEMAS` | `services/core/src/services/pipeline.ts`, `services/core/src/{routes,services}/transcript.ts`, in `services/core/src/services/sessions.ts` nur `finishSession`, in `services/core/src/services/trash.ts` nur die Kaskade der Session, in `services/core/src/services/jobs.ts` nur `JOB_PAYLOAD_SCHEMAS`, eine Zeile in `app.ts`, Tests unter `services/core/test/` | T2-01. Parallel zu T2-02a. Die Routen lassen sich mit Zeilen testen, die der Test selbst schreibt |
| **T2-03** (Web) | Rückblick (F-NAC-02, 07 §3.4), Schrittliste, „Erneut versuchen“, „Transkript aktualisieren“ | `apps/web/src/app/rueckblick/**`, `apps/web/src/components/rueckblick/**`, `apps/web/src/components/processing/**`, `apps/web/src/lib/transcript.ts`, höchstens je eine Zeile für Link und Schrittliste in `apps/web/src/components/today/**` | T2-01. Gegen die Beispiele in `packages/schemas/examples/valid` bauen, gegen T2-02a und T2-02b mit `SG_TRANSCRIBER=fake` testen. Darf `apps/web/src/components/ink/**` lesend mitbenutzen (Notizseiten rendern), ändert dort nichts |

**Rückblick (T2-03), verbindliche Eckpunkte:**
- Route `/rueckblick?id=<session_id>` (Query statt Segment, §5). Erreichbar aus dem Heute-Bildschirm für Sessions in `beendet`/`verarbeitet` (weitere Einstiege, etwa die Modulseite, später).
- Daten: `GET /sessions/{id}`, `GET /sessions/{id}/transcript` (einmal, im Query-Cache), `GET /sessions/{id}/snapshot` (Marker, Fotos), Folien wie im Dashboard (`GET /slide-decks/{id}`, PDF-Darstellung aus `dashboard/slides`). Für die Notizen gilt: `GET /notebooks?module_id`, dann `GET /notebooks/{id}/pages` je Notizbuch, Seiten mit `session_id` = Session und `attached_slide_id` = aktuelle Folie.
- Wiedergabe: ein `<audio>` je Aufnahme mit `src = /api/v1/recordings/{id}/audio`, Position in der Datei = `t − recording.started_ms`. Zwischen Aufnahmen springt der Player zum Beginn der nächsten. Tipp auf eine Zeile spielt ab `line.start_ms`. Hervorgehoben ist die Zeile mit `start_ms ≤ t < end_ms`. Die aktive Folie ist das Segment, das `t` enthält, und folgt beim Abspielen automatisch (F-NAC-02). Geschwindigkeit 1–2×, ±15 s, Tasten Leertaste, `J`, `L` (07 §10).
- Zustände (in dieser Reihenfolge geprüft):
  - **Verarbeitung offen:** Ein `PipelineStep` steht in `processing` auf `wartet` oder `laeuft`. Dann die Schrittliste und „Transkript kommt noch“. Vorhandene Folien und Zeilen werden trotzdem gezeigt.
  - **Keine Aufnahme:** Keine Aufnahme in `recordings` hat `duration_ms > 0`, oder `transcribe` ist `fertig` und `transcripts` ist leer.
  - **Fehler:** Ein Schritt steht auf `fehler` oder `abgebrochen` → „Erneut versuchen“ (`from_step` = erster solcher Schritt). Bei `audio.finalize` auf `fehler` zusätzlich „Mit vorhandenem Audio fortfahren“ (`from_step: "transcribe"`, §18.5).
  - **Veraltet:** `stale` → Hinweis mit „Transkript aktualisieren“ (`from_step: "transcribe"`).
  - **Ohne Folienzuordnung:** `slide_source = null` → Transkript als eine Liste.

**Nur der Owner kann testen:** `mlx-whisper` auf dem Mac (Laufzeit ≤ 15 min für 90 min, Speicher, Qualität des Vokabular-Hinweises, S5) und den Rückblick mit einer echten Vorlesung.

## 19. Suche: Index, Embeddings, ⌘K (F-SUC-01, 05 §P1/§P18, W-04)

Zweiter Schnitt von Phase 2. Er macht Folien und Gesagtes durchsuchbar, im Wortlaut und nach Bedeutung. Grundlage für Konzepte (§20, folgt), „Frag deine Vorlesung“ (F-SUC-02) und `align.content`.
Datenformate in `packages/schemas/src/search.schema.json`, Tabelle in der Migration `0009_search`.
**Nicht Teil dieses Schnitts:** Konzepte, Karten, Notiz-OCR, Fotos, Aufgaben (es gibt noch kein `sheet.split`), `rag.answer`, Filter `semester:`. Die Gruppen dafür kommen mit den jeweiligen Tickets dazu (neue Werte in `SearchKind`).

### 19.1 Tabelle `search_chunk` (ersetzt 03 §7 `search_chunk`)

Ein Eintrag je durchsuchbarem Stück. Schreiber ist nur der Worker (`search.index`), der Core liest.

| Spalte              | Inhalt                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pflichtfelder 03 §1 | dazu der `updated_at`-Trigger                                                                                                                                                                                                                                                                                                                  |
| `source_kind`       | `slide` \| `transcript` (`SearchKind`)                                                                                                                                                                                                                                                                                                         |
| `source_id`         | `slide`: `slide.id`. `transcript`: `session.id` (Segment-IDs sind nicht stabil, §18.1)                                                                                                                                                                                                                                                         |
| `part`              | `slide`: immer 0. `transcript`: Nummer des Fensters ab 0 (§19.3)                                                                                                                                                                                                                                                                               |
| `deck_id`           | FK `slide_deck`, `ON DELETE CASCADE`. Gesetzt genau bei `slide`                                                                                                                                                                                                                                                                                |
| `session_id`        | FK `session`, `ON DELETE CASCADE`. Gesetzt genau bei `transcript`                                                                                                                                                                                                                                                                              |
| `slide_index`       | bei `slide` der Index der Folie, sonst `NULL`                                                                                                                                                                                                                                                                                                  |
| `t_ms`, `t_end_ms`  | bei `transcript` Beginn und Ende des Fensters (Sitzungszeit, `t_end_ms ≥ t_ms`), sonst `NULL`                                                                                                                                                                                                                                                  |
| `title`             | bei `slide` `slide.title`, sonst `NULL`                                                                                                                                                                                                                                                                                                        |
| `text`              | durchsuchbarer Text, 1–8 000 Zeichen, NFC, ohne Steuerzeichen (§19.3, CHECK)                                                                                                                                                                                                                                                                   |
| `ts_config`         | `german` \| `english` \| `simple`                                                                                                                                                                                                                                                                                                              |
| `tsv`               | `to_tsvector(ts_config::regconfig, text) \|\| to_tsvector('simple', text)`, vom Worker beim Schreiben berechnet (keine generierte Spalte). Der `simple`-Teil sorgt dafür, dass ein halb getipptes Wort mit `:*` trifft (`vorlesu` findet „Vorlesungen“, der Wortstamm allein tut das nicht) und Fachwörter der anderen Sprache gefunden werden |
| `embedding`         | `vector(1024)` oder `NULL` (Embedder nicht verfügbar)                                                                                                                                                                                                                                                                                          |
| `embedding_model`   | Modell des Vektors (`BAAI/bge-m3` \| `fake-embed-1`), `NULL` genau dann, wenn `embedding` `NULL` ist                                                                                                                                                                                                                                           |
| `content_hash`      | SHA-256 (hex) über UTF-8 von `text`                                                                                                                                                                                                                                                                                                            |
| `index_version`     | `SEARCH_INDEX_VERSION` beim Schreiben (§19.3)                                                                                                                                                                                                                                                                                                  |
| `job_id`            | schreibender Job, ohne FK                                                                                                                                                                                                                                                                                                                      |

- `UNIQUE (source_kind, source_id, part)`. CHECKs: Werte von `source_kind` und `ts_config`, genau eine der Spalten `deck_id`/`session_id` passend zu `source_kind`, `slide_index ≥ 1` bei `slide`, Zeiten nur und vollständig bei `transcript`, Länge von `text`, keine Steuerzeichen in `text` (`text !~ '[[:cntrl:]]'`), Form von `content_hash`, `(embedding IS NULL) = (embedding_model IS NULL)`.
- Indizes: GIN auf `tsv`, HNSW auf `embedding` (`vector_cosine_ops`), btree auf `deck_id` und auf `session_id`.
- **Papierkorb (§13):** `slide_deck → search_chunk (deck_id)` und `session → search_chunk (session_id)` kommen in `CHILDREN` (`trash.ts`, dazu `search_chunk` im Typ `Node` und `search_chunk: []`). Weiches Löschen setzt denselben `deleted_at`, die Wiederherstellung holt die Einträge zurück. Endgültiges Löschen nimmt sie über die FKs mit.
- **Ersetzen ist hart** (wie §18.1): `search.index` löscht und überschreibt nur seine eigenen Einträge, ohne Papierkorb.
- `slide.embedding` (03 §4) schreibt `search.index` mit, derselbe Vektor wie der Eintrag der Folie (05 §P1: `embed.slides` geht in `search.index` auf). `transcript_segment.embedding` bleibt `NULL` (kommt mit `align.content`).
- **Bekannte Grenze:** Ändert sich später `module.lang` oder kommt nachträglich ein `vision_summary`, entsteht kein neuer `search.index`. Das holt erst ein neuer `pdf.ingest`, ein neues Transkript oder eine höhere `SEARCH_INDEX_VERSION` nach.

### 19.2 Embeddings im Worker (02 §7)

| Variable         | Standard                             | Bedeutung                                                |
| ---------------- | ------------------------------------ | -------------------------------------------------------- |
| `SG_EMBEDDER`    | `bge-m3`. In CI und auf Linux `fake` | Anbieter                                                 |
| `SG_EMBED_MODEL` | `BAAI/bge-m3`                        | Hugging-Face-Modell für `bge-m3`                         |
| `SG_WORKER_PORT` | `4711`                               | Port des Loopback-Endpunkts (§19.4), liest auch der Core |

- **`bge-m3`:** `sentence-transformers` mit `SG_EMBED_MODEL`, nur dichte Vektoren (1024), `normalize_embeddings=True`, `max_seq_length = 512`, Gerät `mps`, wenn verfügbar, sonst `cpu`. Keine Präfixe vor Anfragen (bge-m3 braucht keine). Abhängigkeit nur für `sys_platform == 'darwin' and platform_machine == 'arm64'`, wie `mlx-whisper` (Begründung im PR). Beim ersten Start lädt das Modell (≈ 2,3 GB) von Hugging Face. Texte verlassen den Mac nie.
- **Laden im Hintergrund:** Der Worker startet sofort. Ein Thread lädt das Modell. Bis dahin ist der Embedder „nicht bereit“. Scheitert das Laden (Import, Download), bleibt er dauerhaft „nicht verfügbar“ mit Grund. Der Worker protokolliert das einmal und läuft weiter.
- **Fake** (`SG_EMBEDDER=fake`): deterministisch, sofort bereit, `model = "fake-embed-1"`, `dim = 1024`. Wörter = Treffer von `[^\W_]+` (Python-`re`, Unicode, gleichbedeutend mit `[\p{L}\p{N}]+`) in `unicodedata.normalize('NFC', text).casefold()`, nur mit ≥ 2 Zeichen. Je Wort `h = sha256(utf8(wort))`, Position `int.from_bytes(h[0:4], 'big') % 1024`, Vorzeichen `+1`, wenn `h[4]` gerade ist, sonst `−1`. Vektor = Summe, danach L2-normiert. Ohne Wörter: Nullvektor, der nie gespeichert und nie gesucht wird. Gleiche Wörter ergeben so ähnliche Vektoren, die Tests können sich darauf verlassen.
- **Schnittstelle** (`ai/interfaces.py`, erweitert): `Embedder` bekommt `provider: str`, `model: str`, `dim: int`, `ready() -> bool`, `error() -> str | None`, `wait_ready(timeout_s: float) -> bool` und `embed(texts: list[str]) -> list[list[float]]`. `embed` ist thread-sicher (Lock), denn Job-Schleife und Loopback-Endpunkt teilen sich ein Modell. **Anfragen des Endpunkts haben Vorrang:** Ein Zähler wartender Endpunkt-Anfragen (mit `threading.Condition`) lässt die Job-Schleife vor jedem Stapel warten, bis keine Anfrage ansteht. Eine Suchanfrage wartet so höchstens auf den gerade laufenden Stapel.
- Unbekannter Wert in `SG_EMBEDDER`: wie ein gescheitertes Laden („nicht verfügbar“).

### 19.3 Job `search.index` (05 §P18)

| Payload                                                   | `priority` | `job.session_id`                                                                                                                              | Ergebnis            |
| --------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `SearchIndexPayload` `{ scope: "deck" \| "session", id }` | 5          | **immer `NULL`**, auch bei `scope = session`. So erscheint der Job nicht in `session.processing` und hält `verarbeitet` nicht auf (§3, §18.2) | `SearchIndexResult` |

**Konstanten im Worker:** `SEARCH_INDEX_VERSION = 1` (steigt, wenn sich Stückelung, Textbildung oder `ts_config` ändern. Der Core kennt denselben Wert, §19.5). `MAX_TEXT = 8000`, `WINDOW_MS = 60000`, `EMBED_BATCH = 16`.

**Stücke bilden:**

- **Text säubern**, in dieser Reihenfolge: Steuerzeichen (Unicode-Kategorie `Cc`) außer Leerraum entfernen (insbesondere `\x01`/`\x02`, die §19.6 für Hervorhebungen nutzt), ebenso Formatzeichen (Kategorie `Cf`, etwa das weiche Trennzeichen U+00AD, U+200B und U+FEFF, die Postgres mit ICU zu `[[:cntrl:]]` zählen kann), danach nach NFC normalisieren (so ist das Ergebnis immer NFC, auch wenn ein entferntes Zeichen Bestandteile trennte), dann Leerraum (`\s+`, auch Zeilenumbrüche) zu einem Leerzeichen zusammenfassen, trimmen, auf `MAX_TEXT` Zeichen kürzen. Leere Stücke entfallen. Ergebnis erfüllt den CHECK aus §19.1.
- **`scope = deck`:** je nicht gelöschte Folie des Foliensatzes ein Stück `slide`: `text` = nicht leere Teile aus `slide.title`, `slide.text`, `slide.vision_summary`, mit `\n` verbunden, dann gesäubert. `ts_config` nach `module.lang` des Moduls des Foliensatzes: `de` → `german`, `en` → `english`, sonst `simple`.
- **`scope = session`:** nicht gelöschte `transcript_segment` der Session, sortiert nach `(start_ms, recording_id, seq)`, zu Fenstern gruppiert: Ein Abschnitt kommt in das laufende Fenster, solange danach `end_ms − Fensterbeginn ≤ WINDOW_MS` gilt, sonst beginnt ein neues. Ein einzelner längerer Abschnitt bildet ein eigenes Fenster. `text` = Abschnittstexte mit Leerzeichen, `t_ms`/`t_end_ms` = erster Beginn/letztes Ende, `ts_config` nach `lang` des ersten Abschnitts (`de`/`en`, sonst `simple`), `part` = Nummer des Fensters.

**Ablauf** (`services/worker/src/sg_worker/handlers/search_index.py`):

1. Payload prüfen. Ziel ohne Sperre lesen. Fehlt die Zeile ganz → `fertig` mit `missing = true` (nichts zu tun, die FKs haben alles entfernt). Ist es weich gelöscht → `fertig` mit `deleted = true`, nichts schreiben (die Einträge liegen mit im Papierkorb). In beiden Fällen sind alle Zähler 0 und `embedding_model`/`embedding_error` `null`.
2. Stücke bilden (oben). Vorhandene Einträge des Ziels lesen (nicht gelöscht).
3. **Wiederverwenden:** Ein Stück mit gleichem `(source_kind, source_id, part)`, gleichem `content_hash`, gleicher `index_version` und einem `embedding_model` gleich dem aktuellen Modell behält seinen Vektor. Die übrigen werden in Stapeln zu `EMBED_BATCH` eingebettet, **außerhalb** einer Transaktion (der Heartbeat läuft weiter). Vorher `wait_ready(600)`.
4. **Ohne Embedder** (nicht verfügbar oder nach 600 s nicht bereit): Die Stücke werden trotzdem geschrieben, mit `embedding = NULL`. Ergebnis `embedding_model = null`, `embedding_error` = Grund. Die Wortsuche funktioniert so immer. §19.5 holt die Vektoren nach, sobald der Embedder bereit ist.
5. **Eine Transaktion:** prüfen, dass der Job noch diesem Worker gehört (wie §18.2, sonst `LockLostError`). **Ziel sperren**, damit Löschen und Wiederherstellen sauber davor oder danach liegen: Session über `progress.lock_session`, Foliensatz mit `SELECT … FROM slide_deck WHERE id = … FOR SHARE`. Fehlt es oder ist es inzwischen gelöscht → wie Schritt 1 (nichts schreiben). Einträge des Ziels, die es nicht mehr gibt, hart löschen. Die übrigen per `INSERT … ON CONFLICT (source_kind, source_id, part) DO UPDATE` schreiben, `tsv = to_tsvector(ts_config::regconfig, text) || to_tsvector('simple', text)` (§19.1), `index_version`, `job_id`, `deleted_at = NULL` bleibt unberührt (gelöschte Ziele erreichen diesen Schritt nicht). Bei `deck`: `slide.embedding` jeder Folie auf den Vektor ihres Stücks setzen, Folien ohne Stück oder ohne Vektor auf `NULL`, jeweils nur `WHERE embedding IS DISTINCT FROM …` (sonst bewegt jede Indizierung `updated_at` aller Folien). `ctx.finish(SearchIndexResult)`.

`SearchIndexResult`: `scope`, `id`, `chunk_count`, `embedded_count` (neu eingebettet), `reused_count`, `removed_count`, `embedding_model` (oder `null`), `embedding_error` (oder `null`), `index_version`, `deleted`, `missing`.

**Fehler:** Payload ungültig → `fehler` sofort. Lock verloren → `LockLostError`. Alles andere → Retry nach §3. Ein fehlender Embedder ist kein Fehler (Schritt 4).

### 19.4 Loopback-Endpunkt des Workers (W-04 Option A)

Der Core braucht für eine Suchanfrage deren Vektor, berechnet mit **demselben** Modell (Entscheidungsvorlage W-04). Der Worker bietet dafür einen kleinen HTTP-Server in einem eigenen Thread an. Die Job-Schleife bleibt bis auf den Vorrang aus §19.2 unverändert.

- **Bindung:** nur `127.0.0.1:SG_WORKER_PORT`, nie eine andere Adresse. Ist der Port belegt, protokolliert der Worker das und läuft ohne Endpunkt weiter (die Suche fällt auf Wortsuche zurück).
- **Reihenfolge beim Start:** erst den Port binden, **danach** das Token erzeugen und schreiben. Scheitert das Binden, wird die Token-Datei nicht angefasst (sonst überschreibt ein zweiter Worker das Token des laufenden, und der Core bekommt dauerhaft `401`).
- **Token:** 32 Zufallsbytes (`secrets.token_hex(32)`) nach `$SG_DATA_DIR/run/worker.token`. Ordner `run/` anlegen bzw. auf 700 setzen, auch wenn er schon existiert. Ist `run/` oder die Datei ein Symlink, abbrechen (Endpunkt aus, protokollieren). Schreiben über `worker.token.part`: alte `.part` entfernen, neu mit `os.open(…, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0o600)`, schreiben, `fsync`, dann `os.replace` auf `worker.token`. Jede Anfrage braucht `Authorization: Bearer <token>`, Vergleich mit `hmac.compare_digest`. Sonst `401`. Der Core liest die Datei bei Bedarf und nach einer `401` erneut (der Worker könnte neu gestartet sein). Das Token steht nie in Logs, `.env`, der DB oder Antworten.
- **`GET /health`** → `WorkerHealth` `{ embedder: { provider, model, dim, state: "bereit" | "laedt" | "nicht_verfuegbar", error } }`.
- **`POST /embed`** mit `EmbedRequest` `{ texts: string[] }` (1–16 Texte, je 1–2 000 Zeichen, sonst `400`) → `EmbedResponse` `{ model, dim, vectors }`. Nicht bereit → `503` mit `{ "code": "embedder_not_ready" }`, nicht verfügbar → `503` mit `{ "code": "embedder_unavailable" }`.
- **Grenzen:** `Content-Length` ist Pflicht (fehlt sie oder kommt `Transfer-Encoding: chunked` → `411`), Body höchstens 256 KB, geprüft **vor** dem Lesen (`413` hat Vorrang vor der Schema-Prüfung). Zeitlimit je Verbindung 5 s, höchstens 4 gleichzeitige Anfragen (weitere → `503` mit `{ "code": "busy" }`). `Host` muss `127.0.0.1:<port>` sein, sonst `400` (Schutz gegen DNS-Rebinding).
- Andere Pfade und Methoden → `404`/`405`. Nur `Content-Type: application/json`, sonst `415`. Keine CORS-Header (Browser haben dort nichts zu suchen).
- **Logs:** `log_message` überschreiben. Protokolliert werden höchstens Methode, Pfad, Status und Dauer, nie Header, Token oder Anfragetexte.
- Stufe A im Review (Token, Bindung, Dateirechte).

### 19.5 Core: Jobs anlegen und nachholen

- **Foliensatz:** Wo der Core `pdf.ingest` für einen Foliensatz anlegt (`services/material.ts`), legt er in derselben Transaktion `search.index { scope: "deck", id }` mit `depends_on = [pdf.ingest]` an. Wartet schon ein `search.index` für diesen Foliensatz, wird er mit `FOR UPDATE` gelesen und wiederverwendet: Zuerst fallen alte Abhängigkeiten weg, die in `fehler` oder `abgebrochen` stehen, gelöscht sind oder nicht mehr existieren (wie §18.2), dann kommt der neue `pdf.ingest` dazu. Übungsblätter bekommen keinen (noch kein Text). `priority = 5`.
- **Session:** `ensurePipelineJobs` (§18.2) legt nach dem Schritt `transcribe` zusätzlich `search.index { scope: "session", id }` an (bzw. verwendet einen wartenden wieder), mit `depends_on` = der `transcribe`-Job, den der Aufruf angelegt oder wiederverwendet hat. Kein Eintrag in `processing` (§19.3). Gleiche Bereinigung alter Abhängigkeiten wie bei `transcribe`. `priority = 5`. Bei `fromStep = align.log` entsteht kein `search.index` (das Transkript ändert sich nicht).
- **Nachholen** (`services/core/src/services/search-backfill.ts`): beim Start des Core und danach alle 10 min. Ziele sind nicht gelöschte Foliensätze mit `ingest_state = 'verarbeitet'` und nicht gelöschte Sessions mit mindestens einem nicht gelöschten `transcript` (Modul jeweils nicht gelöscht). **Maßgeblich ist der neueste** nicht gelöschte `search.index` des Ziels (`payload->>'scope'`, `payload->>'id'`, sortiert nach `created_at`, `id` absteigend). Ein Ziel bekommt einen neuen Job, wenn
  - es keinen gibt, oder
  - der neueste `fertig` ist und `result->>'deleted'` oder `result->>'missing'` `true` ist, `result->>'index_version'` ≠ `SEARCH_INDEX_VERSION` ist, oder der Embedder laut `GET /health` `bereit` ist und `result->>'embedding_model'` (auch `null`) ≠ dessen `model` ist, oder
  - der neueste in `fehler`/`abgebrochen` steht und sein `updated_at` (Zeitpunkt des Scheiterns) älter als 24 h ist (jüngere Fehlschläge werden übersprungen, sonst entstünde alle 10 min ein neuer Job für ein dauerhaft scheiterndes Ziel).

  Steht der neueste in `wartet` oder `laeuft`, passiert nichts. Ist der Worker nicht erreichbar oder sein Embedder nicht `bereit`, entfällt die Modell-Bedingung. Höchstens 50 neue Jobs je Lauf, ältestes Ziel zuerst. **Nachgeholte Jobs haben `priority = -5`**, damit ein großer erster Lauf die Kette nach einer Vorlesung (`audio.finalize` mit 0) nicht aufhält. `SEARCH_INDEX_VERSION = 1` steht als Konstante im Core und im Worker, kein Test prüft die Gleichheit über die Sprachgrenze. Wer den Wert ändert, ändert ihn an beiden Stellen und hier.

- `JOB_PAYLOAD_SCHEMAS` bekommt `search.index`.

### 19.6 `GET /search`

| Query       | Bedeutung                                                             |
| ----------- | --------------------------------------------------------------------- |
| `q`         | Pflicht, 1–200 Zeichen nach `trim`. Enthält Wörter und Filter-Präfixe |
| `module_id` | optional, nur dieses Modul (zusätzlich zu `fach:`)                    |
| `limit`     | optional, 1–50, Standard 20                                           |

Antwort 200 `SearchResponse`, Fehler `400 validation_failed`. Erlaubt für lokal und Netz (wie die übrigen Lese-Routen).

0. **Normalisieren:** `q` nach NFC (sonst zerfallen zerlegte Umlaute in Teilwörter).
1. **Präfixe** (F-SUC-01), getrennt durch Leerraum, Groß-/Kleinschreibung egal (auch in `x`): `fach:<x>` → Modul mit `short_name` gleich `x`, sonst Module, deren `name` mit `x` beginnt (nicht gelöscht). Leeres `fach:` gilt als nicht aufgelöst. `typ:folie` → nur `slide`, `typ:gesagtes` → nur `transcript`. Mehrere `typ:` vereinigen sich. Ein Präfix, das nichts trifft (unbekanntes Fach, unbekannter Typ, `semester:` in diesem Schnitt), steht in `filters.unresolved` und macht die Trefferliste leer. Ist `module_id` unbekannt oder gelöscht, steht `module_id:<id>` in `filters.unresolved`. Ist die Schnittmenge aus `module_id` und `fach:` leer, steht der `fach:`-Filter in `unresolved` (nie `module_ids: []`, das hieße „alle“). Der Rest von `q` ist der Suchtext.
2. **Wörter:** Treffer von `[\p{L}\p{N}]+` im Suchtext, höchstens 8. Keine Wörter → leere Treffer, `mode = "text"`.
3. **Wortsuche:** Je Konfiguration `c` aus `german`, `english`, `simple` die Anfrage `to_tsquery(c, 'w1 & w2 & … & wn:*')`. Den Ausdruck `tq` direkt in die Abfrage schreiben, nicht in eine CTE (sonst schätzt der Planer falsch und liest die ganze Tabelle). `:*` (Präfix) nur am letzten Wort und nur, wenn `q` nicht auf Leerraum endet. Weil die Wörter nur aus Buchstaben und Ziffern bestehen, kann die Syntax von `to_tsquery` nicht verletzt werden. Der String geht trotzdem nur als Parameter in die Abfrage. Die drei werden mit `||` verbunden (`tq`). Kandidaten: die 50 besten nach `ts_rank_cd(tsv, tq)`.
4. **Bedeutungssuche:** nur, wenn mindestens ein Wort ≥ 2 Zeichen hat (sonst wäre der Vektor des Fakes der Nullvektor, und `<=>` liefert `NaN`). Entfällt sie deshalb, gilt `mode = "text"`, `degraded = null`. Vektor des Suchtexts (die Wörter, mit Leerzeichen verbunden) über `POST /embed` (§19.4), Zeitlimit 800 ms. Kandidaten: die 50 nächsten mit `embedding_model` = Modell der Antwort und Cosinus-Ähnlichkeit ≥ `MIN_VECTOR_SIM = 0.45`.
   - **Ohne Filter** (kein `module_id`, kein `fach:`, kein `typ:`): HNSW mit `SET LOCAL hnsw.ef_search = 100`.
   - **Mit Filter:** exakte Suche ohne HNSW (Einträge der Foliensätze/Sessions der Module über die btree-Indizes, dann sortieren). HNSW filtert erst nach dem Suchen und liefert dann zu wenige Treffer (gemessen: 8 statt 50). `hnsw.iterative_scan` gibt es erst ab pgvector 0.8, lokal läuft teils 0.6.
   - **Scheitert der Aufruf**, entfällt dieser Teil (`mode = "text"`): `503` mit `embedder_not_ready` → `degraded = "embedder_not_ready"`. Alles andere (nicht erreichbar, Zeitlimit, `401`, Token-Datei fehlt, `503` mit anderem Code) → `"embedder_unavailable"`.
5. **Mischen:** Reciprocal Rank Fusion, `score = Σ 1 / (60 + rang)` über beide Listen (Rang ab 1), bei Gleichstand nach `chunk_id` aufsteigend. Die besten `limit` Treffer.
6. **Filter in beiden Teilen:** nur nicht gelöschte Einträge, deren Foliensatz bzw. Session und deren Modul nicht gelöscht sind. Das Modul kommt immer über den Join `slide_deck.module_id` bzw. `session.module_id`, nie aus einer Kopie.
7. **Ausschnitt:** `ts_headline(ts_config::regconfig, text, tq, <optionen>)` mit `<optionen>` = `StartSel=<U+0001>, StopSel=<U+0002>, MaxWords=30, MinWords=12, ShortWord=2, MaxFragments=1`. Die Steuerzeichen müssen echte Zeichen sein: Optionen als Parameter übergeben (oder `E'…\x01…'`), ein Literal `'StartSel=\x01'` ohne `E` liefert die vier Zeichen `\x01`. Der Core zerlegt das Ergebnis in `SearchSnippetPart[]` `{ text, hit }` (leere Teile entfallen). Liegt der Ausschnitt nicht am Anfang von `text`, beginnt er mit `… `, liegt er nicht am Ende, endet er mit ` …` (als Teil ohne `hit`). Bei reinen Vektortreffern markiert `ts_headline` trotzdem einzelne Anfragewörter, die im Text vorkommen (die Wortsuche verlangt alle Wörter, der Ausschnitt nicht). Nur wenn kein Anfragewort im Text vorkommt, liefert `ts_headline` den Textanfang, alle Teile ohne `hit`. Halb getippte Wörter (Präfix) hebt `ts_headline` nicht hervor, das ist hingenommen. Die Web-App rendert die Teile als Text, nie als HTML.

`SearchHit`: `kind`, `chunk_id`, `score`, `module` `{ id, name, short_name }`, `snippet`, und je nach Art:

- `slide`: `deck_id`, `deck_title`, `slide_index`, `slide_title`.
- `transcript`: `session_id`, `session_number` (VL-Nummer), `session_title`, `session_started_at`, `t_ms`, `t_end_ms`. Die Web-App zeigt „VL 7 · Titel“ bzw. das Datum, wenn beides fehlt.

`SearchResponse`: `query` (Suchtext ohne Präfixe), `mode` (`hybrid` \| `text`), `degraded` (`null` \| `embedder_not_ready` \| `embedder_unavailable`), `filters` `{ module_ids, kinds, unresolved }`, `hits`, `took_ms`.

**Ziel (F-SUC-01):** erste Ergebnisse in < 300 ms bei 5 000 Folien und 200 h Transkript (≈ 12 000 Fenster). Ein Test mit synthetischen Daten in dieser Größe misst die Abfrage ohne Embedding-Aufruf.

### 19.7 Web: ⌘K (07 §3.12)

- **Öffnen:** `⌘K` bzw. `Strg+K` überall (vorhandenes `matchShortcut` → `'search'` in `apps/web/src/lib/shortcuts.ts`), dazu der Knopf „⌘K Suche“ in der Navigation (07 §2). `Esc` schließt. Overlay mittig, 640 px breit, auf schmalen Bildschirmen volle Breite mit 16 px Rand. Im Live-Dashboard liegt es über der Notizen-Spalte, die Folie bleibt sichtbar (F-DSH-07).
- **Eingabe:** Anfrage 120 ms nach dem letzten Tastendruck, die vorige wird abgebrochen (`AbortController`). Ab 1 Zeichen. Die Web-App fragt mit `limit=50`, damit viele Folientreffer das Gesagte nicht verdrängen. Die letzte Antwort bleibt sichtbar, bis die neue da ist (kein Flackern).
- **Gruppen** in fester Reihenfolge, je höchstens 8 Treffer in Reihenfolge des `score`: „Folien“ (Foliensatz · Folie n · Titel, Ausschnitt), „Gesagtes“ (Session · `mm:ss`, Ausschnitt, ▶). Leere Gruppen entfallen. Treffer-Wörter als `<mark>`.
- **Tastatur:** `↑`/`↓` wählen über alle Gruppen, `Enter` öffnet, `⌘Enter` bzw. `Strg+Enter` öffnet in einem neuen Tab. **Läuft gerade eine Session** (Route des Live-Dashboards `/session`), öffnet auch `Enter` in einem neuen Tab, damit die Aufnahme ungestört bleibt.
- **Ziele:** Folie → `documentHref('folien', deck_id, slide_index)`. Gesagtes → `/rueckblick?id=<session_id>&t=<t_ms>`. Der Rückblick springt bei `t` an diese Stelle und zeigt die Folie dazu, ohne automatisch abzuspielen (Browser verbieten Autoplay). ▶ ist derselbe Sprung.
- **Zustände:** leer (Hinweis auf die Präfixe `fach:` und `typ:folie`/`typ:gesagtes`), keine Treffer („Nichts gefunden“), `filters.unresolved` („Unbekannter Filter: …“), `mode = text` mit `degraded` (ruhige Zeile „Nur Wortsuche · Bedeutungssuche startet noch“ bzw. „… nicht verfügbar“), Fehler der Anfrage (Zeile „Suche gerade nicht erreichbar“). Keine Spinner-Hektik: Ein dezenter Hinweis erscheint erst nach 300 ms ohne Antwort.
- Hell- und Dunkelmodus, Fokus bleibt im Overlay (Fokusfalle), beim Schließen zurück auf das vorher fokussierte Element.

### 19.8 Tickets und Besitz

| Ticket             | Inhalt                                                                                         | Besitzt (Dateien)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Abhängig von                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **T2-10** (Lead)   | Diese Verträge, `search.schema.json`, Beispiele, Migration `0009_search`, Drizzle-Schema       | `packages/schemas/src/search.schema.json`, `packages/schemas/examples/**/Search*`, `packages/schemas/examples/**/Embed*`, `packages/schemas/examples/**/WorkerHealth*`, generierte Dateien, `services/core/src/db/schema/search.ts`, eine Zeile in `services/core/src/db/schema/index.ts`, `services/core/drizzle/0009_*`, dieser Abschnitt                                                                                                                                                                             | –                                                                                                                                   |
| **T2-11** (Worker) | Embedder (`bge-m3`, Fake), Loopback-Endpunkt mit Token, `search.index`                         | `services/worker/src/sg_worker/ai/{interfaces,embedder}.py`, `services/worker/src/sg_worker/server.py`, `services/worker/src/sg_worker/handlers/search_index.py`, je eine Zeile in `handlers/__init__.py`, Start des Embedders und des Servers in `__main__.py` bzw. `loop.py` (nur das), `services/worker/pyproject.toml`, `services/worker/uv.lock`, Tests unter `services/worker/tests/` (Migration `0009` so laden wie `0006` in `conftest.py`)                                                                     | T2-10                                                                                                                               |
| **T2-12** (Core)   | `GET /search`, Worker-Client, Jobs anlegen (Foliensatz, Session), Nachholen, Papierkorb-Kanten | `services/core/src/{routes,services}/search.ts`, `services/core/src/services/search-backfill.ts`, `services/core/src/lib/worker-client.ts`, in `services/material.ts` nur das Anlegen von `search.index`, in `services/pipeline.ts` nur der Schritt `search.index`, in `services/trash.ts` nur die zwei Kanten samt `search_chunk` im Typ `Node` und `search_chunk: []`, in `services/jobs.ts` nur `JOB_PAYLOAD_SCHEMAS`, Start des Nachholens in `main.ts`/`app.ts` (je eine Zeile), Tests unter `services/core/test/` | T2-10. Parallel zu T2-11: Die Tests schreiben `search_chunk`-Zeilen selbst und ersetzen den Worker-Endpunkt durch einen Test-Server |
| **T2-13** (Web)    | ⌘K nach §19.7, Sprung im Rückblick (`t`)                                                       | `apps/web/src/components/search/**`, `apps/web/src/lib/search.ts`, im Layout bzw. in der Navigation nur das Einbinden (wenige Zeilen), in `apps/web/src/components/rueckblick/**` nur der Parameter `t`, `apps/web/test/fake-core.ts` nur `GET /search`                                                                                                                                                                                                                                                                 | T2-10. Gegen die Beispiele in `packages/schemas/examples/valid` und die Fake-Core-Route bauen                                       |

**Später:** `pnpm sg doctor` prüft `GET /health` des Workers (eigenes Ticket).

**Nur der Owner kann testen:** `bge-m3` auf dem Mac (Ladezeit, Speicher, Antwortzeit von `/embed`, Qualität der Bedeutungssuche mit echten Folien und einer echten Vorlesung).

## 20. Konzepte, Inbox und Zusammenfassung (F-NAC-05/-06/-08, F-BIB-02, F-DAT-05, 05 §P7a/§P8/§P9)

Dritter Schnitt von Phase 2: **Transkript und Folien → Konzepte → Abgleich mit dem Wissensnetz → Inbox**, dazu die Kurzfassung je Vorlesung und der Kostenzähler mit Monatsbudget. Erster Schnitt mit Cloud-KI (Claude API).
Datenformate in `packages/schemas/src/concepts.schema.json`, dazu `PipelineStep` (`transcript.schema.json`) und `WorkerHealth.llm` (`search.schema.json`). Tabellen in der Migration `0010_concepts`.
**Nicht Teil dieses Schnitts:** `vault.write` und alles am Vault (Konzeptnotizen, Vorlesungsnotiz, `vault_path`, `content_hash`, `block_hashes` aus W-02), Karten, Klausurhinweis-Detektor (P7b), OCR, `align.content`, Cornell- und ❓-Fragen, `prereq.check`, Konzepte in der Suche (später als `SearchKind = concept`), Konzepte außerhalb der Inbox bearbeiten, zusammenführen oder teilen (F-BIB-03/-04), Graph, der Ablauf der geführten Nacharbeitung (F-NAC-05 nutzt später diese Endpunkte), Hinweis im Tagesbriefing bei 80 %, Modus „nur lokal“ und Modellstufen je Aufgabe in den Einstellungen, Umzug der Moodle-Inbox auf `inbox_item` (08 §9.4).

### 20.1 Tabellen

| Tabelle | Inhalt | Schreiber |
|---|---|---|
| `concept` | 03 §7 mit W-02 Option A: `name` (1–200 Zeichen, ohne Steuerzeichen), `aliases text[]` (≤ 20), `kind` (`ConceptKind` oder `NULL`), `one_liner` (≤ 500), `status` (`vorschlag` \| `aktiv` \| `zusammengefuehrt`), `merged_into` (FK `concept`, `ON DELETE CASCADE`), `proposal_session_id` (FK `session`, `ON DELETE CASCADE`), `exam_relevant`, `importance_base` (Standard 1,0), `embedding vector(1024)` und `embedding_model` | Worker (`concepts.resolve`), Core (Inbox) |
| `concept_module` | `concept_id`, `module_id` (beide FK, `ON DELETE CASCADE`), `UNIQUE (concept_id, module_id)` | Worker, Core |
| `concept_relation` | `from_id`, `to_id` (FK `concept`, Kaskade), `kind` (`ConceptRelationKind`), `source` (`ki` \| `manuell` \| `wikilink`), `confidence` (0..1), `confirmed`, `why` (≤ 500), `proposal_session_id` (FK `session`, Kaskade), `job_id` (ohne FK) | Worker, Core |
| `evidence` | `concept_id` (FK, Kaskade), `session_id` (FK, Kaskade, Herkunft des Belegs), `kind`, `ref_id`, `t_start_ms`, `t_end_ms`, `region jsonb`, `quote` (≤ 300), `weight` (Standard 1), `auto`, `job_id` (ohne FK) | Worker, Core (beim Zusammenführen) |
| `inbox_item` | 03 §8: `kind` (`concept_new` \| `concept_merge` \| `relation`), `session_id` (FK, Kaskade), `job_id` (ohne FK), `payload jsonb` (`InboxPayload`), `status` (`offen` \| `angenommen` \| `abgelehnt` \| `automatisch`), `decided_at`, `decision jsonb` (`InboxDecision`), `priority` (kleiner = früher), `concept_id`, `target_concept_id` (FK `concept`, Kaskade), `relation_id` (FK `concept_relation`, Kaskade) | Worker (anlegen, automatisch annehmen), Core (entscheiden) |
| `session_summary` | Eine je Session (`UNIQUE (session_id)`, FK Kaskade): `lang`, `sentences jsonb` (`SummarySentence[]`, 1–5), `outline jsonb` (`SummaryOutlineItem[]`, ≤ 30), `provider`, `model`, `prompt_version`, `input_hash`, `job_id` (ohne FK) | Worker (`summary.write`) |
| `cost_entry` (Ergänzung) | dazu `session_id` (ohne FK: Kosten bleiben nach dem Löschen gezählt), `cache_creation_input_tokens`, `cache_read_input_tokens`, `cost_estimate_usd`, `request_id` (≤ 200). CHECKs gegen negative Werte | Worker (§20.5) |

- Alle neuen Tabellen haben die Pflichtfelder aus 03 §1 und den `updated_at`-Trigger. Die Migration legt den HNSW-Index `concept_embedding_hnsw` (`vector_cosine_ops`) an.
- **Konzept-CHECKs:** `zusammengefuehrt` genau dann, wenn `merged_into` gesetzt ist (Invariante 5), nie auf sich selbst. `vorschlag` braucht `proposal_session_id`, `aktiv` hat nie eine. `importance_base` in (0, 2]. `(embedding IS NULL) = (embedding_model IS NULL)`.
- **Vorschläge hängen an ihrer Session.** Ein `vorschlag` (und eine Hülle `zusammengefuehrt`, die aus einem Vorschlag entstand) trägt `proposal_session_id`, ebenso eine unbestätigte Beziehung (`confirmed = (proposal_session_id IS NULL)`, CHECK). Wird das Konzept angenommen bzw. die Beziehung bestätigt, wird `proposal_session_id` geleert. So nimmt das Löschen einer Session ihre Vorschläge mit, nie angenommenes Wissen (§20.8).
- **Beziehungen:** keine Schleife (`from_id <> to_id`), die symmetrischen Arten `gegensatz` und `verwandt` stehen immer mit `from_id < to_id`, `UNIQUE (from_id, to_id, kind) WHERE deleted_at IS NULL`. Kreisfreiheit von `baut_auf` (Invariante 4) prüft der Schreiber (§20.6).
- **Belege:** `kind` nach 03 §7 (`slide` \| `transcript` \| `ink` \| `task` \| `photo` \| `past_exam_question`), dieser Schnitt schreibt nur `slide` und `transcript`. `slide`: `ref_id = slide.id`, ohne Zeiten, ohne FK (wie §6, die Folie kann später gelöscht sein). `transcript`: `ref_id = session_id = session.id`, `0 ≤ t_start_ms ≤ t_end_ms` (§18.1, nie eine Segment-ID). Kein Beleg doppelt: `UNIQUE (concept_id, kind, ref_id, coalesce(t_start_ms, -1), coalesce(t_end_ms, -1), coalesce(session_id, 0…0)) WHERE deleted_at IS NULL` (`evidence_dedupe_uq`). `auto = true` heißt: beim Abgleich automatisch an ein vorhandenes Konzept gehängt (§20.3), ein neuer Lauf ersetzt ihn.
- **Inbox-Einträge:** `concept_new` hat `concept_id` (den Vorschlag), `concept_merge` zusätzlich `target_concept_id`, `relation` nur `relation_id` (CHECK). Je Vorschlag und je Beziehung höchstens ein Eintrag (partielle Unique-Indizes). `status = offen` genau dann, wenn `decided_at` leer ist; `decision` nur bei entschiedenen. `payload->>'kind' = kind` (CHECK).
- **Ersetzen ist hart, Löschen weich** (wie §18.1): Jobs ersetzen ihre eigenen früheren Ergebnisse mit `DELETE` (05 §1), nie Entschiedenes. Das weiche Löschen einer Session setzt auf allen ihren Zeilen denselben `deleted_at` (§20.8).
- **Konzepte gehören keinem Fach allein** (03 §7, LP10): `concept_module` ordnet zu, der Abgleich sucht über alle Fächer und Semester.

### 20.2 Kette, Fortschritt und Anlegen (Core)

**Kette** (05 §2, Lead-Entscheidung): `transcribe` + `align.log` → `concepts.extract` → `concepts.resolve` → `summary.write`.

| Job | Payload | `priority` | `depends_on` | Ergebnis |
|---|---|---|---|---|
| `concepts.extract` | `ConceptsExtractPayload` `{ session_id, force? }` | 8 | der `transcribe`- und der `align.log`-Job desselben Aufrufs (angelegt oder wiederverwendet), dazu ein laufender `concepts.extract` der Session | `ConceptsExtractResult` |
| `concepts.resolve` | `ConceptsResolvePayload` `{ session_id, extract_job_id, force? }` | 7 | der `concepts.extract`-Job aus `extract_job_id`, dazu ein laufender `concepts.resolve` der Session | `ConceptsResolveResult` |
| `summary.write` | `SummaryWritePayload` `{ session_id, force? }` | 6 | der `concepts.resolve`-Job desselben Aufrufs, dazu ein laufender `summary.write` der Session | `SummaryWriteResult` |

- `job.session_id` ist gesetzt, `max_attempts` bleibt 3. Die Prioritäten liegen unter Transkription (20) und Ausrichtung (10) und über `search.index` (5), wie 05 §1 („Transkription > Ausrichtung > alles für die Nacharbeitung“).
- **Die drei Jobs halten `verarbeitet` auf** (§3: die Session wird erst `verarbeitet`, wenn kein Job mit ihrer `session_id` mehr wartet oder läuft). Begründung: `verarbeitet` heißt im Heute-Bildschirm „Nacharbeitung bereit“ (F-NAC-01), und die Nacharbeitung braucht Konzepte und Kurzfassung (F-NAC-05 Schritte 2 und 4). Das Ziel „Pipeline ≤ 45 min“ (10 §3) gilt für die ganze Kette. Fehlt der Schlüssel oder ist das Budget erreicht, enden die Jobs sofort mit `fehler` (§20.5) und halten nichts auf.
- **Abhängigkeit gescheitert:** Scheitert `transcribe` oder `align.log`, wird `concepts.extract` nach §3 `abgebrochen`, ebenso alle folgenden. „Erneut versuchen“ ab dem ersten gescheiterten Schritt baut die Kette neu. Ohne Audio bzw. mit `ohne_audio` endet `transcribe` aber `fertig`, und die Konzepte entstehen nur aus den Folien.
- **`ensurePipelineJobs`** (§18.2) bekommt die Schritte 5 bis 7, nach `align.log` und in dieser Reihenfolge. Wiederverwenden wie bei `transcribe`: Wartet schon ein Job des Typs, wird er genommen, `payload.force` wird `alt ODER neu`, `depends_on` werden bereinigt (§18.2: `fehler`, `abgebrochen`, gelöscht oder unbekannt fallen weg) und um die neuen Vorgänger ergänzt. Bei `concepts.resolve` wird zusätzlich `payload.extract_job_id` auf den neuen `concepts.extract`-Job gesetzt. Fortschritt wie Schritt 4 aus §18.2 für jeden berührten Typ.

| `from_step` | angelegt bzw. wiederverwendet |
|---|---|
| `audio.finalize`, `transcribe` | wie §18.2, danach `concepts.extract`, `concepts.resolve`, `summary.write` |
| `align.log` | `align.log`, danach die drei (die Zuordnung ändert die Eingabe der Konzepte) |
| `concepts.extract` | `concepts.extract`, `concepts.resolve`, `summary.write`. `depends_on` von `concepts.extract` sind dann nur ein laufender Job desselben Typs |
| `concepts.resolve` | `concepts.resolve` mit `extract_job_id` = neuester `fertig`e `concepts.extract` der Session, danach `summary.write`. Gibt es keinen, gilt `from_step = concepts.extract` |
| `summary.write` | nur `summary.write` (ohne `depends_on` außer einem laufenden Job desselben Typs) |

- `force` wirkt wie bisher auf `audio.finalize` und `transcribe` (§18.2), bei den neuen Schritten nur auf den Schritt `from_step` selbst. Folgeschritte erkennen geänderte Eingaben über ihren `input_hash` und rufen sonst die KI nicht erneut auf (Kosten).
- **Beim Stopp** bleibt alles wie in §18.2: Die Kette entsteht nur, wenn die Session Audio hat, und dann mit den drei neuen Schritten. **Ohne Audio** gibt es keine automatische Kette (die Session wird sofort `verarbeitet`); Konzepte und Kurzfassung entstehen dann nur über `POST /sessions/{id}/reprocess` mit `from_step: "concepts.extract"` (Rückblick: „Konzepte erzeugen“, §20.10).
- **`POST /sessions/{id}/reprocess`** (§18.5): `409 session_no_audio` nur noch bei `from_step` `audio.finalize` oder `transcribe`. Die neuen Schritte brauchen kein Audio.
- **Fortschritt und Anzeige:** Die Zusammenfassung aus §18.2 gilt unverändert, Einheit ist die Session. Texte der Schrittliste: `concepts.extract` „Konzepte“, `concepts.resolve` „Abgleich“, `summary.write` „Zusammenfassung“. Der Rückblick-Zustand „Verarbeitung offen“ zeigt bei offenen Konzept-Schritten „Konzepte kommen noch“ statt „Transkript kommt noch“, sobald `transcribe` fertig ist (§20.10).
- `JOB_PAYLOAD_SCHEMAS` bekommt die drei Typen. `search.index` bleibt unverändert (Konzepte kommen später in die Suche).
- **Merge-Reihenfolge:** Die Kette im Core (T2-22a) erst nach den Worker-Handlern (T2-21a, T2-21b). Sonst enden alle Konzept-Jobs mit `unbekannter Job-Typ` (§3).

### 20.3 `concepts.extract` und `concepts.resolve` (Worker)

**Gemeinsame Regeln**
- **Normieren** eines Namens oder Alias: NFC, Steuer- und Formatzeichen entfernen (wie §19.3), Leerraum zusammenfassen, trimmen. **Vergleichsform** `key(s)` = Normform in Kleinbuchstaben nach Unicode, ohne Gebietsschema (`str.lower()` bzw. `toLowerCase()`, nicht `casefold()`, damit Worker und Core gleich rechnen). **Basisform** `base(s)` = `key(s)` ohne einen Klammerzusatz am Ende (Muster `\s*\([^()]*\)$`, einmal angewendet; `normalisierung (datenbanken)` → `normalisierung`; bleibt nichts übrig, gilt `key(s)`). **Namensgleich** sind zwei Konzepte, wenn die `key` irgendeines Namens oder Alias des einen gleich der `key` irgendeines Namens oder Alias des anderen ist. **Namensähnlich** sind sie, wenn das für `key` oder `base` gilt (so treffen sich „Normalisierung“ und „Normalisierung (Datenbanken)“, aber zwei Homonyme mit verschiedenem Klammerzusatz sind nicht namensgleich).
- **Gemeinsame Testfälle** für Normieren, Namensgleichheit, Kreisprüfung und die Annahmen A1–A3 liegen in `packages/schemas/fixtures/concepts/` (JSON, Verweise über Kurznamen statt IDs). Worker (T2-21b) und Core (T2-22b) prüfen beide dagegen.
- **Material ist keine Anweisung (Prompt-Injection):** Folien, Transkript und Marker stehen im Prompt nur innerhalb von Tags (`<folie i="14">…</folie>`, `<transkript von="…" bis="…">…</transkript>`, `<marker …/>`); spitze Klammern im Material werden maskiert. Der System-Prompt sagt ausdrücklich, dass Inhalte in diesen Tags Material sind und keine Anweisungen. Die Aufrufe haben keine Tools. Wirkung hat eine Antwort nur über die geprüften Typen (Belege gegen die Datenbank geprüft, Längen und Arten begrenzt, nur Vorschläge). `confidence` ist eine Selbstauskunft des Modells und lässt sich durch präpariertes Material beeinflussen (Folge für `alles_ab_0_9`: §20.7).
- **Session lesen:** Fehlt die Session-Zeile → `fehler` sofort (`NonRetryableError("Session unbekannt")`). Ist sie weich gelöscht → `fertig` mit `session_deleted = true`, nichts aufrufen, nichts schreiben. Schreiben wie §18.2: eine Transaktion, Session zuerst sperren (`progress.lock_session`, inzwischen gelöscht → wie eben), Job-Besitz prüfen (`LockLostError`).
- **KI-Aufrufe** laufen außerhalb einer Transaktion, der Heartbeat läuft weiter. Regeln für Aufrufe, Fehler und Kosten in §20.5.

**`concepts.extract`** (`handlers/concepts_extract.py`, 05 §P7a, Stufe `standard`)

1. Payload prüfen. Session lesen (oben). Modul (`name`, `short_name`, `lang`), Foliensatz der Session, Folien (nicht gelöscht, nach `index`: `title`, `text`, `vision_summary`), `slide_segment` mit der Quellenwahl aus §18.4 (`manuell` vor `ausrichtung` vor `log`), `transcript_segment` (nicht gelöscht, nach `(start_ms, recording_id, seq)`) und die Marker `frage`/`klausur` mit `t_ms`.
2. **Eingabe bauen** (deterministisch, Sitzungszeiten als `[h:mm:ss]`): Kopf mit Modul, Sprache, VL-Nummer, Titel und Datum. Je Folie Titel, Text (≤ 1 500 Zeichen), Vision-Zusammenfassung und die Transkript-Abschnitte, die laut `slide_segment` in ihre Zeit fallen (Mitte des Abschnitts), **gekürzt auf die ersten 600 Wörter je Folie** (05 §P7a, Rest als „…“). Abschnitte ohne Folie (folienlos oder außerhalb aller Segmente) in Blöcken zu 5 min. Marker als Liste mit Zeit. Alles Material in Tags (oben). Die Sprache der Ausgabe ist `module.lang` (`mixed`: die Sprache der Vorlesung, 05 §1).
3. **Weder Folien noch Transkript-Abschnitte:** `fertig` mit `empty = true`, kein Aufruf, `concepts = []`.
4. `input_hash` = SHA-256 über UTF-8 von `prompt_version \n Modell \n EXTRACT_VERSION \n Eingabe` (Modell = das für die Stufe konfigurierte, nicht das der Antwort nach einem Fallback) (`EXTRACT_VERSION = 1`, Konstante im Worker, steigt mit Änderungen an Eingabe oder Prüfung). Hat der neueste `fertig`e `concepts.extract` der Session denselben `input_hash` und ist `force` nicht gesetzt: dessen Ergebnis übernehmen, `unchanged = true`, kein Aufruf.
5. **Kapitel:** Liegt die Eingabe über 150 000 geschätzten Tokens (`ceil(UTF-8-Bytes / 3)`), wird sie an Foliengrenzen in Kapitel zu höchstens 100 000 geschätzten Tokens geteilt. Jeder Aufruf bekommt dieselbe Anweisung und denselben Kopf (Prompt-Caching auf diesem Block, nur bei mehr als einem Kapitel). Die Kapitel werden ohne weiteren KI-Aufruf zusammengeführt: gleiche `key` → ein Konzept (Belege vereinigt, größte `importance`, `exam_hint` ODER, erster `one_liner`).
6. **Aufruf** mit dem Prompt `prompts/concepts.extract/v1.md` und der strukturierten Ausgabe nach 05 §P7a: je Konzept `name`, `aliases`, `one_liner`, `kind`, Folien-Indizes, Zeiträume (Sekunden Sitzungszeit), `importance` 1–3, `exam_hint`, `prof_explanation`, `confidence`; dazu Beziehungen zwischen Konzepten dieser Vorlesung (`from`, `to`, `kind`, `why`, `confidence`). Das Ausgabemodell gehört zum Prompt und liegt im Worker (§20.5).
7. **Prüfen (LP8, 05 §4):**
   - Folien-Belege: Index muss eine nicht gelöschte Folie des Foliensatzes der Session sein → `EvidenceRefSlide` mit `slide_id`, `deck_id`, `slide_index`. Sonst verwerfen.
   - Zeit-Belege: auf `[0, timeline_end_ms]` (§18.3) klemmen, `start < end`, höchstens 20 min lang, und mindestens ein `transcript_segment` der Session muss überlappen. Sonst verwerfen. Überlappende Zeiträume eines Konzepts zusammenfassen. → `EvidenceRefTranscript`.
   - Höchstens 12 Belege je Konzept (Folien zuerst, dann Zeiträume nach Beginn). **Ein Konzept ohne gültigen Beleg wird verworfen** (`dropped_concepts`).
   - Namen und Aliase normieren, leere verwerfen, Aliase ohne Dubletten und ohne den Namen. Konzepte mit gleicher `key` zusammenführen. Höchstens 30 Konzepte (nach `importance`, dann Reihenfolge der Ausgabe).
   - Beziehungen nur zwischen behaltenen Konzepten, symmetrische Arten werden nicht doppelt geführt, Selbstbezug fällt weg (`dropped_relations`). Höchstens 60.
   - Hat die KI Konzepte geliefert und ist **keins** gültig, gilt die Ausgabe als ungültig (einmal nachfordern, §20.5).
8. `ctx.finish(ConceptsExtractResult)`: die geprüften Konzepte mit Schlüsseln `c1`, `c2`, … in Ausgabereihenfolge, Beziehungen über diese Schlüssel. Der Job schreibt keine Tabellen außer `cost_entry` (08 §5: „Zwischenergebnis in `job.result`“).

**`concepts.resolve`** (`handlers/concepts_resolve.py`, 05 §P8, Stufe `standard`)

1. Payload prüfen, Session lesen (oben). `extract_job_id` muss ein `fertig`er `concepts.extract` derselben Session sein, sonst `fehler` sofort (`Konzepte fehlen`). Sein `job.result` mit `ConceptsExtractResult` prüfen.
2. **Unverändert:** Hat der neueste `fertig`e `concepts.resolve` der Session dieselbe `extract_input_hash` und dieselbe `resolve_version` (`RESOLVE_VERSION = 1`) und ist `force` nicht gesetzt: `fertig` mit `unchanged = true`, nichts schreiben. So bleibt die Inbox stabil, wenn nur der Rest der Kette neu läuft.
3. **Vektoren nachholen:** Aktive Konzepte ohne Vektor des aktuellen Embedder-Modells (höchstens 500 je Lauf) einbetten. Text = Name, Aliase (mit `, `) und One-Liner, je eine Zeile, gesäubert wie §19.3, ≤ 2 000 Zeichen. Dasselbe für die extrahierten Konzepte. Vorher `wait_ready(600)` (§19.3).
4. **Ohne Embedder** (nicht verfügbar oder nicht bereit): degradiert, nur Namensgleichheit (unten). Ergebnis `embedding_model = null`, `embedding_error` = Grund.
5. **Zuordnen** je extrahiertem Konzept `x`, Regeln in dieser Reihenfolge:
   - **Schon entschieden in dieser Session:** `x` ist namensgleich mit einem Vorschlag dieser Session, dessen Eintrag `abgelehnt` ist → entfällt (`skipped_rejected`, Abgelehntes kommt für dieselbe Session nicht wieder). `x` ist namensgleich mit einem aktiven Konzept, das aus einem angenommenen bzw. automatisch angenommenen Eintrag dieser Session stammt (Konzept des Eintrags oder Ziel der Zusammenführung) → Belege dorthin (`auto = true`).
   - **Kandidaten:** aktive, nicht gelöschte Konzepte mit Vektor des aktuellen Modells, Ähnlichkeit = `1 − (embedding <=> v)`, die 5 ähnlichsten mit Ähnlichkeit ≥ 0,75. Die Suche ist **exakt** (ohne HNSW, bei einem Nutzer wenige tausend Zeilen): HNSW filtert erst nach der Suche und liefert mit `status = 'aktiv'` zu wenige Treffer (§19.6). Nicht auf `hnsw.iterative_scan` bauen (lokal teils pgvector 0.6). Wird es später zu langsam: partieller HNSW-Index `WHERE status = 'aktiv' AND deleted_at IS NULL`.
   - **Gleiches Konzept, automatisch:** Ein Kandidat mit Ähnlichkeit ≥ 0,88 **und** namensähnlich → die Belege von `x` gehen an ihn (`auto = true`), dazu `concept_module` (Kandidat, Modul der Session), falls sie fehlt. Kein Inbox-Eintrag. Bei mehreren gewinnt der ähnlichste.
   - **KI-Entscheidung** für die übrigen Kandidaten im Band (0,75 bis unter 0,88, dazu ≥ 0,88 ohne Namensähnlichkeit), gebündelt in **einem** Aufruf (unten). Je Kandidat: `gleich` → Ziel eines `concept_merge`. `teil_von` und `verwandt` → Beziehungsvorschlag `verwandt` zwischen `x` und diesem Kandidaten (`why` = Begründung). `verschieden` → keine Beziehung zu diesem Kandidaten. Hat `x` mindestens ein `gleich`, wird es **ein** `concept_merge` auf den ähnlichsten dieser Kandidaten, und die `verwandt`-Beziehungen zu den anderen Kandidaten werden trotzdem vorgeschlagen (Lead-Entscheidung; sie hängen dann an `x` und wandern beim Annehmen mit, A2). Hat `x` kein `gleich`, wird es **ein** `concept_new` mit allen seinen `verwandt`-Beziehungen.
   - Sonst (keine Kandidaten) `concept_new`.
   - **Degradiert:** Ein namensähnliches aktives Konzept → `concept_merge` mit `basis = name` (nie automatisch, Homonyme in verschiedenen Fächern), sonst `concept_new`.
6. **Beziehungen** (05 §P8.3): Je Konzept, das nach Schritt 5 neu oder Ziel eines Vorschlags ist, die 20 ähnlichsten aktiven Konzepte (zusammen höchstens 200) gehen in denselben Aufruf, die KI schlägt typisierte Beziehungen mit Begründung vor. Dazu kommen die Beziehungen aus dem Extrakt (Schlüssel auf die Konzepte nach Schritt 5 abgebildet: automatisch zusammengeführte zeigen auf ihr Ziel). Selbstbezüge und Dubletten fallen weg, auch gegen vorhandene, nicht gelöschte Beziehungen außer den offenen Vorschlägen dieser Session, die Schritt 7 ersetzt. Eine abgelehnte Beziehung bleibt unbestätigt liegen (§20.6) und wird darum von einem neuen Lauf nicht wieder vorgeschlagen, auch nicht mit derselben Art in Gegenrichtung bei symmetrischen Arten. Weiter gilt: symmetrische Arten werden sortiert. `baut_auf`, das mit bestätigten `baut_auf`-Beziehungen einen Kreis bildet, fällt weg (`dropped_cycles`, Invariante 4).
   **Ein KI-Aufruf** (`prompts/concepts.resolve/v1.md`) nur, wenn es Band-Kandidaten oder Nachbarn gibt. Ist das Wissensnetz leer, läuft der Job ohne Aufruf (`prompt_version = null`). Die Fächerbrücke (05 §P8.4) wird beim Lesen berechnet (`ConceptRelationView.cross_module`), nicht gespeichert.
7. **Schreiben** (eine Transaktion). **Sperrreihenfolge im Worker:** Session (`progress.lock_session`) → `pg_advisory_xact_lock(CONCEPT_GRAPH_LOCK_KEY)` → alle Konzepte, die der Lauf ändert oder als Ziel nutzt, nach ID sortiert `FOR NO KEY UPDATE` → schreiben. Unter den Sperren:
   - **Erneut prüfen:** Die Regel „Schon entschieden in dieser Session“ aus Schritt 5 wird nach der Session-Sperre noch einmal angewendet (die Inbox kann sich während der KI-Aufrufe geändert haben). Ein Kandidat oder Ziel, das inzwischen nicht mehr `aktiv` ist, wird wie „kein Kandidat“ behandelt (`concept_new`).
   - **Vektoren** nachgeholter aktiver Konzepte (Schritt 3) nur bedingt schreiben: `UPDATE concept SET embedding = …, embedding_model = … WHERE id = … AND updated_at = <beim Lesen>`. Hat sich das Konzept inzwischen geändert, bleibt der Vektor leer und der nächste Lauf holt ihn nach.
   - **Eigene frühere Ergebnisse dieser Session entfernen (hart):** offene Inbox-Einträge der Session samt ihrer Vorschläge (`concept` mit `status = vorschlag` und `proposal_session_id` = Session, deren Eintrag `offen` ist) und unbestätigten Beziehungen (deren Eintrag `offen` ist), dazu alle Belege mit `auto = true` und `session_id` = Session. Entschiedenes (`angenommen`, `abgelehnt`, `automatisch`) bleibt.
   - Je Vorschlag: `concept` (`status = vorschlag`, `proposal_session_id`, Vektor), `concept_module` (Vorschlag, Modul der Session), Belege (`auto = false`, `session_id`, `job_id`) und der Inbox-Eintrag mit `InboxPayloadConceptNew` (`similar`: bis zu 3 Kandidaten mit Ähnlichkeit und ggf. Entscheidung) bzw. `InboxPayloadConceptMerge`.
   - Je Beziehung: `concept_relation` (`confirmed = false`, `source = ki`, `proposal_session_id`, `job_id`) und ein Eintrag `relation`.
   - **Priorität:** Konzept-Einträge `100 · (3 − importance) + Position im Extrakt` (Position < 100, höchstens 30 Konzepte), Beziehungen `1000 + Position`.
   - Belege an vorhandene Konzepte mit `ON CONFLICT DO NOTHING` (`evidence_dedupe_uq`).
   - **Automatisch annehmen** nach `ai.auto_accept` (§20.7), mit denselben Wirkungen und Prüfungen wie im Core (§20.6, unter dem Advisory-Lock von oben), Status `automatisch`: `nur_beziehungen` → Beziehungen, deren Endpunkte beide `aktiv` sind. `alles_ab_0_9` → zusätzlich `concept_new` mit `confidence ≥ 0,9` (Annahme A1), `concept_merge` mit `basis = ki` und Entscheidungs-Konfidenz ≥ 0,9 (A2) und danach Beziehungen mit `confidence ≥ 0,9`, deren Endpunkte jetzt aktiv sind (A3). Scheitert eine Annahme (Namenskonflikt, Kreis), bleibt der Eintrag `offen`.
   - `ctx.finish(ConceptsResolveResult)`.

**Fehler** (beide Jobs): Payload ungültig, Session fehlt, Extrakt fehlt → `fehler` sofort. Lock verloren → `LockLostError`. KI-Fehler nach §20.5. Ein fehlender Embedder ist kein Fehler (Schritt 4).

**Fake** (`SG_LLM=fake`, §20.5), deterministisch, ohne Netz:
- `concepts.extract`: je Folie mit nicht leerem Titel (nach `index`, gleiche `key` nur einmal) ein Konzept: Name = Titel, `aliases = []`, `one_liner` = `Erfundene Erklärung zu <Titel>.`, `kind = definition`, `importance = 2`, `exam_hint = false`, `prof_explanation = null`, `confidence = 0.95`. Belege: die Folie und, falls es Transkript-Abschnitte in ihrer Zeit gibt, ein Zeitraum vom ersten Beginn bis zum letzten Ende dieser Abschnitte. Ohne Folien, aber mit Transkript: je angefangene 10 min ein Konzept `Thema <k>` mit dem Zeitraum der Abschnitte darin. Beziehungen: `c(k+1) baut_auf c(k)`, `why` = `Folgt in der Vorlesung.`, `confidence = 0.9`.
- `concepts.resolve`: Entscheidung `gleich`, wenn `base` gleich ist, `teil_von`, wenn eine `base` die andere als ganzes Wort enthält, sonst `verschieden`, Konfidenz 0,9, Begründung `Regel des Fakes.`. Keine weiteren Beziehungen.

### 20.4 `summary.write` (Worker, 05 §P9 ohne Vault, F-NAC-08)

`handlers/summary_write.py`, Stufe `standard`, Prompt `prompts/summary.write/v1.md`.

1. Payload prüfen, Session lesen (§20.3).
2. **Eingabe:** wie §20.3 Schritt 2, aber höchstens 300 Wörter Transkript je Folie, dazu die Konzepte der Session (aktive und Vorschläge mit Belegen aus dieser Session, ohne abgelehnte: Name und One-Liner).
3. **Weder Folien noch Transkript:** eine vorhandene Zusammenfassung hart löschen, `fertig` mit `skipped = true`.
4. `input_hash` wie §20.3 (mit `SUMMARY_VERSION = 1`). Gleicher `input_hash` wie die gespeicherte Zusammenfassung und kein `force` → `unchanged = true`.
5. **Aufruf:** bis zu 5 Sätze (05 §P9), jeder mit Belegen (Folien-Indizes, Zeiträume), und eine Gliederung (Kapitel aus den Folien, je Punkt Titel und Folien-Indizes). Belege prüfen wie §20.3 Schritt 7. Ein Satz ohne gültigen Beleg fällt weg (`dropped_sentences`), höchstens 6 Belege je Satz. Bleibt **kein** Satz, gilt die Ausgabe als ungültig (einmal nachfordern, §20.5).
6. Schreiben (Session sperren, Job-Besitz prüfen): `session_summary` per `INSERT … ON CONFLICT (session_id) DO UPDATE` ersetzen, `lang` = `module.lang`. `ctx.finish(SummaryWriteResult)`.

**Direkt sichtbar, kein Inbox-Vorschlag** (Abweichung von 03 §8 und 08 §5, `inbox_item(summary)`): Die Kurzfassung verändert das Wissensnetz nicht (05 §1 „Vorschlag statt Tatsache“ gilt für Konzepte, Beziehungen, Karten). Sie ist mit ✦ als KI-Text erkennbar (R8), jeder Satz trägt Quellen (R6), und ein zusätzlicher Klick zum Annehmen brächte nichts. Bearbeiten kommt mit dem Vault; dann gilt: Eine bearbeitete Zusammenfassung überschreibt `summary.write` nicht.

**Fake:** Sätze `Die Vorlesung behandelt <Name>.` für die ersten 5 Konzepte der Eingabe mit bis zu 2 ihrer Belege; ohne Konzepte `Folie <i> behandelt <Titel>.` für die ersten 5 Folien mit Titel; ohne Folien `Ab <mm:ss> geht es um gesprochene Inhalte.` je 10 min. Gliederung: je Folie mit Titel (höchstens 30) der Titel mit dieser Folie als Beleg.

### 20.5 KI im Worker: Anbieter, Schlüssel, Aufrufe, Kosten, Budget

| Variable | Standard | Bedeutung |
|---|---|---|
| `SG_LLM` | `anthropic`. In CI und Tests `fake` | Anbieter. Unbekannter Wert: nicht eingerichtet (`issue = unbekannter_anbieter`) |
| `ANTHROPIC_API_KEY` | leer | Schlüssel der Claude API. Nur in `$SG_DATA_DIR/config/.env` (Rechte 600), nur der Worker liest ihn |
| `SG_MODEL_FAST`, `SG_MODEL_STANDARD`, `SG_MODEL_DEEP` | `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5` | Modell je Stufe (`ai/tiers.py`, K-01) |
| `SG_USD_EUR` | `0.92` | Umrechnung der Preise (USD) in Euro. Bewusst eher hoch: Das Budget greift lieber zu früh |
| `SG_FAKE_LLM_EUR_PER_CALL` | `0` | nur Tests: Kosten, die der Fake je Aufruf bucht |

**Schlüssel**
- Der Worker liest `.env` beim Start (wie bisher), übernimmt `ANTHROPIC_API_KEY` in seine Konfiguration und **entfernt danach alle Variablen, die mit `ANTHROPIC_` beginnen, aus `os.environ`** (auch `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`), damit Kindprozesse (`ffmpeg`) sie nicht erben und das SDK keine davon liest. Kommt der Schlüssel aus `.env` und ist die Datei für Gruppe oder andere lesbar, nutzt der Worker ihn nicht (`issue = env_offen`, Log-Hinweis auf `chmod 600`). Eine in der Umgebung gesetzte Variable hat wie bei allen Variablen Vorrang (nur für die Entwicklung).
- Der Client bekommt Schlüssel und Adresse ausdrücklich (`Anthropic(api_key=…, base_url="https://api.anthropic.com")`), auch wenn in der Umgebung etwas anderes stand: Der Schlüssel geht nur an diese Adresse. Andere Anmeldewege des SDK (Profile, `ANTHROPIC_AUTH_TOKEN`) werden nicht genutzt. `ANTHROPIC_LOG` wird nicht gesetzt.
- Der Schlüssel steht nie in Logs, `job.error`, `job.result`, der Datenbank, Antworten oder im Repo. Eingerichtet wird er nur in der Datei, nie über die Web-App. Eine Änderung wirkt nach einem Neustart des Workers (`pnpm sg stop`, `pnpm sg start`).
- **Der Core liest den Schlüssel nie:** `loadDotEnv` überspringt Schlüssel, die mit `ANTHROPIC_` beginnen, und der Core entfernt `ANTHROPIC_API_KEY` beim Start aus seiner Umgebung (die CLI-Prozesse, die er startet, erben ihn so nicht).
- **`GET /health` des Workers** (§19.4) bekommt `llm: WorkerLlmStatus` `{ provider, configured, issue }` (optional im Schema, damit ein älterer Worker gültig bleibt). `configured` ist beim Fake immer `true`.

**Aufrufe** (offizielles SDK `anthropic`, neue Abhängigkeit für alle Plattformen, Version legt T2-21a fest, mindestens zwei Wochen alt)

| Aufgabe | Stufe | `output_config.effort` | `max_tokens` | Streaming | Prompt |
|---|---|---|---|---|---|
| `concepts.extract` | `standard` | `medium` | 64 000 | ja | `concepts.extract/v1` |
| `concepts.resolve` | `standard` | `low` | 16 000 | nein | `concepts.resolve/v1` |
| `summary.write` | `standard` | `medium` | 32 000 | ja | `summary.write/v1` |

- **Begründung `resolve` auf `standard`/`low`:** 05 §P8 verlangt `standard`. Die Entscheidung „gleich/Teil von/verwandt/verschieden“ braucht Fachverständnis über Sprachen und Fächer hinweg, ein falsches Zusammenführen kostet den Nutzer mehr als die paar Cent. Der Aufruf ist gebündelt und klein, darum reicht `low`. `fast` (Haiku) hat außerdem keinen serverseitigen Refusal-Fallback.
- **Strukturierte Ausgabe** über `messages.parse(…, output_format=<Pydantic-Modell>)` bzw. bei Streaming `messages.stream(…, output_format=…)` und `get_final_message().parsed_output`. Die Ausgabemodelle gehören zum Prompt und liegen im Worker (`ai/outputs.py`, versioniert mit dem Prompt), nicht in `packages/schemas`: Sie nutzen Folien-Indizes und Sekunden statt IDs, und Constraints aus dem Codegen (Muster, Grenzen) kann die strukturierte Ausgabe nicht alle erzwingen. Gespeichert werden die geprüften Typen aus `packages/schemas` (`ConceptsExtractResult`, `InboxPayload`, `SessionSummary`).
- `output_config` vereint `effort` und das Ausgabeformat (das SDK setzt `format` aus `output_format`, `effort` kommt dazu).
- **Thinking** bleibt Standard (adaptiv, Parameter weglassen). Kein `temperature`, `top_p`, `top_k`.
- **Material und Anweisungen** getrennt wie §20.3 (Tags, System-Prompt, keine Tools).
- **Refusal-Fallback** standardmäßig an (Vorlesungsinhalte wie IT-Sicherheit können Klassifikatoren auslösen): `fallbacks: "default"` mit Beta-Header `server-side-fallback-2026-07-01`, nur für Sonnet und Opus (Haiku hat keinen). Die Aufrufe laufen darum über `client.beta.messages` (`parse` bzw. `stream` mit `betas=[…]`); ob `fallbacks` ein eigener Parameter ist oder über `extra_body` geht, legt T2-21a nach der SDK-Version fest. Das tatsächlich genutzte Modell steht in `response.model` und kommt in `cost_entry.model` und die Ergebnisse.
- **`stop_reason` vor dem Lesen prüfen:** `refusal` (auch nach dem Fallback) → `fehler` sofort, `KI hat die Anfrage abgelehnt (<Kategorie>)`. `max_tokens` → `fehler` sofort, `KI-Ausgabe zu lang`.
- **Ungültige Ausgabe** (Schema verletzt oder nach §20.3/§20.4 ganz unbrauchbar): **einmal** nachfordern: dieselbe Anfrage, dazu `response.content` der ersten Antwort **unverändert** als Assistent-Nachricht (samt Thinking-Blöcken, sonst verwirft das Modell sie) und danach eine Nutzer-Nachricht mit der Fehlermeldung (kein Prefill). Scheitert auch das: `fehler` sofort, `KI-Ausgabe ungültig`.
- **Prompts** liegen versioniert unter `services/worker/prompts/<aufgabe>/v<n>.md` (05 §1). Die Version (`<aufgabe>/v<n>`) steht in Ergebnis, Inbox-Nutzlast und `session_summary`. Eine Änderung am Prompt ist eine neue Version (alte bleiben liegen) und ändert `input_hash`.
- **Prompt-Caching** nur bei mehreren Kapiteln derselben Vorlesung (§20.3 Schritt 5).
- Client: Zeitlimit 600 s je Aufruf, `max_retries = 2` im SDK. Bekannte Untergrenze der Kosten: Wiederholungen und Zeitüberschreitungen innerhalb des SDK, die der Worker nicht als Antwort sieht, bekommen keine `cost_entry`.

| Fehler | Ergebnis (`job.error`) |
|---|---|
| nicht eingerichtet (beim Start jedes der drei Jobs geprüft) | `fehler` sofort, `KI nicht eingerichtet` |
| Monatsbudget erreicht (vor jedem Aufruf geprüft) | `fehler` sofort, `Monatsbudget erreicht` |
| `401` | `fehler` sofort, `KI-Schlüssel ungültig` |
| `403`, `404` | `fehler` sofort, `Kein Zugriff auf das Modell <Modell>` |
| `400`, `413` | `fehler` sofort, `KI-Anfrage ungültig` |
| `429`, `5xx`, `529`, Verbindung, Zeitlimit | Retry nach §3 (30 s, 60 s), danach `fehler`, `KI nicht erreichbar (<Status>)` |
| Refusal, `max_tokens`, ungültige Ausgabe | siehe oben |

Fehlertexte enthalten nie Schlüssel, Header oder Eingabetexte.

**Kosten** (F-DAT-05)
- **Je Aufruf eine `cost_entry`-Zeile**, direkt danach in einer **eigenen** Transaktion, auch wenn der Job danach scheitert: `job_id`, `session_id`, `provider`, `model`, `task` (Job-Typ), die vier Token-Zahlen (Summe über `usage.iterations`, falls vorhanden, sonst aus `usage`), `cost_estimate_usd`, `cost_estimate_eur`, `request_id`.
- **Preise** (USD je Million Tokens, Tabelle im Worker, `ai/pricing.py`):

| Modell | Eingabe | Ausgabe | Cache schreiben (5 min) | Cache lesen |
|---|---|---|---|---|
| `claude-haiku-5-5` (Prompt ≤ 100 000 Tokens) | 0,10 | 0,50 | 0,125 | 0,01 |
| `claude-haiku-5-5` (Prompt > 100 000 Tokens, gilt dann für den ganzen Aufruf) | 0,50 | 2,50 | 0,625 | 0,05 |
| `claude-sonnet-5-5` | 2 | 10 | 2,50 | 0,20 |
| `claude-opus-5-5` | 4 | 20 | 5 | 0,20 |

  Unbekanntes Modell (etwa über `SG_MODEL_*`): Preis von `claude-opus-5-5` und eine Warnung im Log (lieber zu hoch). Liefert die Antwort Einträge je Modell (`usage.iterations`, etwa nach einem Refusal-Fallback), wird je Eintrag mit dem Preis seines Modells gerechnet und summiert; die Haiku-Grenze von 100 000 Tokens gilt je Eintrag. `cost_estimate_eur = round(usd · SG_USD_EUR, 6)`.
- **Fake:** `provider = fake`, `model = fake-llm-1`, Tokens geschätzt (`ceil(UTF-8-Bytes / 3)`), Kosten `SG_FAKE_LLM_EUR_PER_CALL` (Standard 0). So lassen sich Kostenübersicht und Budget in der CI prüfen.

**Monatsbudget**
- **Monat** = Kalendermonat in Ortszeit (`TZ`, wie §8). Summe = `sum(cost_estimate_eur)` der nicht gelöschten `cost_entry` mit `created_at >= date_trunc('month', now() AT TIME ZONE <tz>) AT TIME ZONE <tz>`. Core und Worker nutzen genau diesen Ausdruck, `<tz>` ist der IANA-Name der Ortszeit des Prozesses (als Parameter).
- **Vor jedem Aufruf** (auch vor dem Nachfordern): Summe ≥ `ai.monthly_budget_eur` (gelesen aus `setting` Schlüssel `ai`, fehlend oder ungültig: 10) → `fehler` sofort, `Monatsbudget erreicht`. Ein laufender Aufruf wird nicht abgebrochen, das Budget kann also um einen Aufruf überschritten werden. Der Nutzer erhöht das Budget und stößt die Kette neu an (`reprocess`). `monthly_budget_eur = 0` schaltet die Cloud-KI damit ganz ab.
- Abweichung von F-DAT-05: Bei 100 % enden **alle** KI-Jobs dieses Schnitts mit `fehler` (es gibt noch keine „nicht dringenden“). Der Hinweis bei 80 % steht nur in den Einstellungen (`warn`), das Tagesbriefing kommt mit Phase 4.

### 20.6 Core: Endpunkte und Entscheidungen

| Route | Antwort | Fehler |
|---|---|---|
| `GET /inbox?status&session_id&kind&cursor&limit` | 200 `InboxItemList` | `400 validation_failed` |
| `GET /inbox/overview` | 200 `InboxOverview` | – |
| `POST /inbox/{id}/accept` mit `InboxAcceptRequest` | 200 `InboxDecisionResult` | `404 inbox_item_not_found`, `409 inbox_item_decided`, `400 inbox_action_invalid`, `409 concept_exists`, `409 merge_target_invalid`, `409 relation_endpoint_pending`, `409 relation_cycle` |
| `POST /inbox/{id}/reject` | 200 `InboxDecisionResult` | `404 inbox_item_not_found`, `409 inbox_item_decided` |
| `POST /inbox/{id}/reopen` | 200 `InboxDecisionResult` | `404 inbox_item_not_found`, `409 inbox_item_not_decided`, `409 inbox_reopen_conflict` |
| `POST /inbox/bulk` mit `InboxBulkRequest` | 200 `InboxBulkResult` | `400 validation_failed` (nicht genau eins von `ids` und `session_id`), `404 session_not_found` |
| `GET /concepts?module_id&status&q&cursor&limit` | 200 `ConceptList` | `400 validation_failed` |
| `GET /concepts/{id}` | 200 `ConceptDetail` | `404 concept_not_found` |
| `GET /sessions/{id}/concepts` | 200 `SessionConcepts` | `404 session_not_found` |
| `GET /sessions/{id}/summary` | 200 `SessionSummaryView` (`summary: null`, wenn es keine gibt) | `404 session_not_found` |
| `GET /costs/summary?month` | 200 `CostSummary` | `400 validation_failed` |
| `GET /ai/status` | 200 `AiStatus` | – |

Alle Routen gelten lokal und aus dem Netz (mit Token) wie die übrigen. Gelöschte Sessions, Konzepte und Einträge gibt es nicht (`404`). Listen wie §7 (Standard 50, höchstens 200).

**Lesen**
- **`GET /inbox`:** `status` = `offen` (Standard) \| `entschieden` \| `alle`, `kind` mehrfach. Sortierung `(created_at DESC, priority, id)`: Einträge eines Laufs haben denselben `created_at` und stehen nach `priority`. `session` als `SessionRef`. `blocked` bei `relation`: `endpunkt_offen`, wenn ein Endpunkt noch `vorschlag` mit offenem Eintrag ist, `endpunkt_abgelehnt`, wenn sein Eintrag abgelehnt ist, sonst `null`.
- **`GET /inbox/overview`:** `open_count`, `older_count` (offen und älter als 14 Tage, F-NAC-06) und je Session mit offenen Einträgen `open_count` und `oldest_at`, neueste Session zuerst. Einträge ohne Session bilden eine Gruppe mit `session = null`.
- **`GET /concepts`:** `status` = `aktiv` (Standard) \| `vorschlag` (nur Vorschläge mit offenem Eintrag) \| `alle` (aktive und Vorschläge mit offenem Eintrag, ohne `zusammengefuehrt`), `module_id` über `concept_module`, `q` (1–100 Zeichen) trifft Name oder Alias als Teilwort (`ILIKE`, ohne Groß-/Kleinschreibung). Sortierung `lower(name), id`. `evidence_count` und `session_count` über nicht gelöschte Belege.
- **`GET /concepts/{id}`:** auch für Vorschläge und Hüllen (`zusammengefuehrt` mit `merged_into`, die Web-App leitet weiter). Belege mit `EvidenceView` (`missing`, wenn Folie oder Foliensatz gelöscht ist, `slide_title` aus der Folie), neueste Session zuerst, höchstens 200. Beziehungen nur bestätigte zu nicht gelöschten Konzepten, `cross_module` = die beiden Konzepte haben kein gemeinsames Modul. `inbox_item_id` = offener Eintrag des Konzepts, sonst `null`.
- **`GET /sessions/{id}/concepts`:** Konzepte mit mindestens einem nicht gelöschten Beleg aus der Session (`evidence.session_id`), nur `aktiv` und `vorschlag`, ohne Vorschläge mit abgelehntem Eintrag. Je Konzept nur die Belege dieser Session. Sortierung: kleinster Folien-Index der Belege, dann frühester Zeitpunkt, dann Name.
- **`GET /costs/summary`:** `month` als `YYYY-MM` (Standard: aktueller Monat in Ortszeit). Summen über `cost_entry` im Monat, `by_session` die 20 teuersten mit `SessionRef` (gelöschte Sessions mit `session = null`).
- **`GET /ai/status`:** `GET /health` des Workers (§19.4, Zeitlimit 800 ms). Nicht erreichbar → `worker_reachable = false`, `llm = null`. Fehlt `llm` in der Antwort (älterer Worker), ebenfalls `llm = null`. `budget` aus `cost_entry` und `ai.monthly_budget_eur`, `warn` ab 80 %.

**Annehmen** (Wirkungen und Prüfungen gelten genauso für die Automatik im Worker, §20.3). Jede Annahme nimmt **vor** der Namens- bzw. Kreisprüfung `pg_advisory_xact_lock(CONCEPT_GRAPH_LOCK_KEY = 70070006)` (Core: direkt nach der Sperre des Eintrags; Worker: direkt nach der Session-Sperre, §20.3 Schritt 7). So können zwei gleichzeitige Annahmen weder zwei namensgleiche aktive Konzepte noch einen Kreis erzeugen.
- **A1 `concept_new` annehmen** (ohne `merge_into`): Ist ein anderes aktives Konzept namensgleich (§20.3) mit dem Vorschlag in der Fassung nach `edit`, folgt `409 concept_exists` mit `details.concept_id` (die Web-App bietet „Mit <Name> zusammenführen“ an, die Automatik nimmt A2 mit diesem Ziel). Sonst: `edit` übernehmen (alte Werte in `decision.previous`), `status = aktiv`, `proposal_session_id = NULL`, `importance_base` nach W-05 aus `importance` (1 → 0,8, 2 → 1,0, 3 → 1,3), `exam_relevant` ODER `exam_hint`. Ändern sich Name, Aliase oder One-Liner, werden `embedding` und `embedding_model` geleert (der nächste Abgleich holt den Vektor nach, §20.3 Schritt 3). Danach offene `relation`-Einträge mit diesem Konzept als Endpunkt nach `ai.auto_accept` bestätigen (A3; bei `alles_ab_0_9` nur mit `confidence ≥ 0,9`), sobald beide Endpunkte aktiv sind. Scheitert A3 (Kreis), bleibt der Eintrag offen. Bestätigte Einträge bekommen `status = angenommen` (die Annahme kam vom Nutzer) mit `decision.triggered_by` = dieser Eintrag; ihre IDs stehen in `decision.cascade_item_ids`.
- **A2 Zusammenführen** (`concept_merge` annehmen oder `concept_new` mit `merge_into`): Ziel `T` = `merge_into` oder `target_concept_id`. `T` muss ein anderes, aktives, nicht gelöschtes Konzept sein, sonst `409 merge_target_invalid`. Belege des Vorschlags `P` an `T` hängen (bei Dublette nach `evidence_dedupe_uq` wird der von `P` hart gelöscht), `P.name` und `P.aliases` als Aliase an `T` (ohne namensgleiche, höchstens 20 insgesamt), fehlende `concept_module` an `T`, unbestätigte Beziehungen von `P` auf `T` umhängen, samt `from_concept_id`/`to_concept_id` in der Nutzlast ihrer Einträge, symmetrische Arten danach neu sortiert (`from_id < to_id`). Ergibt das einen Selbstbezug oder eine Dublette einer vorhandenen Beziehung, wird der Eintrag `abgelehnt` (mit `decision.triggered_by` = dieser Eintrag, `duplicate_of` bei Dublette) und die Zeile bleibt unverändert an `P` liegen (nie hart löschen: die FK-Kaskade nähme den Eintrag mit), `T.exam_relevant` ODER `exam_hint`, `T.embedding` leeren, wenn Aliase dazukamen. `P`: `status = zusammengefuehrt`, `merged_into = T` (Invariante 5, `proposal_session_id` bleibt). `decision`: `moved_evidence_ids`, `added_aliases`, `added_module_ids`, umgehängte Beziehungs-Einträge in `cascade_item_ids`.
- **A3 Beziehung bestätigen:** Beide Endpunkte müssen `aktiv` sein, sonst `409 relation_endpoint_pending` (`details.concept_id`). `relation_kind` ändert die Art (alte in `decision.relation_kind_before`, symmetrische sortieren). Gibt es die Beziehung mit der neuen Art (nach dem Sortieren) schon, bleibt diese Zeile unverändert und unbestätigt liegen (wie eine abgelehnte), der Eintrag wird `angenommen` mit `decision.relation_kind_before` und `decision.duplicate_of` = ID der vorhandenen Beziehung. Hart gelöscht wird dabei nichts (die FK-Kaskade nähme den Eintrag mit). `baut_auf` darf keinen Kreis über bestätigte `baut_auf` bilden, sonst `409 relation_cycle` mit `details.path` (Konzept-IDs). Dann `confirmed = true`, `proposal_session_id = NULL`.
- Passt ein Feld nicht zur Art (`relation_kind` bei Konzepten, `edit` bei Beziehungen, `as_new` bei `concept_new`, `as_new` zusammen mit `merge_into`), folgt `400 inbox_action_invalid`. `concept_merge` mit `as_new: true` wird wie A1 angenommen (`edit` erlaubt).
- Eintrag: `status = angenommen`, `decided_at = now()`, `decision`.

**Ablehnen:** Eintrag `abgelehnt` (`decision.action = abgelehnt`). Der Vorschlag bleibt als `vorschlag` liegen (Begründung: Rückgängig ist trivial, ein neuer Lauf schlägt ihn für diese Session nicht wieder vor, §20.3 Schritt 7, und es gibt keinen Sonderfall im Papierkorb; Listen zeigen nur `aktiv`). Offene `relation`-Einträge mit diesem Vorschlag als Endpunkt werden mit abgelehnt (`cascade_item_ids`). Eine abgelehnte Beziehung bleibt unbestätigt liegen.

**Rückgängig (`reopen`, R15):** setzt den Eintrag auf `offen` und macht `decision` rückgängig:
- `abgelehnt` → `offen`, die `cascade_item_ids` ebenso.
- A1: nur, wenn das Konzept keine Belege aus anderen Sessions hat, keine bestätigten Beziehungen außer denen aus `cascade_item_ids`, keine Konzepte, die in es zusammengeführt wurden, und keine Einträge anderer Sessions, die es als `target_concept_id` oder als Endpunkt einer Beziehung führen. Sonst `409 inbox_reopen_conflict`. Dann `status = vorschlag`, `proposal_session_id` = Session des Eintrags, Felder aus `previous`, `cascade_item_ids` zurück auf `offen` (Beziehungen unbestätigt mit `proposal_session_id`).
- A2: Ist eine der umgehängten Beziehungen (`cascade_item_ids`) inzwischen bestätigt, `409 inbox_reopen_conflict`. Sonst die `moved_evidence_ids`, die noch an `T` hängen, zurück an `P`, `added_aliases` (falls noch vorhanden) und `added_module_ids` von `T` entfernen (wurden Aliase entfernt, `T.embedding` leeren), umgehängte Beziehungen zurück an `P` (symmetrische Arten neu sortieren), mit abgelehnte Folge-Einträge wieder `offen`, `P` wieder `vorschlag` ohne `merged_into`.
- A3: `confirmed = false`, `proposal_session_id` = Session des Eintrags, Art aus `relation_kind_before` (symmetrische Arten neu sortieren). Mit `duplicate_of` war nichts bestätigt: nur der Eintrag wird wieder `offen`.
- Ein Eintrag ohne Session (gelöscht) lässt sich nicht wieder öffnen (`404`).

**Massenaktionen (`POST /inbox/bulk`):** `accept` mit `session_id` nimmt alle offenen Einträge der Session an: erst `concept_new` und `concept_merge` nach `priority`, dann `relation`. Jeder Eintrag in einem eigenen Savepoint, Fehler (etwa `concept_exists`, `relation_cycle`, `relation_endpoint_pending`) landen in `skipped` mit Code, der Rest läuft weiter. `reject` und `reopen` entsprechend. Mit `ids` gilt dieselbe Reihenfolge. „Rückgängig“ im Toast schickt `reopen` mit den `decided`-IDs (in umgekehrter Reihenfolge).

**Sperren (Core):** (1) Session-Zeile des Eintrags `FOR SHARE`, damit `concepts.resolve` (sperrt die Session `FOR NO KEY UPDATE`) davor oder danach liegt. `POST /inbox/bulk` sperrt vorab **alle** betroffenen Sessions nach ID sortiert `FOR SHARE`. (2) Eintrag `FOR UPDATE`, Status unter der Sperre prüfen. (3) `pg_advisory_xact_lock(CONCEPT_GRAPH_LOCK_KEY)` für jede Annahme (oben), ebenso für `reopen`. (4) Betroffene Konzepte nach ID sortiert `FOR NO KEY UPDATE` (nie `FOR UPDATE`: FKs aus `evidence` und `inbox_item` nehmen `FOR KEY SHARE`, das soll nicht blockieren). (5) Beziehungen. Der Worker sperrt in derselben Reihenfolge ohne Schritt 2 (§20.3 Schritt 7). `Idempotency-Key` gilt für alle `POST` (08 §1).

### 20.7 Einstellungen KI (F-EIN-01, §14)

- Neuer Bereich `ai` in `setting` (`AiSettings`): `monthly_budget_eur` (0–1 000, Standard 10) und `auto_accept` (`aus` \| `nur_beziehungen` \| `alles_ab_0_9`, Standard `aus`). `GET /settings` liefert ihn aufgefüllt, `PATCH /settings` mit `ai` (`AiSettingsUpdate`) führt Feld für Feld zusammen (§14.1).
- **Schemaänderung mit T2-22a:** `Settings` bekommt `ai: AiSettings` als Pflichtfeld, `SettingsUpdate` bekommt `ai?: AiSettingsUpdate`. Beides kommt im selben PR wie `services/settings.ts`, damit `main` grün bleibt (wie §14.2). Diese Änderung an `packages/schemas` ist für T2-22a vorab freigegeben.
- Der Worker liest den Bereich direkt aus `setting` (Schlüssel `ai`), fehlende oder ungültige Felder mit den Standards.
- **Hinweis bei `alles_ab_0_9`** (Text in den Einstellungen): Die Konfidenz ist eine Selbstauskunft der KI und lässt sich durch das Material beeinflussen (§20.3). Darum ist `aus` der Standard, und auch die Automatik legt nur an, was die Prüfungen aus §20.3 und §20.6 besteht.

### 20.8 Papierkorb (§13)

| Gelöscht | Mitgelöscht (gleiches `deleted_at`) | Bleibt |
|---|---|---|
| `session` | zusätzlich zu §13: `inbox_item` (`session_id`), `evidence` (`session_id`), `concept` (`proposal_session_id`: Vorschläge und Hüllen) mit deren `concept_module`, `concept_relation` (`proposal_session_id`), `session_summary` | aktive Konzepte, auch wenn sie danach keinen Beleg mehr haben, und bestätigte Beziehungen |
| `module` (und damit `semester`) | zusätzlich `concept_module` (`module_id`), über die Sessions alles aus der Zeile oben | die Konzepte selbst |
| `slide_deck` | – | Folien-Belege und Quellen der Zusammenfassung (Anzeige „Folie gelöscht“, `missing`) |

- `CHILDREN` in `trash.ts`: `session → inbox_item, evidence, concept (proposal_session_id), concept_relation (proposal_session_id), session_summary`, `module → concept_module`, `concept → concept_module`. Die neuen Tabellen kommen in den Typ `Node`, `dependent_count` zählt sie nicht (Maschinenausgaben und Vorschläge, wie §13).
- **Begründung „aktive Konzepte bleiben“:** Angenommenes ist bestätigtes Wissen des Nutzers (05 §1: nie bestätigte Nutzerdaten ersetzen), Konzepte gehören keinem Fach allein (LP10) und tragen später Karten und Beziehungen. Ein Konzept ohne Beleg zeigt „Keine Belege mehr“ (§20.10). Konzepte selbst löschen kommt mit dem Vault (F-BIB-05, eigene `TrashKind`).
- Wiederherstellen holt alles mit gleichem `deleted_at` zurück. **Maschinenausgaben weichen statt zu blockieren:** Kollidiert beim Wiederherstellen einer Session eine ihrer unbestätigten Beziehungen (`concept_relation_uq`) oder einer ihrer Belege (`evidence_dedupe_uq`) mit einer inzwischen vorhandenen Zeile, wird die wiederhergestellte Beziehung samt ihrem Inbox-Eintrag bzw. der Beleg in derselben Transaktion **hart gelöscht** statt `409 restore_conflict`. Umsetzung in `trash.ts` (T2-22a): je Tabelle ein Hook neben `UNIQUE_CHECKS`, der diese Zeilen vor der Prüfung entfernt. Andere Konflikte (Inbox-Indizes, `session_summary_session_uq`) bleiben `409 restore_conflict` (§13); sie können praktisch nicht entstehen, weil für eine gelöschte Session nichts Neues geschrieben wird.
- Endgültiges Löschen erledigen die FKs (`ON DELETE CASCADE` auf `session`, `concept`, `concept_relation`, `module`). `cost_entry` bleibt (keine FK auf `session`).

### 20.9 Sync

Kein neues Ereignis. `inbox.count` aus 08 §2.4 entfällt (wie `session.processing` in §18.7). Die Web-App lädt nach:
- bei `session.updated`, wenn `processing['concepts.resolve']` oder `processing['summary.write']` auf `fertig` wechselt: `GET /inbox/overview`, `GET /sessions/{id}/concepts` bzw. `GET /sessions/{id}/summary`,
- nach eigenen Entscheidungen (Antwort der Route),
- nach dem Neuverbinden (§11.6).
Zwei offene Tabs können kurz verschiedene Zähler zeigen. Das iPad ist nicht betroffen.

### 20.10 Web (verbindliche Eckpunkte)

- **Inbox** `/inbox` (07 §3.11, F-NAC-06): oben „Vorschläge“, darunter wie bisher die Moodle-Dateien (`MoodleInbox`). Gruppen je Session aus `GET /inbox/overview` (Kopf „VL 7 · Titel · Modul“), Einträge mit Typ-Symbol, Kurzbeschreibung (`concept_new`: Name und One-Liner; `concept_merge`: „gleich wie *Ziel*?“; `relation`: „A baut auf B auf“), ✦ und Quellen-Chips („F 14“, „42:12“). Aktionen „Annehmen“ / „Verwerfen“, Tasten `→` `←` `E` (bearbeiten: Name, Aliase, One-Liner, Art, inline, kein Dialog), Ziel wählen über eine Konzeptsuche (`GET /concepts?q`). „Alle annehmen“ je Gruppe mit 10-s-Toast „Rückgängig“ (R15). Filter nach Art. Einträge älter als 14 Tage gesammelt („12 ältere Vorschläge“, aufklappbar). `blocked`-Beziehungen ausgegraut mit Hinweis „wartet auf *Konzept*“. `409 concept_exists` → Toast mit „Zusammenführen“, kein Dialog. `concept_merge` bietet neben „Zusammenführen“ und „Verwerfen“ auch „Als neues Konzept“ (`as_new: true`).
- **Navigation:** Zahl offener Einträge (`open_count`) neutral grau, nie rot (07 §2, LP9). Während eine Session läuft (`laeuft`/`pausiert`), lädt die Web-App den Zähler nicht neu und zeigt keine neuen Vorschläge an (R1); danach holt sie ihn nach.
- **Rückblick** (`/rueckblick`, §18.9): Kurzfassung ✦ über dem Transkript (aufklappbar, 5 Sätze mit Quellen-Chips, Gliederung). Folien-Chip wählt die Folie, Zeit-Chip springt wie `t` (§19.7). In der rechten Spalte „Konzepte“ als Chips (Vorschläge mit dezenter Kennzeichnung) mit Sprung zur Konzeptansicht; Konzepte der aktuellen Folie zuerst. Neue Zustände: Konzept-Schritt offen → „Konzepte kommen noch“, KI nicht eingerichtet (`GET /ai/status`, `configured = false`) → statt „nicht fertig“ ruhig „KI nicht eingerichtet · Einstellungen“, Session ohne Konzept-Schritte in `processing` → „Konzepte erzeugen“ (`reprocess` mit `from_step: "concepts.extract"`). Steht `transcribe` auf `fehler`, gibt es neben „Erneut versuchen“ auch „Konzepte nur aus Folien“ (`from_step: "concepts.extract"`). Ist das Budget erreicht (`AiStatus.budget.reached`) und ein Konzept-Schritt gescheitert → ruhig „KI-Budget für <Monat> erreicht · Einstellungen“ statt „nicht fertig“.
- **Konzeptansicht** `/bibliothek?konzept=<id>` (F-BIB-02, 07 §3.6, ohne Notiz-Editor und ohne Beherrschung): Kopf mit Name, Aliasen, Fächern, Klausur-Kennzeichen; Belege als Kacheln (Folie → `documentHref('folien', deck_id, slide_index)`, Zeit → `/rueckblick?id=<session_id>&t=<t_start_ms>` mit ▶); Beziehungen nach Art und Richtung mit Fächerbrücken-Kennzeichen; ohne Belege „Keine Belege mehr“. Hüllen leiten auf `merged_into` weiter, Vorschläge zeigen „Vorschlag · in der Inbox“.
- **Bibliothek** `/bibliothek` ohne Parameter: Konzeptliste je Modul (`GET /concepts?module_id`), dazu eine Gruppe „Ohne Fach“ für aktive Konzepte ohne `concept_module` (etwa nach dem Löschen eines Moduls), Suche im Namen.
- **Einstellungen → KI:** Status „Eingerichtet“ bzw. „Nicht eingerichtet“ mit einem Satz, wie es geht (Schlüssel in `~/StudienGehirn/config/.env` eintragen, `chmod 600`, Worker neu starten). Nie ein Eingabefeld für den Schlüssel. Monatsbudget (Zahl in €), „automatisch annehmen“ (drei Optionen), Kosten des Monats aus `GET /costs/summary` (Summe, Balken gegen Budget ohne Rot, je Aufgabe, teuerste Sessions).
- **KI-Texte nur als reinen Text darstellen** (Namen, One-Liner, Begründungen, Sätze der Kurzfassung, Gliederung): kein Markdown, kein HTML, keine automatisch erkannten Links. Das Material kann präpariert sein (§20.3).
- Texte ruhig und sachlich (07 §7), keine modalen Dialoge, während eine Session läuft keine KI-Ausgabe (R1). Hell- und Dunkelmodus.

### 20.11 Neue Fehlercodes

| Code | HTTP | Bedeutung |
|---|---|---|
| `inbox_item_not_found`, `concept_not_found` | 404 | Objekt fehlt oder ist gelöscht |
| `inbox_item_decided` | 409 | Eintrag ist schon entschieden (`details.status`) |
| `inbox_item_not_decided` | 409 | `reopen` auf einen offenen Eintrag |
| `inbox_reopen_conflict` | 409 | Rückgängig nicht mehr möglich (§20.6) |
| `concept_exists` | 409 | namensgleiches aktives Konzept (`details.concept_id`) |
| `merge_target_invalid` | 409 | Ziel fehlt, ist nicht aktiv oder der Vorschlag selbst |
| `relation_endpoint_pending` | 409 | Endpunkt der Beziehung ist noch kein aktives Konzept (`details.concept_id`) |
| `relation_cycle` | 409 | `baut_auf` würde einen Kreis bilden (`details.path`, F-BIB-03: „Das würde einen Kreis bilden: A → B → A“) |
| `inbox_action_invalid` | 400 | Feld passt nicht zur Art des Eintrags |

### 20.12 Tickets und Besitz

| Ticket | Inhalt | Besitzt (Dateien) | Abhängig von |
|---|---|---|---|
| **T2-20** (Lead) | Diese Verträge, `concepts.schema.json`, `PipelineStep`, `WorkerHealth.llm`, Beispiele, gemeinsame Testfälle, Migration `0010_concepts`, Drizzle-Schema, Texte der Schrittliste | `packages/schemas/src/concepts.schema.json`, die Ergänzungen in `transcript.schema.json` und `search.schema.json`, Beispiele, `packages/schemas/fixtures/concepts/**`, generierte Dateien, `services/core/src/db/schema/{concepts,system}.ts`, eine Zeile in `index.ts`, `services/core/drizzle/0010_*`, in `apps/web/src/lib/transcript.ts` nur `STEP_LABELS`, dieser Abschnitt | – |
| **T2-21a** (Worker) | LLM-Client (`anthropic`, Fake) mit Refusal-Fallback, Prüfung von `stop_reason` und einmaligem Nachfordern, Schlüssel-Handhabung, Preise, `cost_entry`, Budget, `llm` in `GET /health`, `concepts.extract` mit Prompt | `services/worker/src/sg_worker/ai/{interfaces,llm,llm_fake,outputs,pricing,budget}.py`, `services/worker/src/sg_worker/handlers/concepts_extract.py`, `services/worker/prompts/concepts.extract/**`, in `server.py` nur das Feld `llm`, in `config.py`/`__main__.py` nur Schlüssel und `SG_LLM`, `pyproject.toml`, `uv.lock` (Abhängigkeit `anthropic`, Begründung im PR), eine Zeile in `handlers/__init__.py`, Tests (Migration `0010` in `conftest.py` laden) | T2-20 |
| **T2-21b** (Worker) | `concepts.resolve` (Abgleich, Beziehungen, Inbox, Automatik), `summary.write`, Prompts, Fake-Regeln dazu | `services/worker/src/sg_worker/handlers/{concepts_resolve,summary_write}.py`, `services/worker/src/sg_worker/concepts/**` (Normieren, Annahme A1–A3, Kreisprüfung), `services/worker/prompts/{concepts.resolve,summary.write}/**`, je eine Zeile in `handlers/__init__.py`, in `ai/outputs.py` und `ai/llm_fake.py` nur die eigenen Teile, Tests | T2-21a (LLM-Client) |
| **T2-22a** (Core) | Kette und `reprocess` (§20.2), `GET /sessions/{id}/summary`, `GET /costs/summary`, `GET /ai/status`, Einstellungen `ai` samt Schema, Schlüssel-Schutz im Core, Papierkorb-Kanten, `JOB_PAYLOAD_SCHEMAS` | `services/core/src/services/pipeline.ts`, in `services/transcript.ts` nur `reprocessSession`, `services/core/src/{routes,services}/{summary,costs,ai-status}.ts`, `services/core/src/services/settings.ts` und `Settings`/`SettingsUpdate` (§20.7), in `config.ts`/`main.ts` nur `ANTHROPIC_*`, in `services/trash.ts` nur die Kanten aus §20.8 samt Typ `Node` und den Hook für Konflikte beim Wiederherstellen (unbestätigte Beziehungen und Belege der Session hart löschen statt `409`, §20.8), in `services/jobs.ts` nur `JOB_PAYLOAD_SCHEMAS`, in `lib/worker-client.ts` nur `llm`, Zeilen in `app.ts`, Tests unter `services/core/test/` | T2-20. **Merge erst nach T2-21b** (§20.2) |
| **T2-22b** (Core) | Inbox (Lesen, A1–A3, Ablehnen, Rückgängig, Massenaktionen, Sperren), `GET /concepts`, `GET /concepts/{id}`, `GET /sessions/{id}/concepts` | `services/core/src/{routes,services}/{inbox,concepts}.ts`, `services/core/src/services/concept-graph.ts` (Normieren, Kreisprüfung, A1–A3; gleiche Regeln wie T2-21b), in `lib/locks.ts` nur `CONCEPT_GRAPH_LOCK_KEY`, Zeilen in `app.ts`, Tests (schreiben Vorschläge selbst in die Tabellen) | T2-20. Parallel zu T2-21b und T2-22a |
| **T2-23** (Web) | Inbox, Zähler in der Navigation, Rückblick (Kurzfassung, Konzepte, neue Zustände), Konzeptansicht und -liste, Einstellungen → KI | `apps/web/src/app/inbox/**`, `apps/web/src/app/bibliothek/**`, `apps/web/src/components/{inbox,concepts}/**`, `apps/web/src/components/settings/Ai*.tsx` mit einem Reiter in `SettingsView.tsx`, `apps/web/src/lib/{inbox,concepts,costs}.ts`, in `components/rueckblick/**` und `components/processing/**` nur Kurzfassung, Konzepte und Zustände aus §20.10, in `lib/nav.ts`/`Sidebar.tsx` nur der Zähler, in `apps/web/test/fake-core.ts` nur die Routen aus §20.6 | T2-20. Gegen die Beispiele in `packages/schemas/examples/valid` und die Fake-Core-Routen bauen, danach gegen T2-21/T2-22 mit `SG_LLM=fake`. **Der Einstellungen-Teil (KI) erst nach T2-22a mergen** (`Settings.ai`) |

**Gemeinsame Regeln von Worker und Core:** Namensgleichheit (§20.3), Annahme A1–A3 und Kreisprüfung stehen in beiden Sprachen (Worker für die Automatik, Core für die Inbox). T2-21b und T2-22b laden beide die Testfälle aus `packages/schemas/fixtures/concepts/` (`normalize.json`, `name-match.json`, `cycle.json`, `decisions.json`, Aufbau im `README`-Feld jeder Datei) und prüfen ihre Umsetzung dagegen. Ändert sich eine Regel, ändern sich die Testfälle, beide Umsetzungen und dieser Abschnitt.

**Nur der Owner kann testen:** echte API-Aufrufe (Kosten, Schlüssel in `.env`, Refusal-Fallback mit einer IT-Sicherheits-Vorlesung), die Qualität der Konzepte und der Kurzfassung (goldener Datensatz 05 §4: Konzept-Trefferquote ≥ 80 %, später), die Laufzeit der ganzen Kette (≤ 45 min) und die Annahmequote in der Inbox (05 §4).

### 20.13 Abweichungen von der Spezifikation (Überblick)

- **08 §5 `summary.write`:** schreibt `session_summary` statt `inbox_item(summary)` und Vault-Notiz (§20.4).
- **03 §8:** in diesem Schnitt nur die Inbox-Arten `concept_new`, `concept_merge`, `relation` (CHECK und Schema). Neue Spalten `decision`, `concept_id`, `target_concept_id`, `relation_id`.
- **03 §7:** zusätzlich `concept.proposal_session_id`, `embedding_model`, `concept_relation.why`, `proposal_session_id`, `job_id`, `evidence.session_id`, `auto`, `job_id`. Ohne `vault_path`, `content_hash`, `block_hashes` (kommen mit dem Vault).
- **03 §13 `cost_entry`:** zusätzlich `session_id`, Cache-Tokens, `cost_estimate_usd`, `request_id`.
- **Invariante 4:** Kreise aus KI-Vorschlägen werden verworfen (`dropped_cycles`), beim Annehmen folgt `409 relation_cycle`. Ein Inbox-Konflikt entsteht erst mit Wikilinks (F-BIB-05).
- **05 §P8:** `teil_von` und `verwandt` → neues Konzept plus Beziehung `verwandt` (es gibt keinen Beziehungstyp „Teil von“). Ohne Embedder führt Namensähnlichkeit zu einem Vorschlag statt zu einer automatischen Zusammenführung.
- **05 §P7a:** Kapitel erst ab 150 000 geschätzten Tokens, Zusammenführung der Kapitel ohne KI-Aufruf.
- **05 §2:** `concepts.extract` hängt von `transcribe` **und** `align.log` ab. Scheitert eins davon, wird die Konzept-Kette abgebrochen (§3).
- **F-DAT-05:** Bei 100 % enden alle KI-Jobs mit `fehler`, kein Hinweis im Tagesbriefing (§20.5).
- **08 §1, §2.4:** Endpunkte wie §20.6 (dazu `reopen`, `GET /inbox/overview`, `GET /sessions/{id}/concepts|summary`, `GET /costs/summary`, `GET /ai/status`), ohne `POST /concepts`, `PATCH /concepts/{id}`, `merge`, `split`, `/concept-relations`, `/graph`. Kein Ereignis `inbox.count`.
- **08 §5:** `concepts.resolve` und `summary.write` mit optionalem `force`.
- **02 §7 / K-01:** Modelle nur über `SG_MODEL_*`, die Einstellung „Modellstufen je Aufgabe“ kommt später. Die genaue Form der `LLM`-Schnittstelle legt T2-21a fest (strukturierte Ausgabe über das SDK).
- **Abgelehnte Vorschläge** bleiben als `vorschlag` liegen statt weich gelöscht zu werden (§20.6).
- **§13 Wiederherstellen:** Kollidierende unbestätigte Beziehungen und Belege einer Session werden beim Wiederherstellen hart gelöscht statt `409 restore_conflict` (§20.8).
- **Dubletten beim Annehmen** (A2, A3) werden nie hart gelöscht: Die Zeile bleibt unbestätigt liegen, der Eintrag hält `decision.duplicate_of` fest (§20.6).
