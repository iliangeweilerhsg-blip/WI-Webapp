import XCTest

@testable import StudienGehirn

/// Wegewahl zum Mac (UX-12, PR 4; Plan E5, §5.3): erst WLAN, dann peer-to-peer, den letzten Erfolg zuerst, Zurücksetzen
/// nur bei Netzwechsel und Vordergrund, kein Flattern der Anzeige. Alles mit Fakes, ohne Netz.
@MainActor
final class MacRouteSelectionTests: XCTestCase {
    @MainActor
    private struct Setup {
        let route: MacRoute
        let forwarder: FakeForwarder
        let paths: FakePaths
        let keys: FakeTunnelKeyStore
        let dialer: FakeDialer
        let clock: VirtualClock
    }

    private func makeSetup(
        key: String? = TunnelTestKeys.text(),
        dialer: FakeDialer,
        paired: Bool = true
    ) -> Setup {
        let forwarder = FakeForwarder()
        let paths = FakePaths()
        let keys = FakeTunnelKeyStore(key: key)
        let clock = VirtualClock()
        let route = MacRoute(keys: keys, dialer: dialer, paths: paths, forwarder: forwarder, now: { clock.date })
        if paired { route.setPaired(true) }
        return Setup(route: route, forwarder: forwarder, paths: paths, keys: keys, dialer: dialer, clock: clock)
    }

    /// WLAN geht nicht, peer-to-peer gelingt (der Hörsaal)
    private static func lectureHall() -> FakeDialer {
        FakeDialer { peerToPeer, _ in
            peerToPeer ? .connected(FakeStream(), .direct) : .failed(.notFound)
        }
    }

    /// WLAN gelingt (zu Hause)
    private static func home() -> FakeDialer {
        FakeDialer { peerToPeer, _ in
            peerToPeer ? .connected(FakeStream(), .direct) : .connected(FakeStream(), .wifi)
        }
    }

    // MARK: Stufen

    func testSharedWifiWorksAndPeerToPeerIsNeverTried() async {
        let s = makeSetup(dialer: Self.home())

        let channel = await s.forwarder.acceptConnection()

        XCTAssertNotNil(channel)
        XCTAssertEqual(s.dialer.calls.map(\.peerToPeer), [false])
        XCTAssertEqual(s.dialer.calls.first?.timeout, MacRoute.wifiSeconds)
        XCTAssertEqual(s.route.state, .up(.sharedWifi))
        XCTAssertEqual(s.route.rememberedStage, .sharedWifi)
    }

    func testPeerToPeerIsTheFallbackWhenWifiFails() async {
        let s = makeSetup(dialer: Self.lectureHall())

        let channel = await s.forwarder.acceptConnection()

        XCTAssertNotNil(channel)
        XCTAssertEqual(s.dialer.calls.map(\.peerToPeer), [false, true])
        XCTAssertEqual(s.dialer.calls.map(\.timeout), [2, 10])
        XCTAssertEqual(s.route.state, .up(.direct))
        XCTAssertEqual(s.route.rememberedStage, .direct)
    }

    func testLastSuccessfulWayIsTriedFirst() async {
        let s = makeSetup(dialer: Self.lectureHall())
        _ = await s.forwarder.acceptConnection()
        XCTAssertEqual(s.dialer.wifiAttempts, 1)

        // Zehn weitere Verbindungen im Hörsaal: kein weiterer WLAN-Versuch, nur noch peer-to-peer
        for _ in 0..<10 {
            let channel = await s.forwarder.acceptConnection()
            XCTAssertNotNil(channel)
        }

        XCTAssertEqual(s.dialer.wifiAttempts, 1)
        XCTAssertEqual(s.dialer.directAttempts, 11)
        XCTAssertEqual(s.route.state, .up(.direct))
    }

