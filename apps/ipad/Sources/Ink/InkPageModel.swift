import Foundation
import Observation
import PencilKit

/// Änderung am Strichbestand im neutralen Format. Entspricht den Operationen `stroke.add` (Upsert über
/// `client_id`) und `stroke.remove`, die der Sync (T1-14) daraus baut.
enum InkStrokeChange {
    case upsert(Stroke)
    case remove([String])
}

/// Eine Notizbuchseite mit zwei Ebenen: unten Textmarker, oben Schrift (F-INK-01).
/// Hält die Zeichnungen, den gemeinsamen Verlauf für Rückgängig/Wiederholen und die Werkzeugleiste.
@MainActor
@Observable
final class InkPageModel {
    /// Seite des vorläufigen Test-Notizbuchs. Echte Notizbücher und Seiten kommen mit T1-13.
    nonisolated static let testPageID = "00000000-0000-7000-8000-000000000001"
    /// A4 hoch in pt (F-INK-02)
    nonisolated static let a4 = CGSize(width: 595, height: 842)

    let pageID: String
    let pageSize: CGSize

    var tools = InkToolState()
    var showsColorPalette = false
    /// Doppeltipp am Pencil. Standard laut F-INK-01: zum Radierer und zurück. Später aus `Settings.pen`.
    var doubleTapSetting: PencilDoubleTapAction = .radierer

    private(set) var inkDrawing = PKDrawing()
    private(set) var highlightDrawing = PKDrawing()
    /// Zählt hoch, wenn die App die Zeichnung setzt (Laden, Rückgängig, Wiederholen).
    /// Die Schreibfläche übernimmt die Zeichnung nur dann, nicht nach jedem eigenen Strich.
    private(set) var inkRevision = 0
    private(set) var highlightRevision = 0
    private(set) var canUndo = false
    private(set) var canRedo = false
    /// Das letzte Speichern ist gescheitert (Anzeige in der Werkzeugleiste)
    private(set) var saveFailed = false

    /// Start der laufenden Session für `t_start_ms`/`t_end_ms`. Ohne Session `nil`.
    @ObservationIgnored var sessionStartedAt: Date?
    /// Anschluss für den Sync (T1-14): bekommt jede Änderung im neutralen Format
    @ObservationIgnored var onStrokeChanges: (([InkStrokeChange]) -> Void)?
    /// Wird nach jedem erfolgreichen Speichern aufgerufen, mit dem geschriebenen Stand (Vorschaubild der Seitenleiste)
    @ObservationIgnored var onSaved: ((InkPageSnapshot) -> Void)?
    /// Der Stift setzt an bzw. ab (für den Folienwechsel, der bis zum Absetzen wartet)
    @ObservationIgnored var onToolUseStarted: (() -> Void)?
    @ObservationIgnored var onToolUseFinished: (() -> Void)?
    /// Liefert die höchste Nummer der Warteschlange (`SyncOutbox.lastNumber`). Wird beim Speichern festgehalten.
    @ObservationIgnored var outboxNumberProvider: (() -> Int)?
    /// Lokaler Stand und Core müssen abgeglichen werden: nach einem Absturz, bei neu vergebenen IDs, bei einem
    /// gescheiterten Einreihen oder nach neuer `db_epoch`. Der Abgleich löscht das Flag (`reconcileFinished()`).
    private(set) var needsReconcile = false

    @ObservationIgnored private var history = InkHistory<PKDrawing>()
    @ObservationIgnored private var trackers = InkPageTrackers()
    @ObservationIgnored private var toolUseOpen = false
    @ObservationIgnored private var toolUseRecorded = false
    @ObservationIgnored private var isDirty = false
    @ObservationIgnored private var saveTask: _Concurrency.Task<Void, Never>?
    @ObservationIgnored private var loadedOutboxNumber = 0
    private let store: any InkPageStore
    private let saveDelay: Duration

