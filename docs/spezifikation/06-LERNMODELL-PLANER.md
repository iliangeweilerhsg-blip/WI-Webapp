# 06 · Lernmodell & Planer

Hintergrund und Begründung: `docs/LERNMODELL.md`. Dieses Kapitel legt die verbindlichen Formeln, Parameter und Abläufe fest. Alle Parameter sind Konstanten in `services/core/src/learning/params.ts` und über Tests abgesichert.

## 1. FSRS-Einbindung

| Punkt | Festlegung |
|---|---|
| Bibliothek | `ts-fsrs` im Core (Planung), `py-fsrs` im Worker (nur Optimierer) |
| Startparameter | Standardgewichte der Bibliothek |
| Zielbehaltensquote | `0,90` (Einstellung). Pro Modul überschreibbar, im Klausurmodus automatisch (§3.3) |
| Maximales Intervall | 365 Tage (Erhaltungsmodus: 730) |
| Zufallsstreuung | an (verteilt Fälligkeiten, verhindert Klumpen) |
| Kurzzeit-Lernschritte | **nicht** über FSRS, sondern über die Lernsitzung (F-LRN-04). Danach bekommt die Karte ihren ersten FSRS-Zustand. |
| Optimierer | Monatlich, sobald ≥ 400 Reviews vorliegen. Neue Gewichte werden nur übernommen, wenn der Log-Loss auf den letzten 20 % der Reviews besser ist als mit den alten. |
| Bewertung | 1 Nochmal · 2 Schwer · 3 Gut · 4 Leicht. Bei automatisch bewerteten Typen: richtig → 3, fast richtig → 2, falsch → 1. Schnell und richtig (< 40 % der eigenen Median-Zeit) → 4. |

**Abrufwahrscheinlichkeit einer Karte** `R_c(t)` nach der FSRS-Vergessenskurve aus Stabilität `S` und vergangener Zeit. Für jeden Zeitpunkt berechenbar, auch in der Zukunft.

## 2. Kennzahlen

### 2.1 Beherrschung eines Konzepts

```
Stufengewicht:  w(1)=1   w(2)=2   w(3)=3   w(4)=3

Mastery(K, t) = Σ_c w(stage_c) · R_c(t) · a_c  /  Σ_c w(stage_c) · a_c
                über alle nicht pausierten Karten c von K
                a_c = 1 für Karten mit mind. einem Review, 0,5 für neue (R_c = 0)
```

**Deckel** (Lernstufen, verhindert Scheinwissen):
- keine Karte der Stufe ≥ 2 je richtig beantwortet → max. 0,30
- Konzeptart `verfahren` oder `modell` und keine Stufe-3-Karte je richtig → max. 0,60

**Konzept ohne Karten:** Mastery = `null`, Anzeige „noch nicht abgefragt".

### 2.2 Unsicherheit

```
n = Anzahl Reviews der Karten von K in den letzten 60 Tagen
Uncertainty(K) = 0,5 / sqrt(1 + n)
```
- Anzeige als Band `Mastery ± Uncertainty`.
- Bei `n < 5`: Zusatz „wenig Daten".

### 2.3 Wichtigkeit

```
Importance(K) = 1,0
              + 1,0 · exam_relevant(K)
              + min(1,5 ; 0,5 · Anzahl ⚠️-Marker mit Bezug zu K)
              + 2,0 · PastExamShare(K)             (Punkteanteil in Altklausuren, 0..1, je Modul normiert)
              + 0,3 · ln(1 + Anzahl Konzepte, die auf K aufbauen)
              + min(0,9 ; 0,3 · Anzahl offener ❓ zu K)
```

### 2.4 Dringlichkeit und Schwächen-Score

```
Urgency(K) = 1
           + 2 · exp(−Tage bis zur nächsten Prüfung eines Moduls von K / 14)
           + 1,5 · [eine Vorlesung in den nächsten 72 h baut auf K auf]

Weakness(K) = Importance(K) · (1 − Mastery(K, jetzt)) · Urgency(K)
```

Konzepte ohne Karten gehen mit `Mastery = 0,3` ein (unbekannt ≠ beherrscht).

### 2.5 Klausur-Readiness

```
Readiness(M, d) = Σ_K Importance(K) · Mastery_pred(K, d)  /  Σ_K Importance(K)
                  über alle Konzepte K von Modul M mit exam_relevant ODER Beleg aus M
```

Zwei Varianten:
- **ohne weiteres Lernen:** `Mastery_pred` mit `R_c(d)` aus dem heutigen Zustand.
- **mit Plan:** Für jede bis `d` geplante Wiederholung einer Karte wird der Zustand vorausgerechnet als Erwartungswert:
  ```
  R_plan(d) = p · R_nach_Gut(d) + (1 − p) · R_nach_Nochmal(d)
  p = R_c(Zeitpunkt der geplanten Wiederholung)
  ```
  Karten ohne geplante Wiederholung bleiben auf dem heutigen Zustand.

