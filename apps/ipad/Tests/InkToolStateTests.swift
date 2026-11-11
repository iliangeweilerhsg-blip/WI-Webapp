import XCTest

@testable import StudienGehirn

final class InkToolStateTests: XCTestCase {
    func testStartsWithFinelinerOnTheInkLayer() {
        let state = InkToolState()
        XCTAssertEqual(state.tool, .pen(.fineliner))
        XCTAssertEqual(state.activeLayer, .ink)
        XCTAssertEqual(state.currentWidthIndex, 1)
        XCTAssertEqual(state.currentColor, InkToolState.defaultFavoriteColors[0])
        XCTAssertEqual(state.favoriteColors.count, 8)
    }

    func testPenStylesMapToSchemaTools() {
        XCTAssertEqual(InkPenStyle.fountain.strokeTool, .fountain)
        XCTAssertEqual(InkPenStyle.fineliner.strokeTool, .pen)
        XCTAssertEqual(InkPenStyle.monoline.strokeTool, .monoline)
        XCTAssertEqual(InkPenStyle.pencil.strokeTool, .pencil)
    }

    func testMarkerWritesOnTheHighlightLayer() {
        var state = InkToolState()
        state.select(.marker)
        XCTAssertEqual(state.activeLayer, .highlight)
        XCTAssertEqual(state.currentColor, InkToolState.markerColors[0])
        XCTAssertEqual(state.paletteColors, InkToolState.markerColors)

        state.select(.lasso)
        XCTAssertEqual(state.activeLayer, .ink)
        XCTAssertNil(state.currentColor)
        XCTAssertNil(state.currentWidth)
    }

    func testEraserOptionHighlightOnlyUsesTheLowerLayer() {
        var state = InkToolState()
        state.select(.eraser)
        XCTAssertEqual(state.activeLayer, .ink)
        state.eraserHighlightOnly = true
        XCTAssertEqual(state.activeLayer, .highlight)
        // Die Option gilt nur für den Radierer
        state.select(.pen(.pencil))
        XCTAssertEqual(state.activeLayer, .ink)
    }

    func testEveryDrawingToolHasThreeWidths() {
        let tools: [InkTool] = InkPenStyle.allCases.map { InkTool.pen($0) } + [InkTool.marker]
        for tool in tools {
            let widths = InkToolState.widths(for: tool)
            XCTAssertEqual(widths.count, InkToolState.widthChoices, "\(tool)")
            XCTAssertEqual(widths, widths.sorted(), "\(tool)")
            XCTAssertTrue(widths.allSatisfy { $0 > 0 }, "\(tool)")
        }
        XCTAssertTrue(InkToolState.widths(for: .eraser).isEmpty)
        XCTAssertTrue(InkToolState.widths(for: .lasso).isEmpty)
    }

    func testWidthAndColorAreKeptPerTool() {
        var state = InkToolState()
        let red = InkToolState.defaultFavoriteColors[3]
        state.selectWidth(index: 2)
        state.selectColor(red)
        XCTAssertEqual(state.currentWidth, InkToolState.widths(for: .pen(.fineliner))[2])

        state.select(.pen(.fountain))
        XCTAssertEqual(state.currentWidthIndex, 1)
        XCTAssertEqual(state.currentColor, InkToolState.defaultFavoriteColors[0])

        state.select(.pen(.fineliner))
        XCTAssertEqual(state.currentWidthIndex, 2)
        XCTAssertEqual(state.currentColor, red)
    }

    func testWidthAndColorIgnoreEraserAndBadIndexes() {
        var state = InkToolState()
        state.selectWidth(index: 7)
        XCTAssertEqual(state.currentWidthIndex, 1)

        state.select(.eraser)
        let before = state
        state.selectWidth(index: 0)
        state.selectColor(InkToolState.defaultFavoriteColors[2])
        XCTAssertEqual(state, before)
    }

