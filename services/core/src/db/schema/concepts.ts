// Wissen und Inbox (03 §7/§8, 05 §P7a/§P8/§P9, VERTRAEGE §20). Migration 0010_concepts.
//
// Schreiber: der Worker (`concepts.resolve` legt Vorschläge, Belege und Inbox-Einträge an, `summary.write` die
// Zusammenfassung) und der Core (Entscheidungen in der Inbox, §20.6). Konzepte gehören keinem Fach allein
// (`concept_module`). Vorschläge hängen über `proposal_session_id` an der Session, aus der sie stammen: Löschen der
// Session nimmt sie mit (§20.8). Angenommene Konzepte und bestätigte Beziehungen haben keine Session mehr.
// `vault_path`, `content_hash` und `block_hashes` (W-02) kommen erst mit dem Vault.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  real,
  text,
  unique,
  uniqueIndex,
  uuid,
  integer,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { InboxDecision, InboxPayload, SummaryOutlineItem, SummarySentence } from '@sg/shared';
import { baseColumns, embedding, timestamptz } from './common.ts';
import { courseModule, session } from './organisation.ts';

/** int8 als JS-Zahl (Sitzungszeiten bleiben weit unter 2^53) */
const int8 = (name: string) => bigint(name, { mode: 'number' });

/**
 * Konzept (03 §7, W-02 Option A: `kind`). `status = vorschlag` nur zusammen mit `proposal_session_id`,
 * `zusammengefuehrt` nur mit `merged_into` (Invariante 5). `embedding` aus Name, Aliasen und One-Liner (§20.3).
 */