    func testRememberedDirectWayFallsBackToWifiWhenItFails() async {
        let dialer = FakeDialer { peerToPeer, index in
            // Erste Verbindung: WLAN geht nicht, direkt gelingt. Danach geht direkt nicht mehr, WLAN schon.
            if index < 2 { return peerToPeer ? .connected(FakeStream(), .direct) : .failed(.notFound) }
            return peerToPeer ? .failed(.notFound) : .connected(FakeStream(), .wifi)
        }
        let s = makeSetup(dialer: dialer)
        _ = await s.forwarder.acceptConnection()
        XCTAssertEqual(s.route.rememberedStage, .direct)

        let channel = await s.forwarder.acceptConnection()

        XCTAssertNotNil(channel)
        XCTAssertEqual(s.dialer.calls.map(\.peerToPeer), [false, true, true, false])
        XCTAssertEqual(s.route.rememberedStage, .sharedWifi)
        XCTAssertEqual(s.route.state, .up(.sharedWifi))
    }

    // MARK: Zurücksetzen

    func testNetworkChangeResetsTheMemoryToWifiFirst() async {
        let s = makeSetup(dialer: Self.lectureHall())
        _ = await s.forwarder.acceptConnection()
        XCTAssertEqual(s.route.rememberedStage, .direct)

        s.paths.simulateChange()
        XCTAssertNil(s.route.rememberedStage)
        _ = await s.forwarder.acceptConnection()

        // WLAN wieder zuerst: 1 (erste Verbindung) + 1 (nach dem Wechsel)
        XCTAssertEqual(s.dialer.wifiAttempts, 2)
    }

    func testForegroundResetsTheMemoryToWifiFirst() async {
        let s = makeSetup(dialer: Self.lectureHall())
        _ = await s.forwarder.acceptConnection()
        XCTAssertEqual(s.route.rememberedStage, .direct)

        s.route.appWentToBackground()
        s.route.appBecameActive()
        XCTAssertNil(s.route.rememberedStage)
        _ = await s.forwarder.acceptConnection()

        XCTAssertEqual(s.dialer.wifiAttempts, 2)
    }

    func testNothingElseResetsTheMemory() async {
        let s = makeSetup(dialer: Self.lectureHall())
        _ = await s.forwarder.acceptConnection()

        // Zeit allein ändert nichts: kein Zeitgeber
        await s.clock.advance(3600)
        _ = await s.forwarder.acceptConnection()

        XCTAssertEqual(s.route.rememberedStage, .direct)
        XCTAssertEqual(s.dialer.wifiAttempts, 1)
    }

    // MARK: Kein Flattern

    func testDisplayDoesNotChangeWhenTheNetworkPathFlapsTenTimes() async {
        let s = makeSetup(dialer: Self.lectureHall())
        _ = await s.forwarder.acceptConnection()
        XCTAssertEqual(s.route.state, .up(.direct))
        var changes = 0
        s.route.onChange = { changes += 1 }

        for _ in 0..<10 { s.paths.simulateChange() }

        XCTAssertEqual(s.route.state, .up(.direct))
        XCTAssertEqual(changes, 0)
    }

    func testExistingConnectionsAreNotTouchedByANetworkChange() async throws {
        let s = makeSetup(dialer: Self.lectureHall())
        let first = await s.forwarder.acceptConnection()
        let stream = try XCTUnwrap(first as? FakeStream)

        s.paths.simulateChange()
        s.paths.simulateChange()

        XCTAssertFalse(stream.isClosed)
    }

    // MARK: Gemeinsame Suche

    func testConcurrentConnectionsShareOneWifiAttemptWhileTheWayIsUnknown() async {
        let s = makeSetup(dialer: FakeDialer())
        let forwarder = s.forwarder
        let tasks = (0..<3).map { _ in
            _Concurrency.Task { await forwarder.acceptConnection() }
        }
        // Nur ein Suchlauf, die beiden anderen warten
        var parked = await waitUntil { s.dialer.pendingCount == 1 }
        XCTAssertTrue(parked)
        await s.clock.settle()
        XCTAssertEqual(s.dialer.calls.count, 1)

        s.dialer.resolveNext(.failed(.notFound))  // WLAN scheitert
        parked = await waitUntil { s.dialer.calls.count == 2 && s.dialer.pendingCount == 1 }
        XCTAssertTrue(parked)
        s.dialer.resolveNext(.connected(FakeStream(), .direct))

        // Die beiden wartenden Verbindungen nutzen den gemerkten Weg und versuchen kein WLAN mehr
        parked = await waitUntil { s.dialer.pendingCount == 2 }
        XCTAssertTrue(parked)
        s.dialer.resolveNext(.connected(FakeStream(), .direct))
        s.dialer.resolveNext(.connected(FakeStream(), .direct))
        for task in tasks {
            let channel = await task.value
            XCTAssertNotNil(channel)
        }
        XCTAssertEqual(s.dialer.wifiAttempts, 1)
        XCTAssertEqual(s.dialer.directAttempts, 3)
    }

