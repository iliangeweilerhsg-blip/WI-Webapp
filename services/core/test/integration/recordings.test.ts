// REST §7.3 / §10: Aufnahmen, Chunk-Upload (Reihenfolge, Duplikat, Konflikt, Limits), complete, audio.finalize
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  AudioChunkSchema,
  AudioFinalizePayloadSchema,
  RecordingSchema,
  SINGLE_USER_ID,
  type Recording,
} from '@sg/shared';
import { job, recording, session } from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { ensureFinalizeOnStop, MAX_CHUNK_BYTES } from '../../src/services/recordings.ts';
import { startTestApp, type TestApp } from './helpers.ts';
import { seedModule } from './ink-helpers.ts';

const API = '/api/v1';
let t: TestApp;
let moduleId: string;
let sessionId: string;

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await truncate();
  await t.handle.sql`TRUNCATE idempotency_key`;
  await t.close();
});
beforeEach(async () => {
  await truncate();
  rmSync(join(t.config.dataDir, 'media'), { recursive: true, force: true });
  moduleId = (await seedModule(t.handle.db)).moduleId;
  sessionId = await seedSession('laeuft');
});

async function truncate() {
  await t.handle.sql`TRUNCATE semester, module, session, recording, audio_chunk, job CASCADE`;
}

async function seedSession(state: string): Promise<string> {
  const id = uuidv7();
  await t.handle.db.insert(session).values({
    id,
    userId: SINGLE_USER_ID,
    moduleId,
    state,
    startedFrom: 'mac',
  } as typeof session.$inferInsert);
  return id;
}

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

const createRec = (body: object = {}, sid = sessionId) =>
  t.request({
    method: 'POST',
    url: `${API}/sessions/${sid}/recordings`,
    payload: { mime: 'audio/webm;codecs=opus', codec: 'opus', started_ms: 0, ...body },
  });

async function newRecording(body: object = {}): Promise<Recording> {
  const res = await createRec(body);
  expect(res.statusCode).toBe(201);
  return RecordingSchema.parse(res.json());
}

interface PutOptions {
  data?: Buffer;
  start?: string;
  duration?: string;
  sha?: string | null;
  type?: string;
  headers?: Record<string, string>;
}

function putChunk(id: string, seq: number | string, data: Buffer, opts: PutOptions = {}) {
  const headers: Record<string, string> = {
    'content-type': opts.type ?? 'audio/webm',
    'x-start-ms': opts.start ?? String(Number(seq) * 30_000),
    'x-duration-ms': opts.duration ?? '30000',
    ...opts.headers,
  };
  if (opts.sha !== null) headers['x-sha256'] = opts.sha ?? sha(data);
  return t.request({ method: 'PUT', url: `${API}/recordings/${id}/chunks/${seq}`, headers, payload: data });
}

const bytes = (n: number, fill = 7) => Buffer.alloc(n, fill);
const errorCode = (res: { json: () => unknown }) => ApiErrorSchema.parse(res.json()).error.code;
const finalizeJobs = () => t.handle.db.select().from(job).where(eq(job.type, 'audio.finalize'));

