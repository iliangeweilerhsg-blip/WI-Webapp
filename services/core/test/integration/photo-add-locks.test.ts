// Sperrreihenfolge von `photo.add` (VERTRAEGE §16.2): Der Handler hält den Strom `session:<id>` und liest danach die
// Session-Zeile. Das darf sich nicht mit Zustandswechseln kreuzen (Session `FOR NO KEY UPDATE`, dann Strom).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SINGLE_USER_ID } from '@sg/shared';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { upsertPhotoMeta } from '../../src/services/photos.ts';
import { appendOp } from '../../src/sync/append.ts';
import { startTestApp, type TestApp } from './helpers.ts';
import { AT, seedModule } from './ink-helpers.ts';

const base = { user_id: SINGLE_USER_ID };
let t: TestApp;
let dataDir: string;
let moduleId: string;

beforeAll(async () => {
  t = await startTestApp();
  dataDir = mkdtempSync(join(tmpdir(), 'sg-photo-locks-'));
});
afterAll(async () => {
  await truncate();
  await t.close();
  rmSync(dataDir, { recursive: true, force: true });
});
beforeEach(async () => {
  await truncate();
  moduleId = (await seedModule(t.handle.db)).moduleId;
});

async function truncate() {
  await t.handle
    .sql`TRUNCATE semester, module, calendar_source, calendar_event, session, photo, sync_op, sync_stream, setting, job CASCADE`;
}

