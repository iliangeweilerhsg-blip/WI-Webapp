import XCTest

@testable import StudienGehirn

/// Abgleich mit wartenden Operationen (Review #198): Der Plan rechnet die Warteschlange der Seite zuerst auf den Stand des Core
final class InkReconcilerTests: XCTestCase {
    private func stroke(_ id: String, width: Double = 2) -> Stroke {
        Stroke(
            bbox: [0, 0, 10, 10],
            clientID: id,
            color: "#000000FF",
            createdAt: 1_762_246_500_000,
            layer: .ink,
            points: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            tEndMS: nil,
            tStartMS: nil,
            tool: .pen,
            transform: [1, 0, 0, 1, 0, 0],
            width: width
        )
    }

    private func labels(_ changes: [InkStrokeChange]) -> [String] {
        changes.map { change in
            switch change {
            case .upsert(let value): return "+" + value.clientID
            case .remove(let list): return "-" + list.joined(separator: ",")
            }
        }
    }

    func testPendingRemoveLeavesNoGhostAndIsNotSentTwice() {
        // Der Core hat a und b. Gelöscht wurde b, das stroke.remove wartet noch, danach stürzte die App ab.
        let projected = InkReconciler.projected(
            server: [stroke("a"), stroke("b")], pending: [.remove(["b"])], pageCreatePending: false)
        XCTAssertEqual(projected?.map(\.clientID), ["a"])
        XCTAssertTrue(InkReconciler.plan(local: [stroke("a")], server: projected).isEmpty)
    }

    func testPendingAddCountsAsPresent() {
        let projected = InkReconciler.projected(
            server: [stroke("a")], pending: [.upsert(stroke("b"))], pageCreatePending: false)
        XCTAssertEqual(projected?.map(\.clientID), ["a", "b"])
        XCTAssertTrue(InkReconciler.plan(local: [stroke("a"), stroke("b")], server: projected).isEmpty)
    }

    func testStrokeMissingFromQueueAndServerIsStillSent() {
        // Absturz, bevor c eingereiht wurde: Der Abgleich holt es nach
        let projected = InkReconciler.projected(
            server: [stroke("a")], pending: [.upsert(stroke("b"))], pageCreatePending: false)
        let changes = InkReconciler.plan(local: [stroke("a"), stroke("b"), stroke("c")], server: projected)
        XCTAssertEqual(labels(changes), ["+c"])
    }

    func testLocalChangeNewerThanThePendingOneIsSent() {
        let projected = InkReconciler.projected(
            server: [], pending: [.upsert(stroke("a", width: 2))], pageCreatePending: false)
        let changes = InkReconciler.plan(local: [stroke("a", width: 4)], server: projected)
        XCTAssertEqual(labels(changes), ["+a"])
    }

    func testRemoveThenRestoreInTheQueueEndsWithTheStroke() {
        // Radieren und Rückgängig (gleiche client_id): die Reihenfolge der Warteschlange entscheidet
        let projected = InkReconciler.projected(
            server: [stroke("a")], pending: [.remove(["a"]), .upsert(stroke("a"))], pageCreatePending: false)
        XCTAssertEqual(projected?.map(\.clientID), ["a"])
        XCTAssertTrue(InkReconciler.plan(local: [stroke("a")], server: projected).isEmpty)
    }

    func testUnknownPageWithPendingCreateCountsAsEmpty() {
        XCTAssertNil(InkReconciler.projected(server: nil, pending: [], pageCreatePending: false))
        let projected = InkReconciler.projected(
            server: nil, pending: [.upsert(stroke("a"))], pageCreatePending: true)
        XCTAssertEqual(projected?.map(\.clientID), ["a"])
        XCTAssertTrue(InkReconciler.plan(local: [stroke("a")], server: projected).isEmpty)
    }
}
