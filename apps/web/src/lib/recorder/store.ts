// Puffer der Aufnahme in IndexedDB (VERTRAEGE §10.2, F-AUD-01): Chunks überstehen Neuladen und Core-Ausfall.
// Hinter einem kleinen Interface, damit Tests und Umgebungen ohne IndexedDB mit Arbeitsspeicher laufen.
import type { ChunkRecord, RecorderStore, RecordingMeta, ShelfRecord } from './types.ts';

/** Arbeitsspeicher-Implementierung (Tests, Rückfall ohne IndexedDB). Überlebt kein Neuladen. */
export class MemoryRecorderStore implements RecorderStore {
  private recordings = new Map<string, RecordingMeta>();
  private chunks = new Map<string, ChunkRecord>();
  private shelf: ShelfRecord[] = [];
  private nextShelfId = 1;

  private key(recordingId: string, seq: number): string {
    return `${recordingId}:${seq}`;
  }

  async putRecording(meta: RecordingMeta): Promise<void> {
    this.recordings.set(meta.id, structuredClone(meta));
  }
  async getRecording(id: string): Promise<RecordingMeta | null> {
    const meta = this.recordings.get(id);
    return meta ? structuredClone(meta) : null;
  }
  async listRecordings(): Promise<RecordingMeta[]> {
    return [...this.recordings.values()].map((m) => structuredClone(m));
  }
  async deleteRecording(id: string): Promise<void> {
    this.recordings.delete(id);
    for (const [key, chunk] of this.chunks) if (chunk.recordingId === id) this.chunks.delete(key);
  }
  async patchRecording(id: string, patch: Partial<Omit<RecordingMeta, 'id'>>): Promise<RecordingMeta | null> {
    const current = this.recordings.get(id);
    if (!current) return null;
    const next = { ...current, ...structuredClone(patch) };
    this.recordings.set(id, next);
    return structuredClone(next);
  }
  async addChunk(
    chunk: ChunkRecord,
    patch: Partial<Omit<RecordingMeta, 'id'>>,
  ): Promise<RecordingMeta | null> {
    if (!this.recordings.has(chunk.recordingId)) return null;
    this.chunks.set(this.key(chunk.recordingId, chunk.seq), structuredClone(chunk));
    return this.patchRecording(chunk.recordingId, patch);
  }
  async listChunks(recordingId: string): Promise<ChunkRecord[]> {
    return [...this.chunks.values()]
      .filter((c) => c.recordingId === recordingId)
      .sort((a, b) => a.seq - b.seq)
      .map((c) => structuredClone(c));
  }
  async putChunk(chunk: ChunkRecord): Promise<void> {
    this.chunks.set(this.key(chunk.recordingId, chunk.seq), structuredClone(chunk));
  }
  async deleteChunk(recordingId: string, seq: number): Promise<void> {
    this.chunks.delete(this.key(recordingId, seq));
  }
  async shelveChunk(entry: ShelfRecord): Promise<void> {
    this.shelf.push({ ...structuredClone(entry), id: this.nextShelfId++ });
    this.chunks.delete(this.key(entry.recordingId, entry.seq));
  }
  async listShelf(): Promise<ShelfRecord[]> {
    return this.shelf.map((e) => structuredClone(e));
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
 * IndexedDB-Implementierung. Stores: `recordings` (Schlüssel `id`), `chunks` (Schlüssel `[recordingId, seq]`)
 * und `shelf` (Fehlerablage, nie automatisch geleert).
 */
export class IndexedDbRecorderStore implements RecorderStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly name: string;
  private readonly factory: IDBFactory;

  constructor(name = 'sg-recorder', factory: IDBFactory = globalThis.indexedDB) {
    this.name = name;
    this.factory = factory;
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = this.factory.open(this.name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('recordings', { keyPath: 'id' });
        db.createObjectStore('chunks', { keyPath: ['recordingId', 'seq'] });
        db.createObjectStore('shelf', { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        db.onclose = () => {
          this.dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        this.dbPromise = null;
        reject(req.error ?? new Error('IndexedDB lässt sich nicht öffnen'));
      };
    });
    return this.dbPromise;
  }

  /** Schließt die Datenbank (Tests, Neuladen) */
  async close(): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    db.close();
    this.dbPromise = null;
  }

  async putRecording(meta: RecordingMeta): Promise<void> {
    const tx = (await this.db()).transaction('recordings', 'readwrite');
    tx.objectStore('recordings').put(meta);
    await finished(tx);
  }

  async getRecording(id: string): Promise<RecordingMeta | null> {
    const tx = (await this.db()).transaction('recordings', 'readonly');
    return ((await done(tx.objectStore('recordings').get(id))) as RecordingMeta | undefined) ?? null;
  }

  async listRecordings(): Promise<RecordingMeta[]> {
    const tx = (await this.db()).transaction('recordings', 'readonly');
    return (await done(tx.objectStore('recordings').getAll())) as RecordingMeta[];
  }

  async deleteRecording(id: string): Promise<void> {
    const tx = (await this.db()).transaction(['recordings', 'chunks'], 'readwrite');
    tx.objectStore('recordings').delete(id);
    tx.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    await finished(tx);
  }

  private async patchInTx(
    chunk: ChunkRecord | null,
    id: string,
    patch: Partial<Omit<RecordingMeta, 'id'>>,
  ): Promise<RecordingMeta | null> {
    const tx = (await this.db()).transaction(['recordings', 'chunks'], 'readwrite');
    const recordings = tx.objectStore('recordings');
    const current = (await done(recordings.get(id))) as RecordingMeta | undefined;
    let next: RecordingMeta | null = null;
    if (current) {
      next = { ...current, ...patch };
      recordings.put(next);
      if (chunk) tx.objectStore('chunks').put(chunk);
    }
    await finished(tx);
    return next;
  }

  patchRecording(id: string, patch: Partial<Omit<RecordingMeta, 'id'>>): Promise<RecordingMeta | null> {
    return this.patchInTx(null, id, patch);
  }

  addChunk(chunk: ChunkRecord, patch: Partial<Omit<RecordingMeta, 'id'>>): Promise<RecordingMeta | null> {
    return this.patchInTx(chunk, chunk.recordingId, patch);
  }

  async listChunks(recordingId: string): Promise<ChunkRecord[]> {
    const tx = (await this.db()).transaction('chunks', 'readonly');
    const range = IDBKeyRange.bound([recordingId, 0], [recordingId, Number.MAX_SAFE_INTEGER]);
    return (await done(tx.objectStore('chunks').getAll(range))) as ChunkRecord[];
  }

  async putChunk(chunk: ChunkRecord): Promise<void> {
    const tx = (await this.db()).transaction('chunks', 'readwrite');
    tx.objectStore('chunks').put(chunk);
    await finished(tx);
  }

  async deleteChunk(recordingId: string, seq: number): Promise<void> {
    const tx = (await this.db()).transaction('chunks', 'readwrite');
    tx.objectStore('chunks').delete([recordingId, seq]);
    await finished(tx);
  }

  async shelveChunk(entry: ShelfRecord): Promise<void> {
    const tx = (await this.db()).transaction(['chunks', 'shelf'], 'readwrite');
    const { id: _ignored, ...row } = entry;
    tx.objectStore('shelf').add(row);
    tx.objectStore('chunks').delete([entry.recordingId, entry.seq]);
    await finished(tx);
  }

  async listShelf(): Promise<ShelfRecord[]> {
    const tx = (await this.db()).transaction('shelf', 'readonly');
    return (await done(tx.objectStore('shelf').getAll())) as ShelfRecord[];
  }
}

/** IndexedDB, wenn vorhanden und benutzbar, sonst Arbeitsspeicher */
export function createDefaultRecorderStore(): RecorderStore {
  try {
    if (typeof indexedDB !== 'undefined') return new IndexedDbRecorderStore();
  } catch {
    // Zugriff verweigert (z. B. blockierte Website-Daten): Rückfall
  }
  return new MemoryRecorderStore();
}
