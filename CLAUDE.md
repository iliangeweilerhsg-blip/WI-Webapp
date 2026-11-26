@AGENTS.md

## Zusätzlich für Claude

- **Arbeitsstruktur:** Es gilt [`docs/ARBEITSSTRUKTUR.md`](docs/ARBEITSSTRUKTUR.md). Dort stehen die Bereiche und Rollen (Architekt, Bereichs-Lead im Gespräch oder Bau, Worker, Reviewer, Pfleger) und das gemeinsame Gedächtnis im Repo.
- **Zu Beginn jeder Session:**
  - Die Rolle steht in der Startnachricht des Owners (Vorlagen: `docs/bereiche/START.md`). Fehlt sie, fragst du einmal danach.
  - Lies `docs/UEBERSICHT.md` und die `STAND.md` deines Bereichs. Aus `VERTRAEGE.md` und der Spezifikation liest du nur die betroffenen Abschnitte.
- **Gedächtnis:** Was über diese Session hinaus gelten soll, steht im Repo, nie nur im Chat. Dazu gehören Entscheidungen, Stand, Specs und Ideen. Sagt der Owner „Idee: …“, kommt sie in `docs/IDEEN.md`.
- **Argon ist seit 11.11.2026 pausiert** (Owner-Entscheidung). Aufgaben gehen nur an Claude oder Claude-Subagents. Die Argon-Abschnitte in `docs/KOLLABORATION.md` ruhen.
- **Kommentare:** Alle eigenen Kommentare beginnen mit `**[Claude]**`, Reviews mit `**[Claude-Review]**`. Owner und Agents nutzen dasselbe GitHub-Konto.
- **Parallele Arbeit:** Subagents laufen in getrennten Worktrees und Branches mit disjunktem Scope. Die Schnittstellen werden vorher festgelegt.
- **Modellwahl ist Pflicht:** Für jeden Subagent und jeden Workflow-Agenten wählst du das Modell bewusst nach der Tabelle „Modell-Routing“ in `docs/KOLLABORATION.md`. Den Standard nie einfach übernehmen.
- **Merge-Regeln** (Owner-Freigabe vom 04.11.2026, angepasst am 11.11. und 26.11.2026):
  - Claude merged freigegebene PRs selbst nach main, mit Merge-Commit.
  - Voraussetzungen: kein Label `status:halt`, keine Konflikte, CI grün.
  - Eigene PRs brauchen vorher ein unabhängiges Review durch einen frischen Subagent: Opus bei Code, Sonnet bei Doku und kleinen Darstellungs-Änderungen ohne Logik (Owner-Freigabe vom 12.11.2026).
  - Bei Security-kritischem Code macht zusätzlich ein frischer Opus-Subagent das Gegen-Review.
  - Enthält die Historie eines PRs Fehlercommits, ist Squash-Merge erlaubt.
  - Review-Tiefe und Nachrunden regelt `docs/KOLLABORATION.md` §4a.
  - Gemeinsame Verträge, Schemas, Migrationen und die Spezifikation ändert nur der Architekt bzw. er gibt die Änderung frei (`ARBEITSSTRUKTUR.md` §4).
- **Fragen an den Owner** stellst du als Issue mit Label `entscheidung` (bei Eile zusätzlich `dringend`). Der Architekt bündelt sie zur Wochenrunde am Mittwoch, die Übersicht steht in `docs/UEBERSICHT.md`. Geheimes und Persönliches bleibt im Chat.
- **Kein Dauerbetrieb:** keine stündlichen Takte und kein autonomes Weiterarbeiten ohne Anlass. Gearbeitet wird auf Auftrag des Owners oder bei einem Ereignis (CI, Review, Merge).
