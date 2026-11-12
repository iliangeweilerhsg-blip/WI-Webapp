import XCTest

@testable import StudienGehirn

/// UX-55: leere Ersatzseite nach „Rückgängig“ aufräumen. UX-56: Notizbuch anlegen, gleicher Titel im Modul.
@MainActor
final class Ux55Ux56KleinigkeitenTests: XCTestCase {
    private let moduleID = LibraryFixtures.moduleID
    private let notebookID = "019a4e14-0000-7000-8000-0000000000a2"
    private let firstPageID = "019a4e14-0000-7000-8000-0000000000b1"

    private func makeService(_ h: SyncHarness, pageStore: FakeInkPageStore) -> InkLibraryService {
        InkLibraryService(
            store: h.library, sync: h.engine, client: h.client, pageStore: pageStore, now: { h.clock.date },
            graceSleep: { try await h.clock.sleep($0) })
    }

    // MARK: UX-55

    /// Die letzte Seite wird gelöscht, `openTarget` legt eine Ersatzseite an
    private func deleteLastPageAndOpenReplacement(_ service: InkLibraryService) throws -> String {
        service.deletePage(pageID: firstPageID)
        let target = try XCTUnwrap(service.openTarget(notebookID: notebookID))
        XCTAssertNotEqual(target.pageID, firstPageID)
        return target.pageID
    }

    func testAnEmptyReplacementPageIsDiscardedAfterUndo() async throws {
        let h = SyncHarness()
        let service = makeService(h, pageStore: FakeInkPageStore())
        let replacementID = try deleteLastPageAndOpenReplacement(service)

        XCTAssertTrue(service.undoDelete(pageID: firstPageID))
        XCTAssertTrue(service.discardEmptyPage(pageID: replacementID))
        XCTAssertEqual(service.pages(inNotebook: notebookID).map(\.id), [firstPageID])
        XCTAssertNotNil(h.library.page(replacementID)?.deletedAtMS)
    }

    func testAReplacementPageWithStrokesStaysAfterUndo() async throws {
        let h = SyncHarness()
        let store = FakeInkPageStore()
        let service = makeService(h, pageStore: store)
        let replacementID = try deleteLastPageAndOpenReplacement(service)
        store.snapshots[replacementID] = InkPageSnapshot(ink: Data([1, 2, 3]))

        XCTAssertTrue(service.undoDelete(pageID: firstPageID))
        XCTAssertFalse(service.discardEmptyPage(pageID: replacementID))
        XCTAssertEqual(service.pages(inNotebook: notebookID).count, 2)
        XCTAssertNil(h.library.page(replacementID)?.deletedAtMS)
    }

    func testWithoutAPageStoreNothingIsDiscarded() async throws {
        let h = SyncHarness()
        XCTAssertFalse(h.service.discardEmptyPage(pageID: firstPageID))
        XCTAssertEqual(h.service.pages(inNotebook: notebookID).count, 1)
    }

    func testAnUnknownOrAlreadyDeletedPageIsNotDiscarded() async throws {
        let h = SyncHarness()
        let service = makeService(h, pageStore: FakeInkPageStore())
        XCTAssertFalse(service.discardEmptyPage(pageID: "unbekannt"))
        service.deletePage(pageID: firstPageID)
        XCTAssertFalse(service.discardEmptyPage(pageID: firstPageID))
    }

    // MARK: UX-56

    func testASecondNotebookWithTheSameTitleIsRefused() async throws {
        let h = SyncHarness()
        XCTAssertNotNil(h.service.createNotebook(moduleID: moduleID, title: "Eigene Notizen"))
        XCTAssertNil(h.service.createNotebook(moduleID: moduleID, title: "  eigene notizen "))
        XCTAssertNil(h.service.createNotebook(moduleID: moduleID, title: "VORLESUNG"))
        XCTAssertEqual(h.service.notebooks(inModule: moduleID).map(\.title), ["Vorlesung", "Eigene Notizen"])
    }

    func testHasNotebookIgnoresCaseAndEdgeWhitespace() async throws {
        let h = SyncHarness()
        XCTAssertTrue(h.service.hasNotebook(inModule: moduleID, titled: " vorlesung\n"))
        XCTAssertFalse(h.service.hasNotebook(inModule: moduleID, titled: "Vorlesung 2"))
        XCTAssertFalse(h.service.hasNotebook(inModule: "anderes-modul", titled: "Vorlesung"))
    }

    func testCreateIsDisabledForEmptyOrDuplicateTitles() {
        XCTAssertTrue(LibraryTexts.canCreate(title: "Neu", isDuplicate: false))
        XCTAssertFalse(LibraryTexts.canCreate(title: "  ", isDuplicate: false))
        XCTAssertFalse(LibraryTexts.canCreate(title: "Neu", isDuplicate: true))
    }

    func testTheCreateMessageSaysWhyCreateIsDisabled() {
        XCTAssertEqual(
            LibraryTexts.createMessage(moduleName: "Analysis I", isDuplicate: false),
            "Ein freies Notizbuch in Analysis I.")
        XCTAssertEqual(
            LibraryTexts.createMessage(moduleName: "Analysis I", isDuplicate: true),
            "In Analysis I gibt es schon ein Notizbuch mit diesem Titel.")
        XCTAssertEqual(LibraryTexts.createFailedLine, "Konnte nicht gespeichert werden")
    }
}
