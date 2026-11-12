import Foundation
@preconcurrency import Network
import Security
import SpikeShared

/// Zähler des Servers (für Meldungen und den Selbsttest)
public struct SpikeServerStats: Equatable, Sendable {
    public var accepted = 0
    public var handshakesSucceeded = 0
    public var handshakesFailed = 0
    public var refusedOverLimit = 0
    public var commands = 0
    /// Zu viele gescheiterte Handshakes: Der Server nimmt nichts mehr an
    public var lockedOut = false
}

/// Mac-Teil des Spikes. Kennt nur vier feste Befehle (`SpikeCommand`). Ein allgemeines Weiterreichen gibt es nicht:
/// Der einzige Zugriff nach außen ist `SpikeHealthProbing` mit fester URL.
public final class SpikeServer: @unchecked Sendable {
    public struct Options: Sendable {
        public var code: SpikeCode
        /// `includePeerToPeer` für Listener und Ankündigung
        public var peerToPeer: Bool
        /// Bonjour-Dienst ankündigen (im Selbsttest aus)
        public var advertise: Bool
        /// Fester Port, sonst wählt das System
        public var port: UInt16?
        public var maxConnections: Int
        /// Sperre nach so vielen gescheiterten Handshakes (Raten des Codes übers Netz)
        public var maxFailedHandshakes: Int
        /// Wird einmal gerufen, wenn die Sperre greift (auf der Queue des Servers). Das Programm beendet sich dann.
        public var onLockout: @Sendable () -> Void
        public var probe: any SpikeHealthProbing
        /// Meldungen (ohne Adressen). Standard: still.
        public var log: @Sendable (String) -> Void

        public init(
            code: SpikeCode, peerToPeer: Bool = true, advertise: Bool = true, port: UInt16? = nil,
            maxConnections: Int = SpikeLimits.maxConnections,
            maxFailedHandshakes: Int = SpikeLimits.maxFailedHandshakes, probe: any SpikeHealthProbing,
            log: @escaping @Sendable (String) -> Void = { _ in }, onLockout: @escaping @Sendable () -> Void = {}
        ) {
            self.code = code
            self.peerToPeer = peerToPeer
            self.advertise = advertise
            self.port = port
            self.maxConnections = maxConnections
            self.maxFailedHandshakes = maxFailedHandshakes
            self.probe = probe
            self.log = log
            self.onLockout = onLockout
        }
    }

    let options: Options
    let queue = DispatchQueue(label: "de.studiengehirn.spike.server")
    private var listener: NWListener?
    // Alles Folgende nur auf `queue` anfassen
    private var sessions: [ObjectIdentifier: SpikeSession] = [:]
    private var counters = SpikeServerStats()

    public init(options: Options) {
        self.options = options
    }

    /// Startet den Listener und wartet, bis er bereit ist. Gibt den Port zurück.
    public func start() async throws -> UInt16 {
        let parameters = SpikeTLS.parameters(code: options.code, suites: SpikeSuites.all, peerToPeer: options.peerToPeer)
        let listener: NWListener
        if let port = options.port, let nwPort = NWEndpoint.Port(rawValue: port) {
            listener = try NWListener(using: parameters, on: nwPort)
        } else {
            listener = try NWListener(using: parameters)
        }
        if options.advertise {
            listener.service = NWListener.Service(name: options.code.serviceName, type: SpikeLimits.serviceType)
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        self.listener = listener

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<UInt16, Error>) in
            let finished = SpikeServerOnce()
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    if finished.first() { continuation.resume(returning: listener.port?.rawValue ?? 0) }
                case .failed(let error):
                    self?.options.log("Listener ausgefallen: \(error)")
                    if finished.first() { continuation.resume(throwing: error) }
                case .waiting(let error):
                    self?.options.log("Listener wartet: \(error)")
                default:
                    break
                }
            }
            listener.start(queue: queue)
        }
    }

    public func stop() {
        listener?.cancel()
        listener = nil
        queue.async {
            for session in self.sessions.values { session.cancel() }
            self.sessions.removeAll()
        }
    }

    public var stats: SpikeServerStats {
        queue.sync { counters }
    }

    // MARK: Nur auf `queue`

    private func accept(_ connection: NWConnection) {
        counters.accepted += 1
        if counters.lockedOut {
            connection.cancel()
            return
        }
        if sessions.count >= options.maxConnections {
            counters.refusedOverLimit += 1
            connection.cancel()
            return
        }
        let session = SpikeSession(connection: connection, server: self)
        sessions[ObjectIdentifier(session)] = session
        session.start()
    }

    func sessionBecameReady() {
        queue.async { self.counters.handshakesSucceeded += 1 }
    }

    func sessionRan(_ command: SpikeCommand) {
        queue.async { self.counters.commands += 1 }
    }

    func sessionEnded(_ session: SpikeSession, handshakeDone: Bool) {
        queue.async {
            if self.sessions.removeValue(forKey: ObjectIdentifier(session)) != nil, !handshakeDone {
                self.counters.handshakesFailed += 1
                if self.counters.handshakesFailed >= self.options.maxFailedHandshakes, !self.counters.lockedOut {
                    self.counters.lockedOut = true
                    for other in self.sessions.values { other.cancel() }
                    self.options.log(
                        "Zu viele gescheiterte Handshakes (\(self.counters.handshakesFailed)): Der Spike nimmt nichts mehr an.")
                    self.options.onLockout()
                }
            }
        }
    }
}

