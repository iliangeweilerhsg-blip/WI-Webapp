# Plan UX-12: Mac im Hörsaal direkt erreichen (Wi-Fi peer-to-peer)

Stand: 12. November 2026 · Basis: `main` (`92569bb`).
Den Code schreibt Sonnet. **Jeder PR aus diesem Plan ist sicherheitskritisch: Ein frischer Opus-Subagent reviewt, ein zweiter frischer Opus-Subagent macht das Gegen-Review** (CLAUDE.md, Merge-Regeln). Auch dieser Plan selbst geht vor der Umsetzung durch ein Opus-Sicherheits-Review (§10).

**Sicherheits-Review des Plans (Opus, 12.11.2026): eingearbeitet.** Ergebnis und Befunde stehen in §10.2. Grundsätzliche Änderungen sind im Text mit **„Änderung durch Sicherheits-Review“** markiert. Die wichtigsten:

- Der Tunnel-Schlüssel kommt **nicht mehr aus `token_hash`**, sondern aus einem eigenen Zufallsschlüssel je Gerät, der nie in Postgres und nie im Backup steht (E3, §5.1).
- Der Helfer liest die Schlüssel aus einer Datei mit Rechten 0600. Die HTTP-Route `tunnel-keys` entfällt (E8).
- Vorher kommt ein kleiner **PR 0**, der das heutige Token-Leck B5 sofort eindämmt (§7).

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
2. **Ein Weg für Heim-WLAN und Hörsaal.** Das iPad sucht seinen Mac über Bonjour und verbindet sich mit dem Dienst, nicht mit einer gespeicherten Adresse. Damit entfällt das Problem „andere Adresse nach Netzwechsel“ ganz. Neu koppeln ist danach nie nötig (einmal nach PR 4 schon, F6).
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
| B17 | **Zwei Routen prüfen „lokal“ selbst**, an `sgAccess` und am Wächter vorbei: `PATCH /settings` (Feld `backup_target`) und `POST /calendar/reassign`. Dazu zählt die Ablehnungsstatistik Loopback selbst. Für einen Unix-Socket ist das heute sicher (`remoteAddress` ist dort `undefined`), es hängt aber nicht an der Markierung aus E2. | `routes/settings.ts` (`isLoopbackAddress(request.socket.remoteAddress)`), `routes/calendar.ts` (dito), `plugins/rejection-log.ts` |
| B18 | **Backups sind unverschlüsselt und enthalten `device.token_hash`.** `sg backup` sichert die ganze Datenbank mit `pg_dump -Fc` in ein frei wählbares Ziel (USB-Platte, Cloud-Ordner). Aufbewahrt werden Stände bis zu 6 Monate. Verschlüsselung (`age`) ist nicht umgesetzt. `media/` und `vault/` werden mitgesichert, andere Ordner im Datenordner nicht. | `infra/sg/src/backup.ts` (`settings.encryption` → Abbruch), `docs/VERTRAEGE.md` §13, `services/core/src/db/schema/system.ts` (`token_hash`) |
| B19 | Network.framework kann TLS-PSK laut Apple (Forum, DTS, August 2021) **nur mit TLS 1.2**, nicht mit TLS 1.3. Apples Peer-to-Peer-Beispiel nutzt `TLS_PSK_WITH_AES_128_GCM_SHA256`, also ein Verfahren **ohne** Schutz alter Mitschnitte. Ob die Verfahren mit ECDHE (`TLS_ECDHE_PSK_*`) gehen, sagt Apple nicht. | developer.apple.com/forums/thread/688508 und /thread/745186 |
| B20 | Das iPad legt das Token mit `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` ab. Es landet damit nicht in iPad-Backups und nicht im iCloud-Schlüsselbund. | `Core/TokenStore.swift` |

**Folgen:**

- Für AWDL braucht der Mac einen kleinen Helfer in Swift (B6).
- Ein Helfer, der an Loopback weiterreicht, wäre für den Core „lokal“ (B10). Jeder in Funkreichweite hätte dann alle Rechte ohne Token. **Das ist die größte Gefahr dieses Plans** (§3, E2).
- ~~Als gemeinsames Geheimnis taugt heute nur der Hash des Tokens (B3).~~ **Änderung durch Sicherheits-Review:** `token_hash` taugt nicht als Schlüssel. Er steht in jedem Backup (B18), und jedes Token, das über B5 geleakt ist, würde ihn verraten. Darum bekommt jedes Gerät einen eigenen Tunnel-Schlüssel (E3).

---

## 3. Lead-Entscheidungen

| # | Entscheidung | Grund |
|---|---|---|
| E1 | **Ein Tunnel für alles.** Am Mac läuft ein Helfer (`sg-tunnel`). Er kündigt einen eigenen Bonjour-Dienst `_sg-tunnel._tcp` an, im WLAN und über peer-to-peer. Das iPad verbindet sich mit dem Dienst. Nach der Umstellung (PR 4) läuft **aller** Verkehr mit Token durch diesen Tunnel, zu Hause wie im Hörsaal. | Ein Weg, eine Prüfung. Keine gespeicherten Adressen mehr, also kein Wiederfinden. Schließt nebenbei B5. |
| E2 | **Der Tunnel zählt beim Core als Netz, nie als lokal.** Der Core bekommt einen eigenen Tunnel-Eingang: einen Unix-Socket im Datenordner (Rechte 0600). Der Helfer reicht nur dorthin weiter, nie an den Haupteingang. Anfragen am Tunnel-Eingang brauchen das Token, `local_only`-Routen bleiben gesperrt. | B10. Ein Unix-Socket hat keine Loopback-Adresse und zählt nach heutiger Regel schon als Netz. Ein Test nagelt das fest. Aus dem Netz ist der Socket nicht erreichbar. |
| E3 | **Identität per TLS mit vorab geteiltem Schlüssel (PSK), beidseitig.** **Änderung durch Sicherheits-Review:** Schlüsselmaterial ist ein eigener **Tunnel-Schlüssel je Gerät** (`tunnel_key`, 32 Byte aus `crypto.randomBytes`), nicht `token_hash`. Der Core erzeugt ihn bei `pair/confirm` und gibt ihn einmal zusammen mit dem Token aus. Am Mac liegt er nur in der Schlüsseldatei (§5.1), **nie in Postgres und nie im Backup**. Am iPad liegt er im Schlüsselbund wie das Token (`…ThisDeviceOnly`, B20). `PSK = HMAC-SHA256(tunnel_key, "sg-tunnel-psk-v1")`. Ohne gültigen Handshake fließt kein Byte, also auch kein Token. | Beweist auf beiden Seiten das Wissen um das Geheimnis, ohne das Token zu zeigen. Verschlüsselt die Funkstrecke. Network.framework kann TLS-PSK (`sec_protocol_options_add_pre_shared_key`, Apples Beispiel für eigene Peer-to-Peer-Protokolle nutzt genau das). **Warum nicht `token_hash`:** Er steht unverschlüsselt in allen Backups der letzten 6 Monate (B18). Jedes über B5 geleakte Token ergäbe den Schlüssel. Ein eigener Schlüssel trennt beides. **Preis:** Das iPad muss nach PR 4 **einmal zu Hause neu gekoppelt** werden. Das ist ohnehin ratsam, weil das heutige Token über B5 geleakt sein kann (F6). |
| E4 | **Ein Listener je gekoppeltem Gerät.** Dienstname: `sg-` plus 16 Hex-Zeichen aus `HMAC-SHA256(tunnel_key, "sg-tunnel-name-v1")` (geändert durch das Sicherheits-Review, vorher `token_hash`). Das iPad sucht seinen Namen, auch mit einem Bonjour-Zusatz bei Namenskonflikt (`sg-… (2)`, §5.3). | Kein Rechnername im Funk (B7). Keine offene Frage, ob ein Listener mehrere PSKs kann. Fremde Dienste sind nur Kandidaten, an denen der Handshake scheitert. |
| E5 | **Wegewahl in zwei Stufen:** erst gemeinsames WLAN (2 s), dann peer-to-peer. Der zuletzt erfolgreiche Weg wird zuerst versucht, bis sich das Netz ändert. | Zu Hause bleibt AWDL am iPad aus (Akku, WLAN-Tempo). Kein Flattern (§5.3). |
| E6 | **iPad: lokaler Weiterleiter statt eigener HTTP-Schicht.** Ein `NWListener` nur auf Loopback nimmt die Verbindungen von `URLSession` und WebSocket an. Je Verbindung öffnet er eine `NWConnection` zum Mac. | `CoreClient` und der Sync bleiben fast unverändert (B11). Eine eigene HTTP-Schicht über `NWConnection` müsste Chunking, große Downloads und WebSocket neu bauen. |
| E7 | **Kein Rückfall auf die gespeicherte IP-Adresse** nach PR 4. Die IP dient nur noch der Erstkopplung. | Jeder Rückfall wäre wieder B5. Preis: Läuft der Helfer nicht, gibt es keinen Abgleich. Darum Überwachung durch `sg` und klare Meldungen (§5.2, §5.4). |
| E8 | **Änderung durch Sicherheits-Review:** Der Helfer liest die Schlüssel aus der **Schlüsseldatei** des Core (`<SG_DATA_DIR>/secrets/tunnel-keys.json`, Datei 0600, Ordner 0700) und prüft alle 2 s, ob sie sich geändert hat. Es gibt **keine** HTTP-Route für Schlüssel. | Eine Route auf Loopback erreicht jeder Prozess am Mac, auch andere Benutzerkonten und Apps in der Sandbox. Die Datei liest nur derselbe Benutzer. Keine Frage nach Browsern, DNS-Rebinding oder `Origin`. Widerruf wirkt im Helfer nach höchstens 2 s. Unabhängig davon prüft der Core das Token bei jeder Anfrage (E2). |
| E9 | Peer-to-peer ist am Mac eingeschaltet, solange der Core läuft. Abschaltbar mit `SG_TUNNEL_P2P=0`. | Der Mac weiß nicht, wann das iPad im Hörsaal ist. Kosten für das WLAN des Macs: §9, N2. Frage F2 an den Owner. |
| E10 | Der bisherige Dienst `_studiengehirn._tcp` und die Kopplung (§12 Schritte 1 bis 7) bleiben unverändert. | Die Erstkopplung braucht keinen Tunnel. Kein Umbau an geprüftem Code. |
| E11 | **Spike zuerst (PR 1).** Er reicht **nicht** allgemein weiter, sondern beantwortet nur feste Befehle. | Früher Test in der Uni. Ein allgemeiner Weiterleiter an den Haupteingang wäre die Lücke aus B10. |
| E12 | **Neu durch Sicherheits-Review: TLS-Verfahren fest vorgeben.** TLS 1.2 (min = max). Bevorzugt Verfahren **mit ECDHE** (Schutz alter Mitschnitte): `TLS_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256` (0xCCAC), dann `TLS_ECDHE_PSK_WITH_AES_128_CBC_SHA` (0xC035). Nur wenn der Spike zeigt, dass keins davon geht: `TLS_PSK_WITH_AES_128_GCM_SHA256` (Apples Beispiel, ohne ECDHE), dann mit Restrisiko R-B. Beide Seiten hängen nur die gewählten Verfahren an. Nach dem Handshake prüfen beide das ausgehandelte Verfahren (`sec_protocol_metadata_get_negotiated_tls_ciphersuite`) und brechen bei einem anderen ab. | TLS 1.3 mit PSK kann Network.framework laut Apple nicht (B19). Bei TLS 1.2 bringt nur ECDHE_PSK Schutz alter Mitschnitte. |
| E13 | **Neu durch Sicherheits-Review: PSK-Kennung ist fest** (`"sg1"`), nicht die `device_id`. | Bei TLS 1.2 geht die Kennung im Klartext über den Funk. Eine `device_id` wäre eine feste Kennung des iPads, mit der man es über Hörsäle hinweg verfolgen könnte. Zur Auswahl braucht der Helfer sie nicht (ein Listener je Gerät). |
| E14 | **Neu durch Sicherheits-Review: PR 0 zuerst.** Ein kleiner iPad-PR verhindert sofort, dass das Token an die gespeicherte Adresse geht, wenn das iPad gar nicht im selben Netz ist (§7, PR 0). | B5 besteht heute, jeden Tag in der Uni. PR 2 bis 4 hängen am Spike und brauchen Wochen. |

