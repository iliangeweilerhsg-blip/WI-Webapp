import SwiftUI
import UIKit

/// Das iPad bleibt in einer laufenden Vorlesung wach (UX-305, Teil 1). Reine Regel, damit sie testbar ist.
enum ScreenWakePolicy {
    /// Wach bleiben nur, solange eine Vorlesung läuft, die Schreibfläche zu sehen ist und die App im Vordergrund ist.
    /// Sonst gilt wieder die Systemeinstellung.
    static func shouldStayAwake(lectureRunning: Bool, writingSurfaceVisible: Bool, appActive: Bool) -> Bool {
        lectureRunning && writingSurfaceVisible && appActive
    }
}

/// Schaltstelle für `UIApplication.isIdleTimerDisabled`, einspritzbar für Tests
@MainActor
protocol IdleTimerSwitch: AnyObject {
    var isIdleTimerDisabled: Bool { get set }
}

@MainActor
final class SystemIdleTimerSwitch: IdleTimerSwitch {
    var isIdleTimerDisabled: Bool {
        get { UIApplication.shared.isIdleTimerDisabled }
        set { UIApplication.shared.isIdleTimerDisabled = newValue }
    }
}

/// Setzt die Sperre nur, wenn die Regel es verlangt, und gibt sie in jedem anderen Fall frei. Fasst den Schalter
/// nicht an, solange sie ihn nie gesetzt hat.
@MainActor
final class ScreenWakeController {
    private let timer: any IdleTimerSwitch
    private(set) var holdsWake = false

    init(timer: any IdleTimerSwitch = SystemIdleTimerSwitch()) {
        self.timer = timer
    }

    func update(lectureRunning: Bool, writingSurfaceVisible: Bool, appActive: Bool) {
        let wanted = ScreenWakePolicy.shouldStayAwake(
            lectureRunning: lectureRunning, writingSurfaceVisible: writingSurfaceVisible, appActive: appActive)
        if wanted {
            timer.isIdleTimerDisabled = true
            holdsWake = true
        } else {
            release()
        }
    }

    /// Beim Verlassen und im Hintergrund immer zurücksetzen
    func release() {
        guard holdsWake else { return }
        timer.isIdleTimerDisabled = false
        holdsWake = false
    }
}
