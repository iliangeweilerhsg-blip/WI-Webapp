// Moodle-Web-Service-Client (08 §9.1). Einziger Ort im Core, der mit Moodle spricht.
// Der Token steht nur im Body der Anfragen, nie in URL, Log oder Fehlermeldung.
import { Readable } from 'node:stream';
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

export interface MoodleDownload {
  stream: Readable;
  contentType: string;
  contentLength: number | null;
  /**
   * Bereinigt mit `sanitizeFilename`, ohne Pfad und Steuerzeichen. Nicht roh in einen Header
   * einsetzen. Ausgabe nur als `filename*=UTF-8''<RFC-5987-kodiert>` plus ASCII-Ersatz.
   */
  filename: string | null;
}

/** Fehlercodes von Moodle, die bedeuten: Token unbekannt oder abgelaufen */
const TOKEN_ERRORCODES = new Set(['invalidtoken', 'invalidtimedtoken']);
const REST_PATH = '/webservice/rest/server.php';
const PLUGINFILE_PATH = '/webservice/pluginfile.php';
/** Größte JSON-Antwort, die beim Datei-Download als mögliche Fehlermeldung gelesen wird */
const MAX_JSON_ERROR_BYTES = 64 * 1024;

/**
 * Moodle-Funktionen, die schreiben. `read()` verweigert sie, damit ein Schreibaufruf nie aus Versehen
 * wiederholt wird (08 §9.1). Neue schreibende Funktionen hier eintragen.
 */
export const WRITE_WSFUNCTIONS: ReadonlySet<string> = new Set([
  'mod_assign_save_submission',
  'mod_assign_submit_for_grading',
  'mod_forum_add_discussion',
  'mod_forum_add_discussion_post',
  'core_completion_update_activity_completion_status_manually',
  'core_calendar_submit_create_update_form',
  'core_message_send_instant_messages',
  'core_message_mark_all_notifications_as_read',
  'core_user_add_user_private_files',
  'mod_quiz_start_attempt',
  'mod_quiz_process_attempt',
  'mod_quiz_save_attempt',
]);

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Einheitlicher Fehler, wenn `SG_MOODLE_URL` oder der Token fehlt */
export function moodleNotConfigured(): HttpError {
  return new HttpError(
    503,
    'moodle_not_configured',
    'Moodle ist nicht eingerichtet (SG_MOODLE_URL oder Token im Schlüsselbund fehlt).',
  );
}

/**
 * Formularfelder, die nur `call()` selbst setzt. Kein Parameter darf sie überschreiben (auch nicht
 * verschachtelt): PHP nimmt bei doppelten Feldern das letzte Vorkommen.
 */
export const RESERVED_FIELDS: ReadonlySet<string> = new Set(['wstoken', 'wsfunction', 'moodlewsrestformat']);

/**
 * Erlaubte Schlüssel in Parametern. Moodle-Parameter sind immer Bezeichner. Alles andere könnte die
 * Klammerschreibweise aufbrechen (`a]`, `wstoken[x]`) oder von PHP umgedeutet werden (` wstoken`).
 */
const PARAM_KEY = /^[A-Za-z0-9_]+$/;

function checkParamKey(key: string): void {
  if (!PARAM_KEY.test(key) || RESERVED_FIELDS.has(key.toLowerCase())) {
    // Programmierfehler im Core, kein Fehler der Nutzerin: darum kein HttpError
    throw new Error(`Unzulässiger Moodle-Parameter ${JSON.stringify(key)}`);
  }
}

/**
 * Wandelt verschachtelte Parameter in Moodles Formularschreibweise um:
 * `{ a: [{ b: 1 }], c: true }` → `a[0][b]=1`, `c=1`.
 * Wirft bei reservierten Feldern (`RESERVED_FIELDS`) und bei Schlüsseln, die keine Bezeichner sind,
 * auf jeder Ebene.
 */
