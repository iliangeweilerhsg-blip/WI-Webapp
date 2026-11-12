// Swift-Contract (CI-Job, docs/VERTRAEGE.md §11.7): alle gültigen Beispiele der Sync-Nachrichten,
// der REST-Typen, die das iPad liest, und von Stroke sowie tests/fixtures/strokes decodieren, wieder kodieren und mit dem Original
// vergleichen. Pflichtfelder mit null müssen dabei erhalten bleiben.
// Aufruf: contract-check <Repo-Wurzel>

import Foundation

let repo = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")
let schemas = repo.appendingPathComponent("packages/schemas")
var failures: [String] = []
var checked = 0

func roundtrip<T: Codable>(_ type: T.Type) -> (Data) throws -> Data {
    { data in try SGSync.encode(try SGSync.decode(type, from: data)) }
}

let registry: [String: (Data) throws -> Data] = [
    "Stroke": roundtrip(Stroke.self),
    "PageElement": { try SGSync.encode(try SGSync.decode(SGPageElement.self, from: $0)) },
    // REST-Typen, die das iPad decodiert
    "Device": roundtrip(Device.self),
    "DeviceList": roundtrip(DeviceList.self),
    "PairStartResponse": roundtrip(PairStartResponse.self),
    "PairResponse": roundtrip(PairResponse.self),
    "Notebook": roundtrip(Notebook.self),
    "NotebookList": roundtrip(NotebookList.self),
    "NotebookPages": roundtrip(NotebookPages.self),
    "Page": roundtrip(Page.self),
    "PageStrokes": roundtrip(PageStrokes.self),
    "PageDetail": roundtrip(SGPageDetail.self),
    "Session": roundtrip(Session.self),
    "SessionList": roundtrip(SessionList.self),
    "SessionSnapshot": roundtrip(SessionSnapshot.self),
    "Settings": roundtrip(Settings.self),
    "FileReceipt": roundtrip(FileReceipt.self),
    "SyncOp": { try SGSyncOp.decode($0).encode() },
    "SyncEvent": { try SGSyncEvent.decode($0).encode() },
    "SyncClientMessage": { try SGClientMessage.decode($0).encode() },
    "SyncServerMessage": { try SGServerMessage.decode($0).encode() },
    "SyncHello": roundtrip(SyncHello.self),
    "SyncWelcome": roundtrip(SyncWelcome.self),
    "SyncSubscribe": roundtrip(SyncSubscribe.self),
    "SyncSubscribed": roundtrip(SyncSubscribed.self),
    "SyncUnsubscribe": roundtrip(SyncUnsubscribe.self),
    "SyncTimePing": roundtrip(SyncTimePing.self),
    "SyncTimePong": roundtrip(SyncTimePong.self),
    "SyncTimeOffset": roundtrip(SyncTimeOffset.self),
    "SyncPing": roundtrip(SyncPing.self),
    "SyncPong": roundtrip(SyncPong.self),
    "SyncPresence": roundtrip(SyncPresence.self),
    "SyncAck": roundtrip(SyncACK.self),
    "SyncError": roundtrip(SyncError.self),
    "SyncSessionUpdatedEvent": roundtrip(SyncSessionUpdatedEvent.self),
    "SyncPresenceEvent": roundtrip(SyncPresenceEvent.self),
    "SyncConnectionEvent": roundtrip(SyncConnectionEvent.self),
    "SyncPairingEvent": roundtrip(SyncPairingEvent.self),
    "SyncNotebookChangedEvent": roundtrip(SyncNotebookChangedEvent.self),
    "NotebookCreateOp": roundtrip(NotebookCreateOp.self),
    "NotebookUpdateOp": roundtrip(NotebookUpdateOp.self),
    "NotebookDeleteOp": roundtrip(NotebookDeleteOp.self),
    "NotebookRestoreOp": roundtrip(NotebookRestoreOp.self),
    "PageCreateOp": roundtrip(PageCreateOp.self),
    "PageUpdateOp": roundtrip(PageUpdateOp.self),
    "PageDeleteOp": roundtrip(PageDeleteOp.self),
    "PageRestoreOp": roundtrip(PageRestoreOp.self),
    "StrokeAddOp": roundtrip(StrokeAddOp.self),
    "StrokeRemoveOp": roundtrip(StrokeRemoveOp.self),
    "ElementUpsertOp": roundtrip(SGElementUpsertOp.self),
    "ElementRemoveOp": roundtrip(ElementRemoveOp.self),
    "DrawingSnapshotOp": roundtrip(DrawingSnapshotOp.self),
    "SessionStartOp": roundtrip(SessionStartOp.self),
    "SessionPauseOp": roundtrip(SessionPauseOp.self),
    "SessionResumeOp": roundtrip(SessionResumeOp.self),
    "SessionStopOp": roundtrip(SessionStopOp.self),
    "SlideChangeOp": roundtrip(SlideChangeOp.self),
    "MarkerAddOp": roundtrip(MarkerAddOp.self),
    "MarkerRemoveOp": roundtrip(MarkerRemoveOp.self),
    "PhotoAddOp": roundtrip(PhotoAddOp.self),
]

