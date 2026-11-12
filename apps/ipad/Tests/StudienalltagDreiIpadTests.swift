import XCTest

@testable import StudienGehirn

@MainActor
private final class CountingIdleTimer: IdleTimerSwitch {
    private(set) var writes: [Bool] = []
    var isIdleTimerDisabled = false {
        didSet { writes.append(isIdleTimerDisabled) }
    }
}

/// UX-305, Teil 1: Das iPad bleibt in einer laufenden Vorlesung wach und gibt die Sperre sonst immer frei
@MainActor
final class ScreenWakeLectureTests: XCTestCase {
    func testStaysAwakeOnlyWhenLectureRunsSurfaceVisibleAndAppActive() {
        for lecture in [false, true] {
            for visible in [false, true] {
                for active in [false, true] {
                    let expected = lecture && visible && active
                    XCTAssertEqual(
                        ScreenWakePolicy.shouldStayAwake(
                            lectureRunning: lecture, writingSurfaceVisible: visible, appActive: active),
                        expected)
                }
            }
        }
    }

    func testSetsAndReleasesTheTimerAlongTheLecture() {
        let timer = CountingIdleTimer()
        let wake = ScreenWakeController(timer: timer)

        wake.update(lectureRunning: false, writingSurfaceVisible: true, appActive: true)
        XCTAssertFalse(timer.isIdleTimerDisabled)
        XCTAssertTrue(timer.writes.isEmpty, "ohne Vorlesung wird der Schalter nicht angefasst")

        wake.update(lectureRunning: true, writingSurfaceVisible: true, appActive: true)
        XCTAssertTrue(timer.isIdleTimerDisabled)
        XCTAssertTrue(wake.holdsWake)

        wake.update(lectureRunning: false, writingSurfaceVisible: true, appActive: true)
        XCTAssertFalse(timer.isIdleTimerDisabled)
        XCTAssertFalse(wake.holdsWake)
    }

    func testReleasesWhenLeavingTheSurfaceAndInTheBackground() {
        let timer = CountingIdleTimer()
        let wake = ScreenWakeController(timer: timer)

        wake.update(lectureRunning: true, writingSurfaceVisible: true, appActive: true)
        XCTAssertTrue(timer.isIdleTimerDisabled)
        wake.update(lectureRunning: true, writingSurfaceVisible: false, appActive: true)
        XCTAssertFalse(timer.isIdleTimerDisabled)

        wake.update(lectureRunning: true, writingSurfaceVisible: true, appActive: true)
        XCTAssertTrue(timer.isIdleTimerDisabled)
        wake.update(lectureRunning: true, writingSurfaceVisible: true, appActive: false)
        XCTAssertFalse(timer.isIdleTimerDisabled)
    }

    func testExplicitReleaseAlwaysResets() {
        let timer = CountingIdleTimer()
        let wake = ScreenWakeController(timer: timer)
        wake.update(lectureRunning: true, writingSurfaceVisible: true, appActive: true)
        wake.release()
        XCTAssertFalse(timer.isIdleTimerDisabled)
        // Doppeltes Freigeben schreibt nicht noch einmal
        let count = timer.writes.count
        wake.release()
        XCTAssertEqual(timer.writes.count, count)
    }
}

/// UX-317 und UX-304: ruhige Texte, kein Dialog
final class ReadableFailureTextsTests: XCTestCase {
    func testSaveFailedLineIsCalmAndSaysWhatToDo() {
        let line = InkPageTitle.saveFailedLine
        XCTAssertTrue(line.contains("nicht gespeichert"))
        XCTAssertTrue(line.contains("Striche sind noch da"))
        XCTAssertTrue(line.contains("nicht schließen"))
        XCTAssertTrue(line.contains("Speicher"))
        XCTAssertFalse(line.contains("!"))
    }

    func testMacNotFoundNamesRePairingAfterRestoreWithThePath() {
        let advice = ConnectionError.tunnelMacNotFound.advice
        XCTAssertTrue(advice.contains("wiederhergestellt"))
        XCTAssertTrue(advice.contains("neu gekoppelt"))
        XCTAssertTrue(advice.contains("Kopplung aufheben"))
        XCTAssertFalse(advice.contains("!"))
        XCTAssertEqual(ConnectionError.tunnelMacNotFound.title, "Mac nicht gefunden")
        XCTAssertFalse(ConnectionError.tunnelMacNotFound.needsNewPairing)
    }

    func testHandshakeFailureNamesRePairingWithoutAskingToUnpair() {
        let advice = ConnectionError.tunnelHandshakeFailed.advice
        XCTAssertTrue(advice.contains("wiederhergestellt"))
        XCTAssertTrue(advice.contains("neu gekoppelt"))
        XCTAssertFalse(advice.localizedCaseInsensitiveContains("entkoppel"))
        XCTAssertFalse(advice.localizedCaseInsensitiveContains("aufheben"))
    }
}
