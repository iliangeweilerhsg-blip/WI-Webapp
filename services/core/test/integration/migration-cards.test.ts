// Migration 0012_cards (B0, VERTRAEGE §21.1): Karten, FSRS-Zustand, Bewertungen und die Inbox-Art `card_batch`.
// Zuerst der Stand vor der Migration mit Bestandsdaten, dann die Prüfungen der neuen Tabellen. Alle Inhalte erfunden.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID } from '@sg/shared';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import { MIGRATIONS_FOLDER, runMigrations } from '../../src/db/migrate.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { testDatabaseUrl } from './helpers.ts';

/** Letzte Migration vor den Karten */
const BEFORE_TAG = '0011_backup_files_sha';
const U = SINGLE_USER_ID;

let admin: postgres.Sql;
let handle: DbHandle;
let sql: postgres.Sql;
let dbName: string;
let beforeFolder: string;

const moduleId = uuidv7();
const sessionId = uuidv7();
const activeId = uuidv7();
const proposalId = uuidv7();
const oldItemId = uuidv7();

beforeAll(async () => {
  admin = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  dbName = `sg_it_cards_${Date.now()}_${randomBytes(3).toString('hex')}`;
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${dbName}`;
  handle = createDb(url.toString());
  sql = handle.sql;

  beforeFolder = mkdtempSync(join(tmpdir(), 'sg-migrations-cards-'));
  cpSync(MIGRATIONS_FOLDER, beforeFolder, { recursive: true });
  const journalPath = join(beforeFolder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const last = journal.entries.findIndex((e) => e.tag === BEFORE_TAG);
  expect(last).toBeGreaterThanOrEqual(0);
  expect(journal.entries[last + 1]?.tag).toBe('0012_cards');
  journal.entries = journal.entries.slice(0, last + 1);
  writeFileSync(journalPath, JSON.stringify(journal));

  // Stand vor 0012 mit einem Konzept-Vorschlag samt Inbox-Eintrag
  await migrate(handle.db, { migrationsFolder: beforeFolder });
  const semesterId = uuidv7();
  await sql`INSERT INTO semester (id, user_id, name) VALUES (${semesterId}, ${U}, 'Karten-Test')`;
  await sql`INSERT INTO module (id, user_id, semester_id, name, color)
    VALUES (${moduleId}, ${U}, ${semesterId}, 'Beispielfach', 'mod-02')`;
  await sql`INSERT INTO session (id, user_id, module_id) VALUES (${sessionId}, ${U}, ${moduleId})`;
  await sql`INSERT INTO concept (id, user_id, name, status) VALUES (${activeId}, ${U}, 'Beispielbegriff', 'aktiv')`;
  await sql`INSERT INTO concept (id, user_id, name, status, proposal_session_id)
    VALUES (${proposalId}, ${U}, 'Zweiter Begriff', 'vorschlag', ${sessionId})`;
  await sql`INSERT INTO inbox_item (id, user_id, kind, session_id, payload, concept_id)
    VALUES (${oldItemId}, ${U}, 'concept_new', ${sessionId}, '{"kind":"concept_new"}'::jsonb, ${proposalId})`;

  await runMigrations(handle.db);
  await runMigrations(handle.db); // idempotent
});

afterAll(async () => {
  await handle?.close();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end({ timeout: 5 });
  rmSync(beforeFolder, { recursive: true, force: true });
});

const SLIDE_SOURCE = [{ kind: 'slide', slide_id: uuidv7(), deck_id: uuidv7(), slide_index: 3 }];
const STATE = { state: 'new', due: '2026-11-13T09:00:00Z', stability: 0, difficulty: 0 };

interface CardRow {
  id: string;
  concept: string;
  kind: string;
  stage: number;
  front: unknown;
  back: unknown;
  sources: unknown;
  origin: string;
  item: string | null;
}

async function insertCard(over: Partial<CardRow> = {}): Promise<string> {
  const r: CardRow = {
    id: uuidv7(),
    concept: activeId,
    kind: 'basic',
    stage: 2,
    front: { text_md: 'Was ist ein Beispielbegriff?' },
    back: { text_md: 'Ein erfundener Begriff für Tests.', explanation_md: null },
    sources: SLIDE_SOURCE,
    origin: 'manuell',
    item: null,
    ...over,
  };
  await sql`INSERT INTO card (id, user_id, concept_id, kind, stage, front, back, sources, origin, inbox_item_id)
    VALUES (${r.id}, ${U}, ${r.concept}, ${r.kind}, ${r.stage}, ${JSON.stringify(r.front)}::jsonb,
      ${JSON.stringify(r.back)}::jsonb, ${JSON.stringify(r.sources)}::jsonb, ${r.origin}, ${r.item})`;
  return r.id;
}

interface StateRow {
  state: string;
  lastReview: string | null;
  stability: number;
  reps: number;
}

async function insertState(cardId: string, over: Partial<StateRow> = {}): Promise<string> {
  const r: StateRow = { state: 'new', lastReview: null, stability: 0, reps: 0, ...over };
  const id = uuidv7();
  await sql`INSERT INTO card_state (id, user_id, card_id, state, due, stability, reps, last_review)
    VALUES (${id}, ${U}, ${cardId}, ${r.state}, now(), ${r.stability}, ${r.reps}, ${r.lastReview})`;
  return id;
}

interface ReviewRow {
  rating: number;
  duration: number;
  source: string;
  context: string;
  before: unknown;
}

async function insertReview(cardId: string, over: Partial<ReviewRow> = {}): Promise<string> {
  const r: ReviewRow = {
    rating: 3,
    duration: 8000,
    source: 'nutzer',
    context: 'taeglich',
    before: STATE,
    ...over,
  };
  const id = uuidv7();
  await sql`INSERT INTO review_log (id, user_id, card_id, reviewed_at, rating, rating_source, duration_ms, context,
      state_before, state_after)
    VALUES (${id}, ${U}, ${cardId}, now(), ${r.rating}, ${r.source}, ${r.duration}, ${r.context},
      ${JSON.stringify(r.before)}::jsonb, ${JSON.stringify(STATE)}::jsonb)`;
  return id;
}

interface BatchRow {
  kind: string;
  session: string | null;
  cardConcept: string | null;
  concept: string | null;
}

async function insertBatch(over: Partial<BatchRow> = {}): Promise<string> {
  const r: BatchRow = {
    kind: 'card_batch',
    session: sessionId,
    cardConcept: activeId,
    concept: null,
    ...over,
  };
  const id = uuidv7();
  await sql`INSERT INTO inbox_item (id, user_id, kind, session_id, payload, concept_id, card_concept_id)
    VALUES (${id}, ${U}, ${r.kind}, ${r.session}, ${JSON.stringify({ kind: r.kind })}::jsonb, ${r.concept},
      ${r.cardConcept})`;
  return id;
}

async function count(table: string, column: string, value: string): Promise<number> {
  const [row] = await sql`SELECT count(*)::int AS n FROM ${sql(table)} WHERE ${sql(column)} = ${value}`;
  return row!.n as number;
}

describe('Migration 0012_cards auf einem Stand mit Daten', () => {
  it('lässt vorhandene Inbox-Einträge unberührt und legt die Kartentabellen leer an', async () => {
    const [item] =
      await sql`SELECT kind, status, concept_id, card_concept_id FROM inbox_item WHERE id = ${oldItemId}`;
    expect(item).toEqual({
      kind: 'concept_new',
      status: 'offen',
      concept_id: proposalId,
      card_concept_id: null,
    });
    for (const table of ['card', 'card_state', 'review_log']) {
      expect(await sql.unsafe(`SELECT count(*)::int AS n FROM ${table}`)).toEqual([{ n: 0 }]);
    }
  });

  it('gibt den neuen Tabellen die Pflichtfelder und den updated_at-Trigger', async () => {
    const columns = await sql`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_name IN ('card','card_state','review_log')
        AND column_name IN ('id','user_id','created_at','updated_at','deleted_at')`;
    expect(columns).toHaveLength(15);
    const triggers = await sql`SELECT tgrelid::regclass::text AS t FROM pg_trigger
      WHERE tgname LIKE '%touch_updated_at' AND tgrelid::regclass::text IN ('card','card_state','review_log')`;
    expect(triggers.map((r) => r.t).sort()).toEqual(['card', 'card_state', 'review_log']);

    const c = await insertCard();
    const [before] = await sql`SELECT extract(epoch FROM updated_at)::float8 AS t FROM card WHERE id = ${c}`;
    await sql`SELECT pg_sleep(0.01)`;
    await sql`UPDATE card SET suspended = true WHERE id = ${c}`;
    const [after] = await sql`SELECT extract(epoch FROM updated_at)::float8 AS t FROM card WHERE id = ${c}`;
    expect(after!.t).toBeGreaterThan(before!.t);
  });
});

describe('Karten (VERTRAEGE §21.1)', () => {
  it('prüft Typ, Stufe, Herkunft, Inhalt und mindestens einen Beleg (Invariante 3)', async () => {
    await expect(insertCard({ kind: 'mc' })).rejects.toThrow(/card_kind_chk/);
    await expect(insertCard({ stage: 5 })).rejects.toThrow(/card_stage_chk/);
    await expect(insertCard({ origin: 'lasso' })).rejects.toThrow(/card_origin_chk/);
    await expect(insertCard({ front: 'nur Text' })).rejects.toThrow(/card_front_chk/);
    await expect(insertCard({ back: [] })).rejects.toThrow(/card_back_chk/);
    await expect(insertCard({ sources: [] })).rejects.toThrow(/card_sources_chk/);
    await expect(insertCard({ sources: { kind: 'slide' } })).rejects.toThrow(/card_sources_chk/);
    await expect(insertCard({ sources: Array(7).fill(SLIDE_SOURCE[0]) })).rejects.toThrow(/card_sources_chk/);
    await expect(insertCard({ item: uuidv7() })).rejects.toThrow(/card_inbox_item_chk/);
    await expect(insertCard({ concept: uuidv7() })).rejects.toThrow(/card_concept_id_concept_id_fk/);
    // Gegenproben: dieselbe Zeile mit gültigen Werten geht durch
    await insertCard({
      kind: 'cloze',
      front: { text_md: 'Ein {{c1::Beispielbegriff}} ist erfunden.' },
      back: { answers: { c1: ['Beispielbegriff'] } },
    });
    await insertCard({ origin: 'ki', item: uuidv7(), sources: Array(6).fill(SLIDE_SOURCE[0]) });
  });

  it('hält genau einen FSRS-Zustand je Karte und prüft ihn', async () => {
    const c = await insertCard();
    await expect(insertState(c, { state: 'gelernt', lastReview: new Date().toISOString() })).rejects.toThrow(
      /card_state_state_chk/,
    );
    await expect(insertState(c, { stability: -1 })).rejects.toThrow(/card_state_numbers_chk/);
    await expect(insertState(c, { reps: -1 })).rejects.toThrow(/card_state_numbers_chk/);
    await expect(insertState(c, { state: 'review' })).rejects.toThrow(/card_state_new_chk/);
    await expect(insertState(c, { lastReview: new Date().toISOString() })).rejects.toThrow(
      /card_state_new_chk/,
    );
    await insertState(c);
    await expect(insertState(c)).rejects.toThrow(/card_state_card_uq/);
    const other = await insertCard();
    await insertState(other, {
      state: 'review',
      lastReview: new Date().toISOString(),
      stability: 3.173,
      reps: 1,
    });
    // Doppelte Genauigkeit: der Wert kommt unverändert zurück
    const [row] = await sql`SELECT stability FROM card_state WHERE card_id = ${other}`;
    expect(row!.stability).toBe(3.173);
  });

  it('prüft Bewertungen: 1 bis 4, Dauer, Quelle, Kontext, Zustände', async () => {
    const c = await insertCard();
    await expect(insertReview(c, { rating: 0 })).rejects.toThrow(/review_log_rating_chk/);
    await expect(insertReview(c, { rating: 5 })).rejects.toThrow(/review_log_rating_chk/);
    await expect(insertReview(c, { duration: -1 })).rejects.toThrow(/review_log_duration_chk/);
    await expect(insertReview(c, { duration: 3_600_001 })).rejects.toThrow(/review_log_duration_chk/);
    await expect(insertReview(c, { source: 'ki_vorschlag_bestaetigt' })).rejects.toThrow(
      /review_log_rating_source_chk/,
    );
    await expect(insertReview(c, { context: 'lernsitzung' })).rejects.toThrow(/review_log_context_chk/);
    await expect(insertReview(c, { before: [] })).rejects.toThrow(/review_log_states_chk/);
    await insertReview(c, { rating: 1, duration: 0 });
    await insertReview(c, { rating: 4, duration: 3_600_000 });
  });

  it('nimmt beim endgültigen Löschen Zustand und Bewertungen mit der Karte und Karten mit dem Konzept mit', async () => {
    const conceptId = uuidv7();
    await sql`INSERT INTO concept (id, user_id, name, status) VALUES (${conceptId}, ${U}, 'Dritter Begriff', 'aktiv')`;
    const a = await insertCard({ concept: conceptId });
    const b = await insertCard({ concept: conceptId });
    await insertState(a);
    await insertReview(a);
    await insertState(b);
    await sql`DELETE FROM card WHERE id = ${a}`;
    expect(await count('card_state', 'card_id', a)).toBe(0);
    expect(await count('review_log', 'card_id', a)).toBe(0);
    expect(await count('card_state', 'card_id', b)).toBe(1);
    await sql`DELETE FROM concept WHERE id = ${conceptId}`;
    expect(await count('card', 'concept_id', conceptId)).toBe(0);
    expect(await count('card_state', 'card_id', b)).toBe(0);
  });

  it('behält angenommene Karten, wenn die Session endgültig gelöscht wird', async () => {
    const session = uuidv7();
    await sql`INSERT INTO session (id, user_id, module_id) VALUES (${session}, ${U}, ${moduleId})`;
    const batch = await insertBatch({ session });
    const c = await insertCard({ origin: 'ki', item: batch });
    await sql`DELETE FROM session WHERE id = ${session}`;
    expect(await count('inbox_item', 'id', batch)).toBe(0);
    expect(await count('card', 'id', c)).toBe(1);
  });
});

describe('Inbox-Art card_batch (VERTRAEGE §21.1, §21.7)', () => {
  it('verlangt Konzept und Session und schließt die anderen Verweise aus', async () => {
    await expect(insertBatch({ cardConcept: null })).rejects.toThrow(/inbox_item_refs_chk/);
    await expect(insertBatch({ session: null })).rejects.toThrow(/inbox_item_refs_chk/);
    await expect(insertBatch({ concept: activeId })).rejects.toThrow(/inbox_item_refs_chk/);
    await expect(insertBatch({ cardConcept: uuidv7() })).rejects.toThrow(
      /inbox_item_card_concept_id_concept_id_fk/,
    );
    await expect(insertBatch({ kind: 'slide_correction' })).rejects.toThrow(/inbox_item_kind_chk/);
    // Die anderen Arten dürfen card_concept_id nicht tragen
    await expect(insertBatch({ kind: 'concept_new', concept: activeId })).rejects.toThrow(
      /inbox_item_refs_chk/,
    );
  });

  it('erlaubt je Konzept und Session einen Eintrag, auch neben dem Eintrag des Vorschlags', async () => {
    await insertBatch();
    await expect(insertBatch()).rejects.toThrow(/inbox_item_card_batch_uq/);
    // Der Vorschlag hat schon seinen concept_new-Eintrag (inbox_item_concept_uq bleibt unberührt)
    const forProposal = await insertBatch({ cardConcept: proposalId });
    const other = uuidv7();
    await sql`INSERT INTO session (id, user_id, module_id) VALUES (${other}, ${U}, ${moduleId})`;
    await insertBatch({ session: other });
    // Wird der Vorschlag endgültig gelöscht (neuer Abgleich, §20.3), geht sein Kartenvorschlag mit
    await sql`DELETE FROM concept WHERE id = ${proposalId}`;
    expect(await count('inbox_item', 'id', forProposal)).toBe(0);
    expect(await count('inbox_item', 'id', oldItemId)).toBe(0);
  });
});
