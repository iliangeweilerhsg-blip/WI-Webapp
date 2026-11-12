import Foundation
import XCTest

@testable import StudienGehirn

/// Virtuelle Uhr: `sleep` wartet, bis der Test die Zeit mit `advance` weiterdreht
@MainActor
final class VirtualClock {
    private struct Sleeper {
        let id: Int
        let deadline: TimeInterval
        let continuation: CheckedContinuation<Void, Error>
    }

    let start = Date(timeIntervalSince1970: 1_762_246_500)
    private(set) var elapsed: TimeInterval = 0
    private var sleepers: [Sleeper] = []
    private var nextID = 0

    var date: Date { start.addingTimeInterval(elapsed) }

    func sleep(_ duration: Duration) async throws {
        let parts = duration.components
        let seconds = Double(parts.seconds) + Double(parts.attoseconds) / 1e18
        nextID += 1
        let id = nextID
        let deadline = elapsed + seconds
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                if _Concurrency.Task.isCancelled {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                sleepers.append(Sleeper(id: id, deadline: deadline, continuation: continuation))
            }
        } onCancel: {
            _Concurrency.Task { @MainActor in
                self.cancel(id)
            }
        }
    }

    private func cancel(_ id: Int) {
        guard let index = sleepers.firstIndex(where: { $0.id == id }) else { return }
        let sleeper = sleepers.remove(at: index)
        sleeper.continuation.resume(throwing: CancellationError())
    }

    /// Dreht die Zeit weiter und weckt dabei jeden Schläfer zu seiner Zeit, der Reihe nach
    func advance(_ seconds: TimeInterval) async {
        let target = elapsed + seconds
        await settle()
        while let next = sleepers.filter({ $0.deadline <= target }).min(by: { $0.deadline < $1.deadline }) {
            sleepers.removeAll { $0.id == next.id }
            elapsed = max(elapsed, next.deadline)
            next.continuation.resume()
            await settle()
        }
        elapsed = target
        await settle()
    }

    /// Lässt alle bereiten Aufgaben laufen
    func settle() async {
        for _ in 0..<300 {
            await _Concurrency.Task.yield()
        }
    }
}

/// Wartet (mit Yield), bis die Bedingung gilt
@MainActor
func eventually(_ condition: @MainActor () -> Bool) async -> Bool {
    for _ in 0..<3000 {
        if condition() { return true }
        await _Concurrency.Task.yield()
    }
    return condition()
}

/// Antwort des Fake-Servers auf eine Operation
enum FakeOpReply {
    case ack
    case silent
    case error(code: String, retryable: Bool, fatal: Bool)
}

/// WebSocket mit Skript: antwortet wie der Core, solange der Test nichts anderes einstellt
@MainActor
final class FakeSyncSocket: SyncSocket {
    private(set) var sent: [String] = []
    private(set) var isClosed = false
    private var inbox: [Result<String, SyncSocketError>] = []
    private var waiter: CheckedContinuation<String, Error>?
    private var opCount = 0
    private var seq = 0

    /// Antwort auf die n-te Operation dieser Verbindung (ab 0)
    var opPolicy: (_ opID: String, _ kind: String, _ index: Int) -> FakeOpReply = { _, _, _ in .ack }
    var answersPing = true
    var epoch = "epoch-1"
    /// Versatz Mac − iPad, den der Fake in `time.pong` meldet (die virtuelle Uhr steht still)
    var timeOffset = 2000
    /// Die Verbindung scheitert gleich beim ersten Lesen
    var initialFailure: SyncSocketError?

    func send(_ text: String) async throws {
        if isClosed { throw SyncSocketError.transport(URLError(.networkConnectionLost)) }
        sent.append(text)
        guard
            let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
            let type = object["type"] as? String
        else { return }
        switch type {
        case "hello":
            push(
                """
                {"type":"welcome","protocol":1,"device_id":"\(Fixtures.deviceID)","server_version":"0.1.0","server_time":1762246500000,"db_epoch":"\(epoch)","resume":[]}
                """)
        case "time.ping":
            let t0 = object["t0"] as? Int ?? 0
            push("{\"type\":\"time.pong\",\"t0\":\(t0),\"ts\":\(t0 + timeOffset)}")
        case "ping":
            if answersPing { push("{\"type\":\"pong\"}") }
        case "op":
            let opID = object["op_id"] as? String ?? ""
            let kind = object["kind"] as? String ?? ""
            let stream = object["stream"] as? String ?? ""
            let index = opCount
            opCount += 1
            switch opPolicy(opID, kind, index) {
            case .ack:
                ack(opID, stream: stream)
            case .silent:
                break
            case .error(let code, let retryable, let fatal):
                push(
                    "{\"type\":\"error\",\"code\":\"\(code)\",\"message\":\"Testfehler\",\"op_id\":\"\(opID)\",\"retryable\":\(retryable),\"fatal\":\(fatal)}"
                )
            }
        default:
            break
        }
    }

