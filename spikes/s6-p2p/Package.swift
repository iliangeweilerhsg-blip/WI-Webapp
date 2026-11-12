// swift-tools-version: 6.0
// Spike S6 (UX-12, PR 1): Mac-Gegenstelle für die Direktverbindung per Wi-Fi peer-to-peer.
// Bauen und starten (vom Repo-Ordner aus): swift run -c release --package-path spikes/s6-p2p sg-spike
// Kein Apple-Konto nötig, keine fremden Abhängigkeiten.
import PackageDescription

let package = Package(
    name: "sg-spike",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "sg-spike", targets: ["sg-spike"])
    ],
    targets: [
        // Protokoll, Schlüsselableitung, TLS-Optionen und Client. Dieselben Quelldateien bindet die iPad-App ein
        // (apps/ipad/project.yml), darum Swift-6-Sprachmodus wie dort.
        .target(name: "SpikeShared"),
        // Server mit den festen Befehlen. Nur am Mac, Sprachmodus 5 hält die Netzwerk-Rückrufe einfach.
        .target(
            name: "SpikeServerKit",
            dependencies: ["SpikeShared"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .executableTarget(
            name: "sg-spike",
            dependencies: ["SpikeServerKit", "SpikeShared"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "SpikeSharedTests",
            dependencies: ["SpikeShared"]
        ),
        .testTarget(
            name: "SpikeServerKitTests",
            dependencies: ["SpikeServerKit", "SpikeShared"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
