// Auto-Stopp (T1-07): Controller mit Fake-Uhr, Fake-Pegel, Fake-Ereignissen und Stub-API
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@sg/shared';
import { ApiRequestError } from '../src/lib/api.ts';
import { AutoStopController, type AutoStopApi } from '../src/lib/autostop/index.ts';
import type { AudioLevelListener as AudioLevelListenerLike } from '../src/lib/recorder/level.ts';
import { installFakeCore, makeSession, makeSettings } from './fake-core.ts';

const MIN = 60_000;
const T0 = Date.parse('2026-11-05T08:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const lecture = makeSettings().lecture;

/** Pegel-Quelle: der Test ruft die angemeldeten Hörer selbst auf */
function levelSource() {
  const listeners = new Set<AudioLevelListenerLike>();
  return {
    subscribeLevel: (fn: AudioLevelListenerLike) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    emit: (rms: number) => listeners.forEach((fn) => fn({ at: Date.now(), rms })),
    count: () => listeners.size,
  };
}

function eventSource() {
  const handlers = new Set<(s: Session) => void>();
  return {
    source: {
      onEvent: (_name: 'session.updated', fn: (s: Session) => void) => {
        handlers.add(fn);
        return () => void handlers.delete(fn);
      },
    },
    emit: (s: Session) => handlers.forEach((fn) => fn(s)),
    count: () => handlers.size,
  };
}

/** Spult die Uhr in Sekundenschritten vor und liefert dabei Pegel (null = keine Messwerte, z. B. suspended) */
async function advance(ms: number, level: ReturnType<typeof levelSource>, rms: number | null, stepMs = 1000) {
  for (let done = 0; done < ms; done += stepMs) {
    await vi.advanceTimersByTimeAsync(Math.min(stepMs, ms - done));
    if (rms !== null) level.emit(rms);
  }
}

function setup(sessionOverrides: Partial<Session> = {}) {
  const level = levelSource();
  const events = eventSource();
  const api = {
    stop: vi.fn<AutoStopApi['stop']>(async (id, reason) => ended(id, reason)),
    extend: vi.fn<AutoStopApi['extend']>(async () => extended(15)),
  };
  let current = makeSession({
    state: 'laeuft',
    started_at: iso(T0),
    updated_at: iso(T0),
    ...sessionOverrides,
  });
  function ended(id: string, reason?: string): Session {
    current = {
      ...current,
      id,
      state: 'beendet',
      ended_at: iso(Date.now()),
      stop_reason: (reason ?? 'manuell') as Session['stop_reason'],
      updated_at: iso(Date.now()),
    };
    return current;
  }
  function extended(minutes: number): Session {
    const base = Math.max(Date.now(), Date.parse(current.auto_stop_extended_until ?? '') || 0);
    current = {
      ...current,
      auto_stop_extended_until: iso(base + minutes * MIN),
      updated_at: iso(Date.now()),
    };
    return current;
  }
  const controller = new AutoStopController({
    subscribeLevel: level.subscribeLevel,
    events: events.source,
    api,
  });
  controller.setSettings(lecture);
  controller.setSession(current);
  return { controller, level, events, api, session: () => current };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Auto-Stopp-Controller', () => {
  it('Regel 3: 15 min Stille, vorher Hinweis, dann genau ein Stopp mit stille', async () => {
    const { controller, level, api } = setup();
    await advance(14 * MIN - 5000, level, 0.001);
    expect(controller.getSnapshot().status.state).toBe('ok');
    await advance(10_000, level, 0.001); // 14:05 bis 14:15 Stille
    expect(controller.getSnapshot().status).toMatchObject({ state: 'hinweis', rule: 3 });
    expect(api.stop).not.toHaveBeenCalled();
    await advance(MIN, level, 0.001);
    expect(api.stop).toHaveBeenCalledTimes(1);
    expect(api.stop).toHaveBeenCalledWith(expect.any(String), 'stille');
  });

  it('Sprache nimmt den Hinweis zurück und schiebt den Stopp', async () => {
    const { controller, level, api } = setup();
    await advance(14.5 * MIN, level, 0.001);
    expect(controller.getSnapshot().status.state).toBe('hinweis');
    await advance(2000, level, 0.1);
    expect(controller.getSnapshot().status.state).toBe('ok');
    await advance(10 * MIN, level, 0.001);
    expect(api.stop).not.toHaveBeenCalled();
  });

  it('keine Pegelwerte (AudioContext suspended): kein Stopp wegen Stille, die harte Grenze bleibt', async () => {
    const { controller, level, api } = setup({ planned_ends_at: iso(T0 + 90 * MIN) });
    await advance(40 * MIN, level, null);
    expect(controller.getSnapshot().status.state).toBe('ok');
    // nach Terminende + 10 min ohne Messwerte: Regel 1 darf nicht greifen
    await advance(70 * MIN, level, null, 10_000);
    expect(api.stop).not.toHaveBeenCalled();
    // Terminende + 30 min greift unabhängig davon (Regel 2)
    await advance(20 * MIN + 5000, level, null, 10_000);
    expect(api.stop).toHaveBeenCalledTimes(1);
    expect(api.stop).toHaveBeenCalledWith(expect.any(String), 'kalenderende');
  });

  it('Pegel setzen nach einer Lücke wieder ein: Stille zählt erst ab dann', async () => {
    const { level, api } = setup();
    await advance(10 * MIN, level, 0.001);
    await advance(10 * MIN, level, null); // suspended
    await advance(10 * MIN, level, 0.001); // erst 10 min lückenlose Stille
    expect(api.stop).not.toHaveBeenCalled();
    await advance(5 * MIN + 5000, level, 0.001);
    expect(api.stop).toHaveBeenCalledTimes(1);
  });

  it('Regel 1: nach Terminende + 10 min und 3 min Stille, Grund kalenderende', async () => {
    const end = T0 + 30 * MIN;
    const { level, api } = setup({ planned_ends_at: iso(end) });
    await advance(30 * MIN, level, 0.1); // Sprache bis zum Terminende
    await advance(13 * MIN + 5000, level, 0.001);
    expect(api.stop).toHaveBeenCalledTimes(1);
    expect(api.stop).toHaveBeenCalledWith(expect.any(String), 'kalenderende');
  });

  it('Regel 4: Maximaldauer, Grund maximaldauer', async () => {
    const { level, api } = setup({ started_at: iso(T0 - 239 * MIN) });
    await advance(MIN + 2000, level, 0.1);
    expect(api.stop).toHaveBeenCalledTimes(1);
    expect(api.stop).toHaveBeenCalledWith(expect.any(String), 'maximaldauer');
  });

  it('extend: ruft die API mit auto_stop_extend_min auf, schiebt die Grenze und der Hinweis verschwindet', async () => {
    const { controller, level, api } = setup({ started_at: iso(T0 - 240 * MIN + 30_000) });
    await advance(5000, level, 0.1);
    expect(controller.getSnapshot().status).toMatchObject({ state: 'hinweis', rule: 4 });
    await controller.extend();
    expect(api.extend).toHaveBeenCalledWith(expect.any(String));
    expect(controller.getSnapshot().status.state).toBe('ok');
    expect(controller.getSnapshot().extending).toBe(false);
    await advance(14 * MIN, level, 0.1);
    expect(api.stop).not.toHaveBeenCalled();
    await advance(MIN + 5000, level, 0.1);
    expect(api.stop).toHaveBeenCalledTimes(1);
  });

  it('extend schiebt auch die Stille-Regel (kein Stopp vor auto_stop_extended_until)', async () => {
    const { controller, level, api } = setup();
    await advance(14.5 * MIN, level, 0.001);
    await controller.extend();
    expect(controller.getSnapshot().status.state).toBe('ok');
    await advance(10 * MIN, level, 0.001);
    expect(api.stop).not.toHaveBeenCalled();
    await advance(10 * MIN, level, 0.001);
    expect(api.stop).toHaveBeenCalledTimes(1);
  });

  it('extend läuft noch: der Controller stoppt in der Zwischenzeit nicht', async () => {
    const { controller, level, api, session } = setup({ started_at: iso(T0 - 240 * MIN + 10_000) });
    let release!: (s: Session) => void;
    api.extend.mockImplementationOnce(() => new Promise<Session>((resolve) => (release = resolve)));
    const pending = controller.extend();
    expect(controller.getSnapshot().extending).toBe(true);
    await advance(30_000, level, 0.1); // die Grenze ist längst überschritten
    expect(api.stop).not.toHaveBeenCalled();
    release({
      ...session(),
      auto_stop_extended_until: iso(Date.now() + 15 * MIN),
      updated_at: iso(Date.now()),
    });
    await pending;
    await advance(5000, level, 0.1);
    expect(api.stop).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status.state).toBe('ok');
  });

  it('extend scheitert: Meldung, kein Absturz; nach der Schonfrist kommt der Stopp', async () => {
    const { controller, level, api } = setup({ started_at: iso(T0 - 240 * MIN + 30_000) });
    api.extend.mockRejectedValue(
      new ApiRequestError({ kind: 'unreachable', message: 'x', userMessage: 'Core nicht erreichbar' }),
    );
    await controller.extend();
    expect(controller.getSnapshot().extendError).toBe('Core nicht erreichbar');
    await advance(40_000, level, 0.1);
    expect(api.stop).not.toHaveBeenCalled(); // Schonfrist
    await advance(2 * MIN, level, 0.1);
    expect(api.stop).toHaveBeenCalledTimes(1);
  });

  it('kein Doppel-Stopp: weder durch weitere Takte noch durch session.updated, noch bei langsamer Antwort', async () => {
    const { controller, level, api, events, session } = setup({ started_at: iso(T0 - 240 * MIN + 1000) });
    let release!: (s: Session) => void;
    api.stop.mockImplementationOnce(() => new Promise<Session>((resolve) => (release = resolve)));
    await advance(3000, level, 0.1);
    expect(api.stop).toHaveBeenCalledTimes(1);
    await advance(30_000, level, 0.1); // Antwort steht noch aus
    events.emit(session()); // Ereignis ohne neuen Stand
    expect(api.stop).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().stopping).toBe(true);
    release({ ...session(), state: 'beendet', stop_reason: 'maximaldauer', updated_at: iso(Date.now()) });
    await advance(30_000, level, 0.1);
    expect(api.stop).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().status.state).toBe('inaktiv');
  });

  it('Stopp scheitert am Netz: neuer Versuch erst nach der Wartezeit, dann wieder höchstens einer zugleich', async () => {
    const { level, api } = setup({ started_at: iso(T0 - 240 * MIN + 1000) });
    api.stop.mockRejectedValueOnce(
      new ApiRequestError({ kind: 'unreachable', message: 'x', userMessage: 'Core nicht erreichbar' }),
    );
    await advance(3000, level, 0.1);
    expect(api.stop).toHaveBeenCalledTimes(1);
    await advance(5000, level, 0.1);
    expect(api.stop).toHaveBeenCalledTimes(1);
    await advance(10_000, level, 0.1);
    expect(api.stop).toHaveBeenCalledTimes(2);
    await advance(60_000, level, 0.1);
    expect(api.stop).toHaveBeenCalledTimes(2);
  });

  it('409 oder 404 beim Stopp: nicht wiederholen (die Session ist schon weg)', async () => {
    const { level, api } = setup({ started_at: iso(T0 - 240 * MIN + 1000) });
    api.stop.mockRejectedValueOnce(
      new ApiRequestError({
        kind: 'api',
        status: 409,
        code: 'session_transition_invalid',
        message: 'x',
        userMessage: 'x',
      }),
    );
    await advance(3000, level, 0.1);
    await advance(60_000, level, 0.1);
    expect(api.stop).toHaveBeenCalledTimes(1);
  });

  it('Session wird extern beendet: Controller räumt auf und stoppt nie mehr', async () => {
    const { controller, level, api, events, session } = setup({ started_at: iso(T0 - 240 * MIN + 30_000) });
    await advance(5000, level, 0.1);
    expect(controller.getSnapshot().status.state).toBe('hinweis');
    events.emit({ ...session(), state: 'beendet', stop_reason: 'manuell', updated_at: iso(Date.now()) });
    expect(controller.getSnapshot().status.state).toBe('inaktiv');
    expect(vi.getTimerCount()).toBe(0);
    await advance(5 * MIN, level, 0.1);
    expect(api.stop).not.toHaveBeenCalled();
  });

  it('dispose meldet Pegel und Ereignisse ab und stoppt den Takt', () => {
    const { controller, level, events } = setup();
    expect(level.count()).toBe(1);
    expect(events.count()).toBe(1);
    controller.dispose();
    expect(level.count()).toBe(0);
    expect(events.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Ereignisse anderer Sessions und ältere Stände werden ignoriert', async () => {
    const { controller, events, session, level } = setup({ started_at: iso(T0 - 240 * MIN + 30_000) });
    await advance(1000, level, 0.1);
    await controller.extend();
    const withExtension = session();
    // älterer Stand ohne Verlängerung trifft verspätet ein
    events.emit({ ...withExtension, auto_stop_extended_until: null, updated_at: iso(T0) });
    expect(controller.getSnapshot().status.state).toBe('ok');
    // andere Session
    events.emit({ ...withExtension, id: '0190f6a2-0000-7000-8000-0000000000ff', state: 'beendet' });
    expect(controller.getSnapshot().status.state).toBe('ok');
  });

  it('session.updated von einem anderen Gerät (extend) verlängert auch hier', async () => {
    const { controller, level, events, session, api } = setup({ started_at: iso(T0 - 240 * MIN + 30_000) });
    await advance(5000, level, 0.1);
    expect(controller.getSnapshot().status.state).toBe('hinweis');
    events.emit({
      ...session(),
      auto_stop_extended_until: iso(Date.now() + 15 * MIN),
      updated_at: iso(Date.now()),
    });
    expect(controller.getSnapshot().status.state).toBe('ok');
    await advance(10 * MIN, level, 0.1);
    expect(api.stop).not.toHaveBeenCalled();
  });

  it('Pause: Stille zählt nicht, nach dem Fortsetzen beginnt sie neu; die Maximaldauer gilt weiter', async () => {
    const { level, api, events, session } = setup();
    await advance(10 * MIN, level, 0.001);
    events.emit({ ...session(), state: 'pausiert', updated_at: iso(Date.now()) });
    await advance(30 * MIN, level, 0.001);
    expect(api.stop).not.toHaveBeenCalled();
    events.emit({ ...session(), state: 'laeuft', updated_at: iso(Date.now() + 1) });
    await advance(14 * MIN, level, 0.001);
    expect(api.stop).not.toHaveBeenCalled();
    await advance(MIN + 5000, level, 0.001);
    expect(api.stop).toHaveBeenCalledTimes(1);
  });

  it('ohne Einstellungen oder ohne Session passiert nichts', async () => {
    const level = levelSource();
    const api = { stop: vi.fn(), extend: vi.fn() };
    const c = new AutoStopController({ subscribeLevel: level.subscribeLevel, api });
    c.setSession(makeSession({ started_at: iso(T0 - 300 * MIN), updated_at: iso(T0) }));
    await advance(10_000, level, 0.001);
    expect(api.stop).not.toHaveBeenCalled();
    expect(c.getSnapshot().status.state).toBe('inaktiv');
    expect(vi.getTimerCount()).toBe(0);
    await c.extend();
    expect(api.extend).not.toHaveBeenCalled();
  });

  it('eine andere Session startet frisch (kein Stopp-Merker der alten)', async () => {
    const { controller, level, api, session } = setup({ started_at: iso(T0 - 240 * MIN + 1000) });
    await advance(3000, level, 0.1);
    expect(api.stop).toHaveBeenCalledTimes(1);
    controller.setSession(
      makeSession({
        id: '0190f6a2-0000-7000-8000-0000000000e2',
        started_at: iso(Date.now()),
        updated_at: iso(Date.now()),
      }),
    );
    expect(controller.getSnapshot().status.state).toBe('ok');
    expect(session().state).toBe('beendet');
  });
});

