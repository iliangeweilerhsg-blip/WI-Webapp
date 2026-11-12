import Foundation
import Observation
import UIKit

/// Welcher Schreibmodus gilt: Wahl des Moduls, sonst Standard aus den Einstellungen, sonst „freie Seite“
/// (VERTRAEGE §14.2, F-INK-03)
enum InkModeResolver {
    static func resolve(module: InkMode?, lectureDefault: InkMode?) -> InkMode {
        module ?? lectureDefault ?? .freieSeite
    }

    /// Text unter dem ausgegrauten Umschalter
    static let unavailableHint = "Folien brauchen eine laufende Vorlesung mit Foliensatz"

    /// „Auf die Folie schreiben“ geht nur mit laufender Session dieses Moduls, mit Foliensatz und bekannter Folie
    static func isAvailable(running: RunningSession?, moduleID: String, slideKnown: Bool) -> Bool {
        guard let running, running.moduleID == moduleID, running.slideDeckID != nil else { return false }
        return slideKnown
    }
}

/// Hält einen Folienwechsel zurück, solange der Stift auf dem Papier ist. Es zählt die letzte Folie: Mehrere Wechsel
/// während eines Strichs ergeben nach dem Absetzen genau einen Seitenwechsel.
///
/// Absichtlich nicht an den Main-Actor gebunden: Die Ansicht legt sie als `@State` an. Benutzt wird sie nur dort.
@Observable
final class SlideSwitchGate {
    private(set) var pending: SlideRef?
    private(set) var toolInUse = false
    /// Folie, die nach dem Absetzen freigegeben wurde. Die Ansicht holt sie mit `takeReleased()`.
    private(set) var released: SlideRef?
    /// Zählt bei jeder Freigabe hoch (die Ansicht beobachtet das)
    private(set) var releases = 0

    /// - Returns: die Folie, zu der jetzt gewechselt werden soll, oder `nil` (zurückgestellt)
    func slideChanged(_ slide: SlideRef) -> SlideRef? {
        if toolInUse {
            pending = slide
            return nil
        }
        pending = nil
        return slide
    }

    func toolBegan() {
        toolInUse = true
    }

    /// - Returns: die zurückgestellte Folie, falls es eine gibt
    func toolEnded() -> SlideRef? {
        toolInUse = false
        defer { pending = nil }
        return pending
    }

    /// Wie `toolEnded()`, aber das Ergebnis liegt für die Ansicht bereit (`released`, `releases`)
    func finishTool() {
        if let slide = toolEnded() {
            released = slide
            releases += 1
        }
    }

    func takeReleased() -> SlideRef? {
        defer { released = nil }
        return released
    }

    func reset() {
        pending = nil
        released = nil
        toolInUse = false
    }
}

/// Alles rund um Folien für die Schreibansicht: Session verfolgen, Foliensatz laden, Bilder zwischenspeichern
@MainActor
@Observable
final class SlideSupport {
    let follower: SessionFollower
    let decks: SlideDeckStore
    @ObservationIgnored let images: SlideImageCache
    /// Schlüssel des sichtbaren Bildes: Bei einer Speicherwarnung bleibt nur dieses
    @ObservationIgnored var visibleKey: String?
    @ObservationIgnored private var memoryObserver: (any NSObjectProtocol)?

    init(follower: SessionFollower, decks: SlideDeckStore, images: SlideImageCache = SlideImageCache()) {
        self.follower = follower
        self.decks = decks
        self.images = images
    }

    /// Die echte Verdrahtung: Follower am Strom der Engine, Foliensätze unter „Application Support/Slides“. Die
    /// Session des Followers speist `InkLibraryService.running`.
    static func live(client: CoreClient, engine: SyncEngine, library: InkLibraryService) -> SlideSupport {
        let follower = SessionFollower(
            feed: engine, backend: CoreSessionFollowerBackend(client: client, sync: engine))
        let decks = SlideDeckStore(
            directory: SlideDeckStore.standardDirectory(),
            client: client,
            access: { [weak engine] in engine?.restAccess() },
            canReach: { [weak engine] in engine?.canReachCore ?? false },
            // Der Satz der laufenden Session fliegt nie aus dem Speicher
            protectedDecks: { [weak follower] in
                guard let deckID = follower?.running?.slideDeckID else { return [] }
                return [deckID]
            }
        )
        decks.onRESTError = { [weak engine] error in engine?.reportRESTError(error) }
        library.attachFollower()
        follower.onChange = { [weak library, weak follower] in
            let brief = follower?.running
            _Concurrency.Task { await library?.follow(session: brief) }
        }
        follower.start()
        let support = SlideSupport(follower: follower, decks: decks)
        support.observeMemoryWarnings()
        return support
    }

