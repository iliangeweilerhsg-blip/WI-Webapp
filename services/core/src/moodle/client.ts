// Moodle-Web-Service-Client (08 §9.1). Einziger Ort im Core, der mit Moodle spricht.
// Der Token steht nur im Body der Anfragen, nie in URL, Log oder Fehlermeldung.
import { Readable } from 'node:stream';
import { HttpError } from '../errors.ts';
import { filenameFrom } from './content-disposition.ts';
import type { MoodleTokenStore } from './token-store.ts';

export { filenameFrom, sanitizeFilename } from './content-disposition.ts';

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
  /** Höchstens so viele REST-Aufrufe gleichzeitig (Standard 2) */
  maxConcurrent?: number;
  /** Höchstens so viele Datei-Downloads gleichzeitig, eigener Pool neben den REST-Aufrufen (Standard 2) */
  maxConcurrentDownloads?: number;
  /** Mindestabstand zwischen zwei Anfrage-Starts in ms, REST und Downloads zusammen (Standard 250 = 4/s) */
  minIntervalMs?: number;
  /** Zeitlimit für REST-Aufrufe (Standard 30 s) */
  timeoutMs?: number;
  /**
   * Leerlauf-Zeitlimit für Datei-Downloads (Standard 30 s): So lange darf Moodle ohne neue Daten bleiben,
   * bis zu den Headern wie danach. Es gibt kein Limit für die ganze Übertragung.
   */
  idleTimeoutMs?: number;
  /**
   * Mindestrate für Datei-Downloads als Reserve zum Leerlauf-Zeitlimit (Standard: 64 KiB je 60 s). Ein Server,
   * der alle 29 s ein Byte schickt, hielte sonst seinen Platz für immer. Zu langsam: `reason = "too_slow"`.
   */
  minRateBytes?: number;
  /** Länge des Zeitfensters für `minRateBytes` in ms (Standard 60 s) */
  rateWindowMs?: number;
  /** Wartezeiten vor Wiederholungen lesender Aufrufe (Standard 1 s, 4 s) */
  retryDelaysMs?: readonly number[];
  /** Größte JSON-Antwort der REST-Schnittstelle in Byte (Standard `MAX_RESPONSE_BYTES`) */
  maxResponseBytes?: number;
  /** Größte Datei beim Download in Byte (Standard `MAX_FILE_BYTES`) */
  maxFileBytes?: number;
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
/** Obergrenze für JSON-Antworten der REST-Schnittstelle (Review #125: `response.text()` begrenzen) */
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
/** Obergrenze für einen Datei-Download. Größere Dateien bricht der Core ab */
export const MAX_FILE_BYTES = 512 * 1024 * 1024;
/** Längster Dateiverweis (Zeichen). Längere sind ungültig und kommen nicht in die Registry */
export const MAX_REF_LENGTH = 2048;
/** Ersatz für den Token, falls Moodle ihn in einer Antwort zurückschickt */
const REDACTED = '[Redacted]';

/**
 * Ersetzt den Token in allen Texten einer Moodle-Antwort (auch in Schlüsseln). Moodle hängt ihn
 * z. B. an Download-Adressen (`?token=…`), ein Proxy oder eine Fehlermeldung könnte ihn zurückgeben.
 * So erreicht er weder Web-App noch Log.
 */
export function scrubToken<T>(value: T, token: string): T {
  if (token === '') return value;
  // Groß-/Kleinschreibung egal: Moodle-Tokens sind Hex, ein Proxy könnte sie in Großbuchstaben spiegeln
  const pattern = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') return item.replace(pattern, REDACTED);
    if (Array.isArray(item)) return item.map(walk);
    if (typeof item === 'object' && item !== null) {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(item)) out[walk(key) as string] = walk(entry);
      return out;
    }
    return item;
  };
  return walk(value) as T;
}

/** Interner Fehler: Antwort größer als erlaubt. Wird nicht wiederholt */
class TooLargeError extends Error {}