final class SpikeServerOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var used = false

    func first() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if used { return false }
        used = true
        return true
    }
}

/// Eine Verbindung. Läuft in einem eigenen Ablauf: Kopf lesen, prüfen, Nutzlast lesen, antworten.
final class SpikeSession: @unchecked Sendable {
    private let connection: NWConnection
    private let server: SpikeServer
    private let lock = NSLock()
    private var ready = false
    private var ended = false
    private var lastActivity = Date()
    private let created = Date()
    private var watchdog: DispatchSourceTimer?

    init(connection: NWConnection, server: SpikeServer) {
        self.connection = connection
        self.server = server
    }

    func start() {
        connection.stateUpdateHandler = { [weak self] state in
            self?.handle(state)
        }
        connection.start(queue: server.queue)
        // Wacht über Handshake-Frist (5 s) und Leerlauf (60 s)
        let timer = DispatchSource.makeTimerSource(queue: server.queue)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in self?.checkTimers() }
        timer.resume()
        lock.lock()
        watchdog = timer
        lock.unlock()
        // Der Ablauf (Lesen, Befehle) startet erst in `handle(.ready)`, nach der Prüfung des Verfahrens
    }

    func cancel() {
        connection.cancel()
    }

    private func handle(_ state: NWConnection.State) {
        switch state {
        case .ready:
            // Beide Seiten prüfen das ausgehandelte Verfahren (Plan E12). Ohne passendes Verfahren: sofort zu.
            guard let negotiated = SpikeTLS.negotiated(on: connection), negotiated.isAllowed else {
                server.options.log("Verbindung abgewiesen: TLS-Verfahren nicht zulässig")
                connection.cancel()
                return
            }
            lock.lock()
            ready = true
            lastActivity = Date()
            lock.unlock()
            server.options.log("Verbindung bereit (\(negotiated.text))")
            server.sessionBecameReady()
            _Concurrency.Task { await self.run() }
        case .failed, .cancelled:
            end()
        default:
            break
        }
    }

    private func checkTimers() {
        lock.lock()
        let isReady = ready
        let idle = Date().timeIntervalSince(lastActivity)
        let age = Date().timeIntervalSince(created)
        let isEnded = ended
        let timer = watchdog
        lock.unlock()
        if isEnded {
            timer?.cancel()
            return
        }
        if !isReady, age > SpikeLimits.handshakeSeconds {
            connection.cancel()
        } else if isReady, idle > SpikeLimits.idleSeconds {
            server.options.log("Verbindung im Leerlauf beendet")
            connection.cancel()
        }
    }

    private func touch() {
        lock.lock()
        lastActivity = Date()
        lock.unlock()
    }

    private func end() {
        lock.lock()
        let first = !ended
        ended = true
        let handshakeDone = ready
        let timer = watchdog
        watchdog = nil
        lock.unlock()
        guard first else { return }
        timer?.cancel()
        connection.stateUpdateHandler = nil
        connection.cancel()
        server.sessionEnded(self, handshakeDone: handshakeDone)
    }

    // MARK: Ablauf

    private func run() async {
        do {
            while true {
                let headerData = try await receive(SpikeLimits.headerBytes)
                touch()
                guard case .success(let header) = SpikeWire.parseRequestHeader(Array(headerData)) else {
                    break  // unbekannter Befehl oder nicht erlaubte Länge: Verbindung schließen
                }
                let payload = header.length > 0 ? Array(try await receive(header.length)) : []
                guard case .success(let command) = SpikeWire.command(header: header, payload: payload) else {
                    break
                }
                server.sessionRan(command)
                try await execute(command)
                touch()
            }
        } catch {
            // Verbindung weg oder Schreibfehler: nichts zu melden
        }
        end()
    }

    private func execute(_ command: SpikeCommand) async throws {
        switch command {
        case .ping:
            try await send(SpikeWire.reply())
        case .health:
            let reply = await server.options.probe.probe()
            try await send(SpikeWire.reply(payload: reply.encoded()))
        case .echo(let payload):
            try await send(SpikeWire.reply(payload: payload))
        case .blob(let megabytes):
            // Als Strom erzeugt, nie komplett im Speicher. Der nächste Block geht erst raus, wenn der vorige übergeben ist.
            let total = megabytes * SpikeLimits.bytesPerMegabyte
            try await send(SpikeWire.replyHeader(status: .ok, length: total))
            var remaining = total
            while remaining > 0 {
                let size = min(remaining, SpikeLimits.blobChunkBytes)
                var chunk = [UInt8](repeating: 0, count: size)
                guard SecRandomCopyBytes(kSecRandomDefault, size, &chunk) == errSecSuccess else {
                    throw SpikeClientError.closed
                }
                try await send(chunk)
                remaining -= size
                touch()
            }
        }
    }

    private func send(_ bytes: [UInt8]) async throws {
        let data = Data(bytes)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.send(
                content: data,
                completion: .contentProcessed { error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                })
        }
    }

    private func receive(_ count: Int) async throws -> Data {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
            connection.receive(minimumIncompleteLength: count, maximumLength: count) { data, _, _, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let data, data.count == count {
                    continuation.resume(returning: data)
                } else {
                    continuation.resume(throwing: SpikeClientError.closed)
                }
            }
        }
    }
}
