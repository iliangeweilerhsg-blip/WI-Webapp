// Bewertung einer Karte und Tageswarteschlange (VERTRAEGE §21.4, §21.5). Ticket B2.
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { FSRS } from 'ts-fsrs';
import {
  SINGLE_USER_ID,
  type CardKind,
  type ReviewQueue,
  type ReviewQueueItem,
  type ReviewRating,
  type ReviewRequest,
  type ReviewResult,
} from '@sg/shared';
import type { Db, DbOrTx } from '../db/client.ts';
import { card, cardState, concept, notDeleted, reviewLog } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { learnDay } from '../learning/day.ts';
import { applyRating, retrievability, toApiCardState } from '../learning/fsrs.ts';
import {
  ESTIMATE_BOUNDS_SECONDS,
  ESTIMATE_DEFAULT_SECONDS,
  ESTIMATE_MIN_SAMPLES,
  ESTIMATE_SAMPLE_SIZE,
  REVIEW_TIME_CAP_MS,
} from '../learning/params.ts';
import { selectQueue, type QueueCandidate } from '../learning/queue.ts';
import { loadApiCard, loadApiCards, selectCards, stateRecord, uniqueViolation } from './cards.ts';
import { isoTs } from './sessions.ts';
import { getLearningSettings } from './settings.ts';

export interface ReviewDeps {
  scheduler: FSRS;
  /** Uhr des Core. Die Zeit einer Bewertung kommt immer von hier, nie vom Client */
  now: () => Date;
  /** IANA-Name der Ortszeit des Macs (Lerntag, §21.5) */
  tz: string;
}

// --- Bewertung ----------------------------------------------------------------------------------

const cardNotFound = () =>
  new HttpError(404, 'card_not_found', 'Die Karte gibt es nicht oder sie ist gelöscht.');
const reviewExists = () =>
  new HttpError(
    409,
    'review_exists',
    'Diese Bewertungs-ID gibt es schon, aber für eine andere Karte oder mit einer anderen Bewertung.',
  );

/**
 * `POST /cards/{id}/review` (§21.4): Selbstbewertung 1 bis 4. Eine Transaktion: `card_state` `FOR UPDATE` sperren, Karte
 * prüfen (gelöscht → 404, pausiert → 409 `card_suspended`), neuen Zustand rechnen, `card_state` schreiben und `review_log`
 * einfügen. Idempotent über `body.id`: dieselbe Bewertung noch einmal gibt 200 mit dem heutigen Stand der Karte und ändert
 * nichts, dieselbe `id` mit anderer Karte oder anderem `rating` gibt `409 review_exists`. Geprüft wird unter der Sperre.
 */
