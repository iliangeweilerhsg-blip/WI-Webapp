// Live-Dashboard (T1-04): Layout und Vorlagen, Statusleiste, Aktionen, Live-Aktualisierung, Notizen, Auto-Stopp.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQuery } from '@tanstack/react-query';
import type { CalendarEvent, Notebook, Session } from '@sg/shared';
import { PAIRING_REQUESTS_KEY } from '../src/lib/devices.ts';
import { SessionView } from '../src/components/dashboard/SessionView.tsx';
import { RecordingEnvContext } from '../src/components/dashboard/use-recording.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { makeEvent } from './calendar-core.ts';
import { fakeRecording } from './recording-fakes.ts';
import { SyncProvider } from '../src/lib/sync/SyncProvider.tsx';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { AppearanceDefault, ThemeProvider } from '../src/lib/theme.tsx';
import {
  installFakeCore,
  makeDevice,
  makeModule,
  makeSemester,
  makeSession,
  type FakeCore,
} from './fake-core.ts';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/session',
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../src/components/ink', () => ({
  InkColumn: ({ notebookId }: { notebookId: string }) => <div data-testid="ink-column">{notebookId}</div>,
}));

const DBS = makeModule({
  id: '0190f6a2-0000-7000-8000-0000000000a3',
  name: 'Datenbanksysteme',
  color: 'mod-03',
});
const SESSION_ID = '0190f6a2-0000-7000-8000-0000000000e1';
const NOW = '2026-11-04T08:42:13Z';
const STARTED = '2026-11-04T08:00:00Z';

function running(overrides: Partial<Session> = {}): Session {
  return makeSession({
    id: SESSION_ID,
    module_id: DBS.id,
    number: 7,
    state: 'laeuft',
    started_at: STARTED,
    created_at: '2026-11-03T08:00:00Z',
    updated_at: '2026-11-04T08:00:00Z',
    ...overrides,
  });
}

const notebook = (id: string, kind: Notebook['kind'], created: string): Notebook => ({
  id,
  user_id: '0190f6a2-0000-7000-8000-000000000000',
  created_at: created,
  updated_at: created,
  deleted_at: null,
  module_id: DBS.id,
  title: kind,
  kind,
  page_count: 0,
});
const NB_UEBUNG = notebook('0190f6a2-0000-7000-8000-0000000000c2', 'uebung', '2026-11-01T08:00:00Z');
const NB_VL = notebook('0190f6a2-0000-7000-8000-0000000000c3', 'vorlesung', '2026-11-01T08:00:01Z');

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

function stubWidth(wide: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('min-width') ? wide : !wide,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

let core: FakeCore;
let sync: ReturnType<typeof fakeSync>;

function boot(
  opts: {
    session?: Session | null;
    module?: ReturnType<typeof makeModule>;
    wide?: boolean;
    syncState?: string;
    notebooks?: Notebook[];
    events?: CalendarEvent[];
    appearance?: 'system' | 'hell' | 'dunkel';
    extra?: ReactNode;
    hold?: { settings?: Promise<void>; event?: Promise<void> };
    devices?: ReturnType<typeof makeDevice>[];
    now?: string;
    search?: string;
  } = {},
) {
  vi.setSystemTime(new Date(opts.now ?? NOW));
  stubWidth(opts.wide ?? true);
  nav.search = opts.search ?? `id=${SESSION_ID}`;
  core = installFakeCore({
    semesters: [makeSemester()],
    modules: [opts.module ?? DBS],
    sessions: opts.session === null ? [] : [opts.session ?? running()],
  });
  core.notebooks = opts.notebooks ?? [NB_UEBUNG, NB_VL];
  core.events = opts.events ?? [];
  core.settings.general.appearance = opts.appearance ?? 'system';
  core.devices = opts.devices ?? [];
  core.settingsGate = opts.hold?.settings ?? null;
  core.eventGate = opts.hold?.event ?? null;
  sync = fakeSync(opts.syncState);
  return render(
    <ThemeProvider>
      <QueryProvider>
        <RecordingEnvContext.Provider value={fakeRecording().env}>
          <SyncProvider client={sync.client}>
            <AppearanceDefault />
            <SessionView />
            {opts.extra}
          </SyncProvider>
        </RecordingEnvContext.Provider>
      </QueryProvider>
    </ThemeProvider>,
  );
}

const posts = (path: RegExp) => core.requests.filter((r) => r.method === 'POST' && path.test(r.path));
const patches = () => core.requests.filter((r) => r.method === 'PATCH' && /^\/modules\//.test(r.path));
const bar = () => screen.getByLabelText('Statusleiste');
const gets = (path: string) => core.requests.filter((r) => r.method === 'GET' && r.path === path).length;
const grid = () => screen.getByTestId('dashboard-grid');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Dashboard: Aufbau', () => {
  it('zeigt Kopf, drei Spalten, Platzhalter und die Statusleiste mit Laufzeit', async () => {
    boot();
    expect(
      await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme · Vorlesung 7/ }),
    ).toBeVisible();
    expect(screen.getByRole('group', { name: 'Folie' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Übung' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Notizen' })).toBeVisible();
    expect(screen.getByTestId('slides-panel')).toHaveTextContent(
      'Folien kommen später – einfach mitschreiben',
    );
    expect(screen.getByTestId('exercise-column')).toHaveTextContent('keine Aufgabe zu dieser Folie');
    expect(screen.getByTestId('marker-controls')).toBeInTheDocument();
    expect(await within(bar()).findByText('REC')).toBeVisible();
    expect(within(bar()).getByTestId('elapsed')).toHaveTextContent('00:42:13');
    expect(within(bar()).getByRole('button', { name: 'Pause' })).toBeVisible();
    expect(within(bar()).getByRole('button', { name: 'Beenden' })).toBeVisible();
    expect(within(bar()).getByTestId('live-status')).toHaveTextContent('Live');
    expect(within(bar()).getByTestId('ipad-status')).toHaveTextContent('iPad');
  });

  it('Notizen: das Notizbuch „Vorlesung“ des Moduls kommt in die Spalte', async () => {
    boot();
    const col = await screen.findByRole('group', { name: 'Notizen' });
    expect(await within(col).findByTestId('ink-column')).toHaveTextContent(NB_VL.id);
    expect(core.requests.some((r) => r.path === `/notebooks?module_id=${DBS.id}`)).toBe(true);
  });

  it('Notizen: ohne Notizbuch steht ein ruhiger Hinweis', async () => {
    boot({ notebooks: [] });
    expect(await screen.findByText('Zu diesem Modul gibt es noch kein Notizbuch.')).toBeVisible();
  });

  it('ohne ?id steht ein Hinweis mit Weg zurück', async () => {
    boot({ search: '' });
    expect(await screen.findByText('Keine Session ausgewählt.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Zu Heute' })).toHaveAttribute('href', '/');
  });

  it('unbekannte Session: 404 wird ruhig gemeldet', async () => {
    boot({ session: null });
    expect(await screen.findByText('Diese Session gibt es nicht (mehr).')).toBeVisible();
  });

  it('nicht gestartete Session: keine Steuerung, Wege zu Heute und Modul', async () => {
    boot({ session: running({ state: 'bereit', started_at: null }) });
    expect(await within(await screenBar()).findByText('Nicht gestartet')).toBeVisible();
    expect(within(bar()).queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(within(bar()).getByRole('link', { name: 'Zum Modul' })).toBeVisible();
  });
});

