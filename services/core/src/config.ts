import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { CORE_PORT } from '@sg/shared';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

/** Laufzeit-Konfiguration aus Umgebungsvariablen (docs/VERTRAEGE.md §1) */
export interface Config {
  dataDir: string;
  databaseUrl: string;
  port: number;
  host: string;
  webDir: string;
  /** Erlaubter CORS-Origin der Entwicklungs-Web-App, leer = kein CORS */
  devWebOrigin: string;
  logLevel: LogLevel;
  /** Moodle-Instanz (SG_MOODLE_URL, 08 §9.1), leer = Moodle-Anbindung aus. Ohne Schrägstrich am Ende */
  moodleUrl: string;
  /** Bonjour-Ankündigung `_studiengehirn._tcp` (VERTRAEGE §12). `SG_BONJOUR=0` schaltet sie ab */
  bonjour: boolean;
  /**
   * Tunnel-Eingang (Unix-Socket) und Schlüsseldatei (UX-12, VERTRAEGE §5, §12 Schritt 8). `SG_TUNNEL=0` schaltet
   * beides ab: kein Socket, keine Schlüsseldatei (sie wird beim Start gelöscht).
   */
  tunnel: boolean;
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

/** Repo-Wurzel relativ zu dieser Datei (services/core/src/config.ts) */
const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

/**
 * Variablen der Claude API (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` …). Der Core liest
 * den Schlüssel nie (VERTRAEGE §20.5): Nur der Worker nutzt ihn.
 */
export function isAnthropicEnvKey(key: string): boolean {
  return key.startsWith('ANTHROPIC_');
}

/**
 * Entfernt alle `ANTHROPIC_*`-Variablen aus der Umgebung des Core (VERTRAEGE §20.5), auch wenn sie schon beim
 * Start gesetzt waren: Kindprozesse, die der Core startet (CLI für Backups), erben sie so nicht. Rückgabe: die Namen
 * der entfernten Variablen (nie die Werte), für einen Log-Hinweis.
 */
export function scrubAnthropicEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed = Object.keys(env).filter(isAnthropicEnvKey);
  for (const key of removed) delete env[key];
  return removed.sort();
}

/**
 * Liest `$SG_DATA_DIR/config/.env` und trägt fehlende Variablen ein.
 * Bereits gesetzte Umgebungsvariablen haben Vorrang. Rückgabe: Pfad der gelesenen Datei oder null.
 * Schlüssel, die mit `ANTHROPIC_` beginnen, werden übersprungen (§20.5: der Core liest den KI-Schlüssel nie).
 */
export function loadDotEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const dataDir = resolve(expandHome(env.SG_DATA_DIR || join(homedir(), 'StudienGehirn')));
  const file = join(dataDir, 'config', '.env');
  if (!existsSync(file)) return null;
  const parsed = parseEnv(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (isAnthropicEnvKey(key)) continue;
    if (env[key] === undefined && value !== undefined) env[key] = value;
  }
  return file;
}

/** true, wenn Gruppe oder andere die Datei lesen/schreiben dürfen (soll 600 sein, 02 §3). Unter Windows immer false. */
export function hasOpenPermissions(file: string): boolean {
  if (process.platform === 'win32') return false;
  return (statSync(file).mode & 0o077) !== 0;
}

/**
 * Prüft `SG_MOODLE_URL` wie die CLI (`infra/sg/src/moodle.ts`) und liefert die normalisierte Form
 * `origin + pathname` ohne Schrägstrich am Ende. Leer = Moodle aus.
 * Backslash, Leer- und Steuerzeichen im Rohwert werden abgelehnt: Der URL-Parser deutet sie still um
 * (`https://evil.test\@moodle...` hat den Host `evil.test`), intern zählt nur die normalisierte Form.
 */
export function normalizeMoodleUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // eslint-disable-next-line no-control-regex -- genau diese Zeichen sollen abgelehnt werden
  if (/[\x00-\x20\x7f-\x9f\\]/.test(trimmed)) {
    throw new Error(
      'SG_MOODLE_URL enthält Backslash, Leer- oder Steuerzeichen. Bitte die Adresse ohne diese Zeichen eintragen.',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('SG_MOODLE_URL ist keine gültige Adresse.');
  }
  // Der Token geht an diese Adresse: nur HTTPS, ohne Zugangsdaten, Query oder Fragment
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    // Nur Host und Pfad nennen: Die Adresse könnte Zugangsdaten enthalten
    throw new Error(
      `SG_MOODLE_URL muss eine reine https-Adresse sein (ohne Zugangsdaten, Query und Fragment): ${parsed.host}${parsed.pathname}`,
    );
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = env.SG_CORE_PORT ? Number(env.SG_CORE_PORT) : CORE_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SG_CORE_PORT ist keine gültige Portnummer: ${env.SG_CORE_PORT}`);
  }
  const logLevel = env.SG_LOG_LEVEL || 'info';
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error(`SG_LOG_LEVEL ist ungültig: ${logLevel} (erlaubt: ${LOG_LEVELS.join(', ')})`);
  }
  const moodleUrl = normalizeMoodleUrl(env.SG_MOODLE_URL || '');
  return {
    dataDir: resolve(expandHome(env.SG_DATA_DIR || join(homedir(), 'StudienGehirn'))),
    databaseUrl: env.DATABASE_URL || 'postgres://sg:sg@127.0.0.1:5432/sg',
    port,
    host: env.SG_CORE_HOST || '0.0.0.0',
    webDir: resolve(expandHome(env.SG_WEB_DIR || join(repoRoot, 'apps', 'web', 'out'))),
    devWebOrigin: (env.SG_DEV_WEB_ORIGIN || '').replace(/\/+$/, ''),
    logLevel: logLevel as LogLevel,
    moodleUrl,
    bonjour: !['0', 'false', 'off', 'nein'].includes((env.SG_BONJOUR ?? '').trim().toLowerCase()),
    tunnel: !['0', 'false', 'off', 'nein'].includes((env.SG_TUNNEL ?? '').trim().toLowerCase()),
  };
}
