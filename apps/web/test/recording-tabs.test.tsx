// Mehrere Tabs (Plan #210, PR 3; VERTRAEGE §11.8): Auto-Stopp in jedem Tab, auf jeder Route, und genau ein Tab nimmt auf.
// Jeder „Tab“ ist ein eigener Baum mit eigenem QueryClient, eigenem Sync-Client, eigener Pegelquelle und eigener Uhr der
// Pegel; alle sprechen mit demselben Fake-Core.
import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '@sg/shared';
import type { AudioLevelListener } from '../src/lib/recorder/level.ts';
import { RecordingBar } from '../src/components/recording/RecordingBar.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { RecordingProvider, useClaimRecordingDisplay, useRecordingView } from '../src/lib/recording/index.ts';
import { resetMicIntent } from '../src/lib/recorder/index.ts';
import { extendSession, getSession, stopSession } from '../src/lib/sessions.ts';
import { SyncProvider } from '../src/lib/sync/SyncProvider.tsx';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { FakeWebLocks, fakeRecording, type FakeRecording, type SharedRunning } from './recording-fakes.ts';
import { installFakeCore, makeModule, makeSemester, makeSession, type FakeCore } from './fake-core.ts';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn() }),
}));

const DBS = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a3', name: 'Datenbanksysteme' });
const A_ID = '0190f6a2-0000-7000-8000-0000000000e1';
const NOW_ISO = '2026-11-04T08:42:13Z';
const NOW = Date.parse(NOW_ISO);

function session(overrides: Partial<Session> = {}): Session {
  return makeSession({
    id: A_ID,
    module_id: DBS.id,
    number: 7,
    state: 'laeuft',
    started_at: '2026-11-04T08:00:00Z',
    created_at: '2026-11-03T08:00:00Z',
    updated_at: '2026-11-04T08:00:00Z',
    ...overrides,
  });
}

/** 30 s vor der Maximaldauer (240 min): Die Rückfrage steht, der Stopp kommt gleich */
const NEAR_LIMIT = () => session({ started_at: '2026-11-04T04:42:43Z' });
/** Die Maximaldauer ist seit 42 min überschritten */
const OVER_LIMIT = () => session({ started_at: '2026-11-04T04:00:00Z' });

function fakeSync(state: string) {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const client = {
    connectionState: state,
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    onEvent: vi.fn((name: string, fn: (data: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(fn);
      listeners.set(name, set);
      return () => void set.delete(fn);
    }),
    takeOver: vi.fn(),
    listShelf: vi.fn(async () => []),
    subscribe: vi.fn(),
    devicePresence: vi.fn(() => null),
  };
  return {
    client: client as unknown as SyncClient,
    emit: (name: string, data: unknown) =>
      act(() => {
        for (const fn of listeners.get(name) ?? []) fn(data);
      }),
  };
}

function Probe() {
  const v = useRecordingView();
  return <p data-testid="kind">{v.kind}</p>;
}
/** Ein „Dashboard“, das die verfolgte Session zeigt */
function Dashboard() {
  const v = useRecordingView();
  useClaimRecordingDisplay(v.sessionId);
  return <p data-testid="dashboard">Dashboard</p>;
}

interface Tab {
  container: HTMLElement;
  sync: ReturnType<typeof fakeSync>;
  rec: FakeRecording;
  api: { stop: ReturnType<typeof vi.fn>; extend: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  /** Ein Pegelwert nur an die Auto-Stopp-Instanz dieses Tabs */
  level: (rms: number, at?: number) => void;
  kind: () => string | null;
  bar: () => HTMLElement | null;
  hint: () => HTMLElement | null;
  hintText: () => string;
}

let core: FakeCore;
const shared: SharedRunning = { running: new Set<object>(), maxRunning: 0 };
const locks = new FakeWebLocks();

function openTab(opts: { follower?: boolean; ui?: ReactNode } = {}): Tab {
  const sync = fakeSync(opts.follower ? 'other_tab' : 'online');
  const rec = fakeRecording({ shared, locks });
  const api = {
    stop: vi.fn(stopSession),
    extend: vi.fn(extendSession),
    get: vi.fn(getSession),
  };
  const listeners = new Set<AudioLevelListener>();
  const container = document.body.appendChild(document.createElement('div'));
  render(
    <ThemeProvider>
      <QueryProvider>
        <SyncProvider client={sync.client}>
          <RecordingProvider
            env={{
              ...rec.env,
              autoStop: {
                api,
                subscribeLevel: (fn) => {
                  listeners.add(fn);
                  return () => void listeners.delete(fn);
                },
              },
            }}
          >
            <Probe />
            {opts.ui}
            <RecordingBar />
          </RecordingProvider>
        </SyncProvider>
      </QueryProvider>
    </ThemeProvider>,
    { container },
  );
  const q = within(container);
  return {
    container,
    sync,
    rec,
    api,
    level: (rms, at = Date.now()) => {
      for (const fn of listeners) fn({ at, rms });
    },
    kind: () => q.getByTestId('kind').textContent,
    bar: () => q.queryByRole('complementary', { name: 'Aufnahme' }),
    hint: () => (q.queryByText(/Stoppt gleich/) ? q.getByTestId('autostop-hint') : null),
    hintText: () => q.getByTestId('autostop-hint').textContent ?? '',
  };
}

const stops = () =>
  core.requests.filter((r) => r.method === 'POST' && /^\/sessions\/[^/]+\/stop$/.test(r.path));
const gets = () => core.requests.filter((r) => r.method === 'GET' && /^\/sessions\/[^/?]+$/.test(r.path));
const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms));

