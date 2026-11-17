// Start-Karte und spontaner Start fragen `deck-options` nach (VERTRAEGE §22.7, analog §22.6): beim Sichtbarwerden des
// Tabs und alle 60 s im sichtbaren Tab, nur solange die Karte startbar ist und keine Wahl oder kein Upload läuft.
// Fake-Core nach Vertrag, falsche Timer nur für Intervalle und Uhr.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Vor allen Imports: Die Formatierer lesen die Zeitzone beim Laden
vi.hoisted(() => {
  process.env.TZ = 'Europe/Zurich';
});

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Session, SlideDeck } from '@sg/shared';
import { AppShell } from '../src/components/AppShell.tsx';
import { HeuteView } from '../src/components/HeuteView.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { installCalendarCore, makeEvent, type CalendarCore } from './calendar-core.ts';
import { makeDeck, makeModule, makeSemester, makeSession } from './fake-core.ts';
import { fakeRecording } from './recording-fakes.ts';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push }),
}));

const DBS = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a3', name: 'Datenbanksysteme' });
const STAT = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a4', name: 'Statistik', color: 'mod-05' });
const SESSION_ID = '0190f6a2-0000-7000-8000-0000000000e1';
const D1 = '0190f6a2-0000-7000-8000-0000000000d1';
const D2 = '0190f6a2-0000-7000-8000-0000000000d2';
const D3 = '0190f6a2-0000-7000-8000-0000000000d3';

// Mittwoch, 4. November 2026, Zürich = UTC+1. Vorlesung 08:15 Uhr = 07:15Z.
const EVENT = makeEvent({
  id: '0190f6a2-0000-7000-8000-0000000000f1',
  module_id: DBS.id,
  title: 'DBS Vorlesung',
  starts_at: '2026-11-04T07:15:00Z',
  ends_at: '2026-11-04T08:45:00Z',
  session_id: SESSION_ID,
});

function planned(overrides: Partial<Session> = {}): Session {
  return makeSession({
    id: SESSION_ID,
    module_id: DBS.id,
    calendar_event_id: EVENT.id,
    number: 7,
    state: 'bereit',
    started_at: null,
    planned_starts_at: EVENT.starts_at,
    planned_ends_at: EVENT.ends_at,
    created_at: '2026-11-03T08:00:00Z',
    updated_at: '2026-11-04T07:00:00Z',
    ...overrides,
  });
}

/** VL 6 ist gelaufen und trägt D3 („schon in VL 6“) */
const VL6 = makeSession({
  id: '0190f6a2-0000-7000-8000-0000000000e6',
  module_id: DBS.id,
  number: 6,
  state: 'verarbeitet',
  started_at: '2026-10-30T07:15:00Z',
  ended_at: '2026-10-30T08:45:00Z',
  created_at: '2026-10-29T08:00:00Z',
  updated_at: '2026-10-30T09:00:00Z',
  slide_deck_id: D3,
});

function decks(): SlideDeck[] {
  return [
    makeDeck({
      id: D1,
      module_id: DBS.id,
      title: 'VL 05 Normalformen',
      ingest_state: 'verarbeitet',
      uploaded_at: '2026-10-28T10:00:00Z',
    }),
    makeDeck({
      id: D2,
      module_id: DBS.id,
      title: 'VL 07 Transaktionen',
      ingest_state: 'verarbeitet',
      uploaded_at: '2026-11-04T05:00:00Z',
    }),
    makeDeck({
      id: D3,
      module_id: DBS.id,
      title: 'VL 06 Indizes',
      ingest_state: 'verarbeitet',
      uploaded_at: '2026-10-30T05:00:00Z',
    }),
  ];
}

const syncHandlers = new Map<string, Set<() => void>>();
function fakeSync() {
  const client = {
    connectionState: 'online',
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    onEvent: vi.fn((name: string, fn: () => void) => {
      const set = syncHandlers.get(name) ?? new Set();
      set.add(fn);
      syncHandlers.set(name, set);
      return () => void set.delete(fn);
    }),
    takeOver: vi.fn(),
    listShelf: vi.fn(async () => []),
    subscribe: vi.fn(),
  };
  return client as unknown as SyncClient;
}

let core: CalendarCore;

function boot(opts: { sessions?: Session[] } = {}) {
  vi.setSystemTime(new Date('2026-11-04T07:10:00Z')); // 08:10 Uhr
  core = installCalendarCore({
    semesters: [makeSemester()],
    modules: [DBS, STAT],
    decks: decks(),
    sessions: opts.sessions ?? [planned(), VL6],
    events: [EVENT],
  });
  // D2 kommt aus Moodle und ist der neueste Satz
  core.deckMeta[D2] = { moodle: true, available_at: '2026-11-04T05:30:00Z' };
  const rec = fakeRecording();
  return render(
    <ThemeProvider>
      <QueryProvider>
        <AppShell syncClient={fakeSync()} recordingEnv={rec.env}>
          <HeuteView />
        </AppShell>
      </QueryProvider>
    </ThemeProvider>,
  );
}

const post = (path: RegExp) => core.requests.filter((r) => r.method === 'POST' && path.test(r.path));
const D4 = '0190f6a2-0000-7000-8000-0000000000d4';
const SPAN = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const startCalls = () =>
  core.requests.filter(
    (r) => r.method === 'GET' && r.path === `/modules/${DBS.id}/deck-options?session_id=${SESSION_ID}`,
  );
const moduleCalls = () =>
  core.requests.filter((r) => r.method === 'GET' && r.path === `/modules/${DBS.id}/deck-options`);
const row = () => screen.findByTestId('start-deck');

