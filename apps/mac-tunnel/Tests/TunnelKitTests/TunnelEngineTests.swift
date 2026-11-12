import XCTest

@preconcurrency import Network
import TunnelShared

@testable import TunnelKit

/// Loopback-Tests des Helfers auf dem macOS-Runner (Plan §7, PR 3), ohne Funk und ohne Bonjour (`advertise: false`,
/// `peerToPeer: false`): TLS-PSK-Client → Listener → Fake-Core am Unix-Socket. Der Fake-Core zählt Verbindungen.
final class TunnelEngineTests: XCTestCase {
    /// Alles, was ein Test braucht. `engine` läuft mit `autoTick: false`, die Prüfungen löst der Test selbst aus.
    /// Die Probe ist standardmäßig eine Attrappe: Eine echte Probe verbindet sich mit dem Fake-Core und verfälschte
    /// dessen Zähler der angenommenen Verbindungen.
    private final class Rig {
        let environment: TunnelTestEnvironment
        let core: FakeCore?
        let engine: TunnelEngine
        let clock: FakeClock
        let probe: SwitchableProbe?
        private let logger: LogCollector

        var logLines: [String] { logger.lines }

        init(devices: [TestDevice], coreMode: FakeCore.Mode? = .echo, fakeProbe: Bool = true) throws {
            let environment = try TunnelTestEnvironment()
            try environment.writeKeys(devices)
            let core = try coreMode.map { try FakeCore(path: environment.socketPath, mode: $0) }
            let probe: SwitchableProbe? = fakeProbe ? SwitchableProbe() : nil
            let clock = FakeClock()
            let logger = LogCollector()
            self.environment = environment
            self.core = core
            self.probe = probe
            self.clock = clock
            self.logger = logger
            self.engine = TunnelEngine(
                options: environment.options(), probe: probe, now: { clock.now }, log: { logger.add($0) })
            try engine.start()
        }

        func shutdown() {
            engine.stop()
            core?.stop()
        }
    }

    private final class LogCollector: @unchecked Sendable {
        private let lock = NSLock()
        private var storage: [String] = []

        func add(_ line: String) {
            lock.lock()
            storage.append(line)
            lock.unlock()
        }

        var lines: [String] {
            lock.lock()
            defer { lock.unlock() }
            return storage
        }
    }

    private func port(_ rig: Rig, _ device: TestDevice) async throws -> UInt16 {
        let found = await waitUntil(timeout: 5) { rig.engine.listenerPort(deviceID: device.id) != nil }
        XCTAssertTrue(found, "Listener für \(device.serviceName) wird nicht bereit")
        return try XCTUnwrap(rig.engine.listenerPort(deviceID: device.id))
    }

    private func connectedClient(_ rig: Rig, _ device: TestDevice) async throws -> TestClient {
        let listenerPort = try await port(rig, device)
        let client = TestClient.tls(port: listenerPort, presharedKey: device.presharedKey)
        let connected = await client.connect(timeout: 8)
        guard connected else {
            client.close()
            // Abbrechen statt weiterlaufen: Ein Senden auf einer nie fertigen Verbindung kehrte nie zurück
            throw TestError(
                "Handshake mit richtigem Schlüssel scheitert. Client: \(client.stateHistory). Helfer: \(rig.logLines)")
        }
        return client
    }

    // MARK: Durchreichen

    func testCorrectClientReachesFakeCoreByteExactInBothDirections() async throws {
        let device = TestDevice()
        let rig = try Rig(devices: [device])
        defer { rig.shutdown() }
        let client = try await connectedClient(rig, device)
        defer { client.close() }

        let negotiated = try XCTUnwrap(client.negotiated)
        XCTAssertTrue(negotiated.isAllowed, negotiated.text)

        // 300 000 Byte in Stücken über 64 KiB: kommen unverändert am Fake-Core an und genauso zurück
        let payload = randomBytes(300_000)
        var offset = 0
        while offset < payload.count {
            let end = min(offset + 50_000, payload.count)
            try await client.send(payload.subdata(in: offset..<end))
            offset = end
        }
        let echoed = await client.read(exactly: payload.count, timeout: 10)
        XCTAssertEqual(echoed, payload, "Antwort vom Core weicht ab")
        XCTAssertEqual(rig.core?.receivedBytes, payload, "Der Core hat etwas anderes bekommen als gesendet")
        XCTAssertEqual(rig.core?.acceptedCount, 1, "genau eine Verbindung zum Core je Tunnel-Verbindung")
    }

