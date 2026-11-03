# Zusammenarbeit: Claude (Lead) × Argon (Gemini 4 Argon)

Stand: November 2026

## 1. Grundidee

Claude führt, Argon ist Spezialist, der Owner (Mensch) entscheidet und merged.
Beide KIs arbeiten im selben GitHub-Repo, aber **nie auf demselben Branch**. Die Koordination läuft über
**Issues → Branches → Pull Requests → Reviews**, also über den normalen GitHub-Prozess, der für Menschen nachvollziehbar bleibt.

```
Owner ──Ziel──▶ Claude (Lead)
                 │  zerlegt in Tasks, legt Schnittstellen fest
                 ├──▶ selbst erledigen                      (Branch claude/…)
                 ├──▶ Claude-Subagents, parallel             (Branches feat/…, je eigener Worktree)
                 └──▶ Issue mit Label agent:argon ──▶ GitHub Action ──▶ Argon
                                                                 │
                                         PR von argon/issue-N ◀──┘
                 Claude reviewt ──▶ "/argon <Feedback>" ──▶ Argon bessert nach
                 Claude gibt frei ──▶ Owner merged
```

## 2. Was Argon besonders gut kann – und wofür wir es einsetzen

Gemini 4 Argon ist seit 30.09.2026 angekündigt und seit Mitte Oktober 2026 über die Gemini API verfügbar.
**Achtung:** Die meisten Zahlen stammen von Google selbst oder aus Sekundärquellen und sind nicht unabhängig geprüft.
Darum starten wir mit einer Pilotphase (Abschnitt 5) und passen die Matrix danach an.

| Stärke von Argon (laut Quellen) | Beleg (Stand Recherche) | Einsatz bei uns |
|---|---|---|
| **Sehr langer Kontext** (~1 Mio. Tokens, inkl. „long decode“ über 65k Output hinaus) | Stärkster Vorsprung ggü. Konkurrenz u. a. bei GraphWalks 256k–1M (84,2 %) | Ganzes Repo auf einmal analysieren: Konsistenz-Checks, große Migrationen, Doku über die gesamte Codebasis, lange Vorgaben/PDFs (z. B. Aufgabenstellung, Richtlinien) auswerten |
| **Multimodal** (Bild, Video, Dateien) | SWE-bench Multimodal 56 % (Vals AI, Platz 4 von 18) | Mockup/Skizze/Screenshot → UI-Komponente; visuelle Prüfung von Screenshots (Layout, Abstände, Responsive) |
| **Security / Cyber-Defense** | Laut Google speziell trainiert, Schwachstellen zu finden, zu validieren und zu patchen | Security-Audits vor Releases (Auth, Input-Validierung, Abhängigkeiten) |
| **Wissensarbeit** (Finanzen, Recht) | Führt in Reviews bei Legal/Finance-Benchmarks | Fachlogik einer Wirtschaftsinformatik-App (Berechnungen, Geschäftsregeln), Entwürfe für Datenschutz-/Rechtstexte – **immer menschlich prüfen** |
| **Große Mengen Output** | Long decode | Testdaten, Seed-Daten, Übersetzungen, umfangreiche Doku |
| **Second Opinion** | anderes Modell = andere blinde Flecken | Gegen-Review von Claudes PRs bei kritischen Stellen |

| Schwäche von Argon (laut Quellen) | Folge |
|---|---|
| Terminal-/Shell-lastige Agentenarbeit (Terminal-Bench ~57 % vs. ~66 % bei Claude Opus 5.5) | Build-Setup, CI, Debugging mit vielen Befehlen macht Claude |
| Wettbewerbsprogrammierung schwach (ProgramBench 2,5 %) | Knifflige Algorithmen eher Claude |
| Berichte über Zweifel an der Coding-Leistung im Alltag trotz guter Benchmarks | Jeder Argon-PR wird von Claude reviewt |

**Claude (Lead) übernimmt daher:** Architektur und Tech-Stack, Aufgabenzerlegung, Schnittstellen,
Build/CI/Tooling, Debugging, Integration mehrerer Branches, Code-Reviews.

### Zuordnungsregel

> Braucht der Task **viel Kontext auf einmal, Bilder, Security-Blick oder Fachwissen** → Argon.
> Braucht der Task **viele Terminal-Schritte, Architekturentscheidungen oder Integration** → Claude.
> Mehrere **unabhängige Features** → Claude-Subagents parallel (Abschnitt 4).

## 3. Ablauf eines Argon-Tasks

1. **Claude legt ein Issue an** (Template „Argon-Task“, Label `agent:argon`) mit Ziel, Kontext, **Scope**, Schnittstellen und Akzeptanzkriterien.
2. Das Label startet den Workflow [`.github/workflows/argon.yml`](../.github/workflows/argon.yml):
   - Branch `argon/issue-<nr>` wird angelegt,
   - Argon bearbeitet die Aufgabe (ohne Zugriff auf GitHub-Tokens),
   - der Workflow committet, pusht und öffnet einen PR (`Closes #<nr>`).
3. **Claude reviewt den PR.** Nachbesserung per PR-Kommentar: `/argon Bitte …` – Argon arbeitet auf demselben Branch weiter.
4. Wenn alles passt, gibt Claude frei, **der Owner merged**.
5. Claude trägt die Erfahrung in Abschnitt 6 ein (was hat gut/schlecht geklappt).

