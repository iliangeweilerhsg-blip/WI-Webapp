import XCTest

@testable import StudienGehirn

/// Zustandsautomat der Kopplung (VERTRAEGE §12)
final class PairingControllerTests: XCTestCase {
    @MainActor
    private struct Setup {
        let transport: FakeTransport
        let tokens: FakeTokenStore
        let macs: FakePairedMacStore
        let controller: PairingController

        init(_ replies: [FakeTransport.Reply]) {
            let transport = FakeTransport(replies)
            let tokens = FakeTokenStore()
            let macs = FakePairedMacStore()
            self.transport = transport
            self.tokens = tokens
            self.macs = macs
            controller = PairingController(
                client: Fixtures.client(transport),
                tokenStore: tokens,
                macStore: macs,
                deviceName: "iPad Test",
                appVersion: "0.1.0"
            )
        }
    }

    // MARK: - Weg über pair/start (Bonjour oder Adresse von Hand)

    @MainActor
    func testStartThenCodeStoresTokenInTokenStoreOnly() async throws {
        let setup = Setup([
            .http(status: 201, body: Fixtures.pairStartResponse),
            .http(status: 201, body: Fixtures.pairResponse),
        ])
        var pairedCalls = 0
        setup.controller.onPaired = { pairedCalls += 1 }

        await setup.controller.start(endpoint: Fixtures.endpoint)
        XCTAssertEqual(setup.controller.state, .awaitingCode(Fixtures.endpoint, pairingID: Fixtures.publicPairingID))

        await setup.controller.submit(code: "123 456")

        XCTAssertEqual(setup.controller.state, .paired)
        XCTAssertNil(setup.controller.lastError)
        XCTAssertEqual(pairedCalls, 1)
        XCTAssertEqual(setup.tokens.token, Fixtures.token)
        // Der gekoppelte Mac enthält kein Geheimnis
        XCTAssertEqual(setup.macs.mac, Fixtures.pairedMac)

        // confirm nutzt die pairing_id und die Nonce aus pair/start
        let startBody = try setup.transport.jsonBody(at: 0)
        let confirmBody = try setup.transport.jsonBody(at: 1)
        XCTAssertEqual(confirmBody["pairing_id"] as? String, Fixtures.publicPairingID)
        XCTAssertEqual(confirmBody["code"] as? String, "123456")
        XCTAssertEqual(confirmBody["public_nonce"] as? String, startBody["public_nonce"] as? String)
        XCTAssertEqual(confirmBody["app_version"] as? String, "0.1.0")
    }

    @MainActor
    func testClosedWindowKeepsIdleWithCause() async {
        let setup = Setup([.http(status: 409, body: Fixtures.apiError("pairing_window_closed"))])

        await setup.controller.start(endpoint: Fixtures.endpoint)

        XCTAssertEqual(setup.controller.state, .idle)
        XCTAssertEqual(setup.controller.lastError, .pairing(.windowClosed))
    }

    @MainActor
    func testUnreachableMacKeepsIdleWithCause() async {
        let setup = Setup([.failure(.cannotConnectToHost)])

        await setup.controller.start(endpoint: Fixtures.endpoint)

        XCTAssertEqual(setup.controller.state, .idle)
        XCTAssertEqual(setup.controller.lastError, .coreNotFound)
    }

    @MainActor
    func testMalformedCodeIsNotSent() async {
        let setup = Setup([.http(status: 201, body: Fixtures.pairStartResponse)])
        await setup.controller.start(endpoint: Fixtures.endpoint)

        await setup.controller.submit(code: "12345")

        XCTAssertEqual(setup.controller.lastError, .invalidCodeFormat)
        XCTAssertEqual(setup.controller.state, .awaitingCode(Fixtures.endpoint, pairingID: Fixtures.publicPairingID))
        XCTAssertEqual(setup.transport.requests.count, 1)
    }

    @MainActor
    func testWrongCodeAllowsAnotherTry() async {
        let setup = Setup([
            .http(status: 201, body: Fixtures.pairStartResponse),
            .http(status: 403, body: Fixtures.apiError("pairing_code_invalid")),
            .http(status: 201, body: Fixtures.pairResponse),
        ])
        await setup.controller.start(endpoint: Fixtures.endpoint)

        await setup.controller.submit(code: "000000")
        XCTAssertEqual(setup.controller.lastError, .pairing(.codeInvalid))
        XCTAssertEqual(setup.controller.state, .awaitingCode(Fixtures.endpoint, pairingID: Fixtures.publicPairingID))
        XCTAssertNil(setup.tokens.token)

        await setup.controller.submit(code: "123456")
        XCTAssertEqual(setup.controller.state, .paired)
        XCTAssertNil(setup.controller.lastError)
    }

