// Wiederholung (VERTRAEGE §21.4, §21.5). Ticket B2. Keine Route trägt `config.sgAccess`.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { FSRS } from 'ts-fsrs';
import { z } from 'zod';
import {
  ApiErrorSchema,
  ReviewQueueSchema,
  ReviewRequestSchema,
  ReviewResultSchema,
  UuidSchema,
} from '@sg/shared';
import type { Db } from '../db/client.ts';
import { BUDGET_MINUTES_RANGE, EXTRA_MINUTES_RANGE } from '../learning/params.ts';
import { getReviewQueue, submitReview, type ReviewDeps } from '../services/review.ts';

export interface ReviewRouteDeps {
  db: Db;
  scheduler: FSRS;
  /** Uhr des Core. Standard: Systemzeit */
  now?: () => Date;
  /** Ortszeit des Macs für den Lerntag (IANA-Name) */
  tz: string;
}

const IdParams = z.object({ id: UuidSchema });

const QueueQuery = z.object({
  budget_minutes: z.coerce
    .number()
    .int()
    .min(BUDGET_MINUTES_RANGE.min)
    .max(BUDGET_MINUTES_RANGE.max)
    .optional(),
  extra_minutes: z.coerce.number().int().min(EXTRA_MINUTES_RANGE.min).max(EXTRA_MINUTES_RANGE.max).optional(),
});

export async function reviewRoutes(app: FastifyInstance, deps: ReviewRouteDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { db } = deps;
  const reviewDeps: ReviewDeps = {
    scheduler: deps.scheduler,
    now: deps.now ?? (() => new Date()),
    tz: deps.tz,
  };

  typed.get(
    '/review/queue',
    {
      schema: {
        tags: ['Wiederholung'],
        summary:
          'Der Block für heute (F-LRN-03): Zeitbudget (`budget_minutes` oder Einstellung) plus `extra_minutes`. Ohne Zahl der insgesamt fälligen Karten',
        querystring: QueueQuery,
        response: { 200: ReviewQueueSchema, 400: ApiErrorSchema },
      },
    },
    async (request) =>
      getReviewQueue(db, reviewDeps, {
        budgetMinutes: request.query.budget_minutes,
        extraMinutes: request.query.extra_minutes,
      }),
  );

  typed.post(
    '/cards/:id/review',
    {
      schema: {
        tags: ['Wiederholung'],
        summary:
          'Karte bewerten (1 bis 4). Idempotent über die Client-`id`. 404 `card_not_found`, 409 `card_suspended`, 409 `review_exists`',
        params: IdParams,
        body: ReviewRequestSchema,
        response: { 200: ReviewResultSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request) => submitReview(db, reviewDeps, request.params.id, request.body),
  );
}
