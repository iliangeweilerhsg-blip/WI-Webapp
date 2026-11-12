import Foundation
@preconcurrency import Network
import TunnelShared

/// Der Listener eines gekoppelten Geräts (Plan E4: ein Listener je Gerät, Dienstname aus dem Tunnel-Schlüssel).
///
/// - TLS 1.2 mit PSK, nur die Verfahren aus E12, `includePeerToPeer` nach Einstellung.
/// - **Kein Byte ohne gültigen Handshake:** Eine angenommene Verbindung gilt als „im Handshake“ und wird nicht gelesen.
///   Erst wenn Network.framework `.ready` meldet **und** das ausgehandelte Verfahren zulässig ist, entsteht eine
///   `TunnelBridge` (und mit ihr die Verbindung zum Core).
/// - Grenzen (Plan §5.2, Punkt 6): Handshake höchstens 5 s, höchstens 8 offene Handshakes (die neunte verdrängt die
///   älteste), nach dem Handshake höchstens 32 Verbindungen.
///
/// Alles läuft auf der Queue des Helfers; nichts hier ist threadsicher und muss es nicht sein.
final class TunnelDeviceListener {
    private final class PendingHandshake {
        let connection: NWConnection
        var finished = false
        init(_ connection: NWConnection) { self.connection = connection }
    }

    struct Hooks {
        var now: () -> Date
        var log: (String) -> Void
        /// Ein Handshake ist gescheitert (verdrängt, Zeitüberschreitung, falscher Schlüssel, falsches Verfahren)
        var handshakeFailed: () -> Void
        /// Etwas Sichtbares im Zustand hat sich geändert
        var changed: () -> Void
        /// Der Core hat auf eine Weiterleitung nicht geantwortet
        var upstreamFailed: () -> Void
    }

    let device: TunnelDevice
    private let socketPath: String
    private let peerToPeer: Bool
    private let advertise: Bool
    private let queue: DispatchQueue
    private let hooks: Hooks

    private var listener: NWListener?
    private var pending: [PendingHandshake] = []
    private var bridges: [ObjectIdentifier: TunnelBridge] = [:]
    private var stopped = false

    private(set) var state = "starting"
    private(set) var advertisedName: String?
    private(set) var failedAt: Date?
    private(set) var handshakesFailed = 0
    private(set) var refusedOverLimit = 0

    init(
        device: TunnelDevice, socketPath: String, peerToPeer: Bool, advertise: Bool, queue: DispatchQueue, hooks: Hooks
    ) {
        self.device = device
        self.socketPath = socketPath
        self.peerToPeer = peerToPeer
        self.advertise = advertise
        self.queue = queue
        self.hooks = hooks
    }

    var isFailed: Bool { state == "failed" }

    /// Port des Listeners, sobald er bereit ist (Tests). Vor `.ready` meldet `NWListener.port` schon `0` (beliebig);
    /// ein Client dorthin scheitert mit EADDRNOTAVAIL. Darum erst ab `.ready` und nie `0`.
    var port: UInt16? {
        guard state == "ready", let raw = listener?.port?.rawValue, raw != 0 else { return nil }
        return raw
    }

    var snapshot: TunnelListenerState {
        TunnelListenerState(
            service_name: device.serviceName, advertised_name: advertisedName, state: state,
            connections: bridges.count, handshakes_pending: pending.count, handshakes_failed: handshakesFailed)
    }

    /// Zähler der offenen Verbindungen (Tests des Gegendrucks)
    var bridgeCounters: [TunnelBridge.Counters] { bridges.values.map { $0.counters } }

