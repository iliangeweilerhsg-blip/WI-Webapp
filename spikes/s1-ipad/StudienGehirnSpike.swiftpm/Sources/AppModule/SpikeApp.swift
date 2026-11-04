#if canImport(UIKit) && canImport(PencilKit)
import SwiftUI
import UIKit
import PencilKit
import Network
import VisionKit

// MARK: - App-Einstiegspunkt (Spike S1 + S3)

@main
struct StudienGehirnSpikeApp: App {
    @StateObject private var model = SpikeViewModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            SpikeMainView(model: model)
                .onChange(of: scenePhase) { _, newPhase in
                    if newPhase == .background || newPhase == .inactive {
                        model.saveDrawingsToDisk(trigger: "scenePhase=\(newPhase)")
                    }
                }
        }
    }
}

// MARK: - Werkzeug-Definition

enum SpikeDrawingTool: String, CaseIterable, Identifiable {
    case pen = "pen"
    case fountain = "fountain"
    case pencil = "pencil"
    case monoline = "monoline"
    case marker = "marker"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .pen: return "Stift (pen)"
        case .fountain: return "Füller (fountain)"
        case .pencil: return "Bleistift (pencil)"
        case .monoline: return "Monoline"
        case .marker: return "Textmarker (unten)"
        }
    }

    var layerName: String {
        self == .marker ? "highlight" : "ink"
    }

    var defaultWidth: CGFloat {
        self == .marker ? 18.0 : 2.8
    }

    func makePKTool() -> PKInkingTool {
        switch self {
        case .pen:
            return PKInkingTool(.pen, color: UIColor(red: 0.12, green: 0.16, blue: 0.27, alpha: 1.0), width: 2.8)
        case .fountain:
            return PKInkingTool(.fountainPen, color: UIColor(red: 0.08, green: 0.24, blue: 0.55, alpha: 1.0), width: 3.2)
        case .pencil:
            return PKInkingTool(.pencil, color: UIColor(red: 0.22, green: 0.25, blue: 0.30, alpha: 1.0), width: 3.0)
        case .monoline:
            return PKInkingTool(.monoline, color: UIColor(red: 0.06, green: 0.46, blue: 0.35, alpha: 1.0), width: 2.6)
        case .marker:
            return PKInkingTool(.marker, color: UIColor(red: 0.98, green: 0.88, blue: 0.20, alpha: 0.45), width: 18.0)
        }
    }
}

// MARK: - ViewModel für S1 (Plattform-Prüfpunkte) & S3 (Strich-Spiegelung + Rohwerte)

@MainActor
final class SpikeViewModel: NSObject, ObservableObject {
    // Prüfpunkte (✓ / ✗)
    @Published var checkSelfTestOk: Bool = false
    @Published var checkBonjourDialogSeen: Bool = false
    @Published var checkWebSocketConnected: Bool = false
    @Published var checkCameraOk: Bool = false
    @Published var checkDoubleTapOk: Bool = false
    @Published var checkSavedOk: Bool = false
    @Published var checkLoadedOk: Bool = false

    // Aktives Werkzeug & Verbindung
    @Published var selectedTool: SpikeDrawingTool = .pen
    @Published var previousNonMarkerTool: SpikeDrawingTool = .pen
    @Published var manualHostPort: String = "192.168.1.100:4797"
    @Published var connectionStatusText: String = "Nicht verbunden"
    @Published var clockOffsetMs: Double = 0.0
    @Published var lastRttMs: Double = 0.0
    @Published var sentStrokeCount: Int = 0
    @Published var lastPhotoSummary: String = "Noch kein Foto"

    // Zeichnungen für die zwei PKCanvasView-Ebenen
    @Published var highlightDrawing = PKDrawing()
    @Published var inkDrawing = PKDrawing()

    // Gesendete Strich-Signaturen, um nur neue Striche zu schicken
    var knownHighlightCount: Int = 0
    var knownInkCount: Int = 0

    // Rohwert-Sammlung: Schlüssel "<tool>-<pencil|finger>"
    private var rawPointsByBucket: [String: [RawPointMeasurement]] = [:]
    private var strokeCountByBucket: [String: Int] = [:]
    @Published var rawSummaries: [ToolInputRawSummary] = []