### 3.1 Verglichene Wege für die Identität (Kernfrage 1)

| Weg | Bewertung |
|---|---|
| Kennung im Bonjour-Namen oder TXT | **Kein Nachweis.** Jeder kann sie nachsprechen. Hier nur zum Finden genutzt (E4). |
| TLS-PSK aus `token_hash` (ursprünglich E3) | **Verworfen durch Sicherheits-Review.** `token_hash` steht in jedem Backup (B18) und folgt aus jedem geleakten Token (B5). |
| TLS-PSK aus eigenem `tunnel_key` je Gerät (E3 neu) | **Gewählt.** Beidseitig, verschlüsselt, auf beiden Seiten von Network.framework getragen. Der Schlüssel liegt nicht im Backup. Preis: einmal neu koppeln. |
| HMAC-Challenge über einen offenen Endpunkt | Beweist die Identität, verschlüsselt aber nichts. Über Funk könnte ein Angreifer danach mitlesen und weiterreichen. Für den Tunnel ungeeignet. |
| Schlüsselpaar des Macs, öffentlicher Schlüssel bei der Kopplung (Zertifikats-Pinning) | **Entscheidung des Reviews: nicht bauen.** Gegen das Backup hilft es nur, wenn der private Schlüssel nicht im Backup liegt. Das leistet die Schlüsseldatei für `tunnel_key` genauso. Network.framework braucht für Zertifikate eine `SecIdentity` aus dem Schlüsselbund. Bei einem ad hoc signierten Programm, dessen Signatur sich mit jedem Neubau ändert, fragt macOS dann nach jedem Neubau nach dem Zugriff (nicht geprüft, aber typisch). Ein selbst erzeugtes Zertifikat ohne fremde Abhilfen ist in Swift viel Handarbeit. Den Vorteil „Schutz alter Mitschnitte“ bringt ECDHE_PSK (E12) billiger. Ein Schlüsselpaar wird erst wieder Thema, wenn der Spike zeigt, dass ECDHE_PSK nicht geht **und** der Owner R-B nicht trägt. |

**Restrisiken nach dem Review:**

- **R-A (gemildert):** Ein Backup enthält `token_hash`, aber keinen Tunnel-Schlüssel. Wer ein Backup stiehlt, kann sich nicht als Mac ausgeben. Übrig bleibt: Wer den laufenden Mac als derselbe Benutzer liest (Schadprogramm, entsperrter Mac), hat den Schlüssel. Er hat dann aber ohnehin alle Daten. Time Machine sichert den Datenordner mit, falls der Owner es nutzt. Das ist ein Datenträger in seiner Hand, und Time Machine kann verschlüsseln.
- **R-B (abhängig vom Spike):** Mit ECDHE_PSK (E12) sind alte Mitschnitte geschützt. Mit `TLS_PSK_WITH_AES_128_GCM_SHA256` nicht: Wer den Funk aufzeichnet und später `tunnel_key` erbeutet, liest nachträglich mit. Weil `tunnel_key` nur am Mac und im iPad-Schlüsselbund liegt, wiegt das deutlich weniger als mit `token_hash`.
- **R-C (bleibt, niedrig):** Der Dienstname ist stabil, solange die Kopplung besteht. Wichtiger: Schon der **Diensttyp** `_sg-tunnel._tcp` gibt es nur bei Studien-Gehirn. Jeder mit einem Apple-Gerät und einem Bonjour-Browser in Funkreichweite sieht also „hier ist ein Mac mit Studien-Gehirn“ und erkennt ihn in jedem Hörsaal wieder. Das iPad fragt im Funk nach demselben Namen. Ein wechselnder Name hilft dagegen nicht, solange der Typ eindeutig ist. Darum kein Wechsel. Der Name verrät weder Rechnernamen noch Token. Abschalten lässt sich die Ankündigung im Funk mit `SG_TUNNEL_P2P=0` (F2).

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
- Je Tunnel-Verbindung genau eine Verbindung zum Unix-Socket. Der Helfer reicht nur Bytes durch, er liest und ändert kein HTTP. Kein Bündeln mehrerer Verbindungen, kein Hinzufügen von Headern (`X-Forwarded-*` o. Ä.).
- Nebenwirkung: Nach PR 4 läuft der Sync auch zu Hause verschlüsselt. Im Klartext bleibt nur die Kopplung selbst (`pair/confirm`, §12 „Restrisiko Klartext“).

---

## 5. Schnittstellen

### 5.1 Core

**Tunnel-Eingang**

