import { describe, expect, it } from 'vitest';
import { findHits, hitRect, normalizeQuery } from '../src/lib/pdf-search.ts';
import type { PdfTextItem } from '../src/lib/pdf.ts';

const item = (str: string): PdfTextItem => ({ str, x: 10, y: 20, w: 100, h: 10 });

/** Textstücke auf einer Zeile, lückenlos hintereinander (wie Kerning-Zerlegung) */
function run(parts: string[], gaps: number[] = [], y = 20): PdfTextItem[] {
  let x = 10;
  return parts.map((str, i) => {
    x += gaps[i - 1] ?? 0;
    const it = { str, x, y, w: str.length * 5, h: 10 };
    x += it.w;
    return it;
  });
}

/** Text des Treffers aus den Originalstücken */
function textOf(
  items: readonly PdfTextItem[],
  hit: { parts: { item: number; start: number; length: number }[] },
) {
  return hit.parts.map((p) => items[p.item]?.str.slice(p.start, p.start + p.length)).join('|');
}

describe('Suche im Text', () => {
  it('Kleinschreibung ändert nichts an den Offsets, auch nach einem İ', () => {
    const text = 'İstanbul Normalisierung';
    const items = [item(text)];
    const [hit] = findHits(1, items, 'normalisierung');
    expect(hit?.parts).toHaveLength(1);
    expect(textOf(items, hit!)).toBe('Normalisierung');
    expect(findHits(1, [item('Straße ÄÖÜ')], 'ÄÖÜ')).toHaveLength(1);
    expect(findHits(1, [item('İstanbul')], 'İSTANBUL')).toHaveLength(1);
    expect(findHits(1, [item('Istanbul')], 'ı')).toHaveLength(0);
  });

  it('findet mehrere Treffer im selben Stück und Groß-/Kleinschreibung egal', () => {
    expect(findHits(3, [item('Markt und markt, MARKT')], 'Markt')).toHaveLength(3);
    expect(findHits(3, [item('abc')], '   ')).toEqual([]);
  });

  it('Wort über 2 und über 5 Textstücke', () => {
    const two = run(['Gleichge', 'wicht']);
    const [hit2] = findHits(1, two, 'gleichgewicht');
    expect(hit2?.parts).toEqual([
      { item: 0, start: 0, length: 8 },
      { item: 1, start: 0, length: 5 },
    ]);
    const five = run(['Glei', 'ch', 'ge', 'wi', 'cht']);
    const hits5 = findHits(1, five, 'Gleichgewicht');
    expect(hits5).toHaveLength(1);
    expect(hits5[0]?.parts).toHaveLength(5);
    // Teil eines Worts, das in der Mitte eines Stücks endet
    const [mid] = findHits(1, five, 'chge');
    expect(textOf(five, mid!)).toBe('ch|ge');
  });

  it('zeichenweise gesetzter Text (jede Taste ein Stück)', () => {
    const items = run([...'Angebot und Nachfrage']);
    const hits = findHits(1, items, 'und nachfrage');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.parts).toHaveLength(12); // das Leerzeichen ist ein eigenes Stück ohne Treffer-Rechteck
  });

  it('Leerzeichen als eigenes Stück', () => {
    const items = run(['Angebot', ' ', 'Nachfrage']);
    expect(findHits(1, items, 'angebot nachfrage')).toHaveLength(1);
    expect(findHits(1, items, 'angebotnachfrage')).toHaveLength(0);
  });

  it('fehlendes Leerzeichen, aber Abstand: Wortgrenze; ohne Abstand: keine', () => {
    const apart = run(['Angebot', 'Nachfrage'], [4]);
    expect(findHits(1, apart, 'angebot nachfrage')).toHaveLength(1);
    expect(findHits(1, apart, 'angebotnachfrage')).toHaveLength(0);
    const tight = run(['Angebot', 'Nachfrage'], [0]);
    expect(findHits(1, tight, 'angebotnachfrage')).toHaveLength(1);
    expect(findHits(1, tight, 'angebot nachfrage')).toHaveLength(0);
  });

  it('Ligatur „ﬁ“ in „Deﬁnition“ findet „Definition“ (und umgekehrt)', () => {
    const items = [item('Deﬁnition und Eﬃzienz, ﬂexibel')];
    expect(findHits(1, items, 'Definition')).toHaveLength(1);
    expect(findHits(1, items, 'effizienz')).toHaveLength(1);
    expect(findHits(1, items, 'flexibel')).toHaveLength(1);
    expect(findHits(1, [item('Definition')], 'Deﬁnition')).toHaveLength(1);
    const [hit] = findHits(1, items, 'Definition');
    expect(textOf(items, hit!)).toBe('Deﬁnition');
  });

  it('zerlegte Umlaute (NFD) werden gefunden', () => {
    const nfd = 'Märkte im Gleichgewicht, Für';
    const items = [item(nfd)];
    expect(findHits(1, items, 'Märkte')).toHaveLength(1);
    expect(findHits(1, items, 'FÜR')).toHaveLength(1);
    // Auch die Anfrage darf zerlegt sein
    expect(findHits(1, [item('Märkte')], 'Märkte')).toHaveLength(1);
    const [hit] = findHits(1, items, 'Märkte');
    expect(hit?.parts).toEqual([{ item: 0, start: 0, length: 7 }]);
  });

  it('Silbentrennung am Zeilenende (eol)', () => {
    const items: PdfTextItem[] = [
      { str: 'Der Markt-', x: 10, y: 20, w: 50, h: 10, eol: true },
      { str: 'gleichgewicht liegt', x: 10, y: 34, w: 90, h: 10 },
    ];
    const joined = findHits(1, items, 'Marktgleichgewicht');
    expect(joined).toHaveLength(1);
    expect(joined[0]?.parts).toEqual([
      { item: 0, start: 4, length: 5 },
      { item: 1, start: 0, length: 13 },
    ]);
    // Originalform mit Bindestrich
    const original = findHits(1, items, 'Markt-gleichgewicht');
    expect(original).toHaveLength(1);
    expect(original[0]?.parts[0]).toEqual({ item: 0, start: 4, length: 6 });
    // Teilwörter zählen nicht doppelt
    expect(findHits(1, items, 'markt')).toHaveLength(1);
    expect(findHits(1, items, 'gleichgewicht')).toHaveLength(1);
    // Mehrwortsuche mit Leerzeichen nach dem Strich
    expect(findHits(1, items, 'markt- gleichgewicht')).toHaveLength(1);
  });

  it('Silbentrennung erkannt am Zeilenwechsel ohne eol; Großbuchstabe danach bleibt Bindestrich-Wort', () => {
    const items: PdfTextItem[] = [
      { str: 'Wirtschafts-', x: 10, y: 20, w: 60, h: 10 },
      { str: 'wissenschaft', x: 10, y: 34, w: 60, h: 10 },
      { str: 'Input-', x: 10, y: 48, w: 30, h: 10 },
      { str: 'Output', x: 10, y: 62, w: 30, h: 10 },
    ];
    expect(findHits(1, items, 'wirtschaftswissenschaft')).toHaveLength(1);
    expect(findHits(1, items, 'input-output')).toHaveLength(1);
    expect(findHits(1, items, 'inputoutput')).toHaveLength(0);
  });

  it('Bindestrich nach Leerzeichen am Zeilenende wird nicht verbunden', () => {
    const items: PdfTextItem[] = [
      { str: 'Punkt -', x: 10, y: 20, w: 40, h: 10, eol: true },
      { str: 'weiter', x: 10, y: 34, w: 30, h: 10 },
    ];
    expect(findHits(1, items, 'punktweiter')).toHaveLength(0);
    expect(findHits(1, items, 'punkt - weiter')).toHaveLength(1);
  });

  it('weiches Trennzeichen (U+00AD) und geschütztes Leerzeichen', () => {
    const items = [item('Gleich­gewicht und Markt preis')];
    const [hit] = findHits(1, items, 'gleichgewicht');
    expect(hit?.parts).toEqual([{ item: 0, start: 0, length: 14 }]);
    expect(findHits(1, items, 'markt preis')).toHaveLength(1);
    expect(findHits(1, items, 'Gleich­gewicht')).toHaveLength(1);
  });

  it('Mehrwortsuche über Zeilenumbruch', () => {
    const items: PdfTextItem[] = [
      { str: 'das Gleichgewicht der', x: 10, y: 20, w: 100, h: 10, eol: true },
      { str: 'Märkte wird', x: 10, y: 34, w: 60, h: 10 },
    ];
    const hits = findHits(1, items, 'gleichgewicht der märkte');
    expect(hits).toHaveLength(1);
    expect(textOf(items, hits[0]!)).toBe('Gleichgewicht der|Märkte');
    // Zeilenwechsel allein (ohne eol) genügt
    const noEol: PdfTextItem[] = items.map((it) => ({ ...it, eol: false }));
    expect(findHits(1, noEol, 'der märkte')).toHaveLength(1);
  });

  it('typografische Striche, Anführungszeichen und mehrfacher Leerraum', () => {
    const items = [item('Ein – wichtiger  „Begriff“   und it’s')];
    expect(findHits(1, items, 'ein - wichtiger "begriff"')).toHaveLength(1);
    expect(findHits(1, items, "it's")).toHaveLength(1);
    expect(findHits(1, [item('A‑B und A—B')], 'a-b')).toHaveLength(2);
    expect(normalizeQuery('  Viel   Raum ')).toBe('viel raum');
  });

  it('Hoch-/Tiefstellung in einer Zeile gilt nicht als Zeilenwechsel', () => {
    const items: PdfTextItem[] = [
      { str: 'x', x: 10, y: 20, w: 5, h: 10 },
      { str: '2', x: 15, y: 17, w: 3, h: 6 },
    ];
    expect(findHits(1, items, 'x2')).toHaveLength(1);
  });

  it('Treffer-Rechtecke: ein Rechteck je Textstück', () => {
    const items: PdfTextItem[] = [
      { str: 'Gleichge', x: 10, y: 20, w: 40, h: 10 },
      { str: 'wicht', x: 50, y: 20, w: 25, h: 10 },
    ];
    const [hit] = findHits(1, items, 'chgewi');
    const rects = hit!.parts.map((p) => hitRect(items[p.item]!, p));
    expect(rects).toHaveLength(2);
    expect(rects[0]).toMatchObject({ left: 10 + (40 * 4) / 8, width: (40 * 4) / 8, top: 20, height: 10 });
    expect(rects[1]).toMatchObject({ left: 50, width: (25 * 2) / 5 });
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

  it('Leistung: 300 Seiten mit je 400 Textstücken', () => {
    const words = [
      'Markt',
      'Gleichgewicht',
      'Angebot',
      'Nachfrage',
      'der',
      'und',
      'Preis',
      'Menge',
      'ﬁxe',
      'Kosten',
    ];
    const pages = Array.from({ length: 300 }, (_, p) =>
      Array.from({ length: 400 }, (_, i): PdfTextItem => ({
        str: `${words[(i + p) % words.length]}${i % 20 === 19 ? '-' : ' '}`,
        x: 10 + (i % 20) * 30,
        y: 20 + Math.floor(i / 20) * 12,
        w: 28,
        h: 10,
        eol: i % 20 === 19,
      })),
    );
    const start = performance.now();
    let total = 0;
    for (const [n, items] of pages.entries()) total += findHits(n + 1, items, 'der').length;
    const first = performance.now() - start;
    const again = performance.now();
    for (const [n, items] of pages.entries()) total += findHits(n + 1, items, 'preis').length;
    const second = performance.now() - again;
    console.info(`Suche 300 Seiten: Aufbau ${first.toFixed(0)} ms, weitere Suche ${second.toFixed(0)} ms`);
    expect(total).toBeGreaterThan(0);
    // Großzügige Schranken (CI-Rechner)
    expect(first).toBeLessThan(5000);
    expect(second).toBeLessThan(first);
  });
});