    // Ereignis-Log
    @Published var logs: [String] = []

    let sessionStartMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000.0)
    private var browser: NWBrowser?
    private var wsTask: URLSessionWebSocketTask?
    private var pingTimer: Timer?

    override init() {
        super.init()
        runStartupChecks()
    }

    private func runStartupChecks() {
        let selfTest = StrokeFormatSelfTest.run()
        checkSelfTestOk = selfTest.passed
        addLog("Selbsttest 08 §4.2: \(selfTest.passed ? "✓" : "✗") – \(selfTest.message)")
        loadDrawingsFromDisk()
    }

    func addLog(_ message: String) {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss.SSS"
        let ts = formatter.string(from: Date())
        logs.insert("[\(ts)] \(message)", at: 0)
        if logs.count > 120 {
            logs.removeLast()
        }
    }

    // MARK: - (1) Werkzeug-Umschaltung & Apple-Pencil-Doppeltipp

    func handlePencilDoubleTap(source: String) {
        checkDoubleTapOk = true
        if selectedTool == .marker {
            selectedTool = previousNonMarkerTool
        } else {
            previousNonMarkerTool = selectedTool
            selectedTool = .marker
        }
        addLog("Doppeltipp erkannt (\(source)) -> Wechsel auf \(selectedTool.label)")
        sendCheckpointUpdateToMac()
    }

    func selectTool(_ tool: SpikeDrawingTool) {
        if tool != .marker {
            previousNonMarkerTool = tool
        }
        selectedTool = tool
    }

    // MARK: - (3) Bonjour-Suche (_studiengehirn._tcp) & WebSocket-Verbindung

    func startBonjourSearch() {
        browser?.cancel()
        let params = NWParameters.tcp
        let descriptor = NWBrowser.Descriptor.bonjour(type: "_studiengehirn._tcp", domain: nil)
        let nwBrowser = NWBrowser(for: descriptor, using: params)
        self.browser = nwBrowser

        addLog("Starte NWBrowser auf _studiengehirn._tcp …")

        nwBrowser.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self else { return }
                switch state {
                case .ready:
                    self.checkBonjourDialogSeen = true
                    self.addLog("NWBrowser bereit (Local-Network-Berechtigung aktiv ✓).")
                    self.sendCheckpointUpdateToMac()
                case .waiting(let err):
                    self.addLog("NWBrowser wartet (\(err.localizedDescription)) – bitte Dialog bestätigen.")
                case .failed(let err):
                    self.addLog("NWBrowser Fehler: \(err.localizedDescription) (Fallback: IP manuell eingeben).")
                default:
                    break
                }
            }
        }

        nwBrowser.browseResultsChangedHandler = { [weak self] results, _ in
            Task { @MainActor in
                guard let self else { return }
                guard let first = results.first else { return }
                self.checkBonjourDialogSeen = true
                self.addLog("Bonjour-Dienst gefunden: \(first.endpoint.debugDescription)")
                self.resolveAndConnect(endpoint: first.endpoint)
            }
        }

        nwBrowser.start(queue: .main)
    }

    private func resolveAndConnect(endpoint: NWEndpoint) {
        let conn = NWConnection(to: endpoint, using: .tcp)
        conn.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self else { return }
                if case .ready = state,
                   let innerEndpoint = conn.currentPath?.remoteEndpoint,
                   case .hostPort(let host, let port) = innerEndpoint {
                    let rawHost = "\(host)".split(separator: "%").first.map(String.init) ?? "\(host)"
                    let hostPort = "\(rawHost):\(port.rawValue)"
                    self.manualHostPort = hostPort
                    conn.cancel()
                    self.connectWebSocket(hostPort: hostPort)
                }
            }
        }
        conn.start(queue: .main)
    }

    func connectManualWebSocket() {
        let trimmed = manualHostPort.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        connectWebSocket(hostPort: trimmed)
    }

    func connectWebSocket(hostPort: String) {
        wsTask?.cancel(with: .goingAway, reason: nil)
        pingTimer?.invalidate()

        let normalized = hostPort.contains(":") ? hostPort : "\(hostPort):4797"
        guard let url = URL(string: "ws://\(normalized)/ws") else {
            addLog("Ungültige WebSocket-Adresse: \(normalized)")
            return
        }

        connectionStatusText = "Verbinde mit \(normalized) …"
        addLog("Öffne WebSocket zu \(url.absoluteString) …")

        let task = URLSession.shared.webSocketTask(with: url)
        self.wsTask = task
        task.resume()

        receiveNextMessage()
        sendSyncPing()

        pingTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.sendSyncPing()
            }
        }
    }

    private func sendSyncPing() {
        guard let wsTask else { return }
        let tClientSend = Date().timeIntervalSince1970 * 1000.0
        let msg: [String: Any] = [
            "type": "ping",
            "t_client_send_ms": tClientSend
        ]
        sendJsonDictionary(msg, over: wsTask)
    }

    private func receiveNextMessage() {
        guard let wsTask else { return }
        wsTask.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .success(let message):
                    if !self.checkWebSocketConnected {
                        self.checkWebSocketConnected = true
                        self.connectionStatusText = "Verbunden (\(self.manualHostPort))"
                        self.addLog("WebSocket verbunden ✓.")
                        self.sendCheckpointUpdateToMac()
                    }
                    if case .string(let text) = message {
                        self.handleIncomingText(text)
                    }
                    self.receiveNextMessage()
                case .failure(let err):
                    self.checkWebSocketConnected = false
                    self.connectionStatusText = "Getrennt (\(err.localizedDescription))"
                    self.addLog("WebSocket getrennt: \(err.localizedDescription)")
                }
            }
        }
    }

    private func handleIncomingText(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            return
        }

        if type == "pong",
           let tClientSend = json["t_client_send_ms"] as? Double,
           let tServer = json["t_server_ms"] as? Double {
            let tClientRecv = Date().timeIntervalSince1970 * 1000.0
            let rtt = max(0.0, tClientRecv - tClientSend)
            let estimatedServerNow = tServer + (rtt / 2.0)
            self.lastRttMs = (rtt * 10.0).rounded() / 10.0
            self.clockOffsetMs = ((estimatedServerNow - tClientRecv) * 10.0).rounded() / 10.0
        }
    }

    // MARK: - (4) Fertigen Strich in 08 §4.1/§4.2 konvertieren & an Mac senden

    func handleNewPKStroke(_ stroke: PKStroke, layer: String) {
        let converted = StrokeFormat.fromPKStroke(
            stroke,
            layer: layer,
            fallbackWidth: Double(selectedTool.defaultWidth),
            sessionStartMs: sessionStartMs,
            clockOffsetMs: clockOffsetMs
        )

        recordRawMeasurements(
            tool: converted.payload.tool,
            isPencil: converted.isPencilInput,
            samples: converted.rawSamples
        )

        guard let wsTask, checkWebSocketConnected else {
            addLog("Strich lokal erfasst (\(converted.payload.tool), \(converted.rawSamples.count) Pkt.) – noch nicht mit Mac verbunden.")
            return
        }

        guard let strokeData = try? JSONEncoder().encode(converted.payload),
              let strokeObj = try? JSONSerialization.jsonObject(with: strokeData) as? [String: Any] else {
            return
        }

        let envelope: [String: Any] = [
            "type": "stroke.add",
            "t_pen_up_ms": converted.payload.t_pen_up_ms ?? (Date().timeIntervalSince1970 * 1000.0 + clockOffsetMs),
            "stroke": strokeObj
        ]
        sendJsonDictionary(envelope, over: wsTask)
        sentStrokeCount += 1
    }

    // MARK: - (5) Speichern & Laden von PKDrawing.dataRepresentation()

    private func storageDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("StudienGehirnSpike", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func saveDrawingsToDisk(trigger: String) {
        let dir = storageDirectory()
        let inkUrl = dir.appendingPathComponent("ink.pkdrawing")
        let highlightUrl = dir.appendingPathComponent("highlight.pkdrawing")
        do {
            try inkDrawing.dataRepresentation().write(to: inkUrl, options: .atomic)
            try highlightDrawing.dataRepresentation().write(to: highlightUrl, options: .atomic)
            checkSavedOk = true
            addLog("PKDrawing gespeichert ✓ (\(trigger): \(inkDrawing.strokes.count) Schrift- / \(highlightDrawing.strokes.count) Marker-Striche).")
            sendCheckpointUpdateToMac()
        } catch {
            addLog("FEHLER beim Speichern: \(error.localizedDescription)")
        }
    }

    func loadDrawingsFromDisk() {
        let dir = storageDirectory()
        let inkUrl = dir.appendingPathComponent("ink.pkdrawing")
        let highlightUrl = dir.appendingPathComponent("highlight.pkdrawing")
        var loadedAny = false

        if let inkData = try? Data(contentsOf: inkUrl),
           let loadedInk = try? PKDrawing(data: inkData) {
            inkDrawing = loadedInk
            knownInkCount = loadedInk.strokes.count
            loadedAny = true
        }
        if let hiData = try? Data(contentsOf: highlightUrl),
           let loadedHi = try? PKDrawing(data: hiData) {
            highlightDrawing = loadedHi
            knownHighlightCount = loadedHi.strokes.count
            loadedAny = true
        }

        if loadedAny {
            checkLoadedOk = true
            addLog("Gespeicherte PKDrawing beim Start geladen ✓ (\(inkDrawing.strokes.count) Schrift- / \(highlightDrawing.strokes.count) Marker-Striche).")
        } else {
            addLog("Noch keine gespeicherte PKDrawing vorhanden (erster Start).")
        }
    }

    func clearCanvas() {
        inkDrawing = PKDrawing()
        highlightDrawing = PKDrawing()
        knownInkCount = 0
        knownHighlightCount = 0
        addLog("Zeichenfläche geleert.")
    }

    // MARK: - (6) Rohwerte (force, altitude, azimuth, size) je Werkzeug & Pencil/Finger

    private func recordRawMeasurements(
        tool: String,
        isPencil: Bool,
        samples: [RawPointMeasurement]
    ) {
        guard !samples.isEmpty else { return }
        let inputType = isPencil ? "pencil" : "finger"
        let key = "\(tool)|\(inputType)"
        var existing = rawPointsByBucket[key] ?? []
        existing.append(contentsOf: samples)
        rawPointsByBucket[key] = existing
        strokeCountByBucket[key] = (strokeCountByBucket[key] ?? 0) + 1
        recomputeRawSummaries()
    }

    private func recomputeRawSummaries() {
        var list: [ToolInputRawSummary] = []
        for (key, pts) in rawPointsByBucket.sorted(by: { $0.key < $1.key }) {
            let parts = key.split(separator: "|").map(String.init)
            guard parts.count == 2 else { continue }
            let tool = parts[0]
            let inputType = parts[1]
            let sCount = strokeCountByBucket[key] ?? 1
            list.append(
                ToolInputRawSummary(
                    tool: tool,
                    inputType: inputType,
                    strokeCount: sCount,
                    pointCount: pts.count,
                    force: MetricMinMedMax.compute(from: pts.map(\.force)),
                    altitude: MetricMinMedMax.compute(from: pts.map(\.altitude)),
                    azimuth: MetricMinMedMax.compute(from: pts.map(\.azimuth)),
                    sizeWidth: MetricMinMedMax.compute(from: pts.map(\.sizeWidth)),
                    sizeHeight: MetricMinMedMax.compute(from: pts.map(\.sizeHeight))
                )
            )
        }
        rawSummaries = list
    }

    func sendRawStatsToMac() {
        guard let wsTask, checkWebSocketConnected else {
            addLog("Kann Rohwerte nicht senden: Nicht mit Mac verbunden.")
            return
        }
        guard let data = try? JSONEncoder().encode(rawSummaries),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return
        }
        let msg: [String: Any] = [
            "type": "raw_stats",
            "sent_at_ms": Date().timeIntervalSince1970 * 1000.0,
            "summaries": arr
        ]
        sendJsonDictionary(msg, over: wsTask)
        addLog("Rohwerte (\(rawSummaries.count) Einträge) an Mac gesendet ✓.")
    }

    func sendCheckpointUpdateToMac() {
        guard let wsTask, checkWebSocketConnected else { return }
        let msg: [String: Any] = [
            "type": "checkpoints",
            "checkpoints": [
                "selftest_08_4_2": checkSelfTestOk,
                "bonjour_dialog": checkBonjourDialogSeen,
                "websocket_connected": checkWebSocketConnected,
                "camera_ok": checkCameraOk,
                "double_tap_ok": checkDoubleTapOk,
                "saved_ok": checkSavedOk,
                "loaded_ok": checkLoadedOk
            ]
        ]
        sendJsonDictionary(msg, over: wsTask)
    }

    private func sendJsonDictionary(_ dict: [String: Any], over task: URLSessionWebSocketTask) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let text = String(data: data, encoding: .utf8) else {
            return
        }
        task.send(.string(text)) { [weak self] err in
            if let err {
                Task { @MainActor in
                    self?.addLog("Sende-Fehler: \(err.localizedDescription)")
                }
            }
        }
    }
}

