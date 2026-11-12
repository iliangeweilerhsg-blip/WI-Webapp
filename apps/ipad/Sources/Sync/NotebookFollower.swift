import Foundation

/// Kopf eines Stroms: `stream_seq` und `stream_op_id` aus der REST-Antwort (VERTRAEGE §11.1)
struct NotebookHead: Equatable, Sendable {
    var seq: Int
    var opID: String?
}

/// Was der Follower vom Core braucht (REST). Eigenes Protokoll, damit Tests ohne Netz laufen.
@MainActor
protocol NotebookFollowerBackend: AnyObject {
    /// Kopf des Stroms `notebook:<id>`. `nil` bei 404 (gelöscht oder unbekannt). Wirft bei Netzfehlern.
    func head(notebookID: String) async throws -> NotebookHead?
}

/// Was der Follower von der Engine braucht
@MainActor
protocol NotebookFeed: AnyObject {
    var onNotebookInbound: (@MainActor (SyncInbound) -> Void)? { get set }
    /// Die Verbindung hat ihr `welcome`, `subscribe` nimmt etwas an
    var canSubscribe: Bool { get }
    func subscribe(stream: String, lastSeq: Int, lastOpID: String?)
}

extension SyncEngine: NotebookFeed {}

/// Eine Änderung am Notizbuch, die ein anderer Client (der Mac) ausgelöst hat
struct NotebookChange: Equatable, Sendable {
    var notebookID: String
    var kind: NotebookOpKind
}

/// Hört lesend auf die Notizbuch-Ströme (VERTRAEGE §11.3): `notebook.update`, `.delete` und `.restore` laufen nur im
/// Strom `notebook:<id>`. Ein Client bekommt Weitergaben nur für abonnierte Ströme (§11.1), darum abonniert das iPad
/// die Ströme seiner bekannten Notizbücher, jeweils ab dem Kopf aus `GET /notebooks/{id}/pages` (`stream_seq` und
/// `stream_op_id`). Es gibt keinen Stand über Verbindungen hinweg: Nach jedem `welcome` beginnt es von vorn.
///
/// Der Follower wendet nichts an und schreibt nichts. Er meldet nur, welches Notizbuch sich geändert hat.
///
/// Grenzen:
/// - Höchstens `maxStreams` Abos je Verbindung. Das Rate-Limit des Core für Nachrichten ohne Operation liegt bei
///   200 Marken (§11.2), und `subscribe` gehört dazu.
/// - Ein Notizbuch, das am Mac schon gelöscht ist, hat keinen Kopf (404). Es wird erst abonniert, wenn es wieder da ist.
///   Ein Abo, das vor dem Löschen bestand, bleibt dagegen bis zum Verbindungsende.
@MainActor
final class NotebookFollower {
    /// Abos je Verbindung (siehe oben)
    static let maxStreams = 150
    /// Ein `reset` für denselben Strom führt höchstens so oft zu einem neuen Abo (keine Schleife)
    static let maxResets = 2

    /// Wird für jede fremde Änderung aufgerufen
    var onChange: (@MainActor (NotebookChange) -> Void)?

    private let feed: any NotebookFeed
    private let backend: any NotebookFollowerBackend
    /// Notizbücher, deren Strom abonniert werden soll (dem Core bekannt, nicht ausgeblendet)
    private let notebookIDs: @MainActor () -> [String]

    private(set) var subscribed = Set<String>()
    private var resets: [String: Int] = [:]
    private var generation = 0
    private var passTask: _Concurrency.Task<Void, Never>?
    private var passAgain = false
    private var started = false

    init(
        feed: any NotebookFeed,
        backend: any NotebookFollowerBackend,
        notebookIDs: @escaping @MainActor () -> [String]
    ) {
        self.feed = feed
        self.backend = backend
        self.notebookIDs = notebookIDs
    }

    /// Hängt sich an die Engine. Mehrfaches Aufrufen schadet nicht.
    func start() {
        guard !started else { return }
        started = true
        feed.onNotebookInbound = { [weak self] inbound in
            self?.handle(inbound)
        }
    }

    // MARK: Eingehend

    func handle(_ inbound: SyncInbound) {
        switch inbound {
        case .connected:
            // Die Abos der alten Verbindung gelten nicht mehr
            subscribed = []
            resets = [:]
            generation += 1
            syncSubscriptions()
        case .subscribed(let stream, let reset):
            guard reset, let id = SyncEngine.notebookID(ofStream: stream), subscribed.contains(id) else { return }
            // Der Core hat den Kopf nicht erkannt (der Strom wechselte zwischen REST und Abo): neu laden
            subscribed.remove(id)
            resets[id, default: 0] += 1
            if resets[id, default: 0] <= NotebookFollower.maxResets {
                syncSubscriptions()
            }
        case .notebookOp(let stream, _, let kind):
            guard let id = SyncEngine.notebookID(ofStream: stream), subscribed.contains(id) else { return }
            onChange?(NotebookChange(notebookID: id, kind: kind))
        case .op, .sessionUpdated:
            break
        }
    }

    // MARK: Abonnieren

    /// Abonniert die Ströme, die noch fehlen. Mehrere Aufrufe kurz hintereinander laufen zu einem Durchgang zusammen.
    func syncSubscriptions() {
        guard started else { return }
        if passTask != nil {
            passAgain = true
            return
        }
        passTask = _Concurrency.Task { [weak self] in
            guard let self else { return }
            repeat {
                self.passAgain = false
                await self.runPass()
            } while self.passAgain && !_Concurrency.Task.isCancelled
            self.passTask = nil
        }
    }

    private func runPass() async {
        let gen = generation
        let missing = notebookIDs().filter { !subscribed.contains($0) }.sorted()
        for id in missing {
            guard subscribed.count < NotebookFollower.maxStreams else { return }
            guard feed.canSubscribe, !_Concurrency.Task.isCancelled else { return }
            let head: NotebookHead?
            do {
                head = try await backend.head(notebookID: id)
            } catch {
                // Netzfehler: Der nächste Abruf der Bibliothek oder das nächste `welcome` versucht es erneut
                return
            }
            // Neue Verbindung oder schon abonniert, während der Kopf lud
            guard gen == generation, feed.canSubscribe, !subscribed.contains(id) else { return }
            guard let head else { continue }
            feed.subscribe(stream: "notebook:\(id)", lastSeq: head.seq, lastOpID: head.opID)
            subscribed.insert(id)
        }
    }
}

/// Die echte Quelle: REST über den Client mit dem Zugang der Engine
@MainActor
final class CoreNotebookFollowerBackend: NotebookFollowerBackend {
    private let client: CoreClient
    private let sync: SyncEngine

    init(client: CoreClient, sync: SyncEngine) {
        self.client = client
        self.sync = sync
    }

    func head(notebookID: String) async throws -> NotebookHead? {
        guard sync.canReachCore, let access = sync.restAccess() else { throw ConnectionError.invalidAddress }
        do {
            return try await client.notebookStreamHead(
                endpoint: access.endpoint, token: access.token, notebookID: notebookID)
        } catch {
            sync.reportRESTError(error)
            throw error
        }
    }
}
