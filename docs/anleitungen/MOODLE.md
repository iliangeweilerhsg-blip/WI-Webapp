# Moodle verbinden

Gilt für Moodle.UP (`https://moodle2.uni-potsdam.de`). Dauer: etwa 1 Minute. Der Token gilt **12 Wochen**, danach dieselben Schritte wiederholen.
Hintergrund: F-MDL-01 (Kap. 04), 08 §9.1, T1-26.

> Der Token hat dieselben Rechte wie dein Moodle-Konto. Er liegt nur im macOS-Schlüsselbund (Dienst `studiengehirn-moodle`). Nie in Chats, Issues, PRs oder Dateien einfügen.

## 1. Einmalig: Adresse für den Core eintragen

In `~/StudienGehirn/config/.env` diese Zeile ergänzen (falls noch nicht vorhanden):

```
SG_MOODLE_URL=https://moodle2.uni-potsdam.de
```

Den Core liest diese Datei nur **beim Start**. Läuft er schon, danach einmal neu starten, sonst bleibt die Adresse unbekannt und `pnpm sg moodle status` meldet weiter „nicht eingerichtet“:

```bash
pnpm sg stop && pnpm sg start
```

## 2. Anmelden

Im Terminal im Repo-Ordner:

```bash
pnpm sg moodle login
```

1. Den Benutzernamen eingeben (wie bei Moodle.UP), Enter. Benutzername und Passwort einzeln eingeben, nicht zusammen in einem Rutsch einfügen.
2. Das Passwort eingeben. **Es erscheint nichts, auch keine Sternchen.** Enter.
3. Die CLI holt den Token, prüft ihn bei Moodle und legt ihn im Schlüsselbund ab. Am Ende steht z. B.
   `Verbunden mit Moodle.UP (https://moodle2.uni-potsdam.de) als Anna Muster.`
4. Läuft der Core, steht danach ein Hinweis: Hatte er noch keinen Token, liest er den neuen nach spätestens etwa 30 Sekunden, nach einem abgelehnten oder abgelaufenen Token nach spätestens etwa einer Minute. Hatte er einen gültigen Token (oder fehlt ihm `SG_MOODLE_URL`), hilft `pnpm sg stop && pnpm sg start`.

Das Passwort wird nicht gespeichert. Es steht nicht in der Shell-History und ist für andere Programme nicht sichtbar.

Meldet die CLI `invalidlogin`, obwohl das Passwort stimmt: Dein Konto meldet sich nur über das Uni-SSO an. Dann weiter mit Abschnitt 3.

## 3. Falls die Anmeldung per Passwort nicht geht: Token einfügen

1. Den Token in die Zwischenablage holen: Schritte 1 und 2 aus [MOODLE-TOKEN.md](MOODLE-TOKEN.md).
2. Im Terminal:
   ```bash
   pnpm sg moodle login --token-stdin
   ```
3. Bei der Frage nach dem Token mit `Cmd+V` einfügen (es erscheint nichts) und Enter drücken. Statt des Tokens geht auch der ganze Link `moodlemobile://token=…`.
4. Zwischenablage leeren:
   ```bash
   pbcopy < /dev/null
   ```

## 4. Ablaufdatum

Die CLI trägt „heute + 12 Wochen“ ein. Zeigt Moodle unter _Profil → Einstellungen → Sicherheitsschlüssel_ („Gültig bis“) ein anderes Datum, die Anmeldung mit diesem Datum wiederholen:

```bash
pnpm sg moodle login --gueltig-bis 2027-01-27
```

Liegt eine Aufgabenfrist nach dem Ablaufdatum, weist die App schon **14 Tage** vorher darauf hin und nennt die Frist (sonst erst ab 7 Tagen). Die Zeile steht auf „Heute“, in den Moodle-Einstellungen und auf der Seite „Abgabe“. Nimmt Moodle den Zugang nicht mehr an, steht auf der Seite „Abgabe“ zuerst „In Moodle öffnen“ und darunter der Befehl zum Erneuern. Abgeben geht dann direkt in Moodle.

## 5. Prüfen

```bash
pnpm sg moodle status
```

Läuft der Core, steht dort `Zustand (laut Core): ok`, dazu Name und Seite. Direkt nach der Anmeldung kann der Core bis zu einer Minute lang noch den alten Zustand melden. Läuft der Core nicht, zeigt der Befehl nur, ob ein Eintrag im Schlüsselbund liegt.

Meldet der Befehl trotz Token weiter `nicht eingerichtet` (und `Seite:` fehlt), kennt der laufende Core die Adresse aus Schritt 1 noch nicht: einmal `pnpm sg stop && pnpm sg start`, dann erneut prüfen.

## Abgeben

