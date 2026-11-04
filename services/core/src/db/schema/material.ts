// Material (03 §4): Foliensätze, Folien, Übungsblätter, Aufgaben, Verknüpfungen
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { baseColumns, embedding, timestamptz } from './common.ts';
import { courseModule, session } from './organisation.ts';

const ingestStates = sql`('neu','verarbeitet','fehler')`;

export const slideDeck = pgTable(
  'slide_deck',
  {
    ...baseColumns(),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => courseModule.id),
    // NULL = nicht an eine Session gehängt. Typannotation nötig wegen des Zyklus session ↔ slide_deck.
    sessionId: uuid('session_id').references((): AnyPgColumn => session.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    filePath: text('file_path').notNull(), // relativ zu SG_DATA_DIR (VERTRAEGE §4)
    sha256: text('sha256').notNull(),
    pageCount: integer('page_count'), // NULL bis pdf.ingest gelaufen ist
    uploadedAt: timestamptz('uploaded_at').notNull().defaultNow(),
    ingestState: text('ingest_state').notNull().default('neu'),
  },
  (t) => [
    index('slide_deck_module_idx').on(t.moduleId),
    index('slide_deck_sha_idx').on(t.moduleId, t.sha256),
    check('slide_deck_ingest_chk', sql`${t.ingestState} IN ${ingestStates}`),
  ],
);

export const slide = pgTable(
  'slide',
  {
    ...baseColumns(),
    deckId: uuid('deck_id')
      .notNull()
      .references(() => slideDeck.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(), // 1-basiert
    imagePath: text('image_path'),
    thumbPath: text('thumb_path'),
    widthPt: real('width_pt').notNull(),
    heightPt: real('height_pt').notNull(),
    text: text('text').notNull().default(''), // Textlayer
    textBlocks: jsonb('text_blocks')
      .$type<{ text: string; bbox: number[] }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    visionSummary: text('vision_summary'),
    title: text('title'),
    chapter: text('chapter'),
    embedding: embedding(),
  },
  (t) => [
    uniqueIndex('slide_deck_index_uq')
      .on(t.deckId, t.index)
      .where(sql`${t.deletedAt} IS NULL`),
    index('slide_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
    check('slide_index_chk', sql`${t.index} >= 1`),
  ],
);

export const exerciseSheet = pgTable(
  'exercise_sheet',
  {
    ...baseColumns(),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => courseModule.id),
    title: text('title').notNull(),
    number: integer('number'),
    filePath: text('file_path').notNull(),
    sha256: text('sha256').notNull(),
    pageCount: integer('page_count'), // NULL bis pdf.ingest gelaufen ist
    dueAt: timestamptz('due_at'), // Abgabe
    solutionFilePath: text('solution_file_path'), // Musterlösung (F-LRN-14)
    ingestState: text('ingest_state').notNull().default('neu'), // Ergänzung zu 03 §4
  },
  (t) => [
    index('exercise_sheet_module_idx').on(t.moduleId),
    index('exercise_sheet_sha_idx').on(t.moduleId, t.sha256),
    check('exercise_sheet_ingest_chk', sql`${t.ingestState} IN ${ingestStates}`),
  ],
);

export const task = pgTable(
  'task',
  {
    ...baseColumns(),
    sheetId: uuid('sheet_id')
      .notNull()
      .references(() => exerciseSheet.id, { onDelete: 'cascade' }),
    label: text('label').notNull(), // „2b“
    pageIndex: integer('page_index').notNull(),
    bbox: jsonb('bbox').$type<number[]>(),
    text: text('text').notNull().default(''),
    solutionText: text('solution_text'),
    embedding: embedding(),
  },
  (t) => [
    index('task_sheet_idx').on(t.sheetId),
    index('task_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

export const taskSlideLink = pgTable(
  'task_slide_link',
  {
    ...baseColumns(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    slideId: uuid('slide_id')
      .notNull()
      .references(() => slide.id, { onDelete: 'cascade' }),
    relevance: real('relevance').notNull(), // 0..1
    reason: text('reason').notNull(), // 1 Satz Begründung
    source: text('source').notNull(), // auto | manuell
    confirmed: boolean('confirmed').notNull().default(false),
  },
  (t) => [
    uniqueIndex('task_slide_link_uq')
      .on(t.taskId, t.slideId)
      .where(sql`${t.deletedAt} IS NULL`),
    index('task_slide_link_slide_idx').on(t.slideId),
    check('task_slide_link_relevance_chk', sql`${t.relevance} BETWEEN 0 AND 1`),
    check('task_slide_link_source_chk', sql`${t.source} IN ('auto','manuell')`),
  ],
);
