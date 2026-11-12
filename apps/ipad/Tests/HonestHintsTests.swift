import XCTest

@testable import StudienGehirn

/// UX-48: Das Abzeichen ist nur bei laufendem Sync grün
final class BadgeStateTests: XCTestCase {
    func testGreenOnlyWhenSyncIsOnline() {
        XCTAssertEqual(BadgeState.resolve(connection: .connected, syncState: .online), .online)
        XCTAssertTrue(BadgeState.resolve(connection: .connected, syncState: .online).isGreen)
        // Der Sync läuft, `/health` ist noch unbekannt: Der Sync weiß es besser
        XCTAssertEqual(BadgeState.resolve(connection: .unknown, syncState: .online), .online)
    }

    func testMacAnswersButSyncDoesNotIsNotGreen() {
        let states: [SyncEngine.State] = [.stopped, .connecting, .clockSync, .waiting]
        for state in states {
            let badge = BadgeState.resolve(connection: .connected, syncState: state)
            XCTAssertEqual(badge, .macReachable)
            XCTAssertFalse(badge.isGreen)
        }
        XCTAssertEqual(BadgeState.macReachable.headline, "Mac erreichbar, Sync verbindet …")
    }

    func testWithoutEngineTheHealthCheckDecides() {
        XCTAssertEqual(BadgeState.resolve(connection: .connected, syncState: nil), .online)
        XCTAssertEqual(BadgeState.resolve(connection: .checking, syncState: nil), .checking)
        XCTAssertEqual(
            BadgeState.resolve(connection: .disconnected(.timeout), syncState: nil), .disconnected(.timeout))
    }

    func testUnsupportedIsItsOwnState() {
        // Auch wenn `/health` antwortet
        let badge = BadgeState.resolve(connection: .connected, syncState: .unsupported)
        XCTAssertEqual(badge, .appOutdated)
        XCTAssertFalse(badge.isGreen)
        XCTAssertEqual(badge.headline, "App passt nicht mehr zum Mac")
        XCTAssertEqual(badge.detail, "Am Mac über Xcode neu aufspielen.")
        XCTAssertEqual(
            BadgeState.resolve(connection: .disconnected(.appOutdated), syncState: nil), .appOutdated)
    }

    func testRevokedTokenStaysDisconnected() {
        XCTAssertEqual(
            BadgeState.resolve(connection: .disconnected(.tokenInvalid), syncState: .waiting),
            .disconnected(.tokenInvalid))
    }

    func testDisconnectedNamesTheCause() {
        let badge = BadgeState.resolve(connection: .disconnected(.offline), syncState: .waiting)
        XCTAssertEqual(badge, .disconnected(.offline))
        XCTAssertEqual(badge.headline, "iPad nicht verbunden: Kein WLAN")
        XCTAssertEqual(badge.accessibilityLabel, "iPad nicht verbunden")
    }
}

/// UX-47 und UX-49: Texte zu wartenden und abgelehnten Änderungen
final class PendingChangesTextTests: XCTestCase {
    func testPendingPhraseUsesSingularAndPlural() {
        XCTAssertNil(InkPageTitle.pendingPhrase(0))
        XCTAssertEqual(InkPageTitle.pendingPhrase(1), "1 Änderung wartet")
        XCTAssertEqual(InkPageTitle.pendingPhrase(2), "2 Änderungen warten")
        XCTAssertEqual(InkPageTitle.pendingPhrase(37), "37 Änderungen warten")
    }

    func testOfflineLineAddsPendingChangesOnlyAboveZero() {
        XCTAssertEqual(
            InkPageTitle.offlineLine(moduleName: "Analysis I", notebookTitle: "Vorlesung", pendingChanges: 0),
            "Offline · schreibt in Analysis I · Vorlesung")
        XCTAssertEqual(
            InkPageTitle.offlineLine(moduleName: "Analysis I", notebookTitle: "Vorlesung", pendingChanges: 1),
            "Offline · schreibt in Analysis I · Vorlesung · 1 Änderung wartet")
        XCTAssertEqual(
            InkPageTitle.offlineLine(moduleName: "Analysis I", notebookTitle: "Vorlesung", pendingChanges: 37),
            "Offline · schreibt in Analysis I · Vorlesung · 37 Änderungen warten")
    }

    func testOfflineLineSaysTheSlideDoesNotFollow() {
        XCTAssertEqual(
            InkPageTitle.offlineLine(
                moduleName: "Analysis I", notebookTitle: "Vorlesung", pendingChanges: 3, slideNotFollowing: true),
            "Offline · schreibt in Analysis I · Vorlesung · 3 Änderungen warten · Folie folgt gerade nicht")
        XCTAssertEqual(
            InkPageTitle.offlineLine(
                moduleName: nil, notebookTitle: nil, pendingChanges: 0, slideNotFollowing: true),
            "Offline · schreibt ins zuletzt benutzte Notizbuch · Folie folgt gerade nicht")
    }

