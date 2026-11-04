# 05 · KI-Pipeline

## 1. Grundsätze

| Grundsatz | Umsetzung |
|---|---|
| **Jobs sind idempotent** | Ein Job darf beliebig oft laufen und erzeugt dasselbe Ergebnis. Er ersetzt seine eigenen früheren Ergebnisse (erkennbar an `job_type` + Eingabe-Hash), nie die bestätigten Daten des Nutzers. |
| **Vorschlag statt Tatsache** | Ergebnisse, die das Wissensnetz verändern (Konzepte, Beziehungen, Karten, Folienkorrekturen), werden **Inbox-Vorschläge**. Ausnahmen: Transkript, Ausrichtung mit Log, Embeddings, Suchindex. |
| **Belege sind Pflicht** | Jede erzeugte Aussage trägt Verweise (Folie, Transkript-Zeitraum, Notiz-Bereich, Aufgabe). Ausgaben ohne Belege werden verworfen (LP8). |
| **Strukturierte Ausgaben** | Jede LLM-Aufgabe hat ein Pydantic-Schema. Ungültige Ausgaben werden einmal mit Fehlermeldung nachgefordert, danach scheitert der Job sichtbar. |
| **Versionierte Prompts** | Prompts liegen als Dateien in `services/worker/prompts/<task>/v<n>.md`. Die Version wird im Ergebnis gespeichert. |
| **Sprache** | Ausgaben in der Sprache der Vorlesung. Fachbegriffe in der Konzeptnotiz zusätzlich in der anderen Sprache (`aliases`). |
| **Kosten** | Jeder Cloud-Aufruf schreibt `cost_entry`. Große Eingaben werden vorher gekürzt (nur relevante Folien/Abschnitte). |
| **Reihenfolge** | Abhängigkeiten über `job.depends_on`. Priorität: Transkription > Ausrichtung > alles für die Nacharbeitung > Karten > Videos. |

## 2. Job-Ablauf

**Nach dem Hochladen eines Foliensatzes**
```
pdf.ingest ─► embed.slides ─┬─► match.tasks_slides     (wenn Übungsblatt vorhanden)
                            ├─► prereq.check           (wenn Session in der Zukunft)
                            └─► align.content          (wenn Session schon aufgenommen, ohne/mit lückenhaftem Log)
```

**Nach dem Hochladen eines Übungsblatts:** `sheet.split ─► embed.tasks ─► match.tasks_slides`

**Nach dem Ende einer Session**
```
audio.finalize ─► transcribe ─► align.log ─┬─► align.content (Prüfung/Korrektur, F-NAC-03)
                                           ├─► detect.exam_hints (○)
                                           ├─► ocr.photos
                                           └─► concepts.extract ─► concepts.resolve ─┬─► summary.write
                                                                                     ├─► cards.generate
                                                                                     ├─► cornell.questions
                                                                                     ├─► explain.questions (❓-Marker)
                                                                                     └─► vault.write
search.index läuft nach jedem Schritt, der Text erzeugt.
```

Die Session-Ansicht zeigt den Fortschritt als Schrittliste (`session.processing`), ruhig und ohne Prozentbalken-Hektik.

---

## 3. Schritte im Detail

### P1 · `pdf.ingest` – Folien einlesen
- **PyMuPDF:** pro Seite PNG mit 2× Auflösung (max. 2400 px Breite), Vorschaubild 320 px, Textlayer, Textblöcke mit Bounding-Box, Schriftgrößen.
- **Titel:** größter Textblock im oberen Drittel. **Kapitel:** Folien mit wenig Text und großem Titel gelten als Kapiteltrenner.
- **Kein oder kaum Textlayer** (< 20 Zeichen) **oder Grafikanteil > 50 %:** Vision-Aufruf (`fast`) mit dem Folienbild. Ergebnis: „Beschreibe Inhalt, Beschriftungen und Aussage der Folie in 2–5 Sätzen", gespeichert als `vision_summary`.
- **Embedding-Text pro Folie:** `Titel + Text + vision_summary`, gekürzt auf 512 Tokens.

