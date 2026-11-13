# Karten prüfen: Stichprobe und Rückmeldung

Mit dieser Liste prüfst du, ob die KI-Karten taugen. Sie gehört zur Qualitätssicherung in 05-KI-PIPELINE §4. Zielwert: Von 30 Karten würdest du mindestens 75 % behalten. Sinkt die Annahmequote bei einer Aufgabe unter 50 %, überarbeiten wir den Prompt.

> **Das Repo ist öffentlich.** Melde in #188 nur **Zahlen und Kategorien**, keine Karteninhalte, keine Folientexte, keine Namen von Dozenten oder Modulen.

Wie Karten entstehen und entschieden werden, steht in [LERNEN.md](LERNEN.md).

## 1. Vorbereitung

Warte, bis **3 bis 5 Vorlesungen** verarbeitet sind und du ihre Konzepte angenommen hast. Danach liegen die Kartenvorschläge in der Inbox.

Führe eine Strichliste (Papier oder lokale Notiz, nicht im Repo) mit den Spalten: unverändert angenommen, bearbeitet, verworfen, Grund.

## 2. 30 Karten bewerten

1. Öffne die **Inbox**, Filter „Karten“.
2. Wähle über die Vorlesungen verteilt **30 Karten** aus, nicht nur die ersten: etwa gleich viele je Vorlesung, gemischt aus Frage und Antwort und Lückentext.
3. Klappe jede Zeile mit **Karten ansehen** auf und lies je Karte Vorderseite, Rückseite und Beleg. Springe bei Zweifel über den Chip zur Folie oder zur Stelle im Gesagten.
4. Entscheide für jede Karte:
   - **Behalten:** Die Karte ist gut so. Häkchen lassen.
   - **Bearbeiten (E):** Die Idee stimmt, du änderst Text oder Antwort. Sie wird mit deiner Fassung angenommen.
   - **Verwerfen:** Häkchen entfernen und den Grund notieren (Abschnitt 3).
5. Nimm die Karten an (→). Die übrigen Vorschläge darfst du ebenfalls entscheiden, sie zählen nicht zur Stichprobe.

Die Frage an jede Karte: **Würde ich diese Karte behalten?** „Unverändert“ und „leicht bearbeitet“ zählen als behalten. Das ist das Urteil, das die Zahl ≥ 75 % misst.

Zusätzlich prüfst du knapp:

- Eine Sache pro Karte, kurz genug zum schnellen Beantworten?
- Antwort stimmt und steht im Beleg?
- Lücken nur auf bedeutungstragende Begriffe?
- Keine Dublette zu einer anderen Karte?

## 3. Gründe fürs Verwerfen (Kategorien)

Ordne jede verworfene Karte genau einer Kategorie zu:

| Kategorie  | Gemeint                                                    |
| ---------- | ---------------------------------------------------------- |
| Falsch     | Antwort inhaltlich falsch oder nicht vom Beleg gedeckt     |
| Zu viel    | Mehrere Dinge in einer Karte, zu lang                      |
| Trivial    | Selbstverständliches, Lücke auf ein Füllwort               |
| Unklar     | Frage mehrdeutig oder ohne Kontext nicht lösbar            |
| Dublette   | Gleiches steht schon auf einer anderen Karte               |
| Unwichtig  | Stimmt, ist aber für die Klausur nicht relevant            |
| Sonstiges  | Alles andere                                               |

## 4. Was du in #188 zurückmeldest

Nur diese Zahlen, als Kommentar:

```
Karten-Stichprobe (n = 30, <Anzahl> Vorlesungen)
- angenommen unverändert: <Zahl>
- angenommen bearbeitet:  <Zahl>
- verworfen:              <Zahl>
  davon: Falsch <Z>, Zu viel <Z>, Trivial <Z>, Unklar <Z>, Dublette <Z>, Unwichtig <Z>, Sonstiges <Z>
- Annahmequote (unverändert + bearbeitet, von 30): <Prozent>
- Kosten je Vorlesung: <Betrag in €>, davon Aufgabe „Karten“: <Betrag in €>
- Karten durch das KI-Budget pausiert: <ja/nein>
```

Die Kosten findest du unter **Einstellungen → KI** im Abschnitt Kosten: „Teuerste Vorlesungen“ zeigt Aufrufe und Kosten je Vorlesung, „Je Aufgabe“ die Kosten der Aufgabe Karten über den ganzen Monat. Die Annahmequote rechnest du aus deiner Strichliste.

**Bitte nicht melden:** Kartentexte, Folieninhalte, Namen von Dozenten oder Modulen, Screenshots der Inbox mit Karten. Willst du einen Fehlertyp erklären, beschreibe ihn allgemein („Lücke auf ein Füllwort“), ohne Beispiel aus der Vorlesung.
