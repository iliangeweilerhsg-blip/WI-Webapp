import XCTest
@preconcurrency import Network

@testable import SpikeServerKit
@testable import SpikeShared

/// Loopback-Tests auf dem macOS-Runner (Plan UX-12, PR 1): richtiger Code → Antwort, falscher Code → kein Handshake.
/// Ohne Bonjour und ohne peer-to-peer, damit sie weder Funk noch die Frage „Lokales Netzwerk“ brauchen.
/// Ob die ECDHE_PSK-Verfahren gehen, ist offen (N5): Die Tests halten es fest, verlangen aber nur, dass mindestens
/// ein zulässiges Verfahren funktioniert.
final class SpikeLoopbackTests: XCTestCase {
    struct HandshakeFailed: Error { let text: String }

    struct FakeProbe: SpikeHealthProbing {
        let reply: SpikeHealthReply
        func probe() async -> SpikeHealthReply { reply }
    }

    private func makeServer(
        code: SpikeCode = SpikeCode.random(), maxConnections: Int = SpikeLimits.maxConnections,
        maxFailedHandshakes: Int = SpikeLimits.maxFailedHandshakes
    ) async throws -> (server: SpikeServer, endpoint: NWEndpoint, code: SpikeCode) {
        let server = SpikeServer(
            options: SpikeServer.Options(
                code: code, peerToPeer: false, advertise: false, maxConnections: maxConnections,
                maxFailedHandshakes: maxFailedHandshakes,
                probe: FakeProbe(reply: SpikeHealthReply(httpStatus: 200, millis: 7))))
        let port = try await server.start()
        let nwPort = try XCTUnwrap(NWEndpoint.Port(rawValue: port))
        return (server, NWEndpoint.hostPort(host: "127.0.0.1", port: nwPort), code)
    }

    private func connectedClient(_ endpoint: NWEndpoint, _ code: SpikeCode) async throws -> SpikeClient {
        let client = SpikeClient(endpoint: endpoint, code: code, suites: SpikeSuites.all, peerToPeer: false)
        let outcome = await client.connect(timeout: 8)
        guard case .ready(let info) = outcome else {
            client.close()
            throw HandshakeFailed(text: "\(outcome)")
        }
        XCTAssertTrue(info.negotiated?.isAllowed ?? false, "ausgehandelt: \(String(describing: info.negotiated))")
        return client
    }

    // MARK: Selbsttest (Verfahrenstabelle)

    func testSelfTestTableAndWrongCode() async throws {
        let report = await SpikeSelfTest.run(probe: FakeProbe(reply: SpikeHealthReply(httpStatus: 200, millis: 1)))
        print(report.text)  // steht im CI-Protokoll: Ergebnis je Verfahren (N5)
        XCTAssertFalse(report.wrongCodeReachedReady, "Falscher Code darf nie einen fertigen Handshake ergeben")
        XCTAssertTrue(
            report.rows.contains { $0.succeeded },
            "Kein einziges TLS-PSK-Verfahren ging über Loopback:\n\(report.text)")
        // Zeile „alle drei angeboten“ gehört dazu: Es muss sich ein zulässiges Verfahren einigen
        let all = try XCTUnwrap(report.rows.last)
        XCTAssertTrue(all.succeeded, "\(all.detail)")
    }

    // MARK: Befehle

    func testCorrectCodeAnswersAllFourCommands() async throws {
        let (server, endpoint, code) = try await makeServer()
        defer { server.stop() }
        let client = try await connectedClient(endpoint, code)
        defer { client.close() }

        let rtt = try await client.ping()
        XCTAssertGreaterThanOrEqual(rtt, 0)

        let health = try await client.health()
        XCTAssertEqual(health.reply, SpikeHealthReply(httpStatus: 200, millis: 7))

        let payload = (0..<1000).map { UInt8($0 % 251) }
        let echoed = try await client.echo(payload)
        XCTAssertEqual(echoed, payload)
        let empty = try await client.echo([])
        XCTAssertEqual(empty, [])

        let blob = try await client.downloadBlob(megabytes: 1)
        XCTAssertEqual(blob.bytesDown, 1024 * 1024)

        let both = try await client.echoThroughput(totalBytes: 1024 * 1024)
        XCTAssertEqual(both.bytesUp, both.bytesDown)
        XCTAssertGreaterThan(both.bytesUp, 0)

        XCTAssertGreaterThanOrEqual(server.stats.commands, 6)
    }

    func testWrongCodeNeverGetsAnswer() async throws {
        let (server, endpoint, code) = try await makeServer()
        defer { server.stop() }
        var wrong = SpikeCode.random()
        while wrong == code { wrong = SpikeCode.random() }
        let intruder = SpikeClient(endpoint: endpoint, code: wrong, suites: SpikeSuites.all, peerToPeer: false)
        defer { intruder.close() }
        let outcome = await intruder.connect(timeout: 4)
        if case .ready = outcome { XCTFail("Handshake mit falschem Code gelungen") }
        try await _Concurrency.Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(server.stats.handshakesSucceeded, 0)
        XCTAssertEqual(server.stats.commands, 0)
    }

    // MARK: Härtung

