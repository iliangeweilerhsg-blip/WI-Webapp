import CoreGraphics
import Foundation

/// Eine Linie einer Vorlage in Seitenkoordinaten (pt, Ursprung oben links)
struct InkTemplateLine: Equatable, Sendable {
    var x1: CGFloat
    var y1: CGFloat
    var x2: CGFloat
    var y2: CGFloat
}

/// Geometrie der Seitenvorlagen (VERTRAEGE §7.4, „Vorlagen-Geometrie“). Reine Funktionen ohne UIKit, damit iPad und
/// Web gleich zeichnen und die Zahlen testbar sind. Einheit pt, Ursprung oben links, `size` = Seitengröße.
enum InkTemplateGeometry {
    /// Rastermaß für kariert und Punktraster: 5 mm = 14,173 pt
    static let grid: CGFloat = 14.173
    /// Linienstärke in pt
    static let lineWidth: CGFloat = 0.7
    /// Durchmesser der Punkte des Punktrasters in pt
    static let dotDiameter: CGFloat = 1.2
    /// Erste Linie der Vorlage „liniert“ und Abstand der Linien in pt
    static let ruledFirst: CGFloat = 60
    static let ruledSpacing: CGFloat = 30
    /// Rand links und rechts der Linien, Abstand der letzten Linie zum unteren Rand in pt
    static let ruledMargin: CGFloat = 40
    static let ruledBottom: CGFloat = 20
    /// Toleranz, damit eine Linie genau auf dem Seitenrand nicht gezeichnet wird
    static let epsilon: CGFloat = 0.001

    /// Papier `#FAF9F5`, Linien `#E3E5E8` (in Hell und Dunkel gleich, die Seite ist immer hell)
    static let paperRGB: (red: CGFloat, green: CGFloat, blue: CGFloat) = (250.0 / 255, 249.0 / 255, 245.0 / 255)
    static let lineRGB: (red: CGFloat, green: CGFloat, blue: CGFloat) = (227.0 / 255, 229.0 / 255, 232.0 / 255)

    /// Was gezeichnet wird. Die Cornell-Vorlage bietet das iPad in Phase 1 nicht an. Kommt sie vom Core, wird sie
    /// wie „liniert“ gezeichnet. Bei „folie“ liegt die Folie später über dem Papier, hier ist es leer.
    static func effectiveTemplate(_ template: PageTemplate) -> PageTemplate {
        template == .cornell ? .liniert : template
    }

    static func lines(for template: PageTemplate, size: CGSize) -> [InkTemplateLine] {
        guard size.width > 0, size.height > 0 else { return [] }
        switch effectiveTemplate(template) {
        case .liniert:
            var result: [InkTemplateLine] = []
            var step = 0
            while true {
                let y = ruledFirst + CGFloat(step) * ruledSpacing
                guard y < size.height - ruledBottom else { break }
                result.append(InkTemplateLine(x1: ruledMargin, y1: y, x2: size.width - ruledMargin, y2: y))
                step += 1
            }
            return result
        case .kariert:
            var result: [InkTemplateLine] = []
            var row = 1
            while CGFloat(row) * grid < size.height - epsilon {
                let y = CGFloat(row) * grid
                result.append(InkTemplateLine(x1: 0, y1: y, x2: size.width, y2: y))
                row += 1
            }
            var column = 1
            while CGFloat(column) * grid < size.width - epsilon {
                let x = CGFloat(column) * grid
                result.append(InkTemplateLine(x1: x, y1: 0, x2: x, y2: size.height))
                column += 1
            }
            return result
        case .blanko, .folie, .punktraster, .cornell:
            return []
        }
    }

    /// Mittelpunkte der Punkte: alle Kreuzungen des Rasters, ohne Rand
    static func dots(for template: PageTemplate, size: CGSize) -> [CGPoint] {
        guard effectiveTemplate(template) == .punktraster, size.width > 0, size.height > 0 else { return [] }
        var result: [CGPoint] = []
        var row = 1
        while CGFloat(row) * grid < size.height - epsilon {
            var column = 1
            while CGFloat(column) * grid < size.width - epsilon {
                result.append(CGPoint(x: CGFloat(column) * grid, y: CGFloat(row) * grid))
                column += 1
            }
            row += 1
        }
        return result
    }

    /// Zeichnet Papier und Vorlage in Seitenkoordinaten (`size`, Ursprung oben links). Der Aufrufer skaliert den
    /// Kontext vorher.
    static func draw(template: PageTemplate, size: CGSize, in context: CGContext) {
        context.setFillColor(red: paperRGB.red, green: paperRGB.green, blue: paperRGB.blue, alpha: 1)
        context.fill(CGRect(origin: .zero, size: size))

        let segments = lines(for: template, size: size)
        if !segments.isEmpty {
            context.setStrokeColor(red: lineRGB.red, green: lineRGB.green, blue: lineRGB.blue, alpha: 1)
            context.setLineWidth(lineWidth)
            for line in segments {
                context.move(to: CGPoint(x: line.x1, y: line.y1))
                context.addLine(to: CGPoint(x: line.x2, y: line.y2))
            }
            context.strokePath()
        }
        let points = dots(for: template, size: size)
        if !points.isEmpty {
            context.setFillColor(red: lineRGB.red, green: lineRGB.green, blue: lineRGB.blue, alpha: 1)
            let radius = dotDiameter / 2
            for dot in points {
                context.fillEllipse(
                    in: CGRect(x: dot.x - radius, y: dot.y - radius, width: dotDiameter, height: dotDiameter))
            }
        }
    }
}

extension PageTemplate {
    /// Vorlagen, die das iPad zur Wahl anbietet. `cornell` (Phase 2) und `folie` (T1-13 Teil 2) nicht.
    static let choices: [PageTemplate] = [.blanko, .liniert, .kariert, .punktraster]

    /// Name für die Oberfläche
    var germanTitle: String {
        switch self {
        case .blanko: return "Blanko"
        case .liniert: return "Liniert"
        case .kariert: return "Kariert"
        case .punktraster: return "Punktraster"
        case .cornell: return "Cornell"
        case .folie: return "Folie"
        }
    }
}
