# Zusammenarbeit: Claude (Lead) × Argon (Gemini 4 Argon)

Stand: 3. November 2026 · Betrieb **nur über Abos** (Claude-Abo und Google-AI-Abo), keine API-Keys.

## 1. Grundidee

Claude führt, Argon ist Spezialist, der Owner (Mensch) entscheidet und merged.
Die beiden KIs laufen in getrennten Produkten und können sich nicht direkt aufrufen.
**GitHub ist die gemeinsame Schnittstelle:** Aufgaben sind Issues, Ergebnisse sind Pull Requests, Feedback sind Reviews und Kommentare.

```
Owner ──Ziel──▶ Claude (Lead, Claude Code in der Cloud)
                 │  zerlegt in Tasks, legt Schnittstellen fest, wählt das Modell pro Task
                 ├──▶ selbst erledigen                         Branch claude/…
                 ├──▶ Claude-Subagents/Workflows, parallel      Branches feat/…
                 └──▶ Issue mit Label agent:argon  ──┐         (Queue)
                                                     │
Owner öffnet Antigravity + Start-Prompt ──▶ Argon arbeitet die Queue ab
                                                     │
                       PR "[Argon] …" (status:review) ◀┘
                 Claude reviewt ──▶ Feedback + Issue: agent:argon, status:nacharbeit ──▶ nächster Argon-Schub
                 Claude gibt frei (status:freigegeben) ──▶ Owner merged
```

## 2. Welche Kanäle es per Abo gibt (Recherche, Nov. 2026)

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

## 3. Was Argon besonders gut kann – und wofür wir es einsetzen

Gemini 4 Argon wurde am 30.09.2026 angekündigt und ist seit Mitte Oktober 2026 breit verfügbar.
**Achtung:** Die meisten Zahlen stammen von Google oder aus Sekundärquellen und sind nicht unabhängig geprüft.
Das Erfahrungslog (Abschnitt 8) korrigiert die Matrix anhand echter Ergebnisse.

| Stärke von Argon (laut Quellen) | Beleg | Einsatz bei uns |
|---|---|---|
| **Sehr langer Kontext** (~1 Mio. Tokens) | Größter Vorsprung u. a. bei GraphWalks 256k–1M (84,2 %) | Ganzes Repo auf einmal analysieren: Konsistenz, große Migrationen, Architektur-Doku, lange Vorgaben/PDFs auswerten |
| **Multimodal** (Bild, Video, Dateien) | SWE-bench Multimodal 56 % (Vals AI, Platz 4 von 18) | Mockup/Screenshot → UI-Komponente; visuelle Prüfung von Screenshots |
| **Security / Cyber-Defense** | Laut Google speziell trainiert, Schwachstellen zu finden, zu validieren und zu patchen | Security-Audits vor Releases |
| **Wissensarbeit** (Finanzen, Recht) | Führt in Reviews bei Legal-/Finance-Benchmarks | Fachlogik der Wirtschaftsinformatik-App, Entwürfe für Rechtstexte – **immer menschlich prüfen** |
| **Große Output-Mengen** | Long decode | Testdaten, Seed-Daten, Übersetzungen, umfangreiche Doku |
| **Second Opinion** | anderes Modell = andere blinde Flecken | Gegen-Review von Claudes PRs an kritischen Stellen |

| Schwäche von Argon (laut Quellen) | Folge |
|---|---|
| Terminal-lastige Agentenarbeit (Terminal-Bench ~57 % vs. ~66 % bei Claude Opus 5.5) | Build-Setup, CI und Debugging macht Claude |
| Wettbewerbsprogrammierung schwach (ProgramBench 2,5 %) | Knifflige Algorithmen macht Claude |
| Berichte über Zweifel an der Coding-Leistung im Alltag | Jeder Argon-PR wird von Claude reviewt |
| Läuft nur, wenn der Owner Antigravity startet | Nichts Eiliges oder Blockierendes an Argon geben |

**Claude (Lead) übernimmt:** Architektur und Tech-Stack, Aufgabenzerlegung, Schnittstellen, Build/CI/Tooling,
Debugging, Integration mehrerer Branches, Code-Reviews und alles, was über Nacht fertig werden muss.

### Zuordnungsregel

> Braucht der Task **viel Kontext auf einmal, Bilder, einen Security-Blick oder Fachwissen** und darf er bis zum nächsten Antigravity-Start warten? → **Argon**.
> Braucht er **Terminal-Arbeit, Architekturentscheidungen, Integration** oder ist er **eilig**? → **Claude**.
> Mehrere **unabhängige Features**? → **Claude-Subagents parallel** (Abschnitt 5).

## 4. Modell-Routing (Pflicht)

Für jeden Agenten wird das Modell bewusst gewählt: so stark wie nötig, so günstig wie möglich.

### Claude-Seite (Subagents, Workflows, Cloud-Sessions)

| Modell | Wann |
|---|---|
| **Opus** | Architektur, Schnittstellen, Reviews (v. a. von Argon-PRs), Debugging, Security-kritischer Code, Merge-Konflikte |
| **Sonnet** | Features nach klarer Spezifikation, Tests schreiben, normale Refactorings |
| **Haiku** | Mechanisches: Suchen, Umbenennen, Formatieren, kleine Doku-Änderungen, Zusammenfassungen |

### Gemini-Seite (Modellwahl in Antigravity)

| Modell | Wann |
|---|---|
| **Gemini 4 Argon** | Standard für alle `agent:argon`-Issues |
| **Flash-Modell** | Nur wenn **alle** offenen Argon-Issues das Label `modell:flash` tragen (einfache Massenarbeit). Spart Abo-Kontingent |

