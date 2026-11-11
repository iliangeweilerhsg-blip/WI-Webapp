import XCTest

@testable import StudienGehirn

final class InkStrokeCodecTests: XCTestCase {
    /// Zwei Punkte, mit dem Python-Referenzpacker aus `tests/fixtures/strokes` erzeugt:
    /// `struct.pack('<6f', 10.5, 20.25, 0, 0.5, 1.0, 1.5) + struct.pack('<6f', 11, 21, 16, 1, -1, 0.25)`
    private let referenceBase64 = "AAAoQQAAokEAAAAAAAAAPwAAgD8AAMA/AAAwQQAAqEEAAIBBAACAPwAAgL8AAIA+"
    private let referencePoints = [
        InkPackedPoint(x: 10.5, y: 20.25, dt: 0, force: 0.5, azimuth: 1.0, altitude: 1.5),
        InkPackedPoint(x: 11, y: 21, dt: 16, force: 1, azimuth: -1, altitude: 0.25),
    ]

    private let createdAt = Date(timeIntervalSince1970: 1_762_246_500)

    private func point(_ x: Double, _ y: Double, t: Double = 0, force: Double = 2) -> InkPointSample {
        InkPointSample(x: x, y: y, timeOffset: t, force: force, azimuth: 0.5, altitude: 1.0)
    }

    private func sample(
        tool: StrokeTool = .pen,
        layer: StrokeLayer = .ink,
        color: InkRGBA = InkRGBA(red: 0x18, green: 0x64, blue: 0xAB),
        width: Double = 2.8,
        transform: [Double] = InkStrokeCodec.identityTransform,
        points: [InkPointSample]? = nil
    ) -> InkStrokeSample {
        InkStrokeSample(
            tool: tool,
            layer: layer,
            color: color,
            width: width,
            createdAt: createdAt,
            transform: transform,
            points: points ?? [point(100, 150, t: 2.0), point(300, 180, t: 2.25)]
        )
    }

    // MARK: Punkte

    func testPacksPointsLikeTheReference() {
        XCTAssertEqual(InkStrokeCodec.packPoints(referencePoints), referenceBase64)
    }

    func testUnpacksTheReference() throws {
        XCTAssertEqual(try InkStrokeCodec.unpackPoints(referenceBase64), referencePoints)
    }

    func testOnePointIsThirtyTwoCharactersWithoutPadding() {
        let packed = InkStrokeCodec.packPoints([referencePoints[0]])
        XCTAssertEqual(packed.count, 32)
        XCTAssertFalse(packed.contains("="))
    }

    func testUnpackRejectsBrokenData() {
        XCTAssertThrowsError(try InkStrokeCodec.unpackPoints("kein base64!")) { error in
            XCTAssertEqual(error as? InkCodecError, .notBase64)
        }
        XCTAssertThrowsError(try InkStrokeCodec.unpackPoints("")) { error in
            XCTAssertEqual(error as? InkCodecError, .badLength(0))
        }
        XCTAssertThrowsError(try InkStrokeCodec.unpackPoints("AAAA")) { error in
            XCTAssertEqual(error as? InkCodecError, .badLength(3))
        }
    }

    func testNormalizeStartsAtZeroNeverGoesBackAndClampsForce() {
        let options = InkCodecOptions(forceDivisor: 4)
        let points = InkStrokeCodec.normalize(
            [
                point(0, 0, t: 0.5, force: 0),
                point(1, 0, t: 0.516, force: 2),
                point(2, 0, t: 0.510, force: 10),
                point(3, 0, t: 0.6, force: -1),
            ],
            options: options
        )
        XCTAssertEqual(points.count, 4)
        XCTAssertEqual(points[0].dt, 0)
        XCTAssertEqual(points[1].dt, 16, accuracy: 0.01)
        XCTAssertEqual(points[2].dt, points[1].dt)
        XCTAssertEqual(points[3].dt, 100, accuracy: 0.01)
        XCTAssertEqual(points.map(\.force), [0, 0.5, 1, 0])
    }

