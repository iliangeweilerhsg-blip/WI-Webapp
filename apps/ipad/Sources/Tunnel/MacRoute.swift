import Foundation
import Observation

// Wegewahl zum Mac (UX-12, PR 4; Plan E5, E7, §5.3, §5.4).
// `MacRoute` ist die **einzige Quelle** für die Adresse, an die Anfragen mit Token gehen: der Loopback-Weiterleiter.
// Hier steht bewusst nirgends `Task` allein: Schemas.swift verdeckt diesen Namen im App-Modul.

/// Über welchen Weg die Verbindung zum Mac läuft
enum RouteKind: Equatable, Sendable {
    /// Gemeinsames WLAN
    case sharedWifi
    /// Wi-Fi peer-to-peer, ohne gemeinsames Netz
    case direct
}

enum RouteProblem: Equatable, Sendable {
    /// WLAN am iPad aus: auch peer-to-peer geht dann nicht
    case wifiOff
    /// Dienst nirgends zu sehen
    case macNotFound
    /// Dienst da, Schlüssel passt nicht (erst nach dreimal Scheitern aller Kandidaten)
    case handshakeFailed
    case localNetworkDenied
    /// Gekoppelt, aber ohne `tunnel_key` (vor UX-12 gekoppelt): einmal neu koppeln. Es geht kein Byte raus.
    case repairNeeded

    /// Der Fehler, den Anzeige und Statusabzeichen zeigen
    var connectionError: ConnectionError {
        switch self {
        case .wifiOff: return .wifiSwitchedOff
        case .macNotFound: return .tunnelMacNotFound
        case .handshakeFailed: return .tunnelHandshakeFailed
        case .localNetworkDenied: return .localNetworkDenied
        case .repairNeeded: return .tunnelKeyMissing
        }
    }
}

enum RouteState: Equatable, Sendable {
    /// Nicht gekoppelt oder App im Hintergrund
    case idle
    /// Sucht den Mac
    case connecting
    /// Mindestens ein Handshake gelungen
    case up(RouteKind)
    /// Sucht leise weiter
    case down(RouteProblem)
}

/// Texte der Wegewahl. Reine Funktionen, damit sie testbar sind. Kein Zustand öffnet einen Dialog (R1).
enum RouteTexts {
    /// Überschrift während der ersten Suche (Plan §5.4)
    static let searching = "Suche deinen Mac …"

    /// Die Zeile in den Verbindungsdetails (F4). Nur bei stehender Verbindung; sonst `nil`.
    static func pathLine(_ state: RouteState) -> String? {
        guard case .up(let kind) = state else { return nil }
        switch kind {
        case .sharedWifi: return "Verbunden über das WLAN"
        case .direct: return "Direkt verbunden, ohne WLAN-Netz"
        }
    }
}

/// Die Wegewahl, wie die übrigen Bausteine sie sehen
@MainActor
protocol MacRouting: AnyObject {
    var state: RouteState { get }
    /// Adresse des lokalen Weiterleiters. `nil`, solange er nicht läuft. **Nur hierhin gehen Anfragen mit Token.**
    func endpoint() -> CoreEndpoint?
    /// Gekoppelt oder nicht (der Aufrufer liest Token und Adresse). Lädt den Tunnel-Schlüssel neu.
    func setPaired(_ paired: Bool)
    func appBecameActive()
    func appWentToBackground()
    /// Der Weiterleiter ist (un)erreichbar geworden, der Zustand hat sich geändert oder der Port ist neu
    var onChange: (@MainActor () -> Void)? { get set }
}

extension MacRouting {
    /// Warum gerade keine Anfrage mit Token rausgeht, als Fehler für Aufrufer
    func blockedError() -> ConnectionError {
        if case .down(let problem) = state { return problem.connectionError }
        return .tunnelMacNotFound
    }
}

