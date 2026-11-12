import CoreGraphics
import Foundation

/// Was „Seite weiter“ oder „Seite zurück“ bewirkt
enum InkPageStep: Equatable {
    /// Zu dieser Seite wechseln
    case go(pageID: String)
    /// Hinter der letzten Seite eine neue anlegen
    case newPage
    /// Bleibt auf der Seite (erste Seite, oder letzte Seite ist noch leer)
    case stay
}

/// Blättern, Anzeige und Folgeseite. Reine Funktionen, damit die Regeln testbar sind (T1-13 Teil 1).
enum InkPaging {
    /// - Parameters:
    ///   - pages: sichtbare Seiten des Notizbuchs in Reihenfolge
    ///   - currentID: offene Seite
    ///   - direction: +1 weiter, -1 zurück
    ///   - currentHasStrokes: Die offene Seite hat mindestens einen Strich. Nur dann legt „weiter“ auf der letzten
    ///     Seite eine neue an, sonst entstünde beim Wischen eine Kette leerer Seiten.
    static func step(pages: [LibraryPage], currentID: String, direction: Int, currentHasStrokes: Bool) -> InkPageStep {
        guard let index = pages.firstIndex(where: { $0.id == currentID }) else { return .stay }
        if direction < 0 {
            return index > 0 ? .go(pageID: pages[index - 1].id) : .stay
        }
        if index + 1 < pages.count {
            return .go(pageID: pages[index + 1].id)
        }
        return currentHasStrokes ? .newPage : .stay
    }

    /// Vorlage einer neuen Folgeseite: die der aktuellen, bei „Folie“ blanko
    static func template(after page: LibraryPage) -> PageTemplate {
        page.template == .folie ? .blanko : page.template
    }

    /// Format einer neuen Folgeseite: das der aktuellen, bei „Folie“ A4 hochkant
    static func size(after page: LibraryPage) -> CGSize {
        if page.template == .folie {
            return CGSize(width: LibraryPage.a4Width, height: LibraryPage.a4Height)
        }
        return CGSize(width: page.widthPt, height: page.heightPt)
    }

    /// Welche Seite nach dem Löschen offen ist: die, die an die Stelle der gelöschten rückt, sonst die davor.
    /// `nil`, wenn keine Seite übrig ist (dann legt `openTarget` eine neue an).
    static func pageAfterDeleting(index: Int, remaining: [LibraryPage]) -> String? {
        guard !remaining.isEmpty else { return nil }
        return remaining[min(max(0, index), remaining.count - 1)].id
    }

    /// „Seite 3 / 12“
    static func positionText(index: Int?, count: Int) -> String {
        guard let index, count > 0 else { return "Seite" }
        return "Seite \(index + 1) / \(count)"
    }
}
