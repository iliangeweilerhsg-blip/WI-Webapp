import XCTest

import TunnelShared

@testable import TunnelKit

/// Schlüsseldatei (Plan E8, §5.2): lesen mit O_NOFOLLOW, Besitzer und Rechte prüfen, bei jedem Fehler keine Schlüssel.
final class TunnelKeyFileTests: XCTestCase {
    private var uid: uid_t { geteuid() }

    private func load(_ environment: TunnelTestEnvironment, uid: uid_t? = nil) -> TunnelKeyFileResult {
        TunnelKeyFile.load(path: environment.keysPath, expectedUID: uid ?? self.uid)
    }

    func testReadsAValidFileAndDerivesNameAndPsk() throws {
        let environment = try TunnelTestEnvironment()
        let first = TestDevice()
        let second = TestDevice()
        try environment.writeKeys([first, second])
        guard case .devices(let devices) = load(environment) else { return XCTFail("\(load(environment))") }
        XCTAssertEqual(devices.map { $0.deviceID }, [first.id, second.id])
        XCTAssertEqual(devices[0].serviceName, first.serviceName)
        XCTAssertEqual(devices[0].presharedKey, first.presharedKey)
        XCTAssertEqual(devices[1].serviceName, second.serviceName)
        XCTAssertNotEqual(devices[0].serviceName, devices[1].serviceName)
    }

    func testEmptyDeviceListIsValid() throws {
        let environment = try TunnelTestEnvironment()
        try environment.writeKeys([])
        XCTAssertEqual(load(environment), .devices([]))
    }

    func testMissingFileAndMissingDirectory() throws {
        let environment = try TunnelTestEnvironment()
        XCTAssertEqual(load(environment), .missing)
        try FileManager.default.removeItem(atPath: environment.secretsDirectory)
        XCTAssertEqual(load(environment), .missing)
    }

    func testWrongFileModeIsInsecure() throws {
        let environment = try TunnelTestEnvironment()
        for mode: mode_t in [0o644, 0o640, 0o660, 0o400, 0o777] {
            try environment.writeKeys([TestDevice()], mode: mode)
            guard case .insecure(let text) = load(environment) else { return XCTFail("Modus \(String(mode, radix: 8))") }
            XCTAssertTrue(text.contains("0600"), text)
        }
    }

    func testWrongDirectoryModeIsInsecure() throws {
        let environment = try TunnelTestEnvironment()
        try environment.writeKeys([TestDevice()])
        chmod(environment.secretsDirectory, 0o755)
        guard case .insecure(let text) = load(environment) else { return XCTFail("\(load(environment))") }
        XCTAssertTrue(text.contains("0700"), text)
        chmod(environment.secretsDirectory, 0o700)
        guard case .devices = load(environment) else { return XCTFail("\(load(environment))") }
    }

    func testForeignOwnerIsInsecure() throws {
        let environment = try TunnelTestEnvironment()
        try environment.writeKeys([TestDevice()])
        // Wir erwarten einen anderen Besitzer als den, dem die Dateien gehören
        guard case .insecure(let text) = load(environment, uid: uid &+ 1) else { return XCTFail("\(load(environment))") }
        XCTAssertTrue(text.contains("anderen Benutzer"), text)
    }

    func testSymlinkAsFileIsInsecureAndNeverFollowed() throws {
        let environment = try TunnelTestEnvironment()
        let target = environment.root + "/real.json"
        try environment.writeFile(target, "{\"v\":1,\"devices\":[]}\n")
        XCTAssertEqual(symlink(target, environment.keysPath), 0)
        guard case .insecure(let text) = load(environment) else { return XCTFail("\(load(environment))") }
        XCTAssertTrue(text.contains("Symlink"), text)
    }

    func testSymlinkAsDirectoryIsInsecure() throws {
        let environment = try TunnelTestEnvironment()
        try environment.writeKeys([TestDevice()])
        let moved = environment.root + "/secrets-real"
        XCTAssertEqual(rename(environment.secretsDirectory, moved), 0)
        XCTAssertEqual(symlink(moved, environment.secretsDirectory), 0)
        guard case .insecure = load(environment) else { return XCTFail("\(load(environment))") }
    }

    func testDirectoryInPlaceOfFileIsInsecure() throws {
        let environment = try TunnelTestEnvironment()
        mkdir(environment.keysPath, 0o700)
        guard case .insecure = load(environment) else { return XCTFail("\(load(environment))") }
    }

    func testBrokenContentGivesNoKeysAtAll() throws {
        let environment = try TunnelTestEnvironment()
        let good = TestDevice()
        let goodEntry = "{\"device_id\":\"\(good.id)\",\"tunnel_key\":\"\(good.keyText)\"}"
        let other = TestDevice()
        let bad: [String] = [
            "",
            "kein json",
            "{\"v\":2,\"devices\":[]}",
            "{\"devices\":[]}",
            "{\"v\":1}",
            "{\"v\":1,\"devices\":[\(goodEntry),{\"device_id\":\"\(other.id)\",\"tunnel_key\":\"kurz\"}]}",
            "{\"v\":1,\"devices\":[\(goodEntry),{\"device_id\":\"keine-uuid\",\"tunnel_key\":\"\(other.keyText)\"}]}",
            "{\"v\":1,\"devices\":[\(goodEntry),{\"device_id\":\"\(good.id.uppercased())\",\"tunnel_key\":\"\(other.keyText)\"}]}",
            "{\"v\":1,\"devices\":[\(goodEntry),\(goodEntry)]}",
            "{\"v\":1,\"devices\":[\(goodEntry),{\"device_id\":\"\(other.id)\",\"tunnel_key\":\"\(good.keyText)\"}]}",
        ]
        for content in bad {
            try environment.writeFile(environment.keysPath, content)
            switch load(environment) {
            case .broken(let text):
                XCTAssertFalse(text.contains(good.keyText), "Meldung enthält Schlüssel")
                XCTAssertFalse(text.contains(good.id), "Meldung enthält Geräte-ID")
            default:
                XCTFail("sollte kaputt sein: \(content.prefix(60))")
            }
        }
    }

