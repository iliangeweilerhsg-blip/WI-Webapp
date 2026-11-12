import Foundation

/// Kurzfassung einer Session, wie sie `session.updated` und der Snapshot liefern. Nur einfache Werte, damit sie
/// die Isolationsgrenzen passieren darf (VERTRAEGE §11.7: `SGServerMessage` verlässt die Engine nie).
struct SessionBrief: Equatable, Sendable {
    var id: String
    var moduleID: String
    /// Rohwert von `SessionState` (`laeuft`, `pausiert`, `beendet`, …)
    var state: String
    var startedAtMS: Int?
    var slideDeckID: String?
    var deleted: Bool
    var updatedAtMS: Int

    /// Läuft oder pausiert, nicht gelöscht: Dann folgt das iPad ihr
    var isActive: Bool {
        !deleted && (state == "laeuft" || state == "pausiert")
    }
}

/// Folie laut `slide.change`. Ist `slideID` leer, gilt `index` (1-basiert) im Foliensatz der Session.
struct SlideBrief: Equatable, Sendable {
    var slideID: String?
    var index: Int
}

/// Art einer Server-Operation, die ein Notizbuch am Mac ändert (VERTRAEGE §11.3: nur Server, nach `PATCH`/`DELETE
/// /notebooks/{id}` bzw. Wiederherstellung aus dem Papierkorb)
enum NotebookOpKind: String, Equatable, Sendable {
    case update
    case delete
    case restore
}

/// Was die Engine nach außen gibt. Alle Werte sind einfach und `Sendable`.
enum SyncInbound: Equatable, Sendable {
    /// Neue Verbindung (`welcome`). Abonnements der alten Verbindung gelten nicht mehr.
    case connected
    case sessionUpdated(SessionBrief)
    case subscribed(stream: String, reset: Bool)
    /// `slide` ist nur bei `slide.change` gesetzt. Jede Operation des Stroms kommt hier an, auch unbekannte.
    /// Ausnahme: `notebook.update`, `.delete` und `.restore` kommen als `notebookOp` an.
    case op(stream: String, seq: Int, slide: SlideBrief?)
    /// `notebook.update`, `notebook.delete` oder `notebook.restore` im Strom `notebook:<id>`. Das iPad liest sie nur,
    /// um die Bibliothek neu zu laden (Inhalt und `seq` zählen nicht).
    case notebookOp(stream: String, seq: Int, kind: NotebookOpKind)
}
