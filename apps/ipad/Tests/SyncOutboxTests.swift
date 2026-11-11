import XCTest

@testable import StudienGehirn

@MainActor
final class SyncOutboxTests: XCTestCase {
    private func makeDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("outbox-test-\(UUID().uuidString)", isDirectory: true)
    }

    private func draft(_ index: Int, page: String? = "page-1", uncertain: Bool = true) -> OutboxDraft {
        OutboxDraft(
            opID: "op-\(index)",
            stream: "notebook:n1",
            kind: "stroke.add",
            pageID: page,
            json: "{\"n\":\(index)}",
            clockUncertain: uncertain,
            sessionStartMS: nil
        )
    }

    func testAppendSurvivesANewInstance() throws {
        let directory = makeDirectory()
        let outbox = SyncOutbox(directory: directory)
        let entries = try outbox.append([draft(1), draft(2), draft(3)])
        XCTAssertEqual(entries.map(\.number), [1, 2, 3])
        XCTAssertEqual(outbox.lastNumber, 3)

        let reopened = SyncOutbox(directory: directory)
        XCTAssertEqual(reopened.pending, entries)
        XCTAssertEqual(reopened.lastNumber, 3)
        XCTAssertEqual(reopened.mark(forPage: "page-1"), 3)
        XCTAssertEqual(reopened.mark(forPage: "other"), 0)
    }

    func testAcknowledgeRemovesTheEntryAlsoAfterARestart() throws {
        let directory = makeDirectory()
        let outbox = SyncOutbox(directory: directory)
        try outbox.append([draft(1), draft(2), draft(3)])
        XCTAssertTrue(outbox.acknowledge(opID: "op-2"))
        XCTAssertFalse(outbox.acknowledge(opID: "op-2"))
        XCTAssertEqual(outbox.pending.map(\.opID), ["op-1", "op-3"])

        let reopened = SyncOutbox(directory: directory)
        XCTAssertEqual(reopened.pending.map(\.opID), ["op-1", "op-3"])
    }

    func testIgnoresAndRemovesATornLastLine() throws {
        let directory = makeDirectory()
        let outbox = SyncOutbox(directory: directory)
        try outbox.append([draft(1), draft(2)])

        // Absturz mitten im Schreiben: halbe Zeile ohne Zeilenumbruch
        let file = directory.appendingPathComponent("outbox.jsonl")
        let handle = try FileHandle(forWritingTo: file)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data("{\"t\":\"put\",\"e\":{\"num".utf8))
        try handle.close()

        let reopened = SyncOutbox(directory: directory)
        XCTAssertEqual(reopened.pending.map(\.opID), ["op-1", "op-2"])

        // Neue Zeilen hängen sich sauber an, der Rest ist abgeschnitten
        try reopened.append([draft(3)])
        let third = SyncOutbox(directory: directory)
        XCTAssertEqual(third.pending.map(\.opID), ["op-1", "op-2", "op-3"])
        XCTAssertEqual(third.lastNumber, 3)
    }

    func testNumbersAreNeverReused() throws {
        let directory = makeDirectory()
        let outbox = SyncOutbox(directory: directory)
        try outbox.append([draft(1), draft(2)])
        outbox.acknowledge(opID: "op-1")
        outbox.acknowledge(opID: "op-2")

        let reopened = SyncOutbox(directory: directory)
        XCTAssertTrue(reopened.pending.isEmpty)
        let entry = try XCTUnwrap(try reopened.append([draft(3)]).first)
        XCTAssertEqual(entry.number, 3)
    }

    func testCompactionKeepsLastNumberAndMarks() throws {
        let directory = makeDirectory()
        let outbox = SyncOutbox(directory: directory)
        try outbox.append((1...600).map { draft($0) })
        for index in 1...599 {
            outbox.acknowledge(opID: "op-\(index)")
        }
        XCTAssertEqual(outbox.pending.map(\.opID), ["op-600"])

        // Die Datei wurde verdichtet: Kopfzeile plus offene Operation, danach nur noch wenige `ack`
        let text = try String(contentsOf: directory.appendingPathComponent("outbox.jsonl"), encoding: .utf8)
        let lines = text.split(separator: "\n")
        XCTAssertLessThan(lines.count, 300)
        XCTAssertTrue(lines.contains { $0.contains("\"t\":\"head\"") })

        let reopened = SyncOutbox(directory: directory)
        XCTAssertEqual(reopened.pending.map(\.opID), ["op-600"])
        XCTAssertEqual(reopened.lastNumber, 600)
        XCTAssertEqual(reopened.mark(forPage: "page-1"), 600)

        // Auch wenn alles bestätigt ist, bleiben Nummer und Marke
        reopened.acknowledge(opID: "op-600")
        for index in 601...1200 {
            try reopened.append([draft(index)])
            reopened.acknowledge(opID: "op-\(index)")
        }
        let last = SyncOutbox(directory: directory)
        XCTAssertTrue(last.pending.isEmpty)
        XCTAssertEqual(last.lastNumber, 1200)
        XCTAssertEqual(last.mark(forPage: "page-1"), 1200)
    }

    func testRewriteSurvivesARestartAndKeepsTheOrder() throws {
        let directory = makeDirectory()
        let outbox = SyncOutbox(directory: directory)
        try outbox.append([draft(1), draft(2), draft(3)])
        var changed = try XCTUnwrap(outbox.pending.first { $0.opID == "op-2" })
        changed.json = "{\"n\":2,\"fixed\":true}"
        changed.clockUncertain = false
        try outbox.rewrite(changed)

        let reopened = SyncOutbox(directory: directory)
        XCTAssertEqual(reopened.pending.map(\.opID), ["op-1", "op-2", "op-3"])
        XCTAssertEqual(reopened.pending[1], changed)
        XCTAssertEqual(reopened.pending[1].number, 2)
    }

    func testDeadLetterCountsAndSurvivesARestart() throws {
        let directory = makeDirectory()
        let outbox = SyncOutbox(directory: directory)
        try outbox.append([draft(1), draft(2), draft(3)])
        let moved = try outbox.moveToDeadLetter(opIDs: ["op-2", "unbekannt"], code: "message_invalid", message: "kaputt")
        XCTAssertEqual(moved, 1)
        XCTAssertEqual(outbox.deadLetterCount, 1)
        XCTAssertEqual(outbox.pending.map(\.opID), ["op-1", "op-3"])

        let reopened = SyncOutbox(directory: directory)
        XCTAssertEqual(reopened.deadLetterCount, 1)
        XCTAssertEqual(reopened.pending.map(\.opID), ["op-1", "op-3"])

        let text = try String(contentsOf: reopened.deadLetterURL, encoding: .utf8)
        let record = try JSONDecoder().decode(
            DeadLetterRecord.self, from: Data(try XCTUnwrap(text.split(separator: "\n").first).utf8))
        XCTAssertEqual(record.code, "message_invalid")
        XCTAssertEqual(record.message, "kaputt")
        XCTAssertEqual(record.entry.opID, "op-2")
        XCTAssertFalse(record.at.isEmpty)
    }
}

