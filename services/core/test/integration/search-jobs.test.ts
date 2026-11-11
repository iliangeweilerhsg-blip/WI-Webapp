// T2-12: Jobs `search.index` beim Hochladen eines Foliensatzes und in `ensurePipelineJobs`, das Nachholen
// (VERTRAEGE §19.5) und die Papierkorb-Kanten von `search_chunk` (§19.1). Echte Datenbank, der Worker läuft nicht.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID, type JobState } from '@sg/shared';
import type { DbHandle } from '../../src/db/client.ts';
import {
  courseModule,
  job,
  semester,
  session,
  slide,
  slideDeck,
  slideSegment,
  transcript,
  transcriptSegment,
} from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { createExerciseSheet, createSlideDeck } from '../../src/services/material.ts';
import { ensurePipelineJobs } from '../../src/services/pipeline.ts';
import {
  BACKFILL_MAX_JOBS,
  runSearchBackfill,
  SEARCH_INDEX_VERSION,
  startSearchBackfill,
} from '../../src/services/search-backfill.ts';
import { setSessionEventPublisher } from '../../src/services/sessions.ts';
import { listTrash, restoreWithOps, softDeleteWithOps } from '../../src/services/trash-ops.ts';
import { FAKE_MODEL, FakeWorker } from '../unit/worker-fake.ts';
import { startTestApp, type TestApp } from './helpers.ts';
import { insertSlideChunk, insertTranscriptChunk } from './search-helpers.ts';

const base = { userId: SINGLE_USER_ID };
let app: TestApp;
let handle: DbHandle;
let moduleId = '';
let semesterId = '';

beforeAll(async () => {
  app = await startTestApp();
  handle = app.handle;
  setSessionEventPublisher(async () => {});
});
afterAll(async () => {
  setSessionEventPublisher(null);
  await truncate();
  await app.close();
});
beforeEach(async () => {
  await truncate();
  semesterId = uuidv7();
  moduleId = uuidv7();
  await handle.db.insert(semester).values({ id: semesterId, ...base, name: 'HS 2026' });
  await handle.db
    .insert(courseModule)
    .values({ id: moduleId, ...base, semesterId, name: 'Datenbanken', color: 'mod-01' });
});

async function truncate() {
  await handle.sql`TRUNCATE semester, module, session, slide_deck, exercise_sheet, search_chunk, job, recording,
    sync_op, sync_stream CASCADE`;
}

type JobRow = typeof job.$inferSelect;

async function searchJobs(): Promise<JobRow[]> {
  return handle.db.select().from(job).where(eq(job.type, 'search.index')).orderBy(job.createdAt, job.id);
}

let clock = 0;
/** Job mit strikt aufsteigendem `created_at` */
async function mkJob(
  type: string,
  state: JobState,
  extra: {
    payload?: Record<string, unknown>;
    result?: Record<string, unknown> | null;
    updatedAt?: Date;
    dependsOn?: string[];
    sessionId?: string | null;
    deletedAt?: Date | null;
  } = {},
): Promise<string> {
  const id = uuidv7();
  clock += 1;
  await handle.db.insert(job).values({
    id,
    ...base,
    type,
    payload: extra.payload ?? {},
    state,
    result: extra.result ?? null,
    dependsOn: extra.dependsOn ?? [],
    sessionId: extra.sessionId ?? null,
    deletedAt: extra.deletedAt ?? null,
    createdAt: new Date(Date.UTC(2026, 10, 1) + clock * 1000),
  });
  if (extra.updatedAt) {
    // `updated_at` pflegt der Trigger; ohne Trigger-Wirkung setzen
    await handle.sql`ALTER TABLE job DISABLE TRIGGER USER`;
    try {
      await handle.sql`UPDATE job SET updated_at = ${extra.updatedAt.toISOString()}::timestamptz WHERE id = ${id}`;
    } finally {
      await handle.sql`ALTER TABLE job ENABLE TRIGGER USER`;
    }
  }
  return id;
}

