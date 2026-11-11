# Zusammenarbeit: Claude (Lead) × Claude-Subagents (Argon pausiert)

Stand: 11. November 2026 · Betrieb **nur über Abos**, keine API-Keys.

> **Argon ist pausiert (Owner-Entscheidung vom 11.11.2026).** Das Projekt arbeitet ohne Argon.
> Claude ist Lead und vergibt Arbeit nur noch an Claude-Subagents.
> Alle Argon-Abschnitte unten sind als „ruht“ markiert. Sie bleiben stehen, falls der Owner Argon wieder freigibt.

## 1. Grundidee

Claude führt und merged, der Owner (Mensch) setzt Ziele und hat ein Veto (`status:halt`).

**Aufgabenverteilung:** Die gesamte Arbeit machen **Claude und Claude-Subagents**.
Argon ist pausiert und bekommt keine Aufgaben. Reviews und Gegen-Reviews übernehmen frische Claude-Subagents (Abschnitt 4).

| Wer | Anteil | Typische Arbeit |
|---|---|---|
| **Claude (Lead)** | Steuerung | Architektur, Schnittstellen, Aufgaben zerlegen, Integration, Merges |
| **Claude-Subagents** | Umsetzung und Reviews | Features parallel in eigenen Branches, Tests, Refactorings, unabhängige Reviews und Gegen-Reviews (Modell nach Abschnitt 4) |
| **Argon** | pausiert | (ruht) UI aus Mockups, Security-Audits, lange Dokumente, Gegen-Reviews |

**GitHub ist die gemeinsame Schnittstelle:** Aufgaben sind Issues, Ergebnisse sind Pull Requests, Feedback sind Reviews und Kommentare.

```
Owner ──Ziel──▶ Claude (Lead, Claude Code in der Cloud)
                 │  zerlegt in Tasks, legt Schnittstellen fest, wählt das Modell pro Task
                 ├──▶ selbst erledigen                         Branch claude/…
                 └──▶ Claude-Subagents/Workflows, parallel      Branches feat/…
                          │
                          ▼
                 frischer Subagent reviewt (Opus bei Code, Sonnet bei Doku)
                 Claude merged nach Freigabe

(ruht: Argon-Queue mit Label agent:argon, PRs "[Argon] …", Review und Nacharbeit über GitHub)
```

## 2. Welche Kanäle es per Abo gibt (Recherche, Nov. 2026)

_Nur Claude Code ist aktiv. Die Zeilen zu Antigravity und Gemini CLI ruhen, solange Argon pausiert ist._

| Kanal | Status | Verwendung bei uns |
|---|---|---|
| **Claude Code** (Claude-Abo) | Läuft in Cloud-Sessions, auch ohne den Owner; kann Subagents, Workflows und weitere Sessions starten | **Lead**, arbeitet auch nachts |
| **Google Antigravity** (Google AI Pro/Ultra) | Desktop-IDE auf dem Rechner des Owners; liest `AGENTS.md` und `GEMINI.md` automatisch (bei Konflikten gewinnt `GEMINI.md`). Eine Cloud-Ausführung ist angekündigt, aber noch nicht verfügbar | **Argon**, läuft, wenn der Owner es startet |
| Gemini CLI mit Google-Login | Quellen widersprechen sich, ob der Abo-Login noch funktioniert | Ersatz für Antigravity, falls nötig; gleiche Regeln |
| Jules | **Wird eingestellt:** ab 11.11.2026 nur noch lesbar, Abschaltung am 31.12.2026 | Nicht verwenden |
| Gemini Code Assist GitHub-App (kostenlos) | Laut Berichten seit Juli 2026 für Privatnutzer eingestellt | Nicht verwenden |

**Folge:** Argon arbeitet **asynchron in Schüben**, immer wenn der Owner Antigravity startet. Claude bereitet die Queue so vor,
dass Argon sie ohne Rückfragen abarbeiten kann. Sobald Antigravity Cloud-Ausführung bekommt, kann Argon ebenfalls ohne den Owner laufen.
Dann wird nur der Startweg ausgetauscht, der Prozess bleibt gleich.

