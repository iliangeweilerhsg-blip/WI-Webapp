# Entwicklung

Technische Grundlage: [`docs/spezifikation/`](spezifikation/00-UEBERSICHT.md), vor allem Kapitel 02, 08 und 10.
Regeln für die Zusammenarbeit der Agenten stehen in [`AGENTS.md`](../AGENTS.md).

## Struktur (Monorepo, 10 §1)

| Ordner | Inhalt | Stand |
|---|---|---|
| `packages/schemas` | JSON Schemas (Quelle der Wahrheit), Codegen, Contract-Tests, `swift-support` (Swift-Hilfsschicht und Swift-Contract) | ✅ T0-02 |
| `packages/shared` | Generierte TS-Typen und Zod-Validatoren, gemeinsame Konstanten | ✅ T0-02 |
| `packages/ui-tokens` | Design-Tokens (JSON → CSS-Variablen, Swift) | ✅ T0-06 |
| `services/core` | Node 22, Fastify, Drizzle, REST-API | ✅ T0-04 |
| `services/worker` | Python 3.12 (uv), Job-Schleife, Pipeline | ✅ T0-05 |
| `apps/web` | Next.js (Static Export), React, Tailwind | ✅ T0-06 |
| `apps/ipad` | SwiftUI + PencilKit (`.swiftpm`) | Phase 1 |
| `infra` | Docker Compose (Postgres + pgvector), `sg`-CLI | ✅ T0-03 |

## Befehle

```bash
pnpm install              # Abhängigkeiten (Node 22, pnpm 10)
pnpm lint                 # ESLint
pnpm format               # Prettier (format:check in CI)
pnpm typecheck            # tsc in allen Paketen
pnpm test                 # Unit- und Contract-Tests (Vitest)
pnpm schemas:gen          # Codegen nach TS/Zod, Python, Swift (braucht uv)
pnpm schemas:check        # wie CI: generierte Dateien aktuell?
```

Python-Contract-Tests: `cd packages/schemas && uv run --project python pytest python/tests -q`

## Datenbank-Migrationen

- Migrationen erzeugt `drizzle-kit` aus `services/core/src/db/schema/`, abgelegt unter `services/core/drizzle/`. Danach muss `drizzle-kit generate` „No schema changes“ melden.
- **Nur vorwärts:** Drizzle kennt keine Down-Migrationen. Änderungen werden rückwärtskompatibel gebaut: erst Spalte hinzufügen, später alte entfernen.
- Vor jeder Migration auf dem Mac des Owners wird ein Backup gemacht. `sg migrate` legt es selbst an (`pnpm sg backup`, VERTRAEGE §13), sofern ein Backup-Ziel eingestellt ist.
- **Ausgerollte Migrationen nie ändern.** Solange eine Migration nur auf Branches existiert, darf sie neu erzeugt werden.
- **Fremdschlüssel:**
  - CASCADE für Teile eines Ganzen, z. B. `slide` → `slide_deck`.
  - SET NULL für optionale Verweise.
  - NO ACTION für Pflicht-Eltern, z. B. `module` → `semester`. Endgültiges Löschen geschieht nur bewusst.

## Datenformate ändern

1. Schema in `packages/schemas/src/*.schema.json` ändern. Alle Typnamen liegen in einem gemeinsamen Namensraum, Verweise als `#/$defs/Name`.
   Neben einem `$ref` keine weiteren Schlüssel (z. B. `description`), sonst erzeugt der Codegen doppelte Typen.
   Damit alle drei Generatoren gleich prüfen:
   - **Unions** als `anyOf` aus `$ref`s auf strikte Objekt-Varianten mit `const`-Unterscheider (`type`, `kind`, `name`), kein `oneOf`. Muster: `PdfIngestPayload`, `SyncOp`, `PageElement`. Python bekommt dafür ein `type X = A | B`, das iPad decodiert die Variante selbst (`docs/VERTRAEGE.md` §11.7).
   - **Enums** immer als eigenes `$def`, nie inline. Sonst erzeugt Pydantic Klassen wie `Kind1`.
   - **Nicht verwenden:** `minProperties`, `if/then`, `dependentRequired`, `uniqueItems`. Pydantic ignoriert sie, die Contract-Tests würden auseinanderlaufen. Solche Regeln prüft der Core und dokumentiert sie in der `description`.
   - **Bekannte Nachsicht von Pydantic:** Optionale, nicht nullbare Felder akzeptieren dort auch `null`. Ungültige Beispiele dürfen sich darauf nicht stützen.
   - **`Uuid`** ist ein String mit Muster (Kleinbuchstaben), bewusst ohne `format: uuid`. Pydantic ignoriert ein Muster am Typ `UUID`, die drei Sprachen würden sonst verschieden prüfen. In Python sind IDs darum `str`. `psycopg` liefert `uuid.UUID`, also vor der Validierung `str()` anwenden.
   - **Sync-Typen** (`sync.schema.json`) haben keine Felder, die zugleich optional und nullbar sind. Swift kann „fehlt“ und `null` nicht unterscheiden. Nullbare Felder sind dort Pflichtfelder.
   - **Swift:** `gen.mjs` ergänzt die quicktype-Ausgabe um ein `encode(to:)` je Struct (Pflichtfelder auch als `null`) und um Datumsfunktionen mit Millisekunden. Unions laufen über `packages/schemas/swift-support` (`docs/VERTRAEGE.md` §11.7). Prüfung lokal mit `bash packages/schemas/swift-support/check.sh` (braucht `swiftc`), in der CI im Job „Swift-Contract“.
