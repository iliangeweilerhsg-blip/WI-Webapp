// Folge-Tab (VERTRAEGE §11.8): `connection` bleibt dort `other_tab`, die Mitlese-Verbindung meldet sich über `link`.
// Scheitert das erste Laden (Core lief beim Öffnen noch nicht), müssen Marker und Folienposition neu laden, sobald
// `link` `online` wird (Issue #381).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Marker, SlideEvent } from '@sg/shared';
import { useMarkers } from '../src/components/dashboard/markers/use-markers.ts';
import { useSlidePosition } from '../src/components/dashboard/slides/use-slide-position.ts';
import { makeQueryClient } from '../src/lib/query.tsx';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { installFakeCore, makeSession, type FakeCore } from './fake-core.ts';

const SESSION_ID = '0190f6a2-0000-7000-8000-0000000000e1';
const USER_ID = '0190f6a2-0000-7000-8000-000000000000';
let core: FakeCore;
let queryClient = makeQueryClient();

/** Folge-Tab: `connectionState` bleibt `other_tab`, nur `link` ändert sich */
function followerClient() {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const subscribe = vi.fn(() => () => undefined);
  const raw = {
    connectionState: 'other_tab',
    linkState: 'connecting',
    subscribe,
    onEvent: vi.fn((name: string, fn: (data: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(fn);
      listeners.set(name, set);
      return () => void set.delete(fn);
    }),
  };
  return {
    client: raw as unknown as SyncClient,
    subscribe,
    link: (state: string) =>
      act(() => {
        raw.linkState = state;
        listeners.get('link')?.forEach((fn) => fn({ state }));
      }),
  };
}

/** Abrufe des Snapshots, die den Core erreicht haben (bei `down` wirft der Fake vorher) */
const snapshotCalls = () => core.requests.filter((r) => r.path.endsWith('/snapshot')).length;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  queryClient = makeQueryClient();
  // Kein automatischer Wiederholungsversuch von TanStack Query: Das Neuladen soll allein vom Ereignis `link` kommen
  queryClient.setDefaultOptions({ queries: { networkMode: 'always', retry: false } });
  core = installFakeCore({ sessions: [makeSession({ id: SESSION_ID })], down: true });
});

describe('Folge-Tab: Neuladen über link', () => {
  it('Marker: erstes Laden scheitert, link wird online, danach wird neu geladen und abonniert', async () => {
    const sync = followerClient();
    const { result } = renderHook(() => useMarkers(SESSION_ID, sync.client), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(snapshotCalls()).toBe(0);
    expect(sync.subscribe).not.toHaveBeenCalled();
    core.down = false;
    const marker: Marker = {
      id: '0190f6a2-0000-7000-8000-000000006001',
      user_id: USER_ID,
      created_at: '2026-11-04T08:00:00Z',
      updated_at: '2026-11-04T08:00:00Z',
      deleted_at: null,
      session_id: SESSION_ID,
      kind: 'frage',
      t_ms: 1000,
      page_id: null,
      position: null,
      source: 'ipad',
      note: null,
      resolved_at: null,
    };
    core.markers = [marker];
    await sync.link('online');
    await waitFor(() => expect(sync.subscribe).toHaveBeenCalledTimes(1));
    expect(snapshotCalls()).toBe(1);
    expect(result.current.state.markers).toHaveLength(1);
  });

  it('Folienposition: erstes Laden scheitert, link wird online, danach wird neu geladen und abonniert', async () => {
    const sync = followerClient();
    const { result } = renderHook(() => useSlidePosition(SESSION_ID, sync.client), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(snapshotCalls()).toBe(0);
    expect(sync.subscribe).not.toHaveBeenCalled();
    core.down = false;
    const event: SlideEvent = {
      id: '0190f6a2-0000-7000-8000-000000007001',
      user_id: USER_ID,
      created_at: '2026-11-04T08:00:00Z',
      updated_at: '2026-11-04T08:00:00Z',
      deleted_at: null,
      session_id: SESSION_ID,
      slide_id: null,
      slide_index: 6,
      t_ms: 5000,
      device: 'ipad',
      source: 'manuell_ipad',
    };
    core.slideEvents = [event];
    await sync.link('online');
    await waitFor(() => expect(sync.subscribe).toHaveBeenCalledTimes(1));
    expect(snapshotCalls()).toBe(1);
    expect(result.current.position).toEqual({ index: 6, tMs: 5000 });
  });
});

/** Leader-Tab (oder Folge-Tab mit stehender Mitlese-Verbindung): `link` ist schon `online`, es kommt kein Ereignis mehr */
function onlineClient() {
  const subscribe = vi.fn(() => () => undefined);
  const raw = {
    connectionState: 'online',
    linkState: 'online',
    subscribe,
    onEvent: vi.fn(() => () => undefined),
  };
  return { client: raw as unknown as SyncClient, subscribe };
}

describe('Erstes Laden scheitert, obwohl link schon online ist', () => {
  afterEach(() => vi.useRealTimers());
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  it('Marker: wiederholt mit wachsender Wartezeit, danach steht das Abo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sync = onlineClient();
    renderHook(() => useMarkers(SESSION_ID, sync.client), { wrapper });
    await advance(0); // 1. Versuch scheitert
    await advance(1_000); // 2. Versuch scheitert
    expect(sync.subscribe).not.toHaveBeenCalled();
    core.down = false;
    await advance(1_500); // nächster Versuch erst nach 2 s: noch nichts
    expect(sync.subscribe).not.toHaveBeenCalled();
    await advance(500);
    expect(sync.subscribe).toHaveBeenCalledTimes(1);
    await advance(60_000); // danach keine weiteren Versuche
    expect(sync.subscribe).toHaveBeenCalledTimes(1);
  });

  it('Folienposition: wiederholt mit wachsender Wartezeit, danach steht das Abo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sync = onlineClient();
    renderHook(() => useSlidePosition(SESSION_ID, sync.client), { wrapper });
    await advance(0);
    await advance(1_000);
    expect(sync.subscribe).not.toHaveBeenCalled();
    core.down = false;
    await advance(1_500);
    expect(sync.subscribe).not.toHaveBeenCalled();
    await advance(500);
    expect(sync.subscribe).toHaveBeenCalledTimes(1);
    await advance(60_000);
    expect(sync.subscribe).toHaveBeenCalledTimes(1);
  });

  it('Aushängen beendet die Wiederholung', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const sync = onlineClient();
    const { unmount } = renderHook(() => useMarkers(SESSION_ID, sync.client), { wrapper });
    await advance(0);
    unmount();
    core.down = false;
    await advance(60_000);
    expect(sync.subscribe).not.toHaveBeenCalled();
  });
});
