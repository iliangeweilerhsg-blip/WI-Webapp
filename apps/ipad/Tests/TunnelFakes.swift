import Foundation
import XCTest

@testable import StudienGehirn

// Fakes für den Tunnel (UX-12, PR 4). Alles ohne Netz, ohne Bonjour, ohne Schlüsselbund.
//
// Keine schlüsselähnlichen Literale: Tunnel-Schlüssel entstehen zur Laufzeit aus Rohbytes (Secret-Scanning).

enum TunnelTestKeys {
    /// 32 Rohbytes, die mit `seed` beginnen und dann hochzählen
    static func bytes(_ seed: UInt8 = 0) -> [UInt8] {
        (0..<32).map { seed &+ UInt8($0) }
    }

    /// base64url ohne Padding, 43 Zeichen: das Format aus `PairResponse`
    static func encode(_ raw: [UInt8]) -> String {
        Data(raw).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func text(_ seed: UInt8 = 0) -> String {
        encode(bytes(seed))
    }

    static func key(_ seed: UInt8 = 0) -> TunnelKey {
        guard let key = try? TunnelKey(rawBytes: bytes(seed)) else {
            preconditionFailure("Testschlüssel hat nicht 32 Bytes")
        }
        return key
    }
}

/// Tunnel-Schlüssel im Arbeitsspeicher statt im Schlüsselbund
final class FakeTunnelKeyStore: TunnelKeyStore {
    var key: String?
    var failsOnSave = false
    private(set) var saveCount = 0
    private(set) var deleteCount = 0

    init(key: String? = nil) {
        self.key = key
    }

    func loadKey() throws -> String? { key }

    func saveKey(_ key: String) throws {
        if failsOnSave { throw KeychainError(status: -1) }
        saveCount += 1
        self.key = key
    }

    func deleteKey() throws {
        deleteCount += 1
        key = nil
    }
}

/// Ein Byte-Strom mit Skript. Die Sperre schützt den Zustand; sie wird nur in synchronen Funktionen genommen.
final class FakeStream: TunnelChannel, @unchecked Sendable {
    private let lock = NSLock()
    private var receives = 0
    private var sentChunks: [Data] = []
    private var closedFlag = false
    private var pending: (@Sendable (Data?, Bool) -> Void)?
    /// Schlägt jedes Senden fehl
    var failsSending = false

    func send(_ data: Data, completion: @escaping @Sendable (Bool) -> Void) {
        let fails = failsSending
        lock.lock()
        if !fails { sentChunks.append(data) }
        lock.unlock()
        completion(!fails)
    }

    func receive(maximum: Int, completion: @escaping @Sendable (Data?, Bool) -> Void) {
        lock.lock()
        receives += 1
        pending = completion
        lock.unlock()
    }

    func close() {
        lock.lock()
        closedFlag = true
        let waiting = pending
        pending = nil
        lock.unlock()
        waiting?(nil, true)
    }

    // MARK: Test

    /// Die Gegenseite schickt Bytes an den wartenden Leser. Ohne wartenden Leser passiert nichts (Rückgabe `false`).
    @discardableResult
    func deliver(_ data: Data, ended: Bool = false) -> Bool {
        lock.lock()
        let waiting = pending
        pending = nil
        lock.unlock()
        guard let waiting else { return false }
        waiting(data, ended)
        return true
    }

    var receiveCalls: Int {
        lock.lock()
        defer { lock.unlock() }
        return receives
    }

    var sent: [Data] {
        lock.lock()
        defer { lock.unlock() }
        return sentChunks
    }

    var isClosed: Bool {
        lock.lock()
        defer { lock.unlock() }
        return closedFlag
    }
}

/// Wartet, bis der Test den Weg zum Mac freigibt: Damit lässt sich prüfen, was **vor** dem Handshake passiert
final class OpenGate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<(any TunnelChannel)?, Never>?
    private var early: (any TunnelChannel)??
    private var opens = 0

    func open() async -> (any TunnelChannel)? {
        await withCheckedContinuation { (continuation: CheckedContinuation<(any TunnelChannel)?, Never>) in
            store(continuation)
        }
    }

    private func store(_ continuation: CheckedContinuation<(any TunnelChannel)?, Never>) {
        lock.lock()
        opens += 1
        if let released = early {
            early = nil
            lock.unlock()
            continuation.resume(returning: released)
            return
        }
        self.continuation = continuation
        lock.unlock()
    }

    /// Gibt den Weg frei (`nil` = Handshake gescheitert)
    func release(_ channel: (any TunnelChannel)?) {
        lock.lock()
        let waiting = continuation
        continuation = nil
        if waiting == nil { early = .some(channel) }
        lock.unlock()
        waiting?.resume(returning: channel)
    }

    var openCalls: Int {
        lock.lock()
        defer { lock.unlock() }
        return opens
    }
}

/// Zählt, wie oft Sitzungen fertig sind
final class CloseCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func increment() {
        lock.lock()
        value += 1
        lock.unlock()
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

/// Wartet (ohne die Hauptwarteschlange zu blockieren), bis die Bedingung gilt. Für Zustand, der auf anderen
/// Warteschlangen entsteht.
@MainActor
func waitUntil(timeout: TimeInterval = 3, _ condition: @MainActor () -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if condition() { return true }
        try? await _Concurrency.Task.sleep(for: .milliseconds(10))
    }
    return condition()
}

