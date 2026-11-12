import PencilKit
import XCTest

@testable import StudienGehirn

/// #250: Erneut gesendete Striche behalten die Zeit ihrer eigenen Vorlesung. Eine andere, gerade laufende Session
/// desselben Moduls färbt alte Striche nie ein.
@MainActor
final class InkStrokeSessionTimeTests: XCTestCase {
    private let notebookID = "019a4e14-0000-7000-8000-0000000000a2"
    private let firstPageID = "019a4e14-0000-7000-8000-0000000000b1"
    private let moduleID = LibraryFixtures.moduleID
    private let runningID = "019a4e14-0000-7000-8000-0000000000d1"
    private let lastWeekID = "019a4e14-0000-7000-8000-0000000000d0"
    /// Beginn der laufenden Vorlesung (Uhr des Mac)
    private let runningStartMS = 1_794_384_000_000
    /// Beginn der Vorlesung der Vorwoche
    private let lastWeekStartMS = 1_793_779_200_000

    private func makeHarness() -> SyncHarness {
        SyncHarness(health: [
            .http(
                status: 200,
                body: LibraryFixtures.notebookJSON(id: notebookID, kind: "vorlesung", title: "Vorlesung"))
        ])
    }

    private func makeService(_ h: SyncHarness) -> InkLibraryService {
        InkLibraryService(
            store: h.library, sync: h.engine, client: h.client, pageStore: FakeInkPageStore(),
            now: { h.clock.date }, graceSleep: { try await h.clock.sleep($0) })
    }

    private func brief() -> SessionBrief {
        SessionBrief(
            id: runningID, moduleID: moduleID, state: "laeuft", startedAtMS: runningStartMS, slideDeckID: nil,
            deleted: false, updatedAtMS: 1)
    }

    /// Die Vorlesung läuft, der Core hat ihr Notizbuch genannt
    private func runLecture(_ h: SyncHarness, _ service: InkLibraryService) async {
        service.attachFollower()
        h.factory.configure = { socket, _ in socket.opPolicy = { _, _, _ in .silent } }
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
        await service.follow(session: brief())
        XCTAssertEqual(service.running?.id, runningID)
    }

    /// UUIDv7 mit dem Zeitpunkt `ms` (Uhr des iPad), `tail` unterscheidet Seiten
    private func uuidV7(ms: Int, tail: Int) -> String {
        let hex = String(format: "%012llx", UInt64(ms))
        let head = hex.prefix(8)
        let mid = hex.suffix(4)
        return "\(head)-\(mid)-7000-8000-" + String(format: "%012d", tail)
    }

