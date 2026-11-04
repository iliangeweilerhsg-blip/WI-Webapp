// Moodle-Endpunkte (08 §9): Status und Aktionen. Lese-Endpunkte folgen mit T1-22.
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
  MoodleStatusSchema,
  type MoodleActionId,
} from '@sg/shared';
import { HttpError } from '../errors.ts';
import { isMoodleActionId, needsConfirmation, type MoodleActionContext } from '../moodle/actions.ts';
import type { MoodleServices } from '../moodle/index.ts';

export interface MoodleRouteDeps {
  moodle: MoodleServices;
}

const ActionParamsSchema = z.object({ action_id: z.string().min(1).max(64) });

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
  const { client, status, actions, confirmations } = deps.moodle;
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
    if (!(await client.isConfigured())) {
      throw new HttpError(503, 'moodle_not_configured', 'Moodle ist nicht eingerichtet.');
    }
    const missing = actions.missingFunctions(id, await status.availableFunctions());
    if (missing.length > 0) {
      throw new HttpError(
        501,
        'moodle_function_unavailable',
        'Die nötige Moodle-Funktion ist für diesen Zugang nicht freigegeben.',
        { wsfunctions: missing },
      );
    }
    return { handler, params };
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
      const { handler, params } = await prepare(id, request.body.params);
      const preview = await handler.preview(context, params);
      const risk = actions.spec(id).risk;
      const confirm = needsConfirmation(risk);
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
      const { handler, params } = await prepare(id, request.body.params);
      if (needsConfirmation(actions.spec(id).risk)) {
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