final class SyncClockBackoffTests: XCTestCase {
    func testClockUsesTheMedianOfFiveOffsets() {
        var clock = SyncClock()
        // Mitte der Umlaufzeit: 1050. Versätze: 10, 50, 30, 20, 40
        for (offset, rtt) in [(10, 100), (50, 300), (30, 80), (20, 120), (40, 90)] {
            let t0 = 1000
            let t1 = t0 + rtt
            clock.add(t0: t0, t1: t1, ts: (t0 + t1) / 2 + offset)
        }
        XCTAssertTrue(clock.isComplete)
        XCTAssertEqual(clock.offsetMS, 30)
        XCTAssertEqual(clock.rttMS, 100)
    }

    func testClockIsIncompleteBeforeFiveSamplesAndResets() {
        var clock = SyncClock()
        XCTAssertNil(clock.offsetMS)
        clock.add(t0: 0, t1: 10, ts: 505)
        XCTAssertFalse(clock.isComplete)
        XCTAssertEqual(clock.offsetMS, 500)
        clock.reset()
        XCTAssertNil(clock.offsetMS)
    }

    func testMedianOfAnEvenCountIsTheMeanOfTheMiddleValues() {
        XCTAssertEqual(SyncClock.median([4, 1, 3, 2]), 3)
        XCTAssertNil(SyncClock.median([]))
    }

    func testBackoffDoublesUpToThirtySecondsAndResets() {
        var backoff = SyncBackoff()
        let seconds = (0..<8).map { _ in backoff.next(jitter: 0) }
        XCTAssertEqual(
            seconds,
            [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000].map { Duration.milliseconds($0) })
        backoff.reset()
        XCTAssertEqual(backoff.next(jitter: 0), .milliseconds(1000))
    }

