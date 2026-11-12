import Foundation

/// Dünne Schicht über URLSession, damit Tests ohne Netz laufen
@MainActor
protocol HTTPTransport {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
    /// Lädt den Body **in eine Datei**, nie in den Speicher (Folien-PDF). Bei einer Antwort außerhalb von 2xx bleibt
    /// `file` unberührt. Kommen mehr als `limit.maxBytes` an oder dauert es länger als `limit.maxDuration`, bricht der
    /// Transport ab und wirft `URLError(.dataLengthExceedsMaximum)` bzw. `.timedOut`; `file` bleibt dann nicht zurück.
    func download(_ request: URLRequest, to file: URL, limit: DownloadLimit) async throws -> HTTPURLResponse
}

extension HTTPTransport {
    func download(_ request: URLRequest, to file: URL, limit: DownloadLimit) async throws -> HTTPURLResponse {
        throw URLError(.unsupportedURL)
    }
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

    func download(_ request: URLRequest, to file: URL, limit: DownloadLimit) async throws -> HTTPURLResponse {
        // Eigene Session je Download: Der Delegate zählt die Bytes mit und bricht beim Überschreiten ab.
        // `timeoutIntervalForResource` ist die Gesamtzeit (der Request-Timeout gilt nur im Leerlauf).
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = 10
        configuration.timeoutIntervalForResource = limit.maxDuration
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        let delegate = LimitedDownloadDelegate(limit: limit, destination: file)
        let limitedSession = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        defer { limitedSession.finishTasksAndInvalidate() }
        let task = limitedSession.downloadTask(with: request)
        do {
            return try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<HTTPURLResponse, Error>) in
                    delegate.start(continuation)
                    task.resume()
                }
            } onCancel: {
                task.cancel()
            }
        } catch {
            try? FileManager.default.removeItem(at: file)
            throw error
        }
    }
}