export async function submitReview(
  db: Db,
  deps: ReviewDeps,
  cardId: string,
  body: ReviewRequest,
): Promise<ReviewResult> {
  const now = deps.now();
  try {
    return await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ state: cardState, suspended: card.suspended })
        .from(cardState)
        .innerJoin(card, eq(card.id, cardState.cardId))
        .where(and(eq(cardState.cardId, cardId), notDeleted(cardState), notDeleted(card)))
        .for('update', { of: cardState });
      if (!locked) throw cardNotFound();

      const [existing] = await tx.select().from(reviewLog).where(eq(reviewLog.id, body.id));
      if (existing) {
        if (existing.cardId !== cardId || existing.rating !== body.rating) throw reviewExists();
        const current = await loadApiCard(tx, cardId);
        if (!current) throw cardNotFound();
        return {
          review: {
            id: existing.id,
            card_id: existing.cardId,
            reviewed_at: isoTs(existing.reviewedAt),
            rating: existing.rating as ReviewRating,
            duration_ms: existing.durationMs,
          },
          card: current,
          requeue: new Date(current.state.due).getTime() < learnDay(now, deps.tz).endsAt.getTime(),
        };
      }
      if (locked.suspended) {
        throw new HttpError(409, 'card_suspended', 'Die Karte ist pausiert und lässt sich nicht bewerten.');
      }

      const before = stateRecord(locked.state);
      const after = applyRating(deps.scheduler, before, now, body.rating);
      await tx
        .update(cardState)
        .set({
          state: after.state,
          due: after.due,
          stability: after.stability,
          difficulty: after.difficulty,
          elapsedDays: after.elapsedDays,
          scheduledDays: after.scheduledDays,
          learningSteps: after.learningSteps,
          reps: after.reps,
          lapses: after.lapses,
          lastReview: after.lastReview,
        })
        .where(eq(cardState.id, locked.state.id));
      await tx.insert(reviewLog).values({
        id: body.id,
        userId: SINGLE_USER_ID,
        cardId,
        reviewedAt: now,
        rating: body.rating,
        ratingSource: 'nutzer',
        durationMs: body.duration_ms,
        context: 'taeglich',
        stateBefore: toApiCardState(before),
        stateAfter: toApiCardState(after),
      });
      const current = await loadApiCard(tx, cardId);
      if (!current) throw cardNotFound();
      return {
        review: {
          id: body.id,
          card_id: cardId,
          reviewed_at: isoTs(now),
          rating: body.rating,
          duration_ms: body.duration_ms,
        },
        card: current,
        requeue: after.due.getTime() < learnDay(now, deps.tz).endsAt.getTime(),
      };
    });
  } catch (error) {
    // Dieselbe `id` für zwei verschiedene Karten gleichzeitig: Die zweite Transaktion scheitert am Primärschlüssel
    if (uniqueViolation(error) === 'review_log_pkey') throw reviewExists();
    throw error;
  }
}

// --- Warteschlange ------------------------------------------------------------------------------

export interface QueueOptions {
  /** 1–240, sonst `learning.review_budget_minutes` */
  budgetMinutes?: number | undefined;
  /** 0–120, Standard 0 */
  extraMinutes?: number | undefined;
}

/** Median einer Liste (bei gerader Länge der Mittelwert der beiden mittleren) */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Geschätzte Sekunden je Kartentyp (§21.5): Median von `min(duration_ms, 120 000)` der letzten 200 nicht gelöschten
 * Bewertungen von Karten dieses Typs, auf ganze Sekunden gerundet und auf 5 bis 60 s begrenzt. Bei weniger als
 * 20 Bewertungen die Startwerte.
 */
async function loadEstimates(db: DbOrTx): Promise<Record<CardKind, number>> {
  const estimates: Record<CardKind, number> = { ...ESTIMATE_DEFAULT_SECONDS };
  for (const kind of ['basic', 'cloze'] as const) {
    const rows = await db.execute<{ ms: number }>(
      sql`SELECT least(rl.duration_ms, ${REVIEW_TIME_CAP_MS})::int AS ms
          FROM review_log rl JOIN card c ON c.id = rl.card_id
          WHERE rl.deleted_at IS NULL AND c.kind = ${kind}
          ORDER BY rl.reviewed_at DESC, rl.id DESC
          LIMIT ${ESTIMATE_SAMPLE_SIZE}`,
    );
    if (rows.length < ESTIMATE_MIN_SAMPLES) continue;
    const seconds = Math.round(median(rows.map((r) => r.ms)) / 1000);
    estimates[kind] = Math.min(ESTIMATE_BOUNDS_SECONDS.max, Math.max(ESTIMATE_BOUNDS_SECONDS.min, seconds));
  }
  return estimates;
}

/**
 * `GET /review/queue` (§21.5, F-LRN-03): der Block für heute. Budget aus der Anfrage oder den Einstellungen plus
 * `extra_minutes`, minus die heute verbrauchte Zeit. Nennt nie, wie viele Karten insgesamt fällig sind (LP9).
 */
