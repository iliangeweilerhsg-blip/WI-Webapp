import XCTest

@testable import StudienGehirn

/// JSON-Beispiele für die Tests der Bibliothek. Alles erfunden, keine echten Daten.
enum LibraryFixtures {
    static let userID = "019a4e14-0000-7000-8000-000000000001"
    static let moduleID = "019a4e14-0000-7000-8000-0000000000c1"

    static func moduleJSON(id: String = moduleID, name: String = "Analysis I", inkMode: String? = nil) -> String {
        let mode = inkMode.map { ",\"ink_mode\":\"\($0)\"" } ?? ""
        // `color` und `layout` tragen Werte, die diese App nicht kennt: Der Abruf darf trotzdem gelingen
        return """
            {"id":"\(id)","user_id":"\(userID)","semester_id":"019a4e14-0000-7000-8000-0000000000b0",
            "name":"\(name)","short_name":null,"color":"neonpink","settings":{"layout":"neues_layout"\(mode)},
            "created_at":"2026-11-04T07:15:00Z","updated_at":"2026-11-04T07:15:00Z","deleted_at":null}
            """
    }

    static func notebookJSON(
        id: String, kind: String = "vorlesung", title: String = "Vorlesung", moduleID: String = moduleID,
        createdAt: String = "2026-11-04T07:15:00Z"
    ) -> String {
        """
        {"id":"\(id)","user_id":"\(userID)","module_id":"\(moduleID)","kind":"\(kind)","title":"\(title)",
        "page_count":0,"created_at":"\(createdAt)","updated_at":"\(createdAt)","deleted_at":null}
        """
    }

    static func pageJSON(
        id: String, notebookID: String, index: Int, template: String = "blanko", version: Int = 1
    ) -> String {
        """
        {"id":"\(id)","user_id":"\(userID)","notebook_id":"\(notebookID)","index":\(index),"template":"\(template)",
        "width_pt":595,"height_pt":842,"session_id":null,"background_slide_id":null,"attached_slide_id":null,
        "has_pkdrawing":false,"version":\(version),"created_at":"2026-11-04T07:15:00Z",
        "updated_at":"2026-11-04T07:15:00Z","deleted_at":null}
        """
    }

    static func list(_ items: [String], next: String? = nil) -> String {
        let cursor = next.map { "\"\($0)\"" } ?? "null"
        return "{\"items\":[\(items.joined(separator: ","))],\"next_cursor\":\(cursor)}"
    }

    static func sessionJSON(id: String = "019a4e14-0000-7000-8000-0000000000d1", moduleID: String = moduleID) -> String {
        """
        {"id":"\(id)","user_id":"\(userID)","module_id":"\(moduleID)","created_at":"2026-11-04T07:15:00Z",
        "updated_at":"2026-11-04T07:15:00Z","deleted_at":null,"state":"laeuft",
        "started_at":"2026-11-11T08:00:00Z","processing":{},"review_state":"offen"}
        """
    }

    static func notebook(_ json: String) throws -> Notebook {
        try Notebook(data: Data(json.utf8))
    }

    static func page(_ json: String) throws -> Page {
        try Page(data: Data(json.utf8))
    }
}

@MainActor
final class InkLibraryStoreTests: XCTestCase {
    private func makeURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("library-test-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("library.json")
    }

    private func notebook(
        _ id: String, module: String = LibraryFixtures.moduleID, title: String = "Frei", kind: NotebookKind = .frei,
        known: Bool = true, hidden: Bool = false, created: Int = 10
    ) -> LibraryNotebook {
        LibraryNotebook(
            id: id, moduleID: module, title: title, kind: kind, createdAtMS: created, knownOnServer: known,
            hidden: hidden, lastPageID: nil, remoteMaxIndex: 0, remoteOnlyPageCount: 0)
    }

    private func page(_ id: String, in notebookID: String, index: Int = 1) -> LibraryPage {
        LibraryPage(
            id: id, notebookID: notebookID, index: index, template: .blanko, widthPt: 595, heightPt: 842,
            sessionID: nil, backgroundSlideID: nil, attachedSlideID: nil, version: 1, createQueued: true,
            needsReconcile: false, deletedAtMS: nil, deleteQueued: false)
    }

