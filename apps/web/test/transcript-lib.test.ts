// Reine Logik des Rückblicks (lib/transcript.ts): Zeilen, Folien, Aufnahmen, Zustände, Schrittliste.
import { describe, expect, it } from 'vitest';
import type { Session } from '@sg/shared';
import {
  activeLineIndex,
  canContinueWithAudio,
  clockAt,
  isoAt,
  formatElapsed,
  locatePlayback,
  recordingAudioUrl,
  reviewState,
  rueckblickHref,
  retryStep,
  slideAt,
  stepRows,
  timelineBounds,
} from '../src/lib/transcript.ts';
import {
  makeLine,
  makeRecording,
  makeSession,
  makeSlideSegment,
  makeTranscript,
  makeTranscriptInfo,
} from './fake-core.ts';

const S1 = { id: '0190f6a2-0000-7000-8000-000000005000', index: 1 };
const S2 = { id: '0190f6a2-0000-7000-8000-000000005001', index: 2 };
const R1 = makeRecording({ id: '0190f6a2-0000-7000-8000-0000000000f1', started_ms: 0, duration_ms: 100_000 });
const R2 = makeRecording({
  id: '0190f6a2-0000-7000-8000-0000000000f5',
  started_ms: 300_000,
  duration_ms: 50_000,
});

describe('Adressen', () => {
  it('Route mit Query und Audio-Adresse', () => {
    expect(rueckblickHref('abc')).toBe('/rueckblick?id=abc');
    expect(recordingAudioUrl('r 1')).toBe('/api/v1/recordings/r%201/audio');
  });
});

describe('activeLineIndex', () => {
  const lines = [
    makeLine(1, 0, 1000, 'a', S1),
    makeLine(2, 1000, 2000, 'b', S1),
    makeLine(3, 5000, 6000, 'c', S2),
  ];
  it('start ≤ t < end', () => {
    expect(activeLineIndex(lines, 0)).toBe(0);
    expect(activeLineIndex(lines, 999)).toBe(0);
    expect(activeLineIndex(lines, 1000)).toBe(1);
    expect(activeLineIndex(lines, 5999)).toBe(2);
  });
  it('Ende ist ausschließlich, in Lücken und davor/danach keine Zeile', () => {
    expect(activeLineIndex(lines, 2000)).toBe(-1);
    expect(activeLineIndex(lines, 4000)).toBe(-1);
    expect(activeLineIndex(lines, 6000)).toBe(-1);
    expect(activeLineIndex([makeLine(1, 100, 200, 'x', S1)], 50)).toBe(-1);
    expect(activeLineIndex([], 0)).toBe(-1);
  });
  it('findet auch eine Zeile, die von einer späteren Aufnahme überlappt wird', () => {
    const overlap = [makeLine(1, 0, 10_000, 'lang', S1), makeLine(2, 2000, 3000, 'kurz', S1)];
    expect(activeLineIndex(overlap, 5000)).toBe(0);
  });
});

describe('slideAt', () => {
  const segments = [makeSlideSegment(1, S1, 0, 1000), makeSlideSegment(2, S2, 1000, 2000)];
  it('Segment mit start ≤ t < end', () => {
    expect(slideAt(segments, 999)?.slide_id).toBe(S1.id);
    expect(slideAt(segments, 1000)?.slide_id).toBe(S2.id);
    expect(slideAt(segments, 2000)).toBeNull();
  });
});

describe('locatePlayback', () => {
  it('Position in der Datei = t − started_ms', () => {
    expect(locatePlayback([R1, R2], 40_000)).toMatchObject({ recording: { id: R1.id }, offsetS: 40 });
    expect(locatePlayback([R1, R2], 310_500)).toMatchObject({ recording: { id: R2.id }, offsetS: 10.5 });
  });
  it('in der Lücke zwischen Aufnahmen beginnt die nächste', () => {
    expect(locatePlayback([R1, R2], 200_000)).toMatchObject({ recording: { id: R2.id }, offsetS: 0 });
  });
  it('rückwärts aus einer Lücke: 15 s vor dem Ende der vorherigen Aufnahme, nie in die nächste', () => {
    // Lücke 100 s bis 300 s; Zeit im Loch und der Anfang von R2 (so steht die Position nach einer Pause)
    expect(locatePlayback([R1, R2], 200_000, 'zurueck')).toMatchObject({
      recording: { id: R1.id },
      offsetS: 85,
    });
    expect(locatePlayback([R1, R2], 300_000 - 15_000, 'zurueck')).toMatchObject({
      recording: { id: R1.id },
      offsetS: 85,
    });
    // Kurze vorherige Aufnahme: höchstens bis zu deren Anfang
    const short = makeRecording({ id: R1.id, started_ms: 0, duration_ms: 10_000 });
    expect(locatePlayback([short, R2], 200_000, 'zurueck')).toMatchObject({
      recording: { id: short.id },
      offsetS: 0,
    });
    // Innerhalb einer Aufnahme und vorwärts ändert die Richtung nichts
    expect(locatePlayback([R1, R2], 40_000, 'zurueck')).toMatchObject({
      recording: { id: R1.id },
      offsetS: 40,
    });
    expect(locatePlayback([R1, R2], 200_000, 'vor')).toMatchObject({ recording: { id: R2.id }, offsetS: 0 });
  });
  it('vor der ersten Aufnahme deren Anfang, hinter der letzten deren Ende', () => {
    const late = makeRecording({ id: R2.id, started_ms: 50_000, duration_ms: 10_000 });
    expect(locatePlayback([late], 0)).toMatchObject({ offsetS: 0 });
    expect(locatePlayback([late], 999_000)).toMatchObject({ offsetS: 10 });
  });
  it('ignoriert Aufnahmen ohne Länge und gelöschte; ohne Audio nichts', () => {
    const none = makeRecording({ id: R2.id, duration_ms: null });
    const gone = makeRecording({ id: R1.id, deleted_at: '2026-11-04T09:00:00Z' });
    expect(locatePlayback([none, gone], 10)).toBeNull();
    expect(timelineBounds([none, gone])).toBeNull();
  });
  it('Grenzen der Zeitleiste: Anfang der ersten bis Ende der letzten', () => {
    expect(timelineBounds([R2, R1])).toEqual({ start: 0, end: 350_000 });
  });
});

