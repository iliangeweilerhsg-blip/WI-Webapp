import { describe, expect, it } from 'vitest';
import { autoStopDecision, isoTs, plannedState } from '../../src/services/sessions.ts';

const T = (min: number): Date => new Date(Date.UTC(2026, 10, 4, 9, 0) + min * 60_000);
const limits = { hardAfterEndMin: 30, maxDurationMin: 240 };

describe('isoTs', () => {
  it('ISO 8601 UTC mit Z, Millisekunden nur, wenn sie nicht 0 sind', () => {
    expect(isoTs(new Date('2026-11-04T09:00:00.000Z'))).toBe('2026-11-04T09:00:00Z');
    expect(isoTs(new Date('2026-11-04T09:00:00.120Z'))).toBe('2026-11-04T09:00:00.120Z');
  });
});

describe('plannedState', () => {
  it('geplant → bereit 15 min vor dem Beginn → verpasst ab dem Ende', () => {
    expect(plannedState(T(44.99), T(60), T(150))).toBe('geplant');
    expect(plannedState(T(45), T(60), T(150))).toBe('bereit');
    expect(plannedState(T(149.99), T(60), T(150))).toBe('bereit');
    expect(plannedState(T(150), T(60), T(150))).toBe('verpasst');
    expect(plannedState(T(900), T(60), T(150))).toBe('verpasst');
  });
});

describe('autoStopDecision (§9.4, Regeln 2 und 4)', () => {
  const planned = { startedAt: T(0), plannedEndsAt: T(60), extendedUntil: null };

  it('Regel 2: Terminende + Hardlimit, Grenze selbst zählt', () => {
    expect(autoStopDecision(planned, limits, new Date(T(90).getTime() - 1))).toBeNull();
    expect(autoStopDecision(planned, limits, T(90))).toEqual({ at: T(90), reason: 'kalenderende' });
    expect(autoStopDecision(planned, limits, T(200))).toEqual({ at: T(90), reason: 'kalenderende' });
  });

  it('Regel 4: Maximaldauer ab started_at; spontane Sessions kennen nur diese', () => {
    const spontaneous = { startedAt: T(0), plannedEndsAt: null, extendedUntil: null };
    expect(autoStopDecision(spontaneous, limits, T(239))).toBeNull();
    expect(autoStopDecision(spontaneous, limits, T(1000))).toEqual({ at: T(240), reason: 'maximaldauer' });
  });

  it('beide überschritten: die zuerst erreichte; Gleichstand: Kalenderende', () => {
    const late = { startedAt: T(0), plannedEndsAt: T(300), extendedUntil: null };
    expect(autoStopDecision(late, limits, T(1000))).toEqual({ at: T(240), reason: 'maximaldauer' });
    const tie = { startedAt: T(0), plannedEndsAt: T(210), extendedUntil: null };
    expect(autoStopDecision(tie, limits, T(1000))).toEqual({ at: T(240), reason: 'kalenderende' });
  });

  it('Verlängerung: davor keine Regel, danach ist die Grenze extended_until, falls später', () => {
    const extended = { ...planned, extendedUntil: T(100) };
    expect(autoStopDecision(extended, limits, T(99))).toBeNull();
    expect(autoStopDecision(extended, limits, T(100))).toEqual({ at: T(100), reason: 'kalenderende' });
    // Verlängerung vor der Grenze ändert nichts
    expect(autoStopDecision({ ...planned, extendedUntil: T(70) }, limits, T(95))).toEqual({
      at: T(90),
      reason: 'kalenderende',
    });
  });

  it('Einstellungen bestimmen die Grenzen', () => {
    expect(autoStopDecision(planned, { hardAfterEndMin: 5, maxDurationMin: 240 }, T(65))).toEqual({
      at: T(65),
      reason: 'kalenderende',
    });
    expect(autoStopDecision(planned, { hardAfterEndMin: 600, maxDurationMin: 30 }, T(31))).toEqual({
      at: T(30),
      reason: 'maximaldauer',
    });
  });
});
