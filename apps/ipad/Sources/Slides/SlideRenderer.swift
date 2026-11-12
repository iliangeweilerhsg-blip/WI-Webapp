import CoreGraphics
import Foundation
import UIKit

/// Fertiges Bild, das die Aufgabe verlassen darf. `UIImage` ist unveränderlich und wird nach dem Zeichnen nicht mehr
/// angefasst.
private struct RenderedSlide: @unchecked Sendable {
    let image: UIImage?
}

/// Rendert eine PDF-Seite zu einem Bild (Plan PR 4, §4.5). Läuft außerhalb des Main-Actors: Das PDF wird **in** der
/// abgetrennten Aufgabe geöffnet, nur das fertige Bild geht zurück (`CGPDFDocument` ist nicht `Sendable`).
enum SlideRenderer {
    /// Längste Kante der Bilder in Pixel
    static let defaultMaxPixel = 2048

    /// - Parameters:
    ///   - pageNumber: 1-basiert (gleich `SlideRef.index`)
    ///   - maxPixel: längste Kante des Bildes in Pixel
    /// - Returns: `nil` bei unlesbarem PDF, Seite außerhalb oder Abbruch
    static func image(pdf: URL, pageNumber: Int, maxPixel: Int = SlideRenderer.defaultMaxPixel) async -> UIImage? {
        guard pageNumber >= 1, maxPixel > 0 else { return nil }
        let task = _Concurrency.Task.detached(priority: .userInitiated) { () -> RenderedSlide in
            RenderedSlide(image: SlideRenderer.renderSync(pdf: pdf, pageNumber: pageNumber, maxPixel: maxPixel))
        }
        // Ein neuer Auftrag bricht den alten ab: Es zählt die letzte Folie
        return await withTaskCancellationHandler {
            await task.value.image
        } onCancel: {
            task.cancel()
        }
    }

    /// Größe des Bildes in Pixel für eine Seite von `size` pt, längste Kante = `maxPixel`
    static func pixelSize(forPage size: CGSize, maxPixel: Int) -> CGSize {
        guard size.width > 0, size.height > 0, maxPixel > 0 else { return .zero }
        let scale = CGFloat(maxPixel) / max(size.width, size.height)
        return CGSize(width: max(1, (size.width * scale).rounded()), height: max(1, (size.height * scale).rounded()))
    }

    /// Seitengröße in pt nach Drehung der Seite (`cropBox`)
    static func displaySize(of page: CGPDFPage) -> CGSize {
        let box = page.getBoxRect(.cropBox)
        let rotated = page.rotationAngle % 180 != 0
        return rotated ? CGSize(width: box.height, height: box.width) : box.size
    }

    private static func renderSync(pdf: URL, pageNumber: Int, maxPixel: Int) -> UIImage? {
        if _Concurrency.Task.isCancelled { return nil }
        guard let document = CGPDFDocument(pdf as CFURL), pageNumber <= document.numberOfPages,
            let page = document.page(at: pageNumber)
        else { return nil }
        let target = pixelSize(forPage: displaySize(of: page), maxPixel: maxPixel)
        guard target.width > 0, target.height > 0 else { return nil }
        if _Concurrency.Task.isCancelled { return nil }

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: target, format: format)
        return renderer.image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: target))
            let cg = context.cgContext
            // PDF hat den Ursprung unten links
            cg.translateBy(x: 0, y: target.height)
            cg.scaleBy(x: 1, y: -1)
            cg.concatenate(
                page.getDrawingTransform(
                    .cropBox, rect: CGRect(origin: .zero, size: target), rotate: 0, preserveAspectRatio: true))
            cg.drawPDFPage(page)
        }
    }
}

/// Kleiner Speicher für gerenderte Folien: höchstens `capacity` Bilder (aktuelle, vorige, nächste Folie). Das ist
/// die Obergrenze für den Speicher der Folien (rund 12 MB je Bild bei 2048 px).
@MainActor
final class SlideImageCache {
    let capacity: Int
    private var order: [String] = []
    private var images: [String: UIImage] = [:]

    init(capacity: Int = 3) {
        self.capacity = max(1, capacity)
    }

    var count: Int { images.count }

    func image(for key: String) -> UIImage? {
        guard let image = images[key] else { return nil }
        order.removeAll { $0 == key }
        order.append(key)
        return image
    }

    func store(_ image: UIImage, for key: String) {
        images[key] = image
        order.removeAll { $0 == key }
        order.append(key)
        while order.count > capacity {
            let oldest = order.removeFirst()
            images[oldest] = nil
        }
    }

    /// Speicherwarnung: alles verwerfen, außer dem sichtbaren Bild
    func purge(keeping key: String?) {
        for stored in Array(images.keys) where stored != key {
            images[stored] = nil
        }
        order = order.filter { $0 == key }
    }

    static func key(deckID: String, slideID: String) -> String {
        "\(deckID)/\(slideID)"
    }
}
