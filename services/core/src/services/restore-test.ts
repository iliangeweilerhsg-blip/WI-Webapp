// Monatlicher Restore-Test (F-DAT-02, VERTRAEGE §13, #78). Die CLI (`sg restore --automatisch`) führt ihn aus und
// schreibt das Ergebnis nach `setting` (Schlüssel `restore_test`, nicht Teil von `GET /settings`). Der Core legt den
// Eintrag mit `laeuft` selbst an (damit die Antwort 202 ihn enthält und kein zweiter Test startet), startet die CLI
// und liefert das Ergebnis in `GET /backups` (`status.restore_test`).
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { RestoreTestSchema, SINGLE_USER_ID, type RestoreTest } from '@sg/shared';
import type { Db, DbOrTx } from '../db/client.ts';
import { backupRun, setting } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { BACKUP_LOCK_KEY, RESTORE_TEST_LOCK_KEY } from '../lib/locks.ts';
import { isBackupRunning, spawnSg, type BackupConfig } from './backups.ts';
import { getSettings } from './settings.ts';

export type RestoreTestTrigger = RestoreTest['trigger'];

export const RESTORE_TEST_KEY = 'restore_test';
/** Abstand zwischen zwei erfolgreichen Tests (F-DAT-02: monatlich) */
export const RESTORE_TEST_INTERVAL_MS = 30 * 86_400_000;
/** Ein Test im Zustand `laeuft`, der älter ist, gilt als abgestürzt */
export const RESTORE_TEST_STALE_RUN_MS = 2 * 3600_000;

/** Letztes Ergebnis. Ein zu lange laufender Test erscheint als Fehler `abgebrochen` (ohne zu schreiben). */
export async function getRestoreTest(db: DbOrTx, now = new Date()): Promise<RestoreTest | null> {
  const [row] = await db
    .select({ value: setting.value })
    .from(setting)
    .where(and(eq(setting.key, RESTORE_TEST_KEY), isNull(setting.deletedAt)));
  const parsed = RestoreTestSchema.safeParse(row?.value);
  if (!parsed.success) return null;
  const test = parsed.data;
  if (test.state === 'laeuft' && now.getTime() - Date.parse(test.started_at) > RESTORE_TEST_STALE_RUN_MS) {
    return {
      ...test,
      state: 'fehler',
      finished_at: new Date(Date.parse(test.started_at) + RESTORE_TEST_STALE_RUN_MS).toISOString(),
      reason: 'abgebrochen',
      error: 'Der Restore-Test hat sich nicht zurückgemeldet und gilt als abgebrochen.',
    };
  }
  return test;
}

async function writeRestoreTest(db: DbOrTx, value: RestoreTest): Promise<void> {
  await db
    .insert(setting)
    .values({ key: RESTORE_TEST_KEY, value, userId: SINGLE_USER_ID })
    .onConflictDoUpdate({ target: setting.key, set: { value, deletedAt: null, updatedAt: new Date() } });
}

