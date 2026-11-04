// Moodle-Web-Service-Client (08 §9.1). Einziger Ort im Core, der mit Moodle spricht.
// Der Token steht nur im Body der Anfragen, nie in URL, Log oder Fehlermeldung.
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { HttpError } from '../errors.ts';
import type { MoodleTokenStore } from './token-store.ts';

/** Werte, die als Moodle-Parameter erlaubt sind. `null`/`undefined` werden weggelassen */
export type MoodleParamValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly MoodleParamValue[]
  | { readonly [key: string]: MoodleParamValue };

export type MoodleParams = { readonly [key: string]: MoodleParamValue };

export interface MoodleLogger {
  debug(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface MoodleClientOptions {
  /** `SG_MOODLE_URL` ohne Schrägstrich am Ende. Leer = Moodle aus */
  baseUrl: string;
  tokens: MoodleTokenStore;
  fetch?: FetchFn;
  logger?: MoodleLogger;
  /** Höchstens so viele Anfragen gleichzeitig (Standard 2) */
  maxConcurrent?: number;
  /** Mindestabstand zwischen zwei Anfrage-Starts in ms (Standard 250 = 4/s) */
  minIntervalMs?: number;
  /** Zeitlimit für REST-Aufrufe (Standard 30 s) */
  timeoutMs?: number;
  /** Zeitlimit für Datei-Downloads, ganze Übertragung (Standard 120 s) */
  fileTimeoutMs?: number;
  /** Wartezeiten vor Wiederholungen lesender Aufrufe (Standard 1 s, 4 s) */
  retryDelaysMs?: readonly number[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface MoodleCallOptions {
  /** Schreibende Aufrufe werden nie automatisch wiederholt (08 §9.1) */
  write?: boolean;
}

export interface MoodleDownload {
  stream: Readable;
  contentType: string;
  contentLength: number | null;
  filename: string | null;
}

/** Fehlercodes von Moodle, die bedeuten: Token unbekannt oder abgelaufen */
const TOKEN_ERRORCODES = new Set(['invalidtoken', 'invalidtimedtoken']);
const REST_PATH = '/webservice/rest/server.php';
const PLUGINFILE_PATH = '/webservice/pluginfile.php';
/** Größte JSON-Antwort, die beim Datei-Download als mögliche Fehlermeldung gelesen wird */
const MAX_JSON_ERROR_BYTES = 64 * 1024;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wandelt verschachtelte Parameter in Moodles Formularschreibweise um:
 * `{ a: [{ b: 1 }], c: true }` → `a[0][b]=1`, `c=1`.
 */
export function flattenParams(params: MoodleParams): [string, string][] {
  const out: [string, string][] = [];
  const walk = (prefix: string, value: MoodleParamValue): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item: MoodleParamValue, index) => walk(`${prefix}[${index}]`, item));
    } else if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value as Record<string, MoodleParamValue>)) {
        walk(`${prefix}[${key}]`, item);
      }
    } else if (typeof value === 'boolean') {
      out.push([prefix, value ? '1' : '0']);
    } else {
      out.push([prefix, String(value)]);
    }
  };
  // Oberste Ebene ohne eckige Klammern um den Schlüssel
  for (const [key, value] of Object.entries(params)) walk(key, value);
  return out;
}

/**
 * Prüft einen Dateiverweis (Pfad hinter `webservice/pluginfile.php`).
 * Erlaubt: `/<contextid>/<component>/<filearea>/…/<datei>`, jedes Segment nicht leer, kein `.`/`..`
 * (auch nicht kodiert), keine Schrägstriche oder Steuerzeichen in kodierten Segmenten, kein `?`/`#`.
 */
