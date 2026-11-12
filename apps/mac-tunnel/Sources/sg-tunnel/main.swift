import Foundation
import TunnelKit

// sg-tunnel (UX-12, PR 3): Mac-Helfer für die Direktverbindung vom iPad.
//   sg-tunnel --keys <Schlüsseldatei> --socket <Unix-Socket des Core> --status <Zustandsdatei> [--p2p on|off]
// Gestartet und überwacht wird er von `sg start`. Es gibt bewusst weder `--core-url` noch eine HTTP-Route:
// Der Helfer spricht nie mit dem Haupteingang des Core und liest nie das Token.
// Exit-Codes: 0 sauber beendet, 64 falsche Aufrufargumente, 78 Konfigurationsfehler (kein Neustart durch `sg`).

let exitUsage: Int32 = 64
let exitConfig: Int32 = 78

func say(_ text: String) {
    let formatter = DateFormatter()
    formatter.dateFormat = "HH:mm:ss"
    print("[\(formatter.string(from: Date()))] \(text)")
    fflush(stdout)
}

func fail(_ text: String, code: Int32) -> Never {
    FileHandle.standardError.write(Data("sg-tunnel: \(text)\n".utf8))
    exit(code)
}

let usage = """
    sg-tunnel – Mac-Helfer für die Direktverbindung vom iPad (Wi-Fi peer-to-peer und gemeinsames WLAN)

    Aufruf: sg-tunnel --keys <Datei> --socket <Pfad> --status <Datei> [--p2p on|off]
      --keys     Schlüsseldatei des Core (<SG_DATA_DIR>/secrets/tunnel-keys.json), wird nur gelesen
      --socket   Tunnel-Eingang des Core (<SG_DATA_DIR>/run/tunnel.sock)
      --status   Zustandsdatei für `sg doctor`
      --p2p      Ankündigung über Wi-Fi peer-to-peer (Standard: on)
    """

var keysArgument: String?
var socketArgument: String?
var stateArgument: String?
var peerToPeer = true

let arguments = Array(CommandLine.arguments.dropFirst())
var index = 0
while index < arguments.count {
    let argument = arguments[index]
    func value() -> String {
        index += 1
        guard index < arguments.count else { fail("\(argument) braucht einen Wert.\n\(usage)", code: exitUsage) }
        return arguments[index]
    }
    switch argument {
    case "--keys": keysArgument = value()
    case "--socket": socketArgument = value()
    case "--status": stateArgument = value()
    case "--p2p":
        switch value() {
        case "on": peerToPeer = true
        case "off": peerToPeer = false
        default: fail("--p2p erwartet on oder off.", code: exitUsage)
        }
    case "--help", "-h":
        print(usage)
        exit(0)
    default:
        fail("Unbekannte Option \(argument).\n\(usage)", code: exitUsage)
    }
    index += 1
}

guard let keysPath = keysArgument, let socketPath = socketArgument, let statePath = stateArgument else {
    fail("--keys, --socket und --status sind Pflicht.\n\(usage)", code: exitUsage)
}

signal(SIGPIPE, SIG_IGN)

let engine = TunnelEngine(
    options: TunnelOptions(keysPath: keysPath, socketPath: socketPath, statePath: statePath, peerToPeer: peerToPeer),
    log: { text in say(text) })

do {
    try engine.start()
} catch {
    fail("\(error)", code: exitConfig)
}
say("sg-tunnel läuft (Version \(TunnelInfo.version), Peer-to-peer: \(peerToPeer ? "an" : "aus")).")

// Beenden von außen (`sg stop`, Strg+C): Listener und Verbindungen sauber schließen, Zustandsdatei entfernen
var signalSources: [DispatchSourceSignal] = []
for signalNumber in [SIGINT, SIGTERM, SIGHUP] {
    signal(signalNumber, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
    source.setEventHandler {
        say("Beendet.")
        engine.stop()
        exit(0)
    }
    source.resume()
    signalSources.append(source)
}

dispatchMain()
