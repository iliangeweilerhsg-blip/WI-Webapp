# Phase 2: Stand und nächste Schnitte

Stand: 13. November 2026 · Basis: `main` (`1057093`).

Quellen: `docs/spezifikation/10-UMSETZUNG.md` §3 und §5, `04-FUNKTIONEN.md` (NAC, BIB, SUC, LRN), `05-KI-PIPELINE.md`, `06-LERNMODELL-PLANER.md` §1 und §3, `09-NFA.md` §1 und §6, `docs/VERTRAEGE.md` §18 bis §20, der Code auf `main`, die Issues #188, #207 und #324 sowie die gemergten PRs #142 bis #187 und #310 bis #312.

**Beweislage:** Jede Einstufung stammt aus dem Code auf `main`. In diesem Container laufen weder `mlx-whisper` noch `bge-m3` noch die Claude-API. Aussagen zu Laufzeit und Qualität sind deshalb „nicht geprüft“. Die Tests habe ich für diesen Abgleich nicht ausgeführt.

---

## 1. Kurzfassung

- **Phase 2 ist etwa zur Hälfte gebaut.** Die Kette Aufnahme → Transkript → Folienzuordnung → Konzepte → Inbox → Kurzfassung steht. Dazu kommen Rückblick, ⌘K, Konzeptansicht und Kostenzähler.
- **Es fehlen vier Blöcke:** der Vault (F-BIB-01, F-BIB-05 und F-DAT-03), `align.content` (F-NAC-03), die geführte Nacharbeitung (F-NAC-05) und die Notizen im Rückblick (F-NAC-02 rechts, F-NAC-04).
- **Kein Abnahmekriterium aus Phase 1 oder Phase 2 ist durch eine echte Vorlesung belegt.** Im Repo liegt kein ausgefülltes Hörsaal-Protokoll. Die Konzept-Kette lief noch nie gegen die echte API (#188, „Konzepte erstmals echt testen“).
- **Für Lernen gibt es nichts:** keine Tabellen `card`, `card_state`, `review_log`, kein `ts-fsrs`, hinter `/lernen` liegt nur ein Platzhalter (`apps/web/src/app/lernen/page.tsx`, „Phase 3“).
- **F-NAC-05 hängt an Phase 3.** Schritt 3 (Abruf mit KI-Bewertung) und Schritt 5 (Karten) brauchen F-LRN-02 und F-LRN-05. Die Abnahme „Nacharbeitung Median ≤ 15 min“ ist ohne Karten nicht voll erreichbar.
- **Empfehlung: Variante B (Minimal-Lernen) jetzt, in schmaler Form.** Begründung in §6.

---

## 2. F-ID → Status → Fundstelle → Rest

Einstufung: **fertig** (Akzeptanzkriterien technisch erfüllbar, Owner-Test ggf. offen), **teilweise**, **offen**.

### 2.1 E-NAC

| F-ID | Status | Fundstelle | Rest |
|---|---|---|---|
| **F-NAC-01** Verarbeitung nach der Session | teilweise | Kette: `services/core/src/services/pipeline.ts` (`ensurePipelineJobs`, Z. 256), Aufruf beim Beenden in `services/sessions.ts` Z. 286. Worker: `handlers/{audio_finalize,transcribe,align_log,concepts_extract,concepts_resolve,summary_write,search_index}.py`. Schrittliste: `apps/web/src/components/processing/StepList.tsx` | Es fehlen `align.content`, `ocr.photos`, `cards.generate`, `cornell.questions`, `explain.questions`, `vault.write`, `detect.exam_hints`. Der Heute-Bildschirm zeigt „wird verarbeitet“ und „verarbeitet“ (`today/StartCard.tsx` Z. 417 ff.), aber nicht „Nacharbeitung bereit · ≈ 15 min“. Laufzeit (≤ 20 min bzw. ≤ 45 min) nicht gemessen |
| **F-NAC-02** Rückblick | teilweise | `apps/web/src/components/rueckblick/ReviewView.tsx`, `PlayerBar.tsx`, `use-player.ts` (Tempo, ±15 s, Folie folgt der Wiedergabe: `followKey` Z. 284). Daten: `GET /sessions/{id}/transcript` (`services/transcript.ts`) | Die rechte Spalte fehlt: Notizseiten, Marker, Fotos. Das steht so im Kopf von `ReviewView.tsx` Z. 6. Die 500-ms-Grenze ist nicht gemessen |
| **F-NAC-03** Folienzuordnung korrigieren | offen | Nur Vorbereitung: `slide_segment.source` erlaubt `ausrichtung` und `manuell` (`db/schema/transcript.ts` Z. 122), Job-Name in `jobs.schema.json` | Handler `align.content` (Fenster, Viterbi), Inbox-Art `slide_correction`, Vorher/Nachher-Leiste, Grenzen von Hand verschieben, Notizseiten umhängen |
| **F-NAC-04** Audio-synchrone Notizen | offen | Striche tragen `t_start_ms` (`db/schema/ink.ts`), Renderer in `apps/web/src/components/ink/` | Tipp auf Strich → Wiedergabe, Wiedergabe-Modus, iPad-Seite. Setzt die Notizen im Rückblick voraus |
| **F-NAC-05** Geführte Nacharbeitung | offen | `session.review_state` existiert (`db/schema/organisation.ts` Z. 140), wird aber nie gesetzt. `inbox_item.position` ist für die Reihenfolge vorbereitet (`concepts.schema.json` Z. 1440) | Alles: `learn_session`, Ablauf mit 6 Schritten, Fortsetzen, `explain.questions`, Abruf-Fragen. Schritt 3 braucht F-LRN-05, Schritt 5 braucht F-LRN-02 |
| **F-NAC-06** Inbox | teilweise | Core: `routes/inbox.ts` (`/inbox/overview`, `accept`, `reject`, `reopen`, `/inbox/bulk`), `services/inbox.ts` (`older_count` Z. 195 ff.), Regeln in `services/concept-graph.ts`. Web: `components/inbox/SuggestionInbox.tsx`, `InboxRow.tsx`, `InboxEdit.tsx`. Automatik: `ai.auto_accept` (`services/settings.ts` Z. 70, Worker `concepts/accept.py`) | Nur die Arten `concept_new`, `concept_merge`, `relation` (`InboxKind`, `concepts.schema.json` Z. 27). Es fehlen `card_batch`, `slide_correction` und der Vault-Konflikt. Offene Nachträge in #324 (`also_changed`, `from_name`/`to_name`, Rückgängig nach A2) |
| **F-NAC-07** ○ Klausurhinweis-Detektor | offen | `exam_hint` kommt nur aus `concepts.extract` und setzt `concept.exam_relevant` (`concepts/accept.py` Z. 296) | Job `detect.exam_hints`, `marker(source=detektor)`, Ausschlussliste, Umriss-Darstellung. Optional (○) |
| **F-NAC-08** Zusammenfassung | teilweise | Worker `handlers/summary_write.py`, Prompt `prompts/summary.write/v1.md`, Tabelle `session_summary`, `GET /sessions/{id}/summary` (`services/summary.ts`), Web `rueckblick/SummaryPanel.tsx` | Vorlesungsnotiz im Vault fehlt (Abweichung in VERTRAEGE §20.13 festgehalten) |

### 2.2 E-BIB

| F-ID | Status | Fundstelle | Rest |
|---|---|---|---|
| **F-BIB-01** Vault und Konzeptnotizen | offen | Nur der Ordner `vault/` in Backup und Speicheranzeige (`infra/sg/src/backup-files.ts`, `services/storage.ts`). `concept` hat weder `vault_path` noch `content_hash` noch `block_hashes` (VERTRAEGE §20.13) | Vertrag (W-02 Option A), Migration, Schreiber mit Blockregeln und atomarem Schreiben, Vorlage nach 08 §8.2 |
| **F-BIB-02** Konzeptansicht | teilweise | `apps/web/src/components/concepts/ConceptView.tsx` (Kopf, Belege als Kacheln, Beziehungen, Fächerbrücken-Kennzeichen), `LibraryView.tsx`, `GET /concepts`, `GET /concepts/{id}` (`services/concepts.ts`) | Notiz-Editor (braucht den Vault), Beherrschung, Karten des Konzepts, Videos, Audio-Kachel mit Abspielknopf direkt in der Ansicht |
| **F-BIB-03** Beziehungen bearbeiten | offen | Kreisprüfung vorhanden (`services/concept-graph.ts`, Worker `concepts/cycle.py`), aber nur beim Annehmen aus der Inbox | Endpunkte für Anlegen, Entfernen, Typ ändern (`/concept-relations` fehlt laut §20.13), Oberfläche |
| **F-BIB-04** Zusammenführen und teilen | teilweise | Zusammenführen nur als Inbox-Entscheidung A2 (`concept_merge`, `concept-graph.ts`), Hülle mit `merged_into` | Zusammenführen aus der Konzeptansicht, Teilen, Weiterleitungsdatei im Vault |
| **F-BIB-05** Obsidian zurücklesen | offen | Kein `chokidar`, kein Watcher im Code | Alles. Setzt F-BIB-01 voraus |
| **F-BIB-07** Fachübersicht | teilweise | `apps/web/src/components/ModulView.tsx` (Reiter Vorlesungen, Übungen, Konzepte, Altklausuren), `modul/ModuleSessions.tsx`, `modul/ModuleConcepts.tsx` (#310) | `_Fach.md` im Vault, Readiness, Sortierung nach Schwäche, Abgaben je Übungsblatt, Prüfungstermin |
| **F-DAT-03** Export (Vault) | offen | – | Entsteht mit F-BIB-01 |

F-BIB-06, -08 und -09 gehören zu Phase 3 und sind offen. Das Kennzeichen für Fächerbrücken an Beziehungen ist schon da.

### 2.3 E-SUC

| F-ID | Status | Fundstelle | Rest |
|---|---|---|---|
| **F-SUC-01** ⌘K | teilweise | Core: `services/search.ts` (Wortsuche `ts_rank_cd` Z. 312, Bedeutungssuche über pgvector Z. 327, Präfixe `fach:` und `typ:` Z. 34 ff.), `services/search-backfill.ts`. Worker: `handlers/search_index.py`, `ai/embedder.py`, Loopback in `server.py`. Web: `components/search/SearchOverlay.tsx` (Tastatur, ⌘Enter Z. 189), Konzepte über `use-search.ts` (#311), Sprung im Rückblick | `SearchKind` kennt nur `slide` und `transcript` (`search.ts` Z. 34–36). Konzepte kommen aus einer zweiten Abfrage im Client und stehen nicht im Index. Es fehlen Notizen, Aufgaben, Karten, Fotos (OCR) und `semester:`. Die 300-ms-Grenze bei 5 000 Folien und 200 h ist nicht gemessen |
| **F-SUC-02** Frag deine Vorlesung | offen (Phase 3) | Nur der Job-Name `rag.answer` in `jobs.schema.json` | Alles |

### 2.4 Weitere Phase-2-Funktionen außerhalb der drei Epics

| F-ID | Status | Hinweis |
|---|---|---|
| **F-DAT-05** Kostenzähler und Budget | fertig mit Abweichung | `services/costs.ts`, Worker `ai/budget.py`, Web `settings/AiSettings.tsx`. Bei 100 % enden alle KI-Jobs mit Fehler, kein Hinweis im Briefing (§20.13) |
| **F-ORG-03** Zerlegung, **F-DSH-03** Übungs-Panel | offen | Kein `sheet.split`, kein `match.tasks_slides`. `ExerciseColumn.tsx` zeigt das Blatt, keine Aufgaben |
| **F-SES-06** Verpasste Vorlesung importieren | offen | Kein Audio-Import |
| **F-DSH-07** Suche in der Session | teilweise | ⌘K ist app-weit erreichbar. Verhalten nach R1 in der laufenden Session nicht gesondert geprüft |
| **F-INK-08** Textfelder, **F-INK-12** Cornell-Fragen | offen | Cornell-Vorlage ist nur als Seitenhintergrund da (`InkTemplateGeometry.swift`) |
| Vision in `pdf.ingest`, `embed.slides` | teilweise | Folien-Embeddings entstehen in `search.index`. `vision_summary` wird nicht erzeugt |

---

## 3. Abnahmekriterien

### 3.1 Phase 1

| Kriterium | Status | Beleg und Rest |
|---|---|---|
| Spikes S1–S4 entschieden | teilweise | **S2** entschieden: Das Uni-WLAN trennt die Geräte (#188), daraus folgte die Direktverbindung (S6, #257 bis #276). **S1** ist faktisch entschieden: Die App wird mit XcodeGen und Xcode gebaut (`apps/ipad/project.yml`), also Weg B. Die Datei `docs/entscheidungen/S1.md` fehlt. **S3:** Renderer gebaut, Messung Zoom 1/2 offen (#79). **S4:** Browser-Frage offen (#209). S5 (nicht Teil des Kriteriums): Messung auf dem Mac steht aus |
| Blindvergleich Schreibgefühl ≥ GoodNotes | nur Owner | Vorlage `docs/tests/hoersaal/BLINDVERGLEICH.md`, kein Ergebnis im Repo |
| 3 echte Vorlesungen ohne Strichverlust, Audioverlust ≤ 30 s | nur Owner | Vorlage `docs/tests/hoersaal/VORLAGE.md`, kein ausgefülltes Protokoll. Der wichtigste Test (Update und Sync im Hörsaal) steht in #188 als offen |
| Start ≤ 10 s | nur Owner | Technisch vorhanden: Ein-Tipp-Start in `today/StartCard.tsx`. Keine Messung |
| Backup + Restore geprüft | technisch erfüllt | Monatlicher Restore-Test (#108), `sg restore` mit Sperre (#319). Ein echter Restore auf dem Mac des Owners ist nicht dokumentiert |
| **Technisch offen aus T1-15** | fehlt | Die iPad-App hat Lasso und Textmarker, aber **keinen Marker-Stempel (❓ ⚠️ ⭐) und kein Tafel-Foto**. Die Kamera nutzt nur `Pairing/QRScannerView.swift`. Marker gibt es nur vom Mac (T1-17). Das trifft Phase 2 direkt: Schritt 1 der Nacharbeitung lebt von ❓-Markern |

### 3.2 Phase 2

| Kriterium | Status | Was fehlt |
|---|---|---|
| Pipeline ≤ 45 min | nur Owner, nicht gemessen | Die Kette ist kürzer als die Spezifikation (ohne Karten, Vault, OCR). Es gibt kein Werkzeug, das die Laufzeit einer Session aus den `job`-Zeiten ausweist. Die Messung S5 fehlt |
| Ausrichtung ≥ 85 % (goldener Datensatz) | fehlt technisch | `align.content` existiert nicht. Den goldenen Datensatz gibt es nicht, auch kein Auswerteskript und keinen synthetischen Mini-Datensatz für die CI (09 §6) |
| Nacharbeitung Median ≤ 15 min | fehlt technisch | F-NAC-05 ist nicht gebaut. Danach nur durch den Owner messbar |
| Vault in Obsidian fehlerfrei | fehlt technisch | Kein Vault-Schreiber. Danach Owner-Test in Obsidian |
| ⌘K < 300 ms | technisch prüfbar, nicht geprüft | Suche ist gebaut. Ein Lasttest mit 5 000 Folien und 200 h Transkript fehlt. Der ließe sich mit erzeugten Daten gegen Postgres bauen. Die Antwortzeit von `/embed` auf dem Mac kann nur der Owner messen |

---

## 4. Variante A: Phase 2 fertig machen

Ziel: die vier fehlenden Blöcke aus §1 schließen, ohne Karten. F-NAC-05 entsteht dabei mit den Schritten 1, 2, 4 und 6. Die Schritte 3 und 5 bleiben leer, bis Phase 3 sie liefert.

| # | Schnitt | Scope | Abhängig von | Vertrag vorher (Lead) | Risiko | Modell |
|---|---|---|---|---|---|---|
| **A1** | Rückblick rechts: Notizseiten, Marker, Fotos je Folie. Tipp auf Strich spielt ab `t_start_ms − 3 s` (F-NAC-02 Rest, F-NAC-04 ohne Wiedergabe-Modus) | `apps/web/src/components/rueckblick/**`, lesend `components/ink/**`, `apps/web/test/` | – | keiner, Datenwege stehen in §18.9 | B. Leistung bei vielen Strichen (#79) | Sonnet baut, Opus reviewt |
| **A2** | Messen: Lasttest ⌘K mit erzeugten Daten, Laufzeit je Session aus `job`-Zeiten (`sg`-Befehl oder Skript), Auswertung Ausrichtung gegen Log | `services/core/test/perf/**`, `infra/sg/src/` (ein neuer Befehl), `scripts/` | – | keiner | B. Lasttest darf die CI nicht verlangsamen (eigener, manueller Lauf) | Sonnet baut, Opus reviewt |
| **A3** | Vertrag Vault (neuer §21): Ordner, Vorlage, Blockregeln, Hashes, wer schreibt (Core laut 02), wann (nach Annahme, nach `summary.write`). Migration `0011`: `vault_path`, `content_hash`, `block_hashes` | `docs/VERTRAEGE.md`, `packages/schemas/src/**`, `services/core/src/db/schema/concepts.ts`, `services/core/drizzle/0011_*` | – | ist der Vertrag | A (Migration) | Fable plant, Opus prüft |
| **A4** | Vault-Schreiber: Konzeptnotiz, Vorlesungsnotiz, `_Fach.md`, atomar, Hash je Block, Konflikt als Inbox-Eintrag | `services/core/src/vault/**`, Aufrufe in `services/inbox.ts` und `services/summary.ts` (wenige Zeilen), Tests | A3 | §21 | **A**. Dateipfade, Überschreiben von Nutzertext | Sonnet baut, Opus reviewt, zweiter Opus als Gegen-Review |
| **A5** | Watcher (F-BIB-05): geändert, neu, gelöscht, umbenannt. Neue Abhängigkeit `chokidar` | `services/core/src/vault/watch*.ts`, Papierkorb-Kanten in `services/trash.ts` | A4 | §21, Abschnitt Rücklesen | **A, höchstes Risiko im Plan.** Schleife Schreiber ↔ Watcher, Löschen in Obsidian pausiert Karten und Konzepte | Sonnet baut, Opus reviewt, Gegen-Review |
| **A6** | `align.content` im Worker: Fenster, Ähnlichkeit, Viterbi, Übernahme im folienlosen Modus, Schritt in der Kette | `services/worker/src/sg_worker/handlers/align_content.py`, `services/core/src/services/pipeline.ts` (nur der Schritt), `PipelineStep` | – | Nachtrag §18: Payload, Ergebnis, wann der Schritt läuft | B bis A. Qualität ohne echten Datensatz nicht belegbar | Sonnet baut, Opus reviewt |
| **A7** | Folienkorrektur: Inbox-Art `slide_correction`, Vorher/Nachher, Grenzen von Hand verschieben (`source = manuell`), Notizseiten umhängen | `services/core/src/{routes,services}/inbox.ts`, neue Route für Segmente, `apps/web/src/components/{inbox,rueckblick}/**` | A6, A1 | `InboxKind`, Endpunkt für Segmente | A (hängt Notizseiten um) | Sonnet baut, Opus reviewt |
| **A8** | Geführte Nacharbeitung, Schritte 1, 2, 4, 6: `learn_session(kind=nacharbeitung)`, Fortsetzen, `explain.questions`, `review_state`, „Nacharbeitung bereit“ auf Heute | Core `services/learn-session.ts`, Worker `handlers/explain_questions.py`, Web `apps/web/src/app/nacharbeitung/**` | A4 für Schritt 6 | neuer Abschnitt: Tabelle `learn_session`, Zustand, Endpunkte | B. Ohne ❓-Marker vom iPad ist Schritt 1 fast leer (§3.1) | Fable plant, Sonnet baut, Opus reviewt |

**Parallel (höchstens 4 Agents, Reviewer mitgezählt):**

- Welle 1: A1 ‖ A2 ‖ A3
- Welle 2: A4 ‖ A6 (verschiedene Dienste)
- Welle 3: A5 ‖ A7
- Welle 4: A8

Nicht in A enthalten: F-BIB-03/-04 (Bearbeiten außerhalb der Inbox), Suche über Notizen und Fotos, `sheet.split`, Detektor, F-SES-06, F-INK-08/-12, Marker-Stempel und Foto am iPad. Das wären weitere 6 bis 8 Schnitte.

---

## 5. Variante B: Minimal-Lernen vorziehen

Ziel nach 10 §3: **Karten aus der Nacharbeitung plus FSRS-Wiederholung, ohne Planer.** Umfang bewusst klein:

- Kartentypen `basic` und `cloze`, Selbstbewertung 1 bis 4.
- Karten entstehen als Vorschlag (`card_batch`) je Konzept und von Hand.
- Eine Seite „Heute wiederholen“ mit Zeitbudget (Standard 20 min), ohne Rückstandszahl.
- **Nicht dabei:** Lernsitzung (F-LRN-04), KI-Bewertung, Fehleranalyse, übrige Kartentypen, Probeklausur, Readiness, Beherrschung, iPad-Wiederholung, Planer.

| # | Schnitt | Scope | Abhängig von | Vertrag vorher (Lead) | Risiko | Modell |
|---|---|---|---|---|---|---|
| **B0** | Vertrag „Karten und Wiederholung“ (neuer §21): Tabellen `card`, `card_state`, `review_log` nach 03 §9, Kartenformat nach 08 §6 (nur `basic`, `cloze`), `InboxKind = card_batch`, `PipelineStep = cards.generate`, Endpunkte, Fehlercodes, Abweichungen. Migration `0011_cards`, Schemas, Beispiele | `docs/VERTRAEGE.md`, `packages/schemas/src/learning.schema.json`, Ergänzungen in `concepts.schema.json` und `transcript.schema.json`, `services/core/src/db/schema/learning.ts`, `services/core/drizzle/0011_*` | – | ist der Vertrag. Offene Punkte siehe unten | A (Migration) | Fable plant, Opus prüft |
| **B1** | Worker `cards.generate`: Prompt, Ausgabeschema, Regelprüfung nach 05 §P10 (Länge, Belege Pflicht, Dubletten über Embedding, Lücke nur auf Fachbegriff), Fake-Regeln, Inbox-Eintrag je Konzept | `services/worker/src/sg_worker/handlers/cards_generate.py`, `services/worker/prompts/cards.generate/**`, eigene Teile in `ai/outputs.py` und `ai/llm_fake.py`, Tests | B0 | §21 Job und Regeln | B. Kartenqualität nur durch Owner prüfbar. Kosten je Vorlesung unbekannt | Sonnet baut, Opus reviewt |
| **B2** | Core Karten und FSRS: `ts-fsrs` (neue Abhängigkeit, in 02 (Bausteine) und 06 §1 vorgesehen), `learning/params.ts`, Tageswarteschlange mit Budget, `POST /cards/{id}/review` (idempotent, `card_state` und `review_log` in einer Transaktion), `GET /review/queue`, Karten lesen, bearbeiten, pausieren, löschen, Papierkorb-Kanten | `services/core/src/learning/**`, `services/core/src/{routes,services}/{cards,review}.ts`, in `services/trash.ts` nur die Kanten, Zeilen in `app.ts`, Tests | B0 | §21 Endpunkte, Formel der Reihenfolge | A (Löschen, Papierkorb, Zeitrechnung) | Sonnet baut, Opus reviewt |
| **B3** | Core Kette und Inbox: Schritt `cards.generate` nach `concepts.resolve`, `reprocess`, Annehmen und Verwerfen von `card_batch` je Karte, `JOB_PAYLOAD_SCHEMAS` | `services/core/src/services/pipeline.ts`, `services/core/src/{routes,services}/inbox.ts`, in `services/jobs.ts` nur das Schema | B0. **Merge erst nach B1** (wie T2-22a) | §21 Kette und Entscheidungen | A (Sperren, Inbox-Regeln) | Sonnet baut, Opus reviewt |
| **B4** | Web Lernen: `/lernen` mit „Heute wiederholen · ≈ n min“, Ablauf Frage → aufdecken → 1 bis 4 (Tasten), Quellen-Chip je Karte, Kachel auf Heute, Karten in der Konzeptansicht, Inbox-Zeile für `card_batch`, Schritt in der Schrittliste | `apps/web/src/app/lernen/**`, `apps/web/src/components/learn/**`, `apps/web/src/lib/cards.ts`, in `components/inbox/**` und `components/concepts/**` nur die Karten-Teile, `apps/web/test/fake-core.ts` | B0. Baut gegen Beispiele und Fake-Core | §21 Web-Eckpunkte | B | Sonnet baut, Opus reviewt (Logik der Sitzung) |
| **B5** | Karte von Hand: anlegen aus Konzeptansicht und aus einem Satz der Kurzfassung („Karte daraus“), mit Beleg | `apps/web/src/components/learn/CardEditor.tsx`, Aufrufstellen, `POST /cards` in B2-Dateien | B2, B4 | in §21 enthalten | B | Sonnet baut, Sonnet oder Opus reviewt |
| **B6** | Abschluss: Ende-zu-Ende-Test mit `SG_LLM=fake` (Session → Karten → Wiederholung), Anleitung `docs/anleitungen/LERNEN.md`, Prüfliste für den Owner (30 Karten bewerten, 05 §4) | `tests/`, `docs/anleitungen/` | B1 bis B4 | keiner | B | Sonnet baut, Sonnet reviewt die Doku |

**Parallel (höchstens 4 Agents, Reviewer mitgezählt):**

- Welle 0: B0. Daneben laufen A1 und A2 aus Variante A, weil sie nichts mit Karten teilen und den Rückblick sowie die Messbarkeit voranbringen.
- Welle 1: B1 ‖ B2 ‖ B4 (Worker, Core, Web; disjunkte Dateien)
- Welle 2: B3 (nach B1) ‖ B5 (nach B2 und B4)
- Welle 3: B6

**Was der Lead in B0 festlegen muss:**

1. **Wann entstehen Karten?** Vorschlag: in der Kette nach `concepts.resolve` für alle Konzepte der Session. Ein Kartenvorschlag wird in der Inbox erst sichtbar, wenn sein Konzept `aktiv` ist. Wird das Konzept verworfen, verfällt der Vorschlag.
2. **Lernschritte:** 06 §1 schließt Kurzzeit-Lernschritte über FSRS aus und verweist auf die Lernsitzung. Im Minimal-Lernen gibt es keine Lernsitzung. Vorschlag: Standard-Lernschritte von `ts-fsrs` nutzen und das als Abweichung festhalten.
3. **Reihenfolge:** 06 §3.2 braucht Wichtigkeit und Dringlichkeit, die es noch nicht gibt. Vorschlag: `(1 − R) · (1 + 0,1 · min(Überfälligkeit, 10))`, klausurrelevante Konzepte mit Faktor 1,5.
4. **Formeln:** KaTeX wäre eine neue Abhängigkeit im Web. Vorschlag: erst reiner Text (wie §20.10 für KI-Texte), KaTeX als eigener kleiner Schnitt danach.
5. **Budget:** Bei 100 % enden KI-Jobs mit Fehler (§20.13). Karten dürfen Transkript und Konzepte nicht verdrängen. Vorschlag: `cards.generate` bekommt die niedrigste Priorität der Kette und pausiert schon ab 80 %.
6. **Zeitzone und Tagesgrenze** der Fälligkeit (lokale Zeit des Macs, Tageswechsel 04:00).

---

## 6. Empfehlung

**Variante B jetzt, mit A1 und A2 als Beifang in Welle 0.**

Gründe:

1. **Wiederholung braucht Vorlauf.** FSRS hilft nur, wenn die Karten Wochen vor der Klausur im Umlauf sind. Jede Woche Verzug kostet Wiederholungen, die sich nicht nachholen lassen. Ein Vault lässt sich dagegen jederzeit nachliefern.
2. **Die Arbeit ist nicht verloren.** `cards.generate`, `card_batch` und die Kartentabellen braucht F-NAC-05 Schritt 5 ohnehin. B baut also ein Stück von Phase 2 und Phase 3 zugleich. Nur die vereinfachte Reihenfolge und die Lernschritte werden später ersetzt.
3. **Die Reste von Phase 2 helfen in der Klausur wenig.** Obsidian-Vault, Watcher und `align.content` verbessern Ablage und Genauigkeit, nicht das Behalten. Der Watcher ist zudem der riskanteste Schnitt im ganzen Plan.
4. **Die Grundlage steht.** B braucht Konzepte mit Belegen. Die liefert die Kette aus §20 schon.
5. **Umfang:** B sind 7 Schnitte in 4 Wellen, A sind 8 Schnitte in 4 Wellen und lässt danach noch 6 bis 8 offen.

**Was die Entscheidung kippt:**

| Befund | Folge |
|---|---|
| Prüfungsphase ist **mehr als etwa 16 Wochen** entfernt | A zuerst. Dann bleibt genug Zeit für Phase 3 in voller Form |
| Prüfungsphase ist **weniger als etwa 4 Wochen** entfernt | B noch schmaler: nur B0, B2, B4, B5 (Karten von Hand plus Wiederholung). B1 und B3 danach |
| Der erste echte Lauf der Konzept-Kette liefert **schlechte Konzepte** (Annahmequote unter 50 %, 05 §4) | Erst Prompt und Abgleich verbessern. Karten erben jeden Fehler der Konzepte. In der Zeit A1, A2 und B0, B2, B4 (Karten von Hand) bauen |
| Der Owner lernt **in Obsidian oder mit einem anderen Kartenprogramm** | A3 und A4 (Vault) vorziehen, B streichen oder auf einen Export beschränken |
| Die Transkription auf dem Mac dauert **deutlich länger als 15 min** (S5) oder der Mac hat zu wenig Speicher (#203) | Vor beidem die Frage Cloud-Transkription klären (#204). Ohne Transkript gibt es weder Konzepte noch Karten |

**Unabhängig von der Variante:** Der größte Mangel ist kein fehlendes Feature. Es gibt keinen belegten Lauf mit einer echten Vorlesung, weder für Phase 1 noch für die Kette aus Phase 2. Ein ausgefülltes Protokoll und ein echter Konzept-Lauf sagen mehr über die nächsten Schnitte als jeder weitere Plan.

---

## 7. Fragen an den Owner

Die Fragen gehören nach §4a als Issues mit Label `entscheidung` in #188. Diese Datei legt sie nicht an.

1. **#207, weiter offen:** Wann beginnt die Prüfungsphase ungefähr? *Empfehlung: Ohne Antwort baue ich B.*
2. **Womit lernst du heute?** Eigene Karten in der App, Obsidian, ein anderes Kartenprogramm oder Zusammenfassungen? *Empfehlung: Karten in der App (B). Bei Obsidian ziehe ich den Vault vor.*
3. **Ein echter Lauf vor dem Kartenbau:** Eine aufgenommene Vorlesung durch die ganze Kette schicken (Anleitung in den Kommentaren von #188) und Laufzeit sowie Eindruck der Konzepte in #188 eintragen. *Empfehlung: ja, vor Welle 1. Das ist der eine Test, der die Reihenfolge ändern kann.*
4. **Marker-Stempel und Tafel-Foto am iPad** fehlen noch (T1-15). Brauchst du ❓-Marker beim Schreiben am iPad, oder reichen die Marker am Mac? *Empfehlung: Stempel nachziehen, Foto später. Ohne ❓ ist die geführte Nacharbeitung dünn.*

---

## 8. Hinweise zum Plan

- **Agents parallel:** Der Auftrag nennt höchstens 4, `docs/KOLLABORATION.md` §4a nennt 3 einschließlich Reviewern (#277). Die Wellen oben haben höchstens 3 Autoren. Gilt weiter die 3, läuft in Welle 1 der Reviewer erst, wenn ein Autor fertig ist.
- **Review-Stufen:** B0, B2, B3, A3, A4, A5 und A7 sind Stufe A (Migration, Löschen, Dateipfade, Sperren). A4 und A5 bekommen ein Gegen-Review.
- **Neue Abhängigkeiten:** `ts-fsrs` (B2), `chokidar` (A5), später KaTeX. Alle drei stehen in der Spezifikation, brauchen aber die Begründung im PR (AGENTS.md Regel 9).
- **Offene Nachträge aus #324** (`also_changed`, `from_name`/`to_name`, Rückgängig nach A2) berühren `inbox.ts`. Sie sollten vor B3 bzw. A7 entschieden sein, sonst kollidieren die Änderungen.