Angezeigt werden `Readiness(M, heute)` und `Readiness_Plan(M, Klausurtag)`, jeweils ± mittlere Unsicherheit. Die **5 größten Hebel**: Konzepte mit dem größten Beitrag `Importance · (1 − Mastery_pred)`.

### 2.6 Tägliche Schnappschüsse
Ein nächtlicher Job schreibt `mastery_snapshot` für jedes Konzept mit Änderung. Grundlage für Verläufe in Konzeptansicht und Wochenrückblick.

## 3. Wiederholung

### 3.1 Zeitbudget
- Tagesbudget `review_budget_minutes` (Standard 20).
- Geschätzte Dauer pro Karte aus meinem Median der letzten 200 Reviews des Typs.
- Startwerte: `mc` 10 s · `basic/reverse/tape/image_occlusion` 12 s · `cloze` 20 s · `open` 45 s · `relation` 60 s · `calc` 90 s.

### 3.2 Reihenfolge und Lastausgleich
```
Priority(c) = (1 − R_c(jetzt)) · Importance(K_c) · Urgency(K_c) · (1 + 0,1 · min(Überfälligkeit in Tagen, 10))
```
- Die Tageswarteschlange nimmt die Karten mit höchster Priorität, bis das Budget voll ist.
- Der Rest bleibt fällig. Die Anzeige zeigt **keinen Rückstand**, nur den heutigen Block.
- Liegt die fällige Menge 3 Tage in Folge über 150 % des Budgets, schlägt das Tagesbriefing einmal vor, das Budget vorübergehend zu erhöhen oder neue Karten zu pausieren.
- **Mischung:** Aufeinanderfolgende Karten möglichst aus verschiedenen Konzepten (verschachteltes Üben), außer in der Lernsitzung.

### 3.3 Klausurmodus
Ab `exam.starts_at − 21 Tage` (Einstellung) für alle Karten von Konzepten des Moduls:
- Zielbehaltensquote `0,95`
- **Kein Sprung über den Klausurtag:** Liegt nach einem Review die neue Fälligkeit nach dem Klausurtag und wäre `R_c(Klausurtag) < 0,90`, wird die Fälligkeit auf `Klausurtag − 2 Tage` gesetzt, frühestens morgen.
- Readiness-Ansicht und Planer gewichten das Modul stärker (§4.3).

### 3.4 Erhaltungsmodus
Nach der letzten Prüfung eines Moduls: Zielbehaltensquote `0,80`, maximales Intervall 730 Tage. Konzepte, auf die Module des nächsten Semesters aufbauen, behalten `0,90`.

## 4. Planer

### 4.1 Eingaben
- **Belegte Zeiten:** alle `calendar_event` (Vorlesung, Übung, Tutorium, Prüfung, fest) plus Google-Kalender (F-KAL-03).
- **Präferenzen** (`preferences`): Lernfenster je Wochentag (Standard Mo–Fr 08:00–20:00, Sa 10:00–16:00), Hochleistungszeiten, Tagesmaximum (120 min), Blockgrenzen (10–50 min), freie Tage, Puffer vor Vorlesungen (10 min), „leicht ab" (20:00).
- **Lernstand:** fällige Karten, Weakness, Readiness, Sessions mit offenem `review_state`, Abgaben, Prüfungen.

**Freie Slots** = Lernfenster − belegte Zeiten − Puffer. Slots unter 10 min fallen weg.

### 4.2 Aufgaben erzeugen (Horizont 14 Tage)

| Aufgabe | Dauer | Frühester Start | Frist | Teilbar | Basis-Priorität |
|---|---|---|---|---|---|
| **Nacharbeitung** Session S | `clamp(8 + 2·❓ + 1·neueKonzepte + 0,2·Kartenvorschläge, 10, 30)` min | Session-Ende + Verarbeitungszeit | Session-Ende + 24 h | nein | 0,9 |
| **Lernsitzung** neue Konzepte von S | `clamp(2·neueKonzepte, 10, 20)` | nach der Nacharbeitung | + 48 h | ja (10 min) | 0,7 |
| **Vorbereitung** Vorlesung V | `clamp(5·Defizite, 15, 30)` (Defizit = Voraussetzung mit Mastery < 0,6) | V − 48 h | V − Puffer | nein | 0,8 |
| **Wiederholung** täglich | geschätzte Dauer, max. Budget | 00:00 | 23:59 desselben Tages | ja (≥ 5 min) | 0,6 |
| **Schwäche** pro Modul und Woche | 20 min je Block, Anzahl = `ceil(Σ Weakness der Top-10 / 10)` (max. 3) | Wochenbeginn | Wochenende | ja | 0,5 |
| **Übung/Abgabe** | Schätzwert pro Modul (Start 90 min, lernt aus F-PLN-10) | Upload | `due_at − 12 h` | ja (25 min) | 0,85 |
| **Klausurvorbereitung** Modul M, Tag t | `Tagesminuten(M,t)` (unten) | ab Prüfung − 21 Tage | Tag t | ja | 0,75 |
| **Probeklausur** | echte Prüfungsdauer | Prüfung − 8 und − 4 Tage | Prüfung − 7 bzw. − 3 Tage | nein | 0,8 |

