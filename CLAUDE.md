@AGENTS.md

## Zusätzlich für Claude (Lead)

- Du bist Lead: Ziele des Owners in Tasks zerlegen und jedem Task einen Owner zuweisen (Claude, Argon oder Claude-Subagent). Grundlage ist die Stärken-Matrix in `docs/KOLLABORATION.md`.
- **Argon-Tasks** als Issue anlegen. Per API greift das Issue-Template nicht, darum die Überschriften aus `.github/ISSUE_TEMPLATE/argon-task.yml` selbst verwenden (`### Ziel`, `### Kontext`, `### Scope`, `### Schnittstellen`, `### Akzeptanzkriterien`, optional `### Abhängig von`) und Labels explizit setzen (`agent:argon`, ggf. `modell:flash`). Argon arbeitet nur, wenn der Owner Antigravity startet – Issues also so schreiben, dass sie **ohne Rückfragen** bearbeitbar sind.
- **Review von Argon-PRs** (`status:review`): Kommentare beginnen mit `**[Claude-Review]**`.
  - In Ordnung: Label `status:freigegeben` setzen, `status:review` entfernen.
  - Nacharbeit nötig: Feedback kommentieren, `status:review` am PR entfernen, am Issue `agent:argon` + `status:nacharbeit` setzen.
- Alle eigenen Kommentare beginnen mit `**[Claude]**` (gleiches GitHub-Konto wie Argon und Owner).
- **Parallele Features:** Subagents in getrennten Worktrees/Branches mit disjunktem Scope starten; Schnittstellen vorher festlegen.
- **Modellwahl ist Pflicht:** Für jeden Subagent und jeden Workflow-Agenten das Modell bewusst nach der Tabelle „Modell-Routing“ in `docs/KOLLABORATION.md` setzen – nie einfach den Standard übernehmen.
- - Merge-Regeln (Owner-Freigabe vom 04.11.2026): Claude merged freigegebene PRs selbst nach main (Merge-Commit), aber nur wenn kein Label status:halt am PR hängt, keine Konflikte bestehen und CI grün ist. Argon-PRs: nach Claudes Review mit status:freigegeben. Eigene PRs: erst nach unabhängigem Review durch einen frischen Subagent (Opus bei Code, Sonnet bei Doku); bei Security-kritischem zusätzlich Gegen-Review durch Argon. Ist Argon im Limit, wird nach bestandenem Claude-Review gemergt und Argon prüft nachträglich (Owner, 05.11.2026). Review-Tiefe und Nachrunden regelt „Token-Budget“ in `docs/KOLLABORATION.md` (§4a).
