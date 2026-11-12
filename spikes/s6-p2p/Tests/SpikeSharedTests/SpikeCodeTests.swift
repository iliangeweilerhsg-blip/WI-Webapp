import XCTest

@testable import SpikeShared

final class SpikeCodeTests: XCTestCase {
    private func hex(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02x", $0) }.joined()
    }

    func testInputAcceptsEightDigitsWithOrWithoutSpace() throws {
        XCTAssertEqual(SpikeCode(input: "12345678")?.digits, "12345678")
        XCTAssertEqual(SpikeCode(input: "1234 5678")?.digits, "12345678")
        XCTAssertEqual(SpikeCode(input: " 1234 5678 ")?.digits, "12345678")
        XCTAssertEqual(SpikeCode(input: "00000042")?.digits, "00000042")
        XCTAssertEqual(try XCTUnwrap(SpikeCode(input: "12345678")).display, "1234 5678")
    }

    func testInputRejectsEverythingElse() {
        for bad in ["", "1234567", "123456789", "1234567a", "1234-5678", "١٢٣٤٥٦٧٨", "abcdefgh", "1234 567"] {
            XCTAssertNil(SpikeCode(input: bad), "„\(bad)“ darf kein Code sein")
        }
    }

    func testRandomCodesAreEightDigitsAndVary() {
        var seen = Set<String>()
        for _ in 0..<50 {
            let code = SpikeCode.random()
            XCTAssertEqual(code.digits.count, 8)
            XCTAssertTrue(code.digits.allSatisfy { $0.isASCII && $0.isNumber })
            seen.insert(code.digits)
        }
        // 50 Ziehungen aus 10^8: Gleiche Codes wären ein klares Zeichen für einen Fehler
        XCTAssertGreaterThan(seen.count, 45)
    }

    /// Festgehaltene Werte (Python: hmac.new(code, nachricht, sha256)). Mac und iPad müssen dasselbe ableiten.
    func testDerivationVectors() throws {
        let code = try XCTUnwrap(SpikeCode(input: "12345678"))
        XCTAssertEqual(
            hex(code.presharedKey), "2733e12b18abbee8832c351b8a1e950a239de20aaa1914eedacdd4a7d8b5af43")
        XCTAssertEqual(code.serviceName, "sgs-9a")

        let other = try XCTUnwrap(SpikeCode(input: "00000042"))
        XCTAssertEqual(
            hex(other.presharedKey), "db5b7109b4b7bf2684a40c8de156414c6ab7373f7751ba84efb9e811ab8018cb")
        XCTAssertEqual(other.serviceName, "sgs-ef")
    }

    func testPskIsThirtyTwoBytesAndNameHasNoHostname() throws {
        let code = try XCTUnwrap(SpikeCode(input: "87654321"))
        XCTAssertEqual(code.presharedKey.count, 32)
        XCTAssertTrue(code.serviceName.hasPrefix("sgs-"))
        XCTAssertEqual(code.serviceName.count, 6)
        XCTAssertEqual(SpikeCode.pskIdentity, "sgs1")
    }

    func testSuitesAreThePlansOnesInOrder() {
        XCTAssertEqual(SpikeSuites.all.map(\.id), [0xCCAC, 0xC035, 0x00A8])
        XCTAssertEqual(SpikeSuites.all.map(\.forwardSecret), [true, true, false])
        XCTAssertEqual(SpikeSuites.name(for: 0x00A8), "TLS_PSK_WITH_AES_128_GCM_SHA256")
        XCTAssertEqual(SpikeSuites.name(for: 0x1301), "0x1301")
    }

    func testOnlyTls12WithKnownSuitesIsAllowed() {
        XCTAssertTrue(SpikeNegotiated(suite: 0xCCAC, tlsVersion: 0x0303).isAllowed)
        XCTAssertTrue(SpikeNegotiated(suite: 0x00A8, tlsVersion: 0x0303).isAllowed)
        XCTAssertFalse(SpikeNegotiated(suite: 0x00A8, tlsVersion: 0x0304).isAllowed)
        XCTAssertFalse(SpikeNegotiated(suite: 0x1301, tlsVersion: 0x0303).isAllowed)
        XCTAssertEqual(
            SpikeNegotiated(suite: 0xCCAC, tlsVersion: 0x0303).text,
            "TLS 1.2, TLS_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256")
    }

    func testRouteFromInterfaceNames() {
        XCTAssertEqual(SpikeInterfaces(remote: "awdl0", available: ["en0", "awdl0"]).route, .direct)
        XCTAssertEqual(SpikeInterfaces(remote: "en0", available: ["en0", "awdl0"]).route, .network)
        XCTAssertEqual(SpikeInterfaces(remote: nil, available: ["awdl0"]).route, .direct)
        XCTAssertEqual(SpikeInterfaces(remote: nil, available: ["en0"]).route, .network)
        // Beide verfügbar und die Gegenseite unbekannt: ehrlich „unklar“
        XCTAssertEqual(SpikeInterfaces(remote: nil, available: ["en0", "awdl0"]).route, .unclear)
        XCTAssertEqual(SpikeInterfaces(remote: nil, available: []).route, .unclear)
        XCTAssertEqual(SpikeInterfaces(remote: "llw0", available: []).route, .direct)
        XCTAssertEqual(SpikeInterfaces(remote: "utun3", available: []).route, .unclear)
    }
}
