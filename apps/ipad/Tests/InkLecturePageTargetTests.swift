import XCTest

@testable import StudienGehirn

/// UX-44: Eine neue Vorlesung schreibt nicht auf die Seite der Vorwoche
@MainActor
final class InkLecturePageTargetTests: XCTestCase {
    private let notebookID = "019a4e14-0000-7000-8000-0000000000a2"
    private let firstPageID = "019a4e14-0000-7000-8000-0000000000b1"
    private let moduleID = LibraryFixtures.moduleID
    private let runningID = "019a4e14-0000-7000-8000-0000000000d1"
    private let lastWeekID = "019a4e14-0000-7000-8000-0000000000d0"

    /// Dienst mit Seitenablage im Arbeitsspeicher über der Bibliothek des Harness
    private func makeService(_ h: SyncHarness, pageStore: FakeInkPageStore) -> InkLibraryService {
        InkLibraryService(
            store: h.library, sync: h.engine, client: h.client, pageStore: pageStore, now: { h.clock.date },
            graceSleep: { try await h.clock.sleep($0) })
    }

    private func brief() -> SessionBrief {
        SessionBrief(
            id: runningID, moduleID: moduleID, state: "laeuft", startedAtMS: 1_794_384_000_000, slideDeckID: nil,
            deleted: false, updatedAtMS: 1)
    }

    /// Die erste Seite des Harness bekommt Session und Vorlage, mit oder ohne Striche
    private func prepareLastPage(
        _ h: SyncHarness, store: FakeInkPageStore, session: String?, hasStrokes: Bool,
        template: PageTemplate = .blanko
    ) throws {
        var page = try XCTUnwrap(h.library.page(firstPageID))
        page.sessionID = session
        page.template = template
        h.library.upsert(page)
        if hasStrokes {
            store.snapshots[firstPageID] = InkPageSnapshot(ink: Data([1, 2, 3]))
        }
    }

    private func runLecture(_ service: InkLibraryService) async {
        service.attachFollower()
        // Ohne Verbindung: die Session ist bekannt, ihr Notizbuch noch nicht
        await service.follow(session: brief())
        XCTAssertEqual(service.running?.id, runningID)
    }

    func testAPageFromAnotherSessionGetsANewPageWithTheRunningSession() async throws {
        let h = SyncHarness()
        let store = FakeInkPageStore()
        try prepareLastPage(h, store: store, session: lastWeekID, hasStrokes: true, template: .kariert)
        let service = makeService(h, pageStore: store)
        await runLecture(service)

        XCTAssertTrue(service.needsLecturePage(notebookID: notebookID))
        let target = try XCTUnwrap(service.openLectureTarget(notebookID: notebookID))

        XCTAssertNotEqual(target.pageID, firstPageID)
        XCTAssertEqual(target.sessionID, runningID)
        let page = try XCTUnwrap(service.page(target.pageID))
        XCTAssertEqual(page.sessionID, runningID)
        XCTAssertEqual(page.template, .kariert)
        XCTAssertEqual(page.widthPt, 595)
        XCTAssertEqual(page.heightPt, 842)
        XCTAssertEqual(page.index, 2)
        XCTAssertNil(page.backgroundSlideID)
        XCTAssertEqual(service.pages(inNotebook: notebookID).map(\.id), [firstPageID, target.pageID])
        XCTAssertEqual(service.notebook(notebookID)?.lastPageID, target.pageID)
        // Die alte Seite bleibt unverändert, das Anlegen ist eingereiht
        XCTAssertEqual(service.page(firstPageID)?.sessionID, lastWeekID)
        let kinds = SyncOutbox(directory: h.directory).pending.map(\.kind)
        XCTAssertTrue(kinds.contains("page.create"))
        XCTAssertFalse(kinds.contains("page.update"))
    }

    func testASecondCallReusesTheNewPage() async throws {
        let h = SyncHarness()
        let store = FakeInkPageStore()
        try prepareLastPage(h, store: store, session: lastWeekID, hasStrokes: true)
        let service = makeService(h, pageStore: store)
        await runLecture(service)

        let first = try XCTUnwrap(service.openLectureTarget(notebookID: notebookID))
        XCTAssertFalse(service.needsLecturePage(notebookID: notebookID))
        let second = try XCTUnwrap(service.openLectureTarget(notebookID: notebookID))
        XCTAssertEqual(first.pageID, second.pageID)
        XCTAssertEqual(service.pages(inNotebook: notebookID).count, 2)
    }