2. Beispiele unter `packages/schemas/examples/valid|invalid/<Typ>.<name>.json` ergänzen.
   Token-, Nonce- oder Schlüsselwerte immer als künstliche Werte mit niedriger Entropie schreiben (`EXAMPLEdevicetoken000…`), sonst schlägt das Secret-Scanning (gitleaks) an. Ein Gitleaks-Ausnahmeregelwerk gibt es nicht. Nur die 8 alten Funde aus PR #51 stehen mit Fingerprint in `.gitleaksignore`.
3. `pnpm schemas:gen`, dann `pnpm test` und die Python-Contract-Tests.
4. Generierte Dateien **nie von Hand** ändern:
   - `packages/shared/src/generated/`
   - `packages/schemas/generated/`
   - `packages/schemas/python/sg_schemas/models.py`

Erzeugt werden:
- TS-Typen und Zod: `@sg/shared`
- Pydantic: Python-Paket `sg-schemas` unter `packages/schemas/python`, vom Worker als Pfad-Abhängigkeit eingebunden
- Swift: `packages/schemas/generated/swift/Schemas.swift`, wird in Phase 1 in die iPad-App übernommen

## Konventionen

- **Commits:** Deutsch, mit Funktions-ID, wo es eine gibt: `F-ORG-02: Doppelte PDFs am sha256 erkennen` (10 §1).
- **Branches:** nach `AGENTS.md`.
  - Lead: `claude/…`
  - Subagents: `feat/F-XXX-nn-kurz` bzw. `feat/T0-xx-kurz`
  - Argon: `argon/issue-<nr>`
- **Merge:** Merge-Commit. Das weicht von „Squash“ in 10 §1 ab, gilt aber laut Owner-Freigabe in `CLAUDE.md`.
- **TypeScript:** `strict`, `noUncheckedIndexedAccess` und `erasableSyntaxOnly`. Erlaubt ist nur Syntax, die sich beim Ausführen einfach weglassen lässt, also keine `enum`s und keine `namespace`s. Imports zwischen Workspace-Paketen laufen über den Paketnamen (`@sg/shared`).
- **`@sg/shared` wird nicht gebaut.** Das Paket exportiert TypeScript-Quellen mit `.ts`-Imports. Für die Nutzer gilt:
  - **Core:** läuft direkt mit Node ≥ 22.18 (Type-Stripping) oder `tsx`. `tsc` nur mit `noEmit` und `allowImportingTsExtensions`, nie `tsc` zum Erzeugen von JS.
  - **Web:** `transpilePackages: ['@sg/shared']` in der Next-Konfiguration und `allowImportingTsExtensions` in der tsconfig.
  - **Tests:** Vitest importiert das Paket direkt.
- **Python:** `ruff` und `mypy --strict`, Tests mit `pytest`.

## Schemas beschreiben die API, nicht die Tabellen

Die Typen in `packages/schemas` sind die **API- und Nachrichtenformate**. Die Datenbanktabellen legt der Core nach 03 §3–4 und `docs/VERTRAEGE.md` §3 an.
Interne Spalten wie `file_path`, `image_path`, `thumb_path`, `solution_file_path` und `embedding` gehören zur Tabelle, aber nicht in die API.
Dateien liefert die API über eigene Endpunkte aus:
- `GET /slides/{id}/image` und `GET /slides/{id}/thumb` (Vorschaubild, Ergänzung zu 08 §1)
- Übungsblätter entsprechend in T0-09

Die Phase-1-Schemas (Kalender, Session, Handschrift, Sync, Geräte, Backups, Einstellungen) und ihre Laufzeitregeln stehen in `docs/VERTRAEGE.md` §6–15. `SlideDeck.session_id` bleibt `null`, bis T1-02 Sessions anlegt.

**Bekannte Lücke:** Pydantic akzeptiert bei Zeitstempeln auch Zahlen (Unix-Zeit), Zod und JSON Schema nicht. Payloads schreibt nur der Core, und der prüft mit Zod. Darum ist das in Phase 0 unkritisch.

## Bewusste Ergänzungen zur Spezifikation

