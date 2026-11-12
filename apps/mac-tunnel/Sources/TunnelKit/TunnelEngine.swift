import Foundation
import TunnelShared

/// Der Kern des Helfers (Plan §5.2): gleicht alle 2 s die Schlüsseldatei des Core ab, hält je Gerät einen Listener,
/// prüft den Tunnel-Eingang des Core und schreibt die Zustandsdatei.
///
/// - Sicherer Ausfall: Datei fehlt, ist unlesbar, kaputt, hat falsche Rechte oder einen fremden Besitzer, oder der
///   Core ist nicht erreichbar → **alle Listener stoppen** (und ihre Verbindungen schließen). Der Helfer beendet sich
///   dabei nicht selbst, sondern prüft weiter und startet die Listener, sobald alles wieder stimmt.
/// - Entferntes Gerät → sein Listener und seine Verbindungen sind nach höchstens einer Prüfung (2 s) weg.
/// - Der Helfer liest nie das Token und nie Nutzdaten. Es gibt keine HTTP-Route, keinen `--core-url`.
///
/// Eine serielle Queue für alles (Listener, Verbindungen, Zähler). Die Uhr kommt von außen (`now`), die Prüfung läuft über
/// `tick()`: Tests rufen es mit einer Fake-Uhr selbst auf (`autoTick: false`).
public final class TunnelEngine: @unchecked Sendable {
    private let options: TunnelOptions
    private let probe: any TunnelCoreProbing
    private let now: () -> Date
    private let log: @Sendable (String) -> Void
    private let queue = DispatchQueue(label: "de.studiengehirn.tunnel.engine")

    private var listeners: [String: TunnelDeviceListener] = [:]  // device_id → Listener
    private var timer: DispatchSourceTimer?
    private var started = false

    private var lastSignature: TunnelKeySignature?
    private var keys: TunnelKeyFileResult = .missing
    private var coreResult: TunnelCoreProbeResult = .unreachable("noch nicht geprüft")
    private var lastProbe: Date?
    private var probeDue = true
    private var lastStateWrite: Date?
    private var lastWrittenState: TunnelState?
    private var lastError: String?
    private var listenerStartError: String?
    private var failedSinceLog = 0
    private var lastFailedLog: Date?
    private var lastKeyProblemLogged: String?

    public init(
        options: TunnelOptions, probe: (any TunnelCoreProbing)? = nil, now: @escaping () -> Date = { Date() },
        log: @escaping @Sendable (String) -> Void = { _ in }
    ) {
        self.options = options
        let resolved: any TunnelCoreProbing =
            probe ?? UnixSocketProbe(path: options.socketPath, expectedUID: options.expectedUID)
        self.probe = resolved
        self.now = now
        self.log = log
    }

    // MARK: Start und Ende

    /// Prüft die Voraussetzungen, macht die erste Runde und startet (außer mit `autoTick: false`) den 2-s-Takt.
    /// Wirft `TunnelStartError`, wenn der Helfer so nicht laufen darf: als root, Pfad zu lang, Schlüsseldatei
    /// oder Socket gehören einem anderen Benutzer oder haben falsche Rechte.
    public func start() throws {
        try queue.sync {
            guard !started else { return }
            if geteuid() == 0 {
                throw TunnelStartError("sg-tunnel läuft nie als root. Bitte als normaler Benutzer starten.")
            }
            if options.socketPath.utf8.count > TunnelLimits.maxSocketPathBytes {
                throw TunnelStartError(
                    "Der Pfad des Tunnel-Eingangs ist länger als \(TunnelLimits.maxSocketPathBytes) Byte. Mit SG_DATA_DIR einen kürzeren Ordner wählen.")
            }
            let initial = TunnelKeyFile.load(path: options.keysPath, expectedUID: options.expectedUID)
            if case .insecure(let text) = initial { throw TunnelStartError(text) }
            if case .bad(let text) = TunnelSocket.check(path: options.socketPath, expectedUID: options.expectedUID) {
                throw TunnelStartError(text)
            }
            started = true
            runTick()
            if options.autoTick {
                let timer = DispatchSource.makeTimerSource(queue: queue)
                timer.schedule(
                    deadline: .now() + TunnelLimits.keyFilePollSeconds, repeating: TunnelLimits.keyFilePollSeconds)
                timer.setEventHandler { [weak self] in self?.runTick() }
                timer.resume()
                self.timer = timer
            }
        }
    }

    /// Stoppt alle Listener, schließt alle Verbindungen und entfernt die Zustandsdatei
    public func stop() {
        queue.sync {
            timer?.cancel()
            timer = nil
            for listener in listeners.values { listener.stop() }
            listeners.removeAll()
            started = false
            TunnelStateFile.remove(at: options.statePath)
        }
    }

    /// Eine Runde: Schlüsseldatei prüfen, Core prüfen, Listener abgleichen, Zustand schreiben
    public func tick() {
        queue.sync { runTick() }
    }

    // MARK: Auskünfte (Tests, Zustandsdatei)

    public func snapshot() -> TunnelState {
        queue.sync { makeState() }
    }

    /// Port des Listeners eines Geräts, sobald er bereit ist
    public func listenerPort(deviceID: String) -> UInt16? {
        queue.sync { listeners[deviceID]?.port }
    }

    func bridgeCounters() -> [TunnelBridge.Counters] {
        queue.sync { listeners.values.flatMap { $0.bridgeCounters } }
    }

    // MARK: Nur auf `queue`

    private func runTick() {
        guard started else { return }
        let current = now()
        refreshKeys()
        refreshCore(current)
        reconcileListeners(current)
        updateLastError()
        logFailedHandshakes(current)
        writeStateIfNeeded(current, force: false)
    }

