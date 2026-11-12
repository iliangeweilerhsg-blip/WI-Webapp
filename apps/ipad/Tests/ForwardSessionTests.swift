import XCTest

@testable import StudienGehirn

/// Der Weiterleiter liest von der lokalen Verbindung **nichts**, bevor der Handshake zum Mac geprüft ist
/// (UX-12, PR 4; Plan §5.3, Punkt 6). Die Sitzung arbeitet auf `TunnelChannel`, darum laufen die Tests mit Fakes.
@MainActor
final class ForwardSessionNoByteBeforeHandshakeTests: XCTestCase {
    private func makeSession(local: FakeStream, gate: OpenGate, closed: CallCounter) -> ForwardSession {
        ForwardSession(
            local: local, queue: DispatchQueue(label: "test.forward"),
            open: { await gate.open() },
            onClosed: { _ in closed.increment() })
    }

    func testNothingIsReadFromTheLocalConnectionWhileTheHandshakeIsPending() async {
        let local = FakeStream()
        let gate = OpenGate()
        let closed = CallCounter()
        let session = makeSession(local: local, gate: gate, closed: closed)

        session.start()
        let asked = await waitUntil { gate.openCalls == 1 }
        XCTAssertTrue(asked)
        // Eine Weile warten: Es wird nichts gelesen, nichts gesendet, nichts geschlossen
        try? await _Concurrency.Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(local.receiveCalls, 0)
        XCTAssertTrue(local.sent.isEmpty)
        XCTAssertFalse(local.isClosed)
        XCTAssertEqual(closed.count, 0)
        // Auch wenn die Anfrage mit dem Token schon im Puffer des Systems läge: Sie wird nicht angefasst
        XCTAssertFalse(local.deliver(Data("GET /api/v1/health".utf8)))

        gate.release(nil)
        _ = await waitUntil { closed.count == 1 }
    }

    func testFailedHandshakeClosesTheLocalConnectionWithoutHavingReadAByte() async {
        let local = FakeStream()
        let gate = OpenGate()
        let closed = CallCounter()
        let session = makeSession(local: local, gate: gate, closed: closed)

        session.start()
        gate.release(nil)

        let done = await waitUntil { closed.count == 1 }
        XCTAssertTrue(done)
        XCTAssertTrue(local.isClosed)
        XCTAssertEqual(local.receiveCalls, 0)
        XCTAssertTrue(local.sent.isEmpty)
    }

    func testReadingStartsOnlyAfterTheChannelIsReady() async {
        let local = FakeStream()
        let remote = FakeStream()
        let gate = OpenGate()
        let session = makeSession(local: local, gate: gate, closed: CallCounter())

        session.start()
        let asked = await waitUntil { gate.openCalls == 1 }
        XCTAssertTrue(asked)
        XCTAssertEqual(local.receiveCalls, 0)
        XCTAssertEqual(remote.receiveCalls, 0)

        gate.release(remote)

        let reading = await waitUntil { local.receiveCalls == 1 && remote.receiveCalls == 1 }
        XCTAssertTrue(reading)
    }

    func testBytesFlowBothWaysUnchanged() async {
        let local = FakeStream()
        let remote = FakeStream()
        let gate = OpenGate()
        let session = makeSession(local: local, gate: gate, closed: CallCounter())
        session.start()
        gate.release(remote)
        _ = await waitUntil { local.receiveCalls == 1 && remote.receiveCalls == 1 }

        let request = Data("GET /api/v1/health HTTP/1.1\r\n\r\n".utf8)
        XCTAssertTrue(local.deliver(request))
        let forwarded = await waitUntil { remote.sent.count == 1 }
        XCTAssertTrue(forwarded)
        XCTAssertEqual(remote.sent.first, request)

        let reply = Data("HTTP/1.1 200 OK\r\n\r\n".utf8)
        XCTAssertTrue(remote.deliver(reply))
        let answered = await waitUntil { local.sent.count == 1 }
        XCTAssertTrue(answered)
        XCTAssertEqual(local.sent.first, reply)

        // Danach liest jede Seite weiter (nächster Block erst nach der Übernahme des vorigen)
        let again = await waitUntil { local.receiveCalls == 2 && remote.receiveCalls == 2 }
        XCTAssertTrue(again)
    }

    func testEndOfOneSideClosesBoth() async {
        let local = FakeStream()
        let remote = FakeStream()
        let gate = OpenGate()
        let closed = CallCounter()
        let session = makeSession(local: local, gate: gate, closed: closed)
        session.start()
        gate.release(remote)
        _ = await waitUntil { local.receiveCalls == 1 && remote.receiveCalls == 1 }

        XCTAssertTrue(remote.deliver(Data(), ended: true))

        let done = await waitUntil { closed.count == 1 }
        XCTAssertTrue(done)
        XCTAssertTrue(local.isClosed)
        XCTAssertTrue(remote.isClosed)
    }

    func testFailedWriteClosesBoth() async {
        let local = FakeStream()
        let remote = FakeStream()
        remote.failsSending = true
        let gate = OpenGate()
        let closed = CallCounter()
        let session = makeSession(local: local, gate: gate, closed: closed)
        session.start()
        gate.release(remote)
        _ = await waitUntil { local.receiveCalls == 1 && remote.receiveCalls == 1 }

        XCTAssertTrue(local.deliver(Data("x".utf8)))

        let done = await waitUntil { closed.count == 1 }
        XCTAssertTrue(done)
        XCTAssertTrue(local.isClosed)
        XCTAssertTrue(remote.isClosed)
    }

    func testCancelledSessionClosesALateChannel() async {
        let local = FakeStream()
        let remote = FakeStream()
        let gate = OpenGate()
        let closed = CallCounter()
        let session = makeSession(local: local, gate: gate, closed: closed)
        session.start()
        let asked = await waitUntil { gate.openCalls == 1 }
        XCTAssertTrue(asked)

        session.cancel()
        let done = await waitUntil { closed.count == 1 }
        XCTAssertTrue(done)
        gate.release(remote)

        // Der Weg kommt zu spät: Er wird geschlossen, nichts wird gelesen
        let lateClosed = await waitUntil { remote.isClosed }
        XCTAssertTrue(lateClosed)
        XCTAssertEqual(remote.receiveCalls, 0)
        XCTAssertEqual(local.receiveCalls, 0)
    }
}
