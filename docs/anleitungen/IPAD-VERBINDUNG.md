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

## 5. Der Mac-Helfer für die Direktverbindung (`sg-tunnel`)

Für die Direktverbindung im Hörsaal (Wi-Fi peer-to-peer, ohne gemeinsames Netz) läuft am Mac ein kleines Programm, der Helfer `sg-tunnel`. Plan: `docs/plaene/UX-12-MAC-WIEDERFINDEN.md`.

**Stand heute:** Mac-Seite und iPad sind fertig. Das iPad spricht nach der Kopplung **nur noch über den Helfer** mit dem Mac, zu Hause und im Hörsaal (Abschnitt 6). Läuft der Helfer nicht, gibt es keinen Abgleich: Das iPad fällt bewusst nicht auf die alte Adresse zurück. Dein Schreiben bleibt auf dem iPad und geht danach zum Mac. Ein iPad, das vor dem Tunnel gekoppelt wurde, muss einmal neu gekoppelt werden ([IPAD.md](IPAD.md)).

### Was `pnpm sg start` und `pnpm sg stop` damit tun

- **Start:** Beim ersten Start baut `sg` den Helfer (etwa eine Minute, danach nur noch, wenn sich sein Quellcode ändert). Er startet **nach** dem Core, Meldungen im Terminal tragen das Präfix `[tunnel]`. Stürzt er ab, startet `sg` ihn neu, höchstens 5-mal in 10 Minuten, dann kommt eine Meldung.
- **Stopp:** `pnpm sg stop` (und Strg+C) beendet ihn **vor** dem Core.
- **Voraussetzung:** Xcode oder die Kommandozeilenwerkzeuge (`xcode-select --install`). Ein Apple-Konto brauchst du nicht. Fehlt Swift oder scheitert der Bau, meldet `sg` das deutlich und startet alles andere trotzdem, nur ohne Direktverbindung.
- **Abschalten:** `SG_TUNNEL=0 pnpm sg start` schaltet den Tunnel-Eingang des Core und den Helfer ganz ab. `SG_TUNNEL_P2P=0 pnpm sg start` lässt den Helfer laufen, kündigt ihn aber nicht über Wi-Fi peer-to-peer an (nur im gemeinsamen WLAN).
- **Was der Helfer nie tut:** Er liest das Geräte-Token nie und schaut nicht in die Daten. Er hört nur auf Verbindungen, die sich mit dem Schlüssel des gekoppelten iPads ausweisen, und reicht sie unverändert an den Core weiter. Ist die Schlüsseldatei weg oder kaputt, stoppt er alle Dienste.

### Was `pnpm sg doctor` meldet

Die Zeilen beginnen mit „Tunnel-Helfer ·“. Ein ✗ bedeutet: etwas ist kaputt, darunter steht, was zu tun ist.

| Zeile | Bedeutung |
|---|---|
| Swift | ✗ Swift fehlt: `xcode-select --install`. Ohne Swift gibt es keine Direktverbindung, der Rest läuft |
| Programm | ℹ „noch nicht gebaut“ oder „veraltet“: `pnpm sg start` baut es beim nächsten Start. ✗ „wird nicht gestartet“: Das Programm oder ein Ordner auf dem Weg dorthin gehört nicht dir, ist für andere beschreibbar oder zeigt aus dem Repo heraus. `sg` startet so ein Programm nie. `apps/mac-tunnel/.build` löschen, dann `pnpm sg stop` und `pnpm sg start` |
| Prozess | ✗ „läuft nicht, obwohl der Core läuft“: im Terminal von `pnpm sg start` nach `[tunnel]` suchen (Bau fehlgeschlagen? Absturz?), dann `pnpm sg stop` und `pnpm sg start`. ℹ „läuft nicht“ ist normal, solange `sg start` nicht läuft |
| Zustand | ✗ Zustandsdatei fehlt, ist unlesbar oder älter als 15 Sekunden: Der Helfer hängt, `pnpm sg stop` und `pnpm sg start` |
| Core | ✗ Der Helfer erreicht den Tunnel-Eingang des Core nicht. Läuft der Core, und ist er ohne `SG_TUNNEL=0` gestartet? Solange das so ist, nimmt der Helfer keine Verbindung an |
| Schlüssel / Schlüsseldatei | ✗ Rechte oder Besitzer von `secrets/` und `tunnel-keys.json` stimmen nicht (erwartet 0700 und 0600, dein Benutzer), oder die Datei ist ein Symlink. Der Helfer hat dann alles gestoppt. Ein Neustart von `sg` richtet beides wieder her |
| Dienste | Ein Dienst je gekoppeltem Gerät. ✗, wenn keiner bereit ist. ℹ, wenn noch kein Gerät mit Tunnel-Schlüssel gekoppelt ist |
| Peer-to-peer | ℹ an oder aus (`SG_TUNNEL_P2P`) |
| Dienstname | ✗ macOS hat den Bonjour-Namen umbenannt („… (2)“), weil ihn jemand schon belegt hat. `pnpm sg stop`, `pnpm sg start`. Bleibt es, ist in Funkreichweite ein zweites Studien-Gehirn oder ein Fremder, der den Namen belegt |
| Handshakes | ℹ Viele gescheiterte Verbindungsversuche seit dem Start. Meist ein iPad mit altem Schlüssel (neu koppeln) oder jemand im Funk. Das ist nur Verzögerung, kein Leck |
| Geräte ohne Schlüssel | ✗ Gekoppelte Geräte ohne Tunnel-Schlüssel (vor UX-12 gekoppelt). Sie müssen **einmal neu gekoppelt** werden: In der Web-App unter Einstellungen → Geräte entfernen, dann das iPad zu Hause neu koppeln (QR-Code). Der Schlüssel entsteht nur bei der Kopplung, nie nachträglich |
| Firewall | siehe unten |