async function screenBar() {
  await screen.findByLabelText('Statusleiste');
  return bar();
}

describe('Dashboard: Steuerung über die Statusleiste', () => {
  it('Pause, Fortsetzen, Beenden rufen die Session-Funktionen auf und zeigen den neuen Zustand', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot();
    await user.click(await within(await screenBar()).findByRole('button', { name: 'Pause' }));
    await within(bar()).findByText('Pausiert');
    expect(posts(/\/sessions\/[^/]+\/pause$/)).toHaveLength(1);
    expect(within(bar()).queryByTestId('elapsed')).toBeNull();

    await user.click(within(bar()).getByRole('button', { name: 'Fortsetzen' }));
    await within(bar()).findByText('REC');
    expect(posts(/\/resume$/)).toHaveLength(1);

    await user.click(within(bar()).getByRole('button', { name: 'Beenden' }));
    await within(bar()).findByText('Beendet');
    expect(posts(/\/stop$/)).toHaveLength(1);
    expect(within(bar()).getByTestId('elapsed')).toHaveTextContent('00:42:13');
    expect(within(bar()).queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(within(bar()).getByRole('link', { name: 'Zu Heute' })).toBeVisible();
  });

  it('ein abgelehnter Wechsel zeigt die Meldung ruhig und lädt neu', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    core.rejectNextSession = { status: 409, code: 'session_transition_invalid' };
    await user.click(within(b).getByRole('button', { name: 'Pause' }));
    expect(await within(b).findByRole('alert')).toBeVisible();
    await waitFor(() =>
      expect(
        core.requests.filter((r) => r.method === 'GET' && r.path === `/sessions/${SESSION_ID}`).length,
      ).toBeGreaterThan(1),
    );
  });
});