/// JSON-Werte vergleichen: gleiche Schlüssel (null zählt als vorhanden), Zahlen numerisch
func same(_ a: Any, _ b: Any, _ path: String) -> String? {
    switch (a, b) {
    case (let x as [String: Any], let y as [String: Any]):
        if Set(x.keys) != Set(y.keys) {
            return "\(path): Schlüssel \(x.keys.sorted()) ≠ \(y.keys.sorted())"
        }
        for key in x.keys.sorted() {
            if let diff = same(x[key]!, y[key]!, "\(path).\(key)") { return diff }
        }
        return nil
    case (let x as [Any], let y as [Any]):
        if x.count != y.count { return "\(path): Länge \(x.count) ≠ \(y.count)" }
        for (i, pair) in zip(x, y).enumerated() {
            if let diff = same(pair.0, pair.1, "\(path)[\(i)]") { return diff }
        }
        return nil
    case (is NSNull, is NSNull):
        return nil
    case (let x as String, let y as String):
        return x == y ? nil : "\(path): \"\(x)\" ≠ \"\(y)\""
    case (let x as NSNumber, let y as NSNumber):
        return x.doubleValue == y.doubleValue ? nil : "\(path): \(x) ≠ \(y)"
    default:
        return "\(path): \(type(of: a)) \(a) ≠ \(type(of: b)) \(b)"
    }
}

// Top-Level-Code läuft im Swift-6-Modus auf dem MainActor, die Zähler darum auch
@MainActor
func check(_ label: String, _ original: Data, _ convert: (Data) throws -> Data) {
    checked += 1
    do {
        let encoded = try convert(original)
        let lhs = try JSONSerialization.jsonObject(with: original, options: [.fragmentsAllowed])
        let rhs = try JSONSerialization.jsonObject(with: encoded, options: [.fragmentsAllowed])
        if let diff = same(lhs, rhs, "$") {
            failures.append("\(label): \(diff)\n    kodiert: \(String(decoding: encoded, as: UTF8.self))")
        }
    } catch {
        failures.append("\(label): \(error)")
    }
}

// Welche Typen? Alle $defs aus sync.schema.json, dazu Stroke, PageElement und die REST-Typen des iPads
let syncSchema = try JSONSerialization.jsonObject(
    with: Data(contentsOf: schemas.appendingPathComponent("src/sync.schema.json"))) as! [String: Any]
var scope = Set((syncSchema["$defs"] as! [String: Any]).keys)
scope.formUnion([
    "Stroke", "PageElement", "Device", "DeviceList", "PairStartResponse", "PairResponse", "Notebook", "NotebookList",
    "NotebookPages", "Page", "PageStrokes", "PageDetail", "Session", "SessionList", "SessionSnapshot", "Settings",
    "FileReceipt",
])

let validDir = schemas.appendingPathComponent("examples/valid")
for file in try FileManager.default.contentsOfDirectory(atPath: validDir.path).sorted() where file.hasSuffix(".json") {
    let type = String(file.split(separator: ".")[0])
    guard scope.contains(type) else { continue }
    guard let convert = registry[type] else {
        failures.append("\(file): kein Swift-Typ im Register von main.swift")
        continue
    }
    check(file, try Data(contentsOf: validDir.appendingPathComponent(file)), convert)
}

