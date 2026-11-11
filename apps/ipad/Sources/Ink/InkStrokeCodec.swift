import Foundation

/// Ein Punkt, wie ihn die Erfassung liefert (PencilKit: `PKStrokePoint`), noch nicht normiert
struct InkPointSample: Equatable, Sendable {
    var x: Double
    var y: Double
    /// Sekunden seit Beginn des Strichs
    var timeOffset: Double
    /// Rohdruck des Stifts, nicht normiert
    var force: Double
    var azimuth: Double
    var altitude: Double
}

/// Ein Strich, wie ihn die Erfassung liefert. Unabhängig von PencilKit, damit das Umrechnen
/// ins Schema eine reine Funktion bleibt.
struct InkStrokeSample: Equatable, Sendable {
    var tool: StrokeTool
    var layer: StrokeLayer
    var color: InkRGBA
    /// Grundbreite in pt
    var width: Double
    /// Beginn des Strichs
    var createdAt: Date
    /// `[a, b, c, d, e, f]` wie `CGAffineTransform`
    var transform: [Double]
    /// Koordinaten vor `transform`, in Seitenpunkten
    var points: [InkPointSample]
}

/// Ein gepackter Punkt des Schemas (08 §4.2): sechs `Float32`
struct InkPackedPoint: Equatable, Sendable {
    var x: Float
    var y: Float
    /// ms seit `created_at`
    var dt: Float
    /// 0–1
    var force: Float
    var azimuth: Float
    var altitude: Float
}

struct InkCodecOptions: Equatable, Sendable {
    /// Teiler, der den Rohdruck auf 0–1 bringt. Der Apple Pencil meldet über `UITouch` höchstens
    /// 25/6 ≈ 4,17. Ob PencilKit denselben Bereich nutzt, ist am Gerät zu messen (Spike S3-U1).
    var forceDivisor: Double = 25.0 / 6.0
    /// Deckkraft des Textmarkers im Schema, wenn die Farbe deckend ankommt (Testdaten: `#FFE06666`)
    var markerAlpha: UInt8 = 0x66
    /// Der Core nimmt je Strich höchstens 750 000 Byte an (VERTRAEGE §11.3)
    var maxPoints: Int = InkStrokeCodec.maxPointsPerStroke

    static let standard = InkCodecOptions()
}

enum InkCodecError: Error, Equatable {
    case notBase64
    case badLength(Int)
}

/// Umrechnung zwischen der Erfassung und dem neutralen Strich-Format (08 §4, `Stroke` in `ink.schema.json`).
/// Alles hier ist rein: gleiche Eingabe, gleiche Ausgabe, keine Uhr, kein Zufall.
enum InkStrokeCodec {
    static let floatsPerPoint = 6
    static let bytesPerPoint = 24
    static let maxPointsPerStroke = 750_000 / 24

    static let identityTransform: [Double] = [1, 0, 0, 1, 0, 0]

    // MARK: Punkte packen

    /// Base64 von n × 6 `Float32` little-endian. 24 Byte je Punkt ergeben nie Padding.
    static func packPoints(_ points: [InkPackedPoint]) -> String {
        var data = Data(capacity: points.count * bytesPerPoint)
        for point in points {
            for value in [point.x, point.y, point.dt, point.force, point.azimuth, point.altitude] {
                let bits = value.bitPattern
                data.append(UInt8(truncatingIfNeeded: bits))
                data.append(UInt8(truncatingIfNeeded: bits >> 8))
                data.append(UInt8(truncatingIfNeeded: bits >> 16))
                data.append(UInt8(truncatingIfNeeded: bits >> 24))
            }
        }
        return data.base64EncodedString()
    }

    static func unpackPoints(_ base64: String) throws -> [InkPackedPoint] {
        guard let data = Data(base64Encoded: base64) else { throw InkCodecError.notBase64 }
        let bytes = [UInt8](data)
        guard !bytes.isEmpty, bytes.count % bytesPerPoint == 0 else {
            throw InkCodecError.badLength(bytes.count)
        }
        func float(at offset: Int) -> Float {
            let bits =
                UInt32(bytes[offset])
                | UInt32(bytes[offset + 1]) << 8
                | UInt32(bytes[offset + 2]) << 16
                | UInt32(bytes[offset + 3]) << 24
            return Float(bitPattern: bits)
        }
        var points: [InkPackedPoint] = []
        points.reserveCapacity(bytes.count / bytesPerPoint)
        var offset = 0
        while offset < bytes.count {
            points.append(
                InkPackedPoint(
                    x: float(at: offset),
                    y: float(at: offset + 4),
                    dt: float(at: offset + 8),
                    force: float(at: offset + 12),
                    azimuth: float(at: offset + 16),
                    altitude: float(at: offset + 20)
                )
            )
            offset += bytesPerPoint
        }
        return points
    }

    // MARK: Erfassung → Schema