    func testAnEmptyPageWithTheSameSessionIsReused() async throws {
        let h = SyncHarness()
        let store = FakeInkPageStore()
        try prepareLastPage(h, store: store, session: runningID, hasStrokes: false)
        let service = makeService(h, pageStore: store)
        await runLecture(service)

        XCTAssertFalse(service.needsLecturePage(notebookID: notebookID))
        let target = try XCTUnwrap(service.openLectureTarget(notebookID: notebookID))
        XCTAssertEqual(target.pageID, firstPageID)
        XCTAssertEqual(service.pages(inNotebook: notebookID).count, 1)
    }

    func testAPageWithStrokesAndTheSameSessionIsReused() async throws {
        let h = SyncHarness()
        let store = FakeInkPageStore()
        try prepareLastPage(h, store: store, session: runningID, hasStrokes: true)
        let service = makeService(h, pageStore: store)
        await runLecture(service)

        let target = try XCTUnwrap(service.openLectureTarget(notebookID: notebookID))
        XCTAssertEqual(target.pageID, firstPageID)
        XCTAssertEqual(service.pages(inNotebook: notebookID).count, 1)
    }

    func testAnEmptyPageWithoutASessionIsReused() async throws {
        let h = SyncHarness()
        let store = FakeInkPageStore()
        try prepareLastPage(h, store: store, session: nil, hasStrokes: false)
        let service = makeService(h, pageStore: store)
        await runLecture(service)

        XCTAssertFalse(service.needsLecturePage(notebookID: notebookID))
        let target = try XCTUnwrap(service.openLectureTarget(notebookID: notebookID))
        XCTAssertEqual(target.pageID, firstPageID)
        XCTAssertEqual(service.pages(inNotebook: notebookID).count, 1)
    }

    func testAnEmptyPageWithAnotherSessionStillGetsANewPage() async throws {
        let h = SyncHarness()
        let store = FakeInkPageStore()
        try prepareLastPage(h, store: store, session: lastWeekID, hasStrokes: false)
        let service = makeService(h, pageStore: store)
        await runLecture(service)

        let target = try XCTUnwrap(service.openLectureTarget(notebookID: notebookID))
        XCTAssertNotEqual(target.pageID, firstPageID)
        XCTAssertEqual(service.page(target.pageID)?.sessionID, runningID)
        XCTAssertEqual(service.pages(inNotebook: notebookID).count, 2)
    }

    func testAPageWithStrokesAndNoSessionGetsANewPage() async throws {
        let h = SyncHarness()
        let store = FakeInkPageStore()
        try prepareLastPage(h, store: store, session: nil, hasStrokes: true)
        let service = makeService(h, pageStore: store)
        await runLecture(service)

        let target = try XCTUnwrap(service.openLectureTarget(notebookID: notebookID))
        XCTAssertNotEqual(target.pageID, firstPageID)
        XCTAssertEqual(service.page(target.pageID)?.sessionID, runningID)
    }

    func testWithoutARunningSessionNothingChanges() async throws {
        let h = SyncHarness()
        let store = FakeInkPageStore()
        try prepareLastPage(h, store: store, session: lastWeekID, hasStrokes: true)
        let service = makeService(h, pageStore: store)
        XCTAssertNil(service.running)

        XCTAssertFalse(service.needsLecturePage(notebookID: notebookID))
        let target = try XCTUnwrap(service.openLectureTarget(notebookID: notebookID))
        XCTAssertEqual(target.pageID, firstPageID)
        XCTAssertNil(target.sessionID)
        XCTAssertEqual(service.pages(inNotebook: notebookID).count, 1)
    }

    func testARunningSessionOfAnotherModuleChangesNothing() async throws {
        let h = SyncHarness()
        let store = FakeInkPageStore()
        try prepareLastPage(h, store: store, session: lastWeekID, hasStrokes: true)
        let service = makeService(h, pageStore: store)
        service.attachFollower()
        await service.follow(
            session: SessionBrief(
                id: runningID, moduleID: "019a4e14-0000-7000-8000-0000000000c2", state: "laeuft",
                startedAtMS: 1, slideDeckID: nil, deleted: false, updatedAtMS: 1))

        XCTAssertFalse(service.needsLecturePage(notebookID: notebookID))
        let target = try XCTUnwrap(service.openLectureTarget(notebookID: notebookID))
        XCTAssertEqual(target.pageID, firstPageID)
    }

    func testASlideTemplateBecomesABlankPageWithoutASlide() async throws {
        let h = SyncHarness()
        let store = FakeInkPageStore()
        try prepareLastPage(h, store: store, session: lastWeekID, hasStrokes: true, template: .folie)
        let service = makeService(h, pageStore: store)
        await runLecture(service)

        let target = try XCTUnwrap(service.openLectureTarget(notebookID: notebookID))
        let page = try XCTUnwrap(service.page(target.pageID))
        XCTAssertEqual(page.template, .blanko)
        XCTAssertNil(page.backgroundSlideID)
    }
}
