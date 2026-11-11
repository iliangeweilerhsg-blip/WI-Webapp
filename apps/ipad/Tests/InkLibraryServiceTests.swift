import XCTest

@testable import StudienGehirn

@MainActor
final class InkLibraryServiceTests: XCTestCase {
    private let moduleID = LibraryFixtures.moduleID
    private let otherModuleID = "019a4e14-0000-7000-8000-0000000000c2"
    private let exerciseID = "019a4e14-0000-7000-8000-0000000000e2"

    private func startOnline(_ h: SyncHarness) async {
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
    }

    private func pagesBody(_ items: [String]) -> String {
        "{\"items\":[\(items.joined(separator: ","))],\"notebook_id\":\"\(h_binding_notebook)\",\"stream_op_id\":null,\"stream_seq\":0}"
    }

    private func queuedKinds(_ h: SyncHarness) -> [String] {
        SyncOutbox(directory: h.directory).pending.map(\.kind)
    }

    // MARK: Abrufen

    func testRefreshMergesModulesNotebooksAndTheRunningSession() async throws {
        let h = SyncHarness(health: [
            // Das Modul trägt unbekannte Werte in `color` und `layout`: Der Abruf gelingt trotzdem
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.moduleJSON(name: "Analysis I")])),
            .http(
                status: 200,
                body: LibraryFixtures.list([
                    LibraryFixtures.notebookJSON(id: "019a4e14-0000-7000-8000-0000000000a2"),
                    LibraryFixtures.notebookJSON(id: exerciseID, kind: "uebung", title: "Übung"),
                ])),
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.sessionJSON()])),
            // `GET /sessions/{id}/notebook` (#199): der Core nennt „Übung“
            .http(status: 200, body: LibraryFixtures.notebookJSON(id: exerciseID, kind: "uebung", title: "Übung")),
        ])
        await startOnline(h)

        await h.service.refresh(force: true)

        XCTAssertEqual(h.service.modules.map(\.name), ["Analysis I"])
        XCTAssertEqual(h.service.notebooks(inModule: moduleID).map(\.title), ["Vorlesung", "Übung"])
        XCTAssertEqual(h.service.running?.notebookID, exerciseID)
        XCTAssertEqual(h.service.running?.moduleID, moduleID)
        XCTAssertEqual(h.service.running?.startMS, 1_794_384_000_000)
        XCTAssertNotNil(h.service.refreshedAt)

        let paths = h.transport.requests.compactMap { $0.url?.path }
        XCTAssertEqual(
            paths,
            [
                "/api/v1/modules", "/api/v1/notebooks", "/api/v1/sessions",
                "/api/v1/sessions/019a4e14-0000-7000-8000-0000000000d1/notebook",
            ])
    }

    func testRefreshFallsBackToTheOldRuleOnAnOlderCore() async throws {
        let vorlesungID = "019a4e14-0000-7000-8000-0000000000a2"
        let notebooks = LibraryFixtures.list([
            LibraryFixtures.notebookJSON(id: exerciseID, kind: "uebung", title: "Übung"),
            LibraryFixtures.notebookJSON(id: vorlesungID),
        ])
        let h = SyncHarness(health: [
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.moduleJSON()])),
            .http(status: 200, body: notebooks),
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.sessionJSON()])),
            .http(status: 404, body: Fixtures.apiError("not_found")),
            .http(status: 200, body: notebooks),
        ])
        await startOnline(h)

        await h.service.refresh(force: true)
        XCTAssertEqual(h.service.running?.notebookID, vorlesungID)
    }

    func testRefreshWithoutConnectionDoesNothing() async throws {
        let h = SyncHarness()
        // Engine nicht gestartet: kein REST-Versuch, der lokale Stand bleibt
        await h.service.refresh(force: true)
        XCTAssertEqual(h.transport.requests.count, 0)
        XCTAssertNil(h.service.running)
        XCTAssertEqual(h.service.modules.map(\.name), ["Analysis I"])
        XCTAssertNotNil(h.service.notebook(h.binding.notebookID))
    }

    func testRefreshIsThrottledToOnceEvery30Seconds() async throws {
        let h = SyncHarness(health: [
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.moduleJSON()])),
            .http(status: 200, body: LibraryFixtures.list([])),
            .http(status: 200, body: LibraryFixtures.list([])),
        ])
        await startOnline(h)

        await h.service.refresh()
        XCTAssertEqual(h.transport.requests.count, 3)
        await h.service.refresh()
        XCTAssertEqual(h.transport.requests.count, 3)
        await h.clock.advance(31)
        await h.service.refresh()
        XCTAssertGreaterThan(h.transport.requests.count, 3)
    }

    // MARK: Freie Wahl und Anlegen, offline

    func testAnyKnownNotebookOpensOfflineAndWritesWithoutASession() async throws {
        let h = SyncHarness()
        let target = try XCTUnwrap(h.service.openTarget(notebookID: h.binding.notebookID))
        XCTAssertEqual(target.pageID, h.binding.pageID)
        XCTAssertEqual(target.moduleName, "Analysis I")
        XCTAssertNil(target.sessionID)
        XCTAssertNil(target.sessionStartMS)
        // Die Seite war schon angelegt: nichts wird eingereiht
        XCTAssertEqual(h.engine.pendingCount, 0)

        // Schreiben: Die Operation steht in der Warteschlange, ohne Session
        let stroke = h.stroke("s1", tStart: nil)
        XCTAssertTrue(h.engine.enqueue([.upsert(stroke)], binding: target))
        XCTAssertEqual(h.engine.pendingCount, 1)
        let entry = try XCTUnwrap(SyncOutbox(directory: h.directory).pending.first)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(entry.json.utf8)) as? [String: Any])
        let wire = try XCTUnwrap((json["data"] as? [String: Any])?["stroke"] as? [String: Any])
        XCTAssertTrue(wire["t_start_ms"] is NSNull)
        XCTAssertNil(entry.sessionStartMS)
    }

    func testCreatingANotebookOfflineQueuesNotebookCreateThenPageCreate() async throws {
        let h = SyncHarness()
        let notebook = try XCTUnwrap(h.service.createNotebook(moduleID: moduleID, title: "  Eigene Notizen  "))
        XCTAssertEqual(notebook.title, "Eigene Notizen")
        XCTAssertEqual(notebook.kind, .frei)
        XCTAssertFalse(notebook.knownOnServer)
        XCTAssertEqual(h.service.notebooks(inModule: moduleID).map(\.title), ["Vorlesung", "Eigene Notizen"])
        XCTAssertEqual(queuedKinds(h), ["notebook.create"])

        let target = try XCTUnwrap(h.service.openTarget(notebookID: notebook.id))
        XCTAssertEqual(queuedKinds(h), ["notebook.create", "page.create"])
        let page = try XCTUnwrap(h.library.page(target.pageID))
        XCTAssertEqual(page.index, 1)
        XCTAssertTrue(page.createQueued)
        XCTAssertEqual(h.library.notebook(notebook.id)?.lastPageID, page.id)

        // Zweites Öffnen: dieselbe Seite, kein zweites `page.create`
        let again = try XCTUnwrap(h.service.openTarget(notebookID: notebook.id))
        XCTAssertEqual(again.pageID, target.pageID)
        XCTAssertEqual(queuedKinds(h), ["notebook.create", "page.create"])
    }

    func testTheCreatedNotebookReachesTheMacAfterConnecting() async throws {
        let h = SyncHarness()
        let notebook = try XCTUnwrap(h.service.createNotebook(moduleID: moduleID, title: "Eigene Notizen"))
        _ = try XCTUnwrap(h.service.openTarget(notebookID: notebook.id))
        await startOnline(h)

        let done = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(done)
        let kinds = h.factory.sockets[0].ops.map { $0.object["kind"] as? String }
        XCTAssertEqual(kinds, ["notebook.create", "page.create"])
        XCTAssertEqual(h.factory.sockets[0].ops.first?.object["stream"] as? String, "notebook:\(notebook.id)")
    }

    func testAnEmptyTitleOrAnUnknownModuleCreatesNothing() async throws {
        let h = SyncHarness()
        XCTAssertNil(h.service.createNotebook(moduleID: moduleID, title: ""))
        XCTAssertNil(h.service.createNotebook(moduleID: moduleID, title: "   \n"))
        XCTAssertNil(h.service.createNotebook(moduleID: "unbekannt", title: "Titel"))
        XCTAssertEqual(h.engine.pendingCount, 0)
        XCTAssertEqual(h.service.notebooks(inModule: moduleID).count, 1)
    }

    func testANotebookWhoseCreateWasLostGetsItQueuedAgainWithItsFirstPage() async throws {
        // Absturz zwischen „Notizbuch gespeichert“ und „notebook.create eingereiht“
        let h = SyncHarness()
        h.library.upsert(
            LibraryNotebook(
                id: "019a4e14-0000-7000-8000-0000000000f1", moduleID: moduleID, title: "Verwaist", kind: .frei,
                createdAtMS: 9, knownOnServer: false, hidden: false, lastPageID: nil, remoteMaxIndex: 0,
                remoteOnlyPageCount: 0))
        _ = try XCTUnwrap(h.service.openTarget(notebookID: "019a4e14-0000-7000-8000-0000000000f1"))
        XCTAssertEqual(queuedKinds(h), ["notebook.create", "page.create"])
    }

    func testTheFirstPageContinuesAfterTheHighestIndexTheCoreHas() async throws {
        let h = SyncHarness()
        let notebook = LibraryNotebook(
            id: "019a4e14-0000-7000-8000-0000000000f1", moduleID: moduleID, title: "Mit Mac-Seiten", kind: .frei,
            createdAtMS: 9, knownOnServer: true, hidden: false, lastPageID: nil, remoteMaxIndex: 7,
            remoteOnlyPageCount: 7)
        h.library.upsert(notebook)
        let target = try XCTUnwrap(h.service.openTarget(notebookID: notebook.id))
        XCTAssertEqual(h.library.page(target.pageID)?.index, 8)
    }

    func testAnUnknownNotebookGivesNoTarget() async throws {
        let h = SyncHarness()
        XCTAssertNil(h.service.openTarget(notebookID: "gibt-es-nicht"))
    }

    func testOpeningPicksTheLastPageThenTheHighestIndex() async throws {
        let h = SyncHarness()
        let nbID = h.binding.notebookID
        func extra(_ id: String, index: Int) -> LibraryPage {
            LibraryPage(
                id: id, notebookID: nbID, index: index, template: .blanko, widthPt: 595, heightPt: 842,
                sessionID: nil, backgroundSlideID: nil, attachedSlideID: nil, version: 1, createQueued: true,
                needsReconcile: false, deletedAtMS: nil, deleteQueued: false)
        }
        h.library.upsert(extra("p-hoch", index: 5))
        // `lastPageID` zeigt auf die Seite aus dem Harness
        XCTAssertEqual(h.service.openTarget(notebookID: nbID)?.pageID, h.binding.pageID)
        // Ohne `lastPageID` gewinnt der höchste Index
        h.library.setLast(notebookID: nbID, pageID: nil)
        XCTAssertEqual(h.service.openTarget(notebookID: nbID)?.pageID, "p-hoch")
    }

    // MARK: Session-Zuordnung

    func testTheSessionIsOnlyAssignedWithinItsModule() async throws {
        let h = SyncHarness(health: [
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.moduleJSON()])),
            .http(status: 200, body: LibraryFixtures.list([])),
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.sessionJSON()])),
            .http(
                status: 200,
                body: LibraryFixtures.notebookJSON(id: h_binding_notebook)),
        ])
        await startOnline(h)
        await h.service.refresh(force: true)
        XCTAssertNotNil(h.service.running)

        // Gleiches Modul: Session und Start gesetzt, auch für eine Seite, die vor der Vorlesung geöffnet war
        let same = try XCTUnwrap(h.service.target(forPage: h.binding.pageID))
        XCTAssertEqual(same.sessionID, "019a4e14-0000-7000-8000-0000000000d1")
        XCTAssertEqual(same.sessionStartMS, 1_794_384_000_000)

        // Anderes Modul: keine Session, `presence.session_id = null`
        h.library.mergeModules(
            [
                ModuleBrief(id: moduleID, name: "Analysis I", shortName: nil, inkMode: nil),
                ModuleBrief(id: otherModuleID, name: "Statistik", shortName: nil, inkMode: nil),
            ], at: h.clock.date)
        let other = try XCTUnwrap(h.service.createNotebook(moduleID: otherModuleID, title: "Statistik frei"))
        let target = try XCTUnwrap(h.service.openTarget(notebookID: other.id))
        XCTAssertNil(target.sessionID)
        XCTAssertNil(target.sessionStartMS)
        XCTAssertNil(h.library.page(target.pageID)?.sessionID)
    }

    // MARK: Seiten abgleichen

    func testRefreshPagesKeepsTheLocalIndexWhileAnUpdateIsPending() async throws {
        let h = SyncHarness(health: [
            .http(
                status: 200,
                body: pagesBody([LibraryFixtures.pageJSON(id: h_binding_page, notebookID: h_binding_notebook, index: 5)])
            )
        ])
        // Eine `page.update` wartet noch (Umsortieren, offline)
        XCTAssertTrue(
            h.engine.enqueue(drafts: [
                OutboxDraft(
                    opID: "019a4e14-0000-7000-8000-0000000000aa", stream: "notebook:\(h.binding.notebookID)",
                    kind: "page.update", pageID: h.binding.pageID, json: "{}", clockUncertain: false,
                    sessionStartMS: nil)
            ]))
        await startOnline(h)

        await h.service.refreshPages(notebookID: h.binding.notebookID)
        // Der Core meldet Index 5, die Seite bleibt bei ihrem lokalen Stand
        XCTAssertEqual(h.library.page(h.binding.pageID)?.index, 1)
        XCTAssertEqual(h.library.notebook(h.binding.notebookID)?.remoteMaxIndex, 5)
    }

    func testRefreshPagesQueuesPageCreateForAPageTheCoreLostAfterANewEpoch() async throws {
        let h = SyncHarness(health: [
            .http(status: 200, body: pagesBody([]))
        ])
        var lost = try XCTUnwrap(h.library.page(h.binding.pageID))
        lost.needsReconcile = true
        h.library.upsert(lost)
        await startOnline(h)
        h.factory.sockets[0].opPolicy = { _, _, _ in .silent }

        await h.service.refreshPages(notebookID: h.binding.notebookID)
        let done = await eventually { h.factory.sockets[0].ops.count == 1 }
        XCTAssertTrue(done)
        XCTAssertEqual(h.factory.sockets[0].ops.first?.object["kind"] as? String, "page.create")

        // Ein zweiter Abruf, solange `page.create` noch wartet, reiht nichts doppelt ein
        h.transport.replies = [.http(status: 200, body: pagesBody([]))]
        await h.service.refreshPages(notebookID: h.binding.notebookID)
        await h.clock.settle()
        XCTAssertEqual(h.engine.pendingCount, 1)
    }

    // MARK: Namen

    func testModulesAreSortedAlphabetically() async throws {
        let h = SyncHarness()
        h.library.mergeModules(
            [
                ModuleBrief(id: "m3", name: "statistik", shortName: nil, inkMode: nil),
                ModuleBrief(id: "m1", name: "Zoologie", shortName: nil, inkMode: nil),
                ModuleBrief(id: "m2", name: "Analysis I", shortName: nil, inkMode: nil),
            ], at: h.clock.date)
        XCTAssertEqual(h.service.modules.map(\.name), ["Analysis I", "statistik", "Zoologie"])
    }

    func testTitleAndOfflineLineNameModuleAndNotebook() {
        XCTAssertEqual(
            InkPageTitle.text(moduleName: "Analysis I", notebookTitle: "Eigene Notizen"),
            "Analysis I · Eigene Notizen")
        XCTAssertEqual(InkPageTitle.text(moduleName: "Analysis I", notebookTitle: nil), "Analysis I")
        XCTAssertEqual(InkPageTitle.text(moduleName: nil, notebookTitle: "Frei"), "Frei")
        XCTAssertEqual(InkPageTitle.text(moduleName: nil, notebookTitle: " "), "Vorlesung")
        XCTAssertEqual(
            InkPageTitle.offlineLine(moduleName: "Analysis I", notebookTitle: "Eigene Notizen"),
            "Offline · schreibt in Analysis I · Eigene Notizen")
        XCTAssertEqual(
            InkPageTitle.offlineLine(moduleName: "Analysis I", notebookTitle: nil),
            "Offline · schreibt in Analysis I")
    }

    func testLibraryTexts() {
        XCTAssertEqual(LibraryTexts.offlineLine(refreshedAt: nil), "Offline")
        XCTAssertTrue(LibraryTexts.offlineLine(refreshedAt: Date()).hasPrefix("Offline · Stand von "))
        XCTAssertEqual(
            LibraryTexts.emptyText(isOnline: false),
            "Noch keine Notizbücher geladen. Verbinde das iPad einmal mit dem Mac.")
    }
}

/// Feste IDs des Harness, damit JSON-Beispiele sie nennen können, bevor der Harness besteht
private let h_binding_notebook = "019a4e14-0000-7000-8000-0000000000a2"
private let h_binding_page = "019a4e14-0000-7000-8000-0000000000b1"
