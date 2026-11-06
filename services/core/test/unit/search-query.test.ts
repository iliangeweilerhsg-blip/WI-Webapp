// T2-12: Zerlegen der Suchanfrage, tsquery-Text, RRF und Ausschnitte (VERTRAEGE §19.6), ohne Datenbank.
import { describe, expect, it } from 'vitest';
import {
  fuseRrf,
  HEADLINE_OPTIONS,
  parseSearchQuery,
  splitHeadline,
  tsQueryText,
  wantsVectorSearch,
} from '../../src/services/search.ts';

describe('parseSearchQuery', () => {
  it('trennt Präfixe vom Suchtext, Groß-/Kleinschreibung egal', () => {
    const parsed = parseSearchQuery('FACH:dbs dritte  Typ:Folie normalform');
    expect(parsed).toMatchObject({
      text: 'dritte normalform',
      fach: [{ token: 'FACH:dbs', value: 'dbs' }],
      kinds: ['slide'],
      unresolved: [],
      words: ['dritte', 'normalform'],
      prefixLast: true,
    });
  });

  it('mehrere typ: vereinigen sich (feste Reihenfolge)', () => {
    expect(parseSearchQuery('typ:gesagtes typ:folie x').kinds).toEqual(['slide', 'transcript']);
    expect(parseSearchQuery('typ:gesagtes typ:gesagtes x').kinds).toEqual(['transcript']);
  });

  it('unbekannter typ:, leeres fach:, leeres typ: und semester: sind nicht aufgelöst', () => {
    expect(parseSearchQuery('typ:video fach: typ: semester:HS26 normalform')).toMatchObject({
      unresolved: ['typ:video', 'fach:', 'typ:', 'semester:HS26'],
      fach: [],
      kinds: [],
      text: 'normalform',
    });
  });

  it('andere Doppelpunkte gehören zum Suchtext', () => {
    expect(parseSearchQuery('kapitel:3 abc')).toMatchObject({ text: 'kapitel:3 abc', unresolved: [] });
    expect(parseSearchQuery('kapitel:3 abc').words).toEqual(['kapitel', '3', 'abc']);
  });

  it('Präfix :* nur, wenn q nicht auf Leerraum endet', () => {
    expect(parseSearchQuery('vorlesu').prefixLast).toBe(true);
    expect(parseSearchQuery('vorlesu ').prefixLast).toBe(false);
    expect(parseSearchQuery('vorlesu\t').prefixLast).toBe(false);
  });

  it('Wörter: [\\p{L}\\p{N}]+, höchstens 8, Satzzeichen trennen', () => {
    expect(parseSearchQuery('a-b c.d (e) f,g h i j k').words).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
    ]);
    expect(parseSearchQuery('Ölförderung 2026 ñandú').words).toEqual(['Ölförderung', '2026', 'ñandú']);
    expect(parseSearchQuery('!!! ???').words).toEqual([]);
  });

  it('normalisiert nach NFC (zerlegte Umlaute zerfallen nicht in Teilwörter)', () => {
    const decomposed = 'Abhängigkeit';
    expect(parseSearchQuery(decomposed).words).toEqual(['Abhängigkeit']);
  });

  it('fach: behält den Wert wörtlich, auch mit weiterem Doppelpunkt', () => {
    expect(parseSearchQuery('fach:Data:Base x').fach).toEqual([
      { token: 'fach:Data:Base', value: 'Data:Base' },
    ]);
  });
});

describe('tsQueryText und wantsVectorSearch', () => {
  it('verbindet mit &, :* nur am letzten Wort', () => {
    expect(tsQueryText(['dritte', 'normal'], true)).toBe('dritte & normal:*');
    expect(tsQueryText(['dritte', 'normal'], false)).toBe('dritte & normal');
    expect(tsQueryText(['x'], true)).toBe('x:*');
    expect(tsQueryText([], true)).toBeNull();
  });

  it('Bedeutungssuche nur mit einem Wort ab 2 Zeichen', () => {
    expect(wantsVectorSearch(['a', 'b'])).toBe(false);
    expect(wantsVectorSearch(['a', 'bc'])).toBe(true);
    expect(wantsVectorSearch([])).toBe(false);
  });
});

