import XCTest

@testable import StudienGehirn

/// L8 aus #286: Antwortet der Core mit `module_not_found`, ist das Modul am Mac gelöscht. Die Notizbücher werden
/// ausgeblendet, die Fehlerablage bleibt leer, die Daten bleiben lokal.
@MainActor
final class ModuleGoneOnMacTests: XCTestCase {
    private let freeID = "019a4e14-0000-7000-8000-0000000000f1"
    private let freePageID = "019a4e14-0000-7000-8000-0000000000f2"
    private let otherModuleID = "019a4e14-0000-7000-8000-0000000000c9"
    private let otherNotebookID = "019a4e14-0000-7000-8000-0000000000f5"

    private func notebook(_ id: String, module: String) -> LibraryNotebook {
        LibraryNotebook(
            id: id, moduleID: module, title: "Eigene Notizen", kind: .frei, createdAtMS: 1_762_246_500_000,
            knownOnServer: false, hidden: false, lastPageID: nil, remoteMaxIndex: 0, remoteOnlyPageCount: 0)
    }

    private func page(_ id: String, in notebookID: String) -> LibraryPage {
        LibraryPage(
            id: id, notebookID: notebookID, index: 1, template: .blanko, widthPt: 595, heightPt: 842,
            sessionID: nil, backgroundSlideID: nil, attachedSlideID: nil, version: 1, createQueued: true,
            needsReconcile: false, deletedAtMS: nil, deleteQueued: false)
    }

    /// Core, dem das Modul fehlt: `notebook.create` kommt mit `module_not_found` zurück
    private func rejectNotebookCreates(_ h: SyncHarness) {
        h.factory.configure = { socket, _ in
            socket.opPolicy = { _, kind, _ in
                kind == "notebook.create" ? .error(code: "module_not_found", retryable: false, fatal: false) : .ack
            }
        }
    }

    private func queueFreeNotebook(_ h: SyncHarness) throws -> LibraryNotebook {
        let free = notebook(freeID, module: h.binding.moduleID)
        h.library.upsert(free)
        let freePage = page(freePageID, in: free.id)
        h.library.upsert(freePage)
        let drafts = [
            try XCTUnwrap(
                InkOpBuilder.notebookCreate(notebook: free, nowMS: 1, offsetMS: nil, makeID: { InkID.uuidV7() })),
            try XCTUnwrap(InkOpBuilder.pageCreate(page: freePage, nowMS: 1, offsetMS: nil, makeID: { InkID.uuidV7() })),
        ]
        XCTAssertTrue(h.engine.enqueue(drafts: drafts))
        return free
    }

    func testModuleNotFoundHidesTheModulesNotebooksWithoutTheDeadLetter() async throws {
        let h = SyncHarness()
        rejectNotebookCreates(h)
        let free = try queueFreeNotebook(h)
        h.start()

        let done = await eventually { h.engine.pendingCount == 0 && h.engine.missingModuleCount == 1 }
        XCTAssertTrue(done)
        XCTAssertEqual(h.engine.deadLetterCount, 0)
        // Ausgeblendet, aber nicht gelöscht: Notizbuch und Seite stehen noch in der Bibliothek
        XCTAssertEqual(h.library.notebook(free.id)?.hidden, true)
        XCTAssertEqual(h.library.notebook(free.id)?.isModuleGone, true)
        XCTAssertNotNil(h.library.page(freePageID))
        XCTAssertTrue(h.library.notebooks(inModule: h.binding.moduleID).isEmpty)
        // Auch das Vorlesungs-Notizbuch des gelöschten Moduls
        XCTAssertEqual(h.library.notebook(h.binding.notebookID)?.hidden, true)
        XCTAssertTrue(h.service.isModuleGoneOnMac(notebookID: free.id))
        // Die Seiten sind zum Abgleich vorgemerkt: Kommt das Modul zurück, holt er die Striche nach
        XCTAssertEqual(h.library.page(freePageID)?.needsReconcile, true)
    }

    func testOtherModulesStayUntouched() async throws {
        let h = SyncHarness()
        rejectNotebookCreates(h)
        h.library.mergeModules(
            [
                ModuleBrief(id: h.binding.moduleID, name: "Analysis I", shortName: nil, inkMode: nil),
                ModuleBrief(id: otherModuleID, name: "Algebra", shortName: nil, inkMode: nil),
            ], at: h.clock.date)
        h.library.upsert(notebook(otherNotebookID, module: otherModuleID))
        _ = try queueFreeNotebook(h)
        h.start()

        let done = await eventually { h.engine.missingModuleCount == 1 }
        XCTAssertTrue(done)
        XCTAssertEqual(h.library.notebook(otherNotebookID)?.hidden, false)
        XCTAssertFalse(h.service.isModuleGoneOnMac(notebookID: otherNotebookID))
    }

