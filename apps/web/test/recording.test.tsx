// Aufnahme im Live-Dashboard (Issue #106): Statusleiste, Leader-Regel, Mikrofon-Berechtigung, Pegel für den Auto-Stopp.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '@sg/shared';
import { SessionView } from '../src/components/dashboard/SessionView.tsx';
import { RecordingEnvContext, type RecordingEnv } from '../src/components/dashboard/use-recording.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { SyncProvider } from '../src/lib/sync/SyncProvider.tsx';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { FakeWebLocks, fakeRecording, fakeStream, type FakeRecording } from './recording-fakes.ts';
import {
  MemoryRecorderStore,
  noteMicIntent,
  resetMicIntent,
  useResumePendingUploads,
} from '../src/lib/recorder/index.ts';
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

const DBS = makeModule({
  id: '0190f6a2-0000-7000-8000-0000000000a3',
  name: 'Datenbanksysteme',
  color: 'mod-03',
});
const SESSION_ID = '0190f6a2-0000-7000-8000-0000000000e1';
const NOW = '2026-11-04T08:42:13Z';

function running(overrides: Partial<Session> = {}): Session {
  return makeSession({
    id: SESSION_ID,
    module_id: DBS.id,
    number: 7,
    state: 'laeuft',
    started_at: '2026-11-04T08:00:00Z',
    created_at: '2026-11-03T08:00:00Z',
    updated_at: '2026-11-04T08:00:00Z',
    ...overrides,
  });
}

/** Sync-Client mit steuerbarem Zustand (Leader = nicht `other_tab`) */
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

let core: FakeCore;
let sync: ReturnType<typeof fakeSync>;
let rec: FakeRecording;

function boot(
  opts: { session?: Session; syncState?: string; rec?: FakeRecording; env?: Partial<RecordingEnv> } = {},
) {
  vi.setSystemTime(new Date(NOW));
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('min-width'),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
  nav.search = `id=${SESSION_ID}`;
  core = installFakeCore({
    semesters: [makeSemester()],
    modules: [DBS],
    sessions: [opts.session ?? running()],
  });
  core.notebooks = [];
  core.devices = [];
  sync = fakeSync(opts.syncState);
  rec = opts.rec ?? fakeRecording();
  const env = { ...rec.env, ...opts.env };
  return render(
    <ThemeProvider>
      <QueryProvider>
        <RecordingEnvContext.Provider value={env}>
          <SyncProvider client={sync.client}>
            <SessionView />
          </SyncProvider>
        </RecordingEnvContext.Provider>
      </QueryProvider>
    </ThemeProvider>,
  );
}

