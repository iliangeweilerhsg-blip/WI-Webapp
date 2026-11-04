/* GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen */

/**
 * [x, y, w, h] in pt
 * 
 * @minItems 4
 * @maxItems 4
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "BBox".
 */
export type BBox = number[]
/**
 * UUIDv7 (03 §1)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Uuid".
 */
export type Uuid = string
/**
 * ISO 8601, UTC
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Timestamp".
 */
export type Timestamp = string
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "IngestState".
 */
export type IngestState = ("neu" | "verarbeitet" | "fehler")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "IsoDate".
 */
export type IsoDate = string
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "JobType".
 */
export type JobType = ("pdf.ingest" | "embed.slides" | "embed.tasks" | "sheet.split" | "match.tasks_slides" | "audio.finalize" | "transcribe" | "align.log" | "align.content" | "detect.exam_hints" | "ocr.photos" | "ocr.ink" | "concepts.extract" | "concepts.resolve" | "summary.write" | "cards.generate" | "cornell.questions" | "explain.questions" | "vault.write" | "prereq.check" | "past_exam.analyze" | "grade.open" | "grade.analyze_error" | "feynman.evaluate" | "solution.compare" | "search.index" | "rag.answer" | "video.v0" | "video.v1" | "video.v2" | "fsrs.optimize" | "maintenance.nightly")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "JobState".
 */
export type JobState = ("wartet" | "laeuft" | "fertig" | "fehler" | "abgebrochen")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Lang".
 */
export type Lang = ("de" | "en" | "mixed")
/**
 * Token aus der festen Palette mit 12 Tönen (07 §8), Werte in packages/ui-tokens
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ModuleColor".
 */
export type ModuleColor = ("mod-01" | "mod-02" | "mod-03" | "mod-04" | "mod-05" | "mod-06" | "mod-07" | "mod-08" | "mod-09" | "mod-10" | "mod-11" | "mod-12")
/**
 * pdf.ingest: entweder ein Foliensatz oder ein Übungsblatt (genau eine ID). Ergänzung zu 08 §5: Übungsblätter laufen über denselben Job.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PdfIngestPayload".
 */
export type PdfIngestPayload = (PdfIngestDeckPayload | PdfIngestSheetPayload)

/**
 * GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen
 */
/**
 * Fehlerformat der REST-API (08 §1)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ApiError".
 */
