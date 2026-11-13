// Die Befehle `sg backup` und `sg restore` (Argumente, echte Abhängigkeiten) und das Backup vor Migrationen.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  BACKUP_TRIGGERS,
  readBackupSettings,
  runBackup,
  type BackupIo,
  type BackupTrigger,
} from './backup.ts';
import { healthUrl, type SgConfig } from './config.ts';
import { acquireCoreLock } from './core-lock.ts';
import { coreLockHeld } from './doctor.ts';
import { openPg, realExec, type Exec, type PgAccess } from './pg.ts';
import { readService } from './procs.ts';
import { readJournal, recoverRestore, runRestore } from './restore.ts';
import { RESTORE_TEST_TRIGGERS, runAutoRestoreTest, type RestoreTestTrigger } from './restore-auto.ts';

const log = (msg: string): void => console.log(`[sg] ${msg}`);
const err = (msg: string): void => console.error(`[sg] ${msg}`);
const io: BackupIo = { log, err };

// ---------------------------------------------------------------- Argumente

export type BackupArgs =
  { ok: true; trigger: BackupTrigger; runId?: string; target?: string } | { ok: false; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseBackupArgs(rest: string[]): BackupArgs {
  let trigger: BackupTrigger = 'manuell';
  let runId: string | undefined;
  let target: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] as string;
    const value = rest[i + 1];
    if (arg === '--trigger') {
      if (!BACKUP_TRIGGERS.includes(value as BackupTrigger)) {
        return { ok: false, message: `--trigger erwartet ${BACKUP_TRIGGERS.join(' | ')}.` };
      }
      trigger = value as BackupTrigger;
      i += 1;
    } else if (arg === '--run-id') {
      if (!value || !UUID_RE.test(value))
        return { ok: false, message: '--run-id erwartet eine UUID (Kleinbuchstaben).' };
      runId = value;
      i += 1;
    } else if (arg === '--ziel' || arg === '--target') {
      if (!value) return { ok: false, message: `${arg} erwartet einen Pfad.` };
      target = value;
      i += 1;
    } else {
      return { ok: false, message: `Unbekannte Option "${arg}". Erlaubt: --trigger, --run-id, --ziel.` };
    }
  }
  return { ok: true, trigger, ...(runId ? { runId } : {}), ...(target ? { target } : {}) };
}

export type RestoreArgs =
  | { ok: true; auto?: undefined; stand?: string; test: boolean; target?: string; yes: boolean }
  | { ok: true; auto: true; trigger: RestoreTestTrigger }
  | { ok: false; message: string };

export function parseRestoreArgs(rest: string[]): RestoreArgs {
  let stand: string | undefined;
  let target: string | undefined;
  let test = false;
  let yes = false;
  let auto = false;
  let trigger: RestoreTestTrigger = 'manuell';
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] as string;
    if (arg === '--automatisch') auto = true;
    else if (arg === '--trigger') {
      const value = rest[i + 1];
      if (!RESTORE_TEST_TRIGGERS.includes(value as RestoreTestTrigger)) {
        return { ok: false, message: `--trigger erwartet ${RESTORE_TEST_TRIGGERS.join(' | ')}.` };
      }
      trigger = value as RestoreTestTrigger;
      i += 1;
    } else if (arg === '--test') test = true;
    else if (arg === '--ja' || arg === '--yes') yes = true;
    else if (arg === '--ziel' || arg === '--target') {
      const value = rest[i + 1];
      if (!value) return { ok: false, message: `${arg} erwartet einen Pfad.` };
      target = value;
      i += 1;
    } else if (arg.startsWith('-')) {
      return {
        ok: false,
        message: `Unbekannte Option "${arg}". Erlaubt: --test, --ziel, --ja, --automatisch, --trigger.`,
      };
    } else if (stand === undefined) stand = arg;
    else return { ok: false, message: 'Es darf nur ein Stand angegeben werden.' };
  }
  if (auto) {
    // Der Automatiktest nimmt nur das eigene Ziel und den jüngsten eigenen Stand (kein fremdes Backup)
    if (stand || target || yes || test)
      return { ok: false, message: '--automatisch erlaubt weder Stand noch --ziel, --test oder --ja.' };
    return { ok: true, auto: true, trigger };
  }
  if (trigger !== 'manuell' || rest.includes('--trigger'))
    return { ok: false, message: '--trigger gehört nur zu --automatisch.' };
  if (test && !stand)
    return { ok: false, message: '--test braucht einen Stand: pnpm sg restore --test <stand>' };
  return { ok: true, test, yes, ...(stand ? { stand } : {}), ...(target ? { target } : {}) };
}