    func testWaitingConnectionsShareTheFailureOfAFreshSearch() async {
        let s = makeSetup(dialer: FakeDialer())
        let forwarder = s.forwarder
        let tasks = (0..<3).map { _ in
            _Concurrency.Task { await forwarder.acceptConnection() }
        }
        var parked = await waitUntil { s.dialer.pendingCount == 1 }
        XCTAssertTrue(parked)

        s.dialer.resolveNext(.failed(.notFound))
        parked = await waitUntil { s.dialer.calls.count == 2 && s.dialer.pendingCount == 1 }
        XCTAssertTrue(parked)
        s.dialer.resolveNext(.failed(.notFound))
        for task in tasks {
            let channel = await task.value
            XCTAssertNil(channel)
        }

        // Ein Suchlauf (WLAN und direkt), nicht drei
        XCTAssertEqual(s.dialer.calls.count, 2)
    }

    // MARK: Fehlender Schlüssel

    func testMissingKeyMeansRepairNeededAndNoTraffic() async {
        let s = makeSetup(key: nil, dialer: Self.home())

        XCTAssertEqual(s.route.state, .down(.repairNeeded))
        XCTAssertNil(s.route.endpoint())
        XCTAssertEqual(s.forwarder.startCount, 0)
        XCTAssertEqual(s.paths.startCount, 0)
        let channel = await s.route.openChannel()
        XCTAssertNil(channel)
        XCTAssertEqual(s.dialer.calls.count, 0)
        XCTAssertEqual(s.route.blockedError(), .tunnelKeyMissing)
    }

    func testKeyWithWrongFormatCountsAsMissing() {
        for bad in ["", "abc", TunnelTestKeys.text() + "x", String(TunnelTestKeys.text().dropLast())] {
            let s = makeSetup(key: bad, dialer: Self.home())
            XCTAssertEqual(s.route.state, .down(.repairNeeded), bad)
            XCTAssertEqual(s.forwarder.startCount, 0, bad)
        }
    }

    func testPairingAgainWithAKeyLeavesRepairNeeded() async {
        let s = makeSetup(key: nil, dialer: Self.home())
        XCTAssertEqual(s.route.state, .down(.repairNeeded))

        s.keys.key = TunnelTestKeys.text(7)
        s.route.setPaired(true)

        XCTAssertEqual(s.route.state, .connecting)
        XCTAssertEqual(s.forwarder.startCount, 1)
        XCTAssertNotNil(s.route.endpoint())
    }

    func testUnpairedRouteIsIdleAndSilent() {
        let s = makeSetup(dialer: Self.home(), paired: false)
        XCTAssertEqual(s.route.state, .idle)
        XCTAssertNil(s.route.endpoint())
        XCTAssertEqual(s.forwarder.startCount, 0)

        s.route.setPaired(true)
        s.route.setPaired(false)
        XCTAssertEqual(s.route.state, .idle)
        XCTAssertNil(s.route.endpoint())
        XCTAssertFalse(s.forwarder.isRunning)
    }

    // MARK: Hintergrund

