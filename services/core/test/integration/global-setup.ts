import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
import { createDb } from '../../src/db/client.ts';
import { runMigrations } from '../../src/db/migrate.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** URL der frischen Test-Datenbank (pro Lauf neu, durch Migrationen aufgebaut) */
    testDatabaseUrl: string;
  }
}

/**
 * Legt pro Lauf eine eigene Datenbank auf dem Server aus DATABASE_URL an, baut sie über die
 * Migrationen auf und löscht sie am Ende wieder. Die Daten der Ausgangsdatenbank bleiben unberührt.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error(
      'DATABASE_URL fehlt. Beispiel: DATABASE_URL=postgres://sg:sg@127.0.0.1:5432/sg_test pnpm --filter @sg/core test:integration',
    );
  }
  const name = `sg_it_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${name}`;

  const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${name}`);

  const handle = createDb(testUrl.toString());
  try {
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }

  project.provide('testDatabaseUrl', testUrl.toString());

  return async () => {
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      await admin.end({ timeout: 5 });
    }
  };
}
