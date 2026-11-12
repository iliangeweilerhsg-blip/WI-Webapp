import Foundation
// @preconcurrency: Ältere SDKs kennzeichnen die Network-Typen noch nicht als Sendable
@preconcurrency import Network

// Bausteine des Tunnels zum Mac (UX-12, PR 4; Plan §4 und §5.3).
// Hier steht bewusst nirgends `Task` allein: Schemas.swift verdeckt diesen Namen im App-Modul.

/// Ein Byte-Strom. Die lokale Verbindung des Weiterleiters und die beglaubigte Verbindung zum Mac sehen für den
/// Weiterleiter gleich aus. Darum lässt sich die Weiterleitung ohne Netz mit Fakes testen.
///
/// Die Aufrufe dürfen aus jeder Warteschlange kommen. Die Rückrufe auch.
protocol TunnelChannel: AnyObject, Sendable {
    /// Schickt die Bytes. `completion(true)`, sobald das System sie übernommen hat; `false` bei einem Fehler.
    func send(_ data: Data, completion: @escaping @Sendable (Bool) -> Void)
    /// Liest mindestens ein Byte, höchstens `maximum`. Der zweite Wert ist `true`, wenn der Strom endet oder ein Fehler
    /// auftrat; `data` kann dann trotzdem noch Bytes enthalten.
    func receive(maximum: Int, completion: @escaping @Sendable (Data?, Bool) -> Void)
    /// Schließt den Strom. Mehrfach rufen ist erlaubt.
    func close()
}

/// Über welche Schnittstelle eine Verbindung tatsächlich läuft
enum TunnelPathKind: Equatable, Sendable {
    /// Gemeinsames WLAN (oder Kabel): Schnittstelle `en…`
    case wifi
    /// Wi-Fi peer-to-peer: `awdl…` oder `llw…`
    case direct
    /// Der Pfad lässt es nicht erkennen
    case unknown
}

/// Warum kein beglaubigter Weg zum Mac zustande kam
enum TunnelDialFailure: Equatable, Sendable {
    /// Kein Dienst mit dem Namen gesehen (oder gesehen, aber nicht erreichbar)
    case notFound
    /// Ein Dienst mit dem Namen war da, aber der Handshake scheiterte oder das Verfahren war nicht erlaubt
    case handshakeFailed
    /// „Lokales Netzwerk“ ist für die App nicht erlaubt
    case localNetworkDenied
}

enum TunnelDialResult: Sendable {
    /// Handshake gelungen und Verfahren geprüft (TLS 1.2, 0xCCAC oder 0xC035). Erst jetzt dürfen Bytes fließen.
    case connected(any TunnelChannel, TunnelPathKind)
    case failed(TunnelDialFailure)
}

/// Baut eine beglaubigte Verbindung zum Mac auf: Dienst suchen, Handshake, Verfahren prüfen. Die echte Fassung ist
/// `NetworkTunnelDialer`, Tests nehmen Fakes.
protocol TunnelDialing: Sendable {
    /// - Parameters:
    ///   - peerToPeer: `false` = nur das gemeinsame WLAN (Stufe 1), `true` = auch Wi-Fi peer-to-peer (Stufe 2)
    ///   - timeout: Sekunden für Suche und Handshake zusammen
    func dial(key: TunnelKey, peerToPeer: Bool, timeout: TimeInterval) async -> TunnelDialResult
}

/// Eine `NWConnection` als `TunnelChannel`. Die Verbindung ist schon gestartet (der Aufrufer hat die Warteschlange
/// gewählt).
final class NetworkStream: TunnelChannel, @unchecked Sendable {
    private let connection: NWConnection

    init(connection: NWConnection) {
        self.connection = connection
    }

    func send(_ data: Data, completion: @escaping @Sendable (Bool) -> Void) {
        connection.send(
            content: data,
            completion: .contentProcessed { error in
                completion(error == nil)
            })
    }

    func receive(maximum: Int, completion: @escaping @Sendable (Data?, Bool) -> Void) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: maximum) { data, _, isComplete, error in
            completion(data, isComplete || error != nil)
        }
    }

    func close() {
        connection.stateUpdateHandler = nil
        connection.cancel()
    }
}
