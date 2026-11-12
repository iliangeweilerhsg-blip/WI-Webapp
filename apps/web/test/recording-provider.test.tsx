// Recorder und Auto-Stopp an der App-Shell (Plan #210, PR 2; VERTRAEGE §11.8): Ein Recorder je Tab, der der aktiven
// Session folgt. Solange `ROUTE_GATE` gilt, nur bei offenem Dashboard der Session (altes Verhalten).
import 'fake-indexeddb/auto';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { Session } from '@sg/shared';
import { SessionView } from '../src/components/dashboard/SessionView.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import {
  RecordingProvider,
  useClaimRecordingDisplay,
  useRecordingFor,
  useRecordingView,
  type RecordingEnv,
} from '../src/lib/recording/index.ts';
import { resetMicIntent } from '../src/lib/recorder/index.ts';
import { startSession } from '../src/lib/sessions.ts';
import { SyncProvider } from '../src/lib/sync/SyncProvider.tsx';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { FakeWebLocks, fakeRecording, fakeStream, type FakeRecording } from './recording-fakes.ts';
import { installFakeCore, makeModule, makeSemester, makeSession, type FakeCore } from './fake-core.ts';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/session',
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../src/components/ink', () => ({
  InkColumn: ({ notebookId }: { notebookId: string }) => <div data-testid="ink-column">{notebookId}</div>,
}));

const DBS = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a3', name: 'Datenbanksysteme' });
const A_ID = '0190f6a2-0000-7000-8000-0000000000e1';
const B_ID = '0190f6a2-0000-7000-8000-0000000000e2';
const OLD_ID = '0190f6a2-0000-7000-8000-0000000000e3';
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

/** Liest den Stand der Shell */
function Probe() {
  const v = useRecordingView();
  return (
    <ul data-testid="probe">
      <li data-testid="kind">{v.kind}</li>
      <li data-testid="phase">{v.phase}</li>
      <li data-testid="session">{v.sessionId ?? 'keine'}</li>
      <li data-testid="shown">{String(v.shownByDashboard)}</li>
      <li data-testid="recording-id">{v.status.recordingId ?? '-'}</li>
      <li data-testid="paused-since">{v.pausedSince ?? '-'}</li>
    </ul>
  );
}
const kind = () => screen.getByTestId('kind').textContent;
const phase = () => screen.getByTestId('phase').textContent;
const shownSession = () => screen.getByTestId('session').textContent;

/** Ein „Dashboard“, das genau die verfolgte Session zeigt (oder die mit der gegebenen ID) */
function Dashboard({ id }: { id?: string }) {
  const v = useRecordingView();
  useClaimRecordingDisplay(id ?? v.sessionId);
  return <p data-testid="dashboard">Dashboard</p>;
}

function For({ id }: { id: string }) {
  const v = useRecordingFor(id);
  return <p data-testid={`for-${id}`}>{v.kind}</p>;
}

let core: FakeCore;
let sync: ReturnType<typeof fakeSync>;
let rec: FakeRecording;
let env: RecordingEnv;

function tree(ui: ReactNode, strict = false) {
  const inner = (
    <ThemeProvider>
      <QueryProvider>
        <SyncProvider client={sync.client}>
          <RecordingProvider env={env}>
            <Probe />
            {ui}
          </RecordingProvider>
        </SyncProvider>
      </QueryProvider>
    </ThemeProvider>
  );
  return strict ? <StrictMode>{inner}</StrictMode> : inner;
}

function boot(
  opts: {
    sessions?: Session[];
    syncState?: string;
    rec?: FakeRecording;
    env?: Partial<RecordingEnv>;
    ui?: ReactNode;
    strict?: boolean;
    search?: string;
  } = {},
) {
  vi.setSystemTime(new Date(NOW));
  nav.search = opts.search ?? `id=${A_ID}`;
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
  const view = render(tree(opts.ui ?? <Dashboard />, opts.strict));
  return {
    ...view,
    /** Anderen Inhalt einhängen, der Provider bleibt */
    show: (ui: ReactNode) => view.rerender(tree(ui, opts.strict)),
  };
}

const uploads = (re: RegExp) =>
  rec.fetch.mock.calls.filter(([url, init]) =>
    re.test(`${(init as RequestInit)?.method ?? 'GET'} ${String(url)}`),
  );
