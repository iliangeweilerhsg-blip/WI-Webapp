import Foundation
import SpikeShared

/// Wie der Befehl `health` den Core fragt. Als Protokoll, damit Tests ohne Core laufen.
public protocol SpikeHealthProbing: Sendable {
    func probe() async -> SpikeHealthReply
}

/// Feste URL, feste Methode. Zurück gehen nur HTTP-Status und Dauer bis zu den Antwortköpfen, nie der Body.
/// Nichts aus dem Funk fließt in die Anfrage: Der Port kommt von der Kommandozeile des Owners.
public struct CoreHealthProbe: SpikeHealthProbing {
    public let port: Int

    public init(port: Int = 4710) {
        self.port = port
    }

    public func probe() async -> SpikeHealthReply {
        let started = DispatchTime.now()
        func millis() -> UInt32 {
            UInt32(clamping: (DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000)
        }
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/v1/health") else {
            return SpikeHealthReply(httpStatus: 0, millis: 0)
        }
        var request = URLRequest(url: url, timeoutInterval: 3)
        request.httpMethod = "GET"
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 3
        configuration.timeoutIntervalForResource = 4
        configuration.connectionProxyDictionary = [:]  // nie über einen Proxy
        let session = URLSession(configuration: configuration)
        // Bricht auch den noch laufenden Body-Abruf ab: Der Body wird nie gelesen
        defer { session.invalidateAndCancel() }
        do {
            let (_, response) = try await session.bytes(for: request, delegate: SpikeNoRedirect())
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            return SpikeHealthReply(httpStatus: UInt16(clamping: status), millis: millis())
        } catch {
            return SpikeHealthReply(httpStatus: 0, millis: millis())
        }
    }
}

/// Begrenzt `health` für den ganzen Server auf eine Abfrage je `minimumInterval`, über alle Verbindungen zusammen.
/// Der Code ist offline zu raten (Plan S11). Wer ihn hat, soll den Core nicht in Dauerschleife befragen können:
/// `health` ist der einzige Befehl, der etwas außerhalb des Spikes anstößt. Der Platz in der Reihe wird vor dem
/// Warten vergeben, darum gilt der Abstand auch bei gleichzeitigen Verbindungen. Wartezeit höchstens etwa
/// `maxConnections` × `minimumInterval`.
actor SpikeHealthGate {
    private let probe: any SpikeHealthProbing
    private let intervalNanos: UInt64
    private var nextStart: UInt64 = 0

    init(probe: any SpikeHealthProbing, minimumInterval: Double) {
        self.probe = probe
        self.intervalNanos = UInt64(max(0, minimumInterval) * 1_000_000_000)
    }

    func run() async -> SpikeHealthReply {
        let now = DispatchTime.now().uptimeNanoseconds
        let start = max(now, nextStart)
        nextStart = start + intervalNanos
        if start > now {
            try? await _Concurrency.Task.sleep(nanoseconds: start - now)
        }
        return await probe.probe()
    }
}

/// Folgt keiner Weiterleitung
final class SpikeNoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
