# Abnahme Phase 0 auf deinem Mac

Phase 0 ist fertig, wenn `pnpm sg start` auf **deinem** Mac läuft und die Funktionen F-ORG-01 bis F-ORG-04 funktionieren (Spezifikation 10 §3). Das dritte Kriterium, „CI grün“, prüft Claude selbst.
Den Test auf deinem Mac kann Claude nicht übernehmen, weil die App nur dort läuft. Plane 30–45 Minuten ein.

Bitte alle Befehle im Terminal ausführen, das Terminal von Antigravity geht auch. Bei einem Fehler einfach den Screenshot oder den Text an Claude schicken.

## 1. Einmalig: Werkzeuge installieren

Homebrew hast du schon.

```bash
brew install --cask orbstack
```
OrbStack ist die Docker-Umgebung für die Datenbank. So geht es weiter:
1. OrbStack einmal öffnen (Programme → OrbStack), die Einrichtung durchklicken und warten, bis es bereit ist.
2. **Ein neues Terminal-Fenster öffnen**, damit der Befehl `docker` gefunden wird.
3. Kurz prüfen: `docker --version` sollte eine Versionszeile zeigen.

```bash
brew install node@22 uv
```
Bitte genau `node@22` nehmen, nicht `brew install node`. Das wäre eine zu neue Version.

```bash
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zprofile && source ~/.zprofile
```
Das gilt ab jetzt in jedem neuen Terminal-Fenster.

```bash
corepack enable
```
Wenn hier nichts ausgegeben wird, ist das normal. Corepack holt die passende pnpm-Version beim ersten Aufruf im Projekt, dafür braucht es Internet.

## 2. Neuesten Stand holen und installieren

```bash
cd ~/WI-Webapp && git checkout main && git pull
```
Am Ende steht „Already up to date.“ oder eine Liste geänderter Dateien.

Kurz prüfen:
```bash
node --version && pnpm --version && uv --version
```
Das sollte erscheinen:
- **Node:** beginnt mit `v22.` und ist mindestens `v22.18`. Steht dort `v23` oder höher, bitte melden.
- **pnpm:** `10.28.0`
- **uv:** irgendeine Versionsnummer

```bash
pnpm install
```
Das dauert 1–2 Minuten und sollte ohne rote Fehlermeldung enden.

Ab jetzt reicht nach jedem `git pull` einfach `pnpm sg start`. Neue Pakete werden dann selbst installiert und die Oberfläche selbst neu gebaut.

## 3. Gesundheitscheck

```bash
pnpm sg doctor
```
- Es darf keine Zeile mit ✗ geben. Die Zeile mit ℹ (Apple Silicon) ist nur ein Hinweis.
- Am Ende muss „Alles bereit.“ stehen.
- Typisch bei ✗ ist „Docker: läuft nicht“. Dann OrbStack öffnen, warten, bis es bereit ist, und `pnpm sg doctor` wiederholen.
- Wenn du `doctor` erneut ausführst, während die App noch läuft, meldet es „Port … belegt“. Das ist dann kein Fehler. Vorher `pnpm sg stop` ausführen.

## 4. Starten

```bash
pnpm sg start
```
Beim ersten Mal dauert das ein paar Minuten:
- Die Datenbank wird heruntergeladen.
- Die Web-App wird gebaut. Das passiert nach jedem Update einmal und dauert dann etwa eine Minute.
- Die Python-Umgebung wird angelegt. Python 3.12 wird dabei automatisch geladen.

Danach steht im Terminal „Studien-Gehirn läuft: http://…“ und der Browser öffnet sich. Geht er nicht auf, die Adresse aus dieser Zeile in den Browser eingeben. Das Terminal bleibt offen. Dort laufen Meldungen mit `[sg]`, `[core]` und `[worker]`.

**Beenden:**
1. Strg+C im Terminal beendet die App. Das kann bis zu 2 Minuten dauern, wenn gerade noch ein PDF verarbeitet wird. Ein zweites Strg+C bricht sofort ab.
2. Die Datenbank läuft danach im Hintergrund weiter. Zum vollständigen Stoppen `pnpm sg stop` ausführen.

### Wenn etwas schiefgeht
- **Meldung mit „Docker“:** OrbStack öffnen, warten, nochmal `pnpm sg start`.
- **„… läuft bereits“:** Erst `pnpm sg stop`, dann `pnpm sg start`.
- **„Port … belegt“:** `pnpm sg stop`, notfalls den Mac neu starten.
- **Sonst:** den Text aus dem Terminal komplett kopieren und Claude schicken.

Wiederholen ist immer gefahrlos, dabei geht nichts kaputt.

## 5. Abnahme-Checkliste

Bitte der Reihe nach durchgehen und abhaken:

**Start**
- [ ] `pnpm sg start` öffnet den Browser, unten links in der Seitenleiste steht „Core verbunden“

