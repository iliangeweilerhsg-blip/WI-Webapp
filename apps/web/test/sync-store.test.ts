// Vertrag des QueueStore: läuft gegen Memory immer, gegen IndexedDB nur, wenn indexedDB vorhanden ist.
// OFFEN: IndexedDB-Implementierung mit fake-indexeddb testen, sobald T1-DB gemergt ist.
import { describe, expect, it } from 'vitest';
import { IndexedDbQueueStore, MemoryQueueStore, type QueueStore } from '../src/lib/sync/store.ts';
import type { QueuedOp } from '../src/lib/sync/types.ts';
import { dependentsOf, correctClock, rewriteSessionId } from '../src/lib/sync/ops.ts';
import { nbStream, sessStream, uid } from './sync-fake-server.ts';

const op = (n: number): QueuedOp =>
  ({
    type: 'op',
    op_id: uid(n),
    stream: nbStream(n),
    kind: 'notebook.create',
    at: 1,
    clock_uncertain: false,
    data: { notebook_id: uid(n), module_id: uid(10), title: 'x', kind: 'frei', created_at: 1 },
  }) as QueuedOp;

function contract(name: string, create: () => QueueStore) {
  describe(`QueueStore: ${name}`, () => {
    it('hält Reihenfolge, entfernt, überschreibt und legt ab', async () => {
      const s = create();
      const a = await s.append(op(1));
      const b = await s.append(op(2));
      const c = await s.append(op(3));
      expect(b.key).toBeGreaterThan(a.key);
      await s.removeMany([a.key]);
      expect((await s.list()).map((e) => e.op.op_id)).toEqual([uid(2), uid(3)]);
      await s.putMany([
        { ...b, failures: 3 },
        { ...a, failures: 9 },
      ]);
      const list = await s.list();
      expect(list).toHaveLength(2);
      expect(list[0]!.failures).toBe(3);
      await s.shelve(
        [c.key],
        [{ shelvedAt: 5, op: c.op, reason: { kind: 'rejected', code: 'x', message: 'm', causedBy: null } }],
      );
      expect((await s.list()).map((e) => e.key)).toEqual([b.key]);
      expect(await s.listShelf()).toMatchObject([{ shelvedAt: 5, op: { op_id: uid(3) } }]);
      const d = await s.append(op(4));
      expect(d.key).toBeGreaterThan(c.key); // Schlüssel werden nicht wiederverwendet
    });

    it('speichert Meta-Werte', async () => {
      const s = create();
      expect(await s.getMeta('db_epoch')).toBeNull();
      await s.setMeta('db_epoch', 'e1');
      expect(await s.getMeta('db_epoch')).toBe('e1');
    });
  });
}

contract('Memory', () => new MemoryQueueStore());
if (typeof indexedDB !== 'undefined') {
  let i = 0;
  contract('IndexedDB', () => new IndexedDbQueueStore(`sg-sync-test-${i++}`));
}

describe('Operations-Hilfen', () => {
  it('findet abhängige Operationen transitiv', () => {
    const nb = op(1);
    const page = {
      ...op(2),
      stream: nbStream(1),
      kind: 'page.create',
      data: { page_id: uid(50), notebook_id: uid(1) },
    } as unknown as QueuedOp;
    const stroke = {
      ...op(3),
      stream: nbStream(1),
      kind: 'stroke.remove',
      data: { page_id: uid(50), client_ids: [uid(60)] },
    } as unknown as QueuedOp;
    const other = op(4);
    const deps = dependentsOf(
      nb,
      [page, stroke, other].map((o) => ({ op: o })),
    );
    expect(deps.map((d) => d.op.op_id)).toEqual([page.op_id, stroke.op_id]);
  });

  it('schreibt Session-IDs in Strom und Daten um', () => {
    const start = {
      type: 'op',
      op_id: uid(1),
      stream: sessStream(30),
      kind: 'page.create',
      at: 1,
      clock_uncertain: false,
      data: { page_id: uid(50), session_id: uid(30) },
    } as unknown as QueuedOp;
    const out = rewriteSessionId(start, uid(30), uid(31));
    expect(out.stream).toBe(sessStream(31));
    expect(JSON.stringify(out.data)).not.toContain(uid(30));
  });

  it('korrigiert t_ms nur für fremde Sessions', () => {
    const marker = {
      type: 'op',
      op_id: uid(1),
      stream: sessStream(30),
      kind: 'slide.change',
      at: 100,
      clock_uncertain: true,
      data: { session_id: uid(30), t_ms: 50 },
    } as unknown as QueuedOp;
    expect(correctClock(marker, 10, () => false)).toMatchObject({
      at: 110,
      clock_uncertain: false,
      data: { t_ms: 50 },
    });
    expect(correctClock(marker, 10, () => true)).toMatchObject({ data: { t_ms: 60 } });
  });
});
