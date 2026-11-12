import Foundation
@preconcurrency import Network

/// Eine beglaubigte Verbindung: reicht Bytes zwischen dem TLS-Tunnel (iPad) und dem Unix-Socket des Core durch,
/// in beide Richtungen, ohne etwas zu lesen, zu ändern oder zu ergänzen (Plan §4, kein Bündeln, keine Header).
///
/// Wird erst **nach** einem gelungenen Handshake und der Prüfung des Verfahrens angelegt (Plan §5.2, Punkt 3). Bis dahin
/// gibt es weder eine Verbindung zum Core noch ein gelesenes Byte.
///
/// Alles läuft auf der Queue des Helfers (eine serielle Queue für Listener, Verbindungen und Zähler), darum gibt es keine
/// Sperren. Gegendruck: je Richtung höchstens ein ausstehender Block von 64 KiB. Der nächste wird erst gelesen,
/// wenn der vorige vom Ziel übernommen ist (`contentProcessed`). Liest der Core nicht, liest der Helfer nicht weiter.
final class TunnelBridge {
    enum Direction {
        case clientToCore
        case coreToClient
    }

    /// Zähler für Tests des Gegendrucks. Keine Nutzdaten.
    struct Counters: Equatable {
        var readFromClient = 0
        var writtenToCore = 0
        var readFromCore = 0
        var writtenToClient = 0

        /// Gelesen, aber vom Ziel noch nicht übernommen. Darf nie über den Puffer hinaus wachsen.
        var inFlightClientToCore: Int { readFromClient - writtenToCore }
        var inFlightCoreToClient: Int { readFromCore - writtenToClient }
    }

    private let client: NWConnection
    private let upstream: NWConnection
    private let queue: DispatchQueue
    private var closed = false
    private var upstreamReady = false
    private(set) var counters = Counters()

    /// Wird einmal gerufen, wenn die Verbindung zu ist (gleich aus welchem Grund)
    var onClosed: ((TunnelBridge) -> Void)?
    /// Die Verbindung zum Core ist gescheitert: Der Core steht womöglich nicht mehr (Probe vorziehen)
    var onUpstreamFailed: (() -> Void)?

    init(client: NWConnection, socketPath: String, queue: DispatchQueue) {
        self.client = client
        self.queue = queue
        self.upstream = NWConnection(to: .unix(path: socketPath), using: .tcp)
    }

    func start() {
        client.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled:
                self?.close()
            default:
                break
            }
        }
        upstream.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.upstreamReady = true
                self.pump(from: self.client, to: self.upstream, direction: .clientToCore)
                self.pump(from: self.upstream, to: self.client, direction: .coreToClient)
            case .failed, .waiting:
                // `waiting` heißt hier: Der Socket nimmt nichts an (Core weg). Warten bringt nichts.
                self.onUpstreamFailed?()
                self.close()
            case .cancelled:
                self.close()
            default:
                break
            }
        }
        upstream.start(queue: queue)
        queue.asyncAfter(deadline: .now() + TunnelLimits.upstreamConnectSeconds) { [weak self] in
            guard let self, !self.closed, !self.upstreamReady else { return }
            self.onUpstreamFailed?()
            self.close()
        }
    }

    func close() {
        guard !closed else { return }
        closed = true
        client.stateUpdateHandler = nil
        upstream.stateUpdateHandler = nil
        client.cancel()
        upstream.cancel()
        let callback = onClosed
        onClosed = nil
        onUpstreamFailed = nil
        callback?(self)
    }

    private func pump(from source: NWConnection, to target: NWConnection, direction: Direction) {
        source.receive(minimumIncompleteLength: 1, maximumLength: TunnelLimits.bufferBytes) {
            [weak self] data, _, isComplete, error in
            guard let self, !self.closed else { return }
            if let data, !data.isEmpty {
                self.count(direction, read: data.count)
                target.send(
                    content: data,
                    completion: .contentProcessed { [weak self] sendError in
                        guard let self, !self.closed else { return }
                        if sendError != nil {
                            self.close()
                            return
                        }
                        self.count(direction, written: data.count)
                        if isComplete || error != nil {
                            self.close()
                        } else {
                            self.pump(from: source, to: target, direction: direction)
                        }
                    })
            } else if isComplete || error != nil {
                // Ende des Stroms oder Fehler: beide Seiten gemeinsam schließen
                self.close()
            } else {
                self.pump(from: source, to: target, direction: direction)
            }
        }
    }

    private func count(_ direction: Direction, read: Int) {
        switch direction {
        case .clientToCore: counters.readFromClient += read
        case .coreToClient: counters.readFromCore += read
        }
    }

    private func count(_ direction: Direction, written: Int) {
        switch direction {
        case .clientToCore: counters.writtenToCore += written
        case .coreToClient: counters.writtenToClient += written
        }
    }
}
