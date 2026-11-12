import CoreGraphics
import CryptoKit
import Foundation
import Observation

/// Ergebnis der Prüfung einer heruntergeladenen PDF-Datei
enum SlideDeckVerification: Equatable, Sendable {
    case ok(byteSize: Int)
    case tooLarge
    case notPDF
    case hashMismatch
    case tooFewPages
    case unreadable
}

/// Prüfungen und Hilfen rund um die Datei eines Foliensatzes. Reine Funktionen ohne Zustand.
enum SlideDeckFile {
    /// Ordnername aus der `deck_id`: nur Zeichen, die in einer UUID vorkommen. Kein Pfad aus dem Netz.
    static func isSafeID(_ id: String) -> Bool {
        guard !id.isEmpty, id.count <= 64 else { return false }
        return id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
    }

    /// SHA-256 der Datei, stückweise gelesen (nie die ganze Datei im Speicher)
    static func sha256Hex(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let chunk = try handle.read(upToCount: 1 << 20) ?? Data()
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    static func byteSize(of url: URL) -> Int? {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attributes?[.size] as? NSNumber)?.intValue
    }

    /// Beginnt die Datei mit `%PDF-`?
    static func hasPDFHeader(_ url: URL) -> Bool {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? handle.close() }
        let head = (try? handle.read(upToCount: 5)) ?? Data()
        return head == Data("%PDF-".utf8)
    }

    /// Prüft Größe, Kopfzeile, Prüfsumme und (wenn verlangt) die Seitenzahl. Die Datei kommt nur vom gekoppelten Mac,
    /// und trotzdem wird sie nie ungeprüft gerendert (VERTRAEGE: `deck.sha256` ist die Summe der Datei).
    /// - Parameter pageCount: liefert die Seitenzahl des PDF (in Tests ersetzbar)
    static func verify(
        file: URL, expectedSHA256: String, maxBytes: Int, requiredPages: Int,
        pageCount: (URL) -> Int? = SlideDeckFile.pdfPageCount
    ) -> SlideDeckVerification {
        guard let size = byteSize(of: file), size > 0 else { return .unreadable }
        guard size <= maxBytes else { return .tooLarge }
        guard hasPDFHeader(file) else { return .notPDF }
        guard let actual = try? sha256Hex(of: file) else { return .unreadable }
        guard actual == expectedSHA256.lowercased() else { return .hashMismatch }
        guard let pages = pageCount(file), pages >= max(1, requiredPages) else { return .tooFewPages }
        return .ok(byteSize: size)
    }

    /// Seitenzahl über CoreGraphics (öffnet nur die Struktur, rendert nichts)
    static func pdfPageCount(_ url: URL) -> Int? {
        guard let document = CGPDFDocument(url as CFURL), !document.isEncrypted || document.isUnlocked else { return nil }
        return document.numberOfPages
    }
}

/// Wer bleibt im Speicher, wenn die Obergrenze erreicht ist: Der Satz mit dem ältesten Zugriff fliegt zuerst. Sätze
/// der laufenden Session (`protected`) nie.
enum SlideCachePlan {
    struct Entry: Equatable, Sendable {
        var id: String
        var bytes: Int
        var lastAccess: Date
    }

    static func evictions(entries: [Entry], limit: Int, protected: Set<String>) -> [String] {
        var total = entries.reduce(0) { $0 + $1.bytes }
        guard total > limit else { return [] }
        var result: [String] = []
        for entry in entries.sorted(by: { ($0.lastAccess, $0.id) < ($1.lastAccess, $1.id) })
        where !protected.contains(entry.id) {
            if total <= limit { break }
            result.append(entry.id)
            total -= entry.bytes
        }
        return result
    }
}

/// Foliensätze auf dem iPad: Metadaten und PDF laden, prüfen und ablegen (Plan PR 4, §4.5).
///
/// - Ablage: `Application Support/Slides/<deck_id>/deck.pdf` und `info.json`, vom Backup ausgenommen. Nicht
///   `Caches`: iPadOS darf dort mitten in der Vorlesung löschen.
/// - Das PDF kommt in eine Datei (nie als `Data`), wird gegen `sha256`, Größe und Kopfzeile geprüft und erst dann
///   an den Zielort verschoben. Eine falsche Datei wird verworfen.
/// - Obergrenze 1 GB, ältester Zugriff zuerst, der Satz der laufenden Session nie.
/// - Zwei gleichzeitige `ensure` für denselben Satz teilen sich einen Ladevorgang.
/// - Das Token geht nur in den Header (`CoreClient`), nie in Logs oder Dateinamen.
@MainActor
@Observable
final class SlideDeckStore {
    static let defaultMaxFileBytes = 400 * 1024 * 1024
    static let defaultMaxTotalBytes = 1024 * 1024 * 1024
    /// Eine abgelehnte Datei (Prüfsumme, Größe, kein PDF) wird mit derselben `sha256` so lange nicht erneut geladen.
    /// Sonst zöge jeder Folienwechsel bis zu 400 MB neu.
    static let rejectedRetryInterval: TimeInterval = 10 * 60

