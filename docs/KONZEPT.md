# WI-Webapp – Gesamtkonzept

> **Arbeitstitel:** *Studien-Gehirn* – meine persönliche Wissensbibliothek fürs ganze Studium.
> **Status:** Entwurf v0.1 (03.11.2026) · **Fokus:** Eigennutzung, Architektur so, dass ein späterer Verkauf nicht verbaut ist.

---

## 1. Problem

Im Studium liegt das Wissen verstreut: Folien im LMS, Übungsblätter als separate PDFs, Notizen in GoodNotes, das Gesagte des Professors nirgends. Verbindungen zwischen Fächern (z. B. Statistik → Machine Learning, Rechnungswesen → Controlling) sieht man erst, wenn man sie selbst herstellt. Lernen passiert dann unstrukturiert, kurz vor der Klausur, und ohne zu wissen, wo die eigenen Schwächen wirklich liegen.

**Kernidee:** Eine App, die jede Vorlesung *vollständig* erfasst (Folie + Übung + Notizen + Audio), daraus automatisch ein **verlinktes Wissensnetz** baut (Obsidian-Prinzip), mich anhand meines **Stundenplans** durch die Woche führt und mir **gezielt dort** Fragen und Lernvideos gibt, wo ich schwach bin.

## 2. Ziele

| # | Ziel | Woran ich es merke |
|---|------|--------------------|
| Z1 | In der Vorlesung alles an einem Ort | Ich öffne während der Vorlesung keine andere App mehr. |
| Z2 | Nichts geht verloren | Zu jeder Folie finde ich Notiz, Transkript-Stelle und passende Übungsaufgabe in < 30 s. |
| Z3 | Nacharbeitung wird zur Gewohnheit | ≥ 80 % der Vorlesungen sind innerhalb von 24 h nachbereitet. |
| Z4 | Lernen nach Schwächen statt nach Gefühl | Der Lernplan für jede Woche entsteht automatisch; tägliche Wiederholung ≤ 20 min. |
| Z5 | Ein Wissensnetz übers ganze Studium | Neue Themen werden automatisch mit früheren (auch fachfremden) Themen verknüpft. |

## 3. Nicht-Ziele (vorerst)

- **Kein Multi-User, kein Bezahlsystem.** Erst wenn es für mich funktioniert. (Datenmodell bekommt trotzdem eine `user_id`, damit es später geht.)
- **Kein GoodNotes-Klon.** Stift, Textmarker, Radierer, Lasso, Seiten – mehr nicht. Siehe Entscheidung E1.
- **Keine native iOS-App in v1.** Web-App/PWA im Browser des iPads reicht für Apple Pencil.
- **Kein automatisches LMS-Scraping in v1.** Folien werden per Drag & Drop hochgeladen (später P2).
- **Keine KI-Avatare/„Hollywood"-Videos.** Lernvideos = erzählte, animierte Folien. Das reicht didaktisch völlig.

---

## 4. Der Lernzyklus – das Herz der App

Alle Funktionen hängen an einem wiederkehrenden Zyklus pro Vorlesung:

```
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │ 1 VORBEREITEN│ → │ 2 VORLESUNG  │ → │ 3 NACHARBEITEN│ → │ 4 LERNEN     │ → │ 5 SCHWÄCHEN  │
  │              │   │              │   │              │   │              │   │   SCHLIESSEN │
  │ Folien der   │   │ Dashboard:   │   │ KI: Transkript│   │ Fragen,      │   │ Lernvideos   │
  │ nächsten VL  │   │ Folie+Übung+ │   │ → Themen →   │   │ Karteikarten,│   │ nur zu dem,  │
  │ analysieren, │   │ Notizen+Audio│   │ Wissensnotizen│   │ Spaced Rep., │   │ was ich nicht│
  │ Vorwissen    │   │              │   │ + Verlinkung │   │ Übungen      │   │ kann         │
  │ auffrischen  │   │              │   │              │   │              │   │              │
  └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘   └──────┬───────┘
         ▲                                                                           │
         └──────────────── Wochenplaner (Stundenplan + freie Zeit) ◄─────────────────┘
```

