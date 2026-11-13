// VERTRAEGE §21.5: Tageswarteschlange und Lerntag gegen die gemeinsamen Testfälle in
// `packages/schemas/fixtures/cards/` (queue.json, learn-day.json).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CardKind, FsrsState } from '@sg/shared';
import { learnDay, overdueDays } from '../../src/learning/day.ts';
import { selectQueue, type QueueCandidate } from '../../src/learning/queue.ts';

const fixtures = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'schemas',
  'fixtures',
  'cards',
);
const load = <T>(name: string): T => JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as T;

interface DayFixture {
  cases: { name: string; tz: string; now: string; day: string; day_ends_at: string }[];
  overdue: { name: string; tz: string; now: string; due: string; overdue_days: number }[];
}

describe('Lerntag (learn-day.json)', () => {
  const fixture = load<DayFixture>('learn-day.json');

  for (const c of fixture.cases) {
    it(`${c.name}: Lerntag und Ende`, () => {
      const result = learnDay(new Date(c.now), c.tz);
      expect(result.day).toBe(c.day);
      expect(result.endsAt.toISOString()).toBe(new Date(c.day_ends_at).toISOString());
    });
  }

  for (const o of fixture.overdue) {
    it(`Überfälligkeit: ${o.name}`, () => {
      expect(overdueDays(new Date(o.now), new Date(o.due), o.tz)).toBe(o.overdue_days);
    });
  }

  it('der Anfang des Lerntags ist das Ende des Vortags', () => {
    const today = learnDay(new Date('2026-11-13T10:00:00Z'), 'Europe/Zurich');
    const yesterday = learnDay(new Date('2026-11-12T10:00:00Z'), 'Europe/Zurich');
    expect(today.startsAt.toISOString()).toBe(yesterday.endsAt.toISOString());
    expect(today.startsAt.toISOString()).toBe('2026-11-13T03:00:00.000Z');
  });
});

interface QueueFixtureCard {
  id: string;
  concept: string;
  kind: CardKind;
  state: FsrsState;
  due: string;
  r: number | null;
  exam_relevant: boolean;
  suspended: boolean;
}
interface QueueFixture {
  cases: {
    name: string;
    now: string;
    tz: string;
    estimates: Record<CardKind, number>;
    remaining_seconds: number;
    new_cards_left: number;
    cards: QueueFixtureCard[];
    expected: {
      items: { id: string; group: string; estimate_seconds: number }[];
      estimated_seconds: number;
      more_due: boolean;
    };
  }[];
}

describe('Tageswarteschlange (queue.json)', () => {
  const fixture = load<QueueFixture>('queue.json');

  it('die Testfälle sind vorhanden', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(10);
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      const cards: QueueCandidate[] = c.cards.map((card) => ({ ...card, due: new Date(card.due) }));
      const result = selectQueue({
        now: new Date(c.now),
        tz: c.tz,
        estimates: c.estimates,
        remainingSeconds: c.remaining_seconds,
        newCardsLeft: c.new_cards_left,
        cards,
      });
      expect(result.items).toEqual(c.expected.items);
      expect(result.estimatedSeconds).toBe(c.expected.estimated_seconds);
      expect(result.moreDue).toBe(c.expected.more_due);
    });
  }
});

describe('Tageswarteschlange: Grenzen', () => {
  const base = {
    now: new Date('2026-11-13T10:00:00Z'),
    tz: 'Europe/Zurich',
    estimates: { basic: 5, cloze: 5 },
    newCardsLeft: 20,
  };
  const card = (id: string, over: Partial<QueueCandidate> = {}): QueueCandidate => ({
    id,
    concept: `k-${id}`,
    kind: 'basic',
    state: 'review',
    due: new Date('2026-11-13T08:00:00Z'),
    r: 0.8,
    exam_relevant: false,
    suspended: false,
    ...over,
  });

  it('höchstens 500 Karten, der Rest zählt für more_due', () => {
    const cards = Array.from({ length: 520 }, (_, i) => card(`c${String(i).padStart(4, '0')}`));
    const result = selectQueue({ ...base, remainingSeconds: 100_000, cards });
    expect(result.items).toHaveLength(500);
    expect(result.moreDue).toBe(true);
  });

  it('angefangene Karten stehen vor den fälligen, auch wenn die Höchstzahl knapp wird', () => {
    const cards = [
      ...Array.from({ length: 5 }, (_, i) => card(`r${i}`)),
      card('l1', { state: 'learning' }),
      card('l2', { state: 'relearning' }),
    ];
    const result = selectQueue({ ...base, remainingSeconds: 100_000, cards, maxItems: 3 });
    expect(result.items.map((item) => item.id)).toEqual(['l1', 'l2', 'r0']);
  });

  it('pausierte und erst morgen fällige Karten kommen nie hinein', () => {
    const cards = [
      card('a', { suspended: true }),
      card('b', { due: new Date('2026-11-14T08:00:00Z') }),
      card('c'),
    ];
    const result = selectQueue({ ...base, remainingSeconds: 600, cards });
    expect(result.items.map((item) => item.id)).toEqual(['c']);
    expect(result.moreDue).toBe(false);
  });

  it('new_cards_left = 0 lässt keine neue Karte zu und zählt nicht für more_due', () => {
    const cards = [card('n1', { state: 'new', r: null })];
    const result = selectQueue({ ...base, remainingSeconds: 600, newCardsLeft: 0, cards });
    expect(result.items).toEqual([]);
    expect(result.moreDue).toBe(false);
  });
});
