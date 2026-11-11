import PencilKit
import XCTest

@testable import StudienGehirn

/// Seitenablage im Arbeitsspeicher
final class FakeInkPageStore: InkPageStore {
    var snapshots: [String: InkPageSnapshot] = [:]
    var failsOnSave = false
    private(set) var saveCount = 0

    func load(pageID: String) -> InkPageSnapshot {
        snapshots[pageID] ?? InkPageSnapshot()
    }

    func save(_ snapshot: InkPageSnapshot, pageID: String) throws {
        if failsOnSave { throw CocoaError(.fileWriteNoPermission) }
        saveCount += 1
        snapshots[pageID] = snapshot
    }
}

/// Zufall mit festem Ablauf, damit IDs im Test vorhersagbar sind
struct FixedRandom: RandomNumberGenerator {
    var state: UInt64

    mutating func next() -> UInt64 {
        state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        return state
    }
}

final class InkIDTests: XCTestCase {
    func testUUIDv7IsLowercaseWithVersionAndVariant() throws {
        let pattern = try NSRegularExpression(
            pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        for _ in 0..<50 {
            let id = InkID.uuidV7()
            let range = NSRange(id.startIndex..., in: id)
            XCTAssertNotNil(pattern.firstMatch(in: id, range: range), id)
        }
    }

    func testUUIDv7StartsWithTheTimestamp() {
        var random = FixedRandom(state: 42)
        // 1762246500000 ms = 0x019a4e139ea0, wie in den Testdaten (`019a4e13-9ea0-…`)
        let id = InkID.uuidV7(now: Date(timeIntervalSince1970: 1_762_246_500), using: &random)
        XCTAssertTrue(id.hasPrefix("019a4e13-9ea0-7"), id)
        XCTAssertEqual(id.count, 36)
    }

    func testUUIDv7DiffersBetweenCalls() {
        let now = Date(timeIntervalSince1970: 1_762_246_500)
        var ids = Set<String>()
        for _ in 0..<200 {
            ids.insert(InkID.uuidV7(now: now))
        }
        XCTAssertEqual(ids.count, 200)
    }
}

final class InkPageModelTests: XCTestCase {
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
    private func makeModel(_ store: FakeInkPageStore = FakeInkPageStore()) -> InkPageModel {
        // Lange Wartezeit: Im Test wird nur ausdrücklich gespeichert
        InkPageModel(pageID: "seite-1", store: store, saveDelay: .seconds(3600))
    }

    @MainActor
    func testStartsEmpty() {
        let model = makeModel()
        XCTAssertTrue(model.inkDrawing.strokes.isEmpty)
        XCTAssertTrue(model.highlightDrawing.strokes.isEmpty)
        XCTAssertFalse(model.canUndo)
        XCTAssertFalse(model.canRedo)
        XCTAssertTrue(model.neutralStrokes().isEmpty)
    }

    @MainActor
    func testUndoAndRedoWorkAcrossBothLayers() {
        let model = makeModel()
        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [makeStroke()]))
        model.canvasDidChange(layer: .highlight, drawing: PKDrawing(strokes: [makeStroke(.marker, y: 110)]))
        XCTAssertTrue(model.canUndo)
        XCTAssertFalse(model.canRedo)
        // Eigene Striche der Schreibfläche lösen kein Zurückschreiben aus
        XCTAssertEqual(model.inkRevision, 0)
        XCTAssertEqual(model.highlightRevision, 0)

        // Der letzte Schritt lag auf der Textmarker-Ebene
        model.undo()
        XCTAssertEqual(model.highlightDrawing.strokes.count, 0)
        XCTAssertEqual(model.inkDrawing.strokes.count, 1)
        XCTAssertEqual(model.highlightRevision, 1)
        XCTAssertEqual(model.inkRevision, 0)

        model.undo()
        XCTAssertEqual(model.inkDrawing.strokes.count, 0)
        XCTAssertEqual(model.inkRevision, 1)
        XCTAssertFalse(model.canUndo)
        XCTAssertTrue(model.canRedo)

