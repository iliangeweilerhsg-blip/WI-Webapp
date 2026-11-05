// Hilfsschicht über packages/schemas/generated/swift/Schemas.swift (docs/VERTRAEGE.md §11.7).
// Wird von Hand gepflegt und in der CI (Job „Swift-Contract“) gegen alle Beispiele geprüft.
// Die iPad-App übernimmt diese Datei zusammen mit Schemas.swift.
//
// Regeln:
// - Unions (Nachrichten, Operationen, Ereignisse, Seitenelemente) erst über type/kind/name
//   unterscheiden, dann die passende generierte Variante decodieren.
// - Unbekannte type/kind/name werden nicht als Fehler behandelt, sondern als .unknown
//   zurückgegeben und über SGSync.log protokolliert (neuere Server-Version).
// - Bekannte Operation mit unbekanntem Enum-Wert (neuere Server-Version): ebenfalls .unknown,
//   mit stream und seq, damit der Client last_seq trotzdem weiterzählt (VERTRAEGE §11.7).
// - Fehlercodes werden als String gelesen; unbekannte Codes landen in .unknownError.
// - Kodieren immer über SGSync.encode: Pflichtfelder mit null bleiben erhalten (encode(to:) in
//   Schemas.swift), Zeitstempel mit Millisekunden.

import Foundation

enum SGSync {
    /// Protokoll für ignorierte Nachrichten; das iPad hängt hier sein Logging ein
    nonisolated(unsafe) static var log: (String) -> Void = { _ in }

    static func decoder() -> JSONDecoder { newJSONDecoder() }
    static func encoder() -> JSONEncoder { newJSONEncoder() }

    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        try decoder().decode(type, from: data)
    }

    static func encode<T: Encodable>(_ value: T) throws -> Data {
        try encoder().encode(value)
    }
}

/// Nur die Unterscheidungsfelder einer Nachricht
private struct SGEnvelope: Decodable {
    let type: String
    let kind: String?
    let name: String?
    let code: String?
    let stream: String?
    let seq: Int?
    let opID: String?

    enum CodingKeys: String, CodingKey {
        case type, kind, name, code, stream, seq
        case opID = "op_id"
    }
}

enum SGSyncOp {
    case notebookCreate(NotebookCreateOp)
    case notebookUpdate(NotebookUpdateOp)
    case notebookDelete(NotebookDeleteOp)
    case notebookRestore(NotebookRestoreOp)
    case pageCreate(PageCreateOp)
    case pageUpdate(PageUpdateOp)
    case pageDelete(PageDeleteOp)
    case pageRestore(PageRestoreOp)
    case strokeAdd(StrokeAddOp)
    case strokeRemove(StrokeRemoveOp)
    case elementUpsert(SGElementUpsertOp)
    case elementRemove(ElementRemoveOp)
    case drawingSnapshot(DrawingSnapshotOp)
    case sessionStart(SessionStartOp)
    case sessionPause(SessionPauseOp)
    case sessionResume(SessionResumeOp)
    case sessionStop(SessionStopOp)
    case slideChange(SlideChangeOp)
    case markerAdd(MarkerAddOp)
    case markerRemove(MarkerRemoveOp)
    case photoAdd(PhotoAddOp)
    /// Nicht darstellbare Operation: unbekanntes kind, unbekannter Enum-Wert oder unbekanntes
    /// Seitenelement. seq und op_id zählen trotzdem (last_seq, last_op_id)
    case unknown(kind: String, stream: String?, seq: Int?, opID: String?)

    static func decode(_ data: Data) throws -> SGSyncOp {
        let env = try SGSync.decode(SGEnvelope.self, from: data)
        do {
            if let op = try decodeKnown(env.kind ?? "", data) { return op }
            SGSync.log("Unbekannte Operation ignoriert: \(env.kind ?? "-")")
        } catch {
            // Jeder Fehler, nicht nur DecodingError: auch SGSyncError.unknownElement (neuer
            // Elementtyp in element.upsert) darf die Dekodierung nicht abbrechen (VERTRAEGE §11.2)
            SGSync.log("Operation \(env.kind ?? "-") nicht lesbar, ignoriert: \(error)")
        }
        return .unknown(kind: env.kind ?? "", stream: env.stream, seq: env.seq, opID: env.opID)
    }

