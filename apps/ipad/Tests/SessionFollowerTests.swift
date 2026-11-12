import XCTest

@testable import StudienGehirn

@MainActor
final class FakeFeed: SessionFeed {
    var onInbound: (@MainActor (SyncInbound) -> Void)?
    private(set) var subscribes: [(stream: String, seq: Int, opID: String?)] = []
    private(set) var unsubscribes: [String] = []

    func subscribe(stream: String, lastSeq: Int, lastOpID: String?) {
        subscribes.append((stream, lastSeq, lastOpID))
    }

    func unsubscribe(stream: String) {
        unsubscribes.append(stream)
    }

    func deliver(_ inbound: SyncInbound) {
        onInbound?(inbound)
    }
}

@MainActor
final class FakeFollowerBackend: SessionFollowerBackend {
    var sessions: [SessionBrief] = []
    var snapshots: [String: SessionSnapshotBrief] = [:]
    var failing = false
    private(set) var sessionCalls = 0
    private(set) var snapshotCalls = 0

    func activeSessions() async throws -> [SessionBrief] {
        sessionCalls += 1
        if failing { throw ConnectionError.invalidAddress }
        return sessions
    }

    func snapshot(sessionID: String) async throws -> SessionSnapshotBrief? {
        snapshotCalls += 1
        if failing { throw ConnectionError.invalidAddress }
        return snapshots[sessionID]
    }
}

/// Session verfolgen: Snapshot, Strom, Lücken, Reset, Beenden (Plan PR 4, V5)
@MainActor
final class SessionFollowerTests: XCTestCase {
    private let sessionID = "019a4e14-0000-7000-8000-0000000000d1"
    private var stream: String { "session:\(sessionID)" }
    private let moduleID = "019a4e14-0000-7000-8000-0000000000c1"

    private let slideA = SlideBrief(slideID: "slide-a", index: 1)
    private let slideB = SlideBrief(slideID: "slide-b", index: 2)
    private let slideC = SlideBrief(slideID: "slide-c", index: 3)

    private struct Rig {
        let clock: VirtualClock
        let feed: FakeFeed
        let backend: FakeFollowerBackend
        let follower: SessionFollower
    }

    private func brief(
        state: String = "laeuft", started: Int = 1000, updated: Int = 1000, deleted: Bool = false,
        id: String? = nil
    ) -> SessionBrief {
        SessionBrief(
            id: id ?? sessionID, moduleID: moduleID, state: state, startedAtMS: started, slideDeckID: "deck-1",
            deleted: deleted, updatedAtMS: updated)
    }

    private func snapshot(_ session: SessionBrief, slide: SlideBrief?, seq: Int, opID: String? = "op") -> SessionSnapshotBrief {
        let events =
            slide.map {
                [
                    SessionSnapshotBrief.SlideEventBrief(
                        slideID: $0.slideID, slideIndex: $0.index, tMS: 5000, createdAtMS: 5000)
                ]
            } ?? []
        return SessionSnapshotBrief(session: session, slideEvents: events, streamSeq: seq, streamOpID: opID)
    }

    private func makeRig(slide: SlideBrief? = nil, seq: Int = 5) -> Rig {
        let clock = VirtualClock()
        let feed = FakeFeed()
        let backend = FakeFollowerBackend()
        let session = brief()
        backend.sessions = [session]
        backend.snapshots[sessionID] = snapshot(session, slide: slide ?? slideA, seq: seq, opID: "op-\(seq)")
        let follower = SessionFollower(
            feed: feed, backend: backend, now: { clock.date }, sleep: { try await clock.sleep($0) })
        follower.start()
        return Rig(clock: clock, feed: feed, backend: backend, follower: follower)
    }

    private func connect(_ rig: Rig) async {
        rig.feed.deliver(.connected)
        let ready = await eventually { rig.follower.running != nil }
        XCTAssertTrue(ready)
        await rig.clock.settle()
    }

    // MARK: Snapshot

