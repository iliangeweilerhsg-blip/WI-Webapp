# GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen

from __future__ import annotations

from datetime import date
from enum import StrEnum
from typing import Any, Literal

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


class AiBudgetStatus(BaseModel):
    """
    Monatsbudget (F-DAT-05). Monat = Kalendermonat in Ortszeit
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    month: StrictStr = Field(..., pattern='^[0-9]{4}-(0[1-9]|1[0-2])$')
    spent_eur: StrictFloat = Field(
        ..., description='Euro (Schätzung, VERTRAEGE §20.5)', ge=0.0
    )
    budget_eur: StrictFloat = Field(
        ..., description='Euro (Schätzung, VERTRAEGE §20.5)', ge=0.0
    )
    reached: StrictBool = Field(
        ..., description='spent_eur ≥ budget_eur: KI-Jobs enden mit fehler'
    )
    warn: StrictBool = Field(..., description='spent_eur ≥ 80 % von budget_eur')


class AlignLogMode(StrEnum):
    """
    log: aus Folienwechseln. ohne_wechsel: Foliensatz, aber kein verwertbarer Wechsel (ganze Session auf Folie 1). folienlos: kein Foliensatz, keine Segmente
    """

    log = 'log'
    ohne_wechsel = 'ohne_wechsel'
    folienlos = 'folienlos'


class ApiErrorBody(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    code: StrictStr = Field(
        ..., examples=['slide_deck_not_found'], pattern='^[a-z][a-z0-9_]*$'
    )
    message: StrictStr
    details: dict[str, Any] | None = None


class Appearance(StrEnum):
    hell = 'hell'
    dunkel = 'dunkel'
    system = 'system'


class AudioCodec(StrEnum):
    opus = 'opus'
    aac = 'aac'


class MissingSeq(RootModel[StrictInt]):
    root: StrictInt = Field(..., ge=0)


class AudioGapReason(StrEnum):
    """
    fehlender_chunk: seq fehlt. zeitluecke: start_ms springt (z. B. Recorder neu gestartet)
    """

    fehlender_chunk = 'fehlender_chunk'
    zeitluecke = 'zeitluecke'


class AutoAcceptMode(StrEnum):
    """
    F-EIN-01 KI „automatisch annehmen“: aus, nur Beziehungen, alles mit Konfidenz ≥ 0,9
    """

    aus = 'aus'
    nur_beziehungen = 'nur_beziehungen'
    alles_ab_0_9 = 'alles_ab_0_9'


class BBox(RootModel[list[StrictFloat]]):
    """
    [x, y, w, h] in pt
    """

    root: list[StrictFloat] = Field(
        ..., description='[x, y, w, h] in pt', max_length=4, min_length=4, title='BBox'
    )


class BackupState(StrEnum):
    laeuft = 'laeuft'
    fertig = 'fertig'
    fehler = 'fehler'


class BackupTrigger(StrEnum):
    zeitplan = 'zeitplan'
    manuell = 'manuell'
    vor_migration = 'vor_migration'


class CalendarAssignment(StrEnum):
    """
    auto: Modul und Art hat der Abgleich gesetzt und darf sie ändern. manuell: vom Nutzer gesetzt, der Abgleich ändert module_id und kind nie mehr (F-KAL-02).
    """

    auto = 'auto'
    manuell = 'manuell'


class CalendarEventKind(StrEnum):
    vorlesung = 'vorlesung'
    uebung = 'uebung'
    tutorium = 'tutorium'
    pruefung = 'pruefung'
    fest = 'fest'
    lernblock_export = 'lernblock_export'


class CalendarReassignResult(BaseModel):
    """
    Antwort auf POST /calendar/reassign (lokal): Neuzuordnung aller Termine mit assigned_by=auto, z. B. nach dem Anlegen eines Moduls.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    changed: StrictInt = Field(
        ..., description='Termine, deren Modul oder Art sich geändert hat', ge=0
    )
    ohne_modul: StrictInt = Field(
        ...,
        description='Nicht abgesagte automatisch zugeordnete Termine ohne Modul danach',
        ge=0,
    )


class CalendarSourceKind(StrEnum):
    """
    google erst ab Phase 4 (F-KAL-03)
    """

    ics_file = 'ics_file'
    ics_url = 'ics_url'
    google = 'google'


class CalendarUpdateScope(StrEnum):
    """
    serie: alle Termine derselben Quelle mit gleicher external_uid (F-KAL-02). einzeln: nur dieser Termin.
    """

    serie = 'serie'
    einzeln = 'einzeln'


class ClientDevice(StrEnum):
    """
    Gerät, auf dem ein Ereignis entstanden ist
    """

    mac = 'mac'
    ipad = 'ipad'


class ColumnWidth(RootModel[StrictFloat]):
    root: StrictFloat = Field(..., ge=0.0, le=100.0)


class ColumnWidths(RootModel[list[ColumnWidth]]):
    """
    Spaltenbreiten Folie | Übung | Notizen in Prozent, Summe 100
    """

    root: list[ColumnWidth] = Field(
        ...,
        description='Spaltenbreiten Folie | Übung | Notizen in Prozent, Summe 100',
        max_length=3,
        min_length=3,
        title='ColumnWidths',
    )


class Alias(RootModel[StrictStr]):
    root: StrictStr = Field(..., max_length=200, min_length=1)


class ConceptKind(StrEnum):
    """
    Art eines Konzepts (05 §P7a, W-02 Option A: concept.kind)
    """

    definition = 'definition'
    verfahren = 'verfahren'
    modell = 'modell'
    satz = 'satz'
    beispiel = 'beispiel'


class ConceptProposal(BaseModel):
    """
    Ein von der KI gefundenes Konzept (05 §P7a), nach Prüfung der Belege
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    name: StrictStr = Field(
        ...,
        description='NFC, getrimmt, Leerraum zusammengefasst, ohne Steuerzeichen',
        max_length=200,
        min_length=1,
    )
    aliases: list[Alias] = Field(
        ...,
        description='weitere Namen, z. B. der englische Begriff (05 §1 Sprache)',
        max_length=20,
    )
    one_liner: StrictStr | None = Field(
        ..., description='„In einem Satz“', max_length=500, min_length=1
    )
    kind: ConceptKind | None
    importance: StrictInt = Field(..., description='1–3 (05 §P7a)', ge=1, le=3)
    exam_hint: StrictBool = Field(
        ..., description='Die KI hat einen Klausurhinweis erkannt'
    )
    prof_explanation: StrictStr | None = Field(
        ...,
        description='Kernaussage des Profs in 1–2 Sätzen',
        max_length=600,
        min_length=1,
    )
    confidence: StrictFloat = Field(
        ..., description='Selbsteinschätzung der KI, 0..1', ge=0.0, le=1.0
    )


class ConceptRelationKind(StrEnum):
    """
    Beziehungstyp (03 §7). „A baut_auf B“: B ist Voraussetzung von A. gegensatz und verwandt sind symmetrisch
    """

    baut_auf = 'baut_auf'
    beispiel_fuer = 'beispiel_fuer'
    gegensatz = 'gegensatz'
    angewendet_in = 'angewendet_in'
    verwandt = 'verwandt'


class ConceptRelationSource(StrEnum):
    """
    Herkunft einer Beziehung (03 §7)
    """

    ki = 'ki'
    manuell = 'manuell'
    wikilink = 'wikilink'


class Direction(StrEnum):
    """
    ausgehend: dieses Konzept ist from_id
    """

    ausgehend = 'ausgehend'
    eingehend = 'eingehend'


class ConceptStatus(StrEnum):
    """
    concept.status (03 §7). vorschlag: nur als Inbox-Vorschlag, zusammengefuehrt: merged_into gesetzt (Invariante 5)
    """

    vorschlag = 'vorschlag'
    aktiv = 'aktiv'
    zusammengefuehrt = 'zusammengefuehrt'


class CostByModel(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    provider: StrictStr = Field(..., min_length=1)
    model: StrictStr = Field(..., min_length=1)
    calls: StrictInt = Field(..., ge=0)
    input_tokens: StrictInt = Field(..., ge=0)
    output_tokens: StrictInt = Field(..., ge=0)
    cache_creation_input_tokens: StrictInt = Field(..., ge=0)
    cache_read_input_tokens: StrictInt = Field(..., ge=0)
    eur: StrictFloat = Field(
        ..., description='Euro (Schätzung, VERTRAEGE §20.5)', ge=0.0
    )


class CostByTask(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    task: StrictStr = Field(..., min_length=1)
    calls: StrictInt = Field(..., ge=0)
    eur: StrictFloat = Field(
        ..., description='Euro (Schätzung, VERTRAEGE §20.5)', ge=0.0
    )


class DashboardLayout(StrEnum):
    """
    Layout-Vorlagen F-DSH-01
    """

    standard = 'standard'
    folie_gross = 'folie_gross'
    notizen_gross = 'notizen_gross'
    fokus = 'fokus'


class DataSettings(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    backup_target: StrictStr | None = Field(
        ..., description='Absoluter Pfad, null = keine Backups'
    )
    backup_encryption: StrictBool = Field(
        ...,
        description='age mit Passphrase (P1). Die Passphrase steht nie in den Einstellungen',
    )
    backup_time: StrictStr = Field(
        ...,
        description='Ortszeit des Macs (Standard 03:00)',
        pattern='^([01][0-9]|2[0-3]):[0-5][0-9]$',
    )


class DataSettingsUpdate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    backup_target: StrictStr | None = Field(
        None, description='Absoluter Pfad, null = keine Backups'
    )
    backup_encryption: StrictBool | None = Field(
        None,
        description='age mit Passphrase (P1). Die Passphrase steht nie in den Einstellungen',
    )
    backup_time: StrictStr | None = Field(
        None,
        description='Ortszeit des Macs (Standard 03:00)',
        pattern='^([01][0-9]|2[0-3]):[0-5][0-9]$',
    )


class DeviceKind(StrEnum):
    ipad = 'ipad'
    iphone = 'iphone'


class Text(RootModel[StrictStr]):
    root: StrictStr = Field(..., max_length=2000, min_length=1)


class EmbedRequest(BaseModel):
    """
    POST /embed des Loopback-Endpunkts (VERTRAEGE §19.4). Body höchstens 256 KB
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    texts: list[Text] = Field(..., max_length=16, min_length=1)


class Vector(RootModel[list[StrictFloat]]):
    root: list[StrictFloat] = Field(..., max_length=1024, min_length=1024)


