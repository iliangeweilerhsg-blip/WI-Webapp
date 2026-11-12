import XCTest

@testable import StudienGehirn

/// Issue #282: Vor dem Stopp des Weiterleiters werden alle Anfragen abgebrochen und die URLSessions ungültig gemacht.
/// Sonst könnte URLSession eine Anfrage nach dem Freiwerden des Ports samt Token an eine fremde App senden.
/// Alles mit Fakes, ohne Netz.
@MainActor
final class RequestsCancelledBeforeStopTests: XCTestCase {
    // MARK: Reihenfolge: erst abbrechen, dann stoppen (MacRoute)

    private func makeRoute(_ forwarder: FakeForwarder) -> MacRoute {
        MacRoute(
            keys: FakeTunnelKeyStore(key: TunnelTestKeys.text()),
            dialer: FakeDialer { _, _ in .failed(.notFound) },
            paths: FakePaths(),
            forwarder: forwarder)
    }

    func testHookRunsBeforeTheForwarderStops() {
        let forwarder = FakeForwarder()
        let route = makeRoute(forwarder)
        var stopsSeenByHook: [Int] = []
        var portsSeenByHook: [UInt16?] = []
        route.willStopForwarder = {
            stopsSeenByHook.append(forwarder.stopCount)
            portsSeenByHook.append(forwarder.port)
        }
        route.setPaired(true)
        XCTAssertNotNil(route.endpoint())

        route.appWentToBackground()

        XCTAssertEqual(stopsSeenByHook, [0], "Der Abbruch muss vor forwarder.stop() laufen")
        XCTAssertEqual(portsSeenByHook.count, 1)
        XCTAssertNotNil(portsSeenByHook.first ?? nil, "Beim Abbruch war der Port noch belegt")
        XCTAssertEqual(forwarder.stopCount, 1)
        XCTAssertNil(route.endpoint())
    }

    func testHookDoesNotRunWithoutARunningForwarder() {
        let route = makeRoute(FakeForwarder())
        var calls = 0
        route.willStopForwarder = { calls += 1 }

        // Nie gekoppelt: kein Weiterleiter, also auch nichts abzubrechen (eine Kopplung läuft ohne Token weiter)
        route.setPaired(false)

        XCTAssertEqual(calls, 0)
    }

    func testHookRunsAgainForEveryStop() {
        let forwarder = FakeForwarder()
        let route = makeRoute(forwarder)
        var calls = 0
        route.willStopForwarder = { calls += 1 }
        route.setPaired(true)

        route.appWentToBackground()
        route.appBecameActive()
        route.appWentToBackground()

        XCTAssertEqual(calls, 2)
        XCTAssertEqual(forwarder.stopCount, 2)
    }

    func testListenerFailureAfterReadyCancelsBeforeTheForwarderCleansUp() {
        let forwarder = FakeForwarder()
        let route = makeRoute(forwarder)
        var stopsSeenByHook: [Int] = []
        route.willStopForwarder = { stopsSeenByHook.append(forwarder.stopCount) }
        route.setPaired(true)
        XCTAssertNotNil(route.endpoint())

        // Der Port geht verloren, ohne dass `stopAll` läuft
        forwarder.failListener()

        XCTAssertEqual(stopsSeenByHook, [0], "Auch beim Ausfall des Listeners erst abbrechen")
        XCTAssertNil(route.endpoint())
        XCTAssertEqual(route.state, .down(.macNotFound))

        // Der folgende Hintergrund meldet nichts doppelt: Es läuft kein Weiterleiter mehr
        route.appWentToBackground()
        XCTAssertEqual(stopsSeenByHook.count, 1)
    }

    func testListenerThatNeverStartedDoesNotRunTheHook() {
        let forwarder = FakeForwarder()
        forwarder.portToReport = nil
        let route = makeRoute(forwarder)
        var calls = 0
        route.willStopForwarder = { calls += 1 }

        route.setPaired(true)

        XCTAssertEqual(calls, 0, "Ohne gemeldeten Port ging nie eine Anfrage an den Weiterleiter")
    }

    // MARK: AppModel: Hintergrund bricht ab, Vordergrund nimmt wieder auf

    private struct Parts {
        let model: AppModel
        let harness: SyncHarness
        let routing: FakeRouting
    }

    private func makeParts() -> Parts {
        let routing = FakeRouting(endpoint: CoreEndpoint(host: "127.0.0.1", port: 41000))
        let h = SyncHarness(routing: routing)
        let model = AppModel(
            client: h.client,
            tokenStore: h.tokens,
            macStore: FakePairedMacStore(mac: Fixtures.pairedMac),
            deviceName: "iPad Test",
            appVersion: "0.1.0",
            sync: h.engine,
            tunnelKeyStore: FakeTunnelKeyStore(key: TunnelTestKeys.text()),
            routing: routing
        )
        return Parts(model: model, harness: h, routing: routing)
    }

    func testBackgroundCancelsRequestsAndSyncBeforeThePortIsReleased() async {
        let p = makeParts()
        let h = p.harness
        var endpointAtCancel: CoreEndpoint?
        h.transport.onCancelAll = { endpointAtCancel = p.routing.endpoint() }
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)

        p.model.appWentToBackground()

