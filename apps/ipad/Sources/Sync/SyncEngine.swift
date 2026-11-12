import Foundation
import Observation

/// Wo das iPad gerade schreibt. Geht als `presence` an den Mac (VERTRAEGE §11.6): Die Notizen-Spalte der
/// Web-App folgt `page_id`.
struct SyncPresenceTarget: Equatable, Sendable {
    var sessionID: String?
    var notebookID: String?
    var pageID: String?
}

/// Was die Engine aus einer Server-Nachricht braucht. Eigener Typ, damit `SGServerMessage` (noch nicht
/// `Sendable`, VERTRAEGE §11.7) die Dekodierung nie verlässt.
private enum SyncIncoming: Sendable {
    struct Failure: Sendable {
        var opID: String?
        var retryable: Bool
        var fatal: Bool
        var code: String
        var message: String
    }

    case welcome(dbEpoch: String)
    case inbound(SyncInbound)
    case timePong(t0: Int, ts: Int)
    case pong
    case ack(opID: String)
    case error(Failure)
    case ignored
}

/// Eine Verbindung. Alles, was nur zu dieser Verbindung gehört, damit eine alte nie in die neue hineinfunkt.
@MainActor
private final class SyncLink {
    let socket: any SyncSocket
    /// `op_id` der gesendeten, noch nicht beantworteten Operationen
    var inFlight = Set<String>()
    var isPumping = false
    var pumpAgain = false
    /// Wiederholbarer Fehler: nichts mehr senden, die Verbindung wird neu aufgebaut
    var blocked = false
    var welcomed = false
    /// Zeitpunkt des `welcome` (für den Backoff-Reset nach einer stabilen Verbindung)
    var welcomedAt: Date?
    var lastPongAt: Date
    /// Wir haben geschlossen (Zeitüberschreitung, Fehler beim Senden, fatale Meldung)
    var closedByUs = false
    /// Gesetzt, wenn die Engine danach nicht neu verbinden soll
    var stopState: SyncEngine.State?
    var clock = SyncClock()
    var probing = false
    var probeT0: Int?
    var ticker: _Concurrency.Task<Void, Never>?

    init(socket: any SyncSocket, now: Date) {
        self.socket = socket
        self.lastPongAt = now
    }
}

/// Sync des iPads mit dem Mac (T1-14, VERTRAEGE §11): genau eine Verbindungsschleife, eine Warteschlange auf der
/// Platte, Senden mit Fenster von 200 Operationen und Wiederholung bei jedem Abbruch.
///
/// Ablauf je Verbindung: verbinden → `hello` → `welcome` → Uhrabgleich → `presence` → Warteschlange.
/// Das Token steht nur im Header des Upgrades, nie in einer Nachricht und nie im Log.
@MainActor
@Observable
final class SyncEngine {
    enum State: Equatable, Sendable {
        case stopped
        case connecting
        case clockSync
        case online
        /// Verbindung weg, wartet auf den nächsten Versuch
        case waiting
        /// 401 oder 4401: Kopplung widerrufen. Die Warteschlange bleibt erhalten.
        case tokenInvalid
        /// 4426: Der Mac spricht ein anderes Protokoll. App aktualisieren.
        case unsupported
    }

    /// Höchstens so viele Operationen ohne Antwort im Flug (VERTRAEGE §11.2)
    static let window = 200
    /// Größere Nachrichten schließt der Server mit 1009. Sie kommen direkt in die Fehlerablage.
    static let maxMessageBytes = 1_000_000
    /// So oft darf dieselbe Operation mit `internal_error` scheitern, bevor sie in die Fehlerablage geht
    static let maxInternalErrors = 5
    static let pingInterval: Duration = .seconds(15)
    static let pongTimeout: TimeInterval = 45
    /// Hält eine Verbindung so lange nach `welcome` (belegt durch ein `pong`), beginnt die Wartezeit von vorn
    static let stableConnectionInterval: TimeInterval = 60
    /// So lange sammelt die Engine `ack`-Zeilen, bevor sie sie mit einem fsync schreibt
    static let ackFlushDelay: Duration = .milliseconds(250)
    static let clockResyncInterval: TimeInterval = 300

    private(set) var state: State = .stopped
    /// Operationen, die der Mac noch nicht bestätigt hat
    private(set) var pendingCount = 0
    /// Operationen in der Fehlerablage
    private(set) var deadLetterCount = 0
    /// Zählt bei jedem `welcome` hoch. Die Schreibfläche gleicht danach ab, wenn nötig.
    private(set) var welcomeCount = 0
    /// Zählt bei jedem erfolgreichen Abgleich einer Seite hoch (Ansicht oder Hintergrund-Durchgang). Die Zeile
    /// „N Seiten werden abgeglichen“ zählt damit herunter (UX-46).
    private(set) var reconciledPages = 0

    /// Für `AppModel`: Der Verbindungsstatus der App folgt der Engine
    @ObservationIgnored var onStateChange: ((State) -> Void)?
    /// Der Core hat ein `page.update` mit `page_version_conflict` abgelehnt (VERTRAEGE §11.2). Die Operation ist
    /// **nicht** in der Fehlerablage: Der Empfänger (`InkLibraryService`) lädt die Seite neu, ersetzt die wartenden
    /// `page.update` und ruft danach `resumePage` auf. Nach jedem `welcome` kommt der Aufruf für noch offene Seiten
    /// erneut.
    @ObservationIgnored var onPageVersionConflict: (@MainActor (String) -> Void)?
    /// Eingehende Nachrichten, die nicht zur Engine selbst gehören (Session-Strom, `session.updated`). Das iPad
    /// liest nur: Die Engine wendet nichts an und schreibt nichts in die Warteschlange.
    @ObservationIgnored var onInbound: (@MainActor (SyncInbound) -> Void)?
    /// Ein Notizbuch hat sich am Mac geändert (`notebook.changed`, VERTRAEGE §11.6). Getrennt von `onInbound`, das der
    /// `SessionFollower` belegt: Der `InkLibraryService` lädt die Bibliothek daraufhin neu.
    @ObservationIgnored var onNotebookChanged: (@MainActor () -> Void)?
    /// Eine Verbindung hat ihr `welcome` bekommen. `true`, wenn die `db_epoch` neu ist (Mac wiederhergestellt). Der
    /// Empfänger (`InkLibraryService`) gleicht dann alle markierten Seiten im Hintergrund ab (UX-46). Bei jedem
    /// weiteren `welcome` kommt der Aufruf wieder, damit ein unterbrochener Durchgang weiterläuft.
    @ObservationIgnored var onWelcomed: (@MainActor (_ epochChanged: Bool) -> Void)?