describe('POST /sessions/{id}/recordings', () => {
  it('legt eine Aufnahme an und liefert sie wieder', async () => {
    const rec = await newRecording({ started_ms: 1500, chunks_independent: false });
    expect(rec).toMatchObject({
      session_id: sessionId,
      mime: 'audio/webm;codecs=opus',
      codec: 'opus',
      started_ms: 1500,
      state: 'laeuft',
      chunks_independent: false,
      chunk_count: 0,
      last_seq: null,
      completed_at: null,
      duration_ms: null,
    });
    const got = await t.request({ method: 'GET', url: `${API}/recordings/${rec.id}` });
    expect(got.statusCode).toBe(200);
    expect(RecordingSchema.parse(got.json())).toEqual(rec);
  });

  it('übernimmt eine Client-ID und lehnt eine doppelte ab (recording_exists)', async () => {
    const id = uuidv7();
    expect((await newRecording({ id })).id).toBe(id);
    const again = await createRec({ id });
    expect(again.statusCode).toBe(409);
    expect(errorCode(again)).toBe('recording_exists');
  });

  it('erlaubt pausierte Sessions, lehnt andere Zustände ab', async () => {
    await t.handle.db.update(session).set({ state: 'pausiert' }).where(eq(session.id, sessionId));
    expect((await createRec()).statusCode).toBe(201);
    for (const state of ['bereit', 'beendet', 'verarbeitet']) {
      const res = await createRec({}, await seedSession(state));
      expect(res.statusCode, state).toBe(409);
      expect(errorCode(res)).toBe('session_not_active');
    }
  });

  it('meldet unbekannte und gelöschte Sessions als session_not_found', async () => {
    const unknown = await createRec({}, uuidv7());
    expect(unknown.statusCode).toBe(404);
    expect(errorCode(unknown)).toBe('session_not_found');
    await t.handle.db.update(session).set({ deletedAt: new Date() }).where(eq(session.id, sessionId));
    expect(errorCode(await createRec())).toBe('session_not_found');
  });

  it('prüft den Body (mime, codec, Großbuchstaben in der ID)', async () => {
    for (const body of [
      { mime: 'audio/ogg' },
      { codec: 'mp3' },
      { started_ms: -1 },
      { id: uuidv7().toUpperCase() },
    ]) {
      const res = await createRec(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(errorCode(res)).toBe('validation_failed');
    }
  });

  it('GET unbekannt: 404 recording_not_found, ungültige ID: 400', async () => {
    const res = await t.request({ method: 'GET', url: `${API}/recordings/${uuidv7()}` });
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('recording_not_found');
    expect((await t.request({ method: 'GET', url: `${API}/recordings/nope` })).statusCode).toBe(400);
  });
});

describe('PUT /recordings/{id}/chunks/{seq}', () => {
  it('speichert einen Chunk unter media/recordings/<id>/chunks/<seq>.webm', async () => {
    const rec = await newRecording();
    const data = bytes(2000, 1);
    const res = await putChunk(rec.id, 0, data);
    expect(res.statusCode).toBe(201);
    expect(AudioChunkSchema.parse(res.json())).toMatchObject({
      recording_id: rec.id,
      seq: 0,
      start_ms: 0,
      duration_ms: 30_000,
      sha256: sha(data),
      size_bytes: 2000,
      duplicate: false,
    });
    const file = join(t.config.dataDir, 'media', 'recordings', rec.id, 'chunks', '0.webm');
    expect(readFileSync(file).equals(data)).toBe(true);
    // keine .part-Reste
    expect(readdirSync(dirname(file)).filter((f) => f.endsWith('.part'))).toEqual([]);
    const got = RecordingSchema.parse(
      (await t.request({ method: 'GET', url: `${API}/recordings/${rec.id}` })).json(),
    );
    expect(got).toMatchObject({ chunk_count: 1, last_seq: 0 });
  });

  it('nimmt Chunks in beliebiger Reihenfolge an, last_seq ist die höchste seq', async () => {
    const rec = await newRecording();
    for (const seq of [2, 0, 1])
      expect((await putChunk(rec.id, seq, bytes(10, seq + 1))).statusCode).toBe(201);
    const got = RecordingSchema.parse(
      (await t.request({ method: 'GET', url: `${API}/recordings/${rec.id}` })).json(),
    );
    expect(got).toMatchObject({ chunk_count: 3, last_seq: 2 });
  });

  it('nimmt Chunks mit Lücken an (Invariante wird erst beim Finalisieren geprüft)', async () => {
    const rec = await newRecording();
    expect((await putChunk(rec.id, 0, bytes(10))).statusCode).toBe(201);
    expect((await putChunk(rec.id, 5, bytes(10, 2))).statusCode).toBe(201);
  });

  it('legt MP4-Aufnahmen als .mp4 ab', async () => {
    const rec = await newRecording({ mime: 'audio/mp4', codec: 'aac' });
    const res = await putChunk(rec.id, 0, bytes(50), { type: 'audio/mp4' });
    expect(res.statusCode).toBe(201);
    expect(existsSync(join(t.config.dataDir, 'media', 'recordings', rec.id, 'chunks', '0.mp4'))).toBe(true);
  });

  it('Duplikat (gleiche seq, gleiches sha256): 200 mit duplicate = true', async () => {
    const rec = await newRecording();
    const data = bytes(300);
    const first = AudioChunkSchema.parse((await putChunk(rec.id, 0, data)).json());
    const res = await putChunk(rec.id, 0, data);
    expect(res.statusCode).toBe(200);
    const dup = AudioChunkSchema.parse(res.json());
    expect(dup).toEqual({ ...first, duplicate: true });
    const rows = await t.handle.sql`SELECT count(*)::int AS n FROM audio_chunk`;
    expect(rows[0]?.n).toBe(1);
  });

  it('Duplikat stellt eine fehlende Datei wieder her', async () => {
    const rec = await newRecording();
    const data = bytes(300);
    await putChunk(rec.id, 0, data);
    const file = join(t.config.dataDir, 'media', 'recordings', rec.id, 'chunks', '0.webm');
    rmSync(file);
    expect((await putChunk(rec.id, 0, data)).statusCode).toBe(200);
    expect(readFileSync(file).equals(data)).toBe(true);
  });

  it('gleiche seq, anderes sha256: 409 chunk_conflict, Datei bleibt unverändert', async () => {
    const rec = await newRecording();
    const data = bytes(300, 1);
    await putChunk(rec.id, 0, data);
    const res = await putChunk(rec.id, 0, bytes(300, 2));
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('chunk_conflict');
    const file = join(t.config.dataDir, 'media', 'recordings', rec.id, 'chunks', '0.webm');
    expect(readFileSync(file).equals(data)).toBe(true);
    expect(readdirSync(dirname(file)).filter((f) => f.endsWith('.part'))).toEqual([]);
  });

  it('gleichzeitige Uploads derselben seq: genau ein Chunk entsteht', async () => {
    const rec = await newRecording();
    const data = bytes(4000, 9);
    const results = await Promise.all([0, 1, 2, 3].map(() => putChunk(rec.id, 0, data)));
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 201]);
  });

  it('Header fehlt oder ist ungültig: 400 chunk_header_invalid', async () => {
    const rec = await newRecording();
    const data = bytes(10);
    const cases: PutOptions[] = [
      { sha: null },
      { sha: 'ABC' },
      { sha: sha(data).toUpperCase() },
      { start: '-1' },
      { start: 'abc' },
      { start: '1.5' },
      { duration: '0' },
      { duration: '' },
    ];
    for (const opts of cases) {
      const res = await putChunk(rec.id, 0, data, opts);
      expect(res.statusCode, JSON.stringify(opts)).toBe(400);
      expect(errorCode(res)).toBe('chunk_header_invalid');
    }
    const noStart = await t.request({
      method: 'PUT',
      url: `${API}/recordings/${rec.id}/chunks/0`,
      headers: { 'content-type': 'audio/webm', 'x-duration-ms': '10', 'x-sha256': sha(data) },
      payload: data,
    });
    expect(noStart.statusCode).toBe(400);
    expect(errorCode(noStart)).toBe('chunk_header_invalid');
  });

  it('sha256 passt nicht zum Body: 422 checksum_mismatch, nichts bleibt liegen', async () => {
    const rec = await newRecording();
    const res = await putChunk(rec.id, 0, bytes(10), { sha: sha(bytes(11)) });
    expect(res.statusCode).toBe(422);
    expect(errorCode(res)).toBe('checksum_mismatch');
    const dir = join(t.config.dataDir, 'media', 'recordings', rec.id, 'chunks');
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
    expect((await t.handle.sql`SELECT count(*)::int AS n FROM audio_chunk`)[0]?.n).toBe(0);
  });

  it('falscher Content-Type: 415 chunk_mime_mismatch (Parameter egal)', async () => {
    const rec = await newRecording();
    const wrong = await putChunk(rec.id, 0, bytes(10), { type: 'audio/mp4' });
    expect(wrong.statusCode).toBe(415);
    expect(errorCode(wrong)).toBe('chunk_mime_mismatch');
    const json = await putChunk(rec.id, 0, bytes(10), { type: 'application/octet-stream' });
    expect(json.statusCode).toBe(415);
    const params = await putChunk(rec.id, 0, bytes(10), { type: 'audio/webm;codecs=opus' });
    expect(params.statusCode).toBe(201);
  });

  it('Body über 10 MB: 413 chunk_too_large (Content-Length und Stream)', async () => {
    const rec = await newRecording();
    const big = bytes(MAX_CHUNK_BYTES + 1);
    const res = await putChunk(rec.id, 0, big);
    expect(res.statusCode).toBe(413);
    expect(errorCode(res)).toBe('chunk_too_large');
    // Genau 10 MB sind erlaubt
    expect((await putChunk(rec.id, 1, bytes(MAX_CHUNK_BYTES))).statusCode).toBe(201);
    const dir = join(t.config.dataDir, 'media', 'recordings', rec.id, 'chunks');
    expect(readdirSync(dir)).toEqual(['1.webm']);
  });

  it('leerer Body: 400 validation_failed', async () => {
    const rec = await newRecording();
    const res = await putChunk(rec.id, 0, Buffer.alloc(0), { sha: sha(Buffer.alloc(0)) });
    expect(res.statusCode).toBe(400);
  });

  it('unbekannte Aufnahme: 404 recording_not_found', async () => {
    const res = await putChunk(uuidv7(), 0, bytes(10));
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('recording_not_found');
  });

  it('ungültige seq: 400 validation_failed, nichts wird geschrieben', async () => {
    const rec = await newRecording();
    for (const seq of ['-1', 'abc', '1.5', '01', '2147483648']) {
      const res = await putChunk(rec.id, seq, bytes(10));
      expect(res.statusCode, seq).toBe(400);
      expect(errorCode(res)).toBe('validation_failed');
    }
    expect(existsSync(join(t.config.dataDir, 'media', 'recordings'))).toBe(false);
  });

  it('Chunks sind auch nach dem Ende der Session erlaubt (Nachlieferung)', async () => {
    const rec = await newRecording();
    await t.handle.db.update(session).set({ state: 'beendet' }).where(eq(session.id, sessionId));
    expect((await putChunk(rec.id, 0, bytes(10))).statusCode).toBe(201);
  });

  it('gelöschte Aufnahme: 404', async () => {
    const rec = await newRecording();
    await t.handle.db.update(recording).set({ deletedAt: new Date() }).where(eq(recording.id, rec.id));
    expect((await putChunk(rec.id, 0, bytes(10))).statusCode).toBe(404);
  });
});

