import XCTest

@testable import StudienGehirn

private let notebookA = "019a4e14-0000-7000-8000-0000000000a2"
private let notebookB = "019a4e14-0000-7000-8000-0000000000a3"
private let liveModuleID = "019a4e14-0000-7000-8000-0000000000c1"

@MainActor
private final class NotebookInboundLog {
    var items: [SyncInbound] = []
}

/// `notebook.update`, `.delete` und `.restore` kommen als eigene Art aus der Engine (#245, VERTRAEGE §11.3)
@MainActor
final class NotebookOpInboundTests: XCTestCase {
    private func op(seq: Int, kind: String, data: String, stream: String = "notebook:\(notebookA)") -> String {
        """
        {"type":"op","op_id":"019a4e14-0000-7000-8000-00000000092\(seq)","stream":"\(stream)","seq":\(seq),
        "kind":"\(kind)","at":1762240562123,"clock_uncertain":false,"origin":"server","data":\(data)}
        """
    }

    private func online(_ h: SyncHarness, log: NotebookInboundLog) async {
        h.engine.onNotebookInbound = { log.items.append($0) }
        h.start()
        let up = await eventually { h.engine.state == .online }
        XCTAssertTrue(up)
    }

    func testTheKindOfAServerNotebookOperationIsPassedOn() async {
        let h = SyncHarness()
        let log = NotebookInboundLog()
        await online(h, log: log)
        let socket = h.factory.sockets[0]
        socket.push(
            op(
                seq: 3, kind: "notebook.update",
                data: "{\"notebook_id\":\"\(notebookA)\",\"fields\":{\"title\":\"Neu\",\"module_id\":\"\(liveModuleID)\"}}"
            ))
        socket.push(op(seq: 4, kind: "notebook.delete", data: "{\"notebook_id\":\"\(notebookA)\"}"))
        socket.push(op(seq: 5, kind: "notebook.restore", data: "{\"notebook_id\":\"\(notebookA)\"}"))
        let got = await eventually { log.items.count == 4 }
        XCTAssertTrue(got)
        let stream = "notebook:\(notebookA)"
        XCTAssertEqual(log.items[0], .connected)
        XCTAssertEqual(log.items[1], .notebookOp(stream: stream, seq: 3, kind: .update))
        XCTAssertEqual(log.items[2], .notebookOp(stream: stream, seq: 4, kind: .delete))
        XCTAssertEqual(log.items[3], .notebookOp(stream: stream, seq: 5, kind: .restore))
    }

    func testOtherOperationsOfANotebookStreamStayPlainOps() async {
        let h = SyncHarness()
        let log = NotebookInboundLog()
        await online(h, log: log)
        h.factory.sockets[0].push(op(seq: 6, kind: "future.kind", data: "{}"))
        let got = await eventually { log.items.count == 2 }
        XCTAssertTrue(got)
        XCTAssertEqual(log.items[1], .op(stream: "notebook:\(notebookA)", seq: 6, slide: nil))
    }

    func testTheSessionHookSeesEveryMessageToo() async {
        let h = SyncHarness()
        let log = NotebookInboundLog()
        let sessionLog = NotebookInboundLog()
        h.engine.onInbound = { sessionLog.items.append($0) }
        await online(h, log: log)
        h.factory.sockets[0].push(op(seq: 7, kind: "notebook.delete", data: "{\"notebook_id\":\"\(notebookA)\"}"))
        let got = await eventually { log.items.count == 2 && sessionLog.items.count == 2 }
        XCTAssertTrue(got)
        XCTAssertEqual(sessionLog.items, log.items)
    }
}

@MainActor
private final class FakeNotebookFeed: NotebookFeed {
    var onNotebookInbound: (@MainActor (SyncInbound) -> Void)?
    var canSubscribe = true
    private(set) var subscribes: [(stream: String, seq: Int, opID: String?)] = []

    func subscribe(stream: String, lastSeq: Int, lastOpID: String?) {
        subscribes.append((stream, lastSeq, lastOpID))
    }

    func deliver(_ inbound: SyncInbound) {
        onNotebookInbound?(inbound)
    }
}