describe('Dashboard: Live-Aktualisierung (session.updated)', () => {
  it('übernimmt neuere Fassungen, verwirft ältere und nimmt Gleichstand an', async () => {
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');

    act(() =>
      sync.emit('session.updated', running({ state: 'pausiert', updated_at: '2026-11-04T08:10:00Z' })),
    );
    await within(b).findByText('Pausiert');

    // älter: ignoriert (erst nach dem Rendern prüfen, sonst sähe die Prüfung den alten Stand auch bei Fehlern)
    await act(async () => {
      sync.emit('session.updated', running({ state: 'laeuft', updated_at: '2026-11-04T08:05:00Z' }));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(within(b).getByText('Pausiert')).toBeVisible();
    expect(within(b).queryByText('REC')).toBeNull();

    // gleich alt: angenommen
    act(() => sync.emit('session.updated', running({ state: 'laeuft', updated_at: '2026-11-04T08:10:00Z' })));
    await within(b).findByText('REC');

    // andere Session: ignoriert
    await act(async () => {
      sync.emit(
        'session.updated',
        running({
          id: '0190f6a2-0000-7000-8000-0000000000e9',
          state: 'beendet',
          updated_at: '2026-11-04T09:00:00Z',
        }),
      );
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(within(b).getByText('REC')).toBeVisible();

    act(() =>
      sync.emit(
        'session.updated',
        running({ state: 'beendet', ended_at: NOW, updated_at: '2026-11-04T08:42:00Z' }),
      ),
    );
    await within(b).findByText('Beendet');
  });

  it('ohne Live-Verbindung steht „Offline“ in der Leiste und ein Hinweis darüber', async () => {
    boot({ syncState: 'backoff' });
    const b = await screenBar();
    expect(within(b).getByTestId('live-status')).toHaveTextContent('Offline');
    expect(screen.getByText('Keine Live-Verbindung – der Stand wird regelmäßig neu geholt.')).toBeVisible();
    act(() => sync.setState('online'));
    await waitFor(() => expect(within(b).getByTestId('live-status')).toHaveTextContent('Live'));
  });

  it('ein Ereignis während eines laufenden Abrufs wird nicht von der älteren Antwort überschrieben', async () => {
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    const before = gets(`/sessions/${SESSION_ID}`);
    let release!: () => void;
    core.getGate = new Promise<void>((r) => (release = r));
    // Verbindung bricht ab und kommt wieder: Neuladen startet, die Antwort (Stand „läuft“) hängt
    act(() => sync.setState('backoff'));
    act(() => sync.setState('online'));
    await waitFor(() => expect(gets(`/sessions/${SESSION_ID}`)).toBe(before + 1));
    act(() =>
      sync.emit('session.updated', running({ state: 'pausiert', updated_at: '2026-11-04T08:10:00Z' })),
    );
    await within(b).findByText('Pausiert');
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(within(b).getByText('Pausiert')).toBeVisible();
    expect(within(b).queryByText('REC')).toBeNull();
  });

  it('nach einem Verbindungsabbruch lädt die Ansicht neu, sobald es wieder online ist', async () => {
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    const before = gets(`/sessions/${SESSION_ID}`);
    act(() => sync.setState('backoff'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(gets(`/sessions/${SESSION_ID}`)).toBe(before);
    act(() => sync.setState('online'));
    await waitFor(() => expect(gets(`/sessions/${SESSION_ID}`)).toBe(before + 1));
  });

  it('ohne Live-Verbindung fragt die Ansicht alle 30 s nach, auch wenn der Zustand hin und her springt', async () => {
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    // Ab hier laufen die Intervalle auf der Fake-Uhr
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(NOW));
    const before = gets(`/sessions/${SESSION_ID}`);
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
    expect(gets(`/sessions/${SESSION_ID}`)).toBeGreaterThanOrEqual(before + 2);
  });

  it('online wird nicht nachgefragt (weder Session noch iPad-Punkt)', async () => {
    // Die Fake-Uhr läuft schon beim Aufbau, sonst entstünde das Intervall auf der echten Uhr und der Test sähe es nie
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    await waitFor(() => expect(gets('/devices?limit=200')).toBe(1));
    const before = gets(`/sessions/${SESSION_ID}`);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(gets(`/sessions/${SESSION_ID}`)).toBe(before);
    expect(gets('/devices?limit=200')).toBe(1);
  });

  it('Folge-Tab: „Anderer Tab“ statt „Live“', async () => {
    boot({ syncState: 'other_tab' });
    const b = await screenBar();
    expect(within(b).getByTestId('live-status')).toHaveTextContent('Anderer Tab');
    expect(within(b).getByTestId('live-status')).not.toHaveTextContent('Live');
    expect(screen.queryByText(/Keine Live-Verbindung –/)).toBeNull();
  });
});

describe('Dashboard: iPad-Punkt (nur aus REST)', () => {
  const ipad = (connected: boolean) => makeDevice({ kind: 'ipad', connected });

  it('device.connection löst nur ein Neuladen aus und der Punkt folgt dem REST-Stand', async () => {
    boot({ devices: [ipad(false)] });
    const b = await screenBar();
    await waitFor(() => expect(gets('/devices?limit=200')).toBe(1));
    expect(within(b).getByTestId('ipad-status')).toHaveTextContent('nicht verbunden');
    core.devices[0]!.connected = true;
    act(() => sync.emit('device.connection', { client: 'ipad', connected: true }));
    await waitFor(() =>
      expect(within(b).getByTestId('ipad-status')).not.toHaveTextContent('nicht verbunden'),
    );
    expect(gets('/devices?limit=200')).toBe(2);
  });

  it('das Ereignis allein überschreibt den REST-Stand nicht', async () => {
    boot({ devices: [ipad(false)] });
    const b = await screenBar();
    await waitFor(() => expect(gets('/devices?limit=200')).toBe(1));
    // Ein anderes iPad meldet „verbunden“, das gekoppelte ist es laut Core nicht
    await act(async () => {
      sync.emit('device.connection', { client: 'ipad', connected: true });
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(gets('/devices?limit=200')).toBe(2);
    expect(within(b).getByTestId('ipad-status')).toHaveTextContent('nicht verbunden');
  });

  it('nach einem Verbindungsabbruch wird neu geladen (Ereignisse kommen nicht nach)', async () => {
    boot({ devices: [ipad(false)] });
    const b = await screenBar();
    await waitFor(() => expect(gets('/devices?limit=200')).toBe(1));
    core.devices[0]!.connected = true;
    act(() => sync.setState('backoff'));
    act(() => sync.setState('online'));
    await waitFor(() =>
      expect(within(b).getByTestId('ipad-status')).not.toHaveTextContent('nicht verbunden'),
    );
  });
});

describe('Dashboard: Layout pro Modul', () => {
  it('gespeicherte Vorlage und Breiten aus module.settings werden angewendet', async () => {
    boot({ module: makeModule({ ...DBS, settings: { layout: 'standard', column_widths: [40, 30, 30] } }) });
    await screen.findByTestId('dashboard-grid');
    await waitFor(() => expect(grid().style.gridTemplateColumns).toMatch(/^minmax\(0, 40fr\)/));
    expect(grid().style.gridTemplateColumns).toMatch(/minmax\(0, 30fr\) 12px minmax\(0, 30fr\)$/);
  });

  it('Standard ohne Einstellung: 50/25/25; Taste 2 wählt „Folie groß“ und speichert pro Modul', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot();
    await screen.findByTestId('dashboard-grid');
    expect(grid().style.gridTemplateColumns).toMatch(/^minmax\(0, 50fr\)/);
    await user.keyboard('2');
    await waitFor(() => expect(grid().style.gridTemplateColumns).toMatch(/^minmax\(0, 70fr\)/));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]?.path).toBe(`/modules/${DBS.id}`);
    expect(patches()[0]?.body).toEqual({ settings: { layout: 'folie_gross', column_widths: null } });
    await waitFor(() => expect(core.modules[0]?.settings).toEqual({ layout: 'folie_gross' }));
    expect(screen.getByRole('button', { name: 'Folie groß' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Tasten 1 bis 4 wechseln; „Fokus“ zeigt nur die Folie; beim Tippen in Feldern keine Wirkung', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot();
    await screen.findByTestId('dashboard-grid');
    await user.keyboard('3');
    await waitFor(() => expect(grid().style.gridTemplateColumns).toMatch(/^minmax\(0, 25fr\)/));
    await user.keyboard('4');
    await waitFor(() => expect(screen.queryByTestId('dashboard-grid')).toBeNull());
    expect(screen.getByRole('group', { name: 'Folie' })).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Notizen' })).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    await user.keyboard('1');
    await screen.findByTestId('dashboard-grid');

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    await user.keyboard('3');
    input.remove();
    expect(grid().style.gridTemplateColumns).toMatch(/^minmax\(0, 50fr\)/);
  });

  it('Spaltenbreite per Tastatur: Anzeige sofort, mehrere Tasten ergeben einen verzögerten PATCH mit layout', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot();
    await screen.findByTestId('dashboard-grid');
    const sep = screen.getByRole('separator', { name: 'Breite von Folie und Übung' });
    expect(sep).toHaveAttribute('aria-valuenow', '50');
    expect(sep).toHaveAttribute('aria-valuetext', 'Folie 50 %');
    sep.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(grid().style.gridTemplateColumns).toMatch(/^minmax\(0, 54fr\)/);
    expect(patches()).toHaveLength(0);
    const after = screen.getByRole('separator', { name: 'Breite von Folie und Übung' });
    expect(after).toHaveAttribute('aria-valuenow', '54');
    expect(after).toHaveAttribute('aria-valuetext', 'Folie 54 %');
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]?.body).toEqual({ settings: { layout: 'standard', column_widths: [54, 21, 25] } });
    await new Promise((r) => setTimeout(r, 600));
    expect(patches()).toHaveLength(1);
  });

  it('Home und End setzen die Trennlinie auf Minimum bzw. Maximum', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot();
    await screen.findByTestId('dashboard-grid');
    const sep = screen.getByRole('separator', { name: 'Breite von Folie und Übung' });
    sep.focus();
    await user.keyboard('{Home}');
    expect(grid().style.gridTemplateColumns).toMatch(/^minmax\(0, 25fr\) 12px minmax\(0, 50fr\)/);
    await user.keyboard('{End}');
    expect(grid().style.gridTemplateColumns).toMatch(/^minmax\(0, 67fr\) 12px minmax\(0, 8fr\)/);
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]?.body).toEqual({ settings: { layout: 'standard', column_widths: [67, 8, 25] } });
    expect(screen.getByRole('separator', { name: 'Breite von Übung und Notizen' })).toHaveAttribute(
      'aria-valuetext',
      'Übung 8 %',
    );
  });

  it('Tasten 1 bis 4 gelten nach der physischen Taste (code), nicht nach dem Zeichen', async () => {
    boot();
    await screen.findByTestId('dashboard-grid');
    fireEvent.keyDown(window, { key: 'é', code: 'Digit4' });
    await waitFor(() => expect(screen.queryByTestId('dashboard-grid')).toBeNull());
  });

  it('unbrauchbare gespeicherte Breiten (Spalte zu schmal, Folie zu schmal) gelten nicht', async () => {
    const { unmount } = boot({
      module: makeModule({ ...DBS, settings: { column_widths: [60, 38, 2] } }),
    });
    await screen.findByTestId('dashboard-grid');
    await waitFor(() => expect(core.requests.some((r) => r.path === '/modules?limit=100')).toBe(true));
    await within(await screenBar()).findByText('REC');
    expect(grid().style.gridTemplateColumns).toMatch(/^minmax\(0, 50fr\) 12px minmax\(0, 25fr\)/);
    unmount();
    boot({ module: makeModule({ ...DBS, settings: { column_widths: [20, 40, 40] } }) });
    await within(await screenBar()).findByText('REC');
    await waitFor(() => expect(grid().style.gridTemplateColumns).toMatch(/^minmax\(0, 50fr\)/));
  });

  it('Ziehen mit der Maus: Vorschau beim Bewegen, Speichern beim Loslassen', async () => {
    boot();
    await screen.findByTestId('dashboard-grid');
    vi.spyOn(grid(), 'getBoundingClientRect').mockReturnValue({ width: 1224, left: 0 } as DOMRect);
    const sep = screen.getByRole('separator', { name: 'Breite von Übung und Notizen' });
    // nutzbare Breite 1200 px, also 12 px je Prozent: +120 px = +10 %
    fireEvent.pointerDown(sep, { clientX: 1000, pointerId: 1, button: 0 });
    fireEvent.pointerMove(sep, { clientX: 1120, pointerId: 1 });
    expect(grid().style.gridTemplateColumns).toMatch(
      /^minmax\(0, 50fr\) 12px minmax\(0, 35fr\) 12px minmax\(0, 15fr\)$/,
    );
    expect(patches()).toHaveLength(0);
    fireEvent.pointerUp(sep, { clientX: 1120, pointerId: 1 });
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]?.body).toEqual({ settings: { layout: 'standard', column_widths: [50, 35, 15] } });
  });

  it('scheitert das Speichern, bleibt die Wahl und ein Hinweis steht da', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot();
    await screen.findByTestId('dashboard-grid');
    core.down = true;
    await user.keyboard('2');
    expect(await screen.findByText(/Layout nicht gespeichert/)).toBeVisible();
    expect(grid().style.gridTemplateColumns).toMatch(/^minmax\(0, 70fr\)/);
  });
});

