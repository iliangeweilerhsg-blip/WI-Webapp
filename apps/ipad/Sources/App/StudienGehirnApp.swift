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
            // Zurück im Vordergrund: Wartezeit überspringen, tote Verbindung früh erkennen
            if phase == .active {
                model.sync?.kick()
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
    /// Die echte App: URLSession, Schlüsselbund, UserDefaults
    static func live() -> AppModel {
        let client = CoreClient(transport: URLSessionTransport())
        let tokenStore = KeychainTokenStore()
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
            library: library
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
