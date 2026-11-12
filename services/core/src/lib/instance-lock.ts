// Ein Core pro Datenordner (#174): PID-Datei `$SG_DATA_DIR/run/core.lock` mit Lebendprüfung.
//
// Node hat kein `flock`. Darum steht die PID des laufenden Core in der Datei; ein zweiter Start prüft per
// `process.kill(pid, 0)`, ob sie noch lebt (`EPERM` heißt: lebt, gehört nur einem anderen Benutzer). Das muss vor
// Logger, Migrationen und Hooks passieren, denn schon `createLogger` rotiert `logs/core.log` des laufenden Core.
//
// Anlegen: `open(…, 'wx', 0600)` ist atomar, nur einer gewinnt. Eine veraltete Datei (Prozess tot, z. B. nach
// `kill -9` oder Absturz) wird zuerst per `rename` auf einen eigenen Namen weggeräumt. Das gelingt nur einem von
// mehreren gleichzeitigen Starts, danach entscheidet wieder `wx`. Steht im weggeräumten Stück wider Erwarten eine
// lebende PID (jemand war schneller), wird es zurückgelegt und der Start abgelehnt.
// Grenze: Wird die PID nach einem Absturz von einem fremden Prozess wiederverwendet, gilt die Datei als belegt.
// Dann hilft nur Löschen von `run/core.lock` (die Meldung nennt den Pfad).
import {
  chmodSync,
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

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

export interface CoreLock {
  readonly path: string;
  /** Gibt die Datei frei, aber nur, wenn sie die eigene PID enthält. Mehrfach aufrufbar. */
  release(): void;
}

export function coreLockPath(dataDir: string): string {
  return join(dataDir, 'run', 'core.lock');
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** PID aus der Datei, `null` bei fehlender, leerer oder kaputter Datei */
export function readLockPid(path: string): number | null {
  try {
    const pid = Number(readFileSync(path, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export interface AcquireOptions {
  pid?: number;
  alive?: (pid: number) => boolean;
}

/**
 * Sperrt den Datenordner für diesen Prozess. Wirft `CoreLockHeldError`, wenn ein anderer Core lebt.
 * Andere Fehler (Ordner nicht beschreibbar) werden durchgereicht.
 */
export function acquireCoreLock(dataDir: string, options: AcquireOptions = {}): CoreLock {
  const pid = options.pid ?? process.pid;
  const alive = options.alive ?? processAlive;
  const path = coreLockPath(dataDir);
  const dir = join(dataDir, 'run');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const fd = openSync(path, 'wx', 0o600);
      try {
        writeSync(fd, `${pid}\n`);
      } finally {
        closeSync(fd);
      }
      return makeLock(path, pid);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const holder = readLockPid(path);
    // Die eigene PID in einer Datei, die wir nicht angelegt haben, stammt von einem früheren Prozess (PID-Wiederverwendung)
    if (holder !== null && holder !== pid && alive(holder)) throw new CoreLockHeldError(holder, path);

    // Veraltet (oder leer/kaputt): wegräumen, aber nur, wenn es noch dieselbe Datei ist
    const grave = `${path}.stale.${pid}`;
    try {
      renameSync(path, grave);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const moved = readLockPid(grave);
    if (moved !== null && moved !== pid && moved !== holder && alive(moved)) {
      // Zwischen Lesen und Wegräumen hat ein anderer Start die Datei neu angelegt: zurücklegen und ablehnen
      try {
        linkSync(grave, path);
      } catch {
        // Wieder besetzt: der Besitzer dort entscheidet
      }
      rmSync(grave, { force: true });
      throw new CoreLockHeldError(moved, path);
    }
    rmSync(grave, { force: true });
  }
  throw new CoreLockHeldError(readLockPid(path) ?? 0, path);
}

function makeLock(path: string, pid: number): CoreLock {
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

/** Meldung für den Terminal-Nutzer (Deutsch, ohne Logger, da dieser noch nicht läuft) */
export function lockHeldMessage(error: CoreLockHeldError): string {
  return (
    `Der Core läuft bereits (PID ${error.pid}) und nutzt denselben Datenordner. Dieser zweite Start wird beendet, ` +
    `ohne etwas zu verändern. Mit \`sg stop\` den laufenden Core beenden. Läuft dieser Prozess nicht mehr ` +
    `(PID wiederverwendet), die Datei ${error.lockPath} löschen.`
  );
}
