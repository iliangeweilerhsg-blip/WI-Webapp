import Foundation

/// Stiftarten der Werkzeugleiste (F-INK-01). Jede entspricht genau einem `tool` des Strich-Schemas,
/// damit die Web-App sie so zeichnet, wie sie auf dem iPad gewählt wurden.
enum InkPenStyle: String, CaseIterable, Codable, Sendable {
    case fountain
    case fineliner
    case monoline
    case pencil

    var strokeTool: StrokeTool {
        switch self {
        case .fountain: return .fountain
        case .fineliner: return .pen
        case .monoline: return .monoline
        case .pencil: return .pencil
        }
    }

    var title: String {
        switch self {
        case .fountain: return "Füller"
        case .fineliner: return "Fineliner"
        case .monoline: return "Gleichmäßiger Stift"
        case .pencil: return "Bleistift"
        }
    }
}

enum InkTool: Hashable, Sendable {
    case pen(InkPenStyle)
    case marker
    case eraser
    case lasso

    /// Werkzeuge, die Striche erzeugen und darum Farbe und Stärke haben
    var draws: Bool {
        switch self {
        case .pen, .marker: return true
        case .eraser, .lasso: return false
        }
    }
}

/// Radierer: ganzer Strich (`PKEraserTool(.vector)`) oder präzise (`.bitmap`)
enum InkEraserMode: String, Codable, Sendable {
    case stroke
    case pixel

    var toggled: InkEraserMode { self == .stroke ? .pixel : .stroke }
}

/// Was iPadOS für den Doppeltipp am Pencil eingestellt hat (Einstellungen → Apple Pencil)
enum InkSystemTapPreference: Sendable {
    case ignore
    case switchEraser
    case switchPrevious
    case showColorPalette
}

/// Was nach einem Doppeltipp außerhalb des Werkzeugzustands zu tun ist
enum InkDoubleTapEffect: Equatable, Sendable {
    case none
    case toolChanged
    case showColorPalette
}

/// Zustand der Werkzeugleiste. Reine Daten, ohne PencilKit, damit er testbar ist.
struct InkToolState: Equatable, Sendable {
    /// Drei Stärken je Werkzeug als Schnellwahl (F-INK-01)
    static let widthChoices = 3

    /// Acht Favoritenfarben (später aus `Settings.pen.favorite_colors`)
    static let defaultFavoriteColors: [InkRGBA] = [
        InkRGBA(red: 0x1E, green: 0x2A, blue: 0x44),
        InkRGBA(red: 0x1F, green: 0x1F, blue: 0x1F),
        InkRGBA(red: 0x1D, green: 0x4E, blue: 0xD8),
        InkRGBA(red: 0xB9, green: 0x1C, blue: 0x1C),
        InkRGBA(red: 0x15, green: 0x80, blue: 0x3D),
        InkRGBA(red: 0xB4, green: 0x53, blue: 0x09),
        InkRGBA(red: 0x7E, green: 0x22, blue: 0xCE),
        InkRGBA(red: 0x6B, green: 0x72, blue: 0x80),
    ]

    /// Textmarker-Farben. Deckend gespeichert, die Transparenz kommt beim Umrechnen dazu.
    static let markerColors: [InkRGBA] = [
        InkRGBA(red: 0xFF, green: 0xE0, blue: 0x66),
        InkRGBA(red: 0xA7, green: 0xF3, blue: 0xA0),
        InkRGBA(red: 0xFF, green: 0xB3, blue: 0xC7),
        InkRGBA(red: 0xA5, green: 0xD8, blue: 0xFF),
        InkRGBA(red: 0xFF, green: 0xC0, blue: 0x78),
    ]

    private(set) var tool: InkTool = .pen(.fineliner)
    /// Das Werkzeug vor dem aktuellen (Doppeltipp „letztes Werkzeug“)
    private(set) var previousTool: InkTool = .eraser
    /// Das zuletzt benutzte Werkzeug, das kein Radierer ist (Doppeltipp „Radierer“ und zurück)
    private(set) var lastNonEraserTool: InkTool = .pen(.fineliner)

    private(set) var eraserMode: InkEraserMode = .stroke
    /// Option „nur Textmarker radieren“: Der Radierer wirkt dann nur auf die untere Ebene
    var eraserHighlightOnly = false
    var rulerActive = false

