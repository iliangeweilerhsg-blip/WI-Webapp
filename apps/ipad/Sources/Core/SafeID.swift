import Foundation

/// Gemeinsame Regel für IDs aus dem Netz, bevor sie in einen REST-Pfad oder einen Dateinamen gehen:
/// ASCII-Buchstaben, Ziffern und `-`, höchstens 64 Zeichen (Review L14). Keine Pfadtrenner, kein `..`, kein `?`.
enum SafeID {
    static let maxLength = 64

    static func isValid(_ id: String) -> Bool {
        guard !id.isEmpty, id.count <= maxLength else { return false }
        return id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
    }
}

/// Grenzen eines Downloads in eine Datei (Review L13)
struct DownloadLimit: Equatable, Sendable {
    /// 10 Minuten Gesamtzeit (für 400 MB). `timeoutInterval` der Anfrage ist nur der Leerlauf-Timeout.
    static let defaultMaxDuration: TimeInterval = 10 * 60

    let maxBytes: Int
    let maxDuration: TimeInterval

    /// Ist die Grenze überschritten? `announced` ist `Content-Length` (oder ein negativer Wert, wenn unbekannt);
    /// `written` zählt die tatsächlich angekommenen Bytes. Beides wird geprüft, weil `Content-Length` fehlen oder
    /// lügen kann.
    func isExceeded(written: Int64, announced: Int64) -> Bool {
        written > Int64(maxBytes) || announced > Int64(maxBytes)
    }
}
