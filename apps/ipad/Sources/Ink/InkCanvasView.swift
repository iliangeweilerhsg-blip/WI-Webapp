import PencilKit
import SwiftUI
import UIKit

/// Eine Ebene der Seite. PencilKit führt hier bewusst keinen eigenen Verlauf: Rückgängig läuft über
/// `InkHistory`, damit es über beide Ebenen hinweg in der richtigen Reihenfolge wirkt.
final class InkLayerCanvasView: PKCanvasView {
    override var undoManager: UndoManager? { nil }

    /// Die Drei-Finger-Gesten von iPadOS würden sonst mit dem Drei-Finger-Tipp (Wiederholen) kollidieren
    override var editingInteractionConfiguration: UIEditingInteractionConfiguration { .none }
}

/// Schreibfläche einer Seite: Papier, darüber die Textmarker-Ebene, darüber die Schrift (F-INK-01).
///
/// Beide Ebenen sind `PKCanvasView` in voller Größe. Nur die aktive nimmt Berührungen an, sonst finge
/// die obere alles ab. Sie führt beim Scrollen und Zoomen, die andere Ebene und das Papier folgen.
/// Gezoomt wird über PencilKit selbst, damit die Striche in jeder Stufe scharf bleiben.
final class InkCanvasContainerView: UIView {
    let pageSize: CGSize
    let inkCanvas = InkLayerCanvasView()
    let highlightCanvas = InkLayerCanvasView()

    var onDrawingChanged: (@MainActor (StrokeLayer, PKDrawing) -> Void)?
    var onToolUseBegan: (@MainActor () -> Void)?
    var onToolUseEnded: (@MainActor () -> Void)?
    var onUndo: (@MainActor () -> Void)?
    var onRedo: (@MainActor () -> Void)?
    var onPencilDoubleTap: (@MainActor (InkSystemTapPreference) -> Void)?
    /// Ein-Finger-Wisch nach links (+1) oder rechts (-1), nur wenn die Seite nicht gezoomt ist (T1-13: Blättern)
    var onSwipePage: (@MainActor (Int) -> Void)?

    /// Vorlage der Seite. Eine neue Vorlage zeichnet das Papier neu.
    var template: PageTemplate {
        get { paper.template }
        set { paper.template = newValue }
    }

    /// Folie unter der Schrift, `nil` = nur Papier
    var backgroundImage: UIImage? {
        get { paper.backgroundImage }
        set { paper.backgroundImage = newValue }
    }

    private let paper: InkPaperView
    private var activeLayer: StrokeLayer = .ink
    private var appliedTools: InkToolState?
    private var appliedInkRevision: Int?
    private var appliedHighlightRevision: Int?
    private var laidOutSize: CGSize = .zero
    private var isSyncing = false
    /// Zoomstufe, bei der die Seite die Breite füllt (`fitPageToWidth`)
    private var fitZoom: CGFloat = 1

