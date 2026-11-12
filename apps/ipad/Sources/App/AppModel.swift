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
    static func resolve(connection: ConnectionStatus, syncState: SyncEngine.State?) -> BadgeState {
        if connection == .disconnected(.tokenInvalid) { return .disconnected(.tokenInvalid) }
        if syncState == .unsupported { return .appOutdated }
        if syncState == .online { return .online }
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
        case .online: return "Mit dem Mac verbunden"
        case .macReachable: return "Mac erreichbar, Sync verbindet …"
        case .appOutdated: return ConnectionError.appOutdated.title
        case .disconnected(let error): return "iPad nicht verbunden: \(error.title)"
        }
    }

    var detail: String? {
        switch self {
        case .appOutdated: return ConnectionError.appOutdated.advice
        case .disconnected(let error): return error.advice
        case .checking, .online, .macReachable: return nil
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .online: return "Mac verbunden"
        case .macReachable: return "Mac erreichbar, Sync verbindet"
        case .appOutdated: return "App passt nicht mehr zum Mac"
        case .checking, .disconnected: return "iPad nicht verbunden"
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
        BadgeState.resolve(connection: connection, syncState: sync?.state)
    }

    let pairing: PairingController
    /// Live-Sync mit dem Mac (T1-14). `nil` in Tests ohne Netz.
    let sync: SyncEngine?
    /// Bibliothek der Notizbücher (T1-11 Rest). `nil` in Tests ohne Netz.
    let library: InkLibraryService?

    private let client: CoreClient
    private let tokenStore: any TokenStore
    private let macStore: any PairedMacStore

    init(
        client: CoreClient,
        tokenStore: any TokenStore,
        macStore: any PairedMacStore,
        deviceName: String,
        appVersion: String?,
        sync: SyncEngine? = nil,
        library: InkLibraryService? = nil
    ) {
        self.client = client
        self.sync = sync
        self.library = library
        self.tokenStore = tokenStore
        self.macStore = macStore
        self.pairing = PairingController(
            client: client,
            tokenStore: tokenStore,
            macStore: macStore,
            deviceName: deviceName,
            appVersion: appVersion
        )
        sync?.onStateChange = { [weak self] state in
            self?.syncStateChanged(state)
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
        if connection == .unknown {
            connection = .checking
        }
        let result: ConnectionStatus
        do {
            try await client.checkHealth(endpoint: mac.endpoint, token: token)
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
        if let token = try? tokenStore.loadToken() {
            // Ist der Mac nicht erreichbar oder das Token schon widerrufen, bleibt nur das lokale Löschen
            try? await client.removeDevice(endpoint: mac.endpoint, deviceID: mac.deviceID, token: token)
        }
        try? tokenStore.deleteToken()
        macStore.clearPairedMac()
        pairing.cancel()
        reload()
    }
}