/// Zustandsautomat der Wegewahl (E5):
/// - Je neuer Verbindung des Weiterleiters: erst gemeinsames WLAN (2 s), dann peer-to-peer (10 s).
/// - **Merken:** Der zuletzt erfolgreiche Weg wird zuerst versucht, im Hörsaal entfällt so die Wartezeit von 2 s.
/// - **Zurücksetzen** (WLAN zuerst) nur bei Netzwechsel und wenn die App in den Vordergrund kommt. Kein Zeitgeber,
///   kein Umschalten im Betrieb.
/// - Bestehende Verbindungen wandern nie: Hier entsteht nur der Weg für **neue** Verbindungen.
/// - Fehlt der Tunnel-Schlüssel, geht nichts raus (`repairNeeded`): kein Weiterleiter, kein Dial, kein Byte. Es wird
///   nie ein Schlüssel aus Token oder `token_hash` abgeleitet.
@MainActor
@Observable
final class MacRoute: MacRouting {
    static let wifiSeconds: TimeInterval = 2
    static let directSeconds: TimeInterval = 10
    /// So lange zeigt die Anzeige „Suche deinen Mac …“, bevor sie „Mac nicht gefunden“ sagt
    static let searchingSeconds: TimeInterval = 15
    /// So oft müssen alle Kandidaten hintereinander scheitern, bevor „falscher Schlüssel“ erscheint (Plan §5.4)
    static let handshakeFailuresBeforeText = 3
    /// So kurz nach einem gescheiterten Suchlauf teilen wartende Verbindungen dessen Ergebnis, statt selbst zu suchen
    static let sharedFailureSeconds: TimeInterval = 3

    private(set) var state: RouteState = .idle
    @ObservationIgnored var onChange: (@MainActor () -> Void)?

    /// Der zuletzt erfolgreiche Weg. `nil` = unbekannt, dann gilt WLAN zuerst.
    @ObservationIgnored private(set) var rememberedStage: RouteKind?

    private let keys: any TunnelKeyStore
    private let dialer: any TunnelDialing
    private let paths: any NetworkPathWatching
    private let forwarder: any LocalForwarding
    private let now: @MainActor () -> Date

    @ObservationIgnored private var paired = false
    @ObservationIgnored private var isActive = true
    @ObservationIgnored private var key: TunnelKey?
    @ObservationIgnored private var keyServiceName: String?
    @ObservationIgnored private var forwarderPort: UInt16?
    @ObservationIgnored private var forwarderStarting = false
    @ObservationIgnored private var forwarderGeneration = 0
    /// Zählt hoch, wenn Schlüssel oder Aktivität wechseln: Ergebnisse alter Suchläufe werden verworfen
    @ObservationIgnored private var sessionGeneration = 0
    @ObservationIgnored private var searchingSince: Date?
    @ObservationIgnored private var handshakeFailures = 0
    /// Nummer des Suchlaufs, der gerade den Weg sucht, solange dieser unbekannt ist
    @ObservationIgnored private var activeProbe: Int?
    @ObservationIgnored private var probeCounter = 0
    @ObservationIgnored private var probeWaiters: [CheckedContinuation<Void, Never>] = []
    @ObservationIgnored private var lastProbeFailure: Date?

    init(
        keys: any TunnelKeyStore,
        dialer: any TunnelDialing,
        paths: any NetworkPathWatching,
        forwarder: any LocalForwarding,
        now: @escaping @MainActor () -> Date = { Date() }
    ) {
        self.keys = keys
        self.dialer = dialer
        self.paths = paths
        self.forwarder = forwarder
        self.now = now
    }

    // MARK: MacRouting

    func endpoint() -> CoreEndpoint? {
        guard wanted, key != nil, let port = forwarderPort else { return nil }
        return CoreEndpoint(host: "127.0.0.1", port: Int(port))
    }

    func setPaired(_ paired: Bool) {
        self.paired = paired
        reconcile()
    }

