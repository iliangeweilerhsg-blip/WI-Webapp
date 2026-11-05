// Backups (F-DAT-01, VERTRAEGE §7.5, §13). Die CLI (`pnpm sg backup`) führt sie aus und schreibt `backup_run`.
// Der Core legt die Zeile für `POST /backup` selbst an (damit die Antwort 202 sie enthält), startet die CLI
// mit `--run-id` und überlässt ihr den Rest. Ohne `data.backup_target` gibt es keine Backups.
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, gte, sql } from 'drizzle-orm';
import { SINGLE_USER_ID, type BackupOverview, type BackupRun, type BackupStatus } from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db, DbOrTx } from '../db/client.ts';
import { backupRun } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { afterCursor, cursorTs, decodeCursor, keysetOrder, toPage } from '../lib/pagination.ts';
import { BACKUP_LOCK_KEY } from '../lib/locks.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import { getSettings } from './settings.ts';
import { getRestoreTest } from './restore-test.ts';

type BackupRunRow = typeof backupRun.$inferSelect;
export type BackupTrigger = BackupRun['trigger'];

/** Ein Lauf im Zustand `laeuft`, der älter ist, gilt als abgestürzt (CLI und Core zählen gleich) */
export const BACKUP_STALE_RUN_MS = 6 * 3600_000;
/** Hinweis im Tagesbriefing ab diesem Alter des letzten erfolgreichen Backups (F-DAT-01) */
export const BACKUP_STALE_AFTER_MS = 3 * 86_400_000;

/** Eintrag der CLI im Repo, ohne `sg.mjs` (das würde beim Aufruf aus dem laufenden Core `pnpm install` anstoßen) */
const CLI_ENTRY = fileURLToPath(new URL('../../../../infra/sg/src/main.ts', import.meta.url));

export function toApiBackupRun(row: BackupRunRow): BackupRun {
  return {
    id: row.id,
    user_id: row.userId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt?.toISOString() ?? null,
    target: row.target,
    size_bytes: row.sizeBytes,
    state: row.state as BackupRun['state'],
    error: row.error,
    trigger: row.trigger as BackupTrigger,
    stand: row.stand,
  };
}

// ---------------------------------------------------------------------------------------------
// Zeitplan
// ---------------------------------------------------------------------------------------------

/** `HH:MM` → Stunde und Minute. Ungültige Werte (von Hand in der DB) fallen auf 03:00 zurück */
function parseTime(hhmm: string): [number, number] {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? [Number(m[1]), Number(m[2])] : [3, 0];
}

/** Letzter Zeitpunkt `HH:MM` (Ortszeit, `TZ`) nicht nach `now` */
export function latestOccurrence(now: Date, hhmm: string): Date {
  const [h, m] = parseTime(hhmm);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 1);
  return d;
}

/** Nächster Zeitpunkt `HH:MM` (Ortszeit) nach `now` */
export function nextOccurrence(now: Date, hhmm: string): Date {
  const d = latestOccurrence(now, hhmm);
  d.setDate(d.getDate() + 1);
  return d;
}

// ---------------------------------------------------------------------------------------------
// Status und Liste
// ---------------------------------------------------------------------------------------------

