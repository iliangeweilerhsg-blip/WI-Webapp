import Foundation
// @preconcurrency: Ältere SDKs kennzeichnen die Network-Typen noch nicht als Sendable
@preconcurrency import Network

// Lokaler Weiterleiter (UX-12, PR 4; Plan E6, §5.3): Ein `NWListener` nur auf Loopback nimmt die Verbindungen von
// `URLSession` und WebSocket an. Je Verbindung holt er einen beglaubigten Weg zum Mac (`TunnelChannel`) und reicht die
// Bytes durch. `CoreClient` und der Sync reden so mit `http://127.0.0.1:<Port>`, ohne die Netzschicht zu kennen.

/// Eine Verbindung des Weiterleiters. Hält die lokale Seite und holt über `open` den Weg zum Mac.
///
/// **Kein Byte vor dem Handshake (Plan §5.3, Punkt 6):** Von der lokalen Verbindung wird erst gelesen, wenn `open` einen
/// beglaubigten Weg geliefert hat. Scheitert `open`, schließt die Sitzung die lokale Verbindung, ohne je gelesen zu
/// haben. Das Token (im Header der Anfrage) liegt bis dahin ungelesen im Puffer des Systems.
///
/// Danach reicht sie Bytes in beide Richtungen durch, ohne etwas zu lesen oder zu ändern. Gegendruck: je Richtung
/// höchstens ein ausstehender Block von 64 KiB; der nächste wird erst gelesen, wenn der vorige übernommen ist.
/// Endet eine Seite oder scheitert ein Schreiben, schließen beide Seiten gemeinsam.
///
/// Der Zustand wird nur auf `queue` angefasst. `@unchecked Sendable`, weil die Rückrufe der Ströme von beliebigen
/// Warteschlangen kommen und hier zuerst auf `queue` wechseln.
final class ForwardSession: @unchecked Sendable {
    static let bufferBytes = 64 * 1024

    private let local: any TunnelChannel
    private let queue: DispatchQueue
    private let open: @Sendable () async -> (any TunnelChannel)?
    private var remote: (any TunnelChannel)?
    private var closed = false
    private var onClosed: (@Sendable (ForwardSession) -> Void)?

    init(
        local: any TunnelChannel,
        queue: DispatchQueue,
        open: @escaping @Sendable () async -> (any TunnelChannel)?,
        onClosed: @escaping @Sendable (ForwardSession) -> Void
    ) {
        self.local = local
        self.queue = queue
        self.open = open
        self.onClosed = onClosed
    }

    /// Holt den Weg zum Mac. Bis er da ist, wird von der lokalen Verbindung nichts gelesen.
    func start() {
        let open = self.open
        _Concurrency.Task {
            let channel = await open()
            self.queue.async {
                self.attach(channel)
            }
        }
    }

    /// Schließt die Sitzung von außen (Weiterleiter wird beendet)
    func cancel() {
        queue.async {
            self.close()
        }
    }

    private func attach(_ channel: (any TunnelChannel)?) {
        if closed {
            channel?.close()
            return
        }
        guard let channel else {
            // Kein beglaubigter Weg: lokale Verbindung zu. Die `URLSession` sieht einen Verbindungsabbruch und
            // versucht es später neu (Plan §5.3, Punkt 7). Es wurde nichts gelesen.
            close()
            return
        }
        remote = channel
        pump(from: local, to: channel)
        pump(from: channel, to: local)
    }

    private func close() {
        guard !closed else { return }
        closed = true
        local.close()
        remote?.close()
        remote = nil
        let callback = onClosed
        onClosed = nil
        callback?(self)
    }

    private func pump(from source: any TunnelChannel, to target: any TunnelChannel) {
        source.receive(maximum: ForwardSession.bufferBytes) { data, ended in
            self.queue.async {
                if self.closed { return }
                if let data, !data.isEmpty {
                    target.send(data) { sent in
                        self.queue.async {
                            if self.closed { return }
                            if !sent || ended {
                                self.close()
                            } else {
                                self.pump(from: source, to: target)
                            }
                        }
                    }
                } else if ended {
                    self.close()
                } else {
                    self.pump(from: source, to: target)
                }
            }
        }
    }
}

