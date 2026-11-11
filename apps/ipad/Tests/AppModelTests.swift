import XCTest

@testable import StudienGehirn

final class AppModelTests: XCTestCase {
    @MainActor
    private func makeModel(
        _ replies: [FakeTransport.Reply],
        tokens: FakeTokenStore,
        macs: FakePairedMacStore
    ) -> (AppModel, FakeTransport) {
        let transport = FakeTransport(replies)
        let model = AppModel(
            client: Fixtures.client(transport),
            tokenStore: tokens,
            macStore: macs,
            deviceName: "iPad Test",
            appVersion: "0.1.0"
        )
        return (model, transport)
    }

    @MainActor
    func testStartsUnpairedWithoutStoredData() {
        let (model, _) = makeModel([], tokens: FakeTokenStore(), macs: FakePairedMacStore())
        XCTAssertEqual(model.phase, .unpaired)
    }

    @MainActor
    func testNeedsAddressAndTokenToCountAsPaired() {
        // Der Schlüsselbund überlebt das Löschen der App, UserDefaults nicht
        let (onlyToken, _) = makeModel([], tokens: FakeTokenStore(token: Fixtures.token), macs: FakePairedMacStore())
        XCTAssertEqual(onlyToken.phase, .unpaired)

        let (onlyMac, _) = makeModel([], tokens: FakeTokenStore(), macs: FakePairedMacStore(mac: Fixtures.pairedMac))
        XCTAssertEqual(onlyMac.phase, .unpaired)

        let (both, _) = makeModel(
            [], tokens: FakeTokenStore(token: Fixtures.token), macs: FakePairedMacStore(mac: Fixtures.pairedMac))
        XCTAssertEqual(both.phase, .paired(Fixtures.pairedMac))
    }

    @MainActor
    func testConnectedWhenCoreAnswers() async {
        let (model, transport) = makeModel(
            [.http(status: 200, body: "{}")],
            tokens: FakeTokenStore(token: Fixtures.token),
            macs: FakePairedMacStore(mac: Fixtures.pairedMac)
        )

        await model.checkConnection()

        XCTAssertEqual(model.connection, .connected)
        XCTAssertEqual(transport.requests.first?.value(forHTTPHeaderField: "Authorization"), "Bearer \(Fixtures.token)")
    }

    @MainActor
    func testShowsConcreteCauseWhenDisconnected() async {
        let (model, _) = makeModel(
            [.failure(.timedOut)],
            tokens: FakeTokenStore(token: Fixtures.token),
            macs: FakePairedMacStore(mac: Fixtures.pairedMac)
        )

        await model.checkConnection()

        XCTAssertEqual(model.connection, .disconnected(.timeout))
        XCTAssertEqual(model.phase, .paired(Fixtures.pairedMac))
    }

    @MainActor
    func testRevokedTokenOffersNewPairingAndKeepsDataUntilUserDecides() async {
        let tokens = FakeTokenStore(token: Fixtures.token)
        let (model, _) = makeModel(
            [.http(status: 401, body: Fixtures.apiError("device_token_invalid"))],
            tokens: tokens,
            macs: FakePairedMacStore(mac: Fixtures.pairedMac)
        )

        await model.checkConnection()

        XCTAssertEqual(model.connection, .disconnected(.tokenInvalid))
        XCTAssertTrue(ConnectionError.tokenInvalid.needsNewPairing)
        XCTAssertEqual(model.phase, .paired(Fixtures.pairedMac))
        XCTAssertNotNil(tokens.token)
    }

    @MainActor
    func testPollingStopsAfterRevokedTokenUntilPairedAgain() async {
        let (model, transport) = makeModel(
            [
                .http(status: 401, body: Fixtures.apiError("device_token_invalid")),
                .http(status: 200, body: "{}"),
            ],
            tokens: FakeTokenStore(token: Fixtures.token),
            macs: FakePairedMacStore(mac: Fixtures.pairedMac)
        )

        await model.pollConnection()
        XCTAssertEqual(model.connection, .disconnected(.tokenInvalid))
        XCTAssertTrue(model.isPollingPaused)

        await model.pollConnection()
        await model.pollConnection()
        XCTAssertEqual(transport.requests.count, 1)

        // Neu gekoppelt: reload() setzt den Status zurück, die Abfrage läuft wieder
        model.reload()
        XCTAssertFalse(model.isPollingPaused)
        await model.pollConnection()
        XCTAssertEqual(transport.requests.count, 2)
        XCTAssertEqual(model.connection, .connected)
    }

    @MainActor
    func testPollingContinuesAfterOtherErrors() async {
        let (model, transport) = makeModel(
            [.failure(.timedOut)],
            tokens: FakeTokenStore(token: Fixtures.token),
            macs: FakePairedMacStore(mac: Fixtures.pairedMac)
        )

        await model.pollConnection()
        await model.pollConnection()

        XCTAssertFalse(model.isPollingPaused)
        XCTAssertEqual(transport.requests.count, 2)
    }

    @MainActor
    func testUnpairSignsOffAtCoreAndDeletesLocalData() async {
        let tokens = FakeTokenStore(token: Fixtures.token)
        let macs = FakePairedMacStore(mac: Fixtures.pairedMac)
        let (model, transport) = makeModel([.http(status: 204, body: "")], tokens: tokens, macs: macs)

        await model.unpair()

        XCTAssertEqual(model.phase, .unpaired)
        XCTAssertNil(tokens.token)
        XCTAssertNil(macs.mac)
        let request = transport.requests.first
        XCTAssertEqual(request?.httpMethod, "DELETE")
        XCTAssertEqual(request?.url?.path, "/api/v1/devices/\(Fixtures.deviceID)")
    }

    @MainActor
    func testUnpairDeletesLocalDataEvenWhenCoreIsUnreachable() async {
        let tokens = FakeTokenStore(token: Fixtures.token)
        let macs = FakePairedMacStore(mac: Fixtures.pairedMac)
        let (model, _) = makeModel([.failure(.cannotConnectToHost)], tokens: tokens, macs: macs)

        await model.unpair()

        XCTAssertEqual(model.phase, .unpaired)
        XCTAssertNil(tokens.token)
        XCTAssertNil(macs.mac)
    }

    @MainActor
    func testSuccessfulPairingSwitchesToPaired() async {
        let (model, _) = makeModel(
            [
                .http(status: 201, body: Fixtures.pairStartResponse),
                .http(status: 201, body: Fixtures.pairResponse),
            ],
            tokens: FakeTokenStore(),
            macs: FakePairedMacStore()
        )

        await model.pairing.start(endpoint: Fixtures.endpoint)
        await model.pairing.submit(code: "123456")

        XCTAssertEqual(model.phase, .paired(Fixtures.pairedMac))
    }
}
