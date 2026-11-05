// Auto-Stopp (T1-07): Regeln aus VERTRAEGE §9.4 mit festen Zeiten, ohne Uhr und ohne React
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_GAP_MS,
  SilenceTracker,
  VoiceDetector,
  evaluateAutoStop,
  hardBoundary,
  toAutoStopSession,
  type AutoStopSession,
  type AutoStopSettings,
} from '../src/lib/autostop/index.ts';
import { makeSession, makeSettings } from './fake-core.ts';

const MIN = 60_000;
const T0 = Date.parse('2026-11-05T08:00:00Z');
const settings: AutoStopSettings = makeSettings().lecture;

// Termin 08:00 bis 09:30, Start pünktlich
const END = T0 + 90 * MIN;
const lecture = (extra: Partial<AutoStopSession> = {}): AutoStopSession => ({
  startedAt: T0,
  plannedEndsAt: END,
  extendedUntil: null,
  paused: false,
  ...extra,
});
const spontan = (extra: Partial<AutoStopSession> = {}): AutoStopSession =>
  lecture({ plannedEndsAt: null, ...extra });
const run = (session: AutoStopSession, now: number, silentSince: number | null, s = settings) =>
  evaluateAutoStop({ session, settings: s, now, silentSince });

describe('hardBoundary (Formel des Core-Takts)', () => {
  it('mit Termin: Terminende + 30 min', () => {
    expect(hardBoundary(lecture(), settings)).toBe(END + 30 * MIN);
  });
  it('ohne Termin: nur die Maximaldauer', () => {
    expect(hardBoundary(spontan(), settings)).toBe(T0 + 240 * MIN);
  });
  it('die Maximaldauer begrenzt, wenn sie früher liegt', () => {
    expect(hardBoundary(lecture({ startedAt: T0 - 200 * MIN }), settings)).toBe(T0 + 40 * MIN);
  });
  it('auto_stop_extended_until gewinnt, wenn es später liegt, sonst nicht', () => {
    expect(hardBoundary(lecture({ extendedUntil: END + 45 * MIN }), settings)).toBe(END + 45 * MIN);
    expect(hardBoundary(lecture({ extendedUntil: END + 5 * MIN }), settings)).toBe(END + 30 * MIN);
  });
  it('stimmt mit der Rechnung je Regel überein (min(max(a,e), max(b,e)) = max(min(a,b), e))', () => {
    for (const e of [null, T0 + 10 * MIN, END + 31 * MIN, T0 + 300 * MIN]) {
      const session = lecture({ startedAt: T0 - 150 * MIN, extendedUntil: e });
      const a = Math.max(END + 30 * MIN, e ?? 0);
      const b = Math.max(session.startedAt + 240 * MIN, e ?? 0);
      expect(hardBoundary(session, settings)).toBe(Math.min(a, b));
    }
  });
});

describe('toAutoStopSession', () => {
  it('nur laeuft und pausiert sind aktiv', () => {
    expect(toAutoStopSession(makeSession({ state: 'laeuft' }))?.paused).toBe(false);
    expect(toAutoStopSession(makeSession({ state: 'pausiert' }))?.paused).toBe(true);
    for (const state of ['geplant', 'bereit', 'beendet', 'verpasst', 'verarbeitet'] as const) {
      expect(toAutoStopSession(makeSession({ state }))).toBeNull();
    }
  });
  it('liest Termin und Verlängerung', () => {
    const s = toAutoStopSession(
      makeSession({
        started_at: '2026-11-05T08:00:00Z',
        planned_ends_at: '2026-11-05T09:30:00Z',
        auto_stop_extended_until: '2026-11-05T10:00:00Z',
      }),
    );
    expect(s).toEqual({ startedAt: T0, plannedEndsAt: END, extendedUntil: END + 30 * MIN, paused: false });
  });
});

