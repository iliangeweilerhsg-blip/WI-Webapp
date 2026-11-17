import PencilKit
import XCTest

@testable import StudienGehirn

/// Strichformat v2 auf dem iPad (VERTRAEGE §23.7, V2-3) und sehr lange v1-Striche (#382):
/// Größe der Operation, Fähigkeit des Core, Modell, Abgleich.
final class InkStrokeSizesOpTests: XCTestCase {
    private let binding = InkBinding(
        notebookID: "019a4e14-0000-7000-8000-0000000000a2",
        pageID: "019a4e14-0000-7000-8000-0000000000b1",
        moduleID: "019a4e14-0000-7000-8000-0000000000c1",
        pageCreated: false,
        needsReconcile: false,
        sessionID: "019a4e14-0000-7000-8000-0000000000d1",
        sessionStartMS: 8000
    )

    private final class IDs {
        private var next = 0
        func make() -> String {
            next += 1
            return String(format: "019a4e14-0000-7000-8000-%012x", next)
        }
    }

    private func wire(_ json: String) throws -> [String: Any] {
        try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
    }

    private func wireStroke(_ json: String) throws -> [String: Any] {
        let data = try XCTUnwrap(try wire(json)["data"] as? [String: Any])
        return try XCTUnwrap(data["stroke"] as? [String: Any])
    }

    /// Strich mit frei wählbarer Länge von `points` und `sizes` (Zeichen). Der Aufbau prüft die Länge nicht,
    /// geprüft wird hier nur die Größe der Operation. `////` steht für ein Base64 mit lauter `/`.
    private func stroke(pointsChars: Int, sizesChars: Int?) -> Stroke {
        Stroke(
            bbox: [0, 0, 10, 10],
            clientID: "019a4e14-0000-7000-8000-0000000000f1",
            color: "#000000FF",
            createdAt: 10_000,
            layer: .ink,
            points: String(repeating: "////", count: pointsChars / 4),
            sizes: sizesChars.map { String(repeating: "////", count: $0 / 4) },
            tEndMS: 2500,
            tStartMS: 2000,
            tool: .fountain,
            transform: [1, 0, 0, 1, 0, 0],
            width: 3
        )
    }

    private func build(_ stroke: Stroke, offsetMS: Int? = nil) -> OutboxDraft? {
        InkOpBuilder.ops(
            for: [.upsert(stroke)], binding: binding, nowMS: 5000, offsetMS: offsetMS, makeID: IDs().make
        ).first
    }

    private func codecSample(points: [InkPointSample]) -> InkStrokeSample {
        InkStrokeSample(
            tool: .fountain,
            layer: .ink,
            color: InkRGBA(red: 0x18, green: 0x64, blue: 0xAB),
            width: 3,
            createdAt: Date(timeIntervalSince1970: 1_762_246_500),
            transform: InkStrokeCodec.identityTransform,
            points: points
        )
    }

    // MARK: Regel 2: Größe der Operation (§23.3)

    func testTwentyThousandPointsWithSizesStayBelowTheLimitEvenAfterCorrection() throws {
        let points = (0..<20_000).map { index in
            InkPointSample(
                x: Double(index % 500), y: Double(index / 500), timeOffset: Double(index) * 0.004,
                force: 1, azimuth: 0.5, altitude: 1.0, width: 1 + Double(index % 7) * 0.5, height: 2)
        }
        let encoded = try XCTUnwrap(
            InkStrokeCodec.encode(
                codecSample(points: points), clientID: "019a4e14-0000-7000-8000-0000000000f1",
                sessionStartedAt: Date(timeIntervalSince1970: 1_762_246_400),
                options: InkCodecOptions(includeSizes: true)))
        XCTAssertNotNil(encoded.sizes)

        let draft = try XCTUnwrap(build(encoded))
        XCTAssertLessThan(draft.json.utf8.count, SyncEngine.maxMessageBytes)
        XCTAssertLessThanOrEqual(draft.json.utf8.count, InkOpBuilder.maxStrokeAddBytes)
        XCTAssertNotNil(try wireStroke(draft.json)["sizes"] as? String)

        // Nach der Zeitkorrektur mit großem Uhrversatz sind die Zahlen länger, die Operation bleibt unter der Grenze
        let entry = OutboxEntry(
            number: 1, opID: draft.opID, stream: draft.stream, kind: draft.kind, pageID: draft.pageID,
            json: draft.json, clockUncertain: true, sessionStartMS: draft.sessionStartMS)
        let fixed = try XCTUnwrap(InkOpBuilder.correct(entry, offsetMS: 31_536_000_000))
        XCTAssertLessThan(fixed.json.utf8.count, SyncEngine.maxMessageBytes)
        XCTAssertNotNil(try wireStroke(fixed.json)["sizes"] as? String)
    }

