import PencilKit
import SwiftUI
import UIKit

/// Schreibfläche einer Seite mit Werkzeugleiste (F-INK-01).
/// Sie öffnet die letzte Seite des gewählten Notizbuchs (UX-30) und sendet die Striche live an den Mac (T1-14).
/// Ohne Verbindung wird lokal gepuffert: Die Wahl des Notizbuchs geht auch offline.
///
/// Seiten (T1-13 Teil 1): Eine Seite ist sichtbar. Oben steht „‹ Seite 3 / 12 ›“, ein Ein-Finger-Wisch blättert
/// ebenfalls. Die Seitenleiste („Seiten“) zeigt Vorschaubilder und sortiert um. Gelöscht wird ohne Dialog mit einer
/// Rückgängig-Leiste von 5 s (R1).
///
/// Schreibmodi (T1-13 Teil 2): Der Umschalter „Freie Seite“ / „Auf Folie“ gilt pro Modul. Im Modus „Auf Folie“ folgt die
/// Ansicht dem Folienwechsel des Mac: Sie öffnet die Seite dieser Folie (oder legt sie an). Ein Wechsel mitten im
/// Strich wartet bis zum Absetzen. Seiten mit `background_slide_id` zeigen die Folie unter der Schrift.
struct InkPageView: View {
    let library: InkLibraryService

    @State private var currentNotebookID: String
    @State private var model: InkPageModel?
    @State private var binding: InkBinding?
    @State private var isReconciling = false
    /// Das Notizbuch ist der Bibliothek nicht bekannt oder die Seite ließ sich nicht anlegen
    @State private var failedToOpen = false
    @State private var showsSidebar = false
    /// Eben gelöschte Seite, die noch zurückgeholt werden kann (Leiste „Rückgängig“, 5 s)
    @State private var undoPageID: String?
    /// Leere Ersatzseite, die nach dem Löschen der letzten Seite geöffnet wurde (UX-55). „Rückgängig“ räumt sie auf.
    @State private var replacementPageID: String?
    /// Folie unter der Schrift, nur mit Folien-Unterstützung
    @State private var slideBackground: SlideBackgroundModel?
    /// Hält Folienwechsel während eines Strichs zurück
    @State private var gate = SlideSwitchGate()
    /// Wartet auf die Schreibpause, bevor ein zurückgestellter Wechsel gilt (UX-43)
    @State private var quietTask: _Concurrency.Task<Void, Never>?
    /// Händigkeit: Seite der Werkzeugleiste. Später aus `Settings.lecture.toolbar_side` (F-EIN-01).
    @AppStorage("ink.toolbarSide") private var toolbarSideRaw = ToolbarSide.rechts.rawValue
    @Environment(\.scenePhase) private var scenePhase
    /// „Alles am Mac“ nach dem Aufholen (UX-49)
    @State private var allSynced = AllSyncedNotice()
    /// Hinweis zu „Auf Folie“, 5 s nach einem Tipp auf den ausgegrauten Umschalter (UX-51)
    @State private var slideHint = TimedNotice(duration: .seconds(5))
    /// Ablauf der Signatur für die Infozeile (UX-50), beim Erscheinen und Aktivieren neu gelesen
    @State private var expiryDate: Date?
    @State private var expiryNow = Date()

    init(library: InkLibraryService, notebookID: String) {
        self.library = library
        _currentNotebookID = State(initialValue: notebookID)
    }

    private var sync: SyncEngine { library.sync }

    private var toolbarSide: ToolbarSide {
        ToolbarSide(rawValue: toolbarSideRaw) ?? .rechts
    }

    /// Notizbuch der laufenden Vorlesung, wenn es vom angezeigten abweicht (UX-19). Die Seite bleibt stehen.
    private var otherNotebookID: String? {
        let running = library.running?.notebookID
        return InkBindingCheck.differs(shownNotebookID: currentNotebookID, runningNotebookID: running)
            ? running : nil
    }

    private var bannerState: InkBindingBannerState { InkBindingBannerState.shared }

    /// Das Banner „Diese Seite gehört nicht dazu“ gilt nur bei anderem Modul und bis zum „✕“ (UX-51)
    private var showsOtherLectureBanner: Bool {
        InkBindingCheck.showsBanner(
            shownNotebookID: currentNotebookID, shownModuleID: currentModuleID,
            runningNotebookID: library.running?.notebookID, runningModuleID: library.running?.moduleID,
            runningSessionID: library.running?.id, dismissedSessionIDs: bannerState.dismissedSessionIDs)
    }

    private var pages: [LibraryPage] {
        library.pages(inNotebook: currentNotebookID)
    }

    private var currentIndex: Int? {
        guard let binding else { return nil }
        return pages.firstIndex { $0.id == binding.pageID }
    }

    private var currentTemplate: PageTemplate {
        guard let binding else { return .blanko }
        return library.page(binding.pageID)?.template ?? .blanko
    }

    private var currentHasStrokes: Bool {
        guard let model else { return false }
        return !model.inkDrawing.strokes.isEmpty || !model.highlightDrawing.strokes.isEmpty
    }