    func testStrokesOfAGoneNotebookStayLocalAndFillNoDeadLetter() async throws {
        let h = SyncHarness()
        rejectNotebookCreates(h)
        _ = try queueFreeNotebook(h)
        h.start()
        let hidden = await eventually { h.engine.missingModuleCount == 1 }
        XCTAssertTrue(hidden)

        // Weiterschreiben im offenen Notizbuch: angenommen, aber nichts eingereiht
        XCTAssertTrue(h.enqueueStrokes(2))
        XCTAssertEqual(h.engine.pendingCount, 0)
        XCTAssertEqual(h.engine.deadLetterCount, 0)
    }

    func testModuleNotFoundWithoutAKnownNotebookStillGoesToTheDeadLetter() async throws {
        let h = SyncHarness()
        rejectNotebookCreates(h)
        // Das Notizbuch fehlt in der Bibliothek: Das Modul ist nicht zu bestimmen, es gilt der übliche Weg
        let ghost = notebook(freeID, module: h.binding.moduleID)
        let draft = try XCTUnwrap(
            InkOpBuilder.notebookCreate(notebook: ghost, nowMS: 1, offsetMS: nil, makeID: { InkID.uuidV7() }))
        XCTAssertTrue(h.engine.enqueue(drafts: [draft]))
        h.start()
        let done = await eventually { h.engine.pendingCount == 0 && h.engine.deadLetterCount == 1 }
        XCTAssertTrue(done)
        XCTAssertEqual(h.engine.missingModuleCount, 0)
    }

    func testAnEpochChangeDoesNotRequeueNotebooksOfAGoneModule() async throws {
        let h = SyncHarness()
        let free = notebook(freeID, module: h.binding.moduleID)
        h.library.upsert(free)
        h.library.upsert(page(freePageID, in: free.id))
        h.library.markModuleGone(moduleID: h.binding.moduleID)
        h.library.setDBEpoch("epoch-alt")
        h.factory.configure = { socket, _ in socket.epoch = "epoch-neu" }
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
        XCTAssertEqual(h.engine.pendingCount, 0)
        XCTAssertTrue(h.factory.sockets[0].ops.isEmpty)
    }

    func testTheModuleComingBackShowsFreeNotebooksAgainAndRequeuesThem() {
        let h = SyncHarness()
        h.library.upsert(notebook(freeID, module: h.binding.moduleID))
        h.library.upsert(page(freePageID, in: freeID))
        h.library.markModuleGone(moduleID: h.binding.moduleID)
        XCTAssertTrue(h.library.notebooks(inModule: h.binding.moduleID).isEmpty)

        h.library.mergeModules(
            [ModuleBrief(id: h.binding.moduleID, name: "Analysis I", shortName: nil, inkMode: nil)], at: h.clock.date)
        XCTAssertEqual(h.library.notebook(freeID)?.hidden, false)
        XCTAssertEqual(h.library.notebook(freeID)?.isModuleGone, false)
        XCTAssertEqual(h.library.notebook(freeID)?.knownOnServer, false)
        // `notebook.create` und `page.create` werden beim Öffnen neu eingereiht
        XCTAssertEqual(h.library.page(freePageID)?.createQueued, false)
        XCTAssertEqual(h.library.page(freePageID)?.needsReconcile, true)
    }

    func testAGoneModuleDisappearsFromTheLibrary() {
        let h = SyncHarness()
        h.library.upsert(notebook(freeID, module: h.binding.moduleID))
        h.library.markModuleGone(moduleID: h.binding.moduleID)
        // Der Core listet das Modul nicht mehr: Es bleibt nicht wegen eines Notizbuchs stehen, das nie ankam
        h.library.mergeModules([], at: h.clock.date)
        XCTAssertTrue(h.library.modules.isEmpty)
        XCTAssertNotNil(h.library.notebook(freeID))
    }

    func testOldLibraryFileWithoutTheFlagIsReadable() throws {
        let old = """
            {"id":"n1","moduleID":"m1","title":"Vorlesung","kind":"vorlesung","createdAtMS":1,
            "knownOnServer":true,"hidden":false,"remoteMaxIndex":0,"remoteOnlyPageCount":0}
            """
        let decoded = try JSONDecoder().decode(LibraryNotebook.self, from: Data(old.utf8))
        XCTAssertFalse(decoded.isModuleGone)
    }
}
