# Moodle verbinden

Gilt für Moodle.UP (`https://moodle2.uni-potsdam.de`). Dauer: etwa 1 Minute. Der Token gilt **12 Wochen**, danach dieselben Schritte wiederholen.
Hintergrund: F-MDL-01 (Kap. 04), 08 §9.1, T1-26.

> Der Token hat dieselben Rechte wie dein Moodle-Konto. Er liegt nur im macOS-Schlüsselbund (Dienst `studiengehirn-moodle`). Nie in Chats, Issues, PRs oder Dateien einfügen.

## 1. Einmalig: Adresse für den Core eintragen

In `~/StudienGehirn/config/.env` diese Zeile ergänzen (falls noch nicht vorhanden):

```
SG_MOODLE_URL=https://moodle2.uni-potsdam.de
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

## 5. Prüfen

```bash
pnpm sg moodle status
```

Läuft der Core, steht dort `Zustand (laut Core): ok`, dazu Name und Seite. Direkt nach der Anmeldung kann der Core bis zu einer Minute lang noch den alten Zustand melden. Läuft der Core nicht, zeigt der Befehl nur, ob ein Eintrag im Schlüsselbund liegt.

## Abmelden

```bash
pnpm sg moodle logout
```

Das löscht den Eintrag im Schlüsselbund und `config/moodle.json`. Ein laufender Core nutzt den Token bis zum Neustart weiter (`pnpm sg stop && pnpm sg start`).
Der Token selbst bleibt bei Moodle gültig, bis du ihn dort unter _Profil → Einstellungen → Sicherheitsschlüssel_ zurücksetzt. Das bei Verdacht auf Missbrauch immer tun.
