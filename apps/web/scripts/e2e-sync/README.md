# E2E des Web-Sync-Clients gegen den echten Core (Issue #64)

`run.cjs` testet den echten `SyncClient` (IndexedDB, Web Locks, WebSocket) in Chromium gegen einen echten Core mit
Postgres 16. Das Skript ist **nicht** Teil der CI.

## Was läuft

1. Wegwerf-Datenbank `sg_e2e_*` auf dem Postgres-Server anlegen und migrieren.
2. `pnpm --filter @sg/web build` (Static Export nach `apps/web/out`), mit `--skip-build` übersprungen.
3. Den Export in ein Temp-Verzeichnis kopieren, dazu `harness.html` und `harness.js` (der gebündelte Client, siehe
   `harness.ts`). Der Core liefert dieses Verzeichnis aus (`SG_WEB_DIR`). Die Harness-Seite ist ohne `SyncProvider`,
   damit sie das Leader-Lock nicht mit der App teilt.
4. Core als eigener Prozess starten (`node src/main.ts`, Port 4731, ohne Bonjour), Semester und Modul per REST anlegen.
5. Szenarien mit Playwright (Chromium). Die Operationen laufen über den `SyncClient` im Browser. Geprüft wird gegen die
   WebSocket-Rahmen (Playwright) und den Serverstand (REST).
6. Aufräumen: Core über die eigene PID beenden (SIGTERM), Datenbank und Temp-Verzeichnis löschen.

| Szenario | Prüft |
| --- | --- |
| `app` | Die gebaute App (Static Export, `SyncProvider`) verbindet sich und bekommt `welcome`. |
| `acks` | 120 parallele `stroke.add`: `ack`s in Sendereihenfolge, `seq` lückenlos, Serverstand, Warteschlange leer. |
| `resumeAndReset` | Verbindungsabbruch (clientseitig, `close(4000)`) bei laufendem Schreiber: `hello` mit `last_seq`/`last_op_id`, `welcome` mit `from_seq`, Nachlieferung ohne Lücke und Duplikate. Dann `reset` über eine unbekannte Position: Handler, `subscribed` mit `reset = true`, danach nur neue Operationen. |
| `backoff4503` | Echter 4503: `session.start` hat auf `main` noch keinen Handler (`internal_error`, `handler_missing`, wiederholbar). Wartezeiten 1 s, 2 s, 4 s, 8 s, nach 5. Versuch Fehlerablage (`poison`), danach normale Operationen und Backoff-Reset nach einem `ack`. |
| `leader` | Zwei Tabs im selben Kontext (gemeinsame IndexedDB und Locks): Rollen, genau eine Verbindung, 10 Wechsel per `takeOver()` mitten im Senden von je 60 Strichen, Übernahme beim Schließen des Leader-Tabs. Prüft, dass genau die bestätigten und übergebenen Striche auf dem Server liegen und nichts, was `SyncNotLeaderError` meldete. |

## Aufruf

```bash
# Voraussetzung: Postgres 16 läuft auf 127.0.0.1:5432 (sg/sg), pnpm install ist gelaufen,
# Playwright ist vorhanden (wird nicht installiert).
pg_lsclusters || pg_ctlcluster 16 main start
node apps/web/scripts/e2e-sync/run.cjs                 # mit Build
node apps/web/scripts/e2e-sync/run.cjs --skip-build    # vorhandenes apps/web/out nutzen
node apps/web/scripts/e2e-sync/run.cjs --only leader,acks
```

Optionen: `--port 4731`, `--keep` (Datenbank und Temp-Verzeichnis mit `core.log` behalten), `--only a,b`.
Andere Datenbank-Admin-URL: `E2E_PG_ADMIN_URL=postgres://user:pw@host:5432/postgres`.
Exit-Code 1, wenn eine Prüfung fehlschlägt. Dauer: etwa 1 Minute ohne Build (4503-Backoff allein rund 30 s).

## Grenzen

- Der Verbindungsabbruch wird clientseitig ausgelöst (`WebSocket.close`), nicht durch einen Netzausfall.
- 4503 entsteht über die fehlenden Session-Handler. Sobald `registerSessionHandlers` auf `main` liegt, braucht
  `backoff4503` eine andere Quelle (z. B. `pg_terminate_backend` auf die LISTEN-Verbindung oder ein ungültiger Fachfall).
- Der Wettlauf beim Leader-Wechsel ist im Browser nicht zeitlich erzwingbar. Deterministisch deckt ihn
  `test/sync-leader-window.test.ts` ab; das E2E-Szenario `leader` ist der Stresstest dazu.
