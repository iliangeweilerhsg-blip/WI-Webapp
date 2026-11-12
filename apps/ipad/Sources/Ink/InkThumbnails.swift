import Foundation
import PencilKit
import UIKit

/// Vorschaubilder der Seitenleiste (T1-13): 240 px breit, JPEG, `Ink/<page_id>/thumb.jpg`.
///
/// Gerendert wird außerhalb des Main-Actors, aus den beiden `PKDrawing`-Daten (nicht aus Ansichten). Über die
/// Isolationsgrenze gehen nur `Data`, Zahlen und Werte. Hinter jedem Speichern einer Seite steht höchstens ein
/// Auftrag je Seite: ein neuer ersetzt den laufenden.
actor InkThumbnailService {
    /// Breite des Vorschaubilds in Pixeln
    static let width: CGFloat = 240
    static let shared = InkThumbnailService(store: FileInkPageStore.standard())

    private let store: FileInkPageStore
    private var jobs: [String: _Concurrency.Task<Void, Never>] = [:]
    /// Vorlage, mit der das Bild einer Seite zuletzt in dieser App-Sitzung gerendert wurde. Weicht die verlangte
    /// Vorlage ab (Vorlage gewechselt), wird neu gerendert, statt das alte Bild zu liefern.
    private var renderedTemplates: [String: PageTemplate] = [:]

    init(store: FileInkPageStore) {
        self.store = store
    }

    /// Rendert und schreibt das Vorschaubild nach dem Speichern einer Seite
    func schedule(
        pageID: String, ink: Data?, highlight: Data?, template: PageTemplate, widthPt: Double, heightPt: Double
    ) {
        jobs[pageID]?.cancel()
        renderedTemplates[pageID] = template
        let url = store.thumbnailURL(pageID: pageID)
        let job = _Concurrency.Task.detached(priority: .utility) {
            guard !_Concurrency.Task.isCancelled else { return }
            guard
                let data = InkThumbnailService.render(
                    ink: ink, highlight: highlight, template: template, widthPt: widthPt, heightPt: heightPt)
            else { return }
            guard !_Concurrency.Task.isCancelled else { return }
            try? FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: url, options: .atomic)
        }
        jobs[pageID] = job
    }

    /// JPEG-Daten des Vorschaubilds. Läuft noch ein Auftrag für die Seite, wird auf ihn gewartet. Fehlt die Datei
    /// (Seite nie gespeichert, Vorlage geändert), wird sie aus der Zeichnung der Seite auf der Platte erzeugt.
    func thumbnail(
        pageID: String, template: PageTemplate, widthPt: Double, heightPt: Double
    ) async -> Data? {
        if let job = jobs[pageID] {
            await job.value
        }
        let url = store.thumbnailURL(pageID: pageID)
        if let data = try? Data(contentsOf: url), renderedTemplates[pageID] == nil || renderedTemplates[pageID] == template {
            renderedTemplates[pageID] = template
            return data
        }
        renderedTemplates[pageID] = template
        let snapshot = store.load(pageID: pageID)
        let rendered = _Concurrency.Task.detached(priority: .utility) {
            InkThumbnailService.render(
                ink: snapshot.ink, highlight: snapshot.highlight, template: template, widthPt: widthPt,
                heightPt: heightPt)
        }
        guard let data = await rendered.value else { return nil }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
        return data
    }

    /// Löscht das Vorschaubild, z. B. nach einem Wechsel der Vorlage. Das nächste `thumbnail` rendert neu.
    func invalidate(pageID: String) {
        jobs[pageID]?.cancel()
        jobs[pageID] = nil
        renderedTemplates[pageID] = nil
        try? FileManager.default.removeItem(at: store.thumbnailURL(pageID: pageID))
    }

    /// Papier, Vorlage und beide Ebenen als JPEG. Die Seite ist immer hell, also wird auch die Tinte hell gerendert.
    nonisolated static func render(
        ink: Data?, highlight: Data?, template: PageTemplate, widthPt: Double, heightPt: Double
    ) -> Data? {
        guard widthPt > 0, heightPt > 0 else { return nil }
        let size = CGSize(width: widthPt, height: heightPt)
        let target = CGSize(width: width, height: (width * CGFloat(heightPt / widthPt)).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: target, format: format)
        let scale = target.width / size.width
        let light = UITraitCollection(userInterfaceStyle: .light)
        let image = renderer.image { rendererContext in
            let context = rendererContext.cgContext
            context.saveGState()
            context.scaleBy(x: scale, y: scale)
            InkTemplateGeometry.draw(template: template, size: size, in: context)
            context.restoreGState()
            // Erst Textmarker, dann Schrift (Zeichenreihenfolge der Seite)
            for layer in [highlight, ink] {
                guard let layer, let drawing = try? PKDrawing(data: layer), !drawing.strokes.isEmpty else { continue }
                var layerImage: UIImage?
                light.performAsCurrent {
                    layerImage = drawing.image(from: CGRect(origin: .zero, size: size), scale: scale)
                }
                layerImage?.draw(in: CGRect(origin: .zero, size: target))
            }
        }
        return image.jpegData(compressionQuality: 0.7)
    }
}
