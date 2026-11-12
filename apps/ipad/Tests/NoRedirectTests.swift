import XCTest

@testable import StudienGehirn

/// Review L16: Keine HTTP-Weiterleitungen. Die Delegates werden ohne Netz direkt aufgerufen.
final class NoRedirectTests: XCTestCase {
    private let origin = URL(string: "http://192.168.0.2:8765/health")!
    private let foreign = URL(string: "http://evil.example/steal")!

    /// Ruft den Callback auf und meldet, ob und womit der Delegate geantwortet hat
    private func answer(
        _ call: (URLSession, URLSessionTask, HTTPURLResponse, URLRequest, @escaping @Sendable (URLRequest?) -> Void) -> Void
    ) -> ReplyBox {
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let task = session.dataTask(with: origin)
        let response = HTTPURLResponse(
            url: origin, statusCode: 302, httpVersion: "HTTP/1.1", headerFields: ["Location": foreign.absoluteString])!
        var request = URLRequest(url: foreign)
        request.setValue("Bearer geheim", forHTTPHeaderField: "Authorization")
        let box = ReplyBox()
        call(session, task, response, request) { box.record($0) }
        return box
    }

    func testSessionDelegateRefusesRedirect() {
        let delegate = NoRedirectDelegate()
        let box = answer { session, task, response, request, done in
            delegate.urlSession(
                session, task: task, willPerformHTTPRedirection: response, newRequest: request, completionHandler: done)
        }
        XCTAssertEqual(box.calls, 1)
        XCTAssertNil(box.request)
    }

    func testDownloadDelegateRefusesRedirect() {
        let delegate = LimitedDownloadDelegate(
            limit: DownloadLimit(maxBytes: 10, maxDuration: 5),
            destination: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        let box = answer { session, task, response, request, done in
            delegate.urlSession(
                session, task: task, willPerformHTTPRedirection: response, newRequest: request, completionHandler: done)
        }
        XCTAssertEqual(box.calls, 1)
        XCTAssertNil(box.request)
    }

    @MainActor
    func testRedirectResponseIsAnErrorInTheClient() async {
        let transport = FakeTransport([.http(status: 302, body: "")])
        let client = Fixtures.client(transport)
        do {
            try await client.checkHealth(endpoint: Fixtures.endpoint, token: Fixtures.token)
            XCTFail("3xx darf kein Erfolg sein")
        } catch {
            XCTAssertEqual(ConnectionError.wrap(error), .server(status: 302, code: nil))
        }
        XCTAssertEqual(transport.requests.count, 1)
    }
}

/// Hält die Antwort des synchron aufgerufenen Callbacks (Swift 6: keine lokale `var` im `@Sendable`-Closure)
private final class ReplyBox: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    private var last: URLRequest?

    var calls: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }

    var request: URLRequest? {
        lock.lock()
        defer { lock.unlock() }
        return last
    }

    func record(_ request: URLRequest?) {
        lock.lock()
        count += 1
        last = request
        lock.unlock()
    }
}