export const concept = pgTable(
  'concept',
  {
    ...baseColumns(),
    name: text('name').notNull(),
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'`),
    kind: text('kind'), // definition | verfahren | modell | satz | beispiel (ConceptKind), NULL = unbekannt
    oneLiner: text('one_liner'),
    status: text('status').notNull(), // vorschlag | aktiv | zusammengefuehrt (ConceptStatus)
    mergedInto: uuid('merged_into').references((): AnyPgColumn => concept.id, { onDelete: 'cascade' }),
    /** Session, aus der der Vorschlag stammt. NULL, sobald das Konzept aktiv ist (§20.6) */
    proposalSessionId: uuid('proposal_session_id').references(() => session.id, { onDelete: 'cascade' }),
    examRelevant: boolean('exam_relevant').notNull().default(false),
    importanceBase: real('importance_base').notNull().default(1),
    embedding: embedding(),
    embeddingModel: text('embedding_model'),
  },
  (t) => [
    index('concept_status_idx')
      .on(t.status)
      .where(sql`${t.deletedAt} IS NULL`),
    index('concept_proposal_session_idx').on(t.proposalSessionId),
    index('concept_merged_into_idx').on(t.mergedInto),
    index('concept_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
    check('concept_name_chk', sql`char_length(${t.name}) BETWEEN 1 AND 200 AND ${t.name} !~ '[[:cntrl:]]'`),
    check('concept_aliases_chk', sql`cardinality(${t.aliases}) <= 20`),
    check(
      'concept_kind_chk',
      sql`${t.kind} IS NULL OR ${t.kind} IN ('definition','verfahren','modell','satz','beispiel')`,
    ),
    check(
      'concept_one_liner_chk',
      sql`${t.oneLiner} IS NULL OR char_length(${t.oneLiner}) BETWEEN 1 AND 500`,
    ),
    check('concept_status_chk', sql`${t.status} IN ('vorschlag','aktiv','zusammengefuehrt')`),
    check(
      'concept_merged_chk',
      sql`(${t.status} = 'zusammengefuehrt') = (${t.mergedInto} IS NOT NULL) AND ${t.mergedInto} IS DISTINCT FROM ${t.id}`,
    ),
    check(
      'concept_proposal_chk',
      sql`(${t.status} <> 'vorschlag' OR ${t.proposalSessionId} IS NOT NULL) AND (${t.status} <> 'aktiv' OR ${t.proposalSessionId} IS NULL)`,
    ),
    check('concept_importance_chk', sql`${t.importanceBase} > 0 AND ${t.importanceBase} <= 2`),
    check('concept_embedding_model_chk', sql`(${t.embedding} IS NULL) = (${t.embeddingModel} IS NULL)`),
  ],
);

/** Konzept ↔ Modul (n:m, 03 §7). Löschen des Moduls nimmt die Zuordnung mit, nie das Konzept (§20.8) */
export const conceptModule = pgTable(
  'concept_module',
  {
    ...baseColumns(),
    conceptId: uuid('concept_id')
      .notNull()
      .references(() => concept.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => courseModule.id, { onDelete: 'cascade' }),
  },
  (t) => [
    unique('concept_module_uq').on(t.conceptId, t.moduleId),
    index('concept_module_module_idx').on(t.moduleId),
  ],
);

/**
 * Beziehung (03 §7). „A baut_auf B“: B ist Voraussetzung von A. Unbestätigte Beziehungen sind KI-Vorschläge und
 * hängen an ihrer Session (`proposal_session_id`), bestätigte nicht mehr. Symmetrische Arten (`gegensatz`,
 * `verwandt`) stehen immer mit `from_id < to_id`. Kreisfreiheit von `baut_auf` (Invariante 4) prüft der Schreiber
 * unter der Sperre aus §20.6.
 */
export const conceptRelation = pgTable(
  'concept_relation',
  {
    ...baseColumns(),
    fromId: uuid('from_id')
      .notNull()
      .references(() => concept.id, { onDelete: 'cascade' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => concept.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // ConceptRelationKind
    source: text('source').notNull(), // ki | manuell | wikilink
    confidence: real('confidence'),
    confirmed: boolean('confirmed').notNull().default(false),
    why: text('why'),
    proposalSessionId: uuid('proposal_session_id').references(() => session.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id'), // vorschlagender Job, ohne FK
  },
  (t) => [
    uniqueIndex('concept_relation_uq')
      .on(t.fromId, t.toId, t.kind)
      .where(sql`${t.deletedAt} IS NULL`),
    index('concept_relation_to_idx').on(t.toId),
    index('concept_relation_proposal_session_idx').on(t.proposalSessionId),
    check(
      'concept_relation_kind_chk',
      sql`${t.kind} IN ('baut_auf','beispiel_fuer','gegensatz','angewendet_in','verwandt')`,
    ),
    check('concept_relation_source_chk', sql`${t.source} IN ('ki','manuell','wikilink')`),
    check('concept_relation_self_chk', sql`${t.fromId} <> ${t.toId}`),
    check(
      'concept_relation_symmetric_chk',
      sql`${t.kind} NOT IN ('gegensatz','verwandt') OR ${t.fromId} < ${t.toId}`,
    ),
    check('concept_relation_confirmed_chk', sql`${t.confirmed} = (${t.proposalSessionId} IS NULL)`),
    check('concept_relation_confidence_chk', sql`${t.confidence} IS NULL OR ${t.confidence} BETWEEN 0 AND 1`),
    check('concept_relation_why_chk', sql`${t.why} IS NULL OR char_length(${t.why}) BETWEEN 1 AND 500`),
  ],
);

/**
 * Beleg (03 §7, LP8). `slide`: `ref_id` = `slide.id`. `transcript`: `ref_id` = `session_id`, dazu der Zeitraum
 * (Segment-IDs sind nicht stabil, §18.1). `session_id` ist die Session, aus der der Beleg stammt: Löschen der
 * Session nimmt ihn mit. `auto = true`: beim Abgleich automatisch an ein vorhandenes Konzept gehängt, ein neuer
 * Lauf ersetzt ihn (§20.3).
 */
export const evidence = pgTable(
  'evidence',
  {
    ...baseColumns(),
    conceptId: uuid('concept_id')
      .notNull()
      .references(() => concept.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => session.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // slide | transcript (dieser Schnitt), später ink | task | photo | past_exam_question
    refId: uuid('ref_id').notNull(),
    tStartMs: int8('t_start_ms'),
    tEndMs: int8('t_end_ms'),
    region: jsonb('region').$type<unknown>(),
    quote: text('quote'),
    weight: real('weight').notNull().default(1),
    auto: boolean('auto').notNull().default(false),
    jobId: uuid('job_id'), // schreibender Job, ohne FK
  },
  (t) => [
    index('evidence_concept_idx').on(t.conceptId),
    index('evidence_session_idx').on(t.sessionId),
    // Kein Beleg doppelt am selben Konzept (Abgleich, Zusammenführen). Gelöschte zählen nicht
    uniqueIndex('evidence_dedupe_uq')
      .on(
        t.conceptId,
        t.kind,
        t.refId,
        sql`coalesce(${t.tStartMs}, -1)`,
        sql`coalesce(${t.tEndMs}, -1)`,
        sql`coalesce(${t.sessionId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${t.deletedAt} IS NULL`),
    check(
      'evidence_kind_chk',
      sql`${t.kind} IN ('slide','transcript','ink','task','photo','past_exam_question')`,
    ),
    check(
      'evidence_times_chk',
      sql`(${t.kind} = 'transcript' AND ${t.sessionId} IS NOT NULL AND ${t.refId} = ${t.sessionId}
            AND ${t.tStartMs} IS NOT NULL AND ${t.tStartMs} >= 0 AND ${t.tEndMs} IS NOT NULL AND ${t.tEndMs} >= ${t.tStartMs})
        OR (${t.kind} <> 'transcript' AND ${t.tStartMs} IS NULL AND ${t.tEndMs} IS NULL)`,
    ),
    check('evidence_quote_chk', sql`${t.quote} IS NULL OR char_length(${t.quote}) BETWEEN 1 AND 300`),
    check('evidence_weight_chk', sql`${t.weight} > 0`),
  ],
);

/**
 * Inbox-Eintrag (03 §8, F-NAC-06). `concept_id` ist das vorgeschlagene Konzept (`concept_new`, `concept_merge`),
 * `target_concept_id` das vorhandene Ziel (`concept_merge`), `relation_id` die vorgeschlagene Beziehung (`relation`).
 * `decision` hält fest, was eine Annahme geändert hat (Grundlage für „Rückgängig“, §20.6).
 */
export const inboxItem = pgTable(
  'inbox_item',
  {
    ...baseColumns(),
    kind: text('kind').notNull(), // InboxKind
    sessionId: uuid('session_id').references(() => session.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id'), // vorschlagender Job, ohne FK
    payload: jsonb('payload').$type<InboxPayload>().notNull(),
    status: text('status').notNull().default('offen'), // InboxStatus
    decidedAt: timestamptz('decided_at'),
    decision: jsonb('decision').$type<InboxDecision>(),
    priority: integer('priority').notNull().default(0), // kleiner = früher
    conceptId: uuid('concept_id').references(() => concept.id, { onDelete: 'cascade' }),
    targetConceptId: uuid('target_concept_id').references(() => concept.id, { onDelete: 'cascade' }),
    relationId: uuid('relation_id').references(() => conceptRelation.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('inbox_item_open_idx')
      .on(t.createdAt.desc(), t.id.desc())
      .where(sql`${t.status} = 'offen' AND ${t.deletedAt} IS NULL`),
    index('inbox_item_session_idx').on(t.sessionId),
    uniqueIndex('inbox_item_concept_uq')
      .on(t.conceptId)
      .where(sql`${t.conceptId} IS NOT NULL`),
    uniqueIndex('inbox_item_relation_uq')
      .on(t.relationId)
      .where(sql`${t.relationId} IS NOT NULL`),
    index('inbox_item_target_idx').on(t.targetConceptId),
    check('inbox_item_kind_chk', sql`${t.kind} IN ('concept_new','concept_merge','relation')`),
    check('inbox_item_status_chk', sql`${t.status} IN ('offen','angenommen','abgelehnt','automatisch')`),
    check(
      'inbox_item_refs_chk',
      sql`(${t.kind} = 'concept_new' AND ${t.conceptId} IS NOT NULL AND ${t.targetConceptId} IS NULL AND ${t.relationId} IS NULL)
        OR (${t.kind} = 'concept_merge' AND ${t.conceptId} IS NOT NULL AND ${t.targetConceptId} IS NOT NULL AND ${t.relationId} IS NULL)
        OR (${t.kind} = 'relation' AND ${t.relationId} IS NOT NULL AND ${t.conceptId} IS NULL AND ${t.targetConceptId} IS NULL)`,
    ),
    check(
      'inbox_item_decided_chk',
      sql`(${t.status} = 'offen') = (${t.decidedAt} IS NULL) AND (${t.status} <> 'offen' OR ${t.decision} IS NULL)`,
    ),
    check('inbox_item_payload_kind_chk', sql`${t.payload}->>'kind' = ${t.kind}`),
  ],
);

/**
 * Zusammenfassung einer Session (05 §P9 ohne Vault, F-NAC-08). Eine je Session, direkt sichtbar (§20.4).
 * `summary.write` ersetzt sie hart, das Löschen der Session nimmt sie weich mit.
 */
export const sessionSummary = pgTable(
  'session_summary',
  {
    ...baseColumns(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    lang: text('lang'), // de | en | mixed, NULL = unbekannt
    sentences: jsonb('sentences').$type<SummarySentence[]>().notNull(),
    outline: jsonb('outline')
      .$type<SummaryOutlineItem[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    provider: text('provider').notNull(), // anthropic | fake
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    inputHash: text('input_hash').notNull(),
    jobId: uuid('job_id'), // schreibender Job, ohne FK
  },
  (t) => [
    unique('session_summary_session_uq').on(t.sessionId),
    check('session_summary_lang_chk', sql`${t.lang} IS NULL OR ${t.lang} IN ('de','en','mixed')`),
    check(
      'session_summary_sentences_chk',
      sql`jsonb_typeof(${t.sentences}) = 'array' AND jsonb_array_length(${t.sentences}) BETWEEN 1 AND 5`,
    ),
    check(
      'session_summary_outline_chk',
      sql`jsonb_typeof(${t.outline}) = 'array' AND jsonb_array_length(${t.outline}) <= 30`,
    ),
    check('session_summary_input_hash_chk', sql`${t.inputHash} ~ '^[0-9a-f]{64}$'`),
  ],
);
