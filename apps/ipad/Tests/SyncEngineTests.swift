import XCTest

@testable import StudienGehirn

@MainActor
final class SyncEngineTests: XCTestCase {
    private let sessionJSON = """
        {"id":"019a4e14-0000-7000-8000-0000000000d1","user_id":"019a4e14-0000-7000-8000-000000000001",
        "module_id":"019a4e14-0000-7000-8000-0000000000c1","created_at":"2026-11-04T07:15:00Z",
        "updated_at":"2026-11-04T07:15:00Z","deleted_at":null,"state":"laeuft",
        "started_at":"2026-11-11T08:00:00Z","processing":{},"review_state":"offen"}
        """

    private func notebookJSON(id: String, kind: String) -> String {
        """
        {"id":"\(id)","user_id":"019a4e14-0000-7000-8000-000000000001","module_id":"019a4e14-0000-7000-8000-0000000000c1",
        "kind":"\(kind)","title":"Vorlesung","page_count":0,"created_at":"2026-11-04T07:15:00Z",
        "updated_at":"2026-11-04T07:15:00Z","deleted_at":null}
        """
    }

    // MARK: (a) Reihenfolge nach dem Verbinden

    func testSendsHelloThenClockThenPresenceThenOperations() async throws {
        let h = SyncHarness()
        h.enqueueStrokes(2)
        h.engine.setPresence(
            SyncPresenceTarget(sessionID: nil, notebookID: h.binding.notebookID, pageID: h.binding.pageID))
        h.start()

        let finished = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(finished)
        XCTAssertEqual(h.engine.state, .online)

        let socket = try XCTUnwrap(h.factory.sockets.first)
        XCTAssertEqual(
            socket.types,
            ["hello"] + Array(repeating: "time.ping", count: 5) + ["time.offset", "presence", "op", "op"])

        let hello = try XCTUnwrap(socket.messages.first)
        XCTAssertEqual(hello["protocol"] as? Int, 1)
        XCTAssertEqual(hello["client"] as? String, "ipad")
        XCTAssertEqual(hello["device_id"] as? String, Fixtures.deviceID)
        XCTAssertEqual(hello["app_version"] as? String, "1.2.3")
        XCTAssertEqual((hello["streams"] as? [Any])?.count, 0)

        let offset = try XCTUnwrap(socket.messages.first { $0["type"] as? String == "time.offset" })
        XCTAssertEqual(offset["offset_ms"] as? Int, 2000)

        // Vor dem Senden einmalig auf die synchronisierte Zeit gebracht
        let op = try XCTUnwrap(socket.ops.first?.object)
        XCTAssertEqual(op["clock_uncertain"] as? Bool, false)
        XCTAssertEqual(op["at"] as? Int, 1_762_246_500_000 + 2000)
        XCTAssertNil(op["seq"])
        XCTAssertNil(op["origin"])
    }

    // MARK: (b) Fenster

    func testKeepsAtMost200OperationsInFlight() async throws {
        let h = SyncHarness()
        h.factory.configure = { socket, _ in socket.opPolicy = { _, _, _ in .silent } }
        h.enqueueStrokes(250)
        h.start()

        let sent200 = await eventually { h.factory.sockets.first?.ops.count == 200 }
        XCTAssertTrue(sent200)
        await h.clock.settle()
        let socket = try XCTUnwrap(h.factory.sockets.first)
        XCTAssertEqual(socket.ops.count, 200)

        // Ein `ack` macht Platz für genau eine weitere
        socket.ack(socket.opIDs[0])
        let sent201 = await eventually { socket.ops.count == 201 }
        XCTAssertTrue(sent201)
        await h.clock.settle()
        XCTAssertEqual(socket.ops.count, 201)
        XCTAssertEqual(h.engine.pendingCount, 249)
    }

    // MARK: (c) Trennung mitten im Senden

