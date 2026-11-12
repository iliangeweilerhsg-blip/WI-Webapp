import Foundation

/// Eine Operation in der Warteschlange. `json` ist die fertig kodierte Nachricht (`SyncOp`) und wird
/// unverändert gesendet. Nur `SyncOutbox.rewrite` ersetzt sie (Uhrkorrektur), danach nie wieder.
struct OutboxEntry: Codable, Equatable, Sendable {
    /// Steigt monoton und wird nie wiederverwendet
    var number: Int
    var opID: String
    /// `notebook:<notebook_id>`
    var stream: String
    /// `notebook.create`, `page.create`, `page.update`, `page.delete`, `stroke.add`, `stroke.remove`
    var kind: String
    /// Seite, auf die sich die Operation bezieht (für Abhängigkeiten und `mark(forPage:)`), `nil` bei `notebook.create`
    var pageID: String?
    var json: String
    /// `at` und `created_at` stammen von einer ungeprüften Uhr und werden vor dem ersten Senden korrigiert
    var clockUncertain: Bool
    /// Start der Session (Uhr des Mac) für `t_start_ms`/`t_end_ms`, nur bei Strichen mit Sitzungszeit
    var sessionStartMS: Int?
}

/// Eine neue Operation, die noch keine Nummer hat
struct OutboxDraft: Equatable, Sendable {
    var opID: String
    var stream: String
    var kind: String
    var pageID: String?
    var json: String
    var clockUncertain: Bool
    var sessionStartMS: Int?
}

/// Zeile in `dead-letter.jsonl`
struct DeadLetterRecord: Codable, Equatable, Sendable {
    var entry: OutboxEntry
    var code: String
    var message: String
    /// ISO 8601, UTC
    var at: String
}

/// Zeile in `outbox.jsonl`. `t` ist `put`, `ack`, `rewrite`, `dead`, `drop` oder `head`.
private struct OutboxLine: Codable {
    var t: String
    var e: OutboxEntry?
    var op: String?
    var next: Int?
    var marks: [String: Int]?
}

/// Ausgangswarteschlange (VERTRAEGE §11.2, F-SYN-03): append-only auf der Platte, **bevor** etwas gesendet wird.
///
/// - `Sync/outbox.jsonl`: Zeilen `put`, `ack`, `rewrite`, `dead` (und nach dem Verdichten eine Kopfzeile `head`).
///   Jede Zeile wird mit `synchronize()` auf die Platte gebracht. Beim Laden wird abgespielt, eine kaputte letzte
///   Zeile wird abgeschnitten.
/// - `Sync/dead-letter.jsonl`: Fehlerablage, nur anhängen, nie automatisch gelöscht.
@MainActor
final class SyncOutbox {
    /// Ab so vielen erledigten Zeilen wird die Datei verdichtet
    static let compactionThreshold = 500
    /// Ab so vielen gepufferten `ack`-Zeilen wird sofort geschrieben
    static let ackFlushThreshold = 100

    /// Zählt die fsyncs der Warteschlange (für Tests)
    private(set) var syncCount = 0

    let deadLetterURL: URL
    /// Unbestätigte Operationen in Reihenfolge der `number`
    private(set) var pending: [OutboxEntry] = []
    private(set) var deadLetterCount = 0

    private let fileURL: URL
    private var pendingIDs = Set<String>()
    /// Wartende `notebook.create`. Bei 0 spart `nextToSend` die Suche über die ganze Warteschlange.
    private var pendingNotebookCreates = 0
    private var nextNumber = 1
    /// Höchste vergebene Nummer je Seite (bleibt nach `ack` erhalten)
    private var marks: [String: Int] = [:]
    private var doneLines = 0
    /// `ack`-Zeilen, die noch nicht auf der Platte stehen (`acknowledgeDeferred`)
    private var unwrittenAcks: [OutboxLine] = []
    /// Länge des gültigen Teils der Datei. Neue Zeilen beginnen genau dort.
    private var fileLength: UInt64 = 0

    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()
    private let decoder = JSONDecoder()

