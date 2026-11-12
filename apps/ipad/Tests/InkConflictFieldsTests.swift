import XCTest

@testable import StudienGehirn

/// `page_version_conflict` feldweise lösen (VERTRAEGE §11.2, L9 aus #225) und alte `library.json` (L3)
@MainActor
final class InkConflictFieldsTests: XCTestCase {
    private let notebookID = "019a4e14-0000-7000-8000-0000000000a2"
    private let firstPageID = "019a4e14-0000-7000-8000-0000000000b1"
    private let secondPageID = "019a4e14-0000-7000-8000-0000000000b2"

    // MARK: Hilfen

    private func startOnline(_ h: SyncHarness) async {
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
    }

    private func pendingEntries(_ h: SyncHarness) -> [OutboxEntry] {
        SyncOutbox(directory: h.directory).pending
    }

    private func detail(id: String, index: Int, template: String, version: Int) -> String {
        """
        {"page":\(LibraryFixtures.pageJSON(id: id, notebookID: notebookID, index: index, template: template, version: version)),
        "elements":[],"stream_seq":0,"stream_op_id":null}
        """
    }

    private func secondPage() -> LibraryPage {
        LibraryPage(
            id: secondPageID, notebookID: notebookID, index: 2, template: .blanko, widthPt: 595, heightPt: 842,
            sessionID: nil, backgroundSlideID: nil, attachedSlideID: nil, version: 1, createQueued: true,
            needsReconcile: false, deletedAtMS: nil, deleteQueued: false)
    }

    /// Lässt nur die Operation mit dieser ID mit `page_version_conflict` zurückkommen
    private func rejecting(_ opID: String, on h: SyncHarness) {
        h.factory.configure = { socket, _ in
            socket.opPolicy = { id, _, _ in
                id == opID ? .error(code: "page_version_conflict", retryable: false, fatal: false) : .ack
            }
        }
    }

    private func fields(of op: (text: String, object: [String: Any])) throws -> [String: Any] {
        let data = try XCTUnwrap(op.object["data"] as? [String: Any])
        return try XCTUnwrap(data["fields"] as? [String: Any])
    }

    // MARK: Merkliste der geänderten Felder

    func testTheLibraryRemembersWhichFieldsChangedLocally() {
        let h = SyncHarness()
        XCTAssertNil(h.library.page(firstPageID)?.dirtyFields)
        XCTAssertTrue(h.service.setTemplate(pageID: firstPageID, .liniert))
        XCTAssertEqual(h.library.page(firstPageID)?.dirtyFields, ["template"])

        h.library.upsert(secondPage())
        XCTAssertTrue(h.service.movePage(notebookID: notebookID, from: 0, to: 1))
        // Beide Änderungen wurden noch nicht bestätigt: Die Liste sammelt sie
        XCTAssertEqual(h.library.page(firstPageID)?.dirtyFields, ["index", "template"])
        XCTAssertEqual(h.library.page(secondPageID)?.dirtyFields, ["index"])
    }

    func testMergingThePagesDropsTheListOnlyWhenNothingIsWaiting() throws {
        let h = SyncHarness()
        XCTAssertTrue(h.service.setTemplate(pageID: firstPageID, .liniert))
        let remote = try LibraryFixtures.page(
            LibraryFixtures.pageJSON(id: firstPageID, notebookID: notebookID, index: 1, template: "blanko", version: 5))

        h.library.mergePages(
            [remote], notebookID: notebookID, pendingUpdatePageIDs: [firstPageID], pendingDeletePageIDs: [])
        XCTAssertEqual(h.library.page(firstPageID)?.dirtyFields, ["template"])
        XCTAssertEqual(h.library.page(firstPageID)?.template, .liniert)

        h.library.mergePages([remote], notebookID: notebookID, pendingUpdatePageIDs: [], pendingDeletePageIDs: [])
        XCTAssertNil(h.library.page(firstPageID)?.dirtyFields)
        XCTAssertEqual(h.library.page(firstPageID)?.template, .blanko)
        XCTAssertEqual(h.library.page(firstPageID)?.version, 5)
    }

    // MARK: Konflikt

    func testAConflictKeepsTheLocalTemplateButTakesTheIndexTheMacChanged() async throws {
        let h = SyncHarness(health: [
            .http(status: 200, body: detail(id: firstPageID, index: 3, template: "blanko", version: 4))
        ])
        XCTAssertTrue(h.service.setTemplate(pageID: firstPageID, .kariert))
        let pending = try XCTUnwrap(pendingEntries(h).first { $0.kind == "page.update" })
        rejecting(pending.opID, on: h)
        await startOnline(h)

        let done = await eventually { h.engine.pendingCount == 0 && h.factory.sockets[0].ops.count >= 2 }
        XCTAssertTrue(done)
        XCTAssertEqual(h.engine.deadLetterCount, 0)
        // Die Ersatzoperation: eigene Änderung (Vorlage) auf dem Stand des Core (Index 3, Version 4)
        let replacement = try XCTUnwrap(h.factory.sockets[0].ops.last)
        let sent = try fields(of: replacement)
        XCTAssertEqual(sent["template"] as? String, "kariert")
        XCTAssertEqual(sent["index"] as? Int, 3)
        let data = try XCTUnwrap(replacement.object["data"] as? [String: Any])
        XCTAssertEqual(data["version"] as? Int, 4)

        let page = try XCTUnwrap(h.library.page(firstPageID))
        XCTAssertEqual(page.index, 3)
        XCTAssertEqual(page.template, .kariert)
        XCTAssertEqual(page.version, 5)
    }

