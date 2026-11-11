import Foundation

/// Gleicht den lokalen Strichbestand einer Seite mit dem Stand des Core ab (VERTRAEGE §11.1 „Bei reset“).
/// Das Ergebnis sind dieselben Änderungen wie beim Zeichnen: `stroke.add` ist ein Upsert über `client_id`,
/// darum ist ein überflüssiges Senden harmlos.
enum InkReconciler {
    /// - Parameters:
    ///   - local: alle Striche der Seite auf dem iPad
    ///   - server: `GET /pages/{id}/strokes`, `nil` = Seite unbekannt (404)
    /// - Returns: erst alle `upsert`, dann ein `remove` mit den überzähligen Server-Strichen (sortiert)
    static func plan(local: [Stroke], server: [Stroke]?) -> [InkStrokeChange] {
        guard let server else {
            return local.map { .upsert($0) }
        }
        var onServer: [String: Stroke] = [:]
        for stroke in server {
            onServer[stroke.clientID] = stroke
        }
        var changes: [InkStrokeChange] = []
        var localIDs = Set<String>()
        for stroke in local {
            localIDs.insert(stroke.clientID)
            if let remote = onServer[stroke.clientID], isSame(stroke, remote) {
                continue
            }
            changes.append(.upsert(stroke))
        }
        let extra = onServer.keys.filter { !localIDs.contains($0) }.sorted()
        if !extra.isEmpty {
            changes.append(.remove(extra))
        }
        return changes
    }

    /// Gleicher Strich: Werkzeug, Ebene, Farbe, Breite, Transformation und Punkte stimmen überein.
    /// Zahlen vergleicht die Methode mit Toleranz: Der Core speichert `real` (float4).
    static func isSame(_ a: Stroke, _ b: Stroke) -> Bool {
        a.tool == b.tool
            && a.layer == b.layer
            && a.color.lowercased() == b.color.lowercased()
            && isClose(a.width, b.width)
            && a.transform.count == b.transform.count
            && zip(a.transform, b.transform).allSatisfy { isClose($0, $1) }
            && a.points == b.points
    }

    private static func isClose(_ a: Double, _ b: Double) -> Bool {
        abs(a - b) <= 1e-5 * max(1, abs(a), abs(b))
    }
}