    private static func decodeKnown(_ kind: String, _ data: Data) throws -> SGSyncOp? {
        let d = SGSync.decoder()
        switch kind {
        case "notebook.create": return .notebookCreate(try d.decode(NotebookCreateOp.self, from: data))
        case "notebook.update": return .notebookUpdate(try d.decode(NotebookUpdateOp.self, from: data))
        case "notebook.delete": return .notebookDelete(try d.decode(NotebookDeleteOp.self, from: data))
        case "notebook.restore": return .notebookRestore(try d.decode(NotebookRestoreOp.self, from: data))
        case "page.create": return .pageCreate(try d.decode(PageCreateOp.self, from: data))
        case "page.update": return .pageUpdate(try d.decode(PageUpdateOp.self, from: data))
        case "page.delete": return .pageDelete(try d.decode(PageDeleteOp.self, from: data))
        case "page.restore": return .pageRestore(try d.decode(PageRestoreOp.self, from: data))
        case "stroke.add": return .strokeAdd(try d.decode(StrokeAddOp.self, from: data))
        case "stroke.remove": return .strokeRemove(try d.decode(StrokeRemoveOp.self, from: data))
        case "element.upsert": return .elementUpsert(try d.decode(SGElementUpsertOp.self, from: data))
        case "element.remove": return .elementRemove(try d.decode(ElementRemoveOp.self, from: data))
        case "drawing.snapshot": return .drawingSnapshot(try d.decode(DrawingSnapshotOp.self, from: data))
        case "session.start": return .sessionStart(try d.decode(SessionStartOp.self, from: data))
        case "session.pause": return .sessionPause(try d.decode(SessionPauseOp.self, from: data))
        case "session.resume": return .sessionResume(try d.decode(SessionResumeOp.self, from: data))
        case "session.stop": return .sessionStop(try d.decode(SessionStopOp.self, from: data))
        case "slide.change": return .slideChange(try d.decode(SlideChangeOp.self, from: data))
        case "marker.add": return .markerAdd(try d.decode(MarkerAddOp.self, from: data))
        case "marker.remove": return .markerRemove(try d.decode(MarkerRemoveOp.self, from: data))
        case "photo.add": return .photoAdd(try d.decode(PhotoAddOp.self, from: data))
        default: return nil
        }
    }

    func encode() throws -> Data {
        switch self {
        case .notebookCreate(let v): return try SGSync.encode(v)
        case .notebookUpdate(let v): return try SGSync.encode(v)
        case .notebookDelete(let v): return try SGSync.encode(v)
        case .notebookRestore(let v): return try SGSync.encode(v)
        case .pageCreate(let v): return try SGSync.encode(v)
        case .pageUpdate(let v): return try SGSync.encode(v)
        case .pageDelete(let v): return try SGSync.encode(v)
        case .pageRestore(let v): return try SGSync.encode(v)
        case .strokeAdd(let v): return try SGSync.encode(v)
        case .strokeRemove(let v): return try SGSync.encode(v)
        case .elementUpsert(let v): return try SGSync.encode(v)
        case .elementRemove(let v): return try SGSync.encode(v)
        case .drawingSnapshot(let v): return try SGSync.encode(v)
        case .sessionStart(let v): return try SGSync.encode(v)
        case .sessionPause(let v): return try SGSync.encode(v)
        case .sessionResume(let v): return try SGSync.encode(v)
        case .sessionStop(let v): return try SGSync.encode(v)
        case .slideChange(let v): return try SGSync.encode(v)
        case .markerAdd(let v): return try SGSync.encode(v)
        case .markerRemove(let v): return try SGSync.encode(v)
        case .photoAdd(let v): return try SGSync.encode(v)
        case .unknown(let kind, _, _, _): throw SGSyncError.notEncodable("Operation \(kind)")
        }
    }
}

enum SGSyncEvent {
    case sessionUpdated(SyncSessionUpdatedEvent)
    case presence(SyncPresenceEvent)
    case deviceConnection(SyncConnectionEvent)
    case pairingRequested(SyncPairingEvent)
    case unknown(name: String)

