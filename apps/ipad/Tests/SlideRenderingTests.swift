import UIKit
import XCTest

@testable import StudienGehirn

@MainActor
final class SlideRendererTests: XCTestCase {
    private let portrait = CGSize(width: 595, height: 842)
    private let landscape = CGSize(width: 960, height: 540)

    private func pdf() throws -> URL {
        try TestPDF.write(TestPDF.make(pages: [portrait, landscape]))
    }

    func testThePixelSizeKeepsTheAspectAndTheLongestEdge() {
        let tall = SlideRenderer.pixelSize(forPage: portrait, maxPixel: 2048)
        XCTAssertEqual(tall.height, 2048)
        XCTAssertEqual(tall.width / tall.height, portrait.width / portrait.height, accuracy: 0.001)
        let wide = SlideRenderer.pixelSize(forPage: landscape, maxPixel: 400)
        XCTAssertEqual(wide, CGSize(width: 400, height: 225))
        XCTAssertEqual(SlideRenderer.pixelSize(forPage: .zero, maxPixel: 400), .zero)
        XCTAssertEqual(SlideRenderer.pixelSize(forPage: landscape, maxPixel: 0), .zero)
    }

    func testRendersPagesWithDifferentFormatsWithinTheLimit() async throws {
        let url = try pdf()
        let first = await SlideRenderer.image(pdf: url, pageNumber: 1, maxPixel: 400)
        let image1 = try XCTUnwrap(first)
        XCTAssertLessThanOrEqual(max(image1.size.width, image1.size.height), 400)
        XCTAssertEqual(image1.size.height, 400)
        XCTAssertEqual(image1.size.width / image1.size.height, portrait.width / portrait.height, accuracy: 0.01)

        let second = await SlideRenderer.image(pdf: url, pageNumber: 2, maxPixel: 400)
        let image2 = try XCTUnwrap(second)
        XCTAssertEqual(image2.size.width, 400)
        XCTAssertEqual(image2.size.width / image2.size.height, landscape.width / landscape.height, accuracy: 0.01)
    }

    func testAPageOutsideTheDocumentGivesNil() async throws {
        let url = try pdf()
        let beyond = await SlideRenderer.image(pdf: url, pageNumber: 3, maxPixel: 400)
        XCTAssertNil(beyond)
        let zero = await SlideRenderer.image(pdf: url, pageNumber: 0, maxPixel: 400)
        XCTAssertNil(zero)
        let negative = await SlideRenderer.image(pdf: url, pageNumber: -1, maxPixel: 400)
        XCTAssertNil(negative)
    }

    func testAnUnreadableFileGivesNil() async throws {
        let url = try TestPDF.write(Data("kein pdf".utf8))
        let image = await SlideRenderer.image(pdf: url, pageNumber: 1, maxPixel: 400)
        XCTAssertNil(image)
        let missing = await SlideRenderer.image(
            pdf: url.deletingLastPathComponent().appendingPathComponent("fehlt.pdf"), pageNumber: 1, maxPixel: 400)
        XCTAssertNil(missing)
    }

    func testTheRenderedImageIsNotBlank() async throws {
        // Die Testseite hat links oben ein rotes Viertel: Das Bild enthält mehr als eine Farbe
        let url = try pdf()
        let rendered = await SlideRenderer.image(pdf: url, pageNumber: 2, maxPixel: 64)
        let image = try XCTUnwrap(rendered)
        let cg = try XCTUnwrap(image.cgImage)
        let data = try XCTUnwrap(cg.dataProvider?.data)
        let bytes = CFDataGetBytePtr(data)
        let length = CFDataGetLength(data)
        var colors = Set<[UInt8]>()
        var offset = 0
        while offset + 3 < length {
            colors.insert([bytes![offset], bytes![offset + 1], bytes![offset + 2]])
            offset += 4
        }
        XCTAssertGreaterThan(colors.count, 1)
    }

    func testARenderTaskCanBeCancelled() async throws {
        let url = try pdf()
        let task = _Concurrency.Task { await SlideRenderer.image(pdf: url, pageNumber: 1, maxPixel: 2048) }
        task.cancel()
        // Ob das Bild noch fertig wird oder nicht: Der Aufruf kehrt zurück und stürzt nicht ab
        _ = await task.value
    }
}