    func testThinKeepsFirstAndLastPoint() {
        let points = (0..<10).map { point(Double($0), 0) }
        let thinned = InkStrokeCodec.thin(points, to: 4)
        XCTAssertEqual(thinned.count, 4)
        XCTAssertEqual(thinned.first?.x, 0)
        XCTAssertEqual(thinned.last?.x, 9)
        XCTAssertEqual(InkStrokeCodec.thin(points, to: 20), points)
    }

    func testLongStrokesStayBelowTheCoreLimit() throws {
        let points = (0..<50).map { point(Double($0), 0, t: Double($0) * 0.01) }
        let options = InkCodecOptions(maxPoints: 20)
        let stroke = try XCTUnwrap(
            InkStrokeCodec.encode(sample(points: points), clientID: "id", options: options))
        let unpacked = try InkStrokeCodec.unpackPoints(stroke.points)
        XCTAssertEqual(unpacked.count, 20)
        XCTAssertEqual(unpacked.last?.x, 49)
        XCTAssertEqual(InkStrokeCodec.maxPointsPerStroke * InkStrokeCodec.bytesPerPoint, 750_000)
    }

    // MARK: Strich

    func testEncodesAllFieldsOfTheSchema() throws {
        let stroke = try XCTUnwrap(
            InkStrokeCodec.encode(sample(), clientID: "019a4e13-9ea0-760e-8a70-2e469682a530"))

        XCTAssertEqual(stroke.clientID, "019a4e13-9ea0-760e-8a70-2e469682a530")
        XCTAssertEqual(stroke.tool, .pen)
        XCTAssertEqual(stroke.layer, .ink)
        XCTAssertEqual(stroke.color, "#1864ABFF")
        XCTAssertEqual(stroke.width, 2.8)
        XCTAssertEqual(stroke.createdAt, 1_762_246_500_000)
        XCTAssertEqual(stroke.transform, [1, 0, 0, 1, 0, 0])
        // Außerhalb einer Session gibt es keine Sitzungszeit
        XCTAssertNil(stroke.tStartMS)
        XCTAssertNil(stroke.tEndMS)

        let points = try InkStrokeCodec.unpackPoints(stroke.points)
        XCTAssertEqual(points.count, 2)
        XCTAssertEqual(points[0].x, 100)
        XCTAssertEqual(points[0].y, 150)
        XCTAssertEqual(points[0].dt, 0)
        XCTAssertEqual(points[1].dt, 250, accuracy: 0.01)
        XCTAssertEqual(points[0].azimuth, 0.5)
        XCTAssertEqual(points[0].altitude, 1.0)
    }

    func testBoundingBoxIsAfterTransformWithHalfWidth() throws {
        // Lasso-Verschiebung um 50/20: Die Punkte bleiben, transform und bbox ändern sich (08 §4.2)
        let moved = try XCTUnwrap(
            InkStrokeCodec.encode(sample(transform: [1, 0, 0, 1, 50, 20]), clientID: "id"))
        let still = try XCTUnwrap(InkStrokeCodec.encode(sample(), clientID: "id"))

        XCTAssertEqual(moved.points, still.points)
        XCTAssertEqual(still.bbox.count, 4)
        XCTAssertEqual(still.bbox[0], 98.6, accuracy: 0.001)
        XCTAssertEqual(still.bbox[1], 148.6, accuracy: 0.001)
        XCTAssertEqual(still.bbox[2], 202.8, accuracy: 0.001)
        XCTAssertEqual(still.bbox[3], 32.8, accuracy: 0.001)
        XCTAssertEqual(moved.bbox[0], 148.6, accuracy: 0.001)
        XCTAssertEqual(moved.bbox[1], 168.6, accuracy: 0.001)
        XCTAssertEqual(moved.bbox[2], 202.8, accuracy: 0.001)
        XCTAssertEqual(moved.bbox[3], 32.8, accuracy: 0.001)
    }

