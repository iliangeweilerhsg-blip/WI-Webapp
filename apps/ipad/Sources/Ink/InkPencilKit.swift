import PencilKit
import UIKit

extension InkRGBA {
    init(uiColor: UIColor) {
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 1
        guard uiColor.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
            self.init(red: 0, green: 0, blue: 0)
            return
        }
        self.init(
            red: InkRGBA.byte(red),
            green: InkRGBA.byte(green),
            blue: InkRGBA.byte(blue),
            alpha: InkRGBA.byte(alpha)
        )
    }

    var uiColor: UIColor {
        UIColor(
            red: CGFloat(red) / 255,
            green: CGFloat(green) / 255,
            blue: CGFloat(blue) / 255,
            alpha: CGFloat(alpha) / 255
        )
    }

    private static func byte(_ component: CGFloat) -> UInt8 {
        guard component.isFinite else { return 0 }
        return UInt8((min(1, max(0, component)) * 255).rounded())
    }
}

/// Brücke zwischen PencilKit und dem neutralen Strich-Format (08 §4.3).
/// PencilKit bleibt die Quelle der Wahrheit, das neutrale Format wird daraus abgeleitet.
enum InkPencilKit {
    // MARK: Werkzeuge

    static func inkType(for style: InkPenStyle) -> PKInkingTool.InkType {
        switch style {
        case .fountain: return .fountainPen
        case .fineliner: return .pen
        case .monoline: return .monoline
        case .pencil: return .pencil
        }
    }

    /// `.fountainPen` heißt im Schema `fountain`. Tinten, die das Schema nicht kennt, werden wie `pen` behandelt.
    static func strokeTool(for inkType: PKInkingTool.InkType) -> StrokeTool {
        switch inkType {
        case .pen: return .pen
        case .pencil: return .pencil
        case .marker: return .marker
        case .monoline: return .monoline
        case .fountainPen: return .fountain
        default: return .pen
        }
    }

    /// Das PencilKit-Werkzeug zum Zustand der Werkzeugleiste
    static func tool(for state: InkToolState) -> any PKTool {
        switch state.tool {
        case .pen(let style):
            return inkingTool(inkType(for: style), state: state)
        case .marker:
            return inkingTool(.marker, state: state)
        case .eraser:
            return PKEraserTool(state.eraserMode == .stroke ? .vector : .bitmap)
        case .lasso:
            return PKLassoTool()
        }
    }

    private static func inkingTool(_ inkType: PKInkingTool.InkType, state: InkToolState) -> PKInkingTool {
        let color = (state.currentColor ?? InkToolState.defaultFavoriteColors[0]).uiColor
        let range = inkType.validWidthRange
        let wanted = CGFloat(state.currentWidth ?? Double(inkType.defaultWidth))
        let width = min(range.upperBound, max(range.lowerBound, wanted))
        return PKInkingTool(inkType, color: color, width: width)
    }

    // MARK: Striche

    /// Liest einen PencilKit-Strich aus. Die Punkte liegen auf der Kurve (nicht die Stützpunkte des Splines),
    /// damit die Web-App denselben Verlauf zeichnet.
    static func sample(from stroke: PKStroke, layer: StrokeLayer) -> InkStrokeSample {
        let path = stroke.path
        var points: [PKStrokePoint] = []
        if path.count >= 2 {
            points = Array(path.interpolatedPoints(by: .parametricStep(1)))
        }
        if points.isEmpty {
            points = Array(path)
        }
        return InkStrokeSample(
            tool: strokeTool(for: stroke.ink.inkType),
            layer: layer,
            color: InkRGBA(uiColor: stroke.ink.color),
            width: baseWidth(of: points),
            createdAt: path.creationDate,
            transform: transformValues(stroke.transform),
            points: points.map { point in
                InkPointSample(
                    x: Double(point.location.x),
                    y: Double(point.location.y),
                    timeOffset: point.timeOffset,
                    force: Double(point.force),
                    azimuth: Double(point.azimuth),
                    altitude: Double(point.altitude)
                )
            }
        )
    }

    /// Erkennungsmerkmale ohne den ganzen Strich umzurechnen (läuft bei jeder Änderung über alle Striche)
    static func footprint(of stroke: PKStroke) -> InkStrokeFootprint {
        let path = stroke.path
        var head: [Float] = []
        var firstWidth = 0.0
        for (index, point) in path.prefix(3).enumerated() {
            head.append(Float(point.location.x))
            head.append(Float(point.location.y))
            if index == 0 {
                firstWidth = Double(max(point.size.width, point.size.height))
            }
        }
        return InkStrokeFootprint(
            createdAtMS: InkStrokeCodec.milliseconds(path.creationDate),
            pointCount: path.count,
            head: head,
            tool: strokeTool(for: stroke.ink.inkType),
            color: InkRGBA(uiColor: stroke.ink.color),
            width: firstWidth,
            transform: transformValues(stroke.transform)
        )
    }

    static func transformValues(_ transform: CGAffineTransform) -> [Double] {
        [
            Double(transform.a), Double(transform.b), Double(transform.c),
            Double(transform.d), Double(transform.tx), Double(transform.ty),
        ]
    }

    /// Grundbreite: Median der Punktgrößen. `PKStroke` kennt keine Breite, sie steckt in den Punkten.
    /// Ob der Median oder die eingestellte Werkzeugbreite im Web besser passt, klärt die Kalibrierung
    /// am Gerät (Spike S3-U2).
    static func baseWidth(of points: [PKStrokePoint]) -> Double {
        let sizes = points.map { Double(max($0.size.width, $0.size.height)) }.filter { $0.isFinite && $0 > 0 }.sorted()
        guard !sizes.isEmpty else { return 0 }
        return sizes[sizes.count / 2]
    }
}