    /// Bei Speicherwarnung alle Bilder bis auf das sichtbare verwerfen
    func observeMemoryWarnings() {
        guard memoryObserver == nil else { return }
        memoryObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main
        ) { [weak self] _ in
            _Concurrency.Task { @MainActor in
                guard let self else { return }
                self.images.purge(keeping: self.visibleKey)
            }
        }
    }

    /// Aktuelle Folie des Mac samt Maßen, ohne Netz, nur wenn der Satz schon auf dem iPad liegt
    func knownCurrentSlide() -> SlideRef? {
        guard let deckID = follower.running?.slideDeckID, let brief = follower.currentSlide,
            let info = decks.info(forDeck: deckID)
        else { return nil }
        return info.resolve(brief)
    }

    /// Aktuelle Folie des Mac. Lädt den Foliensatz bei Bedarf (nur den der laufenden Session).
    func currentSlide() async -> SlideRef? {
        guard let deckID = follower.running?.slideDeckID, follower.currentSlide != nil else { return nil }
        guard let info = await decks.ensure(deckID: deckID) else { return nil }
        // Die Folie nach dem Laden neu lesen: Der Mac kann inzwischen weitergeblättert haben
        guard let brief = follower.currentSlide else { return nil }
        return info.resolve(brief)
    }
}

/// Zustand der Folie unter der Schrift
enum SlideBackgroundState: Equatable, Sendable {
    case none
    case loading
    case ready
    /// Nicht auf dem iPad und gerade kein Netz
    case offline
    case failed
}

/// Bild der Folie einer Seite. Es zählt die letzte Anfrage: Ein neuer Auftrag bricht den alten ab.
@MainActor
@Observable
final class SlideBackgroundModel {
    private(set) var image: UIImage?
    private(set) var state: SlideBackgroundState = .none

    @ObservationIgnored private let support: SlideSupport
    @ObservationIgnored private let canReach: @MainActor () -> Bool
    @ObservationIgnored private var task: _Concurrency.Task<Void, Never>?

    init(support: SlideSupport, canReach: @escaping @MainActor () -> Bool) {
        self.support = support
        self.canReach = canReach
    }

    /// Zeigt die Folie `slideID`. `deckHint` ist der Foliensatz der laufenden Session: Liegt die Folie nicht auf dem
    /// iPad, wird dieser Satz geladen. Ohne `slideID` (freie Seite) verschwindet das Bild.
    func show(slideID: String?, deckHint: String?) {
        task?.cancel()
        guard let slideID else {
            image = nil
            state = .none
            support.visibleKey = nil
            return
        }
        // Liegt das Bild schon im Speicher, gibt es keine Lücke
        if let known = support.decks.info(forSlide: slideID) {
            let key = SlideImageCache.key(deckID: known.deck.deckID, slideID: slideID)
            if let cached = support.images.image(for: key) {
                image = cached
                state = .ready
                support.visibleKey = key
                return
            }
        }
        image = nil
        state = .loading
        task = _Concurrency.Task { [weak self] in
            await self?.load(slideID: slideID, deckHint: deckHint)
        }
    }

    private func load(slideID: String, deckHint: String?) async {
        var found = support.decks.info(forSlide: slideID)
        if found == nil, let deckHint {
            _ = await support.decks.ensure(deckID: deckHint)
            found = support.decks.info(forSlide: slideID)
        }
        guard !_Concurrency.Task.isCancelled else { return }
        guard let found, let pdf = support.decks.pdfURL(deckID: found.deck.deckID) else {
            state = canReach() ? .failed : .offline
            return
        }
        let key = SlideImageCache.key(deckID: found.deck.deckID, slideID: slideID)
        let rendered: UIImage?
        if let cached = support.images.image(for: key) {
            rendered = cached
        } else {
            rendered = await SlideRenderer.image(pdf: pdf, pageNumber: found.slide.index)
        }
        guard !_Concurrency.Task.isCancelled else { return }
        guard let rendered else {
            state = .failed
            return
        }
        support.images.store(rendered, for: key)
        support.visibleKey = key
        image = rendered
        state = .ready
    }

    /// Text unter dem Papier, solange die Folie fehlt. Schreiben geht trotzdem.
    var statusText: String? {
        switch state {
        case .loading: return "Folie wird geladen …"
        case .offline: return "Folie nicht auf dem iPad"
        case .failed: return "Folie nicht verfügbar"
        case .none, .ready: return nil
        }
    }
}