export function flattenParams(params: MoodleParams): [string, string][] {
  const out: [string, string][] = [];
  const walk = (prefix: string, value: MoodleParamValue): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item: MoodleParamValue, index) => walk(`${prefix}[${index}]`, item));
    } else if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value as Record<string, MoodleParamValue>)) {
        checkParamKey(key);
        walk(`${prefix}[${key}]`, item);
      }
    } else if (typeof value === 'boolean') {
      out.push([prefix, value ? '1' : '0']);
    } else {
      out.push([prefix, String(value)]);
    }
  };
  // Oberste Ebene ohne eckige Klammern um den Schlüssel
  for (const [key, value] of Object.entries(params)) {
    checkParamKey(key);
    walk(key, value);
  }
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

  /** Belegt einen Platz. Die zurückgegebene Funktion gibt ihn frei (mehrfacher Aufruf schadet nicht) */
  async acquire(): Promise<() => void> {
    while (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiters.shift()?.();
    };
    try {
      const now = this.now();
      const start = Math.max(now, this.nextStart);
      this.nextStart = start + this.interval;
      if (start > now) await this.sleep(start - now);
    } catch (error) {
      release();
      throw error;
    }
    return release;
  }
}

/** Platz in der Drosselung für einen Versuch. `keep()` = Aufrufer gibt ihn später selbst frei */
interface Slot {
  release: () => void;
  keep: () => void;
}

/** Interner Fehler für „nochmal versuchen lohnt sich“ (Netzwerk, Zeitlimit, 5xx) */
class TransientError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