const requests = (re: RegExp) => core.requests.filter((r) => re.test(`${r.method} ${r.path}`));
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  resetMicIntent();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('RecordingProvider: ohne aktive Session', () => {
  it('legt keinen Recorder an, fragt keine Einstellungen ab und öffnet kein Mikrofon', async () => {
    boot({ sessions: [], ui: null });
    await waitFor(() => expect(requests(/^GET \/sessions\?state=/).length).toBeGreaterThan(0));
    await settle();
    expect(kind()).toBe('inactive');
    expect(shownSession()).toBe('keine');
    expect(rec.getUserMedia).not.toHaveBeenCalled();
    expect(rec.mr.instances).toHaveLength(0);
    expect(requests(/^GET \/settings/)).toHaveLength(0);
  });

  it('ohne Provider liefern die Hooks einen festen, untätigen Stand', () => {
    render(<For id={A_ID} />);
    expect(screen.getByTestId(`for-${A_ID}`)).toHaveTextContent('inactive');
  });
});

describe('RecordingProvider: Dashboard und Schalter (altes Verhalten)', () => {
  it('Dashboard offen: REC. Dashboard weg: die Aufnahme stoppt sauber, der Provider bleibt. Zurück: neue Aufnahme', async () => {
    const view = boot();
    await waitFor(() => expect(kind()).toBe('rec'));
    expect(screen.getByTestId('shown')).toHaveTextContent('true');
    expect(rec.getUserMedia).toHaveBeenCalledTimes(1);
    const first = screen.getByTestId('recording-id').textContent;
    act(() => rec.mr.instances[0]?.emit(32));
    await waitFor(() => expect(uploads(/^PUT .*\/chunks\/0$/)).toHaveLength(1));

    view.show(null);
    await waitFor(() => expect(kind()).toBe('inactive'));
    // Die Session läuft weiter; es wird nur nicht aufgenommen
    expect(phase()).toBe('laeuft');
    expect(shownSession()).toBe(A_ID);
    await waitFor(() => expect(uploads(/^POST .*\/complete$/)).toHaveLength(1));
    expect(rec.mr.instances[0]?.state).toBe('inactive');
    expect(uploads(/^PUT .*\/chunks\/1$/)).toHaveLength(1);
    for (const t of rec.tracks) expect(t.stop).toHaveBeenCalled();
    // Der Recorder wurde nicht entsorgt: derselbe Provider, kein neuer Tab-Zustand
    expect(rec.mr.instances).toHaveLength(1);

    view.show(<Dashboard />);
    await waitFor(() => expect(kind()).toBe('rec'));
    expect(rec.mr.instances).toHaveLength(2);
    expect(rec.getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('recording-id').textContent).not.toBe(first);
  });

  it('Dashboard einer anderen Session: keine Aufnahme', async () => {
    boot({
      sessions: [session(A_ID), session(OLD_ID, { state: 'beendet', ended_at: '2026-11-03T10:00:00Z' })],
      ui: <Dashboard id={OLD_ID} />,
    });
    await waitFor(() => expect(shownSession()).toBe(A_ID));
    await settle();
    expect(screen.getByTestId('shown')).toHaveTextContent('false');
    expect(kind()).toBe('inactive');
    expect(rec.getUserMedia).not.toHaveBeenCalled();
  });

  it('useRecordingFor mit fremder ID liefert „inactive“; solange die aktive Session lädt, „starting“', async () => {
    boot({
      ui: (
        <>
          <Dashboard />
          <For id={A_ID} />
          <For id={B_ID} />
        </>
      ),
    });
    // Erster Paint, die Abfrage der aktiven Session läuft noch
    expect(screen.getByTestId(`for-${A_ID}`)).toHaveTextContent('starting');
    expect(screen.getByTestId(`for-${B_ID}`)).toHaveTextContent('starting');
    await waitFor(() => expect(screen.getByTestId(`for-${A_ID}`)).toHaveTextContent('rec'));
    expect(screen.getByTestId(`for-${B_ID}`)).toHaveTextContent('inactive');
  });

  it('das Dashboard einer beendeten Session zeigt „Beendet“, während eine andere läuft', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('min-width'),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })),
    );
    boot({
      sessions: [
        session(A_ID),
        session(OLD_ID, {
          state: 'beendet',
          ended_at: '2026-11-03T10:00:00Z',
          started_at: '2026-11-03T08:00:00Z',
        }),
      ],
      ui: <SessionView />,
      search: `id=${OLD_ID}`,
    });
    const bar = await screen.findByLabelText('Statusleiste');
    expect(await within(bar).findByText('Beendet')).toBeVisible();
    await waitFor(() => expect(shownSession()).toBe(A_ID));
    expect(kind()).toBe('inactive');
    expect(rec.getUserMedia).not.toHaveBeenCalled();
  });
});

