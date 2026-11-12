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

    /// Core, dem das Modul fehlt: `notebook.create` kommt mit `module_not_found` zurück, `page.create` desselben
    /// Stroms mit `notebook_not_found`. `GET /modules/{id}` antwortet mit `modules` (Standard: 404, Modul fehlt).
    private func rejectNotebookCreates(
        _ h: SyncHarness,
        modules: FakeTransport.Reply = .http(status: 404, body: Fixtures.apiError("module_not_found"))
    ) {
        h.factory.configure = { socket, _ in
            socket.opPolicy = { _, kind, _ in
                switch kind {
                case "notebook.create": return .error(code: "module_not_found", retryable: false, fatal: false)
                case "page.create": return .error(code: "notebook_not_found", retryable: false, fatal: false)
                default: return .ack
                }
            }
        }
        h.transport.router = { request in
            (request.url?.path ?? "").contains("/modules/") ? modules : nil
        }
    }

    private func moduleChecks(_ h: SyncHarness) -> Int {
        h.transport.requests.filter { ($0.url?.path ?? "").contains("/modules/") }.count
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
        // Erst nach der Rückfrage beim Core
        XCTAssertEqual(moduleChecks(h), 1)
    }

    /// Ein einzelnes `module_not_found` blendet nichts aus, wenn der Core das Modul per REST noch kennt
    func testAModuleThatStillExistsIsNotHidden() async throws {
        let h = SyncHarness()
        rejectNotebookCreates(h, modules: .http(status: 200, body: LibraryFixtures.moduleJSON()))
        let free = try queueFreeNotebook(h)
        h.start()

        let done = await eventually { h.engine.pendingCount == 0 && h.engine.deadLetterCount == 2 }
        XCTAssertTrue(done)
        XCTAssertEqual(h.engine.missingModuleCount, 0)
        // Die übliche Regel: das abgelehnte Notizbuch fällt weg, das Modul und seine übrigen Notizbücher bleiben
        XCTAssertNil(h.library.notebook(free.id))
        XCTAssertEqual(h.library.notebook(h.binding.notebookID)?.hidden, false)
        XCTAssertFalse(h.service.isModuleGoneOnMac(notebookID: h.binding.notebookID))
    }

    /// Ist der Core per REST nicht zu erreichen, bleibt alles in der Warteschlange: nichts ausgeblendet, nichts in der
    /// Fehlerablage, auch nicht das abhängige `page.create`
    func testAnUnconfirmedModuleKeepsItsOperationsQueued() async throws {
        let h = SyncHarness()
        rejectNotebookCreates(h, modules: .failure(.notConnectedToInternet))
        let free = try queueFreeNotebook(h)
        h.start()

        let answered = await eventually { h.factory.sockets.first?.ops.count == 2 && self.moduleChecks(h) == 1 }
        XCTAssertTrue(answered)
        for _ in 0..<200 { await _Concurrency.Task.yield() }
        XCTAssertEqual(h.engine.pendingCount, 2)
        XCTAssertEqual(h.engine.deadLetterCount, 0)
        XCTAssertEqual(h.engine.missingModuleCount, 0)
        XCTAssertEqual(h.library.notebook(free.id)?.hidden, false)
        XCTAssertNotNil(h.library.page(freePageID))
        // Auf dieser Verbindung wird nichts erneut gesendet
        XCTAssertEqual(h.factory.sockets[0].ops.count, 2)
    }

    /// Ein Abgleich im ausgeblendeten Notizbuch plant nichts: kein `page.create` an der Sperre vorbei, das Flag bleibt
    func testReconcileOfAGoneNotebookChangesNothing() async throws {
        let h = SyncHarness()
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
        h.library.markModuleGone(moduleID: h.binding.moduleID)
        let page = InkPageModel(pageID: h.binding.pageID, store: FakeInkPageStore(), saveDelay: .seconds(1))

        let result = await h.engine.reconcile(page: page, binding: h.binding)
        XCTAssertEqual(result, .skipped)
        XCTAssertEqual(h.engine.pendingCount, 0)
        XCTAssertEqual(h.library.page(h.binding.pageID)?.needsReconcile, true)
        XCTAssertEqual(h.service.pagesNeedingReconcile, 0)
    }

    /// Wird das Modul ausgeblendet, während der Abgleich auf den Core wartet, plant er danach nichts: kein
    /// `page.create` an der Sperre vorbei, das Flag bleibt
    func testAModuleThatGoesDuringReconcilePlansNothing() async throws {
        let h = SyncHarness()
        let missingPage = FakeTransport.Reply.http(status: 404, body: Fixtures.apiError("page_not_found"))
        h.transport.router = { request in (request.url?.path ?? "").contains("/pages/") ? missingPage : nil }
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
        let moduleID = h.binding.moduleID
        let library = h.library
        h.transport.duringRequest = { request in
            if (request.url?.path ?? "").contains("/pages/") { library.markModuleGone(moduleID: moduleID) }
        }
        let page = InkPageModel(pageID: h.binding.pageID, store: FakeInkPageStore(), saveDelay: .seconds(1))

        let result = await h.engine.reconcile(page: page, binding: h.binding)
        XCTAssertEqual(result, .skipped)
        XCTAssertEqual(h.engine.pendingCount, 0)
        XCTAssertFalse(h.engine.hasPending(kind: "page.create", stream: h.binding.stream))
        XCTAssertEqual(h.library.page(h.binding.pageID)?.needsReconcile, true)
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

    /// Kommt das Modul beim Abruf zurück, reiht der Dienst Notizbuch und Seiten gleich ein, nicht erst beim Öffnen
    func testRefreshRequeuesTheNotebooksOfAReturnedModule() async throws {
        let h = SyncHarness()
        h.library.upsert(notebook(freeID, module: h.binding.moduleID))
        h.library.upsert(page(freePageID, in: freeID))
        h.library.markModuleGone(moduleID: h.binding.moduleID)
        h.transport.router = { request in
            let path = request.url?.path ?? ""
            if path.hasSuffix("/modules") {
                return .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.moduleJSON()]))
            }
            if path.hasSuffix("/notebooks") {
                return .http(status: 200, body: LibraryFixtures.list([]))
            }
            return .http(status: 200, body: LibraryFixtures.list([]))
        }
        h.factory.configure = { socket, _ in socket.opPolicy = { _, _, _ in .silent } }
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)

        await h.service.refresh(force: true)
        XCTAssertEqual(h.library.notebook(freeID)?.isModuleGone, false)
        XCTAssertEqual(h.library.page(freePageID)?.createQueued, true)
        XCTAssertEqual(h.library.page(freePageID)?.needsReconcile, true)
        XCTAssertTrue(h.engine.hasPending(kind: "notebook.create", stream: "notebook:\(freeID)"))
        XCTAssertEqual(h.engine.pendingPageIDs(kind: "page.create"), [freePageID])
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