    private func brief(_ id: String, name: String = "Analysis I", mode: InkMode? = nil) -> ModuleBrief {
        ModuleBrief(id: id, name: name, shortName: nil, inkMode: mode)
    }

    // MARK: Module

    func testServerModulesReplaceTheLocalList() {
        let store = FileInkLibraryStore(url: makeURL())
        store.mergeModules([brief("m1", name: "Alt"), brief("m2", name: "Zwei")], at: Date(timeIntervalSince1970: 100))
        XCTAssertEqual(store.modules.map(\.id), ["m1", "m2"])
        XCTAssertEqual(store.refreshedAt, Date(timeIntervalSince1970: 100))

        store.mergeModules([brief("m1", name: "Neu")], at: Date(timeIntervalSince1970: 200))
        XCTAssertEqual(store.modules.map(\.id), ["m1"])
        XCTAssertEqual(store.modules.first?.name, "Neu")
    }

    func testDirtyInkModeSurvivesAFetch() {
        let store = FileInkLibraryStore(url: makeURL())
        store.mergeModules([brief("m1")], at: Date())
        store.setModuleInkMode(.aufFolie, moduleID: "m1", dirty: true)
        store.mergeModules([brief("m1", mode: .freieSeite)], at: Date())
        XCTAssertEqual(store.modules.first?.inkMode, .aufFolie)
        XCTAssertEqual(store.modules.first?.inkModeDirty, true)

        // Nach dem Senden gilt wieder der Stand des Core
        store.setModuleInkMode(.aufFolie, moduleID: "m1", dirty: false)
        store.mergeModules([brief("m1", mode: .freieSeite)], at: Date())
        XCTAssertEqual(store.modules.first?.inkMode, .freieSeite)
    }

    func testModuleMissingAtTheCoreStaysOnlyWithAnUnknownNotebook() {
        let store = FileInkLibraryStore(url: makeURL())
        store.mergeModules([brief("m1"), brief("m2")], at: Date())
        store.upsert(notebook("n-lokal", module: "m2", known: false))
        store.upsert(notebook("n-bekannt", module: "m1", known: true))

        store.mergeModules([], at: Date())
        XCTAssertEqual(store.modules.map(\.id), ["m2"])
    }

    // MARK: Notizbücher

    func testServerNotebooksAreTakenOver() throws {
        let store = FileInkLibraryStore(url: makeURL())
        let json = LibraryFixtures.notebookJSON(id: "n1", kind: "uebung", title: "Übung")
        store.mergeNotebooks([try LibraryFixtures.notebook(json)], moduleID: LibraryFixtures.moduleID)
        let found = try XCTUnwrap(store.notebook("n1"))
        XCTAssertEqual(found.title, "Übung")
        XCTAssertEqual(found.kind, .uebung)
        XCTAssertTrue(found.knownOnServer)
        XCTAssertFalse(found.hidden)
        XCTAssertGreaterThan(found.createdAtMS, 0)
    }

    func testALocalNotebookSurvivesAFetchInWhichItIsStillMissing() throws {
        let store = FileInkLibraryStore(url: makeURL())
        store.upsert(notebook("n-lokal", known: false))
        store.mergeNotebooks(
            [try LibraryFixtures.notebook(LibraryFixtures.notebookJSON(id: "n1"))], moduleID: LibraryFixtures.moduleID)
        let local = try XCTUnwrap(store.notebook("n-lokal"))
        XCTAssertFalse(local.hidden)
        XCTAssertFalse(local.knownOnServer)
        XCTAssertEqual(store.notebooks(inModule: LibraryFixtures.moduleID).count, 2)
    }

    func testAKnownNotebookMissingAtTheCoreIsHiddenButStays() throws {
        let store = FileInkLibraryStore(url: makeURL())
        store.upsert(notebook("n-weg", known: true))
        store.upsert(page("p1", in: "n-weg"))
        store.mergeNotebooks(
            [try LibraryFixtures.notebook(LibraryFixtures.notebookJSON(id: "n1"))], moduleID: LibraryFixtures.moduleID)
        XCTAssertEqual(store.notebook("n-weg")?.hidden, true)
        XCTAssertEqual(store.notebooks(inModule: LibraryFixtures.moduleID).map(\.id), ["n1"])
        // Die Seite und ihre Dateien bleiben
        XCTAssertNotNil(store.page("p1"))
    }

