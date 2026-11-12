import XCTest

@testable import StudienGehirn

final class CoreEndpointTests: XCTestCase {
    func testParsesAddressWithAndWithoutPort() {
        XCTAssertEqual(CoreEndpoint(userInput: "192.0.2.10")?.displayText, "192.0.2.10:4710")
        XCTAssertEqual(CoreEndpoint(userInput: " 192.0.2.10:4811 ")?.displayText, "192.0.2.10:4811")
        XCTAssertEqual(CoreEndpoint(userInput: "http://192.0.2.10:4710/api/v1/health")?.displayText, "192.0.2.10:4710")
        XCTAssertEqual(CoreEndpoint(userInput: "Mein-Mac.local")?.host, "mein-mac.local")
    }

    func testRejectsHostsTheCoreWouldRefuse() {
        // VERTRAEGE §5: aus dem Netz nur IP-Adressen und <name>.local
        XCTAssertNil(CoreEndpoint(userInput: "example.com"))
        XCTAssertNil(CoreEndpoint(userInput: "localhost"))
        XCTAssertNil(CoreEndpoint(userInput: "192.0.2.300"))
        XCTAssertNil(CoreEndpoint(userInput: "192.0.2"))
        XCTAssertNil(CoreEndpoint(userInput: "192.0.2.10:0"))
        XCTAssertNil(CoreEndpoint(userInput: "192.0.2.10:99999"))
        XCTAssertNil(CoreEndpoint(userInput: "192.0.2.10:abc"))
        XCTAssertNil(CoreEndpoint(userInput: ".local"))
        XCTAssertNil(CoreEndpoint(userInput: ""))
    }

    func testRejectsIPv4WithLeadingZeros() {
        // N-1 aus dem Review von #192: `010.0.0.1` sähe privat aus, könnte aber oktal gelesen werden
        XCTAssertNil(CoreEndpoint(userInput: "010.0.0.1"))
        XCTAssertNil(CoreEndpoint(userInput: "10.00.0.1"))
        XCTAssertNil(CoreEndpoint(userInput: "192.168.1.020:4710"))
        XCTAssertNil(CoreEndpoint(userInput: "http://0127.0.0.1:4710/api/v1/health"))
        XCTAssertNil(CoreEndpoint(host: "192.168.01.20"))
        XCTAssertNil(CoreEndpoint(host: "00.0.0.0"))
        // Die Null selbst bleibt ein gültiges Oktett
        XCTAssertEqual(CoreEndpoint(userInput: "10.0.0.1")?.host, "10.0.0.1")
        XCTAssertEqual(CoreEndpoint(userInput: "192.168.0.100")?.host, "192.168.0.100")
    }

    func testQrLinkWithLeadingZeroHostIsRejected() {
        XCTAssertNil(
            PairingLink(
                qrPayload: "sg://pair?v=1&host=010.0.0.1&port=4710&pairing_id=\(Fixtures.qrPairingID)&code=654321"))
    }

    func testBuildsApiUrl() {
        let url = Fixtures.endpoint.url(path: "/devices/pair/start")
        XCTAssertEqual(url?.absoluteString, "http://192.0.2.10:4710/api/v1/devices/pair/start")
    }
}

final class PairingLinkTests: XCTestCase {
    func testParsesQrPayload() {
        let payload = "sg://pair?v=1&host=192.0.2.10&port=4710&pairing_id=019A4E14-0000-4000-8000-0000000000C1&code=123456"
        let link = PairingLink(qrPayload: payload)
        XCTAssertEqual(link?.endpoint, Fixtures.endpoint)
        // UUIDs immer klein (VERTRAEGE §11.7)
        XCTAssertEqual(link?.pairingID, Fixtures.qrPairingID)
        XCTAssertEqual(link?.code, "123456")
    }

    func testRejectsForeignOrBrokenPayloads() {
        XCTAssertNil(PairingLink(qrPayload: "https://example.com/?code=123456"))
        XCTAssertNil(PairingLink(qrPayload: "sg://pair?v=2&host=192.0.2.10&port=4710&pairing_id=\(Fixtures.qrPairingID)&code=123456"))
        XCTAssertNil(PairingLink(qrPayload: "sg://pair?v=1&host=example.com&port=4710&pairing_id=\(Fixtures.qrPairingID)&code=123456"))
        XCTAssertNil(PairingLink(qrPayload: "sg://pair?v=1&host=192.0.2.10&port=4710&pairing_id=keine-uuid&code=123456"))
        XCTAssertNil(PairingLink(qrPayload: "sg://pair?v=1&host=192.0.2.10&port=4710&pairing_id=\(Fixtures.qrPairingID)&code=12345"))
        XCTAssertNil(PairingLink(qrPayload: "sg://pair?v=1&host=192.0.2.10&pairing_id=\(Fixtures.qrPairingID)&code=123456"))
    }

