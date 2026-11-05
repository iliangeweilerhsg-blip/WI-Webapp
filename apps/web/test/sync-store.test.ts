// Vertrag des QueueStore: derselbe Satz Tests gegen Memory und gegen IndexedDB (fake-indexeddb, je Test eine frische Fabrik).
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
contract('IndexedDB (fake-indexeddb)', () => new IndexedDbQueueStore('sg-sync-test', new IDBFactory()));

describe('IndexedDbQueueStore: Besonderheiten von IndexedDB', () => {
  afterEach(() => vi.restoreAllMocks());

  it('übersteht eine neue Instanz (Neuladen): Warteschlange, Zähler, Ablage und Meta bleiben', async () => {
    const factory = new IDBFactory();
    const a = new IndexedDbQueueStore('p', factory);
    const e1 = await a.append(op(1));
    const e2 = await a.append(op(2));
    await a.putMany([{ ...e2, failures: 4, sent: true }]);
    await a.shelve(
      [e1.key],
      [{ shelvedAt: 7, op: e1.op, reason: { kind: 'rejected', code: 'c', message: 'm', causedBy: null } }],
    );
    await a.setMeta('db_epoch', 'E');
    await a.close();

    const b = new IndexedDbQueueStore('p', factory);
    expect(await b.list()).toMatchObject([{ key: e2.key, failures: 4, sent: true, op: { op_id: uid(2) } }]);
    expect(await b.listShelf()).toMatchObject([{ id: 1, shelvedAt: 7, op: { op_id: uid(1) } }]);
    expect(await b.getMeta('db_epoch')).toBe('E');
    // Schlüssel laufen über Instanzen hinweg weiter und werden nicht wiederverwendet
    expect((await b.append(op(3))).key).toBeGreaterThan(e2.key);
  });

  it('zwei Instanzen derselben Datenbank (zwei Tabs) sehen die Einträge des anderen', async () => {
    const factory = new IDBFactory();
    const a = new IndexedDbQueueStore('p', factory);
    const b = new IndexedDbQueueStore('p', factory);
    await a.append(op(1));
    await b.append(op(2));
    expect((await a.list()).map((e) => e.op.op_id)).toEqual([uid(1), uid(2)]);
  });

  it('onversionchange: gibt die Verbindung frei, ein deleteDatabase eines anderen Tabs wird nicht blockiert', async () => {
    const factory = new IDBFactory();
    const s = new IndexedDbQueueStore('p', factory);
    await s.append(op(1));
    await new Promise<void>((resolve, reject) => {
      const del = factory.deleteDatabase('p');
      del.onblocked = () => reject(new Error('deleteDatabase wurde blockiert'));
      del.onsuccess = () => resolve();
      del.onerror = () => reject(del.error);
    });
    // Beim nächsten Zugriff öffnet der Store neu (leere Datenbank), statt an der toten Verbindung zu scheitern
    expect(await s.list()).toEqual([]);
    expect((await s.append(op(2))).key).toBe(1);
  });

  it('onversionchange: ein Versions-Upgrade eines anderen Tabs läuft durch; der Store scheitert dann sauber und erholt sich nicht still', async () => {
    const factory = new IDBFactory();
    const s = new IndexedDbQueueStore('p', factory);
    await s.append(op(1));
    const blocked = vi.fn();
    await new Promise<void>((resolve, reject) => {
      const up = factory.open('p', 2);
      up.onblocked = blocked;
      up.onsuccess = () => {
        up.result.close();
        resolve();
      };
      up.onerror = () => reject(up.error);
    });
    expect(blocked).not.toHaveBeenCalled();
    // Die Datenbank ist jetzt neuer als der Store (Version 1): VersionError, aber nicht dauerhaft zwischengespeichert
    await expect(s.list()).rejects.toMatchObject({ name: 'VersionError' });
    const s2 = new IndexedDbQueueStore('p', factory, 2);
    expect((await s2.list()).map((e) => e.op.op_id)).toEqual([uid(1)]);
  });

  it('onblocked: wartet auf den Tab mit der alten Version, warnt und läuft nach dessen Schließen weiter', async () => {
    const factory = new IDBFactory();
    // Alter Tab: hält Version 1 offen und gibt bei versionchange nicht frei
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open('p', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('queue', { keyPath: 'key', autoIncrement: true });
        req.result.createObjectStore('shelf', { keyPath: 'id', autoIncrement: true });
        req.result.createObjectStore('meta', { keyPath: 'name' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = new IndexedDbQueueStore('p', factory, 2);
    let settled = false;
    const pending = s.append(op(1)).then((e) => {
      settled = true;
      return e;
    });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('blockiert')));
    expect(settled).toBe(false);
    old.close();
    expect((await pending).op.op_id).toBe(uid(1));
    expect(await s.list()).toHaveLength(1);
  });

  it('close() gibt die Verbindung frei; danach öffnet der nächste Zugriff neu', async () => {
    const s = new IndexedDbQueueStore('p', new IDBFactory());
    await s.append(op(1));
    await s.close();
    await s.close(); // doppelt ist harmlos
    expect(await s.list()).toHaveLength(1);
  });
});

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
