import Foundation

/// Warum die Kopplung gerade nicht weitergeht (Fehlercodes aus VERTRAEGE §7.5 und §12)
enum PairingFailure: String, Equatable, Sendable {
    case windowClosed = "pairing_window_closed"
    case locked = "pairing_locked"
    case rateLimited = "pairing_rate_limited"
    case requestsFull = "pairing_requests_full"
    case codeInvalid = "pairing_code_invalid"
    case requestRejected = "pairing_request_rejected"
}

/// Konkrete Ursache, warum das iPad den Mac nicht erreicht.
/// Lehre aus Spike S1 (Issue #138): nie nur „keine Verbindung“ zeigen, sondern den Grund.
enum ConnectionError: Error, Equatable, Sendable {
    /// App Transport Security hat `http://` blockiert (fehlende Ausnahme in der Info.plist)
    case insecureConnectionBlocked
    /// „Lokales Netzwerk“ ist für die App nicht erlaubt
    case localNetworkDenied
    /// Kein WLAN oder keine Netzverbindung
    case offline
    case timeout
    /// Unter dieser Adresse antwortet kein Core
    case coreNotFound
    /// Verbindung brach mitten in der Anfrage ab (auch nach den Wiederholungen)
    case connectionLost
    /// Verbindung brach beim Einlösen des Codes ab oder die Antwort blieb aus (Timeout):
    /// offen, ob der Mac schon gekoppelt hat
    case pairingOutcomeUnknown
    /// 401: Token fehlt, ist unbekannt oder wurde am Mac widerrufen
    case tokenInvalid
    /// 421: Der Core nimmt nur IP-Adressen und `.local`-Namen an
    case hostNotAllowed
    case pairing(PairingFailure)
    /// Sonstige Antwort des Core
    case server(status: Int, code: String?)
    /// Antwort ließ sich nicht lesen
    case invalidResponse
    /// Adresse von Hand falsch eingegeben
    case invalidAddress
    /// QR-Code ist kein Kopplungscode von Studien-Gehirn
    case invalidPairingLink
    /// Code ist nicht sechsstellig
    case invalidCodeFormat
    /// Bonjour-Suche läuft nicht
    case discoveryFailed
    /// Der gefundene Mac ließ sich nicht auflösen
    case macNotResolved
    /// Token ließ sich nicht im Schlüsselbund ablegen
    case tokenStorageFailed
    /// Anderer Netzwerkfehler, mit Fehlernummer des Systems
    case network(code: Int)
    /// Der Mac antwortet, spricht aber ein anderes Protokoll (Sync-Code 4426): die App ist veraltet (UX-48)
    case appOutdated
    /// Die gespeicherte Adresse des Macs liegt nicht im Netz des iPads (UX-12, PR 0): Eine Anfrage mit Token ginge in
    /// ein fremdes Netz, darum geht gar nichts raus. Kein Fehler des Macs, kein Grund zum Neukoppeln.
    case otherNetwork
    /// Die Kopplung speichert einen `.local`-Namen (ältere App-Version, #261): Dorthin geht nie ein Token, weil ein
    /// fremdes Netz die mDNS-Frage beantworten könnte. Einmal neu koppeln speichert die IP-Adresse.
    case rePairingNeeded
    /// Ein `.local`-Name ließ sich bei der Kopplung nicht auf eine IPv4-Adresse auflösen (#261)
    case localNameNotResolved

    /// Zuordnung der Systemfehler von URLSession
    static func from(_ error: URLError) -> ConnectionError {
        switch error.code {
        case .appTransportSecurityRequiresSecureConnection:
            return .insecureConnectionBlocked
        case .notConnectedToInternet, .dataNotAllowed:
            // Verweigert der Nutzer „Lokales Netzwerk“, meldet URLSession ebenfalls „offline“.
            // Der Unterschied steht nur im Pfad-Text der Fehlerdetails.
            let details = String(describing: (error as NSError).userInfo)
            if details.localizedCaseInsensitiveContains("local network prohibited") {
                return .localNetworkDenied
            }
            return .offline
        case .timedOut:
            return .timeout
        case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
            return .coreNotFound
        case .networkConnectionLost:
            return .connectionLost
        default:
            return .network(code: error.code.rawValue)
        }
    }

    /// Zuordnung der Antworten des Core (`code` aus `ApiError`)
    static func from(status: Int, code: String?) -> ConnectionError {
        if let code, let failure = PairingFailure(rawValue: code) {
            return .pairing(failure)
        }
        switch status {
        case 401:
            return .tokenInvalid
        case 421:
            return .hostNotAllowed
        default:
            return .server(status: status, code: code)
        }
    }

    /// Macht aus jedem Fehler eine anzeigbare Ursache
    static func wrap(_ error: any Error) -> ConnectionError {
        if let known = error as? ConnectionError { return known }
        if let urlError = error as? URLError { return .from(urlError) }
        return .network(code: (error as NSError).code)
    }

    /// Nur neu koppeln hilft
    var needsNewPairing: Bool { self == .tokenInvalid || self == .rePairingNeeded }

