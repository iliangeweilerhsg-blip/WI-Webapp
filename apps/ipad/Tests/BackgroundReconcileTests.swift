import PencilKit
import XCTest

@testable import StudienGehirn

/// Aufbau für den Hintergrund-Abgleich nach einer Wiederherstellung (UX-46): ein Notizbuch mit drei Seiten, die
/// Antworten des Core nach Pfad, jede Anfrage nach Strichen wird mitgeschrieben.
@MainActor
private final class BackgroundReconcileRig {
    let h = SyncHarness()
    let service: InkLibraryService
    let pageStore: FileInkPageStore
    let notebookID: String
    let p1: String
    let p2 = "019a4e14-0000-7000-8000-0000000000b2"
    let p3 = "019a4e14-0000-7000-8000-0000000000b3"
    /// Seiten in der Reihenfolge, in der der Core nach ihren Strichen gefragt wurde
    private(set) var strokeRequests: [String] = []
    /// Stand des Fortschritts bei jeder Anfrage nach Strichen
    private(set) var progressAtRequest: [InkLibraryService.BackgroundReconcile?] = []
    /// Läuft in der Anfrage nach den Strichen einer Seite, bevor die Antwort kommt
    var onStrokesRequest: (@MainActor (String) async -> Void)?
    /// Seiten, die der wiederhergestellte Core nicht kennt: `GET /pages/{id}/strokes` → 404, fehlen in der Seitenliste
    var unknownToCore = Set<String>()
    /// Seiten, deren Striche der Core mit 500 ablehnt
    var failingStrokes = Set<String>()

    init() {
        notebookID = h.binding.notebookID
        p1 = h.binding.pageID
        pageStore = FileInkPageStore(root: h.directory.appendingPathComponent("Ink"))
        let clock = h.clock
        service = InkLibraryService(
            store: h.library, sync: h.engine, client: h.client, pageStore: pageStore,
            now: { clock.date }, graceSleep: { try await clock.sleep($0) })
        for (offset, id) in [p2, p3].enumerated() {
            h.library.upsert(
                LibraryPage(
                    id: id, notebookID: notebookID, index: offset + 2, template: .blanko, widthPt: 595, heightPt: 842,
                    sessionID: nil, backgroundSlideID: nil, attachedSlideID: nil, version: 1, createQueued: true,
                    needsReconcile: false, deletedAtMS: nil, deleteQueued: false))
        }
        h.transport.replies = [.http(status: 200, body: "{}")]
        h.transport.duringRequest = { [unowned self] request in
            let path = request.url?.path ?? ""
            if path.hasSuffix("/strokes") {
                let pageID = path.split(separator: "/").dropLast().last.map(String.init) ?? ""
                strokeRequests.append(pageID)
                progressAtRequest.append(service.backgroundReconcile)
                await onStrokesRequest?(pageID)
                if unknownToCore.contains(pageID) {
                    h.transport.replies = [.http(status: 404, body: Fixtures.apiError("page_not_found"))]
                } else if failingStrokes.contains(pageID) {
                    h.transport.replies = [.http(status: 500, body: Fixtures.apiError("internal"))]
                } else {
                    h.transport.replies = [
                        .http(
                            status: 200,
                            body: "{\"page_id\":\"\(pageID)\",\"stream_op_id\":null,\"stream_seq\":0,\"strokes\":[]}")
                    ]
                }
            } else if path.hasSuffix("/pages") {
                let items = [p1, p2, p3].enumerated().filter { !unknownToCore.contains($0.element) }.map {
                    LibraryFixtures.pageJSON(id: $0.element, notebookID: notebookID, index: $0.offset + 1)
                }
                let body =
                    "{\"items\":[\(items.joined(separator: ","))],\"notebook_id\":\"\(notebookID)\",\"stream_op_id\":null,\"stream_seq\":0}"
                h.transport.replies = [.http(status: 200, body: body)]
            } else {
                h.transport.replies = [.http(status: 200, body: "{}")]
            }
        }
    }

    /// Der Mac wurde wiederhergestellt: Beim nächsten `welcome` ist die `db_epoch` neu
    func startWithNewEpoch(silent: Bool = false) {
        h.library.setDBEpoch("epoch-alt")
        configureSockets(silent: silent)
        h.start()
    }

    func configureSockets(silent: Bool = false) {
        h.factory.configure = { socket, _ in
            socket.epoch = "epoch-neu"
            if silent {
                socket.opPolicy = { _, _, _ in .silent }
            }
        }
    }

