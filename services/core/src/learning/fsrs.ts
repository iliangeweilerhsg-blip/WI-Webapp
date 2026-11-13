// Abbildung zwischen dem Zustand in Datenbank und API (`CardState`, Text und ISO-Zeiten) und dem Kartentyp von
// `ts-fsrs` (Zahl und `Date`), dazu der eine Rechenschritt einer Bewertung (VERTRAEGE §21.5).
import { Rating, State, type Card as FsrsCard, type FSRS, type Grade } from 'ts-fsrs';
import type { CardState, FsrsState, ReviewRating } from '@sg/shared';

const STATE_TO_TEXT: Record<State, FsrsState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

const TEXT_TO_STATE: Record<FsrsState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

/** Zeit als ISO-Text mit `Z`, Millisekunden nur, wenn sie nicht 0 sind (VERTRAEGE §6) */
function iso(date: Date): string {
  return date.toISOString().replace(/\.000Z$/, 'Z');
}

/** Zustand in der Form der Datenbank (`Date`) */
export interface CardStateRecord {
  state: FsrsState;
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  lastReview: Date | null;
}

/** Neuer Zustand einer Karte: wie `createEmptyCard` von `ts-fsrs` (§21.1) */
export function emptyCardState(now: Date): CardStateRecord {
  return {
    state: 'new',
    due: now,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    lastReview: null,
  };
}

/** Zustand als Karte für `ts-fsrs` (`last_review` fehlt dort bei neuen Karten) */
export function toFsrsCard(record: CardStateRecord): FsrsCard {
  return {
    due: record.due,
    stability: record.stability,
    difficulty: record.difficulty,
    elapsed_days: record.elapsedDays,
    scheduled_days: record.scheduledDays,
    learning_steps: record.learningSteps,
    reps: record.reps,
    lapses: record.lapses,
    state: TEXT_TO_STATE[record.state],
    ...(record.lastReview ? { last_review: record.lastReview } : {}),
  };
}

/** Karte von `ts-fsrs` als Zustand der Datenbank */
export function fromFsrsCard(card: FsrsCard): CardStateRecord {
  return {
    state: STATE_TO_TEXT[card.state],
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.last_review ?? null,
  };
}

/** Zustand in der Form der API und des `review_log` (`CardState`) */
export function toApiCardState(record: CardStateRecord): CardState {
  return {
    state: record.state,
    due: iso(record.due),
    stability: record.stability,
    difficulty: record.difficulty,
    elapsed_days: record.elapsedDays,
    scheduled_days: record.scheduledDays,
    learning_steps: record.learningSteps,
    reps: record.reps,
    lapses: record.lapses,
    last_review: record.lastReview ? iso(record.lastReview) : null,
  };
}

/** Der neue Zustand nach einer Bewertung zur Zeit `now` (Uhr des Core, nie vom Client): `fsrs.next(card, now, rating)` */
export function applyRating(
  scheduler: FSRS,
  before: CardStateRecord,
  now: Date,
  rating: ReviewRating,
): CardStateRecord {
  const grade: Grade =
    rating === 1 ? Rating.Again : rating === 2 ? Rating.Hard : rating === 3 ? Rating.Good : Rating.Easy;
  return fromFsrsCard(scheduler.next(toFsrsCard(before), now, grade).card);
}

/** Abrufwahrscheinlichkeit `R` jetzt (0..1). Neue Karten haben `R = 0` (06 §2.1) */
export function retrievability(scheduler: FSRS, record: CardStateRecord, now: Date): number {
  if (record.state === 'new') return 0;
  return scheduler.get_retrievability(toFsrsCard(record), now, false);
}
