import XCTest

@testable import StudienGehirn

/// Uhr von Hand, ohne echtes Warten. `sleep` schiebt die Uhr nur vor. Alle Zeiten sind Vielfache von 0,25 s und
/// damit als Gleitkommazahl exakt, so bleibt jede Rechnung ohne Rundung.
@MainActor
final class GateTestClock {
    private(set) var date = Date(timeIntervalSince1970: 1_762_246_500)
    private(set) var sleeps: [TimeInterval] = []

    func advance(_ seconds: TimeInterval) {
        date = date.addingTimeInterval(seconds)
    }

    func sleep(_ duration: Duration) async throws {
        let parts = duration.components
        let seconds = Double(parts.seconds) + Double(parts.attoseconds) / 1e18
        sleeps.append(seconds)
        advance(seconds)
    }
}

/// UX-43: Ein Folienwechsel gilt erst nach einer Schreibpause
@MainActor
final class SlideSwitchGateQuietTests: XCTestCase {
    private let one = SlideRef(id: "s1", index: 1, widthPt: 960, heightPt: 540)
    private let two = SlideRef(id: "s2", index: 2, widthPt: 960, heightPt: 540)
    private let three = SlideRef(id: "s3", index: 3, widthPt: 960, heightPt: 540)

    private func makeGate(_ clock: GateTestClock) -> SlideSwitchGate {
        // Das Gate ist nicht an den Main-Actor gebunden, die Uhr schon. Der Test läuft auf dem Main-Actor.
        SlideSwitchGate(now: { MainActor.assumeIsolated { clock.date } })
    }

    private func stroke(_ gate: SlideSwitchGate, _ clock: GateTestClock, duration: TimeInterval = 0.5) {
        gate.toolBegan()
        clock.advance(duration)
        gate.finishTool()
    }

    func testTheQuietPeriodIsTwoSeconds() {
        XCTAssertEqual(SlideSwitchGate.quietPeriod, 2)
    }

    func testASlideChangeWithoutAnyStrokeAppliesAtOnce() {
        let clock = GateTestClock()
        let gate = makeGate(clock)
        XCTAssertEqual(gate.slideChanged(one), one)
        XCTAssertNil(gate.pending)
        XCTAssertFalse(gate.hasPending)
    }

    func testAChangeWaitsForTheQuietPeriodAfterTheLastStroke() async {
        let clock = GateTestClock()
        let gate = makeGate(clock)
        gate.toolBegan()
        XCTAssertNil(gate.slideChanged(two))
        clock.advance(0.5)
        gate.finishTool()
        // Der Stift ist oben, aber die Ruhezeit läuft noch: nichts wird freigegeben
        XCTAssertEqual(gate.releases, 0)
        XCTAssertEqual(gate.pending, two)

        // Ein weiterer Strich nach 1,5 s, innerhalb der Ruhezeit
        clock.advance(1.5)
        gate.toolBegan()
        await gate.awaitQuiet(sleep: { try await clock.sleep($0) })
        XCTAssertEqual(gate.releases, 0, "Mit aufliegendem Stift wartet das Gate weiter")
        clock.advance(0.5)
        gate.finishTool()
        XCTAssertEqual(gate.releases, 0)

        // Jetzt Ruhe: Das Warten dauert die volle Ruhezeit ab dem letzten Absetzen
        await gate.awaitQuiet(sleep: { try await clock.sleep($0) })
        XCTAssertEqual(clock.sleeps, [2])
        XCTAssertEqual(gate.releases, 1)
        XCTAssertEqual(gate.takeReleased(), two)
        XCTAssertNil(gate.takeReleased())
        XCTAssertNil(gate.pending)
    }

