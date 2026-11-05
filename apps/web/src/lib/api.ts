import { API_BASE, ApiErrorSchema } from '@sg/shared';

/** Minimale Schnittstelle eines Zod-Schemas (zod selbst kommt über @sg/shared). */
export interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

/** Basis-URL der API (VERTRAEGE §1). Standard: gleiche Herkunft, `/api/v1`. */
export function apiBase(): string {
  return (process.env.NEXT_PUBLIC_SG_API_BASE || API_BASE).replace(/\/+$/, '');
}

export type ApiFailureKind = 'unreachable' | 'api' | 'invalid';

/** Fehler der dünnen API-Schicht. `userMessage` ist bereits freundlich formuliert (07 §7). */
export class ApiRequestError extends Error {
  readonly kind: ApiFailureKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly userMessage: string;

  constructor(opts: {
    kind: ApiFailureKind;
    status?: number | null;
    code?: string | null;
    message: string;
    userMessage: string;
  }) {
    super(opts.message);
    this.name = 'ApiRequestError';
    this.kind = opts.kind;
    this.status = opts.status ?? null;
    this.code = opts.code ?? null;
    this.userMessage = opts.userMessage;
  }
}

/** Freundliche Texte für bekannte Fehlercodes des Core (VERTRAEGE §5). Unbekannte Codes fallen auf Status/Meldung zurück. */
const CODE_MESSAGES: Record<string, string> = {
  device_token_required: 'Dieses Gerät ist noch nicht mit dem Core gekoppelt.',
  host_not_allowed: 'Der Core lehnt diese Adresse ab. Öffne die App über localhost.',
  origin_not_allowed: 'Der Core lehnt diese Herkunft ab. Öffne die App über den Core oder localhost.',
  semester_archived: 'Ein archiviertes Semester kann nicht aktuell sein. Stelle es erst wieder her.',
  validation_failed: 'Das passt so nicht. Prüfe deine Eingabe.',
  invalid_pdf: 'Das ist kein gültiges PDF. Wähle eine andere Datei.',
  file_too_large: 'Die Datei ist zu groß (höchstens 200 MB).',
  session_transition_invalid: 'Das geht bei dieser Session gerade nicht. Die Ansicht wird aktualisiert.',
  session_not_active: 'Diese Session läuft nicht mehr.',
  session_not_found: 'Diese Session gibt es nicht mehr.',
  session_active: 'Eine laufende Session lässt sich nicht löschen. Beende sie zuerst.',
  session_exists: 'Zu diesem Termin gibt es schon eine Session.',
  session_one_active: 'Es läuft schon eine Session.',
  idempotency_key_in_progress: 'Die Datei wird gerade schon hochgeladen.',
};

function messageForStatus(status: number): string {
  if (status === 404) return 'Das gibt es nicht (mehr).';
  if (status >= 500) return 'Im Core ist etwas schiefgegangen. Versuch es gleich noch einmal.';
  return 'Die Anfrage hat nicht geklappt.';
}

async function toApiError(res: Response): Promise<ApiRequestError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Kein JSON – nur der Status zählt
  }
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) {
    const { code, message } = parsed.data.error;
    return new ApiRequestError({
      kind: 'api',
      status: res.status,
      code,
      message: `${code}: ${message}`,
      userMessage: CODE_MESSAGES[code] ?? messageForStatus(res.status),
    });
  }
  // Kein ApiError-Body: vermutlich antwortet nicht der Core (z. B. ein Proxy oder ein anderer Server)
  return new ApiRequestError({
    kind: 'api',
    status: res.status,
    message: `HTTP ${res.status}`,
    userMessage: res.status >= 500 ? messageForStatus(res.status) : 'Core antwortet unerwartet',
  });
}

function unreachable(cause: unknown): ApiRequestError {
  return new ApiRequestError({
    kind: 'unreachable',
    message: `Core nicht erreichbar: ${String(cause)}`,
    userMessage: 'Core nicht erreichbar',
  });
}

/** Antwort als JSON lesen und mit dem Schema prüfen. */
async function parseBody<T>(res: Response, schema: Parser<T>): Promise<T> {
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiRequestError({
      kind: 'invalid',
      status: res.status,
      message: 'Antwort ist kein JSON',
      userMessage: 'Der Core hat unerwartet geantwortet.',
    });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiRequestError({
      kind: 'invalid',
      status: res.status,
      message: `Antwort passt nicht zum Schema: ${parsed.error.message}`,
      userMessage: 'Der Core hat unerwartet geantwortet.',
    });
  }
  return parsed.data;
}

/** GET gegen die API, Antwort mit einem Zod-Schema aus `@sg/shared` geprüft. */
export async function apiGet<T>(
  path: string,
  schema: Parser<T>,
  init?: { signal?: AbortSignal },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      headers: { Accept: 'application/json' },
      signal: init?.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw unreachable(cause);
  }
  if (!res.ok) throw await toApiError(res);
  return parseBody(res, schema);
}

export type SendMethod = 'POST' | 'PATCH' | 'DELETE';

export interface SendOptions {
  /** Request-Body (JSON). Bei DELETE weglassen. */
  body?: unknown;
  /** Beim Seitenwechsel weiterlaufen lassen (nur für kleine Anfragen). */
  keepalive?: boolean;
}

/** Zufällige UUID für den `Idempotency-Key` (08 §1). */
function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Schreibender Aufruf (POST, PATCH, DELETE). Antwort wird mit `schema` geprüft;
 * ohne Schema (z. B. DELETE → 204) wird nichts gelesen. POST sendet einen `Idempotency-Key`,
 * damit ein Wiederholen nichts doppelt anlegt.
 */
export async function apiSend<T>(
  method: SendMethod,
  path: string,
  schema: Parser<T>,
  options?: SendOptions,
): Promise<T>;
export async function apiSend(
  method: SendMethod,
  path: string,
  schema: null,
  options?: SendOptions,
): Promise<void>;
export async function apiSend<T>(
  method: SendMethod,
  path: string,
  schema: Parser<T> | null,
  options: SendOptions = {},
): Promise<T | void> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method === 'POST') headers['Idempotency-Key'] = newIdempotencyKey();

  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      keepalive: options.keepalive,
    });
  } catch (cause) {
    throw unreachable(cause);
  }
  if (!res.ok) throw await toApiError(res);
  if (schema === null) return;
  return parseBody(res, schema);
}

export interface UploadOptions {
  file: File;
  /** Textfelder neben der Datei (z. B. `module_id`) */
  fields: Record<string, string>;
  /** Pro Datei genau ein Schlüssel; ein Wiederholen nach Netzfehler nutzt denselben (08 §1) */
  idempotencyKey: string;
  signal?: AbortSignal;
}

/** Datei-Upload per multipart (POST). Die Antwort wird mit `schema` geprüft. */
export async function apiUpload<T>(path: string, schema: Parser<T>, options: UploadOptions): Promise<T> {
  const form = new FormData();
  for (const [name, value] of Object.entries(options.fields)) form.append(name, value);
  form.append('file', options.file, options.file.name);
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      // Content-Type setzt der Browser samt Boundary
      headers: { Accept: 'application/json', 'Idempotency-Key': options.idempotencyKey },
      body: form,
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw unreachable(cause);
  }
  if (!res.ok) throw await toApiError(res);
  return parseBody(res, schema);
}

/** Text für die Oberfläche zu einem beliebigen Fehler. */
export function friendlyMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.userMessage : 'Das hat nicht geklappt.';
}

export function isUnreachable(error: unknown): boolean {
  return error instanceof ApiRequestError && error.kind === 'unreachable';
}
