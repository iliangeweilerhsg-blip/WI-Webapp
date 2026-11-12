import Foundation

/// Hilfen für Eingaben bei der Kopplung
enum PairingInput {
    /// Sechs Ziffern, Leerzeichen dazwischen sind erlaubt. Sonst `nil`.
    static func normalizedCode(_ text: String) -> String? {
        let digits = text.filter { !$0.isWhitespace }
        guard digits.count == 6, digits.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        return digits
    }

    /// Zufallswert für `public_nonce`: 32 Byte, base64url ohne Auffüllung (43 Zeichen)
    static func makeNonce() -> String {
        var generator = SystemRandomNumberGenerator()
        var bytes: [UInt8] = []
        bytes.reserveCapacity(32)
        for _ in 0..<32 {
            bytes.append(UInt8.random(in: UInt8.min...UInt8.max, using: &generator))
        }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// Gerätename nach den Grenzen des Schemas: 1 bis 64 Zeichen
    static func deviceName(_ raw: String) -> String {
        let cleaned = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty { return "iPad" }
        return String(cleaned.prefix(64))
    }
}

/// Inhalt des QR-Codes der Web-App (VERTRAEGE §12, Schritt 1):
/// `sg://pair?v=1&host=<host>&port=<port>&pairing_id=<uuid>&code=<6 Ziffern>`
///
/// `host` muss eine IPv4-Adresse sein, so erzeugt sie der Mac (`PairingCode.host`). Einen `.local`-Namen weist der
/// QR-Weg ab (#261): Seine Auflösung liefe über mDNS, und ein Angreifer im WLAN könnte antworten. Er bekäme dann die
/// geheime `pairing_id` mitsamt Code und könnte die Kopplung weiterreichen (Relay, VERTRAEGE §12 H-5). Der QR-Weg
/// soll ohne Bonjour auskommen.
struct PairingLink: Equatable, Sendable {
    let endpoint: CoreEndpoint
    /// Geheime Kennung des Fensters. Nie protokollieren.
    let pairingID: String
    let code: String

    init?(qrPayload: String) {
        let text = qrPayload.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            let components = URLComponents(string: text),
            components.scheme?.lowercased() == "sg",
            components.host?.lowercased() == "pair"
        else { return nil }

        var values: [String: String] = [:]
        for item in components.queryItems ?? [] {
            if let value = item.value {
                values[item.name] = value
            }
        }
        guard
            values["v"] == "1",
            let host = values["host"],
            let portText = values["port"],
            let port = Int(portText),
            let endpoint = CoreEndpoint(host: host, port: port),
            TokenDestination.parseIPv4(endpoint.host) != nil,
            let rawID = values["pairing_id"],
            let uuid = UUID(uuidString: rawID),
            let rawCode = values["code"],
            let code = PairingInput.normalizedCode(rawCode)
        else { return nil }

        self.endpoint = endpoint
        // UUIDs immer klein (VERTRAEGE §11.7, Punkt 6)
        self.pairingID = uuid.uuidString.lowercased()
        self.code = code
    }
}
