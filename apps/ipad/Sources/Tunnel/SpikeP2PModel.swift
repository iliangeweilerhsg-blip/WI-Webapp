import Foundation
// @preconcurrency: Ältere SDKs kennzeichnen die Network-Typen noch nicht als Sendable
@preconcurrency import Network
import Observation
import UIKit

// Spike S6 (UX-12, PR 1): Testansicht „Direktverbindung testen“. Gut versteckt unter Verbindungsdetails → Entwickler.
// Eigene Verbindungen zum Mac-Spike (SpikeShared), nie `CoreClient`, nie das Geräte-Token, keine Daten der App.
// Der Spike wird mit PR 4 wieder entfernt (Plan).
// Hinweis: Hier steht `_Concurrency.Task`, weil Schemas.swift im App-Modul `Task` verdeckt.

enum SpikeWay: String, CaseIterable, Identifiable {
    case network
    case direct

    var id: String { rawValue }

    var label: String {
        switch self {
        case .network: return "Über das Netz"
        case .direct: return "Direkt erlaubt"
        }
    }

    var explanation: String {
        switch self {
        case .network:
            return "Nur das gemeinsame WLAN. Zeigt, ob iPad und Mac sich dort überhaupt sehen."
        case .direct:
            return "Wi-Fi peer-to-peer ist erlaubt. Das System wählt den Weg und die Zeile „Weg“ zeigt, welchen."
        }
    }

    var allowsPeerToPeer: Bool { self == .direct }
}

enum SpikeStepState: Equatable {
    case waiting
    case running
    case succeeded
    case failed
}

struct SpikeStep: Identifiable, Equatable {
    let id: String
    let title: String
    var state: SpikeStepState = .waiting
    var detail: String = ""
}

/// Zähler des Dauertests
struct SpikeLongRun: Equatable {
    var running = false
    var startedAt: Date?
    var endedAt: Date?
    var pings = 0
    var aborts = 0
    var rebuilds = 0
    var longestOutageSeconds: Double = 0
    var rttSumMillis: Double = 0
    var rttMaxMillis: Double = 0
    var batteryStart: Int?
    var batteryEnd: Int?

    var averageMillis: Double { pings > 0 ? rttSumMillis / Double(pings) : 0 }
}

/// Zahlen und Zeiten als deutscher Text. Reine Funktionen, damit sie testbar sind.
enum SpikeP2PFormat {
    static func number(_ value: Double, digits: Int = 1) -> String {
        String(format: "%.\(digits)f", value).replacingOccurrences(of: ".", with: ",")
    }

    static func seconds(_ value: Double) -> String {
        "\(number(value, digits: value < 10 ? 2 : 1)) s"
    }

    static func megabytesPerSecond(_ value: Double) -> String {
        "\(number(value, digits: 2)) MB/s"
    }

    /// „93 min 05 s“
    static func duration(_ interval: TimeInterval) -> String {
        let total = max(0, Int(interval.rounded()))
        let minutes = total / 60
        let rest = total % 60
        return "\(minutes) min \(rest < 10 ? "0" : "")\(rest) s"
    }

    static func battery(_ percent: Int?) -> String {
        percent.map { "\($0) %" } ?? "unbekannt"
    }
}

@MainActor
@Observable
final class SpikeP2PModel {
    static let shared = SpikeP2PModel()

    var codeText = ""
    var way: SpikeWay = .direct
    private(set) var steps: [SpikeStep] = SpikeP2PModel.initialSteps
    private(set) var logLines: [String] = []
    private(set) var isBusy = false
    private(set) var longRun = SpikeLongRun()

    /// Datei für „Protokoll teilen“. Enthält keine Namen und keine Adressen.
    let exportURL: URL

    @ObservationIgnored private var logStart = Date()
    @ObservationIgnored private var found: SpikeFound?
    @ObservationIgnored private var longTask: _Concurrency.Task<Void, Never>?

    static let initialSteps: [SpikeStep] = [
        SpikeStep(id: "find", title: "Dienst gefunden?"),
        SpikeStep(id: "network", title: "Handshake über das Netz (ohne peer-to-peer)"),
        SpikeStep(id: "direct", title: "Handshake mit peer-to-peer"),
        SpikeStep(id: "ping", title: "Erste Antwort (ping)"),
        SpikeStep(id: "health", title: "health: Antwort des Core"),
        SpikeStep(id: "download", title: "Durchsatz: 20 MB vom Mac laden"),
        SpikeStep(id: "echo", title: "Durchsatz: 20 MB hin und zurück"),
    ]