| Stelle | Ergänzung | Grund |
|---|---|---|
| `semester.archived_at` | Neues Feld | F-ORG-01 verlangt Archivieren. Das ist nicht dasselbe wie Löschen (`deleted_at`) |
| `exercise_sheet.ingest_state` | Neues Feld | Übungsblätter laufen ebenfalls durch `pdf.ingest` (Seitenbilder, Text) |
| `pdf.ingest` Payload | `exercise_sheet_id` als Alternative zu `slide_deck_id` | Ein Job für beide PDF-Arten |
| Modulfarben | Tokens `mod-01` … `mod-12` | 07 §8 legt die Palette fest, die Werte stehen in `packages/ui-tokens` |
| TypeScript | Version 6.0 | 7.0 wird von `typescript-eslint` noch nicht unterstützt |
| `ExerciseSheet` (API) | `page_count` neu, `has_solution` statt `solution_file_path` | Der Dateipfad ist intern, die API meldet nur, ob eine Lösung da ist |
| `GET /slides/{id}/thumb` | Neuer Endpunkt | Die Seitenleiste der PDF-Anzeige braucht kleine Vorschaubilder (F-ORG-04) |
| `Health` | Neues Schema | Antwort von `GET /api/v1/health`, die CLI wartet darauf |
| `module.settings` | W-06 Option A übernommen, in 03 §3 eingetragen | Layout und Schreibmodus pro Modul (F-DSH-01, F-INK-03) |
| `calendar_source.name`, `.last_error`; `calendar_event.description`, `.all_day`, `.assigned_by` | Neue Felder | Anzeige, URL-Fehler, Zuordnung über die Beschreibung, ganztägige Termine, manuelle Zuordnung überlebt den Abgleich (VERTRAEGE §6.1) |
| `Session.planned_starts_at/ends_at` | Abgeleitete Felder | Start-Karte und Auto-Stopp brauchen die Terminzeiten |
| `recording.chunks_independent`, `.completed_at`, `POST /recordings/{id}/complete` | Neu | Spike S4 offen, Ende der Aufnahme für `audio.finalize` |
| `PUT /photos/{id}/file` statt `POST /photos` | Geändert in 08 §1 | Wiederholbarer Upload mit der `photo_id` des iPads, Metadaten über `photo.add` |
| `GET /sessions/{id}/snapshot`, `GET /notebooks/{id}/pages`, `stream_seq` | Neu | REST-Stand und Sync-Strom lückenlos zusammensetzen |
| Sync: `protocol`, `client`, `subscribe`, `presence`, `time.offset`, `error`, `head_seq`/`reset`, Ereignisse `device.connection`/`pairing.requested` | Ergänzungen zu 08 §2 | Abos ohne Neuverbinden, Notizen-Spalte folgt dem iPad, iPad-Status, Fehler und Wiederherstellung (VERTRAEGE §11) |
| `POST /devices/pairings` | Neu | QR-Code ohne vorherigen Aufruf vom iPad (08 §3 Schritt 4) |
| `PairingCode.host`/`.port`, QR-Format `sg://pair?v=1&…` | Neu | QR-Code und Anzeige tragen dieselben Daten, manuelle Eingabe möglich |
| Operation `notebook.create` | Ergänzung zu 08 §2.3 | Freie Notizbücher offline anlegen (F-INK-02, F-INK-14) |
| `session.start_offsets` | Neues Feld | Abweichender Offline-Start, `t_ms` werden nicht umgerechnet (VERTRAEGE §9.3) |
| `session.auto_stop_extended_until`, `POST /sessions/{id}/extend` | Neu | „weiter aufnehmen“ (F-SES-03), auch für die Rückfallebene im Core |
| Server-Operationen `notebook.update/.delete/.restore`, `page.restore` | Ergänzung zu 08 §2.3 | Clients erfahren REST-Änderungen und Wiederherstellungen im Strom |
| `welcome.db_epoch`, `SyncStreamPosition.last_op_id`, `stream_op_id` in REST-Ständen | Ergänzung zu 08 §2.1 | Erkennen einer Wiederherstellung (`reset`) ohne Reset-Schleife nach REST-Laden |
| `PairingRequest`, `DELETE /devices/pairings/requests/{id}` | Neu | `pair/start` belegt das Kopplungsfenster nicht exklusiv (Delta-Review PR #51) |
| `PairConfirmRequest.pairing_id`, `pairing_id` im QR-Inhalt, Kopplungsfenster nur lokal | Geändert in 08 §3 | Sicherheitsreview PR #51 |
| `page.update` mit vollständigem Feldstand | Geändert in 08 §2.3 | Eindeutige Kodierung ohne optionale nullbare Felder |
| `MaintenanceNightlyPayload`/`Result` | Neu | Umfang von `maintenance.nightly` in Phase 1 (VERTRAEGE §13) |
| Kalender-Abgleich | Synchron im Core, kein Job `calendar.sync` | VERTRAEGE §8 |
