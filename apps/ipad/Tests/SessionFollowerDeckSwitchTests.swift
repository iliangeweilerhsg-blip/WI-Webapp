import UIKit
import XCTest

@testable import StudienGehirn

/// Foliensatz einer laufenden Session ändert sich per `session.updated` (VERTRAEGE §22.4: `PATCH`, Upload mit
/// `session_id`, später Moodle). Das iPad liest nur und übernimmt den Satz über den Follower.
@MainActor
final class SessionFollowerDeckSwitchTests: XCTestCase {
    private let sessionID = "019a4e14-0000-7000-8000-0000000000d1"
    private var stream: String { "session:\(sessionID)" }
    private let moduleID = "019a4e14-0000-7000-8000-0000000000c1"

    private struct Rig {
        let clock: VirtualClock
        let feed: FakeFeed
        let backend: FakeFollowerBackend
        let follower: SessionFollower
    }

    private func brief(deck: String?, state: String = "laeuft", updated: Int = 1000) -> SessionBrief {
        SessionBrief(
            id: sessionID, moduleID: moduleID, state: state, startedAtMS: 1000, slideDeckID: deck, deleted: false,
            updatedAtMS: updated)
    }

    private func snapshot(_ session: SessionBrief, slide: SlideBrief?, seq: Int) -> SessionSnapshotBrief {
        let events =
            slide.map {
                [
                    SessionSnapshotBrief.SlideEventBrief(
                        slideID: $0.slideID, slideIndex: $0.index, tMS: 5000, createdAtMS: 5000)
                ]
            } ?? []
        return SessionSnapshotBrief(session: session, slideEvents: events, streamSeq: seq, streamOpID: "op-\(seq)")
    }

