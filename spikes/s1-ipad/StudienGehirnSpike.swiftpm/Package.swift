// swift-tools-version: 5.9

// Achtung: In Swift Playgrounds verwaltete App-Manifest-Datei für Spike S1 + S3.
// Unterstützt sowohl das direkte Öffnen in Swift Playgrounds auf dem iPad (Weg A)
// als auch das Öffnen und Installieren über Xcode auf dem Mac (Weg B).

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "StudienGehirnSpike",
    platforms: [
        .iOS("17.0")
    ],
    products: [
        .iOSApplication(
            name: "StudienGehirnSpike",
            targets: ["AppModule"],
            bundleIdentifier: "de.studiengehirn.spike.s1",
            teamIdentifier: "",
            displayVersion: "1.0",
            bundleVersion: "1",
            appIcon: .placeholder(icon: .pencil),
            accentColor: .presetColor(.blue),
            supportedDeviceFamilies: [
                .pad
            ],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown
            ],
            capabilities: [
                .camera(purposeString: "Tafel-Fotos in der Vorlesung aufnehmen (Spike S1)"),
                .localNetwork(
                    purposeString: "Mac-Gegenstelle im lokalen WLAN finden und Striche spiegeln (Spike S1/S3)",
                    bonjourServiceTypes: ["_studiengehirn._tcp"]
                )
            ],
            additionalInfoPlistContentFilePath: "CustomInfo.plist"
        )
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: "Sources/AppModule"
        )
    ]
)