    func testSnapshotGivesTheCurrentSlideAndSubscribesFromItsPosition() async {
        let rig = makeRig()
        await connect(rig)
        XCTAssertEqual(rig.follower.running?.id, sessionID)
        XCTAssertEqual(rig.follower.currentSlide, slideA)
        XCTAssertEqual(rig.feed.subscribes.count, 1)
        XCTAssertEqual(rig.feed.subscribes.first?.stream, stream)
        XCTAssertEqual(rig.feed.subscribes.first?.seq, 5)
        XCTAssertEqual(rig.feed.subscribes.first?.opID, "op-5")
    }

    func testTheLatestSlideEventWinsByTimeThenByCreationAndDeletedOnesDoNotCount() {
        let events = [
            SessionSnapshotBrief.SlideEventBrief(slideID: "a", slideIndex: 1, tMS: 100, createdAtMS: 1),
            SessionSnapshotBrief.SlideEventBrief(slideID: "b", slideIndex: 2, tMS: 300, createdAtMS: 1),
            SessionSnapshotBrief.SlideEventBrief(slideID: "c", slideIndex: 3, tMS: 300, createdAtMS: 9),
            SessionSnapshotBrief.SlideEventBrief(slideID: "d", slideIndex: 4, tMS: 900, createdAtMS: 9, deleted: true),
        ]
        let snapshot = SessionSnapshotBrief(session: brief(), slideEvents: events, streamSeq: 0, streamOpID: nil)
        XCTAssertEqual(snapshot.latestSlide, SlideBrief(slideID: "c", index: 3))
    }

    func testNoActiveSessionMeansNothingToFollow() async {
        let rig = makeRig()
        rig.backend.sessions = [brief(state: "beendet")]
        rig.feed.deliver(.connected)
        await rig.clock.settle()
        XCTAssertNil(rig.follower.running)
        XCTAssertNil(rig.follower.currentSlide)
        XCTAssertTrue(rig.feed.subscribes.isEmpty)
    }

    func testAnOfflineFailureKeepsTheLastStateAndSubscribesToNothing() async {
        let rig = makeRig()
        rig.backend.failing = true
        rig.feed.deliver(.connected)
        await rig.clock.settle()
        XCTAssertNil(rig.follower.running)
        XCTAssertTrue(rig.feed.subscribes.isEmpty)
    }

    func testAFailedLoadIsRetriedSoTheLectureIsFollowedWithoutANewConnection() async {
        let rig = makeRig()
        rig.backend.failing = true
        rig.feed.deliver(.connected)
        await rig.clock.settle()
        XCTAssertNil(rig.follower.running)

        rig.backend.failing = false
        await rig.clock.advance(5)
        let followed = await eventually { rig.follower.running != nil }
        XCTAssertTrue(followed)
        XCTAssertEqual(rig.feed.subscribes.count, 1)
    }

    func testRetriesAfterFailuresStopAfterAFewAttempts() async {
        let rig = makeRig()
        rig.backend.failing = true
        rig.feed.deliver(.connected)
        await rig.clock.settle()
        XCTAssertEqual(rig.backend.sessionCalls, 1)
        for _ in 0..<6 {
            await rig.clock.advance(5)
        }
        XCTAssertEqual(rig.backend.sessionCalls, 1 + SessionFollower.maxLoadRetries)
    }

    // MARK: Strom

    func testTheNextSeqMovesTheSlideADuplicateAndOldSeqAreIgnored() async {
        let rig = makeRig()
        await connect(rig)

        rig.feed.deliver(.op(stream: stream, seq: 6, slide: slideB))
        XCTAssertEqual(rig.follower.currentSlide, slideB)

        // Dieselbe seq noch einmal, und eine ältere: verworfen
        rig.feed.deliver(.op(stream: stream, seq: 6, slide: slideC))
        rig.feed.deliver(.op(stream: stream, seq: 4, slide: slideC))
        XCTAssertEqual(rig.follower.currentSlide, slideB)
        XCTAssertEqual(rig.backend.snapshotCalls, 1)
    }

    func testAnUnknownKindCountsItsSeqButChangesNothing() async {
        let rig = makeRig()
        await connect(rig)
        rig.feed.deliver(.op(stream: stream, seq: 6, slide: nil))
        XCTAssertEqual(rig.follower.currentSlide, slideA)
        // Die nächste Folie hat seq 7 und wird angewandt, ohne Lücke
        rig.feed.deliver(.op(stream: stream, seq: 7, slide: slideB))
        XCTAssertEqual(rig.follower.currentSlide, slideB)
        XCTAssertEqual(rig.backend.snapshotCalls, 1)
    }