    func testAHiddenNotebookComesBackWhenTheCoreListsItAgain() throws {
        let store = FileInkLibraryStore(url: makeURL())
        store.upsert(notebook("n1", known: true, hidden: true))
        store.mergeNotebooks(
            [try LibraryFixtures.notebook(LibraryFixtures.notebookJSON(id: "n1"))], moduleID: LibraryFixtures.moduleID)
        XCTAssertEqual(store.notebook("n1")?.hidden, false)
    }

    func testNotebooksOfOtherModulesAreNotTouchedByAFetch() throws {
        let store = FileInkLibraryStore(url: makeURL())
        store.upsert(notebook("n-anders", module: "m2", known: true))
        store.mergeNotebooks([], moduleID: LibraryFixtures.moduleID)
        XCTAssertEqual(store.notebook("n-anders")?.hidden, false)
    }

    func testNotebooksAreSortedByCreationThenID() {
        let store = FileInkLibraryStore(url: makeURL())
        store.upsert(notebook("b", created: 20))
        store.upsert(notebook("c", created: 10))
        store.upsert(notebook("a", created: 20))
        XCTAssertEqual(store.notebooks(inModule: LibraryFixtures.moduleID).map(\.id), ["c", "a", "b"])
    }

    // MARK: Seiten

    func testServerPageUpdatesTheLocalOne() throws {
        let store = FileInkLibraryStore(url: makeURL())
        store.upsert(notebook("n1"))
        store.upsert(page("p1", in: "n1", index: 1))
        let remote = try LibraryFixtures.page(
            LibraryFixtures.pageJSON(id: "p1", notebookID: "n1", index: 3, template: "liniert", version: 5))
        store.mergePages([remote], notebookID: "n1", pendingUpdatePageIDs: [], pendingDeletePageIDs: [])
        let merged = try XCTUnwrap(store.page("p1"))
        XCTAssertEqual(merged.index, 3)
        XCTAssertEqual(merged.template, .liniert)
        XCTAssertEqual(merged.version, 5)
        XCTAssertEqual(store.notebook("n1")?.remoteMaxIndex, 3)
        XCTAssertEqual(store.notebook("n1")?.remoteOnlyPageCount, 0)
    }

    func testAPendingUpdateKeepsTheLocalIndex() throws {
        // Ein `ack` traf während des Abrufs ein, die Antwort zeigt noch den alten Stand
        let store = FileInkLibraryStore(url: makeURL())
        store.upsert(notebook("n1"))
        var local = page("p1", in: "n1", index: 4)
        local.version = 2
        store.upsert(local)
        let stale = try LibraryFixtures.page(
            LibraryFixtures.pageJSON(id: "p1", notebookID: "n1", index: 1, template: "kariert", version: 1))
        store.mergePages([stale], notebookID: "n1", pendingUpdatePageIDs: ["p1"], pendingDeletePageIDs: [])
        let kept = try XCTUnwrap(store.page("p1"))
        XCTAssertEqual(kept.index, 4)
        XCTAssertEqual(kept.template, .blanko)
        XCTAssertEqual(kept.version, 2)
        // Der Stand des Core zählt trotzdem für `remoteMaxIndex`
        XCTAssertEqual(store.notebook("n1")?.remoteMaxIndex, 1)
    }

    func testAPageOnlyAtTheCoreIsNotCreatedLocally() throws {
        let store = FileInkLibraryStore(url: makeURL())
        store.upsert(notebook("n1"))
        store.upsert(page("p1", in: "n1", index: 1))
        let remotes = [
            try LibraryFixtures.page(LibraryFixtures.pageJSON(id: "p1", notebookID: "n1", index: 1)),
            try LibraryFixtures.page(LibraryFixtures.pageJSON(id: "p-mac-1", notebookID: "n1", index: 2)),
            try LibraryFixtures.page(LibraryFixtures.pageJSON(id: "p-mac-2", notebookID: "n1", index: 9)),
        ]
        store.mergePages(remotes, notebookID: "n1", pendingUpdatePageIDs: [], pendingDeletePageIDs: [])
        XCTAssertNil(store.page("p-mac-1"))
        XCTAssertEqual(store.pages(inNotebook: "n1").map(\.id), ["p1"])
        XCTAssertEqual(store.notebook("n1")?.remoteMaxIndex, 9)
        XCTAssertEqual(store.notebook("n1")?.remoteOnlyPageCount, 2)
    }

