import XCTest

@testable import StudienGehirn

/// Heimnetz oder nicht: Grundlage der Warnung vor dem Koppeln (Review M-1)
final class AddressScopeTests: XCTestCase {
    private func assertPrivate(_ host: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(AddressScope.classify(host: host), .privateNetwork, host, file: file, line: line)
    }

    private func assertPublic(_ host: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(AddressScope.classify(host: host), .publicNetwork, host, file: file, line: line)
    }

    func testRfc1918IsPrivate() {
        for host in [
            "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.0.1", "192.168.178.20",
        ] {
            assertPrivate(host)
        }
    }

    func testEdgesOfRfc1918ArePublic() {
        for host in ["9.255.255.255", "11.0.0.1", "172.15.255.255", "172.32.0.1", "192.167.1.1", "192.169.1.1"] {
            assertPublic(host)
        }
    }

    func testLinkLocalSharedAndLoopbackArePrivate() {
        for host in ["169.254.0.1", "169.254.255.254", "100.64.0.1", "100.127.255.254", "127.0.0.1"] {
            assertPrivate(host)
        }
        for host in ["169.253.1.1", "169.255.1.1", "100.63.255.255", "100.128.0.1"] {
            assertPublic(host)
        }
    }

    func testPublicIPv4IsPublic() {
        // 192.0.2.0/24, 198.51.100.0/24 und 203.0.113.0/24 sind Dokumentationsbereiche
        for host in ["192.0.2.10", "198.51.100.7", "203.0.113.9", "1.1.1.1", "0.0.0.0", "255.255.255.255"] {
            assertPublic(host)
        }
    }

    func testBonjourNamesArePrivate() {
        for host in ["mein-mac.local", "Mein-Mac.LOCAL", "mac.buero.local", "mein-mac.local.", " mein-mac.local "] {
            assertPrivate(host)
        }
    }

    func testOtherNamesArePublic() {
        for host in ["example.com", "local", "mac.localhost", "mac.local.example.com", "evil.local.com", ".local"] {
            assertPublic(host)
        }
    }

    func testIPv6UniqueLocalAndLinkLocalArePrivate() {
        for host in [
            "fd12:3456:789a::1", "fc00::1", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "fe80::1", "febf::1",
            "FE80::1C2A:3BFF:FE4D:5E6F", "fe80::1%en0", "[fe80::1]", "[fd00::2%en0]", "::1",
        ] {
            assertPrivate(host)
        }
    }

    func testOtherIPv6IsPublic() {
        for host in [
            "2001:db8::1", "2a00:1450:4001:80b::200e", "fec0::1", "fbff::1", "fe00::1", "::", "::2", "ff02::1",
        ] {
            assertPublic(host)
        }
    }

    func testIPv4MappedIPv6FollowsTheIPv4Address() {
        assertPrivate("::ffff:192.168.1.20")
        assertPrivate("::ffff:10.0.0.5")
        assertPublic("::ffff:192.0.2.10")
        assertPublic("::ffff:999.1.1.1")
    }

    func testLeadingZerosAreNotReadAsPrivate() {
        // N-1 aus dem Review von #192: `010` könnte oktal gelesen werden (8.0.0.1)
        for host in [
            "010.0.0.1", "10.00.0.1", "10.0.0.01", "0127.0.0.1", "192.168.01.20", "192.0168.1.20",
            "172.016.0.1", "00.0.0.0", "::ffff:010.0.0.1", "::ffff:192.168.1.020",
        ] {
            assertPublic(host)
        }
        // Die Null selbst bleibt ein gültiges Oktett
        assertPrivate("10.0.0.1")
        assertPrivate("192.168.0.0")
    }

    func testGarbageIsPublic() {
        // Im Zweifel warnen
        for host in [
            "", "   ", "192.168.1", "192.168.1.256", "192.168.1.1.1", "192.168.01x.1", "10.0.0.1.evil.com",
            "fe80", "fe80:", "gggg::1", "fd00:zz::1", "fd000::1", "1:2:3:4:5:6:7:8:9",
        ] {
            assertPublic(host)
        }
    }

    func testEndpointExposesScope() throws {
        XCTAssertEqual(try XCTUnwrap(CoreEndpoint(host: "192.168.1.20")).scope, .privateNetwork)
        XCTAssertEqual(try XCTUnwrap(CoreEndpoint(host: "mein-mac.local")).scope, .privateNetwork)
        XCTAssertEqual(try XCTUnwrap(CoreEndpoint(host: "192.0.2.10")).scope, .publicNetwork)
    }
}
