// Sessions: REST (VERTRAEGE §7.2, §9). Zustandswechsel kommen aus der Web-App per REST; das iPad nutzt die Sync-Operationen.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  SessionCreateSchema,
  SessionExtendRequestSchema,
  SessionListSchema,
  SessionSchema,
  SessionSnapshotSchema,
  SessionStartRequestSchema,
  SessionStartResultSchema,
  SessionStateSchema,
  SessionStopRequestSchema,
  SessionUpdateSchema,
  UuidSchema,
  type SessionState,
} from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { HttpError } from '../errors.ts';
import { PageQuerySchema } from '../lib/pagination.ts';
import {
  createSession,
  deleteSession,
  extendSession,
  getSession,
  getSessionSnapshot,
  listSessions,
  requireSession,
  transitionSession,
  updateSession,
} from '../services/sessions.ts';

export interface SessionRouteDeps {
  db: Db;
  config: Pick<Config, 'dataDir'>;
  /** Uhr für Start, Stopp und Verlängern. Standard: Systemzeit. Tests setzen eine feste Zeit */
  now?: () => Date;
}

const IdParams = z.object({ id: UuidSchema });

const isoDate = z.string().datetime({ offset: true });

const SessionsQuery = PageQuerySchema.extend({
  module_id: UuidSchema.optional(),
  /** Komma-Liste, z. B. `laeuft,pausiert` */
  state: z
    .string()
    .optional()
    .transform((value, ctx): SessionState[] | undefined => {
      if (value === undefined || value === '') return undefined;
      const states: SessionState[] = [];
      for (const part of value.split(',')) {
        const parsed = SessionStateSchema.safeParse(part.trim());
        if (!parsed.success) {
          ctx.addIssue({ code: 'custom', message: `Unbekannter Zustand: ${part}` });
          return z.NEVER;
        }
        states.push(parsed.data);
      }
      return states;
    }),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export async function sessionRoutes(app: FastifyInstance, deps: SessionRouteDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { db, config } = deps;
  const now = deps.now ?? (() => new Date());

  typed.get(
    '/sessions',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Sessions auflisten, aufsteigend nach Startzeit bzw. geplantem Beginn',
        querystring: SessionsQuery,
        response: { 200: SessionListSchema, 400: ApiErrorSchema },
      },
    },
    async (request) =>
      listSessions(db, {
        moduleId: request.query.module_id,
        states: request.query.state,
        from: request.query.from ? new Date(request.query.from) : undefined,
        to: request.query.to ? new Date(request.query.to) : undefined,
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
  );

  typed.post(
    '/sessions',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Spontane Session anlegen (Zustand `bereit`, F-SES-04)',
        body: SessionCreateSchema,
        response: { 201: SessionSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const created = await db.transaction((tx) =>
        createSession(tx, {
          id: request.body.id,
          moduleId: request.body.module_id,
          slideDeckId: request.body.slide_deck_id,
          title: request.body.title,
        }),
      );
      return reply.code(201).send(created);
    },
  );

  typed.get(
    '/sessions/:id',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Session lesen',
        params: IdParams,
        response: { 200: SessionSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => getSession(db, request.params.id),
  );

  typed.patch(
    '/sessions/:id',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Titel und Foliensatz ändern',
        params: IdParams,
        body: SessionUpdateSchema,
        response: { 200: SessionSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => db.transaction((tx) => updateSession(tx, request.params.id, request.body)),
  );

  typed.delete(
    '/sessions/:id',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Session in den Papierkorb legen (nicht, solange sie läuft oder pausiert)',
        params: IdParams,
        response: { 204: z.null(), 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      await db.transaction((tx) => deleteSession(tx, request.params.id));
      return reply.code(204).send(null);
    },
  );

  typed.get(
    '/sessions/:id/snapshot',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Live-Stand einer Session samt Position im Sync-Strom',
        params: IdParams,
        response: { 200: SessionSnapshotSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => getSessionSnapshot(db, request.params.id),
  );

  typed.post(
    '/sessions/:id/start',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Session starten (Serverzeit). Eine andere aktive Session wird beendet',
        params: IdParams,
        body: SessionStartRequestSchema,
        response: {
          200: SessionStartResultSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request) =>
      db.transaction(async (tx) => {
        const stamp = now();
        await requireSession(tx, request.params.id);
        const result = await transitionSession(tx, request.params.id, 'start', {
          at: stamp,
          now: stamp,
          origin: 'server',
          startedFrom: request.body.started_from,
          ...(request.body.slide_deck_id ? { slideDeckId: request.body.slide_deck_id } : {}),
        });
        return { session: result.session, ended_session: result.endedSession };
      }),
  );

  for (const action of ['pause', 'resume'] as const) {
    typed.post(
      `/sessions/:id/${action}`,
      {
        schema: {
          tags: ['Sessions'],
          summary: action === 'pause' ? 'Session pausieren' : 'Pausierte Session fortsetzen',
          params: IdParams,
          response: { 200: SessionSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
        },
      },
      async (request) =>
        db.transaction(async (tx) => {
          const stamp = now();
          await requireSession(tx, request.params.id);
          return (
            await transitionSession(tx, request.params.id, action, {
              at: stamp,
              now: stamp,
              origin: 'server',
            })
          ).session;
        }),
    );
  }

  typed.post(
    '/sessions/:id/stop',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Session beenden. Ohne `reason`: manuell',
        params: IdParams,
        body: SessionStopRequestSchema.nullish(),
        response: { 200: SessionSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request) => {
      const reason = request.body?.reason;
      if (reason === 'absturz_wiederhergestellt') {
        throw new HttpError(400, 'validation_failed', 'Dieser Grund wird nur vom Core gesetzt.', {
          in: 'body',
          issues: [{ path: 'reason', message: 'absturz_wiederhergestellt setzt nur der Core' }],
        });
      }
      return db.transaction(async (tx) => {
        const stamp = now();
        await requireSession(tx, request.params.id);
        return (
          await transitionSession(tx, request.params.id, 'stop', {
            at: stamp,
            now: stamp,
            origin: 'server',
            ...(reason ? { reason } : {}),
          })
        ).session;
      });
    },
  );

  typed.post(
    '/sessions/:id/extend',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Auto-Stopp aufschieben („weiter aufnehmen“, F-SES-03)',
        params: IdParams,
        body: SessionExtendRequestSchema.nullish(),
        response: { 200: SessionSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request) =>
      db.transaction((tx) => extendSession(tx, request.params.id, request.body?.minutes, config, now())),
  );
}
