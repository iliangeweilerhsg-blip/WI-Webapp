// Folien beim Start (VERTRAEGE §22.7): Vorschlag auf der Start-Karte, „Ändern“, „Ohne Folien“-Merker, Start mit
// `slide_deck_id`, Wiederholung ohne Satz und der spontane Start. Gegen den Fake-Core nach Vertrag (`fake-decks.ts`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Vor allen Imports: Die Formatierer lesen die Zeitzone beim Laden
vi.hoisted(() => {
  process.env.TZ = 'Europe/Zurich';
});

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session, SlideDeck } from '@sg/shared';
import { AppShell } from '../src/components/AppShell.tsx';
import { HeuteView } from '../src/components/HeuteView.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { sessionHref } from '../src/lib/sessions.ts';
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

function fakeSync() {
  const client = {
    connectionState: 'online',
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    onEvent: vi.fn(() => () => undefined),
    takeOver: vi.fn(),
    listShelf: vi.fn(async () => []),
    subscribe: vi.fn(),
  };
  return client as unknown as SyncClient;
}

let core: CalendarCore;

function boot(opts: { sessions?: Session[]; holdOptions?: boolean } = {}) {
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
  if (opts.holdOptions) {
    const coreFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/deck-options')
        ? new Promise<Response>(() => undefined)
        : coreFetch(input, init),
    );
  }
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
const patch = () => core.requests.filter((r) => r.method === 'PATCH' && r.path === `/sessions/${SESSION_ID}`);
const row = () => screen.findByTestId('start-deck');
const card = () => screen.getByRole('region', { name: /Datenbanksysteme/ });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  window.sessionStorage.clear();
  push.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Start-Karte: Folien', () => {
  it('zeigt den Vorschlag unter dem Titel, bei Moodle mit „aus Moodle“', async () => {
    boot();
    expect(await row()).toHaveTextContent('Folien: VL 07 Transaktionen aus Moodle');
    // Die Abfrage gehört der Session, nicht nur dem Modul
    expect(
      core.requests.some(
        (r) => r.method === 'GET' && r.path === `/modules/${DBS.id}/deck-options?session_id=${SESSION_ID}`,
      ),
    ).toBe(true);
    // Der Vorschlag wird nur angezeigt, nicht still gesetzt
    expect(core.sessions.find((s) => s.id === SESSION_ID)?.slide_deck_id).toBeNull();
    expect(patch()).toHaveLength(0);
  });

  it('ein Tipp startet wie bisher und schickt den Vorschlag als slide_deck_id mit', async () => {
    const user = userEvent.setup();
    boot();
    await row();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(sessionHref(SESSION_ID)));
    expect(post(/\/start$/)).toHaveLength(1);
    expect(post(/\/start$/)[0]!.body).toEqual({ started_from: 'mac', slide_deck_id: D2 });
    expect(core.sessions.find((s) => s.id === SESSION_ID)?.slide_deck_id).toBe(D2);
  });

  it('wartet nie auf die Folien: Ohne Antwort der Optionen startet der Tipp ohne Satz', async () => {
    const user = userEvent.setup();
    boot({ holdOptions: true });
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(sessionHref(SESSION_ID)));
    expect(post(/\/start$/)[0]!.body).toEqual({ started_from: 'mac' });
    // Die Zeile zeigt dann nichts
    expect(screen.queryByTestId('start-deck')).toBeNull();
  });

  it('scheitern die Optionen, startet der Tipp ohne Satz und die Zeile bleibt weg', async () => {
    const user = userEvent.setup();
    boot();
    core.modules = core.modules.filter((m) => m.id !== DBS.id); // `deck-options` antwortet 404 module_not_found
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(post(/\/start$/)[0]!.body).toEqual({ started_from: 'mac' });
    expect(screen.queryByTestId('start-deck')).toBeNull();
  });

  it('ohne Vorschlag steht „Ohne Folien“, der Start schickt kein Feld', async () => {
    const user = userEvent.setup();
    // Alle Sätze sind belegt
    boot({
      sessions: [
        planned(),
        { ...VL6, slide_deck_id: D3 },
        { ...VL6, id: '0190f6a2-0000-7000-8000-0000000000e5', number: 5, slide_deck_id: D1 },
        { ...VL6, id: '0190f6a2-0000-7000-8000-0000000000e4', number: 4, slide_deck_id: D2 },
      ],
    });
    expect(await row()).toHaveTextContent('Ohne Folien');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(post(/\/start$/)[0]!.body).toEqual({ started_from: 'mac' });
  });

  it('eine Session mit Satz zeigt ihn und schickt beim Start nichts mit', async () => {
    const user = userEvent.setup();
    boot({ sessions: [planned({ slide_deck_id: D1 }), VL6] });
    expect(await row()).toHaveTextContent('Folien: VL 05 Normalformen');
    expect(screen.getByTestId('start-deck')).not.toHaveTextContent('aus Moodle');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(post(/\/start$/)[0]!.body).toEqual({ started_from: 'mac' });
    expect(core.sessions.find((s) => s.id === SESSION_ID)?.slide_deck_id).toBe(D1);
  });

  it('Ändern klappt die Liste auf: Sätze, „schon in VL 6“, „Ohne Folien“ und „PDF hochladen …“', async () => {
    const user = userEvent.setup();
    boot();
    await row();
    const change = screen.getByRole('button', { name: 'Ändern' });
    expect(change).toHaveAttribute('aria-expanded', 'false');
    await user.click(change);
    expect(change).toHaveAttribute('aria-expanded', 'true');
    // Kein Dialog
    expect(screen.queryByRole('dialog')).toBeNull();
    const list = screen.getByRole('list', { name: 'Foliensätze' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('Ohne Folien');
    expect(items[1]).toHaveTextContent('VL 07 Transaktionen');
    expect(items[1]).toHaveTextContent('aus Moodle');
    expect(items[1]).toHaveTextContent('gewählt');
    expect(items[2]).toHaveTextContent('VL 06 Indizes');
    expect(items[2]).toHaveTextContent('schon in VL 6');
    expect(items[3]).toHaveTextContent('VL 05 Normalformen');
    expect(items[4]).toHaveTextContent('PDF hochladen …');
    // Der erste Eintrag hat den Fokus; die Zeilen sind mindestens 44 px hoch (min-h-11)
    expect(within(items[0]!).getByRole('button')).toHaveFocus();
    expect(within(items[1]!).getByRole('button')).toHaveClass('min-h-11');
    // Pfeil runter bewegt den Fokus in der Liste
    await user.keyboard('{ArrowDown}');
    expect(within(items[1]!).getByRole('button')).toHaveFocus();
  });

  it('Esc schließt die Liste und der Fokus geht zurück auf „Ändern“', async () => {
    const user = userEvent.setup();
    boot();
    await row();
    const change = screen.getByRole('button', { name: 'Ändern' });
    await user.click(change);
    expect(screen.getByRole('list', { name: 'Foliensätze' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('list', { name: 'Foliensätze' })).toBeNull();
    expect(change).toHaveFocus();
    expect(patch()).toHaveLength(0);
  });

  it('eine Wahl speichert sofort per PATCH, die Zeile folgt und der Start schickt kein Feld mehr', async () => {
    const user = userEvent.setup();
    boot();
    await row();
    await user.click(screen.getByRole('button', { name: 'Ändern' }));
    await user.click(
      within(screen.getByRole('list', { name: 'Foliensätze' })).getByText('VL 05 Normalformen'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('start-deck')).toHaveTextContent('Folien: VL 05 Normalformen'),
    );
    expect(patch()).toHaveLength(1);
    expect(patch()[0]!.body).toEqual({ slide_deck_id: D1 });
    expect(screen.queryByRole('list', { name: 'Foliensätze' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ändern' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(post(/\/start$/)[0]!.body).toEqual({ started_from: 'mac' });
    expect(core.sessions.find((s) => s.id === SESSION_ID)?.slide_deck_id).toBe(D1);
  });

  it('„Ohne Folien“ ohne Satz: kein PATCH, ein Merker im sessionStorage, der Start schickt kein Feld', async () => {
    const user = userEvent.setup();
    const view = boot();
    await row();
    await user.click(screen.getByRole('button', { name: 'Ändern' }));
    await user.click(within(screen.getByRole('list', { name: 'Foliensätze' })).getByText('Ohne Folien'));
    await waitFor(() => expect(screen.getByTestId('start-deck')).toHaveTextContent('Ohne Folien'));
    expect(screen.getByTestId('start-deck')).not.toHaveTextContent('Transaktionen');
    expect(patch()).toHaveLength(0);
    expect(window.sessionStorage.getItem(`sg.folien.ohne.${SESSION_ID}`)).toBe('1');

    // Der Merker übersteht ein Neuladen der Seite
    view.unmount();
    cleanup();
    boot();
    expect(await row()).toHaveTextContent('Ohne Folien');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(post(/\/start$/)[0]!.body).toEqual({ started_from: 'mac' });
    expect(core.sessions.find((s) => s.id === SESSION_ID)?.slide_deck_id).toBeNull();
  });

  it('„Ohne Folien“ bei einer Session mit Satz leert ihn per PATCH null und merkt es', async () => {
    const user = userEvent.setup();
    boot({ sessions: [planned({ slide_deck_id: D1 }), VL6] });
    await row();
    await user.click(screen.getByRole('button', { name: 'Ändern' }));
    await user.click(within(screen.getByRole('list', { name: 'Foliensätze' })).getByText('Ohne Folien'));
    await waitFor(() => expect(screen.getByTestId('start-deck')).toHaveTextContent('Ohne Folien'));
    expect(patch()[0]!.body).toEqual({ slide_deck_id: null });
    expect(core.sessions.find((s) => s.id === SESSION_ID)?.slide_deck_id).toBeNull();
    expect(window.sessionStorage.getItem(`sg.folien.ohne.${SESSION_ID}`)).toBe('1');
  });

  it('eine ausdrückliche Wahl löscht den Merker „Ohne Folien“', async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem(`sg.folien.ohne.${SESSION_ID}`, '1');
    boot();
    expect(await row()).toHaveTextContent('Ohne Folien');
    await user.click(screen.getByRole('button', { name: 'Ändern' }));
    await user.click(
      within(screen.getByRole('list', { name: 'Foliensätze' })).getByText('VL 07 Transaktionen'),
    );
    await waitFor(() => expect(screen.getByTestId('start-deck')).toHaveTextContent('Folien: VL 07'));
    expect(window.sessionStorage.getItem(`sg.folien.ohne.${SESSION_ID}`)).toBeNull();
  });

  it.each([
    ['gelöscht', (deck: SlideDeck) => (deck.deleted_at = '2026-11-04T07:05:00Z')],
    ['aus einem anderen Modul', (deck: SlideDeck) => (deck.module_id = STAT.id)],
  ])('lehnt der Core den Satz ab (%s), startet die Karte einmal ohne', async (_name, spoil) => {
    const user = userEvent.setup();
    boot();
    await row();
    spoil(core.decks.find((d) => d.id === D2)!);
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(sessionHref(SESSION_ID)));
    const starts = post(/\/start$/);
    expect(starts).toHaveLength(2);
    expect(starts[0]!.body).toEqual({ started_from: 'mac', slide_deck_id: D2 });
    expect(starts[1]!.body).toEqual({ started_from: 'mac' });
    expect(core.sessions.find((s) => s.id === SESSION_ID)?.state).toBe('laeuft');
    expect(core.sessions.find((s) => s.id === SESSION_ID)?.slide_deck_id).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ein anderer Fehler beim Start bleibt ein Fehler und wird nicht ohne Satz wiederholt', async () => {
    const user = userEvent.setup();
    boot();
    await row();
    core.rejectNextSession = { status: 409, code: 'session_transition_invalid' };
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(await within(card()).findByRole('alert')).toBeInTheDocument();
    expect(post(/\/start$/)).toHaveLength(1);
  });

  it('eine Wahl, die der Core ablehnt, erklärt es ruhig (kein Alarm) und lädt die Liste neu', async () => {
    const user = userEvent.setup();
    boot();
    await row();
    await user.click(screen.getByRole('button', { name: 'Ändern' }));
    core.decks.find((d) => d.id === D1)!.deleted_at = '2026-11-04T07:05:00Z';
    await user.click(
      within(screen.getByRole('list', { name: 'Foliensätze' })).getByText('VL 05 Normalformen'),
    );
    expect(await screen.findByText('Dieser Foliensatz ist nicht mehr da.')).toBeInTheDocument();
    expect(
      screen.getByText('Dieser Foliensatz ist nicht mehr da.').closest('[role="status"]'),
    ).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('„PDF hochladen …“ lädt mit session_id hoch und die Zeile zeigt den neuen Satz', async () => {
    const user = userEvent.setup();
    boot();
    await row();
    await user.click(screen.getByRole('button', { name: 'Ändern' }));
    const input = screen.getByLabelText('PDF-Dateien auswählen', { selector: 'input' }) as HTMLInputElement;
    const file = new File(['%PDF-1.4'], 'Mein_Skript.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(core.decks.some((d) => d.title === 'Mein Skript')).toBe(true));
    const created = core.decks.find((d) => d.title === 'Mein Skript')!;
    // Die Session hat keinen Satz, der Upload hängt an (Core)
    expect(core.sessions.find((s) => s.id === SESSION_ID)?.slide_deck_id).toBe(created.id);
    expect(screen.queryByRole('list', { name: 'Foliensätze' })).toBeNull();
    await waitFor(() => expect(screen.getByTestId('start-deck')).toHaveTextContent('Folien: Mein Skript'));
  });
});

describe('Spontaner Start: Folien', () => {
  async function chooseModule(user: ReturnType<typeof userEvent.setup>) {
    await user.selectOptions(await screen.findByLabelText('Modul'), DBS.id);
    return screen.findByTestId('spontan-deck');
  }

  it('zeigt den Vorschlag unter dem Modul und schickt ihn mit POST /sessions', async () => {
    const user = userEvent.setup();
    boot();
    expect(await chooseModule(user)).toHaveTextContent('Folien: VL 07 Transaktionen aus Moodle');
    // Ohne session_id gefragt: Der Vorschlag gilt für das Modul
    expect(
      core.requests.some((r) => r.method === 'GET' && r.path === `/modules/${DBS.id}/deck-options`),
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Session starten' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const created = post(/^\/sessions$/);
    expect(created).toHaveLength(1);
    expect(created[0]!.body).toMatchObject({ module_id: DBS.id, slide_deck_id: D2 });
    const made = core.sessions.find((s) => s.id === (created[0]!.body as { id: string }).id);
    expect(made?.slide_deck_id).toBe(D2);
    expect(made?.state).toBe('laeuft');
  });

  it('„Ohne Folien“ ist ein Klick: POST /sessions ohne Feld, „Folien nehmen“ holt den Vorschlag zurück', async () => {
    const user = userEvent.setup();
    boot();
    const line = await chooseModule(user);
    await user.click(within(line).getByRole('button', { name: 'Ohne Folien' }));
    expect(line).toHaveTextContent('Ohne Folien');
    expect(line).not.toHaveTextContent('Transaktionen');
    await user.click(within(line).getByRole('button', { name: 'Folien nehmen' }));
    expect(line).toHaveTextContent('Folien: VL 07 Transaktionen');
    await user.click(within(line).getByRole('button', { name: 'Ohne Folien' }));
    await user.click(screen.getByRole('button', { name: 'Session starten' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const body = post(/^\/sessions$/)[0]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('slide_deck_id');
  });

  it('ohne geladene Optionen startet er ohne Satz', async () => {
    const user = userEvent.setup();
    boot({ holdOptions: true });
    await user.selectOptions(await screen.findByLabelText('Modul'), DBS.id);
    await user.click(screen.getByRole('button', { name: 'Session starten' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(post(/^\/sessions$/)[0]!.body as Record<string, unknown>).not.toHaveProperty('slide_deck_id');
  });

  it('lehnt der Core den Satz ab, wird das Anlegen einmal ohne Satz wiederholt', async () => {
    const user = userEvent.setup();
    boot();
    const line = await chooseModule(user);
    expect(line).toHaveTextContent('Transaktionen');
    core.decks.find((d) => d.id === D2)!.deleted_at = '2026-11-04T07:05:00Z';
    await user.click(screen.getByRole('button', { name: 'Session starten' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const created = post(/^\/sessions$/);
    expect(created).toHaveLength(2);
    expect(created[0]!.body).toMatchObject({ slide_deck_id: D2 });
    expect(created[1]!.body as Record<string, unknown>).not.toHaveProperty('slide_deck_id');
    // Beide Versuche tragen dieselbe Session-ID
    expect((created[1]!.body as { id: string }).id).toBe((created[0]!.body as { id: string }).id);
    expect(post(/\/start$/)).toHaveLength(1);
  });
});
