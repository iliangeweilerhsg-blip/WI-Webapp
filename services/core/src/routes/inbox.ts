// Inbox (VERTRAEGE §20.6, F-NAC-06). Ticket T2-22b. Lokal und aus dem Netz (mit Token) wie die übrigen Routen.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  InboxAcceptRequestSchema,
  InboxBulkRequestSchema,
  InboxBulkResultSchema,
  InboxDecisionResultSchema,
  InboxItemListSchema,
  InboxKindSchema,
  InboxOverviewSchema,
  UuidSchema,
} from '@sg/shared';
import type { Db } from '../db/client.ts';
import { PageQuerySchema } from '../lib/pagination.ts';
import { bulkInbox, decideInboxItem, getInboxOverview, listInbox } from '../services/inbox.ts';

export interface InboxRouteDeps {
  db: Db;
}

const IdParams = z.object({ id: UuidSchema });

const InboxQuerySchema = PageQuerySchema.extend({
  status: z.enum(['offen', 'entschieden', 'alle']).default('offen'),
  session_id: UuidSchema.optional(),
  // `kind` mehrfach: ?kind=concept_new&kind=relation
  kind: z
    .preprocess(
      (value) => (value === undefined || Array.isArray(value) ? value : [value]),
      z.array(InboxKindSchema).max(10),
    )
    .optional(),
});

const decisionErrors = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  503: ApiErrorSchema,
};

export async function inboxRoutes(app: FastifyInstance, deps: InboxRouteDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { db } = deps;

  typed.get(
    '/inbox',
    {
      schema: {
        tags: ['Inbox'],
        summary: 'Vorschläge der KI, neueste zuerst (F-NAC-06)',
        querystring: InboxQuerySchema,
        response: { 200: InboxItemListSchema, 400: ApiErrorSchema },
      },
    },
    async (request) =>
      listInbox(db, {
        status: request.query.status,
        sessionId: request.query.session_id,
        kinds: request.query.kind,
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
  );

  typed.get(
    '/inbox/overview',
    {
      schema: {
        tags: ['Inbox'],
        summary: 'Zähler für die Navigation und Gruppen je Vorlesung',
        response: { 200: InboxOverviewSchema },
      },
    },
    async () => getInboxOverview(db),
  );

  typed.post(
    '/inbox/:id/accept',
    {
      schema: {
        tags: ['Inbox'],
        summary: 'Vorschlag annehmen: neues Konzept, zusammenführen oder Beziehung bestätigen',
        params: IdParams,
        body: InboxAcceptRequestSchema.nullish(),
        response: { 200: InboxDecisionResultSchema, ...decisionErrors },
      },
    },
    async (request) => decideInboxItem(db, request.params.id, 'accept', request.body ?? {}),
  );

  typed.post(
    '/inbox/:id/reject',
    {
      schema: {
        tags: ['Inbox'],
        summary: 'Vorschlag ablehnen',
        params: IdParams,
        response: { 200: InboxDecisionResultSchema, ...decisionErrors },
      },
    },
    async (request) => decideInboxItem(db, request.params.id, 'reject'),
  );

  typed.post(
    '/inbox/:id/reopen',
    {
      schema: {
        tags: ['Inbox'],
        summary: 'Entscheidung rückgängig machen (R15)',
        params: IdParams,
        response: { 200: InboxDecisionResultSchema, ...decisionErrors },
      },
    },
    async (request) => decideInboxItem(db, request.params.id, 'reopen'),
  );

  typed.post(
    '/inbox/bulk',
    {
      schema: {
        tags: ['Inbox'],
        summary: 'Mehrere Einträge annehmen, ablehnen oder wieder öffnen',
        body: InboxBulkRequestSchema,
        response: {
          200: InboxBulkResultSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request) => bulkInbox(db, request.body),
  );
}
