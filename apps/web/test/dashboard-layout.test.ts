import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  LAYOUTS,
  MIN_WIDTH,
  dragWidths,
  resolveLayout,
  validWidths,
  type Widths,
} from '../src/components/dashboard/layout.ts';
import { newerSession, SESSION_DASHBOARD_AVAILABLE } from '../src/lib/sessions.ts';
import { makeSession } from './fake-core.ts';

describe('Dashboard-Layout: Vorlagen und Auflösung', () => {
  it('Vorlagen summieren sich auf 100, Standard ist 50/25/25, Tasten 1 bis 4', () => {
    for (const l of LAYOUTS) expect(l.widths[0] + l.widths[1] + l.widths[2]).toBe(100);
    expect(LAYOUTS.find((l) => l.id === 'standard')?.widths).toEqual([50, 25, 25]);
    expect(LAYOUTS.map((l) => l.key)).toEqual(['1', '2', '3', '4']);
    expect(LAYOUTS.find((l) => l.id === 'fokus')?.widths).toEqual([100, 0, 0]);
  });

  it('ohne Modul-Einstellung gilt der globale Standard, sonst Standard', () => {
    expect(resolveLayout({}, 'notizen_gross')).toEqual({ layout: 'notizen_gross', widths: [25, 15, 60] });
    expect(resolveLayout(undefined, undefined)).toEqual({ layout: DEFAULT_LAYOUT, widths: [50, 25, 25] });
  });

  it('die Wahl des Moduls schlägt den globalen Standard; gezogene Breiten schlagen die Vorlage', () => {
    expect(resolveLayout({ layout: 'folie_gross' }, 'standard').widths).toEqual([70, 15, 15]);
    expect(resolveLayout({ layout: 'standard', column_widths: [40, 30, 30] }, 'fokus')).toEqual({
      layout: 'standard',
      widths: [40, 30, 30],
    });
  });

  it('unbrauchbare Breiten werden ignoriert; in „Fokus“ gelten gezogene Breiten nicht', () => {
    expect(resolveLayout({ column_widths: [10, 10, 10] }, 'standard').widths).toEqual([50, 25, 25]);
    expect(validWidths([50, 25, 25])).toBe(true);
    expect(validWidths([60, 50, -10])).toBe(false);
    expect(validWidths([50, 50])).toBe(false);
    expect(resolveLayout({ layout: 'fokus', column_widths: [40, 30, 30] }, 'standard').widths).toEqual([
      100, 0, 0,
    ]);
  });
});

describe('Dashboard-Layout: Ziehen', () => {
  const start: Widths = [50, 25, 25];

  it('Trennlinie 0 verschiebt Folie gegen Übung, Notizen bleiben', () => {
    expect(dragWidths(start, 0, 10)).toEqual([60, 15, 25]);
    expect(dragWidths(start, 0, -20)).toEqual([30, 45, 25]);
  });

  it('Trennlinie 1 verschiebt Übung gegen Notizen, Folie bleibt', () => {
    expect(dragWidths(start, 1, 10)).toEqual([50, 35, 15]);
    expect(dragWidths(start, 1, -10)).toEqual([50, 15, 35]);
  });

  it('keine Spalte wird schmaler als das Minimum, die Summe bleibt 100', () => {
    for (const handle of [0, 1] as const) {
      for (const delta of [-500, -33.3, 7.7, 500]) {
        const next = dragWidths(start, handle, delta);
        expect(Math.round((next[0] + next[1] + next[2]) * 10) / 10).toBe(100);
        for (const n of next) expect(n).toBeGreaterThanOrEqual(MIN_WIDTH);
      }
    }
    expect(dragWidths(start, 0, 500)).toEqual([67, 8, 25]);
    expect(dragWidths(start, 1, 500)).toEqual([50, 42, 8]);
  });
});

describe('Session übernehmen', () => {
  it('ältere Fassung verworfen, Gleichstand und neuere angenommen', () => {
    const known = makeSession({ updated_at: '2026-11-04T08:00:10Z', state: 'pausiert' });
    const older = makeSession({ updated_at: '2026-11-04T08:00:05Z', state: 'laeuft' });
    const same = makeSession({ updated_at: '2026-11-04T08:00:10Z', state: 'laeuft' });
    const newer = makeSession({ updated_at: '2026-11-04T08:00:20Z', state: 'beendet' });
    expect(newerSession(known, older)).toBe(known);
    expect(newerSession(known, same)).toBe(same);
    expect(newerSession(known, newer)).toBe(newer);
    expect(newerSession(undefined, older)).toBe(older);
  });

  it('der Einstieg von der Heute-Karte ist freigeschaltet (T1-04)', () => {
    expect(SESSION_DASHBOARD_AVAILABLE).toBe(true);
  });
});
