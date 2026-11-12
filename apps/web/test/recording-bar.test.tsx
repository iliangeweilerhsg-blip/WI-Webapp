// Aufnahme-Leiste der App-Shell (Plan #210, PR 3; VERTRAEGE §11.8): Zustand der Aufnahme außerhalb des Dashboards,
// „Aufnahme starten“, Rückfrage des Auto-Stopps, „Zur Vorlesung“ und die Übernahme im Folge-Tab (UX-01, UX-59).
import 'fake-indexeddb/auto';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '@sg/shared';
import { AppShell } from '../src/components/AppShell.tsx';
import { SessionView } from '../src/components/dashboard/SessionView.tsx';
import { RecordingBar } from '../src/components/recording/RecordingBar.tsx';
import { useQueryClient } from '@tanstack/react-query';
import { QueryProvider } from '../src/lib/query.tsx';
import {
  RecordingProvider,
  useClaimRecordingDisplay,
  useRecordingView,
  type RecordingEnv,
} from '../src/lib/recording/index.ts';
import { resetMicIntent } from '../src/lib/recorder/index.ts';
import { applyActiveSession, sessionHref } from '../src/lib/sessions.ts';
import { SyncProvider } from '../src/lib/sync/SyncProvider.tsx';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { FakeWebLocks, fakeRecording, type FakeRecording } from './recording-fakes.ts';
import { installFakeCore, makeModule, makeSemester, makeSession, type FakeCore } from './fake-core.ts';

const nav = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    search: '',
    path: '/',
    listeners,
    setPath(next: string) {
      this.path = next;
      for (const l of listeners) l();
    },
  };
});
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    usePathname: () =>
      useSyncExternalStore(
        (l) => {
          nav.listeners.add(l);
          return () => void nav.listeners.delete(l);
        },
        () => nav.path,
        () => nav.path,
      ),
    useSearchParams: () => new URLSearchParams(nav.search),
    useRouter: () => ({ push: vi.fn() }),
  };
});
vi.mock('../src/components/ink', () => ({
  InkColumn: ({ notebookId }: { notebookId: string }) => <div data-testid="ink-column">{notebookId}</div>,
}));

const DBS = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a3', name: 'Datenbanksysteme' });
const A_ID = '0190f6a2-0000-7000-8000-0000000000e1';
const OLD_ID = '0190f6a2-0000-7000-8000-0000000000e3';
// 08:42:13 Uhr; die Session läuft seit 08:00:00, also seit 42:13 Minuten
const NOW = '2026-11-04T08:42:13Z';

function session(id: string, overrides: Partial<Session> = {}): Session {
  return makeSession({
    id,
    module_id: DBS.id,
    number: 7,
    state: 'laeuft',
    started_at: '2026-11-04T08:00:00Z',
    created_at: '2026-11-03T08:00:00Z',
    updated_at: '2026-11-04T08:00:00Z',
    ...overrides,
  });
}

/** Sync-Client mit steuerbarem Zustand und Ereignissen */
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
    devicePresence: vi.fn(() => null),
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

/** Ein „Dashboard“, das genau die verfolgte Session (oder die mit der gegebenen ID) zeigt */
function Dashboard({ id }: { id?: string }) {
  const v = useRecordingView();
  useClaimRecordingDisplay(id ?? v.sessionId);
  return <p data-testid="dashboard">Dashboard</p>;
}

let core: FakeCore;
let sync: ReturnType<typeof fakeSync>;
let rec: FakeRecording;
let env: RecordingEnv;

interface BootOptions {
  sessions?: Session[];
  syncState?: string;
  rec?: FakeRecording;
  env?: Partial<RecordingEnv>;
  ui?: ReactNode;
  /** Mit der echten `AppShell` (Banner „anderer Tab“, Leiste in der Inhaltsspalte) statt nur Provider und Leiste */
  shell?: boolean;
}

function boot(opts: BootOptions = {}) {
  vi.setSystemTime(new Date(NOW));
  nav.search = `id=${A_ID}`;
  nav.path = '/';
  core = installFakeCore({
    semesters: [makeSemester()],
    modules: [DBS],
    sessions: opts.sessions ?? [session(A_ID)],
  });
  core.notebooks = [];
  core.devices = [];
  sync = fakeSync(opts.syncState);
  rec = opts.rec ?? fakeRecording();
  env = { ...rec.env, ...opts.env };
  const ui = opts.ui ?? <p>Heute</p>;
  return render(
    <ThemeProvider>
      <QueryProvider>
        {opts.shell ? (
          <AppShell syncClient={sync.client} recordingEnv={env}>
            {ui}
          </AppShell>
        ) : (
          <SyncProvider client={sync.client}>
            <RecordingProvider env={env}>
              {ui}
              <RecordingBar />
            </RecordingProvider>
          </SyncProvider>
        )}
      </QueryProvider>
    </ThemeProvider>,
  );
}

