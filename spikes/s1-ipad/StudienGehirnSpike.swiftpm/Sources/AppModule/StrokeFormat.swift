import Foundation
import CoreGraphics
#if canImport(PencilKit) && canImport(UIKit)
import PencilKit
import UIKit
#endif

// MARK: - Neutrales Strich-Format nach 08-SCHNITTSTELLEN.md §4.1 & §4.2

/// Ein einzelner Strichpunkt im neutralen Format (6 × Float32 Little-Endian = 24 Byte).
/// Reihenfolge laut 08 §4.2: `x, y, dt, force (pressure), azimuth, altitude`.
/// Die Koordinaten `x` und `y` liegen im Seitenkoordinatensystem VOR Anwendung von `transform`.
public struct NeutralStrokePoint: Equatable, Sendable {
    public var x: Float
    public var y: Float
    public var dt: Float
    public var pressure: Float
    public var azimuth: Float
    public var altitude: Float

    public init(
        x: Float,
        y: Float,
        dt: Float,
        pressure: Float,
        azimuth: Float,
        altitude: Float
    ) {
        self.x = x
        self.y = y
        self.dt = dt
        self.pressure = pressure
        self.azimuth = azimuth
        self.altitude = altitude
    }
}

/// Neutrales JSON-Strich-Objekt gemäß 08-SCHNITTSTELLEN.md §4.1.
public struct NeutralStrokePayload: Codable, Equatable, Sendable {
    public var client_id: String
    public var tool: String
    public var layer: String
    public var color: String
    public var width: Double
    public var created_at: Int64
    public var t_start_ms: Int64
    public var t_end_ms: Int64
    public var transform: [Double]
    public var bbox: [Double]
    public var points: String
    /// Zeitstempel beim Absetzen des Stifts (in Mac-Uhrzeit nach Ping-Pong-Abgleich) für die Latenzmessung (S3).
    public var t_pen_up_ms: Double?

    public init(
        client_id: String,
        tool: String,
        layer: String,
        color: String,
        width: Double,
        created_at: Int64,
        t_start_ms: Int64,
        t_end_ms: Int64,
        transform: [Double],
        bbox: [Double],
        points: String,
        t_pen_up_ms: Double? = nil
    ) {
        self.client_id = client_id
        self.tool = tool
        self.layer = layer
        self.color = color
        self.width = width
        self.created_at = created_at
        self.t_start_ms = t_start_ms
        self.t_end_ms = t_end_ms
        self.transform = transform
        self.bbox = bbox
        self.points = points
        self.t_pen_up_ms = t_pen_up_ms
    }
}

/// Umwandlung, Binär-Kodierung (6 × Float32 LE, Base64), UUIDv7 und Bounding-Box-Berechnung.
public enum StrokeFormat {
    /// Vorläufiger Normierungsdivisor für Apple Pencil `PKStrokePoint.force` -> `[0.0, 1.0]`.
    /// Die echten Rohwerte werden im Spike S3 parallel im „Rohwerte"-Tab ungefiltert erfasst.
    public static let defaultPencilForceDivisor: Float = 3.5

