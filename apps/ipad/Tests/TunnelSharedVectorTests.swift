import XCTest

@testable import StudienGehirn

// Testvektoren aus dem Vertrag (docs/VERTRAEGE.md §7.5) gegen den gemeinsamen Code `TunnelShared`, den die App aus
// `apps/mac-tunnel/Sources/TunnelShared` einbindet. Mac-Helfer und iPad müssen dasselbe ableiten; es gibt keine zweite
// Implementierung der Ableitung.
//
// Die Erwartungswerte stammen nicht aus diesem Code, sondern aus HMAC-SHA256 über die rohen Schlüsselbytes (siehe
// apps/mac-tunnel/Tests/TunnelSharedTests/TunnelKeyTests.swift). Schlüssel stehen hier nie als Text-Literal
// (Secret-Scanning): Sie entstehen zur Laufzeit aus Rohbytes. Die langen Hex-Werte sind zweigeteilt.

final class TunnelSharedVectorTests: XCTestCase {
    private func hex(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02x", $0) }.joined()
    }

    /// Rohbytes 0x00 … 0x1f
    private var sequential: TunnelKey { TunnelTestKeys.key(0) }

    /// Rohbytes 0xff × 32
    private func allOnes() throws -> TunnelKey {
        try TunnelKey(rawBytes: [UInt8](repeating: 0xFF, count: 32))
    }

    func testServiceNameVectors() throws {
        XCTAssertEqual(sequential.serviceName, "sg-076cd8b5e7079472")
        XCTAssertEqual(try allOnes().serviceName, "sg-8c534139d3632c4d")
    }

    func testPresharedKeyVectors() throws {
        XCTAssertEqual(
            hex(sequential.presharedKey),
            "6285d1ea289e4f9e" + "017e2368656e3255" + "f85eb5153e1d34a2" + "d782c71cef12e710")
        XCTAssertEqual(
            hex(try allOnes().presharedKey),
            "9b23102d57bde494" + "bf1fb0527e1a2db8" + "f3461626ebfabf50" + "20b0e69b677021d9")
        XCTAssertEqual(sequential.presharedKey.count, 32)
    }

    func testTextFormAndRawFormGiveTheSameValues() throws {
        let fromText = try TunnelKey(base64url: TunnelTestKeys.text(0))
        XCTAssertEqual(fromText.serviceName, sequential.serviceName)
        XCTAssertEqual(fromText.presharedKey, sequential.presharedKey)
    }

    func testFixedConstants() {
        XCTAssertEqual(TunnelConstants.pskIdentity, "sg1")
        XCTAssertEqual(TunnelConstants.serviceType, "_sg-tunnel._tcp")
        // Der Dienstname kommt aus dem Schlüssel und nennt weder Rechnername noch Schlüssel
        let name = sequential.serviceName
        XCTAssertEqual(name.count, 19)
        XCTAssertTrue(name.hasPrefix("sg-"))
    }

    func testKeyNeverPrintsItself() throws {
        let text = TunnelTestKeys.text(0)
        let key = try TunnelKey(base64url: text)
        XCTAssertFalse("\(key)".contains(text.prefix(8)))
        XCTAssertFalse(String(reflecting: key).contains(text.prefix(8)))
    }

    func testOnlyTheCanonicalFormIsAccepted() {
        let good = TunnelTestKeys.text(0)
        XCTAssertEqual(good.count, 43)
        for bad in ["", "abc", good + "x", String(good.dropFirst()), String(good.dropLast()) + "!", good + "="] {
            XCTAssertThrowsError(try TunnelKey(base64url: bad), bad)
        }
        // Dieselben Rohbytes, aber nicht kanonisch: Die 2 überzähligen Bits im letzten Zeichen sind nicht 0
        var characters = Array(good)
        characters[characters.count - 1] = "9"
        XCTAssertThrowsError(try TunnelKey(base64url: String(characters)))
    }

    func testDifferentKeysGiveDifferentNamesAndKeys() {
        let first = TunnelTestKeys.key(1)
        let second = TunnelTestKeys.key(2)
        XCTAssertNotEqual(first.serviceName, second.serviceName)
        XCTAssertNotEqual(first.presharedKey, second.presharedKey)
    }
}

/// Die eigene Prüfung nach dem Handshake (Pflicht aus dem Sicherheits-Review, Plan E12): alles außer TLS 1.2 mit
/// 0xCCAC oder 0xC035 wird geschlossen.
final class TunnelWrongSuiteIsClosedTests: XCTestCase {
    func testAllowedSuitesPass() {
        XCTAssertTrue(TunnelHandshakeCheck.accepts(TunnelNegotiated(suite: 0xCCAC, tlsVersion: 0x0303)))
        XCTAssertTrue(TunnelHandshakeCheck.accepts(TunnelNegotiated(suite: 0xC035, tlsVersion: 0x0303)))
    }