    init() {
        exportURL = FileManager.default.temporaryDirectory.appendingPathComponent("p2p-spike-protokoll.txt")
        writeExport()
    }

    // MARK: Anzeige

    var code: SpikeCode? { SpikeCode(input: codeText) }

    var canStart: Bool { code != nil && !isBusy && !longRun.running }

    var logText: String { logLines.joined(separator: "\n") }

    // MARK: Prüfung

    func runAll() {
        guard canStart, let code else { return }
        isBusy = true
        steps = SpikeP2PModel.initialSteps
        startLog(title: "Prüfung")
        _Concurrency.Task {
            await self.performAll(code: code)
            self.isBusy = false
        }
    }

    func runCipherMatrix() {
        guard canStart, let code else { return }
        isBusy = true
        startLog(title: "TLS-Verfahren")
        _Concurrency.Task {
            await self.performCipherMatrix(code: code)
            self.isBusy = false
        }
    }

    func clearLog() {
        logLines = []
        steps = SpikeP2PModel.initialSteps
        writeExport()
    }

    private func performAll(code: SpikeCode) async {
        // 1. Dienst finden
        update("find", .running, "")
        log("Suche den Dienst (bis 12 s) …")
        guard let hit = await SpikeBrowserTool.find(name: code.serviceName, timeout: 12) else {
            update("find", .failed, "nicht gefunden")
            log(
                "Dienst nicht gefunden. Läuft der Mac-Teil, stimmt der Code, ist WLAN an beiden Geräten an, "
                    + "und ist „Lokales Netzwerk“ für die App erlaubt?")
            return
        }
        found = hit
        let seen = hit.interfaces.isEmpty ? "–" : hit.interfaces.joined(separator: ", ")
        update("find", .succeeded, "nach \(SpikeP2PFormat.seconds(hit.seconds)), gesehen über: \(seen)")
        log("Dienst gefunden nach \(SpikeP2PFormat.seconds(hit.seconds)), gesehen über: \(seen)")

        // 2. und 3. Beide Stufen des Plans einzeln messen (N7)
        update("network", .running, "")
        let stage1 = await connect(code: code, hit: hit, suites: SpikeSuites.all, peerToPeer: false, timeout: 5)
        update("network", stage1.ok ? .succeeded : .failed, stage1.text)
        log("Ohne peer-to-peer: \(stage1.text)")
        stage1.client.close()

        update("direct", .running, "")
        let stage2 = await connect(code: code, hit: hit, suites: SpikeSuites.all, peerToPeer: true, timeout: 15)
        update("direct", stage2.ok ? .succeeded : .failed, stage2.text)
        log("Mit peer-to-peer: \(stage2.text)")
        stage2.client.close()

        // 4. bis 7. mit dem gewählten Weg
        log("Weiter mit dem Weg „\(way.label)“")
        let started = Date()
        let tester = await connect(
            code: code, hit: hit, suites: SpikeSuites.all, peerToPeer: way.allowsPeerToPeer, timeout: 15)
        defer { tester.client.close() }
        guard tester.ok else {
            for id in ["ping", "health", "download", "echo"] { update(id, .failed, "keine Verbindung") }
            log("Gewählter Weg ohne Verbindung, die Messungen entfallen.")
            return
        }

        await step("ping") {
            let rtt = try await tester.client.ping()
            let first = Date().timeIntervalSince(started)
            return "\(SpikeP2PFormat.number(rtt)) ms Rundlauf, \(SpikeP2PFormat.seconds(first)) vom Start bis zur ersten Antwort"
        }
        await step("health") {
            let answer = try await tester.client.health()
            if answer.reply.httpStatus == 0 {
                return "Der Mac erreicht seinen Core nicht (läuft er?), Rundlauf \(SpikeP2PFormat.number(answer.roundTripMillis)) ms"
            }
            return "HTTP \(answer.reply.httpStatus), Core antwortete in \(answer.reply.millis) ms, Rundlauf \(SpikeP2PFormat.number(answer.roundTripMillis)) ms"
        }
        await step("download") {
            let result = try await tester.client.downloadBlob(megabytes: 20)
            return "\(SpikeP2PFormat.megabytesPerSecond(result.megabytesPerSecondDown)) in \(SpikeP2PFormat.seconds(result.seconds))"
        }
        await step("echo") {
            let result = try await tester.client.echoThroughput(totalBytes: 20 * SpikeLimits.bytesPerMegabyte)
            let speed = SpikeP2PFormat.megabytesPerSecond(result.megabytesPerSecondUp)
            return "\(speed) je Richtung in \(SpikeP2PFormat.seconds(result.seconds))"
        }
        log("Prüfung fertig.")
    }