    /// Liest die Schlüsseldatei neu, wenn sich Ordner oder Datei geändert haben (Größe, Zeiten, Inode, Rechte)
    private func refreshKeys() {
        let signature = TunnelKeyFile.signature(path: options.keysPath)
        guard signature != lastSignature else { return }
        lastSignature = signature
        keys = TunnelKeyFile.load(path: options.keysPath, expectedUID: options.expectedUID)
        if let problem = keys.problem {
            // Ein Problem nur einmal melden, nicht bei jeder Änderung
            if lastKeyProblemLogged != problem { log("Schlüsseldatei: \(problem) Alle Dienste sind gestoppt.") }
            lastKeyProblemLogged = problem
        } else {
            lastKeyProblemLogged = nil
        }
    }

    private func refreshCore(_ current: Date) {
        let overdue = lastProbe.map { current.timeIntervalSince($0) >= TunnelLimits.coreProbeSeconds } ?? true
        guard probeDue || overdue else { return }
        probeDue = false
        lastProbe = current
        let previous = coreResult
        coreResult = probe.probe()
        if coreResult != previous {
            switch coreResult {
            case .reachable: log("Tunnel-Eingang des Core ist erreichbar.")
            case .unreachable(let text): log("\(text) Alle Dienste sind gestoppt, der Helfer prüft weiter.")
            }
        }
    }

    private var coreReachable: Bool {
        if case .reachable = coreResult { return true }
        return false
    }

    /// Gewünscht ist ein Listener je Gerät mit Schlüssel, aber nur, solange die Datei stimmt **und** der Core antwortet
    private func reconcileListeners(_ current: Date) {
        var wanted: [String: TunnelDevice] = [:]
        if case .devices(let devices) = keys, coreReachable {
            for device in devices { wanted[device.deviceID] = device }
        }
        // Weg damit: entfernte Geräte, geänderte Schlüssel, alles bei Ausfall
        for (id, listener) in listeners {
            let keep = wanted[id].map { $0 == listener.device } ?? false
            let restart = listener.isFailed
                && current.timeIntervalSince(listener.failedAt ?? current) >= TunnelLimits.listenerRestartSeconds
            if !keep || restart {
                listener.stop()
                listeners.removeValue(forKey: id)
            }
        }
        // Neu: Geräte ohne Listener. Scheitert der Start, versucht die nächste Runde es erneut.
        let previousStartError = listenerStartError
        listenerStartError = nil
        for (id, device) in wanted where listeners[id] == nil {
            let listener = TunnelDeviceListener(
                device: device, socketPath: options.socketPath, peerToPeer: options.peerToPeer,
                advertise: options.advertise, queue: queue, hooks: makeHooks())
            do {
                try listener.start()
                listeners[id] = listener
                log("Dienst \(device.serviceName) gestartet.")
            } catch {
                listener.stop()
                let text = "Listener \(device.serviceName) startet nicht: \(error)"
                listenerStartError = text
                if text != previousStartError { log(text) }
            }
        }
    }

    private func makeHooks() -> TunnelDeviceListener.Hooks {
        TunnelDeviceListener.Hooks(
            now: { [weak self] in self?.now() ?? Date() },
            log: { [weak self] text in self?.log(text) },
            handshakeFailed: { [weak self] in self?.failedSinceLog += 1 },
            changed: { [weak self] in self?.listenerChanged() },
            upstreamFailed: { [weak self] in self?.probeDue = true })
    }

    private func listenerChanged() {
        guard started else { return }
        writeStateIfNeeded(now(), force: false, onlyIfChanged: true)
    }

    /// `last_error`: das aktuell wichtigste Problem. Sobald alles stimmt, ist es leer.
    private func updateLastError() {
        if let problem = keys.problem {
            lastError = problem
        } else if case .unreachable(let text) = coreResult {
            lastError = text
        } else if listeners.values.contains(where: { $0.isFailed }) {
            lastError = "Ein Listener ist ausgefallen und wird neu gestartet."
        } else {
            lastError = listenerStartError
        }
    }

    /// Gescheiterte Handshakes: höchstens eine zusammengefasste Zeile je Minute (Plan §5.2, Punkt 6)
    private func logFailedHandshakes(_ current: Date) {
        guard failedSinceLog > 0 else { return }
        if let last = lastFailedLog, current.timeIntervalSince(last) < TunnelLimits.failedLogSeconds { return }
        log("\(failedSinceLog) Handshake(s) gescheitert (falscher Schlüssel, Zeitüberschreitung oder Überlast).")
        failedSinceLog = 0
        lastFailedLog = current
    }

    private func makeState() -> TunnelState {
        let current = now()
        return TunnelState(
            pid: getpid(), version: TunnelInfo.version, updated_at: TunnelStateFile.timestamp(current),
            core: coreReachable ? "ok" : "nicht erreichbar", p2p: options.peerToPeer, keys: keys.label,
            listeners: listeners.values.map { $0.snapshot }.sorted { $0.service_name < $1.service_name },
            last_error: lastError)
    }

    private func writeStateIfNeeded(_ current: Date, force: Bool, onlyIfChanged: Bool = false) {
        let state = makeState()
        let changed = lastWrittenState.map { !state.sameContent(as: $0) } ?? true
        let dueByTime =
            lastStateWrite.map { current.timeIntervalSince($0) >= TunnelLimits.stateWriteSeconds } ?? true
        guard force || changed || (dueByTime && !onlyIfChanged) else { return }
        do {
            try TunnelStateFile.write(state, to: options.statePath)
            lastStateWrite = current
            lastWrittenState = state
        } catch {
            // Nicht schlimm für den Betrieb, aber `sg doctor` sieht dann eine alte Datei und meldet es
            log("Zustandsdatei: \(error)")
        }
    }
}