**Semester und Module (F-ORG-01)**
- [ ] Es erscheint „Willkommen. In welchem Semester bist du?“. Semester eintippen, zum Beispiel „HS 2026“, dann „Weiter“
- [ ] „Welche Module belegst du?“: Ein Modul ist in **unter 20 Sekunden** angelegt (Name tippen, Enter). Gern mit Stoppuhr
- [ ] Drei Module schnell hintereinander anlegen, dann „Fertig“. Alle drei erscheinen in der Seitenleiste
- [ ] Noch ein Modul über die Seitenleiste anlegen („+“ bei „Module“, Name tippen, Enter)
- [ ] Modul öffnen, „Bearbeiten“: Kürzel und Farbe ändern
- [ ] Modul „Löschen“: Die App springt zur Startseite, unten erscheint „Modul gelöscht“. Innerhalb von 10 Sekunden „Rückgängig“ drücken, dann ist das Modul wieder in der Seitenleiste
- [ ] Einstellungen → Semester: Ein zweites Semester anlegen und „Als aktuell setzen“, dann das erste „Archivieren“. Die Seitenleiste zeigt jetzt nur die Module des aktuellen Semesters. Danach das erste wieder „Wiederherstellen“ und als aktuell setzen

**Folien (F-ORG-02)**
- [ ] Ein echtes Vorlesungs-PDF auf den Tab „Vorlesungen“ ziehen oder „PDF auswählen“ nutzen. Unten erscheint „Foliensatz hinzugefügt“. In der Liste steht kurz „Wird verarbeitet …“ (bei kleinen Dateien kaum sichtbar), danach erscheinen Vorschaubild und Seitenzahl
- [ ] Dasselbe PDF noch einmal hochladen: Es kommt die Meldung „Schon vorhanden“ mit „Anzeigen“, ein zweiter Eintrag entsteht nicht
- [ ] Ein großes PDF mit 60 oder mehr Seiten hochladen und öffnen: Die ersten Seiten sind in **unter 3 Sekunden** sichtbar, nach **unter 60 Sekunden** ist es fertig verarbeitet (Vorschaubilder vollständig)
- [ ] Foliensatz „Umbenennen“, dann „Löschen“: Es erscheint „Foliensatz gelöscht“. „Rückgängig“ drücken, dann ist er wieder da

**Übungsblätter (F-ORG-03)**
- [ ] Ein Übungsblatt-PDF auf den Tab „Übungen“ ziehen: Es kommt „Übungsblatt hinzugefügt“, und das Blatt erscheint in der Liste

**PDF-Anzeige (F-ORG-04)**
- [ ] Foliensatz öffnen: Links ist die Seitenleiste mit Vorschaubildern, ein Klick springt zur Seite
- [ ] Oben eine Seitenzahl eintippen und Enter: Die Ansicht springt dorthin
- [ ] Zoom (−/+, „Einpassen“, „Breite“) funktioniert
- [ ] „Suchen“ öffnen, oder ⌘F, wenn du vorher in die Seite geklickt hast. Ein Wort eingeben: Es wird markiert, „1 von …“ erscheint, mit den Pfeilen oder Enter (Shift+Enter zurück) geht es von Treffer zu Treffer
- [ ] Mit ←/→ blättern
- [ ] Ein eingescanntes PDF oder eins mit vielen Bildern sieht genauso aus wie in Vorschau.app. Die Suche findet in eingescannten Seiten noch nichts. Das ist in Phase 0 erwartet, denn Texterkennung kommt mit Phase 2

**Stabilität**
- [ ] Strg+C, dann `pnpm sg stop`. Danach `pnpm sg start` erneut: Alle Daten sind noch da
- [ ] Hell und Dunkel (Einstellungen → Darstellung) sehen beide gut aus

## 6. Ergebnis an Claude melden

- **Alles abgehakt:** Schreib „Abnahme Phase 0 ok“. Dann geht es mit Phase 1 weiter (Vorlesung aufnehmen, iPad-App).
- **Etwas klappt nicht:** Schreib, welcher Punkt nicht klappt, und schick einen Screenshot oder die letzten Zeilen aus dem Terminal. Hilfreich sind auch die Logs unter `~/StudienGehirn/logs/` (`core.log`, `worker.log`).
- **Etwas gefällt dir nicht** (Text, Farbe, Ablauf): auch gern melden. Das ist keine Voraussetzung für die Abnahme, wird aber eingeplant.

## Gut zu wissen

- **Update:** `git pull`, danach `pnpm sg start`. Neue Pakete und die neue Oberfläche kommen dabei automatisch.
- **Deine Daten** liegen in `~/StudienGehirn/` (Dateien) und in der Datenbank (ein Docker-Volume, sichtbar in OrbStack unter „Volumes“). Sie bleiben beim Beenden erhalten.
- **Backups:** Automatische Backups kommen mit Phase 1 (T1-18). Bis dahin bitte noch keine wichtigen Notizen ausschließlich in der App ablegen.
- **Datenschutz:** Die App läuft nur lokal auf deinem Mac. Es gibt keinen Internet-Server und keine Telemetrie.
