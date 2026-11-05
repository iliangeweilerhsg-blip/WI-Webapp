# Spike S1 + S3 – iPad-Minimal-App (`.swiftpm`) und Mac-Gegenstelle

Mit diesem Paket klären wir in **ca. 45 bis 60 Minuten** gleichzeitig zwei offene Entscheidungen vor der eigentlichen Umsetzung:

- **Spike S1 (`R-01`):** Läuft unsere iPad-Notiz-App direkt in **Swift Playgrounds** auf dem iPad (Weg A), oder installieren wir sie über **Xcode** mit deiner normalen, kostenlosen Apple-ID (Weg B)? Funktionieren Kamera, Bonjour-Suche (`_studiengehirn._tcp`), WebSocket-Verbindung, Speichern beim Schließen und der Apple-Pencil-2-Doppeltipp?
- **Spike S3 (`R-02`, `NF-02`):** Erreichen wir **&le; 1 Sekunde** Verzögerung vom Absetzen des Stifts auf dem iPad bis zur Darstellung im Browser auf dem Mac? Und welche exakten Rohwerte (`force`, `altitude`, `azimuth`, `size`) liefert dein **iPad Air mit Apple Pencil 2**?

---

## Wichtige Sicherheitshinweise vor dem Start

- **Unverschlüsseltes lokales Testprotokoll im WLAN:** Während `server.mjs` läuft (`0.0.0.0:4797`), kann jedes andere Gerät im selben WLAN mitlesen oder eigene Test-Striche einschleusen.
- **Verbindungsplätze:** Der Server erlaubt höchstens 8 gleichzeitige WebSocket-Verbindungen. Ein Gerät im selben WLAN kann diese 8 Plätze belegen und das iPad aussperren (für den Spike vertretbar; ein Platz wird nach einem Protokollfehler nach ca. 1 s freigegeben, sonst nach 5 Minuten Inaktivität). Hilft nur: Server neu starten bzw. anderes Netz verwenden. Dasselbe gilt für das Speicherbudget (ca. 20 MB Striche je Sitzung): Ein fremdes Gerät könnte es schnell füllen, danach lehnt der Server Striche bis zum Neustart ab. Die Dateigrenze von 25 MB für `strokes.jsonl` greift nur über mehrere Sitzungen hinweg, weil die Datei fortgeschrieben wird.
- **Speichergrenzen:** Pro Strich höchstens 5000 Punkte, im Speicher insgesamt ca. 20 MB; darüber lehnt der Server Striche mit Meldung ab. `strokes.jsonl` wird ab 25 MB nicht mehr beschrieben (Warnung in Konsole und Viewer). Den Viewer bitte über `http://localhost:4797` öffnen, nur dann zählen seine Latenzmeldungen.
- **Empfehlung:** Führe den Test im **eigenen Heim-WLAN** oder über einen **persönlichen Hotspot** durch, schreibe **keine privaten oder vertraulichen Inhalte** auf die Testfläche und beende den Server nach dem Test wieder mit **`Strg+C`** (er schaltet sich zudem nach 60 Minuten automatisch ab).

---

## Schritt 1: Mac-Gegenstelle starten

Öffne auf deinem Mac das Terminal im Projektordner (`WI-Webapp`) und starte die Gegenstelle:

```bash
node spikes/s1-ipad/mac/server.mjs
```

1. **macOS-Firewall-Dialog bestätigen:** Falls macOS beim Start fragt *„Möchtest du, dass das Programm ‚node‘ eingehende Netzwerkverbindungen akzeptiert?"*, klicke auf **Erlauben**, damit dein iPad den Mac im WLAN erreichen kann.
   - **iPad erreicht den Mac nicht?** Siehe [`docs/anleitungen/IPAD-VERBINDUNG.md`](../../docs/anleitungen/IPAD-VERBINDUNG.md). Bekannte Ursache: der Socket Filter von Cisco Secure Client.
