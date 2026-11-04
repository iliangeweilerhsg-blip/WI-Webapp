// Konfiguration der CLI: Umgebungsvariablen und Pfade laut docs/VERTRAEGE.md §1 und §4.
import { join, resolve } from 'node:path';

export interface SgConfig {
  repoRoot: string;
  dataDir: string;
  databaseUrl: string;
  corePort: number;
  webDir: string;
  composeFile: string;
  runDir: string;
  logDir: string;
  /** Gnadenfrist beim Beenden des Workers (er beendet erst den laufenden Job). */
  workerStopTimeoutS: number;
}

export const CORE_STOP_TIMEOUT_S = 15;
export const DEFAULT_WORKER_STOP_TIMEOUT_S = 120;

export const DEFAULT_CORE_PORT = 4710;
export const DB_PORT = 5432;
export const DEFAULT_DATABASE_URL = 'postgres://sg:sg@127.0.0.1:5432/sg';

/** Unterordner des Datenordners (08 §7). `config` bekommt Rechte 700, der Rest 755. */
export const DATA_SUBDIRS = [
  'config',
  'media/decks',
  'media/sheets',
  'media/recordings',
  'media/photos',
  'media/pages',
  'media/imports',
  'media/videos',
  'vault',
  'backups',
  'logs',
  'run',
] as const;

export function parsePositiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`Ungültiger Wert für ${name}: "${value}" (ganze Zahl ≥ 1)`);
  return n;
}

export function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Ungültiger Port "${value}" (erlaubt: 1-65535)`);
  }
  return n;
}

/** Ersetzt ein führendes `~` durch das Home-Verzeichnis. */
export function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return path;
}

export function resolveConfig(
  env: Record<string, string | undefined>,
  home: string,
  repoRoot: string,
): SgConfig {
  const dataDir = resolve(expandHome(env.SG_DATA_DIR?.trim() || '~/StudienGehirn', home));
  const webDir = resolve(env.SG_WEB_DIR?.trim() || join(repoRoot, 'apps', 'web', 'out'));
  return {
    repoRoot,
    dataDir,
    databaseUrl: env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL,
    corePort: parsePort(env.SG_CORE_PORT, DEFAULT_CORE_PORT),
    webDir,
    composeFile: join(repoRoot, 'infra', 'docker-compose.yml'),
    runDir: join(dataDir, 'run'),
    logDir: join(dataDir, 'logs'),
    workerStopTimeoutS: parsePositiveInt(
      'SG_WORKER_STOP_TIMEOUT_S',
      env.SG_WORKER_STOP_TIMEOUT_S,
      DEFAULT_WORKER_STOP_TIMEOUT_S,
    ),
  };
}

/** Umgebung für Core und Worker (Verträge §1). Bestehende Werte der Shell bleiben erhalten. */
export function childEnv(cfg: SgConfig, base: Record<string, string | undefined>): Record<string, string> {
  const merged: Record<string, string | undefined> = {
    ...base,
    SG_DATA_DIR: cfg.dataDir,
    DATABASE_URL: cfg.databaseUrl,
    SG_CORE_PORT: String(cfg.corePort),
    SG_WEB_DIR: cfg.webDir,
  };
  return Object.fromEntries(Object.entries(merged).filter((e): e is [string, string] => e[1] !== undefined));
}

export function healthUrl(cfg: SgConfig): string {
  return `http://127.0.0.1:${cfg.corePort}/api/v1/health`;
}

export function appUrl(cfg: SgConfig): string {
  return `http://localhost:${cfg.corePort}`;
}