const bar = () => screen.getByLabelText('Statusleiste');
async function screenBar() {
  await screen.findByLabelText('Statusleiste');
  return bar();
}
const uploads = (re: RegExp) =>
  rec.fetch.mock.calls.filter(([url, init]) =>
    re.test(`${(init as RequestInit)?.method ?? 'GET'} ${String(url)}`),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  resetMicIntent();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Aufnahme im Dashboard: Start ohne zweiten Klick (UX-03)', () => {
  it('mit Startgeste kurz zuvor beginnt die Aufnahme ohne Klick, auch bei „prompt“', async () => {
    vi.setSystemTime(Date.parse(NOW) - 5000);
    noteMicIntent(SESSION_ID);
    boot({ rec: fakeRecording({ permission: 'prompt' }) });
    const b = await screenBar();
    expect(await within(b).findByText('REC')).toBeVisible();
    expect(rec.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('ohne Startgeste steht „Keine Aufnahme“ mit dem Knopf, das Mikrofon bleibt zu', async () => {
    boot({ rec: fakeRecording({ permission: 'prompt' }) });
    const b = await screenBar();
    const label = await within(b).findByText('Keine Aufnahme');
    expect(label).toHaveClass('font-semibold');
    const button = within(b).getByRole('button', { name: 'Aufnahme starten' });
    expect(button).toHaveClass('bg-accent');
    await new Promise((r) => setTimeout(r, 50));
    expect(rec.getUserMedia).not.toHaveBeenCalled();
  });

  it('eine Startgeste für eine andere Session zählt nicht (z. B. nach gescheitertem Start)', async () => {
    vi.setSystemTime(Date.parse(NOW) - 5000);
    noteMicIntent('0190f6a2-0000-7000-8000-0000000000ff');
    boot({ rec: fakeRecording({ permission: 'prompt' }) });
    const b = await screenBar();
    expect(await within(b).findByText('Keine Aufnahme')).toBeVisible();
    await new Promise((r) => setTimeout(r, 50));
    expect(rec.getUserMedia).not.toHaveBeenCalled();
  });

  it('eine Startgeste, die über 60 s zurückliegt, zählt nicht', async () => {
    vi.setSystemTime(Date.parse(NOW) - 61_000);
    noteMicIntent(SESSION_ID);
    boot({ rec: fakeRecording({ permission: 'prompt' }) });
    const b = await screenBar();
    expect(await within(b).findByText('Keine Aufnahme')).toBeVisible();
    await new Promise((r) => setTimeout(r, 50));
    expect(rec.getUserMedia).not.toHaveBeenCalled();
  });
});

describe('Aufnahme im Dashboard: Seite verlassen fragt nach (UX-02)', () => {
  /** `true`, wenn ein Handler `beforeunload` abgefangen hat */
  function leaveIsBlocked(): boolean {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('bei REC wird das Verlassen abgefangen; nach Beenden und Unmount nicht mehr', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    const view = boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    expect(leaveIsBlocked()).toBe(true);

    await user.click(within(b).getByRole('button', { name: 'Beenden' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Session beenden' }),
    );
    await within(b).findByText('Beendet');
    await waitFor(() => expect(leaveIsBlocked()).toBe(false));
    view.unmount();
    expect(leaveIsBlocked()).toBe(false);
  });

  it('nach dem Unmount mitten in der Aufnahme ist der Handler entfernt', async () => {
    const view = boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    view.unmount();
    expect(leaveIsBlocked()).toBe(false);
  });

  it('ohne Aufnahme (Keine Aufnahme) und im Folge-Tab wird nichts abgefangen', async () => {
    boot({ rec: fakeRecording({ permission: 'prompt' }) });
    const b = await screenBar();
    await within(b).findByText('Keine Aufnahme');
    expect(leaveIsBlocked()).toBe(false);
    cleanup();

    boot({ syncState: 'other_tab' });
    const b2 = await screenBar();
    await within(b2).findByText('Aufnahme in anderem Tab');
    expect(leaveIsBlocked()).toBe(false);
  });
});

describe('Aufnahme im Dashboard: Upload-Status (UX-08)', () => {
  /** PUTs der Chunks bleiben hängen, bis `release()` kommt; alles andere geht durch */
  function holdChunks() {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    rec.fetch.mockImplementation(async (url: unknown, init?: RequestInit) => {
      if (init?.method === 'PUT' && /\/chunks\/\d+$/.test(String(url))) await gate;
      return Response.json({}, { status: 201 });
    });
    return () => release();
  }

  it('ab 3 wartenden Teilen steht der Rückstau; nach Beenden „Wird gesichert …“, dann „Gesichert“', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot();
    const release = holdChunks();
    const b = await screenBar();
    await within(b).findByText('REC');
    expect(within(b).queryByTestId('upload-status')).toBeNull();
    act(() => {
      for (let i = 0; i < 3; i++) rec.mr.instances[0]?.emit(16);
    });
    expect(await within(b).findByTestId('upload-status')).toHaveTextContent('3 Teile warten');

    await user.click(within(b).getByRole('button', { name: 'Beenden' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Session beenden' }),
    );
    await within(b).findByText('Beendet');
    expect(await within(b).findByText('Wird gesichert …')).toBeVisible();

    release();
    await waitFor(() => expect(within(b).getByTestId('upload-status')).toHaveTextContent('Gesichert'));
    expect(uploads(/^POST .*\/complete$/)).toHaveLength(1);
  });

  it('abgelehnte Teile liegen zurückgestellt: nach Beenden nicht still „Gesichert“', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot();
    rec.fetch.mockImplementation(async (url: unknown, init?: RequestInit) => {
      if (init?.method === 'PUT' && /\/chunks\/\d+$/.test(String(url)))
        return Response.json({ error: { code: 'chunk_conflict', message: 'm' } }, { status: 409 });
      return Response.json({}, { status: 201 });
    });
    const b = await screenBar();
    await within(b).findByText('REC');
    act(() => rec.mr.instances[0]?.emit(16));
    await user.click(within(b).getByRole('button', { name: 'Beenden' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Session beenden' }),
    );
    await waitFor(() =>
      expect(within(b).getByTestId('upload-status')).toHaveTextContent(
        /Gesichert, \d+ Teile? zurückgestellt/,
      ),
    );
  });

  it('bei 1 wartenden Teil steht nichts', async () => {
    boot();
    holdChunks();
    const b = await screenBar();
    await within(b).findByText('REC');
    act(() => rec.mr.instances[0]?.emit(16));
    await waitFor(() => expect(uploads(/^PUT .*\/chunks\/0$/)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(within(b).queryByTestId('upload-status')).toBeNull();
  });

  it('ein Folge-Tab zeigt keinen Upload-Status', async () => {
    const base = fakeRecording({ permission: 'prompt' });
    await seedLeftover(base.store);
    boot({ rec: base, syncState: 'other_tab' });
    const b = await screenBar();
    await within(b).findByText('Aufnahme in anderem Tab');
    await new Promise((r) => setTimeout(r, 50));
    expect(within(b).queryByTestId('upload-status')).toBeNull();
  });
});

describe('Aufnahme im Dashboard: Leader-Tab', () => {
  it('der Leader nimmt auf: REC, Chunks gehen an den Core', async () => {
    boot();
    const b = await screenBar();
    expect(await within(b).findByText('REC')).toBeVisible();
    expect(rec.getUserMedia).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(rec.mr.instances).toHaveLength(1));
    await waitFor(() => expect(uploads(/^POST .*\/sessions\/[^/]+\/recordings$/)).toHaveLength(1));
    act(() => rec.mr.instances[0]?.emit(32));
    await waitFor(() => expect(uploads(/^PUT .*\/recordings\/[^/]+\/chunks\/0$/)).toHaveLength(1));
  });

  it('ein Folge-Tab zeigt „Aufnahme in anderem Tab“ und öffnet das Mikrofon nicht', async () => {
    boot({ syncState: 'other_tab' });
    const b = await screenBar();
    expect(await within(b).findByText('Aufnahme in anderem Tab')).toBeVisible();
    expect(within(b).queryByText('REC')).toBeNull();
    expect(within(b).queryByTestId('elapsed')).toBeNull();
    // Notizen und Steuerung bleiben bedienbar
    expect(within(b).getByRole('button', { name: 'Pause' })).toBeVisible();
    await new Promise((r) => setTimeout(r, 50));
    expect(rec.getUserMedia).not.toHaveBeenCalled();
    expect(rec.mr.instances).toHaveLength(0);
  });

  it('Leader-Wechsel im selben Tab: Rolle verloren stoppt die Aufnahme samt letztem Chunk, zurück nimmt neu auf', async () => {
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    act(() => rec.mr.instances[0]?.emit(32));
    await waitFor(() => expect(uploads(/^PUT .*\/chunks\/0$/)).toHaveLength(1));
    act(() => sync.setState('other_tab'));
    await within(b).findByText('Aufnahme in anderem Tab');
    // Der Ex-Leader schließt die Aufnahme lokal ab (letzter Chunk, `complete` in IndexedDB), lädt aber nichts mehr hoch:
    // das übernimmt der Leader
    await waitFor(async () => {
      const [meta] = await rec.store.listRecordings();
      expect(meta?.complete).not.toBeNull();
    });
    expect(uploads(/^PUT .*\/chunks\/1$/)).toHaveLength(0);
    expect(uploads(/^POST .*\/complete$/)).toHaveLength(0);

    // Wieder Leader: der Rest geht hoch (letzter Chunk und complete), und es wird neu aufgenommen
    act(() => sync.setState('online'));
    await within(b).findByText('REC');
    expect(rec.mr.instances).toHaveLength(2);
    await waitFor(() => expect(uploads(/^PUT .*\/chunks\/1$/)).toHaveLength(1));
    await waitFor(() => expect(uploads(/^POST .*\/complete$/)).toHaveLength(1));
  });

  it('Pause beendet die Aufnahme, Fortsetzen beginnt eine neue, Beenden schließt ab', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    await user.click(within(b).getByRole('button', { name: 'Pause' }));
    await within(b).findByText('Pausiert');
    await waitFor(() => expect(uploads(/^POST .*\/complete$/)).toHaveLength(1));
    expect(rec.mr.instances[0]?.state).toBe('inactive');

    await user.click(within(b).getByRole('button', { name: 'Fortsetzen' }));
    await within(b).findByText('REC');
    expect(rec.mr.instances).toHaveLength(2);

    await user.click(within(b).getByRole('button', { name: 'Beenden' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Session beenden' }),
    );
    await within(b).findByText('Beendet');
    await waitFor(() => expect(uploads(/^POST .*\/complete$/)).toHaveLength(2));
    expect(rec.mr.instances[1]?.state).toBe('inactive');
  });
});

describe('Aufnahme im Dashboard: Mikrofon-Berechtigung', () => {
  it('ohne erteilte Berechtigung öffnet erst die Nutzeraktion das Mikrofon', async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    boot({ rec: fakeRecording({ permission: 'prompt' }) });
    const b = await screenBar();
    expect(await within(b).findByText('Keine Aufnahme')).toBeVisible();
    expect(within(b).queryByText('REC')).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(rec.getUserMedia).not.toHaveBeenCalled();
    await user.click(within(b).getByRole('button', { name: 'Aufnahme starten' }));
    await within(b).findByText('REC');
    expect(rec.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('Zugriff verweigert: verständlicher Hinweis, die Session läuft weiter', async () => {
    boot({
      rec: fakeRecording({
        getUserMedia: async () => {
          throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
        },
      }),
    });
    const b = await screenBar();
    expect(await within(b).findByText('Zugriff verweigert')).toBeVisible();
    expect(await screen.findByTestId('recording-hint')).toHaveTextContent(
      /Mikrofon verweigert.*Notizen gehen/,
    );
    expect(within(b).getByRole('button', { name: 'Pause' })).toBeVisible();
    expect(within(b).queryByText('REC')).toBeNull();
  });

  it('bereits abgelehnte Berechtigung: nicht erneut fragen', async () => {
    boot({ rec: fakeRecording({ permission: 'denied' }) });
    const b = await screenBar();
    expect(await within(b).findByText('Zugriff verweigert')).toBeVisible();
    await new Promise((r) => setTimeout(r, 50));
    expect(rec.getUserMedia).not.toHaveBeenCalled();
  });

  it('Mikrofon fehlt: eigener Zustand', async () => {
    boot({
      rec: fakeRecording({
        getUserMedia: async () => {
          throw Object.assign(new Error('x'), { name: 'NotFoundError' });
        },
      }),
    });
    const b = await screenBar();
    expect(await within(b).findByText('Mikrofon fehlt')).toBeVisible();
    expect(await screen.findByTestId('recording-hint')).toHaveTextContent(/Kein Mikrofon gefunden/);
  });
});

describe('Aufnahme im Dashboard: verdeckter Tab (UX-04)', () => {
  function fakeDoc(initial: string) {
    const handlers = new Set<() => void>();
    const doc = {
      visibilityState: initial,
      addEventListener: (_t: 'visibilitychange', fn: () => void) => void handlers.add(fn),
      removeEventListener: (_t: 'visibilitychange', fn: () => void) => void handlers.delete(fn),
    };
    return {
      doc,
      set(next: string) {
        doc.visibilityState = next;
        act(() => handlers.forEach((fn) => fn()));
      },
    };
  }
  const lock = {
    request: async () => ({ release: async () => undefined, addEventListener: () => undefined }),
  };

  it('zeigt bei verdecktem Tab ruhig „Tab verdeckt“ und nimmt es beim Zurückkehren weg', async () => {
    const d = fakeDoc('visible');
    const base = fakeRecording();
    boot({
      rec: base,
      env: { recorder: { ...base.env.recorder, document: d.doc, navigator: { wakeLock: lock } } },
    });
    const b = await screenBar();
    await within(b).findByText('REC');
    expect(within(b).queryByText('Tab verdeckt')).toBeNull();
    d.set('hidden');
    const hint = await within(b).findByText('Tab verdeckt');
    expect(hint.className).not.toMatch(/danger|warn/);
    d.set('visible');
    await waitFor(() => expect(within(b).queryByText('Tab verdeckt')).toBeNull());
  });
});

describe('Aufnahme im Dashboard: Pegel für den Auto-Stopp', () => {
  it('Stille aus dem Recorder-Pegel führt zu „Stoppt gleich · weiter aufnehmen“', async () => {
    // Pegel 0,0005: hörbar vom Mikrofon (nicht digital null), aber unter der Sprachschwelle
    const ticks: (() => void)[] = [];
    const analyser = {
      fftSize: 0,
      getFloatTimeDomainData: (a: Float32Array) => a.fill(0.0005),
    };
    const context = {
      state: 'running',
      createMediaStreamSource: () => ({ connect: () => undefined, disconnect: () => undefined }),
      createAnalyser: () => analyser,
      close: async () => undefined,
    };
    const base = fakeRecording();
    boot({
      rec: base,
      env: {
        recorder: {
          ...base.env.recorder,
          getUserMedia: async () => fakeStream(),
          level: {
            createContext: () => context,
            setInterval: (fn) => {
              ticks.push(fn);
              return 1;
            },
            clearInterval: () => undefined,
          },
        },
      },
    });
    const b = await screenBar();
    await within(b).findByText('REC');
    await waitFor(() => expect(ticks.length).toBeGreaterThan(0));
    // 14 min 10 s Stille Sekunde für Sekunde; die Grenze liegt bei 15 min, die Vorwarnung 60 s davor
    const start = Date.parse(NOW);
    for (let s = 0; s <= 14 * 60 + 10; s++) {
      vi.setSystemTime(start + s * 1000);
      ticks.at(-1)?.();
    }
    expect(await within(b).findByText(/Stoppt gleich/, undefined, { timeout: 5000 })).toBeVisible();
    expect(within(b).getByRole('button', { name: /Weiter aufnehmen/ })).toBeVisible();
  });
});

/** Eine abgeschlossene, aber noch nicht hochgeladene Aufnahme (Rest eines früheren Laufs) */
async function seedLeftover(store: MemoryRecorderStore) {
  await store.putRecording({
    id: '0190f6a2-0000-7000-8000-0000000000f1',
    sessionId: SESSION_ID,
    mime: 'audio/webm;codecs=opus',
    codec: 'opus',
    startedMs: 0,
    chunksIndependent: false,
    created: true,
    nextSeq: 1,
    recordedMs: 1000,
    lastActivityAt: Date.now(),
    complete: { lastSeq: 0, durationMs: 1000 },
  });
  await store.putChunk({
    recordingId: '0190f6a2-0000-7000-8000-0000000000f1',
    seq: 0,
    startMs: 0,
    durationMs: 1000,
    sha256: 'a'.repeat(64),
    data: new ArrayBuffer(4),
    attempts: 0,
  });
}

describe('Aufnahme im Dashboard: nur der Leader lädt hoch', () => {
  it('ein Folge-Tab sendet weder PUT noch complete; wird er Leader, holt er sie nach', async () => {
    const base = fakeRecording({ permission: 'prompt' });
    await seedLeftover(base.store);
    boot({ rec: base, syncState: 'other_tab' });
    const b = await screenBar();
    await within(b).findByText('Aufnahme in anderem Tab');
    await new Promise((r) => setTimeout(r, 200));
    expect(base.fetch).not.toHaveBeenCalled();

    act(() => sync.setState('online'));
    await waitFor(() => expect(uploads(/^PUT .*\/chunks\/0$/)).toHaveLength(1));
    await waitFor(() => expect(uploads(/^POST .*\/complete$/)).toHaveLength(1));
  });

  it('wer die Leader-Rolle verliert, hört auf hochzuladen', async () => {
    const base = fakeRecording({ permission: 'prompt' });
    boot({ rec: base });
    await screenBar();
    await new Promise((r) => setTimeout(r, 100));
    act(() => sync.setState('other_tab'));
    await new Promise((r) => setTimeout(r, 50));
    await seedLeftover(base.store);
    await new Promise((r) => setTimeout(r, 200));
    expect(base.fetch).not.toHaveBeenCalled();
  });
});

describe('Aufnahme im Dashboard: Seite verlassen', () => {
  it('Unmount stoppt sauber: letzter Chunk (PUT), complete, Mikrofon frei', async () => {
    const view = boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    act(() => rec.mr.instances[0]?.emit(32));
    await waitFor(() => expect(uploads(/^PUT .*\/chunks\/0$/)).toHaveLength(1));
    view.unmount();
    await waitFor(() => expect(uploads(/^POST .*\/complete$/)).toHaveLength(1), { timeout: 5000 });
    // laufender Chunk und der Chunk beim Stopp
    expect(uploads(/^PUT .*\/chunks\/\d+$/)).toHaveLength(2);
    expect(rec.mr.instances[0]?.state).toBe('inactive');
    expect(rec.tracks.length).toBeGreaterThan(0);
    for (const t of rec.tracks) expect(t.stop).toHaveBeenCalled();
  });
});

const chunkSeqs = () =>
  new Set(uploads(/^PUT .*\/chunks\/\d+$/).map(([url]) => Number(String(url).split('/').pop())));

describe('Aufnahme im Dashboard: Rückstau beim Verlassen', () => {
  const slowCore = (ms: number) =>
    rec.fetch.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, ms));
      return Response.json({}, { status: 201 });
    });

  it('Unmount mit offenem Rückstau: der Flush lädt alle Chunks und complete noch hoch', async () => {
    const view = boot();
    slowCore(40);
    const b = await screenBar();
    await within(b).findByText('REC');
    act(() => {
      for (let i = 0; i < 3; i++) rec.mr.instances[0]?.emit(16);
    });
    view.unmount();
    await waitFor(() => expect(uploads(/^POST .*\/complete$/)).toHaveLength(1), { timeout: 5000 });
    // 3 laufende Chunks und der Chunk beim Stopp
    expect([...chunkSeqs()].sort()).toEqual([0, 1, 2, 3]);
  });

  it('dauert der Rückstau länger als der Flush, holt der app-weite Uploader des Leaders den Rest ab', async () => {
    const view = boot({ env: { flushMs: 1 } });
    slowCore(100);
    const b = await screenBar();
    await within(b).findByText('REC');
    renderHook(() =>
      useResumePendingUploads(sync.client, {
        store: rec.store,
        uploader: { baseUrl: 'http://core/api/v1', fetch: rec.fetch as unknown as typeof fetch },
      }),
    );
    act(() => {
      for (let i = 0; i < 3; i++) rec.mr.instances[0]?.emit(16);
    });
    view.unmount();
    await waitFor(() => expect(uploads(/^POST .*\/complete$/).length).toBeGreaterThanOrEqual(1), {
      timeout: 5000,
    });
    expect([...chunkSeqs()].sort()).toEqual([0, 1, 2, 3]);
  });

  it('der Rollenverlust meldet „Chunks liegen bereit“ auf dem Kanal', async () => {
    const seen: unknown[] = [];
    const channel = new BroadcastChannel('sg-recorder-uploads');
    channel.onmessage = (ev) => seen.push(ev.data);
    boot();
    const b = await screenBar();
    await within(b).findByText('REC');
    expect(seen).toEqual([]);
    act(() => sync.setState('other_tab'));
    await within(b).findByText('Aufnahme in anderem Tab');
    await waitFor(() => expect(seen).toContain('kick'));
    channel.close();
  });
});

describe('Aufnahme im Dashboard: wartender Leader', () => {
  it('zeigt „Wartet auf anderen Tab“, solange die Aufnahme-Sperre fremd gehalten wird', async () => {
    const locks = new FakeWebLocks();
    const holder = await locks.acquire(new AbortController().signal);
    boot({ rec: fakeRecording({ locks }), env: { waitHintMs: 20 } });
    const b = await screenBar();
    expect(await within(b).findByText('Wartet auf anderen Tab')).toBeVisible();
    expect(await screen.findByTestId('recording-hint')).toHaveTextContent(/Wartet auf den anderen Tab/);
    expect(rec.getUserMedia).not.toHaveBeenCalled();
    holder?.();
    await within(b).findByText('REC');
    expect(within(b).queryByText('Wartet auf anderen Tab')).toBeNull();
  });

  it('Zeitgrenze für getUserMedia: „Mikrofon fehlt“ mit Knopf; eine späte Antwort gibt das Mikrofon wieder frei', async () => {
    let answer: (s: MediaStream) => void = () => undefined;
    const late = fakeStream();
    const base = fakeRecording({
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          answer = resolve;
        }),
    });
    boot({ rec: base, env: { recorder: { ...base.env.recorder, getUserMediaTimeoutMs: 50 } } });
    const b = await screenBar();
    expect(await within(b).findByText('Mikrofon fehlt', undefined, { timeout: 3000 })).toBeVisible();
    expect(within(b).getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
    expect(late.tracks[0]?.stop).not.toHaveBeenCalled();
    answer(late);
    await waitFor(() => expect(late.tracks[0]?.stop).toHaveBeenCalledTimes(1));
    expect(base.mr.instances).toHaveLength(0);
  });
});
