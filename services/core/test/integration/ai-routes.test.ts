// T2-22a: GET /sessions/{id}/summary, GET /costs/summary und GET /ai/status (VERTRAEGE §20.5, §20.6).
// Echte Datenbank, nachgebauter Worker auf 127.0.0.1. Der Worker schreibt `session_summary` und `cost_entry`,
// die Tests schreiben sie darum selbst. Keine echten Inhalte, kein echter Schlüssel.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AiStatusSchema,
  CostSummarySchema,
  SessionSummaryViewSchema,
  SINGLE_USER_ID,
  type SummarySentence,
} from '@sg/shared';
import type { DbHandle } from '../../src/db/client.ts';
import {
  costEntry,
  courseModule,
  semester,
  session,
  sessionSummary,
  setting,
} from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { getAiStatus } from '../../src/services/ai-status.ts';
import { getBudgetStatus, getCostSummary, localTimeZone } from '../../src/services/costs.ts';
import { FakeWorker } from '../unit/worker-fake.ts';
import { startTestApp, type TestApp } from './helpers.ts';

let app: TestApp;
let remote: TestApp;
let handle: DbHandle;
let worker: FakeWorker;
const base = { userId: SINGLE_USER_ID };
const API = '/api/v1';
const HASH = 'b'.repeat(64);
let moduleId = '';

beforeAll(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sg-ai-it-'));
  worker = await new FakeWorker(dataDir).start();
  const previous = process.env.SG_WORKER_PORT;
  process.env.SG_WORKER_PORT = String(worker.port);
  try {
    app = await startTestApp({ dataDir });
    remote = await startTestApp(
      { dataDir },
      { verifyDeviceToken: async () => ({ deviceId: '0190f6a2-0000-7000-8000-0000000000f1' }) },
    );
  } finally {
    if (previous === undefined) delete process.env.SG_WORKER_PORT;
    else process.env.SG_WORKER_PORT = previous;
  }
  handle = app.handle;
});
afterAll(async () => {
  await truncate();
  await remote.close();
  await app.close();
  await worker.stop();
});
beforeEach(async () => {
  await truncate();
  worker.llm = { provider: 'fake', configured: true, issue: null };
  worker.healthDelayMs = 0;
  worker.mode = 'ok';
  const semesterId = uuidv7();
  moduleId = uuidv7();
  await handle.db.insert(semester).values({ id: semesterId, ...base, name: 'HS 2026' });
  await handle.db
    .insert(courseModule)
    .values({ id: moduleId, ...base, semesterId, name: 'Testmodul', shortName: 'TM', color: 'mod-01' });
});

async function truncate() {
  await handle.sql`TRUNCATE semester, module, session, cost_entry, setting CASCADE`;
}

const get = (url: string) => app.request({ method: 'GET', url: `${API}${url}` });
const fromNetwork = (url: string, token = true) =>
  remote.app.inject({
    method: 'GET',
    url: `${API}${url}`,
    remoteAddress: '192.168.1.20',
    headers: { host: 'mac.local:4710', ...(token ? { authorization: 'Bearer EXAMPLEdevicetoken000' } : {}) },
  });

async function mkSession(over: Partial<typeof session.$inferInsert> = {}): Promise<string> {
  const id = uuidv7();
  await handle.db.insert(session).values({ id, ...base, moduleId, state: 'verarbeitet', ...over });
  return id;
}

interface CostSpec {
  eur: number;
  at?: Date;
  sessionId?: string | null;
  task?: string;
  model?: string;
  provider?: string;
  tokens?: [number, number, number, number];
  deleted?: boolean;
}
async function mkCost(spec: CostSpec): Promise<string> {
  const id = uuidv7();
  const [input, output, cacheWrite, cacheRead] = spec.tokens ?? [0, 0, 0, 0];
  await handle.db.insert(costEntry).values({
    id,
    ...base,
    sessionId: spec.sessionId ?? null,
    provider: spec.provider ?? 'fake',
    model: spec.model ?? 'fake-llm-1',
    task: spec.task ?? 'concepts.extract',
    inputTokens: input,
    outputTokens: output,
    cacheCreationInputTokens: cacheWrite,
    cacheReadInputTokens: cacheRead,
    costEstimateUsd: spec.eur,
    costEstimateEur: spec.eur,
    ...(spec.at ? { createdAt: spec.at } : {}),
    deletedAt: spec.deleted ? new Date() : null,
  });
  return id;
}

