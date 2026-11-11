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
                    // Vorläufiger Zugang zur Schreibfläche (T1-12). Die Notizbuchverwaltung folgt mit T1-13.
                    // Mit laufender Vorlesung erscheinen die Striche live am Mac (T1-14).
                    NavigationLink {
                        InkPageView(sync: model.sync)
                    } label: {
                        PlaceholderCard(
                            title: "Schreibfläche",
                            text: "Schreibe in das Notizbuch der laufenden Vorlesung. Ohne Verbindung wird lokal gepuffert."
                        )
                    }
                    .buttonStyle(.plain)
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
            // Solange der Live-Sync (WebSocket) online ist, ruht die Abfrage: Der Sync weiß es besser.
            // Nach einem 401 ruht sie ebenfalls, bis neu gekoppelt ist. „Erneut prüfen“ fragt trotzdem.
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

            if let sync = model.sync {
                SyncStatusRows(sync: sync)
            }

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

/// Stand des Sync: wartende Operationen, Fehlerablage, ggf. Hinweis zur App-Version
struct SyncStatusRows: View {
    let sync: SyncEngine

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Divider()
            Text("Sync").font(.subheadline.weight(.semibold))
            Text("Wartend: \(sync.pendingCount)")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text("Fehlerablage: \(sync.deadLetterCount)")
                .font(.footnote)
                .foregroundStyle(.secondary)
            if sync.state == .unsupported {
                Text("Der Mac spricht ein anderes Protokoll. App aktualisieren.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if sync.deadLetterCount > 0 {
                // Export an den Mac über das Teilen-Menü (VERTRAEGE §11.2). Ein Wiedereinspielen gibt es noch nicht.
                ShareLink(item: sync.deadLetterURL) {
                    Label("Fehlerablage teilen", systemImage: "square.and.arrow.up")
                        .font(.footnote)
                }
            }
        }
    }
}
