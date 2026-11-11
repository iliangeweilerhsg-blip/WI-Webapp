// `pnpm --filter @sg/core start`: startet die API auf SG_CORE_PORT (docs/VERTRAEGE.md §2)
import { buildApp } from './app.ts';
import { hasOpenPermissions, loadConfig, loadDotEnv, scrubAnthropicEnv } from './config.ts';
import { createDb } from './db/client.ts';
import { createLogger } from './logger.ts';
import { purgeIdempotencyKeys } from './plugins/idempotency.ts';
import { startBonjour, type BonjourHandle } from './services/discovery.ts';
import { startScheduler } from './services/scheduler.ts';

/** Harte Frist fürs Herunterfahren, danach Exit 1 */
const SHUTDOWN_DEADLINE_MS = 10_000;

const dotEnvFile = loadDotEnv();
// Der Core liest den KI-Schlüssel nie und gibt ihn nicht an Kindprozesse weiter (VERTRAEGE §20.5). Vor allem anderen,
// auch vor dem Logger: Danach steht in `process.env` keine `ANTHROPIC_*`-Variable mehr
const scrubbedEnv = scrubAnthropicEnv();
const config = loadConfig();
const logger = createLogger(config);
if (scrubbedEnv.length > 0) {
  // Nur die Namen, nie die Werte
  logger.info(
    { variables: scrubbedEnv },
    'KI-Variablen aus der Umgebung des Core entfernt (nur der Worker nutzt sie)',
  );
}
if (dotEnvFile) {
  logger.info({ file: dotEnvFile }, 'Konfiguration aus .env geladen');
  if (hasOpenPermissions(dotEnvFile)) {
    logger.warn(
      { file: dotEnvFile },
      'Die .env-Datei ist für andere lesbar. Bitte `chmod 600` ausführen (02 §3).',
    );
  }
}

const handle = createDb(config.databaseUrl);
// Moodle-Abgleich beim Start und alle 2 h (F-MDL-04); ohne SG_MOODLE_URL bleibt er aus
const app = await buildApp({ config, db: handle.db, logger, moodleSchedule: true, searchBackfill: true });

let bonjour: BonjourHandle | null = null;
let stopping = false;
let stopScheduler: (() => void) | null = null;
async function shutdown(signal: string): Promise<void> {
  // Ein zweites Signal (z. B. doppelt von der CLI) bricht das Herunterfahren nicht ab
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Core wird beendet');
  setTimeout(() => {
    logger.error('Herunterfahren dauert zu lange, Core wird hart beendet');
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS).unref();
  try {
    await bonjour?.stop();
    stopScheduler?.();
    await app.close();
    await handle.close();
  } catch (error) {
    logger.error({ err: error }, 'Fehler beim Beenden');
    process.exitCode = 1;
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

const purge = () =>
  purgeIdempotencyKeys(handle.db).catch((error: unknown) =>
    logger.warn({ err: error }, 'Alte Idempotency-Keys konnten nicht gelöscht werden'),
  );
setInterval(() => void purge(), 60 * 60 * 1000).unref();

try {
  await purge();
  await app.listen({ port: config.port, host: config.host });
  // Nur wenn der Core aus dem Netz erreichbar ist, hilft die Ankündigung dem iPad (§12)
  if (config.bonjour && config.host !== '127.0.0.1' && config.host !== 'localhost' && config.host !== '::1') {
    bonjour = startBonjour({ port: config.port, logger });
  }
  // Tägliches Backup und `maintenance.nightly` (VERTRAEGE §13)
  stopScheduler = startScheduler({ db: handle.db, config, logger });
} catch (error) {
  // Kein process.exit: so werden Logs vollständig geschrieben und Handles sauber geschlossen
  logger.error({ err: error }, 'Core konnte nicht starten');
  process.exitCode = 1;
  stopping = true;
  await app.close().catch(() => {});
  await handle.close().catch(() => {});
}
