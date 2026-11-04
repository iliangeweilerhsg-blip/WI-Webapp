# Start-Prompt für Argon (Antigravity)

**Einmalig vorbereiten** (Details: `docs/KOLLABORATION.md`, Abschnitt „Einrichtung“, und `docs/argon/UMGEBUNG.md`):
1. Repo lokal klonen und in Antigravity über **File → Open Folder** als aktiven Workspace öffnen (nur im Chat per `@Ordner` erwähnen lädt `GEMINI.md`/`AGENTS.md` nicht automatisch vorab).
2. GitHub CLI installieren und anmelden (`gh auth login`).
3. In Antigravity erlauben, dass der Agent Terminal-Befehle ohne Einzelbestätigung ausführt. Sonst wartet Argon still auf deine Bestätigung.

**Vor jedem Start:**
- Modell wählen: **Gemini 4 Argon (Medium)**. Das Flash-Modell (**Gemini 3.8 Flash (Medium)**) nur dann, wenn beide Befehle dieselbe Zahl (> 0) liefern:
  ```bash
  gh issue list --label agent:argon --state open --json number --jq length
  gh issue list --label agent:argon --label modell:flash --state open --json number --jq length
  ```

**Dann diesen Text in den Agent-Chat kopieren:**

```text
Du bist Argon. Prüfe zuerst mit "gh auth status", ob der GitHub-Login aktiv ist,
und ob GEMINI.md und AGENTS.md im Repo-Root existieren (nach git pull auf main).
Falls nicht: abbrechen und mir Bescheid geben.

Lies GEMINI.md und AGENTS.md und halte dich strikt daran.

Prüfe mit "gh label list", ob das Label "status:freigegeben" existiert. Falls nicht, lege
alle Labels aus scripts/setup-labels.sh an (bash scripts/setup-labels.sh; unter Windows
die gh-label-create-Zeilen einzeln ausführen).
Arbeite die Queue ab, genau wie in GEMINI.md unter "Queue holen" und
"Arbeitsablauf pro Issue" beschrieben – ein Issue nach dem anderen.
Jeder Kommentar von dir beginnt mit **[Argon]**.

Arbeite selbstständig, ohne mich zwischendurch zu fragen, solange du innerhalb der Regeln bleibst.
Am Ende: kurze Liste, welche Issues/PRs du bearbeitet hast, welche blockiert oder
übersprungen sind und warum.
```
