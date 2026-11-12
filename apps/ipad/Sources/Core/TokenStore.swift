import Foundation
import Security

/// Ablage des Geräte-Tokens. Das Token ist ein Geheimnis: Es liegt nur im Schlüsselbund,
/// nie in UserDefaults, Logs oder Fehlermeldungen (VERTRAEGE §12).
protocol TokenStore {
    func loadToken() throws -> String?
    func saveToken(_ token: String) throws
    func deleteToken() throws
}

struct KeychainError: Error, Equatable {
    let status: OSStatus
}

/// Ein Eintrag im Schlüsselbund von iPadOS. Er bleibt auf diesem Gerät (kein iCloud, kein Backup auf ein anderes Gerät)
/// und ist nach dem ersten Entsperren lesbar, damit der Sync später auch im Hintergrund läuft
/// (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, UX-12 Plan B20).
struct KeychainItem {
    /// Wann der Eintrag lesbar ist: nach dem ersten Entsperren, nur auf diesem Gerät (nicht in Backups, nicht im
    /// iCloud-Schlüsselbund). Gilt für Token und Tunnel-Schlüssel.
    static var accessibility: CFString { kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly }

    let service: String
    let account: String

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func load() throws -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
        guard let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func save(_ value: String) throws {
        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: KeychainItem.accessibility,
        ]
        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else { throw KeychainError(status: updateStatus) }

        var newItem = baseQuery
        for (attributeKey, attributeValue) in attributes {
            newItem[attributeKey] = attributeValue
        }
        let addStatus = SecItemAdd(newItem as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw KeychainError(status: addStatus) }
    }

    func delete() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }
}

/// Schlüsselbund von iPadOS für das Geräte-Token
struct KeychainTokenStore: TokenStore {
    let service: String
    let account: String

    init(service: String = "de.studiengehirn.ipad", account: String = "device-token") {
        self.service = service
        self.account = account
    }

    private var item: KeychainItem { KeychainItem(service: service, account: account) }

    func loadToken() throws -> String? { try item.load() }
    func saveToken(_ token: String) throws { try item.save(token) }
    func deleteToken() throws { try item.delete() }
}

/// Ablage des Tunnel-Schlüssels (`tunnel_key` aus `PairResponse`, UX-12). Ein Geheimnis wie das Token: nur im
/// Schlüsselbund, nie in UserDefaults, Dateien, Logs oder Fehlermeldungen. Der Text ist der base64url-Schlüssel
/// (43 Zeichen); abgeleitet wird erst im Speicher (`TunnelKey`).
protocol TunnelKeyStore {
    func loadKey() throws -> String?
    func saveKey(_ key: String) throws
    func deleteKey() throws
}

/// Schlüsselbund von iPadOS für den Tunnel-Schlüssel, mit denselben Zugriffsregeln wie das Token
struct KeychainTunnelKeyStore: TunnelKeyStore {
    let service: String
    let account: String

    init(service: String = "de.studiengehirn.ipad", account: String = "tunnel-key") {
        self.service = service
        self.account = account
    }

    private var item: KeychainItem { KeychainItem(service: service, account: account) }

    func loadKey() throws -> String? { try item.load() }
    func saveKey(_ key: String) throws { try item.save(key) }
    func deleteKey() throws { try item.delete() }
}

/// Speichert nichts. Vorgabe für Aufrufer ohne Tunnel (Tests); die echte App übergibt `KeychainTunnelKeyStore`.
struct NoTunnelKeyStore: TunnelKeyStore {
    func loadKey() throws -> String? { nil }
    func saveKey(_ key: String) throws {}
    func deleteKey() throws {}
}
