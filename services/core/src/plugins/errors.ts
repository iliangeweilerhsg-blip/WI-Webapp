import type { FastifyError, FastifyInstance } from 'fastify';
import { apiErrorBody, HttpError } from '../errors.ts';

const CLIENT_ERROR_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'too_many_requests',
};

/**
 * Zentraler Error-Handler: jede Fehlerantwort hat das Format `ApiError` (08 §1).
 * - `HttpError` → eigener Status und Code
 * - Validierungsfehler (Zod aus @sg/shared) → 400 `validation_failed`
 * - sonstige 4xx von Fastify (kaputtes JSON, zu großer Body …) → 4xx mit allgemeinem Code
 * - alles andere → 500 `internal_error`, ohne Details nach außen
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | HttpError, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send(apiErrorBody(error.code, error.message, error.details));
    }

    const validation = (error as FastifyError).validation;
    if (validation) {
      const issues = validation.map((entry) => ({
        path: entry.instancePath.replace(/^\//, '').replaceAll('/', '.'),
        message: entry.message ?? 'ungültiger Wert',
      }));
      return reply.code(400).send(
        apiErrorBody('validation_failed', 'Die Anfrage ist ungültig.', {
          in: (error as FastifyError).validationContext ?? 'request',
          issues,
        }),
      );
    }

    const status = (error as FastifyError).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply
        .code(status)
        .send(apiErrorBody(CLIENT_ERROR_CODES[status] ?? 'request_failed', error.message));
    }

    request.log.error({ err: error }, 'Unerwarteter Fehler');
    return reply.code(500).send(apiErrorBody('internal_error', 'Interner Fehler.'));
  });
}