const setBudget = (value: unknown) =>
  handle.db
    .insert(setting)
    .values({ key: 'ai', value: { monthly_budget_eur: value }, userId: SINGLE_USER_ID })
    .onConflictDoUpdate({ target: setting.key, set: { value: { monthly_budget_eur: value } } });

/** Laufender Monat in Ortszeit des Prozesses als `YYYY-MM`, und ein Zeitpunkt kurz vor seinem Beginn */
function currentMonth(): { month: string; before: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
    before: new Date(start.getTime() - 1000),
  };
}

// --- GET /sessions/{id}/summary -------------------------------------------------------------------

describe('GET /sessions/{id}/summary', () => {
  const sentences = (sessionId: string): SummarySentence[] => [
    {
      text: 'Die Vorlesung behandelt Begriff A.',
      sources: [
        {
          kind: 'slide',
          slide_id: '01960a3c-7b10-7c4e-9a01-3f2b5c6d7e11',
          deck_id: '01960a3c-7b10-7c4e-9a01-3f2b5c6d7e12',
          slide_index: 3,
        },
        { kind: 'transcript', session_id: sessionId, t_start_ms: 60_000, t_end_ms: 95_000 },
      ],
    },
  ];
  async function mkSummary(sessionId: string, over: Partial<typeof sessionSummary.$inferInsert> = {}) {
    const id = uuidv7();
    await handle.db.insert(sessionSummary).values({
      id,
      ...base,
      sessionId,
      lang: 'de',
      sentences: sentences(sessionId),
      outline: [{ title: 'Kapitel 1', sources: [] }],
      provider: 'fake',
      model: 'fake-llm-1',
      promptVersion: 'summary.write/v1',
      inputHash: HASH,
      jobId: null,
      ...over,
    });
    return id;
  }

  it('[S1] 404 session_not_found für unbekannte und gelöschte Session, 400 für eine ungültige ID', async () => {
    const unknown = await get(`/sessions/${uuidv7()}/summary`);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('session_not_found');
    const deleted = await mkSession({ deletedAt: new Date() });
    await mkSummary(deleted);
    expect((await get(`/sessions/${deleted}/summary`)).json().error.code).toBe('session_not_found');
    const bad = await get('/sessions/keine-id/summary');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('validation_failed');
  });

  it('[S2] ohne Zusammenfassung: summary null (kein 404)', async () => {
    const id = await mkSession();
    const res = await get(`/sessions/${id}/summary`);
    expect(res.statusCode).toBe(200);
    expect(SessionSummaryViewSchema.parse(res.json())).toEqual({ session_id: id, summary: null });
    // eine weich gelöschte Zusammenfassung gibt es nicht
    await mkSummary(id, { deletedAt: new Date() });
    expect((await get(`/sessions/${id}/summary`)).json().summary).toBeNull();
  });

  it('[S3] mit Zusammenfassung: Sätze mit Quellen, Gliederung, Modell und Prompt-Version; provider und input_hash bleiben intern', async () => {
    const id = await mkSession();
    const jobId = uuidv7();
    const summaryId = await mkSummary(id, { jobId, lang: null });
    const res = await get(`/sessions/${id}/summary`);
    expect(res.statusCode, res.body).toBe(200);
    const body = SessionSummaryViewSchema.parse(res.json());
    expect(body.summary).toMatchObject({
      id: summaryId,
      session_id: id,
      lang: null,
      sentences: sentences(id),
      outline: [{ title: 'Kapitel 1', sources: [] }],
      model: 'fake-llm-1',
      prompt_version: 'summary.write/v1',
      job_id: jobId,
    });
    expect(res.body).not.toContain(HASH);
    expect(Object.keys(res.json().summary)).not.toContain('provider');
    // andere Sessions sehen sie nicht
    const other = await mkSession();
    expect((await get(`/sessions/${other}/summary`)).json().summary).toBeNull();
  });
});

// --- GET /costs/summary ---------------------------------------------------------------------------