export function isValidFileRef(ref: string): boolean {
  if (ref.length > 2048 || !ref.startsWith('/') || /[?#\\\s]/.test(ref)) return false;
  const segments = ref.slice(1).split('/');
  if (segments.length < 4) return false;
  if (!/^\d+$/.test(segments[0] ?? '')) return false;
  if (!/^[a-z][a-z0-9_]*$/.test(segments[1] ?? '')) return false;
  if (!/^[a-z][a-z0-9_]*$/.test(segments[2] ?? '')) return false;
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
    if (decoded === '' || decoded === '.' || decoded === '..') return false;
    // eslint-disable-next-line no-control-regex
    if (/[/\\\u0000-\u001f\u007f]/.test(decoded)) return false;
  }
  return true;
}

/**
 * Macht aus einer `fileurl` von Moodle den Verweis für `MoodleFile.ref`. Liefert null, wenn die
 * Adresse nicht zur Instanz gehört oder kein gültiger Verweis ist. Query (`?forcedownload=1`, Token)
 * wird verworfen.
 */
export function fileRefFromUrl(baseUrl: string, fileUrl: string): string | null {
  let base: URL;
  let url: URL;
  try {
    base = new URL(baseUrl);
    url = new URL(fileUrl);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;
  const basePath = base.pathname.replace(/\/+$/, '');
  for (const prefix of [`${basePath}${PLUGINFILE_PATH}`, `${basePath}/pluginfile.php`]) {
    if (url.pathname.startsWith(`${prefix}/`)) {
      const ref = url.pathname.slice(prefix.length);
      return isValidFileRef(ref) ? ref : null;
    }
  }
  return null;
}

/** Höchstens `max` gleichzeitig, Starts mindestens `interval` ms auseinander */
class Throttle {
  private active = 0;
  private nextStart = 0;
  private readonly waiters: (() => void)[] = [];
  private readonly max: number;
  private readonly interval: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(max: number, interval: number, now: () => number, sleep: (ms: number) => Promise<void>) {
    this.max = max;
    this.interval = interval;
    this.now = now;
    this.sleep = sleep;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      const now = this.now();
      const start = Math.max(now, this.nextStart);
      this.nextStart = start + this.interval;
      if (start > now) await this.sleep(start - now);
      return await fn();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

/** Interner Fehler für „nochmal versuchen lohnt sich“ (Netzwerk, Zeitlimit, 5xx) */
class TransientError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

interface MoodleException {
  exception?: unknown;
  errorcode?: unknown;
  message?: unknown;
  error?: unknown;
}

function isMoodleException(value: unknown): value is MoodleException {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as MoodleException).errorcode === 'string' &&
    ('exception' in value || 'error' in value)
  );
}

function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // weiter mit filename=
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1] ?? null;
}