@MainActor
private final class FakeNotebookBackend: NotebookFollowerBackend {
    /// Fehlt eine ID, antwortet der Fake mit 404
    var heads: [String: NotebookHead] = [:]
    var failing = false
    private(set) var calls: [String] = []

    func head(notebookID: String) async throws -> NotebookHead? {
        calls.append(notebookID)
        if failing { throw ConnectionError.invalidAddress }
        return heads[notebookID]
    }
}

@MainActor
private final class NotebookChangeLog {
    var items: [NotebookChange] = []
}

/// Die Ströme der Notizbücher lesend abonnieren (Variante A aus #245)
@MainActor
final class NotebookFollowerSubscriptionTests: XCTestCase {
    private struct Rig {
        let feed: FakeNotebookFeed
        let backend: FakeNotebookBackend
        let follower: NotebookFollower
        let changes: NotebookChangeLog
    }

    private func makeRig(ids: [String] = [notebookA, notebookB]) -> Rig {
        let feed = FakeNotebookFeed()
        let backend = FakeNotebookBackend()
        backend.heads[notebookA] = NotebookHead(seq: 12, opID: "op-12")
        backend.heads[notebookB] = NotebookHead(seq: 0, opID: nil)
        let changes = NotebookChangeLog()
        let follower = NotebookFollower(feed: feed, backend: backend, notebookIDs: { ids })
        follower.onChange = { changes.items.append($0) }
        follower.start()
        return Rig(feed: feed, backend: backend, follower: follower, changes: changes)
    }

    func testEveryKnownNotebookIsSubscribedFromItsRESTHead() async {
        let rig = makeRig()
        rig.feed.deliver(.connected)
        let done = await eventually { rig.feed.subscribes.count == 2 }
        XCTAssertTrue(done)
        XCTAssertEqual(rig.feed.subscribes[0].stream, "notebook:\(notebookA)")
        XCTAssertEqual(rig.feed.subscribes[0].seq, 12)
        XCTAssertEqual(rig.feed.subscribes[0].opID, "op-12")
        XCTAssertEqual(rig.feed.subscribes[1].stream, "notebook:\(notebookB)")
        XCTAssertEqual(rig.feed.subscribes[1].seq, 0)
        XCTAssertNil(rig.feed.subscribes[1].opID)
    }

    func testAServerOperationOnASubscribedStreamIsReported() async {
        let rig = makeRig()
        rig.feed.deliver(.connected)
        _ = await eventually { rig.feed.subscribes.count == 2 }
        rig.feed.deliver(.notebookOp(stream: "notebook:\(notebookA)", seq: 13, kind: .delete))
        rig.feed.deliver(.notebookOp(stream: "notebook:\(notebookB)", seq: 1, kind: .update))
        rig.feed.deliver(.notebookOp(stream: "notebook:unbekannt", seq: 1, kind: .restore))
        rig.feed.deliver(.op(stream: "notebook:\(notebookA)", seq: 14, slide: nil))
        XCTAssertEqual(
            rig.changes.items,
            [
                NotebookChange(notebookID: notebookA, kind: .delete),
                NotebookChange(notebookID: notebookB, kind: .update),
            ])
    }

    func testANotebookTheCoreDoesNotKnowIsSkippedAndNetworkErrorsStopThePass() async {
        let rig = makeRig()
        rig.backend.heads[notebookA] = nil
        rig.feed.deliver(.connected)
        let done = await eventually { rig.feed.subscribes.count == 1 }
        XCTAssertTrue(done)
        XCTAssertEqual(rig.feed.subscribes[0].stream, "notebook:\(notebookB)")

        let failing = makeRig()
        failing.backend.failing = true
        failing.feed.deliver(.connected)
        _ = await eventually { failing.backend.calls.count == 1 }
        for _ in 0..<50 { await _Concurrency.Task.yield() }
        XCTAssertEqual(failing.backend.calls.count, 1)
        XCTAssertTrue(failing.feed.subscribes.isEmpty)
        // Beim nächsten Anstoß (Abruf der Bibliothek) klappt es
        failing.backend.failing = false
        failing.follower.syncSubscriptions()
        let retried = await eventually { failing.feed.subscribes.count == 2 }
        XCTAssertTrue(retried)
    }

