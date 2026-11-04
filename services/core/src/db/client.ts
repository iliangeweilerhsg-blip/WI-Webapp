import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.ts';

export type Db = PostgresJsDatabase<typeof schema>;
/** Transaktion aus `db.transaction(async (tx) => …)` */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Funktionen, die in einer Transaktion oder auf der Verbindung laufen dürfen */
export type DbOrTx = Db | Tx;

export interface DbHandle {
  /** Rohe postgres.js-Verbindung (z. B. für LISTEN) */
  sql: postgres.Sql;
  db: Db;
  close: () => Promise<void>;
}

export function createDb(databaseUrl: string): DbHandle {
  const sql = postgres(databaseUrl, {
    max: 10,
    connect_timeout: 5,
    // Feste Formate, damit Zeitstempel als Text (Cursor) nie vom Server-Standard abhängen
    connection: { DateStyle: 'ISO', TimeZone: 'UTC' },
    // NOTICEs (z. B. „Erweiterung existiert schon“) nicht auf stderr kippen
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return { sql, db, close: () => sql.end({ timeout: 5 }) };
}
