import XCTest

@testable import StudienGehirn

/// Review L13 (Download-Grenzen) und L14 (IDs aus Serverdaten in REST-Pfaden)
@MainActor
final class DownloadHardeningTests: XCTestCase {
    private func tempFile() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("dl-\(UUID().uuidString).pdf.part")
    }

    private func download(
        _ transport: FakeTransport, to file: URL, maxBytes: Int = 1000, maxDuration: TimeInterval = 600
    ) async throws {
        try await Fixtures.client(transport).downloadSlideDeckFile(
            endpoint: Fixtures.endpoint, token: Fixtures.token, deckID: "deck-1", to: file, maxBytes: maxBytes,
            maxDuration: maxDuration)
    }

    // MARK: L13

    func testLimitChecksWrittenAndAnnouncedBytes() {
        let limit = DownloadLimit(maxBytes: 100, maxDuration: 60)
        XCTAssertFalse(limit.isExceeded(written: 100, announced: 100))
        XCTAssertFalse(limit.isExceeded(written: 50, announced: -1))
        XCTAssertTrue(limit.isExceeded(written: 101, announced: -1))
        XCTAssertTrue(limit.isExceeded(written: 0, announced: 101))
    }

    func testAbortsWhenContentLengthAnnouncesTooMuchAndLeavesNoFile() async {
        let transport = FakeTransport([.http(status: 200, body: "{}")])
        transport.downloadData = Data(count: 5000)
        transport.downloadAnnouncedLength = 5000
        let file = tempFile()
        do {
            try await download(transport, to: file)
            XCTFail("hätte werfen müssen")
        } catch {
            XCTAssertNotNil(error as? ConnectionError)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testAbortsWithoutContentLengthMidStreamAndRemovesThePartialFile() async {
        let transport = FakeTransport([.http(status: 200, body: "{}")])
        transport.downloadData = Data(count: 5000)
        transport.downloadAnnouncedLength = nil
        transport.downloadChunkSize = 512
        let file = tempFile()
        do {
            try await download(transport, to: file)
            XCTFail("hätte werfen müssen")
        } catch {
            XCTAssertNotNil(error as? ConnectionError)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testAbortsWhenContentLengthLies() async {
        let transport = FakeTransport([.http(status: 200, body: "{}")])
        transport.downloadData = Data(count: 5000)
        transport.downloadAnnouncedLength = 10  // behauptet wenig, liefert viel
        let file = tempFile()
        do {
            try await download(transport, to: file)
            XCTFail("hätte werfen müssen")
        } catch {
            XCTAssertNotNil(error as? ConnectionError)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testDownloadWithinTheLimitStillWorksAndPassesTheLimits() async throws {
        let transport = FakeTransport([.http(status: 200, body: "{}")])
        transport.downloadData = Data(count: 900)
        transport.downloadAnnouncedLength = 900
        let file = tempFile()
        defer { try? FileManager.default.removeItem(at: file) }
        try await download(transport, to: file, maxBytes: 1000, maxDuration: 42)
        XCTAssertEqual(SlideDeckFile.byteSize(of: file), 900)
        XCTAssertEqual(transport.downloadLimits, [DownloadLimit(maxBytes: 1000, maxDuration: 42)])
    }

    func testStoreHandsItsFileLimitToTheDownloadAndKeepsNoPartFile() async {
        let body = """
            {"deck":{"id":"deck-1","sha256":"abc","title":"A"},"slides":[
            {"id":"slide-1","deck_id":"deck-1","index":1,"width_pt":960,"height_pt":540,
            "text":"x","text_blocks":[],"title":null}]}
            """
        let transport = FakeTransport([.http(status: 200, body: body)])
        transport.downloadData = Data(count: 5000)
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("hard-\(UUID().uuidString)")
        let store = SlideDeckStore(
            directory: folder,
            client: Fixtures.client(transport),
            access: { (endpoint: Fixtures.endpoint, token: Fixtures.token) },
            canReach: { true },
            maxFileBytes: 1000
        )
        let info = await store.ensure(deckID: "deck-1")
        XCTAssertNil(info)
        XCTAssertEqual(transport.downloadLimits.first?.maxBytes, 1000)
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: folder.appendingPathComponent("deck-1/deck.pdf.part").path))
        XCTAssertNil(store.pdfURL(deckID: "deck-1"))
    }

    /// Der echte Delegate ohne Netz: Die Task wird nie gestartet, die Callbacks ruft der Test selbst auf.
    private func delegateResult(
        _ delegate: LimitedDownloadDelegate, startAfter callbacks: (URLSession, URLSessionDownloadTask) -> Void
    ) async -> Error? {
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let task = session.downloadTask(with: URL(string: "http://127.0.0.1:9/file")!)
        callbacks(session, task)
        do {
            let _: HTTPURLResponse = try await withCheckedThrowingContinuation { continuation in
                delegate.start(continuation)
            }
            return nil
        } catch {
            return error
        }
    }

    func testDelegateResumesWhenTheTaskEndedBeforeStart() async {
        // Abbruch vor dem Start (Swift-Task schon abgebrochen): Das Ende kommt vor `start`, darf aber nicht hängen
        let delegate = LimitedDownloadDelegate(
            limit: DownloadLimit(maxBytes: 10, maxDuration: 5), destination: tempFile())
        let error = await delegateResult(delegate) { session, task in
            delegate.urlSession(session, task: task, didCompleteWithError: URLError(.cancelled))
        }
        XCTAssertEqual((error as? URLError)?.code, .cancelled)
    }

    func testDelegateReportsExceededLimitAndRemovesTheFile() async throws {
        let file = tempFile()
        try Data(count: 20).write(to: file)
        let delegate = LimitedDownloadDelegate(limit: DownloadLimit(maxBytes: 10, maxDuration: 5), destination: file)
        let error = await delegateResult(delegate) { session, task in
            delegate.urlSession(
                session, downloadTask: task, didWriteData: 20, totalBytesWritten: 20, totalBytesExpectedToWrite: -1)
            delegate.urlSession(session, task: task, didCompleteWithError: nil)
        }
        XCTAssertEqual((error as? URLError)?.code, .dataLengthExceedsMaximum)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    // MARK: L14

    func testSafeIDRule() {
        XCTAssertTrue(SafeID.isValid("019a4e14-0000-7000-8000-000000000080"))
        XCTAssertTrue(SafeID.isValid("m1"))
        XCTAssertTrue(SafeID.isValid(String(repeating: "a", count: 64)))
        XCTAssertFalse(SafeID.isValid(""))
        XCTAssertFalse(SafeID.isValid(String(repeating: "a", count: 65)))
        XCTAssertFalse(SafeID.isValid("../x"))
        XCTAssertFalse(SafeID.isValid("a/b"))
        XCTAssertFalse(SafeID.isValid("a?b=1"))
        XCTAssertFalse(SafeID.isValid("a b"))
        XCTAssertFalse(SafeID.isValid("a_b"))
        XCTAssertFalse(SafeID.isValid("äb"))
        XCTAssertFalse(SlideDeckFile.isSafeID("a/b"))
        XCTAssertTrue(SlideDeckFile.isSafeID("deck-1"))
    }

    func testUnsafeIDsSendNoRequest() async {
        let transport = FakeTransport([.http(status: 200, body: "{}")])
        let client = Fixtures.client(transport)
        let endpoint = Fixtures.endpoint
        let token = Fixtures.token
        let bad = "../../devices/x"
        let file = tempFile()

        let calls: [(String, @MainActor () async throws -> Void)] = [
            ("removeDevice", { try await client.removeDevice(endpoint: endpoint, deviceID: bad, token: token) }),
            ("moduleName", { _ = try await client.moduleName(endpoint: endpoint, token: token, moduleID: bad) }),
            (
                "sessionNotebook",
                { _ = try await client.sessionNotebook(endpoint: endpoint, token: token, sessionID: bad) }
            ),
            (
                "notebookPages",
                { _ = try await client.notebookPages(endpoint: endpoint, token: token, notebookID: bad) }
            ),
            ("notebooks", { _ = try await client.notebooks(endpoint: endpoint, token: token, moduleID: bad) }),
            ("pageStrokes", { _ = try await client.pageStrokes(endpoint: endpoint, token: token, pageID: bad) }),
            ("pageState", { _ = try await client.pageState(endpoint: endpoint, token: token, pageID: bad) }),
            (
                "sessionSnapshot",
                { _ = try await client.sessionSnapshot(endpoint: endpoint, token: token, sessionID: bad) }
            ),
            ("slideDeck", { _ = try await client.slideDeck(endpoint: endpoint, token: token, deckID: bad) }),
            (
                "downloadSlideDeckFile",
                { try await client.downloadSlideDeckFile(endpoint: endpoint, token: token, deckID: bad, to: file) }
            ),
            (
                "patchModuleInkMode",
                {
                    try await client.patchModuleInkMode(
                        endpoint: endpoint, token: token, moduleID: bad, mode: .freieSeite)
                }
            ),
        ]
        for (name, call) in calls {
            do {
                try await call()
                XCTFail("\(name): hätte werfen müssen")
            } catch {
                XCTAssertEqual(error as? ConnectionError, .invalidResponse, name)
            }
        }
        XCTAssertTrue(transport.requests.isEmpty)
        XCTAssertTrue(transport.downloadRequests.isEmpty)
    }

    func testValidIDsStillSendTheRequest() async throws {
        let transport = FakeTransport([.http(status: 200, body: "{\"name\":\"Analysis\"}")])
        let name = try await Fixtures.client(transport).moduleName(
            endpoint: Fixtures.endpoint, token: Fixtures.token, moduleID: "019a4e14-0000-7000-8000-000000000001")
        XCTAssertEqual(name, "Analysis")
        XCTAssertEqual(transport.requests.first?.url?.path, "/api/v1/modules/019a4e14-0000-7000-8000-000000000001")
    }
}
