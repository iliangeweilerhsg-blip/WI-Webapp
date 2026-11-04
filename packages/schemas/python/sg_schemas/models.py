# GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen

from __future__ import annotations

from datetime import date
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, RootModel


class Error(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    code: str = Field(
        ..., examples=['slide_deck_not_found'], pattern='^[a-z][a-z0-9_]*$'
    )
    message: str
    details: dict[str, Any] | None = None


class ApiError(BaseModel):
    """
    Fehlerformat der REST-API (08 §1)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    error: Error


class BBox(RootModel[list[float]]):
    """
    [x, y, w, h] in pt
    """

    root: list[float] = Field(
        ..., description='[x, y, w, h] in pt', max_length=4, min_length=4, title='BBox'
    )


class IngestState(StrEnum):
    neu = 'neu'
    verarbeitet = 'verarbeitet'
    fehler = 'fehler'


class IsoDate(RootModel[date]):
    root: date = Field(..., title='IsoDate')


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
    page_count: int = Field(..., ge=0)
    pages_with_text: int = Field(..., ge=0)
    duration_ms: int = Field(..., ge=0)


class SemesterUpdate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    name: str | None = Field(None, min_length=1)
    starts_on: IsoDate | None = None
    ends_on: IsoDate | None = None
    is_current: bool | None = None
    archived: bool | None = Field(
        None, description='true = archivieren, false = wiederherstellen'
    )


class TextBlock(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    text: str
    bbox: BBox


class Timestamp(RootModel[AwareDatetime]):
    root: AwareDatetime = Field(..., description='ISO 8601, UTC', title='Timestamp')


class Uuid(RootModel[UUID]):
    root: UUID = Field(..., description='UUIDv7 (03 §1)', title='Uuid')


class EntityMeta(BaseModel):
    """
    Pflichtfelder jeder Tabelle (03 §1)
    """

    id: Uuid
    user_id: Uuid
    created_at: Timestamp
    updated_at: Timestamp
    deleted_at: Timestamp | None


class ExerciseSheet(BaseModel):
    """
    Übungsblatt. Ergänzung zu 03 §4: ingest_state zeigt den Fortschritt von pdf.ingest für das Blatt.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: Uuid
    user_id: Uuid
    created_at: Timestamp
    updated_at: Timestamp
    deleted_at: Timestamp | None
    module_id: Uuid
    title: str
    number: int | None
    sha256: str = Field(..., pattern='^[a-f0-9]{64}$')
    page_count: int | None = Field(..., ge=0)
    due_at: Timestamp | None = Field(..., description='Abgabe, geht in den Planer')
    has_solution: bool = Field(
        ..., description='Musterlösung hinterlegt (F-ORG-05, Phase 3)'
    )
    ingest_state: IngestState


class ExerciseSheetList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[ExerciseSheet]
    next_cursor: str | None


class ExerciseSheetUpdate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    title: str | None = None
    number: int | None = None
    due_at: Timestamp | None = None


class Job(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: Uuid
    user_id: Uuid
    created_at: Timestamp
    updated_at: Timestamp
    deleted_at: Timestamp | None
    type: JobType
    payload: dict[str, Any] = Field(
        ..., description='Je nach type, z. B. PdfIngestPayload'
    )
    state: JobState
    priority: int = Field(..., description='Höher = früher')
    attempts: int = Field(..., ge=0)
    max_attempts: int = Field(..., ge=1)
    depends_on: list[Uuid]
    session_id: Uuid | None
    locked_by: str | None
    locked_at: Timestamp | None
    error: str | None
    result: dict[str, Any] | None
    run_after: Timestamp | None


class JobList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[Job]
    next_cursor: str | None


class Module(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: Uuid
    user_id: Uuid
    created_at: Timestamp
    updated_at: Timestamp
    deleted_at: Timestamp | None
    semester_id: Uuid
    name: str = Field(..., examples=['Datenbanksysteme'], min_length=1)
    short_name: str | None = Field(..., examples=['DBS'])
    color: ModuleColor
    ects: float | None = Field(..., ge=0.0)
    exam_type: str | None = Field(..., examples=['schriftlich', 'mündlich', 'Projekt'])
    lecturer: str | None
    lang: Lang | None
    description_md: str | None


class ModuleCreate(BaseModel):
    """
    Name genügt, alles andere optional (F-ORG-01). Ohne Farbe vergibt der Core die nächste freie Palettenfarbe. id ist optional und darf vom Client erzeugt werden (03 §1).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: Uuid | None = None
    semester_id: Uuid
    name: str = Field(..., min_length=1)
    short_name: str | None = None
    color: ModuleColor | None = None
    ects: float | None = Field(None, ge=0.0)
    exam_type: str | None = None
    lecturer: str | None = None
    lang: Lang | None = None
    description_md: str | None = None


class ModuleList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[Module]
    next_cursor: str | None


class ModuleUpdate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    semester_id: Uuid | None = None
    name: str | None = Field(None, min_length=1)
    short_name: str | None = None
    color: ModuleColor | None = None
    ects: float | None = Field(None, ge=0.0)
    exam_type: str | None = None
    lecturer: str | None = None
    lang: Lang | None = None
    description_md: str | None = None


class PdfIngestPayload(BaseModel):
    """
    pdf.ingest: genau eines von slide_deck_id oder exercise_sheet_id ist gesetzt (prüft der Core beim Anlegen). Ergänzung zu 08 §5: Übungsblätter laufen über denselben Job.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    slide_deck_id: Uuid | None = None
    exercise_sheet_id: Uuid | None = None


class Semester(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: Uuid
    user_id: Uuid
    created_at: Timestamp
    updated_at: Timestamp
    deleted_at: Timestamp | None
    name: str = Field(..., examples=['HS 2026'], min_length=1)
    starts_on: IsoDate | None
    ends_on: IsoDate | None
    is_current: bool = Field(..., description='Höchstens ein Semester ist aktuell')
    archived_at: Timestamp | None = Field(
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
    id: Uuid | None = None
    name: str = Field(..., min_length=1)
    starts_on: IsoDate | None = None
    ends_on: IsoDate | None = None
    is_current: bool | None = None


class SemesterList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[Semester]
    next_cursor: str | None


class Slide(BaseModel):
    """
    Eine Seite eines Foliensatzes. Bilder über GET /slides/{id}/image bzw. /thumb.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: Uuid
    user_id: Uuid
    created_at: Timestamp
    updated_at: Timestamp
    deleted_at: Timestamp | None
    deck_id: Uuid
    index: int = Field(..., description='1-basiert', ge=1)
    width_pt: float
    height_pt: float
    text: str = Field(..., description='Textlayer, leer wenn keiner vorhanden')
    text_blocks: list[TextBlock]
    vision_summary: str | None
    title: str | None
    chapter: str | None


class SlideDeck(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: Uuid
    user_id: Uuid
    created_at: Timestamp
    updated_at: Timestamp
    deleted_at: Timestamp | None
    module_id: Uuid
    session_id: Uuid | None
    title: str
    sha256: str = Field(..., pattern='^[a-f0-9]{64}$')
    page_count: int | None = Field(
        ..., description='null bis pdf.ingest gelaufen ist', ge=0
    )
    uploaded_at: Timestamp
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
    next_cursor: str | None


class Task(BaseModel):
    """
    Teilaufgabe eines Übungsblatts. Zerlegung erst ab Phase 2 (F-ORG-03).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: Uuid
    user_id: Uuid
    created_at: Timestamp
    updated_at: Timestamp
    deleted_at: Timestamp | None
    sheet_id: Uuid
    label: str = Field(..., examples=['2b'])
    page_index: int = Field(..., ge=1)
    bbox: BBox | None
    text: str
    solution_text: str | None


class UploadResult(BaseModel):
    """
    Antwort auf POST /slide-decks und POST /exercise-sheets. duplicate=true: Datei mit gleichem sha256 existiert schon, es wurde nichts angelegt (F-ORG-02 Sonderfall). id ist die ID des neuen bzw. bereits vorhandenen Objekts.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: Uuid
    duplicate: bool


class SchemaBundle(BaseModel):
    """
    GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen
    """

    ApiError_1: ApiError | None = Field(None, alias='ApiError')
    BBox_1: BBox | None = Field(None, alias='BBox')
    EntityMeta_1: EntityMeta | None = Field(None, alias='EntityMeta')
    ExerciseSheet_1: ExerciseSheet | None = Field(None, alias='ExerciseSheet')
    ExerciseSheetList_1: ExerciseSheetList | None = Field(
        None, alias='ExerciseSheetList'
    )
    ExerciseSheetUpdate_1: ExerciseSheetUpdate | None = Field(
        None, alias='ExerciseSheetUpdate'
    )
    IngestState_1: IngestState | None = Field(None, alias='IngestState')
    IsoDate_1: IsoDate | None = Field(None, alias='IsoDate')
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
    PdfIngestPayload_1: PdfIngestPayload | None = Field(None, alias='PdfIngestPayload')
    PdfIngestResult_1: PdfIngestResult | None = Field(None, alias='PdfIngestResult')
    Semester_1: Semester | None = Field(None, alias='Semester')
    SemesterCreate_1: SemesterCreate | None = Field(None, alias='SemesterCreate')
    SemesterList_1: SemesterList | None = Field(None, alias='SemesterList')
    SemesterUpdate_1: SemesterUpdate | None = Field(None, alias='SemesterUpdate')
    Slide_1: Slide | None = Field(None, alias='Slide')
    SlideDeck_1: SlideDeck | None = Field(None, alias='SlideDeck')
    SlideDeckDetail_1: SlideDeckDetail | None = Field(None, alias='SlideDeckDetail')
    SlideDeckList_1: SlideDeckList | None = Field(None, alias='SlideDeckList')
    Task_1: Task | None = Field(None, alias='Task')
    TextBlock_1: TextBlock | None = Field(None, alias='TextBlock')
    Timestamp_1: Timestamp | None = Field(None, alias='Timestamp')
    UploadResult_1: UploadResult | None = Field(None, alias='UploadResult')
    Uuid_1: Uuid | None = Field(None, alias='Uuid')