    func appBecameActive() {
        isActive = true
        // Zurück im Vordergrund: WLAN wieder zuerst (Plan §5.3, Punkt 3)
        rememberedStage = nil
        handshakeFailures = 0
        reconcile()
    }

    func appWentToBackground() {
        isActive = false
        reconcile()
    }

    /// Netzwechsel: nur den gemerkten Weg vergessen. Die Anzeige ändert sich nicht (kein Flattern).
    func networkPathChanged() {
        rememberedStage = nil
    }

    private var wanted: Bool { paired && isActive }

    // MARK: Zustand

    /// Bringt Weiterleiter, Pfadmonitor und Zustand in Einklang mit „gekoppelt“, „im Vordergrund“ und „Schlüssel da“
    private func reconcile() {
        guard wanted else {
            stopAll()
            setState(.idle)
            return
        }
        let loaded = Self.loadKey(from: keys)
        let newName = loaded?.serviceName
        if newName != keyServiceName {
            // Neue Kopplung oder Schlüssel weg: alles Gemerkte gilt nicht mehr, alte Suchläufe auch nicht
            keyServiceName = newName
            rememberedStage = nil
            handshakeFailures = 0
            lastProbeFailure = nil
            sessionGeneration += 1
            activeProbe = nil
            wakeProbeWaiters()
        }
        key = loaded
        guard loaded != nil else {
            // Kein Schlüssel: kein Weiterleiter, kein Suchlauf, kein Netzverkehr
            stopAll()
            setState(.down(.repairNeeded))
            return
        }
        startPathWatching()
        if forwarderPort == nil && !forwarderStarting {
            startForwarder()
        }
        switch state {
        case .idle, .down(.repairNeeded):
            searchingSince = now()
            setState(.connecting)
        default:
            break
        }
    }

    /// Liest und prüft den Schlüssel. Fehlt er oder hat er nicht das Format aus `PairResponse`, gibt es keinen.
    private static func loadKey(from store: any TunnelKeyStore) -> TunnelKey? {
        guard let text = try? store.loadKey() else { return nil }
        return try? TunnelKey(base64url: text)
    }

    private func setState(_ newState: RouteState) {
        guard state != newState else { return }
        state = newState
        onChange?()
    }

    private func startPathWatching() {
        paths.start { [weak self] in
            self?.networkPathChanged()
        }
    }

    private func startForwarder() {
        forwarderStarting = true
        forwarderGeneration += 1
        let generation = forwarderGeneration
        forwarder.start(
            open: { [weak self] in
                await self?.openChannel()
            },
            ready: { [weak self] port in
                self?.forwarderReady(port, generation: generation)
            })
    }

    private func forwarderReady(_ port: UInt16?, generation: Int) {
        guard generation == forwarderGeneration else { return }
        forwarderStarting = false
        guard wanted, key != nil else { return }
        forwarderPort = port
        if port == nil {
            // Der Listener konnte nicht starten. Beim nächsten Wechsel in den Vordergrund neuer Versuch.
            setState(.down(.macNotFound))
        }
        // Neuer Port: Der Sync verbindet neu
        onChange?()
    }

    private func stopAll() {
        forwarderGeneration += 1
        forwarderStarting = false
        forwarderPort = nil
        forwarder.stop()
        paths.stop()
        sessionGeneration += 1
        activeProbe = nil
        wakeProbeWaiters()
        keyServiceName = nil
        key = nil
        searchingSince = nil
        onChange?()
    }

    // MARK: Verbindungen für den Weiterleiter

