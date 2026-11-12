import Foundation
import Observation

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

    /// Ob das Banner „Diese Seite gehört nicht dazu“ erscheint (UX-51). Es erscheint nur, wenn die laufende Vorlesung
    /// zu einem anderen Modul gehört: Die Notizen-Spalte folgt einem freien Notizbuch desselben Moduls (VERTRAEGE
    /// §11.6), dann stimmt der Text nicht. Mit „✕“ weggeklickt, bleibt es für diese Session aus.
    /// - Parameters:
    ///   - shownModuleID: Modul der offenen Seite, `nil` bei der lokalen Testseite
    ///   - runningModuleID: Modul der laufenden Vorlesung
    ///   - runningSessionID: Die laufende Session
    ///   - dismissedSessionIDs: Sessions, deren Banner weggeklickt wurde
    static func showsBanner(
        shownNotebookID: String?, shownModuleID: String?, runningNotebookID: String?, runningModuleID: String?,
        runningSessionID: String?, dismissedSessionIDs: Set<String>
    ) -> Bool {
        guard differs(shownNotebookID: shownNotebookID, runningNotebookID: runningNotebookID) else { return false }
        if let runningModuleID, runningModuleID == shownModuleID { return false }
        if let runningSessionID, dismissedSessionIDs.contains(runningSessionID) { return false }
        return true
    }
}

/// Merkt sich, für welche Sessions das Banner weggeklickt wurde. Gilt, solange die App läuft („für diese Session“).
@MainActor
@Observable
final class InkBindingBannerState {
    /// Eine gemeinsame Instanz für die Schreibfläche: Beim Blättern und Zurückkehren bleibt das Wegklicken bestehen
    static let shared = InkBindingBannerState()

    private(set) var dismissedSessionIDs = Set<String>()

    init() {}

    func dismiss(sessionID: String) {
        dismissedSessionIDs.insert(sessionID)
    }
}

/// Inhalt der früheren `Sync/bindings.json`. Die Datei wird nicht mehr geschrieben, nur noch einmalig gelesen
/// und in die Bibliothek übernommen (`InkLibraryMigration`).
struct InkBindingsFile: Codable {
    var bindings: [String: InkBinding] = [:]
    var lastNotebookID: String?
    var dbEpoch: String?
}