/** Gibt es einen eigenen, abgeschlossenen Lauf mit Prüfsumme für das aktuelle Ziel? (Sonst gäbe es nichts zu testen) */
export async function hasTestableBackup(db: DbOrTx, target: string): Promise<boolean> {
  const [row] = await db
    .select({ id: backupRun.id })
    .from(backupRun)
    .where(
      and(
        eq(backupRun.state, 'fertig'),
        eq(backupRun.target, target),
        isNull(backupRun.deletedAt),
        isNotNull(backupRun.stand),
        isNotNull(backupRun.dumpSha256),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export type RestoreTestLauncher = (input: {
  trigger: RestoreTestTrigger;
  config: BackupConfig;
  db: Db;
}) => Promise<void>;

async function markFailed(
  db: Db,
  reason: NonNullable<RestoreTest['reason']>,
  message: string,
): Promise<void> {
  // Nur, wenn die CLI ihr Ergebnis nicht schon geschrieben hat
  const current = await getRestoreTest(db);
  if (current?.state !== 'laeuft') return;
  await writeRestoreTest(db, {
    ...current,
    state: 'fehler',
    finished_at: new Date().toISOString(),
    reason,
    error: message.slice(0, 500),
  });
}

const spawnCli: RestoreTestLauncher = async ({ trigger, config, db }) =>
  spawnSg(config, ['restore', '--automatisch', '--trigger', trigger], 'restore-test.log', (code) => {
    const message = `Der Restore-Test-Prozess endete mit Code ${code ?? 'unbekannt'} (siehe logs/restore-test.log).`;
    void markFailed(db, 'intern', message).catch(() => {});
  });

let launcher: RestoreTestLauncher = spawnCli;

/** Für Tests: eigenen Starter einsetzen, `null` stellt den Standard wieder her */
export function setRestoreTestLauncher(fn: RestoreTestLauncher | null): void {
  launcher = fn ?? spawnCli;
}

/**
 * Legt den Eintrag `laeuft` an und startet die CLI. Fehler: 409 `backup_target_missing`, `backup_running`,
 * `restore_test_running`, `restore_test_no_backup` (noch kein Backup mit Lauf-Eintrag und Prüfsumme).
 */
export async function startRestoreTest(
  db: Db,
  config: BackupConfig,
  trigger: RestoreTestTrigger,
  now = new Date(),
): Promise<RestoreTest> {
  const started = await db.transaction(async (tx) => {
    // Gleiche Sperre wie das Backup: Es läuft nie beides gleichzeitig (Ausdünnen löscht Stände)
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BACKUP_LOCK_KEY})`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${RESTORE_TEST_LOCK_KEY})`);
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
    if ((await getRestoreTest(tx, now))?.state === 'laeuft') {
      throw new HttpError(409, 'restore_test_running', 'Es läuft bereits ein Restore-Test.');
    }
    if (!(await hasTestableBackup(tx, target))) {
      throw new HttpError(
        409,
        'restore_test_no_backup',
        'Es gibt noch kein Backup, das sich testen lässt. Lege zuerst ein Backup an.',
      );
    }
    const value: RestoreTest = {
      state: 'laeuft',
      trigger,
      started_at: now.toISOString(),
      finished_at: null,
      stand: null,
      reason: null,
      error: null,
    };
    await writeRestoreTest(tx, value);
    return value;
  });
  try {
    await launcher({ trigger, config, db });
  } catch (error) {
    await markFailed(db, 'intern', `Die CLI ließ sich nicht starten: ${(error as Error).message}`);
    return (await getRestoreTest(db, now)) ?? started;
  }
  return started;
}

function startOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Ist ein Test fällig? Nach einem bestandenen Test erst nach 30 Tagen, nach einem fehlgeschlagenen am nächsten Tag
 * (nicht jede Minute). Ohne bisherigen Test sofort. War der Mac zum Termin aus, holt der nächste Takt es nach.
 */
export function restoreTestDue(last: RestoreTest | null, now: Date): boolean {
  if (last === null) return true;
  if (last.state === 'laeuft') return false;
  if (last.state === 'ok') {
    return now.getTime() - Date.parse(last.finished_at ?? last.started_at) >= RESTORE_TEST_INTERVAL_MS;
  }
  return Date.parse(last.started_at) < startOfDay(now).getTime();
}

/** Zeitplan: startet den Test (`trigger = zeitplan`), wenn er fällig ist. Rückgabe: `true` = gestartet. */
export async function tickRestoreTest(db: Db, config: BackupConfig, now = new Date()): Promise<boolean> {
  const { data } = await getSettings(db, config);
  if (!data.backup_target) return false;
  if (await isBackupRunning(db, now)) return false;
  if (!restoreTestDue(await getRestoreTest(db, now), now)) return false;
  if (!(await hasTestableBackup(db, data.backup_target))) return false;
  try {
    await startRestoreTest(db, config, 'zeitplan', now);
    return true;
  } catch (error) {
    if (error instanceof HttpError) return false; // gleichzeitig gestartet o. Ä.: kein Fehler des Zeitplans
    throw error;
  }
}