// ---------------------------------------------------------------- echte Abhängigkeiten

/** Datenbank bereitstellen, falls sie nur im gestoppten Docker-Container liegt (`sg stop` hält sie an) */
async function ensureDatabase(cfg: SgConfig, exec: Exec): Promise<void> {
  const ps = await exec('docker', ['compose', '-f', cfg.composeFile, 'ps', '-q', 'db']);
  if (ps.code === 0 && ps.stdout.trim() !== '') return;
  const probe = await exec('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (probe.code !== 0) return; // kein Docker: lokale Werkzeuge versuchen
  log('Starte PostgreSQL (docker compose) …');
  await new Promise<void>((resolve) => {
    const child = spawn('docker', ['compose', '-f', cfg.composeFile, 'up', '-d', '--wait'], {
      stdio: 'inherit',
    });
    child.once('error', () => resolve());
    child.once('exit', () => resolve());
  });
}

export async function backupCommand(cfg: SgConfig, rest: string[]): Promise<number> {
  const args = parseBackupArgs(rest);
  if (!args.ok) {
    err(args.message);
    return 1;
  }
  let pg: PgAccess;
  try {
    pg = await openPg(cfg, realExec);
  } catch (e) {
    err((e as Error).message);
    return 1;
  }
  return runBackup({ cfg, pg, ...io }, { trigger: args.trigger, runId: args.runId, target: args.target });
}

export interface RunningIo {
  /** Sperrdatei des Core: Lebt die PID darin? (wie `sg doctor`) */
  lockHeld: () => boolean;
  /** Antwortet der Core unter `/api/v1/health`? */
  coreReachable: () => Promise<boolean>;
}

function realRunningIo(cfg: SgConfig): RunningIo {
  return {
    lockHeld: () => coreLockHeld(cfg),
    async coreReachable() {
      try {
        const res = await fetch(healthUrl(cfg), { signal: AbortSignal.timeout(1500) });
        return res.ok;
      } catch {
        return false; // antwortet nicht: läuft nicht
      }
    },
  };
}

/**
 * Core und Worker, die noch laufen. Der Core zählt als laufend, wenn seine Pid-Datei stimmt, in `run/core.lock` eine
 * lebende PID steht (#292, auch bei anderem Port oder verlorener Pid-Datei) oder er unter dem Health-Pfad antwortet.
 * Eine veraltete Sperrdatei (PID tot) blockiert nicht.
 */
export async function runningServices(cfg: SgConfig, io: RunningIo = realRunningIo(cfg)): Promise<string[]> {
  const names: string[] = [];
  if (readService(cfg, 'core') !== null || io.lockHeld() || (await io.coreReachable())) names.push('Core');
  if (readService(cfg, 'worker') !== null) names.push('Worker');
  return names;
}

/**
 * Hält allein die Sperrdatei den Core für laufend (keine PID-Datei von Core oder Worker, keine Health-Antwort)?
 * Dann findet `sg stop` nichts, und die PID in der Datei kann von einem fremden Prozess stammen (wiederverwendet).
 */
export async function blockedByLockOnly(cfg: SgConfig, io: RunningIo = realRunningIo(cfg)): Promise<boolean> {
  if (readService(cfg, 'core') !== null || readService(cfg, 'worker') !== null) return false;
  return io.lockHeld() && !(await io.coreReachable());
}

async function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    err('Keine Eingabe möglich. Mit --ja bestätigen.');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`[sg] ${question} `)).trim().toLowerCase();
    return answer === 'ja' || answer === 'j' || answer === 'yes' || answer === 'y';
  } finally {
    rl.close();
  }
}

export async function restoreCommand(cfg: SgConfig, rest: string[]): Promise<number> {
  const args = parseRestoreArgs(rest);
  if (!args.ok) {
    err(args.message);
    return 1;
  }
  let pg: PgAccess;
  try {
    await ensureDatabase(cfg, realExec);
    pg = await openPg(cfg, realExec);
  } catch (e) {
    err((e as Error).message);
    return 1;
  }
  const deps = {
    cfg,
    pg,
    ...io,
    servicesRunning: () => runningServices(cfg),
    holdLock: () => acquireCoreLock(cfg.dataDir),
    lockOnly: () => blockedByLockOnly(cfg),
    confirm: askYesNo,
    codeMigrations: journalCount(cfg.repoRoot),
  };
  if (args.auto) return runAutoRestoreTest(deps, { trigger: args.trigger });
  return runRestore(deps, { stand: args.stand, test: args.test, target: args.target, yes: args.yes });
}