// MARK: - Hauptansicht (Zeichenfläche, Rohwerte-Bildschirm & Prüfpunkt-Log)

struct SpikeMainView: View {
    @ObservedObject var model: SpikeViewModel
    @State private var activeTab: Int = 0
    @State private var showCameraSheet: Bool = false

    var body: some View {
        VStack(spacing: 8) {
            // Kopfzeile: Prüfpunkte (✓ / ✗) auf einen Blick
            checkpointBar

            // Verbindung & Werkzeugleiste
            controlToolbar

            Picker("Ansicht", selection: $activeTab) {
                Text("1. Zeichenfläche (2 Ebenen)").tag(0)
                Text("2. Rohwerte (Pencil vs. Finger)").tag(1)
                Text("3. Prüfpunkte & Log").tag(2)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 12)

            if activeTab == 0 {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.white)
                        .shadow(color: .black.opacity(0.08), radius: 4)

                    DualPKCanvasContainer(model: model)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
            } else if activeTab == 1 {
                rawStatsView
            } else {
                logAndCheckpointsView
            }
        }
        .background(Color(UIColor.systemGroupedBackground))
        .background(PencilInteractionHostView(onDoubleTap: {
            model.handlePencilDoubleTap(source: "UIPencilInteraction")
        }))
        .sheet(isPresented: $showCameraSheet) {
            CameraPickerRepresentable { imageSize in
                model.checkCameraOk = true
                model.lastPhotoSummary = "\(Int(imageSize.width))×\(Int(imageSize.height)) px"
                model.addLog("Tafel-Foto aufgenommen ✓ (\(model.lastPhotoSummary)).")
                model.sendCheckpointUpdateToMac()
            }
        }
    }

    private var checkpointBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                checkpointBadge("08 §4.2", ok: model.checkSelfTestOk)
                checkpointBadge("Bonjour", ok: model.checkBonjourDialogSeen)
                checkpointBadge("Verbunden", ok: model.checkWebSocketConnected)
                checkpointBadge("Kamera", ok: model.checkCameraOk)
                checkpointBadge("Doppeltipp", ok: model.checkDoubleTapOk)
                checkpointBadge("Gespeichert", ok: model.checkSavedOk)
                checkpointBadge("Geladen", ok: model.checkLoadedOk)
                Text("RTT: \(String(format: "%.1f", model.lastRttMs)) ms | Striche: \(model.sentStrokeCount)")
                    .font(.caption.monospacedDigit())
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
        }
    }

    private func checkpointBadge(_ title: String, ok: Bool) -> some View {
        HStack(spacing: 4) {
            Text(ok ? "✓" : "✗")
                .fontWeight(.bold)
            Text(title)
        }
        .font(.caption)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(ok ? Color.green.opacity(0.2) : Color.red.opacity(0.15))
        .foregroundColor(ok ? .green : .red)
        .cornerRadius(6)
    }

    private var controlToolbar: some View {
        VStack(spacing: 6) {
            HStack(spacing: 8) {
                Button("Mac suchen (Bonjour)") {
                    model.startBonjourSearch()
                }
                .buttonStyle(.borderedProminent)

                TextField("IP:Port (z.B. 192.168.1.20:4797)", text: $model.manualHostPort)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 220)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)

                Button("IP verbinden") {
                    model.connectManualWebSocket()
                }
                .buttonStyle(.bordered)

                Button("Tafel-Foto") {
                    showCameraSheet = true
                }
                .buttonStyle(.bordered)

                Button("Speichern") {
                    model.saveDrawingsToDisk(trigger: "Manuell")
                }
                .buttonStyle(.bordered)

                Button("Leeren", role: .destructive) {
                    model.clearCanvas()
                }
                .buttonStyle(.bordered)
            }

            HStack(spacing: 8) {
                Text("Werkzeug:")
                    .font(.caption)
                    .foregroundColor(.secondary)
                ForEach(SpikeDrawingTool.allCases) { tool in
                    Button(tool.label) {
                        model.selectTool(tool)
                    }
                    .buttonStyle(.bordered)
                    .tint(model.selectedTool == tool ? .blue : .secondary)
                }
            }
        }
        .padding(.horizontal, 12)
    }

    private var rawStatsView: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Gemessene Rohwerte (force, altitude, azimuth, size) – getrennt nach Pencil & Finger")
                    .font(.headline)
                Spacer()
                Button("An Mac senden") {
                    model.sendRawStatsToMac()
                }
                .buttonStyle(.borderedProminent)
            }

            if model.rawSummaries.isEmpty {
                Text("Noch keine Striche gezeichnet. Zeichne im ersten Tab mit dem Apple Pencil und mit dem Finger!")
                    .foregroundColor(.secondary)
                    .padding()
                Spacer()
            } else {
                List(model.rawSummaries) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(item.tool.uppercased()) · Eingabe: \(item.inputType.uppercased()) (\(item.strokeCount) Striche, \(item.pointCount) Punkte)")
                            .font(.subheadline.bold())
                        Text("force:    min=\(item.force.min) | med=\(item.force.median) | max=\(item.force.max)")
                            .font(.caption.monospaced())
                        Text("altitude: min=\(item.altitude.min) | med=\(item.altitude.median) | max=\(item.altitude.max) rad")
                            .font(.caption.monospaced())
                        Text("azimuth:  min=\(item.azimuth.min) | med=\(item.azimuth.median) | max=\(item.azimuth.max) rad")
                            .font(.caption.monospaced())
                        Text("size.w/h: w=[min=\(item.sizeWidth.min), med=\(item.sizeWidth.median), max=\(item.sizeWidth.max)] h=[med=\(item.sizeHeight.median)]")
                            .font(.caption.monospaced())
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .padding(12)
    }

    private var logAndCheckpointsView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Prüfpunkt-Protokoll (S1 + S3)")
                    .font(.headline)
                Spacer()
                Button("Prüfstatus an Mac senden") {
                    model.sendCheckpointUpdateToMac()
                }
                .buttonStyle(.bordered)
            }
            List(model.logs, id: \.self) { entry in
                Text(entry)
                    .font(.caption.monospaced())
            }
        }
        .padding(12)
    }
}

