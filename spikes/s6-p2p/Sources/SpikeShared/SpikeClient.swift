@preconcurrency import Network
import Foundation

// Spike S6: Client-Seite (iPad und Selbsttest am Mac). Eine Verbindung = ein Handshake.
// Die Aufrufe einer Verbindung laufen nacheinander, nie gleichzeitig.
// Hier steht bewusst nirgends `Task` allein: In der iPad-App verdeckt Schemas.swift diesen Namen.

public enum SpikeClientError: Error, Sendable, CustomStringConvertible {
    case closed
    case timedOut
    case network(String)
    case protocolViolation(String)

    public var description: String {
        switch self {
        case .closed: return "Verbindung geschlossen"
        case .timedOut: return "Zeitüberschreitung"
        case .network(let text): return "Netzwerkfehler (\(text))"
        case .protocolViolation(let text): return "Protokollfehler (\(text))"
        }
    }
}

/// Ergebnis des Verbindungsaufbaus
public enum SpikeConnectOutcome: Sendable {
    case ready(SpikeHandshakeInfo)
    case failed(String)
    case timedOut(lastState: String)
}

public struct SpikeHandshakeInfo: Sendable {
    /// Dauer bis `.ready` (Handshake fertig)
    public let seconds: Double
    public let negotiated: SpikeNegotiated?
    /// Namen der Schnittstellen (z. B. `en0`, `awdl0`), keine Adressen
    public let interfaces: SpikeInterfaces
}

/// Schnittstellen eines Pfads. Nur Namen, nie Adressen: Das Protokoll soll sich teilen lassen.
public struct SpikeInterfaces: Equatable, Sendable {
    /// Schnittstelle des Gegenübers, falls der Pfad sie nennt (bei Link-Local-Adressen der Fall)
    public let remote: String?
    public let available: [String]

    public init(remote: String?, available: [String]) {
        self.remote = remote
        self.available = available
    }

    public enum Route: String, Sendable {
        case direct = "direkt (AWDL)"
        case network = "über das Netz (WLAN)"
        case unclear = "unklar"
    }

    /// Weg nach Schnittstellennamen. `awdl…` und `llw…` sind die Funkschnittstellen für peer-to-peer, `en…` das normale
    /// Netz. Nennt der Pfad die Schnittstelle des Gegenübers, zählt sie. Sonst entscheidet die Liste, aber nur, wenn
    /// sie eindeutig ist (sonst „unklar“: Der Pfad lässt dann nicht erkennen, welche genommen wurde).
    public var route: Route {
        if let remote { return SpikeInterfaces.classify(remote) }
        let kinds = Set(available.map(SpikeInterfaces.classify))
        if kinds == [.direct] { return .direct }
        if kinds == [.network] { return .network }
        return .unclear
    }

    static func classify(_ name: String) -> Route {
        if name.hasPrefix("awdl") || name.hasPrefix("llw") { return .direct }
        if name.hasPrefix("en") { return .network }
        return .unclear
    }

    public var text: String {
        let names = available.isEmpty ? "–" : available.joined(separator: ", ")
        return "Weg: \(route.rawValue); Gegenseite: \(remote ?? "unbekannt"); verfügbar: \(names)"
    }

    static func from(path: NWPath?) -> SpikeInterfaces {
        guard let path else { return SpikeInterfaces(remote: nil, available: []) }
        var remoteName: String?
        if case let .hostPort(host, _)? = path.remoteEndpoint {
            switch host {
            case .ipv4(let address): remoteName = address.interface?.name
            case .ipv6(let address): remoteName = address.interface?.name
            case .name(_, let interface): remoteName = interface?.name
            @unknown default: break
            }
        }
        return SpikeInterfaces(remote: remoteName, available: path.availableInterfaces.map { $0.name })
    }
}

public struct SpikeThroughput: Sendable {
    public let bytesDown: Int
    public let bytesUp: Int
    public let seconds: Double

    /// MB/s je Richtung (Dezimal-MB). Hin und zurück laufen beim Echo gleichzeitig.
    public var megabytesPerSecondDown: Double { seconds > 0 ? Double(bytesDown) / 1_000_000 / seconds : 0 }
    public var megabytesPerSecondUp: Double { seconds > 0 ? Double(bytesUp) / 1_000_000 / seconds : 0 }
}

public final class SpikeClient: @unchecked Sendable {
    private let connection: NWConnection
    private let queue = DispatchQueue(label: "de.studiengehirn.spike.client")
    private let lock = NSLock()
    private var timedOut = false