describe('Regel 1: Terminende + 10 min und 3 min ohne Sprache', () => {
  it('stoppt mit kalenderende, sobald beides zutrifft', () => {
    const now = END + 10 * MIN;
    expect(run(lecture(), now, now - 3 * MIN)).toEqual({
      state: 'stoppen',
      rule: 1,
      stopReason: 'kalenderende',
    });
  });
  it('vor Terminende + 10 min nicht, auch bei langer Stille (Hinweis erst 60 s davor)', () => {
    const silent = END - 2 * MIN; // 12 min Stille um Terminende + 10, Regel 3 (15 min) greift noch nicht
    expect(run(lecture(), END + 10 * MIN - 61_000, silent).state).toBe('ok');
    expect(run(lecture(), END + 10 * MIN - 60_000, silent)).toMatchObject({
      state: 'hinweis',
      rule: 1,
      remainingMs: 60_000,
    });
    expect(run(lecture(), END + 10 * MIN - 1, silent)).toMatchObject({ state: 'hinweis', remainingMs: 1 });
    expect(run(lecture(), END + 10 * MIN, silent).state).toBe('stoppen');
  });
  it('nach Terminende + 10 min wartet sie auf 3 min Stille am Stück', () => {
    const now = END + 11 * MIN;
    // letzte Sprache vor 1 min -> Stopp in 2 min
    expect(run(lecture(), now, now - MIN).state).toBe('ok');
    expect(run(lecture(), now + MIN + 1000, now - MIN)).toMatchObject({ state: 'hinweis', rule: 1 });
    expect(run(lecture(), now + 2 * MIN, now - MIN).state).toBe('stoppen');
  });
  it('Sprache während des Hinweises nimmt ihn zurück', () => {
    const now = END + 12 * MIN + 30_000;
    expect(run(lecture(), now, now - 2.5 * MIN)).toMatchObject({ state: 'hinweis', rule: 1 });
    expect(run(lecture(), now, now).state).toBe('ok');
  });
  it('gilt nur mit Termin', () => {
    const now = T0 + 100 * MIN;
    expect(run(spontan(), now, now - 5 * MIN).state).toBe('ok');
  });
});

describe('Regel 2: Terminende + 30 min, unabhängig von Sprache', () => {
  it('stoppt trotz laufender Sprache', () => {
    const now = END + 30 * MIN;
    expect(run(lecture(), now, now)).toEqual({ state: 'stoppen', rule: 2, stopReason: 'kalenderende' });
  });
  it('Hinweis 60 s vorher, davor nichts', () => {
    expect(run(lecture(), END + 30 * MIN - 61_000, END + 30 * MIN - 61_000).state).toBe('ok');
    expect(run(lecture(), END + 29 * MIN, END + 29 * MIN)).toMatchObject({
      state: 'hinweis',
      rule: 2,
      remainingMs: 60_000,
    });
  });
  it('greift auch ohne Pegelwerte und während der Pause', () => {
    expect(run(lecture(), END + 30 * MIN, null).state).toBe('stoppen');
    expect(run(lecture({ paused: true }), END + 30 * MIN, END + 29 * MIN).state).toBe('stoppen');
  });
});

describe('Regel 3: Stille ab 15 min', () => {
  it('stoppt mit stille, mit und ohne Termin', () => {
    const now = T0 + 40 * MIN;
    expect(run(lecture(), now, now - 15 * MIN)).toEqual({ state: 'stoppen', rule: 3, stopReason: 'stille' });
    expect(run(spontan(), now, now - 15 * MIN)).toEqual({ state: 'stoppen', rule: 3, stopReason: 'stille' });
  });
  it('14:59 Stille reichen nicht, ab 14:00 gibt es den Hinweis', () => {
    const now = T0 + 40 * MIN;
    expect(run(spontan(), now, now - 15 * MIN + 1).state).toBe('hinweis');
    expect(run(spontan(), now, now - 14 * MIN)).toMatchObject({
      state: 'hinweis',
      rule: 3,
      remainingMs: 60_000,
    });
    expect(run(spontan(), now, now - 13 * MIN).state).toBe('ok');
  });
  it('zählt nicht in der Pause', () => {
    const now = T0 + 40 * MIN;
    expect(run(spontan({ paused: true }), now, now - 20 * MIN).state).toBe('ok');
  });
});

