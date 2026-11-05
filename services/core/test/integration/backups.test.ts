// T1-18: GET /backups, POST /backup (mit Fake statt CLI), Zeitplan für Backup und maintenance.nightly
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID, type BackupOverview, type BackupRun } from '@sg/shared';
import { setting } from '../../src/db/schema/index.ts';
import {
  latestOccurrence,
  nextOccurrence,
  setBackupLauncher,
  type LaunchInput,
} from '../../src/services/backups.ts';
import { tickBackup, tickNightly } from '../../src/services/scheduler.ts';
import { startTestApp, type TestApp } from './helpers.ts';

const API = '/api/v1';
let t: TestApp;
let launched: LaunchInput[];

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await truncate();
  setBackupLauncher(null);
  await t.close();
});
beforeEach(async () => {
  await truncate();
  launched = [];
  setBackupLauncher(async (input) => {
    launched.push(input);
  });
});
afterEach(() => setBackupLauncher(null));

async function truncate() {
  await t.handle.sql`TRUNCATE backup_run, setting, job CASCADE`;
}

async function setData(value: Record<string, unknown>) {
  await t.handle.db
    .insert(setting)
    .values({ key: 'data', value, userId: SINGLE_USER_ID })
    .onConflictDoUpdate({ target: setting.key, set: { value } });
}

async function insertRun(row: {
  started: string;
  state: 'laeuft' | 'fertig' | 'fehler';
  trigger?: 'zeitplan' | 'manuell' | 'vor_migration';
  finished?: string | null;
}) {
  const id = crypto.randomUUID();
  await t.handle
    .sql`INSERT INTO backup_run (id, user_id, started_at, finished_at, target, state, trigger, created_at)
    VALUES (${id}, ${SINGLE_USER_ID}, ${row.started}, ${row.finished ?? null}, '/ziel', ${row.state}, ${row.trigger ?? 'manuell'}, ${row.started})`;
  return id;
}

describe('Zeitrechnung', () => {
  it('latestOccurrence / nextOccurrence in Ortszeit', () => {
    const now = new Date(2026, 10, 4, 10, 15, 0);
    expect(latestOccurrence(now, '03:00')).toEqual(new Date(2026, 10, 4, 3, 0, 0));
    expect(nextOccurrence(now, '03:00')).toEqual(new Date(2026, 10, 5, 3, 0, 0));
    const early = new Date(2026, 10, 4, 2, 0, 0);
    expect(latestOccurrence(early, '03:00')).toEqual(new Date(2026, 10, 3, 3, 0, 0));
    expect(nextOccurrence(early, '03:00')).toEqual(new Date(2026, 10, 4, 3, 0, 0));
    // Ungültige Uhrzeit fällt auf 03:00 zurück
    expect(latestOccurrence(now, 'kaputt')).toEqual(new Date(2026, 10, 4, 3, 0, 0));
  });
});

describe('GET /backups', () => {
  it('ohne Ziel und ohne Läufe: Backups pausieren, stale', async () => {
    const res = await t.request({ method: 'GET', url: `${API}/backups` });
    expect(res.statusCode).toBe(200);
    expect(res.json<BackupOverview>()).toEqual({
      status: { target: null, last_success_at: null, next_run_at: null, stale: true, running: false },
      items: [],
      next_cursor: null,
    });
  });

  it('mit Ziel: nächster Lauf, letzter Erfolg, stale nach 3 Tagen, Läufe neueste zuerst', async () => {
    await setData({ backup_target: '/ziel', backup_time: '04:30' });
    const recent = new Date(Date.now() - 3600_000).toISOString();
    await insertRun({ started: new Date(Date.now() - 2 * 86_400_000).toISOString(), state: 'fehler' });
    const ok = await insertRun({ started: recent, state: 'fertig', finished: recent });
    const body = (await t.request({ method: 'GET', url: `${API}/backups` })).json<BackupOverview>();
    expect(body.status.target).toBe('/ziel');
    expect(body.status.stale).toBe(false);
    expect(body.status.last_success_at).toBe(recent);
    expect(body.status.running).toBe(false);
    const next = new Date(body.status.next_run_at as string);
    expect([next.getHours(), next.getMinutes()]).toEqual([4, 30]);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect(body.items.map((r) => r.state)).toEqual(['fertig', 'fehler']);
    expect(body.items[0]?.id).toBe(ok);

    // Älter als 3 Tage: veraltet
    await t.handle.sql`UPDATE backup_run SET finished_at = now() - interval '4 days' WHERE id = ${ok}`;
    const stale = (await t.request({ method: 'GET', url: `${API}/backups` })).json<BackupOverview>();
    expect(stale.status.stale).toBe(true);
  });

  it('ein "laeuft" von vor Tagen gilt als abgestürzt und blockiert nicht', async () => {
    await setData({ backup_target: '/ziel' });
    await insertRun({ started: new Date(Date.now() - 2 * 86_400_000).toISOString(), state: 'laeuft' });
    expect(
      (await t.request({ method: 'GET', url: `${API}/backups` })).json<BackupOverview>().status.running,
    ).toBe(false);
    expect((await t.request({ method: 'POST', url: `${API}/backup` })).statusCode).toBe(202);
  });
});

