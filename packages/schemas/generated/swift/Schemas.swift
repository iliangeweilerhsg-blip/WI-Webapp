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
    let bBox: [Double]?
    let exerciseSheet: ExerciseSheet?
    let exerciseSheetList: ExerciseSheetList?
    let exerciseSheetUpdate: ExerciseSheetUpdate?
    let health: Health?
    let ingestState: IngestState?
    let isoDate: String?
    let job: Job?
    let jobList: JobList?
    let jobState: JobState?
    let jobType: JobType?
    let lang: Lang?
    let module: Module?
    let moduleColor: ModuleColor?
    let moduleCreate: ModuleCreate?
    let moduleList: ModuleList?
    let moduleUpdate: ModuleUpdate?
    let moodleActionCatalog: MoodleActionCatalog?
    let moodleActionExecute: MoodleActionExecute?
    let moodleActionID: MoodleActionID?
    let moodleActionInfo: MoodleActionInfo?
    let moodleActionParamsAssignSaveDraft: MoodleActionParamsAssignSaveDraft?
    let moodleActionParamsAssignSubmit: MoodleActionParamsAssignSubmit?
    let moodleActionParamsCalendarCreateEvent: MoodleActionParamsCalendarCreateEvent?
    let moodleActionParamsCompletionSet: MoodleActionParamsCompletionSet?
    let moodleActionParamsFilesUploadPrivate: MoodleActionParamsFilesUploadPrivate?
    let moodleActionParamsForumCreateDiscussion: MoodleActionParamsForumCreateDiscussion?
    let moodleActionParamsForumReply: MoodleActionParamsForumReply?
    let moodleActionParamsMessageSend: MoodleActionParamsMessageSend?
    let moodleActionPreview: MoodleActionPreview?
    let moodleActionRequest: MoodleActionRequest?
    let moodleActionResult: MoodleActionResult?
    let moodleActionRisk: MoodleActionRisk?
    let moodleActivity: MoodleActivity?
    let moodleAssignment: MoodleAssignment?
    let moodleAssignmentList: MoodleAssignmentList?
    let moodleCompletion: MoodleCompletion?
    let moodleConnectionState: MoodleConnectionState?
    let moodleCourse: MoodleCourse?
    let moodleCourseContents: MoodleCourseContents?
    let moodleCourseList: MoodleCourseList?
    let moodleDeadline: MoodleDeadline?
    let moodleDeadlineList: MoodleDeadlineList?
    let moodleDiscussion: MoodleDiscussion?
    let moodleDiscussionList: MoodleDiscussionList?
    let moodleFile: MoodleFile?
    let moodleForum: MoodleForum?
    let moodleForumList: MoodleForumList?
    let moodleGradeItem: MoodleGradeItem?
    let moodleGradeList: MoodleGradeList?
    let moodleNotification: MoodleNotification?
    let moodleNotificationList: MoodleNotificationList?
    let moodlePost: MoodlePost?
    let moodlePostList: MoodlePostList?
    let moodleQuiz: MoodleQuiz?
    let moodleQuizList: MoodleQuizList?
    let moodleSection: MoodleSection?
    let moodleStatus: MoodleStatus?
    let moodleSubmissionState: MoodleSubmissionState?
    let moodleSubmissionStatus: MoodleSubmissionStatus?
    let moodleUpload: MoodleUpload?
    let pdfIngestDeckPayload: PDFIngestDeckPayload?
    let pdfIngestPayload: PDFIngestPayload?
    let pdfIngestResult: PDFIngestResult?
    let pdfIngestSheetPayload: PDFIngestSheetPayload?
    let semester: Semester?
    let semesterCreate: SemesterCreate?
    let semesterList: SemesterList?
    let semesterUpdate: SemesterUpdate?
    let slide: Slide?
    let slideDeck: SlideDeck?
    let slideDeckDetail: SlideDeckDetail?
    let slideDeckList: SlideDeckList?
    let slideDeckUpdate: SlideDeckUpdate?
    let task: Task?
    let textBlock: TextBlock?
    let timestamp: Date?
    let uploadResult: UploadResult?
    let uuid: String?

    enum CodingKeys: String, CodingKey {
        case apiError = "ApiError"
        case apiErrorBody = "ApiErrorBody"
        case bBox = "BBox"
        case exerciseSheet = "ExerciseSheet"
        case exerciseSheetList = "ExerciseSheetList"
        case exerciseSheetUpdate = "ExerciseSheetUpdate"
        case health = "Health"
        case ingestState = "IngestState"
        case isoDate = "IsoDate"
        case job = "Job"
        case jobList = "JobList"
        case jobState = "JobState"
        case jobType = "JobType"
        case lang = "Lang"
        case module = "Module"
        case moduleColor = "ModuleColor"
        case moduleCreate = "ModuleCreate"
        case moduleList = "ModuleList"
        case moduleUpdate = "ModuleUpdate"
        case moodleActionCatalog = "MoodleActionCatalog"
        case moodleActionExecute = "MoodleActionExecute"
        case moodleActionID = "MoodleActionId"
        case moodleActionInfo = "MoodleActionInfo"
        case moodleActionParamsAssignSaveDraft = "MoodleActionParamsAssignSaveDraft"
        case moodleActionParamsAssignSubmit = "MoodleActionParamsAssignSubmit"
        case moodleActionParamsCalendarCreateEvent = "MoodleActionParamsCalendarCreateEvent"
        case moodleActionParamsCompletionSet = "MoodleActionParamsCompletionSet"
        case moodleActionParamsFilesUploadPrivate = "MoodleActionParamsFilesUploadPrivate"
        case moodleActionParamsForumCreateDiscussion = "MoodleActionParamsForumCreateDiscussion"
        case moodleActionParamsForumReply = "MoodleActionParamsForumReply"
        case moodleActionParamsMessageSend = "MoodleActionParamsMessageSend"
        case moodleActionPreview = "MoodleActionPreview"
        case moodleActionRequest = "MoodleActionRequest"
        case moodleActionResult = "MoodleActionResult"
        case moodleActionRisk = "MoodleActionRisk"
        case moodleActivity = "MoodleActivity"
        case moodleAssignment = "MoodleAssignment"
        case moodleAssignmentList = "MoodleAssignmentList"
        case moodleCompletion = "MoodleCompletion"
        case moodleConnectionState = "MoodleConnectionState"
        case moodleCourse = "MoodleCourse"
        case moodleCourseContents = "MoodleCourseContents"
        case moodleCourseList = "MoodleCourseList"
        case moodleDeadline = "MoodleDeadline"
        case moodleDeadlineList = "MoodleDeadlineList"
        case moodleDiscussion = "MoodleDiscussion"
        case moodleDiscussionList = "MoodleDiscussionList"
        case moodleFile = "MoodleFile"
        case moodleForum = "MoodleForum"
        case moodleForumList = "MoodleForumList"
        case moodleGradeItem = "MoodleGradeItem"
        case moodleGradeList = "MoodleGradeList"
        case moodleNotification = "MoodleNotification"
        case moodleNotificationList = "MoodleNotificationList"
        case moodlePost = "MoodlePost"
        case moodlePostList = "MoodlePostList"
        case moodleQuiz = "MoodleQuiz"
        case moodleQuizList = "MoodleQuizList"
        case moodleSection = "MoodleSection"
        case moodleStatus = "MoodleStatus"
        case moodleSubmissionState = "MoodleSubmissionState"
        case moodleSubmissionStatus = "MoodleSubmissionStatus"
        case moodleUpload = "MoodleUpload"
        case pdfIngestDeckPayload = "PdfIngestDeckPayload"
        case pdfIngestPayload = "PdfIngestPayload"
        case pdfIngestResult = "PdfIngestResult"
        case pdfIngestSheetPayload = "PdfIngestSheetPayload"
        case semester = "Semester"
        case semesterCreate = "SemesterCreate"
        case semesterList = "SemesterList"
        case semesterUpdate = "SemesterUpdate"
        case slide = "Slide"
        case slideDeck = "SlideDeck"
        case slideDeckDetail = "SlideDeckDetail"
        case slideDeckList = "SlideDeckList"
        case slideDeckUpdate = "SlideDeckUpdate"
        case task = "Task"
        case textBlock = "TextBlock"
        case timestamp = "Timestamp"
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
        bBox: [Double]?? = nil,
        exerciseSheet: ExerciseSheet?? = nil,
        exerciseSheetList: ExerciseSheetList?? = nil,
        exerciseSheetUpdate: ExerciseSheetUpdate?? = nil,
        health: Health?? = nil,
        ingestState: IngestState?? = nil,
        isoDate: String?? = nil,
        job: Job?? = nil,
        jobList: JobList?? = nil,
        jobState: JobState?? = nil,
        jobType: JobType?? = nil,
        lang: Lang?? = nil,
        module: Module?? = nil,
        moduleColor: ModuleColor?? = nil,
        moduleCreate: ModuleCreate?? = nil,
        moduleList: ModuleList?? = nil,
        moduleUpdate: ModuleUpdate?? = nil,
        moodleActionCatalog: MoodleActionCatalog?? = nil,
        moodleActionExecute: MoodleActionExecute?? = nil,
        moodleActionID: MoodleActionID?? = nil,
        moodleActionInfo: MoodleActionInfo?? = nil,
        moodleActionParamsAssignSaveDraft: MoodleActionParamsAssignSaveDraft?? = nil,
        moodleActionParamsAssignSubmit: MoodleActionParamsAssignSubmit?? = nil,
        moodleActionParamsCalendarCreateEvent: MoodleActionParamsCalendarCreateEvent?? = nil,
        moodleActionParamsCompletionSet: MoodleActionParamsCompletionSet?? = nil,
        moodleActionParamsFilesUploadPrivate: MoodleActionParamsFilesUploadPrivate?? = nil,
        moodleActionParamsForumCreateDiscussion: MoodleActionParamsForumCreateDiscussion?? = nil,
        moodleActionParamsForumReply: MoodleActionParamsForumReply?? = nil,
        moodleActionParamsMessageSend: MoodleActionParamsMessageSend?? = nil,
        moodleActionPreview: MoodleActionPreview?? = nil,
        moodleActionRequest: MoodleActionRequest?? = nil,
        moodleActionResult: MoodleActionResult?? = nil,
        moodleActionRisk: MoodleActionRisk?? = nil,
        moodleActivity: MoodleActivity?? = nil,
        moodleAssignment: MoodleAssignment?? = nil,
        moodleAssignmentList: MoodleAssignmentList?? = nil,
        moodleCompletion: MoodleCompletion?? = nil,
        moodleConnectionState: MoodleConnectionState?? = nil,
        moodleCourse: MoodleCourse?? = nil,
        moodleCourseContents: MoodleCourseContents?? = nil,
        moodleCourseList: MoodleCourseList?? = nil,
        moodleDeadline: MoodleDeadline?? = nil,
        moodleDeadlineList: MoodleDeadlineList?? = nil,
        moodleDiscussion: MoodleDiscussion?? = nil,
        moodleDiscussionList: MoodleDiscussionList?? = nil,
        moodleFile: MoodleFile?? = nil,
        moodleForum: MoodleForum?? = nil,
        moodleForumList: MoodleForumList?? = nil,
        moodleGradeItem: MoodleGradeItem?? = nil,
        moodleGradeList: MoodleGradeList?? = nil,
        moodleNotification: MoodleNotification?? = nil,
        moodleNotificationList: MoodleNotificationList?? = nil,
        moodlePost: MoodlePost?? = nil,
        moodlePostList: MoodlePostList?? = nil,
        moodleQuiz: MoodleQuiz?? = nil,
        moodleQuizList: MoodleQuizList?? = nil,
        moodleSection: MoodleSection?? = nil,
        moodleStatus: MoodleStatus?? = nil,
        moodleSubmissionState: MoodleSubmissionState?? = nil,
        moodleSubmissionStatus: MoodleSubmissionStatus?? = nil,
        moodleUpload: MoodleUpload?? = nil,
        pdfIngestDeckPayload: PDFIngestDeckPayload?? = nil,
        pdfIngestPayload: PDFIngestPayload?? = nil,
        pdfIngestResult: PDFIngestResult?? = nil,
        pdfIngestSheetPayload: PDFIngestSheetPayload?? = nil,
        semester: Semester?? = nil,
        semesterCreate: SemesterCreate?? = nil,
        semesterList: SemesterList?? = nil,
        semesterUpdate: SemesterUpdate?? = nil,
        slide: Slide?? = nil,
        slideDeck: SlideDeck?? = nil,
        slideDeckDetail: SlideDeckDetail?? = nil,
        slideDeckList: SlideDeckList?? = nil,
        slideDeckUpdate: SlideDeckUpdate?? = nil,
        task: Task?? = nil,
        textBlock: TextBlock?? = nil,
        timestamp: Date?? = nil,
        uploadResult: UploadResult?? = nil,
        uuid: String?? = nil
    ) -> SchemaBundle {
        return SchemaBundle(
            apiError: apiError ?? self.apiError,
            apiErrorBody: apiErrorBody ?? self.apiErrorBody,
            bBox: bBox ?? self.bBox,
            exerciseSheet: exerciseSheet ?? self.exerciseSheet,
            exerciseSheetList: exerciseSheetList ?? self.exerciseSheetList,
            exerciseSheetUpdate: exerciseSheetUpdate ?? self.exerciseSheetUpdate,
            health: health ?? self.health,
            ingestState: ingestState ?? self.ingestState,
            isoDate: isoDate ?? self.isoDate,
            job: job ?? self.job,
            jobList: jobList ?? self.jobList,
            jobState: jobState ?? self.jobState,
            jobType: jobType ?? self.jobType,
            lang: lang ?? self.lang,
            module: module ?? self.module,
            moduleColor: moduleColor ?? self.moduleColor,
            moduleCreate: moduleCreate ?? self.moduleCreate,
            moduleList: moduleList ?? self.moduleList,
            moduleUpdate: moduleUpdate ?? self.moduleUpdate,
            moodleActionCatalog: moodleActionCatalog ?? self.moodleActionCatalog,
            moodleActionExecute: moodleActionExecute ?? self.moodleActionExecute,
            moodleActionID: moodleActionID ?? self.moodleActionID,
            moodleActionInfo: moodleActionInfo ?? self.moodleActionInfo,
            moodleActionParamsAssignSaveDraft: moodleActionParamsAssignSaveDraft ?? self.moodleActionParamsAssignSaveDraft,
            moodleActionParamsAssignSubmit: moodleActionParamsAssignSubmit ?? self.moodleActionParamsAssignSubmit,
            moodleActionParamsCalendarCreateEvent: moodleActionParamsCalendarCreateEvent ?? self.moodleActionParamsCalendarCreateEvent,
            moodleActionParamsCompletionSet: moodleActionParamsCompletionSet ?? self.moodleActionParamsCompletionSet,
            moodleActionParamsFilesUploadPrivate: moodleActionParamsFilesUploadPrivate ?? self.moodleActionParamsFilesUploadPrivate,
            moodleActionParamsForumCreateDiscussion: moodleActionParamsForumCreateDiscussion ?? self.moodleActionParamsForumCreateDiscussion,
            moodleActionParamsForumReply: moodleActionParamsForumReply ?? self.moodleActionParamsForumReply,
            moodleActionParamsMessageSend: moodleActionParamsMessageSend ?? self.moodleActionParamsMessageSend,
            moodleActionPreview: moodleActionPreview ?? self.moodleActionPreview,
            moodleActionRequest: moodleActionRequest ?? self.moodleActionRequest,
            moodleActionResult: moodleActionResult ?? self.moodleActionResult,
            moodleActionRisk: moodleActionRisk ?? self.moodleActionRisk,
            moodleActivity: moodleActivity ?? self.moodleActivity,
            moodleAssignment: moodleAssignment ?? self.moodleAssignment,
            moodleAssignmentList: moodleAssignmentList ?? self.moodleAssignmentList,
            moodleCompletion: moodleCompletion ?? self.moodleCompletion,
            moodleConnectionState: moodleConnectionState ?? self.moodleConnectionState,
            moodleCourse: moodleCourse ?? self.moodleCourse,
            moodleCourseContents: moodleCourseContents ?? self.moodleCourseContents,
            moodleCourseList: moodleCourseList ?? self.moodleCourseList,
            moodleDeadline: moodleDeadline ?? self.moodleDeadline,
            moodleDeadlineList: moodleDeadlineList ?? self.moodleDeadlineList,
            moodleDiscussion: moodleDiscussion ?? self.moodleDiscussion,
            moodleDiscussionList: moodleDiscussionList ?? self.moodleDiscussionList,
            moodleFile: moodleFile ?? self.moodleFile,
            moodleForum: moodleForum ?? self.moodleForum,
            moodleForumList: moodleForumList ?? self.moodleForumList,
            moodleGradeItem: moodleGradeItem ?? self.moodleGradeItem,
            moodleGradeList: moodleGradeList ?? self.moodleGradeList,
            moodleNotification: moodleNotification ?? self.moodleNotification,
            moodleNotificationList: moodleNotificationList ?? self.moodleNotificationList,
            moodlePost: moodlePost ?? self.moodlePost,
            moodlePostList: moodlePostList ?? self.moodlePostList,
            moodleQuiz: moodleQuiz ?? self.moodleQuiz,
            moodleQuizList: moodleQuizList ?? self.moodleQuizList,
            moodleSection: moodleSection ?? self.moodleSection,
            moodleStatus: moodleStatus ?? self.moodleStatus,
            moodleSubmissionState: moodleSubmissionState ?? self.moodleSubmissionState,
            moodleSubmissionStatus: moodleSubmissionStatus ?? self.moodleSubmissionStatus,
            moodleUpload: moodleUpload ?? self.moodleUpload,
            pdfIngestDeckPayload: pdfIngestDeckPayload ?? self.pdfIngestDeckPayload,
            pdfIngestPayload: pdfIngestPayload ?? self.pdfIngestPayload,
            pdfIngestResult: pdfIngestResult ?? self.pdfIngestResult,
            pdfIngestSheetPayload: pdfIngestSheetPayload ?? self.pdfIngestSheetPayload,
            semester: semester ?? self.semester,
            semesterCreate: semesterCreate ?? self.semesterCreate,
            semesterList: semesterList ?? self.semesterList,
            semesterUpdate: semesterUpdate ?? self.semesterUpdate,
            slide: slide ?? self.slide,
            slideDeck: slideDeck ?? self.slideDeck,
            slideDeckDetail: slideDeckDetail ?? self.slideDeckDetail,
            slideDeckList: slideDeckList ?? self.slideDeckList,
            slideDeckUpdate: slideDeckUpdate ?? self.slideDeckUpdate,
            task: task ?? self.task,
            textBlock: textBlock ?? self.textBlock,
            timestamp: timestamp ?? self.timestamp,
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

enum Lang: String, Codable {
    case de = "de"
    case en = "en"
    case mixed = "mixed"
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

/// Antwort von GET /moodle/actions
// MARK: - MoodleActionCatalog
struct MoodleActionCatalog: Codable {
    let items: [MoodleActionInfo]

    enum CodingKeys: String, CodingKey {
        case items = "items"
    }
}

// MARK: MoodleActionCatalog convenience initializers and mutators

extension MoodleActionCatalog {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleActionCatalog.self, from: data)
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
        items: [MoodleActionInfo]? = nil
    ) -> MoodleActionCatalog {
        return MoodleActionCatalog(
            items: items ?? self.items
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - MoodleActionInfo
struct MoodleActionInfo: Codable {
    /// false = nötige wsfunction für den Token nicht freigegeben
    let available: Bool
    let description: String
    let id: MoodleActionID
    let label: String
    let needsConfirmation: Bool
    let risk: MoodleActionRisk

    enum CodingKeys: String, CodingKey {
        case available = "available"
        case description = "description"
        case id = "id"
        case label = "label"
        case needsConfirmation = "needs_confirmation"
        case risk = "risk"
    }
}

// MARK: MoodleActionInfo convenience initializers and mutators

extension MoodleActionInfo {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleActionInfo.self, from: data)
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
        available: Bool? = nil,
        description: String? = nil,
        id: MoodleActionID? = nil,
        label: String? = nil,
        needsConfirmation: Bool? = nil,
        risk: MoodleActionRisk? = nil
    ) -> MoodleActionInfo {
        return MoodleActionInfo(
            available: available ?? self.available,
            description: description ?? self.description,
            id: id ?? self.id,
            label: label ?? self.label,
            needsConfirmation: needsConfirmation ?? self.needsConfirmation,
            risk: risk ?? self.risk
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Aktionskatalog (F-MDL-05, 08 §9.3)
enum MoodleActionID: String, Codable {
    case assignSaveDraft = "assign.save_draft"
    case assignSubmit = "assign.submit"
    case calendarCreateEvent = "calendar.create_event"
    case completionSet = "completion.set"
    case filesUploadPrivate = "files.upload_private"
    case forumCreateDiscussion = "forum.create_discussion"
    case forumReply = "forum.reply"
    case messageSend = "message.send"
    case notificationsMarkRead = "notifications.mark_read"
}

/// endgueltig und oeffentlich brauchen eine Bestätigung (F-MDL-06)
enum MoodleActionRisk: String, Codable {
    case aenderbar = "aenderbar"
    case endgueltig = "endgueltig"
    case harmlos = "harmlos"
    case oeffentlich = "oeffentlich"
}

/// Body von POST /moodle/actions/{action_id}/execute
// MARK: - MoodleActionExecute
struct MoodleActionExecute: Codable {
    let confirmationToken: String?
    let params: [String: JSONAny]

    enum CodingKeys: String, CodingKey {
        case confirmationToken = "confirmation_token"
        case params = "params"
    }
}

// MARK: MoodleActionExecute convenience initializers and mutators

extension MoodleActionExecute {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleActionExecute.self, from: data)
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
        confirmationToken: String?? = nil,
        params: [String: JSONAny]? = nil
    ) -> MoodleActionExecute {
        return MoodleActionExecute(
            confirmationToken: confirmationToken ?? self.confirmationToken,
            params: params ?? self.params
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// assign.save_draft: mindestens upload_ids oder online_text_html
// MARK: - MoodleActionParamsAssignSaveDraft
struct MoodleActionParamsAssignSaveDraft: Codable {
    /// Moodle-ID
    let assignmentID: Int
    let onlineTextHTML: String?
    let uploadIDS: [String]?

    enum CodingKeys: String, CodingKey {
        case assignmentID = "assignment_id"
        case onlineTextHTML = "online_text_html"
        case uploadIDS = "upload_ids"
    }
}

// MARK: MoodleActionParamsAssignSaveDraft convenience initializers and mutators

extension MoodleActionParamsAssignSaveDraft {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleActionParamsAssignSaveDraft.self, from: data)
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
        assignmentID: Int? = nil,
        onlineTextHTML: String?? = nil,
        uploadIDS: [String]?? = nil
    ) -> MoodleActionParamsAssignSaveDraft {
        return MoodleActionParamsAssignSaveDraft(
            assignmentID: assignmentID ?? self.assignmentID,
            onlineTextHTML: onlineTextHTML ?? self.onlineTextHTML,
            uploadIDS: uploadIDS ?? self.uploadIDS
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// assign.submit
// MARK: - MoodleActionParamsAssignSubmit
struct MoodleActionParamsAssignSubmit: Codable {
    let acceptStatement: Bool
    /// Moodle-ID
    let assignmentID: Int

    enum CodingKeys: String, CodingKey {
        case acceptStatement = "accept_statement"
        case assignmentID = "assignment_id"
    }
}

// MARK: MoodleActionParamsAssignSubmit convenience initializers and mutators

extension MoodleActionParamsAssignSubmit {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleActionParamsAssignSubmit.self, from: data)
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
        acceptStatement: Bool? = nil,
        assignmentID: Int? = nil
    ) -> MoodleActionParamsAssignSubmit {
        return MoodleActionParamsAssignSubmit(
            acceptStatement: acceptStatement ?? self.acceptStatement,
            assignmentID: assignmentID ?? self.assignmentID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// calendar.create_event (Nutzertermin)
// MARK: - MoodleActionParamsCalendarCreateEvent
struct MoodleActionParamsCalendarCreateEvent: Codable {
    let descriptionHTML: String?
    let durationMinutes: Int?
    let name: String
    let startAt: Date

    enum CodingKeys: String, CodingKey {
        case descriptionHTML = "description_html"
        case durationMinutes = "duration_minutes"
        case name = "name"
        case startAt = "start_at"
    }
}

// MARK: MoodleActionParamsCalendarCreateEvent convenience initializers and mutators

extension MoodleActionParamsCalendarCreateEvent {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleActionParamsCalendarCreateEvent.self, from: data)
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
        descriptionHTML: String?? = nil,
        durationMinutes: Int?? = nil,
        name: String? = nil,
        startAt: Date? = nil
    ) -> MoodleActionParamsCalendarCreateEvent {
        return MoodleActionParamsCalendarCreateEvent(
            descriptionHTML: descriptionHTML ?? self.descriptionHTML,
            durationMinutes: durationMinutes ?? self.durationMinutes,
            name: name ?? self.name,
            startAt: startAt ?? self.startAt
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// completion.set
// MARK: - MoodleActionParamsCompletionSet
struct MoodleActionParamsCompletionSet: Codable {
    /// Moodle-ID
    let cmid: Int
    let completed: Bool

    enum CodingKeys: String, CodingKey {
        case cmid = "cmid"
        case completed = "completed"
    }
}

// MARK: MoodleActionParamsCompletionSet convenience initializers and mutators

extension MoodleActionParamsCompletionSet {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleActionParamsCompletionSet.self, from: data)
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
        cmid: Int? = nil,
        completed: Bool? = nil
    ) -> MoodleActionParamsCompletionSet {
        return MoodleActionParamsCompletionSet(
            cmid: cmid ?? self.cmid,
            completed: completed ?? self.completed
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// files.upload_private
// MARK: - MoodleActionParamsFilesUploadPrivate
struct MoodleActionParamsFilesUploadPrivate: Codable {
    let uploadIDS: [String]

    enum CodingKeys: String, CodingKey {
        case uploadIDS = "upload_ids"
    }
}

// MARK: MoodleActionParamsFilesUploadPrivate convenience initializers and mutators

extension MoodleActionParamsFilesUploadPrivate {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleActionParamsFilesUploadPrivate.self, from: data)
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
        uploadIDS: [String]? = nil
    ) -> MoodleActionParamsFilesUploadPrivate {
        return MoodleActionParamsFilesUploadPrivate(
            uploadIDS: uploadIDS ?? self.uploadIDS
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// forum.create_discussion
// MARK: - MoodleActionParamsForumCreateDiscussion
struct MoodleActionParamsForumCreateDiscussion: Codable {
    /// Moodle-ID
    let forumID: Int
    let messageHTML: String
    let subject: String
    let uploadIDS: [String]?

    enum CodingKeys: String, CodingKey {
        case forumID = "forum_id"
        case messageHTML = "message_html"
        case subject = "subject"
        case uploadIDS = "upload_ids"
    }
}

// MARK: MoodleActionParamsForumCreateDiscussion convenience initializers and mutators

extension MoodleActionParamsForumCreateDiscussion {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleActionParamsForumCreateDiscussion.self, from: data)
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
        forumID: Int? = nil,
        messageHTML: String? = nil,
        subject: String? = nil,
        uploadIDS: [String]?? = nil
    ) -> MoodleActionParamsForumCreateDiscussion {
        return MoodleActionParamsForumCreateDiscussion(
            forumID: forumID ?? self.forumID,
            messageHTML: messageHTML ?? self.messageHTML,
            subject: subject ?? self.subject,
            uploadIDS: uploadIDS ?? self.uploadIDS
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// forum.reply
// MARK: - MoodleActionParamsForumReply
struct MoodleActionParamsForumReply: Codable {
    let messageHTML: String
    /// Moodle-ID
    let postID: Int
    let subject: String?
    let uploadIDS: [String]?

    enum CodingKeys: String, CodingKey {
        case messageHTML = "message_html"
        case postID = "post_id"
        case subject = "subject"
        case uploadIDS = "upload_ids"
    }
}

// MARK: MoodleActionParamsForumReply convenience initializers and mutators

extension MoodleActionParamsForumReply {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleActionParamsForumReply.self, from: data)
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
        messageHTML: String? = nil,
        postID: Int? = nil,
        subject: String?? = nil,
        uploadIDS: [String]?? = nil
    ) -> MoodleActionParamsForumReply {
        return MoodleActionParamsForumReply(
            messageHTML: messageHTML ?? self.messageHTML,
            postID: postID ?? self.postID,
            subject: subject ?? self.subject,
            uploadIDS: uploadIDS ?? self.uploadIDS
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// message.send
// MARK: - MoodleActionParamsMessageSend
struct MoodleActionParamsMessageSend: Codable {
    let text: String
    /// Moodle-ID
    let toUserID: Int

    enum CodingKeys: String, CodingKey {
        case text = "text"
        case toUserID = "to_user_id"
    }
}

// MARK: MoodleActionParamsMessageSend convenience initializers and mutators

extension MoodleActionParamsMessageSend {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleActionParamsMessageSend.self, from: data)
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
        text: String? = nil,
        toUserID: Int? = nil
    ) -> MoodleActionParamsMessageSend {
        return MoodleActionParamsMessageSend(
            text: text ?? self.text,
            toUserID: toUserID ?? self.toUserID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Antwort der Vorschau. confirmation_token nur bei needs_confirmation
// MARK: - MoodleActionPreview
struct MoodleActionPreview: Codable {
    let actionID: MoodleActionID
    let confirmationToken: String?
    let details: [String: JSONAny]
    let expiresAt: Date?
    let needsConfirmation: Bool
    let risk: MoodleActionRisk
    /// Ein Satz in Klartext, was passieren wird
    let summary: String
    let warnings: [String]

    enum CodingKeys: String, CodingKey {
        case actionID = "action_id"
        case confirmationToken = "confirmation_token"
        case details = "details"
        case expiresAt = "expires_at"
        case needsConfirmation = "needs_confirmation"
        case risk = "risk"
        case summary = "summary"
        case warnings = "warnings"
    }
}

// MARK: MoodleActionPreview convenience initializers and mutators

extension MoodleActionPreview {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleActionPreview.self, from: data)
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
        actionID: MoodleActionID? = nil,
        confirmationToken: String?? = nil,
        details: [String: JSONAny]? = nil,
        expiresAt: Date?? = nil,
        needsConfirmation: Bool? = nil,
        risk: MoodleActionRisk? = nil,
        summary: String? = nil,
        warnings: [String]? = nil
    ) -> MoodleActionPreview {
        return MoodleActionPreview(
            actionID: actionID ?? self.actionID,
            confirmationToken: confirmationToken ?? self.confirmationToken,
            details: details ?? self.details,
            expiresAt: expiresAt ?? self.expiresAt,
            needsConfirmation: needsConfirmation ?? self.needsConfirmation,
            risk: risk ?? self.risk,
            summary: summary ?? self.summary,
            warnings: warnings ?? self.warnings
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Body von POST /moodle/actions/{action_id}/preview. params nach MoodleActionParams<Name>
// MARK: - MoodleActionRequest
struct MoodleActionRequest: Codable {
    let params: [String: JSONAny]

    enum CodingKeys: String, CodingKey {
        case params = "params"
    }
}

// MARK: MoodleActionRequest convenience initializers and mutators

extension MoodleActionRequest {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleActionRequest.self, from: data)
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
        params: [String: JSONAny]? = nil
    ) -> MoodleActionRequest {
        return MoodleActionRequest(
            params: params ?? self.params
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Antwort von execute bei Erfolg
// MARK: - MoodleActionResult
struct MoodleActionResult: Codable {
    let actionID: MoodleActionID
    let result: [String: JSONAny]
    let summary: String

    enum CodingKeys: String, CodingKey {
        case actionID = "action_id"
        case result = "result"
        case summary = "summary"
    }
}

// MARK: MoodleActionResult convenience initializers and mutators

extension MoodleActionResult {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleActionResult.self, from: data)
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
        actionID: MoodleActionID? = nil,
        result: [String: JSONAny]? = nil,
        summary: String? = nil
    ) -> MoodleActionResult {
        return MoodleActionResult(
            actionID: actionID ?? self.actionID,
            result: result ?? self.result,
            summary: summary ?? self.summary
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Element eines Kursabschnitts
// MARK: - MoodleActivity
struct MoodleActivity: Codable {
    /// Moodle-ID
    let cmid: Int
    let completion: MoodleCompletion?
    /// true = der Nutzer darf den Status selbst setzen (completion.set)
    let completionManual: Bool
    let descriptionHTML: String?
    let files: [MoodleFile]
    let instanceID: Int?
    let name: String
    /// Moodle-modname, z. B. resource, folder, assign, forum, quiz, url, page, label
    let type: String
    let url: String?
    let visible: Bool

    enum CodingKeys: String, CodingKey {
        case cmid = "cmid"
        case completion = "completion"
        case completionManual = "completion_manual"
        case descriptionHTML = "description_html"
        case files = "files"
        case instanceID = "instance_id"
        case name = "name"
        case type = "type"
        case url = "url"
        case visible = "visible"
    }
}

// MARK: MoodleActivity convenience initializers and mutators

extension MoodleActivity {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleActivity.self, from: data)
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
        cmid: Int? = nil,
        completion: MoodleCompletion?? = nil,
        completionManual: Bool? = nil,
        descriptionHTML: String?? = nil,
        files: [MoodleFile]? = nil,
        instanceID: Int?? = nil,
        name: String? = nil,
        type: String? = nil,
        url: String?? = nil,
        visible: Bool? = nil
    ) -> MoodleActivity {
        return MoodleActivity(
            cmid: cmid ?? self.cmid,
            completion: completion ?? self.completion,
            completionManual: completionManual ?? self.completionManual,
            descriptionHTML: descriptionHTML ?? self.descriptionHTML,
            files: files ?? self.files,
            instanceID: instanceID ?? self.instanceID,
            name: name ?? self.name,
            type: type ?? self.type,
            url: url ?? self.url,
            visible: visible ?? self.visible
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Erledigt-Status einer Aktivität
enum MoodleCompletion: String, Codable {
    case erledigt = "erledigt"
    case offen = "offen"
}

/// Datei in Moodle (Aktivität, Anhang, Abgabe)
// MARK: - MoodleFile
struct MoodleFile: Codable {
    let filename: String
    let mimeType: String?
    let modifiedAt: Date?
    /// Pfad hinter webservice/pluginfile.php, für GET /moodle/file?ref
    let ref: String
    let sizeBytes: Int

    enum CodingKeys: String, CodingKey {
        case filename = "filename"
        case mimeType = "mime_type"
        case modifiedAt = "modified_at"
        case ref = "ref"
        case sizeBytes = "size_bytes"
    }
}

// MARK: MoodleFile convenience initializers and mutators

extension MoodleFile {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleFile.self, from: data)
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
        filename: String? = nil,
        mimeType: String?? = nil,
        modifiedAt: Date?? = nil,
        ref: String? = nil,
        sizeBytes: Int? = nil
    ) -> MoodleFile {
        return MoodleFile(
            filename: filename ?? self.filename,
            mimeType: mimeType ?? self.mimeType,
            modifiedAt: modifiedAt ?? self.modifiedAt,
            ref: ref ?? self.ref,
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

/// Aufgabe mit Abgabe
// MARK: - MoodleAssignment
struct MoodleAssignment: Codable {
    /// Moodle-ID
    let cmid: Int
    /// Moodle-ID
    let courseID: Int
    let cutoffAt: Date?
    let dueAt: Date?
    let introFiles: [MoodleFile]
    let introHTML: String?
    /// Moodle-ID
    let moodleID: Int
    let name: String
    let opensAt: Date?
    /// Einreichen verlangt die Erklärung zur Eigenständigkeit (accept_statement)
    let requiresStatement: Bool
    /// true = Entwurf muss ausdrücklich eingereicht werden (assign.submit)
    let requiresSubmit: Bool
    let submissionTypes: [SubmissionType]

    enum CodingKeys: String, CodingKey {
        case cmid = "cmid"
        case courseID = "course_id"
        case cutoffAt = "cutoff_at"
        case dueAt = "due_at"
        case introFiles = "intro_files"
        case introHTML = "intro_html"
        case moodleID = "moodle_id"
        case name = "name"
        case opensAt = "opens_at"
        case requiresStatement = "requires_statement"
        case requiresSubmit = "requires_submit"
        case submissionTypes = "submission_types"
    }
}

// MARK: MoodleAssignment convenience initializers and mutators

extension MoodleAssignment {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleAssignment.self, from: data)
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
        cmid: Int? = nil,
        courseID: Int? = nil,
        cutoffAt: Date?? = nil,
        dueAt: Date?? = nil,
        introFiles: [MoodleFile]? = nil,
        introHTML: String?? = nil,
        moodleID: Int? = nil,
        name: String? = nil,
        opensAt: Date?? = nil,
        requiresStatement: Bool? = nil,
        requiresSubmit: Bool? = nil,
        submissionTypes: [SubmissionType]? = nil
    ) -> MoodleAssignment {
        return MoodleAssignment(
            cmid: cmid ?? self.cmid,
            courseID: courseID ?? self.courseID,
            cutoffAt: cutoffAt ?? self.cutoffAt,
            dueAt: dueAt ?? self.dueAt,
            introFiles: introFiles ?? self.introFiles,
            introHTML: introHTML ?? self.introHTML,
            moodleID: moodleID ?? self.moodleID,
            name: name ?? self.name,
            opensAt: opensAt ?? self.opensAt,
            requiresStatement: requiresStatement ?? self.requiresStatement,
            requiresSubmit: requiresSubmit ?? self.requiresSubmit,
            submissionTypes: submissionTypes ?? self.submissionTypes
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum SubmissionType: String, Codable {
    case file = "file"
    case onlinetext = "onlinetext"
}

/// Antwort von GET /moodle/assignments
// MARK: - MoodleAssignmentList
struct MoodleAssignmentList: Codable {
    let items: [MoodleAssignment]

    enum CodingKeys: String, CodingKey {
        case items = "items"
    }
}

// MARK: MoodleAssignmentList convenience initializers and mutators

extension MoodleAssignmentList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleAssignmentList.self, from: data)
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
        items: [MoodleAssignment]? = nil
    ) -> MoodleAssignmentList {
        return MoodleAssignmentList(
            items: items ?? self.items
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Zustand des Moodle-Zugangs (F-MDL-01)
enum MoodleConnectionState: String, Codable {
    case abgelaufen = "abgelaufen"
    case laeuftBaldAb = "laeuft_bald_ab"
    case nichtEingerichtet = "nicht_eingerichtet"
    case nichtErreichbar = "nicht_erreichbar"
    case ok = "ok"
    case ungueltig = "ungueltig"
}

/// Kurs, in den der Nutzer eingeschrieben ist. module_id: zugeordnetes Modul (F-MDL-03)
// MARK: - MoodleCourse
struct MoodleCourse: Codable {
    let endDate: String?
    let fullName: String
    let lastAccessAt: Date?
    let moduleID: String?
    /// Moodle-ID
    let moodleID: Int
    let shortName: String
    let startDate: String?
    let url: String

    enum CodingKeys: String, CodingKey {
        case endDate = "end_date"
        case fullName = "full_name"
        case lastAccessAt = "last_access_at"
        case moduleID = "module_id"
        case moodleID = "moodle_id"
        case shortName = "short_name"
        case startDate = "start_date"
        case url = "url"
    }
}

// MARK: MoodleCourse convenience initializers and mutators

extension MoodleCourse {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleCourse.self, from: data)
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
        endDate: String?? = nil,
        fullName: String? = nil,
        lastAccessAt: Date?? = nil,
        moduleID: String?? = nil,
        moodleID: Int? = nil,
        shortName: String? = nil,
        startDate: String?? = nil,
        url: String? = nil
    ) -> MoodleCourse {
        return MoodleCourse(
            endDate: endDate ?? self.endDate,
            fullName: fullName ?? self.fullName,
            lastAccessAt: lastAccessAt ?? self.lastAccessAt,
            moduleID: moduleID ?? self.moduleID,
            moodleID: moodleID ?? self.moodleID,
            shortName: shortName ?? self.shortName,
            startDate: startDate ?? self.startDate,
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

/// Antwort von GET /moodle/courses/{course_id}/contents
// MARK: - MoodleCourseContents
struct MoodleCourseContents: Codable {
    /// Moodle-ID
    let courseID: Int
    let sections: [MoodleSection]

    enum CodingKeys: String, CodingKey {
        case courseID = "course_id"
        case sections = "sections"
    }
}

// MARK: MoodleCourseContents convenience initializers and mutators

extension MoodleCourseContents {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleCourseContents.self, from: data)
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
        courseID: Int? = nil,
        sections: [MoodleSection]? = nil
    ) -> MoodleCourseContents {
        return MoodleCourseContents(
            courseID: courseID ?? self.courseID,
            sections: sections ?? self.sections
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - MoodleSection
struct MoodleSection: Codable {
    let activities: [MoodleActivity]
    let index: Int
    /// Moodle-ID
    let moodleID: Int
    let name: String
    let visible: Bool

    enum CodingKeys: String, CodingKey {
        case activities = "activities"
        case index = "index"
        case moodleID = "moodle_id"
        case name = "name"
        case visible = "visible"
    }
}

// MARK: MoodleSection convenience initializers and mutators

extension MoodleSection {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleSection.self, from: data)
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
        activities: [MoodleActivity]? = nil,
        index: Int? = nil,
        moodleID: Int? = nil,
        name: String? = nil,
        visible: Bool? = nil
    ) -> MoodleSection {
        return MoodleSection(
            activities: activities ?? self.activities,
            index: index ?? self.index,
            moodleID: moodleID ?? self.moodleID,
            name: name ?? self.name,
            visible: visible ?? self.visible
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Antwort von GET /moodle/courses
// MARK: - MoodleCourseList
struct MoodleCourseList: Codable {
    let items: [MoodleCourse]

    enum CodingKeys: String, CodingKey {
        case items = "items"
    }
}

// MARK: MoodleCourseList convenience initializers and mutators

extension MoodleCourseList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleCourseList.self, from: data)
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
        items: [MoodleCourse]? = nil
    ) -> MoodleCourseList {
        return MoodleCourseList(
            items: items ?? self.items
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Kommende Frist aus dem Moodle-Kalender
// MARK: - MoodleDeadline
struct MoodleDeadline: Codable {
    /// Moodle erwartet noch eine Handlung (z. B. Abgabe fehlt)
    let actionRequired: Bool
    let activityType: String?
    let cmid: Int?
    let courseID: Int?
    let dueAt: Date
    /// Moodle-ID
    let eventID: Int
    let name: String
    let url: String?

    enum CodingKeys: String, CodingKey {
        case actionRequired = "action_required"
        case activityType = "activity_type"
        case cmid = "cmid"
        case courseID = "course_id"
        case dueAt = "due_at"
        case eventID = "event_id"
        case name = "name"
        case url = "url"
    }
}

// MARK: MoodleDeadline convenience initializers and mutators

extension MoodleDeadline {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleDeadline.self, from: data)
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
        actionRequired: Bool? = nil,
        activityType: String?? = nil,
        cmid: Int?? = nil,
        courseID: Int?? = nil,
        dueAt: Date? = nil,
        eventID: Int? = nil,
        name: String? = nil,
        url: String?? = nil
    ) -> MoodleDeadline {
        return MoodleDeadline(
            actionRequired: actionRequired ?? self.actionRequired,
            activityType: activityType ?? self.activityType,
            cmid: cmid ?? self.cmid,
            courseID: courseID ?? self.courseID,
            dueAt: dueAt ?? self.dueAt,
            eventID: eventID ?? self.eventID,
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

/// Antwort von GET /moodle/deadlines
// MARK: - MoodleDeadlineList
struct MoodleDeadlineList: Codable {
    let items: [MoodleDeadline]

    enum CodingKeys: String, CodingKey {
        case items = "items"
    }
}

// MARK: MoodleDeadlineList convenience initializers and mutators

extension MoodleDeadlineList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleDeadlineList.self, from: data)
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
        items: [MoodleDeadline]? = nil
    ) -> MoodleDeadlineList {
        return MoodleDeadlineList(
            items: items ?? self.items
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - MoodleDiscussion
struct MoodleDiscussion: Codable {
    let authorName: String?
    let createdAt: Date
    /// Moodle-ID
    let firstPostID: Int
    /// Moodle-ID
    let forumID: Int
    let modifiedAt: Date
    /// Moodle-ID
    let moodleID: Int
    let pinned: Bool
    let replyCount: Int
    let subject: String

    enum CodingKeys: String, CodingKey {
        case authorName = "author_name"
        case createdAt = "created_at"
        case firstPostID = "first_post_id"
        case forumID = "forum_id"
        case modifiedAt = "modified_at"
        case moodleID = "moodle_id"
        case pinned = "pinned"
        case replyCount = "reply_count"
        case subject = "subject"
    }
}

// MARK: MoodleDiscussion convenience initializers and mutators

extension MoodleDiscussion {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleDiscussion.self, from: data)
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
        authorName: String?? = nil,
        createdAt: Date? = nil,
        firstPostID: Int? = nil,
        forumID: Int? = nil,
        modifiedAt: Date? = nil,
        moodleID: Int? = nil,
        pinned: Bool? = nil,
        replyCount: Int? = nil,
        subject: String? = nil
    ) -> MoodleDiscussion {
        return MoodleDiscussion(
            authorName: authorName ?? self.authorName,
            createdAt: createdAt ?? self.createdAt,
            firstPostID: firstPostID ?? self.firstPostID,
            forumID: forumID ?? self.forumID,
            modifiedAt: modifiedAt ?? self.modifiedAt,
            moodleID: moodleID ?? self.moodleID,
            pinned: pinned ?? self.pinned,
            replyCount: replyCount ?? self.replyCount,
            subject: subject ?? self.subject
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Antwort von GET /moodle/forums/{forum_id}/discussions
// MARK: - MoodleDiscussionList
struct MoodleDiscussionList: Codable {
    let items: [MoodleDiscussion]

    enum CodingKeys: String, CodingKey {
        case items = "items"
    }
}

// MARK: MoodleDiscussionList convenience initializers and mutators

extension MoodleDiscussionList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleDiscussionList.self, from: data)
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
        items: [MoodleDiscussion]? = nil
    ) -> MoodleDiscussionList {
        return MoodleDiscussionList(
            items: items ?? self.items
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - MoodleForum
struct MoodleForum: Codable {
    let canPost: Bool
    /// Moodle-ID
    let cmid: Int
    /// Moodle-ID
    let courseID: Int
    /// Moodle-ID
    let moodleID: Int
    let name: String
    /// Moodle-Forumtyp, z. B. news, general, qanda
    let type: String

    enum CodingKeys: String, CodingKey {
        case canPost = "can_post"
        case cmid = "cmid"
        case courseID = "course_id"
        case moodleID = "moodle_id"
        case name = "name"
        case type = "type"
    }
}

// MARK: MoodleForum convenience initializers and mutators

extension MoodleForum {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleForum.self, from: data)
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
        canPost: Bool? = nil,
        cmid: Int? = nil,
        courseID: Int? = nil,
        moodleID: Int? = nil,
        name: String? = nil,
        type: String? = nil
    ) -> MoodleForum {
        return MoodleForum(
            canPost: canPost ?? self.canPost,
            cmid: cmid ?? self.cmid,
            courseID: courseID ?? self.courseID,
            moodleID: moodleID ?? self.moodleID,
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

/// Antwort von GET /moodle/forums
// MARK: - MoodleForumList
struct MoodleForumList: Codable {
    let items: [MoodleForum]

    enum CodingKeys: String, CodingKey {
        case items = "items"
    }
}

// MARK: MoodleForumList convenience initializers and mutators

extension MoodleForumList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleForumList.self, from: data)
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
        items: [MoodleForum]? = nil
    ) -> MoodleForumList {
        return MoodleForumList(
            items: items ?? self.items
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Zeile aus der Notenübersicht. Werte als Text, wie Moodle sie formatiert
// MARK: - MoodleGradeItem
struct MoodleGradeItem: Codable {
    let cmid: Int?
    /// Moodle-ID
    let courseID: Int
    let feedbackHTML: String?
    let grade: String?
    /// course, mod, category, manual
    let itemType: String
    let name: String
    let percentage: String?
    let range: String?

    enum CodingKeys: String, CodingKey {
        case cmid = "cmid"
        case courseID = "course_id"
        case feedbackHTML = "feedback_html"
        case grade = "grade"
        case itemType = "item_type"
        case name = "name"
        case percentage = "percentage"
        case range = "range"
    }
}

// MARK: MoodleGradeItem convenience initializers and mutators

extension MoodleGradeItem {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleGradeItem.self, from: data)
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
        cmid: Int?? = nil,
        courseID: Int? = nil,
        feedbackHTML: String?? = nil,
        grade: String?? = nil,
        itemType: String? = nil,
        name: String? = nil,
        percentage: String?? = nil,
        range: String?? = nil
    ) -> MoodleGradeItem {
        return MoodleGradeItem(
            cmid: cmid ?? self.cmid,
            courseID: courseID ?? self.courseID,
            feedbackHTML: feedbackHTML ?? self.feedbackHTML,
            grade: grade ?? self.grade,
            itemType: itemType ?? self.itemType,
            name: name ?? self.name,
            percentage: percentage ?? self.percentage,
            range: range ?? self.range
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Antwort von GET /moodle/grades
// MARK: - MoodleGradeList
struct MoodleGradeList: Codable {
    let items: [MoodleGradeItem]

    enum CodingKeys: String, CodingKey {
        case items = "items"
    }
}

// MARK: MoodleGradeList convenience initializers and mutators

extension MoodleGradeList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleGradeList.self, from: data)
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
        items: [MoodleGradeItem]? = nil
    ) -> MoodleGradeList {
        return MoodleGradeList(
            items: items ?? self.items
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - MoodleNotification
struct MoodleNotification: Codable {
    let createdAt: Date
    /// Moodle-ID
    let moodleID: Int
    let read: Bool
    let subject: String
    let text: String
    let url: String?

    enum CodingKeys: String, CodingKey {
        case createdAt = "created_at"
        case moodleID = "moodle_id"
        case read = "read"
        case subject = "subject"
        case text = "text"
        case url = "url"
    }
}

// MARK: MoodleNotification convenience initializers and mutators

extension MoodleNotification {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleNotification.self, from: data)
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
        moodleID: Int? = nil,
        read: Bool? = nil,
        subject: String? = nil,
        text: String? = nil,
        url: String?? = nil
    ) -> MoodleNotification {
        return MoodleNotification(
            createdAt: createdAt ?? self.createdAt,
            moodleID: moodleID ?? self.moodleID,
            read: read ?? self.read,
            subject: subject ?? self.subject,
            text: text ?? self.text,
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

/// Antwort von GET /moodle/notifications
// MARK: - MoodleNotificationList
struct MoodleNotificationList: Codable {
    let items: [MoodleNotification]
    let unreadCount: Int

    enum CodingKeys: String, CodingKey {
        case items = "items"
        case unreadCount = "unread_count"
    }
}

// MARK: MoodleNotificationList convenience initializers and mutators

extension MoodleNotificationList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleNotificationList.self, from: data)
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
        items: [MoodleNotification]? = nil,
        unreadCount: Int? = nil
    ) -> MoodleNotificationList {
        return MoodleNotificationList(
            items: items ?? self.items,
            unreadCount: unreadCount ?? self.unreadCount
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - MoodlePost
struct MoodlePost: Codable {
    let attachments: [MoodleFile]
    let authorName: String?
    let canReply: Bool
    let createdAt: Date
    /// Moodle-ID
    let discussionID: Int
    let messageHTML: String
    /// Moodle-ID
    let moodleID: Int
    let parentID: Int?
    let subject: String

    enum CodingKeys: String, CodingKey {
        case attachments = "attachments"
        case authorName = "author_name"
        case canReply = "can_reply"
        case createdAt = "created_at"
        case discussionID = "discussion_id"
        case messageHTML = "message_html"
        case moodleID = "moodle_id"
        case parentID = "parent_id"
        case subject = "subject"
    }
}

// MARK: MoodlePost convenience initializers and mutators

extension MoodlePost {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodlePost.self, from: data)
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
        attachments: [MoodleFile]? = nil,
        authorName: String?? = nil,
        canReply: Bool? = nil,
        createdAt: Date? = nil,
        discussionID: Int? = nil,
        messageHTML: String? = nil,
        moodleID: Int? = nil,
        parentID: Int?? = nil,
        subject: String? = nil
    ) -> MoodlePost {
        return MoodlePost(
            attachments: attachments ?? self.attachments,
            authorName: authorName ?? self.authorName,
            canReply: canReply ?? self.canReply,
            createdAt: createdAt ?? self.createdAt,
            discussionID: discussionID ?? self.discussionID,
            messageHTML: messageHTML ?? self.messageHTML,
            moodleID: moodleID ?? self.moodleID,
            parentID: parentID ?? self.parentID,
            subject: subject ?? self.subject
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Antwort von GET /moodle/discussions/{discussion_id}/posts
// MARK: - MoodlePostList
struct MoodlePostList: Codable {
    let items: [MoodlePost]

    enum CodingKeys: String, CodingKey {
        case items = "items"
    }
}

// MARK: MoodlePostList convenience initializers and mutators

extension MoodlePostList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodlePostList.self, from: data)
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
        items: [MoodlePost]? = nil
    ) -> MoodlePostList {
        return MoodlePostList(
            items: items ?? self.items
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Quiz, nur zur Anzeige. Versuche laufen nie über die App (F-MDL-05)
// MARK: - MoodleQuiz
struct MoodleQuiz: Codable {
    /// 0 = unbegrenzt
    let attemptsAllowed: Int
    let closesAt: Date?
    /// Moodle-ID
    let cmid: Int
    /// Moodle-ID
    let courseID: Int
    /// Moodle-ID
    let moodleID: Int
    let name: String
    let opensAt: Date?
    let timeLimitMinutes: Int?
    let url: String

    enum CodingKeys: String, CodingKey {
        case attemptsAllowed = "attempts_allowed"
        case closesAt = "closes_at"
        case cmid = "cmid"
        case courseID = "course_id"
        case moodleID = "moodle_id"
        case name = "name"
        case opensAt = "opens_at"
        case timeLimitMinutes = "time_limit_minutes"
        case url = "url"
    }
}

// MARK: MoodleQuiz convenience initializers and mutators

extension MoodleQuiz {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleQuiz.self, from: data)
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
        attemptsAllowed: Int? = nil,
        closesAt: Date?? = nil,
        cmid: Int? = nil,
        courseID: Int? = nil,
        moodleID: Int? = nil,
        name: String? = nil,
        opensAt: Date?? = nil,
        timeLimitMinutes: Int?? = nil,
        url: String? = nil
    ) -> MoodleQuiz {
        return MoodleQuiz(
            attemptsAllowed: attemptsAllowed ?? self.attemptsAllowed,
            closesAt: closesAt ?? self.closesAt,
            cmid: cmid ?? self.cmid,
            courseID: courseID ?? self.courseID,
            moodleID: moodleID ?? self.moodleID,
            name: name ?? self.name,
            opensAt: opensAt ?? self.opensAt,
            timeLimitMinutes: timeLimitMinutes ?? self.timeLimitMinutes,
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

/// Antwort von GET /moodle/quizzes
// MARK: - MoodleQuizList
struct MoodleQuizList: Codable {
    let items: [MoodleQuiz]

    enum CodingKeys: String, CodingKey {
        case items = "items"
    }
}

// MARK: MoodleQuizList convenience initializers and mutators

extension MoodleQuizList {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleQuizList.self, from: data)
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
        items: [MoodleQuiz]? = nil
    ) -> MoodleQuizList {
        return MoodleQuizList(
            items: items ?? self.items
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// Antwort von GET /moodle/status (08 §9.2)
// MARK: - MoodleStatus
struct MoodleStatus: Codable {
    let checkedAt: Date?
    let siteName: String?
    let siteURL: String?
    let state: MoodleConnectionState
    let tokenValidUntil: String?
    let userFullname: String?

    enum CodingKeys: String, CodingKey {
        case checkedAt = "checked_at"
        case siteName = "site_name"
        case siteURL = "site_url"
        case state = "state"
        case tokenValidUntil = "token_valid_until"
        case userFullname = "user_fullname"
    }
}

// MARK: MoodleStatus convenience initializers and mutators

extension MoodleStatus {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleStatus.self, from: data)
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
        checkedAt: Date?? = nil,
        siteName: String?? = nil,
        siteURL: String?? = nil,
        state: MoodleConnectionState? = nil,
        tokenValidUntil: String?? = nil,
        userFullname: String?? = nil
    ) -> MoodleStatus {
        return MoodleStatus(
            checkedAt: checkedAt ?? self.checkedAt,
            siteName: siteName ?? self.siteName,
            siteURL: siteURL ?? self.siteURL,
            state: state ?? self.state,
            tokenValidUntil: tokenValidUntil ?? self.tokenValidUntil,
            userFullname: userFullname ?? self.userFullname
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum MoodleSubmissionState: String, Codable {
    case eingereicht = "eingereicht"
    case entwurf = "entwurf"
    case keine = "keine"
}

/// Antwort von GET /moodle/assignments/{assignment_id}/submission
// MARK: - MoodleSubmissionStatus
struct MoodleSubmissionStatus: Codable {
    /// Moodle-ID
    let assignmentID: Int
    let canEdit: Bool
    let canSubmit: Bool
    let feedbackHTML: String?
    let files: [MoodleFile]
    let grade: String?
    let graded: Bool
    let lastModifiedAt: Date?
    let onlineTextHTML: String?
    let state: MoodleSubmissionState

    enum CodingKeys: String, CodingKey {
        case assignmentID = "assignment_id"
        case canEdit = "can_edit"
        case canSubmit = "can_submit"
        case feedbackHTML = "feedback_html"
        case files = "files"
        case grade = "grade"
        case graded = "graded"
        case lastModifiedAt = "last_modified_at"
        case onlineTextHTML = "online_text_html"
        case state = "state"
    }
}

// MARK: MoodleSubmissionStatus convenience initializers and mutators

extension MoodleSubmissionStatus {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleSubmissionStatus.self, from: data)
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
        assignmentID: Int? = nil,
        canEdit: Bool? = nil,
        canSubmit: Bool? = nil,
        feedbackHTML: String?? = nil,
        files: [MoodleFile]? = nil,
        grade: String?? = nil,
        graded: Bool? = nil,
        lastModifiedAt: Date?? = nil,
        onlineTextHTML: String?? = nil,
        state: MoodleSubmissionState? = nil
    ) -> MoodleSubmissionStatus {
        return MoodleSubmissionStatus(
            assignmentID: assignmentID ?? self.assignmentID,
            canEdit: canEdit ?? self.canEdit,
            canSubmit: canSubmit ?? self.canSubmit,
            feedbackHTML: feedbackHTML ?? self.feedbackHTML,
            files: files ?? self.files,
            grade: grade ?? self.grade,
            graded: graded ?? self.graded,
            lastModifiedAt: lastModifiedAt ?? self.lastModifiedAt,
            onlineTextHTML: onlineTextHTML ?? self.onlineTextHTML,
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

/// Antwort von POST /moodle/uploads
// MARK: - MoodleUpload
struct MoodleUpload: Codable {
    let expiresAt: Date
    let filename: String
    let sizeBytes: Int
    let uploadID: String

    enum CodingKeys: String, CodingKey {
        case expiresAt = "expires_at"
        case filename = "filename"
        case sizeBytes = "size_bytes"
        case uploadID = "upload_id"
    }
}

// MARK: MoodleUpload convenience initializers and mutators

extension MoodleUpload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MoodleUpload.self, from: data)
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
        filename: String? = nil,
        sizeBytes: Int? = nil,
        uploadID: String? = nil
    ) -> MoodleUpload {
        return MoodleUpload(
            expiresAt: expiresAt ?? self.expiresAt,
            filename: filename ?? self.filename,
            sizeBytes: sizeBytes ?? self.sizeBytes,
            uploadID: uploadID ?? self.uploadID
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
    if #available(iOS 10.0, OSX 10.12, tvOS 10.0, watchOS 3.0, *) {
        decoder.dateDecodingStrategy = .iso8601
    }
    return decoder
}

func newJSONEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    if #available(iOS 10.0, OSX 10.12, tvOS 10.0, watchOS 3.0, *) {
        encoder.dateEncodingStrategy = .iso8601
    }
    return encoder
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
