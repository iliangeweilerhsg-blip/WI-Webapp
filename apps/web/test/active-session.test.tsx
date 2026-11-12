// useActiveSession und applyActiveSession (Plan #210, PR 1; VERTRAEGE §11.8): Ereignis online, Abfrage ohne Live-Verbindung
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '@sg/shared';
import { QueryProvider } from '../src/lib/query.tsx';
import { ACTIVE_SESSION_KEY, applyActiveSession, useActiveSession } from '../src/lib/sessions.ts';
import { ModuleSessionButton } from '../src/components/today/SpontaneousStart.tsx';
import { SyncProvider } from '../src/lib/sync/SyncProvider.tsx';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { ToastProvider } from '../src/lib/toast.tsx';
import { installCalendarCore, type CalendarCore } from './calendar-core.ts';
import { makeModule, makeSemester, makeSession } from './fake-core.ts';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push }),
}));

const MOD = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a3', name: 'Datenbanksysteme' });
const A_ID = '0190f6a2-0000-7000-8000-0000000000a1';
const B_ID = '0190f6a2-0000-7000-8000-0000000000b2';
const T = (min: number) => new Date(Date.parse('2026-11-12T08:00:00Z') + min * 60_000).toISOString();

function session(id: string, overrides: Partial<Session> = {}): Session {
  return makeSession({
    id,
    module_id: MOD.id,
    state: 'laeuft',
    started_at: T(0),
    created_at: T(0),
    updated_at: T(0),
    ...overrides,
  });
}

/** Sync-Client mit steuerbaren Ereignissen und Verbindungszustand */
function fakeSync(state = 'online') {
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
  };
  return {
    client: client as unknown as SyncClient,
    emit: (name: string, data: unknown) =>
      act(() => {
        for (const fn of listeners.get(name) ?? []) fn(data);
      }),
    setState(next: string) {
      client.connectionState = next;
      act(() => {
        for (const fn of listeners.get('connection') ?? [])
          fn({ state: next, retryInMs: null, closeCode: null });
      });
    },
  };
}

function Probe() {
  const q = useActiveSession();
  return <p data-testid="active">{q.isPending ? 'lädt' : (q.data?.id ?? 'keine')}</p>;
}

let core: CalendarCore;
let sync: ReturnType<typeof fakeSync>;

function boot(state: string, sessions: Session[], ui: React.ReactNode = <Probe />) {
  core = installCalendarCore({ semesters: [makeSemester()], modules: [MOD], sessions });
  sync = fakeSync(state);
  return render(
    <QueryProvider>
      <ToastProvider>
        <SyncProvider client={sync.client}>{ui}</SyncProvider>
      </ToastProvider>
    </QueryProvider>,
  );
}

const activeGets = () =>
  core.requests.filter((r) => r.method === 'GET' && r.path.startsWith('/sessions?state='));
const shown = () => screen.getByTestId('active').textContent;
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  // Intervalle laufen auf der Fake-Uhr, sonst sähe der Test die Takte nie
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(T(0)));
  push.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useActiveSession: Abfrage nur ohne Live-Verbindung', () => {
  it('online: genau eine Abfrage beim Start, 90 s später keine weitere', async () => {
    boot('online', [session(A_ID)]);
    await waitFor(() => expect(shown()).toBe(A_ID));
    expect(activeGets()).toHaveLength(1);
    await advance(90_000);
    expect(activeGets()).toHaveLength(1);
  });

  it('backoff mit aktiver Session: Abfrage alle 10 s', async () => {
    boot('backoff', [session(A_ID)]);
    await waitFor(() => expect(shown()).toBe(A_ID));
    expect(activeGets()).toHaveLength(1);
    await advance(9_000);
    expect(activeGets()).toHaveLength(1);
    await advance(1_500);
    expect(activeGets()).toHaveLength(2);
    await advance(10_000);
    expect(activeGets()).toHaveLength(3);
  });

  it('backoff ohne aktive Session: Abfrage alle 30 s', async () => {
    boot('backoff', []);
    await waitFor(() => expect(shown()).toBe('keine'));
    expect(activeGets()).toHaveLength(1);
    await advance(20_000);
    expect(activeGets()).toHaveLength(1);
    await advance(10_500);
    expect(activeGets()).toHaveLength(2);
  });

  it('Wechsel connecting/backoff im 3-s-Takt: Es wird trotzdem nachgefragt (stabiler Wert)', async () => {
    boot('backoff', [session(A_ID)]);
    await waitFor(() => expect(shown()).toBe(A_ID));
    for (let i = 0; i < 4; i++) {
      await advance(3_000);
      sync.setState(i % 2 === 0 ? 'connecting' : 'backoff');
    }
    await advance(1_000); // 13 s
    expect(activeGets().length).toBeGreaterThanOrEqual(2);
  });

  it('der Wechsel nach online beendet die Abfrage', async () => {
    boot('backoff', [session(A_ID)]);
    await waitFor(() => expect(shown()).toBe(A_ID));
    sync.setState('online');
    const before = activeGets().length;
    await advance(60_000);
    expect(activeGets().length).toBeLessThanOrEqual(before + 1); // höchstens das Nachladen beim Wiederverbinden
  });

  it('leader.changed lädt neu', async () => {
    boot('online', [session(A_ID)]);
    await waitFor(() => expect(shown()).toBe(A_ID));
    await sync.emit('leader.changed', {});
    await waitFor(() => expect(activeGets()).toHaveLength(2));
  });
});

