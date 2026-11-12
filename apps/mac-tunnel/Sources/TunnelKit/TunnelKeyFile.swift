import Foundation
import TunnelShared

// Die Schlüsseldatei des Core (UX-12, Plan E8, §5.1; docs/VERTRAEGE.md §7.5).
// Der Helfer liest sie nur, nie schreibt er sie. Gelesen wird mit O_NOFOLLOW; Besitzer und Rechte werden geprüft:
// Datei 0600, Ordner `secrets/` 0700, beide gehören dem eigenen Benutzer. Alles andere ist ein sicherer Ausfall:
// kein Schlüssel gilt als gelesen. Meldungen nennen nie den Inhalt der Datei.

/// Ein Gerät mit abgeleiteten Werten. Der Schlüssel selbst bleibt nicht im Speicher.
public struct TunnelDevice: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let deviceID: String
    public let serviceName: String
    public let presharedKey: [UInt8]

    public init(deviceID: String, serviceName: String, presharedKey: [UInt8]) {
        self.deviceID = deviceID
        self.serviceName = serviceName
        self.presharedKey = presharedKey
    }

    public var description: String { "TunnelDevice(\(serviceName))" }
    public var debugDescription: String { description }
}

public enum TunnelKeyFileResult: Equatable, Sendable {
    case devices([TunnelDevice])
    /// Datei oder Ordner fehlt
    case missing
    /// Nicht lesbar, zu groß oder falsches Format
    case broken(String)
    /// Besitzer, Rechte oder Dateityp stimmen nicht (auch Symlink)
    case insecure(String)

    /// Kurzform für die Zustandsdatei
    public var label: String {
        switch self {
        case .devices: return "ok"
        case .missing: return "fehlt"
        case .broken: return "kaputt"
        case .insecure: return "unsicher"
        }
    }

    public var problem: String? {
        switch self {
        case .devices, .missing: return nil
        case .broken(let text), .insecure(let text): return text
        }
    }
}

/// Wer, was, wann: ändert sich dieser Wert nicht, hat sich die Datei nicht geändert (Plan §5.2, Punkt 2).
/// `ctime` lässt sich nicht zurücksetzen und fängt auch Änderungen mit gleicher Größe und Zeit.
public struct TunnelFileSignature: Equatable, Sendable {
    let device: Int64
    let inode: UInt64
    let size: Int64
    let mtimeSeconds: Int64
    let mtimeNanos: Int64
    let ctimeSeconds: Int64
    let ctimeNanos: Int64
    let mode: UInt32
    let uid: UInt32

    init(_ info: stat) {
        device = Int64(info.st_dev)
        inode = UInt64(info.st_ino)
        size = Int64(info.st_size)
        mtimeSeconds = Int64(info.st_mtimespec.tv_sec)
        mtimeNanos = Int64(info.st_mtimespec.tv_nsec)
        ctimeSeconds = Int64(info.st_ctimespec.tv_sec)
        ctimeNanos = Int64(info.st_ctimespec.tv_nsec)
        mode = UInt32(info.st_mode)
        uid = UInt32(info.st_uid)
    }
}

public struct TunnelKeySignature: Equatable, Sendable {
    public let directory: TunnelFileSignature?
    public let file: TunnelFileSignature?
}

enum TunnelFileType {
    static let mask: UInt32 = 0o170000
    static let directory: UInt32 = 0o040000
    static let regular: UInt32 = 0o100000
    static let socket: UInt32 = 0o140000
}

public enum TunnelKeyFile {
    /// Signatur von Ordner und Datei (`lstat`, folgt keinem Symlink)
    public static func signature(path: String) -> TunnelKeySignature {
        let directory = (path as NSString).deletingLastPathComponent
        return TunnelKeySignature(directory: lstatSignature(directory), file: lstatSignature(path))
    }

    private static func lstatSignature(_ path: String) -> TunnelFileSignature? {
        var info = stat()
        guard lstat(path, &info) == 0 else { return nil }
        return TunnelFileSignature(info)
    }

