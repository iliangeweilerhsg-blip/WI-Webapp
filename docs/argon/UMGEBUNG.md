# Argon-Umgebung in Google Antigravity

Dokumentation der realen Laufzeitumgebung von Argon (ermittelt beim Pilot-Durchlauf in Issue #1 am 04.11.2026 auf macOS mit `zsh`).

## 1. Modellbezeichnungen in Antigravity

In der Modellauswahl von Google Antigravity heißen die relevanten Modelle:

| Rolle im Workflow | Genaue Bezeichnung in Antigravity | Wann wählen |
|---|---|---|
| **Standard-Modell (Argon)** | `Gemini 4 Argon (Medium)` | Standard für alle `agent:argon`-Issues |
| **Flash-Modell** | `Gemini 3.8 Flash (Medium)` | Nur wenn **alle** offenen `agent:argon`-Issues das Label `modell:flash` tragen |

## 2. Welche Regeldateien Antigravity tatsächlich lädt

Antigravity besitzt ein hierarchisches Customization-System:

1. **Bei geöffnetem Workspace (`File → Open Folder` auf das Repo-Root):**
   - Antigravity läuft vom aktuellen Arbeitsverzeichnis bis zum Repo-Root (`.git`) hoch und lädt **`GEMINI.md`** und **`AGENTS.md`** automatisch in den Kontext (immer aktiv für ihren Verzeichnisbereich, dedupliziert nach Dateipfad).
   - Zusätzlich werden Regeln aus `.agents/rules/*.md` (sowie `.agent/`, `_agents/`, `_agent/`), Projekt-Skills aus `.agents/skills/<name>/SKILL.md` (Progressive Disclosure: Name und Beschreibung sofort, Volltext bei Bedarf) und globale Konfigurationen aus `~/.gemini/config/` geladen.
   - **Limits:** Pro Regeldatei gilt ein Limit von 24.000 Bytes (~24 KB), für alle Always-On-Regeln zusammen ein Budget von 20.000 Tokens.
   - **Include-Syntax:** Die Zeile `@AGENTS.md` am Anfang von `GEMINI.md` ist sowohl Claude-Code-Syntax als auch die Import-Syntax der Gemini CLI. Antigravity nutzt für Datei-Includes `@[AGENTS.md](AGENTS.md)`, lädt im geöffneten Workspace jedoch ohnehin `AGENTS.md` und `GEMINI.md` parallel. Entscheidung: Zeile 1 in `GEMINI.md` (`@AGENTS.md`) bleibt unverändert, damit Kompatibilität mit der Gemini CLI erhalten bleibt.

2. **Ohne geöffneten Workspace (nur `@[/Pfad/zum/WI-Webapp]` im Chat erwähnt):**
   - Wird der Ordner nur per `@`-Mention referenziert, ohne als Workspace geöffnet zu sein, injiziert Antigravity `GEMINI.md` und `AGENTS.md` **nicht** automatisch vorab in den System-Prompt, und das Standard-Arbeitsverzeichnis für Terminal-Befehle liegt außerhalb des Repos.
   - Die explizite Anweisung im `START-PROMPT.md` (`Lies GEMINI.md und AGENTS.md`) stellt sicher, dass Argon die Dateien in jedem Fall aktiv über sein `read_file`-Tool einliest.

## 3. Terminal-Befehle und Ausführungs-Verhalten

- **Terminal-Bestätigung:**
  - Sobald der Zugriff auf das Verzeichnis bzw. die automatische Befehlsausführung in Antigravity erlaubt wurde, liefen alle `git`- und `gh`-Befehle (`gh label create`, `gh issue list`, `gh issue view`, `gh issue edit`, `git checkout`, `git merge`, `git commit`, `git push`, `gh pr create`) **ohne Einzelbestätigung** durch.
- **Zustandslose Subshells (`run_command`):**
  - Jeder Terminal-Aufruf startet in einer neuen `zsh`-Session. Ein `cd` oder `export` bleibt **nicht** für den nächsten Tool-Aufruf erhalten. Wenn das Repo nicht als Workspace-Root gesetzt ist, muss jeder Befehl mit `cd <repo-pfad> && …` beginnen.
- **Hintergrund-Tasks bei Befehlen > 10 Sekunden (`WaitMsBeforeAsync`):**
  - Das Terminal-Tool wartet synchron maximal 10 Sekunden (`WaitMsBeforeAsync: 10000`). Dauert ein Befehl länger (z. B. `bash scripts/setup-labels.sh` mit 9 sequenziellen GitHub-API-Aufrufen, ca. 12–13 Sekunden), verschiebt Antigravity ihn automatisch in einen Hintergrund-Task.
  - Argon darf darauf **nicht** mit `sleep`-Polling reagieren, sondern beendet seinen Turn und wird von Antigravity automatisch geweckt, sobald der Task abgeschlossen ist.
- **GitHub CLI (`gh`) im macOS-Keyring:**
  - Beim ersten Start war das OAuth-Token im Keyring abgelaufen (`The token in keyring is invalid`). Ein Vorab-Check mit `gh auth status` zu Beginn einer Session fängt dies sofort ab, bevor Schreiboperationen fehlschlagen.
