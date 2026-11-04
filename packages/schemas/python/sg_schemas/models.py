# GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen

from __future__ import annotations

from datetime import date
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import (
    AnyUrl,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    RootModel,
    StrictBool,
    StrictFloat,
    StrictInt,
    StrictStr,
)


class ApiErrorBody(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    code: StrictStr = Field(
        ..., examples=['slide_deck_not_found'], pattern='^[a-z][a-z0-9_]*$'
    )
    message: StrictStr
    details: dict[str, Any] | None = None


class BBox(RootModel[list[StrictFloat]]):
    """
    [x, y, w, h] in pt
    """

    root: list[StrictFloat] = Field(
        ..., description='[x, y, w, h] in pt', max_length=4, min_length=4, title='BBox'
    )


class Status(StrEnum):
    ok = 'ok'


class Db(StrEnum):
    ok = 'ok'
    fehler = 'fehler'


class Health(BaseModel):
    """
    Antwort von GET /api/v1/health (docs/VERTRAEGE.md §2)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    status: Status
    db: Db
    version: StrictStr


class IngestState(StrEnum):
    neu = 'neu'
    verarbeitet = 'verarbeitet'
    fehler = 'fehler'


class JobState(StrEnum):
    wartet = 'wartet'
    laeuft = 'laeuft'
    fertig = 'fertig'
    fehler = 'fehler'
    abgebrochen = 'abgebrochen'


class JobType(StrEnum):
    pdf_ingest = 'pdf.ingest'
    embed_slides = 'embed.slides'
    embed_tasks = 'embed.tasks'
    sheet_split = 'sheet.split'
    match_tasks_slides = 'match.tasks_slides'
    audio_finalize = 'audio.finalize'
    transcribe = 'transcribe'
    align_log = 'align.log'
    align_content = 'align.content'
    detect_exam_hints = 'detect.exam_hints'
    ocr_photos = 'ocr.photos'
    ocr_ink = 'ocr.ink'
    concepts_extract = 'concepts.extract'
    concepts_resolve = 'concepts.resolve'
    summary_write = 'summary.write'
    cards_generate = 'cards.generate'
    cornell_questions = 'cornell.questions'
    explain_questions = 'explain.questions'
    vault_write = 'vault.write'
    prereq_check = 'prereq.check'
    past_exam_analyze = 'past_exam.analyze'
    grade_open = 'grade.open'
    grade_analyze_error = 'grade.analyze_error'
    feynman_evaluate = 'feynman.evaluate'
    solution_compare = 'solution.compare'
    search_index = 'search.index'
    rag_answer = 'rag.answer'
    video_v0 = 'video.v0'
    video_v1 = 'video.v1'
    video_v2 = 'video.v2'
    fsrs_optimize = 'fsrs.optimize'
    maintenance_nightly = 'maintenance.nightly'


class Lang(StrEnum):
    de = 'de'
    en = 'en'
    mixed = 'mixed'


class ModuleColor(StrEnum):
    """
    Token aus der festen Palette mit 12 Tönen (07 §8), Werte in packages/ui-tokens
    """

    mod_01 = 'mod-01'
    mod_02 = 'mod-02'
    mod_03 = 'mod-03'
    mod_04 = 'mod-04'
    mod_05 = 'mod-05'
    mod_06 = 'mod-06'
    mod_07 = 'mod-07'
    mod_08 = 'mod-08'
    mod_09 = 'mod-09'
    mod_10 = 'mod-10'
    mod_11 = 'mod-11'
    mod_12 = 'mod-12'


class ConfirmationToken(RootModel[StrictStr]):
    root: StrictStr = Field(..., min_length=16)


class MoodleActionExecute(BaseModel):
    """
    Body von POST /moodle/actions/{action_id}/execute
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    params: dict[str, Any]
    confirmation_token: ConfirmationToken | None = None


class MoodleActionId(StrEnum):
    """
    Aktionskatalog (F-MDL-05, 08 §9.3)
    """

    assign_save_draft = 'assign.save_draft'
    assign_submit = 'assign.submit'
    forum_create_discussion = 'forum.create_discussion'
    forum_reply = 'forum.reply'
    completion_set = 'completion.set'
    calendar_create_event = 'calendar.create_event'
    message_send = 'message.send'
    notifications_mark_read = 'notifications.mark_read'
    files_upload_private = 'files.upload_private'


class MoodleActionParamsAssignSubmit(BaseModel):
    """
    assign.submit
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    assignment_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    accept_statement: StrictBool


class MoodleActionParamsCompletionSet(BaseModel):
    """
    completion.set
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    cmid: StrictInt = Field(..., description='Moodle-ID', ge=1)
    completed: StrictBool


class MoodleActionParamsMessageSend(BaseModel):
    """
    message.send
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    to_user_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    text: StrictStr = Field(..., max_length=4096, min_length=1)


class MoodleActionRequest(BaseModel):
    """
    Body von POST /moodle/actions/{action_id}/preview. params nach MoodleActionParams<Name>
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    params: dict[str, Any]


class MoodleActionResult(BaseModel):
    """
    Antwort von execute bei Erfolg
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    action_id: MoodleActionId
    summary: StrictStr
    result: dict[str, Any]


class MoodleActionRisk(StrEnum):
    """
    endgueltig und oeffentlich brauchen eine Bestätigung (F-MDL-06)
    """

    harmlos = 'harmlos'
    aenderbar = 'aenderbar'
    endgueltig = 'endgueltig'
    oeffentlich = 'oeffentlich'


class InstanceId(RootModel[StrictInt]):
    root: StrictInt = Field(..., description='Moodle-ID', ge=1)


class SubmissionType(StrEnum):
    file = 'file'
    onlinetext = 'onlinetext'


class MoodleCompletion(StrEnum):
    """
    Erledigt-Status einer Aktivität
    """

    offen = 'offen'
    erledigt = 'erledigt'


class MoodleConnectionState(StrEnum):
    """
    Zustand des Moodle-Zugangs (F-MDL-01)
    """

    nicht_eingerichtet = 'nicht_eingerichtet'
    ok = 'ok'
    laeuft_bald_ab = 'laeuft_bald_ab'
    abgelaufen = 'abgelaufen'
    ungueltig = 'ungueltig'
    nicht_erreichbar = 'nicht_erreichbar'


class CourseId(RootModel[StrictInt]):
    root: StrictInt = Field(..., description='Moodle-ID', ge=1)


class Cmid(RootModel[StrictInt]):
    root: StrictInt = Field(..., description='Moodle-ID', ge=1)


class MoodleForum(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    moodle_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    cmid: StrictInt = Field(..., description='Moodle-ID', ge=1)
    course_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    name: StrictStr
    type: StrictStr = Field(
        ..., description='Moodle-Forumtyp, z. B. news, general, qanda'
    )
    can_post: StrictBool


class MoodleForumList(BaseModel):
    """
    Antwort von GET /moodle/forums
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[MoodleForum]


class MoodleGradeItem(BaseModel):
    """
    Zeile aus der Notenübersicht. Werte als Text, wie Moodle sie formatiert
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    course_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    name: StrictStr
    item_type: StrictStr = Field(..., description='course, mod, category, manual')
    cmid: Cmid | None
    grade: StrictStr | None
    range: StrictStr | None
    percentage: StrictStr | None
    feedback_html: StrictStr | None


class MoodleGradeList(BaseModel):
    """
    Antwort von GET /moodle/grades
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[MoodleGradeItem]


class ParentId(RootModel[StrictInt]):
    root: StrictInt = Field(..., description='Moodle-ID', ge=1)


class TimeLimitMinutes(RootModel[StrictInt]):
    root: StrictInt = Field(..., ge=0)


class MoodleSubmissionState(StrEnum):
    keine = 'keine'
    entwurf = 'entwurf'
    eingereicht = 'eingereicht'


class PdfIngestResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    page_count: StrictInt = Field(..., ge=0)
    pages_with_text: StrictInt = Field(..., ge=0)
    duration_ms: StrictInt = Field(..., ge=0)


class SemesterUpdate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    name: StrictStr | None = Field(None, min_length=1)
    starts_on: date | None = None
    ends_on: date | None = None
    is_current: StrictBool | None = None
    archived: StrictBool | None = Field(
        None, description='true = archivieren, false = wiederherstellen'
    )


class SlideDeckUpdate(BaseModel):
    """
    PATCH /slide-decks/{id}
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    title: StrictStr | None = Field(None, min_length=1)


class TextBlock(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    text: StrictStr
    bbox: list[StrictFloat] = Field(
        ..., description='[x, y, w, h] in pt', max_length=4, min_length=4, title='BBox'
    )


class ApiError(BaseModel):
    """
    Fehlerformat der REST-API (08 §1)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    error: ApiErrorBody


class ExerciseSheet(BaseModel):
    """
    Übungsblatt. Ergänzung zu 03 §4: ingest_state zeigt den Fortschritt von pdf.ingest für das Blatt.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    user_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    module_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    title: StrictStr
    number: StrictInt | None
    sha256: StrictStr = Field(..., pattern='^[a-f0-9]{64}$')
    page_count: StrictInt | None = Field(..., ge=0)
    due_at: AwareDatetime | None = Field(..., description='Abgabe, geht in den Planer')
    has_solution: StrictBool = Field(
        ..., description='Musterlösung hinterlegt (F-ORG-05, Phase 3)'
    )
    ingest_state: IngestState


class ExerciseSheetList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[ExerciseSheet]
    next_cursor: StrictStr | None


class ExerciseSheetUpdate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    title: StrictStr | None = None
    number: StrictInt | None = None
    due_at: AwareDatetime | None = None


class Job(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    user_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    type: JobType
    payload: dict[str, Any] = Field(
        ..., description='Je nach type, z. B. PdfIngestPayload'
    )
    state: JobState
    priority: StrictInt = Field(..., description='Höher = früher')
    attempts: StrictInt = Field(..., ge=0)
    max_attempts: StrictInt = Field(..., ge=1)
    depends_on: list[UUID]
    session_id: UUID | None
    locked_by: StrictStr | None
    locked_at: AwareDatetime | None
    error: StrictStr | None
    result: dict[str, Any] | None
    run_after: AwareDatetime | None


class JobList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[Job]
    next_cursor: StrictStr | None


class Module(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    user_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    semester_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    name: StrictStr = Field(..., examples=['Datenbanksysteme'], min_length=1)
    short_name: StrictStr | None = Field(..., examples=['DBS'])
    color: ModuleColor
    ects: StrictFloat | None = Field(..., ge=0.0)
    exam_type: StrictStr | None = Field(
        ..., examples=['schriftlich', 'mündlich', 'Projekt']
    )
    lecturer: StrictStr | None
    lang: Lang | None
    description_md: StrictStr | None


class ModuleCreate(BaseModel):
    """
    Name genügt, alles andere optional (F-ORG-01). Ohne Farbe vergibt der Core die nächste freie Palettenfarbe. id ist optional und darf vom Client erzeugt werden (03 §1).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID | None = Field(None, description='UUIDv7 (03 §1)', title='Uuid')
    semester_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    name: StrictStr = Field(..., min_length=1)
    short_name: StrictStr | None = None
    color: ModuleColor | None = None
    ects: StrictFloat | None = Field(None, ge=0.0)
    exam_type: StrictStr | None = None
    lecturer: StrictStr | None = None
    lang: Lang | None = None
    description_md: StrictStr | None = None


class ModuleList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[Module]
    next_cursor: StrictStr | None


class ModuleUpdate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    semester_id: UUID | None = Field(None, description='UUIDv7 (03 §1)', title='Uuid')
    name: StrictStr | None = Field(None, min_length=1)
    short_name: StrictStr | None = None
    color: ModuleColor | None = None
    ects: StrictFloat | None = Field(None, ge=0.0)
    exam_type: StrictStr | None = None
    lecturer: StrictStr | None = None
    lang: Lang | None = None
    description_md: StrictStr | None = None


class MoodleActionInfo(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: MoodleActionId
    label: StrictStr
    description: StrictStr
    risk: MoodleActionRisk
    needs_confirmation: StrictBool
    available: StrictBool = Field(
        ..., description='false = nötige wsfunction für den Token nicht freigegeben'
    )


class MoodleActionParamsAssignSaveDraft(BaseModel):
    """
    assign.save_draft: mindestens upload_ids oder online_text_html
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    assignment_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    upload_ids: list[UUID] | None = Field(None, max_length=20, min_length=1)
    online_text_html: StrictStr | None = Field(None, max_length=100000, min_length=1)


class MoodleActionParamsCalendarCreateEvent(BaseModel):
    """
    calendar.create_event (Nutzertermin)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    name: StrictStr = Field(..., max_length=255, min_length=1)
    start_at: AwareDatetime = Field(..., description='ISO 8601, UTC', title='Timestamp')
    duration_minutes: StrictInt | None = Field(None, ge=1, le=1440)
    description_html: StrictStr | None = Field(None, max_length=100000, min_length=1)


class MoodleActionParamsFilesUploadPrivate(BaseModel):
    """
    files.upload_private
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    upload_ids: list[UUID] = Field(..., max_length=20, min_length=1)


class MoodleActionParamsForumCreateDiscussion(BaseModel):
    """
    forum.create_discussion
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    forum_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    subject: StrictStr = Field(..., max_length=255, min_length=1)
    message_html: StrictStr = Field(..., max_length=100000, min_length=1)
    upload_ids: list[UUID] | None = Field(None, max_length=20, min_length=1)


class MoodleActionParamsForumReply(BaseModel):
    """
    forum.reply
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    post_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    subject: StrictStr | None = Field(None, max_length=255, min_length=1)
    message_html: StrictStr = Field(..., max_length=100000, min_length=1)
    upload_ids: list[UUID] | None = Field(None, max_length=20, min_length=1)


class MoodleActionPreview(BaseModel):
    """
    Antwort der Vorschau. confirmation_token nur bei needs_confirmation
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    action_id: MoodleActionId
    risk: MoodleActionRisk
    needs_confirmation: StrictBool
    summary: StrictStr = Field(
        ..., description='Ein Satz in Klartext, was passieren wird'
    )
    warnings: list[StrictStr]
    details: dict[str, Any]
    confirmation_token: StrictStr | None
    expires_at: AwareDatetime | None


class MoodleCourse(BaseModel):
    """
    Kurs, in den der Nutzer eingeschrieben ist. module_id: zugeordnetes Modul (F-MDL-03)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    moodle_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    short_name: StrictStr
    full_name: StrictStr
    start_date: date | None
    end_date: date | None
    url: AnyUrl
    last_access_at: AwareDatetime | None
    module_id: UUID | None


class MoodleCourseList(BaseModel):
    """
    Antwort von GET /moodle/courses
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[MoodleCourse]


class MoodleDeadline(BaseModel):
    """
    Kommende Frist aus dem Moodle-Kalender
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    event_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    course_id: CourseId | None
    cmid: Cmid | None
    activity_type: StrictStr | None
    name: StrictStr
    due_at: AwareDatetime = Field(..., description='ISO 8601, UTC', title='Timestamp')
    url: AnyUrl | None
    action_required: StrictBool = Field(
        ..., description='Moodle erwartet noch eine Handlung (z. B. Abgabe fehlt)'
    )


class MoodleDeadlineList(BaseModel):
    """
    Antwort von GET /moodle/deadlines
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[MoodleDeadline]


class MoodleDiscussion(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    moodle_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    forum_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    first_post_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    subject: StrictStr
    author_name: StrictStr | None
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    modified_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    reply_count: StrictInt = Field(..., ge=0)
    pinned: StrictBool


class MoodleDiscussionList(BaseModel):
    """
    Antwort von GET /moodle/forums/{forum_id}/discussions
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[MoodleDiscussion]


class MoodleFile(BaseModel):
    """
    Datei in Moodle (Aktivität, Anhang, Abgabe)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    ref: StrictStr = Field(
        ...,
        description='Pfad hinter webservice/pluginfile.php, für GET /moodle/file?ref',
        pattern='^/',
    )
    filename: StrictStr
    mime_type: StrictStr | None
    size_bytes: StrictInt = Field(..., ge=0)
    modified_at: AwareDatetime | None


class MoodleNotification(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    moodle_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    subject: StrictStr
    text: StrictStr
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    read: StrictBool
    url: AnyUrl | None


class MoodleNotificationList(BaseModel):
    """
    Antwort von GET /moodle/notifications
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[MoodleNotification]
    unread_count: StrictInt = Field(..., ge=0)


class MoodlePost(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    moodle_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    discussion_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    parent_id: ParentId | None
    subject: StrictStr
    message_html: StrictStr
    author_name: StrictStr | None
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    can_reply: StrictBool
    attachments: list[MoodleFile]


class MoodlePostList(BaseModel):
    """
    Antwort von GET /moodle/discussions/{discussion_id}/posts
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[MoodlePost]


class MoodleQuiz(BaseModel):
    """
    Quiz, nur zur Anzeige. Versuche laufen nie über die App (F-MDL-05)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    moodle_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    cmid: StrictInt = Field(..., description='Moodle-ID', ge=1)
    course_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    name: StrictStr
    opens_at: AwareDatetime | None
    closes_at: AwareDatetime | None
    attempts_allowed: StrictInt = Field(..., description='0 = unbegrenzt', ge=0)
    time_limit_minutes: TimeLimitMinutes | None
    url: AnyUrl


class MoodleQuizList(BaseModel):
    """
    Antwort von GET /moodle/quizzes
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[MoodleQuiz]


class MoodleStatus(BaseModel):
    """
    Antwort von GET /moodle/status (08 §9.2)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    state: MoodleConnectionState
    site_url: AnyUrl | None
    site_name: StrictStr | None
    user_fullname: StrictStr | None
    token_valid_until: date | None
    checked_at: AwareDatetime | None


class MoodleSubmissionStatus(BaseModel):
    """
    Antwort von GET /moodle/assignments/{assignment_id}/submission
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    assignment_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    state: MoodleSubmissionState
    graded: StrictBool
    grade: StrictStr | None
    feedback_html: StrictStr | None
    last_modified_at: AwareDatetime | None
    can_edit: StrictBool
    can_submit: StrictBool
    files: list[MoodleFile]
    online_text_html: StrictStr | None


class MoodleUpload(BaseModel):
    """
    Antwort von POST /moodle/uploads
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    upload_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    filename: StrictStr
    size_bytes: StrictInt = Field(..., ge=0)
    expires_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )


class PdfIngestDeckPayload(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    slide_deck_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')


class PdfIngestSheetPayload(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    exercise_sheet_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')


class Semester(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    user_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    name: StrictStr = Field(..., examples=['HS 2026'], min_length=1)
    starts_on: date | None
    ends_on: date | None
    is_current: StrictBool = Field(
        ..., description='Höchstens ein Semester ist aktuell'
    )
    archived_at: AwareDatetime | None = Field(
        ...,
        description='Archiviert = nur in der Navigation ausgeblendet, bleibt durchsuchbar und lernbar (F-ORG-01). Ergänzung zu 03 §3.',
    )


class SemesterCreate(BaseModel):
    """
    id ist optional und darf vom Client erzeugt werden (03 §1).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID | None = Field(None, description='UUIDv7 (03 §1)', title='Uuid')
    name: StrictStr = Field(..., min_length=1)
    starts_on: date | None = None
    ends_on: date | None = None
    is_current: StrictBool | None = None


class SemesterList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[Semester]
    next_cursor: StrictStr | None


class Slide(BaseModel):
    """
    Eine Seite eines Foliensatzes. Bilder über GET /slides/{id}/image bzw. /thumb.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    user_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    deck_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    index: StrictInt = Field(..., description='1-basiert', ge=1)
    width_pt: StrictFloat
    height_pt: StrictFloat
    text: StrictStr = Field(..., description='Textlayer, leer wenn keiner vorhanden')
    text_blocks: list[TextBlock]
    vision_summary: StrictStr | None
    title: StrictStr | None
    chapter: StrictStr | None


class SlideDeck(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    user_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    module_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    session_id: UUID | None
    title: StrictStr
    sha256: StrictStr = Field(..., pattern='^[a-f0-9]{64}$')
    page_count: StrictInt | None = Field(
        ..., description='null bis pdf.ingest gelaufen ist', ge=0
    )
    uploaded_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    ingest_state: IngestState


class SlideDeckDetail(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    deck: SlideDeck
    slides: list[Slide]


class SlideDeckList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[SlideDeck]
    next_cursor: StrictStr | None


class Task(BaseModel):
    """
    Teilaufgabe eines Übungsblatts. Zerlegung erst ab Phase 2 (F-ORG-03).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    user_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    sheet_id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    label: StrictStr = Field(..., examples=['2b'])
    page_index: StrictInt = Field(..., ge=1)
    bbox: BBox | None
    text: StrictStr
    solution_text: StrictStr | None


class UploadResult(BaseModel):
    """
    Antwort auf POST /slide-decks und POST /exercise-sheets. duplicate=true: Datei mit gleichem sha256 existiert schon, es wurde nichts angelegt (F-ORG-02 Sonderfall). id ist die ID des neuen bzw. bereits vorhandenen Objekts.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')
    duplicate: StrictBool


class MoodleActionCatalog(BaseModel):
    """
    Antwort von GET /moodle/actions
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[MoodleActionInfo]


class MoodleActivity(BaseModel):
    """
    Element eines Kursabschnitts
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    cmid: StrictInt = Field(..., description='Moodle-ID', ge=1)
    type: StrictStr = Field(
        ...,
        description='Moodle-modname, z. B. resource, folder, assign, forum, quiz, url, page, label',
    )
    name: StrictStr
    url: AnyUrl | None
    visible: StrictBool
    description_html: StrictStr | None
    completion: MoodleCompletion | None
    completion_manual: StrictBool = Field(
        ...,
        description='true = der Nutzer darf den Status selbst setzen (completion.set)',
    )
    instance_id: InstanceId | None
    files: list[MoodleFile]


class MoodleAssignment(BaseModel):
    """
    Aufgabe mit Abgabe
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    moodle_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    cmid: StrictInt = Field(..., description='Moodle-ID', ge=1)
    course_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    name: StrictStr
    due_at: AwareDatetime | None
    cutoff_at: AwareDatetime | None
    opens_at: AwareDatetime | None
    intro_html: StrictStr | None
    intro_files: list[MoodleFile]
    submission_types: list[SubmissionType]
    requires_statement: StrictBool = Field(
        ...,
        description='Einreichen verlangt die Erklärung zur Eigenständigkeit (accept_statement)',
    )
    requires_submit: StrictBool = Field(
        ...,
        description='true = Entwurf muss ausdrücklich eingereicht werden (assign.submit)',
    )


class MoodleAssignmentList(BaseModel):
    """
    Antwort von GET /moodle/assignments
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[MoodleAssignment]


class MoodleSection(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    moodle_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    index: StrictInt = Field(..., ge=0)
    name: StrictStr
    visible: StrictBool
    activities: list[MoodleActivity]


class MoodleCourseContents(BaseModel):
    """
    Antwort von GET /moodle/courses/{course_id}/contents
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    course_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    sections: list[MoodleSection]


class SchemaBundle(BaseModel):
    """
    GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen
    """

    ApiError_1: ApiError | None = Field(None, alias='ApiError')
    ApiErrorBody_1: ApiErrorBody | None = Field(None, alias='ApiErrorBody')
    BBox: list[StrictFloat] | None = Field(
        None, description='[x, y, w, h] in pt', max_length=4, min_length=4, title='BBox'
    )
    ExerciseSheet_1: ExerciseSheet | None = Field(None, alias='ExerciseSheet')
    ExerciseSheetList_1: ExerciseSheetList | None = Field(
        None, alias='ExerciseSheetList'
    )
    ExerciseSheetUpdate_1: ExerciseSheetUpdate | None = Field(
        None, alias='ExerciseSheetUpdate'
    )
    Health_1: Health | None = Field(None, alias='Health')
    IngestState_1: IngestState | None = Field(None, alias='IngestState')
    IsoDate: date | None = Field(None, title='IsoDate')
    Job_1: Job | None = Field(None, alias='Job')
    JobList_1: JobList | None = Field(None, alias='JobList')
    JobState_1: JobState | None = Field(None, alias='JobState')
    JobType_1: JobType | None = Field(None, alias='JobType')
    Lang_1: Lang | None = Field(None, alias='Lang')
    Module_1: Module | None = Field(None, alias='Module')
    ModuleColor_1: ModuleColor | None = Field(None, alias='ModuleColor')
    ModuleCreate_1: ModuleCreate | None = Field(None, alias='ModuleCreate')
    ModuleList_1: ModuleList | None = Field(None, alias='ModuleList')
    ModuleUpdate_1: ModuleUpdate | None = Field(None, alias='ModuleUpdate')
    MoodleActionCatalog_1: MoodleActionCatalog | None = Field(
        None, alias='MoodleActionCatalog'
    )
    MoodleActionExecute_1: MoodleActionExecute | None = Field(
        None, alias='MoodleActionExecute'
    )
    MoodleActionId_1: MoodleActionId | None = Field(None, alias='MoodleActionId')
    MoodleActionInfo_1: MoodleActionInfo | None = Field(None, alias='MoodleActionInfo')
    MoodleActionParamsAssignSaveDraft_1: MoodleActionParamsAssignSaveDraft | None = (
        Field(None, alias='MoodleActionParamsAssignSaveDraft')
    )
    MoodleActionParamsAssignSubmit_1: MoodleActionParamsAssignSubmit | None = Field(
        None, alias='MoodleActionParamsAssignSubmit'
    )
    MoodleActionParamsCalendarCreateEvent_1: (
        MoodleActionParamsCalendarCreateEvent | None
    ) = Field(None, alias='MoodleActionParamsCalendarCreateEvent')
    MoodleActionParamsCompletionSet_1: MoodleActionParamsCompletionSet | None = Field(
        None, alias='MoodleActionParamsCompletionSet'
    )
    MoodleActionParamsFilesUploadPrivate_1: (
        MoodleActionParamsFilesUploadPrivate | None
    ) = Field(None, alias='MoodleActionParamsFilesUploadPrivate')
    MoodleActionParamsForumCreateDiscussion_1: (
        MoodleActionParamsForumCreateDiscussion | None
    ) = Field(None, alias='MoodleActionParamsForumCreateDiscussion')
    MoodleActionParamsForumReply_1: MoodleActionParamsForumReply | None = Field(
        None, alias='MoodleActionParamsForumReply'
    )
    MoodleActionParamsMessageSend_1: MoodleActionParamsMessageSend | None = Field(
        None, alias='MoodleActionParamsMessageSend'
    )
    MoodleActionPreview_1: MoodleActionPreview | None = Field(
        None, alias='MoodleActionPreview'
    )
    MoodleActionRequest_1: MoodleActionRequest | None = Field(
        None, alias='MoodleActionRequest'
    )
    MoodleActionResult_1: MoodleActionResult | None = Field(
        None, alias='MoodleActionResult'
    )
    MoodleActionRisk_1: MoodleActionRisk | None = Field(None, alias='MoodleActionRisk')
    MoodleActivity_1: MoodleActivity | None = Field(None, alias='MoodleActivity')
    MoodleAssignment_1: MoodleAssignment | None = Field(None, alias='MoodleAssignment')
    MoodleAssignmentList_1: MoodleAssignmentList | None = Field(
        None, alias='MoodleAssignmentList'
    )
    MoodleCompletion_1: MoodleCompletion | None = Field(None, alias='MoodleCompletion')
    MoodleConnectionState_1: MoodleConnectionState | None = Field(
        None, alias='MoodleConnectionState'
    )
    MoodleCourse_1: MoodleCourse | None = Field(None, alias='MoodleCourse')
    MoodleCourseContents_1: MoodleCourseContents | None = Field(
        None, alias='MoodleCourseContents'
    )
    MoodleCourseList_1: MoodleCourseList | None = Field(None, alias='MoodleCourseList')
    MoodleDeadline_1: MoodleDeadline | None = Field(None, alias='MoodleDeadline')
    MoodleDeadlineList_1: MoodleDeadlineList | None = Field(
        None, alias='MoodleDeadlineList'
    )
    MoodleDiscussion_1: MoodleDiscussion | None = Field(None, alias='MoodleDiscussion')
    MoodleDiscussionList_1: MoodleDiscussionList | None = Field(
        None, alias='MoodleDiscussionList'
    )
    MoodleFile_1: MoodleFile | None = Field(None, alias='MoodleFile')
    MoodleForum_1: MoodleForum | None = Field(None, alias='MoodleForum')
    MoodleForumList_1: MoodleForumList | None = Field(None, alias='MoodleForumList')
    MoodleGradeItem_1: MoodleGradeItem | None = Field(None, alias='MoodleGradeItem')
    MoodleGradeList_1: MoodleGradeList | None = Field(None, alias='MoodleGradeList')
    MoodleNotification_1: MoodleNotification | None = Field(
        None, alias='MoodleNotification'
    )
    MoodleNotificationList_1: MoodleNotificationList | None = Field(
        None, alias='MoodleNotificationList'
    )
    MoodlePost_1: MoodlePost | None = Field(None, alias='MoodlePost')
    MoodlePostList_1: MoodlePostList | None = Field(None, alias='MoodlePostList')
    MoodleQuiz_1: MoodleQuiz | None = Field(None, alias='MoodleQuiz')
    MoodleQuizList_1: MoodleQuizList | None = Field(None, alias='MoodleQuizList')
    MoodleSection_1: MoodleSection | None = Field(None, alias='MoodleSection')
    MoodleStatus_1: MoodleStatus | None = Field(None, alias='MoodleStatus')
    MoodleSubmissionState_1: MoodleSubmissionState | None = Field(
        None, alias='MoodleSubmissionState'
    )
    MoodleSubmissionStatus_1: MoodleSubmissionStatus | None = Field(
        None, alias='MoodleSubmissionStatus'
    )
    MoodleUpload_1: MoodleUpload | None = Field(None, alias='MoodleUpload')
    PdfIngestDeckPayload_1: PdfIngestDeckPayload | None = Field(
        None, alias='PdfIngestDeckPayload'
    )
    PdfIngestPayload: PdfIngestDeckPayload | PdfIngestSheetPayload | None = Field(
        None,
        description='pdf.ingest: entweder ein Foliensatz oder ein Übungsblatt (genau eine ID). Ergänzung zu 08 §5: Übungsblätter laufen über denselben Job.',
        title='PdfIngestPayload',
    )
    PdfIngestResult_1: PdfIngestResult | None = Field(None, alias='PdfIngestResult')
    PdfIngestSheetPayload_1: PdfIngestSheetPayload | None = Field(
        None, alias='PdfIngestSheetPayload'
    )
    Semester_1: Semester | None = Field(None, alias='Semester')
    SemesterCreate_1: SemesterCreate | None = Field(None, alias='SemesterCreate')
    SemesterList_1: SemesterList | None = Field(None, alias='SemesterList')
    SemesterUpdate_1: SemesterUpdate | None = Field(None, alias='SemesterUpdate')
    Slide_1: Slide | None = Field(None, alias='Slide')
    SlideDeck_1: SlideDeck | None = Field(None, alias='SlideDeck')
    SlideDeckDetail_1: SlideDeckDetail | None = Field(None, alias='SlideDeckDetail')
    SlideDeckList_1: SlideDeckList | None = Field(None, alias='SlideDeckList')
    SlideDeckUpdate_1: SlideDeckUpdate | None = Field(None, alias='SlideDeckUpdate')
    Task_1: Task | None = Field(None, alias='Task')
    TextBlock_1: TextBlock | None = Field(None, alias='TextBlock')
    Timestamp: AwareDatetime | None = Field(
        None, description='ISO 8601, UTC', title='Timestamp'
    )
    UploadResult_1: UploadResult | None = Field(None, alias='UploadResult')
    Uuid: UUID | None = Field(None, description='UUIDv7 (03 §1)', title='Uuid')


# Union-Typen (für Validierung: pydantic.TypeAdapter(<Typ>))
type PdfIngestPayload = PdfIngestDeckPayload | PdfIngestSheetPayload
