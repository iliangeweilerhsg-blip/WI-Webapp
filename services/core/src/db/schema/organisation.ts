// Organisation (03 §3): Semester, Modul, Kalender, Session
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { baseColumns, timestamptz } from './common.ts';
import { slideDeck } from './material.ts';

export const semester = pgTable(
  'semester',
  {
    ...baseColumns(),
    name: text('name').notNull(), // z. B. „HS 2026“
    startsOn: date('starts_on', { mode: 'string' }),
    endsOn: date('ends_on', { mode: 'string' }),
    isCurrent: boolean('is_current').notNull().default(false),
    /** Archiviert = nur in der Navigation ausgeblendet (F-ORG-01). Ergänzung zu 03 §3. */
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [
    // „Höchstens ein Semester ist aktuell“
    uniqueIndex('semester_current_uq')
      .on(t.userId)
      .where(sql`${t.isCurrent} AND ${t.deletedAt} IS NULL`),
  ],
);

export const courseModule = pgTable(
  'module',
  {
    ...baseColumns(),
    semesterId: uuid('semester_id')
      .notNull()
      .references(() => semester.id),
    name: text('name').notNull(),
    shortName: text('short_name'),
    color: text('color').notNull(), // Token mod-01 … mod-12 (07 §8)
    ects: numeric('ects', { mode: 'number' }),
    examType: text('exam_type'),
    lecturer: text('lecturer'),
    lang: text('lang'),
    descriptionMd: text('description_md'),
  },
  (t) => [
    index('module_semester_idx').on(t.semesterId),
    check('module_color_chk', sql`${t.color} ~ '^mod-(0[1-9]|1[0-2])$'`),
    check('module_lang_chk', sql`${t.lang} IS NULL OR ${t.lang} IN ('de','en','mixed')`),
  ],
);

export const calendarSource = pgTable(
  'calendar_source',
  {
    ...baseColumns(),
    kind: text('kind').notNull(), // ics_file | ics_url | google
    url: text('url'),
    lastSyncedAt: timestamptz('last_synced_at'),
    readonly: boolean('readonly').notNull().default(true),
  },
  (t) => [check('calendar_source_kind_chk', sql`${t.kind} IN ('ics_file','ics_url','google')`)],
);

export const calendarEvent = pgTable(
  'calendar_event',
  {
    ...baseColumns(),
    sourceId: uuid('source_id').references(() => calendarSource.id), // NULL = manuell
    externalUid: text('external_uid'), // UID aus ICS/Google, für den Abgleich
    moduleId: uuid('module_id').references(() => courseModule.id),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    location: text('location'),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    recurrenceId: text('recurrence_id'),
    cancelled: boolean('cancelled').notNull().default(false),
  },
  (t) => [
    index('calendar_event_starts_idx').on(t.startsAt),
    index('calendar_event_module_idx').on(t.moduleId),
    index('calendar_event_source_uid_idx').on(t.sourceId, t.externalUid),
    check(
      'calendar_event_kind_chk',
      sql`${t.kind} IN ('vorlesung','uebung','tutorium','pruefung','fest','lernblock_export')`,
    ),
  ],
);

export const session = pgTable(
  'session',
  {
    ...baseColumns(),
    calendarEventId: uuid('calendar_event_id').references(() => calendarEvent.id), // NULL = spontan
    moduleId: uuid('module_id')
      .notNull()
      .references(() => courseModule.id),
    // NULL = folienloser Modus. Typannotation nötig wegen des Zyklus session ↔ slide_deck.
    slideDeckId: uuid('slide_deck_id').references((): AnyPgColumn => slideDeck.id),
    number: integer('number'), // VL-Nummer im Modul
    title: text('title'),
    state: text('state').notNull().default('geplant'), // Zustandsautomat F-SES-01
    startedAt: timestamptz('started_at'),
    endedAt: timestamptz('ended_at'),
    stopReason: text('stop_reason'),
    startedFrom: text('started_from'),
    processing: jsonb('processing').$type<Record<string, string>>(),
    reviewState: text('review_state').notNull().default('offen'),
  },
  (t) => [
    index('session_module_idx').on(t.moduleId),
    index('session_event_idx').on(t.calendarEventId),
    // Invariante 03 §14.1: höchstens eine laufende Session
    uniqueIndex('session_one_running_uq')
      .on(t.userId)
      .where(sql`${t.state} = 'laeuft' AND ${t.deletedAt} IS NULL`),
    check(
      'session_state_chk',
      sql`${t.state} IN ('geplant','bereit','laeuft','pausiert','beendet','verarbeitet','verpasst')`,
    ),
    check(
      'session_stop_reason_chk',
      sql`${t.stopReason} IS NULL OR ${t.stopReason} IN
      ('manuell','kalenderende','stille','maximaldauer','absturz_wiederhergestellt')`,
    ),
    check('session_started_from_chk', sql`${t.startedFrom} IS NULL OR ${t.startedFrom} IN ('mac','ipad')`),
    check('session_review_state_chk', sql`${t.reviewState} IN ('offen','in_arbeit','erledigt')`),
  ],
);
