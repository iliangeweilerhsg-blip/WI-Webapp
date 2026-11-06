// Suchindex (03 §7 `search_chunk`, 05 §P18, F-SUC-01, VERTRAEGE §19.1).
// Schreiber ist nur der Worker (`search.index`), der Core liest (`GET /search`) und kaskadiert beim Löschen.
// Ein Eintrag hängt genau an einem Foliensatz (`slide`) oder an einer Session (`transcript`). Das Modul kommt beim
// Lesen immer über diesen Eltern-Eintrag, es gibt keine Kopie von `module_id`.
import { sql } from 'drizzle-orm';
import { bigint, check, customType, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { baseColumns, embedding } from './common.ts';
import { slideDeck } from './material.ts';
import { session } from './organisation.ts';

/** int8 als JS-Zahl (Sitzungszeiten bleiben weit unter 2^53) */
const int8 = (name: string) => bigint(name, { mode: 'number' });

/** `tsvector`. Der Worker schreibt `to_tsvector(ts_config::regconfig, text)`, keine generierte Spalte (§19.1). */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

export const searchChunk = pgTable(
  'search_chunk',
  {
    ...baseColumns(),
    sourceKind: text('source_kind').notNull(), // slide | transcript (SearchKind)
    sourceId: uuid('source_id').notNull(), // slide.id bzw. session.id (Segment-IDs sind nicht stabil, §18.1)
    part: integer('part').notNull(), // slide: 0, transcript: Fenster ab 0
    deckId: uuid('deck_id').references(() => slideDeck.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => session.id, { onDelete: 'cascade' }),
    slideIndex: integer('slide_index'),
    tMs: int8('t_ms'),
    tEndMs: int8('t_end_ms'),
    title: text('title'),
    text: text('text').notNull(),
    tsConfig: text('ts_config').notNull(), // german | english | simple
    tsv: tsvector('tsv').notNull(),
    embedding: embedding(), // NULL, wenn der Embedder nicht verfügbar war (§19.3 Schritt 4)
    embeddingModel: text('embedding_model'),
    contentHash: text('content_hash').notNull(),
    indexVersion: integer('index_version').notNull(),
    jobId: uuid('job_id'), // schreibender search.index-Job. Kein FK (Jobs sind Verlauf)
  },
  (t) => [
    unique('search_chunk_source_uq').on(t.sourceKind, t.sourceId, t.part),
    index('search_chunk_tsv_gin').using('gin', t.tsv),
    index('search_chunk_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('search_chunk_deck_idx').on(t.deckId),
    index('search_chunk_session_idx').on(t.sessionId),
    check('search_chunk_kind_chk', sql`${t.sourceKind} IN ('slide','transcript')`),
    check('search_chunk_ts_config_chk', sql`${t.tsConfig} IN ('german','english','simple')`),
    check('search_chunk_part_chk', sql`${t.part} >= 0`),
    check(
      'search_chunk_parent_chk',
      sql`(${t.sourceKind} = 'slide' AND ${t.deckId} IS NOT NULL AND ${t.sessionId} IS NULL AND ${t.part} = 0
            AND ${t.slideIndex} IS NOT NULL AND ${t.slideIndex} >= 1 AND ${t.tMs} IS NULL AND ${t.tEndMs} IS NULL)
        OR (${t.sourceKind} = 'transcript' AND ${t.sessionId} IS NOT NULL AND ${t.deckId} IS NULL
            AND ${t.sourceId} = ${t.sessionId} AND ${t.slideIndex} IS NULL AND ${t.title} IS NULL
            AND ${t.tMs} IS NOT NULL AND ${t.tMs} >= 0 AND ${t.tEndMs} IS NOT NULL AND ${t.tEndMs} >= ${t.tMs})`,
    ),
    check('search_chunk_text_chk', sql`char_length(${t.text}) BETWEEN 1 AND 8000`),
    check('search_chunk_content_hash_chk', sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
    check('search_chunk_embedding_model_chk', sql`(${t.embedding} IS NULL) = (${t.embeddingModel} IS NULL)`),
    check('search_chunk_index_version_chk', sql`${t.indexVersion} >= 1`),
  ],
);