**Tagesminuten Klausurvorbereitung:**
```
Gap(M)   = max(0 ; 0,85 − Readiness(M, heute))
Bedarf(M) = 600 · Gap(M) · ECTS(M)/6                    (Minuten bis zur Prüfung, Startwert)
Tagesminuten(M, t) = Bedarf(M) · g(t) / Σ_t g(t)        g(t) = 1 + (21 − Tage bis Prüfung)/21   (steigt zur Prüfung hin)
```

### 4.3 Verteilen
1. Aufgaben sortieren nach **Frist**, dann **Priorität** (Earliest Deadline First). Klausuraufgaben bekommen je nach Nähe einen Zuschlag (Urgency).
2. Für jede Aufgabe alle passenden Slots vor der Frist bewerten:

| Kriterium | Wirkung |
|---|---|
| Schwere Aufgabe (Schwäche, Klausur, Vorbereitung, Lernsitzung) in Hochleistungszeit | +0,3 |
| Angrenzender Block desselben Moduls (Bündeln) | +0,2 |
| Neuer Stoff eines **anderen** Moduls in den 60 min vor einer Vorlesung | −0,4 („kein Themen-Chaos") |
| Vorbereitung direkt vor der zugehörigen Vorlesung (≤ 3 h) | +0,3 |
| Nacharbeitung: je Stunde nach Session-Ende | −0,02 (früher ist besser) |
| Schwere Aufgabe nach „leicht ab" | −0,5 |
| Wiederholung in kurzen Lücken (15–30 min) zwischen Terminen | +0,3 |
| Tagesmaximum überschritten | ausgeschlossen (harte Grenze) |
| Fixierter Block (`pinned`) im Slot | ausgeschlossen |

3. Bester Slot gewinnt. Teilbare Aufgaben dürfen auf mehrere Slots verteilt werden (Teil ≥ Mindestgröße).
4. Passt eine Aufgabe nicht vor ihre Frist: Sie wird nach der Frist so früh wie möglich geplant und als `reason = "später als ideal"` markiert. Betrifft das Nacharbeitung, Vorbereitung oder Klausurvorbereitung, entsteht **eine** sachliche Zeile im nächsten Tagesbriefing (F-PLN-05).
5. Jede Aufgabe bekommt einen **Begründungstext** aus Vorlagen, z. B.:
   - „VL 8 baut auf *Relationaler Algebra* auf (45 %)"
   - „Klausur in 12 Tagen · Readiness 61 %"
   - „Nacharbeitung VL 7, solange es frisch ist"

### 4.4 Neuplanung
- Auslöser siehe F-PLN-05, **entprellt** (höchstens 1× pro Minute).
- Bereits laufende, erledigte und fixierte Blöcke bleiben unverändert.
- Für die nächsten 2 Stunden wird nur umgeplant, wenn ein Block nicht mehr passt (Stabilität: keine flackernden Vorschläge).
- Dauer einer Planung < 500 ms für 14 Tage.

### 4.5 „Jetzt sinnvoll" (F-PLN-02)
```
g = Minuten bis zum nächsten belegten Termin (abzüglich Puffer), höchstens 60
wenn g < 5:               nichts vorschlagen („kurze Pause")
Kandidaten = heutige geplante Blöcke mit Dauer ≤ g (oder teilbar)
            + Wiederholung (immer möglich, auf g gekürzt)
Wahl       = höchste (Priorität + 0,3 · [Block ist jetzt geplant] + 0,2 · [Frist heute])
abends nach „leicht ab": nur Wiederholung oder Lernsitzung, nie Schwäche oder Klausur
```

### 4.6 Rückkopplung
- Echte Dauer erledigter Blöcke korrigiert die Schätzformeln je Aufgabentyp (gleitender Median, nur ab P2 mit Fokus-Timer genau, vorher aus Start/Ende der `learn_session`).
- Verpasste Blöcke senken nichts und erzeugen keine Statistik „verpasst" in der Oberfläche (LP9). Intern zählen sie für die Einschätzung, wie viele Blöcke pro Tag realistisch sind (Tagesmaximum-Vorschlag im Wochenrückblick).
