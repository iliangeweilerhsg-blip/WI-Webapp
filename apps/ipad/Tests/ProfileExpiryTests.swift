import XCTest

@testable import StudienGehirn

final class ProfileExpiryTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    private func date(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso)!
    }

    // MARK: Tage bis Ablauf

    func testDaysRemainingCountsCalendarDays() {
        let now = date("2026-11-11T20:00:00Z")
        XCTAssertEqual(ProfileExpiry.daysRemaining(expiry: date("2026-11-13T06:00:00Z"), now: now, calendar: calendar), 2)
        XCTAssertEqual(ProfileExpiry.daysRemaining(expiry: date("2026-11-11T23:59:00Z"), now: now, calendar: calendar), 0)
        XCTAssertEqual(ProfileExpiry.daysRemaining(expiry: date("2026-11-18T00:00:00Z"), now: now, calendar: calendar), 7)
        XCTAssertEqual(ProfileExpiry.daysRemaining(expiry: date("2026-11-10T12:00:00Z"), now: now, calendar: calendar), -1)
    }

    // MARK: Hinweis

    func testNoNoticeWhileThereIsEnoughTime() {
        let now = date("2026-11-11T08:00:00Z")
        XCTAssertNil(ProfileExpiry.notice(expiry: date("2026-11-14T08:00:00Z"), now: now, calendar: calendar))
        XCTAssertNil(ProfileExpiry.notice(expiry: date("2026-11-18T08:00:00Z"), now: now, calendar: calendar))
    }

    func testNoticeFromTwoDaysOn() {
        let now = date("2026-11-11T08:00:00Z")
        XCTAssertEqual(
            ProfileExpiry.notice(expiry: date("2026-11-13T08:00:00Z"), now: now, calendar: calendar),
            "App läuft noch 2 Tage. Am Mac über Xcode neu aufspielen.")
        XCTAssertEqual(
            ProfileExpiry.notice(expiry: date("2026-11-12T08:00:00Z"), now: now, calendar: calendar),
            "App läuft noch 1 Tag. Am Mac über Xcode neu aufspielen.")
        XCTAssertEqual(
            ProfileExpiry.notice(expiry: date("2026-11-11T18:00:00Z"), now: now, calendar: calendar),
            "App läuft heute ab. Am Mac über Xcode neu aufspielen.")
    }

    // MARK: Plist aus dem Profil

    /// Nachbau eines signierten Profils: Binärer Rahmen um eine XML-Plist
    private func profileData(expiry: String?) -> Data {
        var plist = """
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            <plist version="1.0">
            <dict>
                <key>Name</key>
                <string>iOS Team Provisioning Profile</string>
            """
        if let expiry {
            plist += "\n    <key>ExpirationDate</key>\n    <date>\(expiry)</date>"
        }
        plist += "\n</dict>\n</plist>"
        var data = Data([0x30, 0x82, 0x0A, 0xFF, 0x06, 0x09, 0x00, 0x80])
        data.append(Data(plist.utf8))
        data.append(Data([0x00, 0x81, 0xFE, 0x30, 0x82]))
        return data
    }

    func testReadsExpirationDateFromEmbeddedPlist() {
        let data = profileData(expiry: "2026-11-18T09:30:00Z")
        XCTAssertEqual(ProfileExpiry.expirationDate(fromProfile: data), date("2026-11-18T09:30:00Z"))
    }

    func testProfileWithoutExpirationDateGivesNil() {
        XCTAssertNil(ProfileExpiry.expirationDate(fromProfile: profileData(expiry: nil)))
    }

    func testGarbageGivesNil() {
        XCTAssertNil(ProfileExpiry.expirationDate(fromProfile: Data([0x01, 0x02, 0x03])))
        XCTAssertNil(ProfileExpiry.expirationDate(fromProfile: Data("<?xml kaputt".utf8)))
    }
}
