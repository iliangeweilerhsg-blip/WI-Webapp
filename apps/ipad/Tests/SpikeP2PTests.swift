import XCTest

@testable import StudienGehirn

/// Spike S6 (UX-12, PR 1): Nur die reinen Teile. Protokoll und Verschlüsselung testet das Paket unter
/// `spikes/s6-p2p` (Befehle, Rahmen, Loopback). Netzwerk gibt es hier nicht.
@MainActor
final class SpikeP2PTests: XCTestCase {
    func testFormatUsesGermanDecimalComma() {
        XCTAssertEqual(SpikeP2PFormat.number(1.26), "1,3")
        XCTAssertEqual(SpikeP2PFormat.number(0.5, digits: 2), "0,50")
        XCTAssertEqual(SpikeP2PFormat.seconds(3.456), "3,46 s")
        XCTAssertEqual(SpikeP2PFormat.seconds(12.34), "12,3 s")
        XCTAssertEqual(SpikeP2PFormat.megabytesPerSecond(2), "2,00 MB/s")
    }

    func testDurationAndBattery() {
        XCTAssertEqual(SpikeP2PFormat.duration(0), "0 min 00 s")
        XCTAssertEqual(SpikeP2PFormat.duration(65), "1 min 05 s")
        XCTAssertEqual(SpikeP2PFormat.duration(93 * 60 + 5), "93 min 05 s")
        XCTAssertEqual(SpikeP2PFormat.duration(-4), "0 min 00 s")
        XCTAssertEqual(SpikeP2PFormat.battery(80), "80 %")
        XCTAssertEqual(SpikeP2PFormat.battery(nil), "unbekannt")
    }

    func testSharedCodeIsCompiledIntoTheApp() throws {
        // Dieselben Testvektoren wie im Mac-Paket: Mac und iPad müssen dasselbe ableiten
        let code = try XCTUnwrap(SpikeCode(input: "1234 5678"))
        XCTAssertEqual(code.serviceName, "sgs-9a27d218")
        XCTAssertEqual(code.presharedKey.count, 32)
        XCTAssertEqual(Array(code.presharedKey.prefix(4)), [0x27, 0x33, 0xe1, 0x2b])
        XCTAssertNil(SpikeCode(input: "1234"))
        XCTAssertEqual(SpikeSuites.all.count, 3)
    }

    func testStepsStartWaitingAndListEveryMeasurement() {
        let steps = SpikeP2PModel.initialSteps
        XCTAssertEqual(steps.map(\.id), ["find", "network", "direct", "ping", "health", "download", "echo"])
        XCTAssertTrue(steps.allSatisfy { $0.state == .waiting && $0.detail.isEmpty })
    }

    func testWaysAreOnlyNetworkAndDirect() {
        XCTAssertEqual(SpikeWay.allCases, [.network, .direct])
        XCTAssertFalse(SpikeWay.network.allowsPeerToPeer)
        XCTAssertTrue(SpikeWay.direct.allowsPeerToPeer)
    }

    func testLongRunAverage() {
        var run = SpikeLongRun()
        XCTAssertEqual(run.averageMillis, 0)
        run.pings = 4
        run.rttSumMillis = 100
        XCTAssertEqual(run.averageMillis, 25)
    }
}
