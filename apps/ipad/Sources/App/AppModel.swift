import Foundation
import Observation

/// Verbindung zum Mac, wie sie die Statusanzeige zeigt
enum ConnectionStatus: Equatable, Sendable {
    case unknown
    case checking
    case connected
    /// Getrennt, mit konkreter Ursache
    case disconnected(ConnectionError)
}

/// Was das Abzeichen „Mac ●“ und die Verbindungsdetails zeigen (UX-48). Grün ist nur der laufende Sync:
/// Antwortet der Mac, der Sync aber nicht, steht das ehrlich da.
enum BadgeState: Equatable, Sendable {
    case checking
    /// Der Tunnel sucht den Mac (erste Sekunden, UX-12 PR 4): „Suche deinen Mac …“
    case searching
    /// Der Sync ist online
    case online
    /// `/health` antwortet, der Sync verbindet noch oder wartet
    case macReachable
    /// Der Mac spricht ein anderes Protokoll
    case appOutdated
    case disconnected(ConnectionError)

    /// - Parameters:
    ///   - connection: Ergebnis der Abfrage von `/health`
    ///   - syncState: Zustand des Sync, `nil` ohne Engine (dann gilt allein die Abfrage)
    ///   - route: Zustand der Wegewahl (UX-12 PR 4), `nil` ohne Tunnel. Ein Problem der Wegewahl (Schlüssel fehlt, Mac
    ///     nicht gefunden …) geht der Abfrage von `/health` vor, denn ohne Weiterleiter gibt es keine Abfrage.
    static func resolve(
        connection: ConnectionStatus, syncState: SyncEngine.State?, route: RouteState? = nil
    ) -> BadgeState {
        if connection == .disconnected(.tokenInvalid) || syncState == .tokenInvalid {
            return .disconnected(.tokenInvalid)
        }
        if syncState == .unsupported { return .appOutdated }
        if syncState == .online { return .online }
        if case .down(let problem)? = route { return .disconnected(problem.connectionError) }
        if route == .connecting, connection == .unknown || connection == .checking { return .searching }
        switch connection {
        case .unknown, .checking:
            return .checking
        case .connected:
            return syncState == nil ? .online : .macReachable
        case .disconnected(let error):
            return error == .appOutdated ? .appOutdated : .disconnected(error)
        }
    }

    /// Nur der laufende Sync färbt das Abzeichen grün
    var isGreen: Bool { self == .online }

    var headline: String {
        switch self {
        case .checking: return "Prüfe Verbindung …"
        case .searching: return RouteTexts.searching
        case .online: return "Mit dem Mac verbunden"
        case .macReachable: return "Mac erreichbar, Sync verbindet …"
        case .appOutdated: return ConnectionError.appOutdated.title
        // Ruhig, ohne „nicht verbunden“: Das iPad ist nur gerade woanders oder braucht einen Handgriff (UX-12)
        case .disconnected(let error) where error.isCalm: return error.title
        case .disconnected(let error): return "iPad nicht verbunden: \(error.title)"
        }
    }

    var detail: String? {
        switch self {
        case .appOutdated: return ConnectionError.appOutdated.advice
        case .disconnected(let error): return error.advice
        case .checking, .searching, .online, .macReachable: return nil
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .online: return "Mac verbunden"
        case .macReachable: return "Mac erreichbar, Sync verbindet"
        case .appOutdated: return "App passt nicht mehr zum Mac"
        case .checking, .searching, .disconnected: return "iPad nicht verbunden"
        }
    }
}