    private let client: CoreClient
    private let sockets: any SyncSocketFactory
    private let outbox: SyncOutbox
    private let library: any InkLibraryStore
    private let tokenStore: any TokenStore
    private let appVersion: String?
    private let now: @MainActor () -> Date
    private let sleeper: @MainActor (Duration) async throws -> Void
    private let random: @MainActor () -> Double

    @ObservationIgnored private var runningMac: PairedMac?
    /// `suspendConnections()` hat eine laufende Schleife angehalten; `resumeConnections()` nimmt sie wieder auf
    @ObservationIgnored private var suspended = false
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var loopTask: _Concurrency.Task<Void, Never>?
    @ObservationIgnored private var waitTask: _Concurrency.Task<Void, Never>?
    @ObservationIgnored private var link: SyncLink?
    @ObservationIgnored private var backoff = SyncBackoff()
    @ObservationIgnored private var ackFlushTask: _Concurrency.Task<Void, Never>?
    /// Letzter gemessener Versatz Mac − iPad. Bleibt über Verbindungen hinweg gültig.
    @ObservationIgnored private var clockOffsetMS: Int?
    @ObservationIgnored private var lastClockSync: Date?
    @ObservationIgnored private var internalErrors: [String: Int] = [:]
    @ObservationIgnored private var presence: SyncPresenceTarget?
    /// Seiten mit einem offenen `page_version_conflict`: Ihre wartenden `page.update` werden nicht gesendet, bis
    /// `resumePage` sie freigibt. Sonst gäbe die abgelehnte Operation eine Endlosschleife.
    @ObservationIgnored private var parkedPages = Set<String>()
    /// Seiten, die gerade abgeglichen werden. Ansicht und Hintergrund-Durchgang teilen sich diese Menge: Eine Seite
    /// wird nie von zwei Abgleichen gleichzeitig bearbeitet.
    @ObservationIgnored private var reconcilingPages = Set<String>()

    init(
        client: CoreClient,
        sockets: any SyncSocketFactory,
        outbox: SyncOutbox,
        library: any InkLibraryStore,
        tokenStore: any TokenStore,
        appVersion: String? = nil,
        now: @escaping @MainActor () -> Date = { Date() },
        sleep: @escaping @MainActor (Duration) async throws -> Void = { try await _Concurrency.Task.sleep(for: $0) },
        random: @escaping @MainActor () -> Double = { Double.random(in: 0..<1) }
    ) {
        self.client = client
        self.sockets = sockets
        self.outbox = outbox
        self.library = library
        self.tokenStore = tokenStore
        self.appVersion = appVersion
        self.now = now
        self.sleeper = sleep
        self.random = random
        refreshCounts()
    }

    /// Die echte Engine: Dateien in „Application Support/Sync“, URLSession-WebSocket
    static func live(
        client: CoreClient, tokenStore: any TokenStore, appVersion: String?, library: any InkLibraryStore
    ) -> SyncEngine {
        let base =
            FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let directory = base.appendingPathComponent("Sync", isDirectory: true)
        return SyncEngine(
            client: client,
            sockets: URLSessionSyncSocketFactory(),
            outbox: SyncOutbox(directory: directory),
            library: library,
            tokenStore: tokenStore,
            appVersion: appVersion
        )
    }

    /// Pfad der Fehlerablage (für „Teilen“)
    var deadLetterURL: URL { outbox.deadLetterURL }

    // MARK: Start und Stopp

    /// Startet die Verbindungsschleife für diesen Mac. Läuft sie schon, passiert nichts.
    func start(mac: PairedMac) {
        if runningMac == mac, loopTask != nil { return }
        halt(to: .stopped)
        suspended = false
        runningMac = mac
        let gen = generation
        setState(.connecting)
        refreshCounts()
        loopTask = _Concurrency.Task { [weak self] in
            await self?.runLoop(mac: mac, generation: gen)
        }
    }

    /// Beendet die Verbindung (Kopplung aufgehoben). Die Warteschlange bleibt auf der Platte.
    func stop() {
        halt(to: .stopped)
        runningMac = nil
        suspended = false
    }

    /// Die App geht in den Hintergrund oder der Weiterleiter stoppt (Issue #282): Schließt die Verbindung, hält die Schleife
    /// an und macht die URLSession ungültig. Die Warteschlange bleibt auf der Platte; was noch unbestätigt unterwegs war,
    /// geht bei der nächsten Verbindung erneut raus (gleiche `op_id`, der Core bestätigt sie idempotent). `runningMac`
    /// bleibt, damit `resumeConnections()` im Vordergrund die Schleife wieder aufnimmt.
    ///
    /// Eine schon beendete Schleife (`tokenInvalid`, `unsupported`) bleibt, wie sie ist: Ihr Zustand bleibt sichtbar,
    /// und der Vordergrund startet sie nicht neu (Token ungültig: keine Versuche, Plan UX-12 §5).
    func suspendConnections() {
        if runningMac != nil, loopTask != nil {
            halt(to: .stopped)
            suspended = true
        }
        sockets.invalidateSessions()
    }

    /// Die App ist wieder im Vordergrund: Nimmt die Schleife wieder auf, wenn `suspendConnections()` sie angehalten
    /// hat. Sonst passiert nichts (sie läuft schon, wurde nie gestartet oder endete mit `tokenInvalid`/`unsupported`).
    func resumeConnections() {
        guard suspended, let mac = runningMac else { return }
        start(mac: mac)
    }

    /// Die Wegewahl hat sich geändert (neuer Port des Weiterleiters, Mac gefunden): Wartet die Engine, verbindet sie
    /// sofort neu. Eine laufende Verbindung bleibt, wie sie ist (sie wandert nie auf einen anderen Weg).
    func routeChanged() {
        guard runningMac != nil, state == .waiting else { return }
        backoff.reset()
        waitTask?.cancel()
    }