### P2 · `sheet.split` – Übungsblatt zerlegen
- Heuristik zuerst: Muster wie `Aufgabe 1`, `1.`, `a)`, `(b)`, `Exercise 2`, Einrückung, Fettdruck.
- Bei unklarer Struktur LLM (`fast`) mit Seitentext: Ausgabe `[{label, text, page_index, start_char, end_char}]`.
- Musterlösung (F-ORG-05) wird gleich zerlegt und per Label zugeordnet. Fehlen Labels, erfolgt die Zuordnung über Ähnlichkeit.

### P3 · `match.tasks_slides` – Folie ↔ Übung
1. Pro Aufgabe die Top 8 Folien nach Cosinus-Ähnlichkeit der Embeddings, nur Foliensätze desselben Moduls.
2. LLM (`fast`) mit Aufgabentext und den 8 Kandidaten (Titel + Text, ggf. Vision-Zusammenfassung). Ausgabe pro Kandidat: `relevance 0..1` und ein Satz `reason` („liefert die Definition der 3NF").
3. Speichern bei `relevance ≥ 0,6`, höchstens 3 pro Aufgabe (`source = auto`).
4. Läuft erneut, wenn ein neuer Foliensatz des Moduls hochgeladen wird (spätere Vorlesungen können besser passen).

### P4 · `transcribe` – Transkription
- **Standard:** `mlx-whisper` mit `large-v3-turbo`, Sprache automatisch. Bei `module.lang = mixed` ohne festgelegte Sprache, mit Wort-Zeitstempeln. Die Wörter werden für die Ausrichtung gebraucht.
- **Vokabular-Hinweis** (`initial_prompt`): Folientitel und die 50 häufigsten Fachbegriffe des Moduls, verbessert Fachwörter deutlich.
- **Nachbearbeitung:** Segmente auf Satzgrenzen zusammenführen (Länge 5–30 s). Halluzinationen bei Stille entfernen: Segmente mit `no_speech_prob > 0,6` oder wiederholtem identischem Text.
- **Ziel:** 90 min Audio in ≤ 15 min auf einem M-Prozessor.

### P5a · `align.log` – Ausrichtung über das Folienwechsel-Log
- Folienzeitleiste aus `slide_event`: Wechsel unter 1,5 s Standzeit zählen als Durchgang.
- Transkript-Segmente werden nach Zeit den Folien zugeordnet. Ein Segment über einer Grenze wird an der Wortgrenze geteilt.
- Ergebnis `slide_segment` mit `source = log`, `confidence = 1,0`.

### P5b · `align.content` – Ausrichtung über den Inhalt (F-NAC-03)
Für den folienlosen Modus und zur Prüfung des Logs.

1. **Fenster:** Transkript in Fenster von 30 s mit 10 s Schritt. Pro Fenster ein Embedding.
2. **Ähnlichkeitsmatrix** `E[w][s]` = Cosinus(Fenster w, Folie s). Bonus +0,1, wenn ein Folientitel-Begriff wörtlich im Fenster vorkommt.
3. **Viterbi über Folien** mit Übergangskosten:
   - auf derselben Folie bleiben: 0
   - zur nächsten Folie: `λ_next = 0,05`
   - Sprung um `d` Folien: `λ_jump = 0,15 + 0,02·|d|`
   - Mindestdauer eines Segments: 20 s (kürzere werden mit dem Nachbarn verschmolzen)
4. **Mit Log:** Das Log wirkt als Vorwissen. Bonus +0,2 für die laut Log aktive Folie.
5. **Konfidenz pro Segment** = mittlerer Abstand zwischen bester und zweitbester Folie.
6. **Vergleich mit Log:** Weicht die Inhalts-Ausrichtung über ≥ 3 min zusammenhängend vom Log ab, wird ein Inbox-Vorschlag `slide_correction` erzeugt, mit Vorher/Nachher und betroffenen Notizseiten. Ohne Log wird das Ergebnis direkt übernommen (`source = ausrichtung`).
7. **Notizseiten:** Freie Seiten werden der Folie zugeordnet, die zum Zeitpunkt ihres ersten Strichs lief (`attached_slide_id` aktualisieren).

**Qualitätsziel:** ≥ 85 % zeitliche Übereinstimmung mit dem wahren Log (Testdatensatz, Kap. 09 §6).

### P6 · `ocr.photos` – Tafel-Fotos
Vision-Aufruf (`fast`): Text der Tafel erkennen, Formeln als LaTeX, kurze Beschreibung von Skizzen. Ergebnis in `photo.ocr_text`, geht in den Suchindex. Handschrift auf Notizseiten (P2): eigener Job `ocr.ink` mit gerenderter Seite.

### P7a · `concepts.extract` – Konzepte einer Vorlesung finden
- **Eingabe pro Vorlesung:** Folien (Titel, Text, Vision-Zusammenfassung), Transkript je Folie (gekürzt auf das Wesentliche, max. ca. 600 Wörter pro Folie), ❓- und ⚠️-Marker mit Zeit, OCR-Text der Fotos. Bei langen Vorlesungen erfolgt die Verarbeitung in Kapiteln, danach eine Zusammenführung.
- **Modellstufe:** `standard`.
- **Ausgabe (Schema):**
  ```json
  { "concepts": [ {
      "name": "Normalisierung (Datenbanken)",
      "aliases": ["Normalization"],
      "one_liner": "…",
      "kind": "definition | verfahren | modell | satz | beispiel",
      "slide_indices": [14,15,16],
      "transcript_ranges_ms": [[2512000, 2730000]],
      "importance": 1-3,
      "exam_hint": false,
      "prof_explanation": "Kernaussage des Profs in 1–2 Sätzen" } ],
    "relations": [ {"from":"…","to":"…","kind":"baut_auf","why":"…"} ] }
  ```
- **Vorgaben im Prompt:**
  - Konzepte sind *lernbare Einheiten*, nicht jede Überschrift.
  - Typisch sind 5–15 pro 90 min.
  - Beispiele sind nur dann eigene Konzepte, wenn sie wiederverwendet werden.
  - Was der Prof mündlich ergänzt, steht in `prof_explanation`.

### P7b · `detect.exam_hints` ○ – Klausurhinweise
1. Regelbasierte Kandidaten im Transkript, Deutsch/Englisch, z. B.: *klausur, prüfung, kommt dran, sollten Sie können, wichtig für, merken Sie sich, typische Aufgabe, exam, will be tested, make sure you know*. Ausschlussliste aus verworfenen Treffern (F-NAC-07).
2. LLM (`fast`) prüft jeden Kandidaten mit ±45 s Kontext: Ist das ein Klausurhinweis? Auf welches Thema bezieht er sich?
3. Treffer → `marker(kind=klausur, source=detektor)`. Bezug auf ein Konzept → `exam_relevant = true`.

### P8 · `concepts.resolve` – Abgleich mit dem Wissensnetz
Für jedes extrahierte Konzept:
1. Embedding von `name + aliases + one_liner`.
2. Nächste vorhandene Konzepte, **über alle Fächer und Semester** (LP10):
   - Ähnlichkeit ≥ 0,88 **und** gleicher Name oder Alias → **dasselbe Konzept.** Belege werden ergänzt, automatisch.
   - 0,75–0,88 → LLM-Entscheidung (`standard`): gleich / Teil von / verwandt / verschieden. Ergebnis als Inbox-Vorschlag `concept_merge` oder `relation`.
   - < 0,75 → **neues Konzept** (Inbox-Vorschlag `concept_new`).
3. **Beziehungen** zu den 20 nächsten vorhandenen Konzepten werden vom LLM vorgeschlagen (Typ + Begründung) und zyklusgeprüft (Invariante 4).
4. **Fächerbrücken** (F-BIB-09): Beziehungen zu Konzepten anderer Fächer bekommen eine Kennzeichnung für die Anzeige.

### P9 · `summary.write` und `vault.write`
- **Zusammenfassung (`standard`):** 5 Sätze + Gliederung, jeder Satz mit Belegen. Wird zur Vorlesungsnotiz.
- **Vault:** Konzeptnotizen nach Vorlage (Kap. 08 §8). Nur App-Abschnitte werden geschrieben. Neue Konzepte erst nach Annahme in der Inbox (oder `automatisch annehmen`). Vorlesungsnotiz und `_Fach.md` werden aktualisiert.

### P10 · `cards.generate` – Karten erzeugen
- **Eingabe:** Konzept (Notiz, Belege mit Text), Aufgaben des Moduls mit Bezug zum Konzept, vorhandene Karten des Konzepts, Altklausur-Stil (falls vorhanden).
- **Modellstufe:** `standard`.
- **Regeln (im Prompt und als Prüfung danach):**
  1. **Eine Sache pro Karte.** Vorderseite ≤ 25 Wörter, Antwort ≤ 40 Wörter (außer `calc`, `relation`).
  2. Verteilung: mind. 1 Karte Stufe 2. Bei Verfahren/Modellen mind. 1 Karte Stufe 3 (Anwendung, angelehnt an die Übungsaufgaben). Bei Konzepten mit `baut_auf`/`gegensatz`-Beziehungen 1 Karte Stufe 4.
  3. **MC-Ablenker** kommen aus verwandten oder verwechselbaren Konzepten, keine offensichtlich falschen Optionen.
  4. **Lückentext** nur auf bedeutungstragende Begriffe, nie auf Füllwörter.
  5. **Belege** sind Pflicht: Folie oder Transkript-Zeitraum, aus dem die Antwort stammt.
  6. **Keine Dubletten:** Embedding der Vorderseite gegen vorhandene Karten des Konzepts. Bei Ähnlichkeit > 0,92 verwerfen.
  7. ❓-Marker zum Konzept → mindestens eine Karte genau zu dieser Unklarheit.
  8. Sprache der Vorlesung. Fachbegriff in Klammern zweisprachig, wenn die Folie anders ist als die Sprache des Profs.
- **Ausgabe:** Gruppe als Inbox-Vorschlag `card_batch`.

### P11 · `prereq.check` – Voraussetzungen der nächsten Vorlesung
1. Konzepte der kommenden Folien mit P7a im **Schnellmodus** (`fast`, nur Folien) bestimmen und mit P8 abgleichen (ohne Inbox, nur Lesezugriff).
2. Voraussetzungen = vorhandene Konzepte, auf die diese aufbauen (`baut_auf`, zwei Stufen tief), plus LLM-Einschätzung „setzt diese Folie Wissen über X voraus?" für Kandidaten aus der Ähnlichkeitssuche.
3. Ergebnis an den Planer (F-PLN-03): Liste `(concept_id, mastery, why)`.

### P12 · `past_exam.analyze` – Altklausuren
Zerlegen wie P2. Pro Frage: Punkte, Stil (rechnen/definieren/erklären/anwenden/MC) und Konzepte (Abgleich mit P8, nur Lesezugriff). Daraus pro Fach Themengewichte und Stilverteilung (F-LRN-15).

### P13 · `video.v0` – Vorlesungs-Clips
Pro Konzept: Zeiträume aus Belegen (`transcript`) mit ±10 s Rand, zusammengefügt in Zeitreihenfolge, Lücken > 2 min werden geschnitten. Bild = jeweils aktive Folie (`slide_segment`). `ffmpeg`: Standbilder + Audio → H.264/AAC 1080p, Kapitel je Folie. Keine LLM-Kosten.

### P14 · `video.v1` – Recap
1. Skript (`standard`) aus Zusammenfassung und Konzepten, 700–1 300 Wörter, in Szenen gegliedert. Jede Szene hat: gesprochener Text, Folie, hervorzuhebende Textblöcke (IDs aus `text_blocks`), Einblendtext, Belege.
2. TTS pro Szene.
3. Remotion-Komposition: Folie, animierte Rahmen um die Textblöcke, Einblendungen, Untertitel aus dem Skript.
4. Render 1080p.

### P15 · `video.v2` – Schwächen-Video
Wie P14, aber 300–550 Wörter, Eingabe zusätzlich:
- `error_record` des Konzepts (häufigste Fehlertypen, verwechselte Konzepte)
- Voraussetzungen mit niedriger Beherrschung
- Fächerbrücken
- Aufgaben, an denen ich gescheitert bin

**Vorgabe:** *Erkläre anders als die Folie* (neues Beispiel, Analogie, Schritt für Schritt) und *benenne meine Fehler ausdrücklich*. Danach erzeugt der Job 3 Prüffragen (Stufe 2–3), die nach dem Video gestellt werden.

### P16 · Bewertung und Fehleranalyse
- **`grade.open`** (`fast`, Ziel < 3 s): Antwort, Musterantwort, Kriterien → `{rating_suggestion 1–4, missing_points[], short_feedback}`.
- **`grade.analyze_error`** (`fast`): bei falscher Antwort → `{kind, explanation, confused_with}` (Fehlertypen siehe 03 §9).

### P17 · Feynman und Lösungsvergleich
- **`feynman.evaluate`** (`standard`): meine Erklärung, Konzeptnotiz und Belege → `{good[], missing[{point, evidence}], wrong[{claim, correction, evidence}], unexplained_terms[], card_suggestions[]}`.
- **`solution.compare`** (`standard`, mit Bild der handschriftlichen Lösung): Teilschritte gegenüberstellen → `{steps[{mine, reference, verdict, error_kind, concept}]}`.

### P18 · `search.index`
Texte in `search_chunk` schreiben: Folien (je Folie), Transkript (Abschnitte von ca. 60 s), Notiz-OCR, Aufgaben, Konzeptnotizen (je Abschnitt), Karten. Jeweils mit `tsvector` (Sprachkonfiguration nach `lang`) und Embedding.

### P19 · `rag.answer` – Frag deine Vorlesung
Hybridsuche (Top 30) → Neusortierung nach Ähnlichkeit zur Frage → Top 12 als Kontext mit IDs → LLM (`standard`) mit der Vorgabe: *Nur aus dem Kontext antworten, jede Aussage mit [ID] belegen, sonst sagen, dass nichts gefunden wurde.* Antworten ohne Belege werden nicht angezeigt, stattdessen „Dazu habe ich in deinem Material nichts gefunden".

---

## 4. Qualitätssicherung der Pipeline

| Prüfung | Wann | Grenzwert |
|---|---|---|
| Schema-Validierung jeder LLM-Ausgabe | immer | 100 % gültig, sonst Job-Fehler |
| Belegprüfung: verwiesene IDs existieren, Zeiträume liegen in der Session | immer | Aussagen ohne gültigen Beleg werden verworfen |
| **Goldener Testdatensatz:** 3 aufgenommene Vorlesungen mit Folien, Log, handgeprüften Konzepten und Karten (Kap. 09 §6) | bei jeder Prompt- oder Modelländerung | Ausrichtung ≥ 85 % · Konzept-Trefferquote ≥ 80 % · Kartenqualität (Stichprobe 30 Karten, Nutzerurteil „würde ich behalten") ≥ 75 % |
| Annahmequote in der Inbox | laufend, lokal | Sinkt sie bei einer Aufgabe unter 50 %, wird der Prompt überarbeitet |
