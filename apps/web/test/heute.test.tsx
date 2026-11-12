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
  pickCard,
  pickCardSession,
} from '../src/components/today/model.ts';
import { friendlyMessage } from '../src/lib/api.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { mergeSession, sessionHref, stopSession } from '../src/lib/sessions.ts';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { installCalendarCore, makeEvent, type CalendarCore } from './calendar-core.ts';
import { fakeRecording } from './recording-fakes.ts';
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
        <AppShell syncClient={sync.client} recordingEnv={fakeRecording().env}>
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

  it('laufend im Leader-Tab: ehrlich „ohne Aufnahme“, hohler Punkt, Hinweis auf die Vorlesungs-Ansicht (UX-01)', async () => {
    boot({
      now: '2026-11-04T07:20:00Z',
      sessions: [planned({ state: 'laeuft', started_at: '2026-11-04T07:15:00Z' })],
    });
    const c = await screen.findByRole('region', { name: /Datenbanksysteme/ });
    expect(within(c).getByText('Läuft · ohne Aufnahme')).toBeInTheDocument();
    expect(within(c).getByText(/Die Aufnahme läuft nur in der Vorlesungs-Ansicht\./)).toBeInTheDocument();
    expect(within(c).getByRole('status')).toHaveTextContent(/hier wird nicht aufgenommen/);
    expect(c.innerHTML).not.toMatch(/bg-record/);
    expect(c.querySelector('.border-text-muted.rounded-full')).not.toBeNull();
    expect(within(c).getByRole('link', { name: 'Zur Vorlesung' })).toBeInTheDocument();
  });

  it('laufend im Folge-Tab: „Läuft · anderer Tab“, ohne Aufnahme-Zusage (UX-01)', async () => {
    boot({
      now: '2026-11-04T07:20:00Z',
      syncState: 'other_tab',
      sessions: [planned({ state: 'laeuft', started_at: '2026-11-04T07:15:00Z' })],
    });
    const c = await screen.findByRole('region', { name: /Datenbanksysteme/ });
    expect(await within(c).findByText('Läuft · anderer Tab')).toBeInTheDocument();
    expect(within(c).queryByText('Läuft · ohne Aufnahme')).toBeNull();
    expect(within(c).queryByText(/Die Aufnahme läuft nur in der Vorlesungs-Ansicht/)).toBeNull();
    expect(within(c).getByRole('status')).toHaveTextContent(/anderer Tab/);
    expect(within(c).getByRole('link', { name: 'Zur Vorlesung' })).toBeInTheDocument();
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
    // UX-18: Weg für den Fall, dass die Veranstaltung noch läuft
    expect(
      within(c).getByText(
        'Der Termin ist vorbei, ohne dass aufgenommen wurde. Läuft die Veranstaltung noch? Dann starte unten eine Session ohne Termin.',
      ),
    ).toBeInTheDocument();
    expect(within(c).getByRole('link', { name: 'Session ohne Termin' })).toHaveAttribute(
      'href',
      '#spontan-title',
    );
    expect(document.getElementById('spontan-title')).not.toBeNull();
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
    expect(within(c).getByRole('link', { name: 'Rückblick' })).toHaveAttribute(
      'href',
      `/rueckblick?id=${ended.id}`,
    );
    unmount();
    boot({ now: '2026-11-04T08:50:00Z', sessions: [{ ...ended, state: 'verarbeitet' }] });
    c = await screen.findByRole('region', { name: /Datenbanksysteme/ });
    expect(c).toHaveAttribute('data-state', 'verarbeitet');
    expect(within(c).getByText('Alles ist verarbeitet.')).toBeInTheDocument();
    expect(within(c).getByRole('link', { name: 'Rückblick' })).toBeInTheDocument();
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
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'laeuft'));
    // Kein Link ins 404: nur Pause und Beenden, der Fokus geht auf die Überschrift der Karte
    expect(screen.queryByRole('link', { name: 'Zur Vorlesung' })).toBeNull();
    expect(within(card()).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: 'Beenden' })).toBeInTheDocument();
    expect(within(card()).getByText(/Seit 08:10 Uhr/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(within(card()).getByRole('heading', { level: 2 })).toHaveFocus());
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
    await user.click(await screen.findByRole('button', { name: 'Session beenden' }));
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'beendet'));
    expect(calls(/pause$/)).toHaveLength(1);
    expect(calls(/resume$/)).toHaveLength(1);
    expect(calls(/stop$/)).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Beenden fragt nach (UX-06): „Weiterlaufen lassen“ beendet nichts, „Session beenden“ beendet', async () => {
    const user = userEvent.setup();
    boot({
      now: '2026-11-04T07:20:00Z',
      sessions: [planned({ state: 'laeuft', started_at: '2026-11-04T07:15:00Z' })],
    });
    await user.click(await screen.findByRole('button', { name: 'Beenden' }));
    expect(within(card()).getByRole('alertdialog')).toHaveTextContent('Session beenden?');
    expect(calls(/stop$/)).toHaveLength(0);
    // Heute nimmt nicht auf: Die Antwort verspricht keine Aufnahme
    expect(within(card()).queryByRole('button', { name: 'Weiter aufnehmen' })).toBeNull();
    expect(within(card()).getByRole('button', { name: 'Weiterlaufen lassen' })).toHaveFocus();
    await user.click(within(card()).getByRole('button', { name: 'Weiterlaufen lassen' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(calls(/stop$/)).toHaveLength(0);
    expect(card()).toHaveAttribute('data-state', 'laeuft');
    // Der Fokus kehrt auf „Beenden“ zurück
    expect(screen.getByRole('button', { name: 'Beenden' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Beenden' }));
    await user.click(within(card()).getByRole('button', { name: 'Session beenden' }));
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'beendet'));
    expect(calls(/stop$/)).toHaveLength(1);
  });

  it('session_transition_invalid: deutscher Text, Ansicht wird aufgefrischt', async () => {
    const user = userEvent.setup();
    boot();
    const start = await screen.findByRole('button', { name: 'Start' });
    core.rejectNextSession = { status: 409, code: 'session_transition_invalid' };
    const before = core.requests.filter((r) => r.path.startsWith('/sessions?from=')).length;
    await user.click(start);
    expect(await screen.findByRole('alert')).toHaveTextContent('Das geht bei dieser Session gerade nicht.');
    await waitFor(() =>
      expect(core.requests.filter((r) => r.path.startsWith('/sessions?from=')).length).toBeGreaterThan(
        before,
      ),
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
    // aria-disabled statt disabled: Der Fokus bleibt auf dem Knopf
    const busy = await screen.findByRole('button', { name: 'Wird gestartet …' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveFocus();
    await user.click(busy);
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
    const before = core.requests.filter((r) => r.path.startsWith('/sessions?from=')).length;
    // Während der Unterbrechung hat sich etwas geändert (Ereignisse werden nicht nachgeliefert)
    const stored = core.sessions.find((s) => s.id === SESSION_ID)!;
    stored.state = 'laeuft';
    stored.started_at = '2026-11-04T07:10:00Z';
    stored.updated_at = '2026-11-04T07:10:00Z';
    act(() => sync.setState('online'));
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'laeuft'));
    expect(core.requests.filter((r) => r.path.startsWith('/sessions?from=')).length).toBeGreaterThan(before);
    expect(screen.queryByText(/Keine Live-Verbindung/)).toBeNull();
  });

  it('Start mit anfangs fehlender Verbindung lädt nach dem Verbinden neu', async () => {
    boot({ syncState: 'connecting' });
    await screen.findByRole('button', { name: 'Start' });
    const before = core.requests.filter((r) => r.path.startsWith('/sessions?from=')).length;
    act(() => sync.setState('online'));
    await waitFor(() =>
      expect(core.requests.filter((r) => r.path.startsWith('/sessions?from=')).length).toBeGreaterThan(
        before,
      ),
    );
  });

  it('ohne Live-Verbindung fragt die Liste alle 30 s nach, auch wenn der Zustand hin und her springt', async () => {
    boot();
    await screen.findByRole('button', { name: 'Start' });
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    setNow('2026-11-04T07:10:00Z');
    const count = () => core.requests.filter((r) => r.path.startsWith('/sessions?from=')).length;
    const before = count();
    // Blockierter WebSocket: `connecting` und `backoff` wechseln sich ab, nie `online`
    act(() => sync.setState('backoff'));
    for (let i = 0; i < 6; i++) {
      act(() => sync.setState(i % 2 === 0 ? 'connecting' : 'backoff'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(count()).toBeGreaterThan(before);
  });

  it('Core aus beim Öffnen: Core-Hinweis statt Absturz', async () => {
    setNow('2026-11-04T07:10:00Z');
    core = installCalendarCore({ semesters: [makeSemester()], modules: [DBS], down: true });
    sync = fakeSync();
    render(
      <ThemeProvider>
        <QueryProvider>
          <AppShell syncClient={sync.client} recordingEnv={fakeRecording().env}>
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

// ---------------------------------------------------------------------------------------------
// Nacharbeit nach dem Review
// ---------------------------------------------------------------------------------------------

/** Hält `GET /sessions` an, bis `release()` kommt; die Antwort bleibt der Stand zum Zeitpunkt der Anfrage. */
function gateSessionReads() {
  const underlying = globalThis.fetch;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let armed = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const response = await underlying(input, init);
      const isRead = (init?.method ?? 'GET') === 'GET' && String(input).includes('/sessions?');
      if (armed && isRead) await gate;
      return response;
    }),
  );
  return {
    release: () => {
      armed = false;
      release();
    },
  };
}

describe('Heute: Puffer und Rennen', () => {
  it('eine inzwischen gelöschte Session kommt nicht über alte Ereignisse zurück', async () => {
    const user = userEvent.setup();
    boot({ now: '2026-11-04T07:20:00Z', sessions: [planned({ state: 'bereit' })] });
    await screen.findByRole('button', { name: 'Jetzt starten' });
    // Ein Ereignis: die Session läuft
    act(() =>
      sync.emit(
        'session.updated',
        planned({ state: 'laeuft', started_at: '2026-11-04T07:19:00Z', updated_at: '2026-11-04T07:19:00Z' }),
      ),
    );
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'laeuft'));
    // Im Core ist sie danach weich gelöscht (kein Ereignis angekommen); die nächste Abfrage kennt sie nicht mehr
    core.sessions.find((s) => s.id === SESSION_ID)!.deleted_at = '2026-11-04T07:19:30Z';
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    // Pause liefert 404; das Neuladen zeigt den Core-Stand: keine laufende Karte mehr
    await waitFor(() => expect(screen.queryByRole('region', { name: /Datenbanksysteme/ })).toBeNull());
    // und es bleibt so (keine Endlosschleife aus Fehler und Neuladen)
    const pauses = calls(/pause$/).length;
    await act(async () => undefined);
    expect(calls(/pause$/).length).toBe(pauses);
    expect(screen.queryByRole('region', { name: /Datenbanksysteme/ })).toBeNull();
  });

  it('Gegenprobe: ein Ereignis während des Abrufs wird eingemischt', async () => {
    boot({ now: '2026-11-04T07:20:00Z' });
    await screen.findByRole('button', { name: 'Jetzt starten' });
    const gated = gateSessionReads();
    act(() => sync.emit('leader.changed', {}));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    // Der Abruf läuft (angehalten, mit altem Stand); jetzt kommt das Ereignis
    act(() =>
      sync.emit(
        'session.updated',
        planned({ state: 'laeuft', started_at: '2026-11-04T07:19:00Z', updated_at: '2026-11-04T07:19:00Z' }),
      ),
    );
    gated.release();
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'laeuft'));
    await act(async () => undefined);
    expect(card()).toHaveAttribute('data-state', 'laeuft');
  });

  it('die Antwort einer Aktion wird von einem älteren, noch laufenden Abruf nicht überschrieben', async () => {
    const user = userEvent.setup();
    boot({
      now: '2026-11-04T07:20:00Z',
      sessions: [
        planned({ state: 'laeuft', started_at: '2026-11-04T07:15:00Z', updated_at: '2026-11-04T07:16:00Z' }),
      ],
    });
    await screen.findByRole('button', { name: 'Pause' });
    const gated = gateSessionReads();
    act(() => sync.emit('leader.changed', {}));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await screen.findByRole('button', { name: 'Fortsetzen' });
    gated.release();
    await act(async () => undefined);
    await act(async () => undefined);
    expect(card()).toHaveAttribute('data-state', 'pausiert');
  });
});

describe('Heute: Karte, Fokus, Hinweise', () => {
  it('nach dem Start geht der Fokus auf die Überschrift, wenn „Start“ verschwindet', async () => {
    const user = userEvent.setup();
    boot();
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    await waitFor(() => expect(within(card()).getByRole('heading', { level: 2 })).toHaveFocus());
  });

  it('Pause behält den Fokus auf demselben Knopf', async () => {
    const user = userEvent.setup();
    boot({
      now: '2026-11-04T07:20:00Z',
      sessions: [planned({ state: 'laeuft', started_at: '2026-11-04T07:15:00Z' })],
    });
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    const resume = await screen.findByRole('button', { name: 'Fortsetzen' });
    expect(resume).toHaveFocus();
  });

  it('pausiert: „Fortsetzen“ ist die Hauptaktion', async () => {
    boot({
      now: '2026-11-04T07:20:00Z',
      sessions: [planned({ state: 'pausiert', started_at: '2026-11-04T07:15:00Z' })],
    });
    expect(await screen.findByRole('button', { name: 'Fortsetzen' })).toHaveClass('bg-accent');
  });

  it('laufend ohne Dashboard-Route: kein Link „Zur Vorlesung“', async () => {
    dashboard.available = false;
    boot({
      now: '2026-11-04T07:20:00Z',
      sessions: [planned({ state: 'laeuft', started_at: '2026-11-04T07:15:00Z' })],
    });
    await screen.findByRole('button', { name: 'Pause' });
    expect(screen.queryByRole('link', { name: 'Zur Vorlesung' })).toBeNull();
    expect(screen.getByText(/Seit 08:15 Uhr/)).toBeInTheDocument();
  });

  it('vergessene aktive Session: die bereite Vorlesung bekommt „Start“ und einen ruhigen Hinweis', async () => {
    const user = userEvent.setup();
    const forgotten = planned({
      id: '0190f6a2-0000-7000-8000-0000000000c9',
      module_id: STAT.id,
      calendar_event_id: null,
      state: 'laeuft',
      started_at: '2026-11-04T05:00:00Z',
      planned_starts_at: '2026-11-04T05:00:00Z',
      planned_ends_at: '2026-11-04T06:30:00Z',
      updated_at: '2026-11-04T05:00:00Z',
    });
    boot({ now: '2026-11-04T07:10:00Z', sessions: [forgotten, planned()], events: [EVENT_DBS] });
    const c = await screen.findByRole('region', { name: /Datenbanksysteme/ });
    expect(
      within(c).getByText('Vorherige Vorlesung läuft noch und wird beim Start beendet.'),
    ).toBeInTheDocument();
    await user.click(within(c).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'laeuft'));
    expect(within(card()).getByText('Die vorherige Session wurde beendet.')).toBeInTheDocument();
    const old = core.sessions.find((s) => s.id === forgotten.id)!;
    expect(old.state).toBe('beendet');
    expect(old.ended_at).toBe('2026-11-04T06:30:00.000Z');
    expect(old.stop_reason).toBe('kalenderende');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Core-„verpasst“ mit Terminende in der Zukunft bietet Start an', async () => {
    const user = userEvent.setup();
    boot({ now: '2026-11-04T07:20:00Z', sessions: [planned({ state: 'verpasst' })] });
    await user.click(await screen.findByRole('button', { name: 'Jetzt starten' }));
    await waitFor(() => expect(core.sessions.find((s) => s.id === SESSION_ID)?.state).toBe('laeuft'));
  });

  it('Folge-Tab: kein Hinweis „Keine Live-Verbindung“ (das Banner der Shell genügt)', async () => {
    boot();
    await screen.findByRole('button', { name: 'Start' });
    act(() => sync.setState('other_tab'));
    await act(async () => undefined);
    expect(screen.queryByText(/Keine Live-Verbindung/)).toBeNull();
  });

  it('hängender Verbindungsaufbau gilt nach 10 s wie offline', async () => {
    boot({ syncState: 'connecting' });
    await screen.findByRole('button', { name: 'Start' });
    expect(screen.queryByText(/Keine Live-Verbindung/)).toBeNull();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    setNow('2026-11-04T07:10:00Z');
    act(() => sync.setState('syncing'));
    act(() => sync.setState('connecting'));
    act(() => {
      vi.advanceTimersByTime(10_001);
    });
    expect(screen.getByText(/Keine Live-Verbindung/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });
});

describe('Heute: spontane Sessions und Auswahl', () => {
  const spontaneous = (created: string, id = '0190f6a2-0000-7000-8000-0000000000d1') =>
    makeSession({
      id,
      module_id: STAT.id,
      state: 'bereit',
      started_at: null,
      planned_starts_at: null,
      planned_ends_at: null,
      created_at: created,
      updated_at: created,
    });

  it('terminierte Sessions gehen vor spontanen', () => {
    const now = Date.parse('2026-11-04T07:10:00Z');
    const spont = spontaneous('2026-11-04T06:00:00Z');
    expect(pickCard([spont, planned()], now)?.session.id).toBe(SESSION_ID);
    expect(pickCard([spont], now)?.session.id).toBe(spont.id);
  });

  it('eine spontane Session verschwindet nach 2 Stunden von der Karte', () => {
    const spont = spontaneous('2026-11-04T06:00:00Z');
    expect(pickCard([spont], Date.parse('2026-11-04T07:59:00Z'))).not.toBeNull();
    expect(pickCard([spont], Date.parse('2026-11-04T08:01:00Z'))).toBeNull();
  });

  it('vergessene aktive Session ohne bereite andere bleibt die Karte', () => {
    const old = planned({
      state: 'laeuft',
      started_at: '2026-11-04T05:00:00Z',
      planned_ends_at: '2026-11-04T06:30:00Z',
    });
    const pick = pickCard([old, SECOND], Date.parse('2026-11-04T07:10:00Z'));
    expect(pick?.session.id).toBe(old.id);
    expect(pick?.previousRunning).toBeNull();
  });
});

describe('Fake-Core gleicht dem echten Core', () => {
  async function post(path: string, body: unknown = {}) {
    const res = await fetch(`/api/v1${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as { session?: { state: string } } };
  }

  it('Start auf pausiert: 200 ohne Änderung; auf verpasst nach Terminende: 409; weich gelöscht: 404', async () => {
    setNow('2026-11-04T09:00:00Z'); // nach dem Terminende
    core = installCalendarCore({
      semesters: [makeSemester()],
      modules: [DBS],
      sessions: [
        planned({ state: 'pausiert', started_at: '2026-11-04T07:15:00Z' }),
        makeSession({ id: 'v', state: 'verpasst', started_at: null, planned_ends_at: EVENT_DBS.ends_at }),
        makeSession({ id: 'g', state: 'bereit', started_at: null, deleted_at: '2026-11-04T08:00:00Z' }),
      ],
    });
    const paused = await post(`/sessions/${SESSION_ID}/start`, { started_from: 'mac' });
    expect(paused.status).toBe(200);
    expect(paused.body.session?.state).toBe('pausiert');
    expect((await post('/sessions/v/start', { started_from: 'mac' })).status).toBe(409);
    expect((await post('/sessions/g/start', { started_from: 'mac' })).status).toBe(404);
  });
});