2. Der Server gibt deine lokale WLAN-IP-Adresse (z. B. `192.168.178.42:4797`) aus und kündigt sich per Bonjour (`dns-sd -R "StudienGehirn-Mac" _studiengehirn._tcp local 4797`) im WLAN an.
3. Öffne auf deinem Mac im Browser:
   **`http://localhost:4797`**

Alle empfangenen Striche und Rohwerte werden ausschließlich lokal unter `~/StudienGehirn/spikes/s1/` gespeichert (niemals im Git-Repository).

---

## Schritt 2: iPad-App öffnen (zuerst Weg A testen, falls nötig Weg B)

### Weg A: Direkt in Swift Playgrounds auf dem iPad (zuerst probieren)

- **Voraussetzung:** **Swift Playgrounds 4.5 oder neuer** auf **iPadOS 17.0+** (für Pencil-Squeeze optional iPadOS 17.5+).

1. Sende den Ordner **`spikes/s1-ipad/StudienGehirnSpike.swiftpm`** vom Mac per **AirDrop** an dein iPad (oder lege ihn in **iCloud Drive** ab).
2. Öffne auf dem iPad die App **Swift Playgrounds** und tippe auf **`StudienGehirnSpike`**.
3. Tippe oben auf den Start-Knopf **▶ (Ausführen)**.
4. Prüfe oben links in der Statusleiste der App, ob **`✓ 08 §4.2`** grün leuchtet (automatischer Format-Selbsttest beim Start).
5. **Zusatzprüfung für `S1-U1` & `S1-U2` in Swift Playgrounds:**
   - **S1-U2 (Homescreen-Icon):** Prüfe in Swift Playgrounds, ob sich die App direkt auf dem iPad ohne Mac/Xcode als eigenes Icon auf den iPad-Homescreen legen lässt oder nur über den **▶**-Knopf in Playgrounds startet.
   - **S1-U1 (`CustomInfo.plist`):** Ändere testweise in den App-Einstellungen von Swift Playgrounds die Akzentfarbe oder das Icon und prüfe danach in `Package.swift`, ob die Zeile `additionalInfoPlistContentFilePath: "CustomInfo.plist"` erhalten geblieben ist.
   - *Hinweis bei Build-Warnung wegen doppelter Local-Network-Schlüssel:* Sowohl `Package.swift` (`.localNetwork(...)`) als auch `CustomInfo.plist` (`NSBonjourServices`) setzen die Bonjour-Einträge. Sollte deine Playgrounds-/Xcode-Version einen Konflikt wegen doppelter `Info.plist`-Schlüssel melden, entferne einfach die beiden Schlüssel `NSBonjourServices` und `NSLocalNetworkUsageDescription` aus `CustomInfo.plist`.

### Weg B: Über Xcode vom Mac auf das iPad installieren (falls Weg A bei Bonjour/Homescreen hakt)

1. Öffne den Ordner **`spikes/s1-ipad/StudienGehirnSpike.swiftpm`** auf dem Mac in **Xcode** (`File -> Open…`).
2. Klicke links auf **`StudienGehirnSpike`**, wechsle zum Reiter **Signing & Capabilities**, aktiviere **Automatically manage signing** und wähle unter **Team** deine eigene Apple-ID (*Personal Team*, kostenlos).
3. Verbinde dein iPad per USB-C-Kabel mit dem Mac, wähle dein iPad oben in der Xcode-Symbolleiste als Zielgerät aus und drücke **`⌘R`** (*Run*).
   *(Hinweis beim allerersten Mal: Auf dem iPad unter `Einstellungen -> Allgemein -> VPN und Geräteverwaltung` deinem Entwickler-Zertifikat vertrauen und ab iPadOS 16+ unter `Einstellungen -> Datenschutz & Sicherheit -> Entwicklermodus` aktivieren.)*

---

## Schritt 3: Testablauf (ca. 45 Minuten)

Führe auf dem iPad der Reihe nach diese 6 Schritte durch (alle Prüfpunkte werden oben in der iPad-App und gleichzeitig auf dem Mac unter `http://localhost:4797` als **`✓`** protokolliert):

