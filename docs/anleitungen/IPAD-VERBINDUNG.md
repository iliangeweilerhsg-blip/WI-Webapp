# iPad erreicht den Mac nicht

Diese Anleitung hilft, wenn das iPad den Mac zwar findet (Bonjour), ihn aber nicht über `http://<Mac-IP>:<Port>` erreicht. Das betrifft die Kopplung in der Web-App (Einstellungen → Geräte), den Sync und die Spike-App S1 (Port 4797). Dauer: etwa 10 Minuten.

`<Mac-IP>` und `<iPad-IP>` ersetzt du jeweils durch die Zahl selbst, ohne spitze Klammern, z. B. `192.168.178.22`.

## Bekannte Ursache (Diagnose vom 05.11.2026)

Auf deinem Mac war es **Cisco Secure Client** (Uni-VPN) mit seiner **„Cisco Secure Client – Socket Filter Extension“**. Laut Diagnose blockiert sie eingehende Verbindungen vom iPad, und zwar im Heim-WLAN genauso wie im iPhone-Hotspot.

Daran erkennst du es:

- Auf dem Mac antwortet der Server, aber auf dem iPad lädt die Seite nicht.
- `ping <iPad-IP>` vom Mac aus klappt.
- Die macOS-Firewall ist aus.

## 1. Prüfen, ob Cisco schuld ist

Öffne das **Terminal**: `cmd` + Leertaste, „Terminal“ eintippen, Enter. Dann:

```bash
systemextensionsctl list
```

Steht in der Ausgabe eine Zeile mit **„Cisco Secure Client – Socket Filter Extension“** und `[activated enabled]`, ist das sehr wahrscheinlich die Ursache.

## 2. Lösung

1. **Cisco beenden:** oben rechts in der Menüleiste auf das Cisco-Symbol klicken → *Beenden*.
2. **Socket Filter ausschalten:**
   1. Systemeinstellungen → Allgemein → **Anmeldeobjekte & Erweiterungen** öffnen.
   2. Ganz unten im Abschnitt „Erweiterungen“ neben **Netzwerkerweiterungen** auf das **(i)** klicken.
   3. Den Eintrag „Cisco Secure Client – Socket Filter“ (oder ähnlich benannt) ausschalten. macOS fragt dabei eventuell nach deinem Mac-Passwort.
3. Das Studien-Gehirn (`pnpm sg start`) bzw. den Spike-Server neu starten.

Brauchst du das Uni-VPN, schaltest du den Filter vermutlich nur dafür wieder ein und danach wieder aus. Ob das VPN ohne den Filter funktioniert, ist noch nicht geprüft.

## 3. Schnelltest ohne die App

Damit siehst du, ob es am Netz bzw. Mac liegt oder an unserer App.

1. Im Terminal einen **leeren** Test-Ordner anlegen und den Test-Server starten. Der Server zeigt den Inhalt des aktuellen Ordners im ganzen WLAN, darum bitte nie im eigenen Benutzerordner starten:

   ```bash
   mkdir -p ~/ipad-test && cd ~/ipad-test && python3 -m http.server 8001 --bind 0.0.0.0
   ```

   Fragt macOS, ob Python eingehende Verbindungen annehmen darf, wähle **Erlauben**. Kommt ein Dialog zur Installation der Entwicklerwerkzeuge, diese installieren und den Befehl danach wiederholen.
2. Die IP deines Macs herausfinden, in einem zweiten Terminal-Fenster:

   ```bash
   ipconfig getifaddr en0
   ```

   Erscheint nichts, `ipconfig getifaddr en1` probieren, oder unter Systemeinstellungen → WLAN → Details nachsehen.
3. Auf dem iPad in Safari `http://<Mac-IP>:8001` öffnen.
   - Erscheint eine (leere) Dateiliste, ist das Netz in Ordnung. Das Problem liegt dann bei der App, also bitte Claude melden.
   - Erscheint keine Dateiliste, blockiert etwas auf dem Mac oder im Netz. Weiter mit der Checkliste.
4. Test-Server im ersten Fenster mit **ctrl+C** beenden. Die Meldung „Address already in use“ heißt nur, dass schon ein Test-Server läuft. Dann diesen benutzen oder einen anderen Port nehmen.

## 4. Checkliste, wenn es weiter nicht klappt

1. **Gleiches Netz:**
   - Die IP des iPads findest du unter Einstellungen → WLAN → (i) neben deinem Netz.
   - Deren erste drei Zahlenblöcke müssen mit denen des Macs übereinstimmen, zu Hause z. B. `192.168.178.`, im iPhone-Hotspot `172.20.10.`.
   - Das iPad darf nicht im Gast-WLAN der Fritz!Box sein.
2. **Mac-Firewall:**

   ```bash
   /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate --getblockall --getstealthmode
   ```

   Gut ist „Firewall is disabled“. Ist sie eingeschaltet, sollte „block all“ ausgeschaltet sein.
3. **Andere filternde Programme:** In der Ausgabe von `systemextensionsctl list` (Schritt 1) auf weitere Zeilen mit `[activated enabled]` achten. Bei dir sind das zusätzlich **Tailscale** und **Avira**. Beide können Verbindungen ebenfalls filtern. Teste sie nacheinander: beenden, dann den Schnelltest wiederholen.
4. **Mac erreicht das iPad?**

   ```bash
   ping -c 4 <iPad-IP>
   ```

   Antworten kommen zurück, wenn das Netz selbst in Ordnung ist.
5. **Auf dem iPad:**
   - Beim ersten Verbinden fragt die App (z. B. in Swift Playgrounds), ob sie „Geräte in deinem lokalen Netzwerk finden“ darf. Hier **Erlauben** wählen.
   - Hast du das abgelehnt: Einstellungen → Datenschutz & Sicherheit → Lokales Netzwerk → den Eintrag der App einschalten, sofern vorhanden.
   - Prüfen, dass auf dem iPad kein VPN und kein Werbeblocker- bzw. DNS-Profil aktiv ist: Einstellungen → Allgemein → VPN & Geräteverwaltung.

Hinweis: Die Liste unter Systemeinstellungen → Datenschutz & Sicherheit → Lokales Netzwerk auf dem **Mac** betrifft nach bisherigem Kenntnisstand vor allem Verbindungen, die der Mac selbst aufbaut. Dass „Terminal“ dort fehlt, war bei der Diagnose am 05.11. nicht die Ursache.
