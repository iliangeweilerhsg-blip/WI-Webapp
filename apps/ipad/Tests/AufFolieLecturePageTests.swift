import PencilKit
import XCTest

@testable import StudienGehirn

/// #268: „Auf Folie“ ohne verfügbare Folie schreibt nie auf einer alten Seite weiter, und Folienseiten aus einer
/// früheren Session werden nicht wiederverwendet.
@MainActor
final class AufFolieLecturePageTests: XCTestCase {
    private let notebookID = "019a4e14-0000-7000-8000-0000000000a2"
    private let firstPageID = "019a4e14-0000-7000-8000-0000000000b1"
    private let moduleID = LibraryFixtures.moduleID
    private let runningID = "019a4e14-0000-7000-8000-0000000000d1"
    private let lastWeekID = "019a4e14-0000-7000-8000-0000000000d0"
    private let runningStartMS = 1_794_384_000_000
    private let lastWeekStartMS = 1_793_779_200_000
    private let oldSlidePageID = "019a4e14-0000-7000-8000-0000000000c1"
    private let slide1 = SlideRef(id: "019a4e14-0000-7000-8000-000000000041", index: 1, widthPt: 960, heightPt: 540)

    private func makeHarness() -> SyncHarness {
        SyncHarness(health: [
            .http(
                status: 200,
                body: LibraryFixtures.notebookJSON(id: notebookID, kind: "vorlesung", title: "Vorlesung"))
        ])
    }

    private func makeService(_ h: SyncHarness, pageStore: FakeInkPageStore = FakeInkPageStore()) -> InkLibraryService {
        InkLibraryService(
            store: h.library, sync: h.engine, client: h.client, pageStore: pageStore, now: { h.clock.date },
            graceSleep: { try await h.clock.sleep($0) })
    }

    private func brief(deck: String?) -> SessionBrief {
        SessionBrief(
            id: runningID, moduleID: moduleID, state: "laeuft", startedAtMS: runningStartMS, slideDeckID: deck,
            deleted: false, updatedAtMS: 1)
    }

    private func runLecture(_ h: SyncHarness, _ service: InkLibraryService, deck: String?) async {
        service.attachFollower()
        h.factory.configure = { socket, _ in socket.opPolicy = { _, _, _ in .silent } }
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
        await service.follow(session: brief(deck: deck))
        XCTAssertEqual(service.running?.id, runningID)
    }

    private func stroke(createdAt: TimeInterval) -> PKStroke {
        let points = (0..<6).map { index in
            PKStrokePoint(
                location: CGPoint(x: 100 + CGFloat(index) * 10, y: 100), timeOffset: TimeInterval(index) * 0.016,
                size: CGSize(width: 3, height: 3), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        let path = PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSince1970: createdAt))
        return PKStroke(ink: PKInk(.pen, color: .black), path: path)
    }

    private func neutralStrokes(for binding: InkBinding, createdAtMS: Int) -> [Stroke] {
        let model = InkPageModel(pageID: binding.pageID, store: FakeInkPageStore(), saveDelay: .seconds(3600))
        model.sessionStartedAt = binding.sessionStartMS.map { Date(timeIntervalSince1970: Double($0) / 1000) }
        model.canvasDidChange(
            layer: .ink, drawing: PKDrawing(strokes: [stroke(createdAt: Double(createdAtMS) / 1000)]))
        return model.neutralStrokes()
    }

    private func oldSlidePage() -> LibraryPage {
        LibraryPage(
            id: oldSlidePageID, notebookID: notebookID, index: 2, template: .folie, widthPt: 960, heightPt: 540,
            sessionID: lastWeekID, backgroundSlideID: slide1.id, attachedSlideID: nil, version: 1,
            createQueued: true, needsReconcile: false, deletedAtMS: nil, deleteQueued: false,
            sessionStartMS: lastWeekStartMS)
    }

    // MARK: Entscheidung der Ansicht