describe('POST /backup', () => {
  it('409 backup_target_missing ohne Ziel', async () => {
    const res = await t.request({ method: 'POST', url: `${API}/backup` });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('backup_target_missing');
    expect(launched).toHaveLength(0);
  });

  it('202 mit BackupRun, startet die CLI mit der Lauf-ID; zweiter Aufruf ist 409 backup_running', async () => {
    await setData({ backup_target: '/ziel' });
    const res = await t.request({ method: 'POST', url: `${API}/backup` });
    expect(res.statusCode).toBe(202);
    const run = res.json<BackupRun>();
    expect(run).toMatchObject({
      state: 'laeuft',
      trigger: 'manuell',
      target: '/ziel',
      stand: null,
      finished_at: null,
      error: null,
    });
    expect(launched).toHaveLength(1);
    expect(launched[0]).toMatchObject({ runId: run.id, trigger: 'manuell' });

    const again = await t.request({ method: 'POST', url: `${API}/backup` });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('backup_running');
    expect(launched).toHaveLength(1);
    expect(
      (await t.request({ method: 'GET', url: `${API}/backups` })).json<BackupOverview>().status.running,
    ).toBe(true);
  });

  it('gleichzeitige Aufrufe starten genau einen Lauf', async () => {
    await setData({ backup_target: '/ziel' });
    const results = await Promise.all(
      Array.from({ length: 4 }, () => t.request({ method: 'POST', url: `${API}/backup` })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([202, 409, 409, 409]);
    expect(launched).toHaveLength(1);
  });

  it('startet die CLI nicht: Lauf wird "fehler" und die Antwort zeigt es', async () => {
    await setData({ backup_target: '/ziel' });
    setBackupLauncher(async () => {
      throw new Error('spawn node ENOENT');
    });
    const res = await t.request({ method: 'POST', url: `${API}/backup` });
    expect(res.statusCode).toBe(202);
    expect(res.json<BackupRun>()).toMatchObject({ state: 'fehler' });
    expect(res.json<BackupRun>().error).toContain('ENOENT');
    // Danach ist ein neuer Versuch möglich
    setBackupLauncher(async (input) => void launched.push(input));
    expect((await t.request({ method: 'POST', url: `${API}/backup` })).statusCode).toBe(202);
  });
});

describe('Zeitplan: Backup', () => {
  const config = () => ({
    dataDir: t.config.dataDir,
    databaseUrl: t.config.databaseUrl,
    port: t.config.port,
  });

  it('ohne Ziel passiert nichts', async () => {
    expect(await tickBackup(t.handle.db, config(), new Date(2026, 10, 4, 12, 0))).toBeNull();
    expect(launched).toHaveLength(0);
  });

  it('startet nach der Uhrzeit genau einmal (zeitplan), auch verpasst nachgeholt; kein Neustart am selben Tag', async () => {
    await setData({ backup_target: '/ziel', backup_time: '03:00' });
    const wake = new Date(Date.now()); // jetzt: der letzte 03:00-Termin liegt höchstens 24 h zurück
    const first = await tickBackup(t.handle.db, config(), wake);
    expect(first).not.toBeNull();
    expect(launched).toHaveLength(1);
    expect(launched[0]?.trigger).toBe('zeitplan');
    // Der Lauf ist durch und fehlgeschlagen: kein zweiter Versuch bis zum nächsten Termin
    await t.handle.sql`UPDATE backup_run SET state = 'fehler', finished_at = now() WHERE id = ${first}`;
    expect(await tickBackup(t.handle.db, config(), wake)).toBeNull();
    expect(launched).toHaveLength(1);
    // Am nächsten Tag nach dem Termin wieder
    const nextDay = new Date(wake.getTime() + 25 * 3600_000);
    expect(await tickBackup(t.handle.db, config(), nextDay)).not.toBeNull();
  });

  it('ein manuelles Backup nach dem Termin ersetzt das geplante', async () => {
    await setData({ backup_target: '/ziel', backup_time: '03:00' });
    const now = new Date();
    await insertRun({
      started: now.toISOString(),
      state: 'fertig',
      finished: now.toISOString(),
      trigger: 'manuell',
    });
    expect(await tickBackup(t.handle.db, config(), now)).toBeNull();
  });
});

describe('Zeitplan: maintenance.nightly', () => {
  it('legt den Job mit Standard-Payload einmal pro 03:30-Termin an', async () => {
    const day = new Date(2026, 10, 4, 12, 0);
    const first = await tickNightly(t.handle.db, day);
    expect(first).not.toBeNull();
    await t.handle.sql`UPDATE job SET created_at = ${day.toISOString()}`;
    expect(await tickNightly(t.handle.db, new Date(2026, 10, 4, 13, 0))).toBeNull();
    const [row] = await t.handle.sql`SELECT type, payload, state FROM job`;
    expect(row).toMatchObject({ type: 'maintenance.nightly', payload: {}, state: 'wartet' });

    // Der Job vom Vortag zählt nicht, nach 03:30 des nächsten Tages kommt ein neuer
    await t.handle.sql`UPDATE job SET created_at = ${new Date(2026, 10, 4, 3, 31).toISOString()}`;
    expect(await tickNightly(t.handle.db, new Date(2026, 10, 5, 3, 29))).toBeNull();
    expect(await tickNightly(t.handle.db, new Date(2026, 10, 5, 3, 30))).not.toBeNull();
    const [count] = await t.handle.sql`SELECT count(*)::int AS n FROM job`;
    expect(count?.n).toBe(2);
  });
});