    /// Erzeugt eine RFC-9562-konforme UUIDv7 (`xxxxxxxx-xxxx-7xxx-[89ab]xxx-xxxxxxxxxxxx`)
    /// mit 48-Bit-Millisekunden-Zeitstempel gemäß 08 §4.1.
    public static func generateUUIDv7(timestampMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000.0)) -> String {
        let ts = UInt64(max(0, timestampMs)) & 0x0000_FFFF_FFFF_FFFF
        var bytes = [UInt8](repeating: 0, count: 16)

        // Bytes 0..5: 48-Bit Timestamp Big-Endian
        bytes[0] = UInt8((ts >> 40) & 0xFF)
        bytes[1] = UInt8((ts >> 32) & 0xFF)
        bytes[2] = UInt8((ts >> 24) & 0xFF)
        bytes[3] = UInt8((ts >> 16) & 0xFF)
        bytes[4] = UInt8((ts >> 8) & 0xFF)
        bytes[5] = UInt8(ts & 0xFF)

        // Bytes 6..15: Zufallsbits
        for i in 6..<16 {
            bytes[i] = UInt8.random(in: 0...255)
        }

        // Byte 6: Version 7 (0b0111xxxx)
        bytes[6] = (bytes[6] & 0x0F) | 0x70
        // Byte 8: RFC-4122/9562 Variante (0b10xxxxxx)
        bytes[8] = (bytes[8] & 0x3F) | 0x80

        return String(
            format: "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
            bytes[0], bytes[1], bytes[2], bytes[3],
            bytes[4], bytes[5],
            bytes[6], bytes[7],
            bytes[8], bytes[9],
            bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
        )
    }

    /// Packt ein Array von `NeutralStrokePoint` in `6 × Float32` Little-Endian (24 Byte/Punkt) und kodiert es als Base64.
    /// Reihenfolge laut 08 §4.2: `x, y, dt, force (pressure), azimuth, altitude`.
    /// Erzwingt für den allerersten Punkt `dt = 0.0` gemäß 08 §4.2.
    public static func packPointsToBase64(_ points: [NeutralStrokePoint]) -> String {
        guard !points.isEmpty else { return "" }
        var data = Data(capacity: points.count * 24)
        for (idx, pt) in points.enumerated() {
            let effectiveDt: Float = (idx == 0) ? 0.0 : max(0.0, pt.dt)
            let clampedPressure: Float = min(1.0, max(0.0, pt.pressure))
            appendFloat32LE(pt.x, to: &data)
            appendFloat32LE(pt.y, to: &data)
            appendFloat32LE(effectiveDt, to: &data)
            appendFloat32LE(clampedPressure, to: &data)
            appendFloat32LE(pt.azimuth, to: &data)
            appendFloat32LE(pt.altitude, to: &data)
        }
        return data.base64EncodedString()
    }

    /// Entpackt einen Base64-String (`6 × Float32` Little-Endian: `x, y, dt, pressure, azimuth, altitude`)
    /// zurück in `[NeutralStrokePoint]`.
    public static func unpackPointsFromBase64(_ base64: String) -> [NeutralStrokePoint]? {
        guard let data = Data(base64Encoded: base64),
              !data.isEmpty,
              data.count % 24 == 0 else {
            return nil
        }
        let count = data.count / 24
        var result: [NeutralStrokePoint] = []
        result.reserveCapacity(count)

        data.withUnsafeBytes { rawBuf in
            for i in 0..<count {
                let offset = i * 24
                let x = readFloat32LE(rawBuf, offset: offset)
                let y = readFloat32LE(rawBuf, offset: offset + 4)
                let dt = readFloat32LE(rawBuf, offset: offset + 8)
                let pressure = readFloat32LE(rawBuf, offset: offset + 12)
                let azimuth = readFloat32LE(rawBuf, offset: offset + 16)
                let altitude = readFloat32LE(rawBuf, offset: offset + 20)
                result.append(
                    NeutralStrokePoint(
                        x: x,
                        y: y,
                        dt: dt,
                        pressure: pressure,
                        azimuth: azimuth,
                        altitude: altitude
                    )
                )
            }
        }
        return result
    }

    /// Berechnet die umschließende Box `[x, y, w, h]` NACH Anwendung von `transform`
    /// inklusive halber Strichbreite (`width / 2.0`), exakt nach 08 §4.1.
    public static func computeBbox(
        points: [NeutralStrokePoint],
        transform: [Double],
        width: Double
    ) -> [Double] {
        guard !points.isEmpty, transform.count == 6 else {
            return [0.0, 0.0, 0.0, 0.0]
        }
        let a = transform[0]
        let b = transform[1]
        let c = transform[2]
        let d = transform[3]
        let tx = transform[4]
        let ty = transform[5]

        let halfW = max(0.0, width) / 2.0
        var minX = Double.greatestFiniteMagnitude
        var minY = Double.greatestFiniteMagnitude
        var maxX = -Double.greatestFiniteMagnitude
        var maxY = -Double.greatestFiniteMagnitude

        for pt in points {
            let px = Double(pt.x)
            let py = Double(pt.y)
            let xT = a * px + c * py + tx
            let yT = b * px + d * py + ty
            if xT < minX { minX = xT }
            if yT < minY { minY = yT }
            if xT > maxX { maxX = xT }
            if yT > maxY { maxY = yT }
        }

        let bx = round2(minX - halfW)
        let by = round2(minY - halfW)
        let bw = round2((maxX - minX) + 2.0 * halfW)
        let bh = round2((maxY - minY) + 2.0 * halfW)
        return [bx, by, bw, bh]
    }

    private static func appendFloat32LE(_ value: Float, to data: inout Data) {
        var bits = value.bitPattern.littleEndian
        withUnsafeBytes(of: &bits) { ptr in
            data.append(contentsOf: ptr)
        }
    }

    private static func readFloat32LE(_ raw: UnsafeRawBufferPointer, offset: Int) -> Float {
        var bits: UInt32 = 0
        withUnsafeMutableBytes(of: &bits) { dst in
            for idx in 0..<4 {
                dst[idx] = raw[offset + idx]
            }
        }
        return Float(bitPattern: UInt32(littleEndian: bits))
    }

    public static func round2(_ val: Double) -> Double {
        (val * 100.0).rounded() / 100.0
    }

    #if canImport(PencilKit) && canImport(UIKit)
    /// Wandelt einen `PKStroke` aus PencilKit in das neutrale Format gemäß 08 §4.1/§4.2 um.
    public static func fromPKStroke(
        _ stroke: PKStroke,
        layer: String,
        fallbackWidth: Double,
        sessionStartMs: Int64,
        clockOffsetMs: Double
    ) -> (payload: NeutralStrokePayload, rawSamples: [RawPointMeasurement], isPencilInput: Bool) {
        let toolName = mapInkType(stroke.ink.inkType)
        let hexColor = uiColorToRgbaHex(stroke.ink.color)

        let path = stroke.path
        let firstTimeOffset = path.first?.timeOffset ?? 0.0
        var neutralPoints: [NeutralStrokePoint] = []
        var rawSamples: [RawPointMeasurement] = []
        neutralPoints.reserveCapacity(path.count)
        rawSamples.reserveCapacity(path.count)

        var widthAccum: Double = 0.0
        var detectedPencil = false

        for (index, pt) in path.enumerated() {
            let dtMs: Float = (index == 0)
                ? 0.0
                : Float(max(0.0, (pt.timeOffset - firstTimeOffset) * 1000.0))

            // Apple Pencil 2 liefert Neigungswinkel < pi/2 oder positive Druckwerte > 0.
            // Beim Zeichnen mit dem Finger ist altitude typischerweise exakt pi/2 (1.5708) und azimuth 0.
            if pt.altitude < (.pi / 2.0 - 0.001) || abs(pt.azimuth) > 0.0001 {
                detectedPencil = true
            }

            let rawForce = Float(pt.force)
            let normalizedPressure: Float
            if rawForce > 0.0 {
                normalizedPressure = min(1.0, max(0.05, rawForce / defaultPencilForceDivisor))
            } else {
                normalizedPressure = 0.5
            }

            neutralPoints.append(
                NeutralStrokePoint(
                    x: Float(pt.location.x),
                    y: Float(pt.location.y),
                    dt: dtMs,
                    pressure: normalizedPressure,
                    azimuth: Float(pt.azimuth),
                    altitude: Float(pt.altitude)
                )
            )

            rawSamples.append(
                RawPointMeasurement(
                    force: Double(pt.force),
                    altitude: Double(pt.altitude),
                    azimuth: Double(pt.azimuth),
                    sizeWidth: Double(pt.size.width),
                    sizeHeight: Double(pt.size.height)
                )
            )
            widthAccum += Double(pt.size.width)
        }

        let avgPointWidth = path.isEmpty ? fallbackWidth : (widthAccum / Double(path.count))
        let strokeWidth = round2(avgPointWidth > 0.1 ? avgPointWidth : fallbackWidth)

        // S6: transform mit voller Genauigkeit übertragen (nicht runden; nur bbox wird gerundet)
        let t = stroke.transform
        let transformArray: [Double] = [
            Double(t.a),
            Double(t.b),
            Double(t.c),
            Double(t.d),
            Double(t.tx),
            Double(t.ty)
        ]

        let bbox = computeBbox(points: neutralPoints, transform: transformArray, width: strokeWidth)
        let base64Points = packPointsToBase64(neutralPoints)

        // created_at mit dem Ping-Pong-Uhr-Offset korrigieren
        let rawCreatedMs = stroke.path.creationDate.timeIntervalSince1970 * 1000.0
        let createdAtMs = Int64((rawCreatedMs + clockOffsetMs).rounded())
        let localCreatedMs = Int64(rawCreatedMs.rounded())
        let durationMs = Int64(neutralPoints.last?.dt ?? 0.0)
        let tStartMs = max(0, localCreatedMs - sessionStartMs)
        let tEndMs = tStartMs + max(0, durationMs)
        let nowMacMs = Date().timeIntervalSince1970 * 1000.0 + clockOffsetMs

        let payload = NeutralStrokePayload(
            client_id: generateUUIDv7(timestampMs: createdAtMs),
            tool: toolName,
            layer: layer,
            color: hexColor,
            width: strokeWidth,
            created_at: createdAtMs,
            t_start_ms: tStartMs,
            t_end_ms: tEndMs,
            transform: transformArray,
            bbox: bbox,
            points: base64Points,
            t_pen_up_ms: nowMacMs
        )

        return (payload, rawSamples, detectedPencil)
    }

    public static func mapInkType(_ inkType: PKInkingTool.InkType) -> String {
        switch inkType {
        case .pen:
            return "pen"
        case .fountainPen:
            return "fountain"
        case .pencil:
            return "pencil"
        case .monoline:
            return "monoline"
        case .marker:
            return "marker"
        default:
            return "pen"
        }
    }

    public static func uiColorToRgbaHex(_ color: UIColor) -> String {
        var r: CGFloat = 0
        var g: CGFloat = 0
        var b: CGFloat = 0
        var a: CGFloat = 1
        if !color.getRed(&r, green: &g, blue: &b, alpha: &a) {
            if let comps = color.cgColor.components, comps.count >= 2 {
                r = comps[0]
                g = comps[0]
                b = comps[0]
                a = comps.last ?? 1.0
            }
        }
        let ri = Int(min(255, max(0, (r * 255.0).rounded())))
        let gi = Int(min(255, max(0, (g * 255.0).rounded())))
        let bi = Int(min(255, max(0, (b * 255.0).rounded())))
        let ai = Int(min(255, max(0, (a * 255.0).rounded())))
        return String(format: "#%02X%02X%02X%02X", ri, gi, bi, ai)
    }
    #endif
}

