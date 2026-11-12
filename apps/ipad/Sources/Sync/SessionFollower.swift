import Foundation
import Observation

/// Was der Follower vom Core braucht (REST). Eigenes Protokoll, damit Tests ohne Netz laufen.
@MainActor
protocol SessionFollowerBackend: AnyObject {
    /// Laufende oder pausierte Sessions. Wirft bei Netzfehlern.
    func activeSessions() async throws -> [SessionBrief]
    /// Snapshot der Session. `nil` bei 404 (gelöscht).
    func snapshot(sessionID: String) async throws -> SessionSnapshotBrief?
}

/// Was der Follower von der Engine braucht
@MainActor
protocol SessionFeed: AnyObject {
    var onInbound: (@MainActor (SyncInbound) -> Void)? { get set }
    func subscribe(stream: String, lastSeq: Int, lastOpID: String?)
    func unsubscribe(stream: String)
}

extension SyncEngine: SessionFeed {}

/// Folgt der laufenden Session lesend (Plan PR 4, V5): Snapshot laden, `session:<id>` abonnieren, `slide.change`
/// anwenden. Das iPad hält keinen `seq`-Stand über Verbindungen hinweg (E8): Nach jedem `welcome` lädt es den
/// Snapshot neu.
///
/// Regeln:
/// - `seq == letzte + 1` wird angewandt, `seq <= letzte` verworfen, eine Lücke lädt den Snapshot neu.
/// - `subscribed` mit `reset` lädt den Snapshot neu, höchstens alle `reloadInterval`.
/// - Eine ältere Fassung von `session.updated` (`updated_at`) wird verworfen.
/// - Nichts hiervon schreibt in die Warteschlange oder die Bibliothek.
@MainActor
@Observable
final class SessionFollower {
    /// Neu laden (Reset, Lücke) höchstens in diesem Abstand
    static let reloadInterval: TimeInterval = 5
    /// Scheitert das Laden (REST), wird es so oft im Abstand von `reloadInterval` wiederholt. Danach erst wieder bei
    /// einer neuen Verbindung, einem Ereignis oder einer Lücke.
    static let maxLoadRetries = 3

    /// Die verfolgte Session, `nil` ohne laufende Vorlesung
    private(set) var running: SessionBrief?
    /// Aktuelle Folie laut Snapshot und `slide.change`, `nil` = unbekannt
    private(set) var currentSlide: SlideBrief?

    /// Wird nach jeder Änderung von `running` oder `currentSlide` aufgerufen (und nach jedem Neuladen)
    @ObservationIgnored var onChange: (@MainActor () -> Void)?

    @ObservationIgnored private let feed: any SessionFeed
    @ObservationIgnored private let backend: any SessionFollowerBackend
    @ObservationIgnored private let now: @MainActor () -> Date
    @ObservationIgnored private let sleeper: @MainActor (Duration) async throws -> Void

    /// Stand des abonnierten Stroms (nur für die aktuelle Verbindung)
    @ObservationIgnored private var streamSeq = 0
    @ObservationIgnored private var subscribedStream: String?
    @ObservationIgnored private var lastUpdatedAtMS = 0
    /// Neueste Fassung aus `session.updated` je Session (nur diese Verbindung). Ein Snapshot, der älter ist (die Session
    /// endete, während er lud), verliert dagegen.
    @ObservationIgnored private var newestUpdates: [String: SessionBrief] = [:]
    @ObservationIgnored private var lastLoadAt: Date?
    @ObservationIgnored private var loadTask: _Concurrency.Task<Void, Never>?
    @ObservationIgnored private var delayedLoad: _Concurrency.Task<Void, Never>?
    /// Zählt bei jedem Neuladen und jeder neuen Verbindung hoch. Eine veraltete Antwort wird verworfen.
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var failedLoads = 0
    @ObservationIgnored private var started = false

    init(
        feed: any SessionFeed,
        backend: any SessionFollowerBackend,
        now: @escaping @MainActor () -> Date = { Date() },
        sleep: @escaping @MainActor (Duration) async throws -> Void = { try await _Concurrency.Task.sleep(for: $0) }
    ) {
        self.feed = feed
        self.backend = backend
        self.now = now
        self.sleeper = sleep
    }

    /// Hängt sich an die Engine. Mehrfaches Aufrufen schadet nicht.
    func start() {
        guard !started else { return }
        started = true
        feed.onInbound = { [weak self] inbound in
            self?.handle(inbound)
        }
    }

    // MARK: Eingehend

    func handle(_ inbound: SyncInbound) {
        switch inbound {
        case .connected:
            // Alter Stand der letzten Verbindung gilt nicht mehr
            streamSeq = 0
            subscribedStream = nil
            lastLoadAt = nil
            newestUpdates = [:]
            failedLoads = 0
            requestLoad(immediately: true)
        case .sessionUpdated(let brief):
            apply(sessionUpdate: brief)
        case .subscribed(let stream, let reset):
            guard stream == subscribedStream, reset else { return }
            requestLoad(immediately: false)
        case .op(let stream, let seq, let slide):
            apply(op: seq, stream: stream, slide: slide)
        case .notebookChanged:
            // Geht an die Bibliothek (`onNotebookChanged`), nicht an den Session-Follower
            break
        }
    }