    @MainActor
    func testFiveWrongCodesRequireNewRequest() async {
        // Nach 5 falschen Codes weist der Core die Nonce ab (§12, Schritt 4)
        let setup = Setup([
            .http(status: 201, body: Fixtures.pairStartResponse),
            .http(status: 403, body: Fixtures.apiError("pairing_code_invalid")),
        ])
        await setup.controller.start(endpoint: Fixtures.endpoint)

        for _ in 0..<4 {
            await setup.controller.submit(code: "000000")
        }
        XCTAssertEqual(setup.controller.state, .awaitingCode(Fixtures.endpoint, pairingID: Fixtures.publicPairingID))

        await setup.controller.submit(code: "000000")
        XCTAssertEqual(setup.controller.state, .idle)
        XCTAssertEqual(setup.controller.lastError, .pairing(.codeInvalid))
    }

    @MainActor
    func testWindowClosedDuringConfirmGoesBackToStart() async {
        let setup = Setup([
            .http(status: 201, body: Fixtures.pairStartResponse),
            .http(status: 409, body: Fixtures.apiError("pairing_window_closed")),
        ])
        await setup.controller.start(endpoint: Fixtures.endpoint)

        await setup.controller.submit(code: "123456")

        XCTAssertEqual(setup.controller.state, .idle)
        XCTAssertEqual(setup.controller.lastError, .pairing(.windowClosed))
    }

    @MainActor
    func testNetworkErrorDuringConfirmKeepsCodeEntry() async {
        let setup = Setup([
            .http(status: 201, body: Fixtures.pairStartResponse),
            .failure(.timedOut),
        ])
        await setup.controller.start(endpoint: Fixtures.endpoint)

        await setup.controller.submit(code: "123456")

        XCTAssertEqual(setup.controller.state, .awaitingCode(Fixtures.endpoint, pairingID: Fixtures.publicPairingID))
        XCTAssertEqual(setup.controller.lastError, .timeout)
    }

    @MainActor
    func testCancelReturnsToStart() async {
        let setup = Setup([.http(status: 201, body: Fixtures.pairStartResponse)])
        await setup.controller.start(endpoint: Fixtures.endpoint)

        setup.controller.cancel()

        XCTAssertEqual(setup.controller.state, .idle)
        XCTAssertNil(setup.controller.lastError)
    }

    @MainActor
    func testNewAttemptUsesNewNonce() async throws {
        let setup = Setup([.http(status: 201, body: Fixtures.pairStartResponse)])

        await setup.controller.start(endpoint: Fixtures.endpoint)
        setup.controller.cancel()
        await setup.controller.start(endpoint: Fixtures.endpoint)

        let first = try setup.transport.jsonBody(at: 0)["public_nonce"] as? String
        let second = try setup.transport.jsonBody(at: 1)["public_nonce"] as? String
        XCTAssertNotNil(first)
        XCTAssertNotEqual(first, second)
    }

    // MARK: - QR-Weg

    @MainActor
    func testQrLinkPairsWithoutPairStart() async throws {
        let setup = Setup([.http(status: 201, body: Fixtures.pairResponse)])
        let payload = "sg://pair?v=1&host=192.0.2.10&port=4710&pairing_id=\(Fixtures.qrPairingID)&code=654321"
        let link = try XCTUnwrap(PairingLink(qrPayload: payload))

        await setup.controller.pair(with: link)

        XCTAssertEqual(setup.controller.state, .paired)
        XCTAssertEqual(setup.tokens.token, Fixtures.token)
        XCTAssertEqual(setup.transport.requests.count, 1)
        XCTAssertEqual(setup.transport.requests.first?.url?.path, "/api/v1/devices/pair/confirm")
        let body = try setup.transport.jsonBody(at: 0)
        XCTAssertEqual(body["pairing_id"] as? String, Fixtures.qrPairingID)
        XCTAssertEqual(body["code"] as? String, "654321")
    }

    @MainActor
    func testQrFailureReturnsToStart() async throws {
        let setup = Setup([.http(status: 403, body: Fixtures.apiError("pairing_code_invalid"))])
        let payload = "sg://pair?v=1&host=192.0.2.10&port=4710&pairing_id=\(Fixtures.qrPairingID)&code=654321"
        let link = try XCTUnwrap(PairingLink(qrPayload: payload))

        await setup.controller.pair(with: link)

        XCTAssertEqual(setup.controller.state, .idle)
        XCTAssertEqual(setup.controller.lastError, .pairing(.codeInvalid))
    }

    // MARK: - Schlüsselbund

    @MainActor
    func testKeychainFailureIsReportedAndNothingIsStored() async {
        let setup = Setup([
            .http(status: 201, body: Fixtures.pairStartResponse),
            .http(status: 201, body: Fixtures.pairResponse),
        ])
        setup.tokens.failsOnSave = true
        await setup.controller.start(endpoint: Fixtures.endpoint)

        await setup.controller.submit(code: "123456")

        XCTAssertEqual(setup.controller.state, .idle)
        XCTAssertEqual(setup.controller.lastError, .tokenStorageFailed)
        XCTAssertNil(setup.tokens.token)
        XCTAssertNil(setup.macs.mac)
    }
}