    func binding(_ pageID: String) throws -> InkBinding {
        try XCTUnwrap(service.target(forPage: pageID))
    }

    func needsReconcile(_ pageID: String) -> Bool {
        h.library.page(pageID)?.needsReconcile ?? false
    }

    func stroke(_ y: CGFloat, createdAt: TimeInterval) -> PKStroke {
        let points = (0..<6).map { index in
            PKStrokePoint(
                location: CGPoint(x: 100 + CGFloat(index) * 10, y: y), timeOffset: TimeInterval(index) * 0.016,
                size: CGSize(width: 3, height: 3), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        let path = PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSince1970: createdAt))
        return PKStroke(ink: PKInk(.pen, color: .black), path: path)
    }

    /// Schreibt Striche so auf die Platte, wie die Ansicht es beim Verlassen der Seite tut
    @discardableResult
    func seedPage(_ pageID: String, strokes: [PKStroke]) -> InkPageModel {
        let model = InkPageModel(pageID: pageID, store: pageStore, saveDelay: .seconds(3600))
        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: strokes))
        model.saveNow()
        return model
    }

    /// Das Modell, das die Ansicht für die offene Seite hält
    func liveModel(_ pageID: String) throws -> InkPageModel {
        let binding = try binding(pageID)
        let model = InkPageModel(
            pageID: pageID, store: pageStore, saveDelay: .seconds(3600),
            outboxMark: h.engine.outboxMark(forPage: pageID))
        model.onStrokeChanges = { [engine = h.engine] changes in
            _ = engine.enqueue(changes, binding: binding)
        }
        return model
    }

    func opKinds(_ socketIndex: Int = 0) -> [String] {
        h.factory.sockets[socketIndex].ops.compactMap { $0.object["kind"] as? String }
    }

    /// Arten der gesendeten Operationen einer Seite, in der Reihenfolge des Sendens
    func opKinds(forPage pageID: String, socketIndex: Int = 0) -> [String] {
        h.factory.sockets[socketIndex].ops.compactMap { op in
            guard let data = op.object["data"] as? [String: Any], data["page_id"] as? String == pageID else {
                return nil
            }
            return op.object["kind"] as? String
        }
    }

    /// Der Durchgang ist durch (oder abgebrochen)
    var passIdle: Bool { !service.isBackgroundReconcileRunning }

    func reload(_ pageID: String) -> InkPageModel {
        InkPageModel(pageID: pageID, store: pageStore, saveDelay: .seconds(3600))
    }

    var allDone: Bool {
        service.pagesNeedingReconcile == 0 && service.backgroundReconcile == nil
    }
}

@MainActor
final class BackgroundReconcileTests: XCTestCase {
    func testAllFlaggedPagesAreReconciledAndTheOpenPageComesFirst() async throws {
        let rig = BackgroundReconcileRig()
        let live = try rig.liveModel(rig.p3)
        rig.service.setOpenPage(live)

        rig.startWithNewEpoch()
        let done = await eventually { rig.strokeRequests.count == 3 && rig.allDone }
        XCTAssertTrue(done)

        // Offene Seite zuerst, dann nach `index`
        XCTAssertEqual(rig.strokeRequests, [rig.p3, rig.p1, rig.p2])
        for id in [rig.p1, rig.p2, rig.p3] {
            XCTAssertFalse(rig.needsReconcile(id), id)
        }
    }

    func testAnInterruptedPassContinuesAfterTheNextWelcome() async throws {
        let rig = BackgroundReconcileRig()
        var dropped = false
        rig.onStrokesRequest = { [unowned rig] pageID in
            guard pageID == rig.p2, !dropped else { return }
            dropped = true
            // Die Verbindung reißt mitten im Durchgang
            rig.h.factory.sockets[0].fail(.closed(code: 4503))
            _ = await eventually { rig.h.engine.state == .waiting }
        }
        rig.startWithNewEpoch()

        let stopped = await eventually { rig.strokeRequests.count == 2 && rig.passIdle }
        XCTAssertTrue(stopped)
        await rig.h.clock.settle()
        // Seite 3 blieb markiert, es lief nichts weiter
        XCTAssertEqual(rig.strokeRequests, [rig.p1, rig.p2])
        XCTAssertTrue(rig.needsReconcile(rig.p3))
        XCTAssertEqual(rig.service.pagesNeedingReconcile, 1)
        // Die Zeile bleibt mit der Restzahl stehen: Der Abgleich ist pausiert, nicht fertig
        XCTAssertEqual(
            rig.service.backgroundReconcile, InkLibraryService.BackgroundReconcile(remaining: 1, afterRestore: true))

        // Neues `welcome` mit derselben `db_epoch`: Der Durchgang macht mit der Rest-Seite weiter
        await rig.h.clock.advance(1.5)
        let resumed = await eventually { rig.strokeRequests.count == 3 && rig.allDone }
        XCTAssertTrue(resumed)
        XCTAssertEqual(rig.strokeRequests, [rig.p1, rig.p2, rig.p3])
        XCTAssertFalse(rig.needsReconcile(rig.p3))
    }

