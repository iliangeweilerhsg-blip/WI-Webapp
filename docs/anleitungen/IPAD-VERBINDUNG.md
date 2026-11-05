# iPad erreicht den Mac nicht

Gilt für die Kopplung (Einstellungen → Geräte), den Sync und die Spike-App S1. Kurz: Das iPad findet den Mac über Bonjour, kann ihn aber nicht über `http://<Mac-IP>:<Port>` erreichen.

## Bekannte Ursache (05.11.2026)

**Cisco Secure Client (Uni-VPN) mit seiner „Socket Filter Extension“** blockiert eingehende Verbindungen auf dem Mac. Das gilt auch, wenn das VPN gar nicht verbunden ist, und in jedem Netz (Heim-WLAN wie iPhone-Hotspot).

Typische Anzeichen:

- Auf dem Mac liefert `curl http://localhost:<Port>` eine Antwort, auf dem iPad lädt die Seite aber nicht.
- `ping <iPad-IP>` vom Mac aus klappt.
- Die macOS-Firewall ist aus.

## Lösung

1. Cisco Secure Client über die Menüleiste beenden.
2. Systemeinstellungen → Allgemein → Anmeldeobjekte & Erweiterungen → **Netzwerkerweiterungen** → „Cisco Secure Client – Socket Filter“ **ausschalten**.
3. Das Studien-Gehirn bzw. den Server neu starten.

Braucht man das Uni-VPN, schaltet man die Erweiterung nur dafür ein und danach wieder aus.

## Weitere mögliche Störenfriede

Auf dem Mac des Owners laufen außerdem **Tailscale** (Network Extension) und **Avira** (Scan Service). Beide können eingehende Verbindungen ebenfalls filtern. Bleibt das Problem trotz Schritt 1–2 bestehen, nacheinander beenden und jeweils neu testen.

## Schnelltest ohne die App

So lässt sich klären, ob es am Netz bzw. Mac liegt oder an unserer App:

```bash
python3 -m http.server 8001 --bind 0.0.0.0
```

Auf dem iPad in Safari `http://<Mac-IP>:8001` öffnen. Die eigene IP zeigt `ipconfig getifaddr en0`.

- Erscheint eine Dateiliste, ist das Netz in Ordnung, und das Problem liegt bei der App.
- Erscheint keine Dateiliste, blockiert etwas auf dem Mac oder im Netz.

Danach den Test-Server mit ctrl+C beenden. „Address already in use“ heißt nur, dass schon ein Test-Server läuft, dann einen anderen Port nehmen.

## Checkliste in dieser Reihenfolge

1. **Gleiches Netz:** Die IP des iPads (Einstellungen → WLAN → (i)) und `ipconfig getifaddr en0` beginnen gleich, zum Beispiel `192.168.178.`. Das iPad darf nicht im Gast-WLAN der Fritz!Box sein.
2. **Mac-Firewall:**

   ```bash
   /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate --getblockall --getstealthmode
   ```

3. **Filternde Erweiterungen:**

   ```bash
   systemextensionsctl list
   ```

   Achten auf Cisco, Tailscale, Virenscanner und Firewall-Apps wie Little Snitch oder LuLu.
4. **Mac → iPad:**

   ```bash
   ping -c 4 <iPad-IP>
   ```

   Ohne spitze Klammern eingeben.
5. **Auf dem iPad:**
   - Einstellungen → Datenschutz & Sicherheit → Lokales Netzwerk → Swift Playgrounds bzw. die App einschalten.
   - Kein VPN und kein DNS-/Werbeblocker-Profil.

Dass Terminal unter macOS → Lokales Netzwerk nicht aufgeführt ist, ist normal und nicht die Ursache.
