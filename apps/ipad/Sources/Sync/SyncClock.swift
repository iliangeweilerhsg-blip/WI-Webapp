import Foundation

/// Uhrabgleich mit dem Mac (VERTRAEGE §11.5, F-SYN-02): 5 × `time.ping`, Versatz = Median von
/// `ts − (t0 + t1) / 2` mit `t1` = lokale Empfangszeit. Alle Zeiten in ms.
struct SyncClock: Equatable, Sendable {
    /// So viele Messungen gehören zu einem Abgleich
    static let sampleCount = 5

    struct Sample: Equatable, Sendable {
        /// Server − Client
        let offset: Int
        /// Umlaufzeit
        let rtt: Int
    }

    private(set) var samples: [Sample] = []

    init() {}

    var isComplete: Bool { samples.count >= SyncClock.sampleCount }

    mutating func add(t0: Int, t1: Int, ts: Int) {
        samples.append(Sample(offset: ts - (t0 + t1) / 2, rtt: max(0, t1 - t0)))
    }

    mutating func reset() {
        samples.removeAll()
    }

    /// Median der Versätze, `nil` ohne Messung
    var offsetMS: Int? {
        SyncClock.median(samples.map(\.offset))
    }

    /// Median der Umlaufzeiten, `nil` ohne Messung
    var rttMS: Int? {
        SyncClock.median(samples.map(\.rtt))
    }

    /// Bei gerader Anzahl der Mittelwert der beiden mittleren Werte (gerundet)
    static func median(_ values: [Int]) -> Int? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let middle = sorted.count / 2
        if sorted.count % 2 == 1 {
            return sorted[middle]
        }
        return Int((Double(sorted[middle - 1] + sorted[middle]) / 2).rounded())
    }
}
