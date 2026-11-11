import Foundation
import Observation

/// Zustände der Kopplung (VERTRAEGE §12)
enum PairingState: Equatable, Sendable {
    /// Mac wählen: QR-Code, Bonjour-Liste oder Adresse von Hand
    case idle
    /// `pair/start` läuft
    case requesting(CoreEndpoint)
    /// Anfrage steht am Mac, der Nutzer tippt den Code ein
    case awaitingCode(CoreEndpoint, pairingID: String)
    /// `pair/confirm` läuft
    case confirming(CoreEndpoint)
    /// Token liegt im Schlüsselbund
    case paired
}

/// Zustandsautomat der Kopplung.
///
/// Zwei Wege führen zum Token:
/// - QR-Code (empfohlen, §12 H-5): `pair(with:)` löst den Code direkt ein.
/// - Bonjour oder Adresse von Hand: `start(endpoint:)`, dann `submit(code:)`.
@MainActor
@Observable
final class PairingController {
    /// Nach so vielen falschen Codes weist der Core die Nonce ab (§12, Schritt 4)
    static let maxWrongCodes = 5

    private(set) var state: PairingState = .idle
    private(set) var lastError: ConnectionError?

    /// Wird nach erfolgreicher Kopplung aufgerufen
    @ObservationIgnored var onPaired: (() -> Void)?

    private let client: CoreClient
    private let tokenStore: any TokenStore
    private let macStore: any PairedMacStore
    private let deviceName: String
    private let appVersion: String?

    @ObservationIgnored private var nonce: String = PairingInput.makeNonce()
    @ObservationIgnored private var wrongCodes = 0

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
        self.deviceName = PairingInput.deviceName(deviceName)
        self.appVersion = appVersion
    }

    var isBusy: Bool {
        switch state {
        case .requesting, .confirming: return true
        case .idle, .awaitingCode, .paired: return false
        }
    }

    /// Bonjour-Weg und Eingabe von Hand: Anfrage am Mac anlegen
    func start(endpoint: CoreEndpoint) async {
        guard !isBusy else { return }
        lastError = nil
        beginAttempt()
        state = .requesting(endpoint)
        do {
            let pairingID = try await client.pairStart(endpoint: endpoint, deviceName: deviceName, nonce: nonce)
            // Inzwischen abgebrochen?
            guard state == .requesting(endpoint) else { return }
            state = .awaitingCode(endpoint, pairingID: pairingID)
        } catch {
            guard state == .requesting(endpoint) else { return }
            lastError = ConnectionError.wrap(error)
            state = .idle
        }
    }

    /// Code vom Mac eintippen und einlösen
    func submit(code rawCode: String) async {
        guard case let .awaitingCode(endpoint, pairingID) = state else { return }
        guard let code = PairingInput.normalizedCode(rawCode) else {
            lastError = .invalidCodeFormat
            return
        }
        await confirm(
            endpoint: endpoint,
            pairingID: pairingID,
            code: code,
            fallback: .awaitingCode(endpoint, pairingID: pairingID)
        )
    }

    /// QR-Weg: Adresse, Kennung und Code kommen aus dem QR-Code
    func pair(with link: PairingLink) async {
        guard !isBusy else { return }
        beginAttempt()
        await confirm(endpoint: link.endpoint, pairingID: link.pairingID, code: link.code, fallback: .idle)
    }

    /// Zurück zur Auswahl des Macs
    func cancel() {
        state = .idle
        lastError = nil
    }

    /// Fehler aus der Oberfläche anzeigen (z. B. ungültige Adresse)
    func report(_ error: ConnectionError) {
        lastError = error
    }

    private func beginAttempt() {
        nonce = PairingInput.makeNonce()
        wrongCodes = 0
    }

    private func confirm(endpoint: CoreEndpoint, pairingID: String, code: String, fallback: PairingState) async {
        lastError = nil
        state = .confirming(endpoint)
        let result: PairingResult
        do {
            result = try await client.pairConfirm(
                endpoint: endpoint,
                pairingID: pairingID,
                code: code,
                deviceName: deviceName,
                nonce: nonce,
                appVersion: appVersion
            )
        } catch {
            let cause = ConnectionError.wrap(error)
            if cause == .pairing(.codeInvalid) {
                wrongCodes += 1
            }
            lastError = cause
            state = stateAfterFailure(cause, fallback: fallback)
            return
        }

        do {
            try tokenStore.saveToken(result.deviceToken)
        } catch {
            lastError = .tokenStorageFailed
            state = .idle
            return
        }
        macStore.savePairedMac(
            PairedMac(endpoint: endpoint, deviceID: result.deviceID, deviceName: result.deviceName))
        state = .paired
        onPaired?()
    }

    /// Wohin es nach einem Fehler beim Einlösen geht
    private func stateAfterFailure(_ cause: ConnectionError, fallback: PairingState) -> PairingState {
        switch cause {
        case .pairing(.windowClosed), .pairing(.locked), .pairing(.requestRejected):
            // Mit dieser Anfrage geht es nicht weiter: von vorn
            return .idle
        case .pairing(.codeInvalid):
            // Nach 5 falschen Codes ist die Nonce verbraucht: neue Anfrage nötig
            return wrongCodes >= Self.maxWrongCodes ? .idle : fallback
        default:
            return fallback
        }
    }
}