    func testNormalizesCode() {
        XCTAssertEqual(PairingInput.normalizedCode("123 456"), "123456")
        XCTAssertNil(PairingInput.normalizedCode("12345"))
        XCTAssertNil(PairingInput.normalizedCode("1234567"))
        XCTAssertNil(PairingInput.normalizedCode("12a456"))
        // Keine Ziffern anderer Schriften: Der Core verlangt ^[0-9]{6}$
        XCTAssertNil(PairingInput.normalizedCode("١٢٣٤٥٦"))
    }

    func testNonceMatchesSchema() {
        // PairStartRequest.public_nonce: ^[A-Za-z0-9_-]{22,128}$
        let nonce = PairingInput.makeNonce()
        XCTAssertEqual(nonce.count, 43)
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")
        XCTAssertTrue(nonce.unicodeScalars.allSatisfy { allowed.contains($0) })
        XCTAssertNotEqual(nonce, PairingInput.makeNonce())
    }

    func testDeviceNameStaysWithinSchema() {
        XCTAssertEqual(PairingInput.deviceName("  "), "iPad")
        XCTAssertEqual(PairingInput.deviceName(String(repeating: "a", count: 80)).count, 64)
    }
}

final class ConnectionErrorTests: XCTestCase {
    func testMapsSystemErrorsToConcreteCauses() {
        XCTAssertEqual(ConnectionError.from(URLError(.appTransportSecurityRequiresSecureConnection)), .insecureConnectionBlocked)
        XCTAssertEqual(ConnectionError.from(URLError(.timedOut)), .timeout)
        XCTAssertEqual(ConnectionError.from(URLError(.cannotConnectToHost)), .coreNotFound)
        XCTAssertEqual(ConnectionError.from(URLError(.cannotFindHost)), .coreNotFound)
        XCTAssertEqual(ConnectionError.from(URLError(.notConnectedToInternet)), .offline)
        XCTAssertEqual(ConnectionError.from(URLError(.networkConnectionLost)), .connectionLost)
        XCTAssertEqual(ConnectionError.from(URLError(.badURL)), .network(code: URLError.Code.badURL.rawValue))
    }

    func testRecognizesDeniedLocalNetworkPermission() {
        let error = URLError(
            .notConnectedToInternet,
            userInfo: ["_NSURLErrorNWPathKey": "unsatisfied (Local network prohibited), interface: en0"]
        )
        XCTAssertEqual(ConnectionError.from(error), .localNetworkDenied)
    }

    func testMapsCoreAnswers() {
        XCTAssertEqual(ConnectionError.from(status: 401, code: "device_token_invalid"), .tokenInvalid)
        XCTAssertEqual(ConnectionError.from(status: 401, code: "device_token_required"), .tokenInvalid)
        XCTAssertEqual(ConnectionError.from(status: 421, code: "host_not_allowed"), .hostNotAllowed)
        XCTAssertEqual(ConnectionError.from(status: 403, code: "pairing_code_invalid"), .pairing(.codeInvalid))
        XCTAssertEqual(ConnectionError.from(status: 409, code: "pairing_window_closed"), .pairing(.windowClosed))
        XCTAssertEqual(ConnectionError.from(status: 423, code: "pairing_locked"), .pairing(.locked))
        XCTAssertEqual(ConnectionError.from(status: 429, code: "pairing_rate_limited"), .pairing(.rateLimited))
        XCTAssertEqual(ConnectionError.from(status: 429, code: "pairing_requests_full"), .pairing(.requestsFull))
        XCTAssertEqual(ConnectionError.from(status: 403, code: "pairing_request_rejected"), .pairing(.requestRejected))
        XCTAssertEqual(ConnectionError.from(status: 500, code: nil), .server(status: 500, code: nil))
    }

    func testOnlyRevokedTokenAsksForNewPairing() {
        XCTAssertTrue(ConnectionError.tokenInvalid.needsNewPairing)
        XCTAssertFalse(ConnectionError.timeout.needsNewPairing)
        XCTAssertFalse(ConnectionError.offline.needsNewPairing)
    }

    func testEveryCauseHasTexts() {
        let causes: [ConnectionError] = [
            .insecureConnectionBlocked, .localNetworkDenied, .offline, .timeout, .coreNotFound, .connectionLost,
            .pairingOutcomeUnknown,
            .tokenInvalid, .hostNotAllowed, .pairing(.windowClosed), .pairing(.locked), .pairing(.rateLimited),
            .pairing(.requestsFull), .pairing(.codeInvalid), .pairing(.requestRejected),
            .server(status: 500, code: "x"), .server(status: 500, code: nil), .invalidResponse, .invalidAddress,
            .invalidPairingLink, .invalidCodeFormat, .discoveryFailed, .macNotResolved, .tokenStorageFailed,
            .network(code: -1), .appOutdated, .otherNetwork, .rePairingNeeded, .localNameNotResolved,
        ]
        for cause in causes {
            XCTAssertFalse(cause.title.isEmpty)
            XCTAssertFalse(cause.advice.isEmpty)
            // Ton laut 07-UX §7: keine Ausrufezeichen
            XCTAssertFalse(cause.title.contains("!"))
            XCTAssertFalse(cause.advice.contains("!"))
        }
    }
}
