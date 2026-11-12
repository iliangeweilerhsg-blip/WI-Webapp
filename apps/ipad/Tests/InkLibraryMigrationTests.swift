import XCTest

@testable import StudienGehirn

@MainActor
final class InkLibraryMigrationTests: XCTestCase {
    private func makeDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("migration-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private func binding(
        notebook: String, page: String, module: String, created: Bool = true, reconcile: Bool = false,
        session: String? = nil, name: String? = nil
    ) -> InkBinding {
        InkBinding(
            notebookID: notebook, pageID: page, moduleID: module, pageCreated: created, needsReconcile: reconcile,
            sessionID: session, sessionStartMS: nil, moduleName: name)
    }

    private func writeBindings(_ file: InkBindingsFile, to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(file).write(to: url)
    }

    func testTwoBindingsBecomeTwoNotebooksWithOnePageEach() throws {
        let directory = try makeDirectory()
        let legacy = directory.appendingPathComponent("bindings.json")
        var file = InkBindingsFile()
        file.bindings["n1"] = binding(notebook: "n1", page: "p1", module: "m1", name: "Analysis I")
        file.bindings["n2"] = binding(
            notebook: "n2", page: "p2", module: "m2", created: false, reconcile: true, session: "s2", name: nil)
        file.lastNotebookID = "n2"
        file.dbEpoch = "epoch-7"
        try writeBindings(file, to: legacy)

        let library = directory.appendingPathComponent("library.json")
        let store = FileInkLibraryStore(url: library, legacyBindingsURL: legacy)

        XCTAssertEqual(store.modules.map(\.id).sorted(), ["m1", "m2"])
        XCTAssertEqual(store.modules.first { $0.id == "m1" }?.name, "Analysis I")
        // Ohne Namen (Bindung vor #214): Platzhalter bis zum ersten Abruf
        XCTAssertEqual(store.modules.first { $0.id == "m2" }?.name, "Modul")

        let first = try XCTUnwrap(store.notebook("n1"))
        XCTAssertEqual(first.title, "Vorlesung")
        XCTAssertEqual(first.kind, .vorlesung)
        XCTAssertTrue(first.knownOnServer)
        XCTAssertEqual(first.lastPageID, "p1")

        let firstPage = try XCTUnwrap(store.page("p1"))
        XCTAssertEqual(firstPage.notebookID, "n1")
        XCTAssertEqual(firstPage.template, .blanko)
        XCTAssertEqual(firstPage.widthPt, 595)
        XCTAssertEqual(firstPage.heightPt, 842)
        XCTAssertEqual(firstPage.index, 1)
        XCTAssertEqual(firstPage.version, 1)
        XCTAssertTrue(firstPage.createQueued)
        XCTAssertFalse(firstPage.needsReconcile)
        XCTAssertNil(firstPage.sessionID)

        // `page.create` stand noch aus: Das iPad holt es nach, mit der Session der Bindung
        let secondPage = try XCTUnwrap(store.page("p2"))
        XCTAssertFalse(secondPage.createQueued)
        XCTAssertTrue(secondPage.needsReconcile)
        XCTAssertEqual(secondPage.sessionID, "s2")

        XCTAssertEqual(store.lastNotebookID, "n2")
        XCTAssertEqual(store.dbEpoch, "epoch-7")
    }

    func testTheOldFileIsRenamedAndNotMigratedTwice() throws {
        let directory = try makeDirectory()
        let legacy = directory.appendingPathComponent("bindings.json")
        var file = InkBindingsFile()
        file.bindings["n1"] = binding(notebook: "n1", page: "p1", module: "m1", name: "Analysis I")
        try writeBindings(file, to: legacy)
        let library = directory.appendingPathComponent("library.json")

        _ = FileInkLibraryStore(url: library, legacyBindingsURL: legacy)
        XCTAssertTrue(FileManager.default.fileExists(atPath: library.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacy.path))
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: directory.appendingPathComponent("bindings.migriert.json").path))

        // Zweiter Start: Die Bibliothek gilt, auch wenn jemand eine neue `bindings.json` hinlegt
        file.bindings["n9"] = binding(notebook: "n9", page: "p9", module: "m9")
        try writeBindings(file, to: legacy)
        let second = FileInkLibraryStore(url: library, legacyBindingsURL: legacy)
        XCTAssertNotNil(second.notebook("n1"))
        XCTAssertNil(second.notebook("n9"))
    }

    func testABrokenBindingsFileGivesAnEmptyLibraryWithoutCrashing() throws {
        let directory = try makeDirectory()
        let legacy = directory.appendingPathComponent("bindings.json")
        try Data("{ das ist kein json".utf8).write(to: legacy)
        let store = FileInkLibraryStore(
            url: directory.appendingPathComponent("library.json"), legacyBindingsURL: legacy)
        XCTAssertTrue(store.modules.isEmpty)
        XCTAssertTrue(store.allNotebooks().isEmpty)
        XCTAssertNil(store.lastNotebookID)
    }

    func testNoFilesAtAllGiveAnEmptyLibrary() throws {
        let directory = try makeDirectory()
        let store = FileInkLibraryStore(
            url: directory.appendingPathComponent("library.json"),
            legacyBindingsURL: directory.appendingPathComponent("bindings.json"))
        XCTAssertTrue(store.modules.isEmpty)
        XCTAssertNil(store.dbEpoch)
    }

    func testTwoBindingsOfOneModuleShareOneModuleEntryWithTheKnownName() {
        var file = InkBindingsFile()
        file.bindings["n1"] = binding(notebook: "n1", page: "p1", module: "m1", name: nil)
        file.bindings["n2"] = binding(notebook: "n2", page: "p2", module: "m1", name: "Analysis I")
        let migrated = InkLibraryMigration.migrate(file)
        XCTAssertEqual(migrated.modules.count, 1)
        XCTAssertEqual(migrated.modules.first?.name, "Analysis I")
        XCTAssertEqual(migrated.notebooks.count, 2)
    }

    func testAnOldBindingWithoutNameStillDecodesFromTheOldFormat() throws {
        let json = """
            {"bindings":{"n1":{"notebookID":"n1","pageID":"p1","moduleID":"m1","pageCreated":true,
            "needsReconcile":false,"sessionID":null,"sessionStartMS":null}},"lastNotebookID":"n1","dbEpoch":"e"}
            """
        let file = try JSONDecoder().decode(InkBindingsFile.self, from: Data(json.utf8))
        let migrated = InkLibraryMigration.migrate(file)
        XCTAssertEqual(migrated.modules.first?.name, "Modul")
        XCTAssertEqual(migrated.lastNotebookID, "n1")
        XCTAssertEqual(migrated.dbEpoch, "e")
    }
}
