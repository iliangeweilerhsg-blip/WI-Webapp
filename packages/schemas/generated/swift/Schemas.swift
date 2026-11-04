// GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen
// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse the JSON, add this file to your project and do:
//
//   let schemaBundle = try SchemaBundle(json)

import Foundation

/// GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen
// MARK: - SchemaBundle
struct SchemaBundle: Codable {
    let apiError: APIError?
    let apiErrorBody: APIErrorBody?
    let appearance: Appearance?
    let audioChunk: AudioChunk?
    let audioChunkMeta: AudioChunkMeta?
    let audioCodec: AudioCodec?
    let audioFinalizePayload: AudioFinalizePayload?
    let audioFinalizeResult: AudioFinalizeResult?
    let audioGap: AudioGap?
    let audioGapReason: AudioGapReason?
    let backupOverview: BackupOverview?
    let backupRun: BackupRun?
    let backupState: BackupState?
    let backupStatus: BackupStatus?
    let backupTrigger: BackupTrigger?
    let bBox: [Double]?
    let calendarAssignment: CalendarAssignment?
    let calendarEvent: CalendarEvent?
    let calendarEventKind: CalendarEventKind?
    let calendarEventList: CalendarEventList?
    let calendarEventUpdate: CalendarEventUpdate?
    let calendarSource: CalendarSource?
    let calendarSourceCreate: CalendarSourceCreate?
    let calendarSourceKind: CalendarSourceKind?
    let calendarSourceList: CalendarSourceList?
    let calendarUpdateScope: CalendarUpdateScope?
    let clientDevice: ClientDevice?
    let columnWidths: [Double]?
    let dashboardLayout: DashboardLayout?
    let dataSettings: DataSettings?
    let dataSettingsUpdate: DataSettingsUpdate?
    let device: Device?
    let deviceKind: DeviceKind?
    let deviceList: DeviceList?
    let drawingSnapshotData: DrawingSnapshotData?
    let drawingSnapshotOp: DrawingSnapshotOp?
    let elementRemoveData: ElementRemoveData?
    let elementRemoveOp: ElementRemoveOp?
    let elementUpsertData: ElementUpsertData?
    let elementUpsertOp: ElementUpsertOp?
    let epochMS: Int?
    let exerciseSheet: ExerciseSheet?
    let exerciseSheetList: ExerciseSheetList?
    let exerciseSheetUpdate: ExerciseSheetUpdate?
    let fileReceipt: FileReceipt?
    let fileRef: FileRef?
    let generalSettings: GeneralSettings?
    let generalSettingsUpdate: GeneralSettingsUpdate?
    let health: Health?
    let hexColor: String?
    let icsEventRef: ICSEventRef?
    let icsImportCounts: ICSImportCounts?
    let icsImportResult: ICSImportResult?
    let icsModuleSuggestion: ICSModuleSuggestion?
    let icsWarning: ICSWarning?
    let imageElement: ImageElement?
    let imageElementPayload: ImageElementPayload?
    let ingestState: IngestState?
    let inkMode: InkMode?
    let isoDate: String?
    let job: Job?
    let jobList: JobList?
    let jobState: JobState?
    let jobType: JobType?
    let lang: Lang?
    let lectureSettings: LectureSettings?
    let lectureSettingsUpdate: LectureSettingsUpdate?
    let maintenanceNightlyPayload: MaintenanceNightlyPayload?
    let maintenanceNightlyResult: MaintenanceNightlyResult?
    let marker: Marker?
    let markerAddData: MarkerAddData?
    let markerAddOp: MarkerAddOp?
    let markerKind: MarkerKindEnum?
    let markerPosition: MarkerPosition?
    let markerRemoveData: MarkerRemoveData?
    let markerRemoveOp: MarkerRemoveOp?
    let markerSource: MarkerSource?
    let module: Module?
    let moduleColor: ModuleColor?
    let moduleCreate: ModuleCreate?
    let moduleList: ModuleList?
    let moduleSettings: ModuleSettings?
    let moduleSettingsUpdate: ModuleSettingsUpdate?
    let moduleUpdate: ModuleUpdate?
    let notebook: Notebook?
    let notebookCreate: NotebookCreate?
    let notebookCreateData: NotebookCreateData?
    let notebookCreateOp: NotebookCreateOp?
    let notebookDeleteOp: NotebookDeleteOp?
    let notebookKind: NotebookKind?
    let notebookList: NotebookList?
    let notebookPages: NotebookPages?
    let notebookRefData: NotebookRefData?
    let notebookRestoreOp: NotebookRestoreOp?
    let notebookStreamID: String?
    let notebookUpdate: NotebookUpdate?
    let notebookUpdateData: NotebookUpdateData?
    let notebookUpdateFields: NotebookUpdateFields?
    let notebookUpdateOp: NotebookUpdateOp?
    let page: Page?
    let pageCreateData: PageCreateData?
    let pageCreateOp: PageCreateOp?
    let pageDeleteData: PageDeleteData?
    let pageDeleteOp: PageDeleteOp?
    let pageDetail: PageDetail?
    let pageElement: PageElement?
    let pageRefData: PageRefData?
    let pageRestoreOp: PageRestoreOp?
    let pageStrokes: PageStrokes?
    let pageTemplate: PageTemplate?
    let pageUpdateData: PageUpdateData?
    let pageUpdateFields: PageUpdateFields?
    let pageUpdateOp: PageUpdateOp?
    let pairConfirmRequest: PairConfirmRequest?
    let pairingCode: PairingCode?
    let pairingRequest: PairingRequest?
    let pairResponse: PairResponse?
    let pairStartRequest: PairStartRequest?
    let pairStartResponse: PairStartResponse?
    let pdfIngestDeckPayload: PDFIngestDeckPayload?
    let pdfIngestPayload: PDFIngestPayload?
    let pdfIngestResult: PDFIngestResult?
    let pdfIngestSheetPayload: PDFIngestSheetPayload?
    let pencilDoubleTapAction: PencilDoubleTapAction?
    let pencilSqueezeAction: PencilSqueezeAction?
    let penSettings: PenSettings?
    let penSettingsUpdate: PenSettingsUpdate?
    let photo: Photo?
    let photoAddData: PhotoAddData?
    let photoAddOp: PhotoAddOp?
    let photoFileRef: PhotoFileRef?
    let photoMIME: PhotoMIME?
    let point2: [Double]?
    let recording: Recording?
    let recordingComplete: RecordingComplete?
    let recordingCreate: RecordingCreate?
    let recordingState: RecordingState?
    let reviewState: ReviewState?
    let semester: Semester?
    let semesterCreate: SemesterCreate?
    let semesterList: SemesterList?
    let semesterUpdate: SemesterUpdate?
    let session: Session?
    let sessionCreate: SessionCreate?
    let sessionExtendRequest: SessionExtendRequest?
    let sessionList: SessionList?
    let sessionMS: Int?
    let sessionPauseOp: SessionPauseOp?
    let sessionProcessing: [String: JobState]?
    let sessionRefData: SessionRefData?
    let sessionResumeOp: SessionResumeOp?
    let sessionSnapshot: SessionSnapshot?
    let sessionStartData: SessionStartData?
    let sessionStartOffset: SessionStartOffset?
    let sessionStartOp: SessionStartOp?
    let sessionStartRequest: SessionStartRequest?
    let sessionStartResult: SessionStartResult?
    let sessionState: SessionState?
    let sessionStopData: SessionStopData?
    let sessionStopOp: SessionStopOp?
    let sessionStopRequest: SessionStopRequest?
    let sessionStreamID: String?
    let sessionUpdate: SessionUpdate?
    let settings: Settings?
    let settingsUpdate: SettingsUpdate?
    let sha256: String?
    let shapeElement: ShapeElement?
    let shapeElementPayload: ShapeElementPayload?
    let shapeKind: ShapeKind?
    let slide: Slide?
    let slideChangeData: SlideChangeData?
    let slideChangeOp: SlideChangeOp?
    let slideDeck: SlideDeck?
    let slideDeckDetail: SlideDeckDetail?
    let slideDeckList: SlideDeckList?
    let slideDeckUpdate: SlideDeckUpdate?
    let slideEvent: SlideEvent?
    let slideEventSource: SlideEventSource?
    let stampElement: StampElement?
    let stampElementPayload: StampElementPayload?
    let stopReason: StopReason?
    let stroke: Stroke?
    let strokeAddData: StrokeAddData?
    let strokeAddOp: StrokeAddOp?
    let strokeLayer: StrokeLayer?
    let strokeRemoveData: StrokeRemoveData?
    let strokeRemoveOp: StrokeRemoveOp?
    let strokeTool: StrokeTool?
    let syncACK: SyncACK?
    let syncClientKind: SyncClientKind?
    let syncClientMessage: SyncClientMessage?
    let syncConnectionEvent: SyncConnectionEvent?
    let syncConnectionInfo: SyncConnectionInfo?
    let syncError: SyncError?
    let syncErrorCode: SyncErrorCode?
    let syncEvent: SyncEvent?
    let syncHello: SyncHello?
    let syncOp: SyncOp?
    let syncOrigin: SyncOrigin?
    let syncPairingEvent: SyncPairingEvent?
    let syncPing: SyncPing?
    let syncPong: SyncPong?
    let syncPresence: SyncPresence?
    let syncPresenceEvent: SyncPresenceEvent?
    let syncPresenceInfo: SyncPresenceInfo?
    let syncResume: SyncResume?
    let syncServerMessage: SyncServerMessage?
    let syncSessionUpdatedEvent: SyncSessionUpdatedEvent?
    let syncStreamID: String?
    let syncStreamPosition: SyncStreamPosition?
    let syncSubscribe: SyncSubscribe?
    let syncSubscribed: SyncSubscribed?
    let syncTimeOffset: SyncTimeOffset?
    let syncTimePing: SyncTimePing?
    let syncTimePong: SyncTimePong?
    let syncUnsubscribe: SyncUnsubscribe?
    let syncWelcome: SyncWelcome?
    let tapeElement: TapeElement?
    let tapeElementPayload: TapeElementPayload?
    let task: Task?
    let textBlock: TextBlock?
    let textElement: TextElement?
    let textElementPayload: TextElementPayload?
    let textSize: TextSize?
    let timestamp: Date?
    let toolbarSide: ToolbarSide?
    let transform: [Double]?
    let trashItem: TrashItem?
    let trashKind: TrashKind?
    let trashList: TrashList?
    let trashParent: TrashParent?
    let trashRestoreResult: TrashRestoreResult?
    let uploadResult: UploadResult?
    let uuid: String?

    enum CodingKeys: String, CodingKey {
        case apiError = "ApiError"
        case apiErrorBody = "ApiErrorBody"
        case appearance = "Appearance"
        case audioChunk = "AudioChunk"
        case audioChunkMeta = "AudioChunkMeta"
        case audioCodec = "AudioCodec"
        case audioFinalizePayload = "AudioFinalizePayload"
        case audioFinalizeResult = "AudioFinalizeResult"
        case audioGap = "AudioGap"
        case audioGapReason = "AudioGapReason"
        case backupOverview = "BackupOverview"
        case backupRun = "BackupRun"
        case backupState = "BackupState"
        case backupStatus = "BackupStatus"
        case backupTrigger = "BackupTrigger"
        case bBox = "BBox"
        case calendarAssignment = "CalendarAssignment"
        case calendarEvent = "CalendarEvent"
        case calendarEventKind = "CalendarEventKind"
        case calendarEventList = "CalendarEventList"
        case calendarEventUpdate = "CalendarEventUpdate"
        case calendarSource = "CalendarSource"
        case calendarSourceCreate = "CalendarSourceCreate"
        case calendarSourceKind = "CalendarSourceKind"
        case calendarSourceList = "CalendarSourceList"
        case calendarUpdateScope = "CalendarUpdateScope"
        case clientDevice = "ClientDevice"
        case columnWidths = "ColumnWidths"
        case dashboardLayout = "DashboardLayout"
        case dataSettings = "DataSettings"
        case dataSettingsUpdate = "DataSettingsUpdate"
        case device = "Device"
        case deviceKind = "DeviceKind"
        case deviceList = "DeviceList"
        case drawingSnapshotData = "DrawingSnapshotData"
        case drawingSnapshotOp = "DrawingSnapshotOp"
        case elementRemoveData = "ElementRemoveData"
        case elementRemoveOp = "ElementRemoveOp"
        case elementUpsertData = "ElementUpsertData"
        case elementUpsertOp = "ElementUpsertOp"
        case epochMS = "EpochMs"
        case exerciseSheet = "ExerciseSheet"
        case exerciseSheetList = "ExerciseSheetList"
        case exerciseSheetUpdate = "ExerciseSheetUpdate"
        case fileReceipt = "FileReceipt"
        case fileRef = "FileRef"
        case generalSettings = "GeneralSettings"
        case generalSettingsUpdate = "GeneralSettingsUpdate"
        case health = "Health"
        case hexColor = "HexColor"
        case icsEventRef = "IcsEventRef"
        case icsImportCounts = "IcsImportCounts"
        case icsImportResult = "IcsImportResult"
        case icsModuleSuggestion = "IcsModuleSuggestion"
        case icsWarning = "IcsWarning"
        case imageElement = "ImageElement"
        case imageElementPayload = "ImageElementPayload"
        case ingestState = "IngestState"
        case inkMode = "InkMode"
        case isoDate = "IsoDate"
        case job = "Job"
        case jobList = "JobList"
        case jobState = "JobState"
        case jobType = "JobType"
        case lang = "Lang"
        case lectureSettings = "LectureSettings"
        case lectureSettingsUpdate = "LectureSettingsUpdate"
        case maintenanceNightlyPayload = "MaintenanceNightlyPayload"
        case maintenanceNightlyResult = "MaintenanceNightlyResult"
        case marker = "Marker"
        case markerAddData = "MarkerAddData"
        case markerAddOp = "MarkerAddOp"
        case markerKind = "MarkerKind"
        case markerPosition = "MarkerPosition"
        case markerRemoveData = "MarkerRemoveData"
        case markerRemoveOp = "MarkerRemoveOp"
        case markerSource = "MarkerSource"
        case module = "Module"
        case moduleColor = "ModuleColor"
        case moduleCreate = "ModuleCreate"
        case moduleList = "ModuleList"
        case moduleSettings = "ModuleSettings"
        case moduleSettingsUpdate = "ModuleSettingsUpdate"
        case moduleUpdate = "ModuleUpdate"
        case notebook = "Notebook"
        case notebookCreate = "NotebookCreate"
        case notebookCreateData = "NotebookCreateData"
        case notebookCreateOp = "NotebookCreateOp"
        case notebookDeleteOp = "NotebookDeleteOp"
        case notebookKind = "NotebookKind"
        case notebookList = "NotebookList"
        case notebookPages = "NotebookPages"
        case notebookRefData = "NotebookRefData"
        case notebookRestoreOp = "NotebookRestoreOp"
        case notebookStreamID = "NotebookStreamId"
        case notebookUpdate = "NotebookUpdate"
        case notebookUpdateData = "NotebookUpdateData"
        case notebookUpdateFields = "NotebookUpdateFields"
        case notebookUpdateOp = "NotebookUpdateOp"
        case page = "Page"
        case pageCreateData = "PageCreateData"
        case pageCreateOp = "PageCreateOp"
        case pageDeleteData = "PageDeleteData"
        case pageDeleteOp = "PageDeleteOp"
        case pageDetail = "PageDetail"
        case pageElement = "PageElement"
        case pageRefData = "PageRefData"
        case pageRestoreOp = "PageRestoreOp"
        case pageStrokes = "PageStrokes"
        case pageTemplate = "PageTemplate"
        case pageUpdateData = "PageUpdateData"
        case pageUpdateFields = "PageUpdateFields"
        case pageUpdateOp = "PageUpdateOp"
        case pairConfirmRequest = "PairConfirmRequest"
        case pairingCode = "PairingCode"
        case pairingRequest = "PairingRequest"
        case pairResponse = "PairResponse"
        case pairStartRequest = "PairStartRequest"
        case pairStartResponse = "PairStartResponse"
        case pdfIngestDeckPayload = "PdfIngestDeckPayload"
        case pdfIngestPayload = "PdfIngestPayload"
        case pdfIngestResult = "PdfIngestResult"
        case pdfIngestSheetPayload = "PdfIngestSheetPayload"
        case pencilDoubleTapAction = "PencilDoubleTapAction"
        case pencilSqueezeAction = "PencilSqueezeAction"
        case penSettings = "PenSettings"
        case penSettingsUpdate = "PenSettingsUpdate"
        case photo = "Photo"
        case photoAddData = "PhotoAddData"
        case photoAddOp = "PhotoAddOp"
        case photoFileRef = "PhotoFileRef"
        case photoMIME = "PhotoMime"
        case point2 = "Point2"
        case recording = "Recording"
        case recordingComplete = "RecordingComplete"
        case recordingCreate = "RecordingCreate"
        case recordingState = "RecordingState"
        case reviewState = "ReviewState"
        case semester = "Semester"
        case semesterCreate = "SemesterCreate"
        case semesterList = "SemesterList"
        case semesterUpdate = "SemesterUpdate"
        case session = "Session"
        case sessionCreate = "SessionCreate"
        case sessionExtendRequest = "SessionExtendRequest"
        case sessionList = "SessionList"
        case sessionMS = "SessionMs"
        case sessionPauseOp = "SessionPauseOp"
        case sessionProcessing = "SessionProcessing"
        case sessionRefData = "SessionRefData"
        case sessionResumeOp = "SessionResumeOp"
        case sessionSnapshot = "SessionSnapshot"
        case sessionStartData = "SessionStartData"
        case sessionStartOffset = "SessionStartOffset"
        case sessionStartOp = "SessionStartOp"
        case sessionStartRequest = "SessionStartRequest"
        case sessionStartResult = "SessionStartResult"
        case sessionState = "SessionState"
        case sessionStopData = "SessionStopData"
        case sessionStopOp = "SessionStopOp"
        case sessionStopRequest = "SessionStopRequest"
        case sessionStreamID = "SessionStreamId"
        case sessionUpdate = "SessionUpdate"
        case settings = "Settings"
        case settingsUpdate = "SettingsUpdate"
        case sha256 = "Sha256"
        case shapeElement = "ShapeElement"
        case shapeElementPayload = "ShapeElementPayload"
        case shapeKind = "ShapeKind"
        case slide = "Slide"
        case slideChangeData = "SlideChangeData"
        case slideChangeOp = "SlideChangeOp"
        case slideDeck = "SlideDeck"
        case slideDeckDetail = "SlideDeckDetail"
        case slideDeckList = "SlideDeckList"
        case slideDeckUpdate = "SlideDeckUpdate"
        case slideEvent = "SlideEvent"
        case slideEventSource = "SlideEventSource"
        case stampElement = "StampElement"
        case stampElementPayload = "StampElementPayload"
        case stopReason = "StopReason"
        case stroke = "Stroke"
        case strokeAddData = "StrokeAddData"
        case strokeAddOp = "StrokeAddOp"
        case strokeLayer = "StrokeLayer"
        case strokeRemoveData = "StrokeRemoveData"
        case strokeRemoveOp = "StrokeRemoveOp"
        case strokeTool = "StrokeTool"
        case syncACK = "SyncAck"
        case syncClientKind = "SyncClientKind"
        case syncClientMessage = "SyncClientMessage"
        case syncConnectionEvent = "SyncConnectionEvent"
        case syncConnectionInfo = "SyncConnectionInfo"
        case syncError = "SyncError"
        case syncErrorCode = "SyncErrorCode"
        case syncEvent = "SyncEvent"
        case syncHello = "SyncHello"
        case syncOp = "SyncOp"
        case syncOrigin = "SyncOrigin"
        case syncPairingEvent = "SyncPairingEvent"
        case syncPing = "SyncPing"
        case syncPong = "SyncPong"
        case syncPresence = "SyncPresence"
        case syncPresenceEvent = "SyncPresenceEvent"
        case syncPresenceInfo = "SyncPresenceInfo"
        case syncResume = "SyncResume"
        case syncServerMessage = "SyncServerMessage"
        case syncSessionUpdatedEvent = "SyncSessionUpdatedEvent"
        case syncStreamID = "SyncStreamId"
        case syncStreamPosition = "SyncStreamPosition"
        case syncSubscribe = "SyncSubscribe"
        case syncSubscribed = "SyncSubscribed"
        case syncTimeOffset = "SyncTimeOffset"
        case syncTimePing = "SyncTimePing"
        case syncTimePong = "SyncTimePong"
        case syncUnsubscribe = "SyncUnsubscribe"
        case syncWelcome = "SyncWelcome"
        case tapeElement = "TapeElement"
        case tapeElementPayload = "TapeElementPayload"
        case task = "Task"
        case textBlock = "TextBlock"
        case textElement = "TextElement"
        case textElementPayload = "TextElementPayload"
        case textSize = "TextSize"
        case timestamp = "Timestamp"
        case toolbarSide = "ToolbarSide"
        case transform = "Transform"
        case trashItem = "TrashItem"
        case trashKind = "TrashKind"
        case trashList = "TrashList"
        case trashParent = "TrashParent"
        case trashRestoreResult = "TrashRestoreResult"
        case uploadResult = "UploadResult"
        case uuid = "Uuid"
    }
}

// MARK: SchemaBundle convenience initializers and mutators

