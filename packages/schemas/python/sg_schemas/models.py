# GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen

from __future__ import annotations

from datetime import date
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import (
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