    func testLongPressOnEraserSelectsItThenTogglesTheMode() {
        var state = InkToolState()
        state.toggleEraserMode()
        XCTAssertEqual(state.tool, .eraser)
        XCTAssertEqual(state.eraserMode, .stroke)

        state.toggleEraserMode()
        XCTAssertEqual(state.eraserMode, .pixel)
        state.toggleEraserMode()
        XCTAssertEqual(state.eraserMode, .stroke)
    }

    // MARK: Doppeltipp

    func testDoubleTapSwitchesToEraserAndBack() {
        var state = InkToolState()
        state.select(.pen(.fountain))

        XCTAssertEqual(state.handleDoubleTap(setting: .radierer, system: .ignore), .toolChanged)
        XCTAssertEqual(state.tool, .eraser)

        XCTAssertEqual(state.handleDoubleTap(setting: .radierer, system: .ignore), .toolChanged)
        XCTAssertEqual(state.tool, .pen(.fountain))
    }

    func testDoubleTapReturnsToTheToolUsedBeforeTheEraser() {
        var state = InkToolState()
        state.select(.marker)
        state.select(.eraser)
        _ = state.handleDoubleTap(setting: .radierer, system: .ignore)
        XCTAssertEqual(state.tool, .marker)
    }

    func testDoubleTapLastToolSwapsTheTwoMostRecentTools() {
        var state = InkToolState()
        state.select(.marker)
        XCTAssertEqual(state.handleDoubleTap(setting: .letztesWerkzeug, system: .ignore), .toolChanged)
        XCTAssertEqual(state.tool, .pen(.fineliner))
        _ = state.handleDoubleTap(setting: .letztesWerkzeug, system: .ignore)
        XCTAssertEqual(state.tool, .marker)
    }

    func testDoubleTapOffDoesNothing() {
        var state = InkToolState()
        let before = state
        XCTAssertEqual(state.handleDoubleTap(setting: .aus, system: .switchEraser), InkDoubleTapEffect.none)
        XCTAssertEqual(state, before)
    }

    func testDoubleTapColorPaletteOnlyForDrawingTools() {
        var state = InkToolState()
        XCTAssertEqual(state.handleDoubleTap(setting: .farbpalette, system: .ignore), .showColorPalette)
        state.select(.eraser)
        XCTAssertEqual(state.handleDoubleTap(setting: .farbpalette, system: .ignore), InkDoubleTapEffect.none)
    }

    func testDoubleTapSystemFollowsTheDeviceSetting() {
        var state = InkToolState()
        XCTAssertEqual(state.handleDoubleTap(setting: .system, system: .ignore), InkDoubleTapEffect.none)
        XCTAssertEqual(state.tool, .pen(.fineliner))

        XCTAssertEqual(state.handleDoubleTap(setting: .system, system: .switchEraser), .toolChanged)
        XCTAssertEqual(state.tool, .eraser)

        XCTAssertEqual(state.handleDoubleTap(setting: .system, system: .switchPrevious), .toolChanged)
        XCTAssertEqual(state.tool, .pen(.fineliner))
    }

    // MARK: Farben

    func testColorHexRoundTrip() {
        XCTAssertEqual(InkRGBA(hex: "#1E2A44FF"), InkRGBA(red: 0x1E, green: 0x2A, blue: 0x44, alpha: 0xFF))
        XCTAssertEqual(InkRGBA(hex: "#ffe066"), InkRGBA(red: 0xFF, green: 0xE0, blue: 0x66))
        XCTAssertEqual(InkRGBA(red: 0xFF, green: 0xE0, blue: 0x66, alpha: 0x66).hex, "#FFE06666")
        XCTAssertNil(InkRGBA(hex: "1E2A44FF"))
        XCTAssertNil(InkRGBA(hex: "#1E2A4"))
        XCTAssertNil(InkRGBA(hex: "#GG2A44FF"))
    }
}
