# Entwicklung

Technische Grundlage: [`docs/spezifikation/`](spezifikation/00-UEBERSICHT.md), vor allem Kapitel 02, 08 und 10.
Regeln für die Zusammenarbeit der Agenten stehen in [`AGENTS.md`](../AGENTS.md).

## Struktur (Monorepo, 10 §1)

| Ordner | Inhalt | Stand |
|---|---|---|
| `packages/schemas` | JSON Schemas (Quelle der Wahrheit), Codegen, Contract-Tests | ✅ T0-02 |
| `packages/shared` | Generierte TS-Typen und Zod-Validatoren, gemeinsame Konstanten | ✅ T0-02 |
| `packages/ui-tokens` | Design-Tokens (JSON → CSS-Variablen, Swift) | T0-06 |
| `services/core` | Node 22, Fastify, Drizzle, REST-API | T0-04 |
| `services/worker` | Python 3.12 (uv), Job-Schleife, Pipeline | T0-05 |
| `apps/web` | Next.js (Static Export), React, Tailwind | T0-06 |
| `apps/ipad` | SwiftUI + PencilKit (`.swiftpm`) | Phase 1 |
| `infra` | Docker Compose (Postgres + pgvector), `sg`-CLI | T0-03 |

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

## Datenformate ändern

1. Schema in `packages/schemas/src/*.schema.json` ändern. Alle Typnamen liegen in einem gemeinsamen Namensraum, Verweise als `#/$defs/Name`.
   Neben einem `$ref` keine weiteren Schlüssel (z. B. `description`), sonst erzeugt der Codegen doppelte Typen.
2. Beispiele unter `packages/schemas/examples/valid|invalid/<Typ>.<name>.json` ergänzen.
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
- **TypeScript:** `strict` und `noUncheckedIndexedAccess`. Imports zwischen Workspace-Paketen über den Paketnamen (`@sg/shared`).
- **Python:** `ruff` und `mypy --strict`, Tests mit `pytest`.

## Bewusste Ergänzungen zur Spezifikation

| Stelle | Ergänzung | Grund |
|---|---|---|
| `semester.archived_at` | Neues Feld | F-ORG-01 verlangt Archivieren. Das ist nicht dasselbe wie Löschen (`deleted_at`) |
| `exercise_sheet.ingest_state` | Neues Feld | Übungsblätter laufen ebenfalls durch `pdf.ingest` (Seitenbilder, Text) |
| `pdf.ingest` Payload | `exercise_sheet_id` als Alternative zu `slide_deck_id` | Ein Job für beide PDF-Arten |
| Modulfarben | Tokens `mod-01` … `mod-12` | 07 §8 legt die Palette fest, die Werte stehen in `packages/ui-tokens` |
| TypeScript | Version 6.0 | 7.0 wird von `typescript-eslint` noch nicht unterstützt |
