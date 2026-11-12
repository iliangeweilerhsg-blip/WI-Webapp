// Lücken in der Aufnahme (UX-310): reine Rechnung aus den Aufnahmen einer Session.
import { describe, expect, it, vi } from 'vitest';

// Die Uhrzeiten der Lückenzeile sind Ortszeit; fest auf Zürich, damit der Test überall gleich rechnet
vi.hoisted(() => {
  process.env.TZ = 'Europe/Zurich';
});

import { formatGapDuration, gapText, gapsSummary, recordingGaps } from '../src/components/rueckblick/gaps.ts';
import { makeRecording } from './fake-core.ts';

const rec = (n: number, started_ms: number, duration_ms: number | null, extra = {}) =>
  makeRecording({
    id: `0190f6a2-0000-7000-8000-00000000f${String(n).padStart(3, '0')}`,
    started_ms,
    duration_ms,
    ...extra,
  });

describe('recordingGaps', () => {
  it('findet den Abstand zwischen zwei Aufnahmen ab einer Minute', () => {
    expect(recordingGaps([rec(1, 0, 600_000), rec(2, 1_380_000, 60_000)])).toEqual([
      { start_ms: 600_000, end_ms: 1_380_000 },
    ]);
    expect(recordingGaps([rec(1, 0, 600_000), rec(2, 659_999, 1000)])).toEqual([]);
    expect(recordingGaps([rec(1, 0, 600_000), rec(2, 660_000, 1000)])).toHaveLength(1);
  });

  it('ignoriert Aufnahmen ohne Länge und gelöschte, und rechnet überlappende zusammen', () => {
    expect(recordingGaps([rec(1, 0, 600_000), rec(2, 2_000_000, null)])).toEqual([]);
    expect(
      recordingGaps([rec(1, 0, 600_000), rec(2, 2_000_000, 1000, { deleted_at: '2026-11-04T09:00:00Z' })]),
    ).toEqual([]);
    // R2 liegt in R1; erst nach dem späteren Ende von R1 zählt der Abstand
    expect(recordingGaps([rec(1, 0, 1_000_000), rec(2, 100_000, 50_000), rec(3, 1_200_000, 1000)])).toEqual([
      { start_ms: 1_000_000, end_ms: 1_200_000 },
    ]);
  });

  it('sortiert die Aufnahmen selbst nach Beginn', () => {
    expect(recordingGaps([rec(3, 3_000_000, 1000), rec(1, 0, 600_000), rec(2, 1_380_000, 60_000)])).toEqual([
      { start_ms: 600_000, end_ms: 1_380_000 },
      { start_ms: 1_440_000, end_ms: 3_000_000 },
    ]);
  });

  it('formatiert Dauer und Summe', () => {
    expect(formatGapDuration(13 * 60_000)).toBe('13 min');
    expect(formatGapDuration(65 * 60_000)).toBe('1 h 5 min');
    expect(formatGapDuration(120 * 60_000)).toBe('2 h');
    expect(gapsSummary([])).toBeNull();
    expect(gapsSummary([{ start_ms: 0, end_ms: 13 * 60_000 }])).toBe('13 min ohne Aufnahme.');
    expect(
      gapsSummary([
        { start_ms: 0, end_ms: 10 * 60_000 },
        { start_ms: 20 * 60_000, end_ms: 23 * 60_000 },
      ]),
    ).toBe('13 min ohne Aufnahme, in 2 Lücken.');
  });

  it('nennt die Lücke in Ortszeit ab dem Beginn der Session', () => {
    // 09:00 UTC = 10:00 Uhr in Zürich (Winterzeit); Lücke von 12 bis 25 Minuten nach Beginn
    const gap = { start_ms: 12 * 60_000, end_ms: 25 * 60_000 };
    expect(gapText(gap, '2026-11-04T09:00:00Z')).toBe('Keine Aufnahme 10:12 bis 10:25 (13 min)');
    // Ohne Startzeit: Sitzungszeit statt Uhrzeit
    expect(gapText(gap, null)).toMatch(/^Keine Aufnahme \S+ bis \S+ \(13 min\)$/);
  });
});