describe('Zeitangaben', () => {
  it('verstrichene Zeit', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65_900)).toBe('1:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });
  it('Uhrzeit = started_at + t in Ortszeit; ohne started_at die verstrichene Zeit', () => {
    const base = new Date('2026-11-04T08:00:00Z');
    const local = (ms: number) => {
      const d = new Date(base.getTime() + ms);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    expect(clockAt('2026-11-04T08:00:00Z', 754_000, true)).toBe(local(754_000));
    expect(clockAt('2026-11-04T08:00:00Z', 754_000)).toBe(local(754_000).slice(0, 5));
    expect(clockAt(null, 754_000)).toBe('12:34');
  });
});

describe('isoAt', () => {
  it('ISO-Zeitpunkt aus started_at + t, ohne started_at null', () => {
    expect(isoAt('2026-11-04T08:00:00Z', 754_000)).toBe('2026-11-04T08:12:34.000Z');
    expect(isoAt(null, 1)).toBeNull();
  });
});

describe('Schrittliste', () => {
  it('nur vorhandene Schlüssel, in der Reihenfolge von PipelineStep, unbekannte ignoriert', () => {
    const rows = stepRows({
      'align.log': 'wartet',
      'audio.finalize': 'fertig',
      unbekannt: 'fertig',
    } as never);
    expect(rows.map((r) => [r.step, r.label, r.state])).toEqual([
      ['audio.finalize', 'Audio', 'fertig'],
      ['align.log', 'Folien zuordnen', 'wartet'],
    ]);
    expect(stepRows({})).toEqual([]);
    expect(stepRows(undefined)).toEqual([]);
  });
  it('„Erneut versuchen“ beginnt beim ersten Schritt in fehler/abgebrochen', () => {
    expect(retryStep({ 'audio.finalize': 'fertig', transcribe: 'abgebrochen', 'align.log': 'fehler' })).toBe(
      'transcribe',
    );
    expect(retryStep({ 'audio.finalize': 'fertig' })).toBeNull();
  });
  it('„Mit vorhandenem Audio fortfahren“ nur bei fehler in audio.finalize', () => {
    expect(canContinueWithAudio({ 'audio.finalize': 'fehler' })).toBe(true);
    expect(canContinueWithAudio({ 'audio.finalize': 'abgebrochen' })).toBe(false);
    expect(canContinueWithAudio({ transcribe: 'fehler' })).toBe(false);
  });
});

describe('reviewState (Reihenfolge nach §18.9)', () => {
  const done: Session['processing'] = {
    'audio.finalize': 'fertig',
    transcribe: 'fertig',
    'align.log': 'fertig',
  };
  const session = (processing: Session['processing'], state: Session['state'] = 'verarbeitet') =>
    makeSession({ state, processing });
  const withAudio = makeTranscript({ recordings: [R1], transcripts: [makeTranscriptInfo()] });

  it('bereit', () => {
    expect(reviewState(session(done), withAudio)).toBe('bereit');
  });
  it('nicht beendet geht vor allem', () => {
    expect(reviewState(session({ transcribe: 'laeuft' }, 'laeuft'), withAudio)).toBe('nicht_beendet');
  });
  it('offen geht vor keine Aufnahme, Fehler und veraltet', () => {
    const t = makeTranscript({ recordings: [], stale: true });
    expect(reviewState(session({ 'audio.finalize': 'fehler', transcribe: 'wartet' }), t)).toBe('offen');
    expect(reviewState(session({ transcribe: 'laeuft' }), t)).toBe('offen');
  });
  it('keine Aufnahme geht vor Fehler und veraltet', () => {
    const none = makeTranscript({ recordings: [makeRecording({ duration_ms: 0 })], stale: true });
    expect(reviewState(session({ ...done, 'align.log': 'fehler' }), none)).toBe('keine_aufnahme');
    const empty = makeTranscript({ recordings: [R1], transcripts: [] });
    expect(reviewState(session(done), empty)).toBe('keine_aufnahme');
  });
  it('Fehler geht vor veraltet', () => {
    const stale = makeTranscript({ recordings: [R1], transcripts: [makeTranscriptInfo()], stale: true });
    expect(reviewState(session({ ...done, 'align.log': 'abgebrochen' }), stale)).toBe('fehler');
    expect(reviewState(session(done), stale)).toBe('veraltet');
  });
  it('transcribe nicht fertig und kein Transkript ist noch keine „keine Aufnahme“', () => {
    const t = makeTranscript({ recordings: [R1], transcripts: [] });
    expect(reviewState(session({ ...done, transcribe: 'fehler' }), t)).toBe('fehler');
  });
});
