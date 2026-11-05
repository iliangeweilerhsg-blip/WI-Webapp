import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Vor allen Imports: Die Formatierer lesen die Zeitzone beim Laden
vi.hoisted(() => {
  process.env.TZ = 'Europe/Zurich';
});

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '@sg/shared';
import { AppShell } from '../src/components/AppShell.tsx';
import { HeuteView } from '../src/components/HeuteView.tsx';
import {
  buildEntries,
  cardState,
  formatElapsed,
  formatUntil,
  pickCardSession,
} from '../src/components/today/model.ts';
import { friendlyMessage } from '../src/lib/api.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { mergeSession, sessionHref, stopSession } from '../src/lib/sessions.ts';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { installCalendarCore, makeEvent, type CalendarCore } from './calendar-core.ts';
import { makeModule, makeSemester, makeSession } from './fake-core.ts';

const push = vi.fn();
const dashboard = vi.hoisted(() => ({ available: true }));
vi.mock('../src/lib/sessions.ts', async (original) => ({
  ...(await original<typeof import('../src/lib/sessions.ts')>()),
  isDashboardAvailable: () => dashboard.available,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push }),
}));

const DBS = makeModule({
  id: '0190f6a2-0000-7000-8000-0000000000a3',
  name: 'Datenbanksysteme',
  color: 'mod-03',
});
const STAT = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a4', name: 'Statistik', color: 'mod-05' });

// Mittwoch, 4. November 2026, Zürich = UTC+1. Vorlesung 08:15–09:45 Uhr = 07:15Z–08:45Z.
const EVENT_DBS = makeEvent({
  id: '0190f6a2-0000-7000-8000-0000000000f1',
  module_id: DBS.id,
  title: 'DBS Vorlesung',
  location: 'H 012',
  starts_at: '2026-11-04T07:15:00Z',
  ends_at: '2026-11-04T08:45:00Z',
  session_id: '0190f6a2-0000-7000-8000-0000000000e1',
});
const EVENT_STAT = makeEvent({
  id: '0190f6a2-0000-7000-8000-0000000000f2',
  module_id: STAT.id,
  title: 'Statistik Übung',
  kind: 'uebung',
  location: 'S 3',
  starts_at: '2026-11-04T09:15:00Z',
  ends_at: '2026-11-04T10:45:00Z',
  session_id: '0190f6a2-0000-7000-8000-0000000000e2',
});

const SESSION_ID = '0190f6a2-0000-7000-8000-0000000000e1';
function planned(overrides: Partial<Session> = {}): Session {
  return makeSession({
    id: SESSION_ID,
    module_id: DBS.id,
    calendar_event_id: EVENT_DBS.id,
    number: 7,
    state: 'bereit',
    started_at: null,
    planned_starts_at: EVENT_DBS.starts_at,
    planned_ends_at: EVENT_DBS.ends_at,
    created_at: '2026-11-03T08:00:00Z',
    updated_at: '2026-11-04T07:00:00Z',
    ...overrides,
  });
}
const SECOND = makeSession({
  id: '0190f6a2-0000-7000-8000-0000000000e2',
  module_id: STAT.id,
  calendar_event_id: EVENT_STAT.id,
  number: null,
  state: 'geplant',
  started_at: null,
  planned_starts_at: EVENT_STAT.starts_at,
  planned_ends_at: EVENT_STAT.ends_at,
  created_at: '2026-11-03T08:00:00Z',
  updated_at: '2026-11-04T06:00:00Z',
});

/** Sync-Client mit steuerbaren Ereignissen */
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
    emit: (name: string, data: unknown) => {
      for (const fn of listeners.get(name) ?? []) fn(data);
    },
    setState(next: string) {
      client.connectionState = next;
      for (const fn of listeners.get('connection') ?? [])
        fn({ state: next, retryInMs: null, closeCode: null });
    },
  };
}

function setNow(iso: string) {
  vi.setSystemTime(new Date(iso));
}

let core: CalendarCore;
let sync: ReturnType<typeof fakeSync>;

function boot(
  opts: { sessions?: Session[]; events?: (typeof EVENT_DBS)[]; now?: string; syncState?: string } = {},
) {
  setNow(opts.now ?? '2026-11-04T07:10:00Z'); // 08:10 Uhr
  core = installCalendarCore({
    semesters: [makeSemester()],
    modules: [DBS, STAT],
    sessions: opts.sessions ?? [planned(), SECOND],
    events: opts.events ?? [EVENT_DBS, EVENT_STAT],
  });
  sync = fakeSync(opts.syncState);
  return render(
    <ThemeProvider>
      <QueryProvider>
        <AppShell syncClient={sync.client}>
          <HeuteView />
        </AppShell>
      </QueryProvider>
    </ThemeProvider>,
  );
}