1. **Bonjour-Freigabe-Dialog bestätigen & verbinden:**
   - Tippe in der iPad-App auf **„Mac suchen (Bonjour)"**.
   - Bestätige den iPadOS-Dialog *„Möchtest du erlauben, dass StudienGehirnSpike Geräte in deinem lokalen Netzwerk sucht?"* mit **Erlauben**.
   - Die App findet deinen Mac automatisch und verbindet sich per WebSocket (`✓ Bonjour`, `✓ Verbunden`).
   - *Falls Bonjour in Swift Playgrounds blockiert wird:* Trage die im Mac-Terminal angezeigte IP-Adresse (z. B. `192.168.178.42:4797`) ins Textfeld ein und tippe auf **„IP verbinden"**.
2. **Doppeltipp am Apple Pencil 2 testen:**
   - Tippe zweimal kurz vorne auf deinen Apple Pencil 2.
   - Das aktive Werkzeug wechselt zwischen **Stift (`pen`)** und **Textmarker (`marker`)**, und oben leuchtet **`✓ Doppeltipp`**.
3. **5 Minuten auf dem iPad schreiben & Latenz am Mac ablesen:**
   - Schreibe ca. 5 Minuten lang mit allen Werkzeugen (**Stift**, **Füller**, **Bleistift**, **Monoline** und **Textmarker**) – gerne ein paar Übungssätze, eine Formel und ein kleines Kästchen-Diagramm (bitte nichts Privates).
   - Prüfe auf dem iPad, dass der gelbe Textmarker **unter** der dunklen Schrift liegt.
   - Zeichne zum Vergleich auch **2–3 Striche mit dem bloßen Finger**.
   - Lies auf dem Mac unter `http://localhost:4797` den **Latenz-Median** und **p95** ab (Ziel: **&le; 1000 ms**).
4. **Rohwerte an den Mac senden:**
   - Wechsle in der iPad-App oben auf den zweiten Reiter **„2. Rohwerte (Pencil vs. Finger)"**.
   - Tippe rechts oben auf **„An Mac senden"**. Die Tabelle mit `min`, `median` und `max` für `force`, `altitude`, `azimuth` und `size` erscheint sofort im Browser auf dem Mac.
5. **App schließen und wieder öffnen (Sind die Striche noch da?):**
   - Tippe auf **„Speichern"** (oder wische die App auf dem iPad in den Hintergrund – sie speichert bei `scenePhase == .background` automatisch: **`✓ Gespeichert`**).
   - Beende die App komplett und starte sie erneut: Prüfe, ob deine gezeichneten Striche wieder auf der Fläche sind und oben **`✓ Geladen`** grün leuchtet.
6. **Tafel-Foto aufnehmen:**
   - Tippe in der iPad-App auf **„Tafel-Foto"**, nimm ein kurzes Testfoto auf und bestätige mit *Foto benutzen*. Oben leuchtet **`✓ Kamera`**.

---

## Schritt 4: Ergebnisbogen an Claude schicken

Unten auf der Mac-Seite (`http://localhost:4797`) findest du das Textfeld **„Ergebnisbogen für Spike S1 + S3"**. Klicke auf **„Ergebnisbogen kopieren"**, fülle die drei offenen Klammerfelder (`Genutzter Start-Weg`, `S1-U1`, `S1-U2`) kurz aus und schicke den Block hier im Chat an Claude.

---

## Automatischer Selbsttest der Mac-Gegenstelle (für Entwickler / CI)

Um die Mac-Gegenstelle inkl. RFC-6455-Framing, Host-/Origin-Prüfung, Ping-Pong und 3 Beispielstrichen aus `tests/fixtures/strokes/01-handschrift-pen.json` lokal ohne iPad zu prüfen:

```bash
node spikes/s1-ipad/mac/test-client.mjs
```

Der Test läuft in einem temporären `HOME` (`os.tmpdir()/s1-test-…`), das am Ende gelöscht wird. Deine echten Messdaten unter `~/StudienGehirn/spikes/s1/` bleiben unangetastet.
