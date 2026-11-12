import Foundation

// Der Tunnel-Eingang des Core: ein Unix-Socket im Datenordner (`run/tunnel.sock`, Rechte 0600, Ordner 0700).
// Der Helfer reicht nur dorthin weiter, nie an den Haupteingang (Plan E2). Er liest nie das Token.

/// Baut eine `sockaddr_un`. `nil`, wenn der Pfad leer oder zu lang ist.
func makeUnixAddress(_ path: String) -> sockaddr_un? {
    let bytes = Array(path.utf8)
    var address = sockaddr_un()
    let capacity = MemoryLayout.size(ofValue: address.sun_path)
    guard !bytes.isEmpty, bytes.count < capacity, !bytes.contains(0) else { return nil }
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    address.sun_family = sa_family_t(AF_UNIX)
    withUnsafeMutableBytes(of: &address.sun_path) { raw in
        for (index, byte) in bytes.enumerated() { raw[index] = byte }
        raw[bytes.count] = 0
    }
    return address
}

public enum TunnelSocketCheck: Equatable, Sendable {
    /// Es liegt nichts am Pfad (der Core läuft nicht oder ohne Tunnel-Eingang)
    case absent
    case ok
    /// Dort liegt etwas anderes als ein eigener Socket
    case bad(String)
}

public enum TunnelSocket {
    /// Der Pfad muss ein Socket sein, der dem erwarteten Benutzer gehört (`lstat`, folgt keinem Symlink)
    public static func check(path: String, expectedUID: uid_t) -> TunnelSocketCheck {
        var info = stat()
        if lstat(path, &info) != 0 {
            let code = errno
            if code == ENOENT || code == ENOTDIR { return .absent }
            return .bad("Der Tunnel-Eingang des Core lässt sich nicht prüfen (Fehler \(code)).")
        }
        if UInt32(info.st_mode) & TunnelFileType.mask != TunnelFileType.socket {
            return .bad("Am Pfad des Tunnel-Eingangs liegt kein Socket.")
        }
        if info.st_uid != expectedUID {
            return .bad("Der Tunnel-Eingang des Core gehört einem anderen Benutzer.")
        }
        return .ok
    }
}

public enum TunnelCoreProbeResult: Equatable, Sendable {
    case reachable
    case unreachable(String)
}

/// Antwortet der Tunnel-Eingang des Core? (Plan §5.2, Punkt 5: Probe alle 10 s)
public protocol TunnelCoreProbing: Sendable {
    func probe() -> TunnelCoreProbeResult
}

/// Echte Probe: ein kurzer, nicht blockierender `connect` auf den Unix-Socket
public struct UnixSocketProbe: TunnelCoreProbing {
    public let path: String
    public let expectedUID: uid_t

    public init(path: String, expectedUID: uid_t) {
        self.path = path
        self.expectedUID = expectedUID
    }

    public func probe() -> TunnelCoreProbeResult {
        switch TunnelSocket.check(path: path, expectedUID: expectedUID) {
        case .absent: return .unreachable("Der Tunnel-Eingang des Core fehlt (läuft der Core?).")
        case .bad(let text): return .unreachable(text)
        case .ok: break
        }
        guard var address = makeUnixAddress(path) else {
            return .unreachable("Der Pfad des Tunnel-Eingangs ist ungültig oder zu lang.")
        }
        let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return .unreachable("Kein Socket verfügbar (Fehler \(errno)).") }
        defer { close(descriptor) }
        let flags = fcntl(descriptor, F_GETFL)
        _ = fcntl(descriptor, F_SETFL, flags | O_NONBLOCK)
        let result = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { generic in
                Darwin.connect(descriptor, generic, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        if result == 0 { return .reachable }
        let code = errno
        // EINPROGRESS / EAGAIN: voller Warteschlange des Core, aber vorhanden
        if code == EINPROGRESS || code == EAGAIN { return .reachable }
        if code == ECONNREFUSED || code == ENOENT {
            return .unreachable("Der Core nimmt am Tunnel-Eingang keine Verbindung an.")
        }
        return .unreachable("Der Tunnel-Eingang des Core antwortet nicht (Fehler \(code)).")
    }
}