    func testThePassSkipsAPageThatTheViewIsReconcilingRightNow() async throws {
        let rig = BackgroundReconcileRig()
        let live = try rig.liveModel(rig.p3)
        var held = true
        rig.onStrokesRequest = { [unowned rig] pageID in
            // Die Ansicht wartet auf den Core: Nur ihre erste Anfrage für Seite 3 hängt
            guard pageID == rig.p3 else { return }
            while held { await _Concurrency.Task.yield() }
        }
        // Erste `db_epoch`: Es ist nichts markiert, der Durchgang beim `welcome` findet nichts
        rig.configureSockets()
        rig.h.start()
        let online = await eventually { rig.h.engine.state == .online }
        XCTAssertTrue(online)
        await rig.h.clock.settle()

        rig.h.library.markAllNeedReconcile()
        rig.service.setOpenPage(live)
        let viewBinding = try rig.binding(rig.p3)
        let engine = rig.h.engine
        let view = _Concurrency.Task { await engine.reconcile(page: live, binding: viewBinding) }
        let viewAsking = await eventually { rig.strokeRequests == [rig.p3] }
        XCTAssertTrue(viewAsking)

        rig.service.startBackgroundReconcile(afterRestore: true)
        let othersDone = await eventually { rig.strokeRequests.count == 3 && rig.passIdle }
        XCTAssertTrue(othersDone)
        // Der Durchgang ist durch, Seite 3 gehört noch der Ansicht. Die Zeile zählt sie noch.
        XCTAssertTrue(rig.needsReconcile(rig.p3))
        XCTAssertEqual(rig.strokeRequests.filter { $0 == rig.p3 }.count, 1)
        XCTAssertEqual(rig.service.backgroundReconcile?.remaining, 1)

        held = false
        let result = await view.value
        XCTAssertEqual(result, .done)
        XCTAssertFalse(rig.needsReconcile(rig.p3))
        XCTAssertEqual(rig.strokeRequests.filter { $0 == rig.p3 }.count, 1)
        // Der Abgleich der Ansicht zählt mit: Die Zeile verschwindet
        XCTAssertTrue(rig.allDone)
    }

    func testAPageThatIsAlreadyBeingReconciledIsNotReconciledTwice() async throws {
        let rig = BackgroundReconcileRig()
        rig.configureSockets()
        rig.h.start()
        _ = await eventually { rig.h.engine.state == .online }
        let model = rig.reload(rig.p1)
        let binding = try rig.binding(rig.p1)
        var held = true
        rig.onStrokesRequest = { _ in
            while held { await _Concurrency.Task.yield() }
        }
        let engine = rig.h.engine
        let first = _Concurrency.Task { await engine.reconcile(page: model, binding: binding) }
        _ = await eventually { rig.strokeRequests.count == 1 }
        XCTAssertTrue(engine.isReconciling(pageID: rig.p1))

        let second = await engine.reconcile(page: model, binding: binding)
        XCTAssertEqual(second, .skipped)
        XCTAssertEqual(rig.strokeRequests.count, 1)
        held = false
        _ = await first.value
        XCTAssertFalse(engine.isReconciling(pageID: rig.p1))
    }

    func testTheProgressCountsDownAndTheLineDisappears() async throws {
        let rig = BackgroundReconcileRig()
        rig.startWithNewEpoch()
        let done = await eventually { rig.strokeRequests.count == 3 && rig.allDone }
        XCTAssertTrue(done)

        let remaining = rig.progressAtRequest.map { $0?.remaining }
        XCTAssertEqual(remaining, [3, 2, 1])
        XCTAssertTrue(rig.progressAtRequest.allSatisfy { $0?.afterRestore == true })
        XCTAssertNil(rig.service.backgroundReconcile)
        XCTAssertEqual(rig.service.pagesNeedingReconcile, 0)

        XCTAssertEqual(
            HomeTexts.reconcileLine(remaining: 3, afterRestore: true),
            "Mac wiederhergestellt · 3 Seiten werden abgeglichen")
        XCTAssertEqual(
            HomeTexts.reconcileLine(remaining: 1, afterRestore: true),
            "Mac wiederhergestellt · 1 Seite wird abgeglichen")
        XCTAssertEqual(HomeTexts.reconcileLine(remaining: 2, afterRestore: false), "2 Seiten werden abgeglichen")
    }

