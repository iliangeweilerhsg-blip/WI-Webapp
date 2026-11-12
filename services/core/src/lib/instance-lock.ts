// Ein Core pro Datenordner (#174): PID-Datei `$SG_DATA_DIR/run/core.lock` mit Lebendprüfung.
//
// Node hat kein `flock`. Darum steht die PID des laufenden Core in der Datei; ein zweiter Start prüft per
// `process.kill(pid, 0)`, ob sie noch lebt (`EPERM` heißt: lebt, gehört nur einem anderen Benutzer). Das muss vor
// Logger, Migrationen und Hooks passieren, denn schon `createLogger` rotiert `logs/core.log` des laufenden Core.
//
// Anlegen: Die PID steht zuerst in einer eigenen Zwischendatei, die dann per `link` unter `core.lock` eingehängt wird.
// `link` ist atomar und scheitert mit `EEXIST`, wenn die Datei schon da ist: Nur einer gewinnt, und `core.lock` ist nie
// leer oder halb geschrieben (sonst hielte ein zweiter Start die frische Datei eines lebenden Core für kaputt).
// Übernehmen: Eine veraltete Datei (Prozess tot, z. B. nach `kill -9` oder Absturz) räumt nur auf, wer die
// Übernahme-Sperre `core.lock.takeover` hält (gleiches Verfahren). Unter ihr wird die Datei neu gelesen und nur
// weggeräumt, wenn sie noch dieselbe ist (gleicher Inode). So kann ein Start, der die veraltete Datei gesehen hat, nie
// die frische Datei eines anderen Starts löschen.
// Grenzen: Wird die PID nach einem Absturz von einem fremden Prozess wiederverwendet, gilt die Datei als belegt; dann
// hilft nur Löschen von `run/core.lock` (die Meldung nennt den Pfad). Stürzt ein Start genau während der Übernahme ab
// (Mikrosekunden, rein synchron), bleibt `core.lock.takeover` liegen und wird beim nächsten Start ebenso übernommen.
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

function parsePid(text: string): number | null {
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** PID aus der Datei, `null` bei fehlender, leerer oder kaputter Datei */
export function readLockPid(path: string): number | null {
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

/** Inhalt und Inode über denselben Deskriptor; `null`, wenn die Datei fehlt */
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

export interface AcquireOptions {
  pid?: number;
  alive?: (pid: number) => boolean;
}

/**
 * Sperrt den Datenordner für diesen Prozess. Wirft `CoreLockHeldError`, wenn ein anderer Core lebt oder gerade startet.
 * Andere Fehler (Ordner nicht beschreibbar) werden durchgereicht.
 */
export function acquireCoreLock(dataDir: string, options: AcquireOptions = {}): CoreLock {
  const pid = options.pid ?? process.pid;
  const alive = options.alive ?? processAlive;
  const path = coreLockPath(dataDir);
  const guard = `${path}.takeover`;
  const dir = join(dataDir, 'run');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  // Die eigene PID in einer Datei, die wir nicht angelegt haben, stammt von einem früheren Prozess (PID-Wiederverwendung)
  const heldByOther = (holder: number | null): holder is number =>
    holder !== null && holder !== pid && alive(holder);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (createWithPid(path, pid)) return makeLock(path, pid);
    const current = readLockFile(path);
    if (current === null) continue; // gerade freigegeben
    if (heldByOther(current.pid)) throw new CoreLockHeldError(current.pid, path);

    // Veraltet (oder kaputt): Nur wer die Übernahme-Sperre hält, räumt auf
    if (!createWithPid(guard, pid)) {
      const other = readLockFile(guard);
      if (other !== null && heldByOther(other.pid)) throw new CoreLockHeldError(other.pid, path);
      // Übernahme-Sperre eines abgestürzten Starts
      if (other !== null) removeIfSame(guard, other.ino, pid);
      continue;
    }
    try {
      const again = readLockFile(path);
      if (again !== null && !heldByOther(again.pid)) removeIfSame(path, again.ino, pid);
      if (createWithPid(path, pid)) return makeLock(path, pid);
    } finally {
      if (readLockPid(guard) === pid) rmSync(guard, { force: true });
    }
  }
  const holder = readLockPid(path);
  if (holder !== null) throw new CoreLockHeldError(holder, path);
  throw new Error(`Die Sperrdatei ${path} ließ sich nicht anlegen`);
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
