# Recherchebericht zur Vorbereitung der Spikes S1, S3, S4 und S5 (Phase 1)

| | |
|---|---|
| **Bezug** | `docs/spezifikation/10-UMSETZUNG.md` §4 (Spikes S1, S3, S4, S5), Issue #22 |
| **Stand** | 04.11.2026 |
| **Zielhardware** | Mac mit Apple Silicon (aktuelles macOS), iPad mit Apple Pencil (aktuelles iPadOS) |
| **Autor** | Argon (`Gemini 4 Argon (Medium)`) |

---

## Kurzfassung (Executive Summary)

1. **S1 (Swift Playgrounds vs. Xcode):** Ein `.swiftpm`-App-Projekt (`AppleProductTypes`) unterstützt `PKCanvasView`, `UIPencilInteraction` / `.onPencilDoubleTap` / `.onPencilSqueeze` (ab iPadOS 17.5+), Kamera, `URLSessionWebSocketTask` (auf iPadOS ohne spezielle Netzwerk-Capability) und `NWBrowser`. Die Capability „Local Network" in Playgrounds setzt `NSLocalNetworkUsageDescription`; für Bonjour (`_studiengehirn._tcp`) muss zusätzlich `NSBonjourServices` über `additionalInfoPlistContentFilePath: "CustomInfo.plist"` in `Package.swift` eingebunden werden (im Spike auf dem iPad zu verifizieren). **Vorläufige Empfehlung:** `.swiftpm`-Format für Playgrounds *und* Xcode nutzen; im Alltag per Xcode (kostenloses Personal Team) bzw. optional SideStore/AltStore auf das iPad installieren.
2. **S3 (PencilKit → `perfect-freehand`):** `PKStroke.path` liefert als `RandomAccessCollection<PKStrokePoint>` direkt `location`, `timeOffset`, `force`, `azimuth`, `altitude` und `size` (Hinweis: `PKStroke` selbst hat kein `width`-Property; die Breite steckt in `PKInk` und `PKStrokePoint.size`). Da Apple keinen festen Wertebereich für `PKStrokePoint.force` dokumentiert, müssen im Spike **zuerst** die Rohwerte auf dem echten iPad geloggt und daraus die Normierung auf `[0, 1]` abgeleitet werden; in `perfect-freehand` (`1.2.3`, **MIT**) ist `simulatePressure: false` zu setzen.
3. **S4 (`MediaRecorder` Safari & Chrome):** Die W3C-Spezifikation garantiert nur, dass alle Blobs einer Aufnahme *zusammen* abspielbar sind; im Browserverhalten (bekannt bei Chrome-WebM, für Safari-MP4 im Spike zu prüfen) trägt bei `timeslice` nur Chunk `seq = 0` den Container-Header. **Vorläufige Empfehlung:** Im Spike S4 beide gleichwertigen Architekturvarianten – **Variante A (`timeslice` + Init-Chunk `seq = 0` mitspeichern/voranstellen)** und **Variante B (Recorder-Rotation alle 30 s)** – mit einem durchlaufenden 440-Hz-Sinuston auf Lücken, Überlappungen und Encoder-Priming messen und erst anhand der Messwerte entscheiden.
4. **S5 (`mlx-whisper` large-v3-turbo):** `mlx-whisper` (`0.4.3`, **MIT**, benötigt `mlx>=0.11` sowie laut PyPI `torch`, `numba`, `scipy`, `tiktoken`) mit `mlx-community/whisper-large-v3-turbo` (**MIT**, ~1,6 GB FP16) lässt auf M1–M4 nach grober Schätzung (**Unsicher**, Messung im Spike maßgeblich) ~3–13 min für 90 min Audio erwarten. **Gegenmaßnahmen gegen Halluzinationen & RAM-Anstieg:** Audio in 10-min-Abschnitte teilen, `condition_on_previous_text=False`, `word_timestamps=True` + `hallucination_silence_threshold=2.0` setzen.
5. **Lizenz-Check (vgl. `docs/DRITTANBIETER.md`):** `perfect-freehand`, `mlx-whisper`, `mlx`, `whisper-large-v3-turbo` und `whisper.cpp` stehen unter **MIT-Lizenz** (kein Copyleft). **SideStore** steht unter **AGPL-3.0** (AltStore-Lizenz unbelegt/separat zu prüfen); beide sind nur optionale externe Werkzeuge des Nutzers und kein Teil unseres Repos.

---

## Spike S1 · iPad-App in Swift Playgrounds (`.swiftpm`) vs. Xcode (Weg B)

### 1. Fakten mit Quelle