    var body: some View {
        Group {
            if let model {
                HStack(spacing: 0) {
                    if toolbarSide == .links {
                        InkToolbar(model: model)
                        Divider()
                    }
                    InkCanvasView(
                        model: model, template: currentTemplate, backgroundImage: slideBackground?.image,
                        onSwipePage: { step($0) })
                        .id(model.pageID)
                        .ignoresSafeArea(edges: .bottom)
                        .overlay(alignment: .top) { transientNotices }
                    if toolbarSide == .rechts {
                        Divider()
                        InkToolbar(model: model)
                    }
                }
                .safeAreaInset(edge: .top, spacing: 0) {
                    VStack(spacing: 0) {
                        pageStrip
                        if model.isUnreadable {
                            // Ruhige Zeile statt Dialog (R1). Die Seite ist gesperrt, die Datei bleibt, wie sie ist.
                            infoRow(InkPageTitle.unreadableLine)
                        }
                        if library.isDeletedOnMac(notebookID: currentNotebookID) {
                            // Ruhige Zeile statt Dialog (R1). Weiterschreiben geht, die Striche landen im Papierkorb.
                            infoRow(InkLibraryService.deletedOnMacLine)
                        }
                        if let offlineText {
                            infoRow(offlineText)
                        }
                        if let expiryLine {
                            infoRow(expiryLine)
                        }
                        if let statusText = slideBackground?.statusText {
                            infoRow(statusText)
                        }
                        if let waiting = pendingSwitchText {
                            Button {
                                gate.releaseNow()
                            } label: {
                                Text(waiting)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .padding(.horizontal)
                                    .padding(.vertical, 8)
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                    .background(Color(.secondarySystemBackground))
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint("Wechselt sofort")
                        }
                        if showsOtherLectureBanner {
                            HStack {
                                Text("Am Mac läuft eine Vorlesung. Diese Seite gehört nicht dazu.")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Button("Zur laufenden Vorlesung") {
                                    _Concurrency.Task { await switchToRunningLecture() }
                                }
                                .buttonStyle(.bordered)
                                Button {
                                    if let sessionID = library.running?.id {
                                        bannerState.dismiss(sessionID: sessionID)
                                    }
                                } label: {
                                    Image(systemName: "xmark")
                                        .frame(width: 44, height: 44)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Hinweis ausblenden")
                            }
                            .padding(.horizontal)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(.secondarySystemBackground))
                        }
                    }
                }
                // Die Seitenleiste liegt über der Schreibfläche, auf der Seite gegenüber der Werkzeugleiste. Sie
                // verkleinert die Fläche nicht (sonst passte sich die Seite neu an) und blockiert den Stift nicht.
                .overlay(alignment: toolbarSide == .rechts ? .leading : .trailing) {
                    if showsSidebar {
                        sidebar
                            .transition(.move(edge: toolbarSide == .rechts ? .leading : .trailing))
                    }
                }
                .overlay(alignment: .bottom) {
                    if let pageID = undoPageID {
                        InkUndoDeleteBar(
                            pageID: pageID,
                            onUndo: { undoDelete() },
                            onExpire: {
                                if undoPageID == pageID {
                                    undoPageID = nil
                                    replacementPageID = nil
                                }
                            }
                        )
                        .padding(.bottom, 24)
                    }
                }
                .animation(.easeInOut(duration: 0.2), value: showsSidebar)
            } else if failedToOpen {
                Text("Dieses Notizbuch ist nicht mehr verfügbar.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(.secondarySystemBackground))
            } else {
                Color(.secondarySystemBackground)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    toolbarSideRaw = (toolbarSide == .links ? ToolbarSide.rechts : ToolbarSide.links).rawValue
                } label: {
                    Image(systemName: toolbarSide == .links ? "sidebar.right" : "sidebar.left")
                }
                .accessibilityLabel(
                    toolbarSide == .links ? "Werkzeugleiste nach rechts" : "Werkzeugleiste nach links")
            }
        }
        .task {
            await open()
        }
        .onAppear {
            refreshExpiry()
            allSynced.update(isOnline: sync.state == .online, pending: sync.pendingCount)
            sync.setPresence(presence(onPage: true))
            if let model { library.setOpenPage(model) }
            // Zurück in der Ansicht: Ein Wechsel wartete noch, das Warten läuft weiter
            if gate.hasPending {
                startQuietWait()
            }
        }
        .onDisappear {
            // Keine Freigabe, solange die Ansicht nicht zu sehen ist
            quietTask?.cancel()
            quietTask = nil
            model?.saveNow()
            // Die Seite ist nicht mehr offen: Ein Hintergrund-Abgleich lädt sie von der Platte (UX-46)
            library.setOpenPage(nil)
            // Beim Verlassen läuft die Frist ab: `page.delete` jetzt einreihen
            library.flushPendingDeletes()
            sync.setPresence(presence(onPage: false))
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                // Der Tag kann gewechselt haben (UX-50)
                refreshExpiry()
            }
            if phase != .active {
                model?.saveNow()
            }
            if phase == .background {
                library.flushPendingDeletes()
            }
        }
        .onChange(of: sync.state) { _, _ in
            allSynced.update(isOnline: sync.state == .online, pending: sync.pendingCount)
        }
        .onChange(of: sync.pendingCount) { _, _ in
            allSynced.update(isOnline: sync.state == .online, pending: sync.pendingCount)
        }
        .onChange(of: library.running) { old, new in
            // Eine andere Vorlesung: die aktuelle Folie wird wieder angesteuert (L15 aus #225)
            if old?.id != new?.id { gate.forgetFollowed() }
            // Die Vorlesung hat begonnen oder geendet: Session der offenen Seite nachziehen
            applyFreshTarget()
            followSlideIfNeeded()
            moveToLecturePageIfNeeded()
        }
        .onChange(of: library.slides?.follower.currentSlide) { _, _ in
            followSlideIfNeeded()
        }
        .onChange(of: gate.waitToken) { _, _ in
            // Ein Wechsel wartet: erst nach der Schreibpause gilt er (UX-43). Ein neuer Strich startet das Warten neu.
            startQuietWait()
        }
        .onChange(of: gate.releases) { _, _ in
            // Ruhe oder Tipp: der zurückgestellte Wechsel (nur der letzte) gilt jetzt
            if gate.takeLectureReleased() {
                moveToLecturePageIfNeeded()
            }
            // Nur im Modus „Auf Folie“ (der Modus kann gewechselt haben, während der Wechsel wartete)
            if let slide = gate.takeReleased(), currentMode == .aufFolie {
                openSlidePage(slide)
            }
        }
        .onChange(of: binding?.pageID) { _, _ in
            updateSlideBackground()
        }
        .onChange(of: library.slides?.decks.revision) { _, _ in
            updateSlideBackground()
        }
        .onChange(of: sync.welcomeCount) { _, _ in
            // Neu verbunden (auch nach neuer db_epoch): Bibliothek auffrischen, Seite abgleichen, wenn nötig
            _Concurrency.Task {
                await library.refresh()
                await library.refreshPages(notebookID: currentNotebookID)
                applyFreshTarget()
                await reconcileIfNeeded()
            }
        }
    }

