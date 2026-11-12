import { describe, expect, it } from 'vitest';
import { firstSteps } from '../src/components/today/FirstSteps.tsx';
import { sessionCost, sessionCostText } from '../src/lib/costs.ts';
import { makeCostSummary } from './fake-core.ts';

const NONE = {
  hasCalendar: false,
  moodleSetUp: false,
  micChecked: false,
  hasBackupTarget: false,
  hasIpad: false,
};

describe('Erste Schritte (UX-14)', () => {
  it('hat fünf Punkte in fester Reihenfolge, alle offen ohne Einrichtung', () => {
    const steps = firstSteps(NONE);
    expect(steps.map((s) => s.id)).toEqual(['kalender', 'moodle', 'mikrofon', 'backup', 'ipad']);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it('jeder Punkt hakt sich aus seiner eigenen Angabe ab und führt zur passenden Seite', () => {
    const steps = firstSteps({ ...NONE, hasCalendar: true, hasBackupTarget: true });
    expect(steps.filter((s) => s.done).map((s) => s.id)).toEqual(['kalender', 'backup']);
    const href = Object.fromEntries(steps.map((s) => [s.id, s.href]));
    expect(href.moodle).toBe('/einstellungen?bereich=moodle');
    expect(href.ipad).toBe('/einstellungen?bereich=geraete');
    expect(href.backup).toBe('/einstellungen?bereich=daten');
  });
});

describe('sessionCost (UX-16)', () => {
  const ID = '0190f6a2-0000-7000-8000-0000000000e1';
  it('findet die Session in by_session', () => {
    const summary = makeCostSummary({ by_session: [{ session_id: ID, session: null, calls: 2, eur: 0.5 }] });
    expect(sessionCost(summary, ID)).toEqual({ eur: 0.5, calls: 2, month: '2026-11' });
  });
  it('liefert null, wenn sie fehlt oder noch nichts geladen ist', () => {
    expect(sessionCost(makeCostSummary(), ID)).toBeNull();
    expect(sessionCost(undefined, ID)).toBeNull();
  });
  it('nennt den Monat und während der Verarbeitung „bisher“', () => {
    expect(sessionCostText({ eur: 0.5, month: '2026-11' }, false)).toMatch(
      /^KI-Kosten dieser Vorlesung im November 2026: ca\. /,
    );
    expect(sessionCostText({ eur: 0.5, month: '2026-11' }, true)).toContain(': bisher ca. ');
  });
});
