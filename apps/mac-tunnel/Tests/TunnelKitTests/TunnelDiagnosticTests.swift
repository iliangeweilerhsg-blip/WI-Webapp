import XCTest

@preconcurrency import Network
import TunnelShared

@testable import TunnelKit

// VORÜBERGEHEND (Review PR #275): Warum scheitert der Handshake mit richtigem Schlüssel nur manchmal?
// Gibt keine Schlüssel aus, nur Eigenschaften.
final class TunnelDiagnosticTests: XCTestCase {
    private final class ServerSide: @unchecked Sendable {
        let lock = NSLock()
        var states: [String] = []
        var connections: [NWConnection] = []
        func add(_ text: String) {
            lock.lock()
            states.append(text)
            lock.unlock()
        }
        var text: String {
            lock.lock()
            defer { lock.unlock() }
            return states.joined(separator: " | ")
        }
    }

    private func attempt(serverSuites: [UInt16], label: String) async throws -> Bool {
        let device = TestDevice()
        let psk = device.presharedKey
        let queue = DispatchQueue(label: "diag.server")
        let side = ServerSide()
        let listener = try NWListener(
            using: TunnelTLS.parameters(presharedKey: psk, suiteIDs: serverSuites, peerToPeer: false))
        listener.newConnectionHandler = { connection in
            side.lock.lock()
            side.connections.append(connection)
            side.lock.unlock()
            connection.stateUpdateHandler = { state in
                var text = "\(state)"
                if case .ready = state {
                    text += " " + (TunnelTLS.negotiated(on: connection)?.text ?? "kein Verfahren")
                }
                side.add(text)
            }
            connection.start(queue: queue)
        }
        listener.start(queue: queue)
        let ready = await waitUntil(timeout: 3) { listener.port != nil }
        guard ready, let port = listener.port?.rawValue else {
            listener.cancel()
            print("DIAG \(label): Listener nicht bereit")
            return false
        }
        let client = TestClient.tls(port: port, presharedKey: psk)
        let ok = await client.connect(timeout: 3)
        print(
            "DIAG \(label): ok=\(ok) null=\(psk.contains(0)) erstes>=0x80=\(psk[0] >= 0x80) "
                + "ausgehandelt=\(client.negotiated?.text ?? "-") client=[\(client.stateHistory)] server=[\(side.text)]")
        fflush(stdout)
        client.close()
        listener.cancel()
        side.lock.lock()
        for connection in side.connections { connection.cancel() }
        side.lock.unlock()
        return ok
    }

    func testDiagnoseHandshakeWithRandomKeys() async throws {
        var okOnlyEcdhe = 0
        var okAll = 0
        for index in 0..<10 {
            if try await attempt(serverSuites: TunnelSuites.allowed.map { $0.id }, label: "nurECDHE#\(index)") {
                okOnlyEcdhe += 1
            }
            if try await attempt(serverSuites: [0xCCAC, 0xC035, 0x00A8], label: "alle#\(index)") { okAll += 1 }
        }
        print("DIAG Ergebnis: nurECDHE \(okOnlyEcdhe)/10, alle \(okAll)/10")
    }
}
