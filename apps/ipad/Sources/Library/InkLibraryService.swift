import Foundation
import Observation

/// Dienst über der Bibliothek (T1-11 Rest, UX-30): hält Module, Notizbücher und Seiten aktuell, legt freie
/// Notizbücher an und liefert das Schreibziel (`InkBinding`). Alles, was die Bibliothek ändert, steht erst in der
/// Ablage und wird dann als Operation eingereiht: Bricht die App dazwischen ab, holt der nächste Start es nach.
///
/// Ohne Verbindung passiert beim Abruf nichts. Die Bibliothek bleibt vollständig nutzbar (freie Wahl offline).
@MainActor
@Observable
final class InkLibraryService {
    /// Abrufe der Bibliothek höchstens in diesem Abstand (Startbildschirm und jedes `welcome`)
    static let refreshInterval: TimeInterval = 30

    /// Die Engine, über die Operationen laufen
    let sync: SyncEngine

    /// Laufende oder pausierte Session laut letztem Abruf, `nil` ohne Verbindung oder ohne Session
    private(set) var running: RunningSession?
    /// Zählt bei jeder Änderung der Ablage hoch. Die Ablage selbst ist nicht beobachtbar, die Lesefunktionen unten
    /// lesen diesen Zähler mit, damit SwiftUI nach einer Änderung neu zeichnet.
    private(set) var revision = 0

    @ObservationIgnored private let store: any InkLibraryStore
    @ObservationIgnored private let client: CoreClient
    @ObservationIgnored private let now: @MainActor () -> Date
    @ObservationIgnored private var lastRefreshAt: Date?
    @ObservationIgnored private var isRefreshing = false

    init(
        store: any InkLibraryStore,
        sync: SyncEngine,
        client: CoreClient,
        now: @escaping @MainActor () -> Date = { Date() }
    ) {
        self.store = store
        self.sync = sync
        self.client = client
        self.now = now
    }

    // MARK: Lesen

    /// Alphabetisch, ohne Semesterfilter
    var modules: [LibraryModule] {
        track()
        return store.modules.sorted { first, second in
            let order = first.name.localizedCaseInsensitiveCompare(second.name)
            if order == .orderedSame { return first.id < second.id }
            return order == .orderedAscending
        }
    }

    /// Zeitpunkt des letzten erfolgreichen Abrufs der Module (für „Stand von …“)
    var refreshedAt: Date? {
        track()
        return store.refreshedAt
    }

    func notebooks(inModule moduleID: String) -> [LibraryNotebook] {
        track()
        return store.notebooks(inModule: moduleID)
    }

    func notebook(_ id: String) -> LibraryNotebook? {
        track()
        return store.notebook(id)
    }

    func page(_ id: String) -> LibraryPage? {
        track()
        return store.page(id)
    }

    func moduleName(_ moduleID: String) -> String? {
        track()
        return store.modules.first { $0.id == moduleID }?.name
    }

    // MARK: Abrufen

    /// Module, Notizbücher und laufende Session vom Core holen. Ohne Verbindung passiert nichts.
    /// Ohne `force` höchstens alle 30 s.
    func refresh(force: Bool = false) async {
        guard sync.canReachCore, let access = sync.restAccess() else {
            if running != nil { running = nil }
            return
        }
        guard !isRefreshing else { return }
        if !force, let last = lastRefreshAt, now().timeIntervalSince(last) < InkLibraryService.refreshInterval {
            return
        }
        isRefreshing = true
        lastRefreshAt = now()
        defer { isRefreshing = false }

        do {
            let briefs = try await client.modules(endpoint: access.endpoint, token: access.token)
            guard !_Concurrency.Task.isCancelled else { return }
            store.mergeModules(briefs, at: now())
            bump()
            for brief in briefs {
                do {
                    // Mit `module_id` legt der Core fehlende Standard-Notizbücher an (VERTRAEGE §7.4)
                    let notebooks = try await client.notebooks(
                        endpoint: access.endpoint, token: access.token, moduleID: brief.id)
                    guard !_Concurrency.Task.isCancelled else { return }
                    store.mergeNotebooks(notebooks, moduleID: brief.id)
                } catch {
                    sync.reportRESTError(error)
                    if (error as? ConnectionError) == .tokenInvalid { break }
                }
            }
        } catch {
            sync.reportRESTError(error)
        }
        guard !_Concurrency.Task.isCancelled else { return }
        await refreshRunning(access)
        bump()
    }

