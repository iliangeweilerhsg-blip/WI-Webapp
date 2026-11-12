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

Die iPad-App musst du nur neu aufspielen, wenn sich ihr Code geändert hat. Prüfe das direkt nach dem `git pull`:

```bash
git diff --stat HEAD@{1} -- apps/ipad apps/mac-tunnel/Sources/TunnelShared packages/schemas/swift-support packages/schemas/generated/swift
```

(`apps/mac-tunnel/Sources/TunnelShared` und die beiden Schema-Ordner baut die App mit ein.)

- **Keine Ausgabe:** Es hat sich nichts geändert. Die App bleibt, wie sie ist.
- **Dateien aufgelistet:** Spiele die App neu auf, wie in [IPAD.md](IPAD.md) beschrieben (Schritt 1 und Schritt 6). Die Kopplung bleibt erhalten. Lösche die App nicht.
- **Einmalig beim Update auf die Direktverbindung (UX-12):** Danach zeigt das iPad „Bitte einmal neu koppeln“. Das ist erwartet. Was du tust: [IPAD.md](IPAD.md), Abschnitt „Nach dem Update: einmal neu koppeln“.

Meldet die iPad-App „Der Mac spricht ein anderes Protokoll. App aktualisieren.“, ist sie älter als der Mac. Spiele sie dann ebenfalls neu auf. Einen Hinweis darauf am Mac gibt es noch nicht.

## Wenn etwas schiefgeht

- `pnpm sg start` meldet, dass Core oder Worker schon läuft: erst `pnpm sg stop`.
- Prüfung der Voraussetzungen: `pnpm sg doctor`.
- Daten zurückholen: [BACKUP-WIEDERHERSTELLEN.md](BACKUP-WIEDERHERSTELLEN.md).
