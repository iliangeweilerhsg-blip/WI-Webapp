import PencilKit
import XCTest

@testable import StudienGehirn

/// M2/L3 aus #225: einmalige Übernahme der alten lokalen Testseite und lesbare alte `library.json`
@MainActor
final class InkLegacyAdoptionTests: XCTestCase {
    private func pageStore(_ h: SyncHarness) -> FileInkPageStore {
        FileInkPageStore(root: h.directory.appendingPathComponent("Ink"))
    }

    private func makeService(
        _ h: SyncHarness, store: (any InkLibraryStore)? = nil, pageStore: any InkPageStore
    ) -> InkLibraryService {
        InkLibraryService(
            store: store ?? h.library, sync: h.engine, client: Fixtures.client(h.transport), pageStore: pageStore,
            now: { h.clock.date })
    }

    /// Legt die Testseite mit n Strichen auf die Platte, wie ein Stand vor #224
    private func writeLegacyPage(_ pages: FileInkPageStore, strokes count: Int) throws {
        var drawing = PKDrawing()
        for index in 0..<count {
            let points = (0..<6).map { step in
                PKStrokePoint(
                    location: CGPoint(x: 100 + CGFloat(step) * 10, y: 100 + CGFloat(index) * 20),
                    timeOffset: TimeInterval(step) * 0.016,
                    size: CGSize(width: 3, height: 3),
                    opacity: 1,
                    force: 1,
                    azimuth: 0,
                    altitude: .pi / 2
                )
            }
            let path = PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSince1970: 1_762_246_500))
            drawing.strokes.append(PKStroke(ink: PKInk(.pen, color: .black), path: path))
        }
        var snapshot = InkPageSnapshot()
        snapshot.ink = count == 0 ? nil : drawing.dataRepresentation()
        try pages.save(snapshot, pageID: InkPageModel.testPageID)
    }

    private func pendingKinds(_ h: SyncHarness) -> [String] {
        SyncOutbox(directory: h.directory).pending.map(\.kind)
    }

    func testPageWithStrokesIsAdoptedExactlyOnce() throws {
        let h = SyncHarness()
        let pages = pageStore(h)
        try writeLegacyPage(pages, strokes: 2)

        let service = makeService(h, pageStore: pages)
        let notebooks = service.notebooks(inModule: h.binding.moduleID).filter { $0.title == "Alte Schreibfläche" }
        XCTAssertEqual(notebooks.count, 1)
        let notebook = try XCTUnwrap(notebooks.first)
        XCTAssertEqual(notebook.kind, .frei)
        XCTAssertFalse(notebook.knownOnServer)
        // L7: eigene ID statt der festen der Testseite
        let page = try XCTUnwrap(service.pages(inNotebook: notebook.id).first)
        XCTAssertNotEqual(page.id, InkPageModel.testPageID)
        XCTAssertNil(service.page(InkPageModel.testPageID))
        XCTAssertEqual(notebook.lastPageID, page.id)
        XCTAssertEqual(page.notebookID, notebook.id)
        XCTAssertEqual(page.index, 1)
        XCTAssertTrue(page.createQueued)
        XCTAssertTrue(h.library.legacyTestPageHandled)

        // `notebook.create` zuerst, dann `page.create`, dann je Strich ein `stroke.add`
        XCTAssertEqual(pendingKinds(h), ["notebook.create", "page.create", "stroke.add", "stroke.add"])
        // Die alte Datei bleibt, die Kopie unter der neuen ID trägt die Zuordnung der Striche
        XCTAssertNotNil(pages.load(pageID: InkPageModel.testPageID).ink)
        XCTAssertEqual(pages.load(pageID: page.id).trackers.ink.entries.count, 2)
        XCTAssertEqual(h.library.legacyAdoption, LegacyAdoptionMarker(notebookID: notebook.id, pageID: page.id))
    }

    func testPageWithoutStrokesIsNotAdopted() throws {
        let h = SyncHarness()
        let pages = pageStore(h)
        try writeLegacyPage(pages, strokes: 0)

        let service = makeService(h, pageStore: pages)
        XCTAssertNil(service.page(InkPageModel.testPageID))
        XCTAssertEqual(service.notebooks(inModule: h.binding.moduleID).count, 1)
        XCTAssertEqual(pendingKinds(h), [])
    }

    func testMissingPageFileIsNotAdopted() {
        let h = SyncHarness()
        let service = makeService(h, pageStore: pageStore(h))
        XCTAssertNil(service.page(InkPageModel.testPageID))
        XCTAssertEqual(pendingKinds(h), [])
    }

    func testSecondStartAdoptsNothingAgain() throws {
        let h = SyncHarness()
        let pages = pageStore(h)
        try writeLegacyPage(pages, strokes: 1)
        _ = makeService(h, pageStore: pages)
        XCTAssertEqual(pendingKinds(h).count, 3)

        // Neustart: neue Ablage aus derselben Datei, neuer Dienst
        let reopened = FileInkLibraryStore(url: h.directory.appendingPathComponent("library.json"))
        XCTAssertTrue(reopened.legacyTestPageHandled)
        let service = makeService(h, store: reopened, pageStore: pages)
        let adopted = service.notebooks(inModule: h.binding.moduleID).filter { $0.title == "Alte Schreibfläche" }
        XCTAssertEqual(adopted.count, 1)
        XCTAssertEqual(pendingKinds(h).count, 3)
        service.adoptLegacyTestPage()
        XCTAssertEqual(pendingKinds(h).count, 3)
    }

    /// Absturz zwischen dem Speichern von Notizbuch und Seite: Der nächste Versuch nimmt dieselben IDs (L7 aus #286)
    func testInterruptedAdoptionReusesItsMarkedIDs() throws {
        let h = SyncHarness()
        let marker = LegacyAdoptionMarker(
            notebookID: "019a4e14-0000-7000-8000-0000000000e1", pageID: "019a4e14-0000-7000-8000-0000000000e2")
        h.library.beginLegacyAdoption(marker)
        let orphan = LibraryNotebook(
            id: marker.notebookID,
            moduleID: h.binding.moduleID,
            title: InkLibraryService.legacyNotebookTitle,
            kind: .frei,
            createdAtMS: 1,
            knownOnServer: false,
            hidden: false,
            lastPageID: marker.pageID,
            remoteMaxIndex: 0,
            remoteOnlyPageCount: 0
        )
        h.library.upsert(orphan)
        let pages = pageStore(h)
        try writeLegacyPage(pages, strokes: 1)

        let service = makeService(h, pageStore: pages)
        let adopted = service.notebooks(inModule: h.binding.moduleID).filter { $0.title == "Alte Schreibfläche" }
        XCTAssertEqual(adopted.map(\.id), [orphan.id])
        XCTAssertEqual(service.page(marker.pageID)?.notebookID, orphan.id)
        XCTAssertNil(service.page(InkPageModel.testPageID))
        XCTAssertEqual(pendingKinds(h), ["notebook.create", "page.create", "stroke.add"])
    }

    /// Ein Notizbuch aus der Zeit vor der Markierung (verwaist, `lastPageID` = feste ID) wird weiterverwendet,
    /// die Seite bekommt trotzdem eine neue ID
    func testOrphanFromBeforeTheMarkerIsReused() throws {
        let h = SyncHarness()
        let orphan = LibraryNotebook(
            id: "019a4e14-0000-7000-8000-0000000000e3",
            moduleID: h.binding.moduleID,
            title: InkLibraryService.legacyNotebookTitle,
            kind: .frei,
            createdAtMS: 1,
            knownOnServer: false,
            hidden: false,
            lastPageID: InkPageModel.testPageID,
            remoteMaxIndex: 0,
            remoteOnlyPageCount: 0
        )
        h.library.upsert(orphan)
        let pages = pageStore(h)
        try writeLegacyPage(pages, strokes: 1)

        let service = makeService(h, pageStore: pages)
        let adopted = service.notebooks(inModule: h.binding.moduleID).filter { $0.title == "Alte Schreibfläche" }
        XCTAssertEqual(adopted.map(\.id), [orphan.id])
        let page = try XCTUnwrap(service.pages(inNotebook: orphan.id).first)
        XCTAssertNotEqual(page.id, InkPageModel.testPageID)
        XCTAssertEqual(service.notebook(orphan.id)?.lastPageID, page.id)
    }

    /// Zwei iPads mit derselben Testseite bekommen verschiedene Seiten-IDs
    func testTwoDevicesGetDifferentPageIDs() throws {
        let first = SyncHarness()
        let second = SyncHarness()
        let firstPages = pageStore(first)
        let secondPages = pageStore(second)
        try writeLegacyPage(firstPages, strokes: 1)
        try writeLegacyPage(secondPages, strokes: 1)
        let a = makeService(first, pageStore: firstPages)
        let b = makeService(second, pageStore: secondPages)
        let pageA = try XCTUnwrap(a.notebooks(inModule: first.binding.moduleID).first { $0.title == "Alte Schreibfläche" })
        let pageB = try XCTUnwrap(b.notebooks(inModule: second.binding.moduleID).first { $0.title == "Alte Schreibfläche" })
        XCTAssertNotEqual(pageA.lastPageID, pageB.lastPageID)
        XCTAssertNotEqual(pageA.id, pageB.id)
    }

    func testAdoptionWaitsUntilAModuleIsKnown() throws {
        let h = SyncHarness()
        let pages = pageStore(h)
        try writeLegacyPage(pages, strokes: 1)
        let empty = FileInkLibraryStore(url: h.directory.appendingPathComponent("leer.json"))

        let service = makeService(h, store: empty, pageStore: pages)
        XCTAssertNil(empty.page(InkPageModel.testPageID))
        XCTAssertFalse(empty.legacyTestPageHandled)
        XCTAssertEqual(pendingKinds(h), [])

        // Der erste Abruf der Module holt es nach
        empty.mergeModules(
            [ModuleBrief(id: "m1", name: "Analysis I", shortName: nil, inkMode: nil)], at: h.clock.date)
        service.adoptLegacyTestPage()
        let adoptedPage = try XCTUnwrap(empty.legacyAdoption.flatMap { empty.page($0.pageID) })
        XCTAssertEqual(empty.notebook(adoptedPage.notebookID)?.moduleID, "m1")
        XCTAssertTrue(empty.legacyTestPageHandled)
        XCTAssertEqual(pendingKinds(h), ["notebook.create", "page.create", "stroke.add"])
    }

    func testTargetsTheModuleOfTheLastUsedNotebook() throws {
        let h = SyncHarness()
        h.library.mergeModules(
            [
                ModuleBrief(id: "m-aaa", name: "AAA", shortName: nil, inkMode: nil),
                ModuleBrief(id: h.binding.moduleID, name: "Analysis I", shortName: nil, inkMode: nil),
            ], at: h.clock.date)
        let pages = pageStore(h)
        try writeLegacyPage(pages, strokes: 1)
        let service = makeService(h, pageStore: pages)
        let notebookID = try XCTUnwrap(h.library.legacyAdoption.flatMap { service.page($0.pageID) }?.notebookID)
        // Zuletzt benutzt ist die Vorlesung des Harness, nicht das alphabetisch erste Modul
        XCTAssertEqual(service.notebook(notebookID)?.moduleID, h.binding.moduleID)
    }

    func testOldLibraryFileWithoutTheNewFieldIsReadable() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("library-old-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("library.json")
        let old = """
            {"schemaVersion":1,"dbEpoch":"epoch-1","lastNotebookID":"n1","pages":[],
            "modules":[{"id":"m1","name":"Analysis I","inkModeDirty":false}],
            "notebooks":[{"id":"n1","moduleID":"m1","title":"Vorlesung","kind":"vorlesung","createdAtMS":1,
            "knownOnServer":true,"hidden":false,"remoteMaxIndex":0,"remoteOnlyPageCount":0}]}
            """
        try Data(old.utf8).write(to: url)

        let store = FileInkLibraryStore(url: url)
        XCTAssertEqual(store.modules.map(\.id), ["m1"])
        XCTAssertNotNil(store.notebook("n1"))
        XCTAssertEqual(store.dbEpoch, "epoch-1")
        XCTAssertFalse(store.legacyTestPageHandled)
        let broken = directory.appendingPathComponent("library.defekt.json")
        XCTAssertFalse(FileManager.default.fileExists(atPath: broken.path))
    }
}
