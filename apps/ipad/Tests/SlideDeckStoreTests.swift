import CryptoKit
import UIKit
import XCTest

@testable import StudienGehirn

/// Test-PDFs entstehen im Test. Keine echten Folien im Repo.
enum TestPDF {
    /// Ein PDF mit einer Seite je Größe
    static func make(pages: [CGSize]) -> Data {
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: pages[0]))
        return renderer.pdfData { context in
            for size in pages {
                context.beginPage(withBounds: CGRect(origin: .zero, size: size), pageInfo: [:])
                UIColor.red.setFill()
                context.fill(CGRect(x: 0, y: 0, width: size.width / 2, height: size.height / 2))
            }
        }
    }

    static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func write(_ data: Data, name: String = "test.pdf") throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("pdf-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(name)
        try data.write(to: url)
        return url
    }
}

@MainActor
private final class Reachability {
    var online = true
}

@MainActor
private final class TickClock {
    private var ticks = 0.0
    func next() -> Date {
        ticks += 1
        return Date(timeIntervalSince1970: 1_800_000_000 + ticks)
    }
}

/// Foliensatz laden, prüfen, ablegen, begrenzen (Plan PR 4, §4.5)
@MainActor
final class SlideDeckStoreTests: XCTestCase {
    private let pageSizes = [CGSize(width: 960, height: 540), CGSize(width: 595, height: 842)]

    private func deckJSON(id: String, sha: String, slideCount: Int = 2) -> String {
        let slides = (1...slideCount).map { number in
            """
            {"id":"slide-\(id)-\(number)","deck_id":"\(id)","index":\(number),"width_pt":960,"height_pt":540,
            "text":"geheim","text_blocks":[{"x":1}],"title":null,"unbekannt":42}
            """
        }
        return """
            {"deck":{"id":"\(id)","sha256":"\(sha)","title":"Analysis","unbekannt":true},"slides":[\(slides.joined(separator: ","))]}
            """
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("slides-test-\(UUID().uuidString)", isDirectory: true)
    }

    private func makeStore(
        _ transport: FakeTransport, directory: URL, reach: Reachability = Reachability(),
        protected: Set<String> = [], clock: TickClock = TickClock(), maxFile: Int = 50_000_000,
        maxTotal: Int = 1_000_000_000
    ) -> SlideDeckStore {
        SlideDeckStore(
            directory: directory,
            client: Fixtures.client(transport),
            access: { (endpoint: Fixtures.endpoint, token: Fixtures.token) },
            canReach: { reach.online },
            protectedDecks: { protected },
            now: { clock.next() },
            maxFileBytes: maxFile,
            maxTotalBytes: maxTotal
        )
    }

    // MARK: Laden

    func testEnsureDownloadsChecksAndStoresTheDeck() async throws {
        let pdf = TestPDF.make(pages: pageSizes)
        let transport = FakeTransport([.http(status: 200, body: deckJSON(id: "deck-1", sha: TestPDF.sha256(pdf)))])
        transport.downloadData = pdf
        let folder = directory()
        let store = makeStore(transport, directory: folder)

        let info = await store.ensure(deckID: "deck-1")
        XCTAssertEqual(info?.deckID, "deck-1")
        XCTAssertEqual(info?.slides.map(\.index), [1, 2])
        XCTAssertEqual(info?.byteSize, pdf.count)
        let url = try XCTUnwrap(store.pdfURL(deckID: "deck-1"))
        XCTAssertEqual(SlideDeckFile.byteSize(of: url), pdf.count)
        XCTAssertEqual(store.info(forSlide: "slide-deck-1-2")?.slide.index, 2)
        XCTAssertNil(store.info(forSlide: "unbekannt"))

        // Keine Reste halber Ladevorgänge
        let names = try FileManager.default.contentsOfDirectory(atPath: folder.appendingPathComponent("deck-1").path)
        XCTAssertEqual(Set(names), ["deck.pdf", "info.json"])

        // Das Token steht nur im Header
        XCTAssertEqual(transport.downloadRequests.count, 1)
        let request = try XCTUnwrap(transport.downloadRequests.first)
        XCTAssertEqual(request.url?.path, "/api/v1/slide-decks/deck-1/file")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(Fixtures.token)")
        XCTAssertFalse(request.url?.absoluteString.contains(Fixtures.token) ?? true)
        let infoText = try String(contentsOf: folder.appendingPathComponent("deck-1/info.json"), encoding: .utf8)
        XCTAssertFalse(infoText.contains(Fixtures.token))
        // Text und Textblöcke der Folien bleiben draußen
        XCTAssertFalse(infoText.contains("geheim"))
    }

