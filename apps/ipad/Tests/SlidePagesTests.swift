import XCTest

@testable import StudienGehirn

/// Folienseiten, freie Seiten mit `attached_slide_id`, die Session aus dem Strom und die neuen REST-Abrufe
@MainActor
final class SlidePagesTests: XCTestCase {
    private let notebookID = "019a4e14-0000-7000-8000-0000000000a2"
    private let firstPageID = "019a4e14-0000-7000-8000-0000000000b1"
    private let moduleID = LibraryFixtures.moduleID

    private let slide1 = SlideRef(id: "019a4e14-0000-7000-8000-000000000041", index: 1, widthPt: 960, heightPt: 540)
    private let slide2 = SlideRef(id: "019a4e14-0000-7000-8000-000000000042", index: 2, widthPt: 1024, heightPt: 768)

    private func pendingEntries(_ h: SyncHarness) -> [OutboxEntry] {
        SyncOutbox(directory: h.directory).pending
    }

    private func data(_ entry: OutboxEntry) throws -> [String: Any] {
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(entry.json.utf8)) as? [String: Any])
        return try XCTUnwrap(object["data"] as? [String: Any])
    }

    private func startOnline(_ h: SyncHarness) async {
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
    }

    // MARK: Folienseite

    func testTheFirstVisitOfASlideCreatesAFoliePageWithTheSlideSize() throws {
        let h = SyncHarness()
        let page = try XCTUnwrap(h.service.slidePage(notebookID: notebookID, slide: slide1))
        XCTAssertEqual(page.template, .folie)
        XCTAssertEqual(page.backgroundSlideID, slide1.id)
        XCTAssertNil(page.attachedSlideID)
        XCTAssertEqual(page.widthPt, 960)
        XCTAssertEqual(page.heightPt, 540)
        // Hinten angehängt
        XCTAssertEqual(page.index, 2)
        XCTAssertTrue(page.createQueued)

        let entry = try XCTUnwrap(pendingEntries(h).first { $0.kind == "page.create" })
        let fields = try data(entry)
        XCTAssertEqual(fields["template"] as? String, "folie")
        XCTAssertEqual(fields["background_slide_id"] as? String, slide1.id)
        // Pflichtfelder mit `null` stehen im JSON
        XCTAssertTrue(fields["attached_slide_id"] is NSNull)
        XCTAssertEqual(fields["width_pt"] as? Double, 960)
        XCTAssertEqual(fields["height_pt"] as? Double, 540)
        guard case .pageCreate = try SGSyncOp.decode(Data(entry.json.utf8)) else {
            return XCTFail("keine page.create")
        }
    }

    func testGoingBackToTheSameSlideOpensTheSamePageWithoutANewOne() throws {
        let h = SyncHarness()
        let first = try XCTUnwrap(h.service.slidePage(notebookID: notebookID, slide: slide1))
        let other = try XCTUnwrap(h.service.slidePage(notebookID: notebookID, slide: slide2))
        XCTAssertNotEqual(first.id, other.id)
        XCTAssertEqual(other.index, 3)
        XCTAssertEqual(other.widthPt, 1024)
        let queued = pendingEntries(h).count

        let again = try XCTUnwrap(h.service.slidePage(notebookID: notebookID, slide: slide1))
        XCTAssertEqual(again.id, first.id)
        XCTAssertEqual(pendingEntries(h).count, queued)
        XCTAssertEqual(h.service.pages(inNotebook: notebookID).count, 3)
    }

    func testTwoPagesForTheSameSlideTakeTheOneWithTheSmallerIndex() throws {
        let h = SyncHarness()
        func page(_ id: String, index: Int) -> LibraryPage {
            LibraryPage(
                id: id, notebookID: notebookID, index: index, template: .folie, widthPt: 960, heightPt: 540,
                sessionID: nil, backgroundSlideID: slide1.id, attachedSlideID: nil, version: 1, createQueued: true,
                needsReconcile: false, deletedAtMS: nil, deleteQueued: false)
        }
        h.library.upsert(page("page-z", index: 5))
        h.library.upsert(page("page-a", index: 3))
        let found = try XCTUnwrap(h.service.slidePage(notebookID: notebookID, slide: slide1))
        XCTAssertEqual(found.id, "page-a")
    }

    func testAPageInTheDeleteGraceIsNotReused() throws {
        let h = SyncHarness()
        let first = try XCTUnwrap(h.service.slidePage(notebookID: notebookID, slide: slide1))
        h.service.deletePage(pageID: first.id)
        let fresh = try XCTUnwrap(h.service.slidePage(notebookID: notebookID, slide: slide1))
        XCTAssertNotEqual(fresh.id, first.id)
    }

    func testAnUnknownNotebookGivesNoPage() {
        let h = SyncHarness()
        XCTAssertNil(h.service.slidePage(notebookID: "unbekannt", slide: slide1))
    }

    // MARK: Freie Seite

    func testAFreePageCanCarryTheCurrentSlideAndAChangeDoesNotTouchTheOpenPage() throws {
        let h = SyncHarness()
        let page = try XCTUnwrap(
            h.service.addPage(
                notebookID: notebookID, template: .blanko, size: CGSize(width: 595, height: 842),
                backgroundSlideID: nil, attachedSlideID: slide1.id))
        XCTAssertEqual(page.attachedSlideID, slide1.id)
        let entry = try XCTUnwrap(pendingEntries(h).first { $0.kind == "page.create" })
        let fields = try data(entry)
        XCTAssertEqual(fields["attached_slide_id"] as? String, slide1.id)
        XCTAssertTrue(fields["background_slide_id"] is NSNull)

        // Ein Folienwechsel ändert die Seite nicht: Es entsteht keine Operation
        let before = pendingEntries(h).count
        let gate = SlideSwitchGate()
        _ = gate.slideChanged(slide2)
        XCTAssertEqual(pendingEntries(h).count, before)
        XCTAssertEqual(h.library.page(page.id)?.attachedSlideID, slide1.id)
    }

    // MARK: Session aus dem Strom

    private func brief(deck: String? = "deck-1", id: String = "019a4e14-0000-7000-8000-0000000000d1") -> SessionBrief {
        SessionBrief(
            id: id, moduleID: moduleID, state: "laeuft", startedAtMS: 1_794_384_000_000, slideDeckID: deck,
            deleted: false, updatedAtMS: 1)
    }

    func testFollowingASessionSetsRunningWithTheNotebookOfTheCore() async {
        let exerciseID = "019a4e14-0000-7000-8000-0000000000e2"
        let h = SyncHarness(health: [
            .http(status: 200, body: LibraryFixtures.notebookJSON(id: exerciseID, kind: "uebung", title: "Übung"))
        ])
        h.service.attachFollower()
        await startOnline(h)

        await h.service.follow(session: brief())
        XCTAssertEqual(h.service.running?.id, "019a4e14-0000-7000-8000-0000000000d1")
        XCTAssertEqual(h.service.running?.moduleID, moduleID)
        XCTAssertEqual(h.service.running?.slideDeckID, "deck-1")
        XCTAssertEqual(h.service.running?.startMS, 1_794_384_000_000)
        XCTAssertEqual(h.service.running?.notebookID, exerciseID)
        XCTAssertNotNil(h.library.notebook(exerciseID))

        // Dieselbe Session noch einmal (Folienwechsel): kein neuer Abruf
        let requests = h.transport.requests.count
        await h.service.follow(session: brief())
        XCTAssertEqual(h.transport.requests.count, requests)
    }

    func testTheEndOfTheSessionClearsRunning() async {
        let h = SyncHarness()
        h.service.attachFollower()
        await h.service.follow(session: brief())
        XCTAssertNotNil(h.service.running)
        await h.service.follow(session: nil)
        XCTAssertNil(h.service.running)
    }

    func testWithoutConnectionTheSessionIsKnownButHasNoNotebookYet() async {
        let h = SyncHarness()
        h.service.attachFollower()
        await h.service.follow(session: brief())
        XCTAssertEqual(h.service.running?.slideDeckID, "deck-1")
        XCTAssertNil(h.service.running?.notebookID)
        XCTAssertTrue(h.transport.requests.isEmpty)
    }

    func testRefreshNoLongerAsksForSessionsOnceTheFollowerIsAttached() async {
        let h = SyncHarness(health: [
            // 0: `GET /sessions/{id}/notebook` beim Folgen
            .http(status: 200, body: LibraryFixtures.notebookJSON(id: notebookID)),
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.moduleJSON()])),
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.notebookJSON(id: notebookID)])),
        ])
        h.service.attachFollower()
        await startOnline(h)
        await h.service.follow(session: brief())
        let before = h.service.running
        await h.service.refresh(force: true)
        let paths = h.transport.requests.compactMap { $0.url?.path }
        XCTAssertFalse(paths.contains { $0.hasSuffix("/sessions") })
        XCTAssertEqual(h.service.running?.id, before?.id)
    }

    func testOfflineRefreshKeepsTheFollowedSession() async {
        let h = SyncHarness()
        h.service.attachFollower()
        await h.service.follow(session: brief())
        await h.service.refresh(force: true)
        XCTAssertNotNil(h.service.running)
    }

    // MARK: REST

    func testSessionSnapshotReadsOnlyWhatTheFollowerNeeds() async throws {
        let body = """
            {"session":{"id":"s1","user_id":"u","module_id":"m1","created_at":"2026-11-04T07:15:00Z",
            "updated_at":"2026-11-11T08:00:05.250Z","deleted_at":null,"state":"laeuft",
            "started_at":"2026-11-11T08:00:00Z","slide_deck_id":"deck-1","processing":{},"review_state":"offen"},
            "slide_events":[
            {"id":"e1","session_id":"s1","slide_id":"slide-1","slide_index":1,"t_ms":1000,"device":"mac",
            "created_at":"2026-11-11T08:00:01Z","deleted_at":null},
            {"id":"e2","session_id":"s1","slide_id":null,"slide_index":4,"t_ms":9000,"device":"mac",
            "created_at":"2026-11-11T08:00:09Z","deleted_at":null}],
            "markers":[{"neu":true}],"photos":[],"recordings":[],"stream_seq":12,"stream_op_id":"op-12"}
            """
        let transport = FakeTransport([.http(status: 200, body: body)])
        let client = Fixtures.client(transport)
        let snapshot = try await client.sessionSnapshot(
            endpoint: Fixtures.endpoint, token: Fixtures.token, sessionID: "s1")
        let value = try XCTUnwrap(snapshot)
        XCTAssertEqual(value.session.id, "s1")
        XCTAssertEqual(value.session.slideDeckID, "deck-1")
        XCTAssertEqual(value.session.startedAtMS, 1_794_384_000_000)
        XCTAssertEqual(value.streamSeq, 12)
        XCTAssertEqual(value.streamOpID, "op-12")
        XCTAssertEqual(value.latestSlide, SlideBrief(slideID: nil, index: 4))
        XCTAssertEqual(transport.requests.first?.url?.path, "/api/v1/sessions/s1/snapshot")
    }

    func testSessionSnapshotIs404AsNil() async throws {
        let transport = FakeTransport([.http(status: 404, body: Fixtures.apiError("session_not_found"))])
        let snapshot = try await Fixtures.client(transport).sessionSnapshot(
            endpoint: Fixtures.endpoint, token: Fixtures.token, sessionID: "s1")
        XCTAssertNil(snapshot)
    }

    func testSlideDeckReadsListAndChecksumAndSkipsDeletedSlides() async throws {
        let body = """
            {"deck":{"id":"deck-1","sha256":"ABCDEF","title":"x"},"slides":[
            {"id":"s2","index":2,"width_pt":960,"height_pt":540,"text":"t","text_blocks":[],"deleted_at":null},
            {"id":"s1","index":1,"width_pt":595,"height_pt":842,"deleted_at":null},
            {"id":"s9","index":3,"width_pt":960,"height_pt":540,"deleted_at":"2026-11-11T08:00:00Z"}]}
            """
        let transport = FakeTransport([.http(status: 200, body: body)])
        let info = try await Fixtures.client(transport).slideDeck(
            endpoint: Fixtures.endpoint, token: Fixtures.token, deckID: "deck-1")
        let deck = try XCTUnwrap(info)
        XCTAssertEqual(deck.sha256, "abcdef")
        XCTAssertEqual(deck.slides.map(\.id), ["s1", "s2"])
        XCTAssertEqual(deck.slides.first?.widthPt, 595)
    }

    func testDownloadFailureIsMappedToAConnectionError() async {
        let transport = FakeTransport([.http(status: 200, body: "{}")])
        transport.downloadStatus = 401
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("x-\(UUID().uuidString).pdf")
        do {
            try await Fixtures.client(transport).downloadSlideDeckFile(
                endpoint: Fixtures.endpoint, token: Fixtures.token, deckID: "deck-1", to: file)
            XCTFail("hätte werfen müssen")
        } catch {
            XCTAssertEqual(error as? ConnectionError, .tokenInvalid)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }
}
