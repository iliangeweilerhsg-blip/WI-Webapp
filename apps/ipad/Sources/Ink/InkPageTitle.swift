import Foundation

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

    private static func clean(_ name: String?) -> String? {
        guard let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }
}