    func testBackgroundStopsTheForwarderAndForegroundStartsItOnANewPort() async {
        let s = makeSetup(dialer: Self.home())
        let firstPort = s.route.endpoint()?.port
        XCTAssertNotNil(firstPort)
        var changes = 0
        s.route.onChange = { changes += 1 }

        s.route.appWentToBackground()
        XCTAssertEqual(s.route.state, .idle)
        XCTAssertNil(s.route.endpoint())
        XCTAssertFalse(s.forwarder.isRunning)

        s.route.appBecameActive()
        XCTAssertEqual(s.route.state, .connecting)
        XCTAssertNotNil(s.route.endpoint())
        XCTAssertNotEqual(s.route.endpoint()?.port, firstPort)
        XCTAssertGreaterThan(changes, 0)
    }

    func testResultOfASearchThatStartedBeforeBackgroundIsDiscarded() async throws {
        let s = makeSetup(dialer: FakeDialer())
        let forwarder = s.forwarder
        let task = _Concurrency.Task { await forwarder.acceptConnection() }
        let parked = await waitUntil { s.dialer.pendingCount == 1 }
        XCTAssertTrue(parked)

        s.route.appWentToBackground()
        let late = FakeStream()
        s.dialer.resolveNext(.connected(late, .wifi))
        let channel = await task.value

        XCTAssertNil(channel)
        XCTAssertTrue(late.isClosed)
        XCTAssertEqual(s.route.state, .idle)
    }

    // MARK: Zustände und Texte

    func testHandshakeFailureTextAppearsOnlyAfterThreeFailedSearches() async {
        let dialer = FakeDialer { _, _ in .failed(.handshakeFailed) }
        let s = makeSetup(dialer: dialer)

        for round in 1...2 {
            let channel = await s.forwarder.acceptConnection()
            XCTAssertNil(channel, "Runde \(round)")
            XCTAssertEqual(s.route.state, .connecting, "Runde \(round)")
        }
        _ = await s.forwarder.acceptConnection()

        XCTAssertEqual(s.route.state, .down(.handshakeFailed))
        // Bei jedem Suchlauf wurden beide Stufen versucht
        XCTAssertEqual(s.dialer.calls.count, 6)
    }

    func testSearchingTextForTheFirstFifteenSecondsThenMacNotFound() async {
        let dialer = FakeDialer { _, _ in .failed(.notFound) }
        let s = makeSetup(dialer: dialer)

        _ = await s.forwarder.acceptConnection()
        XCTAssertEqual(s.route.state, .connecting)

        await s.clock.advance(MacRoute.searchingSeconds + 1)
        _ = await s.forwarder.acceptConnection()
        XCTAssertEqual(s.route.state, .down(.macNotFound))
    }

    func testWifiOffTextWhenThePathHasNoWifiInterface() async {
        let dialer = FakeDialer { _, _ in .failed(.notFound) }
        let s = makeSetup(dialer: dialer)
        s.paths.wifiLooksOff = true

        await s.clock.advance(MacRoute.searchingSeconds + 1)
        _ = await s.forwarder.acceptConnection()

        XCTAssertEqual(s.route.state, .down(.wifiOff))
        // Der Hinweis gatet keinen Versuch: Beide Stufen wurden versucht
        XCTAssertEqual(s.dialer.calls.count, 2)
    }

    func testLocalNetworkDeniedIsReportedAtOnceAndStopsTheSearch() async {
        let dialer = FakeDialer { _, _ in .failed(.localNetworkDenied) }
        let s = makeSetup(dialer: dialer)

        _ = await s.forwarder.acceptConnection()

        XCTAssertEqual(s.route.state, .down(.localNetworkDenied))
        XCTAssertEqual(s.dialer.calls.count, 1)
    }

    func testRecoversToUpAfterAProblem() async {
        let dialer = FakeDialer { peerToPeer, index in
            index < 2 ? .failed(.notFound) : (peerToPeer ? .connected(FakeStream(), .direct) : .connected(FakeStream(), .wifi))
        }
        let s = makeSetup(dialer: dialer)
        await s.clock.advance(MacRoute.searchingSeconds + 1)
        _ = await s.forwarder.acceptConnection()
        XCTAssertEqual(s.route.state, .down(.macNotFound))

        let channel = await s.forwarder.acceptConnection()

        XCTAssertNotNil(channel)
        XCTAssertEqual(s.route.state, .up(.sharedWifi))
    }

