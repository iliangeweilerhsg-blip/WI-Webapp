import PencilKit
import XCTest

@testable import StudienGehirn

final class InkStrokeTrackerRetiredTests: XCTestCase {
    private func footprint(_ fingerprint: UInt64, look signature: UInt64 = 1) -> InkStrokeFootprint {
        InkStrokeFootprint(fingerprint: fingerprint, signature: signature)
    }

    private final class Counter {
        private(set) var made = 0
        func makeID() -> String {
            made += 1
            return "id-\(made)"
        }
    }

    func testUndoOfAnErasureKeepsTheClientID() {
        var tracker = InkStrokeTracker()
        let counter = Counter()
        _ = tracker.update([footprint(10)], makeID: counter.makeID)

        // Radieren
        let erased = tracker.update([], makeID: counter.makeID)
        XCTAssertEqual(erased.removed, ["id-1"])

        // Rückgängig: derselbe Strich, dieselbe ID, als Upsert gemeldet
        let undone = tracker.update([footprint(10)], makeID: counter.makeID)
        XCTAssertEqual(undone.upserts, [.init(index: 0, clientID: "id-1", isNew: true)])
        XCTAssertEqual(undone.removed, [])
        XCTAssertEqual(counter.made, 1)

        // Wiederholen (Radieren erneut) und noch einmal zurück
        _ = tracker.update([], makeID: counter.makeID)
        let again = tracker.update([footprint(10)], makeID: counter.makeID)
        XCTAssertEqual(again.upserts.map(\.clientID), ["id-1"])
        XCTAssertEqual(counter.made, 1)
        XCTAssertTrue(tracker.retired.isEmpty)
    }

    func testCopiesWithTheSameFingerprintKeepTheirOwnIDs() {
        var tracker = InkStrokeTracker()
        let counter = Counter()
        let both = tracker.update([footprint(10), footprint(10)], makeID: counter.makeID)
        XCTAssertEqual(both.clientIDs, ["id-1", "id-2"])

        let one = tracker.update([footprint(10)], makeID: counter.makeID)
        XCTAssertEqual(one.removed, ["id-2"])

        let back = tracker.update([footprint(10), footprint(10)], makeID: counter.makeID)
        XCTAssertEqual(back.clientIDs, ["id-1", "id-2"])
        XCTAssertEqual(counter.made, 2)
    }

    func testRetiredStrokesAreLimited() throws {
        var tracker = InkStrokeTracker()
        let counter = Counter()
        for index in 0..<(InkStrokeTracker.retiredLimit + 100) {
            _ = tracker.update([footprint(UInt64(index) + 1)], makeID: counter.makeID)
            _ = tracker.update([], makeID: counter.makeID)
        }
        XCTAssertEqual(tracker.retired.count, InkStrokeTracker.retiredLimit)
        XCTAssertEqual(tracker.retiredOrder.count, InkStrokeTracker.retiredLimit)

        // Die ältesten sind herausgefallen: Der erste Strich bekommt eine neue ID
        let first = tracker.update([footprint(1)], makeID: counter.makeID)
        XCTAssertEqual(first.upserts.first?.clientID, "id-\(counter.made)")
        XCTAssertNotEqual(first.upserts.first?.clientID, "id-1")

        // Der jüngste ist noch da
        _ = tracker.update([], makeID: counter.makeID)
        let last = tracker.update([footprint(UInt64(InkStrokeTracker.retiredLimit + 100))], makeID: counter.makeID)
        XCTAssertEqual(last.upserts.first?.clientID, "id-\(InkStrokeTracker.retiredLimit + 100)")
    }

    func testRoundTripKeepsRetiredStrokes() throws {
        var tracker = InkStrokeTracker()
        let counter = Counter()
        _ = tracker.update([footprint(10), footprint(20)], makeID: counter.makeID)
        _ = tracker.update([footprint(20)], makeID: counter.makeID)
        XCTAssertEqual(tracker.retired.count, 1)

        let data = try JSONEncoder().encode(tracker)
        let decoded = try JSONDecoder().decode(InkStrokeTracker.self, from: data)
        XCTAssertEqual(decoded, tracker)

        var restored = decoded
        let diff = restored.update([footprint(10), footprint(20)], makeID: counter.makeID)
        XCTAssertEqual(diff.clientIDs, ["id-1", "id-2"])
    }