    func testSlideWritingNeedsTheModeAndAnAvailableSlide() {
        XCTAssertTrue(InkModeResolver.writesOnSlide(mode: .aufFolie, slideAvailable: true))
        // „Auf Folie“ als Standard, aber keine Folien oder erste Folie unbekannt: Logik der Vorlesungsseiten
        XCTAssertFalse(InkModeResolver.writesOnSlide(mode: .aufFolie, slideAvailable: false))
        XCTAssertFalse(InkModeResolver.writesOnSlide(mode: .freieSeite, slideAvailable: true))
        XCTAssertFalse(InkModeResolver.writesOnSlide(mode: nil, slideAvailable: true))
    }

    // MARK: Vorlesung ohne Folien im Modus „Auf Folie“

    func testALectureWithoutSlidesGetsANewLecturePageWithSessionAndStrokeTime() async throws {
        let h = makeHarness()
        let store = FakeInkPageStore()
        var old = try XCTUnwrap(h.library.page(firstPageID))
        old.sessionID = lastWeekID
        old.sessionStartMS = lastWeekStartMS
        h.library.upsert(old)
        store.snapshots[firstPageID] = InkPageSnapshot(ink: Data([1, 2, 3]))
        let service = makeService(h, pageStore: store)
        await runLecture(h, service, deck: nil)

        // Ohne Foliensatz ist „Auf Folie“ nicht verfügbar, `openLectureTarget` hängt die Seite an
        XCTAssertFalse(
            InkModeResolver.isAvailable(running: service.running, moduleID: moduleID, slideKnown: false))
        XCTAssertTrue(service.needsLecturePage(notebookID: notebookID))
        let target = try XCTUnwrap(service.openLectureTarget(notebookID: notebookID))
        XCTAssertNotEqual(target.pageID, firstPageID)
        XCTAssertEqual(service.page(target.pageID)?.sessionID, runningID)
        XCTAssertEqual(target.sessionStartMS, runningStartMS)

        let strokes = neutralStrokes(for: target, createdAtMS: runningStartMS + 90_000)
        XCTAssertEqual(strokes.count, 1)
        XCTAssertEqual(strokes[0].tStartMS, 90_000)
    }

    func testAFirstSlideThatIsStillUnknownIsNotAvailableEvenWithADeck() async throws {
        let h = makeHarness()
        let service = makeService(h)
        await runLecture(h, service, deck: "deck-1")
        XCTAssertFalse(
            InkModeResolver.isAvailable(running: service.running, moduleID: moduleID, slideKnown: false))
        XCTAssertTrue(InkModeResolver.isAvailable(running: service.running, moduleID: moduleID, slideKnown: true))
    }

    // MARK: Erste Folie wird später bekannt

    func testALaterKnownFirstSlideSwitchesOnlyAfterTheQuietPeriod() async {
        let clock = GateTestClock()
        let gate = SlideSwitchGate(now: { MainActor.assumeIsolated { clock.date } })
        // Der Nutzer schreibt gerade auf der Vorlesungsseite, dann wird die erste Folie bekannt
        gate.toolBegan()
        clock.advance(0.5)
        gate.finishTool()
        XCTAssertNil(gate.slideChanged(slide1))
        XCTAssertEqual(gate.pending, slide1)
        XCTAssertEqual(gate.releases, 0)

        await gate.awaitQuiet(sleep: { try await clock.sleep($0) })
        XCTAssertEqual(gate.releases, 1)
        XCTAssertEqual(gate.takeReleased(), slide1)
    }

    // MARK: Folienseiten und Sessions

    func testASlidePageFromAnOldSessionIsNotReused() async throws {
        let h = makeHarness()
        let service = makeService(h)
        h.library.upsert(oldSlidePage())
        await runLecture(h, service, deck: "deck-1")

        let page = try XCTUnwrap(service.slidePage(notebookID: notebookID, slide: slide1))
        XCTAssertNotEqual(page.id, oldSlidePageID)
        XCTAssertEqual(page.sessionID, runningID)
        XCTAssertEqual(page.sessionStartMS, runningStartMS)
        XCTAssertEqual(page.backgroundSlideID, slide1.id)
        XCTAssertEqual(page.template, .folie)
        // Die alte Seite bleibt unverändert
        XCTAssertEqual(service.page(oldSlidePageID)?.sessionID, lastWeekID)
        XCTAssertEqual(service.page(oldSlidePageID)?.sessionStartMS, lastWeekStartMS)

        // Striche auf der neuen Seite zählen ab dem Beginn der laufenden Session
        let binding = try XCTUnwrap(service.target(forPage: page.id))
        let strokes = neutralStrokes(for: binding, createdAtMS: runningStartMS + 30_000)
        XCTAssertEqual(strokes[0].tStartMS, 30_000)
    }

