// Handschrift (03 §6, 08 §4, VERTRAEGE §6.1 und §11.3): Notizbücher, Seiten, Striche, Seitenelemente.
// Fremdschlüssel nur innerhalb des Notizbuch-Stroms (page.notebook_id, stroke.page_id, page_element.page_id).
// page.session_id, background_slide_id und attached_slide_id liegen über Stromgrenzen und haben keinen FK (VERTRAEGE §6).
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns, bytea } from './common.ts';
import { courseModule } from './organisation.ts';

/** int8 als JS-Zahl (Sitzungszeiten bleiben weit unter 2^53) */
const int8 = (name: string) => bigint(name, { mode: 'number' });

/** Notizbuch (03 §6). `id` = `notebook_id`, auch offline vom iPad vergeben (`notebook.create`) */
export const notebook = pgTable(
  'notebook',
  {
    ...baseColumns(),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => courseModule.id),
    title: text('title').notNull(),
    kind: text('kind').notNull().default('frei'), // vorlesung | uebung | frei
  },
  (t) => [
    index('notebook_module_idx').on(t.moduleId),
    // Je Modul höchstens ein Notizbuch „Vorlesung“ und eines „Übung“ (409 notebook_kind_exists, F-INK-02)
    uniqueIndex('notebook_default_uq')
      .on(t.moduleId, t.kind)
      .where(sql`${t.kind} IN ('vorlesung','uebung') AND ${t.deletedAt} IS NULL`),
    check('notebook_kind_chk', sql`${t.kind} IN ('vorlesung','uebung','frei')`),
  ],
);

/** Seite (03 §6). `index` ist nicht eindeutig (VERTRAEGE §7.4), `version` für `page.update` (§11.3) */
export const page = pgTable(
  'page',
  {
    ...baseColumns(),
    notebookId: uuid('notebook_id')
      .notNull()
      .references(() => notebook.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id'), // Kein FK (Stromgrenze)
    index: integer('index').notNull(), // 1-basiert
    template: text('template').notNull(),
    backgroundSlideId: uuid('background_slide_id'), // Kein FK (Stromgrenze)
    attachedSlideId: uuid('attached_slide_id'), // Kein FK (Stromgrenze)
    widthPt: real('width_pt').notNull(),
    heightPt: real('height_pt').notNull(),
    /** PencilKit-Sicherung relativ zu SG_DATA_DIR (`media/pages/<page_id>.pkdrawing`), NULL bis zum ersten Upload */
    pkdrawingPath: text('pkdrawing_path'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    index('page_notebook_idx').on(t.notebookId, t.index),
    index('page_session_idx').on(t.sessionId),
    check('page_index_chk', sql`${t.index} >= 1`),
    check('page_version_chk', sql`${t.version} >= 1`),
    check(
      'page_template_chk',
      sql`${t.template} IN ('blanko','liniert','kariert','punktraster','cornell','folie')`,
    ),
  ],
);

/**
 * Strich im neutralen Format (03 §6, 08 §4). `created_at` ist die Entstehungszeit des Strichs
 * (synchronisierte Uhr, aus `created_at` in ms), nicht die Zeit des Schreibens in die DB.
 * Upsert über `(page_id, client_id)`, auch für gelöschte Striche (Invariante 6, VERTRAEGE §11.3).
 */
export const stroke = pgTable(
  'stroke',
  {
    ...baseColumns(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => page.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(), // vom iPad vergebene, stabile ID
    tool: text('tool').notNull(),
    layer: text('layer').notNull(),
    color: text('color').notNull(), // #RRGGBBAA
    width: real('width').notNull(),
    tStartMs: int8('t_start_ms'), // NULL außerhalb einer Session
    tEndMs: int8('t_end_ms'),
    transform: real('transform')
      .array()
      .notNull()
      .default(sql`'{1,0,0,1,0,0}'`),
    bbox: jsonb('bbox').$type<number[]>().notNull(),
    points: bytea('points').notNull(), // 24 Byte je Punkt (08 §4.2)
    clockUncertain: boolean('clock_uncertain').notNull().default(false),
  },
  (t) => [
    unique('stroke_page_client_uq').on(t.pageId, t.clientId),
    check('stroke_tool_chk', sql`${t.tool} IN ('pen','pencil','marker','monoline','fountain')`),
    check('stroke_layer_chk', sql`${t.layer} IN ('ink','highlight')`),
    check('stroke_transform_chk', sql`cardinality(${t.transform}) = 6`),
  ],
);

/** Seitenelement (03 §6, 08 §4.4). `id` = `element_id`, Upsert darüber */
export const pageElement = pgTable(
  'page_element',
  {
    ...baseColumns(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => page.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // text | image | shape | tape | stamp
    /** [x, y, w, h] in pt. Ergänzung zu 03 §6: `PageElement.frame` der API */
    frame: jsonb('frame').$type<number[]>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    tMs: int8('t_ms'),
    z: integer('z').notNull().default(0),
  },
  (t) => [
    index('page_element_page_idx').on(t.pageId),
    check('page_element_kind_chk', sql`${t.kind} IN ('text','image','shape','tape','stamp')`),
  ],
);
