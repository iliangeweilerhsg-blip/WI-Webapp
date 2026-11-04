// Speicher der Ausgangswarteschlange und der Fehlerablage (VERTRAEGE §11.2).
// Hinter einem kleinen Interface, damit Tests ohne IndexedDB laufen (MemoryQueueStore).
import type { NewShelfEntry, QueuedOp, QueueEntry, ShelfEntry } from './types.ts';

export interface QueueStore {
  /** Hängt eine Operation an (append-only). Der Schlüssel steigt streng und wird nie wiederverwendet. */
  append(op: QueuedOp): Promise<QueueEntry>;
  /** Alle unbestätigten Operationen in Entstehungsreihenfolge. */
  list(): Promise<QueueEntry[]>;
  /** Überschreibt vorhandene Einträge (gleicher `key`): Umschreiben, Zähler. Unbekannte Schlüssel werden ignoriert. */
  putMany(entries: QueueEntry[]): Promise<void>;
  /** Entfernt bestätigte Operationen. */
  removeMany(keys: number[]): Promise<void>;
  /** Verschiebt Einträge in einem Schritt in die Fehlerablage (Entfernen und Ablegen gemeinsam). */
  shelve(keys: number[], entries: NewShelfEntry[]): Promise<void>;
  listShelf(): Promise<ShelfEntry[]>;
  getMeta(name: string): Promise<string | null>;
  setMeta(name: string, value: string): Promise<void>;
}

/** Arbeitsspeicher-Implementierung für Tests und als Rückfall, wenn IndexedDB fehlt. */
export class MemoryQueueStore implements QueueStore {
  private nextKey = 1;
  private nextShelfId = 1;
  private queue = new Map<number, QueueEntry>();
  private shelf: ShelfEntry[] = [];
  private meta = new Map<string, string>();

  async append(op: QueuedOp): Promise<QueueEntry> {
    const entry: QueueEntry = {
      key: this.nextKey++,
      op: structuredClone(op),
      failures: 0,
      conflicts: 0,
      sent: false,
    };
    this.queue.set(entry.key, entry);
    return structuredClone(entry);
  }

  async list(): Promise<QueueEntry[]> {
    return [...this.queue.values()].sort((a, b) => a.key - b.key).map((e) => structuredClone(e));
  }

  async putMany(entries: QueueEntry[]): Promise<void> {
    for (const e of entries) if (this.queue.has(e.key)) this.queue.set(e.key, structuredClone(e));
  }

  async removeMany(keys: number[]): Promise<void> {
    for (const k of keys) this.queue.delete(k);
  }

  async shelve(keys: number[], entries: NewShelfEntry[]): Promise<void> {
    for (const e of entries) this.shelf.push({ ...structuredClone(e), id: this.nextShelfId++ });
    for (const k of keys) this.queue.delete(k);
  }

  async listShelf(): Promise<ShelfEntry[]> {
    return this.shelf.map((e) => structuredClone(e));
  }

  async getMeta(name: string): Promise<string | null> {
    return this.meta.get(name) ?? null;
  }

  async setMeta(name: string, value: string): Promise<void> {
    this.meta.set(name, value);
  }
}

const DB_VERSION = 1;

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB-Fehler'));
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB-Transaktion fehlgeschlagen'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB-Transaktion abgebrochen'));
  });
}

/**
 * IndexedDB-Implementierung: übersteht ein Neuladen der Seite. Stores: `queue` (autoIncrement-Schlüssel = Reihenfolge),
 * `shelf` (Fehlerablage, nie automatisch geleert) und `meta` (z. B. `db_epoch`).
 */
export class IndexedDbQueueStore implements QueueStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private readonly name: string;
  private readonly factory: IDBFactory;

  constructor(name = 'sg-sync', factory: IDBFactory = globalThis.indexedDB) {
    this.name = name;
    this.factory = factory;
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = this.factory.open(this.name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('queue', { keyPath: 'key', autoIncrement: true });
        db.createObjectStore('shelf', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('meta', { keyPath: 'name' });
      };
      req.onblocked = () => {
        // Ein anderer Tab hält eine ältere Version offen; die Anfrage wartet, bis er schließt
        console.warn('Sync: IndexedDB-Upgrade blockiert, ein anderer Tab hält die Datenbank offen');
      };
      req.onsuccess = () => {
        const db = req.result;
        // Anderer Tab will aktualisieren oder löschen: Verbindung freigeben, beim nächsten Zugriff neu öffnen
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        db.onclose = () => {
          this.dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB lässt sich nicht öffnen'));
    });
    return this.dbPromise;
  }

  /** Schließt die Datenbank (Tests, Neuladen). */
  async close(): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    db.close();
    this.dbPromise = null;
  }

  async append(op: QueuedOp): Promise<QueueEntry> {
    const db = await this.db();
    const tx = db.transaction('queue', 'readwrite');
    const entry = { op, failures: 0, conflicts: 0, sent: false };
    const key = await done(tx.objectStore('queue').add(entry));
    await finished(tx);
    return { key: key as number, op: structuredClone(op), failures: 0, conflicts: 0, sent: false };
  }

  async list(): Promise<QueueEntry[]> {
    const db = await this.db();
    const tx = db.transaction('queue', 'readonly');
    const all = (await done(tx.objectStore('queue').getAll())) as QueueEntry[];
    return all.sort((a, b) => a.key - b.key);
  }

  async putMany(entries: QueueEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const db = await this.db();
    const tx = db.transaction('queue', 'readwrite');
    const store = tx.objectStore('queue');
    for (const e of entries) {
      const probe = store.getKey(e.key);
      probe.onsuccess = () => {
        if (probe.result !== undefined) store.put(e);
      };
    }
    await finished(tx);
  }

  async removeMany(keys: number[]): Promise<void> {
    if (keys.length === 0) return;
    const db = await this.db();
    const tx = db.transaction('queue', 'readwrite');
    for (const k of keys) tx.objectStore('queue').delete(k);
    await finished(tx);
  }

  async shelve(keys: number[], entries: NewShelfEntry[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['queue', 'shelf'], 'readwrite');
    for (const e of entries) tx.objectStore('shelf').add(e);
    for (const k of keys) tx.objectStore('queue').delete(k);
    await finished(tx);
  }

  async listShelf(): Promise<ShelfEntry[]> {
    const db = await this.db();
    const tx = db.transaction('shelf', 'readonly');
    const all = (await done(tx.objectStore('shelf').getAll())) as ShelfEntry[];
    return all.sort((a, b) => a.id - b.id);
  }

  async getMeta(name: string): Promise<string | null> {
    const db = await this.db();
    const tx = db.transaction('meta', 'readonly');
    const row = (await done(tx.objectStore('meta').get(name))) as { name: string; value: string } | undefined;
    return row?.value ?? null;
  }

  async setMeta(name: string, value: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ name, value });
    await finished(tx);
  }
}

/** IndexedDB, wenn vorhanden, sonst Arbeitsspeicher (Warteschlange übersteht dann kein Neuladen). */
export function createDefaultStore(): QueueStore {
  try {
    if (typeof indexedDB !== 'undefined') return new IndexedDbQueueStore();
  } catch {
    // IndexedDB gesperrt (z. B. privates Fenster) – Rückfall
  }
  return new MemoryQueueStore();
}