    func testResendsOnlyTheUnacknowledgedOperationsWithTheSameJSON() async throws {
        let h = SyncHarness()
        h.factory.configure = { socket, index in
            if index == 0 {
                socket.opPolicy = { _, _, i in i < 3 ? .ack : .silent }
            }
        }
        h.enqueueStrokes(5)
        h.start()

        let first = try await waitForSocket(h, index: 0)
        let acked = await eventually { h.engine.pendingCount == 2 && first.ops.count == 5 }
        XCTAssertTrue(acked)

        first.fail(.closed(code: 4503))
        let waiting = await eventually { h.engine.state == .waiting }
        XCTAssertTrue(waiting)
        XCTAssertEqual(h.factory.sockets.count, 1)

        await h.clock.advance(1.5)
        let second = try await waitForSocket(h, index: 1)
        let done = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(done)

        XCTAssertEqual(second.ops.count, 2)
        XCTAssertEqual(second.opIDs, Array(first.opIDs[3...]))
        XCTAssertEqual(second.ops.map(\.text), first.ops.suffix(2).map(\.text))
        // (h) Nie zwei Verbindungen gleichzeitig
        XCTAssertEqual(h.factory.maxOpenAtOpen, 0)
    }

    // MARK: (d) Ablehnung

    func testRejectedOperationGoesToDeadLetterAndTheRestContinues() async throws {
        let h = SyncHarness()
        h.factory.configure = { socket, _ in
            socket.opPolicy = { _, _, index in
                index == 1 ? .error(code: "message_invalid", retryable: false, fatal: false) : .ack
            }
        }
        h.enqueueStrokes(3)
        h.start()

        let done = await eventually { h.engine.pendingCount == 0 && h.engine.deadLetterCount == 1 }
        XCTAssertTrue(done)
        XCTAssertEqual(h.factory.sockets.count, 1)

        let text = try String(contentsOf: h.engine.deadLetterURL, encoding: .utf8)
        let record = try JSONDecoder().decode(
            DeadLetterRecord.self, from: Data(try XCTUnwrap(text.split(separator: "\n").first).utf8))
        XCTAssertEqual(record.code, "message_invalid")
        XCTAssertEqual(record.entry.opID, h.factory.sockets[0].opIDs[1])
    }

    func testRejectedPageCreateTakesItsStrokesAlong() async throws {
        let h = SyncHarness()
        h.factory.configure = { socket, _ in
            socket.opPolicy = { _, kind, _ in
                kind == "page.create"
                    ? .error(code: "notebook_not_found", retryable: false, fatal: false)
                    : .error(code: "page_not_found", retryable: false, fatal: false)
            }
        }
        let draft = try XCTUnwrap(
            InkOpBuilder.pageCreate(
                binding: h.binding, index: 1, nowMS: 1_762_246_500_000, offsetMS: nil,
                makeID: { InkID.uuidV7() }))
        try h.outbox.append([draft])
        h.enqueueStrokes(2)
        h.start()

        let done = await eventually { h.engine.pendingCount == 0 && h.engine.deadLetterCount == 3 }
        XCTAssertTrue(done)
        // Die Bindung gilt nicht mehr
        XCTAssertNil(h.bindings.binding(forPage: h.binding.pageID))
    }

    // MARK: (e) Wiederholbare Fehler

    func testBacksOffExponentiallyAfter4503() async throws {
        let h = SyncHarness()
        h.start()
        let first = try await waitForSocket(h, index: 0)
        _ = await eventually { h.engine.state == .online }

        first.fail(.closed(code: 4503))
        _ = await eventually { h.engine.state == .waiting }
        await h.clock.advance(0.5)
        XCTAssertEqual(h.factory.sockets.count, 1)
        await h.clock.advance(1)
        let second = try await waitForSocket(h, index: 1)

        // Ohne `ack` oder `pong` zwischendurch wartet der nächste Versuch doppelt so lange
        second.fail(.closed(code: 4503))
        _ = await eventually { h.engine.state == .waiting }
        await h.clock.advance(1.5)
        XCTAssertEqual(h.factory.sockets.count, 2)
        await h.clock.advance(1)
        _ = try await waitForSocket(h, index: 2)
        XCTAssertEqual(h.factory.maxOpenAtOpen, 0)
    }

