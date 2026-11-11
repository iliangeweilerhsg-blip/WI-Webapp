import Foundation

/// Rückgängig/Wiederholen über beide Ebenen einer Seite (F-INK-01).
///
/// Jede Ebene ist ein eigenes `PKCanvasView`. Für die Nutzerin gibt es aber nur einen Verlauf je
/// Seite: „Rückgängig“ nimmt den letzten Schritt zurück, egal auf welcher Ebene er lag.
/// Darum merkt sich dieser Stapel je Schritt die Ebene und ihren Stand davor und danach.
/// Der Zustandstyp ist frei wählbar, damit die Logik ohne PencilKit testbar ist.
struct InkHistory<Snapshot> {
    struct Step {
        let layer: StrokeLayer
        let before: Snapshot
        let after: Snapshot
    }

    /// Höchstzahl der Schritte. Ältere fallen weg.
    let limit: Int
    private(set) var undoSteps: [Step] = []
    private(set) var redoSteps: [Step] = []

    init(limit: Int = 100) {
        self.limit = max(1, limit)
    }

    var canUndo: Bool { !undoSteps.isEmpty }
    var canRedo: Bool { !redoSteps.isEmpty }

    /// Neue Änderung der Nutzerin. Danach gibt es nichts mehr zu wiederholen.
    /// - Parameter coalesce: mit dem letzten Schritt derselben Ebene zu einem Schritt verschmelzen
    ///   (mehrere Meldungen während einer einzigen Stiftbewegung, etwa beim präzisen Radierer)
    mutating func record(layer: StrokeLayer, before: Snapshot, after: Snapshot, coalesce: Bool = false) {
        if coalesce, let last = undoSteps.last, last.layer == layer {
            undoSteps[undoSteps.count - 1] = Step(layer: layer, before: last.before, after: after)
        } else {
            undoSteps.append(Step(layer: layer, before: before, after: after))
            if undoSteps.count > limit {
                undoSteps.removeFirst(undoSteps.count - limit)
            }
        }
        redoSteps.removeAll()
    }

    /// Liefert den Schritt, dessen `before` auf seiner Ebene wiederherzustellen ist
    mutating func undo() -> Step? {
        guard let step = undoSteps.popLast() else { return nil }
        redoSteps.append(step)
        return step
    }

    /// Liefert den Schritt, dessen `after` auf seiner Ebene wiederherzustellen ist
    mutating func redo() -> Step? {
        guard let step = redoSteps.popLast() else { return nil }
        undoSteps.append(step)
        return step
    }

    mutating func reset() {
        undoSteps.removeAll()
        redoSteps.removeAll()
    }
}
