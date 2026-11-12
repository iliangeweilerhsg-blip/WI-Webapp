import Foundation

/// Ablage der Bibliothek. Schreibfehler werden nicht gemeldet: Der Stand liegt im Speicher und wird bei der
/// nächsten Änderung erneut geschrieben (wie bei der früheren Ablage der Bindungen).
@MainActor
protocol InkLibraryStore: AnyObject {
    var modules: [LibraryModule] { get }
    /// Zuletzt verwendetes Notizbuch (für den Betrieb ohne Verbindung)
    var lastNotebookID: String? { get }
    /// `db_epoch` des Core beim letzten `welcome`
    var dbEpoch: String? { get }
    /// Letzter erfolgreicher Abruf der Module
    var refreshedAt: Date? { get }
    /// Die alte lokale Testseite wurde geprüft (und bei Strichen übernommen), siehe `InkLibraryService.adoptLegacyTestPage`
    var legacyTestPageHandled: Bool { get }

    /// Ohne `hidden`, nach `createdAtMS`, dann `id`
    func notebooks(inModule moduleID: String) -> [LibraryNotebook]
    /// Alle Notizbücher, auch ausgeblendete (für `db_epoch` neu)
    func allNotebooks() -> [LibraryNotebook]
    func notebook(_ id: String) -> LibraryNotebook?
    /// Ohne gelöschte, nach `index`, dann `id`
    func pages(inNotebook notebookID: String) -> [LibraryPage]
    func page(_ id: String) -> LibraryPage?

    func mergeModules(_ server: [ModuleBrief], at: Date)
    func mergeNotebooks(_ server: [Notebook], moduleID: String)
    func mergePages(
        _ server: [Page], notebookID: String, pendingUpdatePageIDs: Set<String>,
        pendingDeletePageIDs: Set<String>)

    func upsert(_ notebook: LibraryNotebook)
    func upsert(_ page: LibraryPage)
    func setLast(notebookID: String, pageID: String?)
    /// `notebook.create` wurde endgültig abgelehnt: Notizbuch und seine Seiten aus der Bibliothek nehmen
    func removeNotebook(_ id: String)
    /// `page.create` wurde endgültig abgelehnt
    func removePage(_ id: String)

    func setDBEpoch(_ epoch: String)
    func markLegacyTestPageHandled()
    /// Neue `db_epoch`: Jede Seite muss abgeglichen werden, und kein Notizbuch gilt mehr als dem Core bekannt
    func markAllNeedReconcile()
    func clearNeedsReconcile(pageID: String)
    func setModuleInkMode(_ mode: InkMode?, moduleID: String, dirty: Bool)
}

/// `Sync/library.json`, atomar geschrieben. Gibt es sie nicht, aber eine alte `bindings.json`, wird diese einmalig
/// übernommen (`InkLibraryMigration`) und danach in `bindings.migriert.json` umbenannt.
@MainActor
final class FileInkLibraryStore: InkLibraryStore {
    private let url: URL
    private var file: InkLibraryFile

    init(url: URL, legacyBindingsURL: URL? = nil) {
        self.url = url
        var loaded = InkLibraryFile()
        var migratedFrom: URL?
        if let data = try? Data(contentsOf: url) {
            if let decoded = try? JSONDecoder().decode(InkLibraryFile.self, from: data) {
                loaded = decoded
            } else {
                // Nicht lesbar: zur Seite legen, damit der Fehler nachvollziehbar bleibt
                let broken = url.deletingLastPathComponent().appendingPathComponent("library.defekt.json")
                try? FileManager.default.removeItem(at: broken)
                try? FileManager.default.moveItem(at: url, to: broken)
            }
        } else if let legacyBindingsURL, let migrated = InkLibraryMigration.migrate(fileAt: legacyBindingsURL) {
            loaded = migrated
            migratedFrom = legacyBindingsURL
        }
        file = loaded
        if let migratedFrom, persist() {
            let target = migratedFrom.deletingLastPathComponent().appendingPathComponent("bindings.migriert.json")
            try? FileManager.default.removeItem(at: target)
            try? FileManager.default.moveItem(at: migratedFrom, to: target)
        }
    }

