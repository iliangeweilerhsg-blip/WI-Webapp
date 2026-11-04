/* GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen */

/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Appearance".
 */
export type Appearance = ("hell" | "dunkel" | "system")
/**
 * UUIDv7 (03 §1), Kleinbuchstaben
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Uuid".
 */
export type Uuid = string
/**
 * Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionMs".
 */
export type SessionMs = number
/**
 * SHA-256, hex, Kleinbuchstaben
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Sha256".
 */
export type Sha256 = string
/**
 * ISO 8601, UTC
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Timestamp".
 */
export type Timestamp = string
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AudioCodec".
 */
export type AudioCodec = ("opus" | "aac")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "RecordingState".
 */
export type RecordingState = ("laeuft" | "vollstaendig" | "mit_luecken")
/**
 * fehlender_chunk: seq fehlt. zeitluecke: start_ms springt (z. B. Recorder neu gestartet)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AudioGapReason".
 */
export type AudioGapReason = ("fehlender_chunk" | "zeitluecke")
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
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "BackupState".
 */
export type BackupState = ("laeuft" | "fertig" | "fehler")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "BackupTrigger".
 */
export type BackupTrigger = ("zeitplan" | "manuell" | "vor_migration")
/**
 * auto: Modul und Art hat der Abgleich gesetzt und darf sie ändern. manuell: vom Nutzer gesetzt, der Abgleich ändert module_id und kind nie mehr (F-KAL-02).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarAssignment".
 */
export type CalendarAssignment = ("auto" | "manuell")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarEventKind".
 */
export type CalendarEventKind = ("vorlesung" | "uebung" | "tutorium" | "pruefung" | "fest" | "lernblock_export")
/**
 * serie: alle Termine derselben Quelle mit gleicher external_uid (F-KAL-02). einzeln: nur dieser Termin.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarUpdateScope".
 */
export type CalendarUpdateScope = ("serie" | "einzeln")
/**
 * google erst ab Phase 4 (F-KAL-03)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarSourceKind".
 */
export type CalendarSourceKind = ("ics_file" | "ics_url" | "google")
/**
 * Gerät, auf dem ein Ereignis entstanden ist
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ClientDevice".
 */
export type ClientDevice = ("mac" | "ipad")
/**
 * Spaltenbreiten Folie | Übung | Notizen in Prozent, Summe 100
 * 
 * @minItems 3
 * @maxItems 3
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ColumnWidths".
 */
export type ColumnWidths = number[]
/**
 * Layout-Vorlagen F-DSH-01
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "DashboardLayout".
 */
export type DashboardLayout = ("standard" | "folie_gross" | "notizen_gross" | "fokus")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "DeviceKind".
 */
export type DeviceKind = ("ipad" | "iphone")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookStreamId".
 */
export type NotebookStreamId = string
/**
 * Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "EpochMs".
 */
export type EpochMs = number
/**
 * Wer die Operation erzeugt hat (vom Server gesetzt)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncOrigin".
 */
export type SyncOrigin = ("ipad" | "web" | "server")
/**
 * Seitenelement (08 §4.4), unterschieden über kind. frame [x, y, w, h] in pt. crop bei image: [x, y, w, h] relativ zum Bild (0–1), null = ganzes Bild. Phase 1 nutzt image (Tafel-Foto) und stamp (Marker-Stempel).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageElement".
 */
export type PageElement = (TextElement | ImageElement | ShapeElement | TapeElement | StampElement)
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TextSize".
 */
export type TextSize = ("s" | "m" | "l")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ShapeKind".
 */
export type ShapeKind = ("rectangle" | "ellipse" | "line" | "arrow" | "triangle" | "diamond")
/**
 * [x, y] in pt
 * 
 * @minItems 2
 * @maxItems 2
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Point2".
 */
export type Point2 = number[]
/**
 * RGBA als #RRGGBBAA
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "HexColor".
 */
export type HexColor = string
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MarkerKind".
 */
export type MarkerKind = ("frage" | "klausur" | "verknuepfung")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "IngestState".
 */
export type IngestState = ("neu" | "verarbeitet" | "fehler")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Lang".
 */
export type Lang = ("de" | "en" | "mixed")
/**
 * Schreibmodus F-INK-03
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InkMode".
 */
export type InkMode = ("freie_seite" | "auf_folie")
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
 * Händigkeit: Seite der Werkzeugleiste auf dem iPad
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ToolbarSide".
 */
export type ToolbarSide = ("links" | "rechts")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MarkerSource".
 */
export type MarkerSource = ("ipad" | "mac" | "detektor")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStreamId".
 */
export type SessionStreamId = string
/**
 * Token aus der festen Palette mit 12 Tönen (07 §8), Werte in packages/ui-tokens
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ModuleColor".
 */
export type ModuleColor = ("mod-01" | "mod-02" | "mod-03" | "mod-04" | "mod-05" | "mod-06" | "mod-07" | "mod-08" | "mod-09" | "mod-10" | "mod-11" | "mod-12")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookKind".
 */
export type NotebookKind = ("vorlesung" | "uebung" | "frei")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageTemplate".
 */
export type PageTemplate = ("blanko" | "liniert" | "kariert" | "punktraster" | "cornell" | "folie")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StrokeTool".
 */
export type StrokeTool = ("pen" | "pencil" | "marker" | "monoline" | "fountain")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StrokeLayer".
 */
export type StrokeLayer = ("ink" | "highlight")
/**
 * Affine Transformation [a, b, c, d, e, f] (CGAffineTransform): x' = a·x + c·y + e, y' = b·x + d·y + f
 * 
 * @minItems 6
 * @maxItems 6
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Transform".
 */
export type Transform = number[]
/**
 * pdf.ingest: entweder ein Foliensatz oder ein Übungsblatt (genau eine ID). Ergänzung zu 08 §5: Übungsblätter laufen über denselben Job.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PdfIngestPayload".
 */
export type PdfIngestPayload = (PdfIngestDeckPayload | PdfIngestSheetPayload)
/**
 * system = Einstellung von iPadOS übernehmen
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PencilDoubleTapAction".
 */
export type PencilDoubleTapAction = ("radierer" | "letztes_werkzeug" | "farbpalette" | "system" | "aus")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PencilSqueezeAction".
 */
export type PencilSqueezeAction = ("werkzeugpalette" | "radierer" | "system" | "aus")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PhotoMime".
 */
export type PhotoMime = ("image/heic" | "image/jpeg")
/**
 * Nacharbeitung (F-NAC-05, Phase 2)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ReviewState".
 */