Claude markiert im Issue, welches Modell sinnvoll ist (Label `modell:flash` nur bei einfachen Tasks).

## 5. Parallele Features mit Claude-Subagents

| Variante | Wie | Wann |
|---|---|---|
| **Subagent mit eigenem Worktree** | Eigene Git-Arbeitskopie und eigener Branch (`feat/…`) pro Subagent | 2–4 kleinere Features gleichzeitig |
| **Eigene Cloud-Session pro Feature** | Claude startet eine separate Claude-Code-Session mit eigenem Container und Ziel-Branch und überwacht sie | Größere, länger laufende Features |
| **Workflow (Multi-Agent)** | Orchestrierung mehrerer Agenten per Skript, Modell pro Agent nach Abschnitt 4 | Vom Owner freigegeben; für größere Pakete, z. B. nachts |

**Damit sich niemand in die Quere kommt:**

1. **Schnittstellen zuerst:** Gemeinsame Typen und API-Verträge kommen in einem eigenen kleinen PR, *bevor* parallel gearbeitet wird.
2. **Disjunkter Scope:** Jeder Task bekommt eigene Ordner (z. B. `src/features/<feature>/`). Zwei parallele Tasks ändern nie dieselbe Datei.
3. **Gemeinsame Dateien** (Routing, Navigation, `package.json`, Lockfile) ändert nur Claude beim Integrieren.
4. **Ein Branch pro Task**, abgezweigt vom aktuellen `main`; kleine PRs, schnell mergen, danach rebasen.
5. **Merge-Reihenfolge** bestimmt Claude, Konflikte löst Claude.
6. **Argon** zählt als weiterer paralleler Worker mit denselben Regeln. Über `status:in-arbeit` sieht jeder, was belegt ist.

## 5a. Fallback: Argons Limit ist aufgebraucht

Das Gemini-Abo hat Nutzungslimits. Ist es aufgebraucht, macht Claude weiter, und die Arbeit geht nicht verloren:

1. **Argon sichert Zwischenstände** als `wip:`-Commits auf `argon/issue-<nr>`. Bei einer Limit-Warnung schreibt Argon einen Kommentar mit dem aktuellen Stand und setzt `argon:limit`.
2. **Claude prüft das Repo automatisch alle 2 Stunden** über eine geplante Aufgabe in der Claude-Session und übernimmt:
   - Issues mit `argon:limit`: sofort
   - Issues mit `status:in-arbeit`, bei denen seit über 60 Minuten weder Commit noch Kommentar kam: Die Session ist vermutlich abgebrochen, Claude übernimmt
   - weitere `agent:argon`-Issues aus der Warteschlange, wenn ein anderes Issue davon abhängt oder sie länger als 24 Stunden unbearbeitet liegen
3. **So übernimmt Claude:** Claude kommentiert `**[Claude]** Übernehme wegen Argon-Limit` und tauscht die Labels `agent:argon`/`argon:limit` gegen `agent:claude`. Dann arbeitet Claude auf demselben Branch `argon/issue-<nr>` weiter und öffnet bzw. aktualisiert den PR mit „Erstellt von: Argon + Claude“.
4. Aufgaben, die **wirklich** Argons Stärke brauchen (z. B. Analyse eines riesigen Dokuments), lässt Claude bis zum nächsten Argon-Start liegen. Ausnahme: Etwas hängt davon ab.
5. **Owner:** Du musst nichts tun. Schneller geht es, wenn du hier im Claude-Chat „Argon-Limit erreicht“ schreibst.

## 6. Tagesrhythmus

**Nachts / ohne Owner (Claude):**
- `agent:claude`-Issues und vom Owner vorgegebene Ziele umsetzen, bei Bedarf mit Subagents/Workflows
- Argon-PRs reviewen, die Argon-Queue für den nächsten Schub vorbereiten
- Fragen an den Owner als Issue mit `status:blockiert` sammeln statt zu raten

**Morgens (Owner, ca. 10 Minuten):**
1. Freigegebene PRs mergen: `gh pr list --label status:freigegeben`
2. Fragen beantworten: `gh issue list --label status:blockiert`. Nach der Antwort das Label `status:blockiert` entfernen
3. Antigravity öffnen, Modell wählen, Prompt aus [`docs/argon/START-PROMPT.md`](argon/START-PROMPT.md) einfügen. Argon arbeitet die Queue ab, während du etwas anderes machst
4. Hängt ein Issue auf `status:in-arbeit`, ohne dass jemand daran arbeitet: `gh issue edit <nr> --remove-label status:in-arbeit`

## 7. Pilotphase: Argons Stärken im echten Projekt prüfen

1. **Onboarding (Issue #1):** Argon prüft den Prozess selbst und verbessert `GEMINI.md`/Start-Prompt – testet den kompletten Ablauf Issue → PR → Review.
2. **Multimodal:** Screenshot/Skizze → UI-Komponente (sobald der Tech-Stack steht).
3. **Security:** Audit des Repos (Auth, Eingaben, Abhängigkeiten).
4. **Langer Kontext:** Gesamte Codebasis auf Inkonsistenzen prüfen und Architektur-Doku schreiben.

## 8. Erfahrungslog

Siehe [`ERFAHRUNGSLOG.md`](ERFAHRUNGSLOG.md) (eigene Datei, damit es keine Merge-Konflikte mit dieser Doku gibt).

## Einrichtung (einmalig, durch den Owner)

1. Diesen Branch nach `main` mergen – **vorher** startet Argon nicht (der Start-Prompt prüft das).
2. Antigravity installieren, mit dem Google-Konto des Abos anmelden, Repo klonen und öffnen.
3. GitHub CLI installieren und `gh auth login` ausführen.
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
