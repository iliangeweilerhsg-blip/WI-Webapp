// Hilfen für Kindprozesse: Log-Präfixe, PID-Dateien mit Identität, Prozessgruppen, Datenordner.
//
// Core und Worker laufen als eigene Prozessgruppe (detached, pgid === pid des Startprozesses
// pnpm bzw. uv). Lebendigkeit und Beenden gelten immer für die ganze Gruppe, weil pnpm/uv
// Enkelprozesse (node, python) starten, die das Terminal-Signal sonst überleben würden.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_SUBDIRS, type SgConfig } from './config.ts';

export type ServiceName = 'core' | 'worker' | 'tunnel';

/** Zerlegt einen Strom in Zeilen und setzt jeder Zeile ein Präfix voran. */
export function createLinePrefixer(prefix: string, write: (line: string) => void) {
  let buffer = '';
  return {
    push(chunk: string): void {
      buffer += chunk;
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? '';
      for (const line of parts) write(`${prefix} ${line}`);
    },
    flush(): void {
      if (buffer !== '') write(`${prefix} ${buffer}`);
      buffer = '';
    },
  };
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Prozessgruppen

/** true, solange mindestens ein Prozess der Gruppe existiert (ESRCH = weg). */
export function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** Signal an die ganze Gruppe. Kein Fallback auf die Einzel-PID (die könnte wiederverwendet sein). */
export function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // Gruppe existiert nicht mehr (oder gehört uns nicht).
  }
}

function signalLeader(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // Prozess existiert nicht mehr.
  }
}

export interface TerminateOptions {
  /** Gnadenfrist in ms, danach SIGKILL an die ganze Gruppe. */
  graceMs: number;
  /** SIGTERM nur an den Anführer (z. B. uv, das an Python weiterleitet), Lebendigkeit weiter über die Gruppe. */
  leaderOnly?: boolean;
  /** Liefert true, wenn sofort hart beendet werden soll (zweites Strg+C). */
  force?: () => boolean;
  /** Wird einmal aufgerufen, wenn das Beenden länger als `noticeAfterMs` dauert. */
  onWait?: () => void;
  noticeAfterMs?: number;
  /** Wartezeit nach SIGKILL, bis die Gruppe weg sein muss. */
  killWaitMs?: number;
  /** Kein eigenes SIGTERM senden, nur warten (jemand anderes, z. B. `sg stop`, hat schon signalisiert). */
  waitOnly?: boolean;
}

/** Beendet eine Prozessgruppe. Gibt true zurück, wenn danach kein Prozess der Gruppe mehr existiert. */
export async function terminateGroup(pgid: number, opts: TerminateOptions): Promise<boolean> {
  if (!groupAlive(pgid)) return true;
  if (!opts.waitOnly) {
    if (opts.leaderOnly) signalLeader(pgid, 'SIGTERM');
    else signalGroup(pgid, 'SIGTERM');
  }

  const start = Date.now();
  const deadline = start + opts.graceMs;
  const noticeAt = start + (opts.noticeAfterMs ?? 3000);
  let noticed = false;
  while (Date.now() < deadline && !opts.force?.()) {
    if (!groupAlive(pgid)) return true;
    if (!noticed && Date.now() >= noticeAt) {
      noticed = true;
      opts.onWait?.();
    }
    await sleep(50);
  }
  if (!groupAlive(pgid)) return true;

  signalGroup(pgid, 'SIGKILL');
  const killDeadline = Date.now() + (opts.killWaitMs ?? 3000);
  while (Date.now() < killDeadline) {
    if (!groupAlive(pgid)) return true;
    await sleep(50);
  }
  return !groupAlive(pgid);
}

// ---------------------------------------------------------------- Identität / PID-Dateien

export interface ProcessInfo {
  /** Startzeit + Kommando laut `ps`. Unterscheidet einen Prozess von einem mit wiederverwendeter PID. */
  identity: string;
  pgid: number;
}

export type ProcessInfoFn = (pid: number) => ProcessInfo | null;