    func testAnotherStrokeInsideTheQuietPeriodRestartsTheWait() async {
        let clock = GateTestClock()
        let gate = makeGate(clock)
        stroke(gate, clock)
        XCTAssertNil(gate.slideChanged(two))
        clock.advance(1.75)
        stroke(gate, clock)
        await gate.awaitQuiet(sleep: { try await clock.sleep($0) })
        // Vom zweiten Absetzen an zählt die volle Ruhezeit
        XCTAssertEqual(clock.sleeps, [2])
        XCTAssertEqual(gate.takeReleased(), two)
    }

    func testSeveralChangesGiveExactlyOneSwitchToTheLastSlide() async {
        let clock = GateTestClock()
        let gate = makeGate(clock)
        gate.toolBegan()
        XCTAssertNil(gate.slideChanged(two))
        XCTAssertNil(gate.slideChanged(three))
        gate.finishTool()
        await gate.awaitQuiet(sleep: { try await clock.sleep($0) })
        XCTAssertEqual(gate.releases, 1)
        XCTAssertEqual(gate.takeReleased(), three)
        XCTAssertNil(gate.takeReleased())
        // Danach wartet nichts mehr und es gibt keine zweite Freigabe
        await gate.awaitQuiet(sleep: { try await clock.sleep($0) })
        XCTAssertEqual(gate.releases, 1)
    }

    func testATapSwitchesAtOnce() {
        let clock = GateTestClock()
        let gate = makeGate(clock)
        stroke(gate, clock)
        XCTAssertNil(gate.slideChanged(two))
        XCTAssertEqual(gate.pendingSlide, two)
        gate.releaseNow()
        XCTAssertEqual(gate.releases, 1)
        XCTAssertEqual(gate.takeReleased(), two)
        XCTAssertFalse(gate.hasPending)
        // Ohne wartenden Wechsel tut ein Tipp nichts
        gate.releaseNow()
        XCTAssertEqual(gate.releases, 1)
    }

    func testAfterASwitchWithoutFurtherStrokesTheNextChangeIsImmediate() async {
        let clock = GateTestClock()
        let gate = makeGate(clock)
        stroke(gate, clock)
        XCTAssertNil(gate.slideChanged(two))
        await gate.awaitQuiet(sleep: { try await clock.sleep($0) })
        XCTAssertEqual(gate.takeReleased(), two)
        XCTAssertEqual(gate.slideChanged(three), three)
    }

    func testAChangeLongAfterTheLastStrokeAppliesAtOnce() {
        let clock = GateTestClock()
        let gate = makeGate(clock)
        stroke(gate, clock)
        clock.advance(SlideSwitchGate.quietPeriod + 0.25)
        XCTAssertEqual(gate.slideChanged(two), two)
    }

    func testAStrokeWithoutAChangeReleasesNothing() async {
        let clock = GateTestClock()
        let gate = makeGate(clock)
        stroke(gate, clock)
        await gate.awaitQuiet(sleep: { try await clock.sleep($0) })
        XCTAssertEqual(gate.releases, 0)
        XCTAssertTrue(clock.sleeps.isEmpty)
    }

    func testResetForgetsAPendingSlide() {
        let clock = GateTestClock()
        let gate = makeGate(clock)
        gate.toolBegan()
        _ = gate.slideChanged(two)
        gate.reset()
        XCTAssertFalse(gate.hasPending)
        XCTAssertEqual(gate.slideChanged(three), three)
    }

    /// L15 aus #225: Eine Änderung der laufenden Session darf nicht zur Folienseite zurückspringen
    func testAFollowedSlideIsNotFollowedAgainUntilForgotten() {
        let gate = makeGate(GateTestClock())
        XCTAssertFalse(gate.alreadyFollowed(one))
        gate.noteFollowed(one)
        XCTAssertTrue(gate.alreadyFollowed(one))
        XCTAssertFalse(gate.alreadyFollowed(two))
        // Das Öffnen jeder Seite setzt das Gate zurück, die gemerkte Folie bleibt
        gate.reset()
        XCTAssertTrue(gate.alreadyFollowed(one))
        gate.forgetFollowed()
        XCTAssertFalse(gate.alreadyFollowed(one))
    }