    func testEachTunnelConnectionGetsItsOwnCoreConnection() async throws {
        let device = TestDevice()
        let rig = try Rig(devices: [device])
        defer { rig.shutdown() }
        let first = try await connectedClient(rig, device)
        let second = try await connectedClient(rig, device)
        defer {
            first.close()
            second.close()
        }
        try await first.send(Data([1, 2, 3]))
        try await second.send(Data([4, 5, 6, 7]))
        let one = await first.read(exactly: 3, timeout: 5)
        let two = await second.read(exactly: 4, timeout: 5)
        XCTAssertEqual(one, Data([1, 2, 3]))
        XCTAssertEqual(two, Data([4, 5, 6, 7]))
        XCTAssertEqual(rig.core?.acceptedCount, 2)
    }

    // MARK: Kein Byte ohne gültigen Handshake

    func testNoConnectionToTheCoreWithoutAValidHandshake() async throws {
        let device = TestDevice()
        let rig = try Rig(devices: [device])
        defer { rig.shutdown() }
        let listenerPort = try await port(rig, device)

        var wrongKey = device.presharedKey
        wrongKey[0] ^= 0xFF
        let otherDevice = TestDevice()
        // Falscher Schlüssel: Der Handshake selbst scheitert.
        let wrongKeys: [(String, TestClient)] = [
            ("falscher Schlüssel", TestClient.tls(port: listenerPort, presharedKey: wrongKey)),
            ("Schlüssel eines anderen Geräts", TestClient.tls(port: listenerPort, presharedKey: otherDevice.presharedKey)),
        ]
        // Richtiger Schlüssel, aber anderes Verfahren oder andere Kennung. In der CI (macOS-Runner) gilt:
        // - Network.framework beschränkt die Verfahren am Server nicht auf die angehängten: Ein Client, der nur
        //   TLS_PSK_WITH_AES_128_GCM_SHA256 (0x00A8) anbietet, bekommt einen fertigen Handshake mit 0x00A8. Auch ein
        //   Client mit nur ECDHE_RSA (0xC02F) bietet wegen des PSK zusätzlich 0x00A8 an und landet dort.
        // - Die PSK-Kennung prüft der Server womöglich nicht (ein PSK je Listener).
        // Darum entscheidet der Schlüssel, und nach dem Handshake die Prüfung des Verfahrens im Helfer (Plan E12):
        // Solche Verbindungen schließt der Helfer sofort, bevor eine Verbindung zum Core entsteht. Der Test prüft genau
        // das: Entweder scheitert der Handshake, oder er endet mit einem nicht erlaubten Verfahren und wird geschlossen.
        // Ein Handshake mit erlaubtem Verfahren ist nur bei der falschen Kennung denkbar (gleicher Schlüssel).
        let rightKeyOtherwiseWrong: [(String, TestClient)] = [
            ("falsche Kennung", TestClient.tls(port: listenerPort, presharedKey: device.presharedKey, identity: "sgX")),
            // Verfahren ohne PSK (ECDHE_RSA_WITH_AES_128_GCM_SHA256)
            ("Verfahren ohne PSK", TestClient.tls(port: listenerPort, presharedKey: device.presharedKey, suiteIDs: [0xC02F])),
            // PSK-Verfahren ohne ECDHE (TLS_PSK_WITH_AES_128_GCM_SHA256): nicht erlaubt
            ("nicht erlaubtes PSK-Verfahren", TestClient.tls(port: listenerPort, presharedKey: device.presharedKey, suiteIDs: [0x00A8])),
        ]
        defer { for (_, client) in wrongKeys + rightKeyOtherwiseWrong { client.close() } }
        for (title, client) in wrongKeys {
            let connected = await client.connect(timeout: 4)
            XCTAssertFalse(connected, "Handshake gelungen trotz: \(title). Client: \(client.stateHistory)")
        }
        var acceptedWithRightKey = 0
        for (title, client) in rightKeyOtherwiseWrong {
            guard await client.connect(timeout: 4) else { continue }
            let negotiated = client.negotiated
            if title == "falsche Kennung", negotiated?.isAllowed == true {
                // Gleicher Schlüssel, erlaubtes Verfahren: Der Server ignoriert die Kennung. Das ist zulässig, denn wer
                // den Schlüssel kennt, ist berechtigt, und die Kennung ist kein Geheimnis (E13 schützt nur vor
                // Verfolgung). Diese Verbindung darf den Core erreichen; sie wird gezählt und geschlossen.
                acceptedWithRightKey += 1
                client.close()
                continue
            }
            XCTAssertFalse(negotiated?.isAllowed ?? false, "\(title): erlaubtes Verfahren ausgehandelt")
            let closedByHelper = await waitUntil(timeout: 3) { client.isClosed }
            XCTAssertTrue(closedByHelper, "\(title): Der Helfer schließt die Verbindung nicht (\(negotiated?.text ?? "-"))")
        }

        // Kein TLS: reines TCP mit Daten, die wie eine HTTP-Anfrage aussehen
        let plain = TestClient.plain(port: listenerPort)
        defer { plain.close() }
        let connectedPlain = await plain.connect(timeout: 4)
        XCTAssertTrue(connectedPlain, "TCP-Verbindung selbst steht")
        try await plain.send(Data("GET /api/v1/health HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".utf8))
        // Der Server darf mit einer TLS-Warnung antworten und schließen. Wichtig ist nur, dass nichts zum Core geht.
        _ = await plain.read(exactly: 1, timeout: 1.5)

        // Alle Fehlversuche sind gezählt oder abgelaufen, aber nie beim Core angekommen
        let settled = await waitUntil(timeout: 8) {
            let listener = rig.engine.snapshot().listeners.first
            return listener?.handshakes_pending == 0
                && (listener?.handshakes_failed ?? 0) >= 5 - acceptedWithRightKey
                && listener?.connections == 0
        }
        XCTAssertTrue(settled, "\(rig.engine.snapshot())")
        XCTAssertEqual(rig.core?.acceptedCount ?? 0, acceptedWithRightKey, "Ein Fehlversuch hat den Core erreicht")
        XCTAssertEqual(rig.core?.receivedBytes.count, 0)
        XCTAssertEqual(rig.engine.snapshot().listeners.first?.connections, 0)
    }

