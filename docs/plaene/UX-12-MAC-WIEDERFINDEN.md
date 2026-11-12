# Plan UX-12: Mac im Hörsaal direkt erreichen (Wi-Fi peer-to-peer)

Stand: 12. November 2026 · Basis: `main` (`92569bb`).
Den Code schreibt Sonnet. **Jeder PR aus diesem Plan ist sicherheitskritisch: Ein frischer Opus-Subagent reviewt, ein zweiter frischer Opus-Subagent macht das Gegen-Review** (CLAUDE.md, Merge-Regeln). Auch dieser Plan selbst geht vor der Umsetzung durch ein Opus-Sicherheits-Review (§10).

Quellen: `docs/VERTRAEGE.md` §5, §11.1, §12, `docs/ux/STUDIENALLTAG.md` (UX-12), `docs/ux/STUDIENALLTAG-2.md` (UX-12, UX-59), `docs/anleitungen/IPAD.md`, `docs/anleitungen/IPAD-VERBINDUNG.md`, Issue #138 (Kommentar vom 12.11.), Code in `services/core`, `apps/ipad`, `infra/sg`.

**Wichtig zur Beweislage:** In diesem Container gibt es weder Apple-Geräte noch Zugriff auf Apple-Dokumentation. Aussagen zu Network.framework, AWDL und macOS stammen aus dem Gedächtnis. Was unsicher ist, steht als **„nicht geprüft“** da und in §9. Darum beginnt der Plan mit einem Spike (PR 1).

---

## 1. Lage, Ziel, Abgrenzung

### 1.1 Lage (12.11.2026, Owner)

- Das Uni-WLAN trennt Geräte voneinander. Cisco war beim Test aus. iPad und Mac sehen sich dort nicht.
- **Ein iPhone-Hotspot fällt weg.** In den Uni-Gebäuden gibt es kaum Mobilfunk.
- **Owner-Entscheidung:** Hauptweg ist Wi-Fi peer-to-peer (AWDL, die Technik hinter AirDrop). Es muss ohne Netz und ohne Internet gehen, nur Mac und iPad direkt.

### 1.2 Ziel

1. Im Hörsaal verbindet sich das iPad direkt mit dem Mac. Kein Router, kein Internet, kein Hotspot.
2. **Ein Weg für Heim-WLAN und Hörsaal.** Das iPad sucht seinen Mac über Bonjour und verbindet sich mit dem Dienst, nicht mit einer gespeicherten Adresse. Damit entfällt das Problem „andere Adresse nach Netzwechsel“ ganz. Neu koppeln ist nie nötig.
3. Das Geräte-Token geht **nie** an einen Rechner, der sich nicht vorher als der gekoppelte Mac ausgewiesen hat.
4. Kein Dialog während der Vorlesung (Regel R1). Der Nutzer sieht höchstens eine ruhige Zeile.
5. Der Owner kann früh in der Uni prüfen, ob der Weg trägt (PR 1), bevor der Sync umgebaut wird.

### 1.3 Was nicht dazu gehört

| Thema | Wohin |
|---|---|
| iPhone-Hotspot | Entfällt (Owner). Wer zufällig ein gemeinsames WLAN hat, wird vom selben Weg bedient |
| Wiederfinden über gespeicherte IP-Adressen, Endpunkt `identify` | Entfällt. Der Dienst wird über Bonjour gefunden, die Identität prüft der Tunnel (§3) |
| TLS mit Zertifikat für Web-App und REST im Netz | Phase 2 |
| Erstkopplung im Hörsaal | Bleibt im IP-Netz zu Hause (QR-Code). Ohne Kopplung gibt es keinen Schlüssel |
| Sync im Hintergrund, Mac mit geschlossenem Deckel | Unverändert nicht möglich (§9, N4) |
| USB-Kabel, Bluetooth | §8, nur Einordnung |

---

## 2. Ist-Stand mit Belegen

| # | Befund | Beleg |
|---|---|---|
| B1 | Das iPad speichert Host, Port, Geräte-ID und Gerätename in UserDefaults. Mehr nicht. | `apps/ipad/Sources/Core/PairedMacStore.swift`, `DefaultsPairedMacStore.savePairedMac` |
| B2 | Das Token liegt im Schlüsselbund, nur auf diesem Gerät. | `Core/TokenStore.swift`, `KeychainTokenStore.saveToken` |
| B3 | Der Core kennt das Token nicht. Er speichert nur `sha256(token)` als `device.token_hash`. Beide Seiten können diesen Hash bilden. | `services/core/src/services/devices.ts`, `hashDeviceToken`, `verifyDeviceToken` |
| B4 | **Der Mac hat keine eigene Identität.** Keine Instanz-ID, kein Schlüsselpaar, kein TLS. | `services/core/src/main.ts` (nur `app.listen`), `docs/VERTRAEGE.md` §12 „Restrisiko Klartext“ |
| B5 | **Lücke schon heute:** Das iPad schickt das Token alle 15 s an die gespeicherte Adresse, in jedem Netz, im Klartext. Der Sync tut dasselbe bei jedem Verbindungsversuch. In einem fremden Netz kann unter dieser Adresse ein fremder Rechner stehen. | `Home/HomeView.swift` (`.task`, 15 s) → `AppModel.pollConnection` → `CoreClient.checkHealth`. `Sync/SyncEngine.swift`, `connectOnce` |
| B6 | Der Core kündigt sich per Bonjour an (`_studiengehirn._tcp`, TXT `v=1`, `name=<Macname>`), aus Node heraus. Node kann AWDL nicht nutzen. Die Schnittstellen `awdl` und `llw` sind sogar ausdrücklich ausgeschlossen. | `services/core/src/services/discovery.ts`, `startBonjour`, `IGNORED_INTERFACES` |
| B7 | Der Bonjour-Name enthält den Rechnernamen. Über AWDL wäre er für jedes Gerät in Funkreichweite sichtbar. | `discovery.ts`, `macName` |
| B8 | Das iPad sucht per Bonjour nur während der Kopplung, ohne peer-to-peer. | `Pairing/MacBrowser.swift`, `MacBrowser.start` (`using: .tcp`) |
| B9 | `Info.plist` hat `NSLocalNetworkUsageDescription`, `NSBonjourServices = [_studiengehirn._tcp]` und `NSAllowsLocalNetworking`. | `apps/ipad/Config/Info.plist` |
| B10 | **„Lokal“ entscheidet der Core allein über die Socket-Adresse.** Wer über Loopback kommt, braucht kein Token und darf alles, auch die Kopplung öffnen. Eine Verbindung ohne Loopback-Adresse zählt als Netz. | `services/core/src/plugins/security.ts`, `isLoopbackAddress`, `isLocalRequest`. `docs/VERTRAEGE.md` §5 |
| B11 | `CoreClient` und der Sync sprechen über die Protokolle `HTTPTransport` und Socket-Fabrik. Die Adresse kommt immer aus `PairedMac.endpoint`. `CoreEndpoint` lässt IPv4 zu, auch Loopback. | `Core/CoreClient.swift`, `Sync/SyncSocket.swift`, `Core/CoreEndpoint.swift` |
| B12 | Der Sync verbindet mit Wartezeit 1 s bis 30 s neu. Ändert sich `PairedMac`, startet die Schleife neu. Die Warteschlange bleibt. | `Sync/SyncEngine.swift`, `runLoop`, `start`. `Sync/SyncBackoff.swift` |
| B13 | Weiterleitungen folgt die App nie. | `Core/CoreClient.swift`, `NoRedirectDelegate` |
| B14 | `sg start` startet Dienste als eigene Prozessgruppen mit PID-Datei, `sg stop` beendet sie, `sg doctor` prüft die Umgebung. | `infra/sg/src/commands.ts` (`writePid`, `terminateGroup`), `procs.ts`, `doctor.ts` |
| B15 | Die CI hat einen macOS-Job für die iPad-App, mit Pfadfilter. | `.github/workflows/ci.yml`, Job `ipad` |
| B16 | Es gibt keinen `NWPathMonitor`. | Suche in `apps/ipad/Sources` |

