// #78 (F-DAT-02): monatlicher Restore-Test: Ergebnis in GET /backups, POST /restore-test (mit Fake statt CLI), Zeitplan
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID, type BackupOverview, type RestoreTest } from '@sg/shared';
import { setting } from '../../src/db/schema/index.ts';
import {
  restoreTestDue,
  setRestoreTestLauncher,
  tickRestoreTest,
  RESTORE_TEST_INTERVAL_MS,
} from '../../src/services/restore-test.ts';
import { startTestApp, type TestApp } from './helpers.ts';

const API = '/api/v1';
const SHA = 'a'.repeat(64);
let t: TestApp;
let launched: { trigger: string }[];

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await truncate();
  setRestoreTestLauncher(null);
  await t.close();
});
beforeEach(async () => {
  await truncate();
  launched = [];
  setRestoreTestLauncher(async (input) => {
    launched.push({ trigger: input.trigger });
  });
});
afterEach(() => setRestoreTestLauncher(null));

async function truncate() {
  await t.handle.sql`TRUNCATE backup_run, setting, job CASCADE`;
}

async function setData(value: Record<string, unknown>) {
  await t.handle.db
    .insert(setting)
    .values({ key: 'data', value, userId: SINGLE_USER_ID })
    .onConflictDoUpdate({ target: setting.key, set: { value } });
}

async function setResult(value: RestoreTest) {
  await t.handle.db
    .insert(setting)
    .values({ key: 'restore_test', value, userId: SINGLE_USER_ID })
    .onConflictDoUpdate({ target: setting.key, set: { value } });
}

async function insertRun(
  over: {
    target?: string;
    state?: string;
    stand?: string | null;
    sha?: string | null;
    started?: string;
  } = {},
) {
  const id = crypto.randomUUID();
  const started = over.started ?? new Date(Date.now() - 3600_000).toISOString();
  await t.handle
    .sql`INSERT INTO backup_run (id, user_id, started_at, finished_at, target, state, trigger, stand, dump_sha256, created_at)
    VALUES (${id}, ${SINGLE_USER_ID}, ${started}, ${started}, ${over.target ?? '/ziel'}, ${over.state ?? 'fertig'}, 'zeitplan',
            ${over.stand === undefined ? '20261104T030012Z' : over.stand}, ${over.sha === undefined ? SHA : over.sha}, ${started})`;
  return id;
}

const test = (over: Partial<RestoreTest> = {}): RestoreTest => ({
  state: 'ok',
  trigger: 'zeitplan',
  started_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
  finished_at: new Date(Date.now() - 40 * 86_400_000 + 5000).toISOString(),
  stand: '20261004T030012Z',
  reason: null,
  error: null,
  ...over,
});

const overview = async () =>
  (await t.request({ method: 'GET', url: `${API}/backups` })).json<BackupOverview>().status.restore_test;

describe('Ergebnis in GET /backups', () => {
  it('ohne Test: null; mit Ergebnis: wird ausgeliefert', async () => {
    expect(await overview()).toBeNull();
    const value = test({ state: 'fehler', reason: 'beschaedigt', error: 'Prüfsumme stimmt nicht' });
    await setResult(value);
    expect(await overview()).toEqual(value);
  });

  it('kaputter Eintrag wird ignoriert; ein zu lange laufender Test gilt als abgebrochen', async () => {
    await t.handle
      .sql`INSERT INTO setting (key, value, user_id) VALUES ('restore_test', '{"x":1}'::jsonb, ${SINGLE_USER_ID})`;
    expect(await overview()).toBeNull();
    await setResult(
      test({
        state: 'laeuft',
        finished_at: null,
        started_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
      }),
    );
    expect(await overview()).toMatchObject({ state: 'fehler', reason: 'abgebrochen' });
  });

  it('erscheint nicht in GET /settings und lässt sich nicht über PATCH /settings setzen', async () => {
    await setResult(test());
    const res = await t.request({ method: 'GET', url: `${API}/settings` });
    expect(Object.keys(res.json<Record<string, unknown>>()).sort()).toEqual([
      'data',
      'general',
      'lecture',
      'pen',
    ]);
  });
});