    // MARK: Flut

    func testFloodOfHungHandshakesDoesNotKeepTheRightClientOut() async throws {
        let device = TestDevice()
        let rig = try Rig(devices: [device])
        defer { rig.shutdown() }
        let listenerPort = try await port(rig, device)

        // 50 Verbindungen, die nie ein ClientHello schicken
        var hung: [TestClient] = []
        for _ in 0..<50 {
            let client = TestClient.plain(port: listenerPort)
            hung.append(client)
        }
        defer { for client in hung { client.close() } }
        for client in hung { _ = await client.connect(timeout: 3) }

        // Der richtige Client kommt trotzdem binnen 6 s durch (die neunte Verbindung im Handshake verdrängt die älteste)
        let started = Date()
        let client = TestClient.tls(port: listenerPort, presharedKey: device.presharedKey)
        defer { client.close() }
        let connected = await client.connect(timeout: 6)
        XCTAssertTrue(connected, "Der richtige Client kommt in der Flut nicht durch")
        XCTAssertLessThan(Date().timeIntervalSince(started), 6.5)
        let during = rig.engine.snapshot().listeners.first
        XCTAssertLessThanOrEqual(during?.handshakes_pending ?? 0, TunnelLimits.maxPendingHandshakes)

        // Nach 5 s ist jede hängende Verbindung zu: am Helfer gezählt und am Client sichtbar
        let allClosed = await waitUntil(timeout: 8) { hung.allSatisfy { $0.isClosed } }
        XCTAssertTrue(allClosed, "hängende Verbindungen offen: \(hung.filter { !$0.isClosed }.count)")
        let after = rig.engine.snapshot().listeners.first
        XCTAssertEqual(after?.handshakes_pending, 0)
        XCTAssertGreaterThanOrEqual(after?.handshakes_failed ?? 0, 50)
        let reachedCore = await waitUntil(timeout: 3) { rig.core?.acceptedCount == 1 }
        XCTAssertTrue(reachedCore, "Der richtige Client erreicht den Core nicht")
        XCTAssertEqual(rig.core?.acceptedCount, 1, "nur der richtige Client erreicht den Core, und erst nach dem Handshake")
    }

    // MARK: Grenzen

