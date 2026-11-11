import Foundation

/// Dünne Schicht über URLSession, damit Tests ohne Netz laufen
@MainActor
protocol HTTPTransport {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

@MainActor
final class URLSessionTransport: HTTPTransport {
    private let session: URLSession

    init() {
        // Ohne Cache und Cookies auf der Platte: Antworten mit Token landen nirgends
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = 10
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: configuration)
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        return (data, http)
    }
}

/// Ergebnis einer erfolgreichen Kopplung
struct PairingResult: Equatable, Sendable {
    let deviceToken: String
    let deviceID: String
    let deviceName: String
}

/// REST-Zugriff auf den Core. Netz- und Serverfehler kommen als `ConnectionError`.
///
/// Wiederholung (VERTRAEGE §5, Hinweis H-1): Der Core schließt Keep-Alive-Verbindungen nach
/// 10 s Leerlauf. Trifft eine Anfrage genau auf dieses Schließen, meldet URLSession
/// `networkConnectionLost`. URLSession wiederholt das nicht für jede Methode selbst, darum
/// wiederholt der Client hier. Der Server hat die Anfrage in diesem Fall nicht gelesen.
@MainActor
final class CoreClient {
    private let transport: any HTTPTransport
    private let maxRetries: Int
    private let retryDelay: Duration

    init(transport: any HTTPTransport, maxRetries: Int = 2, retryDelay: Duration = .milliseconds(200)) {
        self.transport = transport
        self.maxRetries = maxRetries
        self.retryDelay = retryDelay
    }

    /// `POST /devices/pair/start`: meldet das iPad an und liefert die öffentliche `pairing_id`
    func pairStart(endpoint: CoreEndpoint, deviceName: String, nonce: String) async throws -> String {
        let body = try encode(PairStartRequest(deviceName: deviceName, kind: .ipad, publicNonce: nonce))
        let data = try await send("POST", "/devices/pair/start", endpoint: endpoint, token: nil, body: body)
        guard let response = try? newJSONDecoder().decode(PairStartResponse.self, from: data) else {
            throw ConnectionError.invalidResponse
        }
        return response.pairingID
    }

    /// `POST /devices/pair/confirm`: löst den Code ein und liefert das Geräte-Token
    func pairConfirm(
        endpoint: CoreEndpoint,
        pairingID: String,
        code: String,
        deviceName: String,
        nonce: String,
        appVersion: String?
    ) async throws -> PairingResult {
        let request = PairConfirmRequest(
            appVersion: appVersion,
            code: code,
            deviceName: deviceName,
            kind: .ipad,
            pairingID: pairingID,
            publicNonce: nonce
        )
        let body = try encode(request)
        let data = try await send("POST", "/devices/pair/confirm", endpoint: endpoint, token: nil, body: body)
        guard let response = try? newJSONDecoder().decode(PairResponse.self, from: data) else {
            throw ConnectionError.invalidResponse
        }
        return PairingResult(
            deviceToken: response.deviceToken,
            deviceID: response.device.id,
            deviceName: response.device.name
        )
    }

    /// `GET /health` mit Token: prüft Erreichbarkeit und Gültigkeit der Kopplung in einem Schritt
    func checkHealth(endpoint: CoreEndpoint, token: String) async throws {
        _ = try await send("GET", "/health", endpoint: endpoint, token: token, body: nil)
    }

    /// `DELETE /devices/{id}`: Das iPad meldet sich selbst ab (aus dem Netz nur für das eigene Gerät erlaubt)
    func removeDevice(endpoint: CoreEndpoint, deviceID: String, token: String) async throws {
        _ = try await send("DELETE", "/devices/\(deviceID)", endpoint: endpoint, token: token, body: nil)
    }

    private func encode<T: Encodable>(_ value: T) throws -> Data {
        guard let data = try? newJSONEncoder().encode(value) else {
            throw ConnectionError.invalidResponse
        }
        return data
    }

    private func send(
        _ method: String,
        _ path: String,
        endpoint: CoreEndpoint,
        token: String?,
        body: Data?
    ) async throws -> Data {
        guard let url = endpoint.url(path: path) else { throw ConnectionError.invalidAddress }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 10
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        // Kein Origin-Header: pair/* mit Origin lehnt der Core ab (VERTRAEGE §5)
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        var attempt = 0
        while true {
            let result: (Data, HTTPURLResponse)
            do {
                result = try await transport.send(request)
            } catch let error as URLError {
                if error.code == .networkConnectionLost, attempt < maxRetries {
                    attempt += 1
                    try? await _Concurrency.Task.sleep(for: retryDelay)
                    continue
                }
                throw ConnectionError.from(error)
            }
            let status = result.1.statusCode
            guard (200..<300).contains(status) else {
                throw ConnectionError.from(status: status, code: Self.errorCode(in: result.0))
            }
            return result.0
        }
    }

    /// Liest nur `error.code` aus `ApiError`. Die Meldung des Servers wird nicht angezeigt.
    private static func errorCode(in data: Data) -> String? {
        (try? newJSONDecoder().decode(APIError.self, from: data))?.error.code
    }
}