    /// `Application Support/Sync/library.json` der App
    static func standard() -> FileInkLibraryStore {
        let base =
            FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let directory = base.appendingPathComponent("Sync", isDirectory: true)
        return FileInkLibraryStore(
            url: directory.appendingPathComponent("library.json"),
            legacyBindingsURL: directory.appendingPathComponent("bindings.json"))
    }

    // MARK: Lesen

    var modules: [LibraryModule] { file.modules }
    var lastNotebookID: String? { file.lastNotebookID }
    var dbEpoch: String? { file.dbEpoch }
    var legacyTestPageHandled: Bool { file.legacyTestPageHandled ?? false }

    var refreshedAt: Date? {
        file.refreshedAtMS.map { Date(timeIntervalSince1970: Double($0) / 1000) }
    }

    func notebooks(inModule moduleID: String) -> [LibraryNotebook] {
        file.notebooks
            .filter { $0.moduleID == moduleID && !$0.hidden }
            .sorted { ($0.createdAtMS, $0.id) < ($1.createdAtMS, $1.id) }
    }

    func allNotebooks() -> [LibraryNotebook] {
        file.notebooks
    }

    func notebook(_ id: String) -> LibraryNotebook? {
        file.notebooks.first { $0.id == id }
    }

    func pages(inNotebook notebookID: String) -> [LibraryPage] {
        file.pages
            .filter { $0.notebookID == notebookID && $0.deletedAtMS == nil }
            .sorted { ($0.index, $0.id) < ($1.index, $1.id) }
    }

    func page(_ id: String) -> LibraryPage? {
        file.pages.first { $0.id == id }
    }

    // MARK: Zusammenführen

    func mergeModules(_ server: [ModuleBrief], at date: Date) {
        var merged: [LibraryModule] = []
        var seen = Set<String>()
        for brief in server where !seen.contains(brief.id) {
            seen.insert(brief.id)
            var module =
                file.modules.first { $0.id == brief.id }
                ?? LibraryModule(
                    id: brief.id, name: brief.name, shortName: brief.shortName, inkMode: nil, inkModeDirty: false)
            module.name = brief.name
            module.shortName = brief.shortName
            // Eine lokale Wahl, die der Core noch nicht kennt, gewinnt
            if !module.inkModeDirty {
                module.inkMode = brief.inkMode
            }
            merged.append(module)
        }
        // Ein Modul, das am Core fehlt, bleibt nur stehen, solange es ein Notizbuch gibt, das der Core noch nicht kennt
        for local in file.modules where !seen.contains(local.id) {
            if file.notebooks.contains(where: { $0.moduleID == local.id && !$0.knownOnServer }) {
                merged.append(local)
            }
        }
        file.modules = merged
        file.refreshedAtMS = InkStrokeCodec.milliseconds(date)
        persist()
    }

    func mergeNotebooks(_ server: [Notebook], moduleID: String) {
        var serverIDs = Set<String>()
        for remote in server where remote.deletedAt == nil {
            serverIDs.insert(remote.id)
            let created = InkStrokeCodec.milliseconds(remote.createdAt)
            if let index = file.notebooks.firstIndex(where: { $0.id == remote.id }) {
                file.notebooks[index].title = remote.title
                file.notebooks[index].kind = remote.kind
                file.notebooks[index].moduleID = remote.moduleID
                file.notebooks[index].createdAtMS = created
                file.notebooks[index].knownOnServer = true
                file.notebooks[index].hidden = false
            } else {
                file.notebooks.append(
                    LibraryNotebook(
                        id: remote.id,
                        moduleID: remote.moduleID,
                        title: remote.title,
                        kind: remote.kind,
                        createdAtMS: created,
                        knownOnServer: true,
                        hidden: false,
                        lastPageID: nil,
                        remoteMaxIndex: 0,
                        remoteOnlyPageCount: 0
                    ))
            }
        }
        // Lokal vorhanden, am Core nicht mehr: Wartet es noch auf `notebook.create`, bleibt es. Sonst wurde es gelöscht.
        for index in file.notebooks.indices
        where file.notebooks[index].moduleID == moduleID && !serverIDs.contains(file.notebooks[index].id) {
            if file.notebooks[index].knownOnServer {
                file.notebooks[index].hidden = true
            }
        }
        persist()
    }

