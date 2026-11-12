import Darwin
import XCTest

@testable import StudienGehirn

/// UX-12, PR 0 (Befund B5): Das Token geht nur an Adressen im eigenen Netz.

// MARK: - Hilfen

/// Schnittstellen, die ein Test mitten im Ablauf wechseln kann (iPad verlässt das Heimnetz oder kommt zurück)
final class SwitchableInterfaces: InterfaceListing, @unchecked Sendable {
    private let lock = NSLock()
    private var list: [InterfaceAddress]

    init(_ list: [InterfaceAddress]) {
        self.list = list
    }

    func set(_ newList: [InterfaceAddress]) {
        lock.lock()
        list = newList
        lock.unlock()
    }

    func activeIPv4() -> [InterfaceAddress] {
        lock.lock()
        defer { lock.unlock() }
        return list
    }
}

// MARK: - Reine Funktion

final class TokenDestinationTests: XCTestCase {
    private func iface(_ address: String, _ prefix: Int) -> InterfaceAddress {
        FakeInterfaces.address(address, prefix: prefix)
    }

    private func allows(_ host: String, _ interfaces: [InterfaceAddress]) -> Bool {
        TokenDestination.allows(host: host, interfaces: interfaces)
    }

    func testSlash24() {
        let home = [iface("192.168.1.5", 24)]
        XCTAssertTrue(allows("192.168.1.20", home))
        XCTAssertTrue(allows("192.168.1.5", home))
        XCTAssertTrue(allows("192.168.1.1", home))
        XCTAssertFalse(allows("192.168.2.20", home))
        XCTAssertFalse(allows("192.168.0.20", home))
        XCTAssertFalse(allows("10.0.0.20", home))
    }

    func testSlash16() {
        let net = [iface("10.1.2.3", 16)]
        XCTAssertTrue(allows("10.1.200.9", net))
        XCTAssertTrue(allows("10.1.0.1", net))
        XCTAssertFalse(allows("10.2.0.1", net))
        XCTAssertFalse(allows("10.0.255.255", net))
    }

    func testSlash32OnlyMatchesTheInterfaceItself() {
        let single = [iface("10.0.0.5", 32)]
        XCTAssertTrue(allows("10.0.0.5", single))
        XCTAssertFalse(allows("10.0.0.6", single))
        XCTAssertFalse(allows("10.0.0.4", single))
    }

    func testLinkLocalOnlyMatchesALinkLocalInterface() {
        let linkLocal = [iface("169.254.10.1", 16)]
        XCTAssertTrue(allows("169.254.200.3", linkLocal))
        XCTAssertFalse(allows("192.168.1.20", linkLocal))
        // Eine 169.254-Adresse ohne passende Schnittstelle ist kein „eigenes Netz“
        XCTAssertFalse(allows("169.254.200.3", [iface("192.168.1.5", 24)]))
    }

    func testAnyOfSeveralInterfacesCounts() {
        let both = [iface("192.168.1.5", 24), iface("10.0.0.2", 8)]
        XCTAssertTrue(allows("192.168.1.20", both))
        XCTAssertTrue(allows("10.200.0.9", both))
        XCTAssertFalse(allows("172.16.0.1", both))
        XCTAssertFalse(allows("192.168.2.20", both))
    }

    func testNoInterfaceMeansNoIPv4Destination() {
        XCTAssertFalse(allows("192.168.1.20", []))
        XCTAssertFalse(allows("10.0.0.1", []))
    }

    func testLocalNamesNeverGetAToken() {
        // #261: Ein fremdes Netz kann die mDNS-Frage beantworten, darum geht an `.local` nie ein Token
        XCTAssertFalse(allows("mein-mac.local", []))
        XCTAssertFalse(allows("Mein-Mac.LOCAL", [iface("192.168.1.5", 24)]))
        XCTAssertFalse(allows("a.b.local", [iface("192.168.1.5", 24)]))
        XCTAssertFalse(allows("mein-mac.local", [iface("0.0.0.0", 1)]))
    }