    func testDeadLetterCardText() {
        XCTAssertEqual(
            HomeTexts.deadLetterCard(count: 3),
            "3 Änderungen konnten der Mac nicht annehmen. Die Zeichnungen liegen noch auf dem iPad.")
        XCTAssertEqual(
            HomeTexts.deadLetterCard(count: 1),
            "1 Änderung konnte der Mac nicht annehmen. Die Zeichnungen liegen noch auf dem iPad.")
    }

    func testAppOutdatedCardText() {
        XCTAssertEqual(
            HomeTexts.appOutdatedCard, "App passt nicht mehr zum Mac. Am Mac über Xcode neu aufspielen.")
    }
}

/// UX-49 und UX-51: Hinweise mit fester Dauer, ohne dass ein Test echt wartet
@MainActor
final class TimedNoticeTests: XCTestCase {
    func testAllSyncedShowsForThreeSecondsAfterThePendingChangesDrainOnline() async {
        let clock = VirtualClock()
        let notice = AllSyncedNotice(sleep: { try await clock.sleep($0) })

        notice.update(isOnline: false, pending: 5)
        XCTAssertFalse(notice.isVisible)
        notice.update(isOnline: true, pending: 5)
        XCTAssertFalse(notice.isVisible)

        notice.update(isOnline: true, pending: 0)
        XCTAssertTrue(notice.isVisible)
        await clock.advance(2.9)
        XCTAssertTrue(notice.isVisible)
        await clock.advance(0.2)
        XCTAssertFalse(notice.isVisible)
    }

    func testAllSyncedWaitsForOnlineBeforeShowing() async {
        let clock = VirtualClock()
        let notice = AllSyncedNotice(sleep: { try await clock.sleep($0) })

        notice.update(isOnline: false, pending: 2)
        // Die Zahl fällt, der Sync ist aber noch nicht online
        notice.update(isOnline: false, pending: 0)
        XCTAssertFalse(notice.isVisible)
        notice.update(isOnline: true, pending: 0)
        XCTAssertTrue(notice.isVisible)
    }

    func testAllSyncedStaysQuietWhenNothingWaited() async {
        let clock = VirtualClock()
        let notice = AllSyncedNotice(sleep: { try await clock.sleep($0) })

        notice.update(isOnline: true, pending: 0)
        notice.update(isOnline: true, pending: 0)
        XCTAssertFalse(notice.isVisible)
    }

    func testAllSyncedNewChangesHideTheNoticeAndItShowsOnlyOncePerDrain() async {
        let clock = VirtualClock()
        let notice = AllSyncedNotice(sleep: { try await clock.sleep($0) })

        notice.update(isOnline: true, pending: 1)
        notice.update(isOnline: true, pending: 0)
        XCTAssertTrue(notice.isVisible)
        notice.update(isOnline: true, pending: 4)
        XCTAssertFalse(notice.isVisible)
        // Die alte Frist darf den neuen Stand nicht berühren
        await clock.advance(5)
        XCTAssertFalse(notice.isVisible)
        notice.update(isOnline: true, pending: 0)
        XCTAssertTrue(notice.isVisible)
        notice.update(isOnline: true, pending: 0)
        await clock.advance(3.1)
        XCTAssertFalse(notice.isVisible)
    }

    func testSlideHintRestartsItsPeriodOnEveryTap() async {
        let clock = VirtualClock()
        let notice = TimedNotice(duration: .seconds(5), sleep: { try await clock.sleep($0) })

        XCTAssertFalse(notice.isVisible)
        notice.show()
        XCTAssertTrue(notice.isVisible)
        await clock.advance(4)
        notice.show()
        await clock.advance(4)
        XCTAssertTrue(notice.isVisible)
        await clock.advance(1.5)
        XCTAssertFalse(notice.isVisible)
    }

    func testSlideHintHidesAtOnce() async {
        let clock = VirtualClock()
        let notice = TimedNotice(duration: .seconds(5), sleep: { try await clock.sleep($0) })

        notice.show()
        notice.hide()
        XCTAssertFalse(notice.isVisible)
        await clock.advance(6)
        XCTAssertFalse(notice.isVisible)
    }
}