    /// Wartet auf die Schreibpause und gibt dann den zurückgestellten Wechsel frei. Ein früheres Warten endet.
    private func startQuietWait() {
        quietTask?.cancel()
        quietTask = _Concurrency.Task {
            await gate.awaitQuiet(sleep: { try await _Concurrency.Task.sleep(for: $0) })
        }
    }

    /// Text der Infozeile, solange ein Wechsel auf die Schreibpause wartet (UX-43). Kein Dialog (R1).
    private var pendingSwitchText: String? {
        if let slide = gate.pendingSlide {
            return "Folie \(slide.index) · Tippen zum Wechseln"
        }
        if gate.lecturePending {
            return "Neue Vorlesung · Tippen zum Wechseln"
        }
        return nil
    }

    private var title: String {
        guard let binding else { return library.notebook(currentNotebookID)?.title ?? "Notizbuch" }
        return InkPageTitle.text(
            moduleName: binding.moduleName, notebookTitle: library.notebook(binding.notebookID)?.title)
    }

    /// Zeile ohne Verbindung. Modul und Notizbuch stehen dabei, damit klar ist, wohin geschrieben wird.
    private var offlineText: String? {
        guard let binding, sync.state != .online else { return nil }
        return InkPageTitle.offlineLine(
            moduleName: binding.moduleName, notebookTitle: library.notebook(binding.notebookID)?.title,
            pendingChanges: sync.pendingCount, slideNotFollowing: currentMode == .aufFolie)
    }

    /// Ablauf der Signatur als Infozeile, nur am letzten Tag und am Tag davor (UX-50)
    private var expiryLine: String? {
        guard let expiryDate else { return nil }
        return ProfileExpiry.pageLine(
            expiry: expiryDate, now: expiryNow, pendingChanges: ProfileExpiry.waitingChanges(
                isOnline: sync.state == .online, pending: sync.pendingCount))
    }

    private func refreshExpiry() {
        expiryDate = ProfileExpiry.currentExpiry()
        expiryNow = Date()
    }

    /// Kurze Hinweise („Alles am Mac“ 3 s, Folien-Hinweis 5 s) liegen über der Fläche, statt sie zu verkleinern: Jede
    /// neue Höhe passt die Seite neu ein und setzt den Zoom zurück. Der Stift schreibt durch sie hindurch.
    private var transientNotices: some View {
        VStack(spacing: 0) {
            if offlineText == nil, allSynced.isVisible {
                infoRow(InkPageTitle.allSyncedLine)
            }
            if let hint = slideModeHint {
                infoRow(hint)
            }
        }
        .allowsHitTesting(false)
    }

    /// Kleiner Wechsel ins Notizbuch der laufenden Vorlesung, wenn kein Banner dasteht: gleiches Modul (UX-51) oder
    /// Banner weggeklickt. Kein eigenes Banner, kein Dialog (R1).
    private var showsLectureShortcut: Bool {
        otherNotebookID != nil && !showsOtherLectureBanner
    }

