import CryptoKit
import Foundation

// Ableitungen aus dem Tunnel-Schlüssel (UX-12, Plan E3, E4, E13; docs/VERTRAEGE.md §7.5 „Ableitungen“).
// Dieselben Quelldateien nutzt später die iPad-App. Darum: nur `public`, nichts Mac-Eigenes, kein bloßes `Task`.

/// Der Schlüssel hat nicht das Format aus `PairResponse` (43 Zeichen base64url, kanonisch). Der Text nennt nie den Schlüssel.
public struct TunnelKeyFormatError: Error, Equatable, Sendable, CustomStringConvertible {
    public init() {}
    public var description: String {
        "Der Tunnel-Schlüssel hat nicht das Format aus PairResponse (43 Zeichen base64url, kanonisch kodiert)."
    }
}

/// Feste Werte des Tunnels
public enum TunnelConstants {
    /// Bonjour-Diensttyp
    public static let serviceType = "_sg-tunnel._tcp"
    /// Feste PSK-Kennung (Plan E13). Bei TLS 1.2 geht sie im Klartext über den Funk, darum nie eine `device_id`.
    public static let pskIdentity = "sg1"
    static let nameLabel = "sg-tunnel-name-v1"
    static let pskLabel = "sg-tunnel-psk-v1"
}

/// Ein Tunnel-Schlüssel (32 Byte). Gibt sich nie aus: weder in `description` noch in `debugDescription`.
public struct TunnelKey: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    private let bytes: [UInt8]

    /// Nimmt nur die kanonische Schreibweise an: genau 43 Zeichen base64url ohne Padding, die 2 überzähligen Bits im
    /// letzten Zeichen sind 0. Jede andere Schreibweise lehnen alle Seiten ab (VERTRAEGE §7.5).
    public init(base64url text: String) throws {
        guard let decoded = TunnelKey.decode(text) else { throw TunnelKeyFormatError() }
        self.bytes = decoded
    }

    /// Nur für Tests und die Gegenseite: aus 32 rohen Bytes
    public init(rawBytes: [UInt8]) throws {
        guard rawBytes.count == 32 else { throw TunnelKeyFormatError() }
        self.bytes = rawBytes
    }

    public var description: String { "TunnelKey(…)" }
    public var debugDescription: String { "TunnelKey(…)" }

    /// `"sg-" + hex(HMAC-SHA256(tunnel_key, "sg-tunnel-name-v1"))[0..16]`. Enthält keinen Rechnernamen.
    public var serviceName: String {
        let mac = hmac(TunnelConstants.nameLabel)
        let hex = mac.prefix(8).map { byte -> String in
            let digits = String(byte, radix: 16)
            return digits.count == 1 ? "0" + digits : digits
        }.joined()
        return "sg-" + hex
    }

    /// `HMAC-SHA256(tunnel_key, "sg-tunnel-psk-v1")`: 32 rohe Byte
    public var presharedKey: [UInt8] { hmac(TunnelConstants.pskLabel) }

    /// Als HMAC-Schlüssel dienen die 32 Rohbytes, nicht der Text; als Nachricht der ASCII-Text.
    private func hmac(_ message: String) -> [UInt8] {
        let code = HMAC<SHA256>.authenticationCode(for: Data(message.utf8), using: SymmetricKey(data: bytes))
        return Array(code)
    }

    static func decode(_ text: String) -> [UInt8]? {
        let characters = Array(text.utf8)
        guard characters.count == 43 else { return nil }
        var accumulator: UInt32 = 0
        var bits: UInt32 = 0
        var output: [UInt8] = []
        output.reserveCapacity(32)
        for character in characters {
            guard let value = sextet(character) else { return nil }
            accumulator = (accumulator << 6) | UInt32(value)
            bits += 6
            if bits >= 8 {
                bits -= 8
                output.append(UInt8((accumulator >> bits) & 0xFF))
                accumulator &= (UInt32(1) << bits) - 1
            }
        }
        // 43 × 6 = 258 Bit = 32 Byte + 2 überzählige Bits, die 0 sein müssen
        guard output.count == 32, bits == 2, accumulator == 0 else { return nil }
        return output
    }

    private static func sextet(_ character: UInt8) -> UInt8? {
        switch character {
        case 65...90: return character - 65  // A-Z
        case 97...122: return character - 97 + 26  // a-z
        case 48...57: return character - 48 + 52  // 0-9
        case 45: return 62  // -
        case 95: return 63  // _
        default: return nil
        }
    }
}
