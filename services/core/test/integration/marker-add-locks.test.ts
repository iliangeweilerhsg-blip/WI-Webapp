// Sperrreihenfolge von `marker.add` und `slide.change` (VERTRAEGE §16.2, „Session-Zeile nach dem Strom“): Der Handler
// hält den Strom `session:<id>` und liest danach die Session-Zeile `FOR KEY SHARE`. Das wartet auf ein laufendes Löschen
// der Session (auch ohne Strom: `ensurePlannedSessions`, `createOfflineSession`) und kreuzt sich nicht mit
// Zustandswechseln (Session `FOR NO KEY UPDATE`, dann Strom).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SINGLE_USER_ID, SyncOpSchema, type SyncOp } from '@sg/shared';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { ensurePlannedSessions } from '../../src/services/sessions.ts';
import { appendOp } from '../../src/sync/append.ts';
import { SESSION_HANDLERS, SESSION_PRELOCKS } from '../../src/sync/handlers/session.ts';
import type { Tx } from '../../src/db/client.ts';
import { startTestApp, type TestApp } from './helpers.ts';
import { seedModule } from './ink-helpers.ts';

const base = { user_id: SINGLE_USER_ID };
let t: TestApp;
let moduleId: string;

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await truncate();
  await t.close();
});
beforeEach(async () => {
  await truncate();
  moduleId = (await seedModule(t.handle.db)).moduleId;
});

async function truncate() {
  await t.handle
    .sql`TRUNCATE semester, module, calendar_source, calendar_event, session, marker, slide_event, sync_op, sync_stream, setting, job CASCADE`;
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

/** Offener Schalter: `wait` hält an, bis `open()` gerufen wird */
function latch() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { wait, open };
}

async function seedSession(state: 'laeuft' | 'beendet'): Promise<string> {
  const s = t.handle.sql;
  const id = uuidv7();
  await s`INSERT INTO session ${s({ id, ...base, module_id: moduleId, state, started_at: new Date().toISOString(), title: 'VL' })}`;
  return id;
}

/** Nie gestartete Session (`geplant`) zu einem Vorlesungstermin des Moduls */
async function seedPlanned(): Promise<{ sessionId: string; eventId: string }> {
  const s = t.handle.sql;
  const eventId = uuidv7();
  const sessionId = uuidv7();
  const startsAt = new Date(Date.now() + 24 * 3_600_000);
  const endsAt = new Date(startsAt.getTime() + 90 * 60_000);
  await s`INSERT INTO calendar_event ${s({
    id: eventId,
    ...base,
    module_id: moduleId,
    kind: 'vorlesung',
    title: 'Datenbanken',
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
  })}`;
  await s`INSERT INTO session ${s({ id: sessionId, ...base, module_id: moduleId, calendar_event_id: eventId, state: 'geplant' })}`;
  return { sessionId, eventId };
}

type DataKind = 'marker.add' | 'slide.change';
const KINDS: DataKind[] = ['marker.add', 'slide.change'];
const TABLE = { 'marker.add': 'marker', 'slide.change': 'slide_event' } as const;

function clientOp(kind: SyncOp['kind'], sessionId: string, data: Record<string, unknown>): SyncOp {
  return SyncOpSchema.parse({
    type: 'op',
    op_id: uuidv7(),
    stream: `session:${sessionId}`,
    kind,
    at: Date.now(),
    clock_uncertain: false,
    data,
  });
}

function dataOp(kind: DataKind, sessionId: string, id: string): SyncOp {
  return kind === 'marker.add'
    ? clientOp(kind, sessionId, {
        marker_id: id,
        session_id: sessionId,
        kind: 'frage',
        t_ms: 500,
        page_id: null,
        position: null,
        note: null,
        source: 'ipad',
      })
    : clientOp(kind, sessionId, {
        event_id: id,
        session_id: sessionId,
        slide_id: null,
        slide_index: 2,
        t_ms: 500,
        device: 'ipad',
      });
}

/**
 * Eine Operation wie im Sync-Server: `preLock`, `appendOp` (Strom `FOR UPDATE`), dann der Handler. `onStream`/`afterStream`
 * halten zwischen Strom und Handler an, `afterHandler` vor dem Commit (die Sperren des Handlers bleiben gehalten).
 */
