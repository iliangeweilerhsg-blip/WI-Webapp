import Foundation
import XCTest

@preconcurrency import Network
import TunnelShared

@testable import TunnelKit

// Hilfen für die Tests des Helfers: Arbeitsordner, Schlüsseldatei, Fake-Core am Unix-Socket, TLS-Client.
// Schlüssel stehen nie als Text-Literal im Code (Secret-Scanning): Sie entstehen zur Laufzeit aus Zufallsbytes.

func encodeBase64URL(_ bytes: [UInt8]) -> String {
    Data(bytes).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

struct TestError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

/// Ein gekoppeltes Gerät mit zufälligem Schlüssel
struct TestDevice {
    let id: String
    let keyBytes: [UInt8]

    init() {
        id = UUID().uuidString.lowercased()
        keyBytes = (0..<32).map { _ in UInt8.random(in: 0...255) }
    }

    var keyText: String { encodeBase64URL(keyBytes) }
    var tunnelKey: TunnelKey { try! TunnelKey(rawBytes: keyBytes) }
    var serviceName: String { tunnelKey.serviceName }
    var presharedKey: [UInt8] { tunnelKey.presharedKey }
    var presharedKeyHex: String { presharedKey.map { String(format: "%02x", $0) }.joined() }
}

/// Arbeitsordner unter /tmp (kurzer Pfad: ein Unix-Socket-Pfad darf höchstens 103 Byte haben)
final class TunnelTestEnvironment {
    let root: String
    var secretsDirectory: String { root + "/secrets" }
    var keysPath: String { secretsDirectory + "/tunnel-keys.json" }
    var runDirectory: String { root + "/run" }
    var socketPath: String { runDirectory + "/tunnel.sock" }
    var statePath: String { runDirectory + "/tunnel-state.json" }

    init() throws {
        var template = Array("/tmp/sgt-XXXXXX".utf8CString)
        guard let created = mkdtemp(&template) else { throw TestError("mkdtemp fehlgeschlagen (\(errno))") }
        root = String(cString: created)
        for directory in [secretsDirectory, runDirectory] {
            try FileManager.default.createDirectory(
                atPath: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        }
    }

    deinit {
        try? FileManager.default.removeItem(atPath: root)
    }

    /// Schreibt die Schlüsseldatei wie der Core: Temp-Datei, Rechte, `rename` (neuer Inode)
    func writeKeys(_ devices: [TestDevice], mode: mode_t = 0o600) throws {
        let entries = devices.map { "{\"device_id\":\"\($0.id)\",\"tunnel_key\":\"\($0.keyText)\"}" }
        try writeFile(keysPath, "{\"v\":1,\"devices\":[\(entries.joined(separator: ","))]}\n", mode: mode)
    }

    func writeFile(_ path: String, _ text: String, mode: mode_t = 0o600) throws {
        let temporary = path + ".tmp"
        try text.write(toFile: temporary, atomically: false, encoding: .utf8)
        chmod(temporary, mode)
        guard rename(temporary, path) == 0 else { throw TestError("rename fehlgeschlagen (\(errno))") }
    }

    func removeKeys() {
        unlink(keysPath)
    }

    func options(peerToPeer: Bool = false, expectedUID: uid_t = geteuid()) -> TunnelOptions {
        TunnelOptions(
            keysPath: keysPath, socketPath: socketPath, statePath: statePath, peerToPeer: peerToPeer,
            advertise: false, expectedUID: expectedUID, autoTick: false)
    }
}

/// Fake-Core am Unix-Socket: zählt angenommene Verbindungen. Im Modus `echo` schickt er jedes Byte zurück,
/// im Modus `silent` liest er nie (für den Test des Gegendrucks).
final class FakeCore: @unchecked Sendable {
    enum Mode { case echo, silent }

    let path: String
    private let mode: Mode
    private let lock = NSLock()
    private var listenDescriptor: Int32 = -1
    private var accepted = 0
    private var received = Data()
    private var stopped = false
    private var clients: [Int32] = []

    init(path: String, mode: Mode) throws {
        self.path = path
        self.mode = mode
        unlink(path)
        guard var address = makeUnixAddress(path) else { throw TestError("Socket-Pfad zu lang") }
        let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw TestError("socket() fehlgeschlagen (\(errno))") }
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { generic in
                Darwin.bind(descriptor, generic, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0, listen(descriptor, 128) == 0 else {
            close(descriptor)
            throw TestError("bind/listen fehlgeschlagen (\(errno))")
        }
        chmod(path, 0o600)
        listenDescriptor = descriptor
        Thread.detachNewThread { [self] in self.acceptLoop() }
    }

    var acceptedCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return accepted
    }

    var receivedBytes: Data {
        lock.lock()
        defer { lock.unlock() }
        return received
    }

    func stop() {
        lock.lock()
        let wasStopped = stopped
        stopped = true
        let held = clients
        clients = []
        lock.unlock()
        guard !wasStopped else { return }
        Thread.sleep(forTimeInterval: 0.25)  // die Schleifen merken es (Abfrage alle 100 ms)
        close(listenDescriptor)
        for descriptor in held { close(descriptor) }
        unlink(path)
    }

    private var isStopped: Bool {
        lock.lock()
        defer { lock.unlock() }
        return stopped
    }

    private func acceptLoop() {
        while !isStopped {
            var entry = pollfd(fd: listenDescriptor, events: Int16(POLLIN), revents: 0)
            if poll(&entry, 1, 100) <= 0 { continue }
            let client = accept(listenDescriptor, nil, nil)
            if client < 0 { continue }
            lock.lock()
            accepted += 1
            clients.append(client)
            lock.unlock()
            if mode == .echo {
                Thread.detachNewThread { [self] in self.echo(client) }
            }
        }
    }

    private func echo(_ descriptor: Int32) {
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while !isStopped {
            var entry = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
            let ready = poll(&entry, 1, 100)
            if ready < 0 { return }
            if ready == 0 { continue }
            let count = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
            if count <= 0 { return }
            lock.lock()
            received.append(contentsOf: buffer[0..<count])
            lock.unlock()
            var offset = 0
            while offset < count {
                let written = buffer.withUnsafeBytes { Darwin.write(descriptor, $0.baseAddress! + offset, count - offset) }
                if written < 0 {
                    if errno == EINTR || errno == EAGAIN { continue }
                    return
                }
                offset += written
            }
        }
    }
}

/// Umschaltbare Probe für „Core weg“
final class SwitchableProbe: TunnelCoreProbing, @unchecked Sendable {
    private let lock = NSLock()
    private var reachable = true

    func set(_ value: Bool) {
        lock.lock()
        reachable = value
        lock.unlock()
    }

    func probe() -> TunnelCoreProbeResult {
        lock.lock()
        defer { lock.unlock() }
        return reachable ? .reachable : .unreachable("Der Core nimmt am Tunnel-Eingang keine Verbindung an.")
    }
}

/// Fake-Uhr: Die Prüfungen des Helfers (Core-Probe alle 10 s, Zustandsdatei alle 5 s) hängen nur an dieser Uhr
final class FakeClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current = Date(timeIntervalSince1970: 1_800_000_000)

    var now: Date {
        lock.lock()
        defer { lock.unlock() }
        return current
    }

    func advance(_ seconds: TimeInterval) {
        lock.lock()
        current = current.addingTimeInterval(seconds)
        lock.unlock()
    }
}

/// Eine Verbindung vom Testclient aus (TLS-PSK oder reines TCP). Liest dauernd mit und merkt sich das Ende.
final class TestClient: @unchecked Sendable {
    private let connection: NWConnection
    private let queue = DispatchQueue(label: "tunnel.test.client")
    private let lock = NSLock()
    private var ready = false
    private var closed = false
    private var buffer = Data()
    private var sent = 0
    private var states: [String] = []

    init(connection: NWConnection) {
        self.connection = connection
    }

    static func tls(
        port: UInt16, presharedKey: [UInt8], identity: String = TunnelConstants.pskIdentity,
        suiteIDs: [UInt16] = TunnelSuites.allowed.map { $0.id }
    ) -> TestClient {
        let parameters = TunnelTLS.parameters(
            presharedKey: presharedKey, identity: identity, suiteIDs: suiteIDs, peerToPeer: false)
        return TestClient(
            connection: NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!, using: parameters))
    }

    static func plain(port: UInt16) -> TestClient {
        TestClient(
            connection: NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!, using: .tcp))
    }

    var isReady: Bool {
        lock.lock()
        defer { lock.unlock() }
        return ready
    }

    var isClosed: Bool {
        lock.lock()
        defer { lock.unlock() }
        return closed
    }

    var sentBytes: Int {
        lock.lock()
        defer { lock.unlock() }
        return sent
    }

    var receivedCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return buffer.count
    }

    var negotiated: TunnelNegotiated? { TunnelTLS.negotiated(on: connection) }

    /// Verlauf der Zustände (Fehlersuche in der CI, ohne Schlüssel)
    var stateHistory: String {
        lock.lock()
        defer { lock.unlock() }
        return states.joined(separator: " → ")
    }

    private func record(_ state: NWConnection.State) {
        lock.lock()
        if states.count < 20 { states.append("\(state)") }
        lock.unlock()
    }

    /// Startet und wartet, bis die Verbindung steht (bei TLS: der Handshake gelungen ist) oder die Frist abläuft
    func connect(timeout: TimeInterval) async -> Bool {
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            self.record(state)
            switch state {
            case .ready:
                self.lock.lock()
                self.ready = true
                self.lock.unlock()
                self.receiveLoop()
            case .failed, .cancelled:
                self.markClosed()
            default:
                break
            }
        }
        connection.start(queue: queue)
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if isReady { return true }
            if isClosed { return false }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return isReady
    }

    private func markClosed() {
        lock.lock()
        closed = true
        lock.unlock()
    }

    private func receiveLoop() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let data, !data.isEmpty {
                self.lock.lock()
                self.buffer.append(data)
                self.lock.unlock()
            }
            if isComplete || error != nil {
                self.markClosed()
                return
            }
            self.receiveLoop()
        }
    }

    func send(_ data: Data) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.send(
                content: data,
                completion: .contentProcessed { error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                })
        }
        addSent(data.count)
    }

    private func addSent(_ count: Int) {
        lock.lock()
        sent += count
        lock.unlock()
    }

    /// Wartet, bis `count` Bytes eingetroffen sind, und liefert sie (ohne sie zu verbrauchen, wenn es nicht reicht)
    func read(exactly count: Int, timeout: TimeInterval) async -> Data? {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let data = takeIfAvailable(count) { return data }
            if isClosed { return takeIfAvailable(count) }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return takeIfAvailable(count)
    }

    private func takeIfAvailable(_ count: Int) -> Data? {
        lock.lock()
        defer { lock.unlock() }
        guard buffer.count >= count else { return nil }
        let data = buffer.prefix(count)
        buffer = Data(buffer.dropFirst(count))
        return Data(data)
    }

    func close() {
        connection.stateUpdateHandler = nil
        connection.cancel()
        markClosed()
    }
}

/// Wartet, bis die Bedingung erfüllt ist (Abfrage alle 50 ms)
func waitUntil(timeout: TimeInterval, _ condition: () -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if condition() { return true }
        try? await Task.sleep(nanoseconds: 50_000_000)
    }
    return condition()
}

/// Zufallsbytes einer bestimmten Länge
func randomBytes(_ count: Int) -> Data {
    Data((0..<count).map { _ in UInt8.random(in: 0...255) })
}
