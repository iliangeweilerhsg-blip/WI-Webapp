import Foundation
// @preconcurrency: Ältere SDKs kennzeichnen die Network-Typen noch nicht als Sendable
@preconcurrency import Network
import Observation

/// Ein per Bonjour gefundener Mac. Enthält nur Texte, damit der Wert überall hin darf.
struct DiscoveredMac: Identifiable, Hashable, Sendable {
    let name: String
    let type: String
    let domain: String

    var id: String { "\(name)|\(type)|\(domain)" }
}

/// Sucht `_studiengehirn._tcp` im WLAN (VERTRAEGE §12, Schritt 2).
/// Der Start der Suche löst beim ersten Mal die Frage „Lokales Netzwerk erlauben?“ aus.
/// Nur auf echter Hardware prüfbar.
@MainActor
@Observable
final class MacBrowser {
    static let serviceType = "_studiengehirn._tcp"

    private(set) var macs: [DiscoveredMac] = []
    /// Warum die Suche nichts findet, falls bekannt
    private(set) var problem: ConnectionError?

    @ObservationIgnored private var browser: NWBrowser?

    func start() {
        guard browser == nil else { return }
        let browser = NWBrowser(for: .bonjour(type: Self.serviceType, domain: nil), using: .tcp)
        // Die Rückrufe kommen auf der Hauptwarteschlange (start(queue: .main)), also auf dem MainActor
        // Die Werte werden schon im Rückruf in eigene, übertragbare Typen umgewandelt.
        browser.stateUpdateHandler = { [weak self] state in
            let change = MacBrowser.change(for: state)
            MainActor.assumeIsolated {
                if let self { self.apply(change) }
            }
        }
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            let found = MacBrowser.macs(in: results)
            MainActor.assumeIsolated {
                if let self { self.macs = found }
            }
        }
        self.browser = browser
        browser.start(queue: .main)
    }

    func stop() {
        browser?.cancel()
        browser = nil
        macs = []
    }

    /// Fehler der Suche einer Ursache zuordnen
    nonisolated static func connectionError(for error: NWError) -> ConnectionError {
        // -65570 = kDNSServiceErr_PolicyDenied: „Lokales Netzwerk“ ist für die App nicht erlaubt
        if case .dns(let code) = error, code == -65570 {
            return .localNetworkDenied
        }
        return .discoveryFailed
    }

    enum StateChange: Equatable, Sendable {
        case ready
        case problem(ConnectionError)
        case unchanged
    }

    nonisolated static func change(for state: NWBrowser.State) -> StateChange {
        switch state {
        case .ready:
            return .ready
        case .waiting(let error):
            return .problem(connectionError(for: error))
        case .failed(let error):
            return .problem(connectionError(for: error))
        default:
            return .unchanged
        }
    }

    nonisolated static func macs(in results: Set<NWBrowser.Result>) -> [DiscoveredMac] {
        var found: [DiscoveredMac] = []
        for result in results {
            if case let .service(name, type, domain, _) = result.endpoint {
                found.append(DiscoveredMac(name: name, type: type, domain: domain))
            }
        }
        return found.sorted { $0.name < $1.name }
    }

    private func apply(_ change: StateChange) {
        switch change {
        case .ready:
            problem = nil
        case .problem(let error):
            problem = error
        case .unchanged:
            break
        }
    }
}

/// Löst einen Bonjour-Dienst zu IPv4-Adresse und Port auf, indem kurz eine TCP-Verbindung
/// geöffnet wird. Der Core lauscht nur auf IPv4 und nimmt als `Host` nur IP-Adressen oder
/// `.local`-Namen an (VERTRAEGE §5).
enum MacResolver {
    static func resolve(_ mac: DiscoveredMac, timeout: TimeInterval = 5) async -> CoreEndpoint? {
        let service = NWEndpoint.service(name: mac.name, type: mac.type, domain: mac.domain, interface: nil)
        return await firstIPv4(of: service, timeout: timeout)
    }

    /// Löst einen von Hand eingegebenen `.local`-Namen auf IPv4 auf (#261): kurz eine TCP-Verbindung zum Namen, danach
    /// die Gegenstelle des Pfads lesen. Nur bei der Kopplung; zu diesem Zeitpunkt geht noch kein Token raus. Gespeichert
    /// wird die IP, nie der Name.
    static func resolve(localName host: String, port: Int, timeout: TimeInterval = 5) async -> CoreEndpoint? {
        guard let nwPort = NWEndpoint.Port(rawValue: UInt16(clamping: port)), port > 0 else { return nil }
        return await firstIPv4(of: .hostPort(host: .name(host, nil), port: nwPort), timeout: timeout)
    }

    private static func firstIPv4(of target: NWEndpoint, timeout: TimeInterval) async -> CoreEndpoint? {
        let parameters = NWParameters.tcp
        if let ip = parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
            ip.version = .v4
        }
        let connection = NWConnection(to: target, using: parameters)
        let queue = DispatchQueue(label: "de.studiengehirn.ipad.resolve")

        return await withCheckedContinuation { (continuation: CheckedContinuation<CoreEndpoint?, Never>) in
            let once = ResumeOnce(continuation)
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    let endpoint = MacResolver.endpoint(from: connection.currentPath?.remoteEndpoint)
                    once.resume(endpoint)
                    connection.cancel()
                case .failed:
                    once.resume(nil)
                    connection.cancel()
                case .cancelled:
                    once.resume(nil)
                    // Kreis aus Verbindung und Rückruf auflösen
                    connection.stateUpdateHandler = nil
                default:
                    // .waiting kann vorübergehend sein, darüber entscheidet die Zeitgrenze
                    break
                }
            }
            connection.start(queue: queue)
            queue.asyncAfter(deadline: .now() + timeout) {
                once.resume(nil)
                connection.cancel()
            }
        }
    }

    static func endpoint(from remote: NWEndpoint?) -> CoreEndpoint? {
        guard let remote, case let .hostPort(host, port) = remote else { return nil }
        guard case let .ipv4(address) = host else { return nil }
        let text = address.rawValue.map { String($0) }.joined(separator: ".")
        return CoreEndpoint(host: text, port: Int(port.rawValue))
    }
}

/// Setzt eine Continuation genau einmal fort, egal aus welchem Rückruf
private final class ResumeOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<CoreEndpoint?, Never>?

    init(_ continuation: CheckedContinuation<CoreEndpoint?, Never>) {
        self.continuation = continuation
    }

    func resume(_ value: CoreEndpoint?) {
        lock.lock()
        let pending = continuation
        continuation = nil
        lock.unlock()
        pending?.resume(returning: value)
    }
}

/// Löst `.local`-Namen bei der Kopplung auf IPv4 auf. Eigenes Protokoll, damit Tests ohne Netz laufen (#261).
protocol LocalNameResolving: Sendable {
    /// Der Endpunkt mit IPv4-Adresse und demselben Port, oder `nil`, wenn der Name nicht auflöst
    func resolve(_ endpoint: CoreEndpoint) async -> CoreEndpoint?
}

struct SystemLocalNameResolver: LocalNameResolving {
    init() {}

    func resolve(_ endpoint: CoreEndpoint) async -> CoreEndpoint? {
        let found = await MacResolver.resolve(localName: endpoint.host, port: endpoint.port)
        // Den Port behält die Eingabe: Die Gegenstelle des Pfads liefert ihn ohnehin gleich, aber so bleibt es eindeutig
        guard let found else { return nil }
        return CoreEndpoint(host: found.host, port: endpoint.port)
    }
}