const card = () => screen.getByRole('region', { name: /Datenbanksysteme/ });
const calls = (path: RegExp) => core.requests.filter((r) => r.method === 'POST' && path.test(r.path));

beforeEach(() => {
  dashboard.available = true;
  vi.useFakeTimers({ toFake: ['Date'] });
  push.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Heute: Start-Karte nach Zustand', () => {
  it('bevorstehend: ruhige Karte, „Früher starten“ statt Start', async () => {
    boot({ now: '2026-11-04T06:30:00Z', sessions: [planned({ state: 'geplant' }), SECOND] }); // 07:30, Beginn in 45 min
    const c = await screen.findByRole('region', { name: /Datenbanksysteme/ });
    expect(c).toHaveAttribute('data-state', 'bevorstehend');
    expect(within(c).getByText('Datenbanksysteme · VL 7')).toBeInTheDocument();
    expect(within(c).getByText('08:15–09:45 · H 012')).toBeInTheDocument();
    expect(within(c).getByText(/in 45 min/)).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Früher starten' })).toBeInTheDocument();
    expect(within(c).queryByRole('button', { name: /Jetzt starten/ })).toBeNull();
  });

  it('bereit vor dem Beginn: „Start“; nach dem Beginn: „Jetzt starten“', async () => {
    const { unmount } = boot({ now: '2026-11-04T07:10:00Z' }); // 08:10
    expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(card()).toHaveAttribute('data-state', 'bereit');
    unmount();
    boot({ now: '2026-11-04T07:20:00Z' }); // 08:20
    expect(await screen.findByRole('button', { name: 'Jetzt starten' })).toBeInTheDocument();
  });

  it('laufend: Dauer, Pause, Stopp und Link zum Dashboard', async () => {
    boot({
      now: '2026-11-04T07:20:00Z',
      sessions: [planned({ state: 'laeuft', started_at: '2026-11-04T07:15:00Z' }), SECOND],
    });
    const c = await screen.findByRole('region', { name: /Datenbanksysteme/ });
    expect(c).toHaveAttribute('data-state', 'laeuft');
    expect(await within(c).findByText('00:05:00')).toBeInTheDocument();
    expect(within(c).getByText(/Seit 08:15 Uhr/)).toBeInTheDocument();
    expect(within(c).getByRole('link', { name: 'Zur Vorlesung' })).toHaveAttribute(
      'href',
      sessionHref(SESSION_ID),
    );
    expect(within(c).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Beenden' })).toBeInTheDocument();
  });

  it('pausiert: „Fortsetzen“, keine laufende Dauer', async () => {
    boot({
      now: '2026-11-04T07:20:00Z',
      sessions: [planned({ state: 'pausiert', started_at: '2026-11-04T07:15:00Z' })],
    });
    const c = await screen.findByRole('region', { name: /Datenbanksysteme/ });
    expect(c).toHaveAttribute('data-state', 'pausiert');
    expect(within(c).getByRole('button', { name: 'Fortsetzen' })).toBeInTheDocument();
    expect(within(c).queryByText(/\d\d:\d\d:\d\d/)).toBeNull();
  });

  it('verpasst: sachlicher Text, kein Start, kein Rot', async () => {
    boot({ now: '2026-11-04T08:50:00Z', sessions: [planned()] }); // 09:50, Termin vorbei
    const c = await screen.findByRole('region', { name: /Datenbanksysteme/ });
    expect(c).toHaveAttribute('data-state', 'verpasst');
    expect(within(c).getByText('Nicht aufgenommen')).toBeInTheDocument();
    expect(within(c).getByText(/ohne dass aufgenommen wurde/)).toBeInTheDocument();
    expect(within(c).queryByRole('button')).toBeNull();
    expect(c.innerHTML).not.toMatch(/text-danger|bg-record/);
  });

  it('beendet und verarbeitet: Zustand und Link zum Modul', async () => {
    const ended = planned({
      state: 'beendet',
      started_at: '2026-11-04T07:15:00Z',
      ended_at: '2026-11-04T08:45:00Z',
      stop_reason: 'manuell',
    });
    const { unmount } = boot({ now: '2026-11-04T08:50:00Z', sessions: [ended] });
    let c = await screen.findByRole('region', { name: /Datenbanksysteme/ });
    expect(c).toHaveAttribute('data-state', 'beendet');
    expect(within(c).getByRole('link', { name: 'Zum Modul' })).toHaveAttribute('href', `/modul?id=${DBS.id}`);
    unmount();
    boot({ now: '2026-11-04T08:50:00Z', sessions: [{ ...ended, state: 'verarbeitet' }] });
    c = await screen.findByRole('region', { name: /Datenbanksysteme/ });
    expect(c).toHaveAttribute('data-state', 'verarbeitet');
    expect(within(c).getByText('Alles ist verarbeitet.')).toBeInTheDocument();
  });

  it('eine laufende Session vom Vortag bleibt die Karte', async () => {
    boot({
      now: '2026-11-04T07:20:00Z',
      sessions: [
        makeSession({
          id: '0190f6a2-0000-7000-8000-0000000000e9',
          module_id: STAT.id,
          state: 'laeuft',
          started_at: '2026-11-03T22:30:00Z',
          created_at: '2026-11-03T22:29:00Z',
          title: 'Lerngruppe',
        }),
        planned(),
      ],
    });
    const c = await screen.findByRole('region', { name: /Statistik/ });
    expect(c).toHaveAttribute('data-state', 'laeuft');
  });
});

describe('Heute: Tagesliste', () => {
  it('zeigt Termine mit Modul, Zeit und Raum', async () => {
    boot();
    const list = await screen.findByRole('region', { name: 'Heute' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('08:15')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Datenbanksysteme · VL 7')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('H 012')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Statistik · Übung')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('S 3')).toBeInTheDocument();
  });

  it('leerer Tag: ein Satz und eine Aktion', async () => {
    boot({ sessions: [], events: [] });
    expect(await screen.findByText(/Heute steht nichts an/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zum Kalender' })).toHaveAttribute('href', '/kalender');
    expect(screen.queryByRole('region', { name: /Datenbanksysteme/ })).toBeNull();
  });

  it('Termine von morgen und abgesagte Termine fehlen', async () => {
    const tomorrow = makeEvent({
      module_id: DBS.id,
      title: 'Morgen',
      starts_at: '2026-11-05T07:15:00Z',
      ends_at: '2026-11-05T08:45:00Z',
    });
    const cancelled = makeEvent({
      module_id: DBS.id,
      title: 'Abgesagt',
      cancelled: true,
      starts_at: '2026-11-04T12:00:00Z',
      ends_at: '2026-11-04T13:00:00Z',
    });
    boot({ sessions: [], events: [tomorrow, cancelled] });
    expect(await screen.findByText(/Heute steht nichts an/)).toBeInTheDocument();
    expect(screen.queryByText('Abgesagt')).toBeNull();
  });

  it('spontane Session ohne Termin steht in der Liste', async () => {
    boot({
      sessions: [
        makeSession({
          id: '0190f6a2-0000-7000-8000-0000000000e8',
          module_id: DBS.id,
          state: 'bereit',
          started_at: null,
          title: 'Lerngruppe',
          created_at: '2026-11-04T06:00:00Z',
          updated_at: '2026-11-04T06:00:00Z',
        }),
      ],
      events: [],
    });
    const c = await screen.findByRole('region', { name: /Datenbanksysteme/ });
    expect(within(c).getByText('Spontane Session')).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Jetzt starten' })).toBeInTheDocument();
  });
});

describe('Heute: Aktionen', () => {
  it('Start: POST mit started_from, Karte läuft, Weiterleitung zum Dashboard', async () => {
    const user = userEvent.setup();
    boot();
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(sessionHref(SESSION_ID)));
    expect(calls(/\/sessions\/[^/]+\/start$/)).toHaveLength(1);
    expect(calls(/\/start$/)[0]!.body).toEqual({ started_from: 'mac' });
    expect(core.sessions.find((s) => s.id === SESSION_ID)?.state).toBe('laeuft');
    expect(await screen.findByRole('link', { name: 'Zur Vorlesung' })).toBeInTheDocument();
  });

  it('Start ohne Dashboard-Route: keine Weiterleitung, Karte zeigt läuft mit Link', async () => {
    dashboard.available = false;
    const user = userEvent.setup();
    boot();
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('link', { name: 'Zur Vorlesung' })).toHaveAttribute(
      'href',
      sessionHref(SESSION_ID),
    );
    expect(card()).toHaveAttribute('data-state', 'laeuft');
    expect(push).not.toHaveBeenCalled();
  });

  it('Beenden steht abgesetzt von Pause', async () => {
    boot({
      now: '2026-11-04T07:20:00Z',
      sessions: [planned({ state: 'laeuft', started_at: '2026-11-04T07:15:00Z' })],
    });
    expect(await screen.findByRole('button', { name: 'Beenden' })).toHaveClass('ml-4');
    expect(screen.queryByRole('button', { name: 'Stopp' })).toBeNull();
  });

  it('Start beendet eine inzwischen laufende andere Session und sagt das ruhig', async () => {
    const user = userEvent.setup();
    boot({ sessions: [planned()], events: [EVENT_DBS] });
    const start = await screen.findByRole('button', { name: 'Start' });
    // Auf einem anderen Gerät läuft inzwischen eine Session (Ereignis noch nicht angekommen)
    core.sessions.push(
      makeSession({
        id: '0190f6a2-0000-7000-8000-0000000000e7',
        module_id: STAT.id,
        state: 'laeuft',
        started_at: '2026-11-04T07:05:00Z',
        updated_at: '2026-11-04T07:05:00Z',
      }),
    );
    await user.click(start);
    await waitFor(() => expect(push).toHaveBeenCalledWith(sessionHref(SESSION_ID)));
    expect(core.sessions.find((s) => s.id === '0190f6a2-0000-7000-8000-0000000000e7')?.state).toBe('beendet');
    expect(await screen.findByText('Die vorherige Session wurde beendet.')).toBeInTheDocument();
  });

  it('Pause, Fortsetzen und Stopp wechseln den Zustand', async () => {
    const user = userEvent.setup();
    boot({
      now: '2026-11-04T07:20:00Z',
      sessions: [planned({ state: 'laeuft', started_at: '2026-11-04T07:15:00Z' })],
    });
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('button', { name: 'Fortsetzen' })).toBeInTheDocument();
    expect(card()).toHaveAttribute('data-state', 'pausiert');
    await user.click(screen.getByRole('button', { name: 'Fortsetzen' }));
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Beenden' }));
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'beendet'));
    expect(calls(/pause$/)).toHaveLength(1);
    expect(calls(/resume$/)).toHaveLength(1);
    expect(calls(/stop$/)).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('session_transition_invalid: deutscher Text, Ansicht wird aufgefrischt', async () => {
    const user = userEvent.setup();
    boot();
    const start = await screen.findByRole('button', { name: 'Start' });
    core.rejectNextSession = { status: 409, code: 'session_transition_invalid' };
    const before = core.requests.filter((r) => r.path.startsWith('/sessions?')).length;
    await user.click(start);
    expect(await screen.findByRole('alert')).toHaveTextContent('Das geht bei dieser Session gerade nicht.');
    await waitFor(() =>
      expect(core.requests.filter((r) => r.path.startsWith('/sessions?')).length).toBeGreaterThan(before),
    );
    expect(push).not.toHaveBeenCalled();
    // Der Knopf ist wieder bedienbar
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
  });

  it('session_not_found und nicht erreichbarer Core', async () => {
    const user = userEvent.setup();
    boot();
    const start = await screen.findByRole('button', { name: 'Start' });
    core.rejectNextSession = { status: 404, code: 'session_not_found' };
    await user.click(start);
    expect(await screen.findByRole('alert')).toHaveTextContent('Diese Session gibt es nicht mehr.');
    core.down = true;
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Core nicht erreichbar'));
  });

  it('der Knopf sperrt sich während der Anfrage (kein Doppelstart)', async () => {
    const user = userEvent.setup();
    boot();
    const start = await screen.findByRole('button', { name: 'Start' });
    let release: () => void = () => undefined;
    core.postGate = new Promise<void>((resolve) => (release = resolve));
    await user.click(start);
    expect(await screen.findByRole('button', { name: 'Startet …' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Startet …' }));
    release();
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(calls(/start$/)).toHaveLength(1);
  });
});

describe('Heute: session.updated', () => {
  it('übernimmt neuere Fassungen live', async () => {
    boot({ now: '2026-11-04T07:20:00Z' });
    await screen.findByRole('button', { name: 'Jetzt starten' });
    act(() =>
      sync.emit(
        'session.updated',
        planned({ state: 'laeuft', started_at: '2026-11-04T07:19:00Z', updated_at: '2026-11-04T07:19:00Z' }),
      ),
    );
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'laeuft'));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('ignoriert ältere Fassungen nach updated_at', async () => {
    boot({
      now: '2026-11-04T07:20:00Z',
      sessions: [
        planned({ state: 'laeuft', started_at: '2026-11-04T07:15:00Z', updated_at: '2026-11-04T07:18:00Z' }),
      ],
    });
    await screen.findByRole('button', { name: 'Pause' });
    act(() => sync.emit('session.updated', planned({ state: 'bereit', updated_at: '2026-11-04T07:00:00Z' })));
    // kurz warten, dann muss die Karte unverändert laufen
    await act(async () => undefined);
    expect(card()).toHaveAttribute('data-state', 'laeuft');
    // eine neuere gewinnt
    act(() =>
      sync.emit(
        'session.updated',
        planned({
          state: 'pausiert',
          started_at: '2026-11-04T07:15:00Z',
          updated_at: '2026-11-04T07:19:00Z',
        }),
      ),
    );
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'pausiert'));
    act(() =>
      sync.emit(
        'session.updated',
        planned({ state: 'laeuft', started_at: '2026-11-04T07:15:00Z', updated_at: '2026-11-04T07:18:30Z' }),
      ),
    );
    await act(async () => undefined);
    expect(card()).toHaveAttribute('data-state', 'pausiert');
  });

  it('eine Antwort der Aktion wird von einem älteren Ereignis nicht überschrieben', async () => {
    const user = userEvent.setup();
    boot({
      now: '2026-11-04T07:20:00Z',
      sessions: [
        planned({ state: 'laeuft', started_at: '2026-11-04T07:15:00Z', updated_at: '2026-11-04T07:16:00Z' }),
      ],
    });
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    await screen.findByRole('button', { name: 'Fortsetzen' });
    act(() =>
      sync.emit(
        'session.updated',
        planned({ state: 'laeuft', started_at: '2026-11-04T07:15:00Z', updated_at: '2026-11-04T07:16:00Z' }),
      ),
    );
    await act(async () => undefined);
    expect(card()).toHaveAttribute('data-state', 'pausiert');
  });

  it('eine neue Session des Tages erscheint, eine von morgen nicht, eine gelöschte verschwindet', async () => {
    boot({ sessions: [planned()], events: [EVENT_DBS] });
    await screen.findByRole('region', { name: /Datenbanksysteme/ });
    const spontaneous = makeSession({
      id: '0190f6a2-0000-7000-8000-0000000000d7',
      module_id: STAT.id,
      state: 'bereit',
      started_at: null,
      title: 'Lerngruppe',
      created_at: '2026-11-04T07:09:00Z',
      updated_at: '2026-11-04T07:09:00Z',
    });
    act(() => sync.emit('session.updated', spontaneous));
    const list = await screen.findByRole('region', { name: 'Heute' });
    expect(await within(list).findByText('Statistik · Lerngruppe')).toBeInTheDocument();
    act(() =>
      sync.emit('session.updated', {
        ...spontaneous,
        id: '0190f6a2-0000-7000-8000-0000000000d8',
        title: 'Morgen',
        state: 'geplant',
        planned_starts_at: '2026-11-05T07:15:00Z',
        planned_ends_at: '2026-11-05T08:45:00Z',
      }),
    );
    await act(async () => undefined);
    expect(screen.queryByText(/Morgen/)).toBeNull();
    act(() =>
      sync.emit('session.updated', {
        ...spontaneous,
        deleted_at: '2026-11-04T07:10:00Z',
        updated_at: '2026-11-04T07:10:00Z',
      }),
    );
    await waitFor(() => expect(screen.queryAllByText('Statistik · Lerngruppe')).toHaveLength(0));
  });

  it('ein Ereignis vor dem ersten Abruf geht nicht verloren', async () => {
    boot({ now: '2026-11-04T07:20:00Z' });
    // Sofort nach dem Rendern: Die Liste lädt noch, der Sync-Client liefert schon
    act(() =>
      sync.emit(
        'session.updated',
        planned({ state: 'laeuft', started_at: '2026-11-04T07:19:00Z', updated_at: '2026-11-04T07:19:00Z' }),
      ),
    );
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'laeuft'));
  });
});

