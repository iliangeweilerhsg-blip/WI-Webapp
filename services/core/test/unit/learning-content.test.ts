// VERTRAEGE §21.2: Säubern und Prüfen des Karteninhalts gegen `packages/schemas/fixtures/cards/content.json`
// (gleiche Testfälle prüft der Worker, B1).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CardContent } from '@sg/shared';
import {
  cardFrontKey,
  checkCardContent,
  countWords,
  normalizeCardContent,
  sanitizeCardText,
} from '../../src/learning/content.ts';

const file = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'schemas',
  'fixtures',
  'cards',
  'content.json',
);
const fixture = JSON.parse(readFileSync(file, 'utf8')) as {
  cases: {
    name: string;
    content: CardContent;
    reason: string | null;
    normalized?: CardContent;
    front_words?: number;
    answer_words?: number;
    plain?: string;
  }[];
};

describe('Karteninhalt (content.json)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const result = checkCardContent(c.content);
      if (c.reason === null) {
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.content).toEqual(c.normalized);
        expect(result.frontWords).toBe(c.front_words);
        expect(result.answerWords).toBe(c.answer_words);
        expect(result.plain).toBe(c.plain);
      } else {
        expect(result).toEqual({ ok: false, reason: c.reason });
      }
    });
  }
});

describe('Säubern', () => {
  it('NFC, Zeilenenden, Tab, Steuer- und Formatzeichen, trimmen', () => {
    expect(sanitizeCardText('  é\r\nx\ry\tz\u0000​­  ')).toBe('é\nx\ny z');
  });

  it('lässt Zeilenumbrüche stehen und entfernt NEL', () => {
    expect(sanitizeCardText('a\nb\u0085c')).toBe('a\nbc');
  });

  it('NFC erst nach dem Entfernen (wie der Worker): e + ZWJ + Akut wird é', () => {
    expect(sanitizeCardText('e‍́')).toBe('é');
  });
});

describe('Abgleich mit dem Worker (B1)', () => {
  it('Klammer im Text einer Lücke ist cloze_syntax, nicht cloze_none', () => {
    for (const text of ['A {{c1::a}b}} x', 'A {{c1::a{b}} x']) {
      const content: CardContent = {
        kind: 'cloze',
        front: { text_md: text },
        back: { answers: { c1: ['a'] } },
      };
      expect(checkCardContent(content)).toEqual({ ok: false, reason: 'cloze_syntax' });
    }
  });

  it('too_long, wenn NFC den Text über die Grenze des Schemas verlängert', () => {
    // U+0958 ist von der Komposition ausgenommen: NFC macht daraus zwei Zeichen
    const front = 'क़'.repeat(300);
    expect(front.length).toBe(300);
    const basic: CardContent = {
      kind: 'basic',
      front: { text_md: front },
      back: { text_md: 'x', explanation_md: null },
    };
    expect(checkCardContent(basic)).toEqual({ ok: false, reason: 'too_long' });
    const cloze: CardContent = {
      kind: 'cloze',
      front: { text_md: 'Ein {{c1::x}}.' },
      back: { answers: { c1: ['x', 'क़'.repeat(150)] } },
    };
    expect(checkCardContent(cloze)).toEqual({ ok: false, reason: 'too_long' });
  });
});

describe('Wörter', () => {
  it('zählt Folgen ohne Leerraum', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  eins   zwei\ndrei ')).toBe(3);
  });
});

describe('Hilfen für B3', () => {
  it('normalizeCardContent wirft card_invalid mit reason', () => {
    const bad: CardContent = {
      kind: 'cloze',
      front: { text_md: 'ohne Lücke' },
      back: { answers: { c1: ['x'] } },
    };
    expect(() => normalizeCardContent(bad)).toThrowError(
      expect.objectContaining({
        statusCode: 400,
        code: 'card_invalid',
        details: { reason: 'cloze_none' },
      }) as Error,
    );
  });

  it('cardFrontKey: gleiche Vergleichsform trotz Schreibweise, bei cloze mit […]', () => {
    const a: CardContent = {
      kind: 'basic',
      front: { text_md: 'Was  ist ein Tupel?' },
      back: { text_md: 'x', explanation_md: null },
    };
    const b: CardContent = {
      kind: 'basic',
      front: { text_md: 'was ist EIN tupel?' },
      back: { text_md: 'y', explanation_md: null },
    };
    expect(cardFrontKey(a)).toBe(cardFrontKey(b));
    const cloze: CardContent = {
      kind: 'cloze',
      front: { text_md: 'Ein {{c1::Tupel}} ist eine Zeile.' },
      back: { answers: { c1: ['Tupel'] } },
    };
    expect(cardFrontKey(cloze)).toBe('ein […] ist eine zeile.');
  });
});
