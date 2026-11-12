// Moodle-Endpunkte (08 §9): Status, Lese-Endpunkte mit Datei-Stream (T1-22) und Aktionen.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  MoodleActionCatalogSchema,
  MoodleActionExecuteSchema,
  MoodleActionPreviewSchema,
  MoodleActionRequestSchema,
  MoodleActionResultSchema,
  MoodleAssignmentListSchema,
  MoodleAutoAssignResultSchema,
  MoodleCourseContentsSchema,
  MoodleCourseLinkListSchema,
  MoodleCourseLinkSchema,
  MoodleCourseLinkUpdateSchema,
  MoodleCourseListSchema,
  MoodleDeadlineListSchema,
  MoodleDiscussionListSchema,
  MoodleForumListSchema,
  MoodleGradeListSchema,
  MoodleItemKindSchema,
  MoodleItemListSchema,
  MoodleItemSchema,
  MoodleItemUpdateSchema,
  MoodleNotificationListSchema,
  MoodlePostListSchema,
  MoodleQuizListSchema,
  MoodleStatusSchema,
  MoodleSubmissionStatusSchema,
  MoodleSyncedDeadlineListSchema,
  MoodleSyncRequestSchema,
  MoodleSyncStatusSchema,
  TimestampSchema,
  UuidSchema,
  type MoodleActionId,
} from '@sg/shared';
import type { Db } from '../db/client.ts';
import { HttpError } from '../errors.ts';
import { isMoodleActionId, needsConfirmation, type MoodleActionContext } from '../moodle/actions.ts';
import { abortWhenClosed } from '../moodle/abort.ts';
import { isValidFileRef, moodleNotConfigured, RequestAbortedError } from '../moodle/client.ts';
import { FILE_ONLY_HEADERS, fileResponseHeaders } from '../moodle/file-headers.ts';
import { autoAssignCourses, removeAutoModule } from '../moodle/auto.ts';
import type { MoodleServices } from '../moodle/index.ts';
import {
  annotateCourses,
  decideItem,
  deleteLink,
  isKnownFileRef,
  listItems,
  listLinks,
  listSyncedDeadlines,
  putLink,
} from '../moodle/store.ts';
import type { MoodleSync } from '../moodle/sync.ts';

export interface MoodleRouteDeps {
  moodle: MoodleServices;
  /** Kurszuordnung und Abgleich (T1-23). Ohne: nur Lese-Endpunkte und Aktionen (Unit-Tests) */
  db?: Db;
  sync?: MoodleSync;
  now?: () => Date;
}

const ActionParamsSchema = z.object({ action_id: z.string().min(1).max(64) });

/** Moodle-ID aus Pfad oder Query: ganze Zahl ≥ 1 */
const MoodleIdParam = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const CourseFilterQuery = z.object({ course_id: MoodleIdParam.optional() });
/** Moodle liefert höchstens 50 Ereignisse bzw. Benachrichtigungen je Aufruf */
const LimitParam = z.coerce.number().int().min(1).max(50);
export const DEFAULT_LIST_LIMIT = 20;
const DeadlinesQuery = z.object({ from: TimestampSchema.optional(), limit: LimitParam.optional() });
const NotificationsQuery = z.object({ limit: LimitParam.optional() });
const FileQuery = z.object({ ref: z.string().min(1).max(2048) });

const errorResponses = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  501: ApiErrorSchema,
  502: ApiErrorSchema,
  503: ApiErrorSchema,
};