    func testStrokeJustBelowTheLimitKeepsSizesEvenWithManySlashes() throws {
        // Mit `\/` (alter Kodierer) läge diese Operation weit über der Grenze. Gemessen wird, was gesendet wird.
        let base = try XCTUnwrap(build(stroke(pointsChars: 928_000, sizesChars: nil)))
        let room = InkOpBuilder.maxStrokeAddBytes - base.json.utf8.count
        let keep = stroke(pointsChars: 928_000, sizesChars: (room - 4000) / 4 * 4)
        let draft = try XCTUnwrap(build(keep))
        XCTAssertLessThanOrEqual(draft.json.utf8.count, InkOpBuilder.maxStrokeAddBytes)
        XCTAssertNotNil(try wireStroke(draft.json)["sizes"] as? String)
        XCTAssertFalse(draft.json.contains("\\/"))
    }

    func testStrokeAboveTheLimitIsSentWithoutSizesAndOtherwiseIdentical() throws {
        let base = try XCTUnwrap(build(stroke(pointsChars: 928_000, sizesChars: nil)))
        let room = InkOpBuilder.maxStrokeAddBytes - base.json.utf8.count
        let big = stroke(pointsChars: 928_000, sizesChars: (room + 4000) / 4 * 4)

        // Die Operation mit `sizes` wäre größer als 950 000 Byte
        let direct = try SGSyncOp.strokeAdd(strokeAddOp(big)).encode()
        XCTAssertGreaterThan(direct.count, InkOpBuilder.maxStrokeAddBytes)

        // `build` nimmt `big` mit `sizes` und liefert dieselbe Operation wie der Strich, der gar keine `sizes` hatte
        let withSizes = try XCTUnwrap(build(big))
        let plain = try XCTUnwrap(build(big.with(sizes: .some(nil))))
        XCTAssertEqual(withSizes.json, plain.json, "ohne `sizes` neu gebaut")

        let json = try wire(withSizes.json)
        let sent = try wireStroke(withSizes.json)
        XCTAssertFalse(sent.keys.contains("sizes"))
        XCTAssertEqual(sent["points"] as? String, big.points)
        XCTAssertEqual(sent["client_id"] as? String, big.clientID)
        XCTAssertEqual(sent["created_at"] as? Int, 10_000)
        XCTAssertEqual(sent["t_start_ms"] as? Int, 2000)
        XCTAssertEqual(sent["t_end_ms"] as? Int, 2500)
        XCTAssertEqual(json["op_id"] as? String, "019a4e14-0000-7000-8000-000000000001")
        XCTAssertEqual(withSizes.opID, "019a4e14-0000-7000-8000-000000000001")
        XCTAssertEqual(withSizes.sessionStartMS, 8000)
        XCTAssertTrue(withSizes.clockUncertain)
    }

    func testLimitIsMeasuredOnTheEncodedOperation() throws {
        // Rechnung der Regel: Grenze = maxMessageBytes − 50 000; gemessen wird `json.utf8.count`
        XCTAssertEqual(InkOpBuilder.maxStrokeAddBytes, SyncEngine.maxMessageBytes - 50_000)
        XCTAssertEqual(InkOpBuilder.maxStrokeAddBytes, 950_000)
        let base = try XCTUnwrap(build(stroke(pointsChars: 928_000, sizesChars: nil)))
        let room = InkOpBuilder.maxStrokeAddBytes - base.json.utf8.count
        // Der Umschlag mit `"sizes":"…",` kostet 10 Byte mehr als der Text selbst
        let atLimit = try XCTUnwrap(build(stroke(pointsChars: 928_000, sizesChars: (room - 100) / 4 * 4)))
        XCTAssertLessThanOrEqual(atLimit.json.utf8.count, InkOpBuilder.maxStrokeAddBytes)
        XCTAssertNotNil(try wireStroke(atLimit.json)["sizes"])
        let over = try XCTUnwrap(build(stroke(pointsChars: 928_000, sizesChars: (room + 100) / 4 * 4)))
        XCTAssertNil(try wireStroke(over.json)["sizes"])
    }

