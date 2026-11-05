// Restfenster beim Leader-Wechsel (Issue #64, Punkt 3; VERTRAEGE §11.8):
// Der alte Leader hat ein `append` gestartet, bevor er den Verlust der Rolle bemerkt. Der neue Leader liest die
// Warteschlange womöglich vorher. Entscheidung: Der alte Tab meldet das beendete `append` über den BroadcastChannel
// (`enqueued`), der Leader liest nach und sendet die Operation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncClient, SyncHandedOverError } from '../src/lib/sync/client.ts';
import { MemoryQueueStore, type QueueStore } from '../src/lib/sync/store.ts';
import type { LeaderLock, LeaderLockHandlers } from '../src/lib/sync/tabs.ts';
import type { SendOpInput } from '../src/lib/sync/types.ts';
import { FakeServer, nbStream, uid } from './sync-fake-server.ts';

const settle = async () => {
  for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(0);
};

const notebookCreate = (n: number, id: string): SendOpInput =>
  ({
    op_id: id,
    stream: nbStream(n),
    kind: 'notebook.create',
    data: { notebook_id: uid(n), module_id: uid(10), title: 'T', kind: 'frei', created_at: 1 },
  }) as SendOpInput;

/** Store mit anhaltbaren `append`/`list`, um die Reihenfolge der Tabs gezielt herzustellen. */
class GatedStore implements QueueStore {
  gateAppend: Promise<void> | null = null;
  gateList: Promise<void> | null = null;
  gateRemove: Promise<void> | null = null;
  private readonly inner: QueueStore;
  constructor(inner: QueueStore) {
    this.inner = inner;
  }
  async append(op: Parameters<QueueStore['append']>[0]) {
    await this.gateAppend;
    return this.inner.append(op);
  }
  async list() {
    const result = await this.inner.list(); // Lesestand wird VOR dem Anhalten festgelegt
    await this.gateList;
    return result;
  }
  putMany = (e: Parameters<QueueStore['putMany']>[0]) => this.inner.putMany(e);
  async removeMany(k: number[]) {
    await this.gateRemove;
    return this.inner.removeMany(k);
  }
  shelve = (k: number[], e: Parameters<QueueStore['shelve']>[1]) => this.inner.shelve(k, e);
  listShelf = () => this.inner.listShelf();
  getMeta = (n: string) => this.inner.getMeta(n);
  setMeta = (n: string, v: string) => this.inner.setMeta(n, v);
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    open = r;
  });
  return { promise, open };
}

class Locks {
  holder: Lock | null = null;
  create = (): LeaderLock => new Lock(this);
}
class Lock implements LeaderLock {
  handlers: LeaderLockHandlers | null = null;
  private readonly owner: Locks;
  constructor(owner: Locks) {
    this.owner = owner;
  }
  start(h: LeaderLockHandlers): void {
    this.handlers = h;
    if (!this.owner.holder) {
      this.owner.holder = this;
      h.onLeader();
    } else h.onOtherTab();
  }
  steal(): void {
    const old = this.owner.holder;
    this.owner.holder = this;
    old?.handlers?.onLost();
    this.handlers?.onLeader();
  }
  /** Wie der BroadcastChannel: erreicht nur den Halter des Locks, nicht den Absender */
  notifyEnqueued(): void {
    const h = this.owner.holder;
    if (h && h !== this) h.handlers?.onEnqueued?.();
  }
  stop(): void {
    if (this.owner.holder === this) this.owner.holder = null;
  }
}

let server: FakeServer;
let clients: SyncClient[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_762_240_000_000);
  server = new FakeServer();
  clients = [];
});
afterEach(() => {
  for (const c of clients) c.disconnect();
  vi.useRealTimers();
});

function tab(locks: Locks, store: QueueStore): SyncClient {
  const c = new SyncClient({
    url: 'ws://test/sync',
    store,
    webSocketFactory: server.factory,
    random: () => 0,
    leaderLock: locks.create,
  });
  clients.push(c);
  return c;
}