    func testAnOperationOfAnotherStreamIsIgnored() async {
        let rig = makeRig()
        await connect(rig)
        rig.feed.deliver(.op(stream: "session:other", seq: 6, slide: slideB))
        XCTAssertEqual(rig.follower.currentSlide, slideA)
    }

    func testAGapReloadsTheSnapshotAfterTheMinimumInterval() async {
        let rig = makeRig()
        await connect(rig)
        let session = brief()
        rig.backend.snapshots[sessionID] = snapshot(session, slide: slideC, seq: 9, opID: "op-9")

        // seq 8 statt 6: Lücke. Das Neuladen wartet, weil der letzte Abruf eben erst war.
        rig.feed.deliver(.op(stream: stream, seq: 8, slide: slideB))
        XCTAssertEqual(rig.follower.currentSlide, slideA)
        XCTAssertEqual(rig.backend.snapshotCalls, 1)

        await rig.clock.advance(5)
        let reloaded = await eventually { rig.follower.currentSlide == self.slideC }
        XCTAssertTrue(reloaded)
        XCTAssertEqual(rig.backend.snapshotCalls, 2)
        XCTAssertEqual(rig.feed.subscribes.last?.seq, 9)
    }

    // MARK: Reset

    func testAResetSubscribesAgainButNotMoreOftenThanEveryFiveSeconds() async {
        let rig = makeRig()
        await connect(rig)
        XCTAssertEqual(rig.feed.subscribes.count, 1)

        // Zwei Resets kurz nacheinander: ein einziges Neuladen, und erst nach Ablauf der Frist
        rig.feed.deliver(.subscribed(stream: stream, reset: true))
        rig.feed.deliver(.subscribed(stream: stream, reset: true))
        await rig.clock.settle()
        XCTAssertEqual(rig.feed.subscribes.count, 1)
        XCTAssertEqual(rig.backend.snapshotCalls, 1)

        await rig.clock.advance(5)
        let again = await eventually { rig.feed.subscribes.count == 2 }
        XCTAssertTrue(again)
        XCTAssertEqual(rig.backend.snapshotCalls, 2)
    }

    func testSubscribedWithoutResetDoesNothing() async {
        let rig = makeRig()
        await connect(rig)
        rig.feed.deliver(.subscribed(stream: stream, reset: false))
        await rig.clock.advance(10)
        XCTAssertEqual(rig.backend.snapshotCalls, 1)
        XCTAssertEqual(rig.feed.subscribes.count, 1)
    }

    // MARK: session.updated

    func testAnEndedSessionUnsubscribesAndClearsEverything() async {
        let rig = makeRig()
        await connect(rig)
        rig.feed.deliver(.sessionUpdated(brief(state: "beendet", updated: 2000)))
        XCTAssertNil(rig.follower.running)
        XCTAssertNil(rig.follower.currentSlide)
        XCTAssertEqual(rig.feed.unsubscribes, [stream])
        // Spätere Operationen des Stroms werden nicht mehr angewandt
        rig.feed.deliver(.op(stream: stream, seq: 6, slide: slideB))
        XCTAssertNil(rig.follower.currentSlide)
    }

    func testADeletedSessionStopsFollowing() async {
        let rig = makeRig()
        await connect(rig)
        rig.feed.deliver(.sessionUpdated(brief(updated: 2000, deleted: true)))
        XCTAssertNil(rig.follower.running)
        XCTAssertEqual(rig.feed.unsubscribes, [stream])
    }

    func testAnOlderVersionOfSessionUpdatedIsIgnored() async {
        let rig = makeRig()
        await connect(rig)
        rig.feed.deliver(.sessionUpdated(brief(state: "pausiert", updated: 3000)))
        XCTAssertEqual(rig.follower.running?.state, "pausiert")
        // Älter als 3000: weder Beenden noch Zustand wird übernommen
        rig.feed.deliver(.sessionUpdated(brief(state: "beendet", updated: 2000)))
        XCTAssertEqual(rig.follower.running?.state, "pausiert")
        XCTAssertTrue(rig.feed.unsubscribes.isEmpty)
    }

