import Foundation

/// Übernimmt eine alte `bindings.json` (eine Seite je Notizbuch, T1-14/#214) in die Bibliothek.
/// Die Zeichnungen unter `Ink/<page_id>/` bleiben, wo sie sind. Der nächste Abgleich mit dem Core korrigiert
/// Titel, Art, `index` und `version`.
enum InkLibraryMigration {
    /// Name, solange der Core ihn nicht genannt hat (Bindungen vor #214 kennen den Modulnamen nicht)
    static let placeholderModuleName = "Modul"

    /// Liest `bindings.json`. `nil`, wenn die Datei fehlt oder nicht lesbar ist.
    static func migrate(fileAt url: URL) -> InkLibraryFile? {
        guard let data = try? Data(contentsOf: url),
            let old = try? JSONDecoder().decode(InkBindingsFile.self, from: data)
        else { return nil }
        return migrate(old)
    }

    static func migrate(_ old: InkBindingsFile) -> InkLibraryFile {
        var result = InkLibraryFile()
        result.lastNotebookID = old.lastNotebookID
        result.dbEpoch = old.dbEpoch
        // Feste Reihenfolge, damit das Ergebnis nicht vom Wörterbuch abhängt
        for notebookID in old.bindings.keys.sorted() {
            guard let binding = old.bindings[notebookID] else { continue }
            if let index = result.modules.firstIndex(where: { $0.id == binding.moduleID }) {
                if result.modules[index].name == placeholderModuleName, let name = binding.moduleName {
                    result.modules[index].name = name
                }
            } else {
                result.modules.append(
                    LibraryModule(
                        id: binding.moduleID,
                        name: binding.moduleName ?? placeholderModuleName,
                        shortName: nil,
                        inkMode: nil,
                        inkModeDirty: false
                    ))
            }
            result.notebooks.append(
                LibraryNotebook(
                    id: binding.notebookID,
                    moduleID: binding.moduleID,
                    title: "Vorlesung",
                    kind: .vorlesung,
                    createdAtMS: 0,
                    knownOnServer: true,
                    hidden: false,
                    lastPageID: binding.pageID,
                    remoteMaxIndex: 0,
                    remoteOnlyPageCount: 0
                ))
            result.pages.append(
                LibraryPage(
                    id: binding.pageID,
                    notebookID: binding.notebookID,
                    index: 1,
                    template: .blanko,
                    widthPt: LibraryPage.a4Width,
                    heightPt: LibraryPage.a4Height,
                    // Nur wenn `page.create` noch aussteht, braucht die Seite ihre Session
                    sessionID: binding.pageCreated ? nil : binding.sessionID,
                    backgroundSlideID: nil,
                    attachedSlideID: nil,
                    version: 1,
                    createQueued: binding.pageCreated,
                    needsReconcile: binding.needsReconcile,
                    deletedAtMS: nil,
                    deleteQueued: false,
                    sessionStartMS: binding.pageCreated ? nil : binding.sessionStartMS
                ))
        }
        return result
    }
}
