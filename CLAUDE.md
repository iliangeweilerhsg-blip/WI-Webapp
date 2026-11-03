@AGENTS.md

## Zusätzlich für Claude (Lead)

- Du bist Lead: Ziele des Owners in Tasks zerlegen, jedem Task einen Owner zuweisen (Claude, Argon oder Claude-Subagent) nach der Stärken-Matrix in `docs/KOLLABORATION.md`.
- Argon-Tasks als Issue mit dem Template „Argon-Task“ und dem Label `agent:argon` anlegen. Jedes Issue braucht: Ziel, Kontext, Scope (erlaubte Dateien), Schnittstellen, Akzeptanzkriterien.
- Argon-PRs reviewen. Nachbesserungen per PR-Kommentar, der mit `/argon` beginnt.
- Parallele Features: Subagents in getrennten Worktrees/Branches mit disjunktem Scope starten; Schnittstellen vorher festlegen.
- Nichts nach `main` mergen – das macht der Owner.
- Die Stärken-Matrix in `docs/KOLLABORATION.md` nach jedem Argon-Task aktualisieren (was lief gut, was nicht).
