// T2-22a: Konzept-Kette im Core (VERTRAEGE §20.2): transcribe + align.log → concepts.extract → concepts.resolve →
// summary.write, `from_step` je Schritt, Wiederverwenden, `force`, Fortschritt und `POST /sessions/{id}/reprocess`.
// Echte Datenbank. Der Worker läuft nicht: Die Tests setzen Job-Zustände selbst.
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SINGLE_USER_ID,
  SessionReprocessResultSchema,
  type JobState,
  type PipelineStep,
  type SyncEvent,
} from '@sg/shared';
import type { DbHandle } from '../../src/db/client.ts';
import { audioChunk, courseModule, job, recording, semester, session } from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { enqueueJob, JOB_PAYLOAD_SCHEMAS } from '../../src/services/jobs.ts';
import { ensurePipelineJobs } from '../../src/services/pipeline.ts';
import { setSessionEventPublisher, transitionSession } from '../../src/services/sessions.ts';
import { startTestApp, type TestApp } from './helpers.ts';

let handle: DbHandle;
let app: TestApp;
const base = { userId: SINGLE_USER_ID };
const API = '/api/v1';
let events: SyncEvent[] = [];
let moduleId = '';

/** Minuten nach 2026-11-04 09:00 UTC */
const T = (min: number): Date => new Date(Date.UTC(2026, 10, 4, 9, 0) + min * 60_000);
const CONCEPT_STEPS = ['concepts.extract', 'concepts.resolve', 'summary.write'] as const;

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
    .values({ id: moduleId, ...base, semesterId, name: 'Testmodul', color: 'mod-01' });
});

async function truncate() {
  await handle.sql`TRUNCATE semester, module, calendar_source, calendar_event, session, slide_deck, job,
    sync_op, sync_stream, setting, recording, idempotency_key CASCADE`;
}

// --- Hilfen ----------------------------------------------------------------------------------

async function mkSession(over: Partial<typeof session.$inferInsert> = {}): Promise<string> {
  const id = uuidv7();
  await handle.db.insert(session).values({ id, ...base, moduleId, state: 'verarbeitet', ...over });
  return id;
}

async function mkRecording(sessionId: string): Promise<string> {
  const id = uuidv7();
  await handle.db
    .insert(recording)
    .values({ id, ...base, sessionId, mime: 'audio/webm', codec: 'opus', startedMs: 0, completedAt: T(1) });
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
  return id;
}

