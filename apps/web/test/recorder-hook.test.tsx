// useRecorder: StrictMode-fest, stabile Instanz trotz wechselnder Callbacks (T1-06)
import 'fake-indexeddb/auto';
import { StrictMode } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRecorderStore, useRecorder, type MediaRecorderLike } from '../src/lib/recorder/index.ts';

class FakeMR implements MediaRecorderLike {
  static count = 0;
  static isTypeSupported = () => true;
  state = 'inactive';
  ondataavailable = null;
  onstop: (() => void) | null = null;
  onerror = null;
  constructor() {
    FakeMR.count += 1;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }
}

const base = (extra: object = {}) => ({
  sessionId: '01a1a874-0759-7058-a15c-e5d0adae8e74',
  sessionMs: () => 0,
  store: new MemoryRecorderStore(),
  uploader: {
    baseUrl: 'http://core/api/v1',
    fetch: (async () => Response.json({}, { status: 201 })) as typeof fetch,
  },
  getUserMedia: async () =>
    ({ getTracks: () => [{ readyState: 'live', stop: vi.fn(), onended: null }] }) as unknown as MediaStream,
  MediaRecorder: FakeMR,
  level: { createContext: () => null },
  navigator: {},
  ...extra,
});

describe('useRecorder', () => {
  it('unter StrictMode: Start und Stopp funktionieren nach Mount, Unmount, Mount', async () => {
    const { result } = renderHook(() => useRecorder(base()), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.status.state).toBe('idle'));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status.state).toBe('recording');
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.status.state).toBe('stopped');
  });

  it('neue Funktionsidentitäten erzeugen keinen neuen Recorder', async () => {
    FakeMR.count = 0;
    const { result, rerender } = renderHook(
      ({ n }: { n: number }) => useRecorder(base({ sessionMs: () => n })),
      {
        initialProps: { n: 1 },
      },
    );
    await waitFor(() => expect(result.current.status.state).toBe('idle'));
    await act(async () => {
      await result.current.start();
    });
    rerender({ n: 2 });
    rerender({ n: 3 });
    expect(FakeMR.count).toBe(1);
    expect(result.current.status.state).toBe('recording');
    await act(async () => {
      await result.current.stop();
    });
  });
});