    /// Kurztext für die Statusanzeige
    var title: String {
        switch self {
        case .insecureConnectionBlocked: return "Verbindung vom System blockiert"
        case .localNetworkDenied: return "Lokales Netzwerk nicht erlaubt"
        case .offline: return "Kein WLAN"
        case .timeout: return "Mac antwortet nicht"
        case .coreNotFound: return "Mac nicht gefunden"
        case .connectionLost: return "Verbindung unterbrochen"
        case .pairingOutcomeUnknown: return "Ausgang der Kopplung unklar"
        case .tokenInvalid: return "Kopplung nicht mehr gültig"
        case .hostNotAllowed: return "Adresse nicht zugelassen"
        case .pairing(let failure):
            switch failure {
            case .windowClosed: return "Kopplung am Mac nicht geöffnet"
            case .locked: return "Kopplung gesperrt"
            case .rateLimited: return "Zu viele Versuche"
            case .requestsFull: return "Zu viele Anfragen"
            case .codeInvalid: return "Code stimmt nicht"
            case .requestRejected: return "Anfrage am Mac abgelehnt"
            }
        case .server(let status, _): return "Mac meldet einen Fehler (\(status))"
        case .invalidResponse: return "Antwort nicht lesbar"
        case .invalidAddress: return "Adresse nicht gültig"
        case .invalidPairingLink: return "QR-Code passt nicht"
        case .invalidCodeFormat: return "Code hat sechs Ziffern"
        case .discoveryFailed: return "Suche nach dem Mac läuft nicht"
        case .macNotResolved: return "Mac nicht erreichbar"
        case .tokenStorageFailed: return "Schlüsselbund nicht verfügbar"
        case .network(let code): return "Netzwerkfehler (\(code))"
        case .appOutdated: return "App passt nicht mehr zum Mac"
        case .otherNetwork: return "Mac nicht im selben Netz"
        case .rePairingNeeded: return "Bitte einmal neu koppeln"
        case .localNameNotResolved: return "Name des Macs nicht aufgelöst"
        }
    }

    /// Ein Satz mit dem nächsten Schritt
    var advice: String {
        switch self {
        case .insecureConnectionBlocked:
            return "iPadOS hat die unverschlüsselte Verbindung zum Mac blockiert (ATS). Das ist ein Fehler in der App, bitte melden."
        case .localNetworkDenied:
            return "Erlaube den Zugriff unter Einstellungen → Datenschutz & Sicherheit → Lokales Netzwerk → Studien-Gehirn."
        case .offline:
            return "Verbinde das iPad mit demselben WLAN wie den Mac. Prüfe auch, ob „Lokales Netzwerk“ für Studien-Gehirn erlaubt ist."
        case .timeout:
            return "Der Mac hat nicht rechtzeitig geantwortet. Läuft Studien-Gehirn am Mac, und sind beide Geräte im selben WLAN?"
        case .coreNotFound:
            return "Unter dieser Adresse läuft kein Studien-Gehirn. Prüfe Adresse und Port und ob die App am Mac gestartet ist."
        case .connectionLost:
            return "Die Verbindung brach ab. Versuch es noch einmal."
        case .pairingOutcomeUnknown:
            return "Beim Einlösen des Codes kam keine Antwort vom Mac. Prüfe am Mac unter Einstellungen → Geräte, ob das iPad schon in der Liste steht. Wenn ja, entferne es dort. Starte die Kopplung dann neu."
        case .tokenInvalid:
            return "Das iPad wurde am Mac entfernt oder die Kopplung ist abgelaufen. Kopple es neu."
        case .hostNotAllowed:
            return "Verbinde dich über die IP-Adresse des Macs."
        case .pairing(let failure):
            switch failure {
            case .windowClosed:
                return "Öffne am Mac Einstellungen → Geräte und starte die Kopplung. Der Code gilt 5 Minuten."
            case .locked:
                return "Nach vielen falschen Codes ist die Kopplung gesperrt. Starte sie am Mac neu."
            case .rateLimited:
                return "Warte eine Minute und versuch es dann noch einmal."
            case .requestsFull:
                return "Am Mac warten schon zu viele Anfragen. Lehne dort fremde Anfragen ab oder nimm den QR-Code."
            case .codeInvalid:
                return "Vergleiche den Code mit der Anzeige am Mac und gib ihn noch einmal ein."
            case .requestRejected:
                return "Die Anfrage dieses iPads wurde am Mac abgelehnt. Starte die Kopplung neu."
            }
        case .server(_, let code):
            if let code { return "Meldung des Macs: \(code)." }
            return "Der Mac hat unerwartet geantwortet."
        case .invalidResponse:
            return "Die Antwort des Macs passt nicht zu dieser App-Version."
        case .invalidAddress:
            return "Gib die IP-Adresse des Macs ein, zum Beispiel 192.168.1.20 oder 192.168.1.20:4710."
        case .invalidPairingLink:
            return "Scanne den QR-Code aus Einstellungen → Geräte am Mac."
        case .invalidCodeFormat:
            return "Gib die sechs Ziffern ein, die der Mac anzeigt."
        case .discoveryFailed:
            return "Gib die IP-Adresse des Macs von Hand ein oder scanne den QR-Code."
        case .macNotResolved:
            return "Der Mac wurde gefunden, antwortet aber nicht. Scanne den QR-Code oder gib die IP-Adresse ein."
        case .tokenStorageFailed:
            return "Die Kopplung ließ sich nicht sicher speichern. Entferne das iPad am Mac und kopple es neu."
        case .network:
            return "Prüfe das WLAN und versuch es noch einmal."
        case .appOutdated:
            return "Am Mac über Xcode neu aufspielen."
        case .otherNetwork:
            return "Deine Notizen bleiben auf dem iPad und gleichen sich später ab."
        case .rePairingNeeded:
            return "Verbindungsdetails → Neu koppeln, dann den QR-Code am Mac scannen. Deine Notizen bleiben auf dem iPad und gleichen sich danach ab."
        case .localNameNotResolved:
            return "Gib die IP-Adresse des Macs ein, zum Beispiel 192.168.1.20, oder scanne den QR-Code am Mac."
        }
    }
}
