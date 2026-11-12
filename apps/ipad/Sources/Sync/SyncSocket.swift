import Foundation

/// Fehler einer WebSocket-Verbindung, so wie die Engine sie braucht
enum SyncSocketError: Error, Equatable, Sendable {
    /// Der Server hat mit diesem Code geschlossen (z. B. 4401, 4503)
    case closed(code: Int)
    /// Das Upgrade wurde als HTTP-Antwort abgelehnt (z. B. 401, 421)
    case rejected(status: Int)
    /// Netzfehler ohne Schließcode und ohne HTTP-Antwort
    case transport(URLError)
}

/// Eine Verbindung zu `ws://<mac>:4710/sync`. Eine Nachricht ist ein Text-Frame mit einem JSON-Objekt.
/// Dünne Schicht über `URLSessionWebSocketTask`, damit die Engine ohne Netz getestet werden kann.
@MainActor
protocol SyncSocket: AnyObject {
    func send(_ text: String) async throws
    /// Wartet auf die nächste Nachricht. Wirft `SyncSocketError`, wenn die Verbindung endet.
    func receive() async throws -> String
    /// Schließt die Verbindung. Ein wartendes `receive()` wirft danach.
    func close()
}

@MainActor
protocol SyncSocketFactory {
    /// Öffnet die Verbindung (das Upgrade läuft im Hintergrund). Fehler zeigen sich bei `send`/`receive`.
    func open(_ request: URLRequest) -> any SyncSocket
}

/// Echte Verbindung über URLSession
@MainActor
final class URLSessionSyncSocket: SyncSocket {
    /// Der Server liest höchstens 1 MiB je Nachricht (VERTRAEGE §11). Kleiner Zuschlag für Server-Nachrichten.
    private static let maximumMessageSize = 1_048_576 + 4096

    private let task: URLSessionWebSocketTask

    init(session: URLSession, request: URLRequest) {
        task = session.webSocketTask(with: request)
        task.maximumMessageSize = URLSessionSyncSocket.maximumMessageSize
        task.resume()
    }

    func send(_ text: String) async throws {
        do {
            try await task.send(.string(text))
        } catch {
            throw mapped(error)
        }
    }

    func receive() async throws -> String {
        do {
            switch try await task.receive() {
            case .string(let text):
                return text
            case .data(let data):
                // Der Core sendet nur Text-Frames. Binär wird als Text gelesen, damit nichts hängen bleibt.
                return String(decoding: data, as: UTF8.self)
            @unknown default:
                return ""
            }
        } catch {
            throw mapped(error)
        }
    }

    func close() {
        task.cancel(with: .goingAway, reason: nil)
    }

    /// Schließcode und HTTP-Antwort stehen erst nach dem Fehler am Task
    private func mapped(_ error: Error) -> SyncSocketError {
        if let http = task.response as? HTTPURLResponse, http.statusCode >= 300 {
            return .rejected(status: http.statusCode)
        }
        let code = task.closeCode
        if code != .invalid {
            return .closed(code: code.rawValue)
        }
        if let urlError = error as? URLError {
            return .transport(urlError)
        }
        return .transport(URLError(.unknown))
    }
}

@MainActor
final class URLSessionSyncSocketFactory: SyncSocketFactory {
    private let session: URLSession

    init() {
        // Ohne Cache und Cookies auf der Platte. Kein Warten auf Netz: Die Engine entscheidet über Wiederholungen.
        // Das Zeitlimit zählt auch für eine ruhige Verbindung; `ping` alle 15 s hält sie darunter.
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = 60
        // Keine Weiterleitung beim Upgrade (Review L16), auch wenn URLSession dort selten eine verfolgt
        session = URLSession(configuration: configuration, delegate: NoRedirectDelegate(), delegateQueue: nil)
    }

    func open(_ request: URLRequest) -> any SyncSocket {
        URLSessionSyncSocket(session: session, request: request)
    }
}
