// Gefälschte Browser-Aufnahme für Dashboard-Tests (Issue #106): MediaRecorder, getUserMedia, Web Locks.
import { vi } from 'vitest';
import { MemoryRecorderStore, type MediaRecorderLike } from '../src/lib/recorder/index.ts';
import type { AcquireRecordingLock } from '../src/lib/recorder/index.ts';
import type { RecordingEnv } from '../src/components/dashboard/use-recording.ts';

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

export function fakeStream(): MediaStream {
  return {
    getTracks: () => [{ readyState: 'live', stop: vi.fn(), onended: null }],
  } as unknown as MediaStream;
}

/** Eine Web-Lock-Sperre mit Warteschlange (FIFO), abbrechbar; geteilt zwischen mehreren „Tabs“ */
export class FakeWebLocks {
  private held = false;
  private queue: (() => void)[] = [];

  acquire: AcquireRecordingLock = (signal) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve(null);
      const grant = () => {
        this.held = true;
        resolve(() => {
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
  const getUserMedia = vi.fn(opts.getUserMedia ?? (async () => fakeStream()));
  const store = new MemoryRecorderStore();
  const fetch = vi.fn(async () => Response.json({}, { status: 201 }));
  const locks = opts.locks ?? new FakeWebLocks();
  return {
    mr,
    getUserMedia,
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