    func testIsLocalName() {
        XCTAssertTrue(TokenDestination.isLocalName("mein-mac.local"))
        XCTAssertTrue(TokenDestination.isLocalName(" Mein-Mac.LOCAL "))
        XCTAssertFalse(TokenDestination.isLocalName("192.168.1.20"))
        XCTAssertFalse(TokenDestination.isLocalName("example.com"))
        XCTAssertFalse(TokenDestination.isLocalName("mac.local.evil.com"))
        XCTAssertFalse(TokenDestination.isLocalName(".local"))
    }

    func testOtherNamesAreRejected() {
        let home = [iface("192.168.1.5", 24)]
        for host in [
            "example.com", "mein-mac", "local", ".local", "mac.local.", "mac.local.evil.com", "mac.localhost",
            "mac_1.local", "mac local.local", "mac..local", "localhost",
        ] {
            XCTAssertFalse(allows(host, home), host)
        }
    }

    func testIPv6IsRejected() {
        // `CoreEndpoint` speichert keine IPv6-Adressen, und für sie gibt es keine Subnetzprüfung: lieber nichts senden
        let home = [iface("192.168.1.5", 24)]
        for host in ["fe80::1", "::1", "[fd00::1]", "::ffff:192.168.1.20", "2001:db8::1", "fe80::1%en0"] {
            XCTAssertFalse(allows(host, home), host)
        }
    }

    func testInvalidIPv4IsRejected() {
        // 8.0.0.5/8 und 10.0.0.5/8: `010.0.0.1` darf weder als 8.x noch als 10.x durchgehen
        let net = [iface("8.0.0.5", 8), iface("10.0.0.5", 8), iface("192.168.1.5", 24)]
        for host in [
            "", " ", "192.168.1", "192.168.1.256", "192.168.1.20.1", "192.168.001.020", "010.0.0.1", "10.0.0.01",
            "10.0.0.-1", "10.0.0.1/24", "a.b.c.d", "+10.0.0.1", "10.0.0.1x", "１０.0.0.1", "192.168.1.", ".192.168.1.1",
            "0x0a.0.0.1", "10.0.0.1:4710",
        ] {
            XCTAssertFalse(allows(host, net), host)
        }
    }

    func testSurroundingWhitespaceAndCaseAreIgnored() {
        XCTAssertTrue(allows(" 192.168.1.20\n", [iface("192.168.1.5", 24)]))
    }

    func testUnusableNetmasksNeverMatch() {
        // Maske 0 ließe jede Adresse durch
        XCTAssertFalse(allows("8.8.8.8", [InterfaceAddress(address: 0xC0A8_0105, netmask: 0)]))
        // Nicht zusammenhängende Maske
        XCTAssertFalse(allows("192.168.1.20", [InterfaceAddress(address: 0xC0A8_0105, netmask: 0xFF00_FF00)]))
        // Ein unbrauchbarer Eintrag sperrt die anderen nicht
        XCTAssertTrue(
            allows(
                "192.168.1.20", [InterfaceAddress(address: 0xC0A8_0105, netmask: 0), iface("192.168.1.5", 24)]))
    }

    func testParseIPv4() {
        XCTAssertEqual(TokenDestination.parseIPv4("192.168.1.5"), 0xC0A8_0105)
        XCTAssertEqual(TokenDestination.parseIPv4("0.0.0.0"), 0)
        XCTAssertEqual(TokenDestination.parseIPv4("255.255.255.255"), UInt32.max)
        XCTAssertNil(TokenDestination.parseIPv4("1.2.3"))
        XCTAssertNil(TokenDestination.parseIPv4("01.2.3.4"))
    }