extension SchemaBundle {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SchemaBundle.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        apiError: APIError?? = nil,
        apiErrorBody: APIErrorBody?? = nil,
        appearance: Appearance?? = nil,
        audioChunk: AudioChunk?? = nil,
        audioChunkMeta: AudioChunkMeta?? = nil,
        audioCodec: AudioCodec?? = nil,
        audioFinalizePayload: AudioFinalizePayload?? = nil,
        audioFinalizeResult: AudioFinalizeResult?? = nil,
        audioGap: AudioGap?? = nil,
        audioGapReason: AudioGapReason?? = nil,
        backupOverview: BackupOverview?? = nil,
        backupRun: BackupRun?? = nil,
        backupState: BackupState?? = nil,
        backupStatus: BackupStatus?? = nil,
        backupTrigger: BackupTrigger?? = nil,
        bBox: [Double]?? = nil,
        calendarAssignment: CalendarAssignment?? = nil,
        calendarEvent: CalendarEvent?? = nil,
        calendarEventKind: CalendarEventKind?? = nil,
        calendarEventList: CalendarEventList?? = nil,
        calendarEventUpdate: CalendarEventUpdate?? = nil,
        calendarSource: CalendarSource?? = nil,
        calendarSourceCreate: CalendarSourceCreate?? = nil,
        calendarSourceKind: CalendarSourceKind?? = nil,
        calendarSourceList: CalendarSourceList?? = nil,
        calendarUpdateScope: CalendarUpdateScope?? = nil,
        clientDevice: ClientDevice?? = nil,
        columnWidths: [Double]?? = nil,
        dashboardLayout: DashboardLayout?? = nil,
        dataSettings: DataSettings?? = nil,
        dataSettingsUpdate: DataSettingsUpdate?? = nil,
        device: Device?? = nil,
        deviceKind: DeviceKind?? = nil,
        deviceList: DeviceList?? = nil,
        drawingSnapshotData: DrawingSnapshotData?? = nil,
        drawingSnapshotOp: DrawingSnapshotOp?? = nil,
        elementRemoveData: ElementRemoveData?? = nil,
        elementRemoveOp: ElementRemoveOp?? = nil,
        elementUpsertData: ElementUpsertData?? = nil,
        elementUpsertOp: ElementUpsertOp?? = nil,
        epochMS: Int?? = nil,
        exerciseSheet: ExerciseSheet?? = nil,
        exerciseSheetList: ExerciseSheetList?? = nil,
        exerciseSheetUpdate: ExerciseSheetUpdate?? = nil,
        fileReceipt: FileReceipt?? = nil,
        fileRef: FileRef?? = nil,
        generalSettings: GeneralSettings?? = nil,
        generalSettingsUpdate: GeneralSettingsUpdate?? = nil,
        health: Health?? = nil,
        hexColor: String?? = nil,
        icsEventRef: ICSEventRef?? = nil,
        icsImportCounts: ICSImportCounts?? = nil,
        icsImportResult: ICSImportResult?? = nil,
        icsModuleSuggestion: ICSModuleSuggestion?? = nil,
        icsWarning: ICSWarning?? = nil,
        imageElement: ImageElement?? = nil,
        imageElementPayload: ImageElementPayload?? = nil,
        ingestState: IngestState?? = nil,
        inkMode: InkMode?? = nil,
        isoDate: String?? = nil,
        job: Job?? = nil,
        jobList: JobList?? = nil,
        jobState: JobState?? = nil,
        jobType: JobType?? = nil,
        lang: Lang?? = nil,
        lectureSettings: LectureSettings?? = nil,
        lectureSettingsUpdate: LectureSettingsUpdate?? = nil,
        maintenanceNightlyPayload: MaintenanceNightlyPayload?? = nil,
        maintenanceNightlyResult: MaintenanceNightlyResult?? = nil,
        marker: Marker?? = nil,
        markerAddData: MarkerAddData?? = nil,
        markerAddOp: MarkerAddOp?? = nil,
        markerKind: MarkerKindEnum?? = nil,
        markerPosition: MarkerPosition?? = nil,
        markerRemoveData: MarkerRemoveData?? = nil,
        markerRemoveOp: MarkerRemoveOp?? = nil,
        markerSource: MarkerSource?? = nil,
        module: Module?? = nil,
        moduleColor: ModuleColor?? = nil,
        moduleCreate: ModuleCreate?? = nil,
        moduleList: ModuleList?? = nil,
        moduleSettings: ModuleSettings?? = nil,
        moduleSettingsUpdate: ModuleSettingsUpdate?? = nil,
        moduleUpdate: ModuleUpdate?? = nil,
        notebook: Notebook?? = nil,
        notebookCreate: NotebookCreate?? = nil,
        notebookCreateData: NotebookCreateData?? = nil,
        notebookCreateOp: NotebookCreateOp?? = nil,
        notebookDeleteOp: NotebookDeleteOp?? = nil,
        notebookKind: NotebookKind?? = nil,
        notebookList: NotebookList?? = nil,
        notebookPages: NotebookPages?? = nil,
        notebookRefData: NotebookRefData?? = nil,
        notebookRestoreOp: NotebookRestoreOp?? = nil,
        notebookStreamID: String?? = nil,
        notebookUpdate: NotebookUpdate?? = nil,
        notebookUpdateData: NotebookUpdateData?? = nil,
        notebookUpdateFields: NotebookUpdateFields?? = nil,
        notebookUpdateOp: NotebookUpdateOp?? = nil,
        page: Page?? = nil,
        pageCreateData: PageCreateData?? = nil,
        pageCreateOp: PageCreateOp?? = nil,
        pageDeleteData: PageDeleteData?? = nil,
        pageDeleteOp: PageDeleteOp?? = nil,
        pageDetail: PageDetail?? = nil,
        pageElement: PageElement?? = nil,
        pageRefData: PageRefData?? = nil,
        pageRestoreOp: PageRestoreOp?? = nil,
        pageStrokes: PageStrokes?? = nil,
        pageTemplate: PageTemplate?? = nil,
        pageUpdateData: PageUpdateData?? = nil,
        pageUpdateFields: PageUpdateFields?? = nil,
        pageUpdateOp: PageUpdateOp?? = nil,
        pairConfirmRequest: PairConfirmRequest?? = nil,
        pairingCode: PairingCode?? = nil,
        pairingRequest: PairingRequest?? = nil,
        pairResponse: PairResponse?? = nil,
        pairStartRequest: PairStartRequest?? = nil,
        pairStartResponse: PairStartResponse?? = nil,
        pdfIngestDeckPayload: PDFIngestDeckPayload?? = nil,
        pdfIngestPayload: PDFIngestPayload?? = nil,
        pdfIngestResult: PDFIngestResult?? = nil,
        pdfIngestSheetPayload: PDFIngestSheetPayload?? = nil,
        pencilDoubleTapAction: PencilDoubleTapAction?? = nil,
        pencilSqueezeAction: PencilSqueezeAction?? = nil,
        penSettings: PenSettings?? = nil,
        penSettingsUpdate: PenSettingsUpdate?? = nil,
        photo: Photo?? = nil,
        photoAddData: PhotoAddData?? = nil,
        photoAddOp: PhotoAddOp?? = nil,
        photoFileRef: PhotoFileRef?? = nil,
        photoMIME: PhotoMIME?? = nil,
        point2: [Double]?? = nil,
        recording: Recording?? = nil,
        recordingComplete: RecordingComplete?? = nil,
        recordingCreate: RecordingCreate?? = nil,
        recordingState: RecordingState?? = nil,
        reviewState: ReviewState?? = nil,
        semester: Semester?? = nil,
        semesterCreate: SemesterCreate?? = nil,
        semesterList: SemesterList?? = nil,
        semesterUpdate: SemesterUpdate?? = nil,
        session: Session?? = nil,
        sessionCreate: SessionCreate?? = nil,
        sessionExtendRequest: SessionExtendRequest?? = nil,
        sessionList: SessionList?? = nil,
        sessionMS: Int?? = nil,
        sessionPauseOp: SessionPauseOp?? = nil,
        sessionProcessing: [String: JobState]?? = nil,
        sessionRefData: SessionRefData?? = nil,
        sessionResumeOp: SessionResumeOp?? = nil,
        sessionSnapshot: SessionSnapshot?? = nil,
        sessionStartData: SessionStartData?? = nil,
        sessionStartOffset: SessionStartOffset?? = nil,
        sessionStartOp: SessionStartOp?? = nil,
        sessionStartRequest: SessionStartRequest?? = nil,
        sessionStartResult: SessionStartResult?? = nil,
        sessionState: SessionState?? = nil,
        sessionStopData: SessionStopData?? = nil,
        sessionStopOp: SessionStopOp?? = nil,
        sessionStopRequest: SessionStopRequest?? = nil,
        sessionStreamID: String?? = nil,
        sessionUpdate: SessionUpdate?? = nil,
        settings: Settings?? = nil,
        settingsUpdate: SettingsUpdate?? = nil,
        sha256: String?? = nil,
        shapeElement: ShapeElement?? = nil,
        shapeElementPayload: ShapeElementPayload?? = nil,
        shapeKind: ShapeKind?? = nil,
        slide: Slide?? = nil,
        slideChangeData: SlideChangeData?? = nil,
        slideChangeOp: SlideChangeOp?? = nil,
        slideDeck: SlideDeck?? = nil,
        slideDeckDetail: SlideDeckDetail?? = nil,
        slideDeckList: SlideDeckList?? = nil,
        slideDeckUpdate: SlideDeckUpdate?? = nil,
        slideEvent: SlideEvent?? = nil,
        slideEventSource: SlideEventSource?? = nil,
        stampElement: StampElement?? = nil,
        stampElementPayload: StampElementPayload?? = nil,
        stopReason: StopReason?? = nil,
        stroke: Stroke?? = nil,
        strokeAddData: StrokeAddData?? = nil,
        strokeAddOp: StrokeAddOp?? = nil,
        strokeLayer: StrokeLayer?? = nil,
        strokeRemoveData: StrokeRemoveData?? = nil,
        strokeRemoveOp: StrokeRemoveOp?? = nil,
        strokeTool: StrokeTool?? = nil,
        syncACK: SyncACK?? = nil,
        syncClientKind: SyncClientKind?? = nil,
        syncClientMessage: SyncClientMessage?? = nil,
        syncConnectionEvent: SyncConnectionEvent?? = nil,
        syncConnectionInfo: SyncConnectionInfo?? = nil,
        syncError: SyncError?? = nil,
        syncErrorCode: SyncErrorCode?? = nil,
        syncEvent: SyncEvent?? = nil,
        syncHello: SyncHello?? = nil,
        syncOp: SyncOp?? = nil,
        syncOrigin: SyncOrigin?? = nil,
        syncPairingEvent: SyncPairingEvent?? = nil,
        syncPing: SyncPing?? = nil,
        syncPong: SyncPong?? = nil,
        syncPresence: SyncPresence?? = nil,
        syncPresenceEvent: SyncPresenceEvent?? = nil,
        syncPresenceInfo: SyncPresenceInfo?? = nil,
        syncResume: SyncResume?? = nil,
        syncServerMessage: SyncServerMessage?? = nil,
        syncSessionUpdatedEvent: SyncSessionUpdatedEvent?? = nil,
        syncStreamID: String?? = nil,
        syncStreamPosition: SyncStreamPosition?? = nil,
        syncSubscribe: SyncSubscribe?? = nil,
        syncSubscribed: SyncSubscribed?? = nil,
        syncTimeOffset: SyncTimeOffset?? = nil,
        syncTimePing: SyncTimePing?? = nil,
        syncTimePong: SyncTimePong?? = nil,
        syncUnsubscribe: SyncUnsubscribe?? = nil,
        syncWelcome: SyncWelcome?? = nil,
        tapeElement: TapeElement?? = nil,
        tapeElementPayload: TapeElementPayload?? = nil,
        task: Task?? = nil,
        textBlock: TextBlock?? = nil,
        textElement: TextElement?? = nil,
        textElementPayload: TextElementPayload?? = nil,
        textSize: TextSize?? = nil,
        timestamp: Date?? = nil,
        toolbarSide: ToolbarSide?? = nil,
        transform: [Double]?? = nil,
        trashItem: TrashItem?? = nil,
        trashKind: TrashKind?? = nil,
        trashList: TrashList?? = nil,
        trashParent: TrashParent?? = nil,
        trashRestoreResult: TrashRestoreResult?? = nil,
        uploadResult: UploadResult?? = nil,
        uuid: String?? = nil
    ) -> SchemaBundle {
        return SchemaBundle(
            apiError: apiError ?? self.apiError,
            apiErrorBody: apiErrorBody ?? self.apiErrorBody,
            appearance: appearance ?? self.appearance,
            audioChunk: audioChunk ?? self.audioChunk,
            audioChunkMeta: audioChunkMeta ?? self.audioChunkMeta,
            audioCodec: audioCodec ?? self.audioCodec,
            audioFinalizePayload: audioFinalizePayload ?? self.audioFinalizePayload,
            audioFinalizeResult: audioFinalizeResult ?? self.audioFinalizeResult,
            audioGap: audioGap ?? self.audioGap,
            audioGapReason: audioGapReason ?? self.audioGapReason,
            backupOverview: backupOverview ?? self.backupOverview,
            backupRun: backupRun ?? self.backupRun,
            backupState: backupState ?? self.backupState,
            backupStatus: backupStatus ?? self.backupStatus,
            backupTrigger: backupTrigger ?? self.backupTrigger,
            bBox: bBox ?? self.bBox,
            calendarAssignment: calendarAssignment ?? self.calendarAssignment,
            calendarEvent: calendarEvent ?? self.calendarEvent,
            calendarEventKind: calendarEventKind ?? self.calendarEventKind,
            calendarEventList: calendarEventList ?? self.calendarEventList,
            calendarEventUpdate: calendarEventUpdate ?? self.calendarEventUpdate,
            calendarSource: calendarSource ?? self.calendarSource,
            calendarSourceCreate: calendarSourceCreate ?? self.calendarSourceCreate,
            calendarSourceKind: calendarSourceKind ?? self.calendarSourceKind,
            calendarSourceList: calendarSourceList ?? self.calendarSourceList,
            calendarUpdateScope: calendarUpdateScope ?? self.calendarUpdateScope,
            clientDevice: clientDevice ?? self.clientDevice,
            columnWidths: columnWidths ?? self.columnWidths,
            dashboardLayout: dashboardLayout ?? self.dashboardLayout,
            dataSettings: dataSettings ?? self.dataSettings,
            dataSettingsUpdate: dataSettingsUpdate ?? self.dataSettingsUpdate,
            device: device ?? self.device,
            deviceKind: deviceKind ?? self.deviceKind,
            deviceList: deviceList ?? self.deviceList,
            drawingSnapshotData: drawingSnapshotData ?? self.drawingSnapshotData,
            drawingSnapshotOp: drawingSnapshotOp ?? self.drawingSnapshotOp,
            elementRemoveData: elementRemoveData ?? self.elementRemoveData,
            elementRemoveOp: elementRemoveOp ?? self.elementRemoveOp,
            elementUpsertData: elementUpsertData ?? self.elementUpsertData,
            elementUpsertOp: elementUpsertOp ?? self.elementUpsertOp,
            epochMS: epochMS ?? self.epochMS,
            exerciseSheet: exerciseSheet ?? self.exerciseSheet,
            exerciseSheetList: exerciseSheetList ?? self.exerciseSheetList,
            exerciseSheetUpdate: exerciseSheetUpdate ?? self.exerciseSheetUpdate,
            fileReceipt: fileReceipt ?? self.fileReceipt,
            fileRef: fileRef ?? self.fileRef,
            generalSettings: generalSettings ?? self.generalSettings,
            generalSettingsUpdate: generalSettingsUpdate ?? self.generalSettingsUpdate,
            health: health ?? self.health,
            hexColor: hexColor ?? self.hexColor,
            icsEventRef: icsEventRef ?? self.icsEventRef,
            icsImportCounts: icsImportCounts ?? self.icsImportCounts,
            icsImportResult: icsImportResult ?? self.icsImportResult,
            icsModuleSuggestion: icsModuleSuggestion ?? self.icsModuleSuggestion,
            icsWarning: icsWarning ?? self.icsWarning,
            imageElement: imageElement ?? self.imageElement,
            imageElementPayload: imageElementPayload ?? self.imageElementPayload,
            ingestState: ingestState ?? self.ingestState,
            inkMode: inkMode ?? self.inkMode,
            isoDate: isoDate ?? self.isoDate,
            job: job ?? self.job,
            jobList: jobList ?? self.jobList,
            jobState: jobState ?? self.jobState,
            jobType: jobType ?? self.jobType,
            lang: lang ?? self.lang,
            lectureSettings: lectureSettings ?? self.lectureSettings,
            lectureSettingsUpdate: lectureSettingsUpdate ?? self.lectureSettingsUpdate,
            maintenanceNightlyPayload: maintenanceNightlyPayload ?? self.maintenanceNightlyPayload,
            maintenanceNightlyResult: maintenanceNightlyResult ?? self.maintenanceNightlyResult,
            marker: marker ?? self.marker,
            markerAddData: markerAddData ?? self.markerAddData,
            markerAddOp: markerAddOp ?? self.markerAddOp,
            markerKind: markerKind ?? self.markerKind,
            markerPosition: markerPosition ?? self.markerPosition,
            markerRemoveData: markerRemoveData ?? self.markerRemoveData,
            markerRemoveOp: markerRemoveOp ?? self.markerRemoveOp,
            markerSource: markerSource ?? self.markerSource,
            module: module ?? self.module,
            moduleColor: moduleColor ?? self.moduleColor,
            moduleCreate: moduleCreate ?? self.moduleCreate,
            moduleList: moduleList ?? self.moduleList,
            moduleSettings: moduleSettings ?? self.moduleSettings,
            moduleSettingsUpdate: moduleSettingsUpdate ?? self.moduleSettingsUpdate,
            moduleUpdate: moduleUpdate ?? self.moduleUpdate,
            notebook: notebook ?? self.notebook,
            notebookCreate: notebookCreate ?? self.notebookCreate,
            notebookCreateData: notebookCreateData ?? self.notebookCreateData,
            notebookCreateOp: notebookCreateOp ?? self.notebookCreateOp,
            notebookDeleteOp: notebookDeleteOp ?? self.notebookDeleteOp,
            notebookKind: notebookKind ?? self.notebookKind,
            notebookList: notebookList ?? self.notebookList,
            notebookPages: notebookPages ?? self.notebookPages,
            notebookRefData: notebookRefData ?? self.notebookRefData,
            notebookRestoreOp: notebookRestoreOp ?? self.notebookRestoreOp,
            notebookStreamID: notebookStreamID ?? self.notebookStreamID,
            notebookUpdate: notebookUpdate ?? self.notebookUpdate,
            notebookUpdateData: notebookUpdateData ?? self.notebookUpdateData,
            notebookUpdateFields: notebookUpdateFields ?? self.notebookUpdateFields,
            notebookUpdateOp: notebookUpdateOp ?? self.notebookUpdateOp,
            page: page ?? self.page,
            pageCreateData: pageCreateData ?? self.pageCreateData,
            pageCreateOp: pageCreateOp ?? self.pageCreateOp,
            pageDeleteData: pageDeleteData ?? self.pageDeleteData,
            pageDeleteOp: pageDeleteOp ?? self.pageDeleteOp,
            pageDetail: pageDetail ?? self.pageDetail,
            pageElement: pageElement ?? self.pageElement,
            pageRefData: pageRefData ?? self.pageRefData,
            pageRestoreOp: pageRestoreOp ?? self.pageRestoreOp,
            pageStrokes: pageStrokes ?? self.pageStrokes,
            pageTemplate: pageTemplate ?? self.pageTemplate,
            pageUpdateData: pageUpdateData ?? self.pageUpdateData,
            pageUpdateFields: pageUpdateFields ?? self.pageUpdateFields,
            pageUpdateOp: pageUpdateOp ?? self.pageUpdateOp,
            pairConfirmRequest: pairConfirmRequest ?? self.pairConfirmRequest,
            pairingCode: pairingCode ?? self.pairingCode,
            pairingRequest: pairingRequest ?? self.pairingRequest,
            pairResponse: pairResponse ?? self.pairResponse,
            pairStartRequest: pairStartRequest ?? self.pairStartRequest,
            pairStartResponse: pairStartResponse ?? self.pairStartResponse,
            pdfIngestDeckPayload: pdfIngestDeckPayload ?? self.pdfIngestDeckPayload,
            pdfIngestPayload: pdfIngestPayload ?? self.pdfIngestPayload,
            pdfIngestResult: pdfIngestResult ?? self.pdfIngestResult,
            pdfIngestSheetPayload: pdfIngestSheetPayload ?? self.pdfIngestSheetPayload,
            pencilDoubleTapAction: pencilDoubleTapAction ?? self.pencilDoubleTapAction,
            pencilSqueezeAction: pencilSqueezeAction ?? self.pencilSqueezeAction,
            penSettings: penSettings ?? self.penSettings,
            penSettingsUpdate: penSettingsUpdate ?? self.penSettingsUpdate,
            photo: photo ?? self.photo,
            photoAddData: photoAddData ?? self.photoAddData,
            photoAddOp: photoAddOp ?? self.photoAddOp,
            photoFileRef: photoFileRef ?? self.photoFileRef,
            photoMIME: photoMIME ?? self.photoMIME,
            point2: point2 ?? self.point2,
            recording: recording ?? self.recording,
            recordingComplete: recordingComplete ?? self.recordingComplete,
            recordingCreate: recordingCreate ?? self.recordingCreate,
            recordingState: recordingState ?? self.recordingState,
            reviewState: reviewState ?? self.reviewState,
            semester: semester ?? self.semester,
            semesterCreate: semesterCreate ?? self.semesterCreate,
            semesterList: semesterList ?? self.semesterList,
            semesterUpdate: semesterUpdate ?? self.semesterUpdate,
            session: session ?? self.session,
            sessionCreate: sessionCreate ?? self.sessionCreate,
            sessionExtendRequest: sessionExtendRequest ?? self.sessionExtendRequest,
            sessionList: sessionList ?? self.sessionList,
            sessionMS: sessionMS ?? self.sessionMS,
            sessionPauseOp: sessionPauseOp ?? self.sessionPauseOp,
            sessionProcessing: sessionProcessing ?? self.sessionProcessing,
            sessionRefData: sessionRefData ?? self.sessionRefData,
            sessionResumeOp: sessionResumeOp ?? self.sessionResumeOp,
            sessionSnapshot: sessionSnapshot ?? self.sessionSnapshot,
            sessionStartData: sessionStartData ?? self.sessionStartData,
            sessionStartOffset: sessionStartOffset ?? self.sessionStartOffset,
            sessionStartOp: sessionStartOp ?? self.sessionStartOp,
            sessionStartRequest: sessionStartRequest ?? self.sessionStartRequest,
            sessionStartResult: sessionStartResult ?? self.sessionStartResult,
            sessionState: sessionState ?? self.sessionState,
            sessionStopData: sessionStopData ?? self.sessionStopData,
            sessionStopOp: sessionStopOp ?? self.sessionStopOp,
            sessionStopRequest: sessionStopRequest ?? self.sessionStopRequest,
            sessionStreamID: sessionStreamID ?? self.sessionStreamID,
            sessionUpdate: sessionUpdate ?? self.sessionUpdate,
            settings: settings ?? self.settings,
            settingsUpdate: settingsUpdate ?? self.settingsUpdate,
            sha256: sha256 ?? self.sha256,
            shapeElement: shapeElement ?? self.shapeElement,
            shapeElementPayload: shapeElementPayload ?? self.shapeElementPayload,
            shapeKind: shapeKind ?? self.shapeKind,
            slide: slide ?? self.slide,
            slideChangeData: slideChangeData ?? self.slideChangeData,
            slideChangeOp: slideChangeOp ?? self.slideChangeOp,
            slideDeck: slideDeck ?? self.slideDeck,
            slideDeckDetail: slideDeckDetail ?? self.slideDeckDetail,
            slideDeckList: slideDeckList ?? self.slideDeckList,
            slideDeckUpdate: slideDeckUpdate ?? self.slideDeckUpdate,
            slideEvent: slideEvent ?? self.slideEvent,
            slideEventSource: slideEventSource ?? self.slideEventSource,
            stampElement: stampElement ?? self.stampElement,
            stampElementPayload: stampElementPayload ?? self.stampElementPayload,
            stopReason: stopReason ?? self.stopReason,
            stroke: stroke ?? self.stroke,
            strokeAddData: strokeAddData ?? self.strokeAddData,
            strokeAddOp: strokeAddOp ?? self.strokeAddOp,
            strokeLayer: strokeLayer ?? self.strokeLayer,
            strokeRemoveData: strokeRemoveData ?? self.strokeRemoveData,
            strokeRemoveOp: strokeRemoveOp ?? self.strokeRemoveOp,
            strokeTool: strokeTool ?? self.strokeTool,
            syncACK: syncACK ?? self.syncACK,
            syncClientKind: syncClientKind ?? self.syncClientKind,
            syncClientMessage: syncClientMessage ?? self.syncClientMessage,
            syncConnectionEvent: syncConnectionEvent ?? self.syncConnectionEvent,
            syncConnectionInfo: syncConnectionInfo ?? self.syncConnectionInfo,
            syncError: syncError ?? self.syncError,
            syncErrorCode: syncErrorCode ?? self.syncErrorCode,
            syncEvent: syncEvent ?? self.syncEvent,
            syncHello: syncHello ?? self.syncHello,
            syncOp: syncOp ?? self.syncOp,
            syncOrigin: syncOrigin ?? self.syncOrigin,
            syncPairingEvent: syncPairingEvent ?? self.syncPairingEvent,
            syncPing: syncPing ?? self.syncPing,
            syncPong: syncPong ?? self.syncPong,
            syncPresence: syncPresence ?? self.syncPresence,
            syncPresenceEvent: syncPresenceEvent ?? self.syncPresenceEvent,
            syncPresenceInfo: syncPresenceInfo ?? self.syncPresenceInfo,
            syncResume: syncResume ?? self.syncResume,
            syncServerMessage: syncServerMessage ?? self.syncServerMessage,
            syncSessionUpdatedEvent: syncSessionUpdatedEvent ?? self.syncSessionUpdatedEvent,
            syncStreamID: syncStreamID ?? self.syncStreamID,
            syncStreamPosition: syncStreamPosition ?? self.syncStreamPosition,
            syncSubscribe: syncSubscribe ?? self.syncSubscribe,
            syncSubscribed: syncSubscribed ?? self.syncSubscribed,
            syncTimeOffset: syncTimeOffset ?? self.syncTimeOffset,
            syncTimePing: syncTimePing ?? self.syncTimePing,
            syncTimePong: syncTimePong ?? self.syncTimePong,
            syncUnsubscribe: syncUnsubscribe ?? self.syncUnsubscribe,
            syncWelcome: syncWelcome ?? self.syncWelcome,
            tapeElement: tapeElement ?? self.tapeElement,
            tapeElementPayload: tapeElementPayload ?? self.tapeElementPayload,
            task: task ?? self.task,
            textBlock: textBlock ?? self.textBlock,
            textElement: textElement ?? self.textElement,
            textElementPayload: textElementPayload ?? self.textElementPayload,
            textSize: textSize ?? self.textSize,
            timestamp: timestamp ?? self.timestamp,
            toolbarSide: toolbarSide ?? self.toolbarSide,
            transform: transform ?? self.transform,
            trashItem: trashItem ?? self.trashItem,
            trashKind: trashKind ?? self.trashKind,
            trashList: trashList ?? self.trashList,
            trashParent: trashParent ?? self.trashParent,
            trashRestoreResult: trashRestoreResult ?? self.trashRestoreResult,
            uploadResult: uploadResult ?? self.uploadResult,
            uuid: uuid ?? self.uuid
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Fehlerformat der REST-API (08 §1)
// MARK: - APIError
struct APIError: Codable {
    let error: APIErrorBody

    enum CodingKeys: String, CodingKey {
        case error = "error"
    }
}

// MARK: APIError convenience initializers and mutators

extension APIError {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(APIError.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        error: APIErrorBody? = nil
    ) -> APIError {
        return APIError(
            error: error ?? self.error
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - APIErrorBody
struct APIErrorBody: Codable {
    let code: String
    let details: [String: JSONAny]?
    let message: String

    enum CodingKeys: String, CodingKey {
        case code = "code"
        case details = "details"
        case message = "message"
    }
}

// MARK: APIErrorBody convenience initializers and mutators

extension APIErrorBody {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(APIErrorBody.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        code: String? = nil,
        details: [String: JSONAny]?? = nil,
        message: String? = nil
    ) -> APIErrorBody {
        return APIErrorBody(
            code: code ?? self.code,
            details: details ?? self.details,
            message: message ?? self.message
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum Appearance: String, Codable {
    case dunkel = "dunkel"
    case hell = "hell"
    case system = "system"
}

/// Antwort auf PUT /recordings/{id}/chunks/{seq}
// MARK: - AudioChunk
struct AudioChunk: Codable {
    /// true: identischer Chunk lag schon vor (200 statt 201)
    let duplicate: Bool
    let durationMS: Int
    let receivedAt: Date
    let recordingID: String
    let seq: Int
    let sha256: String
    let sizeBytes: Int
    let startMS: Int

    enum CodingKeys: String, CodingKey {
        case duplicate = "duplicate"
        case durationMS = "duration_ms"
        case receivedAt = "received_at"
        case recordingID = "recording_id"
        case seq = "seq"
        case sha256 = "sha256"
        case sizeBytes = "size_bytes"
        case startMS = "start_ms"
    }
}

// MARK: AudioChunk convenience initializers and mutators

extension AudioChunk {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(AudioChunk.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        duplicate: Bool? = nil,
        durationMS: Int? = nil,
        receivedAt: Date? = nil,
        recordingID: String? = nil,
        seq: Int? = nil,
        sha256: String? = nil,
        sizeBytes: Int? = nil,
        startMS: Int? = nil
    ) -> AudioChunk {
        return AudioChunk(
            duplicate: duplicate ?? self.duplicate,
            durationMS: durationMS ?? self.durationMS,
            receivedAt: receivedAt ?? self.receivedAt,
            recordingID: recordingID ?? self.recordingID,
            seq: seq ?? self.seq,
            sha256: sha256 ?? self.sha256,
            sizeBytes: sizeBytes ?? self.sizeBytes,
            startMS: startMS ?? self.startMS
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Geparste Metadaten von PUT /recordings/{id}/chunks/{seq}: Header X-Start-Ms,
/// X-Duration-Ms (Dezimalzahlen), X-Sha256 (hex des Bodys)
// MARK: - AudioChunkMeta
struct AudioChunkMeta: Codable {
    let durationMS: Int
    /// Pfad {seq}, 0-basiert, lückenlos (Invariante 2)
    let seq: Int
    let sha256: String
    let startMS: Int

    enum CodingKeys: String, CodingKey {
        case durationMS = "duration_ms"
        case seq = "seq"
        case sha256 = "sha256"
        case startMS = "start_ms"
    }
}

// MARK: AudioChunkMeta convenience initializers and mutators

extension AudioChunkMeta {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(AudioChunkMeta.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        durationMS: Int? = nil,
        seq: Int? = nil,
        sha256: String? = nil,
        startMS: Int? = nil
    ) -> AudioChunkMeta {
        return AudioChunkMeta(
            durationMS: durationMS ?? self.durationMS,
            seq: seq ?? self.seq,
            sha256: sha256 ?? self.sha256,
            startMS: startMS ?? self.startMS
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum AudioCodec: String, Codable {
    case aac = "aac"
    case opus = "opus"
}

/// audio.finalize (08 §5)
// MARK: - AudioFinalizePayload
struct AudioFinalizePayload: Codable {
    let recordingID: String

    enum CodingKeys: String, CodingKey {
        case recordingID = "recording_id"
    }
}

// MARK: AudioFinalizePayload convenience initializers and mutators

extension AudioFinalizePayload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(AudioFinalizePayload.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        recordingID: String? = nil
    ) -> AudioFinalizePayload {
        return AudioFinalizePayload(
            recordingID: recordingID ?? self.recordingID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// job.result von audio.finalize. state ist nie laeuft
// MARK: - AudioFinalizeResult
struct AudioFinalizeResult: Codable {
    /// Länge von full.m4a
    let audioDurationMS: Int
    let chunkCount: Int
    let fileSizeBytes: Int
    let gaps: [AudioGap]
    /// Laufzeit des Jobs
    let jobDurationMS: Int
    let missingSeqs: [Int]
    let recordingID: String
    let state: RecordingState

    enum CodingKeys: String, CodingKey {
        case audioDurationMS = "audio_duration_ms"
        case chunkCount = "chunk_count"
        case fileSizeBytes = "file_size_bytes"
        case gaps = "gaps"
        case jobDurationMS = "job_duration_ms"
        case missingSeqs = "missing_seqs"
        case recordingID = "recording_id"
        case state = "state"
    }
}

// MARK: AudioFinalizeResult convenience initializers and mutators

extension AudioFinalizeResult {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(AudioFinalizeResult.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        audioDurationMS: Int? = nil,
        chunkCount: Int? = nil,
        fileSizeBytes: Int? = nil,
        gaps: [AudioGap]? = nil,
        jobDurationMS: Int? = nil,
        missingSeqs: [Int]? = nil,
        recordingID: String? = nil,
        state: RecordingState? = nil
    ) -> AudioFinalizeResult {
        return AudioFinalizeResult(
            audioDurationMS: audioDurationMS ?? self.audioDurationMS,
            chunkCount: chunkCount ?? self.chunkCount,
            fileSizeBytes: fileSizeBytes ?? self.fileSizeBytes,
            gaps: gaps ?? self.gaps,
            jobDurationMS: jobDurationMS ?? self.jobDurationMS,
            missingSeqs: missingSeqs ?? self.missingSeqs,
            recordingID: recordingID ?? self.recordingID,
            state: state ?? self.state
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - AudioGap
struct AudioGap: Codable {
    let durationMS: Int
    let reason: AudioGapReason
    let startMS: Int

    enum CodingKeys: String, CodingKey {
        case durationMS = "duration_ms"
        case reason = "reason"
        case startMS = "start_ms"
    }
}

// MARK: AudioGap convenience initializers and mutators

extension AudioGap {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(AudioGap.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        durationMS: Int? = nil,
        reason: AudioGapReason? = nil,
        startMS: Int? = nil
    ) -> AudioGap {
        return AudioGap(
            durationMS: durationMS ?? self.durationMS,
            reason: reason ?? self.reason,
            startMS: startMS ?? self.startMS
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// fehlender_chunk: seq fehlt. zeitluecke: start_ms springt (z. B. Recorder neu gestartet)
enum AudioGapReason: String, Codable {
    case fehlenderChunk = "fehlender_chunk"
    case zeitluecke = "zeitluecke"
}

enum RecordingState: String, Codable {
    case laeuft = "laeuft"
    case mitLuecken = "mit_luecken"
    case vollstaendig = "vollstaendig"
}

/// GET /backups: Status und Läufe, neueste zuerst
// MARK: - BackupOverview
struct BackupOverview: Codable {
    let items: [BackupRun]
    let nextCursor: String?
    let status: BackupStatus

    enum CodingKeys: String, CodingKey {
        case items = "items"
        case nextCursor = "next_cursor"
        case status = "status"
    }
}

// MARK: BackupOverview convenience initializers and mutators

extension BackupOverview {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(BackupOverview.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        items: [BackupRun]? = nil,
        nextCursor: String?? = nil,
        status: BackupStatus? = nil
    ) -> BackupOverview {
        return BackupOverview(
            items: items ?? self.items,
            nextCursor: nextCursor ?? self.nextCursor,
            status: status ?? self.status
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Ein Backup-Lauf (03 §13 backup_run)
// MARK: - BackupRun
struct BackupRun: Codable {
    let createdAt: Date
    let deletedAt: Date?
    let error: String?
    let finishedAt: Date?
    let id: String
    let sizeBytes: Int?
    /// Name des Stands für sg restore <stand>, z. B. 20261104T030012Z. null solange er läuft
    /// oder bei Fehler
    let stand: String?
    let startedAt: Date
    let state: BackupState
    /// Absoluter Pfad des Ziels
    let target: String
    let trigger: BackupTrigger
    let updatedAt: Date
    let userID: String

    enum CodingKeys: String, CodingKey {
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case error = "error"
        case finishedAt = "finished_at"
        case id = "id"
        case sizeBytes = "size_bytes"
        case stand = "stand"
        case startedAt = "started_at"
        case state = "state"
        case target = "target"
        case trigger = "trigger"
        case updatedAt = "updated_at"
        case userID = "user_id"
    }
}

// MARK: BackupRun convenience initializers and mutators

extension BackupRun {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(BackupRun.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        error: String?? = nil,
        finishedAt: Date?? = nil,
        id: String? = nil,
        sizeBytes: Int?? = nil,
        stand: String?? = nil,
        startedAt: Date? = nil,
        state: BackupState? = nil,
        target: String? = nil,
        trigger: BackupTrigger? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil
    ) -> BackupRun {
        return BackupRun(
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            error: error ?? self.error,
            finishedAt: finishedAt ?? self.finishedAt,
            id: id ?? self.id,
            sizeBytes: sizeBytes ?? self.sizeBytes,
            stand: stand ?? self.stand,
            startedAt: startedAt ?? self.startedAt,
            state: state ?? self.state,
            target: target ?? self.target,
            trigger: trigger ?? self.trigger,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum BackupState: String, Codable {
    case fehler = "fehler"
    case fertig = "fertig"
    case laeuft = "laeuft"
}

enum BackupTrigger: String, Codable {
    case manuell = "manuell"
    case vorMigration = "vor_migration"
    case zeitplan = "zeitplan"
}

// MARK: - BackupStatus
struct BackupStatus: Codable {
    let lastSuccessAt: Date?
    let nextRunAt: Date?
    let running: Bool
    /// Letztes erfolgreiches Backup älter als 3 Tage (F-DAT-01)
    let stale: Bool
    /// null = kein Ziel eingestellt, Backups pausieren
    let target: String?

    enum CodingKeys: String, CodingKey {
        case lastSuccessAt = "last_success_at"
        case nextRunAt = "next_run_at"
        case running = "running"
        case stale = "stale"
        case target = "target"
    }
}

// MARK: BackupStatus convenience initializers and mutators

extension BackupStatus {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(BackupStatus.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        lastSuccessAt: Date?? = nil,
        nextRunAt: Date?? = nil,
        running: Bool? = nil,
        stale: Bool? = nil,
        target: String?? = nil
    ) -> BackupStatus {
        return BackupStatus(
            lastSuccessAt: lastSuccessAt ?? self.lastSuccessAt,
            nextRunAt: nextRunAt ?? self.nextRunAt,
            running: running ?? self.running,
            stale: stale ?? self.stale,
            target: target ?? self.target
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// auto: Modul und Art hat der Abgleich gesetzt und darf sie ändern. manuell: vom Nutzer
/// gesetzt, der Abgleich ändert module_id und kind nie mehr (F-KAL-02).
enum CalendarAssignment: String, Codable {
    case auto = "auto"
    case manuell = "manuell"
}

/// Termin. session_id ist abgeleitet: die nicht gelöschte Session zu diesem Termin.
// MARK: - CalendarEvent
struct CalendarEvent: Codable {
    /// Ganztägig (VALUE=DATE). starts_at/ends_at sind dann 00:00 UTC des Datums (wie
    /// tests/fixtures/ics/08). Ergänzung zu 03 §3
    let allDay: Bool
    let assignedBy: CalendarAssignment
    let cancelled: Bool
    let createdAt: Date
    let deletedAt: Date?
    /// DESCRIPTION aus der Quelle. Ergänzung zu 03 §3
    let description: String?
    let endsAt: Date
    /// UID aus der Quelle, null bei manuellen Terminen
    let externalUid: String?
    let id: String
    let kind: CalendarEventKind
    let location: String?
    let moduleID: String?
    /// Kennung des Vorkommens: ISO 8601 mit Offset der Ortszeit (2026-10-20T10:15:00+02:00) bzw.
    /// Datum (2026-11-01) bei ganztägigen Serien. null bei Einzelterminen. Abgleichschlüssel:
    /// (source_id, external_uid, recurrence_id)
    let recurrenceID: String?
    let sessionID: String?
    let sourceID: String?
    let startsAt: Date
    let title: String
    let updatedAt: Date
    let userID: String

    enum CodingKeys: String, CodingKey {
        case allDay = "all_day"
        case assignedBy = "assigned_by"
        case cancelled = "cancelled"
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case description = "description"
        case endsAt = "ends_at"
        case externalUid = "external_uid"
        case id = "id"
        case kind = "kind"
        case location = "location"
        case moduleID = "module_id"
        case recurrenceID = "recurrence_id"
        case sessionID = "session_id"
        case sourceID = "source_id"
        case startsAt = "starts_at"
        case title = "title"
        case updatedAt = "updated_at"
        case userID = "user_id"
    }
}

// MARK: CalendarEvent convenience initializers and mutators

extension CalendarEvent {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(CalendarEvent.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        allDay: Bool? = nil,
        assignedBy: CalendarAssignment? = nil,
        cancelled: Bool? = nil,
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        description: String?? = nil,
        endsAt: Date? = nil,
        externalUid: String?? = nil,
        id: String? = nil,
        kind: CalendarEventKind? = nil,
        location: String?? = nil,
        moduleID: String?? = nil,
        recurrenceID: String?? = nil,
        sessionID: String?? = nil,
        sourceID: String?? = nil,
        startsAt: Date? = nil,
        title: String? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil
    ) -> CalendarEvent {
        return CalendarEvent(
            allDay: allDay ?? self.allDay,
            assignedBy: assignedBy ?? self.assignedBy,
            cancelled: cancelled ?? self.cancelled,
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            description: description ?? self.description,
            endsAt: endsAt ?? self.endsAt,
            externalUid: externalUid ?? self.externalUid,
            id: id ?? self.id,
            kind: kind ?? self.kind,
            location: location ?? self.location,
            moduleID: moduleID ?? self.moduleID,
            recurrenceID: recurrenceID ?? self.recurrenceID,
            sessionID: sessionID ?? self.sessionID,
            sourceID: sourceID ?? self.sourceID,
            startsAt: startsAt ?? self.startsAt,
            title: title ?? self.title,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum CalendarEventKind: String, Codable {
    case fest = "fest"
    case lernblockExport = "lernblock_export"
    case pruefung = "pruefung"
    case tutorium = "tutorium"
    case uebung = "uebung"
    case vorlesung = "vorlesung"
}

// MARK: - CalendarEventList
struct CalendarEventList: Codable {
    let items: [CalendarEvent]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case items = "items"
        case nextCursor = "next_cursor"
    }
}

// MARK: CalendarEventList convenience initializers and mutators

extension CalendarEventList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(CalendarEventList.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        items: [CalendarEvent]? = nil,
        nextCursor: String?? = nil
    ) -> CalendarEventList {
        return CalendarEventList(
            items: items ?? self.items,
            nextCursor: nextCursor ?? self.nextCursor
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// PATCH /calendar/events/{id}. Setzt assigned_by=manuell. scope fehlt = serie. Antwort:
/// CalendarEventList mit allen geänderten Terminen.
// MARK: - CalendarEventUpdate
struct CalendarEventUpdate: Codable {
    let kind: CalendarEventKind?
    let moduleID: String?
    let scope: CalendarUpdateScope?

    enum CodingKeys: String, CodingKey {
        case kind = "kind"
        case moduleID = "module_id"
        case scope = "scope"
    }
}

// MARK: CalendarEventUpdate convenience initializers and mutators

extension CalendarEventUpdate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(CalendarEventUpdate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        kind: CalendarEventKind?? = nil,
        moduleID: String?? = nil,
        scope: CalendarUpdateScope?? = nil
    ) -> CalendarEventUpdate {
        return CalendarEventUpdate(
            kind: kind ?? self.kind,
            moduleID: moduleID ?? self.moduleID,
            scope: scope ?? self.scope
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// serie: alle Termine derselben Quelle mit gleicher external_uid (F-KAL-02). einzeln: nur
/// dieser Termin.
enum CalendarUpdateScope: String, Codable {
    case einzeln = "einzeln"
    case serie = "serie"
}

/// Kalenderquelle
// MARK: - CalendarSource
struct CalendarSource: Codable {
    let createdAt: Date
    let deletedAt: Date?
    /// Abgeleitet: Termine dieser Quelle (ohne gelöschte)
    let eventCount: Int
    let id: String
    let kind: CalendarSourceKind
    /// Fehler des letzten Abgleichs, null nach Erfolg. Ergänzung zu 03 §3
    let lastError: String?
    let lastSyncedAt: Date?
    /// Anzeigename. Ergänzung zu 03 §3. Standard: Dateiname bzw. Host der URL
    let name: String
    let readonly: Bool
    let updatedAt: Date
    /// Nur bei ics_url (webcal:// wird als https:// gespeichert)
    let url: String?
    let userID: String

    enum CodingKeys: String, CodingKey {
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case eventCount = "event_count"
        case id = "id"
        case kind = "kind"
        case lastError = "last_error"
        case lastSyncedAt = "last_synced_at"
        case name = "name"
        case readonly = "readonly"
        case updatedAt = "updated_at"
        case url = "url"
        case userID = "user_id"
    }
}

// MARK: CalendarSource convenience initializers and mutators

extension CalendarSource {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(CalendarSource.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        eventCount: Int? = nil,
        id: String? = nil,
        kind: CalendarSourceKind? = nil,
        lastError: String?? = nil,
        lastSyncedAt: Date?? = nil,
        name: String? = nil,
        readonly: Bool? = nil,
        updatedAt: Date? = nil,
        url: String?? = nil,
        userID: String? = nil
    ) -> CalendarSource {
        return CalendarSource(
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            eventCount: eventCount ?? self.eventCount,
            id: id ?? self.id,
            kind: kind ?? self.kind,
            lastError: lastError ?? self.lastError,
            lastSyncedAt: lastSyncedAt ?? self.lastSyncedAt,
            name: name ?? self.name,
            readonly: readonly ?? self.readonly,
            updatedAt: updatedAt ?? self.updatedAt,
            url: url ?? self.url,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// google erst ab Phase 4 (F-KAL-03)
enum CalendarSourceKind: String, Codable {
    case google = "google"
    case icsFile = "ics_file"
    case icsURL = "ics_url"
}

/// JSON-Body von POST /calendar/sources für eine ICS-URL. Eine ICS-Datei kommt stattdessen
/// als multipart (Felder file, name). Antwort: IcsImportResult.
// MARK: - CalendarSourceCreate
struct CalendarSourceCreate: Codable {
    let id: String?
    let name: String?
    /// ICS-URL (Abo, Abgleich alle 6 h und beim Start)
    let url: String

    enum CodingKeys: String, CodingKey {
        case id = "id"
        case name = "name"
        case url = "url"
    }
}

// MARK: CalendarSourceCreate convenience initializers and mutators

extension CalendarSourceCreate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(CalendarSourceCreate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        id: String?? = nil,
        name: String?? = nil,
        url: String? = nil
    ) -> CalendarSourceCreate {
        return CalendarSourceCreate(
            id: id ?? self.id,
            name: name ?? self.name,
            url: url ?? self.url
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - CalendarSourceList
struct CalendarSourceList: Codable {
    let items: [CalendarSource]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case items = "items"
        case nextCursor = "next_cursor"
    }
}

// MARK: CalendarSourceList convenience initializers and mutators

extension CalendarSourceList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(CalendarSourceList.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        items: [CalendarSource]? = nil,
        nextCursor: String?? = nil
    ) -> CalendarSourceList {
        return CalendarSourceList(
            items: items ?? self.items,
            nextCursor: nextCursor ?? self.nextCursor
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Gerät, auf dem ein Ereignis entstanden ist
enum ClientDevice: String, Codable {
    case ipad = "ipad"
    case mac = "mac"
}

/// Layout-Vorlagen F-DSH-01
enum DashboardLayout: String, Codable {
    case fokus = "fokus"
    case folieGross = "folie_gross"
    case notizenGross = "notizen_gross"
    case standard = "standard"
}

// MARK: - DataSettings
struct DataSettings: Codable {
    /// age mit Passphrase (P1). Die Passphrase steht nie in den Einstellungen
    let backupEncryption: Bool
    /// Absoluter Pfad, null = keine Backups
    let backupTarget: String?
    /// Ortszeit des Macs (Standard 03:00)
    let backupTime: String

    enum CodingKeys: String, CodingKey {
        case backupEncryption = "backup_encryption"
        case backupTarget = "backup_target"
        case backupTime = "backup_time"
    }
}

// MARK: DataSettings convenience initializers and mutators

extension DataSettings {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(DataSettings.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        backupEncryption: Bool? = nil,
        backupTarget: String?? = nil,
        backupTime: String? = nil
    ) -> DataSettings {
        return DataSettings(
            backupEncryption: backupEncryption ?? self.backupEncryption,
            backupTarget: backupTarget ?? self.backupTarget,
            backupTime: backupTime ?? self.backupTime
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - DataSettingsUpdate
struct DataSettingsUpdate: Codable {
    /// age mit Passphrase (P1). Die Passphrase steht nie in den Einstellungen
    let backupEncryption: Bool?
    /// Absoluter Pfad, null = keine Backups
    let backupTarget: String?
    /// Ortszeit des Macs (Standard 03:00)
    let backupTime: String?

    enum CodingKeys: String, CodingKey {
        case backupEncryption = "backup_encryption"
        case backupTarget = "backup_target"
        case backupTime = "backup_time"
    }
}

// MARK: DataSettingsUpdate convenience initializers and mutators

extension DataSettingsUpdate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(DataSettingsUpdate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        backupEncryption: Bool?? = nil,
        backupTarget: String?? = nil,
        backupTime: String?? = nil
    ) -> DataSettingsUpdate {
        return DataSettingsUpdate(
            backupEncryption: backupEncryption ?? self.backupEncryption,
            backupTarget: backupTarget ?? self.backupTarget,
            backupTime: backupTime ?? self.backupTime
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Gekoppeltes Gerät. Das Token selbst gibt die API nie aus (gespeichert nur token_hash).
// MARK: - Device
struct Device: Codable {
    let appVersion: String?
    let clockOffsetMS: Int?
    /// Abgeleitet: hat gerade eine Sync-Verbindung
    let connected: Bool
    let createdAt: Date
    let deletedAt: Date?
    let id: String
    let kind: DeviceKind
    let lastSeenAt: Date?
    let name: String
    let updatedAt: Date
    let userID: String

    enum CodingKeys: String, CodingKey {
        case appVersion = "app_version"
        case clockOffsetMS = "clock_offset_ms"
        case connected = "connected"
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case id = "id"
        case kind = "kind"
        case lastSeenAt = "last_seen_at"
        case name = "name"
        case updatedAt = "updated_at"
        case userID = "user_id"
    }
}

// MARK: Device convenience initializers and mutators

extension Device {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Device.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        appVersion: String?? = nil,
        clockOffsetMS: Int?? = nil,
        connected: Bool? = nil,
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        id: String? = nil,
        kind: DeviceKind? = nil,
        lastSeenAt: Date?? = nil,
        name: String? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil
    ) -> Device {
        return Device(
            appVersion: appVersion ?? self.appVersion,
            clockOffsetMS: clockOffsetMS ?? self.clockOffsetMS,
            connected: connected ?? self.connected,
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            id: id ?? self.id,
            kind: kind ?? self.kind,
            lastSeenAt: lastSeenAt ?? self.lastSeenAt,
            name: name ?? self.name,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum DeviceKind: String, Codable {
    case ipad = "ipad"
    case iphone = "iphone"
}

// MARK: - DeviceList
struct DeviceList: Codable {
    let items: [Device]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case items = "items"
        case nextCursor = "next_cursor"
    }
}

// MARK: DeviceList convenience initializers and mutators

extension DeviceList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(DeviceList.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        items: [Device]? = nil,
        nextCursor: String?? = nil
    ) -> DeviceList {
        return DeviceList(
            items: items ?? self.items,
            nextCursor: nextCursor ?? self.nextCursor
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Datei vorher per PUT /pages/{id}/pkdrawing hochgeladen, nur fürs iPad
// MARK: - DrawingSnapshotData
struct DrawingSnapshotData: Codable {
    let pageID: String
    let pkdrawingRef: FileRef

    enum CodingKeys: String, CodingKey {
        case pageID = "page_id"
        case pkdrawingRef = "pkdrawing_ref"
    }
}

// MARK: DrawingSnapshotData convenience initializers and mutators

extension DrawingSnapshotData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(DrawingSnapshotData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        pageID: String? = nil,
        pkdrawingRef: FileRef? = nil
    ) -> DrawingSnapshotData {
        return DrawingSnapshotData(
            pageID: pageID ?? self.pageID,
            pkdrawingRef: pkdrawingRef ?? self.pkdrawingRef
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Verweis auf eine Datei, die getrennt per HTTP hochgeladen wird (08 §2.3 file_ref /
/// pkdrawing_ref). Der Core prüft sha256 beim Upload.
// MARK: - FileRef
struct FileRef: Codable {
    let mime: String
    let sha256: String
    let sizeBytes: Int

    enum CodingKeys: String, CodingKey {
        case mime = "mime"
        case sha256 = "sha256"
        case sizeBytes = "size_bytes"
    }
}

// MARK: FileRef convenience initializers and mutators

extension FileRef {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(FileRef.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        mime: String? = nil,
        sha256: String? = nil,
        sizeBytes: Int? = nil
    ) -> FileRef {
        return FileRef(
            mime: mime ?? self.mime,
            sha256: sha256 ?? self.sha256,
            sizeBytes: sizeBytes ?? self.sizeBytes
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - DrawingSnapshotOp
struct DrawingSnapshotOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: DrawingSnapshotData
    let kind: DrawingSnapshotOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: DrawingSnapshotOp convenience initializers and mutators

extension DrawingSnapshotOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(DrawingSnapshotOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: DrawingSnapshotData? = nil,
        kind: DrawingSnapshotOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> DrawingSnapshotOp {
        return DrawingSnapshotOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum DrawingSnapshotOpKind: String, Codable {
    case drawingSnapshot = "drawing.snapshot"
}

/// Wer die Operation erzeugt hat (vom Server gesetzt)
enum SyncOrigin: String, Codable {
    case ipad = "ipad"
    case server = "server"
    case web = "web"
}

enum DrawingSnapshotOpType: String, Codable {
    case op = "op"
}

// MARK: - ElementRemoveData
struct ElementRemoveData: Codable {
    let elementID: String
    let pageID: String

    enum CodingKeys: String, CodingKey {
        case elementID = "element_id"
        case pageID = "page_id"
    }
}

// MARK: ElementRemoveData convenience initializers and mutators

extension ElementRemoveData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ElementRemoveData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        elementID: String? = nil,
        pageID: String? = nil
    ) -> ElementRemoveData {
        return ElementRemoveData(
            elementID: elementID ?? self.elementID,
            pageID: pageID ?? self.pageID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - ElementRemoveOp
struct ElementRemoveOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: ElementRemoveData
    let kind: ElementRemoveOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: ElementRemoveOp convenience initializers and mutators

extension ElementRemoveOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ElementRemoveOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: ElementRemoveData? = nil,
        kind: ElementRemoveOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> ElementRemoveOp {
        return ElementRemoveOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum ElementRemoveOpKind: String, Codable {
    case elementRemove = "element.remove"
}

// MARK: - ElementUpsertData
struct ElementUpsertData: Codable {
    let element: PageElement
    let pageID: String

    enum CodingKeys: String, CodingKey {
        case element = "element"
        case pageID = "page_id"
    }
}

// MARK: ElementUpsertData convenience initializers and mutators

extension ElementUpsertData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ElementUpsertData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        element: PageElement? = nil,
        pageID: String? = nil
    ) -> ElementUpsertData {
        return ElementUpsertData(
            element: element ?? self.element,
            pageID: pageID ?? self.pageID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Seitenelement (08 §4.4), unterschieden über kind. frame [x, y, w, h] in pt. crop bei
/// image: [x, y, w, h] relativ zum Bild (0–1), null = ganzes Bild. Phase 1 nutzt image
/// (Tafel-Foto) und stamp (Marker-Stempel).
// MARK: - PageElement
struct PageElement: Codable {
    let elementID: String
    let frame: [Double]
    let kind: PageElementKind
    let payload: ElementPayload
    let tMS: Int?
    let z: Int

    enum CodingKeys: String, CodingKey {
        case elementID = "element_id"
        case frame = "frame"
        case kind = "kind"
        case payload = "payload"
        case tMS = "t_ms"
        case z = "z"
    }
}

// MARK: PageElement convenience initializers and mutators

extension PageElement {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PageElement.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        elementID: String? = nil,
        frame: [Double]? = nil,
        kind: PageElementKind? = nil,
        payload: ElementPayload? = nil,
        tMS: Int?? = nil,
        z: Int? = nil
    ) -> PageElement {
        return PageElement(
            elementID: elementID ?? self.elementID,
            frame: frame ?? self.frame,
            kind: kind ?? self.kind,
            payload: payload ?? self.payload,
            tMS: tMS ?? self.tMS,
            z: z ?? self.z
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum PageElementKind: String, Codable {
    case image = "image"
    case shape = "shape"
    case stamp = "stamp"
    case tape = "tape"
    case text = "text"
}

// MARK: - ElementPayload
struct ElementPayload: Codable {
    let size: TextSize?
    let text: String?
    let crop: [Double]?
    let photoID: String?
    let color: String?
    let points: [[Double]]?
    let shape: ShapeKind?
    let width: Double?
    let cardID: String?
    let covered: Bool?
    let markerID: String?
    let markerKind: MarkerKindEnum?

    enum CodingKeys: String, CodingKey {
        case size = "size"
        case text = "text"
        case crop = "crop"
        case photoID = "photo_id"
        case color = "color"
        case points = "points"
        case shape = "shape"
        case width = "width"
        case cardID = "card_id"
        case covered = "covered"
        case markerID = "marker_id"
        case markerKind = "marker_kind"
    }
}

// MARK: ElementPayload convenience initializers and mutators

extension ElementPayload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ElementPayload.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        size: TextSize?? = nil,
        text: String?? = nil,
        crop: [Double]?? = nil,
        photoID: String?? = nil,
        color: String?? = nil,
        points: [[Double]]?? = nil,
        shape: ShapeKind?? = nil,
        width: Double?? = nil,
        cardID: String?? = nil,
        covered: Bool?? = nil,
        markerID: String?? = nil,
        markerKind: MarkerKindEnum?? = nil
    ) -> ElementPayload {
        return ElementPayload(
            size: size ?? self.size,
            text: text ?? self.text,
            crop: crop ?? self.crop,
            photoID: photoID ?? self.photoID,
            color: color ?? self.color,
            points: points ?? self.points,
            shape: shape ?? self.shape,
            width: width ?? self.width,
            cardID: cardID ?? self.cardID,
            covered: covered ?? self.covered,
            markerID: markerID ?? self.markerID,
            markerKind: markerKind ?? self.markerKind
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum MarkerKindEnum: String, Codable {
    case frage = "frage"
    case klausur = "klausur"
    case verknuepfung = "verknuepfung"
}

enum ShapeKind: String, Codable {
    case arrow = "arrow"
    case diamond = "diamond"
    case ellipse = "ellipse"
    case line = "line"
    case rectangle = "rectangle"
    case triangle = "triangle"
}

enum TextSize: String, Codable {
    case l = "l"
    case m = "m"
    case s = "s"
}

// MARK: - ElementUpsertOp
struct ElementUpsertOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: ElementUpsertData
    let kind: ElementUpsertOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: ElementUpsertOp convenience initializers and mutators

extension ElementUpsertOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ElementUpsertOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: ElementUpsertData? = nil,
        kind: ElementUpsertOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> ElementUpsertOp {
        return ElementUpsertOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum ElementUpsertOpKind: String, Codable {
    case elementUpsert = "element.upsert"
}

/// Übungsblatt. Ergänzung zu 03 §4: ingest_state zeigt den Fortschritt von pdf.ingest für
/// das Blatt.
// MARK: - ExerciseSheet
struct ExerciseSheet: Codable {
    let createdAt: Date
    let deletedAt: Date?
    /// Abgabe, geht in den Planer
    let dueAt: Date?
    /// Musterlösung hinterlegt (F-ORG-05, Phase 3)
    let hasSolution: Bool
    let id: String
    let ingestState: IngestState
    let moduleID: String
    let number: Int?
    let pageCount: Int?
    let sha256: String
    let title: String
    let updatedAt: Date
    let userID: String

    enum CodingKeys: String, CodingKey {
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case dueAt = "due_at"
        case hasSolution = "has_solution"
        case id = "id"
        case ingestState = "ingest_state"
        case moduleID = "module_id"
        case number = "number"
        case pageCount = "page_count"
        case sha256 = "sha256"
        case title = "title"
        case updatedAt = "updated_at"
        case userID = "user_id"
    }
}

// MARK: ExerciseSheet convenience initializers and mutators

extension ExerciseSheet {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ExerciseSheet.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        dueAt: Date?? = nil,
        hasSolution: Bool? = nil,
        id: String? = nil,
        ingestState: IngestState? = nil,
        moduleID: String? = nil,
        number: Int?? = nil,
        pageCount: Int?? = nil,
        sha256: String? = nil,
        title: String? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil
    ) -> ExerciseSheet {
        return ExerciseSheet(
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            dueAt: dueAt ?? self.dueAt,
            hasSolution: hasSolution ?? self.hasSolution,
            id: id ?? self.id,
            ingestState: ingestState ?? self.ingestState,
            moduleID: moduleID ?? self.moduleID,
            number: number ?? self.number,
            pageCount: pageCount ?? self.pageCount,
            sha256: sha256 ?? self.sha256,
            title: title ?? self.title,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum IngestState: String, Codable {
    case fehler = "fehler"
    case neu = "neu"
    case verarbeitet = "verarbeitet"
}

// MARK: - ExerciseSheetList
struct ExerciseSheetList: Codable {
    let items: [ExerciseSheet]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case items = "items"
        case nextCursor = "next_cursor"
    }
}

// MARK: ExerciseSheetList convenience initializers and mutators

extension ExerciseSheetList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ExerciseSheetList.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        items: [ExerciseSheet]? = nil,
        nextCursor: String?? = nil
    ) -> ExerciseSheetList {
        return ExerciseSheetList(
            items: items ?? self.items,
            nextCursor: nextCursor ?? self.nextCursor
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - ExerciseSheetUpdate
struct ExerciseSheetUpdate: Codable {
    let dueAt: Date?
    let number: Int?
    let title: String?

    enum CodingKeys: String, CodingKey {
        case dueAt = "due_at"
        case number = "number"
        case title = "title"
    }
}

// MARK: ExerciseSheetUpdate convenience initializers and mutators

extension ExerciseSheetUpdate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ExerciseSheetUpdate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        dueAt: Date?? = nil,
        number: Int?? = nil,
        title: String?? = nil
    ) -> ExerciseSheetUpdate {
        return ExerciseSheetUpdate(
            dueAt: dueAt ?? self.dueAt,
            number: number ?? self.number,
            title: title ?? self.title
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Antwort auf PUT /photos/{id}/file und PUT /pages/{id}/pkdrawing
// MARK: - FileReceipt
struct FileReceipt: Codable {
    /// true: dieselbe Datei (gleiches sha256) lag schon vor, nichts geändert
    let duplicate: Bool
    let id: String
    let receivedAt: Date
    let sha256: String
    let sizeBytes: Int

    enum CodingKeys: String, CodingKey {
        case duplicate = "duplicate"
        case id = "id"
        case receivedAt = "received_at"
        case sha256 = "sha256"
        case sizeBytes = "size_bytes"
    }
}

// MARK: FileReceipt convenience initializers and mutators

extension FileReceipt {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(FileReceipt.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        duplicate: Bool? = nil,
        id: String? = nil,
        receivedAt: Date? = nil,
        sha256: String? = nil,
        sizeBytes: Int? = nil
    ) -> FileReceipt {
        return FileReceipt(
            duplicate: duplicate ?? self.duplicate,
            id: id ?? self.id,
            receivedAt: receivedAt ?? self.receivedAt,
            sha256: sha256 ?? self.sha256,
            sizeBytes: sizeBytes ?? self.sizeBytes
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - GeneralSettings
struct GeneralSettings: Codable {
    let appearance: Appearance
    let contentLang: Lang
    /// SG_DATA_DIR, nur lesbar (Änderung über die Umgebung und Neustart)
    let dataDir: String

    enum CodingKeys: String, CodingKey {
        case appearance = "appearance"
        case contentLang = "content_lang"
        case dataDir = "data_dir"
    }
}

// MARK: GeneralSettings convenience initializers and mutators

extension GeneralSettings {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(GeneralSettings.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        appearance: Appearance? = nil,
        contentLang: Lang? = nil,
        dataDir: String? = nil
    ) -> GeneralSettings {
        return GeneralSettings(
            appearance: appearance ?? self.appearance,
            contentLang: contentLang ?? self.contentLang,
            dataDir: dataDir ?? self.dataDir
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum Lang: String, Codable {
    case de = "de"
    case en = "en"
    case mixed = "mixed"
}

// MARK: - GeneralSettingsUpdate
struct GeneralSettingsUpdate: Codable {
    let appearance: Appearance?
    let contentLang: Lang?

    enum CodingKeys: String, CodingKey {
        case appearance = "appearance"
        case contentLang = "content_lang"
    }
}

// MARK: GeneralSettingsUpdate convenience initializers and mutators

extension GeneralSettingsUpdate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(GeneralSettingsUpdate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        appearance: Appearance?? = nil,
        contentLang: Lang?? = nil
    ) -> GeneralSettingsUpdate {
        return GeneralSettingsUpdate(
            appearance: appearance ?? self.appearance,
            contentLang: contentLang ?? self.contentLang
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Antwort von GET /api/v1/health (docs/VERTRAEGE.md §2)
// MARK: - Health
struct Health: Codable {
    let db: DB
    let status: Status
    let version: String

    enum CodingKeys: String, CodingKey {
        case db = "db"
        case status = "status"
        case version = "version"
    }
}

// MARK: Health convenience initializers and mutators

extension Health {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Health.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        db: DB? = nil,
        status: Status? = nil,
        version: String? = nil
    ) -> Health {
        return Health(
            db: db ?? self.db,
            status: status ?? self.status,
            version: version ?? self.version
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum DB: String, Codable {
    case fehler = "fehler"
    case ok = "ok"
}

enum Status: String, Codable {
    case ok = "ok"
}

/// Termin in einem Abgleichergebnis (Schlüssel wie
/// tests/fixtures/ics/11-abgleich-erwartung.json)
// MARK: - ICSEventRef
struct ICSEventRef: Codable {
    let eventID: String
    let externalUid: String
    let kind: CalendarEventKind
    let moduleID: String?
    let recurrenceID: String?
    let startsAt: Date
    let title: String

    enum CodingKeys: String, CodingKey {
        case eventID = "event_id"
        case externalUid = "external_uid"
        case kind = "kind"
        case moduleID = "module_id"
        case recurrenceID = "recurrence_id"
        case startsAt = "starts_at"
        case title = "title"
    }
}

// MARK: ICSEventRef convenience initializers and mutators

extension ICSEventRef {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ICSEventRef.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        eventID: String? = nil,
        externalUid: String? = nil,
        kind: CalendarEventKind? = nil,
        moduleID: String?? = nil,
        recurrenceID: String?? = nil,
        startsAt: Date? = nil,
        title: String? = nil
    ) -> ICSEventRef {
        return ICSEventRef(
            eventID: eventID ?? self.eventID,
            externalUid: externalUid ?? self.externalUid,
            kind: kind ?? self.kind,
            moduleID: moduleID ?? self.moduleID,
            recurrenceID: recurrenceID ?? self.recurrenceID,
            startsAt: startsAt ?? self.startsAt,
            title: title ?? self.title
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - ICSImportCounts
struct ICSImportCounts: Codable {
    let entfallen: Int
    let geaendert: Int
    let neu: Int
    /// Nicht abgesagte Termine der Quelle ohne Modul nach dem Lauf
    let ohneModul: Int
    let unveraendert: Int
    /// In diesem Lauf automatisch einem Modul zugeordnet
    let zugeordnet: Int

    enum CodingKeys: String, CodingKey {
        case entfallen = "entfallen"
        case geaendert = "geaendert"
        case neu = "neu"
        case ohneModul = "ohne_modul"
        case unveraendert = "unveraendert"
        case zugeordnet = "zugeordnet"
    }
}

// MARK: ICSImportCounts convenience initializers and mutators

extension ICSImportCounts {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ICSImportCounts.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        entfallen: Int? = nil,
        geaendert: Int? = nil,
        neu: Int? = nil,
        ohneModul: Int? = nil,
        unveraendert: Int? = nil,
        zugeordnet: Int? = nil
    ) -> ICSImportCounts {
        return ICSImportCounts(
            entfallen: entfallen ?? self.entfallen,
            geaendert: geaendert ?? self.geaendert,
            neu: neu ?? self.neu,
            ohneModul: ohneModul ?? self.ohneModul,
            unveraendert: unveraendert ?? self.unveraendert,
            zugeordnet: zugeordnet ?? self.zugeordnet
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Antwort auf POST /calendar/sources (201) und POST /calendar/sources/{id}/sync (200). Der
/// Abgleich läuft synchron im Core, nicht als Job.
// MARK: - ICSImportResult
struct ICSImportResult: Codable {
    let counts: ICSImportCounts
    let entfallen: [ICSEventRef]
    let geaendert: [ICSEventRef]
    let moduleSuggestions: [ICSModuleSuggestion]
    let neu: [ICSEventRef]
    let source: CalendarSource
    let warnings: [ICSWarning]
    let zugeordnet: [ICSEventRef]

    enum CodingKeys: String, CodingKey {
        case counts = "counts"
        case entfallen = "entfallen"
        case geaendert = "geaendert"
        case moduleSuggestions = "module_suggestions"
        case neu = "neu"
        case source = "source"
        case warnings = "warnings"
        case zugeordnet = "zugeordnet"
    }
}

// MARK: ICSImportResult convenience initializers and mutators

extension ICSImportResult {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ICSImportResult.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        counts: ICSImportCounts? = nil,
        entfallen: [ICSEventRef]? = nil,
        geaendert: [ICSEventRef]? = nil,
        moduleSuggestions: [ICSModuleSuggestion]? = nil,
        neu: [ICSEventRef]? = nil,
        source: CalendarSource? = nil,
        warnings: [ICSWarning]? = nil,
        zugeordnet: [ICSEventRef]? = nil
    ) -> ICSImportResult {
        return ICSImportResult(
            counts: counts ?? self.counts,
            entfallen: entfallen ?? self.entfallen,
            geaendert: geaendert ?? self.geaendert,
            moduleSuggestions: moduleSuggestions ?? self.moduleSuggestions,
            neu: neu ?? self.neu,
            source: source ?? self.source,
            warnings: warnings ?? self.warnings,
            zugeordnet: zugeordnet ?? self.zugeordnet
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Vorschlag „neues Modul anlegen?" für unbekannte Titel (F-KAL-02)
// MARK: - ICSModuleSuggestion
struct ICSModuleSuggestion: Codable {
    let eventCount: Int
    let kind: CalendarEventKind
    /// Vorgeschlagener Modulname, aus dem Titel bereinigt
    let name: String
    /// Je Serie ein Termin. Nach POST /modules: PATCH /calendar/events/{id} mit module_id,
    /// scope=serie
    let seriesEventIDS: [String]

    enum CodingKeys: String, CodingKey {
        case eventCount = "event_count"
        case kind = "kind"
        case name = "name"
        case seriesEventIDS = "series_event_ids"
    }
}

// MARK: ICSModuleSuggestion convenience initializers and mutators

extension ICSModuleSuggestion {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ICSModuleSuggestion.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        eventCount: Int? = nil,
        kind: CalendarEventKind? = nil,
        name: String? = nil,
        seriesEventIDS: [String]? = nil
    ) -> ICSModuleSuggestion {
        return ICSModuleSuggestion(
            eventCount: eventCount ?? self.eventCount,
            kind: kind ?? self.kind,
            name: name ?? self.name,
            seriesEventIDS: seriesEventIDS ?? self.seriesEventIDS
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - ICSWarning
struct ICSWarning: Codable {
    let code: String
    let externalUid: String?
    let message: String

    enum CodingKeys: String, CodingKey {
        case code = "code"
        case externalUid = "external_uid"
        case message = "message"
    }
}

// MARK: ICSWarning convenience initializers and mutators

extension ICSWarning {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ICSWarning.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        code: String? = nil,
        externalUid: String?? = nil,
        message: String? = nil
    ) -> ICSWarning {
        return ICSWarning(
            code: code ?? self.code,
            externalUid: externalUid ?? self.externalUid,
            message: message ?? self.message
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - ImageElement
struct ImageElement: Codable {
    let elementID: String
    let frame: [Double]
    let kind: ImageElementKind
    let payload: ImageElementPayload
    let tMS: Int?
    let z: Int

    enum CodingKeys: String, CodingKey {
        case elementID = "element_id"
        case frame = "frame"
        case kind = "kind"
        case payload = "payload"
        case tMS = "t_ms"
        case z = "z"
    }
}

// MARK: ImageElement convenience initializers and mutators

extension ImageElement {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ImageElement.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        elementID: String? = nil,
        frame: [Double]? = nil,
        kind: ImageElementKind? = nil,
        payload: ImageElementPayload? = nil,
        tMS: Int?? = nil,
        z: Int? = nil
    ) -> ImageElement {
        return ImageElement(
            elementID: elementID ?? self.elementID,
            frame: frame ?? self.frame,
            kind: kind ?? self.kind,
            payload: payload ?? self.payload,
            tMS: tMS ?? self.tMS,
            z: z ?? self.z
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum ImageElementKind: String, Codable {
    case image = "image"
}

// MARK: - ImageElementPayload
struct ImageElementPayload: Codable {
    let crop: [Double]?
    let photoID: String

    enum CodingKeys: String, CodingKey {
        case crop = "crop"
        case photoID = "photo_id"
    }
}

// MARK: ImageElementPayload convenience initializers and mutators

extension ImageElementPayload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ImageElementPayload.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        crop: [Double]?? = nil,
        photoID: String? = nil
    ) -> ImageElementPayload {
        return ImageElementPayload(
            crop: crop ?? self.crop,
            photoID: photoID ?? self.photoID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Schreibmodus F-INK-03
enum InkMode: String, Codable {
    case aufFolie = "auf_folie"
    case freieSeite = "freie_seite"
}

// MARK: - Job
struct Job: Codable {
    let attempts: Int
    let createdAt: Date
    let deletedAt: Date?
    let dependsOn: [String]
    let error: String?
    let id: String
    let lockedAt: Date?
    let lockedBy: String?
    let maxAttempts: Int
    /// Je nach type, z. B. PdfIngestPayload
    let payload: [String: JSONAny]
    /// Höher = früher
    let priority: Int
    let result: [String: JSONAny]?
    let runAfter: Date?
    let sessionID: String?
    let state: JobState
    let type: JobType
    let updatedAt: Date
    let userID: String

    enum CodingKeys: String, CodingKey {
        case attempts = "attempts"
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case dependsOn = "depends_on"
        case error = "error"
        case id = "id"
        case lockedAt = "locked_at"
        case lockedBy = "locked_by"
        case maxAttempts = "max_attempts"
        case payload = "payload"
        case priority = "priority"
        case result = "result"
        case runAfter = "run_after"
        case sessionID = "session_id"
        case state = "state"
        case type = "type"
        case updatedAt = "updated_at"
        case userID = "user_id"
    }
}

// MARK: Job convenience initializers and mutators

extension Job {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Job.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        attempts: Int? = nil,
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        dependsOn: [String]? = nil,
        error: String?? = nil,
        id: String? = nil,
        lockedAt: Date?? = nil,
        lockedBy: String?? = nil,
        maxAttempts: Int? = nil,
        payload: [String: JSONAny]? = nil,
        priority: Int? = nil,
        result: [String: JSONAny]?? = nil,
        runAfter: Date?? = nil,
        sessionID: String?? = nil,
        state: JobState? = nil,
        type: JobType? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil
    ) -> Job {
        return Job(
            attempts: attempts ?? self.attempts,
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            dependsOn: dependsOn ?? self.dependsOn,
            error: error ?? self.error,
            id: id ?? self.id,
            lockedAt: lockedAt ?? self.lockedAt,
            lockedBy: lockedBy ?? self.lockedBy,
            maxAttempts: maxAttempts ?? self.maxAttempts,
            payload: payload ?? self.payload,
            priority: priority ?? self.priority,
            result: result ?? self.result,
            runAfter: runAfter ?? self.runAfter,
            sessionID: sessionID ?? self.sessionID,
            state: state ?? self.state,
            type: type ?? self.type,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum JobState: String, Codable {
    case abgebrochen = "abgebrochen"
    case fehler = "fehler"
    case fertig = "fertig"
    case laeuft = "laeuft"
    case wartet = "wartet"
}

enum JobType: String, Codable {
    case alignContent = "align.content"
    case alignLog = "align.log"
    case audioFinalize = "audio.finalize"
    case cardsGenerate = "cards.generate"
    case conceptsExtract = "concepts.extract"
    case conceptsResolve = "concepts.resolve"
    case cornellQuestions = "cornell.questions"
    case detectExamHints = "detect.exam_hints"
    case embedSlides = "embed.slides"
    case embedTasks = "embed.tasks"
    case explainQuestions = "explain.questions"
    case feynmanEvaluate = "feynman.evaluate"
    case fsrsOptimize = "fsrs.optimize"
    case gradeAnalyzeError = "grade.analyze_error"
    case gradeOpen = "grade.open"
    case maintenanceNightly = "maintenance.nightly"
    case matchTasksSlides = "match.tasks_slides"
    case ocrInk = "ocr.ink"
    case ocrPhotos = "ocr.photos"
    case pastExamAnalyze = "past_exam.analyze"
    case pdfIngest = "pdf.ingest"
    case prereqCheck = "prereq.check"
    case ragAnswer = "rag.answer"
    case searchIndex = "search.index"
    case sheetSplit = "sheet.split"
    case solutionCompare = "solution.compare"
    case summaryWrite = "summary.write"
    case transcribe = "transcribe"
    case vaultWrite = "vault.write"
    case videoV0 = "video.v0"
    case videoV1 = "video.v1"
    case videoV2 = "video.v2"
}

// MARK: - JobList
struct JobList: Codable {
    let items: [Job]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case items = "items"
        case nextCursor = "next_cursor"
    }
}

// MARK: JobList convenience initializers and mutators

extension JobList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(JobList.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        items: [Job]? = nil,
        nextCursor: String?? = nil
    ) -> JobList {
        return JobList(
            items: items ?? self.items,
            nextCursor: nextCursor ?? self.nextCursor
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - LectureSettings
struct LectureSettings: Codable {
    /// Regel 1: Kalenderende + X min … (Standard 10)
    let autoStopAfterEndMin: Int
    /// Verlängerung per Tipp (Standard 15)
    let autoStopExtendMin: Int
    /// Regel 2: Kalenderende + X min (Standard 30)
    let autoStopHardAfterEndMin: Int
    /// Regel 4: Maximaldauer (Standard 240)
    let autoStopMaxDurationMin: Int
    /// … und X min keine Sprache (Standard 3)
    let autoStopQuietWindowMin: Int
    /// Regel 3: Stille ≥ X min (Standard 15)
    let autoStopSilenceMin: Int
    /// Hinweis vor dem Stopp (Standard 60)
    let autoStopWarningS: Int
    let defaultInkMode: InkMode
    let defaultLayout: DashboardLayout
    /// deviceId aus MediaDevices, null = Standardmikrofon
    let microphoneID: String?
    let toolbarSide: ToolbarSide

    enum CodingKeys: String, CodingKey {
        case autoStopAfterEndMin = "auto_stop_after_end_min"
        case autoStopExtendMin = "auto_stop_extend_min"
        case autoStopHardAfterEndMin = "auto_stop_hard_after_end_min"
        case autoStopMaxDurationMin = "auto_stop_max_duration_min"
        case autoStopQuietWindowMin = "auto_stop_quiet_window_min"
        case autoStopSilenceMin = "auto_stop_silence_min"
        case autoStopWarningS = "auto_stop_warning_s"
        case defaultInkMode = "default_ink_mode"
        case defaultLayout = "default_layout"
        case microphoneID = "microphone_id"
        case toolbarSide = "toolbar_side"
    }
}

// MARK: LectureSettings convenience initializers and mutators

extension LectureSettings {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(LectureSettings.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        autoStopAfterEndMin: Int? = nil,
        autoStopExtendMin: Int? = nil,
        autoStopHardAfterEndMin: Int? = nil,
        autoStopMaxDurationMin: Int? = nil,
        autoStopQuietWindowMin: Int? = nil,
        autoStopSilenceMin: Int? = nil,
        autoStopWarningS: Int? = nil,
        defaultInkMode: InkMode? = nil,
        defaultLayout: DashboardLayout? = nil,
        microphoneID: String?? = nil,
        toolbarSide: ToolbarSide? = nil
    ) -> LectureSettings {
        return LectureSettings(
            autoStopAfterEndMin: autoStopAfterEndMin ?? self.autoStopAfterEndMin,
            autoStopExtendMin: autoStopExtendMin ?? self.autoStopExtendMin,
            autoStopHardAfterEndMin: autoStopHardAfterEndMin ?? self.autoStopHardAfterEndMin,
            autoStopMaxDurationMin: autoStopMaxDurationMin ?? self.autoStopMaxDurationMin,
            autoStopQuietWindowMin: autoStopQuietWindowMin ?? self.autoStopQuietWindowMin,
            autoStopSilenceMin: autoStopSilenceMin ?? self.autoStopSilenceMin,
            autoStopWarningS: autoStopWarningS ?? self.autoStopWarningS,
            defaultInkMode: defaultInkMode ?? self.defaultInkMode,
            defaultLayout: defaultLayout ?? self.defaultLayout,
            microphoneID: microphoneID ?? self.microphoneID,
            toolbarSide: toolbarSide ?? self.toolbarSide
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Händigkeit: Seite der Werkzeugleiste auf dem iPad
enum ToolbarSide: String, Codable {
    case links = "links"
    case rechts = "rechts"
}

// MARK: - LectureSettingsUpdate
struct LectureSettingsUpdate: Codable {
    /// Regel 1: Kalenderende + X min … (Standard 10)
    let autoStopAfterEndMin: Int?
    /// Verlängerung per Tipp (Standard 15)
    let autoStopExtendMin: Int?
    /// Regel 2: Kalenderende + X min (Standard 30)
    let autoStopHardAfterEndMin: Int?
    /// Regel 4: Maximaldauer (Standard 240)
    let autoStopMaxDurationMin: Int?
    /// … und X min keine Sprache (Standard 3)
    let autoStopQuietWindowMin: Int?
    /// Regel 3: Stille ≥ X min (Standard 15)
    let autoStopSilenceMin: Int?
    /// Hinweis vor dem Stopp (Standard 60)
    let autoStopWarningS: Int?
    let defaultInkMode: InkMode?
    let defaultLayout: DashboardLayout?
    /// deviceId aus MediaDevices, null = Standardmikrofon
    let microphoneID: String?
    let toolbarSide: ToolbarSide?

    enum CodingKeys: String, CodingKey {
        case autoStopAfterEndMin = "auto_stop_after_end_min"
        case autoStopExtendMin = "auto_stop_extend_min"
        case autoStopHardAfterEndMin = "auto_stop_hard_after_end_min"
        case autoStopMaxDurationMin = "auto_stop_max_duration_min"
        case autoStopQuietWindowMin = "auto_stop_quiet_window_min"
        case autoStopSilenceMin = "auto_stop_silence_min"
        case autoStopWarningS = "auto_stop_warning_s"
        case defaultInkMode = "default_ink_mode"
        case defaultLayout = "default_layout"
        case microphoneID = "microphone_id"
        case toolbarSide = "toolbar_side"
    }
}

// MARK: LectureSettingsUpdate convenience initializers and mutators

extension LectureSettingsUpdate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(LectureSettingsUpdate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        autoStopAfterEndMin: Int?? = nil,
        autoStopExtendMin: Int?? = nil,
        autoStopHardAfterEndMin: Int?? = nil,
        autoStopMaxDurationMin: Int?? = nil,
        autoStopQuietWindowMin: Int?? = nil,
        autoStopSilenceMin: Int?? = nil,
        autoStopWarningS: Int?? = nil,
        defaultInkMode: InkMode?? = nil,
        defaultLayout: DashboardLayout?? = nil,
        microphoneID: String?? = nil,
        toolbarSide: ToolbarSide?? = nil
    ) -> LectureSettingsUpdate {
        return LectureSettingsUpdate(
            autoStopAfterEndMin: autoStopAfterEndMin ?? self.autoStopAfterEndMin,
            autoStopExtendMin: autoStopExtendMin ?? self.autoStopExtendMin,
            autoStopHardAfterEndMin: autoStopHardAfterEndMin ?? self.autoStopHardAfterEndMin,
            autoStopMaxDurationMin: autoStopMaxDurationMin ?? self.autoStopMaxDurationMin,
            autoStopQuietWindowMin: autoStopQuietWindowMin ?? self.autoStopQuietWindowMin,
            autoStopSilenceMin: autoStopSilenceMin ?? self.autoStopSilenceMin,
            autoStopWarningS: autoStopWarningS ?? self.autoStopWarningS,
            defaultInkMode: defaultInkMode ?? self.defaultInkMode,
            defaultLayout: defaultLayout ?? self.defaultLayout,
            microphoneID: microphoneID ?? self.microphoneID,
            toolbarSide: toolbarSide ?? self.toolbarSide
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// maintenance.nightly (08 §5, T1-18). Phase 1: Papierkorb leeren, verwaiste Dateien,
/// sync_op gelöschter Ströme
// MARK: - MaintenanceNightlyPayload
struct MaintenanceNightlyPayload: Codable {
    /// Nur zählen, nichts löschen
    let dryRun: Bool?
    /// Standard 30 (F-DAT-04)
    let purgeOlderThanDays: Int?

    enum CodingKeys: String, CodingKey {
        case dryRun = "dry_run"
        case purgeOlderThanDays = "purge_older_than_days"
    }
}

// MARK: MaintenanceNightlyPayload convenience initializers and mutators

extension MaintenanceNightlyPayload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MaintenanceNightlyPayload.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        dryRun: Bool?? = nil,
        purgeOlderThanDays: Int?? = nil
    ) -> MaintenanceNightlyPayload {
        return MaintenanceNightlyPayload(
            dryRun: dryRun ?? self.dryRun,
            purgeOlderThanDays: purgeOlderThanDays ?? self.purgeOlderThanDays
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - MaintenanceNightlyResult
struct MaintenanceNightlyResult: Codable {
    let jobDurationMS: Int
    let orphanFilesRemoved: Int
    /// Endgültig gelöschte Objekte je Tabelle
    let purgedByKind: [String: Int]
    let purgedCount: Int
    let syncOpsRemoved: Int

    enum CodingKeys: String, CodingKey {
        case jobDurationMS = "job_duration_ms"
        case orphanFilesRemoved = "orphan_files_removed"
        case purgedByKind = "purged_by_kind"
        case purgedCount = "purged_count"
        case syncOpsRemoved = "sync_ops_removed"
    }
}

// MARK: MaintenanceNightlyResult convenience initializers and mutators

extension MaintenanceNightlyResult {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MaintenanceNightlyResult.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        jobDurationMS: Int? = nil,
        orphanFilesRemoved: Int? = nil,
        purgedByKind: [String: Int]? = nil,
        purgedCount: Int? = nil,
        syncOpsRemoved: Int? = nil
    ) -> MaintenanceNightlyResult {
        return MaintenanceNightlyResult(
            jobDurationMS: jobDurationMS ?? self.jobDurationMS,
            orphanFilesRemoved: orphanFilesRemoved ?? self.orphanFilesRemoved,
            purgedByKind: purgedByKind ?? self.purgedByKind,
            purgedCount: purgedCount ?? self.purgedCount,
            syncOpsRemoved: syncOpsRemoved ?? self.syncOpsRemoved
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - Marker
struct Marker: Codable {
    let createdAt: Date
    let deletedAt: Date?
    let id: String
    let kind: MarkerKindEnum
    let note: String?
    let pageID: String?
    let position: MarkerPosition?
    let resolvedAt: Date?
    let sessionID: String
    let source: MarkerSource
    let tMS: Int
    let updatedAt: Date
    let userID: String

    enum CodingKeys: String, CodingKey {
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case id = "id"
        case kind = "kind"
        case note = "note"
        case pageID = "page_id"
        case position = "position"
        case resolvedAt = "resolved_at"
        case sessionID = "session_id"
        case source = "source"
        case tMS = "t_ms"
        case updatedAt = "updated_at"
        case userID = "user_id"
    }
}

// MARK: Marker convenience initializers and mutators

extension Marker {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Marker.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        id: String? = nil,
        kind: MarkerKindEnum? = nil,
        note: String?? = nil,
        pageID: String?? = nil,
        position: MarkerPosition?? = nil,
        resolvedAt: Date?? = nil,
        sessionID: String? = nil,
        source: MarkerSource? = nil,
        tMS: Int? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil
    ) -> Marker {
        return Marker(
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            id: id ?? self.id,
            kind: kind ?? self.kind,
            note: note ?? self.note,
            pageID: pageID ?? self.pageID,
            position: position ?? self.position,
            resolvedAt: resolvedAt ?? self.resolvedAt,
            sessionID: sessionID ?? self.sessionID,
            source: source ?? self.source,
            tMS: tMS ?? self.tMS,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Stelle auf der Seite in pt (Ursprung oben links)
// MARK: - MarkerPosition
struct MarkerPosition: Codable {
    let x: Double
    let y: Double

    enum CodingKeys: String, CodingKey {
        case x = "x"
        case y = "y"
    }
}

// MARK: MarkerPosition convenience initializers and mutators

extension MarkerPosition {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MarkerPosition.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        x: Double? = nil,
        y: Double? = nil
    ) -> MarkerPosition {
        return MarkerPosition(
            x: x ?? self.x,
            y: y ?? self.y
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum MarkerSource: String, Codable {
    case detektor = "detektor"
    case ipad = "ipad"
    case mac = "mac"
}

/// Marker vom iPad (F-INK-05) und vom Mac (F-DSH-05, source=mac)
// MARK: - MarkerAddData
struct MarkerAddData: Codable {
    let kind: MarkerKindEnum
    let markerID: String
    let note: String?
    let pageID: String?
    let position: MarkerPosition?
    let sessionID: String
    let source: ClientDevice
    let tMS: Int

    enum CodingKeys: String, CodingKey {
        case kind = "kind"
        case markerID = "marker_id"
        case note = "note"
        case pageID = "page_id"
        case position = "position"
        case sessionID = "session_id"
        case source = "source"
        case tMS = "t_ms"
    }
}

// MARK: MarkerAddData convenience initializers and mutators

extension MarkerAddData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MarkerAddData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        kind: MarkerKindEnum? = nil,
        markerID: String? = nil,
        note: String?? = nil,
        pageID: String?? = nil,
        position: MarkerPosition?? = nil,
        sessionID: String? = nil,
        source: ClientDevice? = nil,
        tMS: Int? = nil
    ) -> MarkerAddData {
        return MarkerAddData(
            kind: kind ?? self.kind,
            markerID: markerID ?? self.markerID,
            note: note ?? self.note,
            pageID: pageID ?? self.pageID,
            position: position ?? self.position,
            sessionID: sessionID ?? self.sessionID,
            source: source ?? self.source,
            tMS: tMS ?? self.tMS
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - MarkerAddOp
struct MarkerAddOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: MarkerAddData
    let kind: MarkerAddOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: MarkerAddOp convenience initializers and mutators

extension MarkerAddOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MarkerAddOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: MarkerAddData? = nil,
        kind: MarkerAddOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> MarkerAddOp {
        return MarkerAddOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum MarkerAddOpKind: String, Codable {
    case markerAdd = "marker.add"
}

/// Rückgängig (⌘Z, F-DSH-05) bzw. Löschen
// MARK: - MarkerRemoveData
struct MarkerRemoveData: Codable {
    let markerID: String

    enum CodingKeys: String, CodingKey {
        case markerID = "marker_id"
    }
}

// MARK: MarkerRemoveData convenience initializers and mutators

extension MarkerRemoveData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MarkerRemoveData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        markerID: String? = nil
    ) -> MarkerRemoveData {
        return MarkerRemoveData(
            markerID: markerID ?? self.markerID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - MarkerRemoveOp
struct MarkerRemoveOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: MarkerRemoveData
    let kind: MarkerRemoveOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: MarkerRemoveOp convenience initializers and mutators

extension MarkerRemoveOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MarkerRemoveOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: MarkerRemoveData? = nil,
        kind: MarkerRemoveOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> MarkerRemoveOp {
        return MarkerRemoveOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum MarkerRemoveOpKind: String, Codable {
    case markerRemove = "marker.remove"
}

// MARK: - Module
struct Module: Codable {
    let color: ModuleColor
    let createdAt: Date
    let deletedAt: Date?
    let descriptionMd: String?
    let ects: Double?
    let examType: String?
    let id: String
    let lang: Lang?
    let lecturer: String?
    let name: String
    let semesterID: String
    let settings: ModuleSettings
    let shortName: String?
    let updatedAt: Date
    let userID: String

    enum CodingKeys: String, CodingKey {
        case color = "color"
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case descriptionMd = "description_md"
        case ects = "ects"
        case examType = "exam_type"
        case id = "id"
        case lang = "lang"
        case lecturer = "lecturer"
        case name = "name"
        case semesterID = "semester_id"
        case settings = "settings"
        case shortName = "short_name"
        case updatedAt = "updated_at"
        case userID = "user_id"
    }
}

// MARK: Module convenience initializers and mutators

extension Module {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Module.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        color: ModuleColor? = nil,
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        descriptionMd: String?? = nil,
        ects: Double?? = nil,
        examType: String?? = nil,
        id: String? = nil,
        lang: Lang?? = nil,
        lecturer: String?? = nil,
        name: String? = nil,
        semesterID: String? = nil,
        settings: ModuleSettings? = nil,
        shortName: String?? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil
    ) -> Module {
        return Module(
            color: color ?? self.color,
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            descriptionMd: descriptionMd ?? self.descriptionMd,
            ects: ects ?? self.ects,
            examType: examType ?? self.examType,
            id: id ?? self.id,
            lang: lang ?? self.lang,
            lecturer: lecturer ?? self.lecturer,
            name: name ?? self.name,
            semesterID: semesterID ?? self.semesterID,
            settings: settings ?? self.settings,
            shortName: shortName ?? self.shortName,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Token aus der festen Palette mit 12 Tönen (07 §8), Werte in packages/ui-tokens
enum ModuleColor: String, Codable {
    case mod01 = "mod-01"
    case mod02 = "mod-02"
    case mod03 = "mod-03"
    case mod04 = "mod-04"
    case mod05 = "mod-05"
    case mod06 = "mod-06"
    case mod07 = "mod-07"
    case mod08 = "mod-08"
    case mod09 = "mod-09"
    case mod10 = "mod-10"
    case mod11 = "mod-11"
    case mod12 = "mod-12"
}

/// module.settings (W-06 Option A, 03 §3). Fehlender Schlüssel = globaler Standard aus
/// Settings.lecture
// MARK: - ModuleSettings
struct ModuleSettings: Codable {
    let columnWidths: [Double]?
    let inkMode: InkMode?
    let layout: DashboardLayout?

    enum CodingKeys: String, CodingKey {
        case columnWidths = "column_widths"
        case inkMode = "ink_mode"
        case layout = "layout"
    }
}

// MARK: ModuleSettings convenience initializers and mutators

extension ModuleSettings {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ModuleSettings.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        columnWidths: [Double]?? = nil,
        inkMode: InkMode?? = nil,
        layout: DashboardLayout?? = nil
    ) -> ModuleSettings {
        return ModuleSettings(
            columnWidths: columnWidths ?? self.columnWidths,
            inkMode: inkMode ?? self.inkMode,
            layout: layout ?? self.layout
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Name genügt, alles andere optional (F-ORG-01). Ohne Farbe vergibt der Core die nächste
/// freie Palettenfarbe. id ist optional und darf vom Client erzeugt werden (03 §1).
// MARK: - ModuleCreate
struct ModuleCreate: Codable {
    let color: ModuleColor?
    let descriptionMd: String?
    let ects: Double?
    let examType: String?
    let id: String?
    let lang: Lang?
    let lecturer: String?
    let name: String
    let semesterID: String
    let shortName: String?

    enum CodingKeys: String, CodingKey {
        case color = "color"
        case descriptionMd = "description_md"
        case ects = "ects"
        case examType = "exam_type"
        case id = "id"
        case lang = "lang"
        case lecturer = "lecturer"
        case name = "name"
        case semesterID = "semester_id"
        case shortName = "short_name"
    }
}

// MARK: ModuleCreate convenience initializers and mutators

extension ModuleCreate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ModuleCreate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        color: ModuleColor?? = nil,
        descriptionMd: String?? = nil,
        ects: Double?? = nil,
        examType: String?? = nil,
        id: String?? = nil,
        lang: Lang?? = nil,
        lecturer: String?? = nil,
        name: String? = nil,
        semesterID: String? = nil,
        shortName: String?? = nil
    ) -> ModuleCreate {
        return ModuleCreate(
            color: color ?? self.color,
            descriptionMd: descriptionMd ?? self.descriptionMd,
            ects: ects ?? self.ects,
            examType: examType ?? self.examType,
            id: id ?? self.id,
            lang: lang ?? self.lang,
            lecturer: lecturer ?? self.lecturer,
            name: name ?? self.name,
            semesterID: semesterID ?? self.semesterID,
            shortName: shortName ?? self.shortName
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - ModuleList
struct ModuleList: Codable {
    let items: [Module]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case items = "items"
        case nextCursor = "next_cursor"
    }
}

// MARK: ModuleList convenience initializers and mutators

extension ModuleList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ModuleList.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        items: [Module]? = nil,
        nextCursor: String?? = nil
    ) -> ModuleList {
        return ModuleList(
            items: items ?? self.items,
            nextCursor: nextCursor ?? self.nextCursor
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Teil von ModuleUpdate.settings: Schlüssel für Schlüssel zusammenführen, null entfernt den
/// Schlüssel
// MARK: - ModuleSettingsUpdate
struct ModuleSettingsUpdate: Codable {
    let columnWidths: [Double]?
    let inkMode: InkMode?
    let layout: DashboardLayout?

    enum CodingKeys: String, CodingKey {
        case columnWidths = "column_widths"
        case inkMode = "ink_mode"
        case layout = "layout"
    }
}

// MARK: ModuleSettingsUpdate convenience initializers and mutators

extension ModuleSettingsUpdate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ModuleSettingsUpdate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        columnWidths: [Double]?? = nil,
        inkMode: InkMode?? = nil,
        layout: DashboardLayout?? = nil
    ) -> ModuleSettingsUpdate {
        return ModuleSettingsUpdate(
            columnWidths: columnWidths ?? self.columnWidths,
            inkMode: inkMode ?? self.inkMode,
            layout: layout ?? self.layout
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// PATCH /modules/{id}. settings wird Schlüssel für Schlüssel zusammengeführt, null entfernt
/// einen Schlüssel (docs/VERTRAEGE.md §14.2)
// MARK: - ModuleUpdate
struct ModuleUpdate: Codable {
    let color: ModuleColor?
    let descriptionMd: String?
    let ects: Double?
    let examType: String?
    let lang: Lang?
    let lecturer: String?
    let name: String?
    let semesterID: String?
    let settings: ModuleSettingsUpdate?
    let shortName: String?

    enum CodingKeys: String, CodingKey {
        case color = "color"
        case descriptionMd = "description_md"
        case ects = "ects"
        case examType = "exam_type"
        case lang = "lang"
        case lecturer = "lecturer"
        case name = "name"
        case semesterID = "semester_id"
        case settings = "settings"
        case shortName = "short_name"
    }
}

// MARK: ModuleUpdate convenience initializers and mutators

extension ModuleUpdate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ModuleUpdate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        color: ModuleColor?? = nil,
        descriptionMd: String?? = nil,
        ects: Double?? = nil,
        examType: String?? = nil,
        lang: Lang?? = nil,
        lecturer: String?? = nil,
        name: String?? = nil,
        semesterID: String?? = nil,
        settings: ModuleSettingsUpdate?? = nil,
        shortName: String?? = nil
    ) -> ModuleUpdate {
        return ModuleUpdate(
            color: color ?? self.color,
            descriptionMd: descriptionMd ?? self.descriptionMd,
            ects: ects ?? self.ects,
            examType: examType ?? self.examType,
            lang: lang ?? self.lang,
            lecturer: lecturer ?? self.lecturer,
            name: name ?? self.name,
            semesterID: semesterID ?? self.semesterID,
            settings: settings ?? self.settings,
            shortName: shortName ?? self.shortName
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - Notebook
struct Notebook: Codable {
    let createdAt: Date
    let deletedAt: Date?
    let id: String
    let kind: NotebookKind
    let moduleID: String
    /// Abgeleitet
    let pageCount: Int
    let title: String
    let updatedAt: Date
    let userID: String

    enum CodingKeys: String, CodingKey {
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case id = "id"
        case kind = "kind"
        case moduleID = "module_id"
        case pageCount = "page_count"
        case title = "title"
        case updatedAt = "updated_at"
        case userID = "user_id"
    }
}

// MARK: Notebook convenience initializers and mutators

extension Notebook {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Notebook.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        id: String? = nil,
        kind: NotebookKind? = nil,
        moduleID: String? = nil,
        pageCount: Int? = nil,
        title: String? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil
    ) -> Notebook {
        return Notebook(
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            id: id ?? self.id,
            kind: kind ?? self.kind,
            moduleID: moduleID ?? self.moduleID,
            pageCount: pageCount ?? self.pageCount,
            title: title ?? self.title,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum NotebookKind: String, Codable {
    case frei = "frei"
    case uebung = "uebung"
    case vorlesung = "vorlesung"
}

/// POST /notebooks. kind fehlt = frei
// MARK: - NotebookCreate
struct NotebookCreate: Codable {
    let id: String?
    let kind: NotebookKind?
    let moduleID: String
    let title: String

    enum CodingKeys: String, CodingKey {
        case id = "id"
        case kind = "kind"
        case moduleID = "module_id"
        case title = "title"
    }
}

// MARK: NotebookCreate convenience initializers and mutators

extension NotebookCreate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(NotebookCreate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        id: String?? = nil,
        kind: NotebookKind?? = nil,
        moduleID: String? = nil,
        title: String? = nil
    ) -> NotebookCreate {
        return NotebookCreate(
            id: id ?? self.id,
            kind: kind ?? self.kind,
            moduleID: moduleID ?? self.moduleID,
            title: title ?? self.title
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Freies Notizbuch offline anlegen (F-INK-02, F-INK-14). Strom notebook:<notebook_id>,
/// idempotent über notebook_id.
// MARK: - NotebookCreateData
struct NotebookCreateData: Codable {
    let createdAt: Int
    /// Nur frei. Die Notizbücher vorlesung/uebung legt der Core an
    let kind: NotebookCreateDataKind?
    let moduleID: String
    let notebookID: String
    let title: String

    enum CodingKeys: String, CodingKey {
        case createdAt = "created_at"
        case kind = "kind"
        case moduleID = "module_id"
        case notebookID = "notebook_id"
        case title = "title"
    }
}

// MARK: NotebookCreateData convenience initializers and mutators

extension NotebookCreateData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(NotebookCreateData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        createdAt: Int? = nil,
        kind: NotebookCreateDataKind?? = nil,
        moduleID: String? = nil,
        notebookID: String? = nil,
        title: String? = nil
    ) -> NotebookCreateData {
        return NotebookCreateData(
            createdAt: createdAt ?? self.createdAt,
            kind: kind ?? self.kind,
            moduleID: moduleID ?? self.moduleID,
            notebookID: notebookID ?? self.notebookID,
            title: title ?? self.title
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum NotebookCreateDataKind: String, Codable {
    case frei = "frei"
}

// MARK: - NotebookCreateOp
struct NotebookCreateOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: NotebookCreateData
    let kind: NotebookCreateOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: NotebookCreateOp convenience initializers and mutators

extension NotebookCreateOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(NotebookCreateOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: NotebookCreateData? = nil,
        kind: NotebookCreateOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> NotebookCreateOp {
        return NotebookCreateOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum NotebookCreateOpKind: String, Codable {
    case notebookCreate = "notebook.create"
}

/// Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem
/// Papierkorb
// MARK: - NotebookDeleteOp
struct NotebookDeleteOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: NotebookRefData
    let kind: NotebookDeleteOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: NotebookDeleteOp convenience initializers and mutators

extension NotebookDeleteOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(NotebookDeleteOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: NotebookRefData? = nil,
        kind: NotebookDeleteOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> NotebookDeleteOp {
        return NotebookDeleteOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - NotebookRefData
struct NotebookRefData: Codable {
    let notebookID: String

    enum CodingKeys: String, CodingKey {
        case notebookID = "notebook_id"
    }
}

// MARK: NotebookRefData convenience initializers and mutators

extension NotebookRefData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(NotebookRefData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        notebookID: String? = nil
    ) -> NotebookRefData {
        return NotebookRefData(
            notebookID: notebookID ?? self.notebookID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum NotebookDeleteOpKind: String, Codable {
    case notebookDelete = "notebook.delete"
}

// MARK: - NotebookList
struct NotebookList: Codable {
    let items: [Notebook]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case items = "items"
        case nextCursor = "next_cursor"
    }
}

// MARK: NotebookList convenience initializers and mutators

extension NotebookList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(NotebookList.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        items: [Notebook]? = nil,
        nextCursor: String?? = nil
    ) -> NotebookList {
        return NotebookList(
            items: items ?? self.items,
            nextCursor: nextCursor ?? self.nextCursor
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// GET /notebooks/{id}/pages, nach index sortiert, ohne gelöschte Seiten
// MARK: - NotebookPages
struct NotebookPages: Codable {
    let items: [Page]
    let notebookID: String
    /// op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id
    /// senden
    let streamOpID: String?
    /// seq des Stroms notebook:<id> zu diesem Stand
    let streamSeq: Int

    enum CodingKeys: String, CodingKey {
        case items = "items"
        case notebookID = "notebook_id"
        case streamOpID = "stream_op_id"
        case streamSeq = "stream_seq"
    }
}

// MARK: NotebookPages convenience initializers and mutators

extension NotebookPages {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(NotebookPages.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        items: [Page]? = nil,
        notebookID: String? = nil,
        streamOpID: String?? = nil,
        streamSeq: Int? = nil
    ) -> NotebookPages {
        return NotebookPages(
            items: items ?? self.items,
            notebookID: notebookID ?? self.notebookID,
            streamOpID: streamOpID ?? self.streamOpID,
            streamSeq: streamSeq ?? self.streamSeq
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - Page
struct Page: Codable {
    let attachedSlideID: String?
    let backgroundSlideID: String?
    let createdAt: Date
    let deletedAt: Date?
    /// Abgeleitet: PencilKit-Sicherung liegt vor (GET /pages/{id}/pkdrawing)
    let hasPkdrawing: Bool
    let heightPt: Double
    let id: String
    /// Reihenfolge im Notizbuch, 1-basiert
    let index: Int
    let notebookID: String
    let sessionID: String?
    let template: PageTemplate
    let updatedAt: Date
    let userID: String
    let version: Int
    let widthPt: Double

    enum CodingKeys: String, CodingKey {
        case attachedSlideID = "attached_slide_id"
        case backgroundSlideID = "background_slide_id"
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case hasPkdrawing = "has_pkdrawing"
        case heightPt = "height_pt"
        case id = "id"
        case index = "index"
        case notebookID = "notebook_id"
        case sessionID = "session_id"
        case template = "template"
        case updatedAt = "updated_at"
        case userID = "user_id"
        case version = "version"
        case widthPt = "width_pt"
    }
}

// MARK: Page convenience initializers and mutators

extension Page {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Page.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        attachedSlideID: String?? = nil,
        backgroundSlideID: String?? = nil,
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        hasPkdrawing: Bool? = nil,
        heightPt: Double? = nil,
        id: String? = nil,
        index: Int? = nil,
        notebookID: String? = nil,
        sessionID: String?? = nil,
        template: PageTemplate? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil,
        version: Int? = nil,
        widthPt: Double? = nil
    ) -> Page {
        return Page(
            attachedSlideID: attachedSlideID ?? self.attachedSlideID,
            backgroundSlideID: backgroundSlideID ?? self.backgroundSlideID,
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            hasPkdrawing: hasPkdrawing ?? self.hasPkdrawing,
            heightPt: heightPt ?? self.heightPt,
            id: id ?? self.id,
            index: index ?? self.index,
            notebookID: notebookID ?? self.notebookID,
            sessionID: sessionID ?? self.sessionID,
            template: template ?? self.template,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID,
            version: version ?? self.version,
            widthPt: widthPt ?? self.widthPt
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum PageTemplate: String, Codable {
    case blanko = "blanko"
    case cornell = "cornell"
    case folie = "folie"
    case kariert = "kariert"
    case liniert = "liniert"
    case punktraster = "punktraster"
}

/// Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem
/// Papierkorb
// MARK: - NotebookRestoreOp
struct NotebookRestoreOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: NotebookRefData
    let kind: NotebookRestoreOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: NotebookRestoreOp convenience initializers and mutators

extension NotebookRestoreOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(NotebookRestoreOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: NotebookRefData? = nil,
        kind: NotebookRestoreOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> NotebookRestoreOp {
        return NotebookRestoreOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum NotebookRestoreOpKind: String, Codable {
    case notebookRestore = "notebook.restore"
}

/// PATCH /notebooks/{id}
// MARK: - NotebookUpdate
struct NotebookUpdate: Codable {
    let moduleID: String?
    let title: String?

    enum CodingKeys: String, CodingKey {
        case moduleID = "module_id"
        case title = "title"
    }
}

// MARK: NotebookUpdate convenience initializers and mutators

extension NotebookUpdate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(NotebookUpdate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        moduleID: String?? = nil,
        title: String?? = nil
    ) -> NotebookUpdate {
        return NotebookUpdate(
            moduleID: moduleID ?? self.moduleID,
            title: title ?? self.title
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - NotebookUpdateData
struct NotebookUpdateData: Codable {
    let fields: NotebookUpdateFields
    let notebookID: String

    enum CodingKeys: String, CodingKey {
        case fields = "fields"
        case notebookID = "notebook_id"
    }
}

// MARK: NotebookUpdateData convenience initializers and mutators

extension NotebookUpdateData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(NotebookUpdateData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        fields: NotebookUpdateFields? = nil,
        notebookID: String? = nil
    ) -> NotebookUpdateData {
        return NotebookUpdateData(
            fields: fields ?? self.fields,
            notebookID: notebookID ?? self.notebookID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Aktueller Stand der per REST änderbaren Felder
// MARK: - NotebookUpdateFields
struct NotebookUpdateFields: Codable {
    let moduleID: String
    let title: String

    enum CodingKeys: String, CodingKey {
        case moduleID = "module_id"
        case title = "title"
    }
}

// MARK: NotebookUpdateFields convenience initializers and mutators

extension NotebookUpdateFields {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(NotebookUpdateFields.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        moduleID: String? = nil,
        title: String? = nil
    ) -> NotebookUpdateFields {
        return NotebookUpdateFields(
            moduleID: moduleID ?? self.moduleID,
            title: title ?? self.title
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem
/// Papierkorb
// MARK: - NotebookUpdateOp
struct NotebookUpdateOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: NotebookUpdateData
    let kind: NotebookUpdateOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: NotebookUpdateOp convenience initializers and mutators

extension NotebookUpdateOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(NotebookUpdateOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: NotebookUpdateData? = nil,
        kind: NotebookUpdateOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> NotebookUpdateOp {
        return NotebookUpdateOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum NotebookUpdateOpKind: String, Codable {
    case notebookUpdate = "notebook.update"
}

// MARK: - PageCreateData
struct PageCreateData: Codable {
    let attachedSlideID: String?
    let backgroundSlideID: String?
    let heightPt: Double
    let index: Int
    let notebookID: String
    let pageID: String
    let sessionID: String?
    let template: PageTemplate
    let widthPt: Double

    enum CodingKeys: String, CodingKey {
        case attachedSlideID = "attached_slide_id"
        case backgroundSlideID = "background_slide_id"
        case heightPt = "height_pt"
        case index = "index"
        case notebookID = "notebook_id"
        case pageID = "page_id"
        case sessionID = "session_id"
        case template = "template"
        case widthPt = "width_pt"
    }
}

// MARK: PageCreateData convenience initializers and mutators

extension PageCreateData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PageCreateData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        attachedSlideID: String?? = nil,
        backgroundSlideID: String?? = nil,
        heightPt: Double? = nil,
        index: Int? = nil,
        notebookID: String? = nil,
        pageID: String? = nil,
        sessionID: String?? = nil,
        template: PageTemplate? = nil,
        widthPt: Double? = nil
    ) -> PageCreateData {
        return PageCreateData(
            attachedSlideID: attachedSlideID ?? self.attachedSlideID,
            backgroundSlideID: backgroundSlideID ?? self.backgroundSlideID,
            heightPt: heightPt ?? self.heightPt,
            index: index ?? self.index,
            notebookID: notebookID ?? self.notebookID,
            pageID: pageID ?? self.pageID,
            sessionID: sessionID ?? self.sessionID,
            template: template ?? self.template,
            widthPt: widthPt ?? self.widthPt
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - PageCreateOp
struct PageCreateOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: PageCreateData
    let kind: PageCreateOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: PageCreateOp convenience initializers and mutators

extension PageCreateOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PageCreateOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: PageCreateData? = nil,
        kind: PageCreateOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> PageCreateOp {
        return PageCreateOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum PageCreateOpKind: String, Codable {
    case pageCreate = "page.create"
}

// MARK: - PageDeleteData
struct PageDeleteData: Codable {
    let pageID: String

    enum CodingKeys: String, CodingKey {
        case pageID = "page_id"
    }
}

// MARK: PageDeleteData convenience initializers and mutators

extension PageDeleteData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PageDeleteData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        pageID: String? = nil
    ) -> PageDeleteData {
        return PageDeleteData(
            pageID: pageID ?? self.pageID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - PageDeleteOp
struct PageDeleteOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: PageDeleteData
    let kind: PageDeleteOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: PageDeleteOp convenience initializers and mutators

extension PageDeleteOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PageDeleteOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: PageDeleteData? = nil,
        kind: PageDeleteOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> PageDeleteOp {
        return PageDeleteOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum PageDeleteOpKind: String, Codable {
    case pageDelete = "page.delete"
}

/// GET /pages/{id}: Seite mit Elementen (ohne gelöschte, nach z sortiert)
// MARK: - PageDetail
struct PageDetail: Codable {
    let elements: [PageElement]
    let page: Page
    /// op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id
    /// senden
    let streamOpID: String?
    let streamSeq: Int

    enum CodingKeys: String, CodingKey {
        case elements = "elements"
        case page = "page"
        case streamOpID = "stream_op_id"
        case streamSeq = "stream_seq"
    }
}

// MARK: PageDetail convenience initializers and mutators

extension PageDetail {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PageDetail.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        elements: [PageElement]? = nil,
        page: Page? = nil,
        streamOpID: String?? = nil,
        streamSeq: Int? = nil
    ) -> PageDetail {
        return PageDetail(
            elements: elements ?? self.elements,
            page: page ?? self.page,
            streamOpID: streamOpID ?? self.streamOpID,
            streamSeq: streamSeq ?? self.streamSeq
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - PageRefData
struct PageRefData: Codable {
    let pageID: String

    enum CodingKeys: String, CodingKey {
        case pageID = "page_id"
    }
}

// MARK: PageRefData convenience initializers and mutators

extension PageRefData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PageRefData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        pageID: String? = nil
    ) -> PageRefData {
        return PageRefData(
            pageID: pageID ?? self.pageID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem
/// Papierkorb
// MARK: - PageRestoreOp
struct PageRestoreOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: PageRefData
    let kind: PageRestoreOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: PageRestoreOp convenience initializers and mutators

extension PageRestoreOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PageRestoreOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: PageRefData? = nil,
        kind: PageRestoreOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> PageRestoreOp {
        return PageRestoreOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum PageRestoreOpKind: String, Codable {
    case pageRestore = "page.restore"
}

/// GET /pages/{id}/strokes: alle nicht gelöschten Striche, nach created_at sortiert
// MARK: - PageStrokes
struct PageStrokes: Codable {
    let pageID: String
    /// op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id
    /// senden
    let streamOpID: String?
    /// seq des Stroms notebook:<id> zu diesem Stand
    let streamSeq: Int
    let strokes: [Stroke]

    enum CodingKeys: String, CodingKey {
        case pageID = "page_id"
        case streamOpID = "stream_op_id"
        case streamSeq = "stream_seq"
        case strokes = "strokes"
    }
}

// MARK: PageStrokes convenience initializers and mutators

extension PageStrokes {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PageStrokes.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        pageID: String? = nil,
        streamOpID: String?? = nil,
        streamSeq: Int? = nil,
        strokes: [Stroke]? = nil
    ) -> PageStrokes {
        return PageStrokes(
            pageID: pageID ?? self.pageID,
            streamOpID: streamOpID ?? self.streamOpID,
            streamSeq: streamSeq ?? self.streamSeq,
            strokes: strokes ?? self.strokes
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Neutrales Strich-Format (08 §4.1/4.2). points sind Rohkoordinaten VOR transform, bbox
/// gilt NACH transform inklusive halber Breite. dt des ersten Punkts ist 0; t_end_ms −
/// t_start_ms entspricht dem letzten dt. t_start_ms/t_end_ms null außerhalb einer Session.
// MARK: - Stroke
struct Stroke: Codable {
    let bbox: [Double]
    let clientID: String
    let color: String
    let createdAt: Int
    let layer: StrokeLayer
    /// Base64 (ohne Zeilenumbrüche) von n ≥ 1 Punkten à 24 Byte: x, y, dt, force, azimuth,
    /// altitude als Float32 little-endian (08 §4.2). 24 Byte = genau 32 Base64-Zeichen, daher
    /// nie Padding
    let points: String
    let tEndMS: Int?
    let tStartMS: Int?
    let tool: StrokeTool
    let transform: [Double]
    /// Grundbreite in pt
    let width: Double

    enum CodingKeys: String, CodingKey {
        case bbox = "bbox"
        case clientID = "client_id"
        case color = "color"
        case createdAt = "created_at"
        case layer = "layer"
        case points = "points"
        case tEndMS = "t_end_ms"
        case tStartMS = "t_start_ms"
        case tool = "tool"
        case transform = "transform"
        case width = "width"
    }
}

// MARK: Stroke convenience initializers and mutators

extension Stroke {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Stroke.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        bbox: [Double]? = nil,
        clientID: String? = nil,
        color: String? = nil,
        createdAt: Int? = nil,
        layer: StrokeLayer? = nil,
        points: String? = nil,
        tEndMS: Int?? = nil,
        tStartMS: Int?? = nil,
        tool: StrokeTool? = nil,
        transform: [Double]? = nil,
        width: Double? = nil
    ) -> Stroke {
        return Stroke(
            bbox: bbox ?? self.bbox,
            clientID: clientID ?? self.clientID,
            color: color ?? self.color,
            createdAt: createdAt ?? self.createdAt,
            layer: layer ?? self.layer,
            points: points ?? self.points,
            tEndMS: tEndMS ?? self.tEndMS,
            tStartMS: tStartMS ?? self.tStartMS,
            tool: tool ?? self.tool,
            transform: transform ?? self.transform,
            width: width ?? self.width
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum StrokeLayer: String, Codable {
    case highlight = "highlight"
    case ink = "ink"
}

enum StrokeTool: String, Codable {
    case fountain = "fountain"
    case marker = "marker"
    case monoline = "monoline"
    case pen = "pen"
    case pencil = "pencil"
}

// MARK: - PageUpdateData
struct PageUpdateData: Codable {
    let fields: PageUpdateFields
    let pageID: String
    /// Version, auf der die Änderung beruht. Der Core setzt danach version + 1
    let version: Int

    enum CodingKeys: String, CodingKey {
        case fields = "fields"
        case pageID = "page_id"
        case version = "version"
    }
}

// MARK: PageUpdateData convenience initializers and mutators

extension PageUpdateData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PageUpdateData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        fields: PageUpdateFields? = nil,
        pageID: String? = nil,
        version: Int? = nil
    ) -> PageUpdateData {
        return PageUpdateData(
            fields: fields ?? self.fields,
            pageID: pageID ?? self.pageID,
            version: version ?? self.version
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Alle änderbaren Felder der Seite mit ihrem neuen Stand. Kein Teil-Update: im Sync gibt es
/// keine optionalen nullbaren Felder (VERTRAEGE §11.7)
// MARK: - PageUpdateFields
struct PageUpdateFields: Codable {
    let attachedSlideID: String?
    let backgroundSlideID: String?
    let index: Int
    let sessionID: String?
    let template: PageTemplate

    enum CodingKeys: String, CodingKey {
        case attachedSlideID = "attached_slide_id"
        case backgroundSlideID = "background_slide_id"
        case index = "index"
        case sessionID = "session_id"
        case template = "template"
    }
}

// MARK: PageUpdateFields convenience initializers and mutators

extension PageUpdateFields {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PageUpdateFields.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        attachedSlideID: String?? = nil,
        backgroundSlideID: String?? = nil,
        index: Int? = nil,
        sessionID: String?? = nil,
        template: PageTemplate? = nil
    ) -> PageUpdateFields {
        return PageUpdateFields(
            attachedSlideID: attachedSlideID ?? self.attachedSlideID,
            backgroundSlideID: backgroundSlideID ?? self.backgroundSlideID,
            index: index ?? self.index,
            sessionID: sessionID ?? self.sessionID,
            template: template ?? self.template
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - PageUpdateOp
struct PageUpdateOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: PageUpdateData
    let kind: PageUpdateOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: PageUpdateOp convenience initializers and mutators

extension PageUpdateOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PageUpdateOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: PageUpdateData? = nil,
        kind: PageUpdateOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> PageUpdateOp {
        return PageUpdateOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum PageUpdateOpKind: String, Codable {
    case pageUpdate = "page.update"
}

/// POST /devices/pair/confirm (aus dem Netz ohne Token erlaubt). Geheimnis ist der Code.
/// public_nonce verknüpft die Bestätigung mit einer eigenen pair/start-Anfrage; gehört sie
/// zu einer abgelehnten Anfrage, wird abgelehnt.
// MARK: - PairConfirmRequest
struct PairConfirmRequest: Codable {
    let appVersion: String?
    let code: String
    let deviceName: String
    let kind: DeviceKind
    let pairingID: String
    let publicNonce: String

    enum CodingKeys: String, CodingKey {
        case appVersion = "app_version"
        case code = "code"
        case deviceName = "device_name"
        case kind = "kind"
        case pairingID = "pairing_id"
        case publicNonce = "public_nonce"
    }
}

// MARK: PairConfirmRequest convenience initializers and mutators

extension PairConfirmRequest {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PairConfirmRequest.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        appVersion: String?? = nil,
        code: String? = nil,
        deviceName: String? = nil,
        kind: DeviceKind? = nil,
        pairingID: String? = nil,
        publicNonce: String? = nil
    ) -> PairConfirmRequest {
        return PairConfirmRequest(
            appVersion: appVersion ?? self.appVersion,
            code: code ?? self.code,
            deviceName: deviceName ?? self.deviceName,
            kind: kind ?? self.kind,
            pairingID: pairingID ?? self.pairingID,
            publicNonce: publicNonce ?? self.publicNonce
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Antwort auf POST /devices/pair/confirm (201)
// MARK: - PairResponse
struct PairResponse: Codable {
    let device: Device
    /// 256 Bit Zufall, base64url ohne Padding. Wird nur dieses eine Mal ausgegeben
    let deviceToken: String

    enum CodingKeys: String, CodingKey {
        case device = "device"
        case deviceToken = "device_token"
    }
}

// MARK: PairResponse convenience initializers and mutators

extension PairResponse {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PairResponse.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        device: Device? = nil,
        deviceToken: String? = nil
    ) -> PairResponse {
        return PairResponse(
            device: device ?? self.device,
            deviceToken: deviceToken ?? self.deviceToken
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// POST /devices/pair/start (aus dem Netz ohne Token erlaubt). Nur bei offenem
/// Kopplungsfenster; belegt es nicht exklusiv
// MARK: - PairStartRequest
struct PairStartRequest: Codable {
    let deviceName: String
    let kind: DeviceKind
    /// Zufallswert des iPads (base64url, ≥ 128 Bit)
    let publicNonce: String

    enum CodingKeys: String, CodingKey {
        case deviceName = "device_name"
        case kind = "kind"
        case publicNonce = "public_nonce"
    }
}

// MARK: PairStartRequest convenience initializers and mutators

extension PairStartRequest {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PairStartRequest.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        deviceName: String? = nil,
        kind: DeviceKind? = nil,
        publicNonce: String? = nil
    ) -> PairStartRequest {
        return PairStartRequest(
            deviceName: deviceName ?? self.deviceName,
            kind: kind ?? self.kind,
            publicNonce: publicNonce ?? self.publicNonce
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// pair/start: request_id der eigenen Anfrage und pairing_id des offenen Fensters. Der Code
/// steht NICHT in der Antwort
// MARK: - PairStartResponse
struct PairStartResponse: Codable {
    let expiresAt: Date
    let pairingID: String
    let requestID: String

    enum CodingKeys: String, CodingKey {
        case expiresAt = "expires_at"
        case pairingID = "pairing_id"
        case requestID = "request_id"
    }
}

// MARK: PairStartResponse convenience initializers and mutators

extension PairStartResponse {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PairStartResponse.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        expiresAt: Date? = nil,
        pairingID: String? = nil,
        requestID: String? = nil
    ) -> PairStartResponse {
        return PairStartResponse(
            expiresAt: expiresAt ?? self.expiresAt,
            pairingID: pairingID ?? self.pairingID,
            requestID: requestID ?? self.requestID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Offenes Kopplungsfenster für die Anzeige in der Web-App (POST /devices/pairings, nur
/// lokal; Ereignis pairing.requested)
// MARK: - PairingCode
struct PairingCode: Codable {
    let code: String
    let expiresAt: Date
    /// Adresse des Macs im lokalen Netz (IPv4 der aktiven Schnittstelle), zur Anzeige und für
    /// die manuelle Eingabe
    let host: String
    let pairingID: String
    let port: Int
    /// Inhalt des QR-Codes: dieselben Daten wie host, port, pairing_id und code
    let qrURL: String

    enum CodingKeys: String, CodingKey {
        case code = "code"
        case expiresAt = "expires_at"
        case host = "host"
        case pairingID = "pairing_id"
        case port = "port"
        case qrURL = "qr_url"
    }
}

// MARK: PairingCode convenience initializers and mutators

extension PairingCode {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PairingCode.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        code: String? = nil,
        expiresAt: Date? = nil,
        host: String? = nil,
        pairingID: String? = nil,
        port: Int? = nil,
        qrURL: String? = nil
    ) -> PairingCode {
        return PairingCode(
            code: code ?? self.code,
            expiresAt: expiresAt ?? self.expiresAt,
            host: host ?? self.host,
            pairingID: pairingID ?? self.pairingID,
            port: port ?? self.port,
            qrURL: qrURL ?? self.qrURL
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Anfrage eines Geräts über pair/start. Die Web-App listet sie und kann sie ablehnen
/// (DELETE /devices/pairings/requests/{request_id})
// MARK: - PairingRequest
struct PairingRequest: Codable {
    let deviceName: String
    let kind: DeviceKind
    let pairingID: String
    let requestID: String
    let requestedAt: Date

    enum CodingKeys: String, CodingKey {
        case deviceName = "device_name"
        case kind = "kind"
        case pairingID = "pairing_id"
        case requestID = "request_id"
        case requestedAt = "requested_at"
    }
}

// MARK: PairingRequest convenience initializers and mutators

extension PairingRequest {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PairingRequest.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        deviceName: String? = nil,
        kind: DeviceKind? = nil,
        pairingID: String? = nil,
        requestID: String? = nil,
        requestedAt: Date? = nil
    ) -> PairingRequest {
        return PairingRequest(
            deviceName: deviceName ?? self.deviceName,
            kind: kind ?? self.kind,
            pairingID: pairingID ?? self.pairingID,
            requestID: requestID ?? self.requestID,
            requestedAt: requestedAt ?? self.requestedAt
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - PDFIngestDeckPayload
struct PDFIngestDeckPayload: Codable {
    let slideDeckID: String

    enum CodingKeys: String, CodingKey {
        case slideDeckID = "slide_deck_id"
    }
}

// MARK: PDFIngestDeckPayload convenience initializers and mutators

extension PDFIngestDeckPayload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PDFIngestDeckPayload.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        slideDeckID: String? = nil
    ) -> PDFIngestDeckPayload {
        return PDFIngestDeckPayload(
            slideDeckID: slideDeckID ?? self.slideDeckID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// pdf.ingest: entweder ein Foliensatz oder ein Übungsblatt (genau eine ID). Ergänzung zu 08
/// §5: Übungsblätter laufen über denselben Job.
// MARK: - PDFIngestPayload
struct PDFIngestPayload: Codable {
    let slideDeckID: String?
    let exerciseSheetID: String?

    enum CodingKeys: String, CodingKey {
        case slideDeckID = "slide_deck_id"
        case exerciseSheetID = "exercise_sheet_id"
    }
}

// MARK: PDFIngestPayload convenience initializers and mutators

extension PDFIngestPayload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PDFIngestPayload.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        slideDeckID: String?? = nil,
        exerciseSheetID: String?? = nil
    ) -> PDFIngestPayload {
        return PDFIngestPayload(
            slideDeckID: slideDeckID ?? self.slideDeckID,
            exerciseSheetID: exerciseSheetID ?? self.exerciseSheetID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - PDFIngestResult
struct PDFIngestResult: Codable {
    let durationMS: Int
    let pageCount: Int
    let pagesWithText: Int

    enum CodingKeys: String, CodingKey {
        case durationMS = "duration_ms"
        case pageCount = "page_count"
        case pagesWithText = "pages_with_text"
    }
}

// MARK: PDFIngestResult convenience initializers and mutators

extension PDFIngestResult {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PDFIngestResult.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        durationMS: Int? = nil,
        pageCount: Int? = nil,
        pagesWithText: Int? = nil
    ) -> PDFIngestResult {
        return PDFIngestResult(
            durationMS: durationMS ?? self.durationMS,
            pageCount: pageCount ?? self.pageCount,
            pagesWithText: pagesWithText ?? self.pagesWithText
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - PDFIngestSheetPayload
struct PDFIngestSheetPayload: Codable {
    let exerciseSheetID: String

    enum CodingKeys: String, CodingKey {
        case exerciseSheetID = "exercise_sheet_id"
    }
}

// MARK: PDFIngestSheetPayload convenience initializers and mutators

extension PDFIngestSheetPayload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PDFIngestSheetPayload.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        exerciseSheetID: String? = nil
    ) -> PDFIngestSheetPayload {
        return PDFIngestSheetPayload(
            exerciseSheetID: exerciseSheetID ?? self.exerciseSheetID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - PenSettings
struct PenSettings: Codable {
    let doubleTap: PencilDoubleTapAction
    let favoriteColors: [String]
    /// Formerkennung (F-INK-09, ab Phase 3)
    let shapeRecognition: Bool
    let squeeze: PencilSqueezeAction

    enum CodingKeys: String, CodingKey {
        case doubleTap = "double_tap"
        case favoriteColors = "favorite_colors"
        case shapeRecognition = "shape_recognition"
        case squeeze = "squeeze"
    }
}

// MARK: PenSettings convenience initializers and mutators

extension PenSettings {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PenSettings.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        doubleTap: PencilDoubleTapAction? = nil,
        favoriteColors: [String]? = nil,
        shapeRecognition: Bool? = nil,
        squeeze: PencilSqueezeAction? = nil
    ) -> PenSettings {
        return PenSettings(
            doubleTap: doubleTap ?? self.doubleTap,
            favoriteColors: favoriteColors ?? self.favoriteColors,
            shapeRecognition: shapeRecognition ?? self.shapeRecognition,
            squeeze: squeeze ?? self.squeeze
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// system = Einstellung von iPadOS übernehmen
enum PencilDoubleTapAction: String, Codable {
    case aus = "aus"
    case farbpalette = "farbpalette"
    case letztesWerkzeug = "letztes_werkzeug"
    case radierer = "radierer"
    case system = "system"
}

enum PencilSqueezeAction: String, Codable {
    case aus = "aus"
    case radierer = "radierer"
    case system = "system"
    case werkzeugpalette = "werkzeugpalette"
}

// MARK: - PenSettingsUpdate
struct PenSettingsUpdate: Codable {
    let doubleTap: PencilDoubleTapAction?
    let favoriteColors: [String]?
    /// Formerkennung (F-INK-09, ab Phase 3)
    let shapeRecognition: Bool?
    let squeeze: PencilSqueezeAction?

    enum CodingKeys: String, CodingKey {
        case doubleTap = "double_tap"
        case favoriteColors = "favorite_colors"
        case shapeRecognition = "shape_recognition"
        case squeeze = "squeeze"
    }
}

// MARK: PenSettingsUpdate convenience initializers and mutators

extension PenSettingsUpdate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PenSettingsUpdate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        doubleTap: PencilDoubleTapAction?? = nil,
        favoriteColors: [String]?? = nil,
        shapeRecognition: Bool?? = nil,
        squeeze: PencilSqueezeAction?? = nil
    ) -> PenSettingsUpdate {
        return PenSettingsUpdate(
            doubleTap: doubleTap ?? self.doubleTap,
            favoriteColors: favoriteColors ?? self.favoriteColors,
            shapeRecognition: shapeRecognition ?? self.shapeRecognition,
            squeeze: squeeze ?? self.squeeze
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Tafel-Foto (Metadaten). Datei: GET /photos/{id}/file
// MARK: - Photo
struct Photo: Codable {
    let createdAt: Date
    let deletedAt: Date?
    /// false, bis PUT /photos/{id}/file angekommen ist
    let hasFile: Bool
    let id: String
    let mime: PhotoMIME
    let ocrText: String?
    let pageID: String?
    let sessionID: String
    let sha256: String
    let sizeBytes: Int
    let tMS: Int
    let updatedAt: Date
    let userID: String

    enum CodingKeys: String, CodingKey {
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case hasFile = "has_file"
        case id = "id"
        case mime = "mime"
        case ocrText = "ocr_text"
        case pageID = "page_id"
        case sessionID = "session_id"
        case sha256 = "sha256"
        case sizeBytes = "size_bytes"
        case tMS = "t_ms"
        case updatedAt = "updated_at"
        case userID = "user_id"
    }
}

// MARK: Photo convenience initializers and mutators

extension Photo {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Photo.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        hasFile: Bool? = nil,
        id: String? = nil,
        mime: PhotoMIME? = nil,
        ocrText: String?? = nil,
        pageID: String?? = nil,
        sessionID: String? = nil,
        sha256: String? = nil,
        sizeBytes: Int? = nil,
        tMS: Int? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil
    ) -> Photo {
        return Photo(
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            hasFile: hasFile ?? self.hasFile,
            id: id ?? self.id,
            mime: mime ?? self.mime,
            ocrText: ocrText ?? self.ocrText,
            pageID: pageID ?? self.pageID,
            sessionID: sessionID ?? self.sessionID,
            sha256: sha256 ?? self.sha256,
            sizeBytes: sizeBytes ?? self.sizeBytes,
            tMS: tMS ?? self.tMS,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum PhotoMIME: String, Codable {
    case imageHeic = "image/heic"
    case imageJPEG = "image/jpeg"
}

/// Datei per PUT /photos/{photo_id}/file, Reihenfolge egal
// MARK: - PhotoAddData
struct PhotoAddData: Codable {
    let fileRef: PhotoFileRef
    let pageID: String?
    let photoID: String
    let sessionID: String
    let tMS: Int

    enum CodingKeys: String, CodingKey {
        case fileRef = "file_ref"
        case pageID = "page_id"
        case photoID = "photo_id"
        case sessionID = "session_id"
        case tMS = "t_ms"
    }
}

// MARK: PhotoAddData convenience initializers and mutators

extension PhotoAddData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PhotoAddData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        fileRef: PhotoFileRef? = nil,
        pageID: String?? = nil,
        photoID: String? = nil,
        sessionID: String? = nil,
        tMS: Int? = nil
    ) -> PhotoAddData {
        return PhotoAddData(
            fileRef: fileRef ?? self.fileRef,
            pageID: pageID ?? self.pageID,
            photoID: photoID ?? self.photoID,
            sessionID: sessionID ?? self.sessionID,
            tMS: tMS ?? self.tMS
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Datei eines Tafel-Fotos, hochgeladen per PUT /photos/{photo_id}/file
// MARK: - PhotoFileRef
struct PhotoFileRef: Codable {
    let mime: PhotoMIME
    let sha256: String
    let sizeBytes: Int

    enum CodingKeys: String, CodingKey {
        case mime = "mime"
        case sha256 = "sha256"
        case sizeBytes = "size_bytes"
    }
}

// MARK: PhotoFileRef convenience initializers and mutators

extension PhotoFileRef {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PhotoFileRef.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        mime: PhotoMIME? = nil,
        sha256: String? = nil,
        sizeBytes: Int? = nil
    ) -> PhotoFileRef {
        return PhotoFileRef(
            mime: mime ?? self.mime,
            sha256: sha256 ?? self.sha256,
            sizeBytes: sizeBytes ?? self.sizeBytes
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - PhotoAddOp
struct PhotoAddOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: PhotoAddData
    let kind: PhotoAddOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: PhotoAddOp convenience initializers and mutators

extension PhotoAddOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(PhotoAddOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: PhotoAddData? = nil,
        kind: PhotoAddOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> PhotoAddOp {
        return PhotoAddOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum PhotoAddOpKind: String, Codable {
    case photoAdd = "photo.add"
}

/// Eine Aufnahme = ein MediaRecorder-Strom. Nach einem Neuladen beginnt eine neue Aufnahme
/// derselben Session (F-SES-05).
// MARK: - Recording
struct Recording: Codable {
    /// Abgeleitet: empfangene Chunks
    let chunkCount: Int
    /// true: jeder Chunk ist eine eigenständige Datei (Recorder je Chunk neu gestartet). false:
    /// Chunks ergeben in seq-Reihenfolge einen Bytestrom. Ergänzung, offen bis Spike S4
    let chunksIndependent: Bool
    let codec: AudioCodec
    let completedAt: Date?
    let createdAt: Date
    let deletedAt: Date?
    /// Länge der Gesamtdatei, gesetzt von audio.finalize
    let durationMS: Int?
    let id: String
    /// Abgeleitet: höchste empfangene seq
    let lastSeq: Int?
    let mime: String
    let sessionID: String
    let startedMS: Int
    let state: RecordingState
    let updatedAt: Date
    let userID: String

    enum CodingKeys: String, CodingKey {
        case chunkCount = "chunk_count"
        case chunksIndependent = "chunks_independent"
        case codec = "codec"
        case completedAt = "completed_at"
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case durationMS = "duration_ms"
        case id = "id"
        case lastSeq = "last_seq"
        case mime = "mime"
        case sessionID = "session_id"
        case startedMS = "started_ms"
        case state = "state"
        case updatedAt = "updated_at"
        case userID = "user_id"
    }
}

// MARK: Recording convenience initializers and mutators

extension Recording {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Recording.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        chunkCount: Int? = nil,
        chunksIndependent: Bool? = nil,
        codec: AudioCodec? = nil,
        completedAt: Date?? = nil,
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        durationMS: Int?? = nil,
        id: String? = nil,
        lastSeq: Int?? = nil,
        mime: String? = nil,
        sessionID: String? = nil,
        startedMS: Int? = nil,
        state: RecordingState? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil
    ) -> Recording {
        return Recording(
            chunkCount: chunkCount ?? self.chunkCount,
            chunksIndependent: chunksIndependent ?? self.chunksIndependent,
            codec: codec ?? self.codec,
            completedAt: completedAt ?? self.completedAt,
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            durationMS: durationMS ?? self.durationMS,
            id: id ?? self.id,
            lastSeq: lastSeq ?? self.lastSeq,
            mime: mime ?? self.mime,
            sessionID: sessionID ?? self.sessionID,
            startedMS: startedMS ?? self.startedMS,
            state: state ?? self.state,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// POST /recordings/{id}/complete: der Client hat den letzten Chunk hochgeladen. Der Core
/// stellt audio.finalize ein.
// MARK: - RecordingComplete
struct RecordingComplete: Codable {
    /// Aufgenommene Länge laut Client
    let durationMS: Int
    let lastSeq: Int

    enum CodingKeys: String, CodingKey {
        case durationMS = "duration_ms"
        case lastSeq = "last_seq"
    }
}

// MARK: RecordingComplete convenience initializers and mutators

extension RecordingComplete {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(RecordingComplete.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        durationMS: Int? = nil,
        lastSeq: Int? = nil
    ) -> RecordingComplete {
        return RecordingComplete(
            durationMS: durationMS ?? self.durationMS,
            lastSeq: lastSeq ?? self.lastSeq
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// POST /sessions/{id}/recordings
// MARK: - RecordingCreate
struct RecordingCreate: Codable {
    let chunksIndependent: Bool?
    let codec: AudioCodec
    let id: String?
    let mime: String
    let startedMS: Int

    enum CodingKeys: String, CodingKey {
        case chunksIndependent = "chunks_independent"
        case codec = "codec"
        case id = "id"
        case mime = "mime"
        case startedMS = "started_ms"
    }
}

// MARK: RecordingCreate convenience initializers and mutators

extension RecordingCreate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(RecordingCreate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        chunksIndependent: Bool?? = nil,
        codec: AudioCodec? = nil,
        id: String?? = nil,
        mime: String? = nil,
        startedMS: Int? = nil
    ) -> RecordingCreate {
        return RecordingCreate(
            chunksIndependent: chunksIndependent ?? self.chunksIndependent,
            codec: codec ?? self.codec,
            id: id ?? self.id,
            mime: mime ?? self.mime,
            startedMS: startedMS ?? self.startedMS
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Nacharbeitung (F-NAC-05, Phase 2)
enum ReviewState: String, Codable {
    case erledigt = "erledigt"
    case inArbeit = "in_arbeit"
    case offen = "offen"
}

// MARK: - Semester
struct Semester: Codable {
    /// Archiviert = nur in der Navigation ausgeblendet, bleibt durchsuchbar und lernbar
    /// (F-ORG-01). Ergänzung zu 03 §3.
    let archivedAt: Date?
    let createdAt: Date
    let deletedAt: Date?
    let endsOn: String?
    let id: String
    /// Höchstens ein Semester ist aktuell
    let isCurrent: Bool
    let name: String
    let startsOn: String?
    let updatedAt: Date
    let userID: String

    enum CodingKeys: String, CodingKey {
        case archivedAt = "archived_at"
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case endsOn = "ends_on"
        case id = "id"
        case isCurrent = "is_current"
        case name = "name"
        case startsOn = "starts_on"
        case updatedAt = "updated_at"
        case userID = "user_id"
    }
}

// MARK: Semester convenience initializers and mutators

extension Semester {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Semester.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        archivedAt: Date?? = nil,
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        endsOn: String?? = nil,
        id: String? = nil,
        isCurrent: Bool? = nil,
        name: String? = nil,
        startsOn: String?? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil
    ) -> Semester {
        return Semester(
            archivedAt: archivedAt ?? self.archivedAt,
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            endsOn: endsOn ?? self.endsOn,
            id: id ?? self.id,
            isCurrent: isCurrent ?? self.isCurrent,
            name: name ?? self.name,
            startsOn: startsOn ?? self.startsOn,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// id ist optional und darf vom Client erzeugt werden (03 §1).
// MARK: - SemesterCreate
struct SemesterCreate: Codable {
    let endsOn: String?
    let id: String?
    let isCurrent: Bool?
    let name: String
    let startsOn: String?

    enum CodingKeys: String, CodingKey {
        case endsOn = "ends_on"
        case id = "id"
        case isCurrent = "is_current"
        case name = "name"
        case startsOn = "starts_on"
    }
}

// MARK: SemesterCreate convenience initializers and mutators

extension SemesterCreate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SemesterCreate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        endsOn: String?? = nil,
        id: String?? = nil,
        isCurrent: Bool?? = nil,
        name: String? = nil,
        startsOn: String?? = nil
    ) -> SemesterCreate {
        return SemesterCreate(
            endsOn: endsOn ?? self.endsOn,
            id: id ?? self.id,
            isCurrent: isCurrent ?? self.isCurrent,
            name: name ?? self.name,
            startsOn: startsOn ?? self.startsOn
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SemesterList
struct SemesterList: Codable {
    let items: [Semester]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case items = "items"
        case nextCursor = "next_cursor"
    }
}

// MARK: SemesterList convenience initializers and mutators

extension SemesterList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SemesterList.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        items: [Semester]? = nil,
        nextCursor: String?? = nil
    ) -> SemesterList {
        return SemesterList(
            items: items ?? self.items,
            nextCursor: nextCursor ?? self.nextCursor
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SemesterUpdate
struct SemesterUpdate: Codable {
    /// true = archivieren, false = wiederherstellen
    let archived: Bool?
    let endsOn: String?
    let isCurrent: Bool?
    let name: String?
    let startsOn: String?

    enum CodingKeys: String, CodingKey {
        case archived = "archived"
        case endsOn = "ends_on"
        case isCurrent = "is_current"
        case name = "name"
        case startsOn = "starts_on"
    }
}

// MARK: SemesterUpdate convenience initializers and mutators

extension SemesterUpdate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SemesterUpdate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        archived: Bool?? = nil,
        endsOn: String?? = nil,
        isCurrent: Bool?? = nil,
        name: String?? = nil,
        startsOn: String?? = nil
    ) -> SemesterUpdate {
        return SemesterUpdate(
            archived: archived ?? self.archived,
            endsOn: endsOn ?? self.endsOn,
            isCurrent: isCurrent ?? self.isCurrent,
            name: name ?? self.name,
            startsOn: startsOn ?? self.startsOn
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Durchführung eines Termins. planned_starts_at/planned_ends_at sind abgeleitet aus dem
/// Kalendertermin (null bei spontanen Sessions).
// MARK: - Session
struct Session: Codable {
    let autoStopExtendedUntil: Date?
    let calendarEventID: String?
    let createdAt: Date
    let deletedAt: Date?
    let endedAt: Date?
    let id: String
    let moduleID: String
    /// VL-Nummer im Modul (VL 7), Regeln in docs/VERTRAEGE.md
    let number: Int?
    let plannedEndsAt: Date?
    let plannedStartsAt: Date?
    let processing: [String: JobState]
    let reviewState: ReviewState
    let slideDeckID: String?
    /// Abweichende Startzeiten von Geräten (VERTRAEGE §9.3). Fehlt oder leer = keine Abweichung
    let startOffsets: [SessionStartOffset]?
    let startedAt: Date?
    let startedFrom: ClientDevice?
    let state: SessionState
    let stopReason: StopReason?
    let title: String?
    let updatedAt: Date
    let userID: String

    enum CodingKeys: String, CodingKey {
        case autoStopExtendedUntil = "auto_stop_extended_until"
        case calendarEventID = "calendar_event_id"
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case endedAt = "ended_at"
        case id = "id"
        case moduleID = "module_id"
        case number = "number"
        case plannedEndsAt = "planned_ends_at"
        case plannedStartsAt = "planned_starts_at"
        case processing = "processing"
        case reviewState = "review_state"
        case slideDeckID = "slide_deck_id"
        case startOffsets = "start_offsets"
        case startedAt = "started_at"
        case startedFrom = "started_from"
        case state = "state"
        case stopReason = "stop_reason"
        case title = "title"
        case updatedAt = "updated_at"
        case userID = "user_id"
    }
}

// MARK: Session convenience initializers and mutators

extension Session {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Session.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        autoStopExtendedUntil: Date?? = nil,
        calendarEventID: String?? = nil,
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        endedAt: Date?? = nil,
        id: String? = nil,
        moduleID: String? = nil,
        number: Int?? = nil,
        plannedEndsAt: Date?? = nil,
        plannedStartsAt: Date?? = nil,
        processing: [String: JobState]? = nil,
        reviewState: ReviewState? = nil,
        slideDeckID: String?? = nil,
        startOffsets: [SessionStartOffset]?? = nil,
        startedAt: Date?? = nil,
        startedFrom: ClientDevice?? = nil,
        state: SessionState? = nil,
        stopReason: StopReason?? = nil,
        title: String?? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil
    ) -> Session {
        return Session(
            autoStopExtendedUntil: autoStopExtendedUntil ?? self.autoStopExtendedUntil,
            calendarEventID: calendarEventID ?? self.calendarEventID,
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            endedAt: endedAt ?? self.endedAt,
            id: id ?? self.id,
            moduleID: moduleID ?? self.moduleID,
            number: number ?? self.number,
            plannedEndsAt: plannedEndsAt ?? self.plannedEndsAt,
            plannedStartsAt: plannedStartsAt ?? self.plannedStartsAt,
            processing: processing ?? self.processing,
            reviewState: reviewState ?? self.reviewState,
            slideDeckID: slideDeckID ?? self.slideDeckID,
            startOffsets: startOffsets ?? self.startOffsets,
            startedAt: startedAt ?? self.startedAt,
            startedFrom: startedFrom ?? self.startedFrom,
            state: state ?? self.state,
            stopReason: stopReason ?? self.stopReason,
            title: title ?? self.title,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Ein Gerät hat die Session offline mit eigenem started_at begonnen. offset_ms = started_at
/// des Geräts − started_at der Session (ms). Die t_ms der Operationen dieses Geräts bleiben
/// unverändert; Sitzungszeit nach Serveruhr = t_ms + offset_ms (für die Ausrichtung in Phase
/// 2).
// MARK: - SessionStartOffset
struct SessionStartOffset: Codable {
    let deviceID: String
    let offsetMS: Int

    enum CodingKeys: String, CodingKey {
        case deviceID = "device_id"
        case offsetMS = "offset_ms"
    }
}

// MARK: SessionStartOffset convenience initializers and mutators

extension SessionStartOffset {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionStartOffset.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        deviceID: String? = nil,
        offsetMS: Int? = nil
    ) -> SessionStartOffset {
        return SessionStartOffset(
            deviceID: deviceID ?? self.deviceID,
            offsetMS: offsetMS ?? self.offsetMS
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Zustandsautomat F-SES-01, Übergänge in docs/VERTRAEGE.md
enum SessionState: String, Codable {
    case beendet = "beendet"
    case bereit = "bereit"
    case geplant = "geplant"
    case laeuft = "laeuft"
    case pausiert = "pausiert"
    case verarbeitet = "verarbeitet"
    case verpasst = "verpasst"
}

enum StopReason: String, Codable {
    case absturzWiederhergestellt = "absturz_wiederhergestellt"
    case kalenderende = "kalenderende"
    case manuell = "manuell"
    case maximaldauer = "maximaldauer"
    case stille = "stille"
}

/// POST /sessions: spontane Session ohne Termin (F-SES-04). Ergebnis im Zustand bereit,
/// danach /start.
// MARK: - SessionCreate
struct SessionCreate: Codable {
    let id: String?
    let moduleID: String
    let slideDeckID: String?
    let title: String?

    enum CodingKeys: String, CodingKey {
        case id = "id"
        case moduleID = "module_id"
        case slideDeckID = "slide_deck_id"
        case title = "title"
    }
}

// MARK: SessionCreate convenience initializers and mutators

extension SessionCreate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionCreate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        id: String?? = nil,
        moduleID: String? = nil,
        slideDeckID: String?? = nil,
        title: String?? = nil
    ) -> SessionCreate {
        return SessionCreate(
            id: id ?? self.id,
            moduleID: moduleID ?? self.moduleID,
            slideDeckID: slideDeckID ?? self.slideDeckID,
            title: title ?? self.title
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// POST /sessions/{id}/extend: Auto-Stopp aufschieben (F-SES-03). minutes fehlt =
/// lecture.auto_stop_extend_min
// MARK: - SessionExtendRequest
struct SessionExtendRequest: Codable {
    let minutes: Int?

    enum CodingKeys: String, CodingKey {
        case minutes = "minutes"
    }
}

// MARK: SessionExtendRequest convenience initializers and mutators

extension SessionExtendRequest {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionExtendRequest.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        minutes: Int?? = nil
    ) -> SessionExtendRequest {
        return SessionExtendRequest(
            minutes: minutes ?? self.minutes
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SessionList
struct SessionList: Codable {
    let items: [Session]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case items = "items"
        case nextCursor = "next_cursor"
    }
}

// MARK: SessionList convenience initializers and mutators

extension SessionList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionList.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        items: [Session]? = nil,
        nextCursor: String?? = nil
    ) -> SessionList {
        return SessionList(
            items: items ?? self.items,
            nextCursor: nextCursor ?? self.nextCursor
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SessionPauseOp
struct SessionPauseOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: SessionRefData
    let kind: SessionPauseOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: SessionPauseOp convenience initializers and mutators

extension SessionPauseOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionPauseOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: SessionRefData? = nil,
        kind: SessionPauseOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> SessionPauseOp {
        return SessionPauseOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// session.pause / session.resume
// MARK: - SessionRefData
struct SessionRefData: Codable {
    let sessionID: String

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
    }
}

// MARK: SessionRefData convenience initializers and mutators

extension SessionRefData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionRefData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        sessionID: String? = nil
    ) -> SessionRefData {
        return SessionRefData(
            sessionID: sessionID ?? self.sessionID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SessionPauseOpKind: String, Codable {
    case sessionPause = "session.pause"
}

// MARK: - SessionResumeOp
struct SessionResumeOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: SessionRefData
    let kind: SessionResumeOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: SessionResumeOp convenience initializers and mutators

extension SessionResumeOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionResumeOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: SessionRefData? = nil,
        kind: SessionResumeOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> SessionResumeOp {
        return SessionResumeOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SessionResumeOpKind: String, Codable {
    case sessionResume = "session.resume"
}

/// GET /sessions/{id}/snapshot: Live-Stand für Dashboard und iPad (ohne gelöschte Objekte,
/// nach t_ms sortiert)
// MARK: - SessionSnapshot
struct SessionSnapshot: Codable {
    let markers: [Marker]
    let photos: [Photo]
    let recordings: [Recording]
    let session: Session
    let slideEvents: [SlideEvent]
    /// op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id
    /// senden
    let streamOpID: String?
    /// seq des Stroms session:<id>, zu der dieser Stand gehört. Danach per Sync ab stream_seq + 1
    let streamSeq: Int

    enum CodingKeys: String, CodingKey {
        case markers = "markers"
        case photos = "photos"
        case recordings = "recordings"
        case session = "session"
        case slideEvents = "slide_events"
        case streamOpID = "stream_op_id"
        case streamSeq = "stream_seq"
    }
}

// MARK: SessionSnapshot convenience initializers and mutators

extension SessionSnapshot {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionSnapshot.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        markers: [Marker]? = nil,
        photos: [Photo]? = nil,
        recordings: [Recording]? = nil,
        session: Session? = nil,
        slideEvents: [SlideEvent]? = nil,
        streamOpID: String?? = nil,
        streamSeq: Int? = nil
    ) -> SessionSnapshot {
        return SessionSnapshot(
            markers: markers ?? self.markers,
            photos: photos ?? self.photos,
            recordings: recordings ?? self.recordings,
            session: session ?? self.session,
            slideEvents: slideEvents ?? self.slideEvents,
            streamOpID: streamOpID ?? self.streamOpID,
            streamSeq: streamSeq ?? self.streamSeq
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SlideEvent
struct SlideEvent: Codable {
    let createdAt: Date
    let deletedAt: Date?
    let device: ClientDevice
    let id: String
    let sessionID: String
    let slideID: String?
    let slideIndex: Int
    let source: SlideEventSource
    let tMS: Int
    let updatedAt: Date
    let userID: String

    enum CodingKeys: String, CodingKey {
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case device = "device"
        case id = "id"
        case sessionID = "session_id"
        case slideID = "slide_id"
        case slideIndex = "slide_index"
        case source = "source"
        case tMS = "t_ms"
        case updatedAt = "updated_at"
        case userID = "user_id"
    }
}

// MARK: SlideEvent convenience initializers and mutators

extension SlideEvent {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SlideEvent.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        device: ClientDevice? = nil,
        id: String? = nil,
        sessionID: String? = nil,
        slideID: String?? = nil,
        slideIndex: Int? = nil,
        source: SlideEventSource? = nil,
        tMS: Int? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil
    ) -> SlideEvent {
        return SlideEvent(
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            device: device ?? self.device,
            id: id ?? self.id,
            sessionID: sessionID ?? self.sessionID,
            slideID: slideID ?? self.slideID,
            slideIndex: slideIndex ?? self.slideIndex,
            source: source ?? self.source,
            tMS: tMS ?? self.tMS,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SlideEventSource: String, Codable {
    case korrektur = "korrektur"
    case manuellIpad = "manuell_ipad"
    case manuellMAC = "manuell_mac"
}

/// Unbekannte session_id: der Core legt die Session an (Start offline auf dem iPad, F-SES-02
/// Schritt 3)
// MARK: - SessionStartData
struct SessionStartData: Codable {
    let calendarEventID: String?
    let moduleID: String
    let sessionID: String
    let slideDeckID: String?
    let startedAt: Int
    let startedFrom: ClientDevice

    enum CodingKeys: String, CodingKey {
        case calendarEventID = "calendar_event_id"
        case moduleID = "module_id"
        case sessionID = "session_id"
        case slideDeckID = "slide_deck_id"
        case startedAt = "started_at"
        case startedFrom = "started_from"
    }
}

// MARK: SessionStartData convenience initializers and mutators

extension SessionStartData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionStartData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        calendarEventID: String?? = nil,
        moduleID: String? = nil,
        sessionID: String? = nil,
        slideDeckID: String?? = nil,
        startedAt: Int? = nil,
        startedFrom: ClientDevice? = nil
    ) -> SessionStartData {
        return SessionStartData(
            calendarEventID: calendarEventID ?? self.calendarEventID,
            moduleID: moduleID ?? self.moduleID,
            sessionID: sessionID ?? self.sessionID,
            slideDeckID: slideDeckID ?? self.slideDeckID,
            startedAt: startedAt ?? self.startedAt,
            startedFrom: startedFrom ?? self.startedFrom
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SessionStartOp
struct SessionStartOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: SessionStartData
    let kind: SessionStartOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: SessionStartOp convenience initializers and mutators

extension SessionStartOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionStartOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: SessionStartData? = nil,
        kind: SessionStartOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> SessionStartOp {
        return SessionStartOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SessionStartOpKind: String, Codable {
    case sessionStart = "session.start"
}

/// POST /sessions/{id}/start. started_at setzt der Core (Serverzeit).
// MARK: - SessionStartRequest
struct SessionStartRequest: Codable {
    let slideDeckID: String?
    let startedFrom: ClientDevice

    enum CodingKeys: String, CodingKey {
        case slideDeckID = "slide_deck_id"
        case startedFrom = "started_from"
    }
}

// MARK: SessionStartRequest convenience initializers and mutators

extension SessionStartRequest {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionStartRequest.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        slideDeckID: String?? = nil,
        startedFrom: ClientDevice? = nil
    ) -> SessionStartRequest {
        return SessionStartRequest(
            slideDeckID: slideDeckID ?? self.slideDeckID,
            startedFrom: startedFrom ?? self.startedFrom
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// ended_session: eine andere Session, die wegen des Starts automatisch beendet wurde
/// (F-SES-02)
// MARK: - SessionStartResult
struct SessionStartResult: Codable {
    let endedSession: Session?
    let session: Session

    enum CodingKeys: String, CodingKey {
        case endedSession = "ended_session"
        case session = "session"
    }
}

// MARK: SessionStartResult convenience initializers and mutators

extension SessionStartResult {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionStartResult.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        endedSession: Session?? = nil,
        session: Session? = nil
    ) -> SessionStartResult {
        return SessionStartResult(
            endedSession: endedSession ?? self.endedSession,
            session: session ?? self.session
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SessionStopData
struct SessionStopData: Codable {
    let reason: StopReason?
    let sessionID: String

    enum CodingKeys: String, CodingKey {
        case reason = "reason"
        case sessionID = "session_id"
    }
}

// MARK: SessionStopData convenience initializers and mutators

extension SessionStopData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionStopData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        reason: StopReason?? = nil,
        sessionID: String? = nil
    ) -> SessionStopData {
        return SessionStopData(
            reason: reason ?? self.reason,
            sessionID: sessionID ?? self.sessionID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SessionStopOp
struct SessionStopOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: SessionStopData
    let kind: SessionStopOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: SessionStopOp convenience initializers and mutators

extension SessionStopOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionStopOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: SessionStopData? = nil,
        kind: SessionStopOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> SessionStopOp {
        return SessionStopOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SessionStopOpKind: String, Codable {
    case sessionStop = "session.stop"
}

/// POST /sessions/{id}/stop. reason fehlt = manuell. absturz_wiederhergestellt setzt nur der
/// Core.
// MARK: - SessionStopRequest
struct SessionStopRequest: Codable {
    let reason: StopReason?

    enum CodingKeys: String, CodingKey {
        case reason = "reason"
    }
}

// MARK: SessionStopRequest convenience initializers and mutators

extension SessionStopRequest {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionStopRequest.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        reason: StopReason?? = nil
    ) -> SessionStopRequest {
        return SessionStopRequest(
            reason: reason ?? self.reason
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// PATCH /sessions/{id}
// MARK: - SessionUpdate
struct SessionUpdate: Codable {
    let slideDeckID: String?
    let title: String?

    enum CodingKeys: String, CodingKey {
        case slideDeckID = "slide_deck_id"
        case title = "title"
    }
}

// MARK: SessionUpdate convenience initializers and mutators

extension SessionUpdate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SessionUpdate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        slideDeckID: String?? = nil,
        title: String?? = nil
    ) -> SessionUpdate {
        return SessionUpdate(
            slideDeckID: slideDeckID ?? self.slideDeckID,
            title: title ?? self.title
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// GET /settings: alle Phase-1-Bereiche, fehlende Werte mit Standard aufgefüllt. Geräte
/// stehen unter /devices.
// MARK: - Settings
struct Settings: Codable {
    let data: DataSettings
    let general: GeneralSettings
    let lecture: LectureSettings
    let pen: PenSettings

    enum CodingKeys: String, CodingKey {
        case data = "data"
        case general = "general"
        case lecture = "lecture"
        case pen = "pen"
    }
}

// MARK: Settings convenience initializers and mutators

extension Settings {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Settings.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        data: DataSettings? = nil,
        general: GeneralSettings? = nil,
        lecture: LectureSettings? = nil,
        pen: PenSettings? = nil
    ) -> Settings {
        return Settings(
            data: data ?? self.data,
            general: general ?? self.general,
            lecture: lecture ?? self.lecture,
            pen: pen ?? self.pen
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// PATCH /settings: nur die angegebenen Felder ändern sich. Antwort: Settings
// MARK: - SettingsUpdate
struct SettingsUpdate: Codable {
    let data: DataSettingsUpdate?
    let general: GeneralSettingsUpdate?
    let lecture: LectureSettingsUpdate?
    let pen: PenSettingsUpdate?

    enum CodingKeys: String, CodingKey {
        case data = "data"
        case general = "general"
        case lecture = "lecture"
        case pen = "pen"
    }
}

// MARK: SettingsUpdate convenience initializers and mutators

extension SettingsUpdate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SettingsUpdate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        data: DataSettingsUpdate?? = nil,
        general: GeneralSettingsUpdate?? = nil,
        lecture: LectureSettingsUpdate?? = nil,
        pen: PenSettingsUpdate?? = nil
    ) -> SettingsUpdate {
        return SettingsUpdate(
            data: data ?? self.data,
            general: general ?? self.general,
            lecture: lecture ?? self.lecture,
            pen: pen ?? self.pen
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - ShapeElement
struct ShapeElement: Codable {
    let elementID: String
    let frame: [Double]
    let kind: ShapeElementKind
    let payload: ShapeElementPayload
    let tMS: Int?
    let z: Int

    enum CodingKeys: String, CodingKey {
        case elementID = "element_id"
        case frame = "frame"
        case kind = "kind"
        case payload = "payload"
        case tMS = "t_ms"
        case z = "z"
    }
}

// MARK: ShapeElement convenience initializers and mutators

extension ShapeElement {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ShapeElement.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        elementID: String? = nil,
        frame: [Double]? = nil,
        kind: ShapeElementKind? = nil,
        payload: ShapeElementPayload? = nil,
        tMS: Int?? = nil,
        z: Int? = nil
    ) -> ShapeElement {
        return ShapeElement(
            elementID: elementID ?? self.elementID,
            frame: frame ?? self.frame,
            kind: kind ?? self.kind,
            payload: payload ?? self.payload,
            tMS: tMS ?? self.tMS,
            z: z ?? self.z
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum ShapeElementKind: String, Codable {
    case shape = "shape"
}

// MARK: - ShapeElementPayload
struct ShapeElementPayload: Codable {
    let color: String
    let points: [[Double]]
    let shape: ShapeKind
    let width: Double

    enum CodingKeys: String, CodingKey {
        case color = "color"
        case points = "points"
        case shape = "shape"
        case width = "width"
    }
}

// MARK: ShapeElementPayload convenience initializers and mutators

extension ShapeElementPayload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ShapeElementPayload.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        color: String? = nil,
        points: [[Double]]? = nil,
        shape: ShapeKind? = nil,
        width: Double? = nil
    ) -> ShapeElementPayload {
        return ShapeElementPayload(
            color: color ?? self.color,
            points: points ?? self.points,
            shape: shape ?? self.shape,
            width: width ?? self.width
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Eine Seite eines Foliensatzes. Bilder über GET /slides/{id}/image bzw. /thumb.
// MARK: - Slide
struct Slide: Codable {
    let chapter: String?
    let createdAt: Date
    let deckID: String
    let deletedAt: Date?
    let heightPt: Double
    let id: String
    /// 1-basiert
    let index: Int
    /// Textlayer, leer wenn keiner vorhanden
    let text: String
    let textBlocks: [TextBlock]
    let title: String?
    let updatedAt: Date
    let userID: String
    let visionSummary: String?
    let widthPt: Double

    enum CodingKeys: String, CodingKey {
        case chapter = "chapter"
        case createdAt = "created_at"
        case deckID = "deck_id"
        case deletedAt = "deleted_at"
        case heightPt = "height_pt"
        case id = "id"
        case index = "index"
        case text = "text"
        case textBlocks = "text_blocks"
        case title = "title"
        case updatedAt = "updated_at"
        case userID = "user_id"
        case visionSummary = "vision_summary"
        case widthPt = "width_pt"
    }
}

// MARK: Slide convenience initializers and mutators

extension Slide {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Slide.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        chapter: String?? = nil,
        createdAt: Date? = nil,
        deckID: String? = nil,
        deletedAt: Date?? = nil,
        heightPt: Double? = nil,
        id: String? = nil,
        index: Int? = nil,
        text: String? = nil,
        textBlocks: [TextBlock]? = nil,
        title: String?? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil,
        visionSummary: String?? = nil,
        widthPt: Double? = nil
    ) -> Slide {
        return Slide(
            chapter: chapter ?? self.chapter,
            createdAt: createdAt ?? self.createdAt,
            deckID: deckID ?? self.deckID,
            deletedAt: deletedAt ?? self.deletedAt,
            heightPt: heightPt ?? self.heightPt,
            id: id ?? self.id,
            index: index ?? self.index,
            text: text ?? self.text,
            textBlocks: textBlocks ?? self.textBlocks,
            title: title ?? self.title,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID,
            visionSummary: visionSummary ?? self.visionSummary,
            widthPt: widthPt ?? self.widthPt
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - TextBlock
struct TextBlock: Codable {
    let bbox: [Double]
    let text: String

    enum CodingKeys: String, CodingKey {
        case bbox = "bbox"
        case text = "text"
    }
}

// MARK: TextBlock convenience initializers and mutators

extension TextBlock {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(TextBlock.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        bbox: [Double]? = nil,
        text: String? = nil
    ) -> TextBlock {
        return TextBlock(
            bbox: bbox ?? self.bbox,
            text: text ?? self.text
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SlideChangeData
struct SlideChangeData: Codable {
    let device: ClientDevice
    let eventID: String
    let sessionID: String
    let slideID: String?
    let slideIndex: Int
    let tMS: Int

    enum CodingKeys: String, CodingKey {
        case device = "device"
        case eventID = "event_id"
        case sessionID = "session_id"
        case slideID = "slide_id"
        case slideIndex = "slide_index"
        case tMS = "t_ms"
    }
}

// MARK: SlideChangeData convenience initializers and mutators

extension SlideChangeData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SlideChangeData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        device: ClientDevice? = nil,
        eventID: String? = nil,
        sessionID: String? = nil,
        slideID: String?? = nil,
        slideIndex: Int? = nil,
        tMS: Int? = nil
    ) -> SlideChangeData {
        return SlideChangeData(
            device: device ?? self.device,
            eventID: eventID ?? self.eventID,
            sessionID: sessionID ?? self.sessionID,
            slideID: slideID ?? self.slideID,
            slideIndex: slideIndex ?? self.slideIndex,
            tMS: tMS ?? self.tMS
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SlideChangeOp
struct SlideChangeOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: SlideChangeData
    let kind: SlideChangeOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: SlideChangeOp convenience initializers and mutators

extension SlideChangeOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SlideChangeOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: SlideChangeData? = nil,
        kind: SlideChangeOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> SlideChangeOp {
        return SlideChangeOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SlideChangeOpKind: String, Codable {
    case slideChange = "slide.change"
}

// MARK: - SlideDeck
struct SlideDeck: Codable {
    let createdAt: Date
    let deletedAt: Date?
    let id: String
    let ingestState: IngestState
    let moduleID: String
    /// null bis pdf.ingest gelaufen ist
    let pageCount: Int?
    let sessionID: String?
    let sha256: String
    let title: String
    let updatedAt: Date
    let uploadedAt: Date
    let userID: String

    enum CodingKeys: String, CodingKey {
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case id = "id"
        case ingestState = "ingest_state"
        case moduleID = "module_id"
        case pageCount = "page_count"
        case sessionID = "session_id"
        case sha256 = "sha256"
        case title = "title"
        case updatedAt = "updated_at"
        case uploadedAt = "uploaded_at"
        case userID = "user_id"
    }
}

// MARK: SlideDeck convenience initializers and mutators

extension SlideDeck {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SlideDeck.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        id: String? = nil,
        ingestState: IngestState? = nil,
        moduleID: String? = nil,
        pageCount: Int?? = nil,
        sessionID: String?? = nil,
        sha256: String? = nil,
        title: String? = nil,
        updatedAt: Date? = nil,
        uploadedAt: Date? = nil,
        userID: String? = nil
    ) -> SlideDeck {
        return SlideDeck(
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            id: id ?? self.id,
            ingestState: ingestState ?? self.ingestState,
            moduleID: moduleID ?? self.moduleID,
            pageCount: pageCount ?? self.pageCount,
            sessionID: sessionID ?? self.sessionID,
            sha256: sha256 ?? self.sha256,
            title: title ?? self.title,
            updatedAt: updatedAt ?? self.updatedAt,
            uploadedAt: uploadedAt ?? self.uploadedAt,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SlideDeckDetail
struct SlideDeckDetail: Codable {
    let deck: SlideDeck
    let slides: [Slide]

    enum CodingKeys: String, CodingKey {
        case deck = "deck"
        case slides = "slides"
    }
}

// MARK: SlideDeckDetail convenience initializers and mutators

extension SlideDeckDetail {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SlideDeckDetail.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        deck: SlideDeck? = nil,
        slides: [Slide]? = nil
    ) -> SlideDeckDetail {
        return SlideDeckDetail(
            deck: deck ?? self.deck,
            slides: slides ?? self.slides
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SlideDeckList
struct SlideDeckList: Codable {
    let items: [SlideDeck]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case items = "items"
        case nextCursor = "next_cursor"
    }
}

// MARK: SlideDeckList convenience initializers and mutators

extension SlideDeckList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SlideDeckList.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        items: [SlideDeck]? = nil,
        nextCursor: String?? = nil
    ) -> SlideDeckList {
        return SlideDeckList(
            items: items ?? self.items,
            nextCursor: nextCursor ?? self.nextCursor
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// PATCH /slide-decks/{id}
// MARK: - SlideDeckUpdate
struct SlideDeckUpdate: Codable {
    let title: String?

    enum CodingKeys: String, CodingKey {
        case title = "title"
    }
}

// MARK: SlideDeckUpdate convenience initializers and mutators

extension SlideDeckUpdate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SlideDeckUpdate.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        title: String?? = nil
    ) -> SlideDeckUpdate {
        return SlideDeckUpdate(
            title: title ?? self.title
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - StampElement
struct StampElement: Codable {
    let elementID: String
    let frame: [Double]
    let kind: StampElementKind
    let payload: StampElementPayload
    let tMS: Int?
    let z: Int

    enum CodingKeys: String, CodingKey {
        case elementID = "element_id"
        case frame = "frame"
        case kind = "kind"
        case payload = "payload"
        case tMS = "t_ms"
        case z = "z"
    }
}

// MARK: StampElement convenience initializers and mutators

extension StampElement {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(StampElement.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        elementID: String? = nil,
        frame: [Double]? = nil,
        kind: StampElementKind? = nil,
        payload: StampElementPayload? = nil,
        tMS: Int?? = nil,
        z: Int? = nil
    ) -> StampElement {
        return StampElement(
            elementID: elementID ?? self.elementID,
            frame: frame ?? self.frame,
            kind: kind ?? self.kind,
            payload: payload ?? self.payload,
            tMS: tMS ?? self.tMS,
            z: z ?? self.z
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum StampElementKind: String, Codable {
    case stamp = "stamp"
}

// MARK: - StampElementPayload
struct StampElementPayload: Codable {
    let markerID: String
    let markerKind: MarkerKindEnum

    enum CodingKeys: String, CodingKey {
        case markerID = "marker_id"
        case markerKind = "marker_kind"
    }
}

// MARK: StampElementPayload convenience initializers and mutators

extension StampElementPayload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(StampElementPayload.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        markerID: String? = nil,
        markerKind: MarkerKindEnum? = nil
    ) -> StampElementPayload {
        return StampElementPayload(
            markerID: markerID ?? self.markerID,
            markerKind: markerKind ?? self.markerKind
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - StrokeAddData
struct StrokeAddData: Codable {
    let pageID: String
    let stroke: Stroke

    enum CodingKeys: String, CodingKey {
        case pageID = "page_id"
        case stroke = "stroke"
    }
}

// MARK: StrokeAddData convenience initializers and mutators

extension StrokeAddData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(StrokeAddData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        pageID: String? = nil,
        stroke: Stroke? = nil
    ) -> StrokeAddData {
        return StrokeAddData(
            pageID: pageID ?? self.pageID,
            stroke: stroke ?? self.stroke
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - StrokeAddOp
struct StrokeAddOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: StrokeAddData
    let kind: StrokeAddOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: StrokeAddOp convenience initializers and mutators

extension StrokeAddOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(StrokeAddOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: StrokeAddData? = nil,
        kind: StrokeAddOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> StrokeAddOp {
        return StrokeAddOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum StrokeAddOpKind: String, Codable {
    case strokeAdd = "stroke.add"
}

// MARK: - StrokeRemoveData
struct StrokeRemoveData: Codable {
    let clientIDS: [String]
    let pageID: String

    enum CodingKeys: String, CodingKey {
        case clientIDS = "client_ids"
        case pageID = "page_id"
    }
}

// MARK: StrokeRemoveData convenience initializers and mutators

extension StrokeRemoveData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(StrokeRemoveData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        clientIDS: [String]? = nil,
        pageID: String? = nil
    ) -> StrokeRemoveData {
        return StrokeRemoveData(
            clientIDS: clientIDS ?? self.clientIDS,
            pageID: pageID ?? self.pageID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - StrokeRemoveOp
struct StrokeRemoveOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: StrokeRemoveData
    let kind: StrokeRemoveOpKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: StrokeRemoveOp convenience initializers and mutators

extension StrokeRemoveOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(StrokeRemoveOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: StrokeRemoveData? = nil,
        kind: StrokeRemoveOpKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> StrokeRemoveOp {
        return StrokeRemoveOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum StrokeRemoveOpKind: String, Codable {
    case strokeRemove = "stroke.remove"
}

// MARK: - SyncACK
struct SyncACK: Codable {
    let opID: String
    let seq: Int
    let stream: String
    let type: SyncACKType

    enum CodingKeys: String, CodingKey {
        case opID = "op_id"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: SyncACK convenience initializers and mutators

extension SyncACK {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncACK.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        opID: String? = nil,
        seq: Int? = nil,
        stream: String? = nil,
        type: SyncACKType? = nil
    ) -> SyncACK {
        return SyncACK(
            opID: opID ?? self.opID,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncACKType: String, Codable {
    case ack = "ack"
}

enum SyncClientKind: String, Codable {
    case ipad = "ipad"
    case web = "web"
}

/// Alle Nachrichten Client → Server
///
/// Erste Nachricht des Clients (08 §2.1). Das Gerätetoken steht nicht hier, sondern beim
/// Upgrade im Header Authorization: Bearer (VERTRAEGE §11.1). device_id nur zur Gegenprobe.
///
/// Weitere Ströme abonnieren, ohne neu zu verbinden. Antwort: subscribed. Ergänzung zu 08
/// §2
///
/// t0 = lokale Uhr des Clients beim Senden (F-SYN-02)
///
/// Ergebnis des Uhrabgleichs an den Server (device.clock_offset_ms). Ergänzung zu 08 §2.1
///
/// Keepalive des Clients alle 15 s
///
/// Was der Client gerade zeigt (ersetzt den vorigen Stand). Das iPad sendet sie bei jedem
/// Seitenwechsel, die Notizen-Spalte folgt ihr (F-DSH-04). Ergänzung zu 08 §2
///
/// Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem
/// Papierkorb
// MARK: - SyncClientMessage
struct SyncClientMessage: Codable {
    let appVersion: String?
    let client: SyncClientKind?
    let deviceID: String?
    let syncClientMessageProtocol: Double?
    let streams: [Stream]?
    let type: SyncClientMessageType
    let t0: Int?
    /// Gemessener Versatz Server − Client
    let offsetMS: Int?
    /// Median der Umlaufzeit
    let rttMS: Int?
    let notebookID: String?
    let pageID: String?
    let sessionID: String?
    let at: Int?
    let clockUncertain: Bool?
    let data: DataClass?
    let kind: SyncClientMessageKind?
    let opID: String?
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String?

    enum CodingKeys: String, CodingKey {
        case appVersion = "app_version"
        case client = "client"
        case deviceID = "device_id"
        case syncClientMessageProtocol = "protocol"
        case streams = "streams"
        case type = "type"
        case t0 = "t0"
        case offsetMS = "offset_ms"
        case rttMS = "rtt_ms"
        case notebookID = "notebook_id"
        case pageID = "page_id"
        case sessionID = "session_id"
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
    }
}

// MARK: SyncClientMessage convenience initializers and mutators

extension SyncClientMessage {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncClientMessage.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        appVersion: String?? = nil,
        client: SyncClientKind?? = nil,
        deviceID: String?? = nil,
        syncClientMessageProtocol: Double?? = nil,
        streams: [Stream]?? = nil,
        type: SyncClientMessageType? = nil,
        t0: Int?? = nil,
        offsetMS: Int?? = nil,
        rttMS: Int?? = nil,
        notebookID: String?? = nil,
        pageID: String?? = nil,
        sessionID: String?? = nil,
        at: Int?? = nil,
        clockUncertain: Bool?? = nil,
        data: DataClass?? = nil,
        kind: SyncClientMessageKind?? = nil,
        opID: String?? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String?? = nil
    ) -> SyncClientMessage {
        return SyncClientMessage(
            appVersion: appVersion ?? self.appVersion,
            client: client ?? self.client,
            deviceID: deviceID ?? self.deviceID,
            syncClientMessageProtocol: syncClientMessageProtocol ?? self.syncClientMessageProtocol,
            streams: streams ?? self.streams,
            type: type ?? self.type,
            t0: t0 ?? self.t0,
            offsetMS: offsetMS ?? self.offsetMS,
            rttMS: rttMS ?? self.rttMS,
            notebookID: notebookID ?? self.notebookID,
            pageID: pageID ?? self.pageID,
            sessionID: sessionID ?? self.sessionID,
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Freies Notizbuch offline anlegen (F-INK-02, F-INK-14). Strom notebook:<notebook_id>,
/// idempotent über notebook_id.
///
/// Datei vorher per PUT /pages/{id}/pkdrawing hochgeladen, nur fürs iPad
///
/// Unbekannte session_id: der Core legt die Session an (Start offline auf dem iPad, F-SES-02
/// Schritt 3)
///
/// session.pause / session.resume
///
/// Marker vom iPad (F-INK-05) und vom Mac (F-DSH-05, source=mac)
///
/// Rückgängig (⌘Z, F-DSH-05) bzw. Löschen
///
/// Datei per PUT /photos/{photo_id}/file, Reihenfolge egal
// MARK: - DataClass
struct DataClass: Codable {
    let createdAt: Int?
    /// Nur frei. Die Notizbücher vorlesung/uebung legt der Core an
    let kind: PurpleMarkerKind?
    let moduleID: String?
    let notebookID: String?
    let title: String?
    let attachedSlideID: String?
    let backgroundSlideID: String?
    let heightPt: Double?
    let index: Int?
    let pageID: String?
    let sessionID: String?
    let template: PageTemplate?
    let widthPt: Double?
    let fields: UpdateFields?
    /// Version, auf der die Änderung beruht. Der Core setzt danach version + 1
    let version: Int?
    let stroke: Stroke?
    let clientIDS: [String]?
    let element: PageElement?
    let elementID: String?
    let pkdrawingRef: FileRef?
    let calendarEventID: String?
    let slideDeckID: String?
    let startedAt: Int?
    let startedFrom: ClientDevice?
    let reason: StopReason?
    let device: ClientDevice?
    let eventID: String?
    let slideID: String?
    let slideIndex: Int?
    let tMS: Int?
    let markerID: String?
    let note: String?
    let position: MarkerPosition?
    let source: ClientDevice?
    let fileRef: PhotoFileRef?
    let photoID: String?

    enum CodingKeys: String, CodingKey {
        case createdAt = "created_at"
        case kind = "kind"
        case moduleID = "module_id"
        case notebookID = "notebook_id"
        case title = "title"
        case attachedSlideID = "attached_slide_id"
        case backgroundSlideID = "background_slide_id"
        case heightPt = "height_pt"
        case index = "index"
        case pageID = "page_id"
        case sessionID = "session_id"
        case template = "template"
        case widthPt = "width_pt"
        case fields = "fields"
        case version = "version"
        case stroke = "stroke"
        case clientIDS = "client_ids"
        case element = "element"
        case elementID = "element_id"
        case pkdrawingRef = "pkdrawing_ref"
        case calendarEventID = "calendar_event_id"
        case slideDeckID = "slide_deck_id"
        case startedAt = "started_at"
        case startedFrom = "started_from"
        case reason = "reason"
        case device = "device"
        case eventID = "event_id"
        case slideID = "slide_id"
        case slideIndex = "slide_index"
        case tMS = "t_ms"
        case markerID = "marker_id"
        case note = "note"
        case position = "position"
        case source = "source"
        case fileRef = "file_ref"
        case photoID = "photo_id"
    }
}

// MARK: DataClass convenience initializers and mutators

extension DataClass {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(DataClass.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        createdAt: Int?? = nil,
        kind: PurpleMarkerKind?? = nil,
        moduleID: String?? = nil,
        notebookID: String?? = nil,
        title: String?? = nil,
        attachedSlideID: String?? = nil,
        backgroundSlideID: String?? = nil,
        heightPt: Double?? = nil,
        index: Int?? = nil,
        pageID: String?? = nil,
        sessionID: String?? = nil,
        template: PageTemplate?? = nil,
        widthPt: Double?? = nil,
        fields: UpdateFields?? = nil,
        version: Int?? = nil,
        stroke: Stroke?? = nil,
        clientIDS: [String]?? = nil,
        element: PageElement?? = nil,
        elementID: String?? = nil,
        pkdrawingRef: FileRef?? = nil,
        calendarEventID: String?? = nil,
        slideDeckID: String?? = nil,
        startedAt: Int?? = nil,
        startedFrom: ClientDevice?? = nil,
        reason: StopReason?? = nil,
        device: ClientDevice?? = nil,
        eventID: String?? = nil,
        slideID: String?? = nil,
        slideIndex: Int?? = nil,
        tMS: Int?? = nil,
        markerID: String?? = nil,
        note: String?? = nil,
        position: MarkerPosition?? = nil,
        source: ClientDevice?? = nil,
        fileRef: PhotoFileRef?? = nil,
        photoID: String?? = nil
    ) -> DataClass {
        return DataClass(
            createdAt: createdAt ?? self.createdAt,
            kind: kind ?? self.kind,
            moduleID: moduleID ?? self.moduleID,
            notebookID: notebookID ?? self.notebookID,
            title: title ?? self.title,
            attachedSlideID: attachedSlideID ?? self.attachedSlideID,
            backgroundSlideID: backgroundSlideID ?? self.backgroundSlideID,
            heightPt: heightPt ?? self.heightPt,
            index: index ?? self.index,
            pageID: pageID ?? self.pageID,
            sessionID: sessionID ?? self.sessionID,
            template: template ?? self.template,
            widthPt: widthPt ?? self.widthPt,
            fields: fields ?? self.fields,
            version: version ?? self.version,
            stroke: stroke ?? self.stroke,
            clientIDS: clientIDS ?? self.clientIDS,
            element: element ?? self.element,
            elementID: elementID ?? self.elementID,
            pkdrawingRef: pkdrawingRef ?? self.pkdrawingRef,
            calendarEventID: calendarEventID ?? self.calendarEventID,
            slideDeckID: slideDeckID ?? self.slideDeckID,
            startedAt: startedAt ?? self.startedAt,
            startedFrom: startedFrom ?? self.startedFrom,
            reason: reason ?? self.reason,
            device: device ?? self.device,
            eventID: eventID ?? self.eventID,
            slideID: slideID ?? self.slideID,
            slideIndex: slideIndex ?? self.slideIndex,
            tMS: tMS ?? self.tMS,
            markerID: markerID ?? self.markerID,
            note: note ?? self.note,
            position: position ?? self.position,
            source: source ?? self.source,
            fileRef: fileRef ?? self.fileRef,
            photoID: photoID ?? self.photoID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Alle änderbaren Felder der Seite mit ihrem neuen Stand. Kein Teil-Update: im Sync gibt es
/// keine optionalen nullbaren Felder (VERTRAEGE §11.7)
///
/// Aktueller Stand der per REST änderbaren Felder
// MARK: - UpdateFields
struct UpdateFields: Codable {
    let attachedSlideID: String?
    let backgroundSlideID: String?
    let index: Int?
    let sessionID: String?
    let template: PageTemplate?
    let moduleID: String?
    let title: String?

    enum CodingKeys: String, CodingKey {
        case attachedSlideID = "attached_slide_id"
        case backgroundSlideID = "background_slide_id"
        case index = "index"
        case sessionID = "session_id"
        case template = "template"
        case moduleID = "module_id"
        case title = "title"
    }
}

// MARK: UpdateFields convenience initializers and mutators

extension UpdateFields {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(UpdateFields.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        attachedSlideID: String?? = nil,
        backgroundSlideID: String?? = nil,
        index: Int?? = nil,
        sessionID: String?? = nil,
        template: PageTemplate?? = nil,
        moduleID: String?? = nil,
        title: String?? = nil
    ) -> UpdateFields {
        return UpdateFields(
            attachedSlideID: attachedSlideID ?? self.attachedSlideID,
            backgroundSlideID: backgroundSlideID ?? self.backgroundSlideID,
            index: index ?? self.index,
            sessionID: sessionID ?? self.sessionID,
            template: template ?? self.template,
            moduleID: moduleID ?? self.moduleID,
            title: title ?? self.title
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum PurpleMarkerKind: String, Codable {
    case frage = "frage"
    case frei = "frei"
    case klausur = "klausur"
    case verknuepfung = "verknuepfung"
}

enum SyncClientMessageKind: String, Codable {
    case drawingSnapshot = "drawing.snapshot"
    case elementRemove = "element.remove"
    case elementUpsert = "element.upsert"
    case markerAdd = "marker.add"
    case markerRemove = "marker.remove"
    case notebookCreate = "notebook.create"
    case notebookDelete = "notebook.delete"
    case notebookRestore = "notebook.restore"
    case notebookUpdate = "notebook.update"
    case pageCreate = "page.create"
    case pageDelete = "page.delete"
    case pageRestore = "page.restore"
    case pageUpdate = "page.update"
    case photoAdd = "photo.add"
    case sessionPause = "session.pause"
    case sessionResume = "session.resume"
    case sessionStart = "session.start"
    case sessionStop = "session.stop"
    case slideChange = "slide.change"
    case strokeAdd = "stroke.add"
    case strokeRemove = "stroke.remove"
}

enum Stream: Codable {
    case string(String)
    case syncStreamPosition(SyncStreamPosition)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let x = try? container.decode(String.self) {
            self = .string(x)
            return
        }
        if let x = try? container.decode(SyncStreamPosition.self) {
            self = .syncStreamPosition(x)
            return
        }
        throw DecodingError.typeMismatch(Stream.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Wrong type for Stream"))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let x):
            try container.encode(x)
        case .syncStreamPosition(let x):
            try container.encode(x)
        }
    }
}

// MARK: - SyncStreamPosition
struct SyncStreamPosition: Codable {
    /// op_id der Operation mit last_seq, null bei last_seq = 0. Der Server prüft das Paar, sonst
    /// reset
    let lastOpID: String?
    /// Höchste lückenlos empfangene und angewandte seq, 0 = nichts
    let lastSeq: Int
    let stream: String

    enum CodingKeys: String, CodingKey {
        case lastOpID = "last_op_id"
        case lastSeq = "last_seq"
        case stream = "stream"
    }
}

// MARK: SyncStreamPosition convenience initializers and mutators

extension SyncStreamPosition {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncStreamPosition.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        lastOpID: String?? = nil,
        lastSeq: Int? = nil,
        stream: String? = nil
    ) -> SyncStreamPosition {
        return SyncStreamPosition(
            lastOpID: lastOpID ?? self.lastOpID,
            lastSeq: lastSeq ?? self.lastSeq,
            stream: stream ?? self.stream
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncClientMessageType: String, Codable {
    case hello = "hello"
    case op = "op"
    case ping = "ping"
    case presence = "presence"
    case subscribe = "subscribe"
    case timeOffset = "time.offset"
    case timePing = "time.ping"
    case unsubscribe = "unsubscribe"
}

/// Ein Client hat sich verbunden oder getrennt (iPad-Status, F-DSH-06)
// MARK: - SyncConnectionEvent
struct SyncConnectionEvent: Codable {
    let data: SyncConnectionInfo
    let name: SyncConnectionEventName
    let type: SyncConnectionEventType

    enum CodingKeys: String, CodingKey {
        case data = "data"
        case name = "name"
        case type = "type"
    }
}

// MARK: SyncConnectionEvent convenience initializers and mutators

extension SyncConnectionEvent {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncConnectionEvent.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        data: SyncConnectionInfo? = nil,
        name: SyncConnectionEventName? = nil,
        type: SyncConnectionEventType? = nil
    ) -> SyncConnectionEvent {
        return SyncConnectionEvent(
            data: data ?? self.data,
            name: name ?? self.name,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SyncConnectionInfo
struct SyncConnectionInfo: Codable {
    let client: SyncClientKind
    let connected: Bool
    let deviceID: String?

    enum CodingKeys: String, CodingKey {
        case client = "client"
        case connected = "connected"
        case deviceID = "device_id"
    }
}

// MARK: SyncConnectionInfo convenience initializers and mutators

extension SyncConnectionInfo {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncConnectionInfo.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        client: SyncClientKind? = nil,
        connected: Bool? = nil,
        deviceID: String?? = nil
    ) -> SyncConnectionInfo {
        return SyncConnectionInfo(
            client: client ?? self.client,
            connected: connected ?? self.connected,
            deviceID: deviceID ?? self.deviceID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncConnectionEventName: String, Codable {
    case deviceConnection = "device.connection"
}

enum SyncConnectionEventType: String, Codable {
    case event = "event"
}

// MARK: - SyncError
struct SyncError: Codable {
    let code: SyncErrorCode
    let details: [String: JSONAny]?
    /// true: der Server schließt die Verbindung direkt danach und verarbeitet keine weitere
    /// Nachricht
    let fatal: Bool
    let message: String
    let opID: String?
    /// Nur mit op_id: true = Verbindung wird geschlossen, neu verbinden und ab dieser Operation
    /// erneut senden. false = endgültig abgelehnt: Operation samt abhängigen in die Fehlerablage
    /// (VERTRAEGE §11.2). Ausnahmen: session_superseded (umschreiben) und page_version_conflict
    /// (neu laden)
    let retryable: Bool
    let stream: String?
    let type: SyncErrorType

    enum CodingKeys: String, CodingKey {
        case code = "code"
        case details = "details"
        case fatal = "fatal"
        case message = "message"
        case opID = "op_id"
        case retryable = "retryable"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: SyncError convenience initializers and mutators

extension SyncError {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncError.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        code: SyncErrorCode? = nil,
        details: [String: JSONAny]?? = nil,
        fatal: Bool? = nil,
        message: String? = nil,
        opID: String?? = nil,
        retryable: Bool? = nil,
        stream: String?? = nil,
        type: SyncErrorType? = nil
    ) -> SyncError {
        return SyncError(
            code: code ?? self.code,
            details: details ?? self.details,
            fatal: fatal ?? self.fatal,
            message: message ?? self.message,
            opID: opID ?? self.opID,
            retryable: retryable ?? self.retryable,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncErrorCode: String, Codable {
    case deviceTokenInvalid = "device_token_invalid"
    case helloInvalid = "hello_invalid"
    case helloRequired = "hello_required"
    case internalError = "internal_error"
    case messageInvalid = "message_invalid"
    case moduleNotFound = "module_not_found"
    case notebookKindExists = "notebook_kind_exists"
    case notebookNotFound = "notebook_not_found"
    case opIDReused = "op_id_reused"
    case opNotAllowed = "op_not_allowed"
    case pageNotFound = "page_not_found"
    case pageVersionConflict = "page_version_conflict"
    case protocolUnsupported = "protocol_unsupported"
    case sessionNotFound = "session_not_found"
    case sessionSuperseded = "session_superseded"
    case sessionTransitionInvalid = "session_transition_invalid"
    case streamMismatch = "stream_mismatch"
    case tooManyPending = "too_many_pending"
}

enum SyncErrorType: String, Codable {
    case error = "error"
}

/// Server-Ereignisse (08 §2.4) an alle verbundenen Clients, ohne seq, nicht nachgeliefert
///
/// Zustand oder Felder einer Session haben sich geändert (auch zeitgesteuert: bereit,
/// verpasst, verarbeitet)
///
/// Weitergabe von presence eines anderen Clients
///
/// Ein Client hat sich verbunden oder getrennt (iPad-Status, F-DSH-06)
///
/// Ein Gerät hat pair/start aufgerufen. Nur an lokale Web-Clients (VERTRAEGE §12)
// MARK: - SyncEvent
struct SyncEvent: Codable {
    let data: SyncEventData
    let name: SyncEventName
    let type: SyncConnectionEventType

    enum CodingKeys: String, CodingKey {
        case data = "data"
        case name = "name"
        case type = "type"
    }
}

// MARK: SyncEvent convenience initializers and mutators

extension SyncEvent {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncEvent.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        data: SyncEventData? = nil,
        name: SyncEventName? = nil,
        type: SyncConnectionEventType? = nil
    ) -> SyncEvent {
        return SyncEvent(
            data: data ?? self.data,
            name: name ?? self.name,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Durchführung eines Termins. planned_starts_at/planned_ends_at sind abgeleitet aus dem
/// Kalendertermin (null bei spontanen Sessions).
///
/// Anfrage eines Geräts über pair/start. Die Web-App listet sie und kann sie ablehnen
/// (DELETE /devices/pairings/requests/{request_id})
// MARK: - SyncEventData
struct SyncEventData: Codable {
    let autoStopExtendedUntil: Date?
    let calendarEventID: String?
    let createdAt: Date?
    let deletedAt: Date?
    let endedAt: Date?
    let id: String?
    let moduleID: String?
    /// VL-Nummer im Modul (VL 7), Regeln in docs/VERTRAEGE.md
    let number: Int?
    let plannedEndsAt: Date?
    let plannedStartsAt: Date?
    let processing: [String: JobState]?
    let reviewState: ReviewState?
    let slideDeckID: String?
    /// Abweichende Startzeiten von Geräten (VERTRAEGE §9.3). Fehlt oder leer = keine Abweichung
    let startOffsets: [SessionStartOffset]?
    let startedAt: Date?
    let startedFrom: ClientDevice?
    let state: SessionState?
    let stopReason: StopReason?
    let title: String?
    let updatedAt: Date?
    let userID: String?
    let client: SyncClientKind?
    let deviceID: String?
    let deviceName: String?
    let notebookID: String?
    let pageID: String?
    let sessionID: String?
    let connected: Bool?
    let kind: DeviceKind?
    let pairingID: String?
    let requestID: String?
    let requestedAt: Date?

    enum CodingKeys: String, CodingKey {
        case autoStopExtendedUntil = "auto_stop_extended_until"
        case calendarEventID = "calendar_event_id"
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case endedAt = "ended_at"
        case id = "id"
        case moduleID = "module_id"
        case number = "number"
        case plannedEndsAt = "planned_ends_at"
        case plannedStartsAt = "planned_starts_at"
        case processing = "processing"
        case reviewState = "review_state"
        case slideDeckID = "slide_deck_id"
        case startOffsets = "start_offsets"
        case startedAt = "started_at"
        case startedFrom = "started_from"
        case state = "state"
        case stopReason = "stop_reason"
        case title = "title"
        case updatedAt = "updated_at"
        case userID = "user_id"
        case client = "client"
        case deviceID = "device_id"
        case deviceName = "device_name"
        case notebookID = "notebook_id"
        case pageID = "page_id"
        case sessionID = "session_id"
        case connected = "connected"
        case kind = "kind"
        case pairingID = "pairing_id"
        case requestID = "request_id"
        case requestedAt = "requested_at"
    }
}

// MARK: SyncEventData convenience initializers and mutators

extension SyncEventData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncEventData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        autoStopExtendedUntil: Date?? = nil,
        calendarEventID: String?? = nil,
        createdAt: Date?? = nil,
        deletedAt: Date?? = nil,
        endedAt: Date?? = nil,
        id: String?? = nil,
        moduleID: String?? = nil,
        number: Int?? = nil,
        plannedEndsAt: Date?? = nil,
        plannedStartsAt: Date?? = nil,
        processing: [String: JobState]?? = nil,
        reviewState: ReviewState?? = nil,
        slideDeckID: String?? = nil,
        startOffsets: [SessionStartOffset]?? = nil,
        startedAt: Date?? = nil,
        startedFrom: ClientDevice?? = nil,
        state: SessionState?? = nil,
        stopReason: StopReason?? = nil,
        title: String?? = nil,
        updatedAt: Date?? = nil,
        userID: String?? = nil,
        client: SyncClientKind?? = nil,
        deviceID: String?? = nil,
        deviceName: String?? = nil,
        notebookID: String?? = nil,
        pageID: String?? = nil,
        sessionID: String?? = nil,
        connected: Bool?? = nil,
        kind: DeviceKind?? = nil,
        pairingID: String?? = nil,
        requestID: String?? = nil,
        requestedAt: Date?? = nil
    ) -> SyncEventData {
        return SyncEventData(
            autoStopExtendedUntil: autoStopExtendedUntil ?? self.autoStopExtendedUntil,
            calendarEventID: calendarEventID ?? self.calendarEventID,
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            endedAt: endedAt ?? self.endedAt,
            id: id ?? self.id,
            moduleID: moduleID ?? self.moduleID,
            number: number ?? self.number,
            plannedEndsAt: plannedEndsAt ?? self.plannedEndsAt,
            plannedStartsAt: plannedStartsAt ?? self.plannedStartsAt,
            processing: processing ?? self.processing,
            reviewState: reviewState ?? self.reviewState,
            slideDeckID: slideDeckID ?? self.slideDeckID,
            startOffsets: startOffsets ?? self.startOffsets,
            startedAt: startedAt ?? self.startedAt,
            startedFrom: startedFrom ?? self.startedFrom,
            state: state ?? self.state,
            stopReason: stopReason ?? self.stopReason,
            title: title ?? self.title,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID,
            client: client ?? self.client,
            deviceID: deviceID ?? self.deviceID,
            deviceName: deviceName ?? self.deviceName,
            notebookID: notebookID ?? self.notebookID,
            pageID: pageID ?? self.pageID,
            sessionID: sessionID ?? self.sessionID,
            connected: connected ?? self.connected,
            kind: kind ?? self.kind,
            pairingID: pairingID ?? self.pairingID,
            requestID: requestID ?? self.requestID,
            requestedAt: requestedAt ?? self.requestedAt
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncEventName: String, Codable {
    case deviceConnection = "device.connection"
    case pairingRequested = "pairing.requested"
    case presence = "presence"
    case sessionUpdated = "session.updated"
}

/// Erste Nachricht des Clients (08 §2.1). Das Gerätetoken steht nicht hier, sondern beim
/// Upgrade im Header Authorization: Bearer (VERTRAEGE §11.1). device_id nur zur Gegenprobe.
// MARK: - SyncHello
struct SyncHello: Codable {
    let appVersion: String
    let client: SyncClientKind
    let deviceID: String?
    let syncHelloProtocol: Double
    let streams: [SyncStreamPosition]
    let type: SyncHelloType

    enum CodingKeys: String, CodingKey {
        case appVersion = "app_version"
        case client = "client"
        case deviceID = "device_id"
        case syncHelloProtocol = "protocol"
        case streams = "streams"
        case type = "type"
    }
}

// MARK: SyncHello convenience initializers and mutators

extension SyncHello {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncHello.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        appVersion: String? = nil,
        client: SyncClientKind? = nil,
        deviceID: String?? = nil,
        syncHelloProtocol: Double? = nil,
        streams: [SyncStreamPosition]? = nil,
        type: SyncHelloType? = nil
    ) -> SyncHello {
        return SyncHello(
            appVersion: appVersion ?? self.appVersion,
            client: client ?? self.client,
            deviceID: deviceID ?? self.deviceID,
            syncHelloProtocol: syncHelloProtocol ?? self.syncHelloProtocol,
            streams: streams ?? self.streams,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncHelloType: String, Codable {
    case hello = "hello"
}

/// Operation (08 §2.3), unterschieden über kind. Client → Server ohne seq/origin, Server →
/// Client mit seq und origin.
///
/// Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem
/// Papierkorb
// MARK: - SyncOp
struct SyncOp: Codable {
    let at: Int
    let clockUncertain: Bool
    let data: DataClass
    let kind: SyncClientMessageKind
    let opID: String
    let origin: SyncOrigin?
    /// Nur Server → Client
    let seq: Int?
    let stream: String
    let type: DrawingSnapshotOpType

    enum CodingKeys: String, CodingKey {
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case opID = "op_id"
        case origin = "origin"
        case seq = "seq"
        case stream = "stream"
        case type = "type"
    }
}

// MARK: SyncOp convenience initializers and mutators

extension SyncOp {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncOp.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        at: Int? = nil,
        clockUncertain: Bool? = nil,
        data: DataClass? = nil,
        kind: SyncClientMessageKind? = nil,
        opID: String? = nil,
        origin: SyncOrigin?? = nil,
        seq: Int?? = nil,
        stream: String? = nil,
        type: DrawingSnapshotOpType? = nil
    ) -> SyncOp {
        return SyncOp(
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            opID: opID ?? self.opID,
            origin: origin ?? self.origin,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Ein Gerät hat pair/start aufgerufen. Nur an lokale Web-Clients (VERTRAEGE §12)
// MARK: - SyncPairingEvent
struct SyncPairingEvent: Codable {
    let data: PairingRequest
    let name: SyncPairingEventName
    let type: SyncConnectionEventType

    enum CodingKeys: String, CodingKey {
        case data = "data"
        case name = "name"
        case type = "type"
    }
}

// MARK: SyncPairingEvent convenience initializers and mutators

extension SyncPairingEvent {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncPairingEvent.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        data: PairingRequest? = nil,
        name: SyncPairingEventName? = nil,
        type: SyncConnectionEventType? = nil
    ) -> SyncPairingEvent {
        return SyncPairingEvent(
            data: data ?? self.data,
            name: name ?? self.name,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncPairingEventName: String, Codable {
    case pairingRequested = "pairing.requested"
}

/// Keepalive des Clients alle 15 s
// MARK: - SyncPing
struct SyncPing: Codable {
    let type: SyncPingType

    enum CodingKeys: String, CodingKey {
        case type = "type"
    }
}

// MARK: SyncPing convenience initializers and mutators

extension SyncPing {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncPing.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        type: SyncPingType? = nil
    ) -> SyncPing {
        return SyncPing(
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncPingType: String, Codable {
    case ping = "ping"
}

// MARK: - SyncPong
struct SyncPong: Codable {
    let type: SyncPongType

    enum CodingKeys: String, CodingKey {
        case type = "type"
    }
}

// MARK: SyncPong convenience initializers and mutators

extension SyncPong {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncPong.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        type: SyncPongType? = nil
    ) -> SyncPong {
        return SyncPong(
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncPongType: String, Codable {
    case pong = "pong"
}

/// Was der Client gerade zeigt (ersetzt den vorigen Stand). Das iPad sendet sie bei jedem
/// Seitenwechsel, die Notizen-Spalte folgt ihr (F-DSH-04). Ergänzung zu 08 §2
// MARK: - SyncPresence
struct SyncPresence: Codable {
    let notebookID: String?
    let pageID: String?
    let sessionID: String?
    let type: NameEnum

    enum CodingKeys: String, CodingKey {
        case notebookID = "notebook_id"
        case pageID = "page_id"
        case sessionID = "session_id"
        case type = "type"
    }
}

// MARK: SyncPresence convenience initializers and mutators

extension SyncPresence {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncPresence.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        notebookID: String?? = nil,
        pageID: String?? = nil,
        sessionID: String?? = nil,
        type: NameEnum? = nil
    ) -> SyncPresence {
        return SyncPresence(
            notebookID: notebookID ?? self.notebookID,
            pageID: pageID ?? self.pageID,
            sessionID: sessionID ?? self.sessionID,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum NameEnum: String, Codable {
    case presence = "presence"
}

/// Weitergabe von presence eines anderen Clients
// MARK: - SyncPresenceEvent
struct SyncPresenceEvent: Codable {
    let data: SyncPresenceInfo
    let name: NameEnum
    let type: SyncConnectionEventType

    enum CodingKeys: String, CodingKey {
        case data = "data"
        case name = "name"
        case type = "type"
    }
}

// MARK: SyncPresenceEvent convenience initializers and mutators

extension SyncPresenceEvent {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncPresenceEvent.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        data: SyncPresenceInfo? = nil,
        name: NameEnum? = nil,
        type: SyncConnectionEventType? = nil
    ) -> SyncPresenceEvent {
        return SyncPresenceEvent(
            data: data ?? self.data,
            name: name ?? self.name,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SyncPresenceInfo
struct SyncPresenceInfo: Codable {
    let client: SyncClientKind
    let deviceID: String?
    let deviceName: String?
    let notebookID: String?
    let pageID: String?
    let sessionID: String?

    enum CodingKeys: String, CodingKey {
        case client = "client"
        case deviceID = "device_id"
        case deviceName = "device_name"
        case notebookID = "notebook_id"
        case pageID = "page_id"
        case sessionID = "session_id"
    }
}

// MARK: SyncPresenceInfo convenience initializers and mutators

extension SyncPresenceInfo {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncPresenceInfo.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        client: SyncClientKind? = nil,
        deviceID: String?? = nil,
        deviceName: String?? = nil,
        notebookID: String?? = nil,
        pageID: String?? = nil,
        sessionID: String?? = nil
    ) -> SyncPresenceInfo {
        return SyncPresenceInfo(
            client: client ?? self.client,
            deviceID: deviceID ?? self.deviceID,
            deviceName: deviceName ?? self.deviceName,
            notebookID: notebookID ?? self.notebookID,
            pageID: pageID ?? self.pageID,
            sessionID: sessionID ?? self.sessionID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - SyncResume
struct SyncResume: Codable {
    /// Ab dieser seq sendet der Server die fehlenden Operationen
    let fromSeq: Int
    /// Aktuell höchste seq des Stroms. Ergänzung zu 08 §2.1
    let headSeq: Int
    /// true: der Server kennt die gemeldete Position nicht (last_op_id passt nicht, seq zu hoch,
    /// z. B. nach einer Wiederherstellung) und sendet für diesen Strom nichts. Der Client
    /// verwirft seine Daten NICHT, sondern gleicht per REST ab, sendet fehlende eigene Daten
    /// erneut und abonniert ab stream_seq/stream_op_id (VERTRAEGE §11.1).
    let reset: Bool
    let stream: String

    enum CodingKeys: String, CodingKey {
        case fromSeq = "from_seq"
        case headSeq = "head_seq"
        case reset = "reset"
        case stream = "stream"
    }
}

// MARK: SyncResume convenience initializers and mutators

extension SyncResume {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncResume.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        fromSeq: Int? = nil,
        headSeq: Int? = nil,
        reset: Bool? = nil,
        stream: String? = nil
    ) -> SyncResume {
        return SyncResume(
            fromSeq: fromSeq ?? self.fromSeq,
            headSeq: headSeq ?? self.headSeq,
            reset: reset ?? self.reset,
            stream: stream ?? self.stream
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Alle Nachrichten Server → Client
///
/// db_epoch ändert sich bei jeder Wiederherstellung der Datenbank. Weicht sie vom
/// gespeicherten Wert ab, behandelt der Client alle Ströme wie reset (VERTRAEGE §11.1).
///
/// Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem
/// Papierkorb
///
/// ts = Serveruhr beim Antworten. Versatz = Median über 5 Runden von ts − (t0 + t1) / 2
///
/// Zustand oder Felder einer Session haben sich geändert (auch zeitgesteuert: bereit,
/// verpasst, verarbeitet)
///
/// Weitergabe von presence eines anderen Clients
///
/// Ein Client hat sich verbunden oder getrennt (iPad-Status, F-DSH-06)
///
/// Ein Gerät hat pair/start aufgerufen. Nur an lokale Web-Clients (VERTRAEGE §12)
// MARK: - SyncServerMessage
struct SyncServerMessage: Codable {
    let dbEpoch: String?
    let deviceID: String?
    let syncServerMessageProtocol: Double?
    let resume: [SyncResume]?
    let serverTime: Int?
    let serverVersion: String?
    let type: SyncServerMessageType
    let opID: String?
    /// Nur Server → Client
    let seq: Int?
    let stream: String?
    let at: Int?
    let clockUncertain: Bool?
    let data: SyncServerMessageData?
    let kind: SyncClientMessageKind?
    let origin: SyncOrigin?
    let t0: Int?
    let ts: Int?
    let code: SyncErrorCode?
    let details: [String: JSONAny]?
    /// true: der Server schließt die Verbindung direkt danach und verarbeitet keine weitere
    /// Nachricht
    let fatal: Bool?
    let message: String?
    /// Nur mit op_id: true = Verbindung wird geschlossen, neu verbinden und ab dieser Operation
    /// erneut senden. false = endgültig abgelehnt: Operation samt abhängigen in die Fehlerablage
    /// (VERTRAEGE §11.2). Ausnahmen: session_superseded (umschreiben) und page_version_conflict
    /// (neu laden)
    let retryable: Bool?
    let name: SyncEventName?

    enum CodingKeys: String, CodingKey {
        case dbEpoch = "db_epoch"
        case deviceID = "device_id"
        case syncServerMessageProtocol = "protocol"
        case resume = "resume"
        case serverTime = "server_time"
        case serverVersion = "server_version"
        case type = "type"
        case opID = "op_id"
        case seq = "seq"
        case stream = "stream"
        case at = "at"
        case clockUncertain = "clock_uncertain"
        case data = "data"
        case kind = "kind"
        case origin = "origin"
        case t0 = "t0"
        case ts = "ts"
        case code = "code"
        case details = "details"
        case fatal = "fatal"
        case message = "message"
        case retryable = "retryable"
        case name = "name"
    }
}

// MARK: SyncServerMessage convenience initializers and mutators

extension SyncServerMessage {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncServerMessage.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        dbEpoch: String?? = nil,
        deviceID: String?? = nil,
        syncServerMessageProtocol: Double?? = nil,
        resume: [SyncResume]?? = nil,
        serverTime: Int?? = nil,
        serverVersion: String?? = nil,
        type: SyncServerMessageType? = nil,
        opID: String?? = nil,
        seq: Int?? = nil,
        stream: String?? = nil,
        at: Int?? = nil,
        clockUncertain: Bool?? = nil,
        data: SyncServerMessageData?? = nil,
        kind: SyncClientMessageKind?? = nil,
        origin: SyncOrigin?? = nil,
        t0: Int?? = nil,
        ts: Int?? = nil,
        code: SyncErrorCode?? = nil,
        details: [String: JSONAny]?? = nil,
        fatal: Bool?? = nil,
        message: String?? = nil,
        retryable: Bool?? = nil,
        name: SyncEventName?? = nil
    ) -> SyncServerMessage {
        return SyncServerMessage(
            dbEpoch: dbEpoch ?? self.dbEpoch,
            deviceID: deviceID ?? self.deviceID,
            syncServerMessageProtocol: syncServerMessageProtocol ?? self.syncServerMessageProtocol,
            resume: resume ?? self.resume,
            serverTime: serverTime ?? self.serverTime,
            serverVersion: serverVersion ?? self.serverVersion,
            type: type ?? self.type,
            opID: opID ?? self.opID,
            seq: seq ?? self.seq,
            stream: stream ?? self.stream,
            at: at ?? self.at,
            clockUncertain: clockUncertain ?? self.clockUncertain,
            data: data ?? self.data,
            kind: kind ?? self.kind,
            origin: origin ?? self.origin,
            t0: t0 ?? self.t0,
            ts: ts ?? self.ts,
            code: code ?? self.code,
            details: details ?? self.details,
            fatal: fatal ?? self.fatal,
            message: message ?? self.message,
            retryable: retryable ?? self.retryable,
            name: name ?? self.name
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Freies Notizbuch offline anlegen (F-INK-02, F-INK-14). Strom notebook:<notebook_id>,
/// idempotent über notebook_id.
///
/// Datei vorher per PUT /pages/{id}/pkdrawing hochgeladen, nur fürs iPad
///
/// Unbekannte session_id: der Core legt die Session an (Start offline auf dem iPad, F-SES-02
/// Schritt 3)
///
/// session.pause / session.resume
///
/// Marker vom iPad (F-INK-05) und vom Mac (F-DSH-05, source=mac)
///
/// Rückgängig (⌘Z, F-DSH-05) bzw. Löschen
///
/// Datei per PUT /photos/{photo_id}/file, Reihenfolge egal
///
/// Durchführung eines Termins. planned_starts_at/planned_ends_at sind abgeleitet aus dem
/// Kalendertermin (null bei spontanen Sessions).
///
/// Anfrage eines Geräts über pair/start. Die Web-App listet sie und kann sie ablehnen
/// (DELETE /devices/pairings/requests/{request_id})
// MARK: - SyncServerMessageData
struct SyncServerMessageData: Codable {
    let createdAt: CreatedAt?
    /// Nur frei. Die Notizbücher vorlesung/uebung legt der Core an
    let kind: Kind?
    let moduleID: String?
    let notebookID: String?
    let title: String?
    let attachedSlideID: String?
    let backgroundSlideID: String?
    let heightPt: Double?
    let index: Int?
    let pageID: String?
    let sessionID: String?
    let template: PageTemplate?
    let widthPt: Double?
    let fields: UpdateFields?
    /// Version, auf der die Änderung beruht. Der Core setzt danach version + 1
    let version: Int?
    let stroke: Stroke?
    let clientIDS: [String]?
    let element: PageElement?
    let elementID: String?
    let pkdrawingRef: FileRef?
    let calendarEventID: String?
    let slideDeckID: String?
    let startedAt: StartedAt?
    let startedFrom: ClientDevice?
    let reason: StopReason?
    let device: ClientDevice?
    let eventID: String?
    let slideID: String?
    let slideIndex: Int?
    let tMS: Int?
    let markerID: String?
    let note: String?
    let position: MarkerPosition?
    let source: ClientDevice?
    let fileRef: PhotoFileRef?
    let photoID: String?
    let autoStopExtendedUntil: Date?
    let deletedAt: Date?
    let endedAt: Date?
    let id: String?
    /// VL-Nummer im Modul (VL 7), Regeln in docs/VERTRAEGE.md
    let number: Int?
    let plannedEndsAt: Date?
    let plannedStartsAt: Date?
    let processing: [String: JobState]?
    let reviewState: ReviewState?
    /// Abweichende Startzeiten von Geräten (VERTRAEGE §9.3). Fehlt oder leer = keine Abweichung
    let startOffsets: [SessionStartOffset]?
    let state: SessionState?
    let stopReason: StopReason?
    let updatedAt: Date?
    let userID: String?
    let client: SyncClientKind?
    let deviceID: String?
    let deviceName: String?
    let connected: Bool?
    let pairingID: String?
    let requestID: String?
    let requestedAt: Date?

    enum CodingKeys: String, CodingKey {
        case createdAt = "created_at"
        case kind = "kind"
        case moduleID = "module_id"
        case notebookID = "notebook_id"
        case title = "title"
        case attachedSlideID = "attached_slide_id"
        case backgroundSlideID = "background_slide_id"
        case heightPt = "height_pt"
        case index = "index"
        case pageID = "page_id"
        case sessionID = "session_id"
        case template = "template"
        case widthPt = "width_pt"
        case fields = "fields"
        case version = "version"
        case stroke = "stroke"
        case clientIDS = "client_ids"
        case element = "element"
        case elementID = "element_id"
        case pkdrawingRef = "pkdrawing_ref"
        case calendarEventID = "calendar_event_id"
        case slideDeckID = "slide_deck_id"
        case startedAt = "started_at"
        case startedFrom = "started_from"
        case reason = "reason"
        case device = "device"
        case eventID = "event_id"
        case slideID = "slide_id"
        case slideIndex = "slide_index"
        case tMS = "t_ms"
        case markerID = "marker_id"
        case note = "note"
        case position = "position"
        case source = "source"
        case fileRef = "file_ref"
        case photoID = "photo_id"
        case autoStopExtendedUntil = "auto_stop_extended_until"
        case deletedAt = "deleted_at"
        case endedAt = "ended_at"
        case id = "id"
        case number = "number"
        case plannedEndsAt = "planned_ends_at"
        case plannedStartsAt = "planned_starts_at"
        case processing = "processing"
        case reviewState = "review_state"
        case startOffsets = "start_offsets"
        case state = "state"
        case stopReason = "stop_reason"
        case updatedAt = "updated_at"
        case userID = "user_id"
        case client = "client"
        case deviceID = "device_id"
        case deviceName = "device_name"
        case connected = "connected"
        case pairingID = "pairing_id"
        case requestID = "request_id"
        case requestedAt = "requested_at"
    }
}

// MARK: SyncServerMessageData convenience initializers and mutators

extension SyncServerMessageData {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncServerMessageData.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        createdAt: CreatedAt?? = nil,
        kind: Kind?? = nil,
        moduleID: String?? = nil,
        notebookID: String?? = nil,
        title: String?? = nil,
        attachedSlideID: String?? = nil,
        backgroundSlideID: String?? = nil,
        heightPt: Double?? = nil,
        index: Int?? = nil,
        pageID: String?? = nil,
        sessionID: String?? = nil,
        template: PageTemplate?? = nil,
        widthPt: Double?? = nil,
        fields: UpdateFields?? = nil,
        version: Int?? = nil,
        stroke: Stroke?? = nil,
        clientIDS: [String]?? = nil,
        element: PageElement?? = nil,
        elementID: String?? = nil,
        pkdrawingRef: FileRef?? = nil,
        calendarEventID: String?? = nil,
        slideDeckID: String?? = nil,
        startedAt: StartedAt?? = nil,
        startedFrom: ClientDevice?? = nil,
        reason: StopReason?? = nil,
        device: ClientDevice?? = nil,
        eventID: String?? = nil,
        slideID: String?? = nil,
        slideIndex: Int?? = nil,
        tMS: Int?? = nil,
        markerID: String?? = nil,
        note: String?? = nil,
        position: MarkerPosition?? = nil,
        source: ClientDevice?? = nil,
        fileRef: PhotoFileRef?? = nil,
        photoID: String?? = nil,
        autoStopExtendedUntil: Date?? = nil,
        deletedAt: Date?? = nil,
        endedAt: Date?? = nil,
        id: String?? = nil,
        number: Int?? = nil,
        plannedEndsAt: Date?? = nil,
        plannedStartsAt: Date?? = nil,
        processing: [String: JobState]?? = nil,
        reviewState: ReviewState?? = nil,
        startOffsets: [SessionStartOffset]?? = nil,
        state: SessionState?? = nil,
        stopReason: StopReason?? = nil,
        updatedAt: Date?? = nil,
        userID: String?? = nil,
        client: SyncClientKind?? = nil,
        deviceID: String?? = nil,
        deviceName: String?? = nil,
        connected: Bool?? = nil,
        pairingID: String?? = nil,
        requestID: String?? = nil,
        requestedAt: Date?? = nil
    ) -> SyncServerMessageData {
        return SyncServerMessageData(
            createdAt: createdAt ?? self.createdAt,
            kind: kind ?? self.kind,
            moduleID: moduleID ?? self.moduleID,
            notebookID: notebookID ?? self.notebookID,
            title: title ?? self.title,
            attachedSlideID: attachedSlideID ?? self.attachedSlideID,
            backgroundSlideID: backgroundSlideID ?? self.backgroundSlideID,
            heightPt: heightPt ?? self.heightPt,
            index: index ?? self.index,
            pageID: pageID ?? self.pageID,
            sessionID: sessionID ?? self.sessionID,
            template: template ?? self.template,
            widthPt: widthPt ?? self.widthPt,
            fields: fields ?? self.fields,
            version: version ?? self.version,
            stroke: stroke ?? self.stroke,
            clientIDS: clientIDS ?? self.clientIDS,
            element: element ?? self.element,
            elementID: elementID ?? self.elementID,
            pkdrawingRef: pkdrawingRef ?? self.pkdrawingRef,
            calendarEventID: calendarEventID ?? self.calendarEventID,
            slideDeckID: slideDeckID ?? self.slideDeckID,
            startedAt: startedAt ?? self.startedAt,
            startedFrom: startedFrom ?? self.startedFrom,
            reason: reason ?? self.reason,
            device: device ?? self.device,
            eventID: eventID ?? self.eventID,
            slideID: slideID ?? self.slideID,
            slideIndex: slideIndex ?? self.slideIndex,
            tMS: tMS ?? self.tMS,
            markerID: markerID ?? self.markerID,
            note: note ?? self.note,
            position: position ?? self.position,
            source: source ?? self.source,
            fileRef: fileRef ?? self.fileRef,
            photoID: photoID ?? self.photoID,
            autoStopExtendedUntil: autoStopExtendedUntil ?? self.autoStopExtendedUntil,
            deletedAt: deletedAt ?? self.deletedAt,
            endedAt: endedAt ?? self.endedAt,
            id: id ?? self.id,
            number: number ?? self.number,
            plannedEndsAt: plannedEndsAt ?? self.plannedEndsAt,
            plannedStartsAt: plannedStartsAt ?? self.plannedStartsAt,
            processing: processing ?? self.processing,
            reviewState: reviewState ?? self.reviewState,
            startOffsets: startOffsets ?? self.startOffsets,
            state: state ?? self.state,
            stopReason: stopReason ?? self.stopReason,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID,
            client: client ?? self.client,
            deviceID: deviceID ?? self.deviceID,
            deviceName: deviceName ?? self.deviceName,
            connected: connected ?? self.connected,
            pairingID: pairingID ?? self.pairingID,
            requestID: requestID ?? self.requestID,
            requestedAt: requestedAt ?? self.requestedAt
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum CreatedAt: Codable {
    case dateTime(Date)
    case integer(Int)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let x = try? container.decode(Int.self) {
            self = .integer(x)
            return
        }
        if let x = try? container.decode(Date.self) {
            self = .dateTime(x)
            return
        }
        throw DecodingError.typeMismatch(CreatedAt.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Wrong type for CreatedAt"))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .dateTime(let x):
            try container.encode(x)
        case .integer(let x):
            try container.encode(x)
        }
    }
}

enum Kind: String, Codable {
    case frage = "frage"
    case frei = "frei"
    case ipad = "ipad"
    case iphone = "iphone"
    case klausur = "klausur"
    case verknuepfung = "verknuepfung"
}

enum StartedAt: Codable {
    case dateTime(Date)
    case integer(Int)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let x = try? container.decode(Int.self) {
            self = .integer(x)
            return
        }
        if let x = try? container.decode(Date.self) {
            self = .dateTime(x)
            return
        }
        if container.decodeNil() {
            self = .null
            return
        }
        throw DecodingError.typeMismatch(StartedAt.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Wrong type for StartedAt"))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .dateTime(let x):
            try container.encode(x)
        case .integer(let x):
            try container.encode(x)
        case .null:
            try container.encodeNil()
        }
    }
}

enum SyncServerMessageType: String, Codable {
    case ack = "ack"
    case error = "error"
    case event = "event"
    case op = "op"
    case pong = "pong"
    case subscribed = "subscribed"
    case timePong = "time.pong"
    case welcome = "welcome"
}

/// Zustand oder Felder einer Session haben sich geändert (auch zeitgesteuert: bereit,
/// verpasst, verarbeitet)
// MARK: - SyncSessionUpdatedEvent
struct SyncSessionUpdatedEvent: Codable {
    let data: Session
    let name: SyncSessionUpdatedEventName
    let type: SyncConnectionEventType

    enum CodingKeys: String, CodingKey {
        case data = "data"
        case name = "name"
        case type = "type"
    }
}

// MARK: SyncSessionUpdatedEvent convenience initializers and mutators

extension SyncSessionUpdatedEvent {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncSessionUpdatedEvent.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        data: Session? = nil,
        name: SyncSessionUpdatedEventName? = nil,
        type: SyncConnectionEventType? = nil
    ) -> SyncSessionUpdatedEvent {
        return SyncSessionUpdatedEvent(
            data: data ?? self.data,
            name: name ?? self.name,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncSessionUpdatedEventName: String, Codable {
    case sessionUpdated = "session.updated"
}

/// Weitere Ströme abonnieren, ohne neu zu verbinden. Antwort: subscribed. Ergänzung zu 08 §2
// MARK: - SyncSubscribe
struct SyncSubscribe: Codable {
    let streams: [SyncStreamPosition]
    let type: SyncSubscribeType

    enum CodingKeys: String, CodingKey {
        case streams = "streams"
        case type = "type"
    }
}

// MARK: SyncSubscribe convenience initializers and mutators

extension SyncSubscribe {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncSubscribe.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        streams: [SyncStreamPosition]? = nil,
        type: SyncSubscribeType? = nil
    ) -> SyncSubscribe {
        return SyncSubscribe(
            streams: streams ?? self.streams,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncSubscribeType: String, Codable {
    case subscribe = "subscribe"
}

// MARK: - SyncSubscribed
struct SyncSubscribed: Codable {
    let resume: [SyncResume]
    let type: SyncSubscribedType

    enum CodingKeys: String, CodingKey {
        case resume = "resume"
        case type = "type"
    }
}

// MARK: SyncSubscribed convenience initializers and mutators

extension SyncSubscribed {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncSubscribed.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        resume: [SyncResume]? = nil,
        type: SyncSubscribedType? = nil
    ) -> SyncSubscribed {
        return SyncSubscribed(
            resume: resume ?? self.resume,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncSubscribedType: String, Codable {
    case subscribed = "subscribed"
}

/// Ergebnis des Uhrabgleichs an den Server (device.clock_offset_ms). Ergänzung zu 08 §2.1
// MARK: - SyncTimeOffset
struct SyncTimeOffset: Codable {
    /// Gemessener Versatz Server − Client
    let offsetMS: Int
    /// Median der Umlaufzeit
    let rttMS: Int
    let type: SyncTimeOffsetType

    enum CodingKeys: String, CodingKey {
        case offsetMS = "offset_ms"
        case rttMS = "rtt_ms"
        case type = "type"
    }
}

// MARK: SyncTimeOffset convenience initializers and mutators

extension SyncTimeOffset {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncTimeOffset.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        offsetMS: Int? = nil,
        rttMS: Int? = nil,
        type: SyncTimeOffsetType? = nil
    ) -> SyncTimeOffset {
        return SyncTimeOffset(
            offsetMS: offsetMS ?? self.offsetMS,
            rttMS: rttMS ?? self.rttMS,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncTimeOffsetType: String, Codable {
    case timeOffset = "time.offset"
}

/// t0 = lokale Uhr des Clients beim Senden (F-SYN-02)
// MARK: - SyncTimePing
struct SyncTimePing: Codable {
    let t0: Int
    let type: SyncTimePingType

    enum CodingKeys: String, CodingKey {
        case t0 = "t0"
        case type = "type"
    }
}

// MARK: SyncTimePing convenience initializers and mutators

extension SyncTimePing {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncTimePing.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        t0: Int? = nil,
        type: SyncTimePingType? = nil
    ) -> SyncTimePing {
        return SyncTimePing(
            t0: t0 ?? self.t0,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncTimePingType: String, Codable {
    case timePing = "time.ping"
}

/// ts = Serveruhr beim Antworten. Versatz = Median über 5 Runden von ts − (t0 + t1) / 2
// MARK: - SyncTimePong
struct SyncTimePong: Codable {
    let t0: Int
    let ts: Int
    let type: SyncTimePongType

    enum CodingKeys: String, CodingKey {
        case t0 = "t0"
        case ts = "ts"
        case type = "type"
    }
}

// MARK: SyncTimePong convenience initializers and mutators

extension SyncTimePong {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncTimePong.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        t0: Int? = nil,
        ts: Int? = nil,
        type: SyncTimePongType? = nil
    ) -> SyncTimePong {
        return SyncTimePong(
            t0: t0 ?? self.t0,
            ts: ts ?? self.ts,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncTimePongType: String, Codable {
    case timePong = "time.pong"
}

// MARK: - SyncUnsubscribe
struct SyncUnsubscribe: Codable {
    let streams: [String]
    let type: SyncUnsubscribeType

    enum CodingKeys: String, CodingKey {
        case streams = "streams"
        case type = "type"
    }
}

// MARK: SyncUnsubscribe convenience initializers and mutators

extension SyncUnsubscribe {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncUnsubscribe.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        streams: [String]? = nil,
        type: SyncUnsubscribeType? = nil
    ) -> SyncUnsubscribe {
        return SyncUnsubscribe(
            streams: streams ?? self.streams,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncUnsubscribeType: String, Codable {
    case unsubscribe = "unsubscribe"
}

/// db_epoch ändert sich bei jeder Wiederherstellung der Datenbank. Weicht sie vom
/// gespeicherten Wert ab, behandelt der Client alle Ströme wie reset (VERTRAEGE §11.1).
// MARK: - SyncWelcome
struct SyncWelcome: Codable {
    let dbEpoch: String
    let deviceID: String?
    let syncWelcomeProtocol: Double
    let resume: [SyncResume]
    let serverTime: Int
    let serverVersion: String
    let type: SyncWelcomeType

    enum CodingKeys: String, CodingKey {
        case dbEpoch = "db_epoch"
        case deviceID = "device_id"
        case syncWelcomeProtocol = "protocol"
        case resume = "resume"
        case serverTime = "server_time"
        case serverVersion = "server_version"
        case type = "type"
    }
}

// MARK: SyncWelcome convenience initializers and mutators

extension SyncWelcome {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(SyncWelcome.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        dbEpoch: String? = nil,
        deviceID: String?? = nil,
        syncWelcomeProtocol: Double? = nil,
        resume: [SyncResume]? = nil,
        serverTime: Int? = nil,
        serverVersion: String? = nil,
        type: SyncWelcomeType? = nil
    ) -> SyncWelcome {
        return SyncWelcome(
            dbEpoch: dbEpoch ?? self.dbEpoch,
            deviceID: deviceID ?? self.deviceID,
            syncWelcomeProtocol: syncWelcomeProtocol ?? self.syncWelcomeProtocol,
            resume: resume ?? self.resume,
            serverTime: serverTime ?? self.serverTime,
            serverVersion: serverVersion ?? self.serverVersion,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SyncWelcomeType: String, Codable {
    case welcome = "welcome"
}

// MARK: - TapeElement
struct TapeElement: Codable {
    let elementID: String
    let frame: [Double]
    let kind: TapeElementKind
    let payload: TapeElementPayload
    let tMS: Int?
    let z: Int

    enum CodingKeys: String, CodingKey {
        case elementID = "element_id"
        case frame = "frame"
        case kind = "kind"
        case payload = "payload"
        case tMS = "t_ms"
        case z = "z"
    }
}

// MARK: TapeElement convenience initializers and mutators

extension TapeElement {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(TapeElement.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        elementID: String? = nil,
        frame: [Double]? = nil,
        kind: TapeElementKind? = nil,
        payload: TapeElementPayload? = nil,
        tMS: Int?? = nil,
        z: Int? = nil
    ) -> TapeElement {
        return TapeElement(
            elementID: elementID ?? self.elementID,
            frame: frame ?? self.frame,
            kind: kind ?? self.kind,
            payload: payload ?? self.payload,
            tMS: tMS ?? self.tMS,
            z: z ?? self.z
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum TapeElementKind: String, Codable {
    case tape = "tape"
}

// MARK: - TapeElementPayload
struct TapeElementPayload: Codable {
    let cardID: String?
    let color: String
    let covered: Bool

    enum CodingKeys: String, CodingKey {
        case cardID = "card_id"
        case color = "color"
        case covered = "covered"
    }
}

// MARK: TapeElementPayload convenience initializers and mutators

extension TapeElementPayload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(TapeElementPayload.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        cardID: String?? = nil,
        color: String? = nil,
        covered: Bool? = nil
    ) -> TapeElementPayload {
        return TapeElementPayload(
            cardID: cardID ?? self.cardID,
            color: color ?? self.color,
            covered: covered ?? self.covered
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Teilaufgabe eines Übungsblatts. Zerlegung erst ab Phase 2 (F-ORG-03).
// MARK: - Task
struct Task: Codable {
    let bbox: [Double]?
    let createdAt: Date
    let deletedAt: Date?
    let id: String
    let label: String
    let pageIndex: Int
    let sheetID: String
    let solutionText: String?
    let text: String
    let updatedAt: Date
    let userID: String

    enum CodingKeys: String, CodingKey {
        case bbox = "bbox"
        case createdAt = "created_at"
        case deletedAt = "deleted_at"
        case id = "id"
        case label = "label"
        case pageIndex = "page_index"
        case sheetID = "sheet_id"
        case solutionText = "solution_text"
        case text = "text"
        case updatedAt = "updated_at"
        case userID = "user_id"
    }
}

// MARK: Task convenience initializers and mutators

extension Task {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Task.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        bbox: [Double]?? = nil,
        createdAt: Date? = nil,
        deletedAt: Date?? = nil,
        id: String? = nil,
        label: String? = nil,
        pageIndex: Int? = nil,
        sheetID: String? = nil,
        solutionText: String?? = nil,
        text: String? = nil,
        updatedAt: Date? = nil,
        userID: String? = nil
    ) -> Task {
        return Task(
            bbox: bbox ?? self.bbox,
            createdAt: createdAt ?? self.createdAt,
            deletedAt: deletedAt ?? self.deletedAt,
            id: id ?? self.id,
            label: label ?? self.label,
            pageIndex: pageIndex ?? self.pageIndex,
            sheetID: sheetID ?? self.sheetID,
            solutionText: solutionText ?? self.solutionText,
            text: text ?? self.text,
            updatedAt: updatedAt ?? self.updatedAt,
            userID: userID ?? self.userID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - TextElement
struct TextElement: Codable {
    let elementID: String
    let frame: [Double]
    let kind: TextElementKind
    let payload: TextElementPayload
    let tMS: Int?
    let z: Int

    enum CodingKeys: String, CodingKey {
        case elementID = "element_id"
        case frame = "frame"
        case kind = "kind"
        case payload = "payload"
        case tMS = "t_ms"
        case z = "z"
    }
}

// MARK: TextElement convenience initializers and mutators

extension TextElement {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(TextElement.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        elementID: String? = nil,
        frame: [Double]? = nil,
        kind: TextElementKind? = nil,
        payload: TextElementPayload? = nil,
        tMS: Int?? = nil,
        z: Int? = nil
    ) -> TextElement {
        return TextElement(
            elementID: elementID ?? self.elementID,
            frame: frame ?? self.frame,
            kind: kind ?? self.kind,
            payload: payload ?? self.payload,
            tMS: tMS ?? self.tMS,
            z: z ?? self.z
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum TextElementKind: String, Codable {
    case text = "text"
}

// MARK: - TextElementPayload
struct TextElementPayload: Codable {
    let size: TextSize
    let text: String

    enum CodingKeys: String, CodingKey {
        case size = "size"
        case text = "text"
    }
}

// MARK: TextElementPayload convenience initializers and mutators

extension TextElementPayload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(TextElementPayload.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        size: TextSize? = nil,
        text: String? = nil
    ) -> TextElementPayload {
        return TextElementPayload(
            size: size ?? self.size,
            text: text ?? self.text
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Direkt gelöschtes Objekt im Papierkorb (F-DAT-04). Mitgelöschte Teile erscheinen nicht
/// einzeln.
// MARK: - TrashItem
struct TrashItem: Codable {
    let deletedAt: Date
    /// Mitgelöschte abhängige Objekte, die mit wiederhergestellt werden
    let dependentCount: Int
    let id: String
    let kind: TrashKind
    let parent: TrashParent?
    let purgeAt: Date
    /// Anzeigename (Titel, Name oder z. B. „Seite 3")
    let title: String

    enum CodingKeys: String, CodingKey {
        case deletedAt = "deleted_at"
        case dependentCount = "dependent_count"
        case id = "id"
        case kind = "kind"
        case parent = "parent"
        case purgeAt = "purge_at"
        case title = "title"
    }
}

// MARK: TrashItem convenience initializers and mutators

extension TrashItem {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(TrashItem.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        deletedAt: Date? = nil,
        dependentCount: Int? = nil,
        id: String? = nil,
        kind: TrashKind? = nil,
        parent: TrashParent?? = nil,
        purgeAt: Date? = nil,
        title: String? = nil
    ) -> TrashItem {
        return TrashItem(
            deletedAt: deletedAt ?? self.deletedAt,
            dependentCount: dependentCount ?? self.dependentCount,
            id: id ?? self.id,
            kind: kind ?? self.kind,
            parent: parent ?? self.parent,
            purgeAt: purgeAt ?? self.purgeAt,
            title: title ?? self.title
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum TrashKind: String, Codable {
    case calendarSource = "calendar_source"
    case exerciseSheet = "exercise_sheet"
    case marker = "marker"
    case module = "module"
    case notebook = "notebook"
    case page = "page"
    case photo = "photo"
    case semester = "semester"
    case session = "session"
    case slideDeck = "slide_deck"
}

// MARK: - TrashParent
struct TrashParent: Codable {
    let id: String
    let kind: TrashKind
    let title: String

    enum CodingKeys: String, CodingKey {
        case id = "id"
        case kind = "kind"
        case title = "title"
    }
}

// MARK: TrashParent convenience initializers and mutators

extension TrashParent {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(TrashParent.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        id: String? = nil,
        kind: TrashKind? = nil,
        title: String? = nil
    ) -> TrashParent {
        return TrashParent(
            id: id ?? self.id,
            kind: kind ?? self.kind,
            title: title ?? self.title
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - TrashList
struct TrashList: Codable {
    let items: [TrashItem]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case items = "items"
        case nextCursor = "next_cursor"
    }
}

// MARK: TrashList convenience initializers and mutators

extension TrashList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(TrashList.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        items: [TrashItem]? = nil,
        nextCursor: String?? = nil
    ) -> TrashList {
        return TrashList(
            items: items ?? self.items,
            nextCursor: nextCursor ?? self.nextCursor
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// POST /trash/{id}/restore, auch für „Rückgängig" im Toast
// MARK: - TrashRestoreResult
struct TrashRestoreResult: Codable {
    let id: String
    let kind: TrashKind
    let restoredCount: Int

    enum CodingKeys: String, CodingKey {
        case id = "id"
        case kind = "kind"
        case restoredCount = "restored_count"
    }
}

// MARK: TrashRestoreResult convenience initializers and mutators

extension TrashRestoreResult {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(TrashRestoreResult.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        id: String? = nil,
        kind: TrashKind? = nil,
        restoredCount: Int? = nil
    ) -> TrashRestoreResult {
        return TrashRestoreResult(
            id: id ?? self.id,
            kind: kind ?? self.kind,
            restoredCount: restoredCount ?? self.restoredCount
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Antwort auf POST /slide-decks und POST /exercise-sheets. duplicate=true: Datei mit
/// gleichem sha256 existiert schon, es wurde nichts angelegt (F-ORG-02 Sonderfall). id ist
/// die ID des neuen bzw. bereits vorhandenen Objekts.
// MARK: - UploadResult
struct UploadResult: Codable {
    let duplicate: Bool
    let id: String

    enum CodingKeys: String, CodingKey {
        case duplicate = "duplicate"
        case id = "id"
    }
}

// MARK: UploadResult convenience initializers and mutators

extension UploadResult {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(UploadResult.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        duplicate: Bool? = nil,
        id: String? = nil
    ) -> UploadResult {
        return UploadResult(
            duplicate: duplicate ?? self.duplicate,
            id: id ?? self.id
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - Helper functions for creating encoders and decoders

func newJSONDecoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
        let container = try decoder.singleValueContainer()
        let string = try container.decode(String.self)
        if let date = sgParseTimestamp(string) { return date }
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Ungültiger Zeitstempel: \(string)")
    }
    return decoder
}

func newJSONEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .custom { date, encoder in
        var container = encoder.singleValueContainer()
        try container.encode(sgFormatTimestamp(date))
    }
    return encoder
}

/// ISO 8601 mit und ohne Sekundenbruchteile, mit Z oder Offset
func sgParseTimestamp(_ string: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: string) { return date }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: string)
}

/// UTC mit Z; Millisekunden nur, wenn sie nicht 0 sind (wie der Core sie schreibt)
func sgFormatTimestamp(_ date: Date) -> String {
    let millis = Int64((date.timeIntervalSince1970 * 1000).rounded())
    var seconds = millis / 1000
    var rest = millis % 1000
    if rest < 0 { rest += 1000; seconds -= 1 }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    let base = plain.string(from: Date(timeIntervalSince1970: TimeInterval(seconds)))
    if rest == 0 { return base }
    return String(base.dropLast()) + "." + String(format: "%03d", Int(rest)) + "Z"
}

// MARK: - Encode/decode helpers

class JSONNull: Codable, Hashable {

    public static func == (lhs: JSONNull, rhs: JSONNull) -> Bool {
        return true
    }

    public var hashValue: Int {
        return 0
    }

    public func hash(into hasher: inout Hasher) {
        // No-op
    }

    public init() {}

    public required init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if !container.decodeNil() {
            throw DecodingError.typeMismatch(JSONNull.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Wrong type for JSONNull"))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encodeNil()
    }
}

class JSONCodingKey: CodingKey {
    let key: String

    required init?(intValue: Int) {
        return nil
    }

    required init?(stringValue: String) {
        key = stringValue
    }

    var intValue: Int? {
        return nil
    }

    var stringValue: String {
        return key
    }
}

class JSONAny: Codable {

    let value: Any

    static func decodingError(forCodingPath codingPath: [CodingKey]) -> DecodingError {
        let context = DecodingError.Context(codingPath: codingPath, debugDescription: "Cannot decode JSONAny")
        return DecodingError.typeMismatch(JSONAny.self, context)
    }

    static func encodingError(forValue value: Any, codingPath: [CodingKey]) -> EncodingError {
        let context = EncodingError.Context(codingPath: codingPath, debugDescription: "Cannot encode JSONAny")
        return EncodingError.invalidValue(value, context)
    }

    static func decode(from container: SingleValueDecodingContainer) throws -> Any {
        if let value = try? container.decode(Bool.self) {
            return value
        }
        if let value = try? container.decode(Int64.self) {
            return value
        }
        if let value = try? container.decode(Double.self) {
            return value
        }
        if let value = try? container.decode(String.self) {
            return value
        }
        if container.decodeNil() {
            return JSONNull()
        }
        throw decodingError(forCodingPath: container.codingPath)
    }

    static func decode(from container: inout UnkeyedDecodingContainer) throws -> Any {
        if let value = try? container.decode(Bool.self) {
            return value
        }
        if let value = try? container.decode(Int64.self) {
            return value
        }
        if let value = try? container.decode(Double.self) {
            return value
        }
        if let value = try? container.decode(String.self) {
            return value
        }
        if let value = try? container.decodeNil() {
            if value {
                return JSONNull()
            }
        }
        if var container = try? container.nestedUnkeyedContainer() {
            return try decodeArray(from: &container)
        }
        if var container = try? container.nestedContainer(keyedBy: JSONCodingKey.self) {
            return try decodeDictionary(from: &container)
        }
        throw decodingError(forCodingPath: container.codingPath)
    }

    static func decode(from container: inout KeyedDecodingContainer<JSONCodingKey>, forKey key: JSONCodingKey) throws -> Any {
        if let value = try? container.decode(Bool.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(Int64.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(Double.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(String.self, forKey: key) {
            return value
        }
        if let value = try? container.decodeNil(forKey: key) {
            if value {
                return JSONNull()
            }
        }
        if var container = try? container.nestedUnkeyedContainer(forKey: key) {
            return try decodeArray(from: &container)
        }
        if var container = try? container.nestedContainer(keyedBy: JSONCodingKey.self, forKey: key) {
            return try decodeDictionary(from: &container)
        }
        throw decodingError(forCodingPath: container.codingPath)
    }

    static func decodeArray(from container: inout UnkeyedDecodingContainer) throws -> [Any] {
        var arr: [Any] = []
        while !container.isAtEnd {
            let value = try decode(from: &container)
            arr.append(value)
        }
        return arr
    }

    static func decodeDictionary(from container: inout KeyedDecodingContainer<JSONCodingKey>) throws -> [String: Any] {
        var dict = [String: Any]()
        for key in container.allKeys {
            let value = try decode(from: &container, forKey: key)
            dict[key.stringValue] = value
        }
        return dict
    }

    static func encode(to container: inout UnkeyedEncodingContainer, array: [Any]) throws {
        for value in array {
            if let value = value as? Bool {
                try container.encode(value)
            } else if let value = value as? Int64 {
                try container.encode(value)
            } else if let value = value as? Double {
                try container.encode(value)
            } else if let value = value as? String {
                try container.encode(value)
            } else if value is JSONNull {
                try container.encodeNil()
            } else if let value = value as? [Any] {
                var container = container.nestedUnkeyedContainer()
                try encode(to: &container, array: value)
            } else if let value = value as? [String: Any] {
                var container = container.nestedContainer(keyedBy: JSONCodingKey.self)
                try encode(to: &container, dictionary: value)
            } else {
                throw encodingError(forValue: value, codingPath: container.codingPath)
            }
        }
    }

    static func encode(to container: inout KeyedEncodingContainer<JSONCodingKey>, dictionary: [String: Any]) throws {
        for (key, value) in dictionary {
            let key = JSONCodingKey(stringValue: key)!
            if let value = value as? Bool {
                try container.encode(value, forKey: key)
            } else if let value = value as? Int64 {
                try container.encode(value, forKey: key)
            } else if let value = value as? Double {
                try container.encode(value, forKey: key)
            } else if let value = value as? String {
                try container.encode(value, forKey: key)
            } else if value is JSONNull {
                try container.encodeNil(forKey: key)
            } else if let value = value as? [Any] {
                var container = container.nestedUnkeyedContainer(forKey: key)
                try encode(to: &container, array: value)
            } else if let value = value as? [String: Any] {
                var container = container.nestedContainer(keyedBy: JSONCodingKey.self, forKey: key)
                try encode(to: &container, dictionary: value)
            } else {
                throw encodingError(forValue: value, codingPath: container.codingPath)
            }
        }
    }

    static func encode(to container: inout SingleValueEncodingContainer, value: Any) throws {
        if let value = value as? Bool {
            try container.encode(value)
        } else if let value = value as? Int64 {
            try container.encode(value)
        } else if let value = value as? Double {
            try container.encode(value)
        } else if let value = value as? String {
            try container.encode(value)
        } else if value is JSONNull {
            try container.encodeNil()
        } else {
            throw encodingError(forValue: value, codingPath: container.codingPath)
        }
    }

    public required init(from decoder: Decoder) throws {
        if var arrayContainer = try? decoder.unkeyedContainer() {
            self.value = try JSONAny.decodeArray(from: &arrayContainer)
        } else if var container = try? decoder.container(keyedBy: JSONCodingKey.self) {
            self.value = try JSONAny.decodeDictionary(from: &container)
        } else {
            let container = try decoder.singleValueContainer()
            self.value = try JSONAny.decode(from: container)
        }
    }

    public func encode(to encoder: Encoder) throws {
        if let arr = self.value as? [Any] {
            var container = encoder.unkeyedContainer()
            try JSONAny.encode(to: &container, array: arr)
        } else if let dict = self.value as? [String: Any] {
            var container = encoder.container(keyedBy: JSONCodingKey.self)
            try JSONAny.encode(to: &container, dictionary: dict)
        } else {
            var container = encoder.singleValueContainer()
            try JSONAny.encode(to: &container, value: self.value)
        }
    }
}

// MARK: - Pflichtfelder explizit kodieren (auch null), siehe docs/VERTRAEGE.md §11.7

extension APIError {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(error, forKey: .error)
    }
}

extension APIErrorBody {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(code, forKey: .code)
        try container.encodeIfPresent(details, forKey: .details)
        try container.encode(message, forKey: .message)
    }
}

extension AudioChunk {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(duplicate, forKey: .duplicate)
        try container.encode(durationMS, forKey: .durationMS)
        try container.encode(receivedAt, forKey: .receivedAt)
        try container.encode(recordingID, forKey: .recordingID)
        try container.encode(seq, forKey: .seq)
        try container.encode(sha256, forKey: .sha256)
        try container.encode(sizeBytes, forKey: .sizeBytes)
        try container.encode(startMS, forKey: .startMS)
    }
}

extension AudioChunkMeta {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(durationMS, forKey: .durationMS)
        try container.encode(seq, forKey: .seq)
        try container.encode(sha256, forKey: .sha256)
        try container.encode(startMS, forKey: .startMS)
    }
}

extension AudioFinalizePayload {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(recordingID, forKey: .recordingID)
    }
}

extension AudioFinalizeResult {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(audioDurationMS, forKey: .audioDurationMS)
        try container.encode(chunkCount, forKey: .chunkCount)
        try container.encode(fileSizeBytes, forKey: .fileSizeBytes)
        try container.encode(gaps, forKey: .gaps)
        try container.encode(jobDurationMS, forKey: .jobDurationMS)
        try container.encode(missingSeqs, forKey: .missingSeqs)
        try container.encode(recordingID, forKey: .recordingID)
        try container.encode(state, forKey: .state)
    }
}

extension AudioGap {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(durationMS, forKey: .durationMS)
        try container.encode(reason, forKey: .reason)
        try container.encode(startMS, forKey: .startMS)
    }
}

extension BackupOverview {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(items, forKey: .items)
        try container.encode(nextCursor, forKey: .nextCursor)
        try container.encode(status, forKey: .status)
    }
}

extension BackupRun {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(error, forKey: .error)
        try container.encode(finishedAt, forKey: .finishedAt)
        try container.encode(id, forKey: .id)
        try container.encode(sizeBytes, forKey: .sizeBytes)
        try container.encode(stand, forKey: .stand)
        try container.encode(startedAt, forKey: .startedAt)
        try container.encode(state, forKey: .state)
        try container.encode(target, forKey: .target)
        try container.encode(trigger, forKey: .trigger)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
    }
}

extension BackupStatus {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(lastSuccessAt, forKey: .lastSuccessAt)
        try container.encode(nextRunAt, forKey: .nextRunAt)
        try container.encode(running, forKey: .running)
        try container.encode(stale, forKey: .stale)
        try container.encode(target, forKey: .target)
    }
}

extension CalendarEvent {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(allDay, forKey: .allDay)
        try container.encode(assignedBy, forKey: .assignedBy)
        try container.encode(cancelled, forKey: .cancelled)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(description, forKey: .description)
        try container.encode(endsAt, forKey: .endsAt)
        try container.encode(externalUid, forKey: .externalUid)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        try container.encode(location, forKey: .location)
        try container.encode(moduleID, forKey: .moduleID)
        try container.encode(recurrenceID, forKey: .recurrenceID)
        try container.encode(sessionID, forKey: .sessionID)
        try container.encode(sourceID, forKey: .sourceID)
        try container.encode(startsAt, forKey: .startsAt)
        try container.encode(title, forKey: .title)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
    }
}

extension CalendarEventList {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(items, forKey: .items)
        try container.encode(nextCursor, forKey: .nextCursor)
    }
}

extension CalendarEventUpdate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(kind, forKey: .kind)
        try container.encodeIfPresent(moduleID, forKey: .moduleID)
        try container.encodeIfPresent(scope, forKey: .scope)
    }
}

extension CalendarSource {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(eventCount, forKey: .eventCount)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        try container.encode(lastError, forKey: .lastError)
        try container.encode(lastSyncedAt, forKey: .lastSyncedAt)
        try container.encode(name, forKey: .name)
        try container.encode(readonly, forKey: .readonly)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(url, forKey: .url)
        try container.encode(userID, forKey: .userID)
    }
}

extension CalendarSourceCreate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(id, forKey: .id)
        try container.encodeIfPresent(name, forKey: .name)
        try container.encode(url, forKey: .url)
    }
}

extension CalendarSourceList {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(items, forKey: .items)
        try container.encode(nextCursor, forKey: .nextCursor)
    }
}

extension DataSettings {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(backupEncryption, forKey: .backupEncryption)
        try container.encode(backupTarget, forKey: .backupTarget)
        try container.encode(backupTime, forKey: .backupTime)
    }
}

extension DataSettingsUpdate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(backupEncryption, forKey: .backupEncryption)
        try container.encodeIfPresent(backupTarget, forKey: .backupTarget)
        try container.encodeIfPresent(backupTime, forKey: .backupTime)
    }
}

extension Device {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(appVersion, forKey: .appVersion)
        try container.encode(clockOffsetMS, forKey: .clockOffsetMS)
        try container.encode(connected, forKey: .connected)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        try container.encode(lastSeenAt, forKey: .lastSeenAt)
        try container.encode(name, forKey: .name)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
    }
}

extension DeviceList {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(items, forKey: .items)
        try container.encode(nextCursor, forKey: .nextCursor)
    }
}

extension DrawingSnapshotData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(pageID, forKey: .pageID)
        try container.encode(pkdrawingRef, forKey: .pkdrawingRef)
    }
}

extension FileRef {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(mime, forKey: .mime)
        try container.encode(sha256, forKey: .sha256)
        try container.encode(sizeBytes, forKey: .sizeBytes)
    }
}

extension DrawingSnapshotOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension ElementRemoveData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(elementID, forKey: .elementID)
        try container.encode(pageID, forKey: .pageID)
    }
}

extension ElementRemoveOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension ElementUpsertData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(element, forKey: .element)
        try container.encode(pageID, forKey: .pageID)
    }
}

extension PageElement {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(elementID, forKey: .elementID)
        try container.encode(frame, forKey: .frame)
        try container.encode(kind, forKey: .kind)
        try container.encode(payload, forKey: .payload)
        try container.encode(tMS, forKey: .tMS)
        try container.encode(z, forKey: .z)
    }
}

extension ElementUpsertOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension ExerciseSheet {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(dueAt, forKey: .dueAt)
        try container.encode(hasSolution, forKey: .hasSolution)
        try container.encode(id, forKey: .id)
        try container.encode(ingestState, forKey: .ingestState)
        try container.encode(moduleID, forKey: .moduleID)
        try container.encode(number, forKey: .number)
        try container.encode(pageCount, forKey: .pageCount)
        try container.encode(sha256, forKey: .sha256)
        try container.encode(title, forKey: .title)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
    }
}

extension ExerciseSheetList {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(items, forKey: .items)
        try container.encode(nextCursor, forKey: .nextCursor)
    }
}

extension ExerciseSheetUpdate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(dueAt, forKey: .dueAt)
        try container.encodeIfPresent(number, forKey: .number)
        try container.encodeIfPresent(title, forKey: .title)
    }
}

extension FileReceipt {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(duplicate, forKey: .duplicate)
        try container.encode(id, forKey: .id)
        try container.encode(receivedAt, forKey: .receivedAt)
        try container.encode(sha256, forKey: .sha256)
        try container.encode(sizeBytes, forKey: .sizeBytes)
    }
}

extension GeneralSettings {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(appearance, forKey: .appearance)
        try container.encode(contentLang, forKey: .contentLang)
        try container.encode(dataDir, forKey: .dataDir)
    }
}

extension GeneralSettingsUpdate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(appearance, forKey: .appearance)
        try container.encodeIfPresent(contentLang, forKey: .contentLang)
    }
}

extension Health {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(db, forKey: .db)
        try container.encode(status, forKey: .status)
        try container.encode(version, forKey: .version)
    }
}

extension ICSEventRef {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(eventID, forKey: .eventID)
        try container.encode(externalUid, forKey: .externalUid)
        try container.encode(kind, forKey: .kind)
        try container.encode(moduleID, forKey: .moduleID)
        try container.encode(recurrenceID, forKey: .recurrenceID)
        try container.encode(startsAt, forKey: .startsAt)
        try container.encode(title, forKey: .title)
    }
}

extension ICSImportCounts {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(entfallen, forKey: .entfallen)
        try container.encode(geaendert, forKey: .geaendert)
        try container.encode(neu, forKey: .neu)
        try container.encode(ohneModul, forKey: .ohneModul)
        try container.encode(unveraendert, forKey: .unveraendert)
        try container.encode(zugeordnet, forKey: .zugeordnet)
    }
}

extension ICSImportResult {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(counts, forKey: .counts)
        try container.encode(entfallen, forKey: .entfallen)
        try container.encode(geaendert, forKey: .geaendert)
        try container.encode(moduleSuggestions, forKey: .moduleSuggestions)
        try container.encode(neu, forKey: .neu)
        try container.encode(source, forKey: .source)
        try container.encode(warnings, forKey: .warnings)
        try container.encode(zugeordnet, forKey: .zugeordnet)
    }
}

extension ICSModuleSuggestion {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(eventCount, forKey: .eventCount)
        try container.encode(kind, forKey: .kind)
        try container.encode(name, forKey: .name)
        try container.encode(seriesEventIDS, forKey: .seriesEventIDS)
    }
}

extension ICSWarning {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(code, forKey: .code)
        try container.encode(externalUid, forKey: .externalUid)
        try container.encode(message, forKey: .message)
    }
}

extension ImageElement {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(elementID, forKey: .elementID)
        try container.encode(frame, forKey: .frame)
        try container.encode(kind, forKey: .kind)
        try container.encode(payload, forKey: .payload)
        try container.encode(tMS, forKey: .tMS)
        try container.encode(z, forKey: .z)
    }
}

extension ImageElementPayload {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(crop, forKey: .crop)
        try container.encode(photoID, forKey: .photoID)
    }
}

extension Job {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(attempts, forKey: .attempts)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(dependsOn, forKey: .dependsOn)
        try container.encode(error, forKey: .error)
        try container.encode(id, forKey: .id)
        try container.encode(lockedAt, forKey: .lockedAt)
        try container.encode(lockedBy, forKey: .lockedBy)
        try container.encode(maxAttempts, forKey: .maxAttempts)
        try container.encode(payload, forKey: .payload)
        try container.encode(priority, forKey: .priority)
        try container.encode(result, forKey: .result)
        try container.encode(runAfter, forKey: .runAfter)
        try container.encode(sessionID, forKey: .sessionID)
        try container.encode(state, forKey: .state)
        try container.encode(type, forKey: .type)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
    }
}

extension JobList {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(items, forKey: .items)
        try container.encode(nextCursor, forKey: .nextCursor)
    }
}

extension LectureSettings {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(autoStopAfterEndMin, forKey: .autoStopAfterEndMin)
        try container.encode(autoStopExtendMin, forKey: .autoStopExtendMin)
        try container.encode(autoStopHardAfterEndMin, forKey: .autoStopHardAfterEndMin)
        try container.encode(autoStopMaxDurationMin, forKey: .autoStopMaxDurationMin)
        try container.encode(autoStopQuietWindowMin, forKey: .autoStopQuietWindowMin)
        try container.encode(autoStopSilenceMin, forKey: .autoStopSilenceMin)
        try container.encode(autoStopWarningS, forKey: .autoStopWarningS)
        try container.encode(defaultInkMode, forKey: .defaultInkMode)
        try container.encode(defaultLayout, forKey: .defaultLayout)
        try container.encode(microphoneID, forKey: .microphoneID)
        try container.encode(toolbarSide, forKey: .toolbarSide)
    }
}

extension LectureSettingsUpdate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(autoStopAfterEndMin, forKey: .autoStopAfterEndMin)
        try container.encodeIfPresent(autoStopExtendMin, forKey: .autoStopExtendMin)
        try container.encodeIfPresent(autoStopHardAfterEndMin, forKey: .autoStopHardAfterEndMin)
        try container.encodeIfPresent(autoStopMaxDurationMin, forKey: .autoStopMaxDurationMin)
        try container.encodeIfPresent(autoStopQuietWindowMin, forKey: .autoStopQuietWindowMin)
        try container.encodeIfPresent(autoStopSilenceMin, forKey: .autoStopSilenceMin)
        try container.encodeIfPresent(autoStopWarningS, forKey: .autoStopWarningS)
        try container.encodeIfPresent(defaultInkMode, forKey: .defaultInkMode)
        try container.encodeIfPresent(defaultLayout, forKey: .defaultLayout)
        try container.encodeIfPresent(microphoneID, forKey: .microphoneID)
        try container.encodeIfPresent(toolbarSide, forKey: .toolbarSide)
    }
}

extension MaintenanceNightlyPayload {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(dryRun, forKey: .dryRun)
        try container.encodeIfPresent(purgeOlderThanDays, forKey: .purgeOlderThanDays)
    }
}

extension MaintenanceNightlyResult {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(jobDurationMS, forKey: .jobDurationMS)
        try container.encode(orphanFilesRemoved, forKey: .orphanFilesRemoved)
        try container.encode(purgedByKind, forKey: .purgedByKind)
        try container.encode(purgedCount, forKey: .purgedCount)
        try container.encode(syncOpsRemoved, forKey: .syncOpsRemoved)
    }
}

extension Marker {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        try container.encode(note, forKey: .note)
        try container.encode(pageID, forKey: .pageID)
        try container.encode(position, forKey: .position)
        try container.encode(resolvedAt, forKey: .resolvedAt)
        try container.encode(sessionID, forKey: .sessionID)
        try container.encode(source, forKey: .source)
        try container.encode(tMS, forKey: .tMS)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
    }
}

extension MarkerPosition {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(x, forKey: .x)
        try container.encode(y, forKey: .y)
    }
}

extension MarkerAddData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        try container.encode(markerID, forKey: .markerID)
        try container.encode(note, forKey: .note)
        try container.encode(pageID, forKey: .pageID)
        try container.encode(position, forKey: .position)
        try container.encode(sessionID, forKey: .sessionID)
        try container.encode(source, forKey: .source)
        try container.encode(tMS, forKey: .tMS)
    }
}

extension MarkerAddOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension MarkerRemoveData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(markerID, forKey: .markerID)
    }
}

extension MarkerRemoveOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension Module {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(color, forKey: .color)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(descriptionMd, forKey: .descriptionMd)
        try container.encode(ects, forKey: .ects)
        try container.encode(examType, forKey: .examType)
        try container.encode(id, forKey: .id)
        try container.encode(lang, forKey: .lang)
        try container.encode(lecturer, forKey: .lecturer)
        try container.encode(name, forKey: .name)
        try container.encode(semesterID, forKey: .semesterID)
        try container.encode(settings, forKey: .settings)
        try container.encode(shortName, forKey: .shortName)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
    }
}

extension ModuleSettings {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(columnWidths, forKey: .columnWidths)
        try container.encodeIfPresent(inkMode, forKey: .inkMode)
        try container.encodeIfPresent(layout, forKey: .layout)
    }
}

extension ModuleCreate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(color, forKey: .color)
        try container.encodeIfPresent(descriptionMd, forKey: .descriptionMd)
        try container.encodeIfPresent(ects, forKey: .ects)
        try container.encodeIfPresent(examType, forKey: .examType)
        try container.encodeIfPresent(id, forKey: .id)
        try container.encodeIfPresent(lang, forKey: .lang)
        try container.encodeIfPresent(lecturer, forKey: .lecturer)
        try container.encode(name, forKey: .name)
        try container.encode(semesterID, forKey: .semesterID)
        try container.encodeIfPresent(shortName, forKey: .shortName)
    }
}

extension ModuleList {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(items, forKey: .items)
        try container.encode(nextCursor, forKey: .nextCursor)
    }
}

extension ModuleSettingsUpdate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(columnWidths, forKey: .columnWidths)
        try container.encodeIfPresent(inkMode, forKey: .inkMode)
        try container.encodeIfPresent(layout, forKey: .layout)
    }
}

extension ModuleUpdate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(color, forKey: .color)
        try container.encodeIfPresent(descriptionMd, forKey: .descriptionMd)
        try container.encodeIfPresent(ects, forKey: .ects)
        try container.encodeIfPresent(examType, forKey: .examType)
        try container.encodeIfPresent(lang, forKey: .lang)
        try container.encodeIfPresent(lecturer, forKey: .lecturer)
        try container.encodeIfPresent(name, forKey: .name)
        try container.encodeIfPresent(semesterID, forKey: .semesterID)
        try container.encodeIfPresent(settings, forKey: .settings)
        try container.encodeIfPresent(shortName, forKey: .shortName)
    }
}

extension Notebook {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        try container.encode(moduleID, forKey: .moduleID)
        try container.encode(pageCount, forKey: .pageCount)
        try container.encode(title, forKey: .title)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
    }
}

extension NotebookCreate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(id, forKey: .id)
        try container.encodeIfPresent(kind, forKey: .kind)
        try container.encode(moduleID, forKey: .moduleID)
        try container.encode(title, forKey: .title)
    }
}

extension NotebookCreateData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(kind, forKey: .kind)
        try container.encode(moduleID, forKey: .moduleID)
        try container.encode(notebookID, forKey: .notebookID)
        try container.encode(title, forKey: .title)
    }
}

extension NotebookCreateOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension NotebookDeleteOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension NotebookRefData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(notebookID, forKey: .notebookID)
    }
}

extension NotebookList {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(items, forKey: .items)
        try container.encode(nextCursor, forKey: .nextCursor)
    }
}

extension NotebookPages {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(items, forKey: .items)
        try container.encode(notebookID, forKey: .notebookID)
        try container.encode(streamOpID, forKey: .streamOpID)
        try container.encode(streamSeq, forKey: .streamSeq)
    }
}

extension Page {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(attachedSlideID, forKey: .attachedSlideID)
        try container.encode(backgroundSlideID, forKey: .backgroundSlideID)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(hasPkdrawing, forKey: .hasPkdrawing)
        try container.encode(heightPt, forKey: .heightPt)
        try container.encode(id, forKey: .id)
        try container.encode(index, forKey: .index)
        try container.encode(notebookID, forKey: .notebookID)
        try container.encode(sessionID, forKey: .sessionID)
        try container.encode(template, forKey: .template)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
        try container.encode(version, forKey: .version)
        try container.encode(widthPt, forKey: .widthPt)
    }
}

extension NotebookRestoreOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension NotebookUpdate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(moduleID, forKey: .moduleID)
        try container.encodeIfPresent(title, forKey: .title)
    }
}

extension NotebookUpdateData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(fields, forKey: .fields)
        try container.encode(notebookID, forKey: .notebookID)
    }
}

extension NotebookUpdateFields {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(moduleID, forKey: .moduleID)
        try container.encode(title, forKey: .title)
    }
}

extension NotebookUpdateOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension PageCreateData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(attachedSlideID, forKey: .attachedSlideID)
        try container.encode(backgroundSlideID, forKey: .backgroundSlideID)
        try container.encode(heightPt, forKey: .heightPt)
        try container.encode(index, forKey: .index)
        try container.encode(notebookID, forKey: .notebookID)
        try container.encode(pageID, forKey: .pageID)
        try container.encode(sessionID, forKey: .sessionID)
        try container.encode(template, forKey: .template)
        try container.encode(widthPt, forKey: .widthPt)
    }
}

extension PageCreateOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension PageDeleteData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(pageID, forKey: .pageID)
    }
}

extension PageDeleteOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension PageDetail {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(elements, forKey: .elements)
        try container.encode(page, forKey: .page)
        try container.encode(streamOpID, forKey: .streamOpID)
        try container.encode(streamSeq, forKey: .streamSeq)
    }
}

extension PageRefData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(pageID, forKey: .pageID)
    }
}

extension PageRestoreOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension PageStrokes {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(pageID, forKey: .pageID)
        try container.encode(streamOpID, forKey: .streamOpID)
        try container.encode(streamSeq, forKey: .streamSeq)
        try container.encode(strokes, forKey: .strokes)
    }
}

extension Stroke {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(bbox, forKey: .bbox)
        try container.encode(clientID, forKey: .clientID)
        try container.encode(color, forKey: .color)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(layer, forKey: .layer)
        try container.encode(points, forKey: .points)
        try container.encode(tEndMS, forKey: .tEndMS)
        try container.encode(tStartMS, forKey: .tStartMS)
        try container.encode(tool, forKey: .tool)
        try container.encode(transform, forKey: .transform)
        try container.encode(width, forKey: .width)
    }
}

extension PageUpdateData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(fields, forKey: .fields)
        try container.encode(pageID, forKey: .pageID)
        try container.encode(version, forKey: .version)
    }
}

extension PageUpdateFields {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(attachedSlideID, forKey: .attachedSlideID)
        try container.encode(backgroundSlideID, forKey: .backgroundSlideID)
        try container.encode(index, forKey: .index)
        try container.encode(sessionID, forKey: .sessionID)
        try container.encode(template, forKey: .template)
    }
}

extension PageUpdateOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension PairConfirmRequest {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(appVersion, forKey: .appVersion)
        try container.encode(code, forKey: .code)
        try container.encode(deviceName, forKey: .deviceName)
        try container.encode(kind, forKey: .kind)
        try container.encode(pairingID, forKey: .pairingID)
        try container.encode(publicNonce, forKey: .publicNonce)
    }
}

extension PairResponse {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(device, forKey: .device)
        try container.encode(deviceToken, forKey: .deviceToken)
    }
}

extension PairStartRequest {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(deviceName, forKey: .deviceName)
        try container.encode(kind, forKey: .kind)
        try container.encode(publicNonce, forKey: .publicNonce)
    }
}

extension PairStartResponse {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(expiresAt, forKey: .expiresAt)
        try container.encode(pairingID, forKey: .pairingID)
        try container.encode(requestID, forKey: .requestID)
    }
}

extension PairingCode {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(code, forKey: .code)
        try container.encode(expiresAt, forKey: .expiresAt)
        try container.encode(host, forKey: .host)
        try container.encode(pairingID, forKey: .pairingID)
        try container.encode(port, forKey: .port)
        try container.encode(qrURL, forKey: .qrURL)
    }
}

extension PairingRequest {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(deviceName, forKey: .deviceName)
        try container.encode(kind, forKey: .kind)
        try container.encode(pairingID, forKey: .pairingID)
        try container.encode(requestID, forKey: .requestID)
        try container.encode(requestedAt, forKey: .requestedAt)
    }
}

extension PDFIngestDeckPayload {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(slideDeckID, forKey: .slideDeckID)
    }
}

extension PDFIngestResult {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(durationMS, forKey: .durationMS)
        try container.encode(pageCount, forKey: .pageCount)
        try container.encode(pagesWithText, forKey: .pagesWithText)
    }
}

extension PDFIngestSheetPayload {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(exerciseSheetID, forKey: .exerciseSheetID)
    }
}

extension PenSettings {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(doubleTap, forKey: .doubleTap)
        try container.encode(favoriteColors, forKey: .favoriteColors)
        try container.encode(shapeRecognition, forKey: .shapeRecognition)
        try container.encode(squeeze, forKey: .squeeze)
    }
}

extension PenSettingsUpdate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(doubleTap, forKey: .doubleTap)
        try container.encodeIfPresent(favoriteColors, forKey: .favoriteColors)
        try container.encodeIfPresent(shapeRecognition, forKey: .shapeRecognition)
        try container.encodeIfPresent(squeeze, forKey: .squeeze)
    }
}

extension Photo {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(hasFile, forKey: .hasFile)
        try container.encode(id, forKey: .id)
        try container.encode(mime, forKey: .mime)
        try container.encode(ocrText, forKey: .ocrText)
        try container.encode(pageID, forKey: .pageID)
        try container.encode(sessionID, forKey: .sessionID)
        try container.encode(sha256, forKey: .sha256)
        try container.encode(sizeBytes, forKey: .sizeBytes)
        try container.encode(tMS, forKey: .tMS)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
    }
}

extension PhotoAddData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(fileRef, forKey: .fileRef)
        try container.encode(pageID, forKey: .pageID)
        try container.encode(photoID, forKey: .photoID)
        try container.encode(sessionID, forKey: .sessionID)
        try container.encode(tMS, forKey: .tMS)
    }
}

extension PhotoFileRef {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(mime, forKey: .mime)
        try container.encode(sha256, forKey: .sha256)
        try container.encode(sizeBytes, forKey: .sizeBytes)
    }
}

extension PhotoAddOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension Recording {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(chunkCount, forKey: .chunkCount)
        try container.encode(chunksIndependent, forKey: .chunksIndependent)
        try container.encode(codec, forKey: .codec)
        try container.encode(completedAt, forKey: .completedAt)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(durationMS, forKey: .durationMS)
        try container.encode(id, forKey: .id)
        try container.encode(lastSeq, forKey: .lastSeq)
        try container.encode(mime, forKey: .mime)
        try container.encode(sessionID, forKey: .sessionID)
        try container.encode(startedMS, forKey: .startedMS)
        try container.encode(state, forKey: .state)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
    }
}

extension RecordingComplete {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(durationMS, forKey: .durationMS)
        try container.encode(lastSeq, forKey: .lastSeq)
    }
}

extension RecordingCreate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(chunksIndependent, forKey: .chunksIndependent)
        try container.encode(codec, forKey: .codec)
        try container.encodeIfPresent(id, forKey: .id)
        try container.encode(mime, forKey: .mime)
        try container.encode(startedMS, forKey: .startedMS)
    }
}

extension Semester {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(archivedAt, forKey: .archivedAt)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(endsOn, forKey: .endsOn)
        try container.encode(id, forKey: .id)
        try container.encode(isCurrent, forKey: .isCurrent)
        try container.encode(name, forKey: .name)
        try container.encode(startsOn, forKey: .startsOn)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
    }
}

extension SemesterCreate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(endsOn, forKey: .endsOn)
        try container.encodeIfPresent(id, forKey: .id)
        try container.encodeIfPresent(isCurrent, forKey: .isCurrent)
        try container.encode(name, forKey: .name)
        try container.encodeIfPresent(startsOn, forKey: .startsOn)
    }
}

extension SemesterList {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(items, forKey: .items)
        try container.encode(nextCursor, forKey: .nextCursor)
    }
}

extension SemesterUpdate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(archived, forKey: .archived)
        try container.encodeIfPresent(endsOn, forKey: .endsOn)
        try container.encodeIfPresent(isCurrent, forKey: .isCurrent)
        try container.encodeIfPresent(name, forKey: .name)
        try container.encodeIfPresent(startsOn, forKey: .startsOn)
    }
}

extension Session {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(autoStopExtendedUntil, forKey: .autoStopExtendedUntil)
        try container.encode(calendarEventID, forKey: .calendarEventID)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(endedAt, forKey: .endedAt)
        try container.encode(id, forKey: .id)
        try container.encode(moduleID, forKey: .moduleID)
        try container.encode(number, forKey: .number)
        try container.encode(plannedEndsAt, forKey: .plannedEndsAt)
        try container.encode(plannedStartsAt, forKey: .plannedStartsAt)
        try container.encode(processing, forKey: .processing)
        try container.encode(reviewState, forKey: .reviewState)
        try container.encode(slideDeckID, forKey: .slideDeckID)
        try container.encodeIfPresent(startOffsets, forKey: .startOffsets)
        try container.encode(startedAt, forKey: .startedAt)
        try container.encode(startedFrom, forKey: .startedFrom)
        try container.encode(state, forKey: .state)
        try container.encode(stopReason, forKey: .stopReason)
        try container.encode(title, forKey: .title)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
    }
}

extension SessionStartOffset {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(deviceID, forKey: .deviceID)
        try container.encode(offsetMS, forKey: .offsetMS)
    }
}

extension SessionCreate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(id, forKey: .id)
        try container.encode(moduleID, forKey: .moduleID)
        try container.encodeIfPresent(slideDeckID, forKey: .slideDeckID)
        try container.encodeIfPresent(title, forKey: .title)
    }
}

extension SessionExtendRequest {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(minutes, forKey: .minutes)
    }
}

extension SessionList {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(items, forKey: .items)
        try container.encode(nextCursor, forKey: .nextCursor)
    }
}

extension SessionPauseOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension SessionRefData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionID, forKey: .sessionID)
    }
}

extension SessionResumeOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension SessionSnapshot {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(markers, forKey: .markers)
        try container.encode(photos, forKey: .photos)
        try container.encode(recordings, forKey: .recordings)
        try container.encode(session, forKey: .session)
        try container.encode(slideEvents, forKey: .slideEvents)
        try container.encode(streamOpID, forKey: .streamOpID)
        try container.encode(streamSeq, forKey: .streamSeq)
    }
}

extension SlideEvent {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(device, forKey: .device)
        try container.encode(id, forKey: .id)
        try container.encode(sessionID, forKey: .sessionID)
        try container.encode(slideID, forKey: .slideID)
        try container.encode(slideIndex, forKey: .slideIndex)
        try container.encode(source, forKey: .source)
        try container.encode(tMS, forKey: .tMS)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
    }
}

extension SessionStartData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(calendarEventID, forKey: .calendarEventID)
        try container.encode(moduleID, forKey: .moduleID)
        try container.encode(sessionID, forKey: .sessionID)
        try container.encode(slideDeckID, forKey: .slideDeckID)
        try container.encode(startedAt, forKey: .startedAt)
        try container.encode(startedFrom, forKey: .startedFrom)
    }
}

extension SessionStartOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension SessionStartRequest {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(slideDeckID, forKey: .slideDeckID)
        try container.encode(startedFrom, forKey: .startedFrom)
    }
}

extension SessionStartResult {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(endedSession, forKey: .endedSession)
        try container.encode(session, forKey: .session)
    }
}

extension SessionStopData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(reason, forKey: .reason)
        try container.encode(sessionID, forKey: .sessionID)
    }
}

extension SessionStopOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension SessionStopRequest {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(reason, forKey: .reason)
    }
}

extension SessionUpdate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(slideDeckID, forKey: .slideDeckID)
        try container.encodeIfPresent(title, forKey: .title)
    }
}

extension Settings {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(data, forKey: .data)
        try container.encode(general, forKey: .general)
        try container.encode(lecture, forKey: .lecture)
        try container.encode(pen, forKey: .pen)
    }
}

extension SettingsUpdate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(data, forKey: .data)
        try container.encodeIfPresent(general, forKey: .general)
        try container.encodeIfPresent(lecture, forKey: .lecture)
        try container.encodeIfPresent(pen, forKey: .pen)
    }
}

extension ShapeElement {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(elementID, forKey: .elementID)
        try container.encode(frame, forKey: .frame)
        try container.encode(kind, forKey: .kind)
        try container.encode(payload, forKey: .payload)
        try container.encode(tMS, forKey: .tMS)
        try container.encode(z, forKey: .z)
    }
}

extension ShapeElementPayload {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(color, forKey: .color)
        try container.encode(points, forKey: .points)
        try container.encode(shape, forKey: .shape)
        try container.encode(width, forKey: .width)
    }
}

extension Slide {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(chapter, forKey: .chapter)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deckID, forKey: .deckID)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(heightPt, forKey: .heightPt)
        try container.encode(id, forKey: .id)
        try container.encode(index, forKey: .index)
        try container.encode(text, forKey: .text)
        try container.encode(textBlocks, forKey: .textBlocks)
        try container.encode(title, forKey: .title)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
        try container.encode(visionSummary, forKey: .visionSummary)
        try container.encode(widthPt, forKey: .widthPt)
    }
}

extension TextBlock {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(bbox, forKey: .bbox)
        try container.encode(text, forKey: .text)
    }
}

extension SlideChangeData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(device, forKey: .device)
        try container.encode(eventID, forKey: .eventID)
        try container.encode(sessionID, forKey: .sessionID)
        try container.encode(slideID, forKey: .slideID)
        try container.encode(slideIndex, forKey: .slideIndex)
        try container.encode(tMS, forKey: .tMS)
    }
}

extension SlideChangeOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension SlideDeck {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(id, forKey: .id)
        try container.encode(ingestState, forKey: .ingestState)
        try container.encode(moduleID, forKey: .moduleID)
        try container.encode(pageCount, forKey: .pageCount)
        try container.encode(sessionID, forKey: .sessionID)
        try container.encode(sha256, forKey: .sha256)
        try container.encode(title, forKey: .title)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(uploadedAt, forKey: .uploadedAt)
        try container.encode(userID, forKey: .userID)
    }
}

extension SlideDeckDetail {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(deck, forKey: .deck)
        try container.encode(slides, forKey: .slides)
    }
}

extension SlideDeckList {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(items, forKey: .items)
        try container.encode(nextCursor, forKey: .nextCursor)
    }
}

extension SlideDeckUpdate {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(title, forKey: .title)
    }
}

extension StampElement {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(elementID, forKey: .elementID)
        try container.encode(frame, forKey: .frame)
        try container.encode(kind, forKey: .kind)
        try container.encode(payload, forKey: .payload)
        try container.encode(tMS, forKey: .tMS)
        try container.encode(z, forKey: .z)
    }
}

extension StampElementPayload {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(markerID, forKey: .markerID)
        try container.encode(markerKind, forKey: .markerKind)
    }
}

extension StrokeAddData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(pageID, forKey: .pageID)
        try container.encode(stroke, forKey: .stroke)
    }
}

extension StrokeAddOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension StrokeRemoveData {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(clientIDS, forKey: .clientIDS)
        try container.encode(pageID, forKey: .pageID)
    }
}

extension StrokeRemoveOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension SyncACK {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(opID, forKey: .opID)
        try container.encode(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension SyncStreamPosition {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(lastOpID, forKey: .lastOpID)
        try container.encode(lastSeq, forKey: .lastSeq)
        try container.encode(stream, forKey: .stream)
    }
}

extension SyncConnectionEvent {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(data, forKey: .data)
        try container.encode(name, forKey: .name)
        try container.encode(type, forKey: .type)
    }
}

extension SyncConnectionInfo {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(client, forKey: .client)
        try container.encode(connected, forKey: .connected)
        try container.encode(deviceID, forKey: .deviceID)
    }
}

extension SyncError {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(code, forKey: .code)
        try container.encodeIfPresent(details, forKey: .details)
        try container.encode(fatal, forKey: .fatal)
        try container.encode(message, forKey: .message)
        try container.encodeIfPresent(opID, forKey: .opID)
        try container.encode(retryable, forKey: .retryable)
        try container.encodeIfPresent(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension SyncEvent {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(data, forKey: .data)
        try container.encode(name, forKey: .name)
        try container.encode(type, forKey: .type)
    }
}

extension SyncHello {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(appVersion, forKey: .appVersion)
        try container.encode(client, forKey: .client)
        try container.encodeIfPresent(deviceID, forKey: .deviceID)
        try container.encode(syncHelloProtocol, forKey: .syncHelloProtocol)
        try container.encode(streams, forKey: .streams)
        try container.encode(type, forKey: .type)
    }
}

extension SyncOp {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(at, forKey: .at)
        try container.encode(clockUncertain, forKey: .clockUncertain)
        try container.encode(data, forKey: .data)
        try container.encode(kind, forKey: .kind)
        try container.encode(opID, forKey: .opID)
        try container.encodeIfPresent(origin, forKey: .origin)
        try container.encodeIfPresent(seq, forKey: .seq)
        try container.encode(stream, forKey: .stream)
        try container.encode(type, forKey: .type)
    }
}

extension SyncPairingEvent {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(data, forKey: .data)
        try container.encode(name, forKey: .name)
        try container.encode(type, forKey: .type)
    }
}

extension SyncPing {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
    }
}

extension SyncPong {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
    }
}

extension SyncPresence {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(notebookID, forKey: .notebookID)
        try container.encode(pageID, forKey: .pageID)
        try container.encode(sessionID, forKey: .sessionID)
        try container.encode(type, forKey: .type)
    }
}

extension SyncPresenceEvent {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(data, forKey: .data)
        try container.encode(name, forKey: .name)
        try container.encode(type, forKey: .type)
    }
}

extension SyncPresenceInfo {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(client, forKey: .client)
        try container.encode(deviceID, forKey: .deviceID)
        try container.encode(deviceName, forKey: .deviceName)
        try container.encode(notebookID, forKey: .notebookID)
        try container.encode(pageID, forKey: .pageID)
        try container.encode(sessionID, forKey: .sessionID)
    }
}

extension SyncResume {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(fromSeq, forKey: .fromSeq)
        try container.encode(headSeq, forKey: .headSeq)
        try container.encode(reset, forKey: .reset)
        try container.encode(stream, forKey: .stream)
    }
}

extension SyncSessionUpdatedEvent {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(data, forKey: .data)
        try container.encode(name, forKey: .name)
        try container.encode(type, forKey: .type)
    }
}

extension SyncSubscribe {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(streams, forKey: .streams)
        try container.encode(type, forKey: .type)
    }
}

extension SyncSubscribed {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(resume, forKey: .resume)
        try container.encode(type, forKey: .type)
    }
}

extension SyncTimeOffset {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(offsetMS, forKey: .offsetMS)
        try container.encode(rttMS, forKey: .rttMS)
        try container.encode(type, forKey: .type)
    }
}

extension SyncTimePing {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(t0, forKey: .t0)
        try container.encode(type, forKey: .type)
    }
}

extension SyncTimePong {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(t0, forKey: .t0)
        try container.encode(ts, forKey: .ts)
        try container.encode(type, forKey: .type)
    }
}

extension SyncUnsubscribe {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(streams, forKey: .streams)
        try container.encode(type, forKey: .type)
    }
}

extension SyncWelcome {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(dbEpoch, forKey: .dbEpoch)
        try container.encode(deviceID, forKey: .deviceID)
        try container.encode(syncWelcomeProtocol, forKey: .syncWelcomeProtocol)
        try container.encode(resume, forKey: .resume)
        try container.encode(serverTime, forKey: .serverTime)
        try container.encode(serverVersion, forKey: .serverVersion)
        try container.encode(type, forKey: .type)
    }
}

extension TapeElement {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(elementID, forKey: .elementID)
        try container.encode(frame, forKey: .frame)
        try container.encode(kind, forKey: .kind)
        try container.encode(payload, forKey: .payload)
        try container.encode(tMS, forKey: .tMS)
        try container.encode(z, forKey: .z)
    }
}

extension TapeElementPayload {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(cardID, forKey: .cardID)
        try container.encode(color, forKey: .color)
        try container.encode(covered, forKey: .covered)
    }
}

extension Task {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(bbox, forKey: .bbox)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(id, forKey: .id)
        try container.encode(label, forKey: .label)
        try container.encode(pageIndex, forKey: .pageIndex)
        try container.encode(sheetID, forKey: .sheetID)
        try container.encode(solutionText, forKey: .solutionText)
        try container.encode(text, forKey: .text)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(userID, forKey: .userID)
    }
}

extension TextElement {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(elementID, forKey: .elementID)
        try container.encode(frame, forKey: .frame)
        try container.encode(kind, forKey: .kind)
        try container.encode(payload, forKey: .payload)
        try container.encode(tMS, forKey: .tMS)
        try container.encode(z, forKey: .z)
    }
}

extension TextElementPayload {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(size, forKey: .size)
        try container.encode(text, forKey: .text)
    }
}

extension TrashItem {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(deletedAt, forKey: .deletedAt)
        try container.encode(dependentCount, forKey: .dependentCount)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        try container.encode(parent, forKey: .parent)
        try container.encode(purgeAt, forKey: .purgeAt)
        try container.encode(title, forKey: .title)
    }
}

extension TrashParent {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        try container.encode(title, forKey: .title)
    }
}

extension TrashList {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(items, forKey: .items)
        try container.encode(nextCursor, forKey: .nextCursor)
    }
}

extension TrashRestoreResult {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        try container.encode(restoredCount, forKey: .restoredCount)
    }
}

extension UploadResult {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(duplicate, forKey: .duplicate)
        try container.encode(id, forKey: .id)
    }
}
