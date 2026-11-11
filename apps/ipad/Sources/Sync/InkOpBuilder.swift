import Foundation

/// Baut aus Strichänderungen die Operationen des Sync-Protokolls (VERTRAEGE §11.2, §11.3).
/// Kodiert wird nur über `SGSyncOp` und `SGSync.encoder()`: Pflichtfelder mit `null` bleiben erhalten,
/// `seq` und `origin` fehlen (die setzt nur der Server).
enum InkOpBuilder {
    /// So viele `client_id` je `stroke.remove`, damit eine Nachricht weit unter 1 MB bleibt
    static let maxRemovesPerOp = 500

    /// Operationen für Strichänderungen einer Seite
    /// - Parameters:
    ///   - nowMS: lokale Zeit, zu der die Änderung entstand
    ///   - offsetMS: gemessener Versatz Mac − iPad, `nil` = unbekannt (dann `clock_uncertain = true`)
    ///   - makeID: liefert eine neue `op_id` (UUIDv7, klein)
    static func ops(
        for changes: [InkStrokeChange],
        binding: InkBinding,
        nowMS: Int,
        offsetMS: Int?,
        makeID: () -> String
    ) -> [OutboxDraft] {
        var drafts: [OutboxDraft] = []
        for change in changes {
            switch change {
            case .upsert(let stroke):
                let op = StrokeAddOp(
                    at: nowMS,
                    clockUncertain: true,
                    data: StrokeAddData(pageID: binding.pageID, stroke: stroke),
                    kind: .strokeAdd,
                    opID: makeID(),
                    origin: nil,
                    seq: nil,
                    stream: binding.stream,
                    type: .op
                )
                if let draft = makeDraft(.strokeAdd(op), kind: "stroke.add", binding: binding,
                    sessionStartMS: stroke.tStartMS == nil ? nil : binding.sessionStartMS)
                {
                    drafts.append(draft)
                }
            case .remove(let ids):
                var start = 0
                while start < ids.count {
                    let end = min(ids.count, start + maxRemovesPerOp)
                    let op = StrokeRemoveOp(
                        at: nowMS,
                        clockUncertain: true,
                        data: StrokeRemoveData(clientIDS: Array(ids[start..<end]), pageID: binding.pageID),
                        kind: .strokeRemove,
                        opID: makeID(),
                        origin: nil,
                        seq: nil,
                        stream: binding.stream,
                        type: .op
                    )
                    if let draft = makeDraft(.strokeRemove(op), kind: "stroke.remove", binding: binding, sessionStartMS: nil) {
                        drafts.append(draft)
                    }
                    start = end
                }
            }
        }
        return corrected(drafts, offsetMS: offsetMS)
    }

    /// `page.create` für eine neue Seite: A4, leer (`blanko`), alles andere `null`
    static func pageCreate(
        binding: InkBinding,
        index: Int,
        nowMS: Int,
        offsetMS: Int?,
        makeID: () -> String
    ) -> OutboxDraft? {
        let op = PageCreateOp(
            at: nowMS,
            clockUncertain: true,
            data: PageCreateData(
                attachedSlideID: nil,
                backgroundSlideID: nil,
                heightPt: 842,
                index: index,
                notebookID: binding.notebookID,
                pageID: binding.pageID,
                sessionID: binding.sessionID,
                template: .blanko,
                widthPt: 595
            ),
            kind: .pageCreate,
            opID: makeID(),
            origin: nil,
            seq: nil,
            stream: binding.stream,
            type: .op
        )
        guard let built = makeDraft(.pageCreate(op), kind: "page.create", binding: binding, sessionStartMS: nil) else {
            return nil
        }
        return corrected([built], offsetMS: offsetMS).first
    }

    /// Rechnet eine Operation mit unsicherer Uhr auf die synchronisierte Zeit um (VERTRAEGE §11.5):
    /// `at += o`, `stroke.created_at += o`, `t_start = max(0, created_at − Sessionstart)`,
    /// `t_end = t_start + Dauer`, danach `clock_uncertain = false`. Eine schon korrigierte Operation
    /// bleibt unverändert, ein zweiter Aufruf ändert also nichts.
    /// - Returns: `nil`, wenn die gespeicherte Operation nicht lesbar ist
    static func correct(_ entry: OutboxEntry, offsetMS: Int) -> OutboxEntry? {
        guard entry.clockUncertain else { return entry }
        guard let data = entry.json.data(using: .utf8), let op = try? SGSyncOp.decode(data) else { return nil }

        let corrected: SGSyncOp
        switch op {
        case .strokeAdd(let value):
            var stroke = value.data.stroke
            let createdAt = stroke.createdAt + offsetMS
            var start = stroke.tStartMS
            var end = stroke.tEndMS
            if let sessionStart = entry.sessionStartMS, let oldStart = stroke.tStartMS {
                let duration = max(0, (stroke.tEndMS ?? oldStart) - oldStart)
                let newStart = max(0, createdAt - sessionStart)
                start = newStart
                end = newStart + duration
            }
            stroke = stroke.with(createdAt: createdAt, tEndMS: .some(end), tStartMS: .some(start))
            corrected = .strokeAdd(
                value.with(
                    at: value.at + offsetMS,
                    clockUncertain: false,
                    data: value.data.with(stroke: stroke)
                ))
        case .strokeRemove(let value):
            corrected = .strokeRemove(value.with(at: value.at + offsetMS, clockUncertain: false))
        case .pageCreate(let value):
            corrected = .pageCreate(value.with(at: value.at + offsetMS, clockUncertain: false))
        default:
            return nil
        }
        guard let json = try? text(corrected) else { return nil }
        var result = entry
        result.json = json
        result.clockUncertain = false
        return result
    }

    // MARK: Intern

    private static func makeDraft(
        _ op: SGSyncOp,
        kind: String,
        binding: InkBinding,
        sessionStartMS: Int?
    ) -> OutboxDraft? {
        guard let json = try? text(op), let opID = opID(of: op) else { return nil }
        return OutboxDraft(
            opID: opID,
            stream: binding.stream,
            kind: kind,
            pageID: binding.pageID,
            json: json,
            clockUncertain: true,
            sessionStartMS: sessionStartMS
        )
    }

    private static func opID(of op: SGSyncOp) -> String? {
        switch op {
        case .strokeAdd(let value): return value.opID
        case .strokeRemove(let value): return value.opID
        case .pageCreate(let value): return value.opID
        default: return nil
        }
    }

    private static func text(_ op: SGSyncOp) throws -> String {
        String(decoding: try op.encode(), as: UTF8.self)
    }

    /// Mit bekanntem Versatz sofort auf die synchronisierte Zeit umrechnen
    private static func corrected(_ drafts: [OutboxDraft], offsetMS: Int?) -> [OutboxDraft] {
        guard let offsetMS else { return drafts }
        return drafts.map { draft in
            let entry = OutboxEntry(
                number: 0,
                opID: draft.opID,
                stream: draft.stream,
                kind: draft.kind,
                pageID: draft.pageID,
                json: draft.json,
                clockUncertain: draft.clockUncertain,
                sessionStartMS: draft.sessionStartMS
            )
            guard let fixed = correct(entry, offsetMS: offsetMS) else { return draft }
            var result = draft
            result.json = fixed.json
            result.clockUncertain = fixed.clockUncertain
            return result
        }
    }
}
