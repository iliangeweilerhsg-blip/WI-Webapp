# Lernmodell: FSRS, Beherrschung und Klausur-Readiness

## 1. Was ist FSRS?

**FSRS** steht für *Free Spaced Repetition Scheduler*. Das ist ein offener Algorithmus, der entscheidet, **wann** ich eine Karteikarte wiedersehen sollte. Ziel: Die Karte kommt genau dann, wenn ich kurz davor bin, sie zu vergessen. So lerne ich mit möglichst wenigen Wiederholungen möglichst viel dauerhaft. FSRS ist seit 2023 der Standard-Algorithmus in Anki und hat dort das alte SM-2-Verfahren ersetzt. In Vergleichstests braucht er für dieselbe Behaltensleistung deutlich weniger Wiederholungen.

### Die drei Größen pro Karte (das „DSR-Modell")

| Größe | Bedeutung | Beispiel |
|---|---|---|
| **R – Abrufwahrscheinlichkeit** | Wie wahrscheinlich weiß ich die Antwort *genau jetzt*? Sinkt mit der Zeit. | 0,93 = 93 % |
| **S – Stabilität** | Nach wie vielen Tagen ist R auf 90 % gefallen? Je öfter ich die Karte erfolgreich abrufe, desto größer. | 12 Tage |
| **D – Schwierigkeit** | Wie schwer ist die Karte *für mich*? (1–10) Schwere Karten gewinnen pro Wiederholung weniger Stabilität. | 7,2 |

**Vergessenskurve:** R fällt nach einer Potenzfunktion der vergangenen Zeit `t`. Bei `t = S` ist R per Definition 90 %.

### Ablauf einer Wiederholung

1. Ich sehe die Frage und beantworte sie.
2. Ich bewerte mich mit **Nochmal / Schwer / Gut / Leicht**. Bei offenen Fragen schlägt die KI eine Bewertung vor.
3. FSRS aktualisiert D und S. „Nochmal" senkt S stark, „Gut" vervielfacht S.
4. Die nächste Fälligkeit wird so gelegt, dass R zu diesem Zeitpunkt auf die **Zielbehaltensquote** fällt (Standard 90 %).

### Warum FSRS für uns gut ist

- **R ist für jeden Zeitpunkt berechenbar**, auch für den Klausurtag. Darauf baut unsere Klausur-Readiness auf.
- **Die Parameter passen sich an mich an:** Ab einigen hundert Wiederholungen optimiert FSRS seine Gewichte auf *meine* Vergessenskurve.
- **Die Zielbehaltensquote ist einstellbar:** im Alltag 90 %, kurz vor der Klausur höher.
- Fertige Bibliotheken gibt es für TypeScript (`ts-fsrs`) und Python (`py-fsrs`).

---

## 2. Unsere Erweiterungen auf FSRS

FSRS kennt nur einzelne Karten. Wir denken in **Konzepten** und **Klausuren**.

### 2.1 Lernstufen pro Konzept

Ein Konzept „sitzt" erst, wenn es auf mehreren Stufen abgefragt wurde (angelehnt an den Lernmodus von Quizlet und an Bloom):

| Stufe | Fragetyp | Gewicht |
|---|---|---|
| 1 · Erkennen | Multiple Choice, Wahr/Falsch | 1 |
| 2 · Abrufen | Karteikarte, Lückentext, Definition frei | 2 |
| 3 · Anwenden | Rechenaufgabe, Fallbeispiel, Übungsaufgabe | 3 |
| 4 · Verknüpfen | „Erkläre den Zusammenhang zwischen A und B", Feynman-Modus | 3 |

Neue Konzepte starten auf Stufe 1–2. Höhere Stufen werden freigeschaltet, sobald die unteren stabil sind.

### 2.2 Beherrschung eines Konzepts (0–100 %)

```
Beherrschung(K) = Σ (R_karte × Gewicht_stufe) / Σ Gewicht_stufe     über alle Karten von K
```
- Fehlen höhere Stufen ganz, wird die Beherrschung gedeckelt (z. B. maximal 60 % ohne Anwendungsfrage).
- Bei wenigen Daten zeigt die App die Beherrschung mit **Unsicherheit** an („~50 %, wenig Daten").

### 2.3 Wichtigkeit eines Konzepts

```
Wichtigkeit(K) = Basis
               + Klausurhinweis (⚠️ vom Prof oder Detektor)
               + Häufigkeit in Altklausuren
               + Anzahl Konzepte, die auf K aufbauen   (Graph)
               + meine ❓-Marker
```

### 2.4 Schwächen-Score

```
Schwäche(K) = Wichtigkeit(K) × (1 − Beherrschung(K)) × Dringlichkeit(K)
```
**Dringlichkeit** steigt, wenn eine Klausur naht oder die nächste Vorlesung auf K aufbaut. Die Konzepte mit dem höchsten Schwächen-Score bekommen **Schwächen-Sessions** und **V2-Lernvideos**.

### 2.5 Klausur-Readiness pro Fach

```
Readiness(Fach, Datum) = Σ Wichtigkeit(K) × R_K(Datum) / Σ Wichtigkeit(K)    über klausurrelevante Konzepte
```
- `R_K(Datum)` ist die mit FSRS **vorhergesagte** Abrufwahrscheinlichkeit am Klausurtag.
- Die Anzeige zeigt zwei Werte: **„heute"** und **„am Klausurtag, wenn ich den Plan einhalte"**.
- Darunter stehen die **5 Konzepte, die am meisten Readiness kosten**. Das ist direkt die To-do-Liste.

### 2.6 Klausurmodus

- 2–3 Wochen vor der Klausur steigt die Zielbehaltensquote für das Fach, z. B. von 0,90 auf 0,95.
- **Kein Intervall springt über den Klausurtag:** Eine Karte, die erst nach der Klausur fällig wäre, wird vorher noch einmal eingeplant, wenn ihr R am Klausurtag unter dem Ziel läge.
- Nach der Klausur fällt das Fach in den **Erhaltungsmodus** mit niedrigerer Zielquote und wenigen Wiederholungen.

### 2.7 Fehleranalyse

Jede falsche Antwort bekommt einen **Fehlertyp**, damit die App weiß, *wie* sie helfen soll:

| Fehlertyp | Reaktion |
|---|---|
| Begriff verwechselt | Kontrast-Karte „A vs. B" |
| Voraussetzung fehlt | Voraussetzungs-Konzept wird nach vorne geholt |
| Rechen-/Verfahrensfehler | Schritt-für-Schritt-Aufgabe, Lösungsweg im Lernvideo |
| Nur auswendig gelernt (Abrufen ok, Anwenden falsch) | Mehr Fragen der Stufen 3 und 4 |
| Flüchtigkeit | Keine Änderung, nur erneute Wiederholung |
