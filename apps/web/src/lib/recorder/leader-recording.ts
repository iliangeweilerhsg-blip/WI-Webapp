// Aufnahme nur im Leader-Tab (VERTRAEGE §11.8, Issue #106). Nur der Tab, der Sync-Leader ist, nimmt auf.
// Zwei Sicherungen sorgen dafür, dass nie zwei Tabs gleichzeitig aufnehmen:
// 1. Wer nicht (mehr) Leader ist, beendet seine Aufnahme (letzter Chunk, `complete`) und gibt das Mikrofon frei.
// 2. Eine eigene Aufnahme-Sperre (Web Lock `sg-recording`) wird vor `start()` geholt und erst NACH dem Stopp
//    freigegeben. Ein neuer Leader wartet darauf, bis der alte Tab fertig ist. Schließt ein Tab, gibt der Browser die Sperre frei.
import type { RecorderStatus } from './types.ts';

/** Teilmenge des `AudioRecorder`, die gesteuert wird (Tests liefern einen Fake) */
export interface RecorderPort {
  getStatus(): RecorderStatus;
  subscribe(fn: () => void): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
}

/** Holt die Aufnahme-Sperre. Wartet, bis sie frei ist; `null`, wenn abgebrochen. Rückgabe: freigeben. */
export type AcquireRecordingLock = (signal: AbortSignal) => Promise<(() => void) | null>;

export const RECORDING_LOCK_NAME = 'sg-recording';

/** Aufnahme-Sperre über `navigator.locks`. Ohne Web Locks gibt es keine Sperre (dann gilt nur die Leader-Regel). */
export function createWebLocksRecordingLock(name = RECORDING_LOCK_NAME): AcquireRecordingLock {
  return (signal) => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks) return Promise.resolve(() => undefined);
    return new Promise((resolve) => {
      locks
        .request(name, { signal }, () => new Promise<void>((held) => resolve(() => held())))
        .catch(() => resolve(null)); // abgebrochen
    });
  };
}

export type SessionPhase = 'laeuft' | 'pausiert' | 'andere' | null;

export interface LeaderRecordingInput {
  /** Dieser Tab ist (entschieden) Sync-Leader */
  leader: boolean;
  /** Zustand der Session: nur `laeuft` und `pausiert` sind aktiv */
  phase: SessionPhase;
  /** Das Mikrofon darf geöffnet werden (Berechtigung erteilt oder Nutzeraktion) */
  allowed: boolean;
}

export interface LeaderRecordingOptions {
  recorder: RecorderPort;
  acquireLock?: AcquireRecordingLock;
}

/**
 * Gleicht den Recorder mit dem Soll-Zustand ab (Leader, Session-Phase, Erlaubnis). Alle Wechsel laufen der Reihe nach.
 * Ein neuer Soll-Zustand bricht das Warten auf die Sperre ab.
 */
export class LeaderRecording {
  private readonly recorder: RecorderPort;
  private readonly acquireLock: AcquireRecordingLock;
  private input: LeaderRecordingInput = { leader: false, phase: null, allowed: false };
  private chain: Promise<void> = Promise.resolve();
  private epoch = 0;
  private abort: AbortController | null = null;
  private release: (() => void) | null = null;
  /** Nach einem Fehler nicht von selbst erneut öffnen (sonst Schleife); `retry()` erlaubt einen neuen Versuch */
  private failed = false;
  private waiting = false;
  private readonly listeners = new Set<() => void>();
  private readonly off: () => void;
  private disposed = false;

  constructor(options: LeaderRecordingOptions) {
    this.recorder = options.recorder;
    this.acquireLock = options.acquireLock ?? createWebLocksRecordingLock();
    // Ist die Aufnahme zu Ende oder gescheitert, hält dieser Tab die Sperre nicht länger
    this.off = this.recorder.subscribe(() => {
      const s = this.recorder.getStatus().state;
      if (s === 'error' || s === 'stopped' || s === 'unsupported' || s === 'idle') this.releaseLock();
    });
  }

  /** Dieser Tab wartet darauf, dass ein anderer Tab die Aufnahme-Sperre freigibt (z. B. Mikrofon-Dialog dort offen) */
  isWaiting = (): boolean => this.waiting;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private setWaiting(on: boolean): void {
    if (this.waiting === on) return;
    this.waiting = on;
    for (const fn of [...this.listeners]) fn();
  }

  /** Neuer Soll-Zustand */
  set(patch: Partial<LeaderRecordingInput>): void {
    // Nach `dispose()` startet nichts mehr (sonst nähme ein entsorgter Recorder wieder auf)
    if (this.disposed) return;
    const next = { ...this.input, ...patch };
    if (
      next.leader === this.input.leader &&
      next.phase === this.input.phase &&
      next.allowed === this.input.allowed
    )
      return;
    this.input = next;
    this.schedule();
  }

  /** Nutzeraktion „Aufnahme starten“: erlaubt das Öffnen des Mikrofons und versucht es erneut */
  retry(): void {
    if (this.disposed) return;
    this.input = { ...this.input, allowed: true };
    this.failed = false;
    this.schedule();
  }

  /** Aufräumen: bricht das Warten ab und stoppt die Aufnahme sauber (Fire and forget) */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.off();
    this.input = { leader: false, phase: null, allowed: false };
    this.schedule();
  }

  /** Löst auf, wenn alle bisher eingeplanten Wechsel durch sind */
  idle(): Promise<void> {
    return this.chain;
  }

  private schedule(): void {
    const epoch = ++this.epoch;
    this.abort?.abort();
    this.chain = this.chain.then(() => this.reconcile(epoch)).catch(() => undefined);
  }

  private releaseLock(): void {
    const r = this.release;
    this.release = null;
    r?.();
  }

  /** Aufnahme beenden (letzter Chunk, `complete`), danach erst die Sperre freigeben */
  private async halt(): Promise<void> {
    try {
      await this.recorder.stop();
    } finally {
      this.releaseLock();
    }
  }

  private async reconcile(epoch: number): Promise<void> {
    const { leader, phase, allowed } = this.input;
    const active = phase === 'laeuft' || phase === 'pausiert';
    if (!leader || !active) {
      this.failed = false;
      await this.halt();
      return;
    }
    const state = this.recorder.getStatus().state;
    if (phase === 'pausiert') {
      if (state === 'recording') await this.recorder.pause();
      return;
    }
    // Die Session läuft
    if (state === 'paused') {
      await this.recorder.resume();
      return;
    }
    if (state === 'recording' || state === 'starting' || state === 'stopping') return;
    if (!allowed || this.failed) return;
    const controller = new AbortController();
    this.abort = controller;
    this.setWaiting(true);
    let release: (() => void) | null;
    try {
      release = await this.acquireLock(controller.signal);
    } finally {
      this.setWaiting(false);
    }
    if (this.abort === controller) this.abort = null;
    if (!release) return; // abgebrochen: der neue Soll-Zustand ist bereits eingeplant
    if (this.epoch !== epoch) {
      // Der Soll-Zustand hat sich geändert: der neu eingeplante Abgleich entscheidet
      release();
      return;
    }
    this.releaseLock();
    this.release = release;
    try {
      await this.recorder.start();
    } catch {
      this.failed = true;
      this.releaseLock();
    }
  }
}
