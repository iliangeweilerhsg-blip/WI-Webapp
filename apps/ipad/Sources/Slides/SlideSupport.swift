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

/// Hält einen Folienwechsel zurück, solange geschrieben wird (UX-43). Der Wechsel gilt erst nach einer Ruhezeit
/// (`quietPeriod`) ohne neuen Strich: Zwischen zwei Buchstaben ist der Stift kurz oben, dann darf die Seite nicht
/// springen. Es zählt die letzte Folie: Mehrere Wechsel ergeben genau einen Seitenwechsel. Gab es seit dem letzten
/// Wechsel keinen Strich, gilt ein Wechsel sofort.
///
/// Dasselbe Gate hält auch den Wechsel auf die Seite einer beginnenden Vorlesung zurück (`lectureStarted()`, UX-44).
///
/// Die Uhr ist einspritzbar. Das Warten steht in `awaitQuiet(sleep:)`, auch dort ist die Pause einspritzbar. Tests
/// brauchen so weder echte Zeit noch `sleep`.
///
/// Absichtlich nicht an den Main-Actor gebunden: Die Ansicht legt sie als `@State` an. Benutzt wird sie nur dort.
@Observable
final class SlideSwitchGate {
    /// Ruhezeit ohne neuen Strich, bis ein wartender Wechsel gilt (Sekunden). Der Wert ist geschätzt, am Gerät prüfen.
    static let quietPeriod: TimeInterval = 2

    private(set) var pending: SlideRef?
    /// Der Wechsel auf die Seite einer beginnenden Vorlesung wartet
    private(set) var lecturePending = false
    private(set) var toolInUse = false
    /// Folie, die freigegeben wurde. Die Ansicht holt sie mit `takeReleased()`.
    private(set) var released: SlideRef?
    private(set) var lectureReleased = false
    /// Zählt bei jeder Freigabe hoch (die Ansicht beobachtet das)
    private(set) var releases = 0
    /// Zählt hoch, wenn die Ansicht das Warten auf die Ruhe (neu) starten soll
    private(set) var waitToken = 0

    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let quiet: TimeInterval
    /// Zeitpunkt des letzten Absetzens seit dem letzten Wechsel, `nil` = seitdem kein Strich
    @ObservationIgnored private var lastToolEnd: Date?

    init(now: @escaping () -> Date = { Date() }, quietPeriod: TimeInterval = SlideSwitchGate.quietPeriod) {
        self.now = now
        self.quiet = quietPeriod
    }

    /// Wartet überhaupt ein Wechsel?
    var hasPending: Bool { pending != nil || lecturePending }

    /// Folienwechsel, der gerade wartet (für die Infozeile)
    var pendingSlide: SlideRef? { pending }

    /// Sekunden bis zum Ende der Ruhezeit. 0 oder weniger: Ruhe ist da (auch ohne Strich seit dem letzten Wechsel).
    private func remainingQuiet() -> TimeInterval {
        guard let lastToolEnd else { return 0 }
        return quiet - now().timeIntervalSince(lastToolEnd)
    }

    /// - Returns: die Folie, zu der jetzt gewechselt werden soll, oder `nil` (zurückgestellt)
    func slideChanged(_ slide: SlideRef) -> SlideRef? {
        if toolInUse || remainingQuiet() > 0 {
            pending = slide
            waitToken += 1
            return nil
        }
        pending = nil
        lastToolEnd = nil
        return slide
    }

    /// Eine Vorlesung beginnt bei offener Seite (UX-44).
    /// - Returns: `true`, wenn jetzt gewechselt werden darf, `false`, wenn der Wechsel auf die Ruhe wartet
    func lectureStarted() -> Bool {
        if toolInUse || remainingQuiet() > 0 {
            lecturePending = true
            waitToken += 1
            return false
        }
        lecturePending = false
        lastToolEnd = nil
        return true
    }

    func toolBegan() {
        toolInUse = true
    }

    /// Der Stift ist abgesetzt: Die Ruhezeit läuft ab jetzt. Gibt nichts frei, das tut `awaitQuiet` nach der Ruhe.
    func finishTool() {
        toolInUse = false
        lastToolEnd = now()
        if hasPending {
            waitToken += 1
        }
    }

    /// Wartet auf die Ruhe und gibt dann den wartenden Wechsel frei. Endet ohne Freigabe, wenn nichts wartet, ein
    /// neuer Strich beginnt (`finishTool()` startet das Warten dann neu) oder die Pause abgebrochen wird.
    @MainActor
    func awaitQuiet(sleep: @MainActor (Duration) async throws -> Void) async {
        while hasPending, !toolInUse {
            let remaining = remainingQuiet()
            if remaining <= 0 {
                release()
                return
            }
            do {
                try await sleep(.seconds(remaining))
            } catch {
                return
            }
        }
    }

    /// Ein Tipp auf die Infozeile: Der wartende Wechsel gilt sofort
    func releaseNow() {
        guard hasPending else { return }
        release()
    }

    private func release() {
        if let slide = pending {
            released = slide
            pending = nil
        }
        if lecturePending {
            lectureReleased = true
            lecturePending = false
        }
        lastToolEnd = nil
        releases += 1
    }

    func takeReleased() -> SlideRef? {
        defer { released = nil }
        return released
    }

    func takeLectureReleased() -> Bool {
        defer { lectureReleased = false }
        return lectureReleased
    }

    func reset() {
        pending = nil
        released = nil
        lecturePending = false
        lectureReleased = false
        toolInUse = false
        lastToolEnd = nil
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
