import XCTest

@testable import StudienGehirn

@MainActor
private final class InboundLog {
    var items: [SyncInbound] = []
}

/// Eingehende Nachrichten: `slide.change`, unbekannte Arten, `session.updated`, `subscribed`. Die Engine liest nur:
/// Sie ändert weder die Bibliothek noch die Warteschlange (Plan PR 4, §4).
@MainActor
final class SyncInboundTests: XCTestCase {
    private let sessionID = "019a4e14-0000-7000-8000-000000000030"
    private var stream: String { "session:\(sessionID)" }

    private func slideChange(seq: Int, slideID: String?, index: Int) -> String {
        let slide = slideID.map { "\"\($0)\"" } ?? "null"
        return """
            {"type":"op","op_id":"019a4e14-0000-7000-8000-00000000091\(seq)","stream":"\(stream)","seq":\(seq),
            "kind":"slide.change","at":1762240562123,"clock_uncertain":false,
            "data":{"event_id":"019a4e14-0000-7000-8000-000000000033","session_id":"\(sessionID)",
            "slide_id":\(slide),"slide_index":\(index),"t_ms":754000,"device":"mac"}}
            """
    }

    private func sessionUpdated(state: String, updatedAt: String = "2026-11-04T07:16:02.987Z") -> String {
        """
        {"type":"event","name":"session.updated","data":{"id":"\(sessionID)",
        "user_id":"019a4e14-0000-7000-8000-000000000001","created_at":"2026-11-04T07:15:00Z",
        "updated_at":"\(updatedAt)","deleted_at":null,"calendar_event_id":null,
        "module_id":"019a4e14-0000-7000-8000-000000000010","slide_deck_id":"019a4e14-0000-7000-8000-000000000040",
        "number":7,"title":null,"state":"\(state)","started_at":"2026-11-04T07:16:02.123Z","ended_at":null,
        "stop_reason":null,"started_from":"mac","processing":{},"review_state":"offen"}}
        """
    }

    private func online(_ h: SyncHarness, log: InboundLog) async {
        h.engine.onInbound = { log.items.append($0) }
        h.start()
        let up = await eventually { h.engine.state == .online }
        XCTAssertTrue(up)
    }

    func testTheEngineReportsEveryWelcomeAsConnected() async {
        let h = SyncHarness()
        let log = InboundLog()
        await online(h, log: log)
        XCTAssertEqual(log.items, [.connected])
    }

    func testSlideChangeArrivesWithSlideIDOrIndexOnly() async {
        let h = SyncHarness()
        let log = InboundLog()
        await online(h, log: log)
        let socket = h.factory.sockets[0]
        socket.push(slideChange(seq: 4, slideID: "019a4e14-0000-7000-8000-000000000041", index: 12))
        socket.push(slideChange(seq: 5, slideID: nil, index: 3))
        let got = await eventually { log.items.count == 3 }
        XCTAssertTrue(got)
        XCTAssertEqual(
            log.items[1],
            .op(stream: stream, seq: 4, slide: SlideBrief(slideID: "019a4e14-0000-7000-8000-000000000041", index: 12)))
        XCTAssertEqual(log.items[2], .op(stream: stream, seq: 5, slide: SlideBrief(slideID: nil, index: 3)))
    }

    func testAnUnknownKindStillCountsItsSeq() async {
        let h = SyncHarness()
        let log = InboundLog()
        await online(h, log: log)
        h.factory.sockets[0].push(
            """
            {"type":"op","op_id":"019a4e14-0000-7000-8000-000000000999","stream":"\(stream)","seq":7,
            "kind":"future.kind","at":1,"clock_uncertain":false,"data":{}}
            """)
        let got = await eventually { log.items.count == 2 }
        XCTAssertTrue(got)
        XCTAssertEqual(log.items[1], .op(stream: stream, seq: 7, slide: nil))
    }

