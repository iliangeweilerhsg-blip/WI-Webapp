import XCTest

@testable import StudienGehirn

final class InkHistoryTests: XCTestCase {
    func testStartsEmpty() {
        var history = InkHistory<String>()
        XCTAssertFalse(history.canUndo)
        XCTAssertFalse(history.canRedo)
        XCTAssertNil(history.undo())
        XCTAssertNil(history.redo())
    }

    func testUndoAndRedoWalkThroughBothLayersInOrder() throws {
        var history = InkHistory<String>()
        history.record(layer: .ink, before: "", after: "a")
        history.record(layer: .highlight, before: "", after: "m")
        history.record(layer: .ink, before: "a", after: "ab")

        var step = try XCTUnwrap(history.undo())
        XCTAssertEqual(step.layer, .ink)
        XCTAssertEqual(step.before, "a")

        step = try XCTUnwrap(history.undo())
        XCTAssertEqual(step.layer, .highlight)
        XCTAssertEqual(step.before, "")

        step = try XCTUnwrap(history.redo())
        XCTAssertEqual(step.layer, .highlight)
        XCTAssertEqual(step.after, "m")

        step = try XCTUnwrap(history.redo())
        XCTAssertEqual(step.layer, .ink)
        XCTAssertEqual(step.after, "ab")
        XCTAssertFalse(history.canRedo)
        XCTAssertTrue(history.canUndo)
    }

    func testNewChangeClearsRedo() {
        var history = InkHistory<String>()
        history.record(layer: .ink, before: "", after: "a")
        _ = history.undo()
        XCTAssertTrue(history.canRedo)

        history.record(layer: .ink, before: "", after: "b")
        XCTAssertFalse(history.canRedo)
        XCTAssertEqual(history.undoSteps.count, 1)
    }

    func testLimitDropsTheOldestSteps() throws {
        var history = InkHistory<Int>(limit: 3)
        for value in 1...5 {
            history.record(layer: .ink, before: value - 1, after: value)
        }
        XCTAssertEqual(history.undoSteps.count, 3)
        XCTAssertEqual(history.undoSteps.first?.before, 2)
        XCTAssertEqual(try XCTUnwrap(history.undo()).after, 5)
    }

    func testCoalesceMergesIntoTheLastStepOfTheSameLayer() throws {
        var history = InkHistory<String>()
        history.record(layer: .ink, before: "abc", after: "ab")
        history.record(layer: .ink, before: "ab", after: "a", coalesce: true)
        XCTAssertEqual(history.undoSteps.count, 1)

        let step = try XCTUnwrap(history.undo())
        XCTAssertEqual(step.before, "abc")
        XCTAssertEqual(step.after, "a")
    }

    func testCoalesceDoesNotMergeAcrossLayers() {
        var history = InkHistory<String>()
        history.record(layer: .ink, before: "", after: "a")
        history.record(layer: .highlight, before: "", after: "m", coalesce: true)
        XCTAssertEqual(history.undoSteps.count, 2)
    }

    func testResetForgetsEverything() {
        var history = InkHistory<String>()
        history.record(layer: .ink, before: "", after: "a")
        _ = history.undo()
        history.record(layer: .ink, before: "", after: "b")
        history.reset()
        XCTAssertFalse(history.canUndo)
        XCTAssertFalse(history.canRedo)
    }
}
