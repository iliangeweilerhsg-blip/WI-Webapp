# Studienalltag – UX-Analyse

> Ziel: Bevor wir bauen, verstehen, **in welchen Momenten** die App wirklich hilft – und wo sie stört.
> Jede Funktion muss sich auf mindestens einen dieser Momente zurückführen lassen (siehe [Feature-Katalog](FEATURE-KATALOG.md)).

**Setup:** MacBook + iPad mit Apple Pencil · Vorlesungen dürfen aufgenommen werden · Vorlesungen teils Deutsch, teils Englisch (annehmen, bis geklärt).

---

## 1. Ein normaler Vorlesungstag – Moment für Moment

### 07:30 · Unterwegs (Zug / Frühstück)
*Situation:* 10–20 Minuten, eine Hand frei, oft schlechtes Netz.
*Was ich will:* Die fälligen Karteikarten durchgehen, ohne nachzudenken, was dran ist.
*Moment M1 – „Totzeit nutzen".*
→ Review-Modus muss **offline**, **einhändig** und in **< 5 s startbereit** sein. Optional: **Audio-Modus** (Karte wird vorgelesen, ich antworte laut).

### 08:05 · Ankunft im Hörsaal
*Situation:* Enger Klapptisch, Mac + iPad, 5 Minuten bis Beginn, Uni-WLAN wackelig. Hat der Prof die Folien hochgeladen? Manchmal ja, manchmal erst nachher, manchmal gar nicht.
*Moment M2 – „Startklar in 10 Sekunden".*
→ Die App weiß aus dem Stundenplan, **welche Vorlesung jetzt ist**, öffnet sie mit Folien und Übung, und das iPad springt ins richtige Notizbuch. **Ein Tipp: „Start"** → Aufnahme läuft, Notizen laufen.
→ Fehlende Folien sind **kein Blocker**: Die Vorlesung läuft im „folienlosen Modus" und wird später automatisch mit den Folien verknüpft, sobald sie da sind.
→ Am Vorabend Hinweis: „Folien für morgen fehlen noch" bzw. „Morgige VL baut auf *X* auf – 15 min auffrischen?"

### 08:15–09:45 · In der Vorlesung
Typische Realität:
- Der Prof **springt** zwischen Folien, zeigt Live-Demos, Videos, schreibt an die **Tafel**, redet 10 Minuten frei.
- Ich schreibe mit – und **vergesse**, die Folie umzublättern.
- Ich verstehe etwas nicht, will aber nicht den Faden verlieren.
- Der Prof sagt: *„Das sollten Sie für die Klausur können."*
- Mir fällt ein: „Das hatten wir doch in Statistik…" – aber ich will jetzt nicht suchen.

*Moment M3 – „Mitschreiben ohne Reibung".*
→ **Schreibgefühl wie GoodNotes** – Latenz, Handballenerkennung, Pencil-Gesten. Hier entscheidet sich, ob ich die App benutze.
→ **Blättern mit einem Wisch auf dem iPad.** Vergesse ich einen Wechsel, ist das egal: **Nach** der Vorlesung gleicht die App Transkript und Folien ab und korrigiert die Zuordnung. Nichts davon läuft live.
→ **Tafel-Foto** mit der iPad-Kamera, landet mit Zeitstempel im Notizbuch.