    /// App kommt in den Vordergrund: Wartezeit überspringen, tote Verbindung früh erkennen
    func kick() {
        guard runningMac != nil else { return }
        switch state {
        case .waiting:
            backoff.reset()
            waitTask?.cancel()
        case .online:
            if let link {
                _Concurrency.Task {
                    await self.sendMessage(.ping(SyncPing(type: .ping)), on: link)
                    await self.pump(link)
                }
            }
        default:
            break
        }
    }

    /// Beendet Schleife und Verbindung und setzt den Zustand. Eine neue Schleife bekommt eine neue Generation.
    private func halt(to newState: State) {
        generation += 1
        loopTask?.cancel()
        loopTask = nil
        waitTask?.cancel()
        waitTask = nil
        if let link {
            link.ticker?.cancel()
            link.closedByUs = true
            link.socket.close()
        }
        link = nil
        backoff.reset()
        flushAcksNow()
        setState(newState)
    }

    private func setState(_ newState: State) {
        guard state != newState else { return }
        state = newState
        onStateChange?(newState)
    }

    // MARK: Einreihen

    /// Reiht Strichänderungen der Seite ein. Die Operation steht auf der Platte, bevor etwas gesendet wird.
    /// - Returns: `false`, wenn das Schreiben scheiterte. Die Seite muss dann später abgeglichen werden.
    @discardableResult
    func enqueue(_ changes: [InkStrokeChange], binding: InkBinding) -> Bool {
        let drafts = InkOpBuilder.ops(
            for: changes,
            binding: binding,
            nowMS: nowMS(),
            offsetMS: clockOffsetMS,
            makeID: { InkID.uuidV7() }
        )
        guard !drafts.isEmpty else { return true }
        do {
            try outbox.append(drafts)
        } catch {
            return false
        }
        refreshCounts()
        schedulePump()
        return true
    }

    /// Reiht fertige Operationen ein (Notizbuch, Seite). Sie stehen auf der Platte, bevor etwas gesendet wird.
    /// - Returns: `false`, wenn das Schreiben scheiterte. Dann ist nichts eingereiht.
    @discardableResult
    func enqueue(drafts: [OutboxDraft]) -> Bool {
        guard !drafts.isEmpty else { return true }
        do {
            try outbox.append(drafts)
        } catch {
            return false
        }
        refreshCounts()
        schedulePump()
        return true
    }

    /// Der Core ist erreichbar oder wird gerade erreicht (REST-Anfragen lohnen sich)
    var canReachCore: Bool {
        state == .connecting || state == .clockSync || state == .online
    }

    /// Zugang für REST-Abrufe der Bibliothek. `nil` ohne Kopplung.
    func restAccess() -> (endpoint: CoreEndpoint, token: String)? {
        guard let found = credentials() else { return nil }
        return (found.endpoint, found.token)
    }

    /// Ein 401 bei einem REST-Abruf der Bibliothek heißt: Kopplung widerrufen (wie bei den eigenen Abrufen)
    func reportRESTError(_ error: Error) {
        handleRESTError(error)
    }

    /// Letzter gemessener Versatz Mac − iPad, `nil` = noch nie gemessen
    var clockOffsetForDrafts: Int? { clockOffsetMS }

    /// Seiten, für die gerade eine Operation dieser Art in der Warteschlange wartet
    func pendingPageIDs(kind: String) -> Set<String> {
        Set(outbox.pending.compactMap { $0.kind == kind ? $0.pageID : nil })
    }

    /// `op_id` der wartenden Operationen dieser Art für diese Seite, in Reihenfolge der Warteschlange
    func pendingOpIDs(kind: String, pageID: String) -> [String] {
        outbox.pending.filter { $0.kind == kind && $0.pageID == pageID }.map(\.opID)
    }

    /// Entfernt wartende Operationen ohne Fehlerablage, weil eine neuere sie ersetzt (Konfliktauflösung)
    /// - Returns: `false`, wenn das Schreiben scheitert. Dann ist nichts entfernt.
    @discardableResult
    func discardPending(opIDs: [String]) -> Bool {
        guard !opIDs.isEmpty else { return true }
        do {
            try outbox.discard(opIDs: opIDs)
        } catch {
            return false
        }
        if let link {
            for id in opIDs {
                link.inFlight.remove(id)
                internalErrors[id] = nil
            }
        }
        refreshCounts()
        return true
    }

    /// Der Konflikt der Seite ist aufgelöst: Ihre wartenden `page.update` dürfen wieder gesendet werden
    func resumePage(_ pageID: String) {
        guard parkedPages.remove(pageID) != nil else { return }
        schedulePump()
    }

    /// Wartet in der Warteschlange eine Operation dieser Art in diesem Strom?
    func hasPending(kind: String, stream: String) -> Bool {
        outbox.pending.contains { $0.kind == kind && $0.stream == stream }
    }

    /// Neue `db_epoch`: Die Seite muss mit dem Core abgeglichen werden
    func pageNeedsReconcile(pageID: String) -> Bool {
        library.page(pageID)?.needsReconcile ?? false
    }

    /// Höchste Nummer der Warteschlange (für `page.plist`)
    var outboxLastNumber: Int { outbox.lastNumber }

    /// Höchste Nummer, die für diese Seite vergeben wurde
    func outboxMark(forPage pageID: String) -> Int { outbox.mark(forPage: pageID) }

    // MARK: Abgleich

    /// Ausgang eines Abgleichs
    enum ReconcileResult: Equatable, Sendable {
        /// Der Stand ist abgeglichen, das Flag ist gelöscht
        case done
        /// Nichts getan: Die Seite wird gerade abgeglichen, der Aufrufer wollte nicht mehr (`isStillValid`), es
        /// gibt keine Kopplung oder die Seite ist unlesbar (`InkPageModel.isUnreadable`). Das Flag bleibt stehen.
        case skipped
        /// Der Core war nicht erreichbar. Das Flag bleibt stehen.
        case unreachable
        /// Einreihen gescheitert (Platte) oder der Core hat die Anfrage abgelehnt (Fehlerstatus außer 404, unlesbare
        /// Antwort). Das Flag bleibt stehen.
        case failed
    }

