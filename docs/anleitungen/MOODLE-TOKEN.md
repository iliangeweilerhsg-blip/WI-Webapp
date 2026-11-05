# Moodle-Token einrichten oder erneuern

Gilt für Moodle.UP (`https://moodle2.uni-potsdam.de`, Anmeldung über UP-SSO/Shibboleth). Der Token gilt **12 Wochen**. Danach diese Schritte wiederholen. Dauer: etwa 2 Minuten.
Hintergrund: F-MDL-01 (Kap. 04), 08 §9.1. Bis `pnpm sg moodle login` (T1-26) fertig ist, geht es von Hand.

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
security add-generic-password -a "$USER" -s studiengehirn-moodle -U -w "$(pbpaste)" && pbcopy < /dev/null && echo "gespeichert"
```

Danach das Ablaufdatum unter *Profil → Einstellungen → Sicherheitsschlüssel* („Gültig bis“) in `~/StudienGehirn/config/moodle.json` eintragen:

```json
{ "site_url": "https://moodle2.uni-potsdam.de", "token_valid_until": "2027-01-27" }
```

## 4. Prüfen

```bash
printf '%s' "wstoken=$(security find-generic-password -s studiengehirn-moodle -w)&wsfunction=core_webservice_get_site_info&moodlewsrestformat=json" | curl -s --data-binary @- https://moodle2.uni-potsdam.de/webservice/rest/server.php | python3 -m json.tool | grep -E '"(sitename|fullname)"'
```

Erscheinen `Moodle.UP` und dein Name, ist alles fertig.
