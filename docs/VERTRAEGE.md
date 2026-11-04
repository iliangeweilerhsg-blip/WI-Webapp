# Laufzeit-Verträge zwischen den Bausteinen (Phase 0)

Diese Datei legt fest, wie Core, Worker, Web-App und `sg`-CLI zusammenspielen. So können die Teile parallel gebaut werden (`AGENTS.md`, Regel 4).
Änderungen nur durch den Lead. Datenformate selbst stehen in `packages/schemas`.

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
- **Hängende Jobs:** `laeuft` mit `locked_at` älter als 30 min gilt als abgestürzt und wird beim Worker-Start wieder auf `wartet` gesetzt.

**Unbekannter Job-Typ:** Der Worker setzt `state='fehler'` mit `error='unbekannter Job-Typ'` und läuft weiter.

**Abhängigkeit fehlgeschlagen:** Ist ein Job aus `depends_on` im Zustand `fehler` oder `abgebrochen`, setzt der Worker den abhängigen Job auf `abgebrochen`. Als `error` steht dann `Abhängigkeit <job_id> fehlgeschlagen`. Sonst würde der Job ewig warten.

### Spalten mit Zahlen

`numeric`-Spalten wie `module.ects` werden in Drizzle mit `{ mode: 'number' }` gelesen. Die API liefert JSON-Zahlen, keine Strings.

## 4. Dateiablage (08 §7)

Pfade relativ zu `SG_DATA_DIR`:

| Inhalt | Pfad |
|---|---|
| Foliensatz | `media/decks/<deck_id>/original.pdf`, `slides/<index>.png` (2×), `thumbs/<index>.webp` |
| Übungsblatt | `media/sheets/<sheet_id>/original.pdf`, `pages/<index>.png`, `thumbs/<index>.webp` |
| Logs | `logs/core.log`, `logs/worker.log` |

In der DB steht `file_path` relativ zu `SG_DATA_DIR`. So lässt sich der Datenordner verschieben.

## 5. HTTP-Konventionen des Core

- Basis `/api/v1`, Fehlerformat `ApiError`, Listen mit `?cursor&limit` (08 §1).
- **Lokal oder Netz** entscheidet allein die Socket-Adresse (`request.socket.remoteAddress` ist `127.0.0.1` oder `::1`). `trustProxy` bleibt aus. `Host` und `X-Forwarded-For` werden dafür **nie** ausgewertet.
- Lokale Anfragen brauchen kein Token. Anfragen aus dem Netz brauchen `Authorization: Bearer <device_token>`. In Phase 0 werden sie mit `401 device_token_required` abgelehnt, weil es noch keine Kopplung gibt (T1-10).
- **Schutz gegen DNS-Rebinding:** Anfragen, deren `Host` nicht `localhost`, `127.0.0.1`, `[::1]` oder `<rechnername>.local` (jeweils mit `SG_CORE_PORT`) ist, beantwortet der Core mit `421 host_not_allowed`.
- **Schutz gegen CSRF:** Zustandsändernde Anfragen (`POST`, `PUT`, `PATCH`, `DELETE`) mit `Origin`-Header werden mit `403 origin_not_allowed` abgelehnt. Ausgenommen sind die eigene Herkunft (`http://<erlaubter Host>:<SG_CORE_PORT>`) und `SG_DEV_WEB_ORIGIN`. Ohne `Origin`-Header (z. B. `curl`, iPad-App) gilt nur die Token-Regel.
- Statische Web-App unter `/`. Unbekannte Pfade außerhalb von `/api` liefern `index.html` bzw. die passende `.html`-Datei aus dem Export.
- Die Web-App nutzt Routen mit Query-Parametern statt dynamischer Segmente (`/modul?id=<uuid>`), weil der Static Export die IDs beim Build nicht kennt.