        XCTAssertEqual(h.transport.cancelAllCount, 1)
        XCTAssertNotNil(endpointAtCancel, "Beim Abbruch war der Port noch belegt")
        XCTAssertNil(p.routing.endpoint())
        XCTAssertEqual(h.factory.invalidateCount, 1)
        XCTAssertEqual(
            h.factory.allClosedAtInvalidate, true, "Verbindungen erst schließen, dann die Session ungültig machen")
        XCTAssertEqual(h.engine.state, .stopped)
        XCTAssertTrue(h.factory.sockets.allSatisfy { $0.isClosed })
    }

    func testRequestsWorkAgainAfterTheForeground() async {
        let p = makeParts()
        let h = p.harness
        _ = await eventually { h.engine.state == .online }
        p.model.appWentToBackground()
        XCTAssertEqual(h.engine.state, .stopped)

        // Zurück im Vordergrund: neuer Port, neue Schleife, neue Verbindung
        p.routing.fixedEndpoint = CoreEndpoint(host: "127.0.0.1", port: 41007)
        p.model.appBecameActive()

        let again = await eventually { h.engine.state == .online && h.factory.sockets.count == 2 }
        XCTAssertTrue(again)
        XCTAssertEqual(h.factory.requests.last?.url?.port, 41007)

        // Auch REST geht wieder, an den neuen Port
        await p.model.checkConnection()
        XCTAssertEqual(h.transport.requests.last?.url?.port, 41007)
        XCTAssertEqual(p.model.connection, .connected)
    }

    func testRetryAfterConnectionLossDoesNotGoToThePortThatIsGone() async {
        let routing = FakeRouting(endpoint: CoreEndpoint(host: "127.0.0.1", port: 41000))
        let transport = FakeTransport([.failure(.networkConnectionLost)])
        let client = Fixtures.client(transport, routing: routing)
        let old = CoreEndpoint(host: "127.0.0.1", port: 41000)!
        // Der Weiterleiter stoppt, während die erste Anfrage läuft. Die Wiederholung prüft das Ziel vor jedem Versuch.
        transport.duringRequest = { _ in routing.fixedEndpoint = nil }

        do {
            try await client.checkHealth(endpoint: old, token: Fixtures.token)
            XCTFail("Es darf keine Anfrage mit Token mehr rausgehen")
        } catch {}

        XCTAssertEqual(transport.requests.count, 1)
    }

    // MARK: Warteschlange geht nicht verloren

    func testUnacknowledgedOperationsAreSentAgainAfterTheForeground() async throws {
        let p = makeParts()
        let h = p.harness
        // Die erste Verbindung bestätigt nichts: Alle Operationen sind unterwegs, aber nicht angekommen
        h.factory.configure = { socket, index in
            if index == 0 { socket.opPolicy = { _, _, _ in .silent } }
        }
        h.enqueueStrokes(3)
        p.model.appBecameActive()
        let opened = await eventually { !h.factory.sockets.isEmpty }
        XCTAssertTrue(opened)
        let first = try XCTUnwrap(h.factory.sockets.first)
        let sent = await eventually { first.ops.count == 3 }
        XCTAssertTrue(sent)
        let ids = first.opIDs
        XCTAssertEqual(h.engine.pendingCount, 3)

        p.model.appWentToBackground()

        // Nichts verloren: Die Warteschlange steht unverändert auf der Platte
        XCTAssertEqual(h.engine.pendingCount, 3)
        XCTAssertEqual(h.outbox.pending.map(\.opID), ids)
        XCTAssertEqual(SyncOutbox(directory: h.directory).pending.map(\.opID), ids)

        p.routing.fixedEndpoint = CoreEndpoint(host: "127.0.0.1", port: 41008)
        p.model.appBecameActive()
        let reopened = await eventually { h.factory.sockets.count > 1 }
        XCTAssertTrue(reopened)
        let second = h.factory.sockets[1]
        let done = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(done)
        XCTAssertEqual(second.opIDs, ids, "Gleiche op_id, gleiche Reihenfolge: Der Core bestätigt sie idempotent")
    }

    func testForegroundDoesNotRestartASyncWhoseTokenWasRevoked() async {
        let p = makeParts()
        let h = p.harness
        // Gesetzt, bevor die Schleife zum ersten Mal läuft: Sie startet in `AppModel.init`, läuft aber erst beim
        // ersten `await`
        h.factory.configure = { socket, _ in socket.initialFailure = .closed(code: 4401) }
        let invalid = await eventually { h.engine.state == .tokenInvalid }
        XCTAssertTrue(invalid)
        let opened = h.factory.sockets.count

        p.model.appWentToBackground()
        XCTAssertEqual(h.engine.state, .tokenInvalid, "Der Hintergrund verdeckt „Token ungültig“ nicht")
        XCTAssertEqual(h.factory.invalidateCount, 1)

        p.routing.fixedEndpoint = CoreEndpoint(host: "127.0.0.1", port: 41009)
        p.model.appBecameActive()
        await h.clock.advance(100)

        XCTAssertEqual(h.engine.state, .tokenInvalid)
        XCTAssertEqual(h.factory.sockets.count, opened, "Token ungültig: keine neuen Versuche")
        XCTAssertEqual(p.model.badgeState, .disconnected(.tokenInvalid))
    }

    func testResumeWithoutSuspendDoesNothing() async {
        let h = SyncHarness()
        h.engine.resumeConnections()
        XCTAssertEqual(h.engine.state, .stopped)
        XCTAssertTrue(h.factory.sockets.isEmpty)
    }

    func testSuspendWithoutARunningSyncOnlyInvalidatesTheSession() {
        let h = SyncHarness()

        h.engine.suspendConnections()

        XCTAssertEqual(h.factory.invalidateCount, 1)
        XCTAssertEqual(h.engine.state, .stopped)
    }
}
