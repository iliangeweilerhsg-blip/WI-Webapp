import Foundation

/// Liegt eine Adresse im eigenen Netz oder draußen?
///
/// Die Kopplung fragt vor dem Einlösen nach und warnt bei Adressen außerhalb des Heimnetzes
/// (Review M-1): Ein untergeschobener QR-Code soll das iPad nicht unbemerkt an einen fremden
/// Server binden. Gesperrt werden solche Adressen nicht, denn manche Uni-WLANs vergeben
/// öffentliche IP-Adressen.
enum AddressScope: Equatable, Sendable {
    /// Heimnetz: private oder nur lokal gültige Adresse, oder ein Bonjour-Name
    case privateNetwork
    /// Alles andere, auch Unlesbares: im Zweifel warnen
    case publicNetwork

    /// Reine Funktion ohne Netzzugriff. `host` ist eine IPv4- oder IPv6-Adresse oder ein Name.
    ///
    /// Als privat gelten:
    /// - IPv4: 10/8, 172.16/12, 192.168/16 (RFC 1918), 169.254/16 (Link-Local),
    ///   100.64/10 (RFC 6598, geteilter Bereich hinter dem Router) und 127/8 (das Gerät selbst)
    /// - IPv6: fc00::/7 (ULA), fe80::/10 (Link-Local), ::1 und IPv4 in IPv6 (`::ffff:a.b.c.d`)
    /// - Namen, die auf `.local` enden (Bonjour)
    static func classify(host rawHost: String) -> AddressScope {
        var host = rawHost.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if host.hasPrefix("["), host.hasSuffix("]") {
            host = String(host.dropFirst().dropLast())
        }
        // Zonen-Kennung von Link-Local-Adressen: fe80::1%en0
        if let percent = host.firstIndex(of: "%") {
            host = String(host[..<percent])
        }
        if host.hasSuffix("."), host.count > 1 {
            host = String(host.dropLast())
        }
        if host.contains(":") {
            return isPrivateIPv6(host) ? .privateNetwork : .publicNetwork
        }
        if let octets = ipv4Octets(host) {
            return isPrivateIPv4(octets) ? .privateNetwork : .publicNetwork
        }
        return isLocalName(host) ? .privateNetwork : .publicNetwork
    }

    /// Vier Zahlen von 0 bis 255, sonst `nil`
    private static func ipv4Octets(_ host: String) -> [Int]? {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        var octets: [Int] = []
        for part in parts {
            guard !part.isEmpty, part.count <= 3, part.allSatisfy({ $0.isASCII && $0.isNumber }) else {
                return nil
            }
            guard let value = Int(part), value <= 255 else { return nil }
            octets.append(value)
        }
        return octets
    }

    private static func isPrivateIPv4(_ octets: [Int]) -> Bool {
        let first = octets[0]
        let second = octets[1]
        switch first {
        case 10, 127:
            return true
        case 172:
            return (16...31).contains(second)
        case 192:
            return second == 168
        case 169:
            return second == 254
        case 100:
            return (64...127).contains(second)
        default:
            return false
        }
    }

    private static func isPrivateIPv6(_ host: String) -> Bool {
        if host == "::1" { return true }
        // IPv4 in IPv6: Es zählt die enthaltene IPv4-Adresse
        let mappedPrefix = "::ffff:"
        if host.hasPrefix(mappedPrefix) {
            guard let octets = ipv4Octets(String(host.dropFirst(mappedPrefix.count))) else { return false }
            return isPrivateIPv4(octets)
        }
        let groups = host.split(separator: ":", omittingEmptySubsequences: false)
        guard groups.count >= 3, groups.count <= 8 else { return false }
        for group in groups {
            guard group.count <= 4, group.allSatisfy({ $0.isASCII && $0.isHexDigit }) else { return false }
        }
        // Beginnt die Adresse mit „::“, ist der erste Block 0 und damit nicht privat
        guard let firstGroup = groups.first, !firstGroup.isEmpty, let value = Int(firstGroup, radix: 16) else {
            return false
        }
        // fc00::/7 (ULA) und fe80::/10 (Link-Local)
        return (value & 0xfe00) == 0xfc00 || (value & 0xffc0) == 0xfe80
    }

    private static func isLocalName(_ host: String) -> Bool {
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, labels.last == "local" else { return false }
        for label in labels {
            guard !label.isEmpty, label.count <= 63 else { return false }
            guard label.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }) else {
                return false
            }
        }
        return true
    }
}

extension CoreEndpoint {
    /// Heimnetz oder nicht (für die Warnung vor dem Koppeln)
    var scope: AddressScope { AddressScope.classify(host: host) }
}
