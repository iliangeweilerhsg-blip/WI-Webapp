import Foundation
// @preconcurrency: Ältere SDKs kennzeichnen die Network-Typen noch nicht als Sendable
@preconcurrency import Network

// Netzwechsel und WLAN-Zustand (UX-12, PR 4; Plan §5.3 „NetworkPathWatching“).
// Der Monitor setzt nur den gemerkten Weg zurück (WLAN zuerst) und liefert einen Hinweis für den Text. Er schaltet nie
// die Anzeige um und gatet nie einen Verbindungsversuch: Ob „WLAN aus“ stimmt, lässt sich nur am Gerät prüfen (N8).

/// Meldet Netzwechsel. Eigenes Protokoll, damit Tests ohne `NWPathMonitor` laufen.
@MainActor
protocol NetworkPathWatching: AnyObject {
    /// Hat das iPad gerade keine WLAN-Schnittstelle? Nur ein Hinweis für den Text, kein Grund, nichts zu versuchen.
    var wifiLooksOff: Bool { get }
    /// Beginnt zu beobachten. `onChange` kommt bei jedem Netzwechsel (nicht für den ersten Stand).
    func start(onChange: @escaping @MainActor @Sendable () -> Void)
    func stop()
}

@MainActor
final class SystemPathWatcher: NetworkPathWatching {
    private(set) var wifiLooksOff = false

    private var monitor: NWPathMonitor?
    private var lastSignature: String?

    init() {}

    func start(onChange: @escaping @MainActor @Sendable () -> Void) {
        guard monitor == nil else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            // Schon hier in übertragbare Werte umwandeln: `NWPath` verlässt die Rückrufwarteschlange nicht
            let signature = SystemPathWatcher.signature(of: path)
            let hasWifi = path.availableInterfaces.contains { $0.type == .wifi }
            MainActor.assumeIsolated {
                guard let self else { return }
                self.wifiLooksOff = !hasWifi
                let changed = self.lastSignature != nil && self.lastSignature != signature
                self.lastSignature = signature
                if changed { onChange() }
            }
        }
        self.monitor = monitor
        // Hauptwarteschlange, also MainActor (wie bei `MacBrowser`)
        monitor.start(queue: .main)
    }

    func stop() {
        monitor?.pathUpdateHandler = nil
        monitor?.cancel()
        monitor = nil
        lastSignature = nil
    }

    /// Status, Schnittstellen und Gateways. awdl-Schnittstellen zählen nicht (sie kommen und gehen mit der
    /// Direktverbindung), die Gateways schon: Beim Wechsel zwischen zwei WLANs bleibt `en0`, das Gateway nicht.
    nonisolated static func signature(of path: NWPath) -> String {
        let interfaces = path.availableInterfaces
            .filter { $0.type == .wifi || $0.type == .wiredEthernet || $0.type == .cellular }
            .map { "\($0.name):\($0.type)" }
            .sorted()
        let gateways = path.gateways.map { "\($0)" }.sorted()
        return "\(path.status)|\(interfaces.joined(separator: ","))|\(gateways.joined(separator: ","))"
    }
}