    func testNoPassRunsWithoutAFlaggedPage() async throws {
        let rig = BackgroundReconcileRig()
        // Erste `db_epoch`: nichts markiert
        rig.configureSockets()
        rig.h.start()
        _ = await eventually { rig.h.engine.state == .online }
        await rig.h.clock.settle()
        XCTAssertTrue(rig.strokeRequests.isEmpty)
        XCTAssertNil(rig.service.backgroundReconcile)
    }

    // MARK: Lokale Striche

    func testLocalStrokeThatWasNeverQueuedIsSentAndStaysOnDisk() async throws {
        let rig = BackgroundReconcileRig()
        rig.seedPage(rig.p2, strokes: [rig.stroke(100, createdAt: 1_762_246_500)])

        // Der wiederhergestellte Core hat die Seite ohne Striche
        rig.startWithNewEpoch()
        let done = await eventually { rig.strokeRequests.count == 3 && rig.allDone }
        XCTAssertTrue(done)
        let sent = await eventually { rig.opKinds().filter { $0 == "stroke.add" }.count == 1 }
        XCTAssertTrue(sent)

        XCTAssertFalse(rig.opKinds().contains("stroke.remove"))
        XCTAssertNotNil(rig.pageStore.load(pageID: rig.p2).ink)
        XCTAssertEqual(rig.reload(rig.p2).inkDrawing.strokes.count, 1)
    }

    func testWaitingStrokeIsNeitherSentTwiceNorRemoved() async throws {
        let rig = BackgroundReconcileRig()
        let seeded = rig.seedPage(rig.p2, strokes: [rig.stroke(100, createdAt: 1_762_246_500)])
        // Der Strich wartet in der Warteschlange, der Mac bestätigt nichts
        let queued = rig.h.engine.enqueue(
            seeded.neutralStrokes().map { .upsert($0) }, binding: try rig.binding(rig.p2))
        XCTAssertTrue(queued)

        rig.startWithNewEpoch(silent: true)
        let done = await eventually { rig.strokeRequests.count == 3 && rig.allDone }
        XCTAssertTrue(done)
        await rig.h.clock.settle()

        XCTAssertEqual(rig.opKinds().filter { $0 == "stroke.add" }.count, 1)
        XCTAssertFalse(rig.opKinds().contains("stroke.remove"))
        XCTAssertEqual(rig.h.engine.pendingOpIDs(kind: "stroke.add", pageID: rig.p2).count, 1)
        XCTAssertEqual(rig.reload(rig.p2).inkDrawing.strokes.count, 1)
    }