    func receive() async throws -> String {
        if let initialFailure {
            self.initialFailure = nil
            throw initialFailure
        }
        if !inbox.isEmpty {
            return try inbox.removeFirst().get()
        }
        if isClosed { throw SyncSocketError.transport(URLError(.cancelled)) }
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
            waiter = continuation
        }
    }

    func close() {
        isClosed = true
        if let waiter {
            self.waiter = nil
            waiter.resume(throwing: SyncSocketError.transport(URLError(.cancelled)))
        }
    }

    // MARK: Server spielen

    func push(_ text: String) {
        deliver(.success(text))
    }

    /// Der Server schließt die Verbindung mit diesem Code
    func fail(_ error: SyncSocketError) {
        deliver(.failure(error))
    }

    func ack(_ opID: String, stream: String = "notebook:x") {
        seq += 1
        push("{\"type\":\"ack\",\"op_id\":\"\(opID)\",\"stream\":\"\(stream)\",\"seq\":\(seq)}")
    }

    private func deliver(_ result: Result<String, SyncSocketError>) {
        if let waiter {
            self.waiter = nil
            switch result {
            case .success(let text): waiter.resume(returning: text)
            case .failure(let error): waiter.resume(throwing: error)
            }
        } else {
            inbox.append(result)
        }
    }

    // MARK: Auswerten

    var messages: [[String: Any]] {
        sent.compactMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
    }

    var types: [String] { messages.compactMap { $0["type"] as? String } }

    /// Gesendete Operationen als (JSON-Text, Objekt)
    var ops: [(text: String, object: [String: Any])] {
        sent.compactMap { text in
            guard
                let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                object["type"] as? String == "op"
            else { return nil }
            return (text, object)
        }
    }

    var opIDs: [String] { ops.compactMap { $0.object["op_id"] as? String } }
}

@MainActor
final class FakeSyncSocketFactory: SyncSocketFactory {
    private(set) var sockets: [FakeSyncSocket] = []
    private(set) var requests: [URLRequest] = []
    /// Höchste Zahl noch offener Verbindungen, die beim Öffnen einer neuen bestand
    private(set) var maxOpenAtOpen = 0
    /// Stellt die n-te Verbindung ein, bevor sie benutzt wird
    var configure: (FakeSyncSocket, Int) -> Void = { _, _ in }

    func open(_ request: URLRequest) -> any SyncSocket {
        maxOpenAtOpen = max(maxOpenAtOpen, sockets.filter { !$0.isClosed }.count)
        let socket = FakeSyncSocket()
        configure(socket, sockets.count)
        sockets.append(socket)
        requests.append(request)
        return socket
    }
}

/// Alles, was ein Engine-Test braucht
@MainActor
final class SyncHarness {
    let directory: URL
    let clock: VirtualClock
    let outbox: SyncOutbox
    let library: FileInkLibraryStore
    let service: InkLibraryService
    let tokens: FakeTokenStore
    let transport: FakeTransport
    let factory: FakeSyncSocketFactory
    let engine: SyncEngine
    let binding: InkBinding

    init(health: [FakeTransport.Reply] = [.http(status: 200, body: "{}")]) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("sync-test-\(UUID().uuidString)", isDirectory: true)
        let clock = VirtualClock()
        let outbox = SyncOutbox(directory: directory)
        let transport = FakeTransport(health)
        let factory = FakeSyncSocketFactory()
        let library = FileInkLibraryStore(url: directory.appendingPathComponent("library.json"))
        let tokens = FakeTokenStore(token: Fixtures.token)
        let binding = InkBinding(
            notebookID: "019a4e14-0000-7000-8000-0000000000a2",
            pageID: "019a4e14-0000-7000-8000-0000000000b1",
            moduleID: "019a4e14-0000-7000-8000-0000000000c1",
            pageCreated: true,
            needsReconcile: false,
            sessionID: nil,
            sessionStartMS: nil
        )
        // Ein Modul mit einem Vorlesungs-Notizbuch und einer Seite, wie nach der Migration einer alten Bindung
        library.mergeModules(
            [ModuleBrief(id: binding.moduleID, name: "Analysis I", shortName: nil, inkMode: nil)], at: clock.date)
        library.upsert(
            LibraryNotebook(
                id: binding.notebookID, moduleID: binding.moduleID, title: "Vorlesung", kind: .vorlesung,
                createdAtMS: 1, knownOnServer: true, hidden: false, lastPageID: binding.pageID,
                remoteMaxIndex: 0, remoteOnlyPageCount: 0))
        library.upsert(
            LibraryPage(
                id: binding.pageID, notebookID: binding.notebookID, index: 1, template: .blanko,
                widthPt: 595, heightPt: 842, sessionID: nil, backgroundSlideID: nil, attachedSlideID: nil,
                version: 1, createQueued: true, needsReconcile: false, deletedAtMS: nil, deleteQueued: false))
        library.setLast(notebookID: binding.notebookID, pageID: binding.pageID)

        self.directory = directory
        self.clock = clock
        self.outbox = outbox
        self.transport = transport
        self.factory = factory
        self.library = library
        self.tokens = tokens
        self.binding = binding
        let client = Fixtures.client(transport)
        let engine = SyncEngine(
            client: client,
            sockets: factory,
            outbox: outbox,
            library: library,
            tokenStore: tokens,
            appVersion: "1.2.3",
            now: { clock.date },
            sleep: { try await clock.sleep($0) },
            random: { 0 }
        )
        self.engine = engine
        service = InkLibraryService(store: library, sync: engine, client: client, now: { clock.date })
    }

    func stroke(_ id: String, tStart: Int? = nil) -> Stroke {
        Stroke(
            bbox: [0, 0, 10, 10],
            clientID: id,
            color: "#000000FF",
            createdAt: 1_762_246_500_000,
            layer: .ink,
            points: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            tEndMS: tStart.map { $0 + 100 },
            tStartMS: tStart,
            tool: .pen,
            transform: [1, 0, 0, 1, 0, 0],
            width: 2
        )
    }

    /// Reiht n Striche ein
    @discardableResult
    func enqueueStrokes(_ count: Int, prefix: String = "s") -> Bool {
        var ok = true
        for index in 0..<count {
            ok = engine.enqueue([.upsert(stroke("\(prefix)\(index)"))], binding: binding) && ok
        }
        return ok
    }

    func start() {
        engine.start(mac: Fixtures.pairedMac)
    }
}