    func testFakeInterfaceHelperBuildsMasks() {
        XCTAssertEqual(FakeInterfaces.address("10.0.0.1", prefix: 24).netmask, 0xFFFF_FF00)
        XCTAssertEqual(FakeInterfaces.address("10.0.0.1", prefix: 32).netmask, UInt32.max)
        XCTAssertEqual(FakeInterfaces.address("10.0.0.1", prefix: 8).netmask, 0xFF00_0000)
    }

    func testTunnelsAndCellularDoNotCount() {
        let up = UInt32(IFF_UP) | UInt32(IFF_RUNNING)
        let pointToPoint = UInt32(IFF_POINTOPOINT)
        XCTAssertTrue(SystemInterfaceListing.counts(name: "en0", flags: up))
        XCTAssertTrue(SystemInterfaceListing.counts(name: "en2", flags: up))
        XCTAssertTrue(SystemInterfaceListing.counts(name: "bridge100", flags: up))
        XCTAssertFalse(SystemInterfaceListing.counts(name: "en0", flags: UInt32(IFF_UP)))
        XCTAssertFalse(SystemInterfaceListing.counts(name: "en0", flags: UInt32(IFF_RUNNING)))
        XCTAssertFalse(SystemInterfaceListing.counts(name: "lo0", flags: up | UInt32(IFF_LOOPBACK)))
        // VPN und Mobilfunk: per Flag und, falls es fehlt, per Name
        XCTAssertFalse(SystemInterfaceListing.counts(name: "utun4", flags: up | pointToPoint))
        XCTAssertFalse(SystemInterfaceListing.counts(name: "pdp_ip0", flags: up | pointToPoint))
        XCTAssertFalse(SystemInterfaceListing.counts(name: "en5", flags: up | pointToPoint))
        XCTAssertFalse(SystemInterfaceListing.counts(name: "utun4", flags: up))
        XCTAssertFalse(SystemInterfaceListing.counts(name: "ipsec0", flags: up))
        XCTAssertFalse(SystemInterfaceListing.counts(name: "ppp0", flags: up))
        XCTAssertFalse(SystemInterfaceListing.counts(name: "pdp_ip1", flags: up))
    }

    func testSystemListingDoesNotCrashAndSkipsLoopback() {
        // Auf der CI gibt es unterschiedliche Schnittstellen: geprüft wird nur, dass kein Loopback dabei ist
        let found = SystemInterfaceListing().activeIPv4()
        XCTAssertFalse(found.contains(where: { ($0.address >> 24) == 127 }))
    }
}

// MARK: - CoreClient: außerhalb des Subnetzes geht nichts raus

@MainActor
final class TokenOnlyInOwnNetworkClientTests: XCTestCase {
    private func failure(of operation: @MainActor () async throws -> Void) async -> ConnectionError? {
        do {
            try await operation()
            return nil
        } catch {
            return ConnectionError.wrap(error)
        }
    }

