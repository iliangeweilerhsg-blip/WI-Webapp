import XCTest

@testable import SpikeShared

final class SpikeWireTests: XCTestCase {
    // MARK: Befehle und Längen

    func testPingAndHealthMustHaveEmptyPayload() {
        XCTAssertEqual(
            SpikeWire.parseRequestHeader(SpikeWire.request(op: .ping)),
            .success(SpikeRequestHeader(op: .ping, length: 0)))
        XCTAssertEqual(
            SpikeWire.parseRequestHeader(SpikeWire.request(op: .health)),
            .success(SpikeRequestHeader(op: .health, length: 0)))
        // Mit Nutzlast: nicht erlaubt
        XCTAssertEqual(
            SpikeWire.parseRequestHeader(Array(SpikeWire.request(op: .ping, payload: [1]).prefix(5))),
            .failure(.lengthNotAllowed(op: .ping, length: 1)))
        XCTAssertEqual(
            SpikeWire.parseRequestHeader(Array(SpikeWire.request(op: .health, payload: [1, 2]).prefix(5))),
            .failure(.lengthNotAllowed(op: .health, length: 2)))
    }

    func testEchoLimitIs64KiB() {
        let limit = SpikeLimits.echoMaxBytes
        XCTAssertEqual(limit, 65536)
        XCTAssertEqual(
            SpikeWire.parseRequestHeader(header(op: 3, length: UInt32(limit))),
            .success(SpikeRequestHeader(op: .echo, length: limit)))
        XCTAssertEqual(
            SpikeWire.parseRequestHeader(header(op: 3, length: UInt32(limit + 1))),
            .failure(.lengthNotAllowed(op: .echo, length: limit + 1)))
        XCTAssertEqual(
            SpikeWire.parseRequestHeader(header(op: 3, length: 0)),
            .success(SpikeRequestHeader(op: .echo, length: 0)))
    }

    func testAbsurdLengthsAreRejectedWithoutOverflow() {
        XCTAssertEqual(
            SpikeWire.parseRequestHeader(header(op: 3, length: UInt32.max)),
            .failure(.lengthNotAllowed(op: .echo, length: Int(UInt32.max))))
        XCTAssertEqual(
            SpikeWire.parseRequestHeader(header(op: 4, length: 0x8000_0000)),
            .failure(.lengthNotAllowed(op: .blob, length: 0x8000_0000)))
    }

    func testUnknownOpsAreRejected() {
        for byte: UInt8 in [0, 5, 6, 99, 255] {
            XCTAssertEqual(SpikeWire.parseRequestHeader(header(op: byte, length: 0)), .failure(.unknownOp(byte)))
        }
    }

    func testOnlyFourOpsExist() {
        XCTAssertEqual(SpikeOp.allCases.map(\.rawValue), [1, 2, 3, 4])
    }

    func testHeaderSizeMustBeFive() {
        XCTAssertEqual(SpikeWire.parseRequestHeader([]), .failure(.wrongHeaderSize))
        XCTAssertEqual(SpikeWire.parseRequestHeader([1, 0, 0, 0]), .failure(.wrongHeaderSize))
        XCTAssertEqual(SpikeWire.parseRequestHeader([1, 0, 0, 0, 0, 0]), .failure(.wrongHeaderSize))
    }

    func testBlobSizeBetweenOneAndFiftyMegabytes() throws {
        let blobHeader = SpikeRequestHeader(op: .blob, length: 4)
        XCTAssertEqual(SpikeWire.parseRequestHeader(Array(SpikeWire.blobRequest(megabytes: 20).prefix(5))), .success(blobHeader))
        for megabytes in [1, 20, 50] {
            let payload = Array(SpikeWire.blobRequest(megabytes: megabytes).dropFirst(5))
            XCTAssertEqual(SpikeWire.command(header: blobHeader, payload: payload), .success(.blob(megabytes: megabytes)))
        }
        for megabytes in [0, 51, 1000] {
            let payload = Array(SpikeWire.blobRequest(megabytes: megabytes).dropFirst(5))
            XCTAssertEqual(SpikeWire.command(header: blobHeader, payload: payload), .failure(.badBlobSize))
        }
        // Blob mit anderer Länge als 4: schon im Kopf abgelehnt
        XCTAssertEqual(
            SpikeWire.parseRequestHeader(header(op: 4, length: 3)),
            .failure(.lengthNotAllowed(op: .blob, length: 3)))
    }