    func testDisplayKindFollowsTheRealPath() {
        XCTAssertEqual(MacRoute.displayKind(stage: .sharedWifi, path: .unknown), .sharedWifi)
        XCTAssertEqual(MacRoute.displayKind(stage: .direct, path: .direct), .direct)
        XCTAssertEqual(MacRoute.displayKind(stage: .direct, path: .unknown), .direct)
        // Stufe 2 erlaubt peer-to-peer, läuft aber über das WLAN: Das steht auch so da
        XCTAssertEqual(MacRoute.displayKind(stage: .direct, path: .wifi), .sharedWifi)
    }

    func testPathLineTexts() {
        XCTAssertEqual(RouteTexts.pathLine(.up(.sharedWifi)), "Verbunden über das WLAN")
        XCTAssertEqual(RouteTexts.pathLine(.up(.direct)), "Direkt verbunden, ohne WLAN-Netz")
        XCTAssertNil(RouteTexts.pathLine(.idle))
        XCTAssertNil(RouteTexts.pathLine(.connecting))
        XCTAssertNil(RouteTexts.pathLine(.down(.macNotFound)))
        XCTAssertEqual(RouteTexts.searching, "Suche deinen Mac …")
    }

    func testEveryProblemHasCalmTextsWithoutDialogOrExclamationMark() {
        let problems: [RouteProblem] = [.wifiOff, .macNotFound, .handshakeFailed, .localNetworkDenied, .repairNeeded]
        for problem in problems {
            let error = problem.connectionError
            XCTAssertFalse(error.title.isEmpty)
            XCTAssertFalse(error.advice.isEmpty)
            XCTAssertFalse(error.title.contains("!"))
            XCTAssertFalse(error.advice.contains("!"))
        }
        XCTAssertEqual(RouteProblem.repairNeeded.connectionError.title, "Bitte einmal neu koppeln")
        XCTAssertEqual(RouteProblem.wifiOff.connectionError.title, "WLAN ist aus")
        XCTAssertEqual(RouteProblem.macNotFound.connectionError.title, "Mac nicht gefunden")
        // Der Text zum falschen Schlüssel fordert nicht zum Entkoppeln auf (Jeder im Funk kann den Namen nachsprechen)
        let handshake = RouteProblem.handshakeFailed.connectionError.advice
        XCTAssertFalse(handshake.localizedCaseInsensitiveContains("entkoppel"))
        XCTAssertFalse(handshake.localizedCaseInsensitiveContains("aufheben"))
        // Die ruhigen Überschriften tragen kein „iPad nicht verbunden“
        for problem in problems where problem != .localNetworkDenied {
            let badge = BadgeState.disconnected(problem.connectionError)
            XCTAssertEqual(badge.headline, problem.connectionError.title)
        }
    }

    func testBadgeStateFollowsTheRoute() {
        XCTAssertEqual(
            BadgeState.resolve(connection: .unknown, syncState: .connecting, route: .connecting), .searching)
        XCTAssertEqual(BadgeState.searching.headline, "Suche deinen Mac …")
        XCTAssertFalse(BadgeState.searching.isGreen)
        XCTAssertEqual(
            BadgeState.resolve(connection: .unknown, syncState: .waiting, route: .down(.repairNeeded)),
            .disconnected(.tunnelKeyMissing))
        // Der laufende Sync zählt mehr als eine alte Meldung der Wegewahl
        XCTAssertEqual(
            BadgeState.resolve(connection: .connected, syncState: .online, route: .down(.macNotFound)), .online)
        // Ohne Wegewahl bleibt alles wie zuvor
        XCTAssertEqual(BadgeState.resolve(connection: .unknown, syncState: nil, route: nil), .checking)
        XCTAssertTrue(ConnectionError.tunnelKeyMissing.needsNewPairing)
        XCTAssertFalse(ConnectionError.tunnelMacNotFound.needsNewPairing)
    }
}