    private func tempFile() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("tok-\(UUID().uuidString).pdf.part")
    }

    /// Alle Wege, auf denen ein Token mitgeht
    private func tokenCalls(_ client: CoreClient, file: URL) -> [(String, @MainActor () async throws -> Void)] {
        let endpoint = Fixtures.endpoint
        let token = Fixtures.token
        let id = Fixtures.deviceID
        return [
            ("checkHealth", { try await client.checkHealth(endpoint: endpoint, token: token) }),
            ("removeDevice", { try await client.removeDevice(endpoint: endpoint, deviceID: id, token: token) }),
            ("activeSessions", { _ = try await client.activeSessions(endpoint: endpoint, token: token) }),
            ("moduleName", { _ = try await client.moduleName(endpoint: endpoint, token: token, moduleID: id) }),
            ("modules", { _ = try await client.modules(endpoint: endpoint, token: token) }),
            ("notebooks", { _ = try await client.notebooks(endpoint: endpoint, token: token, moduleID: id) }),
            ("notebookPages", { _ = try await client.notebookPages(endpoint: endpoint, token: token, notebookID: id) }),
            ("pageStrokes", { _ = try await client.pageStrokes(endpoint: endpoint, token: token, pageID: id) }),
            ("pageState", { _ = try await client.pageState(endpoint: endpoint, token: token, pageID: id) }),
            ("slideDeck", { _ = try await client.slideDeck(endpoint: endpoint, token: token, deckID: id) }),
            ("lectureDefaults", { _ = try await client.lectureDefaults(endpoint: endpoint, token: token) }),
            (
                "patchModuleInkMode",
                { try await client.patchModuleInkMode(endpoint: endpoint, token: token, moduleID: id, mode: .freieSeite) }
            ),
            (
                "downloadSlideDeckFile",
                { try await client.downloadSlideDeckFile(endpoint: endpoint, token: token, deckID: id, to: file) }
            ),
        ]
    }

    func testNothingLeavesTheDeviceOutsideTheSubnet() async {
        for (label, interfaces) in [
            ("anderes Netz", Fixtures.otherNetwork), ("keine Schnittstelle", FakeInterfaces([])),
        ] {
            let transport = FakeTransport([.http(status: 200, body: "{}")])
            let file = tempFile()
            for (name, call) in tokenCalls(Fixtures.client(transport, interfaces: interfaces), file: file) {
                let error = await failure(of: call)
                XCTAssertEqual(error, .otherNetwork, "\(label): \(name)")
            }
            XCTAssertEqual(transport.requests.count, 0, "\(label): REST-Anfragen")
            XCTAssertEqual(transport.downloadRequests.count, 0, "\(label): Downloads")
            XCTAssertFalse(FileManager.default.fileExists(atPath: file.path), label)
        }
    }

    func testTheSameCallsGoOutInsideTheSubnet() async {
        let transport = FakeTransport([.http(status: 200, body: "{}")])
        let file = tempFile()
        defer { try? FileManager.default.removeItem(at: file) }
        let client = Fixtures.client(transport, interfaces: Fixtures.sameNetwork)

        try? await client.checkHealth(endpoint: Fixtures.endpoint, token: Fixtures.token)
        try? await client.removeDevice(endpoint: Fixtures.endpoint, deviceID: Fixtures.deviceID, token: Fixtures.token)
        try? await client.downloadSlideDeckFile(
            endpoint: Fixtures.endpoint, token: Fixtures.token, deckID: Fixtures.deviceID, to: file)

        XCTAssertEqual(transport.requests.count, 2)
        XCTAssertEqual(transport.downloadRequests.count, 1)
    }

    func testNetworkChangeIsPickedUpOnTheNextCall() async throws {
        let interfaces = SwitchableInterfaces([FakeInterfaces.address("198.51.100.5", prefix: 24)])
        let transport = FakeTransport([.http(status: 200, body: "{}")])
        let client = Fixtures.client(transport, interfaces: interfaces)

        let blocked = await failure { try await client.checkHealth(endpoint: Fixtures.endpoint, token: Fixtures.token) }
        XCTAssertEqual(blocked, .otherNetwork)
        XCTAssertEqual(transport.requests.count, 0)

        interfaces.set([FakeInterfaces.address("192.0.2.77", prefix: 24)])
        try await client.checkHealth(endpoint: Fixtures.endpoint, token: Fixtures.token)
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testRetryAfterConnectionLossIsCheckedAgain() async {
        // `networkConnectionLost` kommt typisch beim Wechsel des WLANs: Die Wiederholung darf nicht ungeprüft raus
        let interfaces = SwitchableInterfaces([FakeInterfaces.address("192.0.2.77", prefix: 24)])
        let transport = FakeTransport([.failure(.networkConnectionLost), .http(status: 200, body: "{}")])
        transport.duringRequest = { _ in
            interfaces.set([FakeInterfaces.address("198.51.100.5", prefix: 24)])
        }
        let client = Fixtures.client(transport, interfaces: interfaces)

        let error = await failure { try await client.checkHealth(endpoint: Fixtures.endpoint, token: Fixtures.token) }

        XCTAssertEqual(error, .otherNetwork)
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testLocalNamesNeverGetARequestWithToken() async throws {
        // #261: auch dann nicht, wenn das iPad im Heimnetz hängt
        let endpoint = try XCTUnwrap(CoreEndpoint(host: "mein-mac.local"))
        for interfaces in [FakeInterfaces([]), Fixtures.sameNetwork] {
            let transport = FakeTransport([.http(status: 200, body: "{}")])
            let file = tempFile()
            let client = Fixtures.client(transport, interfaces: interfaces)
            let calls: [(String, @MainActor () async throws -> Void)] = [
                ("checkHealth", { try await client.checkHealth(endpoint: endpoint, token: Fixtures.token) }),
                (
                    "removeDevice",
                    { try await client.removeDevice(endpoint: endpoint, deviceID: Fixtures.deviceID, token: Fixtures.token) }
                ),
                ("modules", { _ = try await client.modules(endpoint: endpoint, token: Fixtures.token) }),
                (
                    "downloadSlideDeckFile",
                    {
                        try await client.downloadSlideDeckFile(
                            endpoint: endpoint, token: Fixtures.token, deckID: Fixtures.deviceID, to: file)
                    }
                ),
            ]
            for (name, call) in calls {
                let error = await failure(of: call)
                XCTAssertEqual(error, .rePairingNeeded, name)
            }
            XCTAssertEqual(transport.requests.count, 0)
            XCTAssertEqual(transport.downloadRequests.count, 0)
            XCTAssertFalse(client.allowsToken(for: endpoint))
        }
    }

    func testPairingWithoutTokenStaysPossibleInAnyNetwork() async throws {
        let transport = FakeTransport([
            .http(status: 201, body: Fixtures.pairStartResponse),
            .http(status: 201, body: Fixtures.pairResponse),
        ])
        let client = Fixtures.client(transport, interfaces: Fixtures.otherNetwork)

        let pairingID = try await client.pairStart(
            endpoint: Fixtures.endpoint, deviceName: "iPad Test", nonce: PairingInput.makeNonce())
        let result = try await client.pairConfirm(
            endpoint: Fixtures.endpoint, pairingID: pairingID, code: "123456", deviceName: "iPad Test",
            nonce: PairingInput.makeNonce(), appVersion: "0.1.0")

        XCTAssertEqual(transport.requests.count, 2)
        XCTAssertEqual(result.deviceToken, Fixtures.token)
        // Die Kopplung schickt kein Token
        XCTAssertTrue(transport.requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == nil })
    }

    func testRePairingNeededHasQuietTexts() {
        let error = ConnectionError.rePairingNeeded
        XCTAssertEqual(error.title, "Bitte einmal neu koppeln")
        XCTAssertTrue(error.advice.contains("Neu koppeln"))
        XCTAssertTrue(error.advice.contains("QR-Code"))
        XCTAssertNotEqual(error.title, ConnectionError.otherNetwork.title)
        XCTAssertFalse(error.title.contains("nicht im selben Netz"))
        XCTAssertTrue(error.needsNewPairing)
        XCTAssertEqual(HomeTexts.rePairingCard, "\(error.title) · \(error.advice)")
    }

    func testOtherNetworkHasQuietTexts() {
        XCTAssertEqual(ConnectionError.otherNetwork.title, "Mac nicht im selben Netz")
        XCTAssertEqual(
            ConnectionError.otherNetwork.advice, "Deine Notizen bleiben auf dem iPad und gleichen sich später ab.")
        XCTAssertFalse(ConnectionError.otherNetwork.needsNewPairing)
        XCTAssertEqual(
            HomeTexts.otherNetworkCard,
            "\(ConnectionError.otherNetwork.title) · \(ConnectionError.otherNetwork.advice)")
    }
}

