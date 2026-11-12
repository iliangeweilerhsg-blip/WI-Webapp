import CryptoKit
import Foundation
import Security

/// Der 8-stellige Code des Spikes (Plan UX-12, PR 1). Der Mac zeigt ihn an, am iPad wird er eingegeben.
/// Aus ihm folgen Dienstname und Schlüssel (PSK) für TLS. Er hat wenig Entropie (rund 26 Bit). Das ist nur für den
/// Spike vertretbar, weil hinter dem Mac-Teil keine Rechte liegen: vier feste Befehle ohne Daten der App.
public struct SpikeCode: Equatable, Sendable {
    public let digits: String

    /// Nimmt Eingaben wie „1234 5678“ an. Leerzeichen fallen weg, danach müssen es genau 8 Ziffern sein.
    public init?(input: String) {
        let cleaned = input.filter { !$0.isWhitespace }
        guard cleaned.count == 8, cleaned.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        self.digits = cleaned
    }

    /// Neuer Zufallscode (`SecRandomCopyBytes`), gleichverteilt über 00000000 bis 99999999
    public static func random() -> SpikeCode {
        // 42 × 10^8 ist das größte Vielfache von 10^8 unterhalb von 2^32: Wer darüber liegt, wird verworfen,
        // damit „Rest bei Division“ keine Ziffer bevorzugt.
        let limit: UInt32 = 4_200_000_000
        while true {
            var bytes = [UInt8](repeating: 0, count: 4)
            let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
            guard status == errSecSuccess else { fatalError("SecRandomCopyBytes ist fehlgeschlagen (\(status))") }
            let value = SpikeWire.readBigEndian(bytes, at: 0)
            if value < limit {
                let text = String(value % 100_000_000)
                let padded = String(repeating: "0", count: 8 - text.count) + text
                if let code = SpikeCode(input: padded) { return code }
            }
        }
    }

    /// „1234 5678“ zum Vorlesen
    public var display: String {
        "\(digits.prefix(4)) \(digits.suffix(4))"
    }

    /// Feste PSK-Kennung. Sie geht bei TLS 1.2 im Klartext über den Funk, darum nichts Geräteeigenes (Plan E13).
    public static let pskIdentity = "sgs1"

    /// `HMAC-SHA256(Code, "sg-spike-psk-v1")`, 32 Byte
    public var presharedKey: [UInt8] { mac("sg-spike-psk-v1") }

    /// Bonjour-Name: `sgs-` plus die ersten 2 Hex-Zeichen von `HMAC-SHA256(Code, "sg-spike-name-v1")`.
    /// Enthält keinen Rechnernamen. Bewusst nur 8 Bit: Der Name steht offen im Funk. Mit 32 Bit ließe sich der Code
    /// (rund 26 Bit) allein aus dem Namen offline zurückrechnen, ganz ohne Mitschnitt eines Handshakes.
    public var serviceName: String {
        let hex = mac("sg-spike-name-v1").prefix(1).map { String(format: "%02x", $0) }.joined()
        return "sgs-" + hex
    }

    private func mac(_ message: String) -> [UInt8] {
        let key = SymmetricKey(data: Data(digits.utf8))
        return Array(HMAC<SHA256>.authenticationCode(for: Data(message.utf8), using: key))
    }
}