describe('Nacharbeit aus dem Review', () => {
  const netz = () =>
    new ApiRequestError({ kind: 'unreachable', message: 'x', userMessage: 'Core nicht erreichbar' });

  it('gescheitertes extend: Schonfrist ohne Stopp, Hinweis bleibt, einmal automatisch wiederholt', async () => {
    const { controller, level, api } = setup({ started_at: iso(T0 - 240 * MIN + 10_000) });
    api.extend.mockRejectedValueOnce(netz()).mockRejectedValueOnce(netz());
    await advance(5000, level, 0.1);
    await controller.extend(); // scheitert, die Grenze liegt in 5 s
    await advance(30_000, level, 0.1); // Grenze überschritten
    expect(api.stop).not.toHaveBeenCalled();
    expect(api.extend).toHaveBeenCalledTimes(2); // genau ein automatischer Versuch
    expect(controller.getSnapshot().status.state).toBe('hinweis');
    expect(controller.getSnapshot().extendError).toBe('Core nicht erreichbar');
    await advance(60_000, level, 0.1);
    expect(api.stop).not.toHaveBeenCalled();
    // Schonfrist (2 min) ist um: jetzt wird gestoppt
    await advance(60_000, level, 0.1);
    expect(api.stop).toHaveBeenCalledTimes(1);
    expect(api.extend).toHaveBeenCalledTimes(2);
  });

  it('der automatische zweite Versuch gelingt: kein Stopp, Hinweis weg', async () => {
    const { controller, level, api } = setup({ started_at: iso(T0 - 240 * MIN + 10_000) });
    api.extend.mockRejectedValueOnce(netz());
    await advance(5000, level, 0.1);
    await controller.extend();
    await advance(10_000, level, 0.1);
    expect(api.extend).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().status.state).toBe('ok');
    expect(controller.getSnapshot().extendError).toBeNull();
    await advance(5 * MIN, level, 0.1);
    expect(api.stop).not.toHaveBeenCalled();
  });

  it('Stopp scheitert nach dispose: kein neuer Timer', async () => {
    const { controller, level, api } = setup({ started_at: iso(T0 - 240 * MIN + 1000) });
    let fail!: (e: unknown) => void;
    api.stop.mockImplementationOnce(() => new Promise<Session>((_, reject) => (fail = reject)));
    await advance(3000, level, 0.1);
    expect(api.stop).toHaveBeenCalledTimes(1);
    controller.dispose();
    fail(netz());
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('andere 4xx beim Stopp sind endgültig: Meldung, kein Retry', async () => {
    const { controller, level, api } = setup({ started_at: iso(T0 - 240 * MIN + 1000) });
    api.stop.mockRejectedValueOnce(
      new ApiRequestError({
        kind: 'api',
        status: 403,
        code: 'x',
        message: 'x',
        userMessage: 'Nicht erlaubt',
      }),
    );
    await advance(3000, level, 0.1);
    await advance(2 * MIN, level, 0.1);
    expect(api.stop).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().stopError).toBe('Nicht erlaubt');
  });

  it('leise Sprache gilt nicht als Stille, digitale Stille (stummes Mikrofon) auch nicht', async () => {
    const quiet = setup();
    await advance(20 * MIN, quiet.level, 0.004);
    expect(quiet.api.stop).not.toHaveBeenCalled();
    quiet.controller.dispose();
    const muted = setup();
    await advance(20 * MIN, muted.level, 0);
    expect(muted.api.stop).not.toHaveBeenCalled();
    expect(muted.controller.getSnapshot().status.state).toBe('ok');
  });

  it('setEvents ersetzt die Quelle: Ereignisse der alten kommen nicht mehr an', () => {
    const { controller, events, session } = setup();
    const second = eventSource();
    controller.setEvents(second.source);
    expect(events.count()).toBe(0);
    expect(second.count()).toBe(1);
    second.emit({ ...session(), state: 'beendet', updated_at: iso(Date.now() + 1) });
    expect(controller.getSnapshot().status.state).toBe('inaktiv');
  });
});

