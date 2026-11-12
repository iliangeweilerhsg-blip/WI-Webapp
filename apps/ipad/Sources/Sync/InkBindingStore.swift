import Foundation

/// Schreibziel: eine Seite eines Notizbuchs mit der Session, die dazu passt. Seit der Bibliothek (T1-11 Rest) wird
/// der Wert nicht mehr gespeichert, sondern aus `InkLibraryService` gebaut. Gespeichert war er früher in
/// `bindings.json` (eine Seite je Notizbuch, E1 aus T1-14), darum bleiben die Felder und ihre Namen.
struct InkBinding: Codable, Equatable, Sendable {
    var notebookID: String
    var pageID: String
    var moduleID: String
    /// `page.create` ist eingereiht (oder gesendet)
    var pageCreated: Bool
    /// Seite und Core müssen abgeglichen werden (neue `db_epoch`)
    var needsReconcile: Bool
    /// Session, in der geschrieben wird (für `presence` und `page.create`), `nil` ohne
    var sessionID: String?
    /// Start dieser Session auf der Uhr des Mac, in ms
    var sessionStartMS: Int?
    /// Name des Moduls, zuletzt vom Core gelesen. Fehlt bei alten `bindings.json` und ohne Antwort des Core.
    var moduleName: String?

    /// Strom aller Operationen dieses Notizbuchs (VERTRAEGE §11.2)
    var stream: String { "notebook:\(notebookID)" }
}

/// Entscheidet, ob die laufende Vorlesung in einem anderen Notizbuch liegt als die offene Seite (UX-19)
enum InkBindingCheck {
    /// - Parameters:
    ///   - shownNotebookID: Notizbuch der offenen Seite, `nil` bei der lokalen Testseite
    ///   - runningNotebookID: Notizbuch der laufenden Vorlesung laut Core, `nil` ohne laufende Vorlesung
    /// - Returns: `true`, wenn der Knopf „Zur laufenden Vorlesung“ erscheinen soll. Nichts wird verschoben.
    static func differs(shownNotebookID: String?, runningNotebookID: String?) -> Bool {
        guard let runningNotebookID else { return false }
        return runningNotebookID != shownNotebookID
    }
}

/// Inhalt der früheren `Sync/bindings.json`. Die Datei wird nicht mehr geschrieben, nur noch einmalig gelesen
/// und in die Bibliothek übernommen (`InkLibraryMigration`).
struct InkBindingsFile: Codable {
    var bindings: [String: InkBinding] = [:]
    var lastNotebookID: String?
    var dbEpoch: String?
}
