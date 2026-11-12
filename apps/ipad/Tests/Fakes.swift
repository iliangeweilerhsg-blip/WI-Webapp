import Foundation
import XCTest

@testable import StudienGehirn

/// Token-Speicher im Arbeitsspeicher statt im Schlüsselbund
final class FakeTokenStore: TokenStore {
    var token: String?
    var failsOnSave = false

    init(token: String? = nil) {
        self.token = token
    }

    func loadToken() throws -> String? { token }

    func saveToken(_ token: String) throws {
        if failsOnSave { throw KeychainError(status: -1) }
        self.token = token
    }

    func deleteToken() throws { token = nil }
}

final class FakePairedMacStore: PairedMacStore {
    var mac: PairedMac?

    init(mac: PairedMac? = nil) {
        self.mac = mac
    }

    func loadPairedMac() -> PairedMac? { mac }
    func savePairedMac(_ mac: PairedMac) { self.mac = mac }
    func clearPairedMac() { mac = nil }
}

/// Schnittstellen des iPads aus einer festen Liste statt aus `getifaddrs`
struct FakeInterfaces: InterfaceListing {
    let list: [InterfaceAddress]

    init(_ list: [InterfaceAddress]) {
        self.list = list
    }

    func activeIPv4() -> [InterfaceAddress] { list }

    /// `address` mit Präfixlänge, zum Beispiel `("192.168.1.5", prefix: 24)`
    static func address(_ text: String, prefix: Int) -> InterfaceAddress {
        guard let value = TokenDestination.parseIPv4(text), (0...32).contains(prefix) else {
            preconditionFailure("Ungültige Testadresse \(text)/\(prefix)")
        }
        let mask: UInt32 = prefix == 0 ? 0 : UInt32.max << UInt32(32 - prefix)
        return InterfaceAddress(address: value, netmask: mask)
    }
}

/// Antworten ohne Netz. Jede Anfrage wird gemerkt.
@MainActor
final class FakeTransport: HTTPTransport {
    enum Reply {
        case http(status: Int, body: String)
        case failure(URLError.Code)
    }

    /// Antworten in Reihenfolge der Anfragen. Die letzte gilt für alle weiteren.
    var replies: [Reply]
    private(set) var requests: [URLRequest] = []
    /// Läuft mitten in einer Anfrage, bevor die Antwort zurückkommt (z. B. ein `ack`, das während eines Abrufs
    /// eintrifft)
    var duringRequest: (@MainActor (URLRequest) async -> Void)?
    /// Antwortet nach Pfad statt nach Reihenfolge. `nil` = die Antworten in `replies` gelten.
    var router: (@MainActor (URLRequest) -> Reply?)?