    func testAtMostThirtyTwoConnectionsPerDevice() async throws {
        let device = TestDevice()
        let rig = try Rig(devices: [device])
        defer { rig.shutdown() }
        let listenerPort = try await port(rig, device)

        var clients: [TestClient] = []
        defer { for client in clients { client.close() } }
        for number in 0..<(TunnelLimits.maxConnectionsPerDevice + 1) {
            let client = TestClient.tls(port: listenerPort, presharedKey: device.presharedKey)
            clients.append(client)
            let connected = await client.connect(timeout: 8)
            if !connected && number < TunnelLimits.maxConnectionsPerDevice {
                throw TestError("Verbindung \(number + 1) scheitert. Client: \(client.stateHistory). Helfer: \(rig.logLines)")
            }
        }
        let reached = await waitUntil(timeout: 5) { rig.core?.acceptedCount == TunnelLimits.maxConnectionsPerDevice }
        XCTAssertTrue(reached, "Core-Verbindungen: \(String(describing: rig.core?.acceptedCount))")
        try await Task.sleep(nanoseconds: 700_000_000)
        XCTAssertEqual(rig.core?.acceptedCount, TunnelLimits.maxConnectionsPerDevice, "die 33. kam durch")
        XCTAssertEqual(rig.engine.snapshot().listeners.first?.connections, TunnelLimits.maxConnectionsPerDevice)
        let oneClosed = await waitUntil(timeout: 3) { clients.contains { $0.isClosed } }
        XCTAssertTrue(oneClosed, "Die überzählige Verbindung bleibt offen")
    }

    func testBackpressureKeepsTheBufferBounded() async throws {
        let device = TestDevice()
        let rig = try Rig(devices: [device], coreMode: .silent)
        defer { rig.shutdown() }
        let client = try await connectedClient(rig, device)
        defer { client.close() }

        let chunk = randomBytes(TunnelLimits.bufferBytes)
        let total = 1024  // 64 MiB, der Core liest nie
        let sender = Task {
            for _ in 0..<total { try await client.send(chunk) }
        }
        var worstInFlight = 0
        for _ in 0..<15 {
            try await Task.sleep(nanoseconds: 200_000_000)
            for counters in rig.engine.bridgeCounters() {
                worstInFlight = max(worstInFlight, counters.inFlightClientToCore)
            }
        }
        let readByHelper = rig.engine.bridgeCounters().first?.readFromClient ?? 0
        let sentByClient = client.sentBytes
        sender.cancel()
        client.close()

        XCTAssertLessThanOrEqual(worstInFlight, TunnelLimits.bufferBytes, "Der Helfer puffert mehr als einen Block")
        XCTAssertLessThan(readByHelper, 32 * 1024 * 1024, "Der Helfer liest weiter, obwohl der Core nichts abnimmt")
        XCTAssertLessThan(sentByClient, total * TunnelLimits.bufferBytes, "Der Absender wurde nicht gebremst")
        XCTAssertEqual(rig.core?.receivedBytes.count, 0)
    }

    // MARK: Abgleich der Schlüsseldatei (Fake-Uhr, tick von Hand)

    func testNewDeviceGetsAListenerAndRemovedDeviceLosesIt() async throws {
        let first = TestDevice()
        let second = TestDevice()
        let third = TestDevice()
        let rig = try Rig(devices: [first, second])
        defer { rig.shutdown() }
        let clientFirst = try await connectedClient(rig, first)
        let clientSecond = try await connectedClient(rig, second)
        defer {
            clientFirst.close()
            clientSecond.close()
        }
        let firstPort = try await port(rig, first)

        // Gerät 1 wird entfernt: nach einer Prüfung ist sein Dienst weg und seine Verbindung zu
        try rig.environment.writeKeys([second])
        rig.clock.advance(2)
        rig.engine.tick()
        XCTAssertNil(rig.engine.listenerPort(deviceID: first.id))
        let closed = await waitUntil(timeout: 2) { clientFirst.isClosed }
        XCTAssertTrue(closed, "Die Verbindung des entfernten Geräts bleibt offen")
        let late = TestClient.tls(port: firstPort, presharedKey: first.presharedKey)
        defer { late.close() }
        let lateConnected = await late.connect(timeout: 2)
        XCTAssertFalse(lateConnected, "Der entfernte Dienst nimmt noch Verbindungen an")

        // Gerät 2 ist unberührt
        try await clientSecond.send(Data([9, 9]))
        let echoed = await clientSecond.read(exactly: 2, timeout: 5)
        XCTAssertEqual(echoed, Data([9, 9]))
        XCTAssertFalse(clientSecond.isClosed)

        // Gerät 3 kommt dazu: neuer Listener
        try rig.environment.writeKeys([second, third])
        rig.clock.advance(2)
        rig.engine.tick()
        let thirdClient = try await connectedClient(rig, third)
        thirdClient.close()
        XCTAssertEqual(rig.engine.snapshot().listeners.map { $0.service_name }.sorted(), [second.serviceName, third.serviceName].sorted())
    }

