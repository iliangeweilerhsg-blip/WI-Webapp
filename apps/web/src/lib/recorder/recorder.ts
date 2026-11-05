// Browser-Recorder (VERTRAEGE §10, Spike S4 Variante A): ein MediaRecorder mit `timeslice` je Aufnahme,
// Chunks in IndexedDB puffern, hochladen mit Wiederholung. Nach Fehler oder Ruhezustand beginnt eine NEUE Aufnahme
// derselben Session (jede mit eigenem Init-Chunk, `chunks_independent = false`).
import type { Session } from '@sg/shared';
import { uuidv7 } from '../uuid.ts';
import { pickRecorderFormat, type RecorderFormat } from './codec.ts';
import { readBlob, sha256Hex } from './hash.ts';
import { startLevelMeter, type LevelMeterOptions } from './level.ts';
import { createDefaultRecorderStore } from './store.ts';
import { ChunkUploader, type UploaderOptions } from './uploader.ts';
import {
  TIMESLICE_MS,
  type RecorderState,
  type RecorderStatus,
  type RecorderStore,
  type RecordingMeta,
  type UploaderStatus,
} from './types.ts';
import {
  createWakeLockHolder,
  type VisibilityDocumentLike,
  type WakeLockHolder,
  type WakeLockNavigatorLike,
} from './wake-lock.ts';

/** Minimaler Teil des `SyncClient` (T1-WS): Server-Ereignis `session.updated` */
export interface SessionEventSource {
  onEvent(name: 'session.updated', fn: (session: Session) => void): () => void;
}