    func testPoisonOperationGoesToDeadLetterAfterFiveInternalErrors() async throws {
        let h = SyncHarness()
        h.factory.configure = { socket, _ in
            socket.opPolicy = { _, _, _ in .error(code: "internal_error", retryable: true, fatal: true) }
        }
        h.enqueueStrokes(1)
        h.start()

        for _ in 0..<8 {
            _ = await eventually { h.engine.state == .waiting }
            if h.engine.deadLetterCount == 1 { break }
            await h.clock.advance(40)
        }
        XCTAssertEqual(h.engine.deadLetterCount, 1)
        XCTAssertEqual(h.engine.pendingCount, 0)
        let attempts = h.factory.sockets.reduce(0) { $0 + $1.ops.count }
        XCTAssertEqual(attempts, 5)
        XCTAssertEqual(h.factory.maxOpenAtOpen, 0)
    }

    // MARK: (f) Widerrufenes Token

    func testCloseCode4401StopsTheEngineAndKeepsTheQueue() async throws {
        let h = SyncHarness()
        h.factory.configure = { socket, _ in socket.initialFailure = .closed(code: 4401) }
        h.enqueueStrokes(2)
        h.start()

        let invalid = await eventually { h.engine.state == .tokenInvalid }
        XCTAssertTrue(invalid)
        await h.clock.advance(100)
        XCTAssertEqual(h.factory.sockets.count, 1)
        XCTAssertEqual(h.engine.pendingCount, 2)
        XCTAssertEqual(h.engine.state, .tokenInvalid)
    }

    func testHTTP401OnUpgradeStopsTheEngine() async throws {
        let h = SyncHarness()
        h.factory.configure = { socket, _ in socket.initialFailure = .rejected(status: 401) }
        h.enqueueStrokes(1)
        h.start()

        let invalid = await eventually { h.engine.state == .tokenInvalid }
        XCTAssertTrue(invalid)
        await h.clock.advance(100)
        XCTAssertEqual(h.factory.sockets.count, 1)
        XCTAssertEqual(h.engine.pendingCount, 1)
    }

    func testUnclearUpgradeFailureAsksHealthAndStopsOn401() async throws {
        let h = SyncHarness(health: [.http(status: 401, body: Fixtures.apiError("device_token_invalid"))])
        h.factory.configure = { socket, _ in
            socket.initialFailure = .transport(URLError(.badServerResponse))
        }
        h.start()

        let invalid = await eventually { h.engine.state == .tokenInvalid }
        XCTAssertTrue(invalid)
        XCTAssertEqual(h.transport.requests.first?.url?.path, "/api/v1/health")
        await h.clock.advance(100)
        XCTAssertEqual(h.factory.sockets.count, 1)
    }

    func testCloseCode4426ShowsUnsupported() async throws {
        let h = SyncHarness()
        h.factory.configure = { socket, _ in socket.initialFailure = .closed(code: 4426) }
        h.start()

        let unsupported = await eventually { h.engine.state == .unsupported }
        XCTAssertTrue(unsupported)
        await h.clock.advance(100)
        XCTAssertEqual(h.factory.sockets.count, 1)
    }

    func testStartingAgainAfterATokenFailureReconnects() async throws {
        let h = SyncHarness()
        h.factory.configure = { socket, index in
            if index == 0 { socket.initialFailure = .closed(code: 4401) }
        }
        h.start()
        _ = await eventually { h.engine.state == .tokenInvalid }

        // Neu gekoppelt
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
        XCTAssertEqual(h.factory.sockets.count, 2)
    }

    // MARK: (g) Keepalive