    func testNothingIsSubscribedBeforeTheWelcome() async {
        let rig = makeRig()
        rig.feed.canSubscribe = false
        rig.feed.deliver(.connected)
        for _ in 0..<50 { await _Concurrency.Task.yield() }
        XCTAssertTrue(rig.feed.subscribes.isEmpty)
        XCTAssertTrue(rig.follower.subscribed.isEmpty)
    }

    func testANewConnectionSubscribesAgainFromTheCurrentHead() async {
        let rig = makeRig()
        rig.feed.deliver(.connected)
        _ = await eventually { rig.feed.subscribes.count == 2 }
        rig.backend.heads[notebookA] = NotebookHead(seq: 20, opID: "op-20")
        rig.feed.deliver(.connected)
        let again = await eventually { rig.feed.subscribes.count == 4 }
        XCTAssertTrue(again)
        XCTAssertEqual(rig.feed.subscribes[2].seq, 20)
    }

    func testAResetSubscribesAgainOnlyTwice() async {
        let rig = makeRig(ids: [notebookA])
        rig.feed.deliver(.connected)
        _ = await eventually { rig.feed.subscribes.count == 1 }
        for expected in 2...3 {
            rig.feed.deliver(.subscribed(stream: "notebook:\(notebookA)", reset: true))
            let again = await eventually { rig.feed.subscribes.count == expected }
            XCTAssertTrue(again)
        }
        rig.feed.deliver(.subscribed(stream: "notebook:\(notebookA)", reset: true))
        for _ in 0..<50 { await _Concurrency.Task.yield() }
        XCTAssertEqual(rig.feed.subscribes.count, 3)
    }

    func testAtMostMaxStreamsAreSubscribed() async {
        let ids = (0..<(NotebookFollower.maxStreams + 5)).map { String(format: "019a4e14-0000-7000-8000-%012d", $0) }
        let feed = FakeNotebookFeed()
        let backend = FakeNotebookBackend()
        for id in ids { backend.heads[id] = NotebookHead(seq: 1, opID: "op") }
        let follower = NotebookFollower(feed: feed, backend: backend, notebookIDs: { ids })
        follower.start()
        feed.deliver(.connected)
        let done = await eventually { feed.subscribes.count == NotebookFollower.maxStreams }
        XCTAssertTrue(done)
        for _ in 0..<50 { await _Concurrency.Task.yield() }
        XCTAssertEqual(feed.subscribes.count, NotebookFollower.maxStreams)
    }
}

@MainActor
private final class LiveRefreshState {
    var notebooks: [String] = []
    var moduleRequests = 0
}

/// Bibliothek neu laden (entprellt) und die Zeile bei gelöschtem Notizbuch
@MainActor
final class NotebookLiveRefreshTests: XCTestCase {
    private struct Rig {
        let h: SyncHarness
        let feed: FakeNotebookFeed
        let backend: FakeNotebookBackend
        let state: LiveRefreshState
    }