    func testASlidePageOfTheSameSessionIsReused() async throws {
        let h = makeHarness()
        let service = makeService(h)
        h.library.upsert(oldSlidePage())
        await runLecture(h, service, deck: "deck-1")

        let first = try XCTUnwrap(service.slidePage(notebookID: notebookID, slide: slide1))
        XCTAssertEqual(first.sessionID, runningID)
        let again = try XCTUnwrap(service.slidePage(notebookID: notebookID, slide: slide1))
        XCTAssertEqual(again.id, first.id)
        // Harness-Seite, alte Folienseite, neue Folienseite
        XCTAssertEqual(service.pages(inNotebook: notebookID).count, 3)
    }

    // MARK: #272 Folienseite offline in der Vorlesung angelegt, sofort öffnen

    /// UUIDv7 mit dem Zeitstempel `ms` (nur die ersten 48 Bit zählen für `createdDuring`)
    private func uuidV7(atMS ms: Int, tail: Int) -> String {
        let hex = String(format: "%012llx", ms)
        return "\(hex.prefix(8))-\(hex.suffix(4))-7000-8000-\(String(format: "%012llx", tail))"
    }

    private func sessionlessSlidePage(id: String) -> LibraryPage {
        LibraryPage(
            id: id, notebookID: notebookID, index: 2, template: .folie, widthPt: 960, heightPt: 540,
            sessionID: nil, backgroundSlideID: slide1.id, attachedSlideID: nil, version: 1,
            createQueued: true, needsReconcile: false, deletedAtMS: nil, deleteQueued: false)
    }

    func testASessionlessSlidePageCreatedOfflineDuringTheLectureIsReused() async throws {
        let h = makeHarness()
        let service = makeService(h)
        let offlineID = uuidV7(atMS: runningStartMS + 60_000, tail: 0xf1)
        h.library.upsert(sessionlessSlidePage(id: offlineID))
        await runLecture(h, service, deck: "deck-1")

        let page = try XCTUnwrap(service.slidePage(notebookID: notebookID, slide: slide1))
        XCTAssertEqual(page.id, offlineID)
        // Keine neue Seite: Harness-Seite und die Offline-Folienseite
        XCTAssertEqual(service.pages(inNotebook: notebookID).count, 2)
    }

    func testASessionlessSlidePageFromBeforeTheLectureIsNotReused() async throws {
        let h = makeHarness()
        let service = makeService(h)
        let beforeID = uuidV7(atMS: runningStartMS - 60_000, tail: 0xf2)
        h.library.upsert(sessionlessSlidePage(id: beforeID))
        await runLecture(h, service, deck: "deck-1")

        let page = try XCTUnwrap(service.slidePage(notebookID: notebookID, slide: slide1))
        XCTAssertNotEqual(page.id, beforeID)
        XCTAssertEqual(page.sessionID, runningID)
        XCTAssertEqual(service.pages(inNotebook: notebookID).count, 3)
    }

    func testOpenSlideTargetOpensTheSlidePageWithTheRunningSessionTime() async throws {
        let h = makeHarness()
        let service = makeService(h)
        await runLecture(h, service, deck: "deck-1")

        // Die letzte Seite ist die Harness-Seite ohne Session; direkt die Folienseite öffnen
        let target = try XCTUnwrap(service.openSlideTarget(notebookID: notebookID, slide: slide1))
        XCTAssertNotEqual(target.pageID, firstPageID)
        XCTAssertEqual(service.page(target.pageID)?.backgroundSlideID, slide1.id)
        XCTAssertEqual(service.page(target.pageID)?.sessionID, runningID)
        XCTAssertEqual(target.sessionStartMS, runningStartMS)
        // Zweiter Aufruf: dieselbe Seite
        XCTAssertEqual(service.openSlideTarget(notebookID: notebookID, slide: slide1)?.pageID, target.pageID)
        XCTAssertNil(service.openSlideTarget(notebookID: "unbekannt", slide: slide1))
    }
}