**Folgen:**

- Für AWDL braucht der Mac einen kleinen Helfer in Swift (B6).
- Ein Helfer, der an Loopback weiterreicht, wäre für den Core „lokal“ (B10). Jeder in Funkreichweite hätte dann alle Rechte ohne Token. **Das ist die größte Gefahr dieses Plans** (§3, E2).
- Als gemeinsames Geheimnis taugt heute nur der Hash des Tokens (B3).

---

## 3. Lead-Entscheidungen

| # | Entscheidung | Grund |
|---|---|---|
| E1 | **Ein Tunnel für alles.** Am Mac läuft ein Helfer (`sg-tunnel`). Er kündigt einen eigenen Bonjour-Dienst `_sg-tunnel._tcp` an, im WLAN und über peer-to-peer. Das iPad verbindet sich mit dem Dienst. Nach der Umstellung (PR 4) läuft **aller** Verkehr mit Token durch diesen Tunnel, zu Hause wie im Hörsaal. | Ein Weg, eine Prüfung. Keine gespeicherten Adressen mehr, also kein Wiederfinden. Schließt nebenbei B5. |
| E2 | **Der Tunnel zählt beim Core als Netz, nie als lokal.** Der Core bekommt einen eigenen Tunnel-Eingang: einen Unix-Socket im Datenordner (Rechte 0600). Der Helfer reicht nur dorthin weiter, nie an den Haupteingang. Anfragen am Tunnel-Eingang brauchen das Token, `local_only`-Routen bleiben gesperrt. | B10. Ein Unix-Socket hat keine Loopback-Adresse und zählt nach heutiger Regel schon als Netz. Ein Test nagelt das fest. Aus dem Netz ist der Socket nicht erreichbar. |
| E3 | **Identität per TLS mit vorab geteiltem Schlüssel (PSK), beidseitig.** Schlüssel: `PSK = HMAC-SHA256(token_hash, "sg-tunnel-psk-v1")`. Ohne gültigen Handshake fließt kein Byte, also auch kein Token. | Beweist auf beiden Seiten das Wissen um das Geheimnis, ohne das Token zu zeigen. Verschlüsselt die Funkstrecke. Keine Migration, keine neue Kopplung: Die bestehende Kopplung des Owners reicht. Network.framework kann TLS-PSK (`sec_protocol_options_add_pre_shared_key`, Apples Beispiel für eigene Peer-to-Peer-Protokolle nutzt genau das). |
| E4 | **Ein Listener je gekoppeltem Gerät.** Dienstname: `sg-` plus 16 Hex-Zeichen aus `HMAC-SHA256(token_hash, "sg-tunnel-name-v1")`. Das iPad sucht genau seinen Namen. | Kein Rechnername im Funk (B7). Keine offene Frage, ob ein Listener mehrere PSKs kann. Fremde Dienste sind nur Kandidaten, an denen der Handshake scheitert. |
| E5 | **Wegewahl in zwei Stufen:** erst gemeinsames WLAN (2 s), dann peer-to-peer. Der zuletzt erfolgreiche Weg wird zuerst versucht, bis sich das Netz ändert. | Zu Hause bleibt AWDL am iPad aus (Akku, WLAN-Tempo). Kein Flattern (§5.3). |
| E6 | **iPad: lokaler Weiterleiter statt eigener HTTP-Schicht.** Ein `NWListener` nur auf Loopback nimmt die Verbindungen von `URLSession` und WebSocket an. Je Verbindung öffnet er eine `NWConnection` zum Mac. | `CoreClient` und der Sync bleiben fast unverändert (B11). Eine eigene HTTP-Schicht über `NWConnection` müsste Chunking, große Downloads und WebSocket neu bauen. |
| E7 | **Kein Rückfall auf die gespeicherte IP-Adresse** nach PR 4. Die IP dient nur noch der Erstkopplung. | Jeder Rückfall wäre wieder B5. Preis: Läuft der Helfer nicht, gibt es keinen Abgleich. Darum Überwachung durch `sg` und klare Meldungen (§5.2, §5.4). |
| E8 | Der Helfer holt die Schlüssel vom Core über eine neue, **nur lokale** Route und fragt alle 10 s neu. Der Core gibt nur abgeleitete Schlüssel heraus, nie `token_hash`. | Widerruf wirkt im Helfer nach höchstens 10 s. Unabhängig davon prüft der Core das Token bei jeder Anfrage (E2). |
| E9 | Peer-to-peer ist am Mac eingeschaltet, solange der Core läuft. Abschaltbar mit `SG_TUNNEL_P2P=0`. | Der Mac weiß nicht, wann das iPad im Hörsaal ist. Kosten für das WLAN des Macs: §9, N2. Frage F2 an den Owner. |
| E10 | Der bisherige Dienst `_studiengehirn._tcp` und die Kopplung (§12 Schritte 1 bis 7) bleiben unverändert. | Die Erstkopplung braucht keinen Tunnel. Kein Umbau an geprüftem Code. |
| E11 | **Spike zuerst (PR 1).** Er reicht **nicht** allgemein weiter, sondern beantwortet nur feste Befehle. | Früher Test in der Uni. Ein allgemeiner Weiterleiter an den Haupteingang wäre die Lücke aus B10. |

### 3.1 Verglichene Wege für die Identität (Kernfrage 1)

| Weg | Bewertung |
|---|---|
| Kennung im Bonjour-Namen oder TXT | **Kein Nachweis.** Jeder kann sie nachsprechen. Hier nur zum Finden genutzt (E4). |
| TLS-PSK aus `token_hash` (E3) | **Empfohlen.** Beidseitig, verschlüsselt, ohne Migration, auf beiden Seiten von Network.framework getragen. |
| HMAC-Challenge über einen offenen Endpunkt | Beweist die Identität, verschlüsselt aber nichts. Über Funk könnte ein Angreifer danach mitlesen und weiterreichen. Für den Tunnel ungeeignet. |
| Schlüsselpaar des Macs, öffentlicher Schlüssel bei der Kopplung (Zertifikats-Pinning) | Besser gegen ein gestohlenes Backup (R-A) und mit Schutz für alte Mitschnitte (R-B). Braucht Schlüsselablage, Schema-Änderung und Nachrüsten der bestehenden Kopplung. **Ausbaustufe**, falls das Review R-A oder R-B nicht trägt. |