    func testMissingBrokenOrInsecureFileStopsEverythingAndRecovers() async throws {
        let device = TestDevice()
        let rig = try Rig(devices: [device])
        defer { rig.shutdown() }
        let client = try await connectedClient(rig, device)
        defer { client.close() }

        // Datei weg
        rig.environment.removeKeys()
        rig.clock.advance(2)
        rig.engine.tick()
        XCTAssertNil(rig.engine.listenerPort(deviceID: device.id))
        XCTAssertEqual(rig.engine.snapshot().keys, "fehlt")
        XCTAssertEqual(rig.engine.snapshot().listeners, [])
        let closed = await waitUntil(timeout: 2) { client.isClosed }
        XCTAssertTrue(closed, "Verbindung bleibt offen, obwohl die Schlüsseldatei fehlt")

        // Datei kaputt
        try rig.environment.writeFile(rig.environment.keysPath, "{kaputt")
        rig.clock.advance(2)
        rig.engine.tick()
        XCTAssertEqual(rig.engine.snapshot().keys, "kaputt")
        XCTAssertEqual(rig.engine.snapshot().listeners, [])
        XCTAssertNotNil(rig.engine.snapshot().last_error)

        // Falsche Rechte
        try rig.environment.writeKeys([device], mode: 0o644)
        rig.clock.advance(2)
        rig.engine.tick()
        XCTAssertEqual(rig.engine.snapshot().keys, "unsicher")
        XCTAssertEqual(rig.engine.snapshot().listeners, [])
        XCTAssertTrue(rig.engine.snapshot().last_error?.contains("0600") ?? false)

        // Wieder in Ordnung: Der Helfer hat sich nicht beendet und startet den Dienst wieder
        try rig.environment.writeKeys([device])
        rig.clock.advance(2)
        rig.engine.tick()
        XCTAssertEqual(rig.engine.snapshot().keys, "ok")
        XCTAssertNil(rig.engine.snapshot().last_error)
        let again = try await connectedClient(rig, device)
        again.close()
        for line in rig.logLines {
            XCTAssertFalse(line.contains(device.keyText), "Schlüssel im Log")
            XCTAssertFalse(line.contains(device.presharedKeyHex), "PSK im Log")
        }
    }

    func testCoreGoneStopsAllListenersWithoutCrashing() async throws {
        let device = TestDevice()
        let rig = try Rig(devices: [device])
        defer { rig.shutdown() }
        let client = try await connectedClient(rig, device)
        defer { client.close() }
        XCTAssertEqual(rig.engine.snapshot().core, "ok")

        rig.probe?.set(false)
        rig.clock.advance(11)  // Probe alle 10 s
        rig.engine.tick()
        XCTAssertEqual(rig.engine.snapshot().core, "nicht erreichbar")
        XCTAssertEqual(rig.engine.snapshot().listeners, [])
        XCTAssertNil(rig.engine.listenerPort(deviceID: device.id))
        let closed = await waitUntil(timeout: 2) { client.isClosed }
        XCTAssertTrue(closed)
        XCTAssertNotNil(rig.engine.snapshot().last_error)

        // Vor Ablauf der 10 s wird nicht erneut geprüft
        rig.probe?.set(true)
        rig.clock.advance(3)
        rig.engine.tick()
        XCTAssertEqual(rig.engine.snapshot().core, "nicht erreichbar")

        rig.clock.advance(8)
        rig.engine.tick()
        XCTAssertEqual(rig.engine.snapshot().core, "ok")
        let again = try await connectedClient(rig, device)
        again.close()
    }

    func testStartsWithoutCoreAndPicksUpListenersWhenItAppears() async throws {
        let device = TestDevice()
        let rig = try Rig(devices: [device], coreMode: nil, fakeProbe: false)
        defer { rig.shutdown() }
        XCTAssertEqual(rig.engine.snapshot().core, "nicht erreichbar")
        XCTAssertEqual(rig.engine.snapshot().listeners, [])

        let core = try FakeCore(path: rig.environment.socketPath, mode: .echo)
        defer { core.stop() }
        rig.clock.advance(11)
        rig.engine.tick()
        XCTAssertEqual(rig.engine.snapshot().core, "ok")
        let client = try await connectedClient(rig, device)
        client.close()
    }

    // MARK: Probe des Tunnel-Eingangs

