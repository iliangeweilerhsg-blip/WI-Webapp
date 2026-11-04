import { describe, expect, it } from 'vitest';
import { findHits, fold, hitRect } from '../src/lib/pdf-search.ts';

const item = (str: string) => ({ str, x: 10, y: 20, w: 100, h: 10 });

describe('Suche im Text', () => {
  it('fold ändert nie die Länge (İ bleibt, ß bleibt)', () => {
    for (const text of ['İstanbul', 'Straße', 'ÄÖÜ', 'Normalisierung']) {
      expect(fold(text)).toHaveLength(text.length);
    }
    expect(fold('ÄÖÜ')).toBe('äöü');
  });

  it('Offsets zeigen auf den Originaltext, auch nach einem İ', () => {
    const text = 'İstanbul Normalisierung';
    const [hit] = findHits(1, [item(text)], 'normalisierung');
    expect(hit).toMatchObject({ start: 9, length: 14 });
    expect(text.slice(hit?.start, (hit?.start ?? 0) + (hit?.length ?? 0))).toBe('Normalisierung');
  });

  it('Treffer sitzt nach gemessener Breite, ohne Messung nach Zeichen', () => {
    expect(hitRect(item('abcd'), { start: 2, length: 1 })).toMatchObject({ left: 60, width: 25 });
    // „i“ ist schmal: gemessen liegt der Treffer weiter links als nach Zeichenzahl
    const widths: Record<string, number> = { i: 1, m: 3 };
    const measure = (text: string) => [...text].reduce((sum, c) => sum + (widths[c] ?? 2), 0);
    const rect = hitRect(item('iimm'), { start: 2, length: 2 }, measure);
    expect(rect.left).toBeCloseTo(10 + (100 * 2) / 8);
    expect(rect.width).toBeCloseTo((100 * 6) / 8);
  });
});