    /// Seiten eines Notizbuchs mit dem Core zusammenführen (beim Öffnen, wenn erreichbar)
    func refreshPages(notebookID: String) async {
        guard sync.canReachCore, let access = sync.restAccess(), store.notebook(notebookID) != nil else { return }
        // Die beiden Mengen vor dem Abruf ermitteln und danach vereinigen: Ein `ack`, das während des Abrufs
        // eintrifft, darf eine veraltete Antwort nicht durchsetzen (eben bestätigtes Umsortieren, gelöschte Seite)
        let updatesBefore = sync.pendingPageIDs(kind: "page.update")
        let deletesBefore = sync.pendingPageIDs(kind: "page.delete")
        let remote: [Page]
        do {
            remote = try await client.notebookPages(
                endpoint: access.endpoint, token: access.token, notebookID: notebookID)
        } catch {
            sync.reportRESTError(error)
            return
        }
        guard !_Concurrency.Task.isCancelled, store.notebook(notebookID) != nil else { return }
        // Seiten in der Löschfrist (5 s) zählen später ebenfalls zu den ausstehenden Löschungen. Gelöscht wird erst
        // mit dem Seitenwechsel (T1-13 Teil 1), in diesem Schritt gibt es sie noch nicht.
        let updates = updatesBefore.union(sync.pendingPageIDs(kind: "page.update"))
        let deletes = deletesBefore.union(sync.pendingPageIDs(kind: "page.delete"))
        store.mergePages(remote, notebookID: notebookID, pendingUpdatePageIDs: updates, pendingDeletePageIDs: deletes)

        // Neue `db_epoch`: Eine Seite, die der Core nicht mehr kennt und die nie wieder geöffnet wird, käme sonst
        // nie zurück. `page.create` ist idempotent, die Striche folgen beim Öffnen der Seite (Abgleich).
        let remoteIDs = Set(remote.map(\.id))
        let alreadyQueued = sync.pendingPageIDs(kind: "page.create")
        var drafts: [OutboxDraft] = []
        for local in store.pages(inNotebook: notebookID)
        where local.needsReconcile && local.createQueued && !remoteIDs.contains(local.id)
            && !alreadyQueued.contains(local.id)
        {
            if let draft = InkOpBuilder.pageCreate(
                page: local, nowMS: nowMS(), offsetMS: sync.clockOffsetForDrafts, makeID: { InkID.uuidV7() })
            {
                drafts.append(draft)
            }
        }
        if !drafts.isEmpty {
            sync.enqueue(drafts: drafts)
        }
        bump()
    }

    // MARK: Anlegen

    /// Freies Notizbuch anlegen: erst lokal speichern, dann `notebook.create` einreihen. Geht auch offline.
    /// - Returns: `nil` bei leerem Titel, unbekanntem Modul oder wenn das Schreiben scheitert
    func createNotebook(moduleID: String, title: String) -> LibraryNotebook? {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        // Ein leerer Titel ergäbe `message_invalid` und die Fehlerablage
        guard !trimmed.isEmpty, store.modules.contains(where: { $0.id == moduleID }) else { return nil }
        let notebook = LibraryNotebook(
            id: InkID.uuidV7(),
            moduleID: moduleID,
            title: trimmed,
            kind: .frei,
            createdAtMS: nowMS(),
            knownOnServer: false,
            hidden: false,
            lastPageID: nil,
            remoteMaxIndex: 0,
            remoteOnlyPageCount: 0
        )
        store.upsert(notebook)
        guard
            let draft = InkOpBuilder.notebookCreate(
                notebook: notebook, nowMS: nowMS(), offsetMS: sync.clockOffsetForDrafts,
                makeID: { InkID.uuidV7() }),
            sync.enqueue(drafts: [draft])
        else {
            store.removeNotebook(notebook.id)
            bump()
            return nil
        }
        bump()
        return notebook
    }

    // MARK: Schreibziel

    /// Schreibziel für ein Notizbuch: die letzte Seite, sonst die mit dem höchsten `index`, sonst eine neue.
    /// Gibt es noch keine Seite, wird sie angelegt und `page.create` eingereiht (nur beim ersten Mal).
    func openTarget(notebookID: String) -> InkBinding? {
        guard let notebook = store.notebook(notebookID) else { return nil }
        let pages = store.pages(inNotebook: notebookID)
        var page: LibraryPage
        if let lastID = notebook.lastPageID, let last = pages.first(where: { $0.id == lastID }) {
            page = last
        } else if let highest = pages.max(by: { ($0.index, $0.id) < ($1.index, $1.id) }) {
            page = highest
        } else {
            let session = matchingSession(moduleID: notebook.moduleID)
            page = LibraryPage(
                id: InkID.uuidV7(),
                notebookID: notebook.id,
                index: max(0, notebook.remoteMaxIndex) + 1,
                template: .blanko,
                widthPt: LibraryPage.a4Width,
                heightPt: LibraryPage.a4Height,
                sessionID: session?.id,
                backgroundSlideID: nil,
                attachedSlideID: nil,
                version: 1,
                createQueued: false,
                needsReconcile: false,
                deletedAtMS: nil,
                deleteQueued: false
            )
            // Erst die Bibliothek, dann die Operation
            store.upsert(page)
        }
        guard let queued = ensureCreateQueued(page, notebook: notebook) else { return nil }
        page = queued
        store.setLast(notebookID: notebook.id, pageID: page.id)
        bump()
        return makeBinding(notebook: notebook, page: page)
    }