describe('Regel 4: Maximaldauer 240 min', () => {
  it('stoppt mit maximaldauer, auch bei laufender Sprache', () => {
    const now = T0 + 240 * MIN;
    expect(run(spontan(), now, now)).toEqual({ state: 'stoppen', rule: 4, stopReason: 'maximaldauer' });
  });
  it('Hinweis 60 s vorher', () => {
    expect(run(spontan(), T0 + 239 * MIN, T0 + 239 * MIN)).toMatchObject({
      state: 'hinweis',
      rule: 4,
      remainingMs: 60_000,
    });
    expect(run(spontan(), T0 + 239 * MIN - 1, T0 + 239 * MIN - 1).state).toBe('ok');
  });
  it('bei Termin gilt, was zuerst eintritt (Maximaldauer vor Terminende + 30)', () => {
    const session = lecture({ startedAt: T0 - 200 * MIN });
    const at = T0 + 40 * MIN;
    expect(run(session, at, at)).toEqual({ state: 'stoppen', rule: 4, stopReason: 'maximaldauer' });
  });
  it('bei Gleichstand gewinnt das Kalenderende (wie im Core)', () => {
    const session = lecture({ startedAt: END + 30 * MIN - 240 * MIN });
    expect(run(session, END + 30 * MIN, null)).toMatchObject({ state: 'stoppen', rule: 2 });
  });
});

describe('fehlende Pegelwerte sind keine Stille', () => {
  it('ohne Pegel greifen weder Regel 1 noch 3', () => {
    expect(run(lecture(), END + 25 * MIN, null).state).toBe('ok');
    expect(run(spontan(), T0 + 200 * MIN, null).state).toBe('ok');
  });
});

describe('extend (auto_stop_extended_until)', () => {
  it('vor dem Zeitpunkt stoppt keine Regel, auch nicht bei langer Stille', () => {
    const session = lecture({ extendedUntil: END + 45 * MIN });
    const now = END + 40 * MIN;
    expect(run(session, now, now - 60 * MIN).state).toBe('ok');
    expect(run(session, END + 31 * MIN, END).state).toBe('ok');
  });
  it('schiebt Hinweis und Stopp auf den neuen Zeitpunkt', () => {
    const session = lecture({ extendedUntil: END + 45 * MIN });
    expect(run(session, END + 45 * MIN - 30_000, null)).toMatchObject({
      state: 'hinweis',
      remainingMs: 30_000,
    });
    expect(run(session, END + 45 * MIN, null).state).toBe('stoppen');
  });
  it('danach gelten die Regeln normal weiter', () => {
    const session = lecture({ extendedUntil: END + 35 * MIN });
    expect(run(session, END + 36 * MIN, END + 35 * MIN).state).toBe('stoppen');
  });
  it('ein Wert vor der Grenze ändert nichts', () => {
    const session = lecture({ extendedUntil: END + 5 * MIN });
    expect(run(session, END + 30 * MIN, null).state).toBe('stoppen');
  });
  it('verschiebt auch die Maximaldauer (Spontan)', () => {
    const session = spontan({ extendedUntil: T0 + 255 * MIN });
    expect(run(session, T0 + 250 * MIN, T0 + 250 * MIN).state).toBe('ok');
    expect(run(session, T0 + 255 * MIN, T0 + 255 * MIN)).toMatchObject({ state: 'stoppen', rule: 4 });
  });
});

describe('Einstellungen', () => {
  it('warning_s = 0 schaltet den Hinweis ab, der Stopp bleibt', () => {
    const s = { ...settings, auto_stop_warning_s: 0 };
    expect(run(spontan(), T0 + 239 * MIN + 30_000, T0 + 239 * MIN + 30_000, s).state).toBe('ok');
    expect(run(spontan(), T0 + 240 * MIN, T0 + 240 * MIN, s).state).toBe('stoppen');
  });
  it('alle Grenzen kommen aus lecture.auto_stop_*', () => {
    const s = {
      ...settings,
      auto_stop_silence_min: 5,
      auto_stop_max_duration_min: 60,
      auto_stop_warning_s: 10,
    };
    const now = T0 + 20 * MIN;
    expect(run(spontan(), now, now - 5 * MIN, s).state).toBe('stoppen');
    expect(run(spontan(), T0 + 60 * MIN - 10_000, T0 + 60 * MIN - 10_000, s)).toMatchObject({
      state: 'hinweis',
      rule: 4,
    });
  });
});