/// Der Weiterleiter für `MacRoute`. Eigenes Protokoll, damit Tests ohne Netz laufen.
@MainActor
protocol LocalForwarding: AnyObject {
    /// Port des Listeners auf Loopback, `nil`, solange er nicht läuft
    var port: UInt16? { get }
    /// Startet den Listener. `open` holt je Verbindung den Weg zum Mac. `ready` meldet den Port (oder `nil`, wenn der
    /// Listener nicht starten konnte).
    func start(open: @escaping @Sendable () async -> (any TunnelChannel)?, ready: @escaping @MainActor @Sendable (UInt16?) -> Void)
    /// Beendet den Listener und alle Verbindungen
    func stop()
}

/// Der echte Weiterleiter: `NWListener` nur auf Loopback, zufälliger Port. Nimmt nur Verbindungen von Loopback an.
@MainActor
final class LocalForwarder: LocalForwarding {
    /// So viele Verbindungen gleichzeitig. `URLSession` hält nur wenige offen; mehr wären ein Fehler oder ein Angriff.
    static let maxSessions = 24

    private(set) var port: UInt16?

    private var listener: NWListener?
    private var openChannel: (@Sendable () async -> (any TunnelChannel)?)?
    private var sessions: [ObjectIdentifier: ForwardSession] = [:]

    init() {}

    func start(open: @escaping @Sendable () async -> (any TunnelChannel)?, ready: @escaping @MainActor @Sendable (UInt16?) -> Void) {
        guard listener == nil else { return }
        openChannel = open
        let parameters = NWParameters.tcp
        // Nur Loopback: weder WLAN noch peer-to-peer noch ein anderes Gerät erreicht den Listener
        parameters.requiredInterfaceType = .loopback
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        parameters.includePeerToPeer = false
        let created: NWListener
        do {
            created = try NWListener(using: parameters)
        } catch {
            openChannel = nil
            ready(nil)
            return
        }
        created.newConnectionHandler = { [weak self] connection in
            MainActor.assumeIsolated {
                self?.accept(connection)
            }
        }
        created.stateUpdateHandler = { [weak self] state in
            MainActor.assumeIsolated {
                guard let self else { return }
                switch state {
                case .ready:
                    let value = self.listener?.port?.rawValue
                    self.port = value
                    ready(value)
                case .failed:
                    // Erst melden, dann aufräumen: Die Wegewahl bricht beim Verlust des Ports alle Anfragen ab
                    // (Issue #282)
                    ready(nil)
                    self.stop()
                default:
                    break
                }
            }
        }
        listener = created
        // Die Rückrufe kommen auf der Hauptwarteschlange, also auf dem MainActor (wie bei `MacBrowser`)
        created.start(queue: .main)
    }

    func stop() {
        listener?.stateUpdateHandler = nil
        listener?.newConnectionHandler = nil
        listener?.cancel()
        listener = nil
        port = nil
        openChannel = nil
        let running = sessions.values
        sessions = [:]
        for session in running {
            session.cancel()
        }
    }

    private func accept(_ connection: NWConnection) {
        guard listener != nil, let open = openChannel, sessions.count < LocalForwarder.maxSessions,
            LocalForwarder.isLoopback(connection.endpoint)
        else {
            connection.cancel()
            return
        }
        let queue = DispatchQueue(label: "de.studiengehirn.ipad.tunnel.forward")
        connection.start(queue: queue)
        let session = ForwardSession(
            local: NetworkStream(connection: connection), queue: queue, open: open,
            onClosed: { [weak self] ended in
                _Concurrency.Task { @MainActor in
                    self?.sessionEnded(ended)
                }
            })
        sessions[ObjectIdentifier(session)] = session
        session.start()
    }

    private func sessionEnded(_ session: ForwardSession) {
        sessions[ObjectIdentifier(session)] = nil
    }

    /// Kommt die Verbindung von Loopback? Zweite Sicherung neben `requiredInterfaceType`.
    nonisolated static func isLoopback(_ endpoint: NWEndpoint) -> Bool {
        guard case let .hostPort(host, _) = endpoint else { return false }
        switch host {
        case .ipv4(let address): return address.isLoopback
        case .ipv6(let address): return address.isLoopback
        case .name: return false
        @unknown default: return false
        }
    }
}
