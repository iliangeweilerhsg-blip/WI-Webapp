import Security
import XCTest

@testable import StudienGehirn

/// Kopplung und Tunnel-Schlüssel (UX-12, PR 4; Plan §5.3): Die Kopplung nimmt `tunnel_key` aus `PairResponse` entgegen und
/// legt ihn im Schlüsselbund ab, nie anderswo. Das Entkoppeln löscht ihn mit dem Token.
///
/// Keine schlüsselähnlichen Literale: Der Schlüssel entsteht zur Laufzeit aus Rohbytes.
@MainActor
final class TunnelKeyPairingTests: XCTestCase {
    @MainActor
    private struct Setup {
        let transport: FakeTransport
        let tokens: FakeTokenStore
        let keys: FakeTunnelKeyStore
        let macs: FakePairedMacStore
        let controller: PairingController

        init(keyInResponse: String?, existingKey: String? = nil, failsSavingKey: Bool = false) {
            var body = Fixtures.pairResponse
            if let keyInResponse {
                body = body.replacingOccurrences(
                    of: "\"device_token\":\"\(Fixtures.token)\"",
                    with: "\"device_token\":\"\(Fixtures.token)\",\"tunnel_key\":\"\(keyInResponse)\"")
            }
            let transport = FakeTransport([
                .http(status: 201, body: Fixtures.pairStartResponse),
                .http(status: 201, body: body),
            ])
            let tokens = FakeTokenStore()
            let keys = FakeTunnelKeyStore(key: existingKey)
            keys.failsOnSave = failsSavingKey
            let macs = FakePairedMacStore()
            self.transport = transport
            self.tokens = tokens
            self.keys = keys
            self.macs = macs
            controller = PairingController(
                client: Fixtures.client(transport),
                tokenStore: tokens,
                macStore: macs,
                deviceName: "iPad Test",
                appVersion: "0.1.0",
                tunnelKeyStore: keys
            )
        }

        func pair() async {
            await controller.start(endpoint: Fixtures.endpoint)
            await controller.submit(code: "123456")
        }
    }

    func testPairingStoresTheTunnelKeyNextToTheToken() async {
        let key = TunnelTestKeys.text(5)
        let setup = Setup(keyInResponse: key)

        await setup.pair()

        XCTAssertEqual(setup.controller.state, .paired)
        XCTAssertEqual(setup.tokens.token, Fixtures.token)
        XCTAssertEqual(setup.keys.key, key)
        XCTAssertEqual(setup.keys.saveCount, 1)
        // Der gekoppelte Mac in UserDefaults enthält weder Token noch Schlüssel
        XCTAssertEqual(setup.macs.mac, Fixtures.pairedMac)
    }

    func testANewPairingOverwritesTheOldKey() async {
        let old = TunnelTestKeys.text(1)
        let fresh = TunnelTestKeys.text(2)
        let setup = Setup(keyInResponse: fresh, existingKey: old)

        await setup.pair()

        XCTAssertEqual(setup.keys.key, fresh)
    }

    func testCoreWithoutTunnelLeavesNoOldKeyBehind() async {
        // Fehlt `tunnel_key` (Core vor UX-12 oder `SG_TUNNEL=0`), darf kein Schlüssel einer früheren Kopplung stehen
        // bleiben: Er gehörte zu einem anderen Token. Das iPad zeigt danach „Bitte einmal neu koppeln“.
        let setup = Setup(keyInResponse: nil, existingKey: TunnelTestKeys.text(9))

        await setup.pair()

        XCTAssertEqual(setup.controller.state, .paired)
        XCTAssertNil(setup.keys.key)
        XCTAssertEqual(setup.tokens.token, Fixtures.token)
    }

    func testKeyWithWrongFormatIsNeverStored() async {
        for bad in ["", "abc", TunnelTestKeys.text() + "x", String(TunnelTestKeys.text().dropLast())] {
            let setup = Setup(keyInResponse: bad, existingKey: TunnelTestKeys.text(9))

            await setup.pair()

            XCTAssertNil(setup.keys.key, bad)
            XCTAssertEqual(setup.keys.saveCount, 0, bad)
        }
    }

    func testFailingToStoreTheKeyUndoesThePairing() async {
        let setup = Setup(keyInResponse: TunnelTestKeys.text(5), failsSavingKey: true)

        await setup.pair()

        // Halb gekoppelt wäre schlimmer als gar nicht: Das Token wird wieder gelöscht
        XCTAssertEqual(setup.controller.state, .idle)
        XCTAssertEqual(setup.controller.lastError, .tokenStorageFailed)
        XCTAssertNil(setup.tokens.token)
        XCTAssertNil(setup.macs.mac)
    }

    func testPairResponseWithoutKeyStillDecodes() async throws {
        // Das Feld ist im Schema optional: ältere Cores senden es nicht
        let transport = FakeTransport([.http(status: 201, body: Fixtures.pairResponse)])
        let client = Fixtures.client(transport)
        let result = try await client.pairConfirm(
            endpoint: Fixtures.endpoint, pairingID: Fixtures.qrPairingID, code: "123456", deviceName: "iPad Test",
            nonce: "n", appVersion: nil)
        XCTAssertNil(result.tunnelKey)
    }

    func testPairResponseWithKeyIsPassedOn() async throws {
        let key = TunnelTestKeys.text(3)
        let body = Fixtures.pairResponse.replacingOccurrences(
            of: "\"device_token\":\"\(Fixtures.token)\"",
            with: "\"device_token\":\"\(Fixtures.token)\",\"tunnel_key\":\"\(key)\"")
        let transport = FakeTransport([.http(status: 201, body: body)])
        let client = Fixtures.client(transport)
        let result = try await client.pairConfirm(
            endpoint: Fixtures.endpoint, pairingID: Fixtures.qrPairingID, code: "123456", deviceName: "iPad Test",
            nonce: "n", appVersion: nil)
        XCTAssertEqual(result.tunnelKey, key)
    }

    func testTunnelKeyLivesInTheKeychainWithTheSameAccessAsTheToken() {
        // `…ThisDeviceOnly`: nicht in iPad-Backups, nicht im iCloud-Schlüsselbund (Plan B20)
        XCTAssertEqual(
            KeychainItem.accessibility as String, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        // Eigener Eintrag, nie derselbe wie das Token
        let token = KeychainTokenStore()
        let key = KeychainTunnelKeyStore()
        XCTAssertNotEqual(token.account, key.account)
        XCTAssertEqual(token.service, key.service)
        XCTAssertEqual(key.account, "tunnel-key")
    }

    func testNewConnectionErrorsHaveQuietTexts() {
        let causes: [ConnectionError] = [.tunnelKeyMissing, .tunnelMacNotFound, .wifiSwitchedOff, .tunnelHandshakeFailed]
        for cause in causes {
            XCTAssertFalse(cause.title.isEmpty)
            XCTAssertFalse(cause.advice.isEmpty)
            XCTAssertFalse(cause.title.contains("!"))
            XCTAssertFalse(cause.advice.contains("!"))
            XCTAssertTrue(cause.isCalm)
        }
    }
}
