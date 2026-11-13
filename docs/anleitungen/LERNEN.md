# Lernen: Karten prüfen und täglich wiederholen

Nach jeder Vorlesung schlägt die KI Lernkarten vor. Du nimmst an, was taugt, und wiederholst die Karten täglich auf **Lernen**. Hintergrund: VERTRAEGE §21, 05 §P10.

> **Das Repo ist öffentlich.** Karten, Folientexte oder Ausschnitte echter Vorlesungen nie in Issues, PRs oder Chats einfügen. Zum Melden reichen Zahlen ([KARTEN-PRUEFEN.md](KARTEN-PRUEFEN.md)).

## 1. Wie Karten entstehen

1. Eine Vorlesung wird verarbeitet (Transkript, Konzepte, Kurzfassung). Danach erzeugt die KI Karten für **alle Konzepte** der Vorlesung. Der Schritt heißt in der Liste **Verarbeitung** „Karten“.
2. Die Karten erscheinen als **Vorschlag in der Inbox**, je Konzept eine Zeile „n Karten zu _Konzept_“ mit dem Zeichen ✦ (Vorschlag der KI).
3. **Erst wenn du das Konzept angenommen hast**, wird sein Kartenvorschlag in der Inbox sichtbar. Nimm also zuerst die Konzepte an. Ein abgelehntes Konzept nimmt seinen Kartenvorschlag mit.
4. Jede Karte hat einen Beleg (Folie oder Stelle im Gesagten). Die Chips darunter springen dorthin.

Es gibt zwei Kartenarten: **Frage und Antwort** und **Lückentext**. Bei einer Lückenkarte steht vorn `[…]`, hinten der ganze Satz mit hervorgehobener Lösung.

### KI-Budget

Karten brauchen KI-Aufrufe und zählen zum Monatsbudget (**Einstellungen → KI**, „Monatsbudget“).

- **Ab 80 % des Monatsbudgets pausieren die Karten.** Der Schritt „Karten“ zeigt dann „Karten pausiert · KI-Budget“ mit Link zu den Einstellungen. Schon erzeugte Vorschläge bleiben.
- Es läuft nichts von selbst nach. **Fortsetzen:** Erhöhe das Monatsbudget (oder warte auf den nächsten Monat), öffne den **Rückblick** der Vorlesung und klicke in der Liste **Verarbeitung** auf **Karten erzeugen**.
- „Karten erzeugen“ steht auch bei älteren Vorlesungen, die noch keinen Schritt „Karten“ haben, sofern sie Konzepte haben.
- Mit Monatsbudget 0 sind auch die Karten aus.
- Konzepte, deren Kartenvorschlag du schon entschieden hast, bekommen dabei keinen zweiten Vorschlag.

## 2. Karten in der Inbox entscheiden

Öffne die **Inbox**. Der Filter „Karten“ zeigt nur Kartenvorschläge.

- **Karten ansehen** klappt die Zeile auf: je Karte Vorderseite, Rückseite, Quellen und ein Häkchen (Standard: an).
- Nimm das Häkchen weg bei Karten, die du nicht willst. Der Knopf heißt dann „n annehmen“.
- **Bearbeiten** ändert eine Karte in der Zeile. Die geänderte Fassung wird beim Annehmen übernommen („Geändert, wird so angenommen“).
- **Annehmen** übernimmt die angehakten Karten, **Verwerfen** verwirft alle. **Alle annehmen** je Gruppe schließt Kartenvorschläge ein.
- Nach jeder Entscheidung gibt es 10 Sekunden lang **Rückgängig**.

Tasten, wenn die Zeile markiert ist:

| Taste | Wirkung                          |
| ----- | -------------------------------- |
| →     | angehakte Karten annehmen        |
| ←     | alle verwerfen                   |
| E     | die markierte Karte bearbeiten   |
| ↑ ↓   | zur vorigen bzw. nächsten Zeile  |

Eine Karte, die es im Konzept schon gibt (gleiche Vorderseite), wird beim Annehmen nicht doppelt angelegt.

## 3. Karten von Hand anlegen

Zwei Wege, beide brauchen einen Beleg (1 bis 6):

- **Konzeptansicht:** Im Abschnitt „Karten“ auf **Karte anlegen**. Wähle Typ (Frage und Antwort oder Lückentext), Vorderseite, Antwort (bei Frage und Antwort optional mit Erklärung) und den Beleg aus den Belegen des Konzepts. Der erste ist vorgewählt. Hat das Konzept keine Belege mehr, steht dort „Keine Belege mehr“.
- **Rückblick, Kurzfassung:** Hinter einem Satz steht **Karte daraus**. Der Satz ist die Vorlage, seine Quellen sind der Beleg. Das Konzept wählst du aus den aktiven Konzepten der Vorlesung. Den Knopf gibt es nur, wenn die Vorlesung aktive Konzepte hat und der Satz Quellen.

Im Editor legt **Strg+Enter** die Karte an, **Esc** bricht ab. Beim Lückentext steht die Lücke als `{{c1::Lösung}}`, eine Vorschau zeigt das Ergebnis.

## 4. Täglich wiederholen

Öffne **Lernen** (oder die Kachel „Heute wiederholen · ≈ n min“ auf **Heute**; sie erscheint nur, wenn etwas dran ist und keine Vorlesung läuft).

