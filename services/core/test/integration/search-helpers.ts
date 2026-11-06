// Hilfen für die Such-Tests (T2-12): Einträge in `search_chunk` schreiben wie der Worker (§19.1, §19.3), ohne Worker.
import { createHash } from 'node:crypto';
import { SINGLE_USER_ID } from '@sg/shared';
import type { DbHandle } from '../../src/db/client.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { FAKE_MODEL, fakeEmbed } from '../unit/worker-fake.ts';

export interface ChunkInput {
  id?: string;
  text: string;
  tsConfig?: 'german' | 'english' | 'simple';
  /** `true`: Fake-Vektor des Texts. Zahl-Array: genau dieser Vektor. `false`/fehlt: ohne Vektor */
  embedding?: boolean | number[];
  model?: string;
  deletedAt?: Date | null;
}

export interface SlideChunkInput extends ChunkInput {
  deckId: string;
  slideIndex: number;
  slideId?: string;
  title?: string | null;
}

export interface TranscriptChunkInput extends ChunkInput {
  sessionId: string;
  part: number;
  tMs: number;
  tEndMs: number;
}

const vectorLiteral = (v: number[]): string => `[${v.join(',')}]`;

async function insertChunk(
  handle: DbHandle,
  base: ChunkInput,
  fields: {
    kind: 'slide' | 'transcript';
    sourceId: string;
    part: number;
    deckId: string | null;
    sessionId: string | null;
    slideIndex: number | null;
    tMs: number | null;
    tEndMs: number | null;
    title: string | null;
  },
): Promise<string> {
  const id = base.id ?? uuidv7();
  const vector =
    base.embedding === true ? fakeEmbed(base.text) : Array.isArray(base.embedding) ? base.embedding : null;
  const hash = createHash('sha256').update(base.text, 'utf8').digest('hex');
  const cfg = base.tsConfig ?? 'german';
  await handle.sql`
    INSERT INTO search_chunk (id, user_id, deleted_at, source_kind, source_id, part, deck_id, session_id, slide_index,
      t_ms, t_end_ms, title, text, ts_config, tsv, embedding, embedding_model, content_hash, index_version, job_id)
    VALUES (${id}, ${SINGLE_USER_ID}, ${base.deletedAt ? base.deletedAt.toISOString() : null}::timestamptz, ${fields.kind}, ${fields.sourceId}, ${fields.part},
      ${fields.deckId}, ${fields.sessionId}, ${fields.slideIndex}, ${fields.tMs}, ${fields.tEndMs}, ${fields.title},
      ${base.text}, ${cfg}, to_tsvector(${cfg}::regconfig, ${base.text}) || to_tsvector('simple', ${base.text}),
      ${vector ? vectorLiteral(vector) : null}::vector, ${vector ? (base.model ?? FAKE_MODEL) : null},
      ${hash}, 1, NULL)`;
  return id;
}

export function insertSlideChunk(handle: DbHandle, input: SlideChunkInput): Promise<string> {
  return insertChunk(handle, input, {
    kind: 'slide',
    sourceId: input.slideId ?? uuidv7(),
    part: 0,
    deckId: input.deckId,
    sessionId: null,
    slideIndex: input.slideIndex,
    tMs: null,
    tEndMs: null,
    title: input.title ?? null,
  });
}

export function insertTranscriptChunk(handle: DbHandle, input: TranscriptChunkInput): Promise<string> {
  return insertChunk(handle, input, {
    kind: 'transcript',
    sourceId: input.sessionId,
    part: input.part,
    deckId: null,
    sessionId: input.sessionId,
    slideIndex: null,
    tMs: input.tMs,
    tEndMs: input.tEndMs,
    title: null,
  });
}

/** Einheitsvektor mit Cosinus `sim` zu `unit` (beide 1024-dimensional, `unit` L2-normiert) */
export function vectorWithSimilarity(unit: number[], sim: number): number[] {
  // Eine Achse suchen, auf der `unit` 0 ist (der Fake hat nur wenige Einträge ≠ 0)
  const axis = unit.findIndex((x) => x === 0);
  const result = unit.map((x) => x * sim);
  result[axis] = Math.sqrt(1 - sim * sim);
  return result;
}