**Bekannte Schwächen, für das Opus-Review:**

- **R-A:** `token_hash` wird zum Schlüsselmaterial. Wer die Datenbank oder ein Backup liest **und** in Funkreichweite ist, kann sich als Mac ausgeben und so das Token bekommen. Heute ist ein gestohlener Hash wertlos.
- **R-B:** Die PSK-Verfahren von TLS 1.2 haben vermutlich keinen Schutz für alte Mitschnitte. Wer den Funk aufzeichnet und später `token_hash` erbeutet, kann nachträglich mitlesen. Ob Network.framework ein PSK-Verfahren mit Diffie-Hellman anbietet: **nicht geprüft**.
- **R-C:** Der Dienstname aus E4 ist stabil. Wer ihn einmal gesehen hat, erkennt den Mac im Funk wieder. Er verrät aber keinen Namen.

---

## 4. Architektur

```
iPad                                                   Mac
URLSession / WebSocket                                 Core (Node)
      │ http://127.0.0.1:<Port>                          ▲ Unix-Socket, zählt als Netz (E2)
      ▼                                                  │
Weiterleiter (NWListener, nur Loopback)                sg-tunnel (Swift)
      │ NWConnection, TLS-PSK                            ▲ NWListener, TLS-PSK
      └───────── gemeinsames WLAN oder AWDL ─────────────┘
                 Dienst: sg-<Kennung>._sg-tunnel._tcp
```

- Im Tunnel läuft unverändertes HTTP und WebSocket, mit `Authorization: Bearer` wie heute.
- Zwei Prüfungen hintereinander: der Handshake (Tunnel) und das Token (Core). Ein widerrufenes Gerät scheitert spätestens am Core.

---

## 5. Schnittstellen

### 5.1 Core

**Tunnel-Eingang**

