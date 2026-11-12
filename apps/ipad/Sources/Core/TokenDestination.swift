import Darwin
import Foundation

/// IPv4-Adresse einer Schnittstelle des iPads mit ihrer Netzmaske, beide als Zahl in Schreibreihenfolge
/// (`192.168.1.5` = `0xC0A8_0105`)
struct InterfaceAddress: Equatable, Sendable {
    let address: UInt32
    let netmask: UInt32
}

/// Liefert die IPv4-Adressen der aktiven Schnittstellen. Eigenes Protokoll, damit Tests ohne echte Schnittstellen
/// laufen.
protocol InterfaceListing: Sendable {
    func activeIPv4() -> [InterfaceAddress]
}

/// Wohin darf das Geräte-Token? (UX-12, PR 0, Befund B5)
///
/// Bisher ging das Token an die gespeicherte Adresse des Macs, in jedem Netz. In einem fremden Netz (offenes WLAN,
/// falsches Gateway) könnte unter dieser Adresse ein fremder Rechner antworten und das Token mitlesen. Darum geht
/// eine Anfrage mit Token nur an eine IPv4-Adresse im Subnetz einer aktiven Schnittstelle des iPads, oder an einen
/// `.local`-Namen (mDNS antwortet nur im eigenen Netzsegment). Sonst geht nichts raus.
///
/// Grenze: Ein fremdes Netz mit demselben Adressbereich (zum Beispiel `192.168.1.0/24`) besteht die Prüfung. Das
/// schließt erst der Tunnel (PR 4).
enum TokenDestination {
    /// Reine Funktion ohne Netzzugriff.
    ///
    /// - IPv4 (vier Zahlen 0 bis 255, ohne führende Nullen): erlaubt, wenn sie im Subnetz einer der `interfaces` liegt.
    ///   Eine Schnittstelle mit Netzmaske 0 oder mit einer Maske, die nicht aus einem zusammenhängenden Block
    ///   führender Einsen besteht, zählt nicht (sie ließe sonst beliebige Adressen durch).
    /// - Namen: nur gültige `<name>.local`-Namen, wie `CoreEndpoint` sie annimmt.
    /// - IPv6 und alles andere (auch Unlesbares): abgewiesen. `CoreEndpoint` speichert ohnehin nur IPv4 und
    ///   `.local`, und eine IPv6-Adresse bräuchte eine eigene Subnetzprüfung.
    static func allows(host rawHost: String, interfaces: [InterfaceAddress]) -> Bool {
        let host = rawHost.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if host.contains(":") { return false }
        guard let address = parseIPv4(host) else {
            return host.hasSuffix(".local") && CoreEndpoint.isAllowedHost(host)
        }
        for interface in interfaces where isUsableMask(interface.netmask) {
            if (address & interface.netmask) == (interface.address & interface.netmask) {
                return true
            }
        }
        return false
    }

    /// Vier Zahlen von 0 bis 255 ohne führende Nullen (`010` könnte das System oktal lesen), sonst `nil`
    static func parseIPv4(_ host: String) -> UInt32? {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        var value: UInt32 = 0
        for part in parts {
            guard !part.isEmpty, part.count <= 3, part.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
            guard part.count == 1 || part.first != "0" else { return nil }
            guard let octet = UInt32(part), octet <= 255 else { return nil }
            value = (value << 8) | octet
        }
        return value
    }

    /// Zusammenhängende führende Einsen, mindestens eine (also /1 bis /32)
    private static func isUsableMask(_ mask: UInt32) -> Bool {
        guard mask != 0 else { return false }
        // Invertiert muss die Maske die Form 0…01…1 haben: `inverted & (inverted + 1) == 0`
        let inverted = ~mask
        return inverted & (inverted &+ 1) == 0
    }
}

/// Die echten Schnittstellen des iPads per `getifaddrs`: nur `IFF_UP` und `IFF_RUNNING`, nicht Loopback, nur IPv4
struct SystemInterfaceListing: InterfaceListing {
    init() {}

    func activeIPv4() -> [InterfaceAddress] {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return [] }
        defer { freeifaddrs(head) }

        let required = UInt32(IFF_UP) | UInt32(IFF_RUNNING)
        var result: [InterfaceAddress] = []
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let entry = cursor {
            defer { cursor = entry.pointee.ifa_next }
            let flags = UInt32(entry.pointee.ifa_flags)
            guard flags & required == required, flags & UInt32(IFF_LOOPBACK) == 0 else { continue }
            guard let address = entry.pointee.ifa_addr, let netmask = entry.pointee.ifa_netmask,
                address.pointee.sa_family == sa_family_t(AF_INET)
            else { continue }
            let addressValue = address.withMemoryRebound(to: sockaddr_in.self, capacity: 1) {
                UInt32(bigEndian: $0.pointee.sin_addr.s_addr)
            }
            let maskValue = netmask.withMemoryRebound(to: sockaddr_in.self, capacity: 1) {
                UInt32(bigEndian: $0.pointee.sin_addr.s_addr)
            }
            result.append(InterfaceAddress(address: addressValue, netmask: maskValue))
        }
        return result
    }
}
