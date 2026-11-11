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

    let pairing: PairingController

    private let client: CoreClient
    private let tokenStore: any TokenStore
    private let macStore: any PairedMacStore

    init(
        client: CoreClient,
        tokenStore: any TokenStore,
        macStore: any PairedMacStore,
        deviceName: String,
        appVersion: String?
    ) {
        self.client = client
        self.tokenStore = tokenStore
        self.macStore = macStore
        self.pairing = PairingController(
            client: client,
            tokenStore: tokenStore,
            macStore: macStore,
            deviceName: deviceName,
            appVersion: appVersion
        )
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
    }

    /// Nach einem 401 ist das Token endgültig ungültig. Weitere Abfragen bringen nichts,
    /// bis neu gekoppelt ist (`reload()` setzt den Status zurück).
    var isPollingPaused: Bool { connection == .disconnected(.tokenInvalid) }

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
            result = .connected
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