export async function moodleRoutes(app: FastifyInstance, deps: MoodleRouteDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { client, status, actions, confirmations, locks, reader, files } = deps.moodle;
  const context: MoodleActionContext = { client, userId: () => status.userId() };

  function actionId(raw: string): MoodleActionId {
    if (!isMoodleActionId(raw)) {
      throw new HttpError(404, 'moodle_action_not_found', `Unbekannte Moodle-Aktion: ${raw}`);
    }
    return raw;
  }

  /** Reihenfolge der Prüfungen: umgesetzt → Parameter → eingerichtet → Moodle-Funktionen freigegeben */
  async function prepare(id: MoodleActionId, rawParams: unknown) {
    const handler = actions.handler(id);
    const params = actions.parseParams(id, rawParams);
    if (!(await client.isConfigured())) throw moodleNotConfigured();
    const missing = actions.missingFunctions(id, await status.availableFunctions());
    if (missing.length > 0) {
      throw new HttpError(
        501,
        'moodle_function_unavailable',
        'Die nötige Moodle-Funktion ist für diesen Zugang nicht freigegeben.',
        { wsfunctions: missing },
      );
    }
    // Risiko aus dem Katalog; ein Handler darf im Einzelfall verschärfen (nie lockern)
    const confirm =
      needsConfirmation(actions.spec(id).risk) ||
      (await handler.requiresConfirmation?.(context, params)) === true;
    return { handler, params, confirm };
  }

  typed.get(
    '/moodle/status',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Zustand des Moodle-Zugangs (F-MDL-01), höchstens alle 5 min von Moodle geprüft',
        response: { 200: MoodleStatusSchema },
      },
    },
    async () => status.getStatus(),
  );

  // ---------- Lese-Endpunkte (F-MDL-02, 08 §9.2) ----------

  typed.get(
    '/moodle/courses',
    {
      schema: {
        tags: ['Moodle'],
        summary:
          'Kurse des Nutzers (core_enrol_get_users_courses). Nur lesend: zugeordnet wird über POST /moodle/auto-assign',
        response: { 200: MoodleCourseListSchema, ...errorResponses },
      },
    },
    async () => {
      const list = await reader.courses();
      if (!deps.db) return list;
      const now = deps.now?.() ?? new Date();
      return { items: await annotateCourses(deps.db, list.items, { timeZone: reader.timeZone, now }) };
    },
  );

  typed.get(
    '/moodle/courses/:course_id/contents',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Kursinhalt: Abschnitte, Aktivitäten, Dateien (core_course_get_contents)',
        params: z.object({ course_id: MoodleIdParam }),
        response: { 200: MoodleCourseContentsSchema, ...errorResponses },
      },
    },
    async (request) => reader.courseContents(request.params.course_id),
  );

  typed.get(
    '/moodle/assignments',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Aufgaben, ohne course_id aus allen Kursen (mod_assign_get_assignments)',
        querystring: CourseFilterQuery,
        response: { 200: MoodleAssignmentListSchema, ...errorResponses },
      },
    },
    async (request) => reader.assignments(request.query.course_id),
  );

  typed.get(
    '/moodle/assignments/:assignment_id/submission',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Abgabestatus einer Aufgabe (mod_assign_get_submission_status)',
        params: z.object({ assignment_id: MoodleIdParam }),
        response: { 200: MoodleSubmissionStatusSchema, ...errorResponses },
      },
    },
    async (request) => reader.submission(request.params.assignment_id),
  );

  typed.get(
    '/moodle/forums',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Foren, ohne course_id aus allen Kursen (mod_forum_get_forums_by_courses)',
        querystring: CourseFilterQuery,
        response: { 200: MoodleForumListSchema, ...errorResponses },
      },
    },
    async (request) => reader.forums(request.query.course_id),
  );

  typed.get(
    '/moodle/forums/:forum_id/discussions',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Diskussionen eines Forums (mod_forum_get_forum_discussions)',
        params: z.object({ forum_id: MoodleIdParam }),
        response: { 200: MoodleDiscussionListSchema, ...errorResponses },
      },
    },
    async (request) => reader.discussions(request.params.forum_id),
  );

  typed.get(
    '/moodle/discussions/:discussion_id/posts',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Beiträge einer Diskussion (mod_forum_get_discussion_posts)',
        params: z.object({ discussion_id: MoodleIdParam }),
        response: { 200: MoodlePostListSchema, ...errorResponses },
      },
    },
    async (request) => reader.posts(request.params.discussion_id),
  );

  typed.get(
    '/moodle/deadlines',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Kommende Fristen ab from (Standard: jetzt), höchstens limit (1–50, Standard 20)',
        querystring: DeadlinesQuery,
        response: { 200: MoodleDeadlineListSchema, ...errorResponses },
      },
    },
    async (request) =>
      reader.deadlines(
        request.query.from ? new Date(request.query.from) : new Date(),
        request.query.limit ?? DEFAULT_LIST_LIMIT,
      ),
  );

  typed.get(
    '/moodle/grades',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Noten, ohne course_id aus allen Kursen (gradereport_user_get_grade_items)',
        querystring: CourseFilterQuery,
        response: { 200: MoodleGradeListSchema, ...errorResponses },
      },
    },
    async (request) => reader.grades(request.query.course_id),
  );

  typed.get(
    '/moodle/quizzes',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Quizze, nur zur Anzeige (mod_quiz_get_quizzes_by_courses)',
        querystring: CourseFilterQuery,
        response: { 200: MoodleQuizListSchema, ...errorResponses },
      },
    },
    async (request) => reader.quizzes(request.query.course_id),
  );

  typed.get(
    '/moodle/notifications',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Benachrichtigungen, neueste zuerst, höchstens limit (1–50, Standard 20)',
        querystring: NotificationsQuery,
        response: { 200: MoodleNotificationListSchema, ...errorResponses },
      },
    },
    async (request) => reader.notifications(request.query.limit ?? DEFAULT_LIST_LIMIT),
  );

  typed.get(
    '/moodle/file',
    {
      // HEAD würde den Handler ausführen und die Datei von Moodle laden
      exposeHeadRoute: false,
      // Scheitert der Stream, bevor Header gesendet sind, geht die Fehlerantwort als JSON hinaus:
      // ohne Content-Type, Content-Disposition und Content-Length der Datei. Der geworfene Fehler geht
      // danach an den zentralen Error-Handler
      errorHandler: (error, _request, reply) => {
        if (!reply.raw.headersSent) {
          for (const name of FILE_ONLY_HEADERS) reply.removeHeader(name);
        }
        throw error;
      },
      schema: {
        tags: ['Moodle'],
        summary:
          'Datei aus Moodle als Stream. Nur Verweise, die der Core über die Lese-Endpunkte ausgegeben hat',
        querystring: FileQuery,
        response: {
          // Datei als Stream: Fastify serialisiert Streams nicht, das Schema dient nur der Doku
          200: z.unknown().describe('Dateiinhalt, Content-Type laut Allowlist (08 §9.2)'),
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const { ref } = request.query;
      if (!isValidFileRef(ref)) {
        throw new HttpError(400, 'moodle_file_ref_invalid', 'Der Dateiverweis ist ungültig.');
      }
      if (!(await client.isConfigured())) throw moodleNotConfigured();
      // Kein Proxy für beliebige Pfade: nur Dateien aus Kursinhalten, Aufgaben und Foren des Nutzers
      // Dauerhafte Quelle seit T1-23: Dateien aus abgeglichenen Kursen (moodle_item.file_ref)
      if (!files.has(ref) && !(deps.db && (await isKnownFileRef(deps.db, ref)))) {
        throw new HttpError(
          404,
          'moodle_file_not_found',
          'Die Datei ist nicht bekannt. Bitte den Kursinhalt neu laden.',
          { reason: 'unknown_ref' },
        );
      }
      // Bricht die Web-App ab, bevor die Antwort fertig ist (auch während die Anfrage noch auf einen
      // Download-Platz wartet), wird Moodle nicht mehr angefragt bzw. die Verbindung geschlossen
      const closed = abortWhenClosed(reply.raw);
      let download: Awaited<ReturnType<typeof client.downloadFile>>;
      try {
        download = await client.downloadFile(ref, { signal: closed.signal });
      } catch (error) {
        closed.stop();
        // Niemand wartet mehr auf die Antwort
        if (error instanceof RequestAbortedError) return reply.code(499).send();
        throw error;
      }
      // Erfolgsweg: Ab hier zerstört Fastify den Stream, wenn die Web-App abbricht
      closed.stop();
      // Stream direkt durchreichen, nie die ganze Datei puffern. Bricht die Web-App ab, zerstört
      // Fastify den Stream, und der Client gibt Moodle-Verbindung und Platz in der Drosselung frei
      return reply.headers(fileResponseHeaders(download, ref)).send(download.stream);
    },
  );

  typed.get(
    '/moodle/actions',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Aktionskatalog (F-MDL-05) mit Verfügbarkeit für den aktuellen Zugang',
        response: { 200: MoodleActionCatalogSchema },
      },
    },
    async () => actions.catalog(await status.availableFunctions()),
  );

  // Vorschau und Ausführen nur vom Mac selbst (403 `local_only` aus dem Netz, auch mit Geräte-Token und über den
  // Tunnel): Ein gestohlenes Geräte-Token darf keine Abgabe oder keinen Beitrag im Namen des Nutzers auslösen.
  // Die Vorschau speichert nichts unter einem `Idempotency-Key`: Ihre Antwort enthält den Bestätigungscode, und der
  // lebt nur im Speicher des Core (08 §9.3), nie in Postgres
  typed.post(
    '/moodle/actions/:action_id/preview',
    {
      config: { sgAccess: 'local', idempotency: false },
      schema: {
        tags: ['Moodle'],
        summary: 'Vorschau einer Aktion, ändert nichts in Moodle. Liefert bei Bedarf den Bestätigungscode',
        params: ActionParamsSchema,
        body: MoodleActionRequestSchema,
        response: { 200: MoodleActionPreviewSchema, ...errorResponses },
      },
    },
    async (request) => {
      const id = actionId(request.params.action_id);
      const { handler, params, confirm } = await prepare(id, request.body.params);
      // Zähler zuerst, dann Stand: Läuft dazwischen ein `revokeScope`, wird der Code nicht gültig (08 §9.3).
      // Die Vorschau nimmt keine Sperre, ein langer Upload soll sie nicht blockieren
      const scope = handler.scope?.(params) ?? null;
      const epoch = scope ? confirmations.epoch(scope) : 0;
      const state = (await handler.state?.(context, params)) ?? null;
      const preview = await handler.preview(context, params, state);
      const risk = actions.spec(id).risk;
      const code = confirm ? confirmations.issue(id, params, { state, scope, epoch }) : null;
      return {
        action_id: id,
        risk,
        needs_confirmation: confirm,
        summary: preview.summary,
        warnings: preview.warnings ?? [],
        details: preview.details ?? {},
        confirmation_token: code?.token ?? null,
        expires_at: code ? code.expiresAt.toISOString() : null,
      };
    },
  );

  typed.post(
    '/moodle/actions/:action_id/execute',
    {
      config: { sgAccess: 'local' },
      schema: {
        tags: ['Moodle'],
        summary: 'Aktion ausführen. endgueltig/oeffentlich nur mit Bestätigungscode aus der Vorschau',
        params: ActionParamsSchema,
        body: MoodleActionExecuteSchema,
        response: { 200: MoodleActionResultSchema, ...errorResponses },
      },
    },
    async (request) => {
      const id = actionId(request.params.action_id);
      const { handler, params, confirm } = await prepare(id, request.body.params);
      const token = request.body.confirmation_token;
      if (confirm && !token) {
        throw new HttpError(
          409,
          'moodle_confirmation_required',
          'Diese Aktion braucht eine Bestätigung. Bitte zuerst die Vorschau abrufen.',
        );
      }
      // Aktionen mit gleichem Schlüssel laufen nacheinander. Ein Upload kann Minuten dauern, die Anfrage wartet
      // darum höchstens 10 s (Zeitlimit der Sperre)
      const lockKey = handler.lockKey?.(params) ?? null;
      const release = lockKey === null ? null : await locks.acquire(lockKey);
      if (lockKey !== null && release === null) {
        throw new HttpError(409, 'moodle_action_busy', 'Für diese Aufgabe läuft gerade eine andere Aktion.', {
          action_id: id,
        });
      }
      try {
        // Erst den Stand lesen, dann den Code einlösen: `consume` verbraucht ihn auch bei einem Fehlschlag.
        // Scheitert das Lesen, bleibt der Code offen (es wurde nichts geschrieben)
        const state = (await handler.state?.(context, params)) ?? null;
        if (confirm && token) {
          const result = confirmations.consume(token, id, params, state);
          if (result !== 'ok') {
            throw new HttpError(
              409,
              'moodle_confirmation_invalid',
              result === 'state_changed'
                ? 'Der Stand in Moodle hat sich seit der Vorschau geändert. Bitte die Vorschau erneut abrufen.'
                : 'Der Bestätigungscode ist abgelaufen, schon benutzt oder gilt für andere Angaben.',
              result === 'state_changed' ? { reason: 'stand_geaendert' } : undefined,
            );
          }
        }
        request.log.info({ action_id: id }, 'Moodle-Aktion wird ausgeführt');
        let rejected = false;
        try {
          const outcome = await handler.execute(context, params, state);
          return { action_id: id, summary: outcome.summary, result: outcome.result };
        } catch (error) {
          // Eine Ablehnung vor dem Schreiben (nichts geändert) widerruft nichts
          rejected = error instanceof HttpError && error.code === 'moodle_action_rejected';
          throw error;
        } finally {
          // Nach jedem Schreibversuch, auch bei Fehler und `outcome_unknown`: Der Entwurf kann sich geändert haben.
          // Noch unter der Sperre, damit kein anderes `execute` dazwischen einen alten Code einlöst
          const revoked = rejected ? null : (handler.revokesScope?.(params) ?? null);
          if (revoked !== null) confirmations.revokeScope(revoked);
        }
      } finally {
        release?.();
      }
    },
  );

  const db = deps.db;
  if (db) {
    typed.post(
      '/moodle/auto-assign',
      {
        schema: {
          tags: ['Moodle'],
          summary:
            'Automatische Kurszuordnung (#141): neue aktuelle Kurse sicher passenden Modulen zuordnen bzw. Module anlegen',
          response: { 200: MoodleAutoAssignResultSchema, ...errorResponses },
        },
      },
      async (request) => {
        if (!(await client.isConfigured())) throw moodleNotConfigured();
        const list = await reader.courses();
        const now = deps.now?.() ?? new Date();
        const result = await autoAssignCourses(db, list.items, { timeZone: reader.timeZone, now });
        if (result.assigned > 0 || result.created > 0) {
          request.log.info(result, 'Moodle-Kurse automatisch zugeordnet');
        }
        return result;
      },
    );
  }

  if (deps.db && deps.sync) registerSyncRoutes(app, { db: deps.db, sync: deps.sync, client, now: deps.now });
}

