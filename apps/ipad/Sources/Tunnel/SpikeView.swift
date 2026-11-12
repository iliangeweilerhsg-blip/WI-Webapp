import SwiftUI

/// Testansicht „Direktverbindung testen“ (Spike S6, UX-12 PR 1). Erreichbar nur über
/// Verbindungsdetails → Entwickler. Läuft mit eigenen Verbindungen zum Mac-Spike, ohne Geräte-Token.
struct SpikeView: View {
    @Bindable var model: SpikeP2PModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                codeSection
                waySection
                checkSection
                longRunSection
                logSection
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Direktverbindung testen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Fertig") { dismiss() }
                }
            }
        }
    }

    // MARK: Abschnitte

    private var codeSection: some View {
        Section {
            TextField("Code vom Mac (8 Ziffern)", text: $model.codeText)
                .keyboardType(.numberPad)
                .font(.title3.monospacedDigit())
                .autocorrectionDisabled()
            if !model.codeText.isEmpty && model.code == nil {
                Text("Der Code hat 8 Ziffern, z. B. 1234 5678.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("1 · Code")
        } footer: {
            Text("Am Mac im Terminal steht der Code, nachdem der Mac-Teil gestartet ist. Er ist bei jedem Start neu.")
        }
    }

    private var waySection: some View {
        Section {
            Picker("Weg", selection: $model.way) {
                ForEach(SpikeWay.allCases) { way in
                    Text(way.label).tag(way)
                }
            }
            .pickerStyle(.segmented)
            .disabled(model.longRun.running)
        } header: {
            Text("2 · Weg für ping, health, Durchsatz, Verfahren und Dauertest")
        } footer: {
            Text(model.way.explanation)
        }
    }

    private var checkSection: some View {
        Section {
            Button {
                model.runAll()
            } label: {
                Label("Alles prüfen", systemImage: "checkmark.circle")
            }
            .disabled(!model.canStart)

            ForEach(model.steps) { step in
                SpikeStepRow(step: step)
            }

            Button {
                model.runCipherMatrix()
            } label: {
                Label("TLS-Verfahren messen", systemImage: "lock.shield")
            }
            .disabled(!model.canStart)
        } header: {
            Text("3 · Prüfen")
        } footer: {
            Text(
                "„Alles prüfen“ misst Dienst, beide Wege, ping, health und Durchsatz. "
                    + "Dauert etwa eine Minute. Die App dabei im Vordergrund lassen.")
        }
    }

    private var longRunSection: some View {
        Section {
            if model.longRun.running {
                SpikeLongRunStats(run: model.longRun)
                Button(role: .destructive) {
                    model.stopLongRun()
                } label: {
                    Label("Dauertest beenden", systemImage: "stop.circle")
                }
            } else {
                Button {
                    model.startLongRun()
                } label: {
                    Label("Dauertest starten", systemImage: "timer")
                }
                .disabled(!model.canStart)
                if model.longRun.startedAt != nil {
                    SpikeLongRunStats(run: model.longRun)
                }
            }
        } header: {
            Text("4 · Dauertest")
        } footer: {
            Text(
                "Alle 5 s ein ping, bis du beendest. Gezählt werden Abbrüche und Wiederaufbauten, dazu der Akkustand. "
                    + "Die Ansicht darfst du schließen, der Test läuft weiter, solange die App im Vordergrund ist.")
        }
    }

    private var logSection: some View {
        Section {
            ShareLink(item: model.exportURL) {
                Label("Protokoll teilen", systemImage: "square.and.arrow.up")
            }
            if model.logLines.isEmpty {
                Text("Noch nichts gemessen.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                Text(model.logText)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                Button("Protokoll leeren", role: .destructive) {
                    model.clearLog()
                }
                .disabled(model.isBusy || model.longRun.running)
            }
        } header: {
            Text("5 · Protokoll")
        } footer: {
            Text("Das Protokoll enthält keine Namen und keine Adressen, nur Zeiten, Verfahren und Schnittstellennamen.")
        }
    }
}

private struct SpikeStepRow: View {
    let step: SpikeStep

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            icon
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(step.title)
                if !step.detail.isEmpty {
                    Text(step.detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var icon: some View {
        switch step.state {
        case .waiting:
            Image(systemName: "circle").foregroundStyle(.secondary)
        case .running:
            ProgressView()
        case .succeeded:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .failed:
            Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
        }
    }
}

private struct SpikeLongRunStats: View {
    let run: SpikeLongRun

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let end = run.running ? context.date : (run.endedAt ?? context.date)
                Text("Dauer: \(SpikeP2PFormat.duration(end.timeIntervalSince(run.startedAt ?? end)))")
            }
            Text("Pings: \(run.pings) · Abbrüche: \(run.aborts) · Wiederaufbauten: \(run.rebuilds)")
            Text(
                "Rundlauf: Mittel \(SpikeP2PFormat.number(run.averageMillis)) ms · Höchstwert \(SpikeP2PFormat.number(run.rttMaxMillis)) ms"
            )
            Text("Längster Ausfall: \(SpikeP2PFormat.seconds(run.longestOutageSeconds))")
            Text(
                "Akku: \(SpikeP2PFormat.battery(run.batteryStart)) → \(SpikeP2PFormat.battery(run.running ? nil : run.batteryEnd))"
            )
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .monospacedDigit()
    }
}
