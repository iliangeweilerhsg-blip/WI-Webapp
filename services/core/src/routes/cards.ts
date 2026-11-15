// Karten (VERTRAEGE §21.4). Ticket B2. Keine Route trägt `config.sgAccess`: lokal und aus dem Netz mit Geräte-Token
// wie die übrigen (§5). `Idempotency-Key` gilt für `POST /cards` (08 §1, Plugin `idempotency`).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  CardBulkRequestSchema,
  CardBulkResultSchema,
  CardCreateSchema,
  CardKindSchema,
  CardListSchema,
  CardListSortSchema,
  CardListStatusSchema,
  CardOriginSchema,
  CardPageSchema,
  CardSchema,
  CardUpdateSchema,
  UuidSchema,
} from '@sg/shared';
import type { Db } from '../db/client.ts';
import { PageQuerySchema } from '../lib/pagination.ts';
import { bulkCards, listCards } from '../services/cards-list.ts';
import { createCard, getCard, listConceptCards, updateCard } from '../services/cards.ts';
import { softDeleteWithOps } from '../services/trash-ops.ts';

export interface CardRouteDeps {
  db: Db;
  /** Uhr des Core (`due` einer neuen Karte). Standard: Systemzeit */
  now?: () => Date;
}

const IdParams = z.object({ id: UuidSchema });

const CardListQuerySchema = PageQuerySchema.extend({
  module_id: UuidSchema.optional(),
  concept_id: UuidSchema.optional(),
  // `kind` mehrfach: ?kind=basic&kind=cloze (wie bei GET /inbox)
  kind: z
    .preprocess(
      (value) => (value === undefined || Array.isArray(value) ? value : [value]),
      z.array(CardKindSchema).max(10),
    )
    .optional(),
  origin: CardOriginSchema.optional(),
  status: CardListStatusSchema.default('alle'),
  q: z.string().min(1).max(100).optional(),
  sort: CardListSortSchema.default('neu'),
});

export async function cardRoutes(app: FastifyInstance, deps: CardRouteDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  typed.get(
    '/cards',
    {
      schema: {
        tags: ['Karten'],
        summary:
          'Karten verwalten (§21.14): Karten aktiver Konzepte mit Filtern (module_id, concept_id, kind, origin, status), Suche q und Sortierung neu | faellig | schwer. Ohne Gesamtzahl. 400 `validation_failed`, 400 `invalid_cursor`',
        querystring: CardListQuerySchema,
        response: { 200: CardPageSchema, 400: ApiErrorSchema },
      },
    },
    async (request) =>
      listCards(db, {
        moduleId: request.query.module_id,
        conceptId: request.query.concept_id,
        kinds: request.query.kind,
        origin: request.query.origin,
        status: request.query.status,
        q: request.query.q,
        sort: request.query.sort,
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
  );

  typed.post(
    '/cards/bulk',
    {
      schema: {
        tags: ['Karten'],
        summary:
          'Mehrere Karten pausieren, fortsetzen oder löschen (§21.14, eine Transaktion). Nicht Geändertes steht in `skipped` (`unchanged`, `card_not_found`). 400 `validation_failed` (u. a. doppelte IDs)',
        body: CardBulkRequestSchema,
        response: { 200: CardBulkResultSchema, 400: ApiErrorSchema },
      },
    },
    async (request) => bulkCards(db, request.body),
  );

  typed.get(
    '/concepts/:id/cards',
    {
      schema: {
        tags: ['Karten'],
        summary:
          'Alle nicht gelöschten Karten eines Konzepts, auch pausierte, älteste zuerst (höchstens 500). 404 `concept_not_found`',
        params: IdParams,
        response: { 200: CardListSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => listConceptCards(db, request.params.id),
  );

  typed.get(
    '/cards/:id',
    {
      schema: {
        tags: ['Karten'],
        summary: 'Eine Karte mit Zustand. 404 `card_not_found`, auch für gelöschte',
        params: IdParams,
        response: { 200: CardSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => getCard(db, request.params.id),
  );

  typed.post(
    '/cards',
    {
      schema: {
        tags: ['Karten'],
        summary:
          'Karte von Hand anlegen (mit Beleg, origin = manuell). 404 `concept_not_found`, 409 `concept_not_active`, 409 `card_exists`, 400 `card_invalid`, 400 `card_source_invalid`',
        body: CardCreateSchema,
        response: {
          201: CardSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => reply.code(201).send(await createCard(db, request.body, now())),
  );

  typed.patch(
    '/cards/:id',
    {
      schema: {
        tags: ['Karten'],
        summary:
          'Karte ändern: Inhalt, Belege, pausieren bzw. fortsetzen. Der FSRS-Zustand bleibt. 404 `card_not_found`, 400 `validation_failed` (kein Feld), 400 `card_invalid`, 400 `card_source_invalid`',
        params: IdParams,
        body: CardUpdateSchema,
        response: { 200: CardSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => updateCard(db, request.params.id, request.body),
  );

  typed.delete(
    '/cards/:id',
    {
      schema: {
        tags: ['Karten'],
        summary:
          'Karte löschen (Papierkorb, 204). „Rückgängig“ über `POST /trash/{id}/restore`. 404 `card_not_found`',
        params: IdParams,
        response: { 204: z.null().describe('Gelöscht'), 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      await softDeleteWithOps(db, 'card', request.params.id);
      return reply.code(204).send(null);
    },
  );
}
