import Foundation
import Observation

/// Zustände der Kopplung (VERTRAEGE §12)
enum PairingState: Equatable, Sendable {
    /// Mac wählen: QR-Code, Bonjour-Liste oder Adresse von Hand
    case idle
    /// QR-Code gelesen: Der Nutzer sieht die Adresse und entscheidet. Noch nichts gesendet.
    case reviewing(PairingLink)
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
/// - QR-Code (empfohlen, §12 H-5): `review(_:)` zeigt die Adresse, erst `confirmReviewedLink()`
///   löst den Code ein. Ohne diese Rückfrage würde ein untergeschobener QR-Code das iPad
///   unbemerkt an einen fremden Host koppeln (Review M-1).
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
    private let localResolver: any LocalNameResolving

    @ObservationIgnored private var nonce: String = PairingInput.makeNonce()
    @ObservationIgnored private var wrongCodes = 0

    init(
        client: CoreClient,
        tokenStore: any TokenStore,
        macStore: any PairedMacStore,
        deviceName: String,
        appVersion: String?,
        localResolver: any LocalNameResolving = SystemLocalNameResolver()
    ) {
        self.localResolver = localResolver
        self.client = client
        self.tokenStore = tokenStore
        self.macStore = macStore
        self.deviceName = PairingInput.deviceName(deviceName)
        self.appVersion = appVersion
    }

    var isBusy: Bool {
        switch state {
        case .requesting, .confirming: return true
        case .idle, .reviewing, .awaitingCode, .paired: return false
        }
    }

    /// Bonjour-Weg und Eingabe von Hand: Anfrage am Mac anlegen.
    /// Liegt gerade ein QR-Code zur Bestätigung vor, passiert nichts: Eine Bonjour-Auflösung,
    /// die erst nach dem Scan fertig wird, soll die Rückfrage nicht wegschieben.
    ///
    /// Ein `.local`-Name wird zuerst auf IPv4 aufgelöst; alle Schritte (auch `pair/start`) gehen an die IP, und
    /// gespeichert wird die IP (#261). Löst der Name nicht auf, geht nichts raus.
    func start(endpoint requested: CoreEndpoint) async {
        guard !isBusy else { return }
        if case .reviewing = state { return }
        lastError = nil
        beginAttempt()
        state = .requesting(requested)
        guard let endpoint = await addressForPairing(requested) else {
            guard state == .requesting(requested) else { return }
            lastError = .localNameNotResolved
            state = .idle
            return
        }
        guard state == .requesting(requested) else { return }
        do {
            let pairingID = try await client.pairStart(endpoint: endpoint, deviceName: deviceName, nonce: nonce)
            // Inzwischen abgebrochen?
            guard state == .requesting(requested) else { return }
            state = .awaitingCode(endpoint, pairingID: pairingID)
        } catch {
            guard state == .requesting(requested) else { return }
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

    /// QR-Weg, Schritt 1: Adresse aus dem QR-Code zur Bestätigung vorlegen. Sendet nichts.
    func review(_ link: PairingLink) {
        guard state == .idle else { return }
        lastError = nil
        state = .reviewing(link)
    }

    /// QR-Weg, Schritt 2: Der Nutzer hat die Adresse bestätigt, jetzt den Code einlösen
    func confirmReviewedLink() async {
        guard case .reviewing(let link) = state else { return }
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

    /// Die Adresse, an die die Kopplung geht: IPv4 bleibt, ein `.local`-Name wird aufgelöst. `nil`, wenn das nicht
    /// klappt. Ein Ergebnis, das selbst wieder ein Name ist, zählt als gescheitert: Gespeichert wird nie ein Name.
    private func addressForPairing(_ endpoint: CoreEndpoint) async -> CoreEndpoint? {
        guard TokenDestination.isLocalName(endpoint.host) else { return endpoint }
        guard let resolved = await localResolver.resolve(endpoint),
            TokenDestination.parseIPv4(resolved.host) != nil
        else { return nil }
        return resolved
    }

    private func beginAttempt() {
        nonce = PairingInput.makeNonce()
        wrongCodes = 0
    }

    private func confirm(endpoint: CoreEndpoint, pairingID: String, code: String, fallback: PairingState) async {
        lastError = nil
        // `pair/confirm` trägt den Code (beim QR-Weg auch die geheime `pairing_id`) und geht nur an eine IPv4-Adresse,
        // nie per mDNS an einen Namen (#261, VERTRAEGE §12 H-5). `PairingLink` nimmt nur IPv4 an, und `start` hat einen
        // `.local`-Namen schon aufgelöst; diese Prüfung ist die zweite Sicherung.
        guard TokenDestination.parseIPv4(endpoint.host) != nil else {
            lastError = .invalidAddress
            state = fallback
            return
        }
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
            var cause = ConnectionError.wrap(error)
            if cause == .connectionLost || cause == .timeout {
                // Ohne Wiederholung (nicht idempotent): Der Mac kann schon gekoppelt haben.
                // Das gilt auch beim Timeout: Die Anfrage kann angekommen sein, nur die Antwort fehlt.
                cause = .pairingOutcomeUnknown
            }
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
