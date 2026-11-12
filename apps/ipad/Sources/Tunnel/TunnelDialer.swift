import Foundation
// @preconcurrency: Ältere SDKs kennzeichnen die Network-Typen noch nicht als Sendable
@preconcurrency import Network

// Echte Fassung von `TunnelDialing` (UX-12, PR 4; Plan §5.3): Bonjour-Suche nach `_sg-tunnel._tcp`, Handshake mit
// TLS-PSK aus `TunnelShared`, danach die **eigene Prüfung** von Version und Verfahren. Network.framework erzwingt die
// Verfahren nicht (E12), darum ist diese Prüfung die eigentliche Sperre: Alles außer TLS 1.2 mit 0xCCAC oder 0xC035
// wird sofort geschlossen, bevor der Aufrufer die Verbindung zu sehen bekommt.
// Nur auf echter Hardware prüfbar (Bonjour, AWDL).

/// Auswahl der Kandidaten aus den gefundenen Diensten. Reine Funktionen.
enum TunnelCandidates {
    /// Höchstens so viele Kandidaten je Name, den Namenszusatz „ (2)“ eingerechnet (Plan §5.3, Punkt 1)
    static let maxPerName = 4

    /// Ist `found` der Dienstname oder der Dienstname mit Bonjour-Zusatz für einen Namenskonflikt (` (2)`, ` (3)` …)?
    /// Jeder Rechner im Funk kann einen Namen nachsprechen: Der Name ist nur ein Kandidat, der Handshake entscheidet.
    static func matches(_ found: String, serviceName: String) -> Bool {
        if found == serviceName { return true }
        let prefix = serviceName + " ("
        guard found.hasPrefix(prefix), found.hasSuffix(")") else { return false }
        let number = found.dropFirst(prefix.count).dropLast()
        return !number.isEmpty && number.count <= 3 && number.allSatisfy { $0.isASCII && $0.isNumber }
    }

    /// Die passenden Namen ohne Doppelte, der Name ohne Zusatz zuerst, dann nach Zahl aufsteigend, höchstens
    /// `maxPerName`. Die Reihenfolge ist fest, damit ein Angreifer sie nicht durch die Ankunftszeit steuert.
    static func select(from names: [String], serviceName: String) -> [String] {
        var seen = Set<String>()
        let matching = names.filter { matches($0, serviceName: serviceName) && seen.insert($0).inserted }
        let sorted = matching.sorted { left, right in
            let l = suffixNumber(of: left, serviceName: serviceName)
            let r = suffixNumber(of: right, serviceName: serviceName)
            if l != r { return l < r }
            return left < right
        }
        return Array(sorted.prefix(maxPerName))
    }

    /// 0 für den Namen ohne Zusatz, sonst die Zahl im Zusatz
    private static func suffixNumber(of name: String, serviceName: String) -> Int {
        guard name != serviceName else { return 0 }
        let prefix = serviceName + " ("
        return Int(name.dropFirst(prefix.count).dropLast()) ?? Int.max
    }
}

/// Die eigene Prüfung nach dem Handshake (Plan E12, Pflicht aus dem Sicherheits-Review): Network.framework erzwingt
/// weder TLS 1.2 noch die Verfahren. Erst wenn diese Prüfung besteht, darf die Verbindung weitergegeben werden.
enum TunnelHandshakeCheck {
    /// `true` nur für TLS 1.2 mit `TLS_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256` (0xCCAC) oder
    /// `TLS_ECDHE_PSK_WITH_AES_128_CBC_SHA` (0xC035). Fehlen die Angaben (`nil`), gilt das als Abweichung: sofort
    /// schließen.
    static func accepts(_ negotiated: TunnelNegotiated?) -> Bool {
        negotiated?.isAllowed ?? false
    }
}

