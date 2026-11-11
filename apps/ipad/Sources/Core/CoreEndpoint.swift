import Foundation

/// Adresse des Core auf dem Mac.
/// Erlaubt sind nur IPv4-Adressen (ohne führende Nullen) und `<name>.local`: Andere Hostnamen weist der Core mit
/// `421 host_not_allowed` ab (VERTRAEGE §5), und die ATS-Ausnahme `NSAllowsLocalNetworking`
/// gilt nur für lokale Ziele.
struct CoreEndpoint: Equatable, Hashable, Sendable {
    static let defaultPort = 4710

    let host: String
    let port: Int

    init?(host: String, port: Int = CoreEndpoint.defaultPort) {
        let cleaned = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard CoreEndpoint.isAllowedHost(cleaned), (1...65535).contains(port) else { return nil }
        self.host = cleaned
        self.port = port
    }

    /// Eingabe von Hand: `192.168.1.20`, `192.168.1.20:4710`, `mein-mac.local:4710`,
    /// auch mit `http://` davor oder einem Pfad dahinter.
    init?(userInput: String) {
        var text = userInput.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.lowercased().hasPrefix("http://") {
            text = String(text.dropFirst("http://".count))
        }
        if let slash = text.firstIndex(of: "/") {
            text = String(text[..<slash])
        }
        let parts = text.split(separator: ":", omittingEmptySubsequences: false).map { String($0) }
        if parts.count == 1 {
            self.init(host: parts[0])
        } else if parts.count == 2, let port = Int(parts[1]) {
            self.init(host: parts[0], port: port)
        } else {
            return nil
        }
    }

    /// Anzeige und Ablage: `host:port`
    var displayText: String { "\(host):\(port)" }

    /// URL unter `/api/v1`. `path` beginnt mit `/`.
    func url(path: String, queryItems: [URLQueryItem] = []) -> URL? {
        var components = URLComponents()
        components.scheme = "http"
        components.host = host
        components.port = port
        components.path = "/api/v1" + path
        if !queryItems.isEmpty {
            components.queryItems = queryItems
        }
        return components.url
    }

    /// WebSocket des Sync: `ws://host:port/sync`, außerhalb von `/api/v1` (VERTRAEGE §11.1)
    func syncURL() -> URL? {
        var components = URLComponents()
        components.scheme = "ws"
        components.host = host
        components.port = port
        components.path = "/sync"
        return components.url
    }

    static func isAllowedHost(_ host: String) -> Bool {
        isIPv4(host) || isLocalName(host)
    }

    private static func isIPv4(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        for part in parts {
            guard !part.isEmpty, part.count <= 3, part.allSatisfy({ $0.isASCII && $0.isNumber }) else {
                return false
            }
            // Führende Nullen ablehnen: Das System könnte `010` oktal lesen (8 statt 10)
            guard part.count == 1 || part.first != "0" else { return false }
            guard let value = Int(part), value <= 255 else { return false }
        }
        return true
    }

    private static func isLocalName(_ host: String) -> Bool {
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, labels.last == "local" else { return false }
        for label in labels {
            guard !label.isEmpty, label.count <= 63 else { return false }
            guard label.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }) else {
                return false
            }
        }
        return true
    }
}