- Zweiter HTTP-Server auf einem Unix-Socket: `<SG_DATA_DIR>/run/tunnel.sock`, Rechte 0600, Ordner 0700. Er bedient dieselben Routen und denselben WebSocket wie der Haupteingang. Beim Start wird eine alte Socket-Datei entfernt, beim Beenden die eigene.
- Abschaltbar mit `SG_TUNNEL=0`. Dann gibt es weder Socket noch Schlüsseldatei.
- Für den Wächter gilt eine Anfrage vom Tunnel-Eingang **immer** als Netz. Das wird nicht aus der Socket-Adresse geschlossen, sondern ausdrücklich am Eingang markiert. Die heutige Regel (keine Loopback-Adresse → Netz) bleibt als zweite Sicherung.
- **Wie markiert wird (Sicherheits-Review):** Der Tunnel-Server legt jeden angenommenen Socket im Ereignis `connection` in ein `WeakSet` (`tunnelSockets`). `isLocalRequest` gibt für jeden Socket aus diesem Set `false` zurück, **bevor** die Adresse geprüft wird. Das trifft Fastify-Anfragen, rohe Upgrades (`IncomingMessage.socket` ist derselbe Socket), Keep-Alive-Folgeanfragen und den Fehlerpfad `frameworkErrors`, weil alle über `isLocalRequest` gehen.
- **Eine Stelle für „lokal“ (Sicherheits-Review, B17):** `routes/settings.ts`, `routes/calendar.ts` und `plugins/rejection-log.ts` nutzen künftig `isLocalRequest(request)` statt `isLoopbackAddress(request.socket.remoteAddress)`. Ein Architekturtest prüft, dass `isLoopbackAddress(` außerhalb von `plugins/security.ts` nicht mehr vorkommt. So bleiben auch künftige Routen an der Markierung.
- **Nie ein Loopback-Port:** Der Tunnel-Eingang ist nur ein Unix-Socket. Ein zweiter TCP-Port auf `127.0.0.1` ist verboten, weil dann jede Prüfung über die Adresse „lokal“ ergäbe.
- **WebSocket am Tunnel-Eingang:** Der Tunnel-Server reicht `upgrade` an denselben Weg wie der Haupteingang weiter (`@fastify/websocket`), mit dem Unix-Socket als Socket. Der Wächter sieht ihn als Netz. Ohne Weiterreichen schließt Node den Socket, das ist sicher, aber ein Fehler.
- `Host` am Tunnel-Eingang: IP-Literal wie bisher (das iPad sendet `127.0.0.1:<Port>` seines Weiterleiters). `Host`, `X-Forwarded-For` und `Origin` entscheiden auch am Tunnel nie über „lokal“ (`trustProxy` bleibt aus).
- **Grenzen (Sicherheits-Review):** Den `NetworkConnectionGate` **nicht** an den Tunnel-Server hängen: Ohne Adresse landen dort alle Verbindungen in einem Topf (`unbekannt`), und `authenticate` würde diese Pseudo-Adresse freigeben. Stattdessen eigene Werte am Tunnel-Server: `maxConnections = 32 × gekoppelte Geräte`, höchstens 128, dazu dieselben `connectionTimeout`, `keepAliveTimeout`, `requestTimeout` und `maxRequestsPerSocket` wie am Haupteingang. `NetworkConnectionGate.authenticate` überspringt Tunnel-Sockets.
- Limits je Absenderadresse (`rateLimitKey`, Log-Zusammenfassung #87): Am Tunnel-Eingang gibt es keine Adresse. Alle Tunnel-Anfragen teilen sich den Schlüssel `tunnel`. Die Kopplung über den Tunnel ist ohnehin gesperrt (nächster Punkt).
- **`pair/start` und `pair/confirm` sind am Tunnel-Eingang gesperrt** (`403 local_only`). Gekoppelt wird nur im IP-Netz.
- **Sync-Ereignisse `localOnly`** (§11.6) gehen nie an Tunnel-Verbindungen. Das folgt aus `sgDevice = { deviceId }`, ein Test hält es fest.
- **Was ein Prozess am Mac mit dem Unix-Socket kann:** Nur Prozesse desselben Benutzers (und root) öffnen ihn (0600, Ordner 0700). Sie bekommen dort **weniger** als heute über Loopback: Token Pflicht, lokale Routen gesperrt. Neue Rechte entstehen also nicht.

**Schlüsseldatei statt Schlüssel-Route (Änderung durch Sicherheits-Review)**

- `<SG_DATA_DIR>/secrets/tunnel-keys.json`, Datei 0600, Ordner `secrets/` 0700. Inhalt: `{ v: 1, devices: [{ device_id, tunnel_key }] }`, `tunnel_key` als base64url (32 Byte). Nur gekoppelte, nicht entfernte Geräte.
- **Nie in Postgres, nie im Backup:** `sg backup` sichert nur die Datenbank, `media/` und `vault/` (B18). Ein Test in `infra/sg` hält fest, dass `secrets/` nicht im Backup landet.
- **Schreiben:** nur der Core, über eine Warteschlange (ein Schreiber), atomar (Schreiben in eine Temp-Datei mit 0600, `fsync`, `rename`). Vor dem Schreiben prüft der Core, dass `secrets/` ein echter Ordner und kein Symlink ist.
  - `pair/confirm`: `tunnel_key` erzeugen, **erst** in die Datei schreiben, **dann** das Gerät in Postgres anlegen, dann antworten. Scheitert das Schreiben, scheitert die Kopplung (Fenster wieder offen wie heute bei Fehlern, §12 Schritt 7). Scheitert das Anlegen danach, bleibt ein verwaister Eintrag ohne Gerät. Den räumt der Abgleich beim Start ab.
  - `DELETE /devices/{id}`: nach dem Commit (Token sofort ungültig) den Eintrag entfernen. Scheitert das, Fehler ins Log, der Abgleich beim nächsten Start holt es nach. Der Core lehnt das Token so oder so ab.
  - **Abgleich beim Start:** Einträge ohne aktives Gerät fliegen raus. Aktive Geräte ohne Eintrag (z. B. nach einer Wiederherstellung aus dem Backup oder vor PR 2 gekoppelt) bekommen **keinen** neuen Schlüssel. Sie brauchen eine neue Kopplung (`sg doctor` und die Web-App sagen es).
  - Bei `SG_TUNNEL=0` schreibt der Core die Datei nicht und löscht sie beim Start.
- **Lesen:** nur der Helfer (§5.2). Der Core gibt die Schlüssel über keine Route heraus.
- `PairResponse` bekommt das Feld `tunnel_key` (base64url, 43 Zeichen). Es gelten dieselben Regeln wie für `device_token`: `Cache-Control: no-store`, keine Idempotenz-Ablage, nie im Log, in keiner Fehlermeldung.
- Ableitungen (gemeinsamer Code in `TunnelShared` und `services/tunnel.ts`, feste Testvektoren):
  - `service_name = "sg-" + hex(HMAC-SHA256(tunnel_key, "sg-tunnel-name-v1"))[0..16]`
  - `psk = HMAC-SHA256(tunnel_key, "sg-tunnel-psk-v1")` (32 rohe Byte)
  - PSK-Kennung: fest `"sg1"` (E13)

### 5.2 Mac-Helfer `sg-tunnel`

**Paket:** `apps/mac-tunnel/` (Swift-Paket, keine fremden Abhängigkeiten, macOS 13 oder neuer).

| Ziel | Inhalt |
|---|---|
| `TunnelShared` (Bibliothek) | Schlüssel- und Namensableitung, TLS-PSK-Optionen, Rahmenkonstanten. **Dieselben Quelldateien bindet die iPad-App ein** (`apps/ipad/project.yml`, wie heute `Schemas.swift`) |
| `TunnelKit` (Bibliothek) | Listener je Gerät, Weiterleitung zum Unix-Socket, Abgleich der Schlüsselliste, Zustandsdatei. Alles hinter Protokollen, damit Tests ohne Funk laufen |
| `sg-tunnel` (Programm) | Argumente lesen, `TunnelKit` starten, auf SIGTERM sauber beenden |

**Verhalten:**

1. Start mit `--keys <Pfad zur Schlüsseldatei>`, `--socket <Pfad>`, `--status <Pfad>`, `--p2p on|off`. (Änderung durch Sicherheits-Review: kein `--core-url`, der Helfer spricht nie mit dem Haupteingang.) Der Helfer läuft nie als root und bricht ab, wenn Schlüsseldatei oder Socket nicht dem eigenen Benutzer gehören oder die Datei andere Rechte als 0600 hat.
2. Alle 2 s prüfen, ob sich die Schlüsseldatei geändert hat (Größe, Änderungszeit, Inode), dann neu lesen. Je Gerät ein `NWListener`: TCP, TLS 1.2 mit PSK nach E12 und E13, `includePeerToPeer` nach Einstellung, Bonjour-Dienst `<service_name>` vom Typ `_sg-tunnel._tcp`, ohne TXT. Nach dem Handshake das ausgehandelte Verfahren prüfen, bei Abweichung schließen.
3. Je angenommener Verbindung **erst nach** dem Handshake: eine Verbindung zum Unix-Socket des Core, Bytes in beide Richtungen durchreichen, beide Seiten gemeinsam schließen.
4. Gerät fehlt in der Datei: Listener stoppen, seine Verbindungen schließen. Datei fehlt oder ist unlesbar: alle Listener stoppen (sicherer Ausfall).
5. Core nicht erreichbar (Unix-Socket nimmt keine Verbindung an, Probe alle 10 s): Listener stoppen, weiter prüfen. Der Helfer beendet sich nicht selbst.
6. **Grenzen gegen Fluten aus dem Funk (Sicherheits-Review):**
   - Handshake: höchstens 5 s, sonst schließen. Je Listener höchstens 8 Verbindungen gleichzeitig im Handshake. Kommt eine neunte, schließt der Helfer die **älteste** davon (Verdrängen statt Abweisen, wie #185). So kommt das iPad auch während einer Flut durch.
   - Nach dem Handshake höchstens 32 Verbindungen je Gerät.
   - Puffer: je Richtung höchstens 64 KiB. Der nächste Block wird erst gelesen, wenn der vorige geschrieben ist (Gegendruck). Damit bleibt der Speicher je Gerät unter etwa 5 MiB.
   - Gescheiterte Handshakes zählt der Helfer. Im Log steht höchstens eine Zeile je Minute (Anzahl), in der Zustandsdatei der Zähler. Kein Sperren nach Adresse: Adressen im Funk wechseln ständig.
   - Ein Störsender im Funk lässt sich so nicht abwehren. Das ist Verzögerung, kein Leck.
7. Namenskonflikt bei Bonjour: Meldet der Listener einen anderen Namen als `<service_name>` (das System hängt z. B. „ (2)“ an, weil jemand den Namen schon belegt), schreibt der Helfer das in die Zustandsdatei. `sg doctor` zeigt es an. **Nicht geprüft**, wie `NWListener` das meldet (N12).
8. Zustandsdatei alle 5 s und bei jeder Änderung, atomar geschrieben: `{ pid, version, updated_at, core: "ok"|"nicht erreichbar", p2p: true|false, listeners: [{ service_name, advertised_name, state, connections, handshakes_pending, handshakes_failed }], last_error }`. Keine Schlüssel, keine Adressen.
9. Der Helfer schreibt nie Schlüssel, Token oder Nutzdaten ins Log.

**Entstehen und Laufen auf dem Mac des Owners (Xcode, kein bezahltes Konto):**

| Frage | Antwort |
|---|---|
| Bauen | `swift build -c release --package-path apps/mac-tunnel`. Das geht mit Xcode oder den Command Line Tools, ohne Apple-Konto. `sg start` baut, wenn das Programm fehlt oder die Quellen neuer sind (Prüfsumme über `Sources/` und `Package.swift`). Der erste Bau dauert etwa eine Minute. |
| Signierung | Kein Entwicklerkonto nötig. Auf Apple Silicon signiert der Linker lokal gebaute Programme von selbst (ad hoc). Der Helfer braucht keine geschützten Entitlements. **Nicht geprüft:** ob peer-to-peer in einem ad hoc signierten Kommandozeilen-Programm ohne Weiteres läuft. Das klärt der Spike. |
| Start und Stopp | `sg start` startet den Helfer nach dem Core als eigenen Dienst mit PID-Datei (B14) und startet ihn nach einem Absturz neu (höchstens 5-mal in 10 min, dann Meldung). `sg stop` beendet ihn vor dem Core. Fehlt Swift oder scheitert der Bau, startet der Rest trotzdem. `sg` meldet es deutlich. |
| Lokales Netzwerk (macOS 15) | Nach Apples Technote zur lokalen Netzwerk-Privatsphäre sind Programme ausgenommen, die aus dem Terminal gestartet werden, samt Kindprozessen. Der Helfer ist ein Kind von `pnpm sg start`. Startet man `sg` aus einem anderen Programm (Editor mit eigenem Terminal), fragt macOS für dieses Programm. **Nicht geprüft.** |
| Firewall | Ist die macOS-Firewall an, fragt sie bei einem lauschenden, nicht von Apple beglaubigten Programm nach eingehenden Verbindungen. Nach jedem Neubau kann die Frage wiederkommen (die ad hoc-Signatur ändert sich). Wer „Ablehnen“ klickt, sperrt den Helfer still. Darum prüft `sg doctor` das (siehe unten). Beim Owner ist die Firewall laut `IPAD-VERBINDUNG.md` aus. **Nicht geprüft.** Die Frage erscheint am Mac beim Start, nie am iPad, R1 ist nicht berührt. |
| Uni-VPN (Cisco) | Der Socket-Filter blockiert laut `IPAD-VERBINDUNG.md` eingehende Verbindungen. Das träfe auch den Helfer. Ob er AWDL trifft: **nicht geprüft.** |
| `sg doctor` | Neue Prüfungen: Swift vorhanden? Programm gebaut und aktuell? Prozess lebt (PID)? Zustandsdatei jünger als 15 s? `core: ok`? Mindestens ein Listener `ready`? Peer-to-peer an? Dazu (Sicherheits-Review): Schlüsseldatei vorhanden, 0600, Ordner 0700? Gekoppelte Geräte ohne Tunnel-Schlüssel („neu koppeln“)? Namenskonflikt (`advertised_name` ≠ `service_name`)? Firewall an und Helfer blockiert (`socketfilterfw --getglobalstate`, `--getappblocked <Pfad>`)? Viele gescheiterte Handshakes? Dazu je Befund ein Satz, was zu tun ist. |

**CI:** neuer Job `mac-tunnel` auf `macos-latest`, mit Pfadfilter wie der Job `ipad` (`apps/mac-tunnel/`, CI-Datei). Schritte: `swift build`, `swift test`. Ändert sich `TunnelShared`, läuft auch der Job `ipad` (Pfadfilter erweitern).

### 5.3 iPad

**Neue Bausteine**

| Baustein | Datei (neu) | Aufgabe |
|---|---|---|
| `TunnelShared` | eingebunden aus `apps/mac-tunnel/Sources/TunnelShared` | Ableitung von Name und PSK aus `tunnel_key`, TLS-Optionen (E12, E13) |
| `TunnelKeyStore` | `Core/TokenStore.swift` (erweitert) | `tunnel_key` im Schlüsselbund, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` wie das Token (B20). Wird bei jeder Kopplung zusammen mit dem Token überschrieben und beim Entkoppeln mit ihm gelöscht |
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
    case repairNeeded        // gekoppelt, aber ohne tunnel_key (vor PR 2 gekoppelt): einmal neu koppeln
}

@MainActor protocol MacRouting: AnyObject {
    var state: RouteState { get }
    /// Adresse des lokalen Weiterleiters. `nil`, solange er nicht läuft. Nur hierhin gehen Anfragen mit Token.
    func endpoint() -> CoreEndpoint?
    func appBecameActive()
    func appWentToBackground()
}
```

**Wer nutzt was:** `SyncEngine.connectOnce`, `SyncEngine.restAccess` (und damit alle REST-Aufrufe samt `CoreClient.downloadSlideDeckFile`), `SyncEngine.healthSaysTokenInvalid`, `AppModel.checkConnection` und `AppModel.unpair` nehmen die Adresse nur noch aus `MacRouting.endpoint()`. `PairedMac.endpoint` bleibt gespeichert, wird aber nur noch von der Kopplung geschrieben und nicht mehr für Anfragen mit Token gelesen. `PairingController` spricht weiter direkt mit der IP aus dem QR-Code (ohne Token).

**Wegewahl ohne Flattern (Kernfrage 2)**

1. Je neuer Verbindung des Weiterleiters (Kandidaten: jeder gefundene Dienst namens `<service_name>` oder `<service_name> (<Zahl>)`, höchstens 4; der erste gelungene Handshake gewinnt. So hilft es einem Angreifer nicht, den Namen zu besetzen, Sicherheits-Review):
   - Stufe 1: `NWConnection` zum Dienst **ohne** peer-to-peer. Zeitgrenze 2 s.
   - Stufe 2: dieselbe Verbindung **mit** `includePeerToPeer`. Zeitgrenze 10 s.
2. **Merken:** Der zuletzt erfolgreiche Weg wird zuerst versucht. Im Hörsaal entfällt so die Wartezeit von 2 s bei jeder neuen Verbindung.
3. **Zurück aufs WLAN** nur bei einem Ereignis: `NWPathMonitor` meldet einen Netzwechsel, oder die App kommt in den Vordergrund. Dann gilt wieder Stufe 1 zuerst. Kein Zeitgeber, kein Umschalten im Betrieb.
4. Eine bestehende Verbindung wandert nie. Der lange WebSocket bleibt auf seinem Weg, bis er von selbst endet. Danach greift der normale Neuaufbau des Sync (B12).
5. Die Anzeige richtet sich nach dem Weg der Sync-Verbindung. Sie ändert sich nur bei deren Neuaufbau.
6. **Kein Byte vor dem Handshake (Sicherheits-Review):** Der Weiterleiter liest von der lokalen Verbindung erst, wenn die `NWConnection` zum Mac `ready` ist und das Verfahren geprüft ist (E12). Scheitert der Handshake, schließt er die lokale Verbindung, ohne gelesen zu haben.
7. Schlägt beides fehl, meldet der Weiterleiter der wartenden `URLSession` einen Verbindungsabbruch. Der Sync wartet wie heute (1 s bis 30 s). Mehr Suchlogik gibt es nicht: Jeder Verbindungsversuch ist die Suche.

**Wann läuft was?**

| Lage | Verhalten |
|---|---|
| App im Vordergrund, gekoppelt | Weiterleiter läuft. Verbindungen entstehen bei Bedarf (Sync, REST) |
| App im Hintergrund | Weiterleiter und Verbindungen enden. Beim Zurückkehren neuer Port, `MacRoute` meldet die neue Adresse, der Sync startet neu |
| WLAN am iPad aus | Keine Versuche. Text „WLAN ist aus“ |
| Token ungültig (`401`) | Keine Versuche, wie heute |

**Akku:** Zu Hause bleibt peer-to-peer am iPad aus (Stufe 1 gelingt). Im Hörsaal ist AWDL aktiv, solange die Verbindung steht, also die ganze Vorlesung. Ohne Mac in Reichweite versucht der Sync höchstens alle 30 s. Messung: §9, N3.

**Berechtigungen (iOS):** `NSBonjourServices` bekommt zusätzlich `_sg-tunnel._tcp`. Sonst nichts Neues (B9). Die Frage „Lokales Netzwerk erlauben?“ kommt schon bei der Kopplung zu Hause. Ist die Erlaubnis entzogen, zeigt die App den vorhandenen Text „Lokales Netzwerk nicht erlaubt“.

**Loopback auf dem iPad:** Andere Apps auf dem iPad (Split View) und Webseiten in Safari können den Port des Weiterleiters erreichen und bekommen so eine Verbindung zum Tunnel-Eingang. Dort brauchen sie das Token (E2), und die Kopplung ist gesperrt (§5.1). Eine Webseite, die einen eigenen Namen auf `127.0.0.1` umbiegt, scheitert an der Host-Prüfung (`421`). Übrig bleibt, dass Fremde das iPad zum Verbindungsaufbau bringen können (Akku). Der Port wechselt bei jedem Start. **Bewertung Review: niedrig, hinnehmbar.**

**Entkoppeln am iPad:** `unpair` schickt `DELETE /devices/{self}` durch den Tunnel. Ist der Mac nicht erreichbar, löscht das iPad Token und `tunnel_key` trotzdem. Der Mac kündigt den Dienst dann weiter an, bis das Gerät dort entfernt wird. Ohne Schlüssel kommt niemand durch.

### 5.4 Anzeige (R1)

Kein Dialog, kein Ton, kein Banner. Das Abzeichen „Mac ●“ bleibt die einzige Stelle. Die Verbindungsdetails bekommen eine Zeile.

| Zustand | Überschrift | Zeile bzw. Hinweis |
|---|---|---|
| `connecting` (erste 15 s) | „Suche deinen Mac …“ | – |
| `up(.sharedWifi)` | „Mit dem Mac verbunden“ | „Verbunden über das WLAN“ |
| `up(.direct)` | „Mit dem Mac verbunden“ | „Direkt verbunden, ohne WLAN-Netz“ |
| `down(.macNotFound)` | „Mac nicht gefunden“ | „Läuft Studien-Gehirn am Mac, und ist er aufgeklappt? Am Mac muss WLAN eingeschaltet sein. Deine Notizen bleiben auf dem iPad und gleichen sich später ab.“ |
| `down(.wifiOff)` | „WLAN ist aus“ | „Schalte WLAN am iPad ein. Ein Netz brauchst du nicht, das iPad verbindet sich direkt mit dem Mac.“ |
| `down(.handshakeFailed)` | „Mac nicht gefunden“ | „Ein Gerät hat unter dem Namen deines Macs geantwortet, aber nicht mit dem richtigen Schlüssel. Zu Hause prüfen, ob das iPad am Mac noch gekoppelt ist.“ (Sicherheits-Review: Jeder im Funk kann den Namen nachsprechen. Der Text fordert darum nicht zum Entkoppeln auf. Er erscheint erst, wenn alle Kandidaten gescheitert sind, dreimal hintereinander.) |
| `down(.repairNeeded)` | „Einmal neu koppeln“ | „Für die Direktverbindung braucht das iPad einen neuen Schlüssel. Kopple es einmal zu Hause neu (QR-Code am Mac).“ |

Die Texte behaupten nur, was die App weiß. `IPAD-VERBINDUNG.md` bekommt den Abschnitt „Im Hörsaal“ (§7, PR 4).

---

## 6. Vertragsvorschlag

Die Texte kommen mit **PR 2** nach `main`.

**V1 · §5, neuer Punkt nach „Lokal oder Netz entscheidet allein die Socket-Adresse“:**

```markdown
- **Tunnel-Eingang (UX-12):** Neben dem Haupteingang lauscht der Core auf einem Unix-Socket im Datenordner (`run/tunnel.sock`, Rechte 0600). Anfragen von dort gelten **immer als Netz**, nie als lokal: Token Pflicht, lokale Routen `403 local_only`. Der Eingang ist ausdrücklich markiert (jeder seiner Sockets steht in `tunnelSockets`, `isLocalRequest` prüft das zuerst), die Einstufung hängt nicht an der Socket-Adresse. „Lokal“ entscheidet im ganzen Core nur `isLocalRequest`. Der Tunnel-Eingang ist nie ein TCP-Port. `POST /devices/pair/start` und `POST /devices/pair/confirm` sind dort gesperrt (`403 local_only`). `SG_TUNNEL=0` schaltet den Eingang ab.
```

**V2 · §7.5 (Geräte) und §12 Schritt 3 (Änderung durch Sicherheits-Review, ersetzt die Route `tunnel-keys`):**

```markdown
- `PairResponse` enthält zusätzlich `tunnel_key` (32 Byte Zufall, base64url, 43 Zeichen, UX-12). Gleiche Regeln wie `device_token`: einmal ausgegeben, `Cache-Control: no-store`, nie im Log, nie unter einem `Idempotency-Key`. Der Core legt ihn nur in `<SG_DATA_DIR>/secrets/tunnel-keys.json` ab (0600, Ordner 0700), nie in der Datenbank, nie im Backup. `DELETE /devices/{id}` entfernt ihn nach dem Commit.
```

**V3 · §12, neuer Schritt 8 nach Schritt 7:**

```markdown
8. **Direkte Verbindung über den Tunnel (UX-12).** Nach der Kopplung spricht das iPad nur noch über einen beglaubigten Tunnel mit dem Mac, im gemeinsamen WLAN und direkt über Wi-Fi peer-to-peer.
   - **Grundsatz:** Das Geräte-Token geht nur durch eine Verbindung, deren Gegenseite sich als der gekoppelte Mac ausgewiesen hat. An eine gespeicherte IP-Adresse geht es nicht mehr.
   - **Helfer:** Am Mac läuft `sg-tunnel`. Je gekoppeltem Gerät kündigt er einen Bonjour-Dienst vom Typ `_sg-tunnel._tcp` an. Name: `sg-` plus die ersten 16 Hex-Zeichen von `HMAC-SHA256(tunnel_key, "sg-tunnel-name-v1")`. Der Name enthält keinen Rechnernamen und ist kein Nachweis.
   - **Nachweis:** TLS 1.2 mit vorab geteiltem Schlüssel, beidseitig. `PSK = HMAC-SHA256(tunnel_key, "sg-tunnel-psk-v1")`, PSK-Kennung fest `sg1`. Verfahren nur `TLS_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256` bzw. `TLS_ECDHE_PSK_WITH_AES_128_CBC_SHA` (Ausweichen auf `TLS_PSK_WITH_AES_128_GCM_SHA256` nur nach Spike-Befund, dann ohne Schutz alter Mitschnitte). Beide Seiten prüfen das ausgehandelte Verfahren. Ohne gültigen Handshake wird nichts weitergereicht.
   - **Weiterleitung:** Der Helfer reicht nur an den Tunnel-Eingang des Core weiter (§5). Dort gilt die Token-Prüfung unverändert.
   - **Widerruf:** Der Helfer liest die Schlüsseldatei (prüft alle 2 s auf Änderungen). Für ein entferntes Gerät stoppt er den Dienst und schließt die Verbindungen. Unabhängig davon ist das Token mit dem Commit von `DELETE /devices/{id}` ungültig.
   - **Wegewahl am iPad:** erst das gemeinsame WLAN, dann peer-to-peer. Eine bestehende Verbindung wechselt den Weg nicht.
   - **Kopplung:** Schritte 1 bis 7 bleiben unverändert und laufen im IP-Netz. Über den Tunnel wird nicht gekoppelt.
   - **`token_hash` bleibt reiner Prüfwert.** Ein gestohlenes Backup erlaubt nicht, sich als Mac auszugeben. Geräte, die vor UX-12 gekoppelt wurden oder nach einer Wiederherstellung keinen Tunnel-Schlüssel haben, müssen einmal neu gekoppelt werden.
   - **Restrisiken:** Der Diensttyp `_sg-tunnel._tcp` verrät im Funk, dass hier Studien-Gehirn läuft, und macht den Mac über Räume hinweg wiedererkennbar (`SG_TUNNEL_P2P=0` schaltet die Ankündigung im Funk ab). Falls nur `TLS_PSK_WITH_AES_128_GCM_SHA256` geht: kein Schutz alter Mitschnitte, falls `tunnel_key` später bekannt wird.
```

**V4 · `packages/schemas/**`:** `PairResponse.tunnel_key` (Pflichtfeld, Muster wie `device_token`) mit Beispiel. Die Schlüsseldatei ist kein API-Schema; ihr Format steht in V1 bzw. im Code von `services/tunnel.ts`, der Helfer liest sie mit eigenem `Decodable`.

**V5 · §1 (Umgebungsvariablen):** `SG_TUNNEL`, `SG_TUNNEL_P2P`.

---

## 7. PR-Zuschnitt

Reihenfolge fest. **Nach PR 1 entscheidet der Gerätetest des Owners, ob PR 2 bis 4 gebaut werden.** PR 2 und PR 3 ändern am iPad nichts (bis auf die neu erzeugte `Schemas.swift`, falls die CI sie prüft). Erst PR 4 stellt um. **PR 0 ist unabhängig davon und kommt sofort** (Sicherheits-Review).

### PR 0 · Sofort: Token nur ins eigene Netz (neu durch Sicherheits-Review)

- **Branch:** `claude/ipad-token-nur-im-netz` · unabhängig vom Spike, sofort. Nach PR 4 bleibt die Sperre als zweite Sicherung für die Kopplung bestehen oder entfällt mit dem Wegfall von `PairedMac.endpoint` für Anfragen mit Token.
- **Zweck:** B5 eindämmen. Heute geht das Token alle 15 s (`pollConnection`) und bei jedem Sync-Versuch (1 s bis 30 s) an die gespeicherte Adresse, in jedem Netz. In der Uni liegt die Heim-Adresse (z. B. `192.168.178.20`) gar nicht im Netz des iPads, die Anfrage geht an das Gateway der Uni. Ein bösartiges Gateway (offenes WLAN, nachgemachtes Netz) kann jede Verbindung auf Port 4710 annehmen und bekommt das Token.
- **Regel:** Eine Anfrage mit Token geht nur an eine IPv4-Adresse, die im Subnetz einer aktiven Schnittstelle des iPads liegt (`getifaddrs`: Schnittstelle `IFF_UP` und `IFF_RUNNING`, nicht Loopback, Adresse und Netzmaske). `.local`-Namen bleiben erlaubt (mDNS antwortet nur im eigenen Netzsegment). Sonst geht **nichts** raus, auch kein Verbindungsaufbau.
- **Scope:** `apps/ipad/Sources/Core/TokenDestination.swift` (neu), `Core/CoreClient.swift` (Prüfung in `send` und `downloadSlideDeckFile`, sobald ein Token mitgeht), `Sync/SyncEngine.swift` (`connectOnce` vor `sockets.open`, `healthSaysTokenInvalid`), `Core/ConnectionError.swift` (Fall `otherNetwork`), `Home/HomeView.swift` (Text), `App/AppModel.swift` (Einspeisen), Tests.
- **Schnittstelle:**
  ```swift
  struct InterfaceAddress: Equatable, Sendable { let address: UInt32; let netmask: UInt32 }
  enum TokenDestination {
      /// Reine Funktion: darf eine Anfrage mit Token an `host`? IPv4 nur im Subnetz einer Schnittstelle, `.local` immer
      static func allows(host: String, interfaces: [InterfaceAddress]) -> Bool
  }
  protocol InterfaceListing: Sendable { func activeIPv4() -> [InterfaceAddress] }   // echte Fassung: getifaddrs
  ```
- **Verhalten:** `CoreClient` wirft `ConnectionError.otherNetwork`, ohne den Transport aufzurufen. Der Sync bleibt in `waiting` und versucht es nach der üblichen Wartezeit neu (die Prüfung ist billig und lokal). Anzeige ruhig, ohne Dialog: „Mac nicht im selben Netz · Deine Notizen bleiben auf dem iPad und gleichen sich später ab.“ `unpair` löscht lokal auch dann, wenn die Abmeldung am Mac daran scheitert.
- **Tests:**
  - `allows`: Adresse im /24, im /16, außerhalb, Netzmaske /32, Link-Local 169.254/16, mehrere Schnittstellen, keine Schnittstelle, `.local`, ungültige Eingaben, führende Nullen.
  - `CoreClient` mit Fake-Transport und Fake-Schnittstellen: außerhalb des Subnetzes **keine einzige** aufgezeichnete Anfrage (`checkHealth`, REST, `downloadSlideDeckFile`, `removeDevice`). Kopplungsaufrufe ohne Token bleiben unberührt.
  - `SyncEngine` mit Fake-Socket-Fabrik: außerhalb des Subnetzes wird kein Socket geöffnet, Zustand `waiting`, Warteschlange unverändert. Innerhalb: Verhalten wie heute.
- **Grenze (ehrlich):** Ein fremdes Netz mit demselben Adressbereich (viele Router nutzen `192.168.0.0/24` oder `192.168.1.0/24`) lässt die Anfrage weiter durch. Gegen einen Angreifer im eigenen Heimnetz hilft es nicht (dort gilt das bekannte Restrisiko Klartext). Den vollständigen Schutz bringt erst PR 4.
- **Danach:** Nach PR 4 das iPad einmal neu koppeln (F6). Damit ist ein früher über B5 geleaktes Token wertlos.

### PR 1 · Spike: `GET /health` über peer-to-peer

- **Branch:** `feat/ux12-spike-p2p`
- **Zweck:** Der Owner prüft in der Uni, ob der Weg trägt. Kein Umbau am Sync.
- **Scope:** `spikes/s6-p2p/**` (neu), `apps/ipad/Sources/Tunnel/SpikeView.swift` (neu), ein Eintrag in den Verbindungsdetails (`Home/HomeView.swift`), `apps/ipad/Config/Info.plist` (`_sg-spike._tcp`), `docs/anleitungen/SPIKE-P2P.md` (neu).
- **Mac:** Swift-Paket `sg-spike`. Start von Hand im Terminal. Es zeigt einen Code mit 8 Ziffern, kündigt `_sg-spike._tcp` mit peer-to-peer an und nimmt TLS-PSK-Verbindungen an (Schlüssel aus dem Code).
- **Sicherheit des Spikes:** Der Helfer reicht **nichts** allgemein weiter. Er kennt vier Befehle: `health` (er selbst ruft `GET /api/v1/health` am Core auf und gibt Status und Dauer zurück), `echo`, `blob <MB>` (Zufallsdaten für die Durchsatzmessung), `ping`. Der Code hat wenig Entropie. Das ist nur für den Spike vertretbar, weil dahinter keine Rechte liegen.
- **Härtung des Spikes (Sicherheits-Review):** Wer einen Handshake im Funk mitschneidet, kann den 8-stelligen Code offline in Sekunden durchprobieren. Darum muss der Spike auch für einen Fremden mit dem Code harmlos bleiben:
  - `health`: feste URL, feste Methode, nur HTTP-Status und Dauer zurück, **nie** den Body. Nichts aus dem Funk fließt in die Anfrage an den Core.
  - `echo` höchstens 64 KiB, `blob` höchstens 50 MB, als Strom erzeugt, nicht im Speicher. Höchstens 4 Verbindungen gleichzeitig, Handshake höchstens 5 s, Leerlauf höchstens 60 s.
  - Kein Befehl liest Dateien, startet Prozesse oder öffnet andere Verbindungen. Unbekannte Befehle schließen die Verbindung.
  - Der Code ist bei jedem Start neu (`SecRandomCopyBytes`). Der Spike beendet sich nach spätestens 4 Stunden selbst und wird nie von `sg start` gestartet.
  - Das iPad schickt im Spike nie das Geräte-Token. Die Testansicht nutzt eigene Verbindungen, nicht `CoreClient`.
  - **Zusätzlich misst der Spike die TLS-Verfahren aus E12:** je Verfahren ein Handshake, Ergebnis (gelungen, ausgehandeltes Verfahren und Version) steht im geteilten Protokoll. Bei Erfolg mit ECDHE_PSK zusätzlich ein Mitschnitt am Mac (`tcpdump` auf `lo0` beim Loopback-Test), der den ECDHE-Schlüsselaustausch zeigt.
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

### PR 2 · Core: Tunnel-Eingang, Schlüsseldatei, Vertrag

- **Branch:** `feat/ux12-core-tunnel` · Bedingung: Spike bestanden.
- **Scope:** `docs/VERTRAEGE.md` (V1 bis V5), `packages/schemas/**` (V4, dazu die erzeugte `apps/ipad/Sources/…/Schemas.swift`, falls die CI sie prüft), `services/core/src/main.ts`, `src/app.ts`, `src/config.ts`, `src/plugins/security.ts`, `src/plugins/rejection-log.ts`, `src/routes/devices.ts`, `src/routes/settings.ts`, `src/routes/calendar.ts` (nur Umstellung auf `isLocalRequest`, B17), `src/services/pairing.ts`, `src/services/devices.ts`, `src/services/tunnel.ts` (neu: Schlüsseldatei, Ableitungen), Tests unter `services/core/test/**`, ein Test in `infra/sg/test/**` (Backup ohne `secrets/`).
- **Tests (Unit):** feste Testvektoren für `service_name` und `psk` aus `tunnel_key` (dieselben nutzen PR 3 und PR 4 in Swift). Schlüsseldatei: Rechte 0600/0700, atomar, Symlink statt Ordner wird abgelehnt, entfernte Geräte fehlen, Abgleich beim Start (verwaiste Einträge raus, keine neuen Schlüssel für Altgeräte). `pair/confirm`: Antwort enthält `tunnel_key`, Datei hat den Eintrag vor dem Gerät in Postgres; Schreibfehler → Kopplung scheitert, Fenster wieder offen. `tunnel_key` steht in keiner echten Logausgabe und in keinem `idempotency_key`.
- **Tests (Integration), der Kern dieses PRs:**
  - Am Tunnel-Eingang ohne Token: `401 device_token_required`. Mit ungültigem Token: `401`. Mit gültigem: 200.
  - **Jede** `local`-Route am Tunnel-Eingang mit gültigem Token: `403 local_only`. Der Test läuft über die Routentabelle, nicht über eine Liste von Hand.
  - `pair/start` und `pair/confirm` am Tunnel-Eingang: 403.
  - **Die Inline-Prüfungen aus B17** am Tunnel-Eingang mit gültigem Token: `PATCH /settings` mit `backup_target` → 403, `POST /calendar/reassign` → 403. Architekturtest: `isLoopbackAddress(` nur in `plugins/security.ts`.
  - Ein Tunnel-Socket mit gefälschtem `remoteAddress = '127.0.0.1'` (Attrappe) gilt trotzdem als Netz: Die Markierung schlägt die Adresse.
  - `Host: localhost:<Core-Port>` und `X-Forwarded-For: 127.0.0.1` am Tunnel-Eingang ändern nichts (421 bzw. Token Pflicht).
  - Fehlerpfad `frameworkErrors` (kaputte URL) am Tunnel-Eingang: als Netz behandelt.
  - WebSocket `/sync` am Tunnel-Eingang: Upgrade nur mit Token, `welcome.device_id` gesetzt, Ereignisse `localOnly` kommen dort nie an.
  - Rechte der Socket-Datei 0600, Ordner 0700. Alte Datei wird ersetzt. `SG_TUNNEL=0`: kein Socket, keine Schlüsseldatei.
  - Grenzen: die 129. Verbindung am Tunnel-Eingang wird abgewiesen, der Haupteingang bleibt erreichbar. `NetworkConnectionGate` sieht keine Tunnel-Sockets.
  - Der Haupteingang verhält sich unverändert (bestehende Tests bleiben grün).
- **Risiken:** zweiter Server neben Fastify (Routing und WebSocket-Upgrade teilen). Limits ohne Absenderadresse.

### PR 3 · Mac-Helfer `sg-tunnel`, `sg`, CI

- **Branch:** `feat/ux12-mac-tunnel` · abhängig von PR 2.
- **Scope:** `apps/mac-tunnel/**` (neu), `infra/sg/src/commands.ts`, `procs.ts`, `doctor.ts`, `config.ts`, Tests in `infra/sg/test/**`, `.github/workflows/ci.yml` (Job `mac-tunnel`), `docs/anleitungen/` (Abschnitt zum Helfer).
- **Tests (Swift, macOS-Runner, ohne Funk):**
  - Testvektoren aus PR 2.
  - Loopback: Client mit richtigem PSK kommt durch bis zu einem Fake-Core am Unix-Socket. Falscher PSK, falsche Kennung, kein TLS, ein Verfahren ohne PSK, ein nicht erlaubtes PSK-Verfahren: keine Verbindung zum Fake-Core (der Fake zählt Verbindungen).
  - Abgleich der Schlüsseldatei mit Fake-Uhr: neues Gerät → Listener. Entferntes Gerät → Listener weg, Verbindungen zu (binnen 2 s). Datei weg oder kaputt → alle Listener weg. Falsche Rechte oder fremder Besitzer → Abbruch mit Meldung. Core weg → alle Listener weg, kein Absturz.
  - Flut: 50 Verbindungen, die den Handshake nie beenden. Danach kommt ein richtiger Client binnen 6 s durch. Nach 5 s ist jede hängende Verbindung zu.
  - Grenze von 32 Verbindungen. Gegendruck: ein Fake-Core, der nicht liest, lässt den Speicher des Helfers nicht über die Puffergrenze wachsen. Zustandsdatei: Form, atomar, ohne Geheimnis.
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
  - Die Kopplung läuft weiter direkt und ohne Token. Sie speichert `tunnel_key` im Schlüsselbund (`…ThisDeviceOnly`), Entkoppeln löscht ihn.
  - Gekoppelt ohne `tunnel_key`: Zustand `repairNeeded`, kein Verbindungsversuch.
  - Zwei Kandidaten mit demselben Namen, der erste mit falschem PSK: Verbindung über den zweiten. Der Weiterleiter liest vor dem Handshake kein Byte von der lokalen Verbindung.
- **Inhalt Anleitungen:** Abschnitt „Im Hörsaal“: WLAN an beiden Geräten an, Mac aufgeklappt, Studien-Gehirn läuft, App öffnen, warten bis „Mac ●“ grün ist. Kein Netz nötig. Der Satz zum Hotspot in `IPAD.md` entfällt. **Nach dem Aufspielen einmal zu Hause neu koppeln** (F6).
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
| N5 | TLS-PSK in Network.framework: Gehen `TLS_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256` (0xCCAC) bzw. `TLS_ECDHE_PSK_WITH_AES_128_CBC_SHA` (0xC035) mit TLS 1.2 (E12)? Verhalten bei falschem Schlüssel. TLS 1.3 mit PSK geht laut Apple (2021) nicht (B19). | Spike misst jedes Verfahren, Mitschnitt beim Loopback-Test (§7, PR 1) |
| N6 | Peer-to-peer in einem ad hoc signierten Kommandozeilen-Programm. Lokales Netzwerk und Firewall am Mac. Muss Bluetooth an sein? Stört der Cisco-Filter? | Spike am Mac des Owners |
| N7 | Bevorzugt Network.framework von selbst das WLAN vor AWDL? Der Plan verlässt sich nicht darauf (zwei Stufen). Dauer des Verbindungsaufbaus über AWDL. | Spike misst beide Stufen |
| N8 | `NWPathMonitor`: Wie oft meldet er Änderungen im Alltag? | Gerätetest mit PR 4, Log |
| N9 | Erlaubnis „Lokales Netzwerk“ am iPad nach dem wöchentlichen Aufspielen | Gerätetest |
| N10 | ~~Enthalten Backups `device.token_hash`?~~ **Geklärt im Review:** ja, unverschlüsselt, bis 6 Monate (B18). Folge: E3 neu | – |
| N11 | Zweiter HTTP-Server neben Fastify am Unix-Socket, mit geteiltem WebSocket-Upgrade | PR 2, früh als Test |
| N12 | Bonjour-Namenskonflikt: Benennt `NWListener` den Dienst still um („ (2)“), wenn ein Fremder den Namen belegt, und wie meldet er das? | Spike: zweiten Dienst mit gleichem Namen von Hand starten (`dns-sd -R`) |
| N13 | Hat der Owner Time Machine an, und ist es verschlüsselt? (Rest von R-A) | Frage im Gerätetest, nur notieren |

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
- Erledigt am 12.11.2026, Ergebnis in §10.2.
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
| Gekoppeltes, dann entferntes Gerät | Helfer stoppt den Dienst nach höchstens 2 s (Schlüsseldatei). Der Core lehnt das Token sofort ab |
| Tunnel-Anfrage als „lokal“ | Eigener, markierter Eingang (E2), Tests über die ganze Routentabelle |
| Fremder Rechner unter der gespeicherten IP (B5) | Sofort: PR 0 (nur ins eigene Subnetz). Ab PR 4: Dorthin geht kein Token mehr (E7). Danach einmal neu koppeln (F6) |
| Viele gefälschte Dienste oder Störsender | Nur Verzögerung. Ehrlicher Text, kein Leck. Bis 4 Kandidaten je Name, auch mit Konflikt-Zusatz |
| Flut von Handshakes am Helfer | 5 s Frist, höchstens 8 offene Handshakes je Listener, älteste fliegt raus. Speicher begrenzt (§5.2) |
| Name besetzen, damit „falscher Schlüssel“ erscheint und der Nutzer entkoppelt | Text fordert nicht zum Entkoppeln auf (§5.4) |
| Mitlesen der PSK-Kennung im Funk (Verfolgen des iPads) | Feste Kennung `sg1` (E13) |
| Prozess am Mac nutzt den Unix-Socket | Bekommt weniger als über Loopback: Token Pflicht (§5.1) |
| Webseite oder fremde App am Mac liest Tunnel-Schlüssel | Keine Route mehr, Datei 0600 (E8) |
| Gestohlenes Backup plus Funkreichweite | Backup enthält keinen Tunnel-Schlüssel (E3). Rest: R-A |
| Mitschnitt heute, `tunnel_key` später | ECDHE_PSK (E12), sonst R-B |
| Andere App auf dem iPad nutzt den Loopback-Port | Braucht das Token. Kopplung am Tunnel gesperrt |

### 10.2 Ergebnis des Plan-Reviews (Opus, 12.11.2026)

**Urteil:** Tragfähig **mit den eingearbeiteten Änderungen**. Der Aufbau (eigener, markierter Tunnel-Eingang, TLS-PSK im Funk, Token weiter am Core) ist richtig. Ohne die Änderungen hätte er zwei echte Lücken gehabt: ein Schlüssel, der in jedem Backup steht, und ein heutiges Token-Leck, das mit dem Tunnel schlimmer geworden wäre.

| # | Befund | Schwere | Maßnahme im Plan |
|---|---|---|---|
| S1 | **B5 ist echt** (geprüft am Code): `HomeView.task` → `AppModel.pollConnection` → `checkConnection` → `CoreClient.checkHealth(endpoint: mac.endpoint, token:)` alle 15 s, solange der Sync nicht online ist. `SyncEngine.connectOnce` setzt `Authorization` bei jedem Versuch (1 s bis 30 s), `healthSaysTokenInvalid` ebenso. Es gibt keine Prüfung des Netzes. Wer das Gateway eines fremden Netzes stellt oder die Adresse im selben Netz übernimmt, bekommt das Token. Das Repo ist öffentlich, Port und Ablauf sind bekannt. Heute braucht der Angreifer danach noch einen Weg zum Mac. Mit dem ursprünglichen E3 hätte das Token allein für den Funk gereicht. | **Mittel, dringend** (mit ursprünglichem E3 hoch) | PR 0 sofort (§7), E3 neu, F6 (einmal neu koppeln) |
| S2 | `token_hash` als Schlüssel: steht unverschlüsselt in allen Backups (`pg_dump`, bis 6 Monate, frei wählbares Ziel, B18). Ein verlorener USB-Stick plus Funkreichweite hätte gereicht, um sich als Mac auszugeben, alle neuen Notizen zu bekommen und das iPad mit falschen Daten zu füttern. | **Hoch** | E3: eigener `tunnel_key` außerhalb von Postgres und Backup. Schlüsselpaar mit Pinning bewusst nicht (§3.1) |
| S3 | Kein Schutz alter Mitschnitte: Apples Beispiel nutzt `TLS_PSK_WITH_AES_128_GCM_SHA256`, TLS 1.3 mit PSK geht laut Apple nicht (B19). | Mittel | E12: ECDHE_PSK bevorzugt, ausgehandeltes Verfahren prüfen, Spike misst |
| S4 | Schlüssel-Route auf Loopback: erreichbar für jeden Prozess am Mac, auch andere Benutzer und Sandbox-Apps. Für Browser durch fehlendes CORS geschützt, aber eine unnötige Fläche. | Mittel | E8: Schlüsseldatei 0600 statt Route |
| S5 | „Lokal“ wird an drei Stellen am Wächter vorbei geprüft (B17). Für den Unix-Socket heute sicher, aber nicht an der Markierung festgemacht. Der geplante Test über `sgAccess` hätte sie nicht erfasst. | Mittel | §5.1: alles über `isLocalRequest`, Architekturtest, eigene Tests |
| S6 | `NetworkConnectionGate` am Tunnel-Server: alle Verbindungen ohne Adresse in einem Topf, Freigabe der Pseudo-Adresse `unbekannt`. | Niedrig bis mittel | §5.1: eigener Grenzwert, Gate nicht anhängen |
| S7 | DoS am Helfer: offene Handshakes hätten die 32 Plätze füllen können. Kein Puffer-Limit genannt. | Mittel | §5.2 Punkt 6 |
| S8 | PSK-Kennung `device_id` geht im Klartext durch den Funk und macht das iPad verfolgbar. | Niedrig | E13 |
| S9 | Diensttyp und Name im Funk machen den Mac wiedererkennbar (R-C). Ein wechselnder Name hilft nicht, weil der Typ eindeutig ist. | Niedrig | Kein Wechsel, ehrlich benannt (§3.1), `SG_TUNNEL_P2P=0` |
| S10 | Namen besetzen: Ein Fremder kann den Dienstnamen belegen (Bonjour benennt den echten Dienst dann um) und mit falschem Schlüssel antworten. Der alte Text riet dann zum Neukoppeln. | Niedrig | Kandidaten mit Konflikt-Zusatz (§5.3), neuer Text (§5.4), `sg doctor` |
| S11 | Spike: Der 8-stellige Code ist nach einem mitgeschnittenen Handshake offline in Sekunden geraten. Harmlos nur, wenn `health` keinen Body zurückgibt und alle Befehle begrenzt sind. | Niedrig | §7, PR 1 „Härtung“ |
| S12 | Entkoppeln und Widerruf: Der Core wirkt sofort, der Helfer nach höchstens 2 s. Entkoppeln am iPad ohne Mac lässt den Dienst am Mac stehen, ohne Schlüssel nutzlos. | Info | §5.3 |
| S13 | Ablauf der Entwickler-App nach 7 Tagen: Neu aufspielen über Xcode behält Schlüsselbund und UserDefaults. Wird die App gelöscht, ist die Kopplung weg (UserDefaults), Schlüsselbund-Reste werden bei der nächsten Kopplung überschrieben. Lokales Netzwerk: N9. | Info | – |
| S14 | Firewall-Frage am Mac nach jedem Neubau. Wer „Ablehnen“ klickt, sperrt den Helfer still. | Niedrig | `sg doctor` prüft es (§5.2) |

**Geprüft und in Ordnung:** Unix-Socket hat `remoteAddress = undefined` und gilt schon heute als Netz. `trustProxy` ist aus, `Host` und `X-Forwarded-*` entscheiden nie über „lokal“. Der WebSocket-Upgrade geht über denselben Wächter (`authenticateUpgrade` bzw. `onRequest`). CORS gibt es nur für `SG_DEV_WEB_ORIGIN`. Ein Prozess am Mac bekommt über den Unix-Socket weniger Rechte als über Loopback. Das Token hat 256 Bit, `tunnel_key` ebenso: Raten ist aussichtslos.

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
| F6 | (Neu durch Sicherheits-Review) Nach PR 4 musst du das iPad **einmal zu Hause neu koppeln** (QR-Code, etwa eine Minute). Danach nie wieder wegen Netzwechseln. In Ordnung? | Ja. Es macht auch ein Token wertlos, das bis dahin über B5 in fremde Netze gegangen ist |

---

## 12. Abnahme

- [ ] Spike: Gerätetest §9.1 bestanden und im Issue dokumentiert.
- [ ] Im Hörsaal, beide Geräte ohne gemeinsames Netz: „Mac ●“ wird ohne Zutun grün. Striche erscheinen am Mac.
- [ ] Zu Hause im WLAN: ebenso, Anzeige „Verbunden über das WLAN“.
- [ ] Wechsel zwischen beiden Orten ohne neue Kopplung.
- [ ] PR 0: Außerhalb des eigenen Subnetzes geht keine Anfrage mit Token raus (Test).
- [ ] Keine Anfrage mit Token geht an eine IP-Adresse des Netzes (Test und Review-Prüfsatz).
- [ ] `tunnel_key` steht weder in Postgres noch im Backup noch in einem Log (Tests).
- [ ] Ausgehandeltes TLS-Verfahren laut Spike-Protokoll; ohne ECDHE nur mit Vermerk R-B im Vertrag.
- [ ] Keine Anfrage vom Tunnel erreicht eine lokale Route (Test über die Routentabelle).
- [ ] Während einer Session erscheint kein Dialog (R1).
- [ ] `sg doctor` meldet den Zustand des Helfers. Die CI baut und testet ihn.
- [ ] `IPAD-VERBINDUNG.md` hat den Abschnitt „Im Hörsaal“. UX-12 ist in `STUDIENALLTAG-2.md` als erledigt geführt.