    @discardableResult
    private func addPage(
        _ h: SyncHarness, id: String, sessionID: String?, sessionStartMS: Int?, index: Int
    ) -> String {
        h.library.upsert(
            LibraryPage(
                id: id, notebookID: notebookID, index: index, template: .blanko, widthPt: 595, heightPt: 842,
                sessionID: sessionID, backgroundSlideID: nil, attachedSlideID: nil, version: 1, createQueued: true,
                needsReconcile: true, deletedAtMS: nil, deleteQueued: false, sessionStartMS: sessionStartMS))
        return id
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

    /// Striche, wie der Abgleich sie plant: Das Modell bekommt den Start aus dem Schreibziel
    private func neutralStrokes(for binding: InkBinding, createdAtMS: Int) -> [Stroke] {
        let model = InkPageModel(pageID: binding.pageID, store: FakeInkPageStore(), saveDelay: .seconds(3600))
        model.sessionStartedAt = binding.sessionStartMS.map { Date(timeIntervalSince1970: Double($0) / 1000) }
        model.canvasDidChange(
            layer: .ink, drawing: PKDrawing(strokes: [stroke(createdAt: Double(createdAtMS) / 1000)]))
        return model.neutralStrokes()
    }

    // MARK: Restore, während eine andere Vorlesung desselben Moduls läuft

    func testRestoreDuringARunningLectureKeepsTheTimeOfTheOldPageSession() async throws {
        let h = makeHarness()
        let service = makeService(h)
        let old = addPage(h, id: uuidV7(ms: lastWeekStartMS + 60_000, tail: 1), sessionID: lastWeekID, sessionStartMS: lastWeekStartMS, index: 2)
        await runLecture(h, service)

        let binding = try XCTUnwrap(service.target(forPage: old))
        XCTAssertEqual(binding.sessionID, lastWeekID)
        XCTAssertEqual(binding.sessionStartMS, lastWeekStartMS)

        // Strich von 10 Minuten nach Beginn der Vorwoche: t_start = 600 000 ms, nicht von der laufenden Session
        let createdAt = lastWeekStartMS + 600_000
        let strokes = neutralStrokes(for: binding, createdAtMS: createdAt)
        XCTAssertEqual(strokes.count, 1)
        XCTAssertEqual(strokes[0].tStartMS, 600_000)
    }

    func testRestoreDuringARunningLectureNeverColorsAnOldPageWithUnknownStart() async throws {
        let h = makeHarness()
        let service = makeService(h)
        // Session der Seite ist bekannt, ihr Start nicht (Seite kam vom Core)
        let old = addPage(h, id: uuidV7(ms: lastWeekStartMS + 60_000, tail: 2), sessionID: lastWeekID, sessionStartMS: nil, index: 2)
        await runLecture(h, service)

        let binding = try XCTUnwrap(service.target(forPage: old))
        XCTAssertEqual(binding.sessionID, lastWeekID)
        XCTAssertNil(binding.sessionStartMS)
        let strokes = neutralStrokes(for: binding, createdAtMS: lastWeekStartMS + 600_000)
        XCTAssertEqual(strokes.count, 1)
        XCTAssertNil(strokes[0].tStartMS)
        XCTAssertNil(strokes[0].tEndMS)
    }

    func testTheStartOfAnOldPageDoesNotChangeWhenALectureStarts() async throws {
        let h = makeHarness()
        let service = makeService(h)
        let old = addPage(h, id: uuidV7(ms: lastWeekStartMS + 60_000, tail: 3), sessionID: lastWeekID, sessionStartMS: lastWeekStartMS, index: 2)
        // Vor und nach dem Beginn der laufenden Vorlesung ändert sich am Ergebnis nichts
        XCTAssertEqual(service.target(forPage: old)?.sessionStartMS, lastWeekStartMS)
        await runLecture(h, service)
        XCTAssertEqual(service.target(forPage: old)?.sessionStartMS, lastWeekStartMS)
        XCTAssertEqual(service.target(forPage: old)?.sessionID, lastWeekID)
    }

    // MARK: Seite mit eigener Session

    func testAPageOfTheRunningSessionTakesItsStartAndKeepsItAfterTheLectureEnds() async throws {
        let h = makeHarness()
        let service = makeService(h)
        let page = addPage(h, id: uuidV7(ms: runningStartMS + 1_000, tail: 4), sessionID: runningID, sessionStartMS: nil, index: 2)
        XCTAssertNil(service.target(forPage: page)?.sessionStartMS)

        await runLecture(h, service)
        XCTAssertEqual(service.target(forPage: page)?.sessionID, runningID)
        XCTAssertEqual(service.target(forPage: page)?.sessionStartMS, runningStartMS)

        // Die Vorlesung endet: Der Start bleibt an der Seite, der Abgleich danach rechnet weiter mit ihm
        await service.follow(session: nil)
        XCTAssertNil(service.running)
        let binding = try XCTUnwrap(service.target(forPage: page))
        XCTAssertEqual(binding.sessionID, runningID)
        XCTAssertEqual(binding.sessionStartMS, runningStartMS)
        let strokes = neutralStrokes(for: binding, createdAtMS: runningStartMS + 120_000)
        XCTAssertEqual(strokes[0].tStartMS, 120_000)
    }

    func testAPageWithAKnownStartKeepsItWithoutARunningLecture() throws {
        let h = makeHarness()
        let service = makeService(h)
        let page = addPage(h, id: uuidV7(ms: lastWeekStartMS + 60_000, tail: 5), sessionID: lastWeekID, sessionStartMS: lastWeekStartMS, index: 2)
        let binding = try XCTUnwrap(service.target(forPage: page))
        XCTAssertEqual(binding.sessionID, lastWeekID)
        XCTAssertEqual(binding.sessionStartMS, lastWeekStartMS)
    }

    // MARK: Seite ohne Session

    func testAPageWithoutASessionGetsNoTimeEvenWhileALectureRuns() async throws {
        let h = makeHarness()
        let service = makeService(h)
        // Lange vor Beginn der laufenden Vorlesung angelegt
        let old = addPage(h, id: uuidV7(ms: runningStartMS - 86_400_000, tail: 6), sessionID: nil, sessionStartMS: nil, index: 2)
        await runLecture(h, service)

        let binding = try XCTUnwrap(service.target(forPage: old))
        XCTAssertNil(binding.sessionID)
        XCTAssertNil(binding.sessionStartMS)
        let strokes = neutralStrokes(for: binding, createdAtMS: runningStartMS + 60_000)
        XCTAssertNil(strokes[0].tStartMS)
    }

    func testAPageCreatedOfflineDuringTheLectureBelongsToIt() async throws {
        let h = makeHarness()
        let service = makeService(h)
        let page = addPage(h, id: uuidV7(ms: runningStartMS + 30_000, tail: 7), sessionID: nil, sessionStartMS: nil, index: 2)
        await runLecture(h, service)

        let binding = try XCTUnwrap(service.target(forPage: page))
        XCTAssertEqual(binding.sessionID, runningID)
        XCTAssertEqual(binding.sessionStartMS, runningStartMS)
    }

    // MARK: Regression: neue Striche in der laufenden Vorlesung

    func testNewStrokesOnANewLecturePageStillGetTheRunningSessionTime() async throws {
        let h = makeHarness()
        let service = makeService(h)
        await runLecture(h, service)

        let target = try XCTUnwrap(service.openLectureTarget(notebookID: notebookID))
        XCTAssertEqual(target.sessionID, runningID)
        XCTAssertEqual(target.sessionStartMS, runningStartMS)
        XCTAssertEqual(service.page(target.pageID)?.sessionStartMS, runningStartMS)

        let fresh = try XCTUnwrap(service.target(forPage: target.pageID))
        XCTAssertEqual(fresh.sessionStartMS, runningStartMS)
        let strokes = neutralStrokes(for: fresh, createdAtMS: runningStartMS + 90_000)
        XCTAssertEqual(strokes[0].tStartMS, 90_000)
    }

    // MARK: Gemerkter Start im Bestand

    func testTheRememberedStartSurvivesAnOlderLibraryFile() throws {
        let page = LibraryPage(
            id: firstPageID, notebookID: notebookID, index: 1, template: .blanko, widthPt: 595, heightPt: 842,
            sessionID: lastWeekID, backgroundSlideID: nil, attachedSlideID: nil, version: 1, createQueued: true,
            needsReconcile: false, deletedAtMS: nil, deleteQueued: false, sessionStartMS: lastWeekStartMS)
        let data = try JSONEncoder().encode(page)
        XCTAssertEqual(try JSONDecoder().decode(LibraryPage.self, from: data).sessionStartMS, lastWeekStartMS)

        // Altbestand ohne das Feld bleibt lesbar
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object.removeValue(forKey: "sessionStartMS")
        let old = try JSONSerialization.data(withJSONObject: object)
        XCTAssertNil(try JSONDecoder().decode(LibraryPage.self, from: old).sessionStartMS)
    }
}
