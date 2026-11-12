import XCTest

@testable import StudienGehirn

private let notebookA = "019a4e14-0000-7000-8000-0000000000a2"
private let notebookB = "019a4e14-0000-7000-8000-0000000000a3"
private let liveModuleID = "019a4e14-0000-7000-8000-0000000000c1"

@MainActor
private final class NotebookInboundLog {
    var items: [SyncInbound] = []
    var changed = 0
}

private func notebookChangedEvent(_ kind: String, notebook: String = notebookA) -> String {
    """
    {"type":"event","name":"notebook.changed","data":{"notebook_id":"\(notebook)","kind":"\(kind)"}}
    """
}

/// `notebook.changed` kommt als eigenes Ereignis aus der Engine (#245, VERTRAEGE §11.3 und §11.6)
@MainActor
final class NotebookChangedInboundTests: XCTestCase {
    private func online(_ h: SyncHarness, log: NotebookInboundLog) async {
        h.engine.onNotebookChanged = { log.changed += 1 }
        h.engine.onInbound = { log.items.append($0) }
        h.start()
        let up = await eventually { h.engine.state == .online }
        XCTAssertTrue(up)
    }

    func testEveryKindOfTheEventIsPassedOnWithoutASubscription() async {
        let h = SyncHarness()
        let log = NotebookInboundLog()
        await online(h, log: log)
        let socket = h.factory.sockets[0]
        for kind in ["update", "delete", "restore"] {
            socket.push(notebookChangedEvent(kind))
        }
        let got = await eventually { log.changed == 3 }
        XCTAssertTrue(got)
        // Der Session-Hook sieht nur die Verbindung, nicht das Ereignis
        XCTAssertEqual(log.items, [.connected])
    }

    func testAnUnknownEventAndAnUnknownKindAreIgnored() async {
        let h = SyncHarness()
        let log = NotebookInboundLog()
        await online(h, log: log)
        let socket = h.factory.sockets[0]
        socket.push("{\"type\":\"event\",\"name\":\"future.event\",\"data\":{}}")
        socket.push(notebookChangedEvent("purge"))
        socket.push(notebookChangedEvent("delete"))
        let got = await eventually { log.changed == 1 }
        XCTAssertTrue(got)
        for _ in 0..<50 { await _Concurrency.Task.yield() }
        XCTAssertEqual(log.changed, 1)
        XCTAssertEqual(log.items, [.connected])
        XCTAssertEqual(h.engine.state, .online)
    }
}

@MainActor
private final class LiveRefreshState {
    var notebooks: [String] = []
    var moduleRequests = 0
    var events = 0
}

/// Bibliothek neu laden (entprellt) und die Zeile bei gelöschtem Notizbuch
@MainActor
final class NotebookLiveRefreshTests: XCTestCase {
    private struct Rig {
        let h: SyncHarness
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
        h.service.attachNotebookChanges()
        // Zählt die Ereignisse mit, die bei der Bibliothek ankommen
        let react = h.engine.onNotebookChanged
        h.engine.onNotebookChanged = {
            state.events += 1
            react?()
        }
        return Rig(h: h, state: state)
    }

    /// Das Ereignis kommt über den Socket durch die Engine bei der Bibliothek an
    private func change(_ rig: Rig, _ kind: String) async {
        let expected = rig.state.events + 1
        rig.h.factory.sockets[0].push(notebookChangedEvent(kind))
        let got = await eventually { rig.state.events == expected }
        XCTAssertTrue(got)
    }

    func testManyEventsInARowReloadTheLibraryOnce() async {
        let rig = await makeRig()
        let before = rig.state.moduleRequests

        for _ in 0..<5 {
            await change(rig, "update")
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

    func testAConstantStreamReloadsExactlyAtTheMaximumWait() async {
        let rig = await makeRig()
        let before = rig.state.moduleRequests

        // Alle 0,5 s ein Ereignis: bei 0 s, 0,5 s ... 4,5 s. Die Entprellung allein schöbe den Abruf immer weiter.
        for _ in 0..<10 {
            await change(rig, "update")
            if rig.state.events < 10 { await rig.h.clock.advance(0.5) }
        }
        // 4,5 s nach dem ersten Ereignis, das letzte ist gerade eingetroffen
        await rig.h.clock.advance(0.4)
        // 4,9 s nach dem ersten: noch kein Abruf
        XCTAssertEqual(rig.state.moduleRequests, before)
        await rig.h.clock.advance(0.1)
        // Genau 5,0 s: genau ein Abruf
        XCTAssertEqual(rig.state.moduleRequests, before + 1)

        // Danach nichts mehr, solange nichts kommt
        await rig.h.clock.advance(30)
        XCTAssertEqual(rig.state.moduleRequests, before + 1)
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

        // Am Mac gelöscht: Der Core liefert das Notizbuch nicht mehr
        rig.state.notebooks = []
        await change(rig, "delete")
        await rig.h.clock.advance(1.1)
        XCTAssertTrue(service.isDeletedOnMac(notebookID: notebookA))
        XCTAssertEqual(InkLibraryService.deletedOnMacLine, "Am Mac gelöscht, liegt im Papierkorb")

        // Weiterschreiben bleibt möglich: Notizbuch und Seite liegen weiter lokal vor
        XCTAssertNotNil(service.openTarget(notebookID: notebookA))
        XCTAssertNotNil(service.page(rig.h.binding.pageID))

        // Wiederhergestellt: Es steht wieder in der Liste, die Zeile verschwindet
        rig.state.notebooks = [LibraryFixtures.notebookJSON(id: notebookA)]
        await change(rig, "restore")
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