export type ReviewState = ("offen" | "in_arbeit" | "erledigt")
/**
 * Zustandsautomat F-SES-01, Übergänge in docs/VERTRAEGE.md
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionState".
 */
export type SessionState = ("geplant" | "bereit" | "laeuft" | "pausiert" | "beendet" | "verpasst" | "verarbeitet")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StopReason".
 */
export type StopReason = ("manuell" | "kalenderende" | "stille" | "maximaldauer" | "absturz_wiederhergestellt")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideEventSource".
 */
export type SlideEventSource = ("manuell_mac" | "manuell_ipad" | "korrektur")
/**
 * Strom (08 §2.2): notebook:<id>, session:<id> oder user
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncStreamId".
 */
export type SyncStreamId = string
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncClientKind".
 */
export type SyncClientKind = ("ipad" | "web")
/**
 * Alle Nachrichten Client → Server
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncClientMessage".
 */
export type SyncClientMessage = (SyncHello | SyncSubscribe | SyncUnsubscribe | SyncTimePing | SyncTimeOffset | SyncPing | SyncPresence | SyncOp)
/**
 * Operation (08 §2.3), unterschieden über kind. Client → Server ohne seq/origin, Server → Client mit seq und origin.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncOp".
 */
export type SyncOp = (NotebookCreateOp | PageCreateOp | PageUpdateOp | PageDeleteOp | NotebookUpdateOp | NotebookDeleteOp | NotebookRestoreOp | PageRestoreOp | StrokeAddOp | StrokeRemoveOp | ElementUpsertOp | ElementRemoveOp | DrawingSnapshotOp | SessionStartOp | SessionPauseOp | SessionResumeOp | SessionStopOp | SlideChangeOp | MarkerAddOp | MarkerRemoveOp | PhotoAddOp)
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncErrorCode".
 */
export type SyncErrorCode = ("protocol_unsupported" | "hello_required" | "hello_invalid" | "device_token_invalid" | "message_invalid" | "too_many_pending" | "op_id_reused" | "stream_mismatch" | "module_not_found" | "session_not_found" | "session_transition_invalid" | "notebook_not_found" | "notebook_kind_exists" | "page_not_found" | "page_version_conflict" | "op_not_allowed" | "session_superseded" | "internal_error")
/**
 * Server-Ereignisse (08 §2.4) an alle verbundenen Clients, ohne seq, nicht nachgeliefert
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncEvent".
 */
export type SyncEvent = (SyncSessionUpdatedEvent | SyncPresenceEvent | SyncConnectionEvent | SyncPairingEvent)
/**
 * Alle Nachrichten Server → Client
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncServerMessage".
 */
export type SyncServerMessage = (SyncWelcome | SyncSubscribed | SyncAck | SyncOp | SyncTimePong | SyncPong | SyncError | SyncEvent)
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TrashKind".
 */
export type TrashKind = ("semester" | "module" | "slide_deck" | "exercise_sheet" | "calendar_source" | "session" | "notebook" | "page" | "marker" | "photo")

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
 * Antwort auf PUT /recordings/{id}/chunks/{seq}
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AudioChunk".
 */
export interface AudioChunk {
recording_id: Uuid
seq: number
start_ms: SessionMs
duration_ms: number
sha256: Sha256
size_bytes: number
received_at: Timestamp
/**
 * true: identischer Chunk lag schon vor (200 statt 201)
 */
duplicate: boolean
}
/**
 * Geparste Metadaten von PUT /recordings/{id}/chunks/{seq}: Header X-Start-Ms, X-Duration-Ms (Dezimalzahlen), X-Sha256 (hex des Bodys)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AudioChunkMeta".
 */
export interface AudioChunkMeta {
/**
 * Pfad {seq}, 0-basiert, lückenlos (Invariante 2)
 */
seq: number
start_ms: SessionMs
duration_ms: number
sha256: Sha256
}
/**
 * audio.finalize (08 §5)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AudioFinalizePayload".
 */
export interface AudioFinalizePayload {
recording_id: Uuid
}
/**
 * job.result von audio.finalize. state ist nie laeuft
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AudioFinalizeResult".
 */