    /// Aktuelles Schreibziel der Seite, mit frischer Session-Zuordnung (die Vorlesung kann nach dem Öffnen starten)
    func target(forPage pageID: String) -> InkBinding? {
        guard let page = store.page(pageID), let notebook = store.notebook(page.notebookID) else { return nil }
        return makeBinding(notebook: notebook, page: page)
    }

    // MARK: Intern

    private func nowMS() -> Int {
        InkStrokeCodec.milliseconds(now())
    }

    private func bump() {
        revision += 1
    }

    /// Meldet SwiftUI, wovon die Lesefunktionen abhängen: eigene Änderungen (`revision`) und die der Engine. Die
    /// Engine ändert die Ablage auch selbst, etwa wenn `notebook.create` in die Fehlerablage geht
    /// (`removeNotebook`). Das zeigt sich an `deadLetterCount`.
    private func track() {
        _ = revision
        _ = sync.deadLetterCount
    }

    private func matchingSession(moduleID: String) -> RunningSession? {
        guard let running, running.moduleID == moduleID else { return nil }
        return running
    }

    private func makeBinding(notebook: LibraryNotebook, page: LibraryPage) -> InkBinding {
        let session = matchingSession(moduleID: notebook.moduleID)
        return InkBinding(
            notebookID: notebook.id,
            pageID: page.id,
            moduleID: notebook.moduleID,
            pageCreated: page.createQueued,
            needsReconcile: page.needsReconcile,
            sessionID: session?.id,
            sessionStartMS: session?.startMS,
            moduleName: store.modules.first { $0.id == notebook.moduleID }?.name
        )
    }

    /// Reiht `page.create` ein, falls noch nicht geschehen. Bei einem freien Notizbuch, das der Core noch nicht
    /// kennt und für das kein `notebook.create` mehr wartet, steht die Notizbuch-Operation davor (idempotent).
    /// - Returns: die Seite mit gesetztem `createQueued`, `nil`, wenn das Schreiben scheitert
    private func ensureCreateQueued(_ page: LibraryPage, notebook: LibraryNotebook) -> LibraryPage? {
        guard !page.createQueued else { return page }
        var drafts: [OutboxDraft] = []
        if notebook.kind == .frei, !notebook.knownOnServer,
            !sync.hasPending(kind: "notebook.create", stream: notebook.stream),
            let first = InkOpBuilder.notebookCreate(
                notebook: notebook, nowMS: nowMS(), offsetMS: sync.clockOffsetForDrafts,
                makeID: { InkID.uuidV7() })
        {
            drafts.append(first)
        }
        guard
            let create = InkOpBuilder.pageCreate(
                page: page, nowMS: nowMS(), offsetMS: sync.clockOffsetForDrafts, makeID: { InkID.uuidV7() })
        else { return nil }
        drafts.append(create)
        guard sync.enqueue(drafts: drafts) else { return nil }
        var queued = page
        queued.createQueued = true
        store.upsert(queued)
        return queued
    }

    private func refreshRunning(_ access: (endpoint: CoreEndpoint, token: String)) async {
        let sessions: [Session]
        do {
            sessions = try await client.activeSessions(endpoint: access.endpoint, token: access.token)
        } catch {
            sync.reportRESTError(error)
            return
        }
        // Die zuletzt begonnene Session
        guard let session = sessions.max(by: { ($0.startedAt ?? $0.createdAt) < ($1.startedAt ?? $1.createdAt) })
        else {
            running = nil
            return
        }
        var notebook: Notebook?
        do {
            // Der Core entscheidet (#199): „Übung“ bei Übung und Tutorium, sonst „Vorlesung“
            notebook = try await client.sessionNotebook(
                endpoint: access.endpoint, token: access.token, sessionID: session.id)
            if notebook == nil {
                // Älterer Core ohne den Endpunkt (404): die alte Regel, das erste „Vorlesung“ des Moduls
                let all = try await client.notebooks(
                    endpoint: access.endpoint, token: access.token, moduleID: session.moduleID)
                notebook = all.first { $0.kind == .vorlesung && $0.deletedAt == nil }
            }
        } catch {
            sync.reportRESTError(error)
        }
        guard !_Concurrency.Task.isCancelled else { return }
        if let notebook, store.notebook(notebook.id) == nil {
            // Ein Notizbuch, das der Abruf der Module noch nicht kannte
            store.upsert(
                LibraryNotebook(
                    id: notebook.id,
                    moduleID: notebook.moduleID,
                    title: notebook.title,
                    kind: notebook.kind,
                    createdAtMS: InkStrokeCodec.milliseconds(notebook.createdAt),
                    knownOnServer: true,
                    hidden: false,
                    lastPageID: nil,
                    remoteMaxIndex: 0,
                    remoteOnlyPageCount: 0
                ))
        }
        running = RunningSession(
            id: session.id,
            moduleID: session.moduleID,
            startMS: session.startedAt.map { InkStrokeCodec.milliseconds($0) },
            slideDeckID: session.slideDeckID,
            notebookID: notebook?.id
        )
    }
}