### Die Firewall-Frage

Ist die macOS-Firewall an, fragt macOS beim Start des Helfers: „Möchtest du, dass „sg-tunnel“ eingehende Netzwerkverbindungen akzeptiert?“

- **Antworte mit „Erlauben“.** Die Frage erscheint am Mac, nie am iPad.
- Der Helfer wird ohne Apple-Konto gebaut und nur lokal signiert. Darum kann die Frage **nach jedem Neubau** wiederkommen (nach einem `git pull`, das den Helfer ändert).
- Hast du versehentlich „Ablehnen“ geklickt, ist der Helfer still gesperrt. `pnpm sg doctor` meldet das (✗ Firewall). Behebung: Systemeinstellungen → Netzwerk → Firewall → Optionen, „sg-tunnel“ auf „Eingehende Verbindungen zulassen“ stellen, dann `pnpm sg stop` und `pnpm sg start`.
- Bei dir ist die Firewall laut Abschnitt 4 aus, dann erscheint die Frage nicht.
- **Nicht geprüft:** Wie sich die Firewall und der Cisco-Socket-Filter (Abschnitt „Bekannte Ursache“) gegenüber dem Helfer verhalten, ob macOS 15 beim „Lokalen Netzwerk“ für `sg-tunnel` fragt (aus dem Terminal gestartete Programme sind laut Apple ausgenommen), und wie der Wortlaut von `socketfilterfw` genau ausfällt. Der Gerätetest im Hörsaal (Plan §9.1) klärt das.

## 6. Im Hörsaal: das iPad findet den Mac nicht

Das iPad sucht seinen Mac über einen Bonjour-Dienst (`_sg-tunnel._tcp`), erst im gemeinsamen WLAN (2 Sekunden), dann per Wi-Fi peer-to-peer (bis 10 Sekunden). Den zuletzt erfolgreichen Weg versucht es zuerst. Ein Netz, ein Hotspot oder eine IP-Adresse braucht es nicht. Tippe auf **Mac ●**, dort steht die Ursache:

| Anzeige | Was sie heißt | Was hilft |
|---|---|---|
| Suche deinen Mac … | Normal in den ersten Sekunden | Warten |
| Mac nicht gefunden | Kein Dienst mit dem Namen deines Macs zu sehen | Mac aufgeklappt und am Netzteil? `pnpm sg start` läuft? Am Mac WLAN an? `pnpm sg doctor` ansehen (Zeilen „Tunnel-Helfer“) |
| WLAN ist aus | Am iPad ist WLAN ausgeschaltet. Auch die Direktverbindung braucht es | WLAN am iPad einschalten. Ein Netz brauchst du nicht |
| Lokales Netzwerk nicht erlaubt | iPadOS lässt die Suche nicht zu | Einstellungen → Datenschutz & Sicherheit → Lokales Netzwerk → Studien-Gehirn. Nach dem Aufspielen kann die Erlaubnis zurückgesetzt sein |
| Mac nicht gefunden, mit dem Satz „… nicht mit dem richtigen Schlüssel“ | Etwas unter dem Namen deines Macs hat den Handshake begonnen, kennt aber den Schlüssel nicht. Jeder in Funkreichweite kann den Namen nachsprechen. Der Satz erscheint erst nach drei vergeblichen Suchläufen | Nichts entkoppeln. Zu Hause prüfen, ob das iPad am Mac unter Einstellungen → Geräte noch steht. Kommt der Hinweis zu Hause, am Mac `pnpm sg doctor` ansehen |
| Bitte einmal neu koppeln | Dieses iPad hat keinen Tunnel-Schlüssel (vor dem Tunnel gekoppelt) | [IPAD.md](IPAD.md), Abschnitt „Nach dem Update: einmal neu koppeln“ |

**Was in den Verbindungsdetails steht, wenn alles läuft:** „Verbunden über das WLAN“ (gemeinsames Netz) oder „Direkt verbunden, ohne WLAN-Netz“ (peer-to-peer). Die Zeile nennt den Weg der zuletzt aufgebauten Verbindung. Sie wechselt nur, wenn eine neue Verbindung entsteht, nie mitten in einer bestehenden.

**Tempo:** Den Weg zu deinem Mac merkt sich das iPad zwei Minuten lang. Folgende Verbindungen (Seiten, Folien) sparen sich so die Suche. Nach einem Netzwechsel oder wenn die App wieder in den Vordergrund kommt, sucht es neu.

**Die macOS-Firewall und der Cisco-Socket-Filter** (Abschnitte 1 und 5) können den Helfer sperren. `pnpm sg doctor` meldet das.

**Nicht geprüft:** Peer-to-peer im vollen Hörsaal, die Dauer des Aufbaus, der Akku über 90 Minuten und das Verhalten der Erlaubnis „Lokales Netzwerk“ nach dem wöchentlichen Aufspielen. Das klärt der Gerätetest (Plan Abschnitt 9.1). Der frühere Test aus [SPIKE-P2P.md](SPIKE-P2P.md) ist erledigt.
