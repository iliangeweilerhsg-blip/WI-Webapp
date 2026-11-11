import SwiftUI
import UIKit

@main
struct StudienGehirnApp: App {
    @State private var model = AppModel.live()

    var body: some Scene {
        WindowGroup {
            if AppEnvironment.isRunningTests {
                // Unit-Tests laufen in der App: keine Suche im Netz, keine Oberfläche
                Color.clear
            } else {
                RootView(model: model)
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
        AppModel(
            client: CoreClient(transport: URLSessionTransport()),
            tokenStore: KeychainTokenStore(),
            macStore: DefaultsPairedMacStore(),
            deviceName: UIDevice.current.name,
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
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