describe('VoiceDetector', () => {
  it('Schwelle mit Hysterese: ein Wert dazwischen hält den Zustand', () => {
    const v = new VoiceDetector({ onThreshold: 0.01, offThreshold: 0.006, release: 0 });
    expect(v.push(0.005)).toBe(false);
    expect(v.push(0.008)).toBe(false); // zwischen den Schwellen, noch keine Sprache
    expect(v.push(0.02)).toBe(true);
    expect(v.push(0.008)).toBe(true); // zwischen den Schwellen, bleibt Sprache
    expect(v.push(0.005)).toBe(false);
  });
  it('Glättung: Wortpausen bis etwa 1 s zählen noch als Sprache', () => {
    const v = new VoiceDetector();
    expect(v.push(0.05)).toBe(true);
    for (let i = 0; i < 4; i++) expect(v.push(0)).toBe(true); // 1 s Pause
    for (let i = 0; i < 20; i++) v.push(0); // lange Pause
    expect(v.push(0)).toBe(false);
  });
  it('ungültige Werte zählen als Stille', () => {
    const v = new VoiceDetector();
    expect(v.push(Number.NaN)).toBe(false);
    expect(v.push(-1)).toBe(false);
  });
  it('Schwellen sind konfigurierbar, falsche Reihenfolge wird abgewiesen', () => {
    expect(new VoiceDetector({ onThreshold: 0.05, offThreshold: 0.03 }).push(0.04)).toBe(false);
    expect(() => new VoiceDetector({ onThreshold: 0.01, offThreshold: 0.02 })).toThrow(RangeError);
  });
});

describe('SilenceTracker', () => {
  const feed = (t: SilenceTracker, from: number, to: number, rms: number, step = 250) => {
    for (let at = from; at <= to; at += step) t.push({ at, rms });
  };

  it('vor dem ersten Messwert ist die Stille unbekannt', () => {
    expect(new SilenceTracker().silentSince(T0)).toBeNull();
  });
  it('Stille beginnt beim ersten stillen Messwert und wächst mit der Uhr', () => {
    const t = new SilenceTracker();
    feed(t, T0, T0 + 60_000, 0.001);
    expect(t.silentSince(T0 + 60_000)).toBe(T0);
  });
  it('Sprache setzt den Beginn der Stille zurück', () => {
    const t = new SilenceTracker();
    feed(t, T0, T0 + 10_000, 0.001);
    feed(t, T0 + 10_250, T0 + 11_000, 0.08);
    feed(t, T0 + 11_250, T0 + 30_000, 0.001);
    const since = t.silentSince(T0 + 30_000);
    expect(since).not.toBeNull();
    expect(since!).toBeGreaterThanOrEqual(T0 + 11_000);
    // die Hüllkurve klingt erst nach einigen Sekunden unter die Schwelle ab
    expect(since!).toBeLessThan(T0 + 20_000);
  });
  it('ohne frische Messwerte (AudioContext suspended) wird die Stille unbekannt statt länger', () => {
    const t = new SilenceTracker();
    feed(t, T0, T0 + 60_000, 0.001);
    expect(t.silentSince(T0 + 60_000 + DEFAULT_MAX_GAP_MS)).toBe(T0);
    expect(t.silentSince(T0 + 60_000 + DEFAULT_MAX_GAP_MS + 1)).toBeNull();
    expect(t.silentSince(T0 + 20 * MIN)).toBeNull();
  });
  it('nach einer Lücke zählt die Stille neu, nicht über die Lücke hinweg', () => {
    const t = new SilenceTracker();
    feed(t, T0, T0 + 60_000, 0.001);
    feed(t, T0 + 10 * MIN, T0 + 10 * MIN + 5000, 0.001); // Werte kommen wieder
    expect(t.silentSince(T0 + 10 * MIN + 5000)).toBe(T0 + 10 * MIN);
  });
  it('reset vergisst alles', () => {
    const t = new SilenceTracker();
    feed(t, T0, T0 + 5000, 0.001);
    t.reset();
    expect(t.silentSince(T0 + 5000)).toBeNull();
  });
  it('ein Zeitsprung rückwärts beginnt neu', () => {
    const t = new SilenceTracker();
    feed(t, T0, T0 + 5000, 0.001);
    t.push({ at: T0 - 100_000, rms: 0.001 });
    expect(t.silentSince(T0 - 100_000)).toBe(T0 - 100_000);
  });
});
