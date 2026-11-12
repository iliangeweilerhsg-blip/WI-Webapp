@preconcurrency import Network
import Foundation

// TLS 1.2 mit vorab geteiltem Schlüssel (PSK) für den Tunnel (UX-12, Plan E12, E13).
// Aus dem Spike S6 (spikes/s6-p2p/Sources/SpikeShared/SpikeTLS.swift) übernommen: In der CI gingen TLS 1.2 mit
// 0xCCAC, 0xC035 und 0x00A8 über Loopback, ein falscher Schlüssel scheiterte mit „bad MAC“. Der Tunnel erlaubt nur die
// beiden ECDHE-Verfahren (Schutz alter Mitschnitte), weil der Spike gezeigt hat, dass sie gehen.

/// Ein erlaubtes TLS-Verfahren
public struct TunnelSuite: Equatable, Hashable, Sendable {
    public let id: UInt16
    public let name: String

    public init(id: UInt16, name: String) {
        self.id = id
        self.name = name
    }
}

public enum TunnelSuites {
    public static let ecdhePskChaCha = TunnelSuite(id: 0xCCAC, name: "TLS_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256")
    public static let ecdhePskAesCbc = TunnelSuite(id: 0xC035, name: "TLS_ECDHE_PSK_WITH_AES_128_CBC_SHA")

    /// Nur diese beiden, in dieser Reihenfolge (Plan E12). Alles andere weisen beide Seiten ab.
    public static let allowed: [TunnelSuite] = [ecdhePskChaCha, ecdhePskAesCbc]

    public static func name(for id: UInt16) -> String {
        if let known = allowed.first(where: { $0.id == id }) { return known.name }
        return "0x" + String(id, radix: 16, uppercase: true)
    }

    public static func isAllowed(_ id: UInt16) -> Bool {
        allowed.contains { $0.id == id }
    }
}

/// Was nach dem Handshake wirklich ausgehandelt wurde
public struct TunnelNegotiated: Equatable, Sendable {
    public let suite: UInt16
    public let tlsVersion: UInt16

    public init(suite: UInt16, tlsVersion: UInt16) {
        self.suite = suite
        self.tlsVersion = tlsVersion
    }

    public static let tls12: UInt16 = 0x0303

    /// Nur TLS 1.2 mit einem der Verfahren aus `TunnelSuites.allowed` ist zulässig
    public var isAllowed: Bool {
        tlsVersion == TunnelNegotiated.tls12 && TunnelSuites.isAllowed(suite)
    }

    public var text: String {
        let version =
            tlsVersion == TunnelNegotiated.tls12 ? "TLS 1.2" : "TLS 0x" + String(tlsVersion, radix: 16, uppercase: true)
        return "\(version), \(TunnelSuites.name(for: suite))"
    }
}

public enum TunnelTLS {
    /// Parameter für Listener (Mac) und Verbindung (iPad): TCP, TLS 1.2 (min = max) mit PSK, nur die genannten
    /// Verfahren. Verfahren, die das SDK nicht kennt, bleiben weg (`tls_ciphersuite_t(rawValue:)` liefert `nil`).
    /// `identity` und `suiteIDs` ändern nur Tests (falsche Kennung, nicht erlaubtes Verfahren).
    public static func parameters(
        presharedKey: [UInt8],
        identity: String = TunnelConstants.pskIdentity,
        suiteIDs: [UInt16] = TunnelSuites.allowed.map { $0.id },
        peerToPeer: Bool
    ) -> NWParameters {
        let tls = NWProtocolTLS.Options()
        let options = tls.securityProtocolOptions
        sec_protocol_options_set_min_tls_protocol_version(options, .TLSv12)
        sec_protocol_options_set_max_tls_protocol_version(options, .TLSv12)
        let psk = dispatchData(presharedKey)
        let pskIdentity = dispatchData(Array(identity.utf8))
        sec_protocol_options_add_pre_shared_key(options, psk as __DispatchData, pskIdentity as __DispatchData)
        for id in suiteIDs {
            if let known = tls_ciphersuite_t(rawValue: id) {
                sec_protocol_options_append_tls_ciphersuite(options, known)
            }
        }
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        // Abgerissene Verbindungen (iPad außer Reichweite) fallen nach etwa einer Minute auf
        tcp.enableKeepalive = true
        tcp.keepaliveIdle = 30
        tcp.keepaliveInterval = 10
        tcp.keepaliveCount = 3
        let parameters = NWParameters(tls: tls, tcp: tcp)
        parameters.includePeerToPeer = peerToPeer
        return parameters
    }

    /// Ausgehandeltes Verfahren einer Verbindung, erst nach dem Handshake (`.ready`) vorhanden
    public static func negotiated(on connection: NWConnection) -> TunnelNegotiated? {
        guard let metadata = connection.metadata(definition: NWProtocolTLS.definition) as? NWProtocolTLS.Metadata else {
            return nil
        }
        let security = metadata.securityProtocolMetadata
        let suite = sec_protocol_metadata_get_negotiated_tls_ciphersuite(security).rawValue
        let version = sec_protocol_metadata_get_negotiated_tls_protocol_version(security).rawValue
        return TunnelNegotiated(suite: suite, tlsVersion: version)
    }

    private static func dispatchData(_ bytes: [UInt8]) -> DispatchData {
        bytes.withUnsafeBytes { DispatchData(bytes: $0) }
    }
}