describe('Dashboard: schmal', () => {
  it('unter lg als Reiter mit einer Spalte, keine Trennlinien, Notizen erst im Reiter', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot({ wide: false });
    await screen.findByRole('tablist', { name: 'Spalten' });
    expect(screen.queryByTestId('dashboard-grid')).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Layout' })).toBeNull();
    expect(screen.getByTestId('slides-panel')).toBeVisible();
    expect(screen.queryByTestId('ink-column')).toBeNull();
    expect(core.requests.some((r) => r.path.startsWith('/notebooks'))).toBe(false);

    await user.click(screen.getByRole('tab', { name: 'Notizen' }));
    expect(await screen.findByTestId('ink-column')).toHaveTextContent(NB_VL.id);
    expect(screen.queryByTestId('slides-panel')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Übung' }));
    expect(screen.getByTestId('exercise-column')).toBeVisible();
    // Statusleiste bleibt in jedem Reiter
    expect(within(bar()).getByRole('button', { name: 'Pause' })).toBeVisible();
  });
});

describe('Dashboard: Auto-Stopp-Hinweis', () => {
  it('zeigt „Stoppt gleich · weiter aufnehmen“ vor der Grenze; Tipp verlängert ohne minutes', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    // 239,5 min nach dem Start: die Höchstdauer (240 min) ist in 30 s erreicht, Vorwarnung 60 s
    boot({ now: '2026-11-04T11:59:30Z' });
    const b = await screenBar();
    const hint = await within(b).findByText(/Stoppt gleich/, undefined, { timeout: 5000 });
    expect(hint).toBeVisible();
    await user.click(within(b).getByRole('button', { name: /Weiter aufnehmen/ }));
    await waitFor(() => expect(posts(/\/extend$/)).toHaveLength(1));
    expect(posts(/\/extend$/)[0]?.body).toEqual({});
    await waitFor(() => expect(within(b).queryByText(/Stoppt gleich/)).toBeNull());
  });

  it('keine Vorwarnung mitten in der Vorlesung', async () => {
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    expect(within(b).queryByText(/Stoppt gleich/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Folgepunkte aus T1-04 (Issue #107)
// ---------------------------------------------------------------------------------------------

const root = document.documentElement;

describe('Dashboard: Notizbuch nach Termintyp (Punkt 1)', () => {
  const EVENT_ID = '0190f6a2-0000-7000-8000-0000000000f1';
  const pick = async (kind: CalendarEvent['kind'] | 'fehlt' | 'ohne') => {
    const events = kind === 'fehlt' || kind === 'ohne' ? [] : [makeEvent({ id: EVENT_ID, kind })];
    boot({
      session: running({ calendar_event_id: kind === 'ohne' ? null : EVENT_ID }),
      events,
    });
    const col = await screen.findByRole('group', { name: 'Notizen' });
    return (await within(col).findByTestId('ink-column')).textContent;
  };

  it('Übung und Tutorium zeigen das Notizbuch „Übung“', async () => {
    expect(await pick('uebung')).toBe(NB_UEBUNG.id);
    expect(core.requests.some((r) => r.path === `/calendar/events/${EVENT_ID}`)).toBe(true);
    cleanup();
    expect(await pick('tutorium')).toBe(NB_UEBUNG.id);
  });

  it('Vorlesung, anderer Typ, Session ohne Termin und nicht erreichbarer Termin zeigen „Vorlesung“', async () => {
    expect(await pick('vorlesung')).toBe(NB_VL.id);
    cleanup();
    expect(await pick('pruefung')).toBe(NB_VL.id);
    cleanup();
    expect(await pick('ohne')).toBe(NB_VL.id);
    expect(core.requests.some((r) => r.path.startsWith('/calendar/events/'))).toBe(false);
    cleanup();
    // Der Termin gibt es nicht (404): die Notizen hängen nicht daran
    expect(await pick('fehlt')).toBe(NB_VL.id);
  });

  it('fehlt das Notizbuch „Übung“, gilt „Vorlesung“', async () => {
    boot({
      session: running({ calendar_event_id: EVENT_ID }),
      events: [makeEvent({ id: EVENT_ID, kind: 'uebung' })],
      notebooks: [NB_VL],
    });
    const col = await screen.findByRole('group', { name: 'Notizen' });
    expect(await within(col).findByTestId('ink-column')).toHaveTextContent(NB_VL.id);
  });
});

describe('Dashboard: Notizen-Spalte im Fehlerfall (Punkt 4)', () => {
  it('„Erneut versuchen“ lädt die Notizbücher neu', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot();
    core.failNotebooks = true;
    const col = await screen.findByRole('group', { name: 'Notizen' });
    expect(await within(col).findByText(/Notizen nicht erreichbar/)).toBeVisible();
    core.failNotebooks = false;
    await user.click(within(col).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(col).findByTestId('ink-column')).toHaveTextContent(NB_VL.id);
    expect(within(col).queryByRole('button', { name: 'Erneut versuchen' })).toBeNull();
  });
});

describe('Dashboard: Reiter unter lg (Punkt 5)', () => {
  it('aria-controls steht nur am aktiven Reiter und zeigt auf ein vorhandenes Panel', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot({ wide: false });
    await screen.findByRole('tablist', { name: 'Spalten' });
    for (const name of ['Folie', 'Übung', 'Notizen']) {
      const tab = screen.getByRole('tab', { name });
      const active = tab.getAttribute('aria-selected') === 'true';
      const controls = tab.getAttribute('aria-controls');
      if (active) {
        expect(controls).not.toBeNull();
        expect(document.getElementById(controls!)).toBe(screen.getByRole('tabpanel'));
      } else {
        expect(controls).toBeNull();
      }
    }
    await user.click(screen.getByRole('tab', { name: 'Übung' }));
    expect(screen.getByRole('tab', { name: 'Übung' })).toHaveAttribute('aria-controls', 'dash-panel-uebung');
    expect(screen.getByRole('tab', { name: 'Folie' })).not.toHaveAttribute('aria-controls');
    expect(document.getElementById('dash-panel-uebung')).toBe(screen.getByRole('tabpanel'));
  });
});

describe('Dashboard: Tastenkürzel P und Stopp (Punkt 3)', () => {
  const stopKeys = { key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true };

  it('P pausiert und setzt fort', async () => {
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP' });
    await within(b).findByText('Pausiert');
    expect(posts(/\/pause$/)).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'P', code: 'KeyP' });
    await within(b).findByText('REC');
    expect(posts(/\/resume$/)).toHaveLength(1);
  });

  it('P löst in Eingabefeldern, mit Modifikator und bei gehaltener Taste nichts aus', async () => {
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'p', code: 'KeyP' });
    input.remove();
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true });
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', repeat: true });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(posts(/\/pause$/)).toHaveLength(0);
    expect(within(b).getByText('REC')).toBeVisible();
  });

  it('P wirkt nur bei laufender oder pausierter Session', async () => {
    boot({ session: running({ state: 'bereit', started_at: null }) });
    const b = await screenBar();
    await within(b).findByText('Nicht gestartet');
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(posts(/\/sessions\//)).toHaveLength(0);
  });

  it('Strg+Umschalt+S fragt nach; „Weiter aufnehmen“ und Esc brechen ab, „Session beenden“ stoppt', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    expect(screen.queryByRole('alertdialog')).toBeNull();

    fireEvent.keyDown(window, stopKeys);
    const dialog = await screen.findByRole('alertdialog', { name: 'Session beenden?' });
    expect(within(dialog).getByRole('button', { name: 'Weiter aufnehmen' })).toHaveFocus();
    expect(posts(/\/stop$/)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Weiter aufnehmen' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    fireEvent.keyDown(window, stopKeys);
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(posts(/\/stop$/)).toHaveLength(0);

    fireEvent.keyDown(window, stopKeys);
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Session beenden' }),
    );
    await within(b).findByText('Beendet');
    expect(posts(/\/stop$/)).toHaveLength(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('am Mac gilt ⌘⇧S, nicht Strg+Umschalt+S; ohne Umschalt nichts', async () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    fireEvent.keyDown(window, stopKeys);
    fireEvent.keyDown(window, { key: 's', code: 'KeyS', metaKey: true });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'S', code: 'KeyS', metaKey: true, shiftKey: true });
    expect(await screen.findByRole('alertdialog')).toBeVisible();
    vi.restoreAllMocks();
  });

  it('Stopp-Kürzel löst in Eingabefeldern nichts aus', async () => {
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, stopKeys);
    input.remove();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('P wird während der Rückfrage nicht ausgeführt', async () => {
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    fireEvent.keyDown(window, stopKeys);
    await screen.findByRole('alertdialog');
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(posts(/\/pause$/)).toHaveLength(0);
  });
});

