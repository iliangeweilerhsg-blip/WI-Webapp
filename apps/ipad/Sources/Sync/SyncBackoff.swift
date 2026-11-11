import Foundation

/// Wartezeit vor dem Neuverbinden (VERTRAEGE §11.2, §11.4): 1, 2, 4, 8, 16, 30, 30 … Sekunden,
/// dazu 0 bis 25 % Zufall. Nach einem `ack` oder dem ersten `pong` beginnt die Folge von vorn.
struct SyncBackoff: Equatable, Sendable {
    static let firstDelay = 1.0
    static let maxDelay = 30.0
    static let maxJitter = 0.25

    private(set) var attempt = 0

    init() {}

    /// Die Wartezeit ohne Zufall für den aktuellen Versuch
    var baseDelay: Double {
        // Ab Versuch 5 ist 2^attempt schon über der Grenze; der Exponent bleibt klein, damit nichts überläuft
        let exponent = min(attempt, 10)
        return min(SyncBackoff.maxDelay, SyncBackoff.firstDelay * Double(1 << exponent))
    }

    /// Liefert die nächste Wartezeit und zählt weiter
    /// - Parameter jitter: Zufallszahl in 0 ..< 1
    mutating func next(jitter: Double) -> Duration {
        let clamped = min(max(jitter, 0), 1)
        let seconds = baseDelay * (1 + SyncBackoff.maxJitter * clamped)
        attempt += 1
        return .milliseconds(Int((seconds * 1000).rounded()))
    }

    mutating func reset() {
        attempt = 0
    }
}
