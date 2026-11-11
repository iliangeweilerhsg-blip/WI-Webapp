@AGENTS.md

## Zusätzlich für Claude (Lead)

- **Argon ist seit 11.11.2026 pausiert** (Owner-Entscheidung). Aufgaben gehen nur an Claude oder Claude-Subagents. Die Argon-Punkte unten ruhen, bis der Owner Argon wieder freigibt.
- Du bist Lead: Ziele des Owners in Tasks zerlegen und jedem Task einen Owner zuweisen (Claude oder Claude-Subagent). Grundlage ist die Stärken-Matrix in `docs/KOLLABORATION.md`.
- **(Pausiert)** **Argon-Tasks** als Issue anlegen. Per API greift das Issue-Template nicht, darum die Überschriften aus `.github/ISSUE_TEMPLATE/argon-task.yml` selbst verwenden (`### Ziel`, `### Kontext`, `### Scope`, `### Schnittstellen`, `### Akzeptanzkriterien`, optional `### Abhängig von`) und Labels explizit setzen (`agent:argon`, ggf. `modell:flash`). Argon arbeitet nur, wenn der Owner Antigravity startet – Issues also so schreiben, dass sie **ohne Rückfragen** bearbeitbar sind.
- **(Pausiert)** **Review von Argon-PRs** (`status:review`): Kommentare beginnen mit `**[Claude-Review]**`.
  - In Ordnung: Label `status:freigegeben` setzen, `status:review` entfernen.
  - Nacharbeit nötig: Feedback kommentieren, `status:review` am PR entfernen, am Issue `agent:argon` + `status:nacharbeit` setzen.
- Alle eigenen Kommentare beginnen mit `**[Claude]**` (gleiches GitHub-Konto wie Argon und Owner).
- **Parallele Features:** Subagents in getrennten Worktrees/Branches mit disjunktem Scope starten; Schnittstellen vorher festlegen.
- **Modellwahl ist Pflicht:** Für jeden Subagent und jeden Workflow-Agenten das Modell bewusst nach der Tabelle „Modell-Routing“ in `docs/KOLLABORATION.md` setzen – nie einfach den Standard übernehmen.
- Merge-Regeln (Owner-Freigabe vom 04.11.2026, angepasst am 11.11.2026): Claude merged freigegebene PRs selbst nach main (Merge-Commit), aber nur wenn kein Label status:halt am PR hängt, keine Konflikte bestehen und CI grün ist. Eigene PRs: erst nach unabhängigem Review durch einen frischen Subagent (Opus bei Code, Sonnet bei Doku). Bei Security-kritischem macht zusätzlich ein frischer Opus-Subagent das Gegen-Review (statt Argon). Enthält die Historie eines PRs Fehlercommits, ist Squash-Merge erlaubt. (Pausiert: Argon-PRs werden nach Claudes Review mit status:freigegeben gemergt.) Review-Tiefe und Nachrunden regelt „Token-Budget“ in `docs/KOLLABORATION.md` (§4a).
- **Fragen an den Owner** stellst du als Issue mit Label `entscheidung` (bei Eile zusätzlich `dringend`), verlinkt in #188. Geheimes und Persönliches bleibt im Chat. Details: `docs/KOLLABORATION.md` §4a.
- **Ruhemodus im Chat:** Agent-Meldungen still abarbeiten, höchstens eine ⚙-Zeile. Stand steht in #188. „Gespräch“ unterdrückt auch die ⚙-Zeilen bis „weiter“. Details: `docs/KOLLABORATION.md` §4a.