    func testReconnectsAfter45SecondsWithoutPong() async throws {
        let h = SyncHarness()
        h.factory.configure = { socket, index in
            if index == 0 { socket.answersPing = false }
        }
        h.start()
        let first = try await waitForSocket(h, index: 0)
        _ = await eventually { h.engine.state == .online }

        await h.clock.advance(15)
        await h.clock.advance(15)
        XCTAssertFalse(first.isClosed)
        XCTAssertEqual(first.types.filter { $0 == "ping" }.count, 2)

        await h.clock.advance(15)
        XCTAssertTrue(first.isClosed)
        let waiting = await eventually { h.engine.state == .waiting }
        XCTAssertTrue(waiting)

        await h.clock.advance(1.5)
        _ = try await waitForSocket(h, index: 1)
        XCTAssertEqual(h.factory.maxOpenAtOpen, 0)
    }

    func testAnsweredPingsKeepTheConnectionOpen() async throws {
        let h = SyncHarness()
        h.start()
        let first = try await waitForSocket(h, index: 0)
        _ = await eventually { h.engine.state == .online }

        for _ in 0..<6 {
            await h.clock.advance(15)
        }
        XCTAssertFalse(first.isClosed)
        XCTAssertEqual(h.factory.sockets.count, 1)
        XCTAssertEqual(first.types.filter { $0 == "ping" }.count, 6)
    }

    // MARK: (i) db_epoch

    func testNewDBEpochMarksAllBindingsForReconcile() async throws {
        let h = SyncHarness()
        h.bindings.dbEpoch = "epoch-alt"
        h.factory.configure = { socket, _ in socket.epoch = "epoch-neu" }
        h.start()

        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
        XCTAssertEqual(h.bindings.dbEpoch, "epoch-neu")
        XCTAssertTrue(h.bindings.binding(forPage: h.binding.pageID)?.needsReconcile ?? false)
        XCTAssertTrue(h.engine.bindingNeedsReconcile(pageID: h.binding.pageID))
    }

    func testFirstEpochIsStoredWithoutReconcile() async throws {
        let h = SyncHarness()
        h.start()

        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
        XCTAssertEqual(h.bindings.dbEpoch, "epoch-1")
        XCTAssertFalse(h.engine.bindingNeedsReconcile(pageID: h.binding.pageID))
    }

    // MARK: (j) Offline eingereiht

    func testOperationsQueuedOfflineAreSentAfterConnecting() async throws {
        let h = SyncHarness()
        XCTAssertTrue(h.enqueueStrokes(3))
        XCTAssertEqual(h.engine.pendingCount, 3)
        XCTAssertEqual(h.factory.sockets.count, 0)

        // Die Operationen stehen auf der Platte, bevor etwas gesendet wird
        let reopened = SyncOutbox(directory: h.directory)
        XCTAssertEqual(reopened.pending.count, 3)
        XCTAssertTrue(reopened.pending.allSatisfy { $0.clockUncertain })

        h.start()
        let done = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(done)
        XCTAssertEqual(h.factory.sockets[0].ops.count, 3)
        XCTAssertEqual(SyncOutbox(directory: h.directory).pending.count, 0)
    }

    func testOperationsEnqueuedWhileOnlineAreSentRightAway() async throws {
        let h = SyncHarness()
        h.start()
        _ = await eventually { h.engine.state == .online }

        // Versatz ist bekannt: sofort korrigiert
        XCTAssertTrue(h.enqueueStrokes(1))
        let done = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(done)
        let op = try XCTUnwrap(h.factory.sockets[0].ops.first?.object)
        XCTAssertEqual(op["clock_uncertain"] as? Bool, false)
    }

    // MARK: (k) Token nur im Header

