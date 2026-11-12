import XCTest

@testable import StudienGehirn

// Nach der Umstellung (UX-12, PR 4; Plan E7, §5.4) geht kein Token mehr an eine IP-Adresse im Netz. Jede Anfrage mit
// `Authorization`-Header geht an die Adresse des lokalen Weiterleiters (Loopback, Port des Listeners) und von dort durch
// den beglaubigten Tunnel. Keine geht an `PairedMac.endpoint`. Die Kopplung läuft weiter direkt und ohne Token.

@MainActor
private func failure(_ body: @MainActor () async throws -> Void) async -> ConnectionError? {
    do {
        try await body()
        return nil
    } catch {
        return ConnectionError.wrap(error)
    }
}

/// Zahl der aufgezeichneten Anfragen mit Token
@MainActor
private func tokenRequests(_ transport: FakeTransport) -> [URLRequest] {
    (transport.requests + transport.downloadRequests).filter { $0.value(forHTTPHeaderField: "Authorization") != nil }
}

@MainActor
final class TokenOnlyViaForwarderClientTests: XCTestCase {
    private let forwarderEndpoint = CoreEndpoint(host: "127.0.0.1", port: 41000)!

    private func makeClient(
        routing: FakeRouting, interfaces: any InterfaceListing = Fixtures.sameNetwork
    ) -> (CoreClient, FakeTransport) {
        let transport = FakeTransport([.http(status: 200, body: "{}")])
        return (Fixtures.client(transport, interfaces: interfaces, routing: routing), transport)
    }