/// Weg einer Verbindung nach den Namen der Schnittstellen (nie Adressen)
enum TunnelPathInfo {
    /// `awdl…` und `llw…` sind die Funkschnittstellen für peer-to-peer, `en…` das normale Netz. Nennt der Pfad die
    /// Schnittstelle des Gegenübers, zählt sie. Sonst entscheidet die Liste, aber nur, wenn sie eindeutig ist.
    static func kind(remoteInterface: String?, available: [String]) -> TunnelPathKind {
        if let remoteInterface { return classify(remoteInterface) }
        let kinds = Set(available.map(classify))
        if kinds == [.direct] { return .direct }
        if kinds == [.wifi] { return .wifi }
        return .unknown
    }

    static func classify(_ name: String) -> TunnelPathKind {
        if name.hasPrefix("awdl") || name.hasPrefix("llw") { return .direct }
        if name.hasPrefix("en") { return .wifi }
        return .unknown
    }

    static func kind(of path: NWPath?) -> TunnelPathKind {
        guard let path else { return .unknown }
        var remoteName: String?
        if case let .hostPort(host, _)? = path.remoteEndpoint {
            switch host {
            case .ipv4(let address): remoteName = address.interface?.name
            case .ipv6(let address): remoteName = address.interface?.name
            case .name(_, let interface): remoteName = interface?.name
            @unknown default: break
            }
        }
        return kind(remoteInterface: remoteName, available: path.availableInterfaces.map { $0.name })
    }
}

/// Die echte Wahl des Weges zum Mac. Zustandslos: Jeder Aufruf von `dial` legt einen eigenen Versuch an.
struct NetworkTunnelDialer: TunnelDialing {
    init() {}

    func dial(key: TunnelKey, peerToPeer: Bool, timeout: TimeInterval) async -> TunnelDialResult {
        let attempt = TunnelDialAttempt(key: key, peerToPeer: peerToPeer)
        return await attempt.run(timeout: timeout)
    }
}

/// Ein gefundener Dienst (nur Name und Domain)
private struct FoundService: Sendable {
    let name: String
    let domain: String
}

/// Ein Verbindungsversuch: sucht den Dienst, verbindet sich mit bis zu vier Kandidaten gleichzeitig und nimmt den
/// ersten, dessen Handshake gelingt **und** dessen Verfahren erlaubt ist. Alles läuft auf einer eigenen seriellen
/// Warteschlange, darum gibt es keine Sperren. `@unchecked Sendable`: Der Zustand wird nur dort angefasst.
private final class TunnelDialAttempt: @unchecked Sendable {
    private let serviceName: String
    private let presharedKey: [UInt8]
    private let peerToPeer: Bool
    private let queue = DispatchQueue(label: "de.studiengehirn.ipad.tunnel.dial")

    private var continuation: CheckedContinuation<TunnelDialResult, Never>?
    private var browser: NWBrowser?
    private var candidates: [String: NWConnection] = [:]
    /// Namen, zu denen es schon einen Versuch gab. Ein gescheiterter Kandidat wird in diesem Versuch nicht wiederholt.
    private var attempted = Set<String>()
    private var finished = false
    private var sawHandshakeFailure = false

    init(key: TunnelKey, peerToPeer: Bool) {
        self.serviceName = key.serviceName
        self.presharedKey = key.presharedKey
        self.peerToPeer = peerToPeer
    }

    func run(timeout: TimeInterval) async -> TunnelDialResult {
        await withCheckedContinuation { (continuation: CheckedContinuation<TunnelDialResult, Never>) in
            queue.async {
                self.continuation = continuation
                self.begin(timeout: timeout)
            }
        }
    }

    // MARK: Suche