    /// Holt einen beglaubigten Weg zum Mac für **eine** neue Verbindung des Weiterleiters. `nil`, wenn keiner zustande
    /// kam. Der Weiterleiter schließt dann die lokale Verbindung, ohne gelesen zu haben.
    func openChannel() async -> (any TunnelChannel)? {
        guard wanted, let key = self.key else { return nil }
        let generation = sessionGeneration

        // Solange der Weg unbekannt ist, sucht nur eine Verbindung. Die übrigen warten und nutzen dann das Ergebnis:
        // Im Hörsaal gibt es so genau einen WLAN-Versuch, nicht einen je Verbindung.
        var probe: Int?
        while rememberedStage == nil && activeProbe != nil {
            await waitForProbe()
            guard generation == sessionGeneration else { return nil }
            if rememberedStage == nil, let failedAt = lastProbeFailure,
                now().timeIntervalSince(failedAt) < Self.sharedFailureSeconds
            {
                return nil
            }
        }
        if rememberedStage == nil {
            probeCounter += 1
            probe = probeCounter
            activeProbe = probe
        }

        let order: [RouteKind] = rememberedStage == .direct ? [.direct, .sharedWifi] : [.sharedWifi, .direct]
        var sawHandshakeFailure = false
        var denied = false
        var result: (any TunnelChannel)?
        for stage in order {
            let outcome = await dialer.dial(
                key: key, peerToPeer: stage == .direct,
                timeout: stage == .direct ? Self.directSeconds : Self.wifiSeconds)
            guard generation == sessionGeneration else {
                if case .connected(let channel, _) = outcome { channel.close() }
                finishProbe(probe, failed: false)
                return nil
            }
            switch outcome {
            case .connected(let channel, let path):
                rememberedStage = stage
                handshakeFailures = 0
                setState(.up(Self.displayKind(stage: stage, path: path)))
                result = channel
            case .failed(let failure):
                switch failure {
                case .handshakeFailed: sawHandshakeFailure = true
                case .localNetworkDenied: denied = true
                case .notFound: break
                }
            }
            if result != nil || denied { break }
        }
        if let result {
            finishProbe(probe, failed: false)
            return result
        }
        recordFailure(sawHandshakeFailure: sawHandshakeFailure, denied: denied)
        finishProbe(probe, failed: true)
        return nil
    }

    /// Angezeigt wird, was die Verbindung tatsächlich ist. Stufe 1 (ohne peer-to-peer) ist immer das WLAN. In Stufe 2
    /// zählt der Pfad; erkennt er sich nicht, gilt „direkt“, denn Stufe 2 gibt es nur, wenn das WLAN nicht ging.
    static func displayKind(stage: RouteKind, path: TunnelPathKind) -> RouteKind {
        switch stage {
        case .sharedWifi: return .sharedWifi
        case .direct: return path == .wifi ? .sharedWifi : .direct
        }
    }

    private func recordFailure(sawHandshakeFailure: Bool, denied: Bool) {
        lastProbeFailure = now()
        if denied {
            setState(.down(.localNetworkDenied))
            return
        }
        if sawHandshakeFailure {
            handshakeFailures += 1
            // Erst nach mehreren gescheiterten Suchläufen sagen, dass der Schlüssel nicht passt (Jeder im Funk kann den
            // Namen nachsprechen). Bis dahin sucht die Anzeige weiter.
            if handshakeFailures >= Self.handshakeFailuresBeforeText {
                setState(.down(.handshakeFailed))
            }
            return
        }
        if case .connecting = state, let since = searchingSince, now().timeIntervalSince(since) < Self.searchingSeconds {
            return
        }
        setState(.down(paths.wifiLooksOff ? .wifiOff : .macNotFound))
    }

    /// Beendet den Suchlauf mit dieser Nummer. Ein veralteter Suchlauf (Schlüssel oder Vordergrund wechselten) lässt den
    /// neuen in Ruhe.
    private func finishProbe(_ probe: Int?, failed: Bool) {
        guard let probe, activeProbe == probe else { return }
        activeProbe = nil
        if !failed { lastProbeFailure = nil }
        wakeProbeWaiters()
    }

    private func waitForProbe() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            probeWaiters.append(continuation)
        }
    }

    private func wakeProbeWaiters() {
        let waiting = probeWaiters
        probeWaiters = []
        for continuation in waiting {
            continuation.resume()
        }
    }
}