- Zweiter HTTP-Server auf einem Unix-Socket: `<SG_DATA_DIR>/run/tunnel.sock`, Rechte 0600, Ordner 0700. Er bedient dieselben Routen und denselben WebSocket wie der Haupteingang. Beim Start wird eine alte Socket-Datei entfernt, beim Beenden die eigene.
- Abschaltbar mit `SG_TUNNEL=0`. Dann gibt es weder Socket noch Schlüssel-Route.
- Für den Wächter gilt eine Anfrage vom Tunnel-Eingang **immer** als Netz. Das wird nicht aus der Socket-Adresse geschlossen, sondern ausdrücklich am Eingang markiert. Die heutige Regel (keine Loopback-Adresse → Netz) bleibt als zweite Sicherung.
- `Host` am Tunnel-Eingang: IP-Literal wie bisher (das iPad sendet `127.0.0.1:<Port>` seines Weiterleiters).
- Limits je Absenderadresse (`rateLimitKey`, Log-Zusammenfassung #87): Am Tunnel-Eingang gibt es keine Adresse. Alle Tunnel-Anfragen teilen sich den Schlüssel `tunnel`. Die Kopplung über den Tunnel ist ohnehin gesperrt (nächster Punkt).
- **`pair/start` und `pair/confirm` sind am Tunnel-Eingang gesperrt** (`403 local_only`). Gekoppelt wird nur im IP-Netz.

**Schlüssel-Route**

- `GET /api/v1/devices/tunnel-keys`, **nur lokal** (`sgAccess: 'local'`), am Tunnel-Eingang also nie erreichbar.
- Antwort `TunnelKeyList`: je gekoppeltem, nicht entferntem Gerät `{ device_id, service_name, psk }`.
  - `service_name = "sg-" + hex(HMAC-SHA256(token_hash, "sg-tunnel-name-v1"))[0..16]`
  - `psk = base64url(HMAC-SHA256(token_hash, "sg-tunnel-psk-v1"))`
  - `token_hash` sind die 32 rohen Byte von `sha256(device_token)`.
- Die Antwort steht nie im Log und wird nie zwischengespeichert (`Cache-Control: no-store`, keine Idempotenz-Ablage).

### 5.2 Mac-Helfer `sg-tunnel`

**Paket:** `apps/mac-tunnel/` (Swift-Paket, keine fremden Abhängigkeiten, macOS 13 oder neuer).

| Ziel | Inhalt |
|---|---|
| `TunnelShared` (Bibliothek) | Schlüssel- und Namensableitung, TLS-PSK-Optionen, Rahmenkonstanten. **Dieselben Quelldateien bindet die iPad-App ein** (`apps/ipad/project.yml`, wie heute `Schemas.swift`) |
| `TunnelKit` (Bibliothek) | Listener je Gerät, Weiterleitung zum Unix-Socket, Abgleich der Schlüsselliste, Zustandsdatei. Alles hinter Protokollen, damit Tests ohne Funk laufen |
| `sg-tunnel` (Programm) | Argumente lesen, `TunnelKit` starten, auf SIGTERM sauber beenden |

**Verhalten:**

1. Start mit `--core-url http://127.0.0.1:<Port>` (für die Schlüssel-Route), `--socket <Pfad>`, `--status <Pfad>`, `--p2p on|off`.
2. Alle 10 s die Schlüsselliste holen. Je Gerät ein `NWListener`: TCP, TLS 1.2 mit PSK (Kennung = `device_id`), `includePeerToPeer` nach Einstellung, Bonjour-Dienst `<service_name>` vom Typ `_sg-tunnel._tcp`, ohne TXT.
3. Je angenommener Verbindung nach dem Handshake: eine Verbindung zum Unix-Socket des Core, Bytes in beide Richtungen durchreichen, beide Seiten gemeinsam schließen. Höchstens 32 Verbindungen je Gerät.
4. Gerät fehlt in der Liste: Listener stoppen, seine Verbindungen schließen.
5. Core nicht erreichbar: Listener stoppen, weiter fragen. Der Helfer beendet sich nicht selbst.
6. Zustandsdatei alle 5 s und bei jeder Änderung, atomar geschrieben: `{ pid, version, updated_at, core: "ok"|"nicht erreichbar", p2p: true|false, listeners: [{ service_name, state, connections }], last_error }`. Keine Schlüssel, keine Adressen.
7. Der Helfer schreibt nie Schlüssel, Token oder Nutzdaten ins Log.

**Entstehen und Laufen auf dem Mac des Owners (Xcode, kein bezahltes Konto):**

| Frage | Antwort |
|---|---|
| Bauen | `swift build -c release --package-path apps/mac-tunnel`. Das geht mit Xcode oder den Command Line Tools, ohne Apple-Konto. `sg start` baut, wenn das Programm fehlt oder die Quellen neuer sind (Prüfsumme über `Sources/` und `Package.swift`). Der erste Bau dauert etwa eine Minute. |
| Signierung | Kein Entwicklerkonto nötig. Auf Apple Silicon signiert der Linker lokal gebaute Programme von selbst (ad hoc). Der Helfer braucht keine geschützten Entitlements. **Nicht geprüft:** ob peer-to-peer in einem ad hoc signierten Kommandozeilen-Programm ohne Weiteres läuft. Das klärt der Spike. |
| Start und Stopp | `sg start` startet den Helfer nach dem Core als eigenen Dienst mit PID-Datei (B14) und startet ihn nach einem Absturz neu (höchstens 5-mal in 10 min, dann Meldung). `sg stop` beendet ihn vor dem Core. Fehlt Swift oder scheitert der Bau, startet der Rest trotzdem. `sg` meldet es deutlich. |
| Lokales Netzwerk (macOS 15) | Nach Apples Technote zur lokalen Netzwerk-Privatsphäre sind Programme ausgenommen, die aus dem Terminal gestartet werden, samt Kindprozessen. Der Helfer ist ein Kind von `pnpm sg start`. Startet man `sg` aus einem anderen Programm (Editor mit eigenem Terminal), fragt macOS für dieses Programm. **Nicht geprüft.** |
| Firewall | Ist die macOS-Firewall an, fragt sie bei einem lauschenden, nicht von Apple beglaubigten Programm nach eingehenden Verbindungen. Nach jedem Neubau kann die Frage wiederkommen. Beim Owner ist die Firewall laut `IPAD-VERBINDUNG.md` aus. **Nicht geprüft.** |
| Uni-VPN (Cisco) | Der Socket-Filter blockiert laut `IPAD-VERBINDUNG.md` eingehende Verbindungen. Das träfe auch den Helfer. Ob er AWDL trifft: **nicht geprüft.** |
| `sg doctor` | Neue Prüfungen: Swift vorhanden? Programm gebaut und aktuell? Prozess lebt (PID)? Zustandsdatei jünger als 15 s? `core: ok`? Mindestens ein Listener `ready`? Peer-to-peer an? Dazu je Befund ein Satz, was zu tun ist. |

**CI:** neuer Job `mac-tunnel` auf `macos-latest`, mit Pfadfilter wie der Job `ipad` (`apps/mac-tunnel/`, CI-Datei). Schritte: `swift build`, `swift test`. Ändert sich `TunnelShared`, läuft auch der Job `ipad` (Pfadfilter erweitern).

### 5.3 iPad

**Neue Bausteine**

| Baustein | Datei (neu) | Aufgabe |
|---|---|---|
| `TunnelShared` | eingebunden aus `apps/mac-tunnel/Sources/TunnelShared` | Ableitung von Name und PSK aus dem Token, TLS-Optionen |
| `TunnelDialing` | `Tunnel/TunnelDialer.swift` | Protokoll und echte Fassung: öffnet eine `NWConnection` zum Dienst, mit oder ohne peer-to-peer. Meldet nach dem Handshake, über welchen Weg die Verbindung läuft |
| `LocalForwarder` | `Tunnel/LocalForwarder.swift` | `NWListener` nur auf Loopback, zufälliger Port. Reicht jede Verbindung über `TunnelDialing` durch |
| `NetworkPathWatching` | `Tunnel/NetworkPath.swift` | Protokoll über `NWPathMonitor`: „WLAN an?“ und „Netz hat sich geändert“ |
| `MacRoute` | `Tunnel/MacRoute.swift` | Zustandsautomat der Wegewahl. Einzige Quelle für die Adresse, an die Anfragen mit Token gehen |

```swift
enum RouteKind: Equatable, Sendable { case sharedWifi, direct }

enum RouteState: Equatable, Sendable {
    case idle                      // nicht gekoppelt oder App im Hintergrund
    case connecting                // sucht den Mac
    case up(RouteKind)             // mindestens ein Handshake gelungen
    case down(RouteProblem)        // sucht leise weiter
}

enum RouteProblem: Equatable, Sendable {
    case wifiOff             // WLAN am iPad aus: auch peer-to-peer geht dann nicht
    case macNotFound         // Dienst nirgends zu sehen
    case handshakeFailed     // Dienst da, Schlüssel passt nicht
    case localNetworkDenied
}

@MainActor protocol MacRouting: AnyObject {
    var state: RouteState { get }
    /// Adresse des lokalen Weiterleiters. `nil`, solange er nicht läuft. Nur hierhin gehen Anfragen mit Token.
    func endpoint() -> CoreEndpoint?
    func appBecameActive()
    func appWentToBackground()
}
```

**Wer nutzt was:** `SyncEngine.connectOnce`, `SyncEngine.restAccess`, `AppModel.checkConnection` und `AppModel.unpair` nehmen die Adresse nur noch aus `MacRouting.endpoint()`. `PairedMac.endpoint` bleibt gespeichert, wird aber nur noch von der Kopplung geschrieben und nicht mehr für Anfragen mit Token gelesen. `PairingController` spricht weiter direkt mit der IP aus dem QR-Code (ohne Token).

**Wegewahl ohne Flattern (Kernfrage 2)**

1. Je neuer Verbindung des Weiterleiters:
   - Stufe 1: `NWConnection` zum Dienst **ohne** peer-to-peer. Zeitgrenze 2 s.
   - Stufe 2: dieselbe Verbindung **mit** `includePeerToPeer`. Zeitgrenze 10 s.
2. **Merken:** Der zuletzt erfolgreiche Weg wird zuerst versucht. Im Hörsaal entfällt so die Wartezeit von 2 s bei jeder neuen Verbindung.
3. **Zurück aufs WLAN** nur bei einem Ereignis: `NWPathMonitor` meldet einen Netzwechsel, oder die App kommt in den Vordergrund. Dann gilt wieder Stufe 1 zuerst. Kein Zeitgeber, kein Umschalten im Betrieb.
4. Eine bestehende Verbindung wandert nie. Der lange WebSocket bleibt auf seinem Weg, bis er von selbst endet. Danach greift der normale Neuaufbau des Sync (B12).
5. Die Anzeige richtet sich nach dem Weg der Sync-Verbindung. Sie ändert sich nur bei deren Neuaufbau.
6. Schlägt beides fehl, meldet der Weiterleiter der wartenden `URLSession` einen Verbindungsabbruch. Der Sync wartet wie heute (1 s bis 30 s). Mehr Suchlogik gibt es nicht: Jeder Verbindungsversuch ist die Suche.

**Wann läuft was?**

| Lage | Verhalten |
|---|---|
| App im Vordergrund, gekoppelt | Weiterleiter läuft. Verbindungen entstehen bei Bedarf (Sync, REST) |
| App im Hintergrund | Weiterleiter und Verbindungen enden. Beim Zurückkehren neuer Port, `MacRoute` meldet die neue Adresse, der Sync startet neu |
| WLAN am iPad aus | Keine Versuche. Text „WLAN ist aus“ |
| Token ungültig (`401`) | Keine Versuche, wie heute |

**Akku:** Zu Hause bleibt peer-to-peer am iPad aus (Stufe 1 gelingt). Im Hörsaal ist AWDL aktiv, solange die Verbindung steht, also die ganze Vorlesung. Ohne Mac in Reichweite versucht der Sync höchstens alle 30 s. Messung: §9, N3.

**Berechtigungen (iOS):** `NSBonjourServices` bekommt zusätzlich `_sg-tunnel._tcp`. Sonst nichts Neues (B9). Die Frage „Lokales Netzwerk erlauben?“ kommt schon bei der Kopplung zu Hause. Ist die Erlaubnis entzogen, zeigt die App den vorhandenen Text „Lokales Netzwerk nicht erlaubt“.

**Loopback auf dem iPad:** Andere Apps auf dem iPad können den Port des Weiterleiters erreichen und bekommen so eine Verbindung zum Tunnel-Eingang. Dort brauchen sie das Token (E2), und die Kopplung ist gesperrt (§5.1). Der Port wechselt bei jedem Start. Bewertung im Review (§10).

### 5.4 Anzeige (R1)

Kein Dialog, kein Ton, kein Banner. Das Abzeichen „Mac ●“ bleibt die einzige Stelle. Die Verbindungsdetails bekommen eine Zeile.

| Zustand | Überschrift | Zeile bzw. Hinweis |
|---|---|---|
| `connecting` (erste 15 s) | „Suche deinen Mac …“ | – |
| `up(.sharedWifi)` | „Mit dem Mac verbunden“ | „Verbunden über das WLAN“ |
| `up(.direct)` | „Mit dem Mac verbunden“ | „Direkt verbunden, ohne WLAN-Netz“ |
| `down(.macNotFound)` | „Mac nicht gefunden“ | „Läuft Studien-Gehirn am Mac, und ist er aufgeklappt? Am Mac muss WLAN eingeschaltet sein. Deine Notizen bleiben auf dem iPad und gleichen sich später ab.“ |
| `down(.wifiOff)` | „WLAN ist aus“ | „Schalte WLAN am iPad ein. Ein Netz brauchst du nicht, das iPad verbindet sich direkt mit dem Mac.“ |
| `down(.handshakeFailed)` | „Mac nicht gefunden“ | „Ein Mac hat geantwortet, aber er kennt dieses iPad nicht. Wurde es am Mac entfernt? Dann kopple es zu Hause neu.“ |

Die Texte behaupten nur, was die App weiß. `IPAD-VERBINDUNG.md` bekommt den Abschnitt „Im Hörsaal“ (§7, PR 4).

---

## 6. Vertragsvorschlag

Die Texte kommen mit **PR 2** nach `main`.

**V1 · §5, neuer Punkt nach „Lokal oder Netz entscheidet allein die Socket-Adresse“:**

```markdown
- **Tunnel-Eingang (UX-12):** Neben dem Haupteingang lauscht der Core auf einem Unix-Socket im Datenordner (`run/tunnel.sock`, Rechte 0600). Anfragen von dort gelten **immer als Netz**, nie als lokal: Token Pflicht, lokale Routen `403 local_only`. Der Eingang ist ausdrücklich markiert, die Einstufung hängt nicht an der Socket-Adresse. `POST /devices/pair/start` und `POST /devices/pair/confirm` sind dort gesperrt (`403 local_only`). `SG_TUNNEL=0` schaltet den Eingang ab.
```

**V2 · §7.5 (Geräte), neue Zeile:**

```markdown
| `GET /devices/tunnel-keys` | – | 200 `TunnelKeyList` | **lokal.** Abgeleitete Schlüssel für den Mac-Helfer. `Cache-Control: no-store`, nie im Log |
```

**V3 · §12, neuer Schritt 8 nach Schritt 7:**

```markdown
8. **Direkte Verbindung über den Tunnel (UX-12).** Nach der Kopplung spricht das iPad nur noch über einen beglaubigten Tunnel mit dem Mac, im gemeinsamen WLAN und direkt über Wi-Fi peer-to-peer.
   - **Grundsatz:** Das Geräte-Token geht nur durch eine Verbindung, deren Gegenseite sich als der gekoppelte Mac ausgewiesen hat. An eine gespeicherte IP-Adresse geht es nicht mehr.
   - **Helfer:** Am Mac läuft `sg-tunnel`. Je gekoppeltem Gerät kündigt er einen Bonjour-Dienst vom Typ `_sg-tunnel._tcp` an. Name: `sg-` plus die ersten 16 Hex-Zeichen von `HMAC-SHA256(token_hash, "sg-tunnel-name-v1")`. Der Name enthält keinen Rechnernamen und ist kein Nachweis.
   - **Nachweis:** TLS 1.2 mit vorab geteiltem Schlüssel, beidseitig. `PSK = HMAC-SHA256(token_hash, "sg-tunnel-psk-v1")`, PSK-Kennung ist die `device_id`. `token_hash` sind die 32 rohen Byte von `sha256(device_token)`. Ohne gültigen Handshake wird nichts weitergereicht.
   - **Weiterleitung:** Der Helfer reicht nur an den Tunnel-Eingang des Core weiter (§5). Dort gilt die Token-Prüfung unverändert.
   - **Widerruf:** Der Helfer holt die Schlüssel alle 10 s über `GET /devices/tunnel-keys` (lokal). Für ein entferntes Gerät stoppt er den Dienst und schließt die Verbindungen. Unabhängig davon ist das Token mit dem Commit von `DELETE /devices/{id}` ungültig.
   - **Wegewahl am iPad:** erst das gemeinsame WLAN, dann peer-to-peer. Eine bestehende Verbindung wechselt den Weg nicht.
   - **Kopplung:** Schritte 1 bis 7 bleiben unverändert und laufen im IP-Netz. Über den Tunnel wird nicht gekoppelt.
   - **Folge für `token_hash`:** Der Hash ist jetzt Schlüsselmaterial. Wer ihn kennt und in Funkreichweite ist, kann sich als Mac ausgeben. Backups enthalten ihn.
   - **Restrisiken:** kein Schutz alter Mitschnitte, falls `token_hash` später bekannt wird. Der Dienstname ist stabil und macht den Mac im Funk wiedererkennbar.
```

**V4 · `packages/schemas/src/system.schema.json`:** `TunnelKey`, `TunnelKeyList` mit Beispielen. Die Swift-Typen braucht das iPad nicht (es leitet selbst ab), der Helfer liest die Liste mit eigenem `Decodable`.

**V5 · §1 (Umgebungsvariablen):** `SG_TUNNEL`, `SG_TUNNEL_P2P`.

---

## 7. PR-Zuschnitt

Reihenfolge fest. **Nach PR 1 entscheidet der Gerätetest des Owners, ob PR 2 bis 4 gebaut werden.** PR 2 und PR 3 ändern am iPad nichts. Erst PR 4 stellt um.

### PR 1 · Spike: `GET /health` über peer-to-peer

- **Branch:** `feat/ux12-spike-p2p`
- **Zweck:** Der Owner prüft in der Uni, ob der Weg trägt. Kein Umbau am Sync.
- **Scope:** `spikes/s6-p2p/**` (neu), `apps/ipad/Sources/Tunnel/SpikeView.swift` (neu), ein Eintrag in den Verbindungsdetails (`Home/HomeView.swift`), `apps/ipad/Config/Info.plist` (`_sg-spike._tcp`), `docs/anleitungen/SPIKE-P2P.md` (neu).
- **Mac:** Swift-Paket `sg-spike`. Start von Hand im Terminal. Es zeigt einen Code mit 8 Ziffern, kündigt `_sg-spike._tcp` mit peer-to-peer an und nimmt TLS-PSK-Verbindungen an (Schlüssel aus dem Code).
- **Sicherheit des Spikes:** Der Helfer reicht **nichts** allgemein weiter. Er kennt vier Befehle: `health` (er selbst ruft `GET /api/v1/health` am Core auf und gibt Status und Dauer zurück), `echo`, `blob <MB>` (Zufallsdaten für die Durchsatzmessung), `ping`. Der Code hat wenig Entropie. Das ist nur für den Spike vertretbar, weil dahinter keine Rechte liegen.
- **iPad:** Testansicht „Direktverbindung testen“. Code eingeben, dann:
  1. Dienst gefunden? Über welchen Weg (WLAN oder direkt)?
  2. Handshake gelungen? Dauer bis zur ersten Antwort.
  3. `health`: Antwort des Core.
  4. Durchsatz mit 20 MB in beide Richtungen.
  5. Dauertest: alle 5 s ein `ping`, bis zum Abbruch von Hand. Die Ansicht zählt Abbrüche und Wiederaufbauten und notiert den Akkustand am Anfang und am Ende.
  6. „Protokoll teilen“ gibt eine Textdatei ohne Namen und Adressen aus.
- **Tests (CI):** Befehlsparser und Rahmen des Spike-Protokolls. Loopback-Test auf dem macOS-Runner: richtiger Code → Antwort, falscher Code → kein Handshake.
- **Gerätetest:** §9.1. Das Ergebnis kommt als Kommentar ins Issue und entscheidet über PR 2 bis 4.
- **Risiken:** Der Spike klärt die offenen Punkte N1 bis N7 oder zeigt, dass der Weg nicht trägt. Dann greift §8.
- **Aufräumen:** PR 4 entfernt die Testansicht und den Plist-Eintrag. `spikes/s6-p2p` bleibt als Beleg.

### PR 2 · Core: Tunnel-Eingang, Schlüssel-Route, Vertrag

- **Branch:** `feat/ux12-core-tunnel` · Bedingung: Spike bestanden.
- **Scope:** `docs/VERTRAEGE.md` (V1 bis V5), `packages/schemas/**` (V4), `services/core/src/main.ts`, `src/app.ts`, `src/config.ts`, `src/plugins/security.ts`, `src/routes/devices.ts`, `src/services/tunnel.ts` (neu), Tests unter `services/core/test/**`.
- **Tests (Unit):** feste Testvektoren für `service_name` und `psk` (dieselben nutzen PR 3 und PR 4 in Swift). Entfernte Geräte fehlen in der Liste.
- **Tests (Integration), der Kern dieses PRs:**
  - Am Tunnel-Eingang ohne Token: `401 device_token_required`. Mit ungültigem Token: `401`. Mit gültigem: 200.
  - **Jede** `local`-Route am Tunnel-Eingang mit gültigem Token: `403 local_only`. Der Test läuft über die Routentabelle, nicht über eine Liste von Hand.
  - `pair/start` und `pair/confirm` am Tunnel-Eingang: 403.
  - `GET /devices/tunnel-keys`: lokal 200, aus dem Netz 401 bzw. 403, am Tunnel-Eingang 403.
  - WebSocket `/sync` am Tunnel-Eingang: Upgrade nur mit Token.
  - Rechte der Socket-Datei 0600. Alte Datei wird ersetzt. `SG_TUNNEL=0`: kein Socket, Route 404.
  - Echte Logausgabe enthält keinen `psk`.
  - Der Haupteingang verhält sich unverändert (bestehende Tests bleiben grün).
- **Risiken:** zweiter Server neben Fastify (Routing und WebSocket-Upgrade teilen). Limits ohne Absenderadresse.

### PR 3 · Mac-Helfer `sg-tunnel`, `sg`, CI

- **Branch:** `feat/ux12-mac-tunnel` · abhängig von PR 2.
- **Scope:** `apps/mac-tunnel/**` (neu), `infra/sg/src/commands.ts`, `procs.ts`, `doctor.ts`, `config.ts`, Tests in `infra/sg/test/**`, `.github/workflows/ci.yml` (Job `mac-tunnel`), `docs/anleitungen/` (Abschnitt zum Helfer).
- **Tests (Swift, macOS-Runner, ohne Funk):**
  - Testvektoren aus PR 2.
  - Loopback: Client mit richtigem PSK kommt durch bis zu einem Fake-Core am Unix-Socket. Falscher PSK, falsche Kennung, kein TLS: keine Verbindung zum Fake-Core (der Fake zählt Verbindungen).
  - Abgleich der Schlüsselliste mit Fake-Uhr: neues Gerät → Listener. Entferntes Gerät → Listener weg, Verbindungen zu. Core weg → alle Listener weg, kein Absturz.
  - Grenze von 32 Verbindungen. Zustandsdatei: Form, atomar, ohne Geheimnis.
- **Tests (`sg`, Node):** Bau nur bei geänderter Prüfsumme. Start nach dem Core, Stopp davor. Neustart nach Absturz mit Grenze. Fehlt Swift: Start läuft weiter, Meldung. `doctor` je Befund.
- **Risiken:** Bauzeit beim ersten Start. Verhalten von `NWListener` beim Wechsel der Schnittstellen. Firewall-Frage nach jedem Neubau.

### PR 4 · iPad: Weiterleiter, Wegewahl, Umstellung

- **Branch:** `feat/ux12-ipad-tunnel` · abhängig von PR 2 und PR 3.
- **Scope:** `apps/ipad/Sources/Tunnel/**`, `Sources/App/AppModel.swift`, `Sources/App/StudienGehirnApp.swift`, `Sources/Sync/SyncEngine.swift` (nur die Stellen aus §5.3), `Sources/Home/HomeView.swift`, `Sources/Core/ConnectionError.swift`, `Config/Info.plist`, `project.yml`, Tests, `docs/anleitungen/IPAD.md`, `IPAD-VERBINDUNG.md`, `docs/ux/STUDIENALLTAG-2.md` (UX-12 erledigt).
- **Tests (alle mit Fakes: `TunnelDialing`, `NetworkPathWatching`, `HTTPTransport`, Uhr):**
  - Testvektoren aus PR 2.
  - **Kein Token ohne Tunnel:** Der Fake-Transport zeichnet alle Anfragen auf. Jede Anfrage mit `Authorization`-Header geht an die Adresse des Weiterleiters. Keine geht an `PairedMac.endpoint`. Geprüft für `checkHealth`, Sync-Upgrade, REST und `unpair`.
  - Wegewahl: WLAN gelingt → kein Versuch mit peer-to-peer. WLAN scheitert → peer-to-peer nach 2 s. Merken des Wegs. Rücksetzen nur bei Netzwechsel und Vordergrund. Zehn Verbindungen hintereinander im Hörsaal-Fall: genau ein WLAN-Versuch.
  - Kein Flattern: Wechselt der Fake-Netzpfad zehnmal, ohne dass die Sync-Verbindung endet, ändert sich die Anzeige nicht.
  - Handshake scheitert: Zustand `handshakeFailed`, kein Byte der wartenden Verbindung geht raus.
  - Hintergrund und zurück: neuer Port, Sync startet neu, Warteschlange unverändert.
  - Texte je Zustand als reine Funktionen. Kein Zustand öffnet einen Dialog.
  - Die Kopplung läuft weiter direkt und ohne Token.
- **Inhalt Anleitungen:** Abschnitt „Im Hörsaal“: WLAN an beiden Geräten an, Mac aufgeklappt, Studien-Gehirn läuft, App öffnen, warten bis „Mac ●“ grün ist. Kein Netz nötig. Der Satz zum Hotspot in `IPAD.md` entfällt.
- **Risiken:** Eingriff in `SyncEngine` (bestehende Tests bekommen einen `MacRouting`-Fake). Swift 6 mit Network.framework (Übergabe wie in `MacBrowser`). Läuft der Helfer nicht, gibt es keinen Abgleich (E7).

---

## 8. Andere Wege, nur Einordnung

| Weg | Einordnung |
|---|---|
| **(c) USB-Kabel, späterer Rückfall** | Machbar über den Systemdienst `usbmuxd` am Mac (Prinzip PeerTalk, iproxy). Die Richtung ist fest Mac → iPad: Das iPad lauscht, der Helfer verbindet und muss die Richtung für HTTP drehen. Das ist mehr Protokoll als bei peer-to-peer. Es geht ohne bezahltes Konto, das iPad vertraut dem Mac schon durch Xcode. Das iPad lädt dabei. Zuverlässigkeit im Hörsaal am höchsten. Baut auf PR 2 bis 4 auf (gleicher Tunnel-Eingang, gleicher Weiterleiter, anderer Transport). **Nur bauen, wenn der Spike zeigt, dass peer-to-peer im Hörsaal nicht trägt.** Vorher billig zu prüfen: die Internetfreigabe des Macs über „iPad-USB“. Sie schafft ein kleines IP-Netz zwischen beiden. Darin fände Stufe 1 der Wegewahl den Dienst ohne neuen Code. Alles **nicht geprüft**. |
| **(d) Bluetooth, Multipeer Connectivity** | Multipeer Connectivity nutzt zwischen Mac und iPad praktisch denselben Funkweg wie dieser Plan, aber mit eigenem Sitzungsprotokoll statt TCP. HTTP und WebSocket ließen sich nicht einfach durchreichen. Apple empfiehlt für neuen Code Network.framework. Reines Bluetooth (L2CAP) ist langsam: Striche gingen, ein Folien-PDF mit 20 MB bräuchte Minuten (**nicht gemessen**). **Nicht bauen.** Der Plan deckt es ab. |
| **iPhone-Hotspot** | Entfällt (kein Mobilfunk). Gäbe es doch ein gemeinsames Netz, bedient es Stufe 1 der Wegewahl von selbst. |

---

## 9. Nicht geprüft

| # | Offene Frage | Wie klären |
|---|---|---|
| N1 | **Läuft AWDL zuverlässig, während der Mac im isolierten Uni-WLAN hängt?** Erwartung: ja, AWDL geht am Zugangspunkt vorbei, das Funkmodul wechselt zwischen den Kanälen. Im vollen Hörsaal mit vielen Apple-Geräten kann es eng werden. | Gerätetest §9.1, Schritte 1 und 4 |
| N2 | Wie stark leidet das normale WLAN des Macs, wenn peer-to-peer dauernd an ist (E9)? | Spike: zu Hause mit laufendem Helfer einen Videoanruf oder Download beobachten |
| N3 | **Akku über 90 Minuten** direkte Verbindung, iPad und Mac | Gerätetest §9.1, Schritt 5 |
| N4 | **Mac-Deckel zu.** Erwartung: Der Mac schläft, Core und Helfer stehen, keine Verbindung. Das iPad schreibt weiter und gleicht später ab. Ob der Mac mit Netzteil und geschlossenem Deckel wach bleibt und AWDL dann läuft: unbekannt. | Gerätetest §9.1, Schritt 6 |
| N5 | TLS-PSK in Network.framework: genaue Verfahren, Verhalten bei falschem Schlüssel, Schutz alter Mitschnitte (R-B) | Spike, danach Opus-Review |
| N6 | Peer-to-peer in einem ad hoc signierten Kommandozeilen-Programm. Lokales Netzwerk und Firewall am Mac. Muss Bluetooth an sein? Stört der Cisco-Filter? | Spike am Mac des Owners |
| N7 | Bevorzugt Network.framework von selbst das WLAN vor AWDL? Der Plan verlässt sich nicht darauf (zwei Stufen). Dauer des Verbindungsaufbaus über AWDL. | Spike misst beide Stufen |
| N8 | `NWPathMonitor`: Wie oft meldet er Änderungen im Alltag? | Gerätetest mit PR 4, Log |
| N9 | Erlaubnis „Lokales Netzwerk“ am iPad nach dem wöchentlichen Aufspielen | Gerätetest |
| N10 | Enthalten Backups `device.token_hash`, und wie sind sie geschützt (R-A)? | Opus-Review liest §13 und den Backup-Code |
| N11 | Zweiter HTTP-Server neben Fastify am Unix-Socket, mit geteiltem WebSocket-Upgrade | PR 2, früh als Test |

### 9.1 Gerätetest für den Owner

**Teil 1 · AirDrop-Probe (heute, 5 Minuten, ohne neuen Code)**

1. Im Hörsaal, am besten **während einer Vorlesung**. Beide Geräte im Uni-WLAN, Bluetooth an.
2. Eine Datei mit etwa 50 MB vom iPad per AirDrop an den Mac schicken und zurück.
3. Notieren: Wird der Mac sofort angeboten? Wie lange dauert die Übertragung? Bricht sie ab?

**Was das aussagt:** AirDrop nutzt denselben Funkweg (AWDL). Geht es zügig, spricht das klar für den Plan. Geht es nicht, ist der Plan dort sehr fraglich, und der Spike lohnt erst nach Klärung. **Es ist ein Indiz, kein Beweis:** AirDrop zeigt weder 90 Minuten Dauerverbindung noch die Berechtigungen unserer Programme. AirDrop findet Geräte außerdem über Bluetooth, unser Weg über Bonjour.

**Teil 2 · Spike (nach PR 1, etwa zwei Vorlesungen)**

| Schritt | Wo | Was | Bestanden, wenn |
|---|---|---|---|
| 1 | Zu Hause | `sg-spike` starten, Code am iPad eingeben | Verbindung über „WLAN“, `health` antwortet |
| 2 | Zu Hause | WLAN am Router trennen oder beide Geräte aus dem WLAN abmelden (WLAN bleibt an) | Verbindung über „direkt“, `health` antwortet |
| 3 | Zu Hause | Durchsatz 20 MB über „direkt“ | Mehr als 1 MB pro Sekunde |
| 4 | Hörsaal, Vorlesung | Beide im Uni-WLAN. Verbinden, `health`, Durchsatz | Verbindung über „direkt“ in unter 15 s |
| 5 | Hörsaal, 90 min | Dauertest laufen lassen, iPad normal nutzen | Höchstens 3 Abbrüche, jeder unter 30 s. Akku des iPads höchstens 10 Prozentpunkte mehr als an einem Tag ohne Test |
| 6 | Beliebig | Deckel des Macs zu, nach 2 min auf | Nach dem Öffnen steht die Verbindung in unter 30 s wieder |
| 7 | Mac | Fragt macOS nach lokalem Netzwerk oder Firewall? Stört Cisco? | Aufschreiben, auch wenn nichts fragt |

Das geteilte Protokoll aus der Testansicht reicht als Rückmeldung.

---

## 10. Sicherheits-Review (Pflicht)

- **Vor der Umsetzung:** Ein frischer Opus-Subagent prüft diesen Plan. Schwerpunkte:
  1. **E2:** Gibt es einen Weg, auf dem eine Tunnel-Anfrage als lokal gilt? Auch über WebSocket-Upgrade, Fehlerpfade des Wächters und künftige Routen.
  2. **E3, R-A, R-B:** `token_hash` als Schlüsselmaterial, fehlender Schutz alter Mitschnitte. Reicht das, oder gleich ein Schlüsselpaar des Macs?
  3. **E4, R-C:** stabiler Dienstname im Funk.
  4. **E7:** Bleibt wirklich kein Weg, auf dem das Token an eine IP-Adresse geht? Kopplung, `unpair`, Fehlerpfade.
  5. **Schlüssel-Route:** Wer kann sie erreichen? DNS-Rebinding und Browser auf dem Mac (lokale Routen sind über die Host- und Origin-Prüfung geschützt, das gilt es für `GET` nachzuweisen).
  6. **Loopback am iPad** (§5.3) und der Spike (E11).
- **Je PR:** Review durch Opus, dazu ein Gegen-Review durch einen zweiten frischen Opus-Subagent.
- Prüfsätze für die Reviews:
  - „Zeige einen Ablauf, in dem ein Rechner ohne Wissen um das Token ein Byte mit `Authorization`-Header bekommt.“
  - „Zeige einen Ablauf, in dem eine Anfrage aus dem Funk eine `local`-Route erreicht.“

### 10.1 Bedrohungen und Antworten

| Angriff | Antwort |
|---|---|
| Gefälschter Dienst mit dem richtigen Namen im Hörsaal | Handshake scheitert ohne PSK. Kein Byte, kein Token |
| Weiterreichen an den echten Mac (Relay) | Der Angreifer sieht nur verschlüsselte Bytes. Er kann stören, nicht mitlesen |
| Fremdes Gerät verbindet sich mit dem Helfer | Handshake scheitert ohne PSK. Der Core wird nicht erreicht |
| Gekoppeltes, dann entferntes Gerät | Helfer stoppt den Dienst nach höchstens 10 s. Der Core lehnt das Token sofort ab |
| Tunnel-Anfrage als „lokal“ | Eigener, markierter Eingang (E2), Tests über die ganze Routentabelle |
| Fremder Rechner unter der gespeicherten IP (B5) | Entfällt: Dorthin geht kein Token mehr (E7) |
| Viele gefälschte Dienste oder Störsender | Nur Verzögerung. Ehrlicher Text, kein Leck |
| Gestohlenes Backup plus Funkreichweite | R-A |
| Mitschnitt heute, `token_hash` später | R-B |
| Andere App auf dem iPad nutzt den Loopback-Port | Braucht das Token. Kopplung am Tunnel gesperrt |

---

## 11. Fragen an den Owner

Nur Produktfragen. Technisches entscheidet der Lead nach dem Review.

| # | Frage | Empfehlung |
|---|---|---|
| F1 | Machst du die AirDrop-Probe im Hörsaal während einer Vorlesung (§9.1, Teil 1)? | Ja, vor PR 1. Sie kostet 5 Minuten und zeigt, ob der Spike lohnt |
| F2 | Darf die Direktverbindung am Mac immer eingeschaltet sein, auch zu Hause? Das kann das WLAN des Macs etwas langsamer und unruhiger machen. | Ja, zunächst immer an. Stört es zu Hause, kommt ein Schalter „Direktverbindung“ in die Einstellungen |
| F3 | Nach der Umstellung gleicht das iPad nur noch ab, wenn am Mac der Helfer läuft. Ein Rückfall auf die alte Verbindung wäre unsicher. In Ordnung? | Ja. `sg start` startet und überwacht den Helfer, `sg doctor` zeigt Fehler |
| F4 | Soll die App anzeigen, ob sie über das WLAN oder direkt verbunden ist? | Ja, als eine Zeile in den Verbindungsdetails. Sonst nirgends |
| F5 | Wäre ein Kabel zwischen iPad und Mac als Rückfall für dich in Ordnung, falls der Funkweg im Hörsaal nicht trägt? | Erst entscheiden, wenn der Spike durchfällt |

---

## 12. Abnahme

- [ ] Spike: Gerätetest §9.1 bestanden und im Issue dokumentiert.
- [ ] Im Hörsaal, beide Geräte ohne gemeinsames Netz: „Mac ●“ wird ohne Zutun grün. Striche erscheinen am Mac.
- [ ] Zu Hause im WLAN: ebenso, Anzeige „Verbunden über das WLAN“.
- [ ] Wechsel zwischen beiden Orten ohne neue Kopplung.
- [ ] Keine Anfrage mit Token geht an eine IP-Adresse des Netzes (Test und Review-Prüfsatz).
- [ ] Keine Anfrage vom Tunnel erreicht eine lokale Route (Test über die Routentabelle).
- [ ] Während einer Session erscheint kein Dialog (R1).
- [ ] `sg doctor` meldet den Zustand des Helfers. Die CI baut und testet ihn.
- [ ] `IPAD-VERBINDUNG.md` hat den Abschnitt „Im Hörsaal“. UX-12 ist in `STUDIENALLTAG-2.md` als erledigt geführt.