## 3. Stärken-Matrix und Aufgabenverteilung

Ohne Argon verteilt Claude die Arbeit nach Modell. Die Details stehen im Modell-Routing (Abschnitt 4).

| Aufgabe | Wer |
|---|---|
| Architektur, Schnittstellen, Aufgabenzerlegung, Integration, Merges | Claude (Lead) |
| Komplexeste Features (Nebenläufigkeit, Locks, Sync, schwierige Algorithmen) | Subagent mit Fable 5.2 |
| Standard-Features, UI, Doku, Tests | Subagent mit Sonnet 5.5 |
| Code- und Security-Reviews, Gegen-Reviews | frischer Subagent mit Opus 5.5 |
| Mechanisches (Umbenennen, Labels, Formatierung) | Subagent mit Haiku |
| Build-Setup, CI, Debugging | Claude (Lead) |

### Zuordnungsregel

> **Komplex** (Nebenläufigkeit, mehrere Dienste, Sync, Algorithmen)? → **Fable 5.2**.
> **Normales Feature, UI oder Doku?** → **Sonnet 5.5**.
> **Review, Security, Vertrag?** → **Opus 5.5**.
> **Rein mechanisch?** → **Haiku**.
> Mehrere **unabhängige Features**? → **Subagents parallel** (Abschnitt 5).

### Argon (ruht)

Gemini 4 Argon wurde am 30.09.2026 angekündigt. Der Owner hat Argon am 11.11.2026 pausiert.
Frühere Einschätzung, falls Argon zurückkehrt: Stärken bei sehr langem Kontext (~1 Mio. Tokens), Multimodalität (Mockup → UI), Security-Audits und Wissensarbeit.
Schwächen bei Terminal-Arbeit, knifflichen Algorithmen und Verfügbarkeit (läuft nur, wenn der Owner Antigravity startet).
Die Zahlen stammten von Google oder aus Sekundärquellen und wurden nicht unabhängig geprüft.
Die früheren Aufgaben von Argon liegen jetzt bei Opus (Security-Audits, Gegen-Reviews) und Sonnet (UI, Doku).
Fehlt ein Blick auf ein Bild oder ein sehr großes Dokument, liest Claude es selbst in Teilen.

## 4. Modell-Routing (Pflicht)

Für jeden Agenten wird das Modell bewusst gewählt: so stark wie nötig, so günstig wie möglich.

| Modell | Wann |
|---|---|
| **Fable 5.2** | Komplexeste Features: Nebenläufigkeit und Locks, Ketten über mehrere Dienste, Sync, schwierige Algorithmen |
| **Opus 5.5** | Reviews von Code, Security-Reviews und Gegen-Reviews (ersetzt Argons Gegen-Review), Security-kritischer Code, Debugging, Merge-Konflikte, Verträge und Architektur |
| **Sonnet 5.5** | Standard für Features, UI und Doku sowie Reviews von Doku |
| **Haiku** | Mechanisches: Umbenennen, Labels, einfache Formatierung |

(Ruht: Die frühere Gemini-Tabelle mit Argon und Flash gilt nicht, solange Argon pausiert ist.)

## 4a. Token-Budget (Owner-Auftrag vom 05.11.2026)

Der Owner hat Claude beauftragt, den Token-Verbrauch zu senken, **ohne die Qualität zu verschlechtern**. Claude verantwortet das als Orchestrator. Die Regeln:

**Review-Tiefe nach Risiko.** Das erste Review jedes eigenen Code-PRs macht weiterhin ein frischer Opus-Subagent. Die Tiefe richtet sich nach dem Risiko:

| Stufe | Wann | Review-Umfang |
|---|---|---|
| **A – kritisch** | Anmeldung und Geräte-Kopplung (Tokens, Auth-Wächter), Moodle-Zugangsdaten und andere Geheimnisse, Dateipfade und Uploads, Löschen/Papierkorb/Wiederherstellen, Backup/Restore, Sync-Protokoll, Sperren und Nebenläufigkeit, Migrationen, alles mit Datenverlust- oder Sicherheitsrisiko | voll: Gegenproben auf alle Kernpfade (gezielt eingebaute Fehler, die die Tests finden müssen), echte Nachstellung gegen Postgres oder den echten Core, Angriffsszenarien |
| **B – normal** | UI-Features, Darstellung, Einstellungen (ohne Zugangsdaten und Berechtigungen), Hilfsfunktionen | gezielt: Diff und direkt betroffene Dateien, 2–3 Gegenproben auf die Kernlogik, Browser-Check nur wenn die Tests das Verhalten nicht abdecken (z. B. Layout, echte Timer) |

**Im Zweifel gilt Stufe A.** Stufe B nur, wenn der PR keinen Bereich aus A berührt, auch nicht indirekt. Security-Kritisches bekommt zusätzlich ein Gegen-Review durch einen weiteren frischen Opus-Subagent. Doku-PRs prüft ein frischer Sonnet-Subagent im Umfang von Stufe B.

**Nachrunden.** Das Erst-Review macht immer ein frischer Subagent. Die folgenden Nachrunden erfüllen die Regel „unabhängiges Review“ weiterhin.
- Eine kleine Nacharbeit (Stufe B, bis 150 geänderte Zeilen und ohne Berührung von Bereichen aus Stufe A) prüft Claude selbst anhand des Diffs.
- Größere Nacharbeit und alles in Stufe A prüft **derselbe** Reviewer weiter, per Fortsetzen statt Neustart. Er hat den Kontext schon.
- Darum werden Worktrees von Autoren und Reviewern **erst nach dem Merge** gelöscht.

**Aufträge an Subagents.**
- Konkrete Dateien und Abschnitte nennen, keine pauschalen Leselisten („lies die Spezifikation“).
- Autoren führen die Tests der betroffenen Pakete aus. Die volle Suite läuft in der CI.
- Screenshots nur bei UI-Änderungen.
- Höchstens **2 Agents parallel** (Autoren und Reviewer zusammengezählt), solange das 5-Stunden-Fenster der Engpass ist. Mehr nur, wenn der Owner es freigibt.

**Neue Regeln ab 11.11.2026 (Arbeit ohne Argon).**
- **Knappe Briefs:** Der Auftrag nennt Abschnittsverweise (z. B. „Vertrag §3.2“) und eine Dateiliste. Ganze Verträge werden nicht eingefügt.
- **Vollständig implementieren:** Agents liefern das Feature komplett mit Tests, keine Platzhalter und kein „Rest folgt“.
- **Höchstens 1 Nacharbeitsrunde:** Danach entscheidet Claude, ob er selbst korrigiert oder neu zuschneidet. Das gilt zusätzlich zu den Nachrunden-Regeln oben.

**Cache-Regel (Owner, 11.11.2026).** Der Cache von Subagents hält nur etwa 5 Minuten. Darum gilt:
- Kein Agent wartet länger als 5 Minuten im Leerlauf: kein `sleep` und kein Polling langer Hintergrund-Tests.
- Tests laufen gezielt und im Vordergrund, nie mit `run_in_background`. Die volle Suite läuft einmal am Ende, bei Bedarf in Teilen von jeweils unter 5 Minuten.
- Einen Agent wiederverwenden geht nur innerhalb von 5 Minuten nach seiner letzten Antwort. Sonst übernimmt ein frischer Agent mit kurzem Brief.
- Kleine Review-Befunde behebt der Reviewer selbst im selben Lauf.

**Lead-Session.** Ist der Verlauf sehr lang, übergibt Claude an eine neue Session. Den Stand findet die neue Session in offenen Issues und PRs sowie in einer kurzen Übergabe-Notiz, die Claude vorher als Issue mit dem Titel „Lead-Übergabe“ anlegt. PR-Abos werden nach dem Merge sofort beendet.

