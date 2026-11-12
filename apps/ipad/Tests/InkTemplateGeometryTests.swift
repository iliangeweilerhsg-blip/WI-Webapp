import UIKit
import XCTest

@testable import StudienGehirn

final class InkTemplateGeometryTests: XCTestCase {
    private let a4 = CGSize(width: 595, height: 842)

    func testRuledA4StartsAt60WithSpacing30AndStaysAbove822() {
        let lines = InkTemplateGeometry.lines(for: .liniert, size: a4)
        XCTAssertEqual(lines.first?.y1 ?? 0, 60, accuracy: 0.001)
        XCTAssertEqual(lines.count, 26)
        for (index, line) in lines.enumerated() {
            XCTAssertEqual(line.y1, 60 + CGFloat(index) * 30, accuracy: 0.001)
            XCTAssertEqual(line.y1, line.y2, accuracy: 0.001)
            XCTAssertEqual(line.x1, 40, accuracy: 0.001)
            XCTAssertEqual(line.x2, 555, accuracy: 0.001)
        }
        XCTAssertLessThan(lines.last?.y1 ?? 1000, 822)
        XCTAssertEqual(lines.last?.y1 ?? 0, 810, accuracy: 0.001)
    }

    func testRuledLandscapeUsesItsOwnHeight() {
        let lines = InkTemplateGeometry.lines(for: .liniert, size: CGSize(width: 960, height: 540))
        XCTAssertEqual(lines.count, 16)
        XCTAssertEqual(lines.first?.x2 ?? 0, 920, accuracy: 0.001)
        XCTAssertLessThan(lines.last?.y1 ?? 1000, 520)
    }

    func testGridHasFiveMillimetreSpacingAndNoLineOnTheEdge() {
        let lines = InkTemplateGeometry.lines(for: .kariert, size: a4)
        let horizontal = lines.filter { $0.y1 == $0.y2 }.sorted { $0.y1 < $1.y1 }
        let vertical = lines.filter { $0.x1 == $0.x2 }.sorted { $0.x1 < $1.x1 }
        XCTAssertEqual(horizontal.count, 59)
        XCTAssertEqual(vertical.count, 41)
        XCTAssertEqual(horizontal.count + vertical.count, lines.count)
        for index in 1..<horizontal.count {
            XCTAssertEqual(horizontal[index].y1 - horizontal[index - 1].y1, 14.173, accuracy: 0.001)
        }
        for index in 1..<vertical.count {
            XCTAssertEqual(vertical[index].x1 - vertical[index - 1].x1, 14.173, accuracy: 0.001)
        }
        XCTAssertEqual(horizontal.first?.y1 ?? 0, 14.173, accuracy: 0.001)
        XCTAssertLessThan(horizontal.last?.y1 ?? 1000, 842)
        XCTAssertLessThan(vertical.last?.x1 ?? 1000, 595)
        // Über die ganze Seite
        XCTAssertEqual(horizontal.first?.x1 ?? 1, 0, accuracy: 0.001)
        XCTAssertEqual(horizontal.first?.x2 ?? 0, 595, accuracy: 0.001)
        XCTAssertEqual(vertical.first?.y2 ?? 0, 842, accuracy: 0.001)
    }

    func testAGridLineExactlyOnTheEdgeIsNotDrawn() {
        // Seitenbreite = 10 Rasterschritte: Die zehnte Linie läge auf dem Rand
        let size = CGSize(width: InkTemplateGeometry.grid * 10, height: InkTemplateGeometry.grid * 3)
        let vertical = InkTemplateGeometry.lines(for: .kariert, size: size).filter { $0.x1 == $0.x2 }
        XCTAssertEqual(vertical.count, 9)
        let dots = InkTemplateGeometry.dots(for: .punktraster, size: size)
        XCTAssertEqual(dots.count, 9 * 2)
    }

    func testDotGridCountsAllCrossingsInsideThePage() {
        let dots = InkTemplateGeometry.dots(for: .punktraster, size: a4)
        let columns = Int((595 - InkTemplateGeometry.epsilon) / InkTemplateGeometry.grid)
        let rows = Int((842 - InkTemplateGeometry.epsilon) / InkTemplateGeometry.grid)
        XCTAssertEqual(dots.count, columns * rows)
        XCTAssertEqual(dots.count, 41 * 59)
        XCTAssertEqual(dots.first?.x ?? 0, 14.173, accuracy: 0.001)
        XCTAssertEqual(dots.first?.y ?? 0, 14.173, accuracy: 0.001)
        XCTAssertTrue(dots.allSatisfy { $0.x < 595 && $0.y < 842 })
        XCTAssertTrue(InkTemplateGeometry.lines(for: .punktraster, size: a4).isEmpty)
    }

    func testBlankAndSlideTemplatesHaveNothingToDraw() {
        for template in [PageTemplate.blanko, .folie] {
            XCTAssertTrue(InkTemplateGeometry.lines(for: template, size: a4).isEmpty)
            XCTAssertTrue(InkTemplateGeometry.dots(for: template, size: a4).isEmpty)
        }
        XCTAssertTrue(InkTemplateGeometry.lines(for: .liniert, size: .zero).isEmpty)
        XCTAssertTrue(InkTemplateGeometry.dots(for: .punktraster, size: .zero).isEmpty)
    }

    func testCornellFromTheCoreIsDrawnLikeRuled() {
        XCTAssertEqual(
            InkTemplateGeometry.lines(for: .cornell, size: a4), InkTemplateGeometry.lines(for: .liniert, size: a4))
        XCTAssertEqual(InkTemplateGeometry.effectiveTemplate(.cornell), .liniert)
        XCTAssertEqual(InkTemplateGeometry.effectiveTemplate(.kariert), .kariert)
    }

    func testTheChoicesOfferNeitherCornellNorFolie() {
        XCTAssertEqual(PageTemplate.choices, [.blanko, .liniert, .kariert, .punktraster])
        XCTAssertEqual(PageTemplate.choices.map(\.germanTitle), ["Blanko", "Liniert", "Kariert", "Punktraster"])
    }

    func testThumbnailRenderingGivesA240PixelWideJPEG() throws {
        let data = try XCTUnwrap(
            InkThumbnailService.render(
                ink: nil, highlight: nil, template: .kariert, widthPt: 595, heightPt: 842))
        // JPEG beginnt mit FF D8
        XCTAssertEqual(Array(data.prefix(2)), [0xFF, 0xD8])
        let image = try XCTUnwrap(UIImage(data: data))
        XCTAssertEqual(image.size.width * image.scale, 240, accuracy: 0.5)
        XCTAssertEqual(image.size.height * image.scale, 340, accuracy: 1.5)
        XCTAssertNil(InkThumbnailService.render(ink: nil, highlight: nil, template: .blanko, widthPt: 0, heightPt: 10))
    }
}
