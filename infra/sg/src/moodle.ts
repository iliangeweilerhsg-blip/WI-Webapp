// `pnpm sg moodle login|status|logout` (F-MDL-01, T1-26, 08 §9.1).
//
// Sicherheitsregeln:
// - Passwort und Token stehen nie in argv, in Ausgaben oder Fehlermeldungen. Das Passwort wird verdeckt gelesen.
// - Token und Passwort gehen nur per POST im Body an Moodle, nie in einer URL.
// - Nur `https`, keine Weiterleitungen (`redirect: 'manual'`), nur zur konfigurierten Instanz.
// - Der Token landet nur im Schlüsselbund (Dienst wie im Core). `config/moodle.json` enthält keinen Token.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { MoodleStatusSchema, type MoodleStatus } from '@sg/shared';
import type { SgConfig } from './config.ts';
import { KeychainError, SecurityKeychain, type Keychain } from './keychain.ts';
import { InputAborted, InputError, readAll, readLineFromTty } from './secret-input.ts';

/** Dienstname im Schlüsselbund. Muss gleich `KEYCHAIN_SERVICE` in services/core/src/moodle/token-store.ts sein */
export const KEYCHAIN_SERVICE = 'studiengehirn-moodle';
/** Moodle.UP, wenn `SG_MOODLE_URL` weder in der Umgebung noch in `config/.env` steht */
export const DEFAULT_MOODLE_URL = 'https://moodle2.uni-potsdam.de';
/** Dienst für `login/token.php` (die offizielle Moodle-App nutzt ihn auch) */
export const MOODLE_TOKEN_SERVICE = 'moodle_mobile_app';
/** Moodle-Standard `tokenduration`: 12 Wochen */
export const TOKEN_VALIDITY_DAYS = 84;
/** Moodle-Tokens sind 32 Hex-Zeichen (wie im Core) */
export const TOKEN_RE = /^[a-f0-9]{32}$/;
export const MOODLE_TIMEOUT_MS = 30_000;
const CORE_TIMEOUT_MS = 3000;
const GUIDE = 'docs/anleitungen/MOODLE.md';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** Fehler mit einer Meldung, die gefahrlos ausgegeben werden kann (ohne Passwort und Token) */
export class MoodleCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoodleCliError';
  }
}

export interface MoodleIo {
  out(line: string): void;
  err(line: string): void;
  /** Zeile mit Echo (Benutzername) */
  prompt(question: string): Promise<string>;
  /** Zeile ohne Echo (Passwort, Token) */
  promptHidden(question: string): Promise<string>;
  /** Ganze Standardeingabe (für `--token-stdin` aus einer Pipe) */
  readStdin(): Promise<string>;
  stdinIsTty: boolean;
}

export interface MoodleDeps {
  fetch: FetchFn;
  keychain: Keychain;
  io: MoodleIo;
  env: Record<string, string | undefined>;
  now: () => Date;
  /** Konto des Schlüsselbund-Eintrags (macOS-Benutzername, wie in der bisherigen Anleitung) */
  account: string;
  /** Dienst des Schlüsselbund-Eintrags. Echt immer `KEYCHAIN_SERVICE`, Tests nutzen einen eigenen Namen */
  service: string;
}

// ---------------------------------------------------------------------------------------------
// Adresse der Instanz

export interface MoodleUrl {
  url: string;
  source: 'env' | 'dotenv' | 'default';
}

/**
 * Prüft die Adresse wie der Core (services/core/src/config.ts): nur https, ohne Zugangsdaten, Query, Fragment.
 * Zusätzlich verboten: Backslash, Leer- und Steuerzeichen im Rohwert. Der URL-Parser deutet sie stillschweigend um
 * (`https://evil.test\@moodle…` hat den Host `evil.test`, ein Tab wird entfernt), die Anzeige des Rohwerts
 * würde also über das echte Ziel täuschen. Rückgabe ist immer die normalisierte Form `origin + pathname`.
 */
