// Gefälschte Browser-Aufnahme für Dashboard-Tests (Issue #106): MediaRecorder, getUserMedia, Web Locks.
import { vi } from 'vitest';
import { MemoryRecorderStore, type MediaRecorderLike } from '../src/lib/recorder/index.ts';
import type { AcquireRecordingLock } from '../src/lib/recorder/index.ts';
import type { RecordingEnv } from '../src/lib/recording/index.ts';

export interface SharedRunning {
  running: Set<object>;
  maxRunning: number;
}

/** Ein „Tab“: eigene MediaRecorder-Klasse; `shared` zählt die gleichzeitig laufenden über alle Tabs */
export function makeFakeMediaRecorder(shared: SharedRunning) {
  return class FakeMR implements MediaRecorderLike {
    static instances: FakeMR[] = [];
    static isTypeSupported = () => true;
    state = 'inactive';
    /** Wie oft `requestData()` gerufen wurde (`pagehide`, verborgener Tab) */
    requestCalls = 0;
    ondataavailable: ((ev: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror = null;
    constructor() {
      FakeMR.instances.push(this);
    }
    start() {
      this.state = 'recording';
      shared.running.add(this);
      shared.maxRunning = Math.max(shared.maxRunning, shared.running.size);
    }
    requestData() {
      this.requestCalls++;
    }
    /** Gibt einen Chunk heraus, wie es `timeslice` täte */
    emit(bytes = 8) {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes).fill(1)]) });
    }
    stop() {
      if (this.state === 'inactive') return;
      // Der Browser gibt beim Stopp den letzten Chunk heraus und meldet dann `stop`
      this.emit(4);
      this.state = 'inactive';
      shared.running.delete(this);
      this.onstop?.();
    }
  };
}

export interface FakeTrack {
  readyState: string;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
}
export type FakeStream = MediaStream & { tracks: FakeTrack[] };

export function fakeStream(): FakeStream {
  const tracks: FakeTrack[] = [{ readyState: 'live', stop: vi.fn(), onended: null }];
  return { getTracks: () => tracks, tracks } as unknown as FakeStream;
}

/** Eine Web-Lock-Sperre mit Warteschlange (FIFO), abbrechbar; geteilt zwischen mehreren „Tabs“ */
export class FakeWebLocks {
  private held = false;
  private queue: (() => void)[] = [];
  /** Wie viele Sperren zugleich gehalten wurden (höchstens 1, sonst nahmen zwei Recorder gleichzeitig auf) */
  maxHeld = 0;
  private holders = 0;

  acquire: AcquireRecordingLock = (signal) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve(null);
      const grant = () => {
        this.held = true;
        this.maxHeld = Math.max(this.maxHeld, ++this.holders);
        resolve(() => {
          this.holders--;
          this.held = false;
          this.queue.shift()?.();
        });
      };
      if (!this.held) return grant();
      this.queue.push(grant);
      signal.addEventListener('abort', () => {
        const i = this.queue.indexOf(grant);
        if (i >= 0) {
          this.queue.splice(i, 1);
          resolve(null);
        }
      });
    });
}

export interface FakeRecording {
  env: RecordingEnv;
  mr: ReturnType<typeof makeFakeMediaRecorder>;
  getUserMedia: ReturnType<typeof vi.fn>;
  /** Alle geöffneten Mikrofon-Spuren dieses Tabs */
  tracks: FakeTrack[];
  store: MemoryRecorderStore;
  fetch: ReturnType<typeof vi.fn>;
}

export function fakeRecording(
  opts: {
    shared?: SharedRunning;
    locks?: FakeWebLocks;
    permission?: 'granted' | 'prompt' | 'denied';
    getUserMedia?: () => Promise<MediaStream>;
  } = {},
): FakeRecording {
  const shared = opts.shared ?? { running: new Set<object>(), maxRunning: 0 };
  const mr = makeFakeMediaRecorder(shared);
  const tracks: FakeTrack[] = [];
  const open = opts.getUserMedia ?? (async () => fakeStream());
  const getUserMedia = vi.fn(async () => {
    const stream = await open();
    tracks.push(...((stream as Partial<FakeStream>).tracks ?? []));
    return stream;
  });
  const store = new MemoryRecorderStore();
  const fetch = vi.fn(async () => Response.json({}, { status: 201 }));
  const locks = opts.locks ?? new FakeWebLocks();
  return {
    mr,
    getUserMedia,
    tracks,
    store,
    fetch,
    env: {
      recorder: {
        store,
        getUserMedia,
        MediaRecorder: mr,
        level: { createContext: () => null },
        navigator: {},
        uploader: { baseUrl: 'http://core/api/v1', fetch: fetch as unknown as typeof globalThis.fetch },
      },
      acquireLock: locks.acquire,
      permission: async () => opts.permission ?? 'granted',
    },
  };
}