export async function getReviewQueue(
  db: Db,
  deps: ReviewDeps,
  options: QueueOptions = {},
): Promise<ReviewQueue> {
  const now = deps.now();
  const today = learnDay(now, deps.tz);
  const settings = await getLearningSettings(db);
  const budgetMinutes = options.budgetMinutes ?? settings.review_budget_minutes;
  const extraMinutes = options.extraMinutes ?? 0;

  // Heute: Bewertungen des Lerntags (nicht gelöscht)
  const range = sql`rl.deleted_at IS NULL AND rl.reviewed_at >= ${today.startsAt.toISOString()}::timestamptz
                    AND rl.reviewed_at < ${today.endsAt.toISOString()}::timestamptz`;
  const [spent] = await db.execute<{ n: number; ms: string; started: number }>(
    sql`SELECT count(*)::int AS n,
               coalesce(sum(least(rl.duration_ms, ${REVIEW_TIME_CAP_MS})), 0)::text AS ms,
               count(DISTINCT rl.card_id) FILTER (WHERE rl.state_before->>'state' = 'new')::int AS started
        FROM review_log rl WHERE ${range}`,
  );
  const reviewedToday = spent?.n ?? 0;
  const usedSeconds = Math.round(Number(spent?.ms ?? '0') / 1000);
  const remainingSeconds = Math.max(0, (budgetMinutes + extraMinutes) * 60 - usedSeconds);
  const newCardsLeft = Math.max(0, settings.new_cards_per_day - (spent?.started ?? 0));

  const estimates = await loadEstimates(db);

  // Kandidaten: nicht gelöscht, nicht pausiert, Konzept nicht gelöscht, heute fällig
  const rows = await db
    .select({
      id: card.id,
      kind: card.kind,
      suspended: card.suspended,
      state: cardState,
      conceptId: concept.id,
      conceptName: concept.name,
      examRelevant: concept.examRelevant,
    })
    .from(card)
    .innerJoin(cardState, eq(cardState.cardId, card.id))
    .innerJoin(concept, eq(concept.id, card.conceptId))
    .where(
      and(
        notDeleted(card),
        notDeleted(cardState),
        notDeleted(concept),
        eq(card.suspended, false),
        lt(cardState.due, today.endsAt),
      ),
    );
  const conceptOf = new Map(
    rows.map((r) => [r.id, { id: r.conceptId, name: r.conceptName, exam_relevant: r.examRelevant }]),
  );
  const candidates: QueueCandidate[] = rows.map((r) => {
    const record = stateRecord(r.state);
    return {
      id: r.id,
      concept: r.conceptId,
      kind: r.kind as CardKind,
      state: record.state,
      due: record.due,
      r: record.state === 'new' ? null : retrievability(deps.scheduler, record, now),
      exam_relevant: r.examRelevant,
      suspended: r.suspended,
    };
  });

  const selection = selectQueue({
    now,
    tz: deps.tz,
    estimates,
    remainingSeconds,
    newCardsLeft,
    cards: candidates,
  });

  // Die ausgewählten Karten vollständig laden (höchstens 500), in Anzeige-Reihenfolge
  const ids = selection.items.map((item) => item.id);
  const loaded = new Map(
    (await loadApiCards(db, ids.length === 0 ? [] : await selectCards(db, inArray(card.id, ids)))).map(
      (c) => [c.id, c],
    ),
  );
  const items: ReviewQueueItem[] = [];
  for (const pick of selection.items) {
    const full = loaded.get(pick.id);
    const conceptRef = conceptOf.get(pick.id);
    // Eine Karte, die zwischen den Abfragen gelöscht wurde, entfällt still
    if (!full || !conceptRef) continue;
    items.push({
      card: full,
      concept: conceptRef,
      group: pick.group,
      estimate_seconds: pick.estimate_seconds,
    });
  }

  let hasCards = candidates.length > 0;
  if (!hasCards) {
    const [any] = await db.select({ id: card.id }).from(card).where(isNull(card.deletedAt)).limit(1);
    hasCards = Boolean(any);
  }

  return {
    day: today.day,
    day_ends_at: isoTs(today.endsAt),
    generated_at: isoTs(now),
    budget_minutes: budgetMinutes,
    used_seconds: usedSeconds,
    estimated_seconds: items.reduce((total, item) => total + item.estimate_seconds, 0),
    reviewed_today: reviewedToday,
    items,
    more_due: selection.moreDue,
    has_cards: hasCards,
  };
}