/**
 * Liest den Body als UTF-8-Text, höchstens `maxBytes`. Ein größerer `Content-Length` oder mehr
 * Daten brechen sofort ab (`TooLargeError`), ohne den Rest zu lesen.
 */
async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await discard(response);
    throw new TooLargeError();
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new TooLargeError();
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

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
  if (ref.length > MAX_REF_LENGTH || !ref.startsWith('/') || /[?#\\\s]/.test(ref)) return false;
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

/** Abbruch durch den Aufrufer (Web-App weg, Core fährt herunter). Kein Fehler von Moodle, wird nie wiederholt */
export class RequestAbortedError extends Error {
  constructor() {
    super('Die Anfrage wurde abgebrochen.');
    this.name = 'AbortError';
  }
}

/** Mindestabstand zwischen Anfrage-Starts, gemeinsam für alle Pools (Moodle drosselt pro Zugang) */
class Pacer {
  private nextStart = 0;
  private readonly interval: number;
  private readonly now: () => number;

  constructor(interval: number, now: () => number) {
    this.interval = interval;
    this.now = now;
  }

  /** Reserviert den nächsten Start. Rückgabe: so lange (ms) muss der Aufrufer noch warten */
  reserve(): number {
    const now = this.now();
    const start = Math.max(now, this.nextStart);
    this.nextStart = start + this.interval;
    return start - now;
  }
}

/** Höchstens `max` gleichzeitig. Wartende können per `AbortSignal` ausscheiden, ohne je zu starten */
class Throttle {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  private readonly max: number;
  private readonly pacer: Pacer;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(max: number, pacer: Pacer, sleep: (ms: number) => Promise<void>) {
    this.max = max;
    this.pacer = pacer;
    this.sleep = sleep;
  }

  /** Belegt einen Platz. Die zurückgegebene Funktion gibt ihn frei (mehrfacher Aufruf schadet nicht) */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new RequestAbortedError();
    while (this.active >= this.max) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = () => {
          const index = this.waiters.indexOf(wake);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new RequestAbortedError());
        };
        this.waiters.push(wake);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      if (signal?.aborted) {
        // Geweckt und gleichzeitig abgebrochen: den Platz an den Nächsten weiterreichen
        this.waiters.shift()?.();
        throw new RequestAbortedError();
      }
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
      const wait = this.pacer.reserve();
      if (wait > 0) await this.sleep(wait);
      // Abgebrochen, während der Platz gewartet hat: Moodle wird nicht mehr angefragt
      if (signal?.aborted) throw new RequestAbortedError();
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
  private readonly downloadThrottle: Throttle;
  private readonly timeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly minRateBytes: number;
  private readonly rateWindowMs: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly maxResponseBytes: number;
  private readonly maxFileBytes: number;
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
    const pacer = new Pacer(options.minIntervalMs ?? 250, this.now);
    this.throttle = new Throttle(options.maxConcurrent ?? 2, pacer, this.sleep);
    // Eigener Pool: Hängende Downloads dürfen Status, Fristen und andere REST-Aufrufe nicht aufhalten
    this.downloadThrottle = new Throttle(options.maxConcurrentDownloads ?? 2, pacer, this.sleep);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30_000;
    this.minRateBytes = options.minRateBytes ?? 64 * 1024;
    this.rateWindowMs = options.rateWindowMs ?? 60_000;
    this.retryDelaysMs = options.retryDelaysMs ?? [1000, 4000];
    this.maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
    this.maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
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
        text = await readTextLimited(response, this.maxResponseBytes);
      } catch (error) {
        if (error instanceof TooLargeError) throw this.unreachable(wsfunction, 'too_large', write);
        throw transientFrom(error);
      }
      this.logger?.debug({ wsfunction, duration_ms: this.now() - started }, 'Moodle-Aufruf');
      try {
        // Token aus der Antwort entfernen, bevor sie irgendwo weiterverarbeitet oder geloggt wird
        return scrubToken(JSON.parse(text) as unknown, token);
      } catch {
        throw this.unreachable(wsfunction, 'no_json', write);
      }
    });

    if (isMoodleException(data)) throw this.mapException(wsfunction, data);
    return data as T;
  }

  /**
   * Lädt eine Datei über `webservice/pluginfile.php`. Der Token geht als Formularfeld `token` per POST
   * mit. Downloads haben einen eigenen Pool (`maxConcurrentDownloads`, Standard 2), getrennt von den
   * REST-Aufrufen. Der Platz bleibt belegt, bis der Stream endet, zerstört wird oder Moodle länger als
   * `idleTimeoutMs` (30 s) keine Daten liefert. Es gibt kein Limit für die ganze Übertragung, nur für
   * Stillstand (das schließt einen Leser ein, der den Stream nicht abnimmt). Danach wird der Stream mit
   * Fehler beendet (`502 moodle_unreachable`, `reason = "timeout"`).
   *
   * Ein Zeitlimit wird bei Downloads **nicht** wiederholt (sonst bis zu 3 × Leerlauf-Zeitlimit vor dem
   * ersten Byte). Netzwerkfehler und 5xx werden wie bei REST bis zu 2-mal wiederholt.
   *
   * `options.signal` bricht ab, ohne dass Moodle weiter belastet wird: Wartet der Aufruf noch auf einen
   * Platz, wird Moodle nie angefragt. Läuft der Download, wird die Verbindung geschlossen und der Stream
   * mit `RequestAbortedError` zerstört. Ein Abbruch wird nie wiederholt.
   *
   * Größenlimit (`maxFileBytes`): Ein größerer `Content-Length` → `502 moodle_unreachable` mit
   * `details.reason = "too_large"`, ohne die Datei zu lesen. Ohne oder mit falschem `Content-Length`
   * bricht der Stream mit Fehler ab, sobald mehr Byte ankommen als erlaubt bzw. angekündigt.
   */
  async downloadFile(ref: string, options: { signal?: AbortSignal } = {}): Promise<MoodleDownload> {
    const external = options.signal;
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

    const attempt = async (slot: Slot): Promise<MoodleDownload> => {
      // Leerlauf-Zeitlimit: `arm()` startet es bei jedem Datenstück neu, bei Stillstand bricht es ab
      const idle = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      let onIdle = () => idle.abort(new DOMException('Moodle liefert keine Daten mehr', 'TimeoutError'));
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => onIdle(), this.idleTimeoutMs);
        timer.unref();
      };
      // Mindestrate: Je Zeitfenster müssen `minRateBytes` ankommen, sonst ist der Server zu langsam (Slow Loris)
      let windowBytes = 0;
      let onSlow = () => idle.abort(new DOMException('Moodle liefert zu langsam', 'TooSlowError'));
      const rateTimer = setInterval(() => {
        if (windowBytes < this.minRateBytes) onSlow();
        windowBytes = 0;
      }, this.rateWindowMs);
      rateTimer.unref();
      const stopTimers = () => {
        clearTimeout(timer);
        clearInterval(rateTimer);
      };
      const tooSlow = () =>
        idle.signal.aborted && (idle.signal.reason as Error | undefined)?.name === 'TooSlowError';
      const signal = external ? AbortSignal.any([idle.signal, external]) : idle.signal;
      // Abbruch durch den Aufrufer ist kein Netzwerkfehler und wird nicht wiederholt
      const failure = (error: unknown): Error =>
        external?.aborted
          ? new RequestAbortedError()
          : tooSlow()
            ? this.unreachable(label, 'too_slow', false)
            : transientFrom(error);
      arm();
      let streaming = false;
      try {
        let response: Response;
        try {
          response = await this.fetchFn(target.toString(), {
            method: 'POST',
            // Ohne Kompression: Content-Length gilt dann für die gelieferten Byte (Limit, Weitergabe)
            headers: { 'content-type': 'application/x-www-form-urlencoded', 'accept-encoding': 'identity' },
            body: new URLSearchParams([['token', token]]).toString(),
            redirect: 'manual',
            signal,
          });
        } catch (error) {
          throw failure(error);
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
        // Komprimiert Moodle trotzdem, entpackt fetch: Content-Length nennt dann die komprimierte Größe
        // und gilt weder fürs Limit noch für die Antwort an die Web-App
        const encoding = (response.headers.get('content-encoding') ?? 'identity').trim().toLowerCase();
        const contentLength =
          encoding === 'identity' && lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
        const disposition = response.headers.get('content-disposition');
        const rawName = filenameFrom(disposition);
        // Auch ein Dateiname von Moodle darf den Token nicht weitertragen (Header an die Web-App)
        const filename = rawName === null ? null : scrubToken(rawName, token);
        if (contentLength !== null && contentLength > this.maxFileBytes) {
          await discard(response);
          throw this.unreachable(label, 'too_large', false);
        }
        // Höchstens so viele Byte gehen durch: Limit bzw. angekündigte Länge, falls kleiner
        const limit = Math.min(this.maxFileBytes, contentLength ?? Number.POSITIVE_INFINITY);
        const reader = response.body?.getReader();
        if (!reader) {
          stopTimers();
          return { stream: Readable.from([]), contentType, contentLength, filename };
        }
        const body = reader;

        // Fehler meldet pluginfile.php als kleines JSON mit HTTP 200. Höchstens 64 KB davon lesen.
        // Eine echte Datei kommt mit Content-Disposition: Dann ist JSON Inhalt (z. B. ein Forenanhang
        // eines Dritten mit `errorcode: invalidtoken`) und wird nie als Fehlermeldung gedeutet
        const head: Uint8Array[] = [];
        let done = false;
        if (disposition === null && contentType.toLowerCase().startsWith('application/json')) {
          let size = 0;
          try {
            while (size <= MAX_JSON_ERROR_BYTES) {
              const chunk = await reader.read();
              arm();
              if (chunk.done) {
                done = true;
                break;
              }
              windowBytes += chunk.value.byteLength;
              head.push(chunk.value);
              size += chunk.value.byteLength;
            }
          } catch (error) {
            throw failure(error);
          }
          if (done) {
            let parsed: unknown = null;
            try {
              parsed = JSON.parse(Buffer.concat(head).toString('utf8'));
            } catch {
              // keine Fehlermeldung, sondern eine JSON-Datei
            }
            parsed = scrubToken(parsed, token);
            if (isMoodleException(parsed)) {
              if (parsed.errorcode === 'filenotfound') {
                throw new HttpError(404, 'moodle_file_not_found', 'Moodle findet die Datei nicht.');
              }
              throw this.mapException(label, parsed);
            }
          }
        }

        // Das erste Stück noch hier lesen: Bricht Moodle direkt nach den Headern ab oder bleibt stehen,
        // läuft das über 502 bzw. Wiederholung (nicht bei Zeitlimit), bevor die Web-App Header bekommt
        if (!done && head.length === 0) {
          try {
            const chunk = await reader.read();
            arm();
            if (chunk.done) done = true;
            else {
              windowBytes += chunk.value.byteLength;
              head.push(chunk.value);
            }
          } catch (error) {
            throw failure(error);
          }
        }

        // Schon der gelesene Anfang ist zu groß bzw. unvollständig: abbrechen, solange withRetries den
        // Platz noch freigibt
        let received = head.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        if (received > limit) {
          await body.cancel().catch(() => {});
          throw this.unreachable(label, 'too_large', false);
        }
        if (done && contentLength !== null && received < contentLength) {
          throw this.unreachable(label, 'incomplete', false);
        }
        if (external?.aborted) {
          await body.cancel().catch(() => {});
          throw new RequestAbortedError();
        }
        // Fehler im laufenden Stream: wie alle Moodle-Fehler als 502 mit Grund
        const fail = (reason: string) => this.unreachable(label, reason, false);

        // Ab hier gibt der Stream den Platz frei: am Ende, bei destroy() oder spätestens nach dem
        // Leerlauf-Zeitlimit, auch wenn niemand den Stream liest
        slot.keep();
        streaming = true;
        const release = slot.release;
        const pending = [...head];
        let finished = false;
        const onAbort = () => stream.destroy(new RequestAbortedError());
        const finish = () => {
          if (finished) return;
          finished = true;
          stopTimers();
          external?.removeEventListener('abort', onAbort);
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
                if (finished) return;
                arm();
                if (chunk.done) {
                  if (contentLength !== null && received < contentLength) {
                    this.destroy(fail('incomplete'));
                  } else {
                    this.push(null);
                  }
                  return;
                }
                received += chunk.value.byteLength;
                windowBytes += chunk.value.byteLength;
                if (received > limit) {
                  this.destroy(fail('too_large'));
                  return;
                }
                this.push(chunk.value);
              },
              (error: unknown) =>
                this.destroy(
                  external?.aborted
                    ? new RequestAbortedError()
                    : fail(tooSlow() ? 'too_slow' : transientFrom(error).reason),
                ),
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
        // Bei Stillstand: Verbindung abbrechen und den Stream mit Fehler beenden
        onIdle = () => {
          idle.abort(new DOMException('Moodle liefert keine Daten mehr', 'TimeoutError'));
          stream.destroy(fail('timeout'));
        };
        onSlow = () => {
          idle.abort(new DOMException('Moodle liefert zu langsam', 'TooSlowError'));
          stream.destroy(fail('too_slow'));
        };
        external?.addEventListener('abort', onAbort, { once: true });
        arm();
        return { stream, contentType, contentLength, filename };
      } catch (error) {
        // Nach dem Start des Streams gehört der Timer dem Stream
        if (!streaming) stopTimers();
        throw error;
      }
    };
    return this.withRetries(label, false, attempt, {
      pool: this.downloadThrottle,
      signal: external,
      retryTimeouts: false,
    });
  }

  private async withRetries<T>(
    label: string,
    write: boolean,
    attempt: (slot: Slot) => Promise<T>,
    options: { pool?: Throttle; signal?: AbortSignal | undefined; retryTimeouts?: boolean } = {},
  ): Promise<T> {
    const delays = write ? [] : this.retryDelaysMs;
    const pool = options.pool ?? this.throttle;
    for (let index = 0; ; index += 1) {
      const release = await pool.acquire(options.signal);
      let kept = false;
      try {
        return await attempt({ release, keep: () => (kept = true) });
      } catch (error) {
        if (!(error instanceof TransientError)) throw error;
        const delay = delays[index];
        // Zeitlimit ohne Wiederholung (Downloads): sonst bis zu 3 x Zeitlimit bis zur Fehlermeldung
        if (delay === undefined || (error.reason === 'timeout' && options.retryTimeouts === false)) {
          throw this.unreachable(label, error.reason, write);
        }
        this.logger?.warn(
          { wsfunction: label, reason: error.reason, retry_in_ms: delay },
          'Moodle-Aufruf wird wiederholt',
        );
        release();
        await this.pause(delay, options.signal);
      } finally {
        if (!kept) release();
      }
    }
  }

  /** Wartet `ms`. Ein Abbruch beendet die Pause sofort (`RequestAbortedError`) */
  private async pause(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) return this.sleep(ms);
    if (signal.aborted) throw new RequestAbortedError();
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new RequestAbortedError());
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([this.sleep(ms), aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
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
    // pluginfile.php: Der Text kann aus einer fremden Datei stammen, darum nicht an die Web-App
    if (wsfunction === 'pluginfile') {
      return new HttpError(502, 'moodle_error', 'Moodle meldet einen Fehler.', {
        wsfunction,
        moodle_errorcode: errorcode,
      });
    }
    return new HttpError(502, 'moodle_error', message || 'Moodle meldet einen Fehler.', {
      wsfunction,
      moodle_errorcode: errorcode,
      moodle_message: message,
    });
  }
}
