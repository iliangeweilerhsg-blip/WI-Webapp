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

    private func point(
        _ x: Double, _ y: Double, t: Double = 0, force: Double = 2, width: Double = 0, height: Double = 0
    ) -> InkPointSample {
        InkPointSample(
            x: x, y: y, timeOffset: t, force: force, azimuth: 0.5, altitude: 1.0, width: width, height: height)
    }

    /// n Punkte mit wechselnder Breite und Höhe (immer > 0)
    private func sizedPoints(_ count: Int) -> [InkPointSample] {
        (0..<count).map { index in
            point(
                Double(index % 500), Double(index / 500), t: Double(index) * 0.004, force: 1,
                width: 1 + Double(index % 7) * 0.5, height: 2 + Double(index % 5) * 0.25)
        }
    }

    private let sizesOn = InkCodecOptions(includeSizes: true)

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

    func testStrokeFromBeforeTheSessionStartsAtZero() throws {
        let started = createdAt.addingTimeInterval(60)
        let stroke = try XCTUnwrap(
            InkStrokeCodec.encode(sample(), clientID: "id", sessionStartedAt: started))
        XCTAssertEqual(stroke.tStartMS, 0)
        XCTAssertEqual(stroke.tEndMS, 250)
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


    // MARK: Größen je Punkt (VERTRAEGE §23)

    func testPacksSizesLikeTheExample() throws {
        // `packages/schemas/examples/valid/Stroke.mit-sizes.json`: drei Punkte, 24 Byte, ohne Padding
        let sizes = [
            InkPackedSize(width: 2, height: 2),
            InkPackedSize(width: 4.5, height: 3),
            InkPackedSize(width: 3, height: 3),
        ]
        let text = "AAAAQAAAAEAAAJBAAABAQAAAQEAAAEBA"
        XCTAssertEqual(InkStrokeCodec.packSizes(sizes), text)
        XCTAssertEqual(try InkStrokeCodec.unpackSizes(text), sizes)
    }

    func testSizesPaddingForOneTwoAndThreePoints() throws {
        let all = (0..<3).map { InkPackedSize(width: Float($0) + 1.5, height: Float($0) * 0.25 + 0.5) }
        for (count, padding) in [(1, "="), (2, "=="), (3, "")] {
            let sizes = Array(all.prefix(count))
            let text = InkStrokeCodec.packSizes(sizes)
            XCTAssertEqual(text.count, (count * InkStrokeCodec.bytesPerSize + 2) / 3 * 4, "\(count) Punkte")
            XCTAssertTrue(text.hasSuffix(padding), "\(count) Punkte: \(text)")
            if padding.isEmpty { XCTAssertFalse(text.contains("=")) }
            XCTAssertEqual(try InkStrokeCodec.unpackSizes(text), sizes, "Rückweg bei \(count) Punkten")
        }
        // Beispiel mit einem Punkt aus den Schemas: 3,2 und 3,2 als Float32
        XCTAssertEqual(
            InkStrokeCodec.packSizes([InkPackedSize(width: 3.2, height: 3.2)]), "zcxMQM3MTEA=")
    }

    func testUnpackSizesRejectsBrokenData() {
        XCTAssertThrowsError(try InkStrokeCodec.unpackSizes("kein base64!")) { error in
            XCTAssertEqual(error as? InkCodecError, .notBase64)
        }
        XCTAssertThrowsError(try InkStrokeCodec.unpackSizes("")) { error in
            XCTAssertEqual(error as? InkCodecError, .badLength(0))
        }
        // Vier Byte sind nur eine halbe Größe
        XCTAssertThrowsError(try InkStrokeCodec.unpackSizes("AAAAQA==")) { error in
            XCTAssertEqual(error as? InkCodecError, .badLength(5))
        }
    }

    func testPointsAreByteIdenticalWithAndWithoutSizes() throws {
        let points = sizedPoints(40)
        let plain = try XCTUnwrap(
            InkStrokeCodec.encode(sample(points: points), clientID: "id", sessionStartedAt: createdAt))
        let withSizes = try XCTUnwrap(
            InkStrokeCodec.encode(
                sample(points: points), clientID: "id", sessionStartedAt: createdAt, options: sizesOn))
        XCTAssertNil(plain.sizes)
        XCTAssertNotNil(withSizes.sizes)
        XCTAssertEqual(withSizes.points, plain.points)
        // Alles andere ist ebenfalls gleich: `sizes` ist das einzige zusätzliche Feld
        XCTAssertEqual(withSizes.bbox, plain.bbox)
        XCTAssertEqual(withSizes.width, plain.width)
        XCTAssertEqual(withSizes.transform, plain.transform)
        XCTAssertEqual(withSizes.tStartMS, plain.tStartMS)
        XCTAssertEqual(withSizes.tEndMS, plain.tEndMS)
        XCTAssertEqual(try SGSync.encode(withSizes.with(sizes: .some(nil))), try SGSync.encode(plain))
        // Auch `includeSizes = true` ohne Größen in der Erfassung ändert `points` nicht
        let noSizes = try XCTUnwrap(InkStrokeCodec.encode(sample(), clientID: "id", options: sizesOn))
        XCTAssertEqual(noSizes.points, try XCTUnwrap(InkStrokeCodec.encode(sample(), clientID: "id")).points)
    }

    func testSizesFollowThePointsInOrderAndValue() throws {
        let points = [
            point(1, 1, t: 0, width: 2, height: 2),
            point(2, 1, t: 0.01, width: 4.5, height: 3),
            point(3, 1, t: 0.02, width: 0, height: 0.5),
        ]
        let stroke = try XCTUnwrap(
            InkStrokeCodec.encode(sample(points: points), clientID: "id", options: sizesOn))
        let sizes = try InkStrokeCodec.unpackSizes(try XCTUnwrap(stroke.sizes))
        XCTAssertEqual(sizes.count, try InkStrokeCodec.unpackPoints(stroke.points).count)
        XCTAssertEqual(
            sizes,
            [
                InkPackedSize(width: 2, height: 2),
                InkPackedSize(width: 4.5, height: 3),
                InkPackedSize(width: 0, height: 0.5),
            ])
        // Das Feld steht im JSON, wenn es gesetzt ist, und fehlt (nicht `null`), wenn nicht
        let json = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: try SGSync.encode(stroke)) as? [String: Any])
        XCTAssertEqual(json["sizes"] as? String, stroke.sizes)
        let v1 = try XCTUnwrap(InkStrokeCodec.encode(sample(points: points), clientID: "id"))
        let v1JSON = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: try SGSync.encode(v1)) as? [String: Any])
        XCTAssertFalse(v1JSON.keys.contains("sizes"))
    }

    func testSizesWithOneTwoAndThreePointsAreValidBase64() throws {
        for count in 1...3 {
            let stroke = try XCTUnwrap(
                InkStrokeCodec.encode(sample(points: sizedPoints(count)), clientID: "id", options: sizesOn))
            let text = try XCTUnwrap(stroke.sizes)
            XCTAssertEqual(try InkStrokeCodec.unpackSizes(text).count, count)
            XCTAssertEqual(text.count % 4, 0)
        }
    }

    func testNoSizesWithoutTheOptionOrForBrokenValues() throws {
        let good = sizedPoints(5)
        // Option aus (Vorgabe)
        XCTAssertNil(try XCTUnwrap(InkStrokeCodec.encode(sample(points: good), clientID: "id")).sizes)
        XCTAssertFalse(InkCodecOptions.standard.includeSizes)

        func sizes(of points: [InkPointSample]) throws -> String? {
            try XCTUnwrap(InkStrokeCodec.encode(sample(points: points), clientID: "id", options: sizesOn)).sizes
        }
        func replacing(_ index: Int, width: Double, height: Double) -> [InkPointSample] {
            var points = good
            points[index].width = width
            points[index].height = height
            return points
        }
        XCTAssertNotNil(try sizes(of: good))
        // NaN, unendlich, negativ (Breite oder Höhe)
        XCTAssertNil(try sizes(of: replacing(2, width: .nan, height: 1)))
        XCTAssertNil(try sizes(of: replacing(2, width: 1, height: .nan)))
        XCTAssertNil(try sizes(of: replacing(2, width: .infinity, height: 1)))
        XCTAssertNil(try sizes(of: replacing(2, width: -0.5, height: 1)))
        XCTAssertNil(try sizes(of: replacing(2, width: 1, height: -0.5)))
        // Endlich als Double, aber nicht als Float
        XCTAssertNil(try sizes(of: replacing(2, width: 1e300, height: 1)))
        // Lauter Nullen (auch die Erfassung ohne Größen)
        XCTAssertNil(try sizes(of: good.map { point($0.x, $0.y, t: $0.timeOffset) }))
        // Eine Null am Ende ist erlaubt (auslaufende Spitze)
        XCTAssertNotNil(try sizes(of: replacing(4, width: 0, height: 0)))
        // Die Punkte bleiben in allen Fällen gleich
        let broken = try XCTUnwrap(
            InkStrokeCodec.encode(
                sample(points: replacing(2, width: .nan, height: 1)), clientID: "id", options: sizesOn))
        let plain = try XCTUnwrap(InkStrokeCodec.encode(sample(points: good), clientID: "id"))
        XCTAssertEqual(broken.points, plain.points)
    }

    func testNegativeZeroIsWrittenAsZero() throws {
        var points = sizedPoints(3)
        points[1].width = -0.0
        let stroke = try XCTUnwrap(InkStrokeCodec.encode(sample(points: points), clientID: "id", options: sizesOn))
        let sizes = try InkStrokeCodec.unpackSizes(try XCTUnwrap(stroke.sizes))
        XCTAssertEqual(sizes[1].width.bitPattern, 0)
    }

    func testSizesAt20000PointsButNotAt20001() throws {
        let limit = InkStrokeCodec.maxPointsWithSizes
        XCTAssertEqual(limit, 20_000)
        let at = try XCTUnwrap(
            InkStrokeCodec.encode(sample(points: sizedPoints(limit)), clientID: "id", options: sizesOn))
        let text = try XCTUnwrap(at.sizes)
        XCTAssertEqual(text.count, 853_336)
        XCTAssertEqual(try InkStrokeCodec.unpackSizes(text).count, limit)

        let over = try XCTUnwrap(
            InkStrokeCodec.encode(sample(points: sizedPoints(limit + 1)), clientID: "id", options: sizesOn))
        XCTAssertNil(over.sizes)
        // Die Punkte sind in beiden Fällen vollständig
        XCTAssertEqual(try InkStrokeCodec.unpackPoints(over.points).count, limit + 1)
    }

    func testThinnedStrokeGetsNoSizes() throws {
        // Würde ausgedünnt, passten Einträge und Punkte nicht mehr zusammen
        let points = (0..<50).map { point(Double($0), 0, t: Double($0) * 0.01, width: 2, height: 2) }
        let options = InkCodecOptions(maxPoints: 20, includeSizes: true)
        let stroke = try XCTUnwrap(InkStrokeCodec.encode(sample(points: points), clientID: "id", options: options))
        XCTAssertEqual(try InkStrokeCodec.unpackPoints(stroke.points).count, 20)
        XCTAssertNil(stroke.sizes)
    }

    // MARK: Sehr lange Striche (#382)

    func testStrokeAboveTheSendLimitIsThinnedAndKeepsFirstAndLastPoint() throws {
        // Das Format erlaubt 31 250 Punkte, das iPad sendet höchstens 29 000
        XCTAssertEqual(InkStrokeCodec.maxPointsPerStroke, 31_250)
        XCTAssertEqual(InkStrokeCodec.maxPointsSent, 29_000)
        XCTAssertEqual(InkCodecOptions.standard.maxPoints, InkStrokeCodec.maxPointsSent)
        let points = (0..<31_250).map { point(Double($0), Double($0 % 97), t: Double($0) * 0.004) }
        let stroke = try XCTUnwrap(InkStrokeCodec.encode(sample(points: points), clientID: "id"))
        let unpacked = try InkStrokeCodec.unpackPoints(stroke.points)
        XCTAssertEqual(unpacked.count, 29_000)
        XCTAssertEqual(unpacked.first?.x, 0)
        XCTAssertEqual(unpacked.last?.x, 31_249)
        // Bis zur Grenze bleibt alles unverändert
        let exact = try XCTUnwrap(
            InkStrokeCodec.encode(sample(points: Array(points.prefix(29_000))), clientID: "id"))
        XCTAssertEqual(try InkStrokeCodec.unpackPoints(exact.points).count, 29_000)
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
