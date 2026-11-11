import XCTest

@testable import StudienGehirn

final class InkBindingTests: XCTestCase {
    // MARK: Alte bindings.json

    func testOldBindingWithoutModuleNameStillDecodes() throws {
        let json = """
            {"notebookID":"n1","pageID":"p1","moduleID":"m1","pageCreated":true,"needsReconcile":false,
             "sessionID":"s1","sessionStartMS":8000}
            """
        let binding = try JSONDecoder().decode(InkBinding.self, from: Data(json.utf8))
        XCTAssertEqual(binding.notebookID, "n1")
        XCTAssertNil(binding.moduleName)
        XCTAssertEqual(binding.sessionStartMS, 8000)
    }

    func testModuleNameSurvivesEncodeAndDecode() throws {
        let binding = InkBinding(
            notebookID: "n1", pageID: "p1", moduleID: "m1", pageCreated: true, needsReconcile: false,
            sessionID: nil, sessionStartMS: nil, moduleName: "Analysis I")
        let data = try JSONEncoder().encode(binding)
        XCTAssertEqual(try JSONDecoder().decode(InkBinding.self, from: data).moduleName, "Analysis I")
    }

    // MARK: Abweichung

    func testNoRunningLectureNeverOffersTheButton() {
        XCTAssertFalse(InkBindingCheck.differs(shownNotebookID: "n1", runningNotebookID: nil))
        XCTAssertFalse(InkBindingCheck.differs(shownNotebookID: nil, runningNotebookID: nil))
    }

    func testSameNotebookDoesNotDiffer() {
        XCTAssertFalse(InkBindingCheck.differs(shownNotebookID: "n1", runningNotebookID: "n1"))
    }

    func testOtherNotebookDiffers() {
        XCTAssertTrue(InkBindingCheck.differs(shownNotebookID: "n1", runningNotebookID: "n2"))
        XCTAssertTrue(InkBindingCheck.differs(shownNotebookID: nil, runningNotebookID: "n2"))
    }

    // MARK: Texte

    func testTitleFallsBackToLecture() {
        XCTAssertEqual(InkPageTitle.text(moduleName: nil), "Vorlesung")
        XCTAssertEqual(InkPageTitle.text(moduleName: "  "), "Vorlesung")
        XCTAssertEqual(InkPageTitle.text(moduleName: "Analysis I"), "Analysis I")
    }

    func testOfflineLineNamesTheModule() {
        XCTAssertEqual(InkPageTitle.offlineLine(moduleName: "Analysis I"), "Offline · schreibt in Analysis I")
        XCTAssertEqual(
            InkPageTitle.offlineLine(moduleName: nil), "Offline · schreibt ins zuletzt benutzte Notizbuch")
    }
}
