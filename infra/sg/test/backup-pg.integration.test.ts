// #124 (H3) gegen echtes PostgreSQL: Welcher Lauf zählt als „voriger“ für die Warnung? Läuft nur mit DATABASE_URL
// (CI: Job „Integration“ über `test:integration`). Lokal ohne DATABASE_URL wird übersprungen; mit CI=true und ohne
// DATABASE_URL scheitert die Datei, damit kein Lauf still grün bleibt (#161).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID } from '@sg/shared';
import { readOwnedStands, recordLeftovers, type Leftover } from '../src/backup.ts';
import { createPg, realExec, type PgAccess } from '../src/pg.ts';
import { runAnchor } from '../src/restore.ts';

const BASE = process.env.DATABASE_URL;
const IN_CI = !!process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0';
const MIGRATE = fileURLToPath(new URL('../../../services/core/src/migrate.ts', import.meta.url));

/**
 * Legt eine frische Testdatenbank an und migriert sie. Läuft parallel eine andere Suite, kann CREATE DATABASE mit
 * 55006 („being accessed by other users“) scheitern; das wird bis zu 5× im Abstand von 500 ms wiederholt.
 */
async function createTestDb(name: string): Promise<{ admin: PgAccess; pg: PgAccess }> {
  const base = new URL(BASE as string);
  const admin = createPg({ databaseUrl: base.toString(), composeFile: '' }, realExec, 'local');
  const url = new URL(base.toString());
  url.pathname = `/${name}`;
  const pg = createPg({ databaseUrl: url.toString(), composeFile: '' }, realExec, 'local');
  for (let attempt = 1; ; attempt++) {
    try {
      await admin.query(`CREATE DATABASE ${name}`);
      break;
    } catch (e) {
      if (attempt >= 5 || !/being accessed by other users/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  execFileSync('node', [MIGRATE], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'pipe',
  });
  return { admin, pg };
}

describe.runIf(IN_CI && !BASE)('Integrationstest braucht in CI eine Datenbank', () => {
  it('DATABASE_URL ist gesetzt', () => {
    throw new Error(
      'CI=true, aber DATABASE_URL fehlt: Die PostgreSQL-Integrationstests würden sonst still übersprungen.',
    );
  });
});

describe.skipIf(!BASE)('recordLeftovers gegen PostgreSQL (Nacharbeit Review #160)', () => {
  const name = `sg_cli_it_${randomBytes(4).toString('hex')}`;
  let admin: PgAccess;
  let pg: PgAccess;

  beforeAll(async () => {
    ({ admin, pg } = await createTestDb(name));
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

describe.skipIf(!BASE)(
  'Eigene Stände aus backup_run gegen PostgreSQL (H-1 aus #161, Härtung aus #114)',
  () => {
    const name = `sg_cli_it_${randomBytes(4).toString('hex')}`;
    let admin: PgAccess;
    let pg: PgAccess;

    beforeAll(async () => {
      ({ admin, pg } = await createTestDb(name));
    }, 120_000);

    afterAll(async () => {
      await admin?.query(`DROP DATABASE IF EXISTS ${name}`);
    });

    async function run(
      id: string,
      over: { state?: string; target?: string; stand?: string; sha?: string; size?: number },
    ): Promise<void> {
      await pg.query(
        `INSERT INTO backup_run (id, user_id, started_at, finished_at, target, state, trigger, stand, dump_sha256, size_bytes)
       VALUES (:'id'::uuid, :'user'::uuid, now(), now(), :'target', :'state', 'vor_migration',
               NULLIF(:'stand', ''), NULLIF(:'sha', ''), NULLIF(:'size', '')::bigint)`,
        {
          id,
          user: SINGLE_USER_ID,
          target: over.target ?? '/ziel',
          state: over.state ?? 'fertig',
          stand: over.stand ?? '',
          sha: over.sha ?? '',
          size: over.size === undefined ? '' : String(over.size),
        },
      );
    }

    it('readOwnedStands: nur fertige Läufe mit Stand für genau dieses Ziel; Prüfsumme leer = null', async () => {
      const sha = 'b'.repeat(64);
      await run('019a4e14-0000-7000-8000-000000000201', { stand: '20261001T030000Z', sha });
      await run('019a4e14-0000-7000-8000-000000000202', { stand: '20261002T030000Z' }); // ohne Prüfsumme
      await run('019a4e14-0000-7000-8000-000000000203', { stand: '20261003T030000Z', state: 'fehler' });
      await run('019a4e14-0000-7000-8000-000000000204', { stand: '20261004T030000Z', target: '/anderes' });
      await run('019a4e14-0000-7000-8000-000000000205', { state: 'laeuft' }); // noch ohne Stand
      const owned = await readOwnedStands(pg, '/ziel');
      expect([...owned.entries()].sort()).toEqual([
        ['20261001T030000Z', { trigger: 'vor_migration', sha256: sha }],
        ['20261002T030000Z', { trigger: 'vor_migration', sha256: null }],
      ]);
    });

    it('runAnchor: Prüfsumme und Größe des eigenen Laufs, unabhängig vom Ziel; ohne Prüfsumme kein Anker', async () => {
      const sha = 'c'.repeat(64);
      await run('019a4e14-0000-7000-8000-000000000211', {
        stand: '20261101T030000Z',
        sha,
        size: 1234,
        target: '/woanders',
      });
      expect(await runAnchor(pg, '20261101T030000Z')).toEqual({ sha256: sha, sizeBytes: 1234 });
      expect(await runAnchor(pg, '20261002T030000Z')).toBeNull(); // Lauf ohne Prüfsumme
      expect(await runAnchor(pg, '20261231T030000Z')).toBeNull(); // kein Lauf
      expect(await runAnchor(pg, "x' OR 1=1")).toBeNull(); // kein Standname
    });
  },
);