    func testTooManyDevicesAndTooLargeFileAreBroken() throws {
        let environment = try TunnelTestEnvironment()
        try environment.writeKeys((0...TunnelLimits.maxDevices).map { _ in TestDevice() })
        guard case .broken = load(environment) else { return XCTFail("\(load(environment))") }
        try environment.writeFile(environment.keysPath, String(repeating: " ", count: TunnelLimits.maxKeyFileBytes + 1))
        guard case .broken = load(environment) else { return XCTFail("\(load(environment))") }
    }

    func testSignatureChangesWhenTheFileIsRewrittenOrRemoved() throws {
        let environment = try TunnelTestEnvironment()
        let missing = TunnelKeyFile.signature(path: environment.keysPath)
        XCTAssertNil(missing.file)
        try environment.writeKeys([TestDevice()])
        let first = TunnelKeyFile.signature(path: environment.keysPath)
        XCTAssertNotNil(first.file)
        XCTAssertEqual(first, TunnelKeyFile.signature(path: environment.keysPath))
        try environment.writeKeys([TestDevice()])
        XCTAssertNotEqual(first, TunnelKeyFile.signature(path: environment.keysPath))
        let second = TunnelKeyFile.signature(path: environment.keysPath)
        chmod(environment.keysPath, 0o644)
        XCTAssertNotEqual(second, TunnelKeyFile.signature(path: environment.keysPath), "Rechte ändern die Signatur")
        environment.removeKeys()
        XCTAssertNil(TunnelKeyFile.signature(path: environment.keysPath).file)
    }

    func testDevicesNeverPrintTheirPsk() throws {
        let device = TestDevice()
        let environment = try TunnelTestEnvironment()
        try environment.writeKeys([device])
        guard case .devices(let devices) = load(environment) else { return XCTFail("\(load(environment))") }
        let printed = "\(devices[0]) \(String(reflecting: devices[0]))"
        XCTAssertFalse(printed.contains(device.presharedKeyHex))
        XCTAssertFalse(printed.contains(device.keyText))
    }

    // MARK: Zustandsdatei

    func testStateFileHasTheDocumentedShapeAndNoSecrets() throws {
        let environment = try TunnelTestEnvironment()
        let device = TestDevice()
        let state = TunnelState(
            pid: 4242, version: TunnelInfo.version, updated_at: TunnelStateFile.timestamp(Date(timeIntervalSince1970: 0)),
            core: "ok", p2p: true, keys: "ok",
            listeners: [
                TunnelListenerState(
                    service_name: device.serviceName, advertised_name: device.serviceName, state: "ready",
                    connections: 2, handshakes_pending: 1, handshakes_failed: 3)
            ],
            last_error: nil)
        try TunnelStateFile.write(state, to: environment.statePath)

        var info = stat()
        XCTAssertEqual(lstat(environment.statePath, &info), 0)
        XCTAssertEqual(UInt32(info.st_mode) & 0o777, 0o600)
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: environment.runDirectory).filter { $0.hasSuffix(".tmp") }
        XCTAssertEqual(leftovers, [], "Temp-Datei bleibt liegen")

        let data = try Data(contentsOf: URL(fileURLWithPath: environment.statePath))
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(
            Set(object.keys), ["pid", "version", "updated_at", "core", "p2p", "keys", "listeners"],
            "last_error fehlt, solange es keinen Fehler gibt")
        XCTAssertEqual(object["updated_at"] as? String, "1970-01-01T00:00:00Z")
        let listener = try XCTUnwrap((object["listeners"] as? [[String: Any]])?.first)
        XCTAssertEqual(
            Set(listener.keys),
            ["service_name", "advertised_name", "state", "connections", "handshakes_pending", "handshakes_failed"])
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertFalse(text.contains(device.keyText))
        XCTAssertFalse(text.contains(device.presharedKeyHex))
        XCTAssertFalse(text.contains("127.0.0.1"))
        XCTAssertEqual(try JSONDecoder().decode(TunnelState.self, from: data), state)
    }

    func testStateFileIsReplacedAtomicallyAndWithoutFollowingSymlinks() throws {
        let environment = try TunnelTestEnvironment()
        let base = TunnelState(
            pid: 1, version: "x", updated_at: "a", core: "ok", p2p: false, keys: "ok", listeners: [], last_error: nil)
        try TunnelStateFile.write(base, to: environment.statePath)
        var newer = base
        newer.core = "nicht erreichbar"
        newer.last_error = "Fehler"
        try TunnelStateFile.write(newer, to: environment.statePath)
        let data = try Data(contentsOf: URL(fileURLWithPath: environment.statePath))
        XCTAssertEqual(try JSONDecoder().decode(TunnelState.self, from: data), newer)

        // Ein Symlink am Zielpfad wird ersetzt, sein Ziel bleibt unberührt
        let victim = environment.root + "/victim.txt"
        try "unberührt".write(toFile: victim, atomically: false, encoding: .utf8)
        unlink(environment.statePath)
        XCTAssertEqual(symlink(victim, environment.statePath), 0)
        try TunnelStateFile.write(base, to: environment.statePath)
        XCTAssertEqual(try String(contentsOfFile: victim, encoding: .utf8), "unberührt")
    }
}
