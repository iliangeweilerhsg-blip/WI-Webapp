# Moodle-Token einrichten oder erneuern

Gilt für Moodle.UP (`https://moodle2.uni-potsdam.de`, Anmeldung über UP-SSO/Shibboleth). Der Token gilt **12 Wochen**. Danach diese Schritte wiederholen. Dauer: etwa 2 Minuten.
Hintergrund: F-MDL-01 (Kap. 04), 08 §9.1. Das ist der Weg, wenn `pnpm sg moodle login` mit Benutzername und Passwort nicht geht (SSO-Konto). Überblick: [MOODLE.md](MOODLE.md).

> Der Token hat dieselben Rechte wie dein Moodle-Konto. Nicht in Chats, Issues, PRs oder Dateien einfügen. Bei Verdacht: in Moodle unter *Profil → Einstellungen → Sicherheitsschlüssel* zurücksetzen.

## 1. Token-Link öffnen

1. In **Safari** normal bei Moodle.UP anmelden.
2. Im selben Fenster diese Adresse öffnen:
   ```
   https://moodle2.uni-potsdam.de/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=12345&urlscheme=moodlemobile&confirmed=1
   ```
3. Eine Meldung wie „Adresse ungültig“ wegschließen. Die Seite zeigt den Link „Tippen Sie hier, falls sich die mobile App nicht automatisch öffnet.“

## 2. Token in die Zwischenablage holen

Safari kopiert Links mit `moodlemobile://` nicht per Rechtsklick. Darum:

1. **Entwickler → JavaScript-Konsole einblenden** (`Cmd+Option+C`). Fehlt das Menü: *Safari → Einstellungen → Erweitert → „Funktionen für Webentwickler anzeigen“*.
2. In die Konsole einfügen und Enter drücken:
   ```js
   copy(atob(document.querySelector('a[href*="token="]').href.split('token=')[1].replace(/%3D/g,'=')).split(':::')[1]); "Token kopiert"
   ```

## 3. Im Schlüsselbund ablegen

```bash
pnpm sg moodle login --token-stdin
```

Bei der Frage nach dem Token mit `Cmd+V` einfügen (es erscheint nichts) und Enter drücken. Die CLI prüft den Token bei Moodle, legt ihn im Schlüsselbund ab (Dienst `studiengehirn-moodle`) und trägt das Ablaufdatum (heute + 12 Wochen) in `~/StudienGehirn/config/moodle.json` ein. Der Token steht dabei nie in der Befehlszeile.

Danach die Zwischenablage leeren:

```bash
pbcopy < /dev/null
```

Zeigt Moodle unter _Profil → Einstellungen → Sicherheitsschlüssel_ („Gültig bis“) ein anderes Datum, den Befehl mit `--gueltig-bis JJJJ-MM-TT` wiederholen.

## 4. Prüfen

```bash
pnpm sg moodle status
```

Läuft der Core, erscheint `Zustand (laut Core): ok`, dazu Moodle.UP und dein Name.
