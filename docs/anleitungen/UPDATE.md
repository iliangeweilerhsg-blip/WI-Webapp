# Update

So holst du neue Versionen auf den Mac und aufs iPad. Mach das **nicht am Vorlesungstag** und nicht am Abend davor, sondern am Wochenende. So bleibt Zeit zum Testen.

## Mac

1. Läuft das Studien-Gehirn, beende es: `pnpm sg stop` (oder `ctrl` + `C` im Terminal, in dem es läuft).
2. Neue Version holen:

   ```bash
   git pull
   ```

3. Abhängigkeiten installieren, falls sie sich geändert haben:

   ```bash
   pnpm install
   ```

   Das ist nur zur Sicherheit nötig. `pnpm sg start` vergleicht die Pakete selbst mit `pnpm-lock.yaml` und installiert bei Abweichung nach.
4. Starten:

   ```bash
   pnpm sg start
   ```

   Der Befehl baut die Web-App neu, wenn sie sich geändert hat, und führt Datenbank-Migrationen aus. Vor einer Migration legt er ein Backup an, sofern unter **Einstellungen → Daten und Papierkorb** ein Backup-Ziel steht. Ohne Ziel meldet er das und migriert ohne Backup. Scheitert das Backup, bricht der Start ab.
5. Öffne **Heute** und prüfe, dass alles lädt.

## iPad-App

Die iPad-App musst du nur neu aufspielen, wenn sich ihre Quellen geändert haben. Das sind `apps/ipad` und die Teile, die Xcode mit einbaut: `packages/schemas/generated/swift`, `packages/schemas/swift-support` und der gemeinsame Tunnel-Code unter `apps/mac-tunnel/Sources/TunnelShared`.

`pnpm sg start` sagt dir Bescheid: Haben sich diese Quellen seit dem letzten Aufspielen geändert, steht nach dem Start im Terminal „iPad-App neu aufspielen“. Der Hinweis kommt bei jedem Start wieder, bis du das Aufspielen bestätigst:

1. Spiele die App neu auf, wie in [IPAD.md](IPAD.md) beschrieben (Schritt 1 und Schritt 6). Die Kopplung bleibt erhalten. Lösche die App nicht.
2. Bestätige danach im Terminal:

   ```bash
   pnpm sg ipad aufgespielt
   ```

`pnpm sg ipad` zeigt jederzeit, ob die App aktuell ist. Ob die App auf dem iPad wirklich neu ist, kann `sg` nicht sehen. Es vergleicht nur den Stand im Repo mit dem, den du zuletzt bestätigt hast. Beim allerersten Start merkt sich `sg` nur den Stand. Ohne Git, etwa in einem entpackten Ordner, gibt es keinen Hinweis. Von Hand prüfst du es direkt nach dem `git pull`:

```bash
git diff --stat HEAD@{1} -- apps/ipad apps/mac-tunnel/Sources/TunnelShared packages/schemas/swift-support packages/schemas/generated/swift
```

Meldet die iPad-App „Der Mac spricht ein anderes Protokoll. App aktualisieren.“, ist sie älter als der Mac. Spiele sie dann ebenfalls neu auf.

## Einmalig beim Update auf die Direktverbindung (UX-12)

Nach diesem Update zeigt das iPad „Bitte einmal neu koppeln“. Das ist erwartet. Hier steht die vollständige Liste, [IPAD.md](IPAD.md) und #188 verweisen darauf. Du brauchst nur **ein** Terminal. Das Neukoppeln geht nur zu Hause im WLAN, mach es also nicht erst in der Uni.

Vorher: Mac aktualisiert (Abschnitt „Mac“, `git pull`) und die iPad-App neu aufgespielt (Abschnitt „iPad-App“). Erst die neue App bekommt beim Koppeln den Schlüssel.

1. **Starten:** `pnpm sg stop`, dann `pnpm sg start` (läuft es schon aus Abschnitt „Mac“, reicht der Blick auf Schritt 2). Beim ersten Mal baut `sg` den Tunnel-Helfer `sg-tunnel` (etwa eine Minute, braucht Xcode oder `xcode-select --install`). Fragt macOS, ob „sg-tunnel“ eingehende Verbindungen annehmen darf: **Erlauben**.
2. **Auf die Zeile zur Direktverbindung achten:** Wenige Sekunden nach „Studien-Gehirn läuft“ prüft `sg start` selbst, ob das iPad durchkommt. Steht dort „Direktverbindung vom iPad: bereit“, weiter mit Schritt 3. Sonst nennt `sg start` unter „noch nicht bereit“, was fehlt, und was hilft:
   - **Firewall:** Systemeinstellungen → Netzwerk → Firewall → Optionen: „sg-tunnel“ auf „Eingehende Verbindungen erlauben“, dann `pnpm sg stop` und `pnpm sg start`.
   - **WLAN am Mac aus:** WLAN einschalten. Ein Netz brauchst du nicht, aber die Direktverbindung braucht das WLAN.
   - **Gerät ohne Schlüssel:** Das ist dein altes iPad, das ändert Schritt 3 bis 5.

   Das ist dieselbe Prüfung wie `pnpm sg doctor` (zusätzlich zeigt `sg doctor` alle Zeilen). Was bei einem ✗ hilft: [IPAD-VERBINDUNG.md](IPAD-VERBINDUNG.md), Abschnitt 5.
3. **Alten Eintrag entfernen:** In der Web-App am Mac unter **Einstellungen → Geräte** den Eintrag des iPads entfernen.
4. **Neu koppeln:** Am iPad **Mac ●** antippen, dann **Neu koppeln**. Am Mac die Kopplung starten und den QR-Code mit dem iPad scannen ([IPAD.md](IPAD.md), Abschnitt „Koppeln“).
5. **Fertig, wenn** **Mac ●** grün ist. In den Verbindungsdetails steht „Verbunden über das WLAN“ oder „Direkt verbunden, ohne WLAN-Netz“.

Nach einer Wiederherstellung (`pnpm sg restore`) ist kein Gerät mehr gekoppelt. Dann entfällt Schritt 3, und am iPad steht meist „Kopplung aufheben“ statt „Neu koppeln“. Details: [BACKUP-WIEDERHERSTELLEN.md](BACKUP-WIEDERHERSTELLEN.md).

## Wenn etwas schiefgeht

- `pnpm sg start` meldet, dass Core oder Worker schon läuft: erst `pnpm sg stop`.
- Prüfung der Voraussetzungen: `pnpm sg doctor`.
- Daten zurückholen: [BACKUP-WIEDERHERSTELLEN.md](BACKUP-WIEDERHERSTELLEN.md).
