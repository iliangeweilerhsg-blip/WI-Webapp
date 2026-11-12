import Foundation

// Zustandsdatei des Helfers für `sg doctor` (Plan §5.2, Punkt 8). Alle 5 s und bei jeder Änderung (höchstens einmal je
// Sekunde, gegen Fluten aus dem Funk), atomar geschrieben.
// Enthält weder Schlüssel noch Adressen noch Nutzdaten. Der Dienstname ist öffentlich (steht im Funk).

public struct TunnelListenerState: Codable, Equatable, Sendable {
    public var service_name: String
    /// Name, unter dem Bonjour den Dienst wirklich angekündigt hat. Weicht er ab, hat jemand den Namen belegt.
    public var advertised_name: String?
    /// `starting`, `ready`, `waiting`, `failed`
    public var state: String
    public var connections: Int
    public var handshakes_pending: Int
    public var handshakes_failed: Int

    public init(
        service_name: String, advertised_name: String?, state: String, connections: Int, handshakes_pending: Int,
        handshakes_failed: Int
    ) {
        self.service_name = service_name
        self.advertised_name = advertised_name
        self.state = state
        self.connections = connections
        self.handshakes_pending = handshakes_pending
        self.handshakes_failed = handshakes_failed
    }
}

public struct TunnelState: Codable, Equatable, Sendable {
    public var pid: Int32
    public var version: String
    /// ISO 8601, UTC
    public var updated_at: String
    /// `ok` oder `nicht erreichbar` (Tunnel-Eingang des Core)
    public var core: String
    public var p2p: Bool
    /// Schlüsseldatei: `ok`, `fehlt`, `kaputt`, `unsicher`
    public var keys: String
    public var listeners: [TunnelListenerState]
    public var last_error: String?

    public init(
        pid: Int32, version: String, updated_at: String, core: String, p2p: Bool, keys: String,
        listeners: [TunnelListenerState], last_error: String?
    ) {
        self.pid = pid
        self.version = version
        self.updated_at = updated_at
        self.core = core
        self.p2p = p2p
        self.keys = keys
        self.listeners = listeners
        self.last_error = last_error
    }

    /// Gleicher Inhalt ohne Zeitstempel: Nur bei einem Unterschied wird außerhalb des 5-s-Takts geschrieben.
    func sameContent(as other: TunnelState) -> Bool {
        var left = self
        left.updated_at = other.updated_at
        return left == other
    }
}

public enum TunnelStateFile {
    public static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: date)
    }

    public static func encode(_ state: TunnelState) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        var data = try encoder.encode(state)
        data.append(0x0A)
        return data
    }

    /// Atomar: Temp-Datei (0600, O_EXCL, kein Symlink) im selben Ordner, `fsync`, `rename`.
    /// Gibt im Fehlerfall die Temp-Datei frei und wirft.
    public static func write(_ state: TunnelState, to path: String) throws {
        let data = try encode(state)
        let directory = (path as NSString).deletingLastPathComponent
        var directoryInfo = stat()
        if lstat(directory, &directoryInfo) != 0, errno == ENOENT {
            _ = mkdir(directory, 0o700)
        }
        let temporary = path + ".\(getpid()).\(UInt32.random(in: 0...UInt32.max)).tmp"
        let descriptor = open(temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw TunnelStateError.io("Zustandsdatei lässt sich nicht anlegen (Fehler \(errno)).") }
        var finished = false
        defer {
            close(descriptor)
            if !finished { unlink(temporary) }
        }
        var offset = 0
        while offset < data.count {
            let written = data.withUnsafeBytes { raw -> Int in
                guard let base = raw.baseAddress else { return -1 }
                return Darwin.write(descriptor, base + offset, data.count - offset)
            }
            if written < 0 {
                if errno == EINTR { continue }
                throw TunnelStateError.io("Zustandsdatei lässt sich nicht schreiben (Fehler \(errno)).")
            }
            offset += written
        }
        _ = fsync(descriptor)
        guard rename(temporary, path) == 0 else {
            throw TunnelStateError.io("Zustandsdatei lässt sich nicht ersetzen (Fehler \(errno)).")
        }
        finished = true
    }

    public static func remove(at path: String) {
        unlink(path)
    }
}

public enum TunnelStateError: Error, CustomStringConvertible {
    case io(String)
    public var description: String {
        switch self {
        case .io(let text): return text
        }
    }
}
