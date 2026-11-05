// Zeitplan im Core (VERTRAEGE §13, T1-18): tägliches Backup, monatlicher Restore-Test und der Job `maintenance.nightly`.
// Beides wird auch nachgeholt, wenn der Mac zur Zeit aus war ("beim Start, falls der letzte Termin verpasst wurde"):
// Der Takt prüft jede Minute, ob seit dem letzten geplanten Zeitpunkt schon ein Lauf angelegt wurde.
import { and, eq, gte, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { MaintenanceNightlyPayloadSchema } from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { backupRun, job } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { NIGHTLY_LOCK_KEY } from '../lib/locks.ts';
import { latestOccurrence, startBackup, isBackupRunning } from './backups.ts';
import { enqueueJob } from './jobs.ts';
import { getRestoreTest, tickRestoreTest } from './restore-test.ts';
import { getSettings } from './settings.ts';

/** Ortszeit, zu der der Core `maintenance.nightly` anlegt (VERTRAEGE §13) */
export const NIGHTLY_TIME = '03:30';
export const SCHEDULER_INTERVAL_MS = 60_000;

/**
 * Legt den Job `maintenance.nightly` an, wenn seit dem letzten Termin (03:30 Ortszeit) noch keiner angelegt wurde.
 * Rückgabe: ID des neuen Jobs oder `null`.
 */
export async function tickNightly(db: Db, now = new Date()): Promise<string | null> {
  const due = latestOccurrence(now, NIGHTLY_TIME);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${NIGHTLY_LOCK_KEY})`);
    const [existing] = await tx
      .select({ id: job.id })
      .from(job)
      .where(and(eq(job.type, 'maintenance.nightly'), gte(job.createdAt, due)))
      .limit(1);
    if (existing) return null;
    // Standard-Payload `{}`: 30 Tage, ohne dry_run. Das Schema prüft es mit, damit Core und Worker einig sind
    const payload = MaintenanceNightlyPayloadSchema.parse({});
    return enqueueJob(tx, { type: 'maintenance.nightly', payload, priority: -10, maxAttempts: 2 });
  });
}

/**
 * Startet das tägliche Backup (`trigger = zeitplan`), wenn ein Ziel gesetzt ist und seit dem letzten geplanten
 * Zeitpunkt (`data.backup_time`) noch kein Lauf begonnen hat. Ein fehlgeschlagener geplanter Lauf wird an diesem Tag
 * nicht wiederholt (sonst jede Minute ein neuer Versuch). Rückgabe: ID des neuen Laufs oder `null`.
 */
export async function tickBackup(
  db: Db,
  config: Pick<Config, 'dataDir' | 'databaseUrl' | 'port'>,
  now = new Date(),
): Promise<string | null> {
  const { data } = await getSettings(db, config);
  if (!data.backup_target) return null;
  if (await isBackupRunning(db, now)) return null;
  // Läuft ein Restore-Test, wartet das Backup (ein späterer Takt holt es nach, kein Fehlschlag)
  if ((await getRestoreTest(db, now))?.state === 'laeuft') return null;
  const due = latestOccurrence(now, data.backup_time);
  const [since] = await db
    .select({ id: backupRun.id })
    .from(backupRun)
    .where(
      and(
        gte(backupRun.startedAt, due),
        or(eq(backupRun.trigger, 'zeitplan'), eq(backupRun.state, 'laeuft'), eq(backupRun.state, 'fertig')),
      ),
    )
    .limit(1);
  if (since) return null;
  try {
    return (await startBackup(db, config, 'zeitplan', now)).id;
  } catch (error) {
    // Ein gleichzeitig gestarteter Lauf oder ein soeben entferntes Ziel ist kein Fehler des Zeitplans
    if (error instanceof HttpError) return null;
    throw error;
  }
}

/**
 * Startet den Takt. Gibt eine Funktion zum Stoppen zurück. Fehler eines Durchlaufs werden geloggt und
 * der nächste Durchlauf läuft weiter.
 */
export function startScheduler(options: {
  db: Db;
  config: Pick<Config, 'dataDir' | 'databaseUrl' | 'port'>;
  logger: Logger;
  intervalMs?: number;
}): () => void {
  const { db, config, logger } = options;
  let busy = false;
  const run = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const nightly = await tickNightly(db);
      if (nightly) logger.info({ job_id: nightly }, 'maintenance.nightly angelegt');
      const backup = await tickBackup(db, config);
      if (backup) logger.info({ backup_run_id: backup }, 'Geplantes Backup gestartet');
      // Monatlicher Restore-Test (F-DAT-02): fällig nach 30 Tagen, holt Verpasstes nach
      if (await tickRestoreTest(db, config)) logger.info('Monatlicher Restore-Test gestartet');
    } catch (error) {
      logger.warn({ err: error }, 'Zeitplan-Durchlauf fehlgeschlagen');
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void run(), options.intervalMs ?? SCHEDULER_INTERVAL_MS);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