    init(
        pageID: String = InkPageModel.testPageID,
        pageSize: CGSize = InkPageModel.a4,
        store: any InkPageStore,
        saveDelay: Duration = .seconds(1),
        outboxMark: Int = 0
    ) {
        self.pageID = pageID
        self.pageSize = pageSize
        self.store = store
        self.saveDelay = saveDelay

        let snapshot = store.load(pageID: pageID)
        inkDrawing = InkPageModel.drawing(from: snapshot.ink)
        highlightDrawing = InkPageModel.drawing(from: snapshot.highlight)
        trackers = snapshot.trackers
        loadedOutboxNumber = snapshot.outboxNumber
        // Absturz zwischen Einreihen und Speichern: Die Warteschlange kennt mehr als die Zeichnung
        needsReconcile = snapshot.needsReconcile || outboxMark > snapshot.outboxNumber
        // Zuordnung an den geladenen Bestand angleichen (z. B. wenn die IDs fehlten).
        // Neu vergebene IDs kennt der Core nicht: Abgleich nötig.
        let inkChanges = syncStrokes(.ink)
        let highlightChanges = syncStrokes(.highlight)
        if !inkChanges.isEmpty || !highlightChanges.isEmpty {
            needsReconcile = true
        }
    }

    /// Das Einreihen in die Warteschlange ist gescheitert: Der nächste Abgleich holt das nach
    func markNeedsReconcile() {
        guard !needsReconcile else { return }
        needsReconcile = true
        isDirty = true
        scheduleSave()
    }

    /// Der Abgleich mit dem Core ist durch
    func reconcileFinished() {
        guard needsReconcile else { return }
        needsReconcile = false
        isDirty = true
        scheduleSave()
    }

    func drawing(for layer: StrokeLayer) -> PKDrawing {
        switch layer {
        case .ink: return inkDrawing
        case .highlight: return highlightDrawing
        }
    }

    // MARK: Änderungen von der Schreibfläche

    /// Der Stift setzt an. Alle Änderungen bis zum Absetzen zählen als ein Schritt
    /// (der präzise Radierer meldet sonst jede Teilstrecke einzeln).
    func beginToolUse() {
        toolUseOpen = true
        toolUseRecorded = false
        onToolUseStarted?()
    }

    func endToolUse() {
        toolUseOpen = false
        toolUseRecorded = false
        onToolUseFinished?()
    }

    /// Die Nutzerin hat eine Ebene geändert (Strich, Radieren, Lasso)
    func canvasDidChange(layer: StrokeLayer, drawing: PKDrawing) {
        let before = self.drawing(for: layer)
        // PencilKit meldet auch Zeichnungen, die die App selbst gesetzt hat
        guard drawing != before else { return }
        history.record(
            layer: layer,
            before: before,
            after: drawing,
            coalesce: toolUseOpen && toolUseRecorded
        )
        if toolUseOpen {
            toolUseRecorded = true
        }
        setDrawing(drawing, layer: layer, byApp: false)
        didChange(layer)
    }

    // MARK: Rückgängig und Wiederholen

    func undo() {
        guard let step = history.undo() else { return }
        endToolUse()
        setDrawing(step.before, layer: step.layer, byApp: true)
        didChange(step.layer)
    }

    func redo() {
        guard let step = history.redo() else { return }
        endToolUse()
        setDrawing(step.after, layer: step.layer, byApp: true)
        didChange(step.layer)
    }

    // MARK: Pencil

    /// Doppeltipp am Apple Pencil 2
    func pencilDoubleTapped(system: InkSystemTapPreference) {
        switch tools.handleDoubleTap(setting: doubleTapSetting, system: system) {
        case .showColorPalette:
            showsColorPalette.toggle()
        case .toolChanged, .none:
            break
        }
    }

    // MARK: Neutrales Format

    /// Alle Striche der Seite im Format des Schemas, in Zeichenreihenfolge: erst Textmarker, dann Schrift
    func neutralStrokes() -> [Stroke] {
        neutralStrokes(.highlight) + neutralStrokes(.ink)
    }

