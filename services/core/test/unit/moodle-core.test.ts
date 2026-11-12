import { describe, expect, it } from 'vitest';
import { MoodleStatusSchema } from '@sg/shared';
import { MoodleClient } from '../../src/moodle/client.ts';
import { canonicalJson, ConfirmationStore } from '../../src/moodle/confirmations.ts';
import { KeyedMutex } from '../../src/moodle/locks.ts';
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
    expect(store.consume(token, 'assign.submit', { accept_statement: true, assignment_id: 3 })).toBe('ok');
    expect(store.consume(token, 'assign.submit', params)).toBe('invalid');
  });

  it('andere Parameter oder Aktion verbrauchen den Code', () => {
    const store = new ConfirmationStore();
    const a = store.issue('assign.submit', { assignment_id: 3, accept_statement: true });
    expect(store.consume(a.token, 'assign.submit', { assignment_id: 4, accept_statement: true })).toBe(
      'invalid',
    );
    expect(store.consume(a.token, 'assign.submit', { assignment_id: 3, accept_statement: true })).toBe(
      'invalid',
    );
    const b = store.issue('forum.reply', { post_id: 1, message_html: 'x' });
    expect(store.consume(b.token, 'message.send', { post_id: 1, message_html: 'x' })).toBe('invalid');
    expect(store.consume('gibt-es-nicht-1234', 'forum.reply', {})).toBe('invalid');
  });

  it('Code verfällt nach 5 Minuten', () => {
    let now = 1_000_000;
    const store = new ConfirmationStore({ now: () => now });
    const { token, expiresAt } = store.issue('message.send', { to_user_id: 1, text: 'Hallo' });
    expect(expiresAt.getTime()).toBe(now + 5 * 60 * 1000);
    now += 5 * 60 * 1000;
    expect(store.consume(token, 'message.send', { to_user_id: 1, text: 'Hallo' })).toBe('invalid');
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

  it.each([0, -1, 1.5, 0.5, '4711', null])(
    'Härtung #93 (H4): userid %j ist keine Nutzer-ID → userId() wirft, Status bleibt ok',
    async (userid) => {
      const { service } = setup(FAKE_TOKEN, {
        core_webservice_get_site_info: { ...siteInfo([]), userid },
      });
      expect((await service.getStatus()).state).toBe('ok');
      await expect(service.userId()).rejects.toMatchObject({
        code: 'moodle_unreachable',
        details: { reason: 'no_site_info' },
      });
    },
  );

  it('Härtung #93 (H4): userid 1 ist gültig', async () => {
    const { service } = setup(FAKE_TOKEN, { core_webservice_get_site_info: { ...siteInfo([]), userid: 1 } });
    expect(await service.userId()).toBe(1);
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

describe('Bestätigungscodes: Bindung an den Stand (T1-24, 08 §9.3)', () => {
  const params = { assignment_id: 3, accept_statement: true };

  it('gleicher Stand → ok, anderer Stand → state_changed, Schlüsselreihenfolge egal', () => {
    const store = new ConfirmationStore();
    const a = store.issue('assign.submit', params, { state: { b: 1, a: [2, 1] } });
    expect(store.consume(a.token, 'assign.submit', params, { a: [2, 1], b: 1 })).toBe('ok');
    const b = store.issue('assign.submit', params, { state: { v: 1 } });
    expect(store.consume(b.token, 'assign.submit', params, { v: 2 })).toBe('state_changed');
    // Der Code ist danach verbraucht
    expect(store.consume(b.token, 'assign.submit', params, { v: 1 })).toBe('invalid');
  });

  it('andere Parameter haben Vorrang vor dem Stand: invalid, nicht state_changed', () => {
    const store = new ConfirmationStore();
    const a = store.issue('assign.submit', params, { state: { v: 1 } });
    expect(store.consume(a.token, 'assign.submit', { ...params, assignment_id: 4 }, { v: 2 })).toBe(
      'invalid',
    );
  });

  it('abgelaufen → invalid, auch wenn der Stand abweicht', () => {
    let now = 0;
    const store = new ConfirmationStore({ now: () => now });
    const a = store.issue('assign.submit', params, { state: { v: 1 } });
    now += 5 * 60 * 1000;
    expect(store.consume(a.token, 'assign.submit', params, { v: 2 })).toBe('invalid');
  });

  it('ohne Bindung wie bisher: kein Stand = null, ein Stand beim Einlösen ist dann eine Abweichung', () => {
    const store = new ConfirmationStore();
    const a = store.issue('assign.submit', params);
    expect(store.consume(a.token, 'assign.submit', params)).toBe('ok');
    const b = store.issue('assign.submit', params, { state: null });
    expect(store.consume(b.token, 'assign.submit', params, undefined)).toBe('ok');
    const c = store.issue('assign.submit', params);
    expect(store.consume(c.token, 'assign.submit', params, { v: 1 })).toBe('state_changed');
  });

  it('„kein Entwurf“ ({ submission_id: null }) ist ein anderer Stand als null', () => {
    const store = new ConfirmationStore();
    const a = store.issue('assign.submit', params, { state: { submission_id: null } });
    expect(store.consume(a.token, 'assign.submit', params, null)).toBe('state_changed');
  });

  it('revokeScope verwirft alle offenen Codes des Bereichs und zählt sie, andere Bereiche bleiben', () => {
    const store = new ConfirmationStore();
    const a1 = store.issue('assign.submit', params, { scope: 'assign:3' });
    const a2 = store.issue('assign.submit', params, { scope: 'assign:3' });
    const other = store.issue('assign.submit', params, { scope: 'assign:4' });
    const none = store.issue('assign.submit', params);
    expect(store.revokeScope('assign:3')).toBe(2);
    expect(store.consume(a1.token, 'assign.submit', params)).toBe('invalid');
    expect(store.consume(a2.token, 'assign.submit', params)).toBe('invalid');
    expect(store.consume(other.token, 'assign.submit', params)).toBe('ok');
    expect(store.consume(none.token, 'assign.submit', params)).toBe('ok');
    expect(store.revokeScope('assign:3')).toBe(0);
  });

  it('revokeScope zählt abgelaufene Codes nicht mit', () => {
    let now = 0;
    const store = new ConfirmationStore({ now: () => now });
    store.issue('assign.submit', params, { scope: 'assign:3' });
    now += 5 * 60 * 1000;
    expect(store.revokeScope('assign:3')).toBe(0);
  });

  it('epoch steigt mit jedem revokeScope, je Bereich', () => {
    const store = new ConfirmationStore();
    expect(store.epoch('assign:3')).toBe(0);
    store.revokeScope('assign:3');
    store.revokeScope('assign:3');
    expect(store.epoch('assign:3')).toBe(2);
    expect(store.epoch('assign:4')).toBe(0);
  });

  it('Zähler: Code, dessen Zähler vor einem revokeScope gelesen wurde, wird ausgegeben, gilt aber nie', () => {
    const store = new ConfirmationStore();
    const epoch = store.epoch('assign:3');
    store.revokeScope('assign:3');
    const late = store.issue('assign.submit', params, { scope: 'assign:3', epoch, state: { v: 1 } });
    expect(late.token).toEqual(expect.any(String));
    expect(late.expiresAt.getTime()).toBeGreaterThan(Date.now() - 1000);
    expect(store.size).toBe(0);
    expect(store.consume(late.token, 'assign.submit', params, { v: 1 })).toBe('invalid');
    // Mit frischem Zähler gilt der Code
    const fresh = store.issue('assign.submit', params, {
      scope: 'assign:3',
      epoch: store.epoch('assign:3'),
      state: { v: 1 },
    });
    expect(store.consume(fresh.token, 'assign.submit', params, { v: 1 })).toBe('ok');
  });
});

describe('Bestätigungscodes: Stand muss reines JSON sein (fail closed)', () => {
  const params = { assignment_id: 3, accept_statement: true };

  it('Date, Map, Set, NaN und Klassen im Stand: kein Code, sonst sähe die Bindung keine Änderung', () => {
    const store = new ConfirmationStore();
    for (const bad of [
      { t: new Date(0) },
      { files: new Map([['a', 1]]) },
      [new Set([1])],
      { size: Number.NaN },
      { size: Infinity },
      { n: 1n },
      new (class Stand {})(),
    ]) {
      expect(() => store.issue('assign.submit', params, { state: bad })).toThrow(/kein reines JSON/);
    }
    expect(store.size).toBe(0);
  });

  it('beim Einlösen wirft ein solcher Stand, ohne den Code zu verbrauchen', () => {
    const store = new ConfirmationStore();
    const a = store.issue('assign.submit', params, { state: { t: 0 } });
    expect(() => store.consume(a.token, 'assign.submit', params, { t: new Date(0) })).toThrow();
    expect(store.consume(a.token, 'assign.submit', params, { t: 0 })).toBe('ok');
  });

  it('reines JSON samt Objekten ohne Prototyp geht durch', () => {
    const store = new ConfirmationStore();
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { a: [1, 'x', null, true] });
    const a = store.issue('assign.submit', params, { state: bare });
    expect(store.consume(a.token, 'assign.submit', params, { a: [1, 'x', null, true] })).toBe('ok');
  });
});

describe('KeyedMutex (T1-24, Sperre je Aufgabe)', () => {
  it('gleicher Schlüssel: nacheinander in Reihenfolge, andere Schlüssel parallel', async () => {
    const mutex = new KeyedMutex({ timeoutMs: 60_000 });
    const order: string[] = [];
    const first = await mutex.acquire('assign:1');
    expect(first).not.toBeNull();
    const second = mutex.acquire('assign:1').then((release) => {
      order.push('zweite');
      return release;
    });
    const third = mutex.acquire('assign:1').then((release) => {
      order.push('dritte');
      return release;
    });
    // Anderer Schlüssel ist sofort frei
    const other = await mutex.acquire('assign:2');
    expect(other).not.toBeNull();
    other?.();
    expect(order).toEqual([]);
    first?.();
    (await second)?.();
    (await third)?.();
    expect(order).toEqual(['zweite', 'dritte']);
    expect(mutex.isLocked('assign:1')).toBe(false);
    expect(mutex.isLocked('assign:2')).toBe(false);
  });

  it('Zeitlimit: acquire liefert null, der Wartende ist aus der Schlange, die Sperre bleibt beim Halter', async () => {
    const mutex = new KeyedMutex({ timeoutMs: 20 });
    const holder = await mutex.acquire('assign:1');
    expect(await mutex.acquire('assign:1')).toBeNull();
    expect(mutex.isLocked('assign:1')).toBe(true);
    holder?.();
    expect(mutex.isLocked('assign:1')).toBe(false);
    // Ein abgebrochener Wartender blockiert die nächsten nicht
    const next = await mutex.acquire('assign:1');
    expect(next).not.toBeNull();
    next?.();
  });

  it('release ist einmalig: ein zweiter Aufruf gibt die Sperre des Nachfolgers nicht frei', async () => {
    const mutex = new KeyedMutex({ timeoutMs: 60_000 });
    const first = await mutex.acquire('k');
    const second = mutex.acquire('k');
    first?.();
    const held = await second;
    first?.();
    expect(mutex.isLocked('k')).toBe(true);
    held?.();
    expect(mutex.isLocked('k')).toBe(false);
  });
});
