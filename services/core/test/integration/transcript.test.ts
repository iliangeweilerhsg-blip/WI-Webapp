// T2-02b: Verarbeitungskette beim Stopp, Fortschritt („neuester Job je Einheit“), GET /sessions/{id}/transcript,
// POST /sessions/{id}/reprocess und die Kaskade der Session (VERTRAEGE §18). Echte Datenbank.
// Die Tests schreiben Transkripte und Segmente selbst, der Worker (T2-02a) läuft nicht.
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SINGLE_USER_ID,
  SessionReprocessResultSchema,
  SessionTranscriptSchema,
  type JobState,
  type SyncEvent,
  type TranscriptWord,
} from '@sg/shared';
import type { DbHandle } from '../../src/db/client.ts';
import {
  audioChunk,
  courseModule,
  job,
  recording,
  semester,
  session,
  slide,
  slideDeck,
  slideSegment,
  transcript,
  transcriptSegment,
} from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { ensurePipelineJobs, summarizeProcessing } from '../../src/services/pipeline.ts';
import { storeChunk } from '../../src/services/recordings.ts';
import { setSessionEventPublisher, transitionSession } from '../../src/services/sessions.ts';
import { restoreWithOps, softDeleteWithOps } from '../../src/services/trash-ops.ts';
import { startTestApp, type TestApp } from './helpers.ts';

let handle: DbHandle;
let app: TestApp;
const base = { userId: SINGLE_USER_ID };
const API = '/api/v1';
let events: SyncEvent[] = [];
let moduleId = '';

/** Minuten nach 2026-11-04 09:00 UTC */
const T = (min: number): Date => new Date(Date.UTC(2026, 10, 4, 9, 0) + min * 60_000);
const HEX = 'a'.repeat(64);

beforeAll(async () => {
  app = await startTestApp();
  handle = app.handle;
  setSessionEventPublisher(async (_tx, event) => {
    events.push(event);
  });
});
afterAll(async () => {
  setSessionEventPublisher(null);
  await truncate();
  await app.close();
});
beforeEach(async () => {
  await truncate();
  events = [];
  const semesterId = uuidv7();
  moduleId = uuidv7();
  await handle.db.insert(semester).values({ id: semesterId, ...base, name: 'HS 2026' });
  await handle.db
    .insert(courseModule)
    .values({ id: moduleId, ...base, semesterId, name: 'Datenbanken', color: 'mod-01' });
});

async function truncate() {
  await handle.sql`TRUNCATE semester, module, calendar_source, calendar_event, session, slide_deck, job,
    sync_op, sync_stream, setting, recording, idempotency_key CASCADE`;
}

// --- Hilfen ----------------------------------------------------------------------------------

type SessionInsert = typeof session.$inferInsert;

async function mkSession(over: Partial<SessionInsert> = {}): Promise<string> {
  const id = uuidv7();
  await handle.db.insert(session).values({ id, ...base, moduleId, state: 'verarbeitet', ...over });
  return id;
}

async function mkRecording(
  sessionId: string,
  over: { chunk?: boolean; startedMs?: number; durationMs?: number | null; completed?: boolean } = {},
): Promise<string> {
  const id = uuidv7();
  await handle.db.insert(recording).values({
    id,
    ...base,
    sessionId,
    mime: 'audio/webm',
    codec: 'opus',
    startedMs: over.startedMs ?? 0,
    durationMs: over.durationMs ?? null,
    completedAt: over.completed === false ? null : T(1),
  });
  if (over.chunk !== false) {
    await handle.db.insert(audioChunk).values({
      id: uuidv7(),
      ...base,
      recordingId: id,
      seq: 0,
      startMs: 0,
      durationMs: 1000,
      filePath: `media/recordings/${id}/chunks/0.webm`,
      sha256: 'c'.repeat(64),
      sizeBytes: 10,
    });
  }
  return id;
}

let clock = 0;
/** Job mit strikt aufsteigendem `created_at` (die Regel „neuester Job“ hängt daran) */
async function mkJob(
  sessionId: string,
  type: 'audio.finalize' | 'transcribe' | 'align.log',
  state: JobState,
  extra: { recordingId?: string; dependsOn?: string[]; force?: boolean } = {},
): Promise<string> {
  const id = uuidv7();
  clock += 1;
  const payload =
    type === 'audio.finalize'
      ? { recording_id: extra.recordingId }
      : { session_id: sessionId, ...(extra.force ? { force: true } : {}) };
  await handle.db.insert(job).values({
    id,
    ...base,
    type,
    payload,
    state,
    sessionId,
    dependsOn: extra.dependsOn ?? [],
    createdAt: new Date(Date.UTC(2026, 10, 4, 9, 0, 0) + clock * 1000),
  });
  return id;
}

const jobsOf = async (sessionId: string, type?: string) => {
  const rows = await handle.db
    .select()
    .from(job)
    .where(eq(job.sessionId, sessionId))
    .orderBy(asc(job.createdAt), asc(job.id));
  return type ? rows.filter((j) => j.type === type) : rows;
};

async function sessionRow(id: string) {
  const [row] = await handle.db.select().from(session).where(eq(session.id, id));
  if (!row) throw new Error('Session fehlt');
  return row;
}

const stop = (id: string) =>
  handle.db.transaction((tx) =>
    transitionSession(tx, id, 'stop', { origin: 'server', at: T(60), now: T(60) }),
  );