    var favoriteColors: [InkRGBA] = InkToolState.defaultFavoriteColors

    private var widthIndexes: [InkTool: Int] = [:]
    private var colors: [InkTool: InkRGBA] = [:]

    // MARK: Werkzeugwahl

    mutating func select(_ newTool: InkTool) {
        guard newTool != tool else { return }
        previousTool = tool
        if tool != .eraser {
            lastNonEraserTool = tool
        }
        tool = newTool
    }

    /// Lang-Druck auf den Radierer: wählt ihn und wechselt zwischen „ganzer Strich“ und „präzise“
    mutating func toggleEraserMode() {
        if tool == .eraser {
            eraserMode = eraserMode.toggled
        } else {
            select(.eraser)
        }
    }

    mutating func setEraserMode(_ mode: InkEraserMode) {
        eraserMode = mode
    }

    /// Ebene, auf die der Stift gerade wirkt. Unten liegt der Textmarker, oben die Schrift.
    var activeLayer: StrokeLayer {
        switch tool {
        case .marker: return .highlight
        case .eraser: return eraserHighlightOnly ? .highlight : .ink
        case .pen, .lasso: return .ink
        }
    }

    // MARK: Stärke und Farbe

    /// Die drei Stärken eines Werkzeugs in pt. Für Radierer und Lasso leer.
    static func widths(for tool: InkTool) -> [Double] {
        switch tool {
        case .pen(.fountain): return [2.2, 3.4, 5.0]
        case .pen(.fineliner): return [1.6, 2.4, 3.6]
        case .pen(.monoline): return [1.2, 2.0, 3.2]
        case .pen(.pencil): return [2.4, 3.6, 5.2]
        case .marker: return [12, 18, 26]
        case .eraser, .lasso: return []
        }
    }

    func widthIndex(for tool: InkTool) -> Int {
        widthIndexes[tool] ?? 1
    }

    func width(for tool: InkTool) -> Double? {
        let widths = InkToolState.widths(for: tool)
        guard !widths.isEmpty else { return nil }
        return widths[min(max(0, widthIndex(for: tool)), widths.count - 1)]
    }

    func color(for tool: InkTool) -> InkRGBA? {
        guard tool.draws else { return nil }
        if let color = colors[tool] { return color }
        return tool == .marker ? InkToolState.markerColors[0] : InkToolState.defaultFavoriteColors[0]
    }

    var currentWidthIndex: Int { widthIndex(for: tool) }
    var currentWidth: Double? { width(for: tool) }
    var currentColor: InkRGBA? { color(for: tool) }

    /// Farben, die die Palette für das aktuelle Werkzeug anbietet
    var paletteColors: [InkRGBA] {
        switch tool {
        case .marker: return InkToolState.markerColors
        case .pen: return favoriteColors
        case .eraser, .lasso: return []
        }
    }

    /// Stärke des aktuellen Werkzeugs wählen. Ohne Wirkung bei Radierer und Lasso.
    mutating func selectWidth(index: Int) {
        guard tool.draws, (0..<InkToolState.widthChoices).contains(index) else { return }
        widthIndexes[tool] = index
    }

    /// Farbe des aktuellen Werkzeugs wählen. Ohne Wirkung bei Radierer und Lasso.
    mutating func selectColor(_ color: InkRGBA) {
        guard tool.draws else { return }
        colors[tool] = color.withAlpha(255)
    }

    // MARK: Doppeltipp am Pencil

    /// Doppeltipp am Apple Pencil 2 (`UIPencilInteraction`).
    /// `setting` kommt aus den Einstellungen der App, `system` aus iPadOS.
    mutating func handleDoubleTap(
        setting: PencilDoubleTapAction,
        system: InkSystemTapPreference
    ) -> InkDoubleTapEffect {
        let action: InkSystemTapPreference
        switch setting {
        case .aus: action = .ignore
        case .radierer: action = .switchEraser
        case .letztesWerkzeug: action = .switchPrevious
        case .farbpalette: action = .showColorPalette
        case .system: action = system
        }

        switch action {
        case .ignore:
            return .none
        case .switchEraser:
            select(tool == .eraser ? lastNonEraserTool : .eraser)
            return .toolChanged
        case .switchPrevious:
            select(previousTool)
            return .toolChanged
        case .showColorPalette:
            return tool.draws ? .showColorPalette : .none
        }
    }
}
