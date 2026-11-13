// Sperrreihenfolge beim Wiederherstellen aus dem Papierkorb (#352, VERTRAEGE §13 und §16.2): Marker/Foto gegen
// Zustandswechsel der Session, Modul wiederherstellen gegen Semester löschen.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SINGLE_USER_ID } from '@sg/shared';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { restoreWithOps, softDeleteWithOps } from '../../src/services/trash-ops.ts';
import { startTestApp, type TestApp } from './helpers.ts';

const base = { user_id: SINGLE_USER_ID };
let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await truncate();
  await t.close();
});
beforeEach(truncate);

async function truncate() {
  await t.handle
    .sql`TRUNCATE semester, module, calendar_source, calendar_event, session, slide_deck, exercise_sheet,
    notebook, sync_stream, setting, backup_run, job CASCADE`;
}

async function blockedCount(): Promise<number> {
  const rows = await t.handle.sql`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
  return rows[0]?.n ?? 0;
}

/** Wartet, bis mindestens `n` Verbindungen dieser Datenbank auf eine Sperre warten (kein festes Warten) */
async function waitForBlocked(n: number): Promise<void> {
  await vi.waitFor(async () => expect(await blockedCount()).toBeGreaterThanOrEqual(n), {
    timeout: 5_000,
    interval: 25,
  });
}

const errorCode = (e: unknown): string | undefined =>
  (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;

describe('Papierkorb-Restore: Sperrreihenfolge (#352)', () => {
  it.each(['photo', 'marker'] as const)(
    '%s einer laufenden Session wiederherstellen ‖ Zustandswechsel (Session-Zeile, dann Strom): kein 40P01',
    async (kind) => {
      const s = t.handle.sql;
      const sem = uuidv7();
      const mod = uuidv7();
      const ses = uuidv7();
      const child = uuidv7();
      await s`INSERT INTO semester ${s({ id: sem, ...base, name: 'HS', is_current: true })}`;
      await s`INSERT INTO module ${s({ id: mod, ...base, semester_id: sem, name: 'DBS', color: 'mod-01' })}`;
      await s`INSERT INTO session ${s({ id: ses, ...base, module_id: mod, state: 'laeuft', started_at: new Date().toISOString(), title: 'VL' })}`;
      if (kind === 'photo') {
        await s`INSERT INTO photo ${s({ id: child, ...base, session_id: ses, t_ms: 5, mime: 'image/jpeg', sha256: 'c'.repeat(64), size_bytes: 1, file_path: `media/photos/${child}.jpg` })}`;
      } else {
        await s`INSERT INTO marker ${s({ id: child, ...base, session_id: ses, t_ms: 5, kind: 'frage', source: 'mac' })}`;
      }
      await softDeleteWithOps(t.handle.db, kind, child);

      // Das Gate spielt `transitionSession('stop')` nach: Advisory-Sperre, Session `FOR NO KEY UPDATE`, dann `appendOp`
      // (Strom `FOR UPDATE`, VERTRAEGE §16.2). Der Restore hält den Strom `session:X` und darf die Session-Zeile nicht
      // stärker sperren als `FOR KEY SHARE`, sonst wartet er auf das Gate, das Gate auf den Strom: 40P01.
      const gate = await s.reserve();
      let gateError: unknown = null;
      let restoreResult: unknown = null;
      let settled = false;
      let restoring: Promise<unknown> | undefined;
      try {
        await gate`BEGIN`;
        await gate`SELECT pg_advisory_xact_lock(hashtextextended('sg:session-transition', 0))`;
        await gate`SELECT id FROM session WHERE id = ${ses} FOR NO KEY UPDATE`;
        restoring = restoreWithOps(t.handle.db, child)
          .then(
            (r) => (restoreResult = r),
            (e) => (restoreResult = e),
          )
          .finally(() => (settled = true));
        // Richtig: Der Restore ist fertig. Falsch: Er hängt an der Session-Zeile, dann folgt der Stromschritt (40P01)
        await vi.waitFor(async () => expect(settled || (await blockedCount()) >= 1).toBe(true), {
          timeout: 5_000,
          interval: 25,
        });
        try {
          await gate`INSERT INTO sync_stream (stream, head_seq) VALUES (${'session:' + ses}, 0) ON CONFLICT DO NOTHING`;
          await gate`SELECT head_seq FROM sync_stream WHERE stream = ${'session:' + ses} FOR UPDATE`;
          await gate`COMMIT`;
        } catch (e) {
          gateError = e;
          await gate`ROLLBACK`.catch(() => undefined);
        }
      } finally {
        await gate`ROLLBACK`.catch(() => undefined);
        gate.release();
        await Promise.allSettled([restoring]);
      }
      expect(errorCode(gateError)).toBeUndefined();
      expect(restoreResult).not.toBeInstanceOf(Error);
      expect(settled).toBe(true);
      expect(await s`SELECT 1 FROM ${s(kind)} WHERE id = ${child} AND deleted_at IS NULL`).toHaveLength(1);
    },
  );

  async function seedSemester() {
    const s = t.handle.sql;
    const sem = uuidv7();
    const m1 = uuidv7();
    const m2 = uuidv7();
    const nb2 = uuidv7();
    await s`INSERT INTO semester ${s({ id: sem, ...base, name: 'HS', is_current: true })}`;
    await s`INSERT INTO module ${s({ id: m1, ...base, semester_id: sem, name: 'A', color: 'mod-01' })}`;
    await s`INSERT INTO module ${s({ id: m2, ...base, semester_id: sem, name: 'B', color: 'mod-02' })}`;
    await s`INSERT INTO notebook ${s({ id: nb2, ...base, module_id: m2, title: 'Frei' })}`;
    await softDeleteWithOps(t.handle.db, 'module', m2);
    return { sem, m1, m2, nb2 };
  }

  const opKinds = async (nb: string) =>
    (await t.handle.sql`SELECT kind FROM sync_op WHERE stream = ${'notebook:' + nb} ORDER BY seq`).map(
      (o) => o.kind as string,
    );

  it('Modul wiederherstellen ‖ Semester löschen, Restore zuerst: das Löschen nimmt das Notizbuch mit und schreibt notebook.delete', async () => {
    const s = t.handle.sql;
    const { sem, m2, nb2 } = await seedSemester();
    // Eine fremde Transaktion hält die Wurzel des Restores: Er steht mitten in seiner Reihenfolge, wenn das Löschen kommt
    const gate = await s.reserve();
    let restoring: ReturnType<typeof restoreWithOps> | undefined;
    let deleting: ReturnType<TestApp['request']> | undefined;
    try {
      await gate`BEGIN`;
      await gate`SELECT id FROM module WHERE id = ${m2} FOR UPDATE`;
      restoring = restoreWithOps(t.handle.db, m2);
      await waitForBlocked(1);
      deleting = t.request({ method: 'DELETE', url: `/api/v1/semesters/${sem}` });
      await waitForBlocked(2);
      await gate`COMMIT`;
      const [restored, deleted] = await Promise.all([restoring, deleting]);
      expect(restored.kind).toBe('module');
      expect(deleted.statusCode, deleted.body).toBe(204);
    } finally {
      await gate`ROLLBACK`.catch(() => undefined);
      gate.release();
      await Promise.allSettled([restoring, deleting]);
    }
    const state = await s`SELECT (SELECT deleted_at IS NOT NULL FROM module WHERE id = ${m2}) AS m2_deleted,
                                 (SELECT deleted_at IS NOT NULL FROM notebook WHERE id = ${nb2}) AS nb2_deleted,
                                 (SELECT deleted_at IS NOT NULL FROM semester WHERE id = ${sem}) AS sem_deleted`;
    expect(state[0]).toEqual({ m2_deleted: true, nb2_deleted: true, sem_deleted: true });
    // Clients sehen: gelöscht, wiederhergestellt, wieder gelöscht
    expect(await opKinds(nb2)).toEqual(['notebook.delete', 'notebook.restore', 'notebook.delete']);
  });

  it('Modul wiederherstellen ‖ Semester löschen, Löschen zuerst: Restore bekommt 409 restore_parent_deleted', async () => {
    const s = t.handle.sql;
    const { sem, m1, m2, nb2 } = await seedSemester();
    // Das Löschen steht an einem aktiven Modul fest; der Restore kommt danach und muss hinter ihm warten
    const gate = await s.reserve();
    let restoring: ReturnType<typeof restoreWithOps> | undefined;
    let deleting: ReturnType<TestApp['request']> | undefined;
    try {
      await gate`BEGIN`;
      await gate`SELECT id FROM module WHERE id = ${m1} FOR NO KEY UPDATE`;
      deleting = t.request({ method: 'DELETE', url: `/api/v1/semesters/${sem}` });
      await waitForBlocked(1);
      restoring = restoreWithOps(t.handle.db, m2);
      restoring.catch(() => undefined);
      await waitForBlocked(2);
      await gate`COMMIT`;
      const deleted = await deleting;
      expect(deleted.statusCode, deleted.body).toBe(204);
      await expect(restoring).rejects.toMatchObject({ statusCode: 409, code: 'restore_parent_deleted' });
    } finally {
      await gate`ROLLBACK`.catch(() => undefined);
      gate.release();
      await Promise.allSettled([restoring, deleting]);
    }
    const state = await s`SELECT (SELECT deleted_at IS NOT NULL FROM module WHERE id = ${m2}) AS m2_deleted,
                                 (SELECT deleted_at IS NOT NULL FROM notebook WHERE id = ${nb2}) AS nb2_deleted`;
    expect(state[0]).toEqual({ m2_deleted: true, nb2_deleted: true });
    expect((await opKinds(nb2)).at(-1)).toBe('notebook.delete');
  });
});
