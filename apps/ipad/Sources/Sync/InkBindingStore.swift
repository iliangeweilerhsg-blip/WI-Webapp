import Foundation

/// Bindung eines Notizbuchs am Mac an eine Seite dieses iPads (E1: eine echte Seite je Notizbuch)
struct InkBinding: Codable, Equatable, Sendable {
    var notebookID: String
    var pageID: String
    var moduleID: String
    /// `page.create` ist eingereiht (oder gesendet)
    var pageCreated: Bool
    /// Seite und Core müssen abgeglichen werden (neue `db_epoch`)
    var needsReconcile: Bool
    /// Session, in der geschrieben wird (für `presence` und `page.create`), `nil` ohne
    var sessionID: String?
    /// Start dieser Session auf der Uhr des Mac, in ms
    var sessionStartMS: Int?

    /// Strom aller Operationen dieses Notizbuchs (VERTRAEGE §11.2)
    var stream: String { "notebook:\(notebookID)" }
}

/// Ablage der Bindungen. Schreibfehler werden nicht gemeldet: Der Stand liegt im Speicher und wird bei der
/// nächsten Änderung erneut geschrieben.
@MainActor
protocol InkBindingStore: AnyObject {
    /// Zuletzt verwendetes Notizbuch (für den Betrieb ohne Verbindung)
    var lastNotebookID: String? { get }
    /// `db_epoch` des Core beim letzten `welcome`
    var dbEpoch: String? { get }

    func binding(forNotebook notebookID: String) -> InkBinding?
    func binding(forPage pageID: String) -> InkBinding?
    /// Speichert die Bindung. `makeLast`: Das Notizbuch wird zum zuletzt verwendeten.
    func save(_ binding: InkBinding, makeLast: Bool)
    /// Verwirft die Bindung der Seite (`page.create` wurde abgelehnt)
    func removeBinding(forPage pageID: String)
    func setDBEpoch(_ epoch: String)
    /// Neue `db_epoch`: Alle Seiten müssen mit dem Core abgeglichen werden
    func markAllNeedReconcile()
    func clearNeedsReconcile(forPage pageID: String)
}

/// Inhalt von `Sync/bindings.json`
private struct InkBindingsFile: Codable {
    var bindings: [String: InkBinding] = [:]
    var lastNotebookID: String?
    var dbEpoch: String?
}

@MainActor
final class FileInkBindingStore: InkBindingStore {
    private let url: URL
    private var file: InkBindingsFile

    init(url: URL) {
        self.url = url
        if let data = try? Data(contentsOf: url),
            let decoded = try? JSONDecoder().decode(InkBindingsFile.self, from: data)
        {
            file = decoded
        } else {
            file = InkBindingsFile()
        }
    }

    var lastNotebookID: String? { file.lastNotebookID }
    var dbEpoch: String? { file.dbEpoch }

    func binding(forNotebook notebookID: String) -> InkBinding? {
        file.bindings[notebookID]
    }

    func binding(forPage pageID: String) -> InkBinding? {
        file.bindings.values.first { $0.pageID == pageID }
    }

    func save(_ binding: InkBinding, makeLast: Bool) {
        file.bindings[binding.notebookID] = binding
        if makeLast {
            file.lastNotebookID = binding.notebookID
        }
        persist()
    }

    func removeBinding(forPage pageID: String) {
        for (notebookID, binding) in file.bindings where binding.pageID == pageID {
            file.bindings[notebookID] = nil
            if file.lastNotebookID == notebookID {
                file.lastNotebookID = nil
            }
        }
        persist()
    }

    func setDBEpoch(_ epoch: String) {
        guard file.dbEpoch != epoch else { return }
        file.dbEpoch = epoch
        persist()
    }

    func markAllNeedReconcile() {
        for key in file.bindings.keys {
            file.bindings[key]?.needsReconcile = true
        }
        persist()
    }

    func clearNeedsReconcile(forPage pageID: String) {
        for key in file.bindings.keys where file.bindings[key]?.pageID == pageID {
            file.bindings[key]?.needsReconcile = false
        }
        persist()
    }

    private func persist() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(file) else { return }
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }
}
