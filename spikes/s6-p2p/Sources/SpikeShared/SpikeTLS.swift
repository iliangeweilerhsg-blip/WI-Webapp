@preconcurrency import Network
import Foundation

/// Ein TLS-Verfahren aus Plan E12
public struct SpikeSuite: Equatable, Hashable, Sendable {
    public let id: UInt16
    public let name: String
    /// Schutz alter Mitschnitte (ECDHE)
    public let forwardSecret: Bool

    public init(id: UInt16, name: String, forwardSecret: Bool) {
        self.id = id
        self.name = name
        self.forwardSecret = forwardSecret
    }
}

public enum SpikeSuites {
    public static let ecdhePskChaCha = SpikeSuite(
        id: 0xCCAC, name: "TLS_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256", forwardSecret: true)
    public static let ecdhePskAesCbc = SpikeSuite(
        id: 0xC035, name: "TLS_ECDHE_PSK_WITH_AES_128_CBC_SHA", forwardSecret: true)
    public static let pskAesGcm = SpikeSuite(
        id: 0x00A8, name: "TLS_PSK_WITH_AES_128_GCM_SHA256", forwardSecret: false)

    /// In der Reihenfolge des Plans: erst mit ECDHE, zuletzt Apples Beispiel ohne ECDHE
    public static let all: [SpikeSuite] = [ecdhePskChaCha, ecdhePskAesCbc, pskAesGcm]

    public static func name(for id: UInt16) -> String {
        if let known = all.first(where: { $0.id == id }) { return known.name }
        return "0x" + String(id, radix: 16, uppercase: true)
    }

    public static func contains(_ id: UInt16) -> Bool {
        all.contains { $0.id == id }
    }
}

/// Was die Gegenseite nach dem Handshake wirklich ausgehandelt hat
public struct SpikeNegotiated: Equatable, Sendable {
    public let suite: UInt16
    public let tlsVersion: UInt16

    public init(suite: UInt16, tlsVersion: UInt16) {
        self.suite = suite
        self.tlsVersion = tlsVersion
    }

    public static let tls12: UInt16 = 0x0303

    /// Nur TLS 1.2 mit einem der Verfahren aus E12 ist zulässig
    public var isAllowed: Bool {
        tlsVersion == SpikeNegotiated.tls12 && SpikeSuites.contains(suite)
    }

    public var text: String {
        let version =
            tlsVersion == SpikeNegotiated.tls12 ? "TLS 1.2" : "TLS 0x" + String(tlsVersion, radix: 16, uppercase: true)
        return "\(version), \(SpikeSuites.name(for: suite))"
    }
}

public enum SpikeTLS {
    /// Parameter für Listener und Verbindung: TCP, TLS 1.2 (min = max) mit PSK, nur die genannten Verfahren.
    /// Verfahren, die dieses SDK nicht kennt, bleiben weg (`tls_ciphersuite_t(rawValue:)` liefert dann `nil`).
    public static func parameters(code: SpikeCode, suites: [SpikeSuite], peerToPeer: Bool) -> NWParameters {
        let tls = NWProtocolTLS.Options()
        let options = tls.securityProtocolOptions
        sec_protocol_options_set_min_tls_protocol_version(options, .TLSv12)
        sec_protocol_options_set_max_tls_protocol_version(options, .TLSv12)
        let psk = dispatchData(code.presharedKey)
        let identity = dispatchData(Array(SpikeCode.pskIdentity.utf8))
        sec_protocol_options_add_pre_shared_key(options, psk as __DispatchData, identity as __DispatchData)
        for suite in suites {
            if let known = tls_ciphersuite_t(rawValue: suite.id) {
                sec_protocol_options_append_tls_ciphersuite(options, known)
            }
        }
        let tcp = NWProtocolTCP.Options()
        tcp.enableKeepalive = true
        let parameters = NWParameters(tls: tls, tcp: tcp)
        parameters.includePeerToPeer = peerToPeer
        return parameters
    }

    /// Ausgehandeltes Verfahren einer Verbindung, erst nach dem Handshake (`.ready`) vorhanden
    public static func negotiated(on connection: NWConnection) -> SpikeNegotiated? {
        guard let metadata = connection.metadata(definition: NWProtocolTLS.definition) as? NWProtocolTLS.Metadata else {
            return nil
        }
        let security = metadata.securityProtocolMetadata
        let suite = sec_protocol_metadata_get_negotiated_tls_ciphersuite(security).rawValue
        let version = sec_protocol_metadata_get_negotiated_tls_protocol_version(security).rawValue
        return SpikeNegotiated(suite: suite, tlsVersion: version)
    }

    private static func dispatchData(_ bytes: [UInt8]) -> DispatchData {
        bytes.withUnsafeBytes { DispatchData(bytes: $0) }
    }
}