    func testAConflictKeepsTheLocalIndexButTakesTheTemplateTheMacChanged() async throws {
        let h = SyncHarness(health: [
            .http(status: 200, body: detail(id: firstPageID, index: 1, template: "liniert", version: 4))
        ])
        h.library.upsert(secondPage())
        XCTAssertTrue(h.service.movePage(notebookID: notebookID, from: 0, to: 1))
        let first = try XCTUnwrap(pendingEntries(h).first { $0.kind == "page.update" && $0.pageID == firstPageID })
        rejecting(first.opID, on: h)
        await startOnline(h)

        let done = await eventually { h.engine.pendingCount == 0 && h.factory.sockets[0].ops.count >= 3 }
        XCTAssertTrue(done)
        XCTAssertEqual(h.engine.deadLetterCount, 0)
        let replacement = try XCTUnwrap(h.factory.sockets[0].ops.last)
        let sent = try fields(of: replacement)
        XCTAssertEqual(sent["index"] as? Int, 2)
        XCTAssertEqual(sent["template"] as? String, "liniert")

        let page = try XCTUnwrap(h.library.page(firstPageID))
        XCTAssertEqual(page.index, 2)
        XCTAssertEqual(page.template, .liniert)
    }

    func testWithoutAListAllLocalFieldsStillWin() async throws {
        let h = SyncHarness(health: [
            .http(status: 200, body: detail(id: firstPageID, index: 3, template: "blanko", version: 4))
        ])
        XCTAssertTrue(h.service.setTemplate(pageID: firstPageID, .kariert))
        // Altbestand: Die Seite stammt aus einer Version ohne Merkliste
        var legacy = try XCTUnwrap(h.library.page(firstPageID))
        legacy.dirtyFields = nil
        h.library.upsert(legacy)
        let pending = try XCTUnwrap(pendingEntries(h).first { $0.kind == "page.update" })
        rejecting(pending.opID, on: h)
        await startOnline(h)

        let done = await eventually { h.engine.pendingCount == 0 && h.factory.sockets[0].ops.count >= 2 }
        XCTAssertTrue(done)
        let sent = try fields(of: try XCTUnwrap(h.factory.sockets[0].ops.last))
        XCTAssertEqual(sent["index"] as? Int, 1)
        XCTAssertEqual(sent["template"] as? String, "kariert")
    }

    func testAConflictWithoutRemainingDifferenceSendsNothingAndClearsTheList() async throws {
        // Der Core hat dieselbe Vorlage schon: Nur die Version wird übernommen
        let h = SyncHarness(health: [
            .http(status: 200, body: detail(id: firstPageID, index: 1, template: "kariert", version: 7))
        ])
        XCTAssertTrue(h.service.setTemplate(pageID: firstPageID, .kariert))
        let pending = try XCTUnwrap(pendingEntries(h).first { $0.kind == "page.update" })
        rejecting(pending.opID, on: h)
        await startOnline(h)

        let resolved = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(resolved)
        await h.clock.settle()
        let page = try XCTUnwrap(h.library.page(firstPageID))
        XCTAssertEqual(page.version, 7)
        XCTAssertNil(page.dirtyFields)
        XCTAssertEqual(h.factory.sockets[0].ops.count, 1)
    }

    // MARK: Alte library.json (L3)

    private func tempURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("library-old-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("library.json")
    }

    /// Stand von PR 3: ohne `dirtyFields`, ohne `legacyTestPageHandled`
    private let oldLibrary = """
        {"schemaVersion":1,"dbEpoch":"epoch-1","lastNotebookID":"nb-1","refreshedAtMS":1700000000000,
        "modules":[{"id":"mod-1","name":"Analysis I","inkModeDirty":false}],
        "notebooks":[{"id":"nb-1","moduleID":"mod-1","title":"Vorlesung","kind":"vorlesung","createdAtMS":1,
        "knownOnServer":true,"hidden":false,"lastPageID":"pg-1","remoteMaxIndex":2,"remoteOnlyPageCount":1}],
        "pages":[{"id":"pg-1","notebookID":"nb-1","index":1,"template":"kariert","widthPt":595,"heightPt":842,
        "version":3,"createQueued":true,"needsReconcile":false,"deleteQueued":false}]}
        """

    func testAnOldLibraryFileStaysReadableAndGetsNoDefectCopy() throws {
        let url = tempURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(oldLibrary.utf8).write(to: url)

        let store = FileInkLibraryStore(url: url)
        XCTAssertEqual(store.modules.map(\.name), ["Analysis I"])
        XCTAssertNil(store.modules.first?.inkMode)
        XCTAssertEqual(store.notebook("nb-1")?.title, "Vorlesung")
        let page = try XCTUnwrap(store.page("pg-1"))
        XCTAssertEqual(page.template, .kariert)
        XCTAssertEqual(page.version, 3)
        XCTAssertNil(page.dirtyFields)
        XCTAssertNil(page.sessionID)
        XCTAssertFalse(store.legacyTestPageHandled)
        XCTAssertEqual(store.dbEpoch, "epoch-1")

        let defect = url.deletingLastPathComponent().appendingPathComponent("library.defekt.json")
        XCTAssertFalse(FileManager.default.fileExists(atPath: defect.path))
    }

    func testTheNewFieldSurvivesAWriteAndRead() throws {
        let url = tempURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(oldLibrary.utf8).write(to: url)
        let store = FileInkLibraryStore(url: url)
        var page = try XCTUnwrap(store.page("pg-1"))
        page.dirtyFields = ["index", "template"]
        store.upsert(page)

        let reread = FileInkLibraryStore(url: url)
        XCTAssertEqual(reread.page("pg-1")?.dirtyFields, ["index", "template"])
        XCTAssertEqual(reread.notebook("nb-1")?.remoteOnlyPageCount, 1)
    }
}