// MARK: - Zwei gestapelte PKCanvasView-Ebenen (unten Textmarker, oben Schrift)

struct DualPKCanvasContainer: UIViewRepresentable {
    @ObservedObject var model: SpikeViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .white

        let highlightCanvas = PKCanvasView()
        highlightCanvas.translatesAutoresizingMaskIntoConstraints = false
        highlightCanvas.isOpaque = false
        highlightCanvas.backgroundColor = .clear
        highlightCanvas.drawingPolicy = .anyInput
        highlightCanvas.drawing = model.highlightDrawing
        highlightCanvas.delegate = context.coordinator

        let inkCanvas = PKCanvasView()
        inkCanvas.translatesAutoresizingMaskIntoConstraints = false
        inkCanvas.isOpaque = false
        inkCanvas.backgroundColor = .clear
        inkCanvas.drawingPolicy = .anyInput
        inkCanvas.drawing = model.inkDrawing
        inkCanvas.delegate = context.coordinator

        container.addSubview(highlightCanvas)
        container.addSubview(inkCanvas)

        NSLayoutConstraint.activate([
            highlightCanvas.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            highlightCanvas.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            highlightCanvas.topAnchor.constraint(equalTo: container.topAnchor),
            highlightCanvas.bottomAnchor.constraint(equalTo: container.bottomAnchor),

            inkCanvas.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            inkCanvas.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            inkCanvas.topAnchor.constraint(equalTo: container.topAnchor),
            inkCanvas.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])