// ---------------------------------------------------------------------------------------------
// Foliensatz hochladen
// ---------------------------------------------------------------------------------------------

function storedUpload(content: string) {
  const dir = join(app.config.dataDir, 'media', '.tmp');
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `${uuidv7()}.part`);
  const data = Buffer.from(`%PDF-1.4\n${content}\n%%EOF\n`);
  writeFileSync(tmpPath, data);
  return {
    tmpPath,
    size: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    filename: `${content}.pdf`,
  };
}

describe('search.index beim Hochladen (§19.5)', () => {
  it('neuer Foliensatz: search.index { deck } abhängig von pdf.ingest, priority 5, ohne session_id', async () => {
    const sessionId = uuidv7();
    await handle.db.insert(session).values({ id: sessionId, ...base, moduleId });
    const { id } = await createSlideDeck(handle.db, app.config.dataDir, storedUpload('a'), {
      moduleId,
      sessionId,
    });
    const [ingest] = await handle.db.select().from(job).where(eq(job.type, 'pdf.ingest'));
    const [search] = await searchJobs();
    expect(search).toMatchObject({
      state: 'wartet',
      priority: 5,
      sessionId: null,
      payload: { scope: 'deck', id },
      dependsOn: [ingest!.id],
    });
    // Dublette, die nicht gescheitert ist: kein neuer Job
    await createSlideDeck(handle.db, app.config.dataDir, storedUpload('a'), { moduleId });
    expect(await searchJobs()).toHaveLength(1);
  });

  it('gescheiterte Dublette: wartender search.index wird wiederverwendet, tote Abhängigkeiten fallen weg', async () => {
    const { id } = await createSlideDeck(handle.db, app.config.dataDir, storedUpload('b'), { moduleId });
    const [first] = await searchJobs();
    // Abhängigkeiten: der gescheiterte pdf.ingest, eine unbekannte ID, ein gelöschter Job, ein fertiger
    const deleted = await mkJob('pdf.ingest', 'fertig', { deletedAt: new Date() });
    const done = await mkJob('pdf.ingest', 'fertig');
    const unknown = uuidv7();
    await handle.db
      .update(job)
      .set({ dependsOn: [...first!.dependsOn, unknown, deleted, done], priority: -5 })
      .where(eq(job.id, first!.id));
    await handle.sql`UPDATE job SET state = 'fehler' WHERE type = 'pdf.ingest' AND id <> ${done} AND id <> ${deleted}`;
    await handle.sql`UPDATE slide_deck SET ingest_state = 'fehler' WHERE id = ${id}`;

    await createSlideDeck(handle.db, app.config.dataDir, storedUpload('b'), { moduleId });
    const ingests = await handle.db
      .select()
      .from(job)
      .where(sql`${job.type} = 'pdf.ingest' AND ${job.state} = 'wartet'`);
    expect(ingests).toHaveLength(1);
    const jobs = await searchJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: first!.id, state: 'wartet', priority: 5 });
    expect(jobs[0]!.dependsOn).toEqual([done, ingests[0]!.id]);
  });

  it('nicht wartender search.index (fehler): neuer Job', async () => {
    const { id } = await createSlideDeck(handle.db, app.config.dataDir, storedUpload('c'), { moduleId });
    await handle.sql`UPDATE job SET state = 'fehler'`;
    await handle.sql`UPDATE slide_deck SET ingest_state = 'fehler' WHERE id = ${id}`;
    await createSlideDeck(handle.db, app.config.dataDir, storedUpload('c'), { moduleId });
    const jobs = await searchJobs();
    expect(jobs.map((j) => j.state)).toEqual(['fehler', 'wartet']);
  });

  it('Übungsblatt: kein search.index', async () => {
    await createExerciseSheet(handle.db, app.config.dataDir, storedUpload('d'), { moduleId });
    expect(await searchJobs()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// ensurePipelineJobs
// ---------------------------------------------------------------------------------------------

describe('search.index in ensurePipelineJobs (§19.5)', () => {
  async function ensure(sessionId: string, fromStep: 'audio.finalize' | 'transcribe' | 'align.log') {
    return handle.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM session WHERE id = ${sessionId} FOR NO KEY UPDATE`);
      return ensurePipelineJobs(tx, sessionId, { fromStep, emit: false });
    });
  }

  it('nach transcribe, abhängig davon; nicht in processing und nicht in der Rückgabe', async () => {
    const sessionId = uuidv7();
    await handle.db.insert(session).values({ id: sessionId, ...base, moduleId, state: 'verarbeitet' });
    const jobs = await ensure(sessionId, 'transcribe');
    // samt der Konzept-Kette (§20.2)
    expect(jobs.map((j) => j.type)).toEqual([
      'transcribe',
      'align.log',
      'concepts.extract',
      'concepts.resolve',
      'summary.write',
    ]);
    const [search] = await searchJobs();
    expect(search).toMatchObject({
      state: 'wartet',
      priority: 5,
      sessionId: null,
      payload: { scope: 'session', id: sessionId },
      dependsOn: [jobs[0]!.id],
    });
    const [row] = await handle.db.select().from(session).where(eq(session.id, sessionId));
    expect(Object.keys(row!.processing ?? {}).sort()).toEqual([
      'align.log',
      'concepts.extract',
      'concepts.resolve',
      'summary.write',
      'transcribe',
    ]);
  });

  it('wiederholt: wartender Job wird wiederverwendet, tote Abhängigkeiten fallen weg', async () => {
    const sessionId = uuidv7();
    await handle.db.insert(session).values({ id: sessionId, ...base, moduleId, state: 'verarbeitet' });
    const first = await ensure(sessionId, 'transcribe');
    const [search] = await searchJobs();
    const failed = await mkJob('transcribe', 'fehler', { sessionId, payload: { session_id: sessionId } });
    await handle.db
      .update(job)
      .set({ dependsOn: [failed, uuidv7(), first[0]!.id] })
      .where(eq(job.id, search!.id));
    const second = await ensure(sessionId, 'transcribe');
    // transcribe wartet noch und wird wiederverwendet; search.index ebenso
    expect(second[0]!.id).toBe(first[0]!.id);
    const jobs = await searchJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.dependsOn).toEqual([first[0]!.id]);
  });

  it('neuer transcribe-Job (der alte läuft): search.index hängt am neuen', async () => {
    const sessionId = uuidv7();
    await handle.db.insert(session).values({ id: sessionId, ...base, moduleId, state: 'verarbeitet' });
    const first = await ensure(sessionId, 'transcribe');
    await handle.sql`UPDATE job SET state = 'laeuft' WHERE id = ${first[0]!.id}`;
    await handle.sql`UPDATE job SET state = 'fertig' WHERE type = 'search.index'`;
    const second = await ensure(sessionId, 'transcribe');
    expect(second[0]!.id).not.toBe(first[0]!.id);
    const jobs = await searchJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[1]).toMatchObject({ state: 'wartet', dependsOn: [second[0]!.id] });
  });

  it('fromStep = align.log: kein search.index', async () => {
    const sessionId = uuidv7();
    await handle.db.insert(session).values({ id: sessionId, ...base, moduleId, state: 'verarbeitet' });
    expect((await ensure(sessionId, 'align.log')).map((j) => j.type)).toEqual([
      'align.log',
      'concepts.extract',
      'concepts.resolve',
      'summary.write',
    ]);
    expect(await searchJobs()).toEqual([]);
  });

  it('POST /sessions/{id}/reprocess mit from_step align.log: kein search.index', async () => {
    const sessionId = uuidv7();
    await handle.db.insert(session).values({ id: sessionId, ...base, moduleId, state: 'verarbeitet' });
    const res = await app.request({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/reprocess`,
      payload: { from_step: 'align.log' },
    });
    expect(res.statusCode).toBe(202);
    expect(await searchJobs()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Nachholen
// ---------------------------------------------------------------------------------------------

describe('Nachholen (§19.5)', () => {
  let worker: FakeWorker;
  let ready: { health: () => Promise<{ embedder: { state: string; model: string } }> };
  const health = (state: 'bereit' | 'laedt' | 'nicht_verfuegbar', model = FAKE_MODEL) => ({
    health: async () =>
      ({
        embedder: { provider: 'fake', model, dim: 1024 as const, state, error: null },
      }) as const,
  });
  const down = {
    health: async () => {
      throw new Error('nicht erreichbar');
    },
  };

  let deckCreated = 0;
  async function mkDeck(over: Partial<typeof slideDeck.$inferInsert> = {}): Promise<string> {
    const id = uuidv7();
    deckCreated += 1;
    await handle.db.insert(slideDeck).values({
      id,
      ...base,
      moduleId,
      title: 'Folien',
      filePath: 'x.pdf',
      sha256: createHash('sha256').update(id).digest('hex'),
      ingestState: 'verarbeitet',
      createdAt: new Date(Date.UTC(2026, 9, 1) + deckCreated * 1000),
      ...over,
    });
    return id;
  }

  async function mkSessionWithTranscript(opts: { transcriptDeleted?: boolean; noTranscript?: boolean } = {}) {
    const id = uuidv7();
    deckCreated += 1;
    await handle.db.insert(session).values({
      id,
      ...base,
      moduleId,
      state: 'verarbeitet',
      createdAt: new Date(Date.UTC(2026, 9, 1) + deckCreated * 1000),
    });
    if (!opts.noTranscript) {
      const recordingId = uuidv7();
      await handle.sql`INSERT INTO recording (id, user_id, session_id, mime, codec, started_ms)
        VALUES (${recordingId}, ${SINGLE_USER_ID}, ${id}, 'audio/webm', 'opus', 0)`;
      await handle.db.insert(transcript).values({
        id: uuidv7(),
        ...base,
        sessionId: id,
        recordingId,
        jobId: uuidv7(),
        finalizeJobId: uuidv7(),
        provider: 'fake',
        model: 'fake',
        inputHash: 'e'.repeat(64),
        audioSha256: 'f'.repeat(64),
        audioDurationMs: 1000,
        segmentCount: 0,
        wordCount: 0,
        deletedAt: opts.transcriptDeleted ? new Date() : null,
      });
    }
    return id;
  }

  const okResult = (scope: 'deck' | 'session', id: string, over: Record<string, unknown> = {}) => ({
    scope,
    id,
    chunk_count: 1,
    embedded_count: 1,
    reused_count: 0,
    removed_count: 0,
    embedding_model: FAKE_MODEL,
    embedding_error: null,
    index_version: SEARCH_INDEX_VERSION,
    deleted: false,
    missing: false,
    ...over,
  });
  const searchJob = (scope: 'deck' | 'session', id: string, state: JobState, extra = {}) =>
    mkJob('search.index', state, { payload: { scope, id }, ...extra });

  beforeAll(async () => {
    worker = await new FakeWorker(mkdtempSync(join(tmpdir(), 'sg-backfill-'))).start();
    ready = health('bereit');
  });
  afterAll(async () => {
    await worker.stop();
  });

  const run = (w: { health: () => Promise<unknown> } = ready) =>
    runSearchBackfill({ db: handle.db, worker: w as never });
  const created = async (w?: { health: () => Promise<unknown> }) =>
    (await run(w)).created.map((c) => `${c.scope}:${c.id}`);

  it('Ziele ohne Job bekommen einen (priority -5, ohne session_id); Nicht-Ziele nicht', async () => {
    const deck = await mkDeck();
    await mkDeck({ ingestState: 'neu' });
    await mkDeck({ deletedAt: new Date() });
    const withTranscript = await mkSessionWithTranscript();
    await mkSessionWithTranscript({ noTranscript: true });
    await mkSessionWithTranscript({ transcriptDeleted: true });
    // Modul gelöscht: weder Foliensatz noch Session
    const otherModule = uuidv7();
    await handle.db
      .insert(courseModule)
      .values({ id: otherModule, ...base, semesterId, name: 'Weg', color: 'mod-02', deletedAt: new Date() });
    await mkDeck({ moduleId: otherModule });

    expect(await created()).toEqual([`deck:${deck}`, `session:${withTranscript}`]);
    const jobs = await searchJobs();
    expect(jobs.map((j) => [j.priority, j.sessionId, j.state])).toEqual([
      [-5, null, 'wartet'],
      [-5, null, 'wartet'],
    ]);
    // Zweiter Lauf: der neueste wartet → nichts
    expect(await created()).toEqual([]);
  });

  it('neuester wartet oder läuft → nichts', async () => {
    const a = await mkDeck();
    const b = await mkDeck();
    await searchJob('deck', a, 'wartet');
    await searchJob('deck', b, 'fertig', { result: okResult('deck', b, { deleted: true }) });
    await searchJob('deck', b, 'laeuft');
    expect(await created()).toEqual([]);
  });

  it('neuester fertig: deleted, missing, andere Version → neu; gleich → nichts', async () => {
    const same = await mkDeck();
    const deleted = await mkDeck();
    const missing = await mkDeck();
    const version = await mkDeck();
    const noVersion = await mkDeck();
    await searchJob('deck', same, 'fertig', { result: okResult('deck', same) });
    await searchJob('deck', deleted, 'fertig', { result: okResult('deck', deleted, { deleted: true }) });
    await searchJob('deck', missing, 'fertig', { result: okResult('deck', missing, { missing: true }) });
    await searchJob('deck', version, 'fertig', {
      result: okResult('deck', version, { index_version: SEARCH_INDEX_VERSION + 1 }),
    });
    await searchJob('deck', noVersion, 'fertig', { result: null });
    expect(await created()).toEqual([
      `deck:${deleted}`,
      `deck:${missing}`,
      `deck:${version}`,
      `deck:${noVersion}`,
    ]);
  });

  it('Modell: nur wenn der Embedder bereit ist, auch embedding_model null', async () => {
    const same = await mkDeck();
    const without = await mkDeck();
    const other = await mkDeck();
    await searchJob('deck', same, 'fertig', { result: okResult('deck', same) });
    await searchJob('deck', without, 'fertig', {
      result: okResult('deck', without, { embedding_model: null }),
    });
    await searchJob('deck', other, 'fertig', {
      result: okResult('deck', other, { embedding_model: 'BAAI/bge-m3' }),
    });
    // Nicht bereit, nicht verfügbar oder nicht erreichbar: Modell-Bedingung entfällt
    expect(await created(health('laedt'))).toEqual([]);
    expect(await created(health('nicht_verfuegbar'))).toEqual([]);
    expect(await created(down)).toEqual([]);
    const result = await run(ready);
    expect(result.model).toBe(FAKE_MODEL);
    expect(result.created.map((c) => c.id)).toEqual([without, other]);
  });

  it('über den echten WorkerClient (Test-Server): bereit → Modell aus /health', async () => {
    const { WorkerClient } = await import('../../src/lib/worker-client.ts');
    const deck = await mkDeck();
    await searchJob('deck', deck, 'fertig', { result: okResult('deck', deck, { embedding_model: null }) });
    const client = new WorkerClient({ dataDir: worker.dataDir, port: worker.port });
    worker.healthState = 'laedt';
    expect((await runSearchBackfill({ db: handle.db, worker: client })).created).toEqual([]);
    worker.healthState = 'bereit';
    const result = await runSearchBackfill({ db: handle.db, worker: client });
    expect(result).toMatchObject({ model: FAKE_MODEL, created: [{ scope: 'deck', id: deck }] });
  });

  it('neuester fehler/abgebrochen: erst nach 24 h ab updated_at', async () => {
    const recent = await mkDeck();
    const old = await mkDeck();
    const oldAborted = await mkDeck();
    const now = Date.now();
    await searchJob('deck', recent, 'fehler', { updatedAt: new Date(now - 23 * 3600_000) });
    await searchJob('deck', old, 'fehler', { updatedAt: new Date(now - 25 * 3600_000) });
    await searchJob('deck', oldAborted, 'abgebrochen', { updatedAt: new Date(now - 25 * 3600_000) });
    expect(await created()).toEqual([`deck:${old}`, `deck:${oldAborted}`]);
  });

  it('maßgeblich ist der neueste nicht gelöschte Job', async () => {
    const a = await mkDeck();
    const b = await mkDeck();
    const c = await mkDeck();
    const longAgo = new Date(Date.now() - 48 * 3600_000);
    // a: alt fertig/gut, neu fehler (jung) → nichts
    await searchJob('deck', a, 'fertig', { result: okResult('deck', a) });
    await searchJob('deck', a, 'fehler', { updatedAt: new Date() });
    // b: alt fehler (lange her), neu fertig/gut → nichts
    await searchJob('deck', b, 'fehler', { updatedAt: longAgo });
    await searchJob('deck', b, 'fertig', { result: okResult('deck', b) });
    // c: neuester ist gelöscht und würde blockieren; maßgeblich ist der ältere (fehler, lange her) → neu
    await searchJob('deck', c, 'fehler', { updatedAt: longAgo });
    await searchJob('deck', c, 'wartet', { deletedAt: new Date() });
    expect(await created()).toEqual([`deck:${c}`]);
  });

  it(`höchstens ${BACKFILL_MAX_JOBS} je Lauf, ältestes Ziel zuerst`, async () => {
    const decks: string[] = [];
    for (let i = 0; i < BACKFILL_MAX_JOBS + 5; i += 1) decks.push(await mkDeck());
    const first = await run();
    expect(first.created.map((c) => c.id)).toEqual(decks.slice(0, BACKFILL_MAX_JOBS));
    const second = await run();
    expect(second.created.map((c) => c.id)).toEqual(decks.slice(BACKFILL_MAX_JOBS));
    expect(await created()).toEqual([]);
  });

  it('startSearchBackfill läuft sofort und lässt sich sauber beenden', async () => {
    const deck = await mkDeck();
    const handleRun = startSearchBackfill({
      db: handle.db,
      worker: down as never,
      logger: pino({ level: 'silent' }),
    });
    await handleRun.stop();
    expect((await searchJobs()).map((j) => (j.payload as { id: string }).id)).toEqual([deck]);
  });

  it('buildApp mit searchBackfill: startet erst nach erfolgreichem listen, ohne Option nie', async () => {
    const deck = await mkDeck();
    const withBackfill = await startTestApp({}, { searchBackfill: true });
    await withBackfill.app.ready(); // onReady läuft vor dem Binden: noch keine Jobs
    expect(await searchJobs()).toEqual([]);
    await withBackfill.app.listen({ port: 0, host: '127.0.0.1' });
    await withBackfill.close(); // wartet auf den laufenden Lauf
    expect((await searchJobs()).map((j) => (j.payload as { id: string }).id)).toEqual([deck]);
    await handle.sql`DELETE FROM job`;
    const without = await startTestApp();
    await without.app.listen({ port: 0, host: '127.0.0.1' });
    await without.close();
    expect(await searchJobs()).toEqual([]);
  });

  it('buildApp mit searchBackfill: Port belegt (EADDRINUSE) legt keine Jobs an', async () => {
    await mkDeck();
    const first = await startTestApp();
    await first.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (first.app.server.address() as { port: number }).port;
    const second = await startTestApp({}, { searchBackfill: true });
    await expect(second.app.listen({ port, host: '127.0.0.1' })).rejects.toThrow(/EADDRINUSE/);
    await second.close();
    await first.close();
    expect(await searchJobs()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Papierkorb
// ---------------------------------------------------------------------------------------------

describe('Papierkorb: search_chunk mit Foliensatz und Session (§19.1)', () => {
  async function chunkStates() {
    return handle.sql<{ id: string; deleted_at: string | null }[]>`
      SELECT id, deleted_at::text FROM search_chunk ORDER BY id`;
  }

  it('Foliensatz: weich löschen setzt denselben deleted_at, Wiederherstellen holt die Einträge zurück', async () => {
    const deck = uuidv7();
    await handle.db.insert(slideDeck).values({
      id: deck,
      ...base,
      moduleId,
      title: 'F',
      filePath: 'x.pdf',
      sha256: 'a'.repeat(64),
    });
    const a = await insertSlideChunk(handle, { deckId: deck, slideIndex: 1, text: 'eins' });
    const b = await insertSlideChunk(handle, { deckId: deck, slideIndex: 2, text: 'zwei' });
    // Vorher einzeln gelöscht: bleibt beim Wiederherstellen gelöscht
    const earlier = await insertSlideChunk(handle, {
      deckId: deck,
      slideIndex: 3,
      text: 'drei',
      deletedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await softDeleteWithOps(handle.db, 'slide_deck', deck);
    const [deckRow] = await handle.sql<
      { ts: string }[]
    >`SELECT deleted_at::text AS ts FROM slide_deck WHERE id = ${deck}`;
    const deleted = await chunkStates();
    expect(deleted.find((c) => c.id === a)!.deleted_at).toBe(deckRow!.ts);
    expect(deleted.find((c) => c.id === b)!.deleted_at).toBe(deckRow!.ts);
    expect(deleted.find((c) => c.id === earlier)!.deleted_at).not.toBe(deckRow!.ts);

    await restoreWithOps(handle.db, deck);
    const restored = await chunkStates();
    expect(restored.find((c) => c.id === a)!.deleted_at).toBeNull();
    expect(restored.find((c) => c.id === b)!.deleted_at).toBeNull();
    expect(restored.find((c) => c.id === earlier)!.deleted_at).not.toBeNull();
  });

  it('Session und Modul: Kaskade bis search_chunk, Wiederherstellen des Moduls holt alles zurück', async () => {
    const sessionId = uuidv7();
    await handle.db.insert(session).values({ id: sessionId, ...base, moduleId, state: 'verarbeitet' });
    const w0 = await insertTranscriptChunk(handle, {
      sessionId,
      part: 0,
      tMs: 0,
      tEndMs: 60_000,
      text: 'eins',
    });
    const w1 = await insertTranscriptChunk(handle, {
      sessionId,
      part: 1,
      tMs: 60_000,
      tEndMs: 90_000,
      text: 'zwei',
    });

    await softDeleteWithOps(handle.db, 'session', sessionId);
    const [s] = await handle.sql<
      { ts: string }[]
    >`SELECT deleted_at::text AS ts FROM session WHERE id = ${sessionId}`;
    expect((await chunkStates()).map((c) => c.deleted_at)).toEqual([s!.ts, s!.ts]);
    await restoreWithOps(handle.db, sessionId);
    expect((await chunkStates()).map((c) => c.deleted_at)).toEqual([null, null]);

    await softDeleteWithOps(handle.db, 'module', moduleId);
    const [m] = await handle.sql<
      { ts: string }[]
    >`SELECT deleted_at::text AS ts FROM module WHERE id = ${moduleId}`;
    expect((await chunkStates()).map((c) => c.deleted_at)).toEqual([m!.ts, m!.ts]);
    const result = await restoreWithOps(handle.db, moduleId);
    expect(result.restored_count).toBeGreaterThanOrEqual(3);
    expect((await chunkStates()).map((c) => [c.id, c.deleted_at])).toEqual([
      [w0, null],
      [w1, null],
    ]);
  });

  it('GET /trash: Maschinenausgaben zählen nicht als abhängige Objekte (Folien und Aufnahmen schon)', async () => {
    const deck = uuidv7();
    await handle.db.insert(slideDeck).values({
      id: deck,
      ...base,
      moduleId,
      title: 'F',
      filePath: 'x.pdf',
      sha256: 'a'.repeat(64),
    });
    const slideIds = [uuidv7(), uuidv7()];
    for (const [i, sid] of slideIds.entries()) {
      await handle.db
        .insert(slide)
        .values({ id: sid, ...base, deckId: deck, index: i + 1, widthPt: 1, heightPt: 1 });
      await insertSlideChunk(handle, {
        deckId: deck,
        slideIndex: i + 1,
        slideId: sid,
        text: `Folie ${i + 1}`,
      });
    }

    const sessionId = uuidv7();
    await handle.db.insert(session).values({ id: sessionId, ...base, moduleId, state: 'verarbeitet' });
    const recordingId = uuidv7();
    await handle.sql`INSERT INTO recording (id, user_id, session_id, mime, codec, started_ms)
      VALUES (${recordingId}, ${SINGLE_USER_ID}, ${sessionId}, 'audio/webm', 'opus', 0)`;
    const transcriptId = uuidv7();
    await handle.db.insert(transcript).values({
      id: transcriptId,
      ...base,
      sessionId,
      recordingId,
      jobId: uuidv7(),
      finalizeJobId: uuidv7(),
      provider: 'fake',
      model: 'fake',
      inputHash: 'e'.repeat(64),
      audioSha256: 'f'.repeat(64),
      audioDurationMs: 1000,
      segmentCount: 2,
      wordCount: 2,
    });
    for (const seq of [0, 1]) {
      await handle.db.insert(transcriptSegment).values({
        id: uuidv7(),
        ...base,
        transcriptId,
        sessionId,
        recordingId,
        seq,
        startMs: seq * 1000,
        endMs: seq * 1000 + 500,
        text: `Satz ${seq}`,
        lang: 'de',
      });
    }
    await handle.db.insert(slideSegment).values({
      id: uuidv7(),
      ...base,
      sessionId,
      slideId: slideIds[0]!,
      slideIndex: 1,
      startMs: 0,
      endMs: 2000,
      source: 'log',
      confidence: 1,
    });
    await insertTranscriptChunk(handle, { sessionId, part: 0, tMs: 0, tEndMs: 1500, text: 'Satz 0 Satz 1' });

    await softDeleteWithOps(handle.db, 'slide_deck', deck);
    await softDeleteWithOps(handle.db, 'session', sessionId);
    const { items } = await listTrash(handle.db, { limit: 50 });
    const count = (id: string) => items.find((i) => i.id === id)?.dependent_count;
    expect(count(deck)).toBe(2); // nur die Folien, nicht die Sucheinträge
    expect(count(sessionId)).toBe(1); // nur die Aufnahme, nicht Transkript, Abschnitte, Zuordnung, Suchindex
    // Die Kaskade nimmt die Maschinenausgaben trotzdem mit
    const [alive] = await handle.sql<{ n: number }[]>`
      SELECT (SELECT count(*) FROM search_chunk WHERE deleted_at IS NULL)
           + (SELECT count(*) FROM transcript WHERE deleted_at IS NULL)
           + (SELECT count(*) FROM transcript_segment WHERE deleted_at IS NULL)
           + (SELECT count(*) FROM slide_segment WHERE deleted_at IS NULL) AS n`;
    expect(Number(alive!.n)).toBe(0);
  });

  it('endgültiges Löschen nimmt die Einträge über den Fremdschlüssel mit', async () => {
    const deck = uuidv7();
    await handle.db.insert(slideDeck).values({
      id: deck,
      ...base,
      moduleId,
      title: 'F',
      filePath: 'x.pdf',
      sha256: 'a'.repeat(64),
    });
    await insertSlideChunk(handle, { deckId: deck, slideIndex: 1, text: 'eins' });
    await handle.sql`DELETE FROM slide_deck WHERE id = ${deck}`;
    expect(await chunkStates()).toEqual([]);
  });
});