const post = (id: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request({
    method: 'POST',
    url: `${API}/sessions/${id}/reprocess`,
    ...(body === undefined ? {} : { payload: body as object }),
    headers,
  });

const getTranscript = (id: string, query = '') =>
  app.request({ method: 'GET', url: `${API}/sessions/${id}/transcript${query}` });

// --- Kette beim Stopp (§18.2) ------------------------------------------------------------------

describe('Kette beim Stopp', () => {
  async function runningSession(state: 'laeuft' | 'pausiert' = 'laeuft') {
    const id = await mkSession({ state, startedAt: T(0) });
    const rec = await mkRecording(id);
    return { id, rec };
  }

  it('[K1] Stopp mit Audio: audio.finalize, transcribe (20) und align.log (10) mit depends_on, processing, Zustand beendet', async () => {
    const { id, rec } = await runningSession();
    const stopped = (await stop(id)).session;
    expect(stopped.state).toBe('beendet');
    const [finalize] = await jobsOf(id, 'audio.finalize');
    const [transcribe] = await jobsOf(id, 'transcribe');
    const [align] = await jobsOf(id, 'align.log');
    expect(finalize).toMatchObject({ state: 'wartet', payload: { recording_id: rec } });
    expect(transcribe).toMatchObject({
      state: 'wartet',
      priority: 20,
      dependsOn: [finalize!.id],
      payload: { session_id: id },
      sessionId: id,
    });
    expect(align).toMatchObject({
      state: 'wartet',
      priority: 10,
      dependsOn: [finalize!.id],
      payload: { session_id: id },
    });
    // Schrittliste: auch audio.finalize (in der Gnadenfrist wartend) steht in processing
    expect(stopped.processing).toEqual({
      'audio.finalize': 'wartet',
      transcribe: 'wartet',
      'align.log': 'wartet',
    });
    // align.log hängt nicht von transcribe ab
    expect(align!.dependsOn).not.toContain(transcribe!.id);
    expect(events.filter((e) => e.name === 'session.updated').at(-1)?.data).toMatchObject({
      state: 'beendet',
      processing: { 'audio.finalize': 'wartet', transcribe: 'wartet', 'align.log': 'wartet' },
    });
  });

  it('[K2] Stopp während einer Pause legt dieselbe Kette an', async () => {
    const { id } = await runningSession('pausiert');
    const stopped = (await stop(id)).session;
    expect(stopped.state).toBe('beendet');
    expect((await jobsOf(id)).map((j) => j.type).sort()).toEqual([
      'align.log',
      'audio.finalize',
      'transcribe',
    ]);
    expect(stopped.processing).toEqual({
      'audio.finalize': 'wartet',
      transcribe: 'wartet',
      'align.log': 'wartet',
    });
  });

  it('[K3] Stopp ohne Audio (Aufnahme ohne Chunk oder keine Aufnahme): keine Kette, sofort verarbeitet', async () => {
    const empty = await mkSession({ state: 'laeuft', startedAt: T(0) });
    await mkRecording(empty, { chunk: false });
    expect((await stop(empty)).session).toMatchObject({ state: 'verarbeitet', processing: {} });
    expect(await jobsOf(empty)).toEqual([]);
    const none = await mkSession({ state: 'pausiert', startedAt: T(0) });
    expect((await stop(none)).session.state).toBe('verarbeitet');
    expect(await jobsOf(none)).toEqual([]);
  });

  it('[K4] audio.finalize schon fertig (Aufnahme vorher abgeschlossen): Kette ohne Abhängigkeit, Session beendet', async () => {
    const { id, rec } = await runningSession();
    const done = await mkJob(id, 'audio.finalize', 'fertig', { recordingId: rec });
    const stopped = (await stop(id)).session;
    expect(stopped.state).toBe('beendet');
    expect(await jobsOf(id, 'audio.finalize')).toHaveLength(1); // ensureFinalizeOnStop lässt den fertigen Job stehen
    const [transcribe] = await jobsOf(id, 'transcribe');
    expect(transcribe).toMatchObject({ state: 'wartet', dependsOn: [] });
    expect(done).toBeTruthy();
    expect(stopped.processing).toEqual({
      'audio.finalize': 'fertig',
      transcribe: 'wartet',
      'align.log': 'wartet',
    });
  });

  it('[K5] Nachzügler: Chunk nach dem Stopp legt nur audio.finalize an und setzt stale, keine neue Kette', async () => {
    const id = await mkSession({ state: 'verarbeitet', startedAt: T(0), endedAt: T(60) });
    const rec = await mkRecording(id, { durationMs: 60_000 });
    const finalizeA = await mkJob(id, 'audio.finalize', 'fertig', { recordingId: rec });
    await mkJob(id, 'transcribe', 'fertig');
    await mkJob(id, 'align.log', 'fertig');
    await handle.db.insert(transcript).values({
      id: uuidv7(),
      ...base,
      sessionId: id,
      recordingId: rec,
      jobId: uuidv7(),
      finalizeJobId: finalizeA,
      provider: 'fake',
      model: 'fake-1',
      inputHash: HEX,
      audioSha256: HEX,
      audioDurationMs: 60_000,
      segmentCount: 0,
      wordCount: 0,
    });
    const before = await getTranscript(id);
    expect(before.json().stale).toBe(false);

    // Nachzügler: ein später Chunk der (abgeschlossenen) Aufnahme
    const buf = Buffer.from('nachzuegler');
    await storeChunk(
      handle.db,
      rec,
      {
        seq: 1,
        start_ms: 1000,
        duration_ms: 5000,
        sha256: createHash('sha256').update(buf).digest('hex'),
      },
      'audio/webm',
      Readable.from([buf]),
      { dataDir: app.config.dataDir },
    );
    const finalizeJobs = await jobsOf(id, 'audio.finalize');
    expect(finalizeJobs).toHaveLength(2);
    const [, finalizeB] = finalizeJobs;
    // keine automatische Kette: weiterhin je ein transcribe- und align.log-Job
    expect(await jobsOf(id, 'transcribe')).toHaveLength(1);
    expect(await jobsOf(id, 'align.log')).toHaveLength(1);
    // Solange der neue Job nicht fertig ist, bleibt das Transkript aktuell
    expect((await getTranscript(id)).json().stale).toBe(false);
    await handle.db.update(job).set({ state: 'fertig' }).where(eq(job.id, finalizeB!.id));
    const after = (await getTranscript(id)).json();
    expect(after.stale).toBe(true);
    expect(after.transcripts[0].stale).toBe(true);
    // Session bleibt verarbeitet
    expect((await sessionRow(id)).state).toBe('verarbeitet');
  });
});

// --- ensurePipelineJobs (§18.2) ------------------------------------------------------------------

describe('ensurePipelineJobs', () => {
  const ensure = (id: string, fromStep: 'audio.finalize' | 'transcribe' | 'align.log', force = false) =>
    handle.db.transaction((tx) => ensurePipelineJobs(tx, id, { fromStep, force, emit: false }));

  it('[P1] wiederholter Aufruf legt keine doppelten wartenden Jobs an, force wird alt ODER neu, depends_on ergänzt', async () => {
    const id = await mkSession();
    const rec = await mkRecording(id);
    const fin = await mkJob(id, 'audio.finalize', 'wartet', { recordingId: rec });
    const first = await ensure(id, 'transcribe');
    const second = await ensure(id, 'transcribe', true);
    const third = await ensure(id, 'transcribe', false);
    expect(second.map((j) => j.id)).toEqual(first.map((j) => j.id));
    expect(await jobsOf(id, 'transcribe')).toHaveLength(1);
    expect(await jobsOf(id, 'align.log')).toHaveLength(1);
    const [t] = await jobsOf(id, 'transcribe');
    expect(t!.payload).toEqual({ session_id: id, force: true }); // alt ODER neu: bleibt true
    expect(t!.dependsOn).toEqual([fin]);
    expect(third).toHaveLength(2);
  });

  it('[P2] ein laufender Job desselben Typs wird Abhängigkeit des neuen (Fehlschlag wird geerbt)', async () => {
    const id = await mkSession();
    const rec = await mkRecording(id);
    await mkJob(id, 'audio.finalize', 'fertig', { recordingId: rec });
    const runningT = await mkJob(id, 'transcribe', 'laeuft');
    const runningA = await mkJob(id, 'align.log', 'laeuft');
    const [t, a] = await ensure(id, 'transcribe');
    expect(t!.dependsOn).toEqual([runningT]);
    expect(a!.dependsOn).toEqual([runningA]);
  });

  it('[P7] wiederverwendeter wartender Job verliert Abhängigkeiten in fehler/abgebrochen/gelöscht/unbekannt, behält tragende', async () => {
    const id = await mkSession();
    const rec = await mkRecording(id);
    const failed = await mkJob(id, 'audio.finalize', 'fehler', { recordingId: rec });
    const cancelled = await mkJob(id, 'audio.finalize', 'abgebrochen', { recordingId: rec });
    const deleted = await mkJob(id, 'audio.finalize', 'wartet', { recordingId: rec });
    await handle.db
      .update(job)
      .set({ deletedAt: T(1) })
      .where(eq(job.id, deleted));
    const done = await mkJob(id, 'audio.finalize', 'fertig', { recordingId: rec });
    const ghost = uuidv7();
    const waitingT = await mkJob(id, 'transcribe', 'wartet', {
      dependsOn: [failed, cancelled, deleted, done, ghost],
    });
    await ensure(id, 'transcribe');
    const [t] = await jobsOf(id, 'transcribe');
    expect(t!.id).toBe(waitingT);
    // tragend bleibt nur der fertige Job; die gescheiterte ID darf nicht in depends_on stehen
    expect(t!.dependsOn).toEqual([done]);
    expect(t!.dependsOn).not.toContain(failed);
  });

  it('[P8] Reprocess-Route: wartender transcribe mit gescheitertem audio.finalize, danach from_step transcribe', async () => {
    const id = await mkSession({ processing: { 'audio.finalize': 'fehler' } });
    const rec = await mkRecording(id);
    const failed = await mkJob(id, 'audio.finalize', 'fehler', { recordingId: rec });
    await mkJob(id, 'transcribe', 'wartet', { dependsOn: [failed] });
    const res = await post(id, { from_step: 'transcribe' });
    expect(res.statusCode).toBe(202);
    const transcribes = await jobsOf(id, 'transcribe');
    expect(transcribes).toHaveLength(1);
    expect(transcribes[0]!.dependsOn).not.toContain(failed);
    expect(transcribes[0]!.dependsOn).toEqual([]);
  });

  it('[P3] Rückgabe in Ketten-Reihenfolge; align.log fasst transcribe nicht an', async () => {
    const id = await mkSession();
    const a = await mkRecording(id);
    const b = await mkRecording(id);
    const jobs = await ensure(id, 'audio.finalize');
    const order = [a, b].sort();
    expect(jobs.map((j) => j.type)).toEqual(['audio.finalize', 'audio.finalize', 'transcribe', 'align.log']);
    expect(jobs.slice(0, 2).map((j) => (j.payload as { recording_id: string }).recording_id)).toEqual(order);
    expect(jobs[2]!.dependsOn).toHaveLength(2);

    const id2 = await mkSession({ state: 'beendet' });
    await mkRecording(id2);
    const onlyAlign = await ensure(id2, 'align.log');
    expect(onlyAlign.map((j) => j.type)).toEqual(['align.log']);
    expect(await jobsOf(id2, 'transcribe')).toEqual([]);
  });

  it('[P4] audio.finalize: wartet → run_after = jetzt, laeuft → wiederverwendet, fertig → nur mit force neu, fehler → neu ohne Wartezeit', async () => {
    const id = await mkSession();
    const waiting = await mkRecording(id);
    const running = await mkRecording(id);
    const done = await mkRecording(id);
    const failed = await mkRecording(id);
    const wJob = await mkJob(id, 'audio.finalize', 'wartet', { recordingId: waiting });
    await handle.db
      .update(job)
      .set({ runAfter: new Date(Date.now() + 3_600_000) })
      .where(eq(job.id, wJob));
    const rJob = await mkJob(id, 'audio.finalize', 'laeuft', { recordingId: running });
    await mkJob(id, 'audio.finalize', 'fertig', { recordingId: done });
    await mkJob(id, 'audio.finalize', 'fehler', { recordingId: failed });

    const first = await ensure(id, 'audio.finalize');
    const finalize = first.filter((j) => j.type === 'audio.finalize');
    expect(finalize.map((j) => j.id)).toContain(wJob);
    expect(finalize.map((j) => j.id)).toContain(rJob);
    expect(finalize).toHaveLength(3); // wartet, laeuft, neuer nach fehler; fertig bleibt ohne force
    const [reused] = await handle.db.select().from(job).where(eq(job.id, wJob));
    expect(reused!.runAfter!.getTime()).toBeLessThan(Date.now() + 5000);
    const fresh = finalize.find((j) => ![wJob, rJob].includes(j.id))!;
    expect(fresh).toMatchObject({ state: 'wartet', runAfter: null });
    expect((fresh.payload as { recording_id: string }).recording_id).toBe(failed);

    const forced = await ensure(id, 'audio.finalize', true);
    const forcedFinalize = forced.filter((j) => j.type === 'audio.finalize');
    expect(forcedFinalize).toHaveLength(4);
    expect((await jobsOf(id, 'audio.finalize')).filter((j) => j.state === 'fertig')).toHaveLength(1);
  });

  it('[P5] Fortschritt: ein wartender Job überschreibt keinen laufenden (laeuft bleibt laeuft)', async () => {
    const id = await mkSession();
    const rec = await mkRecording(id);
    await mkJob(id, 'audio.finalize', 'fertig', { recordingId: rec });
    await mkJob(id, 'transcribe', 'laeuft');
    await ensure(id, 'transcribe'); // legt zusätzlich einen wartenden transcribe an
    const row = await sessionRow(id);
    expect(row.processing).toMatchObject({ transcribe: 'laeuft', 'align.log': 'wartet' });
    expect(await jobsOf(id, 'transcribe')).toHaveLength(2);
  });

  it('[P6] Fortschritt: „neuester Job je Einheit“ über mehrere Aufnahmen und Jobs', async () => {
    const id = await mkSession();
    const a = await mkRecording(id);
    const b = await mkRecording(id);
    const sum = () => handle.db.transaction((tx) => summarizeProcessing(tx, id, 'audio.finalize'));
    expect(await sum()).toBeNull(); // kein Job: Schlüssel bleibt unberührt
    await mkJob(id, 'audio.finalize', 'fehler', { recordingId: a });
    await mkJob(id, 'audio.finalize', 'fertig', { recordingId: b });
    expect(await sum()).toBe('fehler');
    await mkJob(id, 'audio.finalize', 'fertig', { recordingId: a }); // a wurde wiederholt
    expect(await sum()).toBe('fertig'); // der alte fehler zählt nicht mehr
    await mkJob(id, 'audio.finalize', 'wartet', { recordingId: b });
    expect(await sum()).toBe('wartet');
    await mkJob(id, 'audio.finalize', 'laeuft', { recordingId: a });
    expect(await sum()).toBe('laeuft');
    await mkJob(id, 'audio.finalize', 'wartet', { recordingId: a }); // laeuft + neuerer wartet = laeuft
    expect(await sum()).toBe('laeuft');
    const other = await mkSession();
    await mkJob(other, 'transcribe', 'abgebrochen');
    expect(await handle.db.transaction((tx) => summarizeProcessing(tx, other, 'transcribe'))).toBe(
      'abgebrochen',
    );
    await mkJob(other, 'transcribe', 'fehler');
    await mkJob(other, 'transcribe', 'abgebrochen');
    expect(await handle.db.transaction((tx) => summarizeProcessing(tx, other, 'transcribe'))).toBe(
      'abgebrochen',
    ); // nur der neueste zählt
  });
});

// --- POST /sessions/{id}/reprocess (§18.5) --------------------------------------------------------

describe('POST /sessions/{id}/reprocess', () => {
  it('[R1] 404 für unbekannte und weich gelöschte Session, 400 für ungültigen Body', async () => {
    expect((await post(uuidv7())).statusCode).toBe(404);
    expect((await post(uuidv7())).json().error.code).toBe('session_not_found');
    const id = await mkSession({ deletedAt: T(5) });
    await mkRecording(id);
    expect((await post(id)).json().error.code).toBe('session_not_found');
    const ok = await mkSession();
    await mkRecording(ok);
    expect((await post(ok, { from_step: 'nonsense' })).statusCode).toBe(400);
    expect((await post(ok, { from_step: 'transcribe', extra: 1 })).statusCode).toBe(400);
  });

  it('[R2] 409 session_not_ended mit details.state für jeden Zustand außer beendet/verarbeitet', async () => {
    for (const state of ['geplant', 'bereit', 'laeuft', 'pausiert', 'verpasst'] as const) {
      await handle.sql`UPDATE session SET state = 'bereit' WHERE state IN ('laeuft','pausiert')`; // höchstens eine aktive Session
      const id = await mkSession({ state });
      await mkRecording(id);
      const res = await post(id);
      expect(res.statusCode, state).toBe(409);
      expect(res.json()).toMatchObject({ error: { code: 'session_not_ended', details: { state } } });
      expect(await jobsOf(id)).toEqual([]);
    }
  });

  it('[R3] 409 session_no_audio ab transcribe/audio.finalize ohne Aufnahme mit Chunk, align.log braucht kein Audio', async () => {
    const id = await mkSession();
    await mkRecording(id, { chunk: false });
    for (const from_step of ['transcribe', 'audio.finalize', undefined] as const) {
      const res = await post(id, from_step ? { from_step } : undefined);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('session_no_audio');
    }
    expect(await jobsOf(id)).toEqual([]);
    const align = await post(id, { from_step: 'align.log' });
    expect(align.statusCode).toBe(202);
    expect(SessionReprocessResultSchema.parse(align.json()).jobs.map((j) => j.type)).toEqual(['align.log']);
    expect(await jobsOf(id, 'transcribe')).toEqual([]);
    // eine gelöschte Aufnahme zählt nicht
    const deletedOnly = await mkSession();
    const rec = await mkRecording(deletedOnly);
    await handle.db
      .update(recording)
      .set({ deletedAt: T(3) })
      .where(eq(recording.id, rec));
    expect((await post(deletedOnly)).json().error.code).toBe('session_no_audio');
  });

  it('[R4] nach fehler zeigt processing danach wartet, nicht weiter fehler; Zustand der Session bleibt', async () => {
    const id = await mkSession({
      state: 'verarbeitet',
      processing: { 'audio.finalize': 'fertig', transcribe: 'fehler', 'align.log': 'fertig' },
    });
    const rec = await mkRecording(id);
    await mkJob(id, 'audio.finalize', 'fertig', { recordingId: rec });
    await mkJob(id, 'transcribe', 'fehler');
    await mkJob(id, 'align.log', 'fertig');
    const res = await post(id, { from_step: 'transcribe' });
    expect(res.statusCode).toBe(202);
    const body = SessionReprocessResultSchema.parse(res.json());
    expect(body.jobs.map((j) => j.type)).toEqual(['transcribe', 'align.log']);
    expect(body.jobs.every((j) => j.state === 'wartet' && j.session_id === id)).toBe(true);
    expect(body.session.state).toBe('verarbeitet');
    expect(body.session.processing).toEqual({
      'audio.finalize': 'fertig',
      transcribe: 'wartet',
      'align.log': 'wartet',
    });
    expect((await sessionRow(id)).processing).toEqual(body.session.processing);
    // session.updated mit dem neuen Stand
    expect(events.at(-1)?.data).toMatchObject({ processing: { transcribe: 'wartet' } });
  });

  it('[R5] Standard-Schritt ist transcribe; wiederholter Aufruf und Idempotency-Key legen nichts doppelt an', async () => {
    const id = await mkSession();
    const rec = await mkRecording(id);
    await mkJob(id, 'audio.finalize', 'fertig', { recordingId: rec });
    const r1 = await post(id);
    const r2 = await post(id, {});
    const r3 = await post(id, null);
    expect([r1.statusCode, r2.statusCode, r3.statusCode]).toEqual([202, 202, 202]);
    expect(r2.json().jobs.map((j: { id: string }) => j.id)).toEqual(
      r1.json().jobs.map((j: { id: string }) => j.id),
    );
    expect(await jobsOf(id, 'transcribe')).toHaveLength(1);
    expect(await jobsOf(id, 'align.log')).toHaveLength(1);
    const key = { 'idempotency-key': uuidv7() };
    const k1 = await post(id, { force: true }, key);
    const k2 = await post(id, { force: true }, key);
    expect(k2.headers['idempotent-replay']).toBe('true');
    expect(k2.json()).toEqual(k1.json());
    expect(await jobsOf(id, 'transcribe')).toHaveLength(1);
    expect((await jobsOf(id, 'transcribe'))[0]!.payload).toEqual({ session_id: id, force: true });
  });

  it('[R6] „Mit vorhandenem Audio fortfahren“: audio.finalize steht auf fehler, from_step transcribe läuft trotzdem', async () => {
    const id = await mkSession({ processing: { 'audio.finalize': 'fehler' } });
    const rec = await mkRecording(id);
    await mkJob(id, 'audio.finalize', 'fehler', { recordingId: rec });
    const res = await post(id, { from_step: 'transcribe' });
    expect(res.statusCode).toBe(202);
    const [transcribe] = await jobsOf(id, 'transcribe');
    // der gescheiterte audio.finalize ist keine Abhängigkeit (sonst würde der Job sofort abgebrochen)
    expect(transcribe).toMatchObject({ state: 'wartet', dependsOn: [] });
    expect(res.json().session.processing).toEqual({
      'audio.finalize': 'fehler', // unverändert: from_step transcribe fasst audio.finalize nicht an
      transcribe: 'wartet',
      'align.log': 'wartet',
    });
    expect(await jobsOf(id, 'audio.finalize')).toHaveLength(1);
    // „Erneut versuchen“ ab audio.finalize legt dagegen einen neuen Job an und der Fortschritt dreht auf wartet
    const retry = await post(id, { from_step: 'audio.finalize' });
    expect(retry.statusCode).toBe(202);
    expect(await jobsOf(id, 'audio.finalize')).toHaveLength(2);
    expect(retry.json().session.processing['audio.finalize']).toBe('wartet');
    const [t2] = await jobsOf(id, 'transcribe');
    expect(t2!.dependsOn).toHaveLength(1); // jetzt hängt transcribe am neuen audio.finalize
  });

  it('[R7] ohne Aufnahme mit Chunks gibt es auch beim Fortfahren 409 session_no_audio', async () => {
    const id = await mkSession({ processing: { 'audio.finalize': 'fehler' } });
    await mkRecording(id, { chunk: false });
    const res = await post(id, { from_step: 'transcribe' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('session_no_audio');
  });

  it('[R8] from_step audio.finalize mit fertigem Audio: ohne force kein neuer Job, mit force ein neuer', async () => {
    const id = await mkSession();
    const rec = await mkRecording(id);
    await mkJob(id, 'audio.finalize', 'fertig', { recordingId: rec });
    const plain = await post(id, { from_step: 'audio.finalize' });
    expect(plain.json().jobs.map((j: { type: string }) => j.type)).toEqual(['transcribe', 'align.log']);
    expect(await jobsOf(id, 'audio.finalize')).toHaveLength(1);
    const forced = await post(id, { from_step: 'audio.finalize', force: true });
    expect(forced.json().jobs.map((j: { type: string }) => j.type)).toEqual([
      'audio.finalize',
      'transcribe',
      'align.log',
    ]);
    expect(await jobsOf(id, 'audio.finalize')).toHaveLength(2);
    const [t] = await jobsOf(id, 'transcribe');
    expect(t!.payload).toEqual({ session_id: id, force: true });
    expect(t!.dependsOn).toHaveLength(1);
  });
});

// --- GET /sessions/{id}/transcript (§18.4) -------------------------------------------------------

interface SegSpec {
  start: number;
  end: number;
  text: string;
  words?: [string, number, number][] | null;
}

async function mkTranscript(
  sessionId: string,
  recordingId: string,
  specs: SegSpec[],
  finalizeJobId?: string,
) {
  const id = uuidv7();
  await handle.db.insert(transcript).values({
    id,
    ...base,
    sessionId,
    recordingId,
    jobId: uuidv7(),
    finalizeJobId: finalizeJobId ?? uuidv7(),
    provider: 'fake',
    model: 'fake-1',
    language: 'de',
    inputHash: HEX,
    audioSha256: HEX,
    audioDurationMs: 100_000,
    segmentCount: specs.length,
    wordCount: 0,
  });
  const ids: string[] = [];
  for (const [seq, s] of specs.entries()) {
    const segId = uuidv7();
    ids.push(segId);
    const words: TranscriptWord[] | null =
      s.words === undefined || s.words === null
        ? null
        : s.words.map(([text, a, b]) => ({ text, start_ms: a, end_ms: b, prob: 0.9 }));
    await handle.db.insert(transcriptSegment).values({
      id: segId,
      ...base,
      transcriptId: id,
      sessionId,
      recordingId,
      seq,
      startMs: s.start,
      endMs: s.end,
      text: s.text,
      lang: 'de',
      words,
    });
  }
  return { transcriptId: id, segmentIds: ids };
}

async function mkSlides(sessionId: string, count: number): Promise<string[]> {
  const deckId = uuidv7();
  await handle.db.insert(slideDeck).values({
    id: deckId,
    ...base,
    moduleId,
    title: 'Folien',
    filePath: 'x.pdf',
    sha256: HEX,
    pageCount: count,
  });
  await handle.db.update(session).set({ slideDeckId: deckId }).where(eq(session.id, sessionId));
  const ids: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const sid = uuidv7();
    ids.push(sid);
    await handle.db.insert(slide).values({ id: sid, ...base, deckId, index: i, widthPt: 1, heightPt: 1 });
  }
  return ids;
}

async function mkSlideSegment(
  sessionId: string,
  slideId: string,
  slideIndex: number,
  start: number,
  end: number,
  source: 'log' | 'ausrichtung' | 'manuell' = 'log',
  deletedAt: Date | null = null,
) {
  const id = uuidv7();
  await handle.db.insert(slideSegment).values({
    id,
    ...base,
    sessionId,
    slideId,
    slideIndex,
    startMs: start,
    endMs: end,
    source,
    confidence: 1,
    deletedAt,
  });
  return id;
}

describe('GET /sessions/{id}/transcript', () => {
  it('[G1] 404 für unbekannte und gelöschte Session, 400 für ungültige Query', async () => {
    expect((await getTranscript(uuidv7())).json().error.code).toBe('session_not_found');
    const gone = await mkSession({ deletedAt: T(1) });
    expect((await getTranscript(gone)).statusCode).toBe(404);
    const id = await mkSession();
    for (const q of ['?slide_id=abc', '?include_words=ja', '?include_words=1']) {
      const res = await getTranscript(id, q);
      expect(res.statusCode, q).toBe(400);
      expect(res.json().error.code).toBe('validation_failed');
    }
  });

  it('[G2] leere Session: leere Listen, slide_source null, stale false; Antwort passt zum Schema', async () => {
    const id = await mkSession();
    const res = await getTranscript(id);
    expect(res.statusCode).toBe(200);
    expect(SessionTranscriptSchema.parse(res.json())).toEqual({
      session_id: id,
      slide_deck_id: null,
      slide_source: null,
      slide_segments: [],
      transcripts: [],
      recordings: [],
      lines: [],
      stale: false,
    });
  });

  it('[G3] Teilung an der Foliengrenze nach Wörtern (Mitte jedes Wortes), part ab 0, Zeiten vom ersten/letzten Wort', async () => {
    const id = await mkSession();
    const [s1, s2] = await mkSlides(id, 2);
    await mkSlideSegment(id, s1!, 1, 0, 5000);
    await mkSlideSegment(id, s2!, 2, 5000, 20_000);
    const rec = await mkRecording(id, { durationMs: 20_000 });
    const { segmentIds } = await mkTranscript(id, rec, [
      {
        start: 3000,
        end: 8000,
        text: 'Eins zwei drei vier fünf',
        words: [
          ['Eins', 3000, 3800],
          ['zwei', 3800, 4400],
          ['drei', 4600, 5400], // Mitte 5000 → Folie 2
          ['vier', 5400, 6500],
          ['fünf', 6500, 8000],
        ],
      },
    ]);
    const body = SessionTranscriptSchema.parse((await getTranscript(id)).json());
    expect(body.slide_source).toBe('log');
    expect(body.lines).toEqual([
      {
        segment_id: segmentIds[0],
        part: 0,
        recording_id: rec,
        slide_id: s1,
        slide_index: 1,
        start_ms: 3000,
        end_ms: 4400,
        text: 'Eins zwei',
        lang: 'de',
      },
      {
        segment_id: segmentIds[0],
        part: 1,
        recording_id: rec,
        slide_id: s2,
        slide_index: 2,
        start_ms: 4600,
        end_ms: 8000,
        text: 'drei vier fünf',
        lang: 'de',
      },
    ]);
  });

  it('[G4] include_words: nur auf Anfrage, genau die Wörter der Zeile, [] ohne Wort-Zeitstempel', async () => {
    const id = await mkSession();
    const [s1, s2] = await mkSlides(id, 2);
    await mkSlideSegment(id, s1!, 1, 0, 5000);
    await mkSlideSegment(id, s2!, 2, 5000, 20_000);
    const rec = await mkRecording(id, { durationMs: 20_000 });
    await mkTranscript(id, rec, [
      {
        start: 3000,
        end: 8000,
        text: 'a b c',
        words: [
          ['a', 3000, 4000],
          ['b', 6000, 7000],
          ['c', 7000, 8000],
        ],
      },
      { start: 10_000, end: 12_000, text: 'ohne Wörter', words: null },
      { start: 12_000, end: 14_000, text: 'leere Wörter', words: [] },
    ]);
    const without = (await getTranscript(id)).json();
    expect(without.lines.every((l: object) => !('words' in l))).toBe(true);
    const withWords = (await getTranscript(id, '?include_words=true')).json();
    expect(withWords.lines).toHaveLength(4);
    expect(withWords.lines[0].words.map((w: { text: string }) => w.text)).toEqual(['a']);
    expect(withWords.lines[1].words.map((w: { text: string }) => w.text)).toEqual(['b', 'c']);
    expect(withWords.lines[1].words[0]).toEqual({ text: 'b', start_ms: 6000, end_ms: 7000, prob: 0.9 });
    expect(withWords.lines[2].words).toEqual([]);
    expect(withWords.lines[3].words).toEqual([]);
    expect((await getTranscript(id, '?include_words=false')).json().lines[0]).not.toHaveProperty('words');
    expect(SessionTranscriptSchema.safeParse(withWords).success).toBe(true);
  });

  it('[G5] ohne Wörter bleibt der Abschnitt ganz: Folie = Segment mit der Mitte, ersatzweise größte Überlappung; ohne Segment slide_id null', async () => {
    const id = await mkSession();
    const [s1, s2] = await mkSlides(id, 2);
    await mkSlideSegment(id, s1!, 1, 0, 6000);
    await mkSlideSegment(id, s2!, 2, 6000, 12_000);
    const rec = await mkRecording(id, { durationMs: 40_000 });
    await mkTranscript(id, rec, [
      { start: 4000, end: 9000, text: 'Mitte 6500 liegt auf Folie 2' }, // floor(13000/2) = 6500
      { start: 2000, end: 7000, text: 'Mitte 4500 liegt auf Folie 1' },
      { start: 11_000, end: 30_000, text: 'Mitte 20500 liegt außerhalb, nur Folie 2 überlappt' },
      { start: 30_000, end: 31_000, text: 'ohne Folie' },
      { start: 5500, end: 5500, text: 'Zeitpunkt in Folie 1' }, // Länge 0: s.start ≤ t < s.end
      { start: 6000, end: 6000, text: 'Zeitpunkt genau auf der Grenze gehört zu Folie 2' },
    ]);
    const lines = (await getTranscript(id)).json().lines as {
      text: string;
      slide_id: string | null;
      part: number;
    }[];
    const byText = Object.fromEntries(lines.map((l) => [l.text, l]));
    expect(lines).toHaveLength(6);
    expect(byText['Mitte 6500 liegt auf Folie 2']!.slide_id).toBe(s2);
    expect(byText['Mitte 4500 liegt auf Folie 1']!.slide_id).toBe(s1);
    expect(byText['Mitte 20500 liegt außerhalb, nur Folie 2 überlappt']!.slide_id).toBe(s2);
    expect(byText['ohne Folie']!.slide_id).toBeNull();
    expect(byText['Zeitpunkt in Folie 1']!.slide_id).toBe(s1);
    expect(byText['Zeitpunkt genau auf der Grenze gehört zu Folie 2']!.slide_id).toBe(s2);
    expect(lines.every((l) => l.part === 0)).toBe(true);
  });

  it('[G6] slide_id filtert die Zeilen, eine unbekannte Folie ergibt leere lines (kein Fehler)', async () => {
    const id = await mkSession();
    const [s1, s2] = await mkSlides(id, 2);
    await mkSlideSegment(id, s1!, 1, 0, 5000);
    await mkSlideSegment(id, s2!, 2, 5000, 20_000);
    const rec = await mkRecording(id, { durationMs: 20_000 });
    await mkTranscript(id, rec, [
      { start: 1000, end: 2000, text: 'eins' },
      { start: 6000, end: 7000, text: 'zwei' },
    ]);
    const one = (await getTranscript(id, `?slide_id=${s2}`)).json();
    expect(one.lines.map((l: { text: string }) => l.text)).toEqual(['zwei']);
    expect(one.slide_segments).toHaveLength(2); // nur lines werden gefiltert
    const unknown = await getTranscript(id, `?slide_id=${uuidv7()}`);
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json().lines).toEqual([]);
  });

  it('[G7] slide_source: manuell vor ausrichtung vor log; gelöschte Segmente und Segmente gelöschter Folien fallen weg', async () => {
    const id = await mkSession();
    const [s1, s2, s3] = await mkSlides(id, 3);
    const logSeg = await mkSlideSegment(id, s1!, 1, 0, 1000, 'log');
    expect((await getTranscript(id)).json()).toMatchObject({ slide_source: 'log' });
    const ausSeg = await mkSlideSegment(id, s2!, 2, 0, 1000, 'ausrichtung');
    let body = (await getTranscript(id)).json();
    expect(body.slide_source).toBe('ausrichtung');
    expect(body.slide_segments.map((s: { id: string }) => s.id)).toEqual([ausSeg]);
    const manSeg = await mkSlideSegment(id, s3!, 3, 0, 1000, 'manuell');
    body = (await getTranscript(id)).json();
    expect(body.slide_source).toBe('manuell');
    expect(body.slide_segments.map((s: { id: string }) => s.id)).toEqual([manSeg]);
    // gelöschtes manuelles Segment: zurück zu ausrichtung
    await handle.db
      .update(slideSegment)
      .set({ deletedAt: T(1) })
      .where(eq(slideSegment.id, manSeg));
    expect((await getTranscript(id)).json().slide_source).toBe('ausrichtung');
    // gelöschte Folie: ihr Segment fällt weg, die Quelle wird NACH diesem Filter gewählt (hier: log)
    await handle.db
      .update(slide)
      .set({ deletedAt: T(2) })
      .where(eq(slide.id, s2!));
    body = (await getTranscript(id)).json();
    expect(body.slide_source).toBe('log');
    expect(body.slide_segments.map((s: { id: string }) => s.id)).toEqual([logSeg]);
    // auch das log-Segment hängt an einer gelöschten Folie: keine Quelle mehr
    await handle.db
      .update(slide)
      .set({ deletedAt: T(3) })
      .where(eq(slide.id, s1!));
    body = (await getTranscript(id)).json();
    expect(body.slide_source).toBeNull();
    expect(body.slide_segments).toEqual([]);
  });

  it('[G8] Zeilen nach (start_ms, recording_id, seq) über mehrere Aufnahmen; recordings und transcripts nach started_ms', async () => {
    const id = await mkSession();
    const late = await mkRecording(id, { startedMs: 100_000, durationMs: 10_000 });
    const early = await mkRecording(id, { startedMs: 0, durationMs: 10_000 });
    await mkTranscript(id, late, [{ start: 100_000, end: 101_000, text: 'spät' }]);
    await mkTranscript(id, early, [
      { start: 5000, end: 6000, text: 'b' },
      { start: 1000, end: 2000, text: 'a' },
    ]);
    const body = SessionTranscriptSchema.parse((await getTranscript(id)).json());
    expect(body.lines.map((l) => l.text)).toEqual(['a', 'b', 'spät']);
    expect(body.recordings.map((r) => r.id)).toEqual([early, late]);
    expect(body.transcripts.map((t) => t.recording_id)).toEqual([early, late]);
    // gleicher start_ms: recording_id, dann seq
    const same = await mkSession();
    const r1 = await mkRecording(same, { durationMs: 1000 });
    const r2 = await mkRecording(same, { durationMs: 1000 });
    await mkTranscript(same, r1, [
      { start: 0, end: 10, text: 'x1' },
      { start: 0, end: 10, text: 'x2' },
    ]);
    await mkTranscript(same, r2, [{ start: 0, end: 10, text: 'y1' }]);
    const expected = [...[r1, r2].sort().map((r) => (r === r1 ? ['x1', 'x2'] : ['y1']))].flat();
    expect((await getTranscript(same)).json().lines.map((l: { text: string }) => l.text)).toEqual(expected);
  });

  it('[G9] stale: nur wenn der neueste fertige audio.finalize-Job nicht finalize_job_id ist; fehlendes Transkript bei fertigem Audio', async () => {
    const id = await mkSession();
    const rec = await mkRecording(id, { durationMs: 10_000 });
    // fertiges Audio ohne Transkript: stale (Transkript fehlt)
    const f1 = await mkJob(id, 'audio.finalize', 'fertig', { recordingId: rec });
    let body = (await getTranscript(id)).json();
    expect(body).toMatchObject({ stale: true, transcripts: [] });
    await mkTranscript(id, rec, [{ start: 0, end: 10, text: 'x' }], f1);
    body = (await getTranscript(id)).json();
    expect(body.stale).toBe(false);
    expect(body.transcripts[0].stale).toBe(false);
    // neuer Job wartet/läuft/scheitert: das Transkript bleibt aktuell
    for (const state of ['wartet', 'laeuft', 'fehler'] as const) {
      const f = await mkJob(id, 'audio.finalize', state, { recordingId: rec });
      expect((await getTranscript(id)).json().stale, state).toBe(false);
      await handle.db.delete(job).where(eq(job.id, f));
    }
    // neuer fertiger Job: veraltet
    await mkJob(id, 'audio.finalize', 'fertig', { recordingId: rec });
    body = (await getTranscript(id)).json();
    expect(body.stale).toBe(true);
    expect(body.transcripts[0].stale).toBe(true);
    // Aufnahme ohne Dauer und ohne fertiges Audio lässt stale unberührt
    const other = await mkSession();
    await mkRecording(other, { durationMs: null });
    await mkRecording(other, { durationMs: 5000 }); // Dauer, aber kein fertiger Job
    expect((await getTranscript(other)).json().stale).toBe(false);
  });

  it('[G11] stale zählt nur Jobs der eigenen Session (job_session_idx), auch beim fehlenden Transkript', async () => {
    const id = await mkSession();
    const rec = await mkRecording(id, { durationMs: 10_000 });
    const mine = await mkJob(id, 'audio.finalize', 'fertig', { recordingId: rec });
    await mkTranscript(id, rec, [{ start: 0, end: 10, text: 'x' }], mine);
    expect((await getTranscript(id)).json().stale).toBe(false);
    // ein fertiger Job einer anderen Session mit derselben recording_id darf das Transkript nicht veralten lassen
    const other = await mkSession();
    await mkJob(other, 'audio.finalize', 'fertig', { recordingId: rec });
    expect((await getTranscript(id)).json().stale).toBe(false);
    // Aufnahme ohne Transkript: ein fertiger Job einer fremden Session zählt nicht als „Audio fertig“
    const lone = await mkSession();
    const loneRec = await mkRecording(lone, { durationMs: 5000 });
    await mkJob(other, 'audio.finalize', 'fertig', { recordingId: loneRec });
    expect((await getTranscript(lone)).json().stale).toBe(false);
  });

  it('[G10] Leistung: 90 min mit 450 Abschnitten und 11 700 Wörtern, mit und ohne Wörter', async () => {
    const id = await mkSession();
    const slides = await mkSlides(id, 45);
    for (const [i, s] of slides.entries()) await mkSlideSegment(id, s, i + 1, i * 120_000, (i + 1) * 120_000);
    const rec = await mkRecording(id, { durationMs: 5_400_000 });
    const specs: SegSpec[] = Array.from({ length: 450 }, (_, k) => ({
      start: k * 12_000,
      end: k * 12_000 + 11_500,
      text: Array.from({ length: 26 }, (_, w) => `Wort${w}`).join(' '),
      words: Array.from({ length: 26 }, (_, w): [string, number, number] => [
        `Wort${w}`,
        k * 12_000 + w * 440,
        k * 12_000 + w * 440 + 430,
      ]),
    }));
    await mkTranscript(id, rec, specs);
    for (const query of ['', '?include_words=true']) {
      const started = performance.now();
      const res = await getTranscript(id, query);
      const ms = performance.now() - started;
      expect(res.statusCode).toBe(200);
      expect(res.json().lines.length).toBeGreaterThanOrEqual(450);
      // Richtwert aus dem Vertrag (< 300 ms), hier großzügig gegen langsame CI-Läufer
      expect(ms, `Antwortzeit ${query || 'ohne Wörter'}`).toBeLessThan(1500);
    }
  });
});

// --- Kaskade beim Löschen und Wiederherstellen (§13, §18.1) ---------------------------------------

describe('Kaskade der Session', () => {
  it('[D1] Löschen setzt auf transcript, transcript_segment und slide_segment denselben deleted_at, Wiederherstellen holt sie zurück', async () => {
    const id = await mkSession();
    const [s1] = await mkSlides(id, 1);
    const rec = await mkRecording(id, { durationMs: 10_000 });
    await mkSlideSegment(id, s1!, 1, 0, 10_000);
    await mkTranscript(id, rec, [
      { start: 0, end: 1000, text: 'a' },
      { start: 1000, end: 2000, text: 'b' },
    ]);
    // vorher einzeln gelöschtes Segment (anderer Zeitstempel) bleibt auch nach dem Wiederherstellen gelöscht
    const old = await mkSlideSegment(id, s1!, 1, 0, 5000, 'ausrichtung', T(-10));

    await softDeleteWithOps(handle.db, 'session', id);
    const stamp = (await sessionRow(id)).deletedAt!;
    expect(stamp).toBeTruthy();
    const tr = await handle.db.select().from(transcript).where(eq(transcript.sessionId, id));
    const segs = await handle.db.select().from(transcriptSegment).where(eq(transcriptSegment.sessionId, id));
    const ssegs = await handle.db.select().from(slideSegment).where(eq(slideSegment.sessionId, id));
    expect(tr).toHaveLength(1);
    expect(segs).toHaveLength(2);
    expect(ssegs).toHaveLength(2);
    expect(tr[0]!.deletedAt).toEqual(stamp);
    expect(segs.every((s) => s.deletedAt?.getTime() === stamp.getTime())).toBe(true);
    expect(ssegs.filter((s) => s.id !== old).every((s) => s.deletedAt?.getTime() === stamp.getTime())).toBe(
      true,
    );
    expect((await getTranscript(id)).statusCode).toBe(404);

    await restoreWithOps(handle.db, id);
    expect((await sessionRow(id)).deletedAt).toBeNull();
    const body = SessionTranscriptSchema.parse((await getTranscript(id)).json());
    expect(body.transcripts).toHaveLength(1);
    expect(body.lines.map((l) => l.text)).toEqual(['a', 'b']);
    expect(body.slide_segments).toHaveLength(1); // das alte, einzeln gelöschte bleibt weg
    const [oldRow] = await handle.db.select().from(slideSegment).where(eq(slideSegment.id, old));
    expect(oldRow!.deletedAt).toEqual(T(-10));
    const [still] = await handle.db
      .select()
      .from(transcriptSegment)
      .where(and(eq(transcriptSegment.sessionId, id), eq(transcriptSegment.seq, 0)));
    expect(still!.deletedAt).toBeNull();
  });
});
