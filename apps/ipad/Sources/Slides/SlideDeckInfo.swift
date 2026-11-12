import Foundation

/// Eine Folie eines Foliensatzes. `index` ist 1-basiert und zugleich die Seitennummer im PDF.
struct SlideRef: Codable, Equatable, Sendable {
    var id: String
    var index: Int
    var widthPt: Double
    var heightPt: Double
}

/// Was das iPad über einen Foliensatz speichert (`info.json`). Gelesen wird nur das Nötige aus
/// `GET /slide-decks/{id}`: Text und Textblöcke aller Folien bleiben draußen.
struct SlideDeckInfo: Codable, Equatable, Sendable {
    var deckID: String
    /// SHA-256 des PDF laut Core (Hex, klein)
    var sha256: String
    var slides: [SlideRef]
    /// Größe der geprüften Datei in Byte. Beim Lesen aus dem Speicher prüft das iPad sie erneut (billig).
    /// Optional, damit ältere `info.json` lesbar bleiben.
    var byteSize: Int?

    /// Folie zu einem `slide.change`: Hat das Ereignis eine `slide_id`, gilt sie (auch wenn sie dem Satz fehlt: dann
    /// `nil`). Ohne `slide_id` zählt der 1-basierte Index.
    func resolve(_ brief: SlideBrief) -> SlideRef? {
        if let id = brief.slideID {
            return slides.first { $0.id == id }
        }
        return slides.first { $0.index == brief.index }
    }

    func slide(withID id: String) -> SlideRef? {
        slides.first { $0.id == id }
    }
}

/// Antwort von `GET /slide-decks/{id}`, auf das Nötige gekürzt. Unbekannte Felder werden ignoriert.
struct SlideDeckDetailBrief: Decodable, Sendable {
    let deckID: String
    let sha256: String
    let slides: [SlideRef]

    private enum RootKeys: String, CodingKey {
        case deck
        case slides
    }

    private enum DeckKeys: String, CodingKey {
        case id
        case sha256
    }

    private enum SlideKeys: String, CodingKey {
        case id
        case index
        case widthPt = "width_pt"
        case heightPt = "height_pt"
        case deletedAt = "deleted_at"
    }

    init(from decoder: Decoder) throws {
        let root = try decoder.container(keyedBy: RootKeys.self)
        let deck = try root.nestedContainer(keyedBy: DeckKeys.self, forKey: .deck)
        deckID = try deck.decode(String.self, forKey: .id)
        sha256 = try deck.decode(String.self, forKey: .sha256).lowercased()
        var list = try root.nestedUnkeyedContainer(forKey: .slides)
        var result: [SlideRef] = []
        while !list.isAtEnd {
            let slide = try list.nestedContainer(keyedBy: SlideKeys.self)
            // Eine gelöschte Folie bleibt draußen
            if (try slide.decodeIfPresent(String.self, forKey: .deletedAt)) != nil { continue }
            result.append(
                SlideRef(
                    id: try slide.decode(String.self, forKey: .id),
                    index: try slide.decode(Int.self, forKey: .index),
                    widthPt: try slide.decode(Double.self, forKey: .widthPt),
                    heightPt: try slide.decode(Double.self, forKey: .heightPt)))
        }
        slides = result.sorted { $0.index < $1.index }
    }

    var info: SlideDeckInfo {
        SlideDeckInfo(deckID: deckID, sha256: sha256, slides: slides, byteSize: nil)
    }
}