describe('Dashboard: dunkles Erscheinungsbild als Standard (Punkt 2)', () => {
  beforeEach(() => {
    root.removeAttribute('data-theme');
    window.localStorage.clear();
  });
  afterEach(() => {
    root.removeAttribute('data-theme');
    window.localStorage.clear();
  });

  it('ist die Session dunkel, solange nichts anderes gilt; beim Verlassen kommt der alte Zustand zurück', async () => {
    const view = boot();
    await screenBar();
    await waitFor(() => expect(root).toHaveAttribute('data-theme', 'dark'));
    view.unmount();
    expect(root).not.toHaveAttribute('data-theme');
  });

  it('eine eigene Wahl „Hell“ auf diesem Gerät bleibt, auch in der Session', async () => {
    window.localStorage.setItem('sg-theme', 'light');
    const view = boot();
    await screenBar();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(root).toHaveAttribute('data-theme', 'light');
    view.unmount();
    expect(root).toHaveAttribute('data-theme', 'light');
  });

  it('die Standard-Darstellung „hell“ aus den Einstellungen bleibt hell', async () => {
    boot({ appearance: 'hell' });
    await within(await screenBar()).findByText('REC');
    await waitFor(() => expect(core.requests.some((r) => r.path === '/settings')).toBe(true));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(root).not.toHaveAttribute('data-theme', 'dark');
  });
});