    private func apply(op seq: Int, stream: String, slide: SlideBrief?) {
        guard stream == subscribedStream else { return }
        if seq <= streamSeq { return }
        guard seq == streamSeq + 1 else {
            // Lücke: der Snapshot ist die volle Wahrheit
            requestLoad(immediately: false)
            return
        }
        streamSeq = seq
        if let slide, slide != currentSlide {
            currentSlide = slide
            onChange?()
        }
    }

    private func apply(sessionUpdate brief: SessionBrief) {
        if (newestUpdates[brief.id]?.updatedAtMS ?? Int.min) <= brief.updatedAtMS {
            newestUpdates[brief.id] = brief
        }
        if let followed = running, followed.id == brief.id {
            if brief.updatedAtMS < lastUpdatedAtMS { return }
            lastUpdatedAtMS = brief.updatedAtMS
            if brief.isActive {
                if running != brief {
                    running = brief
                    onChange?()
                }
            } else {
                stopFollowing()
            }
            return
        }
        // Eine andere Session: nur eine aktive ersetzt die verfolgte (sonst bleibt alles, wie es ist)
        guard brief.isActive else { return }
        if let followed = running, (followed.startedAtMS ?? 0) > (brief.startedAtMS ?? 0) { return }
        requestLoad(immediately: true)
    }

    private func stopFollowing() {
        if let stream = subscribedStream {
            feed.unsubscribe(stream: stream)
        }
        subscribedStream = nil
        streamSeq = 0
        generation += 1
        running = nil
        currentSlide = nil
        onChange?()
    }

    // MARK: Neu laden

    /// Lädt Sessions und Snapshot. Mehrere Anstöße kurz hintereinander werden zusammengefasst, Reset und Lücke
    /// höchstens alle `reloadInterval`.
    private func requestLoad(immediately: Bool) {
        if !immediately, let last = lastLoadAt {
            let wait = SessionFollower.reloadInterval - now().timeIntervalSince(last)
            if wait > 0 {
                guard delayedLoad == nil else { return }
                let sleeper = self.sleeper
                delayedLoad = _Concurrency.Task { [weak self] in
                    do {
                        try await sleeper(.milliseconds(Int((wait * 1000).rounded(.up))))
                    } catch {
                        return
                    }
                    guard let self else { return }
                    self.delayedLoad = nil
                    self.requestLoad(immediately: true)
                }
                return
            }
        }
        delayedLoad?.cancel()
        delayedLoad = nil
        generation += 1
        let gen = generation
        loadTask?.cancel()
        lastLoadAt = now()
        loadTask = _Concurrency.Task { [weak self] in
            await self?.load(generation: gen)
        }
    }

    private func retryAfterFailure(generation gen: Int) {
        guard gen == generation, !_Concurrency.Task.isCancelled, failedLoads < SessionFollower.maxLoadRetries
        else { return }
        failedLoads += 1
        requestLoad(immediately: false)
    }

    private func load(generation gen: Int) async {
        let sessions: [SessionBrief]
        do {
            sessions = try await backend.activeSessions()
        } catch {
            // Ohne Verbindung bleibt der letzte Stand stehen. Ein einzelner Fehler darf die Vorlesung aber nicht bis zur
            // nächsten Verbindung unsichtbar lassen: kurz darauf erneut versuchen.
            retryAfterFailure(generation: gen)
            return
        }
        guard gen == generation, !_Concurrency.Task.isCancelled else { return }
        let active = sessions.filter(\.isActive)
        guard let session = active.max(by: { ($0.startedAtMS ?? 0, $0.id) < ($1.startedAtMS ?? 0, $1.id) }) else {
            if running != nil || subscribedStream != nil {
                stopFollowing()
            } else {
                onChange?()
            }
            return
        }
        let snapshot: SessionSnapshotBrief?
        do {
            snapshot = try await backend.snapshot(sessionID: session.id)
        } catch {
            retryAfterFailure(generation: gen)
            return
        }
        guard gen == generation, !_Concurrency.Task.isCancelled else { return }
        failedLoads = 0
        guard let snapshot else {
            if running != nil || subscribedStream != nil { stopFollowing() }
            return
        }
        // Kam während des Ladens ein neuerer Stand per `session.updated` (etwa „beendet“), gilt er
        var current = snapshot.session
        if let newer = newestUpdates[current.id], newer.updatedAtMS > current.updatedAtMS {
            current = newer
        }
        guard current.isActive else {
            if running != nil || subscribedStream != nil { stopFollowing() }
            return
        }
        let stream = "session:\(current.id)"
        if let old = subscribedStream, old != stream {
            feed.unsubscribe(stream: old)
        }
        let latest = snapshot.latestSlide
        let changed = running != current || currentSlide != latest
        let sameSession = running?.id == current.id
        running = current
        lastUpdatedAtMS = sameSession ? max(lastUpdatedAtMS, current.updatedAtMS) : current.updatedAtMS
        currentSlide = latest
        streamSeq = snapshot.streamSeq
        subscribedStream = stream
        feed.subscribe(stream: stream, lastSeq: snapshot.streamSeq, lastOpID: snapshot.streamOpID)
        if changed { onChange?() }
    }
}

