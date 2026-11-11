import XCTest

@testable import StudienGehirn

final class CoreClientTests: XCTestCase {
    /// Hilfe: Fehler einer Anfrage als `ConnectionError`
    @MainActor
    private func failure(of operation: @MainActor () async throws -> Void) async -> ConnectionError? {
        do {
            try await operation()
            return nil
        } catch {
            return ConnectionError.wrap(error)
        }
    }

    // MARK: - Wiederholung bei geschlossener Keep-Alive-Verbindung (VERTRAEGE §5, H-1)

    @MainActor
    func testRetriesWhenKeepAliveConnectionWasClosed() async throws {
        let transport = FakeTransport([
            .failure(.networkConnectionLost),
            .failure(.networkConnectionLost),
            .http(status: 200, body: "{}"),
        ])
        let client = Fixtures.client(transport)

        try await client.checkHealth(endpoint: Fixtures.endpoint, token: Fixtures.token)

        XCTAssertEqual(transport.requests.count, 3)
    }

    @MainActor
    func testGivesUpAfterMaxRetries() async {
        let transport = FakeTransport([.failure(.networkConnectionLost)])
        let client = Fixtures.client(transport)

        let error = await failure {
            try await client.checkHealth(endpoint: Fixtures.endpoint, token: Fixtures.token)
        }

        XCTAssertEqual(error, .connectionLost)
        // 1 Versuch + 2 Wiederholungen
        XCTAssertEqual(transport.requests.count, 3)
    }

    @MainActor
    func testDoesNotRetryOtherErrors() async {
        let transport = FakeTransport([.failure(.timedOut)])
        let client = Fixtures.client(transport)

        let error = await failure {
            try await client.checkHealth(endpoint: Fixtures.endpoint, token: Fixtures.token)
        }

        XCTAssertEqual(error, .timeout)
        XCTAssertEqual(transport.requests.count, 1)
    }

    @MainActor
    func testRetriesPairConfirmToo() async throws {
        let transport = FakeTransport([
            .failure(.networkConnectionLost),
            .http(status: 201, body: Fixtures.pairResponse),
        ])
        let client = Fixtures.client(transport)

        let result = try await client.pairConfirm(
            endpoint: Fixtures.endpoint,
            pairingID: Fixtures.publicPairingID,
            code: "123456",
            deviceName: "iPad Test",
            nonce: PairingInput.makeNonce(),
            appVersion: "0.1.0"
        )

        XCTAssertEqual(result.deviceToken, Fixtures.token)
        XCTAssertEqual(transport.requests.count, 2)
    }

    // MARK: - Anfragen

    @MainActor
    func testHealthSendsBearerToken() async throws {
        let transport = FakeTransport([.http(status: 200, body: "{}")])
        let client = Fixtures.client(transport)

        try await client.checkHealth(endpoint: Fixtures.endpoint, token: Fixtures.token)

        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.absoluteString, "http://192.0.2.10:4710/api/v1/health")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(Fixtures.token)")
        XCTAssertNil(request.value(forHTTPHeaderField: "Origin"))
    }

    @MainActor
    func testPairStartSendsContractBodyWithoutToken() async throws {
        let transport = FakeTransport([.http(status: 201, body: Fixtures.pairStartResponse)])
        let client = Fixtures.client(transport)
        let nonce = PairingInput.makeNonce()

        let pairingID = try await client.pairStart(endpoint: Fixtures.endpoint, deviceName: "iPad Test", nonce: nonce)

        XCTAssertEqual(pairingID, Fixtures.publicPairingID)
        let request = try XCTUnwrap(transport.requests.first)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/devices/pair/start")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(request.value(forHTTPHeaderField: "Origin"))
        let body = try transport.jsonBody(at: 0)
        XCTAssertEqual(body["device_name"] as? String, "iPad Test")
        XCTAssertEqual(body["kind"] as? String, "ipad")
        XCTAssertEqual(body["public_nonce"] as? String, nonce)
        XCTAssertEqual(body.count, 3)
    }

    @MainActor
    func testPairConfirmSendsContractBodyAndReadsToken() async throws {
        let transport = FakeTransport([.http(status: 201, body: Fixtures.pairResponse)])
        let client = Fixtures.client(transport)
        let nonce = PairingInput.makeNonce()

        let result = try await client.pairConfirm(
            endpoint: Fixtures.endpoint,
            pairingID: Fixtures.publicPairingID,
            code: "123456",
            deviceName: "iPad Test",
            nonce: nonce,
            appVersion: nil
        )

        XCTAssertEqual(
            result,
            PairingResult(deviceToken: Fixtures.token, deviceID: Fixtures.deviceID, deviceName: "iPad Test"))
        let body = try transport.jsonBody(at: 0)
        XCTAssertEqual(body["pairing_id"] as? String, Fixtures.publicPairingID)
        XCTAssertEqual(body["code"] as? String, "123456")
        XCTAssertEqual(body["public_nonce"] as? String, nonce)
        // app_version ist optional und muss mindestens 1 Zeichen haben: ohne Wert weglassen
        XCTAssertNil(body["app_version"])
    }

    // MARK: - Antworten

    @MainActor
    func testMapsRevokedTokenTo401() async {
        let transport = FakeTransport([.http(status: 401, body: Fixtures.apiError("device_token_invalid"))])
        let client = Fixtures.client(transport)

        let error = await failure {
            try await client.checkHealth(endpoint: Fixtures.endpoint, token: Fixtures.token)
        }

        XCTAssertEqual(error, .tokenInvalid)
    }

    @MainActor
    func testMapsPairingErrorsByCode() async {
        let transport = FakeTransport([.http(status: 409, body: Fixtures.apiError("pairing_window_closed"))])
        let client = Fixtures.client(transport)

        let error = await failure {
            _ = try await client.pairStart(endpoint: Fixtures.endpoint, deviceName: "iPad Test", nonce: "x")
        }

        XCTAssertEqual(error, .pairing(.windowClosed))
    }

    @MainActor
    func testUnreadableSuccessBodyIsInvalidResponse() async {
        let transport = FakeTransport([.http(status: 201, body: "kein json")])
        let client = Fixtures.client(transport)

        let error = await failure {
            _ = try await client.pairStart(endpoint: Fixtures.endpoint, deviceName: "iPad Test", nonce: "x")
        }

        XCTAssertEqual(error, .invalidResponse)
    }

    @MainActor
    func testErrorWithoutJsonBodyKeepsStatus() async {
        let transport = FakeTransport([.http(status: 503, body: "")])
        let client = Fixtures.client(transport)

        let error = await failure {
            try await client.checkHealth(endpoint: Fixtures.endpoint, token: Fixtures.token)
        }

        XCTAssertEqual(error, .server(status: 503, code: nil))
    }
}
