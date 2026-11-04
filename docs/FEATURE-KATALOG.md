# Feature-Katalog

> Welche Funktionen übernehmen wir aus Referenz-Apps, und welche Funktionen kommen neu dazu?
> **Regel:** Eine Funktion kommt nur rein, wenn sie einen konkreten Moment aus dem [Studienalltag](spezifikation/01-PRODUKT.md#8-alltagsmomente-kurzfassung) (M1–M13) verbessert.

---

## 1. Prozess: Wie wir herausfinden, wie eine Funktion funktioniert

Wir wollen verstehen, *wie* eine Funktion in einer Referenz-App funktioniert, und sie dann **selbst und passend zu unserem Datenmodell** bauen.

```
1. MOMENT     Welcher Alltagsmoment (M1–M13) wird besser?        → kein Moment = kein Feature
2. RECHERCHE  Quellen in dieser Reihenfolge (siehe unten)        → Interaktion, Logik, Edge-Cases
3. GATE       Nutzen-Check: P0/P1/P2? Was lassen wir weg?        → Eintrag in diesem Katalog
4. ADAPTION   Wie wird es *besser* durch unsere Verknüpfungen?   → z. B. Strich ↔ Folie ↔ Audio
5. BAU        Eigene Umsetzung, eigenes UI                       → Status hier aktualisieren
```

**Quellen-Reihenfolge – Claude holt sich die Infos selbst, du nennst nur die App:**

| # | Quelle | Wer | Wofür |
|---|---|---|---|
| 1 | **Öffentliche Infos:** Hilfe-Center, Produktseiten, Changelogs, Tutorial-Videos (inkl. YouTube-Transkripte) | Claude, per Web-Recherche | Reicht für die meisten Funktionen: Was macht sie, wie bedient man sie, welche Sonderfälle gibt es? |
| 2 | **Open-Source-Pendants** mit offenem Quellcode, z. B. Anki + FSRS (Lernalgorithmus), Saber und Xournal++ (Handschrift-Apps), perfect-freehand (Strichglättung) | Claude | Algorithmen und Datenstrukturen ganz legal im Detail nachlesen |
| 3 | **Deine Beobachtung:** kurze Bildschirmaufnahme oder Beschreibung, wie du eine Funktion in GoodNotes nutzt | du, nur bei Bedarf | Was dir am Schreibgefühl wichtig ist, steht in keiner Doku |
| 4 | **REA-Skill** (`rea-reverse-engineering`) | Claude, mit einer Datei von dir | Nur für konkrete Restfragen, die 1–3 nicht beantworten |

**Zu Stufe 4 (REA):**
- REA analysiert nur Dateien, die hochgeladen werden, und arbeitet nur statisch. Die Regeln des Skills verbieten, Server oder URLs aufzurufen, die in der untersuchten App stehen.
- **GoodNotes:** Falls wir es brauchen, lädst du GoodNotes kostenlos aus dem Mac App Store, packst die `.app` aus dem Programme-Ordner als ZIP und lädst sie hoch. Mehr ist nicht nötig.
- **Quizlet / StudySmarter:** Hier lohnt sich REA kaum. Die interessanten Teile (Lernmodus, Auswertung) liegen hinter dem Login und vermutlich auf deren Servern. Für diese Apps reichen Stufe 1–3. Selbst herunterladen und zerlegen werde ich die Web-Apps nicht.
- Wir übernehmen **Funktionsweisen**, nie fremden Code, Grafiken, Icons, Markennamen oder Design. Eigenes UI, eigene Umsetzung. Das hält auch einen späteren Verkauf sauber.
- Ergebnisse pro App kommen nach `docs/referenz-analysen/<app>.md`: was gesehen, was abgeleitet, was unklar ist.
- Recherche-Stand 03.11.2026: Abdeckband, Formerkennung, Lernmodus und Magic Marker sind geklärt (Quellen in `referenz-analysen/`).

**Legende:** ✅ übernehmen · 🔧 übernehmen und anpassen · ⏳ später · ❌ weglassen · 🔍 noch zu recherchieren

---

## 2. GoodNotes – Handschrift & Notizbücher

| Funktion | Entscheidung | Prio | Moment | Warum / unsere Variante |
|---|---|---|---|---|
| Stift mit Druck/Neigung, Farben, Strichstärken | ✅ | P0 | M3 | Basis des Schreibgefühls |
| Textmarker (hinter dem Text, gerade Linie beim Halten) | ✅ | P0 | M3 | Folien markieren |
| Radierer (ganzer Strich / präzise / nur Textmarker) | ✅ | P0 | M3 | |
| Handballenerkennung, Pencil-Doppeltipp (Werkzeugwechsel), Squeeze bei Pencil Pro | ✅ | P0 | M3 | Geht nur nativ, siehe Entscheidung E1 im Konzept |
| Lasso: verschieben, skalieren, Farbe ändern | ✅ | P0 | M3 | |
| Lasso → **Karteikarte erstellen** | 🔧 | P1 | M7 | Bereich auf Notiz/Folie einkreisen → wird Karte (eigene Idee, baut auf Lasso auf) |
| Lasso → in Text umwandeln | ⏳ | P2 | M5 | Kommt mit der Handschrifterkennung |
| Formen-Erkennung (Linie/Kreis/Pfeil beim Halten) | 🔧 | P1 | M3 | Für Diagramme (ER, BPMN, Graphen) unverzichtbar. Lieber nichts erkennen als falsch ([Recherche](referenz-analysen/goodnotes.md)) |
| Zoom-Fenster (groß schreiben, klein ablegen) | ⏳ | P2 | M3 | Nett, aber kein Muss |
| Seitenvorlagen: blanko, liniert, kariert, **Cornell** | 🔧 | P1 | M3 | Cornell-Vorlage mit KI-Spalte „Schlüsselfragen", die nach der VL gefüllt wird |
| PDF importieren und direkt annotieren | ✅ | P0 | M3 | Modus „Auf die Folie schreiben" |
| Handschriftsuche | 🔧 | P1 | M5 | In die globale ⌘K-Suche integriert |
| Gliederung / Lesezeichen | 🔧 | P1 | M5 | Ergibt sich aus Folienstruktur und Konzepten |
| **Abdeckband** (Teile verdecken, zum Selbsttest antippen) | 🔧 | P1 | M7 | Dazu „Alle zudecken" per Knopf, und jedes Band kann eine FSRS-Karte werden ([Recherche](referenz-analysen/goodnotes.md)) |
| Bilder / Kamera einfügen | 🔧 | P0 | M3 | **Tafel-Foto mit Zeitstempel** |
| Textfelder | ✅ | P1 | M3 | |
| Sticker / Elemente | 🔧 | P1 | M4 | Nur als **Marker-Stempel** ❓ ⚠️ 🔗 mit Bedeutung |
| Laserpointer, Präsentationsmodus | ❌ | – | – | Brauche ich nicht |
| Eigene Karteikarten in GoodNotes | ❌ | – | – | Machen wir besser im Lernmodul |
| Teilen / Zusammenarbeit an Notizbüchern | ❌ | – | – | Nicht-Ziel |

**Bonus aus Notability** (vergleichbare App): **Audio-synchrone Wiedergabe.** Ich tippe auf einen Strich, und das Audio spielt ab dem Moment, in dem ich ihn geschrieben habe. Beim Abspielen „entstehen" die Notizen neu. → ✅ **P1, M7.** Das wird durch die Zeitstempel pro Strich fast geschenkt.

## 3. StudySmarter – Lernplanung & Inhalte

| Funktion | Entscheidung | Prio | Moment | Warum / unsere Variante |
|---|---|---|---|---|
| Lernplan bis zum Prüfungstermin | 🔧 | P1 | M10, Klausur | Bei uns mit echtem Stundenplan und freien Slots statt nur „x Karten pro Tag" |
| Karteikarten automatisch aus PDFs / Folien | 🔧 | P1 | M7 | Bei uns aus Folien **plus Transkript plus meinen ❓-Markern** |
| Text in PDF markieren → Karteikarte („Magic Marker") | 🔧 | P1 | M7 | Die KI formuliert die Karte, die Quelle wird automatisch verlinkt ([Recherche](referenz-analysen/studysmarter.md)) |
| Karten mit Bild / Formel (LaTeX) | ✅ | P1 | M1 | WI braucht Formeln und Diagramme |
| Verschiedene Fragetypen (MC, offen, Lückentext …) | ✅ | P1 | M1, M7 | |
| Lernstatistiken pro Fach | 🔧 | P1 | M10 | Als **Klausur-Readiness** (siehe [Lernmodell](spezifikation/06-LERNMODELL-PLANER.md)) |
| Zusammenfassungen | 🔧 | P1 | M7 | Vorlesungs-Zusammenfassung mit Quellen-Links |
| Streaks, Lernziele, Gamification | ❌ | – | M9 | Widerspricht Leitprinzip 9. Stattdessen: ehrliche Prognose |
| Community-Inhalte / fremde Lernsets | ❌ | – | – | Mein Material ist die Quelle |

## 4. Quizlet – Lernmodi

| Funktion | Entscheidung | Prio | Moment | Warum / unsere Variante |
|---|---|---|---|---|
| Karteikarten mit Wischen („kann ich" / „lerne ich noch") | 🔧 | P1 | M1 | Wischen bleibt, die Bewertung läuft über FSRS (Nochmal/Schwer/Gut/Leicht) |
| **Lernmodus** (Runden, fertig bei zweimal hintereinander richtig, tolerante Bewertung) | 🔧 | P1 | M7 | Erweitert zu **Lernstufen pro Konzept**: Erkennen → Abrufen → Anwenden → Verknüpfen ([Recherche](referenz-analysen/quizlet.md)) |
| **Test-Modus** (generierte Probeprüfung mit gemischten Fragetypen) | 🔧 | P1 | Klausur | Im **Stil der Altklausuren**, mit Zeitlimit |
| Begriff ↔ Definition umkehren | ✅ | P1 | M1 | |
| Karten markieren (Stern) | ✅ | P1 | M1 | |
| **Diagramme beschriften** (Bild mit verdeckten Labels) | 🔧 | P1 | M7 | Als **Bildverdeckung auf Folien**, z. B. ER-Modelle, Prozessdiagramme |
| KI-Tutor / Chat | 🔧 | P1 | M7 | **„Frag deine Vorlesung":** antwortet nur aus meinem Material, mit Quellen |
| Notizen → Lernset | 🔧 | P1 | M7 | Ist bei uns die KI-Pipeline |
| Zuordnen-Spiel (Match), weitere Spiele | ⏳ | P2 | M1 | Nett zum Aufwärmen, nicht wichtig |
| Diktat / Rechtschreibmodus | ❌ | – | – | Für WI nicht relevant |

## 5. Anki – Algorithmus (nur zur Inspiration)

| Funktion | Entscheidung | Prio | Warum |
|---|---|---|---|
| FSRS-Algorithmus inkl. Optimierer | ✅ | P1 | Siehe [Lernmodell](spezifikation/06-LERNMODELL-PLANER.md) |
| Lückentext-Karten (Cloze) | ✅ | P1 | Ideal für Definitionen |
| Bildverdeckung (Image Occlusion) | ✅ | P1 | Siehe Quizlet-Diagramme |
| Anki-Export (.apkg) | ⏳ | P2 | Karten mit Lerngruppe teilen, kein Lock-in |

---

## 6. Neue Funktionsvorschläge (eigene Ideen)

Aus der Alltagsanalyse abgeleitet. Sortiert nach Wirkung.

**Rückmeldung vom 03.11.2026:** N2, N4, N8 und N9 bestätigt (optional, P1). N1 abgelehnt. Die übrigen Vorschläge sind noch offen.

| # | Funktion | Status | Moment | Prio | Kurzbeschreibung |
|---|---|---|---|---|---|
| N1 | ~~**Auto-Folienverfolgung (live)**~~ | ❌ abgelehnt | M3 | – | Zu viel Aufwand für den Live-Betrieb. Ersatz ohne Mehraufwand: Vergessene Folienwechsel korrigiert **nach** der Vorlesung dieselbe Zuordnung wie im folienlosen Modus (N4). |
| N2 | **Klausurhinweis-Detektor** | ✅ bestätigt | M4 | P1 | Erkennt Sätze wie „das kommt in der Klausur" im Audio und setzt automatisch einen ⚠️-Marker. Diese Stellen haben beim Lernen höchste Priorität. |
| N3 | **Ein-Tipp-Start aus dem Stundenplan** | offen | M2 | P0 | Die App weiß, welche Vorlesung jetzt läuft, und öffnet alles. Auto-Stopp am Ende. |
| N4 | **Folienloser Modus + spätere Zuordnung** | ✅ bestätigt | M2 | P1 | Folien kommen nachher? Die Zuordnung zu Audio und Notizen passiert automatisch beim Hochladen. Korrigiert nebenbei vergessene Folienwechsel. |
| N5 | **Tafel-Foto mit Zeitstempel** | offen | M3 | P0 | iPad-Kamera, Bild landet an der richtigen Stelle im Notizbuch, später OCR. |
| N6 | **⌘K-Schnellsuche** | offen | M5 | P1 | In Konzepten, Folien, Transkripten und Handschrift, auch während der Vorlesung. |
| N7 | **Geführte Nacharbeitung (15 min)** | offen | M7 | P1 | ❓ klären → Zusammenfassung → 3 Abruffragen → Konzepte bestätigen → Karten aussortieren. |
| N8 | **Feynman-Modus („Erklär's mir")** | ✅ bestätigt | M7 | P1 | Ich erkläre ein Konzept laut oder schriftlich. Die KI findet Lücken und Fehler und erzeugt daraus Karten. |
| N9 | **Übungsmodus mit Lösungsvergleich** | ✅ bestätigt | M8 | P1 | Aufgabe, eigene Lösung, Musterlösung. Fehler werden Konzepten zugeordnet. |
| N10 | **Abhängigkeits-Warnung** | offen | M12 | P1 | „VL 8 baut auf VL 6 auf, die noch nicht nachgearbeitet ist." Die Nacharbeitung von VL 6 wird vorgezogen. |
| N11 | **Klausur-Readiness & Prognose** | offen | Klausur | P1 | Pro Fach: „Stand heute 62 %, bei aktuellem Tempo 85 % am Klausurtag". Dazu die 5 wichtigsten Lücken. |
| N12 | **Altklausuren-Analyse** | offen | Klausur | P1 | Themengewichtung und Fragestil lernen und daraus Klausursimulationen bauen. |
| N13 | **Tagesbriefing & Tagesabschluss** | offen | M7, M9 | P1 | Morgens: was heute ansteht. Abends: 1-Minuten-Abschluss ohne Schuld-UI. |
| N14 | **Sonntags-Wochenplanung** | offen | M10 | P1 | 5-Minuten-Rückblick und Wochenplan zum Abnicken. |
| N15 | **Audio-Lernmodus fürs Pendeln** | offen | M1 | P2 | Karten werden vorgelesen, ich antworte laut, die KI bewertet. |
| N16 | **Fächerbrücken** | offen | – | P1 | „Das kennst du aus Statistik II als …". Wird in Notizen und Lernvideos automatisch eingeblendet. |
| N17 | **Fokus-Timer, der dazulernt** | offen | M7 | P2 | Erfasst die echte Dauer meiner Blöcke. Der Planer schätzt danach realistischer. |
| N18 | **Leistungs-Tageszeit-Analyse** | offen | M10 | P2 | Wann beantworte ich Fragen am besten? Schwere Themen landen in diesen Zeitfenstern. |
| N19 | **Semesterstart-Assistent** | offen | Semester | P1 | Stundenplan (ICS) und Modulbeschreibungen importieren → Module, Prüfungsform, ECTS, Termine. |
| N20 | **Formelblatt- / Spickzettel-Generator** | offen | Klausur | P2 | Für erlaubte Hilfsmittel: verdichtet aus meinen Konzepten und Formeln. |
| N21 | **Glossar pro Fach** | offen | M5 | P1 | Automatisch aus den Konzepten, zweisprachig (DE/EN). |
| N22 | **Import verpasster Vorlesungen** | offen | M13 | P1 | Fremde oder offizielle Aufzeichnung läuft durch dieselbe Pipeline. |
| N23 | **Erhaltungsmodus nach dem Semester** | offen | Semester | P2 | Wenige Wiederholungen pro Woche halten die Grundlagen aktiv. |
| N24 | **Automatische Backups + Export** | offen | – | P0 | Täglich verschlüsselt sichern, Vault als Markdown jederzeit exportierbar. |