Der **Wochenplaner** ist der Taktgeber: Er weiß, wann die nächste Vorlesung ist, wann ich Zeit habe, und schiebt Schritt 1, 3, 4 und 5 in die passenden Lücken.

---

## 5. Module im Detail

### 5.1 Vorlesungs-Dashboard (Live in der Vorlesung)

**Layout auf dem Laptop (frei anpassbar, Standard = drei Spalten):**

```
┌───────────────────────────┬───────────────────┬───────────────────────┐
│                           │  ÜBUNG            │  NOTIZEN (live vom    │
│   FOLIE (aktuell)         │  passende Aufgabe │  iPad, Apple Pencil)  │
│   ◄ 23 / 48 ►             │  zu dieser Folie: │                       │
│                           │  „Blatt 4, A2b"   │   ✍  erscheint in     │
│                           │  (+ Hinweis, was  │      Echtzeit         │
│                           │   die Folie dafür │                       │
│                           │   liefert)        │                       │
├───────────────────────────┴───────────────────┴───────────────────────┤
│ 🔴 REC 00:42:13 │ Transkript-Ticker: „…und genau deshalb ist die      │
│                 │ Normalform hier so wichtig, weil…"     [★ Markieren] │
└───────────────────────────────────────────────────────────────────────┘
```

