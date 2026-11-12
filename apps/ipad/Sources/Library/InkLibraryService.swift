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
    /// Löschfrist: So lange lässt sich eine gelöschte Seite zurückholen. `page.delete` wird erst danach eingereiht.
    static let deleteGrace: Duration = .seconds(5)

    /// Die Engine, über die Operationen laufen
    let sync: SyncEngine

    /// Laufende oder pausierte Session laut letztem Abruf, `nil` ohne Verbindung oder ohne Session
    private(set) var running: RunningSession?
    /// Zählt bei jeder Änderung der Ablage hoch. Die Ablage selbst ist nicht beobachtbar, die Lesefunktionen unten
    /// lesen diesen Zähler mit, damit SwiftUI nach einer Änderung neu zeichnet.
    private(set) var revision = 0

    @ObservationIgnored private let store: any InkLibraryStore
    @ObservationIgnored private let client: CoreClient
    @ObservationIgnored private let pageStore: (any InkPageStore)?
    @ObservationIgnored private let now: @MainActor () -> Date
    @ObservationIgnored private var lastRefreshAt: Date?
    @ObservationIgnored private var isRefreshing = false
    @ObservationIgnored private let graceSleep: @MainActor (Duration) async throws -> Void
    /// Laufende Löschfristen je Seite
    @ObservationIgnored private var graceTasks: [String: _Concurrency.Task<Void, Never>] = [:]
    /// Seiten, deren `page_version_conflict` gerade aufgelöst wird
    @ObservationIgnored private var resolvingConflicts = Set<String>()

    init(
        store: any InkLibraryStore,
        sync: SyncEngine,
        client: CoreClient,
        pageStore: (any InkPageStore)? = nil,
        now: @escaping @MainActor () -> Date = { Date() },
        graceSleep: @escaping @MainActor (Duration) async throws -> Void = { try await _Concurrency.Task.sleep(for: $0) }
    ) {
        self.store = store
        self.sync = sync
        self.client = client
        self.pageStore = pageStore
        self.now = now
        self.graceSleep = graceSleep
        adoptLegacyTestPage()
        sync.onPageVersionConflict = { [weak self] pageID in
            _Concurrency.Task { await self?.resolveVersionConflict(pageID: pageID) }
        }
        // Stürzte die App in der Löschfrist ab, steht die Seite als gelöscht in der Bibliothek, ihr `page.delete`
        // fehlt aber noch: jetzt nachreihen
        flushPendingDeletes()
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

    /// Sichtbare Seiten eines Notizbuchs nach `index`, dann `id`. Gelöschte (auch in der Löschfrist) fehlen.
    func pages(inNotebook notebookID: String) -> [LibraryPage] {
        track()
        return store.pages(inNotebook: notebookID)
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
            // Waren beim Start noch keine Module bekannt, wird die Übernahme der alten Testseite jetzt nachgeholt
            adoptLegacyTestPage()
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
        // Seiten in der Löschfrist (5 s) zählen zu den ausstehenden Löschungen: Ihr `page.delete` steht noch nicht in
        // der Warteschlange, der Core kennt sie aber noch. Sonst käme eine eben gelöschte Seite zurück. Die Menge wird
        // erst nach dem Abruf gelesen: Eine Seite, die währenddessen gelöscht wurde, gehört dazu.
        let grace = Set(store.pagesInDeleteGrace().map(\.id))
        let updates = updatesBefore.union(sync.pendingPageIDs(kind: "page.update"))
        let deletes = deletesBefore.union(sync.pendingPageIDs(kind: "page.delete")).union(grace)
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

    // MARK: Alte Testseite

    /// Name des Notizbuchs, in das die alte lokale Testseite übernommen wird
    static let legacyNotebookTitle = "Alte Schreibfläche"

    /// Einmalige Übernahme der alten lokalen Testseite (`InkPageModel.testPageID`, bis #224 ohne laufende Vorlesung
    /// beschrieben) in ein freies Notizbuch „Alte Schreibfläche“. Zielmodul ist das des zuletzt benutzten Notizbuchs,
    /// sonst das erste Modul der Bibliothek. Gibt es noch kein Modul, passiert nichts: Der nächste Start oder der
    /// erste Abruf der Module versucht es erneut. Hat die Seite keine Striche, wird nichts angelegt.
    ///
    /// Idempotent über die Marke `legacyTestPageHandled` und darüber, dass die Seite danach in der Bibliothek steht.
    /// Es wird nichts gelöscht: Die Dateien unter `Ink/<page_id>/` bleiben und sind jetzt die Seite des Notizbuchs.
    /// Notizbuch, `page.create` und alle Striche kommen in einem Schritt in die Warteschlange.
    func adoptLegacyTestPage() {
        guard !store.legacyTestPageHandled, let pageStore else { return }
        let pageID = InkPageModel.testPageID
        if store.page(pageID) != nil {
            store.markLegacyTestPageHandled()
            return
        }
        let moduleID = store.lastNotebookID.flatMap { store.notebook($0)?.moduleID } ?? modules.first?.id
        guard let moduleID, store.modules.contains(where: { $0.id == moduleID }) else { return }

        let model = InkPageModel(pageID: pageID, store: pageStore, saveDelay: .seconds(1))
        let strokes = model.neutralStrokes()
        guard !strokes.isEmpty else {
            store.markLegacyTestPageHandled()
            return
        }

        // Brach ein früherer Versuch zwischen Notizbuch und Seite ab, steht das Notizbuch schon da: weiterverwenden,
        // sonst entstünde ein zweites, leeres „Alte Schreibfläche“
        let orphan = store.allNotebooks().first { $0.kind == .frei && !$0.knownOnServer && $0.lastPageID == pageID }
        let notebook = orphan ?? LibraryNotebook(
            id: InkID.uuidV7(),
            moduleID: moduleID,
            title: InkLibraryService.legacyNotebookTitle,
            kind: .frei,
            createdAtMS: nowMS(),
            knownOnServer: false,
            hidden: false,
            lastPageID: pageID,
            remoteMaxIndex: 0,
            remoteOnlyPageCount: 0
        )
        var page = LibraryPage(
            id: pageID,
            notebookID: notebook.id,
            index: 1,
            template: .blanko,
            widthPt: Double(model.pageSize.width),
            heightPt: Double(model.pageSize.height),
            sessionID: nil,
            backgroundSlideID: nil,
            attachedSlideID: nil,
            version: 1,
            createQueued: false,
            needsReconcile: false,
            deletedAtMS: nil,
            deleteQueued: false
        )
        // Erst die Bibliothek, dann die Operationen. Bricht die App dazwischen ab, steht die Seite ohne
        // `createQueued` da: `openTarget` reiht dann `page.create` nach und der Abgleich beim Öffnen die Striche.
        page.needsReconcile = true
        store.upsert(notebook)
        store.upsert(page)

        let binding = makeBinding(notebook: notebook, page: page)
        guard
            let first = InkOpBuilder.notebookCreate(
                notebook: notebook, nowMS: nowMS(), offsetMS: sync.clockOffsetForDrafts,
                makeID: { InkID.uuidV7() }),
            let create = InkOpBuilder.pageCreate(
                page: page, nowMS: nowMS(), offsetMS: sync.clockOffsetForDrafts, makeID: { InkID.uuidV7() })
        else { return }
        let strokeOps = InkOpBuilder.ops(
            for: strokes.map { .upsert($0) }, binding: binding, nowMS: nowMS(),
            offsetMS: sync.clockOffsetForDrafts, makeID: { InkID.uuidV7() })
        guard sync.enqueue(drafts: [first, create] + strokeOps) else { return }

        page.createQueued = true
        page.needsReconcile = false
        store.upsert(page)
        store.markLegacyTestPageHandled()
        // Die Zuordnung der Striche zu ihren `client_id` festhalten, damit das Öffnen keine neuen IDs vergibt
        model.outboxNumberProvider = { [sync] in sync.outboxLastNumber }
        model.markNeedsReconcile()
        model.reconcileFinished()
        model.saveNow()
        bump()
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
                index: nextIndex(in: notebook),
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

    // MARK: Seiten (T1-13 Teil 1)

    /// Hängt eine Seite an: `index` = höchster bekannter Index + 1 (lokal, in der Löschfrist und laut
    /// `GET /notebooks/{id}/pages`, VERTRAEGE §7.4). Erst die Bibliothek, dann `page.create`. Die Session setzt der
    /// Dienst nur, wenn die laufende Session zum Modul des Notizbuchs gehört.
    /// - Returns: `nil`, wenn das Notizbuch unbekannt ist oder das Schreiben scheitert
    func addPage(
        notebookID: String, template: PageTemplate, size: CGSize, backgroundSlideID: String?,
        attachedSlideID: String?
    ) -> LibraryPage? {
        guard let notebook = store.notebook(notebookID), size.width > 0, size.height > 0 else { return nil }
        let page = LibraryPage(
            id: InkID.uuidV7(),
            notebookID: notebook.id,
            index: nextIndex(in: notebook),
            template: template,
            widthPt: Double(size.width),
            heightPt: Double(size.height),
            sessionID: matchingSession(moduleID: notebook.moduleID)?.id,
            backgroundSlideID: backgroundSlideID,
            attachedSlideID: attachedSlideID,
            version: 1,
            createQueued: false,
            needsReconcile: false,
            deletedAtMS: nil,
            deleteQueued: false
        )
        store.upsert(page)
        guard let queued = ensureCreateQueued(page, notebook: notebook) else {
            store.removePage(page.id)
            bump()
            return nil
        }
        bump()
        return queued
    }

    /// Öffnet eine bestimmte Seite als Schreibziel (Blättern, Seitenleiste). Merkt sie als letzte Seite des Notizbuchs.
    /// - Returns: `nil` für unbekannte oder gelöschte Seiten
    func openPage(pageID: String) -> InkBinding? {
        guard let page = store.page(pageID), page.deletedAtMS == nil, let notebook = store.notebook(page.notebookID),
            let queued = ensureCreateQueued(page, notebook: notebook)
        else { return nil }
        store.setLast(notebookID: notebook.id, pageID: queued.id)
        bump()
        return makeBinding(notebook: notebook, page: queued)
    }

    /// Setzt die Vorlage. Von oder nach „Folie“ wechselt die Seite nicht (VERTRAEGE §7.4). Reiht ein `page.update` mit
    /// dem vollständigen Stand ein.
    /// - Returns: `false` bei unbekannter oder gelöschter Seite, bei „Folie“ und wenn das Schreiben scheitert
    @discardableResult
    func setTemplate(pageID: String, _ template: PageTemplate) -> Bool {
        guard let page = store.page(pageID), page.deletedAtMS == nil, page.template != .folie, template != .folie
        else { return false }
        if page.template == template { return true }
        var updated = page
        updated.template = template
        return commitUpdates([(original: page, updated: updated)])
    }

    /// Verschiebt eine Seite von Platz `from` nach `to` (0-basiert, in der Reihenfolge der sichtbaren Seiten).
    /// Nummeriert dicht neu (1 … n) und reiht ein `page.update` je Seite ein, deren `index` sich ändert. Jede
    /// Operation beruht auf der Version der Seite, danach steigt sie um 1.
    /// - Returns: `false` bei ungültigen Plätzen oder wenn das Schreiben scheitert. Gleicher Platz: `true`, nichts
    ///   wird eingereiht.
    @discardableResult
    func movePage(notebookID: String, from: Int, to: Int) -> Bool {
        var pages = store.pages(inNotebook: notebookID)
        guard pages.indices.contains(from), pages.indices.contains(to) else { return false }
        if from == to { return true }
        let moved = pages.remove(at: from)
        pages.insert(moved, at: to)
        var changes: [(original: LibraryPage, updated: LibraryPage)] = []
        for (offset, page) in pages.enumerated() where page.index != offset + 1 {
            var updated = page
            updated.index = offset + 1
            changes.append((original: page, updated: updated))
        }
        return commitUpdates(changes)
    }

    /// Löscht mit Frist (kein Dialog): Die Seite ist sofort unsichtbar, `page.delete` wird erst nach
    /// `deleteGrace` (5 s) eingereiht, oder früher mit `flushPendingDeletes`. Bis dahin bringt `undoDelete` sie
    /// vollständig zurück. Zeichnung und Vorschaubild bleiben auf dem iPad.
    func deletePage(pageID: String) {
        guard var page = store.page(pageID), page.deletedAtMS == nil else { return }
        page.deletedAtMS = nowMS()
        page.deleteQueued = false
        store.upsert(page)
        scheduleCommit(pageID: pageID)
        bump()
    }

    /// Holt eine Seite aus der Löschfrist zurück. Nach Ablauf der Frist (`page.delete` eingereiht) geht das nicht mehr.
    @discardableResult
    func undoDelete(pageID: String) -> Bool {
        guard var page = store.page(pageID), page.deletedAtMS != nil, !page.deleteQueued else { return false }
        graceTasks[pageID]?.cancel()
        graceTasks[pageID] = nil
        page.deletedAtMS = nil
        store.upsert(page)
        bump()
        return true
    }

    /// Reiht `page.delete` für alle Seiten in der Löschfrist sofort ein (Verlassen, Hintergrund, Start)
    func flushPendingDeletes() {
        for page in store.pagesInDeleteGrace() {
            graceTasks[page.id]?.cancel()
            commitDelete(pageID: page.id)
        }
    }

    private func scheduleCommit(pageID: String) {
        graceTasks[pageID]?.cancel()
        let sleeper = graceSleep
        graceTasks[pageID] = _Concurrency.Task { [weak self] in
            do {
                try await sleeper(InkLibraryService.deleteGrace)
            } catch {
                return
            }
            self?.commitDelete(pageID: pageID)
        }
    }

    /// Die Frist ist um: `page.delete` einreihen und die Bibliothek vermerken. Scheitert das Einreihen, bleibt die
    /// Seite in der Löschfrist und der nächste `flushPendingDeletes` versucht es erneut.
    @discardableResult
    private func commitDelete(pageID: String) -> Bool {
        graceTasks[pageID] = nil
        guard var page = store.page(pageID), page.deletedAtMS != nil, !page.deleteQueued else { return true }
        // Kennt der Core die Seite nicht (`page.create` nie eingereiht), gibt es nichts zu löschen
        if page.createQueued {
            guard
                let draft = InkOpBuilder.pageDelete(
                    page: page, nowMS: nowMS(), offsetMS: sync.clockOffsetForDrafts, makeID: { InkID.uuidV7() }),
                sync.enqueue(drafts: [draft])
            else { return false }
        }
        page.deleteQueued = true
        store.upsert(page)
        bump()
        return true
    }

    /// Schreibt geänderte Seiten in die Bibliothek (Version + 1) und reiht je Seite ein `page.update` ein. Scheitert
    /// das Einreihen, wird die Bibliothek zurückgesetzt. Seiten ohne `createQueued` bekommen kein `page.update`:
    /// Ihr `page.create` trägt später schon den neuen Stand.
    private func commitUpdates(_ changes: [(original: LibraryPage, updated: LibraryPage)]) -> Bool {
        var drafts: [OutboxDraft] = []
        var stored: [LibraryPage] = []
        for change in changes {
            var page = change.updated
            if change.original.createQueued {
                guard
                    let draft = InkOpBuilder.pageUpdate(
                        page: change.updated, nowMS: nowMS(), offsetMS: sync.clockOffsetForDrafts,
                        makeID: { InkID.uuidV7() })
                else { return false }
                drafts.append(draft)
                page.version = change.original.version + 1
            }
            stored.append(page)
        }
        // Erst die Bibliothek, dann die Operationen
        for page in stored {
            store.upsert(page)
        }
        if !drafts.isEmpty, !sync.enqueue(drafts: drafts) {
            for change in changes {
                store.upsert(change.original)
            }
            bump()
            return false
        }
        bump()
        return true
    }

    // MARK: page_version_conflict (VERTRAEGE §11.2)

    /// Der Core hat ein `page.update` abgelehnt, weil die Version nicht stimmt. Ablauf:
    /// 1. Läuft für die Seite schon eine Auflösung, passiert nichts.
    /// 2. `GET /pages/{id}`. Bei 404 werden die wartenden `page.update` der Seite verworfen.
    /// 3. Alle wartenden `page.update` der Seite entfernen (`discard`, keine Fehlerablage), `version` = Version des Core.
    /// 4. Weichen die lokalen Felder vom Core ab, geht **ein** neues `page.update` mit den lokalen Feldern und der
    ///    Version des Core in die Warteschlange.
    /// Scheitert ein Schritt, ruht die Seite in der Engine weiter. Der nächste `welcome` versucht es erneut.
    func resolveVersionConflict(pageID: String) async {
        guard !resolvingConflicts.contains(pageID) else { return }
        resolvingConflicts.insert(pageID)
        defer { resolvingConflicts.remove(pageID) }
        guard sync.canReachCore, let access = sync.restAccess() else { return }

        let remote: RemotePageState?
        do {
            remote = try await client.pageState(endpoint: access.endpoint, token: access.token, pageID: pageID)
        } catch {
            sync.reportRESTError(error)
            return
        }
        guard !_Concurrency.Task.isCancelled else { return }
        // Erst nach dem Abruf lesen: Änderungen, die währenddessen eingereiht wurden, gehören zum Ersatz
        let stale = sync.pendingOpIDs(kind: "page.update", pageID: pageID)
        guard sync.discardPending(opIDs: stale) else { return }

        guard let remote, var page = store.page(pageID) else {
            // Der Core kennt die Seite nicht mehr (oder die Bibliothek nicht): nichts zu ersetzen
            sync.resumePage(pageID)
            return
        }
        let differs =
            page.index != remote.index || page.template != remote.template || page.sessionID != remote.sessionID
            || page.backgroundSlideID != remote.backgroundSlideID || page.attachedSlideID != remote.attachedSlideID
        if differs {
            var replacement = page
            replacement.version = remote.version
            guard
                let draft = InkOpBuilder.pageUpdate(
                    page: replacement, nowMS: nowMS(), offsetMS: sync.clockOffsetForDrafts,
                    makeID: { InkID.uuidV7() }),
                sync.enqueue(drafts: [draft])
            else { return }
            page.version = remote.version + 1
        } else {
            page.version = remote.version
        }
        store.upsert(page)
        bump()
        sync.resumePage(pageID)
    }

    // MARK: Intern

    /// `index` der nächsten Seite: höchster bekannter Index + 1, auch von Seiten in der Löschfrist und von Seiten,
    /// die nur am Mac liegen
    private func nextIndex(in notebook: LibraryNotebook) -> Int {
        let visible = store.pages(inNotebook: notebook.id).map(\.index).max() ?? 0
        let inGrace = store.pagesInDeleteGrace().filter { $0.notebookID == notebook.id }.map(\.index).max() ?? 0
        return max(0, notebook.remoteMaxIndex, visible, inGrace) + 1
    }

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