    static func decode(_ data: Data) throws -> SGSyncEvent {
        let env = try SGSync.decode(SGEnvelope.self, from: data)
        let d = SGSync.decoder()
        switch env.name ?? "" {
        case "session.updated": return .sessionUpdated(try d.decode(SyncSessionUpdatedEvent.self, from: data))
        case "presence": return .presence(try d.decode(SyncPresenceEvent.self, from: data))
        case "device.connection": return .deviceConnection(try d.decode(SyncConnectionEvent.self, from: data))
        case "pairing.requested": return .pairingRequested(try d.decode(SyncPairingEvent.self, from: data))
        default:
            SGSync.log("Unbekanntes Ereignis ignoriert: \(env.name ?? "-")")
            return .unknown(name: env.name ?? "")
        }
    }

    func encode() throws -> Data {
        switch self {
        case .sessionUpdated(let v): return try SGSync.encode(v)
        case .presence(let v): return try SGSync.encode(v)
        case .deviceConnection(let v): return try SGSync.encode(v)
        case .pairingRequested(let v): return try SGSync.encode(v)
        case .unknown(let name): throw SGSyncError.notEncodable("Ereignis \(name)")
        }
    }
}

/// Fehler mit unbekanntem Code: nur die Felder, die der Client für die Warteschlange braucht
struct SGUnknownSyncError: Decodable {
    let code: String
    let message: String
    let opID: String?
    let retryable: Bool
    let fatal: Bool

    enum CodingKeys: String, CodingKey {
        case code, message, retryable, fatal
        case opID = "op_id"
    }
}

enum SGServerMessage {
    case welcome(SyncWelcome)
    case subscribed(SyncSubscribed)
    case ack(SyncACK)
    case op(SGSyncOp)
    case timePong(SyncTimePong)
    case pong(SyncPong)
    case error(SyncError)
    case unknownError(SGUnknownSyncError)
    case event(SGSyncEvent)
    case unknown(type: String)

    static func decode(_ data: Data) throws -> SGServerMessage {
        let env = try SGSync.decode(SGEnvelope.self, from: data)
        let d = SGSync.decoder()
        switch env.type {
        case "welcome": return .welcome(try d.decode(SyncWelcome.self, from: data))
        case "subscribed": return .subscribed(try d.decode(SyncSubscribed.self, from: data))
        case "ack": return .ack(try d.decode(SyncACK.self, from: data))
        case "op": return .op(try SGSyncOp.decode(data))
        case "time.pong": return .timePong(try d.decode(SyncTimePong.self, from: data))
        case "pong": return .pong(try d.decode(SyncPong.self, from: data))
        case "error":
            if let code = env.code, SyncErrorCode(rawValue: code) != nil {
                return .error(try d.decode(SyncError.self, from: data))
            }
            SGSync.log("Unbekannter Fehlercode: \(env.code ?? "-")")
            return .unknownError(try d.decode(SGUnknownSyncError.self, from: data))
        case "event": return .event(try SGSyncEvent.decode(data))
        default:
            SGSync.log("Unbekannte Nachricht ignoriert: \(env.type)")
            return .unknown(type: env.type)
        }
    }

    func encode() throws -> Data {
        switch self {
        case .welcome(let v): return try SGSync.encode(v)
        case .subscribed(let v): return try SGSync.encode(v)
        case .ack(let v): return try SGSync.encode(v)
        case .op(let v): return try v.encode()
        case .timePong(let v): return try SGSync.encode(v)
        case .pong(let v): return try SGSync.encode(v)
        case .error(let v): return try SGSync.encode(v)
        case .event(let v): return try v.encode()
        case .unknownError(let v): throw SGSyncError.notEncodable("Fehler \(v.code)")
        case .unknown(let type): throw SGSyncError.notEncodable("Nachricht \(type)")
        }
    }
}

enum SGClientMessage {
    case hello(SyncHello)
    case subscribe(SyncSubscribe)
    case unsubscribe(SyncUnsubscribe)
    case timePing(SyncTimePing)
    case timeOffset(SyncTimeOffset)
    case ping(SyncPing)
    case presence(SyncPresence)
    case op(SGSyncOp)
    case unknown(type: String)

