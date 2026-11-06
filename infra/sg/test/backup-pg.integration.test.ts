// #124 (H3) gegen echtes PostgreSQL: Welcher Lauf zählt als „voriger“ für die Warnung? Läuft nur mit DATABASE_URL
// (CI: Job „Integration“ über `test:integration`), sonst übersprungen.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID } from '@sg/shared';
import { recordLeftovers, type Leftover } from '../src/backup.ts';
import { createPg, realExec, type PgAccess } from '../src/pg.ts';

const BASE = process.env.DATABASE_URL;
const MIGRATE = fileURLToPath(new URL('../../../services/core/src/migrate.ts', import.meta.url));

describe.skipIf(!BASE)('recordLeftovers gegen PostgreSQL (Nacharbeit Review #160)', () => {
  const name = `sg_cli_it_${randomBytes(4).toString('hex')}`;
  let admin: PgAccess;
  let pg: PgAccess;

  beforeAll(() => {
    const base = new URL(BASE as string);
    admin = createPg({ databaseUrl: base.toString(), composeFile: '' }, realExec, 'local');
    const url = new URL(base.toString());
    url.pathname = `/${name}`;
    pg = createPg({ databaseUrl: url.toString(), composeFile: '' }, realExec, 'local');
    return admin.query(`CREATE DATABASE ${name}`).then(() => {
      execFileSync('node', [MIGRATE], {
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: 'pipe',
      });
    });
  }, 120_000);

  afterAll(async () => {
    await admin?.query(`DROP DATABASE IF EXISTS ${name}`);
  });

  async function run(
    id: string,
    state: string,
    target: string,
    hoursAgo: number,
    thinLeft: string[] | null,
  ): Promise<void> {
    await pg.query(
      `INSERT INTO backup_run (id, user_id, started_at, finished_at, target, state, trigger, thin_left)
       VALUES (:'id'::uuid, :'user'::uuid, now() - (:'h' || ' hours')::interval,
               now() - (:'h' || ' hours')::interval, :'target', :'state', 'zeitplan',
               CASE WHEN :'left' = '-' THEN NULL ELSE string_to_array(:'left', '/') END)`,
      {
        id,
        user: SINGLE_USER_ID,
        h: String(hoursAgo),
        target,
        state,
        left: thinLeft ? thinLeft.join('/') : '-',
      },
    );
  }

  it('nur der jüngste fertige Lauf mit demselben Ziel zählt (nicht fehlgeschlagene, nicht andere Ziele)', async () => {
    const [A, B, C] = ['20261001T030000Z', '20261002T030000Z', '20261003T030000Z'] as const;
    await run('019a4e14-0000-7000-8000-000000000101', 'fertig', '/ziel', 4, [A]);
    await run('019a4e14-0000-7000-8000-000000000102', 'fehler', '/ziel', 3, [B]); // nicht fertig
    await run('019a4e14-0000-7000-8000-000000000103', 'fertig', '/anderes', 2, [C]); // anderes Ziel
    const current = '019a4e14-0000-7000-8000-000000000104';
    await run(current, 'fertig', '/ziel', 1, null);
    const left: Leftover[] = [A, B, C].map((n) => ({ name: n, reason: 'x', cause: 'EPERM' }));
    const errs: string[] = [];
    await recordLeftovers(
      { pg, err: (m) => errs.push(m), cfg: { dataDir: '/nirgends', databaseUrl: BASE as string } },
      current,
      '/ziel',
      left,
    );
    expect(errs.filter((e) => !e.startsWith('Warnung:'))).toEqual([]);
    const [row] = await pg.query(
      `SELECT array_to_string(thin_left, '/'), warning FROM backup_run WHERE id = :'id'::uuid`,
      { id: current },
    );
    expect(row?.[0]).toBe(`${A}/${B}/${C}`);
    expect(row?.[1]).toBe(
      `Ein alter Backup-Stand lässt sich seit mehreren Läufen nicht löschen (keine Berechtigung). Prüfe das Backup-Ziel und lösche den Ordner „${A}“ von Hand.`,
    );
  });
});