    /// Liest und prüft die Schlüsseldatei. Jeder Fehler ergibt „keine Schlüssel“, nie einen Teil davon.
    public static func load(path: String, expectedUID: uid_t) -> TunnelKeyFileResult {
        // Ordner `secrets/`: echter Ordner (kein Symlink), uns gehörend, 0700
        let directory = (path as NSString).deletingLastPathComponent
        var directoryInfo = stat()
        if lstat(directory, &directoryInfo) != 0 {
            let code = errno
            if code == ENOENT || code == ENOTDIR { return .missing }
            return .broken("Der Ordner der Schlüsseldatei lässt sich nicht lesen (Fehler \(code)).")
        }
        if UInt32(directoryInfo.st_mode) & TunnelFileType.mask != TunnelFileType.directory {
            return .insecure("secrets/ ist kein echter Ordner (Symlink?).")
        }
        if directoryInfo.st_uid != expectedUID {
            return .insecure("secrets/ gehört einem anderen Benutzer.")
        }
        if UInt32(directoryInfo.st_mode) & 0o077 != 0 {
            return .insecure("secrets/ hat zu offene Rechte (erwartet 0700).")
        }

        // Datei: nie einem Symlink folgen (O_NOFOLLOW), ein FIFO o. Ä. blockiert nicht (O_NONBLOCK)
        let descriptor = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        if descriptor < 0 {
            let code = errno
            if code == ENOENT { return .missing }
            if code == ELOOP { return .insecure("Die Schlüsseldatei ist ein Symlink.") }
            return .broken("Die Schlüsseldatei lässt sich nicht öffnen (Fehler \(code)).")
        }
        defer { close(descriptor) }

        var info = stat()
        guard fstat(descriptor, &info) == 0 else {
            return .broken("Die Schlüsseldatei lässt sich nicht prüfen (Fehler \(errno)).")
        }
        if UInt32(info.st_mode) & TunnelFileType.mask != TunnelFileType.regular {
            return .insecure("Die Schlüsseldatei ist keine reguläre Datei.")
        }
        if info.st_uid != expectedUID {
            return .insecure("Die Schlüsseldatei gehört einem anderen Benutzer.")
        }
        if UInt32(info.st_mode) & 0o777 != 0o600 {
            return .insecure("Die Schlüsseldatei hat andere Rechte als 0600.")
        }
        if Int64(info.st_size) > Int64(TunnelLimits.maxKeyFileBytes) {
            return .broken("Die Schlüsseldatei ist zu groß.")
        }

        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 16 * 1024)
        while true {
            let count = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
            if count < 0 {
                if errno == EINTR { continue }
                return .broken("Die Schlüsseldatei lässt sich nicht lesen (Fehler \(errno)).")
            }
            if count == 0 { break }
            data.append(contentsOf: buffer[0..<count])
            if data.count > TunnelLimits.maxKeyFileBytes { return .broken("Die Schlüsseldatei ist zu groß.") }
        }
        return parse(data)
    }

    private struct Model: Decodable {
        struct Entry: Decodable {
            let device_id: String
            let tunnel_key: String
        }
        let v: Int
        let devices: [Entry]
    }

    /// Format: `{ "v": 1, "devices": [{ "device_id": "<uuid>", "tunnel_key": "<base64url>" }] }`
    static func parse(_ data: Data) -> TunnelKeyFileResult {
        guard let model = try? JSONDecoder().decode(Model.self, from: data) else {
            return .broken("Die Schlüsseldatei hat ein falsches Format.")
        }
        guard model.v == 1 else { return .broken("Die Schlüsseldatei hat eine unbekannte Version.") }
        guard model.devices.count <= TunnelLimits.maxDevices else {
            return .broken("Die Schlüsseldatei enthält zu viele Geräte.")
        }
        var devices: [TunnelDevice] = []
        var ids = Set<String>()
        var names = Set<String>()
        for entry in model.devices {
            guard isDeviceID(entry.device_id), let key = try? TunnelKey(base64url: entry.tunnel_key) else {
                return .broken("Die Schlüsseldatei enthält einen ungültigen Eintrag.")
            }
            let name = key.serviceName
            guard ids.insert(entry.device_id).inserted, names.insert(name).inserted else {
                return .broken("Die Schlüsseldatei enthält einen doppelten Eintrag.")
            }
            devices.append(TunnelDevice(deviceID: entry.device_id, serviceName: name, presharedKey: key.presharedKey))
        }
        return .devices(devices)
    }

    /// UUID in Kleinbuchstaben (wie `uuidv7()` des Core sie erzeugt)
    static func isDeviceID(_ text: String) -> Bool {
        let characters = Array(text.utf8)
        guard characters.count == 36 else { return false }
        for (index, character) in characters.enumerated() {
            if index == 8 || index == 13 || index == 18 || index == 23 {
                if character != 45 { return false }
            } else if !((48...57).contains(character) || (97...102).contains(character)) {
                return false
            }
        }
        return true
    }
}
