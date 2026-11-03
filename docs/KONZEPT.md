# WI-Webapp – Gesamtkonzept

> **Arbeitstitel:** *Studien-Gehirn* – meine persönliche Wissensbibliothek fürs ganze Studium.
> **Status:** Entwurf v0.2 (03.11.2026) · **Fokus:** Eigennutzung, Architektur so, dass ein späterer Verkauf nicht verbaut ist.
> **Setup:** MacBook + iPad mit Apple Pencil · Vorlesungen dürfen aufgenommen werden.
>
> **Weitere Dokumente:** [Studienalltag & Leitprinzipien](STUDIENALLTAG.md) · [Feature-Katalog (GoodNotes, StudySmarter, Quizlet + neue Ideen)](FEATURE-KATALOG.md) · [Lernmodell (FSRS, Beherrschung, Klausur-Readiness)](LERNMODELL.md)

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
- **Kein GoodNotes-Klon.** Nur die Funktionen, die einen Alltagsmoment verbessern (siehe [Feature-Katalog](FEATURE-KATALOG.md)).
- **Keine native App außer der iPad-Schreib-App.** Dashboard, Bibliothek und Lernen laufen als Web-App (siehe E1).
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

**Das iPad** läuft mit einer eigenen **Schreib-App** (nativ, siehe E1): Canvas, aktuelle Folie als optionaler Hintergrund, Werkzeugleiste, Marker-Buttons, Tafel-Kamera. Folienwechsel am Mac → das iPad springt mit, und umgekehrt (Wischen auf dem iPad blättert die Folie).

**Damit ich in der Vorlesung nichts bedienen muss** (Details in [Studienalltag](STUDIENALLTAG.md)):
- **Ein-Tipp-Start:** Die App weiß aus dem Stundenplan, welche Vorlesung jetzt ist. Auto-Stopp am Kalenderende.
- **Auto-Folienverfolgung:** Das Live-Transkript wird mit dem Folieninhalt abgeglichen. Vergessene Wechsel werden nachträglich korrigiert.
- **Folienloser Modus:** Sind die Folien noch nicht da, läuft alles trotzdem. Die Zuordnung passiert, sobald sie hochgeladen sind.
- **Klausurhinweis-Detektor:** „Das kommt in der Klausur" im Audio setzt automatisch ⚠️.

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
- **Spaced Repetition mit FSRS** (moderner Nachfolger des Anki-Algorithmus) → tägliche „Fällig"-Liste. Erklärung und unsere Erweiterungen: [Lernmodell](LERNMODELL.md).
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

### E1 – GoodNotes-Funktionen selbst bauen, Schreib-App auf dem iPad nativ

**Ausgangslage:** GoodNotes hat **keine öffentliche Schnittstelle** und keine Live-Übertragung. Deshalb bauen wir die Funktionen, die wir wirklich brauchen, selbst nach. Das *Wie* klären wir mit dem REA-Skill (siehe [Feature-Katalog](FEATURE-KATALOG.md)). Alte GoodNotes-Notizbücher kommen per PDF-Export als Import rein.

**Web oder nativ auf dem iPad?**

| | Web-App (Safari) | **Native iPad-App (SwiftUI + PencilKit)** |
|---|---|---|
| Schreib-Latenz | spürbar höher | wie GoodNotes (Apple sagt Striche voraus) |
| Handballenerkennung | eingeschränkt | ✅ systemseitig |
| Pencil-Doppeltipp / Squeeze | ❌ nicht verfügbar | ✅ |
| Fertige Werkzeuge (Stift, Marker, Radierer, Lasso, Lineal) | alles selbst bauen | ✅ in PencilKit enthalten |
| Zeitstempel pro Strich | selbst erfassen | ✅ Erstellungszeit pro Strich, Zeitversatz pro Punkt |
| Aufwand | eine Codebasis | zweite Codebasis (Swift), Xcode auf dem Mac |

**Entscheidung:** Die **Schreib-App auf dem iPad wird nativ** (SwiftUI + PencilKit). Leitprinzip 2 sagt: Schreibgefühl ist nicht verhandelbar, und genau dort ist die Web-Variante schwächer. **Alles andere bleibt Web-App** (Mac-Dashboard, Bibliothek, Lernen, Planer). Die iPad-App überträgt Striche als neutrales JSON (Punkte, Druck, Zeit, Folien-ID). Das Mac-Dashboard zeichnet sie selbst. Damit sind wir nicht an Apple gebunden, falls später andere Tablets dazukommen.

