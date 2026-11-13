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
  // Transkript und Rückblick (T2-01, VERTRAEGE §18.1)
  'transcript',
  'transcript_segment',
  'slide_segment',
  // Automatische Kurszuordnung (#141)
  'moodle_course_decided',
  // Suchindex (T2-10, VERTRAEGE §19.1)
  'search_chunk',
  // Konzepte, Inbox, Zusammenfassung (T2-20, VERTRAEGE §20.1)
  'concept',
  'concept_module',
  'concept_relation',
  'evidence',
  'inbox_item',
  'session_summary',
  // Karten und Wiederholung (B0, VERTRAEGE §21.1)
  'card',
  'card_state',
  'review_log',
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
    expect(idx.map((r) => r.indexname).sort()).toEqual([
      'concept_embedding_hnsw', // T2-20 (VERTRAEGE §20.1)
      'search_chunk_embedding_hnsw', // T2-10 (VERTRAEGE §19.1)
      'slide_embedding_hnsw',
      'task_embedding_hnsw',
    ]);
    for (const row of idx) expect(row.indexdef).toContain('vector_cosine_ops');
  });

  it('speichert Embeddings als vector(1024)', async () => {
    const cols = await sql`SELECT table_name, udt_name FROM information_schema.columns
      WHERE column_name = 'embedding' AND table_schema = 'public' ORDER BY table_name`;
    expect(cols.map((c) => `${c.table_name}:${c.udt_name}`)).toEqual([
      'concept:vector', // T2-20 (VERTRAEGE §20.1)
      'search_chunk:vector', // T2-10 (VERTRAEGE §19.1)
      'slide:vector',
      'task:vector',
      'transcript_segment:vector', // T2-01, noch ohne Index (VERTRAEGE §18.1)
    ]);
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

describe('search_chunk (T2-10, VERTRAEGE §19.1)', () => {
  const H = 'a'.repeat(64);
  let deckId: string;
  let sessionId: string;

  beforeAll(async () => {
    const semesterId = uuidv7();
    const moduleId = uuidv7();
    deckId = uuidv7();
    sessionId = uuidv7();
    await sql`INSERT INTO semester (id, user_id, name) VALUES (${semesterId}, ${SINGLE_USER_ID}, 'Suche-Test')`;
    await sql`INSERT INTO module (id, user_id, semester_id, name, color)
      VALUES (${moduleId}, ${SINGLE_USER_ID}, ${semesterId}, 'Datenbanksysteme', 'mod-01')`;
    await sql`INSERT INTO slide_deck (id, user_id, module_id, title, file_path, sha256)
      VALUES (${deckId}, ${SINGLE_USER_ID}, ${moduleId}, 'VL 7', ${'media/decks/' + deckId + '/original.pdf'}, ${H})`;
    await sql`INSERT INTO session (id, user_id, module_id) VALUES (${sessionId}, ${SINGLE_USER_ID}, ${moduleId})`;
  });

  const slideRow = (over: Record<string, unknown> = {}) => ({
    id: uuidv7(),
    kind: 'slide',
    source: uuidv7(),
    part: 0,
    deck: deckId as string | null,
    sess: null as string | null,
    idx: 1 as number | null,
    t: null as number | null,
    tEnd: null as number | null,
    cfg: 'german',
    text: 'Die dritte Normalform verbietet transitive Abhängigkeiten',
    hash: H,
    ...over,
  });

  async function insert(r: ReturnType<typeof slideRow>) {
    await sql`INSERT INTO search_chunk (id, user_id, source_kind, source_id, part, deck_id, session_id, slide_index,
        t_ms, t_end_ms, text, ts_config, tsv, content_hash, index_version)
      VALUES (${r.id}, ${SINGLE_USER_ID}, ${r.kind}, ${r.source}, ${r.part}, ${r.deck}, ${r.sess}, ${r.idx},
        ${r.t}, ${r.tEnd}, ${r.text}, ${r.cfg},
        to_tsvector(${r.cfg}::regconfig, ${r.text}) || to_tsvector('simple', ${r.text}), ${r.hash}, 1)`;
  }

  it('nimmt Folien- und Transkript-Einträge an und findet sie über to_tsquery mit mehreren Konfigurationen', async () => {
    await insert(slideRow());
    await insert(
      slideRow({
        kind: 'transcript',
        source: sessionId,
        deck: null,
        sess: sessionId,
        idx: null,
        t: 2_512_000,
        tEnd: 2_571_000,
        text: 'und das ist eben die dritte Normalform, das kommt auch in der Klausur',
      }),
    );
    const rows = await sql`SELECT source_kind FROM search_chunk
      WHERE tsv @@ (to_tsquery('german', 'normalform:*') || to_tsquery('english', 'normalform:*')
                    || to_tsquery('simple', 'normalform:*'))
      ORDER BY source_kind`;
    expect(rows.map((r) => r.source_kind)).toEqual(['slide', 'transcript']);
  });

  it('findet halb getippte Wörter über den simple-Teil von tsv (§19.1)', async () => {
    await insert(slideRow({ text: 'Vorlesungen zur Normalisierung von Datenbanken' }));
    for (const prefix of ['vorles', 'vorlesu', 'vorlesun', 'normalisieru', 'datenba']) {
      const rows = await sql`SELECT 1 FROM search_chunk
        WHERE tsv @@ (to_tsquery('german', ${prefix + ':*'}) || to_tsquery('english', ${prefix + ':*'})
                      || to_tsquery('simple', ${prefix + ':*'}))`;
      expect(rows.length, prefix).toBeGreaterThan(0);
    }
  });

  it('weist falsche Eltern, Zeiten, Konfigurationen und Vektor ohne Modell ab', async () => {
    await expect(insert(slideRow({ sess: sessionId }))).rejects.toThrow(/search_chunk_parent_chk/);
    await expect(insert(slideRow({ deck: null }))).rejects.toThrow(/search_chunk_parent_chk/);
    await expect(insert(slideRow({ idx: null }))).rejects.toThrow(/search_chunk_parent_chk/);
    await expect(insert(slideRow({ part: 1 }))).rejects.toThrow(/search_chunk_parent_chk/);
    await expect(insert(slideRow({ t: 0, tEnd: 1 }))).rejects.toThrow(/search_chunk_parent_chk/);
    const tr = { kind: 'transcript', source: sessionId, deck: null, sess: sessionId, idx: null, part: 7 };
    await expect(insert(slideRow({ ...tr, t: 5, tEnd: 4 }))).rejects.toThrow(/search_chunk_parent_chk/);
    await expect(insert(slideRow({ ...tr, source: uuidv7(), t: 0, tEnd: 1 }))).rejects.toThrow(
      /search_chunk_parent_chk/,
    );
    await expect(insert(slideRow({ cfg: 'french' }))).rejects.toThrow(/search_chunk_ts_config_chk/);
    await expect(insert(slideRow({ text: '' }))).rejects.toThrow(/search_chunk_text_chk/);
    await expect(insert(slideRow({ text: 'x'.repeat(8001) }))).rejects.toThrow(/search_chunk_text_chk/);
    await expect(insert(slideRow({ text: 'mit \u0001 Steuerzeichen' }))).rejects.toThrow(
      /search_chunk_text_cntrl_chk/,
    );
    await expect(insert(slideRow({ text: 'zwei\nZeilen' }))).rejects.toThrow(/search_chunk_text_cntrl_chk/);
    await expect(insert(slideRow({ hash: 'A'.repeat(64) }))).rejects.toThrow(/search_chunk_content_hash_chk/);
    await expect(insert(slideRow({ idx: 0 }))).rejects.toThrow(/search_chunk_parent_chk/);
    await insert(slideRow({ text: 'x'.repeat(8000) }));
    const vec = `[${Array.from({ length: 1024 }, () => 0.01).join(',')}]`;
    await expect(
      sql`INSERT INTO search_chunk (id, user_id, source_kind, source_id, part, deck_id, slide_index, text, ts_config,
          tsv, embedding, content_hash, index_version)
        VALUES (${uuidv7()}, ${SINGLE_USER_ID}, 'slide', ${uuidv7()}, 0, ${deckId}, 1, 'x', 'simple',
          to_tsvector('simple', 'x'), ${vec}::vector, ${H}, 1)`,
    ).rejects.toThrow(/search_chunk_embedding_model_chk/);
  });

  it('ist je (source_kind, source_id, part) eindeutig und verschwindet mit dem Foliensatz', async () => {
    const r = slideRow();
    await insert(r);
    await expect(insert({ ...r, id: uuidv7() })).rejects.toThrow(/search_chunk_source_uq/);
    const otherDeck = uuidv7();
    const [mod] = await sql`SELECT module_id FROM slide_deck WHERE id = ${deckId}`;
    await sql`INSERT INTO slide_deck (id, user_id, module_id, title, file_path, sha256)
      VALUES (${otherDeck}, ${SINGLE_USER_ID}, ${mod!.module_id}, 'weg', ${'media/decks/' + otherDeck + '/original.pdf'}, ${H})`;
    await insert(slideRow({ deck: otherDeck }));
    await sql`DELETE FROM slide_deck WHERE id = ${otherDeck}`;
    const [cnt] = await sql`SELECT count(*)::int AS n FROM search_chunk WHERE deck_id = ${otherDeck}`;
    expect(cnt!.n).toBe(0);
  });

  it('verschwindet mit der Session und pflegt updated_at', async () => {
    const otherSession = uuidv7();
    const [mod] = await sql`SELECT module_id FROM slide_deck WHERE id = ${deckId}`;
    await sql`INSERT INTO session (id, user_id, module_id) VALUES (${otherSession}, ${SINGLE_USER_ID}, ${mod!.module_id})`;
    const r = slideRow({
      kind: 'transcript',
      source: otherSession,
      deck: null,
      sess: otherSession,
      idx: null,
      t: 0,
      tEnd: 10,
    });
    await insert(r);
    const [before] =
      await sql`SELECT extract(epoch FROM updated_at)::float8 AS t FROM search_chunk WHERE id = ${r.id}`;
    await sql`SELECT pg_sleep(0.01)`;
    await sql`UPDATE search_chunk SET part = 1 WHERE id = ${r.id}`;
    const [after] =
      await sql`SELECT extract(epoch FROM updated_at)::float8 AS t FROM search_chunk WHERE id = ${r.id}`;
    expect(after!.t).toBeGreaterThan(before!.t);
    await sql`DELETE FROM session WHERE id = ${otherSession}`;
    const [cnt] = await sql`SELECT count(*)::int AS n FROM search_chunk WHERE session_id = ${otherSession}`;
    expect(cnt!.n).toBe(0);
  });
});

describe('Konzepte, Inbox, Zusammenfassung (T2-20, VERTRAEGE §20.1)', () => {
  const H = 'b'.repeat(64);
  let moduleId: string;
  let sessionId: string;

  beforeAll(async () => {
    const semesterId = uuidv7();
    moduleId = uuidv7();
    sessionId = uuidv7();
    await sql`INSERT INTO semester (id, user_id, name) VALUES (${semesterId}, ${SINGLE_USER_ID}, 'Konzepte-Test')`;
    await sql`INSERT INTO module (id, user_id, semester_id, name, color)
      VALUES (${moduleId}, ${SINGLE_USER_ID}, ${semesterId}, 'Datenbanksysteme', 'mod-02')`;
    await sql`INSERT INTO session (id, user_id, module_id) VALUES (${sessionId}, ${SINGLE_USER_ID}, ${moduleId})`;
  });

  async function newSession(): Promise<string> {
    const id = uuidv7();
    await sql`INSERT INTO session (id, user_id, module_id) VALUES (${id}, ${SINGLE_USER_ID}, ${moduleId})`;
    return id;
  }

  interface ConceptRow {
    id: string;
    name: string;
    status: string;
    proposal: string | null;
    merged: string | null;
    kind: string | null;
  }

  async function insertConcept(over: Partial<ConceptRow> = {}): Promise<string> {
    const r: ConceptRow = {
      id: uuidv7(),
      name: 'Dritte Normalform (3NF)',
      status: 'aktiv',
      proposal: null,
      merged: null,
      kind: 'definition',
      ...over,
    };
    await sql`INSERT INTO concept (id, user_id, name, status, proposal_session_id, merged_into, kind)
      VALUES (${r.id}, ${SINGLE_USER_ID}, ${r.name}, ${r.status}, ${r.proposal}, ${r.merged}, ${r.kind})`;
    return r.id;
  }

  interface RelationRow {
    id: string;
    kind: string;
    confirmed: boolean;
    proposal: string | null;
  }

  async function insertRelation(from: string, to: string, over: Partial<RelationRow> = {}): Promise<string> {
    const r: RelationRow = { id: uuidv7(), kind: 'baut_auf', confirmed: true, proposal: null, ...over };
    await sql`INSERT INTO concept_relation (id, user_id, from_id, to_id, kind, source, confirmed, proposal_session_id)
      VALUES (${r.id}, ${SINGLE_USER_ID}, ${from}, ${to}, ${r.kind}, 'ki', ${r.confirmed}, ${r.proposal})`;
    return r.id;
  }

  interface EvidenceRow {
    id: string;
    kind: string;
    session: string | null;
    ref: string;
    t: number | null;
    tEnd: number | null;
    deleted: string | null;
  }

  async function insertEvidence(conceptId: string, over: Partial<EvidenceRow> = {}): Promise<string> {
    const r: EvidenceRow = {
      id: uuidv7(),
      kind: 'transcript',
      session: sessionId,
      ref: sessionId,
      t: 1000,
      tEnd: 2000,
      deleted: null,
      ...over,
    };
    await sql`INSERT INTO evidence (id, user_id, concept_id, session_id, kind, ref_id, t_start_ms, t_end_ms, deleted_at)
      VALUES (${r.id}, ${SINGLE_USER_ID}, ${conceptId}, ${r.session}, ${r.kind}, ${r.ref}, ${r.t}, ${r.tEnd},
        ${r.deleted})`;
    return r.id;
  }

  interface ItemRow {
    id: string;
    kind: string;
    payloadKind: string;
    status: string;
    decided: string | null;
    concept: string | null;
    target: string | null;
    relation: string | null;
    session: string | null;
  }

  async function insertItem(over: Partial<ItemRow> = {}): Promise<string> {
    const r: ItemRow = {
      id: uuidv7(),
      kind: 'concept_new',
      payloadKind: over.kind ?? 'concept_new',
      status: 'offen',
      decided: null,
      concept: null,
      target: null,
      relation: null,
      session: sessionId,
      ...over,
    };
    await sql`INSERT INTO inbox_item (id, user_id, kind, session_id, payload, status, decided_at, concept_id,
        target_concept_id, relation_id)
      VALUES (${r.id}, ${SINGLE_USER_ID}, ${r.kind}, ${r.session}, ${JSON.stringify({ kind: r.payloadKind })}::jsonb,
        ${r.status}, ${r.decided}, ${r.concept}, ${r.target}, ${r.relation})`;
    return r.id;
  }

  async function count(table: string, column: string, value: string): Promise<number> {
    const [row] = await sql`SELECT count(*)::int AS n FROM ${sql(table)} WHERE ${sql(column)} = ${value}`;
    return row!.n as number;
  }

  it('prüft Status, Vorschlags-Session, Zusammenführung, Art, Name und Vektor am Konzept', async () => {
    await expect(insertConcept({ status: 'vorschlag' })).rejects.toThrow(/concept_proposal_chk/);
    await expect(insertConcept({ status: 'aktiv', proposal: sessionId })).rejects.toThrow(
      /concept_proposal_chk/,
    );
    await expect(insertConcept({ status: 'zusammengefuehrt' })).rejects.toThrow(/concept_merged_chk/);
    const target = await insertConcept();
    await expect(insertConcept({ status: 'aktiv', merged: target })).rejects.toThrow(/concept_merged_chk/);
    const self = uuidv7();
    await expect(insertConcept({ id: self, status: 'zusammengefuehrt', merged: self })).rejects.toThrow(
      /concept_merged_chk/,
    );
    await expect(insertConcept({ status: 'geprueft' })).rejects.toThrow(/concept_status_chk/);
    await expect(insertConcept({ kind: 'formel' })).rejects.toThrow(/concept_kind_chk/);
    await expect(insertConcept({ name: '' })).rejects.toThrow(/concept_name_chk/);
    await expect(insertConcept({ name: 'mit\nUmbruch' })).rejects.toThrow(/concept_name_chk/);
    await insertConcept({ status: 'vorschlag', proposal: sessionId, kind: null });
    await insertConcept({ status: 'zusammengefuehrt', merged: target, proposal: sessionId });
    const vec = `[${Array.from({ length: 1024 }, () => 0.01).join(',')}]`;
    await expect(
      sql`INSERT INTO concept (id, user_id, name, status, embedding)
        VALUES (${uuidv7()}, ${SINGLE_USER_ID}, 'x', 'aktiv', ${vec}::vector)`,
    ).rejects.toThrow(/concept_embedding_model_chk/);
  });

  it('prüft Beziehungen: keine Schleife, symmetrische Arten sortiert, bestätigt ohne Session, eindeutig', async () => {
    const [a, b] = [await insertConcept({ name: 'A' }), await insertConcept({ name: 'B' })].sort() as [
      string,
      string,
    ];
    await expect(insertRelation(a, a)).rejects.toThrow(/concept_relation_self_chk/);
    await expect(insertRelation(b, a, { kind: 'verwandt' })).rejects.toThrow(
      /concept_relation_symmetric_chk/,
    );
    await expect(insertRelation(a, b, { kind: 'teil_von' })).rejects.toThrow(/concept_relation_kind_chk/);
    await expect(insertRelation(a, b, { confirmed: false })).rejects.toThrow(
      /concept_relation_confirmed_chk/,
    );
    await expect(insertRelation(a, b, { proposal: sessionId })).rejects.toThrow(
      /concept_relation_confirmed_chk/,
    );
    await insertRelation(a, b, { kind: 'verwandt' });
    const rel = await insertRelation(b, a);
    await expect(insertRelation(b, a)).rejects.toThrow(/concept_relation_uq/);
    await sql`UPDATE concept_relation SET deleted_at = now() WHERE id = ${rel}`;
    await insertRelation(b, a, { confirmed: false, proposal: sessionId });
  });

  it('prüft Belege: Zeitraum nur und vollständig bei transcript, Verweis auf die Session, keine Dubletten', async () => {
    const c = await insertConcept();
    await expect(insertEvidence(c, { t: null })).rejects.toThrow(/evidence_times_chk/);
    await expect(insertEvidence(c, { t: 5, tEnd: 4 })).rejects.toThrow(/evidence_times_chk/);
    await expect(insertEvidence(c, { ref: uuidv7() })).rejects.toThrow(/evidence_times_chk/);
    await expect(insertEvidence(c, { kind: 'slide', ref: uuidv7() })).rejects.toThrow(/evidence_times_chk/);
    await expect(insertEvidence(c, { kind: 'video', t: null, tEnd: null })).rejects.toThrow(
      /evidence_kind_chk/,
    );
    const slideId = uuidv7();
    const slideEvidence = { kind: 'slide', ref: slideId, t: null, tEnd: null };
    await insertEvidence(c, slideEvidence);
    await expect(insertEvidence(c, slideEvidence)).rejects.toThrow(/evidence_dedupe_uq/);
    // Gleiche Folie aus einer anderen Session und ein gelöschter Doppelgänger sind erlaubt
    await insertEvidence(c, { ...slideEvidence, session: await newSession() });
    await insertEvidence(c, { ...slideEvidence, deleted: new Date().toISOString() });
    await insertEvidence(c);
    await expect(insertEvidence(c)).rejects.toThrow(/evidence_dedupe_uq/);
  });

  it('prüft Inbox-Einträge: Verweise je Art, Entscheidung, Art der Nutzlast, ein Eintrag je Vorschlag', async () => {
    const p = await insertConcept({ status: 'vorschlag', proposal: sessionId });
    const t = await insertConcept();
    await expect(insertItem({ concept: null })).rejects.toThrow(/inbox_item_refs_chk/);
    await expect(insertItem({ concept: p, target: t })).rejects.toThrow(/inbox_item_refs_chk/);
    await expect(insertItem({ kind: 'concept_merge', concept: p })).rejects.toThrow(/inbox_item_refs_chk/);
    await expect(insertItem({ concept: p, status: 'angenommen' })).rejects.toThrow(/inbox_item_decided_chk/);
    await expect(insertItem({ concept: p, decided: new Date().toISOString() })).rejects.toThrow(
      /inbox_item_decided_chk/,
    );
    await expect(insertItem({ concept: p, payloadKind: 'relation' })).rejects.toThrow(
      /inbox_item_payload_kind_chk/,
    );
    await expect(insertItem({ kind: 'summary', concept: p })).rejects.toThrow(/inbox_item_kind_chk/);
    await insertItem({ concept: p });
    await expect(insertItem({ concept: p })).rejects.toThrow(/inbox_item_concept_uq/);
    const rel = await insertRelation(p, t, { confirmed: false, proposal: sessionId });
    await insertItem({ kind: 'relation', relation: rel });
    await expect(
      sql`UPDATE inbox_item SET decision = '{}'::jsonb WHERE relation_id = ${rel}`,
    ).rejects.toThrow(/inbox_item_decided_chk/);
    await sql`UPDATE inbox_item SET status = 'abgelehnt', decided_at = now(), decision = '{}'::jsonb
      WHERE relation_id = ${rel}`;
  });

  it('hält eine Zusammenfassung je Session mit 1 bis 5 Sätzen', async () => {
    const s = await newSession();
    const sentence = { text: 'Ein Satz.', sources: [] };
    const insert = (sentences: unknown[]) =>
      sql`INSERT INTO session_summary (id, user_id, session_id, sentences, provider, model, prompt_version, input_hash)
        VALUES (${uuidv7()}, ${SINGLE_USER_ID}, ${s}, ${JSON.stringify(sentences)}::jsonb, 'fake', 'fake-llm-1',
          'summary.write/v1', ${H})`;
    await expect(insert([])).rejects.toThrow(/session_summary_sentences_chk/);
    await expect(insert(Array.from({ length: 6 }, () => sentence))).rejects.toThrow(
      /session_summary_sentences_chk/,
    );
    await insert([sentence]);
    await expect(insert([sentence])).rejects.toThrow(/session_summary_session_uq/);
  });

  it('nimmt beim endgültigen Löschen der Session Vorschläge, Belege, Einträge und Zusammenfassung mit, nie aktive Konzepte', async () => {
    const s = await newSession();
    const active = await insertConcept({ name: 'Funktionale Abhängigkeit' });
    const proposal = await insertConcept({ name: 'Zweite Normalform', status: 'vorschlag', proposal: s });
    const husk = await insertConcept({ status: 'zusammengefuehrt', merged: active, proposal: s });
    const rel = await insertRelation(proposal, active, { confirmed: false, proposal: s });
    const kept = await insertRelation(active, await insertConcept({ name: 'Relation' }));
    const ev = await insertEvidence(active, { session: s, ref: s });
    await insertItem({ concept: proposal, session: s });
    await insertItem({ kind: 'relation', relation: rel, session: s });
    await sql`INSERT INTO session_summary (id, user_id, session_id, sentences, provider, model, prompt_version, input_hash)
      VALUES (${uuidv7()}, ${SINGLE_USER_ID}, ${s}, '[{"text":"x","sources":[]}]'::jsonb, 'fake', 'fake-llm-1',
        'summary.write/v1', ${H})`;
    await sql`INSERT INTO concept_module (id, user_id, concept_id, module_id)
      VALUES (${uuidv7()}, ${SINGLE_USER_ID}, ${active}, ${moduleId})`;

    await sql`DELETE FROM session WHERE id = ${s}`;

    expect(await count('concept', 'id', proposal)).toBe(0);
    expect(await count('concept', 'id', husk)).toBe(0);
    expect(await count('concept', 'id', active)).toBe(1);
    expect(await count('concept_relation', 'id', rel)).toBe(0);
    expect(await count('concept_relation', 'id', kept)).toBe(1);
    expect(await count('evidence', 'id', ev)).toBe(0);
    expect(await count('inbox_item', 'session_id', s)).toBe(0);
    expect(await count('session_summary', 'session_id', s)).toBe(0);
    expect(await count('concept_module', 'concept_id', active)).toBe(1);
  });

  it('löscht mit einem Modul nur die Zuordnung, mit einem Konzept Hüllen, Belege und Beziehungen', async () => {
    const semesterId = uuidv7();
    const otherModule = uuidv7();
    await sql`INSERT INTO semester (id, user_id, name) VALUES (${semesterId}, ${SINGLE_USER_ID}, 'Weg')`;
    await sql`INSERT INTO module (id, user_id, semester_id, name, color)
      VALUES (${otherModule}, ${SINGLE_USER_ID}, ${semesterId}, 'Statistik', 'mod-03')`;
    const c = await insertConcept({ name: 'Varianz' });
    await sql`INSERT INTO concept_module (id, user_id, concept_id, module_id)
      VALUES (${uuidv7()}, ${SINGLE_USER_ID}, ${c}, ${otherModule})`;
    await sql`DELETE FROM module WHERE id = ${otherModule}`;
    expect(await count('concept_module', 'concept_id', c)).toBe(0);
    expect(await count('concept', 'id', c)).toBe(1);

    const husk = await insertConcept({ status: 'zusammengefuehrt', merged: c, proposal: sessionId });
    const ev = await insertEvidence(c, { t: 7, tEnd: 9 });
    const rel = await insertRelation(c, await insertConcept({ name: 'Erwartungswert' }));
    await sql`DELETE FROM concept WHERE id = ${c}`;
    expect(await count('concept', 'id', husk)).toBe(0);
    expect(await count('evidence', 'id', ev)).toBe(0);
    expect(await count('concept_relation', 'id', rel)).toBe(0);
  });

  it('pflegt updated_at an den neuen Tabellen', async () => {
    const c = await insertConcept({ name: 'Schlüssel' });
    const [before] =
      await sql`SELECT extract(epoch FROM updated_at)::float8 AS t FROM concept WHERE id = ${c}`;
    await sql`SELECT pg_sleep(0.01)`;
    await sql`UPDATE concept SET one_liner = 'Identifiziert ein Tupel eindeutig.' WHERE id = ${c}`;
    const [after] =
      await sql`SELECT extract(epoch FROM updated_at)::float8 AS t FROM concept WHERE id = ${c}`;
    expect(after!.t).toBeGreaterThan(before!.t);
    const triggers = await sql`SELECT tgrelid::regclass::text AS t FROM pg_trigger
      WHERE tgname LIKE '%touch_updated_at' AND tgrelid::regclass::text IN
        ('concept','concept_module','concept_relation','evidence','inbox_item','session_summary')`;
    expect(triggers.map((r) => r.t).sort()).toEqual([
      'concept',
      'concept_module',
      'concept_relation',
      'evidence',
      'inbox_item',
      'session_summary',
    ]);
  });

  it('ergänzt cost_entry um Session, Cache-Tokens, USD und request_id (VERTRAEGE §20.5)', async () => {
    const insert = (over: { cacheRead?: number; usd?: number; request?: string | null } = {}) => {
      const r = { cacheRead: 0, usd: 0.01, request: 'req_test' as string | null, ...over };
      return sql`INSERT INTO cost_entry (id, user_id, session_id, provider, model, task, input_tokens, output_tokens,
          cache_creation_input_tokens, cache_read_input_tokens, cost_estimate_usd, cost_estimate_eur, request_id)
        VALUES (${uuidv7()}, ${SINGLE_USER_ID}, ${sessionId}, 'anthropic', 'claude-sonnet-5-5', 'concepts.extract',
          1200, 300, 0, ${r.cacheRead}, ${r.usd}, 0.0092, ${r.request})`;
    };
    await insert();
    await expect(insert({ cacheRead: -1 })).rejects.toThrow(/cost_entry_tokens_chk/);
    await expect(insert({ usd: -0.5 })).rejects.toThrow(/cost_entry_cost_chk/);
    await expect(insert({ request: 'r'.repeat(201) })).rejects.toThrow(/cost_entry_request_id_chk/);
    const [row] = await sql`SELECT cost_estimate_usd::float8 AS usd, session_id FROM cost_entry
      WHERE request_id = 'req_test' ORDER BY created_at DESC LIMIT 1`;
    expect(row).toMatchObject({ usd: 0.01, session_id: sessionId });
  });
});