    /// Läuft für diese Seite gerade ein Abgleich?
    func isReconciling(pageID: String) -> Bool {
        reconcilingPages.contains(pageID)
    }

    /// Vergleicht die Seite mit dem Stand des Core und reiht nach, was fehlt oder abweicht. Das ist der einzige
    /// Abgleich: Die Schreibfläche und der Hintergrund-Durchgang (UX-46) rufen genau diese Funktion.
    /// Scheitert die Anfrage, bleibt das Flag stehen und der nächste Aufruf versucht es noch einmal.
    /// - Parameter isStillValid: Wird nach der Anfrage und vor dem Planen geprüft (ohne `await` dazwischen). Der
    ///   Hintergrund-Durchgang bricht damit ab, wenn die Seite inzwischen geöffnet wurde: Ein kurz geladenes Modell
    ///   kennt neue Striche der Ansicht nicht und würde sie sonst am Core entfernen.
    @discardableResult
    func reconcile(
        page: InkPageModel, binding: InkBinding, isStillValid: @MainActor () -> Bool = { true }
    ) async -> ReconcileResult {
        // Unlesbare Seite (#252): ihr Stand ist leer und sagt nichts über die Seite. Planen hieße, am Core alle Striche zu
        // entfernen. Kein Plan, keine Anfrage, das Flag bleibt.
        guard !page.isUnreadable else { return .skipped }
        guard let credentials = credentials() else { return .skipped }
        guard reconcilingPages.insert(binding.pageID).inserted else { return .skipped }
        defer { reconcilingPages.remove(binding.pageID) }
        let remote: PageStrokes?
        do {
            remote = try await client.pageStrokes(
                endpoint: credentials.endpoint, token: credentials.token, pageID: binding.pageID)
        } catch {
            handleRESTError(error)
            switch error as? ConnectionError {
            case .server(let status, _)? where status != 429 && status != 503:
                // Der Core antwortet, lehnt diese Seite aber ab: Der Hintergrund-Durchgang geht zur nächsten weiter,
                // statt bei jedem `welcome` an derselben Seite stehen zu bleiben
                return .failed
            case .invalidResponse?:
                return .failed
            default:
                // Keine Verbindung, Zeitüberschreitung, überlastet (429, 503): später noch einmal
                return .unreachable
            }
        }
        // Ab hier gibt es kein `await` mehr: Der lokale Stand ist genau der, den der Plan sieht
        guard runningMac != nil, isStillValid() else { return .skipped }
        var succeeded = true
        // Wartende Operationen der Seite zuerst auf den Stand des Core rechnen (Absturz mitten im Senden)
        let pendingForPage = outbox.pending.filter { $0.pageID == binding.pageID }
        let createPending = pendingForPage.contains { $0.kind == "page.create" }
        let projected = InkReconciler.projected(
            server: remote?.strokes,
            pending: SyncEngine.strokeChanges(of: pendingForPage),
            pageCreatePending: createPending
        )
        if remote == nil, !createPending {
            // Der Core kennt die Seite nicht (Wiederherstellung): mit allen Feldern der Bibliothek neu anlegen,
            // damit z. B. eine Folienseite nicht als leere A4-Seite zurückkommt
            let known = library.page(binding.pageID) ?? SyncEngine.fallbackPage(for: binding)
            if let draft = InkOpBuilder.pageCreate(
                page: known,
                nowMS: nowMS(),
                offsetMS: clockOffsetMS,
                makeID: { InkID.uuidV7() }
            ) {
                do {
                    try outbox.append([draft])
                } catch {
                    succeeded = false
                }
            } else {
                succeeded = false
            }
        }
        let changes = InkReconciler.plan(local: page.neutralStrokes(), server: projected)
        if succeeded, !changes.isEmpty {
            succeeded = enqueue(changes, binding: binding)
        }
        refreshCounts()
        schedulePump()
        if succeeded {
            page.reconcileFinished()
            library.clearNeedsReconcile(pageID: binding.pageID)
            reconciledPages += 1
            return .done
        }
        return .failed
    }

    /// Strichänderungen aus wartenden Operationen, in der Reihenfolge der Warteschlange. Unlesbare Zeilen zählen nicht.
    private static func strokeChanges(of entries: [OutboxEntry]) -> [InkStrokeChange] {
        var changes: [InkStrokeChange] = []
        for entry in entries where entry.kind == "stroke.add" || entry.kind == "stroke.remove" {
            guard let data = entry.json.data(using: .utf8), let op = try? SGSyncOp.decode(data) else { continue }
            switch op {
            case .strokeAdd(let value): changes.append(.upsert(value.data.stroke))
            case .strokeRemove(let value): changes.append(.remove(value.data.clientIDS))
            default: break
            }
        }
        return changes
    }

    /// Seite, wenn die Bibliothek sie nicht (mehr) kennt: A4, leer, wie die alte Bindung sie angelegt hat
    private static func fallbackPage(for binding: InkBinding) -> LibraryPage {
        LibraryPage(
            id: binding.pageID,
            notebookID: binding.notebookID,
            index: 1,
            template: .blanko,
            widthPt: LibraryPage.a4Width,
            heightPt: LibraryPage.a4Height,
            sessionID: binding.sessionID,
            backgroundSlideID: nil,
            attachedSlideID: nil,
            version: 1,
            createQueued: true,
            needsReconcile: false,
            deletedAtMS: nil,
            deleteQueued: false
        )
    }

    // MARK: Strom lesen (nur lesend, E8 aus dem Plan)

    /// Abonniert einen Strom ab `lastSeq`. Das iPad hält keinen Stand über Verbindungen hinweg: Nach jedem `welcome`
    /// lädt der Aufrufer den Snapshot neu und abonniert ab dessen `stream_seq`. Ohne Verbindung passiert nichts.
    func subscribe(stream: String, lastSeq: Int, lastOpID: String?) {
        guard let link, link.welcomed else { return }
        let message = SyncSubscribe(
            streams: [SyncStreamPosition(lastOpID: lastOpID, lastSeq: lastSeq, stream: stream)],
            type: .subscribe
        )
        _Concurrency.Task { await self.sendMessage(.subscribe(message), on: link) }
    }

