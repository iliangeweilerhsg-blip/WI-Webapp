# Prüfliste: Folien in der Vorlesung

Diese Liste ist für dich als Owner, am Mac im Hörsaal. Sie prüft das Feature „Folien in der Vorlesung“ einmal von vorn bis hinten. Die Bedienung steht in [VORLESUNGSTAG.md](VORLESUNGSTAG.md), Abschnitt „Folien“.

Du brauchst: den Mac, das iPad mit der App, ein Modul mit Moodle-Kurs und eine Vorlesung heute im Kalender. Am besten gibt es im Modul zwei Foliensätze, einen älteren und einen neueren. Hake jeden Schritt ab. Was anders aussieht als beschrieben, schreibst du mit Schritt und Uhrzeit auf.

Nicht jeder Schritt geht an jedem Tag. Diese Voraussetzungen gelten, die Schritte stehen in der Reihenfolge, in der sie an einem normalen Vorlesungstag machbar sind:

- **Schritte 1 bis 3, 5 bis 7:** eine Vorlesung heute, die noch nicht läuft.
- **Schritt 4 (optional):** die Vorlesung liegt noch mehr als 15 Minuten in der Zukunft und der Dozent lädt in dieser Zeit neue Folien hoch. Sonst überspringen.
- **Schritt 8:** eine zweite Session. **Session starten** auf **Heute** erscheint erst, wenn keine Session mehr läuft oder pausiert. Beende also die erste Vorlesung zuerst, oder nimm die nächste Vorlesung des Tages.
- **Schritt 9 (optional):** nur, wenn der Dozent während der Vorlesung neue Folien hochlädt.
- **Schritt 11 (optional):** heute gibt es eine Vorlesung ohne Foliensatz im Zustand geplant, bereit, läuft oder pausiert. Sonst fehlt das Feld **Für Vorlesung** ganz.

## Vorher

- [ ] **Update ziehen** (nicht am Vorlesungstag, siehe [UPDATE.md](UPDATE.md)): Core beenden mit `pnpm sg stop`, dann `git pull`, dann `pnpm sg start`. Danach **Heute** öffnen und prüfen, dass die Seite lädt.
- [ ] **Moodle-Zugang** gilt: **Einstellungen → Moodle** zeigt den Zugang als gültig, das Modul hat einen zugeordneten Kurs ([MOODLE.md](MOODLE.md)).
- [ ] Das iPad zeigt **Mac ●** grün.

## Vor dem Start

1. [ ] **Start mit Vorschlag.** Auf **Heute** steht unter dem Titel der Karte eine Zeile **Folien: ‹Titel›**, bei Moodle-Sätzen mit „aus Moodle“. Es ist der neueste Satz, den noch keine andere Vorlesung trägt.
2. [ ] **Ändern.** Ein Klick auf **Ändern** öffnet eine Liste mit allen Sätzen des Moduls, **Ohne Folien** und **PDF hochladen …**. Belegte Sätze tragen „schon in VL …“. Wähle den älteren Satz: Die Zeile ändert sich sofort, ohne Dialog. Lade die Seite neu: Die Wahl bleibt. **Esc** schließt die Liste.
3. [ ] **Ohne Folien.** Wähle **Ohne Folien**. Die Zeile zeigt das, und die Wahl übersteht ein Neuladen.
4. [ ] **Optional: neue Folien kurz vor der Vorlesung** (nur wenn die Vorlesung noch mehr als 15 Minuten entfernt ist). Lasse den Dozenten, oder lade selbst in Moodle als Dozent-Konto, einen neuen Satz hoch, **bevor** die Vorlesung auf **bereit** springt. Der Satz erscheint erst nach dem nächsten Moodle-Abgleich (**Einstellungen → Moodle**, **Jetzt abgleichen** geht sofort). Die Start-Karte zeigt ihn danach innerhalb etwa einer Minute oder sobald du den Tab wieder öffnest.
5. [ ] Wähle wieder den neuesten Satz und tippe **Start** (oder **Jetzt starten**). Merke dir, welchen Satz du gewählt hast.

## In der Vorlesung

6. [ ] **Folie 1 und iPad.** Die Vorlesungs-Ansicht zeigt Folie 1 des gewählten Satzes. Unten steht **REC** mit Laufzeit. Das iPad zeigt hier **noch keine Folie**, und **Auf Folie** ist ausgegraut. Das ist richtig: Das iPad erfährt eine Folie erst, wenn du am Mac blätterst.
   - [ ] **Falsch gewählt, noch nicht geblättert.** Wähle unter den Folien **Anderen Foliensatz wählen** und einen anderen Satz. Das geht. Die Aufnahme läuft ungestört weiter.
7. [ ] **Blättern und Sperre.** Blättere am Mac mit dem Pfeil auf Folie 2.
   - Das iPad zeigt nun Folie 2 **des zuletzt gewählten Satzes** (nach Schritt 6 der neue, falls du gewechselt hast). **Auf Folie** ist jetzt wählbar.
   - Am Mac verschwindet unter den Folien die Leiste **Anderen Foliensatz wählen** / **Ohne Folien**. Es erscheint kein Hinweis. Der Satz ist ab jetzt fest.
   - Beende danach die Vorlesung (**Beenden**, bestätigen), damit Schritt 8 möglich ist. Hast du eine zweite Vorlesung am selben Tag, warte stattdessen auf deren Start.