    func testTokenIsOnlyInTheUpgradeHeader() async throws {
        let h = SyncHarness()
        h.enqueueStrokes(1)
        h.start()
        _ = await eventually { h.engine.pendingCount == 0 }

        let request = try XCTUnwrap(h.factory.requests.first)
        XCTAssertEqual(request.url?.absoluteString, "ws://192.0.2.10:4710/sync")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(Fixtures.token)")
        XCTAssertNil(request.value(forHTTPHeaderField: "Origin"))
        for text in h.factory.sockets[0].sent {
            XCTAssertFalse(text.contains(Fixtures.token))
        }
    }

    // MARK: Stopp

    func testStopClosesTheConnectionAndKeepsTheQueue() async throws {
        let h = SyncHarness()
        h.factory.configure = { socket, _ in socket.opPolicy = { _, _, _ in .silent } }
        h.enqueueStrokes(2)
        h.start()
        let first = try await waitForSocket(h, index: 0)
        _ = await eventually { first.ops.count == 2 }

        h.engine.stop()
        XCTAssertEqual(h.engine.state, .stopped)
        XCTAssertTrue(first.isClosed)
        await h.clock.advance(100)
        XCTAssertEqual(h.factory.sockets.count, 1)
        XCTAssertEqual(h.engine.pendingCount, 2)
    }

    func testKickSkipsTheBackoff() async throws {
        let h = SyncHarness()
        h.factory.configure = { socket, index in
            if index == 0 { socket.initialFailure = .closed(code: 1001) }
        }
        h.start()
        _ = await eventually { h.engine.state == .waiting }
        XCTAssertEqual(h.factory.sockets.count, 1)

        h.engine.kick()
        _ = try await waitForSocket(h, index: 1)
    }

    // MARK: Bindung und Abgleich über REST

    func testResolveBindingCreatesPageAndQueuesPageCreateFirst() async throws {
        let notebookID = "019a4e14-0000-7000-8000-0000000000e1"
        let h = SyncHarness(health: [
            .http(status: 200, body: "{\"items\":[\(sessionJSON)],\"next_cursor\":null}"),
            .http(
                status: 200,
                body:
                    "{\"items\":[\(notebookJSON(id: "019a4e14-0000-7000-8000-0000000000e2", kind: "uebung")),\(notebookJSON(id: notebookID, kind: "vorlesung"))],\"next_cursor\":null}"
            ),
            .http(status: 200, body: "{\"id\":\"019a4e14-0000-7000-8000-0000000000c1\",\"name\":\"Analysis I\"}"),
            .http(
                status: 200,
                body: "{\"items\":[],\"notebook_id\":\"\(notebookID)\",\"stream_op_id\":null,\"stream_seq\":0}"),
        ])
        h.start()
        _ = await eventually { h.engine.state == .online }

        let resolvedOrNil = await h.engine.resolveBinding()
        let resolved = try XCTUnwrap(resolvedOrNil)
        XCTAssertEqual(resolved.notebookID, notebookID)
        XCTAssertTrue(resolved.pageCreated)
        XCTAssertEqual(resolved.sessionStartMS, 1_794_384_000_000)
        XCTAssertEqual(h.bindings.lastNotebookID, notebookID)
        XCTAssertEqual(resolved.moduleName, "Analysis I")
        XCTAssertEqual(h.transport.requests.count, 4)
        XCTAssertTrue(h.transport.requests[0].url?.absoluteString.contains("state=laeuft") ?? false)
        XCTAssertTrue(h.transport.requests[2].url?.path.hasSuffix("/modules/019a4e14-0000-7000-8000-0000000000c1") ?? false)

        // `page.create` ging als Erstes raus, mit Index 1 und dem Strom des Notizbuchs
        let sent = await eventually { h.factory.sockets[0].ops.count == 1 }
        XCTAssertTrue(sent)
        let op = try XCTUnwrap(h.factory.sockets[0].ops.first?.object)
        XCTAssertEqual(op["kind"] as? String, "page.create")
        XCTAssertEqual(op["stream"] as? String, "notebook:\(notebookID)")
        let data = try XCTUnwrap(op["data"] as? [String: Any])
        XCTAssertEqual(data["page_id"] as? String, resolved.pageID)
        XCTAssertEqual(data["index"] as? Int, 1)
        XCTAssertEqual(data["template"] as? String, "blanko")
    }

