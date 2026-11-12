import Foundation

// Spike S6 (UX-12, PR 1): Rahmen und feste Befehle.
// Reine Werttypen ohne Netzwerk, damit sie ohne Funk testbar sind. Mac und iPad nutzen dieselbe Datei.
//
// Anfrage:  [op: 1 Byte][Länge: 4 Byte, big-endian][Nutzlast]
// Antwort:  [status: 1 Byte][Länge: 4 Byte, big-endian][Nutzlast]
//
// Der Mac kennt nur vier Befehle. Er reicht nichts weiter, liest keine Dateien, startet keine Prozesse.

/// Grenzen des Spikes (Plan UX-12, PR 1, „Härtung“)
public enum SpikeLimits {
    public static let serviceType = "_sg-spike._tcp"
    /// Höchstens so viele Verbindungen gleichzeitig (auch solche im Handshake)
    public static let maxConnections = 4
    public static let handshakeSeconds: Double = 5
    public static let idleSeconds: Double = 60
    /// Höchste Nutzlast eines `echo`
    public static let echoMaxBytes = 64 * 1024
    /// Höchste Größe eines `blob` in MiB
    public static let blobMaxMegabytes = 50
    /// Der Strom des `blob` geht in Blöcken dieser Größe raus (Puffergrenze je Richtung)
    public static let blobChunkBytes = 64 * 1024
    /// Selbstbeendigung des Mac-Teils
    public static let selfDestructSeconds: Double = 4 * 60 * 60
    public static let headerBytes = 5
    public static let bytesPerMegabyte = 1024 * 1024
}

public enum SpikeOp: UInt8, Sendable, CaseIterable {
    case ping = 1
    case health = 2
    case echo = 3
    case blob = 4
}

public enum SpikeReplyStatus: UInt8, Sendable {
    case ok = 0
    case badRequest = 1
}

/// Kopf einer Anfrage, schon geprüft
public struct SpikeRequestHeader: Equatable, Sendable {
    public let op: SpikeOp
    public let length: Int

    public init(op: SpikeOp, length: Int) {
        self.op = op
        self.length = length
    }
}

/// Ein fertig geprüfter Befehl
public enum SpikeCommand: Equatable, Sendable {
    case ping
    case health
    case echo(payload: [UInt8])
    case blob(megabytes: Int)
}

public enum SpikeWireError: Error, Equatable, Sendable {
    case wrongHeaderSize
    case unknownOp(UInt8)
    case lengthNotAllowed(op: SpikeOp, length: Int)
    case badBlobSize
}

/// Antwort des Befehls `health`: nur HTTP-Status und Dauer, nie der Body
public struct SpikeHealthReply: Equatable, Sendable {
    /// 0 = der Core hat nicht geantwortet
    public let httpStatus: UInt16
    public let millis: UInt32

    public init(httpStatus: UInt16, millis: UInt32) {
        self.httpStatus = httpStatus
        self.millis = millis
    }

    public static let payloadBytes = 6

    public func encoded() -> [UInt8] {
        [UInt8(httpStatus >> 8), UInt8(httpStatus & 0xff)] + SpikeWire.bigEndian(millis)
    }

    public static func decode(_ bytes: [UInt8]) -> SpikeHealthReply? {
        guard bytes.count == payloadBytes else { return nil }
        let status = UInt16(bytes[0]) << 8 | UInt16(bytes[1])
        return SpikeHealthReply(httpStatus: status, millis: SpikeWire.readBigEndian(bytes, at: 2))
    }
}

public enum SpikeWire {
    // MARK: Anfragen

    /// Anfrage als Bytes. Die Längen werden hier nicht geprüft, das tut der Empfänger.
    public static func request(op: SpikeOp, payload: [UInt8] = []) -> [UInt8] {
        [op.rawValue] + bigEndian(UInt32(payload.count)) + payload
    }

    public static func blobRequest(megabytes: Int) -> [UInt8] {
        request(op: .blob, payload: bigEndian(UInt32(clamping: megabytes)))
    }

