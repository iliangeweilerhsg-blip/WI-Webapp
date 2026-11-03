# AGENTS.md – Gemeinsame Regeln für alle KI-Agenten

Dieses Repository wird von mehreren KI-Agenten gemeinsam mit dem Menschen (Repo-Owner) entwickelt.
Diese Datei gilt für **alle** Agenten. `CLAUDE.md` und `GEMINI.md` importieren sie und ergänzen nur rollenspezifische Punkte.

## Rollen

| Rolle | Wer | Verantwortung |
|---|---|---|
| **Owner** | Mensch | Ziele setzen, Entscheidungen, **Merges nach `main`** |
| **Lead** | Claude (Claude Code) | Architektur, Aufgaben zerlegen und verteilen, Reviews, Integration, CI |
| **Spezialist** | Argon (Gemini 4 Argon) | Bearbeitet Aufgaben, die Claude als Issue mit Label `agent:argon` vergibt |
| **Worker** | Claude-Subagents | Parallele Feature-Arbeit in eigenen Branches/Worktrees, vom Lead beauftragt |

Details zum Ablauf: [`docs/KOLLABORATION.md`](docs/KOLLABORATION.md).

## Grundregeln

1. **Kein Agent pusht direkt auf `main`.** Jede Änderung kommt per Pull Request; gemergt wird nur vom Owner.
2. **Ein Task = ein Branch = ein PR.** Branch-Namen:
   - `claude/<kurzbeschreibung>` – Lead
   - `argon/issue-<nr>` – Argon (wird vom Workflow automatisch angelegt)
   - `feat/<kurzbeschreibung>` – Worker-Subagents
3. **Nur im eigenen Scope arbeiten.** Jeder Task nennt die Dateien/Ordner, die er ändern darf („Scope“). Dateien außerhalb nicht anfassen – stattdessen im PR unter „Offene Punkte“ notieren.
4. **Schnittstellen zuerst.** Gemeinsam genutzte Typen, API-Verträge und Datenmodelle legt der Lead fest, bevor parallel gearbeitet wird. Agenten ändern diese Verträge nicht eigenmächtig.
5. **Kleine PRs.** Lieber mehrere kleine als einen großen.
6. **Akzeptanzkriterien erfüllen.** Ein PR ist erst fertig, wenn alle Kriterien aus dem Issue erfüllt sind und die Checks (Build, Lint, Tests – sobald vorhanden) grün sind.
7. **Keine Secrets** in Code, Commits, Issues oder PR-Texten.
8. **Keine neuen Abhängigkeiten** ohne Begründung im PR.
9. **Ehrlich berichten.** Was nicht getestet wurde oder nicht funktioniert, steht im PR – nichts schönreden.

## PR-Beschreibung (Pflichtinhalt)

- **Was** wurde geändert und **warum** (Bezug: `Closes #<issue>`)
- **Wie getestet**
- **Offene Punkte / Risiken**
- Bei UI-Änderungen: Screenshot

## Projekt-Konventionen

> Wird ergänzt, sobald der Tech-Stack feststeht (Sprache, Framework, Ordnerstruktur, Befehle für Build/Test/Lint).