    func testSizesAreKeptForStrokesWithoutSizesAndRemovesAreUntouched() throws {
        let ids = IDs()
        let drafts = InkOpBuilder.ops(
            for: [.upsert(stroke(pointsChars: 32, sizesChars: nil)), .remove(["a"]), .upsert(stroke(pointsChars: 32, sizesChars: 16))],
            binding: binding, nowMS: 5000, offsetMS: nil, makeID: ids.make)
        XCTAssertEqual(drafts.map(\.kind), ["stroke.add", "stroke.remove", "stroke.add"])
        // Genau eine `op_id` je Operation, in der Reihenfolge der Änderungen
        XCTAssertEqual(
            drafts.map(\.opID),
            (1...3).map { String(format: "019a4e14-0000-7000-8000-%012x", $0) })
        XCTAssertFalse(try wireStroke(drafts[0].json).keys.contains("sizes"))
        XCTAssertNotNil(try wireStroke(drafts[2].json)["sizes"])
    }

    // MARK: Kodierer ohne `\/` (#382)

    func testSyncEncoderLeavesSlashesUnescapedAndTheCoreReadsThemEqually() throws {
        let draft = try XCTUnwrap(build(stroke(pointsChars: 400, sizesChars: 40)))
        XCTAssertFalse(draft.json.contains("\\/"))
        XCTAssertTrue(draft.json.contains("////"))
        // Dasselbe JSON mit `\/` gelesen ergibt denselben Strich: `/` und `\/` sind in JSON gleich
        let escaped = draft.json.replacingOccurrences(of: "/", with: "\\/")
        XCTAssertNotEqual(escaped, draft.json)
        let plainStroke = try wireStroke(draft.json)
        let escapedStroke = try wireStroke(escaped)
        XCTAssertEqual(plainStroke["points"] as? String, escapedStroke["points"] as? String)
        XCTAssertEqual(plainStroke["sizes"] as? String, escapedStroke["sizes"] as? String)
        // Und das iPad liest seine eigene Operation wieder
        guard case .strokeAdd(let op) = try SGSyncOp.decode(Data(draft.json.utf8)) else {
            return XCTFail("keine stroke.add")
        }
        XCTAssertEqual(op.data.stroke.points, String(repeating: "////", count: 100))
    }

    func testSyncEncoderOnlyChangesTheSlashEscaping() throws {
        // Gleiche Daten, gleiche Schlüssel, Pflichtfelder mit `null` bleiben
        let value = stroke(pointsChars: 32, sizesChars: nil).with(tEndMS: .some(nil), tStartMS: .some(nil))
        let sync = try wireJSON(try SGSync.encode(value))
        let generated = try wireJSON(try newJSONEncoder().encode(value))
        XCTAssertEqual(sync.keys.sorted(), generated.keys.sorted())
        XCTAssertEqual(sync["points"] as? String, generated["points"] as? String)
        XCTAssertTrue(sync["t_start_ms"] is NSNull)
    }