    /// Kopf prüfen. Unbekannter Befehl oder nicht erlaubte Länge → Fehler, der Mac schließt dann die Verbindung.
    public static func parseRequestHeader(_ bytes: [UInt8]) -> Result<SpikeRequestHeader, SpikeWireError> {
        guard bytes.count == SpikeLimits.headerBytes else { return .failure(.wrongHeaderSize) }
        guard let op = SpikeOp(rawValue: bytes[0]) else { return .failure(.unknownOp(bytes[0])) }
        let rawLength = readBigEndian(bytes, at: 1)
        // Größer als jede erlaubte Länge: nicht erst in Int umrechnen, das wäre auf 32 Bit ein Überlauf
        guard rawLength <= UInt32(SpikeLimits.echoMaxBytes) else {
            return .failure(.lengthNotAllowed(op: op, length: Int(clamping: rawLength)))
        }
        let length = Int(rawLength)
        switch op {
        case .ping, .health:
            guard length == 0 else { return .failure(.lengthNotAllowed(op: op, length: length)) }
        case .echo:
            break  // bis echoMaxBytes, oben schon geprüft
        case .blob:
            guard length == 4 else { return .failure(.lengthNotAllowed(op: op, length: length)) }
        }
        return .success(SpikeRequestHeader(op: op, length: length))
    }

    /// Kopf und Nutzlast zu einem Befehl zusammenfügen
    public static func command(header: SpikeRequestHeader, payload: [UInt8]) -> Result<SpikeCommand, SpikeWireError> {
        guard payload.count == header.length else {
            return .failure(.lengthNotAllowed(op: header.op, length: payload.count))
        }
        switch header.op {
        case .ping:
            return .success(.ping)
        case .health:
            return .success(.health)
        case .echo:
            return .success(.echo(payload: payload))
        case .blob:
            let megabytes = Int(readBigEndian(payload, at: 0))
            guard (1...SpikeLimits.blobMaxMegabytes).contains(megabytes) else { return .failure(.badBlobSize) }
            return .success(.blob(megabytes: megabytes))
        }
    }

    // MARK: Antworten

    public static func reply(status: SpikeReplyStatus = .ok, payload: [UInt8] = []) -> [UInt8] {
        replyHeader(status: status, length: payload.count) + payload
    }

    public static func replyHeader(status: SpikeReplyStatus, length: Int) -> [UInt8] {
        [status.rawValue] + bigEndian(UInt32(clamping: length))
    }

    /// Größte Antwort, die ein Client annimmt (ein voller `blob`)
    public static let maxReplyBytes = SpikeLimits.blobMaxMegabytes * SpikeLimits.bytesPerMegabyte

    public static func parseReplyHeader(_ bytes: [UInt8]) -> Result<(status: SpikeReplyStatus, length: Int), SpikeWireError> {
        guard bytes.count == SpikeLimits.headerBytes else { return .failure(.wrongHeaderSize) }
        guard let status = SpikeReplyStatus(rawValue: bytes[0]) else { return .failure(.unknownOp(bytes[0])) }
        let raw = readBigEndian(bytes, at: 1)
        guard raw <= UInt32(maxReplyBytes) else {
            return .failure(.lengthNotAllowed(op: .blob, length: Int(clamping: raw)))
        }
        return .success((status, Int(raw)))
    }

    // MARK: Hilfen

    public static func bigEndian(_ value: UInt32) -> [UInt8] {
        [UInt8(value >> 24), UInt8((value >> 16) & 0xff), UInt8((value >> 8) & 0xff), UInt8(value & 0xff)]
    }

    /// Liest vier Byte ab `index`. Fehlen Bytes, gilt 0 (die Aufrufer prüfen die Längen vorher).
    public static func readBigEndian(_ bytes: [UInt8], at index: Int) -> UInt32 {
        guard index >= 0, index + 4 <= bytes.count else { return 0 }
        return UInt32(bytes[index]) << 24 | UInt32(bytes[index + 1]) << 16 | UInt32(bytes[index + 2]) << 8
            | UInt32(bytes[index + 3])
    }
}