export class MoodleClient {
  readonly baseUrl: string;
  private readonly tokens: MoodleTokenStore;
  private readonly fetchFn: FetchFn;
  private readonly logger: MoodleLogger | undefined;
  private readonly throttle: Throttle;
  private readonly timeoutMs: number;
  private readonly fileTimeoutMs: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: MoodleClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.tokens = options.tokens;
    this.fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.throttle = new Throttle(
      options.maxConcurrent ?? 2,
      options.minIntervalMs ?? 250,
      this.now,
      this.sleep,
    );
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fileTimeoutMs = options.fileTimeoutMs ?? 120_000;
    this.retryDelaysMs = options.retryDelaysMs ?? [1000, 4000];
  }

  /** Moodle-Instanz eingetragen und Token vorhanden */
  async isConfigured(): Promise<boolean> {
    return this.baseUrl !== '' && (await this.tokens.getToken()) !== null;
  }

  private async requireToken(): Promise<string> {
    const token = this.baseUrl ? await this.tokens.getToken() : null;
    if (!token) {
      throw new HttpError(
        503,
        'moodle_not_configured',
        'Moodle ist nicht eingerichtet (SG_MOODLE_URL oder Token im Schlüsselbund fehlt).',
      );
    }
    return token;
  }

  /** Führt eine Moodle-Funktion aus und liefert die geparste JSON-Antwort */
  async call<T = unknown>(
    wsfunction: string,
    params: MoodleParams = {},
    options: MoodleCallOptions = {},
  ): Promise<T> {
    const token = await this.requireToken();
    const body = new URLSearchParams([
      ['wstoken', token],
      ['wsfunction', wsfunction],
      ['moodlewsrestformat', 'json'],
      ...flattenParams(params),
    ]).toString();

    const data = await this.withRetries(wsfunction, options.write === true, async () => {
      const started = this.now();
      let response: Response;
      try {
        response = await this.fetchFn(`${this.baseUrl}${REST_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        throw new TransientError(
          error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network',
        );
      }
      if (response.status >= 500) throw new TransientError(`http_${response.status}`);
      if (response.status !== 200) {
        throw this.unreachable(wsfunction, `http_${response.status}`);
      }
      let text: string;
      try {
        text = await response.text();
      } catch {
        throw new TransientError('network');
      }
      this.logger?.debug({ wsfunction, duration_ms: this.now() - started }, 'Moodle-Aufruf');
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw this.unreachable(wsfunction, 'no_json');
      }
    });

    if (isMoodleException(data)) throw this.mapException(wsfunction, data);
    return data as T;
  }

  /**
   * Lädt eine Datei über `webservice/pluginfile.php`. Der Token geht als Formularfeld `token` per POST
   * mit. Der Platz in der Drosselung wird frei, sobald die Antwort-Header da sind.
   */
  async downloadFile(ref: string): Promise<MoodleDownload> {
    if (!isValidFileRef(ref)) {
      throw new HttpError(400, 'moodle_file_ref_invalid', 'Der Dateiverweis ist ungültig.');
    }
    const token = await this.requireToken();
    const target = new URL(`${this.baseUrl}${PLUGINFILE_PATH}${ref}`);
    const base = new URL(this.baseUrl);
    const allowedPrefix = `${base.pathname.replace(/\/+$/, '')}${PLUGINFILE_PATH}/`;
    if (target.origin !== base.origin || !target.pathname.startsWith(allowedPrefix)) {
      throw new HttpError(400, 'moodle_file_ref_invalid', 'Der Dateiverweis ist ungültig.');
    }
    const label = 'pluginfile';

    const response = await this.withRetries(label, false, async () => {
      let res: Response;
      try {
        res = await this.fetchFn(target.toString(), {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams([['token', token]]).toString(),
          signal: AbortSignal.timeout(this.fileTimeoutMs),
        });
      } catch (error) {
        throw new TransientError(
          error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network',
        );
      }
      if (res.status >= 500) throw new TransientError(`http_${res.status}`);
      return res;
    });

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const lengthHeader = response.headers.get('content-length');
    const contentLength = lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;

    if (response.status === 404) {
      await response.body?.cancel().catch(() => {});
      throw new HttpError(404, 'moodle_file_not_found', 'Moodle findet die Datei nicht.');
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      throw this.unreachable(label, `http_${response.status}`);
    }

    // Fehler meldet pluginfile.php als kleines JSON mit HTTP 200
    if (
      contentType.toLowerCase().startsWith('application/json') &&
      (contentLength ?? 0) <= MAX_JSON_ERROR_BYTES
    ) {
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // keine Fehlermeldung, sondern eine JSON-Datei
      }
      if (isMoodleException(parsed)) {
        if (parsed.errorcode === 'filenotfound') {
          throw new HttpError(404, 'moodle_file_not_found', 'Moodle findet die Datei nicht.');
        }
        throw this.mapException(label, parsed);
      }
      const buffer = Buffer.from(text, 'utf8');
      return {
        stream: Readable.from(buffer),
        contentType,
        contentLength: buffer.length,
        filename: filenameFrom(response.headers.get('content-disposition')),
      };
    }

    const stream = response.body
      ? Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>)
      : Readable.from([]);
    return {
      stream,
      contentType,
      contentLength,
      filename: filenameFrom(response.headers.get('content-disposition')),
    };
  }

  private async withRetries<T>(label: string, write: boolean, attempt: () => Promise<T>): Promise<T> {
    const delays = write ? [] : this.retryDelaysMs;
    for (let index = 0; ; index += 1) {
      try {
        return await this.throttle.run(attempt);
      } catch (error) {
        if (!(error instanceof TransientError)) throw error;
        const delay = delays[index];
        if (delay === undefined) throw this.unreachable(label, error.reason);
        this.logger?.warn(
          { wsfunction: label, reason: error.reason, retry_in_ms: delay },
          'Moodle-Aufruf wird wiederholt',
        );
        await this.sleep(delay);
      }
    }
  }

  private unreachable(wsfunction: string, reason: string): HttpError {
    this.logger?.warn({ wsfunction, reason }, 'Moodle nicht erreichbar');
    return new HttpError(502, 'moodle_unreachable', 'Moodle ist nicht erreichbar.', { reason });
  }

  private mapException(wsfunction: string, data: MoodleException): HttpError {
    const errorcode = String(data.errorcode);
    const message =
      typeof data.message === 'string' ? data.message : typeof data.error === 'string' ? data.error : '';
    this.logger?.warn({ wsfunction, moodle_errorcode: errorcode }, 'Moodle meldet einen Fehler');
    if (TOKEN_ERRORCODES.has(errorcode)) {
      this.tokens.invalidate();
      return new HttpError(
        409,
        'moodle_token_invalid',
        'Moodle lehnt den Token ab. Bitte den Token erneuern (docs/anleitungen/MOODLE-TOKEN.md).',
        { moodle_errorcode: errorcode },
      );
    }
    if (
      errorcode === 'accessexception' ||
      (errorcode === 'invalidrecord' && message.includes('external_functions'))
    ) {
      return new HttpError(
        501,
        'moodle_function_unavailable',
        `Die Moodle-Funktion ${wsfunction} ist für diesen Zugang nicht freigegeben.`,
        { wsfunction, moodle_errorcode: errorcode },
      );
    }
    return new HttpError(502, 'moodle_error', message || 'Moodle meldet einen Fehler.', {
      wsfunction,
      moodle_errorcode: errorcode,
      moodle_message: message,
    });
  }
}