/// Zustand der ganzen App: gekoppelt oder nicht, verbunden oder nicht.
/// Spätere Bausteine (Notizbücher, Sync) hängen sich hier ein.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable, Sendable {
        case unpaired
        case paired(PairedMac)
    }

    private(set) var phase: Phase = .unpaired
    private(set) var connection: ConnectionStatus = .unknown

    /// Zustand des Abzeichens aus Abfrage und Sync (UX-48)
    var badgeState: BadgeState {
        BadgeState.resolve(connection: connection, syncState: sync?.state, route: routing?.state)
    }

    /// Zustand der Wegewahl zum Mac, `nil` ohne Tunnel (Tests ohne Netz)
    var routeState: RouteState? { routing?.state }

    let pairing: PairingController
    /// Live-Sync mit dem Mac (T1-14). `nil` in Tests ohne Netz.
    let sync: SyncEngine?
    /// Bibliothek der Notizbücher (T1-11 Rest). `nil` in Tests ohne Netz.
    let library: InkLibraryService?

    /// Wegewahl zum Mac (UX-12 PR 4): die einzige Quelle für die Adresse, an die Anfragen mit Token gehen. `nil` in
    /// Tests ohne Netz.
    let routing: (any MacRouting)?

    private let client: CoreClient
    private let tokenStore: any TokenStore
    private let tunnelKeyStore: any TunnelKeyStore
    private let macStore: any PairedMacStore

    init(
        client: CoreClient,
        tokenStore: any TokenStore,
        macStore: any PairedMacStore,
        deviceName: String,
        appVersion: String?,
        sync: SyncEngine? = nil,
        library: InkLibraryService? = nil,
        tunnelKeyStore: any TunnelKeyStore = NoTunnelKeyStore(),
        routing: (any MacRouting)? = nil
    ) {
        self.client = client
        self.sync = sync
        self.library = library
        self.routing = routing
        self.tokenStore = tokenStore
        self.tunnelKeyStore = tunnelKeyStore
        self.macStore = macStore
        self.pairing = PairingController(
            client: client,
            tokenStore: tokenStore,
            macStore: macStore,
            deviceName: deviceName,
            appVersion: appVersion,
            tunnelKeyStore: tunnelKeyStore
        )
        sync?.onStateChange = { [weak self] state in
            self?.syncStateChanged(state)
        }
        routing?.onChange = { [weak self] in
            // Neuer Port oder neuer Zustand des Weiterleiters: Wartet der Sync, verbindet er sofort neu
            self?.sync?.routeChanged()
        }
        reload()
        pairing.onPaired = { [weak self] in
            self?.reload()
        }
    }

    /// Liest den gespeicherten Stand. Gekoppelt ist das iPad nur mit Adresse UND Token.
    func reload() {
        let token = try? tokenStore.loadToken()
        if let mac = macStore.loadPairedMac(), token != nil {
            phase = .paired(mac)
        } else {
            phase = .unpaired
        }
        connection = .unknown
        // Die Wegewahl läuft, solange das iPad gekoppelt ist (und die App im Vordergrund ist)
        if case .paired = phase {
            routing?.setPaired(true)
        } else {
            routing?.setPaired(false)
        }
        // Der Sync läuft, solange das iPad gekoppelt ist
        if case .paired(let mac) = phase {
            sync?.start(mac: mac)
        } else {
            sync?.stop()
        }
    }

    /// Der Verbindungsstatus folgt der Engine: online heißt verbunden, ein widerrufenes Token heißt neu koppeln.
    /// Alles andere klärt die Abfrage von `/health`.
    private func syncStateChanged(_ state: SyncEngine.State) {
        // „Lief zuletzt · Stand …“ nennt den Moment, in dem die Verbindung abriss (UX-57)
        library?.syncOnlineChanged(state == .online)
        guard case .paired = phase else { return }
        switch state {
        case .online:
            connection = .connected
        case .tokenInvalid:
            connection = .disconnected(.tokenInvalid)
        case .unsupported:
            connection = .disconnected(.appOutdated)
        default:
            // Nach einem Protokollfehler klärt die nächste Abfrage von `/health` den Stand neu
            if connection == .disconnected(.appOutdated) { connection = .unknown }
        }
    }

    /// Nach einem 401 ist das Token endgültig ungültig. Weitere Abfragen bringen nichts,
    /// bis neu gekoppelt ist (`reload()` setzt den Status zurück).
    /// Solange der Sync online ist, weiß die App ohnehin, dass der Mac antwortet.
    var isPollingPaused: Bool {
        connection == .disconnected(.tokenInvalid) || sync?.state == .online
    }

    /// Regelmäßige Abfrage vom Startbildschirm. Ruht, solange das Token ungültig ist.
    func pollConnection() async {
        guard !isPollingPaused else { return }
        await checkConnection()
    }

    /// Fragt den Core einmal an. Ein 401 heißt: Kopplung widerrufen, neu koppeln anbieten.
    func checkConnection() async {
        guard case .paired(let mac) = phase else { return }
        guard let token = try? tokenStore.loadToken() else {
            reload()
            return
        }
        // Anfragen mit Token gehen nur an den lokalen Weiterleiter (UX-12 PR 4, E7). Läuft er nicht (Schlüssel fehlt,
        // Hintergrund, noch nicht bereit), geht nichts raus; der Grund steht in der Wegewahl.
        guard let endpoint = client.tokenEndpoint(for: mac) else {
            if let routing {
                switch routing.state {
                case .down(let problem): connection = .disconnected(problem.connectionError)
                case .idle, .connecting, .up: if connection == .unknown { connection = .checking }
                }
            }
            return
        }
        if connection == .unknown {
            connection = .checking
        }
        let result: ConnectionStatus
        do {
            try await client.checkHealth(endpoint: endpoint, token: token)
            // Der Mac antwortet, die App passt aber nicht dazu: kein „verbunden“
            result = sync?.state == .unsupported ? .disconnected(.appOutdated) : .connected
        } catch {
            result = .disconnected(ConnectionError.wrap(error))
        }
        // Inzwischen entkoppelt?
        guard phase == .paired(mac) else { return }
        connection = result
    }

    /// Kopplung aufheben: am Mac abmelden (so gut es geht), Token und Adresse löschen
    func unpair() async {
        guard case .paired(let mac) = phase else { return }
        // Die Warteschlange bleibt auf dem iPad, nur die Verbindung endet
        sync?.stop()
        if let token = try? tokenStore.loadToken(), let endpoint = client.tokenEndpoint(for: mac) {
            // Ist der Mac nicht erreichbar oder das Token schon widerrufen, bleibt nur das lokale Löschen. Auch das
            // geht durch den Tunnel; ohne Weiterleiter (z. B. Schlüssel fehlt) geht nichts raus.
            try? await client.removeDevice(endpoint: endpoint, deviceID: mac.deviceID, token: token)
        }
        try? tokenStore.deleteToken()
        // Der Tunnel-Schlüssel geht mit dem Token (der Mac kündigt den Dienst weiter an, bis das Gerät dort entfernt
        // ist; ohne Schlüssel kommt niemand durch)
        try? tunnelKeyStore.deleteKey()
        macStore.clearPairedMac()
        pairing.cancel()
        reload()
    }

    // MARK: Vordergrund und Hintergrund (UX-12 PR 4)

    /// Die App kommt in den Vordergrund: Die Wegewahl startet den Weiterleiter (neuer Port), WLAN gilt wieder zuerst
    func appBecameActive() {
        routing?.appBecameActive()
        sync?.kick()
    }

    /// Die App geht in den Hintergrund: Weiterleiter und Verbindungen enden
    func appWentToBackground() {
        routing?.appWentToBackground()
    }
}
