import SwiftUI

/// Startbildschirm (07-UX §4.2). Die Karten sind Platzhalter, bis Kalender, Wiederholung und
/// Notizbücher angebunden sind (T1-12 ff.). Echt ist hier nur der Verbindungsstatus.
struct HomeView: View {
    let model: AppModel
    let mac: PairedMac

    @State private var showsStatus = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    PlaceholderCard(
                        title: "Gleich",
                        text: "Deine nächste Vorlesung erscheint hier, sobald der Kalender angebunden ist."
                    )
                    PlaceholderCard(
                        title: "Jetzt sinnvoll",
                        text: "Vorschläge zum Wiederholen folgen später."
                    )
                    PlaceholderCard(
                        title: "Notizbücher",
                        text: "Deine Notizbücher je Modul erscheinen hier mit dem nächsten Schritt."
                    )
                }
                .padding()
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("Studien-Gehirn")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showsStatus = true
                    } label: {
                        ConnectionBadge(status: model.connection)
                    }
                    .popover(isPresented: $showsStatus) {
                        ConnectionDetailView(model: model, mac: mac)
                    }
                }
            }
        }
        .task {
            // Solange der Startbildschirm sichtbar ist, regelmäßig nachsehen.
            // Der Live-Sync (WebSocket) ersetzt das später.
            // Nach einem 401 ruht die Abfrage, bis neu gekoppelt ist. „Erneut prüfen“ fragt trotzdem.
            while !_Concurrency.Task.isCancelled {
                await model.pollConnection()
                try? await _Concurrency.Task.sleep(for: .seconds(15))
            }
        }
    }
}

private struct PlaceholderCard: View {
    let title: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline)
            Text(text).font(.subheadline).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}

/// „Mac ●“: grün verbunden, grau getrennt (F-INK-13). Ruhig, ohne Warnfarben.
struct ConnectionBadge: View {
    let status: ConnectionStatus

    var body: some View {
        HStack(spacing: 6) {
            Text("Mac")
            Circle()
                .fill(status == .connected ? Color.green : Color.gray)
                .frame(width: 10, height: 10)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(status == .connected ? "Mac verbunden" : "iPad nicht verbunden")
    }
}

/// Einzelheiten zur Verbindung: konkrete Ursache und nächster Schritt
struct ConnectionDetailView: View {
    let model: AppModel
    let mac: PairedMac

    @State private var confirmsUnpair = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(headline).font(.headline)
            if let detail = detail {
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
            Text("Mac: \(mac.endpoint.displayText)")
                .font(.footnote)
                .foregroundStyle(.secondary)

            Divider()

            Button("Erneut prüfen") {
                _Concurrency.Task { await model.checkConnection() }
            }
            if needsNewPairing {
                Button("Neu koppeln") {
                    _Concurrency.Task { await model.unpair() }
                }
            } else {
                Button("Kopplung aufheben", role: .destructive) {
                    confirmsUnpair = true
                }
            }
        }
        .padding()
        .frame(minWidth: 320, alignment: .leading)
        .confirmationDialog(
            "Kopplung aufheben?",
            isPresented: $confirmsUnpair,
            titleVisibility: .visible
        ) {
            Button("Aufheben", role: .destructive) {
                _Concurrency.Task { await model.unpair() }
            }
            Button("Abbrechen", role: .cancel) {}
        } message: {
            Text("Das iPad meldet sich am Mac ab. Ist der Mac gerade nicht erreichbar, entferne das iPad dort unter Einstellungen → Geräte.")
        }
    }

    private var headline: String {
        switch model.connection {
        case .unknown, .checking: return "Prüfe Verbindung …"
        case .connected: return "Mit dem Mac verbunden"
        case .disconnected(let error): return "iPad nicht verbunden: \(error.title)"
        }
    }

    private var detail: String? {
        if case .disconnected(let error) = model.connection {
            return error.advice
        }
        return nil
    }

    private var needsNewPairing: Bool {
        if case .disconnected(let error) = model.connection {
            return error.needsNewPairing
        }
        return false
    }
}