export const processInfo: ProcessInfoFn = (pid) => {
  const env = { ...process.env, LC_ALL: 'C' };
  try {
    const identity = execFileSync('ps', ['-o', 'lstart=,command=', '-p', String(pid)], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const pgid = Number(
      execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
    if (identity === '' || !Number.isInteger(pgid)) return null;
    return { identity, pgid };
  } catch {
    return null;
  }
};

interface PidRecord {
  pid: number;
  identity: string;
}

export function pidFile(cfg: SgConfig, name: ServiceName): string {
  return join(cfg.runDir, `${name}.pid`);
}

/** Schreibt PID und Identität. Wirft, wenn die Identität nicht bestimmbar ist (dann wäre `sg stop` unsicher). */
export function writePid(
  cfg: SgConfig,
  name: ServiceName,
  pid: number,
  info: ProcessInfoFn = processInfo,
): void {
  const i = info(pid);
  if (!i) throw new Error(`Prozess ${pid} (${name}) ist nicht lesbar (ps fehlgeschlagen)`);
  mkdirSync(cfg.runDir, { recursive: true });
  const record: PidRecord = { pid, identity: i.identity };
  writeFileSync(pidFile(cfg, name), JSON.stringify(record) + '\n');
}

export function removePid(cfg: SgConfig, name: ServiceName): void {
  rmSync(pidFile(cfg, name), { force: true });
}

/**
 * Liefert die PID (= Prozessgruppen-ID) eines laufenden, von sg gestarteten Dienstes.
 * Stimmt Identität oder pgid nicht, ist der Eintrag veraltet: Datei wird gelöscht, es wird nichts angefasst.
 */
export function readService(
  cfg: SgConfig,
  name: ServiceName,
  info: ProcessInfoFn = processInfo,
): number | null {
  let record: PidRecord;
  try {
    const parsed: unknown = JSON.parse(readFileSync(pidFile(cfg, name), 'utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('pid' in parsed) ||
      !('identity' in parsed) ||
      typeof parsed.pid !== 'number' ||
      typeof parsed.identity !== 'string' ||
      !Number.isInteger(parsed.pid) ||
      parsed.pid <= 1
    ) {
      removePid(cfg, name);
      return null;
    }
    record = { pid: parsed.pid, identity: parsed.identity };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') removePid(cfg, name);
    return null;
  }
  const i = info(record.pid);
  if (!i || i.pgid !== record.pid || i.identity !== record.identity) {
    removePid(cfg, name);
    return null;
  }
  return record.pid;
}

// ---------------------------------------------------------------- Stop-Marker

/** Marker, den `sg stop` setzt, damit ein laufendes `sg start` das Ende als gewollt erkennt. */
export function stopMarker(cfg: SgConfig): string {
  return join(cfg.runDir, 'stopping');
}

export function setStopMarker(cfg: SgConfig): void {
  mkdirSync(cfg.runDir, { recursive: true });
  writeFileSync(stopMarker(cfg), `${process.pid}\n`);
}

export function clearStopMarker(cfg: SgConfig): void {
  rmSync(stopMarker(cfg), { force: true });
}

export function stopRequested(cfg: SgConfig): boolean {
  return existsSync(stopMarker(cfg));
}

// ---------------------------------------------------------------- Datenordner

/** Legt die Ordnerstruktur aus 08 §7 an. Datenordner und `config/` bekommen Rechte 700. */
export function ensureDataDir(cfg: SgConfig): void {
  mkdirSync(cfg.dataDir, { recursive: true, mode: 0o700 });
  chmodSync(cfg.dataDir, 0o700);
  for (const sub of DATA_SUBDIRS) {
    mkdirSync(join(cfg.dataDir, sub), { recursive: true, mode: sub === 'config' ? 0o700 : 0o755 });
  }
  // mkdir respektiert umask und vorhandene Ordner; Rechte für config/ erzwingen.
  chmodSync(join(cfg.dataDir, 'config'), 0o700);
}

export function hasFile(path: string): boolean {
  return existsSync(path);
}