    private func wireJSON(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    // MARK: #382: v1-Strich mit 31 250 Punkten

    /// Punkte, deren Bytes fast nur aus 0xFF bestehen: viele `/` im Base64 (schlechtester Fall für `\/`)
    private func slashHeavySample(count: Int) -> InkStrokeSample {
        let heavy = Double(Float(bitPattern: 0xBFFF_FFFF))
        let points = (0..<count).map { index in
            InkPointSample(
                x: heavy, y: heavy, timeOffset: Double(index) * 0.004, force: 100, azimuth: heavy, altitude: heavy)
        }
        return codecSample(points: points)
    }

    func testV1StrokeWith31250PointsFitsIntoOneMessage() throws {
        let stroke = try XCTUnwrap(
            InkStrokeCodec.encode(
                slashHeavySample(count: 31_250), clientID: "019a4e14-0000-7000-8000-0000000000f1",
                sessionStartedAt: Date(timeIntervalSince1970: 1_762_246_400)))
        XCTAssertNil(stroke.sizes)
        let slashes = stroke.points.filter { $0 == "/" }.count
        XCTAssertGreaterThan(slashes, 100_000)

        let draft = try XCTUnwrap(build(stroke))
        XCTAssertFalse(draft.json.contains("\\/"))
        XCTAssertLessThanOrEqual(draft.json.utf8.count, InkOpBuilder.maxStrokeAddBytes)
        // Mit dem alten Kodierer (`\/`) wäre die Nachricht über der Grenze der Engine gewesen
        XCTAssertGreaterThan(draft.json.utf8.count + slashes, SyncEngine.maxMessageBytes)

        // Auch nach der Zeitkorrektur
        let entry = OutboxEntry(
            number: 1, opID: draft.opID, stream: draft.stream, kind: draft.kind, pageID: draft.pageID,
            json: draft.json, clockUncertain: true, sessionStartMS: draft.sessionStartMS)
        let fixed = try XCTUnwrap(InkOpBuilder.correct(entry, offsetMS: 31_536_000_000))
        XCTAssertLessThan(fixed.json.utf8.count, SyncEngine.maxMessageBytes)
    }

    @MainActor
    func testV1StrokeWith31250PointsReachesTheCoreAndIsNotDeadLettered() async throws {
        let h = SyncHarness()
        let stroke = try XCTUnwrap(
            InkStrokeCodec.encode(
                slashHeavySample(count: 31_250), clientID: "019a4e14-0000-7000-8000-0000000000f1"))
        XCTAssertTrue(h.engine.enqueue([.upsert(stroke)], binding: h.binding))
        h.start()

        let done = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(done)
        XCTAssertEqual(h.engine.deadLetterCount, 0)
        let socket = try XCTUnwrap(h.factory.sockets.first)
        XCTAssertEqual(socket.ops.count, 1)
        XCTAssertLessThan(try XCTUnwrap(socket.ops.first?.text).utf8.count, SyncEngine.maxMessageBytes)
    }

    @MainActor
    func testStrokeWithSizesThatWouldBeTooLargeIsSentAsV1InsteadOfDeadLettered() async throws {
        let h = SyncHarness()
        // Mit `sizes` über 1 000 000 Byte (die Engine legte sie in die Fehlerablage), ohne `sizes` darunter
        let big = stroke(pointsChars: 928_000, sizesChars: 90_000)
        XCTAssertGreaterThan(try SGSyncOp.strokeAdd(strokeAddOp(big)).encode().count, SyncEngine.maxMessageBytes)
        XCTAssertTrue(h.engine.enqueue([.upsert(big)], binding: h.binding))
        h.start()

        let done = await eventually { h.engine.pendingCount == 0 }
        XCTAssertTrue(done)
        XCTAssertEqual(h.engine.deadLetterCount, 0)
        let socket = try XCTUnwrap(h.factory.sockets.first)
        XCTAssertEqual(socket.ops.count, 1)
        let sent = try XCTUnwrap(socket.ops.first?.object)
        let sentStroke = try XCTUnwrap((sent["data"] as? [String: Any])?["stroke"] as? [String: Any])
        XCTAssertFalse(sentStroke.keys.contains("sizes"))
        XCTAssertEqual(sentStroke["points"] as? String, big.points)
    }

    private func strokeAddOp(_ stroke: Stroke) -> StrokeAddOp {
        StrokeAddOp(
            at: 5000,
            clockUncertain: true,
            data: StrokeAddData(pageID: binding.pageID, stroke: stroke),
            kind: .strokeAdd,
            opID: "019a4e14-0000-7000-8000-000000000001",
            origin: nil,
            seq: nil,
            stream: binding.stream,
            type: .op
        )
    }
}

/// Fähigkeit `stroke_sizes` des Core: `welcome.features` lesen, merken, beim Entkoppeln löschen (VERTRAEGE §23.4, §23.7)
@MainActor
final class StrokeSizesCapabilityTests: XCTestCase {
    private func connect(_ h: SyncHarness, features: [String]?) async throws {
        h.factory.configure = { socket, _ in socket.features = features }
        h.start()
        let welcomed = await eventually { h.engine.welcomeCount == 1 }
        XCTAssertTrue(welcomed)
    }

