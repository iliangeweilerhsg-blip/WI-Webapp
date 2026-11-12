import Foundation

/// Grenzen des Helfers (Plan §5.2, Punkt 6). Gegen Fluten aus dem Funk und gegen wachsenden Speicher.
public enum TunnelLimits {
    /// Ein Handshake darf höchstens so lange dauern
    public static let handshakeSeconds: Double = 5
    /// Gleichzeitig offene Handshakes je Listener. Die neunte verdrängt die älteste (wie #185).
    public static let maxPendingHandshakes = 8
    /// Verbindungen nach dem Handshake je Gerät
    public static let maxConnectionsPerDevice = 32
    /// Puffer je Richtung. Der nächste Block wird erst gelesen, wenn der vorige geschrieben ist (Gegendruck).
    public static let bufferBytes = 64 * 1024
    /// Abstand der Prüfung der Schlüsseldatei
    public static let keyFilePollSeconds: Double = 2
    /// Abstand der Probe, ob der Tunnel-Eingang des Core antwortet
    public static let coreProbeSeconds: Double = 10
    /// Höchstens so lange liegt die Zustandsdatei hinter der Wirklichkeit zurück
    public static let stateWriteSeconds: Double = 5
    /// Gescheiterte Handshakes erscheinen höchstens einmal in dieser Zeit im Log (zusammengefasst)
    public static let failedLogSeconds: Double = 60
    /// Ein Listener, der ausgefallen ist, wird frühestens nach dieser Zeit neu gestartet
    public static let listenerRestartSeconds: Double = 5
    /// Wartezeit auf die Verbindung zum Unix-Socket des Core
    public static let upstreamConnectSeconds: Double = 5
    /// Größer darf die Schlüsseldatei nicht sein (sonst gilt sie als kaputt)
    public static let maxKeyFileBytes = 256 * 1024
    /// Mehr Geräte nimmt der Helfer nicht (sonst gilt die Datei als kaputt)
    public static let maxDevices = 64
    /// Längster Unix-Socket-Pfad: `sun_path` fasst 104 Byte samt Endmarke (macOS)
    public static let maxSocketPathBytes = 103
}

public enum TunnelInfo {
    public static let version = "0.1.0"
}

/// Startwerte des Helfers (Kommandozeile von `sg-tunnel`)
public struct TunnelOptions: Sendable {
    /// `<SG_DATA_DIR>/secrets/tunnel-keys.json`
    public var keysPath: String
    /// `<SG_DATA_DIR>/run/tunnel.sock`
    public var socketPath: String
    /// Zustandsdatei für `sg doctor`
    public var statePath: String
    public var peerToPeer: Bool
    /// Bonjour-Dienste ankündigen (in Tests aus: dann braucht es weder Funk noch Bonjour)
    public var advertise: Bool
    /// Benutzer, dem Schlüsseldatei und Socket gehören müssen. Standard: der eigene
    public var expectedUID: uid_t
    /// Wiederkehrende Prüfung alle 2 s selbst anstoßen. Tests schalten das ab und rufen `tick()` selbst.
    public var autoTick: Bool

    public init(
        keysPath: String, socketPath: String, statePath: String, peerToPeer: Bool = true, advertise: Bool = true,
        expectedUID: uid_t = geteuid(), autoTick: Bool = true
    ) {
        self.keysPath = keysPath
        self.socketPath = socketPath
        self.statePath = statePath
        self.peerToPeer = peerToPeer
        self.advertise = advertise
        self.expectedUID = expectedUID
        self.autoTick = autoTick
    }
}

/// Der Helfer startet nicht (Meldung ohne Schlüssel und Nutzdaten). `sg-tunnel` beendet sich dann mit Code 78.
public struct TunnelStartError: Error, Equatable, Sendable, CustomStringConvertible {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var description: String { message }
}
