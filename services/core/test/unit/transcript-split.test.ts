// Teilung von Transkript-Abschnitten an Foliengrenzen (VERTRAEGE §18.4), reine Funktion.
import { describe, expect, it } from 'vitest';
import type { TranscriptWord } from '@sg/shared';
import { splitSegment, type SlideRange, type SplitInput } from '../../src/services/transcript.ts';

const slide = (n: number, startMs: number, endMs: number): SlideRange => ({
  slideId: `slide-${n}`,
  slideIndex: n,
  startMs,
  endMs,
});
const w = (text: string, start_ms: number, end_ms: number): TranscriptWord => ({
  text,
  start_ms,
  end_ms,
  prob: 1,
});
const seg = (startMs: number, endMs: number, words: TranscriptWord[] | null): SplitInput => ({
  id: 'seg',
  recordingId: 'rec',
  startMs,
  endMs,
  text: words ? words.map((x) => x.text).join(' ') : 'ganzer Text',
  lang: 'de',
  words,
});

describe('splitSegment', () => {
  it('ein Wort in einer Lücke zwischen zwei Segmenten gehört zum nächstgelegenen, bei Gleichstand zum früheren', () => {
    const slides = [slide(1, 0, 1000), slide(2, 2000, 3000)];
    // Mitte 1500: gleich weit von 1000 (Ende, ausschließlich) und 2000 → früher
    const tie = splitSegment(
      seg(500, 2500, [w('a', 500, 900), w('mitte', 1400, 1600), w('b', 2200, 2400)]),
      slides,
      false,
    );
    expect(tie.map((l) => [l.slide_index, l.text])).toEqual([
      [1, 'a mitte'],
      [2, 'b'],
    ]);
    // Mitte 1700 liegt näher an Segment 2
    const near = splitSegment(
      seg(500, 2500, [w('a', 500, 900), w('x', 1600, 1800), w('b', 2200, 2400)]),
      slides,
      false,
    );
    expect(near.map((l) => [l.slide_index, l.text])).toEqual([
      [1, 'a'],
      [2, 'x b'],
    ]);
  });

  it('abwechselnde Folien ergeben je Wechsel eine Zeile, part zählt fortlaufend', () => {
    const slides = [slide(1, 0, 100), slide(2, 100, 200), slide(1, 200, 300)];
    const lines = splitSegment(
      seg(0, 300, [w('a', 0, 50), w('b', 100, 150), w('c', 200, 250)]),
      slides,
      false,
    );
    expect(lines.map((l) => [l.part, l.slide_id, l.text])).toEqual([
      [0, 'slide-1', 'a'],
      [1, 'slide-2', 'b'],
      [2, 'slide-1', 'c'],
    ]);
  });

  it('zwei Segmente, aber keine Wörter: eine Zeile, Folie mit der Mitte; liegt die Mitte in keinem, die größte Überlappung', () => {
    const slides = [slide(1, 0, 400), slide(2, 400, 1000)];
    expect(splitSegment(seg(300, 700, null), slides, false).map((l) => l.slide_index)).toEqual([2]); // Mitte 500
    expect(splitSegment(seg(300, 700, []), slides, false).map((l) => l.slide_index)).toEqual([2]);
    // Lücke um die Mitte: Segment 1 überlappt 100, Segment 2 überlappt 200
    const gap = [slide(1, 0, 400), slide(2, 600, 1000)];
    expect(splitSegment(seg(300, 800, null), gap, false)).toHaveLength(1);
    expect(splitSegment(seg(300, 800, null), gap, false)[0]!.slide_index).toBe(2); // Mitte 550 → keins
    // Gleichstand der Überlappung: das frühere
    const even = [slide(1, 0, 450), slide(2, 550, 1000)];
    expect(splitSegment(seg(350, 650, null), even, false)[0]!.slide_index).toBe(1);
  });

  it('Teil `words` nur mit includeWords; Abschnitt ohne Wörter ergibt []', () => {
    const slides = [slide(1, 0, 100), slide(2, 100, 200)];
    const [a, b] = splitSegment(seg(0, 200, [w('a', 0, 50), w('b', 100, 150)]), slides, true);
    expect(a!.words).toEqual([w('a', 0, 50)]);
    expect(b!.words).toEqual([w('b', 100, 150)]);
    expect(splitSegment(seg(0, 50, null), slides, true)[0]!.words).toEqual([]);
    expect(splitSegment(seg(0, 50, null), slides, false)[0]).not.toHaveProperty('words');
  });

  it('Abschnitt ohne Dauer: Zeitpunkt muss start ≤ t < end erfüllen', () => {
    const slides = [slide(1, 0, 100), slide(2, 100, 200)];
    expect(splitSegment(seg(100, 100, null), slides, false)[0]!.slide_index).toBe(2);
    expect(splitSegment(seg(200, 200, null), slides, false)[0]!.slide_id).toBeNull();
  });
});