let clock = 0;
/** Job mit strikt aufsteigendem `created_at` (die Regel „neuester Job“ hängt daran) */
async function mkJob(
  sessionId: string,
  type: PipelineStep,
  state: JobState,
  extra: { dependsOn?: string[]; payload?: Record<string, unknown>; deleted?: boolean } = {},
): Promise<string> {
  const id = uuidv7();
  clock += 1;
  await handle.db.insert(job).values({
    id,
    ...base,
    type,
    payload: { session_id: sessionId, ...extra.payload },
    state,
    sessionId,
    dependsOn: extra.dependsOn ?? [],
    createdAt: new Date(Date.UTC(2026, 10, 4, 9, 0, 0) + clock * 1000),
    deletedAt: extra.deleted ? T(5) : null,
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
const jobById = async (id: string) => {
  const [row] = await handle.db.select().from(job).where(eq(job.id, id));
  if (!row) throw new Error('Job fehlt');
  return row;
};
async function processingOf(id: string) {
  const [row] = await handle.db.select().from(session).where(eq(session.id, id));
  if (!row) throw new Error('Session fehlt');
  return row.processing;
}

const ensure = (id: string, fromStep: PipelineStep, force = false) =>
  handle.db.transaction((tx) => ensurePipelineJobs(tx, id, { fromStep, force, emit: false }));

const post = (id: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request({
    method: 'POST',
    url: `${API}/sessions/${id}/reprocess`,
    ...(body === undefined ? {} : { payload: body as object }),
    headers,
  });

// --- Kette beim Stopp ----------------------------------------------------------------------------

describe('Konzept-Kette beim Stopp (§20.2)', () => {
  it('[C1] Stopp mit Audio: die drei Schritte mit Priorität 8/7/6, depends_on in Ketten-Reihenfolge, Session bleibt beendet', async () => {
    const id = await mkSession({ state: 'laeuft', startedAt: T(0) });
    await mkRecording(id);
    const stopped = await handle.db.transaction((tx) =>
      transitionSession(tx, id, 'stop', { origin: 'server', at: T(60), now: T(60) }),
    );
    // Die drei Jobs halten `verarbeitet` auf: Nacharbeitung braucht Konzepte und Kurzfassung
    expect(stopped.session.state).toBe('beendet');

    const [transcribe] = await jobsOf(id, 'transcribe');
    const [align] = await jobsOf(id, 'align.log');
    const [extract] = await jobsOf(id, 'concepts.extract');
    const [resolve] = await jobsOf(id, 'concepts.resolve');
    const [summary] = await jobsOf(id, 'summary.write');
    expect(extract).toMatchObject({
      state: 'wartet',
      priority: 8,
      maxAttempts: 3,
      sessionId: id,
      payload: { session_id: id },
      dependsOn: [transcribe!.id, align!.id],
    });
    expect(resolve).toMatchObject({
      state: 'wartet',
      priority: 7,
      maxAttempts: 3,
      sessionId: id,
      payload: { session_id: id, extract_job_id: extract!.id },
      dependsOn: [extract!.id],
    });
    expect(summary).toMatchObject({
      state: 'wartet',
      priority: 6,
      maxAttempts: 3,
      sessionId: id,
      payload: { session_id: id },
      dependsOn: [resolve!.id],
    });
    // unter Transkription (20) und Ausrichtung (10)
    expect(transcribe!.priority).toBeGreaterThan(align!.priority);
    expect(align!.priority).toBeGreaterThan(extract!.priority);
    expect(stopped.session.processing).toMatchObject({
      'concepts.extract': 'wartet',
      'concepts.resolve': 'wartet',
      'summary.write': 'wartet',
    });
    // genau je ein Job, kein `force`
    for (const type of CONCEPT_STEPS) expect(await jobsOf(id, type)).toHaveLength(1);
    expect(extract!.payload).toEqual({ session_id: id });
    expect(summary!.payload).toEqual({ session_id: id });
  });

  it('[C2] Stopp ohne Audio: keine automatische Kette, auch keine Konzept-Jobs, sofort verarbeitet', async () => {
    const id = await mkSession({ state: 'laeuft', startedAt: T(0) });
    const stopped = await handle.db.transaction((tx) =>
      transitionSession(tx, id, 'stop', { origin: 'server', at: T(60), now: T(60) }),
    );
    expect(stopped.session.state).toBe('verarbeitet');
    expect(await jobsOf(id)).toEqual([]);
  });
});

// --- from_step -----------------------------------------------------------------------------------

describe('ensurePipelineJobs: from_step der Konzept-Schritte (§20.2)', () => {
  it('[F1] align.log: align.log und danach die drei; concepts.extract hängt nur am align.log dieses Aufrufs', async () => {
    const id = await mkSession();
    const jobs = await ensure(id, 'align.log');
    expect(jobs.map((j) => j.type)).toEqual(['align.log', ...CONCEPT_STEPS]);
    const [align, extract, resolve, summary] = jobs;
    expect(extract!.dependsOn).toEqual([align!.id]);
    expect(resolve!.dependsOn).toEqual([extract!.id]);
    expect(resolve!.payload).toEqual({ session_id: id, extract_job_id: extract!.id });
    expect(summary!.dependsOn).toEqual([resolve!.id]);
    expect(await jobsOf(id, 'transcribe')).toEqual([]);
  });

  it('[F2] concepts.extract: nur die drei; depends_on von concepts.extract ist leer bzw. nur ein laufender Job desselben Typs', async () => {
    const id = await mkSession();
    // offene Vorgänger zählen bei from_step concepts.extract nicht („Konzepte nur aus Folien“ bei gescheitertem transcribe)
    await mkJob(id, 'transcribe', 'fehler');
    await mkJob(id, 'align.log', 'fertig');
    const jobs = await ensure(id, 'concepts.extract');
    expect(jobs.map((j) => j.type)).toEqual([...CONCEPT_STEPS]);
    expect(jobs[0]!.dependsOn).toEqual([]);
    expect(jobs[1]!.dependsOn).toEqual([jobs[0]!.id]);
    expect(jobs[2]!.dependsOn).toEqual([jobs[1]!.id]);
    expect(await jobsOf(id, 'transcribe')).toHaveLength(1);
    expect(await jobsOf(id, 'align.log')).toHaveLength(1);

    // laufender Job desselben Typs wird Abhängigkeit des neuen (Fehlschlag wird geerbt), je Schritt
    const id2 = await mkSession();
    const runE = await mkJob(id2, 'concepts.extract', 'laeuft');
    const runR = await mkJob(id2, 'concepts.resolve', 'laeuft', { payload: { extract_job_id: runE } });
    const runS = await mkJob(id2, 'summary.write', 'laeuft');
    const [e, r, s] = await ensure(id2, 'concepts.extract');
    expect(e).toMatchObject({ state: 'wartet', dependsOn: [runE] });
    expect(r).toMatchObject({ state: 'wartet', dependsOn: [e!.id, runR] });
    expect(r!.payload).toEqual({ session_id: id2, extract_job_id: e!.id });
    expect(s).toMatchObject({ state: 'wartet', dependsOn: [r!.id, runS] });
  });

  it('[F3] concepts.resolve: setzt auf dem neuesten fertigen concepts.extract auf, legt keinen neuen an, danach summary.write', async () => {
    const id = await mkSession();
    await mkJob(id, 'concepts.extract', 'fertig');
    const newest = await mkJob(id, 'concepts.extract', 'fertig');
    await mkJob(id, 'concepts.extract', 'fehler'); // neuer, aber gescheitert: zählt nicht
    await mkJob(id, 'concepts.extract', 'fertig', { deleted: true }); // gelöscht: zählt nicht
    const jobs = await ensure(id, 'concepts.resolve');
    expect(jobs.map((j) => j.type)).toEqual(['concepts.resolve', 'summary.write']);
    expect(jobs[0]!.payload).toEqual({ session_id: id, extract_job_id: newest });
    expect(jobs[0]!.dependsOn).toEqual([newest]);
    expect(jobs[1]!.dependsOn).toEqual([jobs[0]!.id]);
    expect(await jobsOf(id, 'concepts.extract')).toHaveLength(4);
    // processing: concepts.extract wurde nicht berührt
    expect(await processingOf(id)).toEqual({ 'concepts.resolve': 'wartet', 'summary.write': 'wartet' });
  });

  it('[F4] concepts.resolve ohne brauchbaren concepts.extract gilt als from_step concepts.extract', async () => {
    const none = await mkSession();
    expect((await ensure(none, 'concepts.resolve')).map((j) => j.type)).toEqual([...CONCEPT_STEPS]);

    const failedOnly = await mkSession();
    const failed = await mkJob(failedOnly, 'concepts.extract', 'fehler');
    await mkJob(failedOnly, 'concepts.extract', 'abgebrochen');
    const jobs = await ensure(failedOnly, 'concepts.resolve', true);
    expect(jobs.map((j) => j.type)).toEqual([...CONCEPT_STEPS]);
    expect(jobs[0]!.id).not.toBe(failed);
    expect(jobs[1]!.payload).toMatchObject({ extract_job_id: jobs[0]!.id });
    // `force` wirkt dann auf concepts.extract (den tatsächlichen ersten Schritt), nicht auf die Folgeschritte
    expect(jobs[0]!.payload).toEqual({ session_id: failedOnly, force: true });
    expect(jobs[1]!.payload).toEqual({ session_id: failedOnly, extract_job_id: jobs[0]!.id });
    expect(jobs[2]!.payload).toEqual({ session_id: failedOnly });
  });

  it('[F5] concepts.resolve bei offener Kette: der wartende Job bleibt am neueren, noch offenen concepts.extract', async () => {
    const id = await mkSession();
    await mkJob(id, 'concepts.extract', 'fertig'); // älterer Lauf
    const open = await mkJob(id, 'concepts.extract', 'laeuft');
    const waiting = await mkJob(id, 'concepts.resolve', 'wartet', {
      payload: { extract_job_id: open },
      dependsOn: [open],
    });
    const [resolve, summary] = await ensure(id, 'concepts.resolve');
    // sonst hinge er vom laufenden Job ab und läse das Ergebnis des älteren
    expect(resolve).toMatchObject({ id: waiting, dependsOn: [open] });
    expect(resolve!.payload).toEqual({ session_id: id, extract_job_id: open });
    expect(summary!.dependsOn).toEqual([waiting]);
    expect(await jobsOf(id, 'concepts.extract')).toHaveLength(2);
  });

  it('[F6] summary.write: nur summary.write, ohne depends_on außer einem laufenden Job desselben Typs', async () => {
    const id = await mkSession();
    await mkJob(id, 'concepts.extract', 'fertig');
    await mkJob(id, 'concepts.resolve', 'laeuft');
    const jobs = await ensure(id, 'summary.write');
    expect(jobs.map((j) => j.type)).toEqual(['summary.write']);
    expect(jobs[0]).toMatchObject({ state: 'wartet', priority: 6, dependsOn: [], sessionId: id });
    expect(await jobsOf(id)).toHaveLength(3);

    const id2 = await mkSession();
    const running = await mkJob(id2, 'summary.write', 'laeuft');
    const [second] = await ensure(id2, 'summary.write');
    expect(second!.dependsOn).toEqual([running]);
  });

  it('[F7] search.index bleibt unverändert: die Konzept-Schritte legen keinen an', async () => {
    const id = await mkSession();
    await ensure(id, 'concepts.extract');
    await ensure(id, 'align.log');
    const [row] = await handle.sql`SELECT count(*)::int AS n FROM job WHERE type = 'search.index'`;
    expect(row?.n).toBe(0);
  });
});

// --- Wiederverwenden, force, Fortschritt ----------------------------------------------------------

describe('ensurePipelineJobs: Wiederverwenden und force (§20.2)', () => {
  it('[W1] wiederholter Aufruf legt nichts doppelt an und liefert dieselben Jobs', async () => {
    const id = await mkSession();
    const first = await ensure(id, 'concepts.extract');
    const second = await ensure(id, 'concepts.extract');
    const third = await ensure(id, 'align.log');
    expect(second.map((j) => j.id)).toEqual(first.map((j) => j.id));
    expect(third.slice(1).map((j) => j.id)).toEqual(first.map((j) => j.id));
    for (const type of CONCEPT_STEPS) expect(await jobsOf(id, type)).toHaveLength(1);
    // der wiederverwendete concepts.extract hängt jetzt zusätzlich am neuen align.log
    expect((await jobById(first[0]!.id)).dependsOn).toEqual([third[0]!.id]);
  });

  it('[W2] wartende Folgeschritte: depends_on bereinigt und ergänzt, extract_job_id zeigt auf den neuen concepts.extract', async () => {
    const id = await mkSession();
    const failed = await mkJob(id, 'concepts.extract', 'fehler');
    const gone = uuidv7(); // unbekannter Job
    const waitingR = await mkJob(id, 'concepts.resolve', 'wartet', {
      payload: { extract_job_id: failed },
      dependsOn: [failed, gone],
    });
    const waitingS = await mkJob(id, 'summary.write', 'wartet', { dependsOn: [waitingR] });

    const [extract, resolve, summary] = await ensure(id, 'concepts.extract');
    expect(extract!.id).not.toBe(failed);
    expect(resolve).toMatchObject({ id: waitingR, state: 'wartet', dependsOn: [extract!.id] });
    expect(resolve!.payload).toEqual({ session_id: id, extract_job_id: extract!.id });
    expect(summary).toMatchObject({ id: waitingS, dependsOn: [waitingR] });
    // in der Datenbank steht dasselbe
    expect((await jobById(waitingR)).payload).toEqual({ session_id: id, extract_job_id: extract!.id });
    expect((await jobById(waitingR)).dependsOn).toEqual([extract!.id]);
  });

  it('[W3] force wirkt nur auf den Schritt from_step selbst und wird bei einem wartenden Job alt ODER neu', async () => {
    // ab transcribe: wie bisher nur transcribe
    const a = await mkSession();
    await mkRecording(a);
    const fromTranscribe = await ensure(a, 'transcribe', true);
    expect(fromTranscribe.map((j) => (j.payload as { force?: boolean }).force ?? false)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);

    // ab concepts.extract: nur concepts.extract
    const b = await mkSession();
    const forced = await ensure(b, 'concepts.extract', true);
    expect(forced[0]!.payload).toEqual({ session_id: b, force: true });
    expect(forced[1]!.payload).toEqual({ session_id: b, extract_job_id: forced[0]!.id });
    expect(forced[2]!.payload).toEqual({ session_id: b });
    // alt ODER neu: bleibt true, auch wenn der nächste Aufruf ohne force kommt
    const again = await ensure(b, 'concepts.extract', false);
    expect(again[0]!.payload).toEqual({ session_id: b, force: true });

    // ab concepts.resolve: nur concepts.resolve
    const c = await mkSession();
    const done = await mkJob(c, 'concepts.extract', 'fertig');
    const fromResolve = await ensure(c, 'concepts.resolve', true);
    expect(fromResolve[0]!.payload).toEqual({ session_id: c, extract_job_id: done, force: true });
    expect(fromResolve[1]!.payload).toEqual({ session_id: c });

    // ab summary.write
    const d = await mkSession();
    expect((await ensure(d, 'summary.write', true))[0]!.payload).toEqual({ session_id: d, force: true });
    // ab align.log: align.log kennt kein force, die Konzept-Schritte bekommen keins
    const e = await mkSession();
    for (const j of await ensure(e, 'align.log', true)) expect(j.payload).not.toHaveProperty('force');
  });

  it('[W4] Fortschritt: nur berührte Schritte, ein laufender Job bleibt laeuft, nach fehler wieder wartet', async () => {
    const id = await mkSession({
      processing: { transcribe: 'fertig', 'concepts.extract': 'fertig', 'concepts.resolve': 'fehler' },
    });
    const done = await mkJob(id, 'concepts.extract', 'fertig');
    await mkJob(id, 'concepts.resolve', 'fehler', { payload: { extract_job_id: done } });
    await mkJob(id, 'summary.write', 'abgebrochen');
    await ensure(id, 'concepts.resolve');
    expect(await processingOf(id)).toEqual({
      transcribe: 'fertig',
      'concepts.extract': 'fertig',
      'concepts.resolve': 'wartet',
      'summary.write': 'wartet',
    });

    const running = await mkSession();
    await mkJob(running, 'concepts.extract', 'laeuft');
    await ensure(running, 'concepts.extract');
    expect(await processingOf(running)).toEqual({
      'concepts.extract': 'laeuft', // nie pauschal wartet
      'concepts.resolve': 'wartet',
      'summary.write': 'wartet',
    });
  });
});

// --- JOB_PAYLOAD_SCHEMAS ---------------------------------------------------------------------------

describe('JOB_PAYLOAD_SCHEMAS (§20.2)', () => {
  it('[J1] kennt die drei Typen und lehnt ungültige Payloads vor dem INSERT ab', async () => {
    for (const type of CONCEPT_STEPS) expect(JOB_PAYLOAD_SCHEMAS[type]).toBeDefined();
    const id = await mkSession();
    const enqueue = (type: (typeof CONCEPT_STEPS)[number], payload: Record<string, unknown>) =>
      handle.db.transaction((tx) => enqueueJob(tx, { type, payload, sessionId: id }));
    await expect(enqueue('concepts.resolve', { session_id: id })).rejects.toThrow(/Ungültiges Payload/);
    await expect(enqueue('concepts.extract', { session_id: id, force: 'ja' })).rejects.toThrow(
      /Ungültiges Payload/,
    );
    await expect(enqueue('summary.write', { session_id: id, extra: 1 })).rejects.toThrow(
      /Ungültiges Payload/,
    );
    await expect(enqueue('summary.write', {})).rejects.toThrow(/Ungültiges Payload/);
    expect(await jobsOf(id)).toEqual([]);
    await expect(
      enqueue('concepts.resolve', { session_id: id, extract_job_id: uuidv7() }),
    ).resolves.toBeTruthy();
  });
});

// --- POST /sessions/{id}/reprocess ------------------------------------------------------------------

describe('POST /sessions/{id}/reprocess mit den Konzept-Schritten (§20.2, §18.5)', () => {
  it('[R1] ohne Audio: 409 session_no_audio nur bei audio.finalize/transcribe, die neuen Schritte laufen', async () => {
    for (const from_step of ['audio.finalize', 'transcribe'] as const) {
      const id = await mkSession();
      const res = await post(id, { from_step });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('session_no_audio');
      expect(await jobsOf(id)).toEqual([]);
    }
    const expected: Record<string, string[]> = {
      'align.log': ['align.log', ...CONCEPT_STEPS],
      'concepts.extract': [...CONCEPT_STEPS],
      'concepts.resolve': [...CONCEPT_STEPS], // kein fertiger concepts.extract: wie concepts.extract
      'summary.write': ['summary.write'],
    };
    for (const [from_step, types] of Object.entries(expected)) {
      const id = await mkSession();
      const res = await post(id, { from_step });
      expect(res.statusCode, from_step).toBe(202);
      const body = SessionReprocessResultSchema.parse(res.json());
      expect(body.jobs.map((j) => j.type)).toEqual(types);
      expect(body.jobs.every((j) => j.state === 'wartet' && j.session_id === id)).toBe(true);
      // Der Zustand der Session ändert sich nicht, nur processing
      expect(body.session.state).toBe('verarbeitet');
      expect(Object.keys(body.session.processing ?? {}).sort()).toEqual([...types].sort());
    }
  });

  it('[R2] „Konzepte erzeugen“ für eine Session ohne Audio: Kette, session.updated, wiederholt nichts doppelt', async () => {
    const id = await mkSession({ state: 'verarbeitet', processing: {} });
    const first = await post(id, { from_step: 'concepts.extract' });
    expect(first.statusCode).toBe(202);
    expect(events.at(-1)).toMatchObject({
      name: 'session.updated',
      data: { id, processing: { 'concepts.extract': 'wartet', 'summary.write': 'wartet' } },
    });
    const second = await post(id, { from_step: 'concepts.extract' });
    expect(second.json().jobs.map((j: { id: string }) => j.id)).toEqual(
      first.json().jobs.map((j: { id: string }) => j.id),
    );
    expect(await jobsOf(id)).toHaveLength(3);
    const key = { 'idempotency-key': uuidv7() };
    const k1 = await post(id, { from_step: 'summary.write', force: true }, key);
    const k2 = await post(id, { from_step: 'summary.write', force: true }, key);
    expect(k2.headers['idempotent-replay']).toBe('true');
    expect(k2.json()).toEqual(k1.json());
    expect(await jobsOf(id)).toHaveLength(3);
  });

  it('[R3] 404, 409 session_not_ended und 400 gelten auch für die neuen Schritte', async () => {
    expect((await post(uuidv7(), { from_step: 'concepts.extract' })).statusCode).toBe(404);
    const running = await mkSession({ state: 'laeuft', startedAt: T(0) });
    const res = await post(running, { from_step: 'summary.write' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'session_not_ended', details: { state: 'laeuft' } });
    const id = await mkSession();
    const bad = await post(id, { from_step: 'vault.write' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('validation_failed');
    expect(await jobsOf(id)).toEqual([]);
  });

  it('[R4] „Konzepte nur aus Folien“: transcribe steht auf fehler, from_step concepts.extract hängt nicht an ihm', async () => {
    const id = await mkSession({
      processing: { transcribe: 'fehler', 'align.log': 'fertig', 'concepts.extract': 'abgebrochen' },
    });
    await mkRecording(id);
    const failed = await mkJob(id, 'transcribe', 'fehler');
    await mkJob(id, 'align.log', 'fertig');
    await mkJob(id, 'concepts.extract', 'abgebrochen', { dependsOn: [failed] });
    const res = await post(id, { from_step: 'concepts.extract' });
    expect(res.statusCode).toBe(202);
    const body = SessionReprocessResultSchema.parse(res.json());
    expect(body.jobs[0]).toMatchObject({ type: 'concepts.extract', state: 'wartet', depends_on: [] });
    expect(body.session.processing).toEqual({
      transcribe: 'fehler', // unverändert
      'align.log': 'fertig',
      'concepts.extract': 'wartet',
      'concepts.resolve': 'wartet',
      'summary.write': 'wartet',
    });
  });
});
