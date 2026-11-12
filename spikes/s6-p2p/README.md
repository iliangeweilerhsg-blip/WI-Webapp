# Spike S6 – Mac und iPad direkt per Wi-Fi peer-to-peer (UX-12, PR 1)

Gehört zu Issue #138 und zum Plan [`docs/plaene/UX-12-MAC-WIEDERFINDEN.md`](../../docs/plaene/UX-12-MAC-WIEDERFINDEN.md) (PR 1). **Anleitung für den Owner:** [`docs/anleitungen/SPIKE-P2P.md`](../../docs/anleitungen/SPIKE-P2P.md).

Der Spike beantwortet nur: Erreichen sich Mac und iPad über AWDL (`includePeerToPeer = true`, Network.framework) in einem isolierten Uni-WLAN, wie schnell, wie stabil, und welche TLS-PSK-Verfahren gehen (Plan E12, N5)? Es gibt keinen Umbau am Sync und keinen Core-Code.

## Aufbau

| Ziel | Inhalt |
|---|---|
| `SpikeShared` (Bibliothek) | Rahmen und feste Befehle (`SpikeWire`), Code und Ableitungen (`SpikeCode`), TLS-1.2-PSK-Optionen und Prüfung des ausgehandelten Verfahrens (`SpikeTLS`), Client (`SpikeClient`). **Dieselben Quelldateien bindet die iPad-App ein** (`apps/ipad/project.yml`), darum Swift-6-Sprachmodus und überall `public` |
| `SpikeServerKit` (Bibliothek) | Server mit Sitzungen, `health`-Sonde, Selbsttest. Sprachmodus 5 |
| `sg-spike` (Programm) | Argumente, Anzeige des Codes, Selbstbeendigung nach 4 h |

iPad: `apps/ipad/Sources/Tunnel/` (`SpikeView`, `SpikeP2PModel`, `SpikeBrowser`), eingehängt unter Verbindungsdetails → Entwickler. `Info.plist` hat `NSBonjourServices` um `_sg-spike._tcp` erweitert. `NSLocalNetworkUsageDescription` bleibt.

Bauen und starten (Repo-Ordner): `swift run -c release --package-path spikes/s6-p2p sg-spike`. Optionen: `--no-p2p`, `--core-port N`, `--selftest`, `--port N`.

## Protokoll

Innerhalb von TLS 1.2 mit PSK. Anfrage `[op:1][Länge:4 BE][Nutzlast]`, Antwort `[status:1][Länge:4 BE][Nutzlast]`.

| Befehl | op | Nutzlast | Antwort |
|---|---|---|---|
| `ping` | 1 | leer | leer |
| `health` | 2 | leer | 6 Byte: HTTP-Status (0 = Core nicht erreichbar), Dauer in ms. Der Mac ruft fest `GET http://127.0.0.1:<Core-Port>/api/v1/health` auf, liest den Body nie, folgt keiner Weiterleitung |
| `echo` | 3 | höchstens 64 KiB | dieselben Bytes |
| `blob` | 4 | 4 Byte: MiB, 1 bis 50 | Zufallsdaten als Strom in 64-KiB-Blöcken, nie komplett im Speicher |

Durchsatz „hin und zurück“ nutzt `echo` in Blöcken zu 64 KiB mit höchstens 4 gleichzeitig unterwegs. Es gibt dafür keinen fünften Befehl. Unbekannter Befehl oder nicht erlaubte Länge: Der Mac schließt die Verbindung.

## Schlüssel und Namen

- Code: 8 Ziffern, `SecRandomCopyBytes`, bei jedem Start neu.
- `PSK = HMAC-SHA256(Code, "sg-spike-psk-v1")`, PSK-Kennung fest `sgs1` (Plan E13).
- Bonjour-Name `sgs-` plus 2 Hex-Zeichen aus `HMAC-SHA256(Code, "sg-spike-name-v1")`, Typ `_sg-spike._tcp`. Der Dienstname enthält keinen Rechnernamen. Wie bei jedem Bonjour-Dienst nennt aber der SRV-Eintrag den lokalen Hostnamen des Macs (`<name>.local`, Systemeinstellungen → Allgemein → Freigaben), und der ist in Funkreichweite lesbar. Bewusst nur 8 Bit: Mit mehr ließe sich der Code allein aus dem offen angekündigten Namen offline zurückrechnen.
- TLS 1.2 (min = max). Angeboten werden `TLS_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256` (0xCCAC), `TLS_ECDHE_PSK_WITH_AES_128_CBC_SHA` (0xC035) und `TLS_PSK_WITH_AES_128_GCM_SHA256` (0x00A8). Beide Seiten prüfen nach dem Handshake das ausgehandelte Verfahren und brechen bei einem anderen ab. Die Testansicht misst jedes Verfahren einzeln („TLS-Verfahren messen“).
- Testvektoren für Code `12345678`: Name `sgs-9a`, PSK `2733e12b18abbee8832c351b8a1e950a239de20aaa1914eedacdd4a7d8b5af43` (stehen in den Tests von Mac und iPad).