    func testSessionTimesComeFromTheSessionStart() throws {
        let started = Date(timeIntervalSince1970: 1_762_246_200)
        let stroke = try XCTUnwrap(
            InkStrokeCodec.encode(sample(), clientID: "id", sessionStartedAt: started))
        XCTAssertEqual(stroke.tStartMS, 300_000)
        // t_end − t_start entspricht dem dt des letzten Punkts
        XCTAssertEqual(stroke.tEndMS, 300_250)
    }

    func testMarkerBecomesTranslucentOnTheHighlightLayer() throws {
        let yellow = InkRGBA(red: 0xFF, green: 0xE0, blue: 0x66)
        let marker = try XCTUnwrap(
            InkStrokeCodec.encode(
                sample(tool: .marker, layer: .highlight, color: yellow, width: 18), clientID: "id"))
        XCTAssertEqual(marker.color, "#FFE06666")
        XCTAssertEqual(marker.layer, .highlight)

        // Eine schon durchscheinende Farbe bleibt, wie sie ist
        let custom = try XCTUnwrap(
            InkStrokeCodec.encode(
                sample(tool: .marker, layer: .highlight, color: yellow.withAlpha(0x80), width: 18),
                clientID: "id"))
        XCTAssertEqual(custom.color, "#FFE06680")

        // Stifte bleiben deckend
        let pen = try XCTUnwrap(InkStrokeCodec.encode(sample(color: yellow), clientID: "id"))
        XCTAssertEqual(pen.color, "#FFE066FF")
    }

    func testRejectsStrokesTheCoreWouldRefuse() {
        XCTAssertNil(InkStrokeCodec.encode(sample(points: []), clientID: "id"))
        XCTAssertNil(InkStrokeCodec.encode(sample(width: 0), clientID: "id"))
        XCTAssertNil(InkStrokeCodec.encode(sample(width: .nan), clientID: "id"))
        XCTAssertNil(InkStrokeCodec.encode(sample(transform: [1, 0, 0, 1, 0]), clientID: "id"))
        XCTAssertNil(InkStrokeCodec.encode(sample(transform: [1, 0, 0, 1, .infinity, 0]), clientID: "id"))
        XCTAssertNil(InkStrokeCodec.encode(sample(points: [point(.nan, 0)]), clientID: "id"))
    }

    func testSinglePointStrokeIsValid() throws {
        let stroke = try XCTUnwrap(InkStrokeCodec.encode(sample(points: [point(10, 20)]), clientID: "id"))
        XCTAssertEqual(stroke.points.count, 32)
        XCTAssertEqual(stroke.bbox[2], 2.8, accuracy: 0.001)
        XCTAssertEqual(stroke.bbox[3], 2.8, accuracy: 0.001)
    }

    // MARK: JSON

    func testJSONHasEveryRequiredFieldAndExplicitNull() throws {
        let stroke = try XCTUnwrap(InkStrokeCodec.encode(sample(), clientID: "id"))
        let data = try SGSync.encode(stroke)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(
            Set(json.keys),
            [
                "client_id", "tool", "layer", "color", "width", "created_at", "t_start_ms", "t_end_ms",
                "transform", "bbox", "points",
            ]
        )
        // Pflichtfelder mit null werden ausgeschrieben, nicht weggelassen (VERTRAEGE §11.7)
        XCTAssertTrue(json["t_start_ms"] is NSNull)
        XCTAssertTrue(json["t_end_ms"] is NSNull)
        XCTAssertEqual(json["tool"] as? String, "pen")
        XCTAssertEqual(json["layer"] as? String, "ink")

        let decoded = try SGSync.decode(Stroke.self, from: data)
        XCTAssertEqual(decoded.points, stroke.points)
        XCTAssertEqual(decoded.createdAt, stroke.createdAt)
    }
}