    static func decode(_ data: Data) throws -> SGClientMessage {
        let env = try SGSync.decode(SGEnvelope.self, from: data)
        let d = SGSync.decoder()
        switch env.type {
        case "hello": return .hello(try d.decode(SyncHello.self, from: data))
        case "subscribe": return .subscribe(try d.decode(SyncSubscribe.self, from: data))
        case "unsubscribe": return .unsubscribe(try d.decode(SyncUnsubscribe.self, from: data))
        case "time.ping": return .timePing(try d.decode(SyncTimePing.self, from: data))
        case "time.offset": return .timeOffset(try d.decode(SyncTimeOffset.self, from: data))
        case "ping": return .ping(try d.decode(SyncPing.self, from: data))
        case "presence": return .presence(try d.decode(SyncPresence.self, from: data))
        case "op": return .op(try SGSyncOp.decode(data))
        default:
            SGSync.log("Unbekannte Nachricht ignoriert: \(env.type)")
            return .unknown(type: env.type)
        }
    }

    func encode() throws -> Data {
        switch self {
        case .hello(let v): return try SGSync.encode(v)
        case .subscribe(let v): return try SGSync.encode(v)
        case .unsubscribe(let v): return try SGSync.encode(v)
        case .timePing(let v): return try SGSync.encode(v)
        case .timeOffset(let v): return try SGSync.encode(v)
        case .ping(let v): return try SGSync.encode(v)
        case .presence(let v): return try SGSync.encode(v)
        case .op(let v): return try v.encode()
        case .unknown(let type): throw SGSyncError.notEncodable("Nachricht \(type)")
        }
    }
}

/// Seitenelement als echte Union. quicktype fasst PageElement zu einem Struct mit optionalen
/// Feldern zusammen, das Pflichtfelder mit null nicht erhält; darum hier von Hand.
enum SGPageElement: Codable {
    case text(TextElement)
    case image(ImageElement)
    case shape(ShapeElement)
    case tape(TapeElement)
    case stamp(StampElement)

    private enum Keys: String, CodingKey { case kind }

    init(from decoder: Decoder) throws {
        let kind = try decoder.container(keyedBy: Keys.self).decode(String.self, forKey: .kind)
        switch kind {
        case "text": self = .text(try TextElement(from: decoder))
        case "image": self = .image(try ImageElement(from: decoder))
        case "shape": self = .shape(try ShapeElement(from: decoder))
        case "tape": self = .tape(try TapeElement(from: decoder))
        case "stamp": self = .stamp(try StampElement(from: decoder))
        default:
            // Ein unbekanntes Element kann nicht dargestellt werden; der Aufrufer überspringt es
            SGSync.log("Unbekanntes Seitenelement: \(kind)")
            throw SGSyncError.unknownElement(kind)
        }
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .text(let v): try v.encode(to: encoder)
        case .image(let v): try v.encode(to: encoder)
        case .shape(let v): try v.encode(to: encoder)
        case .tape(let v): try v.encode(to: encoder)
        case .stamp(let v): try v.encode(to: encoder)
        }
    }
}

/// element.upsert mit SGPageElement statt des zusammengefassten PageElement
struct SGElementUpsertData: Codable {
    let pageID: String
    let element: SGPageElement

    enum CodingKeys: String, CodingKey {
        case pageID = "page_id"
        case element
    }
}

struct SGElementUpsertOp: Codable {
    let type: String
    let opID: String
    let stream: String
    let kind: String
    let at: Int
    let clockUncertain: Bool
    let data: SGElementUpsertData
    let seq: Int?
    let origin: SyncOrigin?

    enum CodingKeys: String, CodingKey {
        case type, stream, kind, at, data, seq, origin
        case opID = "op_id"
        case clockUncertain = "clock_uncertain"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
        try container.encode(opID, forKey: .opID)
        try container.encode(stream, forKey: .stream)
        try container.encode(kind, forKey: .kind)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encodeIfPresent(origin, forKey: .origin)
    }
}

enum SGSyncError: Error {
    case notEncodable(String)
    case unknownElement(String)
}

/// GET /pages/{id}: wie PageDetail, aber mit SGPageElement statt des zusammengefassten PageElement
struct SGPageDetail: Codable {
    let page: Page
    let elements: [SGPageElement]
    let streamSeq: Int
    let streamOpID: String?

    enum CodingKeys: String, CodingKey {
        case page, elements
        case streamSeq = "stream_seq"
        case streamOpID = "stream_op_id"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(page, forKey: .page)
        try container.encode(elements, forKey: .elements)
        try container.encode(streamSeq, forKey: .streamSeq)
        try container.encode(streamOpID, forKey: .streamOpID)
    }
}