// MARK: - SyncEngine: kein Socket außerhalb des Subnetzes

@MainActor
final class TokenOnlyInOwnNetworkSyncTests: XCTestCase {
    func testOpensNoSocketOutsideTheSubnetAndKeepsTheQueue() async {
        let interfaces = SwitchableInterfaces([FakeInterfaces.address("198.51.100.5", prefix: 24)])
        let h = SyncHarness(interfaces: interfaces)
        XCTAssertTrue(h.enqueueStrokes(3))
        XCTAssertEqual(h.engine.pendingCount, 3)

        h.start()
        let waiting = await eventually { h.engine.state == .waiting }
        XCTAssertTrue(waiting)

        // Auch nach mehreren Wartezeiten (1 s bis 30 s): kein Socket, keine Anfrage, Warteschlange unverändert
        await h.clock.advance(120)
        XCTAssertEqual(h.engine.state, .waiting)
        XCTAssertEqual(h.factory.sockets.count, 0)
        XCTAssertEqual(h.factory.requests.count, 0)
        XCTAssertEqual(h.transport.requests.count, 0)
        XCTAssertEqual(h.engine.pendingCount, 3)
        XCTAssertEqual(h.engine.deadLetterCount, 0)
    }

    func testNoInterfaceAtAllOpensNoSocketEither() async {
        let h = SyncHarness(interfaces: FakeInterfaces([]))
        h.start()
        let waiting = await eventually { h.engine.state == .waiting }
        XCTAssertTrue(waiting)
        await h.clock.advance(60)
        XCTAssertEqual(h.factory.sockets.count, 0)
        XCTAssertEqual(h.transport.requests.count, 0)
    }