    private func infoRow(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.horizontal)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemBackground))
    }

    // MARK: Seitenleiste und Blättern

    /// „‹ Seite 3 / 12 ›“, Vorlage und Seitenleiste. Alle Ziele sind mindestens 44 × 44 pt groß.
    private var pageStrip: some View {
        let count = pages.count
        let index = currentIndex
        return HStack(spacing: 4) {
            Button {
                step(-1)
            } label: {
                Image(systemName: "chevron.left").frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .disabled(!canStep(-1))
            .accessibilityLabel("Vorherige Seite")

            Text(InkPaging.positionText(index: index, count: count))
                .font(.subheadline.monospacedDigit())
                .frame(minWidth: 96)
                .accessibilityLabel(InkPaging.positionText(index: index, count: count))

            Button {
                step(1)
            } label: {
                Image(systemName: "chevron.right").frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .disabled(!canStep(1))
            .accessibilityLabel(index.map { $0 + 1 < count } == true ? "Nächste Seite" : "Neue Seite")

            Spacer()

            if showsLectureShortcut {
                Button {
                    _Concurrency.Task { await switchToRunningLecture() }
                } label: {
                    Label("Zur Vorlesung", systemImage: "arrow.uturn.left")
                        .font(.subheadline)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityHint("Öffnet das Notizbuch der laufenden Vorlesung")
            }

            modeButton

            Menu {
                Picker("Vorlage", selection: templateBinding) {
                    ForEach(PageTemplate.choices, id: \.self) { template in
                        Text(template.germanTitle).tag(template)
                    }
                }
                .disabled(currentTemplate == .folie)
                Divider()
                Button("Seite löschen", role: .destructive) {
                    if let binding { delete(pageID: binding.pageID) }
                }
            } label: {
                Image(systemName: "ellipsis.circle").frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel("Seite: Vorlage und Löschen")

            Button {
                toggleSidebar()
            } label: {
                Label("Seiten", systemImage: "rectangle.grid.2x2")
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel(showsSidebar ? "Seitenleiste schließen" : "Seitenleiste öffnen")
        }
        .padding(.horizontal, 8)
        .frame(maxWidth: .infinity)
        .background(Color(.secondarySystemBackground))
    }

    // MARK: Schreibmodus und Folie (T1-13 Teil 2)

    private var currentModuleID: String? {
        library.notebook(currentNotebookID)?.moduleID
    }

    private var slideModeAvailable: Bool {
        guard let moduleID = currentModuleID else { return false }
        return InkModeResolver.isAvailable(
            running: library.running, moduleID: moduleID, slideKnown: library.slides?.follower.currentSlide != nil)
    }

    private var currentMode: InkMode? {
        guard library.slides != nil, let moduleID = currentModuleID else { return nil }
        return library.inkMode(forModule: moduleID)
    }

    /// „Auf Folie“ gilt wirklich: Modus gewählt und Folie verfügbar (#268). Nur dann hängen `open()` und
    /// `moveToLecturePageIfNeeded()` keine Vorlesungsseite an, die Folienseiten übernimmt `followSlideIfNeeded()`.
    private var writesOnSlide: Bool {
        InkModeResolver.writesOnSlide(mode: currentMode, slideAvailable: slideModeAvailable)
    }

    /// Hinweis zum ausgegrauten Umschalter: nur 5 s nach einem Tipp darauf (UX-51), nicht dauerhaft
    private var slideModeHint: String? {
        guard slideHint.isVisible, !slideModeAvailable else { return nil }
        return InkModeResolver.unavailableHint
    }

    /// Ein Tipp schaltet um. Zurück zur freien Seite geht immer, „Auf Folie“ nur mit laufender Vorlesung.
    @ViewBuilder
    private var modeButton: some View {
        if let mode = currentMode, let moduleID = currentModuleID {
            let dimmed = mode == .freieSeite && !slideModeAvailable
            Button {
                // Der Umschalter ist ausgegraut: Ein Tipp erklärt es kurz, mehr passiert nicht
                if dimmed {
                    slideHint.show()
                    return
                }
                slideHint.hide()
                // Ein wartender Wechsel gehört zum alten Modus (Folie bzw. neue Vorlesungsseite)
                gate.dropPending()
                library.setInkMode(mode == .aufFolie ? .freieSeite : .aufFolie, moduleID: moduleID)
                if mode == .freieSeite {
                    followSlideIfNeeded(force: true)
                }
            } label: {
                Label(
                    mode == .aufFolie ? "Auf Folie" : "Freie Seite",
                    systemImage: mode == .aufFolie ? "rectangle.on.rectangle" : "doc"
                )
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .opacity(dimmed ? 0.4 : 1)
            .accessibilityLabel(mode == .aufFolie ? "Schreibmodus: Auf Folie" : "Schreibmodus: Freie Seite")
            // Ohne `.disabled` fehlt das Merkmal „abgeblendet“: Der Wert sagt es VoiceOver
            .accessibilityValue(dimmed ? "Wechsel gerade nicht möglich" : "")
            .accessibilityHint(
                slideModeAvailable ? "Ein Tipp wechselt den Modus für dieses Modul" : InkModeResolver.unavailableHint)
        }
    }

    /// Folgt dem Mac auf die Seite der aktuellen Folie, wenn der Modus „Auf Folie“ gilt und es geht
    private func followSlideIfNeeded(force: Bool = false) {
        guard let slides = library.slides, let moduleID = currentModuleID, slideModeAvailable else { return }
        // `force`: Der Modus wurde gerade eingeschaltet, die Wahl steht noch nicht überall
        guard force || library.inkMode(forModule: moduleID) == .aufFolie else { return }
        _Concurrency.Task {
            guard let slide = await slides.currentSlide() else { return }
            // Dieselbe Folie wie beim letzten Wechsel: nicht zurückspringen, wenn von Hand weitergeblättert wurde
            guard force || !gate.alreadyFollowed(slide) else { return }
            if let now = gate.slideChanged(slide) {
                openSlidePage(now)
            }
        }
    }

    private func openSlidePage(_ slide: SlideRef) {
        _Concurrency.Task {
            // Setzt der Stift zwischen Freigabe und Wechsel an, wartet der Wechsel erneut bis zum Absetzen. Sonst
            // verschwände die Ansicht mitten im Strich.
            guard gate.slideChanged(slide) != nil else { return }
            gate.noteFollowed(slide)
            guard let page = library.slidePage(notebookID: currentNotebookID, slide: slide) else { return }
            await show(pageID: page.id)
        }
    }

    /// Zeigt die Folie der offenen Seite (oder nichts bei einer freien Seite)
    private func updateSlideBackground() {
        guard let slides = library.slides else { return }
        if slideBackground == nil {
            let sync = library.sync
            slideBackground = SlideBackgroundModel(support: slides, canReach: { sync.canReachCore })
        }
        let slideID = binding.flatMap { library.page($0.pageID)?.backgroundSlideID }
        slideBackground?.show(slideID: slideID, deckHint: library.running?.slideDeckID)
    }

    /// Neue freie Seite: trägt die aktuelle Folie als `attached_slide_id`, wenn die Vorlesung zum Modul gehört
    private func attachedSlideForNewPage() -> String? {
        guard let moduleID = currentModuleID, library.running?.moduleID == moduleID else { return nil }
        return library.slides?.knownCurrentSlide()?.id
    }

    /// Vorlage der offenen Seite als Auswahl. „Folie“ steht nicht zur Wahl und wechselt nicht.
    private var templateBinding: Binding<PageTemplate> {
        Binding(
            get: {
                let template = currentTemplate
                return PageTemplate.choices.contains(template) ? template : InkTemplateGeometry.effectiveTemplate(template)
            },
            set: { newValue in
                guard let binding else { return }
                library.setTemplate(pageID: binding.pageID, newValue)
            }
        )
    }

    private var sidebar: some View {
        InkPageSidebar(
            library: library,
            notebookID: currentNotebookID,
            currentPageID: binding?.pageID,
            onSelect: { pageID in
                _Concurrency.Task { await show(pageID: pageID) }
            },
            onAdd: { template in
                addPage(template: template)
            },
            onDelete: { pageID in
                delete(pageID: pageID)
            },
            onSetTemplate: { pageID, template in
                library.setTemplate(pageID: pageID, template)
            },
            onMove: { from, to in
                library.movePage(notebookID: currentNotebookID, from: from, to: to)
            },
            onClose: { showsSidebar = false }
        )
    }

    private func toggleSidebar() {
        if !showsSidebar {
            // Das Vorschaubild der offenen Seite soll den letzten Strich zeigen
            model?.saveNow()
        }
        showsSidebar.toggle()
    }

    private func canStep(_ direction: Int) -> Bool {
        guard let binding else { return false }
        return InkPaging.step(
            pages: pages, currentID: binding.pageID, direction: direction, currentHasStrokes: currentHasStrokes)
            != .stay
    }

    /// Blättert (Knopf oder Wisch). Hinter der letzten Seite legt „weiter“ eine neue an, aber nur, wenn die offene
    /// Seite einen Strich hat.
    private func step(_ direction: Int) {
        guard let binding else { return }
        switch InkPaging.step(
            pages: pages, currentID: binding.pageID, direction: direction, currentHasStrokes: currentHasStrokes)
        {
        case .go(let pageID):
            _Concurrency.Task { await show(pageID: pageID) }
        case .newPage:
            addPage(template: nil)
        case .stay:
            break
        }
    }

    /// Legt eine Seite hinter den vorhandenen an und öffnet sie. Ohne Vorlage erbt sie die der offenen Seite.
    private func addPage(template: PageTemplate?) {
        guard let binding, let current = library.page(binding.pageID) else { return }
        guard
            let created = library.addPage(
                notebookID: binding.notebookID,
                template: template ?? InkPaging.template(after: current),
                size: InkPaging.size(after: current),
                backgroundSlideID: nil,
                attachedSlideID: attachedSlideForNewPage())
        else { return }
        _Concurrency.Task { await show(pageID: created.id) }
    }

    // MARK: Löschen mit Frist

    /// Löscht ohne Dialog (R1). Unten erscheint 5 s lang „Rückgängig“. Ist es die offene Seite, rückt die nächste nach.
    private func delete(pageID: String) {
        let visible = pages
        guard let index = visible.firstIndex(where: { $0.id == pageID }) else { return }
        let wasOpen = binding?.pageID == pageID
        if wasOpen {
            model?.saveNow()
        }
        library.deletePage(pageID: pageID)
        undoPageID = pageID
        replacementPageID = nil
        guard wasOpen else { return }
        let remaining = library.pages(inNotebook: currentNotebookID)
        if let next = InkPaging.pageAfterDeleting(index: index, remaining: remaining) {
            _Concurrency.Task { await show(pageID: next) }
        } else {
            // Die letzte Seite ist weg: `openTarget` legt eine neue an
            _Concurrency.Task { await openFreshPage(afterDeleting: pageID) }
        }
    }

    private func undoDelete() {
        guard let pageID = undoPageID else { return }
        undoPageID = nil
        let replacementID = replacementPageID
        replacementPageID = nil
        if library.undoDelete(pageID: pageID) {
            // Die leere Ersatzseite der gelöschten letzten Seite wieder entfernen, sonst bleibt eine Restseite (UX-55).
            // Erst sichern: Ob sie leer ist, liest der Dienst von der Platte. Mit Strich bleibt sie.
            // Ist die Ersatzseite offen, zählen auch die Striche im Speicher: Scheitert das Sichern, wüsste die Platte
            // nichts von ihnen.
            if let replacementID, replacementID != pageID {
                model?.saveNow()
                let openWithStrokes = binding?.pageID == replacementID && currentHasStrokes
                if !openWithStrokes {
                    library.discardEmptyPage(pageID: replacementID)
                }
            }
            _Concurrency.Task { await show(pageID: pageID) }
        }
    }

    // MARK: Seite öffnen

    /// Wechselt zu einer Seite: alte Seite sichern, neues Modell, `presence`, bei Bedarf Abgleich
    private func show(pageID: String) async {
        guard binding?.pageID != pageID else { return }
        model?.saveNow()
        guard let target = library.openPage(pageID: pageID) else { return }
        let page = present(target)
        await library.refreshPages(notebookID: target.notebookID)
        guard !_Concurrency.Task.isCancelled, model === page else { return }
        applyFreshTarget()
        await reconcileIfNeeded()
    }

    /// Nach dem Löschen der letzten Seite: eine neue anlegen und öffnen. Läuft die Löschfrist der Seite noch, merkt
    /// sich die Ansicht die Ersatzseite für „Rückgängig“ (UX-55), und zwar vor dem Abgleich, der warten kann.
    /// Nur eine Seite, die `openTarget` neu angelegt hat, gilt als Ersatzseite, nie eine schon vorhandene.
    private func openFreshPage(afterDeleting deletedID: String) async {
        let known = Set(library.pages(inNotebook: currentNotebookID).map(\.id))
        guard let target = library.openTarget(notebookID: currentNotebookID) else {
            failedToOpen = true
            return
        }
        let page = present(target)
        if undoPageID == deletedID, target.pageID != deletedID, !known.contains(target.pageID) {
            replacementPageID = target.pageID
        }
        guard !_Concurrency.Task.isCancelled, model === page else { return }
        await reconcileIfNeeded()
    }

    /// Beginnt die Vorlesung bei offener Seite und gehört die letzte Seite zu einer anderen, öffnet die Ansicht eine
    /// neue Seite (UX-44). Das gilt nur für die letzte Seite des Notizbuchs und nicht, solange „Auf Folie“ mit
    /// verfügbarer Folie gilt (#268). Ist keine Folie verfügbar, gilt die Logik des freien Modus; wird die erste Folie
    /// später bekannt, wechselt `followSlideIfNeeded()` nach der Ruhezeit auf die Folienseite. Wird gerade
    /// geschrieben, wartet der Wechsel auf die Ruhezeit (UX-43).
    private func moveToLecturePageIfNeeded() {
        // Erst sichern: Der Dienst liest die Striche der Seite beim Prüfen von der Platte (`pageHasStrokes`)
        model?.saveNow()
        guard let binding, !writesOnSlide, pages.last?.id == binding.pageID,
            library.needsLecturePage(notebookID: currentNotebookID)
        else { return }
        guard gate.lectureStarted() else { return }
        _Concurrency.Task {
            // Setzt der Stift zwischen Freigabe und Wechsel an, wartet der Wechsel erneut
            guard !gate.toolInUse else {
                _ = gate.lectureStarted()
                return
            }
            model?.saveNow()
            // Ist inzwischen die erste Folie bekannt, übernimmt `followSlideIfNeeded()` (#268): keine leere
            // Vorlesungsseite, die gleich danach von der Folienseite abgelöst würde
            guard !writesOnSlide, library.needsLecturePage(notebookID: currentNotebookID),
                let target = library.openLectureTarget(notebookID: currentNotebookID)
            else { return }
            await show(pageID: target.pageID)
        }
    }

    /// Erst der Knopf wechselt: Aktuelle Seite sichern, Abmelden von der alten Seite, neu öffnen
    private func switchToRunningLecture() async {
        guard let target = otherNotebookID else { return }
        model?.saveNow()
        sync.setPresence(presence(onPage: false))
        model = nil
        library.setOpenPage(nil)
        binding = nil
        failedToOpen = false
        showsSidebar = false
        currentNotebookID = target
        // Im neuen Notizbuch gibt es noch keine Folienseite: die aktuelle Folie wird wieder angesteuert
        gate.forgetFollowed()
        await open()
    }

    /// Öffnet die Seite: Schreibziel aus der Bibliothek, Modell anlegen, Sync anschließen. Der Abruf beim Core
    /// kommt danach und hält das Schreiben nicht auf.
    private func open() async {
        guard model == nil else { return }
        let notebookID = currentNotebookID
        // Ein nie geöffnetes Notizbuch kennt die Seiten des Mac noch nicht: Bei Verbindung zuerst abgleichen, damit
        // die erste Seite hinter ihnen einsortiert wird (L4 aus #225). Ohne Verbindung geht es ohne Wartezeit weiter.
        if library.pages(inNotebook: notebookID).isEmpty, sync.state == .online {
            await library.refreshPages(notebookID: notebookID)
            guard !_Concurrency.Task.isCancelled, model == nil else { return }
        }
        // Läuft eine Vorlesung des Moduls und endet die letzte Seite in einer anderen, beginnt eine neue Seite (UX-44)
        // (nicht bei „Auf Folie“ mit verfügbarer Folie, #268: ohne Folie gilt die Logik des freien Modus)
        let appendsForLecture = !writesOnSlide
        // Ist die Folie lokal schon bekannt (Foliensatz auf dem iPad), öffnet „Auf Folie“ gleich die Folienseite
        // (#272). So zeigt `openTarget` nicht kurz die alte letzte Seite, auf der bis zum Wechsel nach den
        // Netzabfragen mit der alten Zeitbasis geschrieben würde. Ist die Folie nicht bekannt, bleibt alles wie bisher.
        // Ohne das Gate: Es gibt noch keine offene Seite, auf der geschrieben wird, und `present` setzt es ohnehin
        // zurück. Ein zurückgestellter Wechsel (Stift eben noch auf der vorigen Seite) zeigte sonst doch die alte Seite.
        // Der Folgeaufruf am Ende wechselt nicht noch einmal, weil `show` bei derselben Seite nichts tut.
        let slideTarget: InkBinding? =
            writesOnSlide
            ? library.slides?.knownCurrentSlide().flatMap { library.openSlideTarget(notebookID: notebookID, slide: $0) }
            : nil
        guard
            let target = slideTarget
                ?? (appendsForLecture
                    ? library.openLectureTarget(notebookID: notebookID) : library.openTarget(notebookID: notebookID))
        else {
            failedToOpen = true
            return
        }
        let page = present(target)

        await library.refresh()
        guard !_Concurrency.Task.isCancelled, model === page else { return }
        await library.refreshPages(notebookID: notebookID)
        guard !_Concurrency.Task.isCancelled, model === page else { return }
        applyFreshTarget()
        await reconcileIfNeeded()
        await library.refreshLectureDefaults()
        followSlideIfNeeded()
    }

    /// Legt das Modell der Seite an und macht sie zur offenen Seite (alte Seite muss vorher gesichert sein)
    @discardableResult
    private func present(_ target: InkBinding) -> InkPageModel? {
        guard let libraryPage = library.page(target.pageID) else { return nil }
        let store = FileInkPageStore.standard()
        let page = InkPageModel(
            pageID: target.pageID,
            pageSize: CGSize(width: libraryPage.widthPt, height: libraryPage.heightPt),
            store: store,
            outboxMark: sync.outboxMark(forPage: target.pageID)
        )
        page.outboxNumberProvider = { [weak library] in library?.sync.outboxLastNumber ?? 0 }
        page.sessionStartedAt = target.sessionStartMS.map { Date(timeIntervalSince1970: Double($0) / 1000) }
        let pageID = target.pageID
        page.onStrokeChanges = { [weak library, weak page] changes in
            guard let library, let page else { return }
            // Das Ziel wird bei jedem Aufruf neu gelesen: Beginnt die Vorlesung erst nach dem Öffnen, fehlt sonst
            // die Session an den Strichen. Scheitert das Einreihen, holt der nächste Abgleich es nach.
            guard let current = library.target(forPage: pageID) else {
                page.markNeedsReconcile()
                return
            }
            if !library.sync.enqueue(changes, binding: current) {
                page.markNeedsReconcile()
            }
        }
        // Vorschaubild der Seitenleiste nach jedem Speichern, außerhalb des Main-Actors gerendert
        page.onSaved = { [weak library] snapshot in
            guard let library, let known = library.page(pageID) else { return }
            let ink = snapshot.ink
            let highlight = snapshot.highlight
            let template = known.template
            let width = known.widthPt
            let height = known.heightPt
            _Concurrency.Task {
                await InkThumbnailService.shared.schedule(
                    pageID: pageID, ink: ink, highlight: highlight, template: template, widthPt: width,
                    heightPt: height)
            }
        }
        // Der Stift setzt an oder ab: Folienwechsel warten bis zum Absetzen. Das Gate gehört der Ansicht, die Rückrufe
        // halten nur das Gate und nicht die Ansicht.
        gate.reset()
        page.onToolUseStarted = { [weak gate] in gate?.toolBegan() }
        page.onToolUseFinished = { [weak gate] in gate?.finishTool() }
        binding = target
        model = page
        // Der Hintergrund-Abgleich nach einer Wiederherstellung nimmt für diese Seite genau dieses Modell (UX-46)
        library.setOpenPage(page)
        sync.setPresence(presence(onPage: true))
        updateSlideBackground()
        return page
    }

    /// Zieht Session und Modulname der offenen Seite aus der Bibliothek nach
    private func applyFreshTarget() {
        guard let model, let current = binding, let fresh = library.target(forPage: current.pageID) else { return }
        model.sessionStartedAt = fresh.sessionStartMS.map { Date(timeIntervalSince1970: Double($0) / 1000) }
        if fresh != current {
            binding = fresh
        }
        sync.setPresence(presence(onPage: true))
    }

    private func reconcileIfNeeded() async {
        guard let model, let binding, sync.canReachCore, !isReconciling else { return }
        guard model.needsReconcile || sync.pageNeedsReconcile(pageID: binding.pageID) else { return }
        isReconciling = true
        // Wechselt die Seite während der Anfrage (weiter und zurück), ist `model` veraltet: Es kennt die neuen Striche
        // des neu geöffneten Modells nicht und würde sie am Core entfernen. Dann nichts planen.
        let result = await sync.reconcile(page: model, binding: binding) { self.model === model }
        isReconciling = false
        // Der Abgleich der jetzt offenen Seite wurde in der Zwischenzeit übersprungen (`isReconciling`): nachholen
        if result == .skipped, self.model !== model, !_Concurrency.Task.isCancelled {
            await reconcileIfNeeded()
        }
    }

    /// `page_id` ist nur gesetzt, solange die Schreibfläche offen ist
    private func presence(onPage: Bool) -> SyncPresenceTarget? {
        guard let binding else { return nil }
        return SyncPresenceTarget(
            sessionID: binding.sessionID,
            notebookID: binding.notebookID,
            pageID: onPage ? binding.pageID : nil
        )
    }
}

/// Leiste „Seite gelöscht · Rückgängig“. Verschwindet nach 5 s von selbst, kein Dialog (R1).
private struct InkUndoDeleteBar: View {
    let pageID: String
    let onUndo: () -> Void
    let onExpire: () -> Void

    var body: some View {
        HStack(spacing: 16) {
            Text("Seite gelöscht")
            Button("Rückgängig", action: onUndo)
                .fontWeight(.semibold)
                .frame(minWidth: 44, minHeight: 44)
        }
        .padding(.horizontal, 20)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.primary.opacity(0.15), lineWidth: 1))
        .task(id: pageID) {
            try? await _Concurrency.Task.sleep(for: InkLibraryService.undoBarDuration)
            guard !_Concurrency.Task.isCancelled else { return }
            onExpire()
        }
        .accessibilityElement(children: .contain)
    }
}

/// Werkzeugleiste am linken oder rechten Rand. Alle Ziele sind mindestens 44 × 44 pt groß.
struct InkToolbar: View {
    @Bindable var model: InkPageModel

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 4) {
                ForEach(InkPenStyle.allCases, id: \.self) { style in
                    toolButton(.pen(style), symbol: InkToolbar.symbol(for: style), caption: InkToolbar.caption(for: style))
                        .accessibilityLabel(style.title)
                }
                toolButton(.marker, symbol: "highlighter", caption: "Marker")
                    .accessibilityLabel("Textmarker")
                eraserButton
                toolButton(.lasso, symbol: "lasso", caption: "Lasso")
                    .accessibilityLabel("Lasso")

                Divider().padding(.vertical, 4)

                if model.tools.tool.draws {
                    widthButtons
                    colorButton
                }
                if model.tools.tool == .eraser {
                    eraserOptions
                }
                toggleButton(
                    isOn: model.tools.rulerActive, symbol: "ruler", caption: "Lineal"
                ) {
                    model.tools.rulerActive.toggle()
                }
                .accessibilityLabel("Lineal")

                Divider().padding(.vertical, 4)

                Button {
                    model.undo()
                } label: {
                    InkToolIcon(symbol: "arrow.uturn.backward", caption: nil, selected: false)
                }
                .buttonStyle(.plain)
                .disabled(!model.canUndo)
                .accessibilityLabel("Rückgängig")

                Button {
                    model.redo()
                } label: {
                    InkToolIcon(symbol: "arrow.uturn.forward", caption: nil, selected: false)
                }
                .buttonStyle(.plain)
                .disabled(!model.canRedo)
                .accessibilityLabel("Wiederholen")

                if model.saveFailed {
                    Image(systemName: "externaldrive.badge.exclamationmark")
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                        .accessibilityLabel("Die Seite konnte nicht gespeichert werden")
                }
            }
            .padding(.vertical, 8)
        }
        .frame(width: 68)
        .background(Color(.systemBackground))
    }

    // MARK: Werkzeuge

    private func toolButton(_ tool: InkTool, symbol: String, caption: String) -> some View {
        let selected = model.tools.tool == tool
        return Button {
            model.tools.select(tool)
        } label: {
            InkToolIcon(symbol: symbol, caption: caption, selected: selected)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func toggleButton(
        isOn: Bool, symbol: String, caption: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            InkToolIcon(symbol: symbol, caption: caption, selected: isOn)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    /// Tipp wählt den Radierer, Lang-Druck wechselt zwischen „ganzer Strich“ und „präzise“ (F-INK-01)
    private var eraserButton: some View {
        let selected = model.tools.tool == .eraser
        let precise = model.tools.eraserMode == .pixel
        return InkToolIcon(
            symbol: precise ? "eraser.line.dashed" : "eraser",
            caption: "Radierer",
            selected: selected
        )
        .onTapGesture {
            model.tools.select(.eraser)
        }
        .onLongPressGesture(minimumDuration: 0.4) {
            model.tools.toggleEraserMode()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(precise ? "Radierer, präzise" : "Radierer, ganzer Strich")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction {
            model.tools.select(.eraser)
        }
        .accessibilityAction(named: "Radierart wechseln") {
            model.tools.toggleEraserMode()
        }
    }

    @ViewBuilder
    private var eraserOptions: some View {
        let precise = model.tools.eraserMode == .pixel
        toggleButton(
            isOn: precise, symbol: "eraser.line.dashed", caption: precise ? "Präzise" : "Strich"
        ) {
            model.tools.setEraserMode(model.tools.eraserMode.toggled)
        }
        .accessibilityLabel("Präzise radieren")

        toggleButton(
            isOn: model.tools.eraserHighlightOnly, symbol: "highlighter", caption: "Nur Marker"
        ) {
            model.tools.eraserHighlightOnly.toggle()
        }
        .accessibilityLabel("Nur Textmarker radieren")
    }

    // MARK: Stärke und Farbe

    private var widthButtons: some View {
        ForEach(0..<InkToolState.widthChoices, id: \.self) { index in
            let selected = model.tools.currentWidthIndex == index
            Button {
                model.tools.selectWidth(index: index)
            } label: {
                Circle()
                    .fill(Color.primary)
                    .frame(width: CGFloat(6 + index * 5), height: CGFloat(6 + index * 5))
                    .frame(width: 44, height: 44)
                    .background(
                        selected ? Color.accentColor.opacity(0.18) : Color.clear,
                        in: RoundedRectangle(cornerRadius: 10)
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Stärke \(index + 1) von \(InkToolState.widthChoices)")
            .accessibilityAddTraits(selected ? .isSelected : [])
        }
    }

    private var colorButton: some View {
        Button {
            model.showsColorPalette = true
        } label: {
            Circle()
                .fill(InkToolbar.color(model.tools.currentColor))
                .frame(width: 28, height: 28)
                .overlay(Circle().strokeBorder(Color.primary.opacity(0.25), lineWidth: 1))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Farbe")
        .popover(isPresented: $model.showsColorPalette) {
            InkColorPalette(
                colors: model.tools.paletteColors,
                selected: model.tools.currentColor
            ) { color in
                model.tools.selectColor(color)
                model.showsColorPalette = false
            }
        }
    }

    // MARK: Darstellung

    static func color(_ color: InkRGBA?) -> Color {
        guard let color else { return Color.primary }
        return Color(uiColor: color.uiColor)
    }

    private static func symbol(for style: InkPenStyle) -> String {
        switch style {
        case .fountain: return "pencil.tip"
        case .fineliner: return "pencil"
        case .monoline: return "pencil.line"
        case .pencil: return "pencil.and.scribble"
        }
    }

    private static func caption(for style: InkPenStyle) -> String {
        switch style {
        case .fountain: return "Füller"
        case .fineliner: return "Fineliner"
        case .monoline: return "Mono"
        case .pencil: return "Bleistift"
        }
    }
}

/// Symbol eines Werkzeugs mit kurzer Beschriftung
private struct InkToolIcon: View {
    let symbol: String
    let caption: String?
    let selected: Bool

    var body: some View {
        VStack(spacing: 2) {
            Image(systemName: symbol)
                .font(.system(size: 19))
            if let caption {
                Text(caption)
                    .font(.system(size: 9))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        .frame(width: 60, height: 44)
        .foregroundStyle(selected ? Color.accentColor : Color.primary)
        .background(
            selected ? Color.accentColor.opacity(0.18) : Color.clear,
            in: RoundedRectangle(cornerRadius: 10)
        )
        .contentShape(Rectangle())
    }
}

/// Favoritenfarben als Raster
private struct InkColorPalette: View {
    let colors: [InkRGBA]
    let selected: InkRGBA?
    let onSelect: (InkRGBA) -> Void

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.fixed(48), spacing: 8), count: 4), spacing: 8) {
            ForEach(colors, id: \.self) { color in
                Button {
                    onSelect(color)
                } label: {
                    Circle()
                        .fill(InkToolbar.color(color))
                        .frame(width: 36, height: 36)
                        .overlay(
                            Circle().strokeBorder(
                                color == selected ? Color.accentColor : Color.primary.opacity(0.2),
                                lineWidth: color == selected ? 3 : 1
                            )
                        )
                        .frame(width: 48, height: 48)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Farbe \(color.hex)")
                .accessibilityAddTraits(color == selected ? .isSelected : [])
            }
        }
        .padding(16)
    }
}
