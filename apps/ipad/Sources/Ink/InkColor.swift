import Foundation

/// Farbe im Format des Strich-Schemas: `#RRGGBBAA` (08 §4.1)
struct InkRGBA: Hashable, Sendable {
    var red: UInt8
    var green: UInt8
    var blue: UInt8
    var alpha: UInt8

    init(red: UInt8, green: UInt8, blue: UInt8, alpha: UInt8 = 255) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }

    /// Liest `#RRGGBB` und `#RRGGBBAA`. Alles andere ergibt `nil`.
    init?(hex: String) {
        guard hex.hasPrefix("#") else { return nil }
        let digits = Array(hex.utf8.dropFirst())
        guard digits.count == 6 || digits.count == 8 else { return nil }
        var bytes: [UInt8] = []
        var index = 0
        while index < digits.count {
            guard let high = InkRGBA.nibble(digits[index]), let low = InkRGBA.nibble(digits[index + 1]) else {
                return nil
            }
            bytes.append(high << 4 | low)
            index += 2
        }
        self.init(red: bytes[0], green: bytes[1], blue: bytes[2], alpha: bytes.count == 4 ? bytes[3] : 255)
    }

    /// Immer achtstellig und groß geschrieben, wie in den Testdaten (`#1E2A44FF`)
    var hex: String {
        String(format: "#%02X%02X%02X%02X", Int(red), Int(green), Int(blue), Int(alpha))
    }

    func withAlpha(_ alpha: UInt8) -> InkRGBA {
        InkRGBA(red: red, green: green, blue: blue, alpha: alpha)
    }

    private static func nibble(_ character: UInt8) -> UInt8? {
        switch character {
        case UInt8(ascii: "0")...UInt8(ascii: "9"): return character - UInt8(ascii: "0")
        case UInt8(ascii: "a")...UInt8(ascii: "f"): return character - UInt8(ascii: "a") + 10
        case UInt8(ascii: "A")...UInt8(ascii: "F"): return character - UInt8(ascii: "A") + 10
        default: return nil
        }
    }
}