describe('RecordingProvider: Seite verlassen', () => {
  const leaveIsBlocked = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('beforeunload wird bei REC abgefangen, nach dem Ende der Session nicht mehr', async () => {
    boot();
    await waitFor(() => expect(kind()).toBe('rec'));
    expect(leaveIsBlocked()).toBe(true);
    await sync.emit(
      'session.updated',
      session(A_ID, { state: 'beendet', updated_at: '2026-11-04T08:40:00Z' }),
    );
    await waitFor(() => expect(kind()).toBe('inactive'));
    await waitFor(() => expect(leaveIsBlocked()).toBe(false));
  });

  it('im Folge-Tab und ohne Aufnahme wird nichts abgefangen', async () => {
    boot({ syncState: 'other_tab' });
    await waitFor(() => expect(kind()).toBe('other-tab'));
    expect(leaveIsBlocked()).toBe(false);
    cleanup();

    boot({ rec: fakeRecording({ permission: 'prompt' }) });
    await waitFor(() => expect(kind()).toBe('needs-start'));
    expect(leaveIsBlocked()).toBe(false);
  });

  it('pagehide bei REC: der Recorder gibt Daten heraus, „Chunks liegen bereit“ geht auf den Kanal', async () => {
    const seen: unknown[] = [];
    const channel = new BroadcastChannel('sg-recorder-uploads');
    channel.onmessage = (ev) => seen.push(ev.data);
    boot();
    await waitFor(() => expect(kind()).toBe('rec'));
    expect(seen).toEqual([]);
    act(() => void window.dispatchEvent(new Event('pagehide')));
    await waitFor(() => expect(seen).toContain('kick'));
    expect(rec.mr.instances[0]?.requestCalls).toBe(1);
    channel.close();
  });

  it('ein verborgener Tab bei REC meldet ebenfalls „Chunks liegen bereit“', async () => {
    const seen: unknown[] = [];
    const channel = new BroadcastChannel('sg-recorder-uploads');
    channel.onmessage = (ev) => seen.push(ev.data);
    boot();
    await waitFor(() => expect(kind()).toBe('rec'));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(seen).toContain('kick'));
    expect(rec.mr.instances[0]?.requestCalls).toBe(1);
    channel.close();
  });

  it('pagehide ohne Aufnahme tut nichts', async () => {
    const seen: unknown[] = [];
    const channel = new BroadcastChannel('sg-recorder-uploads');
    channel.onmessage = (ev) => seen.push(ev.data);
    boot({ rec: fakeRecording({ permission: 'prompt' }) });
    await waitFor(() => expect(kind()).toBe('needs-start'));
    // Nachzügler des vorigen Tests (Aufräumen meldet noch „Chunks liegen bereit“) abwarten
    await settle(150);
    seen.length = 0;
    act(() => void window.dispatchEvent(new Event('pagehide')));
    await settle(150);
    expect(seen).toEqual([]);
    expect(rec.mr.instances).toHaveLength(0);
    channel.close();
  });
});

