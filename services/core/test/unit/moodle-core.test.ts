import { describe, expect, it } from 'vitest';
import { MoodleStatusSchema } from '@sg/shared';
import { MoodleClient } from '../../src/moodle/client.ts';
import { canonicalJson, ConfirmationStore } from '../../src/moodle/confirmations.ts';
import { computeState, daysUntil, MoodleStatusService } from '../../src/moodle/status.ts';
import { KeychainTokenStore, StaticTokenStore } from '../../src/moodle/token-store.ts';
import { FAKE_BASE, FAKE_TOKEN, fakeFetch, restHandler, siteInfo } from './moodle-fake.ts';

describe('Bestätigungscodes (F-MDL-06)', () => {
  it('canonicalJson sortiert Schlüssel rekursiv', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"x":2,"y":1}]},"b":1}',
    );
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('Code gilt einmal, nur für dieselbe Aktion mit denselben Parametern', () => {
    const store = new ConfirmationStore();
    const params = { assignment_id: 3, accept_statement: true };
    const { token } = store.issue('assign.submit', params);
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // Schlüsselreihenfolge egal
    expect(store.consume(token, 'assign.submit', { accept_statement: true, assignment_id: 3 })).toBe(true);
    expect(store.consume(token, 'assign.submit', params)).toBe(false);
  });

  it('andere Parameter oder Aktion verbrauchen den Code', () => {
    const store = new ConfirmationStore();
    const a = store.issue('assign.submit', { assignment_id: 3, accept_statement: true });
    expect(store.consume(a.token, 'assign.submit', { assignment_id: 4, accept_statement: true })).toBe(false);
    expect(store.consume(a.token, 'assign.submit', { assignment_id: 3, accept_statement: true })).toBe(false);
    const b = store.issue('forum.reply', { post_id: 1, message_html: 'x' });
    expect(store.consume(b.token, 'message.send', { post_id: 1, message_html: 'x' })).toBe(false);
    expect(store.consume('gibt-es-nicht-1234', 'forum.reply', {})).toBe(false);
  });

  it('Code verfällt nach 5 Minuten', () => {
    let now = 1_000_000;
    const store = new ConfirmationStore({ now: () => now });
    const { token, expiresAt } = store.issue('message.send', { to_user_id: 1, text: 'Hallo' });
    expect(expiresAt.getTime()).toBe(now + 5 * 60 * 1000);
    now += 5 * 60 * 1000;
    expect(store.consume(token, 'message.send', { to_user_id: 1, text: 'Hallo' })).toBe(false);
  });

  it('abgelaufene Codes werden aufgeräumt, höchstens 100 offen', () => {
    let now = 0;
    const store = new ConfirmationStore({ now: () => now });
    for (let i = 0; i < 150; i += 1) store.issue('forum.reply', { post_id: i + 1, message_html: 'x' });
    expect(store.size).toBe(100);
    now += 10 * 60 * 1000;
    store.issue('forum.reply', { post_id: 1, message_html: 'x' });
    expect(store.size).toBe(1);
  });
});

describe('Zustand des Zugangs (F-MDL-01)', () => {
  const today = new Date('2026-11-04T10:00:00Z');

  it('daysUntil zählt ganze Tage', () => {
    expect(daysUntil('2026-11-04', today)).toBe(0);
    expect(daysUntil('2026-11-11', today)).toBe(7);
    expect(daysUntil('2026-11-03', today)).toBe(-1);
  });

  it.each([
    ['not_configured', '2027-01-27', 'nicht_eingerichtet'],
    ['ok', '2027-01-27', 'ok'],
    ['ok', null, 'ok'],
    ['ok', '2026-11-11', 'laeuft_bald_ab'],
    ['ok', '2026-11-12', 'ok'],
    ['ok', '2026-11-01', 'laeuft_bald_ab'],
    ['invalid', '2027-01-27', 'ungueltig'],
    ['invalid', null, 'ungueltig'],
    ['invalid', '2026-11-03', 'abgelaufen'],
    ['unreachable', '2027-01-27', 'nicht_erreichbar'],
  ] as const)('%s, gültig bis %s → %s', (check, validUntil, state) => {
    expect(computeState(check, validUntil, today)).toBe(state);
  });
});