    func start() throws {
        let parameters = TunnelTLS.parameters(presharedKey: device.presharedKey, peerToPeer: peerToPeer)
        let listener = try NWListener(using: parameters)
        if advertise {
            listener.service = NWListener.Service(name: device.serviceName, type: TunnelConstants.serviceType)
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listener.serviceRegistrationUpdateHandler = { [weak self] change in
            guard let self, !self.stopped else { return }
            if case .add(let endpoint) = change, case .service(let name, _, _, _) = endpoint {
                self.advertisedName = name
                self.hooks.changed()
            }
        }
        listener.stateUpdateHandler = { [weak self] newState in
            guard let self, !self.stopped else { return }
            switch newState {
            case .ready:
                self.state = "ready"
            case .waiting(let error):
                self.state = "waiting"
                self.hooks.log("Listener \(self.device.serviceName) wartet: \(error)")
            case .failed(let error):
                self.state = "failed"
                self.failedAt = self.hooks.now()
                self.hooks.log("Listener \(self.device.serviceName) ausgefallen: \(error)")
                self.listener?.cancel()
            default:
                return
            }
            self.hooks.changed()
        }
        self.listener = listener
        listener.start(queue: queue)
    }

    func stop() {
        stopped = true
        listener?.stateUpdateHandler = nil
        listener?.newConnectionHandler = nil
        listener?.serviceRegistrationUpdateHandler = nil
        listener?.cancel()
        listener = nil
        for item in pending {
            item.finished = true
            item.connection.stateUpdateHandler = nil
            item.connection.cancel()
        }
        pending.removeAll()
        for bridge in Array(bridges.values) { bridge.close() }
        bridges.removeAll()
    }

    // MARK: Verbindungen

    private func accept(_ connection: NWConnection) {
        guard !stopped else {
            connection.cancel()
            return
        }
        // Die neunte offene Verbindung im Handshake verdrängt die älteste (Plan §5.2, Punkt 6)
        while pending.count >= TunnelLimits.maxPendingHandshakes, let oldest = pending.first {
            failPending(oldest)
        }
        let item = PendingHandshake(connection)
        pending.append(item)
        connection.stateUpdateHandler = { [weak self, weak item] state in
            guard let self, let item else { return }
            switch state {
            case .ready:
                self.handshakeFinished(item)
            case .failed, .cancelled:
                self.failPending(item)
            default:
                break
            }
        }
        // Nichts wird gelesen, bevor `.ready` gemeldet ist. Die Frist zählt ab der Annahme.
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + TunnelLimits.handshakeSeconds) { [weak self, weak item] in
            guard let self, let item, !item.finished else { return }
            self.failPending(item)
        }
        hooks.changed()
    }

    private func failPending(_ item: PendingHandshake) {
        guard !item.finished else { return }
        item.finished = true
        pending.removeAll { $0 === item }
        item.connection.stateUpdateHandler = nil
        item.connection.cancel()
        handshakesFailed += 1
        hooks.handshakeFailed()
        hooks.changed()
    }

    private func handshakeFinished(_ item: PendingHandshake) {
        guard !item.finished else { return }
        item.finished = true
        pending.removeAll { $0 === item }
        let connection = item.connection
        connection.stateUpdateHandler = nil
        // Beide Seiten prüfen das ausgehandelte Verfahren (Plan E12). Ohne passendes Verfahren: sofort zu.
        let negotiated = TunnelTLS.negotiated(on: connection)
        guard let negotiated, negotiated.isAllowed else {
            // Nennt nur Version und Verfahren (öffentlich im Handshake), nie Schlüssel oder Adressen
            hooks.log("Verbindung abgewiesen: TLS-Verfahren nicht zulässig (\(negotiated?.text ?? "unbekannt"))")
            connection.cancel()
            handshakesFailed += 1
            hooks.handshakeFailed()
            hooks.changed()
            return
        }
        guard bridges.count < TunnelLimits.maxConnectionsPerDevice else {
            refusedOverLimit += 1
            connection.cancel()
            hooks.changed()
            return
        }
        let bridge = TunnelBridge(client: connection, socketPath: socketPath, queue: queue)
        bridge.onClosed = { [weak self] closed in
            self?.bridges.removeValue(forKey: ObjectIdentifier(closed))
            self?.hooks.changed()
        }
        bridge.onUpstreamFailed = { [weak self] in
            self?.hooks.upstreamFailed()
        }
        bridges[ObjectIdentifier(bridge)] = bridge
        bridge.start()
        hooks.changed()
    }
}