**Funktionen**
- **Folienansicht** (PDF), Blättern synchron zum Professor. Jeder Folienwechsel wird mit Zeitstempel gespeichert → das ist später der Schlüssel, um Audio, Notizen und Folien exakt zu verknüpfen.
- **Übungs-Panel**: Zeigt automatisch die Aufgabe(n), die zur aktuellen Folie gehören. Die Zuordnung wird **vor** der Vorlesung berechnet (siehe 5.3 „Folie ↔ Übung").
- **Notizen-Panel**: Live-Spiegel dessen, was ich auf dem iPad schreibe (siehe E1). Zwei Modi:
  - *Freie Seite* (wie ein Notizblock), automatisch an die gerade gezeigte Folie geheftet.
  - *Auf die Folie schreiben* (Annotation direkt über der Folie).
- **Audio-Aufnahme + Live-Transkript** (Ticker). Ein Klick auf **★** markiert „das ist wichtig / klausurrelevant / nicht verstanden" – diese Marker steuern später die Nacharbeitung.
- **Schnell-Tags** auf dem iPad per Geste oder Button: ❓ *nicht verstanden*, ⚠️ *klausurrelevant*, 🔗 *erinnert mich an …*.

**Das iPad** öffnet dieselbe Web-App im „Schreib-Modus": nur Canvas + aktuelle Folie als optionaler Hintergrund + Werkzeugleiste. Folienwechsel am Laptop → iPad springt mit.

### 5.2 Wissensbibliothek (Obsidian-Prinzip)

- **Atomare Wissensnotizen** („Konzepte"): eine Notiz pro Thema, z. B. `[[Normalisierung (Datenbanken)]]`, `[[Opportunitätskosten]]`.
- **Markdown mit `[[Wikilinks]]`**, gespeichert als echte `.md`-Dateien in einem Vault-Ordner → **kompatibel mit Obsidian**. Ich kann den Vault jederzeit auch in Obsidian öffnen; die App ist „Obsidian + Vorlesungsdaten + KI".
- Jede Konzeptnotiz sammelt automatisch ihre **Belege**: Folien (mit Bild), Transkript-Ausschnitte (mit Audio-Sprungmarke), meine handschriftlichen Notizen, Übungsaufgaben, Karteikarten, Lernvideos.
- **Beziehungstypen** zwischen Konzepten (mehr als Obsidian kann):
  - `baut auf` (Voraussetzung) – wichtigster Typ, treibt die Vorbereitung
  - `ist Beispiel für`, `steht im Gegensatz zu`, `wird angewendet in`, `verwandt`
- **Graph-Ansicht** über das ganze Studium, filterbar nach Semester/Fach/Beherrschung (Knoten rot = Schwäche, grün = sitzt).
- **Volltextsuche + semantische Suche** („Wo hat Prof. X über Kausalität vs. Korrelation gesprochen?") über Folien, Transkripte, Notizen (inkl. erkannter Handschrift).

> 🧩 **Hier soll dein bestehendes Obsidian-Lernsystem rein.** Die Struktur deiner Notizvorlagen, Tags und Links wird zur Vorlage dafür, wie die KI Konzeptnotizen anlegt (siehe offene Fragen).

### 5.3 KI-Pipeline (Nacharbeitung, läuft automatisch)

Nach Ende der Aufnahme (bzw. beim Hochladen von Folien/Übungen) läuft im Hintergrund:

| Schritt | Eingabe | Ausgabe |
|---|---|---|
| **P1 Folien einlesen** | PDF | Text + Bild pro Folie, Formeln, Struktur (Kapitel) |
| **P2 Übung einlesen** | Übungs-PDF | Einzelne Aufgaben (1a, 1b, …) mit Text |
| **P3 Folie ↔ Übung** | P1 + P2 | Zuordnung Aufgabe → relevante Folien (+ Begründung). Methode: Embeddings → Top-k-Kandidaten → LLM bestätigt und erklärt. **Läuft vor der Vorlesung.** |
| **P4 Transkription** | Audio | Text mit Zeitstempeln (Whisper) |
| **P5 Ausrichtung** | P4 + Folienwechsel-Zeitstempel | Transkript-Abschnitt pro Folie |
| **P6 Handschrift** | Ink-Daten | Erkannter Text (durchsuchbar), an Folie geheftet |
| **P7 Konzepte extrahieren** | P1 + P5 + P6 + ★-Marker | Liste der Themen der Vorlesung |
| **P8 Mit Wissensnetz abgleichen** | P7 + bestehende Konzepte | „Neu" vs. „existiert schon" (Duplikat-Erkennung), Links + Voraussetzungen, auch fachübergreifend |
| **P9 Notizen schreiben** | alles oben | Neue/erweiterte Konzeptnotizen im Vault, Vorlesungs-Zusammenfassung |
| **P10 Fragen generieren** | Konzepte + Übungen | Karteikarten, MC, Lückentext, offene Fragen, Anwendungsaufgaben im Stil der Übung |

**Wichtig:** Ich bestätige die KI-Vorschläge in einer kurzen **Nacharbeitungs-Ansicht** (10–15 min): neue Konzepte annehmen/zusammenführen, Links prüfen, Fragen aussortieren. Das *ist* die Nacharbeitung – aktives Durchgehen statt passives Lesen.

### 5.4 Lernen (Quiz & Karteikarten – à la StudySmarter / Quizlet)

- **Fragetypen:** Karteikarte, Multiple Choice, Lückentext, offene Frage (KI bewertet meine Antwort und erklärt), Rechen-/Anwendungsaufgabe, „Erkläre den Zusammenhang zwischen A und B" (nutzt die Graph-Links).
- **Spaced Repetition mit FSRS** (moderner Nachfolger des Anki-Algorithmus) → tägliche „Fällig"-Liste.
- **Beherrschungsgrad pro Konzept** (0–100 %) aus Wiederholungen + Korrektheit + Fragetyp (Anwendung zählt mehr als Definition).
- **Lernmodi:** Tägliche Wiederholung · Vorlesung X durchgehen · Fach Y · „Nur Schwächen" · Klausur-Simulation (zeitlich begrenzt, gemischt, im Stil alter Klausuren).
- **Fehleranalyse:** Bei falschen Antworten speichert die KI *warum* (Begriff verwechselt? Rechenfehler? Voraussetzung fehlt?). Das füttert die Lernvideos.

### 5.5 Wochenplaner (Stundenplan-basiert)

**Eingaben**
- Stundenplan: Import per **ICS** (fast jedes Uni-System exportiert das) oder Google-Kalender (nur lesend). Vorlesungstermine werden mit den Modulen verknüpft.
- Weitere feste Termine (Job, Sport) – aus dem Kalender oder manuell.
- Präferenzen: maximale Lernzeit pro Tag, beste Uhrzeiten, freie Tage.
- Deadlines: Abgaben, Klausurtermine.

**Regeln (Beispiele)**
1. **Nacharbeitung** innerhalb von 24 h nach jeder Vorlesung, Dauer abhängig von Länge und Anzahl ❓-Marker.
2. **Vorbereitung** vor der nächsten Vorlesung: Sobald deren Folien da sind, prüft die App, auf welche Konzepte sie *aufbaut* – auch aus anderen Fächern. Ist dort meine Beherrschung niedrig → 15–30 min Auffrisch-Block **vor** der Vorlesung.
3. **Kein Themen-Chaos:** Kurz vor einer Vorlesung kein fachfremdes neues Thema einplanen; zusammengehörige Themen bündeln; schwere Themen in meine „Hochleistungszeiten".
4. **Tägliche Wiederholung** als kurzer, fixer Block (z. B. 15 min nach dem Mittag oder in Freistunden zwischen Vorlesungen).
5. **Klausurphase:** Je näher die Klausur, desto mehr Gewicht bekommt das Fach; Schwächen-Sessions und Klausursimulationen werden rückwärts vom Termin geplant.

**Ausgabe:** Wochenansicht mit Lernblöcken („Di 14:15–14:45 · Vorbereitung DB-Systeme: *Relationale Algebra* auffrischen"). Optional werden die Blöcke in einen eigenen Google-Kalender „Lernplan" geschrieben. Verpasst? → automatisch neu verteilen.

### 5.6 Lernvideos (in drei Ausbaustufen)

| Stufe | Was | Aufwand |
|---|---|---|
| **V0 – Vorlesungs-Clips** | Aus Aufnahme + Folienwechseln entstehen automatisch **Clips pro Thema** (Folie + Originalton des Professors). Kostet fast nichts, weil die Ausrichtung (P5) schon da ist. | gering |
| **V1 – Vorlesungs-Recap** | KI schreibt ein Skript (5–10 min) über die ganze Vorlesung → Sprachausgabe (TTS) → animierte Folien mit Hervorhebungen. | mittel |
| **V2 – Schwächen-Videos** | **Erst nach** Nacharbeitung und Fragen: Pro schwachem Konzept ein kurzes Video (2–4 min), das genau meine Fehler adressiert, Voraussetzungen kurz wiederholt und das Thema *anders* erklärt als die Folie (Beispiel, Analogie, Schritt-für-Schritt). | hoch |

Alle Videos werden **pro Konzept** gespeichert → die Videothek ist automatisch nach Themen sortiert und an die Konzeptnotizen gehängt. Ein Konzept kann mehrere Videos haben (Original-Clip, Recap, Schwächen-Video).

---

## 6. Wichtige Entscheidungen

### E1 – GoodNotes: eigene Handschrift-Ebene statt GoodNotes-Integration

**Problem:** GoodNotes hat **keine öffentliche Schnittstelle** und keine Live-Übertragung. Man kann den Inhalt während der Vorlesung nicht in eine andere App streamen.

| Option | Live am Display? | Daten in der App? | Bewertung |
|---|---|---|---|
| A) **Eigener Stift-Canvas** in der Web-App auf dem iPad, Live-Sync zum Laptop | ✅ | ✅ (Striche, Folienbezug, Handschrifterkennung) | **Empfohlen** |
| B) GoodNotes + iPad-Bildschirm spiegeln (AirPlay/Sidecar) als Fenster | ✅ | ❌ nur ein Bild | Notlösung |
| C) GoodNotes-Export (Auto-Backup als PDF nach Drive/Dropbox) → Import | ❌ erst danach | ⚠️ nur PDF, kein Folienbezug | Als **Import für alte Notizen** sinnvoll |

**Entscheidung:** A als Hauptweg, C als Import-Funktion für bestehende GoodNotes-Notizbücher. Mit Apple Pencil im Safari-Browser bekommt man Druckstärke und Neigung (Pointer Events) – das Schreibgefühl kann sehr nah an GoodNotes herankommen (Bibliothek *perfect-freehand* für schöne Striche). Der Vorteil gegenüber GoodNotes ist riesig: Jeder Strich weiß, **auf welcher Folie** und **zu welcher Sekunde im Audio** er entstand.

### E2 – Lokal-first, ein eigener Server

Für Eigennutzung: Die App läuft auf meinem Laptop (oder einem kleinen Server/VPS). iPad und Laptop synchronisieren über **CRDT (Yjs)** – das funktioniert auch bei schlechtem Uni-WLAN, und nichts geht verloren, wenn die Verbindung kurz weg ist. Für einen späteren Verkauf lässt sich derselbe Aufbau in die Cloud heben.

### E3 – Wissensnotizen als Markdown-Dateien

Die Datenbank hält Struktur, Verknüpfungen und Lernstatistik; der **Inhalt der Konzeptnotizen liegt als `.md` im Vault**. So bleibt mein Wissen auch ohne die App lesbar (Obsidian), und ich bin nie eingesperrt.

### E4 – KI hinter einer Schnittstelle

Transkription (Whisper – lokal oder per API), LLM (Claude API) und Sprachausgabe werden über eine interne Schnittstelle angesprochen, damit Anbieter austauschbar sind und ich Kosten steuern kann (günstiges Modell für Masse, starkes Modell für Konzept-Abgleich und Fehleranalyse).

---

## 7. Technische Architektur

```
 iPad (Safari, PWA)            Laptop (Browser)
 ┌──────────────────┐          ┌──────────────────────────────┐
 │ Schreib-Modus    │◄──Yjs───►│ Dashboard · Bibliothek ·     │
 │ Canvas + Folie   │ WebSocket│ Lernen · Planer · Videos     │
 └──────────────────┘          └──────────────┬───────────────┘
                                              │ HTTP/WebSocket
                         ┌────────────────────▼────────────────────┐
                         │  Web-Backend (Next.js / TypeScript)      │
                         │  API, Auth, Sync-Server, Planer          │
                         └───────┬───────────────────┬─────────────┘
                                 │ Job-Queue          │
                   ┌─────────────▼─────────┐   ┌─────▼──────────────────┐
                   │ KI-Worker (Python)     │   │ PostgreSQL + pgvector   │
                   │ PDF, Whisper, LLM,     │──►│ Struktur, Links, FSRS,  │
                   │ Embeddings, TTS, Video │   │ Embeddings              │
                   └─────────────┬─────────┘   └────────────────────────┘
                                 │
                   ┌─────────────▼─────────────────────────────┐
                   │ Dateispeicher: PDFs, Audio, Ink, Videos,   │
                   │ Markdown-Vault (Obsidian-kompatibel)       │
                   └───────────────────────────────────────────┘
```

| Bereich | Vorschlag | Warum |
|---|---|---|
| Frontend | Next.js (React, TypeScript), Tailwind, als PWA | Eine Codebasis für Laptop und iPad |
| PDF-Anzeige | pdf.js | Standard, läuft überall |
| Handschrift | Eigener Canvas + perfect-freehand, Pointer Events | Apple-Pencil-Druck, volle Kontrolle über Daten |
| Echtzeit-Sync | Yjs + y-websocket | Offline-fest, konfliktfrei |
| Backend | Next.js API / tRPC, Prisma oder Drizzle | Typsicher, schnell entwickelt |
| KI-Worker | Python (FastAPI + Job-Queue, z. B. arq/Celery) | Bestes Ökosystem für PDF, Audio, ML |
| PDF-Parsing | PyMuPDF | Text + Bilder pro Seite |
| Transkription | faster-whisper (lokal) oder Whisper-API | Deutsch + Englisch, Zeitstempel |
| LLM | Claude API | Konzept-Extraktion, Fragen, Bewertung, Skripte |
| Datenbank | PostgreSQL + pgvector | Relationen *und* semantische Suche in einem |
| Spaced Repetition | FSRS (ts-fsrs / py-fsrs) | Bester offener Algorithmus |
| Kalender | ICS-Import, Google Calendar API (lesen/optional schreiben) | Stundenplan + freie Zeit |
| Video | Remotion (Videos aus React) + TTS; optional Manim für Mathe | Folien-Animationen programmatisch |
| Betrieb | Docker Compose | Ein Befehl startet alles |

### Datenmodell (Kern)

```
Semester ─< Modul ─< Vorlesungstermin ─< Folie
                │            │
                │            ├─< Folienwechsel (folie, zeitstempel)
                │            ├─< Aufnahme ─< Transkript-Segment (start, ende, text, folie)
                │            └─< Notizseite ─< Strich (punkte, druck, zeitstempel, folie)
                │
                └─< Übungsblatt ─< Aufgabe >─< Folie   (Zuordnung + Begründung + Konfidenz)

Konzept (Markdown-Datei) >─< Konzept          (Beziehung: baut_auf | beispiel | gegensatz | verwandt)
Konzept >─< Beleg (Folie | Transkript-Segment | Notiz | Aufgabe)
Konzept ─< Frage ─< Wiederholung (FSRS-Status, Antwort, korrekt, Fehlertyp)
Konzept ─  Beherrschung (0–1, berechnet)
Konzept ─< Lernvideo (Stufe V0/V1/V2, Datei, Dauer)

Kalender-Ereignis (Vorlesung | fest | Lernblock) ── Lernblock → (Modul | Konzept[] | Typ)
```

---

## 8. Anforderungen nach Priorität

### P0 – ohne das bringt die App nichts (MVP)

- [ ] **Module & Vorlesungen anlegen**, Folien- und Übungs-PDFs hochladen.
- [ ] **Dashboard** mit Folie | Übung | Notizen nebeneinander; Folienwechsel werden mit Zeitstempel gespeichert.
- [ ] **iPad-Schreibmodus** mit Apple Pencil (Stift, Marker, Radierer, Seiten); Striche erscheinen in < 200 ms am Laptop; nach Verbindungsabbruch gehen keine Striche verloren.
- [ ] **Audio-Aufnahme** im Browser, sicher gespeichert (auch bei Absturz: Aufnahme in Stücken speichern).
- [ ] **Transkription + Ausrichtung** pro Folie nach der Vorlesung.
- [ ] **Rückblick einer Vorlesung**: Folie anklicken → meine Notiz + was der Prof dazu gesagt hat (mit Audio-Abspielen ab der Stelle).

### P1 – macht es zur Lernmaschine

- [ ] Folie ↔ Übung automatisch zuordnen (vor der Vorlesung), im Dashboard anzeigen.
- [ ] Konzept-Extraktion, Wissensnotizen als Markdown, Verlinkung + Duplikat-Erkennung, Nacharbeitungs-Ansicht.
- [ ] Fragen generieren, Quiz-Modi, FSRS, Beherrschungsgrad pro Konzept.
- [ ] Stundenplan-Import (ICS/Google), Wochenplaner mit den Regeln aus 5.5.
- [ ] Vorbereitungs-Check: Voraussetzungen der nächsten Vorlesung prüfen.
- [ ] Lernvideos V0 (Clips pro Thema aus der Aufnahme).
- [ ] Suche (Volltext + semantisch), Graph-Ansicht.

### P2 – später, aber Architektur schon darauf auslegen

- [ ] Lernvideos V1 und V2 (Recap + Schwächen-Videos).
- [ ] Handschrifterkennung für durchsuchbare Notizen.
- [ ] GoodNotes-/PDF-Import alter Notizbücher.
- [ ] LMS-Anbindung (automatischer Folien-Download).
- [ ] Altklausuren hochladen → Fragestil und Themengewichtung lernen.
- [ ] Mehrbenutzerfähigkeit, Teilen von Decks, Bezahlmodell.

---

## 9. Umsetzungsplan

> Das Semester läuft schon und die Klausuren rücken näher. Deshalb: **zuerst das, was ich sofort in der Vorlesung und in der Klausurvorbereitung nutze** – Videos kommen zuletzt.

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **0 – Fundament** | Repo-Setup, Docker Compose, DB-Schema, Upload, PDF-Viewer | Folien und Übungen pro Modul ablegen und ansehen |
| **1 – Vorlesungs-Dashboard** | 3-Spalten-Layout, iPad-Canvas + Yjs-Sync, Folienwechsel-Log, Audio-Aufnahme | **In der nächsten Vorlesung einsetzbar** |
| **2 – Nacharbeitung** | Whisper, Ausrichtung, Rückblick-Ansicht, Folie↔Übung, Konzept-Extraktion, Vault | Jede Vorlesung wird automatisch zur verlinkten Wissensnotiz |
| **3 – Lernen** | Fragen, Quiz, FSRS, Beherrschung, Fehleranalyse | Klausurvorbereitung läuft über die App |
| **4 – Planen** | ICS/Google-Import, Wochenplaner, Vorbereitungs-Check | Die Woche plant sich selbst |
| **5 – Videos** | V0 → V1 → V2 | Themen-Videothek, gezielt nach Schwächen |

---

## 10. Risiken & Rechtliches

- **Aufnahme der Vorlesung:** Das Aufnehmen nicht-öffentlich gesprochener Worte ohne Einverständnis kann strafbar sein (DE: § 201 StGB; CH: Art. 179bis ff. StGB). → **Vorher den Professor fragen** bzw. Uni-Regeln prüfen. Viele erlauben es für den Eigengebrauch; manche Vorlesungen werden ohnehin aufgezeichnet – dann deren Aufnahme importieren statt selbst aufnehmen.
- **Urheberrecht an Folien:** Für den Eigengebrauch unproblematisch. Bei einem späteren Produkt dürfen Folien/Inhalte **nicht zwischen Nutzern geteilt** werden – nur die Software wird verkauft.
- **KI-Fehler:** Generierte Notizen/Fragen können falsch sein → immer mit Quelle (Folie/Transkript-Stelle) verlinken; Bestätigung in der Nacharbeitungs-Ansicht.
- **Kosten:** Transkription und LLM-Aufrufe pro Vorlesung im Blick behalten (Kostenzähler im Admin-Bereich); Whisper lokal ist kostenlos.
- **Akku/Netz in der Vorlesung:** Aufnahme läuft lokal im Browser und wird in Stücken gespeichert; Sync holt nach.
- **Scope:** Die größte Gefahr ist, alles gleichzeitig zu bauen. Phase 1 muss *allein* schon nützlich sein.

---

## 11. Offene Fragen

| # | Frage | Blockiert? |
|---|---|---|
| F1 | Welches Tablet genau (iPad + Apple Pencil?) und welcher Laptop (Mac/Windows)? | Ja – Phase 1 |
| F2 | Ist „eigener Stift-Canvas statt GoodNotes" (E1) für dich ok, oder ist GoodNotes selbst ein Muss? | Ja – Phase 1 |
| F3 | Wie sieht dein bestehendes Obsidian-Lernsystem aus (Vorlagen, Tags, Ordner)? Gerne Beispiele ins Repo legen. | Ja – Phase 2 |
| F4 | Woher kommen Folien/Übungen (LMS wie Canvas/Moodle, Mail, …)? Gibt es den Stundenplan als ICS-Export? | Nein |
| F5 | Darfst du die Vorlesungen aufnehmen, bzw. gibt es offizielle Aufzeichnungen? | Ja – Audio-Teil |
| F6 | Lokal auf dem Laptop laufen lassen oder auf einem kleinen Server (dann auch vom Handy erreichbar)? | Nein |
| F7 | Sprache der Vorlesungen (Deutsch/Englisch gemischt?) – wichtig für Transkription und Fragen. | Nein |
