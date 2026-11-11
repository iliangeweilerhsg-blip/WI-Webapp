import Foundation

/// FNV-1a mit 64 Bit. Anders als `Hasher` liefert er in jedem App-Start dasselbe Ergebnis,
/// darum taugt er für Schlüssel, die auf der Platte liegen.
struct InkStableHasher {
    private(set) var value: UInt64 = 0xcbf2_9ce4_8422_2325

    mutating func addByte(_ byte: UInt8) {
        value ^= UInt64(byte)
        value = value &* 0x0000_0100_0000_01b3
    }

    mutating func add(_ number: UInt64) {
        for shift in stride(from: 0, to: 64, by: 8) {
            addByte(UInt8(truncatingIfNeeded: number >> UInt64(shift)))
        }
    }

    mutating func add(_ text: String) {
        for byte in text.utf8 {
            addByte(byte)
        }
        addByte(0xFF)
    }

    mutating func add(_ number: Double) {
        add(number.bitPattern)
    }
}

/// Erkennungsmerkmale eines Strichs (08 §4.3). PencilKit-Striche haben keine ID.
struct InkStrokeFootprint: Equatable, Sendable {
    /// Bleibt gleich, solange es derselbe Strich ist: Hash aus Entstehungszeit, Punktanzahl
    /// und den ersten drei Punkten vor der Transformation
    let fingerprint: UInt64
    /// Ändert sich, wenn der Strich verschoben, skaliert oder umgefärbt wurde
    let signature: UInt64

    init(fingerprint: UInt64, signature: UInt64) {
        self.fingerprint = fingerprint
        self.signature = signature
    }

    /// - Parameter head: x und y der ersten (höchstens drei) Punkte, abwechselnd
    init(
        createdAtMS: Int,
        pointCount: Int,
        head: [Float],
        tool: StrokeTool,
        color: InkRGBA,
        width: Double,
        transform: [Double]
    ) {
        var identity = InkStableHasher()
        identity.add(UInt64(bitPattern: Int64(createdAtMS)))
        identity.add(UInt64(pointCount))
        // Gerundet, damit der Schlüssel das Speichern und Laden der Zeichnung übersteht
        for value in head.prefix(6) {
            identity.add(InkStrokeFootprint.rounded(Double(value), digits: 100))
        }
        fingerprint = identity.value

        var look = InkStableHasher()
        look.add(tool.rawValue)
        look.add(color.hex)
        look.add(InkStrokeFootprint.rounded(width, digits: 100))
        for value in transform {
            look.add(InkStrokeFootprint.rounded(value, digits: 10_000))
        }
        signature = look.value
    }

    /// `digits` = 100 rundet auf zwei Nachkommastellen. Nicht endliche Werte zählen als 0.
    private static func rounded(_ value: Double, digits: Double) -> Double {
        guard value.isFinite else { return 0 }
        let result = (value * digits).rounded() / digits
        // -0,0 und 0,0 sollen denselben Schlüssel ergeben
        return result == 0 ? 0 : result
    }

    init(sample: InkStrokeSample) {
        var head: [Float] = []
        for point in sample.points.prefix(3) {
            head.append(Float(point.x))
            head.append(Float(point.y))
        }
        self.init(
            createdAtMS: InkStrokeCodec.milliseconds(sample.createdAt),
            pointCount: sample.points.count,
            head: head,
            tool: sample.tool,
            color: sample.color,
            width: sample.width,
            transform: sample.transform
        )
    }
}

/// Ergebnis eines Abgleichs. Entspricht direkt den Operationen `stroke.add` und `stroke.remove`.
struct InkTrackerDiff: Equatable, Sendable {
    struct Upsert: Equatable, Sendable {
        /// Stelle des Strichs in der übergebenen Liste
        let index: Int
        let clientID: String
        /// `false`: bekannter Strich mit geänderten Eigenschaften, gleiche `client_id` (Upsert im Core)
        let isNew: Bool
    }

    /// Neue und geänderte Striche, in der Reihenfolge der Liste
    var upserts: [Upsert] = []
    /// `client_id` der verschwundenen Striche, sortiert
    var removed: [String] = []
    /// `client_id` jedes Strichs der Liste
    var clientIDs: [String] = []

    var isEmpty: Bool { upserts.isEmpty && removed.isEmpty }
}

/// Zuordnung `Fingerabdruck → client_id` einer Ebene (08 §4.3). Sie liegt neben der Zeichnung auf der
/// Platte, damit ein Strich nach dem Neustart dieselbe ID behält.
struct InkStrokeTracker: Codable, Equatable, Sendable {
    struct Entry: Codable, Equatable, Sendable {
        var clientID: String
        /// Hexadezimal als Text: JSON-Zahlen sind für 64 Bit ohne Vorzeichen nicht überall verlustfrei
        var signature: String
    }

    /// Schlüssel `Fingerabdruck#n`. `n` zählt gleiche Fingerabdrücke durch (kopierte Striche).
    private(set) var entries: [String: Entry] = [:]

    init() {}

    /// Vergleicht den Strichbestand mit dem letzten Stand und merkt sich den neuen.
    /// - Parameter makeID: liefert eine neue `client_id` (UUIDv7, klein)
    mutating func update(_ footprints: [InkStrokeFootprint], makeID: () -> String) -> InkTrackerDiff {
        var diff = InkTrackerDiff()
        var seen: [UInt64: Int] = [:]
        var next: [String: Entry] = [:]
        diff.clientIDs.reserveCapacity(footprints.count)

        for (index, footprint) in footprints.enumerated() {
            let occurrence = seen[footprint.fingerprint, default: 0]
            seen[footprint.fingerprint] = occurrence + 1
            let key = String(footprint.fingerprint, radix: 16) + "#" + String(occurrence)
            let signature = String(footprint.signature, radix: 16)

            if let known = entries[key] {
                if known.signature != signature {
                    diff.upserts.append(.init(index: index, clientID: known.clientID, isNew: false))
                }
                next[key] = Entry(clientID: known.clientID, signature: signature)
                diff.clientIDs.append(known.clientID)
            } else {
                let clientID = makeID()
                diff.upserts.append(.init(index: index, clientID: clientID, isNew: true))
                next[key] = Entry(clientID: clientID, signature: signature)
                diff.clientIDs.append(clientID)
            }
        }

        var removed: [String] = []
        for (key, entry) in entries where next[key] == nil {
            removed.append(entry.clientID)
        }
        diff.removed = removed.sorted()
        entries = next
        return diff
    }
}