    /// L15: Die gemerkte Folie wird nur ohne wartenden Wechsel übersprungen, mit `force` nie
    func testShouldFollowSkipsOnlyTheFollowedSlideWithoutAWaitingChange() {
        let gate = makeGate(GateTestClock())
        XCTAssertTrue(gate.shouldFollow(one))
        gate.noteFollowed(one)
        XCTAssertFalse(gate.shouldFollow(one))
        XCTAssertTrue(gate.shouldFollow(one, force: true))
        XCTAssertTrue(gate.shouldFollow(two))
    }

    /// L15: Folie A, B, zurück zu A bei aufliegendem Stift. Die Rückkehr zu A ersetzt den wartenden Wechsel zu B.
    func testReturningToTheFollowedSlideWhileWritingReplacesTheWaitingChange() async {
        let clock = GateTestClock()
        let gate = makeGate(clock)
        gate.noteFollowed(one)
        gate.toolBegan()
        XCTAssertTrue(gate.shouldFollow(two))
        XCTAssertNil(gate.slideChanged(two))
        // Ein wartender Wechsel darf die Rückkehr zur gemerkten Folie nicht verschlucken
        XCTAssertTrue(gate.shouldFollow(one))
        XCTAssertNil(gate.slideChanged(one))
        clock.advance(0.5)
        gate.finishTool()
        await gate.awaitQuiet(sleep: { try await clock.sleep($0) })
        XCTAssertEqual(gate.takeReleased(), one)
    }

    func testTheViewIsToldToRestartTheWaitWhenAChangeWaitsOrAStrokeEnds() {
        let clock = GateTestClock()
        let gate = makeGate(clock)
        // Ein Strich ohne wartenden Wechsel startet kein Warten
        stroke(gate, clock)
        XCTAssertEqual(gate.waitToken, 0)
        XCTAssertNil(gate.slideChanged(two))
        XCTAssertEqual(gate.waitToken, 1)
        stroke(gate, clock)
        XCTAssertEqual(gate.waitToken, 2)
    }

    func testACancelledWaitReleasesNothing() async {
        let clock = GateTestClock()
        let gate = makeGate(clock)
        stroke(gate, clock)
        XCTAssertNil(gate.slideChanged(two))
        await gate.awaitQuiet(sleep: { _ in throw CancellationError() })
        XCTAssertEqual(gate.releases, 0)
        XCTAssertEqual(gate.pendingSlide, two)
    }

    func testAModeSwitchDropsTheWaitingChange() async {
        let clock = GateTestClock()
        let gate = makeGate(clock)
        stroke(gate, clock)
        XCTAssertNil(gate.slideChanged(two))
        XCTAssertFalse(gate.lectureStarted())
        gate.dropPending()
        XCTAssertFalse(gate.hasPending)
        await gate.awaitQuiet(sleep: { try await clock.sleep($0) })
        XCTAssertEqual(gate.releases, 0)
        // Die Ruhezeit nach dem Strich gilt weiter
        XCTAssertNil(gate.slideChanged(three))
    }

    func testALectureStartWaitsForTheQuietPeriodLikeASlideChange() async {
        let clock = GateTestClock()
        let gate = makeGate(clock)
        // Ohne Strich: sofort
        XCTAssertTrue(gate.lectureStarted())

        stroke(gate, clock)
        XCTAssertFalse(gate.lectureStarted())
        XCTAssertTrue(gate.lecturePending)
        await gate.awaitQuiet(sleep: { try await clock.sleep($0) })
        XCTAssertEqual(gate.releases, 1)
        XCTAssertTrue(gate.takeLectureReleased())
        XCTAssertFalse(gate.takeLectureReleased())
        XCTAssertNil(gate.takeReleased())
        XCTAssertFalse(gate.lecturePending)
    }
}
