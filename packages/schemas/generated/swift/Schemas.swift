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