    func testSessionUpdatedAndSubscribedArrive() async {
        let h = SyncHarness()
        let log = InboundLog()
        await online(h, log: log)
        let socket = h.factory.sockets[0]
        socket.push(sessionUpdated(state: "pausiert"))
        socket.push(
            """
            {"type":"subscribed","resume":[{"stream":"\(stream)","from_seq":1,"head_seq":0,"reset":true}]}
            """)
        let got = await eventually { log.items.count == 3 }
        XCTAssertTrue(got)
        guard case .sessionUpdated(let brief) = log.items[1] else { return XCTFail("kein session.updated") }
        XCTAssertEqual(brief.id, sessionID)
        XCTAssertEqual(brief.state, "pausiert")
        XCTAssertTrue(brief.isActive)
        XCTAssertEqual(brief.slideDeckID, "019a4e14-0000-7000-8000-000000000040")
        XCTAssertEqual(brief.startedAtMS, 1_793_776_562_123)
        XCTAssertEqual(log.items[2], .subscribed(stream: stream, reset: true))
    }

    func testAnEndedSessionIsNotActive() async {
        let h = SyncHarness()
        let log = InboundLog()
        await online(h, log: log)
        h.factory.sockets[0].push(sessionUpdated(state: "beendet"))
        let got = await eventually { log.items.count == 2 }
        XCTAssertTrue(got)
        guard case .sessionUpdated(let brief) = log.items[1] else { return XCTFail("kein session.updated") }
        XCTAssertFalse(brief.isActive)
    }

    func testIncomingOperationsNeverTouchTheLibraryOrTheQueue() async {
        let h = SyncHarness()
        // Eine lokale, noch nicht bestätigte Änderung wartet
        XCTAssertTrue(h.service.setTemplate(pageID: h.binding.pageID, .kariert))
        h.factory.configure = { socket, _ in
            socket.opPolicy = { _, _, _ in .silent }
        }
        let log = InboundLog()
        await online(h, log: log)
        let before = h.library.page(h.binding.pageID)
        let pendingBefore = h.engine.pendingCount

        let socket = h.factory.sockets[0]
        socket.push(slideChange(seq: 4, slideID: "019a4e14-0000-7000-8000-000000000041", index: 1))
        socket.push(slideChange(seq: 4, slideID: "019a4e14-0000-7000-8000-000000000041", index: 1))
        let got = await eventually { log.items.count == 3 }
        XCTAssertTrue(got)

        // Idempotent von der Seite der Engine: Dieselbe Nachricht zweimal ändert nichts, es entsteht keine Operation
        XCTAssertEqual(h.library.page(h.binding.pageID), before)
        XCTAssertEqual(h.engine.pendingCount, pendingBefore)
        XCTAssertEqual(h.engine.deadLetterCount, 0)
        XCTAssertEqual(h.factory.sockets[0].types.filter { $0 == "ack" }.count, 0)
    }

    // MARK: Abonnieren

    func testSubscribeAndUnsubscribeGoOutOnlyAfterTheWelcome() async throws {
        let h = SyncHarness()
        // Ohne Verbindung passiert nichts
        h.engine.subscribe(stream: stream, lastSeq: 5, lastOpID: "op-5")
        XCTAssertTrue(h.factory.sockets.isEmpty)

        let log = InboundLog()
        await online(h, log: log)
        let socket = h.factory.sockets[0]
        XCTAssertFalse(socket.types.contains("subscribe"))

        h.engine.subscribe(stream: stream, lastSeq: 5, lastOpID: "op-5")
        let sent = await eventually { socket.types.contains("subscribe") }
        XCTAssertTrue(sent)
        let message = try XCTUnwrap(socket.messages.first { $0["type"] as? String == "subscribe" })
        let streams = try XCTUnwrap(message["streams"] as? [[String: Any]])
        XCTAssertEqual(streams.count, 1)
        XCTAssertEqual(streams.first?["stream"] as? String, stream)
        XCTAssertEqual(streams.first?["last_seq"] as? Int, 5)
        XCTAssertEqual(streams.first?["last_op_id"] as? String, "op-5")

        h.engine.unsubscribe(stream: stream)
        let left = await eventually { socket.types.contains("unsubscribe") }
        XCTAssertTrue(left)
        let off = try XCTUnwrap(socket.messages.first { $0["type"] as? String == "unsubscribe" })
        XCTAssertEqual(off["streams"] as? [String], [stream])
    }

    func testTheHelloStillSubscribesToNothing() async throws {
        let h = SyncHarness()
        let log = InboundLog()
        await online(h, log: log)
        let hello = try XCTUnwrap(h.factory.sockets[0].messages.first { $0["type"] as? String == "hello" })
        XCTAssertEqual((hello["streams"] as? [Any])?.count, 0)
    }
}
