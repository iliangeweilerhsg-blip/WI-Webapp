import Foundation

/// Zuordnungen `Fingerabdruck → client_id` beider Ebenen einer Seite
struct InkPageTrackers: Codable, Equatable, Sendable {
    var ink = InkStrokeTracker()
    var highlight = InkStrokeTracker()
}

/// Alles, was von einer Seite lokal auf der Platte liegt
struct InkPageSnapshot: Equatable, Sendable {
    /// `PKDrawing.dataRepresentation()` der Schriftebene, `nil` = leer
    var ink: Data?
    /// dasselbe für die Textmarker-Ebene
    var highlight: Data?
    var trackers = InkPageTrackers()
    /// Höchste Nummer der Warteschlange (`SyncOutbox.lastNumber`) zum Zeitpunkt des Speicherns.
    /// Liegt `mark(forPage:)` nach einem Absturz darüber, fehlt der Zeichnung etwas, das schon eingereiht wurde.
    var outboxNumber = 0
    /// Lokaler Stand und Core müssen abgeglichen werden (`InkReconciler`)
    var needsReconcile = false
    /// Die Dateien der Seite gibt es, ließen sich aber nicht lesen oder decodieren (#252). Der Rest des Stands ist dann
    /// leer und sagt nichts über die Seite. Wer so einen Stand bekommt, gleicht nie ab und speichert nie: Ein Abgleich
    /// entfernte am Core alle Striche, Speichern überschriebe die Datei. Eine fehlende Datei (neue Seite) ist
    /// dagegen ein gültiger, leerer Stand.
    var unreadable = false
}

/// Lokale Ablage der Seiten
protocol InkPageStore {
    /// Fehlt die Seite, ist der Stand leer. Ist sie vorhanden, aber nicht lesbar, trägt er `unreadable`.
    func load(pageID: String) -> InkPageSnapshot
    func save(_ snapshot: InkPageSnapshot, pageID: String) throws
}

/// Inhalt von `page.plist`
private struct InkPagePlist: Codable {
    var ink: Data?
    var highlight: Data?
    var trackers: InkPageTrackers
    var outboxNumber: Int
    var needsReconcile: Bool
}

/// Ablage im Ordner „Application Support“ der App: je Seite ein Ordner mit `page.plist`
/// (Zeichnungen, IDs, Stand der Warteschlange). Ältere Stände mit drei Dateien werden gelesen und nach dem
/// ersten erfolgreichen Speichern gelöscht.
struct FileInkPageStore: InkPageStore {
    let root: URL

    init(root: URL) {
        self.root = root
    }

    /// `Application Support/Ink` der App
    static func standard() -> FileInkPageStore {
        let base =
            FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return FileInkPageStore(root: base.appendingPathComponent("Ink", isDirectory: true))
    }

    private static let legacyFiles = ["ink.pkdrawing", "highlight.pkdrawing", "ids.json"]

    /// Ergebnis beim Lesen einer Datei der Seite
    private enum FileRead {
        case missing
        case data(Data)
        case failed
    }

    /// Unterscheidet „gibt es nicht“ von „Lesefehler“. Alles außer „Datei fehlt“ zählt als Fehler.
    private static func read(_ url: URL) -> FileRead {
        do {
            return .data(try Data(contentsOf: url))
        } catch {
            let cocoa = error as? CocoaError
            if cocoa?.code == .fileReadNoSuchFile || cocoa?.code == .fileNoSuchFile {
                return .missing
            }
            let nsError = error as NSError
            if nsError.domain == NSPOSIXErrorDomain, nsError.code == Int(ENOENT) {
                return .missing
            }
            return .failed
        }
    }

    private static var unreadableSnapshot: InkPageSnapshot {
        var snapshot = InkPageSnapshot()
        snapshot.unreadable = true
        return snapshot
    }

    func load(pageID: String) -> InkPageSnapshot {
        let folder = self.folder(for: pageID)
        switch FileInkPageStore.read(folder.appendingPathComponent("page.plist")) {
        case .data(let data):
            guard let plist = try? PropertyListDecoder().decode(InkPagePlist.self, from: data) else {
                return FileInkPageStore.unreadableSnapshot
            }
            return InkPageSnapshot(
                ink: plist.ink,
                highlight: plist.highlight,
                trackers: plist.trackers,
                outboxNumber: plist.outboxNumber,
                needsReconcile: plist.needsReconcile
            )
        case .failed:
            return FileInkPageStore.unreadableSnapshot
        case .missing:
            break
        }
        // Alter Stand: drei einzelne Dateien. Fehlt eine, ist sie leer; ist eine da und nicht lesbar, ist die Seite es auch.
        var snapshot = InkPageSnapshot()
        switch FileInkPageStore.read(folder.appendingPathComponent("ink.pkdrawing")) {
        case .data(let data): snapshot.ink = data
        case .missing: break
        case .failed: return FileInkPageStore.unreadableSnapshot
        }
        switch FileInkPageStore.read(folder.appendingPathComponent("highlight.pkdrawing")) {
        case .data(let data): snapshot.highlight = data
        case .missing: break
        case .failed: return FileInkPageStore.unreadableSnapshot
        }
        switch FileInkPageStore.read(folder.appendingPathComponent("ids.json")) {
        case .data(let data):
            guard let trackers = try? JSONDecoder().decode(InkPageTrackers.self, from: data) else {
                return FileInkPageStore.unreadableSnapshot
            }
            snapshot.trackers = trackers
        case .missing: break
        case .failed: return FileInkPageStore.unreadableSnapshot
        }
        return snapshot
    }

    func save(_ snapshot: InkPageSnapshot, pageID: String) throws {
        let folder = self.folder(for: pageID)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let plist = InkPagePlist(
            ink: snapshot.ink,
            highlight: snapshot.highlight,
            trackers: snapshot.trackers,
            outboxNumber: snapshot.outboxNumber,
            needsReconcile: snapshot.needsReconcile
        )
        let encoder = PropertyListEncoder()
        encoder.outputFormat = .binary
        try encoder.encode(plist).write(to: folder.appendingPathComponent("page.plist"), options: .atomic)
        // Erst nach dem erfolgreichen Schreiben: die alten Dateien werden nicht mehr gebraucht
        for name in FileInkPageStore.legacyFiles {
            let url = folder.appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: url.path) {
                try? FileManager.default.removeItem(at: url)
            }
        }
    }

    /// `Ink/<page_id>/thumb.jpg`: Vorschaubild der Seitenleiste (T1-13)
    func thumbnailURL(pageID: String) -> URL {
        folder(for: pageID).appendingPathComponent("thumb.jpg")
    }

    private func folder(for pageID: String) -> URL {
        // Seiten-IDs sind UUIDs. Alles andere wird entschärft, damit kein Pfad aus dem Ordner herausführt.
        let safe = pageID.filter { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
        return root.appendingPathComponent(safe.isEmpty ? "unbenannt" : safe, isDirectory: true)
    }
}