describe('POST /recordings/{id}/complete', () => {
  const complete = (id: string, body: object) =>
    t.request({ method: 'POST', url: `${API}/recordings/${id}/complete`, payload: body });

  it('setzt completed_at und legt genau einen audio.finalize-Job an', async () => {
    const rec = await newRecording();
    await putChunk(rec.id, 0, bytes(10, 1));
    await putChunk(rec.id, 1, bytes(10, 2));
    const res = await complete(rec.id, { last_seq: 1, duration_ms: 60_000 });
    expect(res.statusCode).toBe(200);
    const done = RecordingSchema.parse(res.json());
    expect(done.completed_at).not.toBeNull();
    expect(done).toMatchObject({ chunk_count: 2, last_seq: 1 });

    const jobs = await finalizeJobs();
    expect(jobs).toHaveLength(1);
    const [j] = jobs;
    expect(AudioFinalizePayloadSchema.parse(j?.payload)).toEqual({ recording_id: rec.id });
    expect(j).toMatchObject({ state: 'wartet', sessionId, runAfter: null });
  });

  it('Wiederholung mit denselben Werten legt keinen zweiten Job an', async () => {
    const rec = await newRecording();
    await putChunk(rec.id, 0, bytes(10));
    const first = RecordingSchema.parse(
      (await complete(rec.id, { last_seq: 0, duration_ms: 30_000 })).json(),
    );
    const again = await complete(rec.id, { last_seq: 0, duration_ms: 30_000 });
    expect(again.statusCode).toBe(200);
    expect(RecordingSchema.parse(again.json()).completed_at).toBe(first.completed_at);
    expect(await finalizeJobs()).toHaveLength(1);
  });

  it('wartender Job vom Session-Stopp wird sofort fällig, es entsteht kein zweiter', async () => {
    const rec = await newRecording();
    await putChunk(rec.id, 0, bytes(10));
    const jobId = uuidv7();
    await t.handle.db.insert(job).values({
      id: jobId,
      userId: SINGLE_USER_ID,
      type: 'audio.finalize',
      payload: { recording_id: rec.id },
      sessionId,
      runAfter: new Date(Date.now() + 10 * 60_000),
    });
    expect((await complete(rec.id, { last_seq: 0, duration_ms: 30_000 })).statusCode).toBe(200);
    const jobs = await finalizeJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe(jobId);
    expect(jobs[0]?.runAfter?.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('last_seq unter einer empfangenen seq: 409 recording_seq_conflict, kein Job', async () => {
    const rec = await newRecording();
    await putChunk(rec.id, 0, bytes(10, 1));
    await putChunk(rec.id, 3, bytes(10, 2));
    const res = await complete(rec.id, { last_seq: 2, duration_ms: 90_000 });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('recording_seq_conflict');
    expect(await finalizeJobs()).toHaveLength(0);
    const got = RecordingSchema.parse(
      (await t.request({ method: 'GET', url: `${API}/recordings/${rec.id}` })).json(),
    );
    expect(got.completed_at).toBeNull();
  });

  it('last_seq über der höchsten empfangenen seq ist erlaubt (Lücken am Ende, später mit_luecken)', async () => {
    const rec = await newRecording();
    await putChunk(rec.id, 0, bytes(10));
    expect((await complete(rec.id, { last_seq: 4, duration_ms: 150_000 })).statusCode).toBe(200);
  });

  it('Aufnahme ohne Chunks lässt sich abschließen (last_seq 0)', async () => {
    const rec = await newRecording();
    expect((await complete(rec.id, { last_seq: 0, duration_ms: 0 })).statusCode).toBe(200);
    expect(await finalizeJobs()).toHaveLength(0);
    // Kommt doch ein Chunk, entsteht der Job (Aufnahme ist abgeschlossen: sofort)
    expect((await putChunk(rec.id, 0, bytes(10))).statusCode).toBe(201);
    const jobs = await finalizeJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.runAfter).toBeNull();
  });

  it('prüft den Body und die ID', async () => {
    const rec = await newRecording();
    for (const body of [
      {},
      { last_seq: -1, duration_ms: 1 },
      { last_seq: 1 },
      { last_seq: 1.5, duration_ms: 1 },
    ]) {
      expect((await complete(rec.id, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    const unknown = await complete(uuidv7(), { last_seq: 0, duration_ms: 0 });
    expect(unknown.statusCode).toBe(404);
    expect(errorCode(unknown)).toBe('recording_not_found');
  });

  it('Chunk nach einem fertigen audio.finalize legt einen neuen Job an, aber nur einen', async () => {
    const rec = await newRecording();
    await putChunk(rec.id, 0, bytes(10, 1));
    await complete(rec.id, { last_seq: 1, duration_ms: 60_000 });
    await t.handle.db.update(job).set({ state: 'fertig' }).where(eq(job.type, 'audio.finalize'));

    expect((await putChunk(rec.id, 1, bytes(10, 2))).statusCode).toBe(201);
    let jobs = await finalizeJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs.filter((j) => j.state === 'wartet')).toHaveLength(1);

    // Noch ein Nachzügler und ein Duplikat: es wartet schon einer
    await putChunk(rec.id, 2, bytes(10, 3));
    await putChunk(rec.id, 2, bytes(10, 3));
    jobs = await finalizeJobs();
    expect(jobs).toHaveLength(2);
  });

  it('Chunk vor jedem Job (Aufnahme läuft noch) legt keinen Job an', async () => {
    const rec = await newRecording();
    await putChunk(rec.id, 0, bytes(10));
    expect(await finalizeJobs()).toHaveLength(0);
  });

  it('ein erneutes complete nach fertigem Job stößt die Verarbeitung neu an', async () => {
    const rec = await newRecording();
    await putChunk(rec.id, 0, bytes(10));
    await complete(rec.id, { last_seq: 0, duration_ms: 30_000 });
    await t.handle.db.update(job).set({ state: 'fertig' }).where(eq(job.type, 'audio.finalize'));
    await putChunk(rec.id, 1, bytes(10, 2));
    await t.handle.db.update(job).set({ state: 'fertig' }).where(eq(job.type, 'audio.finalize'));
    expect((await complete(rec.id, { last_seq: 1, duration_ms: 60_000 })).statusCode).toBe(200);
    const jobs = await finalizeJobs();
    expect(jobs.filter((j) => j.state === 'wartet')).toHaveLength(1);
    const completed = await t.handle.db
      .select({ last: recording.completedLastSeq, dur: recording.completedDurationMs })
      .from(recording)
      .where(and(eq(recording.id, rec.id), sql`true`));
    expect(completed[0]).toEqual({ last: 1, dur: 60_000 });
  });
});

describe('Nachträglich angelegte Aufnahme (offline gestartet, Session schon beendet)', () => {
  const START = new Date('2026-11-04T10:00:00Z');
  const END = new Date('2026-11-04T11:30:00Z'); // 90 min
  async function endedSession(extra: Partial<typeof session.$inferInsert> = {}) {
    const id = uuidv7();
    await t.handle.db.insert(session).values({
      id,
      userId: SINGLE_USER_ID,
      moduleId,
      state: 'beendet',
      startedFrom: 'ipad',
      startedAt: START,
      endedAt: END,
      stopReason: 'manuell',
      ...extra,
    } as typeof session.$inferInsert);
    return id;
  }

  it('erlaubt started_ms bis Ende + 5 min und legt den Job beim ersten Chunk mit run_after = jetzt + 10 min an', async () => {
    const sid = await endedSession();
    const before = Date.now();
    const res = await createRec({ started_ms: 90 * 60_000 + 5 * 60_000 }, sid);
    expect(res.statusCode).toBe(201);
    const id = RecordingSchema.parse(res.json()).id;
    expect(await finalizeJobs()).toHaveLength(0); // leer: noch kein Job
    const upload = Date.now();
    expect((await putChunk(id, 0, bytes(10))).statusCode).toBe(201);
    const jobs = await finalizeJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ state: 'wartet', sessionId: sid });
    expect((jobs[0]?.payload as { recording_id: string }).recording_id).toBe(id);
    const delay = (jobs[0]?.runAfter?.getTime() ?? 0) - upload;
    expect(before).toBeLessThanOrEqual(upload);
    expect(delay).toBeGreaterThan(9.9 * 60_000);
    expect(delay).toBeLessThan(10.5 * 60_000);
    // Sessionstatus bleibt unverändert
    const [row] = await t.handle.db.select().from(session).where(eq(session.id, sid));
    expect(row?.state).toBe('beendet');
    expect(row?.endedAt?.toISOString()).toBe(END.toISOString());
  });

  it('complete zieht den Job vor, es bleibt bei einem', async () => {
    const sid = await endedSession();
    const rec = RecordingSchema.parse((await createRec({ started_ms: 1000 }, sid)).json());
    await putChunk(rec.id, 0, bytes(10));
    expect(
      (
        await t.request({
          method: 'POST',
          url: `${API}/recordings/${rec.id}/complete`,
          payload: { last_seq: 0, duration_ms: 30_000 },
        })
      ).statusCode,
    ).toBe(200);
    const jobs = await finalizeJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.runAfter?.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('lehnt started_ms hinter der Grenze mit 409 session_not_active und details.ended_at ab', async () => {
    const sid = await endedSession();
    const res = await createRec({ started_ms: 90 * 60_000 + 5 * 60_000 + 1 }, sid);
    expect(res.statusCode).toBe(409);
    const err = ApiErrorSchema.parse(res.json()).error;
    expect(err.code).toBe('session_not_active');
    expect(err.details).toEqual({ ended_at: END.toISOString() });
    expect(await finalizeJobs()).toHaveLength(0);
  });

  it('auto_stop_extended_until verschiebt die Grenze', async () => {
    const sid = await endedSession({ autoStopExtendedUntil: new Date(END.getTime() + 30 * 60_000) });
    expect((await createRec({ started_ms: 120 * 60_000 }, sid)).statusCode).toBe(201);
  });

  it('absturz_wiederhergestellt: Grenze started_at + 12 h (offene Lead-Frage)', async () => {
    const sid = await endedSession({
      stopReason: 'absturz_wiederhergestellt',
      endedAt: new Date(START.getTime() + 60_000),
    });
    expect((await createRec({ started_ms: 11 * 3_600_000 }, sid)).statusCode).toBe(201);
    expect((await createRec({ started_ms: 12 * 3_600_000 + 5 * 60_000 + 1 }, sid)).statusCode).toBe(409);
  });

  it('Sessions ohne started_at oder im Zustand bereit/geplant bleiben abgelehnt', async () => {
    for (const state of ['bereit', 'geplant', 'verpasst']) {
      expect((await createRec({}, await seedSession(state))).statusCode, state).toBe(409);
    }
  });
});

describe('ensureFinalizeOnStop (T1-02)', () => {
  const stopAt = new Date('2026-11-04T11:00:00Z');
  const run = (id: string) => t.handle.db.transaction((tx) => ensureFinalizeOnStop(tx, id, stopAt));

  it('legt ohne Job einen mit run_after = Stopp + 10 min an, ein zweiter Aufruf nichts', async () => {
    const rec = await newRecording();
    await putChunk(rec.id, 0, bytes(10));
    await run(rec.id);
    await run(rec.id);
    const jobs = await finalizeJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.runAfter?.toISOString()).toBe('2026-11-04T11:10:00.000Z');
  });

  it('sofort, wenn die Aufnahme schon abgeschlossen ist; kein zweiter Job nach complete', async () => {
    const rec = await newRecording();
    await putChunk(rec.id, 0, bytes(10));
    await t.request({
      method: 'POST',
      url: `${API}/recordings/${rec.id}/complete`,
      payload: { last_seq: 0, duration_ms: 1 },
    });
    await run(rec.id);
    expect(await finalizeJobs()).toHaveLength(1);
  });

  it('Stopp mit einer leeren und einer nicht leeren Aufnahme ergibt genau einen Job', async () => {
    const empty = await newRecording();
    const full = await newRecording();
    await putChunk(full.id, 0, bytes(10));
    for (const id of [empty.id, full.id].sort()) await run(id);
    const jobs = await finalizeJobs();
    expect(jobs).toHaveLength(1);
    expect((jobs[0]?.payload as { recording_id: string }).recording_id).toBe(full.id);
    // Kommt später doch ein Chunk der leeren Aufnahme (Session ist nicht mehr aktiv): normale Logik legt den Job an
    await t.handle.db.update(session).set({ state: 'beendet' }).where(eq(session.id, sessionId));
    await putChunk(empty.id, 0, bytes(10, 5));
    expect(await finalizeJobs()).toHaveLength(2);
  });

  it('laufender oder fertiger Job: nichts; fehlgeschlagener oder abgebrochener: neuer Job', async () => {
    const rec = await newRecording();
    await putChunk(rec.id, 0, bytes(10));
    await run(rec.id);
    for (const state of ['laeuft', 'fertig']) {
      await t.handle.db.update(job).set({ state }).where(eq(job.type, 'audio.finalize'));
      await run(rec.id);
      expect(await finalizeJobs()).toHaveLength(1);
    }
    await t.handle.db.update(job).set({ state: 'abgebrochen' }).where(eq(job.type, 'audio.finalize'));
    await run(rec.id);
    expect(await finalizeJobs()).toHaveLength(2);
  });

  it('Chunk nach abgebrochenem Job löst einen neuen aus', async () => {
    const rec = await newRecording();
    await putChunk(rec.id, 0, bytes(10));
    await run(rec.id);
    await t.handle.db.update(job).set({ state: 'abgebrochen' }).where(eq(job.type, 'audio.finalize'));
    await putChunk(rec.id, 1, bytes(10, 2));
    expect((await finalizeJobs()).filter((j) => j.state === 'wartet')).toHaveLength(1);
  });
});

describe('Chunks nach complete', () => {
  it('seq hinter last_seq: 409 recording_completed; gleiche seq mit gleichem sha256 bleibt Duplikat', async () => {
    const rec = await newRecording();
    const data = bytes(10);
    await putChunk(rec.id, 0, data);
    await t.request({
      method: 'POST',
      url: `${API}/recordings/${rec.id}/complete`,
      payload: { last_seq: 0, duration_ms: 1 },
    });
    const late = await putChunk(rec.id, 1, bytes(10, 2));
    expect(late.statusCode).toBe(409);
    expect(errorCode(late)).toBe('recording_completed');
    const dup = await putChunk(rec.id, 0, data);
    expect(dup.statusCode).toBe(200);
    // Lücke innerhalb von last_seq darf nachgeliefert werden
    const rec2 = await newRecording();
    await putChunk(rec2.id, 1, bytes(10, 3));
    await t.request({
      method: 'POST',
      url: `${API}/recordings/${rec2.id}/complete`,
      payload: { last_seq: 1, duration_ms: 1 },
    });
    expect((await putChunk(rec2.id, 0, bytes(10, 4))).statusCode).toBe(201);
  });
});

describe('GET /recordings/{id}/audio', () => {
  it('ohne full.m4a: 404 audio_not_ready', async () => {
    const rec = await newRecording();
    const res = await t.request({ method: 'GET', url: `${API}/recordings/${rec.id}/audio` });
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('audio_not_ready');
  });

  it('liefert full.m4a als audio/mp4 mit Range', async () => {
    const rec = await newRecording();
    const dir = join(t.config.dataDir, 'media', 'recordings', rec.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'full.m4a'), Buffer.from('0123456789'));
    const all = await t.request({ method: 'GET', url: `${API}/recordings/${rec.id}/audio` });
    expect(all.statusCode).toBe(200);
    expect(all.headers['content-type']).toBe('audio/mp4');
    expect(all.body).toBe('0123456789');
    const part = await t.request({
      method: 'GET',
      url: `${API}/recordings/${rec.id}/audio`,
      headers: { range: 'bytes=2-4' },
    });
    expect(part.statusCode).toBe(206);
    expect(part.body).toBe('234');
  });

  it('unbekannte Aufnahme: 404 recording_not_found', async () => {
    const res = await t.request({ method: 'GET', url: `${API}/recordings/${uuidv7()}/audio` });
    expect(errorCode(res)).toBe('recording_not_found');
  });
});