describe('GET /costs/summary', () => {
  it('[K1] ohne Einträge: laufender Monat in Ortszeit, alles 0, Budget-Standard 10', async () => {
    const res = await get('/costs/summary');
    expect(res.statusCode, res.body).toBe(200);
    expect(CostSummarySchema.parse(res.json())).toEqual({
      budget: { month: currentMonth().month, spent_eur: 0, budget_eur: 10, reached: false, warn: false },
      calls: 0,
      by_task: [],
      by_session: [],
      by_model: [],
    });
  });

  it('[K2] Summen je Aufgabe und je Modell (teuerste zuerst), gelöschte Einträge und andere Monate zählen nicht', async () => {
    const { month, before } = currentMonth();
    const s = await mkSession({ number: 7, title: 'Titel', startedAt: new Date('2026-11-05T12:15:00Z') });
    await mkCost({ eur: 0.5, task: 'concepts.extract', sessionId: s, tokens: [1000, 200, 30, 4] });
    await mkCost({ eur: 0.25, task: 'concepts.extract', sessionId: s, tokens: [500, 100, 0, 0] });
    await mkCost({
      eur: 0.125,
      task: 'summary.write',
      sessionId: s,
      model: 'modell-b',
      provider: 'anthropic',
    });
    await mkCost({
      eur: 1,
      task: 'concepts.resolve',
      sessionId: null,
      model: 'modell-b',
      provider: 'anthropic',
    });
    await mkCost({ eur: 99, deleted: true, sessionId: s });
    await mkCost({ eur: 50, at: before, sessionId: s }); // Vormonat

    const body = CostSummarySchema.parse((await get('/costs/summary')).json());
    expect(body.budget).toEqual({ month, spent_eur: 1.875, budget_eur: 10, reached: false, warn: false });
    expect(body.calls).toBe(4);
    expect(body.by_task).toEqual([
      { task: 'concepts.resolve', calls: 1, eur: 1 },
      { task: 'concepts.extract', calls: 2, eur: 0.75 },
      { task: 'summary.write', calls: 1, eur: 0.125 },
    ]);
    expect(body.by_model).toEqual([
      {
        provider: 'anthropic',
        model: 'modell-b',
        calls: 2,
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        eur: 1.125,
      },
      {
        provider: 'fake',
        model: 'fake-llm-1',
        calls: 2,
        input_tokens: 1500,
        output_tokens: 300,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 4,
        eur: 0.75,
      },
    ]);
    // Einträge ohne Session zählen in der Summe, stehen aber nicht in by_session
    expect(body.by_session).toEqual([
      {
        session_id: s,
        session: {
          id: s,
          number: 7,
          title: 'Titel',
          started_at: '2026-11-05T12:15:00Z',
          module: { id: moduleId, name: 'Testmodul', short_name: 'TM' },
        },
        calls: 3,
        eur: 0.875,
      },
    ]);
    // Derselbe Monat ausdrücklich angefragt ergibt dasselbe
    expect((await get(`/costs/summary?month=${month}`)).json()).toEqual(body);
  });

  it('[K3] by_session: die 20 teuersten; gelöschte und nicht mehr vorhandene Sessions mit session null', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 22; i += 1) {
      const id = await mkSession({ number: i + 1 });
      ids.push(id);
      await mkCost({ eur: (i + 1) / 100, sessionId: id });
    }
    const softDeleted = ids[21]!; // die teuerste
    await handle.db.update(session).set({ deletedAt: new Date() }).where(eq(session.id, softDeleted));
    const gone = uuidv7(); // endgültig gelöscht: cost_entry hat keinen FK
    await mkCost({ eur: 5, sessionId: gone });

    const body = CostSummarySchema.parse((await get('/costs/summary')).json());
    expect(body.by_session).toHaveLength(20);
    expect(body.by_session[0]).toEqual({ session_id: gone, session: null, calls: 1, eur: 5 });
    expect(body.by_session[1]).toEqual({ session_id: softDeleted, session: null, calls: 1, eur: 0.22 });
    expect(body.by_session[2]).toMatchObject({ session_id: ids[20], session: { id: ids[20], number: 21 } });
    // absteigend nach Kosten, die billigsten drei fehlen
    const eur = body.by_session.map((r) => r.eur);
    expect([...eur].sort((a, b) => b - a)).toEqual(eur);
    expect(body.by_session.map((r) => r.session_id)).not.toContain(ids[0]);
    // die Summe zählt trotzdem alle 23 Aufrufe
    expect(body.calls).toBe(23);
  });

  it('[K4] month: Monatsgrenze in Ortszeit (Zeitzone als Parameter), nicht in UTC', async () => {
    await mkCost({ eur: 1, at: new Date('2026-09-30T21:59:59Z') }); // 23:59:59 MESZ am 30.09.
    await mkCost({ eur: 2, at: new Date('2026-09-30T22:00:00Z') }); // 00:00 MESZ am 01.10.
    await mkCost({ eur: 4, at: new Date('2026-10-31T22:59:59Z') }); // 23:59:59 MEZ am 31.10.
    await mkCost({ eur: 8, at: new Date('2026-10-31T23:00:00Z') }); // 00:00 MEZ am 01.11.
    const spent = async (month: string, timeZone: string) =>
      (await getCostSummary(handle.db, { month }, { timeZone })).budget.spent_eur;
    expect(await spent('2026-09', 'Europe/Zurich')).toBe(1);
    expect(await spent('2026-10', 'Europe/Zurich')).toBe(6);
    expect(await spent('2026-11', 'Europe/Zurich')).toBe(8);
    expect(await spent('2026-09', 'UTC')).toBe(3);
    expect(await spent('2026-10', 'UTC')).toBe(12);
    expect(await spent('2026-11', 'UTC')).toBe(0);
    const october = await getCostSummary(handle.db, { month: '2026-10' }, { timeZone: 'Europe/Zurich' });
    expect(october.budget.month).toBe('2026-10');
    expect(october.calls).toBe(2);
    // über die Route (Ortszeit des Prozesses): ein vergangener Monat ohne Einträge ist leer, kein Fehler
    const empty = await get('/costs/summary?month=2020-02');
    expect(CostSummarySchema.parse(empty.json())).toMatchObject({
      budget: { month: '2020-02', spent_eur: 0 },
      calls: 0,
    });
  });

  it('[K5] 400 validation_failed für einen month, der kein YYYY-MM ist', async () => {
    // 0000-01: Postgres kennt das Jahr 0 nicht, ohne Prüfung käme ein 500
    for (const month of ['2026-13', '2026-00', '2026-1', '26-11', 'november', '2026-11-01', '', '0000-01']) {
      const res = await get(`/costs/summary?month=${encodeURIComponent(month)}`);
      expect(res.statusCode, month).toBe(400);
      expect(res.json().error.code).toBe('validation_failed');
    }
    await expect(
      getCostSummary(handle.db, { month: "2026-11'; DROP TABLE cost_entry; --" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'validation_failed',
    });
  });

  it('[K6] Budget: warn ab 80 %, reached ab 100 %, 0 schaltet die Cloud-KI ab; ungültiger Wert zählt als 10', async () => {
    const status = () => getBudgetStatus(handle.db);
    await mkCost({ eur: 7.99 });
    expect(await status()).toMatchObject({ spent_eur: 7.99, budget_eur: 10, warn: false, reached: false });
    await mkCost({ eur: 0.01 });
    expect(await status()).toMatchObject({ spent_eur: 8, warn: true, reached: false });
    await mkCost({ eur: 1.99 });
    expect(await status()).toMatchObject({ spent_eur: 9.99, warn: true, reached: false });
    await mkCost({ eur: 0.01 });
    expect(await status()).toMatchObject({ spent_eur: 10, warn: true, reached: true });
    // höheres Budget über die Einstellungen (so stößt der Nutzer die Kette wieder an)
    const patched = await app.request({
      method: 'PATCH',
      url: `${API}/settings`,
      payload: { ai: { monthly_budget_eur: 20 } },
    });
    expect(patched.statusCode).toBe(200);
    expect(await status()).toMatchObject({ budget_eur: 20, warn: false, reached: false });
    expect((await get('/costs/summary')).json().budget).toEqual(await status());
    // ungültig gespeichert: Standard 10 (wie der Worker)
    await setBudget('viel');
    expect(await status()).toMatchObject({ budget_eur: 10, reached: true });
    // 0: erreicht, auch ohne Kosten
    await handle.sql`TRUNCATE cost_entry`;
    await setBudget(0);
    expect(await status()).toEqual({
      month: currentMonth().month,
      spent_eur: 0,
      budget_eur: 0,
      reached: true,
      warn: true,
    });
  });

  it('[K7] laufender Monat nutzt den Ausdruck aus §20.5 (wie der Worker): gleiche Summe', async () => {
    const { before } = currentMonth();
    await mkCost({ eur: 0.3 });
    await mkCost({ eur: 0.4, at: before });
    await mkCost({ eur: 9, deleted: true });
    const tz = localTimeZone();
    // MONTH_SPENT_SQL aus services/worker/src/sg_worker/ai/budget.py
    const [row] = await handle.sql`
      SELECT coalesce(sum(cost_estimate_eur), 0)::float8 AS spent FROM cost_entry
      WHERE deleted_at IS NULL
        AND created_at >= date_trunc('month', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}`;
    expect(row?.spent).toBe(0.3);
    expect((await getBudgetStatus(handle.db)).spent_eur).toBe(0.3);
    expect((await getCostSummary(handle.db, {})).budget.spent_eur).toBe(0.3);
  });

  it('[K8] localTimeZone: TZ ohne führenden Doppelpunkt, ungültige Namen zählen nicht', () => {
    expect(localTimeZone({ TZ: 'Europe/Zurich' })).toBe('Europe/Zurich');
    expect(localTimeZone({ TZ: ':America/New_York' })).toBe('America/New_York');
    const fallback = localTimeZone({});
    expect(localTimeZone({ TZ: 'Nicht/Vorhanden' })).toBe(fallback);
    expect(localTimeZone({ TZ: '  ' })).toBe(fallback);
    expect(() => new Intl.DateTimeFormat('en-CA', { timeZone: fallback })).not.toThrow();
  });
});

