import { join } from 'node:path';
import { pino, type Logger } from 'pino';
import type { Config } from './config.ts';

/**
 * Strukturierte JSON-Logs nach stdout und (optional) `$SG_DATA_DIR/logs/core.log` (VERTRAEGE §4).
 * Rotation (14 Tage, 09 §7) ist noch nicht umgesetzt.
 */
export function createLogger(
  config: Pick<Config, 'dataDir' | 'logLevel'>,
  options: { file?: boolean } = {},
): Logger {
  const streams: pino.StreamEntry[] = [{ stream: process.stdout }];
  if (options.file !== false) {
    streams.push({
      stream: pino.destination({ dest: join(config.dataDir, 'logs', 'core.log'), mkdir: true, sync: false }),
    });
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