function install(sessions: Session[]) {
  vi.setSystemTime(new Date(NOW_ISO));
  core = installFakeCore({ semesters: [makeSemester()], modules: [DBS], sessions });
  core.notebooks = [];
  core.devices = [];
  shared.running.clear();
  shared.maxRunning = 0;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  resetMicIntent();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Zwei Tabs: wer nimmt auf', () => {
  it('Tab A auf „Heute“ ist Leader und nimmt auf (REC in der Leiste); Tab B mit dem Dashboard zeigt „Aufnahme in anderem Tab“ (#210, Kommentar 2)', async () => {
    install([session()]);
    const a = openTab({ ui: <p>Heute</p> });
    const b = openTab({ follower: true, ui: <Dashboard /> });
    await waitFor(() => expect(a.bar()).toHaveAttribute('data-kind', 'rec'));
    await waitFor(() => expect(b.kind()).toBe('other-tab'));
    // Das Dashboard in B nimmt nichts auf und hat keine Leiste; die Leiste in A zeigt REC
    expect(b.bar()).toBeNull();
    expect(within(a.container).getByText('REC')).toBeInTheDocument();
    await settle(200);
    expect(a.rec.getUserMedia).toHaveBeenCalledTimes(1);
    expect(b.rec.getUserMedia).not.toHaveBeenCalled();
    expect(b.rec.mr.instances).toHaveLength(0);
    expect(shared.maxRunning).toBe(1);
    expect(locks.maxHeld).toBeLessThanOrEqual(1);
  });
});

