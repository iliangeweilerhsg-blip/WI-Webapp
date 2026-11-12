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

    /// Zählt ein gescheiterter Kandidat als „falscher Schlüssel“? Nur wenn der Aufbau bis zum Gegenüber kam und dann
    /// scheiterte (TLS-Fehler, Abbruch im Handshake). Ist niemand da (abgewiesen, nicht erreichbar, Namensauflösung),
    /// heißt das „nicht gefunden“: Sonst stünde nach einem Neustart des Helfers der Text vom falschen Schlüssel da.
    static func isHandshakeFailure(_ error: NWError) -> Bool {
        switch error {
        case .tls:
            return true
        case .posix(let code):
            let notReached: [POSIXErrorCode] = [.ECONNREFUSED, .ETIMEDOUT, .ENETUNREACH, .EHOSTUNREACH, .ENETDOWN, .EHOSTDOWN]
            return !notReached.contains(code)
        case .dns:
            return false
        @unknown default:
            return false
        }
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

/// Der zuletzt erfolgreiche Endpunkt je Dienstname und Stufe (Leistung, Review PR #276): Ohne ihn startet **jede** neue
/// Verbindung des Weiterleiters eine eigene Bonjour-Suche. `URLSession` öffnet nach 10 s Leerlauf (Keep-Alive des Core)
/// und für jeden Folien-Download eine neue Verbindung; im Hörsaal kostet die Suche über peer-to-peer jedes Mal Sekunden.
///
/// - Gespeichert wird nur ein Endpunkt, dessen Handshake **und** Verfahrensprüfung gelungen sind. Er ist nur ein
///   Kandidat: Auch über ihn fließt kein Byte vor einem neuen, geprüften Handshake. Ein Fremder kann ihn darum weder
///   setzen noch nutzen.
/// - Gültig `lifetime` Sekunden ab dem letzten Erfolg. Vergessen bei Netzwechsel, Vordergrund, Hintergrund, neuem
///   Schlüssel (`forgetAll`, aus `MacRoute`) und sobald ein Versuch über ihn scheitert.
/// - Ein Versuch, der vor `forgetAll` begann, schreibt nichts mehr hinein (`epoch`): Sonst käme ein Endpunkt aus dem
///   alten Netz zurück.
final class TunnelEndpointCache: @unchecked Sendable {
    static let defaultLifetime: TimeInterval = 120

    struct Ticket: Equatable, Sendable {
        let epoch: Int
    }

    private struct Key: Hashable {
        let serviceName: String
        let peerToPeer: Bool
    }

    private struct Entry {
        let endpoint: NWEndpoint
        let storedAt: Date
    }

    private let lock = NSLock()
    private let lifetime: TimeInterval
    private let now: @Sendable () -> Date
    private var entries: [Key: Entry] = [:]
    private var epoch = 0

    init(lifetime: TimeInterval = TunnelEndpointCache.defaultLifetime, now: @escaping @Sendable () -> Date = { Date() }) {
        self.lifetime = lifetime
        self.now = now
    }

    /// Merkt sich den Stand vor einem Versuch. Nur mit diesem Ticket darf der Versuch später etwas ablegen.
    func ticket() -> Ticket {
        lock.lock()
        defer { lock.unlock() }
        return Ticket(epoch: epoch)
    }

    func lookup(serviceName: String, peerToPeer: Bool) -> NWEndpoint? {
        lock.lock()
        defer { lock.unlock() }
        let key = Key(serviceName: serviceName, peerToPeer: peerToPeer)
        guard let entry = entries[key] else { return nil }
        let age = now().timeIntervalSince(entry.storedAt)
        guard age >= 0, age < lifetime else {
            entries[key] = nil
            return nil
        }
        return entry.endpoint
    }

    func remember(_ endpoint: NWEndpoint, serviceName: String, peerToPeer: Bool, ticket: Ticket) {
        lock.lock()
        defer { lock.unlock() }
        guard ticket.epoch == epoch else { return }
        entries[Key(serviceName: serviceName, peerToPeer: peerToPeer)] = Entry(endpoint: endpoint, storedAt: now())
    }

    func forget(serviceName: String, peerToPeer: Bool) {
        lock.lock()
        defer { lock.unlock() }
        entries[Key(serviceName: serviceName, peerToPeer: peerToPeer)] = nil
    }

    func forgetAll() {
        lock.lock()
        defer { lock.unlock() }
        entries = [:]
        epoch += 1
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return entries.count
    }
}

/// Die echte Wahl des Weges zum Mac. Jeder Aufruf von `dial` legt einen eigenen Versuch an. Der Versuch beginnt mit dem
/// zuletzt erfolgreichen Endpunkt (`TunnelEndpointCache`), sonst mit der Bonjour-Suche.
struct NetworkTunnelDialer: TunnelDialing {
    let cache: TunnelEndpointCache

    init(cache: TunnelEndpointCache = TunnelEndpointCache()) {
        self.cache = cache
    }

    func dial(key: TunnelKey, peerToPeer: Bool, timeout: TimeInterval) async -> TunnelDialResult {
        let attempt = TunnelDialAttempt(key: key, peerToPeer: peerToPeer, cache: cache)
        return await attempt.run(timeout: timeout)
    }

    func forgetCachedEndpoints() {
        cache.forgetAll()
    }
}

/// Ein gefundener Dienst (nur Name und Domain)
private struct FoundService: Sendable {
    let name: String
    let domain: String
}

/// Ein Verbindungsversuch: nimmt zuerst den zuletzt erfolgreichen Endpunkt, sonst (oder wenn der nicht gleich klappt)
/// sucht er den Dienst, verbindet sich mit bis zu vier Kandidaten gleichzeitig und nimmt den ersten, dessen Handshake
/// gelingt **und** dessen Verfahren erlaubt ist. Alles läuft auf einer eigenen seriellen Warteschlange, darum gibt es
/// keine Sperren. `@unchecked Sendable`: Der Zustand wird nur dort angefasst.
private final class TunnelDialAttempt: @unchecked Sendable {
    /// So lange bekommt der gemerkte Endpunkt einen Vorsprung, bevor zusätzlich gesucht wird. Ein Handshake im selben
    /// WLAN dauert Millisekunden; scheitert der Endpunkt oder wartet er, beginnt die Suche sofort.
    static let cachedHeadStartSeconds: TimeInterval = 0.75
    /// Schlüssel des gemerkten Endpunkts unter den Kandidaten. Kann mit keinem Bonjour-Namen kollidieren: Kandidaten aus
    /// der Suche beginnen immer mit `sg-` (`TunnelCandidates.matches`).
    private static let cachedCandidate = " gemerkt"

    private let serviceName: String
    private let presharedKey: [UInt8]
    private let peerToPeer: Bool
    private let cache: TunnelEndpointCache
    private let ticket: TunnelEndpointCache.Ticket
    private let queue = DispatchQueue(label: "de.studiengehirn.ipad.tunnel.dial")

    private var continuation: CheckedContinuation<TunnelDialResult, Never>?
    private var browser: NWBrowser?
    private var candidates: [String: NWConnection] = [:]
    /// Namen, zu denen es schon einen Versuch gab. Ein gescheiterter Kandidat wird in diesem Versuch nicht wiederholt.
    private var attempted = Set<String>()
    private var finished = false
    private var sawHandshakeFailure = false

    init(key: TunnelKey, peerToPeer: Bool, cache: TunnelEndpointCache) {
        self.serviceName = key.serviceName
        self.presharedKey = key.presharedKey
        self.peerToPeer = peerToPeer
        self.cache = cache
        self.ticket = cache.ticket()
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
        queue.asyncAfter(deadline: .now() + timeout) { [weak self] in
            self?.deadlinePassed()
        }
        guard let remembered = cache.lookup(serviceName: serviceName, peerToPeer: peerToPeer) else {
            startBrowsing()
            return
        }
        // Gemerkter Endpunkt: keine Suche, solange er gleich antwortet
        startConnection(key: Self.cachedCandidate, to: remembered)
        queue.asyncAfter(deadline: .now() + Self.cachedHeadStartSeconds) { [weak self] in
            self?.startBrowsing()
        }
    }

    /// Startet die Bonjour-Suche, höchstens einmal je Versuch
    private func startBrowsing() {
        guard !finished, browser == nil else { return }
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
        attempted.insert(name)
        startConnection(key: name, to: endpoint)
    }

    private func startConnection(key name: String, to endpoint: NWEndpoint) {
        let connection = NWConnection(
            to: endpoint, using: TunnelTLS.parameters(presharedKey: presharedKey, peerToPeer: peerToPeer))
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
        let isRemembered = name == Self.cachedCandidate
        switch state {
        case .ready:
            // Die eigentliche Sperre (E12): ausgehandelte Version und Verfahren prüfen. Network.framework erzwingt
            // sie nicht. Bei jeder Abweichung sofort schließen, ohne dass der Aufrufer die Verbindung sieht.
            guard TunnelHandshakeCheck.accepts(TunnelTLS.negotiated(on: connection)) else {
                if isRemembered {
                    rememberedFailed()
                } else {
                    sawHandshakeFailure = true
                }
                candidates[name] = nil
                connection.stateUpdateHandler = nil
                connection.cancel()
                return
            }
            win(name: name, connection: connection)
        case .failed(let error):
            candidates[name] = nil
            connection.stateUpdateHandler = nil
            connection.cancel()
            if isRemembered {
                // Der gemerkte Endpunkt gilt nicht mehr (Mac woanders, Helfer neu gestartet): sofort suchen
                rememberedFailed()
            } else if TunnelHandshakeCheck.isHandshakeFailure(error) {
                sawHandshakeFailure = true
            }
        case .waiting:
            // Kann vorübergehend sein: Die Frist entscheidet. Beim gemerkten Endpunkt nicht warten, sondern vergessen
            // und suchen; er bleibt Kandidat und wird wieder gemerkt, falls er doch noch gewinnt.
            if isRemembered { rememberedFailed() }
        default:
            break
        }
    }

    /// Der gemerkte Endpunkt hat nicht geklappt: vergessen und sofort suchen. Zählt nicht als falscher Schlüssel, denn
    /// unter einer alten Adresse kann inzwischen ein anderes Gerät antworten.
    private func rememberedFailed() {
        cache.forget(serviceName: serviceName, peerToPeer: peerToPeer)
        startBrowsing()
    }

    private func win(name: String, connection: NWConnection) {
        finished = true
        candidates[name] = nil
        connection.stateUpdateHandler = nil
        let currentPath = connection.currentPath
        let path = TunnelPathInfo.kind(of: currentPath)
        // Den aufgelösten Endpunkt merken (Adresse samt Schnittstelle), sonst den Dienst selbst: Die nächste Verbindung
        // spart die Suche. Geprüft wird sie trotzdem wieder vollständig.
        if let resolved = currentPath?.remoteEndpoint, case .hostPort = resolved {
            cache.remember(resolved, serviceName: serviceName, peerToPeer: peerToPeer, ticket: ticket)
        } else {
            cache.remember(connection.endpoint, serviceName: serviceName, peerToPeer: peerToPeer, ticket: ticket)
        }
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