class EmbedResponse(BaseModel):
    """
    Antwort von POST /embed: ein L2-normierter Vektor je Text, in derselben Reihenfolge
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    model: StrictStr = Field(..., min_length=1)
    dim: Literal[1024]
    vectors: list[Vector] = Field(..., max_length=16, min_length=1)


class EmbedderState(StrEnum):
    """
    Zustand des Embedders im Worker (VERTRAEGE §19.2)
    """

    bereit = 'bereit'
    laedt = 'laedt'
    nicht_verfuegbar = 'nicht_verfuegbar'


class ExtractedRelation(BaseModel):
    """
    Beziehung zwischen zwei Konzepten derselben Vorlesung
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    from_: StrictStr = Field(..., alias='from', pattern='^c[0-9]+$')
    to: StrictStr = Field(..., pattern='^c[0-9]+$')
    kind: ConceptRelationKind
    why: StrictStr = Field(..., max_length=500, min_length=1)
    confidence: StrictFloat = Field(
        ..., description='Selbsteinschätzung der KI, 0..1', ge=0.0, le=1.0
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


class HexColor(RootModel[StrictStr]):
    root: StrictStr = Field(
        ...,
        description='RGBA als #RRGGBBAA',
        examples=['#1E2A44FF'],
        pattern='^#[0-9A-Fa-f]{8}$',
        title='HexColor',
    )


class IcsImportCounts(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    neu: StrictInt = Field(..., ge=0)
    geaendert: StrictInt = Field(..., ge=0)
    entfallen: StrictInt = Field(..., ge=0)
    unveraendert: StrictInt = Field(..., ge=0)
    zugeordnet: StrictInt = Field(
        ..., description='In diesem Lauf automatisch einem Modul zugeordnet', ge=0
    )
    ohne_modul: StrictInt = Field(
        ...,
        description='Nicht abgesagte Termine der Quelle ohne Modul nach dem Lauf',
        ge=0,
    )


class IcsWarning(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    code: StrictStr = Field(
        ...,
        examples=['rrule_unsupported', 'timezone_unknown'],
        pattern='^[a-z][a-z0-9_]*$',
    )
    message: StrictStr
    external_uid: StrictStr | None


class InboxBlockedReason(StrEnum):
    """
    Warum eine Beziehung noch nicht annehmbar ist: ein Endpunkt ist noch Vorschlag bzw. wurde abgelehnt
    """

    endpunkt_offen = 'endpunkt_offen'
    endpunkt_abgelehnt = 'endpunkt_abgelehnt'


class Action(StrEnum):
    """
    Massenaktion
    """

    accept = 'accept'
    reject = 'reject'
    reopen = 'reopen'


class Action1(StrEnum):
    """
    Wirkung
    """

    angenommen_neu = 'angenommen_neu'
    zusammengefuehrt = 'zusammengefuehrt'
    beziehung_bestaetigt = 'beziehung_bestaetigt'
    abgelehnt = 'abgelehnt'


class AddedAliase(RootModel[StrictStr]):
    root: StrictStr = Field(..., max_length=200, min_length=1)


class InboxKind(StrEnum):
    """
    Art eines Inbox-Eintrags (03 §8). Weitere Arten (card_batch, slide_correction, …) kommen mit ihren Tickets
    """

    concept_new = 'concept_new'
    concept_merge = 'concept_merge'
    relation = 'relation'


class InboxStatus(StrEnum):
    """
    Status eines Inbox-Eintrags (03 §8). automatisch: nach der Einstellung ai.auto_accept angenommen
    """

    offen = 'offen'
    angenommen = 'angenommen'
    abgelehnt = 'abgelehnt'
    automatisch = 'automatisch'


class IngestState(StrEnum):
    neu = 'neu'
    verarbeitet = 'verarbeitet'
    fehler = 'fehler'


class InkMode(StrEnum):
    """
    Schreibmodus F-INK-03
    """

    freie_seite = 'freie_seite'
    auf_folie = 'auf_folie'


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


class LanguageCode(RootModel[StrictStr]):
    root: StrictStr = Field(
        ...,
        description='Von Whisper erkannte Sprache, ISO 639-1 (z. B. de, en)',
        examples=['de'],
        pattern='^[a-z]{2,3}$',
        title='LanguageCode',
    )


class LlmIssue(StrEnum):
    """
    Warum die KI nicht eingerichtet ist (VERTRAEGE §20.5)
    """

    kein_schluessel = 'kein_schluessel'
    env_offen = 'env_offen'
    unbekannter_anbieter = 'unbekannter_anbieter'


class MaintenanceNightlyPayload(BaseModel):
    """
    maintenance.nightly (08 §5, T1-18). Phase 1: Papierkorb leeren, verwaiste Dateien, sync_op gelöschter Ströme
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    purge_older_than_days: StrictInt | None = Field(
        None, description='Standard 30 (F-DAT-04)', ge=1
    )
    dry_run: StrictBool | None = Field(None, description='Nur zählen, nichts löschen')


class PurgedByKind(RootModel[StrictInt]):
    root: StrictInt = Field(..., ge=0)


class MaintenanceNightlyResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    purged_count: StrictInt = Field(..., ge=0)
    purged_by_kind: dict[str, PurgedByKind] = Field(
        ..., description='Endgültig gelöschte Objekte je Tabelle'
    )
    orphan_files_removed: StrictInt = Field(..., ge=0)
    sync_ops_removed: StrictInt = Field(..., ge=0)
    job_duration_ms: StrictInt = Field(..., ge=0)


class MarkerKind(StrEnum):
    frage = 'frage'
    klausur = 'klausur'
    verknuepfung = 'verknuepfung'


class MarkerPosition(BaseModel):
    """
    Stelle auf der Seite in pt (Ursprung oben links)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    x: StrictFloat
    y: StrictFloat


class MarkerSource(StrEnum):
    ipad = 'ipad'
    mac = 'mac'
    detektor = 'detektor'


class MergeBasis(StrEnum):
    """
    Grund eines concept_merge-Vorschlags: ki = KI-Entscheidung „gleich“, name = gleicher Name/Alias ohne Embedder (degradiert)
    """

    ki = 'ki'
    name = 'name'


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


class ModuleSettings(BaseModel):
    """
    module.settings (W-06 Option A, 03 §3). Fehlender Schlüssel = globaler Standard aus Settings.lecture
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    layout: DashboardLayout | None = None
    column_widths: list[ColumnWidth] | None = Field(
        None,
        description='Spaltenbreiten Folie | Übung | Notizen in Prozent, Summe 100',
        max_length=3,
        min_length=3,
        title='ColumnWidths',
    )
    ink_mode: InkMode | None = None


class ModuleSettingsUpdate(BaseModel):
    """
    Teil von ModuleUpdate.settings: Schlüssel für Schlüssel zusammenführen, null entfernt den Schlüssel
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    layout: DashboardLayout | None = None
    column_widths: ColumnWidths | None = None
    ink_mode: InkMode | None = None


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


class MoodleAutoAssignResult(BaseModel):
    """
    Antwort von POST /moodle/auto-assign (#141): was die automatische Kurszuordnung in diesem Lauf getan hat
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    assigned: StrictInt = Field(
        ..., description='Kurse, die einem bestehenden Modul zugeordnet wurden', ge=0
    )
    created: StrictInt = Field(..., description='Neu angelegte Module', ge=0)


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


class MoodleCourseCategory(StrEnum):
    """
    aktuell = wird vorgeschlagen. organisatorisch (z. B. „Klausurtermine …“) und alt (Start vor dem aktuellen Semester) werden standardmäßig nicht vorgeschlagen (F-MDL-03)
    """

    aktuell = 'aktuell'
    organisatorisch = 'organisatorisch'
    alt = 'alt'


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


class KindSource(StrEnum):
    """
    manuell = Entscheidung in der Inbox, gilt für die ganze Aktivität
    """

    auto = 'auto'
    manuell = 'manuell'


class LastError(StrEnum):
    """
    Warum die Datei zuletzt nicht übernommen wurde. Ein späterer Abgleich versucht es erneut (außer kein_pdf)
    """

    kein_pdf = 'kein_pdf'
    zu_gross = 'zu_gross'
    nicht_gefunden = 'nicht_gefunden'
    download_fehlgeschlagen = 'download_fehlgeschlagen'


class MoodleItemKind(StrEnum):
    """
    Einordnung einer Datei aus Moodle (F-MDL-04). offen = wartet auf die Entscheidung in der Inbox
    """

    folien = 'folien'
    uebung = 'uebung'
    ignoriert = 'ignoriert'
    offen = 'offen'


class Kind(StrEnum):
    folien = 'folien'
    uebung = 'uebung'
    ignoriert = 'ignoriert'
    offen = 'offen'


class MoodleItemUpdate(BaseModel):
    """
    Body von PATCH /moodle/items/{id}: Entscheidung aus der Inbox („Als Folien / Übung / ignorieren“, gilt für die ganze Aktivität). offen = Entscheidung rückgängig machen (R15)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Kind


class MoodleLinkAuto(StrEnum):
    """
    Automatische Zuordnung (#141): zugeordnet = eindeutig passendes Modul, angelegt = Modul aus dem Kursnamen angelegt
    """

    zugeordnet = 'zugeordnet'
    angelegt = 'angelegt'


class ParentId(RootModel[StrictInt]):
    root: StrictInt = Field(..., description='Moodle-ID', ge=1)


class TimeLimitMinutes(RootModel[StrictInt]):
    root: StrictInt = Field(..., ge=0)


class MoodleSubmissionState(StrEnum):
    keine = 'keine'
    entwurf = 'entwurf'
    eingereicht = 'eingereicht'


class MoodleSyncRequest(BaseModel):
    """
    Body von POST /moodle/sync („Jetzt abgleichen“). Ohne course_id alle zugeordneten Kurse
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    course_id: StrictInt | None = Field(None, description='Moodle-ID', ge=1)


class FailedCourse(RootModel[StrictInt]):
    root: StrictInt = Field(..., description='Moodle-ID', ge=1)


class MoodleSyncState(StrEnum):
    """
    aus = Moodle nicht eingerichtet. pausiert = Token ungültig oder abgelaufen (F-MDL-01), der Abgleich wartet auf einen neuen Token
    """

    aus = 'aus'
    bereit = 'bereit'
    laeuft = 'laeuft'
    pausiert = 'pausiert'


class MoodleSyncTrigger(StrEnum):
    """
    Anlass eines Abgleichs
    """

    start = 'start'
    zeitplan = 'zeitplan'
    manuell = 'manuell'
    entscheidung = 'entscheidung'
    zuordnung = 'zuordnung'


class Source(StrEnum):
    aufgabe = 'aufgabe'
    termin = 'termin'


class AssignmentId(RootModel[StrictInt]):
    root: StrictInt = Field(..., description='Moodle-ID', ge=1)


class EventId(RootModel[StrictInt]):
    root: StrictInt = Field(..., description='Moodle-ID', ge=1)


class NotebookKind(StrEnum):
    vorlesung = 'vorlesung'
    uebung = 'uebung'
    frei = 'frei'


class PageTemplate(StrEnum):
    blanko = 'blanko'
    liniert = 'liniert'
    kariert = 'kariert'
    punktraster = 'punktraster'
    cornell = 'cornell'
    folie = 'folie'


class PairStartRequest(BaseModel):
    """
    POST /devices/pair/start (aus dem Netz ohne Token erlaubt). Nur bei offenem Kopplungsfenster; belegt es nicht exklusiv
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    device_name: StrictStr = Field(..., max_length=64, min_length=1)
    kind: DeviceKind
    public_nonce: StrictStr = Field(
        ...,
        description='Zufallswert des iPads (base64url, ≥ 128 Bit)',
        pattern='^[A-Za-z0-9_-]{22,128}$',
    )


class PdfIngestResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    page_count: StrictInt = Field(..., ge=0)
    pages_with_text: StrictInt = Field(..., ge=0)
    duration_ms: StrictInt = Field(..., ge=0)


class PencilDoubleTapAction(StrEnum):
    """
    system = Einstellung von iPadOS übernehmen
    """

    radierer = 'radierer'
    letztes_werkzeug = 'letztes_werkzeug'
    farbpalette = 'farbpalette'
    system = 'system'
    aus = 'aus'


class PencilSqueezeAction(StrEnum):
    werkzeugpalette = 'werkzeugpalette'
    radierer = 'radierer'
    system = 'system'
    aus = 'aus'


class PhotoMime(StrEnum):
    image_heic = 'image/heic'
    image_jpeg = 'image/jpeg'


class PipelineStep(StrEnum):
    """
    Schritte der Kette nach dem Session-Ende (05 §2, VERTRAEGE §18.2 und §20.2). Reihenfolge = Anzeige-Reihenfolge
    """

    audio_finalize = 'audio.finalize'
    transcribe = 'transcribe'
    align_log = 'align.log'
    concepts_extract = 'concepts.extract'
    concepts_resolve = 'concepts.resolve'
    summary_write = 'summary.write'


class Point2(RootModel[list[StrictFloat]]):
    """
    [x, y] in pt
    """

    root: list[StrictFloat] = Field(
        ..., description='[x, y] in pt', max_length=2, min_length=2, title='Point2'
    )


class RecordingComplete(BaseModel):
    """
    POST /recordings/{id}/complete: der Client hat den letzten Chunk hochgeladen. Der Core stellt audio.finalize ein.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    last_seq: StrictInt = Field(..., ge=0)
    duration_ms: StrictInt = Field(
        ..., description='Aufgenommene Länge laut Client', ge=0
    )


class RecordingState(StrEnum):
    laeuft = 'laeuft'
    vollstaendig = 'vollstaendig'
    mit_luecken = 'mit_luecken'


class ResolveVerdict(StrEnum):
    """
    Entscheidung im Abgleich (05 §P8, Band 0,75–0,88). Abbildung auf Inbox-Arten: VERTRAEGE §20.3
    """

    gleich = 'gleich'
    teil_von = 'teil_von'
    verwandt = 'verwandt'
    verschieden = 'verschieden'


class RestoreTestReason(StrEnum):
    """
    Grund eines fehlgeschlagenen Restore-Tests, die Oberfläche leitet daraus die Handlungsempfehlung ab
    """

    kein_ziel = 'kein_ziel'
    kein_backup = 'kein_backup'
    ziel_nicht_erreichbar = 'ziel_nicht_erreichbar'
    nicht_authentisch = 'nicht_authentisch'
    beschaedigt = 'beschaedigt'
    dateien_abweichend = 'dateien_abweichend'
    tabellen_fehlen = 'tabellen_fehlen'
    restore_fehlgeschlagen = 'restore_fehlgeschlagen'
    abgebrochen = 'abgebrochen'
    intern = 'intern'


class RestoreTestState(StrEnum):
    laeuft = 'laeuft'
    ok = 'ok'
    fehler = 'fehler'


class RestoreTestTrigger(StrEnum):
    zeitplan = 'zeitplan'
    manuell = 'manuell'


class ReviewState(StrEnum):
    """
    Nacharbeitung (F-NAC-05, Phase 2)
    """

    offen = 'offen'
    in_arbeit = 'in_arbeit'
    erledigt = 'erledigt'


class SearchDegraded1(StrEnum):
    """
    Warum nur Wortsuche lief. null bei mode = hybrid oder ohne Wörter
    """

    embedder_not_ready = 'embedder_not_ready'
    embedder_unavailable = 'embedder_unavailable'


class SearchIndexScope(StrEnum):
    """
    Ziel eines search.index-Jobs: ein Foliensatz (Folien) oder eine Session (Transkript-Fenster)
    """

    deck = 'deck'
    session = 'session'


class SearchKind(StrEnum):
    """
    Art eines Sucheintrags (search_chunk.source_kind). Konzepte, Notizen, Aufgaben, Karten und Fotos kommen mit ihren Tickets als neue Werte dazu
    """

    slide = 'slide'
    transcript = 'transcript'


class Mode(StrEnum):
    hybrid = 'hybrid'
    text = 'text'


class UnresolvedItem(RootModel[StrictStr]):
    root: StrictStr = Field(..., min_length=1)


class SearchSnippetPart(BaseModel):
    """
    Teil eines Ausschnitts. hit = Treffer-Wort (als <mark> darstellen). Immer als Text rendern, nie als HTML
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    text: StrictStr = Field(..., min_length=1)
    hit: StrictBool


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


class SessionExtendRequest(BaseModel):
    """
    POST /sessions/{id}/extend: Auto-Stopp aufschieben (F-SES-03). minutes fehlt = lecture.auto_stop_extend_min
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    minutes: StrictInt | None = Field(None, ge=1, le=120)


class SessionMs(RootModel[StrictInt]):
    root: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )


class SessionReprocessRequest(BaseModel):
    """
    POST /sessions/{id}/reprocess: Kette ab from_step neu anstoßen (VERTRAEGE §18.5)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    from_step: PipelineStep | None = Field(
        None,
        description='Standard transcribe. Alle späteren Schritte laufen mit (VERTRAEGE §18.2)',
    )
    force: StrictBool | None = Field(
        None,
        description='Standard false. true: auch unveränderte Eingaben neu verarbeiten',
    )


class SessionState(StrEnum):
    """
    Zustandsautomat F-SES-01, Übergänge in docs/VERTRAEGE.md
    """

    geplant = 'geplant'
    bereit = 'bereit'
    laeuft = 'laeuft'
    pausiert = 'pausiert'
    beendet = 'beendet'
    verpasst = 'verpasst'
    verarbeitet = 'verarbeitet'


class ShapeKind(StrEnum):
    rectangle = 'rectangle'
    ellipse = 'ellipse'
    line = 'line'
    arrow = 'arrow'
    triangle = 'triangle'
    diamond = 'diamond'


class SlideDeckUpdate(BaseModel):
    """
    PATCH /slide-decks/{id}
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    title: StrictStr | None = Field(None, min_length=1)


class SlideEventSource(StrEnum):
    manuell_mac = 'manuell_mac'
    manuell_ipad = 'manuell_ipad'
    korrektur = 'korrektur'


class SlideSegmentSource(StrEnum):
    """
    Herkunft (03 §5). Phase 2 erster Schnitt: nur log (align.log)
    """

    log = 'log'
    ausrichtung = 'ausrichtung'
    manuell = 'manuell'


class StopReason(StrEnum):
    manuell = 'manuell'
    kalenderende = 'kalenderende'
    stille = 'stille'
    maximaldauer = 'maximaldauer'
    absturz_wiederhergestellt = 'absturz_wiederhergestellt'


class StrokeLayer(StrEnum):
    ink = 'ink'
    highlight = 'highlight'


class StrokeTool(StrEnum):
    pen = 'pen'
    pencil = 'pencil'
    marker = 'marker'
    monoline = 'monoline'
    fountain = 'fountain'


class SyncClientKind(StrEnum):
    ipad = 'ipad'
    web = 'web'


class SyncErrorCode(StrEnum):
    protocol_unsupported = 'protocol_unsupported'
    hello_required = 'hello_required'
    hello_invalid = 'hello_invalid'
    device_token_invalid = 'device_token_invalid'
    message_invalid = 'message_invalid'
    too_many_pending = 'too_many_pending'
    op_id_reused = 'op_id_reused'
    stream_mismatch = 'stream_mismatch'
    module_not_found = 'module_not_found'
    session_not_found = 'session_not_found'
    session_transition_invalid = 'session_transition_invalid'
    notebook_not_found = 'notebook_not_found'
    notebook_kind_exists = 'notebook_kind_exists'
    page_not_found = 'page_not_found'
    page_version_conflict = 'page_version_conflict'
    op_not_allowed = 'op_not_allowed'
    session_superseded = 'session_superseded'
    internal_error = 'internal_error'


class SyncOrigin(StrEnum):
    """
    Wer die Operation erzeugt hat (vom Server gesetzt)
    """

    ipad = 'ipad'
    web = 'web'
    server = 'server'


class SyncPing(BaseModel):
    """
    Keepalive des Clients alle 15 s
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['ping']


class SyncPong(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['pong']


class SyncStreamId(RootModel[StrictStr]):
    root: StrictStr = Field(
        ...,
        description='Strom (08 §2.2): notebook:<id>, session:<id> oder user',
        pattern='^((notebook|session):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|user)$',
        title='SyncStreamId',
    )


class SyncTimeOffset(BaseModel):
    """
    Ergebnis des Uhrabgleichs an den Server (device.clock_offset_ms). Ergänzung zu 08 §2.1
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['time.offset']
    offset_ms: StrictInt = Field(..., description='Gemessener Versatz Server − Client')
    rtt_ms: StrictInt = Field(..., description='Median der Umlaufzeit', ge=0)


class SyncTimePing(BaseModel):
    """
    t0 = lokale Uhr des Clients beim Senden (F-SYN-02)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['time.ping']
    t0: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )


class SyncTimePong(BaseModel):
    """
    ts = Serveruhr beim Antworten. Versatz = Median über 5 Runden von ts − (t0 + t1) / 2
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['time.pong']
    t0: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    ts: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )


class SyncUnsubscribe(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['unsubscribe']
    streams: list[SyncStreamId] = Field(..., min_length=1)


class TextBlock(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    text: StrictStr
    bbox: list[StrictFloat] = Field(
        ..., description='[x, y, w, h] in pt', max_length=4, min_length=4, title='BBox'
    )


class TextSize(StrEnum):
    s = 's'
    m = 'm'
    l = 'l'


class ToolbarSide(StrEnum):
    """
    Händigkeit: Seite der Werkzeugleiste auf dem iPad
    """

    links = 'links'
    rechts = 'rechts'


class TranscribeOutcome(StrEnum):
    """
    transkribiert: neu geschrieben. unveraendert: gleicher input_hash, übersprungen. ohne_audio: keine full.m4a (altes Transkript entfernt)
    """

    transkribiert = 'transkribiert'
    unveraendert = 'unveraendert'
    ohne_audio = 'ohne_audio'


class TranscriptProvider(StrEnum):
    """
    Transcriber im Worker (02 §7). fake nur für CI und Linux (VERTRAEGE §18.6). Cloud-Anbieter kommen als neue Werte
    """

    mlx_whisper = 'mlx-whisper'
    fake = 'fake'


class TranscriptWord(BaseModel):
    """
    Wort mit Zeitstempel (05 §P4). Zeiten in Sitzungszeit. text ohne führende und abschließende Leerzeichen, Satzzeichen bleiben am Wort
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    text: StrictStr = Field(..., min_length=1)
    start_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    end_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    prob: StrictFloat = Field(
        ..., description='Wahrscheinlichkeit laut Whisper', ge=0.0, le=1.0
    )


class TrashKind(StrEnum):
    semester = 'semester'
    module = 'module'
    slide_deck = 'slide_deck'
    exercise_sheet = 'exercise_sheet'
    calendar_source = 'calendar_source'
    session = 'session'
    notebook = 'notebook'
    page = 'page'
    marker = 'marker'
    photo = 'photo'


class Uuid(RootModel[StrictStr]):
    root: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )


class Embedder(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    provider: StrictStr = Field(..., examples=['bge-m3', 'fake'], min_length=1)
    model: StrictStr = Field(
        ..., examples=['BAAI/bge-m3', 'fake-embed-1'], min_length=1
    )
    dim: Literal[1024]
    state: EmbedderState
    error: StrictStr | None = Field(
        ..., description='Grund bei nicht_verfuegbar, sonst null', max_length=500
    )


class WorkerLlmStatus(BaseModel):
    """
    KI-Anbieter des Workers (GET /health des Workers, Feld llm). Nie der Schlüssel selbst
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    provider: StrictStr = Field(
        ..., description='anthropic | fake (SG_LLM)', min_length=1
    )
    configured: StrictBool = Field(
        ..., description='true: Aufrufe möglich (Schlüssel vorhanden bzw. Fake)'
    )
    issue: LlmIssue | None


class AiSettings(BaseModel):
    """
    Einstellungen KI (F-EIN-01, VERTRAEGE §20.7). Bereich ai in setting
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    monthly_budget_eur: StrictFloat = Field(
        ...,
        description='Monatsbudget in Euro, Standard 10. 0 schaltet Cloud-KI ab',
        ge=0.0,
        le=1000.0,
    )
    auto_accept: AutoAcceptMode


class AiSettingsUpdate(BaseModel):
    """
    Teil von SettingsUpdate.ai
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    monthly_budget_eur: StrictFloat | None = Field(None, ge=0.0, le=1000.0)
    auto_accept: AutoAcceptMode | None = None


class AiStatus(BaseModel):
    """
    GET /ai/status
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    worker_reachable: StrictBool
    llm: WorkerLlmStatus | None
    budget: AiBudgetStatus


class AlignLogPayload(BaseModel):
    """
    align.log (08 §5, VERTRAEGE §18.3)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )


class AlignLogResult(BaseModel):
    """
    job.result von align.log
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    slide_deck_id: Uuid | None
    mode: AlignLogMode
    timeline_end_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    event_count: StrictInt = Field(..., description='Gelesene slide_event', ge=0)
    skipped_events: StrictInt = Field(
        ..., description='Durchgänge (Standzeit unter 1,5 s)', ge=0
    )
    unresolved_events: StrictInt = Field(
        ..., description='slide_index ohne Folie im Foliensatz', ge=0
    )
    segment_count: StrictInt = Field(..., ge=0)
    session_deleted: StrictBool
    job_duration_ms: StrictInt = Field(..., ge=0)


class ApiError(BaseModel):
    """
    Fehlerformat der REST-API (08 §1)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    error: ApiErrorBody


class AudioChunk(BaseModel):
    """
    Antwort auf PUT /recordings/{id}/chunks/{seq}
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    recording_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    seq: StrictInt = Field(..., ge=0)
    start_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    duration_ms: StrictInt = Field(..., ge=1)
    sha256: StrictStr = Field(
        ...,
        description='SHA-256, hex, Kleinbuchstaben',
        pattern='^[a-f0-9]{64}$',
        title='Sha256',
    )
    size_bytes: StrictInt = Field(..., ge=1)
    received_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    duplicate: StrictBool = Field(
        ..., description='true: identischer Chunk lag schon vor (200 statt 201)'
    )


class AudioChunkMeta(BaseModel):
    """
    Geparste Metadaten von PUT /recordings/{id}/chunks/{seq}: Header X-Start-Ms, X-Duration-Ms (Dezimalzahlen), X-Sha256 (hex des Bodys)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    seq: StrictInt = Field(
        ..., description='Pfad {seq}, 0-basiert, lückenlos (Invariante 2)', ge=0
    )
    start_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    duration_ms: StrictInt = Field(..., ge=1)
    sha256: StrictStr = Field(
        ...,
        description='SHA-256, hex, Kleinbuchstaben',
        pattern='^[a-f0-9]{64}$',
        title='Sha256',
    )


class AudioFinalizePayload(BaseModel):
    """
    audio.finalize (08 §5)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    recording_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )


class AudioGap(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    start_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    duration_ms: StrictInt = Field(..., ge=1)
    reason: AudioGapReason


class BackupRun(BaseModel):
    """
    Ein Backup-Lauf (03 §13 backup_run)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    started_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    finished_at: AwareDatetime | None
    target: StrictStr = Field(..., description='Absoluter Pfad des Ziels')
    size_bytes: StrictInt | None = Field(..., ge=0)
    state: BackupState
    error: StrictStr | None
    trigger: BackupTrigger
    stand: StrictStr | None = Field(
        ...,
        description='Name des Stands für sg restore <stand>, z. B. 20261104T030012Z. null solange er läuft oder bei Fehler',
        pattern='^[0-9]{8}T[0-9]{6}Z$',
    )
    warning: StrictStr | None = Field(
        ...,
        description='Warnung zum Lauf, z. B. ein alter Stand, der sich seit mehreren Läufen nicht aus dem Ziel entfernen lässt (VERTRAEGE §13). null = keine',
        max_length=500,
    )


class CalendarEvent(BaseModel):
    """
    Termin. session_id ist abgeleitet: die nicht gelöschte Session zu diesem Termin.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    source_id: Uuid | None
    external_uid: StrictStr | None = Field(
        ..., description='UID aus der Quelle, null bei manuellen Terminen'
    )
    recurrence_id: StrictStr | None = Field(
        ...,
        description='Kennung des Vorkommens: ISO 8601 mit Offset der Ortszeit (2026-10-20T10:15:00+02:00) bzw. Datum (2026-11-01) bei ganztägigen Serien. null bei Einzelterminen. Abgleichschlüssel: (source_id, external_uid, recurrence_id)',
    )
    module_id: Uuid | None
    kind: CalendarEventKind
    assigned_by: CalendarAssignment
    title: StrictStr
    location: StrictStr | None
    description: StrictStr | None = Field(
        ..., description='DESCRIPTION aus der Quelle. Ergänzung zu 03 §3'
    )
    starts_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    ends_at: AwareDatetime = Field(..., description='ISO 8601, UTC', title='Timestamp')
    all_day: StrictBool = Field(
        ...,
        description='Ganztägig (VALUE=DATE). starts_at/ends_at sind dann 00:00 UTC des Datums (wie tests/fixtures/ics/08). Ergänzung zu 03 §3',
    )
    cancelled: StrictBool
    session_id: Uuid | None


class CalendarEventList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[CalendarEvent]
    next_cursor: StrictStr | None


class CalendarEventUpdate(BaseModel):
    """
    PATCH /calendar/events/{id}. Setzt assigned_by=manuell. scope fehlt = serie. Antwort: CalendarEventList mit allen geänderten Terminen.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    module_id: Uuid | None = None
    kind: CalendarEventKind | None = None
    scope: CalendarUpdateScope | None = None


class CalendarSource(BaseModel):
    """
    Kalenderquelle
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    kind: CalendarSourceKind
    name: StrictStr = Field(
        ...,
        description='Anzeigename. Ergänzung zu 03 §3. Standard: Dateiname bzw. Host der URL',
        min_length=1,
    )
    url: StrictStr | None = Field(
        ..., description='Nur bei ics_url (webcal:// wird als https:// gespeichert)'
    )
    last_synced_at: AwareDatetime | None
    last_error: StrictStr | None = Field(
        ...,
        description='Fehler des letzten Abgleichs, null nach Erfolg. Ergänzung zu 03 §3',
    )
    readonly: StrictBool
    event_count: StrictInt = Field(
        ..., description='Abgeleitet: Termine dieser Quelle (ohne gelöschte)', ge=0
    )


class CalendarSourceCreate(BaseModel):
    """
    JSON-Body von POST /calendar/sources für eine ICS-URL. Eine ICS-Datei kommt stattdessen als multipart (Felder file, name). Antwort: IcsImportResult.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr | None = Field(
        None,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    url: StrictStr = Field(
        ...,
        description='ICS-URL (Abo, Abgleich alle 6 h und beim Start)',
        pattern='^(https?|webcal)://',
    )
    name: StrictStr | None = Field(None, min_length=1)


class CalendarSourceList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[CalendarSource]
    next_cursor: StrictStr | None


class Concept(BaseModel):
    """
    Konzept (03 §7). Gehört keinem Fach allein (concept_module). Ohne embedding, vault_path und block_hashes (kommen mit dem Vault)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    name: StrictStr = Field(
        ...,
        description='NFC, getrimmt, Leerraum zusammengefasst, ohne Steuerzeichen',
        max_length=200,
        min_length=1,
    )
    aliases: list[Alias] = Field(
        ...,
        description='weitere Namen, z. B. der englische Begriff (05 §1 Sprache)',
        max_length=20,
    )
    kind: ConceptKind | None
    one_liner: StrictStr | None = Field(
        ..., description='„In einem Satz“', max_length=500, min_length=1
    )
    status: ConceptStatus
    merged_into: Uuid | None
    exam_relevant: StrictBool
    importance_base: StrictFloat = Field(
        ...,
        description='Startwert der Wichtigkeit (W-05: importance 1|2|3 → 0,8|1,0|1,3)',
        ge=0.0,
        le=2.0,
    )


class ConceptEdit(BaseModel):
    """
    Änderungen beim Annehmen eines Konzept-Vorschlags
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    name: StrictStr | None = Field(
        None,
        description='NFC, getrimmt, Leerraum zusammengefasst, ohne Steuerzeichen',
        max_length=200,
        min_length=1,
    )
    aliases: list[Alias] | None = Field(
        None,
        description='weitere Namen, z. B. der englische Begriff (05 §1 Sprache)',
        max_length=20,
    )
    one_liner: StrictStr | None = Field(
        None, description='„In einem Satz“', max_length=500, min_length=1
    )
    kind: ConceptKind | None = None


class Other(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    name: StrictStr = Field(
        ...,
        description='NFC, getrimmt, Leerraum zusammengefasst, ohne Steuerzeichen',
        max_length=200,
        min_length=1,
    )
    status: ConceptStatus


class ConceptRelationView(BaseModel):
    """
    Bestätigte Beziehung aus Sicht eines Konzepts
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    kind: ConceptRelationKind
    direction: Direction = Field(
        ..., description='ausgehend: dieses Konzept ist from_id'
    )
    other: Other
    source: ConceptRelationSource
    confidence: StrictFloat | None = Field(..., ge=0.0, le=1.0)
    cross_module: StrictBool = Field(
        ...,
        description='Fächerbrücke (05 §P8.4): die beiden Konzepte haben kein gemeinsames Modul',
    )


class ConceptsExtractPayload(BaseModel):
    """
    concepts.extract (VERTRAEGE §20.2). job.session_id ist gesetzt
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    force: StrictBool | None = Field(
        None, description='true: auch bei gleichem input_hash neu aufrufen'
    )


class ConceptsResolvePayload(BaseModel):
    """
    concepts.resolve (VERTRAEGE §20.3). job.session_id ist gesetzt
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    extract_job_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    force: StrictBool | None = Field(
        None, description='true: auch bei unverändertem Extrakt neu abgleichen'
    )


class ConceptsResolveResult(BaseModel):
    """
    Ergebnis von concepts.resolve
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    extract_job_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    extract_input_hash: StrictStr | None = Field(..., pattern='^[0-9a-f]{64}$')
    resolve_version: StrictInt = Field(
        ..., description='RESOLVE_VERSION des Workers', ge=1
    )
    session_deleted: StrictBool
    unchanged: StrictBool = Field(
        ...,
        description='true: gleicher Extrakt wie beim letzten fertigen Abgleich, nichts geschrieben',
    )
    auto_merged: StrictInt = Field(
        ...,
        description='Konzepte, deren Belege automatisch an ein vorhandenes Konzept gingen',
        ge=0,
    )
    proposed_new: StrictInt = Field(..., ge=0)
    proposed_merge: StrictInt = Field(..., ge=0)
    proposed_relations: StrictInt = Field(..., ge=0)
    auto_accepted: StrictInt = Field(
        ..., description='Einträge mit Status automatisch', ge=0
    )
    skipped_rejected: StrictInt = Field(
        ...,
        description='nicht erneut vorgeschlagen, weil für diese Session abgelehnt',
        ge=0,
    )
    dropped_cycles: StrictInt = Field(
        ..., description='baut_auf-Vorschläge, die einen Kreis bilden würden', ge=0
    )
    embedded_concepts: StrictInt = Field(
        ..., description='nachgeholte Vektoren aktiver Konzepte', ge=0
    )
    embedding_model: StrictStr | None = Field(..., min_length=1)
    embedding_error: StrictStr | None = Field(..., max_length=500)
    prompt_version: StrictStr | None = Field(
        ..., description='null ohne KI-Aufruf', min_length=1
    )
    model: StrictStr | None = Field(..., min_length=1)
    cost_eur: StrictFloat = Field(
        ..., description='Euro (Schätzung, VERTRAEGE §20.5)', ge=0.0
    )


class Device(BaseModel):
    """
    Gekoppeltes Gerät. Das Token selbst gibt die API nie aus (gespeichert nur token_hash).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    name: StrictStr = Field(..., min_length=1)
    kind: DeviceKind
    last_seen_at: AwareDatetime | None
    clock_offset_ms: StrictInt | None
    app_version: StrictStr | None
    connected: StrictBool = Field(
        ..., description='Abgeleitet: hat gerade eine Sync-Verbindung'
    )


class DeviceList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[Device]
    next_cursor: StrictStr | None


class ElementRemoveData(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    page_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    element_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )


class ElementRemoveOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^notebook:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='NotebookStreamId',
    )
    kind: Literal['element.remove']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: ElementRemoveData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class EvidenceRefSlide(BaseModel):
    """
    Beleg auf eine Folie. Ziel: /dokument?typ=folien&id=<deck_id>&seite=<slide_index>
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['slide']
    slide_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    deck_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    slide_index: StrictInt = Field(
        ..., description='Index der Folie im Foliensatz, ab 1', ge=1
    )


class EvidenceRefTranscript(BaseModel):
    """
    Beleg auf einen Zeitraum des Gesagten (Sitzungszeit, §18.1). t_end_ms ≥ t_start_ms prüft der Schreiber. Ziel: /rueckblick?id=<session_id>&t=<t_start_ms>
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['transcript']
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    t_start_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    t_end_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )


class ExerciseSheet(BaseModel):
    """
    Übungsblatt. Ergänzung zu 03 §4: ingest_state zeigt den Fortschritt von pdf.ingest für das Blatt.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    module_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
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


class FileReceipt(BaseModel):
    """
    Antwort auf PUT /photos/{id}/file und PUT /pages/{id}/pkdrawing
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    sha256: StrictStr = Field(
        ...,
        description='SHA-256, hex, Kleinbuchstaben',
        pattern='^[a-f0-9]{64}$',
        title='Sha256',
    )
    size_bytes: StrictInt = Field(..., ge=1)
    received_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    duplicate: StrictBool = Field(
        ...,
        description='true: dieselbe Datei (gleiches sha256) lag schon vor, nichts geändert',
    )


class FileRef(BaseModel):
    """
    Verweis auf eine Datei, die getrennt per HTTP hochgeladen wird (08 §2.3 file_ref / pkdrawing_ref). Der Core prüft sha256 beim Upload.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    sha256: StrictStr = Field(
        ...,
        description='SHA-256, hex, Kleinbuchstaben',
        pattern='^[a-f0-9]{64}$',
        title='Sha256',
    )
    mime: StrictStr = Field(..., examples=['image/heic'], min_length=1)
    size_bytes: StrictInt = Field(..., ge=1)


class GeneralSettings(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    data_dir: StrictStr = Field(
        ...,
        description='SG_DATA_DIR, nur lesbar (Änderung über die Umgebung und Neustart)',
    )
    content_lang: Lang
    appearance: Appearance


class GeneralSettingsUpdate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    content_lang: Lang | None = None
    appearance: Appearance | None = None


class IcsEventRef(BaseModel):
    """
    Termin in einem Abgleichergebnis (Schlüssel wie tests/fixtures/ics/11-abgleich-erwartung.json)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    event_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    external_uid: StrictStr
    recurrence_id: StrictStr | None
    title: StrictStr
    starts_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    module_id: Uuid | None
    kind: CalendarEventKind


class IcsModuleSuggestion(BaseModel):
    """
    Vorschlag „neues Modul anlegen?" für unbekannte Titel (F-KAL-02)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    name: StrictStr = Field(
        ...,
        description='Vorgeschlagener Modulname, aus dem Titel bereinigt',
        min_length=1,
    )
    kind: CalendarEventKind
    short: StrictStr | None = Field(
        None,
        description='Kürzel, wenn die Titel dasselbe Modul abgekürzt nennen (Stat I / Statistik I). Fehlt, wenn es keins gibt. Gehört in short_name des neuen Moduls, damit der Abgleich beide Schreibweisen zuordnet.',
        max_length=12,
        min_length=1,
    )
    event_count: StrictInt = Field(..., ge=1)
    series_event_ids: list[Uuid] = Field(
        ...,
        description='Je Serie ein Termin. Nach POST /modules: PATCH /calendar/events/{id} mit module_id, scope=serie',
        min_length=1,
    )


class ImageElementPayload(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    photo_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    crop: BBox | None


class InboxAcceptRequest(BaseModel):
    """
    POST /inbox/{id}/accept (§20.6). Welche Felder zu welcher Art passen, regelt der Vertrag (sonst 400 inbox_action_invalid)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    edit: ConceptEdit | None = None
    merge_into: StrictStr | None = Field(
        None,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    as_new: StrictBool | None = Field(
        None,
        description='concept_merge: als neues Konzept annehmen statt zusammenführen',
    )
    relation_kind: ConceptRelationKind | None = None


class InboxBulkRequest(BaseModel):
    """
    POST /inbox/bulk. Genau eins von ids und session_id (sonst 400 validation_failed)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    action: Action = Field(..., description='Massenaktion')
    ids: list[Uuid] | None = Field(None, max_length=500, min_length=1)
    session_id: StrictStr | None = Field(
        None,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )


class SkippedItem(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    code: StrictStr = Field(..., min_length=1)


class InboxBulkResult(BaseModel):
    """
    Antwort auf POST /inbox/bulk
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    decided: list[Uuid] = Field(
        ..., description='geänderte Einträge in Bearbeitungsreihenfolge'
    )
    skipped: list[SkippedItem]


class InboxDecision(BaseModel):
    """
    Was eine Annahme geändert hat (inbox_item.decision). Grundlage für „Rückgängig“ (POST /inbox/{id}/reopen, §20.6)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    action: Action1 = Field(..., description='Wirkung')
    concept_id: Uuid | None
    merged_into: Uuid | None
    moved_evidence_ids: list[Uuid]
    added_aliases: list[AddedAliase]
    added_module_ids: list[Uuid]
    previous: ConceptEdit | None
    relation_kind_before: ConceptRelationKind | None
    cascade_item_ids: list[Uuid] = Field(
        ..., description='mit derselben Entscheidung geänderte Beziehungs-Einträge'
    )
    duplicate_of: Uuid | None = Field(
        ...,
        description='A2/A3: vorhandene Beziehung, mit der die umgehängte (A2) bzw. umgewidmete (A3) Beziehung zusammenfiel. Die Zeile des Eintrags bleibt unbestätigt liegen (§20.6)',
    )
    triggered_by: Uuid | None = Field(
        ...,
        description='Eintrag, dessen Entscheidung diesen mitentschieden hat (A1: bestätigte Beziehung, A2: umgehängte Dublette, A3: bestätigte vorhandene Beziehung). Wieder öffnen nur über diesen Eintrag (§20.6)',
    )


class Target(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    concept_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    name: StrictStr = Field(
        ...,
        description='NFC, getrimmt, Leerraum zusammengefasst, ohne Steuerzeichen',
        max_length=200,
        min_length=1,
    )


class InboxPayloadRelation(BaseModel):
    """
    Nutzlast relation (Beziehung zwischen zwei Konzepten)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['relation']
    from_concept_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    to_concept_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    relation_kind: ConceptRelationKind
    why: StrictStr = Field(..., max_length=500, min_length=1)
    confidence: StrictFloat = Field(
        ..., description='Selbsteinschätzung der KI, 0..1', ge=0.0, le=1.0
    )
    prompt_version: StrictStr = Field(..., min_length=1)
    model: StrictStr = Field(..., min_length=1)


class InboxSimilarConcept(BaseModel):
    """
    Ähnliches vorhandenes Konzept („gleich wie X?“, 07 §3.5)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    concept_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    name: StrictStr = Field(
        ...,
        description='NFC, getrimmt, Leerraum zusammengefasst, ohne Steuerzeichen',
        max_length=200,
        min_length=1,
    )
    similarity: StrictFloat | None = Field(
        ..., description='Cosinus-Ähnlichkeit, null ohne Embedder', ge=0.0, le=1.0
    )
    verdict: ResolveVerdict | None


class Job(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
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
    depends_on: list[Uuid]
    session_id: Uuid | None
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


class LectureSettings(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    microphone_id: StrictStr | None = Field(
        ...,
        description='deviceId aus MediaDevices, null = Standardmikrofon',
        max_length=256,
    )
    auto_stop_after_end_min: StrictInt = Field(
        ..., description='Regel 1: Kalenderende + X min … (Standard 10)', ge=1
    )
    auto_stop_quiet_window_min: StrictInt = Field(
        ..., description='… und X min keine Sprache (Standard 3)', ge=1
    )
    auto_stop_hard_after_end_min: StrictInt = Field(
        ..., description='Regel 2: Kalenderende + X min (Standard 30)', ge=1
    )
    auto_stop_silence_min: StrictInt = Field(
        ..., description='Regel 3: Stille ≥ X min (Standard 15)', ge=1
    )
    auto_stop_max_duration_min: StrictInt = Field(
        ..., description='Regel 4: Maximaldauer (Standard 240)', ge=1
    )
    auto_stop_warning_s: StrictInt = Field(
        ..., description='Hinweis vor dem Stopp (Standard 60)', ge=0
    )
    auto_stop_extend_min: StrictInt = Field(
        ..., description='Verlängerung per Tipp (Standard 15)', ge=1
    )
    default_layout: DashboardLayout
    default_ink_mode: InkMode
    toolbar_side: ToolbarSide


class LectureSettingsUpdate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    microphone_id: StrictStr | None = Field(
        None,
        description='deviceId aus MediaDevices, null = Standardmikrofon',
        max_length=256,
    )
    auto_stop_after_end_min: StrictInt | None = Field(
        None, description='Regel 1: Kalenderende + X min … (Standard 10)', ge=1
    )
    auto_stop_quiet_window_min: StrictInt | None = Field(
        None, description='… und X min keine Sprache (Standard 3)', ge=1
    )
    auto_stop_hard_after_end_min: StrictInt | None = Field(
        None, description='Regel 2: Kalenderende + X min (Standard 30)', ge=1
    )
    auto_stop_silence_min: StrictInt | None = Field(
        None, description='Regel 3: Stille ≥ X min (Standard 15)', ge=1
    )
    auto_stop_max_duration_min: StrictInt | None = Field(
        None, description='Regel 4: Maximaldauer (Standard 240)', ge=1
    )
    auto_stop_warning_s: StrictInt | None = Field(
        None, description='Hinweis vor dem Stopp (Standard 60)', ge=0
    )
    auto_stop_extend_min: StrictInt | None = Field(
        None, description='Verlängerung per Tipp (Standard 15)', ge=1
    )
    default_layout: DashboardLayout | None = None
    default_ink_mode: InkMode | None = None
    toolbar_side: ToolbarSide | None = None


class Marker(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    kind: MarkerKind
    t_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    page_id: Uuid | None
    position: MarkerPosition | None
    source: MarkerSource
    note: StrictStr | None
    resolved_at: AwareDatetime | None


class MarkerAddData(BaseModel):
    """
    Marker vom iPad (F-INK-05) und vom Mac (F-DSH-05, source=mac)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    marker_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    kind: MarkerKind
    t_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    page_id: Uuid | None
    position: MarkerPosition | None
    note: StrictStr | None
    source: ClientDevice


class MarkerAddOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='SessionStreamId',
    )
    kind: Literal['marker.add']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: MarkerAddData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class MarkerRemoveData(BaseModel):
    """
    Rückgängig (⌘Z, F-DSH-05) bzw. Löschen
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    marker_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )


class MarkerRemoveOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='SessionStreamId',
    )
    kind: Literal['marker.remove']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: MarkerRemoveData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class Module(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    semester_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
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
    settings: ModuleSettings


class ModuleCreate(BaseModel):
    """
    Name genügt, alles andere optional (F-ORG-01). Ohne Farbe vergibt der Core die nächste freie Palettenfarbe. id ist optional und darf vom Client erzeugt werden (03 §1).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr | None = Field(
        None,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    semester_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
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
    """
    PATCH /modules/{id}. settings wird Schlüssel für Schlüssel zusammengeführt, null entfernt einen Schlüssel (docs/VERTRAEGE.md §14.2)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    semester_id: StrictStr | None = Field(
        None,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    name: StrictStr | None = Field(None, min_length=1)
    short_name: StrictStr | None = None
    color: ModuleColor | None = None
    ects: StrictFloat | None = Field(None, ge=0.0)
    exam_type: StrictStr | None = None
    lecturer: StrictStr | None = None
    lang: Lang | None = None
    description_md: StrictStr | None = None
    settings: ModuleSettingsUpdate | None = None


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
    upload_ids: list[Uuid] | None = Field(None, max_length=20, min_length=1)
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
    upload_ids: list[Uuid] = Field(..., max_length=20, min_length=1)


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
    upload_ids: list[Uuid] | None = Field(None, max_length=20, min_length=1)


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
    upload_ids: list[Uuid] | None = Field(None, max_length=20, min_length=1)


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
    Kurs, in den der Nutzer eingeschrieben ist. module_id: Zuordnung zu einem Modul, von Hand oder automatisch (F-MDL-03, T1-23, #141)
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
    module_id: Uuid | None
    suggested_module_id: Uuid | None = Field(
        ...,
        description='Vorschlag über Titelähnlichkeit, nur ohne bestätigte Zuordnung und nur für aktuelle Kurse (F-MDL-03)',
    )
    category: MoodleCourseCategory


class MoodleCourseLink(BaseModel):
    """
    Zuordnung Moodle-Kurs → Modul, von Hand bestätigt oder automatisch (F-MDL-03, #141, 08 §9.4 moodle_course_link)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    moodle_course_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    module_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    sync_enabled: StrictBool = Field(
        ..., description='false = Kurs bleibt zugeordnet, wird aber nicht abgeglichen'
    )
    last_synced_at: AwareDatetime | None = Field(
        ..., description='Letzter erfolgreicher Abgleich dieses Kurses'
    )
    auto: MoodleLinkAuto | None = Field(
        ...,
        description='Wie die Zuordnung entstand: null = von Hand, sonst automatisch (#141)',
    )
    module_removable: StrictBool = Field(
        ...,
        description='true nur bei auto = angelegt, solange das Modul leer ist: DELETE /moodle/links/{course_id}/module legt es in den Papierkorb',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )


class MoodleCourseLinkList(BaseModel):
    """
    Antwort von GET /moodle/links
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[MoodleCourseLink]


class MoodleCourseLinkUpdate(BaseModel):
    """
    Body von PUT /moodle/links/{course_id}: Zuordnung bestätigen oder ändern
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    module_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    sync_enabled: StrictBool | None = Field(
        None, description='Standard: true beim Anlegen, sonst unverändert'
    )


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


class MoodleItem(BaseModel):
    """
    Datei aus einem zugeordneten Kurs (08 §9.4 moodle_item). Wiedererkannt über file_ref
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    moodle_course_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    module_id: Uuid | None = Field(
        ..., description='Modul aus der aktuellen Kurszuordnung, null ohne Zuordnung'
    )
    cmid: StrictInt = Field(..., description='Moodle-ID', ge=1)
    activity_name: StrictStr
    filename: StrictStr = Field(
        ...,
        description='Bereinigter Moodle-Dateiname, höchstens 255 Byte (UTF-8), Endung bleibt. Nur zur Anzeige',
    )
    file_ref: StrictStr = Field(
        ..., description='Für GET /moodle/file?ref', pattern='^/'
    )
    mime_type: StrictStr | None
    is_pdf: StrictBool = Field(
        ..., description='Nur PDFs werden übernommen, andere Dateien nur aufgelistet'
    )
    size_bytes: StrictInt = Field(..., ge=0)
    modified_at: AwareDatetime | None = Field(
        ..., description='timemodified der zuletzt verarbeiteten Fassung'
    )
    kind: MoodleItemKind
    kind_source: KindSource = Field(
        ...,
        description='manuell = Entscheidung in der Inbox, gilt für die ganze Aktivität',
    )
    slide_deck_id: Uuid | None
    exercise_sheet_id: Uuid | None
    removed_in_moodle_at: AwareDatetime | None = Field(
        ..., description='In Moodle gelöscht oder versteckt. Lokal wird nie gelöscht'
    )
    last_error: LastError | None = Field(
        ...,
        description='Warum die Datei zuletzt nicht übernommen wurde. Ein späterer Abgleich versucht es erneut (außer kein_pdf)',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )


class MoodleItemList(BaseModel):
    """
    Antwort von GET /moodle/items
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[MoodleItem]


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


class MoodleSyncRun(BaseModel):
    """
    Ergebnis eines Abgleichs (F-MDL-04)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    trigger: MoodleSyncTrigger
    started_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    finished_at: AwareDatetime | None
    ok: StrictBool = Field(
        ...,
        description='false = mindestens ein Kurs oder die Fristen konnten nicht abgeglichen werden',
    )
    error_code: StrictStr | None = Field(
        ...,
        description='Fehlercode des Core (08 §9.1), z. B. moodle_unreachable, oder abgebrochen (Core wurde beendet)',
    )
    courses: StrictInt = Field(..., description='Abgeglichene Kurse', ge=0)
    files_new: StrictInt = Field(..., ge=0)
    files_changed: StrictInt = Field(..., ge=0)
    files_imported: StrictInt = Field(
        ...,
        description='Als Foliensatz oder Übungsblatt übernommen (inkl. Verknüpfung mit schon vorhandener Datei)',
        ge=0,
    )
    inbox_new: StrictInt = Field(..., description='Neue Dateien mit kind = offen', ge=0)
    deadlines: StrictInt = Field(
        ..., description='Aktuelle Fristen nach dem Abgleich', ge=0
    )
    failed_courses: list[FailedCourse]


class MoodleSyncStatus(BaseModel):
    """
    Antwort von GET und POST /moodle/sync
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    state: MoodleSyncState
    connection: MoodleConnectionState
    last_run: MoodleSyncRun | None
    next_run_at: AwareDatetime | None = Field(
        ..., description='Nächster geplanter Abgleich (alle 2 h), null ohne Zeitplan'
    )


class MoodleSyncedDeadline(BaseModel):
    """
    Frist aus dem Abgleich (08 §9.4 moodle_deadline). aufgabe = Moodle-Aufgabe mit Abgabedatum, termin = Kalenderereignis
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    source: Source
    moodle_course_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    module_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    assignment_id: AssignmentId | None
    event_id: EventId | None
    cmid: Cmid | None
    name: StrictStr
    due_at: AwareDatetime = Field(..., description='ISO 8601, UTC', title='Timestamp')
    url: AnyUrl | None
    exercise_sheet_id: Uuid | None = Field(
        ..., description='Übungsblatt, das dieses Abgabedatum bekommen hat'
    )
    removed_in_moodle_at: AwareDatetime | None


class MoodleSyncedDeadlineList(BaseModel):
    """
    Antwort von GET /moodle/synced-deadlines
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[MoodleSyncedDeadline]


class MoodleUpload(BaseModel):
    """
    Antwort von POST /moodle/uploads
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    upload_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    filename: StrictStr
    size_bytes: StrictInt = Field(..., ge=0)
    expires_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )


class Notebook(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    module_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    title: StrictStr = Field(..., min_length=1)
    kind: NotebookKind
    page_count: StrictInt = Field(..., description='Abgeleitet', ge=0)


class NotebookCreate(BaseModel):
    """
    POST /notebooks. kind fehlt = frei
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr | None = Field(
        None,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    module_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    title: StrictStr = Field(..., min_length=1)
    kind: NotebookKind | None = None


class NotebookCreateData(BaseModel):
    """
    Freies Notizbuch offline anlegen (F-INK-02, F-INK-14). Strom notebook:<notebook_id>, idempotent über notebook_id.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    notebook_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    module_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    title: StrictStr = Field(..., min_length=1)
    kind: Literal['frei'] | None = Field(
        None, description='Nur frei. Die Notizbücher vorlesung/uebung legt der Core an'
    )
    created_at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )


class NotebookCreateOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^notebook:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='NotebookStreamId',
    )
    kind: Literal['notebook.create']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: NotebookCreateData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class NotebookList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[Notebook]
    next_cursor: StrictStr | None


class NotebookRefData(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    notebook_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )


class NotebookRestoreOp(BaseModel):
    """
    Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem Papierkorb
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^notebook:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='NotebookStreamId',
    )
    kind: Literal['notebook.restore']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: NotebookRefData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class NotebookUpdate(BaseModel):
    """
    PATCH /notebooks/{id}
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    title: StrictStr | None = Field(None, min_length=1)
    module_id: StrictStr | None = Field(
        None,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )


class NotebookUpdateFields(BaseModel):
    """
    Aktueller Stand der per REST änderbaren Felder
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    title: StrictStr = Field(..., min_length=1)
    module_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )


class Page(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    notebook_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    session_id: Uuid | None
    index: StrictInt = Field(
        ..., description='Reihenfolge im Notizbuch, 1-basiert', ge=1
    )
    template: PageTemplate
    background_slide_id: Uuid | None
    attached_slide_id: Uuid | None
    width_pt: StrictFloat = Field(..., gt=0.0)
    height_pt: StrictFloat = Field(..., gt=0.0)
    version: StrictInt = Field(..., ge=1)
    has_pkdrawing: StrictBool = Field(
        ...,
        description='Abgeleitet: PencilKit-Sicherung liegt vor (GET /pages/{id}/pkdrawing)',
    )


class PageCreateData(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    page_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    notebook_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    session_id: Uuid | None
    index: StrictInt = Field(..., ge=1)
    template: PageTemplate
    width_pt: StrictFloat = Field(..., gt=0.0)
    height_pt: StrictFloat = Field(..., gt=0.0)
    background_slide_id: Uuid | None
    attached_slide_id: Uuid | None


class PageCreateOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^notebook:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='NotebookStreamId',
    )
    kind: Literal['page.create']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: PageCreateData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class PageDeleteData(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    page_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )


class PageDeleteOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^notebook:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='NotebookStreamId',
    )
    kind: Literal['page.delete']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: PageDeleteData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class PageRefData(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    page_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )


class PageRestoreOp(BaseModel):
    """
    Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem Papierkorb
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^notebook:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='NotebookStreamId',
    )
    kind: Literal['page.restore']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: PageRefData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class PageUpdateFields(BaseModel):
    """
    Alle änderbaren Felder der Seite mit ihrem neuen Stand. Kein Teil-Update: im Sync gibt es keine optionalen nullbaren Felder (VERTRAEGE §11.7)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    index: StrictInt = Field(..., ge=1)
    template: PageTemplate
    session_id: Uuid | None
    background_slide_id: Uuid | None
    attached_slide_id: Uuid | None


class PairConfirmRequest(BaseModel):
    """
    POST /devices/pair/confirm (aus dem Netz ohne Token erlaubt). Geheimnis ist der Code. public_nonce verknüpft die Bestätigung mit einer eigenen pair/start-Anfrage; gehört sie zu einer abgelehnten Anfrage, wird abgelehnt.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    pairing_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    code: StrictStr = Field(..., pattern='^[0-9]{6}$')
    device_name: StrictStr = Field(..., max_length=64, min_length=1)
    kind: DeviceKind
    public_nonce: StrictStr = Field(..., pattern='^[A-Za-z0-9_-]{22,128}$')
    app_version: StrictStr | None = Field(None, min_length=1)


class PairResponse(BaseModel):
    """
    Antwort auf POST /devices/pair/confirm (201)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    device: Device
    device_token: StrictStr = Field(
        ...,
        description='256 Bit Zufall, base64url ohne Padding. Wird nur dieses eine Mal ausgegeben',
        pattern='^[A-Za-z0-9_-]{43}$',
    )


class PairStartResponse(BaseModel):
    """
    pair/start: request_id der eigenen Anfrage und pairing_id des offenen Fensters. Der Code steht NICHT in der Antwort
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    request_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    pairing_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    expires_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )


class PairingCode(BaseModel):
    """
    Offenes Kopplungsfenster für die Anzeige in der Web-App (Antwort von POST /devices/pairings, nur lokal). Anfragen von Geräten liefern das Ereignis pairing.requested und GET /devices/pairings/requests (PairingRequestList)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    pairing_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    code: StrictStr = Field(..., pattern='^[0-9]{6}$')
    expires_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    host: StrictStr = Field(
        ...,
        description='Adresse des Macs im lokalen Netz (IPv4 der aktiven Schnittstelle), zur Anzeige und für die manuelle Eingabe',
        examples=['192.168.1.20'],
        min_length=1,
    )
    port: StrictInt = Field(..., ge=1, le=65535)
    qr_url: StrictStr = Field(
        ...,
        description='Inhalt des QR-Codes: dieselben Daten wie host, port, pairing_id und code',
        examples=['sg://pair?v=1&host=192.168.1.20&port=4710&pairing_id=019a4e14-0000-7000-8000-000000000081&code=482913'],
        pattern='^sg://pair\\?v=1&host=[^&]+&port=[0-9]+&pairing_id=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}&code=[0-9]{6}$',
    )


class PairingRequest(BaseModel):
    """
    Anfrage eines Geräts über pair/start (Nutzlast des Ereignisses pairing.requested). Die Web-App listet sie und kann sie ablehnen (DELETE /devices/pairings/requests/{request_id}). Gerätenamen sind frei wählbar, die Web-App empfiehlt darum den QR-Weg
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    request_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    pairing_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    device_name: StrictStr = Field(..., max_length=64, min_length=1)
    kind: DeviceKind
    requested_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )


class PairingRequestList(BaseModel):
    """
    GET /devices/pairings/requests (nur lokal): offene (nicht abgelehnte) Anfragen des aktuellen Kopplungsfensters, älteste zuerst. Ohne offenes Fenster leer. Höchstens 10, danach antwortet pair/start mit 429 pairing_requests_full
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[PairingRequest] = Field(..., max_length=10)


class PdfIngestDeckPayload(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    slide_deck_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )


class PdfIngestSheetPayload(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    exercise_sheet_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )


class PenSettings(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    double_tap: PencilDoubleTapAction
    squeeze: PencilSqueezeAction
    shape_recognition: StrictBool = Field(
        ..., description='Formerkennung (F-INK-09, ab Phase 3)'
    )
    favorite_colors: list[HexColor] = Field(..., max_length=8)


class PenSettingsUpdate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    double_tap: PencilDoubleTapAction | None = None
    squeeze: PencilSqueezeAction | None = None
    shape_recognition: StrictBool | None = Field(
        None, description='Formerkennung (F-INK-09, ab Phase 3)'
    )
    favorite_colors: list[HexColor] | None = Field(None, max_length=8)


class Photo(BaseModel):
    """
    Tafel-Foto (Metadaten). Datei: GET /photos/{id}/file
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    t_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    page_id: Uuid | None
    mime: PhotoMime
    sha256: StrictStr = Field(
        ...,
        description='SHA-256, hex, Kleinbuchstaben',
        pattern='^[a-f0-9]{64}$',
        title='Sha256',
    )
    size_bytes: StrictInt = Field(..., ge=1)
    has_file: StrictBool = Field(
        ..., description='false, bis PUT /photos/{id}/file angekommen ist'
    )
    ocr_text: StrictStr | None


class PhotoFileRef(BaseModel):
    """
    Datei eines Tafel-Fotos, hochgeladen per PUT /photos/{photo_id}/file
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    sha256: StrictStr = Field(
        ...,
        description='SHA-256, hex, Kleinbuchstaben',
        pattern='^[a-f0-9]{64}$',
        title='Sha256',
    )
    mime: PhotoMime
    size_bytes: StrictInt = Field(..., ge=1)


class Recording(BaseModel):
    """
    Eine Aufnahme = ein MediaRecorder-Strom. Nach einem Neuladen beginnt eine neue Aufnahme derselben Session (F-SES-05).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    mime: StrictStr = Field(
        ...,
        examples=['audio/webm;codecs=opus', 'audio/mp4'],
        pattern='^audio/(webm|mp4)(;.*)?$',
    )
    codec: AudioCodec
    started_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    duration_ms: StrictInt | None = Field(
        ..., description='Länge der Gesamtdatei, gesetzt von audio.finalize', ge=0
    )
    state: RecordingState
    chunks_independent: StrictBool = Field(
        ...,
        description='true: jeder Chunk ist eine eigenständige Datei (Recorder je Chunk neu gestartet). false: Chunks ergeben in seq-Reihenfolge einen Bytestrom. Ergänzung, offen bis Spike S4',
    )
    chunk_count: StrictInt = Field(
        ..., description='Abgeleitet: empfangene Chunks', ge=0
    )
    last_seq: StrictInt | None = Field(
        ..., description='Abgeleitet: höchste empfangene seq', ge=0
    )
    completed_at: AwareDatetime | None


class RecordingCreate(BaseModel):
    """
    POST /sessions/{id}/recordings
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr | None = Field(
        None,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    mime: StrictStr = Field(..., pattern='^audio/(webm|mp4)(;.*)?$')
    codec: AudioCodec
    started_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    chunks_independent: StrictBool | None = None


class RestoreTest(BaseModel):
    """
    Ergebnis des Restore-Tests (F-DAT-02): Stand des eigenen Backups in eine Wegwerf-Datenbank einspielen, Objekte zählen, aufräumen
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    state: RestoreTestState
    trigger: RestoreTestTrigger
    started_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    finished_at: AwareDatetime | None = Field(
        ..., description='null solange der Test läuft'
    )
    stand: StrictStr | None = Field(
        ...,
        description='Getesteter Stand, null wenn keiner gefunden wurde',
        pattern='^[0-9]{8}T[0-9]{6}Z$',
    )
    is_latest: StrictBool | None = Field(
        ...,
        description='true = der getestete Stand war zum Testzeitpunkt der jüngste erfolgreiche Lauf, false = ein älterer (der jüngste ließ sich nicht testen), null = unbekannt (läuft noch oder kein Stand gewählt)',
    )
    reason: RestoreTestReason | None = Field(..., description='Nur bei state = fehler')
    error: StrictStr | None = Field(
        ...,
        description='Technischer Fehlertext (ohne Zugangsdaten und Datenordner), nur bei state = fehler',
        max_length=500,
    )


class SearchIndexPayload(BaseModel):
    """
    search.index (VERTRAEGE §19.3). job.session_id bleibt NULL, auch bei scope = session
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    scope: SearchIndexScope
    id: StrictStr = Field(
        ...,
        description='slide_deck.id bzw. session.id',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )


class SearchIndexResult(BaseModel):
    """
    Ergebnis von search.index (VERTRAEGE §19.3)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    scope: SearchIndexScope
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    chunk_count: StrictInt = Field(
        ..., description='Einträge des Ziels nach dem Lauf', ge=0
    )
    embedded_count: StrictInt = Field(
        ..., description='neu eingebettete Einträge', ge=0
    )
    reused_count: StrictInt = Field(
        ...,
        description='Einträge, deren Vektor wiederverwendet wurde (gleicher Text, gleiches Modell, gleiche Version)',
        ge=0,
    )
    removed_count: StrictInt = Field(
        ..., description='hart gelöschte Einträge, die es im Ziel nicht mehr gibt', ge=0
    )
    embedding_model: StrictStr | None = Field(
        ...,
        description='Modell der Vektoren. null: Embedder nicht verfügbar, Einträge ohne Vektor geschrieben (§19.3 Schritt 4)',
        examples=['BAAI/bge-m3'],
        min_length=1,
    )
    embedding_error: StrictStr | None = Field(
        ...,
        description='Grund, warum ohne Vektoren geschrieben wurde. Ohne Pfade und ohne Geheimnisse',
        max_length=500,
    )
    index_version: StrictInt = Field(
        ..., description='SEARCH_INDEX_VERSION des Workers beim Lauf', ge=1
    )
    deleted: StrictBool = Field(
        ..., description='true: Ziel ist weich gelöscht, nichts geschrieben'
    )
    missing: StrictBool = Field(
        ..., description='true: Ziel existiert nicht (mehr), nichts geschrieben'
    )


class SearchModuleRef(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    name: StrictStr = Field(..., min_length=1)
    short_name: StrictStr | None


class Filters(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    module_ids: list[Uuid] = Field(
        ..., description='aufgelöste Module aus fach: und module_id. Leer = alle'
    )
    kinds: list[SearchKind] = Field(..., description='aus typ:. Leer = alle')
    unresolved: list[UnresolvedItem] = Field(
        ...,
        description='Präfixe, die nichts trafen (wörtlich, z. B. fach:XYZ). Nicht leer → hits leer',
    )


class Semester(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
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
    id: StrictStr | None = Field(
        None,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
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


class SessionCreate(BaseModel):
    """
    POST /sessions: spontane Session ohne Termin (F-SES-04). Ergebnis im Zustand bereit, danach /start.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr | None = Field(
        None,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    module_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    slide_deck_id: Uuid | None = None
    title: StrictStr | None = None


class SessionRef(BaseModel):
    """
    Kurzangabe einer Session für Listen (Anzeige „VL 7 · Titel“ bzw. Datum)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    number: StrictInt | None = Field(
        ..., description='VL-Nummer (Session.number)', ge=1
    )
    title: StrictStr | None
    started_at: AwareDatetime | None
    module: SearchModuleRef


class SessionRefData(BaseModel):
    """
    session.pause / session.resume
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )


class SessionResumeOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='SessionStreamId',
    )
    kind: Literal['session.resume']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: SessionRefData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class SessionStartData(BaseModel):
    """
    Unbekannte session_id: der Core legt die Session an (Start offline auf dem iPad, F-SES-02 Schritt 3)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    module_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    calendar_event_id: Uuid | None
    slide_deck_id: Uuid | None
    started_from: ClientDevice
    started_at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )


class SessionStartOffset(BaseModel):
    """
    Ein Gerät hat die Session offline mit eigenem started_at begonnen. offset_ms = started_at des Geräts − started_at der Session (ms). Die t_ms der Operationen dieses Geräts bleiben unverändert; Sitzungszeit nach Serveruhr = t_ms + offset_ms (für die Ausrichtung in Phase 2).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    device_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    offset_ms: StrictInt


class SessionStartOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='SessionStreamId',
    )
    kind: Literal['session.start']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: SessionStartData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class SessionStartRequest(BaseModel):
    """
    POST /sessions/{id}/start. started_at setzt der Core (Serverzeit).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    started_from: ClientDevice
    slide_deck_id: Uuid | None = None


class SessionStopData(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    reason: StopReason | None = None


class SessionStopOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='SessionStreamId',
    )
    kind: Literal['session.stop']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: SessionStopData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class SessionStopRequest(BaseModel):
    """
    POST /sessions/{id}/stop. reason fehlt = manuell. absturz_wiederhergestellt setzt nur der Core.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    reason: StopReason | None = None


class SessionUpdate(BaseModel):
    """
    PATCH /sessions/{id}
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    title: StrictStr | None = None
    slide_deck_id: Uuid | None = None


class Settings(BaseModel):
    """
    GET /settings: alle Phase-1-Bereiche, fehlende Werte mit Standard aufgefüllt. Geräte stehen unter /devices.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    general: GeneralSettings
    lecture: LectureSettings
    pen: PenSettings
    data: DataSettings


class SettingsUpdate(BaseModel):
    """
    PATCH /settings: nur die angegebenen Felder ändern sich. Antwort: Settings
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    general: GeneralSettingsUpdate | None = None
    lecture: LectureSettingsUpdate | None = None
    pen: PenSettingsUpdate | None = None
    data: DataSettingsUpdate | None = None


class ShapeElementPayload(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    shape: ShapeKind
    points: list[Point2] = Field(..., min_length=2)
    color: StrictStr = Field(
        ...,
        description='RGBA als #RRGGBBAA',
        examples=['#1E2A44FF'],
        pattern='^#[0-9A-Fa-f]{8}$',
        title='HexColor',
    )
    width: StrictFloat = Field(..., gt=0.0)


class Slide(BaseModel):
    """
    Eine Seite eines Foliensatzes. Bilder über GET /slides/{id}/image bzw. /thumb.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    deck_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    index: StrictInt = Field(..., description='1-basiert', ge=1)
    width_pt: StrictFloat
    height_pt: StrictFloat
    text: StrictStr = Field(..., description='Textlayer, leer wenn keiner vorhanden')
    text_blocks: list[TextBlock]
    vision_summary: StrictStr | None
    title: StrictStr | None
    chapter: StrictStr | None


class SlideChangeData(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    event_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    slide_id: Uuid | None
    slide_index: StrictInt = Field(..., ge=1)
    t_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    device: ClientDevice


class SlideChangeOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='SessionStreamId',
    )
    kind: Literal['slide.change']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: SlideChangeData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class SlideDeck(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    module_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    session_id: Uuid | None
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


class SlideEvent(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    slide_id: Uuid | None
    slide_index: StrictInt = Field(..., ge=1)
    t_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    device: ClientDevice
    source: SlideEventSource


class SlideSegment(BaseModel):
    """
    Welche Folie lief wann (03 §5). Zeiten in Sitzungszeit, end_ms ausschließlich
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    slide_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    slide_index: StrictInt = Field(..., ge=1)
    start_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    end_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    source: SlideSegmentSource
    confidence: StrictFloat = Field(..., ge=0.0, le=1.0)
    job_id: Uuid | None


class StampElementPayload(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    marker_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    marker_kind: MarkerKind


class Stroke(BaseModel):
    """
    Neutrales Strich-Format (08 §4.1/4.2). points sind Rohkoordinaten VOR transform, bbox gilt NACH transform inklusive halber Breite. dt des ersten Punkts ist 0; t_end_ms − t_start_ms entspricht dem letzten dt. t_start_ms/t_end_ms null außerhalb einer Session.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    client_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    tool: StrokeTool
    layer: StrokeLayer
    color: StrictStr = Field(
        ...,
        description='RGBA als #RRGGBBAA',
        examples=['#1E2A44FF'],
        pattern='^#[0-9A-Fa-f]{8}$',
        title='HexColor',
    )
    width: StrictFloat = Field(..., description='Grundbreite in pt', gt=0.0)
    created_at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    t_start_ms: SessionMs | None
    t_end_ms: SessionMs | None
    transform: list[StrictFloat] = Field(
        ...,
        description="Affine Transformation [a, b, c, d, e, f] (CGAffineTransform): x' = a·x + c·y + e, y' = b·x + d·y + f",
        max_length=6,
        min_length=6,
        title='Transform',
    )
    bbox: list[StrictFloat] = Field(
        ..., description='[x, y, w, h] in pt', max_length=4, min_length=4, title='BBox'
    )
    points: StrictStr = Field(
        ...,
        description='Base64 (ohne Zeilenumbrüche) von n ≥ 1 Punkten à 24 Byte: x, y, dt, force, azimuth, altitude als Float32 little-endian (08 §4.2). 24 Byte = genau 32 Base64-Zeichen, daher nie Padding',
        pattern='^(?:[A-Za-z0-9+/]{32})+$',
    )


class StrokeAddData(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    page_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stroke: Stroke


class StrokeAddOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^notebook:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='NotebookStreamId',
    )
    kind: Literal['stroke.add']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: StrokeAddData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class StrokeRemoveData(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    page_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    client_ids: list[Uuid] = Field(..., min_length=1)


class StrokeRemoveOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^notebook:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='NotebookStreamId',
    )
    kind: Literal['stroke.remove']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: StrokeRemoveData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class SummaryWritePayload(BaseModel):
    """
    summary.write (VERTRAEGE §20.4, nur die Zusammenfassung, ohne vault.write). job.session_id ist gesetzt
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    force: StrictBool | None = None


class SummaryWriteResult(BaseModel):
    """
    Ergebnis von summary.write
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    session_deleted: StrictBool
    skipped: StrictBool = Field(
        ...,
        description='true: weder Folien noch Transkript, eine alte Zusammenfassung wurde entfernt',
    )
    unchanged: StrictBool
    input_hash: StrictStr | None = Field(..., pattern='^[0-9a-f]{64}$')
    sentence_count: StrictInt = Field(..., ge=0, le=5)
    outline_count: StrictInt = Field(..., ge=0, le=30)
    dropped_sentences: StrictInt = Field(..., ge=0)
    prompt_version: StrictStr | None = Field(..., min_length=1)
    model: StrictStr | None = Field(..., min_length=1)
    cost_eur: StrictFloat = Field(
        ..., description='Euro (Schätzung, VERTRAEGE §20.5)', ge=0.0
    )


class SyncAck(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['ack']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        description='Strom (08 §2.2): notebook:<id>, session:<id> oder user',
        pattern='^((notebook|session):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|user)$',
        title='SyncStreamId',
    )
    seq: StrictInt = Field(..., ge=1)


class SyncConnectionInfo(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    client: SyncClientKind
    device_id: Uuid | None
    connected: StrictBool


class SyncError(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['error']
    code: SyncErrorCode
    message: StrictStr
    op_id: StrictStr | None = Field(
        None,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr | None = Field(
        None,
        description='Strom (08 §2.2): notebook:<id>, session:<id> oder user',
        pattern='^((notebook|session):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|user)$',
        title='SyncStreamId',
    )
    retryable: StrictBool = Field(
        ...,
        description='Nur mit op_id: true = Verbindung wird geschlossen, neu verbinden und ab dieser Operation erneut senden. false = endgültig abgelehnt: Operation samt abhängigen in die Fehlerablage (VERTRAEGE §11.2). Ausnahmen: session_superseded (umschreiben) und page_version_conflict (neu laden)',
    )
    fatal: StrictBool = Field(
        ...,
        description='true: der Server schließt die Verbindung direkt danach und verarbeitet keine weitere Nachricht',
    )
    details: dict[str, Any] | None = None


class SyncPairingEvent(BaseModel):
    """
    Ein Gerät hat pair/start aufgerufen. Nur an lokale Web-Clients (VERTRAEGE §12)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['event']
    name: Literal['pairing.requested']
    data: PairingRequest


class SyncPresence(BaseModel):
    """
    Was der Client gerade zeigt (ersetzt den vorigen Stand). Das iPad sendet sie bei jedem Seitenwechsel, die Notizen-Spalte folgt ihr (F-DSH-04). Ergänzung zu 08 §2
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['presence']
    session_id: Uuid | None
    notebook_id: Uuid | None
    page_id: Uuid | None


class SyncPresenceInfo(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    client: SyncClientKind
    device_id: Uuid | None
    device_name: StrictStr | None
    session_id: Uuid | None
    notebook_id: Uuid | None
    page_id: Uuid | None


class SyncResume(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    stream: StrictStr = Field(
        ...,
        description='Strom (08 §2.2): notebook:<id>, session:<id> oder user',
        pattern='^((notebook|session):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|user)$',
        title='SyncStreamId',
    )
    from_seq: StrictInt = Field(
        ...,
        description='Ab dieser seq sendet der Server die fehlenden Operationen',
        ge=1,
    )
    head_seq: StrictInt = Field(
        ..., description='Aktuell höchste seq des Stroms. Ergänzung zu 08 §2.1', ge=0
    )
    reset: StrictBool = Field(
        ...,
        description='true: der Server kennt die gemeldete Position nicht (last_op_id passt nicht, seq zu hoch, z. B. nach einer Wiederherstellung) und sendet für diesen Strom nichts. Der Client verwirft seine Daten NICHT, sondern gleicht per REST ab, sendet fehlende eigene Daten erneut und abonniert ab stream_seq/stream_op_id (VERTRAEGE §11.1).',
    )


class SyncStreamPosition(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    stream: StrictStr = Field(
        ...,
        description='Strom (08 §2.2): notebook:<id>, session:<id> oder user',
        pattern='^((notebook|session):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|user)$',
        title='SyncStreamId',
    )
    last_seq: StrictInt = Field(
        ...,
        description='Höchste lückenlos empfangene und angewandte seq, 0 = nichts',
        ge=0,
    )
    last_op_id: Uuid | None = Field(
        ...,
        description='op_id der Operation mit last_seq, null bei last_seq = 0. Der Server prüft das Paar, sonst reset',
    )


class SyncSubscribe(BaseModel):
    """
    Weitere Ströme abonnieren, ohne neu zu verbinden. Antwort: subscribed. Ergänzung zu 08 §2
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['subscribe']
    streams: list[SyncStreamPosition] = Field(..., min_length=1)


class SyncSubscribed(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['subscribed']
    resume: list[SyncResume]


class SyncWelcome(BaseModel):
    """
    db_epoch ändert sich bei jeder Wiederherstellung der Datenbank. Weicht sie vom gespeicherten Wert ab, behandelt der Client alle Ströme wie reset (VERTRAEGE §11.1).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['welcome']
    protocol: Literal[1]
    server_time: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    server_version: StrictStr
    db_epoch: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    device_id: Uuid | None
    resume: list[SyncResume]


class TapeElementPayload(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    color: StrictStr = Field(
        ...,
        description='RGBA als #RRGGBBAA',
        examples=['#1E2A44FF'],
        pattern='^#[0-9A-Fa-f]{8}$',
        title='HexColor',
    )
    covered: StrictBool
    card_id: Uuid | None


class Task(BaseModel):
    """
    Teilaufgabe eines Übungsblatts. Zerlegung erst ab Phase 2 (F-ORG-03).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    sheet_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    label: StrictStr = Field(..., examples=['2b'])
    page_index: StrictInt = Field(..., ge=1)
    bbox: BBox | None
    text: StrictStr
    solution_text: StrictStr | None


class TextElementPayload(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    text: StrictStr
    size: TextSize


class TranscribePayload(BaseModel):
    """
    transcribe (08 §5, VERTRAEGE §18.2). Den Anbieter wählt der Worker (SG_TRANSCRIBER)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    force: StrictBool | None = Field(
        None,
        description='true: auch Aufnahmen mit unverändertem input_hash neu transkribieren',
    )


class TranscribeRecordingResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    recording_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    transcript_id: Uuid | None
    outcome: TranscribeOutcome
    segment_count: StrictInt = Field(..., ge=0)
    word_count: StrictInt = Field(..., ge=0)
    audio_duration_ms: StrictInt = Field(..., ge=0)
    language: LanguageCode | None
    transcribe_ms: StrictInt = Field(
        ..., description='Laufzeit des Transcribers, 0 bei unveraendert', ge=0
    )


class TranscribeResult(BaseModel):
    """
    job.result von transcribe
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    provider: TranscriptProvider
    model: StrictStr = Field(..., min_length=1)
    recordings: list[TranscribeRecordingResult]
    removed_transcripts: StrictInt = Field(
        ...,
        description='Entfernte Transkripte gelöschter Aufnahmen bzw. von Aufnahmen ohne Audio',
        ge=0,
    )
    segment_count: StrictInt = Field(
        ..., description='Summe über alle Transkripte der Session nach dem Lauf', ge=0
    )
    word_count: StrictInt = Field(..., ge=0)
    session_deleted: StrictBool = Field(
        ..., description='true: Session war gelöscht, nichts geschrieben'
    )
    job_duration_ms: StrictInt = Field(..., ge=0)


class TranscriptInfo(BaseModel):
    """
    Ein Transkript je Aufnahme (VERTRAEGE §18.1), ohne Segmente
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    recording_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    job_id: StrictStr = Field(
        ...,
        description='transcribe-Job, der es geschrieben hat',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    finalize_job_id: StrictStr = Field(
        ...,
        description='audio.finalize-Job, dessen full.m4a transkribiert wurde',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    provider: TranscriptProvider
    model: StrictStr = Field(
        ..., examples=['mlx-community/whisper-large-v3-turbo'], min_length=1
    )
    language: LanguageCode | None
    segment_count: StrictInt = Field(..., ge=0)
    word_count: StrictInt = Field(..., ge=0)
    audio_duration_ms: StrictInt = Field(..., ge=0)
    stale: StrictBool = Field(
        ...,
        description='true: Der neueste fertige audio.finalize-Job der Aufnahme ist nicht finalize_job_id (Audio wurde danach neu erzeugt)',
    )


class TranscriptLine(BaseModel):
    """
    Ein Transkript-Abschnitt bzw. sein Teil auf einer Folie (VERTRAEGE §18.4). Ein Abschnitt über eine Foliengrenze ergibt mehrere Zeilen mit gleicher segment_id
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    segment_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    part: StrictInt = Field(..., description='0, 1, … innerhalb des Abschnitts', ge=0)
    recording_id: StrictStr = Field(
        ...,
        description='Aufnahme mit dem Audio. Position in full.m4a = start_ms − recording.started_ms',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    slide_id: Uuid | None
    slide_index: StrictInt | None = Field(..., ge=1)
    start_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    end_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    text: StrictStr
    lang: LanguageCode | None
    words: list[TranscriptWord] | None = Field(
        None,
        description='Nur mit include_words=true: genau die Wörter dieser Zeile, [] wenn der Abschnitt keine Wort-Zeitstempel hat (VERTRAEGE §18.4)',
    )


class TrashParent(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    kind: TrashKind
    title: StrictStr


class TrashRestoreResult(BaseModel):
    """
    POST /trash/{id}/restore, auch für „Rückgängig" im Toast
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    kind: TrashKind
    restored_count: StrictInt = Field(
        ...,
        description='Alle wiederhergestellten Zeilen samt Objekt selbst, auch Maschinenausgaben (anders als dependent_count, VERTRAEGE §13)',
        ge=1,
    )


class UploadResult(BaseModel):
    """
    Antwort auf POST /slide-decks und POST /exercise-sheets. duplicate=true: Datei mit gleichem sha256 existiert schon, es wurde nichts angelegt (F-ORG-02 Sonderfall). id ist die ID des neuen bzw. bereits vorhandenen Objekts.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    duplicate: StrictBool


class WorkerHealth(BaseModel):
    """
    GET /health des Loopback-Endpunkts im Worker (VERTRAEGE §19.4). Nur 127.0.0.1, mit Token. llm ab §20.5, optional, damit ein älterer Worker gültig bleibt
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    embedder: Embedder
    llm: WorkerLlmStatus | None = None


class AudioFinalizeResult(BaseModel):
    """
    job.result von audio.finalize. state ist nie laeuft
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    recording_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    state: RecordingState
    audio_duration_ms: StrictInt = Field(..., description='Länge von full.m4a', ge=0)
    chunk_count: StrictInt = Field(..., ge=0)
    missing_seqs: list[MissingSeq]
    gaps: list[AudioGap]
    file_size_bytes: StrictInt = Field(..., ge=0)
    job_duration_ms: StrictInt = Field(..., description='Laufzeit des Jobs', ge=0)


class BackupStatus(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    target: StrictStr | None = Field(
        ..., description='null = kein Ziel eingestellt, Backups pausieren'
    )
    last_success_at: AwareDatetime | None
    next_run_at: AwareDatetime | None
    stale: StrictBool = Field(
        ..., description='Letztes erfolgreiches Backup älter als 3 Tage (F-DAT-01)'
    )
    running: StrictBool
    restore_test: RestoreTest | None = Field(
        ...,
        description='Letzter automatischer oder manueller Restore-Test (F-DAT-02), null = noch keiner gelaufen',
    )


class ConceptListItem(BaseModel):
    """
    Eintrag in GET /concepts
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    concept: Concept
    modules: list[SearchModuleRef]
    evidence_count: StrictInt = Field(..., ge=0)
    session_count: StrictInt = Field(
        ..., description='Sessions mit mindestens einem Beleg', ge=0
    )


class CostBySession(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    session: SessionRef | None
    calls: StrictInt = Field(..., ge=0)
    eur: StrictFloat = Field(
        ..., description='Euro (Schätzung, VERTRAEGE §20.5)', ge=0.0
    )


class CostSummary(BaseModel):
    """
    GET /costs/summary (F-DAT-05): ein Monat, je Aufgabe, je Session (höchstens 20), je Modell
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    budget: AiBudgetStatus
    calls: StrictInt = Field(..., ge=0)
    by_task: list[CostByTask]
    by_session: list[CostBySession] = Field(..., max_length=20)
    by_model: list[CostByModel]


class DrawingSnapshotData(BaseModel):
    """
    Datei vorher per PUT /pages/{id}/pkdrawing hochgeladen, nur fürs iPad
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    page_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    pkdrawing_ref: FileRef


class DrawingSnapshotOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^notebook:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='NotebookStreamId',
    )
    kind: Literal['drawing.snapshot']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: DrawingSnapshotData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class EvidenceView(BaseModel):
    """
    Gespeicherter Beleg (Tabelle evidence) mit Anzeigeangaben
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    ref: EvidenceRefSlide | EvidenceRefTranscript = Field(
        ...,
        description='Verweis auf eine Quelle, unterschieden über kind (anyOf statt oneOf, damit Zod einen typisierten Union erzeugt)',
        title='EvidenceRef',
    )
    session: SessionRef | None
    slide_title: StrictStr | None = Field(
        ..., description='nur bei slide: Titel der Folie, sonst null'
    )
    missing: StrictBool = Field(
        ...,
        description='true: Ziel gelöscht (Folie bzw. Foliensatz), der Beleg ist nicht mehr anspringbar',
    )
    quote: StrictStr | None = Field(
        ..., description='kurzes Zitat für die Anzeige', max_length=300, min_length=1
    )
    auto: StrictBool = Field(
        ...,
        description='true: beim Abgleich automatisch an ein vorhandenes Konzept gehängt (§20.3)',
    )


class ExtractedConcept(BaseModel):
    """
    Konzept im Ergebnis von concepts.extract mit mindestens einem gültigen Beleg (LP8)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    key: StrictStr = Field(
        ...,
        description='Schlüssel innerhalb des Ergebnisses (c1, c2, …)',
        pattern='^c[0-9]+$',
    )
    proposal: ConceptProposal
    evidence: list[EvidenceRefSlide | EvidenceRefTranscript] = Field(
        ..., max_length=12, min_length=1
    )


class IcsImportResult(BaseModel):
    """
    Antwort auf POST /calendar/sources (201) und POST /calendar/sources/{id}/sync (200). Der Abgleich läuft synchron im Core, nicht als Job.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    source: CalendarSource
    counts: IcsImportCounts
    neu: list[IcsEventRef]
    geaendert: list[IcsEventRef]
    entfallen: list[IcsEventRef]
    zugeordnet: list[IcsEventRef]
    module_suggestions: list[IcsModuleSuggestion]
    warnings: list[IcsWarning]


class ImageElement(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    element_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    kind: Literal['image']
    frame: list[StrictFloat] = Field(
        ..., description='[x, y, w, h] in pt', max_length=4, min_length=4, title='BBox'
    )
    z: StrictInt
    t_ms: SessionMs | None
    payload: ImageElementPayload


class InboxOverviewSession(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    session: SessionRef | None
    open_count: StrictInt = Field(..., ge=1)
    oldest_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )


class InboxPayloadConceptMerge(BaseModel):
    """
    Nutzlast concept_merge (Vorschlag: dasselbe wie ein vorhandenes Konzept)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['concept_merge']
    proposal: ConceptProposal
    evidence: list[EvidenceRefSlide | EvidenceRefTranscript] = Field(
        ..., max_length=12, min_length=1
    )
    target: Target
    basis: MergeBasis
    similarity: StrictFloat | None = Field(..., ge=0.0, le=1.0)
    reason: StrictStr | None = Field(
        ...,
        description='Begründung der KI, null bei basis = name',
        max_length=500,
        min_length=1,
    )
    prompt_version: StrictStr | None = Field(
        ..., description='null bei basis = name (kein KI-Aufruf)', min_length=1
    )
    model: StrictStr | None = Field(..., min_length=1)


class InboxPayloadConceptNew(BaseModel):
    """
    Nutzlast concept_new (neues Konzept)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['concept_new']
    proposal: ConceptProposal
    evidence: list[EvidenceRefSlide | EvidenceRefTranscript] = Field(
        ..., max_length=12, min_length=1
    )
    similar: list[InboxSimilarConcept] = Field(..., max_length=3)
    prompt_version: StrictStr = Field(..., min_length=1)
    model: StrictStr = Field(..., min_length=1)


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


class NotebookDeleteOp(BaseModel):
    """
    Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem Papierkorb
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^notebook:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='NotebookStreamId',
    )
    kind: Literal['notebook.delete']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: NotebookRefData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class NotebookPages(BaseModel):
    """
    GET /notebooks/{id}/pages, nach index sortiert, ohne gelöschte Seiten
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    notebook_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream_seq: StrictInt = Field(
        ..., description='seq des Stroms notebook:<id> zu diesem Stand', ge=0
    )
    stream_op_id: Uuid | None = Field(
        ...,
        description='op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id senden',
    )
    items: list[Page]


class NotebookUpdateData(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    notebook_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    fields: NotebookUpdateFields


class NotebookUpdateOp(BaseModel):
    """
    Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem Papierkorb
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^notebook:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='NotebookStreamId',
    )
    kind: Literal['notebook.update']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: NotebookUpdateData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class PageStrokes(BaseModel):
    """
    GET /pages/{id}/strokes: alle nicht gelöschten Striche, nach created_at sortiert
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    page_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream_seq: StrictInt = Field(
        ..., description='seq des Stroms notebook:<id> zu diesem Stand', ge=0
    )
    stream_op_id: Uuid | None = Field(
        ...,
        description='op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id senden',
    )
    strokes: list[Stroke]


class PageUpdateData(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    page_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    fields: PageUpdateFields
    version: StrictInt = Field(
        ...,
        description='Version, auf der die Änderung beruht. Der Core setzt danach version + 1',
        ge=1,
    )


class PageUpdateOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^notebook:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='NotebookStreamId',
    )
    kind: Literal['page.update']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: PageUpdateData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class PhotoAddData(BaseModel):
    """
    Datei per PUT /photos/{photo_id}/file, Reihenfolge egal
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    photo_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    t_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    page_id: Uuid | None
    file_ref: PhotoFileRef


class PhotoAddOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='SessionStreamId',
    )
    kind: Literal['photo.add']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: PhotoAddData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class SearchHitSlide(BaseModel):
    """
    Treffer auf einer Folie. Ziel: /dokument?typ=folien&id=<deck_id>&seite=<slide_index>
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['slide']
    chunk_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    score: StrictFloat = Field(..., gt=0.0)
    module: SearchModuleRef
    snippet: list[SearchSnippetPart]
    deck_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    deck_title: StrictStr
    slide_index: StrictInt = Field(..., ge=1)
    slide_title: StrictStr | None


class SearchHitTranscript(BaseModel):
    """
    Treffer im Gesagten (Transkript-Fenster). Ziel: /rueckblick?id=<session_id>&t=<t_ms>
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['transcript']
    chunk_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    score: StrictFloat = Field(..., gt=0.0)
    module: SearchModuleRef
    snippet: list[SearchSnippetPart]
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    session_number: StrictInt | None = Field(
        ..., description='VL-Nummer (Session.number)', ge=1
    )
    session_title: StrictStr | None
    session_started_at: AwareDatetime | None
    t_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    t_end_ms: StrictInt = Field(
        ...,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )


class Session(BaseModel):
    """
    Durchführung eines Termins. planned_starts_at/planned_ends_at sind abgeleitet aus dem Kalendertermin (null bei spontanen Sessions).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    user_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    deleted_at: AwareDatetime | None
    calendar_event_id: Uuid | None
    module_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    slide_deck_id: Uuid | None
    number: StrictInt | None = Field(
        ..., description='VL-Nummer im Modul (VL 7), Regeln in docs/VERTRAEGE.md', ge=1
    )
    title: StrictStr | None
    state: SessionState
    started_at: AwareDatetime | None
    ended_at: AwareDatetime | None
    stop_reason: StopReason | None
    started_from: ClientDevice | None
    processing: dict[str, JobState]
    review_state: ReviewState
    planned_starts_at: AwareDatetime | None
    planned_ends_at: AwareDatetime | None
    auto_stop_extended_until: AwareDatetime | None
    start_offsets: list[SessionStartOffset] | None = Field(
        None,
        description='Abweichende Startzeiten von Geräten (VERTRAEGE §9.3). Fehlt oder leer = keine Abweichung',
    )


class SessionConceptItem(BaseModel):
    """
    Konzept mit Belegen aus genau dieser Session
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    concept: Concept
    evidence: list[EvidenceView]
    inbox_item_id: Uuid | None
    inbox_status: InboxStatus | None


class SessionConcepts(BaseModel):
    """
    GET /sessions/{id}/concepts: aktive und vorgeschlagene Konzepte mit Belegen aus der Session
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    items: list[SessionConceptItem]


class SessionList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[Session]
    next_cursor: StrictStr | None


class SessionPauseOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='SessionStreamId',
    )
    kind: Literal['session.pause']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: SessionRefData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class SessionReprocessResult(BaseModel):
    """
    Antwort von POST /sessions/{id}/reprocess (202)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session: Session
    jobs: list[Job] = Field(
        ..., description='Angelegte oder wiederverwendete Jobs in Ketten-Reihenfolge'
    )


class SessionSnapshot(BaseModel):
    """
    GET /sessions/{id}/snapshot: Live-Stand für Dashboard und iPad (ohne gelöschte Objekte, nach t_ms sortiert)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session: Session
    slide_events: list[SlideEvent]
    markers: list[Marker]
    photos: list[Photo]
    recordings: list[Recording]
    stream_seq: StrictInt = Field(
        ...,
        description='seq des Stroms session:<id>, zu der dieser Stand gehört. Danach per Sync ab stream_seq + 1',
        ge=0,
    )
    stream_op_id: Uuid | None = Field(
        ...,
        description='op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id senden',
    )


class SessionStartResult(BaseModel):
    """
    ended_session: eine andere Session, die wegen des Starts automatisch beendet wurde (F-SES-02)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session: Session
    ended_session: Session | None


class SessionTranscript(BaseModel):
    """
    GET /sessions/{id}/transcript: alles für den Rückblick einer Session (F-NAC-02). Listen nach start_ms sortiert
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    slide_deck_id: Uuid | None
    slide_source: SlideSegmentSource | None = Field(
        ...,
        description='Quelle der gelieferten slide_segments: manuell vor ausrichtung vor log. null = keine Zuordnung',
    )
    slide_segments: list[SlideSegment]
    transcripts: list[TranscriptInfo]
    recordings: list[Recording]
    lines: list[TranscriptLine]
    stale: StrictBool = Field(
        ...,
        description='true: mindestens eine Aufnahme mit fertigem audio.finalize hat kein oder ein veraltetes Transkript',
    )


class ShapeElement(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    element_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    kind: Literal['shape']
    frame: list[StrictFloat] = Field(
        ..., description='[x, y, w, h] in pt', max_length=4, min_length=4, title='BBox'
    )
    z: StrictInt
    t_ms: SessionMs | None
    payload: ShapeElementPayload


class StampElement(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    element_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    kind: Literal['stamp']
    frame: list[StrictFloat] = Field(
        ..., description='[x, y, w, h] in pt', max_length=4, min_length=4, title='BBox'
    )
    z: StrictInt
    t_ms: SessionMs | None
    payload: StampElementPayload


class SummaryOutlineItem(BaseModel):
    """
    Ein Gliederungspunkt (Kapitel aus den Folien)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    title: StrictStr = Field(..., max_length=200, min_length=1)
    sources: list[EvidenceRefSlide | EvidenceRefTranscript] = Field(
        ..., max_length=6, min_length=0
    )


class SummarySentence(BaseModel):
    """
    Ein Satz der Kurzfassung mit Belegen (LP8)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    text: StrictStr = Field(..., max_length=600, min_length=1)
    sources: list[EvidenceRefSlide | EvidenceRefTranscript] = Field(
        ..., max_length=6, min_length=1
    )


class SyncConnectionEvent(BaseModel):
    """
    Ein Client hat sich verbunden oder getrennt (iPad-Status, F-DSH-06)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['event']
    name: Literal['device.connection']
    data: SyncConnectionInfo


class SyncHello(BaseModel):
    """
    Erste Nachricht des Clients (08 §2.1). Das Gerätetoken steht nicht hier, sondern beim Upgrade im Header Authorization: Bearer (VERTRAEGE §11.1). device_id nur zur Gegenprobe.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['hello']
    protocol: Literal[1]
    client: SyncClientKind
    device_id: StrictStr | None = Field(
        None,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    app_version: StrictStr = Field(..., min_length=1)
    streams: list[SyncStreamPosition]


class SyncPresenceEvent(BaseModel):
    """
    Weitergabe von presence eines anderen Clients
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['event']
    name: Literal['presence']
    data: SyncPresenceInfo


class SyncSessionUpdatedEvent(BaseModel):
    """
    Zustand oder Felder einer Session haben sich geändert (auch zeitgesteuert: bereit, verpasst, verarbeitet)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['event']
    name: Literal['session.updated']
    data: Session


class TapeElement(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    element_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    kind: Literal['tape']
    frame: list[StrictFloat] = Field(
        ..., description='[x, y, w, h] in pt', max_length=4, min_length=4, title='BBox'
    )
    z: StrictInt
    t_ms: SessionMs | None
    payload: TapeElementPayload


class TextElement(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    element_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    kind: Literal['text']
    frame: list[StrictFloat] = Field(
        ..., description='[x, y, w, h] in pt', max_length=4, min_length=4, title='BBox'
    )
    z: StrictInt
    t_ms: SessionMs | None
    payload: TextElementPayload


class TrashItem(BaseModel):
    """
    Direkt gelöschtes Objekt im Papierkorb (F-DAT-04). Mitgelöschte Teile erscheinen nicht einzeln.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    kind: TrashKind
    title: StrictStr = Field(
        ..., description='Anzeigename (Titel, Name oder z. B. „Seite 3")'
    )
    deleted_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    purge_at: AwareDatetime = Field(..., description='ISO 8601, UTC', title='Timestamp')
    parent: TrashParent | None
    dependent_count: StrictInt = Field(
        ...,
        description='Mitgelöschte abhängige Objekte, die der Nutzer kennt und die mit wiederhergestellt werden. Maschinenausgaben (transcript, transcript_segment, slide_segment, search_chunk) werden mitgelöscht und mitwiederhergestellt, aber nicht mitgezählt (VERTRAEGE §13)',
        ge=0,
    )


class TrashList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[TrashItem]
    next_cursor: StrictStr | None


class BackupOverview(BaseModel):
    """
    GET /backups: Status und Läufe, neueste zuerst
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    status: BackupStatus
    items: list[BackupRun]
    next_cursor: StrictStr | None


class ConceptDetail(BaseModel):
    """
    GET /concepts/{id}
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    concept: Concept
    modules: list[SearchModuleRef]
    evidence: list[EvidenceView] = Field(
        ..., description='nicht gelöschte Belege, neueste Session zuerst, höchstens 200'
    )
    relations: list[ConceptRelationView] = Field(
        ..., description='nur bestätigte Beziehungen zu nicht gelöschten Konzepten'
    )
    inbox_item_id: Uuid | None


class ConceptList(BaseModel):
    """
    GET /concepts
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[ConceptListItem]
    next_cursor: StrictStr | None


class ConceptsExtractResult(BaseModel):
    """
    Ergebnis von concepts.extract (job.result). concepts.resolve liest es über extract_job_id
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    session_deleted: StrictBool = Field(
        ..., description='true: Session weich gelöscht, nichts aufgerufen'
    )
    empty: StrictBool = Field(
        ..., description='true: weder Folien noch Transkript, kein Aufruf'
    )
    unchanged: StrictBool = Field(
        ...,
        description='true: gleicher input_hash wie das letzte fertige Ergebnis, übernommen statt aufgerufen',
    )
    input_hash: StrictStr | None = Field(..., pattern='^[0-9a-f]{64}$')
    prompt_version: StrictStr | None = Field(
        ..., description='z. B. concepts.extract/v1', min_length=1
    )
    model: StrictStr | None = Field(
        ...,
        description='Modell der Antwort (nach einem Refusal-Fallback das tatsächlich genutzte)',
        min_length=1,
    )
    chapters: StrictInt = Field(
        ..., description='Anzahl der Aufrufe (Kapitel), 0 ohne Aufruf', ge=0
    )
    concepts: list[ExtractedConcept] = Field(..., max_length=30)
    relations: list[ExtractedRelation] = Field(..., max_length=60)
    dropped_concepts: StrictInt = Field(
        ..., description='verworfen, weil kein Beleg gültig war', ge=0
    )
    dropped_evidence: StrictInt = Field(..., ge=0)
    dropped_relations: StrictInt = Field(..., ge=0)
    cost_eur: StrictFloat = Field(
        ..., description='Euro (Schätzung, VERTRAEGE §20.5)', ge=0.0
    )


class InboxOverview(BaseModel):
    """
    GET /inbox/overview: Zähler für Navigation und Gruppen (F-NAC-06)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    open_count: StrictInt = Field(..., ge=0)
    older_count: StrictInt = Field(
        ...,
        description='offene Einträge älter als 14 Tage („12 ältere Vorschläge“)',
        ge=0,
    )
    sessions: list[InboxOverviewSession] = Field(
        ..., description='Gruppen mit offenen Einträgen, neueste Session zuerst'
    )


class MoodleCourseContents(BaseModel):
    """
    Antwort von GET /moodle/courses/{course_id}/contents
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    course_id: StrictInt = Field(..., description='Moodle-ID', ge=1)
    sections: list[MoodleSection]


class SearchResponse(BaseModel):
    """
    GET /search (VERTRAEGE §19.6)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    query: StrictStr = Field(..., description='Suchtext ohne Filter-Präfixe')
    mode: Mode
    degraded: SearchDegraded1 | None = Field(
        ...,
        description='Warum nur Wortsuche lief. null bei mode = hybrid oder ohne Wörter',
        title='SearchDegraded',
    )
    filters: Filters
    hits: list[SearchHitSlide | SearchHitTranscript] = Field(..., max_length=50)
    took_ms: StrictInt = Field(..., ge=0)


class SessionSummary(BaseModel):
    """
    Zusammenfassung einer Session (Tabelle session_summary, F-NAC-08 ohne Vault). Direkt sichtbar, kein Inbox-Vorschlag (§20.4)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    lang: Lang | None
    sentences: list[SummarySentence] = Field(..., max_length=5, min_length=1)
    outline: list[SummaryOutlineItem] = Field(..., max_length=30, min_length=0)
    model: StrictStr = Field(..., min_length=1)
    prompt_version: StrictStr = Field(..., min_length=1)
    job_id: Uuid | None


class SessionSummaryView(BaseModel):
    """
    GET /sessions/{id}/summary. summary = null: (noch) keine Zusammenfassung
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    summary: SessionSummary | None


class ElementUpsertData(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    page_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    element: TextElement | ImageElement | ShapeElement | TapeElement | StampElement = (
        Field(
            ...,
            description='Seitenelement (08 §4.4), unterschieden über kind. frame [x, y, w, h] in pt. crop bei image: [x, y, w, h] relativ zum Bild (0–1), null = ganzes Bild. Phase 1 nutzt image (Tafel-Foto) und stamp (Marker-Stempel).',
            title='PageElement',
        )
    )


class ElementUpsertOp(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['op']
    op_id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    stream: StrictStr = Field(
        ...,
        pattern='^notebook:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='NotebookStreamId',
    )
    kind: Literal['element.upsert']
    at: StrictInt = Field(
        ...,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    clock_uncertain: StrictBool
    data: ElementUpsertData
    seq: StrictInt | None = Field(None, description='Nur Server → Client', ge=1)
    origin: SyncOrigin | None = None


class InboxItem(BaseModel):
    """
    Inbox-Eintrag (03 §8, F-NAC-06)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    id: StrictStr = Field(
        ...,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    created_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    updated_at: AwareDatetime = Field(
        ..., description='ISO 8601, UTC', title='Timestamp'
    )
    kind: InboxKind
    status: InboxStatus
    session: SessionRef | None
    job_id: Uuid | None
    priority: StrictInt = Field(
        ..., description='kleiner = früher (Reihenfolge der geführten Nacharbeitung)'
    )
    decided_at: AwareDatetime | None
    payload: (
        InboxPayloadConceptNew | InboxPayloadConceptMerge | InboxPayloadRelation
    ) = Field(..., description='Schemageprüfte Nutzlast eines Inbox-Eintrags (03 §8), unterschieden über kind', title='InboxPayload')
    concept_id: Uuid | None
    target_concept_id: Uuid | None
    relation_id: Uuid | None
    blocked: InboxBlockedReason | None


class InboxItemList(BaseModel):
    """
    GET /inbox
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[InboxItem]
    next_cursor: StrictStr | None


class PageDetail(BaseModel):
    """
    GET /pages/{id}: Seite mit Elementen (ohne gelöschte, nach z sortiert)
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    page: Page
    elements: list[TextElement | ImageElement | ShapeElement | TapeElement | StampElement]
    stream_seq: StrictInt = Field(..., ge=0)
    stream_op_id: Uuid | None = Field(
        ...,
        description='op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id senden',
    )


class InboxDecisionResult(BaseModel):
    """
    Antwort auf accept, reject und reopen
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    item: InboxItem
    concept: Concept | None


class SchemaBundle(BaseModel):
    """
    GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen
    """

    AiBudgetStatus_1: AiBudgetStatus | None = Field(None, alias='AiBudgetStatus')
    AiSettings_1: AiSettings | None = Field(None, alias='AiSettings')
    AiSettingsUpdate_1: AiSettingsUpdate | None = Field(None, alias='AiSettingsUpdate')
    AiStatus_1: AiStatus | None = Field(None, alias='AiStatus')
    AlignLogMode_1: AlignLogMode | None = Field(None, alias='AlignLogMode')
    AlignLogPayload_1: AlignLogPayload | None = Field(None, alias='AlignLogPayload')
    AlignLogResult_1: AlignLogResult | None = Field(None, alias='AlignLogResult')
    ApiError_1: ApiError | None = Field(None, alias='ApiError')
    ApiErrorBody_1: ApiErrorBody | None = Field(None, alias='ApiErrorBody')
    Appearance_1: Appearance | None = Field(None, alias='Appearance')
    AudioChunk_1: AudioChunk | None = Field(None, alias='AudioChunk')
    AudioChunkMeta_1: AudioChunkMeta | None = Field(None, alias='AudioChunkMeta')
    AudioCodec_1: AudioCodec | None = Field(None, alias='AudioCodec')
    AudioFinalizePayload_1: AudioFinalizePayload | None = Field(
        None, alias='AudioFinalizePayload'
    )
    AudioFinalizeResult_1: AudioFinalizeResult | None = Field(
        None, alias='AudioFinalizeResult'
    )
    AudioGap_1: AudioGap | None = Field(None, alias='AudioGap')
    AudioGapReason_1: AudioGapReason | None = Field(None, alias='AudioGapReason')
    AutoAcceptMode_1: AutoAcceptMode | None = Field(None, alias='AutoAcceptMode')
    BBox: list[StrictFloat] | None = Field(
        None, description='[x, y, w, h] in pt', max_length=4, min_length=4, title='BBox'
    )
    BackupOverview_1: BackupOverview | None = Field(None, alias='BackupOverview')
    BackupRun_1: BackupRun | None = Field(None, alias='BackupRun')
    BackupState_1: BackupState | None = Field(None, alias='BackupState')
    BackupStatus_1: BackupStatus | None = Field(None, alias='BackupStatus')
    BackupTrigger_1: BackupTrigger | None = Field(None, alias='BackupTrigger')
    CalendarAssignment_1: CalendarAssignment | None = Field(
        None, alias='CalendarAssignment'
    )
    CalendarEvent_1: CalendarEvent | None = Field(None, alias='CalendarEvent')
    CalendarEventKind_1: CalendarEventKind | None = Field(
        None, alias='CalendarEventKind'
    )
    CalendarEventList_1: CalendarEventList | None = Field(
        None, alias='CalendarEventList'
    )
    CalendarEventUpdate_1: CalendarEventUpdate | None = Field(
        None, alias='CalendarEventUpdate'
    )
    CalendarReassignResult_1: CalendarReassignResult | None = Field(
        None, alias='CalendarReassignResult'
    )
    CalendarSource_1: CalendarSource | None = Field(None, alias='CalendarSource')
    CalendarSourceCreate_1: CalendarSourceCreate | None = Field(
        None, alias='CalendarSourceCreate'
    )
    CalendarSourceKind_1: CalendarSourceKind | None = Field(
        None, alias='CalendarSourceKind'
    )
    CalendarSourceList_1: CalendarSourceList | None = Field(
        None, alias='CalendarSourceList'
    )
    CalendarUpdateScope_1: CalendarUpdateScope | None = Field(
        None, alias='CalendarUpdateScope'
    )
    ClientDevice_1: ClientDevice | None = Field(None, alias='ClientDevice')
    ColumnWidths: list[ColumnWidth] | None = Field(
        None,
        description='Spaltenbreiten Folie | Übung | Notizen in Prozent, Summe 100',
        max_length=3,
        min_length=3,
        title='ColumnWidths',
    )
    Concept_1: Concept | None = Field(None, alias='Concept')
    ConceptDetail_1: ConceptDetail | None = Field(None, alias='ConceptDetail')
    ConceptEdit_1: ConceptEdit | None = Field(None, alias='ConceptEdit')
    ConceptKind_1: ConceptKind | None = Field(None, alias='ConceptKind')
    ConceptList_1: ConceptList | None = Field(None, alias='ConceptList')
    ConceptListItem_1: ConceptListItem | None = Field(None, alias='ConceptListItem')
    ConceptProposal_1: ConceptProposal | None = Field(None, alias='ConceptProposal')
    ConceptRelationKind_1: ConceptRelationKind | None = Field(
        None, alias='ConceptRelationKind'
    )
    ConceptRelationSource_1: ConceptRelationSource | None = Field(
        None, alias='ConceptRelationSource'
    )
    ConceptRelationView_1: ConceptRelationView | None = Field(
        None, alias='ConceptRelationView'
    )
    ConceptStatus_1: ConceptStatus | None = Field(None, alias='ConceptStatus')
    ConceptsExtractPayload_1: ConceptsExtractPayload | None = Field(
        None, alias='ConceptsExtractPayload'
    )
    ConceptsExtractResult_1: ConceptsExtractResult | None = Field(
        None, alias='ConceptsExtractResult'
    )
    ConceptsResolvePayload_1: ConceptsResolvePayload | None = Field(
        None, alias='ConceptsResolvePayload'
    )
    ConceptsResolveResult_1: ConceptsResolveResult | None = Field(
        None, alias='ConceptsResolveResult'
    )
    CostByModel_1: CostByModel | None = Field(None, alias='CostByModel')
    CostBySession_1: CostBySession | None = Field(None, alias='CostBySession')
    CostByTask_1: CostByTask | None = Field(None, alias='CostByTask')
    CostSummary_1: CostSummary | None = Field(None, alias='CostSummary')
    DashboardLayout_1: DashboardLayout | None = Field(None, alias='DashboardLayout')
    DataSettings_1: DataSettings | None = Field(None, alias='DataSettings')
    DataSettingsUpdate_1: DataSettingsUpdate | None = Field(
        None, alias='DataSettingsUpdate'
    )
    Device_1: Device | None = Field(None, alias='Device')
    DeviceKind_1: DeviceKind | None = Field(None, alias='DeviceKind')
    DeviceList_1: DeviceList | None = Field(None, alias='DeviceList')
    DrawingSnapshotData_1: DrawingSnapshotData | None = Field(
        None, alias='DrawingSnapshotData'
    )
    DrawingSnapshotOp_1: DrawingSnapshotOp | None = Field(
        None, alias='DrawingSnapshotOp'
    )
    ElementRemoveData_1: ElementRemoveData | None = Field(
        None, alias='ElementRemoveData'
    )
    ElementRemoveOp_1: ElementRemoveOp | None = Field(None, alias='ElementRemoveOp')
    ElementUpsertData_1: ElementUpsertData | None = Field(
        None, alias='ElementUpsertData'
    )
    ElementUpsertOp_1: ElementUpsertOp | None = Field(None, alias='ElementUpsertOp')
    EmbedRequest_1: EmbedRequest | None = Field(None, alias='EmbedRequest')
    EmbedResponse_1: EmbedResponse | None = Field(None, alias='EmbedResponse')
    EmbedderState_1: EmbedderState | None = Field(None, alias='EmbedderState')
    EpochMs: StrictInt | None = Field(
        None,
        description='Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).',
        ge=0,
        title='EpochMs',
    )
    EvidenceRef: EvidenceRefSlide | EvidenceRefTranscript | None = Field(
        None,
        description='Verweis auf eine Quelle, unterschieden über kind (anyOf statt oneOf, damit Zod einen typisierten Union erzeugt)',
        title='EvidenceRef',
    )
    EvidenceRefSlide_1: EvidenceRefSlide | None = Field(None, alias='EvidenceRefSlide')
    EvidenceRefTranscript_1: EvidenceRefTranscript | None = Field(
        None, alias='EvidenceRefTranscript'
    )
    EvidenceView_1: EvidenceView | None = Field(None, alias='EvidenceView')
    ExerciseSheet_1: ExerciseSheet | None = Field(None, alias='ExerciseSheet')
    ExerciseSheetList_1: ExerciseSheetList | None = Field(
        None, alias='ExerciseSheetList'
    )
    ExerciseSheetUpdate_1: ExerciseSheetUpdate | None = Field(
        None, alias='ExerciseSheetUpdate'
    )
    ExtractedConcept_1: ExtractedConcept | None = Field(None, alias='ExtractedConcept')
    ExtractedRelation_1: ExtractedRelation | None = Field(
        None, alias='ExtractedRelation'
    )
    FileReceipt_1: FileReceipt | None = Field(None, alias='FileReceipt')
    FileRef_1: FileRef | None = Field(None, alias='FileRef')
    GeneralSettings_1: GeneralSettings | None = Field(None, alias='GeneralSettings')
    GeneralSettingsUpdate_1: GeneralSettingsUpdate | None = Field(
        None, alias='GeneralSettingsUpdate'
    )
    Health_1: Health | None = Field(None, alias='Health')
    HexColor: StrictStr | None = Field(
        None,
        description='RGBA als #RRGGBBAA',
        examples=['#1E2A44FF'],
        pattern='^#[0-9A-Fa-f]{8}$',
        title='HexColor',
    )
    IcsEventRef_1: IcsEventRef | None = Field(None, alias='IcsEventRef')
    IcsImportCounts_1: IcsImportCounts | None = Field(None, alias='IcsImportCounts')
    IcsImportResult_1: IcsImportResult | None = Field(None, alias='IcsImportResult')
    IcsModuleSuggestion_1: IcsModuleSuggestion | None = Field(
        None, alias='IcsModuleSuggestion'
    )
    IcsWarning_1: IcsWarning | None = Field(None, alias='IcsWarning')
    ImageElement_1: ImageElement | None = Field(None, alias='ImageElement')
    ImageElementPayload_1: ImageElementPayload | None = Field(
        None, alias='ImageElementPayload'
    )
    InboxAcceptRequest_1: InboxAcceptRequest | None = Field(
        None, alias='InboxAcceptRequest'
    )
    InboxBlockedReason_1: InboxBlockedReason | None = Field(
        None, alias='InboxBlockedReason'
    )
    InboxBulkRequest_1: InboxBulkRequest | None = Field(None, alias='InboxBulkRequest')
    InboxBulkResult_1: InboxBulkResult | None = Field(None, alias='InboxBulkResult')
    InboxDecision_1: InboxDecision | None = Field(None, alias='InboxDecision')
    InboxDecisionResult_1: InboxDecisionResult | None = Field(
        None, alias='InboxDecisionResult'
    )
    InboxItem_1: InboxItem | None = Field(None, alias='InboxItem')
    InboxItemList_1: InboxItemList | None = Field(None, alias='InboxItemList')
    InboxKind_1: InboxKind | None = Field(None, alias='InboxKind')
    InboxOverview_1: InboxOverview | None = Field(None, alias='InboxOverview')
    InboxOverviewSession_1: InboxOverviewSession | None = Field(
        None, alias='InboxOverviewSession'
    )
    InboxPayload: (
        InboxPayloadConceptNew | InboxPayloadConceptMerge | InboxPayloadRelation | None
    ) = Field(None, description='Schemageprüfte Nutzlast eines Inbox-Eintrags (03 §8), unterschieden über kind', title='InboxPayload')
    InboxPayloadConceptMerge_1: InboxPayloadConceptMerge | None = Field(
        None, alias='InboxPayloadConceptMerge'
    )
    InboxPayloadConceptNew_1: InboxPayloadConceptNew | None = Field(
        None, alias='InboxPayloadConceptNew'
    )
    InboxPayloadRelation_1: InboxPayloadRelation | None = Field(
        None, alias='InboxPayloadRelation'
    )
    InboxSimilarConcept_1: InboxSimilarConcept | None = Field(
        None, alias='InboxSimilarConcept'
    )
    InboxStatus_1: InboxStatus | None = Field(None, alias='InboxStatus')
    IngestState_1: IngestState | None = Field(None, alias='IngestState')
    InkMode_1: InkMode | None = Field(None, alias='InkMode')
    IsoDate: date | None = Field(None, title='IsoDate')
    Job_1: Job | None = Field(None, alias='Job')
    JobList_1: JobList | None = Field(None, alias='JobList')
    JobState_1: JobState | None = Field(None, alias='JobState')
    JobType_1: JobType | None = Field(None, alias='JobType')
    Lang_1: Lang | None = Field(None, alias='Lang')
    LanguageCode: StrictStr | None = Field(
        None,
        description='Von Whisper erkannte Sprache, ISO 639-1 (z. B. de, en)',
        examples=['de'],
        pattern='^[a-z]{2,3}$',
        title='LanguageCode',
    )
    LectureSettings_1: LectureSettings | None = Field(None, alias='LectureSettings')
    LectureSettingsUpdate_1: LectureSettingsUpdate | None = Field(
        None, alias='LectureSettingsUpdate'
    )
    LlmIssue_1: LlmIssue | None = Field(None, alias='LlmIssue')
    MaintenanceNightlyPayload_1: MaintenanceNightlyPayload | None = Field(
        None, alias='MaintenanceNightlyPayload'
    )
    MaintenanceNightlyResult_1: MaintenanceNightlyResult | None = Field(
        None, alias='MaintenanceNightlyResult'
    )
    Marker_1: Marker | None = Field(None, alias='Marker')
    MarkerAddData_1: MarkerAddData | None = Field(None, alias='MarkerAddData')
    MarkerAddOp_1: MarkerAddOp | None = Field(None, alias='MarkerAddOp')
    MarkerKind_1: MarkerKind | None = Field(None, alias='MarkerKind')
    MarkerPosition_1: MarkerPosition | None = Field(None, alias='MarkerPosition')
    MarkerRemoveData_1: MarkerRemoveData | None = Field(None, alias='MarkerRemoveData')
    MarkerRemoveOp_1: MarkerRemoveOp | None = Field(None, alias='MarkerRemoveOp')
    MarkerSource_1: MarkerSource | None = Field(None, alias='MarkerSource')
    MergeBasis_1: MergeBasis | None = Field(None, alias='MergeBasis')
    Module_1: Module | None = Field(None, alias='Module')
    ModuleColor_1: ModuleColor | None = Field(None, alias='ModuleColor')
    ModuleCreate_1: ModuleCreate | None = Field(None, alias='ModuleCreate')
    ModuleList_1: ModuleList | None = Field(None, alias='ModuleList')
    ModuleSettings_1: ModuleSettings | None = Field(None, alias='ModuleSettings')
    ModuleSettingsUpdate_1: ModuleSettingsUpdate | None = Field(
        None, alias='ModuleSettingsUpdate'
    )
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
    MoodleAutoAssignResult_1: MoodleAutoAssignResult | None = Field(
        None, alias='MoodleAutoAssignResult'
    )
    MoodleCompletion_1: MoodleCompletion | None = Field(None, alias='MoodleCompletion')
    MoodleConnectionState_1: MoodleConnectionState | None = Field(
        None, alias='MoodleConnectionState'
    )
    MoodleCourse_1: MoodleCourse | None = Field(None, alias='MoodleCourse')
    MoodleCourseCategory_1: MoodleCourseCategory | None = Field(
        None, alias='MoodleCourseCategory'
    )
    MoodleCourseContents_1: MoodleCourseContents | None = Field(
        None, alias='MoodleCourseContents'
    )
    MoodleCourseLink_1: MoodleCourseLink | None = Field(None, alias='MoodleCourseLink')
    MoodleCourseLinkList_1: MoodleCourseLinkList | None = Field(
        None, alias='MoodleCourseLinkList'
    )
    MoodleCourseLinkUpdate_1: MoodleCourseLinkUpdate | None = Field(
        None, alias='MoodleCourseLinkUpdate'
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
    MoodleItem_1: MoodleItem | None = Field(None, alias='MoodleItem')
    MoodleItemKind_1: MoodleItemKind | None = Field(None, alias='MoodleItemKind')
    MoodleItemList_1: MoodleItemList | None = Field(None, alias='MoodleItemList')
    MoodleItemUpdate_1: MoodleItemUpdate | None = Field(None, alias='MoodleItemUpdate')
    MoodleLinkAuto_1: MoodleLinkAuto | None = Field(None, alias='MoodleLinkAuto')
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
    MoodleSyncRequest_1: MoodleSyncRequest | None = Field(
        None, alias='MoodleSyncRequest'
    )
    MoodleSyncRun_1: MoodleSyncRun | None = Field(None, alias='MoodleSyncRun')
    MoodleSyncState_1: MoodleSyncState | None = Field(None, alias='MoodleSyncState')
    MoodleSyncStatus_1: MoodleSyncStatus | None = Field(None, alias='MoodleSyncStatus')
    MoodleSyncTrigger_1: MoodleSyncTrigger | None = Field(
        None, alias='MoodleSyncTrigger'
    )
    MoodleSyncedDeadline_1: MoodleSyncedDeadline | None = Field(
        None, alias='MoodleSyncedDeadline'
    )
    MoodleSyncedDeadlineList_1: MoodleSyncedDeadlineList | None = Field(
        None, alias='MoodleSyncedDeadlineList'
    )
    MoodleUpload_1: MoodleUpload | None = Field(None, alias='MoodleUpload')
    Notebook_1: Notebook | None = Field(None, alias='Notebook')
    NotebookCreate_1: NotebookCreate | None = Field(None, alias='NotebookCreate')
    NotebookCreateData_1: NotebookCreateData | None = Field(
        None, alias='NotebookCreateData'
    )
    NotebookCreateOp_1: NotebookCreateOp | None = Field(None, alias='NotebookCreateOp')
    NotebookDeleteOp_1: NotebookDeleteOp | None = Field(None, alias='NotebookDeleteOp')
    NotebookKind_1: NotebookKind | None = Field(None, alias='NotebookKind')
    NotebookList_1: NotebookList | None = Field(None, alias='NotebookList')
    NotebookPages_1: NotebookPages | None = Field(None, alias='NotebookPages')
    NotebookRefData_1: NotebookRefData | None = Field(None, alias='NotebookRefData')
    NotebookRestoreOp_1: NotebookRestoreOp | None = Field(
        None, alias='NotebookRestoreOp'
    )
    NotebookStreamId: StrictStr | None = Field(
        None,
        pattern='^notebook:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='NotebookStreamId',
    )
    NotebookUpdate_1: NotebookUpdate | None = Field(None, alias='NotebookUpdate')
    NotebookUpdateData_1: NotebookUpdateData | None = Field(
        None, alias='NotebookUpdateData'
    )
    NotebookUpdateFields_1: NotebookUpdateFields | None = Field(
        None, alias='NotebookUpdateFields'
    )
    NotebookUpdateOp_1: NotebookUpdateOp | None = Field(None, alias='NotebookUpdateOp')
    Page_1: Page | None = Field(None, alias='Page')
    PageCreateData_1: PageCreateData | None = Field(None, alias='PageCreateData')
    PageCreateOp_1: PageCreateOp | None = Field(None, alias='PageCreateOp')
    PageDeleteData_1: PageDeleteData | None = Field(None, alias='PageDeleteData')
    PageDeleteOp_1: PageDeleteOp | None = Field(None, alias='PageDeleteOp')
    PageDetail_1: PageDetail | None = Field(None, alias='PageDetail')
    PageElement: (
        TextElement | ImageElement | ShapeElement | TapeElement | StampElement | None
    ) = Field(None, description='Seitenelement (08 §4.4), unterschieden über kind. frame [x, y, w, h] in pt. crop bei image: [x, y, w, h] relativ zum Bild (0–1), null = ganzes Bild. Phase 1 nutzt image (Tafel-Foto) und stamp (Marker-Stempel).', title='PageElement')
    PageRefData_1: PageRefData | None = Field(None, alias='PageRefData')
    PageRestoreOp_1: PageRestoreOp | None = Field(None, alias='PageRestoreOp')
    PageStrokes_1: PageStrokes | None = Field(None, alias='PageStrokes')
    PageTemplate_1: PageTemplate | None = Field(None, alias='PageTemplate')
    PageUpdateData_1: PageUpdateData | None = Field(None, alias='PageUpdateData')
    PageUpdateFields_1: PageUpdateFields | None = Field(None, alias='PageUpdateFields')
    PageUpdateOp_1: PageUpdateOp | None = Field(None, alias='PageUpdateOp')
    PairConfirmRequest_1: PairConfirmRequest | None = Field(
        None, alias='PairConfirmRequest'
    )
    PairResponse_1: PairResponse | None = Field(None, alias='PairResponse')
    PairStartRequest_1: PairStartRequest | None = Field(None, alias='PairStartRequest')
    PairStartResponse_1: PairStartResponse | None = Field(
        None, alias='PairStartResponse'
    )
    PairingCode_1: PairingCode | None = Field(None, alias='PairingCode')
    PairingRequest_1: PairingRequest | None = Field(None, alias='PairingRequest')
    PairingRequestList_1: PairingRequestList | None = Field(
        None, alias='PairingRequestList'
    )
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
    PenSettings_1: PenSettings | None = Field(None, alias='PenSettings')
    PenSettingsUpdate_1: PenSettingsUpdate | None = Field(
        None, alias='PenSettingsUpdate'
    )
    PencilDoubleTapAction_1: PencilDoubleTapAction | None = Field(
        None, alias='PencilDoubleTapAction'
    )
    PencilSqueezeAction_1: PencilSqueezeAction | None = Field(
        None, alias='PencilSqueezeAction'
    )
    Photo_1: Photo | None = Field(None, alias='Photo')
    PhotoAddData_1: PhotoAddData | None = Field(None, alias='PhotoAddData')
    PhotoAddOp_1: PhotoAddOp | None = Field(None, alias='PhotoAddOp')
    PhotoFileRef_1: PhotoFileRef | None = Field(None, alias='PhotoFileRef')
    PhotoMime_1: PhotoMime | None = Field(None, alias='PhotoMime')
    PipelineStep_1: PipelineStep | None = Field(None, alias='PipelineStep')
    Point2: list[StrictFloat] | None = Field(
        None, description='[x, y] in pt', max_length=2, min_length=2, title='Point2'
    )
    Recording_1: Recording | None = Field(None, alias='Recording')
    RecordingComplete_1: RecordingComplete | None = Field(
        None, alias='RecordingComplete'
    )
    RecordingCreate_1: RecordingCreate | None = Field(None, alias='RecordingCreate')
    RecordingState_1: RecordingState | None = Field(None, alias='RecordingState')
    ResolveVerdict_1: ResolveVerdict | None = Field(None, alias='ResolveVerdict')
    RestoreTest_1: RestoreTest | None = Field(None, alias='RestoreTest')
    RestoreTestReason_1: RestoreTestReason | None = Field(
        None, alias='RestoreTestReason'
    )
    RestoreTestState_1: RestoreTestState | None = Field(None, alias='RestoreTestState')
    RestoreTestTrigger_1: RestoreTestTrigger | None = Field(
        None, alias='RestoreTestTrigger'
    )
    ReviewState_1: ReviewState | None = Field(None, alias='ReviewState')
    SearchDegraded: SearchDegraded1 | None = Field(
        None,
        description='Warum nur Wortsuche lief. null bei mode = hybrid oder ohne Wörter',
        title='SearchDegraded',
    )
    SearchHit: SearchHitSlide | SearchHitTranscript | None = Field(
        None,
        description='Treffer, unterschieden über kind (anyOf statt oneOf, damit Zod einen typisierten Union erzeugt; kind schließt sich gegenseitig aus)',
        title='SearchHit',
    )
    SearchHitSlide_1: SearchHitSlide | None = Field(None, alias='SearchHitSlide')
    SearchHitTranscript_1: SearchHitTranscript | None = Field(
        None, alias='SearchHitTranscript'
    )
    SearchIndexPayload_1: SearchIndexPayload | None = Field(
        None, alias='SearchIndexPayload'
    )
    SearchIndexResult_1: SearchIndexResult | None = Field(
        None, alias='SearchIndexResult'
    )
    SearchIndexScope_1: SearchIndexScope | None = Field(None, alias='SearchIndexScope')
    SearchKind_1: SearchKind | None = Field(None, alias='SearchKind')
    SearchModuleRef_1: SearchModuleRef | None = Field(None, alias='SearchModuleRef')
    SearchResponse_1: SearchResponse | None = Field(None, alias='SearchResponse')
    SearchSnippetPart_1: SearchSnippetPart | None = Field(
        None, alias='SearchSnippetPart'
    )
    Semester_1: Semester | None = Field(None, alias='Semester')
    SemesterCreate_1: SemesterCreate | None = Field(None, alias='SemesterCreate')
    SemesterList_1: SemesterList | None = Field(None, alias='SemesterList')
    SemesterUpdate_1: SemesterUpdate | None = Field(None, alias='SemesterUpdate')
    Session_1: Session | None = Field(None, alias='Session')
    SessionConceptItem_1: SessionConceptItem | None = Field(
        None, alias='SessionConceptItem'
    )
    SessionConcepts_1: SessionConcepts | None = Field(None, alias='SessionConcepts')
    SessionCreate_1: SessionCreate | None = Field(None, alias='SessionCreate')
    SessionExtendRequest_1: SessionExtendRequest | None = Field(
        None, alias='SessionExtendRequest'
    )
    SessionList_1: SessionList | None = Field(None, alias='SessionList')
    SessionMs: StrictInt | None = Field(
        None,
        description='Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.',
        ge=0,
        title='SessionMs',
    )
    SessionPauseOp_1: SessionPauseOp | None = Field(None, alias='SessionPauseOp')
    SessionProcessing: dict[str, JobState] | None = None
    SessionRef_1: SessionRef | None = Field(None, alias='SessionRef')
    SessionRefData_1: SessionRefData | None = Field(None, alias='SessionRefData')
    SessionReprocessRequest_1: SessionReprocessRequest | None = Field(
        None, alias='SessionReprocessRequest'
    )
    SessionReprocessResult_1: SessionReprocessResult | None = Field(
        None, alias='SessionReprocessResult'
    )
    SessionResumeOp_1: SessionResumeOp | None = Field(None, alias='SessionResumeOp')
    SessionSnapshot_1: SessionSnapshot | None = Field(None, alias='SessionSnapshot')
    SessionStartData_1: SessionStartData | None = Field(None, alias='SessionStartData')
    SessionStartOffset_1: SessionStartOffset | None = Field(
        None, alias='SessionStartOffset'
    )
    SessionStartOp_1: SessionStartOp | None = Field(None, alias='SessionStartOp')
    SessionStartRequest_1: SessionStartRequest | None = Field(
        None, alias='SessionStartRequest'
    )
    SessionStartResult_1: SessionStartResult | None = Field(
        None, alias='SessionStartResult'
    )
    SessionState_1: SessionState | None = Field(None, alias='SessionState')
    SessionStopData_1: SessionStopData | None = Field(None, alias='SessionStopData')
    SessionStopOp_1: SessionStopOp | None = Field(None, alias='SessionStopOp')
    SessionStopRequest_1: SessionStopRequest | None = Field(
        None, alias='SessionStopRequest'
    )
    SessionStreamId: StrictStr | None = Field(
        None,
        pattern='^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='SessionStreamId',
    )
    SessionSummary_1: SessionSummary | None = Field(None, alias='SessionSummary')
    SessionSummaryView_1: SessionSummaryView | None = Field(
        None, alias='SessionSummaryView'
    )
    SessionTranscript_1: SessionTranscript | None = Field(
        None, alias='SessionTranscript'
    )
    SessionUpdate_1: SessionUpdate | None = Field(None, alias='SessionUpdate')
    Settings_1: Settings | None = Field(None, alias='Settings')
    SettingsUpdate_1: SettingsUpdate | None = Field(None, alias='SettingsUpdate')
    Sha256: StrictStr | None = Field(
        None,
        description='SHA-256, hex, Kleinbuchstaben',
        pattern='^[a-f0-9]{64}$',
        title='Sha256',
    )
    ShapeElement_1: ShapeElement | None = Field(None, alias='ShapeElement')
    ShapeElementPayload_1: ShapeElementPayload | None = Field(
        None, alias='ShapeElementPayload'
    )
    ShapeKind_1: ShapeKind | None = Field(None, alias='ShapeKind')
    Slide_1: Slide | None = Field(None, alias='Slide')
    SlideChangeData_1: SlideChangeData | None = Field(None, alias='SlideChangeData')
    SlideChangeOp_1: SlideChangeOp | None = Field(None, alias='SlideChangeOp')
    SlideDeck_1: SlideDeck | None = Field(None, alias='SlideDeck')
    SlideDeckDetail_1: SlideDeckDetail | None = Field(None, alias='SlideDeckDetail')
    SlideDeckList_1: SlideDeckList | None = Field(None, alias='SlideDeckList')
    SlideDeckUpdate_1: SlideDeckUpdate | None = Field(None, alias='SlideDeckUpdate')
    SlideEvent_1: SlideEvent | None = Field(None, alias='SlideEvent')
    SlideEventSource_1: SlideEventSource | None = Field(None, alias='SlideEventSource')
    SlideSegment_1: SlideSegment | None = Field(None, alias='SlideSegment')
    SlideSegmentSource_1: SlideSegmentSource | None = Field(
        None, alias='SlideSegmentSource'
    )
    StampElement_1: StampElement | None = Field(None, alias='StampElement')
    StampElementPayload_1: StampElementPayload | None = Field(
        None, alias='StampElementPayload'
    )
    StopReason_1: StopReason | None = Field(None, alias='StopReason')
    Stroke_1: Stroke | None = Field(None, alias='Stroke')
    StrokeAddData_1: StrokeAddData | None = Field(None, alias='StrokeAddData')
    StrokeAddOp_1: StrokeAddOp | None = Field(None, alias='StrokeAddOp')
    StrokeLayer_1: StrokeLayer | None = Field(None, alias='StrokeLayer')
    StrokeRemoveData_1: StrokeRemoveData | None = Field(None, alias='StrokeRemoveData')
    StrokeRemoveOp_1: StrokeRemoveOp | None = Field(None, alias='StrokeRemoveOp')
    StrokeTool_1: StrokeTool | None = Field(None, alias='StrokeTool')
    SummaryOutlineItem_1: SummaryOutlineItem | None = Field(
        None, alias='SummaryOutlineItem'
    )
    SummarySentence_1: SummarySentence | None = Field(None, alias='SummarySentence')
    SummaryWritePayload_1: SummaryWritePayload | None = Field(
        None, alias='SummaryWritePayload'
    )
    SummaryWriteResult_1: SummaryWriteResult | None = Field(
        None, alias='SummaryWriteResult'
    )
    SyncAck_1: SyncAck | None = Field(None, alias='SyncAck')
    SyncClientKind_1: SyncClientKind | None = Field(None, alias='SyncClientKind')
    SyncClientMessage: (
        SyncHello
        | SyncSubscribe
        | SyncUnsubscribe
        | SyncTimePing
        | SyncTimeOffset
        | SyncPing
        | SyncPresence
        | NotebookCreateOp
        | PageCreateOp
        | PageUpdateOp
        | PageDeleteOp
        | NotebookUpdateOp
        | NotebookDeleteOp
        | NotebookRestoreOp
        | PageRestoreOp
        | StrokeAddOp
        | StrokeRemoveOp
        | ElementUpsertOp
        | ElementRemoveOp
        | DrawingSnapshotOp
        | SessionStartOp
        | SessionPauseOp
        | SessionResumeOp
        | SessionStopOp
        | SlideChangeOp
        | MarkerAddOp
        | MarkerRemoveOp
        | PhotoAddOp
        | None
    ) = Field(None, description='Alle Nachrichten Client → Server', title='SyncClientMessage')
    SyncConnectionEvent_1: SyncConnectionEvent | None = Field(
        None, alias='SyncConnectionEvent'
    )
    SyncConnectionInfo_1: SyncConnectionInfo | None = Field(
        None, alias='SyncConnectionInfo'
    )
    SyncError_1: SyncError | None = Field(None, alias='SyncError')
    SyncErrorCode_1: SyncErrorCode | None = Field(None, alias='SyncErrorCode')
    SyncEvent: (
        SyncSessionUpdatedEvent
        | SyncPresenceEvent
        | SyncConnectionEvent
        | SyncPairingEvent
        | None
    ) = Field(None, description='Server-Ereignisse (08 §2.4) an alle verbundenen Clients, ohne seq, nicht nachgeliefert', title='SyncEvent')
    SyncHello_1: SyncHello | None = Field(None, alias='SyncHello')
    SyncOp: (
        NotebookCreateOp
        | PageCreateOp
        | PageUpdateOp
        | PageDeleteOp
        | NotebookUpdateOp
        | NotebookDeleteOp
        | NotebookRestoreOp
        | PageRestoreOp
        | StrokeAddOp
        | StrokeRemoveOp
        | ElementUpsertOp
        | ElementRemoveOp
        | DrawingSnapshotOp
        | SessionStartOp
        | SessionPauseOp
        | SessionResumeOp
        | SessionStopOp
        | SlideChangeOp
        | MarkerAddOp
        | MarkerRemoveOp
        | PhotoAddOp
        | None
    ) = Field(None, description='Operation (08 §2.3), unterschieden über kind. Client → Server ohne seq/origin, Server → Client mit seq und origin.', title='SyncOp')
    SyncOrigin_1: SyncOrigin | None = Field(None, alias='SyncOrigin')
    SyncPairingEvent_1: SyncPairingEvent | None = Field(None, alias='SyncPairingEvent')
    SyncPing_1: SyncPing | None = Field(None, alias='SyncPing')
    SyncPong_1: SyncPong | None = Field(None, alias='SyncPong')
    SyncPresence_1: SyncPresence | None = Field(None, alias='SyncPresence')
    SyncPresenceEvent_1: SyncPresenceEvent | None = Field(
        None, alias='SyncPresenceEvent'
    )
    SyncPresenceInfo_1: SyncPresenceInfo | None = Field(None, alias='SyncPresenceInfo')
    SyncResume_1: SyncResume | None = Field(None, alias='SyncResume')
    SyncServerMessage: (
        SyncWelcome
        | SyncSubscribed
        | SyncAck
        | SyncTimePong
        | SyncPong
        | SyncError
        | NotebookCreateOp
        | PageCreateOp
        | PageUpdateOp
        | PageDeleteOp
        | NotebookUpdateOp
        | NotebookDeleteOp
        | NotebookRestoreOp
        | PageRestoreOp
        | StrokeAddOp
        | StrokeRemoveOp
        | ElementUpsertOp
        | ElementRemoveOp
        | DrawingSnapshotOp
        | SessionStartOp
        | SessionPauseOp
        | SessionResumeOp
        | SessionStopOp
        | SlideChangeOp
        | MarkerAddOp
        | MarkerRemoveOp
        | PhotoAddOp
        | SyncSessionUpdatedEvent
        | SyncPresenceEvent
        | SyncConnectionEvent
        | SyncPairingEvent
        | None
    ) = Field(None, description='Alle Nachrichten Server → Client', title='SyncServerMessage')
    SyncSessionUpdatedEvent_1: SyncSessionUpdatedEvent | None = Field(
        None, alias='SyncSessionUpdatedEvent'
    )
    SyncStreamId: StrictStr | None = Field(
        None,
        description='Strom (08 §2.2): notebook:<id>, session:<id> oder user',
        pattern='^((notebook|session):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|user)$',
        title='SyncStreamId',
    )
    SyncStreamPosition_1: SyncStreamPosition | None = Field(
        None, alias='SyncStreamPosition'
    )
    SyncSubscribe_1: SyncSubscribe | None = Field(None, alias='SyncSubscribe')
    SyncSubscribed_1: SyncSubscribed | None = Field(None, alias='SyncSubscribed')
    SyncTimeOffset_1: SyncTimeOffset | None = Field(None, alias='SyncTimeOffset')
    SyncTimePing_1: SyncTimePing | None = Field(None, alias='SyncTimePing')
    SyncTimePong_1: SyncTimePong | None = Field(None, alias='SyncTimePong')
    SyncUnsubscribe_1: SyncUnsubscribe | None = Field(None, alias='SyncUnsubscribe')
    SyncWelcome_1: SyncWelcome | None = Field(None, alias='SyncWelcome')
    TapeElement_1: TapeElement | None = Field(None, alias='TapeElement')
    TapeElementPayload_1: TapeElementPayload | None = Field(
        None, alias='TapeElementPayload'
    )
    Task_1: Task | None = Field(None, alias='Task')
    TextBlock_1: TextBlock | None = Field(None, alias='TextBlock')
    TextElement_1: TextElement | None = Field(None, alias='TextElement')
    TextElementPayload_1: TextElementPayload | None = Field(
        None, alias='TextElementPayload'
    )
    TextSize_1: TextSize | None = Field(None, alias='TextSize')
    Timestamp: AwareDatetime | None = Field(
        None, description='ISO 8601, UTC', title='Timestamp'
    )
    ToolbarSide_1: ToolbarSide | None = Field(None, alias='ToolbarSide')
    TranscribeOutcome_1: TranscribeOutcome | None = Field(
        None, alias='TranscribeOutcome'
    )
    TranscribePayload_1: TranscribePayload | None = Field(
        None, alias='TranscribePayload'
    )
    TranscribeRecordingResult_1: TranscribeRecordingResult | None = Field(
        None, alias='TranscribeRecordingResult'
    )
    TranscribeResult_1: TranscribeResult | None = Field(None, alias='TranscribeResult')
    TranscriptInfo_1: TranscriptInfo | None = Field(None, alias='TranscriptInfo')
    TranscriptLine_1: TranscriptLine | None = Field(None, alias='TranscriptLine')
    TranscriptProvider_1: TranscriptProvider | None = Field(
        None, alias='TranscriptProvider'
    )
    TranscriptWord_1: TranscriptWord | None = Field(None, alias='TranscriptWord')
    Transform: list[StrictFloat] | None = Field(
        None,
        description="Affine Transformation [a, b, c, d, e, f] (CGAffineTransform): x' = a·x + c·y + e, y' = b·x + d·y + f",
        max_length=6,
        min_length=6,
        title='Transform',
    )
    TrashItem_1: TrashItem | None = Field(None, alias='TrashItem')
    TrashKind_1: TrashKind | None = Field(None, alias='TrashKind')
    TrashList_1: TrashList | None = Field(None, alias='TrashList')
    TrashParent_1: TrashParent | None = Field(None, alias='TrashParent')
    TrashRestoreResult_1: TrashRestoreResult | None = Field(
        None, alias='TrashRestoreResult'
    )
    UploadResult_1: UploadResult | None = Field(None, alias='UploadResult')
    Uuid: StrictStr | None = Field(
        None,
        description='UUIDv7 (03 §1), Kleinbuchstaben',
        pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        title='Uuid',
    )
    WorkerHealth_1: WorkerHealth | None = Field(None, alias='WorkerHealth')
    WorkerLlmStatus_1: WorkerLlmStatus | None = Field(None, alias='WorkerLlmStatus')


# Union-Typen (für Validierung: pydantic.TypeAdapter(<Typ>))
type EvidenceRef = EvidenceRefSlide | EvidenceRefTranscript
type InboxPayload = InboxPayloadConceptNew | InboxPayloadConceptMerge | InboxPayloadRelation
type PageElement = TextElement | ImageElement | ShapeElement | TapeElement | StampElement
type PdfIngestPayload = PdfIngestDeckPayload | PdfIngestSheetPayload
type SearchHit = SearchHitSlide | SearchHitTranscript
type SyncClientMessage = SyncHello | SyncSubscribe | SyncUnsubscribe | SyncTimePing | SyncTimeOffset | SyncPing | SyncPresence | SyncOp
type SyncEvent = SyncSessionUpdatedEvent | SyncPresenceEvent | SyncConnectionEvent | SyncPairingEvent
type SyncOp = NotebookCreateOp | PageCreateOp | PageUpdateOp | PageDeleteOp | NotebookUpdateOp | NotebookDeleteOp | NotebookRestoreOp | PageRestoreOp | StrokeAddOp | StrokeRemoveOp | ElementUpsertOp | ElementRemoveOp | DrawingSnapshotOp | SessionStartOp | SessionPauseOp | SessionResumeOp | SessionStopOp | SlideChangeOp | MarkerAddOp | MarkerRemoveOp | PhotoAddOp
type SyncServerMessage = SyncWelcome | SyncSubscribed | SyncAck | SyncOp | SyncTimePong | SyncPong | SyncError | SyncEvent