1. Oben steht „Heute wiederholen · ≈ n min“. **Starten** oder **Enter** beginnt den Block.
2. Du siehst die Vorderseite. **Leertaste** (oder Enter) deckt die Rückseite auf, mit Quellen.
3. Bewerte mit **1 bis 4**. Vor dem Aufdecken tun die Zahlen nichts.
4. **Esc** oder **Beenden** hört jederzeit auf. Was nicht dran war, bleibt fällig. **Weiter** macht danach mit dem Rest weiter.
5. Oben steht ruhig „Karte 3 von 14“. Es gibt keinen Rückstand und keine rote Zahl.

| Taste | Bewertung | Bedeutung                                                                 |
| ----- | --------- | ------------------------------------------------------------------------- |
| 1     | Nochmal   | Falsch oder vergessen. Die Karte kommt bald wieder, oft noch im Block     |
| 2     | Schwer    | Richtig, aber mit Mühe. Kürzerer Abstand                                  |
| 3     | Gut       | Richtig. Der normale Fall                                                 |
| 4     | Leicht    | Mühelos. Längerer Abstand                                                 |

Ist eine Karte nach der Bewertung heute noch einmal fällig, kommt sie ans Ende des Blocks. Die Abstände berechnet der Planer FSRS mit 90 % Zielbehaltensquote, der längste Abstand ist 365 Tage.

**Karten-Menü (⋯):** **Bearbeiten**, **Pausieren** bzw. **Fortsetzen** (eine pausierte Karte kommt nicht dran) und **Löschen**.

### Zeitbudget und „Weitere 10 min“

Die Warteschlange füllt sich bis zu einem Zeitbudget (Standard **20 Minuten**) und mit höchstens **20 neuen Karten** am Tag. Was nicht mehr hineinpasst, bleibt für morgen. Bei der Reihenfolge zählen Überfälligkeit und Klausurrelevanz.

Am Ende steht „Für heute geschafft“ mit Zahl und Dauer. Ist noch mehr fällig, bietet **Weitere 10 min** einen weiteren Block an, bis zu 120 zusätzliche Minuten am Tag.

### Tageswechsel 04:00

Ein Lerntag endet um **04:00 Uhr** (Ortszeit des Macs). Wer um 01:30 noch wiederholt, lernt noch für den Vortag. Die zusätzlichen Minuten von „Weitere 10 min“ gelten nur für einen Lerntag.

### Wenn der Core nicht antwortet

Bewertungen werden erneut gesendet. Bleibt es dabei, steht „Einige Bewertungen sind noch nicht gespeichert“ mit **Erneut versuchen**.

## 5. Einstellungen

Einen Bereich **Einstellungen → Lernen** (Zeitbudget, neue Karten je Tag) **gibt es in der Web-App noch nicht**. Es gelten die Standardwerte: 20 Minuten und 20 neue Karten am Tag. Im Core sind beide Werte schon einstellbar, nur die Oberfläche fehlt.

## 6. Papierkorb und Rückgängig

- **Rückgängig** erscheint 10 Sekunden lang nach dem Löschen einer Karte und nach Entscheidungen in der Inbox.
- Gelöschte Karten liegen 30 Tage im Papierkorb (**Einstellungen → Daten und Papierkorb**, Abschnitt „Papierkorb“, Art „Karte“) und lassen sich dort mit **Wiederherstellen** zurückholen.
- Eine Annahme in der Inbox lässt sich nicht mehr zurücknehmen, sobald eine ihrer Karten bewertet wurde. Dann bleibt nur, die Karte zu löschen.
- Ein verworfener Kartenvorschlag lässt sich in der Inbox wieder öffnen. Wurde er mit seinem Konzept abgelehnt, öffnest du das Konzept wieder, dann kommt der Vorschlag mit zurück.

## 7. Was noch nicht geht

- **Keine Lernsitzung** mit Kurzzeit-Lernschritten und **keine Probeklausur**. Es gibt nur „Heute wiederholen“.
- **Keine Formeln** in Karten, nur Text.
- **Keine Wiederholung auf dem iPad.** Karten gibt es nur in der Web-App am Mac.
- **Keine Lern-Einstellungen** in der Oberfläche (Abschnitt 5) und keine Einstellung der Zielbehaltensquote.
- Neue Karten entstehen nur nach einer Vorlesung oder von Hand.

## Wenn etwas nicht klappt

| Zeichen                                | Ursache und Abhilfe                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| In der Inbox fehlt der Kartenvorschlag | Das Konzept ist noch nicht angenommen, oder die Karten sind pausiert (Abschnitt 1). Im Rückblick „Verarbeitung“ ansehen |
| „Karten pausiert · KI-Budget“          | Monatsbudget erhöhen, dann **Karten erzeugen** (Abschnitt 1)                                                     |
| Lernen zeigt „Noch keine Karten“       | Noch keine Karte angenommen. **Zur Inbox**                                                                       |
| „Heute ist nichts fällig“              | Nichts dran. Karten kommen nach ihrem Abstand wieder                                                             |
| „Karte anlegen“ nicht möglich          | Das Konzept hat keine Belege mehr. Alternativ **Karte daraus** in der Kurzfassung nutzen                         |