    func testAlreadyLoadedDecksAppearOfflineAfterARestart() async throws {
        let pdf = TestPDF.make(pages: pageSizes)
        let transport = FakeTransport([.http(status: 200, body: deckJSON(id: "deck-1", sha: TestPDF.sha256(pdf)))])
        transport.downloadData = pdf
        let folder = directory()
        let first = makeStore(transport, directory: folder)
        _ = await first.ensure(deckID: "deck-1")

        // Neustart ohne Netz
        let offline = Reachability()
        offline.online = false
        let silent = FakeTransport([.failure(.notConnectedToInternet)])
        let second = makeStore(silent, directory: folder, reach: offline)
        XCTAssertNotNil(second.info(forSlide: "slide-deck-1-1"))
        XCTAssertNotNil(second.pdfURL(deckID: "deck-1"))
        let again = await second.ensure(deckID: "deck-1")
        XCTAssertEqual(again?.slides.count, 2)
        XCTAssertTrue(silent.requests.isEmpty)
        XCTAssertTrue(silent.downloadRequests.isEmpty)
    }

    func testAnUnknownDeckOfflineGivesNothingAndAsksNobody() async {
        let offline = Reachability()
        offline.online = false
        let transport = FakeTransport([.http(status: 200, body: "{}")])
        let store = makeStore(transport, directory: directory(), reach: offline)
        let info = await store.ensure(deckID: "deck-1")
        XCTAssertNil(info)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    // MARK: Prüfung

    func testAWrongChecksumIsDiscardedAndNothingStaysOnDisk() async throws {
        let pdf = TestPDF.make(pages: pageSizes)
        let transport = FakeTransport([
            .http(status: 200, body: deckJSON(id: "deck-1", sha: String(repeating: "0", count: 64)))
        ])
        transport.downloadData = pdf
        let folder = directory()
        let store = makeStore(transport, directory: folder)

        let info = await store.ensure(deckID: "deck-1")
        XCTAssertNil(info)
        XCTAssertNil(store.pdfURL(deckID: "deck-1"))
        XCTAssertNil(store.info(forSlide: "slide-deck-1-1"))
        let left = (try? FileManager.default.contentsOfDirectory(atPath: folder.appendingPathComponent("deck-1").path)) ?? []
        XCTAssertFalse(left.contains("deck.pdf"))
        XCTAssertFalse(left.contains("deck.pdf.part"))
    }

    func testARejectedFileIsNotDownloadedAgainUntilItsChecksumChanges() async {
        let pdf = TestPDF.make(pages: pageSizes)
        let transport = FakeTransport([
            .http(status: 200, body: deckJSON(id: "deck-1", sha: String(repeating: "0", count: 64)))
        ])
        transport.downloadData = pdf
        let store = makeStore(transport, directory: directory())

        let first = await store.ensure(deckID: "deck-1")
        XCTAssertNil(first)
        // Gleiche Prüfsumme kurz danach (nächster Folienwechsel): nur die Metadaten, kein zweiter Download
        let second = await store.ensure(deckID: "deck-1")
        XCTAssertNil(second)
        XCTAssertEqual(transport.downloadRequests.count, 1)

        // Der Mac hat die Datei inzwischen korrigiert: neue Prüfsumme, neuer Versuch
        transport.replies = [.http(status: 200, body: deckJSON(id: "deck-1", sha: TestPDF.sha256(pdf)))]
        let third = await store.ensure(deckID: "deck-1")
        XCTAssertEqual(third?.deckID, "deck-1")
        XCTAssertEqual(transport.downloadRequests.count, 2)
    }

    func testAFileOverTheSizeLimitIsDiscarded() async {
        let pdf = TestPDF.make(pages: pageSizes)
        let transport = FakeTransport([.http(status: 200, body: deckJSON(id: "deck-1", sha: TestPDF.sha256(pdf)))])
        transport.downloadData = pdf
        let store = makeStore(transport, directory: directory(), maxFile: pdf.count - 1)
        let info = await store.ensure(deckID: "deck-1")
        XCTAssertNil(info)
    }

    func testSomethingThatIsNoPDFIsDiscardedEvenWithAMatchingChecksum() async {
        let data = Data("Das ist kein PDF".utf8)
        let transport = FakeTransport([.http(status: 200, body: deckJSON(id: "deck-1", sha: TestPDF.sha256(data)))])
        transport.downloadData = data
        let store = makeStore(transport, directory: directory())
        let info = await store.ensure(deckID: "deck-1")
        XCTAssertNil(info)
    }

    func testAPDFWithFewerPagesThanSlidesIsDiscarded() async {
        let pdf = TestPDF.make(pages: pageSizes)
        let transport = FakeTransport([
            .http(status: 200, body: deckJSON(id: "deck-1", sha: TestPDF.sha256(pdf), slideCount: 5))
        ])
        transport.downloadData = pdf
        let store = makeStore(transport, directory: directory())
        let info = await store.ensure(deckID: "deck-1")
        XCTAssertNil(info)
    }

    func testAFailedDownloadLeavesNothing() async {
        let pdf = TestPDF.make(pages: pageSizes)
        let transport = FakeTransport([.http(status: 200, body: deckJSON(id: "deck-1", sha: TestPDF.sha256(pdf)))])
        transport.downloadData = pdf
        transport.downloadStatus = 404
        let folder = directory()
        let store = makeStore(transport, directory: folder)
        let info = await store.ensure(deckID: "deck-1")
        XCTAssertNil(info)
        let left = (try? FileManager.default.contentsOfDirectory(atPath: folder.appendingPathComponent("deck-1").path)) ?? []
        XCTAssertTrue(left.isEmpty)
    }

    func testADeckIDThatIsNoSafeFolderNameIsRefusedWithoutARequest() async {
        let transport = FakeTransport([.http(status: 200, body: "{}")])
        let store = makeStore(transport, directory: directory())
        for bad in ["../evil", "a/b", "", "deck 1", String(repeating: "a", count: 65)] {
            let info = await store.ensure(deckID: bad)
            XCTAssertNil(info)
        }
        XCTAssertTrue(transport.requests.isEmpty)
        XCTAssertTrue(transport.downloadRequests.isEmpty)
    }

    func testATruncatedFileIsNotTrustedAfterARestart() async throws {
        let pdf = TestPDF.make(pages: pageSizes)
        let transport = FakeTransport([.http(status: 200, body: deckJSON(id: "deck-1", sha: TestPDF.sha256(pdf)))])
        transport.downloadData = pdf
        let folder = directory()
        let first = makeStore(transport, directory: folder)
        _ = await first.ensure(deckID: "deck-1")

        let file = folder.appendingPathComponent("deck-1/deck.pdf")
        try pdf.prefix(pdf.count / 2).write(to: file)

        let offline = Reachability()
        offline.online = false
        let second = makeStore(FakeTransport([.failure(.notConnectedToInternet)]), directory: folder, reach: offline)
        XCTAssertNil(second.pdfURL(deckID: "deck-1"))
        let info = await second.ensure(deckID: "deck-1")
        XCTAssertNil(info)
    }

    // MARK: Gleichzeitig

    func testTwoParallelCallsShareOneDownload() async {
        let pdf = TestPDF.make(pages: pageSizes)
        let transport = FakeTransport([.http(status: 200, body: deckJSON(id: "deck-1", sha: TestPDF.sha256(pdf)))])
        transport.downloadData = pdf
        let store = makeStore(transport, directory: directory())

        async let first = store.ensure(deckID: "deck-1")
        async let second = store.ensure(deckID: "deck-1")
        let results = await [first, second]
        XCTAssertNotNil(results[0])
        XCTAssertEqual(results[0], results[1])
        XCTAssertEqual(transport.downloadRequests.count, 1)
        XCTAssertEqual(transport.requests.count, 1)
    }

    // MARK: Obergrenze

    func testTheOldestDeckLeavesWhenTheLimitIsExceeded() async throws {
        let pdfA = TestPDF.make(pages: [CGSize(width: 960, height: 540), CGSize(width: 960, height: 540)])
        let pdfB = TestPDF.make(pages: [CGSize(width: 595, height: 842), CGSize(width: 595, height: 842)])
        let transport = FakeTransport([
            .http(status: 200, body: deckJSON(id: "deck-a", sha: TestPDF.sha256(pdfA))),
            .http(status: 200, body: deckJSON(id: "deck-b", sha: TestPDF.sha256(pdfB))),
        ])
        let folder = directory()
        let store = makeStore(transport, directory: folder, maxTotal: pdfA.count + pdfB.count - 1)

        transport.downloadData = pdfA
        _ = await store.ensure(deckID: "deck-a")
        transport.downloadData = pdfB
        _ = await store.ensure(deckID: "deck-b")

        XCTAssertNil(store.pdfURL(deckID: "deck-a"))
        XCTAssertNotNil(store.pdfURL(deckID: "deck-b"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: folder.appendingPathComponent("deck-a").path))
    }

    func testTheDeckOfTheRunningSessionNeverLeaves() async {
        let pdfA = TestPDF.make(pages: [CGSize(width: 960, height: 540), CGSize(width: 960, height: 540)])
        let pdfB = TestPDF.make(pages: [CGSize(width: 595, height: 842), CGSize(width: 595, height: 842)])
        let transport = FakeTransport([
            .http(status: 200, body: deckJSON(id: "deck-a", sha: TestPDF.sha256(pdfA))),
            .http(status: 200, body: deckJSON(id: "deck-b", sha: TestPDF.sha256(pdfB))),
        ])
        let store = makeStore(
            transport, directory: directory(), protected: ["deck-a"], maxTotal: pdfA.count + pdfB.count - 1)
        transport.downloadData = pdfA
        _ = await store.ensure(deckID: "deck-a")
        transport.downloadData = pdfB
        _ = await store.ensure(deckID: "deck-b")
        XCTAssertNotNil(store.pdfURL(deckID: "deck-a"))
        XCTAssertNotNil(store.pdfURL(deckID: "deck-b"))
    }

    func testTheEvictionPlanTakesTheOldestFirstAndSkipsProtectedOnes() {
        let t0 = Date(timeIntervalSince1970: 100)
        let entries = [
            SlideCachePlan.Entry(id: "a", bytes: 40, lastAccess: t0),
            SlideCachePlan.Entry(id: "b", bytes: 40, lastAccess: t0.addingTimeInterval(10)),
            SlideCachePlan.Entry(id: "c", bytes: 40, lastAccess: t0.addingTimeInterval(20)),
        ]
        XCTAssertEqual(SlideCachePlan.evictions(entries: entries, limit: 120, protected: []), [])
        XCTAssertEqual(SlideCachePlan.evictions(entries: entries, limit: 100, protected: []), ["a"])
        XCTAssertEqual(SlideCachePlan.evictions(entries: entries, limit: 70, protected: []), ["a", "b"])
        XCTAssertEqual(SlideCachePlan.evictions(entries: entries, limit: 100, protected: ["a"]), ["b"])
        XCTAssertEqual(SlideCachePlan.evictions(entries: entries, limit: 10, protected: ["a", "b", "c"]), [])
    }

    // MARK: Hilfen

    func testResolvingASlideByIDOrByIndex() {
        let info = SlideDeckInfo(
            deckID: "d", sha256: "x",
            slides: [
                SlideRef(id: "s1", index: 1, widthPt: 960, heightPt: 540),
                SlideRef(id: "s3", index: 3, widthPt: 960, heightPt: 540),
            ], byteSize: nil)
        XCTAssertEqual(info.resolve(SlideBrief(slideID: "s3", index: 99))?.index, 3)
        XCTAssertEqual(info.resolve(SlideBrief(slideID: nil, index: 3))?.id, "s3")
        // Die ID gilt, auch wenn der Index passen würde
        XCTAssertNil(info.resolve(SlideBrief(slideID: "fremd", index: 1)))
        XCTAssertNil(info.resolve(SlideBrief(slideID: nil, index: 2)))
    }
}