    func testStrokeWrittenWhileThePassAsksTheCoreIsNotRemoved() async throws {
        let rig = BackgroundReconcileRig()
        let first = rig.stroke(100, createdAt: 1_762_246_500)
        let second = rig.stroke(200, createdAt: 1_762_246_501)
        rig.seedPage(rig.p2, strokes: [first])
        let live = try rig.liveModel(rig.p2)
        var opened = false
        rig.onStrokesRequest = { [unowned rig] pageID in
            guard pageID == rig.p2, !opened else { return }
            opened = true
            // Die Nutzerin öffnet die Seite, während der Durchgang auf den Core wartet, und schreibt
            rig.service.setOpenPage(live)
            live.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [first, second]))
        }

        rig.startWithNewEpoch()
        // Seite 2 wird zweimal gefragt: erst mit dem kurz geladenen Modell (verworfen), dann mit dem der Ansicht
        let done = await eventually { rig.strokeRequests.count == 4 && rig.passIdle }
        XCTAssertTrue(done)
        XCTAssertEqual(rig.strokeRequests, [rig.p1, rig.p2, rig.p2, rig.p3])
        // Der veraltete Plan wurde verworfen, der zweite Versuch nahm das Modell der Ansicht: nichts entfernt
        XCTAssertFalse(rig.needsReconcile(rig.p2))
        XCTAssertTrue(rig.allDone)
        await rig.h.clock.settle()
        XCTAssertFalse(rig.opKinds().contains("stroke.remove"))
        // Beide Striche sind unterwegs (der zweite kam schon beim Schreiben, je nach `ack` auch doppelt: Upsert)
        XCTAssertGreaterThanOrEqual(rig.opKinds(forPage: rig.p2).filter { $0 == "stroke.add" }.count, 2)

        // Ein späterer Abgleich der Ansicht entfernt nichts: Beide Striche bleiben
        let result = await rig.h.engine.reconcile(page: live, binding: try rig.binding(rig.p2))
        XCTAssertEqual(result, .done)
        await rig.h.clock.settle()
        XCTAssertFalse(rig.opKinds().contains("stroke.remove"))
        XCTAssertEqual(live.inkDrawing.strokes.count, 2)
        XCTAssertFalse(rig.needsReconcile(rig.p2))
    }

    func testStaleModelDoesNotOverwriteThePageOnDiskWhenItWasOpened() async throws {
        let rig = BackgroundReconcileRig()
        let first = rig.stroke(100, createdAt: 1_762_246_500)
        let second = rig.stroke(200, createdAt: 1_762_246_501)
        rig.seedPage(rig.p2, strokes: [first])
        let live = try rig.liveModel(rig.p2)
        var opened = false
        rig.onStrokesRequest = { [unowned rig] pageID in
            guard pageID == rig.p2, !opened else { return }
            opened = true
            rig.service.setOpenPage(live)
            live.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [first, second]))
            live.saveNow()
        }

        rig.startWithNewEpoch()
        let done = await eventually { rig.strokeRequests.count == 4 && rig.passIdle }
        XCTAssertTrue(done)
        await rig.h.clock.settle()

        // Auf der Platte steht der Stand der Ansicht mit beiden Strichen
        XCTAssertEqual(rig.reload(rig.p2).inkDrawing.strokes.count, 2)
    }

    // MARK: Wiederherstellung auf einen älteren Stand

    /// Der Kernfall von UX-46: Seite 2 wurde vor langer Zeit angelegt, ihre Striche hat der Core bestätigt (die
    /// Warteschlange ist leer). Der Mac kommt auf ein Backup von davor zurück und kennt die Seite nicht mehr.
    func testRestoreRecreatesAPageTheCoreNoLongerKnowsWithItsConfirmedStrokes() async throws {
        let rig = BackgroundReconcileRig()
        rig.seedPage(
            rig.p2,
            strokes: [rig.stroke(100, createdAt: 1_762_246_500), rig.stroke(200, createdAt: 1_762_246_501)])
        XCTAssertEqual(rig.h.engine.pendingCount, 0)
        rig.unknownToCore = [rig.p2]

        rig.startWithNewEpoch()
        let done = await eventually { rig.strokeRequests.count == 3 && rig.allDone }
        XCTAssertTrue(done)
        let sent = await eventually { rig.opKinds(forPage: rig.p2).filter { $0 == "stroke.add" }.count == 2 }
        XCTAssertTrue(sent)

        // Erst die Seite, dann ihre Striche, nichts entfernt
        let kinds = rig.opKinds(forPage: rig.p2)
        XCTAssertEqual(kinds.first, "page.create")
        XCTAssertFalse(kinds.contains("stroke.remove"))
        XCTAssertFalse(rig.opKinds().contains("stroke.remove"))
        // Die Seiten, die der Core kennt, bekommen kein `page.create`
        XCTAssertFalse(rig.opKinds(forPage: rig.p1).contains("page.create"))
        XCTAssertFalse(rig.opKinds(forPage: rig.p3).contains("page.create"))
        XCTAssertFalse(rig.needsReconcile(rig.p2))
        XCTAssertEqual(rig.reload(rig.p2).inkDrawing.strokes.count, 2)
    }

    func testAPageTheCoreRejectsDoesNotStopThePass() async throws {
        let rig = BackgroundReconcileRig()
        rig.failingStrokes = [rig.p2]

        rig.startWithNewEpoch()
        let done = await eventually { rig.strokeRequests.count == 3 && rig.passIdle }
        XCTAssertTrue(done)
        // Seite 3 kommt trotzdem dran, Seite 2 bleibt markiert und die Zeile zählt sie
        XCTAssertEqual(rig.strokeRequests, [rig.p1, rig.p2, rig.p3])
        XCTAssertFalse(rig.needsReconcile(rig.p3))
        XCTAssertTrue(rig.needsReconcile(rig.p2))
        XCTAssertEqual(rig.service.backgroundReconcile?.remaining, 1)
    }
}
