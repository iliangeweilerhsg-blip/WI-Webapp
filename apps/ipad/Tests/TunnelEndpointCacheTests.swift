@preconcurrency import Network
import XCTest

@testable import StudienGehirn

/// Wiederverwendung des zuletzt erfolgreichen Endpunkts (Leistung, Review PR #276): Ohne sie startet jede neue Verbindung
/// des Weiterleiters eine eigene Bonjour-Suche. Gemerkt wird nur kurz, und alles verfällt bei Netzwechsel, Vordergrund,
/// Hintergrund und neuem Schlüssel. Adressen aus dem Dokumentationsnetz (RFC 5737).
final class TunnelEndpointCacheTests: XCTestCase {
    /// Uhr zum Vorstellen, ohne zu warten
    private final class ManualTime: @unchecked Sendable {
        private let lock = NSLock()
        private var offset: TimeInterval = 0
        let start = Date(timeIntervalSince1970: 1_762_246_500)

        var now: Date {
            lock.lock()
            defer { lock.unlock() }
            return start.addingTimeInterval(offset)
        }

        func advance(_ seconds: TimeInterval) {
            lock.lock()
            offset += seconds
            lock.unlock()
        }
    }

    private static var macAddress: NWEndpoint { .hostPort(host: "192.0.2.10", port: 52_100) }
    private static var otherAddress: NWEndpoint { .hostPort(host: "192.0.2.11", port: 52_100) }

    private func makeCache(_ time: ManualTime, lifetime: TimeInterval = 120) -> TunnelEndpointCache {
        TunnelEndpointCache(lifetime: lifetime, now: { time.now })
    }

    func testRemembersTheEndpointPerNameAndStage() {
        let time = ManualTime()
        let cache = makeCache(time)
        let name = TunnelTestKeys.key(1).serviceName

        cache.remember(Self.macAddress, serviceName: name, peerToPeer: false, ticket: cache.ticket())

        XCTAssertEqual(cache.lookup(serviceName: name, peerToPeer: false), Self.macAddress)
        // Die andere Stufe und ein anderer Schlüssel haben ihren eigenen Eintrag
        XCTAssertNil(cache.lookup(serviceName: name, peerToPeer: true))
        XCTAssertNil(cache.lookup(serviceName: TunnelTestKeys.key(2).serviceName, peerToPeer: false))
    }

    func testEntryExpiresAfterItsLifetime() {
        let time = ManualTime()
        let cache = makeCache(time, lifetime: 120)
        let name = TunnelTestKeys.key(1).serviceName
        cache.remember(Self.macAddress, serviceName: name, peerToPeer: true, ticket: cache.ticket())

        time.advance(119)
        XCTAssertEqual(cache.lookup(serviceName: name, peerToPeer: true), Self.macAddress)
        time.advance(1)
        XCTAssertNil(cache.lookup(serviceName: name, peerToPeer: true))
        XCTAssertEqual(cache.count, 0)
    }

    func testEachSuccessRestartsTheLifetime() {
        let time = ManualTime()
        let cache = makeCache(time, lifetime: 120)
        let name = TunnelTestKeys.key(1).serviceName
        cache.remember(Self.macAddress, serviceName: name, peerToPeer: false, ticket: cache.ticket())
        time.advance(100)
        cache.remember(Self.otherAddress, serviceName: name, peerToPeer: false, ticket: cache.ticket())
        time.advance(100)

        XCTAssertEqual(cache.lookup(serviceName: name, peerToPeer: false), Self.otherAddress)
    }

    func testAFailedEndpointIsForgotten() {
        let time = ManualTime()
        let cache = makeCache(time)
        let name = TunnelTestKeys.key(1).serviceName
        cache.remember(Self.macAddress, serviceName: name, peerToPeer: false, ticket: cache.ticket())
        cache.remember(Self.macAddress, serviceName: name, peerToPeer: true, ticket: cache.ticket())

        cache.forget(serviceName: name, peerToPeer: false)

        XCTAssertNil(cache.lookup(serviceName: name, peerToPeer: false))
        XCTAssertEqual(cache.lookup(serviceName: name, peerToPeer: true), Self.macAddress)
    }

