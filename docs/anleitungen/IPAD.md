# iPad-App aufspielen und koppeln

So kommt die App „Studien-Gehirn“ auf dein iPad. Du brauchst kein bezahltes Entwicklerkonto. Dauer beim ersten Mal: etwa 20 Minuten.

**Stand:** Die App kann koppeln und zeigt den Verbindungsstatus. Notizbücher und Stift folgen.

## Was du brauchst

- Mac mit **Xcode 16 oder neuer** (kostenlos im App Store)
- iPad mit **iPadOS 17 oder neuer** und ein USB-C-Kabel
- Deine Apple-ID
- [Homebrew](https://brew.sh) auf dem Mac. Noch nicht installiert? Öffne brew.sh, kopiere den Befehl unter „Install Homebrew“ ins Terminal und folge den Hinweisen. Am Ende nennt das Terminal unter „Next steps“ noch zwei oder drei Befehle, die du ebenfalls ausführst.
- Mac und iPad im **selben WLAN**

## 1. Xcode-Projekt erzeugen

Das Xcode-Projekt liegt nicht im Repo. Ein Skript erzeugt es aus `apps/ipad/project.yml`.

Öffne das **Terminal** und wechsle in den Ordner des Repos: Tippe `cd ` (mit Leerzeichen), zieh den Repo-Ordner aus dem Finder ins Terminal-Fenster und drück Enter. Dann:

```bash
bash apps/ipad/scripts/projekt-erzeugen.sh
open apps/ipad/StudienGehirn.xcodeproj
```

Das Skript installiert beim ersten Mal das Werkzeug XcodeGen über Homebrew.

Wiederhole diesen Schritt nach jedem `git pull`. Sonst fehlen neue Dateien im Projekt.

## 2. Mit deiner Apple-ID anmelden

1. In Xcode: **Xcode → Settings → Accounts**.
2. Unten links auf **+** klicken, **Apple ID** wählen, anmelden.

## 3. Team wählen

1. Links in der Seitenleiste ganz oben auf **StudienGehirn** klicken (blaues Symbol).
2. In der Mitte unter **TARGETS** auf **StudienGehirn** klicken.
3. Reiter **Signing & Capabilities** öffnen.
4. Bei **Team** deinen Namen mit dem Zusatz **(Personal Team)** wählen.

Meldet Xcode, dass die Kennung `de.studiengehirn.ipad` schon vergeben ist? Dann hänge im Feld **Bundle Identifier** etwas Eigenes an, zum Beispiel `de.studiengehirn.ipad.meins`.

**Wichtig:** Deine Team-ID gehört nicht ins Repo. Das Xcode-Projekt wird von Git ignoriert, dort ist sie sicher. Trage sie nie in `project.yml` ein.

Nach jedem neuen Erzeugen des Projekts (Schritt 1) musst du das Team neu wählen. Wenn dich das stört: Lege die Datei `apps/ipad/Config/Local.xcconfig` an. Git ignoriert sie. Inhalt, eine Zeile:

```
DEVELOPMENT_TEAM = <deine Team-ID>
```

## 4. iPad anschließen

1. iPad per Kabel an den Mac anschließen und entsperren.
2. Auf dem iPad **Vertrauen** antippen und den Code eingeben.
3. In Xcode oben in der Mitte auf das Gerät neben „StudienGehirn“ klicken und dein iPad wählen.

## 5. Entwicklermodus einschalten (einmalig)

1. Auf dem iPad: **Einstellungen → Datenschutz & Sicherheit → Entwicklermodus**.
2. Einschalten. Das iPad startet neu.
3. Nach dem Neustart **Aktivieren** antippen.

Der Punkt „Entwicklermodus“ erscheint erst, wenn das iPad einmal mit Xcode verbunden war.

## 6. App aufspielen

1. In Xcode auf **▶** klicken (oder `cmd` + `R`).
2. Beim ersten Mal dauert das einige Minuten. Fragt der Mac, ob `codesign` auf deinen Schlüsselbund zugreifen darf, gib dein Mac-Passwort ein und wähle **Immer erlauben**.
3. Startet die App nicht und Xcode meldet einen nicht vertrauenswürdigen Entwickler? Dann auf dem iPad: **Einstellungen → Allgemein → VPN & Geräteverwaltung**. Unter **Entwickler-App** deine Apple-ID antippen und **Vertrauen** wählen. Danach in Xcode noch einmal **▶**.

## 7. „Lokales Netzwerk“ erlauben

Beim ersten Start fragt das iPad, ob die App Geräte im lokalen Netzwerk finden darf. Tippe **Erlauben**.

Ohne diese Erlaubnis erreicht die App den Mac nicht. Nachträglich ändern: **Einstellungen → Datenschutz & Sicherheit → Lokales Netzwerk → Studien-Gehirn**.

## 8. Koppeln

1. **Am Mac:** Studien-Gehirn starten. In der Web-App **Einstellungen → Geräte** öffnen und die Kopplung starten. Der Mac zeigt einen QR-Code, einen Code mit sechs Ziffern und seine Adresse. Das Fenster gilt 5 Minuten.
2. **Am iPad**, empfohlener Weg: **QR-Code scannen** antippen, die Kamera erlauben und den QR-Code am Mac scannen. Das iPad zeigt danach die Adresse aus dem QR-Code. Vergleiche sie mit der Adresse, die der Mac anzeigt. Stimmen beide überein, tippe **Koppeln** an.
   - Steht dort die Warnung **„Diese Adresse liegt nicht in deinem Heimnetz“**, führt die Adresse nicht in ein privates WLAN. Das ist in manchen Uni-WLANs normal, kann aber auch ein fremder QR-Code sein. Kopple nur, wenn der Mac genau diese Adresse anzeigt. Im Zweifel tippe **Abbrechen** an.
3. **Ohne Kamera:** Tippe unter „Im WLAN gefunden“ deinen Mac an. Oder gib unter „Adresse von Hand“ die Adresse ein, die der Mac anzeigt. Tippe dann die sechs Ziffern ein und wähle **Koppeln**.
4. Die Web-App meldet das neue Gerät. Oben rechts in der iPad-App steht **Mac ●** mit grünem Punkt.

Der QR-Code ist der sicherste Weg. Namen in der Liste „Im WLAN gefunden“ sind nicht geprüft.

## Die App läuft nur 7 Tage

Mit dem kostenlosen Personal Team gilt die Signatur **7 Tage**. Danach startet die App nicht mehr.

Abhilfe: iPad anschließen und in Xcode wieder auf **▶** klicken (Schritt 6). Die Kopplung bleibt dabei erhalten. Lösche die App dafür nicht.

## Wenn etwas nicht klappt

Tippe in der App oben rechts auf **Mac ●**. Dort steht die Ursache.

| Anzeige | Was hilft |
|---|---|
| Lokales Netzwerk nicht erlaubt | Schritt 7 |
| Kein WLAN | iPad ins selbe WLAN wie den Mac bringen. Auch Schritt 7 prüfen |
| Mac antwortet nicht / Mac nicht gefunden | Läuft Studien-Gehirn am Mac? Stimmt die Adresse? Sonst weiter mit [IPAD-VERBINDUNG.md](IPAD-VERBINDUNG.md) |
| Kopplung am Mac nicht geöffnet | Am Mac die Kopplung neu starten (Schritt 8). Der Code gilt nur 5 Minuten |
| Code stimmt nicht | Code vergleichen. Nach 5 falschen Codes von vorn beginnen |
| Kopplung gesperrt | Am Mac die Kopplung neu starten |
| Kopplung nicht mehr gültig | Das iPad wurde am Mac entfernt. **Neu koppeln** antippen |
| Verbindung vom System blockiert | Fehler in der App. Bitte melden |

Im Uni-WLAN sehen sich Geräte oft nicht gegenseitig. Nimm dann das Heim-WLAN oder den Hotspot deines iPhones.

## Kopplung aufheben

In der App: **Mac ●** antippen, dann **Kopplung aufheben**. Das iPad meldet sich am Mac ab.

War der Mac dabei nicht erreichbar? Dann entferne das iPad zusätzlich am Mac unter **Einstellungen → Geräte**.