function transientFrom(error: unknown): TransientError {
  return new TransientError(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network');
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

/**
 * Steuerzeichen, die nie in einen Dateinamen gehören: C0, DEL, C1 sowie unsichtbare Format- und
 * Richtungszeichen (z. B. U+202E, das `fdp.exe` als `exe.pdf` anzeigt): weiches Trennzeichen U+00AD,
 * arabisches Richtungszeichen U+061C, mongolischer Vokaltrenner U+180E, U+200B–200F, U+2028–202E,
 * U+2060–2064, U+2066–206F, BOM U+FEFF und die Interlinear-Zeichen U+FFF9–FFFB.
 */
const FILENAME_CONTROL =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb]/g;

/** Unter Windows und macOS unzulässige Zeichen (Zeichenliste wie 08 §8.1), werden zu `_` */
const FILENAME_RESERVED = /["<>|:*?]/g;

/**
 * Macht aus einem Dateinamen von Moodle einen reinen Namen ohne Pfad: Steuerzeichen raus, nur der
 * Teil nach dem letzten `/` oder `\`, führende Punkte und Leerzeichen raus (also nie `.`/`..`),
 * `" < > | : * ?` werden zu `_`. Bleibt nichts übrig: null.
 *
 * Der Name kann weiter `;`, `%`, `'` und Zeichen über U+00FF enthalten. Nicht roh in einen Header
 * einsetzen. Ausgabe nur als `filename*=UTF-8''<RFC-5987-kodiert>` plus ASCII-Ersatz.
 */
export function sanitizeFilename(raw: string): string | null {
  const withoutControls = raw.replace(FILENAME_CONTROL, '');
  const base = withoutControls.split(/[/\\]/).pop() ?? '';
  const name = base
    .replace(/^[.\s]+/, '')
    .trimEnd()
    .replace(FILENAME_RESERVED, '_');
  return name === '' ? null : name;
}

/**
 * Dateiname aus `Content-Disposition` (RFC 6266). `filename*` (RFC 5987) hat Vorrang, sonst
 * `filename`. Das Ergebnis ist immer mit `sanitizeFilename` bereinigt (Hinweis 1 aus #93).
 */
export function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*\s*=\s*([^;]+)/i.exec(disposition);
  if (star?.[1]) {
    const value = star[1].trim().replace(/^"|"$/g, '');
    // charset'sprache'wert, z. B. UTF-8''Skript%20A.pdf oder UTF-8'de'…
    const encoded = /^[^']*'[^']*'(.*)$/.exec(value)?.[1] ?? value;
    try {
      const name = sanitizeFilename(decodeURIComponent(encoded));
      if (name !== null) return name;
    } catch {
      // ungültige Kodierung: weiter mit filename=
    }
  }
  const plain = /(?:^|;)\s*filename\s*=\s*"?([^";]*)"?/i.exec(disposition);
  return plain?.[1] ? sanitizeFilename(plain[1]) : null;
}

/** Weiterleitung oder (im Browser) undurchsichtige Weiterleitung */
function isRedirect(response: Response): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
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
  private readonly tokenRejectedListeners: (() => void)[] = [];

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

  /** Wird aufgerufen, wenn Moodle den Token ablehnt (z. B. um den Status neu zu prüfen) */
  onTokenRejected(listener: () => void): void {
    this.tokenRejectedListeners.push(listener);
  }

  /** Moodle-Instanz eingetragen und Token vorhanden */
  async isConfigured(): Promise<boolean> {
    return this.baseUrl !== '' && (await this.tokens.getToken()) !== null;
  }

  private async requireToken(): Promise<string> {
    const token = this.baseUrl ? await this.tokens.getToken() : null;
    if (!token) throw moodleNotConfigured();
    return token;
  }

  /**
   * Lesender Aufruf. Bei Netzwerkfehler, Zeitlimit oder 5xx bis zu 2-mal wiederholt.
   * Schreibende Funktionen (`WRITE_WSFUNCTIONS`) sind hier verboten.
   */
  async read<T = unknown>(wsfunction: string, params: MoodleParams = {}): Promise<T> {
    if (WRITE_WSFUNCTIONS.has(wsfunction)) {
      throw new Error(`${wsfunction} schreibt und muss über write() aufgerufen werden`);
    }
    return this.call<T>(wsfunction, params, false);
  }

  /**
   * Schreibender Aufruf. Wird nie wiederholt. Bei Netzwerkfehler, Zeitlimit oder 5xx ist offen, ob
   * Moodle die Änderung übernommen hat: `details.outcome_unknown = true`.
   */
  async write<T = unknown>(wsfunction: string, params: MoodleParams = {}): Promise<T> {
    return this.call<T>(wsfunction, params, true);
  }

  private async call<T>(wsfunction: string, params: MoodleParams, write: boolean): Promise<T> {
    const token = await this.requireToken();
    const body = new URLSearchParams([
      ...flattenParams(params),
      // Reservierte Felder zuletzt: PHP nimmt bei doppelten Feldern das letzte Vorkommen. Zusammen mit
      // der Prüfung in flattenParams kann kein Parameter Token, Funktion oder Format überschreiben.
      ['wstoken', token],
      ['wsfunction', wsfunction],
      ['moodlewsrestformat', 'json'],
    ]).toString();

    const data = await this.withRetries(wsfunction, write, async () => {
      const started = this.now();
      let response: Response;
      try {
        response = await this.fetchFn(`${this.baseUrl}${REST_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body,
          // Nie einer Weiterleitung folgen: Sie würde den Token im Body an ein anderes Ziel schicken
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        throw transientFrom(error);
      }
      if (isRedirect(response)) {
        await discard(response);
        throw this.unreachable(wsfunction, 'redirect', false);
      }
      if (response.status >= 500) {
        await discard(response);
        throw new TransientError(`http_${response.status}`);
      }
      if (response.status !== 200) {
        await discard(response);
        throw this.unreachable(wsfunction, `http_${response.status}`, false);
      }
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        throw transientFrom(error);
      }
      this.logger?.debug({ wsfunction, duration_ms: this.now() - started }, 'Moodle-Aufruf');
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw this.unreachable(wsfunction, 'no_json', write);
      }
    });

    if (isMoodleException(data)) throw this.mapException(wsfunction, data);
    return data as T;
  }

  /**
   * Lädt eine Datei über `webservice/pluginfile.php`. Der Token geht als Formularfeld `token` per POST
   * mit. Der Platz in der Drosselung bleibt belegt, bis der Stream endet, zerstört wird oder das
   * Zeitlimit (120 s) abläuft. Danach wird der Stream mit Fehler beendet.
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

    return this.withRetries(label, false, async (slot) => {
      let response: Response;
      try {
        response = await this.fetchFn(target.toString(), {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams([['token', token]]).toString(),
          redirect: 'manual',
          signal: AbortSignal.timeout(this.fileTimeoutMs),
        });
      } catch (error) {
        throw transientFrom(error);
      }
      if (isRedirect(response)) {
        await discard(response);
        throw this.unreachable(label, 'redirect', false);
      }
      if (response.status >= 500) {
        await discard(response);
        throw new TransientError(`http_${response.status}`);
      }
      if (response.status === 404) {
        await discard(response);
        throw new HttpError(404, 'moodle_file_not_found', 'Moodle findet die Datei nicht.');
      }
      if (response.status !== 200) {
        await discard(response);
        throw this.unreachable(label, `http_${response.status}`, false);
      }

      const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
      const lengthHeader = response.headers.get('content-length');
      const contentLength = lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
      const filename = filenameFrom(response.headers.get('content-disposition'));
      const reader = response.body?.getReader();
      if (!reader) return { stream: Readable.from([]), contentType, contentLength, filename };
      const body = reader;

      // Fehler meldet pluginfile.php als kleines JSON mit HTTP 200. Höchstens 64 KB davon lesen
      const head: Uint8Array[] = [];
      let done = false;
      if (contentType.toLowerCase().startsWith('application/json')) {
        let size = 0;
        try {
          while (size <= MAX_JSON_ERROR_BYTES) {
            const chunk = await reader.read();
            if (chunk.done) {
              done = true;
              break;
            }
            head.push(chunk.value);
            size += chunk.value.byteLength;
          }
        } catch (error) {
          throw transientFrom(error);
        }
        if (done) {
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(Buffer.concat(head).toString('utf8'));
          } catch {
            // keine Fehlermeldung, sondern eine JSON-Datei
          }
          if (isMoodleException(parsed)) {
            if (parsed.errorcode === 'filenotfound') {
              throw new HttpError(404, 'moodle_file_not_found', 'Moodle findet die Datei nicht.');
            }
            throw this.mapException(label, parsed);
          }
        }
      }

      // Ab hier gibt der Stream den Platz frei: am Ende, bei destroy() oder spätestens nach dem
      // Zeitlimit, auch wenn niemand den Stream liest
      slot.keep();
      const release = slot.release;
      const pending = [...head];
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        release();
        void body.cancel().catch(() => {});
      };
      const stream = new Readable({
        read() {
          const next = pending.shift();
          if (next) {
            this.push(next);
            return;
          }
          if (done) {
            this.push(null);
            return;
          }
          body.read().then(
            (chunk) => {
              if (chunk.done) this.push(null);
              else this.push(chunk.value);
            },
            (error: unknown) => this.destroy(error instanceof Error ? error : new Error(String(error))),
          );
        },
        destroy(error, callback) {
          finish();
          callback(error);
        },
      });
      // Ein liegen gelassener Stream ohne eigenen Fehler-Listener darf den Core nicht abstürzen lassen
      // (Zeitlimit oder Netzfehler). Aufrufer mit pipeline/for await bekommen den Fehler trotzdem.
      stream.on('error', () => {});
      // finish() läuft frühestens im nächsten Tick, timer ist dann gesetzt
      const timer = setTimeout(
        () => stream.destroy(new Error('Zeitlimit beim Datei-Download überschritten')),
        this.fileTimeoutMs,
      );
      timer.unref();
      return { stream, contentType, contentLength, filename };
    });
  }

  private async withRetries<T>(
    label: string,
    write: boolean,
    attempt: (slot: Slot) => Promise<T>,
  ): Promise<T> {
    const delays = write ? [] : this.retryDelaysMs;
    for (let index = 0; ; index += 1) {
      const release = await this.throttle.acquire();
      let kept = false;
      try {
        return await attempt({ release, keep: () => (kept = true) });
      } catch (error) {
        if (!(error instanceof TransientError)) throw error;
        const delay = delays[index];
        if (delay === undefined) throw this.unreachable(label, error.reason, write);
        this.logger?.warn(
          { wsfunction: label, reason: error.reason, retry_in_ms: delay },
          'Moodle-Aufruf wird wiederholt',
        );
        release();
        await this.sleep(delay);
      } finally {
        if (!kept) release();
      }
    }
  }

  private unreachable(wsfunction: string, reason: string, write: boolean): HttpError {
    this.logger?.warn({ wsfunction, reason }, 'Moodle nicht erreichbar');
    return new HttpError(502, 'moodle_unreachable', 'Moodle ist nicht erreichbar.', {
      reason,
      ...(write ? { outcome_unknown: true } : {}),
    });
  }

  private mapException(wsfunction: string, data: MoodleException): HttpError {
    const errorcode = String(data.errorcode);
    const message =
      typeof data.message === 'string' ? data.message : typeof data.error === 'string' ? data.error : '';
    this.logger?.warn({ wsfunction, moodle_errorcode: errorcode }, 'Moodle meldet einen Fehler');
    if (TOKEN_ERRORCODES.has(errorcode)) {
      this.tokens.invalidate();
      for (const listener of this.tokenRejectedListeners) listener();
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
        'Die nötige Moodle-Funktion ist für diesen Zugang nicht freigegeben.',
        { wsfunctions: [wsfunction], moodle_errorcode: errorcode },
      );
    }
    return new HttpError(502, 'moodle_error', message || 'Moodle meldet einen Fehler.', {
      wsfunction,
      moodle_errorcode: errorcode,
      moodle_message: message,
    });
  }
}