describe('fuseRrf', () => {
  const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

  it('score = Σ 1/(60 + rang), Rang ab 1', () => {
    const fused = fuseRrf([
      [id(1), id(2)],
      [id(2), id(3)],
    ]);
    expect(fused.map((f) => f.id)).toEqual([id(2), id(1), id(3)]);
    expect(fused[0]!.score).toBeCloseTo(1 / 62 + 1 / 61, 12);
    expect(fused[1]!.score).toBeCloseTo(1 / 61, 12);
    expect(fused[2]!.score).toBeCloseTo(1 / 62, 12);
  });

  it('Gleichstand nach chunk_id aufsteigend', () => {
    const fused = fuseRrf([[id(9)], [id(4)]]);
    expect(fused.map((f) => f.id)).toEqual([id(4), id(9)]);
    expect(fused[0]!.score).toBe(fused[1]!.score);
  });

  it('leere Listen', () => {
    expect(fuseRrf([[], []])).toEqual([]);
  });
});

describe('splitHeadline', () => {
  const S = '\u0001';
  const E = '\u0002';

  it('Optionen enthalten echte Steuerzeichen', () => {
    expect(HEADLINE_OPTIONS).toContain('StartSel=\u0001,');
    expect(HEADLINE_OPTIONS).toContain('StopSel=\u0002,');
    expect(HEADLINE_OPTIONS).not.toContain('\\x01');
  });

  it('ganzer Text: Teile ohne …, leere Teile entfallen', () => {
    const text = 'Die dritte Normalform verbietet';
    expect(splitHeadline(`Die dritte ${S}Normalform${E} verbietet`, text)).toEqual([
      { text: 'Die dritte ', hit: false },
      { text: 'Normalform', hit: true },
      { text: ' verbietet', hit: false },
    ]);
    expect(splitHeadline(`${S}Normalform${E}`, 'Normalform')).toEqual([{ text: 'Normalform', hit: true }]);
  });

  it('Ausschnitt in der Mitte: … vorn und hinten, an Teile ohne hit angehängt', () => {
    const text = 'eins zwei drei Normalform vier fünf';
    expect(splitHeadline(`drei ${S}Normalform${E} vier`, text)).toEqual([
      { text: '… drei ', hit: false },
      { text: 'Normalform', hit: true },
      { text: ' vier …', hit: false },
    ]);
  });

  it('Treffer am Rand des Ausschnitts: … als eigener Teil ohne hit', () => {
    const text = 'eins Normalform zwei';
    expect(splitHeadline(`${S}Normalform${E}`, text)).toEqual([
      { text: '… ', hit: false },
      { text: 'Normalform', hit: true },
      { text: ' …', hit: false },
    ]);
  });

  it('Satzzeichen, die ts_headline am Rand weglässt, kommen zurück (kein …)', () => {
    const text = '(Klammer) Normalform am Ende.';
    expect(splitHeadline(`Klammer) ${S}Normalform${E} am Ende`, text)).toEqual([
      { text: '(Klammer) ', hit: false },
      { text: 'Normalform', hit: true },
      { text: ' am Ende.', hit: false },
    ]);
  });

  it('reiner Vektortreffer: Textanfang, alle Teile ohne hit', () => {
    const text = 'eins zwei drei vier';
    expect(splitHeadline('eins zwei', text)).toEqual([{ text: 'eins zwei …', hit: false }]);
  });

  it('mehrere Treffer', () => {
    const text = 'a Normalform b Normalform c';
    expect(splitHeadline(`a ${S}Normalform${E} b ${S}Normalform${E} c`, text)).toEqual([
      { text: 'a ', hit: false },
      { text: 'Normalform', hit: true },
      { text: ' b ', hit: false },
      { text: 'Normalform', hit: true },
      { text: ' c', hit: false },
    ]);
  });
});
