// Upload der gepufferten Chunks (VERTRAEGE §10.2): Reihenfolge `seq`, Wiederholung mit Backoff bis 30 s.
//
// - 200/201: Chunk aus IndexedDB löschen.
// - 409 (`chunk_conflict`), 422 (`checksum_mismatch`) und andere dauerhafte Ablehnungen (400, 404, 413, 415):
//   nie wiederholen, der Chunk wandert samt Daten in die Fehlerablage.
// - Netzfehler, 5xx, 408/429 sowie 401/403/421 (Kopplung/Host, nichts am Chunk): Wiederholung mit Backoff.
// - Danach `POST …/complete`, sobald die Aufnahme zu Ende ist und alle Chunks erledigt sind.
import { ApiErrorSchema } from '@sg/shared';
import { apiBase } from '../api.ts';
import { baseMime } from './codec.ts';
import type { ChunkRecord, RecorderStore, RecordingMeta, UploaderStatus } from './types.ts';

export const BACKOFF_START_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
/** Eine Aufnahme ohne neuen Chunk und ohne laufenden Recorder gilt danach als verwaist (Neuladen, Absturz) */
export const ABANDON_AFTER_MS = 120_000;

export interface UploaderOptions {
  store: RecorderStore;
  /** Standard: `apiBase()` */
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Zufall in `[0, 1)` für den Jitter der Wartezeit */
  random?: () => number;
  /** Wanduhr in Epochen-ms */
  now?: () => number;
  /** Läuft die Aufnahme noch in diesem Tab? Dann wird sie nie als verwaist abgeschlossen. */
  isActive?: (recordingId: string) => boolean;
  abandonAfterMs?: number;
  onChange?: (status: UploaderStatus) => void;
}

type Outcome = 'ok' | 'retry' | 'permanent';

interface Failure {
  status: number | null;
  code: string | null;
  message: string;
}

/** 5xx, Zeitüberschreitung und Zugangsprobleme betreffen nicht den Chunk selbst: später noch einmal */
function isTransient(status: number): boolean {
  return (
    status >= 500 || status === 408 || status === 429 || status === 401 || status === 403 || status === 421
  );
}

async function readFailure(res: Response): Promise<Failure> {
  let code: string | null = null;
  let message = `HTTP ${res.status}`;
  try {
    const parsed = ApiErrorSchema.safeParse(await res.json());
    if (parsed.success) {
      code = parsed.data.error.code;
      message = parsed.data.error.message;
    }
  } catch {
    // Kein JSON: nur der Status zählt
  }
  return { status: res.status, code, message };
}

export class ChunkUploader {
  private readonly store: RecorderStore;
  private readonly baseUrl: string | undefined;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly isActive: (recordingId: string) => boolean;
  private readonly abandonAfterMs: number;
  private readonly onChange: ((status: UploaderStatus) => void) | undefined;

  private running: Promise<void> | null = null;
  private disposed = false;
  private wake: (() => void) | null = null;
  private status: UploaderStatus = { pendingChunks: 0, shelvedChunks: 0, offline: false, retryInMs: null };
  /** Chunks bzw. Aufnahmen, die der Core schon einmal als unbekannt (404) gemeldet hat */
  private readonly notFound = new Set<string>();

  constructor(options: UploaderOptions) {
    this.store = options.store;
    this.baseUrl = options.baseUrl;
    this.doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.isActive = options.isActive ?? (() => false);
    this.abandonAfterMs = options.abandonAfterMs ?? ABANDON_AFTER_MS;
    this.onChange = options.onChange;
  }

  getStatus(): UploaderStatus {
    return this.status;
  }

  private url(path: string): string {
    return `${(this.baseUrl ?? apiBase()).replace(/\/+$/, '')}${path}`;
  }

  /** Startet die Schleife, falls sie nicht läuft. Läuft sie schon, sieht sie neue Chunks im nächsten Durchgang. */
  kick(): void {
    if (this.disposed || this.running) return;
    this.running = this.loop().finally(() => {
      this.running = null;
    });
  }

  /** Beendet eine Wartezeit sofort (z. B. nach dem Ereignis `online`) */
  retryNow(): void {
    this.wake?.();
    this.kick();
  }

  /** Wartet, bis die Schleife nichts mehr zu tun hat */
  async drain(): Promise<void> {
    while (this.running) await this.running;
  }

  dispose(): void {
    this.disposed = true;
    this.wake?.();
  }

  private setStatus(patch: Partial<UploaderStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onChange?.(this.status);
  }

