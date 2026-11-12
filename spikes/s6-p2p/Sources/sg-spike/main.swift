import Foundation
import SpikeServerKit
import SpikeShared

// Spike S6 (UX-12, PR 1): Mac-Gegenstelle. Start von Hand im Terminal, nie durch `sg start`.
//   swift run -c release --package-path spikes/s6-p2p sg-spike
// Optionen:
//   --no-p2p          nur im gemeinsamen Netz ankündigen, nicht über Wi-Fi peer-to-peer
//   --core-port N     Port des Core für den Befehl `health` (Standard 4710)
//   --selftest        Handshake je TLS-Verfahren über Loopback prüfen, ausgeben, beenden
//   --port N          fester Port (für Mitschnitte mit tcpdump auf lo0)
//   --help

struct Arguments {
    var peerToPeer = true
    var corePort = 4710
    var selfTest = false
    var port: UInt16?
    var help = false

    init(_ raw: [String]) {
        var index = 0
        while index < raw.count {
            switch raw[index] {
            case "--no-p2p": peerToPeer = false
            case "--selftest": selfTest = true
            case "--help", "-h": help = true
            case "--core-port":
                index += 1
                if index < raw.count, let value = Int(raw[index]), (1...65535).contains(value) { corePort = value }
            case "--port":
                index += 1
                if index < raw.count, let value = UInt16(raw[index]), value > 0 { port = value }
            default:
                FileHandle.standardError.write(Data("Unbekannte Option: \(raw[index]) (siehe --help)\n".utf8))
                exit(2)
            }
            index += 1
        }
    }
}

func say(_ text: String) {
    print(text)
    fflush(stdout)
}

func clock(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "HH:mm:ss"
    return formatter.string(from: date)
}

let arguments = Arguments(Array(CommandLine.arguments.dropFirst()))

if arguments.help {
    say(
        """
        Spike S6: Direktverbindung Mac und iPad (Wi-Fi peer-to-peer)

        Aufruf:  swift run -c release --package-path spikes/s6-p2p sg-spike [Optionen]
          --no-p2p        nur im gemeinsamen Netz ankündigen
          --core-port N   Port des Core für `health` (Standard 4710)
          --selftest      TLS-Verfahren über Loopback prüfen und beenden
          --port N        fester Port (für tcpdump auf lo0)
        """)
    exit(0)
}

let probe = CoreHealthProbe(port: arguments.corePort)

if arguments.selfTest {
    _Concurrency.Task {
        let report = await SpikeSelfTest.run(port: arguments.port, probe: probe)
        say(report.text)
        exit(report.rows.allSatisfy { $0.succeeded } && !report.wrongCodeReachedReady ? 0 : 1)
    }
    dispatchMain()
}

let code = SpikeCode.random()
let startedAt = Date()
let server = SpikeServer(
    options: SpikeServer.Options(
        code: code, peerToPeer: arguments.peerToPeer, advertise: true, port: arguments.port, probe: probe,
        log: { text in say("[\(clock(Date()))] \(text)") }))

// Strg+C und Beenden von außen: Listener sauber schließen
var signalSources: [DispatchSourceSignal] = []
for signalNumber in [SIGINT, SIGTERM] {
    signal(signalNumber, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
    source.setEventHandler {
        say("Beendet.")
        server.stop()
        exit(0)
    }
    source.resume()
    signalSources.append(source)
}

_Concurrency.Task {
    do {
        let port = try await server.start()
        let endsAt = startedAt.addingTimeInterval(SpikeLimits.selfDestructSeconds)
        let coreReply = await probe.probe()
        say("")
        say("  Spike S6: Direktverbindung Mac und iPad")
        say("")
        say("  Code für das iPad:   \(code.display)")
        say("")
        say("  Dienst:              \(code.serviceName) (\(SpikeLimits.serviceType)), Port \(port)")
        say("  Peer-to-peer:        \(arguments.peerToPeer ? "an" : "aus (--no-p2p)")")
        let coreText =
            coreReply.httpStatus == 0
            ? "nicht erreichbar auf Port \(arguments.corePort) (health antwortet dann mit Fehler, der Funktest geht trotzdem)"
            : "antwortet mit Status \(coreReply.httpStatus) in \(coreReply.millis) ms"
        say("  Core:                \(coreText)")
        say("  Beendet sich selbst: um \(clock(endsAt)) Uhr (nach 4 Stunden). Vorher beenden mit ctrl+C.")
        say("")
        say("  Fragt macOS nach dem lokalen Netzwerk oder der Firewall: bitte aufschreiben und erlauben.")
        say("")
    } catch {
        say("Der Listener startet nicht: \(error)")
        exit(1)
    }
}

// Selbstbeendigung nach spätestens 4 Stunden
DispatchQueue.main.asyncAfter(deadline: .now() + SpikeLimits.selfDestructSeconds) {
    say("4 Stunden sind um, der Spike beendet sich.")
    server.stop()
    exit(0)
}

// Alle 60 s eine Zeile mit den Zählern, aber nur bei Änderung (kein Logfluss durch Fremde im Funk)
var lastStats = server.stats
let statsTimer = DispatchSource.makeTimerSource(queue: .main)
statsTimer.schedule(deadline: .now() + 60, repeating: 60)
statsTimer.setEventHandler {
    let now = server.stats
    if now != lastStats {
        say(
            "[\(clock(Date()))] Verbindungen: \(now.handshakesSucceeded) gelungen, \(now.handshakesFailed) gescheitert, "
                + "\(now.refusedOverLimit) wegen Grenze abgewiesen, \(now.commands) Befehle")
        lastStats = now
    }
}
statsTimer.resume()

dispatchMain()