describe('useActiveSession: Ereignisse', () => {
  it('session.updated mit „beendet“ leert den Cache, eine ältere Fassung ändert nichts', async () => {
    boot('online', [session(A_ID, { updated_at: T(5) })]);
    await waitFor(() => expect(shown()).toBe(A_ID));
    await sync.emit('session.updated', session(A_ID, { state: 'beendet', updated_at: T(4) }));
    await advance(100);
    expect(shown()).toBe(A_ID);
    await sync.emit('session.updated', session(A_ID, { state: 'beendet', updated_at: T(6) }));
    await waitFor(() => expect(shown()).toBe('keine'));
  });

  it.each([
    ['A beendet zuerst', 'A-zuerst'],
    ['B läuft zuerst', 'B-zuerst'],
  ])('Start von B (%s): am Ende steht B', async (_label, order) => {
    boot('online', [session(A_ID, { updated_at: T(1) })]);
    await waitFor(() => expect(shown()).toBe(A_ID));
    const aEnded = session(A_ID, { state: 'beendet', ended_at: T(10), updated_at: T(10) });
    const bRuns = session(B_ID, { started_at: T(10), updated_at: T(10) });
    if (order === 'A-zuerst') {
      await sync.emit('session.updated', aEnded);
      await sync.emit('session.updated', bRuns);
    } else {
      await sync.emit('session.updated', bRuns);
      await sync.emit('session.updated', aEnded);
    }
    await waitFor(() => expect(shown()).toBe(B_ID));
    await advance(100);
    expect(shown()).toBe(B_ID);
  });
});

describe('applyActiveSession', () => {
  function primed(active: Session | null) {
    const client = new QueryClient();
    client.setQueryData<Session | null>(ACTIVE_SESSION_KEY, active);
    return client;
  }
  const cached = (client: QueryClient) => client.getQueryData<Session | null>(ACTIVE_SESSION_KEY);

  it('verspätete Antwort für A (laeuft, älter), während B im Cache steht: B bleibt', () => {
    const client = primed(session(B_ID, { updated_at: T(10) }));
    applyActiveSession(client, session(A_ID, { updated_at: T(2) }));
    expect(cached(client)?.id).toBe(B_ID);
  });

  it('eine aktive Fassung einer anderen Session mit neuerem updated_at ersetzt die bekannte', () => {
    const client = primed(session(A_ID, { updated_at: T(2) }));
    applyActiveSession(client, session(B_ID, { updated_at: T(10) }));
    expect(cached(client)?.id).toBe(B_ID);
  });

  it('eine nicht aktive Fassung einer anderen Session ändert nichts', () => {
    const client = primed(session(B_ID, { updated_at: T(10) }));
    applyActiveSession(client, session(A_ID, { state: 'beendet', updated_at: T(11) }));
    expect(cached(client)?.id).toBe(B_ID);
  });

  it('ohne bekannte Fassung (null) gilt die aktive', () => {
    const client = primed(null);
    applyActiveSession(client, session(A_ID));
    expect(cached(client)?.id).toBe(A_ID);
  });

  it('noch nicht geladen: nichts wird angelegt (der Abruf liefert den Stand)', () => {
    const client = new QueryClient();
    applyActiveSession(client, session(A_ID));
    expect(cached(client)).toBeUndefined();
  });
});

describe('Start auf der Modulseite (ohne onSession)', () => {
  it('der Cache kennt die neue Session sofort, auch in einem Folge-Tab', async () => {
    // Das Nachladen wird unterdrückt: Sichtbar wird die neue Session nur, wenn sie direkt im Cache steht
    vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: (ms) => void vi.advanceTimersByTime(ms) });
    boot('other_tab', [], <ModuleSessionButton moduleId={MOD.id} />);
    await user.click(await screen.findByRole('button', { name: 'Session starten' }));
    expect(await screen.findByRole('link', { name: 'Zur laufenden Session' })).toBeInTheDocument();
    expect(activeGets()).toHaveLength(1);
  });
});