describe('Heute: ohne Verbindung', () => {
  it('Live-Verbindung weg: letzter Stand bleibt, ruhiger Hinweis', async () => {
    boot();
    await screen.findByRole('button', { name: 'Start' });
    expect(screen.queryByText(/Keine Live-Verbindung/)).toBeNull();
    act(() => sync.setState('backoff'));
    expect(
      await screen.findByText(/Keine Live-Verbindung\. Du siehst den Stand von \d\d:\d\d Uhr/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(card()).toBeInTheDocument();
  });

  it('nach dem Wiederverbinden wird neu geladen und der Hinweis verschwindet', async () => {
    boot();
    await screen.findByRole('button', { name: 'Start' });
    act(() => sync.setState('backoff'));
    await screen.findByText(/Keine Live-Verbindung/);
    const before = core.requests.filter((r) => r.path.startsWith('/sessions?')).length;
    // Während der Unterbrechung hat sich etwas geändert (Ereignisse werden nicht nachgeliefert)
    const stored = core.sessions.find((s) => s.id === SESSION_ID)!;
    stored.state = 'laeuft';
    stored.started_at = '2026-11-04T07:10:00Z';
    stored.updated_at = '2026-11-04T07:10:00Z';
    act(() => sync.setState('online'));
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'laeuft'));
    expect(core.requests.filter((r) => r.path.startsWith('/sessions?')).length).toBeGreaterThan(before);
    expect(screen.queryByText(/Keine Live-Verbindung/)).toBeNull();
  });

  it('Start mit anfangs fehlender Verbindung lädt nach dem Verbinden neu', async () => {
    boot({ syncState: 'connecting' });
    await screen.findByRole('button', { name: 'Start' });
    const before = core.requests.filter((r) => r.path.startsWith('/sessions?')).length;
    act(() => sync.setState('online'));
    await waitFor(() =>
      expect(core.requests.filter((r) => r.path.startsWith('/sessions?')).length).toBeGreaterThan(before),
    );
  });

  it('Core aus beim Öffnen: Core-Hinweis statt Absturz', async () => {
    setNow('2026-11-04T07:10:00Z');
    core = installCalendarCore({ semesters: [makeSemester()], modules: [DBS], down: true });
    sync = fakeSync();
    render(
      <ThemeProvider>
        <QueryProvider>
          <AppShell syncClient={sync.client}>
            <HeuteView />
          </AppShell>
        </QueryProvider>
      </ThemeProvider>,
    );
    expect((await screen.findAllByText('Core nicht erreichbar')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', { name: /Datenbanksysteme/ })).toBeNull();
  });

  it('Core fällt später aus: der letzte Stand bleibt mit Hinweis', async () => {
    const user = userEvent.setup();
    boot({
      now: '2026-11-04T07:20:00Z',
      sessions: [planned({ state: 'laeuft', started_at: '2026-11-04T07:15:00Z' })],
    });
    await screen.findByRole('button', { name: 'Pause' });
    core.down = true;
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Core nicht erreichbar'));
    expect(card()).toHaveAttribute('data-state', 'laeuft');
  });
});

describe('Heute: Zugänglichkeit', () => {
  it('Überschriften, benannte Bereiche und Statusmeldung', async () => {
    boot();
    const c = await screen.findByRole('region', { name: /Datenbanksysteme/ });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Mittwoch, 4\. November/);
    expect(within(c).getByRole('heading', { level: 2, name: /Datenbanksysteme/ })).toBeInTheDocument();
    expect(within(c).getByRole('status')).toHaveTextContent('Die Session ist bereit zum Start.');
    for (const button of within(c).getAllByRole('button')) expect(button).toHaveAccessibleName();
  });
});

// ---------------------------------------------------------------------------------------------
// Reine Logik
// ---------------------------------------------------------------------------------------------

describe('model', () => {
  const t = (iso: string) => Date.parse(iso);

  it('cardState leitet verpasst aus dem Terminende ab', () => {
    expect(cardState(planned(), t('2026-11-04T07:00:00Z'))).toBe('bereit');
    expect(cardState(planned({ state: 'geplant' }), t('2026-11-04T07:00:00Z'))).toBe('bevorstehend');
    expect(cardState(planned(), t('2026-11-04T08:45:00Z'))).toBe('verpasst');
    expect(cardState(planned({ state: 'laeuft' }), t('2026-11-04T09:45:00Z'))).toBe('laeuft');
    // spontan: nie verpasst
    expect(
      cardState(planned({ planned_ends_at: null, planned_starts_at: null }), t('2027-01-01T00:00:00Z')),
    ).toBe('bereit');
  });

  it('pickCardSession: aktive vor bereiten vor vergangenen', () => {
    const now = t('2026-11-04T07:10:00Z');
    const done = planned({
      id: 'd',
      state: 'beendet',
      ended_at: '2026-11-04T06:00:00Z',
      planned_ends_at: '2026-11-04T06:00:00Z',
    });
    expect(pickCardSession([], now)).toBeNull();
    expect(pickCardSession([done], now)?.id).toBe('d');
    expect(pickCardSession([done, SECOND, planned()], now)?.id).toBe(SESSION_ID);
    const running = planned({ id: 'r', state: 'laeuft', started_at: '2026-11-04T07:00:00Z' });
    expect(pickCardSession([done, planned(), running], now)?.id).toBe('r');
  });

  it('buildEntries verknüpft Termin und Session, sortiert, lässt Abgesagtes weg', () => {
    const cancelled = makeEvent({
      cancelled: true,
      starts_at: '2026-11-04T05:00:00Z',
      ends_at: '2026-11-04T06:00:00Z',
    });
    const entries = buildEntries([EVENT_STAT, cancelled, EVENT_DBS], [SECOND, planned()], [DBS, STAT]);
    expect(entries.map((e) => e.label)).toEqual(['Datenbanksysteme · VL 7', 'Statistik · Übung']);
    expect(entries[0]!.room).toBe('H 012');
  });

  it('Zeitformate', () => {
    expect(formatElapsed(42 * 60_000 + 13_000)).toBe('00:42:13');
    expect(formatElapsed(-5)).toBe('00:00:00');
    expect(formatUntil(30_000)).toBe('in 1 min');
    expect(formatUntil(125 * 60_000)).toBe('in 2 h 5 min');
    expect(formatUntil(120 * 60_000)).toBe('in 2 h');
  });
});

describe('mergeSession', () => {
  const range = { from: new Date('2026-11-03T23:00:00Z'), to: new Date('2026-11-04T23:00:00Z') };

  it('ältere Fassung: dieselbe Liste', () => {
    const list = [planned({ updated_at: '2026-11-04T07:10:00Z' })];
    expect(mergeSession(list, planned({ updated_at: '2026-11-04T07:09:00Z', state: 'laeuft' }), range)).toBe(
      list,
    );
  });

  it('gleiches updated_at und neuere ersetzen', () => {
    const list = [planned()];
    expect(mergeSession(list, planned({ state: 'laeuft' }), range)[0]!.state).toBe('laeuft');
  });

  it('unbekannte Session: nur aktiv oder im Zeitraum', () => {
    const other = planned({ id: 'x' });
    expect(mergeSession([], other, range)).toHaveLength(1);
    const tomorrow = planned({ id: 'y', planned_starts_at: '2026-11-06T07:00:00Z' });
    expect(mergeSession([], tomorrow, range)).toHaveLength(0);
    expect(
      mergeSession([], { ...tomorrow, state: 'laeuft', started_at: '2026-11-03T20:00:00Z' }, range),
    ).toHaveLength(1);
  });

  it('gelöscht: entfernt', () => {
    expect(
      mergeSession(
        [planned()],
        planned({ deleted_at: '2026-11-04T08:00:00Z', updated_at: '2026-11-04T08:00:00Z' }),
        range,
      ),
    ).toHaveLength(0);
  });
});

describe('friendlyMessage (Sessions)', () => {
  async function failWith(code: string, status: number) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { code, message: 'x' } }), { status })),
    );
    return friendlyMessage(await stopSession(SESSION_ID).catch((e: unknown) => e));
  }

  it('übersetzt die Fehlercodes der Sessions', async () => {
    expect(await failWith('session_transition_invalid', 409)).toMatch(/gerade nicht/);
    expect(await failWith('session_not_active', 409)).toMatch(/läuft nicht mehr/);
    expect(await failWith('session_not_found', 404)).toMatch(/gibt es nicht mehr/);
    expect(await failWith('session_active', 409)).toMatch(/Beende sie zuerst/);
    expect(await failWith('session_exists', 409)).toMatch(/schon eine Session/);
    expect(friendlyMessage(new Error('x'))).toBe('Das hat nicht geklappt.');
  });
});
