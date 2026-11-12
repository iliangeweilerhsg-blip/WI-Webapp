import Foundation
// @preconcurrency: Ältere SDKs kennzeichnen die Network-Typen noch nicht als Sendable
@preconcurrency import Network

/// Ein gefundener Mac-Spike (Spike S6, UX-12 PR 1). Nur Texte, keine Adressen.
struct SpikeFound: Sendable {
    let name: String
    let domain: String
    /// Schnittstellen, über die der Dienst zu sehen war (z. B. `en0`, `awdl0`)
    let interfaces: [String]
    /// Sekunden bis zum ersten Treffer
    let seconds: Double
}

/// Sucht `_sg-spike._tcp` mit peer-to-peer und wartet auf den Dienst mit dem Namen, der aus dem Code folgt.
/// Löst beim ersten Mal die Frage „Lokales Netzwerk erlauben?“ aus. Nur auf echter Hardware prüfbar.
enum SpikeBrowserTool {
    /// Nach dem ersten Treffer noch kurz weiterhorchen: Derselbe Dienst kann über mehrere Schnittstellen auftauchen
    static let settleSeconds: Double = 2

    static func find(name: String, timeout: TimeInterval) async -> SpikeFound? {
        let parameters = NWParameters()
        parameters.includePeerToPeer = true
        let browser = NWBrowser(for: .bonjour(type: SpikeLimits.serviceType, domain: nil), using: parameters)
        let queue = DispatchQueue(label: "de.studiengehirn.spike.browser")
        let started = DispatchTime.now()

        return await withCheckedContinuation { (continuation: CheckedContinuation<SpikeFound?, Never>) in
            let once = SpikeOnce(continuation)
            let interfaces = SpikeBox<[String]>([])
            let domain = SpikeBox<String>("local.")
            let firstSeconds = SpikeBox<Double?>(nil)

            browser.browseResultsChangedHandler = { results, _ in
                var seen = interfaces.get()
                var matched = false
                for result in results {
                    guard case let .service(foundName, _, foundDomain, _) = result.endpoint, foundName == name else {
                        continue
                    }
                    matched = true
                    domain.set(foundDomain)
                    for interface in result.interfaces where !seen.contains(interface.name) {
                        seen.append(interface.name)
                    }
                }
                guard matched else { return }
                interfaces.set(seen)
                if firstSeconds.get() == nil {
                    let seconds = Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1e9
                    firstSeconds.set(seconds)
                    queue.asyncAfter(deadline: .now() + settleSeconds) {
                        once.resume(
                            SpikeFound(
                                name: name, domain: domain.get(), interfaces: interfaces.get(), seconds: seconds))
                        browser.cancel()
                    }
                }
            }
            browser.stateUpdateHandler = { state in
                if case .failed = state {
                    once.resume(nil)
                    browser.cancel()
                }
            }
            browser.start(queue: queue)
            queue.asyncAfter(deadline: .now() + timeout) {
                // Ein Treffer kurz vor Ablauf zählt noch
                if let seconds = firstSeconds.get() {
                    once.resume(
                        SpikeFound(name: name, domain: domain.get(), interfaces: interfaces.get(), seconds: seconds))
                } else {
                    once.resume(nil)
                }
                browser.cancel()
            }
        }
    }
}
