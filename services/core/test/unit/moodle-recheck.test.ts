// POST /moodle/recheck: Token- und Status-Cache leeren, Zustand neu holen (Folgepunkt aus #316)
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { MoodleStatusSchema } from '@sg/shared';
import { createMoodleServices } from '../../src/moodle/index.ts';
import type { RecheckClock } from '../../src/moodle/status.ts';
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
async function setup(
  options: {
    baseUrl?: string;
    token?: string | null;
    down?: boolean;
    recheck?: { minGapMs?: number; clock?: RecheckClock };
  } = {},
) {
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
    recheck: options.recheck ?? { minGapMs: 0 },
  });
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  await app.register(moodleRoutes, { moodle });
  await app.ready();
  return { app, keychain, logs, moodle, requests: fake.requests };
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

  it('gleichzeitige Aufrufe: ein laufender und höchstens ein nachgereihter Lauf', async () => {
    const t = await setup({ token: FAKE_TOKEN });
    await t.app.inject('/moodle/status');
    const reads = t.keychain.reads;
    const before = t.requests.length;
    const results = await Promise.all(Array.from({ length: 5 }, () => recheck(t.app)));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(t.requests.length).toBe(before + 2);
    // Jeder Aufruf verwirft den Token-Cache sofort: Der erste Lauf merkt sein Lesen nicht und liest einmal nach,
    // der nachgereihte einmal. Mehr Aufrufe ändern daran nichts
    expect(t.keychain.reads).toBe(reads + 3);
  });

  it('ein Aufruf während eines Laufs mit altem Token bekommt einen späteren Lauf mit dem neuen', async () => {
    const t = await setup({ token: FAKE_TOKEN });
    const first = recheck(t.app); // liest den alten Token
    t.keychain.token = OTHER_TOKEN;
    const second = recheck(t.app); // wird nachgereiht
    const third = recheck(t.app); // teilt den nachgereihten Lauf
    expect((await second).json()).toMatchObject({ state: 'ungueltig' });
    expect((await third).json()).toMatchObject({ state: 'ungueltig' });
    await first;
  });

  describe('Mindestpause (Fake-Uhr)', () => {
    /** Uhr, die nur vorrückt, wenn der Test es sagt; `sleep` wartet auf diese Zeit */
    function fakeClock() {
      let time = 10_000;
      const sleepers: Array<{ until: number; resolve: () => void }> = [];
      const clock: RecheckClock = {
        now: () => time,
        sleep: (ms) =>
          new Promise<void>((resolve) => {
            sleepers.push({ until: time + ms, resolve });
          }),
      };
      const advance = (ms: number) => {
        time += ms;
        for (const s of sleepers.splice(0)) {
          if (s.until <= time) s.resolve();
          else sleepers.push(s);
        }
      };
      return { clock, advance, sleeping: () => sleepers.length };
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    it('der nachgereihte Lauf startet frühestens 1 s nach dem Start des vorigen', async () => {
      const f = fakeClock();
      const t = await setup({ token: FAKE_TOKEN, recheck: { minGapMs: 1000, clock: f.clock } });
      await recheck(t.app); // Start bei t=0
      expect(t.requests).toHaveLength(1);
      const queued = recheck(t.app);
      await settle();
      expect(t.requests).toHaveLength(1); // wartet auf die Pause
      expect(f.sleeping()).toBe(1);
      f.advance(999);
      await settle();
      expect(t.requests).toHaveLength(1);
      f.advance(1);
      expect((await queued).statusCode).toBe(200);
      expect(t.requests).toHaveLength(2);
    });

    it('eine Schleife von Aufrufen löst höchstens einen Lauf pro Sekunde aus', async () => {
      const f = fakeClock();
      const t = await setup({ token: FAKE_TOKEN, recheck: { minGapMs: 1000, clock: f.clock } });
      await recheck(t.app);
      const calls = Array.from({ length: 10 }, () => recheck(t.app));
      await settle();
      expect(t.requests).toHaveLength(1);
      f.advance(1000);
      await Promise.all(calls);
      expect(t.requests).toHaveLength(2); // alle zehn teilen sich den einen nachgereihten Lauf
    });

    it('in der Wartezeit gilt schon der neue Token (Caches sofort verworfen, #320)', async () => {
      const f = fakeClock();
      const t = await setup({ token: FAKE_TOKEN, recheck: { minGapMs: 1000, clock: f.clock } });
      expect((await recheck(t.app)).json()).toMatchObject({ state: 'ok' });
      t.keychain.token = OTHER_TOKEN;
      const queued = recheck(t.app);
      await settle();
      expect(f.sleeping()).toBe(1);
      // Eine Vorschau oder Statusabfrage in der Wartezeit sieht nicht mehr den alten Token und Stand
      expect((await t.app.inject('/moodle/status')).json()).toMatchObject({ state: 'ungueltig' });
      f.advance(1000);
      expect((await queued).json()).toMatchObject({ state: 'ungueltig' });
    });

    it('nach Ablauf der Pause startet ein Aufruf sofort', async () => {
      const f = fakeClock();
      const t = await setup({ token: FAKE_TOKEN, recheck: { minGapMs: 1000, clock: f.clock } });
      await recheck(t.app);
      f.advance(1000);
      await recheck(t.app);
      expect(t.requests).toHaveLength(2);
      expect(f.sleeping()).toBe(0);
    });
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

  it('verwirft offene Bestätigungscodes: ein Code aus der Vorschau mit dem alten Token gilt nicht unter dem neuen', async () => {
    const t = await setup({ token: FAKE_TOKEN });
    const code = t.moodle.confirmations.issue('assign.submit', { assignment_id: 3 }, { scope: 'assign:3' });
    const unscoped = t.moodle.confirmations.issue('notifications.mark_read', {});
    expect((await recheck(t.app)).statusCode).toBe(200);
    expect(t.moodle.confirmations.size).toBe(0);
    expect(t.moodle.confirmations.consume(code.token, 'assign.submit', { assignment_id: 3 })).toBe('invalid');
    expect(t.moodle.confirmations.consume(unscoped.token, 'notifications.mark_read', {})).toBe('invalid');
  });

  it('ein Schlüsselbund-Lesen, das vor dem Recheck begann, überschreibt den neuen Token nicht', async () => {
    let release: (() => void) | undefined;
    let slowFirst = true;
    const keychain = { token: FAKE_TOKEN as string | null };
    const tokens = new KeychainTokenStore({
      exec: async () => {
        const value = keychain.token;
        if (slowFirst) {
          // Liest noch den alten Eintrag, antwortet aber erst nach dem Recheck
          slowFirst = false;
          await new Promise<void>((resolve) => (release = resolve));
        }
        if (value === null) throw new Error('not found');
        return { stdout: `${value}\n` };
      },
    });
    const stale = tokens.getToken();
    keychain.token = OTHER_TOKEN;
    tokens.invalidate();
    expect(await tokens.getToken()).toBe(OTHER_TOKEN);
    release?.();
    expect(await stale).toBe(FAKE_TOKEN);
    expect(await tokens.getToken()).toBe(OTHER_TOKEN);
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