Alternativ kann der Owner Argon auch lokal in **Google Antigravity** oder der **Gemini CLI** auf einem `argon/*`-Branch arbeiten lassen.
Argon liest dann automatisch `GEMINI.md` (und damit `AGENTS.md`) – die Regeln gelten genauso.

## 4. Parallele Features mit Claude-Subagents

Claude kann als Lead eigene Subagents mit genau umrissenen Aufgaben starten, die gleichzeitig an verschiedenen Features arbeiten:

| Variante | Wie | Wann |
|---|---|---|
| **Subagent mit eigenem Worktree** | Jeder Subagent bekommt eine eigene Git-Arbeitskopie und einen eigenen Branch (`feat/…`) | 2–4 kleinere Features gleichzeitig, Ergebnis kommt zu Claude zurück |
| **Eigene Cloud-Session pro Feature** | Claude startet eine separate Claude-Code-Session mit eigenem Container und Ziel-Branch und überwacht sie | Größere, länger laufende Features |
| **Workflow (Multi-Agent)** | Orchestrierung vieler Agenten per Skript | Nur wenn der Owner das ausdrücklich will („nutze einen Workflow“) – kostet viele Tokens |

**Damit sich niemand in die Quere kommt:**

1. **Schnittstellen zuerst:** Claude legt gemeinsame Typen/API-Verträge in einem eigenen kleinen PR fest, *bevor* parallel gearbeitet wird.
2. **Disjunkter Scope:** Jeder Task bekommt eigene Ordner (z. B. `src/features/<feature>/`). Zwei parallele Tasks dürfen nie dieselbe Datei ändern.
3. **Gemeinsame Dateien** (Routing, Navigation, `package.json`, Lockfile) ändert nur Claude beim Integrieren.
4. **Ein Branch pro Task**, von aktuellem `main` abgezweigt; kleine PRs, schnell mergen, danach rebasen.
5. **Merge-Reihenfolge** bestimmt Claude; Konflikte löst Claude beim Integrieren.

Argon zählt dabei als ein weiterer paralleler Worker – mit denselben Regeln.

## 5. Pilotphase: Argons Stärken im echten Projekt prüfen

Sobald der Tech-Stack steht, vergibt Claude drei kleine Test-Tasks, die je eine behauptete Stärke prüfen:

1. **Multimodal:** Screenshot/Skizze einer Seite → Argon baut die UI-Komponente.
2. **Security:** Argon auditiert das Repo (Auth, Eingaben, Abhängigkeiten) und schlägt Fixes vor.
3. **Langer Kontext:** Argon prüft die gesamte Codebasis auf Inkonsistenzen und schreibt die Architektur-Doku.

Claude bewertet Qualität, Scope-Treue und Nachbesserungsbedarf und passt die Matrix in Abschnitt 2 an.

## 6. Erfahrungslog

| Datum | Issue/PR | Typ | Ergebnis | Lernpunkt |
|---|---|---|---|---|
| – | – | – | – | – |

## Einrichtung (einmalig, durch den Owner)

1. **Gemini-API-Key** in Google AI Studio erzeugen (bezahlte API-Stufe nötig für Argon).
2. GitHub → *Settings → Secrets and variables → Actions*:
   - Secret `GEMINI_API_KEY` = API-Key
   - optional Variable `GEMINI_MODEL` (Standard: `gemini-4-argon`; anpassen, falls Google die Modell-ID anders benennt)
3. *Settings → Actions → General → Workflow permissions*: „Read and write permissions“ und
   **„Allow GitHub Actions to create and approve pull requests“** aktivieren.
4. Label `agent:argon` anlegen (Issues → Labels).
5. Diesen Branch nach `main` mergen – Issue-Workflows laufen immer in der Version auf dem Default-Branch.

Hinweise:
- PRs, die mit dem Standard-`GITHUB_TOKEN` erstellt werden, starten keine weiteren Workflows (z. B. CI). Wenn später CI auf Argon-PRs laufen soll, kann man eine GitHub App oder einen Fine-grained Token verwenden.
- Argon kann absichtlich keine Dateien unter `.github/` ändern.

## Quellen

- [TechCrunch: Google releases Gemini 4 Argon](https://techcrunch.com/2026/09/30/google-releases-gemini-4-argon-called-its-most-powerful-model-yet/)
- [CNBC: Google rolls out Gemini 4 Argon](https://www.cnbc.com/2026/09/30/google-gemini-4-argon-ai.html)
- [Vals AI: Gemini 4 Argon Benchmarks](https://www.vals.ai/models/google_gemini-4-argon)
- [computingforgeeks: Gemini 4 Argon Pricing, Benchmarks and API Tested](https://computingforgeeks.com/gemini-4-argon-released-features-benchmarks/)
- [Layer3 Labs: Gemini 4 Argon for Coding](https://www.layer3labs.io/guides/gemini-4-argon-for-coding)
- [google-github-actions/run-gemini-cli](https://github.com/google-github-actions/run-gemini-cli)
- [gemini-cli PR: Unterstützung für gemini-4-argon](https://github.com/google-gemini/gemini-cli/pull/29875)