    /// Normiert die Punkte: `dt` beginnt bei 0 und fällt nie, der Druck liegt in 0–1.
    /// Zu lange Striche werden gleichmäßig ausgedünnt, der letzte Punkt bleibt erhalten.
    static func normalize(_ points: [InkPointSample], options: InkCodecOptions = .standard) -> [InkPackedPoint] {
        guard let first = points.first else { return [] }
        let kept = thin(points, to: max(1, options.maxPoints))
        let divisor = options.forceDivisor > 0 ? options.forceDivisor : 1
        var lastDt: Float = 0
        var packed: [InkPackedPoint] = []
        packed.reserveCapacity(kept.count)
        for point in kept {
            let rawDt = Float((point.timeOffset - first.timeOffset) * 1000)
            let dt = rawDt.isFinite ? max(lastDt, rawDt) : lastDt
            lastDt = dt
            let force = point.force / divisor
            packed.append(
                InkPackedPoint(
                    x: Float(point.x),
                    y: Float(point.y),
                    dt: dt,
                    force: force.isFinite ? Float(min(1, max(0, force))) : 0,
                    azimuth: point.azimuth.isFinite ? Float(point.azimuth) : 0,
                    altitude: point.altitude.isFinite ? Float(point.altitude) : 0
                )
            )
        }
        return packed
    }

    /// Wandelt einen erfassten Strich ins Schema. `nil`, wenn der Strich dort ungültig wäre
    /// (keine Punkte, Breite ≤ 0, Werte nicht endlich). So entsteht nie eine Operation, die der Core ablehnt.
    ///
    /// - Parameters:
    ///   - clientID: stabile UUIDv7 des Strichs
    ///   - sessionStartedAt: Start der laufenden Session, `nil` außerhalb einer Session
    static func encode(
        _ sample: InkStrokeSample,
        clientID: String,
        sessionStartedAt: Date? = nil,
        options: InkCodecOptions = .standard
    ) -> Stroke? {
        let points = normalize(sample.points, options: options)
        guard let last = points.last else { return nil }
        guard sample.width.isFinite, sample.width > 0, Float(sample.width).isFinite else { return nil }
        guard sample.transform.count == 6, sample.transform.allSatisfy({ $0.isFinite && Float($0).isFinite }) else {
            return nil
        }
        guard points.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { return nil }
        guard let bbox = boundingBox(of: points, transform: sample.transform, width: sample.width) else {
            return nil
        }

        let createdAt = milliseconds(sample.createdAt)
        var start: Int?
        var end: Int?
        if let sessionStartedAt {
            // SessionMs ist ≥ 0: Striche von vor dem Start (z. B. per Lasso verschoben) beginnen bei 0
            let offset = max(0, createdAt - milliseconds(sessionStartedAt))
            start = offset
            end = offset + Int(last.dt.rounded())
        }

        var color = sample.color
        if sample.tool == .marker, color.alpha == 255 {
            color = color.withAlpha(options.markerAlpha)
        }

        return Stroke(
            bbox: bbox,
            clientID: clientID,
            color: color.hex,
            createdAt: createdAt,
            layer: sample.layer,
            points: packPoints(points),
            tEndMS: end,
            tStartMS: start,
            tool: sample.tool,
            transform: sample.transform,
            width: sample.width
        )
    }

    /// `[x, y, w, h]` nach `transform`, mit halber Strichbreite als Rand, auf 0,01 pt gerundet
    static func boundingBox(of points: [InkPackedPoint], transform: [Double], width: Double) -> [Double]? {
        guard !points.isEmpty, transform.count == 6 else { return nil }
        var minX = Double.infinity
        var minY = Double.infinity
        var maxX = -Double.infinity
        var maxY = -Double.infinity
        for point in points {
            let x = Double(point.x)
            let y = Double(point.y)
            let tx = transform[0] * x + transform[2] * y + transform[4]
            let ty = transform[1] * x + transform[3] * y + transform[5]
            minX = min(minX, tx)
            minY = min(minY, ty)
            maxX = max(maxX, tx)
            maxY = max(maxY, ty)
        }
        let half = width / 2
        let box = [minX - half, minY - half, maxX - minX + width, maxY - minY + width].map(round2)
        guard box.allSatisfy({ $0.isFinite && Float($0).isFinite }) else { return nil }
        return box
    }

    static func milliseconds(_ date: Date) -> Int {
        Int((date.timeIntervalSince1970 * 1000).rounded())
    }

    // MARK: Hilfen

    private static func round2(_ value: Double) -> Double {
        (value * 100).rounded() / 100
    }

    /// Höchstens `limit` Punkte, gleichmäßig verteilt. Erster und letzter Punkt bleiben.
    static func thin(_ points: [InkPointSample], to limit: Int) -> [InkPointSample] {
        guard points.count > limit, limit >= 2 else {
            return points.count > limit ? Array(points.prefix(limit)) : points
        }
        var kept: [InkPointSample] = []
        kept.reserveCapacity(limit)
        let step = Double(points.count - 1) / Double(limit - 1)
        for index in 0..<limit {
            kept.append(points[min(points.count - 1, Int((Double(index) * step).rounded()))])
        }
        return kept
    }
}
