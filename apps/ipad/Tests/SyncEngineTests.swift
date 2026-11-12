import XCTest

@testable import StudienGehirn

@MainActor
final class SyncEngineTests: XCTestCase {
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
        let page = try XCTUnwrap(h.library.page(h.binding.pageID))
        let draft = try XCTUnwrap(
            InkOpBuilder.pageCreate(
                page: page, nowMS: 1_762_246_500_000, offsetMS: nil, makeID: { InkID.uuidV7() }))
        try h.outbox.append([draft])
        h.enqueueStrokes(2)
        h.start()

        let done = await eventually { h.engine.pendingCount == 0 && h.engine.deadLetterCount == 3 }
        XCTAssertTrue(done)
        // Die Seite gilt nicht mehr
        XCTAssertNil(h.library.page(h.binding.pageID))
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

    /// Review L16: Eine abgelehnte Weiterleitung (Proxy, Captive Portal) ist ein vorübergehender Fehler. Die Kopplung
    /// bleibt, die Engine verbindet mit Wartezeit neu und fragt nicht erst `GET /health`.
    func testHTTP302OnUpgradeRetriesWithBackoffAndKeepsThePairing() async throws {
        let h = SyncHarness()
        h.factory.configure = { socket, index in
            if index == 0 { socket.initialFailure = .rejected(status: 302) }
        }
        h.enqueueStrokes(1)
        h.start()

        let waiting = await eventually { h.engine.state == .waiting }
        XCTAssertTrue(waiting)
        XCTAssertTrue(h.transport.requests.isEmpty)
        XCTAssertEqual(h.tokens.token, Fixtures.token)
        XCTAssertEqual(h.engine.pendingCount, 1)
        await h.clock.advance(0.5)
        XCTAssertEqual(h.factory.sockets.count, 1)
        await h.clock.advance(1)
        _ = try await waitForSocket(h, index: 1)
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
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

    func testNewDBEpochMarksAllPagesForReconcile() async throws {
        let h = SyncHarness()
        h.library.setDBEpoch("epoch-alt")
        h.factory.configure = { socket, _ in socket.epoch = "epoch-neu" }
        h.start()

        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
        XCTAssertEqual(h.library.dbEpoch, "epoch-neu")
        XCTAssertTrue(h.library.page(h.binding.pageID)?.needsReconcile ?? false)
        XCTAssertTrue(h.engine.pageNeedsReconcile(pageID: h.binding.pageID))
    }

    func testFirstEpochIsStoredWithoutReconcile() async throws {
        let h = SyncHarness()
        h.start()

        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
        XCTAssertEqual(h.library.dbEpoch, "epoch-1")
        XCTAssertFalse(h.engine.pageNeedsReconcile(pageID: h.binding.pageID))
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

    // MARK: Notizbuch, Seite und Abgleich

    private func freeNotebook(_ id: String, module: String, title: String = "Eigene Notizen", known: Bool = false)
        -> LibraryNotebook
    {
        LibraryNotebook(
            id: id, moduleID: module, title: title, kind: .frei, createdAtMS: 1_762_246_500_000,
            knownOnServer: known, hidden: false, lastPageID: nil, remoteMaxIndex: 0, remoteOnlyPageCount: 0)
    }

    private func blankPage(_ id: String, in notebookID: String) -> LibraryPage {
        LibraryPage(
            id: id, notebookID: notebookID, index: 1, template: .blanko, widthPt: 595, heightPt: 842,
            sessionID: nil, backgroundSlideID: nil, attachedSlideID: nil, version: 1, createQueued: true,
            needsReconcile: false, deletedAtMS: nil, deleteQueued: false)
    }

    func testNotebookCreateIsSentBeforePageCreateInItsOwnStream() async throws {
        let h = SyncHarness()
        let notebook = freeNotebook("019a4e14-0000-7000-8000-0000000000f1", module: h.binding.moduleID)
        h.library.upsert(notebook)
        let created = try XCTUnwrap(
            InkOpBuilder.notebookCreate(
                notebook: notebook, nowMS: 1_762_246_500_000, offsetMS: nil, makeID: { InkID.uuidV7() }))
        let page = blankPage("019a4e14-0000-7000-8000-0000000000f2", in: notebook.id)
        let pageCreate = try XCTUnwrap(
            InkOpBuilder.pageCreate(
                page: page, nowMS: 1_762_246_500_000, offsetMS: nil, makeID: { InkID.uuidV7() }))
        XCTAssertTrue(h.engine.enqueue(drafts: [created, pageCreate]))
        h.start()

        let done = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(done)
        let ops = h.factory.sockets[0].ops
        XCTAssertEqual(ops.map { $0.object["kind"] as? String }, ["notebook.create", "page.create"])
        XCTAssertEqual(ops[0].object["stream"] as? String, "notebook:\(notebook.id)")
        XCTAssertEqual(ops[1].object["stream"] as? String, "notebook:\(notebook.id)")
        // Uhrkorrektur trifft `at` und `created_at`
        XCTAssertEqual(ops[0].object["at"] as? Int, 1_762_246_500_000 + 2000)
        let data = try XCTUnwrap(ops[0].object["data"] as? [String: Any])
        XCTAssertEqual(data["created_at"] as? Int, 1_762_246_500_000 + 2000)
        XCTAssertEqual(data["kind"] as? String, "frei")
    }

    func testRejectedNotebookCreateTakesTheWholeStreamAlong() async throws {
        let h = SyncHarness()
        h.factory.configure = { socket, _ in
            socket.opPolicy = { _, kind, _ in
                kind == "notebook.create"
                    ? .error(code: "module_not_found", retryable: false, fatal: false) : .ack
            }
        }
        let notebook = freeNotebook("019a4e14-0000-7000-8000-0000000000f1", module: h.binding.moduleID)
        h.library.upsert(notebook)
        let page = blankPage("019a4e14-0000-7000-8000-0000000000f2", in: notebook.id)
        h.library.upsert(page)
        let drafts = [
            try XCTUnwrap(
                InkOpBuilder.notebookCreate(notebook: notebook, nowMS: 1, offsetMS: nil, makeID: { InkID.uuidV7() })),
            try XCTUnwrap(InkOpBuilder.pageCreate(page: page, nowMS: 1, offsetMS: nil, makeID: { InkID.uuidV7() })),
        ]
        XCTAssertTrue(h.engine.enqueue(drafts: drafts))
        // Ein Strich in einem anderen Notizbuch bleibt unberührt
        XCTAssertTrue(h.enqueueStrokes(1))
        h.start()

        let done = await eventually { h.engine.pendingCount == 0 && h.engine.deadLetterCount == 2 }
        XCTAssertTrue(done)
        XCTAssertNil(h.library.notebook(notebook.id))
        XCTAssertNil(h.library.page(page.id))
        XCTAssertNotNil(h.library.notebook(h.binding.notebookID))
    }

    func testNewDBEpochRequeuesFreeNotebooksWithPagesOnly() async throws {
        let h = SyncHarness()
        let module = h.binding.moduleID
        let withPages = freeNotebook("019a4e14-0000-7000-8000-0000000000f1", module: module, known: true)
        let withoutPages = freeNotebook("019a4e14-0000-7000-8000-0000000000f3", module: module, known: true)
        h.library.upsert(withPages)
        h.library.upsert(withoutPages)
        h.library.upsert(blankPage("019a4e14-0000-7000-8000-0000000000f2", in: withPages.id))
        h.library.setDBEpoch("epoch-alt")
        h.factory.configure = { socket, _ in socket.epoch = "epoch-neu" }
        h.start()

        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
        let done = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(done)

        // Genau ein `notebook.create`: für das freie Notizbuch mit Seite, nicht für „Vorlesung“ und nicht für das leere
        let ops = h.factory.sockets[0].ops
        let creates = ops.filter { $0.object["kind"] as? String == "notebook.create" }
        XCTAssertEqual(creates.count, 1)
        XCTAssertEqual(creates.first?.object["stream"] as? String, "notebook:\(withPages.id)")
        // Nichts wird ausgeblendet, aber keins gilt mehr als dem Core bekannt
        XCTAssertTrue(h.library.allNotebooks().allSatisfy { !$0.hidden && !$0.knownOnServer })
        XCTAssertEqual(h.library.notebooks(inModule: module).count, 3)
        XCTAssertTrue(h.library.page(h.binding.pageID)?.needsReconcile ?? false)
    }

    /// M1 (#225): Offline entstand eine Seite in einem freien Notizbuch, ihr `page.create` und ein Strich warten.
    /// Der Mac wird danach auf ein älteres Backup zurückgesetzt (neue `db_epoch`). `requeueFreeNotebooks` hängt
    /// `notebook.create` hinten an. Gegenprobe: Ohne `SyncOutbox.nextToSend` ginge `page.create` zuerst hinaus, der Core
    /// antwortete `notebook_not_found` und Seite samt Strich landeten in der Fehlerablage.
    func testNewDBEpochSendsNotebookCreateBeforeWaitingPageOperations() async throws {
        let h = SyncHarness()
        let notebook = freeNotebook("019a4e14-0000-7000-8000-0000000000f1", module: h.binding.moduleID, known: true)
        let page = blankPage("019a4e14-0000-7000-8000-0000000000f2", in: notebook.id)
        h.library.upsert(notebook)
        h.library.upsert(page)
        var binding = h.binding
        binding.notebookID = notebook.id
        binding.pageID = page.id
        let pageCreate = try XCTUnwrap(
            InkOpBuilder.pageCreate(page: page, nowMS: 1, offsetMS: nil, makeID: { InkID.uuidV7() }))
        XCTAssertTrue(h.engine.enqueue(drafts: [pageCreate]))
        XCTAssertTrue(h.engine.enqueue([.upsert(h.stroke("s0"))], binding: binding))
        h.library.setDBEpoch("epoch-alt")
        h.factory.configure = { socket, _ in
            socket.epoch = "epoch-neu"
            // Wie der Core: Als allererste Operation scheitert `page.create` (Notizbuch unbekannt)
            socket.opPolicy = { _, kind, index in
                kind == "page.create" && index == 0
                    ? .error(code: "notebook_not_found", retryable: false, fatal: false) : .ack
            }
        }
        h.start()

        let done = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(done)
        let kinds = h.factory.sockets[0].ops.map { $0.object["kind"] as? String }
        XCTAssertEqual(kinds, ["notebook.create", "page.create", "stroke.add"])
        XCTAssertEqual(h.engine.deadLetterCount, 0)
        XCTAssertNotNil(h.library.page(page.id))
        XCTAssertNotNil(h.library.notebook(notebook.id))
    }

    func testFirstEpochDoesNotRequeueNotebooks() async throws {
        let h = SyncHarness()
        h.library.upsert(freeNotebook("019a4e14-0000-7000-8000-0000000000f1", module: h.binding.moduleID, known: true))
        h.library.upsert(blankPage("019a4e14-0000-7000-8000-0000000000f2", in: "019a4e14-0000-7000-8000-0000000000f1"))
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
        await h.clock.settle()
        XCTAssertEqual(h.factory.sockets[0].ops.count, 0)
    }

    func testReconcileRecreatesAnUnknownSlidePageWithItsOwnFields() async throws {
        let h = SyncHarness(health: [
            // `GET /pages/{id}/strokes`: der Core kennt die Seite nicht
            .http(status: 404, body: Fixtures.apiError("page_not_found"))
        ])
        let slidePage = LibraryPage(
            id: "019a4e14-0000-7000-8000-0000000000f2", notebookID: h.binding.notebookID, index: 4,
            template: .folie, widthPt: 960, heightPt: 540, sessionID: nil,
            backgroundSlideID: "019a4e14-0000-7000-8000-0000000000f9", attachedSlideID: nil, version: 3,
            createQueued: true, needsReconcile: true, deletedAtMS: nil, deleteQueued: false)
        h.library.upsert(slidePage)
        h.start()
        _ = await eventually { h.engine.state == .online }

        let model = InkPageModel(
            pageID: slidePage.id, pageSize: CGSize(width: 960, height: 540),
            store: FileInkPageStore(root: h.directory.appendingPathComponent("Ink")))
        var binding = h.binding
        binding.pageID = slidePage.id
        await h.engine.reconcile(page: model, binding: binding)

        let sent = await eventually { h.factory.sockets[0].ops.count == 1 }
        XCTAssertTrue(sent)
        let op = try XCTUnwrap(h.factory.sockets[0].ops.first?.object)
        XCTAssertEqual(op["kind"] as? String, "page.create")
        let data = try XCTUnwrap(op["data"] as? [String: Any])
        XCTAssertEqual(data["template"] as? String, "folie")
        XCTAssertEqual(data["index"] as? Int, 4)
        XCTAssertEqual(data["width_pt"] as? Double, 960)
        XCTAssertEqual(data["height_pt"] as? Double, 540)
        XCTAssertEqual(data["background_slide_id"] as? String, "019a4e14-0000-7000-8000-0000000000f9")
        XCTAssertTrue(data["attached_slide_id"] is NSNull)
        XCTAssertFalse(h.library.page(slidePage.id)?.needsReconcile ?? true)
    }

    func testPageOperationsDoNotMoveTheStrokeMark() async throws {
        let h = SyncHarness()
        let page = try XCTUnwrap(h.library.page(h.binding.pageID))
        let draft = try XCTUnwrap(
            InkOpBuilder.pageCreate(page: page, nowMS: 1, offsetMS: nil, makeID: { InkID.uuidV7() }))
        XCTAssertTrue(h.engine.enqueue(drafts: [draft]))
        XCTAssertEqual(h.engine.outboxMark(forPage: page.id), 0)
        XCTAssertTrue(h.enqueueStrokes(1))
        XCTAssertEqual(h.engine.outboxMark(forPage: page.id), 2)
    }

    // MARK: Hilfen

    private func waitForSocket(_ h: SyncHarness, index: Int) async throws -> FakeSyncSocket {
        let found = await eventually { h.factory.sockets.count > index }
        XCTAssertTrue(found, "Verbindung \(index) wurde nicht geöffnet")
        return try XCTUnwrap(h.factory.sockets.count > index ? h.factory.sockets[index] : nil)
    }
}