    func testCommandNeedsPayloadOfDeclaredLength() {
        let echoHeader = SpikeRequestHeader(op: .echo, length: 3)
        XCTAssertEqual(SpikeWire.command(header: echoHeader, payload: [1, 2, 3]), .success(.echo(payload: [1, 2, 3])))
        XCTAssertEqual(
            SpikeWire.command(header: echoHeader, payload: [1, 2]),
            .failure(.lengthNotAllowed(op: .echo, length: 2)))
        XCTAssertEqual(SpikeWire.command(header: SpikeRequestHeader(op: .ping, length: 0), payload: []), .success(.ping))
        XCTAssertEqual(SpikeWire.command(header: SpikeRequestHeader(op: .health, length: 0), payload: []), .success(.health))
    }

    // MARK: Rahmen

    func testRequestFrameLayout() {
        XCTAssertEqual(SpikeWire.request(op: .echo, payload: [9, 8]), [3, 0, 0, 0, 2, 9, 8])
        XCTAssertEqual(SpikeWire.request(op: .ping), [1, 0, 0, 0, 0])
        XCTAssertEqual(SpikeWire.blobRequest(megabytes: 20), [4, 0, 0, 0, 4, 0, 0, 0, 20])
    }

    func testReplyFrameLayoutAndLimit() {
        XCTAssertEqual(SpikeWire.reply(payload: [7]), [0, 0, 0, 0, 1, 7])
        let full = SpikeWire.replyHeader(status: .ok, length: SpikeWire.maxReplyBytes)
        guard case .success(let parsed) = SpikeWire.parseReplyHeader(full) else { return XCTFail("Kopf nicht lesbar") }
        XCTAssertEqual(parsed.length, 50 * 1024 * 1024)
        XCTAssertEqual(parsed.status, .ok)
        // Ergebnistyp mit Tupel ist nicht Equatable: Fehler einzeln vergleichen
        switch SpikeWire.parseReplyHeader(SpikeWire.replyHeader(status: .ok, length: SpikeWire.maxReplyBytes + 1)) {
        case .failure(let error):
            XCTAssertEqual(error, .lengthNotAllowed(op: .blob, length: SpikeWire.maxReplyBytes + 1))
        case .success:
            XCTFail("zu große Antwort wurde angenommen")
        }
        switch SpikeWire.parseReplyHeader([9, 0, 0, 0, 0]) {
        case .failure(let error): XCTAssertEqual(error, .unknownOp(9))
        case .success: XCTFail("unbekannter Status wurde angenommen")
        }
    }

    func testBigEndianRoundTrip() {
        for value: UInt32 in [0, 1, 255, 256, 65536, 0xDEAD_BEEF, UInt32.max] {
            XCTAssertEqual(SpikeWire.readBigEndian(SpikeWire.bigEndian(value), at: 0), value)
        }
        XCTAssertEqual(SpikeWire.bigEndian(0x0102_0304), [1, 2, 3, 4])
        // Zu kurz oder falscher Index: 0, kein Absturz
        XCTAssertEqual(SpikeWire.readBigEndian([1, 2, 3], at: 0), 0)
        XCTAssertEqual(SpikeWire.readBigEndian([1, 2, 3, 4], at: -1), 0)
        XCTAssertEqual(SpikeWire.readBigEndian([1, 2, 3, 4], at: 1), 0)
    }

    func testHealthReplyRoundTrip() {
        let reply = SpikeHealthReply(httpStatus: 200, millis: 123_456)
        XCTAssertEqual(reply.encoded().count, SpikeHealthReply.payloadBytes)
        XCTAssertEqual(SpikeHealthReply.decode(reply.encoded()), reply)
        XCTAssertNil(SpikeHealthReply.decode([1, 2, 3]))
        XCTAssertEqual(SpikeHealthReply.decode(SpikeHealthReply(httpStatus: 0, millis: 0).encoded()), SpikeHealthReply(httpStatus: 0, millis: 0))
    }

    // MARK: Grenzen aus dem Plan

    func testLimitsMatchThePlan() {
        XCTAssertEqual(SpikeLimits.maxConnections, 4)
        XCTAssertEqual(SpikeLimits.handshakeSeconds, 5)
        XCTAssertEqual(SpikeLimits.idleSeconds, 60)
        XCTAssertEqual(SpikeLimits.blobMaxMegabytes, 50)
        XCTAssertEqual(SpikeLimits.selfDestructSeconds, 4 * 3600)
        XCTAssertEqual(SpikeLimits.serviceType, "_sg-spike._tcp")
    }

    // MARK: Hilfen

    private func header(op: UInt8, length: UInt32) -> [UInt8] {
        [op] + SpikeWire.bigEndian(length)
    }
}
