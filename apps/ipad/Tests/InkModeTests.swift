import XCTest

@testable import StudienGehirn

/// Schreibmodus pro Modul (F-INK-03): Auflösung, Merken ohne Verbindung, genau ein `PATCH`, Rennen mit dem Abruf der
/// Module (L6 aus #225)
@MainActor
final class InkModeTests: XCTestCase {
    private let moduleID = LibraryFixtures.moduleID
    private let notebookID = "019a4e14-0000-7000-8000-0000000000a2"

    private func startOnline(_ h: SyncHarness) async {
        h.start()
        let online = await eventually { h.engine.state == .online }
        XCTAssertTrue(online)
    }

    private func patches(_ h: SyncHarness) -> [URLRequest] {
        h.transport.requests.filter { $0.httpMethod == "PATCH" }
    }

    private func patchedMode(_ request: URLRequest) throws -> String? {
        let data = try XCTUnwrap(request.httpBody)
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let settings = try XCTUnwrap(object["settings"] as? [String: Any])
        // Nur dieser eine Schlüssel: Layout und Spaltenbreiten der Web-App bleiben unberührt
        XCTAssertEqual(Array(settings.keys), ["ink_mode"])
        XCTAssertEqual(object.count, 1)
        return settings["ink_mode"] as? String
    }

    // MARK: Auflösung

    func testTheModeComesFromTheModuleThenTheSettingsThenFreePage() {
        XCTAssertEqual(InkModeResolver.resolve(module: .aufFolie, lectureDefault: .freieSeite), .aufFolie)
        XCTAssertEqual(InkModeResolver.resolve(module: .freieSeite, lectureDefault: .aufFolie), .freieSeite)
        XCTAssertEqual(InkModeResolver.resolve(module: nil, lectureDefault: .aufFolie), .aufFolie)
        XCTAssertEqual(InkModeResolver.resolve(module: nil, lectureDefault: nil), .freieSeite)
    }

    func testSlideModeNeedsARunningLectureOfTheModuleWithADeckAndAKnownSlide() {
        let running = RunningSession(
            id: "s", moduleID: moduleID, startMS: 1, slideDeckID: "deck", notebookID: notebookID)
        XCTAssertTrue(InkModeResolver.isAvailable(running: running, moduleID: moduleID, slideKnown: true))
        XCTAssertFalse(InkModeResolver.isAvailable(running: running, moduleID: moduleID, slideKnown: false))
        XCTAssertFalse(InkModeResolver.isAvailable(running: running, moduleID: "other", slideKnown: true))
        XCTAssertFalse(InkModeResolver.isAvailable(running: nil, moduleID: moduleID, slideKnown: true))
        var noDeck = running
        noDeck.slideDeckID = nil
        XCTAssertFalse(InkModeResolver.isAvailable(running: noDeck, moduleID: moduleID, slideKnown: true))
    }

    func testTheServiceResolvesWithTheLectureDefault() async throws {
        let h = SyncHarness(health: [
            .http(status: 200, body: "{\"lecture\":{\"default_ink_mode\":\"auf_folie\"},\"ai\":{\"x\":1}}")
        ])
        XCTAssertEqual(h.service.inkMode(forModule: moduleID), .freieSeite)
        await startOnline(h)
        await h.service.refreshLectureDefaults()
        XCTAssertEqual(h.service.lectureDefaultInkMode, .aufFolie)
        XCTAssertEqual(h.service.inkMode(forModule: moduleID), .aufFolie)

        // Die eigene Wahl des Moduls geht vor
        h.service.setInkMode(.freieSeite, moduleID: moduleID)
        XCTAssertEqual(h.service.inkMode(forModule: moduleID), .freieSeite)
    }

    func testAnUnknownDefaultCountsAsFreePage() async {
        let h = SyncHarness(health: [.http(status: 200, body: "{\"lecture\":{\"default_ink_mode\":\"neu\"}}")])
        await startOnline(h)
        await h.service.refreshLectureDefaults()
        XCTAssertEqual(h.service.lectureDefaultInkMode, .freieSeite)
    }

    // MARK: Merken und senden

    func testAChoiceWithoutConnectionIsKeptDirtyAndSurvivesARestart() throws {
        let h = SyncHarness()
        h.service.setInkMode(.aufFolie, moduleID: moduleID)
        XCTAssertEqual(h.service.inkMode(forModule: moduleID), .aufFolie)
        let module = try XCTUnwrap(h.library.modules.first)
        XCTAssertEqual(module.inkMode, .aufFolie)
        XCTAssertTrue(module.inkModeDirty)
        XCTAssertTrue(h.transport.requests.isEmpty)

        // Neustart: neue Ablage aus derselben Datei
        let reread = FileInkLibraryStore(url: h.directory.appendingPathComponent("library.json"))
        XCTAssertEqual(reread.modules.first?.inkMode, .aufFolie)
        XCTAssertEqual(reread.modules.first?.inkModeDirty, true)
    }