    func unsubscribe(stream: String) {
        guard let link, link.welcomed else { return }
        let message = SyncUnsubscribe(streams: [stream], type: .unsubscribe)
        _Concurrency.Task { await self.sendMessage(.unsubscribe(message), on: link) }
    }

    // MARK: Anwesenheit

    /// Meldet dem Mac, wo geschrieben wird. `nil` oder eine Seite ohne `pageID` heißt: nicht mehr hier.
    func setPresence(_ target: SyncPresenceTarget?) {
        presence = target
        guard state == .online, let link else { return }
        let value = target ?? SyncPresenceTarget()
        _Concurrency.Task { await self.sendPresence(value, on: link) }
    }

    private func sendPresence(_ target: SyncPresenceTarget, on link: SyncLink) async {
        let message = SyncPresence(
            notebookID: target.notebookID,
            pageID: target.pageID,
            sessionID: target.sessionID,
            type: .presence
        )
        await sendMessage(.presence(message), on: link)
    }

    // MARK: Verbindungsschleife

    private enum LoopAction {
        case stop
        case retry
    }

    private func runLoop(mac: PairedMac, generation gen: Int) async {
        while gen == generation, !_Concurrency.Task.isCancelled {
            let action = await connectOnce(mac: mac, generation: gen)
            guard gen == generation, !_Concurrency.Task.isCancelled else { return }
            switch action {
            case .stop:
                loopTask = nil
                return
            case .retry:
                setState(.waiting)
                let delay = backoff.next(jitter: random())
                await wait(delay)
            }
        }
    }

    private func wait(_ duration: Duration) async {
        let sleeper = self.sleeper
        let task = _Concurrency.Task<Void, Never> { _ = try? await sleeper(duration) }
        waitTask = task
        await task.value
        waitTask = nil
    }

    /// Eine Verbindung von `connecting` bis zum Ende
    private func connectOnce(mac: PairedMac, generation gen: Int) async -> LoopAction {
        guard let token = try? tokenStore.loadToken(), !token.isEmpty else {
            setState(.tokenInvalid)
            return .stop
        }
        // Das Token geht nur an den lokalen Weiterleiter (UX-12 PR 4, E7), im Altweg nur ins eigene Netz (PR 0). Läuft
        // der Weiterleiter nicht (Hintergrund, Schlüssel fehlt, noch nicht bereit) oder liegt der Mac nicht im Netz des
        // iPads, wird nicht einmal ein Socket geöffnet. Zustand `waiting`, übliche Wartezeit, die Warteschlange bleibt.
        guard let endpoint = client.tokenEndpoint(for: mac), client.allowsToken(for: endpoint) else { return .retry }
        guard let url = endpoint.syncURL() else {
            setState(.stopped)
            return .stop
        }
        // Token nur im Header, kein Origin (VERTRAEGE §11.1)
        var request = URLRequest(url: url)
        request.timeoutInterval = 30
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        setState(.connecting)
        let socket = sockets.open(request)
        let link = SyncLink(socket: socket, now: now())
        self.link = link

        var failure: Error?
        do {
            let hello = SyncHello(
                appVersion: appVersion ?? "0.0.0",
                client: .ipad,
                deviceID: mac.deviceID,
                syncHelloProtocol: 1,
                streams: [],
                type: .hello
            )
            try await send(.hello(hello), on: link)
            link.ticker = _Concurrency.Task { [weak self] in
                await self?.runTicker(link)
            }
            while true {
                let text = try await socket.receive()
                await handle(text, link: link)
            }
        } catch {
            failure = error
        }

        link.ticker?.cancel()
        socket.close()
        if self.link === link {
            self.link = nil
            flushAcksNow()
        }
        guard gen == generation, !_Concurrency.Task.isCancelled else { return .stop }
        return await classify(failure, link: link, mac: mac, token: token)
    }

    /// Entscheidet nach dem Ende einer Verbindung, ob neu verbunden wird (VERTRAEGE §11.2)
    private func classify(_ error: Error?, link: SyncLink, mac: PairedMac, token: String) async -> LoopAction {
        if let stop = link.stopState {
            setState(stop)
            return .stop
        }
        switch error as? SyncSocketError {
        case .closed(let code)?:
            if code == 4401 {
                setState(.tokenInvalid)
                return .stop
            }
            if code == 4426 {
                setState(.unsupported)
                return .stop
            }
        case .rejected(let status)?:
            if status == 401 {
                setState(.tokenInvalid)
                return .stop
            }
        case .transport(let urlError)?:
            // Ein abgelehntes Upgrade ist nicht immer als 401 erkennbar: `GET /health` entscheidet
            if !link.welcomed, SyncEngine.shouldProbeHealth(after: urlError) {
                if await healthSaysTokenInvalid(mac: mac, token: token) {
                    setState(.tokenInvalid)
                    return .stop
                }
            }
        case nil:
            break
        }
        // 4503, 4408, 4409, 1001, 1003, 1008, 1009 und Abbruch: mit Wartezeit neu verbinden
        return .retry
    }

    private static func shouldProbeHealth(after error: URLError) -> Bool {
        switch error.code {
        case .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost, .cannotFindHost,
            .dnsLookupFailed, .timedOut, .dataNotAllowed, .cancelled:
            return false
        default:
            return true
        }
    }

    private func healthSaysTokenInvalid(mac: PairedMac, token: String) async -> Bool {
        // Auch hier geht das Token nur an den Weiterleiter bzw. ins eigene Netz (der Client prüft ebenfalls)
        guard let endpoint = client.tokenEndpoint(for: mac), client.allowsToken(for: endpoint) else { return false }
        do {
            try await client.checkHealth(endpoint: endpoint, token: token)
            return false
        } catch {
            return (error as? ConnectionError) == .tokenInvalid
        }
    }

    // MARK: Nachrichten

    private func send(_ message: SGClientMessage, on link: SyncLink) async throws {
        let data = try message.encode()
        try await link.socket.send(String(decoding: data, as: UTF8.self))
    }