/// UX-50: Ablaufhinweis am letzten Tag und am Tag davor auch in der Schreibfläche
final class ExpiryLineTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    private func date(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso)!
    }

    private var now: Date { date("2026-11-11T20:00:00Z") }

    func testLineAppearsOnTheLastDayAndTheDayBefore() {
        XCTAssertEqual(
            ProfileExpiry.pageLine(expiry: date("2026-11-11T23:00:00Z"), now: now, calendar: calendar),
            "App läuft heute ab. Am Mac über Xcode neu aufspielen.")
        XCTAssertEqual(
            ProfileExpiry.pageLine(expiry: date("2026-11-12T08:00:00Z"), now: now, calendar: calendar),
            "App läuft noch 1 Tag. Am Mac über Xcode neu aufspielen.")
    }

    func testLineStaysAwayEarlierThanTheDayBefore() {
        XCTAssertNil(ProfileExpiry.pageLine(expiry: date("2026-11-13T08:00:00Z"), now: now, calendar: calendar))
        XCTAssertNil(ProfileExpiry.pageLine(expiry: date("2026-11-18T08:00:00Z"), now: now, calendar: calendar))
        // Der Startbildschirm warnt dagegen schon 2 Tage vorher
        XCTAssertNotNil(ProfileExpiry.notice(expiry: date("2026-11-13T08:00:00Z"), now: now, calendar: calendar))
    }

    func testPendingChangesAreNamed() {
        XCTAssertEqual(
            ProfileExpiry.pageLine(
                expiry: date("2026-11-12T08:00:00Z"), now: now, pendingChanges: 37, calendar: calendar),
            "App läuft noch 1 Tag. Am Mac über Xcode neu aufspielen. Vorher mit dem Mac verbinden, 37 Änderungen warten.")
        XCTAssertEqual(
            ProfileExpiry.notice(
                expiry: date("2026-11-11T23:00:00Z"), now: now, pendingChanges: 1, calendar: calendar),
            "App läuft heute ab. Am Mac über Xcode neu aufspielen. Vorher mit dem Mac verbinden, 1 Änderung wartet.")
        XCTAssertEqual(
            ProfileExpiry.notice(
                expiry: date("2026-11-11T23:00:00Z"), now: now, pendingChanges: 0, calendar: calendar),
            "App läuft heute ab. Am Mac über Xcode neu aufspielen.")
    }
}

/// UX-51: Das Banner „Diese Seite gehört nicht dazu“ nur bei anderem Modul
final class BindingBannerTests: XCTestCase {
    private func shows(
        shownModule: String? = "m1", runningModule: String? = "m2", session: String? = "s1",
        dismissed: Set<String> = [], runningNotebook: String? = "n2"
    ) -> Bool {
        InkBindingCheck.showsBanner(
            shownNotebookID: "n1", shownModuleID: shownModule, runningNotebookID: runningNotebook,
            runningModuleID: runningModule, runningSessionID: session, dismissedSessionIDs: dismissed)
    }

    func testNoBannerForTheSameModule() {
        XCTAssertFalse(shows(shownModule: "m1", runningModule: "m1"))
    }

    func testBannerForAnotherModule() {
        XCTAssertTrue(shows())
        // Die lokale Testseite hat kein Modul
        XCTAssertTrue(shows(shownModule: nil))
    }

    func testNoBannerWithoutARunningLecture() {
        XCTAssertFalse(shows(runningModule: nil, session: nil, runningNotebook: nil))
    }

    func testDismissedBannerStaysAwayForThatSessionOnly() {
        XCTAssertFalse(shows(session: "s1", dismissed: ["s1"]))
        XCTAssertTrue(shows(session: "s2", dismissed: ["s1"]))
    }

    @MainActor
    func testStateRemembersDismissedSessions() {
        let state = InkBindingBannerState()
        XCTAssertTrue(state.dismissedSessionIDs.isEmpty)
        state.dismiss(sessionID: "s1")
        XCTAssertEqual(state.dismissedSessionIDs, ["s1"])
    }
}

/// UX-57: Ohne Verbindung heißt die Karte „Lief zuletzt“
@MainActor
final class RunningCardTextTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    private var reported: Date { ISO8601DateFormatter().date(from: "2026-11-11T10:42:00Z")! }

    func testOnlineStillSaysRunningNow() {
        XCTAssertEqual(
            LibraryTexts.runningTitle(
                moduleName: "Analysis I", isOnline: true, reportedAt: reported, calendar: calendar),
            "Läuft gerade: Analysis I")
    }

    func testOfflineNamesTheLastKnownState() {
        XCTAssertEqual(
            LibraryTexts.runningTitle(
                moduleName: "Analysis I", isOnline: false, reportedAt: reported, calendar: calendar),
            "Lief zuletzt: Analysis I · Stand 10:42")
        XCTAssertEqual(
            LibraryTexts.runningTitle(
                moduleName: "Analysis I", isOnline: false, reportedAt: nil, calendar: calendar),
            "Lief zuletzt: Analysis I")
    }

    func testClockTextPadsWithZeros() {
        let early = ISO8601DateFormatter().date(from: "2026-11-11T07:05:00Z")!
        XCTAssertEqual(LibraryTexts.clockText(early, calendar: calendar), "07:05")
    }

    func testServiceRemembersWhenTheSessionWasLastReported() async {
        let h = SyncHarness(health: [])
        let brief = SessionBrief(
            id: "019a4e14-0000-7000-8000-0000000000d1", moduleID: LibraryFixtures.moduleID, state: "laeuft",
            startedAtMS: 1_794_384_000_000, slideDeckID: nil, deleted: false, updatedAtMS: 1)
        XCTAssertNil(h.service.runningReportedAt)

        await h.service.follow(session: brief)
        XCTAssertEqual(h.service.runningReportedAt, h.clock.date)

        await h.clock.advance(60)
        await h.service.follow(session: brief)
        XCTAssertEqual(h.service.runningReportedAt, h.clock.date)

        await h.service.follow(session: nil)
        XCTAssertNil(h.service.runningReportedAt)
        XCTAssertNil(h.service.running)
    }
}