    /// Zählt bei jeder Änderung hoch, damit SwiftUI neu zeichnet
    private(set) var revision = 0

    @ObservationIgnored private let directory: URL
    @ObservationIgnored private let client: CoreClient
    @ObservationIgnored private let access: @MainActor () -> (endpoint: CoreEndpoint, token: String)?
    @ObservationIgnored private let canReach: @MainActor () -> Bool
    @ObservationIgnored private let protectedDecks: @MainActor () -> Set<String>
    @ObservationIgnored private let now: @MainActor () -> Date
    @ObservationIgnored private let maxFileBytes: Int
    @ObservationIgnored private let maxTotalBytes: Int
    @ObservationIgnored var onRESTError: (@MainActor (Error) -> Void)?

    @ObservationIgnored private var infos: [String: SlideDeckInfo] = [:]
    @ObservationIgnored private var accessed: [String: Date] = [:]
    @ObservationIgnored private var inflight: [String: _Concurrency.Task<SlideDeckInfo?, Never>] = [:]
    @ObservationIgnored private var rejected: [String: (sha256: String, at: Date)] = [:]

    init(
        directory: URL,
        client: CoreClient,
        access: @escaping @MainActor () -> (endpoint: CoreEndpoint, token: String)?,
        canReach: @escaping @MainActor () -> Bool,
        protectedDecks: @escaping @MainActor () -> Set<String> = { [] },
        now: @escaping @MainActor () -> Date = { Date() },
        maxFileBytes: Int = SlideDeckStore.defaultMaxFileBytes,
        maxTotalBytes: Int = SlideDeckStore.defaultMaxTotalBytes
    ) {
        self.directory = directory
        self.client = client
        self.access = access
        self.canReach = canReach
        self.protectedDecks = protectedDecks
        self.now = now
        self.maxFileBytes = maxFileBytes
        self.maxTotalBytes = maxTotalBytes
        loadFromDisk()
    }

    /// `Application Support/Slides`
    static func standardDirectory() -> URL {
        let base =
            FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("Slides", isDirectory: true)
    }

    // MARK: Lesen

    /// Folie samt Satz, wenn der Satz auf dem iPad liegt
    func info(forSlide slideID: String) -> (deck: SlideDeckInfo, slide: SlideRef)? {
        for deck in infos.values {
            if let slide = deck.slide(withID: slideID) { return (deck, slide) }
        }
        return nil
    }

    func info(forDeck deckID: String) -> SlideDeckInfo? {
        infos[deckID]
    }

    /// Pfad des geprüften PDF, `nil`, wenn der Satz nicht auf dem iPad liegt
    func pdfURL(deckID: String) -> URL? {
        guard infos[deckID] != nil, SlideDeckFile.isSafeID(deckID) else { return nil }
        return pdfFile(deckID)
    }

    // MARK: Laden

    /// Metadaten und PDF holen, falls sie fehlen. Liegt der Satz schon geprüft auf dem iPad, geht das ohne Netz.
    func ensure(deckID: String) async -> SlideDeckInfo? {
        if let known = infos[deckID] {
            touch(deckID)
            return known
        }
        if let running = inflight[deckID] {
            return await running.value
        }
        let task = _Concurrency.Task { [self] in await self.load(deckID: deckID) }
        inflight[deckID] = task
        let result = await task.value
        inflight[deckID] = nil
        return result
    }