// MARK: - Rohwert-Messung für Spike S3 (Pencil vs. Finger je Werkzeug)

public struct RawPointMeasurement: Codable, Sendable {
    public var force: Double
    public var altitude: Double
    public var azimuth: Double
    public var sizeWidth: Double
    public var sizeHeight: Double
}

public struct MetricMinMedMax: Codable, Sendable {
    public var count: Int
    public var min: Double
    public var median: Double
    public var max: Double

    public static func compute(from values: [Double]) -> MetricMinMedMax {
        guard !values.isEmpty else {
            return MetricMinMedMax(count: 0, min: 0, median: 0, max: 0)
        }
        let sorted = values.sorted()
        let c = sorted.count
        let med: Double
        if c % 2 == 1 {
            med = sorted[c / 2]
        } else {
            med = (sorted[c / 2 - 1] + sorted[c / 2]) / 2.0
        }
        return MetricMinMedMax(
            count: c,
            min: (sorted.first! * 1000.0).rounded() / 1000.0,
            median: (med * 1000.0).rounded() / 1000.0,
            max: (sorted.last! * 1000.0).rounded() / 1000.0
        )
    }
}

public struct ToolInputRawSummary: Codable, Identifiable, Sendable {
    public var id: String { "\(tool)-\(inputType)" }
    public var tool: String
    public var inputType: String // "pencil" oder "finger"
    public var strokeCount: Int
    public var pointCount: Int
    public var force: MetricMinMedMax
    public var altitude: MetricMinMedMax
    public var azimuth: MetricMinMedMax
    public var sizeWidth: MetricMinMedMax
    public var sizeHeight: MetricMinMedMax
}