// --- GET /ai/status -------------------------------------------------------------------------------

describe('GET /ai/status', () => {
  const status = async () => {
    const res = await get('/ai/status');
    expect(res.statusCode, res.body).toBe(200);
    return AiStatusSchema.parse(res.json());
  };

  it('[A1] eingerichtet bzw. nicht eingerichtet: llm aus GET /health des Workers, dazu das Budget', async () => {
    await mkCost({ eur: 1.5 });
    expect(await status()).toEqual({
      worker_reachable: true,
      llm: { provider: 'fake', configured: true, issue: null },
      budget: { month: currentMonth().month, spent_eur: 1.5, budget_eur: 10, reached: false, warn: false },
    });
    expect(worker.requests.at(-1)).toMatchObject({ method: 'GET', path: '/health' });
    for (const issue of ['kein_schluessel', 'env_offen', 'unbekannter_anbieter'] as const) {
      worker.llm = { provider: 'anthropic', configured: false, issue };
      expect((await status()).llm).toEqual({ provider: 'anthropic', configured: false, issue });
    }
  });

  it('[A2] älterer Worker ohne llm: erreichbar, llm null', async () => {
    worker.llm = undefined;
    expect(await status()).toMatchObject({ worker_reachable: true, llm: null });
  });

  it('[A3] Worker antwortet nicht innerhalb von 800 ms oder lehnt ab: worker_reachable false, llm null, Budget kommt trotzdem', async () => {
    await setBudget(1);
    await mkCost({ eur: 1 });
    worker.healthDelayMs = 3000;
    const started = Date.now();
    const slow = await status();
    expect(Date.now() - started).toBeLessThan(1500);
    expect(slow).toEqual({
      worker_reachable: false,
      llm: null,
      budget: { month: currentMonth().month, spent_eur: 1, budget_eur: 1, reached: true, warn: true },
    });
    worker.healthDelayMs = 0;
    worker.mode = 'unauthorized';
    expect(await status()).toMatchObject({ worker_reachable: false, llm: null });
  });

  it('[A4] Worker aus: worker_reachable false (Dienst direkt, ohne offenen Port)', async () => {
    const down = { llmStatus: async () => ({ reachable: false, llm: null }) };
    expect(await getAiStatus({ db: handle.db, worker: down })).toMatchObject({
      worker_reachable: false,
      llm: null,
      budget: { budget_eur: 10, reached: false },
    });
  });
});

// --- Netz -----------------------------------------------------------------------------------------

describe('aus dem Netz (§20.6: wie die übrigen Routen)', () => {
  it('[N1] mit Geräte-Token erlaubt, ohne Token abgelehnt', async () => {
    const id = await mkSession();
    for (const url of [`/sessions/${id}/summary`, '/costs/summary', '/ai/status']) {
      expect((await fromNetwork(url)).statusCode, url).toBe(200);
      expect((await fromNetwork(url, false)).statusCode, url).toBe(401);
    }
  });
});
