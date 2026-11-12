import SwiftUI

/// Notizbücher je Modul auf dem Startbildschirm (07-UX §4.2, UX-30). Die Wahl ist frei und geht auch ohne
/// Verbindung, aus dem lokalen Stand. Die Ansicht bleibt dünn: Alles Wichtige steht in `InkLibraryService`.
struct LibraryListView: View {
    let library: InkLibraryService
    /// Der Sync ist online (sonst steht die ruhige Zeile „Offline · Stand von …“ da)
    let isOnline: Bool

    @State private var createModuleID: String?
    @State private var showsCreate = false
    @State private var newTitle = ""
    /// Das eben angelegte Notizbuch: Die Liste öffnet es (UX-56)
    @State private var openedNotebookID: String?
    @State private var createFailed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let running = library.running, let notebookID = running.notebookID,
                let notebook = library.notebook(notebookID)
            {
                NavigationLink {
                    InkPageView(library: library, notebookID: notebookID)
                } label: {
                    RunningCard(
                        title: LibraryTexts.runningTitle(
                            moduleName: library.moduleName(running.moduleID) ?? "Vorlesung",
                            isOnline: isOnline, reportedAt: library.runningReportedAt),
                        notebookTitle: notebook.title)
                }
                .buttonStyle(.plain)
            }
            if createFailed {
                Text(LibraryTexts.createFailedLine)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if !isOnline {
                Text(LibraryTexts.offlineLine(refreshedAt: library.refreshedAt))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            let modules = library.modules
            if modules.isEmpty {
                Text(LibraryTexts.emptyText(isOnline: isOnline))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            }
            ForEach(modules) { module in
                ModuleCard(
                    library: library,
                    module: module,
                    onCreate: {
                        createModuleID = module.id
                        newTitle = ""
                        createFailed = false
                        showsCreate = true
                    })
            }
        }
        .task {
            // Beim Erscheinen auffrischen (höchstens alle 30 s). Ohne Verbindung bleibt der lokale Stand.
            await library.refresh()
        }
        .navigationDestination(item: $openedNotebookID) { notebookID in
            InkPageView(library: library, notebookID: notebookID)
        }
        .alert("Neues Notizbuch", isPresented: $showsCreate) {
            TextField("Titel", text: $newTitle)
            Button("Anlegen") {
                if let moduleID = createModuleID {
                    if let created = library.createNotebook(moduleID: moduleID, title: newTitle) {
                        openedNotebookID = created.id
                    } else {
                        createFailed = true
                    }
                }
                newTitle = ""
            }
            .disabled(!canCreate)
            Button("Abbrechen", role: .cancel) {
                newTitle = ""
            }
        } message: {
            if let moduleID = createModuleID, let name = library.moduleName(moduleID) {
                Text(LibraryTexts.createMessage(moduleName: name, isDuplicate: isDuplicate))
            }
        }
    }
}

extension LibraryListView {
    /// Der Titel gibt es im Modul schon (UX-56)
    fileprivate var isDuplicate: Bool {
        guard let moduleID = createModuleID else { return false }
        return library.hasNotebook(inModule: moduleID, titled: newTitle)
    }

    fileprivate var canCreate: Bool {
        LibraryTexts.canCreate(title: newTitle, isDuplicate: isDuplicate)
    }
}

/// Texte der Bibliothek. Reine Funktionen, damit sie testbar sind.
enum LibraryTexts {
    /// Ruhige Zeile, wenn das Anlegen nicht gespeichert werden konnte (UX-56)
    static let createFailedLine = "Konnte nicht gespeichert werden"

    /// „Anlegen“ ist gesperrt bei leerem oder schon vergebenem Titel (UX-56)
    static func canCreate(title: String, isDuplicate: Bool) -> Bool {
        !isDuplicate && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Satz unter dem Titelfeld. Beim doppelten Titel sagt er, warum „Anlegen“ gesperrt ist.
    static func createMessage(moduleName: String, isDuplicate: Bool) -> String {
        isDuplicate
            ? "In \(moduleName) gibt es schon ein Notizbuch mit diesem Titel."
            : "Ein freies Notizbuch in \(moduleName)."
    }

    static func offlineLine(refreshedAt: Date?) -> String {
        guard let refreshedAt else { return "Offline" }
        return "Offline · Stand von \(refreshedAt.formatted(date: .abbreviated, time: .shortened))"
    }

    /// Titel der Karte zur Vorlesung. Ohne Verbindung ist es der letzte Stand, kein „Läuft gerade“ (UX-57).
    static func runningTitle(
        moduleName: String, isOnline: Bool, reportedAt: Date?, calendar: Calendar = .current
    ) -> String {
        if isOnline { return "Läuft gerade: \(moduleName)" }
        guard let reportedAt else { return "Lief zuletzt: \(moduleName)" }
        return "Lief zuletzt: \(moduleName) · Stand \(clockText(reportedAt, calendar: calendar))"
    }

    /// „10:42“
    static func clockText(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02ld:%02ld", parts.hour ?? 0, parts.minute ?? 0)
    }

    static func emptyText(isOnline: Bool) -> String {
        isOnline
            ? "Noch keine Module. Lege am Mac ein Modul an."
            : "Noch keine Notizbücher geladen. Verbinde das iPad einmal mit dem Mac."
    }
}

private struct ModuleCard: View {
    let library: InkLibraryService
    let module: LibraryModule
    let onCreate: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(module.name).font(.headline)
            ForEach(library.notebooks(inModule: module.id)) { notebook in
                NavigationLink {
                    InkPageView(library: library, notebookID: notebook.id)
                } label: {
                    HStack {
                        Image(systemName: "book.closed")
                        Text(notebook.title)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.footnote)
                            .foregroundStyle(.tertiary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(module.name), \(notebook.title)")
            }
            Button {
                onCreate()
            } label: {
                Label("Notizbuch", systemImage: "plus")
                    .frame(minHeight: 44, alignment: .leading)
            }
            .accessibilityLabel("Neues Notizbuch in \(module.name)")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct RunningCard: View {
    let title: String
    let notebookTitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.headline)
            Text(notebookTitle).font(.subheadline).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color.accentColor.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}
