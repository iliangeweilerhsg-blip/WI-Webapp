import Foundation

/// Der gekoppelte Mac, ohne Geheimnis. Das Token liegt getrennt im `TokenStore`.
struct PairedMac: Equatable, Sendable {
    let endpoint: CoreEndpoint
    /// ID dieses iPads beim Core (`Device.id`), nötig zum Abmelden
    let deviceID: String
    /// Name, unter dem der Mac dieses iPad führt
    let deviceName: String
}

protocol PairedMacStore {
    func loadPairedMac() -> PairedMac?
    func savePairedMac(_ mac: PairedMac)
    func clearPairedMac()
}

/// Ablage in UserDefaults. Hier steht nur, was kein Geheimnis ist.
struct DefaultsPairedMacStore: PairedMacStore {
    private static let hostKey = "pairedMac.host"
    private static let portKey = "pairedMac.port"
    private static let deviceIDKey = "pairedMac.deviceID"
    private static let deviceNameKey = "pairedMac.deviceName"

    func loadPairedMac() -> PairedMac? {
        let defaults = UserDefaults.standard
        guard
            let host = defaults.string(forKey: Self.hostKey),
            let endpoint = CoreEndpoint(host: host, port: defaults.integer(forKey: Self.portKey)),
            let deviceID = defaults.string(forKey: Self.deviceIDKey)
        else { return nil }
        let deviceName = defaults.string(forKey: Self.deviceNameKey) ?? "iPad"
        return PairedMac(endpoint: endpoint, deviceID: deviceID, deviceName: deviceName)
    }

    func savePairedMac(_ mac: PairedMac) {
        let defaults = UserDefaults.standard
        defaults.set(mac.endpoint.host, forKey: Self.hostKey)
        defaults.set(mac.endpoint.port, forKey: Self.portKey)
        defaults.set(mac.deviceID, forKey: Self.deviceIDKey)
        defaults.set(mac.deviceName, forKey: Self.deviceNameKey)
    }

    func clearPairedMac() {
        let defaults = UserDefaults.standard
        for key in [Self.hostKey, Self.portKey, Self.deviceIDKey, Self.deviceNameKey] {
            defaults.removeObject(forKey: key)
        }
    }
}
