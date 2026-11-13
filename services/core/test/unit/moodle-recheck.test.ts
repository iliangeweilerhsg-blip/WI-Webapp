// POST /moodle/recheck: Token- und Status-Cache leeren, Zustand neu holen (Folgepunkt aus #316)
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { MoodleStatusSchema } from '@sg/shared';
import { createMoodleServices } from '../../src/moodle/index.ts';
import { KeychainTokenStore, type ExecFileFn } from '../../src/moodle/token-store.ts';
import { registerErrorHandler } from '../../src/plugins/errors.ts';
import { moodleRoutes } from '../../src/routes/moodle.ts';
import { FAKE_BASE, FAKE_TOKEN, fakeFetch, json, restHandler, siteInfo } from './moodle-fake.ts';

const OTHER_TOKEN = 'cd'.repeat(16);

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Echter `KeychainTokenStore` mit einem Schlüsselbund aus dem Speicher, damit dessen Zwischenspeicher mitzählen */
async function setup(options: { baseUrl?: string; token?: string | null; down?: boolean } = {}) {
  const keychain = { token: options.token === undefined ? (null as string | null) : options.token, reads: 0 };
  const exec: ExecFileFn = async () => {
    keychain.reads += 1;
    if (keychain.token === null) throw new Error('not found');
    return { stdout: `${keychain.token}\n` };
  };
  const logs: string[] = [];
  const rest = restHandler({ core_webservice_get_site_info: siteInfo(['core_webservice_get_site_info']) });
  const fake = fakeFetch((request) => (options.down ? json({}, 503) : rest(request)));
  const moodle = createMoodleServices({
    config: { moodleUrl: options.baseUrl ?? FAKE_BASE, dataDir: '/gibt/es/nicht' },
    tokens: new KeychainTokenStore({ exec }),
    fetch: fake.fetch,
    logger: {
      debug: (obj, msg) => logs.push(JSON.stringify([obj, msg])),
      warn: (obj, msg) => logs.push(JSON.stringify([obj, msg])),
    },
    readMeta: async () => ({ token_valid_until: '2099-01-01' }),
    client: { retryDelaysMs: [], minIntervalMs: 0 },
  });
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  await app.register(moodleRoutes, { moodle });
  await app.ready();
  return { app, keychain, logs, requests: fake.requests };
}

const recheck = (a: FastifyInstance) => a.inject({ method: 'POST', url: '/moodle/recheck' });

describe('POST /moodle/recheck', () => {
  it('leert den Token-Cache (fehlender Token) und übernimmt den neuen Token sofort', async () => {
    const t = await setup({ token: null });
    expect((await t.app.inject('/moodle/status')).json()).toMatchObject({ state: 'nicht_eingerichtet' });
    t.keychain.token = FAKE_TOKEN;
    // Ohne Recheck bleibt „kein Token“ 30 s im Zwischenspeicher
    expect((await t.app.inject('/moodle/status')).json()).toMatchObject({ state: 'nicht_eingerichtet' });
    const res = await recheck(t.app);
    expect(res.statusCode).toBe(200);
    expect(MoodleStatusSchema.parse(res.json())).toMatchObject({
      state: 'ok',
      user_fullname: 'Erika Muster',
    });
  });

  it('leert Token-Cache (gefundener Token) und Status-Cache (ok, 5 min)', async () => {
    const t = await setup({ token: FAKE_TOKEN });
    expect((await t.app.inject('/moodle/status')).json()).toMatchObject({ state: 'ok' });
    t.keychain.token = OTHER_TOKEN;
    // Beide Zwischenspeicher halten den alten Stand
    expect((await t.app.inject('/moodle/status')).json()).toMatchObject({ state: 'ok' });
    const before = t.requests.length;
    const res = await recheck(t.app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: 'ungueltig' });
    expect(t.requests.length).toBe(before + 1);
  });

  it('gleichzeitige Aufrufe teilen sich einen Lauf (ein Moodle-Aufruf, ein Schlüsselbund-Lesen)', async () => {
    const t = await setup({ token: FAKE_TOKEN });
    await t.app.inject('/moodle/status');
    const reads = t.keychain.reads;
    const before = t.requests.length;
    const results = await Promise.all(Array.from({ length: 5 }, () => recheck(t.app)));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(results.map((r) => r.body)).size).toBe(1);
    expect(t.requests.length).toBe(before + 1);
    expect(t.keychain.reads).toBe(reads + 1);
  });

  it('ein vor dem Recheck gestarteter Aufruf mit altem Token füllt den Zwischenspeicher nicht mehr', async () => {
    const t = await setup({ token: FAKE_TOKEN });
    const stale = t.app.inject('/moodle/status'); // läuft noch mit dem alten Token
    t.keychain.token = OTHER_TOKEN;
    const fresh = await recheck(t.app);
    await stale;
    expect(fresh.json()).toMatchObject({ state: 'ungueltig' });
    expect((await t.app.inject('/moodle/status')).json()).toMatchObject({ state: 'ungueltig' });
  });

  it('ohne SG_MOODLE_URL: 200 nicht_eingerichtet, kein Moodle-Aufruf', async () => {
    const t = await setup({ baseUrl: '', token: FAKE_TOKEN });
    const res = await recheck(t.app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: 'nicht_eingerichtet', site_url: null });
    expect(t.requests).toHaveLength(0);
  });

  it('ohne Token: 200 nicht_eingerichtet', async () => {
    const t = await setup({ token: null });
    const res = await recheck(t.app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: 'nicht_eingerichtet' });
  });

  it('Moodle nicht erreichbar: 200 nicht_erreichbar statt Fehler', async () => {
    const t = await setup({ token: FAKE_TOKEN, down: true });
    const res = await recheck(t.app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: 'nicht_erreichbar' });
  });

  it('löst keinen Abgleich und keine Aktion aus: nur core_webservice_get_site_info geht an Moodle', async () => {
    const t = await setup({ token: FAKE_TOKEN });
    await recheck(t.app);
    expect(t.requests.map((r) => r.body.get('wsfunction'))).toEqual(['core_webservice_get_site_info']);
  });

  it('Token steht weder in der Antwort noch im Log', async () => {
    const t = await setup({ token: FAKE_TOKEN });
    const ok = await recheck(t.app);
    t.keychain.token = OTHER_TOKEN;
    const bad = await recheck(t.app);
    expect(bad.json()).toMatchObject({ state: 'ungueltig' });
    expect(t.logs.length).toBeGreaterThan(0);
    for (const text of [ok.body, bad.body, ...t.logs]) {
      expect(text).not.toContain(FAKE_TOKEN);
      expect(text).not.toContain(OTHER_TOKEN);
    }
  });
});