        model.redo()
        XCTAssertEqual(model.inkDrawing.strokes.count, 1)
        model.redo()
        XCTAssertEqual(model.highlightDrawing.strokes.count, 1)
        XCTAssertFalse(model.canRedo)
    }

    @MainActor
    func testEchoOfTheSameDrawingIsNotAStep() {
        let model = makeModel()
        let drawing = PKDrawing(strokes: [makeStroke()])
        model.canvasDidChange(layer: .ink, drawing: drawing)
        // PencilKit meldet eine Zeichnung erneut, wenn die App sie gesetzt hat
        model.canvasDidChange(layer: .ink, drawing: drawing)

        model.undo()
        XCTAssertFalse(model.canUndo)
        XCTAssertEqual(model.inkDrawing.strokes.count, 0)
    }

    @MainActor
    func testChangesDuringOnePenMovementAreOneStep() {
        let model = makeModel()
        let first = makeStroke()
        let second = makeStroke(y: 140, createdAt: 1_762_246_501)

        model.beginToolUse()
        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [first]))
        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [first, second]))
        model.endToolUse()

        model.undo()
        XCTAssertEqual(model.inkDrawing.strokes.count, 0)
        XCTAssertFalse(model.canUndo)
    }

    @MainActor
    func testNewStrokeAfterUndoClearsRedo() {
        let model = makeModel()
        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [makeStroke()]))
        model.undo()
        XCTAssertTrue(model.canRedo)

        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [makeStroke(y: 200, createdAt: 1_762_246_502)]))
        XCTAssertFalse(model.canRedo)
    }

    @MainActor
    func testReportsStrokesInTheNeutralFormat() throws {
        let model = makeModel()
        var changes: [InkStrokeChange] = []
        model.onStrokeChanges = { changes.append(contentsOf: $0) }

        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [makeStroke()]))
        XCTAssertEqual(changes.count, 1)
        guard case .upsert(let stroke)? = changes.first else {
            return XCTFail("stroke.add erwartet")
        }
        XCTAssertEqual(stroke.tool, .pen)
        XCTAssertEqual(stroke.layer, .ink)
        XCTAssertEqual(stroke.createdAt, 1_762_246_500_000)
        XCTAssertEqual(stroke.clientID, stroke.clientID.lowercased())
        XCTAssertEqual(stroke.clientID.count, 36)
        XCTAssertNil(stroke.tStartMS)
        let points = try InkStrokeCodec.unpackPoints(stroke.points)
        XCTAssertFalse(points.isEmpty)
        XCTAssertEqual(points[0].dt, 0)
        XCTAssertTrue(points.allSatisfy { $0.force >= 0 && $0.force <= 1 })

        // Radieren: derselbe Strich verschwindet
        changes.removeAll()
        model.canvasDidChange(layer: .ink, drawing: PKDrawing())
        XCTAssertEqual(changes.count, 1)
        guard case .remove(let ids)? = changes.first else {
            return XCTFail("stroke.remove erwartet")
        }
        XCTAssertEqual(ids, [stroke.clientID])
    }

    @MainActor
    func testMarkerStrokesLandOnTheHighlightLayer() throws {
        let model = makeModel()
        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [makeStroke()]))
        model.canvasDidChange(layer: .highlight, drawing: PKDrawing(strokes: [makeStroke(.marker, y: 110)]))

        // Zeichenreihenfolge: erst Textmarker, dann Schrift
        let strokes = model.neutralStrokes()
        XCTAssertEqual(strokes.map(\.layer), [.highlight, .ink])
        XCTAssertEqual(strokes.first?.tool, .marker)
        let color = try XCTUnwrap(InkRGBA(hex: try XCTUnwrap(strokes.first?.color)))
        XCTAssertLessThan(color.alpha, 255)
    }

    @MainActor
    func testPencilKitInkTypesMapToSchemaTools() {
        XCTAssertEqual(InkPencilKit.strokeTool(for: .pen), .pen)
        XCTAssertEqual(InkPencilKit.strokeTool(for: .pencil), .pencil)
        XCTAssertEqual(InkPencilKit.strokeTool(for: .marker), .marker)
        XCTAssertEqual(InkPencilKit.strokeTool(for: .monoline), .monoline)
        XCTAssertEqual(InkPencilKit.strokeTool(for: .fountainPen), .fountain)
        for style in InkPenStyle.allCases {
            XCTAssertEqual(InkPencilKit.strokeTool(for: InkPencilKit.inkType(for: style)), style.strokeTool)
        }
    }

    @MainActor
    func testSavesAndRestoresThePageWithStableIDs() {
        let store = FakeInkPageStore()
        let model = makeModel(store)
        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [makeStroke()]))
        model.canvasDidChange(layer: .highlight, drawing: PKDrawing(strokes: [makeStroke(.marker, y: 110)]))
        let ids = model.neutralStrokes().map(\.clientID)
        XCTAssertEqual(ids.count, 2)

        model.saveNow()
        XCTAssertEqual(store.saveCount, 1)
        XCTAssertNotNil(store.snapshots["seite-1"]?.ink)
        XCTAssertNotNil(store.snapshots["seite-1"]?.highlight)

        // Ohne Änderung wird nicht erneut geschrieben
        model.saveNow()
        XCTAssertEqual(store.saveCount, 1)

        // „Neustart“: Die Seite kommt zurück, Rückgängig beginnt von vorn, die IDs bleiben
        let restored = makeModel(store)
        XCTAssertEqual(restored.inkDrawing.strokes.count, 1)
        XCTAssertEqual(restored.highlightDrawing.strokes.count, 1)
        XCTAssertFalse(restored.canUndo)
        XCTAssertEqual(restored.neutralStrokes().map(\.clientID), ids)
    }

    @MainActor
    func testReportsAFailedSave() {
        let store = FakeInkPageStore()
        store.failsOnSave = true
        let model = makeModel(store)
        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [makeStroke()]))
        model.saveNow()
        XCTAssertTrue(model.saveFailed)

        store.failsOnSave = false
        model.saveNow()
        XCTAssertFalse(model.saveFailed)
        XCTAssertEqual(store.saveCount, 1)
    }

    @MainActor
    func testPencilDoubleTapSwitchesToTheEraserAndBack() {
        let model = makeModel()
        model.pencilDoubleTapped(system: .ignore)
        XCTAssertEqual(model.tools.tool, .eraser)
        model.pencilDoubleTapped(system: .ignore)
        XCTAssertEqual(model.tools.tool, .pen(.fineliner))

        model.doubleTapSetting = .farbpalette
        model.pencilDoubleTapped(system: .ignore)
        XCTAssertTrue(model.showsColorPalette)
    }
}
