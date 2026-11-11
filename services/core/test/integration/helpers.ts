import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { pino } from 'pino';
import { inject } from 'vitest';
import { buildApp, type BuildAppOptions } from '../../src/app.ts';
import { loadConfig, type Config } from '../../src/config.ts';
import { createDb, type DbHandle } from '../../src/db/client.ts';

export const TEST_PORT = 4710;

export function testDatabaseUrl(): string {
  return inject('testDatabaseUrl');
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({
      SG_DATA_DIR: mkdtempSync(join(tmpdir(), 'sg-core-it-')),
      SG_CORE_PORT: String(TEST_PORT),
      DATABASE_URL: testDatabaseUrl(),
      SG_WEB_DIR: join(tmpdir(), 'sg-core-it-gibt-es-nicht'),
    }),
    ...overrides,
  };
}

export interface TestApp {
  app: FastifyInstance;
  handle: DbHandle;
  config: Config;
  /** Wie `app.inject`, aber lokal mit korrektem Host-Header (localhost:<Port>) */
  request: (options: InjectOptions) => Promise<LightMyRequestResponse>;
  close: () => Promise<void>;
}

export async function startTestApp(
  overrides: Partial<Config> = {},
  extra: Partial<BuildAppOptions> = {},
): Promise<TestApp> {
  const config = testConfig(overrides);
  const handle = createDb(config.databaseUrl);
  const app = await buildApp({
    config,
    db: handle.db,
    logger: pino({ level: 'silent' }),
    // Der Session-Takt läuft in Tests nur, wenn ein Test ihn ausdrücklich einschaltet
    sessionTicker: false,
    ...extra,
  });
  await app.ready();
  return {
    app,
    handle,
    config,
    request: (options) =>
      app.inject({
        remoteAddress: '127.0.0.1',
        ...options,
        headers: { host: `localhost:${config.port}`, ...options.headers },
      }),
    close: async () => {
      await app.close();
      await handle.close();
    },
  };
}