/// Snapshot einer Session, soweit das iPad ihn braucht. Gelesen wird nur das, was die Folie betrifft: Ein neuer
/// Wert in Markern oder Fotos lässt den Abruf nicht scheitern.
struct SessionSnapshotBrief: Decodable, Equatable, Sendable {
    struct SlideEventBrief: Decodable, Equatable, Sendable {
        var slideID: String?
        var slideIndex: Int
        var tMS: Int
        var createdAtMS: Int
        var deleted: Bool

        init(slideID: String?, slideIndex: Int, tMS: Int, createdAtMS: Int, deleted: Bool = false) {
            self.slideID = slideID
            self.slideIndex = slideIndex
            self.tMS = tMS
            self.createdAtMS = createdAtMS
            self.deleted = deleted
        }

        private enum CodingKeys: String, CodingKey {
            case slideID = "slide_id"
            case slideIndex = "slide_index"
            case tMS = "t_ms"
            case createdAt = "created_at"
            case deletedAt = "deleted_at"
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            slideID = try container.decodeIfPresent(String.self, forKey: .slideID)
            slideIndex = try container.decode(Int.self, forKey: .slideIndex)
            tMS = try container.decode(Int.self, forKey: .tMS)
            let created = try container.decode(Date.self, forKey: .createdAt)
            createdAtMS = InkStrokeCodec.milliseconds(created)
            deleted = (try container.decodeIfPresent(String.self, forKey: .deletedAt)) != nil
        }
    }

    var session: SessionBrief
    var slideEvents: [SlideEventBrief]
    var streamSeq: Int
    var streamOpID: String?

    init(session: SessionBrief, slideEvents: [SlideEventBrief], streamSeq: Int, streamOpID: String?) {
        self.session = session
        self.slideEvents = slideEvents
        self.streamSeq = streamSeq
        self.streamOpID = streamOpID
    }

    /// Letztes nicht gelöschtes `slide_event`: nach `t_ms`, dann `created_at`
    var latestSlide: SlideBrief? {
        let live = slideEvents.filter { !$0.deleted }
        guard let last = live.max(by: { ($0.tMS, $0.createdAtMS) < ($1.tMS, $1.createdAtMS) }) else { return nil }
        return SlideBrief(slideID: last.slideID, index: last.slideIndex)
    }

    private enum CodingKeys: String, CodingKey {
        case session
        case slideEvents = "slide_events"
        case streamSeq = "stream_seq"
        case streamOpID = "stream_op_id"
    }

    private struct SessionExcerpt: Decodable {
        let id: String
        let moduleID: String
        let state: String
        let startedAt: Date?
        let slideDeckID: String?
        let deletedAt: String?
        let updatedAt: Date

        private enum CodingKeys: String, CodingKey {
            case id
            case moduleID = "module_id"
            case state
            case startedAt = "started_at"
            case slideDeckID = "slide_deck_id"
            case deletedAt = "deleted_at"
            case updatedAt = "updated_at"
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let excerpt = try container.decode(SessionExcerpt.self, forKey: .session)
        session = SessionBrief(
            id: excerpt.id,
            moduleID: excerpt.moduleID,
            state: excerpt.state,
            startedAtMS: excerpt.startedAt.map { InkStrokeCodec.milliseconds($0) },
            slideDeckID: excerpt.slideDeckID,
            deleted: excerpt.deletedAt != nil,
            updatedAtMS: InkStrokeCodec.milliseconds(excerpt.updatedAt)
        )
        slideEvents = try container.decodeIfPresent([SlideEventBrief].self, forKey: .slideEvents) ?? []
        streamSeq = try container.decode(Int.self, forKey: .streamSeq)
        streamOpID = try container.decodeIfPresent(String.self, forKey: .streamOpID)
    }
}

/// Die echte Quelle: REST über den Client mit dem Zugang der Engine
@MainActor
final class CoreSessionFollowerBackend: SessionFollowerBackend {
    private let client: CoreClient
    private let sync: SyncEngine

    init(client: CoreClient, sync: SyncEngine) {
        self.client = client
        self.sync = sync
    }

    func activeSessions() async throws -> [SessionBrief] {
        guard sync.canReachCore, let access = sync.restAccess() else { throw ConnectionError.invalidAddress }
        do {
            let sessions = try await client.activeSessions(endpoint: access.endpoint, token: access.token)
            return sessions.map { SyncEngine.sessionBrief($0) }
        } catch {
            sync.reportRESTError(error)
            throw error
        }
    }

    func snapshot(sessionID: String) async throws -> SessionSnapshotBrief? {
        guard sync.canReachCore, let access = sync.restAccess() else { throw ConnectionError.invalidAddress }
        do {
            return try await client.sessionSnapshot(
                endpoint: access.endpoint, token: access.token, sessionID: sessionID)
        } catch {
            sync.reportRESTError(error)
            throw error
        }
    }
}