    func testConnectsAsBeforeInsideTheSubnet() async {
        let h = SyncHarness(interfaces: Fixtures.sameNetwork)
        h.enqueueStrokes(2)
        h.start()

        let done = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(done)
        XCTAssertEqual(h.engine.state, .online)
        XCTAssertEqual(h.factory.sockets.count, 1)
    }

    func testConnectsAfterTheDeviceReturnsToTheHomeNetwork() async {
        let interfaces = SwitchableInterfaces([FakeInterfaces.address("198.51.100.5", prefix: 24)])
        let h = SyncHarness(interfaces: interfaces)
        h.enqueueStrokes(2)
        h.start()
        _ = await eventually { h.engine.state == .waiting }
        XCTAssertEqual(h.factory.sockets.count, 0)

        interfaces.set([FakeInterfaces.address("192.0.2.77", prefix: 24)])
        h.engine.kick()

        let done = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(done)
        XCTAssertEqual(h.engine.state, .online)
        XCTAssertEqual(h.factory.sockets.count, 1)
    }

    func testHealthProbeAfterATransportErrorIsSkippedOutsideTheSubnet() async {
        // Das Netz wechselt zwischen Verbindungsaufbau und Fehler: Die Sonde `GET /health` trägt ebenfalls das Token
        let interfaces = SwitchableInterfaces([FakeInterfaces.address("192.0.2.77", prefix: 24)])
        let h = SyncHarness(interfaces: interfaces)
        h.factory.configure = { socket, _ in
            interfaces.set([FakeInterfaces.address("198.51.100.5", prefix: 24)])
            socket.initialFailure = .transport(URLError(.badServerResponse))
        }
        h.start()

        let waiting = await eventually { h.factory.sockets.count == 1 && h.engine.state == .waiting }
        XCTAssertTrue(waiting)
        XCTAssertEqual(h.transport.requests.count, 0)
        XCTAssertNotEqual(h.engine.state, .tokenInvalid)
    }
}

// MARK: - AppModel und Abzeichen

@MainActor
final class TokenOnlyInOwnNetworkAppModelTests: XCTestCase {
    private func makeModel(interfaces: any InterfaceListing) -> (AppModel, FakeTransport, FakeTokenStore, FakePairedMacStore) {
        let transport = FakeTransport([.http(status: 200, body: "{}")])
        let tokens = FakeTokenStore(token: Fixtures.token)
        let macs = FakePairedMacStore(mac: Fixtures.pairedMac)
        let model = AppModel(
            client: Fixtures.client(transport, interfaces: interfaces),
            tokenStore: tokens,
            macStore: macs,
            deviceName: "iPad Test",
            appVersion: "0.1.0"
        )
        return (model, transport, tokens, macs)
    }

