# Spike S1 + S3 – iPad-Minimal-App (`.swiftpm`) und Mac-Gegenstelle

Mit diesem Paket klären wir in **ca. 45 bis 60 Minuten** gleichzeitig zwei offene Entscheidungen vor der eigentlichen Umsetzung:

- **Spike S1 (`R-01`):** Läuft unsere iPad-Notiz-App direkt in **Swift Playgrounds** auf dem iPad (Weg A), oder installieren wir sie über **Xcode** mit deiner normalen, kostenlosen Apple-ID (Weg B)? Funktionieren Kamera, Bonjour-Suche (`_studiengehirn._tcp`), WebSocket-Verbindung, Speichern beim Schließen und der Apple-Pencil-2-Doppeltipp?
- **Spike S3 (`R-02`, `NF-02`):** Erreichen wir **&le; 1 Sekunde** Verzögerung vom Absetzen des Stifts auf dem iPad bis zur Darstellung im Browser auf dem Mac? Und welche exakten Rohwerte (`force`, `altitude`, `azimuth`, `size`) liefert dein **iPad Air mit Apple Pencil 2**?

---

## Schritt 1: Mac-Gegenstelle starten

Öffne auf deinem Mac das Terminal im Projektordner (`WI-Webapp`) und starte die Gegenstelle:

```bash
node spikes/s1-ipad/mac/server.mjs
```

1. Der Server gibt deine lokale WLAN-IP-Adresse (z. B. `192.168.178.42:4797`) aus, kündigt sich automatisch per Bonjour (`dns-sd -R "StudienGehirn-Mac" _studiengehirn._tcp local 4797`) im WLAN an und beendet sich nach 60 Minuten von selbst.
2. Öffne auf deinem Mac im Browser:
   **`http://localhost:4797`**

Alle empfangenen Striche und Rohwerte werden ausschließlich lokal unter `~/StudienGehirn/spikes/s1/` gespeichert (niemals im Git-Repository).

---

## Schritt 2: iPad-App öffnen (zuerst Weg A testen, falls nötig Weg B)

### Weg A: Direkt in Swift Playgrounds auf dem iPad (zuerst probieren)

1. Sende den Ordner **`spikes/s1-ipad/StudienGehirnSpike.swiftpm`** vom Mac per **AirDrop** an dein iPad (oder lege ihn in **iCloud Drive** ab).
2. Öffne auf dem iPad die kostenlose App **Swift Playgrounds** und tippe auf das Projekt **`StudienGehirnSpike`**.
3. Tippe oben auf den Start-Knopf **▶ (Ausführen)**.
4. Prüfe oben in der Statusleiste der App, ob direkt ganz links **`✓ 08 §4.2`** grün leuchtet (automatischer Format-Selbsttest beim Start).

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
   - Schreibe ca. 5 Minuten lang mit allen Werkzeugen (**Stift**, **Füller**, **Bleistift**, **Monoline** und **Textmarker**) – gerne Sätze, eine Formel und ein kleines Kästchen-Diagramm.
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

Unten auf der Mac-Seite (`http://localhost:4797`) findest du das Textfeld **„Ergebnisbogen für Spike S1 + S3"**. Klicke auf **„Ergebnisbogen kopieren"**, ergänze kurz in einem Satz, ob du **Weg A (Playgrounds)** oder **Weg B (Xcode)** genutzt hast, und schicke den Block hier im Chat an Claude.