    func testOnConnectionExactlyOnePatchGoesOutAndTheChoiceIsClean() async throws {
        let h = SyncHarness()
        // Die Wahl entstand ohne Verbindung (direkt in der Ablage, ohne dass der Dienst sofort sendet)
        h.library.setModuleInkMode(.aufFolie, moduleID: moduleID, dirty: true)
        await startOnline(h)

        await h.service.flushInkModes()
        await h.service.flushInkModes()
        await h.clock.settle()
        let sent = patches(h)
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent.first?.url?.path, "/api/v1/modules/\(moduleID)")
        XCTAssertEqual(try patchedMode(try XCTUnwrap(sent.first)), "auf_folie")
        XCTAssertEqual(h.library.modules.first?.inkModeDirty, false)
        XCTAssertEqual(h.library.modules.first?.inkMode, .aufFolie)
        // Das Token steht im Header, nicht im Body oder in der Adresse
        XCTAssertEqual(sent.first?.value(forHTTPHeaderField: "Authorization"), "Bearer \(Fixtures.token)")
        XCTAssertFalse(sent.first?.url?.absoluteString.contains(Fixtures.token) ?? true)
    }

    func testAFailedPatchKeepsTheChoiceDirtyForTheNextTry() async {
        let h = SyncHarness(health: [
            .http(status: 500, body: Fixtures.apiError("internal_error")),
            .http(status: 200, body: "{}"),
        ])
        await startOnline(h)
        h.service.setInkMode(.aufFolie, moduleID: moduleID)
        await h.clock.settle()
        XCTAssertEqual(patches(h).count, 1)
        XCTAssertEqual(h.library.modules.first?.inkModeDirty, true)

        await h.service.flushInkModes()
        XCTAssertEqual(patches(h).count, 2)
        XCTAssertEqual(h.library.modules.first?.inkModeDirty, false)
    }

    func testAChoiceChangedWhileThePatchIsOnItsWayStaysDirtyAndGoesOutAgain() async throws {
        let h = SyncHarness()
        await startOnline(h)
        let moduleID = self.moduleID
        // Während des ersten PATCH wechselt die Nutzerin zurück
        h.transport.duringRequest = { [service = h.service] request in
            if request.httpMethod == "PATCH", service.inkMode(forModule: moduleID) == .aufFolie {
                service.setInkMode(.freieSeite, moduleID: moduleID)
            }
        }
        h.service.setInkMode(.aufFolie, moduleID: moduleID)
        await h.clock.settle()

        let sent = patches(h)
        XCTAssertEqual(sent.count, 2)
        XCTAssertEqual(try patchedMode(sent[0]), "auf_folie")
        XCTAssertEqual(try patchedMode(sent[1]), "freie_seite")
        XCTAssertEqual(h.library.modules.first?.inkMode, .freieSeite)
        XCTAssertEqual(h.library.modules.first?.inkModeDirty, false)
    }

    // MARK: Abruf der Module

    func testTheModulesFetchDoesNotOverwriteADirtyChoice() async throws {
        let h = SyncHarness(health: [
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.moduleJSON(inkMode: "freie_seite")])),
            .http(status: 200, body: LibraryFixtures.list([])),
            .http(status: 200, body: "{}"),
        ])
        h.service.attachFollower()
        h.library.setModuleInkMode(.aufFolie, moduleID: moduleID, dirty: true)
        await startOnline(h)

        await h.service.refresh(force: true)
        XCTAssertEqual(h.library.modules.first?.inkMode, .aufFolie)
        // Der PATCH folgt dem Abruf
        XCTAssertEqual(patches(h).count, 1)
        XCTAssertEqual(h.library.modules.first?.inkModeDirty, false)
    }

    /// L6: Der PATCH wird bestätigt, **während** `GET /modules` läuft. Die Antwort des Abrufs ist älter als die Wahl
    /// und darf sie nicht überschreiben, auch wenn die Wahl inzwischen nicht mehr `dirty` ist.
    func testAPatchConfirmedDuringTheModulesFetchIsNotOverwrittenByTheOlderAnswer() async throws {
        let h = SyncHarness(health: [
            // 0: GET /modules, noch ohne Wahl
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.moduleJSON()])),
            // 1: der PATCH, der währenddessen bestätigt wird
            .http(status: 200, body: "{}"),
            // 2: GET /notebooks
            .http(status: 200, body: LibraryFixtures.list([])),
        ])
        h.service.attachFollower()
        await startOnline(h)
        let moduleID = self.moduleID
        h.transport.duringRequest = { [service = h.service, clock = h.clock] request in
            guard request.httpMethod == "GET", request.url?.path == "/api/v1/modules" else { return }
            service.setInkMode(.aufFolie, moduleID: moduleID)
            // Der PATCH läuft zu Ende, bevor die Antwort des Abrufs ausgeliefert wird
            await clock.settle()
        }

        await h.service.refresh(force: true)

        let sent = patches(h)
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(h.library.modules.first?.inkMode, .aufFolie)
        XCTAssertEqual(h.library.modules.first?.inkModeDirty, false)
        XCTAssertEqual(h.service.inkMode(forModule: moduleID), .aufFolie)
    }

    func testWithoutAnyLocalChoiceTheFetchTakesTheModeOfTheCore() async {
        let h = SyncHarness(health: [
            .http(status: 200, body: LibraryFixtures.list([LibraryFixtures.moduleJSON(inkMode: "auf_folie")])),
            .http(status: 200, body: LibraryFixtures.list([])),
        ])
        h.service.attachFollower()
        await startOnline(h)
        await h.service.refresh(force: true)
        XCTAssertEqual(h.library.modules.first?.inkMode, .aufFolie)
        XCTAssertTrue(patches(h).isEmpty)
    }
}
