// `sg restore` belegt `run/core.lock` selbst, solange es die Daten austauscht (#316): Ein Core, der in dieser Zeit
// startet, erkennt die Datei als belegt und beendet sich wie bei einem zweiten Core.
//
// Das Verfahren ist das des Core (`services/core/src/lib/instance-lock.ts`): Zwischendatei mit `<pid>\n`, dann
// atomar per `link` einhängen, veraltete Datei (PID tot) nur unter der Übernahme-Sperre `core.lock.takeover` und
// nur bei gleichem Inode wegräumen, Freigabe nur, wenn die eigene PID in der Datei steht. `sg` hängt bewusst nicht
// vom Paket des Core ab (läuft vor `pnpm install`), darum steht hier eine eigene, kleine Fassung. Dass beide
// Fassungen zusammenpassen (Format, belegt/frei, Übernahme), prüft `test/core-lock.test.ts` mit der Funktion des
// Core selbst. Ändert sich das Verfahren dort, muss dieser Test rot werden.
import {
  chmodSync,
  closeSync,
  fstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { processAlive } from './liveness.ts';
import { readSmallRegularFile } from './nofollow.ts';

export class CoreLockHeldError extends Error {
  readonly pid: number;
  readonly lockPath: string;
  constructor(pid: number, lockPath: string) {
    super(`Core läuft bereits (PID ${pid})`);
    this.name = 'CoreLockHeldError';
    this.pid = pid;
    this.lockPath = lockPath;
  }
}

/** Markierung `run/restore.pid` (`<pid>\n`): `sg restore` und der Rückbau legen sie neben `core.lock` ab, solange sie die Sperre halten */
export function restoreMarkerPath(dataDir: string): string {
  return join(dataDir, 'run', 'restore.pid');
}

/** Eine PID-Datei ist `<pid>\n`; mehr wird nie gelesen */
const MARKER_MAX_BYTES = 64;

/**
 * Schreibt die Markierung für die eigene PID (best effort, die Sperre selbst bleibt maßgeblich). Neu angelegt mit
 * `wx` (`O_EXCL`): Ein symbolischer Link an dieser Stelle wird entfernt, nie verfolgt.
 */
export function writeRestoreMarker(dataDir: string, pid: number = process.pid): void {
  try {
    rmSync(restoreMarkerPath(dataDir), { force: true });
    writeFileSync(restoreMarkerPath(dataDir), `${pid}\n`, { mode: 0o600, flag: 'wx' });
  } catch {
    // Nur für die Anzeige
  }
}

export function removeRestoreMarker(dataDir: string, pid: number = process.pid): void {
  try {
    if (readRestoreMarker(dataDir) === pid) rmSync(restoreMarkerPath(dataDir), { force: true });
  } catch {
    // Aufräumen darf nie stören
  }
}

/**
 * PID aus der Markierung, `null` wenn es keine gibt oder sie keine kleine reguläre Datei ist (kein Folgen eines
 * Links, kein Warten an einer FIFO, wie `readLockFileSafe` in `sg doctor`). Nur ein Hinweis: gilt nur, wenn sie der
 * PID in `core.lock` gleicht.
 */
export function readRestoreMarker(dataDir: string): number | null {
  try {
    const buffer = readSmallRegularFile(restoreMarkerPath(dataDir), MARKER_MAX_BYTES);
    return buffer === null ? null : parsePid(buffer.toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Setzt die Markierung zur gehaltenen Sperre. Das zurückgegebene Handle entfernt beim Freigeben zuerst die
 * Markierung, dann die Sperre, auch über `releaseOnSignal` (Strg+C).
 */
export function markRestore(lock: CoreLockHandle, dataDir: string): CoreLockHandle {
  writeRestoreMarker(dataDir);
  return {
    path: lock.path,
    release() {
      removeRestoreMarker(dataDir);
      lock.release();
    },
  };
}

export interface CoreLockHandle {
  readonly path: string;
  /** Gibt die Datei frei, aber nur, wenn sie die eigene PID enthält. Mehrfach aufrufbar. */
  release(): void;
}

export interface CoreLockOptions {
  pid?: number;
  alive?: (pid: number) => boolean;
}

function parsePid(text: string): number | null {
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function readLockPid(path: string): number | null {
  try {
    return parsePid(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

interface LockFile {
  pid: number | null;
  ino: bigint;
}

function readLockFile(path: string): LockFile | null {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    return { ino: fstatSync(fd, { bigint: true }).ino, pid: parsePid(readFileSync(fd, 'utf8')) };
  } finally {
    closeSync(fd);
  }
}

/** Legt `path` mit der PID an, atomar und nie leer. `false`, wenn die Datei schon existiert */
function createWithPid(path: string, pid: number): boolean {
  const temp = `${path}.${pid}.tmp`;
  rmSync(temp, { force: true });
  writeFileSync(temp, `${pid}\n`, { mode: 0o600, flag: 'wx' });
  try {
    linkSync(temp, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  } finally {
    rmSync(temp, { force: true });
  }
}

/** Räumt `path` weg, aber nur, wenn es noch die Datei mit diesem Inode ist; sonst wird sie zurückgelegt */
function removeIfSame(path: string, ino: bigint, pid: number): void {
  const grave = `${path}.stale.${pid}`;
  try {
    renameSync(path, grave);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  try {
    if (statSync(grave, { bigint: true }).ino !== ino) {
      try {
        linkSync(grave, path);
      } catch {
        // Inzwischen neu angelegt: Der Besitzer dort entscheidet
      }
    }
  } finally {
    rmSync(grave, { force: true });
  }
}

/**
 * Belegt `<dataDir>/run/core.lock` mit der eigenen PID. Wirft `CoreLockHeldError`, wenn ein anderer Prozess mit
 * lebender PID die Datei hält. Eine veraltete Datei (PID tot) wird übernommen. Andere Fehler werden durchgereicht.
 */
export function acquireCoreLock(dataDir: string, options: CoreLockOptions = {}): CoreLockHandle {
  const pid = options.pid ?? process.pid;
  const alive = options.alive ?? processAlive;
  const dir = join(dataDir, 'run');
  const path = join(dir, 'core.lock');
  const guard = `${path}.takeover`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const heldByOther = (holder: number | null): holder is number =>
    holder !== null && holder !== pid && alive(holder);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (createWithPid(path, pid)) return makeHandle(path, pid);
    const current = readLockFile(path);
    if (current === null) continue; // gerade freigegeben
    if (heldByOther(current.pid)) throw new CoreLockHeldError(current.pid, path);

    // Veraltet (oder kaputt): Nur wer die Übernahme-Sperre hält, räumt auf
    if (!createWithPid(guard, pid)) {
      const other = readLockFile(guard);
      if (other !== null && heldByOther(other.pid)) throw new CoreLockHeldError(other.pid, path);
      if (other !== null) removeIfSame(guard, other.ino, pid);
      continue;
    }
    try {
      const again = readLockFile(path);
      if (again !== null && !heldByOther(again.pid)) removeIfSame(path, again.ino, pid);
      if (createWithPid(path, pid)) return makeHandle(path, pid);
    } finally {
      if (readLockPid(guard) === pid) rmSync(guard, { force: true });
    }
  }
  const holder = readLockPid(path);
  if (holder !== null) throw new CoreLockHeldError(holder, path);
  throw new Error(`Die Sperrdatei ${path} ließ sich nicht anlegen`);
}

function makeHandle(path: string, pid: number): CoreLockHandle {
  let released = false;
  return {
    path,
    release() {
      if (released) return;
      released = true;
      try {
        if (readLockPid(path) === pid) rmSync(path, { force: true });
      } catch {
        // Aufräumen darf das Beenden nie stören
      }
    },
  };
}

/** Der Teil von `process`, den `releaseOnSignal` braucht (im Test ersetzbar) */
export interface SignalHost {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
  exit(code: number): never;
}

const SIGNALS: Array<[string, number]> = [
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
];

/**
 * Gibt die Sperre bei Strg+C (und SIGTERM/SIGHUP) frei und beendet dann den Prozess, wie es ohne Handler geschähe.
 * Rückgabe: Funktion, die die Handler wieder entfernt (nach der regulären Freigabe).
 */
export function releaseOnSignal(lock: CoreLockHandle, host: SignalHost = process): () => void {
  const handlers = SIGNALS.map(([signal, code]) => {
    const handler = (): void => {
      lock.release();
      host.exit(code);
    };
    host.on(signal, handler);
    return [signal, handler] as const;
  });
  return () => {
    for (const [signal, handler] of handlers) host.off(signal, handler);
  };
}