/** Teilmenge von `MediaRecorder`, die benutzt wird */
export interface MediaRecorderLike {
  state: string;
  ondataavailable: ((ev: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}
export interface MediaRecorderCtorLike {
  new (stream: MediaStream, options?: { mimeType?: string }): MediaRecorderLike;
  isTypeSupported?(mime: string): boolean;
}

export interface RecorderOptions {
  sessionId: string;
  /** Aktuelle Sitzungszeit in ms (`SessionMs`). Bestimmt `started_ms` jeder Aufnahme. */
  sessionMs: () => number;
  /** Quelle für `session.updated` (`SyncClient`). `beendet` schließt die Aufnahme ab. Kein globaler Zustand. */
  events?: SessionEventSource;
  store?: RecorderStore;
  uploader?: Omit<UploaderOptions, 'store' | 'isActive' | 'onChange'>;
  /** Standard: `navigator.mediaDevices.getUserMedia` */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder?: MediaRecorderCtorLike;
  level?: LevelMeterOptions;
  navigator?: WakeLockNavigatorLike;
  document?: VisibilityDocumentLike;
  /** Monotone Uhr in ms (`performance.now`) */
  clock?: () => number;
  /** Wanduhr in Epochen-ms (`Date.now`) */
  wallClock?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  timesliceMs?: number;
  /** Sprung zwischen Wanduhr und monotoner Uhr, ab dem ein Ruhezustand angenommen wird */
  sleepGapMs?: number;
}

interface Run {
  meta: RecordingMeta;
  recorder: MediaRecorderLike;
  t0: number;
  lastBoundary: number;
  nextSeq: number;
  recordedMs: number;
  stopped: Promise<void>;
  resolveStopped: () => void;
}

const INITIAL: UploaderStatus = { pendingChunks: 0, shelvedChunks: 0, offline: false, retryInMs: null };

export class AudioRecorder {
  private readonly o: RecorderOptions;
  private readonly store: RecorderStore;
  private readonly uploader: ChunkUploader;
  private readonly wake: WakeLockHolder;
  private readonly listeners = new Set<() => void>();
  private readonly clock: () => number;
  private readonly wall: () => number;
  private status: RecorderStatus = {
    state: 'idle',
    recordingId: null,
    chunkCount: 0,
    recordedMs: 0,
    restarts: 0,
    tabHidden: false,
    wakeLock: 'inactive',
    upload: INITIAL,
    error: null,
  };

  private stream: MediaStream | null = null;
  private run: Run | null = null;
  private chain: Promise<void> = Promise.resolve();
  private format: RecorderFormat | null = null;
  private stopLevel: (() => void) | null = null;
  private offEvents: (() => void) | null = null;
  private driftTimer: unknown = null;
  private lastWall = 0;
  private lastClock = 0;
  private restarting: Promise<void> | null = null;
  private finishing = false;
  /** Aufnahmen, die laufen oder gerade abgeschlossen werden: nie als verwaist behandeln */
  private readonly activeIds = new Set<string>();

  constructor(options: RecorderOptions) {
    this.o = options;
    this.store = options.store ?? createDefaultRecorderStore();
    this.clock = options.clock ?? (() => performance.now());
    this.wall = options.wallClock ?? Date.now;
    this.uploader = new ChunkUploader({
      ...options.uploader,
      store: this.store,
      isActive: (id) => this.activeIds.has(id),
      onChange: (upload) => this.patch({ upload }),
    });
    this.wake = createWakeLockHolder({
      navigator: options.navigator ?? (typeof navigator !== 'undefined' ? navigator : undefined),
      document: options.document ?? (typeof document !== 'undefined' ? document : undefined),
      onChange: (w) => this.patch(w),
    });
  }

  getStatus = (): RecorderStatus => this.status;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private patch(p: Partial<RecorderStatus>): void {
    this.status = { ...this.status, ...p };
    for (const fn of [...this.listeners]) fn();
  }

  private fail(state: RecorderState, error: string): never {
    this.patch({ state, error });
    throw new Error(error);
  }

  /** Mikrofon öffnen, Aufnahme beim Core anlegen (offline erlaubt) und aufnehmen */
  async start(): Promise<void> {
    if (this.status.state === 'starting' || this.status.state === 'recording') return;
    this.patch({ state: 'starting', error: null, restarts: 0 });
    const Ctor =
      this.o.MediaRecorder ?? (globalThis.MediaRecorder as unknown as MediaRecorderCtorLike | undefined);
    this.format = pickRecorderFormat(Ctor ? (m) => Ctor.isTypeSupported?.(m) ?? false : undefined);
    if (!Ctor || !this.format) {
      this.fail('unsupported', 'Dieser Browser kann nicht aufnehmen (kein Opus/WebM und kein AAC/MP4).');
    }
    const getUserMedia =
      this.o.getUserMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
    try {
      this.stream = await getUserMedia({ audio: true });
    } catch {
      this.fail(
        'error',
        'Das Mikrofon ist nicht freigegeben. Erlaube den Zugriff in den Browser-Einstellungen.',
      );
    }
    try {
      await this.beginRun(true);
    } catch (error) {
      this.releaseStream();
      throw error;
    }
    this.stopLevel = startLevelMeter(this.stream, this.o.level);
    void this.wake.acquire();
    this.offEvents =
      this.o.events?.onEvent('session.updated', (s) => {
        if (s.id === this.o.sessionId && (s.state === 'beendet' || s.state === 'verarbeitet'))
          void this.stop();
      }) ?? null;
    this.lastWall = this.wall();
    this.lastClock = this.clock();
    const every = this.o.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
    this.driftTimer = every(() => this.checkSleep(), 1000);
    this.patch({ state: 'recording' });
  }

  /** Beendet die Aufnahme, gibt das Mikrofon frei und stößt den Abschluss an (`complete`) */
  async stop(): Promise<void> {
    if (this.finishing || (this.status.state !== 'recording' && this.status.state !== 'starting')) return;
    this.finishing = true;
    this.patch({ state: 'stopping' });
    try {
      await this.restarting?.catch(() => undefined);
      await this.endRun();
    } finally {
      this.teardown();
      this.finishing = false;
      this.patch({ state: 'stopped' });
    }
  }

  /** Sofort verwerfen, ohne Abschluss (Seite wird zerstört). Gepufferte Chunks bleiben für die Wiederaufnahme. */
  dispose(): void {
    this.teardown();
    this.uploader.dispose();
    this.listeners.clear();
  }

  /** Nach dem Neuladen: übrig gebliebene Aufnahmen weiter hochladen und abschließen */
  resumeUploads(): void {
    this.uploader.kick();
  }

  retryUploadNow(): void {
    this.uploader.retryNow();
  }

  private teardown(): void {
    this.offEvents?.();
    this.offEvents = null;
    if (this.driftTimer !== null) {
      (this.o.clearInterval ?? ((h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>)))(
        this.driftTimer,
      );
      this.driftTimer = null;
    }
    this.stopLevel?.();
    this.stopLevel = null;
    void this.wake.release();
    this.releaseStream();
  }

  private releaseStream(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }

  private async beginRun(first: boolean): Promise<void> {
    const stream = this.stream;
    const format = this.format;
    const Ctor = this.o.MediaRecorder ?? (globalThis.MediaRecorder as unknown as MediaRecorderCtorLike);
    if (!stream || !format) throw new Error('Kein Mikrofon');
    const meta: RecordingMeta = {
      id: uuidv7(this.wall()),
      sessionId: this.o.sessionId,
      mime: format.mime,
      codec: format.codec,
      startedMs: Math.max(0, Math.round(this.o.sessionMs())),
      chunksIndependent: false,
      created: false,
      nextSeq: 0,
      recordedMs: 0,
      lastActivityAt: this.wall(),
      complete: null,
    };
    await this.store.putRecording(meta);
    if (first) {
      // Beim Start sofort wissen, ob der Core die Aufnahme ablehnt (Session läuft nicht). Offline ist erlaubt.
      const created = await this.uploader.tryCreate(meta);
      if (created === 'permanent') {
        await this.store.deleteRecording(meta.id);
        this.fail('error', 'Der Core hat die Aufnahme abgelehnt. Läuft die Session?');
      }
      if (created === 'ok') await this.store.patchRecording(meta.id, { created: true });
    }
    let resolveStopped!: () => void;
    const stopped = new Promise<void>((r) => {
      resolveStopped = r;
    });
    const recorder = new Ctor(stream, { mimeType: format.mime });
    const now = this.clock();
    const run: Run = {
      meta,
      recorder,
      t0: now,
      lastBoundary: now,
      nextSeq: 0,
      recordedMs: 0,
      stopped,
      resolveStopped,
    };
    recorder.ondataavailable = (ev) => this.onData(run, ev.data);
    recorder.onstop = () => run.resolveStopped();
    recorder.onerror = () => void this.restart('Die Aufnahme wurde vom Browser unterbrochen.');
    this.run = run;
    this.activeIds.add(meta.id);
    recorder.start(this.o.timesliceMs ?? TIMESLICE_MS);
    this.patch({ recordingId: meta.id, chunkCount: 0, recordedMs: 0 });
    this.uploader.kick();
  }

  private onData(run: Run, blob: Blob): void {
    // Zeitgrenzen sofort festhalten, die Verarbeitung läuft der Reihe nach
    const now = this.clock();
    const startRel = run.lastBoundary - run.t0;
    const durationMs = Math.max(1, Math.round(now - run.lastBoundary));
    run.lastBoundary = now;
    if (blob.size === 0) return;
    const seq = run.nextSeq++;
    this.chain = this.chain.then(async () => {
      try {
        const data = await readBlob(blob);
        const sha256 = await sha256Hex(data);
        run.recordedMs += durationMs;
        await this.store.addChunk(
          {
            recordingId: run.meta.id,
            seq,
            startMs: Math.max(0, Math.round(run.meta.startedMs + startRel)),
            durationMs,
            sha256,
            data,
            attempts: 0,
          },
          { nextSeq: seq + 1, recordedMs: run.recordedMs, lastActivityAt: this.wall() },
        );
        if (this.run === run) this.patch({ chunkCount: seq + 1, recordedMs: run.recordedMs });
        this.uploader.kick();
      } catch (error) {
        console.warn('Recorder: Chunk konnte nicht gepuffert werden', error);
        this.patch({
          error: 'Ein Teil der Aufnahme konnte nicht zwischengespeichert werden (Speicher voll?).',
        });
      }
    });
  }

  /** MediaRecorder anhalten, den letzten Chunk abwarten, Abschluss vermerken */
  private async endRun(): Promise<void> {
    const run = this.run;
    if (!run) return;
    this.run = null;
    if (run.recorder.state !== 'inactive') {
      try {
        run.recorder.stop();
        await Promise.race([run.stopped, new Promise<void>((r) => setTimeout(r, 5000))]);
      } catch {
        // Recorder schon tot
      }
    }
    await this.chain;
    const last = await this.store.getRecording(run.meta.id);
    await this.store.patchRecording(run.meta.id, {
      complete: { lastSeq: Math.max(0, (last?.nextSeq ?? 1) - 1), durationMs: last?.recordedMs ?? 0 },
    });
    this.activeIds.delete(run.meta.id);
    this.uploader.kick();
  }

  private checkSleep(): void {
    const wall = this.wall();
    const clock = this.clock();
    const drift = wall - this.lastWall - (clock - this.lastClock);
    this.lastWall = wall;
    this.lastClock = clock;
    if (this.status.state === 'recording' && drift > (this.o.sleepGapMs ?? 5000)) {
      void this.restart('Der Mac war im Ruhezustand. Die Aufnahme wurde neu begonnen.');
    }
  }

  /** Aktuelle Aufnahme abschließen und eine neue beginnen (Fehler, Ruhezustand) */
  private restart(reason: string): Promise<void> {
    if (this.restarting || this.finishing || this.status.state !== 'recording')
      return this.restarting ?? Promise.resolve();
    this.restarting = (async () => {
      try {
        await this.endRun();
        const alive = this.stream?.getTracks().some((t) => t.readyState === 'live');
        if (!alive) {
          const getUserMedia =
            this.o.getUserMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
          this.releaseStream();
          this.stopLevel?.();
          this.stream = await getUserMedia({ audio: true });
          this.stopLevel = startLevelMeter(this.stream, this.o.level);
        }
        await this.beginRun(false);
        this.patch({ restarts: this.status.restarts + 1, error: reason });
      } catch {
        this.teardown();
        this.patch({ state: 'error', error: 'Die Aufnahme konnte nicht fortgesetzt werden.' });
      } finally {
        this.restarting = null;
      }
    })();
    return this.restarting;
  }
}

/** Nach dem Neuladen aufrufen: lädt gepufferte Chunks hoch und schließt verwaiste Aufnahmen ab */
export function resumePendingUploads(
  options: Omit<UploaderOptions, 'store'> & { store?: RecorderStore } = {},
): ChunkUploader {
  const uploader = new ChunkUploader({ ...options, store: options.store ?? createDefaultRecorderStore() });
  uploader.kick();
  return uploader;
}
