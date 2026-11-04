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
 * Aktionskatalog (F-MDL-05, 08 §9.3)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionId".
 */
export type MoodleActionId = ("assign.save_draft" | "assign.submit" | "forum.create_discussion" | "forum.reply" | "completion.set" | "calendar.create_event" | "message.send" | "notifications.mark_read" | "files.upload_private")
/**
 * endgueltig und oeffentlich brauchen eine Bestätigung (F-MDL-06)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionRisk".
 */
export type MoodleActionRisk = ("harmlos" | "aenderbar" | "endgueltig" | "oeffentlich")
/**
 * Erledigt-Status einer Aktivität
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleCompletion".
 */
export type MoodleCompletion = ("offen" | "erledigt")
/**
 * Zustand des Moodle-Zugangs (F-MDL-01)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleConnectionState".
 */
export type MoodleConnectionState = ("nicht_eingerichtet" | "ok" | "laeuft_bald_ab" | "abgelaufen" | "ungueltig" | "nicht_erreichbar")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleSubmissionState".
 */
export type MoodleSubmissionState = ("keine" | "entwurf" | "eingereicht")
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
 * Antwort von GET /moodle/actions
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionCatalog".
 */
export interface MoodleActionCatalog {
items: MoodleActionInfo[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionInfo".
 */
export interface MoodleActionInfo {
id: MoodleActionId
label: string
description: string
risk: MoodleActionRisk
needs_confirmation: boolean
/**
 * false = nötige wsfunction für den Token nicht freigegeben
 */
available: boolean
}
/**
 * Body von POST /moodle/actions/{action_id}/execute
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionExecute".
 */
export interface MoodleActionExecute {
params: {
[k: string]: any
}
confirmation_token?: (string | null)
}
/**
 * assign.save_draft: mindestens upload_ids oder online_text_html
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsAssignSaveDraft".
 */
export interface MoodleActionParamsAssignSaveDraft {
/**
 * Moodle-ID
 */
assignment_id: number
/**
 * @minItems 1
 * @maxItems 20
 */
upload_ids?: Uuid[]
online_text_html?: string
}
/**
 * assign.submit
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsAssignSubmit".
 */
export interface MoodleActionParamsAssignSubmit {
/**
 * Moodle-ID
 */
assignment_id: number
accept_statement: boolean
}
/**
 * calendar.create_event (Nutzertermin)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsCalendarCreateEvent".
 */
export interface MoodleActionParamsCalendarCreateEvent {
name: string
start_at: Timestamp
duration_minutes?: number
description_html?: string
}
/**
 * completion.set
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsCompletionSet".
 */
export interface MoodleActionParamsCompletionSet {
/**
 * Moodle-ID
 */
cmid: number
completed: boolean
}
/**
 * files.upload_private
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsFilesUploadPrivate".
 */
export interface MoodleActionParamsFilesUploadPrivate {
/**
 * @minItems 1
 * @maxItems 20
 */
upload_ids: Uuid[]
}
/**
 * forum.create_discussion
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsForumCreateDiscussion".
 */
export interface MoodleActionParamsForumCreateDiscussion {
/**
 * Moodle-ID
 */
forum_id: number
subject: string
message_html: string
/**
 * @minItems 1
 * @maxItems 20
 */
upload_ids?: Uuid[]
}
/**
 * forum.reply
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsForumReply".
 */
export interface MoodleActionParamsForumReply {
/**
 * Moodle-ID
 */
post_id: number
subject?: string
message_html: string
/**
 * @minItems 1
 * @maxItems 20
 */
upload_ids?: Uuid[]
}
/**
 * message.send
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsMessageSend".
 */
export interface MoodleActionParamsMessageSend {
/**
 * Moodle-ID
 */
to_user_id: number
text: string
}
/**
 * Antwort der Vorschau. confirmation_token nur bei needs_confirmation
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionPreview".
 */
export interface MoodleActionPreview {
action_id: MoodleActionId
risk: MoodleActionRisk
needs_confirmation: boolean
/**
 * Ein Satz in Klartext, was passieren wird
 */
summary: string
warnings: string[]
details: {
[k: string]: any
}
confirmation_token: (string | null)
expires_at: (Timestamp | null)
}
/**
 * Body von POST /moodle/actions/{action_id}/preview. params nach MoodleActionParams<Name>
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionRequest".
 */
export interface MoodleActionRequest {
params: {
[k: string]: any
}
}
/**
 * Antwort von execute bei Erfolg
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionResult".
 */
export interface MoodleActionResult {
action_id: MoodleActionId
summary: string
result: {
[k: string]: any
}
}
/**
 * Element eines Kursabschnitts
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActivity".
 */
export interface MoodleActivity {
/**
 * Moodle-ID
 */
cmid: number
/**
 * Moodle-modname, z. B. resource, folder, assign, forum, quiz, url, page, label
 */
type: string
name: string
url: (string | null)
visible: boolean
description_html: (string | null)
completion: (MoodleCompletion | null)
/**
 * true = der Nutzer darf den Status selbst setzen (completion.set)
 */
completion_manual: boolean
instance_id: (number | null)
files: MoodleFile[]
}
/**
 * Datei in Moodle (Aktivität, Anhang, Abgabe)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleFile".
 */
export interface MoodleFile {
/**
 * Pfad hinter webservice/pluginfile.php, für GET /moodle/file?ref
 */
ref: string
filename: string
mime_type: (string | null)
size_bytes: number
modified_at: (Timestamp | null)
}
/**
 * Aufgabe mit Abgabe
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleAssignment".
 */
export interface MoodleAssignment {
/**
 * Moodle-ID
 */
moodle_id: number
/**
 * Moodle-ID
 */
cmid: number
/**
 * Moodle-ID
 */
course_id: number
name: string
due_at: (Timestamp | null)
cutoff_at: (Timestamp | null)
opens_at: (Timestamp | null)
intro_html: (string | null)
intro_files: MoodleFile[]
submission_types: ("file" | "onlinetext")[]
/**
 * Einreichen verlangt die Erklärung zur Eigenständigkeit (accept_statement)
 */
requires_statement: boolean
/**
 * true = Entwurf muss ausdrücklich eingereicht werden (assign.submit)
 */
requires_submit: boolean
}
/**
 * Antwort von GET /moodle/assignments
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleAssignmentList".
 */
export interface MoodleAssignmentList {
items: MoodleAssignment[]
}
/**
 * Kurs, in den der Nutzer eingeschrieben ist. module_id: zugeordnetes Modul (F-MDL-03)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleCourse".
 */
export interface MoodleCourse {
/**
 * Moodle-ID
 */
moodle_id: number
short_name: string
full_name: string
start_date: (IsoDate | null)
end_date: (IsoDate | null)
url: string
last_access_at: (Timestamp | null)
module_id: (Uuid | null)
}
/**
 * Antwort von GET /moodle/courses/{course_id}/contents
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleCourseContents".
 */
export interface MoodleCourseContents {
/**
 * Moodle-ID
 */
course_id: number
sections: MoodleSection[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleSection".
 */
export interface MoodleSection {
/**
 * Moodle-ID
 */
moodle_id: number
index: number
name: string
visible: boolean
activities: MoodleActivity[]
}
/**
 * Antwort von GET /moodle/courses
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleCourseList".
 */
export interface MoodleCourseList {
items: MoodleCourse[]
}
/**
 * Kommende Frist aus dem Moodle-Kalender
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleDeadline".
 */
export interface MoodleDeadline {
/**
 * Moodle-ID
 */
event_id: number
course_id: (number | null)
cmid: (number | null)
activity_type: (string | null)
name: string
due_at: Timestamp
url: (string | null)
/**
 * Moodle erwartet noch eine Handlung (z. B. Abgabe fehlt)
 */
action_required: boolean
}
/**
 * Antwort von GET /moodle/deadlines
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleDeadlineList".
 */
export interface MoodleDeadlineList {
items: MoodleDeadline[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleDiscussion".
 */
export interface MoodleDiscussion {
/**
 * Moodle-ID
 */
moodle_id: number
/**
 * Moodle-ID
 */
forum_id: number
/**
 * Moodle-ID
 */
first_post_id: number
subject: string
author_name: (string | null)
created_at: Timestamp
modified_at: Timestamp
reply_count: number
pinned: boolean
}
/**
 * Antwort von GET /moodle/forums/{forum_id}/discussions
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleDiscussionList".
 */
export interface MoodleDiscussionList {
items: MoodleDiscussion[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleForum".
 */
export interface MoodleForum {
/**
 * Moodle-ID
 */
moodle_id: number
/**
 * Moodle-ID
 */
cmid: number
/**
 * Moodle-ID
 */
course_id: number
name: string
/**
 * Moodle-Forumtyp, z. B. news, general, qanda
 */
type: string
can_post: boolean
}
/**
 * Antwort von GET /moodle/forums
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleForumList".
 */
export interface MoodleForumList {
items: MoodleForum[]
}
/**
 * Zeile aus der Notenübersicht. Werte als Text, wie Moodle sie formatiert
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleGradeItem".
 */
export interface MoodleGradeItem {
/**
 * Moodle-ID
 */
course_id: number
name: string
/**
 * course, mod, category, manual
 */
item_type: string
cmid: (number | null)
grade: (string | null)
range: (string | null)
percentage: (string | null)
feedback_html: (string | null)
}
/**
 * Antwort von GET /moodle/grades
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleGradeList".
 */
export interface MoodleGradeList {
items: MoodleGradeItem[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleNotification".
 */
export interface MoodleNotification {
/**
 * Moodle-ID
 */
moodle_id: number
subject: string
text: string
created_at: Timestamp
read: boolean
url: (string | null)
}
/**
 * Antwort von GET /moodle/notifications
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleNotificationList".
 */
export interface MoodleNotificationList {
items: MoodleNotification[]
unread_count: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodlePost".
 */
export interface MoodlePost {
/**
 * Moodle-ID
 */
moodle_id: number
/**
 * Moodle-ID
 */
discussion_id: number
parent_id: (number | null)
subject: string
message_html: string
author_name: (string | null)
created_at: Timestamp
can_reply: boolean
attachments: MoodleFile[]
}
/**
 * Antwort von GET /moodle/discussions/{discussion_id}/posts
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodlePostList".
 */
export interface MoodlePostList {
items: MoodlePost[]
}
/**
 * Quiz, nur zur Anzeige. Versuche laufen nie über die App (F-MDL-05)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleQuiz".
 */
export interface MoodleQuiz {
/**
 * Moodle-ID
 */
moodle_id: number
/**
 * Moodle-ID
 */
cmid: number
/**
 * Moodle-ID
 */
course_id: number
name: string
opens_at: (Timestamp | null)
closes_at: (Timestamp | null)
/**
 * 0 = unbegrenzt
 */
attempts_allowed: number
time_limit_minutes: (number | null)
url: string
}
/**
 * Antwort von GET /moodle/quizzes
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleQuizList".
 */
export interface MoodleQuizList {
items: MoodleQuiz[]
}
/**
 * Antwort von GET /moodle/status (08 §9.2)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleStatus".
 */
export interface MoodleStatus {
state: MoodleConnectionState
site_url: (string | null)
site_name: (string | null)
user_fullname: (string | null)
token_valid_until: (IsoDate | null)
checked_at: (Timestamp | null)
}
/**
 * Antwort von GET /moodle/assignments/{assignment_id}/submission
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleSubmissionStatus".
 */
export interface MoodleSubmissionStatus {
/**
 * Moodle-ID
 */
assignment_id: number
state: MoodleSubmissionState
graded: boolean
grade: (string | null)
feedback_html: (string | null)
last_modified_at: (Timestamp | null)
can_edit: boolean
can_submit: boolean
files: MoodleFile[]
online_text_html: (string | null)
}
/**
 * Antwort von POST /moodle/uploads
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleUpload".
 */
export interface MoodleUpload {
upload_id: Uuid
filename: string
size_bytes: number
expires_at: Timestamp
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
