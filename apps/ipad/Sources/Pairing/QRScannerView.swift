import AVFoundation
import SwiftUI
import Vision
import VisionKit

/// Kamera, die QR-Codes liest. Nur auf echter Hardware nutzbar, im Simulator gibt es keine Kamera.
struct QRScannerView: UIViewControllerRepresentable {
    /// Text des ersten erkannten QR-Codes
    let onPayload: (String) -> Void

    /// Gerät hat eine passende Kamera und der Zugriff ist erlaubt
    static var isUsable: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onPayload: onPayload)
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {}

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let onPayload: (String) -> Void
        private var delivered = false

        init(onPayload: @escaping (String) -> Void) {
            self.onPayload = onPayload
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didAdd addedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            guard !delivered else { return }
            for item in addedItems {
                if case .barcode(let barcode) = item, let payload = barcode.payloadStringValue {
                    delivered = true
                    onPayload(payload)
                    return
                }
            }
        }
    }
}

/// Fragt zuerst nach der Kamera und zeigt dann den Scanner oder einen ruhigen Hinweis
struct QRScannerScreen: View {
    let onPayload: (String) -> Void

    /// `nil`, solange die Frage nach der Kamera offen ist
    @State private var cameraAllowed: Bool?

    var body: some View {
        Group {
            if cameraAllowed == nil {
                ProgressView()
            } else if cameraAllowed == true && QRScannerView.isUsable {
                QRScannerView(onPayload: onPayload)
                    .ignoresSafeArea()
            } else {
                ContentUnavailableView(
                    "Kamera nicht verfügbar",
                    systemImage: "camera",
                    description: Text(
                        "Erlaube die Kamera unter Einstellungen → Studien-Gehirn. Oder gib Adresse und Code von Hand ein."
                    )
                )
            }
        }
        .task {
            cameraAllowed = await AVCaptureDevice.requestAccess(for: .video)
        }
    }
}
