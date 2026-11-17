// Folien in der Live-Ansicht (VERTRAEGE §22.6, §22.7): ohne Satz wählen, hochladen, das Angebot aus Moodle (mit falschen
// Timern), gelöschter Satz, Wechsel mit Satz und die Sperre nach dem ersten Folienwechsel. Fake-Core nach Vertrag.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { Session, SlideEvent } from '@sg/shared';
import { SlidesPanel } from '../src/components/dashboard/slides/SlidesPanel.tsx';
import { makeQueryClient } from '../src/lib/query.tsx';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { ToastProvider } from '../src/lib/toast.tsx';
import { UploadProvider } from '../src/lib/uploads.tsx';
import {
  installFakeCore,
  makeDeck,
  makeModule,
  makeSession,
  makeSlides,
  type FakeCore,
} from './fake-core.ts';

const SESSION_ID = '0190f6a2-0000-7000-8000-0000000000e1';
const MODULE = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a3' });
const D1 = '0190f6a2-0000-7000-8000-0000000000d1';
const D2 = '0190f6a2-0000-7000-8000-0000000000d2';
const D3 = '0190f6a2-0000-7000-8000-0000000000d3';
const STARTED = '2026-11-04T08:00:00Z';

let core: FakeCore;
let queryClient = makeQueryClient();