    func testUnknownCommandAndOversizeEchoCloseTheConnection() async throws {
        let (server, endpoint, code) = try await makeServer()
        defer { server.stop() }

        for bad in [
            SpikeWire.request(op: .ping, payload: [1, 2, 3]),  // ping mit Nutzlast
            [99, 0, 0, 0, 0],  // unbekannter Befehl
            [UInt8(3)] + SpikeWire.bigEndian(UInt32(SpikeLimits.echoMaxBytes + 1)),  // echo zu groß
            SpikeWire.blobRequest(megabytes: SpikeLimits.blobMaxMegabytes + 1),  // blob zu groß
        ] {
            let connection = NWConnection(
                to: endpoint, using: SpikeTLS.parameters(code: code, suites: SpikeSuites.all, peerToPeer: false))
            let closed = await sendAndWaitForClose(connection, bytes: bad)
            XCTAssertTrue(closed, "Der Mac hat die Verbindung nicht geschlossen: \(bad.prefix(5))")
        }
    }

    func testConnectionLimitRefusesTheOneOverTheLimit() async throws {
        let (server, endpoint, code) = try await makeServer(maxConnections: 2)
        defer { server.stop() }
        let first = try await connectedClient(endpoint, code)
        let second = try await connectedClient(endpoint, code)
        defer {
            first.close()
            second.close()
        }

        let third = SpikeClient(endpoint: endpoint, code: code, suites: SpikeSuites.all, peerToPeer: false)
        defer { third.close() }
        let outcome = await third.connect(timeout: 4)
        if case .ready = outcome { XCTFail("Dritte Verbindung trotz Grenze von 2 angenommen") }
        XCTAssertGreaterThanOrEqual(server.stats.refusedOverLimit, 1)

        // Die beiden ersten laufen weiter
        _ = try await first.ping()
        _ = try await second.ping()
    }

    func testHandshakeThatNeverFinishesIsClosedAfterFiveSeconds() async throws {
        let (server, endpoint, _) = try await makeServer()
        defer { server.stop() }
        // Reines TCP ohne TLS: Der Handshake kommt nie zustande
        let raw = NWConnection(to: endpoint, using: .tcp)
        let started = Date()
        let closed = await sendAndWaitForClose(raw, bytes: [], waitSeconds: 10)
        XCTAssertTrue(closed, "Der Mac hat die hängende Verbindung nicht geschlossen")
        XCTAssertLessThan(Date().timeIntervalSince(started), 9)
        try await _Concurrency.Task.sleep(nanoseconds: 300_000_000)
        XCTAssertGreaterThanOrEqual(server.stats.handshakesFailed, 1)
        XCTAssertEqual(server.stats.handshakesSucceeded, 0)
    }

    func testTooManyFailedHandshakesLockTheServer() async throws {
        let (server, endpoint, code) = try await makeServer(maxFailedHandshakes: 2)
        defer { server.stop() }
        var wrong = SpikeCode.random()
        while wrong == code { wrong = SpikeCode.random() }
        for _ in 0..<2 {
            let intruder = SpikeClient(endpoint: endpoint, code: wrong, suites: SpikeSuites.all, peerToPeer: false)
            let outcome = await intruder.connect(timeout: 4)
            if case .ready = outcome { XCTFail("Handshake mit falschem Code gelungen") }
            intruder.close()
        }
        // Der Server zählt den Fehlschlag spätestens nach der Handshake-Frist (5 s)
        for _ in 0..<80 where !server.stats.lockedOut {
            try await _Concurrency.Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertTrue(server.stats.lockedOut, "Sperre nach 2 Fehlversuchen greift nicht: \(server.stats)")

        // Danach kommt auch der richtige Code nicht mehr durch
        let owner = SpikeClient(endpoint: endpoint, code: code, suites: SpikeSuites.all, peerToPeer: false)
        defer { owner.close() }
        let outcome = await owner.connect(timeout: 4)
        if case .ready = outcome {
            // Die Verbindung kann kurz `ready` melden, bevor der Server sie schließt. Ein Befehl darf nie ankommen.
            let answered = (try? await owner.ping(timeout: 3)) != nil
            XCTAssertFalse(answered, "Nach der Sperre hat der Server noch geantwortet")
        }
        XCTAssertEqual(server.stats.commands, 0)
    }

    // MARK: Hilfen

    /// Schickt Bytes (falls vorhanden) und wartet, bis die Gegenseite die Verbindung schließt
    private func sendAndWaitForClose(_ connection: NWConnection, bytes: [UInt8], waitSeconds: Double = 8) async -> Bool {
        let queue = DispatchQueue(label: "spike.test.raw")
        return await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            let once = SpikeOnce(continuation)
            let wasReady = SpikeBox(false)
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    wasReady.set(true)
                    if !bytes.isEmpty {
                        connection.send(content: Data(bytes), completion: .contentProcessed { _ in })
                    }
                    connection.receive(minimumIncompleteLength: 1, maximumLength: 1024) { _, _, isComplete, error in
                        // Fehler oder Ende des Stroms heißt: geschlossen. Antwortdaten wären hier ein Fehler.
                        once.resume(isComplete || error != nil)
                    }
                case .failed, .cancelled:
                    // Nur „geschlossen“, wenn es vorher stand. Ein Handshake, der nie gelang, beweist nichts.
                    once.resume(wasReady.get())
                default:
                    break
                }
            }
            connection.start(queue: queue)
            queue.asyncAfter(deadline: .now() + waitSeconds) {
                once.resume(false)
                connection.cancel()
            }
        }
    }
}
