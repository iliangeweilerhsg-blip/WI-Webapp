import Foundation

/// Restlaufzeit der Signatur (UX-13). Mit dem kostenlosen Personal Team gilt das Provisioning-Profil 7 Tage.
/// Die App liest sein Ablaufdatum aus `embedded.mobileprovision`. Fehlt die Datei (Simulator, App Store),
/// gibt es nichts anzuzeigen.
enum ProfileExpiry {
    /// Ab so vielen Tagen Rest erscheint der Hinweis
    static let warnDays = 2

    /// Ganze Kalendertage von `now` bis zum Ablauf. Am Ablauftag 0, danach negativ.
    static func daysRemaining(expiry: Date, now: Date, calendar: Calendar = .current) -> Int {
        let from = calendar.startOfDay(for: now)
        let to = calendar.startOfDay(for: expiry)
        return calendar.dateComponents([.day], from: from, to: to).day ?? 0
    }

    /// Ab so vielen Tagen Rest steht der Hinweis auch als Infozeile in der Schreibfläche (letzter Tag und Tag davor)
    static let lineDays = 1

    /// Hinweistext, `nil` solange noch genug Zeit bleibt. Warten noch Änderungen (UX-50), nennt der Text das.
    static func notice(
        expiry: Date, now: Date, pendingChanges: Int = 0, calendar: Calendar = .current
    ) -> String? {
        let days = daysRemaining(expiry: expiry, now: now, calendar: calendar)
        guard days <= warnDays else { return nil }
        let base: String
        if days <= 0 {
            base = "App läuft heute ab. Am Mac über Xcode neu aufspielen."
        } else if days == 1 {
            base = "App läuft noch 1 Tag. Am Mac über Xcode neu aufspielen."
        } else {
            base = "App läuft noch \(days) Tage. Am Mac über Xcode neu aufspielen."
        }
        guard let waiting = InkPageTitle.pendingPhrase(pendingChanges) else { return base }
        return "\(base) Vorher mit dem Mac verbinden, \(waiting)."
    }

    /// Infozeile der Schreibfläche: nur am letzten Tag und am Tag davor, sonst `nil`
    static func pageLine(
        expiry: Date, now: Date, pendingChanges: Int = 0, calendar: Calendar = .current
    ) -> String? {
        guard daysRemaining(expiry: expiry, now: now, calendar: calendar) <= lineDays else { return nil }
        return notice(expiry: expiry, now: now, pendingChanges: pendingChanges, calendar: calendar)
    }

    /// Schneidet den Plist-Teil aus dem signierten Profil (CMS-Hülle mit XML-Plist darin) und liest `ExpirationDate`
    static func expirationDate(fromProfile data: Data) -> Date? {
        guard
            let start = data.range(of: Data("<?xml".utf8)),
            let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex)
        else { return nil }
        let plistData = data.subdata(in: start.lowerBound..<end.upperBound)
        guard
            let object = try? PropertyListSerialization.propertyList(from: plistData, options: [], format: nil),
            let dictionary = object as? [String: Any]
        else { return nil }
        return dictionary["ExpirationDate"] as? Date
    }

    /// Ablaufdatum des Profils dieser App, `nil` ohne Profil
    static func currentExpiry(bundle: Bundle = .main) -> Date? {
        guard
            let url = bundle.url(forResource: "embedded", withExtension: "mobileprovision"),
            let data = try? Data(contentsOf: url)
        else { return nil }
        return expirationDate(fromProfile: data)
    }

    /// Hinweis für den Startbildschirm, `nil` wenn nichts anzuzeigen ist
    static func currentNotice(now: Date = Date(), pendingChanges: Int = 0) -> String? {
        guard let expiry = currentExpiry() else { return nil }
        return notice(expiry: expiry, now: now, pendingChanges: pendingChanges)
    }
}
