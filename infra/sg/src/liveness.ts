// Lebt der Prozess eines Laufs noch? (#113, docs/VERTRAEGE.md §13)
//
// Ein Restore-Test oder ein Backup steht in der Datenbank auf `laeuft`, bis die CLI ihr Ergebnis schreibt. Stürzt
// der Mac ab (oder werden CLI und Core hart beendet), bleibt `laeuft` stehen und blockiert bis zur Frist (2 bzw.
// 6 Stunden) das Backup vor Migrationen und damit `sg start`. Darum legt die CLI für die Dauer eines Laufs eine
// kleine Datei mit ihrer PID und einer Kennung des Laufs in den Datenordner (`<Datenordner>/tmp/lauf-<name>.json`,
// der Datenordner ist vertrauenswürdig). Kennung ist beim Restore-Test `started_at` aus `setting.restore_test`, beim
// Backup die ID in `backup_run`. Wer `laeuft` findet, fragt hier nach:
//   - `tot`: Die Datei gehört zu genau diesem Lauf (gleiche Kennung), und der Prozess lebt nicht mehr → abgebrochen.
//   - `lebt`: Der Prozess lebt (oder gehört einem anderen Benutzer, `EPERM`).
//   - `unbekannt`: keine oder eine fremde/kaputte Datei, z. B. kurz nach dem Start durch den Core, bevor die CLI sie
//     angelegt hat. Dann gilt wie bisher die Frist (vorsichtige Richtung: nie fälschlich „abgebrochen“).
// Grenze: Wird die PID nach einem Neustart von einem fremden Prozess wiederverwendet, gilt der Lauf als `lebt` und
// es bleibt bei der Frist.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STAGE_ROOT } from './staging.ts';

export type RunLiveness = 'lebt' | 'tot' | 'unbekannt';

interface RunPidFile {
  pid: number;
  run: string;
}

export function runPidPath(dataDir: string, name: string): string {
  return join(dataDir, STAGE_ROOT, `lauf-${name}.json`);
}

/** Legt die Datei an und gibt eine Funktion zurück, die sie wieder entfernt (nur, wenn sie noch dieselbe ist) */
export function writeRunPid(
  dataDir: string,
  name: string,
  run: string,
  pid: number = process.pid,
): () => void {
  const path = runPidPath(dataDir, name);
  try {
    mkdirSync(join(dataDir, STAGE_ROOT), { recursive: true, mode: 0o700 });
    const content: RunPidFile = { pid, run };
    writeFileSync(path, `${JSON.stringify(content)}\n`, { mode: 0o600 });
  } catch {
    // Ohne Datei gilt nur die Frist (wie vor #113)
    return () => {};
  }
  return () => {
    try {
      const current = readPidFile(path);
      if (current?.pid === pid && current.run === run) rmSync(path, { force: true });
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
  const file = readPidFile(runPidPath(dataDir, name));
  if (!file || run === '' || file.run !== run) return 'unbekannt';
  return alive(file.pid) ? 'lebt' : 'tot';
}