export interface ApiError {
error: ApiErrorBody
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ApiErrorBody".
 */
export interface ApiErrorBody {
code: string
message: string
details?: {
[k: string]: any
}
}
/**
 * Übungsblatt. Ergänzung zu 03 §4: ingest_state zeigt den Fortschritt von pdf.ingest für das Blatt.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ExerciseSheet".
 */
export interface ExerciseSheet {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
module_id: Uuid
title: string
number: (number | null)
sha256: string
page_count: (number | null)
/**
 * Abgabe, geht in den Planer
 */
due_at: (Timestamp | null)
/**
 * Musterlösung hinterlegt (F-ORG-05, Phase 3)
 */
has_solution: boolean
ingest_state: IngestState
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ExerciseSheetList".
 */
export interface ExerciseSheetList {
items: ExerciseSheet[]
next_cursor: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ExerciseSheetUpdate".
 */
export interface ExerciseSheetUpdate {
title?: string
number?: (number | null)
due_at?: (Timestamp | null)
}
/**
 * Antwort von GET /api/v1/health (docs/VERTRAEGE.md §2)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Health".
 */
export interface Health {
status: "ok"
db: ("ok" | "fehler")
version: string
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Job".
 */
export interface Job {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
type: JobType
/**
 * Je nach type, z. B. PdfIngestPayload
 */
payload: {
[k: string]: any
}
state: JobState
/**
 * Höher = früher
 */
priority: number
attempts: number
max_attempts: number
depends_on: Uuid[]
session_id: (Uuid | null)
locked_by: (string | null)
locked_at: (Timestamp | null)
error: (string | null)
result: ({
[k: string]: any
} | null)
run_after: (Timestamp | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "JobList".
 */
export interface JobList {
items: Job[]
next_cursor: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Module".
 */
export interface Module {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
semester_id: Uuid
name: string
short_name: (string | null)
color: ModuleColor
ects: (number | null)
exam_type: (string | null)
lecturer: (string | null)
lang: (Lang | null)
description_md: (string | null)
}
/**
 * Name genügt, alles andere optional (F-ORG-01). Ohne Farbe vergibt der Core die nächste freie Palettenfarbe. id ist optional und darf vom Client erzeugt werden (03 §1).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ModuleCreate".
 */
export interface ModuleCreate {
id?: Uuid
semester_id: Uuid
name: string
short_name?: (string | null)
color?: ModuleColor
ects?: (number | null)
exam_type?: (string | null)
lecturer?: (string | null)
lang?: (Lang | null)
description_md?: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ModuleList".
 */
export interface ModuleList {
items: Module[]
next_cursor: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ModuleUpdate".
 */
export interface ModuleUpdate {
semester_id?: Uuid
name?: string
short_name?: (string | null)
color?: ModuleColor
ects?: (number | null)
exam_type?: (string | null)
lecturer?: (string | null)
lang?: (Lang | null)
description_md?: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PdfIngestDeckPayload".
 */
export interface PdfIngestDeckPayload {
slide_deck_id: Uuid
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PdfIngestSheetPayload".
 */
export interface PdfIngestSheetPayload {
exercise_sheet_id: Uuid
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PdfIngestResult".
 */
export interface PdfIngestResult {
page_count: number
pages_with_text: number
duration_ms: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Semester".
 */
export interface Semester {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
name: string
starts_on: (IsoDate | null)
ends_on: (IsoDate | null)
/**
 * Höchstens ein Semester ist aktuell
 */
is_current: boolean
/**
 * Archiviert = nur in der Navigation ausgeblendet, bleibt durchsuchbar und lernbar (F-ORG-01). Ergänzung zu 03 §3.
 */
archived_at: (Timestamp | null)
}
/**
 * id ist optional und darf vom Client erzeugt werden (03 §1).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SemesterCreate".
 */
export interface SemesterCreate {
id?: Uuid
name: string
starts_on?: (IsoDate | null)
ends_on?: (IsoDate | null)
is_current?: boolean
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SemesterList".
 */
export interface SemesterList {
items: Semester[]
next_cursor: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SemesterUpdate".
 */
export interface SemesterUpdate {
name?: string
starts_on?: (IsoDate | null)
ends_on?: (IsoDate | null)
is_current?: boolean
/**
 * true = archivieren, false = wiederherstellen
 */
archived?: boolean
}
/**
 * Eine Seite eines Foliensatzes. Bilder über GET /slides/{id}/image bzw. /thumb.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Slide".
 */
export interface Slide {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
deck_id: Uuid
/**
 * 1-basiert
 */
index: number
width_pt: number
height_pt: number
/**
 * Textlayer, leer wenn keiner vorhanden
 */
text: string
text_blocks: TextBlock[]
vision_summary: (string | null)
title: (string | null)
chapter: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TextBlock".
 */
export interface TextBlock {
text: string
bbox: BBox
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideDeck".
 */
export interface SlideDeck {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
module_id: Uuid
session_id: (Uuid | null)
title: string
sha256: string
/**
 * null bis pdf.ingest gelaufen ist
 */
page_count: (number | null)
uploaded_at: Timestamp
ingest_state: IngestState
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideDeckDetail".
 */
export interface SlideDeckDetail {
deck: SlideDeck
slides: Slide[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideDeckList".
 */
export interface SlideDeckList {
items: SlideDeck[]
next_cursor: (string | null)
}
/**
 * PATCH /slide-decks/{id}
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideDeckUpdate".
 */
export interface SlideDeckUpdate {
title?: string
}
/**
 * Teilaufgabe eines Übungsblatts. Zerlegung erst ab Phase 2 (F-ORG-03).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Task".
 */
export interface Task {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
sheet_id: Uuid
label: string
page_index: number
bbox: (BBox | null)
text: string
solution_text: (string | null)
}
/**
 * Antwort auf POST /slide-decks und POST /exercise-sheets. duplicate=true: Datei mit gleichem sha256 existiert schon, es wurde nichts angelegt (F-ORG-02 Sonderfall). id ist die ID des neuen bzw. bereits vorhandenen Objekts.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "UploadResult".
 */
export interface UploadResult {
id: Uuid
duplicate: boolean
}