@MainActor
final class SlideSupportTests: XCTestCase {
    private func image() -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 4, height: 4)).image { context in
            UIColor.blue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
        }
    }

    // MARK: Bilder im Speicher

    func testTheCacheHoldsAtMostThreeImagesAndDropsTheOldestFirst() {
        let cache = SlideImageCache(capacity: 3)
        for key in ["a", "b", "c"] {
            cache.store(image(), for: key)
        }
        // Zugriff auf `a` macht es zum jüngsten
        XCTAssertNotNil(cache.image(for: "a"))
        cache.store(image(), for: "d")
        XCTAssertEqual(cache.count, 3)
        XCTAssertNil(cache.image(for: "b"))
        XCTAssertNotNil(cache.image(for: "a"))
        XCTAssertNotNil(cache.image(for: "c"))
        XCTAssertNotNil(cache.image(for: "d"))
    }

    func testAMemoryWarningKeepsOnlyTheVisibleImage() {
        let cache = SlideImageCache(capacity: 3)
        for key in ["a", "b", "c"] {
            cache.store(image(), for: key)
        }
        cache.purge(keeping: "b")
        XCTAssertEqual(cache.count, 1)
        XCTAssertNotNil(cache.image(for: "b"))
        cache.purge(keeping: nil)
        XCTAssertEqual(cache.count, 0)
    }

    // MARK: Folienwechsel während eines Strichs

    private let one = SlideRef(id: "s1", index: 1, widthPt: 960, heightPt: 540)
    private let two = SlideRef(id: "s2", index: 2, widthPt: 960, heightPt: 540)
    private let three = SlideRef(id: "s3", index: 3, widthPt: 960, heightPt: 540)

    func testASlideChangeAppliesAtOnceWhenThePenIsUp() {
        let gate = SlideSwitchGate()
        XCTAssertEqual(gate.slideChanged(one), one)
        XCTAssertNil(gate.pending)
    }

    func testTwoChangesDuringAStrokeGiveExactlyOneSwitchToTheLastSlide() {
        let gate = SlideSwitchGate()
        gate.toolBegan()
        XCTAssertNil(gate.slideChanged(two))
        XCTAssertNil(gate.slideChanged(three))
        XCTAssertEqual(gate.toolEnded(), three)
        // Danach ist nichts mehr zurückgestellt
        XCTAssertNil(gate.toolEnded())
        XCTAssertNil(gate.pending)
    }

    func testReleasingAfterTheStrokeHandsTheSlideToTheView() {
        let gate = SlideSwitchGate()
        gate.toolBegan()
        _ = gate.slideChanged(two)
        _ = gate.slideChanged(three)
        gate.finishTool()
        XCTAssertEqual(gate.releases, 1)
        XCTAssertEqual(gate.takeReleased(), three)
        XCTAssertNil(gate.takeReleased())
        // Ein Strich ohne Wechsel gibt nichts frei
        gate.toolBegan()
        gate.finishTool()
        XCTAssertEqual(gate.releases, 1)
    }

    func testResetForgetsAPendingSlide() {
        let gate = SlideSwitchGate()
        gate.toolBegan()
        _ = gate.slideChanged(two)
        gate.reset()
        XCTAssertNil(gate.toolEnded())
        XCTAssertEqual(gate.slideChanged(three), three)
    }

    // MARK: Hintergrund

    private func makeSupport(online: Bool, transport: FakeTransport, folder: URL) -> SlideSupport {
        let feed = FakeFeed()
        let follower = SessionFollower(feed: feed, backend: FakeFollowerBackend())
        let decks = SlideDeckStore(
            directory: folder,
            client: Fixtures.client(transport),
            access: { (endpoint: Fixtures.endpoint, token: Fixtures.token) },
            canReach: { online }
        )
        return SlideSupport(follower: follower, decks: decks)
    }

    func testTheBackgroundLoadsTheDeckRendersTheSlideAndCachesIt() async throws {
        let pdf = TestPDF.make(pages: [CGSize(width: 960, height: 540), CGSize(width: 960, height: 540)])
        let json = """
            {"deck":{"id":"deck-1","sha256":"\(TestPDF.sha256(pdf))"},"slides":[
            {"id":"s1","index":1,"width_pt":960,"height_pt":540},{"id":"s2","index":2,"width_pt":960,"height_pt":540}]}
            """
        let transport = FakeTransport([.http(status: 200, body: json)])
        transport.downloadData = pdf
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("bg-\(UUID().uuidString)")
        let support = makeSupport(online: true, transport: transport, folder: folder)
        let model = SlideBackgroundModel(support: support, canReach: { true })

        model.show(slideID: "s2", deckHint: "deck-1")
        XCTAssertEqual(model.state, .loading)
        XCTAssertEqual(model.statusText, "Folie wird geladen …")
        let ready = await eventually { model.state == .ready }
        XCTAssertTrue(ready)
        XCTAssertNotNil(model.image)
        XCTAssertLessThanOrEqual(max(model.image?.size.width ?? 0, model.image?.size.height ?? 0), 2048)
        XCTAssertEqual(support.images.count, 1)
        XCTAssertNil(model.statusText)

        // Dieselbe Folie noch einmal: sofort aus dem Speicher, ohne Lücke
        model.show(slideID: "s1", deckHint: "deck-1")
        let other = await eventually { model.state == .ready && support.images.count == 2 }
        XCTAssertTrue(other)
        model.show(slideID: "s2", deckHint: "deck-1")
        XCTAssertEqual(model.state, .ready)

        // Freie Seite: kein Bild
        model.show(slideID: nil, deckHint: "deck-1")
        XCTAssertNil(model.image)
        XCTAssertEqual(model.state, .none)
        XCTAssertEqual(transport.downloadRequests.count, 1)
    }

    func testAMissingSlideOfflineShowsPaperWithANoteAndOnlineAFailure() async {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("bg-\(UUID().uuidString)")
        let offline = makeSupport(online: false, transport: FakeTransport([.http(status: 200, body: "{}")]), folder: folder)
        let model = SlideBackgroundModel(support: offline, canReach: { false })
        model.show(slideID: "s1", deckHint: "deck-1")
        let noted = await eventually { model.state == .offline }
        XCTAssertTrue(noted)
        XCTAssertEqual(model.statusText, "Folie nicht auf dem iPad")
        XCTAssertNil(model.image)

        let online = makeSupport(
            online: true, transport: FakeTransport([.http(status: 404, body: Fixtures.apiError("not_found"))]),
            folder: folder)
        let second = SlideBackgroundModel(support: online, canReach: { true })
        second.show(slideID: "s1", deckHint: "deck-1")
        let failed = await eventually { second.state == .failed }
        XCTAssertTrue(failed)
    }
}
