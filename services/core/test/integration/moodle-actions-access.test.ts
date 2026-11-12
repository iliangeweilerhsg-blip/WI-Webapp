// Moodle-Aktionen nur vom Mac selbst (08 §9.3, Befund B1 aus dem Plan T1-24) und Bestätigungscode nie in Postgres (B2)
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MoodleActionPreviewSchema } from '@sg/shared';
import { idempotencyKey } from '../../src/db/schema/index.ts';
import { DEFAULT_ACTION_HANDLERS, type MoodleActionHandlers } from '../../src/moodle/actions.ts';
import { createMoodleServices } from '../../src/moodle/index.ts';
import { StaticTokenStore } from '../../src/moodle/token-store.ts';
import { FAKE_BASE, FAKE_TOKEN, fakeFetch, restHandler, siteInfo } from '../unit/moodle-fake.ts';
import { startTestApp, type TestApp } from './helpers.ts';

const API = '/api/v1';
const DEVICE_ID = '0190f6a2-0000-7000-8000-0000000000f2';
const submitParams = { assignment_id: 12, accept_statement: true };

let t: TestApp;
let requests: ReturnType<typeof fakeFetch>['requests'];
const executed: unknown[] = [];

beforeAll(async () => {
  const fake = fakeFetch(
    restHandler({
      core_webservice_get_site_info: siteInfo([
        'core_webservice_get_site_info',
        'mod_assign_get_submission_status',
        'mod_assign_submit_for_grading',
      ]),
    }),
  );
  requests = fake.requests;
  // Handler für `assign.submit` (endgueltig, immer mit Code) wie in den Unit-Tests: schreibt nichts nach Moodle
  const submitHandler: MoodleActionHandlers['assign.submit'] = {
    async preview(_ctx, params) {
      return { summary: `Aufgabe ${params.assignment_id} endgültig einreichen.` };
    },
    async execute(_ctx, params) {
      executed.push(params);
      return { summary: 'Eingereicht.', result: { submitted: true } };
    },
  };
  const dataDir = mkdtempSync(join(tmpdir(), 'sg-core-moodle-access-'));
  const moodle = createMoodleServices({
    config: { moodleUrl: FAKE_BASE, dataDir, moodleActions: ['assign.submit'] },
    tokens: new StaticTokenStore(FAKE_TOKEN),
    fetch: fake.fetch,
    handlers: { ...DEFAULT_ACTION_HANDLERS, 'assign.submit': submitHandler },
    readMeta: async () => ({ token_valid_until: '2027-01-27' }),
  });
  t = await startTestApp(
    { moodleUrl: FAKE_BASE, dataDir },
    { moodle, verifyDeviceToken: async () => ({ deviceId: DEVICE_ID }) },
  );
});

afterAll(async () => {
  await t.close();
});

beforeEach(() => {
  requests.length = 0;
  executed.length = 0;
});

/** Anfrage aus dem Netz (gekoppeltes iPad im WLAN) */
const fromNetwork = (options: InjectOptions & { token?: string }) =>
  t.app.inject({
    remoteAddress: '192.168.1.20',
    ...options,
    headers: {
      host: 'mac.local:4710',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
  });

const errorCode = (res: { json: () => unknown }) => (res.json() as { error: { code: string } }).error.code;

describe('Moodle-Aktionen aus dem Netz', () => {
  it('Vorschau und Ausführen: 401 ohne Token, 403 local_only mit gültigem Geräte-Token, Moodle sieht nichts', async () => {
    for (const step of ['preview', 'execute'] as const) {
      const url = `${API}/moodle/actions/assign.submit/${step}`;
      const body = { params: submitParams };
      const none = await fromNetwork({ method: 'POST', url, payload: body });
      expect(none.statusCode, step).toBe(401);
      const res = await fromNetwork({ method: 'POST', url, payload: body, token: 'EXAMPLEdevicetoken000' });
      expect(res.statusCode, step).toBe(403);
      expect(errorCode(res), step).toBe('local_only');
    }
    expect(requests).toHaveLength(0);
    expect(executed).toHaveLength(0);
  });

  it('auch Aktionen ohne Bestätigungspflicht lassen sich aus dem Netz nicht ausführen', async () => {
    const res = await fromNetwork({
      method: 'POST',
      url: `${API}/moodle/actions/notifications.mark_read/execute`,
      payload: { params: {} },
      token: 'EXAMPLEdevicetoken000',
    });
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('local_only');
    expect(requests).toHaveLength(0);
  });

  it('der Katalog bleibt mit Geräte-Token lesbar (ändert nichts)', async () => {
    const res = await fromNetwork({
      method: 'GET',
      url: `${API}/moodle/actions`,
      token: 'EXAMPLEdevicetoken000',
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('Bestätigungscode nie unter einem Idempotency-Key', () => {
  it('Vorschau mit Idempotency-Key: kein Eintrag in idempotency_key, kein Replay, jedes Mal ein neuer Code', async () => {
    const key = crypto.randomUUID();
    const preview = () =>
      t.request({
        method: 'POST',
        url: `${API}/moodle/actions/assign.submit/preview`,
        headers: { 'idempotency-key': key },
        payload: { params: submitParams },
      });
    const first = await preview();
    expect(first.statusCode).toBe(200);
    const code = MoodleActionPreviewSchema.parse(first.json()).confirmation_token;
    expect(code).toBeTruthy();
    const stored = await t.handle.db
      .select()
      .from(idempotencyKey)
      .where(sql`${idempotencyKey.key} = ${key}::uuid`);
    expect(stored).toHaveLength(0);

    const second = await preview();
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replay']).toBeUndefined();
    expect(MoodleActionPreviewSchema.parse(second.json()).confirmation_token).not.toBe(code);
  });

  it('lokal: Ausführen mit Code geht, Idempotency-Key gilt dort weiter, der Code steht nicht in der Datenbank', async () => {
    const preview = await t.request({
      method: 'POST',
      url: `${API}/moodle/actions/assign.submit/preview`,
      payload: { params: submitParams },
    });
    const code = MoodleActionPreviewSchema.parse(preview.json()).confirmation_token;
    expect(code).toBeTruthy();
    const key = crypto.randomUUID();
    const execute = () =>
      t.request({
        method: 'POST',
        url: `${API}/moodle/actions/assign.submit/execute`,
        headers: { 'idempotency-key': key },
        payload: { params: submitParams, confirmation_token: code },
      });
    const res = await execute();
    expect(res.statusCode).toBe(200);
    expect(executed).toHaveLength(1);
    const [row] = await t.handle.db
      .select()
      .from(idempotencyKey)
      .where(sql`${idempotencyKey.key} = ${key}::uuid`);
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(code);
    // Doppelter Klick: gespeicherte Antwort, kein zweites Ausführen
    const replay = await execute();
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(executed).toHaveLength(1);
  });
});