export function validateMoodleUrl(raw: string): string {
  const trimmed = raw.trim();
  // eslint-disable-next-line no-control-regex -- genau diese Zeichen sollen abgelehnt werden
  if (/[\x00-\x20\x7f-\x9f\\]/.test(trimmed)) {
    throw new MoodleCliError(
      'SG_MOODLE_URL enthält Backslash, Leer- oder Steuerzeichen. Bitte die Adresse ohne diese Zeichen eintragen.',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new MoodleCliError('SG_MOODLE_URL ist keine gültige Adresse.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    // Nur Host und Pfad nennen: Die Adresse könnte Zugangsdaten enthalten
    throw new MoodleCliError(
      `SG_MOODLE_URL muss eine reine https-Adresse sein (ohne Zugangsdaten, Query und Fragment): ${parsed.host}${parsed.pathname}`,
    );
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

/** `SG_MOODLE_URL` aus der Umgebung, sonst aus `$SG_DATA_DIR/config/.env`, sonst Moodle.UP */
export function resolveMoodleUrl(env: Record<string, string | undefined>, dataDir: string): MoodleUrl {
  const fromEnv = env.SG_MOODLE_URL?.trim();
  if (fromEnv) return { url: validateMoodleUrl(fromEnv), source: 'env' };
  const file = join(dataDir, 'config', '.env');
  if (existsSync(file)) {
    let fromFile: string | undefined;
    try {
      fromFile = parseEnv(readFileSync(file, 'utf8')).SG_MOODLE_URL?.trim();
    } catch {
      fromFile = undefined;
    }
    if (fromFile) return { url: validateMoodleUrl(fromFile), source: 'dotenv' };
  }
  return { url: DEFAULT_MOODLE_URL, source: 'default' };
}

// ---------------------------------------------------------------------------------------------
// Token aus der Eingabe

/**
 * Nimmt einen Token (32 Hex-Zeichen) oder den Link der Moodle-App an:
 * `moodlemobile://token=<base64(signatur:::token[:::privatetoken])>`. null = nichts Brauchbares.
 */
export function parseTokenInput(raw: string): string | null {
  const value = raw.trim();
  if (TOKEN_RE.test(value)) return value;
  const match = /^moodlemobile:\/\/token=([A-Za-z0-9+/=%_-]+)$/.exec(value);
  if (!match?.[1]) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(decodeURIComponent(match[1]), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const token = decoded.split(':::')[1];
  return token !== undefined && TOKEN_RE.test(token) ? token : null;
}

// ---------------------------------------------------------------------------------------------
// HTTP zu Moodle

/** Fehlercode einer Netzwerkausnahme, ohne deren Text (könnte Daten enthalten) */
function networkReason(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return 'Zeitlimit';
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const code = cause && typeof cause.code === 'string' ? cause.code : '';
  return /^[A-Z0-9_]{2,40}$/.test(code) ? code : 'Netzwerkfehler';
}

/** Moodle-Fehlercodes sind kurze Bezeichner. Alles andere wird nicht ausgegeben */
function safeErrorcode(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value) ? value : null;
}

/** Entfernt Steuerzeichen aus Texten von Moodle, bevor sie im Terminal erscheinen */
export function printable(value: unknown): string {
  // eslint-disable-next-line no-control-regex -- genau diese Steuerzeichen sollen entfernt werden
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 200) : '';
}

/**
 * POST an `<baseUrl>/<path>` mit Formular-Body. Folgt keiner Weiterleitung (sonst ginge der Body an das neue
 * Ziel) und nennt in Fehlern nur Pfad und Grund, nie Body oder Antworttext.
 */
export async function postForm(
  fetchFn: FetchFn,
  baseUrl: string,
  path: string,
  params: [string, string][],
): Promise<unknown> {
  const base = new URL(validateMoodleUrl(baseUrl));
  const target = new URL(`${base.href.replace(/\/+$/, '')}/${path}`);
  if (target.origin !== base.origin) throw new MoodleCliError('Ziel liegt nicht auf der Moodle-Instanz.');
  let response: Response;
  try {
    response = await fetchFn(target.href, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(MOODLE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new MoodleCliError(`Moodle ist nicht erreichbar (${path}: ${networkReason(error)}).`);
  }
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    await response.body?.cancel().catch(() => {});
    throw new MoodleCliError(
      `Moodle leitet ${path} weiter (HTTP ${response.status}). Der Weiterleitung wird nicht gefolgt. ` +
        'SG_MOODLE_URL muss die endgültige https-Adresse sein.',
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new MoodleCliError(`Moodle antwortet auf ${path} mit HTTP ${response.status}.`);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new MoodleCliError(`Moodle ist nicht erreichbar (${path}: ${networkReason(error)}).`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MoodleCliError(`Moodle liefert auf ${path} kein JSON (falsche Adresse oder Wartungsmodus?).`);
  }
}

/** Holt den Token über `login/token.php`. Gibt nur den Token zurück, `privatetoken` wird verworfen */
export async function fetchToken(
  fetchFn: FetchFn,
  baseUrl: string,
  username: string,
  password: string,
): Promise<string> {
  const data = (await postForm(fetchFn, baseUrl, 'login/token.php', [
    ['username', username],
    ['password', password],
    ['service', MOODLE_TOKEN_SERVICE],
  ])) as { token?: unknown; errorcode?: unknown } | null;
  if (data && typeof data.token === 'string' && TOKEN_RE.test(data.token)) return data.token;
  // Den Fehlertext von Moodle nie ausgeben: Er könnte Eingaben wiederholen
  const code = safeErrorcode(data?.errorcode);
  const fallback = `Anmeldung per Passwort nicht möglich? Token von Hand holen: pnpm sg moodle login --token-stdin (${GUIDE}).`;
  if (code === 'invalidlogin') {
    throw new MoodleCliError(
      `Moodle lehnt die Anmeldung ab (invalidlogin): Benutzername oder Passwort falsch, oder das Konto meldet sich nur über SSO an. ${fallback}`,
    );
  }
  if (code) throw new MoodleCliError(`Moodle verweigert den Token (${code}). ${fallback}`);
  throw new MoodleCliError(`Moodle liefert keinen gültigen Token. ${fallback}`);
}

export interface SiteInfo {
  siteName: string;
  siteUrl: string;
  fullName: string;
  userId: number | null;
}

/** Prüft den Token mit `core_webservice_get_site_info` */
export async function fetchSiteInfo(fetchFn: FetchFn, baseUrl: string, token: string): Promise<SiteInfo> {
  const data = (await postForm(fetchFn, baseUrl, 'webservice/rest/server.php', [
    ['wstoken', token],
    ['wsfunction', 'core_webservice_get_site_info'],
    ['moodlewsrestformat', 'json'],
  ])) as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') throw new MoodleCliError('Moodle liefert keine Seiteninfo.');
  if ('exception' in data || 'errorcode' in data) {
    const code = safeErrorcode(data.errorcode);
    if (code === 'invalidtoken' || code === 'invalidtimedtoken') {
      throw new MoodleCliError(
        `Moodle lehnt den Token ab (${code}). Bitte einen neuen Token holen (${GUIDE}).`,
      );
    }
    throw new MoodleCliError(`Moodle meldet einen Fehler (${code ?? 'unbekannt'}).`);
  }
  return {
    siteName: printable(data.sitename),
    siteUrl: printable(data.siteurl),
    fullName: printable(data.fullname),
    userId:
      typeof data.userid === 'number' && Number.isInteger(data.userid) && data.userid > 0
        ? data.userid
        : null,
  };
}

// ---------------------------------------------------------------------------------------------
// config/moodle.json (ohne Token)

export interface MoodleMeta {
  site_url: string;
  user_id?: number;
  token_valid_until: string;
  created_at: string;
}

export function moodleMetaPath(dataDir: string): string {
  return join(dataDir, 'config', 'moodle.json');
}

/** Schreibt atomar (temporäre Datei + rename) mit Rechten 600. rename ersetzt auch einen Symlink, folgt ihm nicht */
export async function writeMoodleMeta(dataDir: string, meta: MoodleMeta): Promise<void> {
  const dir = join(dataDir, 'config');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.moodle.json.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(tmp, moodleMetaPath(dataDir));
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

async function readMoodleMeta(dataDir: string): Promise<Partial<MoodleMeta>> {
  try {
    const parsed = JSON.parse(await readFile(moodleMetaPath(dataDir), 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Partial<MoodleMeta>) : {};
  } catch {
    return {};
  }
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `JJJJ-MM-TT`, ein echtes Datum, nicht vor heute (UTC) */
export function parseValidUntil(value: string, today: Date): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || isoDate(date) !== value) return null;
  return value >= isoDate(today) ? value : null;
}

// ---------------------------------------------------------------------------------------------
// Befehle

export interface LoginOptions {
  tokenStdin: boolean;
  validUntil: string | null;
}

/**
 * Optionen von `moodle login`. Unbekannte Optionen werden ohne ihren Wert gemeldet: Wer versehentlich
 * `--token <wert>` tippt, soll den Wert nicht noch einmal im Terminal sehen.
 */
export function parseLoginArgs(args: string[], today: Date): LoginOptions | { error: string } {
  let tokenStdin = false;
  let validUntil: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg === '--token-stdin') {
      tokenStdin = true;
      continue;
    }
    if (arg === '--gueltig-bis' || arg.startsWith('--gueltig-bis=')) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[(i += 1)];
      const parsed = value === undefined ? null : parseValidUntil(value, today);
      if (!parsed)
        return { error: '--gueltig-bis braucht ein Datum JJJJ-MM-TT, nicht in der Vergangenheit.' };
      validUntil = parsed;
      continue;
    }
    const name = arg.startsWith('-') ? arg.split('=')[0] : null;
    return {
      error:
        (name ? `Unbekannte Option "${name}".` : 'Unerwartetes Argument.') +
        ' Erlaubt: --token-stdin, --gueltig-bis JJJJ-MM-TT. Passwort und Token gehören nie in die Befehlszeile.',
    };
  }
  return { tokenStdin, validUntil };
}

/** Konto für den Schlüsselbund: macOS-Kurzname, sonst ein fester Name */
export function keychainAccount(username: string): string {
  return /^[A-Za-z0-9._-]{1,64}$/.test(username) ? username : 'studiengehirn';
}

async function obtainToken(deps: MoodleDeps, url: string, options: LoginOptions): Promise<string> {
  const { io } = deps;
  if (options.tokenStdin) {
    const raw = io.stdinIsTty
      ? await io.promptHidden('Token oder moodlemobile://-Link einfügen (wird nicht angezeigt): ')
      : await io.readStdin();
    const token = parseTokenInput(raw);
    if (!token) {
      throw new MoodleCliError(
        `Das ist kein Moodle-Token (32 Zeichen 0-9 und a-f) und kein moodlemobile://-Link. Siehe ${GUIDE}.`,
      );
    }
    return token;
  }
  if (!io.stdinIsTty) {
    throw new MoodleCliError(
      'Das Passwort wird nur im Terminal abgefragt. Ohne Terminal: Token mit --token-stdin übergeben.',
    );
  }
  const username = (await io.prompt('Moodle-Benutzername: ')).trim();
  if (!username) throw new MoodleCliError('Kein Benutzername eingegeben.');
  const password = await io.promptHidden('Passwort (wird nicht angezeigt): ');
  if (!password) throw new MoodleCliError('Kein Passwort eingegeben.');
  io.out(`Hole den Token von ${url} …`);
  return fetchToken(deps.fetch, url, username, password);
}

/** Speichert und liest zurück, genau wie der Core liest (nur Dienst). Räumt fremde Einträge zum Dienst auf */
async function storeToken(deps: MoodleDeps, token: string): Promise<void> {
  await deps.keychain.store(deps.service, deps.account, token);
  if ((await deps.keychain.read(deps.service)) === token) return;
  // Ein anderer Eintrag zum selben Dienst (z. B. anderes Konto) überdeckt den neuen: alle löschen, neu anlegen
  await deps.keychain.removeAll(deps.service);
  await deps.keychain.store(deps.service, deps.account, token);
  if ((await deps.keychain.read(deps.service)) !== token) {
    throw new MoodleCliError('Der Token ließ sich nicht im Schlüsselbund ablegen (Rücklesen stimmt nicht).');
  }
}

export async function moodleLogin(cfg: SgConfig, args: string[], deps: MoodleDeps): Promise<number> {
  const { io } = deps;
  const today = deps.now();
  const options = parseLoginArgs(args, today);
  if ('error' in options) {
    io.err(options.error);
    return 1;
  }
  const { url, source } = resolveMoodleUrl(deps.env, cfg.dataDir);
  io.out(`Moodle-Instanz: ${url}`);
  const token = await obtainToken(deps, url, options);
  const info = await fetchSiteInfo(deps.fetch, url, token);
  // Den Core vor dem Ablegen fragen: Danach könnte schon diese Abfrage den neuen Token laden und den Zustand verdecken
  const coreBefore = await fetchCoreStatus(cfg, deps.fetch);
  await storeToken(deps, token);
  const validUntil =
    options.validUntil ?? isoDate(new Date(today.getTime() + TOKEN_VALIDITY_DAYS * 24 * 60 * 60 * 1000));
  await writeMoodleMeta(cfg.dataDir, {
    site_url: url,
    ...(info.userId !== null ? { user_id: info.userId } : {}),
    token_valid_until: validUntil,
    created_at: today.toISOString(),
  });
  io.out(
    `Verbunden mit ${info.siteName || '(ohne Namen)'} (${info.siteUrl || url}) als ${info.fullName || '?'}.`,
  );
  io.out(`Token im Schlüsselbund gespeichert (Dienst ${deps.service}), gültig bis etwa ${validUntil}.`);
  if (!options.validUntil) {
    io.out(
      'Zeigt Moodle unter Profil → Einstellungen → Sicherheitsschlüssel ein anderes Datum, erneut mit --gueltig-bis.',
    );
  }
  if (source === 'default') {
    io.out(
      `Damit der Core Moodle nutzt: SG_MOODLE_URL=${url} in ${join(cfg.dataDir, 'config', '.env')} eintragen.`,
    );
  }
  // Läuft der Core, übernimmt er den neuen Token jetzt. Ältere Cores kennen die Route nicht: dann der Hinweis
  const rechecked = coreBefore ? await recheckCore(cfg, deps.fetch) : null;
  if (rechecked === 'unsupported') {
    const hint = coreHint(coreBefore);
    if (hint) io.out(hint);
  } else if (rechecked === 'timeout') {
    // Ein Core ohne die Route antwortet sofort mit 404. Langsam ist Moodle: Der Core hat die Caches schon geleert
    io.out(`Der Core prüft Moodle noch neu (keine Antwort nach ${CORE_TIMEOUT_MS / 1000} Sekunden).`);
  } else if (rechecked?.site_url === null) {
    // Ohne SG_MOODLE_URL liest der Core keinen Token, auch nicht nach der Neuprüfung
    io.out('Der Core läuft ohne SG_MOODLE_URL. Nach dem Eintrag: pnpm sg stop && pnpm sg start.');
  } else if (rechecked) {
    io.out(`Der Core hat Moodle neu geprüft. Zustand: ${STATE_TEXT[rechecked.state]}.`);
  } else if (coreBefore) {
    // Core antwortete eben noch, die Neuprüfung schlug aber fehl: Hinweis wie bei einem älteren Core
    const hint = coreHint(coreBefore);
    if (hint) io.out(hint);
  }
  io.out('Prüfen: pnpm sg moodle status');
  return 0;
}

/**
 * Hinweis, wenn der Core läuft, abgeleitet aus seinem Zustand vor dem Login. Nur der Rückfall für Cores ohne
 * `POST /moodle/recheck` (404): Dort merkt sich der Core einen gefundenen Token bis zum Neustart oder bis Moodle ihn
 * ablehnt (dann liest er beim nächsten Status-Abruf neu, „ungültig“ gilt 60 s), einen fehlenden 30 s. Ohne `SG_MOODLE_URL` liest er gar keinen Token.
 * Darum nur ein Hinweis, nie ein Fehler: Der Exit-Code bleibt 0, auch wenn der Core nicht antwortet (`null`).
 */
export function coreHint(before: MoodleStatus | null): string | null {
  if (!before) return null;
  if (before.site_url === null) {
    return 'Der Core läuft ohne SG_MOODLE_URL. Nach dem Eintrag: pnpm sg stop && pnpm sg start.';
  }
  switch (before.state) {
    case 'nicht_eingerichtet':
      return 'Der Core läuft und liest den neuen Token spätestens nach etwa 30 Sekunden.';
    case 'ungueltig':
    case 'abgelaufen':
      return 'Der Core läuft und liest den neuen Token spätestens nach etwa einer Minute.';
    default:
      return 'Der Core läuft und nutzt noch den bisherigen Token: pnpm sg stop && pnpm sg start.';
  }
}

export async function fetchCoreStatus(cfg: SgConfig, fetchFn: FetchFn): Promise<MoodleStatus | null> {
  try {
    const response = await fetchFn(`http://127.0.0.1:${cfg.corePort}/api/v1/moodle/status`, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed = MoodleStatusSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * `POST /moodle/recheck`: der Core leert Token- und Status-Cache und prüft neu. `'unsupported'` = älterer Core (404),
 * `'timeout'` = keine Antwort nach `CORE_TIMEOUT_MS` (Moodle langsam, der Core prüft weiter). Alles andere (Core aus,
 * Fehler, falsche Antwort) ergibt `null`. Wirft nie, und Antworttexte werden nie ausgegeben.
 */
export async function recheckCore(
  cfg: SgConfig,
  fetchFn: FetchFn,
): Promise<MoodleStatus | 'unsupported' | 'timeout' | null> {
  try {
    const response = await fetchFn(`http://127.0.0.1:${cfg.corePort}/api/v1/moodle/recheck`, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
    });
    if (response.status === 404) {
      await response.body?.cancel().catch(() => {});
      return 'unsupported';
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const parsed = MoodleStatusSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch (error) {
    return error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : null;
  }
}

const STATE_TEXT: Record<MoodleStatus['state'], string> = {
  nicht_eingerichtet: 'nicht eingerichtet',
  ok: 'ok',
  laeuft_bald_ab: 'läuft bald ab',
  abgelaufen: 'abgelaufen',
  ungueltig: 'ungültig (Moodle lehnt den Token ab)',
  nicht_erreichbar: 'Moodle nicht erreichbar',
};

export async function moodleStatus(cfg: SgConfig, args: string[], deps: MoodleDeps): Promise<number> {
  const { io } = deps;
  if (args.length > 0) {
    io.err('moodle status kennt keine Optionen.');
    return 1;
  }
  const status = await fetchCoreStatus(cfg, deps.fetch);
  if (status) {
    io.out(`Zustand (laut Core): ${STATE_TEXT[status.state]}`);
    if (status.site_name || status.site_url) {
      io.out(`Seite: ${printable(status.site_name) || '?'} (${printable(status.site_url) || '?'})`);
    }
    if (status.user_fullname) io.out(`Angemeldet als: ${printable(status.user_fullname)}`);
    if (status.token_valid_until) io.out(`Token gültig bis: ${status.token_valid_until}`);
    if (status.state !== 'ok' && status.state !== 'laeuft_bald_ab')
      io.out(`Einrichten: pnpm sg moodle login (${GUIDE})`);
    return status.state === 'ok' || status.state === 'laeuft_bald_ab' ? 0 : 1;
  }
  // Core läuft nicht: nur nachsehen, ob es einen Eintrag gibt. Den Token liest allein der Core (VERTRAEGE §1)
  const exists = await deps.keychain.exists(deps.service);
  const meta = await readMoodleMeta(cfg.dataDir);
  io.out('Der Core läuft nicht, darum ohne Prüfung bei Moodle.');
  io.out(`Schlüsselbund (Dienst ${deps.service}): ${exists ? 'Eintrag vorhanden' : 'kein Eintrag'}`);
  if (exists && typeof meta.token_valid_until === 'string')
    io.out(`Token gültig bis: ${printable(meta.token_valid_until)}`);
  if (!exists) io.out(`Einrichten: pnpm sg moodle login (${GUIDE})`);
  return exists ? 0 : 1;
}

export async function moodleLogout(cfg: SgConfig, args: string[], deps: MoodleDeps): Promise<number> {
  const { io } = deps;
  if (args.length > 0) {
    io.err('moodle logout kennt keine Optionen.');
    return 1;
  }
  const removed = await deps.keychain.removeAll(deps.service);
  await unlink(moodleMetaPath(cfg.dataDir)).catch(() => {});
  io.out(
    removed > 0
      ? `Token aus dem Schlüsselbund gelöscht (${removed} Eintrag/Einträge, Dienst ${deps.service}).`
      : `Kein Eintrag im Schlüsselbund (Dienst ${deps.service}).`,
  );
  io.out('Ein laufender Core nutzt den Token bis zum Neustart weiter: pnpm sg stop && pnpm sg start.');
  io.out(
    'Den Token selbst ungültig machen: in Moodle unter Profil → Einstellungen → Sicherheitsschlüssel zurücksetzen.',
  );
  return 0;
}

const USAGE =
  'Aufruf: pnpm sg moodle login [--token-stdin] [--gueltig-bis JJJJ-MM-TT] | moodle status | moodle logout';

/** Einstieg für `pnpm sg moodle …`. Fehler werden nur mit sicheren Meldungen ausgegeben */
export async function moodleCommand(cfg: SgConfig, rest: string[], deps: MoodleDeps): Promise<number> {
  const [sub, ...args] = rest;
  try {
    switch (sub) {
      case 'login':
        return await moodleLogin(cfg, args, deps);
      case 'status':
        return await moodleStatus(cfg, args, deps);
      case 'logout':
        return await moodleLogout(cfg, args, deps);
      default:
        deps.io.err(sub === undefined ? USAGE : `Unbekannter Unterbefehl. ${USAGE}`);
        return 1;
    }
  } catch (error) {
    if (error instanceof InputAborted) {
      deps.io.err('Abgebrochen.');
      return 130;
    }
    if (error instanceof MoodleCliError || error instanceof KeychainError || error instanceof InputError) {
      deps.io.err(error.message);
      return 1;
    }
    // Unerwartete Fehler: nur Typ und Code nennen, nie die Meldung (sie könnte Eingaben enthalten)
    const code = (error as { code?: unknown } | null)?.code;
    deps.io.err(
      `Unerwarteter Fehler (${error instanceof Error ? error.name : 'unbekannt'}${typeof code === 'string' ? `, ${code}` : ''}).`,
    );
    return 1;
  }
}

/** Echte Abhängigkeiten: globales fetch, `security`, Terminal */
export function realMoodleDeps(): MoodleDeps {
  const stdin = process.stdin;
  return {
    fetch: (url, init) => fetch(url, init),
    keychain: new SecurityKeychain(),
    io: {
      out: (line) => console.log(`[sg] ${line}`),
      err: (line) => console.error(`[sg] ${line}`),
      prompt: (question) => readLineFromTty(stdin, process.stdout, question, { echo: true }),
      promptHidden: (question) => readLineFromTty(stdin, process.stdout, question, { echo: false }),
      readStdin: () => readAll(stdin),
      stdinIsTty: stdin.isTTY === true,
    },
    env: process.env,
    now: () => new Date(),
    account: keychainAccount(safeUsername()),
    service: KEYCHAIN_SERVICE,
  };
}

function safeUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}
