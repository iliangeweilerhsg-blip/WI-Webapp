// VERTRAEGE §21.5: Konstanten und FSRS-Abgleich. Die Zahlen stehen hier ein zweites Mal, damit eine Änderung in
// `params.ts` nur zusammen mit dem Vertrag möglich ist (06, Einleitung).
import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import {
  applyRating,
  emptyCardState,
  fromFsrsCard,
  retrievability,
  toApiCardState,
  toFsrsCard,
} from '../../src/learning/fsrs.ts';
import * as params from '../../src/learning/params.ts';

describe('Konstanten (§21.5)', () => {
  it('haben die Werte des Vertrags', () => {
    expect(params.REQUEST_RETENTION).toBe(0.9);
    expect(params.MAXIMUM_INTERVAL_DAYS).toBe(365);
    expect(params.ENABLE_FUZZ).toBe(true);
    expect(params.LEARN_DAY_START_HOUR).toBe(4);
    expect(params.DEFAULT_REVIEW_BUDGET_MINUTES).toBe(20);
    expect(params.DEFAULT_NEW_CARDS_PER_DAY).toBe(20);
    expect(params.BUDGET_MINUTES_RANGE).toEqual({ min: 1, max: 240 });
    expect(params.EXTRA_MINUTES_RANGE).toEqual({ min: 0, max: 120 });
    expect(params.REVIEW_TIME_CAP_MS).toBe(120_000);
    expect(params.ESTIMATE_SAMPLE_SIZE).toBe(200);
    expect(params.ESTIMATE_MIN_SAMPLES).toBe(20);
    expect(params.ESTIMATE_BOUNDS_SECONDS).toEqual({ min: 5, max: 60 });
    expect(params.ESTIMATE_DEFAULT_SECONDS).toEqual({ basic: 12, cloze: 20 });
    expect(params.NEW_CARD_COST_FACTOR).toBe(3);
    expect(params.EXAM_RELEVANT_FACTOR).toBe(1.5);
    expect(params.OVERDUE_WEIGHT).toBe(0.1);
    expect(params.OVERDUE_CAP_DAYS).toBe(10);
    expect(params.PRIORITY_DECIMALS).toBe(6);
    expect(params.QUEUE_MAX_ITEMS).toBe(500);
  });
});

describe('FSRS (ts-fsrs 5)', () => {
  const now = new Date('2026-11-13T10:00:00Z');

  it('Planer: Standardgewichte, Lernschritte der Bibliothek, Streuung an, 365 Tage', () => {
    const scheduler = params.createScheduler();
    expect(scheduler.parameters.enable_fuzz).toBe(true);
    expect(scheduler.parameters.maximum_interval).toBe(365);
    expect(scheduler.parameters.request_retention).toBe(0.9);
    expect(scheduler.parameters.enable_short_term).toBe(true);
    expect(scheduler.parameters.learning_steps).toEqual(['1m', '10m']);
    expect(scheduler.parameters.relearning_steps).toEqual(['10m']);
    expect(scheduler.parameters.w).toHaveLength(21);
    expect(params.createScheduler({ enableFuzz: false }).parameters.enable_fuzz).toBe(false);
  });

  it('neue Karte: wie createEmptyCard, last_review leer', () => {
    const state = emptyCardState(now);
    expect(toApiCardState(state)).toEqual({
      state: 'new',
      due: '2026-11-13T10:00:00Z',
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      learning_steps: 0,
      reps: 0,
      lapses: 0,
      last_review: null,
    });
    expect('last_review' in toFsrsCard(state)).toBe(false);
  });

  it('Gut auf eine neue Karte: erster Lernschritt (10 min), Zustand learning', () => {
    const scheduler = params.createScheduler({ enableFuzz: false });
    const after = applyRating(scheduler, emptyCardState(now), now, 3);
    expect(after.state).toBe('learning');
    expect(after.due.toISOString()).toBe('2026-11-13T10:10:00.000Z');
    expect(after.reps).toBe(1);
    expect(after.lastReview?.toISOString()).toBe(now.toISOString());
  });

  it('Nochmal auf eine neue Karte: eine Minute, nicht Tage', () => {
    const scheduler = params.createScheduler({ enableFuzz: false });
    const after = applyRating(scheduler, emptyCardState(now), now, 1);
    expect(after.due.getTime() - now.getTime()).toBe(60_000);
    expect(after.state).toBe('learning');
  });

  it('Leicht auf eine neue Karte: sofort Wiederholung in Tagen', () => {
    const scheduler = params.createScheduler({ enableFuzz: false });
    const after = applyRating(scheduler, emptyCardState(now), now, 4);
    expect(after.state).toBe('review');
    expect(after.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('die Streuung ist deterministisch: gleiche Karte, gleiche Zeit, gleiche Bewertung, gleiche due', () => {
    const scheduler = params.createScheduler();
    const first = applyRating(scheduler, emptyCardState(now), now, 4);
    const again = applyRating(params.createScheduler(), emptyCardState(now), now, 4);
    expect(again.due.toISOString()).toBe(first.due.toISOString());
    const later = new Date('2026-11-20T10:00:00Z');
    const second = applyRating(scheduler, first, later, 3);
    const secondAgain = applyRating(scheduler, first, later, 3);
    expect(secondAgain.due.toISOString()).toBe(second.due.toISOString());
  });

  it('das Intervall wächst bis 365 Tage und bleibt dort', () => {
    const scheduler = params.createScheduler({ enableFuzz: false });
    let state = applyRating(scheduler, emptyCardState(now), now, 4);
    const intervals: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      state = applyRating(scheduler, state, state.due, 4);
      intervals.push(state.scheduledDays);
    }
    // Die Obergrenze 365 greift (ohne sie wären es viele Jahre). Die Bibliothek verlangt bei pünktlicher Wiederholung
    // einen Tag mehr als die verstrichene Zeit je Stufe (Nochmal < Schwer < Gut < Leicht), darum liegt „Leicht“ danach
    // 1 bis 2 Tage darüber. Das ist Verhalten von ts-fsrs 5.4.2, kein Fehler des Core (PR, „Offene Punkte“).
    expect(intervals.find((days) => days >= 365)).toBe(365);
    expect(Math.max(...intervals)).toBeLessThanOrEqual(365 + 2);
  });

  it('Abbildung hin und zurück verliert nichts; Rating-Zahlen stimmen mit der Bibliothek überein', () => {
    const scheduler = params.createScheduler({ enableFuzz: false });
    const state = applyRating(scheduler, emptyCardState(now), now, 3);
    expect(fromFsrsCard(toFsrsCard(state))).toEqual(state);
    expect([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]).toEqual([1, 2, 3, 4]);
  });

  it('Abrufwahrscheinlichkeit: neu 0, danach zwischen 0 und 1 und fallend', () => {
    const scheduler = params.createScheduler({ enableFuzz: false });
    expect(retrievability(scheduler, emptyCardState(now), now)).toBe(0);
    const state = applyRating(scheduler, emptyCardState(now), now, 4);
    const soon = retrievability(scheduler, state, new Date(now.getTime() + 86_400_000));
    const later = retrievability(scheduler, state, new Date(now.getTime() + 30 * 86_400_000));
    expect(soon).toBeGreaterThan(later);
    expect(soon).toBeLessThanOrEqual(1);
    expect(later).toBeGreaterThan(0);
  });
});