describe('Auto-Stopp in mehreren Tabs (VERTRAEGE §9.4, §11.8)', () => {
  it('beide erreichen die Maximaldauer zugleich: die Session endet einmal, höchstens zwei Stopps, kein Fehler', async () => {
    install([OVER_LIMIT()]);
    const a = openTab();
    const b = openTab({ follower: true });
    await waitFor(
      () => expect(a.api.stop.mock.calls.length + b.api.stop.mock.calls.length).toBeGreaterThan(0),
      {
        timeout: 6000,
      },
    );
    // Beide Tabs lesen vor dem Stopp den frischen Stand
    await waitFor(() => expect(core.sessions[0]?.state).toBe('beendet'));
    expect(core.sessions[0]?.stop_reason).toBe('maximaldauer');
    await waitFor(() => expect(a.bar()).toBeNull());
    await waitFor(() => expect(b.bar()).toBeNull());
    expect(stops().length).toBeGreaterThanOrEqual(1);
    expect(stops().length).toBeLessThanOrEqual(2);
    expect(gets().length).toBeGreaterThanOrEqual(1);
    // Kein Fehlertext in einem der beiden Tabs
    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(a.container).queryByText(/hat nicht geklappt|Fehler/)).toBeNull();
    expect(within(b.container).queryByText(/hat nicht geklappt|Fehler/)).toBeNull();
    expect(a.kind()).toBe('inactive');
    expect(b.kind()).toBe('inactive');
  }, 20_000);

  it('Tab B verlängert, Tab A (Leader) bekommt session.updated: Hinweis weg, kein Stopp', async () => {
    const user = userEvent.setup();
    install([NEAR_LIMIT()]);
    const a = openTab();
    const b = openTab({ follower: true });
    await waitFor(() => expect(a.hint()).not.toBeNull(), { timeout: 6000 });
    await waitFor(() => expect(b.hint()).not.toBeNull(), { timeout: 6000 });

    await user.click(within(b.container).getByRole('button', { name: /Weiter aufnehmen/ }));
    await waitFor(() => expect(b.api.extend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(b.hint()).toBeNull());
    // Der Leader erfährt es über das Ereignis
    await a.sync.emit('session.updated', structuredClone(core.sessions[0]!));
    await waitFor(() => expect(a.hint()).toBeNull());

    // Die ursprüngliche Grenze ist vorbei: Es wird nicht gestoppt
    vi.setSystemTime(new Date(NOW + 2 * 60_000));
    await settle(1600);
    expect(stops()).toHaveLength(0);
    expect(a.api.stop).not.toHaveBeenCalled();
    expect(b.api.stop).not.toHaveBeenCalled();
    expect(core.sessions[0]?.state).toBe('laeuft');
    expect(a.bar()).toHaveAttribute('data-kind', 'rec');
  }, 20_000);

  it('Tab B verlängert, Tab C (Folge-Tab, alter Stand) erreicht die Grenze: GET /sessions/{id}, kein Stopp', async () => {
    const user = userEvent.setup();
    install([NEAR_LIMIT()]);
    const b = openTab({ follower: true });
    const c = openTab({ follower: true });
    await waitFor(() => expect(b.hint()).not.toBeNull(), { timeout: 6000 });
    await waitFor(() => expect(c.hint()).not.toBeNull(), { timeout: 6000 });

    await user.click(within(b.container).getByRole('button', { name: /Weiter aufnehmen/ }));
    await waitFor(() => expect(b.api.extend).toHaveBeenCalledTimes(1));
    // C weiß davon nichts (kein session.updated im Folge-Tab) und zeigt weiter die Rückfrage
    expect(c.hint()).not.toBeNull();
    expect(c.api.get).not.toHaveBeenCalled();

    // C erreicht mit seinem alten Stand die Grenze
    vi.setSystemTime(new Date(NOW + 40_000));
    await waitFor(() => expect(c.api.get).toHaveBeenCalled(), { timeout: 4000 });
    await settle(300);
    expect(gets().length).toBeGreaterThanOrEqual(1);
    expect(c.api.stop).not.toHaveBeenCalled();
    expect(b.api.stop).not.toHaveBeenCalled();
    expect(stops()).toHaveLength(0);
    expect(core.sessions[0]?.state).toBe('laeuft');
    // Der frische Stand räumt auch C auf: Die Rückfrage ist weg
    await waitFor(() => expect(c.hint()).toBeNull());
  }, 20_000);

  it('Stille: nur der Leader (mit Pegeln) zeigt die Rückfrage und stoppt mit „stille“; der Folge-Tab nie wegen Stille', async () => {
    install([session()]);
    const a = openTab();
    const b = openTab({ follower: true });
    await waitFor(() => expect(a.bar()).toHaveAttribute('data-kind', 'rec'));
    await waitFor(() => expect(b.kind()).toBe('other-tab'));
    // Settings und Controller sind bereit, bevor die Stille zählt
    await settle(1500);

    // 14,5 Minuten lückenlos leise (alle 2 s ein Wert, unter der Sprachschwelle), nur im Leader
    const quiet = 0.0005;
    const end = NOW + 14.5 * 60_000;
    for (let t = NOW; t <= end; t += 2000) {
      vi.setSystemTime(new Date(t));
      a.level(quiet, t);
    }
    await waitFor(() => expect(a.hint()).not.toBeNull(), { timeout: 4000 });
    // Der Folge-Tab bekommt nie einen Messwert: keine Stille, keine Rückfrage
    expect(b.hint()).toBeNull();

    // Die Stille erreicht 15 Minuten
    for (let t = end; t <= NOW + 15 * 60_000 + 4000; t += 2000) {
      vi.setSystemTime(new Date(t));
      a.level(quiet, t);
    }
    await waitFor(() => expect(a.api.stop).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(a.api.stop.mock.calls[0]?.[1]).toBe('stille');
    await waitFor(() => expect(core.sessions[0]?.state).toBe('beendet'));
    expect(core.sessions[0]?.stop_reason).toBe('stille');
    await settle(1500);
    expect(b.api.stop).not.toHaveBeenCalled();
    expect(stops()).toHaveLength(1);
  }, 30_000);

  it('die Rückfrage steht auf Heute genau einmal, in der Leiste', async () => {
    install([NEAR_LIMIT()]);
    const heute = openTab({ ui: <p>Heute</p> });
    await waitFor(() => expect(heute.hint()).not.toBeNull(), { timeout: 6000 });
    expect(within(heute.container).getAllByTestId('autostop-hint')).toHaveLength(1);
    expect(within(heute.bar()!).getAllByTestId('autostop-hint')).toHaveLength(1);
  }, 20_000);
});