/** Ein neuerer Satz aus Moodle, der erst nach dem Laden dazukommt */
function addMoodleDeck() {
  core.decks.unshift(
    makeDeck({
      id: D4,
      module_id: DBS.id,
      title: 'VL 08 Sperren',
      ingest_state: 'verarbeitet',
      uploaded_at: '2026-11-04T07:30:00Z',
    }),
  );
  core.deckMeta[D4] = { moodle: true, available_at: '2026-11-04T07:30:00Z' };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  syncHandlers.clear();
  window.sessionStorage.clear();
  push.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Start-Karte: Abfrage der Foliensätze', () => {
  it('ein Satz, der nach dem Laden dazukommt, steht nach 60 s auf der Karte', async () => {
    boot();
    expect(await row()).toHaveTextContent('Folien: VL 07 Transaktionen');
    expect(startCalls()).toHaveLength(1);
    addMoodleDeck();
    await SPAN(59_000);
    expect(startCalls()).toHaveLength(1);
    await SPAN(1_500);
    await waitFor(() => expect(startCalls()).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId('start-deck')).toHaveTextContent('Folien: VL 08 Sperren'));
    // Nur ein Intervall je Karte: weitere 60 s bringen genau eine weitere Abfrage
    await SPAN(60_000);
    expect(startCalls()).toHaveLength(3);
  });

  it('der Start schickt weiter den Vorschlag der letzten Abfrage mit', async () => {
    boot();
    await row();
    addMoodleDeck();
    await SPAN(61_000);
    await waitFor(() => expect(screen.getByTestId('start-deck')).toHaveTextContent('Folien: VL 08 Sperren'));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(post(/\/start$/)).toHaveLength(1));
    expect(post(/\/start$/)[0]!.body).toEqual({ started_from: 'mac', slide_deck_id: D4 });
  });

  it('hat die Session inzwischen einen Satz, kommt kein Vorschlag mit (B1 bleibt)', async () => {
    boot();
    await row();
    // Ein anderer Weg setzt den Satz, die Karte hat die Session noch ohne Satz
    core.sessions = core.sessions.map((s) => (s.id === SESSION_ID ? { ...s, slide_deck_id: D1 } : s));
    await SPAN(61_000);
    await waitFor(() => expect(startCalls()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(post(/\/start$/)).toHaveLength(1));
    expect(post(/\/start$/)[0]!.body).toEqual({ started_from: 'mac' });
  });

  it('fragt nicht ab, solange die Session läuft', async () => {
    boot({ sessions: [planned({ state: 'laeuft', started_at: '2026-11-04T07:16:00Z' })] });
    await screen.findByRole('region', { name: /Datenbanksysteme/ });
    await SPAN(130_000);
    expect(startCalls()).toHaveLength(0);
  });

  it('fragt im verborgenen Tab nicht alle 60 s, beim Sichtbarwerden sofort', async () => {
    boot();
    await row();
    expect(startCalls()).toHaveLength(1);
    const state = vi.spyOn(document, 'visibilityState', 'get');
    state.mockReturnValue('hidden');
    window.dispatchEvent(new Event('visibilitychange'));
    addMoodleDeck();
    await SPAN(130_000);
    expect(startCalls()).toHaveLength(1);
    state.mockReturnValue('visible');
    await act(async () => void window.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(startCalls()).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId('start-deck')).toHaveTextContent('Folien: VL 08 Sperren'));
  });

  it('fragt nicht ab, solange eine Wahl läuft (choice.busy)', async () => {
    boot();
    await row();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const coreFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') await gate;
      return coreFetch(input, init);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ändern' }));
    fireEvent.click(
      within(screen.getByRole('list', { name: 'Foliensätze' })).getByText('VL 05 Normalformen'),
    );
    await SPAN(130_000);
    expect(startCalls()).toHaveLength(1);
    release();
    await SPAN(10);
    // Danach gilt die Abfrage wieder (die Wahl lädt die Optionen einmal selbst neu)
    const after = startCalls().length;
    await SPAN(61_000);
    expect(startCalls().length).toBeGreaterThan(after);
  });

  it('fragt nicht ab, solange ein Upload läuft oder lief (uploading)', async () => {
    boot();
    await row();
    fireEvent.click(screen.getByRole('button', { name: 'Ändern' }));
    const input = screen.getByLabelText('PDF-Dateien auswählen', { selector: 'input' }) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['%PDF-1.4'], 'Mein_Skript.pdf', { type: 'application/pdf' })] },
    });
    await SPAN(10);
    const before = startCalls().length;
    await SPAN(130_000);
    expect(startCalls()).toHaveLength(before);
  });
});

describe('Spontaner Start: Abfrage der Foliensätze', () => {
  it('ein neuer Satz steht nach 60 s unter dem Modul, die Abfrage ruht beim Anlegen', async () => {
    boot();
    await screen.findByLabelText('Modul');
    fireEvent.change(screen.getByLabelText('Modul'), { target: { value: DBS.id } });
    expect(await screen.findByTestId('spontan-deck')).toHaveTextContent('VL 07 Transaktionen');
    const before = moduleCalls().length;
    addMoodleDeck();
    await SPAN(61_000);
    await waitFor(() => expect(moduleCalls().length).toBeGreaterThan(before));
    expect(await screen.findByTestId('spontan-deck')).toHaveTextContent('VL 08 Sperren');
  });

  it('fragt im verborgenen Tab nicht ab', async () => {
    boot();
    await screen.findByLabelText('Modul');
    fireEvent.change(screen.getByLabelText('Modul'), { target: { value: DBS.id } });
    await screen.findByTestId('spontan-deck');
    const before = moduleCalls().length;
    const state = vi.spyOn(document, 'visibilityState', 'get');
    state.mockReturnValue('hidden');
    window.dispatchEvent(new Event('visibilitychange'));
    await SPAN(130_000);
    expect(moduleCalls()).toHaveLength(before);
  });
});
