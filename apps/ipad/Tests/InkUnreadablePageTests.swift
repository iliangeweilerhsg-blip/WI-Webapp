import PencilKit
import XCTest

@testable import StudienGehirn

/// Merkt sich die Seiten, nach deren Strichen der Core gefragt wurde
@MainActor
private final class StrokeRequestLog {
    var pageIDs: [String] = []
}

/// #252: Eine Seite, die auf der Platte liegt, sich aber nicht lesen lässt, wird nie abgeglichen und nie überschrieben.
/// Sonst plante der Abgleich mit einem leeren Stand `stroke.remove` für alle Striche am Core.
@MainActor
final class InkUnreadablePageTests: XCTestCase {
    private let pageID = "019a4e14-0000-7000-8000-0000000000b1"
    private let garbage = Data("das ist keine plist".utf8)

    private func makeRoot() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("unreadable-\(UUID().uuidString)", isDirectory: true)
    }

    private func stroke(_ y: CGFloat) -> PKStroke {
        let points = (0..<6).map { index in
            PKStrokePoint(
                location: CGPoint(x: 100 + CGFloat(index) * 10, y: y), timeOffset: TimeInterval(index) * 0.016,
                size: CGSize(width: 3, height: 3), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        let path = PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSince1970: 1_762_246_500))
        return PKStroke(ink: PKInk(.pen, color: .black), path: path)
    }

    /// Schreibt Bytes als `page.plist` der Seite und liefert deren URL
    @discardableResult
    private func writePlist(_ data: Data, root: URL, pageID: String? = nil) throws -> URL {
        let folder = root.appendingPathComponent(pageID ?? self.pageID, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("page.plist")
        try data.write(to: url)
        return url
    }

    private func strokesBody(_ pageID: String) -> String {
        "{\"page_id\":\"\(pageID)\",\"stream_op_id\":null,\"stream_seq\":0,\"strokes\":[]}"
    }

    // MARK: Ablage

    func testCorruptPlistIsUnreadable() throws {
        let root = makeRoot()
        try writePlist(garbage, root: root)
        let snapshot = FileInkPageStore(root: root).load(pageID: pageID)
        XCTAssertTrue(snapshot.unreadable)
        XCTAssertNil(snapshot.ink)
    }

    func testMissingFilesAreAnEmptyReadableSnapshot() {
        let snapshot = FileInkPageStore(root: makeRoot()).load(pageID: pageID)
        XCTAssertFalse(snapshot.unreadable)
        XCTAssertNil(snapshot.ink)
        XCTAssertNil(snapshot.highlight)
        XCTAssertFalse(snapshot.needsReconcile)
    }

    func testFolderWithoutAnyFileIsStillReadable() throws {
        let root = makeRoot()
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent(pageID, isDirectory: true), withIntermediateDirectories: true)
        XCTAssertFalse(FileInkPageStore(root: root).load(pageID: pageID).unreadable)
    }

    func testPlistThatCannotBeReadAsAFileIsUnreadable() throws {
        // Ein Ordner statt der Datei: vorhanden, aber nicht lesbar
        let root = makeRoot()
        let folder = root.appendingPathComponent(pageID, isDirectory: true)
        try FileManager.default.createDirectory(
            at: folder.appendingPathComponent("page.plist", isDirectory: true), withIntermediateDirectories: true)
        XCTAssertTrue(FileInkPageStore(root: root).load(pageID: pageID).unreadable)
    }

    func testCorruptLegacyFilesAreUnreadable() throws {
        let root = makeRoot()
        let folder = root.appendingPathComponent(pageID, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try garbage.write(to: folder.appendingPathComponent("ids.json"))
        XCTAssertTrue(FileInkPageStore(root: root).load(pageID: pageID).unreadable)
    }

    func testReadableLegacyFilesStayReadable() throws {
        let root = makeRoot()
        let folder = root.appendingPathComponent(pageID, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let drawing = PKDrawing(strokes: [stroke(100)])
        try drawing.dataRepresentation().write(to: folder.appendingPathComponent("ink.pkdrawing"))
        let snapshot = FileInkPageStore(root: root).load(pageID: pageID)
        XCTAssertFalse(snapshot.unreadable)
        XCTAssertNotNil(snapshot.ink)
    }

    // MARK: Modell

    func testModelOfAnUnreadablePageIsLockedAndNeverWrites() throws {
        let root = makeRoot()
        let url = try writePlist(garbage, root: root)
        let model = InkPageModel(pageID: pageID, store: FileInkPageStore(root: root), saveDelay: .seconds(3600))
        XCTAssertTrue(model.isUnreadable)

        // Änderungen werden nicht angenommen, nichts markiert, nichts gespeichert
        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [stroke(100)]))
        XCTAssertTrue(model.inkDrawing.strokes.isEmpty)
        model.markNeedsReconcile()
        XCTAssertFalse(model.needsReconcile)
        model.undo()
        model.redo()
        model.saveNow()
        XCTAssertFalse(model.saveFailed)
        XCTAssertEqual(try Data(contentsOf: url), garbage)
    }

    func testDrawingDataPencilKitCannotReadIsUnreadable() throws {
        let store = FakeInkPageStore()
        store.snapshots[pageID] = InkPageSnapshot(ink: Data("kaputt".utf8))
        let model = InkPageModel(pageID: pageID, store: store, saveDelay: .seconds(3600))
        XCTAssertTrue(model.isUnreadable)
        model.saveNow()
        XCTAssertEqual(store.saveCount, 0)
    }

    func testModelOfAMissingPageStillWorks() throws {
        let store = FileInkPageStore(root: makeRoot())
        let model = InkPageModel(pageID: pageID, store: store, saveDelay: .seconds(3600))
        XCTAssertFalse(model.isUnreadable)
        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [stroke(100)]))
        model.saveNow()
        XCTAssertFalse(store.load(pageID: pageID).unreadable)
        XCTAssertNotNil(store.load(pageID: pageID).ink)
    }

    func testFlagStaysAsItIsOnAnUnreadablePage() throws {
        let store = FakeInkPageStore()
        var snapshot = InkPageSnapshot()
        snapshot.unreadable = true
        snapshot.needsReconcile = true
        store.snapshots[pageID] = snapshot
        let model = InkPageModel(pageID: pageID, store: store, saveDelay: .seconds(3600))
        model.reconcileFinished()
        XCTAssertTrue(model.needsReconcile)
        XCTAssertEqual(store.saveCount, 0)
    }

    // MARK: Abgleich

    func testEngineDoesNotReconcileAnUnreadablePage() async throws {
        let h = SyncHarness()
        let root = h.directory.appendingPathComponent("Ink")
        let url = try writePlist(garbage, root: root, pageID: h.binding.pageID)
        let model = InkPageModel(
            pageID: h.binding.pageID, store: FileInkPageStore(root: root), saveDelay: .seconds(3600))
        h.transport.replies = [.http(status: 200, body: "{}")]
        h.factory.configure = { socket, _ in socket.epoch = "epoch-1" }
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
        await h.clock.settle()
        let requestsBefore = h.transport.requests.count

        let result = await h.engine.reconcile(page: model, binding: h.binding)

        XCTAssertEqual(result, .skipped)
        XCTAssertEqual(h.transport.requests.count, requestsBefore, "kein Abruf der Striche")
        XCTAssertEqual(h.engine.pendingCount, 0, "nichts eingereiht")
        let kinds = h.factory.sockets.flatMap { $0.ops.compactMap { $0.object["kind"] as? String } }
        XCTAssertFalse(kinds.contains("stroke.remove"))
        XCTAssertEqual(try Data(contentsOf: url), garbage)
    }

    func testBackgroundPassSkipsTheUnreadablePageAndStillReconcilesTheOthers() async throws {
        let h = SyncHarness()
        let root = h.directory.appendingPathComponent("Ink")
        let pages = FileInkPageStore(root: root)
        let good = "019a4e14-0000-7000-8000-0000000000b2"
        h.library.upsert(
            LibraryPage(
                id: good, notebookID: h.binding.notebookID, index: 2, template: .blanko, widthPt: 595, heightPt: 842,
                sessionID: nil, backgroundSlideID: nil, attachedSlideID: nil, version: 1, createQueued: true,
                needsReconcile: false, deletedAtMS: nil, deleteQueued: false))
        let url = try writePlist(garbage, root: root, pageID: h.binding.pageID)
        let seed = InkPageModel(pageID: good, store: pages, saveDelay: .seconds(3600))
        seed.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [stroke(100)]))
        seed.saveNow()

        let clock = h.clock
        let service = InkLibraryService(
            store: h.library, sync: h.engine, client: h.client, pageStore: pages,
            now: { clock.date }, graceSleep: { try await clock.sleep($0) })
        let log = StrokeRequestLog()
        let notebookID = h.binding.notebookID
        let first = h.binding.pageID
        let transport = h.transport
        transport.replies = [.http(status: 200, body: "{}")]
        transport.duringRequest = { [self] request in
            let path = request.url?.path ?? ""
            if path.hasSuffix("/strokes") {
                let id = path.split(separator: "/").dropLast().last.map(String.init) ?? ""
                log.pageIDs.append(id)
                transport.replies = [.http(status: 200, body: strokesBody(id))]
            } else if path.hasSuffix("/pages") {
                let items = [first, good].enumerated().map {
                    LibraryFixtures.pageJSON(id: $0.element, notebookID: notebookID, index: $0.offset + 1)
                }
                let body =
                    "{\"items\":[\(items.joined(separator: ","))],\"notebook_id\":\"\(notebookID)\",\"stream_op_id\":null,\"stream_seq\":0}"
                transport.replies = [.http(status: 200, body: body)]
            } else {
                transport.replies = [.http(status: 200, body: "{}")]
            }
        }
        h.factory.configure = { socket, _ in socket.epoch = "epoch-1" }
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
        await h.clock.settle()

        h.library.markAllNeedReconcile()
        service.startBackgroundReconcile(afterRestore: true)
        let done = await eventually { log.pageIDs.contains(good) && !service.isBackgroundReconcileRunning }
        XCTAssertTrue(done)
        await h.clock.settle()

        // Die lesbare Seite wurde abgeglichen, nach der kaputten wurde nicht einmal gefragt
        XCTAssertEqual(log.pageIDs, [good])
        XCTAssertEqual(try Data(contentsOf: url), garbage)
        XCTAssertEqual(h.library.page(first)?.needsReconcile, true, "Flag bleibt stehen")
        XCTAssertEqual(h.library.page(good)?.needsReconcile, false)
        let kinds = h.factory.sockets.flatMap { $0.ops.compactMap { $0.object["kind"] as? String } }
        XCTAssertFalse(kinds.contains("stroke.remove"))
        // Die kaputte Seite zählt nicht als offen: Die Zeile zeigt nur noch den ehrlichen Hinweis
        XCTAssertEqual(service.pagesNeedingReconcile, 0)
        XCTAssertEqual(service.unreadablePagesNeedingReconcile, 1)
        XCTAssertEqual(
            service.backgroundReconcile,
            InkLibraryService.BackgroundReconcile(remaining: 0, afterRestore: false, unreadable: 1))
    }

    func testOpeningAnUnreadablePageTakesItOutOfTheCountUntilItReadsAgain() throws {
        let h = SyncHarness()
        let root = h.directory.appendingPathComponent("Ink")
        let pages = FileInkPageStore(root: root)
        let url = try writePlist(garbage, root: root, pageID: h.binding.pageID)
        let clock = h.clock
        let service = InkLibraryService(
            store: h.library, sync: h.engine, client: h.client, pageStore: pages,
            now: { clock.date }, graceSleep: { try await clock.sleep($0) })
        h.library.markAllNeedReconcile()
        XCTAssertEqual(service.pagesNeedingReconcile, 1)

        service.setOpenPage(InkPageModel(pageID: h.binding.pageID, store: pages, saveDelay: .seconds(3600)))
        XCTAssertEqual(service.pagesNeedingReconcile, 0)
        XCTAssertEqual(service.unreadablePagesNeedingReconcile, 1)

        // Lässt sich die Seite wieder lesen, zählt sie wieder als offen
        try FileManager.default.removeItem(at: url)
        service.setOpenPage(InkPageModel(pageID: h.binding.pageID, store: pages, saveDelay: .seconds(3600)))
        XCTAssertEqual(service.pagesNeedingReconcile, 1)
        XCTAssertEqual(service.unreadablePagesNeedingReconcile, 0)
    }

    func testHomeLineNamesUnreadablePagesSeparately() {
        XCTAssertEqual(
            HomeTexts.reconcileLine(remaining: 0, afterRestore: false, unreadable: 1),
            "1 Seite konnte nicht gelesen werden")
        XCTAssertEqual(
            HomeTexts.reconcileLine(remaining: 2, afterRestore: true, unreadable: 3),
            "Mac wiederhergestellt · 2 Seiten werden abgeglichen · 3 Seiten konnten nicht gelesen werden")
        XCTAssertEqual(
            HomeTexts.reconcileLine(remaining: 1, afterRestore: true), "Mac wiederhergestellt · 1 Seite wird abgeglichen")
    }

    func testMissingFileOfANewPageIsStillReconciledAsEmpty() async throws {
        let h = SyncHarness()
        let model = InkPageModel(
            pageID: h.binding.pageID, store: FileInkPageStore(root: h.directory.appendingPathComponent("Ink")),
            saveDelay: .seconds(3600))
        XCTAssertFalse(model.isUnreadable)
        h.transport.replies = [.http(status: 200, body: strokesBody(h.binding.pageID))]
        h.factory.configure = { socket, _ in socket.epoch = "epoch-1" }
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
        await h.clock.settle()
        h.transport.replies = [.http(status: 200, body: strokesBody(h.binding.pageID))]

        let result = await h.engine.reconcile(page: model, binding: h.binding)
        XCTAssertEqual(result, .done)
    }
}