    func testLoadsTheOldIDsFile() throws {
        let old = """
            {"entries":{"a#0":{"clientID":"alt-1","signature":"1"},"b#0":{"clientID":"alt-2","signature":"2"}}}
            """
        let tracker = try JSONDecoder().decode(InkStrokeTracker.self, from: Data(old.utf8))
        XCTAssertEqual(tracker.entries.count, 2)
        XCTAssertEqual(tracker.entries["a#0"]?.clientID, "alt-1")
        XCTAssertTrue(tracker.retired.isEmpty)
        XCTAssertTrue(tracker.retiredOrder.isEmpty)

        let pageOld = """
            {"ink":\(old),"highlight":{"entries":{}}}
            """
        let trackers = try JSONDecoder().decode(InkPageTrackers.self, from: Data(pageOld.utf8))
        XCTAssertEqual(trackers.ink.entries.count, 2)
        XCTAssertTrue(trackers.highlight.entries.isEmpty)
    }
}

final class InkPageSyncModelTests: XCTestCase {
    @MainActor
    private func makeStroke(
        _ inkType: PKInkingTool.InkType = .pen,
        y: CGFloat = 100,
        createdAt: TimeInterval = 1_762_246_500
    ) -> PKStroke {
        let points = (0..<6).map { index in
            PKStrokePoint(
                location: CGPoint(x: 100 + CGFloat(index) * 10, y: y),
                timeOffset: TimeInterval(index) * 0.016,
                size: CGSize(width: 3, height: 3),
                opacity: 1,
                force: 1,
                azimuth: 0,
                altitude: .pi / 2
            )
        }
        let path = PKStrokePath(controlPoints: points, creationDate: Date(timeIntervalSince1970: createdAt))
        return PKStroke(ink: PKInk(inkType, color: .black), path: path)
    }

    @MainActor
    private func makeModel(_ store: FakeInkPageStore = FakeInkPageStore(), outboxMark: Int = 0) -> InkPageModel {
        InkPageModel(pageID: "seite-1", store: store, saveDelay: .seconds(3600), outboxMark: outboxMark)
    }

    private func describe(_ changes: [InkStrokeChange]) -> [String] {
        changes.map { change in
            switch change {
            case .upsert(let stroke): return "up:\(stroke.clientID)"
            case .remove(let ids): return "rm:\(ids.joined(separator: ","))"
            }
        }
    }

    @MainActor
    func testStrokeEraseAndUndoReportTheSameClientID() throws {
        let model = makeModel()
        var changes: [InkStrokeChange] = []
        model.onStrokeChanges = { changes.append(contentsOf: $0) }

        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [makeStroke()]))
        guard case .upsert(let stroke)? = changes.first else { return XCTFail("stroke.add erwartet") }
        let a = stroke.clientID

        model.canvasDidChange(layer: .ink, drawing: PKDrawing())
        model.undo()

        XCTAssertEqual(describe(changes), ["up:\(a)", "rm:\(a)", "up:\(a)"])

        // Wiederholen radiert erneut, noch ein Rückgängig bringt den Strich mit derselben ID zurück
        model.redo()
        model.undo()
        XCTAssertEqual(
            describe(changes), ["up:\(a)", "rm:\(a)", "up:\(a)", "rm:\(a)", "up:\(a)"])
    }

    @MainActor
    func testLoadingStrokesWithoutIDsRequestsAReconcile() {
        let store = FakeInkPageStore()
        var snapshot = InkPageSnapshot()
        snapshot.ink = PKDrawing(strokes: [makeStroke()]).dataRepresentation()
        store.snapshots["seite-1"] = snapshot

        let model = makeModel(store)
        XCTAssertTrue(model.needsReconcile)
        XCTAssertEqual(model.neutralStrokes().count, 1)
    }

    @MainActor
    func testACleanLoadNeedsNoReconcile() {
        let store = FakeInkPageStore()
        let first = makeModel(store)
        first.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [makeStroke()]))
        first.saveNow()

        let second = makeModel(store)
        XCTAssertFalse(second.needsReconcile)
    }

    @MainActor
    func testQueueAheadOfTheSavedPageRequestsAReconcile() {
        let store = FakeInkPageStore()
        var snapshot = InkPageSnapshot()
        snapshot.outboxNumber = 3
        store.snapshots["seite-1"] = snapshot

        XCTAssertFalse(makeModel(store, outboxMark: 3).needsReconcile)
        XCTAssertTrue(makeModel(store, outboxMark: 4).needsReconcile)
    }

    @MainActor
    func testSaveRemembersTheQueueNumberAndTheReconcileFlag() {
        let store = FakeInkPageStore()
        let model = makeModel(store)
        model.outboxNumberProvider = { 7 }
        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [makeStroke()]))
        model.markNeedsReconcile()
        model.saveNow()
        XCTAssertEqual(store.snapshots["seite-1"]?.outboxNumber, 7)
        XCTAssertEqual(store.snapshots["seite-1"]?.needsReconcile, true)

        model.reconcileFinished()
        model.saveNow()
        XCTAssertEqual(store.snapshots["seite-1"]?.needsReconcile, false)
        XCTAssertFalse(model.needsReconcile)
    }
}

