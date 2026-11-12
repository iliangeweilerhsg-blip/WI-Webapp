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

    enum Variant: String, CaseIterable {
        case baseline, spikeClient, ipv6, loopbackInterface, localhost, delayed
    }

    private func clientParameters(_ psk: [UInt8], _ variant: Variant) -> NWParameters {
        switch variant {
        case .spikeClient:
            let tls = NWProtocolTLS.Options()
            let options = tls.securityProtocolOptions
            sec_protocol_options_set_min_tls_protocol_version(options, .TLSv12)
            sec_protocol_options_set_max_tls_protocol_version(options, .TLSv12)
            let key = psk.withUnsafeBytes { DispatchData(bytes: $0) }
            let identity = Array(TunnelConstants.pskIdentity.utf8).withUnsafeBytes { DispatchData(bytes: $0) }
            sec_protocol_options_add_pre_shared_key(options, key as __DispatchData, identity as __DispatchData)
            for id in TunnelSuites.allowed.map({ $0.id }) {
                if let known = tls_ciphersuite_t(rawValue: id) { sec_protocol_options_append_tls_ciphersuite(options, known) }
            }
            let tcp = NWProtocolTCP.Options()
            tcp.enableKeepalive = true
            return NWParameters(tls: tls, tcp: tcp)
        case .loopbackInterface:
            let parameters = TunnelTLS.parameters(presharedKey: psk, peerToPeer: false)
            parameters.requiredInterfaceType = .loopback
            return parameters
        default:
            return TunnelTLS.parameters(presharedKey: psk, peerToPeer: false)
        }
    }

    private func attempt(variant: Variant, label: String) async throws -> Bool {
        let serverSuites = TunnelSuites.allowed.map { $0.id }
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
        if variant == .delayed { try await Task.sleep(nanoseconds: 300_000_000) }
        let nwPort = NWEndpoint.Port(rawValue: port)!
        let endpoint: NWEndpoint
        switch variant {
        case .ipv6: endpoint = .hostPort(host: .ipv6(.loopback), port: nwPort)
        case .localhost: endpoint = .hostPort(host: "localhost", port: nwPort)
        default: endpoint = .hostPort(host: "127.0.0.1", port: nwPort)
        }
        let client = TestClient(connection: NWConnection(to: endpoint, using: clientParameters(psk, variant)))
        let ok = await client.connect(timeout: 2)
        print(
            "DIAG \(label): ok=\(ok) port=\(port) listener=\(String(describing: listener.parameters.requiredLocalEndpoint)) "
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
        var summary: [String] = []
        for variant in Variant.allCases {
            var ok = 0
            for index in 0..<5 {
                if try await attempt(variant: variant, label: "\(variant.rawValue)#\(index)") { ok += 1 }
            }
            summary.append("\(variant.rawValue) \(ok)/5")
        }
        print("DIAG Ergebnis: \(summary.joined(separator: ", "))")
    }
}