    func testALocalOnlyPageStaysUntouched() throws {
        let store = FileInkLibraryStore(url: makeURL())
        store.upsert(notebook("n1"))
        let local = page("p-neu", in: "n1", index: 6)
        store.upsert(local)
        store.mergePages([], notebookID: "n1", pendingUpdatePageIDs: [], pendingDeletePageIDs: [])
        XCTAssertEqual(store.page("p-neu"), local)
    }

    func testALocallyDeletedPageComesBackOnlyWithoutAPendingDelete() throws {
        let store = FileInkLibraryStore(url: makeURL())
        store.upsert(notebook("n1"))
        var deleted = page("p1", in: "n1")
        deleted.deletedAtMS = 5000
        deleted.deleteQueued = true
        store.upsert(deleted)
        XCTAssertTrue(store.pages(inNotebook: "n1").isEmpty)
        let remote = try LibraryFixtures.page(LibraryFixtures.pageJSON(id: "p1", notebookID: "n1", index: 1))

        // Das Löschen ist unterwegs: Die Seite bleibt gelöscht
        store.mergePages([remote], notebookID: "n1", pendingUpdatePageIDs: [], pendingDeletePageIDs: ["p1"])
        XCTAssertNotNil(store.page("p1")?.deletedAtMS)
        XCTAssertTrue(store.pages(inNotebook: "n1").isEmpty)

        // Nichts wartet mehr, der Core führt sie trotzdem: am Mac wiederhergestellt
        store.mergePages([remote], notebookID: "n1", pendingUpdatePageIDs: [], pendingDeletePageIDs: [])
        XCTAssertNil(store.page("p1")?.deletedAtMS)
        XCTAssertEqual(store.pages(inNotebook: "n1").map(\.id), ["p1"])
    }

    func testPagesAreSortedByIndexThenID() {
        let store = FileInkLibraryStore(url: makeURL())
        store.upsert(page("b", in: "n1", index: 2))
        store.upsert(page("a", in: "n1", index: 2))
        store.upsert(page("c", in: "n1", index: 1))
        XCTAssertEqual(store.pages(inNotebook: "n1").map(\.id), ["c", "a", "b"])
    }

    // MARK: Ändern und Entfernen

    func testRemovingANotebookRemovesItsPagesAndLastPointer() {
        let store = FileInkLibraryStore(url: makeURL())
        store.upsert(notebook("n1"))
        store.upsert(notebook("n2"))
        store.upsert(page("p1", in: "n1"))
        store.upsert(page("p2", in: "n2"))
        store.setLast(notebookID: "n1", pageID: "p1")
        store.removeNotebook("n1")
        XCTAssertNil(store.notebook("n1"))
        XCTAssertNil(store.page("p1"))
        XCTAssertNotNil(store.page("p2"))
        XCTAssertNil(store.lastNotebookID)
    }

    func testRemovingAPageClearsTheLastPagePointer() {
        let store = FileInkLibraryStore(url: makeURL())
        store.upsert(notebook("n1"))
        store.upsert(page("p1", in: "n1"))
        store.setLast(notebookID: "n1", pageID: "p1")
        XCTAssertEqual(store.notebook("n1")?.lastPageID, "p1")
        store.removePage("p1")
        XCTAssertNil(store.page("p1"))
        XCTAssertNil(store.notebook("n1")?.lastPageID)
    }

    func testNewEpochMarksPagesAndForgetsWhatTheCoreKnew() {
        let store = FileInkLibraryStore(url: makeURL())
        store.upsert(notebook("n1", known: true))
        store.upsert(page("p1", in: "n1"))
        store.markAllNeedReconcile()
        XCTAssertEqual(store.page("p1")?.needsReconcile, true)
        XCTAssertEqual(store.notebook("n1")?.knownOnServer, false)
        // Nichts wird ausgeblendet
        XCTAssertEqual(store.notebook("n1")?.hidden, false)
        store.clearNeedsReconcile(pageID: "p1")
        XCTAssertEqual(store.page("p1")?.needsReconcile, false)
    }