// MARK: - Selbsttest beim App-Start gegen tests/fixtures/strokes/01-handschrift-pen.json

public enum StrokeFormatSelfTest {
    /// Erster Strich (`client_id: "019a4e13-9ea0-760e-8a70-2e469682a530"`, 138 Punkte = 3312 Byte = 4416 Base64-Zeichen)
    /// direkt aus `tests/fixtures/strokes/01-handschrift-pen.json`.
    public static let fixture01Stroke1Base64 =
        "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"

    public static let expectedBbox: [Double] = [56.67, 126.75, 45.98, 34.45]

    /// Führt den Selbsttest für das neutrale Strich-Format (08 §4.2) aus.
    /// Gibt `(passed: Bool, message: String)` zurück.
    public static func run() -> (passed: Bool, message: String) {
        // 1. Base64-Länge prüfen (138 Punkte * 24 Byte = 3312 Byte -> 4416 Base64-Zeichen)
        guard fixture01Stroke1Base64.count == 4416 else {
            return (false, "Fixture Base64-Länge \(fixture01Stroke1Base64.count) != 4416")
        }

        // 2. Entpacken prüfen
        guard let points = StrokeFormat.unpackPointsFromBase64(fixture01Stroke1Base64),
              points.count == 138 else {
            return (false, "Entpacken von fixture01Stroke1Base64 fehlgeschlagen")
        }

        // 3. Erster Punkt prüfen: dt == 0.0, x == 58.0, y == 160.0, force ≈ 0.18, azimuth ≈ 0.5478, altitude ≈ 1.1322
        let p0 = points[0]
        guard p0.dt == 0.0,
              abs(p0.x - 58.0) < 0.001,
              abs(p0.y - 160.0) < 0.001,
              abs(p0.pressure - 0.18) < 0.001,
              abs(p0.azimuth - 0.5478) < 0.001,
              abs(p0.altitude - 1.1322) < 0.001 else {
            return (false, "Erster Punkt (inkl. azimuth/altitude) weicht ab: \(p0)")
        }

        // 4. UUIDv7-Format prüfen
        let uuid7 = StrokeFormat.generateUUIDv7(timestampMs: 1_762_246_500_000)
        let uuidParts = uuid7.split(separator: "-")
        guard uuidParts.count == 5,
              uuid7.count == 36,
              uuidParts[2].first == "7",
              ["8", "9", "a", "b"].contains(String(uuidParts[3].first ?? " ")) else {
            return (false, "UUIDv7-Format ungültig: \(uuid7)")
        }

        // 5. Exakter Roundtrip (Erneut packen -> identischer Base64-String)
        let repacked = StrokeFormat.packPointsToBase64(points)
        guard repacked == fixture01Stroke1Base64 else {
            return (false, "Base64-Roundtrip nicht byte-identisch")
        }

        // 6. Bounding-Box nach transform inklusive halber Strichbreite (width = 2.4 -> half = 1.2)
        let computedBbox = StrokeFormat.computeBbox(
            points: points,
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            width: 2.4
        )
        for i in 0..<4 {
            if abs(computedBbox[i] - expectedBbox[i]) > 0.02 {
                return (false, "BBox weicht ab: \(computedBbox) != \(expectedBbox)")
            }
        }

        #if canImport(PencilKit) && canImport(UIKit)
        // 7. Synthetischer PKStroke -> neutrales Format -> Roundtrip & Feldreihenfolge prüfen
        let ink = PKInk(.pen, color: .black)
        let controlPoints = [
            PKStrokePoint(
                location: CGPoint(x: 100.0, y: 200.0),
                timeOffset: 0.0,
                size: CGSize(width: 2.4, height: 2.4),
                opacity: 1.0,
                force: 1.4,
                azimuth: 0.5478,
                altitude: 1.1322
            ),
            PKStrokePoint(
                location: CGPoint(x: 140.0, y: 230.0),
                timeOffset: 0.025,
                size: CGSize(width: 2.4, height: 2.4),
                opacity: 1.0,
                force: 2.1,
                azimuth: 0.6,
                altitude: 1.0
            )
        ]
        let path = PKStrokePath(controlPoints: controlPoints, creationDate: Date())
        let pkStroke = PKStroke(ink: ink, path: path, transform: .identity, mask: nil)
        let converted = StrokeFormat.fromPKStroke(
            pkStroke,
            layer: "ink",
            fallbackWidth: 2.4,
            sessionStartMs: 0,
            clockOffsetMs: 0
        )
        guard let decodedPk = StrokeFormat.unpackPointsFromBase64(converted.payload.points),
              decodedPk.count == 2,
              decodedPk[0].dt == 0.0,
              abs(decodedPk[0].azimuth - 0.5478) < 0.01,
              abs(decodedPk[0].altitude - 1.1322) < 0.01,
              converted.payload.points.count == 64 else {
            return (false, "PKStroke-Konvertierung im Selbsttest fehlgeschlagen")
        }
        #endif

        return (
            true,
            "08 §4.2 Roundtrip OK (138 Punkte, 4416 Base64-Zeichen, azimuth=0.5478, altitude=1.1322, UUIDv7 OK, BBox \(computedBbox))"
        )
    }
}
