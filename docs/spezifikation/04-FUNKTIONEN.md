# 04 · Funktionen

Jede Funktion hat eine ID, Priorität, Phase, die Alltagsmomente (M) und Leitprinzipien (LP), die sie bedient, sowie überprüfbare Akzeptanzkriterien. Algorithmen der KI-Pipeline stehen in [Kapitel 05](05-KI-PIPELINE.md), Formeln und Planungslogik in [Kapitel 06](06-LERNMODELL-PLANER.md), Bildschirme in [Kapitel 07](07-UX.md).

**Inhalt:** [ORG](#org--organisation) · [KAL](#kal--stundenplan--kalender) · [SES](#ses--vorlesungs-session) · [DSH](#dsh--dashboard-auf-dem-mac) · [INK](#ink--schreib-app-auf-dem-ipad) · [SYN](#syn--synchronisation) · [AUD](#aud--audioaufnahme) · [NAC](#nac--nacharbeitung--rückblick) · [BIB](#bib--wissensbibliothek) · [SUC](#suc--suche--frag-deine-vorlesung) · [LRN](#lrn--lernen) · [PLN](#pln--wochenplaner) · [VID](#vid--lernvideos) · [DAT](#dat--daten--sicherheit) · [EIN](#ein--einstellungen) · [Übersicht nach Phase](#übersicht-nach-phase)

---

## ORG · Organisation

### F-ORG-01 · Semester und Module verwalten
`P0` · Phase 0 · M2

Semester und Module anlegen, bearbeiten, archivieren. Ein Semester ist „aktuell". Module haben Name, Kürzel, Farbe (aus fester Palette mit 12 Tönen, Kap. 07), ECTS, Prüfungsform und Dozent(in).

**Regeln**
- Beim ersten Start führt ein kurzer Einrichtungsdialog durch: Semester → Module (oder Stundenplan-Import, F-KAL-01, legt die Module selbst an).
- Ein archiviertes Semester bleibt vollständig durchsuchbar und lernbar (LP10). Archivieren blendet es nur in der Navigation aus.

**Akzeptanzkriterien**
- [ ] Ein Modul lässt sich in unter 20 s anlegen (Name genügt, alles andere optional).
- [ ] Inhalte archivierter Semester erscheinen weiter in Suche, Graph und Wiederholung.

### F-ORG-02 · Folien hochladen
`P0` · Phase 0 · M2

PDF per Drag & Drop auf das Modul, eine Session, das Dashboard oder irgendwo ins Fenster. Die App ordnet automatisch zu.

**Ablauf**
1. Datei wird gezogen → Core speichert sie und berechnet `sha256`.
2. **Zuordnung:** Wurde die Datei auf eine Session gezogen, gilt diese. Sonst wird der nächste kommende oder letzte noch nicht zugeordnete Vorlesungstermin des Moduls vorgeschlagen. Hinweise dafür sind Dateiname (z. B. „VL07", „Lecture 7", Datum) und Titel der ersten Folie. Der Vorschlag erscheint als kleine Bestätigung mit Rückgängig, nicht als Dialog.
3. Job `pdf.ingest` (Kap. 05 §P1) rendert Seiten und extrahiert Text.
4. Gab es für die Session schon eine Aufnahme ohne Folien → F-NAC-03 startet automatisch.

**Sonderfälle**
- **Gleiche Datei erneut** (`sha256` bekannt): keine Kopie, Hinweis „schon vorhanden".
- **Neue Version** eines vorhandenen Foliensatzes (gleicher Termin, andere Datei): Die alte Version bleibt erhalten. Folien werden über Textähnlichkeit auf die neue Version abgebildet. Seiten, Belege und Karten werden auf die neuen Folien umgehängt. Was sich nicht eindeutig zuordnen lässt, landet in der Inbox.
- **PDF ohne Textlayer** (eingescannt): Bilder werden trotzdem angezeigt. Text kommt aus der Vision-Beschreibung (Kap. 05 §P1).
- PowerPoint-Dateien: P2 (Umwandlung über LibreOffice im Worker).

**Akzeptanzkriterien**
- [ ] Ein 60-seitiges PDF ist nach dem Ablegen in < 3 s anzeigbar (erste Seiten). Vollständig verarbeitet in < 60 s ohne Vision.
- [ ] Dieselbe Datei zweimal hochladen erzeugt keinen zweiten Foliensatz.
- [ ] Nach einem Versionswechsel zeigen vorhandene Notizseiten weiterhin auf die inhaltlich passende Folie.

### F-ORG-03 · Übungsblätter hochladen und in Aufgaben zerlegen
`P0` (Upload) / `P1` (Zerlegung) · Phase 0 / 2 · M8

Upload wie F-ORG-02. Optional mit Abgabedatum, das in den Planer geht. Der Worker zerlegt das Blatt in Teilaufgaben (`task`) mit Label, Text und Position (Kap. 05 §P2).

**Akzeptanzkriterien**
- [ ] Bei einem typischen Blatt mit nummerierten Aufgaben (1, 1a, 1b, 2 …) werden ≥ 90 % der Teilaufgaben korrekt erkannt.
- [ ] Falsch erkannte Aufgaben lassen sich in der Übungsansicht mit wenigen Klicks zusammenführen oder teilen.

### F-ORG-04 · PDF-Anzeige
`P0` · Phase 0 · M3, M5

Anzeige von Folien und Übungen mit pdf.js: Seitenleiste mit Vorschaubildern, Zoom, Volltextsuche im Dokument, Sprung zu Seite. Die gerenderten PNGs aus `pdf.ingest` dienen als schnelle Vorschau, solange pdf.js lädt.

### F-ORG-05 · Musterlösungen hinterlegen
`P1` · Phase 3 · M8

PDF der Musterlösung an ein Übungsblatt hängen. Der Worker ordnet Lösungsteile den Aufgaben zu (`task.solution_text`). Grundlage für F-LRN-14.

### F-ORG-06 · Altklausuren hinterlegen
`P1` · Phase 3 · Klausurphase

PDF an ein Modul hängen. Der Worker zerlegt die Klausur in Fragen (`past_exam_question`), ordnet Konzepte und Fragestil zu (Kap. 05 §P12). Grundlage für F-LRN-11 und F-LRN-15.

---

## KAL · Stundenplan & Kalender

### F-KAL-01 · Stundenplan-Import (ICS)
`P0` (einfach) · Phase 1 · M2

ICS-Datei hochladen oder ICS-URL eintragen. Wiederkehrende Termine (RRULE, EXDATE) werden aufgelöst. Abonnierte URLs werden alle 6 h und beim Start abgeglichen. Abgleich über `external_uid` + `recurrence_id`: Änderungen werden übernommen, entfallene Termine als `cancelled` markiert, nie gelöscht.

**Akzeptanzkriterien**
- [ ] Ein Semester-ICS mit wöchentlichen Terminen erzeugt alle Einzeltermine inklusive Ausnahmen.
- [ ] Ein verschobener Termin in der Quelle verschiebt den lokalen Termin. Eine schon aufgenommene Session behält ihre Daten.

### F-KAL-02 · Termine Modulen zuordnen
`P0` · Phase 1 · M2

Automatische Zuordnung über Titelähnlichkeit (Modulname, Kürzel, Dozent im Ort/Beschreibung). Unbekannte Titel → Vorschlag „neues Modul anlegen?" in der Einrichtung bzw. Inbox. Die Art des Termins (Vorlesung, Übung, Tutorium) wird aus Schlüsselwörtern geraten und ist änderbar. Eine einmal getroffene manuelle Zuordnung gilt für alle Termine der Serie.

### F-KAL-03 · Google-Kalender lesen
`P1` · Phase 4 · M10, M11

OAuth (nur Lesen). Ausgewählte Kalender liefern **belegte Zeiten** für den Planer (feste Termine wie Job, Sport). Termine aus Google werden nicht als Vorlesungen interpretiert, außer der Kalender ist ausdrücklich als Stundenplan markiert.

### F-KAL-04 · Semesterstart-Assistent
`P1` · Phase 4 · Semesterbeginn

Ablauf: ① Stundenplan importieren → ② Module bestätigen → ③ optional Modulbeschreibungen (PDF/Text) ablegen → KI extrahiert ECTS, Prüfungsform, Prüfungstermin, Lernziele (`module.description_md`) → ④ Prüfungstermine bestätigen → ⑤ Präferenzen für den Planer (F-EIN-01). Dauer: unter 10 Minuten.

### F-KAL-05 ○ · Lernblöcke in Google-Kalender schreiben
`P2` · Phase 4 · M10

Eigener Kalender „Lernplan". Nur die App schreibt dort. Änderungen dort werden nicht zurückgelesen, weil die App der Ort der Wahrheit ist.

---

## SES · Vorlesungs-Session

### F-SES-01 · Zustandsautomat einer Session
`P0` · Phase 1

```
 geplant ──(15 min vor Beginn)──► bereit ──Start──► laeuft ◄──Fortsetzen── pausiert
    │                               │                 │  └──Pause──────────────▲
    │                               │                 └──Stopp/Auto-Stopp──► beendet
    └──(Termin vorbei, nie gestartet)──► verpasst                              │
                                                       verarbeitet ◄──Pipeline fertig
```

- `bereit`: Folien, Übung und Notizbuch sind vorgeladen, auf dem iPad und am Mac.
- `pausiert`: Aufnahme angehalten (z. B. Vorlesungspause). Striche bleiben möglich. Auto-Stopp-Regeln laufen weiter.
- `verpasst`: Kein Fehler, kein Hinweis in Rot. Bietet nur „Aufnahme importieren" an (F-SES-06).
- Es gibt höchstens **eine** laufende Session (Invariante 1).

### F-SES-02 · Ein-Tipp-Start
`P0` · Phase 1 · M2 · LP1

**Ablauf**
1. Ab 15 min vor Terminbeginn zeigt der Heute-Bildschirm (Mac) und der Startbildschirm (iPad) eine große Karte: *„Datenbanksysteme · VL 7 · 08:15 · Start"*.
2. Ein Tipp auf **Start** (an Mac **oder** iPad):
   - Core setzt `laeuft`, `started_at`.
   - Mac: Dashboard öffnet sich im Live-Layout. Aufnahme startet. Die Mikrofon-Freigabe wird einmalig bei der Einrichtung erteilt, nicht hier.
   - iPad: Notizbuch des Moduls öffnet sich mit neuer Seite an Folie 1 (bzw. leerer Seite im folienlosen Modus).
3. Startet das iPad, während der Mac nicht erreichbar ist, läuft die Session auf dem iPad (`started_from = ipad`). Der Mac übernimmt beim nächsten Kontakt. Die Audioaufnahme fehlt dann, bis der Mac verbunden ist. Das wird dezent auf dem iPad angezeigt: „Mac nicht verbunden – keine Aufnahme".

**Regeln**
- Kein Dialog zwischen Tipp und laufender Aufnahme.
- Liegen keine Folien vor → folienloser Modus, ohne Rückfrage.
- Läuft beim Start noch eine andere Session (vergessen zu stoppen), wird sie automatisch beendet, mit `stop_reason = kalenderende` bzw. dem Ende des Kalendertermins.

**Akzeptanzkriterien**
- [ ] Vom Öffnen der App bis zur laufenden Aufnahme ≤ 10 s, davon ein einziger Tipp.
- [ ] Während der ganzen Session erscheint kein modaler Dialog.
- [ ] Start ohne Folien funktioniert ohne Rückfrage.

### F-SES-03 · Auto-Stopp
`P0` · Phase 1 · M6 · LP4

Stopp-Regeln, die erste zutreffende gewinnt:
1. **Kalenderende + 10 min** und in den letzten 3 min keine Sprache erkannt (Sprachaktivitätserkennung im Browser, Pegel über Schwelle).
2. **Kalenderende + 30 min**, unabhängig von Sprache.
3. **Stille ≥ 15 min** während der Session (außerhalb der Pause).
4. **Maximaldauer 4 h**.

Zuvor zeigt die Statusleiste 60 s lang dezent „Stoppt gleich · weiter aufnehmen". Ein Tipp darauf verlängert um 15 min. Bei spontanen Sessions ohne Kalendertermin gelten nur Regeln 3 und 4.

**Akzeptanzkriterien**
- [ ] Eine vergessene Session ist spätestens 30 min nach Terminende beendet.
- [ ] Der Hinweis vor dem Stopp ist kein Dialog und verschwindet von selbst.

### F-SES-04 · Spontane Session
`P0` · Phase 1

„Neue Session" im Modul oder auf dem iPad, ohne Kalendertermin (z. B. Zusatztermin, Lerngruppe). Gleiches Verhalten wie F-SES-02.

### F-SES-05 · Wiederherstellung nach Absturz
`P0` · Phase 1 · LP3

- Web-App: Beim Neuladen während `laeuft` wird die Aufnahme automatisch fortgesetzt (neuer Chunk-Strom mit Lücke). Hinweis in der Statusleiste: „Aufnahme fortgesetzt · 12 s fehlen".
- Core-Neustart: Sessions im Zustand `laeuft` bleiben `laeuft`. Clients verbinden sich neu.
- Mac war ausgeschaltet bis nach dem Termin → Session wird mit `stop_reason = absturz_wiederhergestellt` beendet, vorhandene Daten werden verarbeitet.

### F-SES-06 · Verpasste Vorlesung importieren
`P1` · Phase 2 · M13

Eine Audio- oder Videodatei (mp3, m4a, wav, mp4, webm) einer Session zuordnen: eigene Aufnahme eines anderen Geräts, Aufnahme von Kommilitonen oder offizielle Aufzeichnung. Die Pipeline läuft wie gewohnt. Ohne Folienwechsel-Log greift F-NAC-03. Bei Videos werden zusätzlich Standbilder alle 10 s für die Folienerkennung genutzt.

---

## DSH · Dashboard auf dem Mac

### F-DSH-01 · Live-Layout
`P0` · Phase 1 · M3 · LP1, LP5

Drei Spalten: **Folie** | **Übung** | **Notizen**, darunter eine schmale Statusleiste. Layout-Vorlagen:
- *Standard* (50 / 25 / 25 %)
- *Folie groß* (Übung und Notizen als schmale Leiste)
- *Notizen groß*
- *Fokus* (nur die Folie)

Spaltenbreiten sind ziehbar, die Wahl wird pro Modul gespeichert. Details der Gestaltung in [07 §3.3](07-UX.md).

**Akzeptanzkriterien**
- [ ] Auf einem 13"-Display ist eine Folie im Standard-Layout lesbar (mindestens 640 px breit).
- [ ] Layoutwechsel per Taste `1`–`4` ohne Mausweg.

### F-DSH-02 · Folien blättern und Folienwechsel-Log
`P0` · Phase 1 · M3

Tasten `←` `→`, Leertaste, Klick auf die Seitenleiste, oder Wisch auf dem iPad (F-INK-04). Jeder Wechsel erzeugt ein `slide_event` mit Sitzungszeit. Ein Wechsel, der weniger als 1,5 s stehen bleibt (schnelles Durchklicken), wird beim Ausrichten als Durchgangsfolie gewertet, nicht als eigenes Segment.

**Akzeptanzkriterien**
- [ ] Ein Folienwechsel am Mac erscheint auf dem iPad in < 300 ms (gleiches Netz).
- [ ] Rückwärtsspringen erzeugt korrekte Segmente (Folie 12 → 9 → 12).

### F-DSH-03 · Übungs-Panel
`P1` · Phase 2 · M8

Zeigt zur aktuellen Folie die verknüpften Aufgaben aus `task_slide_link` (relevance ≥ 0,6, höchstens 3), jeweils mit Label, erster Zeile und Begründung („liefert die Definition der 3NF"). Ohne Treffer: das zuletzt geöffnete Übungsblatt des Moduls, ohne Hervorhebung. Klick öffnet die Aufgabe im Panel. Das Panel ändert sich **nur beim Folienwechsel**, nie von sich aus (LP5).

### F-DSH-04 · Notizen-Spalte (Live-Spiegel)
`P0` · Phase 1 · M3

Zeigt die aktuelle iPad-Seite. Neue Striche erscheinen nach dem Absetzen des Stifts. Dargestellt mit perfect-freehand aus dem neutralen Strich-Format (Kap. 08 §4), Hintergrund je nach Vorlage bzw. Folie. Folgt automatisch der Seite, die auf dem iPad offen ist. Manuelles Blättern in der Spalte entkoppelt bis zum nächsten Seitenwechsel auf dem iPad. Ohne Verbindung: letzter Stand plus dezenter Hinweis „iPad nicht verbunden".

**Akzeptanzkriterien**
- [ ] Ein Strich ist ≤ 1 s nach dem Absetzen am Mac sichtbar (gleiches Netz).
- [ ] Die Darstellung entspricht dem iPad bis auf Glättung (keine fehlenden oder versetzten Striche).

### F-DSH-05 · Marker vom Mac
`P0` · Phase 1 · M4

Taste `F` = ❓ Frage, `K` = ⚠️ Klausur, `L` = 🔗 Verknüpfung, oder Klick in der Statusleiste. Erzeugt einen `marker` mit aktueller Sitzungszeit und kurzer, stummer Bestätigung (Zähler in der Statusleiste zählt hoch, 300 ms Hervorhebung). Rückgängig mit `⌘Z` innerhalb von 10 s.

### F-DSH-06 · Statusleiste
`P0` · Phase 1 · LP5

Inhalte von links nach rechts:
- **Aufnahme:** ● REC und Laufzeit. Wird bei Problemen grau: „Mikrofon fehlt".
- **Marker-Zähler:** ❓ ⚠️ 🔗
- **iPad-Status:** dezenter Punkt (verbunden/getrennt)
- **Pause, Stopp**
- **⌘K**

Keine Farbe außer dem roten Aufnahmepunkt. Kein Text länger als drei Wörter.

### F-DSH-07 · Suche während der Session
`P1` · Phase 2 · M5

⌘K öffnet die Suche (F-SUC-01) als Überlagerung über der Notizen-Spalte, nicht als Vollbild. Die Folie bleibt sichtbar. `Esc` schließt. Die Aufnahme läuft ungestört weiter.

### F-DSH-08 ○ · Live-Transkript-Ticker
`P2` · später

Eine Zeile mit dem gerade Gesagten (Streaming-Transkription lokal). Standardmäßig aus. Wird erst gebaut, wenn Phase 2 stabil ist.

---

## INK · Schreib-App auf dem iPad

Gemeinsame Vorgaben: PencilKit (`PKCanvasView`), `drawingPolicy = .pencilOnly`. Finger scrollen, zoomen und tippen, der Stift schreibt. Ausrichtung quer und hoch. Die Werkzeugleiste ist links oder rechts andockbar (Händigkeit, F-EIN-01).

### F-INK-01 · Werkzeuge
`P0` · Phase 1 · M3 · LP2

| Werkzeug | Umsetzung | Anforderungen |
|---|---|---|
| Stift (Füller, Fineliner, Bleistift) | `PKInkingTool` `.pen` / `.monoline` / `.fountainPen` / `.pencil` | 3 Stärken je Werkzeug als Schnellwahl, 8 Favoritenfarben |
| Textmarker | `.marker`, halbtransparent | Liegt optisch unter dem Text (eigene Ebene, siehe unten) |
| Radierer | `PKEraserTool` `.vector` (ganzer Strich) und `.bitmap` (präzise) | Umschalten per Lang-Druck. Option „nur Textmarker radieren". |
| Lasso | `PKLassoTool` | siehe F-INK-07 |
| Lineal | `PKToolPicker`-Lineal bzw. eigenes Lineal | für Tabellen und Diagramme |

- **Ebenen:** Pro Seite zwei `PKCanvasView` übereinander: unten Textmarker, oben Schrift. So liegt der Marker immer hinter dem Text. Die Radierer-Option „nur Textmarker" wirkt nur auf die untere Ebene.
- **Pencil-Gesten:** Doppeltipp (`UIPencilInteraction`) = zwischen aktuellem Werkzeug und Radierer wechseln (einstellbar). Squeeze (Pencil Pro) = Werkzeug-Palette am Stift. Hover (wo verfügbar) = Vorschau der Strichstärke.
- **Rückgängig/Wiederholen:** Zwei-Finger-Tipp / Drei-Finger-Tipp, zusätzlich Buttons.

**Akzeptanzkriterien**
- [ ] Im Blindvergleich mit GoodNotes (gleiche Seite, 5 Minuten Mitschrift) bewertet der Nutzer das Schreibgefühl als „gleich gut oder besser". Das ist das **Freigabekriterium für Phase 1**.
- [ ] Handflächen auf dem Display erzeugen keine Striche.
- [ ] Doppeltipp wechselt zuverlässig zum Radierer und zurück.

### F-INK-02 · Notizbücher, Seiten, Vorlagen
`P0` · Phase 1 (Cornell: Phase 2)

- Pro Modul automatisch ein Notizbuch „Vorlesung" und eines „Übung". Weitere frei anlegbar.
- Seitenformat: A4 hoch (595 × 842 pt) für freie Seiten, Folienformat (Seitenverhältnis der Folie) für „auf die Folie schreiben".
- Vorlagen: blanko, liniert, kariert (5 mm), Punktraster, **Cornell** (F-INK-12).
- Neue Seite: Wisch nach links am Ende der Seite oder Button „+". Seitenleiste mit Vorschaubildern.
- Endlos-Scrollen innerhalb des Notizbuchs (vertikal), wie in GoodNotes.

### F-INK-03 · Schreibmodi und Folienkopplung
`P0` · Phase 1 · M3

| Modus | Verhalten | Speicherung |
|---|---|---|
| **Freie Seite** (Standard) | Leere Seite mit Vorlage. Wird beim Erstellen an die aktuelle Folie **geheftet**. Wechselt die Folie, bleibt die Seite. Die nächste neue Seite heftet sich an die dann aktuelle Folie. | `page.attached_slide_id` |
| **Auf die Folie schreiben** | Die aktuelle Folie ist Hintergrund. Jeder Folienwechsel öffnet die zugehörige Folienseite, legt sie bei Bedarf an und erhält vorhandene Notizen. | `page.background_slide_id` |

Umschalten mit einem Button in der Werkzeugleiste. Die Wahl gilt pro Modul. Zusätzlich: Jeder Strich trägt seine Sitzungszeit. Darüber ist auch bei freien Seiten später exakt bestimmbar, welche Folie beim Schreiben lief.

### F-INK-04 · Folie blättern per Wisch
`P0` · Phase 1 · M3

Wisch mit **zwei Fingern** nach links/rechts auf der Folienleiste (oben, einblendbar) oder im Modus „auf die Folie schreiben" auf dem Canvas. Zwei Finger, damit es nicht mit Scrollen kollidiert. Erzeugt `slide_event` mit `device = ipad`. Ohne Verbindung wird lokal geblättert und das Event später gesendet.

### F-INK-05 · Marker-Stempel
`P0` · Phase 1 · M4 · LP1

Drei feste Buttons ❓ ⚠️ 🔗 am Bildschirmrand (Daumenbereich, auf der Seite der Werkzeugleiste, je ≥ 44 × 44 pt). Ein Tipp erzeugt einen Marker mit Sitzungszeit. Ein kleiner Stempel erscheint am rechten Seitenrand auf Höhe des zuletzt geschriebenen Strichs. Optional: Tipp mit dem Stift auf einen Button und danach auf eine Stelle der Seite → Stempel genau dort. Kein Texteingabefeld.

**Akzeptanzkriterien**
- [ ] Ein Marker kostet genau einen Tipp und unterbricht den Schreibfluss nicht (kein Fokuswechsel, keine Tastatur).

### F-INK-06 · Tafel-Foto
`P0` · Phase 1 · M3

Kamera-Button → Vollbild-Kamera → Auslösen → Foto wird als `photo` mit Sitzungszeit gespeichert und als Bildelement auf der aktuellen Seite eingefügt (verschieb- und skalierbar). Automatische Perspektivkorrektur (VisionKit-Dokumentenerkennung, falls in Swift Playgrounds verfügbar, sonst ohne). OCR-Text kommt später aus dem Worker (Kap. 05 §P6). Mehrere Fotos in Folge ohne die Kamera zu schließen.

### F-INK-07 · Lasso
`P0` · Phase 1 · M3

Auswahl mit dem PencilKit-Lasso: verschieben, skalieren, umfärben, löschen, kopieren. Zusätzlich im Kontextmenü: **„Als Karte"** (F-INK-11, Phase 3) und **„In Text umwandeln"** (P2). Verschobene Striche behalten ihre ursprüngliche Zeit (wichtig für die Audio-Kopplung).

### F-INK-08 · Textfelder
`P1` · Phase 2

Getippter Text (Hardware- oder Bildschirmtastatur) als `page_element kind=text`. Schrift: Systemschrift, drei Größen.

### F-INK-09 · Formerkennung
`P1` · Phase 3 · M3 · Recherche: `docs/referenz-analysen/goodnotes.md`

Zeichnen und am Ende **0,5 s halten** → Erkennung von Linie, Pfeil, Rechteck, Kreis/Ellipse, Dreieck, Raute. Algorithmus: Punkte vereinfachen (Ramer-Douglas-Peucker), Ecken zählen, Abweichung von der Idealform messen. Ersetzt wird nur, wenn der Fehler unter der Schwelle liegt, sonst bleibt der Strich unverändert („lieber nichts als falsch"). Erkannte Formen sind als `page_element kind=shape` editierbar (Ecken ziehen). Linien rasten bei ±5° auf waagerecht/senkrecht ein. Ein- und ausschaltbar.

**Akzeptanzkriterien**
- [ ] Bei 50 Testformen pro Typ: ≥ 90 % korrekt erkannt, < 2 % falsch ersetzt.

### F-INK-10 · Abdeckband
`P1` · Phase 3 · M7 · LP6 · Recherche: `docs/referenz-analysen/goodnotes.md`

Werkzeug „Band": über Inhalte ziehen → deckende Fläche (Farbe wählbar, Standard Grau). Tipp mit dem Finger deckt auf bzw. wieder zu. In der Seitenleiste: **„Alle zudecken" / „Alle aufdecken"**. Ein Band kann per Kontextmenü **Karte werden** (F-LRN-09). Dann wird beim Aufdecken nach „Nochmal/Gut" gefragt, und das Band erscheint in der Wiederholung als Ausschnitt der Seite.

### F-INK-11 · Lasso → Karte
`P1` · Phase 3 · M7

Bereich mit dem Lasso wählen → „Als Karte". Der Ausschnitt (Bild + Strich-IDs) geht an den Worker. Die KI schlägt Vorder- und Rückseite vor, z. B. die Frage zum markierten Diagramm. Erscheint sofort als Entwurf zum Bestätigen (F-LRN-07).

### F-INK-12 · Cornell-Vorlage mit Schlüsselfragen
`P1` · Phase 2 · M7

Seite mit Spalten: links schmal *Schlüsselfragen*, rechts *Notizen*, unten *Zusammenfassung*. Ich schreibe nur rechts. Nach der Vorlesung füllt die KI die linke Spalte (als Textelemente, auf Höhe der jeweiligen Notiz) mit Abruffragen. Die Zusammenfassung bleibt leer mit dem Hinweis „in eigenen Worten" (LP6).

### F-INK-13 · Kopplung mit dem Mac und Verbindungsstatus
`P0` · Phase 1

Erststart: iPad sucht per Bonjour nach `_studiengehirn._tcp`. Gefunden → Kopplung durch Bestätigungscode (6 Ziffern auf beiden Geräten). Nicht gefunden → „QR-Code scannen": die Web-App zeigt ihn unter Einstellungen → Geräte. Danach automatische Verbindung. Status als kleiner Punkt in der Werkzeugleiste (grün verbunden, grau getrennt). Keine Fehlermeldungen bei Trennung.

### F-INK-14 · Lokaler Speicher und Ausgangswarteschlange
`P0` · Phase 1 · LP3

- Jede Seite wird lokal als Datei gespeichert: `PKDrawing` (verlustfrei) und Strich-Liste im neutralen Format. Gespeichert wird 1 s nach der letzten Änderung und beim Verlassen der App.
- Jede Änderung (Strich hinzu/weg, Marker, Foto, Folienwechsel, Seite) geht als Operation in eine **Ausgangswarteschlange** (Append-only-Datei). Sie wird erst gelöscht, wenn der Core sie bestätigt hat.
- Fotos werden getrennt hochgeladen (HTTP, fortsetzbar). Die Operation verweist auf die Datei.
- Erstes Öffnen nach Neuinstallation: vollständiger Abzug vom Core.

**Akzeptanzkriterien**
- [ ] App per Taskumschalter beenden, unmittelbar nachdem ein Strich gezogen wurde → Strich ist nach Neustart vorhanden.
- [ ] 90 min ohne Verbindung schreiben, dann verbinden → alle Striche, Marker, Fotos und Folienwechsel kommen vollständig und in richtiger Reihenfolge am Mac an.

### F-INK-15 · Spätere Funktionen
`P2` · später

Zoom-Fenster (Schreiben in vergrößertem Streifen) · Handschrifterkennung (durchsuchbare Notizen, Lasso → Text) · Import alter GoodNotes-Notizbücher als PDF (Seiten als Hintergrund, Text per OCR durchsuchbar).

---

## SYN · Synchronisation

### F-SYN-01 · Sync zwischen iPad, Core und Web-App
`P0` · Phase 1 · LP3

Protokoll und Nachrichten: [Kap. 08 §2](08-SCHNITTSTELLEN.md#2-sync-protokoll-websocket).

**Grundsätze**
- **Ein Schreiber pro Datenart.** Striche und Seiten schreibt nur das iPad. Folienwechsel schreiben iPad und Mac, beide nur anhängend. Marker schreiben beide, nur anhängend. Deshalb gibt es keine echten Bearbeitungskonflikte.
- Der Core vergibt pro Strom (Notizbuch, Session) eine fortlaufende `seq`. Clients bestätigen und können ab einer `seq` nachladen.
- Alle Operationen sind **idempotent** über ihre `op_id` (UUIDv7).

### F-SYN-02 · Uhrabgleich
`P0` · Phase 1

Siehe [02 §5](02-ARCHITEKTUR.md#5-zeitmodell). Akzeptanz: Versatz zwischen iPad und Mac nach Abgleich < 50 ms. Ein Strich, gezogen während der Prof ein Wort sagt, liegt in der Audio-Wiedergabe (F-NAC-04) höchstens 1 s daneben.

### F-SYN-03 · Abgleich nach Offline-Phase
`P0` · Phase 1

Beim Wiederverbinden sendet das iPad die Ausgangswarteschlange in Reihenfolge, in Paketen von 200 Operationen. Der Core wendet sie an und meldet `seq`. Fehlt dem Core eine referenzierte Folie (z. B. erst später hochgeladen), wird die Operation trotzdem gespeichert und die Verknüpfung später aufgelöst.

---

## AUD · Audioaufnahme

### F-AUD-01 · Aufnahme in Stücken
`P0` · Phase 1 · LP3

- Browser-`MediaRecorder`, Opus in WebM (Chrome) bzw. MP4/AAC (Safari), mono, 48 kHz, ≈ 48 kbit/s.
- `timeslice` = 30 s. Jeder Chunk wird sofort in **IndexedDB** gelegt, dann per HTTP an den Core gesendet (`PUT /recordings/{id}/chunks/{seq}`) und erst nach Bestätigung lokal gelöscht.
- Einstellungen: Echo-Unterdrückung **aus**, Rauschunterdrückung **ein**, automatische Verstärkung **ein**. Mikrofon wählbar (eingebautes Mikro, externes Ansteckmikro).
- Der Core schreibt die Chunks als einzelne Dateien und erzeugt nach Session-Ende eine zusammengefügte Datei (`ffmpeg concat`, Lücken als Stille mit korrekter Länge).

**Akzeptanzkriterien**
- [ ] Bei Browser-Absturz gehen höchstens 30 s Audio verloren.
- [ ] Netzunterbrechung zum Core bis 30 min: kein Verlust (Puffer in IndexedDB).
- [ ] 90 min Aufnahme ≈ 32 MB.

### F-AUD-02 · Pegel und Mikrofonprüfung
`P1` · Phase 1

Vor dem ersten Start einmalig: Mikrofon wählen, Pegel testen. In der Statusleiste nur ein Zustand: ● läuft, grau = kein Signal seit 60 s („Mikrofon prüfen"). Keine laufende Pegelanzeige (Ablenkung, LP5).

---

## NAC · Nacharbeitung & Rückblick

### F-NAC-01 · Automatische Verarbeitung nach der Session
`P0` (Transkript, Ausrichtung) / `P1` (Rest) · Phase 2 · M6

Mit `beendet` legt der Core die Pipeline-Jobs an (Kap. 05 §2). Der Fortschritt steht in `session.processing`. Der Nutzer sieht im Heute-Bildschirm nur einen ruhigen Status pro Session: „wird verarbeitet" bzw. „Nacharbeitung bereit · ≈ 15 min". **Keine Benachrichtigungen.**

**Akzeptanzkriterien**
- [ ] 90 min Vorlesung: Transkript und Ausrichtung fertig in ≤ 20 min auf einem M-Prozessor-Mac. Die vollständige Pipeline mit Cloud-LLM ist in ≤ 45 min fertig.

### F-NAC-02 · Rückblick einer Vorlesung
`P0` · Phase 2 · M5, M7 · LP8

Bildschirm mit drei Bereichen ([07 §3.4](07-UX.md)):
- **Folienleiste** links.
- **Mitte:** Folie und darunter das Transkript dieser Folie.
- **Rechts:** meine Notizseiten zu dieser Folie, mit Markern und Fotos.

Tipp auf einen Satz im Transkript spielt das Audio ab dieser Stelle. Ein Player unten (Geschwindigkeit 1–2×, ±15 s) läuft synchron: Folie, Transkript-Hervorhebung und Notiz folgen der Abspielposition.

**Akzeptanzkriterien**
- [ ] Klick auf eine Folie zeigt in < 500 ms Transkript und Notizen dieser Folie.
- [ ] Wiedergabe springt beim Folienende automatisch zur nächsten Folie.

### F-NAC-03 · Folienzuordnung nachträglich korrigieren
`P1` · Phase 2 · M2, M3 · LP4 · ○ (folienloser Modus)

Ein Verfahren für zwei Fälle:
1. **Folienloser Modus:** Folien kamen erst nach der Vorlesung.
2. **Vergessene Folienwechsel:** Das Log hat Lücken, z. B. 20 min auf derselben Folie, obwohl der Prof weiter war.

Algorithmus: Kap. 05 §P5b. Das Ergebnis sind `slide_segment`-Einträge mit `source = ausrichtung`.
- Im folienlosen Modus wird das Ergebnis **automatisch übernommen**.
- Bei Abweichungen vom Log erscheint ein Inbox-Vorschlag „Folienzuordnung von 08:32–08:51 korrigieren?". Daneben zeigt eine Vorher/Nachher-Leiste die Zuordnung, und die Notizseiten werden mit umgehängt.

Manuelle Korrektur im Rückblick: Segmentgrenzen auf einer Zeitleiste verschieben.

**Akzeptanzkriterien**
- [ ] Bei einer Testvorlesung mit bekanntem Folienlog stimmen ≥ 85 % der Zeit mit der wahren Folie überein, wenn die Ausrichtung ohne Log läuft.

### F-NAC-04 · Audio-synchrone Wiedergabe der Notizen
`P1` · Phase 2 · M7 · Ⓡ Notability

- Tipp auf einen Strich im Rückblick (Mac) oder in der iPad-App → Wiedergabe ab `t_start_ms − 3 s`.
- **Wiedergabe-Modus:** Die Seite „entsteht neu", Striche erscheinen zu ihrer Zeit, später geschriebene sind blass.

### F-NAC-05 · Geführte Nacharbeitung
`P1` · Phase 2 · M7 · LP6, LP7

Eine Lerneinheit (`learn_session kind = nacharbeitung`), Dauer vorher angezeigt (Formel in 06 §4.2), jederzeit pausierbar. Schritte:

| # | Schritt | Inhalt | Interaktion |
|---|---|---|---|
| 1 | **Meine Fragen** | Jeder ❓-Marker mit Audio-Ausschnitt (±60 s), Folie, Notiz und KI-Erklärung mit Quellen | „Verstanden" / „Noch unklar" (bleibt offen und wird Schwäche) / „Karte daraus" |
| 2 | **Kurzfassung** | 5 Sätze zur Vorlesung, jeder mit Quellen-Chip | Lesen (max. 1 min) |
| 3 | **Abruf** | 3 Fragen zur Vorlesung, ohne vorher nachzusehen | frei antworten, KI bewertet (F-LRN-05) |
| 4 | **Neue Konzepte** | Vorschläge aus der Inbox (neu / zusammenführen / Beziehungen) | Wisch rechts = annehmen, links = verwerfen, Tipp = bearbeiten |
| 5 | **Karten** | Vorgeschlagene Karten in Gruppen | behalten / verwerfen / bearbeiten |
| 6 | **In eigenen Worten** ○ | Für 1–2 zentrale Konzepte: „Kernidee in meinen Worten" | 1–3 Sätze schreiben oder diktieren, geht in den Vault |

Danach `session.review_state = erledigt`. Was angenommen wurde, steht im Wissensnetz. Erste Wiederholungen werden eingeplant.

**Akzeptanzkriterien**
- [ ] Median-Dauer ≤ 15 min bei 90 min Vorlesung.
- [ ] Abbrechen in Schritt 4 und Fortsetzen am nächsten Tag beginnt genau beim nächsten unbearbeiteten Vorschlag.
- [ ] Kein Vorschlag landet ohne Bestätigung im Wissensnetz, außer „automatisch annehmen" ist eingestellt (F-EIN-01).

### F-NAC-06 · Inbox
`P1` · Phase 2 · LP8

Sammelstelle aller KI-Vorschläge (`inbox_item`), gruppiert nach Session. Jeder Vorschlag zeigt seine Belege. Massenaktionen pro Gruppe: „alle annehmen". Die Inbox wird meist über die geführte Nacharbeitung abgearbeitet und ist zusätzlich in der Navigation erreichbar. Dort steht die Zahl offener Einträge neutral grau, nie rot (LP9). Vorschläge älter als 14 Tage werden zusammengefasst („12 ältere Vorschläge"), nicht gelöscht.

### F-NAC-07 ○ · Klausurhinweis-Detektor
`P1` · Phase 2 · M4

Findet Klausurhinweise im Transkript (Kap. 05 §P7b) und setzt `marker kind = klausur, source = detektor`. Diese Marker sind in Rückblick und Statistik von eigenen Markern unterscheidbar (Umriss statt Fläche). Die betroffenen Konzepte bekommen `exam_relevant = true` und mehr Wichtigkeit (06 §2.3). Ein falscher Treffer lässt sich mit einem Klick entfernen. Daraus lernt der Detektor nicht automatisch, aber die Formulierung kommt auf eine Ausschlussliste.

### F-NAC-08 · Vorlesungs-Zusammenfassung
`P1` · Phase 2 · M7 · LP8

Pro Session: 5-Satz-Kurzfassung und Gliederung (Kapitel aus den Folien), jeweils mit Belegen. Wird als Vorlesungsnotiz `Fächer/<Modul>/Vorlesungen/VL07 – <Titel>.md` in den Vault geschrieben, mit Links zu allen Konzepten der Vorlesung.

---

## BIB · Wissensbibliothek

### F-BIB-01 · Vault und Konzeptnotizen
`P1` · Phase 2 · LP10, LP12

Konzepte sind Markdown-Dateien im Vault (`~/StudienGehirn/vault/`). Ordnerstruktur, Frontmatter und Abschnitte: [Kap. 08 §8](08-SCHNITTSTELLEN.md#8-vault-format). Die Datenbank hält Struktur, Beziehungen und Lernstatus, die Datei hält den Inhalt.

**Eigentumsregel für Abschnitte**
- **App-Abschnitte** (*In einem Satz*, *Belege*, *Zusammenhänge*, *Typische Fehler*) stehen zwischen Markierungskommentaren und werden von der App neu geschrieben.
- **Meine Abschnitte** (*Kernidee in meinen Worten*, *Wofür brauche ich das?*, *Beispiel*, *Offene Fragen*) schreibt die App nur beim Anlegen, als leere Überschrift mit Hinweis. Danach nie wieder.
- Ist ein App-Abschnitt von Hand geändert worden (Hash weicht ab), wird er nicht überschrieben. Stattdessen landet ein Inbox-Vorschlag mit Unterschiedsansicht in der Inbox.

**Akzeptanzkriterien**
- [ ] Der Vault öffnet sich in Obsidian ohne Fehler. Links und Frontmatter werden dort richtig erkannt.
- [ ] Ein von Hand geschriebener Satz unter „Kernidee in meinen Worten" überlebt beliebig viele Neuverarbeitungen.

### F-BIB-02 · Konzeptansicht
`P1` · Phase 2 · M5

Ein Bildschirm pro Konzept ([07 §3.6](07-UX.md)):
- Kopf mit Name, Fächern, Beherrschung (Balken mit Unsicherheit) und Klausur-Kennzeichen.
- Inhalt der Notiz, direkt editierbar (Markdown-Editor mit Vorschau).
- Belege als Kacheln: Folie, Audio-Ausschnitt mit Abspielknopf, Notiz-Ausschnitt, Aufgabe.
- Beziehungen (eingehend/ausgehend, nach Typ), Karten des Konzepts, Videos, Verlauf der Beherrschung.

### F-BIB-03 · Beziehungen bearbeiten
`P1` · Phase 2

Beziehung hinzufügen über Suche im Konzept (Typ wählen), entfernen, Typ ändern. `baut_auf`-Zyklen werden verhindert (Invariante 4), mit Erklärung: „Das würde einen Kreis bilden: A → B → A".

### F-BIB-04 · Konzepte zusammenführen und teilen
`P1` · Phase 2

- **Zusammenführen:** Ziel wählen. Belege, Karten, Beziehungen und Aliase wandern zum Ziel. Die eigenen Abschnitte beider Notizen werden untereinander gestellt, nicht verworfen. Die Quelldatei wird zu einer Weiterleitung („→ [[Ziel]]").
- **Teilen:** Belege und Karten auf zwei neue Konzepte verteilen (Vorschlag der KI, manuell anpassbar).

### F-BIB-05 · Änderungen aus Obsidian zurücklesen
`P1` · Phase 2 · LP12

Der Core beobachtet den Vault (`chokidar`).
- **Geänderte Datei:** Frontmatter und Wikilinks neu einlesen. Ein neuer `[[Link]]` erzeugt eine Beziehung `verwandt` (`source = wikilink`). Typisierte Beziehungen kommen aus dem Frontmatter (`baut_auf: […]`).
- **Neue Datei in `Konzepte/`:** wird ein Konzept mit `status = aktiv`.
- **Gelöschte Datei:** Konzept wandert in den Papierkorb, Karten werden pausiert.
- **Umbenannte Datei:** Konzept wird umbenannt, Links in anderen Dateien werden nachgezogen (wie Obsidian).

### F-BIB-06 · Graph-Ansicht
`P1` · Phase 3 · LP10

Kräftebasierter Graph aller Konzepte (WebGL, ab ca. 2 000 Knoten noch flüssig).
- **Knotenfarbe:** Beherrschung (Farbskala mit Unsicherheit als Transparenz). **Knotengröße:** Wichtigkeit.
- **Kanten:** nach Typ gestrichelt bzw. durchgezogen, `baut_auf` mit Pfeil.
- **Filter:** Fach, Semester, nur klausurrelevant, nur Schwächen.
- **Klick auf einen Knoten:** Seitenleiste mit der Konzeptansicht.
- **„Lernpfad":** Voraussetzungskette eines Konzepts hervorheben.

### F-BIB-07 · Fachübersicht
`P1` · Phase 2

Pro Modul ein Bildschirm (und `_Fach.md` im Vault): Termine, Sessions mit Nacharbeitungsstatus, Prüfung, Readiness, Konzeptliste (sortiert nach Vorlesung oder nach Schwäche), Übungsblätter mit Abgaben.

### F-BIB-08 · Glossar
`P1` · Phase 3 · M5

Automatisch pro Fach: Begriff, englischer Begriff, Ein-Satz-Definition, Link zum Konzept. Exportierbar als PDF und Markdown.

### F-BIB-09 · Fächerbrücken
`P1` · Phase 3 · LP10

Wird ein Konzept erkannt, das einem bereits beherrschten Konzept aus einem anderen Fach stark ähnelt oder darauf aufbaut, erscheint in Konzeptansicht, Nacharbeitung und V2-Video ein Hinweis: „Das kennst du aus *Statistik II* als *Varianz*". Grundlage: Beziehungen und Embedding-Ähnlichkeit > 0,8 über Fachgrenzen.

---

## SUC · Suche & „Frag deine Vorlesung"

### F-SUC-01 · ⌘K-Schnellsuche
`P1` · Phase 2 · M5

Ein Suchfeld für alles: Konzepte, Folien, Transkripte, Notizen (ab P2 inklusive Handschrift), Aufgaben, Karten, Fotos (OCR).
- **Hybridsuche:** Volltext (`tsvector`, Deutsch/Englisch) + semantisch (pgvector), gemischt per Reciprocal Rank Fusion.
- **Ergebnisse gruppiert:** Konzepte zuerst, dann Folien, Transkript-Stellen (mit Abspielknopf), Notizen.
- **Tastatur:** `↑` `↓` `Enter`. `⌘Enter` öffnet ohne die aktuelle Ansicht zu verlassen.
- **Filter-Präfixe:** `fach:DBS`, `typ:folie`, `semester:HS26`.

**Akzeptanzkriterien**
- [ ] Erste Ergebnisse in < 300 ms bei 5 000 Folien und 200 h Transkript.
- [ ] Die Suche nach einem Begriff, den der Prof nur gesagt hat, findet die Audio-Stelle.

### F-SUC-02 · Frag deine Vorlesung
`P1` · Phase 3 · M7 · LP8

Chat-Bereich (in Konzeptansicht, Rückblick und als eigener Bildschirm). Antwortet **nur aus eigenem Material** (Retrieval über `search_chunk`, Top 12, LLM-Stufe `standard`). Jede Aussage hat einen Quellen-Chip. Findet sich nichts im Material, sagt die Antwort das ausdrücklich und erklärt nicht aus allgemeinem Wissen, es sei denn, ich tippe „allgemein erklären", dann wird die Antwort als *ohne Quelle* gekennzeichnet. Aus jeder Antwort: „Karte daraus" oder „in Konzeptnotiz übernehmen".

---

## LRN · Lernen

### F-LRN-01 · Kartentypen
`P1` · Phase 3

| Typ | Stufe | Vorderseite → Rückseite | Bewertung |
|---|---|---|---|
| `basic` | 2 | Frage → Antwort | Selbstbewertung |
| `reverse` | 2 | automatisch umgekehrtes Paar (Begriff ↔ Definition) | Selbstbewertung |
| `cloze` | 2 | Satz mit Lücke(n) → Lösung | tippen (tolerant) oder Selbstbewertung |
| `mc` | 1 | Frage + 4 Optionen (plausible Ablenker) → richtige Option + Erklärung | automatisch |
| `open` | 2–3 | offene Frage → Musterantwort + Bewertungskriterien | KI-Vorschlag, ich bestätige |
| `calc` | 3 | Aufgabe mit Zahlen → Lösungsweg + Ergebnis | Ergebnis prüfen, KI prüft den Weg |
| `relation` | 4 | „Erkläre den Zusammenhang von A und B" → Kernpunkte | KI-Vorschlag |
| `image_occlusion` | 2 | Folie/Diagramm mit verdeckten Labels → Labels | Selbstbewertung |
| `tape` | 2 | Seitenausschnitt mit Abdeckband → aufgedeckt | Selbstbewertung |

Formeln in LaTeX (KaTeX), Bilder aus Folien und Notizen. Jede Karte zeigt beim Aufdecken ihren Quellen-Chip (LP8).

### F-LRN-02 · Kartenerzeugung
`P1` · Phase 3 · LP6

Pro neuem Konzept 3–8 Karten, verteilt auf die Stufen. Regeln und Prompt-Vorgaben in Kap. 05 §P10. Karten kommen als Vorschlag in die Nacharbeitung (F-NAC-05 Schritt 5).

### F-LRN-03 · Tägliche Wiederholung
`P1` · Phase 3 · M1 · LP7, LP9

- Warteschlange = fällige Karten (FSRS), gekappt durch das **Zeitbudget** (Standard 20 min, Zeit pro Karte aus meinem Verlauf).
- Reihenfolge nach Priorität (06 §3.2), nicht nach Fälligkeit allein.
- Überzählige Karten werden **still** auf die nächsten Tage verteilt (Lastausgleich), ohne Rückstandszahl.
- Start mit einem Tipp. Zeigt vorab „≈ 14 min". Jederzeit beenden. Was nicht dran war, bleibt fällig.

**Akzeptanzkriterien**
- [ ] Nach 7 Tagen Pause zeigt die App keinen Rückstandsberg, sondern einen normal großen Block. Der Rest ist auf die Folgetage verteilt.

### F-LRN-04 · Lernsitzung für neue Konzepte
`P1` · Phase 3 · M7 · Ⓡ Quizlet

Für frisch nachgearbeitete Konzepte, bevor sie in die FSRS-Wiederholung gehen:
- Runden mit höchstens 7 Karten. Falsch beantwortete kommen in derselben Sitzung wieder.
- **Fertig, wenn jede Karte zweimal hintereinander richtig war.**
- Stufen bauen aufeinander auf: zuerst Stufe 1–2. Stufe 3 wird freigeschaltet, wenn die Stufe-2-Karten des Konzepts einmal richtig waren.
- Am Ende bekommt jede Karte ihren ersten FSRS-Zustand (erste Bewertung = Ergebnis des ersten Versuchs).

### F-LRN-05 · Bewertung
`P1` · Phase 3

- **Selbstbewertung:** Nochmal / Schwer / Gut / Leicht. Tasten `1`–`4`, auf dem iPad Wisch (links = Nochmal, rechts = Gut) oder Buttons.
- **Getippte Antworten** (cloze, kurze Begriffe): Normalisierung (Groß-/Kleinschreibung, Satzzeichen, Leerzeichen, Klammerinhalte, Umlaute ↔ ae/oe/ue), Synonyme und Aliase des Konzepts, Tippfehler bis Levenshtein-Abstand 1 je 6 Zeichen. Ergebnis: richtig / fast richtig (Hinweis) / falsch.
- **Offene Antworten:** Die KI bewertet nach den Kriterien der Karte und schlägt eine Note vor, mit einem Satz Begründung und dem fehlenden Punkt. Ich bestätige mit `Enter` oder ändere. Dauer: ≤ 3 s, sonst sofort Selbstbewertung anbieten und KI-Kommentar nachreichen.

### F-LRN-06 · Fehleranalyse
`P1` · Phase 3 · LP6

Bei „Nochmal" oder falscher Antwort bestimmt der Worker (offene/getippte Antwort) bzw. eine kurze Auswahl (Selbstbewertung, optional, 1 Tipp: „verwechselt · vergessen · nicht verstanden") den Fehlertyp. Reaktionen laut `docs/LERNMODELL.md` §2.7, z. B.:
- **Verwechslung:** Kontrastkarte „A vs. B" wird vorgeschlagen.
- **Voraussetzung fehlt:** Das Voraussetzungs-Konzept wird in der nächsten Wiederholung vorgezogen.

Fehler füllen den Abschnitt „Typische Fehler" der Konzeptnotiz.

### F-LRN-07 · Markieren → Karte
`P1` · Phase 3 · M7 · Ⓡ StudySmarter

Text auf einer Folie (Mac: markieren mit der Maus) oder Bereich einer Notiz (iPad: Lasso, F-INK-11) → „Karte daraus". Die KI erzeugt einen Vorschlag mit Typ, Vorderseite und Rückseite. Er erscheint sofort editierbar, die Quelle wird automatisch verknüpft. Speichern mit `Enter`.

### F-LRN-08 · Bildverdeckung
`P1` · Phase 3 · Ⓡ Anki / Quizlet

Auf einer Folie Rechtecke über Beschriftungen ziehen. Vorschlag durch die KI anhand von `slide.text_blocks`. Jede Verdeckung wird eine Karte (Variante „eine verdeckt, Rest sichtbar").

### F-LRN-09 · Abdeckband-Karten
`P1` · Phase 3

Siehe F-INK-10. In der Wiederholung erscheint der Seitenausschnitt mit Band. Tipp deckt auf, dann folgt die Bewertung.

### F-LRN-10 · Schwächen-Session
`P1` · Phase 3 · LP6

10–20 min zu den Konzepten mit höchstem Schwächen-Score (06 §2.4). Ablauf pro Konzept:
1. Kurze Erinnerung an die Voraussetzungen (Ein-Satz-Definitionen, Link).
2. Karten höherer Stufe.
3. Bei Bedarf V2-Video (F-VID-03) oder Feynman-Aufgabe.

### F-LRN-11 · Probeklausur
`P1` · Phase 3 · Klausurphase · Ⓡ Quizlet

- **Konfiguration:** Fach, Dauer (Standard: echte Klausurdauer), Umfang.
- **Fragen:** aus Karten höherer Stufe und neu erzeugten Aufgaben **im Stil der Altklausuren** (F-LRN-15), gewichtet nach Themenhäufigkeit.
- **Während der Probeklausur:** kein Feedback, Zeit sichtbar.
- **Danach:** Punkte pro Aufgabe (KI-Bewertung, bestätigbar), Auswertung pro Konzept. Ergebnisse fließen in Beherrschung und Readiness (06 §2.5).

### F-LRN-12 · Klausur-Readiness
`P1` · Phase 3 · LP9

Pro Fach zwei Werte: **heute** und **am Klausurtag bei Einhalten des Plans**, jeweils mit Unsicherheitsband. Darunter die 5 Konzepte, die am meisten Readiness kosten, je mit Aktion „jetzt üben". Formeln: 06 §2.5. Darstellung ohne Rot und ohne Schuld-Formulierungen (07 §5).

### F-LRN-13 ○ · Feynman-Modus
`P1` · Phase 3 · LP6

Konzept wählen (oder vorgeschlagen bekommen) → „Erkläre es, als würdest du es jemandem ohne Vorwissen erklären". Sprechen (Aufnahme → lokale Transkription) oder schreiben. Die KI vergleicht mit Belegen und Konzeptnotiz und gibt zurück:
- was gut erklärt war,
- **was fehlt oder falsch ist** (mit Quelle),
- welche Fachbegriffe ohne Erklärung benutzt wurden.

Aus den Lücken entstehen Kartenvorschläge. Die Erklärung kann als „Kernidee in meinen Worten" in den Vault übernommen werden.

### F-LRN-14 ○ · Übungsmodus mit Lösungsvergleich
`P1` · Phase 3 · M8

Layout: Aufgabe links, meine Lösung rechts (Handschrift auf dem iPad oder Text), passende Folien auf Abruf. Nach „Fertig" und vorhandener Musterlösung (F-ORG-05): Gegenüberstellung pro Teilschritt durch die KI (Handschrift über Vision gelesen), mit Abweichungen, Fehlertyp und Konzept. Fehler fließen in die Fehleranalyse. Abgabefristen kommen aus `exercise_sheet.due_at`.

### F-LRN-15 · Altklausuren-Analyse
`P1` · Phase 3

Pro Fach: Themengewichtung (Anteil der Punkte je Konzept), Fragestile (rechnen, definieren, erklären, anwenden, MC) und wiederkehrende Aufgabentypen. Fließt in Wichtigkeit (06 §2.3), Probeklausur und Planer.

### F-LRN-16 · Karten verwalten
`P1` · Phase 3

Liste mit Filtern (Fach, Konzept, Typ, Stufe, Herkunft, „schwer"). Bearbeiten, pausieren, mit Stern markieren, löschen (Papierkorb). Massenbearbeitung. Doppelte Karten werden beim Erzeugen vermieden (Kap. 05 §P10). Vorhandene Dubletten schlägt ein wöchentlicher Lauf zur Zusammenführung vor.

### F-LRN-17 · Wiederholung auf dem iPad, offline
`P1` · Phase 3 · M1

Die iPad-App bekommt einen Bereich „Wiederholen": Die Tageswarteschlange und die nächsten 2 Tage werden vorab geladen (inklusive Bilder). Beantworten geht offline. Reviews gehen über die Ausgangswarteschlange an den Core, der FSRS endgültig rechnet. Das iPad nutzt für die Anzeige eine lokale Kopie der Fälligkeiten.

### F-LRN-18 bis F-LRN-21 · Spätere Funktionen
`P2` · später

- **F-LRN-18 Audio-Modus:** Karten werden vorgelesen, Antwort laut, Bewertung per KI. Für unterwegs, freihändig.
- **F-LRN-19 Erhaltungsmodus:** Nach der Klausur sinkt die Zielbehaltensquote des Fachs (06 §3.4). Wenige Wiederholungen halten die Grundlagen.
- **F-LRN-20 Formelblatt-Generator:** Für erlaubte Hilfsmittel (`exam.allowed_aids`). Verdichtet Formeln und Definitionen nach Wichtigkeit auf das erlaubte Format, Export als PDF.
- **F-LRN-21 Anki-Export (.apkg):** Teilen mit der Lerngruppe, kein Lock-in.

---

## PLN · Wochenplaner

Algorithmus und Regeln: [Kap. 06 §4](06-LERNMODELL-PLANER.md#4-planer).

### F-PLN-01 · Wochenplan erzeugen
`P1` · Phase 4 · M10 · LP4

Rollierender Plan über 14 Tage (Detailplanung 7 Tage). Belegte Zeiten kommen aus dem Kalender. Aufgaben entstehen aus Sessions, Karten, Schwächen, Abgaben und Prüfungen. Ergebnis sind `study_block`-Einträge mit Begründung („warum dieser Block"). Ansicht als Wochenkalender mit Lernblöcken zwischen den Terminen (07 §3.9).

### F-PLN-02 · „Jetzt sinnvoll"
`P1` · Phase 4 · M7

Immer **ein** Vorschlag auf dem Heute-Bildschirm (Mac und iPad): der passendste Block für die *aktuell* freie Zeit. Ist z. B. 25 min frei, wird kein 45-Minuten-Block vorgeschlagen. Ein Tipp startet ihn. „Etwas anderes" zeigt zwei Alternativen, mehr nicht.

### F-PLN-03 · Vorbereitungs-Check vor der nächsten Vorlesung
`P1` · Phase 4 · M12

Sobald Folien einer kommenden Vorlesung vorliegen (oder sonst anhand der Konzepte der letzten Vorlesung des Moduls): Job `prereq.check` (Kap. 05 §P11) ermittelt die vorausgesetzten Konzepte, auch aus anderen Fächern und Semestern. Ist deren Beherrschung < 0,6 → Block „Vorbereitung" (15–30 min) **vor** der Vorlesung, mit Begründung. Am Vorabend steht im Tagesabschluss: „Morgen DBS VL 8 · baut auf *Relationaler Algebra* auf (45 %) · 15 min morgen um 07:40?".

### F-PLN-04 · Abhängigkeits-Warnung
`P1` · Phase 4 · M12

Ist eine Session nicht nachgearbeitet und baut eine bald stattfindende Vorlesung darauf auf, wird die Nacharbeitung vor die Vorlesung gezogen. Hinweis im Heute-Bildschirm, sachlich: „VL 8 baut auf VL 6 auf – Nacharbeitung VL 6 heute vorgezogen".

### F-PLN-05 · Stille Neuplanung
`P1` · Phase 4 · M11 · LP9

**Auslöser:**
- Block verpasst (Startzeit + 15 min ohne Start)
- Kalenderänderung
- Session beendet
- Nacharbeitung erledigt
- Lernstand stark verändert
- täglich 05:00

Verpasste Blöcke werden ohne Meldung neu verteilt. Fixierte Blöcke (`pinned`) bleiben. Passt etwas Wichtiges nicht mehr hinein (z. B. Klausur zu nah), steht das **einmal** sachlich im Tagesbriefing mit Vorschlag („2 Blöcke Wochenende hinzufügen?"), nie als Dauerwarnung.

### F-PLN-06 · Tagesbriefing
`P1` · Phase 4 · M7

Erster App-Start nach 05:00, als Karte auf dem Heute-Bildschirm, kein Dialog: heutige Termine, geplante Blöcke (Gesamtdauer), ein Satz zum Wichtigsten. Lesbar in 20 s, wegklickbar.

### F-PLN-07 · Tagesabschluss
`P1` · Phase 4 · M9 · LP9

Ab 20:00 auf dem Heute-Bildschirm: erledigt heute (positiv formuliert), morgen (erster Termin, Vorbereitung), optionale Mini-Aufgabe (≤ 5 min). Eine Frage zur Selbsteinschätzung, freiwillig (Z1): „Heute in der Vorlesung eine andere App gebraucht? ja/nein". Keine Liste von Unerledigtem.

### F-PLN-08 · Sonntags-Wochenplanung
`P1` · Phase 4 · M10

Sonntag ab 16:00 (einstellbar) eine Karte „Woche planen · ≈ 5 min":
1. Rückblick in drei Zahlen (Nacharbeitungen, Lernzeit, Readiness-Änderung je Fach)
2. Wochenplan als Kalender, Blöcke per Ziehen verschiebbar
3. „Passt so" bestätigt und fixiert nichts. Fixieren geht einzeln per Pin.

### F-PLN-09 · Blöcke anpassen
`P1` · Phase 4

Ziehen, Länge ändern, fixieren (Pin), überspringen („heute nicht"), eigenen Block anlegen. Überspringen ist neutral formuliert. Der Inhalt wird neu verteilt.

### F-PLN-10 · Fokus-Timer und Tageszeit-Analyse
`P2` · später

Timer im laufenden Block, erfasst die echte Dauer. Der Planer korrigiert damit seine Schätzungen (06 §4.2). Analyse, zu welchen Tageszeiten die Antworten am besten sind, verschiebt schwere Inhalte in diese Zeiten.

---

## VID · Lernvideos

Erzeugung: [Kap. 05 §P13–P15](05-KI-PIPELINE.md). Alle Videos hängen an Konzepten (Videothek nach Themen) und tragen Belege pro Abschnitt.

### F-VID-01 · V0 – Vorlesungs-Clips pro Thema
`P1` · Phase 5

Aus `slide_segment` + Audio + Konzept-Belegen: pro Konzept ein Clip aus den zugehörigen Folien (Standbild) und dem Originalton, 1–8 min, mit Kapitelmarken je Folie. Keine KI-Texte nötig, nur Schnitt.

### F-VID-02 · V1 – Vorlesungs-Recap
`P2` · Phase 5

5–10 min pro Vorlesung: KI-Skript aus Zusammenfassung und Konzepten → Sprachausgabe → Folien mit Hervorhebungen (Rahmen um `text_blocks`), eingeblendete Kernsätze, Untertitel.

### F-VID-03 · V2 – Schwächen-Video
`P2` · Phase 5 · LP6

Nur für Konzepte mit hohem Schwächen-Score **und** mindestens 3 Fehlversuchen nach der Nacharbeitung. 2–4 min:
1. Worum geht's
2. Voraussetzung kurz
3. Erklärung *anders als die Folie*: neues Beispiel, Analogie, Schritt für Schritt
4. Meine typischen Fehler und warum sie falsch sind
5. Fächerbrücke, falls vorhanden

Danach sofort **3 Prüffragen** (aktiv statt passiv).

### F-VID-04 · Videothek und Player
`P1` · Phase 5

Videothek nach Fach → Konzept. Player mit Kapiteln, Geschwindigkeit, Quellen-Chips je Abschnitt (Sprung zu Folie/Audio), „Prüffragen jetzt". Gesehen-Status. Keine Autoplay-Ketten.

---

## DAT · Daten & Sicherheit

### F-DAT-01 · Automatische Backups
`P0` · Phase 1 · LP3

- **Täglich um 03:00**, falls der Mac aus war beim nächsten Start: `pg_dump` + inkrementelle Kopie von `media/` und `vault/` an ein Ziel (externer Datenträger, iCloud-Drive-Ordner oder anderer Ordner).
- **Aufbewahrung:** 14 tägliche, 8 wöchentliche, 6 monatliche Stände.
- **Verschlüsselung (P1):** `age` mit Passphrase.
- **Status:** Einstellungen → Daten zeigen dezent „Letztes Backup: heute 03:02". Ist das letzte erfolgreiche Backup älter als 3 Tage, erscheint ein Hinweis im Tagesbriefing (einmal pro Tag).

### F-DAT-02 · Wiederherstellung
`P0` · Phase 1

`pnpm sg restore <stand>` stellt einen Stand komplett wieder her. Einzelne gelöschte Objekte kommen über den Papierkorb zurück (F-DAT-04). Die Wiederherstellung wird **monatlich automatisch getestet**: Restore in eine Wegwerf-Datenbank und Zählung der Objekte.

### F-DAT-03 · Export
`P0` (Vault) / `P1` (voll) · Phase 1 / 3 · LP12

- Der Vault ist jederzeit normales Markdown.
- **Vollexport:** ZIP mit JSON aller Tabellen (Schema dokumentiert), allen Medien und dem Vault.
- **Pro Fach:** PDF-Paket mit Folien, Notizen, Zusammenfassung und Glossar.

### F-DAT-04 · Papierkorb und Rückgängig
`P0` · Phase 1

Jede löschende Aktion zeigt 10 s „Rückgängig" (Toast, kein Dialog). Gelöschtes bleibt 30 Tage im Papierkorb (Einstellungen → Papierkorb), mit Wiederherstellen pro Objekt und abhängigen Objekten (Konzept + Karten).

### F-DAT-05 · Kostenzähler und Budget
`P1` · Phase 2

Kosten pro Session, pro Funktion (`task`) und pro Monat, mit Schätzung in Euro. Monatsbudget (Standard 10 €). Bei 80 % erscheint ein Hinweis im Tagesbriefing. Bei 100 % pausieren nicht-dringende Cloud-Jobs (V1/V2-Videos, Neu-Erzeugung von Karten). Transkription und Nacharbeitung laufen weiter, solange lokal möglich.

---

## EIN · Einstellungen

### F-EIN-01 · Einstellungen
`P0`–`P1` · Phase 1–4

| Bereich | Einstellungen |
|---|---|
| **Allgemein** | Datenordner, Sprache der Inhalte (de / en / gemischt), Erscheinungsbild (hell / dunkel / System) |
| **Geräte** | Gekoppelte Geräte, QR-Code für Kopplung, Gerät entfernen |
| **Vorlesung** | Mikrofon, Auto-Stopp-Zeiten, Standard-Layout, Standard-Schreibmodus pro Modul, Händigkeit (Werkzeugleiste links/rechts) |
| **Stift** | Doppeltipp-Aktion, Squeeze-Aktion, Formerkennung an/aus, Favoritenfarben |
| **KI** | Modus „nur lokal", Modellstufen je Aufgabe, Transkription lokal/Cloud, automatisch annehmen (aus / nur Beziehungen / alles mit Konfidenz ≥ 0,9), Monatsbudget |
| **Lernen** | Zeitbudget täglich, Zielbehaltensquote (Standard 0,90), Klausurmodus-Vorlauf (Standard 21 Tage), Stufen-Freischaltung |
| **Planer** | Lernfenster je Wochentag, Hochleistungszeiten, Maximalzeit pro Tag, freie Tage, Block-Min/Max, Sonntagsplanung an/aus und Uhrzeit, Google-Kalender |
| **Daten** | Backup-Ziel, Verschlüsselung, Export, Papierkorb, Kostenübersicht |

Jede Einstellung hat einen sinnvollen Standard. **Die App ist ohne Besuch der Einstellungen voll nutzbar.**

---

## Übersicht nach Phase

| Phase | Funktionen |
|---|---|
| **0** | F-ORG-01, F-ORG-02, F-ORG-03 (Upload), F-ORG-04 |
| **1** | F-KAL-01, F-KAL-02, F-SES-01 bis F-SES-05, F-DSH-01, -02, -04, -05, -06, F-INK-01 bis -07, -13, -14, F-SYN-01 bis -03, F-AUD-01, -02, F-DAT-01 bis -04, F-EIN-01 (Teil) |
| **2** | F-ORG-03 (Zerlegung), F-SES-06, F-DSH-03, -07, F-INK-08, -12, F-NAC-01 bis -08, F-BIB-01 bis -05, -07, F-SUC-01, F-DAT-05 |
| **3** | F-ORG-05, -06, F-INK-09, -10, -11, F-BIB-06, -08, -09, F-SUC-02, F-LRN-01 bis -17, F-DAT-03 (voll) |
| **4** | F-KAL-03, -04, -05, F-PLN-01 bis -09 |
| **5** | F-VID-01 bis -04 |
| **später** | F-DSH-08, F-INK-15, F-LRN-18 bis -21, F-PLN-10 |
