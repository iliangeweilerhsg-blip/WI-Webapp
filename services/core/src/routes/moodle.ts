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
  MoodleCourseContentsSchema,
  MoodleCourseListSchema,
  MoodleDeadlineListSchema,
  MoodleDiscussionListSchema,
  MoodleForumListSchema,
  MoodleGradeListSchema,
  MoodleNotificationListSchema,
  MoodlePostListSchema,
  MoodleQuizListSchema,
  MoodleStatusSchema,
  MoodleSubmissionStatusSchema,
  TimestampSchema,
  type MoodleActionId,
} from '@sg/shared';
import { HttpError } from '../errors.ts';
import { isMoodleActionId, needsConfirmation, type MoodleActionContext } from '../moodle/actions.ts';
import { isValidFileRef, moodleNotConfigured } from '../moodle/client.ts';
import { fileResponseHeaders } from '../moodle/file-headers.ts';
import type { MoodleServices } from '../moodle/index.ts';

export interface MoodleRouteDeps {
  moodle: MoodleServices;
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
  const { client, status, actions, confirmations, reader, files } = deps.moodle;
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
        summary: 'Kurse des Nutzers (core_enrol_get_users_courses)',
        response: { 200: MoodleCourseListSchema, ...errorResponses },
      },
    },
    async () => reader.courses(),
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
      if (!files.has(ref)) {
        throw new HttpError(
          404,
          'moodle_file_not_found',
          'Die Datei ist nicht bekannt. Bitte den Kursinhalt neu laden.',
          { reason: 'unknown_ref' },
        );
      }
      const download = await client.downloadFile(ref);
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

  typed.post(
    '/moodle/actions/:action_id/preview',
    {
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
      const preview = await handler.preview(context, params);
      const risk = actions.spec(id).risk;
      const code = confirm ? confirmations.issue(id, params) : null;
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
      if (confirm) {
        const token = request.body.confirmation_token;
        if (!token) {
          throw new HttpError(
            409,
            'moodle_confirmation_required',
            'Diese Aktion braucht eine Bestätigung. Bitte zuerst die Vorschau abrufen.',
          );
        }
        if (!confirmations.consume(token, id, params)) {
          throw new HttpError(
            409,
            'moodle_confirmation_invalid',
            'Der Bestätigungscode ist abgelaufen, schon benutzt oder gilt für andere Angaben.',
          );
        }
      }
      request.log.info({ action_id: id }, 'Moodle-Aktion wird ausgeführt');
      const outcome = await handler.execute(context, params);
      return { action_id: id, summary: outcome.summary, result: outcome.result };
    },
  );
}