    init(directory: URL) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = directory.appendingPathComponent("outbox.jsonl")
        deadLetterURL = directory.appendingPathComponent("dead-letter.jsonl")
        load()
    }

    /// Höchste vergebene Nummer, 0 = noch nie etwas eingereiht
    var lastNumber: Int { nextNumber - 1 }

    /// Höchste Nummer einer Strich-Operation, die je für diese Seite vergeben wurde, 0 = keine
    func mark(forPage pageID: String) -> Int {
        marks[pageID] ?? 0
    }

    /// Die nächste Operation, die gesendet werden soll: die erste, die noch nicht unterwegs ist. Ausnahme: Wartet in
    /// deren Strom noch ein `notebook.create`, das nicht unterwegs ist, geht es vor. Das kommt vor, wenn es nach einer
    /// neuen `db_epoch` hinten angehängt wurde (hinter `page.create` und Striche desselben Notizbuchs). Die Datei
    /// bleibt unverändert und append-only: Nur die Sendereihenfolge ändert sich, es kann also nichts verloren gehen.
    func nextToSend(inFlight: Set<String>) -> OutboxEntry? {
        guard let first = pending.first(where: { !inFlight.contains($0.opID) }) else { return nil }
        if first.kind == "notebook.create" || pendingNotebookCreates == 0 { return first }
        let create = pending.first {
            $0.kind == "notebook.create" && $0.stream == first.stream && !inFlight.contains($0.opID)
        }
        return create ?? first
    }

    // MARK: Schreiben

    /// Reiht Operationen ein. Erst wenn sie auf der Platte stehen, kehrt die Methode zurück.
    @discardableResult
    func append(_ drafts: [OutboxDraft]) throws -> [OutboxEntry] {
        guard !drafts.isEmpty else { return [] }
        var number = nextNumber
        var entries: [OutboxEntry] = []
        for draft in drafts {
            entries.append(
                OutboxEntry(
                    number: number,
                    opID: draft.opID,
                    stream: draft.stream,
                    kind: draft.kind,
                    pageID: draft.pageID,
                    json: draft.json,
                    clockUncertain: draft.clockUncertain,
                    sessionStartMS: draft.sessionStartMS
                ))
            number += 1
        }
        try writeLines(entries.map { OutboxLine(t: "put", e: $0) })
        for entry in entries {
            add(entry)
        }
        nextNumber = number
        return entries
    }

    /// Ersetzt eine Operation gleicher `op_id` (Uhrkorrektur). Nummer und Platz bleiben.
    func rewrite(_ entry: OutboxEntry) throws {
        guard let index = pending.firstIndex(where: { $0.opID == entry.opID }) else { return }
        try writeLines([OutboxLine(t: "rewrite", e: entry)])
        pending[index] = entry
        doneLines += 1
    }

    /// `ack` des Servers: Operation entfernen. Scheitert das Schreiben, bleibt die Operation in der Datei und
    /// wird nach einem Neustart noch einmal gesendet (der Core bestätigt sie erneut, VERTRAEGE §11.2).
    @discardableResult
    func acknowledge(opID: String) -> Bool {
        guard remove(opID: opID) else { return false }
        try? writeLines([OutboxLine(t: "ack", op: opID)])
        doneLines += 1
        compactIfNeeded()
        return true
    }

    /// Wie `acknowledge`, aber ohne sofortiges fsync: Die Operation verschwindet aus dem Speicher, die `ack`-Zeile
    /// wartet im Puffer, bis `flushAcks()` sie schreibt, spätestens aber mit der nächsten anderen Schreibung oder
    /// ab `ackFlushThreshold` Zeilen. Kein Datenverlust: Geht der Puffer verloren (Absturz), bleibt die Operation
    /// beim Neustart in der Datei stehen und wird noch einmal gesendet. Der Core erkennt die bekannte `op_id` und
    /// bestätigt sie erneut (VERTRAEGE §11.2, Idempotenz). Ein verlorenes `ack`-Persist kostet also nur eine
    /// doppelte Sendung, nie eine Operation.
    @discardableResult
    func acknowledgeDeferred(opID: String) -> Bool {
        guard remove(opID: opID) else { return false }
        unwrittenAcks.append(OutboxLine(t: "ack", op: opID))
        doneLines += 1
        if unwrittenAcks.count >= SyncOutbox.ackFlushThreshold {
            flushAcks()
        }
        compactIfNeeded()
        return true
    }

    /// Schreibt gepufferte `ack`-Zeilen mit einem einzigen fsync. Scheitert das Schreiben, bleibt der Puffer
    /// stehen (gleiche Folgen wie bei `acknowledge`: erneute Sendung nach einem Neustart).
    func flushAcks() {
        guard !unwrittenAcks.isEmpty else { return }
        try? writeLines([])
    }

    /// Anzahl der `ack`-Zeilen im Puffer (für Tests)
    var unwrittenAckCount: Int { unwrittenAcks.count }

    /// Verschiebt Operationen in die Fehlerablage. Die Ablage wird zuerst geschrieben: Es geht nichts verloren.
    /// - Returns: Anzahl der tatsächlich verschobenen Operationen (unbekannte `op_id` zählen nicht)
    @discardableResult
    func moveToDeadLetter(opIDs: [String], code: String, message: String) throws -> Int {
        let wanted = Set(opIDs)
        let victims = pending.filter { wanted.contains($0.opID) }
        guard !victims.isEmpty else { return 0 }

        let at = sgFormatTimestamp(Date())
        var blob = Data()
        for victim in victims {
            blob.append(try encoder.encode(DeadLetterRecord(entry: victim, code: code, message: message, at: at)))
            blob.append(0x0A)
        }
        try appendToDeadLetter(blob)
        deadLetterCount += victims.count

        try? writeLines(victims.map { OutboxLine(t: "dead", op: $0.opID) })
        for victim in victims {
            _ = remove(opID: victim.opID)
        }
        doneLines += victims.count
        compactIfNeeded()
        return victims.count
    }

    /// Entfernt wartende Operationen ohne Bestätigung und ohne Fehlerablage: Eine neuere Operation ersetzt sie
    /// (`page_version_conflict`, VERTRAEGE §11.2). Die Zeile `drop` steht auf der Platte, bevor die Operation
    /// aus dem Speicher verschwindet; scheitert das Schreiben, bleibt alles, wie es war.
    /// - Returns: Anzahl der tatsächlich entfernten Operationen (unbekannte `op_id` zählen nicht)
    @discardableResult
    func discard(opIDs: [String]) throws -> Int {
        let wanted = Set(opIDs)
        let victims = pending.filter { wanted.contains($0.opID) }
        guard !victims.isEmpty else { return 0 }
        try writeLines(victims.map { OutboxLine(t: "drop", op: $0.opID) })
        for victim in victims {
            _ = remove(opID: victim.opID)
        }
        doneLines += victims.count
        compactIfNeeded()
        return victims.count
    }

    // MARK: Intern: Zustand

    private func add(_ entry: OutboxEntry) {
        pending.append(entry)
        pendingIDs.insert(entry.opID)
        if entry.kind == "notebook.create" { pendingNotebookCreates += 1 }
        note(entry)
    }

    private func note(_ entry: OutboxEntry) {
        // Nur Striche ändern die Zeichnung: Seiten-Operationen (`page.create`, `page.update`, `page.delete`) zählen
        // nicht für den Absturzvergleich (`InkPageSnapshot.outboxNumber`)
        if let pageID = entry.pageID, entry.kind == "stroke.add" || entry.kind == "stroke.remove" {
            marks[pageID] = max(marks[pageID] ?? 0, entry.number)
        }
    }

    private func remove(opID: String) -> Bool {
        guard pendingIDs.contains(opID), let index = pending.firstIndex(where: { $0.opID == opID }) else {
            return false
        }
        if pending[index].kind == "notebook.create" { pendingNotebookCreates -= 1 }
        pending.remove(at: index)
        pendingIDs.remove(opID)
        return true
    }

    // MARK: Intern: Datei

    private func load() {
        deadLetterCount = SyncOutbox.countLines(in: deadLetterURL)
        guard let data = try? Data(contentsOf: fileURL), !data.isEmpty else {
            fileLength = 0
            return
        }
        let bytes = [UInt8](data)
        var lineStart = 0
        var validLength = 0
        while lineStart < bytes.count {
            // Ohne abschließenden Zeilenumbruch ist die Zeile nicht fertig geschrieben worden
            guard let newline = bytes[lineStart...].firstIndex(of: 0x0A) else { break }
            let slice = Data(bytes[lineStart..<newline])
            lineStart = newline + 1
            validLength = lineStart
            if slice.isEmpty { continue }
            if let line = try? decoder.decode(OutboxLine.self, from: slice) {
                apply(line)
            }
        }
        if validLength < bytes.count {
            truncateFile(to: UInt64(validLength))
        }
        fileLength = UInt64(validLength)
        compactIfNeeded()
    }

    private func apply(_ line: OutboxLine) {
        switch line.t {
        case "head":
            if let next = line.next {
                nextNumber = max(nextNumber, next)
            }
            for (page, number) in line.marks ?? [:] {
                marks[page] = max(marks[page] ?? 0, number)
            }
        case "put":
            guard let entry = line.e else { return }
            if !pendingIDs.contains(entry.opID) {
                add(entry)
            }
            nextNumber = max(nextNumber, entry.number + 1)
        case "ack", "dead", "drop":
            if let opID = line.op {
                _ = remove(opID: opID)
                doneLines += 1
            }
        case "rewrite":
            if let entry = line.e, let index = pending.firstIndex(where: { $0.opID == entry.opID }) {
                pending[index] = entry
                doneLines += 1
            }
        default:
            break
        }
    }

    private func writeLines(_ newLines: [OutboxLine]) throws {
        // Gepufferte `ack`-Zeilen fahren mit, damit die Reihenfolge in der Datei stimmt
        let buffered = unwrittenAcks.count
        let lines = unwrittenAcks + newLines
        guard !lines.isEmpty else { return }
        var blob = Data()
        for line in lines {
            blob.append(try encoder.encode(line))
            blob.append(0x0A)
        }
        if !FileManager.default.fileExists(atPath: fileURL.path) {
            guard FileManager.default.createFile(atPath: fileURL.path, contents: nil) else {
                throw CocoaError(.fileWriteUnknown)
            }
            fileLength = 0
        }
        let handle = try FileHandle(forWritingTo: fileURL)
        defer { try? handle.close() }
        do {
            // Genau hinter den gültigen Teil: Reste eines früheren, gescheiterten Schreibens werden überschrieben
            try handle.seek(toOffset: fileLength)
            try handle.write(contentsOf: blob)
            try handle.synchronize()
            syncCount += 1
            fileLength += UInt64(blob.count)
            unwrittenAcks.removeFirst(buffered)
        } catch {
            try? handle.truncate(atOffset: fileLength)
            throw error
        }
    }

    private func appendToDeadLetter(_ blob: Data) throws {
        if !FileManager.default.fileExists(atPath: deadLetterURL.path) {
            guard FileManager.default.createFile(atPath: deadLetterURL.path, contents: nil) else {
                throw CocoaError(.fileWriteUnknown)
            }
        }
        let handle = try FileHandle(forWritingTo: deadLetterURL)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: blob)
        try handle.synchronize()
    }

    private func truncateFile(to length: UInt64) {
        guard let handle = try? FileHandle(forWritingTo: fileURL) else { return }
        defer { try? handle.close() }
        try? handle.truncate(atOffset: length)
    }

    private func compactIfNeeded() {
        guard doneLines > SyncOutbox.compactionThreshold else { return }
        var blob = Data()
        do {
            blob.append(try encoder.encode(OutboxLine(t: "head", next: nextNumber, marks: marks)))
            blob.append(0x0A)
            for entry in pending {
                blob.append(try encoder.encode(OutboxLine(t: "put", e: entry)))
                blob.append(0x0A)
            }
            try blob.write(to: fileURL, options: .atomic)
            fileLength = UInt64(blob.count)
            doneLines = 0
            // Die verdichtete Datei enthält nur noch offene Operationen: gepufferte `ack`-Zeilen sind erledigt
            unwrittenAcks.removeAll()
        } catch {
            // Bleibt, wie es ist. Der nächste Versuch kommt mit der nächsten erledigten Zeile.
        }
    }

    private static func countLines(in url: URL) -> Int {
        guard let data = try? Data(contentsOf: url) else { return 0 }
        return data.reduce(0) { $1 == 0x0A ? $0 + 1 : $0 }
    }
}
