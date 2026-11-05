// Transkript und Folienzuordnung (03 §5, Phase 2, VERTRAEGE §18).
// Schreiber ist der Worker (`transcribe`, `align.log`), der Core liest nur und kaskadiert beim Löschen.
// `slide_id` bleibt ohne Fremdschlüssel (wie `slide_event`, VERTRAEGE §6): Folien werden weich gelöscht,
// Leser filtern über einen Join auf nicht gelöschte `slide`.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { TranscriptWord } from '@sg/shared';
import { baseColumns, embedding } from './common.ts';
import { session } from './organisation.ts';
import { recording } from './session-data.ts';

/** int8 als JS-Zahl (Sitzungszeiten bleiben weit unter 2^53) */
const int8 = (name: string) => bigint(name, { mode: 'number' });

/**
 * Ein Transkript je Aufnahme (VERTRAEGE §18.1). `transcribe` ersetzt es als Ganzes (hartes DELETE, Segmente per
 * Kaskade) und überspringt Aufnahmen mit gleichem `input_hash`. `finalize_job_id` ist der `audio.finalize`-Job,
 * dessen `full.m4a` transkribiert wurde: Ist der neueste fertige Job der Aufnahme ein anderer, ist das Transkript veraltet.
 */
export const transcript = pgTable(
  'transcript',
  {
    ...baseColumns(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    recordingId: uuid('recording_id')
      .notNull()
      .references(() => recording.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').notNull(), // transcribe-Job, der es geschrieben hat. Kein FK (Jobs sind Verlauf)
    finalizeJobId: uuid('finalize_job_id').notNull(), // Quelle von full.m4a. Kein FK
    provider: text('provider').notNull(), // mlx-whisper | fake
    model: text('model').notNull(),
    language: text('language'), // erkannte Sprache (ISO 639-1), NULL = unbekannt
    initialPrompt: text('initial_prompt'), // Vokabular-Hinweis (05 §P4), ≤ 200 Whisper-Tokens (§18.6), Schutzgrenze 2000 Zeichen
    inputHash: text('input_hash').notNull(),
    audioSha256: text('audio_sha256').notNull(),
    audioDurationMs: int8('audio_duration_ms').notNull(),
    segmentCount: integer('segment_count').notNull(),
    wordCount: integer('word_count').notNull(),
  },
  (t) => [
    index('transcript_session_idx').on(t.sessionId),
    unique('transcript_recording_uq').on(t.recordingId),
    // Ziel des zusammengesetzten Fremdschlüssels aus transcript_segment (Abschnitt passt zu Aufnahme und Session)
    unique('transcript_id_recording_session_uq').on(t.id, t.recordingId, t.sessionId),
    check('transcript_provider_chk', sql`${t.provider} IN ('mlx-whisper','fake')`),
    check('transcript_language_chk', sql`${t.language} IS NULL OR ${t.language} ~ '^[a-z]{2,3}$'`),
    check(
      'transcript_initial_prompt_chk',
      sql`${t.initialPrompt} IS NULL OR char_length(${t.initialPrompt}) <= 2000`,
    ),
    check('transcript_input_hash_chk', sql`${t.inputHash} ~ '^[0-9a-f]{64}$'`),
    check('transcript_audio_sha256_chk', sql`${t.audioSha256} ~ '^[0-9a-f]{64}$'`),
    check('transcript_duration_chk', sql`${t.audioDurationMs} >= 0`),
    check('transcript_counts_chk', sql`${t.segmentCount} >= 0 AND ${t.wordCount} >= 0`),
  ],
);

/**
 * Transkript-Abschnitt (03 §5) nach der Nachbearbeitung aus 05 §P4 (Satzgrenzen, 5–30 s).
 * Zeiten in Sitzungszeit (ms seit `session.started_at`), auch die Wörter. `words` = `TranscriptWord[]`.
 */
export const transcriptSegment = pgTable(
  'transcript_segment',
  {
    ...baseColumns(),
    transcriptId: uuid('transcript_id').notNull(), // FK zusammengesetzt, siehe unten
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    recordingId: uuid('recording_id').notNull(), // = transcript.recording_id (FK unten), für Abfragen ohne Join
    seq: integer('seq').notNull(), // Reihenfolge im Transkript, ab 0
    startMs: int8('start_ms').notNull(),
    endMs: int8('end_ms').notNull(),
    text: text('text').notNull(),
    lang: text('lang'),
    speaker: text('speaker'),
    avgLogprob: real('avg_logprob'),
    noSpeechProb: real('no_speech_prob'),
    words: jsonb('words').$type<TranscriptWord[]>(),
    embedding: embedding(), // später (align.content, search.index); bis dahin NULL
  },
  (t) => [
    unique('transcript_segment_seq_uq').on(t.transcriptId, t.seq),
    foreignKey({
      name: 'transcript_segment_transcript_fk',
      columns: [t.transcriptId, t.recordingId, t.sessionId],
      foreignColumns: [transcript.id, transcript.recordingId, transcript.sessionId],
    }).onDelete('cascade'),
    index('transcript_segment_session_idx').on(t.sessionId, t.startMs),
    check('transcript_segment_seq_chk', sql`${t.seq} >= 0`),
    check('transcript_segment_time_chk', sql`${t.startMs} >= 0 AND ${t.endMs} >= ${t.startMs}`),
    check('transcript_segment_lang_chk', sql`${t.lang} IS NULL OR ${t.lang} ~ '^[a-z]{2,3}$'`),
  ],
);

/** Ergebnis der Ausrichtung (03 §5): welche Folie lief wann. `source = log` schreibt `align.log` (05 §P5a) */
export const slideSegment = pgTable(
  'slide_segment',
  {
    ...baseColumns(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    slideId: uuid('slide_id').notNull(), // Kein FK (siehe oben)
    slideIndex: integer('slide_index').notNull(), // 1-basiert, Folie im Foliensatz der Session
    startMs: int8('start_ms').notNull(),
    endMs: int8('end_ms').notNull(),
    source: text('source').notNull(), // log | ausrichtung | manuell
    confidence: real('confidence').notNull(), // 0..1, log = 1
    jobId: uuid('job_id'), // erzeugender Job, NULL bei manuell
  },
  (t) => [
    index('slide_segment_session_idx').on(t.sessionId, t.source, t.startMs),
    check('slide_segment_index_chk', sql`${t.slideIndex} >= 1`),
    check('slide_segment_time_chk', sql`${t.startMs} >= 0 AND ${t.endMs} > ${t.startMs}`),
    check('slide_segment_source_chk', sql`${t.source} IN ('log','ausrichtung','manuell')`),
    check('slide_segment_confidence_chk', sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`),
  ],
);