describe('Dashboard: Speichern und Verwerfen der Breiten (Punkte 7 und 8)', () => {
  it('Speichern beim Unmount: Tasten, dann sofort weg (vor Ablauf der Ruhezeit) sichert die Breiten', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    const view = boot();
    await screen.findByTestId('dashboard-grid');
    screen.getByRole('separator', { name: 'Breite von Folie und Übung' }).focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(patches()).toHaveLength(0);
    view.unmount();
    // Ruhezeit ist 400 ms: Wer erst danach speichert, hat den Unmount nicht gesichert
    await waitFor(() => expect(patches()).toHaveLength(1), { timeout: 300 });
    expect(patches()[0]?.body).toEqual({ settings: { layout: 'standard', column_widths: [54, 21, 25] } });
    // Der Timer ist mit erledigt: kein zweiter PATCH
    await new Promise((r) => setTimeout(r, 600));
    expect(patches()).toHaveLength(1);
  });

  it('Pfeiltaste, dann innerhalb der Ruhezeit eine Vorlagen-Taste: nur der PATCH der Vorlage', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot();
    await screen.findByTestId('dashboard-grid');
    screen.getByRole('separator', { name: 'Breite von Folie und Übung' }).focus();
    await user.keyboard('{ArrowRight}');
    await user.keyboard('2');
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]?.body).toEqual({ settings: { layout: 'folie_gross', column_widths: null } });
    await new Promise((r) => setTimeout(r, 700));
    expect(patches()).toHaveLength(1);
    expect(grid().style.gridTemplateColumns).toMatch(/^minmax\(0, 70fr\)/);
  });
});

