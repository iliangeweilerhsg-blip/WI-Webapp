import SwiftUI
import UIKit

/// Seitenleiste (07-UX §4.3): ein seitliches Panel mit Vorschaubildern und Seitenzahl. Tipp springt zur Seite,
/// Ziehen sortiert um, das Kontextmenü bietet „Vorlage ▸“ und „Löschen“. Kein Dialog und kein Sheet (R1): Der Stift
/// schreibt auch bei offenem Panel weiter. Die Ansicht bleibt dünn, Regeln stehen in `InkLibraryService`.
struct InkPageSidebar: View {
    let library: InkLibraryService
    let notebookID: String
    let currentPageID: String?
    let onSelect: (String) -> Void
    let onAdd: (PageTemplate) -> Void
    let onDelete: (String) -> Void
    let onSetTemplate: (String, PageTemplate) -> Void
    let onMove: (Int, Int) -> Void
    let onClose: () -> Void

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        let pages = library.pages(inNotebook: notebookID)
        VStack(spacing: 0) {
            HStack {
                Text("Seiten").font(.headline)
                Spacer()
                Menu {
                    ForEach(PageTemplate.choices, id: \.self) { template in
                        Button(template.germanTitle) { onAdd(template) }
                    }
                } label: {
                    Image(systemName: "plus")
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Seite hinzufügen")
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Seitenleiste schließen")
            }
            .padding(.horizontal, 12)
            Divider()
            ScrollView {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(Array(pages.enumerated()), id: \.element.id) { offset, page in
                        InkPageThumbnailCell(
                            page: page,
                            number: offset + 1,
                            isCurrent: page.id == currentPageID,
                            revision: library.revision
                        )
                        .onTapGesture { onSelect(page.id) }
                        .draggable(page.id)
                        .dropDestination(for: String.self) { items, _ in
                            guard let draggedID = items.first,
                                let from = pages.firstIndex(where: { $0.id == draggedID })
                            else { return false }
                            onMove(from, offset)
                            return true
                        }
                        .contextMenu {
                            Menu("Vorlage") {
                                ForEach(PageTemplate.choices, id: \.self) { template in
                                    Button(template.germanTitle) { onSetTemplate(page.id, template) }
                                }
                            }
                            .disabled(page.template == .folie)
                            Button("Löschen", role: .destructive) { onDelete(page.id) }
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Seite \(offset + 1) von \(pages.count)")
                        .accessibilityAddTraits(
                            page.id == currentPageID ? [.isButton, .isSelected] : .isButton)
                        .accessibilityAction { onSelect(page.id) }
                    }
                }
                .padding(12)
                if let notebook = library.notebook(notebookID), notebook.remoteOnlyPageCount > 0 {
                    Text(InkPageSidebar.remoteOnlyText(count: notebook.remoteOnlyPageCount))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .frame(width: 280)
        .background(.regularMaterial)
        .overlay(alignment: .leading) { Divider() }
    }

    /// Fußzeile, wenn der Mac Seiten hat, die dieses iPad nicht hat
    static func remoteOnlyText(count: Int) -> String {
        count == 1 ? "1 weitere Seite liegt nur am Mac." : "\(count) weitere Seiten liegen nur am Mac."
    }
}

/// Vorschaubild einer Seite mit Seitenzahl. Das Bild wird träge geladen (`InkThumbnailService`).
private struct InkPageThumbnailCell: View {
    let page: LibraryPage
    let number: Int
    let isCurrent: Bool
    /// Ändert sich, wenn sich die Bibliothek ändert (Vorlage gewechselt): lädt das Bild neu
    let revision: Int

    @State private var image: UIImage?

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                Color(.secondarySystemBackground)
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                }
            }
            .aspectRatio(CGFloat(page.widthPt / max(page.heightPt, 1)), contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .strokeBorder(isCurrent ? Color.accentColor : Color.primary.opacity(0.15), lineWidth: isCurrent ? 3 : 1)
            )
            Text("\(number)")
                .font(.caption)
                .foregroundStyle(isCurrent ? Color.accentColor : Color.secondary)
        }
        .contentShape(Rectangle())
        .task(id: "\(page.id)-\(page.template.rawValue)-\(revision)") {
            let data = await InkThumbnailService.shared.thumbnail(
                pageID: page.id, template: page.template, widthPt: page.widthPt, heightPt: page.heightPt)
            guard !_Concurrency.Task.isCancelled, let data else { return }
            image = UIImage(data: data)
        }
    }
}