    func mergePages(
        _ server: [Page], notebookID: String, pendingUpdatePageIDs: Set<String>,
        pendingDeletePageIDs: Set<String>
    ) {
        var maxIndex = 0
        var remoteOnly = 0
        for remote in server where remote.deletedAt == nil {
            maxIndex = max(maxIndex, remote.index)
            guard let index = file.pages.firstIndex(where: { $0.id == remote.id }) else {
                // Eine Seite, die nur am Core liegt, wird nicht zur lokalen Seite (sonst löschte der Abgleich ihre Striche)
                remoteOnly += 1
                continue
            }
            if !pendingUpdatePageIDs.contains(remote.id) {
                file.pages[index].index = remote.index
                file.pages[index].template = remote.template
                file.pages[index].version = remote.version
                file.pages[index].sessionID = remote.sessionID
                file.pages[index].backgroundSlideID = remote.backgroundSlideID
                file.pages[index].attachedSlideID = remote.attachedSlideID
            }
            if file.pages[index].deletedAtMS != nil, !pendingDeletePageIDs.contains(remote.id) {
                // Am Mac wiederhergestellt
                file.pages[index].deletedAtMS = nil
                file.pages[index].deleteQueued = false
            }
        }
        if let index = file.notebooks.firstIndex(where: { $0.id == notebookID }) {
            file.notebooks[index].remoteMaxIndex = maxIndex
            file.notebooks[index].remoteOnlyPageCount = remoteOnly
        }
        persist()
    }

    // MARK: Ändern

    func upsert(_ notebook: LibraryNotebook) {
        if let index = file.notebooks.firstIndex(where: { $0.id == notebook.id }) {
            file.notebooks[index] = notebook
        } else {
            file.notebooks.append(notebook)
        }
        persist()
    }

    func upsert(_ page: LibraryPage) {
        if let index = file.pages.firstIndex(where: { $0.id == page.id }) {
            file.pages[index] = page
        } else {
            file.pages.append(page)
        }
        persist()
    }

    func setLast(notebookID: String, pageID: String?) {
        file.lastNotebookID = notebookID
        if let index = file.notebooks.firstIndex(where: { $0.id == notebookID }) {
            file.notebooks[index].lastPageID = pageID
        }
        persist()
    }

    func removeNotebook(_ id: String) {
        file.notebooks.removeAll { $0.id == id }
        file.pages.removeAll { $0.notebookID == id }
        if file.lastNotebookID == id {
            file.lastNotebookID = nil
        }
        persist()
    }

    func removePage(_ id: String) {
        file.pages.removeAll { $0.id == id }
        for index in file.notebooks.indices where file.notebooks[index].lastPageID == id {
            file.notebooks[index].lastPageID = nil
        }
        persist()
    }

    func setDBEpoch(_ epoch: String) {
        guard file.dbEpoch != epoch else { return }
        file.dbEpoch = epoch
        persist()
    }

    func markLegacyTestPageHandled() {
        guard file.legacyTestPageHandled != true else { return }
        file.legacyTestPageHandled = true
        persist()
    }

    func markAllNeedReconcile() {
        for index in file.pages.indices {
            file.pages[index].needsReconcile = true
        }
        for index in file.notebooks.indices {
            file.notebooks[index].knownOnServer = false
        }
        persist()
    }

    func clearNeedsReconcile(pageID: String) {
        guard let index = file.pages.firstIndex(where: { $0.id == pageID }) else { return }
        file.pages[index].needsReconcile = false
        persist()
    }

    func setModuleInkMode(_ mode: InkMode?, moduleID: String, dirty: Bool) {
        guard let index = file.modules.firstIndex(where: { $0.id == moduleID }) else { return }
        file.modules[index].inkMode = mode
        file.modules[index].inkModeDirty = dirty
        persist()
    }

    // MARK: Intern

    @discardableResult
    private func persist() -> Bool {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(file) else { return false }
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
            return true
        } catch {
            return false
        }
    }
}
