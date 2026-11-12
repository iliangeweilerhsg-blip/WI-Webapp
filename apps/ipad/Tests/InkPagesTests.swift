import XCTest

@testable import StudienGehirn

/// Seiten anlegen, umsortieren, Vorlage setzen, löschen mit Frist und `page_version_conflict` (T1-13 Teil 1)
@MainActor
final class InkPagesTests: XCTestCase {
    private let notebookID = "019a4e14-0000-7000-8000-0000000000a2"
    private let firstPageID = "019a4e14-0000-7000-8000-0000000000b1"

    // MARK: Hilfen

    private func startOnline(_ h: SyncHarness) async {
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
    }

    private func pendingEntries(_ h: SyncHarness) -> [OutboxEntry] {
        SyncOutbox(directory: h.directory).pending
    }

    private func kinds(_ h: SyncHarness) -> [String] {
        pendingEntries(h).map(\.kind)
    }

    private func wire(_ entry: OutboxEntry) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(entry.json.utf8)) as? [String: Any])
    }

    private func dataOf(_ entry: OutboxEntry) throws -> [String: Any] {
        try XCTUnwrap(try wire(entry)["data"] as? [String: Any])
    }

    /// Eine Seite, die der Core schon kennt (kein `page.create` in der Warteschlange)
    private func localPage(
        _ id: String, index: Int, template: PageTemplate = .blanko, version: Int = 1, createQueued: Bool = true,
        notebook: String? = nil
    ) -> LibraryPage {
        LibraryPage(
            id: id, notebookID: notebook ?? notebookID, index: index, template: template, widthPt: 595,
            heightPt: 842, sessionID: nil, backgroundSlideID: nil, attachedSlideID: nil, version: version,
            createQueued: createQueued, needsReconcile: false, deletedAtMS: nil, deleteQueued: false)
    }

    /// Das Notizbuch des Harness mit fünf Seiten, Indizes 1 bis 5 (die erste ist die des Harness)
    private func fivePages(_ h: SyncHarness) -> [String] {
        var ids = [firstPageID]
        for number in 2...5 {
            let id = "019a4e14-0000-7000-8000-00000000010\(number)"
            h.library.upsert(localPage(id, index: number))
            ids.append(id)
        }
        return ids
    }

    private func pagesBody(_ items: [String]) -> String {
        "{\"items\":[\(items.joined(separator: ","))],\"notebook_id\":\"\(notebookID)\",\"stream_op_id\":null,\"stream_seq\":0}"
    }

    private func detailBody(id: String, index: Int, template: String, version: Int) -> String {
        """
        {"page":\(LibraryFixtures.pageJSON(id: id, notebookID: notebookID, index: index, template: template, version: version)),
        "elements":[],"stream_seq":0,"stream_op_id":null}
        """
    }

    // MARK: Anlegen und Index

    /// L11 aus #225: Die Leiste „Rückgängig“ endet vor der Löschfrist
    func testTheUndoBarEndsBeforeTheDeleteGrace() {
        XCTAssertLessThan(InkLibraryService.undoBarDuration, InkLibraryService.deleteGrace)
    }

    func testAddPageContinuesTheIndexAndQueuesAPageCreateWithAllFields() throws {
        let h = SyncHarness()
        let page = try XCTUnwrap(
            h.service.addPage(
                notebookID: notebookID, template: .kariert, size: CGSize(width: 960, height: 540),
                backgroundSlideID: nil, attachedSlideID: nil))
        XCTAssertEqual(page.index, 2)
        XCTAssertEqual(page.version, 1)
        XCTAssertTrue(page.createQueued)
        XCTAssertEqual(h.service.pages(inNotebook: notebookID).map(\.id), [firstPageID, page.id])

        let entry = try XCTUnwrap(pendingEntries(h).first)
        XCTAssertEqual(entry.kind, "page.create")
        XCTAssertEqual(entry.pageID, page.id)
        XCTAssertEqual(entry.stream, "notebook:\(notebookID)")
        let data = try dataOf(entry)
        XCTAssertEqual(data["index"] as? Int, 2)
        XCTAssertEqual(data["template"] as? String, "kariert")
        XCTAssertEqual(data["width_pt"] as? Double, 960)
        XCTAssertEqual(data["height_pt"] as? Double, 540)
        // Pflichtfelder mit `null` stehen im JSON
        XCTAssertTrue(data["session_id"] is NSNull)
        XCTAssertTrue(data["background_slide_id"] is NSNull)
        XCTAssertTrue(data["attached_slide_id"] is NSNull)
        // Dekodiert als `page.create`
        guard case .pageCreate = try SGSyncOp.decode(Data(entry.json.utf8)) else {
            return XCTFail("keine page.create")
        }
    }

    func testAddPageCountsPagesOnlyTheMacHasAndPagesInTheGracePeriod() throws {
        let h = SyncHarness()
        var notebook = try XCTUnwrap(h.library.notebook(notebookID))
        notebook.remoteMaxIndex = 7
        h.library.upsert(notebook)
        let first = try XCTUnwrap(
            h.service.addPage(
                notebookID: notebookID, template: .blanko, size: CGSize(width: 595, height: 842),
                backgroundSlideID: nil, attachedSlideID: nil))
        XCTAssertEqual(first.index, 8)

        // Eine gelöschte Seite in der Frist zählt mit: Rückgängig erzeugt keine doppelten Plätze
        h.service.deletePage(pageID: first.id)
        let second = try XCTUnwrap(
            h.service.addPage(
                notebookID: notebookID, template: .blanko, size: CGSize(width: 595, height: 842),
                backgroundSlideID: nil, attachedSlideID: nil))
        XCTAssertEqual(second.index, 9)
    }

    func testAddPageToAnUnknownNotebookOrWithoutSizeCreatesNothing() throws {
        let h = SyncHarness()
        XCTAssertNil(
            h.service.addPage(
                notebookID: "gibt-es-nicht", template: .blanko, size: CGSize(width: 595, height: 842),
                backgroundSlideID: nil, attachedSlideID: nil))
        XCTAssertNil(
            h.service.addPage(
                notebookID: notebookID, template: .blanko, size: .zero, backgroundSlideID: nil,
                attachedSlideID: nil))
        XCTAssertEqual(h.engine.pendingCount, 0)
    }

    func testOpenPageSelectsAndRemembersThePage() throws {
        let h = SyncHarness()
        let ids = fivePages(h)
        let binding = try XCTUnwrap(h.service.openPage(pageID: ids[3]))
        XCTAssertEqual(binding.pageID, ids[3])
        XCTAssertEqual(h.library.notebook(notebookID)?.lastPageID, ids[3])
        XCTAssertEqual(h.service.openTarget(notebookID: notebookID)?.pageID, ids[3])
        XCTAssertNil(h.service.openPage(pageID: "gibt-es-nicht"))
    }

    // MARK: Umsortieren

    func testMovingTheLastPageToTheFrontQueuesFiveUpdatesWithRisingVersions() throws {
        let h = SyncHarness()
        let ids = fivePages(h)
        XCTAssertTrue(h.service.movePage(notebookID: notebookID, from: 4, to: 0))

        XCTAssertEqual(h.service.pages(inNotebook: notebookID).map(\.id), [ids[4], ids[0], ids[1], ids[2], ids[3]])
        XCTAssertEqual(h.service.pages(inNotebook: notebookID).map(\.index), [1, 2, 3, 4, 5])
        let updates = pendingEntries(h)
        XCTAssertEqual(updates.map(\.kind), Array(repeating: "page.update", count: 5))
        for entry in updates {
            let data = try dataOf(entry)
            // Jede Operation beruht auf der Version vor der Änderung
            XCTAssertEqual(data["version"] as? Int, 1)
            let fields = try XCTUnwrap(data["fields"] as? [String: Any])
            XCTAssertNotNil(fields["index"] as? Int)
            XCTAssertEqual(fields["template"] as? String, "blanko")
            XCTAssertTrue(fields["session_id"] is NSNull)
            XCTAssertTrue(fields["background_slide_id"] is NSNull)
            XCTAssertTrue(fields["attached_slide_id"] is NSNull)
        }
        for id in ids {
            XCTAssertEqual(h.library.page(id)?.version, 2)
        }
    }

    func testSwappingTwoNeighboursQueuesTwoUpdatesAndTheSamePlaceNone() throws {
        let h = SyncHarness()
        let ids = fivePages(h)
        XCTAssertTrue(h.service.movePage(notebookID: notebookID, from: 1, to: 2))
        XCTAssertEqual(kinds(h), ["page.update", "page.update"])
        XCTAssertEqual(Set(pendingEntries(h).compactMap(\.pageID)), [ids[1], ids[2]])
        XCTAssertEqual(h.service.pages(inNotebook: notebookID).map(\.id), [ids[0], ids[2], ids[1], ids[3], ids[4]])

        // Gleicher Platz: nichts passiert
        XCTAssertTrue(h.service.movePage(notebookID: notebookID, from: 3, to: 3))
        XCTAssertEqual(kinds(h).count, 2)
        // Ungültige Plätze
        XCTAssertFalse(h.service.movePage(notebookID: notebookID, from: 0, to: 9))
        XCTAssertFalse(h.service.movePage(notebookID: notebookID, from: -1, to: 0))
        XCTAssertEqual(kinds(h).count, 2)
    }

    func testMovingTwiceBuildsOnTheVersionOfTheFirstMove() throws {
        let h = SyncHarness()
        let ids = fivePages(h)
        XCTAssertTrue(h.service.movePage(notebookID: notebookID, from: 1, to: 2))
        XCTAssertTrue(h.service.movePage(notebookID: notebookID, from: 2, to: 1))
        let versions = try pendingEntries(h).map { try XCTUnwrap(dataOf($0)["version"] as? Int) }
        XCTAssertEqual(versions, [1, 1, 2, 2])
        XCTAssertEqual(h.library.page(ids[1])?.version, 3)
        XCTAssertEqual(h.service.pages(inNotebook: notebookID).map(\.id), ids)
    }

    func testMoveRenumbersGapsDensely() throws {
        let h = SyncHarness()
        h.library.upsert(localPage("p-b", index: 4))
        h.library.upsert(localPage("p-c", index: 9))
        // Indizes 1, 4, 9: nach dem Tausch von 4 und 9 gilt 1, 2, 3
        XCTAssertTrue(h.service.movePage(notebookID: notebookID, from: 1, to: 2))
        XCTAssertEqual(h.service.pages(inNotebook: notebookID).map(\.index), [1, 2, 3])
        XCTAssertEqual(h.service.pages(inNotebook: notebookID).map(\.id), [firstPageID, "p-c", "p-b"])
    }

    func testAPageWhoseCreateIsNotQueuedYetGetsNoUpdateButKeepsTheNewIndex() throws {
        let h = SyncHarness()
        h.library.upsert(localPage("p-neu", index: 2, createQueued: false))
        XCTAssertTrue(h.service.movePage(notebookID: notebookID, from: 1, to: 0))
        // Nur die Seite des Core bekommt ein `page.update`, die neue trägt ihren Index im `page.create`
        XCTAssertEqual(pendingEntries(h).compactMap(\.pageID), [firstPageID])
        XCTAssertEqual(h.library.page("p-neu")?.index, 1)
        XCTAssertEqual(h.library.page("p-neu")?.version, 1)
    }

    // MARK: Vorlage

    func testSetTemplateQueuesOneUpdateWithAllFields() throws {
        let h = SyncHarness()
        XCTAssertTrue(h.service.setTemplate(pageID: firstPageID, .punktraster))
        let entry = try XCTUnwrap(pendingEntries(h).first)
        XCTAssertEqual(pendingEntries(h).count, 1)
        XCTAssertEqual(entry.kind, "page.update")
        let data = try dataOf(entry)
        XCTAssertEqual(data["page_id"] as? String, firstPageID)
        XCTAssertEqual(data["version"] as? Int, 1)
        let fields = try XCTUnwrap(data["fields"] as? [String: Any])
        XCTAssertEqual(fields["template"] as? String, "punktraster")
        XCTAssertEqual(fields["index"] as? Int, 1)
        XCTAssertEqual(h.library.page(firstPageID)?.template, .punktraster)
        XCTAssertEqual(h.library.page(firstPageID)?.version, 2)
        guard case .pageUpdate = try SGSyncOp.decode(Data(entry.json.utf8)) else {
            return XCTFail("kein page.update")
        }
        // Dieselbe Vorlage noch einmal: nichts Neues
        XCTAssertTrue(h.service.setTemplate(pageID: firstPageID, .punktraster))
        XCTAssertEqual(pendingEntries(h).count, 1)
    }

    func testTheTemplateDoesNotChangeFromOrToFolie() throws {
        let h = SyncHarness()
        XCTAssertFalse(h.service.setTemplate(pageID: firstPageID, .folie))
        h.library.upsert(localPage("p-folie", index: 2, template: .folie))
        XCTAssertFalse(h.service.setTemplate(pageID: "p-folie", .liniert))
        XCTAssertEqual(h.library.page("p-folie")?.template, .folie)
        XCTAssertFalse(h.service.setTemplate(pageID: "gibt-es-nicht", .liniert))
        XCTAssertEqual(pendingEntries(h).count, 0)
    }

    // MARK: Löschen mit Frist

    func testUndoWithinTheGracePeriodQueuesNothing() async throws {
        let h = SyncHarness()
        let ids = fivePages(h)
        h.service.deletePage(pageID: ids[2])
        // Sofort unsichtbar, aber nicht verloren
        XCTAssertEqual(h.service.pages(inNotebook: notebookID).count, 4)
        XCTAssertNotNil(h.library.page(ids[2]))
        XCTAssertNotNil(h.library.page(ids[2])?.deletedAtMS)
        await h.clock.advance(4)
        XCTAssertEqual(kinds(h), [])

        XCTAssertTrue(h.service.undoDelete(pageID: ids[2]))
        XCTAssertEqual(h.service.pages(inNotebook: notebookID).map(\.id), ids)
        XCTAssertNil(h.library.page(ids[2])?.deletedAtMS)
        // Auch nach Ablauf der ursprünglichen Frist wird nichts gelöscht
        await h.clock.advance(10)
        XCTAssertEqual(kinds(h), [])
        XCTAssertFalse(h.service.undoDelete(pageID: ids[2]))
    }

    func testAfterTheGracePeriodExactlyOnePageDeleteIsQueued() async throws {
        let h = SyncHarness()
        let ids = fivePages(h)
        h.service.deletePage(pageID: ids[1])
        await h.clock.advance(4.9)
        XCTAssertEqual(kinds(h), [])
        await h.clock.advance(0.2)
        XCTAssertEqual(kinds(h), ["page.delete"])
        let entry = try XCTUnwrap(pendingEntries(h).first)
        XCTAssertEqual(entry.pageID, ids[1])
        XCTAssertEqual(try dataOf(entry)["page_id"] as? String, ids[1])
        guard case .pageDelete = try SGSyncOp.decode(Data(entry.json.utf8)) else {
            return XCTFail("kein page.delete")
        }
        XCTAssertTrue(try XCTUnwrap(h.library.page(ids[1])).deleteQueued)
        // Zu spät für „Rückgängig“: Das eingereihte `page.delete` lässt sich nicht zurücknehmen
        XCTAssertFalse(h.service.undoDelete(pageID: ids[1]))
        XCTAssertEqual(h.service.pages(inNotebook: notebookID).count, 4)
        // Die Zeichnung bleibt: Die Bibliothek behält die Seite
        XCTAssertNotNil(h.library.page(ids[1]))
    }

    func testFlushQueuesTheDeleteAtOnceWhenLeaving() async throws {
        let h = SyncHarness()
        let ids = fivePages(h)
        h.service.deletePage(pageID: ids[1])
        h.service.deletePage(pageID: ids[3])
        h.service.flushPendingDeletes()
        XCTAssertEqual(kinds(h), ["page.delete", "page.delete"])
        // Die Fristen laufen danach nicht noch einmal ab
        await h.clock.advance(10)
        XCTAssertEqual(kinds(h).count, 2)
    }

    func testACrashDuringTheGracePeriodQueuesTheDeleteOnTheNextStart() async throws {
        let h = SyncHarness()
        let ids = fivePages(h)
        h.service.deletePage(pageID: ids[1])
        XCTAssertEqual(kinds(h), [])
        // Neustart: neuer Dienst auf derselben Ablage. Die Seite steht als gelöscht da, ihr `page.delete` fehlt.
        _ = InkLibraryService(store: h.library, sync: h.engine, client: h.client, now: { h.clock.date })
        XCTAssertEqual(kinds(h), ["page.delete"])
        XCTAssertEqual(pendingEntries(h).first?.pageID, ids[1])
        // Die Frist des alten Dienstes läuft später ab, reiht aber nichts doppelt ein
        await h.clock.advance(10)
        XCTAssertEqual(kinds(h), ["page.delete"])
    }

    func testDeletingAPageWhoseCreateWasNeverQueuedSendsNothing() async throws {
        let h = SyncHarness()
        h.library.upsert(localPage("p-neu", index: 2, createQueued: false))
        h.service.deletePage(pageID: "p-neu")
        await h.clock.advance(6)
        XCTAssertEqual(kinds(h), [])
        XCTAssertTrue(try XCTUnwrap(h.library.page("p-neu")).deleteQueued)
    }

    func testTheLastPageCanBeDeletedAndOpenTargetCreatesANewOne() async throws {
        let h = SyncHarness()
        h.service.deletePage(pageID: firstPageID)
        XCTAssertEqual(h.service.pages(inNotebook: notebookID), [])
        let target = try XCTUnwrap(h.service.openTarget(notebookID: notebookID))
        XCTAssertNotEqual(target.pageID, firstPageID)
        // Die neue Seite steht hinter der gelöschten (Rückgängig bleibt möglich)
        XCTAssertEqual(h.library.page(target.pageID)?.index, 2)
        XCTAssertTrue(h.service.undoDelete(pageID: firstPageID))
        XCTAssertEqual(h.service.pages(inNotebook: notebookID).count, 2)
    }

    func testOpenTargetSkipsALastPageThatWasDeleted() throws {
        let h = SyncHarness()
        let ids = fivePages(h)
        XCTAssertNotNil(h.service.openPage(pageID: ids[4]))
        h.service.deletePage(pageID: ids[4])
        let target = try XCTUnwrap(h.service.openTarget(notebookID: notebookID))
        XCTAssertEqual(target.pageID, ids[3])
    }

    func testAPageInTheGracePeriodIsNotBroughtBackByTheMergeOfTheMacList() async throws {
        let h = SyncHarness(health: [
            .http(
                status: 200,
                body: pagesBody([
                    LibraryFixtures.pageJSON(id: firstPageID, notebookID: notebookID, index: 1),
                    LibraryFixtures.pageJSON(id: "p-frist", notebookID: notebookID, index: 4),
                ]))
        ])
        h.library.upsert(localPage("p-frist", index: 2))
        await startOnline(h)
        h.service.deletePage(pageID: "p-frist")

        await h.service.refreshPages(notebookID: notebookID)
        // Weder wiederhergestellt noch überschrieben: „Rückgängig“ bringt den lokalen Stand zurück
        XCTAssertEqual(h.service.pages(inNotebook: notebookID).map(\.id), [firstPageID])
        let kept = try XCTUnwrap(h.library.page("p-frist"))
        XCTAssertNotNil(kept.deletedAtMS)
        XCTAssertEqual(kept.index, 2)
        XCTAssertTrue(h.service.undoDelete(pageID: "p-frist"))
        XCTAssertEqual(h.library.page("p-frist")?.index, 2)
    }

    func testTheStoreAloneKeepsGracePagesDeletedWhenMerging() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("grace-store-\(UUID().uuidString)", isDirectory: true)
        let store = FileInkLibraryStore(url: directory.appendingPathComponent("library.json"))
        store.upsert(
            LibraryNotebook(
                id: notebookID, moduleID: LibraryFixtures.moduleID, title: "Frei", kind: .frei, createdAtMS: 1,
                knownOnServer: true, hidden: false, lastPageID: nil, remoteMaxIndex: 0, remoteOnlyPageCount: 0))
        var inGrace = localPage("p-frist", index: 1)
        inGrace.deletedAtMS = 1000
        inGrace.deleteQueued = false
        store.upsert(inGrace)
        XCTAssertEqual(store.pagesInDeleteGrace().map(\.id), ["p-frist"])

        let remote = try LibraryFixtures.page(
            LibraryFixtures.pageJSON(id: "p-frist", notebookID: notebookID, index: 3, version: 5))
        store.mergePages([remote], notebookID: notebookID, pendingUpdatePageIDs: [], pendingDeletePageIDs: [])
        let after = try XCTUnwrap(store.page("p-frist"))
        XCTAssertEqual(after.deletedAtMS, 1000)
        XCTAssertEqual(after.index, 1)
        XCTAssertEqual(after.version, 1)

        // Ist `page.delete` eingereiht und bestätigt, die Seite aber am Mac wiederhergestellt, kommt sie zurück
        var queued = after
        queued.deleteQueued = true
        store.upsert(queued)
        XCTAssertEqual(store.pagesInDeleteGrace().count, 0)
        store.mergePages([remote], notebookID: notebookID, pendingUpdatePageIDs: [], pendingDeletePageIDs: [])
        XCTAssertNil(store.page("p-frist")?.deletedAtMS)
    }

    // MARK: page_version_conflict

    private func conflictHarness(detail: FakeTransport.Reply) -> SyncHarness {
        SyncHarness(health: [detail])
    }

    /// Zwei Offline-Änderungen derselben Seite (Version 1 und 2), beide mit zu alter Version beim Core
    private func queueTwoUpdates(_ h: SyncHarness) {
        XCTAssertTrue(h.service.setTemplate(pageID: firstPageID, .liniert))
        XCTAssertTrue(h.service.setTemplate(pageID: firstPageID, .kariert))
        XCTAssertEqual(h.library.page(firstPageID)?.version, 3)
    }

    func testAConflictReplacesThePendingUpdatesByOneWithTheCoreVersion() async throws {
        let h = conflictHarness(
            detail: .http(status: 200, body: detailBody(id: firstPageID, index: 1, template: "blanko", version: 4)))
        queueTwoUpdates(h)
        h.factory.configure = { socket, _ in
            socket.opPolicy = { _, kind, index in
                // Die beiden alten Operationen kommen mit `page_version_conflict` zurück, die neue wird bestätigt
                kind == "page.update" && index < 2
                    ? .error(code: "page_version_conflict", retryable: false, fatal: false) : .ack
            }
        }
        await startOnline(h)

        let done = await eventually { h.engine.pendingCount == 0 && h.factory.sockets[0].ops.count >= 3 }
        XCTAssertTrue(done)
        // Nichts in der Fehlerablage, genau ein Abruf der Seite
        XCTAssertEqual(h.engine.deadLetterCount, 0)
        let gets = h.transport.requests.filter { $0.url?.path == "/api/v1/pages/\(firstPageID)" }
        XCTAssertEqual(gets.count, 1)
        // Die neue Operation trägt die Version des Core und die lokalen Felder
        let last = try XCTUnwrap(h.factory.sockets[0].ops.last?.object)
        XCTAssertEqual(last["kind"] as? String, "page.update")
        let data = try XCTUnwrap(last["data"] as? [String: Any])
        XCTAssertEqual(data["version"] as? Int, 4)
        let fields = try XCTUnwrap(data["fields"] as? [String: Any])
        XCTAssertEqual(fields["template"] as? String, "kariert")
        XCTAssertEqual(h.library.page(firstPageID)?.version, 5)
        let versionFour = h.factory.sockets[0].ops.filter {
            ($0.object["data"] as? [String: Any])?["version"] as? Int == 4
        }
        XCTAssertEqual(versionFour.count, 1)
    }

    func testAfterAConflictOnlyTheReplacementWaitsOnDiskAndTheOldUpdatesStayDroppedAfterARestart() async throws {
        let h = conflictHarness(
            detail: .http(status: 200, body: detailBody(id: firstPageID, index: 1, template: "blanko", version: 4)))
        queueTwoUpdates(h)
        let stale = Set(pendingEntries(h).filter { $0.kind == "page.update" }.map(\.opID))
        XCTAssertEqual(stale.count, 2)
        h.factory.configure = { socket, _ in
            socket.opPolicy = { _, kind, index in
                // Die alten werden abgelehnt, der Ersatz bleibt unbeantwortet (wartet weiter)
                kind == "page.update" && index < 2
                    ? .error(code: "page_version_conflict", retryable: false, fatal: false)
                    : (kind == "page.update" ? .silent : .ack)
            }
        }
        await startOnline(h)

        let sent = await eventually { h.factory.sockets[0].ops.count >= 3 }
        XCTAssertTrue(sent)
        // Neu von der Platte gelesen: genau der Ersatz wartet, mit der Version des Core und den lokalen Feldern
        let updates = pendingEntries(h).filter { $0.kind == "page.update" }
        XCTAssertEqual(updates.count, 1)
        let replacement = try XCTUnwrap(updates.first)
        XCTAssertFalse(stale.contains(replacement.opID))
        let data = try dataOf(replacement)
        XCTAssertEqual(data["version"] as? Int, 4)
        XCTAssertEqual((data["fields"] as? [String: Any])?["template"] as? String, "kariert")
        XCTAssertEqual(h.engine.deadLetterCount, 0)
    }

    func testAConflictWithoutLocalDifferenceOnlyTakesTheCoreVersion() async throws {
        let h = conflictHarness(
            detail: .http(status: 200, body: detailBody(id: firstPageID, index: 1, template: "kariert", version: 7)))
        queueTwoUpdates(h)
        h.factory.configure = { socket, _ in
            socket.opPolicy = { _, kind, _ in
                kind == "page.update"
                    ? .error(code: "page_version_conflict", retryable: false, fatal: false) : .ack
            }
        }
        await startOnline(h)

        let resolved = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(resolved)
        XCTAssertEqual(h.engine.deadLetterCount, 0)
        XCTAssertEqual(h.library.page(firstPageID)?.version, 7)
        await h.clock.settle()
        // Es ist keine neue Operation entstanden, und keine alte wurde wiederholt
        XCTAssertLessThanOrEqual(h.factory.sockets[0].ops.count, 2)
        XCTAssertEqual(h.engine.pendingCount, 0)
    }

    func testAConflictOnAPageTheCoreDoesNotKnowDropsThePendingUpdates() async throws {
        let h = conflictHarness(detail: .http(status: 404, body: Fixtures.apiError("page_not_found")))
        queueTwoUpdates(h)
        h.factory.configure = { socket, _ in
            socket.opPolicy = { _, kind, _ in
                kind == "page.update"
                    ? .error(code: "page_version_conflict", retryable: false, fatal: false) : .ack
            }
        }
        await startOnline(h)

        let resolved = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(resolved)
        XCTAssertEqual(h.engine.deadLetterCount, 0)
        await h.clock.settle()
        XCTAssertEqual(h.engine.pendingCount, 0)
    }

    func testAFailedFetchKeepsTheOperationsParkedUntilTheNextTry() async throws {
        let h = SyncHarness(health: [
            .failure(.notConnectedToInternet),
            .http(status: 200, body: detailBody(id: firstPageID, index: 1, template: "blanko", version: 4)),
        ])
        queueTwoUpdates(h)
        h.factory.configure = { socket, _ in
            socket.opPolicy = { _, kind, index in
                kind == "page.update" && index < 2
                    ? .error(code: "page_version_conflict", retryable: false, fatal: false) : .ack
            }
        }
        await startOnline(h)

        let tried = await eventually { h.transport.requests.count >= 1 }
        XCTAssertTrue(tried)
        await h.clock.settle()
        // Keine Fehlerablage und keine Endlosschleife: Die abgelehnten Operationen werden nicht erneut gesendet
        XCTAssertEqual(h.engine.deadLetterCount, 0)
        XCTAssertEqual(h.engine.pendingCount, 2)
        XCTAssertEqual(h.factory.sockets[0].ops.count, 2)
        XCTAssertEqual(h.transport.requests.count, 1)

        // Der nächste Versuch (nach dem nächsten `welcome`) löst es auf
        await h.service.resolveVersionConflict(pageID: firstPageID)
        let resolved = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(resolved)
        XCTAssertEqual(h.engine.deadLetterCount, 0)
        XCTAssertEqual(h.library.page(firstPageID)?.version, 5)
    }

    func testAnotherRejectionOfTheSamePageDuringTheFetchStartsNoSecondFetch() async throws {
        let h = conflictHarness(
            detail: .http(status: 200, body: detailBody(id: firstPageID, index: 1, template: "blanko", version: 4)))
        queueTwoUpdates(h)
        h.factory.configure = { socket, _ in
            socket.opPolicy = { _, kind, index in
                kind == "page.update" && index < 2
                    ? .error(code: "page_version_conflict", retryable: false, fatal: false) : .ack
            }
        }
        await startOnline(h)
        let done = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(done)
        // Beide alten Operationen wurden abgelehnt, es gab nur einen Abruf
        XCTAssertEqual(h.transport.requests.filter { $0.url?.path.contains("/pages/") == true }.count, 1)
    }

    func testAConflictOnAnythingButPageUpdateStillGoesToTheDeadLetter() async throws {
        let h = SyncHarness()
        XCTAssertTrue(h.enqueueStrokes(1))
        h.factory.configure = { socket, _ in
            socket.opPolicy = { _, _, _ in .error(code: "page_version_conflict", retryable: false, fatal: false) }
        }
        await startOnline(h)
        let dead = await eventually { h.engine.deadLetterCount == 1 }
        XCTAssertTrue(dead)
    }

    // MARK: Wartende Operationen entfernen (SyncOutbox.discard)

    func testDiscardRemovesPendingOperationsForGoodWithoutADeadLetter() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("discard-test-\(UUID().uuidString)", isDirectory: true)
        let outbox = SyncOutbox(directory: directory)
        func draft(_ number: Int) -> OutboxDraft {
            OutboxDraft(
                opID: "op-\(number)", stream: "notebook:n1", kind: "page.update", pageID: "p1", json: "{}",
                clockUncertain: false, sessionStartMS: nil)
        }
        try outbox.append([draft(1), draft(2), draft(3)])
        XCTAssertEqual(try outbox.discard(opIDs: ["op-1", "op-3", "unbekannt"]), 2)
        XCTAssertEqual(outbox.pending.map(\.opID), ["op-2"])
        XCTAssertEqual(outbox.deadLetterCount, 0)
        XCTAssertEqual(try outbox.discard(opIDs: ["op-1"]), 0)
        // Nach einem Neustart bleiben sie weg
        let reopened = SyncOutbox(directory: directory)
        XCTAssertEqual(reopened.pending.map(\.opID), ["op-2"])
        XCTAssertEqual(reopened.deadLetterCount, 0)
    }

    // MARK: Operationen bauen

    func testPageUpdateAndPageDeleteGetTheClockCorrectionWithoutBeingRejected() throws {
        let page = localPage("p1", index: 3, template: .liniert, version: 4)
        let update = try XCTUnwrap(
            InkOpBuilder.pageUpdate(page: page, nowMS: 1000, offsetMS: nil, makeID: { "op-u" }))
        let delete = try XCTUnwrap(
            InkOpBuilder.pageDelete(page: page, nowMS: 1000, offsetMS: nil, makeID: { "op-d" }))
        XCTAssertTrue(update.clockUncertain)
        XCTAssertTrue(delete.clockUncertain)
        XCTAssertEqual(update.kind, "page.update")
        XCTAssertEqual(delete.kind, "page.delete")
        XCTAssertEqual(update.pageID, "p1")
        XCTAssertEqual(delete.stream, "notebook:\(notebookID)")

        for draft in [update, delete] {
            let entry = OutboxEntry(
                number: 1, opID: draft.opID, stream: draft.stream, kind: draft.kind, pageID: draft.pageID,
                json: draft.json, clockUncertain: true, sessionStartMS: nil)
            let corrected = try XCTUnwrap(InkOpBuilder.correct(entry, offsetMS: 250))
            XCTAssertFalse(corrected.clockUncertain)
            let object = try wire(corrected)
            XCTAssertEqual(object["at"] as? Int, 1250)
            XCTAssertEqual(object["clock_uncertain"] as? Bool, false)
        }

        let known = try XCTUnwrap(
            InkOpBuilder.pageUpdate(page: page, nowMS: 1000, offsetMS: 250, makeID: { "op-k" }))
        XCTAssertFalse(known.clockUncertain)
        let knownObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(known.json.utf8)) as? [String: Any])
        let knownData = try XCTUnwrap(knownObject["data"] as? [String: Any])
        let fields = try XCTUnwrap(knownData["fields"] as? [String: Any])
        XCTAssertEqual(fields["index"] as? Int, 3)
        XCTAssertEqual(fields["template"] as? String, "liniert")
    }

    // MARK: Blättern

    func testPagingStepsAndTheEmptyLastPageRule() {
        let pages = [localPage("a", index: 1), localPage("b", index: 2), localPage("c", index: 3)]
        XCTAssertEqual(
            InkPaging.step(pages: pages, currentID: "b", direction: 1, currentHasStrokes: false), .go(pageID: "c"))
        XCTAssertEqual(
            InkPaging.step(pages: pages, currentID: "b", direction: -1, currentHasStrokes: false), .go(pageID: "a"))
        XCTAssertEqual(
            InkPaging.step(pages: pages, currentID: "a", direction: -1, currentHasStrokes: true), .stay)
        // Auf der letzten Seite: neue Seite nur, wenn die aktuelle mindestens einen Strich hat
        XCTAssertEqual(
            InkPaging.step(pages: pages, currentID: "c", direction: 1, currentHasStrokes: true), .newPage)
        XCTAssertEqual(
            InkPaging.step(pages: pages, currentID: "c", direction: 1, currentHasStrokes: false), .stay)
        XCTAssertEqual(
            InkPaging.step(pages: pages, currentID: "unbekannt", direction: 1, currentHasStrokes: true), .stay)
    }

    func testNewPagesInheritTemplateAndSizeExceptFromAFolie() {
        let ruled = localPage("a", index: 1, template: .liniert)
        XCTAssertEqual(InkPaging.template(after: ruled), .liniert)
        XCTAssertEqual(InkPaging.size(after: ruled), CGSize(width: 595, height: 842))
        var slide = localPage("b", index: 2, template: .folie)
        slide.widthPt = 960
        slide.heightPt = 540
        XCTAssertEqual(InkPaging.template(after: slide), .blanko)
        XCTAssertEqual(InkPaging.size(after: slide), CGSize(width: 595, height: 842))
        var landscape = localPage("c", index: 3, template: .kariert)
        landscape.widthPt = 960
        landscape.heightPt = 540
        XCTAssertEqual(InkPaging.size(after: landscape), CGSize(width: 960, height: 540))
    }

    func testThePageAfterDeletingIsTheOneThatMovesUpElseThePreviousOne() {
        let remaining = [localPage("a", index: 1), localPage("b", index: 3)]
        XCTAssertEqual(InkPaging.pageAfterDeleting(index: 1, remaining: remaining), "b")
        XCTAssertEqual(InkPaging.pageAfterDeleting(index: 2, remaining: remaining), "b")
        XCTAssertEqual(InkPaging.pageAfterDeleting(index: 0, remaining: remaining), "a")
        XCTAssertNil(InkPaging.pageAfterDeleting(index: 0, remaining: []))
        XCTAssertEqual(InkPaging.positionText(index: 2, count: 12), "Seite 3 / 12")
        XCTAssertEqual(InkPaging.positionText(index: nil, count: 12), "Seite")
    }

    func testTheSidebarFooterNamesThePagesOnlyTheMacHas() {
        XCTAssertEqual(InkPageSidebar.remoteOnlyText(count: 1), "1 weitere Seite liegt nur am Mac.")
        XCTAssertEqual(InkPageSidebar.remoteOnlyText(count: 4), "4 weitere Seiten liegen nur am Mac.")
    }

    // MARK: Alte library.json

    func testALibraryFileFromBeforeThisChangeStaysReadable() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("old-library-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("library.json")
        // So schrieb PR 2 die Datei: ohne `legacyTestPageHandled`, ohne `deletedAtMS`
        let json = """
            {"schemaVersion":1,
            "modules":[{"id":"m1","name":"Analysis I","inkModeDirty":false}],
            "notebooks":[{"id":"n1","moduleID":"m1","title":"Vorlesung","kind":"vorlesung","createdAtMS":5,
            "knownOnServer":true,"hidden":false,"lastPageID":"p1","remoteMaxIndex":2,"remoteOnlyPageCount":1}],
            "pages":[{"id":"p1","notebookID":"n1","index":1,"template":"blanko","widthPt":595,"heightPt":842,
            "version":3,"createQueued":true,"needsReconcile":false,"deleteQueued":false}],
            "lastNotebookID":"n1","dbEpoch":"epoch-1","refreshedAtMS":1000}
            """
        try Data(json.utf8).write(to: url)

        let store = FileInkLibraryStore(url: url)
        XCTAssertEqual(store.modules.map(\.name), ["Analysis I"])
        XCTAssertEqual(store.pages(inNotebook: "n1").map(\.id), ["p1"])
        XCTAssertEqual(store.page("p1")?.version, 3)
        XCTAssertNil(store.page("p1")?.deletedAtMS)
        XCTAssertEqual(store.lastNotebookID, "n1")
        XCTAssertFalse(store.legacyTestPageHandled)
        // Nicht zur Seite gelegt
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: directory.appendingPathComponent("library.defekt.json").path))
        XCTAssertTrue(store.pagesInDeleteGrace().isEmpty)
    }

    func testAPageInTheGracePeriodSurvivesARestartOfTheStore() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("grace-restart-\(UUID().uuidString)", isDirectory: true)
        let url = directory.appendingPathComponent("library.json")
        let store = FileInkLibraryStore(url: url)
        var page = localPage("p1", index: 1)
        page.deletedAtMS = 4242
        store.upsert(page)
        let reopened = FileInkLibraryStore(url: url)
        XCTAssertEqual(reopened.pagesInDeleteGrace().map(\.id), ["p1"])
        XCTAssertEqual(reopened.page("p1")?.deletedAtMS, 4242)
        XCTAssertEqual(reopened.pages(inNotebook: notebookID), [])
    }
}