    private func begin(timeout: TimeInterval) {
        let parameters = NWParameters()
        parameters.includePeerToPeer = peerToPeer
        let browser = NWBrowser(for: .bonjour(type: TunnelConstants.serviceType, domain: nil), using: parameters)
        browser.stateUpdateHandler = { [weak self] state in
            self?.browserChanged(state)
        }
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            var services: [FoundService] = []
            for result in results {
                if case let .service(name, _, domain, _) = result.endpoint {
                    services.append(FoundService(name: name, domain: domain))
                }
            }
            self?.found(services)
        }
        self.browser = browser
        browser.start(queue: queue)
        queue.asyncAfter(deadline: .now() + timeout) { [weak self] in
            self?.deadlinePassed()
        }
    }

    private func browserChanged(_ state: NWBrowser.State) {
        guard !finished else { return }
        switch state {
        case .failed(let error):
            finish(.failed(MacBrowser.connectionError(for: error) == .localNetworkDenied ? .localNetworkDenied : .notFound))
        case .waiting(let error):
            // „Lokales Netzwerk“ verweigert: sofort melden, Warten bringt nichts
            if MacBrowser.connectionError(for: error) == .localNetworkDenied {
                finish(.failed(.localNetworkDenied))
            }
        default:
            break
        }
    }

    private func found(_ services: [FoundService]) {
        guard !finished else { return }
        let names = TunnelCandidates.select(from: services.map { $0.name }, serviceName: serviceName)
        for name in names where !attempted.contains(name) && attempted.count < TunnelCandidates.maxPerName {
            let domain = services.first { $0.name == name }?.domain ?? "local."
            startCandidate(name: name, domain: domain)
        }
    }

    // MARK: Handshake

    private func startCandidate(name: String, domain: String) {
        // Ohne Schnittstelle: Das System wählt den Weg (WLAN oder peer-to-peer, je nach `includePeerToPeer`)
        let endpoint = NWEndpoint.service(name: name, type: TunnelConstants.serviceType, domain: domain, interface: nil)
        let connection = NWConnection(
            to: endpoint, using: TunnelTLS.parameters(presharedKey: presharedKey, peerToPeer: peerToPeer))
        attempted.insert(name)
        candidates[name] = connection
        connection.stateUpdateHandler = { [weak self] state in
            self?.candidateChanged(name: name, connection: connection, state: state)
        }
        connection.start(queue: queue)
    }

    private func candidateChanged(name: String, connection: NWConnection, state: NWConnection.State) {
        guard !finished else {
            // Ein anderer Kandidat hat schon gewonnen
            connection.cancel()
            return
        }
        switch state {
        case .ready:
            // Die eigentliche Sperre (E12): ausgehandelte Version und Verfahren prüfen. Network.framework erzwingt
            // sie nicht. Bei jeder Abweichung sofort schließen, ohne dass der Aufrufer die Verbindung sieht.
            guard TunnelHandshakeCheck.accepts(TunnelTLS.negotiated(on: connection)) else {
                sawHandshakeFailure = true
                candidates[name] = nil
                connection.stateUpdateHandler = nil
                connection.cancel()
                return
            }
            win(name: name, connection: connection)
        case .failed:
            // Falscher Schlüssel, Abbruch im Handshake oder Netzfehler
            sawHandshakeFailure = true
            connection.stateUpdateHandler = nil
            connection.cancel()
        default:
            // `waiting` kann vorübergehend sein: Die Frist entscheidet
            break
        }
    }

    private func win(name: String, connection: NWConnection) {
        finished = true
        candidates[name] = nil
        connection.stateUpdateHandler = nil
        let path = TunnelPathInfo.kind(of: connection.currentPath)
        cleanup()
        let channel = NetworkStream(connection: connection)
        resume(.connected(channel, path))
    }

    private func deadlinePassed() {
        guard !finished else { return }
        if candidates.isEmpty && !sawHandshakeFailure {
            finish(.failed(.notFound))
        } else if sawHandshakeFailure {
            finish(.failed(.handshakeFailed))
        } else {
            // Dienst gesehen, aber nie erreichbar
            finish(.failed(.notFound))
        }
    }

    // MARK: Ende

    private func finish(_ result: TunnelDialResult) {
        guard !finished else { return }
        finished = true
        cleanup()
        resume(result)
    }

    /// Schließt Suche und alle übrigen Kandidaten
    private func cleanup() {
        browser?.stateUpdateHandler = nil
        browser?.browseResultsChangedHandler = nil
        browser?.cancel()
        browser = nil
        for connection in candidates.values {
            connection.stateUpdateHandler = nil
            connection.cancel()
        }
        candidates = [:]
    }

    private func resume(_ result: TunnelDialResult) {
        let pending = continuation
        continuation = nil
        pending?.resume(returning: result)
    }
}
