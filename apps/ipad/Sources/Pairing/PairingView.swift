import SwiftUI

/// Kopplung mit dem Mac (07-UX §4.1, F-INK-13).
/// Reihenfolge der Wege nach VERTRAEGE §12 (H-5): QR-Code zuerst, Bonjour und Adresse als Ausweg.
struct PairingView: View {
    let controller: PairingController

    @State private var browser = MacBrowser()
    @State private var manualAddress = ""
    @State private var code = ""
    @State private var showsScanner = false
    @State private var resolvingMacID: String?

    var body: some View {
        NavigationStack {
            Form {
                introSection
                if let error = controller.lastError {
                    errorSection(error)
                }
                switch controller.state {
                case .idle:
                    qrSection
                    foundMacsSection
                    manualSection
                case .requesting:
                    progressSection("Frage beim Mac an …")
                case .awaitingCode(let endpoint, _):
                    codeSection(endpoint: endpoint)
                case .confirming:
                    progressSection("Kopple …")
                case .paired:
                    progressSection("Gekoppelt")
                }
            }
            .navigationTitle("Mit dem Mac koppeln")
        }
        .onAppear { browser.start() }
        .onDisappear { browser.stop() }
        .sheet(isPresented: $showsScanner) {
            scannerSheet
        }
    }

    private var introSection: some View {
        Section {
            Text("Öffne am Mac Studien-Gehirn, dann Einstellungen → Geräte, und starte die Kopplung. Der Mac zeigt einen QR-Code und einen Code mit sechs Ziffern.")
        }
    }

    private func errorSection(_ error: ConnectionError) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                Text(error.title).font(.headline)
                Text(error.advice).font(.subheadline).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
        }
    }

    private var qrSection: some View {
        Section {
            Button {
                showsScanner = true
            } label: {
                Label("QR-Code scannen", systemImage: "qrcode.viewfinder")
            }
        } footer: {
            Text("Empfohlen. Das iPad verbindet sich direkt mit deinem Mac.")
        }
    }

    private var foundMacsSection: some View {
        Section {
            if browser.macs.isEmpty {
                HStack(spacing: 12) {
                    if browser.problem == nil {
                        ProgressView()
                    }
                    Text(browser.problem?.title ?? "Suche deinen Mac …")
                        .foregroundStyle(.secondary)
                }
                if let problem = browser.problem {
                    Text(problem.advice).font(.footnote).foregroundStyle(.secondary)
                }
            } else {
                ForEach(browser.macs) { mac in
                    Button {
                        choose(mac)
                    } label: {
                        HStack {
                            Label(mac.name, systemImage: "desktopcomputer")
                            Spacer()
                            if resolvingMacID == mac.id {
                                ProgressView()
                            }
                        }
                    }
                    .disabled(resolvingMacID != nil)
                }
            }
        } header: {
            Text("Im WLAN gefunden")
        } footer: {
            Text("Der Name im WLAN ist nicht geprüft. Vergleiche ihn mit deinem Mac.")
        }
    }

    private var manualSection: some View {
        Section {
            TextField("192.168.1.20:4710", text: $manualAddress)
                .keyboardType(.numbersAndPunctuation)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("IP-Adresse des Macs")
            Button("Verbinden") {
                connectManually()
            }
            .disabled(manualAddress.trimmingCharacters(in: .whitespaces).isEmpty)
        } header: {
            Text("Adresse von Hand")
        } footer: {
            Text("Der Mac zeigt seine Adresse neben dem Code an.")
        }
    }

    private func codeSection(endpoint: CoreEndpoint) -> some View {
        Section {
            TextField("Code vom Mac", text: $code)
                .keyboardType(.numberPad)
                .font(.title2.monospacedDigit())
                .accessibilityLabel("Code mit sechs Ziffern")
            Button("Koppeln") {
                let entered = code
                _Concurrency.Task { await controller.submit(code: entered) }
            }
            .disabled(PairingInput.normalizedCode(code) == nil)
            Button("Abbrechen", role: .cancel) {
                code = ""
                controller.cancel()
            }
        } header: {
            Text("Verbunden mit \(endpoint.displayText)")
        } footer: {
            Text("Gib die sechs Ziffern ein, die dein Mac anzeigt.")
        }
    }

    private func progressSection(_ text: String) -> some View {
        Section {
            HStack(spacing: 12) {
                ProgressView()
                Text(text)
            }
        }
    }

    private var scannerSheet: some View {
        NavigationStack {
            QRScannerScreen { payload in
                showsScanner = false
                handleScanned(payload)
            }
            .navigationTitle("QR-Code scannen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") { showsScanner = false }
                }
            }
        }
    }

    private func handleScanned(_ payload: String) {
        guard let link = PairingLink(qrPayload: payload) else {
            controller.report(.invalidPairingLink)
            return
        }
        _Concurrency.Task { await controller.pair(with: link) }
    }

    private func connectManually() {
        guard let endpoint = CoreEndpoint(userInput: manualAddress) else {
            controller.report(.invalidAddress)
            return
        }
        code = ""
        _Concurrency.Task { await controller.start(endpoint: endpoint) }
    }

    private func choose(_ mac: DiscoveredMac) {
        resolvingMacID = mac.id
        code = ""
        _Concurrency.Task {
            let endpoint = await MacResolver.resolve(mac)
            resolvingMacID = nil
            guard let endpoint else {
                controller.report(.macNotResolved)
                return
            }
            await controller.start(endpoint: endpoint)
        }
    }
}