    /// Ein Schritt mit Fehlerbehandlung. Die Zeile bekommt den Text oder die Fehlermeldung.
    private func step(_ id: String, _ work: () async throws -> String) async {
        update(id, .running, "")
        do {
            let text = try await work()
            update(id, .succeeded, text)
            log("\(title(of: id)): \(text)")
        } catch {
            update(id, .failed, "\(error)")
            log("\(title(of: id)): FEHLER \(error)")
        }
    }

    private func performCipherMatrix(code: SpikeCode) async {
        let hit: SpikeFound
        if let known = found, known.name == code.serviceName {
            hit = known
        } else {
            log("Suche den Dienst (bis 12 s) …")
            guard let fresh = await SpikeBrowserTool.find(name: code.serviceName, timeout: 12) else {
                log("Dienst nicht gefunden.")
                return
            }
            found = fresh
            hit = fresh
        }
        log("Weg für die Messung: „\(way.label)“")
        var worked: [SpikeSuite] = []
        for suite in SpikeSuites.all {
            let attempt = await connect(
                code: code, hit: hit, suites: [suite], peerToPeer: way.allowsPeerToPeer, timeout: 8)
            var line = attempt.text
            if attempt.ok {
                if (try? await attempt.client.ping(timeout: 4)) != nil {
                    worked.append(suite)
                } else {
                    line += ", aber ping ohne Antwort"
                }
            }
            attempt.client.close()
            log("\(suite.name): \(attempt.ok ? "gelungen" : "gescheitert") · \(line)")
        }
        let all = await connect(
            code: code, hit: hit, suites: SpikeSuites.all, peerToPeer: way.allowsPeerToPeer, timeout: 8)
        log("Alle drei angeboten: \(all.text)")
        all.client.close()
        let ecdhe = worked.contains { $0.forwardSecret }
        log(
            ecdhe
                ? "Ergebnis: Mindestens ein ECDHE_PSK-Verfahren geht (Schutz alter Mitschnitte)."
                : "Ergebnis: Kein ECDHE_PSK-Verfahren ging. Nur PSK ohne ECDHE wäre möglich (Restrisiko R-B).")
    }

    private struct Attempt {
        let client: SpikeClient
        let ok: Bool
        let text: String
    }

    private func connect(
        code: SpikeCode, hit: SpikeFound, suites: [SpikeSuite], peerToPeer: Bool, timeout: TimeInterval
    ) async -> Attempt {
        let endpoint = NWEndpoint.service(name: hit.name, type: SpikeLimits.serviceType, domain: hit.domain, interface: nil)
        let client = SpikeClient(endpoint: endpoint, code: code, suites: suites, peerToPeer: peerToPeer)
        switch await client.connect(timeout: timeout) {
        case .ready(let info):
            // Auch das iPad prüft das ausgehandelte Verfahren (Plan E12)
            guard let negotiated = info.negotiated, negotiated.isAllowed else {
                client.close()
                return Attempt(client: client, ok: false, text: "Verfahren nicht zulässig, Verbindung geschlossen")
            }
            let text =
                "Handshake in \(SpikeP2PFormat.seconds(info.seconds)) · \(negotiated.text) · \(info.interfaces.text)"
            return Attempt(client: client, ok: true, text: text)
        case .failed(let reason):
            client.close()
            return Attempt(client: client, ok: false, text: "keine Verbindung (\(reason))")
        case .timedOut(let lastState):
            client.close()
            return Attempt(client: client, ok: false, text: "Zeitüberschreitung nach \(Int(timeout)) s (\(lastState))")
        }
    }

    // MARK: Dauertest

    func startLongRun() {
        guard let code, !longRun.running, !isBusy else { return }
        UIDevice.current.isBatteryMonitoringEnabled = true
        var fresh = SpikeLongRun()
        fresh.running = true
        fresh.startedAt = Date()
        fresh.batteryStart = batteryPercent()
        longRun = fresh
        startLog(title: "Dauertest")
        log("Dauertest gestartet. Weg „\(way.label)“, Akku \(SpikeP2PFormat.battery(fresh.batteryStart)). Alle 5 s ein ping.")
        let peerToPeer = way.allowsPeerToPeer
        longTask = _Concurrency.Task {
            await self.runLongRun(code: code, peerToPeer: peerToPeer)
        }
    }

    func stopLongRun() {
        guard longRun.running else { return }
        longTask?.cancel()
    }