*Moment M4 – „Merken, nicht klären".*
→ **❓ / ⚠️ / 🔗 mit einem Tipp** auf dem iPad (oder Pencil-Doppeltipp). Kein Text nötig, der Zeitstempel reicht – die KI holt sich den Kontext später aus dem Audio.
→ **Automatischer ⚠️-Marker**, wenn der Prof Klausurhinweise gibt („klausurrelevant", „das kommt dran", „das sollten Sie können" …).

*Moment M5 – „Kurz nachschlagen".*
→ **⌘K-Schnellsuche** in *meiner* Bibliothek: „Varianz" → meine Konzeptnotiz aus Statistik, in 2 Sekunden, ohne das Dashboard zu verlassen.

*Grundsatz:* **Während der Vorlesung keine KI-Popups, keine Benachrichtigungen, keine Entscheidungen.** Das Übungs-Panel zeigt dezent, welche Aufgabe zur Folie passt. Mehr nicht.

### 09:45 · Vorlesungsende
*Situation:* Deckel zu, Raum wechseln, nächste Vorlesung in 15 Minuten.
*Moment M6 – „Einfach gehen können".*
→ Vergessenes „Stopp" ist egal: **Auto-Stopp** am Kalenderende bzw. bei langer Stille.
→ Upload und KI-Verarbeitung laufen **im Hintergrund**. Deckel zu, Netzwechsel, Akku leer – nichts geht verloren (Aufnahme in Stücken gespeichert).

### 13:00 · Freistunde in der Bibliothek (45 min)
*Situation:* Etwas Zeit, aber keine Lust auf „Planung".
*Moment M7 – „Sag mir, was jetzt sinnvoll ist".*
→ Die App schlägt **genau einen Block** vor: „Nacharbeitung *Datenbanken VL 7* (15 min) + 12 fällige Karten (8 min)".
→ **Nacharbeitung ist geführt** und in Häppchen unterbrechbar:
  1. Meine ❓ zuerst – KI erklärt mit Folie + Audio-Stelle.
  2. 5-Satz-Zusammenfassung lesen, **dann** 3 Abruffragen (aktiv statt passiv).
  3. Neue Konzepte per Wisch bestätigen / zusammenführen.
  4. Vorgeschlagene Karten behalten / verwerfen.

### 16:00 · Übung / Tutorium
*Situation:* Übungsblatt bearbeiten, später Lösungen besprechen.
*Moment M8 – „Übung ist kein Anhang".*
→ **Übungsmodus:** Aufgabe links, meine Lösung (Handschrift) rechts, passende Folien auf Abruf.
→ Musterlösung hochladen → **Vergleich**; meine Fehler werden den Konzepten zugeordnet (fließt in die Schwächen).
→ Abgabe-Deadlines im Planer.

### 21:00 · Abends
*Situation:* Müde. Keine großen Entscheidungen mehr.
*Moment M9 – „Den Tag abschließen".*
→ **Tagesabschluss in 1 Minute:** Was erledigt ist, was morgen ansteht, eine optionale Mini-Aufgabe. **Kein roter Rückstandsberg** – Verpasstes verteilt der Planer still neu.

---

## 2. Die Woche

| Moment | Situation | Konsequenz für die App |
|---|---|---|
| **M10 – Sonntagsplanung** | 5 min Überblick: Was kommt, was hängt? | Wochenrückblick + automatischer Wochenplan, den ich nur noch abnicke oder verschiebe |
| **M11 – Plan bricht** | Gruppenarbeit, Job, Sport, krank | Plan passt sich an, ohne Schuld-UI; Prioritäten bleiben erhalten |
| **M12 – Abhängigkeiten** | VL 8 baut auf VL 6 auf, die noch nicht nachgearbeitet ist | Warnung + Nacharbeitung VL 6 wird vorgezogen |
| **M13 – Verpasste Vorlesung** | Krank / Überschneidung | Aufnahme eines anderen oder offizielle Aufzeichnung importieren → läuft durch dieselbe Pipeline |

## 3. Das Semester

| Phase | Realität | Konsequenz |
|---|---|---|
| **Wochen 1–3** | Locker, viel Neues, Module noch unklar | **Semesterstart-Assistent:** Stundenplan + Modulbeschreibungen importieren → Module, Prüfungsform, Termine, ECTS angelegt |
| **Mitte** | Abgaben häufen sich, Nacharbeitung rutscht | Planer schützt kurze tägliche Wiederholung; Nacharbeitung wird kleiner statt zu verschwinden |
| **Klausurphase** | 4–6 Prüfungen in 2–3 Wochen, Panik, Altklausuren | **Klausur-Readiness pro Fach**, Rückwärtsplanung vom Klausurtermin, Klausursimulation im Stil der Altklausuren, Spickzettel-/Formelblatt-Generator (wo erlaubt) |
| **Nach dem Semester** | Wissen verblasst, nächstes Semester baut darauf auf | **Erhaltungsmodus:** wenige Wiederholungen pro Woche halten die Grundlagen am Leben; Brücken zu neuen Fächern werden automatisch gezogen |

---

## 4. Kristallisierte Leitprinzipien

Diese Faktoren gelten für **jede** Entscheidung im Projekt (auch in [CLAUDE.md](../CLAUDE.md) festgehalten).

1. **Null-Reibung in der Vorlesung.** Start mit einem Tipp. Einzige Pflicht-Interaktion während der Vorlesung: schreiben.
2. **Schreibgefühl ist nicht verhandelbar.** Fühlt es sich schlechter an als GoodNotes, nutze ich es nicht – dann ist alles andere egal.
3. **Nichts darf verloren gehen.** Lokal speichern zuerst, Aufnahme in Stücken, offline-fest, automatische Backups.
4. **Disziplin nicht voraussetzen.** Die App repariert Lücken: vergessener Folienwechsel, vergessenes Stopp, fehlende Folien, ausgelassene Lernblöcke.
5. **Ruhe in der Vorlesung, Intelligenz danach.** Die KI arbeitet im Hintergrund und meldet sich erst, wenn ich Zeit habe.
6. **Aktiv statt passiv.** Nacharbeitung und Lernen bestehen aus Abrufen, Erklären und Anwenden – nicht aus Durchlesen.
7. **Häppchen von 5–15 Minuten.** Alles ist jederzeit unterbrechbar und passt in Freistunden.
8. **Immer mit Quelle.** Jede KI-Aussage verlinkt auf Folie, Audio-Stelle oder Notiz. Sonst vertraue ich ihr nicht.
9. **Ehrlicher Fortschritt, kein Schuld-UI.** Realistische Prognosen statt Streak-Druck; Verpasstes wird still neu verteilt.
10. **Ein Wissensnetz fürs ganze Studium.** Nicht pro Klausur denken, sondern über Semester und Fächer hinweg.
11. **Nur übernehmen, was einen Moment verbessert.** Jede Funktion (auch aus GoodNotes, StudySmarter, Quizlet) muss auf einen Moment M1–M13 einzahlen.
12. **Mein Wissen gehört mir.** Markdown/Obsidian-kompatibel, exportierbar, kein Lock-in.
