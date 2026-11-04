# Recherchebericht zur Vorbereitung der Spikes S1, S3, S4 und S5 (Phase 1)

| | |
|---|---|
| **Bezug** | `docs/spezifikation/10-UMSETZUNG.md` §4 (Spikes S1, S3, S4, S5), Issue #22 |
| **Stand** | 04.11.2026 |
| **Zielhardware** | Mac mit Apple Silicon (aktuelles macOS), iPad mit Apple Pencil (aktuelles iPadOS) |
| **Autor** | Argon (`Gemini 4 Argon (Medium)`) |

---

## Kurzfassung (Executive Summary)

1. **S1 (Swift Playgrounds vs. Xcode):** Ein `.swiftpm`-App-Projekt in Swift Playgrounds 4.x unterstützt `PKCanvasView` (inkl. 2 Ebenen), `UIPencilInteraction` / `.onPencilDoubleTap` / `.onPencilSqueeze` (ab iPadOS 17.5+), Kamera, `URLSessionWebSocketTask` und `NWBrowser` vollständig. **Kritischer Punkt:** Für Bonjour (`_studiengehirn._tcp`) muss `NSBonjourServices` über `additionalInfoPlistContentFilePath: "CustomInfo.plist"` in `Package.swift` eingebunden werden, da die Playgrounds-UI nur Standard-Capabilities kennt. Zudem haben Apps, die direkt in Playgrounds auf dem iPad laufen, keinen normalen Homescreen-Icon-Start ohne Playgrounds-Umgebung. **Vorläufige Empfehlung:** `.swiftpm`-Format beibehalten (läuft in Playgrounds *und* Xcode identisch), im Alltag auf das eigene iPad per Xcode + SideStore/AltStore (kostenlose Apple-ID, automatische 7-Tage-Verlängerung im Hintergrund) installieren.
2. **S3 (PencilKit → `perfect-freehand`):** `PKStroke.path` liefert als `RandomAccessCollection<PKStrokePoint>` direkt `location`, `timeOffset`, `force`, `azimuth`, `altitude` und `size`. **Stolperfalle:** `PKStrokePoint.force` liegt beim Apple Pencil zwischen `0.0` und `~5.0` (nicht `0..1`!) und muss vor dem Packen durch ca. `3.0–5.0` geteilt und auf `[0, 1]` geklemmt werden; in `perfect-freehand` (`1.2.3`, **MIT**) muss zwingend `simulatePressure: false` gesetzt werden.
3. **S4 (`MediaRecorder` Safari & Chrome):** Laut W3C-Spezifikation enthält bei `mediaRecorder.start(30000)` **nur Chunk `seq = 0` den Container-Header** (EBML/WebM in Chrome bzw. `ftyp`/`moov` in Safari); Chunks ab `seq ≥ 1` sind isoliert **nicht** eigenständig decodierbar. Zudem trat nach macOS-Ruhezustand in älteren Chromium-Versionen der Bug `crbug.com/367915809` auf (`ondataavailable` friert nach Wakeup ein). **Vorläufige Empfehlung:** **Recorder-Rotation alle 30 s** (`stop()` + sofortiger Neustart auf demselben `MediaStream`) statt `timeslice`, damit jeder Chunk eine eigenständig gültige Audio-Datei mit eigenem Header ist.
4. **S5 (`mlx-whisper` large-v3-turbo):** `mlx-whisper` (`0.4.3`, **MIT**) erreicht mit `mlx-community/whisper-large-v3-turbo` (**MIT**, 809M Parameter, ~1,6 GB Download, ~3,5–4,5 GB RAM) auf M1–M4 einen Real-Time-Faktor von **ca. 12×–30×** (90 min Audio in **3–8 min**, deutlich unter dem 15-min-Ziel). **Stolperfalle:** Bekanntes Speicherwachstum bei `word_timestamps=True` über sehr lange Dateien (`cross_qk`-Matrizen) und Halluzinations-Schleifen in Vorlesungspausen → Audio vorab in 10–15-min-Abschnitte teilen und `condition_on_previous_text=False` + `hallucination_silence_threshold=2.0` setzen.
5. **Lizenz-Check (vgl. `docs/DRITTANBIETER.md`):** Alle untersuchten Bibliotheken für Phase 1 (`perfect-freehand`, `mlx-whisper`, `whisper.cpp`) stehen unter der **MIT-Lizenz** (kein Copyleft). Einziger Hinweis: **AltStore / SideStore** stehen unter **GPLv3 / AGPLv3**, sind aber reine Entwickler-/Installationswerkzeuge des Nutzers und kein Teil unseres ausgelieferten Codes.

---

## Spike S1 · iPad-App in Swift Playgrounds (`.swiftpm`) vs. Xcode (Weg B)

### 1. Fakten mit Quelle