// ---------- Kurszuordnung und Abgleich (F-MDL-03/-04, T1-23) ----------

const ItemsQuery = z.object({
  course_id: MoodleIdParam.optional(),
  module_id: UuidSchema.optional(),
  kind: MoodleItemKindSchema.optional(),
  include_removed: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});
const DeadlineListQuery = z.object({
  module_id: UuidSchema.optional(),
  from: TimestampSchema.optional(),
  to: TimestampSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function registerSyncRoutes(
  fastify: FastifyInstance,
  deps: { db: Db; sync: MoodleSync; client: MoodleServices['client']; now?: (() => Date) | undefined },
): void {
  const { db, sync, client } = deps;
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  /** Abgleich im Hintergrund anstoßen. Ergebnis zeigt GET /moodle/sync */
  const kick = (trigger: 'zuordnung' | 'entscheidung', courseId: number) => {
    void sync.run(trigger, [courseId]).catch(() => {});
  };

  app.get(
    '/moodle/links',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Kurszuordnungen (F-MDL-03). Lokal, ohne Moodle-Aufruf',
        response: { 200: MoodleCourseLinkListSchema },
      },
    },
    async () => ({ items: await listLinks(db) }),
  );

  app.put(
    '/moodle/links/:course_id',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Zuordnung Kurs → Modul bestätigen oder ändern. Startet einen Abgleich des Kurses',
        params: z.object({ course_id: MoodleIdParam }),
        body: MoodleCourseLinkUpdateSchema,
        response: { 200: MoodleCourseLinkSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => {
      const link = await putLink(db, request.params.course_id, request.body);
      if (link.sync_enabled && (await client.isConfigured())) kick('zuordnung', link.moodle_course_id);
      return link;
    },
  );

  app.delete(
    '/moodle/links/:course_id',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Zuordnung lösen. Übernommenes Material bleibt, die Fristen des Kurses fallen weg',
        params: z.object({ course_id: MoodleIdParam }),
        response: { 204: z.null(), 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      await deleteLink(db, request.params.course_id);
      return reply.code(204).send(null);
    },
  );

  app.delete(
    '/moodle/links/:course_id/module',
    {
      schema: {
        tags: ['Moodle'],
        summary:
          '„Modul entfernen“: automatisch angelegtes, leeres Modul in den Papierkorb. Danach keine Automatik mehr für den Kurs',
        params: z.object({ course_id: MoodleIdParam }),
        response: { 204: z.null(), 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      await removeAutoModule(db, request.params.course_id);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/moodle/items',
    {
      schema: {
        tags: ['Moodle'],
        summary:
          'Dateien aus zugeordneten Kursen mit Abgleich an, neueste zuerst (limit 1–1000, Standard 500). kind=offen: Inbox',
        querystring: ItemsQuery,
        response: { 200: MoodleItemListSchema },
      },
    },
    async (request) => ({
      items: await listItems(db, {
        courseId: request.query.course_id,
        moduleId: request.query.module_id,
        kind: request.query.kind,
        includeRemoved: request.query.include_removed === 'true',
        limit: request.query.limit ?? 500,
      }),
    }),
  );

  app.patch(
    '/moodle/items/:item_id',
    {
      schema: {
        tags: ['Moodle'],
        summary:
          'Entscheidung aus der Inbox: als Folien, Übung oder ignorieren. Gilt für die ganze Aktivität',
        params: z.object({ item_id: UuidSchema }),
        body: MoodleItemUpdateSchema,
        response: { 200: MoodleItemSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => {
      const { item, courseId } = await decideItem(db, request.params.item_id, request.body.kind);
      if ((item.kind === 'folien' || item.kind === 'uebung') && (await client.isConfigured())) {
        kick('entscheidung', courseId);
      }
      return item;
    },
  );

  app.get(
    '/moodle/sync',
    {
      schema: {
        tags: ['Moodle'],
        summary: 'Stand des Abgleichs (F-MDL-04): läuft, pausiert, letzter Lauf, nächster Termin',
        response: { 200: MoodleSyncStatusSchema },
      },
    },
    async () => sync.status(),
  );

  app.post(
    '/moodle/sync',
    {
      schema: {
        tags: ['Moodle'],
        summary: '„Jetzt abgleichen“: startet einen Abgleich im Hintergrund (läuft schon einer, danach)',
        body: MoodleSyncRequestSchema.optional(),
        response: {
          202: MoodleSyncStatusSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!(await client.isConfigured())) throw moodleNotConfigured();
      const courseId = request.body?.course_id;
      if (courseId) {
        const link = (await listLinks(db)).find((entry) => entry.moodle_course_id === courseId);
        if (!link) {
          throw new HttpError(404, 'moodle_link_not_found', 'Dieser Kurs ist keinem Modul zugeordnet.');
        }
        // Der Abgleich überspringt Kurse mit ausgeschaltetem Abgleich: nicht 202 versprechen und nichts tun
        if (!link.sync_enabled) {
          throw new HttpError(
            409,
            'moodle_link_disabled',
            'Der Abgleich für diesen Kurs ist ausgeschaltet. Bitte zuerst einschalten.',
          );
        }
      }
      void sync.run('manuell', courseId ? [courseId] : undefined).catch(() => {});
      return reply.code(202).send(await sync.status());
    },
  );

  app.get(
    '/moodle/synced-deadlines',
    {
      schema: {
        tags: ['Moodle'],
        summary:
          'Fristen aus dem Abgleich nach Datum (Standard ab jetzt, höchstens 50). Lokal, ohne Moodle-Aufruf',
        querystring: DeadlineListQuery,
        response: { 200: MoodleSyncedDeadlineListSchema },
      },
    },
    async (request) => {
      const { module_id, from, to, limit } = request.query;
      return {
        items: await listSyncedDeadlines(db, {
          moduleId: module_id,
          from: from ? new Date(from) : (deps.now?.() ?? new Date()),
          to: to ? new Date(to) : undefined,
          limit: limit ?? 50,
        }),
      };
    },
  );
}