Die Web-App kann eine Aufgabe in Moodle abgeben: Datei wählen, als Entwurf speichern, endgültig einreichen. Die Seite „Abgabe“ öffnest du über eine Aufgabe in der Fristenliste (auf „Heute“ oder im Modul). **Das ist standardmäßig aus.** Bis du es einschaltest, zeigt die Seite oben „Abgeben aus der App ist noch nicht freigeschaltet“ und „In Moodle öffnen“. Die Aufgabe gibst du dann direkt in Moodle ab.

### Freischalten

1. In `~/StudienGehirn/config/.env` diese Zeile ergänzen:
   ```
   SG_MOODLE_ACTIONS=assign.save_draft,assign.submit
   ```
   Wer nur Entwürfe will, lässt `assign.submit` weg. Einreichen bleibt dann in Moodle.
2. Den Core neu starten, er liest die Datei nur beim Start:
   ```bash
   pnpm sg stop && pnpm sg start
   ```
3. Die Seite „Abgabe“ neu laden. Die Zeile „noch nicht freigeschaltet“ ist weg. Bleibt sie stehen oder steht am Knopf weiter „Dein Moodle-Zugang erlaubt das nicht“, lässt dein Moodle diese Funktion für den Token nicht zu. Das lässt sich hier nicht ändern.

### Erster Test an einer folgenlosen Aufgabe

Die Abgabe wurde noch nicht an einem echten Moodle geprüft. Teste sie darum zuerst an einer Aufgabe, bei der nichts davon abhängt (eine Übungsaufgabe ohne Bewertung, eine Test-Aufgabe oder eine Aufgabe, bei der nur Speichern möglich ist und nichts zählt):

1. Eine kleine PDF oder Textdatei wählen und „Als Entwurf speichern“ drücken.
2. In Moodle nachsehen: Liegt die Datei im Entwurf der Aufgabe? Stimmt der Name?
3. Erst danach „Endgültig einreichen“, wenn die Aufgabe das hat, und wieder in Moodle prüfen.
4. Klappt etwas nicht, den Schalter wieder entfernen und dem Lead melden, was in Moodle zu sehen war. Keine Zugangsdaten und keine Namen aus echten Kursen mitschicken.

Gib nie etwas Wichtiges ab, bevor dieser Test einmal geklappt hat.

### Bestätigung und Erklärung

- **Entwurf speichern** fragt nicht nach, außer bei Aufgaben ohne Einreichen-Schritt. Dort ist Speichern schon die Abgabe, und die Rückfrage heißt „Speichern und abgeben“.
- **Endgültig einreichen** fragt immer nach. Die Rückfrage zeigt, was eingereicht wird. „Abbrechen“ ist vorgewählt, nichts läuft von selbst. Nach dem Einreichen lässt sich die Abgabe in der App nicht mehr ändern.
- Verlangt die Aufgabe die **Erklärung zur Eigenständigkeit**, steht ihr Text in der Rückfrage und das Häkchen ist leer. „Einreichen“ geht erst, wenn du es selbst setzt. Die App setzt es nie für dich.
- Läuft gerade eine Aufnahme, erscheint die Rückfrage in der Seite statt als Fenster.

### „Unklar, ob Moodle es übernommen hat“

Die App meldet das, wenn die Verbindung abbrach, nachdem die Anfrage an Moodle ging. Moodle hat dann vielleicht gespeichert oder eingereicht, vielleicht auch nicht. Die App wiederholt in diesem Fall **nicht** von selbst, damit nichts doppelt ankommt. Was du tust:

1. Oben auf der Seite unter „Stand in Moodle“ nachsehen (er lädt sich neu) oder die Aufgabe über „In Moodle öffnen“ prüfen.
2. Steht dort der Entwurf oder „Eingereicht“, ist alles gut.
3. Fehlt er, den Vorgang noch einmal ausführen.

### Stand und Frist

Oben auf der Seite steht der aktuelle Stand in Moodle: kein Entwurf, Entwurf oder eingereicht, die Dateien, die Frist und ob die Abgabe verspätet ist. Ist die Frist vorbei, sagt die Seite, ob Moodle noch bis zu einer Nachfrist annimmt. Ob eine späte Abgabe angenommen wird, entscheidet die Aufgabe in Moodle. Eine persönliche Verlängerung kennt die App nicht, darum steht dort „ohne Verlängerung“.

## Abmelden

```bash
pnpm sg moodle logout
```

Das löscht den Eintrag im Schlüsselbund und `config/moodle.json`. Ein laufender Core nutzt den Token bis zum Neustart weiter (`pnpm sg stop && pnpm sg start`).
Der Token selbst bleibt bei Moodle gültig, bis du ihn dort unter _Profil → Einstellungen → Sicherheitsschlüssel_ zurücksetzt. Das bei Verdacht auf Missbrauch immer tun.
