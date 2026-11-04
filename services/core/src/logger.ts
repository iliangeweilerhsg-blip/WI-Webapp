import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pino, type Logger } from 'pino';
import type { Config } from './config.ts';

/** Logdateien werden 14 Tage aufbewahrt (09 §7) */
export const LOG_KEEP_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Tägliche Rotation von `core.log`. `openedDay` ist der (UTC-)Tag, an dem die aktuelle Datei begonnen
 * wurde, nicht ihr mtime: Zeilen nach Mitternacht vor der nächsten Prüfung verschieben sonst den Tag.
 * Ist heute ein anderer Tag, wird die Datei zu `core-<openedDay>.log`. Archive, die älter als
 * `keepDays` Tage sind, werden gelöscht.
 * Rückgabe: der Tag, für den die aktuelle Datei jetzt gilt. Weicht er von `openedDay` ab, wurde
 * rotiert und der Aufrufer öffnet die Logdatei neu.
 */
export function rotateLogs(
  logDir: string,
  openedDay: string,
  now: Date = new Date(),
  keepDays: number = LOG_KEEP_DAYS,
): string {
  mkdirSync(logDir, { recursive: true });
  const today = dayString(now);
  let day = openedDay;

  if (openedDay < today) {
    const current = join(logDir, 'core.log');
    if (existsSync(current)) {
      const target = join(logDir, `core-${openedDay}.log`);
      renameSync(current, existsSync(target) ? join(logDir, `core-${openedDay}-${Date.now()}.log`) : target);
    }
    day = today;
  }

  const cutoff = now.getTime() - keepDays * DAY_MS;
  for (const name of readdirSync(logDir)) {
    if (!/^core-\d{4}-\d{2}-\d{2}.*\.log$/.test(name)) continue;
    const file = join(logDir, name);
    if (statSync(file).mtime.getTime() < cutoff) unlinkSync(file);
  }
  return day;
}

/** Tag, an dem eine vorhandene `core.log` begonnen wurde (Näherung beim Start: ihr mtime), sonst heute */
export function initialLogDay(logDir: string, now: Date = new Date()): string {
  const current = join(logDir, 'core.log');
  return existsSync(current) ? dayString(statSync(current).mtime) : dayString(now);
}

/**
 * Strukturierte JSON-Logs nach stdout und (optional) `$SG_DATA_DIR/logs/core.log` (VERTRAEGE §4).
 * Die Datei wird synchron geschrieben, damit auch Fehler beim Start (z. B. Port belegt) im Log landen.
 * Rotation: beim Start und danach stündlich geprüft (siehe `rotateLogs`).
 */
export function createLogger(
  config: Pick<Config, 'dataDir' | 'logLevel'>,
  options: { file?: boolean } = {},
): Logger {
  const streams: pino.StreamEntry[] = [{ stream: process.stdout }];
  if (options.file !== false) {
    const logDir = join(config.dataDir, 'logs');
    let openedDay = rotateLogs(logDir, initialLogDay(logDir));
    const destination = pino.destination({ dest: join(logDir, 'core.log'), mkdir: true, sync: true });
    streams.push({ stream: destination });
    setInterval(
      () => {
        try {
          const day = rotateLogs(logDir, openedDay);
          if (day !== openedDay) {
            destination.reopen();
            openedDay = day;
          }
        } catch {
          // Rotation darf den Core nie stören
        }
      },
      60 * 60 * 1000,
    ).unref();
  }
  return pino(
    {
      level: config.logLevel,
      base: { service: 'core' },
      timestamp: pino.stdTimeFunctions.isoTime,
      // Geheimnisse nie loggen (09 §4). Moodle-Token (08 §9.1) zur Sicherheit auch, falls er je in ein Log-Objekt gerät
      redact: ['req.headers.authorization', 'req.headers.cookie', 'wstoken', 'token', '*.wstoken', '*.token'],
    },
    pino.multistream(streams),
  );
}
