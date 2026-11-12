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
    /// Wartezeit, bevor eine Änderung am Notizbuch (vom Mac) die Bibliothek neu lädt. Weitere Änderungen in dieser Zeit
    /// verschieben den Abruf.
    static let liveRefreshDelay: Duration = .seconds(1)
    /// Spätestens nach dieser Zeit läuft der Abruf trotzdem, auch wenn ständig Änderungen eintreffen
    static let liveRefreshMaxWait: TimeInterval = 5
    /// Zeile der Schreibfläche, wenn das offene Notizbuch am Mac gelöscht wurde (kein Dialog, Regel R1)
    static let deletedOnMacLine = "Am Mac gelöscht, liegt im Papierkorb"
    /// Zeile, wenn das Modul des offenen Notizbuchs am Mac ganz gelöscht ist (L8 aus #286)
    static let moduleGoneLine =
        "Das Modul wurde am Mac gelöscht. Deine Notizen bleiben auf dem iPad, werden aber nicht mehr übertragen."
    /// Löschfrist: So lange lässt sich eine gelöschte Seite zurückholen. `page.delete` wird erst danach eingereiht.
    static let deleteGrace: Duration = .seconds(5)
    /// So lange zeigt die Leiste „Rückgängig“. Etwas kürzer als die Löschfrist: Die Leiste startet erst mit dem
    /// Zeichnen der Ansicht, ein Tipp in den letzten Millisekunden scheiterte sonst still (L11 aus #225).
    static let undoBarDuration: Duration = .milliseconds(4500)

    /// Die Engine, über die Operationen laufen
    let sync: SyncEngine

    /// Laufende oder pausierte Session laut letztem Abruf, `nil` ohne Verbindung oder ohne Session
    private(set) var running: RunningSession?
    /// Zeitpunkt der letzten Meldung über die laufende Session oder des Verbindungsabrisses, was später kam (UX-57).
    /// Ohne Verbindung bleibt `running` stehen, dann sagt dieser Zeitpunkt, wie alt der Stand ist. `nil` ohne Session.
    private(set) var runningReportedAt: Date?
    /// Letzter gemeldeter Stand des Sync, für `syncOnlineChanged`
    @ObservationIgnored private var syncWasOnline = false
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
    /// Wartender, entprellter Abruf nach einer Änderung am Notizbuch
    @ObservationIgnored private var liveRefreshTask: _Concurrency.Task<Void, Never>?
    @ObservationIgnored private var liveRefreshSince: Date?
    /// Ein erzwungener Abruf kam, während einer lief: Danach läuft einer nach
    @ObservationIgnored private var refreshAgain = false

    /// Stand des Abgleichs aller Seiten nach einer Wiederherstellung am Mac (UX-46), für die Zeile auf dem Startbildschirm
    struct BackgroundReconcile: Equatable, Sendable {
        /// Seiten, die noch abgeglichen werden müssen (zählt herunter)
        var remaining: Int
        /// Der Durchgang folgt auf eine neue `db_epoch`
        var afterRestore: Bool
        /// Markierte Seiten, die sich nicht lesen ließen (#252). Sie zählen nicht zu `remaining`: Der Durchgang lässt
        /// sie aus, das Flag bleibt stehen.
        var unreadable = 0
    }

    /// Seit dem Start der App lief ein Durchgang an (erstes `welcome`). Erst dann zeigt der Startbildschirm die Zeile.
    private var passStarted = false
    /// Ein Durchgang läuft gerade (für Tests)
    @ObservationIgnored private(set) var isBackgroundReconcileRunning = false
    /// Die letzte neue `db_epoch` ist noch nicht vollständig abgeglichen (nur im Arbeitsspeicher)
    private var restorePending = false
    @ObservationIgnored private var passTask: _Concurrency.Task<Void, Never>?
    /// Zählt bei jedem neuen Durchgang und bei jedem Abbruch hoch. Ein Durchgang mit alter Nummer endet am nächsten
    /// Prüfpunkt, ohne etwas zu ändern.
    @ObservationIgnored private var passGeneration = 0
    /// Seiten, deren Modell sich zuletzt nicht lesen ließ (#252, nur im Arbeitsspeicher). Der Durchgang lässt sie aus
    /// und zählt sie nicht als offen, sonst verschwände die Zeile auf dem Startbildschirm nie. Lädt die Seite wieder
    /// lesbar (Öffnen, nächster Start), fällt sie heraus. Änderungen melden sich über `bump()`.
    @ObservationIgnored private var unreadablePageIDs = Set<String>()
    /// Die offene Seite der Schreibfläche. Ihr Modell gehört der Ansicht; der Durchgang gleicht sie mit genau diesem
    /// Modell ab und lädt sie nie ein zweites Mal.
    @ObservationIgnored private weak var openModel: InkPageModel?
    @ObservationIgnored private var openPageID: String?
    /// Zählt bei jedem Öffnen oder Schließen einer Seite hoch (Schutz für kurz geladene Modelle)
    @ObservationIgnored private var openChanges = 0

    /// Folien und Session-Strom (T1-13 Teil 2). `nil` in Tests ohne Folien.
    @ObservationIgnored var slides: SlideSupport?

    /// Standard für den Schreibmodus aus den Einstellungen (`lecture.default_ink_mode`), `nil` = noch nicht geladen
    private(set) var lectureDefaultInkMode: InkMode?
    /// Zählt je Modul bei jeder Änderung der Wahl und bei jedem bestätigten `PATCH` hoch. Ein Abruf der Module, der
    /// währenddessen lief, ist älter als die lokale Wahl und darf sie nicht überschreiben (L6 aus #225).
    @ObservationIgnored private var inkModeEpoch: [String: Int] = [:]
    @ObservationIgnored private var inkModeInFlight = Set<String>()
    @ObservationIgnored private var isFlushingInkModes = false
    /// Die Session kommt vom `SessionFollower` (Strom), nicht mehr aus dem Abruf in `refresh`
    @ObservationIgnored private var followsSessions = false
    @ObservationIgnored private var followToken = 0

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
        sync.onWelcomed = { [weak self] epochChanged in
            self?.startBackgroundReconcile(afterRestore: epochChanged)
        }
        // Modul am Mac gelöscht (L8 aus #286): Die offene Seite steht auf der Platte, bevor ihre wartenden Striche entfallen
        sync.onModuleMissing = { [weak self] _ in
            self?.openModel?.saveNow()
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
            // Mit dem Follower bleibt die Session stehen: Er lädt bei der nächsten Verbindung neu
            if !followsSessions, running != nil {
                running = nil
                runningReportedAt = nil
            }
            return
        }
        guard !isRefreshing else {
            // Eine Änderung vom Mac darf nicht verloren gehen, weil gerade ein älterer Abruf läuft
            if force { refreshAgain = true }
            return
        }
        if !force, let last = lastRefreshAt, now().timeIntervalSince(last) < InkLibraryService.refreshInterval {
            return
        }
        isRefreshing = true
        lastRefreshAt = now()
        defer {
            isRefreshing = false
            if refreshAgain {
                refreshAgain = false
                _Concurrency.Task { await self.refresh(force: true) }
            }
        }

        do {
            let epochsBefore = inkModeEpoch
            let briefs = try await client.modules(endpoint: access.endpoint, token: access.token)
            guard !_Concurrency.Task.isCancelled else { return }
            // Module, deren Wahl sich während des Abrufs geändert hat oder gerade gesendet wird, behalten die lokale Wahl
            var keep = inkModeInFlight
            for (moduleID, epoch) in inkModeEpoch where epochsBefore[moduleID, default: 0] != epoch {
                keep.insert(moduleID)
            }
            let goneBefore = Set(store.allNotebooks().filter(\.isModuleGone).map(\.id))
            store.mergeModules(briefs, at: now(), keepLocalInkMode: keep)
            requeueReturnedNotebooks(goneBefore)
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
        if !followsSessions {
            await refreshRunning(access)
        }
        bump()
        await flushInkModes()
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
        // Der Mac kann eine gelöschte Folienseite wiederhergestellt haben (E10 aus #286)
        if mergeDuplicateSlidePages(notebookID: notebookID) > 0 { bump() }

        // Neue `db_epoch`: Eine Seite, die der Core nicht mehr kennt und die nie wieder geöffnet wird, käme sonst
        // nie zurück. `page.create` ist idempotent, die Striche folgen im Abgleich (Hintergrund-Durchgang oder Öffnen der Seite).
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

    // MARK: Notizbuch-Änderungen vom Mac (#245, VERTRAEGE §11.3, §11.6)

    /// Reagiert auf das Ereignis `notebook.changed` (umbenannt, gelöscht, wiederhergestellt; geht an alle
    /// Verbindungen, ein Abo ist nicht nötig, VERTRAEGE §11.3 und §11.6). Ohne Aufruf (Tests) bleibt es beim Abgleich per REST.
    func attachNotebookChanges() {
        sync.onNotebookChanged = { [weak self] in
            self?.scheduleLiveRefresh()
        }
    }

    /// Lädt die Bibliothek nach einer Änderung am Notizbuch neu: nach `liveRefreshDelay` Ruhe, spätestens nach
    /// `liveRefreshMaxWait`. Viele Operationen kurz hintereinander ergeben einen Abruf.
    func scheduleLiveRefresh() {
        let since = liveRefreshSince ?? now()
        liveRefreshSince = since
        let waited = now().timeIntervalSince(since)
        let remaining = max(0, InkLibraryService.liveRefreshMaxWait - waited)
        let wait = min(InkLibraryService.liveRefreshDelay, .milliseconds(Int((remaining * 1000).rounded(.up))))
        liveRefreshTask?.cancel()
        let sleeper = graceSleep
        liveRefreshTask = _Concurrency.Task { [weak self] in
            do {
                try await sleeper(wait)
            } catch {
                return
            }
            // Ein neueres Ereignis kann diesen Task abgebrochen haben, nachdem der Schlaf schon zu Ende war. Dann gehört
            // der Abruf dem neuen Task: nicht doppelt laden und dessen Verweis nicht überschreiben.
            guard !_Concurrency.Task.isCancelled, let self else { return }
            // Ab hier gehört der Abruf nicht mehr zum wartenden Task: Eine neue Änderung bricht ihn nicht ab
            self.liveRefreshTask = nil
            self.liveRefreshSince = nil
            await self.refresh(force: true)
        }
    }

    /// Das Notizbuch ist laut letztem Abruf am Mac gelöscht (liegt im Papierkorb). Die Schreibfläche zeigt dann eine
    /// ruhige Zeile; Schreiben bleibt möglich, der Core übernimmt `deleted_at` für neue Striche (VERTRAEGE §11.2).
    func isDeletedOnMac(notebookID: String) -> Bool {
        track()
        guard let notebook = store.notebook(notebookID) else { return false }
        return notebook.knownOnServer && notebook.hidden
    }

    /// Das Modul ist wieder da (am Mac wiederhergestellt, L8 aus #286): Die freien Notizbücher und ihre Seiten werden
    /// gleich wieder angelegt, nicht erst beim Öffnen jeder Seite. Die Striche holt danach der Hintergrund-Abgleich.
    /// Scheitert das Einreihen, bleibt `createQueued` aus und das Öffnen der Seite holt es nach.
    private func requeueReturnedNotebooks(_ goneBefore: Set<String>) {
        var queued = false
        for id in goneBefore.sorted() {
            guard let notebook = store.notebook(id), !notebook.isModuleGone, notebook.kind == .frei else { continue }
            for page in store.pages(inNotebook: id) where !page.createQueued {
                if ensureCreateQueued(page, notebook: notebook) != nil { queued = true }
            }
        }
        if queued { startBackgroundReconcile(afterRestore: false) }
    }

    /// Der Core kennt das Modul des Notizbuchs nicht mehr (`module_not_found`, L8 aus #286). Die Schreibfläche zeigt
    /// dann eine ruhige Zeile. Schreiben bleibt möglich, gesendet wird nichts; die Striche bleiben auf dem iPad.
    func isModuleGoneOnMac(notebookID: String) -> Bool {
        track()
        return store.notebook(notebookID)?.isModuleGone ?? false
    }

    // MARK: Anlegen

    /// Gibt es im Modul schon ein Notizbuch mit diesem Titel? Groß- und Kleinschreibung und Leerzeichen am Rand zählen
    /// nicht (UX-56). Ausgeblendete Notizbücher zählen nicht mit, der Nutzer sieht sie nicht.
    func hasNotebook(inModule moduleID: String, titled title: String) -> Bool {
        let wanted = InkLibraryService.normalizedTitle(title)
        return notebooks(inModule: moduleID).contains { InkLibraryService.normalizedTitle($0.title) == wanted }
    }

    nonisolated static func normalizedTitle(_ title: String) -> String {
        title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Freies Notizbuch anlegen: erst lokal speichern, dann `notebook.create` einreihen. Geht auch offline.
    /// - Returns: `nil` bei leerem oder schon vergebenem Titel, unbekanntem Modul oder wenn das Schreiben scheitert
    func createNotebook(moduleID: String, title: String) -> LibraryNotebook? {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        // Ein leerer Titel ergäbe `message_invalid` und die Fehlerablage
        guard !trimmed.isEmpty, store.modules.contains(where: { $0.id == moduleID }) else { return nil }
        // Gleicher Titel im Modul (UX-56): Die Ansicht sperrt „Anlegen“ schon, hier die Absicherung
        guard !hasNotebook(inModule: moduleID, titled: trimmed) else { return nil }
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
        let legacyID = InkPageModel.testPageID
        if store.page(legacyID) != nil || store.legacyAdoption.map({ store.page($0.pageID) != nil }) == true {
            store.markLegacyTestPageHandled()
            return
        }
        let moduleID = store.lastNotebookID.flatMap { store.notebook($0)?.moduleID } ?? modules.first?.id
        guard let moduleID, store.modules.contains(where: { $0.id == moduleID }) else { return }

        let legacyModel = InkPageModel(pageID: legacyID, store: pageStore, saveDelay: .seconds(1))
        // Unlesbar (#252): nicht als „leer“ abhaken. Der nächste Start versucht es noch einmal.
        guard !legacyModel.isUnreadable else { return }
        guard !legacyModel.neutralStrokes().isEmpty else {
            store.markLegacyTestPageHandled()
            return
        }

        // Die Testseite hat eine feste ID, die alle iPads teilen. Das Notizbuch bekommt deshalb eigene IDs (L7 aus
        // #286). Sie stehen vor dem ersten Schreiben in der Bibliothek: Brach ein früherer Versuch ab, nimmt der
        // nächste dieselben, sonst entstünde ein zweites, leeres „Alte Schreibfläche“. Ein Notizbuch aus der Zeit
        // vor der Markierung (`lastPageID` = feste ID) wird weiterverwendet.
        let marker: LegacyAdoptionMarker
        if let existing = store.legacyAdoption {
            marker = existing
        } else {
            let old = store.allNotebooks().first { $0.kind == .frei && !$0.knownOnServer && $0.lastPageID == legacyID }
            marker = LegacyAdoptionMarker(notebookID: old?.id ?? InkID.uuidV7(), pageID: InkID.uuidV7())
            store.beginLegacyAdoption(marker)
        }
        let pageID = marker.pageID

        // Die Dateien unter der festen ID bleiben unberührt (nichts geht verloren), die Seite bekommt eine Kopie
        do {
            try pageStore.save(pageStore.load(pageID: legacyID), pageID: pageID)
        } catch {
            return
        }
        let model = InkPageModel(pageID: pageID, store: pageStore, saveDelay: .seconds(1))
        guard !model.isUnreadable else { return }
        let strokes = model.neutralStrokes()

        var notebook =
            store.notebook(marker.notebookID)
            ?? LibraryNotebook(
                id: marker.notebookID,
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
        notebook.lastPageID = pageID
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
                deleteQueued: false,
                sessionStartMS: session?.startMS
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

    // MARK: Schreibziel der laufenden Vorlesung (UX-44)

    /// Die laufende Session, falls sie zu diesem Notizbuch gehört: Der Core hat genau dieses Notizbuch genannt
    /// (`GET /sessions/{id}/notebook`). Solange das Notizbuch der Session unbekannt ist (vorläufige Session aus dem
    /// Strom, offline), gibt es kein Ziel, sonst bekäme „Übung“ oder ein freies Notizbuch eine Seite der Vorlesung.
    /// Freie Notizbücher sind nie betroffen. Ohne Ziel bleibt alles wie bei `openTarget`.
    private func lectureSession(for notebook: LibraryNotebook) -> RunningSession? {
        guard notebook.kind != .frei, let session = matchingSession(moduleID: notebook.moduleID),
            session.notebookID == notebook.id
        else { return nil }
        return session
    }

    /// Zeitpunkt (ms, Uhr des iPad) aus einer UUIDv7, `nil` bei einer anderen Version
    private static func createdMS(uuidV7 id: String) -> Int? {
        let hex = Array(id.replacingOccurrences(of: "-", with: ""))
        guard hex.count == 32, hex[12] == "7", let value = Int(String(hex[0..<12]), radix: 16) else { return nil }
        return value
    }

    /// Wurde die Seite erst nach Beginn der Session angelegt (dann offline, darum ohne `sessionID`)? Die Zeit steckt
    /// in der UUIDv7 der Seite und wird mit dem gemessenen Versatz auf die Uhr des Mac umgerechnet. Unbekannt: nein.
    private func createdDuring(_ session: RunningSession, pageID: String) -> Bool {
        guard let startMS = session.startMS, let created = Self.createdMS(uuidV7: pageID) else { return false }
        return created + (sync.clockOffsetForDrafts ?? 0) >= startMS
    }

    /// Die Seite, die `openTarget` öffnen würde (ohne etwas anzulegen)
    private func lastPage(of notebook: LibraryNotebook) -> LibraryPage? {
        let pages = store.pages(inNotebook: notebook.id)
        if let lastID = notebook.lastPageID, let last = pages.first(where: { $0.id == lastID }) { return last }
        return pages.max(by: { ($0.index, $0.id) < ($1.index, $1.id) })
    }

    /// Hat die Seite lokal Striche? Ohne Seitenablage ist das unbekannt und gilt als „ja“.
    private func pageHasStrokes(_ pageID: String) -> Bool {
        guard let pageStore else { return true }
        let snapshot = pageStore.load(pageID: pageID)
        // Unlesbar (#252): unbekannt, also „ja“. Sonst würde die Seite als leer wiederverwendet.
        return snapshot.unreadable || snapshot.ink != nil || snapshot.highlight != nil
    }

    /// Braucht die laufende Vorlesung dieses Notizbuchs eine neue Seite? Ja, wenn die letzte Seite eine andere
    /// `sessionID` trägt als die laufende Session. Ausnahme: Eine Seite ohne Session, die erst nach Beginn der Session
    /// angelegt wurde (offline in dieser Vorlesung), wird weiterverwendet. Jede andere Seite bekommt eine neue Seite,
    /// auch eine leere: Eine leere Seite mit fremder Session ordnete der Rückblick der falschen Vorlesung zu, und eine
    /// leere Seite ohne Session von vor der Vorlesung gäbe ihren Strichen keine Sitzungszeit (#250). `page.session_id`
    /// setzt das iPad nur beim Anlegen (§7.4).
    func needsLecturePage(notebookID: String) -> Bool {
        guard let notebook = store.notebook(notebookID), let session = lectureSession(for: notebook),
            let last = lastPage(of: notebook)
        else { return false }
        if last.sessionID == session.id { return false }
        if last.sessionID == nil, createdDuring(session, pageID: last.id) { return false }
        return true
    }

    /// Schreibziel für die laufende Vorlesung des Moduls. Wie `openTarget`, hängt aber vorher eine Seite an, wenn die
    /// letzte Seite zu einer anderen Vorlesung gehört (`needsLecturePage`). Vorlage und Format kommen von der letzten
    /// Seite wie beim Weiterblättern (nach einer Folienseite: blanko in A4, ohne Folie, §7.4), die `sessionID` ist die
    /// laufende Session, `attached_slide_id` die bekannte aktuelle Folie. Ohne laufende Session ist es genau
    /// `openTarget`.
    func openLectureTarget(notebookID: String) -> InkBinding? {
        guard needsLecturePage(notebookID: notebookID), let notebook = store.notebook(notebookID),
            let last = lastPage(of: notebook),
            let page = addPage(
                notebookID: notebookID, template: InkPaging.template(after: last), size: InkPaging.size(after: last),
                backgroundSlideID: nil, attachedSlideID: slides?.knownCurrentSlide()?.id)
        else { return openTarget(notebookID: notebookID) }
        return openPage(pageID: page.id)
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
            deleteQueued: false,
            sessionStartMS: matchingSession(moduleID: notebook.moduleID)?.startMS
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

    /// Löscht eine Seite mit Frist, aber nur, wenn sie keinen Strich hat (UX-55: leere Ersatzseite nach „Rückgängig“).
    /// Ohne Seitenablage oder bei unlesbarer Seite gilt sie als beschrieben und bleibt.
    /// - Returns: `true`, wenn die Seite in die Löschfrist ging
    @discardableResult
    func discardEmptyPage(pageID: String) -> Bool {
        guard let page = store.page(pageID), page.deletedAtMS == nil, !pageHasStrokes(pageID) else { return false }
        deletePage(pageID: pageID)
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
                // Geänderte Felder festhalten: Bei einem Konflikt gewinnen nur diese (L9)
                // Wartet kein `page.update` der Seite mehr, sind frühere Änderungen bestätigt: Sie zählen nicht mehr,
                // sonst überschriebe ein späterer Konflikt eine neuere Änderung des Mac an diesen Feldern.
                let changed = LibraryPage.changedFields(from: change.original, to: change.updated).map(\.rawValue)
                let waiting = !sync.pendingOpIDs(kind: "page.update", pageID: change.original.id).isEmpty
                let earlier = waiting ? (change.original.dirtyFields ?? LibraryPage.Field.allCases.map(\.rawValue)) : []
                page.dirtyFields = Array(Set(earlier).union(changed)).sorted()
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
    /// 3. Weichen die lokalen Felder vom Core ab, geht **ein** neues `page.update` mit den lokalen Feldern und der
    ///    Version des Core in die Warteschlange.
    /// 4. Danach alle älteren wartenden `page.update` der Seite entfernen (`discard`, keine Fehlerablage),
    ///    `version` = Version des Core (+ 1 mit Ersatz).
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

        guard let remote, var page = store.page(pageID) else {
            // Der Core kennt die Seite nicht mehr (oder die Bibliothek nicht): nichts zu ersetzen
            guard sync.discardPending(opIDs: stale) else { return }
            sync.resumePage(pageID)
            return
        }
        // Feldweise (VERTRAEGE §11.2: „eigene geänderte Felder auflegen“): Was lokal nicht geändert wurde, übernimmt
        // den Stand des Core. Ohne Merkliste (Altbestand) gelten alle lokalen Felder.
        let dirty = Set(page.dirtyFields ?? LibraryPage.Field.allCases.map(\.rawValue))
        var merged = page
        if !dirty.contains(LibraryPage.Field.index.rawValue) { merged.index = remote.index }
        if !dirty.contains(LibraryPage.Field.template.rawValue) { merged.template = remote.template }
        if !dirty.contains(LibraryPage.Field.sessionID.rawValue) {
            if merged.sessionID != remote.sessionID { merged.sessionStartMS = nil }
            merged.sessionID = remote.sessionID
        }
        if !dirty.contains(LibraryPage.Field.backgroundSlideID.rawValue) {
            merged.backgroundSlideID = remote.backgroundSlideID
        }
        if !dirty.contains(LibraryPage.Field.attachedSlideID.rawValue) {
            merged.attachedSlideID = remote.attachedSlideID
        }
        let differs =
            merged.index != remote.index || merged.template != remote.template || merged.sessionID != remote.sessionID
            || merged.backgroundSlideID != remote.backgroundSlideID
            || merged.attachedSlideID != remote.attachedSlideID
        page = merged
        if differs {
            var replacement = merged
            replacement.version = remote.version
            // Erst den Ersatz einreihen, dann die alten verwerfen: Bricht die App dazwischen ab, wartet weiter ein
            // `page.update` mit den lokalen Feldern, und der nächste Konflikt löst es auf. Andersherum stünde keins
            // mehr in der Warteschlange, und der nächste Abruf der Seiten setzte Reihenfolge und Vorlage auf den
            // Stand des Core zurück. Der Ersatz ruht, bis `resumePage` die Seite freigibt.
            guard
                let draft = InkOpBuilder.pageUpdate(
                    page: replacement, nowMS: nowMS(), offsetMS: sync.clockOffsetForDrafts,
                    makeID: { InkID.uuidV7() }),
                sync.enqueue(drafts: [draft])
            else { return }
            page.version = remote.version + 1
        } else {
            page.version = remote.version
            // Nichts Eigenes weicht mehr ab
            page.dirtyFields = nil
        }
        // Scheitert das Verwerfen, bleibt die Seite geparkt. Der nächste Versuch verwirft auch den Ersatz und reiht
        // einen neuen ein.
        guard sync.discardPending(opIDs: stale) else { return }
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

    // MARK: Abgleich im Hintergrund (UX-46)

    /// Die Schreibfläche meldet ihre offene Seite (`nil` beim Verlassen). Der Durchgang gleicht sie mit diesem Modell
    /// ab, statt die Seite ein zweites Mal zu laden.
    func setOpenPage(_ model: InkPageModel?) {
        if openModel === model, openPageID == model?.pageID { return }
        openModel = model
        openPageID = model?.pageID
        openChanges += 1
        if let model { noteReadability(of: model) }
    }

    /// Hält fest, ob sich die Seite des Modells lesen ließ (#252)
    private func noteReadability(of model: InkPageModel) {
        let changed =
            model.isUnreadable
            ? unreadablePageIDs.insert(model.pageID).inserted
            : unreadablePageIDs.remove(model.pageID) != nil
        if changed { bump() }
    }

    /// Zeile auf dem Startbildschirm: steht, solange nach einem `welcome` markierte Seiten übrig sind, auch wenn der
    /// Durchgang pausiert (Verbindung weg). Sie zählt herunter, auch wenn die Schreibfläche eine Seite abgleicht, und
    /// verschwindet erst, wenn alles abgeglichen ist. `nil` = keine Zeile.
    var backgroundReconcile: BackgroundReconcile? {
        // Abgleiche der Engine löschen Flags in der Ablage, ohne dass dieser Dienst davon erfährt
        _ = sync.reconciledPages
        guard passStarted else { return nil }
        let remaining = pagesNeedingReconcile
        let unreadable = unreadablePagesNeedingReconcile
        guard remaining > 0 || unreadable > 0 else { return nil }
        return BackgroundReconcile(remaining: remaining, afterRestore: restorePending, unreadable: unreadable)
    }

    /// Markierte Seiten (`needsReconcile`), die der Durchgang abgleichen muss: sichtbar und beim Core angelegt bzw.
    /// eingereiht. Eine Seite, deren `page.create` nie eingereiht wurde, hat noch nie Striche gehabt. Unlesbare Seiten
    /// (#252) zählen nicht: Sie werden nie abgeglichen (`unreadablePagesNeedingReconcile`).
    var pagesNeedingReconcile: Int {
        flaggedPages().filter { !unreadablePageIDs.contains($0.id) }.count
    }

    /// Markierte Seiten, die sich nicht lesen ließen (#252). Das Flag bleibt, die Datei bleibt unberührt.
    var unreadablePagesNeedingReconcile: Int {
        flaggedPages().filter { unreadablePageIDs.contains($0.id) }.count
    }

    private func flaggedPages() -> [LibraryPage] {
        track()
        // Notizbücher eines am Mac gelöschten Moduls warten, bis es zurückkommt (L8 aus #286)
        return store.allNotebooks().filter { !$0.isModuleGone }.flatMap { notebook in
            store.pages(inNotebook: notebook.id).filter { $0.needsReconcile && $0.createQueued }
        }
    }

    /// Nach jedem `welcome`: Läuft noch ein Durchgang, endet er sauber, bevor der neue beginnt (nie zwei gleichzeitig).
    /// Ohne markierte Seiten passiert nichts weiter.
    func startBackgroundReconcile(afterRestore: Bool) {
        if afterRestore { restorePending = true }
        if !passStarted { passStarted = true }
        passGeneration += 1
        let generation = passGeneration
        let previous = passTask
        previous?.cancel()
        passTask = _Concurrency.Task { [weak self] in
            await previous?.value
            await self?.runBackgroundReconcile(generation: generation)
        }
    }

    /// Bricht einen laufenden Durchgang ab (Verbindung weg). Die Flags bleiben, der nächste `welcome` macht weiter.
    /// Die Zeile auf dem Startbildschirm bleibt mit der Restzahl stehen (`backgroundReconcile`): Sonst hielte man den
    /// pausierten Abgleich für fertig.
    func cancelBackgroundReconcile() {
        passGeneration += 1
        passTask?.cancel()
        isBackgroundReconcileRunning = false
    }

    private func isCurrentPass(_ generation: Int) -> Bool {
        generation == passGeneration && !_Concurrency.Task.isCancelled && sync.canReachCore
    }

    private func runBackgroundReconcile(generation: Int) async {
        guard isCurrentPass(generation), pageStore != nil else { return }
        isBackgroundReconcileRunning = true
        defer {
            // Ein veralteter Durchgang rührt den Stand nicht an: Der neue Durchgang (oder der Abbruch) besitzt ihn
            if generation == passGeneration { isBackgroundReconcileRunning = false }
        }
        guard pagesNeedingReconcile > 0 else {
            restorePending = false
            return
        }
        var unreachable = false
        // Das Notizbuch der offenen Seite zuerst, dann der Rest in fester Reihenfolge
        let openNotebookID = openPageID.flatMap { store.page($0)?.notebookID }
        let notebooks = store.allNotebooks().sorted { first, second in
            if (first.id == openNotebookID) != (second.id == openNotebookID) { return first.id == openNotebookID }
            return first.id < second.id
        }
        outer: for notebook in notebooks {
            guard isCurrentPass(generation) else { break }
            guard !(store.notebook(notebook.id)?.isModuleGone ?? true),
                store.pages(inNotebook: notebook.id).contains(where: { $0.needsReconcile })
            else { continue }
            await refreshPages(notebookID: notebook.id)
            // Die offene Seite zuerst
            let pages = store.pages(inNotebook: notebook.id).sorted { first, second in
                if (first.id == openPageID) != (second.id == openPageID) { return first.id == openPageID }
                return (first.index, first.id) < (second.index, second.id)
            }
            for page in pages {
                guard isCurrentPass(generation) else { break outer }
                guard let current = store.page(page.id), current.needsReconcile, current.createQueued,
                    current.deletedAtMS == nil, !unreadablePageIDs.contains(current.id)
                else { continue }
                var result = await reconcileForPass(pageID: current.id, generation: generation)
                // Verworfen, weil die Seite währenddessen geöffnet, gewechselt oder geschlossen wurde: einmal mit dem
                // dann gültigen Modell nachholen. Sonst bliebe sie markiert, wenn der Abgleich der Ansicht genau in
                // diesem Moment übersprungen wurde.
                if result == .skipped, isCurrentPass(generation), store.page(current.id)?.needsReconcile == true,
                    !unreadablePageIDs.contains(current.id)
                {
                    result = await reconcileForPass(pageID: current.id, generation: generation)
                }
                if result == .unreachable {
                    unreachable = true
                    break outer
                }
            }
        }
        guard generation == passGeneration else { return }
        // Bleiben Seiten übrig (Verbindung weg, Fehler), bleibt die Zeile mit der Restzahl stehen
        if !unreachable, pagesNeedingReconcile == 0 { restorePending = false }
        bump()
    }

    /// Gleicht eine Seite ab. Es ist derselbe Abgleich wie in der Schreibfläche (`SyncEngine.reconcile`); hier wird nur
    /// das Modell beschafft. Die offene Seite nimmt ihr Modell der Ansicht. Jede andere Seite lädt ein Modell kurz von
    /// der Platte (wie `adoptLegacyTestPage`). Die Seite wird dabei nur gelesen: Wird sie währenddessen geöffnet, wirft
    /// der Abgleich seinen Plan weg, und das kurz geladene Modell schreibt nichts auf die Platte.
    private func reconcileForPass(pageID: String, generation: Int) async -> SyncEngine.ReconcileResult {
        guard sync.canReachCore, !sync.isReconciling(pageID: pageID), let binding = target(forPage: pageID) else {
            return .skipped
        }
        if pageID == openPageID, let live = openModel, live.pageID == pageID {
            noteReadability(of: live)
            guard !live.isUnreadable else { return .skipped }
            // Die Zeit der Striche folgt der Session der Seite, nicht dem Stand, den die Ansicht zuletzt übernommen hat
            live.sessionStartedAt = binding.sessionStartMS.map { Date(timeIntervalSince1970: Double($0) / 1000) }
            return await sync.reconcile(page: live, binding: binding) { [weak self] in
                // Die Ansicht hat inzwischen ein anderes Modell (Seite verlassen und neu geöffnet): `live` kennt dessen
                // neue Striche nicht
                guard let self else { return false }
                return self.passGeneration == generation && self.openModel === live
            }
        }
        guard let pageStore, let libraryPage = store.page(pageID) else { return .skipped }
        let model = InkPageModel(
            pageID: pageID,
            pageSize: CGSize(width: libraryPage.widthPt, height: libraryPage.heightPt),
            store: pageStore,
            // Lange Frist: Gespeichert wird nur ausdrücklich unten
            saveDelay: .seconds(3600),
            outboxMark: sync.outboxMark(forPage: pageID)
        )
        // Unlesbar (#252): aus dem Durchgang nehmen, damit die Zeile nicht ewig eine offene Seite zählt
        noteReadability(of: model)
        guard !model.isUnreadable else { return .skipped }
        model.outboxNumberProvider = { [weak engine = sync] in engine?.outboxLastNumber ?? 0 }
        model.sessionStartedAt = binding.sessionStartMS.map { Date(timeIntervalSince1970: Double($0) / 1000) }
        let changesBefore = openChanges
        let result = await sync.reconcile(page: model, binding: binding) { [weak self] in
            // Geöffnet oder neuer Durchgang: Das Modell ist veraltet, nichts planen
            guard let self else { return false }
            return self.passGeneration == generation && self.openChanges == changesBefore
                && self.openPageID != pageID
        }
        // Zuordnungen, die beim Laden neu entstanden (IDs), bleiben nur erhalten, wenn die Seite unberührt blieb.
        // Eine unlesbare Seite (#252) wird nie geschrieben (das Modell sperrt `saveNow` ohnehin).
        if result == .done, !model.isUnreadable, openChanges == changesBefore, openPageID != pageID {
            model.saveNow()
        }
        return result
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
        _ = sync.missingModuleCount
    }

    private func matchingSession(moduleID: String) -> RunningSession? {
        guard let running, running.moduleID == moduleID else { return nil }
        return running
    }

    /// Startzeit, die zu den Strichen dieser Seite gehört (#250). Maßgeblich ist die Session der Seite
    /// (`page.sessionID`), nie einfach die gerade laufende des Moduls:
    /// - Trägt die Seite eine Session, gilt deren Start: bei der laufenden Session der frische Wert, sonst der
    ///   gemerkte (`sessionStartMS`). Ist er unbekannt, fehlt `t_start_ms`.
    /// - Trägt die Seite keine Session, gehört sie zur laufenden Session des Moduls nur dann, wenn sie erst nach deren
    ///   Beginn angelegt wurde (offline in dieser Vorlesung, wie `needsLecturePage`). Sonst ohne Sitzungszeit.
    private func strokeSessionStart(page: LibraryPage, running: RunningSession?) -> Int? {
        if let pageSession = page.sessionID {
            if let running, running.id == pageSession { return running.startMS ?? page.sessionStartMS }
            return page.sessionStartMS
        }
        if let running, createdDuring(running, pageID: page.id) { return running.startMS }
        return nil
    }

    /// Merkt den Start der laufenden Session an den Seiten, die zu ihr gehören und ihn noch nicht kennen. So behalten
    /// ihre Striche die Sitzungszeit auch nach dem Ende der Vorlesung (#250).
    private func rememberStart(of session: RunningSession) {
        guard let startMS = session.startMS else { return }
        for notebook in store.notebooks(inModule: session.moduleID) {
            for page in store.pages(inNotebook: notebook.id)
            where page.sessionID == session.id && page.sessionStartMS != startMS {
                var known = page
                known.sessionStartMS = startMS
                store.upsert(known)
            }
        }
    }

    private func makeBinding(notebook: LibraryNotebook, page: LibraryPage) -> InkBinding {
        // `sessionID` bleibt die laufende Session des Moduls (`presence.session_id`, §11.6), die Zeit der Striche folgt
        // der Session der Seite (#250)
        let running = matchingSession(moduleID: notebook.moduleID)
        return InkBinding(
            notebookID: notebook.id,
            pageID: page.id,
            moduleID: notebook.moduleID,
            pageCreated: page.createQueued,
            needsReconcile: page.needsReconcile,
            sessionID: running?.id,
            sessionStartMS: strokeSessionStart(page: page, running: running),
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
            runningReportedAt = nil
            return
        }
        runningReportedAt = now()
        let notebook = await resolveNotebook(sessionID: session.id, moduleID: session.moduleID, access: access)
        guard !_Concurrency.Task.isCancelled else { return }
        register(notebook)
        running = RunningSession(
            id: session.id,
            moduleID: session.moduleID,
            startMS: session.startedAt.map { InkStrokeCodec.milliseconds($0) },
            slideDeckID: session.slideDeckID,
            notebookID: notebook?.id
        )
        if let running { rememberStart(of: running) }
    }

    /// Das Notizbuch der Session. Der Core entscheidet (#199): „Übung“ bei Übung und Tutorium, sonst „Vorlesung“.
    private func resolveNotebook(
        sessionID: String, moduleID: String, access: (endpoint: CoreEndpoint, token: String)
    ) async -> Notebook? {
        var notebook: Notebook?
        do {
            notebook = try await client.sessionNotebook(
                endpoint: access.endpoint, token: access.token, sessionID: sessionID)
            if notebook == nil {
                // Älterer Core ohne den Endpunkt (404): die alte Regel, das erste „Vorlesung“ des Moduls
                let all = try await client.notebooks(
                    endpoint: access.endpoint, token: access.token, moduleID: moduleID)
                notebook = all.first { $0.kind == .vorlesung && $0.deletedAt == nil }
            }
        } catch {
            sync.reportRESTError(error)
        }
        return notebook
    }

    /// Ein Notizbuch, das der Abruf der Module noch nicht kannte
    private func register(_ notebook: Notebook?) {
        guard let notebook, store.notebook(notebook.id) == nil else { return }
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

    // MARK: Session aus dem Strom (T1-13 Teil 2)

    /// Der Sync wird online oder verlässt `online`. Bis zum Abriss war die laufende Session bestätigt: Der Stand der
    /// Karte „Lief zuletzt“ ist dann dieser Moment, nicht die letzte Änderung der Session (UX-57).
    func syncOnlineChanged(_ isOnline: Bool) {
        defer { syncWasOnline = isOnline }
        // Verbindung weg: Der Durchgang endet, die Flags bleiben für den nächsten `welcome`
        if !isOnline, syncWasOnline { cancelBackgroundReconcile() }
        guard syncWasOnline, !isOnline, running != nil else { return }
        runningReportedAt = now()
    }

    /// Ab jetzt kommt die laufende Session vom `SessionFollower`, `refresh` fragt sie nicht mehr ab
    func attachFollower() {
        followsSessions = true
    }

    /// Der Follower meldet die laufende Session (oder keine). Das Notizbuch der Session holt der Dienst per REST,
    /// solange es nicht bekannt ist. Eine veraltete Antwort (die Session hat inzwischen gewechselt) wird verworfen.
    func follow(session brief: SessionBrief?) async {
        followToken += 1
        let token = followToken
        guard let brief else {
            if running != nil || runningReportedAt != nil {
                running = nil
                runningReportedAt = nil
                bump()
            }
            return
        }
        runningReportedAt = now()
        let known = running?.id == brief.id ? running?.notebookID : nil
        let provisional = RunningSession(
            id: brief.id, moduleID: brief.moduleID, startMS: brief.startedAtMS, slideDeckID: brief.slideDeckID,
            notebookID: known)
        if running != provisional {
            running = provisional
            rememberStart(of: provisional)
            bump()
        }
        guard known == nil, sync.canReachCore, let access = sync.restAccess() else { return }
        let notebook = await resolveNotebook(sessionID: brief.id, moduleID: brief.moduleID, access: access)
        guard token == followToken, !_Concurrency.Task.isCancelled, let notebook else { return }
        register(notebook)
        running = RunningSession(
            id: brief.id, moduleID: brief.moduleID, startMS: brief.startedAtMS, slideDeckID: brief.slideDeckID,
            notebookID: notebook.id)
        if let running { rememberStart(of: running) }
        bump()
    }

    // MARK: Schreibmodus (F-INK-03, T1-13 Teil 2)

    /// Modus des Moduls: eigene Wahl, sonst Standard aus den Einstellungen, sonst „freie Seite“
    func inkMode(forModule moduleID: String) -> InkMode {
        track()
        let module = store.modules.first { $0.id == moduleID }
        return InkModeResolver.resolve(module: module?.inkMode, lectureDefault: lectureDefaultInkMode)
    }

    /// Standard aus den Einstellungen holen. Ohne Verbindung bleibt der letzte bekannte Wert.
    func refreshLectureDefaults() async {
        guard sync.canReachCore, let access = sync.restAccess() else { return }
        do {
            let mode = try await client.lectureDefaults(endpoint: access.endpoint, token: access.token)
            guard !_Concurrency.Task.isCancelled else { return }
            if lectureDefaultInkMode != mode {
                lectureDefaultInkMode = mode
                bump()
            }
        } catch {
            sync.reportRESTError(error)
        }
    }

    /// Ein Tipp: Der Modus gilt pro Modul. Die Wahl steht sofort in der Bibliothek (`dirty`) und geht bei Verbindung per
    /// `PATCH` an den Core, auch nach einem Neustart.
    func setInkMode(_ mode: InkMode, moduleID: String) {
        guard let module = store.modules.first(where: { $0.id == moduleID }) else { return }
        // Dieselbe Wahl steht schon da (gesendet oder wartend): nichts zu tun
        if module.inkMode == mode { return }
        inkModeEpoch[moduleID, default: 0] += 1
        store.setModuleInkMode(mode, moduleID: moduleID, dirty: true)
        bump()
        _Concurrency.Task { await self.flushInkModes() }
    }

    /// Sendet jede lokal geänderte Wahl per `PATCH /modules/{id}`. Ändert sich die Wahl währenddessen, bleibt das Modul
    /// `dirty` und geht danach erneut raus. Scheitert ein Modul, kommen die anderen trotzdem dran.
    func flushInkModes() async {
        guard !isFlushingInkModes, sync.canReachCore, let access = sync.restAccess() else { return }
        isFlushingInkModes = true
        defer { isFlushingInkModes = false }
        var failed = Set<String>()
        for _ in 0..<50 {
            guard
                let module = store.modules.first(where: {
                    $0.inkModeDirty && $0.inkMode != nil && !failed.contains($0.id)
                }), let sent = module.inkMode
            else { break }
            inkModeInFlight.insert(module.id)
            do {
                try await client.patchModuleInkMode(
                    endpoint: access.endpoint, token: access.token, moduleID: module.id, mode: sent)
            } catch {
                inkModeInFlight.remove(module.id)
                sync.reportRESTError(error)
                failed.insert(module.id)
                if (error as? ConnectionError) == .tokenInvalid { return }
                continue
            }
            inkModeInFlight.remove(module.id)
            inkModeEpoch[module.id, default: 0] += 1
            // Hat sich die Wahl währenddessen geändert, bleibt sie `dirty` und die Schleife sendet sie erneut
            if let current = store.modules.first(where: { $0.id == module.id }), current.inkMode == sent {
                store.setModuleInkMode(sent, moduleID: module.id, dirty: false)
            }
            bump()
        }
    }

    // MARK: Folienseiten

    /// Seite des Notizbuchs für diese Folie. Gibt es mehrere (Altbestand), gilt die mit dem kleineren `index`. Gibt es
    /// keine, wird sie hinten angehängt: Vorlage „folie“, Größe der Folie, `background_slide_id` = Folie (E10).
    /// Läuft eine Session des Moduls, wird nur eine Seite derselben Session wiederverwendet (#268): Eine Folienseite
    /// aus einer früheren Vorlesung mit gleicher `slide_id` trüge die Zeitbasis der alten Session. Eine Seite ohne
    /// Session zählt nur, wenn sie erst nach Beginn der Session angelegt wurde (offline, wie `needsLecturePage`). Läuft
    /// keine Session, gibt es keine Zeitbasis zu schützen und die Seite wird wie bisher wiederverwendet. Die neue Seite
    /// trägt über `addPage` Session und `sessionStartMS`. Maßgeblich ist die Session des Moduls wie bei `addPage` und
    /// der Zeitbasis der Striche, nicht `lectureSession(for:)`: Auch im Übungsnotizbuch oder solange das Notizbuch der
    /// Session unbekannt ist (offline), bekäme eine alte Folienseite sonst die Zeit der früheren Session.
    func slidePage(notebookID: String, slide: SlideRef) -> LibraryPage? {
        mergeDuplicateSlidePages(notebookID: notebookID)
        let session = store.notebook(notebookID).flatMap { matchingSession(moduleID: $0.moduleID) }
        let existing = store.pages(inNotebook: notebookID)
            .filter { $0.backgroundSlideID == slide.id && belongsToSession($0, session) }
            .min { ($0.index, $0.id) < ($1.index, $1.id) }
        if let existing { return existing }
        return addPage(
            notebookID: notebookID, template: .folie,
            size: CGSize(width: slide.widthPt, height: slide.heightPt),
            backgroundSlideID: slide.id, attachedSlideID: nil)
    }

    /// E10 (#286): Höchstens eine Folienseite je Notizbuch, Folie und Session. Auf einem Gerät entsteht keine zweite
    /// (`slidePage` läuft ohne Unterbrechung auf dem Hauptakteur). Doppelte kommen zurück, wenn der Mac eine gelöschte
    /// Folienseite wiederherstellt, nachdem das iPad schon eine neue angelegt hat (`mergePages`), oder wenn
    /// „Rückgängig“ eine Seite zurückholt, deren Ersatz schon beschrieben ist.
    ///
    /// Zusammengeführt wird ohne Strichverlust: Seiten mit Strichen (oder unlesbare) bleiben immer. Leere Duplikate
    /// gehen in die übliche Löschfrist und sind am Mac wiederherstellbar. Hat keine Seite der Gruppe Striche, bleibt
    /// die mit dem kleinsten `index` (dann `id`), wie in `slidePage`. Die zuletzt geöffnete Seite eines Notizbuchs
    /// bleibt ebenfalls stehen, ebenso die offene Seite (ihre letzten Striche stehen evtl. erst im Speicher) und jede
    /// Seite mit wartenden Strichen. Zwei beschriebene Seiten derselben Folie bleiben beide (kein Zusammenführen der
    /// Striche).
    /// - Returns: Anzahl der Seiten, die in die Löschfrist gingen
    @discardableResult
    func mergeDuplicateSlidePages(notebookID: String) -> Int {
        guard let notebook = store.notebook(notebookID) else { return 0 }
        var groups: [String: [LibraryPage]] = [:]
        for page in store.pages(inNotebook: notebookID) {
            guard let slideID = page.backgroundSlideID else { continue }
            groups["\(slideID)|\(page.sessionID ?? "")", default: []].append(page)
        }
        var removed = 0
        var pendingStrokes: Set<String>?
        for group in groups.values where group.count > 1 {
            // Striche nur in der Warteschlange (Absturz vor dem Speichern) zählen wie Striche in der Datei
            let pending =
                pendingStrokes
                ?? sync.pendingPageIDs(kind: "stroke.add").union(sync.pendingPageIDs(kind: "stroke.remove"))
            pendingStrokes = pending
            // `pages(inNotebook:)` liefert nach `index`, dann `id` sortiert
            let written = group.filter { pending.contains($0.id) || pageHasStrokes($0.id) }
            let empty = group.filter { page in !written.contains { $0.id == page.id } }
            let candidates = written.isEmpty ? Array(empty.dropFirst()) : empty
            for page in candidates where page.id != notebook.lastPageID && page.id != openPageID {
                deletePage(pageID: page.id)
                removed += 1
            }
        }
        return removed
    }

    /// Schreibziel für die Folienseite einer bekannten Folie: `slidePage` plus `openPage`. Die Ansicht öffnet so beim
    /// Start gleich die Folienseite (#272), ohne Umweg über `openTarget` und die letzte Seite, auf der kurz mit der
    /// alten Zeitbasis geschrieben werden könnte.
    func openSlideTarget(notebookID: String, slide: SlideRef) -> InkBinding? {
        guard let page = slidePage(notebookID: notebookID, slide: slide) else { return nil }
        return openPage(pageID: page.id)
    }

    private func belongsToSession(_ page: LibraryPage, _ session: RunningSession?) -> Bool {
        guard let session else { return true }
        if page.sessionID == session.id { return true }
        return page.sessionID == nil && createdDuring(session, pageID: page.id)
    }
}