// ---------------------------------------------------------------- Backup vor Migrationen

export type MigrationBackupResult = 'ok' | 'skipped' | 'failed';

export interface MigrationBackupDeps extends BackupIo {
  pg: PgAccess;
  /** Anzahl der Migrationen im Journal von `services/core/drizzle` */
  journalCount: number;
  run: (trigger: BackupTrigger) => Promise<number>;
}

/**
 * Vor ausstehenden Migrationen ein Backup mit `trigger = vor_migration` (docs/VERTRAEGE.md §13). Es entfällt bei
 * neuer Datenbank (noch keine Tabellen), ohne ausstehende Migration und ohne Backup-Ziel. Schlägt ein
 * konfiguriertes Backup fehl, soll die Migration nicht laufen (`failed`).
 */
export async function preMigrationBackup(deps: MigrationBackupDeps): Promise<MigrationBackupResult> {
  const { pg, log: say, err: warn } = deps;
  const [tables] = await pg.query(
    `SELECT to_regclass('public.setting') IS NOT NULL, to_regclass('drizzle.__drizzle_migrations') IS NOT NULL`,
  );
  if (tables?.[0] !== 't' || tables[1] !== 't') return 'skipped';
  const [applied] = await pg.query(`SELECT count(*) FROM drizzle.__drizzle_migrations`);
  if (Number(applied?.[0] ?? 0) >= deps.journalCount) return 'skipped';
  const settings = await readBackupSettings(pg);
  if (!settings.target) {
    warn('Kein Backup-Ziel eingestellt: Die Migration läuft ohne Backup (Einstellungen → Daten).');
    return 'skipped';
  }
  say('Ausstehende Migrationen: erstelle vorher ein Backup …');
  return (await deps.run('vor_migration')) === 0 ? 'ok' : 'failed';
}

/** Anzahl der Einträge in `services/core/drizzle/meta/_journal.json` (0, wenn nicht lesbar) */
export function journalCount(repoRoot: string): number {
  try {
    const journal = JSON.parse(
      readFileSync(join(repoRoot, 'services', 'core', 'drizzle', 'meta', '_journal.json'), 'utf8'),
    ) as { entries?: unknown[] };
    return journal.entries?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Schließt einen unterbrochenen Restore ab bzw. baut ihn zurück (Journal im Datenordner). Wird von `sg start`
 * vor allem anderen aufgerufen. Rückgabe `false` = es ging schief, nicht weiterstarten.
 */
export async function recoverRestoreIfOpen(cfg: SgConfig): Promise<boolean> {
  if (readJournal(cfg.dataDir) === null) return true;
  try {
    const pg = await openPg(cfg, realExec);
    await recoverRestore({ cfg, pg, ...io });
    return true;
  } catch (e) {
    err(`Ein unterbrochener Restore ließ sich nicht abschließen: ${(e as Error).message}`);
    err('Starte die Datenbank und führe "pnpm sg restore" erneut aus, dann wird er wiederholt.');
    return false;
  }
}

/**
 * Echte Variante für `sg migrate` und `sg start`: Rückgabe `false` = Migration abbrechen.
 * Fail-closed: Lässt sich das Backup nicht ausführen oder scheitert es, wird nicht migriert. Ausnahmen sind
 * nur ein nicht eingestelltes Backup-Ziel (Hinweis, dokumentiert) und das ausdrückliche `--ohne-backup`.
 */
export async function backupBeforeMigrate(cfg: SgConfig, exec: Exec = realExec): Promise<boolean> {
  const hint = 'Mit "pnpm sg migrate --ohne-backup" lässt sich die Migration trotzdem ausführen.';
  let pg: PgAccess;
  try {
    pg = await openPg(cfg, exec, undefined);
  } catch (e) {
    err(`Ein Backup vor der Migration ist nicht möglich: ${(e as Error).message}`);
    err(`Die Migration wird nicht ausgeführt. ${hint}`);
    return false;
  }
  try {
    const result = await preMigrationBackup({
      pg,
      ...io,
      journalCount: journalCount(cfg.repoRoot),
      run: (trigger) => runBackup({ cfg, pg, ...io }, { trigger }),
    });
    if (result === 'failed') {
      err(`Das Backup vor der Migration ist fehlgeschlagen. Die Migration wird nicht ausgeführt. ${hint}`);
      return false;
    }
    return true;
  } catch (e) {
    err(`Das Backup vor der Migration ließ sich nicht prüfen: ${(e as Error).message.slice(0, 300)}`);
    err(`Die Migration wird nicht ausgeführt. ${hint}`);
    return false;
  }
}
