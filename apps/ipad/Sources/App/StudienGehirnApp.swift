import SwiftUI
import UIKit

@main
struct StudienGehirnApp: App {
    @State private var model = AppModel.live()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            if AppEnvironment.isRunningTests {
                // Unit-Tests laufen in der App: keine Suche im Netz, keine Oberfläche
                Color.clear
            } else {
                RootView(model: model)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                // Zurück im Vordergrund: Weiterleiter neu starten (neuer Port, WLAN zuerst), Wartezeit überspringen,
                // tote Verbindung früh erkennen
                model.appBecameActive()
            case .background:
                // Im Hintergrund enden Weiterleiter und Verbindungen (UX-12 PR 4)
                model.appWentToBackground()
            default:
                break
            }
        }
    }
}

enum AppEnvironment {
    static var isRunningTests: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
            || NSClassFromString("XCTestCase") != nil
    }
}

extension AppModel {
    /// Die echte App: URLSession, Schlüsselbund, UserDefaults, Tunnel zum Mac
    static func live() -> AppModel {
        let tokenStore = KeychainTokenStore()
        let tunnelKeyStore = KeychainTunnelKeyStore()
        // Wegewahl zum Mac (UX-12 PR 4): Von nun an geht jede Anfrage mit Token an den lokalen Weiterleiter und durch den
        // beglaubigten Tunnel, nie an eine IP-Adresse im Netz. Unit-Tests laufen in der App: kein Netz, kein Weiterleiter.
        let route: MacRoute? =
            AppEnvironment.isRunningTests
            ? nil
            : MacRoute(
                keys: tunnelKeyStore, dialer: NetworkTunnelDialer(), paths: SystemPathWatcher(),
                forwarder: LocalForwarder())
        let client = CoreClient(transport: URLSessionTransport(), routing: route)
        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        // Unit-Tests laufen in der App: keine Dateien und keine Verbindung
        var sync: SyncEngine?
        var library: InkLibraryService?
        if !AppEnvironment.isRunningTests {
            let store = FileInkLibraryStore.standard()
            let engine = SyncEngine.live(
                client: client, tokenStore: tokenStore, appVersion: appVersion, library: store)
            sync = engine
            let service = InkLibraryService(
                store: store, sync: engine, client: client, pageStore: FileInkPageStore.standard())
            library = service
            service.slides = SlideSupport.live(client: client, engine: engine, library: service)
            service.attachNotebookChanges()
        }
        return AppModel(
            client: client,
            tokenStore: tokenStore,
            macStore: DefaultsPairedMacStore(),
            deviceName: UIDevice.current.name,
            appVersion: appVersion,
            sync: sync,
            library: library,
            tunnelKeyStore: tunnelKeyStore,
            routing: route
        )
    }
}

/// Gekoppelt → Startbildschirm, sonst Kopplung
struct RootView: View {
    let model: AppModel

    var body: some View {
        switch model.phase {
        case .unpaired:
            PairingView(controller: model.pairing)
        case .paired(let mac):
            HomeView(model: model, mac: mac)
        }
    }
}