        context.coordinator.highlightCanvas = highlightCanvas
        context.coordinator.inkCanvas = inkCanvas
        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        guard let highlightCanvas = context.coordinator.highlightCanvas,
              let inkCanvas = context.coordinator.inkCanvas else {
            return
        }

        let pkTool = model.selectedTool.makePKTool()
        if model.selectedTool == .marker {
            // Textmarker zeichnet auf der unteren Ebene (`highlight`), damit er schwarze Schrift nicht überdeckt
            highlightCanvas.tool = pkTool
            highlightCanvas.isUserInteractionEnabled = true
            inkCanvas.isUserInteractionEnabled = false
        } else {
            inkCanvas.tool = pkTool
            inkCanvas.isUserInteractionEnabled = true
            highlightCanvas.isUserInteractionEnabled = false
        }
    }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        let model: SpikeViewModel
        weak var highlightCanvas: PKCanvasView?
        weak var inkCanvas: PKCanvasView?

        init(model: SpikeViewModel) {
            self.model = model
        }

        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            Task { @MainActor in
                if canvasView === highlightCanvas {
                    model.highlightDrawing = canvasView.drawing
                    let strokes = canvasView.drawing.strokes
                    if strokes.count > model.knownHighlightCount {
                        for idx in model.knownHighlightCount..<strokes.count {
                            model.handleNewPKStroke(strokes[idx], layer: "highlight")
                        }
                    }
                    model.knownHighlightCount = strokes.count
                } else if canvasView === inkCanvas {
                    model.inkDrawing = canvasView.drawing
                    let strokes = canvasView.drawing.strokes
                    if strokes.count > model.knownInkCount {
                        for idx in model.knownInkCount..<strokes.count {
                            model.handleNewPKStroke(strokes[idx], layer: "ink")
                        }
                    }
                    model.knownInkCount = strokes.count
                }
            }
        }
    }
}

