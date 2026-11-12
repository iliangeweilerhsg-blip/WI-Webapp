import XCTest

@testable import StudienGehirn

/// E10 aus #286: höchstens eine Folienseite je Notizbuch, Folie und Session, ohne dass Striche verloren gehen
@MainActor
final class DuplicateSlidePagesTests: XCTestCase {
    private let notebookID = "019a4e14-0000-7000-8000-0000000000a2"
    private let slide = SlideRef(id: "019a4e14-0000-7000-8000-000000000041", index: 1, widthPt: 960, heightPt: 540)
    private let otherSlideID = "019a4e14-0000-7000-8000-000000000042"

    private func slidePage(_ id: String, index: Int, slideID: String? = nil, session: String? = nil) -> LibraryPage {
        LibraryPage(
            id: id, notebookID: notebookID, index: index, template: .folie, widthPt: 960, heightPt: 540,
            sessionID: session, backgroundSlideID: slideID ?? slide.id, attachedSlideID: nil, version: 1,
            createQueued: true, needsReconcile: false, deletedAtMS: nil, deleteQueued: false)
    }

    private func makeService(_ h: SyncHarness, _ pages: FakeInkPageStore) -> InkLibraryService {
        InkLibraryService(
            store: h.library, sync: h.engine, client: h.client, pageStore: pages, now: { h.clock.date },
            graceSleep: { try await h.clock.sleep($0) })
    }

    private func write(_ pages: FakeInkPageStore, _ pageID: String) {
        var snapshot = InkPageSnapshot()
        snapshot.ink = Data([1])
        pages.snapshots[pageID] = snapshot
    }

    private func isDeleted(_ h: SyncHarness, _ id: String) -> Bool {
        h.library.page(id)?.deletedAtMS != nil
    }

    func testTwoEmptyDuplicatesKeepTheOneWithTheSmallerIndex() {
        let h = SyncHarness()
        let pages = FakeInkPageStore()
        let service = makeService(h, pages)
        h.library.upsert(slidePage("page-z", index: 5))
        h.library.upsert(slidePage("page-a", index: 3))

        XCTAssertEqual(service.mergeDuplicateSlidePages(notebookID: notebookID), 1)
        XCTAssertFalse(isDeleted(h, "page-a"))
        XCTAssertTrue(isDeleted(h, "page-z"))
    }

    func testTheDuplicateWithStrokesStaysEvenWithTheLargerIndex() {
        let h = SyncHarness()
        let pages = FakeInkPageStore()
        let service = makeService(h, pages)
        h.library.upsert(slidePage("page-a", index: 3))
        h.library.upsert(slidePage("page-z", index: 5))
        write(pages, "page-z")

        XCTAssertEqual(service.mergeDuplicateSlidePages(notebookID: notebookID), 1)
        XCTAssertTrue(isDeleted(h, "page-a"))
        XCTAssertFalse(isDeleted(h, "page-z"))
    }

    func testTwoWrittenDuplicatesAreBothKept() {
        let h = SyncHarness()
        let pages = FakeInkPageStore()
        let service = makeService(h, pages)
        h.library.upsert(slidePage("page-a", index: 3))
        h.library.upsert(slidePage("page-z", index: 5))
        write(pages, "page-a")
        write(pages, "page-z")

        XCTAssertEqual(service.mergeDuplicateSlidePages(notebookID: notebookID), 0)
        XCTAssertFalse(isDeleted(h, "page-a"))
        XCTAssertFalse(isDeleted(h, "page-z"))
    }

    func testAnUnreadablePageCountsAsWritten() {
        let h = SyncHarness()
        let pages = FakeInkPageStore()
        let service = makeService(h, pages)
        h.library.upsert(slidePage("page-a", index: 3))
        h.library.upsert(slidePage("page-z", index: 5))
        var broken = InkPageSnapshot()
        broken.unreadable = true
        pages.snapshots["page-z"] = broken

        XCTAssertEqual(service.mergeDuplicateSlidePages(notebookID: notebookID), 1)
        XCTAssertTrue(isDeleted(h, "page-a"))
        XCTAssertFalse(isDeleted(h, "page-z"))
    }

    func testPagesOfDifferentSessionsOrSlidesAreNoDuplicates() {
        let h = SyncHarness()
        let service = makeService(h, FakeInkPageStore())
        h.library.upsert(slidePage("page-s1", index: 3, session: "session-1"))
        h.library.upsert(slidePage("page-s2", index: 4, session: "session-2"))
        h.library.upsert(slidePage("page-none", index: 5))
        h.library.upsert(slidePage("page-other", index: 6, slideID: otherSlideID))

        XCTAssertEqual(service.mergeDuplicateSlidePages(notebookID: notebookID), 0)
        for id in ["page-s1", "page-s2", "page-none", "page-other"] {
            XCTAssertFalse(isDeleted(h, id))
        }
    }

    func testTheLastOpenedPageIsNeverRemoved() {
        let h = SyncHarness()
        let service = makeService(h, FakeInkPageStore())
        h.library.upsert(slidePage("page-a", index: 3))
        h.library.upsert(slidePage("page-z", index: 5))
        h.library.setLast(notebookID: notebookID, pageID: "page-z")

        XCTAssertEqual(service.mergeDuplicateSlidePages(notebookID: notebookID), 0)
        XCTAssertFalse(isDeleted(h, "page-z"))
    }

    func testPagesWithoutASlideAreIgnored() {
        let h = SyncHarness()
        let service = makeService(h, FakeInkPageStore())
        XCTAssertEqual(service.mergeDuplicateSlidePages(notebookID: notebookID), 0)
        XCTAssertEqual(service.mergeDuplicateSlidePages(notebookID: "unbekannt"), 0)
    }

    func testOpeningTheSlideMergesDuplicatesAndReturnsTheSurvivor() throws {
        let h = SyncHarness()
        let pages = FakeInkPageStore()
        let service = makeService(h, pages)
        // Der Mac hat die alte Folienseite wiederhergestellt, das iPad hatte schon eine neue
        h.library.upsert(slidePage("page-old", index: 3))
        h.library.upsert(slidePage("page-new", index: 4))
        write(pages, "page-old")

        let found = try XCTUnwrap(service.slidePage(notebookID: notebookID, slide: slide))
        XCTAssertEqual(found.id, "page-old")
        XCTAssertTrue(isDeleted(h, "page-new"))
        XCTAssertEqual(service.pages(inNotebook: notebookID).filter { $0.backgroundSlideID == slide.id }.count, 1)
        // Die Striche der behaltenen Seite sind unberührt
        XCTAssertNotNil(pages.load(pageID: "page-old").ink)
    }
}