describe('RecordingProvider: Wechsel der Session', () => {
  const B = () => session(B_ID, { number: 8, started_at: '2026-11-04T08:42:13Z', state: 'bereit' });

  /** Startet B über den Core (er beendet A) und gibt die beiden Ereignisse in der gewünschten Reihenfolge weiter */
  async function switchToB(order: 'a-first' | 'b-first') {
    let result!: Awaited<ReturnType<typeof startSession>>;
    await act(async () => {
      result = await startSession(B_ID);
    });
    const ended = result.ended_session!;
    const started = result.session;
    await sync.emit('session.updated', order === 'a-first' ? ended : started);
    await sync.emit('session.updated', order === 'a-first' ? started : ended);
  }

  it.each(['a-first', 'b-first'] as const)(
    'A nimmt auf, B startet (%s): A bekommt den letzten Chunk und complete, B beginnt neu; nie zwei zugleich',
    async (order) => {
      const locks = new FakeWebLocks();
      const shared = { running: new Set<object>(), maxRunning: 0 };
      boot({ sessions: [session(A_ID), B()], rec: fakeRecording({ locks, shared }), ui: <Dashboard /> });
      await waitFor(() => expect(kind()).toBe('rec'));
      const first = screen.getByTestId('recording-id').textContent;
      act(() => rec.mr.instances[0]?.emit(32));
      await waitFor(() => expect(uploads(/^PUT .*\/chunks\/0$/)).toHaveLength(1));

      await switchToB(order);
      await waitFor(() => expect(shownSession()).toBe(B_ID));
      await waitFor(() => expect(kind()).toBe('rec'));
      const second = screen.getByTestId('recording-id').textContent;
      expect(second).not.toBe(first);
      expect(rec.mr.instances).toHaveLength(2);
      // Nie zwei zugleich: ein MediaRecorder und eine Sperre zur Zeit, und A gibt das Mikrofon frei, bevor B es öffnet
      expect(shared.maxRunning).toBe(1);
      expect(locks.maxHeld).toBe(1);
      expect(rec.getUserMedia).toHaveBeenCalledTimes(2);
      const [trackA] = rec.tracks;
      expect(trackA?.stop).toHaveBeenCalled();
      expect(trackA!.stop.mock.invocationCallOrder[0]).toBeLessThan(
        rec.getUserMedia.mock.invocationCallOrder[1]!,
      );

      // A: letzter Chunk (laufender Chunk 0 und der beim Stopp) und complete. Der Uploader löscht die Aufnahme erst nach
      // dem `complete` aus der Ablage; danach ist für A alles beim Core.
      await waitFor(async () => expect(await rec.store.getRecording(first!)).toBeNull());
      // Im Tab arbeiten zwei Uploader dieselbe Ablage ab: der Abschluss von A (`flushUploads`) und der Recorder von B.
      // Je nach Takt senden beide denselben Chunk und dasselbe `complete`. Das ist erlaubt (VERTRAEGE §10.2: „200 bei
      // Duplikat“, `complete` mit denselben Werten ist wirkungslos). Geprüft wird darum, WAS beim Core ankommt, nicht
      // wie oft: jede `seq` von A mit genau einem Inhalt, `complete` nur mit `last_seq` 1.
      const shaBySeq = new Map<number, Set<string>>();
      for (const [url, init] of uploads(new RegExp(`^PUT .*/recordings/${first}/chunks/\\d+$`))) {
        const seq = Number(String(url).split('/').pop());
        const sha = (init as RequestInit & { headers: Record<string, string> }).headers['X-Sha256']!;
        shaBySeq.set(seq, (shaBySeq.get(seq) ?? new Set()).add(sha));
      }
      expect([...shaBySeq.keys()].sort((a, b) => a - b)).toEqual([0, 1]);
      for (const shas of shaBySeq.values()) expect(shas.size).toBe(1);
      const completesA = uploads(new RegExp(`^POST .*/recordings/${first}/complete$`));
      expect(completesA.length).toBeGreaterThanOrEqual(1);
      for (const [, init] of completesA)
        expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ last_seq: 1 });
      // B: eigene Aufnahme für die neue Session, noch nicht abgeschlossen. Abgeschlossen wurde nur A.
      const createsB = uploads(new RegExp(`^POST .*/sessions/${B_ID}/recordings$`));
      expect(createsB.length).toBeGreaterThanOrEqual(1);
      for (const [, init] of createsB)
        expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ id: second });
      expect(uploads(new RegExp(`^POST .*/recordings/${second}/complete$`))).toHaveLength(0);
      expect(uploads(/^POST .*\/complete$/)).toHaveLength(completesA.length);
      // B beginnt mit der Sitzungszeit von B
      const recordings = await rec.store.listRecordings();
      expect(recordings.find((r) => r.sessionId === B_ID)?.startedMs).toBeGreaterThanOrEqual(0);
    },
  );

  it('Start von B aus dem Dashboard von B: der alte Recorder von A startet nicht wieder', async () => {
    const locks = new FakeWebLocks();
    const shared = { running: new Set<object>(), maxRunning: 0 };
    boot({
      sessions: [session(A_ID), B()],
      rec: fakeRecording({ locks, shared }),
      ui: <Dashboard id={B_ID} />,
    });
    await waitFor(() => expect(shownSession()).toBe(A_ID));
    await settle();
    // A läuft, aber kein Dashboard zeigt A: keine Aufnahme (Schalter)
    expect(kind()).toBe('inactive');
    expect(rec.getUserMedia).not.toHaveBeenCalled();

    await switchToB('b-first');
    await waitFor(() => expect(shownSession()).toBe(B_ID));
    await waitFor(() => expect(kind()).toBe('rec'));
    await settle(150);
    // Genau eine Aufnahme, und zwar für B
    expect(rec.getUserMedia).toHaveBeenCalledTimes(1);
    expect(rec.mr.instances).toHaveLength(1);
    expect(shared.maxRunning).toBe(1);
    expect(uploads(new RegExp(`^POST .*/sessions/${B_ID}/recordings$`))).toHaveLength(1);

    // B endet und gibt die Sperre frei: Auch jetzt nimmt kein übrig gebliebener Recorder für A auf
    await sync.emit(
      'session.updated',
      session(B_ID, { number: 8, state: 'beendet', updated_at: '2026-11-04T08:50:00Z' }),
    );
    await waitFor(() => expect(uploads(/^POST .*\/complete$/)).toHaveLength(1));
    await settle(150);
    expect(rec.getUserMedia).toHaveBeenCalledTimes(1);
    expect(shared.running.size).toBe(0);
    expect(uploads(new RegExp(`^POST .*/sessions/${A_ID}/recordings$`))).toHaveLength(0);
  });

  it('A → B → C kurz hintereinander ohne Sperre: C wartet auf A, nicht nur auf B', async () => {
    const shared = { running: new Set<object>(), maxRunning: 0 };
    const base = fakeRecording({ shared });
    // Der letzte Chunk von A wird erst auf Kommando geschrieben: A ist dann noch nicht fertig gestoppt
    let hold = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const addChunk = base.store.addChunk.bind(base.store);
    base.store.addChunk = async (...args) => {
      if (hold) await gate;
      return addChunk(...args);
    };
    const C_ID = '0190f6a2-0000-7000-8000-0000000000e4';
    boot({
      sessions: [session(A_ID), B(), session(C_ID, { number: 9, state: 'bereit' })],
      rec: base,
      env: { acquireLock: async () => () => undefined },
    });
    await waitFor(() => expect(kind()).toBe('rec'));
    hold = true;
    await switchToB('a-first');
    await waitFor(() => expect(shownSession()).toBe(B_ID));
    // B wartet noch auf A; schon startet C (der Core beendet B)
    let result!: Awaited<ReturnType<typeof startSession>>;
    await act(async () => {
      result = await startSession(C_ID);
    });
    await sync.emit('session.updated', result.ended_session!);
    await sync.emit('session.updated', result.session);
    await waitFor(() => expect(shownSession()).toBe(C_ID));
    await settle(150);
    // A ist noch nicht gestoppt: C hat das Mikrofon noch nicht geöffnet
    expect(base.getUserMedia).toHaveBeenCalledTimes(1);
    expect(shared.maxRunning).toBe(1);

    release();
    await waitFor(() => expect(kind()).toBe('rec'));
    expect(base.getUserMedia).toHaveBeenCalledTimes(2);
    expect(shared.maxRunning).toBe(1);
    expect(shared.running.size).toBe(1);
  });

  it('ohne Sperre (Web Locks fehlen) wartet B, bis A gestoppt ist (previousStopped)', async () => {
    const shared = { running: new Set<object>(), maxRunning: 0 };
    const base = fakeRecording({ shared });
    // Der letzte Chunk von A wird erst auf Kommando geschrieben: A ist dann noch nicht fertig gestoppt
    let hold = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const addChunk = base.store.addChunk.bind(base.store);
    base.store.addChunk = async (...args) => {
      if (hold) await gate;
      return addChunk(...args);
    };
    boot({
      sessions: [session(A_ID), B()],
      rec: base,
      env: { acquireLock: async () => () => undefined },
    });
    await waitFor(() => expect(kind()).toBe('rec'));
    hold = true;
    await switchToB('a-first');
    await waitFor(() => expect(shownSession()).toBe(B_ID));
    await settle(150);
    // B hat das Mikrofon noch nicht geöffnet
    expect(base.getUserMedia).toHaveBeenCalledTimes(1);
    expect(kind()).not.toBe('rec');

    release();
    await waitFor(() => expect(kind()).toBe('rec'));
    expect(base.getUserMedia).toHaveBeenCalledTimes(2);
    expect(rec.mr.instances).toHaveLength(2);
    expect(shared.maxRunning).toBe(1);
    expect(shared.running.size).toBe(1);
  });

  it('A hängt in der Mikrofon-Abfrage: B wartet, danach gibt A das Mikrofon frei und B startet', async () => {
    let answer: (s: MediaStream) => void = () => undefined;
    const late = fakeStream();
    let calls = 0;
    const shared = { running: new Set<object>(), maxRunning: 0 };
    const base = fakeRecording({
      shared,
      getUserMedia: () => {
        calls++;
        return calls === 1
          ? new Promise<MediaStream>((resolve) => {
              answer = resolve;
            })
          : Promise.resolve(fakeStream());
      },
    });
    boot({ sessions: [session(A_ID), B()], rec: base, env: { waitHintMs: 20 } });
    await waitFor(() => expect(base.getUserMedia).toHaveBeenCalledTimes(1));
    await switchToB('a-first');
    await waitFor(() => expect(shownSession()).toBe(B_ID));
    await waitFor(() => expect(kind()).toBe('waiting'));
    expect(base.getUserMedia).toHaveBeenCalledTimes(1);

    answer(late);
    await waitFor(() => expect(kind()).toBe('rec'));
    expect(late.tracks[0]?.stop).toHaveBeenCalled();
    expect(base.getUserMedia).toHaveBeenCalledTimes(2);
    expect(shared.maxRunning).toBe(1);
  });

  it('StrictMode (Mount, Unmount, Mount): genau ein laufender Recorder', async () => {
    const shared = { running: new Set<object>(), maxRunning: 0 };
    boot({ rec: fakeRecording({ shared }), strict: true });
    await waitFor(() => expect(kind()).toBe('rec'));
    await settle();
    expect(shared.running.size).toBe(1);
    expect(shared.maxRunning).toBe(1);
  });
});

