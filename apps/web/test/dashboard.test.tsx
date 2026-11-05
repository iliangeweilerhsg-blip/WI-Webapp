// Live-Dashboard (T1-04): Layout und Vorlagen, Statusleiste, Aktionen, Live-Aktualisierung, Notizen, Auto-Stopp.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Notebook, Session } from '@sg/shared';
import { SessionView } from '../src/components/dashboard/SessionView.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { SyncProvider } from '../src/lib/sync/SyncProvider.tsx';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { ThemeProvider } from '../src/lib/theme.tsx';
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
  core.devices = opts.devices ?? [];
  sync = fakeSync(opts.syncState);
  return render(
    <ThemeProvider>
      <QueryProvider>
        <SyncProvider client={sync.client}>
          <SessionView />
        </SyncProvider>
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

  it('online wird nicht nachgefragt', async () => {
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(NOW));
    const before = gets(`/sessions/${SESSION_ID}`);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(gets(`/sessions/${SESSION_ID}`)).toBe(before);
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