/// Download-Delegate mit Größengrenze. `@unchecked Sendable`: URLSession ruft ihn auf einer eigenen seriellen Queue
/// auf, der veränderliche Zustand (`continuation`, `pending`, `exceeded`, `moveError`) liegt hinter `lock`.
///
/// `didCompleteWithError` kann vor `start` kommen: Ist die Swift-Task schon abgebrochen, ruft
/// `withTaskCancellationHandler` `task.cancel()` vor dem Start auf, und URLSession meldet das Ende auf seiner Queue.
/// Das Ergebnis wartet dann in `pending`, bis `start` es abholt (sonst würde der Aufrufer nie fortgesetzt).
final class LimitedDownloadDelegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let limit: DownloadLimit
    private let destination: URL
    private let lock = NSLock()
    private var continuation: CheckedContinuation<HTTPURLResponse, Error>?
    private var pending: Result<HTTPURLResponse, Error>?
    private var exceeded = false
    private var moveError: Error?

    init(limit: DownloadLimit, destination: URL) {
        self.limit = limit
        self.destination = destination
    }

    func start(_ continuation: CheckedContinuation<HTTPURLResponse, Error>) {
        lock.lock()
        if let pending {
            self.pending = nil
            lock.unlock()
            continuation.resume(with: pending)
            return
        }
        self.continuation = continuation
        lock.unlock()
    }

    private func markExceeded() {
        lock.lock()
        exceeded = true
        lock.unlock()
    }

    private var isExceeded: Bool {
        lock.lock()
        defer { lock.unlock() }
        return exceeded
    }

    func urlSession(
        _ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
    ) {
        if limit.isExceeded(written: totalBytesWritten, announced: totalBytesExpectedToWrite) {
            markExceeded()
            downloadTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // Die Datei von URLSession ist nur in diesem Aufruf gültig: hier verschieben (nur bei 2xx und unter der Grenze)
        guard !isExceeded, let http = downloadTask.response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
        else { return }
        do {
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: location, to: destination)
        } catch {
            lock.lock()
            moveError = error
            lock.unlock()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let wasExceeded = exceeded
        let moveFailure = moveError
        lock.unlock()
        let result: Result<HTTPURLResponse, Error>
        if wasExceeded {
            result = .failure(URLError(.dataLengthExceedsMaximum))
        } else if let error {
            result = .failure(error)
        } else if let moveFailure {
            result = .failure(moveFailure)
        } else if let http = task.response as? HTTPURLResponse {
            result = .success(http)
        } else {
            result = .failure(URLError(.badServerResponse))
        }
        if case .failure = result {
            try? FileManager.default.removeItem(at: destination)
        }
        lock.lock()
        guard let continuation else {
            pending = result
            lock.unlock()
            return
        }
        self.continuation = nil
        lock.unlock()
        continuation.resume(with: result)
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
/// wiederholt der Client hier.
///
/// Wiederholt werden nur idempotente Anfragen: `GET`, `DELETE` und `pair/start` (dieselbe Nonce
/// ergibt dieselbe Anfrage). `pair/confirm` nie: `networkConnectionLost` kann auch auftreten,
/// nachdem der Core die Anfrage schon verarbeitet hat. Eine Wiederholung würde dann einen
/// Fehlversuch doppelt zählen oder ein schon gekoppeltes Gerät als Fehler melden (Review L-1).
@MainActor
final class CoreClient {
    /// Schutz vor einer Endlosschleife, falls ein Core den Cursor nie leert
    private static let maxListPages = 50

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

    /// `POST /devices/pair/confirm`: löst den Code ein und liefert das Geräte-Token.
    /// Nicht idempotent, darum ohne automatische Wiederholung.
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
        let data = try await send(
            "POST", "/devices/pair/confirm", endpoint: endpoint, token: nil, body: body,
            retriesOnConnectionLoss: false)
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
        _ = try await send("DELETE", "/devices/\(try Self.safeID(deviceID))", endpoint: endpoint, token: token, body: nil)
    }

    // MARK: Lesen für den Sync (T1-14). Nur `GET`, darum mit Wiederholung bei `networkConnectionLost`.

    /// `GET /sessions?state=laeuft,pausiert`: die laufende oder pausierte Session (auch vom Vortag)
    func activeSessions(endpoint: CoreEndpoint, token: String) async throws -> [Session] {
        let data = try await send(
            "GET", "/sessions", endpoint: endpoint, token: token, body: nil,
            queryItems: [URLQueryItem(name: "state", value: "laeuft,pausiert")])
        return try decode(SessionList.self, from: data).items
    }

    /// `GET /modules/{id}`: nur der Name wird gebraucht (Titel der Schreibfläche, UX-19)
    func moduleName(endpoint: CoreEndpoint, token: String, moduleID: String) async throws -> String {
        let data = try await send("GET", "/modules/\(try Self.safeID(moduleID))", endpoint: endpoint, token: token, body: nil)
        return try decode(ModuleNameResponse.self, from: data).name
    }

    /// `GET /modules?limit=200`, bis `next_cursor` leer ist. Gelesen wird nur das, was die Bibliothek braucht
    /// (`ModuleBrief`): Ein neuer Wert in `color` oder `settings.layout` lässt den Abruf nicht scheitern.
    func modules(endpoint: CoreEndpoint, token: String) async throws -> [ModuleBrief] {
        var result: [ModuleBrief] = []
        var cursor: String?
        for _ in 0..<CoreClient.maxListPages {
            var query = [URLQueryItem(name: "limit", value: "200")]
            if let cursor {
                query.append(URLQueryItem(name: "cursor", value: cursor))
            }
            let data = try await send("GET", "/modules", endpoint: endpoint, token: token, body: nil, queryItems: query)
            let page = try decode(ModuleBriefList.self, from: data)
            result += page.items
            guard let next = page.nextCursor, !next.isEmpty, next != cursor else { break }
            cursor = next
        }
        return result
    }

    /// `GET /notebooks?module_id=…&limit=200`, bis `next_cursor` leer ist. Die Regel „fehlt am Core, dann
    /// ausblenden“ braucht die vollständige Liste.
    func notebooks(endpoint: CoreEndpoint, token: String, moduleID: String) async throws -> [Notebook] {
        let safeModule = try Self.safeID(moduleID)
        var result: [Notebook] = []
        var cursor: String?
        for _ in 0..<CoreClient.maxListPages {
            var query = [
                URLQueryItem(name: "module_id", value: safeModule),
                URLQueryItem(name: "limit", value: "200"),
            ]
            if let cursor {
                query.append(URLQueryItem(name: "cursor", value: cursor))
            }
            let data = try await send(
                "GET", "/notebooks", endpoint: endpoint, token: token, body: nil, queryItems: query)
            let page = try decode(NotebookList.self, from: data)
            result += page.items
            guard let next = page.nextCursor, !next.isEmpty, next != cursor else { break }
            cursor = next
        }
        return result
    }

    /// `GET /sessions/{id}/notebook` (#199): das Notizbuch der Session, wie der Core es bestimmt.
    /// `nil` bei 404 (älterer Core ohne diesen Endpunkt, oder das Modul ist gelöscht).
    func sessionNotebook(endpoint: CoreEndpoint, token: String, sessionID: String) async throws -> Notebook? {
        do {
            let data = try await send(
                "GET", "/sessions/\(try Self.safeID(sessionID))/notebook", endpoint: endpoint, token: token, body: nil)
            return try decode(Notebook.self, from: data)
        } catch ConnectionError.server(let status, _) where status == 404 {
            return nil
        }
    }

    /// `GET /notebooks/{id}/pages`
    func notebookPages(endpoint: CoreEndpoint, token: String, notebookID: String) async throws -> [Page] {
        let data = try await send(
            "GET", "/notebooks/\(try Self.safeID(notebookID))/pages", endpoint: endpoint, token: token, body: nil)
        return try decode(NotebookPages.self, from: data).items
    }

    /// `GET /pages/{id}/strokes`. `nil`, wenn der Core die Seite nicht kennt (404).
    func pageStrokes(endpoint: CoreEndpoint, token: String, pageID: String) async throws -> PageStrokes? {
        do {
            let data = try await send(
                "GET", "/pages/\(try Self.safeID(pageID))/strokes", endpoint: endpoint, token: token, body: nil)
            return try decode(PageStrokes.self, from: data)
        } catch ConnectionError.server(let status, _) where status == 404 {
            return nil
        }
    }

    /// `GET /pages/{id}`: nur der Stand der Seite (`RemotePageState`), ohne ihre Elemente. `nil` bei 404.
    /// Nötig für `page_version_conflict` (VERTRAEGE §11.2): Der Client lädt die Seite neu und sendet mit der Version
    /// des Core erneut.
    func pageState(endpoint: CoreEndpoint, token: String, pageID: String) async throws -> RemotePageState? {
        do {
            let data = try await send("GET", "/pages/\(try Self.safeID(pageID))", endpoint: endpoint, token: token, body: nil)
            return try decode(RemotePageState.self, from: data)
        } catch ConnectionError.server(let status, _) where status == 404 {
            return nil
        }
    }

    // MARK: Schreibmodi und Folien (T1-13 Teil 2)

    /// `GET /sessions/{id}/snapshot`, auf das Nötige gekürzt (`SessionSnapshotBrief`). `nil` bei 404.
    func sessionSnapshot(endpoint: CoreEndpoint, token: String, sessionID: String) async throws
        -> SessionSnapshotBrief?
    {
        do {
            let data = try await send(
                "GET", "/sessions/\(try Self.safeID(sessionID))/snapshot", endpoint: endpoint, token: token, body: nil)
            return try decode(SessionSnapshotBrief.self, from: data)
        } catch ConnectionError.server(let status, _) where status == 404 {
            return nil
        }
    }

    /// `GET /slide-decks/{id}`: Folienliste und `sha256`, ohne Text. `nil` bei 404.
    func slideDeck(endpoint: CoreEndpoint, token: String, deckID: String) async throws -> SlideDeckInfo? {
        do {
            let data = try await send("GET", "/slide-decks/\(try Self.safeID(deckID))", endpoint: endpoint, token: token, body: nil)
            return try decode(SlideDeckDetailBrief.self, from: data).info
        } catch ConnectionError.server(let status, _) where status == 404 {
            return nil
        }
    }

    /// `GET /slide-decks/{id}/file`: das PDF **in eine Datei**. Keine Wiederholung (große Datei). Das Token steht nur
    /// im Header. Der Transport bricht ab, sobald mehr als `maxBytes` ankommen (auch ohne oder mit falschem
    /// `Content-Length`) oder die Gesamtzeit `maxDuration` verstrichen ist (Review L13). Bei jedem Fehler ist `file`
    /// danach weg. Hash und Seitenzahl prüft der Aufrufer.
    func downloadSlideDeckFile(
        endpoint: CoreEndpoint, token: String, deckID: String, to file: URL,
        maxBytes: Int = SlideDeckStore.defaultMaxFileBytes,
        maxDuration: TimeInterval = DownloadLimit.defaultMaxDuration
    ) async throws {
        let safeDeck = try Self.safeID(deckID)
        guard let url = endpoint.url(path: "/slide-decks/\(safeDeck)/file", queryItems: []) else {
            throw ConnectionError.invalidAddress
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 120
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/pdf", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let response: HTTPURLResponse
        do {
            response = try await transport.download(
                request, to: file, limit: DownloadLimit(maxBytes: maxBytes, maxDuration: maxDuration))
        } catch let error as URLError {
            try? FileManager.default.removeItem(at: file)
            throw ConnectionError.from(error)
        } catch {
            try? FileManager.default.removeItem(at: file)
            throw error
        }
        guard (200..<300).contains(response.statusCode) else {
            try? FileManager.default.removeItem(at: file)
            throw ConnectionError.from(status: response.statusCode, code: nil)
        }
    }

    /// `GET /settings` → `lecture.default_ink_mode`. Fehlt der Wert oder ist er unbekannt: „freie Seite“ (der Standard
    /// laut VERTRAEGE §14.1).
    func lectureDefaults(endpoint: CoreEndpoint, token: String) async throws -> InkMode {
        let data = try await send("GET", "/settings", endpoint: endpoint, token: token, body: nil)
        let excerpt = try decode(SettingsInkExcerpt.self, from: data)
        return excerpt.lecture?.defaultInkMode.flatMap { InkMode(rawValue: $0) } ?? .freieSeite
    }

    /// `PATCH /modules/{id}` mit `{"settings":{"ink_mode":…}}`. Der Core führt die Schlüssel einzeln zusammen
    /// (VERTRAEGE §14.2): Layout und Spaltenbreiten der Web-App bleiben unberührt. Das Setzen ist idempotent.
    func patchModuleInkMode(endpoint: CoreEndpoint, token: String, moduleID: String, mode: InkMode) async throws {
        let body = try encode(ModuleInkModePatch(settings: .init(inkMode: mode.rawValue)))
        _ = try await send("PATCH", "/modules/\(try Self.safeID(moduleID))", endpoint: endpoint, token: token, body: body)
    }

    /// Bausteine aus Serverdaten gehen nur in einen Pfad, wenn sie `SafeID` bestehen (Review L14). Sonst Fehler, bevor
    /// eine Anfrage entsteht.
    private static func safeID(_ id: String) throws -> String {
        guard SafeID.isValid(id) else { throw ConnectionError.invalidResponse }
        return id
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        guard let value = try? newJSONDecoder().decode(type, from: data) else {
            throw ConnectionError.invalidResponse
        }
        return value
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
        body: Data?,
        queryItems: [URLQueryItem] = [],
        retriesOnConnectionLoss: Bool = true
    ) async throws -> Data {
        guard let url = endpoint.url(path: path, queryItems: queryItems) else { throw ConnectionError.invalidAddress }
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
                if retriesOnConnectionLoss, error.code == .networkConnectionLost, attempt < maxRetries {
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

/// Ausschnitt aus `Settings`: nur `lecture.default_ink_mode`
private struct SettingsInkExcerpt: Decodable {
    struct Lecture: Decodable {
        let defaultInkMode: String?

        private enum CodingKeys: String, CodingKey {
            case defaultInkMode = "default_ink_mode"
        }
    }

    let lecture: Lecture?
}

private struct ModuleInkModePatch: Encodable {
    struct Settings: Encodable {
        let inkMode: String

        private enum CodingKeys: String, CodingKey {
            case inkMode = "ink_mode"
        }
    }

    let settings: Settings
}

/// Ausschnitt aus `Module`: Unbekannte Felder werden ignoriert
private struct ModuleNameResponse: Decodable {
    let name: String
}

/// Ausschnitt aus `Module` für die Bibliothek: Unbekannte Felder und Werte werden ignoriert
/// (Muster wie `ModuleNameResponse`, aber ohne das generierte `Module`/`ModuleList`).
struct ModuleBrief: Decodable, Equatable, Sendable {
    let id: String
    let name: String
    let shortName: String?
    /// `settings.ink_mode`; ein unbekannter Wert zählt als „nicht gesetzt“
    let inkMode: InkMode?

    init(id: String, name: String, shortName: String?, inkMode: InkMode?) {
        self.id = id
        self.name = name
        self.shortName = shortName
        self.inkMode = inkMode
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case shortName = "short_name"
        case settings
    }

    private struct SettingsExcerpt: Decodable {
        let inkMode: String?

        private enum CodingKeys: String, CodingKey {
            case inkMode = "ink_mode"
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            inkMode = try? container.decodeIfPresent(String.self, forKey: .inkMode)
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        shortName = try? container.decodeIfPresent(String.self, forKey: .shortName)
        let settings = try? container.decodeIfPresent(SettingsExcerpt.self, forKey: .settings)
        let raw = settings?.inkMode
        inkMode = raw.flatMap { InkMode(rawValue: $0) }
    }
}

private struct ModuleBriefList: Decodable {
    let items: [ModuleBrief]
    let nextCursor: String?

    private enum CodingKeys: String, CodingKey {
        case items
        case nextCursor = "next_cursor"
    }
}

/// Stand einer Seite laut `GET /pages/{id}` (Feld `page`). Gelesen wird nur, was die Konfliktauflösung braucht:
/// Unbekannte Felder und Elemente der Seite werden ignoriert, eine unbekannte Vorlage zählt als `blanko`.
struct RemotePageState: Decodable, Equatable, Sendable {
    let version: Int
    let index: Int
    let template: PageTemplate
    let sessionID: String?
    let backgroundSlideID: String?
    let attachedSlideID: String?

    init(
        version: Int, index: Int, template: PageTemplate, sessionID: String?, backgroundSlideID: String?,
        attachedSlideID: String?
    ) {
        self.version = version
        self.index = index
        self.template = template
        self.sessionID = sessionID
        self.backgroundSlideID = backgroundSlideID
        self.attachedSlideID = attachedSlideID
    }

    private enum RootKeys: String, CodingKey {
        case page
    }

    private enum PageKeys: String, CodingKey {
        case version
        case index
        case template
        case sessionID = "session_id"
        case backgroundSlideID = "background_slide_id"
        case attachedSlideID = "attached_slide_id"
    }

    init(from decoder: Decoder) throws {
        let root = try decoder.container(keyedBy: RootKeys.self)
        let page = try root.nestedContainer(keyedBy: PageKeys.self, forKey: .page)
        version = try page.decode(Int.self, forKey: .version)
        index = try page.decode(Int.self, forKey: .index)
        let raw = try page.decodeIfPresent(String.self, forKey: .template)
        template = raw.flatMap { PageTemplate(rawValue: $0) } ?? .blanko
        sessionID = try page.decodeIfPresent(String.self, forKey: .sessionID)
        backgroundSlideID = try page.decodeIfPresent(String.self, forKey: .backgroundSlideID)
        attachedSlideID = try page.decodeIfPresent(String.self, forKey: .attachedSlideID)
    }
}
