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
    static let clockResyncInterval: TimeInterval = 300

    private(set) var state: State = .stopped
    /// Operationen, die der Mac noch nicht bestätigt hat
    private(set) var pendingCount = 0
    /// Operationen in der Fehlerablage
    private(set) var deadLetterCount = 0
    /// Zählt bei jedem `welcome` hoch. Die Schreibfläche gleicht danach ab, wenn nötig.
    private(set) var welcomeCount = 0

    /// Für `AppModel`: Der Verbindungsstatus der App folgt der Engine
    @ObservationIgnored var onStateChange: ((State) -> Void)?

    private let client: CoreClient
    private let sockets: any SyncSocketFactory
    private let outbox: SyncOutbox
    private let bindings: any InkBindingStore
    private let tokenStore: any TokenStore
    private let appVersion: String?
    private let now: @MainActor () -> Date
    private let sleeper: @MainActor (Duration) async throws -> Void
    private let random: @MainActor () -> Double

    @ObservationIgnored private var runningMac: PairedMac?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var loopTask: _Concurrency.Task<Void, Never>?
    @ObservationIgnored private var waitTask: _Concurrency.Task<Void, Never>?
    @ObservationIgnored private var link: SyncLink?
    @ObservationIgnored private var backoff = SyncBackoff()
    /// Letzter gemessener Versatz Mac − iPad. Bleibt über Verbindungen hinweg gültig.
    @ObservationIgnored private var clockOffsetMS: Int?
    @ObservationIgnored private var lastClockSync: Date?
    @ObservationIgnored private var internalErrors: [String: Int] = [:]
    @ObservationIgnored private var presence: SyncPresenceTarget?

    init(
        client: CoreClient,
        sockets: any SyncSocketFactory,
        outbox: SyncOutbox,
        bindings: any InkBindingStore,
        tokenStore: any TokenStore,
        appVersion: String? = nil,
        now: @escaping @MainActor () -> Date = { Date() },
        sleep: @escaping @MainActor (Duration) async throws -> Void = { try await _Concurrency.Task.sleep(for: $0) },
        random: @escaping @MainActor () -> Double = { Double.random(in: 0..<1) }
    ) {
        self.client = client
        self.sockets = sockets
        self.outbox = outbox
        self.bindings = bindings
        self.tokenStore = tokenStore
        self.appVersion = appVersion
        self.now = now
        self.sleeper = sleep
        self.random = random
        refreshCounts()
    }

    /// Die echte Engine: Dateien in „Application Support/Sync“, URLSession-WebSocket
    static func live(client: CoreClient, tokenStore: any TokenStore, appVersion: String?) -> SyncEngine {
        let base =
            FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let directory = base.appendingPathComponent("Sync", isDirectory: true)
        return SyncEngine(
            client: client,
            sockets: URLSessionSyncSocketFactory(),
            outbox: SyncOutbox(directory: directory),
            bindings: FileInkBindingStore(url: directory.appendingPathComponent("bindings.json")),
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

    /// Der Core ist erreichbar oder wird gerade erreicht (REST-Anfragen lohnen sich)
    var canReachCore: Bool {
        state == .connecting || state == .clockSync || state == .online
    }

    /// Neue `db_epoch`: Die Seite muss mit dem Core abgeglichen werden
    func bindingNeedsReconcile(pageID: String) -> Bool {
        bindings.binding(forPage: pageID)?.needsReconcile ?? false
    }

    /// Höchste Nummer der Warteschlange (für `page.plist`)
    var outboxLastNumber: Int { outbox.lastNumber }

    /// Höchste Nummer, die für diese Seite vergeben wurde
    func outboxMark(forPage pageID: String) -> Int { outbox.mark(forPage: pageID) }

    // MARK: Bindung

    /// Findet das Notizbuch, in das geschrieben wird, und legt beim ersten Mal die Seite an (E1).
    /// Ohne Verbindung gilt das zuletzt verwendete Notizbuch. `nil`: keine Bindung, die Seite bleibt lokal.
    func resolveBinding() async -> InkBinding? {
        if canReachCore, let credentials = credentials() {
            do {
                if let resolved = try await resolveOnline(credentials) {
                    return resolved
                }
            } catch {
                handleRESTError(error)
            }
        }
        guard let lastID = bindings.lastNotebookID, let last = bindings.binding(forNotebook: lastID) else {
            return nil
        }
        return ensurePageCreated(last, index: 1)
    }

    /// Notizbuch der laufenden Vorlesung laut Core, nur lesend: Es wird nichts angelegt oder gespeichert.
    /// `nil` ohne Verbindung, ohne laufende Vorlesung oder bei einem Fehler (UX-19).
    func runningLectureNotebookID() async -> String? {
        guard canReachCore, let credentials = credentials() else { return nil }
        guard let found = try? await lookupLecture(credentials) else { return nil }
        return found.notebook.id
    }

    private struct LectureLookup {
        var session: Session
        var notebook: Notebook
        var moduleName: String?
    }

    /// Fragt Session, Notizbuch und Modulname ab. Der Name ist nicht lebenswichtig: Scheitert er, bleibt er `nil`.
    private func lookupLecture(_ credentials: Credentials) async throws -> LectureLookup? {
        let sessions = try await client.activeSessions(endpoint: credentials.endpoint, token: credentials.token)
        // Die zuletzt begonnene Session
        guard
            let session = sessions.max(by: { ($0.startedAt ?? $0.createdAt) < ($1.startedAt ?? $1.createdAt) })
        else { return nil }
        let notebooks = try await client.notebooks(
            endpoint: credentials.endpoint, token: credentials.token, moduleID: session.moduleID)
        guard let notebook = notebooks.first(where: { $0.kind == .vorlesung && $0.deletedAt == nil }) else {
            return nil
        }
        let name = try? await client.moduleName(
            endpoint: credentials.endpoint, token: credentials.token, moduleID: session.moduleID)
        return LectureLookup(session: session, notebook: notebook, moduleName: name)
    }

    private func resolveOnline(_ credentials: Credentials) async throws -> InkBinding? {
        guard let found = try await lookupLecture(credentials) else { return nil }
        let session = found.session
        let notebook = found.notebook
        let moduleName = found.moduleName
        let startMS = session.startedAt.map { InkStrokeCodec.milliseconds($0) }

        if var existing = bindings.binding(forNotebook: notebook.id) {
            existing.sessionID = session.id
            existing.sessionStartMS = startMS
            existing.moduleName = moduleName ?? existing.moduleName
            bindings.save(existing, makeLast: true)
            return ensurePageCreated(existing, index: 1)
        }

        let pages = try await client.notebookPages(
            endpoint: credentials.endpoint, token: credentials.token, notebookID: notebook.id)
        // Während der Anfrage kann ein zweiter Aufruf die Bindung schon angelegt haben
        if var existing = bindings.binding(forNotebook: notebook.id) {
            existing.sessionID = session.id
            existing.sessionStartMS = startMS
            existing.moduleName = moduleName ?? existing.moduleName
            bindings.save(existing, makeLast: true)
            return ensurePageCreated(existing, index: pages.count + 1)
        }
        let binding = InkBinding(
            notebookID: notebook.id,
            pageID: InkID.uuidV7(),
            moduleID: session.moduleID,
            pageCreated: false,
            needsReconcile: false,
            sessionID: session.id,
            sessionStartMS: startMS,
            moduleName: moduleName
        )
        // Erst die Bindung, dann `page.create`: Bricht die App dazwischen ab, holt der nächste Start es nach
        bindings.save(binding, makeLast: true)
        return ensurePageCreated(binding, index: pages.count + 1)
    }

    /// Reiht `page.create` ein, falls noch nicht geschehen. `nil`, wenn das Schreiben scheitert.
    private func ensurePageCreated(_ binding: InkBinding, index: Int) -> InkBinding? {
        guard !binding.pageCreated else { return binding }
        guard
            let draft = InkOpBuilder.pageCreate(
                binding: binding,
                index: index,
                nowMS: nowMS(),
                offsetMS: clockOffsetMS,
                makeID: { InkID.uuidV7() }
            )
        else { return nil }
        do {
            try outbox.append([draft])
        } catch {
            return nil
        }
        var created = binding
        created.pageCreated = true
        bindings.save(created, makeLast: true)
        refreshCounts()
        schedulePump()
        return created
    }

    // MARK: Abgleich

    /// Vergleicht die Seite mit dem Stand des Core und reiht nach, was fehlt oder abweicht.
    /// Scheitert die Anfrage, bleibt das Flag stehen und der nächste Aufruf versucht es noch einmal.
    func reconcile(page: InkPageModel, binding: InkBinding) async {
        guard let credentials = credentials() else { return }
        let remote: PageStrokes?
        do {
            remote = try await client.pageStrokes(
                endpoint: credentials.endpoint, token: credentials.token, pageID: binding.pageID)
        } catch {
            handleRESTError(error)
            return
        }
        var pageIndex = 1
        if remote == nil,
            let pages = try? await client.notebookPages(
                endpoint: credentials.endpoint, token: credentials.token, notebookID: binding.notebookID)
        {
            pageIndex = pages.count + 1
        }
        // Ab hier gibt es kein `await` mehr: Der lokale Stand ist genau der, den der Plan sieht
        guard runningMac != nil else { return }
        var succeeded = true
        if remote == nil {
            if let draft = InkOpBuilder.pageCreate(
                binding: binding,
                index: pageIndex,
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
        let changes = InkReconciler.plan(local: page.neutralStrokes(), server: remote?.strokes)
        if succeeded, !changes.isEmpty {
            succeeded = enqueue(changes, binding: binding)
        }
        refreshCounts()
        schedulePump()
        if succeeded {
            page.reconcileFinished()
            bindings.clearNeedsReconcile(forPage: binding.pageID)
        }
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
        guard let url = mac.endpoint.syncURL() else {
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
        do {
            try await client.checkHealth(endpoint: mac.endpoint, token: token)
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
        case .pong:
            link.lastPongAt = now()
            backoff.reset()
        case .ack(let opID):
            await onAck(opID: opID, link: link)
        case .error(let failure):
            await onError(failure, link: link)
        case .ignored:
            break
        }
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

    private func onWelcome(dbEpoch: String, link: SyncLink) async {
        link.welcomed = true
        link.lastPongAt = now()
        // Nach einer Wiederherstellung am Mac kennt der Core den Stand nicht mehr: alles abgleichen
        if let stored = bindings.dbEpoch, stored != dbEpoch {
            bindings.markAllNeedReconcile()
        }
        bindings.setDBEpoch(dbEpoch)
        welcomeCount += 1
        setState(.clockSync)
        await startClockProbe(link)
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
                guard let entry = outbox.pending.first(where: { !link.inFlight.contains($0.opID) }) else {
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

    private func onAck(opID: String, link: SyncLink) async {
        link.inFlight.remove(opID)
        internalErrors[opID] = nil
        outbox.acknowledge(opID: opID)
        backoff.reset()
        refreshCounts()
        await pump(link)
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
        if let entry {
            deadLetter(entry, code: failure.code, message: failure.message, link: link)
        }
        await pump(link)
    }

    /// Verschiebt die Operation und alles, was von ihr abhängt, in die Fehlerablage. Bei `page.create` sind das
    /// alle Operationen derselben Seite, und die Bindung wird verworfen.
    @discardableResult
    private func deadLetter(_ entry: OutboxEntry, code: String, message: String, link: SyncLink?) -> Bool {
        var ids = [entry.opID]
        let isPageCreate = entry.kind == "page.create"
        if isPageCreate, let pageID = entry.pageID {
            ids += outbox.pending.filter { $0.pageID == pageID && $0.opID != entry.opID }.map(\.opID)
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
            bindings.removeBinding(forPage: pageID)
        }
        refreshCounts()
        return true
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

    private func credentials() -> Credentials? {
        guard let mac = runningMac, let token = try? tokenStore.loadToken(), !token.isEmpty else { return nil }
        return Credentials(endpoint: mac.endpoint, token: token)
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