    func testPollingInAnotherNetworkSendsNothingAndShowsAQuietBadge() async {
        let (model, transport, _, _) = makeModel(interfaces: Fixtures.otherNetwork)

        await model.pollConnection()
        await model.pollConnection()

        XCTAssertEqual(transport.requests.count, 0)
        XCTAssertEqual(model.connection, .disconnected(.otherNetwork))
        XCTAssertEqual(model.phase, .paired(Fixtures.pairedMac))
        let badge = model.badgeState
        XCTAssertFalse(badge.isGreen)
        XCTAssertEqual(badge, .disconnected(.otherNetwork))
        XCTAssertEqual(badge.headline, "Mac nicht im selben Netz")
        XCTAssertEqual(badge.detail, "Deine Notizen bleiben auf dem iPad und gleichen sich später ab.")
        XCTAssertEqual(badge.accessibilityLabel, "iPad nicht verbunden")
    }

    func testOtherNetworkDoesNotOfferNewPairing() async {
        let (model, _, _, _) = makeModel(interfaces: Fixtures.otherNetwork)
        await model.checkConnection()
        XCTAssertFalse(model.connection == .disconnected(.tokenInvalid))
        XCTAssertFalse(ConnectionError.otherNetwork.needsNewPairing)
    }

    func testPollingInTheHomeNetworkStillConnects() async {
        let (model, transport, _, _) = makeModel(interfaces: Fixtures.sameNetwork)
        await model.pollConnection()
        XCTAssertEqual(model.connection, .connected)
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testStoredLocalNameShowsRePairingTextWithoutAnyRequest() async {
        let local = PairedMac(
            endpoint: CoreEndpoint(host: "mein-mac.local")!, deviceID: Fixtures.deviceID, deviceName: "iPad Test")
        let transport = FakeTransport([.http(status: 200, body: "{}")])
        let model = AppModel(
            client: Fixtures.client(transport, interfaces: Fixtures.sameNetwork),
            tokenStore: FakeTokenStore(token: Fixtures.token),
            macStore: FakePairedMacStore(mac: local),
            deviceName: "iPad Test",
            appVersion: "0.1.0"
        )

        await model.pollConnection()
        await model.pollConnection()

        XCTAssertEqual(transport.requests.count, 0)
        XCTAssertEqual(model.connection, .disconnected(.rePairingNeeded))
        // Die Kopplung bleibt, nichts wird gelöscht
        XCTAssertEqual(model.phase, .paired(local))
        let badge = model.badgeState
        XCTAssertFalse(badge.isGreen)
        XCTAssertEqual(badge.headline, "Bitte einmal neu koppeln")
        XCTAssertEqual(badge.detail, ConnectionError.rePairingNeeded.advice)
        XCTAssertNotEqual(badge.headline, "Mac nicht im selben Netz")
    }

    func testUnpairDeletesLocallyEvenWhenTheMacIsNotInTheSameNetwork() async {
        let (model, transport, tokens, macs) = makeModel(interfaces: Fixtures.otherNetwork)

        await model.unpair()

        XCTAssertEqual(transport.requests.count, 0)
        XCTAssertNil(tokens.token)
        XCTAssertNil(macs.mac)
        XCTAssertEqual(model.phase, .unpaired)
    }

    func testRevokedTokenStillWinsOverOtherNetwork() {
        XCTAssertEqual(
            BadgeState.resolve(connection: .disconnected(.otherNetwork), syncState: .tokenInvalid),
            .disconnected(.tokenInvalid))
        XCTAssertEqual(
            BadgeState.resolve(connection: .disconnected(.otherNetwork), syncState: .online), .online)
    }
}