**Fragen an den Owner (Entscheidungsdokument, Owner-Regel vom 11.11.2026).** Das Repo ist öffentlich. Darum stellt Claude Fragen nicht im Chat, sondern als Issue.
- Jede Frage ist ein eigenes Issue mit dem Label `entscheidung`. Dringende bekommen zusätzlich `dringend`.
- Jede Frage wird in der Übersicht #188 verlinkt.
- Nachfragen laufen im jeweiligen Issue.
- Schreibt der Owner im Chat „Fragen beantwortet“, liest Claude alle Antworten und arbeitet weiter. Erledigte Issues schließt Claude.
- Ausnahme: Geheimes und Persönliches bleibt im Chat, nie im Issue.

**Ruhemodus im Chat (Owner-Regel vom 11.11.2026).**
- Agent-Meldungen arbeitet der Lead still ab: Review, CI, Merge, nächster Agent. Im Chat erscheint dazu höchstens eine ⚙-Zeile.
- Der laufende Stand steht in #188 unter „Aktueller Stand“. Auf „Stand?“ antwortet Claude mit einer Zusammenfassung.
- Ausführlich wird nur bei Antworten an den Owner, bei Dringendem und bei Aufgaben für den Owner.
- Nachrichten des Owners haben Vorrang vor Agent-Meldungen.
- Schreibt der Owner „Gespräch“, entfallen auch die ⚙-Zeilen, bis er „weiter“ schreibt.

## 5. Parallele Features mit Claude-Subagents

| Variante | Wie | Wann |
|---|---|---|
| **Subagent mit eigenem Worktree** | Eigene Git-Arbeitskopie und eigener Branch (`feat/…`) pro Subagent | 2 kleinere Features gleichzeitig (mehr nur mit Owner-Freigabe, siehe §4a) |
| **Eigene Cloud-Session pro Feature** | Claude startet eine separate Claude-Code-Session mit eigenem Container und Ziel-Branch und überwacht sie | Größere, länger laufende Features |
| **Workflow (Multi-Agent)** | Orchestrierung mehrerer Agenten per Skript, Modell pro Agent nach Abschnitt 4 | Vom Owner freigegeben; für größere Pakete, z. B. nachts |

**Damit sich niemand in die Quere kommt:**

1. **Schnittstellen zuerst:** Gemeinsame Typen und API-Verträge kommen in einem eigenen kleinen PR, *bevor* parallel gearbeitet wird.
2. **Disjunkter Scope:** Jeder Task bekommt eigene Ordner (z. B. `src/features/<feature>/`). Zwei parallele Tasks ändern nie dieselbe Datei.
3. **Gemeinsame Dateien** (Routing, Navigation, `package.json`, Lockfile) ändert nur Claude beim Integrieren.
4. **Ein Branch pro Task**, abgezweigt vom aktuellen `main`; kleine PRs, schnell mergen, danach rebasen.
5. **Merge-Reihenfolge** bestimmt Claude, Konflikte löst Claude.
6. **Argon** (pausiert) zählte als weiterer paralleler Worker mit denselben Regeln. Über `status:in-arbeit` sieht jeder, was belegt ist.

## 5a. Fallback: Argons Limit ist aufgebraucht (ruht)

_Gilt nur, wenn Argon wieder aktiv ist. Solange er pausiert ist, laufen weder der Poller `scripts/claude-argon-poll.sh` noch die stündliche geplante Aufgabe dafür. Kurz: Claude übernimmt Argons Branch `argon/issue-<nr>`, tauscht die Labels gegen `agent:claude` und arbeitet dort weiter._

Das Gemini-Abo hat Nutzungslimits. Ist es aufgebraucht, macht Claude weiter, und die Arbeit geht nicht verloren:

1. **Argon sichert Zwischenstände** als `wip:`-Commits auf `argon/issue-<nr>`. Bei einer Limit-Warnung schreibt Argon einen Kommentar mit dem aktuellen Stand und setzt `argon:limit`.
2. **Claude prüft das Repo automatisch**, auf zwei Wegen:
   - **Alle 5 Minuten:** In der Claude-Session läuft dauerhaft `scripts/claude-argon-poll.sh` im Hintergrund. Es fragt alle 5 Minuten per `git ls-remote` die Branches `argon/*` ab und verbraucht dabei keine Token. Pusht Argon (neuer, geänderter oder gelöschter Branch), endet das Skript etwa 60 s später und weckt Claude. Claude reviewt den PR und startet das Skript neu. Ohne Änderung endet es nach ca. 110 min. Ist GitHub schon beim Start nicht erreichbar, endet es nach spätestens 2 min mit `FEHLER`, gescheiterte Abfragen während des Laufs zählt es nur mit. In beiden Fällen startet Claude es neu. Pro Clone darf nur ein Poller laufen, weil alle Worktrees dieselbe Zustandsdatei nutzen. Der zuletzt gemeldete Stand liegt in `.git/argon-poll.state`, darum wird auch ein Push gemeldet, der zwischen zwei Läufen kam. Das Skript läuft nur, solange die Claude-Session aktiv ist.
   - **Stündlich** läuft zusätzlich eine geplante Aufgabe als Sicherheitsnetz, z. B. für Labels und Kommentare ohne Push.

   Dabei übernimmt Claude:
   - Issues mit `argon:limit`: sofort
   - Issues mit `status:in-arbeit`, bei denen seit über 60 Minuten weder Commit noch Kommentar kam: Die Session ist vermutlich abgebrochen, Claude übernimmt
   - weitere `agent:argon`-Issues aus der Warteschlange, wenn ein anderes Issue davon abhängt oder sie länger als 24 Stunden unbearbeitet liegen
3. **So übernimmt Claude:** Claude kommentiert `**[Claude]** Übernehme wegen Argon-Limit` und tauscht die Labels `agent:argon`/`argon:limit` gegen `agent:claude`. Dann arbeitet Claude auf demselben Branch `argon/issue-<nr>` weiter und öffnet bzw. aktualisiert den PR mit „Erstellt von: Argon + Claude“.
4. Aufgaben, die **wirklich** Argons Stärke brauchen (z. B. Analyse eines riesigen Dokuments), lässt Claude bis zum nächsten Argon-Start liegen. Ausnahme: Etwas hängt davon ab.
5. **Owner:** Du musst nichts tun. Schneller geht es, wenn du hier im Claude-Chat „Argon-Limit erreicht“ schreibst.

## 6. Tagesrhythmus

**Nachts / ohne Owner (Claude):**
- `agent:claude`-Issues und vom Owner vorgegebene Ziele umsetzen, bei Bedarf mit Subagents/Workflows
- Offene PRs von Subagents reviewen lassen und mergen (Argon-Queue ruht)
- Fragen an den Owner als Issue mit `status:blockiert` sammeln statt zu raten

**Morgens (Owner, ca. 5 Minuten):**
1. Fragen beantworten: `gh issue list --label status:blockiert`. Nach der Antwort das Label `status:blockiert` entfernen
2. Optional ansehen, was Claude gemergt hat: `gh pr list --state merged --limit 10`. Soll ein offener PR **nicht** gemergt werden: Label `status:halt` setzen
3. (Ruht, Argon pausiert) Optional, als Zusatzkapazität: Antigravity öffnen, Modell wählen, Prompt aus [`docs/argon/DAUERBETRIEB.md`](argon/DAUERBETRIEB.md) einfügen. Argon arbeitet seine Queue ab und wartet danach selbstständig auf neue Aufgaben, solange der Mac an ist. Ohne Argon läuft das Projekt trotzdem weiter
4. Hängt ein Issue auf `status:in-arbeit`, ohne dass jemand daran arbeitet: `gh issue edit <nr> --remove-label status:in-arbeit`

## 7. Pilotphase: Argons Stärken im echten Projekt prüfen (ruht)