async function blockedCount(): Promise<number> {
  const rows = await t.handle.sql`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
  return rows[0]?.n ?? 0;
}

async function waitForBlocked(n: number): Promise<void> {
  await vi.waitFor(async () => expect(await blockedCount()).toBeGreaterThanOrEqual(n), {
    timeout: 5_000,
    interval: 25,
  });
}

async function seedSession(state: 'laeuft' | 'beendet'): Promise<string> {
  const s = t.handle.sql;
  const id = uuidv7();
  await s`INSERT INTO session ${s({ id, ...base, module_id: moduleId, state, started_at: new Date().toISOString(), title: 'VL' })}`;
  return id;
}

const photoData = (sessionId: string, photoId: string) => ({
  photo_id: photoId,
  session_id: sessionId,
  t_ms: 10,
  page_id: null,
  file_ref: { sha256: 'a'.repeat(64), mime: 'image/jpeg' as const, size_bytes: 10 },
});

/**
 * `photo.add` wie im Sync-Server: `appendOp` (Strom `FOR UPDATE`), dann der Handler. `afterStream` hält den Ablauf
 * zwischen beiden an, damit der Test die Gegenseite an die Session-Zeile bringen kann.
 */
function runPhotoAdd(
  sessionId: string,
  photoId: string,
  afterStream: Promise<void> = Promise.resolve(),
  onStream: () => void = () => undefined,
) {
  const data = photoData(sessionId, photoId);
  return t.handle.db.transaction(async (tx) => {
    await appendOp(tx, `session:${sessionId}`, {
      kind: 'photo.add',
      data,
      at: AT,
      clockUncertain: false,
      origin: 'ipad',
      opId: uuidv7(),
    });
    onStream();
    await afterStream;
    await upsertPhotoMeta(tx, data, { dataDir });
  });
}

const errorCode = (e: unknown): string | undefined =>
  (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;

describe('photo.add: Sperren an der Session-Zeile', () => {
  it('Gate hält die Session FOR NO KEY UPDATE und will danach den Strom: photo.add verklemmt sich nicht (kein 40P01)', async () => {
    const s = t.handle.sql;
    const ses = await seedSession('laeuft');
    const photoId = uuidv7();
    const gate = await s.reserve();
    let gateError: unknown = null;
    let photoResult: unknown = null;
    let settled = false;
    let adding: Promise<unknown> | undefined;
    try {
      await gate`BEGIN`;
      await gate`SELECT id FROM session WHERE id = ${ses} FOR NO KEY UPDATE`;
      adding = runPhotoAdd(ses, photoId)
        .then(
          (r) => (photoResult = r),
          (e) => (photoResult = e),
        )
        .finally(() => (settled = true));
      // Richtig: photo.add ist fertig. Falsch: Es hängt an der Session-Zeile, dann folgt der Stromschritt (40P01)
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
      await Promise.allSettled([adding]);
    }
    expect(errorCode(gateError)).toBeUndefined();
    expect(photoResult).not.toBeInstanceOf(Error);
    expect(await s`SELECT 1 FROM photo WHERE id = ${photoId} AND deleted_at IS NULL`).toHaveLength(1);
  });

  it.each([
    ['POST /sessions/{id}/pause', 'POST', '/pause', 'pausiert'],
    ['PATCH /sessions/{id}', 'PATCH', '', 'laeuft'],
  ] as const)(
    'photo.add hält den Strom, parallel %s: kein 40P01, beide Ergebnisse stimmen',
    async (_name, method, suffix, state) => {
      const s = t.handle.sql;
      const ses = await seedSession('laeuft');
      const photoId = uuidv7();
      let release!: () => void;
      const hold = new Promise<void>((resolve) => (release = resolve));
      let streamHeld!: () => void;
      const held = new Promise<void>((resolve) => (streamHeld = resolve));
      let adding: Promise<unknown> | undefined;
      let requesting: ReturnType<TestApp['request']> | undefined;
      try {
        adding = runPhotoAdd(ses, photoId, hold, streamHeld);
        adding.catch(() => undefined);
        // Der Strom `session:<id>` gehört jetzt photo.add (`appendOp` ist durch, die Transaktion offen)
        await held;
        requesting = t.request({
          method,
          url: `/api/v1/sessions/${ses}${suffix}`,
          ...(method === 'PATCH' ? { payload: { title: 'Neu' } } : {}),
        });
        requesting.catch(() => undefined);
        // Pause: Session `FOR NO KEY UPDATE`, wartet dann auf den Strom. PATCH berührt den Strom nicht und ist sofort durch
        if (method === 'POST') await waitForBlocked(1);
        else await requesting;
        release();
        const [, response] = await Promise.all([adding, requesting]);
        expect(response.statusCode, response.body).toBe(200);
      } finally {
        release();
        await Promise.allSettled([adding, requesting]);
      }
      const row = await s`SELECT state, title FROM session WHERE id = ${ses}`;
      expect(row[0]?.state).toBe(state);
      if (method === 'PATCH') expect(row[0]?.title).toBe('Neu');
      expect(await s`SELECT 1 FROM photo WHERE id = ${photoId} AND deleted_at IS NULL`).toHaveLength(1);
    },
  );

  it('Session löschen ‖ photo.add: das Foto übernimmt deleted_at der gelöschten Session (nie aktiv an gelöschter Session)', async () => {
    const s = t.handle.sql;
    const ses = await seedSession('beendet');
    const photoId = uuidv7();
    // Ein fremder Löscher hält die Session-Zeile `FOR UPDATE` wie `softDelete` und setzt `deleted_at` erst beim Commit
    const gate = await s.reserve();
    let adding: Promise<unknown> | undefined;
    try {
      await gate`BEGIN`;
      await gate`SELECT id FROM session WHERE id = ${ses} FOR UPDATE`;
      adding = runPhotoAdd(ses, photoId);
      adding.catch(() => undefined);
      await waitForBlocked(1);
      await gate`UPDATE session SET deleted_at = now() WHERE id = ${ses}`;
      await gate`COMMIT`;
      await adding;
    } finally {
      await gate`ROLLBACK`.catch(() => undefined);
      gate.release();
      await Promise.allSettled([adding]);
    }
    const rows = await s`SELECT deleted_at IS NOT NULL AS deleted FROM photo WHERE id = ${photoId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deleted).toBe(true);
  });
});
