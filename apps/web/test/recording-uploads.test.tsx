// App-weit ungesendete Chunks nachholen, nur im Leader-Tab (Issue #115)
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AudioRecorder, MemoryRecorderStore, useResumePendingUploads } from '../src/lib/recorder/index.ts';
import { fakeRecording } from './recording-fakes.ts';
import type { SyncClient } from '../src/lib/sync/client.ts';

function fakeClient(state: string) {
  const listeners = new Set<(d: unknown) => void>();
  const client = {
    connectionState: state,
    onEvent: (name: string, fn: (d: unknown) => void) => {
      if (name === 'connection') listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
  return {
    client: client as unknown as SyncClient,
    setState(next: string) {
      client.connectionState = next;
      for (const fn of listeners) fn({ state: next, retryInMs: null, closeCode: null });
    },
  };
}

const REC = '0190f6a2-0000-7000-8000-0000000000f2';

async function seed(store: MemoryRecorderStore) {
  await store.putRecording({
    id: REC,
    sessionId: '0190f6a2-0000-7000-8000-0000000000e1',
    mime: 'audio/webm;codecs=opus',
    codec: 'opus',
    startedMs: 0,
    chunksIndependent: false,
    created: true,
    nextSeq: 1,
    recordedMs: 1000,
    lastActivityAt: Date.now(),
    complete: { lastSeq: 0, durationMs: 1000 },
  });
  await store.putChunk({
    recordingId: REC,
    seq: 0,
    startMs: 0,
    durationMs: 1000,
    sha256: 'a'.repeat(64),
    data: new ArrayBuffer(4),
    attempts: 0,
  });
}

async function setup(state: string) {
  const store = new MemoryRecorderStore();
  // Reste liegen schon vor dem App-Start in IndexedDB
  await seed(store);
  const calls: string[] = [];
  const options = {
    store,
    channelName: `t-${Math.random()}`,
    uploader: {
      baseUrl: 'http://core/api/v1',
      fetch: (async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname.replace('/api/v1', '')}`);
        return Response.json({}, { status: 201 });
      }) as unknown as typeof fetch,
    },
  };
  const c = fakeClient(state);
  const view = renderHook(() => useResumePendingUploads(c.client, options));
  return { ...c, store, calls, view };
}

describe('useResumePendingUploads: nur der Leader lädt hoch', () => {
  it('ein Folge-Tab sendet weder PUT noch complete', async () => {
    const t = await setup('other_tab');
    await new Promise((r) => setTimeout(r, 150));
    expect(t.calls).toEqual([]);
  });

  it('der Leader holt Ungesendetes ab dem App-Start nach, auch ohne Dashboard', async () => {
    const store = new MemoryRecorderStore();
    await seed(store);
    const calls: string[] = [];
    const c = fakeClient('online');
    renderHook(() =>
      useResumePendingUploads(c.client, {
        store,
        channelName: `t-${Math.random()}`,
        uploader: {
          baseUrl: 'http://core/api/v1',
          fetch: (async (url: string, init?: RequestInit) => {
            calls.push(`${init?.method} ${new URL(url).pathname.replace('/api/v1', '')}`);
            return Response.json({}, { status: 201 });
          }) as unknown as typeof fetch,
        },
      }),
    );
    await waitFor(() => expect(calls).toContain(`PUT /recordings/${REC}/chunks/0`));
    await waitFor(() => expect(calls).toContain(`POST /recordings/${REC}/complete`));
  });

  it('beim Leader-Wechsel übernimmt der neue Leader; der alte hört auf', async () => {
    const t = await setup('other_tab');
    await new Promise((r) => setTimeout(r, 100));
    expect(t.calls).toEqual([]);
    act(() => t.setState('online'));
    await waitFor(() => expect(t.calls).toContain(`POST /recordings/${REC}/complete`));
    // Rolle wieder weg: neue Reste werden nicht mehr hochgeladen
    act(() => t.setState('other_tab'));
    const before = t.calls.length;
    await t.store.putRecording({
      id: '0190f6a2-0000-7000-8000-0000000000f3',
      sessionId: '0190f6a2-0000-7000-8000-0000000000e1',
      mime: 'audio/webm;codecs=opus',
      codec: 'opus',
      startedMs: 0,
      chunksIndependent: false,
      created: false,
      nextSeq: 0,
      recordedMs: 0,
      lastActivityAt: 0,
      complete: { lastSeq: 0, durationMs: 0 },
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(t.calls.length).toBe(before);
  });

  it('ein Hinweis auf dem BroadcastChannel holt Chunks eines Ex-Leaders ab', async () => {
    const store = new MemoryRecorderStore();
    const calls: string[] = [];
    const c = fakeClient('online');
    const channelName = `t-${Math.random()}`;
    renderHook(() =>
      useResumePendingUploads(c.client, {
        store,
        channelName,
        uploader: {
          baseUrl: 'http://core/api/v1',
          fetch: (async (url: string, init?: RequestInit) => {
            calls.push(`${init?.method} ${new URL(url).pathname.replace('/api/v1', '')}`);
            return Response.json({}, { status: 201 });
          }) as unknown as typeof fetch,
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    await seed(store);
    expect(calls).toEqual([]);
    const ch = new BroadcastChannel(channelName);
    ch.postMessage('kick');
    ch.close();
    await waitFor(() => expect(calls).toContain(`POST /recordings/${REC}/complete`));
  });

  it('das regelmäßige kick holt Reste nach einer verlorenen Nachricht ab', async () => {
    const store = new MemoryRecorderStore();
    const calls: string[] = [];
    const c = fakeClient('online');
    renderHook(() =>
      useResumePendingUploads(c.client, {
        store,
        channelName: `t-${Math.random()}`,
        kickIntervalMs: 40,
        uploader: {
          baseUrl: 'http://core/api/v1',
          fetch: (async (url: string, init?: RequestInit) => {
            calls.push(`${init?.method} ${new URL(url).pathname.replace('/api/v1', '')}`);
            return Response.json({}, { status: 201 });
          }) as unknown as typeof fetch,
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 60));
    await seed(store); // niemand meldet es
    await waitFor(() => expect(calls).toContain(`POST /recordings/${REC}/complete`));
  });

  it('ein zweiter Uploader schließt die laufende Aufnahme dieses Tabs nicht als verwaist ab', async () => {
    const base = fakeRecording();
    const recorder = new AudioRecorder({
      ...base.env.recorder,
      sessionId: '0190f6a2-0000-7000-8000-0000000000e1',
      sessionMs: () => 0,
    });
    await recorder.start();
    base.mr.instances[0]?.emit(16);
    await waitFor(async () => expect((await base.store.listRecordings())[0]?.nextSeq).toBe(1));

    const calls: string[] = [];
    const c = fakeClient('online');
    renderHook(() =>
      useResumePendingUploads(c.client, {
        store: base.store,
        channelName: `t-${Math.random()}`,
        kickIntervalMs: 30,
        uploader: {
          baseUrl: 'http://core/api/v1',
          // Uhr zehn Stunden vor: ohne `isActive` gälte die laufende Aufnahme als verwaist
          now: () => Date.now() + 10 * 3600_000,
          fetch: (async (url: string, init?: RequestInit) => {
            calls.push(`${init?.method} ${new URL(url).pathname.replace('/api/v1', '')}`);
            return Response.json({}, { status: 201 });
          }) as unknown as typeof fetch,
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 250));
    expect(calls.filter((x) => x.endsWith('/complete'))).toEqual([]);
    const [meta] = await base.store.listRecordings();
    expect(meta?.complete).toBeNull();
    await recorder.stop();
    recorder.dispose();
  });
});