*Hinweis:* PencilKit meldet einen Strich erst, wenn er fertig ist. Am Mac erscheint also jeder Strich **nach dem Absetzen**, typischerweise in unter einer Sekunde. Für einen Live-Spiegel reicht das. Echte Mitzeichnung während des Strichs wäre ein späteres Extra.

### E2 – Lokal speichern zuerst, Sync über einen kleinen Server

Alles wird **zuerst lokal** gespeichert (iPad und Mac), danach synchronisiert. Ein Verbindungsabbruch kostet so nie Daten.

**Haken im Hörsaal:** Im Uni-WLAN (z. B. eduroam) sehen sich Geräte untereinander oft nicht („Client Isolation"). iPad und Mac können sich dort direkt also womöglich nicht erreichen. Deshalb:
1. **Standard:** Beide Geräte synchronisieren über einen **kleinen Sync-Server im Internet** (günstiger VPS oder später Cloud). Das funktioniert in jedem WLAN mit Internet.
2. **Ohne Internet:** Beide schreiben lokal weiter und gleichen später ab. Notfalls hilft der iPhone-Hotspot oder ein privates Netz wie Tailscale.
3. **Später (P2):** Direktverbindung iPad ↔ Mac ohne Netz über Apples Multipeer Connectivity (bräuchte einen kleinen nativen Mac-Helfer).

**Gleiche Uhr für alle:** Striche (iPad) und Audio (Mac) müssen auf die Sekunde zusammenpassen. Beide Geräte gleichen ihre Uhr beim Start mit dem Server ab (Zeitversatz messen).

Die **Audioaufnahme** läuft am Mac im Browser, in 30-Sekunden-Stücken gespeichert und nach und nach hochgeladen.

### E3 – Wissensnotizen als Markdown-Dateien

Die Datenbank hält Struktur, Verknüpfungen und Lernstatistik; der **Inhalt der Konzeptnotizen liegt als `.md` im Vault**. So bleibt mein Wissen auch ohne die App lesbar (Obsidian), und ich bin nie eingesperrt.

### E4 – KI hinter einer Schnittstelle

Transkription (Whisper – lokal oder per API), LLM (Claude API) und Sprachausgabe werden über eine interne Schnittstelle angesprochen, damit Anbieter austauschbar sind und ich Kosten steuern kann (günstiges Modell für Masse, starkes Modell für Konzept-Abgleich und Fehleranalyse).

---

## 7. Technische Architektur

```
 iPad (native App)             Mac (Browser)
 ┌──────────────────┐          ┌──────────────────────────────┐
 │ Schreib-App      │          │ Dashboard · Bibliothek ·     │
 │ PencilKit + Folie│          │ Lernen · Planer · Videos     │
 └────────┬─────────┘          └──────────────┬───────────────┘
          │  Striche, Marker, Fotos (lokal zuerst, dann Sync)   │
          └──────────────────────┬────────────────────────────┘
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
| Frontend (Mac) | Next.js (React, TypeScript), Tailwind | Dashboard, Bibliothek, Lernen, Planer |
| iPad-Schreib-App | SwiftUI + PencilKit, lokale Speicherung | Schreibgefühl wie GoodNotes, Pencil-Gesten (E1) |
| PDF-Anzeige | pdf.js | Standard, läuft überall |
| Striche am Mac anzeigen | Canvas + perfect-freehand | Zeichnet die Striche aus dem neutralen JSON |
| Sync | Eigener Sync-Server (WebSocket), Änderungsprotokoll pro Notizbuch; für Text-Notizen Yjs | Offline-fest, funktioniert auch bei Client Isolation (E2) |
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
- [ ] **Ein-Tipp-Start** aus dem Stundenplan, Auto-Stopp; **folienloser Modus** mit späterer Zuordnung.
- [ ] **iPad-Schreib-App** (PencilKit: Stift, Marker, Radierer, Lasso, Seiten, Folie als Hintergrund, Marker ❓⚠️🔗, Tafel-Foto). Jeder Strich ist nach dem Absetzen in < 1 s am Mac. Nach einem Verbindungsabbruch geht kein Strich verloren.
- [ ] **Audio-Aufnahme** im Browser, sicher gespeichert (auch bei Absturz: Aufnahme in Stücken speichern).
- [ ] **Automatische Backups** (täglich) und Vault-Export.
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
| **1 – Vorlesungs-Dashboard** | 3-Spalten-Layout, iPad-Schreib-App (PencilKit) + Sync-Server, Folienwechsel-Log, Audio-Aufnahme, Ein-Tipp-Start | **In der nächsten Vorlesung einsetzbar** |
| **2 – Nacharbeitung** | Whisper, Ausrichtung, Rückblick-Ansicht, Folie↔Übung, Konzept-Extraktion, Vault | Jede Vorlesung wird automatisch zur verlinkten Wissensnotiz |
| **3 – Lernen** | Fragen, Quiz, FSRS, Beherrschung, Fehleranalyse | Klausurvorbereitung läuft über die App |
| **4 – Planen** | ICS/Google-Import, Wochenplaner, Vorbereitungs-Check | Die Woche plant sich selbst |
| **5 – Videos** | V0 → V1 → V2 | Themen-Videothek, gezielt nach Schwächen |

---

## 10. Risiken & Rechtliches

- **Aufnahme der Vorlesung:** ✅ geklärt, ich darf aufnehmen. Für einen späteren Verkauf bleibt das ein Hinweis an die Nutzer: Ohne Einverständnis kann das Aufnehmen strafbar sein (DE: § 201 StGB; CH: Art. 179bis ff. StGB).
- **Nachbau fremder Funktionen:** Nur Funktionsweisen übernehmen, nie fremden Code, Design oder Marken (siehe [Feature-Katalog](FEATURE-KATALOG.md)).
- **Urheberrecht an Folien:** Für den Eigengebrauch unproblematisch. Bei einem späteren Produkt dürfen Folien/Inhalte **nicht zwischen Nutzern geteilt** werden – nur die Software wird verkauft.
- **KI-Fehler:** Generierte Notizen/Fragen können falsch sein → immer mit Quelle (Folie/Transkript-Stelle) verlinken; Bestätigung in der Nacharbeitungs-Ansicht.
- **Kosten:** Transkription und LLM-Aufrufe pro Vorlesung im Blick behalten (Kostenzähler im Admin-Bereich); Whisper lokal ist kostenlos.
- **Akku/Netz in der Vorlesung:** Aufnahme läuft lokal im Browser und wird in Stücken gespeichert; Sync holt nach.
- **Scope:** Die größte Gefahr ist, alles gleichzeitig zu bauen. Phase 1 muss *allein* schon nützlich sein.

---

## 11. Offene Fragen

**Geklärt:** Mac + iPad mit Apple Pencil ✅ · Aufnahme erlaubt ✅ · GoodNotes-Funktionen werden mit dem REA-Skill analysiert und selbst gebaut ✅

| # | Frage | Blockiert? |
|---|---|---|
| F1 | Welches iPad-Modell und welcher Apple Pencil (2. Gen., USB-C, Pro)? Davon hängen Gesten wie Squeeze und Hover ab. | Nein |
| F2 | Gibt es einen Apple-Developer-Account? Ohne ihn muss die iPad-App alle 7 Tage neu aus Xcode installiert werden. Mit ihm (99 $/Jahr) geht es per TestFlight. | Ja – Phase 1 |
| F3 | Wie sieht dein bestehendes Obsidian-Lernsystem aus (Vorlagen, Tags, Ordner)? Gerne Beispiele ins Repo legen. | Ja – Phase 2 |
| F4 | Woher kommen Folien und Übungen (LMS wie Canvas/Moodle, Mail …)? Gibt es den Stundenplan als ICS-Export? | Nein |
| F5 | Hast du ein iPhone? Dann lohnt sich der Review-Modus fürs Pendeln (M1) auch dort. | Nein |
| F6 | Sync-Server: kleiner VPS (ca. 5 €/Monat) okay, oder lieber erst nur lokal testen? | Ja – Phase 1 |
| F7 | Sprache der Vorlesungen (Deutsch/Englisch gemischt?) – wichtig für Transkription und Fragen. | Nein |
| F8 | Dateien für REA: GoodNotes-Mac-App und die Web-Bundles von Quizlet/StudySmarter hochladen, sobald wir an die jeweiligen Funktionen gehen. | Nein |
