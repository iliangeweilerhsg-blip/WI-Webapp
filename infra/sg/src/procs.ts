// Hilfen für Kindprozesse: Log-Präfixe, PID-Dateien, Datenordner.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_SUBDIRS, type SgConfig } from './config.ts';

export type ServiceName = 'core' | 'worker';

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

export function pidFile(cfg: SgConfig, name: ServiceName): string {
  return join(cfg.runDir, `${name}.pid`);
}

export function writePid(cfg: SgConfig, name: ServiceName, pid: number): void {
  mkdirSync(cfg.runDir, { recursive: true });
  writeFileSync(pidFile(cfg, name), `${pid}\n`);
}

export function readPid(cfg: SgConfig, name: ServiceName): number | null {
  try {
    const n = Number(readFileSync(pidFile(cfg, name), 'utf8').trim());
    return Number.isInteger(n) && n > 1 ? n : null;
  } catch {
    return null;
  }
}

export function removePid(cfg: SgConfig, name: ServiceName): void {
  rmSync(pidFile(cfg, name), { force: true });
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Sendet ein Signal an die ganze Prozessgruppe (Kinder laufen mit detached: true). */
export function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Prozess existiert nicht mehr.
    }
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Beendet eine Prozessgruppe mit SIGTERM, nach `graceMs` mit SIGKILL. Gibt true zurück, wenn sie weg ist. */
export async function terminateGroup(pid: number, graceMs = 15000): Promise<boolean> {
  if (!isAlive(pid)) return true;
  signalGroup(pid, 'SIGTERM');
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(200);
  }
  signalGroup(pid, 'SIGKILL');
  await sleep(300);
  return !isAlive(pid);
}

/** Legt die Ordnerstruktur aus 08 §7 an. `config/` bekommt Rechte 700. */
export function ensureDataDir(cfg: SgConfig): void {
  mkdirSync(cfg.dataDir, { recursive: true });
  for (const sub of DATA_SUBDIRS) {
    const path = join(cfg.dataDir, sub);
    mkdirSync(path, { recursive: true, mode: sub === 'config' ? 0o700 : 0o755 });
  }
  // mkdir respektiert umask und vorhandene Ordner; Rechte für config/ erzwingen.
  chmodSync(join(cfg.dataDir, 'config'), 0o700);
}

export function hasFile(path: string): boolean {
  return existsSync(path);
}