    /// L2 aus #225: Nur freie Notizbücher legt das iPad neu an. Ein Vorlesungs- oder Übungs-Notizbuch, das nach der
    /// Wiederherstellung am Core fehlt, muss ausgeblendet werden können.
    func testNewEpochKeepsWhatTheMacOwnsKnownAndHidesItWhenMissing() {
        let store = FileInkLibraryStore(url: makeURL())
        store.upsert(notebook("lecture", kind: .vorlesung, known: true))
        store.upsert(notebook("free", kind: .frei, known: true))
        store.markAllNeedReconcile()
        XCTAssertEqual(store.notebook("lecture")?.knownOnServer, true)
        XCTAssertEqual(store.notebook("free")?.knownOnServer, false)
        store.mergeNotebooks([], moduleID: LibraryFixtures.moduleID)
        XCTAssertEqual(store.notebook("lecture")?.hidden, true)
        XCTAssertEqual(store.notebook("free")?.hidden, false)
    }

    // MARK: Auf der Platte

    func testTheLibrarySurvivesARestart() throws {
        let url = makeURL()
        let store = FileInkLibraryStore(url: url)
        store.mergeModules([brief("m1")], at: Date(timeIntervalSince1970: 1000))
        store.upsert(notebook("n1", module: "m1"))
        store.upsert(page("p1", in: "n1", index: 2))
        store.setLast(notebookID: "n1", pageID: "p1")
        store.setDBEpoch("epoch-1")

        let reopened = FileInkLibraryStore(url: url)
        XCTAssertEqual(reopened.modules.map(\.id), ["m1"])
        XCTAssertEqual(reopened.notebook("n1")?.lastPageID, "p1")
        XCTAssertEqual(reopened.page("p1")?.index, 2)
        XCTAssertEqual(reopened.lastNotebookID, "n1")
        XCTAssertEqual(reopened.dbEpoch, "epoch-1")
        XCTAssertEqual(reopened.refreshedAt, Date(timeIntervalSince1970: 1000))
    }

    func testAnUnreadableLibraryFileIsSetAsideAndStartsEmpty() throws {
        let url = makeURL()
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("kein json".utf8).write(to: url)
        let store = FileInkLibraryStore(url: url)
        XCTAssertTrue(store.modules.isEmpty)
        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: url.deletingLastPathComponent().appendingPathComponent("library.defekt.json").path))
    }

    // MARK: ModuleBrief und CoreClient

    func testModuleBriefIgnoresUnknownColorLayoutAndInkMode() throws {
        let data = Data(LibraryFixtures.moduleJSON(inkMode: "irgendwas_neues").utf8)
        let decoded = try JSONDecoder().decode(ModuleBrief.self, from: data)
        XCTAssertEqual(decoded.name, "Analysis I")
        XCTAssertNil(decoded.inkMode)
        let known = try JSONDecoder().decode(
            ModuleBrief.self, from: Data(LibraryFixtures.moduleJSON(inkMode: "auf_folie").utf8))
        XCTAssertEqual(known.inkMode, .aufFolie)
    }

    func testClientFollowsTheCursorForModulesAndNotebooks() async throws {
        let transport = FakeTransport([
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.moduleJSON(id: "m1")], next: "c2")),
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.moduleJSON(id: "m2")])),
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.notebookJSON(id: "n1")], next: "c9")),
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.notebookJSON(id: "n2")])),
        ])
        let client = Fixtures.client(transport)

        let modules = try await client.modules(endpoint: Fixtures.endpoint, token: Fixtures.token)
        XCTAssertEqual(modules.map(\.id), ["m1", "m2"])
        XCTAssertEqual(transport.requests[0].url?.path, "/api/v1/modules")
        XCTAssertEqual(transport.requests[0].url?.query, "limit=200")
        XCTAssertEqual(transport.requests[1].url?.query, "limit=200&cursor=c2")

        let notebooks = try await client.notebooks(endpoint: Fixtures.endpoint, token: Fixtures.token, moduleID: "m1")
        XCTAssertEqual(notebooks.map(\.id), ["n1", "n2"])
        XCTAssertEqual(transport.requests[2].url?.query, "module_id=m1&limit=200")
        XCTAssertEqual(transport.requests[3].url?.query, "module_id=m1&limit=200&cursor=c9")
    }
}