    func testPausedStaysFollowedAndKeepsTheSlide() async {
        let rig = makeRig()
        await connect(rig)
        rig.feed.deliver(.sessionUpdated(brief(state: "pausiert", updated: 2000)))
        XCTAssertEqual(rig.follower.running?.state, "pausiert")
        XCTAssertEqual(rig.follower.currentSlide, slideA)
    }

    func testANewActiveSessionIsFollowed() async {
        let rig = makeRig()
        rig.backend.sessions = []
        rig.feed.deliver(.connected)
        await rig.clock.settle()
        XCTAssertNil(rig.follower.running)

        // Die Vorlesung beginnt
        rig.backend.sessions = [brief()]
        rig.feed.deliver(.sessionUpdated(brief(updated: 4000)))
        let started = await eventually { rig.follower.running != nil }
        XCTAssertTrue(started)
        XCTAssertEqual(rig.feed.subscribes.last?.stream, stream)
    }

    func testASessionThatEndsWhileTheSnapshotLoadsIsNotFollowed() async {
        let rig = makeRig()
        rig.feed.deliver(.connected)
        // Das Ende kommt an, bevor der Snapshot (noch „laeuft“, updated 1000) verarbeitet ist
        rig.feed.deliver(.sessionUpdated(brief(state: "beendet", updated: 2000)))
        let loaded = await eventually { rig.backend.snapshotCalls == 1 }
        XCTAssertTrue(loaded)
        await rig.clock.settle()
        XCTAssertNil(rig.follower.running)
        XCTAssertNil(rig.follower.currentSlide)
        XCTAssertTrue(rig.feed.subscribes.isEmpty)
    }

    func testANewerSessionUpdatedBeatsAnOlderSnapshot() async {
        let rig = makeRig()
        rig.feed.deliver(.connected)
        rig.feed.deliver(.sessionUpdated(brief(state: "pausiert", updated: 2000)))
        let ready = await eventually { rig.follower.running != nil }
        XCTAssertTrue(ready)
        await rig.clock.settle()
        XCTAssertEqual(rig.follower.running?.state, "pausiert")
        XCTAssertEqual(rig.follower.running?.updatedAtMS, 2000)
    }

    // MARK: Neue Verbindung

    func testANewConnectionForgetsTheOldSeqAndSubscribesFromTheNewSnapshot() async {
        let rig = makeRig()
        await connect(rig)
        rig.feed.deliver(.op(stream: stream, seq: 6, slide: slideB))
        rig.feed.deliver(.op(stream: stream, seq: 7, slide: slideC))

        // Verbindung weg und wieder da. Der Mac hat inzwischen einen neuen Stand (seq 2 nach einer Wiederherstellung).
        rig.backend.snapshots[sessionID] = snapshot(brief(), slide: slideA, seq: 2, opID: "op-2")
        rig.feed.deliver(.connected)
        let resubscribed = await eventually { rig.feed.subscribes.count == 2 }
        XCTAssertTrue(resubscribed)
        XCTAssertEqual(rig.feed.subscribes.last?.seq, 2)
        XCTAssertEqual(rig.feed.subscribes.last?.opID, "op-2")
        XCTAssertEqual(rig.follower.currentSlide, slideA)

        // seq 3 ist jetzt die nächste, nicht seq 8
        rig.feed.deliver(.op(stream: stream, seq: 3, slide: slideB))
        XCTAssertEqual(rig.follower.currentSlide, slideB)
    }

    func testOnChangeFiresForSessionAndSlideChanges() async {
        let rig = makeRig()
        let counter = CallCounter()
        rig.follower.onChange = { counter.count += 1 }
        await connect(rig)
        let afterConnect = counter.count
        XCTAssertGreaterThan(afterConnect, 0)
        rig.feed.deliver(.op(stream: stream, seq: 6, slide: slideB))
        XCTAssertEqual(counter.count, afterConnect + 1)
    }
}

@MainActor
final class CallCounter {
    var count = 0
}
