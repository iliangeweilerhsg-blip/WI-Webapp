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
  return new ApiRequestError({
    kind: 'api',
    status: res.status,
    message: `HTTP ${res.status}`,
    userMessage: messageForStatus(res.status),
  });
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
    throw new ApiRequestError({
      kind: 'unreachable',
      message: `Core nicht erreichbar: ${String(cause)}`,
      userMessage: 'Core nicht erreichbar',
    });
  }
  if (!res.ok) throw await toApiError(res);

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

/** Text für die Oberfläche zu einem beliebigen Fehler. */
export function friendlyMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.userMessage : 'Das hat nicht geklappt.';
}

export function isUnreachable(error: unknown): boolean {
  return error instanceof ApiRequestError && error.kind === 'unreachable';
}
