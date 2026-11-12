// swift-tools-version: 6.0
// Mac-Helfer `sg-tunnel` (UX-12, PR 3): nimmt TLS-PSK-Verbindungen vom iPad an (gemeinsames WLAN und Wi-Fi
// peer-to-peer) und reicht sie byte-genau an den Tunnel-Eingang des Core weiter (Unix-Socket).
// Bauen (vom Repo-Ordner aus): swift build -c release --package-path apps/mac-tunnel
// Kein Apple-Konto nötig, keine fremden Abhängigkeiten. `sg start` baut und startet den Helfer selbst.
import PackageDescription

let package = Package(
    name: "sg-tunnel",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "sg-tunnel", targets: ["sg-tunnel"])
    ],
    targets: [
        // Schlüssel- und Namensableitung, TLS-PSK-Optionen. Dieselben Quelldateien bindet später die iPad-App ein
        // (PR 4, apps/ipad/project.yml), darum Swift-6-Sprachmodus, überall `public` und nirgends ein bloßes `Task`.
        .target(name: "TunnelShared"),
        // Schlüsseldatei, Listener je Gerät, Weiterleitung zum Unix-Socket, Zustandsdatei. Nur am Mac, Sprachmodus 5
        // hält die Netzwerk-Rückrufe einfach (wie beim Spike S6).
        .target(
            name: "TunnelKit",
            dependencies: ["TunnelShared"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .executableTarget(
            name: "sg-tunnel",
            dependencies: ["TunnelKit", "TunnelShared"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "TunnelSharedTests",
            dependencies: ["TunnelShared"]
        ),
        .testTarget(
            name: "TunnelKitTests",
            dependencies: ["TunnelKit", "TunnelShared"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
