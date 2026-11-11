import Foundation

/// IDs für alles, was das iPad offline anlegt: UUIDv7 in Kleinbuchstaben (VERTRAEGE §5, §11.7 Punkt 6)
enum InkID {
    static func uuidV7(now: Date = Date()) -> String {
        var generator = SystemRandomNumberGenerator()
        return uuidV7(now: now, using: &generator)
    }

    /// RFC 9562: 48 Bit Zeit in ms, Version 7, Variante 10, der Rest zufällig
    static func uuidV7<Generator: RandomNumberGenerator>(now: Date, using generator: inout Generator) -> String {
        let milliseconds = UInt64(max(0, (now.timeIntervalSince1970 * 1000).rounded(.down)))
        var bytes = [UInt8](repeating: 0, count: 16)
        for index in 0..<6 {
            bytes[index] = UInt8(truncatingIfNeeded: milliseconds >> UInt64(8 * (5 - index)))
        }
        let first: UInt64 = generator.next()
        let second: UInt64 = generator.next()
        for index in 0..<2 {
            bytes[6 + index] = UInt8(truncatingIfNeeded: first >> UInt64(8 * index))
        }
        for index in 0..<8 {
            bytes[8 + index] = UInt8(truncatingIfNeeded: second >> UInt64(8 * index))
        }
        bytes[6] = (bytes[6] & 0x0F) | 0x70
        bytes[8] = (bytes[8] & 0x3F) | 0x80

        var text = ""
        for (index, byte) in bytes.enumerated() {
            if index == 4 || index == 6 || index == 8 || index == 10 {
                text.append("-")
            }
            text.append(String(format: "%02x", Int(byte)))
        }
        return text
    }
}
