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
}

/// Lokale Ablage der Seiten. Der Abgleich mit dem Mac kommt mit T1-14 dazu.
protocol InkPageStore {
    func load(pageID: String) -> InkPageSnapshot
    func save(_ snapshot: InkPageSnapshot, pageID: String) throws
}

/// Ablage im Ordner „Application Support“ der App: je Seite ein Ordner mit zwei Zeichnungen und den IDs
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

    func load(pageID: String) -> InkPageSnapshot {
        let folder = self.folder(for: pageID)
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
        try write(snapshot.ink, to: folder.appendingPathComponent("ink.pkdrawing"))
        try write(snapshot.highlight, to: folder.appendingPathComponent("highlight.pkdrawing"))
        try JSONEncoder().encode(snapshot.trackers).write(to: folder.appendingPathComponent("ids.json"), options: .atomic)
    }

    private func folder(for pageID: String) -> URL {
        // Seiten-IDs sind UUIDs. Alles andere wird entschärft, damit kein Pfad aus dem Ordner herausführt.
        let safe = pageID.filter { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
        return root.appendingPathComponent(safe.isEmpty ? "unbenannt" : safe, isDirectory: true)
    }

    private func write(_ data: Data?, to url: URL) throws {
        if let data {
            try data.write(to: url, options: .atomic)
        } else if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }
}
