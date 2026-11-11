import XCTest

@testable import StudienGehirn

final class InkStrokeTrackerTests: XCTestCase {
    private func footprint(_ fingerprint: UInt64, look signature: UInt64 = 1) -> InkStrokeFootprint {
        InkStrokeFootprint(fingerprint: fingerprint, signature: signature)
    }

    /// Zählt IDs hoch, damit die Erwartungen lesbar bleiben
    private final class Counter {
        private var next = 0
        func makeID() -> String {
            next += 1
            return "id-\(next)"
        }
    }

    func testNewStrokesGetIDsInOrder() {
        var tracker = InkStrokeTracker()
        let counter = Counter()
        let diff = tracker.update([footprint(10), footprint(20)], makeID: counter.makeID)

        XCTAssertEqual(
            diff.upserts,
            [
                .init(index: 0, clientID: "id-1", isNew: true),
                .init(index: 1, clientID: "id-2", isNew: true),
            ]
        )
        XCTAssertEqual(diff.removed, [])
        XCTAssertEqual(diff.clientIDs, ["id-1", "id-2"])
    }

    func testUnchangedStrokesProduceNoChange() {
        var tracker = InkStrokeTracker()
        let counter = Counter()
        _ = tracker.update([footprint(10), footprint(20)], makeID: counter.makeID)
        let diff = tracker.update([footprint(10), footprint(20)], makeID: counter.makeID)

        XCTAssertTrue(diff.isEmpty)
        XCTAssertEqual(diff.clientIDs, ["id-1", "id-2"])
    }

    func testOrderOfStrokesDoesNotMatter() {
        var tracker = InkStrokeTracker()
        let counter = Counter()
        _ = tracker.update([footprint(10), footprint(20)], makeID: counter.makeID)
        let diff = tracker.update([footprint(20), footprint(10)], makeID: counter.makeID)

        XCTAssertTrue(diff.isEmpty)
        XCTAssertEqual(diff.clientIDs, ["id-2", "id-1"])
    }

    func testMovedOrRecoloredStrokeKeepsItsID() {
        var tracker = InkStrokeTracker()
        let counter = Counter()
        _ = tracker.update([footprint(10), footprint(20)], makeID: counter.makeID)
        // Lasso oder Umfärben: gleicher Fingerabdruck, anderes Aussehen → nur stroke.add mit gleicher ID
        let diff = tracker.update([footprint(10), footprint(20, look: 2)], makeID: counter.makeID)

        XCTAssertEqual(diff.upserts, [.init(index: 1, clientID: "id-2", isNew: false)])
        XCTAssertEqual(diff.removed, [])

        // Danach ist der neue Stand der bekannte
        XCTAssertTrue(tracker.update([footprint(10), footprint(20, look: 2)], makeID: counter.makeID).isEmpty)
    }

    func testVanishedStrokesAreRemoved() {
        var tracker = InkStrokeTracker()
        let counter = Counter()
        _ = tracker.update([footprint(10), footprint(20), footprint(30)], makeID: counter.makeID)
        let diff = tracker.update([footprint(20)], makeID: counter.makeID)

        XCTAssertEqual(diff.upserts, [])
        XCTAssertEqual(diff.removed, ["id-1", "id-3"])
        XCTAssertEqual(diff.clientIDs, ["id-2"])
    }

    func testCopiesWithTheSameFingerprintGetTheirOwnIDs() {
        var tracker = InkStrokeTracker()
        let counter = Counter()
        _ = tracker.update([footprint(10)], makeID: counter.makeID)
        // Kopierter Strich: gleicher Fingerabdruck, an anderer Stelle
        let diff = tracker.update([footprint(10), footprint(10, look: 2)], makeID: counter.makeID)

        XCTAssertEqual(diff.upserts, [.init(index: 1, clientID: "id-2", isNew: true)])
        XCTAssertEqual(diff.clientIDs, ["id-1", "id-2"])

        // Die Kopie verschwindet wieder
        let after = tracker.update([footprint(10)], makeID: counter.makeID)
        XCTAssertEqual(after.removed, ["id-2"])
    }

    func testSurvivesSavingAndLoading() throws {
        var tracker = InkStrokeTracker()
        let counter = Counter()
        _ = tracker.update([footprint(10), footprint(UInt64.max)], makeID: counter.makeID)

        let data = try JSONEncoder().encode(InkPageTrackers(ink: tracker, highlight: InkStrokeTracker()))
        var restored = try JSONDecoder().decode(InkPageTrackers.self, from: data)
        XCTAssertEqual(restored.ink, tracker)

        let diff = restored.ink.update([footprint(10), footprint(UInt64.max)], makeID: counter.makeID)
        XCTAssertTrue(diff.isEmpty)
        XCTAssertEqual(diff.clientIDs, ["id-1", "id-2"])
    }

    // MARK: Fingerabdruck

    private func sample(transform: [Double] = [1, 0, 0, 1, 0, 0], color: InkRGBA = InkRGBA(red: 1, green: 2, blue: 3))
        -> InkStrokeSample
    {
        InkStrokeSample(
            tool: .pen,
            layer: .ink,
            color: color,
            width: 2.4,
            createdAt: Date(timeIntervalSince1970: 1_762_246_500),
            transform: transform,
            points: [
                InkPointSample(x: 10, y: 20, timeOffset: 0, force: 1, azimuth: 0, altitude: 1),
                InkPointSample(x: 11, y: 21, timeOffset: 0.01, force: 1, azimuth: 0, altitude: 1),
            ]
        )
    }

    func testMovingOrRecoloringChangesOnlyTheSignature() {
        let original = InkStrokeFootprint(sample: sample())
        let moved = InkStrokeFootprint(sample: sample(transform: [1, 0, 0, 1, 50, 20]))
        let recolored = InkStrokeFootprint(sample: sample(color: InkRGBA(red: 9, green: 9, blue: 9)))

        XCTAssertEqual(moved.fingerprint, original.fingerprint)
        XCTAssertNotEqual(moved.signature, original.signature)
        XCTAssertEqual(recolored.fingerprint, original.fingerprint)
        XCTAssertNotEqual(recolored.signature, original.signature)
        XCTAssertEqual(InkStrokeFootprint(sample: sample()), original)
    }

    func testDifferentStrokesHaveDifferentFingerprints() {
        var other = sample()
        other.points[0].x = 10.5
        XCTAssertNotEqual(InkStrokeFootprint(sample: other).fingerprint, InkStrokeFootprint(sample: sample()).fingerprint)

        var later = sample()
        later.createdAt = later.createdAt.addingTimeInterval(0.001)
        XCTAssertNotEqual(InkStrokeFootprint(sample: later).fingerprint, InkStrokeFootprint(sample: sample()).fingerprint)
    }

    func testStableHasherMatchesFNV1a() {
        // Bekannter Testwert: FNV-1a (64 Bit) von "a"
        var hasher = InkStableHasher()
        hasher.addByte(UInt8(ascii: "a"))
        XCTAssertEqual(hasher.value, 0xaf63_dc4c_8601_ec8c)
    }
}
