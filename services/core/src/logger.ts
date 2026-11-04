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
 * Tägliche Rotation von `core.log`: Eine Datei, die zuletzt an einem früheren (UTC-)Tag beschrieben
 * wurde, wird zu `core-YYYY-MM-DD.log`. Archive, die älter als `keepDays` Tage sind, werden gelöscht.
 * Rückgabe: true, wenn rotiert wurde (der Aufrufer öffnet die Logdatei dann neu).
 */
export function rotateLogs(
  logDir: string,
  now: Date = new Date(),
  keepDays: number = LOG_KEEP_DAYS,
): boolean {
  mkdirSync(logDir, { recursive: true });
  const current = join(logDir, 'core.log');
  let rotated = false;

  if (existsSync(current)) {
    const modified = statSync(current).mtime;
    if (dayString(modified) < dayString(now)) {
      const target = join(logDir, `core-${dayString(modified)}.log`);
      renameSync(
        current,
        existsSync(target) ? join(logDir, `core-${dayString(modified)}-${Date.now()}.log`) : target,
      );
      rotated = true;
    }
  }

  const cutoff = now.getTime() - keepDays * DAY_MS;
  for (const name of readdirSync(logDir)) {
    if (!/^core-\d{4}-\d{2}-\d{2}.*\.log$/.test(name)) continue;
    const file = join(logDir, name);
    if (statSync(file).mtime.getTime() < cutoff) unlinkSync(file);
  }
  return rotated;
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
    rotateLogs(logDir);
    const destination = pino.destination({ dest: join(logDir, 'core.log'), mkdir: true, sync: true });
    streams.push({ stream: destination });
    setInterval(
      () => {
        try {
          if (rotateLogs(logDir)) destination.reopen();
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
      // Geheimnisse nie loggen (09 §4)
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    pino.multistream(streams),
  );
}