    private func makeRig() async -> Rig {
        let h = SyncHarness()
        let state = LiveRefreshState()
        h.transport.router = { request in
            let path = request.url?.path ?? ""
            if path.hasSuffix("/modules") {
                state.moduleRequests += 1
                return .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.moduleJSON()]))
            }
            if path.hasSuffix("/notebooks") {
                return .http(status: 200, body: LibraryFixtures.list(state.notebooks))
            }
            return nil
        }
        state.notebooks = [LibraryFixtures.notebookJSON(id: notebookA)]
        h.start()
        let up = await eventually { h.engine.state == .online }
        XCTAssertTrue(up)
        h.service.attachFollower()
        let feed = FakeNotebookFeed()
        let backend = FakeNotebookBackend()
        backend.heads[notebookA] = NotebookHead(seq: 5, opID: "op-5")
        h.service.attachNotebookFollower(feed: feed, backend: backend)
        return Rig(h: h, feed: feed, backend: backend, state: state)
    }

    private func change(_ rig: Rig, _ kind: NotebookOpKind, seq: Int) {
        rig.feed.deliver(.notebookOp(stream: "notebook:\(notebookA)", seq: seq, kind: kind))
    }

    func testManyOperationsInARowReloadTheLibraryOnce() async {
        let rig = await makeRig()
        rig.feed.deliver(.connected)
        _ = await eventually { rig.feed.subscribes.count == 1 }
        let before = rig.state.moduleRequests

        for seq in 6...10 {
            change(rig, .update, seq: seq)
            await rig.h.clock.advance(0.2)
        }
        // Eine Sekunde Ruhe ist noch nicht um: kein Abruf
        XCTAssertEqual(rig.state.moduleRequests, before)

        await rig.h.clock.advance(1.0)
        XCTAssertEqual(rig.state.moduleRequests, before + 1)

        // Danach nichts mehr, solange nichts kommt
        await rig.h.clock.advance(30)
        XCTAssertEqual(rig.state.moduleRequests, before + 1)
    }

    func testAConstantStreamStillReloadsAfterTheMaximumWait() async {
        let rig = await makeRig()
        rig.feed.deliver(.connected)
        _ = await eventually { rig.feed.subscribes.count == 1 }
        let before = rig.state.moduleRequests

        for seq in 6...40 {
            change(rig, .update, seq: seq)
            await rig.h.clock.advance(0.5)
        }
        XCTAssertGreaterThanOrEqual(rig.state.moduleRequests, before + 1)
        // Nicht bei jeder Operation: 35 Operationen in 17,5 s
        XCTAssertLessThanOrEqual(rig.state.moduleRequests, before + 4)
    }

    func testAChangeDuringARunningRefreshIsNotLost() async {
        let rig = await makeRig()
        var nested = false
        rig.h.transport.duringRequest = { [service = rig.h.service] request in
            guard !nested, request.url?.path.hasSuffix("/modules") == true else { return }
            nested = true
            await service.refresh(force: true)
        }
        let before = rig.state.moduleRequests
        await rig.h.service.refresh(force: true)
        let again = await eventually { rig.state.moduleRequests == before + 2 }
        XCTAssertTrue(again)
    }

    func testTheOpenNotebookShowsTheLineAfterDeleteAndLosesItAfterRestore() async {
        let rig = await makeRig()
        let service = rig.h.service
        await service.refresh(force: true)
        XCTAssertFalse(service.isDeletedOnMac(notebookID: notebookA))
        rig.feed.deliver(.connected)
        _ = await eventually { rig.feed.subscribes.count == 1 }

        // Am Mac gelöscht: Der Core liefert das Notizbuch nicht mehr
        rig.state.notebooks = []
        change(rig, .delete, seq: 6)
        await rig.h.clock.advance(1.1)
        XCTAssertTrue(service.isDeletedOnMac(notebookID: notebookA))
        XCTAssertEqual(InkLibraryService.deletedOnMacLine, "Am Mac gelöscht, liegt im Papierkorb")

        // Weiterschreiben bleibt möglich: Notizbuch und Seite liegen weiter lokal vor
        XCTAssertNotNil(service.openTarget(notebookID: notebookA))
        XCTAssertNotNil(service.page(rig.h.binding.pageID))

        // Wiederhergestellt: Es steht wieder in der Liste, die Zeile verschwindet
        rig.state.notebooks = [LibraryFixtures.notebookJSON(id: notebookA)]
        change(rig, .restore, seq: 7)
        await rig.h.clock.advance(1.1)
        XCTAssertFalse(service.isDeletedOnMac(notebookID: notebookA))
    }

    func testANotebookThatIsOnlyLocalNeverShowsTheLine() async {
        let rig = await makeRig()
        let local = LibraryNotebook(
            id: notebookB, moduleID: liveModuleID, title: "Neu", kind: .frei, createdAtMS: 2,
            knownOnServer: false, hidden: true, lastPageID: nil, remoteMaxIndex: 0, remoteOnlyPageCount: 0)
        rig.h.library.upsert(local)
        XCTAssertFalse(rig.h.service.isDeletedOnMac(notebookID: notebookB))
        XCTAssertFalse(rig.h.service.isDeletedOnMac(notebookID: "gibt-es-nicht"))
    }
}
