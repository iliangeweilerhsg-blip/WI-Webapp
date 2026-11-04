import { defineConfig } from 'drizzle-kit';

// Nur für `drizzle-kit generate` (db:generate). Migrationen laufen über src/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://sg:sg@127.0.0.1:5432/sg' },
});
