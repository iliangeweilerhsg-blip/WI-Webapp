import SwiftUI

/// Startbildschirm (07-UX §4.2). Echt sind der Verbindungsstatus, ruhige Hinweiskarten (Ablauf, App passt nicht zum
/// Mac, Fehlerablage) und die Notizbücher je Modul. „Gleich“ und „Jetzt sinnvoll“ kommen, sobald Kalender und
/// Wiederholung angebunden sind (UX-61).
struct HomeView: View {
    let model: AppModel
    let mac: PairedMac

    @State private var showsStatus = false
    /// Ablaufdatum der Signatur (UX-13), `nil` ohne Profil. Wird beim Erscheinen und beim Aktivieren der App neu gelesen.
    @State private var expiry: Date?
    /// „Jetzt“ für den Ablaufhinweis, wird beim Erscheinen und beim Aktivieren der App neu gesetzt (UX-50)
    @State private var expiryNow = Date()
    @Environment(\.scenePhase) private var scenePhase

    /// Hinweis, wenn die Signatur der App bald abläuft. `nil` bei genug Restzeit. Nennt wartende Änderungen.
    private var expiryNotice: String? {
        guard let expiry else { return nil }
        return ProfileExpiry.notice(
            expiry: expiry, now: expiryNow, pendingChanges: ProfileExpiry.waitingChanges(
                isOnline: model.sync?.state == .online, pending: model.sync?.pendingCount ?? 0))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let expiryNotice {
                        NoticeCard(text: expiryNotice)
                    }
                    if let sync = model.sync {
                        if sync.state == .unsupported {
                            NoticeCard(text: HomeTexts.appOutdatedCard)
                        }
                        if sync.deadLetterCount > 0 {
                            DeadLetterCard(sync: sync)
                        }
                    }
                    // Nach einer Wiederherstellung am Mac gleicht das iPad alle Seiten ab (UX-46)
                    if let progress = model.library?.backgroundReconcile {
                        NoticeCard(
                            text: HomeTexts.reconcileLine(
                                remaining: progress.remaining, afterRestore: progress.afterRestore))
                    }
                    // Notizbücher je Modul (UX-30). Mit laufender Vorlesung erscheinen die Striche live am Mac (T1-14).
                    if let library = model.library {
                        LibraryListView(library: library, isOnline: model.sync?.state == .online)
                    }
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
                        ConnectionBadge(state: model.badgeState)
                    }
                    .popover(isPresented: $showsStatus) {
                        ConnectionDetailView(model: model, mac: mac)
                    }
                }
            }
        }
        .onAppear {
            refreshExpiry()
        }
        .onChange(of: scenePhase) { _, phase in
            // Die App war im Hintergrund: Der Tag kann gewechselt haben (UX-50)
            if phase == .active { refreshExpiry() }
        }
        .onChange(of: model.sync?.welcomeCount ?? 0) { _, _ in
            _Concurrency.Task { await model.library?.refresh() }
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

    private func refreshExpiry() {
        expiry = ProfileExpiry.currentExpiry()
        expiryNow = Date()
    }
}

/// Texte des Startbildschirms. Reine Funktionen, damit sie testbar sind.
enum HomeTexts {
    static let appOutdatedCard = "App passt nicht mehr zum Mac. Am Mac über Xcode neu aufspielen."

    /// Zeile während des Abgleichs aller Seiten (UX-46). Zählt herunter, am Ende verschwindet sie.
    static func reconcileLine(remaining: Int, afterRestore: Bool) -> String {
        let pages = remaining == 1 ? "1 Seite wird" : "\(remaining) Seiten werden"
        let work = "\(pages) abgeglichen"
        return afterRestore ? "Mac wiederhergestellt · \(work)" : work
    }

    /// Karte zur Fehlerablage (UX-47)
    static func deadLetterCard(count: Int) -> String {
        // Subjekt ist „der Mac“: „konnte“ auch in der Mehrzahl
        let changes = count == 1 ? "1 Änderung" : "\(count) Änderungen"
        return "\(changes) konnte der Mac nicht annehmen. Die Zeichnungen liegen noch auf dem iPad."
    }
}

/// Ruhige Hinweiskarte ohne Warnfarbe
private struct NoticeCard: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityElement(children: .combine)
    }
}

/// Fehlerablage (UX-47): Der Mac hat Änderungen nicht angenommen. Die Zeichnungen bleiben auf dem iPad.
private struct DeadLetterCard: View {
    let sync: SyncEngine

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(HomeTexts.deadLetterCard(count: sync.deadLetterCount))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            // Export an den Mac über das Teilen-Menü (VERTRAEGE §11.2)
            ShareLink(item: sync.deadLetterURL) {
                Label("Fehlerablage teilen", systemImage: "square.and.arrow.up")
                    .font(.subheadline)
                    .frame(minHeight: 44, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

/// „Mac ●“: grün nur bei laufendem Sync, sonst grau (F-INK-13, UX-48). Ruhig, ohne Warnfarben.
struct ConnectionBadge: View {
    let state: BadgeState

    var body: some View {
        HStack(spacing: 6) {
            Text("Mac")
            Circle()
                .fill(state.isGreen ? Color.green : Color.gray)
                .frame(width: 10, height: 10)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(state.accessibilityLabel)
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

    private var headline: String { model.badgeState.headline }

    private var detail: String? { model.badgeState.detail }

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