    /// Sendet eine Nachricht. Scheitert das, ist die Verbindung kaputt: schließen, die Schleife verbindet neu.
    private func sendMessage(_ message: SGClientMessage, on link: SyncLink) async {
        guard link === self.link else { return }
        do {
            try await send(message, on: link)
        } catch {
            fail(link)
        }
    }

    private func fail(_ link: SyncLink) {
        link.closedByUs = true
        link.socket.close()
    }

    private func handle(_ text: String, link: SyncLink) async {
        guard link === self.link else { return }
        switch SyncEngine.parse(text) {
        case .welcome(let epoch):
            await onWelcome(dbEpoch: epoch, link: link)
        case .timePong(let t0, let ts):
            await onTimePong(t0: t0, ts: ts, link: link)
        case .inbound(let value):
            deliver(value)
        case .pong:
            // Ein `pong` allein setzt den Backoff nicht zurück (VERTRAEGE §11.2: nach `ack`). Ausnahme: Die Verbindung
            // hält seit `stableConnectionInterval`. Sonst wartete ein iPad, das nur liest (keine `ack`), nach ein paar
            // Abbrüchen über die ganze Laufzeit hinweg 30 s. Ein `welcome`-Reset ginge nicht: 4503 kommt immer nach
            // `welcome`, die Folge 1 s, 2 s, 4 s … gäbe es dann nie.
            let at = now()
            link.lastPongAt = at
            if let welcomedAt = link.welcomedAt,
                at.timeIntervalSince(welcomedAt) >= SyncEngine.stableConnectionInterval
            {
                backoff.reset()
            }
        case .ack(let opID):
            await onAck(opID: opID, link: link)
        case .error(let failure):
            await onError(failure, link: link)
        case .ignored:
            break
        }
    }

    private func deliver(_ inbound: SyncInbound) {
        if case .notebookChanged = inbound {
            onNotebookChanged?()
            return
        }
        onInbound?(inbound)
    }

    nonisolated private static func parse(_ text: String) -> SyncIncoming {
        guard let data = text.data(using: .utf8), let message = try? SGServerMessage.decode(data) else {
            return .ignored
        }
        switch message {
        case .welcome(let value):
            return .welcome(dbEpoch: value.dbEpoch)
        case .timePong(let value):
            return .timePong(t0: value.t0, ts: value.ts)
        case .pong:
            return .pong
        case .subscribed(let value):
            // Eine Nachricht kann mehrere Ströme melden. Das iPad abonniert immer genau einen.
            guard let first = value.resume.first else { return .ignored }
            return .inbound(.subscribed(stream: first.stream, reset: first.reset))
        case .op(let op):
            return incomingOp(op, text: text)
        case .event(let event):
            switch event {
            case .sessionUpdated(let value):
                return .inbound(.sessionUpdated(sessionBrief(value.data)))
            case .notebookChanged:
                // Der Inhalt zählt nicht: Die Bibliothek wird ohnehin per REST neu geladen
                return .inbound(.notebookChanged)
            default:
                return .ignored
            }
        case .ack(let value):
            return .ack(opID: value.opID)
        case .error(let value):
            return .error(
                .init(
                    opID: value.opID, retryable: value.retryable, fatal: value.fatal,
                    code: value.code.rawValue, message: value.message))
        case .unknownError(let value):
            return .error(
                .init(
                    opID: value.opID, retryable: value.retryable, fatal: value.fatal,
                    code: value.code, message: value.message))
        default:
            return .ignored
        }
    }

    /// `stream` und `seq` stehen bei jeder Operation im Umschlag, auch bei unbekannten Arten (die zählen trotzdem)
    nonisolated private static func incomingOp(_ op: SGSyncOp, text: String) -> SyncIncoming {
        struct Envelope: Decodable {
            let stream: String?
            let seq: Int?
        }
        guard let data = text.data(using: .utf8),
            let envelope = try? JSONDecoder().decode(Envelope.self, from: data),
            let stream = envelope.stream, let seq = envelope.seq
        else { return .ignored }
        var slide: SlideBrief?
        if case .slideChange(let value) = op {
            slide = SlideBrief(slideID: value.data.slideID, index: value.data.slideIndex)
        }
        return .inbound(.op(stream: stream, seq: seq, slide: slide))
    }

    nonisolated static func sessionBrief(_ session: Session) -> SessionBrief {
        SessionBrief(
            id: session.id,
            moduleID: session.moduleID,
            state: session.state.rawValue,
            startedAtMS: session.startedAt.map { InkStrokeCodec.milliseconds($0) },
            slideDeckID: session.slideDeckID,
            deleted: session.deletedAt != nil,
            updatedAtMS: InkStrokeCodec.milliseconds(session.updatedAt)
        )
    }

    private func onWelcome(dbEpoch: String, link: SyncLink) async {
        link.welcomed = true
        link.welcomedAt = now()
        link.lastPongAt = now()
        // Nach einer Wiederherstellung am Mac kennt der Core den Stand nicht mehr: alles abgleichen
        var epochChanged = false
        if let stored = library.dbEpoch, stored != dbEpoch {
            epochChanged = true
            library.markAllNeedReconcile()
            requeueFreeNotebooks()
        }
        library.setDBEpoch(dbEpoch)
        welcomeCount += 1
        onInbound?(.connected)
        onWelcomed?(epochChanged)
        // Ein Konflikt, dessen Auflösung (REST) nicht gelang, wird mit der neuen Verbindung erneut versucht
        for pageID in parkedPages.sorted() {
            onPageVersionConflict?(pageID)
        }
        setState(.clockSync)
        await startClockProbe(link)
    }

