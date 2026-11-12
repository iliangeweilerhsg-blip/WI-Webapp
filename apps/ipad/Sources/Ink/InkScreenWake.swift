import SwiftUI
import UIKit

/// Das iPad bleibt in einer laufenden Vorlesung wach (UX-305, Teil 1). Reine Regel, damit sie testbar ist.
enum ScreenWakePolicy {
    /// Wach bleiben nur, solange eine Vorlesung läuft, die Schreibfläche zu sehen ist und die App im Vordergrund ist.
    /// Sonst gilt wieder die Systemeinstellung.
    static func shouldStayAwake(lectureRunning: Bool, writingSurfaceVisible: Bool, appActive: Bool) -> Bool {
        lectureRunning && writingSurfaceVisible && appActive
    }

    /// Ohne Verbindung weiß das iPad nicht, ob die Vorlesung noch läuft (Karte „Lief zuletzt“, UX-57). Endet sie,
    /// während das iPad offline ist, bliebe der Bildschirm sonst an, bis jemand die Seite verlässt. Darum gilt sie
    /// offline nur noch so lange ab der letzten Meldung (oder dem Abriss) als laufend.
    static let offlineGrace: TimeInterval = 10 * 60

    /// Zählt die gemeldete Vorlesung fürs Wachhalten: online immer, offline nur innerhalb von `offlineGrace`
    static func lectureCounts(running: Bool, isOnline: Bool, reportedAt: Date?, now: Date) -> Bool {
        guard running else { return false }
        return isOnline || offlineGraceLeft(running: true, isOnline: false, reportedAt: reportedAt, now: now) != nil
    }

    /// Restzeit der Frist ohne Verbindung. `nil`, wenn nichts nachzuprüfen ist: online, ohne Vorlesung oder abgelaufen.
    static func offlineGraceLeft(running: Bool, isOnline: Bool, reportedAt: Date?, now: Date) -> TimeInterval? {
        guard running, !isOnline, let reportedAt else { return nil }
        let left = offlineGrace - now.timeIntervalSince(reportedAt)
        return left > 0 ? left : nil
    }
}

/// Wachhalten an der Schreibfläche (UX-305): Sperre nur, solange eine Vorlesung läuft, die Fläche zu sehen und die App
/// aktiv ist. Beim Verlassen, im Hintergrund, am Ende der Vorlesung und nach der Frist ohne Verbindung wird sie
/// freigegeben. Eigener Modifier, damit die Kette in `InkPageView.body` nicht wächst.
struct InkScreenWakeModifier: ViewModifier {
    let library: InkLibraryService

    @Environment(\.scenePhase) private var scenePhase
    @State private var controller = ScreenWakeController()
    /// Zwischen `onAppear` und `onDisappear`
    @State private var isOnScreen = false

    /// Schlüssel für die Aufgabe, die nach der Frist ohne Verbindung freigibt
    private struct GraceKey: Equatable {
        var isOnline: Bool
        var reportedAt: Date?
    }

    private var isOnline: Bool { library.sync.state == .online }

    func body(content: Content) -> some View {
        content
            .task(id: GraceKey(isOnline: isOnline, reportedAt: library.runningReportedAt)) {
                await releaseAfterOfflineGrace()
            }
            .onAppear {
                isOnScreen = true
                update(visible: true)
            }
            .onDisappear {
                isOnScreen = false
                controller.release()
            }
            .onChange(of: library.running?.id) { _, _ in
                update()
            }
            .onChange(of: scenePhase) { _, phase in
                update(phase: phase)
            }
    }

    /// Ohne Verbindung gilt die Vorlesung nur eine Frist lang als laufend: danach neu entscheiden (und freigeben)
    private func releaseAfterOfflineGrace() async {
        update()
        while let left = ScreenWakePolicy.offlineGraceLeft(
            running: library.running != nil, isOnline: isOnline, reportedAt: library.runningReportedAt, now: Date())
        {
            try? await _Concurrency.Task.sleep(for: .seconds(left + 1))
            if _Concurrency.Task.isCancelled { return }
        }
        update()
    }

    /// Ohne Angabe gelten `isOnScreen` und `scenePhase`
    private func update(visible: Bool? = nil, phase: ScenePhase? = nil) {
        let lecture = ScreenWakePolicy.lectureCounts(
            running: library.running != nil, isOnline: isOnline, reportedAt: library.runningReportedAt, now: Date())
        controller.update(
            lectureRunning: lecture, writingSurfaceVisible: visible ?? isOnScreen,
            appActive: (phase ?? scenePhase) == .active)
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
