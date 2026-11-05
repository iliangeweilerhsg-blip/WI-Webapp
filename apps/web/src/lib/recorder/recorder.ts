// Browser-Recorder (VERTRAEGE §10, Spike S4 Variante A): ein MediaRecorder mit `timeslice` je Aufnahme,
// Chunks in IndexedDB puffern, hochladen mit Wiederholung. Eine Aufnahme ist ein MediaRecorder-Strom. Eine NEUE
// Aufnahme derselben Session beginnt nach einem Fehler, nach dem Ruhezustand und nach einer Pause der Session
// (jede mit eigenem Init-Chunk, `chunks_independent = false`).
import type { Session } from '@sg/shared';
import { uuidv7 } from '../uuid.ts';
import { pickRecorderFormat, type RecorderFormat } from './codec.ts';
import { readBlob, sha256Hex } from './hash.ts';
import { startLevelMeter, type LevelMeterOptions } from './level.ts';
import { createDefaultRecorderStore } from './store.ts';
import { ChunkUploader, type UploaderOptions } from './uploader.ts';
import {
  TIMESLICE_MS,
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
  requestData?(): void;
}
export interface MediaRecorderCtorLike {
  new (stream: MediaStream, options?: { mimeType?: string; audioBitsPerSecond?: number }): MediaRecorderLike;
  isTypeSupported?(mime: string): boolean;
}

/** Sprachtauglich und klein: 48 kbit/s, mono. `echoCancellation`/`noiseSuppression` bleiben Standard (Spike S4). */
export const AUDIO_BITS_PER_SECOND = 48_000;
const AUDIO_CONSTRAINTS: MediaStreamConstraints = { audio: { channelCount: 1 } };

export interface RecorderDocumentLike extends VisibilityDocumentLike {
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

export interface RecorderOptions {
  sessionId: string;
  /** Aktuelle Sitzungszeit in ms (`SessionMs`). Bestimmt `started_ms` jeder Aufnahme. */
  sessionMs: () => number;
  /** Quelle für `session.updated` (`SyncClient`). `beendet` schließt ab, `pausiert`/`laeuft` trennen/öffnen Aufnahmen. */
  events?: SessionEventSource;
  store?: RecorderStore;
  uploader?: Omit<UploaderOptions, 'store' | 'isActive' | 'onChange'>;
  /** Standard: `navigator.mediaDevices.getUserMedia` */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder?: MediaRecorderCtorLike;
  level?: LevelMeterOptions;
  navigator?: WakeLockNavigatorLike;
  document?: RecorderDocumentLike;
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
  /** Wird vom Recorder selbst beendet (kein unerwarteter Stopp) */
  ending: boolean;
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
  /** Chunk-Verarbeitung und Schreiben der Metadaten der Reihe nach */
  private chain: Promise<void> = Promise.resolve();
  /** Zustandswechsel (Neustart, Pause, Fortsetzen, Stopp) der Reihe nach */
  private transitions: Promise<void> = Promise.resolve();
  private format: RecorderFormat | null = null;
  private stopLevel: (() => void) | null = null;
  private offEvents: (() => void) | null = null;
  private driftTimer: unknown = null;
  private lastWall = 0;
  private lastClock = 0;
  private visibilityHandler: (() => void) | null = null;
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

  private fail(state: 'error' | 'unsupported', error: string): never {
    this.patch({ state, error });
    throw new Error(error);
  }

  private serialize(fn: () => Promise<void>): Promise<void> {
    const next = this.transitions.then(fn, fn);
    this.transitions = next.catch(() => undefined);
    return next;
  }

  private getUserMedia(): Promise<MediaStream> {
    const get =
      this.o.getUserMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
    return get(AUDIO_CONSTRAINTS);
  }

