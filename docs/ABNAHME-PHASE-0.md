# Abnahme Phase 0 auf deinem Mac

Phase 0 ist fertig, wenn `pnpm sg start` auf **deinem** Mac läuft und die Funktionen F-ORG-01 bis F-ORG-04 funktionieren (Spezifikation 10 §3).
Das kann Claude nicht für dich testen, weil die App nur auf deinem Mac läuft. Plane 20–30 Minuten ein.

Bitte alle Befehle im Terminal ausführen, auch im Terminal von Antigravity. Bei einem Fehler einfach den Screenshot oder den Text an Claude schicken.

## 1. Einmalig: Werkzeuge installieren

Homebrew hast du schon.

```bash
brew install --cask orbstack
```
OrbStack ist die Docker-Umgebung für die Datenbank. Danach einmal öffnen (Programme → OrbStack) und die Einrichtung durchklicken.

```bash
brew install node@22 uv
```

```bash
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zprofile && source ~/.zprofile
```

```bash
corepack enable
```

Kurz prüfen. Es sollten `v22.18` oder neuer, eine pnpm-Version und eine uv-Version erscheinen:
```bash
node --version && pnpm --version && uv --version
```

## 2. Neuesten Stand holen und installieren

```bash
cd ~/WI-Webapp && git checkout main && git pull
```

```bash
pnpm install
```
Ab jetzt reicht nach jedem `git pull` einfach `pnpm sg start`. Neue Pakete werden dann selbst installiert und die Oberfläche selbst neu gebaut.

## 3. Gesundheitscheck

```bash
pnpm sg doctor
```
Alle Zeilen sollten ✓ zeigen. Bei ✗ steht direkt daneben, was zu tun ist. Typisch ist „Docker läuft nicht“: dann OrbStack öffnen.

## 4. Starten

```bash
pnpm sg start
```
Beim ersten Mal dauert das ein paar Minuten:
- Die Datenbank wird heruntergeladen.
- Die Web-App wird gebaut. Das passiert auch nach jedem Update einmal und dauert dann etwa eine Minute.
- Die Python-Pakete werden installiert.

Danach öffnet sich der Browser mit dem Studien-Gehirn. Das Terminal bleibt offen, dort laufen die Logs mit `[core]` und `[worker]`.

**Beenden:** Strg+C im Terminal (oder `pnpm sg stop` in einem zweiten Terminal).

## 5. Abnahme-Checkliste

Bitte der Reihe nach durchgehen und abhaken:

**Start**
- [ ] `pnpm sg start` öffnet den Browser, unten links steht „Core verbunden“

**Semester und Module (F-ORG-01)**
- [ ] Der Einrichtungsdialog erscheint. Ein Semester anlegen, zum Beispiel „HS 2026“
- [ ] Ein Modul ist in **unter 20 Sekunden** angelegt: Name tippen, Enter
- [ ] Drei Module schnell hintereinander angelegt, alle drei erscheinen in der Seitenleiste
- [ ] Modul bearbeiten (Kürzel, Farbe), löschen, „Rückgängig“: Das Modul ist wieder da

**Folien (F-ORG-02)**
- [ ] Ein echtes Vorlesungs-PDF auf den Tab „Vorlesungen“ ziehen (oder „PDF auswählen“). Unten erscheint „Foliensatz hinzugefügt“, in der Liste steht kurz „Wird verarbeitet …“, danach Vorschaubild und Seitenzahl
- [ ] Dasselbe PDF noch einmal hochladen: Meldung „Schon vorhanden“ mit „Anzeigen“, kein zweiter Eintrag
- [ ] Foliensatz umbenennen und löschen, „Rückgängig“: Er ist wieder da
- [ ] Ein großes PDF mit 60 oder mehr Seiten hochladen: Die ersten Seiten sind in **unter 3 Sekunden** sichtbar, fertig verarbeitet in **unter 60 Sekunden**

**Übungsblätter (F-ORG-03)**
- [ ] Ein Übungsblatt-PDF auf den Tab „Übungen“ ziehen. Meldung „Übungsblatt hinzugefügt“, es erscheint in der Liste

**PDF-Anzeige (F-ORG-04)**
- [ ] Foliensatz öffnen: Seitenleiste mit Vorschaubildern, Klick springt zur Seite
- [ ] Oben eine Seitenzahl eintippen und Enter: springt dorthin
- [ ] Zoom (−/+, „Einpassen“, „Breite“) funktioniert
- [ ] „Suchen“ (oder ⌘F, wenn du vorher in die Seite geklickt hast): findet ein Wort, markiert es und springt mit den Pfeilen von Treffer zu Treffer
- [ ] Mit ←/→ blättern
- [ ] Ein eingescanntes PDF oder eins mit vielen Bildern sieht genauso aus wie in Vorschau.app

**Stabilität**
- [ ] Strg+C beendet alles sauber. `pnpm sg start` erneut: Alle Daten sind noch da
- [ ] Hell und Dunkel (Einstellungen → Darstellung) sehen beide gut aus

## 6. Ergebnis an Claude melden

- **Alles abgehakt:** Schreib „Abnahme Phase 0 ok“. Dann geht es mit Phase 1 weiter (Vorlesung aufnehmen, iPad-App).
- **Etwas klappt nicht:** Schreib, welcher Punkt nicht klappt, und schick einen Screenshot oder die letzten Zeilen aus dem Terminal. Hilfreich sind auch die Logs unter `~/StudienGehirn/logs/`.

## Gut zu wissen

- **Update:** `git pull` und danach `pnpm sg start`. Neue Pakete und die neue Oberfläche kommen dabei automatisch.
- Deine Daten liegen in `~/StudienGehirn/` (Dateien) und in der Datenbank (Docker-Volume `sg_pgdata`). Sie bleiben beim Beenden erhalten.
- Automatische Backups kommen mit Phase 1 (T1-18). Bis dahin bitte noch keine wichtigen Notizen ausschließlich in der App ablegen.
- Die App läuft nur lokal auf deinem Mac. Es gibt keinen Internet-Server und keine Telemetrie.