/** Sync-Client, der `send` zählt und Verbindungsereignisse steuerbar macht */
function fakeSync() {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const send = vi.fn(async () => ({ type: 'ack', op_id: 'x', seq: 1 }));
  const raw = {
    connectionState: 'online',
    clockOffsetMs: null as number | null,
    send,
    onEvent: vi.fn((name: string, fn: (data: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(fn);
      listeners.set(name, set);
      return () => void set.delete(fn);
    }),
    subscribe: vi.fn(() => () => undefined),
  };
  return {
    client: raw as unknown as SyncClient,
    send,
    emit: (name: string, data: unknown) => act(() => listeners.get(name)?.forEach((fn) => fn(data))),
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return makeSession({
    id: SESSION_ID,
    module_id: MODULE.id,
    state: 'laeuft',
    started_at: STARTED,
    updated_at: STARTED,
    ...overrides,
  });
}

/** Hält die Session wie die Live-Ansicht: Antworten des Core ersetzen sie (`onSession`) */
function Host({
  sync,
  initial,
  active = true,
  uploads = false,
}: {
  sync: ReturnType<typeof fakeSync>;
  initial: Session;
  active?: boolean;
  uploads?: boolean;
}) {
  const [current, setCurrent] = useState(initial);
  const panel = (
    <SlidesPanel
      sessionId={current.id}
      moduleId={current.module_id}
      slideDeckId={current.slide_deck_id}
      active={active}
      startedAt={Date.parse(STARTED)}
      client={sync.client}
      onSession={setCurrent}
    />
  );
  return (
    <QueryClientProvider client={queryClient}>
      {uploads ? (
        <ToastProvider>
          <UploadProvider>{panel}</UploadProvider>
        </ToastProvider>
      ) : (
        panel
      )}
    </QueryClientProvider>
  );
}

function open(initial: Session = session(), opts: { active?: boolean; uploads?: boolean } = {}) {
  const sync = fakeSync();
  const view = render(<Host sync={sync} initial={initial} {...opts} />);
  return { sync, ...view };
}

const optionCalls = () =>
  core.requests.filter((r) => r.method === 'GET' && /\/modules\/[^/]+\/deck-options/.test(r.path));
const patches = () =>
  core.requests.filter((r) => r.method === 'PATCH' && r.path === `/sessions/${SESSION_ID}`);
const slideEvent = (at: number): SlideEvent => ({
  id: `0190f6a2-0000-7000-8000-${String(7000 + at).padStart(12, '0')}`,
  user_id: '0190f6a2-0000-7000-8000-000000000000',
  created_at: STARTED,
  updated_at: STARTED,
  deleted_at: null,
  session_id: SESSION_ID,
  slide_id: null,
  slide_index: 2,
  t_ms: at,
  device: 'ipad',
  source: 'manuell_ipad',
});

/** Zwei freie Sätze: D1 aus Moodle (nach dem Start bereitgestellt), D2 Upload (älter) */
function seed() {
  core.decks = [
    makeDeck({
      id: D1,
      module_id: MODULE.id,
      title: 'VL 07 Transaktionen',
      ingest_state: 'verarbeitet',
      page_count: 12,
      uploaded_at: '2026-11-04T08:20:00Z',
    }),
    makeDeck({
      id: D2,
      module_id: MODULE.id,
      title: 'VL 05 Normalformen',
      ingest_state: 'verarbeitet',
      page_count: 12,
      uploaded_at: '2026-10-28T10:00:00Z',
    }),
  ];
  for (const id of [D1, D2]) core.slides[id] = makeSlides(id, 12);
  core.deckMeta[D1] = { moodle: true, available_at: '2026-11-04T08:20:00Z' };
}

beforeEach(() => {
  window.sessionStorage.clear();
  queryClient = makeQueryClient();
  core = installFakeCore({ modules: [MODULE], sessions: [session()] });
  seed();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Live-Ansicht ohne Satz', () => {
  it('der Hinweis bleibt, darunter das Angebot aus Moodle, „Folien wählen“ und „PDF hochladen“', async () => {
    const { sync } = open(session(), { uploads: true });
    const offer = await screen.findByTestId('deck-offer');
    expect(screen.getByTestId('slides-panel')).toHaveTextContent(
      'Folien kommen später – einfach mitschreiben',
    );
    expect(offer).toHaveTextContent('Neue Folien aus Moodle: VL 07 Transaktionen');
    expect(within(offer).getByRole('button', { name: 'Übernehmen' })).toBeInTheDocument();
    expect(within(offer).getByRole('button', { name: 'Nicht jetzt' })).toBeInTheDocument();
    // Ruhig: eine Statusmeldung, kein Fokus, kein Alarm, kein Rot
    expect(within(offer).getByRole('status')).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Folien wählen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PDF hochladen' })).toBeInTheDocument();
    expect(sync.send).not.toHaveBeenCalled();
  });

  it('ein Satz ohne Moodle (oder vor dem Start bereitgestellt) heißt „Vorschlag“', async () => {
    core.deckMeta[D1] = { moodle: false, available_at: '2026-11-04T08:20:00Z' };
    open();
    expect(await screen.findByTestId('deck-offer')).toHaveTextContent('Vorschlag: VL 07 Transaktionen');
    cleanup();
    queryClient = makeQueryClient();
    core.deckMeta[D1] = { moodle: true, available_at: '2026-11-04T07:00:00Z' };
    open();
    expect(await screen.findByTestId('deck-offer')).toHaveTextContent('Vorschlag: VL 07 Transaktionen');
  });

  it('ohne Vorschlag gibt es kein Angebot, wählen geht trotzdem', async () => {
    core.sessions = [session()];
    core.decks.forEach((d) => (d.deleted_at = STARTED));
    open();
    await screen.findByRole('button', { name: 'Folien wählen' });
    await waitFor(() => expect(optionCalls().length).toBeGreaterThan(0));
    expect(screen.queryByTestId('deck-offer')).toBeNull();
  });

  it('inaktiv (beendet): nur der Hinweis, nichts zum Wählen, keine Abfrage', async () => {
    open(session({ state: 'beendet', ended_at: '2026-11-04T09:30:00Z' }), { active: false });
    expect(screen.getByTestId('slides-panel')).toHaveTextContent('Folien kommen später');
    expect(screen.queryByRole('button', { name: 'Folien wählen' })).toBeNull();
    expect(screen.queryByTestId('deck-offer')).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(optionCalls()).toHaveLength(0);
  });

  it('„Übernehmen“ setzt den Satz per PATCH, zeigt Folie 1 und sendet kein slide.change', async () => {
    const user = userEvent.setup();
    const { sync } = open();
    await screen.findByTestId('deck-offer');
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(screen.getByTestId('slide-counter')).toHaveTextContent('Folie 1 / 12'));
    expect(patches()).toHaveLength(1);
    expect(patches()[0]!.body).toEqual({ slide_deck_id: D1 });
    expect(core.sessions[0]!.slide_deck_id).toBe(D1);
    expect(sync.send).not.toHaveBeenCalled();
    expect(screen.queryByTestId('deck-offer')).toBeNull();
  });

  it('„Nicht jetzt“ blendet den Satz aus (sessionStorage), ein neuerer wird wieder angeboten', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-11-04T08:30:00Z'));
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    open();
    const offer = await screen.findByTestId('deck-offer');
    await user.click(within(offer).getByRole('button', { name: 'Nicht jetzt' }));
    expect(screen.queryByTestId('deck-offer')).toBeNull();
    expect(window.sessionStorage.getItem(`sg.folien.angebot.${SESSION_ID}`)).toBe(D1);
    // Der Fokus bleibt in der Spalte (auf „Folien wählen“), er fällt nicht auf die Seite zurück
    expect(screen.getByRole('button', { name: 'Folien wählen' })).toHaveFocus();
    // Nach der nächsten Abfrage ist derselbe Satz weiter ausgeblendet …
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
    expect(screen.queryByTestId('deck-offer')).toBeNull();
    // … ein noch neuerer Satz kommt
    core.decks.unshift(
      makeDeck({
        id: D3,
        module_id: MODULE.id,
        title: 'VL 08 Sperren',
        ingest_state: 'verarbeitet',
        uploaded_at: '2026-11-04T08:40:00Z',
      }),
    );
    core.deckMeta[D3] = { moodle: true, available_at: '2026-11-04T08:40:00Z' };
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
    expect(await screen.findByTestId('deck-offer')).toHaveTextContent(
      'Neue Folien aus Moodle: VL 08 Sperren',
    );
  });

  it('„Nicht jetzt“ gilt nur für diese Session (sessionStorage je Session)', async () => {
    window.sessionStorage.setItem('sg.folien.angebot.0190f6a2-0000-7000-8000-0000000000ee', D1);
    open();
    expect(await screen.findByTestId('deck-offer')).toBeInTheDocument();
  });
});