    init(_ replies: [Reply]) {
        self.replies = replies
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let index = min(requests.count - 1, replies.count - 1)
        if let duringRequest {
            await duringRequest(request)
        }
        let reply = router?(request) ?? replies[index]
        switch reply {
        case .failure(let code):
            throw URLError(code)
        case .http(let status, let body):
            guard
                let url = request.url,
                let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)
            else {
                throw URLError(.badServerResponse)
            }
            return (Data(body.utf8), response)
        }
    }

    // MARK: Download in eine Datei (Folien-PDF)

    /// Inhalt, den `download` in die Zieldatei schreibt
    var downloadData = Data()
    var downloadStatus = 200
    /// Wert von `Content-Length`; `nil` = Header fehlt (der Fake kennt dann vorab keine Größe)
    var downloadAnnouncedLength: Int?
    /// Der Fake schreibt in Stücken dieser Größe und prüft nach jedem Stück die Grenze, wie der echte Delegate.
    /// Reißt die Grenze, bleibt die Teil-Datei absichtlich liegen: Der Aufrufer muss sie löschen.
    var downloadChunkSize = 1024
    private(set) var downloadRequests: [URLRequest] = []
    private(set) var downloadLimits: [DownloadLimit] = []

    func download(_ request: URLRequest, to file: URL, limit: DownloadLimit) async throws -> HTTPURLResponse {
        downloadRequests.append(request)
        downloadLimits.append(limit)
        guard
            let url = request.url,
            let response = HTTPURLResponse(
                url: url, statusCode: downloadStatus, httpVersion: "HTTP/1.1", headerFields: nil)
        else {
            throw URLError(.badServerResponse)
        }
        // Gibt anderen gleichzeitigen Aufrufen die Chance, sich an den laufenden Ladevorgang zu hängen
        await _Concurrency.Task.yield()
        guard (200..<300).contains(downloadStatus) else { return response }
        if let announced = downloadAnnouncedLength, limit.isExceeded(written: 0, announced: Int64(announced)) {
            throw URLError(.dataLengthExceedsMaximum)
        }
        FileManager.default.createFile(atPath: file.path, contents: nil)
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }
        var offset = 0
        while offset < downloadData.count {
            let end = min(offset + downloadChunkSize, downloadData.count)
            try handle.write(contentsOf: downloadData[offset..<end])
            offset = end
            if limit.isExceeded(written: Int64(offset), announced: -1) {
                throw URLError(.dataLengthExceedsMaximum)
            }
        }
        return response
    }

    /// JSON-Body der Anfrage mit diesem Index
    func jsonBody(at index: Int) throws -> [String: Any] {
        let data = try XCTUnwrap(requests[index].httpBody)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}

enum Fixtures {
    /// Kein echtes Token: nur das Format aus `PairResponse` (43 Zeichen base64url)
    static let token = "EXAMPLEdevicetoken0000000000000000000000000"
    static let deviceID = "019a4e14-0000-7000-8000-000000000080"
    static let publicPairingID = "019a4e14-0000-7000-8000-0000000000a1"
    static let qrPairingID = "019a4e14-0000-4000-8000-0000000000c1"

    /// Adresse aus dem Dokumentationsbereich 192.0.2.0/24, kein echtes Gerät
    static let endpoint = CoreEndpoint(host: "192.0.2.10", port: 4710)!

    static let pairStartResponse = """
        {"request_id":"019a4e14-0000-7000-8000-0000000000b1","pairing_id":"\(publicPairingID)","expires_at":"2026-11-04T07:20:00Z"}
        """

    static let pairResponse = """
        {"device":{"id":"\(deviceID)","user_id":"019a4e14-0000-7000-8000-000000000001",
        "created_at":"2026-11-04T07:15:00Z","updated_at":"2026-11-04T07:15:00Z","deleted_at":null,
        "name":"iPad Test","kind":"ipad","last_seen_at":"2026-11-04T07:15:00.250Z","clock_offset_ms":null,
        "app_version":"0.1.0","connected":false},"device_token":"\(token)"}
        """

    static func apiError(_ code: String) -> String {
        """
        {"error":{"code":"\(code)","message":"Testmeldung"}}
        """
    }

    static let pairedMac = PairedMac(endpoint: endpoint, deviceID: deviceID, deviceName: "iPad Test")

    /// Das iPad hängt im selben Netz wie `endpoint` (192.0.2.77/24): Anfragen mit Token sind erlaubt
    static let sameNetwork = FakeInterfaces([FakeInterfaces.address("192.0.2.77", prefix: 24)])

    /// Das iPad hängt in einem anderen Netz (198.51.100.5/24, Dokumentationsbereich): Anfragen mit Token sind gesperrt
    static let otherNetwork = FakeInterfaces([FakeInterfaces.address("198.51.100.5", prefix: 24)])

    @MainActor
    static func client(
        _ transport: FakeTransport, interfaces: any InterfaceListing = Fixtures.sameNetwork,
        routing: (any MacRouting)? = nil
    ) -> CoreClient {
        CoreClient(transport: transport, maxRetries: 2, retryDelay: .zero, interfaces: interfaces, routing: routing)
    }
}