/// Wählt aus, was `dial` liefert. Alle Aufrufe werden gemerkt. Zwei Arten:
/// - `script`: sofortige Antwort je nach Stufe
/// - `manual`: Der Aufruf wartet, bis der Test ihn mit `resolveNext` beantwortet
final class FakeDialer: TunnelDialing, @unchecked Sendable {
    struct Call: Equatable {
        let peerToPeer: Bool
        let timeout: TimeInterval
        let serviceName: String
    }

    private let lock = NSLock()
    private var recorded: [Call] = []
    private var waiting: [CheckedContinuation<TunnelDialResult, Never>] = []
    private var forgets = 0
    private let scriptFn: @Sendable (Bool, Int) -> TunnelDialResult
    private let manual: Bool

    /// Sofortige Antworten. Das Skript bekommt `peerToPeer` und die Nummer des Aufrufs (ab 0).
    init(script: @escaping @Sendable (Bool, Int) -> TunnelDialResult) {
        self.scriptFn = script
        self.manual = false
    }

    /// Antworten von Hand
    init() {
        self.scriptFn = { _, _ in .failed(.notFound) }
        self.manual = true
    }

    func dial(key: TunnelKey, peerToPeer: Bool, timeout: TimeInterval) async -> TunnelDialResult {
        let index = record(Call(peerToPeer: peerToPeer, timeout: timeout, serviceName: key.serviceName))
        if manual {
            return await withCheckedContinuation { (continuation: CheckedContinuation<TunnelDialResult, Never>) in
                park(continuation)
            }
        }
        return scriptFn(peerToPeer, index)
    }

    func forgetCachedEndpoints() {
        lock.lock()
        forgets += 1
        lock.unlock()
    }

    /// So oft hat die Wegewahl gemerkte Endpunkte verworfen
    var forgetCalls: Int {
        lock.lock()
        defer { lock.unlock() }
        return forgets
    }

    private func record(_ call: Call) -> Int {
        lock.lock()
        defer { lock.unlock() }
        recorded.append(call)
        return recorded.count - 1
    }

    private func park(_ continuation: CheckedContinuation<TunnelDialResult, Never>) {
        lock.lock()
        waiting.append(continuation)
        lock.unlock()
    }

    // MARK: Test

    var calls: [Call] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    var pendingCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return waiting.count
    }

    /// Beantwortet den ältesten wartenden Aufruf
    func resolveNext(_ result: TunnelDialResult) {
        lock.lock()
        let next = waiting.isEmpty ? nil : waiting.removeFirst()
        lock.unlock()
        next?.resume(returning: result)
    }

    var wifiAttempts: Int { calls.filter { !$0.peerToPeer }.count }
    var directAttempts: Int { calls.filter { $0.peerToPeer }.count }
}

/// Weiterleiter ohne Listener. Merkt die Rückrufe der Wegewahl und lässt den Test Verbindungen „annehmen“.
@MainActor
final class FakeForwarder: LocalForwarding {
    private(set) var port: UInt16?
    private(set) var startCount = 0
    private(set) var stopCount = 0
    private var open: (@Sendable () async -> (any TunnelChannel)?)?
    /// Port, den der Fake beim Start meldet. `nil` = der Listener kann nicht starten.
    var portToReport: UInt16? = 41000
    /// Erhöht den Port bei jedem Start (wie ein neuer zufälliger Port)
    var incrementsPort = true

    func start(
        open: @escaping @Sendable () async -> (any TunnelChannel)?, ready: @escaping @MainActor @Sendable (UInt16?) -> Void
    ) {
        startCount += 1
        self.open = open
        var reported = portToReport
        if incrementsPort, let base = reported { reported = base + UInt16(startCount - 1) }
        port = reported
        ready(reported)
    }

    func stop() {
        stopCount += 1
        port = nil
        open = nil
    }

    var isRunning: Bool { open != nil }

    /// Eine neue lokale Verbindung kommt an: Der Weiterleiter holt den Weg zum Mac
    func acceptConnection() async -> (any TunnelChannel)? {
        guard let open else { return nil }
        return await open()
    }
}

@MainActor
final class FakePaths: NetworkPathWatching {
    var wifiLooksOff = false
    private(set) var startCount = 0
    private(set) var stopCount = 0
    private var onChange: (@MainActor @Sendable () -> Void)?

    func start(onChange: @escaping @MainActor @Sendable () -> Void) {
        startCount += 1
        self.onChange = onChange
    }

    func stop() {
        stopCount += 1
        onChange = nil
    }

    /// Das iPad wechselt das Netz
    func simulateChange() {
        onChange?()
    }
}

/// Wegewahl-Fake für Tests von `CoreClient`, Sync und `AppModel`: feste Adresse, fester Zustand
@MainActor
final class FakeRouting: MacRouting {
    var state: RouteState
    var fixedEndpoint: CoreEndpoint?
    var onChange: (@MainActor () -> Void)?
    var willStopForwarder: (@MainActor () -> Void)?
    private(set) var pairedCalls: [Bool] = []
    private(set) var activeCalls = 0
    private(set) var backgroundCalls = 0

    init(endpoint: CoreEndpoint? = CoreEndpoint(host: "127.0.0.1", port: 41000), state: RouteState = .up(.sharedWifi)) {
        self.fixedEndpoint = endpoint
        self.state = state
    }

    func endpoint() -> CoreEndpoint? { fixedEndpoint }
    func setPaired(_ paired: Bool) { pairedCalls.append(paired) }
    func appBecameActive() { activeCalls += 1 }
    func appWentToBackground() {
        // Wie die echte Wegewahl: erst die Meldung vor dem Stopp, dann der Stopp
        willStopForwarder?()
        fixedEndpoint = nil
        backgroundCalls += 1
    }
}
