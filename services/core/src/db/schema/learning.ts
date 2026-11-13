// Karten und Wiederholung, Minimal-Lernen (03 §9, 06 §1/§3, 08 §6, VERTRAEGE §21). Migration 0012_cards.
//
// Schreiber ist nur der Core: Karten entstehen beim Annehmen eines Kartenvorschlags (`inbox_item.kind = card_batch`,
// §21.7) oder von Hand (`POST /cards`, §21.4), Bewertungen über `POST /cards/{id}/review`. Der Worker schreibt keine
// dieser Tabellen, er legt nur Vorschläge in die Inbox (§21.6). Angenommene Karten gehören zum aktiven Konzept und
// bleiben, wenn die Session gelöscht wird, aus der sie stammen (§21.8).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { CardBackBasic, CardBackCloze, CardFrontText, CardState, EvidenceRef } from '@sg/shared';
import { baseColumns, timestamptz } from './common.ts';
import { concept } from './concepts.ts';

/** `card_state` als Momentaufnahme in `review_log` (Zeiten als ISO-Text, wie die API) */
export type CardStateSnapshot = CardState;

/**
 * Karte (03 §9). `front` und `back` nach 08 §6 je `kind`, in diesem Schnitt nur `basic` und `cloze`.
 * `sources` ersetzt `source_evidence_ids`: Belege als `EvidenceRef` statt als IDs, weil Zeilen in `evidence` bei
 * einem neuen Abgleich und beim Zusammenführen hart ersetzt werden (§20.3, §20.6). Mindestens ein Beleg (Invariante 3).
 */
export const card = pgTable(
  'card',
  {
    ...baseColumns(),
    conceptId: uuid('concept_id')
      .notNull()
      .references(() => concept.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // basic | cloze (CardKind)
    stage: integer('stage').notNull().default(2), // Lernstufe 1–4 (F-LRN-01), basic und cloze: 2
    front: jsonb('front').$type<CardFrontText>().notNull(),
    back: jsonb('back').$type<CardBackBasic | CardBackCloze>().notNull(),
    sources: jsonb('sources').$type<EvidenceRef[]>().notNull(),
    origin: text('origin').notNull(), // ki | manuell (CardOrigin)
    suspended: boolean('suspended').notNull().default(false),
    /** Inbox-Eintrag, aus dem die Karte stammt (`origin = ki`), ohne FK: Der Eintrag geht mit seiner Session */
    inboxItemId: uuid('inbox_item_id'),
  },
  (t) => [
    index('card_concept_idx')
      .on(t.conceptId)
      .where(sql`${t.deletedAt} IS NULL`),
    check('card_kind_chk', sql`${t.kind} IN ('basic','cloze')`),
    check('card_stage_chk', sql`${t.stage} BETWEEN 1 AND 4`),
    check('card_front_chk', sql`jsonb_typeof(${t.front}) = 'object'`),
    check('card_back_chk', sql`jsonb_typeof(${t.back}) = 'object'`),
    check(
      'card_sources_chk',
      sql`jsonb_typeof(${t.sources}) = 'array' AND jsonb_array_length(${t.sources}) BETWEEN 1 AND 6`,
    ),
    check('card_origin_chk', sql`${t.origin} IN ('ki','manuell')`),
    check('card_inbox_item_chk', sql`${t.origin} = 'ki' OR ${t.inboxItemId} IS NULL`),
  ],
);

/**
 * FSRS-Zustand, 1:1 zur Karte (03 §9). Felder wie der Kartentyp von `ts-fsrs`, darum zusätzlich `learning_steps`
 * und Gleitkommazahlen mit doppelter Genauigkeit (die Bibliothek rechnet so, `review_log` hält dieselben Werte).
 * Entsteht mit der Karte (`state = new`, `due` = Anlegezeit) und wird mit ihr gelöscht.
 */
export const cardState = pgTable(
  'card_state',
  {
    ...baseColumns(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => card.id, { onDelete: 'cascade' }),
    state: text('state').notNull().default('new'), // new | learning | review | relearning (FsrsState)
    due: timestamptz('due').notNull(),
    stability: doublePrecision('stability').notNull().default(0),
    difficulty: doublePrecision('difficulty').notNull().default(0),
    elapsedDays: integer('elapsed_days').notNull().default(0),
    scheduledDays: integer('scheduled_days').notNull().default(0),
    learningSteps: integer('learning_steps').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    lastReview: timestamptz('last_review'),
  },
  (t) => [
    unique('card_state_card_uq').on(t.cardId),
    index('card_state_due_idx')
      .on(t.due)
      .where(sql`${t.deletedAt} IS NULL`),
    check('card_state_state_chk', sql`${t.state} IN ('new','learning','review','relearning')`),
    check(
      'card_state_numbers_chk',
      sql`${t.stability} >= 0 AND ${t.difficulty} >= 0 AND ${t.elapsedDays} >= 0 AND ${t.scheduledDays} >= 0
        AND ${t.learningSteps} >= 0 AND ${t.reps} >= 0 AND ${t.lapses} >= 0`,
    ),
    check('card_state_new_chk', sql`(${t.state} = 'new') = (${t.lastReview} IS NULL)`),
  ],
);

/**
 * Eine Bewertung (03 §9). Die ID kommt vom Client und macht `POST /cards/{id}/review` wiederholbar (§21.4).
 * `state_before` und `state_after` halten den FSRS-Zustand fest (Grundlage für den Optimierer, 06 §1).
 */
export const reviewLog = pgTable(
  'review_log',
  {
    ...baseColumns(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => card.id, { onDelete: 'cascade' }),
    reviewedAt: timestamptz('reviewed_at').notNull(),
    rating: integer('rating').notNull(), // 1 Nochmal · 2 Schwer · 3 Gut · 4 Leicht
    ratingSource: text('rating_source').notNull().default('nutzer'),
    durationMs: integer('duration_ms').notNull(),
    context: text('context').notNull().default('taeglich'),
    stateBefore: jsonb('state_before').$type<CardStateSnapshot>().notNull(),
    stateAfter: jsonb('state_after').$type<CardStateSnapshot>().notNull(),
  },
  (t) => [
    index('review_log_card_idx').on(t.cardId, t.reviewedAt),
    index('review_log_reviewed_idx')
      .on(t.reviewedAt)
      .where(sql`${t.deletedAt} IS NULL`),
    check('review_log_rating_chk', sql`${t.rating} BETWEEN 1 AND 4`),
    check('review_log_rating_source_chk', sql`${t.ratingSource} IN ('nutzer')`),
    check('review_log_duration_chk', sql`${t.durationMs} BETWEEN 0 AND 3600000`),
    check('review_log_context_chk', sql`${t.context} IN ('taeglich')`),
    check(
      'review_log_states_chk',
      sql`jsonb_typeof(${t.stateBefore}) = 'object' AND jsonb_typeof(${t.stateAfter}) = 'object'`,
    ),
  ],
);