describe('Restfenster beim Leader-Wechsel', () => {
  it('der neue Leader hat die Warteschlange schon gelesen: die späte Operation des alten Leaders geht trotzdem raus', async () => {
    const shared = new MemoryQueueStore();
    const storeA = new GatedStore(shared);
    const locks = new Locks();
    const a = tab(locks, storeA);
    const b = tab(locks, shared);
    await a.connect();
    await b.connect();
    await settle();

    const g = gate();
    storeA.gateAppend = g.promise; // a hat send() gestartet, das append hängt noch
    const pa = a.send(notebookCreate(1, uid(900))).catch((e: unknown) => e);
    await settle();

    b.takeOver(); // b liest eine leere Warteschlange
    await settle();
    expect(b.leader).toBe(true);
    expect(b.pendingCount).toBe(0);

    g.open(); // jetzt landet die Operation in der IDB, nachdem b gelesen hat
    await settle();
    expect(await pa).toBeInstanceOf(SyncHandedOverError);
    expect(server.opLog).toEqual([uid(900)]);
    expect(b.pendingCount).toBe(0); // bestätigt und entfernt
    expect(await shared.list()).toHaveLength(0);
  });

  it('die Meldung kommt, während der neue Leader noch liest: er liest nach, sobald er Leader ist', async () => {
    const shared = new MemoryQueueStore();
    const storeA = new GatedStore(shared);
    const storeB = new GatedStore(shared);
    const locks = new Locks();
    const a = tab(locks, storeA);
    const b = tab(locks, storeB);
    await a.connect();
    await b.connect();
    await settle();

    const gA = gate();
    const gB = gate();
    storeA.gateAppend = gA.promise;
    const pa = a.send(notebookCreate(1, uid(901))).catch((e: unknown) => e);
    await settle();

    storeB.gateList = gB.promise; // b liest (leer) und hängt dann
    b.takeOver();
    await settle();
    expect(b.leader).toBe(false); // noch nicht fertig mit Lesen

    gA.open(); // append fertig, Meldung geht raus, b ist noch nicht Leader
    await settle();
    gB.open();
    await settle();
    expect(b.leader).toBe(true);
    expect(await pa).toBeInstanceOf(SyncHandedOverError);
    expect(server.opLog).toEqual([uid(901)]);
  });

  it('keine Doppelsendung: eine Operation, die der neue Leader schon kennt, wird nicht ein zweites Mal gesendet', async () => {
    const shared = new MemoryQueueStore();
    const storeA = new GatedStore(shared);
    const locks = new Locks();
    const a = tab(locks, storeA);
    const b = tab(locks, shared);
    await a.connect();
    await b.connect();
    await settle();

    server.decide = () => ({ ignore: true }); // nichts wird bestätigt, die Operation bleibt in der Warteschlange
    const pa = a.send(notebookCreate(1, uid(902))).catch((e: unknown) => e);
    await settle();
    b.takeOver(); // b liest uid(902) aus dem Speicher und sendet sie
    await settle();
    expect(server.opLog).toEqual([uid(902), uid(902)]); // a hat sie gesendet, b sendet sie erneut (Idempotenz über op_id)
    locks.holder?.handlers?.onEnqueued?.(); // Meldung erreicht den Leader (Duplikat)
    await settle();
    expect(server.opLog).toEqual([uid(902), uid(902)]);
    expect(b.pendingCount).toBe(1);
    await pa;
  });

  it('bestätigte Operation, deren Entfernen aus dem Speicher noch läuft: send() meldet den ack, nicht SyncNotLeaderError', async () => {
    const shared = new MemoryQueueStore();
    const storeA = new GatedStore(shared);
    const locks = new Locks();
    const a = tab(locks, storeA);
    const b = tab(locks, shared);
    await a.connect();
    await b.connect();
    await settle();

    const g = gate();
    storeA.gateRemove = g.promise; // ack ist da, removeMany hängt
    const pa = a.send(notebookCreate(1, uid(903))).then(
      () => 'ack',
      (e: unknown) => (e as Error).name,
    );
    await settle();
    expect(server.opLog).toEqual([uid(903)]);
    b.takeOver();
    await settle();
    expect(await pa).toBe('ack'); // nicht SyncNotLeaderError: Fachcode würde sonst eine bestätigte Operation neu senden
    g.open();
    await settle();
  });
});