    private func load(deckID: String) async -> SlideDeckInfo? {
        guard SlideDeckFile.isSafeID(deckID), canReach(), let access = access() else { return nil }
        let fetched: SlideDeckInfo?
        do {
            fetched = try await client.slideDeck(endpoint: access.endpoint, token: access.token, deckID: deckID)
        } catch {
            onRESTError?(error)
            return nil
        }
        guard var info = fetched, info.deckID == deckID, !info.slides.isEmpty else { return nil }
        if let earlier = rejected[deckID], earlier.sha256 == info.sha256,
            now().timeIntervalSince(earlier.at) < SlideDeckStore.rejectedRetryInterval
        {
            return nil
        }

        let folder = folderURL(deckID)
        let part = folder.appendingPathComponent("deck.pdf.part")
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try? FileManager.default.removeItem(at: part)
            try await client.downloadSlideDeckFile(
                endpoint: access.endpoint, token: access.token, deckID: deckID, to: part)
        } catch {
            try? FileManager.default.removeItem(at: part)
            onRESTError?(error)
            return nil
        }
        guard !_Concurrency.Task.isCancelled else {
            try? FileManager.default.removeItem(at: part)
            return nil
        }

        // Hash und Seitenzahl außerhalb des Main-Actors: Die Datei kann groß sein
        let expected = info.sha256
        let limit = maxFileBytes
        let pages = info.slides.map(\.index).max() ?? 1
        let verdict = await _Concurrency.Task.detached {
            SlideDeckFile.verify(file: part, expectedSHA256: expected, maxBytes: limit, requiredPages: pages)
        }.value
        guard case .ok(let size) = verdict else {
            // Falsche oder beschädigte Datei: weg damit, nie rendern
            try? FileManager.default.removeItem(at: part)
            rejected[deckID] = (expected, now())
            return nil
        }

        let target = pdfFile(deckID)
        do {
            try? FileManager.default.removeItem(at: target)
            try FileManager.default.moveItem(at: part, to: target)
            info.byteSize = size
            let data = try JSONEncoder().encode(info)
            try data.write(to: infoFile(deckID), options: .atomic)
        } catch {
            try? FileManager.default.removeItem(at: part)
            try? FileManager.default.removeItem(at: target)
            return nil
        }
        excludeFromBackup(folder)
        infos[deckID] = info
        accessed[deckID] = now()
        revision += 1
        evictIfNeeded(keeping: deckID)
        return info
    }

    // MARK: Ablage

    private func folderURL(_ deckID: String) -> URL {
        directory.appendingPathComponent(deckID, isDirectory: true)
    }

    private func pdfFile(_ deckID: String) -> URL {
        folderURL(deckID).appendingPathComponent("deck.pdf")
    }

    private func infoFile(_ deckID: String) -> URL {
        folderURL(deckID).appendingPathComponent("info.json")
    }

    /// Liest die geprüften Sätze von der Platte. Ein Satz mit anderer Dateigröße als geprüft zählt nicht (abgeschnitten
    /// oder ersetzt). Reste halber Ladevorgänge werden entfernt.
    private func loadFromDisk() {
        let fileManager = FileManager.default
        guard let folders = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        else { return }
        for folder in folders {
            let name = folder.lastPathComponent
            guard SlideDeckFile.isSafeID(name) else { continue }
            try? fileManager.removeItem(at: folder.appendingPathComponent("deck.pdf.part"))
            guard let data = try? Data(contentsOf: infoFile(name)),
                let info = try? JSONDecoder().decode(SlideDeckInfo.self, from: data),
                info.deckID == name, let expectedSize = info.byteSize,
                SlideDeckFile.byteSize(of: pdfFile(name)) == expectedSize
            else { continue }
            infos[name] = info
            let attributes = try? fileManager.attributesOfItem(atPath: infoFile(name).path)
            accessed[name] = (attributes?[.modificationDate] as? Date) ?? Date(timeIntervalSince1970: 0)
        }
    }

    private func touch(_ deckID: String) {
        let date = now()
        accessed[deckID] = date
        try? FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: infoFile(deckID).path)
    }

    private func excludeFromBackup(_ folder: URL) {
        var url = folder
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }

    private func evictIfNeeded(keeping justStored: String) {
        let entries = infos.map { id, info in
            SlideCachePlan.Entry(
                id: id, bytes: info.byteSize ?? 0, lastAccess: accessed[id] ?? Date(timeIntervalSince1970: 0))
        }
        let protected = protectedDecks().union([justStored])
        let victims = SlideCachePlan.evictions(entries: entries, limit: maxTotalBytes, protected: protected)
        for id in victims {
            try? FileManager.default.removeItem(at: folderURL(id))
            infos[id] = nil
            accessed[id] = nil
        }
        if !victims.isEmpty { revision += 1 }
    }
}
