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
}

/// Lokale Ablage der Seiten
protocol InkPageStore {
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

    func load(pageID: String) -> InkPageSnapshot {
        let folder = self.folder(for: pageID)
        if let data = try? Data(contentsOf: folder.appendingPathComponent("page.plist")),
            let plist = try? PropertyListDecoder().decode(InkPagePlist.self, from: data)
        {
            return InkPageSnapshot(
                ink: plist.ink,
                highlight: plist.highlight,
                trackers: plist.trackers,
                outboxNumber: plist.outboxNumber,
                needsReconcile: plist.needsReconcile
            )
        }
        // Alter Stand: drei einzelne Dateien
        var snapshot = InkPageSnapshot()
        snapshot.ink = try? Data(contentsOf: folder.appendingPathComponent("ink.pkdrawing"))
        snapshot.highlight = try? Data(contentsOf: folder.appendingPathComponent("highlight.pkdrawing"))
        if let data = try? Data(contentsOf: folder.appendingPathComponent("ids.json")),
            let trackers = try? JSONDecoder().decode(InkPageTrackers.self, from: data)
        {
            snapshot.trackers = trackers
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

    private func folder(for pageID: String) -> URL {
        // Seiten-IDs sind UUIDs. Alles andere wird entschärft, damit kein Pfad aus dem Ordner herausführt.
        let safe = pageID.filter { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
        return root.appendingPathComponent(safe.isEmpty ? "unbenannt" : safe, isDirectory: true)
    }
}