    init(pageSize: CGSize, template: PageTemplate = .blanko) {
        self.pageSize = pageSize
        // Papier und Vorlage in Seitenkoordinaten, Farben wie in der Web-App (#FAF9F5), in Hell und Dunkel gleich
        paper = InkPaperView(pageSize: pageSize, template: template)
        super.init(frame: .zero)

        backgroundColor = .secondarySystemBackground
        clipsToBounds = true

        addSubview(paper)

        for canvas in [highlightCanvas, inkCanvas] {
            configure(canvas)
            addSubview(canvas)
        }

        // Zwei-Finger-Tipp = Rückgängig, Drei-Finger-Tipp = Wiederholen
        let redoTap = UITapGestureRecognizer(target: self, action: #selector(handleRedoTap))
        redoTap.numberOfTouchesRequired = 3
        redoTap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        let undoTap = UITapGestureRecognizer(target: self, action: #selector(handleUndoTap))
        undoTap.numberOfTouchesRequired = 2
        undoTap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        undoTap.require(toFail: redoTap)
        addGestureRecognizer(redoTap)
        addGestureRecognizer(undoTap)

        // Ein Finger wischt waagerecht = blättern. Die Schreibflächen scrollen mit dem Finger, darum darf der Wisch
        // gleichzeitig erkannt werden. Er beginnt nur, wenn nicht gezoomt ist.
        for direction in [UISwipeGestureRecognizer.Direction.left, .right] {
            let swipe = UISwipeGestureRecognizer(target: self, action: #selector(handleSwipe(_:)))
            swipe.direction = direction
            swipe.numberOfTouchesRequired = 1
            swipe.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            swipe.delegate = self
            addGestureRecognizer(swipe)
        }

        // Doppeltipp am Apple Pencil 2
        let pencil = UIPencilInteraction()
        pencil.delegate = self
        addInteraction(pencil)

        applyActiveLayer()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) wird nicht verwendet")
    }

    private func configure(_ canvas: InkLayerCanvasView) {
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        // PencilKit hellt Tinte im dunklen Modus auf. Das Papier ist immer hell, also auch die Tinte.
        canvas.overrideUserInterfaceStyle = .light
        canvas.contentInsetAdjustmentBehavior = .never
        canvas.showsVerticalScrollIndicator = false
        canvas.showsHorizontalScrollIndicator = false
        canvas.alwaysBounceVertical = true
        #if targetEnvironment(simulator)
            // Im Simulator gibt es keinen Stift
            canvas.drawingPolicy = .anyInput
        #else
            // Finger scrollen und zoomen, nur der Stift schreibt. Handflächen erzeugen so keine Striche.
            canvas.drawingPolicy = .pencilOnly
        #endif
        canvas.delegate = self
    }

    // MARK: Zustand aus dem Modell

    func apply(_ tools: InkToolState) {
        guard tools != appliedTools else { return }
        appliedTools = tools
        let tool = InkPencilKit.tool(for: tools)
        inkCanvas.tool = tool
        highlightCanvas.tool = tool
        if activeLayer != tools.activeLayer {
            syncFollower()
            activeLayer = tools.activeLayer
            applyActiveLayer()
        }
        inkCanvas.isRulerActive = tools.rulerActive && activeLayer == .ink
        highlightCanvas.isRulerActive = tools.rulerActive && activeLayer == .highlight
    }

    /// Übernimmt eine Zeichnung, die die App gesetzt hat (Laden, Rückgängig, Wiederholen).
    /// `drawing` wird nur gelesen, wenn sich `revision` geändert hat.
    func setDrawing(_ drawing: @autoclosure () -> PKDrawing, revision: Int, layer: StrokeLayer) {
        switch layer {
        case .ink:
            guard appliedInkRevision != revision else { return }
            appliedInkRevision = revision
            inkCanvas.drawing = drawing()
        case .highlight:
            guard appliedHighlightRevision != revision else { return }
            appliedHighlightRevision = revision
            highlightCanvas.drawing = drawing()
        }
    }

    // MARK: Ebenen

    private var activeCanvas: InkLayerCanvasView {
        activeLayer == .ink ? inkCanvas : highlightCanvas
    }

    private var followerCanvas: InkLayerCanvasView {
        activeLayer == .ink ? highlightCanvas : inkCanvas
    }

    private func applyActiveLayer() {
        inkCanvas.isUserInteractionEnabled = activeLayer == .ink
        highlightCanvas.isUserInteractionEnabled = activeLayer == .highlight
        if window != nil {
            activeCanvas.becomeFirstResponder()
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil {
            activeCanvas.becomeFirstResponder()
        }
    }

    // MARK: Layout, Scrollen, Zoomen

    override func layoutSubviews() {
        super.layoutSubviews()
        inkCanvas.frame = bounds
        highlightCanvas.frame = bounds
        if bounds.size != laidOutSize, bounds.width > 0, bounds.height > 0 {
            laidOutSize = bounds.size
            fitPageToWidth()
        }
        updatePaper()
    }

    /// Seite auf die Breite der Fläche einpassen (beim ersten Layout und nach dem Drehen)
    private func fitPageToWidth() {
        guard pageSize.width > 0, pageSize.height > 0 else { return }
        let fit = bounds.width / pageSize.width
        fitZoom = fit
        let wholePage = min(fit, bounds.height / pageSize.height)
        let master = activeCanvas
        let oldHeight = master.contentSize.height
        let relativeTop = oldHeight > 0 ? max(0, master.contentOffset.y + master.contentInset.top) / oldHeight : 0

        isSyncing = true
        let content = CGSize(width: pageSize.width * fit, height: pageSize.height * fit)
        let insets = centeringInsets(for: content)
        for canvas in [highlightCanvas, inkCanvas] {
            canvas.minimumZoomScale = wholePage
            canvas.maximumZoomScale = fit * 4
            canvas.zoomScale = fit
            canvas.contentSize = content
            canvas.contentInset = insets
            canvas.contentOffset = CGPoint(x: -insets.left, y: relativeTop * content.height - insets.top)
        }
        isSyncing = false
    }

    /// Ränder, die eine Seite mittig halten, wenn sie kleiner als die Fläche ist
    private func centeringInsets(for content: CGSize) -> UIEdgeInsets {
        let horizontal = max(0, (bounds.width - content.width) / 2)
        let vertical = max(0, (bounds.height - content.height) / 2)
        return UIEdgeInsets(top: vertical, left: horizontal, bottom: vertical, right: horizontal)
    }

    private func pageContentSize(zoom: CGFloat) -> CGSize {
        CGSize(width: pageSize.width * zoom, height: pageSize.height * zoom)
    }

    /// Die inaktive Ebene und das Papier folgen der aktiven
    private func syncFollower() {
        isSyncing = true
        let master = activeCanvas
        let follower = followerCanvas
        if follower.zoomScale != master.zoomScale {
            follower.zoomScale = master.zoomScale
        }
        if follower.contentSize != master.contentSize {
            follower.contentSize = master.contentSize
        }
        if follower.contentInset != master.contentInset {
            follower.contentInset = master.contentInset
        }
        if follower.contentOffset != master.contentOffset {
            follower.contentOffset = master.contentOffset
        }
        isSyncing = false
        updatePaper()
    }

    private func updatePaper() {
        let master = activeCanvas
        let size = pageContentSize(zoom: master.zoomScale)
        paper.frame = CGRect(
            x: -master.contentOffset.x,
            y: -master.contentOffset.y,
            width: size.width,
            height: size.height
        )
    }

    // MARK: Gesten

    @objc private func handleUndoTap() {
        onUndo?()
    }

    @objc private func handleRedoTap() {
        onRedo?()
    }

    @objc private func handleSwipe(_ recognizer: UISwipeGestureRecognizer) {
        guard recognizer.state == .ended else { return }
        onSwipePage?(recognizer.direction == .left ? 1 : -1)
    }

    /// Die Seite füllt die Breite oder ist kleiner (nicht hineingezoomt)
    var isNotZoomedIn: Bool {
        activeCanvas.zoomScale <= fitZoom * 1.02
    }

    /// Was iPadOS für den Doppeltipp eingestellt hat
    static func systemTapPreference() -> InkSystemTapPreference {
        switch UIPencilInteraction.preferredTapAction {
        case .ignore: return .ignore
        case .switchEraser: return .switchEraser
        case .switchPrevious: return .switchPrevious
        case .showColorPalette, .showInkAttributes: return .showColorPalette
        default: return .switchEraser
        }
    }
}

extension InkCanvasContainerView: @preconcurrency PKCanvasViewDelegate {
    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
        let layer: StrokeLayer = canvasView === inkCanvas ? .ink : .highlight
        onDrawingChanged?(layer, canvasView.drawing)
    }

    func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView) {
        onToolUseBegan?()
    }

    func canvasViewDidEndUsingTool(_ canvasView: PKCanvasView) {
        onToolUseEnded?()
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard !isSyncing, scrollView === activeCanvas else { return }
        syncFollower()
    }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        guard !isSyncing, scrollView === activeCanvas else { return }
        isSyncing = true
        scrollView.contentInset = centeringInsets(for: pageContentSize(zoom: scrollView.zoomScale))
        isSyncing = false
        syncFollower()
    }