    func neutralStrokes(_ layer: StrokeLayer) -> [Stroke] {
        let strokes = drawing(for: layer).strokes
        var tracker = currentTracker(for: layer)
        // Der Bestand ist nach jeder Änderung abgeglichen, darum entstehen hier keine neuen IDs
        let diff = tracker.update(strokes.map { InkPencilKit.footprint(of: $0) }) { InkID.uuidV7() }
        var result: [Stroke] = []
        for (index, stroke) in strokes.enumerated() {
            let sample = InkPencilKit.sample(from: stroke, layer: layer)
            if let encoded = InkStrokeCodec.encode(
                sample, clientID: diff.clientIDs[index], sessionStartedAt: sessionStartedAt)
            {
                result.append(encoded)
            }
        }
        return result
    }

    // MARK: Speichern

    /// Schreibt die Seite sofort auf die Platte (beim Verlassen der Seite und der App)
    func saveNow() {
        saveTask?.cancel()
        saveTask = nil
        guard isDirty else { return }
        let snapshot = InkPageSnapshot(
            ink: inkDrawing.strokes.isEmpty ? nil : inkDrawing.dataRepresentation(),
            highlight: highlightDrawing.strokes.isEmpty ? nil : highlightDrawing.dataRepresentation(),
            trackers: trackers,
            outboxNumber: max(loadedOutboxNumber, outboxNumberProvider?() ?? 0),
            needsReconcile: needsReconcile
        )
        do {
            try store.save(snapshot, pageID: pageID)
            loadedOutboxNumber = snapshot.outboxNumber
            isDirty = false
            if saveFailed { saveFailed = false }
            onSaved?(snapshot)
        } catch {
            if !saveFailed { saveFailed = true }
        }
    }

    // MARK: Intern

    private static func drawing(from data: Data?) -> PKDrawing {
        guard let data, let drawing = try? PKDrawing(data: data) else { return PKDrawing() }
        return drawing
    }

    private func currentTracker(for layer: StrokeLayer) -> InkStrokeTracker {
        switch layer {
        case .ink: return trackers.ink
        case .highlight: return trackers.highlight
        }
    }

    private func setDrawing(_ drawing: PKDrawing, layer: StrokeLayer, byApp: Bool) {
        switch layer {
        case .ink:
            inkDrawing = drawing
            if byApp { inkRevision += 1 }
        case .highlight:
            highlightDrawing = drawing
            if byApp { highlightRevision += 1 }
        }
    }

    private func didChange(_ layer: StrokeLayer) {
        if canUndo != history.canUndo { canUndo = history.canUndo }
        if canRedo != history.canRedo { canRedo = history.canRedo }
        let changes = syncStrokes(layer)
        if !changes.isEmpty {
            onStrokeChanges?(changes)
        }
        isDirty = true
        scheduleSave()
    }

    /// Gleicht die Zuordnung `Fingerabdruck → client_id` ab und liefert die Änderungen im neutralen Format
    private func syncStrokes(_ layer: StrokeLayer) -> [InkStrokeChange] {
        let strokes = drawing(for: layer).strokes
        var tracker = currentTracker(for: layer)
        let diff = tracker.update(strokes.map { InkPencilKit.footprint(of: $0) }) { InkID.uuidV7() }
        switch layer {
        case .ink: trackers.ink = tracker
        case .highlight: trackers.highlight = tracker
        }

        var changes: [InkStrokeChange] = []
        for upsert in diff.upserts {
            let sample = InkPencilKit.sample(from: strokes[upsert.index], layer: layer)
            if let encoded = InkStrokeCodec.encode(
                sample, clientID: upsert.clientID, sessionStartedAt: sessionStartedAt)
            {
                changes.append(.upsert(encoded))
            }
        }
        if !diff.removed.isEmpty {
            changes.append(.remove(diff.removed))
        }
        return changes
    }

    /// Speichert, sobald der Stift kurz ruht. So stört das Schreiben auf die Platte den Strich nicht.
    private func scheduleSave() {
        saveTask?.cancel()
        let delay = saveDelay
        saveTask = _Concurrency.Task { [weak self] in
            try? await _Concurrency.Task.sleep(for: delay)
            if _Concurrency.Task.isCancelled { return }
            self?.saveNow()
        }
    }
}
