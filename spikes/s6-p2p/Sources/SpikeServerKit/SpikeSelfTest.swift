import Foundation
@preconcurrency import Network
import SpikeShared

/// Eine Zeile der Verfahrenstabelle
public struct SpikeSelfTestRow: Sendable {
    public let title: String
    public let succeeded: Bool
    public let detail: String
}

public struct SpikeSelfTestReport: Sendable {
    public let rows: [SpikeSelfTestRow]
    public let port: UInt16
    /// Hat der Server nach dem Versuch mit falschem Code eine Verbindung als „bereit“ gezählt? Muss `false` sein.
    public let wrongCodeReachedReady: Bool
    /// Wie der Versuch mit falschem Code endete, aus Sicht des Clients (Plan N5: Verhalten bei falschem Schlüssel)
    public let wrongCodeOutcome: String

    public var text: String {
        var lines = ["Selbsttest über Loopback (Port \(port)), ohne Funk:"]
        for row in rows {
            lines.append("  \(row.succeeded ? "ok    " : "FEHLT ") \(row.title): \(row.detail)")
        }
        lines.append(
            "  Falscher Code: \(wrongCodeReachedReady ? "VERBINDUNG ZUGELASSEN (Fehler!)" : "kein Handshake (richtig)")"
                + " · \(wrongCodeOutcome)")
        return lines.joined(separator: "\n")
    }
}

/// Handshake je TLS-Verfahren über Loopback (Plan E12, N5). Läuft am Mac und in der CI.
/// Ob ein Verfahren geht, ist offen (nicht geprüft): Der Test hält es fest, entscheidet es aber nicht.
public enum SpikeSelfTest {
    public static func run(port: UInt16? = nil, probe: any SpikeHealthProbing) async -> SpikeSelfTestReport {
        let code = SpikeCode.random()
        let server = SpikeServer(
            options: SpikeServer.Options(code: code, peerToPeer: false, advertise: false, port: port, probe: probe))
        guard let boundPort = try? await server.start(), let nwPort = NWEndpoint.Port(rawValue: boundPort) else {
            return SpikeSelfTestReport(
                rows: [SpikeSelfTestRow(title: "Server", succeeded: false, detail: "Listener startet nicht")],
                port: 0, wrongCodeReachedReady: false, wrongCodeOutcome: "nicht geprüft")
        }
        defer { server.stop() }
        let endpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: nwPort)

        var rows: [SpikeSelfTestRow] = []
        let variants: [(String, [SpikeSuite])] =
            SpikeSuites.all.map { ($0.name, [$0]) } + [("alle drei angeboten", SpikeSuites.all)]
        for (title, suites) in variants {
            let client = SpikeClient(endpoint: endpoint, code: code, suites: suites, peerToPeer: false)
            let outcome = await client.connect(timeout: 5)
            switch outcome {
            case .ready(let info):
                var detail = info.negotiated?.text ?? "ausgehandeltes Verfahren unbekannt"
                var good = info.negotiated?.isAllowed ?? false
                if let rtt = try? await client.ping(timeout: 3) {
                    detail += String(format: ", ping %.1f ms", rtt)
                } else {
                    good = false
                    detail += ", ping ohne Antwort"
                }
                rows.append(SpikeSelfTestRow(title: title, succeeded: good, detail: detail))
            case .failed(let reason):
                rows.append(SpikeSelfTestRow(title: title, succeeded: false, detail: "Handshake gescheitert (\(reason))"))
            case .timedOut(let state):
                rows.append(SpikeSelfTestRow(title: title, succeeded: false, detail: "Zeitüberschreitung (\(state))"))
            }
            client.close()
        }

        // Falscher Code: darf nie zu einer fertigen Verbindung führen
        let before = server.stats.handshakesSucceeded
        var wrong = SpikeCode.random()
        while wrong == code { wrong = SpikeCode.random() }
        let intruder = SpikeClient(endpoint: endpoint, code: wrong, suites: SpikeSuites.all, peerToPeer: false)
        let wrongOutcome = await intruder.connect(timeout: 3)
        var wrongReady = false
        let wrongText: String
        switch wrongOutcome {
        case .ready:
            wrongReady = true
            wrongText = "bereit"
        case .failed(let reason):
            wrongText = "Client: gescheitert (\(reason))"
        case .timedOut(let state):
            wrongText = "Client: Zeitüberschreitung nach 3 s (\(state))"
        }
        intruder.close()
        try? await _Concurrency.Task.sleep(nanoseconds: 300_000_000)
        if server.stats.handshakesSucceeded != before { wrongReady = true }

        return SpikeSelfTestReport(
            rows: rows, port: boundPort, wrongCodeReachedReady: wrongReady, wrongCodeOutcome: wrongText)
    }
}