// Referenz-Striche (08 §4, PR #39)
let strokeDir = repo.appendingPathComponent("tests/fixtures/strokes")
for file in try FileManager.default.contentsOfDirectory(atPath: strokeDir.path).sorted()
where file.hasSuffix(".json") && file.first!.isNumber {
    check("fixtures/strokes/\(file)", try Data(contentsOf: strokeDir.appendingPathComponent(file)), roundtrip([Stroke].self))
}

// Vorwärtskompatibilität: Unbekanntes wird ignoriert, nicht abgelehnt
var logged: [String] = []
SGSync.log = { logged.append($0) }
let futureOp = #"{"type":"op","op_id":"019a4e14-0000-7000-8000-000000000999","stream":"user","kind":"plan.update","at":1,"clock_uncertain":false,"data":{}}"#
if case .op(.unknown(let kind, _, _, _)) = try SGServerMessage.decode(Data(futureOp.utf8)), kind == "plan.update" {} else {
    failures.append("Unbekannte Operation wurde nicht als .unknown erkannt")
}
// Bekannte Operation mit neuem Enum-Wert: überspringen, aber seq weitergeben
let futureEnum = #"{"type":"op","seq":42,"origin":"ipad","op_id":"019a4e14-0000-7000-8000-000000000998","stream":"session:019a4e14-0000-7000-8000-000000000030","kind":"marker.add","at":1,"clock_uncertain":false,"data":{"marker_id":"019a4e14-0000-7000-8000-000000000060","session_id":"019a4e14-0000-7000-8000-000000000030","kind":"idee","t_ms":1,"page_id":null,"position":null,"note":null,"source":"ipad"}}"#
if case .op(.unknown(let kind, let stream, let seq, let opID)) = try SGServerMessage.decode(Data(futureEnum.utf8)),
   kind == "marker.add", seq == 42, stream?.hasPrefix("session:") == true,
   opID == "019a4e14-0000-7000-8000-000000000998" {} else {
    failures.append("Neuer Enum-Wert in bekannter Operation wurde nicht als .unknown mit seq erkannt")
}
// element.upsert mit neuem Elementtyp (SGSyncError.unknownElement): .unknown mit seq und op_id
let futureElement = #"{"type":"op","seq":43,"origin":"web","op_id":"019a4e14-0000-7000-8000-000000000997","stream":"notebook:019a4e14-0000-7000-8000-000000000040","kind":"element.upsert","at":1,"clock_uncertain":false,"data":{"page_id":"019a4e14-0000-7000-8000-000000000050","element":{"kind":"hologram","element_id":"019a4e14-0000-7000-8000-000000000051"}}}"#
if case .op(.unknown(let kind, let stream, let seq, let opID)) = try SGServerMessage.decode(Data(futureElement.utf8)),
   kind == "element.upsert", seq == 43, stream?.hasPrefix("notebook:") == true,
   opID == "019a4e14-0000-7000-8000-000000000997" {} else {
    failures.append("element.upsert mit unbekanntem Elementtyp wurde nicht als .unknown mit seq und op_id erkannt")
}
let futureError = #"{"type":"error","code":"quota_exceeded","message":"x","op_id":"019a4e14-0000-7000-8000-000000000999","retryable":true,"fatal":true}"#
if case .unknownError(let e) = try SGServerMessage.decode(Data(futureError.utf8)), e.retryable, e.code == "quota_exceeded" {} else {
    failures.append("Unbekannter Fehlercode wurde nicht als String gelesen")
}
if case .unknown = try SGServerMessage.decode(Data(#"{"type":"bye"}"#.utf8)) {} else {
    failures.append("Unbekannter Nachrichtentyp wurde nicht ignoriert")
}
// futureElement protokolliert zweimal (SGPageElement und SGSyncOp.decode)
if logged.count != 6 { failures.append("Erwartet 6 Protokolleinträge, erhalten \(logged.count)") }
checked += 5

if failures.isEmpty {
    print("Swift-Contract: \(checked) Prüfungen bestanden")
} else {
    print("Swift-Contract: \(failures.count) von \(checked) Prüfungen fehlgeschlagen")
    for f in failures { print("  ✗ \(f)") }
    exit(1)
}