    func testIsFalseBeforeTheFirstWelcome() {
        let h = SyncHarness()
        XCTAssertFalse(h.engine.strokeSizesSupported)
        XCTAssertFalse(h.macs.strokeSizes)
    }

    func testWelcomeWithoutFeaturesMeansV1() async throws {
        let h = SyncHarness()
        try await connect(h, features: nil)
        XCTAssertFalse(h.engine.strokeSizesSupported)
        XCTAssertFalse(h.macs.strokeSizes)
    }

    func testWelcomeWithStrokeSizesAndAnUnknownFeatureMeansV2() async throws {
        let h = SyncHarness()
        try await connect(h, features: ["stroke_sizes", "unbekannt"])
        XCTAssertTrue(h.engine.strokeSizesSupported)
        XCTAssertTrue(h.macs.strokeSizes)
    }

    func testWelcomeWithOnlyUnknownFeaturesMeansV1() async throws {
        let h = SyncHarness()
        try await connect(h, features: ["unbekannt"])
        XCTAssertFalse(h.engine.strokeSizesSupported)
        let empty = SyncHarness()
        try await connect(empty, features: [])
        XCTAssertFalse(empty.engine.strokeSizesSupported)
    }

    func testRememberedValueIsUsedBeforeTheNextWelcome() {
        // Offline entstandene Striche nutzen den zuletzt gemerkten Wert
        let h = SyncHarness()
        h.macs.setStrokeSizes(true)
        XCTAssertTrue(h.engine.strokeSizesSupported)
    }

    func testOlderCoreAfterwardsTurnsItOff() async throws {
        let h = SyncHarness()
        h.macs.setStrokeSizes(true)
        try await connect(h, features: nil)
        XCTAssertFalse(h.engine.strokeSizesSupported)
        XCTAssertFalse(h.macs.strokeSizes)
    }

    func testUnpairingForgetsIt() async throws {
        let h = SyncHarness()
        try await connect(h, features: ["stroke_sizes"])
        XCTAssertTrue(h.engine.strokeSizesSupported)
        h.engine.stop()
        h.macs.clearPairedMac()
        XCTAssertFalse(h.engine.strokeSizesSupported)
    }

    func testDefaultsStoreKeepsItAcrossInstancesAndClearsItWithThePairing() {
        // Ein neuer Wert-Typ liest dieselben UserDefaults wie nach einem Neustart der App
        let key = "pairedMac.strokeSizes"
        let saved = DefaultsPairedMacStore().loadPairedMac()
        let before = UserDefaults.standard.object(forKey: key)
        defer {
            if let before { UserDefaults.standard.set(before, forKey: key) } else { UserDefaults.standard.removeObject(forKey: key) }
            if let saved { DefaultsPairedMacStore().savePairedMac(saved) }
        }
        let store = DefaultsPairedMacStore()
        store.clearPairedMac()
        XCTAssertFalse(store.strokeSizes)
        store.setStrokeSizes(true)
        XCTAssertTrue(DefaultsPairedMacStore().strokeSizes)
        XCTAssertEqual(UserDefaults.standard.object(forKey: key) as? Bool, true)
        store.clearPairedMac()
        XCTAssertFalse(DefaultsPairedMacStore().strokeSizes)
        XCTAssertNil(UserDefaults.standard.object(forKey: key))
        store.setStrokeSizes(false)
        XCTAssertFalse(DefaultsPairedMacStore().strokeSizes)
    }
}

/// Erfassung, Seitenmodell und Abgleich
@MainActor
final class InkStrokeSizesModelTests: XCTestCase {
    private func pencilStroke(sizes: [CGSize]) -> PKStroke {
        let points = sizes.enumerated().map { index, size in
            PKStrokePoint(
                location: CGPoint(x: 100 + CGFloat(index) * 10, y: 100),
                timeOffset: TimeInterval(index) * 0.016,
                size: size,
                opacity: 1,
                force: 1,
                azimuth: 0,
                altitude: .pi / 2
            )
        }
        let path = PKStrokePath(
            controlPoints: points, creationDate: Date(timeIntervalSince1970: 1_762_246_500))
        return PKStroke(ink: PKInk(.fountainPen, color: .black), path: path)
    }