| Prüfpunkt | Unterstützung in `.swiftpm` (Swift Playgrounds 4.5+ / iPadOS 17.5–18+) | Technische Umsetzung & Quelle |
|---|---|---|
| **Format & Projektstruktur** | **Ja.** App-Projekte (`.swiftpm`) nutzen das Modul `AppleProductTypes` mit `.iOSApplication(...)` in `Package.swift` (`swift-tools-version: 5.9` / `6.0`). Dasselbe Verzeichnis lässt sich ohne Konvertierung in **Swift Playgrounds (iPad & Mac)** und in **Xcode 16+** öffnen. | [Apple Developer: Building a SwiftUI app in Swift Playgrounds](https://developer.apple.com/documentation/swift_playgrounds/console-and-app-template) |
| **PencilKit mit zwei `PKCanvasView`-Ebenen** | **Ja.** `PKCanvasView` wird über `UIViewRepresentable` in SwiftUI eingebettet. Zwei übereinanderliegende `PKCanvasView`-Instanzen (unten Textmarker mit `isOpaque = false`, `backgroundColor = .clear`, oben Schrift) sind normales UIKit/PencilKit-API ohne besondere Entitlements. | [Apple Developer: PKCanvasView](https://developer.apple.com/documentation/pencilkit/pkcanvasview) |
| **`UIPencilInteraction` (Doppeltipp / Squeeze / Hover)** | **Ja.** Sowohl über UIKit (`UIPencilInteraction` + `UIPencilInteractionDelegate`: `pencilInteraction(_:didReceiveTap:)`, `pencilInteraction(_:didReceiveSqueeze:)`) als auch seit **iPadOS 17.5** direkt als native SwiftUI-View-Modifier `.onPencilDoubleTap { ... }` und `.onPencilSqueeze { phase in ... }` inkl. `@Environment(\.preferredPencilDoubleTapAction)`. | [Apple Developer: onPencilDoubleTap](https://developer.apple.com/documentation/swiftui/view/onpencildoubletap(perform:)), [onPencilSqueeze](https://developer.apple.com/documentation/swiftui/view/onpencilsqueeze(perform:)), [UIPencilInteraction](https://developer.apple.com/documentation/uikit/uipencilinteraction) |
| **Kamera (`AVFoundation` / `VisionKit`)** | **Ja.** In `Package.swift` wird unter `capabilities: [` der Eintrag `.camera(purposeString: "Tafel-Fotos in der Vorlesung aufnehmen")` gesetzt. Damit funktionieren `UIImagePickerController`, `AVCaptureSession` und `VNDocumentCameraViewController` (VisionKit Perspektivkorrektur). | [Apple Support: Add capabilities in Swift Playgrounds](https://support.apple.com/guide/playgrounds-ipad/apd192e54f28/ipados) |
| **WebSocket (`URLSessionWebSocketTask`)** | **Ja.** Ausgehende Verbindungen benötigen in `capabilities` `.outgoingNetworkConnections()`. `URLSession.shared.webSocketTask(with: url)` läuft auf `ws://<mac-ip>:4710/sync` ohne App-Transport-Security-(ATS)-Blockade, da ATS unter iOS für lokale IP-Adressen und `.local`-mDNS-Namen standardmäßig unverschlüsseltes HTTP/WS erlaubt (`NSAllowsLocalNetworking` ist für lokale Adressen ab iOS 14 implizit aktiv, kann aber zusätzlich in `CustomInfo.plist` stehen). | [Apple Developer: URLSessionWebSocketTask](https://developer.apple.com/documentation/foundation/urlsessionwebsockettask), [NSAllowsLocalNetworking](https://developer.apple.com/documentation/bundleresources/information_property_list/nsapptransportsecurity/nsallowslocalnetworking) |
| **Bonjour (`NWBrowser`) & Local-Network-Freigabe** | **Ja, aber nur mit `additionalInfoPlistContentFilePath`!** Seit iOS 14 verlangt `NWBrowser(for: .bonjour(type: "_studiengehirn._tcp", domain: nil), using: .tcp)` **zwingend** zwei Schlüssel in der `Info.plist`: `NSLocalNetworkUsageDescription` (String) und `NSBonjourServices` (`["_studiengehirn._tcp"]`). Die grafischen App-Einstellungen von Swift Playgrounds bieten für `NSBonjourServices` **kein** UI-Feld. Lösung in `.swiftpm`: Im Paket-Root eine Datei `CustomInfo.plist` anlegen und in `Package.swift` bei `.iOSApplication(...)` den Parameter `additionalInfoPlistContentFilePath: "CustomInfo.plist"` übergeben. | [Apple Developer: NWBrowser](https://developer.apple.com/documentation/network/nwbrowser), [Apple TN3179 / Local Network Privacy FAQ](https://developer.apple.com/forums/thread/663858) |
| **Hintergrund & Speichern beim Beenden** | **Ja.** Über `@Environment(\.scenePhase)` (`.inactive`, `.background`) und `UIApplication.willResignActiveNotification` kann die App sofort `PKDrawing.dataRepresentation()` und die Ausgangswarteschlange per `.atomic`-Write ins `Application Support`-Verzeichnis schreiben; mit `UIApplication.shared.beginBackgroundTask` bleiben beim App-Wechsel ca. 30 s für ausstehende WebSocket-Acks. | [Apple Developer: ScenePhase](https://developer.apple.com/documentation/swiftui/scenephase) |
| **Verteilung auf das eigene iPad ohne Mac (Weg A)** | In Swift Playgrounds auf dem iPad läuft die App direkt über den „Run"-Knopf in einer eigenen Vollbild-Vorschau. Eine Installation als eigenständiges Homescreen-Icon *ohne* bezahlten Apple-Developer-Account ($99/Jahr, App Store Connect / TestFlight) ist aus Swift Playgrounds auf dem iPad allein **nicht** möglich. Außerdem wird beim Start über den Playgrounds-Runner je nach Version der Container-Pfad bei Strukturänderungen gelegentlich zurückgesetzt. | [Apple Support: Share or submit an app in Swift Playgrounds](https://support.apple.com/guide/playgrounds-ipad/apd78c5d9022/ipados) |
| **Weg B: Xcode + kostenlose Apple-ID / AltStore / SideStore** | **Kosten:** 0 € (normale Apple-ID reicht als „Personal Team").<br>**Limits von Apple:**<br>1. **7-Tage-Signatur:** Das Zertifikat läuft nach exakt 7 Tagen ab. Die App startet danach nicht mehr, **aber der App-Daten-Container (`Documents/` / `Application Support/`) bleibt auf dem iPad vollständig erhalten**, solange man die App nicht löscht, sondern nur über Xcode/AltStore/SideStore neu signiert.<br>2. **Max. 3 aktive Sideload-Apps** gleichzeitig pro Gerät.<br>3. **Max. 10 App-IDs pro 7 Tage**.<br>**Aufwand mit Xcode allein:** Einmal pro Woche Mac + iPad kurz per USB oder WLAN-Debugging in Xcode verbinden (`⌘R`, dauert ~15 s).<br>**Aufwand mit AltStore (`AltServer` auf dem Mac, GPLv3) oder SideStore (AGPLv3):** Einem der Tools die aus Xcode exportierte `.ipa` geben; AltStore erneuert die 7-Tage-Signatur automatisch im Hintergrund, sobald Mac und iPad im selben WLAN sind (SideStore sogar ohne Mac über lokales WireGuard/Lockdown-Loopback). | [AltStore Docs: Apple ID Limits](https://faq.altstore.io/getting-started/how-to-install-altstore-macos), [SideStore Documentation](https://sidestore.io/) |

### 2. Unsicher / Vermutung (im Spike S1 zu verifizieren)
- **Unsicher (S1-U1):** Ob Swift Playgrounds auf dem iPad die Zeile `additionalInfoPlistContentFilePath: "CustomInfo.plist"` in `Package.swift` überschreibt, wenn man später in der grafischen Playgrounds-Oberfläche das App-Icon oder den Namen ändert (bekannte Warnung im Header von `Package.swift`: `// WARNING: This file is automatically generated and may be overwritten`).
- **Unsicher (S1-U2):** Ob `VNDocumentCameraViewController` (VisionKit Dokumenten-Scanner für Tafel-Fotos, `F-INK-06`) innerhalb des Swift-Playgrounds-In-App-Runners auf dem iPad ohne Crash startet oder ob dort nur `AVCaptureSession` / `UIImagePickerController` stabil läuft (als Xcode-Build auf dem Gerät funktioniert `VNDocumentCameraViewController` sicher).

### 3. Stolperfallen
1. **Fehlender Local-Network-Dialog (`-72008` PolicyDenied):** Wenn `NSBonjourServices` nicht exakt `["_studiengehirn._tcp"]` enthält, liefert `NWBrowser` sofort `NWError.dns(DNSServiceErrorType(kDNSServiceErr_PolicyDenied))` (`-72008`), **ohne** dass iPadOS jemals den Berechtigungsdialog anzeigt.
2. **Zwei `PKCanvasView` übereinander blockieren Touches:** Wenn beide Ebenen `isUserInteractionEnabled = true` haben, fängt immer die obere Ebene alle Stift-Events ab. **Lösung:** Nur die jeweils aktive Ebene (beim Stift/Füller/Bleistift die obere `ink`-Ebene, beim Textmarker oder „nur Textmarker radieren" die untere `highlight`-Ebene) bekommt `isUserInteractionEnabled = true` und `becomeFirstResponder()`, oder man nutzt ein einziges `PKCanvasView` für die Eingabe und sortiert beim Zeichnen Textmarker-Striche im `PKDrawing.strokes`-Array vor die Schrift-Striche (Option im Spike vergleichen!).
3. **Playgrounds-Sandbox vs. echte App-Installation:** In Swift Playgrounds auf dem iPad muss man zum Starten erst Playgrounds öffnen und auf ▶ tippen (verletzt fast das 10-Sekunden-Ziel `Z7` aus dem Kaltstart). Über Xcode („Run" auf das per USB/WLAN gekoppelte iPad) landet die exakt gleiche `.swiftpm`-App als echtes Icon auf dem iPad-Homescreen!

### 4. Konkreter Testplan für den Owner (Dauer: ca. 90 Minuten)

1. **`.swiftpm`-Minimalpaket auf dem Mac anlegen (20 min):**
   - Ordner `StudienGehirnSpike.swiftpm` mit `Package.swift` und `CustomInfo.plist` (`NSLocalNetworkUsageDescription` + `NSBonjourServices: ["_studiengehirn._tcp"]` + `NSCameraUsageDescription`) erstellen.
   - Eine Test-View mit:
     - zwei gestapelten `PKCanvasView` (Umschalter „Stift" vs. „Textmarker"),
     - `.onPencilDoubleTap` und `.onPencilSqueeze` (Log-Ausgabe auf dem Bildschirm),
     - Button „Tafel-Foto" (`VNDocumentCameraViewController`),
     - Button „Bonjour + WebSocket-Test" (`NWBrowser` sucht `_studiengehirn._tcp` und verbindet `URLSessionWebSocketTask`),
     - Speichern von `drawing.dataRepresentation()` bei `scenePhase == .background`.
2. **Test A – Xcode Direkt-Deployment auf das iPad (30 min):**
   - `StudienGehirnSpike.swiftpm` in Xcode öffnen, unter *Signing & Capabilities* das kostenlose „Personal Team" (eigene Apple-ID) wählen, iPad anschließen und mit `⌘R` installieren.
   - Auf dem iPad prüfen:
     - [ ] App-Icon auf dem Homescreen startet in < 2 s.
     - [ ] Doppeltipp (und ggf. Squeeze) am Apple Pencil schaltet Werkzeug um.
     - [ ] Textmarker malt sichtbar *hinter* schwarzer Schrift.
     - [ ] Kamera-Button öffnet den Scanner und liefert ein Bild zurück.
     - [ ] Bonjour-Button löst den iPadOS-Dialog „Lokales Netzwerk" aus und findet den Mac (`dns-sd -R "TestMac" _studiengehirn._tcp local 4710` im Mac-Terminal starten).
     - [ ] App per Wisch nach oben abschießen und neu öffnen → gezeichnete Striche sind noch da.
3. **Test B – Swift Playgrounds auf dem iPad (20 min):**
   - `StudienGehirnSpike.swiftpm` per AirDrop/iCloud Drive auf das iPad in Swift Playgrounds öffnen und starten.
   - Prüfen, ob `CustomInfo.plist` erhalten bleibt und Bonjour + Kamera auch im Playgrounds-Runner funktionieren.
4. **Entscheidung in `docs/entscheidungen/S1.md` festhalten (10 min).**

### 5. Vorläufige Empfehlung zu S1
**Hybrid-Weg (A+B mit derselben `.swiftpm`-Codebasis):**
Das Projekt wie in `10-UMSETZUNG.md` geplant als **`apps/ipad/StudienGehirn.swiftpm`** anlegen. Entwickelt und gebaut wird auf dem Mac, installiert wird auf dem iPad über **Xcode (kostenloses Personal Team)** bzw. **AltStore** für die automatische wöchentliche Signatur-Erneuerung im Hintergrund. So hat man eine reine `.swiftpm`-Struktur (kein schwerfälliges `.xcodeproj`), aber ein echtes Homescreen-Icon auf dem iPad, volle `CustomInfo.plist`-Unterstützung für Bonjour und einen stabilen Daten-Container.

---

## Spike S3 · PencilKit → neutrales Strich-Format → `perfect-freehand` im Browser

### 1. Fakten mit Quelle

- **Punkte aus `PKDrawing` / `PKStroke` auslesen (iOS 14+ / Swift 6):**
  - `pkDrawing.strokes` liefert `[PKStroke]`.
  - Jeder `PKStroke` hat:
    - `ink: PKInk` mit `ink.inkType` (`.pen`, `.pencil`, `.marker`, `.monoline`, `.fountainPen`, `.watercolor`, `.crayon`) und `ink.color: UIColor`.
    - `transform: CGAffineTransform` (`a, b, c, d, tx, ty` → die 6 Werte für `stroke.transform`).
    - `path: PKStrokePath` (implementiert `RandomAccessCollection<PKStrokePoint>`), mit `path.creationDate: Date`.
    - `renderBounds: CGRect` (liefert direkt `bbox: [origin.x, origin.y, size.width, size.height]`).
  - Jeder `PKStrokePoint` in `stroke.path` liefert:
    - `location: CGPoint` (`x`, `y` in Punkt, noch **vor** Anwendung von `stroke.transform`! Transformierte Koordinate ist `point.location.applying(stroke.transform)`).
    - `timeOffset: TimeInterval` (Sekunden als `Double` seit `path.creationDate` → `dt = Float32(point.timeOffset * 1000.0)`).
    - `force: CGFloat` (Druck des Apple Pencil; **Wertebereich bei Apple Pencil ist ca. `0.0` bis `5.0`**, bei Finger-Input konstant `1.0`).
    - `azimuth: CGFloat` (Richtungswinkel in Radiant, `-π` bis `π`).
    - `altitude: CGFloat` (Neigungswinkel zur Oberfläche in Radiant, `0` = flach bis `π/2` = senkrecht).
    - `size: CGSize` (Breite/Höhe des Punkts in pt).
  - * Hinweis zur Punkt-Dichte:* `stroke.path` speichert B-Spline-Kontrollpunkte. Für eine gleichmäßige Punktfolge (oder für das direkte Rendern im Web) bietet `PKStrokePath` zusätzlich `interpolatedPoints(in: strideBy: .distance(2.0))` bzw. `.time(...)`. Das Auslesen der direkten `PKStrokePath`-Punkte (Index `0..<path.count`) reicht für `perfect-freehand` aus und hält die Punktanzahl bei 40–150 Punkten pro Strich.
  - **Quelle:** [Apple Developer: PKStroke](https://developer.apple.com/documentation/pencilkit/pkstroke), [PKStrokePath](https://developer.apple.com/documentation/pencilkit/pkstrokepath), [PKStrokePoint](https://developer.apple.com/documentation/pencilkit/pkstrokepoint).

- **`perfect-freehand` Bibliothek (Web-App):**
  - **Aktuelle Version:** `1.2.3` (npm: `perfect-freehand`, 0 Runtime-Dependencies, ~4 KB gzipped).
  - **Lizenz:** **MIT License** (Autor: Steve Ruiz; unkritisch für `docs/DRITTANBIETER.md`).
  - **Funktionsweise:** `getStroke(points, options)` nimmt ein Array `[[x, y, pressure], ...]` (`pressure` in `0.0..1.0`) und gibt ein Array von 2D-Polygon-Umrisspunkten `[[x, y], ...]` zurück, das als `<path d="..." fill={color} />` in SVG oder per `Path2D` auf ein HTML5-`<canvas>` gezeichnet wird.
  - **Wichtigste Option bei echten Apple-Pencil-Daten:** `simulatePressure: false`! Standardmäßig ist `simulatePressure: true`, wodurch `perfect-freehand` den übergebenen Druckwert ignoriert und Druck künstlich aus der Schreibgeschwindigkeit berechnet.
  - **Quelle:** [GitHub: steveruizok/perfect-freehand (v1.2.3, MIT)](https://github.com/steveruizok/perfect-freehand), [npm: perfect-freehand](https://www.npmjs.com/package/perfect-freehand).

- **Empfohlene `perfect-freehand`-Parameter je PencilKit-Werkzeug:**

| PencilKit `inkType` (`stroke.tool`) | `size` | `thinning` | `smoothing` | `streamline` | `simulatePressure` | Besonderheit beim Rendern (Canvas / SVG) |
|---|---|---|---|---|---|---|
| **`pen`** (Kugelschreiber/Fineliner) | `stroke.width` | `0.35` | `0.5` | `0.4` | `false` | Leicht druckabhängig, runde Endkappen (`start.cap = true`, `end.cap = true`) |
| **`monoline`** | `stroke.width` | `0.0` | `0.5` | `0.5` | `false` | Konstante Strichstärke (`thinning: 0`) |
| **`fountain`** (Füller) | `stroke.width * 1.15` | `0.7` | `0.5` | `0.45` | `false` | Starke Druckvariation (`thinning: 0.7`), `start.taper: 4`, `end.taper: 4` |
| **`pencil`** (Bleistift) | `stroke.width` | `0.25` | `0.3` | `0.2` | `false` | Leicht reduzierte Deckkraft (`opacity: 0.85`), breiter bei flachem Neigungswinkel (`size * (1 + 0.6 * cos(altitude))`) |
| **`marker`** (Textmarker, Ebene `highlight`) | `stroke.width` | `0.0` | `0.6` | `0.6` | `false` | Auf der unteren Ebene (`highlight`), `globalCompositeOperation = 'multiply'` bzw. `opacity: 0.35`, flache Enden (`start.cap = false`, `end.cap = false`) |

### 2. Unsicher / Vermutung (im Spike S3 zu kalibrieren)
- **Unsicher (S3-U1):** Die exakte Skalierung zwischen `PKStrokePoint.size.width` (in PencilKit bereits druckmoduliert) und dem Basis-Durchmesser `size` in `perfect-freehand`. In PencilKit hat der Standard-Stift eine Basisbreite von ca. 2–12 pt, während `point.size` den bereits mit `force` und `altitude` verrechneten Wert pro Punkt enthält. Im Spike muss entschieden werden, ob `stroke.width` der Mittelwert von `point.size.width` ist (mit `thinning: 0`) oder die Werkzeug-Basisbreite (mit `force / 3.5` und `thinning > 0`).

### 3. Stolperfallen
1. **`PKStrokePoint.force` ist NICHT auf `0..1` normiert:** Apple Pencil liefert für normales Schreiben `force ≈ 0.8–1.8` und bei festem Drücken bis `~4.5–5.0`. Übergibt man `force` ungefiltert an `perfect-freehand` (das `0..1` erwartet), entstehen extrem dicke „Klecks"-Striche. **Lösung beim Packen auf dem iPad:** `let normalizedForce = Float(min(max(point.force / 3.5, 0.0), 1.0))`.
2. **`stroke.transform` und `point.location`:** Wenn ein Strich auf dem iPad mit dem Lasso verschoben oder skaliert wird (`F-INK-07`), ändert PencilKit **nicht** die einzelnen `point.location`-Werte im `PKStrokePath`, sondern nur die Matrix `stroke.transform`! Die Web-App muss beim Rendern entweder die SVG/Canvas-Gruppe mit `transform="matrix(a,b,c,d,e,f)"` versehen oder jeden Punkt mit `transform` multiplizieren.
3. **Radierer im Pixelmodus (`.bitmap`):** Wenn der Nutzer einen Strich mit dem Pixel-Radierer in der Mitte durchteilt, ersetzt PencilKit im `PKDrawing.strokes`-Array den einen alten `PKStroke` durch zwei neue `PKStroke`-Objekte (beide behalten dieselbe `path.creationDate`!). Deshalb muss der Fingerabdruck (`08 §4.3`) zwingend `creationDate + path.count + first3Points` kombinieren.

### 4. Saubere Messung der ≤ 1 s Spiegelung & Testplan (Dauer: ca. 2 Stunden)

1. **Uhr-Synchronisation für die Latenzmessung:**
   - Da Core und iPad laut `08 §2.1` bereits den Ping-Pong-Uhrabgleich (`clock_offset_ms`, Genauigkeit < 5 ms im selben WLAN) durchführen, wird die Ende-zu-Ende-Latenz direkt im Browser gemessen:
     - Beim Absetzen des Stifts (`canvasViewDrawingDidChange` auf dem iPad) setzt das iPad `t_pen_up = Date().timeIntervalSince1970 * 1000 + clock_offset_ms` in die Operation `stroke.add` (`at`).
     - In der Web-App wird unmittelbar nach dem `requestAnimationFrame`-Render-Aufruf des neuen Strichs `t_rendered = Date.now()` gemessen.
     - **Spiegelungs-Latenz:** `Δt = t_rendered - op.at`.
   - Zusätzlich optischer Kontrollcheck: iPhone-Kamera im **Slo-Mo-Modus (240 fps, 4,16 ms pro Frame)** filmt gleichzeitig iPad-Display und MacBook-Display beim Absetzen eines Strichs → Frames zählen zwischen „Stift hebt ab" und „Strich erscheint am Mac" (Ziel: < 240 Frames = 1,0 s; Erwartung im lokalen WLAN: **30–120 ms** = 8–30 Frames).
2. **Qualitätsvergleich (10 min Testschrift):**
   - Auf einer A4-Seite in der Spike-App 1 Satz Schreibschrift, 1 Formel (`∑`, Bruch, Index), 1 ER-Diagramm (Kasten, Raute, Pfeil) und 2 Textmarker-Hervorhebungen schreiben.
   - Seite auf dem iPad per `PKDrawing.image(from: pageBounds, scale: 2.0)` als PNG exportieren und neben einen Screenshot des Browser-Canvas legen.
   - Parameter `thinning`, `smoothing`, `streamline` und den Normierungsfaktor für `force` feinjustieren, bis Strichdicke und Kurvenverlauf übereinstimmen.

### 5. Vorläufige Empfehlung zu S3
`perfect-freehand` (`1.2.3`, MIT) auf einem HTML5-`<canvas>` (bzw. 2 Canvas-Ebenen analog zum iPad: unten `highlight`, oben `ink`) mit `simulatePressure: false` und `force_norm = clamp(force / 3.5, 0, 1)` einsetzen. Das Binärformat aus `08 §4.2` (24 Bytes pro Punkt, ~2 KB pro Strich) überträgt sich im lokalen WebSocket in < 5 ms, sodass die ≤ 1-s-Anforderung mit großem Puffer (typisch < 100 ms) eingehalten wird.

---

## Spike S4 · Audioaufnahme in Safari und Chrome (`MediaRecorder`)

### 1. Fakten mit Quelle

- **Unterstützte MIME-Typen (`MediaRecorder.isTypeSupported(...)`):**
  - **Chrome (macOS, Blink):**
    - `audio/webm;codecs=opus` (**Standard und empfohlen**, 48 kHz, variable oder konstante Bitrate z. B. `audioBitsPerSecond: 48000`).
    - `audio/mp4;codecs=mp4a.40.2` (AAC in fMP4, ab Chrome 126+ unterstützt).
  - **Safari (macOS, WebKit):**
    - `audio/mp4` bzw. `audio/mp4;codecs=mp4a.40.2` (**Standard in Safari**, erzeugt fragmentiertes MP4 / AAC).
    - `audio/webm;codecs=opus` wird in neueren Safari-Versionen (ab Safari 18.4 / macOS Sequoia) teilweise unterstützt, `audio/mp4` bleibt in WebKit aber der stabilste native Pfad.
  - **Quelle:** [MDN: MediaRecorder.isTypeSupported()](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static), [Can I use: MediaRecorder](https://caniuse.com/mediarecorder).

- **Sind Blobs mit `timeslice` ab dem zweiten Chunk (`seq ≥ 1`) eigenständig decodierbar?**
  - **Nein (belegt durch W3C-Spezifikation und Browser-Implementierung)!**
  - Wenn `mediaRecorder.start(30000)` aufgerufen wird, schneidet der Browser einen einzigen fortlaufenden Container-Bytestrom alle 30 s an einer Cluster-/Fragment-Grenze durch:
    - **Chunk `seq = 0`** enthält den **Container-Header** (bei WebM den `EBML`-Header + `Segment` + `Tracks`-Element; bei MP4 die `ftyp`- und `moov`-Boxen) plus die ersten 30 s Audiodaten.
    - **Chunks `seq ≥ 1`** enthalten **nur noch Roh-Fragmente** (bei WebM bloße `Cluster`-Elemente ab Byte `0x1F43B675`; bei Safari-MP4 bloße `moof` + `mdat`-Boxen **ohne** `ftyp`/`moov`).
  - **Folge für unsere Architektur (`08 §1` & `08 §7`):**
    - Versucht man, `chunk/1.webm` oder `chunk/1.mp4` einzeln mit `ffmpeg -i 1.webm` zu öffnen, bricht `ffmpeg` mit `EBML header parsing failed` bzw. `moov atom not found` ab!
    - Fehlt Chunk `seq = 0` (oder gibt es durch einen kurzen Verbindungsabbruch / Tab-Reload eine Lücke zwischen zwei Chunks), lassen sich nachfolgende `timeslice`-Chunks ohne den exakt passenden Initial-Header nicht sauber mit `ffmpeg -f concat` zusammenfügen, um Stille zwischen ihnen einzufügen.
  - **Quelle:** [W3C MediaStream Recording Spec – `ondataavailable`](https://www.w3.org/TR/mediastream-recording/#dom-mediarecorder-ondataavailable), [Chromium Issue 40482588: MediaRecorder chunks are not standalone webm files](https://issues.chromium.org/issues/40482588).

- **Verhalten bei Hintergrund-Tab, Screen Wake Lock API, Ruhezustand und zugeklapptem Deckel:**
  - **Hintergrund-Tab (anderer Browser-Tab oder anderes Programm im Vordergrund):** Sowohl Chrome als auch Safari nehmen Audio im Hintergrund-Tab ungedrosselt weiter auf, **solange ein aktiver `MediaStream` (rotes Mikrofon-Symbol im Tab/Menüleiste) läuft**. Browser nehmen Tabs mit aktivem Audio-Recording von der Timer-Drosselung aus (wichtig: den 30-s-Timer trotzdem nicht allein über ungenaues `setInterval` steuern oder die Abweichung über `performance.now()` / `AudioContext.currentTime` messen).
  - **Screen Wake Lock API (`navigator.wakeLock.request('screen')`):**
    - Wird von Chrome (ab v84) und Safari (ab Safari 16.4 / macOS Ventura+, nach Behebung von [WebKit Bug 205104](https://bugs.webkit.org/show_bug.cgi?id=205104)) unterstützt.
    - **Wichtig:** Ein Screen Wake Lock verhindert das Abdunkeln/Einschlafen des Macs **nur, solange der Browser-Tab sichtbar (`document.visibilityState === 'visible'`) und der Laptop-Deckel offen ist**! Sobald der Nutzer in ein anderes Vollbild-Fenster oder einen anderen Tab wechselt, gibt der Browser den Screen Wake Lock automatisch frei (`release`-Event) und muss bei `visibilitychange` neu angefordert werden ([MDN: Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)).
    - **Besserer Schutz auf dem Mac (da unser Core ohnehin lokal auf dem Mac läuft!):** Sobald eine Session im Zustand `laeuft` ist (`POST /sessions/{id}/start`), kann der **Core-Prozess** auf dem Mac einfach `caffeinate -di -w <core_pid>` als Kindprozess starten! Das ist ein eingebautes macOS-Bordmittel, funktioniert unabhängig vom Browser-Tab und verhindert den Idle-Sleep des Macs zu 100 % zuverlässig, solange der Deckel offen ist.
  - **Zugeklappter Deckel (Clamshell Sleep):** Wird das MacBook ohne externen Monitor zugeklappt, erzwingt macOS den Hardware-Sleep. Das Mikrofon wird vom OS stummgeschaltet und `MediaStreamTrack` feuert `mute` / `ended`.

- **Bekannte Browser-Bugs mit Links:**
  1. **[Chromium Issue 367915809 (ehemals crbug.com/40876732)](https://issues.chromium.org/issues/367915809):** *„MediaRecorder ondataavailable not called after exiting sleep, oversized chunk generated on stop"* – Nach dem Aufwachen aus dem macOS-Ruhezustand feuerte `MediaRecorder` bei Nutzung von `timeslice` keine periodischen `ondataavailable`-Events mehr, sondern staute alles bis zum `.stop()`-Aufruf an (gefixt in neueren Chrome-Versionen ab ~Chrome 132+, zeigt aber die Fragilität von `timeslice` über System-Sleep hinweg).
  2. **[Chromium Issue 40482563 (crbug.com/642012)](https://issues.chromium.org/issues/40482563):** WebM-Dateien aus `MediaRecorder` haben im Header keine Gesamtdauer (`Duration = Infinity`), weshalb ohne nachträgliches Remuxing/Transcodieren durch `ffmpeg` in Playern nicht gespult werden kann.
  3. **[WebKit Bug 202233](https://bugs.webkit.org/show_bug.cgi?id=202233):** Historische Probleme mit `timeslice` in Safari/WebKit, bei denen Intervalle ungenau waren.

### 2. Unsicher / Vermutung
- **Unsicher (S4-U1):** Ob beim **Recorder-Rotations-Verfahren** (alle 30 s `recorderA.stop()` und gleichzeitig `recorderB.start()` auf demselben `MediaStream`) in Safari ein hörbarer Knackser oder ein Versatz von 10–30 ms an der Chunk-Grenze entsteht (in Chrome mit zwei überlappenden `MediaRecorder`-Instanzen auf demselben `MediaStream` ist der Übergang nahtlos).

### 3. Stolperfallen & Architekturentscheidung: `timeslice` vs. Recorder-Rotation

Wir haben zwei saubere technische Wege, damit `audio.finalize` auch bei fehlenden Chunks (Lücken) zuverlässig funktioniert:

| Variante | Funktionsweise | Vorteil | Nachteil |
|---|---|---|---|
| **Variante 1: Recorder-Rotation alle 30 s (Empfehlung)** | Der `MediaStream` vom Mikrofon bleibt durchgehend offen. Alle 30 s wird ein neuer `MediaRecorder(stream)` gestartet (`recorderNext.start()`) und direkt danach der bisherige gestoppt (`recorderCurr.stop()`). | **Jeder einzelne Chunk (`0.webm`, `1.webm`, … bzw. `.mp4`) ist eine vollständig gültige, eigenständig abspielbare Datei mit eigenem Header!** Fällt Chunk 0 oder Chunk 5 aus, kann `ffmpeg` alle übrigen Chunks problemlos einzeln lesen und Lücken exakt mit Stille füllen. Umgeht außerdem `crbug.com/367915809`. | Minimaler Overhead beim Wechsel alle 30 s (im Spike S4 auf Nahtlosigkeit prüfen). |
| **Variante 2: `timeslice(30000)` + Binär-Konkatenation pro zusammenhängendem Lauf** | `recorder.start(30000)`. Bei jedem Verbindungsabbruch / Wakeup wird der Recorder neu gestartet (neuer Lauf mit neuem Header-Chunk). | Kein Recorder-Wechsel im Normalbetrieb. | Chunks `seq ≥ 1` sind **nicht** einzeln mit `ffmpeg` lesbar, sondern müssen vor dem `ffmpeg`-Aufruf erst auf Dateiebene (`cat 0.webm 1.webm 2.webm > run1.webm`) an ihren zugehörigen Chunk 0 gehängt werden. Geht Chunk 0 verloren, ist der gesamte Lauf unlesbar! |

#### Konkreter `ffmpeg`-Befehl für `audio.finalize` (Zusammenfügen + Lücken als Stille + AAC-Transcodierung)

Wenn jeder Chunk (durch Variante 1: Recorder-Rotation) eine eigenständige Datei ist und wir z. B. Chunk 0 (`start_ms = 0`, `duration_ms = 30000`) und Chunk 2 (`start_ms = 65000`, `duration_ms = 30000`, also **5,0 s Lücke** zwischen `30000` und `65000`) haben, erzeugt der Worker eine `concat.txt` und nutzt den eingebauten `anullsrc`-Filter für Lücken (oder den `concat`-Filter):

```bash
# Schritt 1: Falls eine Lücke (z. B. 5.0 s) zwischen zwei Chunks liegt, Stille-Segment erzeugen:
ffmpeg -f lavfi -i anullsrc=r=48000:cl=mono -t 5.000 -c:a aac -b:a 64k silence_gap_1.m4a

# Schritt 2: Alle Chunks (egal ob .webm/Opus oder .mp4/AAC) und etwaige Stille-Segmente
# über eine filter_complex-Pipeline (oder nach einheitlicher Normierung) zu full.m4a (AAC 48 kHz mono) mit Faststart transcodieren:
ffmpeg -y \
  -i chunks/0.webm \
  -f lavfi -t 5.000 -i anullsrc=r=48000:cl=mono \
  -i chunks/2.webm \
  -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[outa]" \
  -map "[outa]" \
  -c:a aac -b:a 64k -ar 48000 -ac 1 \
  -movflags +faststart \
  full.m4a
```
*(Hinweis: Bei einer lückenlosen Aufnahme ohne fehlende Chunks mit `timeslice` reicht `cat chunks/*.webm > temp_all.webm && ffmpeg -y -i temp_all.webm -c:a aac -b:a 64k -ar 48000 -ac 1 -movflags +faststart full.m4a`.)*

### 4. Konkreter Testplan für den Owner (Dauer: ca. 2 Stunden)

1. **Test-Skript für Spike S4 starten (15 min):**
   - Kleine Testseite im Browser öffnen, die wahlweise im Modus **„Recorder-Rotation (30 s)"** und **„timeslice (30 s)"** aufnimmt und Chunks auf Platte speichert.
2. **Prüfung der Einzel-Dekodierbarkeit (15 min):**
   - Je 3 Chunks (90 s) in Chrome und Safari aufnehmen.
   - Im Terminal `ffprobe chunk_0` und `ffprobe chunk_1` ausführen:
     - Bestätigen, dass `chunk_1` bei `timeslice` ohne `chunk_0` fehlschlägt, während bei Recorder-Rotation `chunk_0`, `chunk_1` und `chunk_2` alle gültig sind und der zusammengesetzte `full.m4a` an den 30-s-Grenzen keinen hörbaren Aussetzer hat.
3. **Hintergrund-Tab & Wake-Lock / `caffeinate`-Test (60 min nebenbei):**
   - Aufnahme starten (mit aktivem `caffeinate -di` vom lokalen Server + `navigator.wakeLock`), Browser-Tab in den Hintergrund legen und 60 min normal am Mac arbeiten.
   - Prüfen, ob alle 120 Chunks lückenlos und mit plausiblem Pegel ankommen.
4. **Deckel-zu-Simulation (10 min):**
   - Während laufender Aufnahme den Mac für 30 s in den Ruhezustand versetzen (Deckel zu) und wieder öffnen.
   - Prüfen, dass die Web-App das `mute`/`ended`-Event bzw. den Zeitsprung erkennt, sofort einen neuen Chunk-Strom mit neuem `start_ms` startet (`F-SES-05`) und `ffmpeg` die 30-s-Lücke exakt als 30 s Stille in `full.m4a` einfügt.

### 5. Vorläufige Empfehlung zu S4
1. **Recorder-Rotation alle 30 s** verwenden (jeder Chunk ist eine eigenständige `.webm`- bzw. `.mp4`-Datei mit vollem Header).
2. Den **Ruhezustand des Macs während einer laufenden Session direkt vom Core aus per `caffeinate -di`** unterbinden (ergänzend zur Screen Wake Lock API im Browser), damit auch ein Tab-Wechsel niemals zum Einschlafen des Macs führt.
3. **Chrome als primär empfohlenen Browser** im Einrichtungsdialog nennen, Safari als voll unterstützten Zweitbrowser.

---

## Spike S5 · Lokale Transkription mit `mlx-whisper` (`large-v3-turbo`)

### 1. Fakten mit Quelle

- **`mlx-whisper` Paket & Lizenz:**
  - **Aktuelle PyPI-Version:** `mlx-whisper 0.4.3` (Teil von Apples offizieller `ml-explore/mlx-examples`-Sammlung, nutzt Apples MLX-Framework auf Metal/GPU).
  - **Lizenz Software (`mlx-whisper` & `mlx`):** **MIT License** (unkritisch für `docs/DRITTANBIETER.md`).
  - **Lizenz Modellgewichte (`openai/whisper-large-v3-turbo` / `mlx-community/whisper-large-v3-turbo`):** **MIT License** (809 Mio. Parameter; Encoder: 32 Layer wie `large-v3`, Decoder: von 32 auf **4 Layer** reduziert).
  - **Installation per `uv`:**
    ```bash
    uv add mlx-whisper
    ```
    *(Voraussetzung auf dem System: `ffmpeg` im `PATH`, z. B. via `brew install ffmpeg`.)*
  - **Quelle:** [PyPI: mlx-whisper](https://pypi.org/project/mlx-whisper/), [Hugging Face: mlx-community/whisper-large-v3-turbo](https://huggingface.co/mlx-community/whisper-large-v3-turbo), [OpenAI Whisper v20240930 Release (turbo)](https://github.com/openai/whisper/discussions/2363).

- **Benchmarks für 90 min Audio auf Apple Silicon (M1 / M2 / M3 / M4):**
  - `large-v3-turbo` ist durch die Reduktion von 32 auf 4 Decoder-Schichten bei autoregressiver Dekodierung **ca. 2,5× bis 3,5× schneller** als das volle `large-v3`-Modell.
  - Gemessene Real-Time-Faktoren (RTF = Audio-Dauer / Rechenzeit) mit `mlx-whisper` (`fp16`):

| Chip | Real-Time Speedup (`large-v3-turbo`, ohne `word_timestamps`) | Dauer für **90 min Vorlesung** (ohne `word_timestamps`) | Dauer für **90 min Vorlesung** (**mit `word_timestamps=True`**) |
|---|---|---|---|
| **M1 (Basis, 8 GB / 16 GB)** | ~10×–14× Echtzeit | **~6,5 – 9 min** | **~9 – 13 min** |
| **M2 (Basis)** | ~12×–16× Echtzeit | **~5,5 – 7,5 min** | **~7,5 – 11 min** |
| **M3 (Basis)** | ~14×–18× Echtzeit | **~5 – 6,5 min** | **~6,5 – 9 min** |
| **M4 (Basis) / M1–M4 Pro & Max** | ~18×–30×+ Echtzeit | **~3 – 5 min** | **~4 – 7 min** |

  - **Ergebnis:** Selbst auf einem Basis-MacBook-Air M1 inklusive `word_timestamps=True` bleibt `large-v3-turbo` **unter dem Zielwert von ≤ 15 min** aus `09-NFA.md` §1!
  - **Quellen:** [OpenAI Whisper Turbo Speed Discussion #2363](https://github.com/openai/whisper/discussions/2363), [ggerganov/whisper.cpp Apple Silicon Benchmarks](https://github.com/ggerganov/whisper.cpp/issues/89), [ml-explore/mlx-examples Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper).

- **Speicherbedarf, Wort-Zeitstempel & Deutsch-Qualität:**
  - **Speicherbedarf:**
    - Downloadgröße (FP16): **~1,6 GB** (`mlx-community/whisper-large-v3-turbo`; optional 4-bit/8-bit quantisiert `~0,8 GB`, FP16 wird für beste Qualität empfohlen).
    - Unified-Memory-(RAM-)Bedarf zur Laufzeit: **ca. 3,2 – 4,5 GB** (passt problemlos auf ein 8-GB- oder 16-GB-MacBook).
  - **Wort-Zeitstempel (`word_timestamps=True`):**
    - Direkt in `mlx_whisper.transcribe(..., word_timestamps=True)` unterstützt (nutzt Dynamic Time Warping auf den Cross-Attention-Gewichten).
    - Jedes Segment enthält `words: [{"word": "...", "start": 12.34, "end": 12.78, "probability": 0.94}]`.
  - **Deutsch-Qualität & gemischte Deutsch/Englisch-Vorlesungen:**
    - Die Word Error Rate (WER) von `large-v3-turbo` auf Deutsch (Fleurs / CommonVoice DE) liegt innerhalb von **~0,5–1,0 Prozentpunkten** des großen `large-v3`-Modells und ist deutlich besser als `medium` oder `distil-whisper` (da `distil-whisper` primär englisch ist, während `large-v3-turbo` alle 99 Sprachen von `large-v3` behält!).
    - Bei deutschen Wirtschaftsinformatik-Vorlesungen mit englischen Fachbegriffen (*„Primary Key"*, *„Third Normal Form"*, *„MapReduce"*) verhindert `initial_prompt` (Folientitel + Fachbegriffe laut `05 §P4`) zuverlässig falsche Eindeutschungen.

- **Alternative: `whisper.cpp` (mit Metal / Core ML):**
  - **Aktuelle Version:** `v1.9.5` (C/C++, Python-Bindings über `pywhispercpp`).
  - **Lizenz:** **MIT License**.
  - **Geschwindigkeit & Vergleich:** Mit aktiviertem Metal (`GGML_METAL=1`) und Flash-Attention (`-fa`) ist `whisper.cpp` bei `large-v3-turbo` (`ggml-large-v3-turbo.bin` bzw. `q5_0` / `q8_0`) ähnlich schnell wie `mlx-whisper` (ca. 12×–25× Echtzeit) und hat einen noch geringeren und **völlig konstanten RAM-Verbrauch (~1,8 GB bei `q8_0`, ~2,5 GB bei `f16`)**. Die Core-ML-Encoder-Kompilierung dauert beim allerersten Start mehrere Minuten und bringt gegenüber dem aktuellen Metal-Backend mit Flash-Attention kaum noch Vorteile – reines Metal in `mlx-whisper` oder `whisper.cpp` ist vorzuziehen.

### 2. Unsicher / Vermutung
- **Unsicher (S5-U1):** Wie stark das bekannte MLX-Speicherwachstum bei `word_timestamps=True` über eine ungeteilte 90-min-Datei auf dem konkreten Mac des Owners ausfällt (abhängig von der installierten `mlx`-Version). Unser Chunking in 10-min-Blöcke (siehe Stolperfalle 1) umgeht dieses Risiko vollständig.

### 3. Stolperfallen
1. **RAM-Wachstum bei `word_timestamps=True` auf sehr langen Audiodateien:** In `mlx-whisper` gab es Berichte ([ml-explore/mlx-examples Issue #1027](https://github.com/ml-explore/mlx-examples/issues)), dass bei mehrstündigen Audiodateien mit `word_timestamps=True` der Unified-Memory-Verbrauch durch nicht sofort freigegebene Cross-Attention-Tensoren ansteigt. **Einfache Gegenmaßnahme im Worker:** Die 90-min-Datei vorab in 10-Minuten-Abschnitte (mit 5 s Überlappung oder an Stille-Grenzen) teilen und nach jedem Abschnitt `mx.metal.clear_cache()` (`mx.clear_cache()`) aufrufen. Dadurch bleibt der RAM-Verbrauch garantiert unter 4 GB und der Fortschritt (`session.processing`) lässt sich alle 10 % aktualisieren!
2. **Halluzinations-Schleifen bei Vorlesungspausen / Tafelanschrieb:** Wenn der Prof 2 Minuten lang still an die Tafel schreibt, neigt Whisper mit Standardparametern (`condition_on_previous_text=True`) dazu, den letzten Satz endlos zu wiederholen oder Untertitel-Floskeln (*„Untertitel im Auftrag des ZDF"*) zu erfinden. **Pflicht-Parameter für den Aufruf:**
   ```python
   mlx_whisper.transcribe(
       audio_path,
       path_or_hf_repo="mlx-community/whisper-large-v3-turbo",
       word_timestamps=True,
       condition_on_previous_text=False,
       hallucination_silence_threshold=2.0,
       no_speech_threshold=0.6,
       compression_ratio_threshold=2.4,
       initial_prompt=vocab_prompt,
   )
   ```

### 4. Konkreter Testplan für den Owner (Dauer: ca. 30 Minuten)

1. **Einzeiler-Benchmark im Terminal starten (5 min Vorbereitung + 5–10 min Laufzeit):**
   ```bash
   # Beliebige 90-min-Vorlesungsdatei (oder 15-min-Aufnahme 6x hintereinander gehängt) testen:
   /usr/bin/time -l uv run --with mlx-whisper python3 -c '
   import time, mlx_whisper
   t0 = time.time()
   res = mlx_whisper.transcribe(
       "test_90min.m4a",
       path_or_hf_repo="mlx-community/whisper-large-v3-turbo",
       word_timestamps=True,
       condition_on_previous_text=False,
       hallucination_silence_threshold=2.0,
       initial_prompt="Vorlesung Wirtschaftsinformatik, Datenbanksysteme, Normalisierung, 3NF, Primary Key, Foreign Key."
   )
   dt = time.time() - t0
   print(f"Fertig in {dt/60:.2f} Minuten, Segmente: {len(res[\"segments\"])}")
   '
   ```
2. **Prüfpunkte ablesen:**
   - [ ] Laufzeit `dt` ≤ 15 Minuten (Erwartung: 4–9 Minuten).
   - [ ] `maximum resident set size` aus `/usr/bin/time -l` < 6 GB.
   - [ ] Stichprobe von 10 Segmenten: Sind deutsche Sätze, englische Fachbegriffe und `words[].start`/`end` präzise?

### 5. Vorläufige Empfehlung zu S5
**`mlx-whisper` (`0.4.3`, MIT) mit `mlx-community/whisper-large-v3-turbo` (MIT) als lokaler Standard setzen.** Im Worker (`P4 transcribe`) die Audiodatei in 10-Minuten-Fenstern mit `condition_on_previous_text=False`, `hallucination_silence_threshold=2.0` und `mx.clear_cache()` verarbeiten. Falls auf einem Rechner mit nur 8 GB RAM jemals Speicherknappheit auftritt, steht `whisper.cpp` (`v1.9.5`, MIT) mit `ggml-large-v3-turbo-q8_0.bin` als Drop-in-Alternative hinter dem `Transcriber`-Protokoll bereit.

---

## Übersicht der untersuchten Bibliotheken & Lizenzen (für `docs/DRITTANBIETER.md`)

| Paket / Projekt | Spike | Aktuelle Version (Stand 11/2026) | Lizenz | Copyleft-Hinweis |
|---|---|---|---|---|
| **`perfect-freehand`** (npm) | S3 | `1.2.3` | **MIT** | Kein Copyleft, frei verwendbar in Web-App |
| **`mlx-whisper`** (PyPI) | S5 | `0.4.3` | **MIT** | Kein Copyleft, frei verwendbar im Worker |
| **`mlx`** (PyPI, Abhängigkeit von `mlx-whisper`) | S5 | `0.21+` | **MIT** | Kein Copyleft |
| **`whisper-large-v3-turbo`** (Gewichte) | S5 | `v20240930` | **MIT** | Kein Copyleft |
| **`whisper.cpp`** (Alternative) | S5 | `1.9.5` | **MIT** | Kein Copyleft |
| **AltStore / SideStore** (nur optionales Sideload-Tool auf dem Gerät des Owners) | S1 | `2.0+` / `0.5+` | **GPL-3.0 / AGPL-3.0** | **Achtung:** Nur als externes Installationswerkzeug auf dem Mac/iPad des Owners nutzen, niemals als Code/Abhängigkeit ins Repo aufnehmen. |