    /// Nach neuer `db_epoch`: Ein freies Notizbuch, das nach dem Backup angelegt wurde, fehlt dem Core. Ohne
    /// `notebook.create` scheiterte jedes erneute `page.create` mit `notebook_not_found`. Die Operation ist
    /// idempotent (der Core bestätigt eine bekannte ID ohne Änderung). Sie steht evtl. hinter wartenden Operationen ihres
    /// Stroms; `SyncOutbox.nextToSend` sendet sie trotzdem zuerst.
    private func requeueFreeNotebooks() {
        var drafts: [OutboxDraft] = []
        for notebook in library.allNotebooks()
        where notebook.kind == .frei && !library.pages(inNotebook: notebook.id).isEmpty {
            if let draft = InkOpBuilder.notebookCreate(
                notebook: notebook,
                nowMS: nowMS(),
                offsetMS: clockOffsetMS,
                makeID: { InkID.uuidV7() }
            ) {
                drafts.append(draft)
            }
        }
        // Scheitert das Schreiben, bleibt das Notizbuch `knownOnServer = false`. Der nächste Aufruf von
        // `InkLibraryService.openTarget` reiht `notebook.create` dann nach.
        enqueue(drafts: drafts)
    }

    // MARK: Uhrabgleich (VERTRAEGE §11.5)

    private func startClockProbe(_ link: SyncLink) async {
        link.clock.reset()
        link.probing = true
        await sendTimePing(link)
    }

    private func sendTimePing(_ link: SyncLink) async {
        let t0 = nowMS()
        link.probeT0 = t0
        await sendMessage(.timePing(SyncTimePing(t0: t0, type: .timePing)), on: link)
    }

    private func onTimePong(t0: Int, ts: Int, link: SyncLink) async {
        guard link.probing, link.probeT0 == t0 else { return }
        link.clock.add(t0: t0, t1: nowMS(), ts: ts)
        if !link.clock.isComplete {
            await sendTimePing(link)
            return
        }
        link.probing = false
        guard let offset = link.clock.offsetMS else { return }
        clockOffsetMS = offset
        lastClockSync = now()
        let report = SyncTimeOffset(offsetMS: offset, rttMS: link.clock.rttMS ?? 0, type: .timeOffset)
        await sendMessage(.timeOffset(report), on: link)
        if state == .clockSync, link === self.link {
            setState(.online)
            if let presence {
                await sendPresence(presence, on: link)
            }
            await pump(link)
        }
    }

    // MARK: Warteschlange senden

    private func schedulePump() {
        guard state == .online, let link else { return }
        _Concurrency.Task { await self.pump(link) }
    }

    /// Sendet in `number`-Reihenfolge, solange weniger als `window` Operationen unbeantwortet sind.
    /// Eine Operation mit unsicherer Uhr wird vorher einmalig korrigiert und gespeichert (`rewrite`).
    private func pump(_ link: SyncLink) async {
        guard link === self.link, state == .online else { return }
        if link.isPumping {
            link.pumpAgain = true
            return
        }
        link.isPumping = true
        defer { link.isPumping = false }
        repeat {
            link.pumpAgain = false
            while link === self.link, !link.blocked, link.inFlight.count < SyncEngine.window {
                let skipped = parkedPages.isEmpty ? link.inFlight : link.inFlight.union(parkedOpIDs())
                guard let entry = outbox.nextToSend(inFlight: skipped) else {
                    break
                }
                var outgoing = entry
                if outgoing.clockUncertain {
                    guard let offset = clockOffsetMS else { break }
                    guard let fixed = InkOpBuilder.correct(outgoing, offsetMS: offset) else {
                        let moved = deadLetter(
                            entry, code: "local_op_invalid", message: "Operation ließ sich nicht lesen", link: link)
                        if moved { continue } else { break }
                    }
                    do {
                        try outbox.rewrite(fixed)
                    } catch {
                        // Nicht senden, was nicht gespeichert ist: Die Operation müsste sonst bei einer
                        // Wiederholung anders aussehen (`op_id_reused`). Der nächste Anstoß versucht es erneut.
                        break
                    }
                    outgoing = fixed
                }
                if outgoing.json.utf8.count > SyncEngine.maxMessageBytes {
                    let moved = deadLetter(
                        outgoing, code: "message_too_large",
                        message: "Nachricht größer als \(SyncEngine.maxMessageBytes) Byte", link: link)
                    if moved { continue } else { break }
                }
                link.inFlight.insert(outgoing.opID)
                do {
                    try await link.socket.send(outgoing.json)
                } catch {
                    fail(link)
                    return
                }
            }
        } while link.pumpAgain && link === self.link
    }

    /// Wartende `page.update` von Seiten mit offenem Konflikt. Ohne Konflikt leer und ohne Suche in der Warteschlange.
    private func parkedOpIDs() -> Set<String> {
        guard !parkedPages.isEmpty else { return [] }
        return Set(
            outbox.pending.compactMap { $0.kind == "page.update" && parkedPages.contains($0.pageID ?? "") ? $0.opID : nil })
    }

    private func onAck(opID: String, link: SyncLink) async {
        link.inFlight.remove(opID)
        internalErrors[opID] = nil
        outbox.acknowledgeDeferred(opID: opID)
        scheduleAckFlush()
        backoff.reset()
        refreshCounts()
        await pump(link)
    }

    /// Bündelt das fsync der `ack`-Zeilen: Bei vielen `ack` kurz hintereinander schreibt ein Aufschub von
    /// `ackFlushDelay` alles auf einmal, statt jedes `ack` auf dem Main-Actor einzeln auf die Platte zu zwingen.
    /// Ein verlorener Persist ist harmlos: Die Operation bliebe nach einem Absturz in der Datei und ginge erneut
    /// raus, der Core bestätigt die bekannte `op_id` noch einmal (Idempotenz, VERTRAEGE §11.2).
    private func scheduleAckFlush() {
        guard ackFlushTask == nil else { return }
        ackFlushTask = _Concurrency.Task { [weak self] in
            guard let self else { return }
            do {
                try await self.sleeper(SyncEngine.ackFlushDelay)
            } catch {
                // Abgebrochen: `flushAcksNow` hat schon geschrieben
                return
            }
            // Der Schlaf kann schon vorbei sein, wenn `flushAcksNow` abbricht. Dann gehört `ackFlushTask` evtl.
            // schon einer neuen Aufgabe und darf nicht überschrieben werden.
            guard !_Concurrency.Task.isCancelled else { return }
            self.ackFlushTask = nil
            self.outbox.flushAcks()
        }
    }

