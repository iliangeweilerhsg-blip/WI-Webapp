import XCTest

@testable import TunnelShared

/// Testvektoren aus dem Vertrag (docs/VERTRAEGE.md §7.5) und aus `services/core/test/unit/tunnel-keys.test.ts`.
/// Die Erwartungswerte stammen nicht aus diesem Code, sondern aus HMAC-SHA256 über die rohen Schlüsselbytes
/// (zuerst mit `openssl dgst -sha256 -mac HMAC -macopt hexkey:…` bzw. Python `hmac`).
///
/// Schlüssel stehen hier nie als Text-Literal (Secret-Scanning): Sie werden aus Bytes erzeugt und kodiert.
final class TunnelKeyTests: XCTestCase {
    /// Rohbytes 0x00 … 0x1f
    static let sequential: [UInt8] = Array(0..<32)
    /// Rohbytes 0xff × 32
    static let allOnes: [UInt8] = [UInt8](repeating: 0xFF, count: 32)

    /// base64url ohne Padding, 43 Zeichen
    static func encode(_ bytes: [UInt8]) -> String {
        Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func hex(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02x", $0) }.joined()
    }

    func testServiceNameVectors() throws {
        let first = try TunnelKey(base64url: Self.encode(Self.sequential))
        XCTAssertEqual(first.serviceName, "sg-076cd8b5e7079472")
        let second = try TunnelKey(base64url: Self.encode(Self.allOnes))
        XCTAssertEqual(second.serviceName, "sg-8c534139d3632c4d")
    }

    func testPresharedKeyVectors() throws {
        let first = try TunnelKey(base64url: Self.encode(Self.sequential))
        XCTAssertEqual(hex(first.presharedKey), "6285d1ea289e4f9e017e2368656e3255f85eb5153e1d34a2d782c71cef12e710")
        let second = try TunnelKey(base64url: Self.encode(Self.allOnes))
        XCTAssertEqual(hex(second.presharedKey), "9b23102d57bde494bf1fb0527e1a2db8f3461626ebfabf5020b0e69b677021d9")
        XCTAssertEqual(first.presharedKey.count, 32)
    }

    func testRawBytesInitGivesTheSameValues() throws {
        let fromText = try TunnelKey(base64url: Self.encode(Self.sequential))
        let fromBytes = try TunnelKey(rawBytes: Self.sequential)
        XCTAssertEqual(fromText.serviceName, fromBytes.serviceName)
        XCTAssertEqual(fromText.presharedKey, fromBytes.presharedKey)
        XCTAssertThrowsError(try TunnelKey(rawBytes: [1, 2, 3]))
    }

    func testPskIdentityIsFixed() {
        XCTAssertEqual(TunnelConstants.pskIdentity, "sg1")
        XCTAssertEqual(TunnelConstants.serviceType, "_sg-tunnel._tcp")
    }

    func testServiceNameRevealsNeitherKeyNorHostName() throws {
        let key = try TunnelKey(base64url: Self.encode(Self.sequential))
        let name = key.serviceName
        XCTAssertEqual(name.count, 19)
        XCTAssertTrue(name.hasPrefix("sg-"))
        XCTAssertTrue(name.dropFirst(3).allSatisfy { "0123456789abcdef".contains($0) })
        let host = ProcessInfo.processInfo.hostName
        XCTAssertTrue(host.isEmpty || !name.contains(host))
    }

    func testKeyNeverPrintsItself() throws {
        let text = Self.encode(Self.sequential)
        let key = try TunnelKey(base64url: text)
        XCTAssertFalse("\(key)".contains(text.prefix(8)))
        XCTAssertFalse(String(reflecting: key).contains(text.prefix(8)))
    }

    func testOnlyCanonicalFortyThreeCharactersAreAccepted() throws {
        let good = Self.encode(Self.sequential)
        XCTAssertEqual(good.count, 43)
        for bad in ["", "abc", good + "x", String(good.dropFirst()), String(good.dropLast()) + "!", good + "="] {
            XCTAssertThrowsError(try TunnelKey(base64url: bad), bad)
        }
        // Gleiche Rohbytes, aber nicht kanonisch: Die 2 überzähligen Bits im letzten Zeichen sind nicht 0
        XCTAssertEqual(good.last, "8")
        let nonCanonical = String(good.dropLast()) + "9"
        XCTAssertThrowsError(try TunnelKey(base64url: nonCanonical))
        let ones = Self.encode(Self.allOnes)
        XCTAssertEqual(ones.last, "8")
        XCTAssertThrowsError(try TunnelKey(base64url: String(ones.dropLast()) + "_"))
        // Standard-Alphabet (+ und /) ist kein base64url
        XCTAssertThrowsError(try TunnelKey(base64url: String(good.dropLast(2)) + "+/"))
    }

    // MARK: TLS-Tabelle

    func testOnlyTheTwoEcdhePskSuitesAreAllowed() {
        XCTAssertEqual(TunnelSuites.allowed.map { $0.id }, [0xCCAC, 0xC035])
        XCTAssertTrue(TunnelSuites.isAllowed(0xCCAC))
        XCTAssertTrue(TunnelSuites.isAllowed(0xC035))
        XCTAssertFalse(TunnelSuites.isAllowed(0x00A8), "TLS_PSK_WITH_AES_128_GCM_SHA256 ist ohne ECDHE nicht erlaubt")
        XCTAssertFalse(TunnelSuites.isAllowed(0xC02F), "ein Verfahren ohne PSK")
        XCTAssertFalse(TunnelSuites.isAllowed(0x1301), "TLS 1.3")
    }

    func testNegotiatedMustBeTls12WithAnAllowedSuite() {
        XCTAssertTrue(TunnelNegotiated(suite: 0xCCAC, tlsVersion: TunnelNegotiated.tls12).isAllowed)
        XCTAssertTrue(TunnelNegotiated(suite: 0xC035, tlsVersion: TunnelNegotiated.tls12).isAllowed)
        XCTAssertFalse(TunnelNegotiated(suite: 0xCCAC, tlsVersion: 0x0304).isAllowed, "TLS 1.3 ist nicht vorgesehen")
        XCTAssertFalse(TunnelNegotiated(suite: 0x00A8, tlsVersion: TunnelNegotiated.tls12).isAllowed)
        XCTAssertFalse(TunnelNegotiated(suite: 0xC02F, tlsVersion: TunnelNegotiated.tls12).isAllowed)
        XCTAssertEqual(
            TunnelNegotiated(suite: 0xCCAC, tlsVersion: TunnelNegotiated.tls12).text,
            "TLS 1.2, TLS_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256")
    }
}
