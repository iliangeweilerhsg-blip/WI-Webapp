import SwiftUI
import UIKit

/// Schreibfläche einer Seite mit Werkzeugleiste (F-INK-01).
/// Sie öffnet die letzte Seite des gewählten Notizbuchs (UX-30) und sendet die Striche live an den Mac (T1-14).
/// Ohne Verbindung wird lokal gepuffert: Die Wahl des Notizbuchs geht auch offline. Seiten, Vorlagen und
/// Schreibmodi folgen mit T1-13.
struct InkPageView: View {
    let library: InkLibraryService

    @State private var currentNotebookID: String
    @State private var model: InkPageModel?
    @State private var binding: InkBinding?
    @State private var isReconciling = false
    /// Das Notizbuch ist der Bibliothek nicht bekannt oder die Seite ließ sich nicht anlegen
    @State private var failedToOpen = false
    /// Händigkeit: Seite der Werkzeugleiste. Später aus `Settings.lecture.toolbar_side` (F-EIN-01).
    @AppStorage("ink.toolbarSide") private var toolbarSideRaw = ToolbarSide.rechts.rawValue
    @Environment(\.scenePhase) private var scenePhase

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

    var body: some View {
        Group {
            if let model {
                HStack(spacing: 0) {
                    if toolbarSide == .links {
                        InkToolbar(model: model)
                        Divider()
                    }
                    InkCanvasView(model: model)
                        .ignoresSafeArea(edges: .bottom)
                    if toolbarSide == .rechts {
                        Divider()
                        InkToolbar(model: model)
                    }
                }
                .safeAreaInset(edge: .top, spacing: 0) {
                    VStack(spacing: 0) {
                        if let offlineText {
                            infoRow(offlineText)
                        }
                        if otherNotebookID != nil {
                            HStack {
                                Text("Am Mac läuft eine Vorlesung. Diese Seite gehört nicht dazu.")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Button("Zur laufenden Vorlesung") {
                                    _Concurrency.Task { await switchToRunningLecture() }
                                }
                                .buttonStyle(.bordered)
                            }
                            .padding(.horizontal)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(.secondarySystemBackground))
                        }
                    }
                }
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
            sync.setPresence(presence(onPage: true))
        }
        .onDisappear {
            model?.saveNow()
            sync.setPresence(presence(onPage: false))
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                model?.saveNow()
            }
        }
        .onChange(of: library.running) { _, _ in
            // Die Vorlesung hat begonnen oder geendet: Session der offenen Seite nachziehen
            applyFreshTarget()
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

    private var title: String {
        guard let binding else { return library.notebook(currentNotebookID)?.title ?? "Notizbuch" }
        return InkPageTitle.text(
            moduleName: binding.moduleName, notebookTitle: library.notebook(binding.notebookID)?.title)
    }

    /// Zeile ohne Verbindung. Modul und Notizbuch stehen dabei, damit klar ist, wohin geschrieben wird.
    private var offlineText: String? {
        guard let binding, sync.state != .online else { return nil }
        return InkPageTitle.offlineLine(
            moduleName: binding.moduleName, notebookTitle: library.notebook(binding.notebookID)?.title)
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

    /// Erst der Knopf wechselt: Aktuelle Seite sichern, Abmelden von der alten Seite, neu öffnen
    private func switchToRunningLecture() async {
        guard let target = otherNotebookID else { return }
        model?.saveNow()
        sync.setPresence(presence(onPage: false))
        model = nil
        binding = nil
        failedToOpen = false
        currentNotebookID = target
        await open()
    }

    /// Öffnet die Seite: Schreibziel aus der Bibliothek, Modell anlegen, Sync anschließen. Der Abruf beim Core
    /// kommt danach und hält das Schreiben nicht auf.
    private func open() async {
        guard model == nil else { return }
        let notebookID = currentNotebookID
        guard let target = library.openTarget(notebookID: notebookID), let libraryPage = library.page(target.pageID)
        else {
            failedToOpen = true
            return
        }

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
        binding = target
        model = page
        sync.setPresence(presence(onPage: true))

        await library.refresh()
        guard !_Concurrency.Task.isCancelled, model === page else { return }
        await library.refreshPages(notebookID: notebookID)
        guard !_Concurrency.Task.isCancelled, model === page else { return }
        applyFreshTarget()
        await reconcileIfNeeded()
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
        await sync.reconcile(page: model, binding: binding)
        isReconciling = false
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
