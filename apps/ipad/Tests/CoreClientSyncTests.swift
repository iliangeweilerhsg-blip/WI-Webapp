import XCTest

@testable import StudienGehirn

final class CoreClientSyncTests: XCTestCase {
    private let emptyStrokes = "{\"page_id\":\"p1\",\"stream_op_id\":null,\"stream_seq\":0,\"strokes\":[]}"

    func testSyncURLUsesWebSocketOutsideOfTheAPIPrefix() {
        XCTAssertEqual(Fixtures.endpoint.syncURL()?.absoluteString, "ws://192.0.2.10:4710/sync")
        let local = CoreEndpoint(host: "mein-mac.local", port: 4711)
        XCTAssertEqual(local?.syncURL()?.absoluteString, "ws://mein-mac.local:4711/sync")
    }

    func testURLWithQueryItems() {
        let url = Fixtures.endpoint.url(path: "/notebooks", queryItems: [URLQueryItem(name: "module_id", value: "m1")])
        XCTAssertEqual(url?.absoluteString, "http://192.0.2.10:4710/api/v1/notebooks?module_id=m1")
        XCTAssertEqual(
            Fixtures.endpoint.url(path: "/health")?.absoluteString, "http://192.0.2.10:4710/api/v1/health")
    }

    @MainActor
    func testActiveSessionsAsksForRunningAndPausedAndRetriesOnConnectionLoss() async throws {
        let transport = FakeTransport([
            .failure(.networkConnectionLost),
            .http(status: 200, body: "{\"items\":[],\"next_cursor\":null}"),
        ])
        let client = Fixtures.client(transport)

        let sessions = try await client.activeSessions(endpoint: Fixtures.endpoint, token: Fixtures.token)

        XCTAssertTrue(sessions.isEmpty)
        XCTAssertEqual(transport.requests.count, 2)
        let request = try XCTUnwrap(transport.requests.last)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/sessions")
        XCTAssertTrue(request.url?.absoluteString.contains("state=laeuft") ?? false)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(Fixtures.token)")
    }

    @MainActor
    func testNotebooksFilterByModuleAndRetryOnConnectionLoss() async throws {
        let transport = FakeTransport([
            .failure(.networkConnectionLost),
            .failure(.networkConnectionLost),
            .http(status: 200, body: "{\"items\":[],\"next_cursor\":null}"),
        ])
        let client = Fixtures.client(transport)

        let notebooks = try await client.notebooks(
            endpoint: Fixtures.endpoint, token: Fixtures.token, moduleID: "m1")

        XCTAssertTrue(notebooks.isEmpty)
        XCTAssertEqual(transport.requests.count, 3)
        XCTAssertEqual(transport.requests.last?.url?.query, "module_id=m1")
    }

    @MainActor
    func testNotebookPagesRetryOnConnectionLoss() async throws {
        let transport = FakeTransport([
            .failure(.networkConnectionLost),
            .http(status: 200, body: "{\"items\":[],\"notebook_id\":\"n1\",\"stream_op_id\":null,\"stream_seq\":0}"),
        ])
        let client = Fixtures.client(transport)

        let pages = try await client.notebookPages(
            endpoint: Fixtures.endpoint, token: Fixtures.token, notebookID: "n1")

        XCTAssertTrue(pages.isEmpty)
        XCTAssertEqual(transport.requests.count, 2)
        XCTAssertEqual(transport.requests.last?.url?.path, "/api/v1/notebooks/n1/pages")
    }

    @MainActor
    func testPageStrokesRetryOnConnectionLoss() async throws {
        let transport = FakeTransport([
            .failure(.networkConnectionLost),
            .http(status: 200, body: emptyStrokes),
        ])
        let client = Fixtures.client(transport)

        let strokes = try await client.pageStrokes(endpoint: Fixtures.endpoint, token: Fixtures.token, pageID: "p1")

        XCTAssertEqual(strokes?.pageID, "p1")
        XCTAssertEqual(strokes?.strokes.count, 0)
        XCTAssertEqual(transport.requests.count, 2)
        XCTAssertEqual(transport.requests.last?.url?.path, "/api/v1/pages/p1/strokes")
    }

    @MainActor
    func testPageStrokesGiveNilFor404() async throws {
        let transport = FakeTransport([.http(status: 404, body: Fixtures.apiError("page_not_found"))])
        let client = Fixtures.client(transport)

        let strokes = try await client.pageStrokes(endpoint: Fixtures.endpoint, token: Fixtures.token, pageID: "p1")

        XCTAssertNil(strokes)
    }

    @MainActor
    func testPageStrokesStillThrowOtherErrors() async {
        let transport = FakeTransport([.http(status: 401, body: Fixtures.apiError("device_token_invalid"))])
        let client = Fixtures.client(transport)

        do {
            _ = try await client.pageStrokes(endpoint: Fixtures.endpoint, token: Fixtures.token, pageID: "p1")
            XCTFail("401 muss ein Fehler bleiben")
        } catch {
            XCTAssertEqual(ConnectionError.wrap(error), .tokenInvalid)
        }
    }
}