    func testForgetAllAlsoDropsResultsOfAttemptsThatStartedBefore() {
        let time = ManualTime()
        let cache = makeCache(time)
        let name = TunnelTestKeys.key(1).serviceName
        cache.remember(Self.macAddress, serviceName: name, peerToPeer: false, ticket: cache.ticket())
        // Ein Versuch beginnt im alten Netz …
        let oldTicket = cache.ticket()

        // … dann wechselt das Netz
        cache.forgetAll()
        XCTAssertNil(cache.lookup(serviceName: name, peerToPeer: false))

        // Der alte Versuch gelingt noch: Sein Endpunkt aus dem alten Netz wird nicht gemerkt
        cache.remember(Self.otherAddress, serviceName: name, peerToPeer: false, ticket: oldTicket)
        XCTAssertNil(cache.lookup(serviceName: name, peerToPeer: false))
        // Ein neuer Versuch darf wieder
        cache.remember(Self.otherAddress, serviceName: name, peerToPeer: false, ticket: cache.ticket())
        XCTAssertEqual(cache.lookup(serviceName: name, peerToPeer: false), Self.otherAddress)
    }

    func testTheRealDialerForgetsThroughTheProtocol() {
        let time = ManualTime()
        let cache = makeCache(time)
        let dialer: any TunnelDialing = NetworkTunnelDialer(cache: cache)
        cache.remember(
            Self.macAddress, serviceName: TunnelTestKeys.key(1).serviceName, peerToPeer: true, ticket: cache.ticket())

        dialer.forgetCachedEndpoints()

        XCTAssertEqual(cache.count, 0)
    }

    // MARK: Ehrlicher Text bei Fremden im Funk

    func testOnlyAFailureAtTheOtherEndCountsAsWrongKey() {
        // TLS-Fehler (z. B. falscher PSK) und Abbruch mitten im Handshake: „falscher Schlüssel“
        XCTAssertTrue(TunnelHandshakeCheck.isHandshakeFailure(.tls(-9806)))
        XCTAssertTrue(TunnelHandshakeCheck.isHandshakeFailure(.posix(.ECONNRESET)))
        // Niemand da (Helfer startet neu, Mac weg): „nicht gefunden“
        XCTAssertFalse(TunnelHandshakeCheck.isHandshakeFailure(.posix(.ECONNREFUSED)))
        XCTAssertFalse(TunnelHandshakeCheck.isHandshakeFailure(.posix(.ETIMEDOUT)))
        XCTAssertFalse(TunnelHandshakeCheck.isHandshakeFailure(.posix(.EHOSTUNREACH)))
        XCTAssertFalse(TunnelHandshakeCheck.isHandshakeFailure(.dns(-65554)))
    }
}

/// Die Wegewahl verwirft gemerkte Endpunkte bei jedem Ereignis, das auch den gemerkten Weg zurücksetzt
@MainActor
final class MacRouteForgetsEndpointsTests: XCTestCase {
    private func makeRoute(dialer: FakeDialer) -> (MacRoute, FakePaths, FakeTunnelKeyStore) {
        let paths = FakePaths()
        let keys = FakeTunnelKeyStore(key: TunnelTestKeys.text())
        let route = MacRoute(keys: keys, dialer: dialer, paths: paths, forwarder: FakeForwarder())
        route.setPaired(true)
        return (route, paths, keys)
    }

    private static func lectureHall() -> FakeDialer {
        FakeDialer { peerToPeer, _ in peerToPeer ? .connected(FakeStream(), .direct) : .failed(.notFound) }
    }

    func testNetworkChangeForgetsEndpointsButNotTheDisplay() async {
        let dialer = Self.lectureHall()
        let (route, paths, _) = makeRoute(dialer: dialer)
        _ = await route.openChannel()
        XCTAssertEqual(route.state, .up(.direct))
        let before = dialer.forgetCalls

        paths.simulateChange()

        XCTAssertEqual(dialer.forgetCalls, before + 1)
        XCTAssertEqual(route.state, .up(.direct))
    }

    func testForegroundAndBackgroundForgetEndpoints() {
        let dialer = Self.lectureHall()
        let (route, _, _) = makeRoute(dialer: dialer)
        var before = dialer.forgetCalls

        route.appWentToBackground()
        XCTAssertGreaterThan(dialer.forgetCalls, before)
        before = dialer.forgetCalls
        route.appBecameActive()
        XCTAssertGreaterThan(dialer.forgetCalls, before)
    }

    func testANewKeyForgetsEndpoints() {
        let dialer = Self.lectureHall()
        let (route, _, keys) = makeRoute(dialer: dialer)
        let before = dialer.forgetCalls

        keys.key = TunnelTestKeys.text(3)
        route.setPaired(true)

        XCTAssertGreaterThan(dialer.forgetCalls, before)
    }

    func testOrdinaryConnectionsDoNotForget() async {
        let dialer = Self.lectureHall()
        let (route, _, _) = makeRoute(dialer: dialer)
        let before = dialer.forgetCalls

        for _ in 0..<5 {
            _ = await route.openChannel()
        }

        XCTAssertEqual(dialer.forgetCalls, before)
    }
}