| Prüfpunkt | Unterstützung in `.swiftpm` (Swift Playgrounds 4.5+ / iPadOS 17.5–18+) | Technische Umsetzung & Quelle |
|---|---|---|
| **Format & Projektstruktur** | **Ja.** App-Projekte (`.swiftpm`) nutzen das Modul `AppleProductTypes` mit `.iOSApplication(...)` in `Package.swift` (`swift-tools-version: 5.9` / `6.0`). Dasselbe Verzeichnis lässt sich ohne Konvertierung in **Swift Playgrounds (iPad & Mac)** und in **Xcode 16+** öffnen. In `.iOSApplication(...)` sind `capabilities: [...]` und `additionalInfoPlistContentFilePath: "..."` dokumentierte Parameter. | [Apple Developer: Project capabilities in Swift Playgrounds](https://developer.apple.com/documentation/swift-playgrounds/project-capabilities) |
| **PencilKit mit zwei `PKCanvasView`-Ebenen** | **Ja.** `PKCanvasView` wird über `UIViewRepresentable` in SwiftUI eingebettet. Zwei übereinanderliegende `PKCanvasView`-Instanzen (unten Textmarker mit `isOpaque = false`, `backgroundColor = .clear`, oben Schrift) sind normales UIKit/PencilKit-API ohne besondere Entitlements. | [Apple Developer: PKCanvasView](https://developer.apple.com/documentation/pencilkit/pkcanvasview) |
| **`UIPencilInteraction` (Doppeltipp / Squeeze / Hover)** | **Ja.** Sowohl über UIKit (`UIPencilInteraction` + `UIPencilInteractionDelegate`: `pencilInteraction(_:didReceiveTap:)`, `pencilInteraction(_:didReceiveSqueeze:)`) als auch seit **iPadOS 17.5** direkt als native SwiftUI-View-Modifier `.onPencilDoubleTap { ... }` und `.onPencilSqueeze { phase in ... }` inkl. `@Environment(\.preferredPencilDoubleTapAction)`. | [Apple Developer: onPencilDoubleTap](https://developer.apple.com/documentation/swiftui/view/onpencildoubletap(perform:)), [onPencilSqueeze](https://developer.apple.com/documentation/swiftui/view/onpencilsqueeze(perform:)), [UIPencilInteraction](https://developer.apple.com/documentation/uikit/uipencilinteraction) |
| **Kamera (`AVFoundation` / `VisionKit`)** | **Ja.** In `Package.swift` wird unter `capabilities: [` der Eintrag `.camera(purposeString: "Tafel-Fotos in der Vorlesung aufnehmen")` (bzw. in der Playgrounds-UI die Capability „Camera") gesetzt. Damit funktionieren `UIImagePickerController`, `AVCaptureSession` und `VNDocumentCameraViewController` (VisionKit Perspektivkorrektur). | [Apple Developer: Project capabilities in Swift Playgrounds](https://developer.apple.com/documentation/swift-playgrounds/project-capabilities), [Apple Support: Add capabilities in Swift Playgrounds](https://support.apple.com/guide/playgrounds-ipad/apd192e54f28/ipados) |
| **WebSocket (`URLSessionWebSocketTask`)** | **Ja.** Auf iPadOS ist für ausgehende Netzwerk-/WebSocket-Verbindungen **keine** Capability in `Package.swift` erforderlich (Apples Capability „Network Connections" / `.outgoingNetworkConnections()` gilt nur für den macOS-App-Sandbox-Pfad). `URLSession.shared.webSocketTask(with: url)` läuft auf `ws://<mac-ip>:4710/sync` ohne App-Transport-Security-(ATS)-Blockade, da ATS unter iOS/iPadOS für lokale IP-Adressen und `.local`-mDNS-Namen standardmäßig unverschlüsseltes HTTP/WS erlaubt (`NSAllowsLocalNetworking` ist ab iOS 14 für lokale Adressen implizit aktiv). | [Apple Developer: Project capabilities in Swift Playgrounds](https://developer.apple.com/documentation/swift-playgrounds/project-capabilities), [URLSessionWebSocketTask](https://developer.apple.com/documentation/foundation/urlsessionwebsockettask), [NSAllowsLocalNetworking](https://developer.apple.com/documentation/bundleresources/information_property_list/nsapptransportsecurity/nsallowslocalnetworking) |
| **Bonjour (`NWBrowser`) & Local-Network-Freigabe** | **Teilweise über UI, `NSBonjourServices` über `CustomInfo.plist`.** Seit iOS 14 verlangt `NWBrowser(for: .bonjour(type: "_studiengehirn._tcp", domain: nil), using: .tcp)` zwei Schlüssel in der `Info.plist`: `NSLocalNetworkUsageDescription` (String) und `NSBonjourServices` (`["_studiengehirn._tcp"]`). Die Capability **„Local Network"** ist in der Playgrounds-UI vorhanden und setzt `NSLocalNetworkUsageDescription`. Für das Array `NSBonjourServices` gibt es kein eigenes UI-Feld; dafür wird im Paket-Root eine `CustomInfo.plist` angelegt und in `Package.swift` bei `.iOSApplication(...)` über `additionalInfoPlistContentFilePath: "CustomInfo.plist"` eingebunden (Verhalten auf dem iPad im Spike zu prüfen, siehe S1-U1). | [Apple Developer: NWBrowser](https://developer.apple.com/documentation/network/nwbrowser), [Apple Tech Note TN3179: Understanding local network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy), [Apple Developer Forums: Local Network Privacy FAQ (#663858)](https://developer.apple.com/forums/thread/663858) |
| **Hintergrund & Speichern beim Beenden** | **Ja.** Über `@Environment(\.scenePhase)` (`.inactive`, `.background`) und `UIApplication.willResignActiveNotification` kann die App sofort `PKDrawing.dataRepresentation()` und die Ausgangswarteschlange per `.atomic`-Write ins `Application Support`-Verzeichnis schreiben; mit `UIApplication.shared.beginBackgroundTask` bleibt beim App-Wechsel ein kurzes Zeitfenster für ausstehende WebSocket-Acks. | [Apple Developer: ScenePhase](https://developer.apple.com/documentation/swiftui/scenephase) |
| **Weg B: Xcode + kostenlose Apple-ID / SideStore / AltStore** | **Kosten:** 0 € (normale Apple-ID reicht als „Personal Team" in Xcode).<br>**Aufwand mit Xcode allein:** Mac + iPad per USB oder WLAN-Debugging in Xcode verbinden und per `⌘R` auf das Gerät installieren.<br>**Datenerhalt beim Erneuern der Signatur:** Der App-Daten-Container (`Documents/` / `Application Support/`) bleibt auf dem iPad erhalten, **vorausgesetzt die Bundle-ID (`bundleIdentifier`) bleibt identisch und die App wird vor dem erneuten Signieren/Drüberinstallieren nicht vom iPad gelöscht**.<br>**Optional mit SideStore (AGPL-3.0) oder AltStore (Lizenz unbelegt):** Automatische Signatur-Erneuerung im Hintergrund über WLAN. | [SideStore Documentation](https://sidestore.io/), [AltStore Docs: Apple ID Limits](https://faq.altstore.io/getting-started/how-to-install-altstore-macos) |

### 2. Unsicher / Vermutung (im Spike S1 zu verifizieren)
- **Unsicher (S1-U1 – `additionalInfoPlistContentFilePath` & `NSBonjourServices` in Playgrounds auf dem iPad):** Es ist plausibel und in `AppleProductTypes` dokumentiert, dass `additionalInfoPlistContentFilePath: "CustomInfo.plist"` das `NSBonjourServices`-Array für `NWBrowser` setzt. Im Spike muss auf dem iPad geprüft werden, ob Swift Playgrounds diese Einstellung beim Ausführen im In-App-Runner berücksichtigt und ob Playgrounds die `Package.swift`-Zeile überschreibt, wenn man in der grafischen Playgrounds-Oberfläche App-Einstellungen (Name/Icon/Capabilities) ändert (`// WARNING: This file is automatically generated and may be overwritten`).
- **Unsicher (S1-U2 – Homescreen-Icon aus Swift Playgrounds ohne bezahlten Developer-Account):** Ob und wie sich eine App direkt aus Swift Playgrounds auf dem iPad *ohne* Mac und *ohne* bezahlten Apple-Developer-Account als eigenständiges Homescreen-Icon installieren lässt (oder ob sie auf dem iPad ohne Mac nur innerhalb der Playgrounds-App über den „Run"-Knopf startet), ist nicht durch eine offizielle Apple-Quelle belegt und wird im Spike S1 direkt auf dem iPad geprüft.
- **Unsicher (S1-U3 – Community-Erfahrungswerte zu den Limits des kostenlosen Apple-Accounts):** Die häufig genannten konkreten Zahlen für das kostenlose „Personal Team"-Provisioning (**7 Tage** Laufzeit des Zertifikats, **max. 3 aktive Sideload-Apps** pro Gerät, **max. 10 App-IDs pro 7 Tage**) stammen aus Community-/AltStore-Dokumentation und werden von Apple nicht auf einer festen offiziellen Dokumentationsseite garantiert.
- **Unsicher (S1-U4 – `VNDocumentCameraViewController` im Playgrounds-Runner):** Ob `VNDocumentCameraViewController` (VisionKit Dokumenten-Scanner für Tafel-Fotos, `F-INK-06`) auch innerhalb des Swift-Playgrounds-In-App-Runners ohne Einschränkung startet (als regulär über Xcode installierte App auf dem iPad funktioniert er normal).

### 3. Stolperfallen
1. **Fehlender Local-Network-Dialog (`-72008` PolicyDenied):** Wenn `NSBonjourServices` nicht exakt `["_studiengehirn._tcp"]` enthält, bricht `NWBrowser` mit `kDNSServiceErr_PolicyDenied` (`-72008`) ab, **ohne** dass iPadOS den Berechtigungsdialog anzeigt.
2. **Zwei `PKCanvasView` übereinander blockieren Touches:** Wenn beide Ebenen `isUserInteractionEnabled = true` haben, fängt immer die obere Ebene alle Stift-Events ab. **Lösung:** Nur die jeweils aktive Ebene (beim Stift/Füller/Bleistift die obere `ink`-Ebene, beim Textmarker oder „nur Textmarker radieren" die untere `highlight`-Ebene) bekommt `isUserInteractionEnabled = true` und `becomeFirstResponder()`, oder man nutzt ein einziges `PKCanvasView` für die Eingabe und sortiert beim Zeichnen Textmarker-Striche im `PKDrawing.strokes`-Array vor die Schrift-Striche (beide Optionen im Spike vergleichen!).
3. **Bundle-ID-Konstanz für Datenerhalt:** Beim Wechsel zwischen Xcode-Builds oder beim Erneuern eines abgelaufenen Entwicklungszertifikats darf die App auf dem iPad **nicht** deinstalliert werden und `bundleIdentifier` in `Package.swift` muss unverändert bleiben, sonst legt iPadOS einen neuen, leeren Sandbox-Container an.

### 4. Konkreter Testplan für den Owner (Dauer: ca. 90 Minuten)

1. **`.swiftpm`-Minimalpaket auf dem Mac anlegen (20 min):**
   - Ordner `StudienGehirnSpike.swiftpm` mit `Package.swift` (Capability `.camera(...)` + Local Network sowie `additionalInfoPlistContentFilePath: "CustomInfo.plist"` mit `NSBonjourServices: ["_studiengehirn._tcp"]`) erstellen.
   - Eine Test-View mit:
     - zwei gestapelten `PKCanvasView` (Umschalter „Stift" vs. „Textmarker"),
     - `.onPencilDoubleTap` und `.onPencilSqueeze` (Log-Ausgabe auf dem Bildschirm),
     - Button „Tafel-Foto" (`VNDocumentCameraViewController`),
     - Button „Bonjour + WebSocket-Test" (`NWBrowser` sucht `_studiengehirn._tcp` und verbindet `URLSessionWebSocketTask`),
     - Speichern von `drawing.dataRepresentation()` bei `scenePhase == .background`.
2. **Test A – Swift Playgrounds direkt auf dem iPad (30 min):**
   - `StudienGehirnSpike.swiftpm` per AirDrop/iCloud Drive auf das iPad in Swift Playgrounds öffnen und starten.
   - Auf dem iPad prüfen:
     - [ ] Lässt sich aus Swift Playgrounds auf dem iPad ohne bezahlten Account ein Homescreen-Icon erzeugen oder läuft die App nur über den Playgrounds-„Run"-Knopf (Prüfung von S1-U2)?
     - [ ] Wird `CustomInfo.plist` (`NSBonjourServices`) im Playgrounds-Runner ausgewertet (löst der Bonjour-Button den „Lokales Netzwerk"-Dialog aus und findet `dns-sd -R "TestMac" _studiengehirn._tcp local 4710`)?
     - [ ] Bleibt `additionalInfoPlistContentFilePath` in `Package.swift` erhalten, wenn man in der Playgrounds-UI eine Einstellung ändert (Prüfung von S1-U1)?
     - [ ] Funktionieren `.onPencilDoubleTap` / `.onPencilSqueeze` und `VNDocumentCameraViewController` (Prüfung von S1-U4)?
3. **Test B – Xcode Direkt-Deployment auf das iPad (30 min):**
   - Dasselbe `StudienGehirnSpike.swiftpm` in Xcode öffnen, unter *Signing & Capabilities* das kostenlose „Personal Team" (eigene Apple-ID) wählen, iPad anschließen und mit `⌘R` installieren.
   - Auf dem iPad prüfen:
     - [ ] Eigenes App-Icon auf dem Homescreen startet in < 2 s.
     - [ ] Doppeltipp (und ggf. Squeeze) am Apple Pencil schaltet Werkzeug um.
     - [ ] Textmarker malt sichtbar *hinter* schwarzer Schrift.
     - [ ] Kamera-Button öffnet den Scanner und liefert ein Bild zurück.
     - [ ] Bonjour-Button findet den Mac und `URLSessionWebSocketTask` überträgt eine Testnachricht.
     - [ ] App per Wisch nach oben schließen, aus Xcode erneut mit derselben Bundle-ID drüberinstallieren (`⌘R`) → gespeicherte Striche im Container sind weiterhin vorhanden.
4. **Entscheidung in `docs/entscheidungen/S1.md` festhalten (10 min).**

### 5. Vorläufige Empfehlung zu S1
**Hybrid-Weg (A+B mit derselben `.swiftpm`-Codebasis):**
Das Projekt wie in `10-UMSETZUNG.md` geplant als **`apps/ipad/StudienGehirn.swiftpm`** anlegen. Dadurch bleibt es ein schlankes Swift-Package ohne `.xcodeproj`, das sowohl in Swift Playgrounds als auch in Xcode geöffnet werden kann. Sollte Test A zeigen, dass der Playgrounds-Runner auf dem iPad bei `NSBonjourServices` oder beim Schnellstart vom Homescreen Einschränkungen hat, wird im Alltag einfach aus Xcode (kostenloses Personal Team, optional mit SideStore für automatische Hintergrund-Verlängerung) bei gleichbleibender Bundle-ID auf das iPad installiert.

---

## Spike S3 · PencilKit → neutrales Strich-Format → `perfect-freehand` im Browser

### 1. Fakten mit Quelle

- **Punkte aus `PKDrawing` / `PKStroke` auslesen (iOS 14+ / Swift 6):**
  - `pkDrawing.strokes` liefert `[PKStroke]`.
  - Jeder `PKStroke` hat (laut Apple-Dokumentation besitzt `PKStroke` selbst **kein** `width`-Property; die Strichstärke ergibt sich aus `PKInk` und den `size`-Werten der `PKStrokePoint`-Elemente):
    - `ink: PKInk` mit `ink.inkType` (`.pen`, `.pencil`, `.marker`, `.monoline`, `.fountainPen`, `.watercolor`, `.crayon`) und `ink.color: UIColor`.
    - `transform: CGAffineTransform` (`a, b, c, d, tx, ty` → die 6 Werte für `stroke.transform`).
    - `path: PKStrokePath` (implementiert `RandomAccessCollection<PKStrokePoint>`), mit `path.creationDate: Date`.
    - `renderBounds: CGRect` (liefert direkt `bbox: [origin.x, origin.y, size.width, size.height]`).
  - Jeder `PKStrokePoint` in `stroke.path` liefert:
    - `location: CGPoint` (`x`, `y` in Punkt, noch **vor** Anwendung von `stroke.transform`! Transformierte Koordinate ist `point.location.applying(stroke.transform)`).
    - `timeOffset: TimeInterval` (Sekunden als `Double` seit `path.creationDate` → `dt = Float32(point.timeOffset * 1000.0)`).
    - `force: CGFloat` (Druck des Eingabegeräts; Apple dokumentiert in der offiziellen API-Referenz **keinen festen numerischen Maximalwert**).
    - `azimuth: CGFloat` (Richtungswinkel in Radiant, `-π` bis `π`).
    - `altitude: CGFloat` (Neigungswinkel zur Oberfläche in Radiant, `0` = flach bis `π/2` = senkrecht).
    - `size: CGSize` (Breite/Höhe des Punkts in pt; repräsentiert die Punktgröße des Strichs).
  - *Hinweis zur Punkt-Dichte:* `stroke.path` speichert B-Spline-Kontrollpunkte. Für eine gleichmäßige Punktfolge bietet `PKStrokePath` zusätzlich `interpolatedPoints(in: strideBy: .distance(2.0))` bzw. `.time(...)`.
  - **Quelle:** [Apple Developer: PKStroke](https://developer.apple.com/documentation/pencilkit/pkstroke), [PKInk](https://developer.apple.com/documentation/pencilkit/pkink), [PKStrokePath](https://developer.apple.com/documentation/pencilkit/pkstrokepath), [PKStrokePoint](https://developer.apple.com/documentation/pencilkit/pkstrokepoint).

- **`perfect-freehand` Bibliothek (Web-App):**
  - **Aktuelle Version:** `1.2.3` (npm: `perfect-freehand`, 0 Runtime-Dependencies, ~4 KB gzipped).
  - **Lizenz:** **MIT License** (Autor: Steve Ruiz; unkritisch für `docs/DRITTANBIETER.md`).
  - **Funktionsweise:** `getStroke(points, options)` nimmt ein Array `[[x, y, pressure], ...]` (`pressure` in `0.0..1.0`) und gibt ein Array von 2D-Polygon-Umrisspunkten `[[x, y], ...]` zurück, das als `<path d="..." fill={color} />` in SVG oder per `Path2D` auf ein HTML5-`<canvas>` gezeichnet wird.
  - **Wichtigste Option bei echten Apple-Pencil-Daten:** `simulatePressure: false`! Standardmäßig ist `simulatePressure: true`, wodurch `perfect-freehand` den übergebenen Druckwert ignoriert und Druck künstlich aus der Schreibgeschwindigkeit berechnet.
  - **Quelle:** [GitHub: steveruizok/perfect-freehand (v1.2.3, MIT)](https://github.com/steveruizok/perfect-freehand), [npm: perfect-freehand](https://www.npmjs.com/package/perfect-freehand).

- **Zuordnung zwischen PencilKit `PKInkingTool.InkType`, unserem Schema (`03 §6`, `08 §4.1`) und `perfect-freehand`-Startparametern:**

| Schema-Wert `stroke.tool` (`03 §6`, `08 §4.1`) | PencilKit `PKInkingTool.InkType` | `size` (Basisbreite `stroke.width`) | `thinning` | `smoothing` | `streamline` | `simulatePressure` | Besonderheit beim Rendern (Canvas / SVG) |
|---|---|---|---|---|---|---|---|
| **`"pen"`** (Kugelschreiber/Fineliner) | `.pen` | `stroke.width` | `0.35` | `0.5` | `0.4` | `false` | Leicht druckabhängig, runde Endkappen (`start.cap = true`, `end.cap = true`) |
| **`"monoline"`** | `.monoline` | `stroke.width` | `0.0` | `0.5` | `0.5` | `false` | Konstante Strichstärke (`thinning: 0`) |
| **`"fountain"`** (Füller) | `.fountainPen` | `stroke.width * 1.15` | `0.7` | `0.5` | `0.45` | `false` | Starke Druckvariation (`thinning: 0.7`), `start.taper: 4`, `end.taper: 4` |
| **`"pencil"`** (Bleistift) | `.pencil` | `stroke.width` | `0.25` | `0.3` | `0.2` | `false` | Leicht reduzierte Deckkraft (`opacity: 0.85`), breiter bei flachem Neigungswinkel (`altitude`) |
| **`"marker"`** (Textmarker, Ebene `highlight`) | `.marker` | `stroke.width` | `0.0` | `0.6` | `0.6` | `false` | Auf der unteren Ebene (`highlight`), `globalCompositeOperation = 'multiply'` bzw. `opacity: 0.35`, flache Enden (`start.cap = false`, `end.cap = false`) |

### 2. Unsicher / Vermutung (im Spike S3 durch Rohwert-Logging zu bestimmen)
- **Unsicher (S3-U1 – Wertebereich und Normierung von `PKStrokePoint.force`):** Apple dokumentiert keinen festen Maximalwert für `PKStrokePoint.force`. In der Praxis werden für den Apple Pencil häufig Rohwerte im Bereich von `0.0` bis ca. `5.0` (und ein Normierungsdivisor um `~3.5` auf `[0.0, 1.0]`) beobachtet; dies ist jedoch **nicht offiziell dokumentiert** und muss im Spike S3 als allererster Schritt durch Ausgeben der echten Rohwerte auf dem iPad des Owners gemessen werden.
- **Unsicher (S3-U2 – Ableitung von `stroke.width` aus `PKInkingTool.width` vs. `PKStrokePoint.size`):** Da `PKStroke` kein eigenes `width`-Property hat (`PKStroke.ink` liefert nur `inkType` und `color`), muss im Spike geprüft werden, wie sich `point.size.width` bei den fünf Werkzeugen (`pen`, `monoline`, `fountainPen`, `pencil`, `marker`) zu der am `PKInkingTool` eingestellten Strichbreite verhält – und ob für `stroke.width` im neutralen Format die eingestellte Werkzeugbreite oder der Mittelwert/Median von `point.size.width` (bzw. die direkte Übergabe von `point.size.width` pro Punkt) das originalgetreueste Bild in `perfect-freehand` liefert.

### 3. Stolperfallen
1. **Unbekannter `force`-Wertebereich ohne Vorab-Normierung:** `perfect-freehand` erwartet für `pressure` Werte im Intervall `[0.0, 1.0]`. Übergibt man unnormierte `PKStrokePoint.force`-Werte `> 1.0`, entstehen überbreite Striche. Deshalb erst auf dem Gerät die Rohwerte für leichtes, normales und festes Aufdrücken loggen und daraus die Normierungsformel festlegen.
2. **Werkzeug-Mapping `.fountainPen` ↔ `"fountain"`:** In PencilKit heißt der Enum-Case `PKInkingTool.InkType.fountainPen` (`rawValue: "com.apple.ink.fountainPen"`), in unserem Datenmodell (`03 §6`) und Sync-Protokoll (`08 §4.1`) dagegen `"fountain"`. Beim Serialisieren auf dem iPad muss explizit `.fountainPen -> "fountain"` gemappt werden.
3. **`stroke.transform` und `point.location`:** Wenn ein Strich auf dem iPad mit dem Lasso verschoben, gedreht oder skaliert wird (`F-INK-07`), ändert PencilKit **nicht** die einzelnen `point.location`-Werte im `PKStrokePath`, sondern nur die Matrix `stroke.transform`! Die Web-App muss beim Rendern entweder den Canvas/SVG-Kontext mit `transform(a, b, c, d, tx, ty)` transformieren oder jeden Punkt mit `transform` multiplizieren.
4. **Radierer im Pixelmodus (`.bitmap`):** Wenn der Nutzer einen Strich mit dem Pixel-Radierer in der Mitte durchteilt, ersetzt PencilKit im `PKDrawing.strokes`-Array den einen alten `PKStroke` durch zwei neue `PKStroke`-Objekte (beide behalten dieselbe `path.creationDate`!). Deshalb muss der Fingerabdruck (`08 §4.3`) zwingend `creationDate + path.count + first3Points` kombinieren.

### 4. Konkreter Testplan & Messung der ≤ 1 s Spiegelung (Dauer: ca. 2 Stunden)

1. **Schritt 1 – Rohwerte (`force`, `altitude`, `azimuth`, `size`) auf dem echten iPad loggen (20 min):**
   - In der Spike-App nach jedem gezeichneten Strich für alle fünf Werkzeuge (`pen`, `monoline`, `fountainPen`, `pencil`, `marker`) sowie für Finger-Input `min`, `median` und `max` von `point.force`, `point.altitude`, `point.azimuth` und `point.size` in der Konsole / auf dem Bildschirm ausgeben:
     - Leichtes Schreiben mit Apple Pencil,
     - Normales Schreiben mit Apple Pencil,
     - Festes Aufdrücken mit Apple Pencil,
     - Strich mit dem Finger.
   - **Erst aus diesen gemessenen Rohwerten** die Normierungsfunktion `normalizeForce(point.force) -> Float32 in [0, 1]` und die Berechnung von `stroke.width` aus `point.size` festlegen.
2. **Schritt 2 – Qualitätsvergleich iPad vs. Browser (40 min):**
   - Auf einer A4-Seite in der Spike-App 1 Satz Schreibschrift, 1 Formel (`∑`, Bruch, Index), 1 ER-Diagramm (Kasten, Raute, Pfeil) und 2 Textmarker-Hervorhebungen schreiben.
   - Seite auf dem iPad per `PKDrawing.image(from: pageBounds, scale: 2.0)` als PNG exportieren und neben einen Screenshot des Browser-Canvas (`perfect-freehand` mit `simulatePressure: false`) legen.
   - Parameter `thinning`, `smoothing`, `streamline` und die in Schritt 1 ermittelte `force`/`size`-Skalierung feinjustieren, bis Strichdicke und Kurvenverlauf optisch übereinstimmen.
3. **Schritt 3 – Saubere Messung der ≤ 1 s Spiegelungs-Latenz (30 min):**
   - **Messung im Protokoll:** Über den Ping-Pong-Uhrabgleich (`clock_offset_ms` laut `08 §2.1`) setzt das iPad beim Absetzen des Stifts (`canvasViewDrawingDidChange`) `t_pen_up = Date().timeIntervalSince1970 * 1000 + clock_offset_ms` in `stroke.add` (`at`). Die Web-App misst direkt nach dem `requestAnimationFrame`-Render-Aufruf `t_rendered = Date.now()` → `Δt = t_rendered - op.at`.
   - **Optische Referenzmessung:** iPhone-Kamera im **Slo-Mo-Modus (240 fps, 4,16 ms pro Frame)** filmt gleichzeitig iPad-Display und MacBook-Display beim Absetzen eines Strichs → Frames zählen zwischen „Stift hebt ab" und „Strich erscheint am Mac" (Ziel: < 240 Frames = 1,0 s).
4. **Ergebnisse (inkl. gemessener Rohwert-Tabelle) in `docs/entscheidungen/S3.md` dokumentieren (15 min).**

### 5. Vorläufige Empfehlung zu S3
`perfect-freehand` (`1.2.3`, MIT) auf einem HTML5-`<canvas>` (2 Canvas-Ebenen analog zum iPad: unten `highlight`, oben `ink`) mit `simulatePressure: false` einsetzen. Die genaue Normierungsformel für `PKStrokePoint.force` und `PKStrokePoint.size` wird im Spike S3 anhand der in Schritt 1 auf dem iPad geloggten Rohwerte kalibriert.

---

## Spike S4 · Audioaufnahme in Safari und Chrome (`MediaRecorder`)

### 1. Fakten mit Quelle

- **Unterstützte MIME-Typen (`MediaRecorder.isTypeSupported(...)`):**
  - **Chrome (macOS, Blink):**
    - `audio/webm;codecs=opus` (**Standard in Chrome**, 48 kHz).
    - `audio/mp4;codecs=mp4a.40.2` (AAC in fMP4, in aktuellen Chrome-Versionen ebenfalls unterstützt).
  - **Safari (macOS, WebKit):**
    - `audio/mp4` bzw. `audio/mp4;codecs=mp4a.40.2` (**Standard in Safari**, erzeugt fragmentiertes MP4 / AAC).
  - **Quelle:** [MDN: MediaRecorder.isTypeSupported()](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static), [Can I use: MediaRecorder](https://caniuse.com/mediarecorder).

- **W3C-Spezifikation vs. tatsächliches Browserverhalten bei `timeslice` (`seq ≥ 1`):**
  - **Was die W3C-Spezifikation sagt:** Die [W3C MediaStream Recording Specification (`ondataavailable` / `timeslice`)](https://www.w3.org/TR/mediastream-recording/#dom-mediarecorder-ondataavailable) legt fest, dass der Recorder während einer laufenden Aufnahme periodisch Teil-`Blob`s ausgibt, die *in ihrer Gesamtheit hintereinandergefügt* einen gültigen Medienstrom ergeben. Die W3C-Spezifikation schreibt **nicht** vor, dass jeder einzelne `timeslice`-Blob für sich allein genommen einen vollständigen Container-Header besitzt.
  - **Tatsächliches Browserverhalten (bekannt bei Chrome-WebM):**
    - Ruft man in Chrome `mediaRecorder.start(30000)` auf, schneidet der Browser einen einzigen fortlaufenden WebM-Bytestrom alle 30 s durch: **Nur Chunk `seq = 0`** beginnt mit dem `EBML`-Header und dem `Tracks`-Element (Codec-Initialisierung). **Alle Folge-Chunks (`seq ≥ 1`)** enthalten nur noch laufende WebM-`Cluster`-Blöcke ohne Header und lassen sich **nicht** isoliert ohne Chunk `seq = 0` mit `ffmpeg -i 1.webm` decodieren (`EBML header parsing failed`).
    - Für Safari (`audio/mp4`) ist das analoge Verhalten (Init-Segment im ersten Chunk, Fragment-Boxen in den Folge-Chunks) sehr wahrscheinlich, in den exakten Box-Details (`ftyp`/`moov` vs. `moof`/`mdat`) aber unter „Unsicher (S4-U1)" im Spike per `ffprobe` zu bestätigen.

- **Verhalten bei Hintergrund-Tab, Screen Wake Lock API, Ruhezustand und zugeklapptem Deckel:**
  - **Hintergrund-Tab:** Sowohl Chrome als auch Safari nehmen Audio im Hintergrund-Tab weiter auf, **solange ein aktiver `MediaStream` (Mikrofon-Indikator aktiv) läuft**. Da `setInterval` in Hintergrund-Tabs gedrosselt werden kann, müssen Zeitstempel für `start_ms`, `duration_ms` und etwaige Lücken im Browser immer über die monoton steigende Uhr `performance.now()` bzw. `AudioContext.currentTime` erfasst werden (nicht durch bloßes Hochzählen von `seq * 30000`).
  - **Screen Wake Lock API (`navigator.wakeLock.request('screen')`):**
    - Wird von aktuellen Chrome- und Safari-Versionen unterstützt ([MDN: Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)).
    - **Wichtige Einschränkung laut Spezifikation:** Ein Screen Wake Lock wirkt **nur, solange das Dokument sichtbar ist (`document.visibilityState === 'visible'`)**! Wechselt der Nutzer in einen anderen Browser-Tab oder minimiert das Fenster, gibt der Browser den Wake Lock automatisch frei (`release`-Event).
    - **Ergänzender Schutz auf macOS:** Da unser Core-Prozess ohnehin lokal auf demselben Mac läuft, kann der Core während einer laufenden Session (`laeuft`) zusätzlich das macOS-Bordmittel `caffeinate -di -w <core_pid>` starten. Das verhindert den System-Idle-Sleep auch dann, wenn der Browser-Tab im Hintergrund liegt.
  - **Zugeklappter Deckel (Clamshell Sleep):** Wird das MacBook ohne externen Monitor zugeklappt, erzwingt macOS den Hardware-Sleep. Das Mikrofon wird stummgeschaltet bzw. getrennt (`mute` / `ended` auf dem `MediaStreamTrack`). Nach dem Aufklappen muss die Web-App den Zeitsprung über `performance.now()` / `Date.now()` erkennen und die Aufnahme sauber fortsetzen (`F-SES-05`).

### 2. Unsicher / Vermutung (im Spike S4 zu prüfen)
- **Unsicher (S4-U1 – Exakter Container-Aufbau der Safari-`timeslice`-Chunks):** Ob Safari bei `mediaRecorder.start(30000)` mit `audio/mp4` exakt im ersten Chunk (`seq = 0`) das `ftyp`/`moov`-Init-Segment und in allen Folge-Chunks (`seq ≥ 1`) reine `moof`/`mdat`-Fragmente ohne Header liefert, oder ob sich einzelne Fragmente mit vorangestelltem Chunk 0 nahtlos per `cat` / `ffmpeg` reparieren lassen, wird im Spike mit `ffprobe -show_packets` / `mp4dump` verifiziert.
- **Unsicher (S4-U2 – Lücken, Überlappungen und Encoder-Priming bei Recorder-Rotation):** Ein Wechsel des `MediaRecorder` alle 30 s (Stop/Start eines Recorders oder überlappender Start/Stop zweier Recorder auf demselben `MediaStream`) ist **nicht garantiert nahtlos**: Sowohl in Chrome (Opus) als auch in Safari (AAC) entstehen durch asynchrones `start()`/`stop()` und durch das **Encoder-Priming** (Pre-Skip bei Opus bzw. Priming-Samples + Remainder-Padding bei AAC am Anfang und Ende jeder eigenständigen Datei) potenziell kleine **Lücken oder Überlappungen von einigen Millisekunden** bzw. kurze Phasen-/Pegel-Artefakte an jeder 30-s-Grenze. Wie groß dieser Effekt in beiden Browsern tatsächlich ist, muss im Spike S4 mit einem durchlaufenden Sinuston gemessen werden.
- **Unsicher (S4-U3 – Verhalten von `timeslice` nach System-Ruhezustand):** In der Praxis wurde beobachtet, dass ein laufender `MediaRecorder` nach einem macOS-System-Sleep (Deckel zu/auf) teilweise keine periodischen `ondataavailable`-Events mehr liefert oder fehlerhafte Zeitstempel schreibt. Deshalb sollte nach einem erkannten Sleep/Wake-Zyklus (Zeitsprung-Detektor via `performance.now()` vs. `Date.now()`) der `MediaRecorder` in jedem Fall sauber gestoppt und als neuer Aufnahmelauf neu gestartet werden.

### 3. Gegenüberstellung der beiden Architekturvarianten für S4

Beide Varianten haben spezifische Vor- und Nachteile und werden im Spike S4 **gleichwertig gegeneinander getestet**:

| Kriterium | **Variante A: `timeslice(30000)` + Init-Chunk (`seq = 0`) mitspeichern & voranstellen** | **Variante B: Recorder-Rotation alle 30 s (`stop()` / `start()` auf demselben `MediaStream`)** |
|---|---|---|
| **Funktionsweise** | Ein einziger `MediaRecorder` läuft pro zusammenhängendem Aufnahmelauf (`start(30000)`). Chunk `seq = 0` (mit dem Container-Header / Init-Segment) wird gesondert markiert. Nach einem Verbindungsabbruch oder System-Sleep wird ein neuer Recorder-Lauf mit eigenem Init-Chunk gestartet. | Der `MediaStream` bleibt offen; alle 30 s wird ein neuer `MediaRecorder` gestartet und der vorherige gestoppt, sodass jeder Chunk eine abgeschlossene Einzeldatei ist. |
| **Audio-Qualität an den 30-s-Grenzen** | **Kein Schnitt im Encoder-Datenstrom:** Innerhalb eines Laufs gibt es an den 30-s-Grenzen weder Lücken noch Überlappungen noch AAC/Opus-Encoder-Priming. | **Risiko an jeder 30-s-Grenze:** Durch Start/Stop-Timing und Opus/AAC-Encoder-Priming am Anfang/Ende jeder Datei können alle 30 s einige Millisekunden Lücke, Überlappung oder ein leises Knacksen entstehen (in Chrome & Safari im Spike zu messen!). |
| **Verhalten bei fehlenden Chunks / Lücken** | Zusammenhängende Chunks eines Laufs (`0..k`) werden vor dem `ffmpeg`-Aufruf binär konkateniert (`cat 0.webm 1.webm ... > run_1.webm`). Fehlt mitten im Lauf ein Chunk (z. B. durch Crash), kann das Init-Segment (Header aus Chunk `0`) vor die nachfolgenden Cluster/Fragmente gestellt oder nach jeder Störung sofort ein neuer Lauf (mit neuem Init-Chunk) begonnen werden. | Jeder einzelne Chunk (`0.webm`, `1.webm`, `2.webm` bzw. `.mp4`) besitzt seinen eigenen Container-Header und ist direkt einzeln mit `ffmpeg` decodierbar. |
| **Zeitstempel-Erfassung für Stille-Berechnung** | Im Browser wird bei jedem `ondataavailable` der exakte Zeitpunkt über `performance.now()` / `AudioContext.currentTime` erfasst (`start_ms`, `duration_ms`). Zwischen zwei Läufen berechnet der Worker die Differenz `gap_ms = next_run.start_ms - (prev_run.start_ms + prev_run.duration_ms)` aus den realen Zeitstempeln. | Ebenso Erfassung von `start_ms` und `duration_ms` über `performance.now()` / `AudioContext.currentTime` bei `onstart` und `onstop` jedes Chunks. |

#### Konkrete `ffmpeg`-Pipelines für `audio.finalize` (für beide Varianten)

- **Für Variante A (`timeslice` + Init-Chunk / Konkatenation pro Aufnahmelauf + Stille zwischen Läufen):**
  ```bash
  # 1. Innerhalb jedes zusammenhängenden Aufnahmelaufs (Run) Chunks ab Chunk 0 (Init-Header) binär zusammenfügen:
  cat chunks/run1_000.webm chunks/run1_001.webm chunks/run1_002.webm > /tmp/run1.webm
  cat chunks/run2_000.webm chunks/run2_001.webm > /tmp/run2.webm

  # 2. Läufe inklusive berechneter Stille-Lücke (z. B. 5.000 s aus performance.now()-Differenz)
  #    zu einer durchspulbaren full.m4a (AAC 48 kHz mono, +faststart) zusammenführen:
  ffmpeg -y \
    -i /tmp/run1.webm \
    -f lavfi -t 5.000 -i anullsrc=r=48000:cl=mono \
    -i /tmp/run2.webm \
    -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[outa]" \
    -map "[outa]" \
    -c:a aac -b:a 64k -ar 48000 -ac 1 \
    -movflags +faststart \
    full.m4a
  ```
  *(Falls im Spike geprüft wird, einen einzelnen späteren Chunk `seq ≥ 1` nach Ausfall von Zwischen-Chunks zu retten, wird nur der reine Header-Präfix aus Chunk `0` – bei WebM vor dem ersten `Cluster` `0x1F43B675`, bei fMP4 die `ftyp`+`moov`-Boxen – vor den Folge-Chunk kopiert und mit `ffmpeg -err_detect ignore_err` decodiert.)*

- **Für Variante B (Recorder-Rotation – jeder Chunk ist eine eigene Datei):**
  ```bash
  # Alle Einzel-Chunks (und eventuelle anullsrc-Stille-Blöcke bei Lücken) über filter_complex verbinden:
  ffmpeg -y \
    -i chunks/000.webm \
    -i chunks/001.webm \
    -f lavfi -t 5.000 -i anullsrc=r=48000:cl=mono \
    -i chunks/003.webm \
    -filter_complex "[0:a][1:a][2:a][3:a]concat=n=4:v=0:a=1[outa]" \
    -map "[outa]" \
    -c:a aac -b:a 64k -ar 48000 -ac 1 \
    -movflags +faststart \
    full.m4a
  ```

### 4. Konkreter Testplan für den Owner (Dauer: ca. 2 Stunden)

1. **Test 1 – Sinuston-Messung an den 30-s-Grenzen: Variante A vs. Variante B in Chrome & Safari (45 min):**
   - Einen kontinuierlichen **440-Hz-Sinuston** erzeugen (entweder digital über `AudioContext.createOscillator()` → `createMediaStreamDestination()` in den `MediaRecorder` einspeisen oder über Lautsprecher/Mikrofon abspielen).
   - Je 90 s (3 Chunks à 30 s) in **Chrome** (`audio/webm;codecs=opus`) und **Safari** (`audio/mp4`) aufnehmen:
     - Durchlauf 1: **Variante A (`timeslice(30000)`)**
     - Durchlauf 2: **Variante B (Recorder-Rotation alle 30 s: Stop/Start bzw. zwei Recorder)**
   - Zeitstempel jedes Chunks im Browser mit `performance.now()` und `AudioContext.currentTime` loggen.
   - Auswertung mit `ffprobe` und `ffmpeg`:
     - [ ] `ffprobe chunk_0` vs. `ffprobe chunk_1` prüfen (bestätigt Header-Verhalten in Chrome und Safari, S4-U1).
     - [ ] Bei Variante A prüfen, ob sich `chunk_2` allein durch Voranstellen des Header-Präfixes aus `chunk_0` decodieren lässt, wenn `chunk_1` absichtlich gelöscht wird.
     - [ ] Zusammengesetzte `full.m4a` beider Varianten an den 30-s-Grenzen (`t = 30,0 s` und `t = 60,0 s`) auf **Lücken und Überlappungen** untersuchen (S4-U2):
       ```bash
       # Automatische Stille-/Aussetzer-Suche ab 2 ms:
       ffmpeg -i full.m4a -af "silencedetect=noise=-50dB:d=0.002" -f null -
       # Gesamtdauer auf Millisekunden prüfen (Soll: 90.000 s) und Wellenform um t=30.0s in Audacity/Python betrachten:
       ffprobe -v error -show_entries format=duration full.m4a
       ```
2. **Test 2 – Hintergrund-Tab & Wake-Lock / `caffeinate`-Test (60 min nebenbei):**
   - Aufnahme starten (mit aktivem `caffeinate -di` + `navigator.wakeLock`), Browser-Tab in den Hintergrund legen und 60 min normal am Mac arbeiten.
   - Prüfen, ob alle 120 Chunks lückenlos und mit korrekten `performance.now()`-Zeitstempeln ankommen.
3. **Test 3 – Deckel-zu-Simulation & Stille-Einfügung (15 min):**
   - Während laufender Aufnahme den Mac für 30 s in den Ruhezustand versetzen (Deckel zu) und wieder öffnen.
   - Prüfen, dass die Web-App das `mute`/`ended`-Event bzw. den Zeitsprung (`performance.now()` vs. `Date.now()`) erkennt, sofort einen neuen Aufnahmelauf (mit neuem Init-Chunk `seq = 0` und neuem `start_ms`) startet (`F-SES-05`) und `ffmpeg` die gemessene Pause exakt als Stille in `full.m4a` einfügt.

### 5. Vorläufige Empfehlung zu S4
1. **Keine Vorab-Festlegung ohne Messung:** Im Spike S4 zuerst **Variante A (`timeslice` + Init-Chunk `seq = 0`)** und **Variante B (Recorder-Rotation)** mit dem 440-Hz-Sinuston in Chrome und Safari vergleichen. Zeigt Variante B an den 30-s-Grenzen messbare Lücken/Überlappungen oder Knackser durch Encoder-Priming, ist **Variante A (`timeslice(30000)` innerhalb eines Laufs + sofortiger Recorder-Neustart mit neuem Init-Chunk bei jeder Unterbrechung/Störung)** vorzuziehen, weil sie während ungestörter Vorlesungsabschnitte einen zu 100 % unterbrechungsfreien Datenstrom liefert.
2. **Zeitstempel für `start_ms` und Stille-Berechnung** im Browser immer über `performance.now()` / `AudioContext.currentTime` messen.
3. Den **System-Idle-Sleep während einer laufenden Session direkt vom Core aus per `caffeinate -di`** verhindern (ergänzend zur Screen Wake Lock API im Browser).

---

## Spike S5 · Lokale Transkription mit `mlx-whisper` (`large-v3-turbo`)

### 1. Fakten mit Quelle

- **`mlx-whisper` Paket, Abhängigkeiten & Lizenz:**
  - **Aktuelle PyPI-Version:** `mlx-whisper 0.4.3` (Teil von Apples offizieller `ml-explore/mlx-examples`-Sammlung, nutzt Apples MLX-Framework auf Metal/GPU).
  - **Lizenz Software (`mlx-whisper` & `mlx`):** **MIT License** (unkritisch für `docs/DRITTANBIETER.md`).
  - **Lizenz Modellgewichte (`openai/whisper-large-v3-turbo` / `mlx-community/whisper-large-v3-turbo`):** **MIT License** (809 Mio. Parameter; Encoder: 32 Layer wie `large-v3`, Decoder: von 32 auf **4 Layer** reduziert; ~1,6 GB Download in FP16).
  - **Laufzeit-Abhängigkeiten laut PyPI-Metadaten (`mlx-whisper 0.4.3`):**
    - Verlangt `mlx>=0.11` (aktuell auf PyPI: `mlx 0.32.x`).
    - Zieht außerdem **`torch`**, **`numba`**, **`scipy`**, **`tiktoken`**, **`numpy`**, **`more-itertools`**, **`tqdm`** und **`huggingface-hub`** als direkte Abhängigkeiten ins Python-Environment (wichtiger Hinweis für das Worker-Venv: durch `torch`, `scipy` und `numba` wächst die Installationsgröße der virtuellen Umgebung um mehrere Hundert MB; außerdem erfordert `mlx-whisper` ein installiertes `ffmpeg` im System-`PATH`).
  - **Verifizierte Parameter von `mlx_whisper.transcribe(...)`:**
    - `word_timestamps: bool` (liefert Wort-Zeitstempel `words: [{"word", "start", "end", "probability"}]` über Dynamic Time Warping auf den Cross-Attention-Gewichten),
    - `condition_on_previous_text: bool`,
    - `hallucination_silence_threshold: Optional[float]` (**wichtig:** wird im Code von `mlx-whisper` nur ausgewertet, wenn gleichzeitig `word_timestamps=True` aktiv ist!),
    - `initial_prompt: Optional[str]`, `no_speech_threshold: Optional[float]`, `compression_ratio_threshold: Optional[float]`.
  - **Quelle:** [PyPI: mlx-whisper 0.4.3](https://pypi.org/project/mlx-whisper/), [PyPI: mlx](https://pypi.org/project/mlx/), [GitHub: ml-explore/mlx-examples – whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper), [Hugging Face: mlx-community/whisper-large-v3-turbo](https://huggingface.co/mlx-community/whisper-large-v3-turbo), [OpenAI Whisper v20240930 Release (turbo)](https://github.com/openai/whisper/discussions/2363).

- **Alternative: `whisper.cpp` (mit Metal):**
  - **Lizenz:** **MIT License** (C/C++, Repository: [ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp); auf eine feste Versionsnummer wird hier verzichtet, da sich Releases laufend ändern).
  - **Vorteil als Rückfalloption:** Kommt komplett ohne `torch`/`numba`/`scipy` aus und arbeitet mit konstantem, sehr niedrigem Speicherbedarf (`ggml-large-v3-turbo.bin` bzw. quantisiert `q8_0`/`q5_0` auf Metal).

### 2. Unsicher / Vermutung (im Spike S5 auf dem Mac des Owners zu messen)
- **Unsicher (S5-U1 – Konkrete Laufzeit- und RAM-Werte für 90 min Audio):** Für die genaue Dauer einer 90-minütigen Vorlesung mit `mlx-whisper` (`large-v3-turbo`, `word_timestamps=True`) auf M1/M2/M3/M4 gibt es keinen offiziellen Einzel-Benchmark der MLX-Autoren. Als **grobe Schätzung / Richtwert** (aus dem ~3×-Decoder-Speedup von `large-v3-turbo` gegenüber `large-v3` abgeleitet, **ohne verifizierte Einzelquelle**) ist auf Apple Silicon M1–M4 mit einem Real-Time-Faktor von grob **~10×–30×** (d. h. **ca. 3–13 Minuten** für 90 min Audio bei **ca. 3–4,5 GB RAM**) zu rechnen. **Maßgeblich für die Go/No-Go-Entscheidung (Ziel: ≤ 15 min laut `09-NFA.md` §1) ist allein die echte Messung im Spike S5 auf dem Mac des Owners!**
- **Unsicher (S5-U2 – Speicherverhalten über 90 min am Stück mit `word_timestamps=True`):** Da für `word_timestamps=True` während der Dekodierung Cross-Attention-Matrizen berechnet werden, ist im Spike S5 über `/usr/bin/time -l` (`maximum resident set size`) zu prüfen, ob der Speicherverbrauch bei einer ungeteilten 90-min-Datei gegenüber 10-Minuten-Abschnitten merklich ansteigt.

### 3. Stolperfallen
1. **Große transitive Abhängigkeiten (`torch`, `numba`, `scipy`):** Obwohl `mlx-whisper` für die eigentliche Inferenz MLX nutzt, deklariert das Paket auf PyPI `torch`, `numba` und `scipy` als Pflichtabhängigkeiten. Das muss bei der Einrichtung des Worker-Pakets (`uv sync`) berücksichtigt werden.
2. **`hallucination_silence_threshold` wirkt nur mit `word_timestamps=True`:** In `mlx-whisper` greift das Überspringen stiller Abschnitte über `hallucination_silence_threshold` nur dann, wenn `word_timestamps=True` übergeben wird (was bei uns laut `05 §P4` ohnehin der Fall ist).
3. **Halluzinations-Schleifen bei Vorlesungspausen / Tafelanschrieb:** Wenn der Dozent längere Zeit still an die Tafel schreibt, neigt Whisper mit `condition_on_previous_text=True` dazu, den letzten Satz zu wiederholen oder Untertitel-Floskeln zu halluzinieren. **Pflicht-Parameter für den Aufruf:**
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
4. **Fortschrittsanzeige & Speicherbegrenzung bei 90-min-Dateien:** Verarbeitet man eine 90-min-Datei in einem einzigen `mlx_whisper.transcribe()`-Aufruf, lässt sich der Fortschritt (`session.processing` in der UI) schwer feingranular melden. Teilt der Worker die Audiodatei vorab in 10-Minuten-Abschnitte (oder schneidet an Stille-Stellen) und ruft nach jedem Abschnitt `mx.clear_cache()` auf, bleibt der RAM-Bedarf flach und der Fortschrittsbalken kann präzise nach jedem Block aktualisiert werden.

### 4. Konkreter Testplan für den Owner (Dauer: ca. 30 Minuten)

1. **Einzeiler-Benchmark im Terminal auf dem Mac des Owners starten (5 min Vorbereitung + Laufzeit):**
   ```bash
   # Echte 90-min-Vorlesungsdatei (oder 15-min-Aufnahme 6x zusammengefügt) auf dem Ziel-Mac messen:
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
2. **Prüfpunkte ablesen und in `docs/entscheidungen/S5.md` eintragen:**
   - [ ] Gemessene Laufzeit `dt` auf dem Mac des Owners ≤ 15 Minuten?
   - [ ] `maximum resident set size` aus `/usr/bin/time -l` prüfen (Vergleich: 90 min am Stück vs. 9 × 10-min-Abschnitte mit `mx.clear_cache()`).
   - [ ] Stichprobe von 10 Segmenten: Sind deutsche Sätze, englische Fachbegriffe und `words[].start`/`end` präzise und frei von Pausen-Halluzinationen?

### 5. Vorläufige Empfehlung zu S5
**`mlx-whisper` (`0.4.3`, MIT) mit `mlx-community/whisper-large-v3-turbo` (MIT) im Spike S5 auf dem Mac des Owners messen.** Bestätigt der Benchmark die Zielvorgabe (≤ 15 min für 90 min Audio), wird `mlx-whisper` mit `word_timestamps=True`, `condition_on_previous_text=False` und `hallucination_silence_threshold=2.0` (optional in 10-Minuten-Abschnitten für Fortschrittsanzeige und konstanten RAM) als Standard hinter dem `Transcriber`-Protokoll eingesetzt; `whisper.cpp` (MIT) dient als schlanke Rückfalloption ohne PyTorch/Numba-Abhängigkeit.

---

## Übersicht der untersuchten Bibliotheken & Lizenzen (für `docs/DRITTANBIETER.md`)

| Paket / Projekt | Spike | Aktuelle Version (Stand 11/2026) | Lizenz | Hinweise zu Abhängigkeiten & Copyleft |
|---|---|---|---|---|
| **`perfect-freehand`** (npm) | S3 | `1.2.3` | **MIT** | 0 Runtime-Dependencies; kein Copyleft, frei verwendbar in der Web-App |
| **`mlx-whisper`** (PyPI) | S5 | `0.4.3` | **MIT** | Kein Copyleft; zieht laut PyPI-Metadaten `mlx>=0.11`, `torch`, `numba`, `scipy`, `tiktoken`, `numpy`, `tqdm`, `more-itertools`, `huggingface-hub` ins Worker-Venv |
| **`mlx`** (PyPI, Abhängigkeit von `mlx-whisper`) | S5 | `>=0.11` (aktuell `0.32.x`) | **MIT** | Kein Copyleft |
| **`whisper-large-v3-turbo`** (Gewichte) | S5 | `v20240930` | **MIT** | Kein Copyleft |
| **`whisper.cpp`** (Alternative) | S5 | laufende Releases (nicht fest verifiziert) | **MIT** | Kein Copyleft, C/C++ ohne `torch`/`numba`-Abhängigkeit |
| **SideStore** (optionales Sideload-Tool auf dem Gerät des Owners) | S1 | externes Tool | **AGPL-3.0** | **Achtung (Copyleft):** Nur als externes Installationswerkzeug auf dem Mac/iPad des Owners nutzen, niemals als Code/Abhängigkeit ins Repo aufnehmen |
| **AltStore** (optionales Sideload-Tool auf dem Gerät des Owners) | S1 | externes Tool | **Unbelegt / im Repo zu prüfen** | Nur als externes Installationswerkzeug nutzen, kein Teil unseres Repos |
