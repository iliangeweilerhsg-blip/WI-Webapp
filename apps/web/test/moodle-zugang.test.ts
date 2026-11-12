// UX-312/UX-313: reine Hilfen für Fristhinweis und Zugangshinweis. Alle Namen sind erfunden.
import { describe, expect, it } from 'vitest';

import { accessHintText, deadlineAfterExpiry, lateNote } from '../src/lib/moodle.ts';

const NOW = new Date('2026-11-12T10:00:00').getTime();
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe('deadlineAfterExpiry', () => {
  const blatt = { name: 'Blatt 3', due_at: day(20) };
  it('nennt die erste Frist nach dem Ablauf, wenn der Ablauf höchstens 14 Tage entfernt ist', () => {
    expect(deadlineAfterExpiry('2026-11-24', [{ name: 'Blatt 4', due_at: day(40) }, blatt], NOW)).toBe(blatt);
  });
  it('keine Frist nach dem Ablauf: nichts', () => {
    expect(deadlineAfterExpiry('2026-11-24', [{ name: 'Blatt 1', due_at: day(5) }], NOW)).toBeNull();
  });
  it('Ablauf noch weit weg oder schon vorbei: nichts', () => {
    expect(deadlineAfterExpiry('2027-02-01', [blatt], NOW)).toBeNull();
    expect(deadlineAfterExpiry('2026-11-01', [blatt], NOW)).toBeNull();
    expect(deadlineAfterExpiry(null, [blatt], NOW)).toBeNull();
  });
  it('eine Frist am Ablauftag selbst zählt nicht als „danach“', () => {
    expect(deadlineAfterExpiry('2026-11-24', [{ name: 'Blatt 2', due_at: day(12) }], NOW)).toBeNull();
  });
});

describe('accessHintText', () => {
  it('nennt die Frist', () => {
    const text = accessHintText('ok', '2026-11-24', { name: 'Blatt 3', due_at: day(20) }, NOW);
    expect(text).toContain('läuft am 24.11.2026 ab, vor der Frist „Blatt 3“');
    expect(text.endsWith('Erneuere ihn vorher mit')).toBe(true);
  });
  it('ohne Frist bleibt der bisherige Satz', () => {
    expect(accessHintText('laeuft_bald_ab', '2026-11-24')).toBe(
      'Der Moodle-Zugang läuft am 24.11.2026 ab. Erneuere ihn vorher mit',
    );
  });
});

describe('lateNote', () => {
  const base = { state: 'entwurf' as const, lastModifiedAt: null, dueAt: day(-1), cutoffAt: null, now: NOW };
  it('vor der Frist nichts', () => {
    expect(lateNote({ ...base, dueAt: day(1) })).toBeNull();
    expect(lateNote({ ...base, dueAt: null })).toBeNull();
  });
  it('Frist vorbei, nicht eingereicht: ehrlich, mit Nachfrist wenn bekannt', () => {
    expect(lateNote(base)).toContain('Die Frist ist vorbei');
    expect(lateNote({ ...base, cutoffAt: day(2) })).toContain('noch bis');
    expect(lateNote({ ...base, cutoffAt: day(-0.5) })).toContain('keine Abgabe mehr');
  });
  it('eingereicht: nur nach der Frist als verspätet', () => {
    expect(lateNote({ ...base, state: 'eingereicht', lastModifiedAt: day(-2) })).toBeNull();
    expect(lateNote({ ...base, state: 'eingereicht', lastModifiedAt: day(-0.5) })).toContain('verspätet');
  });
});