  /** Mikrofon öffnen und aufnehmen. Die Aufnahme wird beim Core angelegt, auch erst später (offline erlaubt). */
  async start(): Promise<void> {
    if (this.status.state !== 'idle' && this.status.state !== 'stopped' && this.status.state !== 'error')
      return;
    this.patch({ state: 'starting', error: null, restarts: 0 });
    const Ctor =
      this.o.MediaRecorder ?? (globalThis.MediaRecorder as unknown as MediaRecorderCtorLike | undefined);
    this.format = pickRecorderFormat(Ctor ? (m) => Ctor.isTypeSupported?.(m) ?? false : undefined);
    if (!Ctor || !this.format) {
      this.fail('unsupported', 'Dieser Browser kann nicht aufnehmen (kein Opus/WebM und kein AAC/MP4).');
    }
    try {
      this.adoptStream(await this.getUserMedia());
    } catch {
      this.fail(
        'error',
        'Das Mikrofon ist nicht freigegeben. Erlaube den Zugriff in den Browser-Einstellungen.',
      );
    }
    try {
      await this.beginRun(true);
    } catch (error) {
      this.teardown();
      throw error;
    }
    const stream = this.stream;
    if (stream) this.stopLevel = startLevelMeter(stream, this.o.level);
    void this.wake.acquire();
    this.offEvents = this.o.events?.onEvent('session.updated', (s) => this.onSessionUpdated(s)) ?? null;
    this.lastWall = this.wall();
    this.lastClock = this.clock();
    const every = this.o.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
    this.driftTimer = every(() => this.checkSleep(), 1000);
    const doc = this.o.document ?? (typeof document !== 'undefined' ? document : undefined);
    if (doc) {
      // Ein Tab im Hintergrund kann gedrosselt oder beendet werden: gepufferte Daten jetzt herausgeben
      this.visibilityHandler = () => {
        if (doc.visibilityState === 'hidden') this.run?.recorder.requestData?.();
      };
      doc.addEventListener('visibilitychange', this.visibilityHandler);
    }
    this.patch({ state: 'recording' });
  }

  private onSessionUpdated(s: Session): void {
    if (s.id !== this.o.sessionId) return;
    if (s.state === 'beendet' || s.state === 'verarbeitet') void this.stop();
    else if (s.state === 'pausiert') void this.pause();
    else if (s.state === 'laeuft') void this.resume();
  }

  /** Session pausiert: Aufnahme abschließen (`complete`). Das Mikrofon bleibt offen, kein `MediaRecorder.pause()`. */
  pause(): Promise<void> {
    return this.serialize(async () => {
      if (this.status.state !== 'recording') return;
      await this.endRun();
      this.patch({ state: 'paused' });
    });
  }

  /** Session läuft weiter: neue Aufnahme, `started_ms` = aktuelle Sitzungszeit (die Lücke bleibt auf der Zeitachse) */
  resume(): Promise<void> {
    return this.serialize(async () => {
      if (this.status.state !== 'paused') return;
      try {
        await this.ensureStream();
        await this.beginRun(false);
        this.patch({ state: 'recording' });
      } catch {
        this.failRunning('Die Aufnahme konnte nicht fortgesetzt werden.');
      }
    });
  }