    public init(endpoint: NWEndpoint, code: SpikeCode, suites: [SpikeSuite], peerToPeer: Bool) {
        let parameters = SpikeTLS.parameters(code: code, suites: suites, peerToPeer: peerToPeer)
        self.connection = NWConnection(to: endpoint, using: parameters)
    }

    public func close() {
        connection.stateUpdateHandler = nil
        connection.cancel()
    }

    // MARK: Verbindungsaufbau

    /// Startet die Verbindung und wartet auf den Handshake. Nach Ablauf der Frist wird abgebrochen.
    public func connect(timeout: TimeInterval) async -> SpikeConnectOutcome {
        let started = DispatchTime.now()
        return await withCheckedContinuation { (continuation: CheckedContinuation<SpikeConnectOutcome, Never>) in
            let once = SpikeOnce(continuation)
            let lastState = SpikeBox("neu")
            connection.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    let seconds = Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1e9
                    let info = SpikeHandshakeInfo(
                        seconds: seconds,
                        negotiated: SpikeTLS.negotiated(on: self.connection),
                        interfaces: SpikeInterfaces.from(path: self.connection.currentPath))
                    once.resume(.ready(info))
                case .failed(let error):
                    once.resume(.failed(String(describing: error)))
                    self.connection.cancel()
                case .waiting(let error):
                    // Kann vorübergehend sein (z. B. Dienst noch nicht aufgelöst). Die Frist entscheidet.
                    lastState.set("wartet: \(error)")
                case .cancelled:
                    once.resume(.failed("abgebrochen"))
                case .preparing:
                    lastState.set("bereitet vor")
                case .setup:
                    break
                @unknown default:
                    break
                }
            }
            connection.start(queue: queue)
            queue.asyncAfter(deadline: .now() + timeout) { [weak self] in
                if once.resume(.timedOut(lastState: lastState.get())) {
                    self?.connection.cancel()
                }
            }
        }
    }

    // MARK: Befehle

    /// Rundlaufzeit eines `ping` in Millisekunden
    public func ping(timeout: TimeInterval = 8) async throws -> Double {
        try await withDeadline(timeout) {
            let started = DispatchTime.now()
            try await self.send(SpikeWire.request(op: .ping))
            _ = try await self.readReply(expectedLength: 0)
            return Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1e6
        }
    }

    /// `health`: Der Mac fragt seinen Core und gibt Status und Dauer zurück
    public func health(timeout: TimeInterval = 8) async throws -> (reply: SpikeHealthReply, roundTripMillis: Double) {
        try await withDeadline(timeout) {
            let started = DispatchTime.now()
            try await self.send(SpikeWire.request(op: .health))
            let payload = try await self.readReply(expectedLength: SpikeHealthReply.payloadBytes)
            guard let reply = SpikeHealthReply.decode(payload) else {
                throw SpikeClientError.protocolViolation("health-Antwort")
            }
            return (reply, Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1e6)
        }
    }

    public func echo(_ payload: [UInt8], timeout: TimeInterval = 8) async throws -> [UInt8] {
        try await withDeadline(timeout) {
            try await self.send(SpikeWire.request(op: .echo, payload: payload))
            return try await self.readReply(expectedLength: payload.count)
        }
    }

    /// Lädt `megabytes` MiB Zufallsdaten vom Mac und wirft sie weg
    public func downloadBlob(megabytes: Int, timeout: TimeInterval = 60) async throws -> SpikeThroughput {
        try await withDeadline(timeout) {
            let started = DispatchTime.now()
            try await self.send(SpikeWire.blobRequest(megabytes: megabytes))
            let header = try await self.receive(min: SpikeLimits.headerBytes, max: SpikeLimits.headerBytes)
            guard case .success(let parsed) = SpikeWire.parseReplyHeader(Array(header)), parsed.status == .ok,
                parsed.length == megabytes * SpikeLimits.bytesPerMegabyte
            else { throw SpikeClientError.protocolViolation("blob-Antwort") }
            var remaining = parsed.length
            while remaining > 0 {
                let chunk = try await self.receive(min: 1, max: min(remaining, 256 * 1024))
                remaining -= chunk.count
            }
            let seconds = Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1e9
            return SpikeThroughput(bytesDown: parsed.length, bytesUp: 0, seconds: seconds)
        }
    }

    /// Schickt `totalBytes` in `echo`-Blöcken zu 64 KiB und liest sie zurück, höchstens `window` Blöcke unterwegs.
    /// Misst damit beide Richtungen zugleich, ohne zusätzlichen Befehl am Mac.
    public func echoThroughput(totalBytes: Int, window: Int = 4, timeout: TimeInterval = 90) async throws
        -> SpikeThroughput
    {
        try await withDeadline(timeout) {
            let block = SpikeClient.randomBytes(SpikeLimits.echoMaxBytes)
            let frame = Data(SpikeWire.request(op: .echo, payload: block))
            let blocks = max(1, totalBytes / block.count)
            let started = DispatchTime.now()
            var done = 0
            while done < blocks {
                let batch = min(window, blocks - done)
                for _ in 0..<batch { self.sendWithoutWaiting(frame) }
                for _ in 0..<batch {
                    let reply = try await self.readReply(expectedLength: block.count)
                    guard reply == block else { throw SpikeClientError.protocolViolation("Echo weicht ab") }
                }
                done += batch
            }
            let seconds = Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1e9
            return SpikeThroughput(bytesDown: blocks * block.count, bytesUp: blocks * block.count, seconds: seconds)
        }
    }

    // MARK: Ein- und Ausgabe

    private func readReply(expectedLength: Int) async throws -> [UInt8] {
        let header = try await receive(min: SpikeLimits.headerBytes, max: SpikeLimits.headerBytes)
        switch SpikeWire.parseReplyHeader(Array(header)) {
        case .failure:
            throw SpikeClientError.protocolViolation("Antwortkopf")
        case .success(let parsed):
            guard parsed.status == .ok, parsed.length == expectedLength else {
                throw SpikeClientError.protocolViolation("Antwort: Status oder Länge")
            }
            if parsed.length == 0 { return [] }
            return Array(try await receive(min: parsed.length, max: parsed.length))
        }
    }

    private func send(_ bytes: [UInt8]) async throws {
        let data = Data(bytes)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.send(
                content: data,
                completion: .contentProcessed { error in
                    if let error {
                        continuation.resume(throwing: SpikeClientError.network(String(describing: error)))
                    } else {
                        continuation.resume()
                    }
                })
        }
    }

    /// Ohne auf die Übergabe zu warten. Ein Fehler zeigt sich beim Lesen. So können Senden und Lesen sich nicht
    /// gegenseitig blockieren.
    private func sendWithoutWaiting(_ data: Data) {
        connection.send(content: data, completion: .contentProcessed { _ in })
    }

    private func receive(min: Int, max: Int) async throws -> Data {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
            connection.receive(minimumIncompleteLength: min, maximumLength: max) { data, _, _, error in
                if let error {
                    continuation.resume(throwing: SpikeClientError.network(String(describing: error)))
                } else if let data, data.count >= min {
                    continuation.resume(returning: data)
                } else {
                    continuation.resume(throwing: SpikeClientError.closed)
                }
            }
        }
    }

    /// Bricht die Verbindung nach Ablauf der Frist ab, damit ein hängender Lesevorgang endet
    private func withDeadline<T: Sendable>(
        _ seconds: TimeInterval, _ body: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        let item = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.lock.lock()
            self.timedOut = true
            self.lock.unlock()
            self.connection.cancel()
        }
        queue.asyncAfter(deadline: .now() + seconds, execute: item)
        defer { item.cancel() }
        do {
            return try await body()
        } catch {
            lock.lock()
            let expired = timedOut
            lock.unlock()
            throw expired ? SpikeClientError.timedOut : error
        }
    }

    static func randomBytes(_ count: Int) -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: count)
        var generator = SystemRandomNumberGenerator()
        for index in 0..<count { bytes[index] = UInt8.random(in: 0...255, using: &generator) }
        return bytes
    }
}

/// Setzt eine Continuation genau einmal fort, egal aus welchem Rückruf. `resume` meldet, ob es die erste war.
final class SpikeOnce<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Never>?

    init(_ continuation: CheckedContinuation<Value, Never>) {
        self.continuation = continuation
    }

    @discardableResult
    func resume(_ value: Value) -> Bool {
        lock.lock()
        let pending = continuation
        continuation = nil
        lock.unlock()
        guard let pending else { return false }
        pending.resume(returning: value)
        return true
    }
}

/// Ein veränderlicher Wert, der aus mehreren Rückrufen gelesen und geschrieben wird
final class SpikeBox<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value

    init(_ value: Value) {
        self.value = value
    }

    func get() -> Value {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func set(_ newValue: Value) {
        lock.lock()
        value = newValue
        lock.unlock()
    }
}
