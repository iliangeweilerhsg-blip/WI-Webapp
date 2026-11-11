# Infrastruktur und `sg`-CLI

Dieser Ordner enthält die Datenbank (Docker Compose) und die Kommandozeile `sg`, mit der das Studien-Gehirn auf dem Mac gestartet wird.
Grundlage: Spezifikation 02 §3, `docs/VERTRAEGE.md`.

## Einrichtung auf dem Mac

1. **Docker**: [OrbStack](https://orbstack.dev) oder Docker Desktop installieren und einmal starten.
2. **Node 22.18 oder neuer** (22.x), z. B. `nvm install 22` (die Version steht in `.nvmrc`).
3. **pnpm**: `corepack enable` (die Version steht in der Root-`package.json`).
4. **uv** und **ffmpeg** (für den Python-Worker bzw. das Audio): `brew install uv ffmpeg`.
5. Im Repo: `pnpm install`.
6. Prüfen: `pnpm sg doctor`.
7. Starten: `pnpm sg start`.

## Befehle

| Befehl | Wirkung |
|---|---|
| `pnpm sg doctor` | Prüft Node, pnpm, uv, ffmpeg, Docker, die Ports 4710 und 5432, den Datenordner und gibt bei Fehlern einen Lösungshinweis. Exit-Code 1, wenn etwas fehlt. Unter 10 GB freiem Speicher im Datenordner kommt nur ein Hinweis (ℹ) |
| `pnpm sg start` | Legt den Datenordner an, startet Postgres, baut bei Bedarf die Web-App, führt die Migrationen aus, startet Core und Worker (Logs mit `[core]` / `[worker]`), wartet auf `/api/v1/health` und öffnet den Browser (macOS). Strg+C beendet Core und Worker sauber. Der Core startet direkt mit `node src/main.ts` im Ordner `services/core` (nicht über `pnpm start`), darum gibt es keine `[core]`-Fehlerzeilen von pnpm. Das äußere `pnpm sg start` kann beim Strg+C selbst noch ` ELIFECYCLE  Command failed.` ausgeben (pnpm meldet das bei jedem per Signal beendeten Skript); `node infra/sg/sg.mjs start` bleibt still. Exit-Code von sg: 0, beim zweiten Strg+C (SIGKILL) 130 |
| `pnpm sg stop` | Beendet Core und Worker (über die PID-Dateien in `$SG_DATA_DIR/run/`) und hält Postgres an (`docker compose stop`). Die Daten bleiben erhalten |
| `pnpm sg migrate` | `pnpm --filter @sg/core migrate` |
| `pnpm sg backup` / `restore` | Platzhalter, kommen mit T1-18 (Exit-Code 2) |

**Nach `git pull`:** `pnpm sg start` hält alles selbst aktuell.

- **Pakete:** Jeder `sg`-Befehl außer `stop` und der Hilfe vergleicht vor dem Laden seiner eigenen Module `pnpm-lock.yaml` mit der installierten Kopie (`node_modules/.pnpm/lock.yaml`). Bei Abweichung führt er zuerst `pnpm install --frozen-lockfile` aus (`infra/sg/deps.mjs`). Schreibt pnpm die Kopie dabei nicht neu, etwa bei einem anders formatierten Lockfile, merkt sich `sg` das erfolgreiche Install in `node_modules/.sg-deps`. Scheitert das Install, brechen `start` und `migrate` ab. Andere Befehle wie `doctor` laufen mit einer Warnung weiter. `stop` installiert nie, damit es auch offline und bei laufender App funktioniert.
- **Web-App:** `sg start` baut den Static Export neu, wenn er fehlt oder wenn sich die Quellen seit dem letzten Build durch `sg start` geändert haben. Quellen sind `apps/web`, `packages`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` und `tsconfig.base.json`. Verglichen werden die Git-Baum-Hashes des letzten Commits, gemerkt in `apps/web/.sg-build-stamp` (gitignored).
- Nicht committete Änderungen lösen keinen Build aus, und nach einem Build aus geändertem Stand wird kein Stempel geschrieben. Das gilt auch für ungetrackte, nicht ignorierte Dateien unter den Quellen: Mit ihnen baut `sg start` bei jedem Start neu. Für die Entwicklung gibt es `pnpm --filter @sg/web dev`.
- `NEXT_PUBLIC_*`-Variablen aus der Shell fließen nicht in den Vergleich ein.
- Ein per `SG_WEB_DIR` umgelenkter Export wird nur gebaut, wenn er fehlt.

Existieren Core, Worker oder Web-App noch nicht, meldet `sg` das klar. Bei fehlendem Core bricht `start` nach dem Datenbank-Start ab, ein fehlender Worker wird nur gemeldet.

## Umgebungsvariablen

Genau wie in `docs/VERTRAEGE.md` §1:

| Variable | Standard |
|---|---|
| `SG_DATA_DIR` | `~/StudienGehirn` |
| `DATABASE_URL` | `postgres://sg:sg@127.0.0.1:5432/sg` |
| `SG_CORE_PORT` | `4710` |
| `SG_WEB_DIR` | `<repo>/apps/web/out` |

`sg start` reicht `SG_DATA_DIR`, `DATABASE_URL`, `SG_CORE_PORT` und `SG_WEB_DIR` an Core und Worker weiter. Alle anderen Variablen der Shell (z. B. `SG_LOG_LEVEL`) bleiben erhalten. Geheimnisse gehören in `$SG_DATA_DIR/config/.env` (Rechte 600), nicht in die Shell.

## Datenbank

`infra/docker-compose.yml` startet `pgvector/pgvector:pg16` als Container `studiengehirn-db`.

- Nur erreichbar über `127.0.0.1:5432`, nicht aus dem Netz.
- Benutzer, Passwort und Datenbank heißen `sg`. **Das sind Entwicklungs-Defaults** und bewusst einfach, weil der Port nur lokal offen ist. Wer die Werte ändert, muss auch `DATABASE_URL` anpassen.
- Die Daten liegen im benannten Volume `sg_pgdata`. `pnpm sg stop` löscht sie nicht. Komplett zurücksetzen (zerstört alle Daten): `docker compose -f infra/docker-compose.yml down -v`.

## Datenordner

`sg start` legt die Struktur aus Spezifikation 08 §7 an (`config/` mit Rechten 700, `media/`, `vault/`, `backups/`, `logs/`) sowie `run/` für die PID-Dateien.

## `sg` entwickeln

Die CLI ist TypeScript und läuft ohne Build über Node-Type-Stripping (Node ≥ 22.18). Tests: `pnpm --filter @sg/cli test`. Die Tests prüfen nur reine Logik mit gemockten Systemaufrufen und rufen weder Docker noch Core auf.