1. **Onboarding (Issue #1):** Argon prüft den Prozess selbst und verbessert `GEMINI.md`/Start-Prompt – testet den kompletten Ablauf Issue → PR → Review.
2. **Multimodal:** Screenshot/Skizze → UI-Komponente (sobald der Tech-Stack steht).
3. **Security:** Audit des Repos (Auth, Eingaben, Abhängigkeiten).
4. **Langer Kontext:** Gesamte Codebasis auf Inkonsistenzen prüfen und Architektur-Doku schreiben.

## 8. Erfahrungslog

Siehe [`ERFAHRUNGSLOG.md`](ERFAHRUNGSLOG.md) (eigene Datei, damit es keine Merge-Konflikte mit dieser Doku gibt).

## Einrichtung (einmalig, durch den Owner; ruht, solange Argon pausiert ist)

1. (Erledigt am 04.11.2026) Setup nach `main` gemergt – ohne `GEMINI.md`/`AGENTS.md` auf `main` startet Argon nicht (der Start-Prompt prüft das).
2. Antigravity installieren, mit dem Google-Konto des Abos anmelden, Repo klonen und öffnen.
3. GitHub CLI installieren. Sie ist **kein Teil von Antigravity**, sondern ein eigenes Programm, das Argon im Terminal von Antigravity benutzt.
   - Windows: im Terminal `winget install --id GitHub.cli` (dazu Git: `winget install --id Git.Git`)
   - macOS ohne Homebrew: Git mit `xcode-select --install` (Dialog bestätigen), GitHub CLI als `.pkg`-Installer von https://cli.github.com
   - macOS mit Homebrew: `brew install gh git`
   - Antigravity danach neu starten, dann im Antigravity-Terminal `gh auth login` (GitHub.com → HTTPS → „Login with a web browser“) und zum Prüfen `gh auth status`.
4. Labels: legt Argon beim ersten Start automatisch an (laut Start-Prompt). Alternativ selbst: `bash scripts/setup-labels.sh`.
5. In Antigravity erlauben, dass der Agent Terminal-Befehle ohne Einzelbestätigung ausführt.
6. Prüfen, ob „Gemini 4 Argon“ in der Modell-Auswahl von Antigravity für dein Abo erscheint.
   Falls nicht: das stärkste verfügbare Gemini-Modell nehmen und es Claude mitteilen, dann wird die Matrix angepasst.
7. Empfohlen: Branch-Schutz für `main` (Settings → Branches bzw. Rulesets: PR verpflichtend, keine direkten Pushes).
   Argon arbeitet mit deinem Login – so ist ein versehentlicher Push auf `main` technisch ausgeschlossen.
   Bei privaten Repos ist das je nach GitHub-Plan evtl. nicht verfügbar.

## Quellen

- [TechCrunch: Google releases Gemini 4 Argon](https://techcrunch.com/2026/09/30/google-releases-gemini-4-argon-called-its-most-powerful-model-yet/)
- [CNBC: Google rolls out Gemini 4 Argon](https://www.cnbc.com/2026/09/30/google-gemini-4-argon-ai.html)
- [Vals AI: Gemini 4 Argon Benchmarks](https://www.vals.ai/models/google_gemini-4-argon)
- [computingforgeeks: Gemini 4 Argon Benchmarks](https://computingforgeeks.com/gemini-4-argon-released-features-benchmarks/)
- [Layer3 Labs: Gemini 4 Argon for Coding](https://www.layer3labs.io/guides/gemini-4-argon-for-coding)
- [Times of AI: Google schaltet Jules ab, Wechsel zu Antigravity](https://www.timesofai.com/news/google-jules-antigravity/)
- [posixai: Jules-Abschaltung – Termine](https://posixai.com/blog/google-jules-shutdown-december-31-how-to-export-data)
- [testingcatalog: Cloud-Ausführung für Antigravity angekündigt](https://www.testingcatalog.com/cloud-execution-is-coming-to-antigravity-soon/)
- [agentpedia: AGENTS.md in Antigravity](https://agentpedia.codes/blog/antigravity-agents-md-guide)
- [Gemini CLI: Authentifizierung](https://geminicli.com/docs/get-started/authentication.md)
- [Qodo: Einstellung der kostenlosen Gemini-Code-Assist-GitHub-App](https://www.qodo.ai/?p=22530)
