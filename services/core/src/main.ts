// `pnpm --filter @sg/core start`: startet die API auf SG_CORE_PORT (docs/VERTRAEGE.md §2)
import { buildApp } from './app.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { createDb } from './db/client.ts';
import { createLogger } from './logger.ts';

const dotEnvFile = loadDotEnv();
const config = loadConfig();
const logger = createLogger(config);
if (dotEnvFile) logger.info({ file: dotEnvFile }, 'Konfiguration aus .env geladen');

const handle = createDb(config.databaseUrl);
const app = await buildApp({ config, db: handle.db, logger });

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Core wird beendet');
  try {
    await app.close();
    await handle.close();
  } catch (error) {
    logger.error({ err: error }, 'Fehler beim Beenden');
    process.exitCode = 1;
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  logger.error({ err: error }, 'Core konnte nicht starten');
  await handle.close();
  process.exit(1);
}