    func testOtherSuitesAreRejected() {
        // PSK ohne ECDHE (kein Schutz alter Mitschnitte), PSK-GCM, Zertifikatsverfahren, TLS_NULL
        for suite: UInt16 in [0x00A8, 0x008C, 0x00A9, 0xC02F, 0xC02B, 0x1301, 0x0000, 0xC036, 0xCCAD] {
            XCTAssertFalse(
                TunnelHandshakeCheck.accepts(TunnelNegotiated(suite: suite, tlsVersion: 0x0303)),
                "Verfahren 0x\(String(suite, radix: 16))")
        }
    }

    func testOtherVersionsAreRejected() {
        // TLS 1.3, TLS 1.1, TLS 1.0, SSL 3: auch mit einem erlaubten Verfahren
        for version: UInt16 in [0x0304, 0x0302, 0x0301, 0x0300, 0x0000] {
            XCTAssertFalse(
                TunnelHandshakeCheck.accepts(TunnelNegotiated(suite: 0xCCAC, tlsVersion: version)),
                "Version 0x\(String(version, radix: 16))")
        }
    }

    func testMissingInformationIsRejected() {
        XCTAssertFalse(TunnelHandshakeCheck.accepts(nil))
    }

    func testOnlyTheTwoEcdhePskSuitesAreOffered() {
        XCTAssertEqual(TunnelSuites.allowed.map(\.id), [0xCCAC, 0xC035])
        XCTAssertFalse(TunnelSuites.isAllowed(0x00A8))
    }
}

/// Auswahl der Kandidaten aus den gefundenen Diensten (Plan §5.3, Punkt 1): der Name, bis zu 4 Kandidaten inklusive
/// Zusatz „ (2)“
final class TunnelCandidateSelectionTests: XCTestCase {
    private let target = "sg-076cd8b5e7079472"

    func testMatchesTheNameAndTheBonjourConflictSuffix() {
        XCTAssertTrue(TunnelCandidates.matches(target, serviceName: target))
        XCTAssertTrue(TunnelCandidates.matches("\(target) (2)", serviceName: target))
        XCTAssertTrue(TunnelCandidates.matches("\(target) (17)", serviceName: target))
    }

    func testRejectsEverythingElse() {
        for other in [
            "", "sg-8c534139d3632c4d", "\(target)2", "\(target) 2", "\(target) (2", "\(target) ()", "\(target) (a)",
            "\(target) (2) (3)", "\(target)  (2)", "x\(target)", "\(target) (1234)", "\(target) (-2)", "\(target) (٢)",
        ] {
            XCTAssertFalse(TunnelCandidates.matches(other, serviceName: target), other)
        }
    }

    func testSelectionIsDeduplicatedSortedAndCappedAtFour() {
        let found = [
            "\(target) (5)", "other", "\(target) (3)", target, "\(target) (2)", "\(target) (3)", "\(target) (4)", "\(target) (6)",
        ]
        let selected = TunnelCandidates.select(from: found, serviceName: target)
        XCTAssertEqual(selected, [target, "\(target) (2)", "\(target) (3)", "\(target) (4)"])
        XCTAssertEqual(TunnelCandidates.maxPerName, 4)
    }

    func testSelectionDoesNotDependOnArrivalOrder() {
        let found = ["\(target) (2)", target, "\(target) (3)"]
        XCTAssertEqual(
            TunnelCandidates.select(from: found, serviceName: target),
            TunnelCandidates.select(from: found.reversed(), serviceName: target))
    }

    func testNoMatchGivesNoCandidate() {
        XCTAssertTrue(TunnelCandidates.select(from: ["_studiengehirn", "sg-0000000000000000"], serviceName: target).isEmpty)
    }
}

/// Weg einer Verbindung nach den Namen der Schnittstellen
final class TunnelPathKindTests: XCTestCase {
    func testClassifiesInterfaceNames() {
        XCTAssertEqual(TunnelPathInfo.classify("awdl0"), .direct)
        XCTAssertEqual(TunnelPathInfo.classify("llw0"), .direct)
        XCTAssertEqual(TunnelPathInfo.classify("en0"), .wifi)
        XCTAssertEqual(TunnelPathInfo.classify("utun3"), .unknown)
    }

    func testRemoteInterfaceDecides() {
        XCTAssertEqual(TunnelPathInfo.kind(remoteInterface: "awdl0", available: ["en0", "awdl0"]), .direct)
        XCTAssertEqual(TunnelPathInfo.kind(remoteInterface: "en0", available: ["en0", "awdl0"]), .wifi)
    }

    func testListDecidesOnlyWhenUnambiguous() {
        XCTAssertEqual(TunnelPathInfo.kind(remoteInterface: nil, available: ["awdl0"]), .direct)
        XCTAssertEqual(TunnelPathInfo.kind(remoteInterface: nil, available: ["en0"]), .wifi)
        XCTAssertEqual(TunnelPathInfo.kind(remoteInterface: nil, available: ["en0", "awdl0"]), .unknown)
        XCTAssertEqual(TunnelPathInfo.kind(remoteInterface: nil, available: []), .unknown)
    }
}