    private func runLongRun(code: SpikeCode, peerToPeer: Bool) async {
        var client: SpikeClient?
        var outageStart: Date?
        var firstConnectDone = false

        while !_Concurrency.Task.isCancelled {
            if client == nil {
                guard let hit = await locateForLongRun(code: code) else {
                    if outageStart == nil { outageStart = Date() }
                    try? await _Concurrency.Task.sleep(for: .seconds(2))
                    continue
                }
                let attempt = await connect(code: code, hit: hit, suites: SpikeSuites.all, peerToPeer: peerToPeer, timeout: 10)
                if attempt.ok {
                    client = attempt.client
                    if let start = outageStart {
                        let outage = Date().timeIntervalSince(start)
                        longRun.rebuilds += 1
                        longRun.longestOutageSeconds = max(longRun.longestOutageSeconds, outage)
                        log("Verbindung wieder da nach \(SpikeP2PFormat.seconds(outage))")
                        outageStart = nil
                    } else if !firstConnectDone {
                        log("Verbunden: \(attempt.text)")
                    }
                    firstConnectDone = true
                } else {
                    if outageStart == nil { outageStart = Date() }
                    try? await _Concurrency.Task.sleep(for: .seconds(2))
                    continue
                }
            }
            guard let live = client else { continue }
            do {
                let rtt = try await live.ping(timeout: 8)
                longRun.pings += 1
                longRun.rttSumMillis += rtt
                longRun.rttMaxMillis = max(longRun.rttMaxMillis, rtt)
            } catch {
                longRun.aborts += 1
                if outageStart == nil { outageStart = Date() }
                log("Abbruch (\(error)), baue neu auf")
                live.close()
                client = nil
                continue
            }
            try? await _Concurrency.Task.sleep(for: .seconds(5))
        }

        client?.close()
        if let start = outageStart {
            longRun.longestOutageSeconds = max(longRun.longestOutageSeconds, Date().timeIntervalSince(start))
        }
        longRun.running = false
        longRun.endedAt = Date()
        longRun.batteryEnd = batteryPercent()
        finishLongRunLog()
    }

    /// Dienst für den Dauertest: den bekannten nehmen, nur bei Bedarf neu suchen
    private func locateForLongRun(code: SpikeCode) async -> SpikeFound? {
        if let known = found, known.name == code.serviceName { return known }
        let fresh = await SpikeBrowserTool.find(name: code.serviceName, timeout: 10)
        if let fresh { found = fresh }
        return fresh
    }

    private func finishLongRunLog() {
        let run = longRun
        let elapsed = (run.endedAt ?? Date()).timeIntervalSince(run.startedAt ?? Date())
        log("Dauertest beendet nach \(SpikeP2PFormat.duration(elapsed)).")
        log(
            "Pings: \(run.pings), Abbrüche: \(run.aborts), Wiederaufbauten: \(run.rebuilds), "
                + "längster Ausfall: \(SpikeP2PFormat.seconds(run.longestOutageSeconds))")
        log(
            "Rundlauf: Mittel \(SpikeP2PFormat.number(run.averageMillis)) ms, Höchstwert \(SpikeP2PFormat.number(run.rttMaxMillis)) ms")
        log("Akku: \(SpikeP2PFormat.battery(run.batteryStart)) → \(SpikeP2PFormat.battery(run.batteryEnd))")
    }

    // MARK: Hilfen

    private func batteryPercent() -> Int? {
        let level = UIDevice.current.batteryLevel
        guard level >= 0 else { return nil }
        return Int((level * 100).rounded())
    }

    private func update(_ id: String, _ state: SpikeStepState, _ detail: String) {
        guard let index = steps.firstIndex(where: { $0.id == id }) else { return }
        steps[index].state = state
        steps[index].detail = detail
    }

    private func title(of id: String) -> String {
        steps.first { $0.id == id }?.title ?? id
    }

    private func startLog(title: String) {
        logStart = Date()
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        logLines = [
            "Spike S6 · Direktverbindung · \(title)",
            "Zeit: \(ISO8601DateFormatter().string(from: logStart))",
            "\(UIDevice.current.model), iPadOS \(UIDevice.current.systemVersion), App \(version)",
        ]
        writeExport()
    }

    private func log(_ text: String) {
        let elapsed = Date().timeIntervalSince(logStart)
        let minutes = Int(elapsed) / 60
        let seconds = Int(elapsed) % 60
        logLines.append("[+\(minutes):\(seconds < 10 ? "0" : "")\(seconds)] \(text)")
        writeExport()
    }

    private func writeExport() {
        let text = logLines.joined(separator: "\n") + "\n"
        try? text.write(to: exportURL, atomically: true, encoding: .utf8)
    }
}