    func testBackoffSubtractsUpToTwentyFivePercentJitter() {
        var backoff = SyncBackoff()
        XCTAssertEqual(backoff.next(jitter: 1), .milliseconds(750))
        XCTAssertEqual(backoff.next(jitter: 0.5), .milliseconds(1750))
        // Außerhalb von 0 ... 1 wird begrenzt
        XCTAssertEqual(backoff.next(jitter: 7), .milliseconds(3000))
        // Die Grenze von 30 s gilt auch mit Zufall
        for _ in 0..<5 { _ = backoff.next(jitter: 0) }
        XCTAssertEqual(backoff.next(jitter: 0), .milliseconds(30000))
        XCTAssertEqual(backoff.next(jitter: 1), .milliseconds(22500))
    }
}

final class InkOpBuilderTests: XCTestCase {
    private let binding = InkBinding(
        notebookID: "019a4e14-0000-7000-8000-0000000000a2",
        pageID: "019a4e14-0000-7000-8000-0000000000b1",
        moduleID: "019a4e14-0000-7000-8000-0000000000c1",
        pageCreated: false,
        needsReconcile: false,
        sessionID: "019a4e14-0000-7000-8000-0000000000d1",
        sessionStartMS: 8000
    )

    private func stroke(_ id: String = "019a4e14-0000-7000-8000-0000000000f1", tStart: Int? = nil) -> Stroke {
        Stroke(
            bbox: [0, 0, 10, 10],
            clientID: id,
            color: "#000000FF",
            createdAt: 10_000,
            layer: .ink,
            points: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            tEndMS: tStart.map { $0 + 500 },
            tStartMS: tStart,
            tool: .pen,
            transform: [1, 0, 0, 1, 0, 0],
            width: 2
        )
    }

    private final class IDs {
        private var next = 0
        func make() -> String {
            next += 1
            return String(format: "019a4e14-0000-7000-8000-%012x", next)
        }
    }

