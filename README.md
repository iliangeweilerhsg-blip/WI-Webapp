# WI-Webapp – Studien-Gehirn

**Meine persönliche Wissensbibliothek fürs ganze Studium.**
Jede Vorlesung wird vollständig erfasst: Folie, Übung, Handschrift und Audio. Daraus entsteht automatisch ein verlinktes Wissensnetz. Die App plant meine Woche nach dem Stundenplan und gibt mir Fragen und Lernvideos genau dort, wo ich schwach bin.

> Setup: MacBook + iPad mit Apple Pencil · läuft lokal auf dem Mac · Vorlesungen dürfen aufgenommen werden

---

## Inhalt

1. [Der Lernzyklus](#der-lernzyklus)
2. [Ein Tag mit der App](#ein-tag-mit-der-app)
3. [Alle Funktionen](#alle-funktionen)
4. [Bewusst nicht drin](#bewusst-nicht-drin)
5. [UX-Richtlinien](#ux-richtlinien)
6. [Geräte & Einrichtung](#geräte--einrichtung)
7. [Technik](#technik)
8. [Fahrplan](#fahrplan)
9. [Dokumentation](#dokumentation)

---

## Der Lernzyklus

Alles in der App hängt an einem Kreislauf, der sich für jede Vorlesung wiederholt:

```
 ① Vorbereiten  →  ② Vorlesung  →  ③ Nacharbeiten  →  ④ Lernen  →  ⑤ Schwächen schließen
   Vorwissen        Folie + Übung     KI baut Wissens-    Fragen,        Lernvideos zu dem,
   auffrischen      + Notizen +       notizen und         Karteikarten,  was ich noch
                    Audio             Verknüpfungen       Probeklausur   nicht kann
        ▲                                                                      │
        └─────────────── Wochenplaner: Stundenplan + freie Zeit ◄──────────────┘
```

## Ein Tag mit der App

| Uhrzeit | Was passiert | Was die App tut |
|---|---|---|
| 07:30 · Zug | 10 Minuten Zeit | Fällige Karteikarten, offline und einhändig |
| 08:10 · Hörsaal | Mac und iPad auf den Tisch | Weiß aus dem Stundenplan, welche Vorlesung jetzt ist. **Ein Tipp auf „Start"**: Folien, Übung, Notizbuch und Aufnahme sind bereit. |
| 08:15–09:45 · Vorlesung | Ich schreibe mit | Nichts außer Mitschreiben. Unklares markiere ich mit einem Tipp auf ❓. Keine Popups. |
| 09:45 · Ende | Deckel zu, Raum wechseln | Stoppt von selbst. Transkription und Auswertung laufen im Hintergrund. |
| 13:00 · Freistunde | 45 Minuten in der Bibliothek | **Ein** Vorschlag: „Nacharbeitung Datenbanken VL 7 · 15 min". Geführt, jederzeit unterbrechbar. |
| 16:00 · Übung | Übungsblatt bearbeiten | Aufgabe, meine Lösung und die passenden Folien nebeneinander |
| 21:00 · Abends | Müde | 1-Minuten-Tagesabschluss. Verpasstes wird still auf die nächsten Tage verteilt. |

---

## Alle Funktionen

**Legende:** Die Zahl ist die Phase im [Fahrplan](#fahrplan) · ○ = optional · Ⓡ = Funktionsweise aus einer Referenz-App übernommen und angepasst (GoodNotes, StudySmarter, Quizlet, Anki, Notability)

### 1 · Vorlesung – Dashboard auf dem Mac

```
┌──────────────────────┬────────────────────┬────────────────────┐
│ FOLIE  ◄ 23/48 ►     │ ÜBUNG              │ NOTIZEN            │
│                      │ passt zu Folie 23: │ live vom iPad      │
│                      │ Blatt 4, A2b       │                    │
├──────────────────────┴────────────────────┴────────────────────┤
│ ● REC 00:42:13      ❓ 2   ⚠️ 1                    ⌘K Suche     │
└────────────────────────────────────────────────────────────────┘
```

| Funktion | Was sie macht | Phase |
|---|---|---|
| **Module, Vorlesungen, Uploads** | Folien- und Übungs-PDFs pro Modul per Drag & Drop | 0 |
| **3-Spalten-Dashboard** | Folie, passende Übung und Live-Notizen nebeneinander. Spalten lassen sich ein- und ausblenden. | 1 |
| **Ein-Tipp-Start** | Der Stundenplan sagt, welche Vorlesung jetzt ist. Ein Tipp öffnet alles und startet die Aufnahme. | 1 |
| **Auto-Stopp** | Stoppt am Kalenderende oder bei langer Stille. Ein vergessenes „Stopp" ist egal. | 1 |
| **Audio-Aufnahme** | In 30-Sekunden-Stücken gespeichert. Absturz, leerer Akku oder zugeklappter Deckel kosten höchstens ein paar Sekunden. | 1 |
| **Folienwechsel-Log** | Jeder Wechsel bekommt einen Zeitstempel. Darüber werden Folie, Audio und Notizen später verknüpft. | 1 |
| **Marker ❓ ⚠️ 🔗** | Ein Tipp: *nicht verstanden* · *klausurrelevant* · *erinnert mich an …*. Kein Text nötig, der Zeitstempel reicht. | 1 |
| **Übungs-Panel** | Zeigt automatisch die Aufgabe zur aktuellen Folie. Die Zuordnung wird **vor** der Vorlesung berechnet. | 2 |
| **⌘K-Schnellsuche** | In *meiner* Bibliothek nachschlagen, ohne das Dashboard zu verlassen | 2 |
| ○ **Folienloser Modus** | Folien kommen erst nachher? Läuft trotzdem, die Zuordnung passiert beim Hochladen. Korrigiert nebenbei vergessene Folienwechsel. | 2 |
| ○ **Klausurhinweis-Detektor** | „Das kommt in der Klausur" im Audio setzt automatisch ⚠️ | 2 |
| ○ **Live-Transkript-Ticker** | Das Gesagte läuft als Zeile mit. Standard ist: Transkript erst nach der Vorlesung. | später |

### 2 · Mitschreiben – Schreib-App auf dem iPad

| Funktion | Was sie macht | Phase |
|---|---|---|
| **Stift, Textmarker, Radierer** Ⓡ | Druck und Neigung. Der Textmarker liegt hinter dem Text. Der Radierer löscht ganze Striche, präzise oder nur Markierungen. | 1 |
| **Lasso** Ⓡ | Auswählen, verschieben, skalieren, umfärben | 1 |
| **Handballenerkennung & Pencil-Gesten** | Doppeltipp bzw. Squeeze wechselt das Werkzeug | 1 |
| **Zwei Schreibmodi** | *Freie Seite* (automatisch an die aktuelle Folie geheftet) oder *direkt auf die Folie schreiben* | 1 |
| **Folie blättern per Wisch** | Wischen auf dem iPad blättert auch am Mac weiter | 1 |
| **Marker-Stempel** | ❓ ⚠️ 🔗 als feste Buttons am Rand, gut mit dem Daumen erreichbar | 1 |
| **Tafel-Foto** | iPad-Kamera, das Bild landet mit Zeitstempel im Notizbuch | 1 |
| **Seitenvorlagen** | Blanko, liniert, kariert, **Cornell**. Die Spalte „Schlüsselfragen" füllt die KI nach der Vorlesung. | 2 |
| **Textfelder** | Getippter Text auf der Seite | 2 |
| **Formerkennung** Ⓡ | Zeichnen und kurz halten → saubere Linie, Pfeil, Rechteck, Kreis, Raute (für ER-Modelle, BPMN). Ist die Erkennung unsicher, bleibt der Strich, wie er ist. | 3 |
| **Abdeckband** Ⓡ | Teile der Notiz abdecken und zum Selbsttest antippen. **Neu:** „Alle zudecken" per Knopf, und jedes Band kann eine Karteikarte werden. | 3 |
| **Lasso → Karteikarte** | Bereich einkreisen → wird eine Karte mit Quelle | 3 |
| Zoom-Fenster, Handschrift → Text, Import alter GoodNotes-PDFs | Komfort und Altbestand | später |

### 3 · Nacharbeitung – läuft nach der Vorlesung von selbst

| Funktion | Was sie macht | Phase |
|---|---|---|
| **Transkription** | Deutsch und Englisch, mit Zeitstempeln | 2 |
| **Ausrichtung** | Das Transkript wird pro Folie zugeordnet, über das Folienwechsel-Log | 2 |
| **Rückblick** | Folie antippen → meine Notiz und was der Prof dazu gesagt hat, mit Abspielen ab genau der Stelle | 2 |
| **Audio-synchrone Wiedergabe** Ⓡ | Auf einen Strich tippen → das Audio spielt ab dem Moment, in dem ich ihn geschrieben habe | 2 |
| **Folie ↔ Übung** | Jede Aufgabe kennt ihre Folien, mit Begründung | 2 |
| **Konzepte erkennen & verknüpfen** | Neue Themen werden gefunden, Duplikate zusammengeführt, Voraussetzungen auch über Fächer hinweg verlinkt | 2 |
| **Geführte Nacharbeitung (≈ 15 min)** | ① meine ❓ zuerst klären → ② Zusammenfassung → ③ 3 Abruffragen → ④ Konzepte per Wisch bestätigen → ⑤ Karten aussortieren | 2 |
| **Inbox** | Alle KI-Vorschläge warten hier, bis ich sie bestätige. Nichts landet ungefragt im Wissensnetz. | 2 |

### 4 · Wissensbibliothek – Obsidian-Prinzip

| Funktion | Was sie macht | Phase |
|---|---|---|
| **Konzeptnotizen als Markdown** | Eine Notiz pro Thema mit `[[Links]]`. Echte Dateien, die auch in Obsidian funktionieren. | 2 |
| **Feste Notiz-Vorlage** | *In einem Satz* · *Kernidee in meinen Worten* · *Wofür brauche ich das?* · *Beispiel* · *Typische Fehler* · *Zusammenhänge* · *Belege* · *Offene Fragen* | 2 |
| **Belege an jeder Notiz** | Folien, Audio-Stellen, Handschrift und Aufgaben werden automatisch angehängt | 2 |
| **Beziehungstypen** | *baut auf* · *ist Beispiel für* · *Gegensatz zu* · *wird angewendet in* · *verwandt* | 2 |
| **Konzepte flach statt nach Fach** | Damit Verknüpfungen zwischen Fächern ganz natürlich entstehen | 2 |
| **Graph-Ansicht** | Das ganze Studium als Netz. Farben zeigen die Beherrschung, filterbar nach Fach und Semester. | 3 |
| **Fächerbrücken** | „Das kennst du aus Statistik II als …", eingeblendet in Notizen und Lernvideos | 3 |
| **Glossar pro Fach** | Automatisch aus den Konzepten, Deutsch und Englisch | 3 |

### 5 · Lernen

| Funktion | Was sie macht | Phase |
|---|---|---|
| **Fragetypen** | Karteikarte, Lückentext, Multiple Choice, offene Frage (die KI bewertet und erklärt), Rechenaufgabe, „Erkläre den Zusammenhang von A und B" | 3 |
| **Spaced Repetition mit FSRS** Ⓡ | Jede Karte kommt genau dann, wenn ich sie gerade vergessen würde. Bewertung: Nochmal / Schwer / Gut / Leicht. | 3 |
| **Lernsitzung** Ⓡ | Neue Konzepte in Runden, fertig bei *zweimal hintereinander richtig*. Getippte Antworten werden tolerant bewertet. | 3 |
| **Lernstufen pro Konzept** | Erkennen → Abrufen → Anwenden → Verknüpfen. Ein Konzept „sitzt" erst, wenn ich es anwenden kann. | 3 |
| **Beherrschung pro Konzept** | 0–100 %, mit ehrlicher Unsicherheit („~50 %, wenig Daten") | 3 |
| **Fehleranalyse** | Jede falsche Antwort bekommt einen Fehlertyp (verwechselt, Voraussetzung fehlt, Rechenfehler …). Daraus folgt die passende Hilfe. | 3 |
| **Markieren → Karte** Ⓡ | Auf Folie oder Notiz markieren → die KI formuliert die Karte, die Quelle wird verlinkt | 3 |
| **Bildverdeckung** Ⓡ | Beschriftungen in Diagrammen abdecken und abfragen (ER-Modelle, Prozesse) | 3 |
| **Frag deine Vorlesung** | Chat, der nur aus *meinem* Material antwortet, immer mit Quelle | 3 |
| **Probeklausur** Ⓡ | Gemischte Fragen mit Zeitlimit, im Stil der Altklausuren | 3 |
| **Klausur-Readiness** | Pro Fach: „heute 62 %, am Klausurtag 85 %, wenn du den Plan einhältst", dazu die 5 größten Lücken | 3 |
| **Altklausuren-Analyse** | Welche Themen wie oft und in welchem Fragestil vorkommen | 3 |
| **Klausurmodus** | Kurz vor der Klausur wird dichter wiederholt. Keine Karte „springt" über den Klausurtag. | 3 |
| ○ **Feynman-Modus** | Ich erkläre ein Thema laut oder schriftlich. Die KI findet Lücken und macht daraus Karten. | 3 |
| ○ **Übungsmodus** | Aufgabe, meine Lösung und die Musterlösung im Vergleich. Fehler fließen in die Schwächen. | 3 |
| Audio-Modus fürs Pendeln, Erhaltungsmodus nach dem Semester, Formelblatt-Generator, Anki-Export | Komfort und Langzeit | später |

### 6 · Wochenplaner

| Funktion | Was sie macht | Phase |
|---|---|---|
| **Stundenplan-Import** | ICS-Datei oder Google-Kalender (lesend). Vorlesungen werden automatisch den Modulen zugeordnet. | 1 (einfach), 4 (voll) |
| **Semesterstart-Assistent** | Stundenplan und Modulbeschreibungen rein → Module, Prüfungsform, Termine, ECTS angelegt | 4 |
| **Automatischer Wochenplan** | Lernblöcke in meinen freien Lücken, nach diesen Regeln: Nacharbeitung innerhalb von 24 h · Vorbereitung vor der nächsten Vorlesung · zusammengehörige Themen bündeln · schwere Themen in meine besten Zeiten · kurze tägliche Wiederholung · Klausurphase rückwärts vom Termin geplant | 4 |
| **Vorbereitungs-Check** | Die Folien der nächsten Vorlesung werden analysiert: Worauf bauen sie auf, auch aus anderen Fächern? Wo es hapert, gibt es 15–30 min Auffrischen **vorher**. | 4 |
| **Abhängigkeits-Warnung** | „VL 8 baut auf VL 6 auf, die noch nicht nachgearbeitet ist" → VL 6 wird vorgezogen | 4 |
| **Tagesbriefing & Tagesabschluss** | Morgens: was heute ansteht. Abends: 1 Minute Abschluss. | 4 |
| **Sonntags-Wochenplanung** | 5-Minuten-Rückblick und ein fertiger Plan zum Abnicken | 4 |
| **Still neu verteilen** | Verpasste Blöcke wandern ohne Meldung in die nächsten Tage | 4 |
| ○ **In Google-Kalender schreiben** | Lernblöcke als eigener Kalender „Lernplan" | 4 |
| Fokus-Timer, der echte Dauern lernt · Analyse der Tageszeit, zu der ich am besten lerne | Feinschliff | später |

### 7 · Lernvideos

| Stufe | Was | Phase |
|---|---|---|
| **V0 · Vorlesungs-Clips** | Automatische Clips pro Thema aus Folie und Originalton des Profs | 5 |
| **V1 · Vorlesungs-Recap** | 5–10 min: KI-Skript, Sprachausgabe und animierte Folien | 5 |
| **V2 · Schwächen-Videos** | 2–4 min pro schwachem Konzept, **erst nach** Nacharbeitung und Fragen. Greift genau meine Fehler auf, wiederholt Voraussetzungen und erklärt *anders* als die Folie. | 5 |
| **Videothek** | Alle Videos hängen am jeweiligen Konzept, die Bibliothek ist automatisch nach Themen sortiert | 5 |

### 8 · Daten & Sicherheit

| Funktion | Was sie macht | Phase |
|---|---|---|
| **Lokal zuerst** | Alles wird zuerst auf dem jeweiligen Gerät gespeichert. Ohne Netz arbeitet das iPad normal weiter und gleicht später ab. | 1 |
| **Automatische Backups** | Täglich | 1 |
| **Export** | Die Wissensnotizen sind jederzeit als Markdown verfügbar. Kein Lock-in. | 1 |
| **Papierkorb** | Gelöschtes bleibt 30 Tage wiederherstellbar | 1 |
| **Kostenzähler** | Zeigt, was Transkription und KI pro Vorlesung kosten | 2 |

---

## Bewusst nicht drin

| Was | Warum |
|---|---|
| Live-Auto-Folienverfolgung | Zu viel Aufwand für den Live-Betrieb. Vergessene Wechsel korrigiert der folienlose Modus nachträglich. |
| Streaks, Punkte, Gamification | Erzeugt Druck statt Lernen (Richtlinie 9) |
| Community- und fremde Lernsets | Mein eigenes Material ist die Quelle |
| Zusammenarbeit an Notizbüchern, Mehrbenutzer | Erst einmal nur für mich |
| Laserpointer und Präsentationsmodus | Brauche ich nicht |
| KI-Avatare in Lernvideos | Erzählte, animierte Folien reichen didaktisch |
| Lernspiele (Zuordnen o. Ä.) | Geringer Lerneffekt, höchstens irgendwann später |

---

## UX-Richtlinien

### Die 12 Leitprinzipien

Jede Funktion muss diese Prinzipien erfüllen. Herleitung: [Studienalltag](docs/STUDIENALLTAG.md).

1. **Null-Reibung in der Vorlesung.** Start mit einem Tipp. Einzige Pflicht-Interaktion: schreiben.
2. **Schreibgefühl ist nicht verhandelbar.** Fühlt es sich schlechter an als GoodNotes, ist alles andere egal.
3. **Nichts darf verloren gehen.** Lokal zuerst, Aufnahme in Stücken, offline-fest, Backups.
4. **Disziplin nicht voraussetzen.** Die App repariert Lücken: vergessenes Stopp, fehlende Folien, vergessener Folienwechsel, verpasste Lernblöcke.
5. **Ruhe in der Vorlesung, Intelligenz danach.**
6. **Aktiv statt passiv.** Abrufen, Erklären, Anwenden statt Durchlesen.
7. **Häppchen von 5–15 Minuten**, jederzeit unterbrechbar.
8. **Immer mit Quelle.** Jede KI-Aussage verweist auf Folie, Audio-Stelle oder Notiz.
9. **Ehrlicher Fortschritt, kein Schuld-UI.**
10. **Ein Wissensnetz fürs ganze Studium**, über Semester und Fächer hinweg.
11. **Nur einbauen, was einen echten Alltagsmoment verbessert.**
12. **Mein Wissen gehört mir.** Markdown, Export, kein Lock-in.

### Konkrete Interaktionsregeln

**In der Vorlesung**
- Zwischen Start und Stopp **kein Dialog, kein Popup, keine Benachrichtigung**.
- Jede Aktion braucht **höchstens einen Tipp**. Buttons auf dem iPad liegen am Rand, im Daumenbereich, mit mindestens 44 pt Tippfläche.
- Status wie Aufnahme oder Sync wird als **dezenter Punkt** angezeigt und blockiert nie. Fällt die Verbindung weg, wird der Punkt grau, eine Warnung gibt es nicht.
- Ruhiges, gedimmtes Design (Dunkelmodus), damit im Hörsaal nichts blendet.
- Tastenkürzel am Mac: `←` `→` Folie · `F` ❓ · `K` ⚠️ · `⌘K` Suche.

**KI**
- **Die KI schlägt vor, ich entscheide.** Vorschläge landen in der Inbox. Annehmen per Wisch oder `Enter`, ablehnen ohne Begründung.
- Jede KI-Aussage trägt einen **Quellen-Chip**. Ein Tipp darauf springt zur Folie bzw. zur Audio-Stelle.
- Unsicherheit wird gezeigt, nicht versteckt.

**Lernen & Planung**
- Jeder Block zeigt seine **Dauer vorher** („≈ 8 min"). Pausieren geht jederzeit, später geht es genau dort weiter.
- Statt einer Liste gibt es **einen** Vorschlag „Jetzt sinnvoll". Die volle Liste kommt nur auf Wunsch.
- **Keine roten Rückstandszahlen, keine Streaks.** Fortschritt wird als Prognose gezeigt.
- Abends schlägt die App nur noch leichte Aufgaben vor.

**Allgemein**
- **Offline ist der Normalzustand**, keine Fehlermeldung.
- **Rückgängig überall:** 10 Sekunden „Rückgängig" nach jeder Aktion, die etwas löscht, plus 30 Tage Papierkorb.
- **Leere Zustände** erklären den nächsten Schritt („Noch keine Folien? Einfach hier hineinziehen – oder ohne Folien starten").
- **Schnell:** App offen in unter 2 s, startklar in der Vorlesung in unter 10 s.
- **Sprache:** Deutsch, Fachbegriffe zusätzlich auf Englisch.

---

## Geräte & Einrichtung

| Gerät | Rolle | Wie es läuft |
|---|---|---|
| **MacBook** | Dashboard, Bibliothek, Lernen, Planer, Aufnahme, lokaler Server | Web-App im Browser, Server lokal per Docker |
| **iPad + Apple Pencil** | Mitschreiben | Native App (SwiftUI + PencilKit). Läuft in **Swift Playgrounds** ohne Ablaufdatum und ohne Developer-Account, alternativ per Xcode mit 7-Tage-Signatur. |

**Verbindung:** Das iPad findet den Mac im selben WLAN. Lässt das Uni-WLAN keine direkte Verbindung zu, schreibt das iPad trotzdem normal weiter und gleicht später ab. Durch die Zeitstempel bleibt die Zuordnung zu Folie und Audio erhalten. Für die Live-Anzeige im Hörsaal geht ein Hotspot.

*(Installationsanleitung folgt mit Phase 0.)*

## Technik

| Bereich | Wahl |
|---|---|
| Web-App (Mac) | Next.js, React, TypeScript, Tailwind, pdf.js |
| iPad-App | SwiftUI + PencilKit, als `.swiftpm`-Projekt |
| Server & Sync | Node/TypeScript, WebSocket, lokal auf dem Mac |
| KI-Worker | Python: PyMuPDF, Whisper, Claude API, Embeddings, TTS |
| Datenbank | PostgreSQL + pgvector |
| Lernalgorithmus | FSRS (`ts-fsrs` / `py-fsrs`) |
| Wissensnotizen | Markdown-Vault, Obsidian-kompatibel |
| Videos | Remotion + Sprachausgabe |
| Betrieb | Docker Compose |

## Fahrplan

| Phase | Inhalt | Danach kann ich … |
|---|---|---|
| **0 · Fundament** | Projekt-Grundgerüst, Datenbank, Uploads, PDF-Anzeige | Folien und Übungen pro Modul ablegen und ansehen |
| **1 · Vorlesung** | Test von PencilKit in Swift Playgrounds, iPad-Schreib-App, Dashboard, Aufnahme, Ein-Tipp-Start, Backups | **in der nächsten Vorlesung alles an einem Ort haben** |
| **2 · Nacharbeitung** | Transkription, Rückblick, Folie ↔ Übung, Konzepte, Wissensbibliothek, Inbox | jede Vorlesung als verlinkte Wissensnotizen nacharbeiten |
| **3 · Lernen** | Fragen, FSRS, Lernsitzungen, Beherrschung, Probeklausur, Readiness | für die Klausuren mit der App lernen |
| **4 · Planen** | Wochenplaner, Vorbereitungs-Check, Tagesbriefing | meine Woche planen lassen |
| **5 · Videos** | V0 → V1 → V2, Videothek | Schwächen mit Videos schließen |

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [docs/KONZEPT.md](docs/KONZEPT.md) | Gesamtkonzept, Architektur, Datenmodell, Entscheidungen |
| [docs/STUDIENALLTAG.md](docs/STUDIENALLTAG.md) | Alltagsmomente M1–M13 und Herleitung der Leitprinzipien |
| [docs/FEATURE-KATALOG.md](docs/FEATURE-KATALOG.md) | Bewertung jeder Funktion aus den Referenz-Apps, eigene Vorschläge |
| [docs/LERNMODELL.md](docs/LERNMODELL.md) | FSRS, Beherrschung, Schwächen-Score, Klausur-Readiness |
| [docs/referenz-analysen/](docs/referenz-analysen/) | Recherche-Ergebnisse zu GoodNotes, Quizlet, StudySmarter mit Quellen |
| [CLAUDE.md](CLAUDE.md) | Projekt-Memory für Claude |