    private func makeRig(deck: String?, slide: SlideBrief? = nil, seq: Int = 5) -> Rig {
        let clock = VirtualClock()
        let feed = FakeFeed()
        let backend = FakeFollowerBackend()
        let session = brief(deck: deck)
        backend.sessions = [session]
        backend.snapshots[sessionID] = snapshot(session, slide: slide, seq: seq)
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

    // MARK: Follower

    func testARunningSessionWithoutDeckGetsOneLaterAndOnChangeFires() async {
        let rig = makeRig(deck: nil)
        let counter = CallCounter()
        rig.follower.onChange = { counter.count += 1 }
        await connect(rig)
        XCTAssertNil(rig.follower.running?.slideDeckID)
        let afterConnect = counter.count

        rig.feed.deliver(.sessionUpdated(brief(deck: "deck-a", updated: 2000)))
        XCTAssertEqual(rig.follower.running?.slideDeckID, "deck-a")
        XCTAssertEqual(rig.follower.running?.id, sessionID)
        XCTAssertEqual(counter.count, afterConnect + 1)
        // Weiter gefolgt, ohne Neuladen und ohne neues Abonnement
        XCTAssertEqual(rig.backend.snapshotCalls, 1)
        XCTAssertEqual(rig.feed.subscribes.count, 1)
        XCTAssertTrue(rig.feed.unsubscribes.isEmpty)
    }

    func testTheDeckSwitchesFromAToBAndAnOlderUpdateWithAIsIgnored() async {
        let rig = makeRig(deck: "deck-a")
        let counter = CallCounter()
        rig.follower.onChange = { counter.count += 1 }
        await connect(rig)
        XCTAssertEqual(rig.follower.running?.slideDeckID, "deck-a")
        let afterConnect = counter.count

        rig.feed.deliver(.sessionUpdated(brief(deck: "deck-b", updated: 3000)))
        XCTAssertEqual(rig.follower.running?.slideDeckID, "deck-b")
        XCTAssertEqual(counter.count, afterConnect + 1)

        // Eine verspätete, ältere Fassung mit Satz A gilt nicht
        rig.feed.deliver(.sessionUpdated(brief(deck: "deck-a", updated: 2000)))
        XCTAssertEqual(rig.follower.running?.slideDeckID, "deck-b")
        XCTAssertEqual(rig.follower.running?.updatedAtMS, 3000)
        XCTAssertEqual(counter.count, afterConnect + 1)
        XCTAssertEqual(rig.backend.snapshotCalls, 1)
        XCTAssertTrue(rig.feed.unsubscribes.isEmpty)
    }

    func testClearingTheDeckKeepsFollowingTheSession() async {
        let rig = makeRig(deck: "deck-a")
        let counter = CallCounter()
        rig.follower.onChange = { counter.count += 1 }
        await connect(rig)
        let afterConnect = counter.count

        rig.feed.deliver(.sessionUpdated(brief(deck: nil, updated: 2000)))
        XCTAssertNotNil(rig.follower.running)
        XCTAssertNil(rig.follower.running?.slideDeckID)
        XCTAssertEqual(rig.follower.running?.id, sessionID)
        XCTAssertEqual(counter.count, afterConnect + 1)
        // Nicht beendet: kein Abbestellen, der Strom läuft weiter
        XCTAssertTrue(rig.feed.unsubscribes.isEmpty)
        XCTAssertEqual(rig.feed.subscribes.count, 1)
        rig.feed.deliver(.op(stream: stream, seq: 6, slide: SlideBrief(slideID: nil, index: 4)))
        XCTAssertEqual(rig.follower.currentSlide, SlideBrief(slideID: nil, index: 4))
        XCTAssertEqual(rig.backend.snapshotCalls, 1)
    }

    func testTheDeckSwitchKeepsThePositionFromTheStreamAndTheStreamGoesOn() async {
        let slide = SlideBrief(slideID: nil, index: 2)
        let rig = makeRig(deck: "deck-a", slide: slide)
        await connect(rig)
        XCTAssertEqual(rig.follower.currentSlide, slide)

        rig.feed.deliver(.sessionUpdated(brief(deck: "deck-b", updated: 2000)))
        // Robustheit: Nach §22.4 lehnt der Core einen Wechsel mit Folienwechseln ab (409 `slide_deck_locked`), kommt er doch an
        // (z. B. nach gelöschten `slide_events`), gilt: Die Position kommt allein aus `slide_events`/`slide.change`,
        // der Satzwechsel löscht sie nicht und lädt nichts neu
        XCTAssertEqual(rig.follower.currentSlide, slide)
        XCTAssertEqual(rig.backend.snapshotCalls, 1)

        // Die nächste Operation (seq 6) gilt ohne Lücke
        let next = SlideBrief(slideID: nil, index: 3)
        rig.feed.deliver(.op(stream: stream, seq: 6, slide: next))
        XCTAssertEqual(rig.follower.currentSlide, next)
        XCTAssertEqual(rig.backend.snapshotCalls, 1)
    }

    func testTheSameDeckAgainDoesNotReloadAndAnIdenticalRepeatDoesNotFireOnChange() async {
        let rig = makeRig(deck: "deck-a")
        let counter = CallCounter()
        rig.follower.onChange = { counter.count += 1 }
        await connect(rig)
        let afterConnect = counter.count
        let sessionCalls = rig.backend.sessionCalls

        // Dieselbe Fassung noch einmal (Wiederholung)
        rig.feed.deliver(.sessionUpdated(brief(deck: "deck-a", updated: 1000)))
        XCTAssertEqual(counter.count, afterConnect)

        // Neuere Fassung mit gleichem Satz (z. B. anderer Titel): kein Neuladen, kein neues Abonnement
        rig.feed.deliver(.sessionUpdated(brief(deck: "deck-a", updated: 2000)))
        await rig.clock.advance(10)
        XCTAssertEqual(rig.follower.running?.slideDeckID, "deck-a")
        XCTAssertEqual(rig.backend.snapshotCalls, 1)
        XCTAssertEqual(rig.backend.sessionCalls, sessionCalls)
        XCTAssertEqual(rig.feed.subscribes.count, 1)
        XCTAssertTrue(rig.feed.unsubscribes.isEmpty)
    }

    func testANewerDeckFromSessionUpdatedBeatsAnOlderSnapshot() async {
        let rig = makeRig(deck: nil)
        rig.feed.deliver(.connected)
        rig.feed.deliver(.sessionUpdated(brief(deck: "deck-b", updated: 2000)))
        let ready = await eventually { rig.follower.running != nil }
        XCTAssertTrue(ready)
        await rig.clock.settle()
        XCTAssertEqual(rig.follower.running?.slideDeckID, "deck-b")
        XCTAssertEqual(rig.follower.running?.updatedAtMS, 2000)
    }

    func testANewConnectionTakesTheCurrentDeckFromTheSnapshot() async {
        let rig = makeRig(deck: "deck-a")
        await connect(rig)
        // Der Satz wechselte, während das iPad offline war
        rig.backend.snapshots[sessionID] = snapshot(brief(deck: "deck-b", updated: 4000), slide: nil, seq: 7)
        rig.backend.sessions = [brief(deck: "deck-b", updated: 4000)]
        rig.feed.deliver(.connected)
        let switched = await eventually { rig.follower.running?.slideDeckID == "deck-b" }
        XCTAssertTrue(switched)
    }

    // MARK: Folienansicht

    private func makeSupport(follower: SessionFollower, transport: FakeTransport) -> SlideSupport {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("deck-switch-\(UUID().uuidString)")
        let decks = SlideDeckStore(
            directory: folder,
            client: Fixtures.client(transport),
            access: { (endpoint: Fixtures.endpoint, token: Fixtures.token) },
            canReach: { true },
            protectedDecks: { [weak follower] in
                guard let deckID = follower?.running?.slideDeckID else { return [] }
                return [deckID]
            }
        )
        return SlideSupport(follower: follower, decks: decks)
    }

    private func deckJSON(_ id: String, sha: String) -> String {
        """
        {"deck":{"id":"\(id)","sha256":"\(sha)"},"slides":[
        {"id":"\(id)-1","index":1,"width_pt":960,"height_pt":540},{"id":"\(id)-2","index":2,"width_pt":960,"height_pt":540}]}
        """
    }

    private func makeDeckTransport() -> FakeTransport {
        let pdf = TestPDF.make(pages: [CGSize(width: 960, height: 540), CGSize(width: 960, height: 540)])
        let sha = TestPDF.sha256(pdf)
        let transport = FakeTransport([.http(status: 404, body: Fixtures.apiError("not_found"))])
        transport.downloadData = pdf
        let first = deckJSON("deck-a", sha: sha)
        let second = deckJSON("deck-b", sha: sha)
        transport.router = { request in
            let path = request.url?.path ?? ""
            if path.hasSuffix("/slide-decks/deck-a") { return .http(status: 200, body: first) }
            if path.hasSuffix("/slide-decks/deck-b") { return .http(status: 200, body: second) }
            return nil
        }
        return transport
    }

    func testTheSlideViewLoadsTheNewDeckAfterASwitchAndResolvesThePositionInIt() async {
        let rig = makeRig(deck: "deck-a", slide: SlideBrief(slideID: nil, index: 2))
        await connect(rig)
        let transport = makeDeckTransport()
        let support = makeSupport(follower: rig.follower, transport: transport)

        let before = await support.currentSlide()
        XCTAssertEqual(before?.id, "deck-a-2")
        XCTAssertEqual(support.knownCurrentSlide()?.id, "deck-a-2")

        rig.feed.deliver(.sessionUpdated(brief(deck: "deck-b", updated: 2000)))
        // Bis der neue Satz da ist, kennt das iPad keine aktuelle Folie (kein alter Satz, kein Raten)
        XCTAssertNil(support.knownCurrentSlide())
        let after = await support.currentSlide()
        XCTAssertEqual(after?.id, "deck-b-2")
        XCTAssertEqual(after?.index, 2)
        XCTAssertEqual(support.knownCurrentSlide()?.id, "deck-b-2")
        XCTAssertNotNil(support.decks.info(forDeck: "deck-b"))
        XCTAssertEqual(transport.downloadRequests.count, 2)
    }

    func testAClearedDeckGivesNoCurrentSlideAndLoadsNothing() async {
        let rig = makeRig(deck: "deck-a", slide: SlideBrief(slideID: nil, index: 1))
        await connect(rig)
        let transport = makeDeckTransport()
        let support = makeSupport(follower: rig.follower, transport: transport)
        let first = await support.currentSlide()
        XCTAssertNotNil(first)
        let requests = transport.requests.count

        rig.feed.deliver(.sessionUpdated(brief(deck: nil, updated: 2000)))
        XCTAssertNil(support.knownCurrentSlide())
        let none = await support.currentSlide()
        XCTAssertNil(none)
        XCTAssertEqual(transport.requests.count, requests)
    }

    func testTheBackgroundShowsASlideOfTheNewDeckAfterASwitch() async {
        let rig = makeRig(deck: "deck-a", slide: SlideBrief(slideID: nil, index: 1))
        await connect(rig)
        let transport = makeDeckTransport()
        let support = makeSupport(follower: rig.follower, transport: transport)
        let model = SlideBackgroundModel(support: support, canReach: { true })

        model.show(slideID: "deck-a-1", deckHint: "deck-a")
        let first = await eventually { model.state == .ready }
        XCTAssertTrue(first)

        rig.feed.deliver(.sessionUpdated(brief(deck: "deck-b", updated: 2000)))
        model.show(slideID: "deck-b-1", deckHint: rig.follower.running?.slideDeckID)
        XCTAssertEqual(model.state, .loading)
        let second = await eventually { model.state == .ready }
        XCTAssertTrue(second)
        XCTAssertNotNil(model.image)
        XCTAssertNotNil(support.decks.info(forDeck: "deck-b"))
        XCTAssertEqual(transport.downloadRequests.count, 2)
    }

    /// Hält eine Anfrage an, bis der Test sie freigibt (kein Sleep)
    @MainActor
    private final class RequestGate {
        private(set) var reached = false
        private var released = false
        private var continuation: CheckedContinuation<Void, Never>?

        func hold() async {
            reached = true
            if released { return }
            await withCheckedContinuation { (next: CheckedContinuation<Void, Never>) in
                continuation = next
            }
        }

        func release() {
            released = true
            continuation?.resume()
            continuation = nil
        }
    }

    func testASwitchDuringTheDownloadNeverReturnsASlideOfTheOldDeck() async {
        let rig = makeRig(deck: "deck-a", slide: SlideBrief(slideID: nil, index: 2))
        await connect(rig)
        let transport = makeDeckTransport()
        let gate = RequestGate()
        // Die Metadaten von Satz A kommen erst, wenn der Test freigibt; alles andere läuft sofort
        transport.duringRequest = { request in
            if (request.url?.path ?? "").hasSuffix("/slide-decks/deck-a") { await gate.hold() }
        }
        let support = makeSupport(follower: rig.follower, transport: transport)

        // Während `currentSlide()` an Satz A hängt, wechselt der Satz auf B, danach läuft der Download von A weiter
        let switcher = _Concurrency.Task { @MainActor in
            let held = await eventually { gate.reached }
            rig.feed.deliver(.sessionUpdated(self.brief(deck: "deck-b", updated: 2000)))
            gate.release()
            return held
        }
        let slide = await support.currentSlide()
        let held = await switcher.value

        XCTAssertTrue(held)
        XCTAssertEqual(rig.follower.running?.slideDeckID, "deck-b")
        // Keine Folie aus A: Die Position wird im neuen Satz aufgelöst
        XCTAssertEqual(slide?.id, "deck-b-2")
        XCTAssertNotNil(support.decks.info(forDeck: "deck-b"))
    }
}