function runOp(
  op: SyncOp,
  hooks: {
    onStream?: () => void;
    afterStream?: Promise<void>;
    onHandler?: () => void;
    afterHandler?: Promise<void>;
  } = {},
) {
  return t.handle.db.transaction(async (tx: Tx) => {
    const preLock = SESSION_PRELOCKS[op.kind];
    if (preLock) await preLock(tx, op);
    await appendOp(tx, op.stream, {
      kind: op.kind,
      data: op.data,
      at: op.at,
      clockUncertain: false,
      origin: 'ipad',
      opId: op.op_id,
    });
    hooks.onStream?.();
    await hooks.afterStream;
    await SESSION_HANDLERS[op.kind]!(tx, op, { deviceId: null, origin: 'ipad' });
    hooks.onHandler?.();
    await hooks.afterHandler;
  });
}

const errorCode = (e: unknown): string | undefined =>
  (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;

/** `deleted_at` des Datensatzes und der Session (als ISO-Text, gleich genau) */
async function deletedAts(kind: DataKind, id: string, sessionId: string) {
  const s = t.handle.sql;
  const [row] = await s`
    SELECT d.deleted_at::text AS data, s.deleted_at::text AS ses
    FROM ${s(TABLE[kind])} d JOIN session s ON s.id = d.session_id
    WHERE d.id = ${id} AND s.id = ${sessionId}`;
  return row as { data: string | null; ses: string | null } | undefined;
}

describe.each(KINDS)('%s: Sperren an der Session-Zeile', (kind) => {
  it('Session wird gerade gelöscht (ensurePlannedSessions: NO KEY UPDATE → softDelete FOR UPDATE): der Datensatz übernimmt deleted_at', async () => {
    const { sessionId, eventId } = await seedPlanned();
    await t.handle.sql`UPDATE calendar_event SET cancelled = true WHERE id = ${eventId}`;
    const id = uuidv7();
    const deleted = latch();
    const commit = latch();
    let deleting: Promise<unknown> | undefined;
    let adding: Promise<unknown> | undefined;
    try {
      // Das Löschen ist durch (Session `FOR UPDATE`, `deleted_at` gesetzt, Kaskade gelaufen), aber nicht committet
      deleting = t.handle.db.transaction(async (tx) => {
        await ensurePlannedSessions(tx, [eventId]);
        deleted.open();
        await commit.wait;
      });
      deleting.catch(() => undefined);
      await deleted.wait;
      adding = runOp(dataOp(kind, sessionId, id));
      adding.catch(() => undefined);
      // Richtig: Der Handler wartet an der Session-Zeile. Ohne Sperre läse er `deleted_at = NULL`
      await waitForBlocked(1);
      commit.open();
      await Promise.all([deleting, adding]);
    } finally {
      commit.open();
      await Promise.allSettled([deleting, adding]);
    }
    const row = await deletedAts(kind, id, sessionId);
    expect(row?.ses).not.toBeNull();
    expect(row?.data).toBe(row?.ses);
  });

  it('Session wird gerade ersetzt (session.start offline → createOfflineSession → softDelete): der Datensatz übernimmt deleted_at', async () => {
    const { sessionId, eventId } = await seedPlanned();
    const newId = uuidv7();
    const id = uuidv7();
    const started = latch();
    const commit = latch();
    let starting: Promise<unknown> | undefined;
    let adding: Promise<unknown> | undefined;
    try {
      const start = clientOp('session.start', newId, {
        session_id: newId,
        module_id: moduleId,
        calendar_event_id: eventId,
        slide_deck_id: null,
        started_from: 'ipad',
        started_at: Date.now(),
      });
      starting = runOp(start, { onHandler: started.open, afterHandler: commit.wait });
      starting.catch(() => undefined);
      await started.wait;
      adding = runOp(dataOp(kind, sessionId, id));
      adding.catch(() => undefined);
      await waitForBlocked(1);
      commit.open();
      await Promise.all([starting, adding]);
    } finally {
      commit.open();
      await Promise.allSettled([starting, adding]);
    }
    const row = await deletedAts(kind, id, sessionId);
    expect(row?.ses).not.toBeNull();
    expect(row?.data).toBe(row?.ses);
  });

  it('hält Strom und Session KEY SHARE, parallel ensurePlannedSessions mit Aufstufung: kein 40P01, der Datensatz wird mitgelöscht', async () => {
    const { sessionId, eventId } = await seedPlanned();
    await t.handle.sql`UPDATE calendar_event SET cancelled = true WHERE id = ${eventId}`;
    const id = uuidv7();
    const handled = latch();
    const commit = latch();
    let adding: Promise<unknown> | undefined;
    let deleting: Promise<unknown> | undefined;
    try {
      adding = runOp(dataOp(kind, sessionId, id), { onHandler: handled.open, afterHandler: commit.wait });
      adding.catch(() => undefined);
      await handled.wait;
      // `ensurePlannedSessions` sperrt `FOR NO KEY UPDATE` (verträgt sich) und stuft in `softDelete` auf `FOR UPDATE` auf
      deleting = t.handle.db.transaction((tx) => ensurePlannedSessions(tx, [eventId]));
      deleting.catch(() => undefined);
      await waitForBlocked(1);
      commit.open();
      await Promise.all([adding, deleting]);
    } finally {
      commit.open();
      await Promise.allSettled([adding, deleting]);
    }
    const row = await deletedAts(kind, id, sessionId);
    expect(row?.ses).not.toBeNull();
    expect(row?.data).toBe(row?.ses);
  });

  it('Gate hält die Session FOR NO KEY UPDATE und will danach den Strom: kein 40P01', async () => {
    const s = t.handle.sql;
    const ses = await seedSession('laeuft');
    const id = uuidv7();
    const gate = await s.reserve();
    let gateError: unknown = null;
    let result: unknown = null;
    let settled = false;
    let adding: Promise<unknown> | undefined;
    try {
      await gate`BEGIN`;
      await gate`SELECT id FROM session WHERE id = ${ses} FOR NO KEY UPDATE`;
      adding = runOp(dataOp(kind, ses, id))
        .then(
          (r) => (result = r),
          (e) => (result = e),
        )
        .finally(() => (settled = true));
      // Richtig: Der Handler ist fertig. Falsch: Er hängt an der Session-Zeile, dann folgt der Stromschritt (40P01)
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
    expect(result).not.toBeInstanceOf(Error);
    expect(await s`SELECT 1 FROM ${s(TABLE[kind])} WHERE id = ${id} AND deleted_at IS NULL`).toHaveLength(1);
  });

  it('hält den Strom, parallel POST /sessions/{id}/pause: kein 40P01, beide Ergebnisse stimmen', async () => {
    const s = t.handle.sql;
    const ses = await seedSession('laeuft');
    const id = uuidv7();
    const release = latch();
    const held = latch();
    let adding: Promise<unknown> | undefined;
    let requesting: ReturnType<TestApp['request']> | undefined;
    try {
      adding = runOp(dataOp(kind, ses, id), { onStream: held.open, afterStream: release.wait });
      adding.catch(() => undefined);
      // Der Strom `session:<id>` gehört jetzt der Operation (`appendOp` ist durch, die Transaktion offen)
      await held.wait;
      requesting = t.request({ method: 'POST', url: `/api/v1/sessions/${ses}/pause` });
      requesting.catch(() => undefined);
      // Pause: Session `FOR NO KEY UPDATE`, wartet dann auf den Strom
      await waitForBlocked(1);
      release.open();
      const [, response] = await Promise.all([adding, requesting]);
      expect(response.statusCode, response.body).toBe(200);
    } finally {
      release.open();
      await Promise.allSettled([adding, requesting]);
    }
    const row = await s`SELECT state FROM session WHERE id = ${ses}`;
    expect(row[0]?.state).toBe('pausiert');
    expect(await s`SELECT 1 FROM ${s(TABLE[kind])} WHERE id = ${id} AND deleted_at IS NULL`).toHaveLength(1);
  });
});
