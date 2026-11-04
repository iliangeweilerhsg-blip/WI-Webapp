// `pnpm --filter @sg/core migrate`: Drizzle-Migrationen gegen DATABASE_URL (docs/VERTRAEGE.md §2)
import { loadConfig, loadDotEnv } from './config.ts';
import { createDb } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';

loadDotEnv();
const config = loadConfig();
const handle = createDb(config.databaseUrl);
try {
  await runMigrations(handle.db);
  console.log('Migrationen abgeschlossen.');
} catch (error) {
  console.error('Migration fehlgeschlagen:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