describe('Auto-Stopp gegen den Fake-Core (REST nach VERTRAEGE §7.2)', () => {
  it('stop sendet POST /sessions/{id}/stop mit dem Grund, extend POST …/extend ohne minutes (der Core nimmt seinen Wert)', async () => {
    const core = installFakeCore({ sessions: [makeSession({ started_at: iso(T0 - 240 * MIN + 30_000) })] });
    const level = levelSource();
    const events = eventSource();
    const controller = new AutoStopController({
      subscribeLevel: level.subscribeLevel,
      events: events.source,
    });
    controller.setSettings(core.settings.lecture);
    controller.setSession(core.sessions[0]!);
    await advance(5000, level, 0.1);
    await controller.extend();
    const extend = core.requests.find((r) => r.path.endsWith('/extend'));
    expect(extend).toMatchObject({ method: 'POST', body: {} });
    expect(controller.getSnapshot().status.state).toBe('ok');

    await advance(15 * MIN + 5000, level, 0.1);
    const stops = core.requests.filter((r) => r.path.endsWith('/stop'));
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ method: 'POST', body: { reason: 'maximaldauer' } });
    expect(stops[0]!.headers['Idempotency-Key']).toBeTruthy();
    expect(core.sessions[0]).toMatchObject({ state: 'beendet', stop_reason: 'maximaldauer' });
    expect(controller.getSnapshot().status.state).toBe('inaktiv');
  });
});