export interface AudioFinalizeResult {
recording_id: Uuid
state: RecordingState
/**
 * Länge von full.m4a
 */
audio_duration_ms: number
chunk_count: number
missing_seqs: number[]
gaps: AudioGap[]
file_size_bytes: number
/**
 * Laufzeit des Jobs
 */
job_duration_ms: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AudioGap".
 */
export interface AudioGap {
start_ms: SessionMs
duration_ms: number
reason: AudioGapReason
}
/**
 * GET /backups: Status und Läufe, neueste zuerst
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "BackupOverview".
 */
export interface BackupOverview {
status: BackupStatus
items: BackupRun[]
next_cursor: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "BackupStatus".
 */
export interface BackupStatus {
/**
 * null = kein Ziel eingestellt, Backups pausieren
 */
target: (string | null)
last_success_at: (Timestamp | null)
next_run_at: (Timestamp | null)
/**
 * Letztes erfolgreiches Backup älter als 3 Tage (F-DAT-01)
 */
stale: boolean
running: boolean
}
/**
 * Ein Backup-Lauf (03 §13 backup_run)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "BackupRun".
 */
export interface BackupRun {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
started_at: Timestamp
finished_at: (Timestamp | null)
/**
 * Absoluter Pfad des Ziels
 */
target: string
size_bytes: (number | null)
state: BackupState
error: (string | null)
trigger: BackupTrigger
/**
 * Name des Stands für sg restore <stand>, z. B. 20261104T030012Z. null solange er läuft oder bei Fehler
 */
stand: (string | null)
}
/**
 * Termin. session_id ist abgeleitet: die nicht gelöschte Session zu diesem Termin.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarEvent".
 */
export interface CalendarEvent {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
source_id: (Uuid | null)
/**
 * UID aus der Quelle, null bei manuellen Terminen
 */
external_uid: (string | null)
/**
 * Kennung des Vorkommens: ISO 8601 mit Offset der Ortszeit (2026-10-20T10:15:00+02:00) bzw. Datum (2026-11-01) bei ganztägigen Serien. null bei Einzelterminen. Abgleichschlüssel: (source_id, external_uid, recurrence_id)
 */
recurrence_id: (string | null)
module_id: (Uuid | null)
kind: CalendarEventKind
assigned_by: CalendarAssignment
title: string
location: (string | null)
/**
 * DESCRIPTION aus der Quelle. Ergänzung zu 03 §3
 */
description: (string | null)
starts_at: Timestamp
ends_at: Timestamp
/**
 * Ganztägig (VALUE=DATE). starts_at/ends_at sind dann 00:00 UTC des Datums (wie tests/fixtures/ics/08). Ergänzung zu 03 §3
 */
all_day: boolean
cancelled: boolean
session_id: (Uuid | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarEventList".
 */
export interface CalendarEventList {
items: CalendarEvent[]
next_cursor: (string | null)
}
/**
 * PATCH /calendar/events/{id}. Setzt assigned_by=manuell. scope fehlt = serie. Antwort: CalendarEventList mit allen geänderten Terminen.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarEventUpdate".
 */
export interface CalendarEventUpdate {
module_id?: (Uuid | null)
kind?: CalendarEventKind
scope?: CalendarUpdateScope
}
/**
 * Kalenderquelle
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarSource".
 */
export interface CalendarSource {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
kind: CalendarSourceKind
/**
 * Anzeigename. Ergänzung zu 03 §3. Standard: Dateiname bzw. Host der URL
 */
name: string
/**
 * Nur bei ics_url (webcal:// wird als https:// gespeichert)
 */
url: (string | null)
last_synced_at: (Timestamp | null)
/**
 * Fehler des letzten Abgleichs, null nach Erfolg. Ergänzung zu 03 §3
 */
last_error: (string | null)
readonly: boolean
/**
 * Abgeleitet: Termine dieser Quelle (ohne gelöschte)
 */
event_count: number
}
/**
 * JSON-Body von POST /calendar/sources für eine ICS-URL. Eine ICS-Datei kommt stattdessen als multipart (Felder file, name). Antwort: IcsImportResult.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarSourceCreate".
 */
export interface CalendarSourceCreate {
id?: Uuid
/**
 * ICS-URL (Abo, Abgleich alle 6 h und beim Start)
 */
url: string
name?: string
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarSourceList".
 */
export interface CalendarSourceList {
items: CalendarSource[]
next_cursor: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "DataSettings".
 */
export interface DataSettings {
/**
 * Absoluter Pfad, null = keine Backups
 */
backup_target: (string | null)
/**
 * age mit Passphrase (P1). Die Passphrase steht nie in den Einstellungen
 */
backup_encryption: boolean
/**
 * Ortszeit des Macs (Standard 03:00)
 */
backup_time: string
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "DataSettingsUpdate".
 */
export interface DataSettingsUpdate {
/**
 * Absoluter Pfad, null = keine Backups
 */
backup_target?: (string | null)
/**
 * age mit Passphrase (P1). Die Passphrase steht nie in den Einstellungen
 */
backup_encryption?: boolean
/**
 * Ortszeit des Macs (Standard 03:00)
 */
backup_time?: string
}
/**
 * Gekoppeltes Gerät. Das Token selbst gibt die API nie aus (gespeichert nur token_hash).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Device".
 */
export interface Device {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
name: string
kind: DeviceKind
last_seen_at: (Timestamp | null)
clock_offset_ms: (number | null)
app_version: (string | null)
/**
 * Abgeleitet: hat gerade eine Sync-Verbindung
 */
connected: boolean
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "DeviceList".
 */
export interface DeviceList {
items: Device[]
next_cursor: (string | null)
}
/**
 * Datei vorher per PUT /pages/{id}/pkdrawing hochgeladen, nur fürs iPad
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "DrawingSnapshotData".
 */
export interface DrawingSnapshotData {
page_id: Uuid
pkdrawing_ref: FileRef
}
/**
 * Verweis auf eine Datei, die getrennt per HTTP hochgeladen wird (08 §2.3 file_ref / pkdrawing_ref). Der Core prüft sha256 beim Upload.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "FileRef".
 */
export interface FileRef {
sha256: Sha256
mime: string
size_bytes: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "DrawingSnapshotOp".
 */
export interface DrawingSnapshotOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "drawing.snapshot"
at: EpochMs
clock_uncertain: boolean
data: DrawingSnapshotData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ElementRemoveData".
 */
export interface ElementRemoveData {
page_id: Uuid
element_id: Uuid
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ElementRemoveOp".
 */
export interface ElementRemoveOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "element.remove"
at: EpochMs
clock_uncertain: boolean
data: ElementRemoveData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ElementUpsertData".
 */
export interface ElementUpsertData {
page_id: Uuid
element: PageElement
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TextElement".
 */
export interface TextElement {
element_id: Uuid
kind: "text"
frame: BBox
z: number
t_ms: (SessionMs | null)
payload: TextElementPayload
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TextElementPayload".
 */
export interface TextElementPayload {
text: string
size: TextSize
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ImageElement".
 */
export interface ImageElement {
element_id: Uuid
kind: "image"
frame: BBox
z: number
t_ms: (SessionMs | null)
payload: ImageElementPayload
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ImageElementPayload".
 */
export interface ImageElementPayload {
photo_id: Uuid
crop: (BBox | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ShapeElement".
 */
export interface ShapeElement {
element_id: Uuid
kind: "shape"
frame: BBox
z: number
t_ms: (SessionMs | null)
payload: ShapeElementPayload
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ShapeElementPayload".
 */
export interface ShapeElementPayload {
shape: ShapeKind
/**
 * @minItems 2
 */
points: Point2[]
color: HexColor
width: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TapeElement".
 */
export interface TapeElement {
element_id: Uuid
kind: "tape"
frame: BBox
z: number
t_ms: (SessionMs | null)
payload: TapeElementPayload
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TapeElementPayload".
 */
export interface TapeElementPayload {
color: HexColor
covered: boolean
card_id: (Uuid | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StampElement".
 */
export interface StampElement {
element_id: Uuid
kind: "stamp"
frame: BBox
z: number
t_ms: (SessionMs | null)
payload: StampElementPayload
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StampElementPayload".
 */
export interface StampElementPayload {
marker_id: Uuid
marker_kind: MarkerKind
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ElementUpsertOp".
 */
export interface ElementUpsertOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "element.upsert"
at: EpochMs
clock_uncertain: boolean
data: ElementUpsertData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
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
 * Antwort auf PUT /photos/{id}/file und PUT /pages/{id}/pkdrawing
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "FileReceipt".
 */
export interface FileReceipt {
id: Uuid
sha256: Sha256
size_bytes: number
received_at: Timestamp
/**
 * true: dieselbe Datei (gleiches sha256) lag schon vor, nichts geändert
 */
duplicate: boolean
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "GeneralSettings".
 */
export interface GeneralSettings {
/**
 * SG_DATA_DIR, nur lesbar (Änderung über die Umgebung und Neustart)
 */
data_dir: string
content_lang: Lang
appearance: Appearance
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "GeneralSettingsUpdate".
 */
export interface GeneralSettingsUpdate {
content_lang?: Lang
appearance?: Appearance
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
 * Termin in einem Abgleichergebnis (Schlüssel wie tests/fixtures/ics/11-abgleich-erwartung.json)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "IcsEventRef".
 */
export interface IcsEventRef {
event_id: Uuid
external_uid: string
recurrence_id: (string | null)
title: string
starts_at: Timestamp
module_id: (Uuid | null)
kind: CalendarEventKind
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "IcsImportCounts".
 */
export interface IcsImportCounts {
neu: number
geaendert: number
entfallen: number
unveraendert: number
/**
 * In diesem Lauf automatisch einem Modul zugeordnet
 */
zugeordnet: number
/**
 * Nicht abgesagte Termine der Quelle ohne Modul nach dem Lauf
 */
ohne_modul: number
}
/**
 * Antwort auf POST /calendar/sources (201) und POST /calendar/sources/{id}/sync (200). Der Abgleich läuft synchron im Core, nicht als Job.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "IcsImportResult".
 */
export interface IcsImportResult {
source: CalendarSource
counts: IcsImportCounts
neu: IcsEventRef[]
geaendert: IcsEventRef[]
entfallen: IcsEventRef[]
zugeordnet: IcsEventRef[]
module_suggestions: IcsModuleSuggestion[]
warnings: IcsWarning[]
}
/**
 * Vorschlag „neues Modul anlegen?" für unbekannte Titel (F-KAL-02)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "IcsModuleSuggestion".
 */
export interface IcsModuleSuggestion {
/**
 * Vorgeschlagener Modulname, aus dem Titel bereinigt
 */
name: string
kind: CalendarEventKind
event_count: number
/**
 * Je Serie ein Termin. Nach POST /modules: PATCH /calendar/events/{id} mit module_id, scope=serie
 * 
 * @minItems 1
 */
series_event_ids: Uuid[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "IcsWarning".
 */
export interface IcsWarning {
code: string
message: string
external_uid: (string | null)
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
 * via the `definition` "LectureSettings".
 */
export interface LectureSettings {
/**
 * deviceId aus MediaDevices, null = Standardmikrofon
 */
microphone_id: (string | null)
/**
 * Regel 1: Kalenderende + X min … (Standard 10)
 */
auto_stop_after_end_min: number
/**
 * … und X min keine Sprache (Standard 3)
 */
auto_stop_quiet_window_min: number
/**
 * Regel 2: Kalenderende + X min (Standard 30)
 */
auto_stop_hard_after_end_min: number
/**
 * Regel 3: Stille ≥ X min (Standard 15)
 */
auto_stop_silence_min: number
/**
 * Regel 4: Maximaldauer (Standard 240)
 */
auto_stop_max_duration_min: number
/**
 * Hinweis vor dem Stopp (Standard 60)
 */
auto_stop_warning_s: number
/**
 * Verlängerung per Tipp (Standard 15)
 */
auto_stop_extend_min: number
default_layout: DashboardLayout
default_ink_mode: InkMode
toolbar_side: ToolbarSide
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "LectureSettingsUpdate".
 */
export interface LectureSettingsUpdate {
/**
 * deviceId aus MediaDevices, null = Standardmikrofon
 */
microphone_id?: (string | null)
/**
 * Regel 1: Kalenderende + X min … (Standard 10)
 */
auto_stop_after_end_min?: number
/**
 * … und X min keine Sprache (Standard 3)
 */
auto_stop_quiet_window_min?: number
/**
 * Regel 2: Kalenderende + X min (Standard 30)
 */
auto_stop_hard_after_end_min?: number
/**
 * Regel 3: Stille ≥ X min (Standard 15)
 */
auto_stop_silence_min?: number
/**
 * Regel 4: Maximaldauer (Standard 240)
 */
auto_stop_max_duration_min?: number
/**
 * Hinweis vor dem Stopp (Standard 60)
 */
auto_stop_warning_s?: number
/**
 * Verlängerung per Tipp (Standard 15)
 */
auto_stop_extend_min?: number
default_layout?: DashboardLayout
default_ink_mode?: InkMode
toolbar_side?: ToolbarSide
}
/**
 * maintenance.nightly (08 §5, T1-18). Phase 1: Papierkorb leeren, verwaiste Dateien, sync_op gelöschter Ströme
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MaintenanceNightlyPayload".
 */
export interface MaintenanceNightlyPayload {
/**
 * Standard 30 (F-DAT-04)
 */
purge_older_than_days?: number
/**
 * Nur zählen, nichts löschen
 */
dry_run?: boolean
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MaintenanceNightlyResult".
 */
export interface MaintenanceNightlyResult {
purged_count: number
/**
 * Endgültig gelöschte Objekte je Tabelle
 */
purged_by_kind: {
[k: string]: number
}
orphan_files_removed: number
sync_ops_removed: number
job_duration_ms: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Marker".
 */
export interface Marker {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
session_id: Uuid
kind: MarkerKind
t_ms: SessionMs
page_id: (Uuid | null)
position: (MarkerPosition | null)
source: MarkerSource
note: (string | null)
resolved_at: (Timestamp | null)
}
/**
 * Stelle auf der Seite in pt (Ursprung oben links)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MarkerPosition".
 */
export interface MarkerPosition {
x: number
y: number
}
/**
 * Marker vom iPad (F-INK-05) und vom Mac (F-DSH-05, source=mac)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MarkerAddData".
 */
export interface MarkerAddData {
marker_id: Uuid
session_id: Uuid
kind: MarkerKind
t_ms: SessionMs
page_id: (Uuid | null)
position: (MarkerPosition | null)
note: (string | null)
source: ClientDevice
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MarkerAddOp".
 */
export interface MarkerAddOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "marker.add"
at: EpochMs
clock_uncertain: boolean
data: MarkerAddData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * Rückgängig (⌘Z, F-DSH-05) bzw. Löschen
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MarkerRemoveData".
 */
export interface MarkerRemoveData {
marker_id: Uuid
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MarkerRemoveOp".
 */
export interface MarkerRemoveOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "marker.remove"
at: EpochMs
clock_uncertain: boolean
data: MarkerRemoveData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
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
settings: ModuleSettings
}
/**
 * module.settings (W-06 Option A, 03 §3). Fehlender Schlüssel = globaler Standard aus Settings.lecture
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ModuleSettings".
 */
export interface ModuleSettings {
layout?: DashboardLayout
column_widths?: ColumnWidths
ink_mode?: InkMode
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
 * Teil von ModuleUpdate.settings: Schlüssel für Schlüssel zusammenführen, null entfernt den Schlüssel
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ModuleSettingsUpdate".
 */
export interface ModuleSettingsUpdate {
layout?: (DashboardLayout | null)
column_widths?: (ColumnWidths | null)
ink_mode?: (InkMode | null)
}
/**
 * PATCH /modules/{id}. settings wird Schlüssel für Schlüssel zusammengeführt, null entfernt einen Schlüssel (docs/VERTRAEGE.md §14.2)
 * 
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
settings?: ModuleSettingsUpdate
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Notebook".
 */
export interface Notebook {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
module_id: Uuid
title: string
kind: NotebookKind
/**
 * Abgeleitet
 */
page_count: number
}
/**
 * POST /notebooks. kind fehlt = frei
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookCreate".
 */
export interface NotebookCreate {
id?: Uuid
module_id: Uuid
title: string
kind?: NotebookKind
}
/**
 * Freies Notizbuch offline anlegen (F-INK-02, F-INK-14). Strom notebook:<notebook_id>, idempotent über notebook_id.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookCreateData".
 */
export interface NotebookCreateData {
notebook_id: Uuid
module_id: Uuid
title: string
/**
 * Nur frei. Die Notizbücher vorlesung/uebung legt der Core an
 */
kind?: "frei"
created_at: EpochMs
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookCreateOp".
 */
export interface NotebookCreateOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "notebook.create"
at: EpochMs
clock_uncertain: boolean
data: NotebookCreateData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem Papierkorb
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookDeleteOp".
 */
export interface NotebookDeleteOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "notebook.delete"
at: EpochMs
clock_uncertain: boolean
data: NotebookRefData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookRefData".
 */
export interface NotebookRefData {
notebook_id: Uuid
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookList".
 */
export interface NotebookList {
items: Notebook[]
next_cursor: (string | null)
}
/**
 * GET /notebooks/{id}/pages, nach index sortiert, ohne gelöschte Seiten
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookPages".
 */
export interface NotebookPages {
notebook_id: Uuid
/**
 * seq des Stroms notebook:<id> zu diesem Stand
 */
stream_seq: number
/**
 * op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id senden
 */
stream_op_id: (Uuid | null)
items: Page[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Page".
 */
export interface Page {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
notebook_id: Uuid
session_id: (Uuid | null)
/**
 * Reihenfolge im Notizbuch, 1-basiert
 */
index: number
template: PageTemplate
background_slide_id: (Uuid | null)
attached_slide_id: (Uuid | null)
width_pt: number
height_pt: number
version: number
/**
 * Abgeleitet: PencilKit-Sicherung liegt vor (GET /pages/{id}/pkdrawing)
 */
has_pkdrawing: boolean
}
/**
 * Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem Papierkorb
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookRestoreOp".
 */
export interface NotebookRestoreOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "notebook.restore"
at: EpochMs
clock_uncertain: boolean
data: NotebookRefData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * PATCH /notebooks/{id}
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookUpdate".
 */
export interface NotebookUpdate {
title?: string
module_id?: Uuid
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookUpdateData".
 */
export interface NotebookUpdateData {
notebook_id: Uuid
fields: NotebookUpdateFields
}
/**
 * Aktueller Stand der per REST änderbaren Felder
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookUpdateFields".
 */
export interface NotebookUpdateFields {
title: string
module_id: Uuid
}
/**
 * Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem Papierkorb
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookUpdateOp".
 */
export interface NotebookUpdateOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "notebook.update"
at: EpochMs
clock_uncertain: boolean
data: NotebookUpdateData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageCreateData".
 */
export interface PageCreateData {
page_id: Uuid
notebook_id: Uuid
session_id: (Uuid | null)
index: number
template: PageTemplate
width_pt: number
height_pt: number
background_slide_id: (Uuid | null)
attached_slide_id: (Uuid | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageCreateOp".
 */
export interface PageCreateOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "page.create"
at: EpochMs
clock_uncertain: boolean
data: PageCreateData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageDeleteData".
 */
export interface PageDeleteData {
page_id: Uuid
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageDeleteOp".
 */
export interface PageDeleteOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "page.delete"
at: EpochMs
clock_uncertain: boolean
data: PageDeleteData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * GET /pages/{id}: Seite mit Elementen (ohne gelöschte, nach z sortiert)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageDetail".
 */
export interface PageDetail {
page: Page
elements: PageElement[]
stream_seq: number
/**
 * op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id senden
 */
stream_op_id: (Uuid | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageRefData".
 */
export interface PageRefData {
page_id: Uuid
}
/**
 * Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem Papierkorb
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageRestoreOp".
 */
export interface PageRestoreOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "page.restore"
at: EpochMs
clock_uncertain: boolean
data: PageRefData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * GET /pages/{id}/strokes: alle nicht gelöschten Striche, nach created_at sortiert
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageStrokes".
 */
export interface PageStrokes {
page_id: Uuid
/**
 * seq des Stroms notebook:<id> zu diesem Stand
 */
stream_seq: number
/**
 * op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id senden
 */
stream_op_id: (Uuid | null)
strokes: Stroke[]
}
/**
 * Neutrales Strich-Format (08 §4.1/4.2). points sind Rohkoordinaten VOR transform, bbox gilt NACH transform inklusive halber Breite. dt des ersten Punkts ist 0; t_end_ms − t_start_ms entspricht dem letzten dt. t_start_ms/t_end_ms null außerhalb einer Session.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Stroke".
 */
export interface Stroke {
client_id: Uuid
tool: StrokeTool
layer: StrokeLayer
color: HexColor
/**
 * Grundbreite in pt
 */
width: number
created_at: EpochMs
t_start_ms: (SessionMs | null)
t_end_ms: (SessionMs | null)
transform: Transform
bbox: BBox
/**
 * Base64 (ohne Zeilenumbrüche) von n ≥ 1 Punkten à 24 Byte: x, y, dt, force, azimuth, altitude als Float32 little-endian (08 §4.2). 24 Byte = genau 32 Base64-Zeichen, daher nie Padding
 */
points: string
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageUpdateData".
 */
export interface PageUpdateData {
page_id: Uuid
fields: PageUpdateFields
/**
 * Version, auf der die Änderung beruht. Der Core setzt danach version + 1
 */
version: number
}
/**
 * Alle änderbaren Felder der Seite mit ihrem neuen Stand. Kein Teil-Update: im Sync gibt es keine optionalen nullbaren Felder (VERTRAEGE §11.7)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageUpdateFields".
 */
export interface PageUpdateFields {
index: number
template: PageTemplate
session_id: (Uuid | null)
background_slide_id: (Uuid | null)
attached_slide_id: (Uuid | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageUpdateOp".
 */
export interface PageUpdateOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "page.update"
at: EpochMs
clock_uncertain: boolean
data: PageUpdateData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * POST /devices/pair/confirm (aus dem Netz ohne Token erlaubt). Geheimnis ist der Code. public_nonce verknüpft die Bestätigung mit einer eigenen pair/start-Anfrage; gehört sie zu einer abgelehnten Anfrage, wird abgelehnt.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PairConfirmRequest".
 */
export interface PairConfirmRequest {
pairing_id: Uuid
code: string
device_name: string
kind: DeviceKind
public_nonce: string
app_version?: string
}
/**
 * Antwort auf POST /devices/pair/confirm (201)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PairResponse".
 */
export interface PairResponse {
device: Device
/**
 * 256 Bit Zufall, base64url ohne Padding. Wird nur dieses eine Mal ausgegeben
 */
device_token: string
}
/**
 * POST /devices/pair/start (aus dem Netz ohne Token erlaubt). Nur bei offenem Kopplungsfenster; belegt es nicht exklusiv
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PairStartRequest".
 */
export interface PairStartRequest {
device_name: string
kind: DeviceKind
/**
 * Zufallswert des iPads (base64url, ≥ 128 Bit)
 */
public_nonce: string
}
/**
 * pair/start: request_id der eigenen Anfrage und pairing_id des offenen Fensters. Der Code steht NICHT in der Antwort
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PairStartResponse".
 */
export interface PairStartResponse {
request_id: Uuid
pairing_id: Uuid
expires_at: Timestamp
}
/**
 * Offenes Kopplungsfenster für die Anzeige in der Web-App (Antwort von POST /devices/pairings, nur lokal). Anfragen von Geräten liefern das Ereignis pairing.requested und GET /devices/pairings/requests (PairingRequestList)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PairingCode".
 */
export interface PairingCode {
pairing_id: Uuid
code: string
expires_at: Timestamp
/**
 * Adresse des Macs im lokalen Netz (IPv4 der aktiven Schnittstelle), zur Anzeige und für die manuelle Eingabe
 */
host: string
port: number
/**
 * Inhalt des QR-Codes: dieselben Daten wie host, port, pairing_id und code
 */
qr_url: string
}
/**
 * Anfrage eines Geräts über pair/start (Nutzlast des Ereignisses pairing.requested). Die Web-App listet sie und kann sie ablehnen (DELETE /devices/pairings/requests/{request_id}). Gerätenamen sind frei wählbar, die Web-App empfiehlt darum den QR-Weg
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PairingRequest".
 */
export interface PairingRequest {
request_id: Uuid
pairing_id: Uuid
device_name: string
kind: DeviceKind
requested_at: Timestamp
}
/**
 * GET /devices/pairings/requests (nur lokal): offene (nicht abgelehnte) Anfragen des aktuellen Kopplungsfensters, älteste zuerst. Ohne offenes Fenster leer. Höchstens 10, danach antwortet pair/start mit 429 pairing_requests_full
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PairingRequestList".
 */
export interface PairingRequestList {
/**
 * @maxItems 10
 */
items: PairingRequest[]
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
 * via the `definition` "PenSettings".
 */
export interface PenSettings {
double_tap: PencilDoubleTapAction
squeeze: PencilSqueezeAction
/**
 * Formerkennung (F-INK-09, ab Phase 3)
 */
shape_recognition: boolean
/**
 * @maxItems 8
 */
favorite_colors: HexColor[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PenSettingsUpdate".
 */
export interface PenSettingsUpdate {
double_tap?: PencilDoubleTapAction
squeeze?: PencilSqueezeAction
/**
 * Formerkennung (F-INK-09, ab Phase 3)
 */
shape_recognition?: boolean
/**
 * @maxItems 8
 */
favorite_colors?: HexColor[]
}
/**
 * Tafel-Foto (Metadaten). Datei: GET /photos/{id}/file
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Photo".
 */
export interface Photo {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
session_id: Uuid
t_ms: SessionMs
page_id: (Uuid | null)
mime: PhotoMime
sha256: Sha256
size_bytes: number
/**
 * false, bis PUT /photos/{id}/file angekommen ist
 */
has_file: boolean
ocr_text: (string | null)
}
/**
 * Datei per PUT /photos/{photo_id}/file, Reihenfolge egal
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PhotoAddData".
 */
export interface PhotoAddData {
photo_id: Uuid
session_id: Uuid
t_ms: SessionMs
page_id: (Uuid | null)
file_ref: PhotoFileRef
}
/**
 * Datei eines Tafel-Fotos, hochgeladen per PUT /photos/{photo_id}/file
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PhotoFileRef".
 */
export interface PhotoFileRef {
sha256: Sha256
mime: PhotoMime
size_bytes: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PhotoAddOp".
 */
export interface PhotoAddOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "photo.add"
at: EpochMs
clock_uncertain: boolean
data: PhotoAddData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * Eine Aufnahme = ein MediaRecorder-Strom. Nach einem Neuladen beginnt eine neue Aufnahme derselben Session (F-SES-05).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Recording".
 */
export interface Recording {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
session_id: Uuid
mime: string
codec: AudioCodec
started_ms: SessionMs
/**
 * Länge der Gesamtdatei, gesetzt von audio.finalize
 */
duration_ms: (number | null)
state: RecordingState
/**
 * true: jeder Chunk ist eine eigenständige Datei (Recorder je Chunk neu gestartet). false: Chunks ergeben in seq-Reihenfolge einen Bytestrom. Ergänzung, offen bis Spike S4
 */
chunks_independent: boolean
/**
 * Abgeleitet: empfangene Chunks
 */
chunk_count: number
/**
 * Abgeleitet: höchste empfangene seq
 */
last_seq: (number | null)
completed_at: (Timestamp | null)
}
/**
 * POST /recordings/{id}/complete: der Client hat den letzten Chunk hochgeladen. Der Core stellt audio.finalize ein.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "RecordingComplete".
 */
export interface RecordingComplete {
last_seq: number
/**
 * Aufgenommene Länge laut Client
 */
duration_ms: number
}
/**
 * POST /sessions/{id}/recordings
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "RecordingCreate".
 */
export interface RecordingCreate {
id?: Uuid
mime: string
codec: AudioCodec
started_ms: SessionMs
chunks_independent?: boolean
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
 * Durchführung eines Termins. planned_starts_at/planned_ends_at sind abgeleitet aus dem Kalendertermin (null bei spontanen Sessions).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Session".
 */
export interface Session {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
calendar_event_id: (Uuid | null)
module_id: Uuid
slide_deck_id: (Uuid | null)
/**
 * VL-Nummer im Modul (VL 7), Regeln in docs/VERTRAEGE.md
 */
number: (number | null)
title: (string | null)
state: SessionState
started_at: (Timestamp | null)
ended_at: (Timestamp | null)
stop_reason: (StopReason | null)
started_from: (ClientDevice | null)
processing: SessionProcessing
review_state: ReviewState
planned_starts_at: (Timestamp | null)
planned_ends_at: (Timestamp | null)
auto_stop_extended_until: (Timestamp | null)
/**
 * Abweichende Startzeiten von Geräten (VERTRAEGE §9.3). Fehlt oder leer = keine Abweichung
 */
start_offsets?: SessionStartOffset[]
}
/**
 * Fortschritt der Pipeline: Job-Typ → Zustand des letzten Jobs dieses Typs (03 §3 session.processing)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionProcessing".
 */
export interface SessionProcessing {
[k: string]: JobState
}
/**
 * Ein Gerät hat die Session offline mit eigenem started_at begonnen. offset_ms = started_at des Geräts − started_at der Session (ms). Die t_ms der Operationen dieses Geräts bleiben unverändert; Sitzungszeit nach Serveruhr = t_ms + offset_ms (für die Ausrichtung in Phase 2).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStartOffset".
 */
export interface SessionStartOffset {
device_id: Uuid
offset_ms: number
}
/**
 * POST /sessions: spontane Session ohne Termin (F-SES-04). Ergebnis im Zustand bereit, danach /start.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionCreate".
 */
export interface SessionCreate {
id?: Uuid
module_id: Uuid
slide_deck_id?: (Uuid | null)
title?: (string | null)
}
/**
 * POST /sessions/{id}/extend: Auto-Stopp aufschieben (F-SES-03). minutes fehlt = lecture.auto_stop_extend_min
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionExtendRequest".
 */
export interface SessionExtendRequest {
minutes?: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionList".
 */
export interface SessionList {
items: Session[]
next_cursor: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionPauseOp".
 */
export interface SessionPauseOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "session.pause"
at: EpochMs
clock_uncertain: boolean
data: SessionRefData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * session.pause / session.resume
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionRefData".
 */
export interface SessionRefData {
session_id: Uuid
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionResumeOp".
 */
export interface SessionResumeOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "session.resume"
at: EpochMs
clock_uncertain: boolean
data: SessionRefData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * GET /sessions/{id}/snapshot: Live-Stand für Dashboard und iPad (ohne gelöschte Objekte, nach t_ms sortiert)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionSnapshot".
 */
export interface SessionSnapshot {
session: Session
slide_events: SlideEvent[]
markers: Marker[]
photos: Photo[]
recordings: Recording[]
/**
 * seq des Stroms session:<id>, zu der dieser Stand gehört. Danach per Sync ab stream_seq + 1
 */
stream_seq: number
/**
 * op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id senden
 */
stream_op_id: (Uuid | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideEvent".
 */
export interface SlideEvent {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
session_id: Uuid
slide_id: (Uuid | null)
slide_index: number
t_ms: SessionMs
device: ClientDevice
source: SlideEventSource
}
/**
 * Unbekannte session_id: der Core legt die Session an (Start offline auf dem iPad, F-SES-02 Schritt 3)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStartData".
 */
export interface SessionStartData {
session_id: Uuid
module_id: Uuid
calendar_event_id: (Uuid | null)
slide_deck_id: (Uuid | null)
started_from: ClientDevice
started_at: EpochMs
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStartOp".
 */
export interface SessionStartOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "session.start"
at: EpochMs
clock_uncertain: boolean
data: SessionStartData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * POST /sessions/{id}/start. started_at setzt der Core (Serverzeit).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStartRequest".
 */
export interface SessionStartRequest {
started_from: ClientDevice
slide_deck_id?: (Uuid | null)
}
/**
 * ended_session: eine andere Session, die wegen des Starts automatisch beendet wurde (F-SES-02)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStartResult".
 */
export interface SessionStartResult {
session: Session
ended_session: (Session | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStopData".
 */
export interface SessionStopData {
session_id: Uuid
reason?: StopReason
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStopOp".
 */
export interface SessionStopOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "session.stop"
at: EpochMs
clock_uncertain: boolean
data: SessionStopData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * POST /sessions/{id}/stop. reason fehlt = manuell. absturz_wiederhergestellt setzt nur der Core.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStopRequest".
 */
export interface SessionStopRequest {
reason?: StopReason
}
/**
 * PATCH /sessions/{id}
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionUpdate".
 */
export interface SessionUpdate {
title?: (string | null)
slide_deck_id?: (Uuid | null)
}
/**
 * GET /settings: alle Phase-1-Bereiche, fehlende Werte mit Standard aufgefüllt. Geräte stehen unter /devices.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Settings".
 */
export interface Settings {
general: GeneralSettings
lecture: LectureSettings
pen: PenSettings
data: DataSettings
}
/**
 * PATCH /settings: nur die angegebenen Felder ändern sich. Antwort: Settings
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SettingsUpdate".
 */
export interface SettingsUpdate {
general?: GeneralSettingsUpdate
lecture?: LectureSettingsUpdate
pen?: PenSettingsUpdate
data?: DataSettingsUpdate
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
 * via the `definition` "SlideChangeData".
 */
export interface SlideChangeData {
event_id: Uuid
session_id: Uuid
slide_id: (Uuid | null)
slide_index: number
t_ms: SessionMs
device: ClientDevice
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideChangeOp".
 */
export interface SlideChangeOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "slide.change"
at: EpochMs
clock_uncertain: boolean
data: SlideChangeData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
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
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StrokeAddData".
 */
export interface StrokeAddData {
page_id: Uuid
stroke: Stroke
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StrokeAddOp".
 */
export interface StrokeAddOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "stroke.add"
at: EpochMs
clock_uncertain: boolean
data: StrokeAddData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StrokeRemoveData".
 */
export interface StrokeRemoveData {
page_id: Uuid
/**
 * @minItems 1
 */
client_ids: Uuid[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StrokeRemoveOp".
 */
export interface StrokeRemoveOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "stroke.remove"
at: EpochMs
clock_uncertain: boolean
data: StrokeRemoveData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncAck".
 */
export interface SyncAck {
type: "ack"
op_id: Uuid
stream: SyncStreamId
seq: number
}
/**
 * Erste Nachricht des Clients (08 §2.1). Das Gerätetoken steht nicht hier, sondern beim Upgrade im Header Authorization: Bearer (VERTRAEGE §11.1). device_id nur zur Gegenprobe.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncHello".
 */
export interface SyncHello {
type: "hello"
protocol: 1
client: SyncClientKind
device_id?: Uuid
app_version: string
streams: SyncStreamPosition[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncStreamPosition".
 */
export interface SyncStreamPosition {
stream: SyncStreamId
/**
 * Höchste lückenlos empfangene und angewandte seq, 0 = nichts
 */
last_seq: number
/**
 * op_id der Operation mit last_seq, null bei last_seq = 0. Der Server prüft das Paar, sonst reset
 */
last_op_id: (Uuid | null)
}
/**
 * Weitere Ströme abonnieren, ohne neu zu verbinden. Antwort: subscribed. Ergänzung zu 08 §2
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncSubscribe".
 */
export interface SyncSubscribe {
type: "subscribe"
/**
 * @minItems 1
 */
streams: SyncStreamPosition[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncUnsubscribe".
 */
export interface SyncUnsubscribe {
type: "unsubscribe"
/**
 * @minItems 1
 */
streams: SyncStreamId[]
}
/**
 * t0 = lokale Uhr des Clients beim Senden (F-SYN-02)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncTimePing".
 */
export interface SyncTimePing {
type: "time.ping"
t0: EpochMs
}
/**
 * Ergebnis des Uhrabgleichs an den Server (device.clock_offset_ms). Ergänzung zu 08 §2.1
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncTimeOffset".
 */
export interface SyncTimeOffset {
type: "time.offset"
/**
 * Gemessener Versatz Server − Client
 */
offset_ms: number
/**
 * Median der Umlaufzeit
 */
rtt_ms: number
}
/**
 * Keepalive des Clients alle 15 s
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncPing".
 */
export interface SyncPing {
type: "ping"
}
/**
 * Was der Client gerade zeigt (ersetzt den vorigen Stand). Das iPad sendet sie bei jedem Seitenwechsel, die Notizen-Spalte folgt ihr (F-DSH-04). Ergänzung zu 08 §2
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncPresence".
 */
export interface SyncPresence {
type: "presence"
session_id: (Uuid | null)
notebook_id: (Uuid | null)
page_id: (Uuid | null)
}
/**
 * Ein Client hat sich verbunden oder getrennt (iPad-Status, F-DSH-06)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncConnectionEvent".
 */
export interface SyncConnectionEvent {
type: "event"
name: "device.connection"
data: SyncConnectionInfo
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncConnectionInfo".
 */
export interface SyncConnectionInfo {
client: SyncClientKind
device_id: (Uuid | null)
connected: boolean
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncError".
 */
export interface SyncError {
type: "error"
code: SyncErrorCode
message: string
op_id?: Uuid
stream?: SyncStreamId
/**
 * Nur mit op_id: true = Verbindung wird geschlossen, neu verbinden und ab dieser Operation erneut senden. false = endgültig abgelehnt: Operation samt abhängigen in die Fehlerablage (VERTRAEGE §11.2). Ausnahmen: session_superseded (umschreiben) und page_version_conflict (neu laden)
 */
retryable: boolean
/**
 * true: der Server schließt die Verbindung direkt danach und verarbeitet keine weitere Nachricht
 */
fatal: boolean
details?: {
[k: string]: any
}
}
/**
 * Zustand oder Felder einer Session haben sich geändert (auch zeitgesteuert: bereit, verpasst, verarbeitet)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncSessionUpdatedEvent".
 */
export interface SyncSessionUpdatedEvent {
type: "event"
name: "session.updated"
data: Session
}
/**
 * Weitergabe von presence eines anderen Clients
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncPresenceEvent".
 */
export interface SyncPresenceEvent {
type: "event"
name: "presence"
data: SyncPresenceInfo
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncPresenceInfo".
 */
export interface SyncPresenceInfo {
client: SyncClientKind
device_id: (Uuid | null)
device_name: (string | null)
session_id: (Uuid | null)
notebook_id: (Uuid | null)
page_id: (Uuid | null)
}
/**
 * Ein Gerät hat pair/start aufgerufen. Nur an lokale Web-Clients (VERTRAEGE §12)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncPairingEvent".
 */
export interface SyncPairingEvent {
type: "event"
name: "pairing.requested"
data: PairingRequest
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncPong".
 */
export interface SyncPong {
type: "pong"
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncResume".
 */
export interface SyncResume {
stream: SyncStreamId
/**
 * Ab dieser seq sendet der Server die fehlenden Operationen
 */
from_seq: number
/**
 * Aktuell höchste seq des Stroms. Ergänzung zu 08 §2.1
 */
head_seq: number
/**
 * true: der Server kennt die gemeldete Position nicht (last_op_id passt nicht, seq zu hoch, z. B. nach einer Wiederherstellung) und sendet für diesen Strom nichts. Der Client verwirft seine Daten NICHT, sondern gleicht per REST ab, sendet fehlende eigene Daten erneut und abonniert ab stream_seq/stream_op_id (VERTRAEGE §11.1).
 */
reset: boolean
}
/**
 * db_epoch ändert sich bei jeder Wiederherstellung der Datenbank. Weicht sie vom gespeicherten Wert ab, behandelt der Client alle Ströme wie reset (VERTRAEGE §11.1).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncWelcome".
 */
export interface SyncWelcome {
type: "welcome"
protocol: 1
server_time: EpochMs
server_version: string
db_epoch: Uuid
device_id: (Uuid | null)
resume: SyncResume[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncSubscribed".
 */
export interface SyncSubscribed {
type: "subscribed"
resume: SyncResume[]
}
/**
 * ts = Serveruhr beim Antworten. Versatz = Median über 5 Runden von ts − (t0 + t1) / 2
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncTimePong".
 */
export interface SyncTimePong {
type: "time.pong"
t0: EpochMs
ts: EpochMs
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
 * Direkt gelöschtes Objekt im Papierkorb (F-DAT-04). Mitgelöschte Teile erscheinen nicht einzeln.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TrashItem".
 */
export interface TrashItem {
id: Uuid
kind: TrashKind
/**
 * Anzeigename (Titel, Name oder z. B. „Seite 3")
 */
title: string
deleted_at: Timestamp
purge_at: Timestamp
parent: (TrashParent | null)
/**
 * Mitgelöschte abhängige Objekte, die mit wiederhergestellt werden
 */
dependent_count: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TrashParent".
 */
export interface TrashParent {
id: Uuid
kind: TrashKind
title: string
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TrashList".
 */
export interface TrashList {
items: TrashItem[]
next_cursor: (string | null)
}
/**
 * POST /trash/{id}/restore, auch für „Rückgängig" im Toast
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TrashRestoreResult".
 */
export interface TrashRestoreResult {
id: Uuid
kind: TrashKind
restored_count: number
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
