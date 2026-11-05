import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID } from '@sg/shared';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import {
  calendarEvent,
  courseModule,
  exerciseSheet,
  semester,
  session,
  slide,
  slideDeck,
  task,
  taskSlideLink,
} from '../../src/db/schema/index.ts';
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
  // Phase 1 (T1-DB, VERTRAEGE §6.1)
  'slide_event',
  'marker',
  'photo',
  'recording',
  'audio_chunk',
  'notebook',
  'page',
  'stroke',
  'page_element',
  // Moodle-Abgleich (T1-23, 08 §9.4)
  'moodle_course_link',
  'moodle_item',
  'moodle_deadline',
];

/** Phase-1-Tabellen ohne die Pflichtfelder aus 03 §1 (Struktur genau nach VERTRAEGE §6.1) */
const SYNC_TABLES = ['sync_stream', 'sync_op', 'sync_meta'];

describe('Migrationen', () => {
  it('haben Erweiterungen und alle Tabellen angelegt', async () => {
    const ext = await sql`SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pgcrypto')`;
    expect(ext.map((r) => r.extname).sort()).toEqual(['pgcrypto', 'vector']);

    const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    for (const table of [...TABLES, ...SYNC_TABLES]) expect(tables.map((r) => r.tablename)).toContain(table);
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

  it('erlaubt höchstens eine aktive Session, laeuft und pausiert zusammen (03 §14.1, VERTRAEGE §9.1)', async () => {
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

    const running = uuidv7();
    await handle.db.insert(session).values({ id: running, ...base, state: 'laeuft' });
    // weitere Sessions in nicht aktiven Zuständen sind fein
    await handle.db.insert(session).values({ id: uuidv7(), ...base, state: 'geplant' });
    await handle.db.insert(session).values({ id: uuidv7(), ...base, state: 'beendet' });
    // eine zweite laufende oder pausierte nicht
    await expect(
      handle.db.insert(session).values({ id: uuidv7(), ...base, state: 'laeuft' }),
    ).rejects.toThrow();
    await expect(
      handle.db.insert(session).values({ id: uuidv7(), ...base, state: 'pausiert' }),
    ).rejects.toThrow();
    // eine weich gelöschte laufende Session zählt nicht
    await handle.db.insert(session).values({ id: uuidv7(), ...base, state: 'laeuft', deletedAt: new Date() });
    await sql`UPDATE session SET state = 'beendet' WHERE id = ${running}`;
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

  describe('Fremdschlüssel und Invarianten', () => {
    async function seedModule() {
      const semesterId = uuidv7();
      const moduleId = uuidv7();
      await handle.db
        .insert(semester)
        .values({ id: semesterId, userId: SINGLE_USER_ID, name: `S ${semesterId}` });
      await handle.db.insert(courseModule).values({
        id: moduleId,
        userId: SINGLE_USER_ID,
        semesterId,
        name: 'M',
        color: 'mod-03',
      });
      return { semesterId, moduleId };
    }
    const base = { userId: SINGLE_USER_ID };

    it('nimmt beim endgültigen Löschen eines Foliensatzes Folien und Verknüpfungen mit (CASCADE)', async () => {
      const { moduleId } = await seedModule();
      const deckId = uuidv7();
      const slideId = uuidv7();
      const sheetId = uuidv7();
      const taskId = uuidv7();
      await handle.db.insert(slideDeck).values({
        id: deckId,
        ...base,
        moduleId,
        title: 'D',
        filePath: 'media/decks/x/original.pdf',
        sha256: 'a'.repeat(64),
      });
      await handle.db
        .insert(slide)
        .values({ id: slideId, ...base, deckId, index: 1, widthPt: 720, heightPt: 540 });
      await handle.db.insert(exerciseSheet).values({
        id: sheetId,
        ...base,
        moduleId,
        title: 'Blatt',
        filePath: 'media/sheets/x/original.pdf',
        sha256: 'b'.repeat(64),
      });
      await handle.db.insert(task).values({ id: taskId, ...base, sheetId, label: '1a', pageIndex: 1 });
      await handle.db.insert(taskSlideLink).values({
        id: uuidv7(),
        ...base,
        taskId,
        slideId,
        relevance: 0.5,
        reason: 'passt',
        source: 'auto',
      });

      await handle.db.delete(slideDeck).where(eq(slideDeck.id, deckId));
      expect(await handle.db.select().from(slide).where(eq(slide.id, slideId))).toHaveLength(0);
      expect(await handle.db.select().from(taskSlideLink)).toHaveLength(0);
      expect(await handle.db.select().from(task).where(eq(task.id, taskId))).toHaveLength(1);

      await handle.db.delete(exerciseSheet).where(eq(exerciseSheet.id, sheetId));
      expect(await handle.db.select().from(task).where(eq(task.id, taskId))).toHaveLength(0);
    });

    it('verbietet das Löschen eines Moduls mit Foliensätzen (RESTRICT) und eines Semesters mit Modulen', async () => {
      const { moduleId, semesterId } = await seedModule();
      await handle.db.insert(slideDeck).values({
        id: uuidv7(),
        ...base,
        moduleId,
        title: 'D',
        filePath: 'p',
        sha256: 'c'.repeat(64),
      });
      await expect(handle.db.delete(courseModule).where(eq(courseModule.id, moduleId))).rejects.toThrow();
      await expect(handle.db.delete(semester).where(eq(semester.id, semesterId))).rejects.toThrow();
    });

    it('setzt optionale Verweise auf NULL (SET NULL)', async () => {
      const { moduleId } = await seedModule();
      const eventId = uuidv7();
      const deckId = uuidv7();
      const sessionId = uuidv7();
      await handle.db.insert(calendarEvent).values({
        id: eventId,
        ...base,
        moduleId,
        kind: 'vorlesung',
        title: 'VL',
        startsAt: new Date(),
        endsAt: new Date(),
      });
      await handle.db.insert(slideDeck).values({
        id: deckId,
        ...base,
        moduleId,
        title: 'D',
        filePath: 'p',
        sha256: 'd'.repeat(64),
      });
      await handle.db.insert(session).values({
        id: sessionId,
        ...base,
        moduleId,
        calendarEventId: eventId,
        slideDeckId: deckId,
      });
      await handle.db.update(slideDeck).set({ sessionId }).where(eq(slideDeck.id, deckId));

      await handle.db.delete(calendarEvent).where(eq(calendarEvent.id, eventId));
      await handle.db.delete(slideDeck).where(eq(slideDeck.id, deckId));
      const [row] = await handle.db.select().from(session).where(eq(session.id, sessionId));
      expect(row).toMatchObject({ calendarEventId: null, slideDeckId: null });
    });

    it('lässt cost_entry ohne Job zu und setzt job_id beim Löschen des Jobs auf NULL', async () => {
      const jobId = uuidv7();
      const costId = uuidv7();
      await sql`INSERT INTO job (id, user_id, type) VALUES (${jobId}, ${SINGLE_USER_ID}, 'pdf.ingest')`;
      await sql`INSERT INTO cost_entry (id, user_id, job_id, provider, model, task)
        VALUES (${costId}, ${SINGLE_USER_ID}, ${jobId}, 'p', 'm', 't')`;
      await sql`DELETE FROM job WHERE id = ${jobId}`;
      const [row] = await sql`SELECT job_id FROM cost_entry WHERE id = ${costId}`;
      expect(row?.job_id).toBeNull();
    });

    it('erlaubt höchstens eine Session pro Kalendertermin (1─0..1)', async () => {
      const { moduleId } = await seedModule();
      const eventId = uuidv7();
      await handle.db.insert(calendarEvent).values({
        id: eventId,
        ...base,
        moduleId,
        kind: 'vorlesung',
        title: 'VL',
        startsAt: new Date(),
        endsAt: new Date(),
      });
      await handle.db.insert(session).values({ id: uuidv7(), ...base, moduleId, calendarEventId: eventId });
      await expect(
        handle.db.insert(session).values({ id: uuidv7(), ...base, moduleId, calendarEventId: eventId }),
      ).rejects.toThrow();
      // spontane Sessions (ohne Termin) gibt es beliebig viele
      await handle.db.insert(session).values({ id: uuidv7(), ...base, moduleId });
      await handle.db.insert(session).values({ id: uuidv7(), ...base, moduleId });
      // weich gelöschte Session gibt den Termin frei
      await sql`UPDATE session SET deleted_at = now() WHERE calendar_event_id = ${eventId}`;
      await handle.db.insert(session).values({ id: uuidv7(), ...base, moduleId, calendarEventId: eventId });
    });

    it('legt die Tabelle idempotency_key an', async () => {
      const cols = await sql`SELECT column_name FROM information_schema.columns
        WHERE table_name = 'idempotency_key' ORDER BY column_name`;
      expect(cols.map((c) => c.column_name)).toEqual([
        'created_at',
        'key',
        'method',
        'path',
        'request_hash',
        'response',
        'status',
      ]);
    });
  });
});