describe('Live-Ansicht: Abfrage nach neuen Folien', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-11-04T08:30:00Z'));
    core.decks.forEach((d) => (d.deleted_at = STARTED)); // anfangs gibt es nichts
  });

  const addMoodleDeck = () => {
    core.decks.push(
      makeDeck({
        id: D3,
        module_id: MODULE.id,
        title: 'VL 08 Sperren',
        ingest_state: 'verarbeitet',
        uploaded_at: '2026-11-04T08:25:00Z',
      }),
    );
    core.deckMeta[D3] = { moodle: true, available_at: '2026-11-04T08:25:00Z' };
  };

  it('fragt beim Öffnen und danach alle 60 s, ein neuer Satz erscheint als Angebot', async () => {
    open();
    await screen.findByRole('button', { name: 'Folien wählen' });
    await waitFor(() => expect(optionCalls()).toHaveLength(1));
    expect(screen.queryByTestId('deck-offer')).toBeNull();
    addMoodleDeck();
    await act(async () => void (await vi.advanceTimersByTimeAsync(59_000)));
    expect(optionCalls()).toHaveLength(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1_500)));
    expect(optionCalls()).toHaveLength(2);
    expect(await screen.findByTestId('deck-offer')).toHaveTextContent(
      'Neue Folien aus Moodle: VL 08 Sperren',
    );
  });

  it('fragt nach jedem Neuverbinden des Sync-Clients', async () => {
    const { sync } = open();
    await screen.findByRole('button', { name: 'Folien wählen' });
    await waitFor(() => expect(optionCalls()).toHaveLength(1));
    addMoodleDeck();
    // Ein Abbruch allein fragt nicht, erst das Neuverbinden
    await sync.emit('connection', { state: 'backoff', retryInMs: 1000, closeCode: null });
    expect(optionCalls()).toHaveLength(1);
    await sync.emit('connection', { state: 'online', retryInMs: null, closeCode: null });
    expect(await screen.findByTestId('deck-offer')).toHaveTextContent('VL 08 Sperren');
    expect(optionCalls()).toHaveLength(2);
  });

  it('fragt, wenn der Tab sichtbar wird, und im verborgenen Tab nicht alle 60 s', async () => {
    open();
    await screen.findByRole('button', { name: 'Folien wählen' });
    await waitFor(() => expect(optionCalls()).toHaveLength(1));
    const state = vi.spyOn(document, 'visibilityState', 'get');
    state.mockReturnValue('hidden');
    window.dispatchEvent(new Event('visibilitychange'));
    addMoodleDeck();
    await act(async () => void (await vi.advanceTimersByTimeAsync(130_000)));
    expect(optionCalls()).toHaveLength(1);
    state.mockReturnValue('visible');
    await act(async () => void window.dispatchEvent(new Event('visibilitychange')));
    expect(await screen.findByTestId('deck-offer')).toBeInTheDocument();
    expect(optionCalls()).toHaveLength(2);
    state.mockRestore();
  });

  it('hört auf, sobald die Session einen Satz hat', async () => {
    const { rerender } = open();
    await screen.findByRole('button', { name: 'Folien wählen' });
    await waitFor(() => expect(optionCalls()).toHaveLength(1));
    // Die Session bekommt von außen einen Satz (session.updated): kein Polling mehr
    core.decks.push(
      makeDeck({ id: D3, module_id: MODULE.id, title: 'VL 08 Sperren', ingest_state: 'verarbeitet' }),
    );
    core.slides[D3] = makeSlides(D3, 3);
    core.sessions.find((x) => x.id === SESSION_ID)!.slide_deck_id = D3;
    rerender(
      <QueryClientProvider client={queryClient}>
        <SlidesPanel
          sessionId={SESSION_ID}
          moduleId={MODULE.id}
          slideDeckId={D3}
          active
          startedAt={Date.parse(STARTED)}
          client={fakeSync().client}
        />
      </QueryClientProvider>,
    );
    await screen.findByTestId('slide-counter');
    const before = optionCalls().length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(180_000)));
    expect(optionCalls().length).toBe(before);
  });
});

