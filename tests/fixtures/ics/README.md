# ICS-Testdaten für den Stundenplan-Import (T1-01 · F-KAL-01 / F-KAL-02)

Dieses Verzeichnis enthält handgeschriebene, RFC-5545-konforme ICS-Kalenderdateien mit realistischen (fiktiven) Hochschul-Stundenplänen aus dem Raum `Europe/Zurich` sowie die maschinenlesbaren Erwartungswerte (`*.json`) für das Auflösen von Wiederholungsregeln, Ausnahmen, Zeitzonen, Modul-/Terminart-Zuordnungen und Quellen-Abgleichen.

## Übersicht der Testfälle (1–11)

| Fall | ICS-Datei | JSON-Erwartung | Beschreibung (in einem Satz) |
| :--- | :--- | :--- | :--- |
| **1** | `01-woechentlich-exdate.ics` | `01-woechentlich-exdate.json` | Wöchentliche Vorlesung über ein ganzes Semester (`RRULE:FREQ=WEEKLY;UNTIL=…`), bei der drei Termine über zwei `EXDATE`-Einträge (Semester-Break und Feiertag) ausgelassen werden. |
| **2** | `02-woechentlich-count.ics` | `02-woechentlich-count.json` | Wöchentliche Tutoriumsserie, deren Ende über eine feste Anzahl von Wiederholungen (`COUNT=6`) statt über ein Enddatum begrenzt ist. |
| **3** | `03-zweiwoechentlich-byday.ics` | `03-zweiwoechentlich-byday.json` | Zweiwöchentliche Übungsserie (`INTERVAL=2`), die innerhalb jeder aktiven Woche an zwei Wochentagen (`BYDAY=TU,TH`) stattfindet. |
| **4** | `04-verschobenes-einzelvorkommen.ics` | `04-verschobenes-einzelvorkommen.json` | Wöchentliche Vorlesungsserie, in der ein einzelnes Vorkommen über ein zweites `VEVENT` mit gleicher `UID` und `RECURRENCE-ID` auf eine andere Uhrzeit und einen neuen Hörsaal verschoben wird. |
| **5** | `05-abgesagtes-einzelvorkommen.ics` | `05-abgesagtes-einzelvorkommen.json` | Wöchentliche Übungsserie, in der ein einzelnes Vorkommen über `RECURRENCE-ID` und `STATUS:CANCELLED` als entfallen (`"cancelled": true`) markiert ist, ohne aus der Historie gelöscht zu werden. |
| **6a** | `06a-sommerzeit-mit-vtimezone.ics` | `06a-sommerzeit-mit-vtimezone.json` | Zwei wöchentliche Serien über die Zeitumstellung Ende Oktober (`CEST` → `CET`) und Ende März (`CET` → `CEST`) mit vollständigem `VTIMEZONE`-Block für `Europe/Zurich`, sodass die lokale Uhrzeit (`08:15`) gleich bleibt und sich die UTC-Zeit um eine Stunde verschiebt. |
| **6b** | `06b-sommerzeit-ohne-vtimezone.ics` | `06b-sommerzeit-ohne-vtimezone.json` | Wöchentliche Serie über den Sommer-/Winterzeitwechsel Ende Oktober mit `TZID=Europe/Zurich` an `DTSTART`/`DTEND`, jedoch ohne eingebetteten `VTIMEZONE`-Block, wie es bei manchen Campus-Exporten vorkommt. |
| **7** | `07-utc-und-floating-time.ics` | `07-utc-und-floating-time.json` | Kombination aus einem direkt in UTC (`…Z`) angegebenen Vorlesungstermin und zwei Terminen in „Floating Time" ohne Zeitzonenangabe, die in der lokalen Zielzeitzone (`Europe/Zurich`, Sommer- bzw. Winterzeit) interpretiert werden. |
| **8** | `08-ganztaegige-termine.ics` | `08-ganztaegige-termine.json` | Ganztägige Termine mit `VALUE=DATE` (`"all_day": true`) für einen gesetzlichen Feiertag (`Allerheiligen`) und eine ganztägig eingetragene Blockprüfung. |
| **9** | `09-faltung-umlaute-escaping.ics` | `09-faltung-umlaute-escaping.json` | Einzeltermin mit mehrzeiliger Zeilenfaltung nach RFC 5545 (`CRLF` gefolgt von Leerzeichen), UTF-8-Umlauten (`ä`, `ö`, `ü`, `Ü`, `ß`) sowie escapeten Kommas (`\,`), Semikolons (`\;`) und Zeilenumbrüchen (`\n`) in `SUMMARY`, `LOCATION` und `DESCRIPTION`. |
| **10** | `10-mini-semester-6-module.ics` | `10-mini-semester-6-module.json` | Ein ganzes Mini-Semester mit 6 Modulen und realistisch uneinheitlichen bzw. abgekürzten Titeln (Vorlesung, Übung, Tutorium, Prüfung), um die automatische Erkennung von `kind` und `module` nach F-KAL-02 zu testen. |
| **11** | `11a-abgleich-vorher.ics` / `11b-abgleich-nachher.ics` | `11a-abgleich-vorher.json`, `11b-abgleich-nachher.json`, `11-abgleich-erwartung.json` | Zwei aufeinanderfolgende Stände derselben Kalenderquelle für den Abgleich nach F-KAL-01 (`external_uid` + `recurrence_id`), wobei in der zweiten Version ein Termin zeitlich und räumlich verschoben (`geaendert`), einer per `EXDATE` gestrichen (`entfallen`) und ein Zusatztermin neu ergänzt (`neu`) wurde. |

## Prüfskript ausführen (`pruefen.py`)

Das Skript `pruefen.py` parst alle `*.ics`-Dateien mit Python 3.12 (`icalendar` und `recurring-ical-events`), löst sämtliche Wiederholungsregeln und Ausnahmen im jeweiligen `zeitraum` auf und vergleicht die Ergebnisse Feld für Feld mit den `*.json`-Erwartungsdateien sowie `11-abgleich-erwartung.json`.

Die Python-Pakete werden **nicht** in das Projekt installiert, sondern isoliert per `uv run` (oder in einem temporären `venv`) ausgeführt:

```bash
uv run --python 3.12 --with icalendar --with recurring-ical-events python tests/fixtures/ics/pruefen.py
```

Alternativ mit einem temporären virtuellen Environment in `/tmp`:

```bash
python3.12 -m venv /tmp/ics-venv
/tmp/ics-venv/bin/pip install icalendar recurring-ical-events
/tmp/ics-venv/bin/python tests/fixtures/ics/pruefen.py
```
