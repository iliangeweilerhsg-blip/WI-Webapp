import XCTest

@testable import StudienGehirn

/// #261: `.local` wird bei der Kopplung auf IPv4 aufgelöst, gespeichert wird die IP. Das Token geht nie an einen Namen.

/// Löst `.local` ohne Netz auf: feste Antwort, merkt sich die Fragen
final class FakeLocalResolver: LocalNameResolving, @unchecked Sendable {
    private let lock = NSLock()
    private var asked: [CoreEndpoint] = []
    private let answer: CoreEndpoint?

    init(answer: CoreEndpoint?) {
        self.answer = answer
    }

    var questions: [CoreEndpoint] {
        lock.lock()
        defer { lock.unlock() }
        return asked
    }

    func resolve(_ endpoint: CoreEndpoint) async -> CoreEndpoint? {
        record(endpoint)
        return answer
    }

    /// Synchron, weil `NSLock.lock()` in `async`-Funktionen nicht erlaubt ist
    private func record(_ endpoint: CoreEndpoint) {
        lock.lock()
        defer { lock.unlock() }
        asked.append(endpoint)
    }
}

@MainActor
final class LocalNameResolvedAtPairingTests: XCTestCase {
    private let localEndpoint = CoreEndpoint(host: "mein-mac.local", port: 4710)!
    private let localQR = "sg://pair?v=1&host=mein-mac.local&port=4710&pairing_id=\(Fixtures.qrPairingID)&code=123456"

    private struct Setup {
        let transport: FakeTransport
        let tokens = FakeTokenStore()
        let macs = FakePairedMacStore()
        let resolver: FakeLocalResolver
        let controller: PairingController

        @MainActor
        init(_ replies: [FakeTransport.Reply], resolvesTo answer: CoreEndpoint?) {
            transport = FakeTransport(replies)
            resolver = FakeLocalResolver(answer: answer)
            controller = PairingController(
                client: Fixtures.client(transport),
                tokenStore: tokens,
                macStore: macs,
                deviceName: "iPad Test",
                appVersion: "0.1.0",
                localResolver: resolver
            )
        }
    }

    func testManualLocalNameStoresTheIPAndAllStepsGoToTheIP() async throws {
        let setup = Setup(
            [.http(status: 201, body: Fixtures.pairStartResponse), .http(status: 201, body: Fixtures.pairResponse)],
            resolvesTo: Fixtures.endpoint)

        await setup.controller.start(endpoint: localEndpoint)
        XCTAssertEqual(setup.controller.state, .awaitingCode(Fixtures.endpoint, pairingID: Fixtures.publicPairingID))
        await setup.controller.submit(code: "123456")

        XCTAssertEqual(setup.controller.state, .paired)
        XCTAssertEqual(setup.resolver.questions, [localEndpoint])
        // Gespeichert wird die IP, nie der Name
        XCTAssertEqual(setup.macs.mac?.endpoint, Fixtures.endpoint)
        XCTAssertEqual(setup.macs.mac?.endpoint.host, "192.0.2.10")
        // Kein Schritt der Kopplung geht an den Namen
        XCTAssertEqual(setup.transport.requests.count, 2)
        for request in setup.transport.requests {
            XCTAssertEqual(request.url?.host, "192.0.2.10")
        }
    }

    func testUnresolvableLocalNameSendsNothingAndAdvisesTheIP() async {
        let setup = Setup([.http(status: 201, body: Fixtures.pairStartResponse)], resolvesTo: nil)

        await setup.controller.start(endpoint: localEndpoint)

        XCTAssertEqual(setup.controller.state, .idle)
        XCTAssertEqual(setup.controller.lastError, .localNameNotResolved)
        XCTAssertEqual(setup.transport.requests.count, 0)
        XCTAssertNil(setup.macs.mac)
        XCTAssertNil(setup.tokens.token)
        XCTAssertTrue(ConnectionError.localNameNotResolved.advice.contains("IP-Adresse"))
        XCTAssertTrue(ConnectionError.localNameNotResolved.advice.contains("QR-Code"))
    }

    func testResolverAnswerThatIsAnotherNameIsRefused() async throws {
        let setup = Setup(
            [.http(status: 201, body: Fixtures.pairStartResponse)],
            resolvesTo: try XCTUnwrap(CoreEndpoint(host: "anderer.local")))

        await setup.controller.start(endpoint: localEndpoint)

        XCTAssertEqual(setup.controller.lastError, .localNameNotResolved)
        XCTAssertEqual(setup.transport.requests.count, 0)
    }

    func testResolvedAddressOutsideTheIPadsNetworkIsRefused() async throws {
        // Die Antwort auf die Namensfrage ist nicht geprüft: Eine IP außerhalb des Netzes bekommt weder Code noch
        // `pairing_id`, und dorthin ginge das Token ohnehin nie (die Kopplung wäre nutzlos)
        let setup = Setup(
            [.http(status: 201, body: Fixtures.pairStartResponse)],
            resolvesTo: try XCTUnwrap(CoreEndpoint(host: "203.0.113.9", port: 4710)))

        await setup.controller.start(endpoint: localEndpoint)

        XCTAssertEqual(setup.controller.state, .idle)
        XCTAssertEqual(setup.controller.lastError, .localNameNotResolved)
        XCTAssertEqual(setup.transport.requests.count, 0)
        XCTAssertNil(setup.macs.mac)
    }

    func testIPAddressIsNotResolved() async {
        let setup = Setup([.http(status: 201, body: Fixtures.pairStartResponse)], resolvesTo: nil)

        await setup.controller.start(endpoint: Fixtures.endpoint)

        XCTAssertTrue(setup.resolver.questions.isEmpty)
        XCTAssertEqual(setup.controller.state, .awaitingCode(Fixtures.endpoint, pairingID: Fixtures.publicPairingID))
    }

    func testQRCodeWithLocalHostIsRejected() {
        // Der Mac schreibt immer eine IPv4 in den QR-Code. Ein `.local`-Name liefe über mDNS, und wer dort antwortet,
        // bekäme die geheime `pairing_id` und den Code (VERTRAEGE §12 H-5). Der QR-Weg kommt ohne Bonjour aus.
        XCTAssertNil(PairingLink(qrPayload: localQR))
        XCTAssertNil(PairingLink(qrPayload: localQR.replacingOccurrences(of: "mein-mac.local", with: "Mein-Mac.LOCAL")))
        XCTAssertNotNil(
            PairingLink(qrPayload: localQR.replacingOccurrences(of: "mein-mac.local", with: "192.0.2.10")))
    }
}