## Zweite Session: ohne Folien, Moodle, Upload

8. [ ] **Ohne Folien starten.** Auf **Heute** erscheint nach dem Beenden **Session starten**. Wähle das Modul und **Ohne Folien**, dann Start. (Oder: eine zweite Vorlesung, bei der du vor dem Start **Ohne Folien** wählst.) Die Live-Ansicht zeigt in der Folien-Spalte „Folien kommen später – einfach mitschreiben“. Gibt es einen freien Satz, steht darunter „Vorschlag: ‹Titel›“ mit **Übernehmen** und **Nicht jetzt**. Es wechselt nichts von selbst.
9. [ ] **Optional: neue Folien während der Vorlesung** (nur wenn der Dozent jetzt hochlädt). Lade in Moodle einen neuen Satz hoch. Der Abgleich ist je Modul auf 10 Minuten gedrosselt, gezählt ab dem letzten Anstoß, auch ab dem beim Sprung auf **bereit**. Wer früh startet, wartet also bis etwa 10 Minuten nach **bereit**. Dazu kommen die Dauer des Abgleichs und bis zu 60 Sekunden bis zur nächsten Abfrage der Ansicht. Rechne mit meist wenigen Minuten, spätestens etwa 10 bis 12 Minuten nach dem letzten Abgleich. Dann steht in der Folien-Spalte **Neue Folien aus Moodle: ‹Titel›**. Nichts wechselt von selbst.
    - [ ] **Nicht jetzt** blendet das Angebot aus. Ein noch neuerer Satz wird wieder angeboten.
    - [ ] **Übernehmen** setzt den Satz, ohne die Aufnahme zu berühren. Es steht Folie 1.
10. [ ] **Upload in die laufende Vorlesung** (nur solange sie noch keinen Satz hat, sonst starte nochmals nach Schritt 8). Tippe auf **PDF hochladen** und wähle eine Datei vom Mac. Es steht „Folien werden verarbeitet …“, danach Folie 1. Das Blättern fängt bei Folie 1 an, die Aufnahme bleibt unberührt. Das iPad zeigt die Folie erst, nachdem du am Mac geblättert hast.
11. [ ] **Optional: Modulseite „Für Vorlesung“.** Nur wenn heute eine Vorlesung ohne Satz im Zustand geplant, bereit, läuft oder pausiert besteht, etwa die nächste des Tages. Öffne das Modul, Tab **Vorlesungen**, und lade ein PDF mit **Für Vorlesung** hoch. Zur Wahl stehen die heutigen Vorlesungen ohne Folien (Standard: die laufende, sonst **keine**). Der Satz hängt danach an dieser Vorlesung. Gibt es keine solche Vorlesung, fehlt das Feld. Das ist dann kein Fehler.
12. [ ] **Ohne Netz zu Moodle.** Trenne das Netz (oder melde Moodle ab) und starte eine Vorlesung. Der Start geht wie sonst, ohne Verzögerung und ohne Fehlermeldung.

## Bitte genau beobachten

**Lücke vor dem Start.** Zwischen „15 Minuten vorher“ und dem Start gibt es keinen weiteren Abgleich. Lädt der Dozent in diesem Fenster hoch, fehlt der Satz auf der Start-Karte, und die Live-Ansicht bietet ihn erst nach dem Start an: meist nach ein bis zwei Minuten, bei frühem Start wegen der Drossel bis etwa 10 Minuten nach **bereit**. Das gilt auch nach einem Neustart des Cores und für Vorlesungen, die der Kalender-Import direkt als **bereit** anlegt. Ob das im Hörsaal stört, entscheidest du. Erst danach kommt gegebenenfalls ein zusätzlicher Abgleich fünf Minuten vor Beginn. Achte also darauf:

- [ ] Hat der Dozent kurz vor dem Start hochgeladen? Wann genau?
- [ ] Fehlte der Satz auf der Start-Karte?
- [ ] Wie lange nach dem Start kam das Angebot in der Live-Ansicht?
- [ ] Hat dich das gestört?

## Zurückmelden

Schreibe mir nach dem Test:

- Welche Schritte (Nummer) gingen wie beschrieben, welche nicht, und welche optionalen Schritte du ausgelassen hast (mit Grund). Bei Abweichung: Schritt, Uhrzeit, was du gesehen hast, wenn möglich ein Foto oder Screenshot.
- Die Beobachtung zur Lücke vor dem Start (die vier Punkte oben).
- Ob das Angebot in der Live-Ansicht zu spät kam, und wie viele Minuten es ungefähr waren.
- Ob das iPad nach dem Blättern (Schritt 7) Folie 2 des zuletzt gewählten Satzes zeigte, und ob es nach dem Upload und dem Blättern (Schritt 10) dem neuen Satz folgte.
- Ob die Sperre (Schritt 7) verständlich wirkte, auch ohne Hinweis.
- Alles, was sich unruhig anfühlte: Meldungen, Rot, Zähler, Verzögerungen.