    private func object(_ draft: OutboxDraft) throws -> [String: Any] {
        try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(draft.json.utf8)) as? [String: Any])
    }

    func testStrokeAddHasNoServerFieldsAndKeepsRequiredNulls() throws {
        let ids = IDs()
        let drafts = InkOpBuilder.ops(
            for: [.upsert(stroke())], binding: binding, nowMS: 5000, offsetMS: nil, makeID: ids.make)
        let draft = try XCTUnwrap(drafts.first)
        let json = try object(draft)

        XCTAssertEqual(json["type"] as? String, "op")
        XCTAssertEqual(json["kind"] as? String, "stroke.add")
        XCTAssertEqual(json["stream"] as? String, "notebook:\(binding.notebookID)")
        XCTAssertEqual(json["at"] as? Int, 5000)
        XCTAssertEqual(json["clock_uncertain"] as? Bool, true)
        XCTAssertNil(json["seq"])
        XCTAssertNil(json["origin"])
        let opID = try XCTUnwrap(json["op_id"] as? String)
        XCTAssertEqual(opID, opID.lowercased())
        XCTAssertEqual(draft.opID, opID)
        XCTAssertEqual(draft.kind, "stroke.add")
        XCTAssertEqual(draft.pageID, binding.pageID)

        let data = try XCTUnwrap(json["data"] as? [String: Any])
        XCTAssertEqual(data["page_id"] as? String, binding.pageID)
        let wire = try XCTUnwrap(data["stroke"] as? [String: Any])
        // Pflichtfelder mit `null` müssen vorhanden sein
        XCTAssertTrue(wire["t_start_ms"] is NSNull)
        XCTAssertTrue(wire["t_end_ms"] is NSNull)
        XCTAssertEqual(wire["client_id"] as? String, stroke().clientID)
    }

    func testStrokeRemoveCarriesTheClientIDs() throws {
        let ids = IDs()
        let drafts = InkOpBuilder.ops(
            for: [.remove(["a", "b"])], binding: binding, nowMS: 5000, offsetMS: nil, makeID: ids.make)
        let json = try object(try XCTUnwrap(drafts.first))
        XCTAssertEqual(json["kind"] as? String, "stroke.remove")
        let data = try XCTUnwrap(json["data"] as? [String: Any])
        XCTAssertEqual(data["client_ids"] as? [String], ["a", "b"])
        XCTAssertEqual(data["page_id"] as? String, binding.pageID)
    }

    func testLargeRemovalsAreSplit() {
        let ids = IDs()
        let many = (0..<1200).map { "id-\($0)" }
        let drafts = InkOpBuilder.ops(
            for: [.remove(many)], binding: binding, nowMS: 5000, offsetMS: nil, makeID: ids.make)
        XCTAssertEqual(drafts.count, 3)
        XCTAssertEqual(Set(drafts.map(\.opID)).count, 3)
    }

    func testPageCreateIsBlankA4WithNulls() throws {
        let ids = IDs()
        let draft = try XCTUnwrap(
            InkOpBuilder.pageCreate(binding: binding, index: 4, nowMS: 5000, offsetMS: nil, makeID: ids.make))
        let json = try object(draft)
        XCTAssertEqual(json["kind"] as? String, "page.create")
        XCTAssertEqual(json["stream"] as? String, "notebook:\(binding.notebookID)")
        let data = try XCTUnwrap(json["data"] as? [String: Any])
        XCTAssertEqual(data["index"] as? Int, 4)
        XCTAssertEqual(data["template"] as? String, "blanko")
        XCTAssertEqual(data["width_pt"] as? Double, 595)
        XCTAssertEqual(data["height_pt"] as? Double, 842)
        XCTAssertEqual(data["page_id"] as? String, binding.pageID)
        XCTAssertEqual(data["notebook_id"] as? String, binding.notebookID)
        XCTAssertEqual(data["session_id"] as? String, binding.sessionID)
        XCTAssertTrue(data["attached_slide_id"] is NSNull)
        XCTAssertTrue(data["background_slide_id"] is NSNull)
    }

    func testCorrectMovesTimesByTheOffsetAndIsIdempotent() throws {
        let ids = IDs()
        // Strich entstand bei 10 000 (Uhr des iPad), Sitzungsstart auf der Uhr des Mac: 8000
        let drafts = InkOpBuilder.ops(
            for: [.upsert(stroke(tStart: 2000))], binding: binding, nowMS: 5000, offsetMS: nil,
            makeID: ids.make)
        let draft = try XCTUnwrap(drafts.first)
        XCTAssertTrue(draft.clockUncertain)
        XCTAssertEqual(draft.sessionStartMS, 8000)
        let entry = OutboxEntry(
            number: 1, opID: draft.opID, stream: draft.stream, kind: draft.kind, pageID: draft.pageID,
            json: draft.json, clockUncertain: true, sessionStartMS: draft.sessionStartMS)

        let fixed = try XCTUnwrap(InkOpBuilder.correct(entry, offsetMS: 1500))
        XCTAssertFalse(fixed.clockUncertain)
        XCTAssertEqual(fixed.number, 1)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(fixed.json.utf8)) as? [String: Any])
        XCTAssertEqual(json["at"] as? Int, 6500)
        XCTAssertEqual(json["clock_uncertain"] as? Bool, false)
        let wire = try XCTUnwrap((json["data"] as? [String: Any])?["stroke"] as? [String: Any])
        XCTAssertEqual(wire["created_at"] as? Int, 11_500)
        // t_start = created_at − Sessionstart = 3500, Dauer 500 bleibt
        XCTAssertEqual(wire["t_start_ms"] as? Int, 3500)
        XCTAssertEqual(wire["t_end_ms"] as? Int, 4000)

        // Zweiter Aufruf ändert nichts
        let again = try XCTUnwrap(InkOpBuilder.correct(fixed, offsetMS: 1500))
        XCTAssertEqual(again, fixed)
        let other = try XCTUnwrap(InkOpBuilder.correct(fixed, offsetMS: 99_000))
        XCTAssertEqual(other, fixed)
    }

    func testCorrectClampsSessionTimeAtZero() throws {
        let ids = IDs()
        var early = binding
        early.sessionStartMS = 50_000
        let draft = try XCTUnwrap(
            InkOpBuilder.ops(
                for: [.upsert(stroke(tStart: 0))], binding: early, nowMS: 5000, offsetMS: nil,
                makeID: ids.make
            ).first)
        let entry = OutboxEntry(
            number: 1, opID: draft.opID, stream: draft.stream, kind: draft.kind, pageID: draft.pageID,
            json: draft.json, clockUncertain: true, sessionStartMS: draft.sessionStartMS)
        let fixed = try XCTUnwrap(InkOpBuilder.correct(entry, offsetMS: 1000))
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(fixed.json.utf8)) as? [String: Any])
        let wire = try XCTUnwrap((json["data"] as? [String: Any])?["stroke"] as? [String: Any])
        XCTAssertEqual(wire["t_start_ms"] as? Int, 0)
    }

    func testKnownOffsetCorrectsImmediately() throws {
        let ids = IDs()
        let draft = try XCTUnwrap(
            InkOpBuilder.ops(
                for: [.upsert(stroke())], binding: binding, nowMS: 5000, offsetMS: 1000, makeID: ids.make
            ).first)
        XCTAssertFalse(draft.clockUncertain)
        let json = try object(draft)
        XCTAssertEqual(json["at"] as? Int, 6000)
        XCTAssertEqual(json["clock_uncertain"] as? Bool, false)
        let wire = try XCTUnwrap((json["data"] as? [String: Any])?["stroke"] as? [String: Any])
        XCTAssertEqual(wire["created_at"] as? Int, 11_000)
        // Ohne Sitzungszeit bleiben die Felder `null`
        XCTAssertTrue(wire["t_start_ms"] is NSNull)
    }

    func testCorrectCoversRemoveAndPageCreate() throws {
        let ids = IDs()
        let remove = try XCTUnwrap(
            InkOpBuilder.ops(for: [.remove(["a"])], binding: binding, nowMS: 100, offsetMS: nil, makeID: ids.make)
                .first)
        let create = try XCTUnwrap(
            InkOpBuilder.pageCreate(binding: binding, index: 1, nowMS: 100, offsetMS: nil, makeID: ids.make))
        for draft in [remove, create] {
            let entry = OutboxEntry(
                number: 1, opID: draft.opID, stream: draft.stream, kind: draft.kind, pageID: draft.pageID,
                json: draft.json, clockUncertain: true, sessionStartMS: nil)
            let fixed = try XCTUnwrap(InkOpBuilder.correct(entry, offsetMS: 50))
            let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(fixed.json.utf8)) as? [String: Any])
            XCTAssertEqual(json["at"] as? Int, 150)
            XCTAssertEqual(json["clock_uncertain"] as? Bool, false)
        }
    }
}

