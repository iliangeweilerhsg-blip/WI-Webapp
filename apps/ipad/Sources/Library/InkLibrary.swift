import Foundation

// Lokale Bibliothek des iPads (T1-11 Rest, UX-30): Module, Notizbücher und Seiten, die das iPad kennt.
// Die Namen beginnen mit `Library`, damit sie nicht mit den generierten Typen in `Schemas.swift` kollidieren.

/// Modul, wie die Bibliothek es führt
struct LibraryModule: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var shortName: String?
    /// Wahl des Schreibmodus, `nil` = globaler Standard (T1-13 Teil 2 nutzt das)
    var inkMode: InkMode?
    /// Lokal geändert, noch nicht per PATCH gesendet
    var inkModeDirty: Bool
}

/// Notizbuch, wie die Bibliothek es führt
struct LibraryNotebook: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var moduleID: String
    var title: String
    var kind: NotebookKind
    var createdAtMS: Int
    /// Der Core kennt das Notizbuch (aus `GET /notebooks`). `false` bei lokal angelegten, bis zum ersten Abgleich.
    var knownOnServer: Bool
    /// Am Mac gelöscht: nicht mehr anzeigen, Dateien bleiben
    var hidden: Bool
    var lastPageID: String?
    /// Höchster `index` laut `GET /notebooks/{id}/pages`, auch von Seiten, die das iPad nicht hat
    var remoteMaxIndex: Int
    /// Seiten am Mac, die dieses iPad nicht hat (nur Anzeige)
    var remoteOnlyPageCount: Int

    /// Strom aller Operationen dieses Notizbuchs (VERTRAEGE §11.2)
    var stream: String { "notebook:\(id)" }
}

/// Seite, die dieses iPad angelegt hat
struct LibraryPage: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var notebookID: String
    var index: Int
    var template: PageTemplate
    var widthPt: Double
    var heightPt: Double
    var sessionID: String?
    var backgroundSlideID: String?
    var attachedSlideID: String?
    /// Version, auf der die nächste `page.update` beruht
    var version: Int
    /// `page.create` ist eingereiht oder gesendet
    var createQueued: Bool
    var needsReconcile: Bool
    /// Lokal gelöscht. Dateien bleiben bis `deletedAtMS` + 30 Tage
    var deletedAtMS: Int?
    /// `page.delete` ist eingereiht. `false` in der Löschfrist von 5 s.
    var deleteQueued: Bool

    /// Strom aller Operationen des Notizbuchs dieser Seite
    var stream: String { "notebook:\(notebookID)" }

    /// A4 hochkant, wie `page.create` es für freie Seiten sendet (VERTRAEGE §7.4)
    static let a4Width: Double = 595
    static let a4Height: Double = 842
}

/// Laufende oder pausierte Session, wie der Dienst sie kennt
struct RunningSession: Equatable, Sendable {
    var id: String
    var moduleID: String
    var startMS: Int?
    var slideDeckID: String?
    /// Aus `GET /sessions/{id}/notebook`, `nil`, wenn der Abruf scheitert
    var notebookID: String?
}

/// Inhalt von `Sync/library.json`
struct InkLibraryFile: Codable, Equatable, Sendable {
    var schemaVersion = 1
    var modules: [LibraryModule] = []
    var notebooks: [LibraryNotebook] = []
    var pages: [LibraryPage] = []
    var lastNotebookID: String?
    var dbEpoch: String?
    /// Zeitpunkt des letzten erfolgreichen Abrufs der Module, in ms
    var refreshedAtMS: Int?
    /// Die alte lokale Testseite (`InkPageModel.testPageID`) wurde geprüft und bei Strichen übernommen. Optional,
    /// damit eine ältere `library.json` ohne das Feld lesbar bleibt (L3 aus #225): Neue Felder sind immer optional.
    var legacyTestPageHandled: Bool?
}
