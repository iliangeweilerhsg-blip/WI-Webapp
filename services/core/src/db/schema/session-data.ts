// Session-Daten (03 §5, VERTRAEGE §6.1): Folienwechsel, Marker, Fotos, Aufnahmen, Audio-Chunks.
// Verweise über Stromgrenzen (slide_id, page_id) bleiben ohne Fremdschlüssel (VERTRAEGE §6).
// Die IDs vergeben die Clients (event_id, marker_id, photo_id, recording_id), darum idempotent über den Primärschlüssel.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { MarkerPosition } from '@sg/shared';
import { baseColumns, timestamptz } from './common.ts';
import { session } from './organisation.ts';

/** int8 als JS-Zahl (Sitzungszeiten und Größen bleiben weit unter 2^53) */
const int8 = (name: string) => bigint(name, { mode: 'number' });

/** Folienwechsel (03 §5). `id` = `event_id` aus `slide.change` */
export const slideEvent = pgTable(
  'slide_event',
  {
    ...baseColumns(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    slideId: uuid('slide_id'), // NULL im folienlosen Modus. Kein FK (Stromgrenze)
    slideIndex: integer('slide_index').notNull(), // 1-basiert
    tMs: int8('t_ms').notNull(),
    device: text('device').notNull(), // mac | ipad
    source: text('source').notNull(), // manuell_mac | manuell_ipad | korrektur
  },
  (t) => [
    index('slide_event_session_idx').on(t.sessionId, t.tMs),
    check('slide_event_index_chk', sql`${t.slideIndex} >= 1`),
    check('slide_event_t_ms_chk', sql`${t.tMs} >= 0`),
    check('slide_event_device_chk', sql`${t.device} IN ('mac','ipad')`),
    check('slide_event_source_chk', sql`${t.source} IN ('manuell_mac','manuell_ipad','korrektur')`),
  ],
);

/** Marker (03 §5). `id` = `marker_id` */
export const marker = pgTable(
  'marker',
  {
    ...baseColumns(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // frage | klausur | verknuepfung
    tMs: int8('t_ms').notNull(),
    pageId: uuid('page_id'), // Kein FK (Stromgrenze notebook ↔ session)
    position: jsonb('position').$type<MarkerPosition>(),
    source: text('source').notNull(), // ipad | mac | detektor
    note: text('note'),
    resolvedAt: timestamptz('resolved_at'),
  },
  (t) => [
    index('marker_session_idx').on(t.sessionId),
    check('marker_kind_chk', sql`${t.kind} IN ('frage','klausur','verknuepfung')`),
    check('marker_t_ms_chk', sql`${t.tMs} >= 0`),
    check('marker_source_chk', sql`${t.source} IN ('ipad','mac','detektor')`),
  ],
);

/** Tafel-Foto (03 §5, VERTRAEGE §6.1). `id` = `photo_id`. `file_path` erst nach `PUT /photos/{id}/file` */
export const photo = pgTable(
  'photo',
  {
    ...baseColumns(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    tMs: int8('t_ms').notNull(),
    pageId: uuid('page_id'), // Kein FK (Stromgrenze)
    filePath: text('file_path'), // relativ zu SG_DATA_DIR, NULL bis die Datei da ist
    ocrText: text('ocr_text'),
    mime: text('mime').notNull(), // image/heic | image/jpeg
    sha256: text('sha256').notNull(),
    sizeBytes: int8('size_bytes').notNull(),
  },
  (t) => [
    index('photo_session_idx').on(t.sessionId),
    check('photo_t_ms_chk', sql`${t.tMs} >= 0`),
    check('photo_mime_chk', sql`${t.mime} IN ('image/heic','image/jpeg')`),
    check('photo_size_chk', sql`${t.sizeBytes} >= 1`),
  ],
);

/** Aufnahme = ein MediaRecorder-Strom (03 §5, VERTRAEGE §10.1) */
export const recording = pgTable(
  'recording',
  {
    ...baseColumns(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    mime: text('mime').notNull(),
    codec: text('codec').notNull(), // opus | aac
    startedMs: int8('started_ms').notNull(),
    durationMs: int8('duration_ms'), // Länge von full.m4a, gesetzt von audio.finalize
    state: text('state').notNull().default('laeuft'), // laeuft | vollstaendig | mit_luecken
    chunksIndependent: boolean('chunks_independent').notNull().default(false),
    completedAt: timestamptz('completed_at'), // POST /recordings/{id}/complete
    /** `last_seq` aus `RecordingComplete`. audio.finalize erkennt daran fehlende Chunks am Ende (VERTRAEGE §10.2) */
    completedLastSeq: integer('completed_last_seq'),
    /** `duration_ms` aus `RecordingComplete` (Angabe des Clients) */
    completedDurationMs: int8('completed_duration_ms'),
  },
  (t) => [
    index('recording_session_idx').on(t.sessionId),
    check('recording_codec_chk', sql`${t.codec} IN ('opus','aac')`),
    check('recording_state_chk', sql`${t.state} IN ('laeuft','vollstaendig','mit_luecken')`),
    check('recording_started_ms_chk', sql`${t.startedMs} >= 0`),
    check(
      'recording_completed_last_seq_chk',
      sql`${t.completedLastSeq} IS NULL OR ${t.completedLastSeq} >= 0`,
    ),
  ],
);

/** Audio-Chunk (03 §5). `seq` pro Aufnahme lückenlos ab 0 (Invariante 2) */
export const audioChunk = pgTable(
  'audio_chunk',
  {
    ...baseColumns(),
    recordingId: uuid('recording_id')
      .notNull()
      .references(() => recording.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    startMs: int8('start_ms').notNull(),
    durationMs: int8('duration_ms').notNull(),
    filePath: text('file_path').notNull(), // relativ zu SG_DATA_DIR (VERTRAEGE §4)
    sha256: text('sha256').notNull(),
    sizeBytes: int8('size_bytes').notNull(),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
  },
  (t) => [
    unique('audio_chunk_recording_seq_uq').on(t.recordingId, t.seq),
    check('audio_chunk_seq_chk', sql`${t.seq} >= 0`),
    check('audio_chunk_start_ms_chk', sql`${t.startMs} >= 0`),
    check('audio_chunk_duration_chk', sql`${t.durationMs} >= 1`),
    check('audio_chunk_size_chk', sql`${t.sizeBytes} >= 1`),
  ],
);