final class InkReconcilerTests: XCTestCase {
    private func stroke(
        _ id: String, color: String = "#000000FF", width: Double = 2, points: String = "AAAA",
        transform: [Double] = [1, 0, 0, 1, 0, 0]
    ) -> Stroke {
        Stroke(
            bbox: [0, 0, 1, 1], clientID: id, color: color, createdAt: 1, layer: .ink, points: points,
            tEndMS: nil, tStartMS: nil, tool: .pen, transform: transform, width: width)
    }

    private func describe(_ changes: [InkStrokeChange]) -> [String] {
        changes.map { change in
            switch change {
            case .upsert(let stroke): return "up:\(stroke.clientID)"
            case .remove(let ids): return "rm:\(ids.joined(separator: ","))"
            }
        }
    }

    func testUnknownPageSendsEverything() {
        let plan = InkReconciler.plan(local: [stroke("a"), stroke("b")], server: nil)
        XCTAssertEqual(describe(plan), ["up:a", "up:b"])
    }

    func testSameStateGivesAnEmptyPlan() {
        let local = [stroke("a"), stroke("b")]
        XCTAssertTrue(InkReconciler.plan(local: local, server: local).isEmpty)
        // Der Core rundet auf float4: kleine Abweichungen zählen nicht
        let server = [stroke("a", width: 2.000_000_1), stroke("b", color: "#000000ff")]
        XCTAssertTrue(InkReconciler.plan(local: local, server: server).isEmpty)
    }

    func testMissingDifferingAndExtraStrokes() {
        let local = [stroke("a"), stroke("b"), stroke("c"), stroke("d", transform: [1, 0, 0, 1, 5, 5])]
        let server = [
            stroke("a"),  // gleich
            stroke("b", color: "#FF0000FF"),  // abweichende Farbe
            stroke("d"),  // abweichende Transformation
            stroke("z"), stroke("y"),  // nur auf dem Server
        ]
        let plan = InkReconciler.plan(local: local, server: server)
        XCTAssertEqual(describe(plan), ["up:b", "up:c", "up:d", "rm:y,z"])
    }

    func testDifferentPointsCountAsDifferent() {
        let plan = InkReconciler.plan(local: [stroke("a", points: "AAAA")], server: [stroke("a", points: "BBBB")])
        XCTAssertEqual(describe(plan), ["up:a"])
    }

    func testEmptyServerPageSendsAllLocalStrokes() {
        let plan = InkReconciler.plan(local: [stroke("a")], server: [])
        XCTAssertEqual(describe(plan), ["up:a"])
    }
}