    func testRunningLectureOnlyReadsAndStoresNothing() async throws {
        let notebookID = "019a4e14-0000-7000-8000-0000000000e1"
        let h = SyncHarness(health: [
            .http(status: 200, body: "{\"items\":[\(sessionJSON)],\"next_cursor\":null}"),
            .http(
                status: 200,
                body: "{\"items\":[\(notebookJSON(id: notebookID, kind: "vorlesung"))],\"next_cursor\":null}"),
        ])
        h.start()
        _ = await eventually { h.engine.state == .online }

        let running = await h.engine.runningLectureNotebookID()
        XCTAssertEqual(running, notebookID)
        // Nur Sessions und Notizbücher: kein Modulname, keine Seitenliste
        XCTAssertEqual(h.transport.requests.count, 2)
        // Keine neue Bindung, kein neues „zuletzt verwendet“
        XCTAssertNil(h.bindings.binding(forNotebook: notebookID))
        XCTAssertEqual(h.bindings.lastNotebookID, h.binding.notebookID)
    }

    func testResolveBindingStillBindsWhenTheModuleNameFails() async throws {
        let notebookID = "019a4e14-0000-7000-8000-0000000000e1"
        let h = SyncHarness(health: [
            .http(status: 200, body: "{\"items\":[\(sessionJSON)],\"next_cursor\":null}"),
            .http(
                status: 200,
                body: "{\"items\":[\(notebookJSON(id: notebookID, kind: "vorlesung"))],\"next_cursor\":null}"),
            // Modulname scheitert: Das Notizbuch wird trotzdem gebunden, nur ohne Namen
            .http(status: 500, body: "{}"),
            .http(
                status: 200,
                body: "{\"items\":[],\"notebook_id\":\"\(notebookID)\",\"stream_op_id\":null,\"stream_seq\":0}"),
        ])
        h.start()
        _ = await eventually { h.engine.state == .online }

        let resolvedOrNil = await h.engine.resolveBinding()
        let resolved = try XCTUnwrap(resolvedOrNil)
        XCTAssertEqual(resolved.notebookID, notebookID)
        XCTAssertNil(resolved.moduleName)
        XCTAssertEqual(h.bindings.lastNotebookID, notebookID)
        XCTAssertEqual(h.transport.requests.count, 4)
    }

    func testRunningLectureWithoutConnectionGivesNil() async throws {
        let h = SyncHarness()
        let running = await h.engine.runningLectureNotebookID()
        XCTAssertNil(running)
        XCTAssertEqual(h.transport.requests.count, 0)
    }

    func testResolveBindingOfflineFallsBackToTheLastNotebook() async throws {
        let h = SyncHarness()
        // Engine nicht gestartet: kein REST-Versuch
        let resolved = await h.engine.resolveBinding()
        XCTAssertEqual(resolved, h.binding)
        XCTAssertEqual(h.transport.requests.count, 0)
    }

    func testResolveBindingWithoutAnyBindingGivesNil() async throws {
        let h = SyncHarness()
        h.bindings.removeBinding(forPage: h.binding.pageID)
        h.bindings.lastNotebookID = nil
        let resolved = await h.engine.resolveBinding()
        XCTAssertNil(resolved)
    }

    // MARK: Hilfen

    private func waitForSocket(_ h: SyncHarness, index: Int) async throws -> FakeSyncSocket {
        let found = await eventually { h.factory.sockets.count > index }
        XCTAssertTrue(found, "Verbindung \(index) wurde nicht geöffnet")
        return try XCTUnwrap(h.factory.sockets.count > index ? h.factory.sockets[index] : nil)
    }
}