  private async refreshCounts(): Promise<void> {
    let pending = 0;
    for (const meta of await this.store.listRecordings())
      pending += (await this.store.listChunks(meta.id)).length;
    const shelved = (await this.store.listShelf()).length;
    if (pending !== this.status.pendingChunks || shelved !== this.status.shelvedChunks) {
      this.setStatus({ pendingChunks: pending, shelvedChunks: shelved });
    }
  }

  private async loop(): Promise<void> {
    let attempt = 0;
    while (!this.disposed) {
      let result: 'idle' | 'progress' | 'retry';
      try {
        result = await this.pass();
      } catch (error) {
        // IndexedDB oder Code-Fehler: nicht abstürzen, später erneut versuchen
        console.warn('Recorder-Upload: Durchgang fehlgeschlagen', error);
        result = 'retry';
      }
      await this.refreshCounts().catch(() => undefined);
      if (result === 'idle') {
        this.setStatus({ offline: false, retryInMs: null });
        return;
      }
      if (result === 'progress') {
        attempt = 0;
        this.setStatus({ offline: false, retryInMs: null });
        continue;
      }
      attempt += 1;
      const base = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** (attempt - 1));
      const wait = Math.min(BACKOFF_MAX_MS, Math.round(base * (0.8 + 0.4 * this.random())));
      this.setStatus({ offline: true, retryInMs: wait });
      await Promise.race([
        this.sleep(wait),
        new Promise<void>((resolve) => {
          this.wake = resolve;
        }),
      ]);
      this.wake = null;
    }
  }

  private async pass(): Promise<'idle' | 'progress' | 'retry'> {
    let progress = false;
    const recordings = (await this.store.listRecordings()).sort((a, b) => a.startedMs - b.startedMs);
    for (const listed of recordings) {
      if (this.disposed) return progress ? 'progress' : 'idle';
      const outcome = await this.processRecording(listed.id);
      if (outcome === 'retry') return 'retry';
      if (outcome === 'progress') progress = true;
    }
    return progress ? 'progress' : 'idle';
  }

  private async processRecording(id: string): Promise<'idle' | 'progress' | 'retry'> {
    let meta = await this.store.getRecording(id);
    if (!meta) return 'idle';
    let progress = false;

    if (!meta.created) {
      const created = await this.tryCreate(meta);
      if (created === 'retry') return 'retry';
      if (created === 'permanent') {
        await this.shelveAll(meta, 'Die Aufnahme konnte auf dem Core nicht angelegt werden.');
        await this.store.deleteRecording(id);
        return 'progress';
      }
      meta = (await this.store.patchRecording(id, { created: true })) ?? meta;
      progress = true;
    }

    for (const chunk of await this.store.listChunks(id)) {
      const outcome = await this.uploadChunk(meta, chunk);
      if (outcome === 'retry') return 'retry';
      if (outcome === 'progress') progress = true;
    }

    // Stand neu lesen: der Recorder kann inzwischen Chunks angehängt oder `complete` gesetzt haben
    meta = await this.store.getRecording(id);
    if (!meta) return progress ? 'progress' : 'idle';
    if (!meta.complete && !this.isActive(id) && this.now() - meta.lastActivityAt > this.abandonAfterMs) {
      const patched = await this.store.patchRecording(id, {
        complete: { lastSeq: Math.max(0, meta.nextSeq - 1), durationMs: meta.recordedMs },
      });
      if (!patched) return progress ? 'progress' : 'idle';
      meta = patched;
      progress = true;
    }
    if (meta.complete && (await this.store.listChunks(id)).length === 0) {
      const outcome = await this.completeOnServer(meta, meta.complete);
      if (outcome === 'retry') return 'retry';
      return 'progress';
    }
    return progress ? 'progress' : 'idle';
  }

  /**
   * `POST /sessions/{id}/recordings`. Auch einzeln aufrufbar (Start der Aufnahme): `ok` heißt angelegt,
   * `retry` Core nicht erreichbar, `permanent` abgelehnt (Session läuft nicht oder ist unbekannt).
   */
  async tryCreate(meta: RecordingMeta): Promise<Outcome> {
    let res: Response;
    try {
      res = await this.doFetch(this.url(`/sessions/${meta.sessionId}/recordings`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: meta.id,
          mime: meta.mime,
          codec: meta.codec,
          started_ms: meta.startedMs,
          chunks_independent: meta.chunksIndependent,
        }),
      });
    } catch {
      return 'retry';
    }
    if (res.ok) return 'ok';
    const failure = await readFailure(res);
    // Schon angelegt (z. B. Antwort ging verloren): gilt als angelegt
    if (res.status === 409 && failure.code === 'recording_exists') return 'ok';
    if (isTransient(res.status)) return 'retry';
    console.warn(`Recorder-Upload: Aufnahme abgelehnt (${failure.code ?? res.status}): ${failure.message}`);
    return 'permanent';
  }

  private async uploadChunk(meta: RecordingMeta, chunk: ChunkRecord): Promise<'progress' | 'retry'> {
    let res: Response;
    try {
      res = await this.doFetch(this.url(`/recordings/${chunk.recordingId}/chunks/${chunk.seq}`), {
        method: 'PUT',
        headers: {
          'Content-Type': baseMime(meta.mime),
          'X-Start-Ms': String(chunk.startMs),
          'X-Duration-Ms': String(chunk.durationMs),
          'X-Sha256': chunk.sha256,
        },
        body: chunk.data,
      });
    } catch {
      await this.store.putChunk({ ...chunk, attempts: chunk.attempts + 1 }).catch(() => undefined);
      return 'retry';
    }
    if (res.ok) {
      await this.store.deleteChunk(chunk.recordingId, chunk.seq);
      return 'progress';
    }
    const failure = await readFailure(res);
    if (isTransient(res.status)) {
      await this.store.putChunk({ ...chunk, attempts: chunk.attempts + 1 }).catch(() => undefined);
      return 'retry';
    }
    if (res.status === 404 && failure.code === 'recording_not_found') {
      // Der Core kennt die Aufnahme nicht (z. B. neue Datenbank): einmal neu anlegen, danach ablegen
      const key = `${chunk.recordingId}:${chunk.seq}`;
      if (!this.notFound.has(key)) {
        this.notFound.add(key);
        await this.store.patchRecording(chunk.recordingId, { created: false });
        return 'progress';
      }
    }
    await this.store.shelveChunk({
      recordingId: chunk.recordingId,
      seq: chunk.seq,
      startMs: chunk.startMs,
      durationMs: chunk.durationMs,
      sha256: chunk.sha256,
      data: chunk.data,
      status: failure.status,
      code: failure.code,
      message: failure.message,
      shelvedAt: this.now(),
    });
    return 'progress';
  }

  private async shelveAll(meta: RecordingMeta, message: string): Promise<void> {
    for (const chunk of await this.store.listChunks(meta.id)) {
      await this.store.shelveChunk({
        recordingId: chunk.recordingId,
        seq: chunk.seq,
        startMs: chunk.startMs,
        durationMs: chunk.durationMs,
        sha256: chunk.sha256,
        data: chunk.data,
        status: null,
        code: 'recording_rejected',
        message,
        shelvedAt: this.now(),
      });
    }
  }

  private async completeOnServer(
    meta: RecordingMeta,
    complete: { lastSeq: number; durationMs: number },
  ): Promise<'ok' | 'retry'> {
    // Aufnahme ohne einen einzigen Chunk, die der Core nie sah: nichts abzuschließen
    if (!meta.created) {
      await this.store.deleteRecording(meta.id);
      return 'ok';
    }
    let res: Response;
    try {
      res = await this.doFetch(this.url(`/recordings/${meta.id}/complete`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_seq: complete.lastSeq, duration_ms: Math.round(complete.durationMs) }),
      });
    } catch {
      return 'retry';
    }
    if (res.ok) {
      await this.store.deleteRecording(meta.id);
      return 'ok';
    }
    const failure = await readFailure(res);
    if (isTransient(res.status)) return 'retry';
    if (res.status === 409 && failure.code === 'recording_seq_conflict') {
      // Der Core hat eine höhere seq: mit dem Stand des Core noch einmal abschließen
      const serverLast = await this.fetchServerLastSeq(meta.id);
      if (serverLast !== null && serverLast > complete.lastSeq) {
        await this.store.patchRecording(meta.id, { complete: { ...complete, lastSeq: serverLast } });
        return 'ok';
      }
    }
    if (res.status === 404 && failure.code === 'recording_not_found' && !this.notFound.has(meta.id)) {
      this.notFound.add(meta.id);
      await this.store.patchRecording(meta.id, { created: false });
      return 'ok';
    }
    console.warn(`Recorder-Upload: Abschluss abgelehnt (${failure.code ?? res.status}): ${failure.message}`);
    // Dauerhaft abgelehnt: nicht endlos wiederholen. Die Chunks sind beim Core, die Aufnahme bleibt dort offen.
    await this.store.deleteRecording(meta.id);
    return 'ok';
  }

  private async fetchServerLastSeq(id: string): Promise<number | null> {
    try {
      const res = await this.doFetch(this.url(`/recordings/${id}`), {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { last_seq?: unknown };
      return typeof body.last_seq === 'number' ? body.last_seq : null;
    } catch {
      return null;
    }
  }
}