    func testUnixSocketProbeSeesTheCoreOnlyWhenItIsThere() throws {
        let environment = try TunnelTestEnvironment()
        let probe = UnixSocketProbe(path: environment.socketPath, expectedUID: geteuid())
        guard case .unreachable = probe.probe() else { return XCTFail("kein Core, aber erreichbar") }

        let core = try FakeCore(path: environment.socketPath, mode: .echo)
        XCTAssertEqual(probe.probe(), .reachable)
        let foreign = UnixSocketProbe(path: environment.socketPath, expectedUID: geteuid() &+ 1)
        guard case .unreachable(let text) = foreign.probe() else { return XCTFail("fremder Besitzer akzeptiert") }
        XCTAssertTrue(text.contains("anderen Benutzer"), text)
        core.stop()

        // Eine gewöhnliche Datei ist kein Tunnel-Eingang
        try environment.writeFile(environment.socketPath, "kein Socket")
        guard case .unreachable(let notSocket) = probe.probe() else { return XCTFail("Datei als Socket akzeptiert") }
        XCTAssertTrue(notSocket.contains("kein Socket"), notSocket)
    }

    // MARK: Start

    func testStartRefusesUnsafeFilesAndSockets() throws {
        // Schlüsseldatei mit falschen Rechten
        let unsafe = try TunnelTestEnvironment()
        try unsafe.writeKeys([TestDevice()], mode: 0o644)
        XCTAssertThrowsError(try TunnelEngine(options: unsafe.options()).start()) { error in
            XCTAssertTrue("\(error)".contains("0600"), "\(error)")
        }

        // Fremder Besitzer (wir erwarten einen anderen Benutzer)
        let foreign = try TunnelTestEnvironment()
        try foreign.writeKeys([TestDevice()])
        XCTAssertThrowsError(try TunnelEngine(options: foreign.options(expectedUID: geteuid() &+ 1)).start()) { error in
            XCTAssertTrue("\(error)".contains("anderen Benutzer"), "\(error)")
        }

        // Am Socket-Pfad liegt eine gewöhnliche Datei
        let notSocket = try TunnelTestEnvironment()
        try notSocket.writeFile(notSocket.socketPath, "kein Socket")
        XCTAssertThrowsError(try TunnelEngine(options: notSocket.options()).start()) { error in
            XCTAssertTrue("\(error)".contains("kein Socket"), "\(error)")
        }

        // Pfad zu lang für einen Unix-Socket
        let tooLong = try TunnelTestEnvironment()
        var options = tooLong.options()
        options.socketPath = "/tmp/" + String(repeating: "a", count: 120) + "/tunnel.sock"
        XCTAssertThrowsError(try TunnelEngine(options: options).start()) { error in
            XCTAssertTrue("\(error)".contains("länger"), "\(error)")
        }
    }

    // MARK: Zustandsdatei

    func testStateFileIsWrittenOnTheClockAndHasNoSecrets() async throws {
        let device = TestDevice()
        let rig = try Rig(devices: [device])
        defer { rig.shutdown() }
        _ = try await port(rig, device)
        let isReady = await waitUntil(timeout: 5) { rig.engine.snapshot().listeners.first?.state == "ready" }
        XCTAssertTrue(isReady)
        rig.clock.advance(2)
        rig.engine.tick()

        func readState() throws -> TunnelState {
            try JSONDecoder().decode(
                TunnelState.self, from: Data(contentsOf: URL(fileURLWithPath: rig.environment.statePath)))
        }
        let state = try readState()
        XCTAssertEqual(state.pid, getpid())
        XCTAssertEqual(state.core, "ok")
        XCTAssertEqual(state.keys, "ok")
        XCTAssertFalse(state.p2p)
        XCTAssertEqual(state.listeners.map { $0.service_name }, [device.serviceName])
        XCTAssertEqual(state.listeners.first?.state, "ready")
        let text = try String(contentsOfFile: rig.environment.statePath, encoding: .utf8)
        XCTAssertFalse(text.contains(device.keyText))
        XCTAssertFalse(text.contains(device.presharedKeyHex))

        // Unverändert und jünger als 5 s: nicht neu geschrieben. Danach: neuer Zeitstempel.
        let stamp = state.updated_at
        rig.clock.advance(2)
        rig.engine.tick()
        XCTAssertEqual(try readState().updated_at, stamp)
        rig.clock.advance(4)
        rig.engine.tick()
        XCTAssertNotEqual(try readState().updated_at, stamp)

        rig.engine.stop()
        XCTAssertFalse(FileManager.default.fileExists(atPath: rig.environment.statePath), "Zustandsdatei bleibt nach dem Beenden")
    }
}