const bar = () => screen.queryByRole('complementary', { name: 'Aufnahme' });
const kindOfBar = () => bar()?.getAttribute('data-kind') ?? null;
const barStatus = () => screen.getByTestId('bar-status').textContent;
const uploads = (re: RegExp) =>
  rec.fetch.mock.calls.filter(([url, init]) =>
    re.test(`${(init as RequestInit)?.method ?? 'GET'} ${String(url)}`),
  );
const requests = (re: RegExp) => core.requests.filter((r) => re.test(`${r.method} ${r.path}`));
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

function mic(name: string) {
  return Object.assign(new Error(name), { name });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  resetMicIntent();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Aufnahme-Leiste: wann sie steht', () => {
  it('ohne aktive Session gibt es keine Leiste', async () => {
    boot({ sessions: [] });
    await waitFor(() => expect(requests(/^GET \/sessions\?state=/).length).toBeGreaterThan(0));
    await settle();
    expect(bar()).toBeNull();
    expect(screen.queryByText('Zur Vorlesung')).toBeNull();
  });

  it('nach dem Ende der Session verschwindet sie (Ereignis, während der Nutzer auf Heute ist); die Aufnahme wird gesichert', async () => {
    boot();
    await waitFor(() => expect(kindOfBar()).toBe('rec'));
    act(() => rec.mr.instances[0]?.emit(16));
    await sync.emit(
      'session.updated',
      session(A_ID, { state: 'beendet', updated_at: '2026-11-04T08:40:00Z' }),
    );
    await waitFor(() => expect(bar()).toBeNull());
    await waitFor(() => expect(uploads(/^POST .*\/complete$/)).toHaveLength(1));
    for (const t of rec.tracks) expect(t.stop).toHaveBeenCalled();
    expect(rec.mr.instances[0]?.state).toBe('inactive');
  });

  it('im Dashboard der aktiven Session steht keine Leiste, im Dashboard einer anderen schon', async () => {
    const view = boot({ ui: <Dashboard /> });
    await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
    await settle();
    expect(bar()).toBeNull();
    view.unmount();

    boot({
      sessions: [session(A_ID), session(OLD_ID, { state: 'beendet', ended_at: '2026-11-03T10:00:00Z' })],
      ui: <Dashboard id={OLD_ID} />,
    });
    await waitFor(() => expect(kindOfBar()).toBe('rec'));
    expect(rec.getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe('Aufnahme-Leiste: Zeilen der Tabelle (Plan §4.7)', () => {
  it('REC: roter Punkt, Laufzeit, Link „Zur Vorlesung“, ruhiger Satz', async () => {
    boot();
    await waitFor(() => expect(kindOfBar()).toBe('rec'));
    const b = bar()!;
    expect(within(b).getByText('REC')).toBeInTheDocument();
    expect(await within(b).findByTestId('bar-elapsed')).toHaveTextContent('Laufzeit 00:42:13');
    expect(b.querySelector('.bg-record.rounded-full')).not.toBeNull();
    expect(within(b).getByRole('link', { name: 'Zur Vorlesung' })).toHaveAttribute('href', sessionHref(A_ID));
    expect(within(b).queryByRole('button')).toBeNull();
    expect(barStatus()).toBe('Die Aufnahme läuft.');
    expect(screen.queryByTestId('bar-hint')).toBeNull();
    // Bewusst ohne Pause und Beenden (Lead-Entscheidung)
    expect(within(b).queryByRole('button', { name: /Pause|Beenden/ })).toBeNull();
  });

  it('der Satz für Screenreader ändert sich nicht, wenn die Laufzeit tickt', async () => {
    boot();
    await waitFor(() => expect(kindOfBar()).toBe('rec'));
    expect(await screen.findByTestId('bar-elapsed')).toHaveTextContent('00:42:13');
    const statusBefore = screen.getByTestId('bar-status');
    expect(statusBefore).toHaveTextContent('Die Aufnahme läuft.');
    // Die Uhr läuft 5 s weiter; der Sekundentakt der Leiste zeigt es
    vi.setSystemTime(new Date('2026-11-04T08:42:18Z'));
    await waitFor(() => expect(screen.getByTestId('bar-elapsed')).toHaveTextContent('00:42:18'), {
      timeout: 3000,
    });
    // Dasselbe Element, derselbe Text: Der Status-Bereich wurde nicht neu aufgebaut
    expect(screen.getByTestId('bar-status')).toBe(statusBefore);
    expect(statusBefore).toHaveTextContent(/^Die Aufnahme läuft\.$/);
    // Die Laufzeit steht außerhalb des Status-Bereichs
    expect(statusBefore.contains(screen.getByTestId('bar-elapsed'))).toBe(false);
  });

  it('Startet: hohler Punkt, kein Knopf, kein Hinweis', async () => {
    boot({ syncState: 'acquiring' });
    await waitFor(() => expect(kindOfBar()).toBe('starting'));
    const b = bar()!;
    expect(within(b).getByText('Startet')).toBeInTheDocument();
    expect(b.querySelector('.bg-record')).toBeNull();
    expect(b.querySelector('.border-text-muted.rounded-full')).not.toBeNull();
    expect(within(b).queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('bar-hint')).toBeNull();
    expect(barStatus()).toBe('Die Aufnahme startet.');
  });

  it('Wartet auf anderen Tab: Hinweiszeile, kein Knopf', async () => {
    const locks = new FakeWebLocks();
    const release = await locks.acquire(new AbortController().signal);
    boot({ rec: fakeRecording({ locks }), env: { waitHintMs: 10 } });
    await waitFor(() => expect(kindOfBar()).toBe('waiting'));
    const b = bar()!;
    expect(within(b).getByText('Wartet auf anderen Tab')).toBeInTheDocument();
    expect(b.querySelector('.bg-record')).toBeNull();
    expect(within(b).queryByRole('button')).toBeNull();
    expect(screen.getByTestId('bar-hint')).toHaveTextContent(/Wartet auf den anderen Tab/);
    expect(barStatus()).toMatch(/^Es wird nicht aufgenommen\. Wartet auf den anderen Tab/);
    release?.();
    await waitFor(() => expect(kindOfBar()).toBe('rec'));
  });

  it('Keine Aufnahme: Knopf „Aufnahme starten“ öffnet das Mikrofon, danach REC', async () => {
    const user = userEvent.setup();
    boot({ rec: fakeRecording({ permission: 'prompt' }) });
    await waitFor(() => expect(kindOfBar()).toBe('needs-start'));
    const b = bar()!;
    expect(within(b).getByText('Keine Aufnahme')).toBeInTheDocument();
    expect(b.querySelector('.bg-record')).toBeNull();
    expect(screen.getByTestId('bar-hint')).toHaveTextContent(/„Aufnahme starten“ öffnet die Browser-Abfrage/);
    expect(barStatus()).toMatch(/^Es wird nicht aufgenommen\./);
    expect(rec.getUserMedia).not.toHaveBeenCalled();

    await user.click(within(b).getByRole('button', { name: 'Aufnahme starten' }));
    await waitFor(() => expect(kindOfBar()).toBe('rec'));
    expect(rec.getUserMedia).toHaveBeenCalledTimes(1);
    expect(within(bar()!).queryByRole('button')).toBeNull();
  });

  it.each([
    ['mic-denied', 'NotAllowedError', 'Zugriff verweigert', /Zugriff auf das Mikrofon verweigert/],
    ['mic-missing', 'NotFoundError', 'Mikrofon fehlt', /Kein Mikrofon gefunden/],
    ['error', 'AbortError', 'Aufnahme gestört', null],
  ] as const)(
    '%s: Text, Hinweiszeile und „Erneut versuchen“ (frische Nutzeraktion)',
    async (expected, errorName, label, hint) => {
      const user = userEvent.setup();
      let calls = 0;
      boot({
        rec: fakeRecording({
          getUserMedia: async () => {
            if (++calls === 1) throw mic(errorName);
            return (await import('./recording-fakes.ts')).fakeStream();
          },
        }),
      });
      await waitFor(() => expect(kindOfBar()).toBe(expected));
      const b = bar()!;
      expect(within(b).getByText(label)).toBeInTheDocument();
      expect(b.querySelector('.bg-record')).toBeNull();
      if (hint) expect(screen.getByTestId('bar-hint')).toHaveTextContent(hint);
      expect(barStatus()).toMatch(/^Es wird nicht aufgenommen\./);
      await user.click(within(b).getByRole('button', { name: 'Erneut versuchen' }));
      await waitFor(() => expect(kindOfBar()).toBe('rec'));
      expect(rec.getUserMedia).toHaveBeenCalledTimes(2);
    },
  );

  it('Aufnahme in anderem Tab (Folge-Tab): ohne Hinweiszeile, ohne Knopf', async () => {
    boot({ syncState: 'other_tab' });
    await waitFor(() => expect(kindOfBar()).toBe('other-tab'));
    const b = bar()!;
    expect(within(b).getByText('Aufnahme in anderem Tab')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-hint')).toBeNull();
    expect(within(b).queryByRole('button')).toBeNull();
    expect(b.querySelector('.bg-record')).toBeNull();
    expect(barStatus()).toBe('Für die Aufnahme ist ein anderer Tab zuständig.');
    expect(rec.getUserMedia).not.toHaveBeenCalled();
    expect(within(b).getByRole('link', { name: 'Zur Vorlesung' })).toBeInTheDocument();
  });

  it('Pausiert vom anderen Gerät: Pausendauer, die Aufnahme ist abgeschlossen', async () => {
    boot();
    await waitFor(() => expect(kindOfBar()).toBe('rec'));
    act(() => rec.mr.instances[0]?.emit(16));
    // Das iPad pausiert um 08:30; der Tab bemerkt es per Ereignis
    await sync.emit(
      'session.updated',
      session(A_ID, { state: 'pausiert', updated_at: '2026-11-04T08:30:00Z' }),
    );
    await waitFor(() => expect(kindOfBar()).toBe('paused'));
    const b = bar()!;
    expect(within(b).getByText('Pausiert')).toBeInTheDocument();
    expect(await within(b).findByTestId('bar-pause-elapsed')).toHaveTextContent('Pausendauer 00:12:13');
    expect(within(b).queryByText('Noch Pause?')).toBeNull();
    expect(b.querySelector('.bg-record')).toBeNull();
    expect(barStatus()).toBe('Die Session ist pausiert.');
    await waitFor(() => expect(uploads(/^POST .*\/complete$/)).toHaveLength(1));
    expect(rec.mr.instances[0]?.state).toBe('inactive');
    // Fortsetzen nimmt neu auf
    await sync.emit(
      'session.updated',
      session(A_ID, { state: 'laeuft', updated_at: '2026-11-04T08:43:00Z' }),
    );
    await waitFor(() => expect(kindOfBar()).toBe('rec'));
    expect(rec.mr.instances).toHaveLength(2);
  });

  it('Pause über 20 Minuten: „Noch Pause?“ und der längere Satz', async () => {
    boot({ sessions: [session(A_ID, { state: 'pausiert', updated_at: '2026-11-04T08:10:00Z' })] });
    await waitFor(() => expect(kindOfBar()).toBe('paused'));
    expect(await within(bar()!).findByText('Noch Pause?')).toBeInTheDocument();
    expect(barStatus()).toBe('Die Session ist seit über 20 Minuten pausiert.');
    expect(rec.getUserMedia).not.toHaveBeenCalled();
  });
});

describe('Aufnahme-Leiste: Rückfrage des Auto-Stopps', () => {
  // Maximaldauer 240 min: 30 s vor der Grenze erscheint die Rückfrage (Vorwarnung 60 s)
  const NEAR_LIMIT = () => session(A_ID, { started_at: '2026-11-04T04:42:43Z' });

  it('auf Heute steht die Rückfrage in der Leiste, genau einmal; „weiter aufnehmen“ verlängert', async () => {
    const user = userEvent.setup();
    boot({ sessions: [NEAR_LIMIT()] });
    await waitFor(() => expect(within(bar()!).getByText(/Stoppt gleich/)).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(screen.getAllByTestId('autostop-hint')).toHaveLength(1);
    await user.click(within(bar()!).getByRole('button', { name: /Weiter aufnehmen/ }));
    await waitFor(() => expect(requests(/^POST \/sessions\/[^/]+\/extend$/)).toHaveLength(1));
    await waitFor(() => expect(within(bar()!).queryByText(/Stoppt gleich/)).toBeNull());
    expect(requests(/^POST \/sessions\/[^/]+\/stop$/)).toHaveLength(0);
  });

  it('im Dashboard der Session steht sie in der Statusleiste, nie doppelt', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('min-width'),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })),
    );
    boot({ sessions: [NEAR_LIMIT()], ui: <SessionView />, shell: true });
    const statusBar = await screen.findByLabelText('Statusleiste');
    await waitFor(() => expect(within(statusBar).getByText(/Stoppt gleich/)).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(bar()).toBeNull();
    expect(screen.getAllByTestId('autostop-hint')).toHaveLength(1);
  });
});

describe('Hier übernehmen (Folge-Tab wird Leader)', () => {
  /** Folge-Tab; „Hier übernehmen“ macht den Tab nach `delayMs` zum Leader (die Sperre des alten Tabs ist erst dann frei) */
  async function bootFollower(opts: { permission: 'prompt' | 'granted'; lockHeld?: boolean }) {
    const locks = new FakeWebLocks();
    const release = opts.lockHeld ? await locks.acquire(new AbortController().signal) : null;
    boot({
      shell: true,
      syncState: 'other_tab',
      rec: fakeRecording({ locks, permission: opts.permission }),
      env: { waitHintMs: 10 },
    });
    return { release };
  }

  it('Klick auf „Hier übernehmen“ ist die Erlaubnis: Das Mikrofon öffnet sich ohne weiteren Klick', async () => {
    const user = userEvent.setup();
    const { release } = await bootFollower({ permission: 'prompt', lockHeld: true });
    await waitFor(() => expect(kindOfBar()).toBe('other-tab'));
    expect(rec.getUserMedia).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Hier übernehmen' }));
    expect(sync.client.takeOver).toHaveBeenCalledOnce();
    // Die Rolle wechselt, die Sperre des alten Tabs ist aber noch nicht frei
    sync.setState('online');
    await waitFor(() => expect(kindOfBar()).toBe('waiting'));
    expect(rec.getUserMedia).not.toHaveBeenCalled();
    // Der alte Tab ist fertig: Der neue nimmt ohne weiteren Klick auf
    release?.();
    await waitFor(() => expect(kindOfBar()).toBe('rec'));
    expect(rec.getUserMedia).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Aufnahme starten' })).toBeNull();
  });

  it('ohne den Klick (der andere Tab schließt): „Keine Aufnahme“ mit Knopf', async () => {
    await bootFollower({ permission: 'prompt' });
    await waitFor(() => expect(kindOfBar()).toBe('other-tab'));
    // Die Rolle kommt von selbst, niemand hat geklickt
    sync.setState('online');
    await waitFor(() => expect(kindOfBar()).toBe('needs-start'));
    expect(rec.getUserMedia).not.toHaveBeenCalled();
    expect(within(bar()!).getByRole('button', { name: 'Aufnahme starten' })).toBeInTheDocument();
  });

  it('Safari lehnt die späte Abfrage ab (NotAllowedError): „Zugriff verweigert“, „Erneut versuchen“ startet', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const locks = new FakeWebLocks();
    boot({
      shell: true,
      syncState: 'other_tab',
      rec: fakeRecording({
        locks,
        permission: 'prompt',
        getUserMedia: async () => {
          if (++calls === 1) throw mic('NotAllowedError');
          return (await import('./recording-fakes.ts')).fakeStream();
        },
      }),
    });
    await waitFor(() => expect(kindOfBar()).toBe('other-tab'));
    await user.click(screen.getByRole('button', { name: 'Hier übernehmen' }));
    sync.setState('online');
    await waitFor(() => expect(kindOfBar()).toBe('mic-denied'));
    expect(within(bar()!).getByText('Zugriff verweigert')).toBeInTheDocument();
    await user.click(within(bar()!).getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(kindOfBar()).toBe('rec'));
    expect(rec.getUserMedia).toHaveBeenCalledTimes(2);
  });
});

function Thrower({ fail }: { fail: { on: boolean; rerender?: () => void } }) {
  const [, force] = useState(0);
  fail.rerender = () => force((n) => n + 1);
  if (fail.on) throw new Error('kaputt');
  return <p data-testid="page-ok">Seite ok</p>;
}

/** Schreibt direkt in die Abfrage der aktiven Session, ohne die Seitenabfrage der Session anzufassen */
function PushActive({ next }: { next: Session }) {
  const client = useQueryClient();
  return (
    <button type="button" onClick={() => applyActiveSession(client, next)}>
      push-active
    </button>
  );
}

describe('Folgepunkte #266', () => {
  it('Renderfehler in der Seite: Shell und Leiste bleiben, die Aufnahme läuft weiter, „Neu laden“ rendert nur die Ansicht', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fail: { on: boolean; rerender?: () => void } = { on: false };
    boot({ shell: true, ui: <Thrower fail={fail} /> });
    await waitFor(() => expect(kindOfBar()).toBe('rec'));
    expect(screen.getByTestId('page-ok')).toBeInTheDocument();
    const mr = rec.mr.instances[0]!;
    const stopsBefore = rec.tracks.map((t) => t.stop.mock.calls.length);

    // Die Seite wirft beim nächsten Rendern
    fail.on = true;
    act(() => fail.rerender?.());
    expect(await screen.findByTestId('view-error')).toHaveTextContent(
      'Diese Ansicht hat einen Fehler. Die Aufnahme läuft weiter.',
    );
    // Shell und Leiste stehen, die Aufnahme ist unberührt (kein dispose)
    expect(kindOfBar()).toBe('rec');
    expect(screen.getByRole('navigation', { name: /./ })).toBeInTheDocument();
    expect(mr.state).not.toBe('inactive');
    expect(rec.tracks.map((t) => t.stop.mock.calls.length)).toEqual(stopsBefore);

    fail.on = false;
    await user.click(screen.getByRole('button', { name: 'Neu laden' }));
    expect(await screen.findByTestId('page-ok')).toBeInTheDocument();
    expect(screen.queryByTestId('view-error')).toBeNull();
    expect(document.getElementById('main')).toHaveFocus();
    expect(kindOfBar()).toBe('rec');
    expect(mr.state).not.toBe('inactive');
    expect(rec.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('Statusleiste folgt der Phase aus der aktiven Session, auch wenn der Seitenstand älter ist', async () => {
    boot({
      shell: true,
      ui: (
        <>
          <SessionView />
          <PushActive next={session(A_ID, { state: 'pausiert', updated_at: '2026-11-04T08:30:00Z' })} />
        </>
      ),
    });
    const statusBar = await screen.findByLabelText('Statusleiste');
    await within(statusBar).findByText('REC');
    await userEvent.setup().click(screen.getByRole('button', { name: 'push-active' }));
    await within(statusBar).findByText('Pausiert');
    expect(within(statusBar).getByRole('button', { name: 'Fortsetzen' })).toBeInTheDocument();
    expect(within(statusBar).queryByText('REC')).toBeNull();
  });

  it('Statusleiste: Ist der Seitenstand neuer als die aktive Session, gilt der Seitenstand', async () => {
    function PushPage({ next }: { next: Session }) {
      const client = useQueryClient();
      return (
        <button type="button" onClick={() => client.setQueryData(['sessions', 'dashboard', next.id], next)}>
          push-page
        </button>
      );
    }
    boot({
      shell: true,
      ui: (
        <>
          <SessionView />
          <PushPage next={session(A_ID, { state: 'pausiert', updated_at: '2026-11-04T08:30:00Z' })} />
        </>
      ),
    });
    const statusBar = await screen.findByLabelText('Statusleiste');
    await within(statusBar).findByText('REC');
    await userEvent.setup().click(screen.getByRole('button', { name: 'push-page' }));
    // Die aktive Session (älter, „läuft“) überstimmt den neueren Seitenstand nicht
    await within(statusBar).findByText('Pausiert');
    expect(within(statusBar).queryByText('REC')).toBeNull();
  });

  it('„Aufnahme starten“ setzt den Fokus auf den Statussatz der Leiste', async () => {
    const user = userEvent.setup();
    boot({ rec: fakeRecording({ permission: 'prompt' }) });
    await waitFor(() => expect(kindOfBar()).toBe('needs-start'));
    const line = within(bar()!).getByText('Keine Aufnahme').closest('p')!;
    expect(line).toHaveAttribute('tabindex', '-1');
    await user.click(within(bar()!).getByRole('button', { name: 'Aufnahme starten' }));
    expect(line).toHaveFocus();
    await waitFor(() => expect(kindOfBar()).toBe('rec'));
    expect(line).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it('„Zur Vorlesung“ setzt den Fokus nach dem Seitenwechsel auf den Inhalt (main)', async () => {
    const user = userEvent.setup();
    boot({ shell: true });
    await waitFor(() => expect(kindOfBar()).toBe('rec'));
    const link = within(bar()!).getByRole('link', { name: 'Zur Vorlesung' });
    link.addEventListener('click', (e) => e.preventDefault());
    await user.click(link);
    act(() => nav.setPath('/session'));
    await waitFor(() => expect(document.getElementById('main')).toHaveFocus());
  });
});
