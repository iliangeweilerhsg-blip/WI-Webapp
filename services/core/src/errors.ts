import type { ApiError } from '@sg/shared';

/**
 * Fehler mit HTTP-Status und stabilem Code. Der zentrale Error-Handler macht daraus den
 * `ApiError`-Body `{ error: { code, message, details? } }` (08 §1).
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function apiErrorBody(code: string, message: string, details?: Record<string, unknown>): ApiError {
  return { error: { code, message, ...(details ? { details } : {}) } };
}