describe('POST /restore-test', () => {
  it('409 ohne Ziel, 409 ohne testbares Backup', async () => {
    let res = await t.request({ method: 'POST', url: `${API}/restore-test` });
    expect(res.json<{ error: { code: string } }>().error.code).toBe('backup_target_missing');
    await setData({ backup_target: '/ziel' });
    res = await t.request({ method: 'POST', url: `${API}/restore-test` });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('restore_test_no_backup');
    // Lauf ohne Prüfsumme (Altbestand), anderes Ziel, nicht fertig oder ohne Stand zählen nicht
    await insertRun({ sha: null });
    await insertRun({ target: '/anderes' });
    await insertRun({ state: 'fehler' });
    await insertRun({ stand: null });
    res = await t.request({ method: 'POST', url: `${API}/restore-test` });
    expect(res.json<{ error: { code: string } }>().error.code).toBe('restore_test_no_backup');
    expect(launched).toHaveLength(0);
  });

  it('202 mit laufendem Test, startet die CLI; zweiter Aufruf 409 restore_test_running', async () => {
    await setData({ backup_target: '/ziel' });
    await insertRun();
    const res = await t.request({ method: 'POST', url: `${API}/restore-test` });
    expect(res.statusCode).toBe(202);
    expect(res.json<RestoreTest>()).toMatchObject({ state: 'laeuft', trigger: 'manuell', finished_at: null });
    expect(launched).toEqual([{ trigger: 'manuell' }]);
    expect(await overview()).toMatchObject({ state: 'laeuft' });
    const again = await t.request({ method: 'POST', url: `${API}/restore-test` });
    expect(again.json<{ error: { code: string } }>().error.code).toBe('restore_test_running');
    expect(launched).toHaveLength(1);
  });

  it('409 backup_running, solange ein Backup läuft', async () => {
    await setData({ backup_target: '/ziel' });
    await insertRun();
    await insertRun({ state: 'laeuft', stand: null, sha: null, started: new Date().toISOString() });
    const res = await t.request({ method: 'POST', url: `${API}/restore-test` });
    expect(res.json<{ error: { code: string } }>().error.code).toBe('backup_running');
  });

  it('Starter scheitert: Ergebnis "fehler" statt ewig "läuft"', async () => {
    await setData({ backup_target: '/ziel' });
    await insertRun();
    setRestoreTestLauncher(async () => {
      throw new Error('spawn kaputt');
    });
    const res = await t.request({ method: 'POST', url: `${API}/restore-test` });
    expect(res.statusCode).toBe(202);
    expect(res.json<RestoreTest>()).toMatchObject({ state: 'fehler', reason: 'intern' });
    expect(await overview()).toMatchObject({ state: 'fehler', reason: 'intern' });
  });
});

describe('Zeitplan (monatlich, Nachholen)', () => {
  const now = new Date('2026-11-10T10:00:00Z');

  it('restoreTestDue: 30 Tage nach Erfolg, nach Fehler erst am nächsten Tag, nie während des Laufs', () => {
    expect(restoreTestDue(null, now)).toBe(true);
    const day = 86_400_000;
    const ok = (ago: number) => test({ finished_at: new Date(now.getTime() - ago).toISOString() });
    expect(restoreTestDue(ok(RESTORE_TEST_INTERVAL_MS - day), now)).toBe(false);
    expect(restoreTestDue(ok(RESTORE_TEST_INTERVAL_MS), now)).toBe(true);
    expect(restoreTestDue(ok(100 * day), now)).toBe(true); // Mac war lange aus: nachholen
    const failedToday = test({ state: 'fehler', started_at: new Date(now.getTime() - 60_000).toISOString() });
    expect(restoreTestDue(failedToday, now)).toBe(false);
    const failedBefore = test({
      state: 'fehler',
      started_at: new Date(now.getTime() - 2 * day).toISOString(),
    });
    expect(restoreTestDue(failedBefore, now)).toBe(true);
    expect(restoreTestDue(test({ state: 'laeuft', finished_at: null }), now)).toBe(false);
  });

  it('startet ohne bisherigen Test, sobald es ein testbares Backup gibt, und nur einmal', async () => {
    await setData({ backup_target: '/ziel' });
    expect(await tickRestoreTest(t.handle.db, t.config, now)).toBe(false); // noch kein Backup
    await insertRun({ started: new Date(now.getTime() - 3600_000).toISOString() });
    expect(await tickRestoreTest(t.handle.db, t.config, now)).toBe(true);
    expect(launched).toEqual([{ trigger: 'zeitplan' }]);
    expect(await tickRestoreTest(t.handle.db, t.config, now)).toBe(false); // läuft
  });

  it('nach bestandenem Test erst nach 30 Tagen wieder, nicht ohne Ziel, nicht während eines Backups', async () => {
    await setData({ backup_target: '/ziel' });
    await insertRun({ started: new Date(now.getTime() - 3600_000).toISOString() });
    await setResult(test({ finished_at: new Date(now.getTime() - 10 * 86_400_000).toISOString() }));
    expect(await tickRestoreTest(t.handle.db, t.config, now)).toBe(false);
    await setResult(test({ finished_at: new Date(now.getTime() - 31 * 86_400_000).toISOString() }));
    await insertRun({
      state: 'laeuft',
      stand: null,
      sha: null,
      started: new Date(now.getTime() - 60_000).toISOString(),
    });
    expect(await tickRestoreTest(t.handle.db, t.config, now)).toBe(false); // Backup läuft
    await t.handle.sql`DELETE FROM backup_run WHERE state = 'laeuft'`;
    await setData({ backup_target: null });
    expect(await tickRestoreTest(t.handle.db, t.config, now)).toBe(false); // kein Ziel
    await setData({ backup_target: '/ziel' });
    expect(await tickRestoreTest(t.handle.db, t.config, now)).toBe(true);
    expect(launched).toHaveLength(1);
  });
});