    private let varied = (0..<6).map { CGSize(width: 2 + CGFloat($0), height: 3 + CGFloat($0) * 0.5) }

    func testSampleReadsWidthAndHeightOfEveryPoint() throws {
        let sample = InkPencilKit.sample(from: pencilStroke(sizes: varied), layer: .ink)
        XCTAssertFalse(sample.points.isEmpty)
        XCTAssertTrue(sample.points.allSatisfy { $0.width > 0 && $0.height > 0 })
        let first = try XCTUnwrap(sample.points.first)
        XCTAssertEqual(first.width, 2, accuracy: 0.01)
        XCTAssertEqual(first.height, 3, accuracy: 0.01)
        let last = try XCTUnwrap(sample.points.last)
        XCTAssertEqual(last.width, 7, accuracy: 0.01)
        XCTAssertEqual(last.height, 5.5, accuracy: 0.01)
        // Die Grundbreite bleibt der Median von max(Breite, Höhe)
        XCTAssertEqual(sample.width, InkPencilKit.baseWidth(of: Array(pencilStroke(sizes: varied).path.interpolatedPoints(by: .parametricStep(1)))))
    }

    func testPageModelEncodesSizesOnlyWithIncludeSizes() throws {
        let store = FakeInkPageStore()
        let model = InkPageModel(pageID: "seite-1", store: store, saveDelay: .seconds(3600))
        XCTAssertFalse(model.includeSizes)
        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [pencilStroke(sizes: varied)]))

        let plain = try XCTUnwrap(model.neutralStrokes().first)
        XCTAssertNil(plain.sizes)

        model.includeSizes = true
        let v2 = try XCTUnwrap(model.neutralStrokes().first)
        let sizes = try InkStrokeCodec.unpackSizes(try XCTUnwrap(v2.sizes))
        XCTAssertEqual(sizes.count, try InkStrokeCodec.unpackPoints(v2.points).count)
        XCTAssertEqual(v2.points, plain.points, "points ist mit und ohne sizes gleich")
        XCTAssertEqual(v2.clientID, plain.clientID)
    }

    func testPageModelSendsV2ChangesWhenIncludeSizesIsSet() throws {
        let model = InkPageModel(pageID: "seite-1", store: FakeInkPageStore(), saveDelay: .seconds(3600))
        model.includeSizes = true
        var received: [InkStrokeChange] = []
        model.onStrokeChanges = { received.append(contentsOf: $0) }
        model.canvasDidChange(layer: .ink, drawing: PKDrawing(strokes: [pencilStroke(sizes: varied)]))
        let upserts = received.compactMap { change -> Stroke? in
            if case .upsert(let stroke) = change { return stroke }
            return nil
        }
        XCTAssertEqual(upserts.count, 1)
        XCTAssertNotNil(upserts.first?.sizes)
    }

    // MARK: Abgleich

    private func sampleStroke(sizes: String?) -> Stroke {
        Stroke(
            bbox: [0, 0, 10, 10],
            clientID: "a",
            color: "#000000FF",
            createdAt: 1_762_246_500_000,
            layer: .ink,
            points: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            sizes: sizes,
            tEndMS: nil,
            tStartMS: nil,
            tool: .pen,
            transform: [1, 0, 0, 1, 0, 0],
            width: 2
        )
    }

    func testReconcilerTreatsStrokesWithAndWithoutSizesAsEqual() {
        let local = sampleStroke(sizes: "AAAAQAAAAEA=")
        let server = sampleStroke(sizes: nil)
        XCTAssertTrue(InkReconciler.isSame(local, server))
        XCTAssertTrue(InkReconciler.isSame(server, local))
        XCTAssertTrue(InkReconciler.plan(local: [local], server: [server]).isEmpty)
        XCTAssertTrue(InkReconciler.plan(local: [server], server: [local]).isEmpty)
    }
}
