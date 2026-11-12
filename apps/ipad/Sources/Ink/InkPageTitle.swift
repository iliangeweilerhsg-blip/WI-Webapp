import Foundation
import Observation

/// Texte der Schreibfläche, die vom Modulnamen abhängen (UX-19). Reine Funktionen, damit sie testbar sind.
enum InkPageTitle {
    /// Titel der Schreibfläche. Ohne Namen (alte Bindung, Core nicht erreicht) bleibt es bei „Vorlesung“.
    static func text(moduleName: String?) -> String {
        clean(moduleName) ?? "Vorlesung"
    }

    /// Zeile ohne Verbindung: Sie sagt, wohin geschrieben wird
    static func offlineLine(moduleName: String?) -> String {
        if let name = clean(moduleName) {
            return "Offline · schreibt in \(name)"
        }
        return "Offline · schreibt ins zuletzt benutzte Notizbuch"
    }

    /// Titel der Schreibfläche mit Notizbuch: „<Modul> · <Notizbuch>“ (UX-30)
    static func text(moduleName: String?, notebookTitle: String?) -> String {
        let module = clean(moduleName)
        let notebook = clean(notebookTitle)
        if let module, let notebook {
            return "\(module) · \(notebook)"
        }
        return module ?? notebook ?? "Vorlesung"
    }

    /// Zeile ohne Verbindung: nennt Modul und Notizbuch. Warten Änderungen (UX-49), steht die Zahl dabei. Im Modus
    /// „Auf Folie“ sagt sie, dass die Folie gerade nicht mitläuft (UX-57).
    static func offlineLine(
        moduleName: String?, notebookTitle: String?, pendingChanges: Int = 0, slideNotFollowing: Bool = false
    ) -> String {
        let module = clean(moduleName)
        let notebook = clean(notebookTitle)
        var line: String
        if let module, let notebook {
            line = "Offline · schreibt in \(module) · \(notebook)"
        } else {
            line = offlineLine(moduleName: module ?? notebook)
        }
        if let waiting = pendingPhrase(pendingChanges) {
            line += " · \(waiting)"
        }
        if slideNotFollowing {
            line += " · Folie folgt gerade nicht"
        }
        return line
    }

    /// „1 Änderung wartet“ bzw. „37 Änderungen warten“, `nil` bei 0
    static func pendingPhrase(_ count: Int) -> String? {
        guard count > 0 else { return nil }
        return count == 1 ? "1 Änderung wartet" : "\(count) Änderungen warten"
    }

    /// Text der Infozeile, wenn nach dem Warten alles am Mac angekommen ist (UX-49)
    static let allSyncedLine = "Alles am Mac"

    private static func clean(_ name: String?) -> String? {
        guard let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }
}

/// Ein Hinweis, der nach `show()` für eine feste Zeit sichtbar bleibt. Das Warten ist einspritzbar, Tests brauchen
/// keine echte Zeit (`settle()` wartet auf das Ende).
@MainActor
@Observable
final class TimedNotice {
    private(set) var isVisible = false

    @ObservationIgnored private let duration: Duration
    @ObservationIgnored private let sleep: @MainActor (Duration) async throws -> Void
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var task: _Concurrency.Task<Void, Never>?

    init(
        duration: Duration,
        sleep: @escaping @MainActor (Duration) async throws -> Void = { try await _Concurrency.Task.sleep(for: $0) }
    ) {
        self.duration = duration
        self.sleep = sleep
    }

    /// Zeigt den Hinweis. Ein erneuter Aufruf startet die Frist neu.
    func show() {
        task?.cancel()
        generation += 1
        let mine = generation
        isVisible = true
        task = _Concurrency.Task { [weak self] in
            guard let self else { return }
            do {
                try await self.sleep(self.duration)
            } catch {
                return
            }
            guard self.generation == mine else { return }
            self.isVisible = false
        }
    }

    /// Blendet sofort aus
    func hide() {
        task?.cancel()
        task = nil
        generation += 1
        isVisible = false
    }

    /// Wartet, bis die laufende Frist zu Ende ist (für Tests)
    func settle() async {
        await task?.value
    }
}

/// „Alles am Mac“ (UX-49): Warteten Änderungen und der Sync ist wieder online mit 0 Wartenden, steht der Hinweis 3 s da.
@MainActor
@Observable
final class AllSyncedNotice {
    static let duration: Duration = .seconds(3)

    let timer: TimedNotice
    @ObservationIgnored private var hadPending = false

    var isVisible: Bool { timer.isVisible }

    init(
        sleep: @escaping @MainActor (Duration) async throws -> Void = { try await _Concurrency.Task.sleep(for: $0) }
    ) {
        timer = TimedNotice(duration: AllSyncedNotice.duration, sleep: sleep)
    }

    /// Bei jeder Änderung von Sync-Zustand oder Zahl der Wartenden aufrufen
    func update(isOnline: Bool, pending: Int) {
        if pending > 0 {
            hadPending = true
            timer.hide()
        } else if isOnline {
            if hadPending {
                hadPending = false
                timer.show()
            }
        } else {
            // Offline zeigt die Offline-Zeile
            timer.hide()
        }
    }
}