// MARK: - UIPencilInteraction für Doppeltipp am Apple Pencil 2 (und optional Squeeze ab iOS 17.5)

struct PencilInteractionHostView: UIViewRepresentable {
    let onDoubleTap: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onDoubleTap: onDoubleTap)
    }

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        let interaction = UIPencilInteraction()
        interaction.delegate = context.coordinator
        view.addInteraction(interaction)
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {}

    final class Coordinator: NSObject, UIPencilInteractionDelegate {
        let onDoubleTap: () -> Void

        init(onDoubleTap: @escaping () -> Void) {
            self.onDoubleTap = onDoubleTap
        }

        func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
            onDoubleTap()
        }

        @available(iOS 17.5, *)
        func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
            // Optional für Pencil Pro; für Pencil 2 (Q1) genügt Doppeltipp
            if squeeze.phase == .ended {
                onDoubleTap()
            }
        }
    }
}

// MARK: - Kamera-Picker für Tafel-Foto (UIImagePickerController mit Simulator-Fallback)

struct CameraPickerRepresentable: UIViewControllerRepresentable {
    let onImagePicked: (CGSize) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator {
        Coordinator(onImagePicked: onImagePicked, dismiss: dismiss)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            picker.sourceType = .camera
        } else {
            picker.sourceType = .photoLibrary
        }
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let onImagePicked: (CGSize) -> Void
        let dismiss: DismissAction

        init(onImagePicked: @escaping (CGSize) -> Void, dismiss: DismissAction) {
            self.onImagePicked = onImagePicked
            self.dismiss = dismiss
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let img = info[.originalImage] as? UIImage {
                onImagePicked(img.size)
            } else {
                onImagePicked(CGSize(width: 1024, height: 768))
            }
            dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            dismiss()
        }
    }
}
#endif