    func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) {
        guard scrollView === activeCanvas else { return }
        // Die Seite bleibt die Zeichenfläche, auch wenn PencilKit die Größe beim Zoomen anders führt
        let expected = pageContentSize(zoom: scrollView.zoomScale)
        if abs(scrollView.contentSize.width - expected.width) > 1
            || abs(scrollView.contentSize.height - expected.height) > 1
        {
            isSyncing = true
            scrollView.contentSize = expected
            isSyncing = false
        }
        syncFollower()
    }
}

extension InkCanvasContainerView: UIGestureRecognizerDelegate {
    // UIView hat dieselbe Methode; sie gilt für alle Gesten dieser Ansicht
    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer is UISwipeGestureRecognizer else {
            return super.gestureRecognizerShouldBegin(gestureRecognizer)
        }
        return onSwipePage != nil && isNotZoomedIn
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        gestureRecognizer is UISwipeGestureRecognizer
    }
}

extension InkCanvasContainerView: UIPencilInteractionDelegate {
    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        onPencilDoubleTap?(InkCanvasContainerView.systemTapPreference())
    }
}

/// Die Schreibfläche in SwiftUI
struct InkCanvasView: UIViewRepresentable {
    let model: InkPageModel
    var template: PageTemplate = .blanko
    /// Folie unter der Schrift (T1-13 Teil 2)
    var backgroundImage: UIImage?
    /// Wisch zum Blättern: +1 weiter, -1 zurück
    var onSwipePage: (@MainActor (Int) -> Void)?

    func makeUIView(context: Context) -> InkCanvasContainerView {
        let model = self.model
        let view = InkCanvasContainerView(pageSize: model.pageSize, template: template)
        view.backgroundImage = backgroundImage
        view.onDrawingChanged = { layer, drawing in
            model.canvasDidChange(layer: layer, drawing: drawing)
        }
        view.onToolUseBegan = { model.beginToolUse() }
        view.onToolUseEnded = { model.endToolUse() }
        view.onUndo = { model.undo() }
        view.onRedo = { model.redo() }
        view.onPencilDoubleTap = { preference in
            model.pencilDoubleTapped(system: preference)
        }
        view.onSwipePage = onSwipePage
        return view
    }

    func updateUIView(_ view: InkCanvasContainerView, context: Context) {
        view.template = template
        view.backgroundImage = backgroundImage
        view.onSwipePage = onSwipePage
        view.apply(model.tools)
        view.setDrawing(model.inkDrawing, revision: model.inkRevision, layer: .ink)
        view.setDrawing(model.highlightDrawing, revision: model.highlightRevision, layer: .highlight)
    }
}