  /** Beendet die Aufnahme, gibt das Mikrofon frei und stößt den Abschluss an (`complete`) */
  stop(): Promise<void> {
    return this.serialize(async () => {
      const { state } = this.status;
      if (state !== 'recording' && state !== 'paused' && state !== 'starting') return;
      this.patch({ state: 'stopping' });
      try {
        await this.endRun();
      } finally {
        this.teardown();
        this.patch({ state: 'stopped' });
      }
    });
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

  private failRunning(message: string): void {
    this.teardown();
    this.patch({ state: 'error', error: message });
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
    const doc = this.o.document ?? (typeof document !== 'undefined' ? document : undefined);
    if (doc && this.visibilityHandler) doc.removeEventListener('visibilitychange', this.visibilityHandler);
    this.visibilityHandler = null;
    this.stopLevel?.();
    this.stopLevel = null;
    void this.wake.release();
    this.releaseStream();
  }

  private adoptStream(stream: MediaStream): void {
    this.stream = stream;
    for (const track of stream.getTracks()) {
      // Mikrofon weg (abgesteckt, Berechtigung entzogen, Ruhezustand): neu beginnen oder sichtbar scheitern
      track.onended = () => {
        if (this.stream === stream)
          void this.restart('Das Mikrofon wurde getrennt. Die Aufnahme wurde neu begonnen.');
      };
    }
  }

  private releaseStream(): void {
    for (const track of this.stream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    this.stream = null;
  }

  /** Mikrofon bei Bedarf neu öffnen (Spur beendet) */
  private async ensureStream(): Promise<void> {
    const alive = this.stream?.getTracks().some((t) => t.readyState === 'live');
    if (alive) return;
    this.stopLevel?.();
    this.stopLevel = null;
    this.releaseStream();
    this.adoptStream(await this.getUserMedia());
    if (this.stream) this.stopLevel = startLevelMeter(this.stream, this.o.level);
  }

  private async beginRun(first: boolean): Promise<void> {
    const stream = this.stream;
    const format = this.format;
    const Ctor = this.o.MediaRecorder ?? (globalThis.MediaRecorder as unknown as MediaRecorderCtorLike);
    if (!stream || !format) throw new Error('Kein Mikrofon');
    let resolveStopped!: () => void;
    const stopped = new Promise<void>((r) => {
      resolveStopped = r;
    });
    // Zuerst aufnehmen, dann anlegen: der Core darf langsam oder offline sein, es geht kein Ton verloren.
    // `started_ms` gehört zum tatsächlichen Beginn der Aufnahme.
    const recorder = new Ctor(stream, { mimeType: format.mime, audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    const startedMs = Math.max(0, Math.round(this.o.sessionMs()));
    const now = this.clock();
    recorder.start(this.o.timesliceMs ?? TIMESLICE_MS);
    const meta: RecordingMeta = {
      id: uuidv7(this.wall()),
      sessionId: this.o.sessionId,
      mime: format.mime,
      codec: format.codec,
      startedMs,
      chunksIndependent: false,
      created: false,
      nextSeq: 0,
      recordedMs: 0,
      lastActivityAt: this.wall(),
      complete: null,
    };
    const run: Run = {
      meta,
      recorder,
      t0: now,
      lastBoundary: now,
      nextSeq: 0,
      recordedMs: 0,
      ending: false,
      stopped,
      resolveStopped,
    };
    recorder.ondataavailable = (ev) => this.onData(run, ev.data);
    recorder.onstop = () => {
      run.resolveStopped();
      // Der Browser hat den Recorder von sich aus beendet (nicht über endRun): neu beginnen
      if (!run.ending && this.run === run) void this.restart('Die Aufnahme wurde vom Browser beendet.');
    };
    recorder.onerror = () => {
      if (!run.ending && this.run === run) void this.restart('Die Aufnahme wurde vom Browser unterbrochen.');
    };
    this.run = run;
    this.activeIds.add(meta.id);
    this.patch({ recordingId: meta.id, chunkCount: 0, recordedMs: 0 });
    // Chunk-Verarbeitung wartet, bis die Metadaten in IndexedDB stehen
    this.chain = this.chain.then(() => this.store.putRecording(meta)).catch(() => undefined);
    await this.chain;

    if (first) {
      // Beim Start sofort wissen, ob der Core die Aufnahme ablehnt (Session läuft nicht). Offline ist erlaubt.
      const created = await this.uploader.tryCreate(meta);
      if (created === 'permanent') {
        run.ending = true;
        this.run = null;
        try {
          recorder.stop();
        } catch {
          // schon beendet
        }
        this.activeIds.delete(meta.id);
        await this.chain;
        await this.store.deleteRecording(meta.id);
        this.fail('error', 'Der Core hat die Aufnahme abgelehnt. Läuft die Session?');
      }
      if (created === 'ok') await this.store.patchRecording(meta.id, { created: true });
    }
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
        const chunk = {
          recordingId: run.meta.id,
          seq,
          startMs: Math.max(0, Math.round(run.meta.startedMs + startRel)),
          durationMs,
          sha256,
          data,
          attempts: 0,
        };
        const stored = await this.store.addChunk(chunk, {
          nextSeq: seq + 1,
          recordedMs: run.recordedMs,
          lastActivityAt: this.wall(),
        });
        if (!stored) {
          // Die Aufnahme wurde im Zwischenspeicher gelöscht: Daten nicht still verwerfen
          await this.store.shelveChunk({
            ...chunk,
            status: null,
            code: 'recording_missing',
            message: 'Die Aufnahme fehlt im Zwischenspeicher.',
            shelvedAt: this.wall(),
          });
          this.patch({
            error: 'Die Aufnahme fehlt im Zwischenspeicher. Neue Teile liegen in der Fehlerablage.',
          });
          return;
        }
        if (this.status.recordingId === run.meta.id) {
          this.patch({ chunkCount: seq + 1, recordedMs: run.recordedMs });
        }
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
    run.ending = true;
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

  /** Aktuelle Aufnahme abschließen und eine neue beginnen (Fehler, Ruhezustand, Mikrofon weg) */
  private restart(reason: string): Promise<void> {
    return this.serialize(async () => {
      if (this.status.state !== 'recording') return;
      try {
        await this.endRun();
        await this.ensureStream();
        await this.beginRun(false);
        this.patch({ restarts: this.status.restarts + 1, error: reason });
      } catch {
        this.failRunning('Die Aufnahme konnte nicht fortgesetzt werden (kein Mikrofon?).');
      }
    });
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