describe('Live-Ansicht: Folien wählen und hochladen', () => {
  it('„Folien wählen“ klappt die Liste auf (ohne „Ohne Folien“), Wahl per PATCH, Esc schließt', async () => {
    const user = userEvent.setup();
    open();
    const choose = await screen.findByRole('button', { name: 'Folien wählen' });
    await user.click(choose);
    const list = screen.getByRole('list', { name: 'Foliensätze' });
    expect(within(list).queryByText('Ohne Folien')).toBeNull();
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('list', { name: 'Foliensätze' })).toBeNull();
    expect(choose).toHaveFocus();
    expect(patches()).toHaveLength(0);

    await user.click(choose);
    await user.click(
      within(screen.getByRole('list', { name: 'Foliensätze' })).getByText('VL 05 Normalformen'),
    );
    await waitFor(() => expect(screen.getByTestId('slide-counter')).toBeInTheDocument());
    expect(patches()[0]!.body).toEqual({ slide_deck_id: D2 });
  });

  it('„PDF hochladen“ geht als POST /slide-decks mit session_id; der Core hängt den Satz an', async () => {
    open(session(), { uploads: true });
    await screen.findByRole('button', { name: 'PDF hochladen' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['%PDF-1.4'], 'Skript_Woche_9.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(core.decks.some((d) => d.title === 'Skript Woche 9')).toBe(true));
    const created = core.decks.find((d) => d.title === 'Skript Woche 9')!;
    expect(core.sessions[0]!.slide_deck_id).toBe(created.id);
    expect(created.session_id).toBe(SESSION_ID);
  });

  it('eine beendete Session nimmt keinen Upload an: ruhige Meldung, kein Satz entsteht', async () => {
    open(session(), { uploads: true });
    await screen.findByRole('button', { name: 'PDF hochladen' });
    core.sessions[0]!.state = 'beendet';
    const before = core.decks.length;
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['%PDF-1.4'], 'Spaet.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByText(/Diese Vorlesung ist schon beendet/)).toBeInTheDocument();
    expect(core.decks).toHaveLength(before);
  });
});

describe('Live-Ansicht: gelöschter Satz', () => {
  beforeEach(() => {
    core.sessions = [session({ slide_deck_id: D1 })];
    core.decks.find((d) => d.id === D1)!.deleted_at = '2026-11-04T08:10:00Z';
  });

  it('sagt es ruhig und bietet „Folien wählen“ (der Moodle-Satz ist weg, D2 bleibt wählbar)', async () => {
    const user = userEvent.setup();
    open(session({ slide_deck_id: D1 }));
    expect(await screen.findByText('Die Folien dieser Vorlesung sind gelöscht.')).toBeInTheDocument();
    const choose = await screen.findByRole('button', { name: 'Folien wählen' });
    await user.click(choose);
    await user.click(
      within(screen.getByRole('list', { name: 'Foliensätze' })).getByText('VL 05 Normalformen'),
    );
    await waitFor(() => expect(screen.getByTestId('slide-counter')).toBeInTheDocument());
    expect(core.sessions[0]!.slide_deck_id).toBe(D2);
  });

  it('nach einem Folienwechsel steht nur der Satz, ohne Knöpfe', async () => {
    core.slideEvents = [slideEvent(5000)];
    open(session({ slide_deck_id: D1 }));
    expect(await screen.findByText('Die Folien dieser Vorlesung sind gelöscht.')).toBeInTheDocument();
    await waitFor(() => expect(optionCalls().length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('button', { name: 'Folien wählen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'PDF hochladen' })).toBeNull();
    expect(screen.queryByTestId('deck-offer')).toBeNull();
  });
});

describe('Live-Ansicht: von außen gelöschter Satz', () => {
  const hidden = () => vi.spyOn(document, 'visibilityState', 'get');

  async function deleteExternally() {
    core.decks.find((d) => d.id === D1)!.deleted_at = '2026-11-04T08:10:00Z';
    const state = hidden();
    state.mockReturnValue('hidden');
    window.dispatchEvent(new Event('visibilitychange'));
    state.mockReturnValue('visible');
    await act(async () => void window.dispatchEvent(new Event('visibilitychange')));
    return state;
  }

  it('erkennt ihn beim nächsten Sichtbarwerden über deck-options, ohne Neuladen und ohne 404 des Satzes', async () => {
    core.sessions = [session({ slide_deck_id: D1 })];
    open(session({ slide_deck_id: D1 }));
    await screen.findByTestId('slide-counter');
    // Nur eine leichte Abfrage, kein Dauerpolling mit Satz
    await waitFor(() => expect(optionCalls()).toHaveLength(1));
    const state = await deleteExternally();
    expect(await screen.findByText('Die Folien dieser Vorlesung sind gelöscht.')).toBeInTheDocument();
    expect(screen.queryByTestId('slide-counter')).toBeNull();
    expect(optionCalls()).toHaveLength(2);
    state.mockRestore();
  });

  it('die Pfeiltasten blättern im gelöschten Satz nicht weiter und senden kein slide.change', async () => {
    core.sessions = [session({ slide_deck_id: D1 })];
    const { sync } = open(session({ slide_deck_id: D1 }));
    await screen.findByTestId('slide-counter');
    const state = await deleteExternally();
    await screen.findByText('Die Folien dieser Vorlesung sind gelöscht.');
    const user = userEvent.setup();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowLeft} ');
    expect(sync.send).not.toHaveBeenCalled();
    state.mockRestore();
  });
});

describe('Live-Ansicht: Optionen noch nicht da', () => {
  it('„Folien wählen“ zeigt ruhig, dass die Foliensätze geladen werden', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', (input: RequestInfo | URL) =>
      String(input).includes('/deck-options')
        ? new Promise<Response>(() => undefined)
        : Promise.reject(new Error('x')),
    );
    open();
    await user.click(await screen.findByRole('button', { name: 'Folien wählen' }));
    expect(screen.getByText('Foliensätze werden geladen …')).toBeInTheDocument();
  });

  it('gescheiterte Optionen: ruhiger Hinweis statt eines stillen Knopfs', async () => {
    const user = userEvent.setup();
    const coreFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/deck-options')
        ? Promise.resolve(new Response('{}', { status: 500 }))
        : coreFetch(input, init),
    );
    open();
    await user.click(await screen.findByRole('button', { name: 'Folien wählen' }));
    expect(await screen.findByText('Die Foliensätze sind gerade nicht erreichbar.')).toBeInTheDocument();
  });
});

describe('Live-Ansicht mit Satz', () => {
  beforeEach(() => {
    core.sessions = [session({ slide_deck_id: D1 })];
  });

  it('bietet „Anderen Foliensatz wählen“ und „Ohne Folien“, solange nicht geblättert wurde', async () => {
    const user = userEvent.setup();
    open(session({ slide_deck_id: D1 }));
    await screen.findByRole('button', { name: 'Anderen Foliensatz wählen' });
    expect(screen.getByRole('button', { name: 'Ohne Folien' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anderen Foliensatz wählen' }));
    const list = screen.getByRole('list', { name: 'Foliensätze' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('VL 07 Transaktionen').closest('button')).toHaveAttribute(
      'aria-current',
      'true',
    );
    await user.click(within(list).getByText('VL 05 Normalformen'));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]!.body).toEqual({ slide_deck_id: D2 });
    expect(core.sessions[0]!.slide_deck_id).toBe(D2);
  });

  it('„Ohne Folien“ leert den Satz (PATCH null) und die Spalte zeigt wieder den Hinweis', async () => {
    const user = userEvent.setup();
    open(session({ slide_deck_id: D1 }));
    await user.click(await screen.findByRole('button', { name: 'Ohne Folien' }));
    expect(await screen.findByText('Folien kommen später – einfach mitschreiben')).toBeInTheDocument();
    expect(patches()[0]!.body).toEqual({ slide_deck_id: null });
    expect(core.sessions[0]!.slide_deck_id).toBeNull();
  });

  it('die Pfeiltasten gehören der Liste: kein Folienwechsel, keine Sperre', async () => {
    const user = userEvent.setup();
    const { sync } = open(session({ slide_deck_id: D1 }));
    await user.click(await screen.findByRole('button', { name: 'Anderen Foliensatz wählen' }));
    await user.keyboard('{ArrowDown}{ArrowRight}{ArrowLeft}{ArrowUp}');
    expect(sync.send).not.toHaveBeenCalled();
    expect(screen.getByTestId('slide-counter')).toHaveTextContent('Folie 1 / 12');
  });

  it('nach dem ersten Folienwechsel entfallen beide Knöpfe', async () => {
    const user = userEvent.setup();
    open(session({ slide_deck_id: D1 }));
    await screen.findByRole('button', { name: 'Anderen Foliensatz wählen' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByTestId('slide-counter')).toHaveTextContent('Folie 2 / 12'));
    expect(screen.queryByRole('button', { name: 'Anderen Foliensatz wählen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ohne Folien' })).toBeNull();
    expect(user).toBeDefined();
  });

  it('ein Folienwechsel auf dem Core (lock) blendet beide Knöpfe aus', async () => {
    core.slideEvents = [slideEvent(5000)];
    open(session({ slide_deck_id: D1 }));
    await waitFor(() => expect(screen.getByTestId('slide-counter')).toHaveTextContent('Folie 2 / 12'));
    expect(screen.queryByRole('button', { name: 'Anderen Foliensatz wählen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ohne Folien' })).toBeNull();
  });

  it('antwortet der Core trotzdem mit slide_deck_locked, steht ruhig, warum der Satz bleibt', async () => {
    const user = userEvent.setup();
    open(session({ slide_deck_id: D1 }));
    const clear = await screen.findByRole('button', { name: 'Ohne Folien' });
    // Ein anderer Tab hat inzwischen geblättert
    core.slideEvents = [slideEvent(5000)];
    await user.click(clear);
    const note = await screen.findByText(
      'Der Foliensatz bleibt, weil in dieser Vorlesung schon geblättert wurde.',
    );
    expect(note.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(core.sessions[0]!.slide_deck_id).toBe(D1);
    // Die Optionen sind neu geladen: Die Knöpfe entfallen, die Erklärung bleibt
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ohne Folien' })).toBeNull());
    expect(screen.getByTestId('slide-counter')).toBeInTheDocument();
  });

  it('Beenden zwischen Anzeige und Wahl: ruhige Meldung, kein Satzwechsel', async () => {
    const user = userEvent.setup();
    open(session({ slide_deck_id: D1 }));
    const clear = await screen.findByRole('button', { name: 'Ohne Folien' });
    core.sessions[0]!.state = 'beendet';
    await user.click(clear);
    expect(await screen.findByText(/Diese Vorlesung ist schon beendet/)).toBeInTheDocument();
    expect(core.sessions[0]!.slide_deck_id).toBe(D1);
  });

  it('ein Satz in Verarbeitung oder ohne lesbaren Inhalt lässt sich noch wechseln', async () => {
    core.decks.find((d) => d.id === D1)!.ingest_state = 'fehler';
    open(session({ slide_deck_id: D1 }));
    expect(await screen.findByText('Der Foliensatz konnte nicht eingelesen werden.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Anderen Foliensatz wählen' })).toBeInTheDocument();
  });
});