    func testRequestsWithTokenGoToTheForwarderAddress() async throws {
        let routing = FakeRouting(endpoint: forwarderEndpoint)
        let (client, transport) = makeClient(routing: routing)

        try await client.checkHealth(endpoint: forwarderEndpoint, token: Fixtures.token)

        let sent = tokenRequests(transport)
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent.first?.url?.host, "127.0.0.1")
        XCTAssertEqual(sent.first?.url?.port, 41000)
        XCTAssertEqual(sent.first?.url?.scheme, "http")
    }

    func testNoTokenGoesToAnIPAddressInTheNetworkEvenInsideTheSubnet() async {
        // Mit dem Altweg (PR 0) wäre diese Adresse erlaubt (gleiches Netz). Nach der Umstellung geht dorthin nichts.
        let routing = FakeRouting(endpoint: forwarderEndpoint)
        let (client, transport) = makeClient(routing: routing, interfaces: Fixtures.sameNetwork)
        XCTAssertFalse(client.allowsToken(for: Fixtures.endpoint))

        let health = await failure { try await client.checkHealth(endpoint: Fixtures.endpoint, token: Fixtures.token) }
        let remove = await failure {
            try await client.removeDevice(endpoint: Fixtures.endpoint, deviceID: Fixtures.deviceID, token: Fixtures.token)
        }
        let sessions = await failure {
            _ = try await client.activeSessions(endpoint: Fixtures.endpoint, token: Fixtures.token)
        }
        let modules = await failure { _ = try await client.modules(endpoint: Fixtures.endpoint, token: Fixtures.token) }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("blocked-\(UUID().uuidString).pdf")
        let download = await failure {
            try await client.downloadSlideDeckFile(
                endpoint: Fixtures.endpoint, token: Fixtures.token, deckID: Fixtures.deviceID, to: file)
        }

        for result in [health, remove, sessions, modules, download] {
            XCTAssertEqual(result, .tunnelMacNotFound)
        }
        XCTAssertTrue(transport.requests.isEmpty)
        XCTAssertTrue(transport.downloadRequests.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testNoTokenGoesToAnotherLoopbackPort() async {
        let routing = FakeRouting(endpoint: forwarderEndpoint)
        let (client, transport) = makeClient(routing: routing)
        let other = CoreEndpoint(host: "127.0.0.1", port: 4710)!

        let result = await failure { try await client.checkHealth(endpoint: other, token: Fixtures.token) }

        XCTAssertEqual(result, .tunnelMacNotFound)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testRemovalOfDeviceAndRestRequestsAlsoGoThroughTheForwarder() async throws {
        let routing = FakeRouting(endpoint: forwarderEndpoint)
        let (client, transport) = makeClient(routing: routing)
        transport.replies = [.http(status: 204, body: "")]

        try await client.removeDevice(endpoint: forwarderEndpoint, deviceID: Fixtures.deviceID, token: Fixtures.token)
        transport.replies = [.http(status: 200, body: "{\"items\":[],\"next_cursor\":null}")]
        _ = try await client.activeSessions(endpoint: forwarderEndpoint, token: Fixtures.token)

        let sent = tokenRequests(transport)
        XCTAssertEqual(sent.count, 2)
        XCTAssertTrue(sent.allSatisfy { $0.url?.host == "127.0.0.1" && $0.url?.port == 41000 })
    }

    func testWithoutAForwarderNothingWithATokenLeaves() async {
        // Schlüssel fehlt, Hintergrund oder noch nicht bereit: keine Adresse, also kein Verkehr
        let routing = FakeRouting(endpoint: nil, state: .down(.repairNeeded))
        let (client, transport) = makeClient(routing: routing)

        let local = await failure { try await client.checkHealth(endpoint: forwarderEndpoint, token: Fixtures.token) }
        let lan = await failure { try await client.checkHealth(endpoint: Fixtures.endpoint, token: Fixtures.token) }

        XCTAssertEqual(local, .tunnelKeyMissing)
        XCTAssertEqual(lan, .tunnelKeyMissing)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testTheRetryAfterAConnectionLossIsCheckedAgain() async {
        // Der Weiterleiter verschwindet zwischen Versuch und Wiederholung (App im Hintergrund): Die Wiederholung geht nicht
        // mehr raus
        let routing = FakeRouting(endpoint: forwarderEndpoint)
        let transport = FakeTransport([.failure(.networkConnectionLost)])
        let client = Fixtures.client(transport, routing: routing)
        transport.duringRequest = { _ in routing.fixedEndpoint = nil }

        let result = await failure { try await client.checkHealth(endpoint: forwarderEndpoint, token: Fixtures.token) }

        XCTAssertEqual(transport.requests.count, 1)
        XCTAssertNotNil(result)
    }

    func testPairingStillGoesDirectlyToTheAddressWithoutAToken() async throws {
        let routing = FakeRouting(endpoint: forwarderEndpoint)
        let transport = FakeTransport([.http(status: 201, body: Fixtures.pairStartResponse)])
        let client = Fixtures.client(transport, routing: routing)

        _ = try await client.pairStart(endpoint: Fixtures.endpoint, deviceName: "iPad Test", nonce: "n")

        XCTAssertEqual(transport.requests.count, 1)
        XCTAssertEqual(transport.requests.first?.url?.host, Fixtures.endpoint.host)
        XCTAssertNil(transport.requests.first?.value(forHTTPHeaderField: "Authorization"))
    }

    func testPairingChecksTheOwnNetworkIndependentlyOfTheRoute() {
        let routing = FakeRouting(endpoint: nil, state: .idle)
        let (client, _) = makeClient(routing: routing, interfaces: Fixtures.sameNetwork)
        XCTAssertTrue(client.isInOwnNetwork(Fixtures.endpoint))
        let (otherClient, _) = makeClient(routing: routing, interfaces: Fixtures.otherNetwork)
        XCTAssertFalse(otherClient.isInOwnNetwork(Fixtures.endpoint))
    }

    func testTokenEndpointComesFromTheRouteNotFromTheStoredMac() {
        let routing = FakeRouting(endpoint: forwarderEndpoint)
        let (client, _) = makeClient(routing: routing)
        XCTAssertEqual(client.tokenEndpoint(for: Fixtures.pairedMac), forwarderEndpoint)
        routing.fixedEndpoint = nil
        XCTAssertNil(client.tokenEndpoint(for: Fixtures.pairedMac))
    }
}

@MainActor
final class TokenOnlyViaForwarderSyncTests: XCTestCase {
    private let forwarderEndpoint = CoreEndpoint(host: "127.0.0.1", port: 41000)!

    func testSyncOpensItsSocketOnTheForwarderAddressOnly() async {
        let routing = FakeRouting(endpoint: forwarderEndpoint)
        let h = SyncHarness(routing: routing)
        h.enqueueStrokes(2)
        h.start()

        let done = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(done)
        XCTAssertEqual(h.engine.state, .online)
        XCTAssertEqual(h.factory.requests.count, 1)
        let request = h.factory.requests.first
        XCTAssertEqual(request?.url?.absoluteString, "ws://127.0.0.1:41000/sync")
        XCTAssertEqual(request?.value(forHTTPHeaderField: "Authorization"), "Bearer \(Fixtures.token)")
        // Die gespeicherte Adresse des Macs kommt nirgends vor
        XCTAssertFalse(h.factory.requests.contains { $0.url?.host == Fixtures.pairedMac.endpoint.host })
    }

    func testWithoutAForwarderNoSocketIsOpenedAndTheQueueStays() async {
        let routing = FakeRouting(endpoint: nil, state: .down(.repairNeeded))
        let h = SyncHarness(routing: routing)
        h.enqueueStrokes(3)
        h.start()

        let waiting = await eventually { h.engine.state == .waiting }
        XCTAssertTrue(waiting)
        await h.clock.advance(120)

        XCTAssertEqual(h.engine.state, .waiting)
        XCTAssertEqual(h.factory.sockets.count, 0)
        XCTAssertEqual(h.factory.requests.count, 0)
        XCTAssertEqual(h.transport.requests.count, 0)
        XCTAssertEqual(h.engine.pendingCount, 3)
        XCTAssertNil(h.engine.restAccess())
    }

    func testSyncConnectsAsSoonAsTheForwarderIsThere() async {
        let routing = FakeRouting(endpoint: nil, state: .connecting)
        let h = SyncHarness(routing: routing)
        h.enqueueStrokes(2)
        h.start()
        _ = await eventually { h.engine.state == .waiting }
        XCTAssertEqual(h.factory.sockets.count, 0)

        routing.fixedEndpoint = forwarderEndpoint
        routing.state = .up(.direct)
        h.engine.routeChanged()

        let done = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(done)
        XCTAssertEqual(h.engine.state, .online)
        XCTAssertEqual(h.factory.requests.first?.url?.port, 41000)
    }

    func testRestAccessUsesTheForwarderAddress() async {
        let routing = FakeRouting(endpoint: forwarderEndpoint)
        let h = SyncHarness(routing: routing)
        h.start()
        _ = await eventually { h.engine.state == .online }

        XCTAssertEqual(h.engine.restAccess()?.endpoint, forwarderEndpoint)
        XCTAssertNotEqual(h.engine.restAccess()?.endpoint, Fixtures.pairedMac.endpoint)
    }

    func testNewPortAfterBackgroundIsUsedByTheNextConnection() async {
        let routing = FakeRouting(endpoint: forwarderEndpoint)
        let h = SyncHarness(routing: routing)
        h.start()
        _ = await eventually { h.engine.state == .online }
        XCTAssertEqual(h.factory.requests.count, 1)

        // App im Hintergrund: Weiterleiter weg, die Verbindung bricht. Zurück: neuer Port.
        routing.fixedEndpoint = nil
        h.factory.sockets.first?.fail(.transport(URLError(.networkConnectionLost)))
        _ = await eventually { h.engine.state == .waiting }
        routing.fixedEndpoint = CoreEndpoint(host: "127.0.0.1", port: 41007)
        h.engine.routeChanged()

        let again = await eventually { h.engine.state == .online && h.factory.requests.count == 2 }
        XCTAssertTrue(again)
        XCTAssertEqual(h.factory.requests.last?.url?.port, 41007)
    }
}

@MainActor
final class TokenOnlyViaForwarderAppModelTests: XCTestCase {
    private let forwarderEndpoint = CoreEndpoint(host: "127.0.0.1", port: 41000)!

    private func makeModel(
        routing: FakeRouting, keys: FakeTunnelKeyStore = FakeTunnelKeyStore(key: TunnelTestKeys.text())
    ) -> (AppModel, FakeTransport, FakeTokenStore, FakePairedMacStore) {
        let transport = FakeTransport([.http(status: 200, body: "{}")])
        let tokens = FakeTokenStore(token: Fixtures.token)
        let macs = FakePairedMacStore(mac: Fixtures.pairedMac)
        let model = AppModel(
            client: Fixtures.client(transport, routing: routing),
            tokenStore: tokens,
            macStore: macs,
            deviceName: "iPad Test",
            appVersion: "0.1.0",
            tunnelKeyStore: keys,
            routing: routing
        )
        return (model, transport, tokens, macs)
    }

    func testHealthCheckGoesToTheForwarderNotToTheStoredAddress() async {
        let routing = FakeRouting(endpoint: forwarderEndpoint)
        let (model, transport, _, _) = makeModel(routing: routing)

        await model.checkConnection()

        XCTAssertEqual(model.connection, .connected)
        XCTAssertEqual(transport.requests.count, 1)
        XCTAssertEqual(transport.requests.first?.url?.host, "127.0.0.1")
        XCTAssertEqual(transport.requests.first?.url?.port, 41000)
        XCTAssertEqual(routing.pairedCalls.last, true)
    }

    func testMissingKeySendsNothingAndShowsTheQuietText() async {
        let routing = FakeRouting(endpoint: nil, state: .down(.repairNeeded))
        let (model, transport, _, _) = makeModel(routing: routing, keys: FakeTunnelKeyStore(key: nil))

        await model.pollConnection()
        await model.pollConnection()

        XCTAssertTrue(transport.requests.isEmpty)
        XCTAssertEqual(model.connection, .disconnected(.tunnelKeyMissing))
        // Die Kopplung bleibt, nichts wird gelöscht
        XCTAssertEqual(model.phase, .paired(Fixtures.pairedMac))
        let badge = model.badgeState
        XCTAssertFalse(badge.isGreen)
        XCTAssertEqual(badge.headline, "Bitte einmal neu koppeln")
        XCTAssertEqual(badge.detail, ConnectionError.tunnelKeyMissing.advice)
        XCTAssertEqual(model.routeState, .down(.repairNeeded))
    }

    func testUnpairGoesThroughTheForwarderAndDeletesTokenAndKey() async {
        let routing = FakeRouting(endpoint: forwarderEndpoint)
        let keys = FakeTunnelKeyStore(key: TunnelTestKeys.text())
        let (model, transport, tokens, macs) = makeModel(routing: routing, keys: keys)
        transport.replies = [.http(status: 204, body: "")]

        await model.unpair()

        XCTAssertEqual(transport.requests.count, 1)
        XCTAssertEqual(transport.requests.first?.httpMethod, "DELETE")
        XCTAssertEqual(transport.requests.first?.url?.port, 41000)
        XCTAssertNil(tokens.token)
        XCTAssertNil(keys.key)
        XCTAssertNil(macs.mac)
        XCTAssertEqual(model.phase, .unpaired)
        XCTAssertEqual(routing.pairedCalls.last, false)
    }

    func testUnpairDeletesLocallyEvenWhenTheForwarderIsNotThere() async {
        let routing = FakeRouting(endpoint: nil, state: .down(.macNotFound))
        let keys = FakeTunnelKeyStore(key: TunnelTestKeys.text())
        let (model, transport, tokens, macs) = makeModel(routing: routing, keys: keys)

        await model.unpair()

        XCTAssertTrue(transport.requests.isEmpty)
        XCTAssertNil(tokens.token)
        XCTAssertNil(keys.key)
        XCTAssertNil(macs.mac)
        XCTAssertEqual(model.phase, .unpaired)
    }

    func testForegroundAndBackgroundReachTheRoute() {
        let routing = FakeRouting(endpoint: forwarderEndpoint)
        let (model, _, _, _) = makeModel(routing: routing)

        model.appBecameActive()
        model.appWentToBackground()

        XCTAssertEqual(routing.activeCalls, 1)
        XCTAssertEqual(routing.backgroundCalls, 1)
    }
}