    private func flushAcksNow() {
        ackFlushTask?.cancel()
        ackFlushTask = nil
        outbox.flushAcks()
    }

    private func onError(_ failure: SyncIncoming.Failure, link: SyncLink) async {
        guard let opID = failure.opID else {
            // Fehler der Verbindung ohne Operation
            switch failure.code {
            case "device_token_invalid":
                link.stopState = .tokenInvalid
                fail(link)
            case "protocol_unsupported":
                link.stopState = .unsupported
                fail(link)
            default:
                if failure.fatal { fail(link) }
            }
            return
        }
        let entry = outbox.pending.first { $0.opID == opID }

        if failure.retryable {
            // Der Server schließt mit 4503. Alles Frühere ist schon beantwortet: gleich selbst schließen
            // und ab der ältesten offenen Operation neu senden.
            link.blocked = true
            if failure.code == "internal_error", let entry {
                let count = (internalErrors[opID] ?? 0) + 1
                internalErrors[opID] = count
                if count >= SyncEngine.maxInternalErrors {
                    internalErrors[opID] = nil
                    deadLetter(entry, code: failure.code, message: failure.message, link: link)
                }
            }
            fail(link)
            return
        }

        // Endgültig abgelehnt: samt Abhängigen in die Fehlerablage, der Rest läuft weiter
        link.inFlight.remove(opID)
        // Ausnahme `page_version_conflict`: nicht in die Fehlerablage. Die Seite wird neu geladen und das
        // `page.update` ersetzt. Bis dahin ruht ihre Operation.
        if failure.code == "page_version_conflict", onPageVersionConflict != nil, let entry, entry.kind == "page.update",
            let pageID = entry.pageID
        {
            // Nur der erste Fehler einer Seite stößt die Auflösung an. Weitere Operationen derselben Seite ersetzt sie mit.
            if parkedPages.insert(pageID).inserted {
                onPageVersionConflict?(pageID)
            }
            await pump(link)
            return
        }
        if let entry {
            deadLetter(entry, code: failure.code, message: failure.message, link: link)
        }
        await pump(link)
    }

    /// Verschiebt die Operation und alles, was von ihr abhängt, in die Fehlerablage. Bei `page.create` sind das
    /// alle Operationen derselben Seite, bei `notebook.create` alle Operationen desselben Stroms (also des Notizbuchs).
    /// Der Eintrag der Bibliothek wird entfernt, die Dateien unter `Ink/<page_id>/` bleiben.
    @discardableResult
    private func deadLetter(_ entry: OutboxEntry, code: String, message: String, link: SyncLink?) -> Bool {
        var ids = [entry.opID]
        let isPageCreate = entry.kind == "page.create"
        let isNotebookCreate = entry.kind == "notebook.create"
        if isPageCreate, let pageID = entry.pageID {
            ids += outbox.pending.filter { $0.pageID == pageID && $0.opID != entry.opID }.map(\.opID)
        }
        if isNotebookCreate {
            ids += outbox.pending.filter { $0.stream == entry.stream && $0.opID != entry.opID }.map(\.opID)
        }
        do {
            try outbox.moveToDeadLetter(opIDs: ids, code: code, message: message)
        } catch {
            return false
        }
        if let link {
            for id in ids {
                link.inFlight.remove(id)
                internalErrors[id] = nil
            }
        }
        if isPageCreate, let pageID = entry.pageID {
            library.removePage(pageID)
        }
        if isNotebookCreate, let notebookID = SyncEngine.notebookID(ofStream: entry.stream) {
            library.removeNotebook(notebookID)
        }
        refreshCounts()
        return true
    }

    /// `notebook:<id>` → `<id>`
    nonisolated static func notebookID(ofStream stream: String) -> String? {
        let prefix = "notebook:"
        guard stream.hasPrefix(prefix) else { return nil }
        let id = String(stream.dropFirst(prefix.count))
        return id.isEmpty ? nil : id
    }

    /// Wachhund und Taktgeber der Verbindung: `ping` alle 15 s, trennen nach 45 s ohne `pong`,
    /// Uhrabgleich alle 5 min
    private func runTicker(_ link: SyncLink) async {
        while !_Concurrency.Task.isCancelled {
            do {
                try await sleeper(SyncEngine.pingInterval)
            } catch {
                return
            }
            guard link === self.link, !_Concurrency.Task.isCancelled else { return }
            if now().timeIntervalSince(link.lastPongAt) >= SyncEngine.pongTimeout {
                fail(link)
                return
            }
            guard link.welcomed else { continue }
            await sendMessage(.ping(SyncPing(type: .ping)), on: link)
            if state == .online, !link.probing, let last = lastClockSync,
                now().timeIntervalSince(last) >= SyncEngine.clockResyncInterval
            {
                await startClockProbe(link)
            }
            // Falls ein Schreibfehler das Senden angehalten hat
            await pump(link)
        }
    }

    // MARK: Hilfen

    private struct Credentials {
        let endpoint: CoreEndpoint
        let token: String
    }

    /// Adresse und Token für REST-Abrufe. Mit Wegewahl (UX-12 PR 4) ist die Adresse der lokale Weiterleiter; läuft er
    /// nicht (Hintergrund, Schlüssel fehlt, noch nicht bereit), gibt es keinen Zugang und es geht nichts raus.
    private func credentials() -> Credentials? {
        guard let mac = runningMac, let token = try? tokenStore.loadToken(), !token.isEmpty,
            let endpoint = client.tokenEndpoint(for: mac)
        else { return nil }
        return Credentials(endpoint: endpoint, token: token)
    }

    /// Ein 401 bei einer REST-Anfrage heißt: Kopplung widerrufen. Alles andere ist ein Netzproblem.
    private func handleRESTError(_ error: Error) {
        guard (error as? ConnectionError) == .tokenInvalid else { return }
        halt(to: .tokenInvalid)
    }

    private func nowMS() -> Int {
        InkStrokeCodec.milliseconds(now())
    }

    private func refreshCounts() {
        let pending = outbox.pending.count
        if pendingCount != pending { pendingCount = pending }
        let dead = outbox.deadLetterCount
        if deadLetterCount != dead { deadLetterCount = dead }
    }
}
