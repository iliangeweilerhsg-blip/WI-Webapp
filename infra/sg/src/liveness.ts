// Lebt der Prozess eines Laufs noch? (#113, docs/VERTRAEGE.md §13)
//
// Ein Restore-Test oder ein Backup steht in der Datenbank auf `laeuft`, bis die CLI ihr Ergebnis schreibt. Stürzt
// der Mac ab (oder werden CLI und Core hart beendet), bleibt `laeuft` stehen und blockiert bis zur Frist (2 bzw.
// 6 Stunden) das Backup vor Migrationen und damit `sg start`. Darum legt jeder CLI-Prozess für die Dauer eines Laufs
// eine eigene kleine Datei in den Datenordner (vertrauenswürdig): `<Datenordner>/tmp/lauf-<name>.<pid>.json` mit PID
// und einer Kennung des Laufs. Kennung ist beim Restore-Test `started_at` aus `setting.restore_test`, beim Backup die
// ID in `backup_run`. Die PID steht im Dateinamen, so teilen sich zwei gleichzeitig gestartete Prozesse nie eine
// Datei. Wer `laeuft` findet, fragt hier nach:
//   - `tot`: Es gibt Dateien zu genau diesem Lauf (gleiche Kennung), und keiner ihrer Prozesse lebt noch.
//   - `lebt`: Mindestens ein Prozess des Laufs lebt (oder gehört einem anderen Benutzer, `EPERM`).
//   - `unbekannt`: keine Datei zu diesem Lauf, z. B. kurz nach dem Start durch den Core, bevor die CLI sie angelegt
//     hat. Dann gilt wie bisher die Frist (vorsichtige Richtung: nie fälschlich „abgebrochen“).
// Grenze: Wird die PID nach einem Neustart von einem fremden Prozess wiederverwendet, gilt der Lauf als `lebt` und
// es bleibt bei der Frist.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STAGE_ROOT } from './staging.ts';

export type RunLiveness = 'lebt' | 'tot' | 'unbekannt';

interface RunPidFile {
  pid: number;
  run: string;
}

const FILE_RE = /^lauf-(.+)\.([0-9]+)\.json$/;

function stageDir(dataDir: string): string {
  return join(dataDir, STAGE_ROOT);
}

export function runPidPath(dataDir: string, name: string, pid: number = process.pid): string {
  return join(stageDir(dataDir), `lauf-${name}.${pid}.json`);
}

/** Legt die Datei dieses Prozesses an und gibt eine Funktion zurück, die sie wieder entfernt */
export function writeRunPid(
  dataDir: string,
  name: string,
  run: string,
  pid: number = process.pid,
): () => void {
  const path = runPidPath(dataDir, name, pid);
  try {
    mkdirSync(stageDir(dataDir), { recursive: true, mode: 0o700 });
    const content: RunPidFile = { pid, run };
    // Erst unter einem Namen, den niemand liest, dann umbenennen: nie halb geschrieben sichtbar
    const temp = join(stageDir(dataDir), `.lauf-${name}.${pid}.tmp`);
    writeFileSync(temp, `${JSON.stringify(content)}\n`, { mode: 0o600 });
    renameSync(temp, path);
  } catch {
    // Ohne Datei gilt nur die Frist (wie vor #113)
    return () => {};
  }
  return () => {
    try {
      if (readPidFile(path)?.run === run) rmSync(path, { force: true });
    } catch {
      // Aufräumen ist nur eine Zugabe
    }
  };
}

function readPidFile(path: string): RunPidFile | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<RunPidFile>;
    if (Number.isInteger(parsed.pid) && (parsed.pid as number) > 0 && typeof parsed.run === 'string') {
      return { pid: parsed.pid as number, run: parsed.run };
    }
  } catch {
    // fehlt oder kaputt
  }
  return null;
}

interface ListedPidFile {
  name: string;
  path: string;
  /** PID aus dem Dateinamen */
  pid: number;
  /** Inhalt, `null` wenn kaputt oder nicht zum Namen passend */
  file: RunPidFile | null;
}

/** Alle Dateien `lauf-*.json` */
function listPidFiles(dataDir: string): ListedPidFile[] {
  let entries: string[];
  try {
    entries = readdirSync(stageDir(dataDir));
  } catch {
    return [];
  }
  const result: ListedPidFile[] = [];
  for (const entry of entries) {
    const match = FILE_RE.exec(entry);
    if (!match) continue;
    const path = join(stageDir(dataDir), entry);
    const file = readPidFile(path);
    // Die PID im Namen muss zum Inhalt passen, sonst zählt die Datei nicht
    const pid = Number(match[2]);
    result.push({ name: match[1] as string, path, pid, file: file?.pid === pid ? file : null });
  }
  return result;
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: Prozess existiert, gehört aber jemand anderem
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** Zustand des Laufs `name` mit der Kennung `run` (aus der Datenbank) */
export function runLiveness(
  dataDir: string,
  name: string,
  run: string,
  alive: (pid: number) => boolean = processAlive,
): RunLiveness {
  if (run === '') return 'unbekannt';
  const mine = listPidFiles(dataDir).filter((f) => f.name === name && f.file?.run === run);
  if (mine.length === 0) return 'unbekannt';
  return mine.some((f) => alive((f.file as RunPidFile).pid)) ? 'lebt' : 'tot';
}

/** Dateien des Laufs `name` mit Kennung `run` entfernen (nachdem er als abgebrochen eingetragen ist) */
export function removeRunPids(dataDir: string, name: string, run: string): void {
  for (const f of listPidFiles(dataDir)) {
    if (f.name === name && f.file?.run === run) rmSync(f.path, { force: true });
  }
}

/**
 * Verwaiste Dateien entfernen: deren Prozess (PID im Namen) nicht mehr lebt. Nur aufrufen, wenn kein `laeuft` mehr
 * auf sie angewiesen ist (`sg backup` nach seinen Prüfungen, siehe backup.ts). Rückgabe: Anzahl entfernter Dateien.
 */
export function sweepDeadRunPids(dataDir: string, alive: (pid: number) => boolean = processAlive): number {
  let removed = 0;
  for (const f of listPidFiles(dataDir)) {
    if (f.pid === process.pid || alive(f.pid)) continue;
    rmSync(f.path, { force: true });
    removed += 1;
  }
  return removed;
}