final class InkPageStoreFileTests: XCTestCase {
    private func makeRoot() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("ink-test-\(UUID().uuidString)", isDirectory: true)
    }

    private func trackers() -> InkPageTrackers {
        var trackers = InkPageTrackers()
        var next = 0
        _ = trackers.ink.update([InkStrokeFootprint(fingerprint: 10, signature: 1)]) {
            next += 1
            return "id-\(next)"
        }
        _ = trackers.highlight.update([InkStrokeFootprint(fingerprint: 20, signature: 2)]) {
            next += 1
            return "id-\(next)"
        }
        _ = trackers.highlight.update([]) { "unbenutzt" }
        return trackers
    }

    func testRoundTrip() throws {
        let store = FileInkPageStore(root: makeRoot())
        let snapshot = InkPageSnapshot(
            ink: Data([1, 2, 3]),
            highlight: nil,
            trackers: trackers(),
            outboxNumber: 42,
            needsReconcile: true
        )
        try store.save(snapshot, pageID: "seite-1")
        XCTAssertEqual(store.load(pageID: "seite-1"), snapshot)
    }

    func testEmptyLayersStayEmpty() throws {
        let store = FileInkPageStore(root: makeRoot())
        try store.save(InkPageSnapshot(), pageID: "seite-1")
        let loaded = store.load(pageID: "seite-1")
        XCTAssertNil(loaded.ink)
        XCTAssertNil(loaded.highlight)
        XCTAssertEqual(loaded.outboxNumber, 0)
        XCTAssertFalse(loaded.needsReconcile)
    }

    func testMigratesFromTheOldThreeFiles() throws {
        let root = makeRoot()
        let folder = root.appendingPathComponent("seite-1", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let oldTrackers = trackers()
        try Data([9, 9]).write(to: folder.appendingPathComponent("ink.pkdrawing"))
        try Data([8]).write(to: folder.appendingPathComponent("highlight.pkdrawing"))
        try JSONEncoder().encode(oldTrackers).write(to: folder.appendingPathComponent("ids.json"))

        let store = FileInkPageStore(root: root)
        let loaded = store.load(pageID: "seite-1")
        XCTAssertEqual(loaded.ink, Data([9, 9]))
        XCTAssertEqual(loaded.highlight, Data([8]))
        XCTAssertEqual(loaded.trackers, oldTrackers)
        XCTAssertEqual(loaded.outboxNumber, 0)

        // Laden löscht noch nichts
        XCTAssertTrue(FileManager.default.fileExists(atPath: folder.appendingPathComponent("ids.json").path))

        // Nach dem ersten erfolgreichen Speichern sind die alten Dateien weg
        try store.save(loaded, pageID: "seite-1")
        XCTAssertTrue(FileManager.default.fileExists(atPath: folder.appendingPathComponent("page.plist").path))
        for name in ["ink.pkdrawing", "highlight.pkdrawing", "ids.json"] {
            XCTAssertFalse(FileManager.default.fileExists(atPath: folder.appendingPathComponent(name).path), name)
        }
        XCTAssertEqual(store.load(pageID: "seite-1"), loaded)
    }

    func testKeepsOutboxNumberAcrossSaves() throws {
        let store = FileInkPageStore(root: makeRoot())
        var snapshot = InkPageSnapshot()
        snapshot.outboxNumber = 5
        try store.save(snapshot, pageID: "seite-1")
        snapshot.ink = Data([1])
        try store.save(snapshot, pageID: "seite-1")
        XCTAssertEqual(store.load(pageID: "seite-1").outboxNumber, 5)
    }
}