describe('Dashboard: Verbindung, iPad-Punkt und Abfragen (Punkte 9 bis 11)', () => {
  it('der erste Verbindungsaufbau lädt Session und Geräte nicht doppelt', async () => {
    boot({ syncState: 'connecting', devices: [makeDevice({ kind: 'ipad', connected: false })] });
    const b = await screenBar();
    await within(b).findByText('REC');
    await waitFor(() => expect(gets('/devices?limit=200')).toBe(1));
    act(() => sync.setState('online'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(gets(`/sessions/${SESSION_ID}`)).toBe(1);
    expect(gets('/devices?limit=200')).toBe(1);
    // Ein echter Abbruch danach lädt weiterhin neu
    act(() => sync.setState('backoff'));
    act(() => sync.setState('online'));
    await waitFor(() => expect(gets(`/sessions/${SESSION_ID}`)).toBe(2));
    await waitFor(() => expect(gets('/devices?limit=200')).toBe(2));
  });

  it('ohne Live-Verbindung fragt auch der iPad-Punkt alle 30 s nach', async () => {
    boot({ devices: [makeDevice({ kind: 'ipad', connected: false })] });
    const b = await screenBar();
    await within(b).findByText('REC');
    await waitFor(() => expect(gets('/devices?limit=200')).toBe(1));
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(NOW));
    core.devices[0]!.connected = true;
    act(() => sync.setState('backoff'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    expect(gets('/devices?limit=200')).toBeGreaterThanOrEqual(3);
    await waitFor(() =>
      expect(within(b).getByTestId('ipad-status')).not.toHaveTextContent('nicht verbunden'),
    );
  });

  it('im Folge-Tab fragt der iPad-Punkt ebenfalls nach', async () => {
    boot({ devices: [makeDevice({ kind: 'ipad', connected: false })] });
    const b = await screenBar();
    await within(b).findByText('REC');
    await waitFor(() => expect(gets('/devices?limit=200')).toBe(1));
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(NOW));
    act(() => sync.setState('other_tab'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    expect(gets('/devices?limit=200')).toBeGreaterThanOrEqual(3);
  });

  it('device.connection lädt nur die Geräteliste neu, nicht die Kopplungsanfragen', async () => {
    let pairingFetches = 0;
    function PairingProbe() {
      useQuery({
        queryKey: PAIRING_REQUESTS_KEY,
        queryFn: () => {
          pairingFetches += 1;
          return [];
        },
      });
      return null;
    }
    boot({ devices: [makeDevice({ kind: 'ipad', connected: false })], extra: <PairingProbe /> });
    await screenBar();
    await waitFor(() => expect(gets('/devices?limit=200')).toBe(1));
    await waitFor(() => expect(pairingFetches).toBe(1));
    act(() => sync.emit('device.connection', { client: 'ipad', connected: true }));
    await waitFor(() => expect(gets('/devices?limit=200')).toBe(2));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(pairingFetches).toBe(1);
  });
});

describe('Dashboard: Nachschärfungen aus dem Review (PR #126)', () => {
  it('H1: dunkel schon vor den Einstellungen und nach ThemeProvider bzw. AppearanceDefault', async () => {
    root.removeAttribute('data-theme');
    window.localStorage.clear();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    boot({ hold: { settings: gate } });
    await within(await screenBar()).findByText('REC');
    // Einstellungen hängen noch: das Attribut ist trotzdem schon gesetzt (ThemeProvider hat „System“ angewendet)
    await waitFor(() => expect(root).toHaveAttribute('data-theme', 'dark'));
    expect(gets('/settings')).toBe(1);
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 80));
    });
    // Einstellungen da, AppearanceDefault hat „System“ angewendet: weiter dunkel
    expect(root).toHaveAttribute('data-theme', 'dark');
    root.removeAttribute('data-theme');
    window.localStorage.clear();
  });

  it('H2: solange der Termin lädt, rendert die Ink-Spalte nicht', async () => {
    const EVENT_ID = '0190f6a2-0000-7000-8000-0000000000f2';
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    boot({
      session: running({ calendar_event_id: EVENT_ID }),
      events: [makeEvent({ id: EVENT_ID, kind: 'uebung' })],
      hold: { event: gate },
    });
    const col = await screen.findByRole('group', { name: 'Notizen' });
    await waitFor(() => expect(gets(`/calendar/events/${EVENT_ID}`)).toBe(1));
    await waitFor(() => expect(gets(`/notebooks?module_id=${DBS.id}`)).toBe(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(within(col).queryByTestId('ink-column')).toBeNull();
    expect(within(col).getByText('Notizen werden geladen …')).toBeVisible();
    await act(async () => release());
    // Erst jetzt, mit dem Termin, steht das richtige Notizbuch da (kein Umschalten von „Vorlesung“)
    expect(await within(col).findByTestId('ink-column')).toHaveTextContent(NB_UEBUNG.id);
  });

  it('H3: öffnet die Ansicht bei getrennter Verbindung, lädt das erste „online“ neu', async () => {
    boot({ syncState: 'backoff', devices: [makeDevice({ kind: 'ipad', connected: false })] });
    await within(await screenBar()).findByText('REC');
    await waitFor(() => expect(gets('/devices?limit=200')).toBe(1));
    expect(gets(`/sessions/${SESSION_ID}`)).toBe(1);
    act(() => sync.setState('online'));
    await waitFor(() => expect(gets(`/sessions/${SESSION_ID}`)).toBe(2));
    await waitFor(() => expect(gets('/devices?limit=200')).toBe(2));
  });

  it('S1: Esc schließt die Rückfrage auch bei Fokus außerhalb; Tab kreist zwischen den Knöpfen', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot();
    await within(await screenBar()).findByText('REC');
    const stopKeys = { key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true };
    fireEvent.keyDown(window, stopKeys);
    const dialog = await screen.findByRole('alertdialog');
    const keep = within(dialog).getByRole('button', { name: 'Weiter aufnehmen' });
    const end = within(dialog).getByRole('button', { name: 'Session beenden' });
    expect(keep).toHaveFocus();
    await user.tab();
    expect(end).toHaveFocus();
    await user.tab();
    expect(keep).toHaveFocus();
    await user.tab({ shift: true });
    expect(end).toHaveFocus();
    // Fokus außerhalb der Leiste: Esc wirkt trotzdem
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    fireEvent.keyDown(outside, { key: 'Escape', code: 'Escape', bubbles: true });
    outside.remove();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(posts(/\/stop$/)).toHaveLength(0);
  });
});
