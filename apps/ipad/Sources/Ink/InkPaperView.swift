import UIKit

/// Papier mit Vorlage (liniert, kariert, Punktraster). Zeichnet in Seitenkoordinaten und skaliert mit dem Rahmen
/// (`contentMode = .redraw`), damit die Linien in jeder Zoomstufe scharf bleiben. Die Zahlen kommen aus
/// `InkTemplateGeometry`.
final class InkPaperView: UIView {
    let pageSize: CGSize

    var template: PageTemplate {
        didSet {
            if template != oldValue { setNeedsDisplay() }
        }
    }

    init(pageSize: CGSize, template: PageTemplate) {
        self.pageSize = pageSize
        self.template = template
        super.init(frame: .zero)
        contentMode = .redraw
        isOpaque = true
        isUserInteractionEnabled = false
        backgroundColor = UIColor(
            red: InkTemplateGeometry.paperRGB.red, green: InkTemplateGeometry.paperRGB.green,
            blue: InkTemplateGeometry.paperRGB.blue, alpha: 1)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) wird nicht verwendet")
    }

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext(), pageSize.width > 0, pageSize.height > 0,
            bounds.width > 0
        else { return }
        let scale = bounds.width / pageSize.width
        context.saveGState()
        context.scaleBy(x: scale, y: scale)
        InkTemplateGeometry.draw(template: template, size: pageSize, in: context)
        context.restoreGState()
    }
}