describe('MoodleStatusService', () => {
  function setup(token: string | null, responses: Record<string, unknown>, baseUrl = FAKE_BASE) {
    const fake = fakeFetch(restHandler(responses));
    let now = new Date('2026-11-04T10:00:00Z');
    const client = new MoodleClient({
      baseUrl,
      tokens: new StaticTokenStore(token),
      fetch: fake.fetch,
      minIntervalMs: 0,
      sleep: async () => {},
    });
    const service = new MoodleStatusService({
      client,
      readMeta: async () => ({ token_valid_until: '2027-01-27' }),
      now: () => now,
    });
    return {
      service,
      requests: fake.requests,
      advance: (ms: number) => (now = new Date(now.getTime() + ms)),
    };
  }

  it('ok: Name, Nutzer, Ablaufdatum; Ergebnis 5 min zwischengespeichert', async () => {
    const { service, requests, advance } = setup(FAKE_TOKEN, {
      core_webservice_get_site_info: siteInfo(['core_webservice_get_site_info']),
    });
    const status = MoodleStatusSchema.parse(await service.getStatus());
    expect(status).toEqual({
      state: 'ok',
      site_url: FAKE_BASE,
      site_name: 'Moodle Beispiel',
      user_fullname: 'Erika Muster',
      token_valid_until: '2027-01-27',
      checked_at: '2026-11-04T10:00:00.000Z',
    });
    await service.getStatus();
    expect(requests).toHaveLength(1);
    advance(5 * 60 * 1000);
    await service.getStatus();
    expect(requests).toHaveLength(2);
    expect(await service.userId()).toBe(4711);
    expect(await service.availableFunctions()).toEqual(new Set(['core_webservice_get_site_info']));
  });

  it('ohne Token → nicht_eingerichtet, ohne Anfrage', async () => {
    const { service, requests } = setup(null, {});
    expect(await service.getStatus()).toMatchObject({ state: 'nicht_eingerichtet', checked_at: null });
    expect(await service.availableFunctions()).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('ohne SG_MOODLE_URL → nicht_eingerichtet, site_url null', async () => {
    const { service } = setup(FAKE_TOKEN, {}, '');
    expect(await service.getStatus()).toMatchObject({ state: 'nicht_eingerichtet', site_url: null });
  });

  it('abgelehnter Token → ungueltig', async () => {
    const { service } = setup('ffffffffffffffffffffffffffffffff', {});
    expect((await service.getStatus()).state).toBe('ungueltig');
  });

  it('gleichzeitige Abfragen teilen sich einen Aufruf', async () => {
    const { service, requests } = setup(FAKE_TOKEN, { core_webservice_get_site_info: siteInfo([]) });
    await Promise.all([service.getStatus(), service.getStatus(), service.availableFunctions()]);
    expect(requests).toHaveLength(1);
  });

  it('Härtung #93: functions mit null, Zahl und Text darin → kein Absturz, nur gültige Namen', async () => {
    const { service } = setup(FAKE_TOKEN, {
      core_webservice_get_site_info: {
        ...siteInfo([]),
        functions: [null, 5, 'core_x', [], { name: 7 }, { name: 'core_webservice_get_site_info' }],
      },
    });
    expect((await service.getStatus()).state).toBe('ok');
    expect(await service.availableFunctions()).toEqual(new Set(['core_webservice_get_site_info']));
  });

  it('Härtung #93: functions: [null] allein → leere Freigaben, Status ok', async () => {
    const { service } = setup(FAKE_TOKEN, {
      core_webservice_get_site_info: { ...siteInfo([]), functions: [null] },
    });
    expect((await service.getStatus()).state).toBe('ok');
    expect(await service.availableFunctions()).toEqual(new Set());
  });

  it.each([null, 'ok', 42, ['x']])(
    'Härtung #93: Seiteninfo %j statt Objekt → nicht_erreichbar, kein Absturz',
    async (body) => {
      const { service } = setup(FAKE_TOKEN, { core_webservice_get_site_info: body });
      const status = MoodleStatusSchema.parse(await service.getStatus());
      expect(status.state).toBe('nicht_erreichbar');
      expect(await service.availableFunctions()).toBeNull();
      await expect(service.userId()).rejects.toMatchObject({ code: 'moodle_unreachable' });
    },
  );
});

describe('KeychainTokenStore', () => {
  it('liest den Token mit security und merkt ihn sich', async () => {
    const calls: string[][] = [];
    const store = new KeychainTokenStore({
      exec: async (file, args) => {
        calls.push([file, ...args]);
        return { stdout: `${FAKE_TOKEN}\n` };
      },
    });
    expect(await store.getToken()).toBe(FAKE_TOKEN);
    expect(await store.getToken()).toBe(FAKE_TOKEN);
    expect(calls).toEqual([['security', 'find-generic-password', '-s', 'studiengehirn-moodle', '-w']]);
    store.invalidate();
    await store.getToken();
    expect(calls).toHaveLength(2);
  });

  it('kein Eintrag oder falsches Format → null', async () => {
    const missing = new KeychainTokenStore({
      exec: async () => {
        throw new Error('The specified item could not be found in the keychain.');
      },
    });
    expect(await missing.getToken()).toBeNull();
    const wrong = new KeychainTokenStore({ exec: async () => ({ stdout: 'kein-token' }) });
    expect(await wrong.getToken()).toBeNull();
  });
});

describe('Nacharbeit Review: Token-Speicher und Status', () => {
  it('„kein Token“ gilt nur 30 s, danach wird der Schlüsselbund neu gelesen', async () => {
    let now = 0;
    let stored = '';
    const store = new KeychainTokenStore({
      now: () => now,
      exec: async () => {
        if (!stored) throw new Error('could not be found');
        return { stdout: stored };
      },
    });
    expect(await store.getToken()).toBeNull();
    stored = FAKE_TOKEN;
    now += 29_000;
    expect(await store.getToken()).toBeNull();
    now += 2_000;
    expect(await store.getToken()).toBe(FAKE_TOKEN);
  });

  it('abgelehnter Token in irgendeinem Aufruf verwirft den Status sofort', async () => {
    let valid = true;
    const fake = fakeFetch((req) =>
      restHandler({ core_webservice_get_site_info: siteInfo([]), core_enrol_get_users_courses: [] })({
        ...req,
        body: valid
          ? req.body
          : new URLSearchParams(
              [...req.body].map(([k, v]): [string, string] => [k, k === 'wstoken' ? 'x' : v]),
            ),
      }),
    );
    const client = new MoodleClient({
      baseUrl: FAKE_BASE,
      tokens: new StaticTokenStore(FAKE_TOKEN),
      fetch: fake.fetch,
      minIntervalMs: 0,
      sleep: async () => {},
    });
    const service = new MoodleStatusService({ client, readMeta: async () => ({}) });
    expect((await service.getStatus()).state).toBe('ok');
    valid = false;
    await client.read('core_enrol_get_users_courses').catch(() => {});
    expect((await service.getStatus()).state).toBe('ungueltig');
  });
});