## Grenzen (Plan „Härtung des Spikes“)

| Grenze | Wert |
|---|---|
| Verbindungen gleichzeitig (auch im Handshake) | 4, weitere werden abgewiesen |
| Handshake | 5 s, dann zu |
| Leerlauf | 60 s, dann zu |
| `echo` / `blob` | 64 KiB / 50 MB |
| Laufzeit | 4 h nach der Wanduhr (Ruhezustand zählt mit), dann beendet sich das Programm |
| Gescheiterte Handshakes | 50, dann nimmt der Server nichts mehr an und das Programm beendet sich (Raten des Codes übers Netz) |
| Zugriff nach außen | nur `health`, feste URL, nur Status und Dauer |
| `health` | höchstens eine Abfrage je Sekunde, für alle Verbindungen zusammen (`SpikeHealthGate`) |

Der Code hat rund 26,6 Bit Entropie, nach dem Bonjour-Namen bleiben 18,6 Bit. Übers Netz geraten: höchstens 50 Versuche, also etwa 1 zu 7800 je Start. Offline ist er in Sekunden bis Minuten geraten: bei `TLS_PSK_WITH_AES_128_GCM_SHA256` schon aus einem passiven Mitschnitt (die Verfahrensmessung macht genau so einen Handshake), bei ECDHE_PSK durch einen Fremden, der sich als Mac ausgibt und den Handshake des iPads annimmt. Das ist nur vertretbar, weil dahinter nichts liegt außer diesen vier Befehlen.

## Tests

- `swift test --package-path spikes/s6-p2p`: Befehlsparser, Rahmen, Längengrenzen, Ableitungen mit Testvektoren, Loopback mit TLS-PSK (richtiger Code → Antwort, falscher Code → kein Handshake, Grenze von Verbindungen, Handshake-Frist, Sperre nach Fehlversuchen, Verfahrenstabelle). CI: Job `spike-p2p` auf `macos-latest`.
- Der Test der Verfahrenstabelle verlangt nur, dass **mindestens ein** zulässiges Verfahren über Loopback geht. Welche gehen, steht im CI-Protokoll („Selbsttest über Loopback“).
- iPad: `apps/ipad/Tests/SpikeP2PTests.swift` (reine Funktionen und die geteilten Testvektoren).

## Mitschnitt für ECDHE_PSK (Plan, N5)

Geht ein ECDHE_PSK-Verfahren, zeigt ein Mitschnitt den ECDHE-Schlüsselaustausch (ServerKeyExchange mit Kurve). Auf dem Mac in zwei Terminal-Fenstern:

```bash
sudo tcpdump -i lo0 -nn -w /tmp/s6-loopback.pcap port 4799
swift run -c release --package-path spikes/s6-p2p sg-spike --selftest --port 4799
```

Dann die Datei in Wireshark öffnen (TLS-Handshake je Verbindung, Cipher Suite im ServerHello, `ServerKeyExchange` vorhanden bei 0xCCAC bzw. 0xC035, bei 0x00A8 nicht). Der Mitschnitt enthält nur Testdaten.

## Nicht geprüft (kein Swift und kein Apple-Gerät in der Entstehungsumgebung)

Alles in diesem Ordner und in `apps/ipad/Sources/Tunnel/` wurde ohne Compiler geschrieben. Offen sind unter anderem die Plan-Punkte N1 bis N7 und N12, ob die Namen der SDK-Typen (`tls_ciphersuite_t(rawValue:)`, `sec_protocol_*`) in der eingesetzten Xcode-Version so stimmen, und ob `includePeerToPeer` in einem ad hoc signierten Kommandozeilenprogramm ohne weiteres läuft.