export async function isBackupRunning(db: DbOrTx, now = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ id: backupRun.id })
    .from(backupRun)
    .where(
      and(
        eq(backupRun.state, 'laeuft'),
        gte(backupRun.startedAt, new Date(now.getTime() - BACKUP_STALE_RUN_MS)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function getBackupStatus(
  db: DbOrTx,
  config: Pick<Config, 'dataDir'>,
  now = new Date(),
): Promise<BackupStatus> {
  const { data } = await getSettings(db, config);
  const [last] = await db
    .select({ finishedAt: backupRun.finishedAt })
    .from(backupRun)
    .where(eq(backupRun.state, 'fertig'))
    .orderBy(sql`${backupRun.finishedAt} DESC NULLS LAST`)
    .limit(1);
  const lastSuccess = last?.finishedAt ?? null;
  return {
    target: data.backup_target,
    last_success_at: lastSuccess?.toISOString() ?? null,
    next_run_at: data.backup_target ? nextOccurrence(now, data.backup_time).toISOString() : null,
    // Ohne erfolgreiches Backup gilt der Stand als veraltet, damit das Tagesbriefing zur Einrichtung rät
    stale: lastSuccess === null || now.getTime() - lastSuccess.getTime() > BACKUP_STALE_AFTER_MS,
    running: await isBackupRunning(db, now),
    restore_test: await getRestoreTest(db, now),
  };
}

export async function listBackups(
  db: DbOrTx,
  config: Pick<Config, 'dataDir'>,
  options: { cursor?: string | undefined; limit: number },
): Promise<BackupOverview> {
  const rows = await db
    .select({ row: backupRun, ts: cursorTs(backupRun.createdAt) })
    .from(backupRun)
    .where(
      afterCursor(
        backupRun.createdAt,
        backupRun.id,
        options.cursor ? decodeCursor(options.cursor) : undefined,
        'desc',
      ),
    )
    .orderBy(...keysetOrder(backupRun.createdAt, backupRun.id, 'desc'))
    .limit(options.limit + 1);
  const page = toPage(
    rows,
    options.limit,
    (r) => ({ ts: r.ts, id: r.row.id }),
    (r) => toApiBackupRun(r.row),
  );
  return { status: await getBackupStatus(db, config), items: page.items, next_cursor: page.next_cursor };
}

// ---------------------------------------------------------------------------------------------
// Starten
// ---------------------------------------------------------------------------------------------

export type BackupConfig = Pick<Config, 'dataDir' | 'databaseUrl' | 'port'>;

export interface LaunchInput {
  runId: string;
  trigger: BackupTrigger;
  config: BackupConfig;
  db: Db;
}

/** Startet die CLI. Rückkehr, sobald der Prozess läuft. Wirft, wenn er sich nicht starten lässt */
export type BackupLauncher = (input: LaunchInput) => Promise<void>;

async function markFailed(db: Db, runId: string, message: string): Promise<void> {
  await db
    .update(backupRun)
    .set({ state: 'fehler', error: message, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(backupRun.id, runId), eq(backupRun.state, 'laeuft')));
}

/**
 * Startet die CLI im Hintergrund (Ausgabe nach `logs/<logFile>`). Rückkehr, sobald der Prozess läuft. Endet sie mit
 * einem Fehlercode, ohne ihr Ergebnis geschrieben zu haben, ruft `onFailure` mit dem Exit-Code auf.
 */
export async function spawnSg(
  config: BackupConfig,
  args: string[],
  logFile: string,
  onFailure: (code: number | null) => void,
): Promise<void> {
  const logDir = join(config.dataDir, 'logs');
  mkdirSync(logDir, { recursive: true });
  const fd = openSync(join(logDir, logFile), 'a');
  try {
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
      stdio: ['ignore', fd, fd],
      detached: true,
      env: {
        ...process.env,
        SG_DATA_DIR: config.dataDir,
        DATABASE_URL: config.databaseUrl,
        SG_CORE_PORT: String(config.port),
      },
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', reject);
    });
    // Beendet sich die CLI, ohne den Lauf abzuschließen (Absturz vor dem ersten Schreiben), nicht ewig „läuft“
    child.once('exit', (code) => {
      if (code !== 0) onFailure(code);
    });
    child.unref();
  } finally {
    closeSync(fd);
  }
}

/** Standard: `node infra/sg/src/main.ts backup …` im Hintergrund, Ausgabe nach `logs/backup.log` */
const spawnCli: BackupLauncher = async ({ runId, trigger, config, db }) =>
  spawnSg(config, ['backup', '--trigger', trigger, '--run-id', runId], 'backup.log', (code) => {
    const message = `Der Backup-Prozess endete mit Code ${code ?? 'unbekannt'} (siehe logs/backup.log).`;
    void markFailed(db, runId, message).catch(() => {});
  });

let launcher: BackupLauncher = spawnCli;

/** Für Tests: eigenen Starter einsetzen, `null` stellt den Standard wieder her */
export function setBackupLauncher(fn: BackupLauncher | null): void {
  launcher = fn ?? spawnCli;
}

/**
 * Legt den Lauf an und startet die CLI. Fehler: 409 `backup_target_missing` (kein Ziel in den Einstellungen),
 * 409 `backup_running` (es läuft schon eins).
 */
export async function startBackup(
  db: Db,
  config: BackupConfig,
  trigger: BackupTrigger,
  now = new Date(),
): Promise<BackupRun> {
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BACKUP_LOCK_KEY})`);
    const target = (await getSettings(tx, config)).data.backup_target;
    if (!target) {
      throw new HttpError(
        409,
        'backup_target_missing',
        'Es ist kein Backup-Ziel eingestellt. Lege es unter Einstellungen → Daten fest.',
      );
    }
    if (await isBackupRunning(tx, now)) {
      throw new HttpError(409, 'backup_running', 'Es läuft bereits ein Backup.');
    }
    const [created] = await tx
      .insert(backupRun)
      .values({
        id: uuidv7(),
        userId: SINGLE_USER_ID,
        startedAt: now,
        target,
        state: 'laeuft',
        trigger,
      })
      .returning();
    return created as BackupRunRow;
  });
  try {
    await launcher({ runId: row.id, trigger, config, db });
  } catch (error) {
    await markFailed(db, row.id, `Die CLI ließ sich nicht starten: ${(error as Error).message}`);
    const [failed] = await db.select().from(backupRun).where(eq(backupRun.id, row.id));
    return toApiBackupRun(failed ?? row);
  }
  return toApiBackupRun(row);
}