describe('RecordingProvider: Ende der Session', () => {
  it('der Recorder bleibt für die beendete Session stehen und sichert alles', async () => {
    boot();
    await waitFor(() => expect(kind()).toBe('rec'));
    const id = screen.getByTestId('recording-id').textContent;
    act(() => rec.mr.instances[0]?.emit(16));
    await sync.emit(
      'session.updated',
      session(A_ID, { state: 'beendet', updated_at: '2026-11-04T08:40:00Z' }),
    );
    await waitFor(() => expect(kind()).toBe('inactive'));
    expect(phase()).toBe('andere');
    // Weiterhin die zuletzt verfolgte Session, derselbe Recorder
    expect(shownSession()).toBe(A_ID);
    expect(screen.getByTestId('recording-id').textContent).toBe(id);
    await waitFor(() => expect(uploads(/^POST .*\/complete$/)).toHaveLength(1));
    expect(rec.mr.instances).toHaveLength(1);
    expect(rec.mr.instances[0]?.state).toBe('inactive');
  });

  it('der Auto-Stopp gibt die Antwort des Stopps in den Cache: kein Warten aufs Polling', async () => {
    // Regel 4: 4 h Höchstdauer (fake-core) sind lange vorbei
    boot({ sessions: [session(A_ID, { started_at: '2026-11-04T03:00:00Z' })] });
    await waitFor(() => expect(requests(/^POST \/sessions\/[^/]+\/stop$/)).toHaveLength(1), {
      timeout: 5000,
    });
    // Vorab-Abgleich vor dem Stopp (Plan E7)
    expect(requests(/^GET \/sessions\/[^/?]+$/).length).toBeGreaterThanOrEqual(1);
    // Online fragt niemand nach; der Cache kennt das Ende nur durch die Antwort des Stopps
    await waitFor(() => expect(phase()).toBe('andere'));
    expect(kind()).toBe('inactive');
    expect(requests(/^GET \/sessions\?state=/)).toHaveLength(1);
  });
});

describe('RecordingProvider: Pausendauer', () => {
  it('der Provider misst die Pause einmal: Beginn = updated_at der ersten pausierten Fassung', async () => {
    window.sessionStorage.clear();
    boot({ sessions: [session(A_ID, { state: 'pausiert', updated_at: '2026-11-04T08:30:00Z' })] });
    await waitFor(() => expect(phase()).toBe('pausiert'));
    await waitFor(() =>
      expect(screen.getByTestId('paused-since').textContent).toBe(String(Date.parse('2026-11-04T08:30:00Z'))),
    );
    expect(kind()).toBe('paused');
  });
});
