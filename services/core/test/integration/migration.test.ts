import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID } from '@sg/shared';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { courseModule, semester, session } from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { testDatabaseUrl } from './helpers.ts';

let handle: DbHandle;
let sql: postgres.Sql;

beforeAll(() => {
  handle = createDb(testDatabaseUrl());
  sql = handle.sql;
});
afterAll(async () => {
  await handle.close();
});

const TABLES = [
  'semester',
  'module',
  'calendar_source',
  'calendar_event',
  'session',
  'slide_deck',
  'slide',
  'exercise_sheet',
  'task',
  'task_slide_link',
  'job',
  'setting',
  'device',
  'backup_run',
  'cost_entry',
];

describe('Migrationen', () => {
  it('haben Erweiterungen und alle Tabellen angelegt', async () => {
    const ext = await sql`SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pgcrypto')`;
    expect(ext.map((r) => r.extname).sort()).toEqual(['pgcrypto', 'vector']);

    const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    for (const table of TABLES) expect(tables.map((r) => r.tablename)).toContain(table);
  });

  it('sind idempotent (zweiter Lauf ändert nichts und wirft nicht)', async () => {
    await runMigrations(handle.db);
    await runMigrations(handle.db);
  });

  it('geben jeder Tabelle die Pflichtfelder aus 03 §1', async () => {
    const rows = await sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name IN ('id', 'user_id', 'created_at', 'updated_at', 'deleted_at')`;
    for (const table of TABLES) {
      const cols = rows.filter((r) => r.table_name === table).map((r) => r.column_name as string);
      const expected = [
        'user_id',
        'created_at',
        'updated_at',
        'deleted_at',
        ...(table === 'setting' ? [] : ['id']),
      ];
      expect(cols.sort(), table).toEqual(expected.sort());
    }
  });

  it('legt die Job-Tabelle genau nach VERTRAEGE §3 an', async () => {
    const cols = await sql`
      SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'job' ORDER BY ordinal_position`;
    const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
    expect(cols.map((c) => c.column_name)).toEqual([
      'id',
      'user_id',
      'created_at',
      'updated_at',
      'deleted_at',
      'type',
      'payload',
      'state',
      'priority',
      'attempts',
      'max_attempts',
      'depends_on',
      'session_id',
      'locked_by',
      'locked_at',
      'error',
      'result',
      'run_after',
    ]);
    expect(byName.state).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName.state.column_default).toContain("'wartet'");
    expect(byName.priority.column_default).toBe('0');
    expect(byName.attempts.column_default).toBe('0');
    expect(byName.max_attempts.column_default).toBe('3');
    expect(byName.depends_on).toMatchObject({ data_type: 'ARRAY', is_nullable: 'NO' });
    expect(byName.payload).toMatchObject({ data_type: 'jsonb', is_nullable: 'NO' });
    for (const nullable of [
      'deleted_at',
      'session_id',
      'locked_by',
      'locked_at',
      'error',
      'result',
      'run_after',
    ]) {
      expect(byName[nullable].is_nullable, nullable).toBe('YES');
    }

    const check = await sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'job'::regclass AND contype = 'c'`;
    expect(check[0]?.def).toContain("'wartet'");

    const [pick] = await sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'job_pick_idx'`;
    expect(pick?.indexdef).toMatch(/\(priority DESC, created_at\)/);
    expect(pick?.indexdef).toContain("state = 'wartet'");
  });

  it('legt HNSW-Indizes (Cosinus) für Embeddings an', async () => {
    const idx = await sql`SELECT indexname, indexdef FROM pg_indexes WHERE indexdef LIKE '%hnsw%'`;
    expect(idx.map((r) => r.indexname).sort()).toEqual(['slide_embedding_hnsw', 'task_embedding_hnsw']);
    for (const row of idx) expect(row.indexdef).toContain('vector_cosine_ops');
  });

  it('speichert Embeddings als vector(1024)', async () => {
    const cols = await sql`SELECT table_name, udt_name FROM information_schema.columns
      WHERE column_name = 'embedding' AND table_schema = 'public' ORDER BY table_name`;
    expect(cols.map((c) => `${c.table_name}:${c.udt_name}`)).toEqual(['slide:vector', 'task:vector']);
    const [dim] =
      await sql`SELECT atttypmod FROM pg_attribute WHERE attrelid = 'slide'::regclass AND attname = 'embedding'`;
    expect(dim?.atttypmod).toBe(1024);
  });

  it('ergänzt exercise_sheet um ingest_state, page_count und title (VERTRAEGE/Ticket)', async () => {
    const cols = await sql`SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'exercise_sheet' AND table_schema = 'public'`;
    const byName = Object.fromEntries(cols.map((c) => [c.column_name, c.is_nullable]));
    expect(byName.page_count).toBe('YES');
    expect(byName.title).toBe('NO');
    expect(byName.ingest_state).toBe('NO');
    const sem = await sql`SELECT column_name FROM information_schema.columns
      WHERE table_name = 'semester' AND column_name = 'archived_at'`;
    expect(sem).toHaveLength(1);
  });

  it('setzt updated_at bei Änderungen automatisch', async () => {
    const id = uuidv7();
    await handle.db.insert(semester).values({ id, userId: SINGLE_USER_ID, name: 'HS 2026' });
    const [before] = await sql`SELECT updated_at FROM semester WHERE id = ${id}`;
    await sql`SELECT pg_sleep(0.02)`;
    await sql`UPDATE semester SET name = 'HS 2027' WHERE id = ${id}`;
    const [after] = await sql`SELECT updated_at FROM semester WHERE id = ${id}`;
    expect(new Date(String(after?.updated_at)).getTime()).toBeGreaterThan(
      new Date(String(before?.updated_at)).getTime(),
    );
  });

  it('erlaubt höchstens eine laufende Session (03 §14.1)', async () => {
    const semesterId = uuidv7();
    const moduleId = uuidv7();
    await handle.db.insert(semester).values({ id: semesterId, userId: SINGLE_USER_ID, name: 'Invariante' });
    await handle.db.insert(courseModule).values({
      id: moduleId,
      userId: SINGLE_USER_ID,
      semesterId,
      name: 'DBS',
      color: 'mod-01',
    });
    const base = { userId: SINGLE_USER_ID, moduleId };

    await handle.db.insert(session).values({ id: uuidv7(), ...base, state: 'laeuft' });
    // weitere Sessions in anderen Zuständen sind fein
    await handle.db.insert(session).values({ id: uuidv7(), ...base, state: 'geplant' });
    await handle.db.insert(session).values({ id: uuidv7(), ...base, state: 'pausiert' });
    // eine zweite laufende nicht
    await expect(
      handle.db.insert(session).values({ id: uuidv7(), ...base, state: 'laeuft' }),
    ).rejects.toThrow();
    // eine weich gelöschte laufende Session zählt nicht
    await handle.db.insert(session).values({ id: uuidv7(), ...base, state: 'laeuft', deletedAt: new Date() });
  });

  it('erlaubt höchstens ein aktuelles Semester und prüft Modulfarben', async () => {
    await handle.db
      .insert(semester)
      .values({ id: uuidv7(), userId: SINGLE_USER_ID, name: 'A', isCurrent: true });
    await expect(
      handle.db.insert(semester).values({ id: uuidv7(), userId: SINGLE_USER_ID, name: 'B', isCurrent: true }),
    ).rejects.toThrow();

    const [sem] = await handle.db.select().from(semester).limit(1);
    await expect(
      handle.db.insert(courseModule).values({
        id: uuidv7(),
        userId: SINGLE_USER_ID,
        semesterId: sem!.id,
        name: 'X',
        color: 'rot',
      }),
    ).rejects.toThrow();
  });

  it('liest numeric-Spalten als Zahl (module.ects)', async () => {
    const [sem] = await handle.db.select().from(semester).limit(1);
    const id = uuidv7();
    await handle.db.insert(courseModule).values({
      id,
      userId: SINGLE_USER_ID,
      semesterId: sem!.id,
      name: 'Mathe',
      color: 'mod-02',
      ects: 4.5,
    });
    const [row] = await handle.db.select().from(courseModule).where(eq(courseModule.id, id));
    expect(row?.ects).toBe(4.5);
    expect(typeof row?.ects).toBe('number');
  });
});
