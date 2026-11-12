// UX-03 (Rest) und UX-10: „Mikrofon testen“ in Einstellungen → Vorlesung, Backup-Hinweis auf „Heute“
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '@sg/shared';

const rec = vi.hoisted(() => ({ phase: 'andere' as 'andere' | 'laeuft' | 'pausiert' }));
vi.mock('../src/lib/recording/index.ts', async (original) => ({
  ...(await original<typeof import('../src/lib/recording/index.ts')>()),
  useRecordingView: () => ({ phase: rec.phase }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn() }),
}));

import { MicTest, MIC_TEST_MAX_MS } from '../src/components/settings/MicTest.tsx';
import { BackupHint } from '../src/components/today/BackupHint.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { fakeStream, type FakeStream } from './recording-fakes.ts';
import { makeSession } from './fake-core.ts';

// ---------------------------------------------------------------------------------------------
// Mikrofon testen
// ---------------------------------------------------------------------------------------------

/** Web Audio in klein: der Analysator liefert einen festen Pegel (`amplitude.value`) */
const amplitude = { value: 0.3 };
const contexts: { closed: boolean }[] = [];
class FakeAudioContext {
  state = 'running';
  closed = false;
  constructor() {
    contexts.push(this);
  }
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }
  createAnalyser() {
    return {
      fftSize: 0,
      getFloatTimeDomainData(array: Float32Array) {
        array.fill(amplitude.value);
      },
    };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

let getUserMedia: ReturnType<typeof vi.fn>;
let streams: FakeStream[];

beforeEach(() => {
  rec.phase = 'andere';
  amplitude.value = 0.3;
  contexts.length = 0;
  streams = [];
  getUserMedia = vi.fn(async () => {
    const s = fakeStream();
    streams.push(s);
    return s;
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  vi.stubGlobal('AudioContext', FakeAudioContext);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

const allTracksStopped = () => streams.every((s) => s.tracks.every((t) => t.stop.mock.calls.length > 0));

describe('Mikrofon testen', () => {
  it('zeigt den Pegel, nimmt nichts auf und gibt das Mikrofon beim Beenden frei', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<MicTest microphoneId={null} />);
    await user.click(screen.getByRole('button', { name: 'Mikrofon testen' }));
    const meter = await screen.findByRole('meter', { name: 'Pegel des Mikrofons' });
    await waitFor(() => expect(Number(meter.getAttribute('aria-valuenow'))).toBeGreaterThan(20));
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { channelCount: 1 } });
    expect(streams[0]!.tracks[0]!.stop).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Test beenden' }));
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Das Mikrofon funktioniert');
    expect(allTracksStopped()).toBe(true);
    expect(contexts.every((c) => c.closed)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled(); // kein Upload
  });

  it('nutzt das gewählte Mikrofon', async () => {
    const user = userEvent.setup();
    render(<MicTest microphoneId="mic-7" />);
    await user.click(screen.getByRole('button', { name: 'Mikrofon testen' }));
    await screen.findByRole('meter');
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { channelCount: 1, deviceId: { exact: 'mic-7' } },
    });
  });

  it('endet nach der Höchstdauer von selbst; Stille meldet „Kein Signal“', async () => {
    amplitude.value = 0;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<MicTest microphoneId={null} />);
    await user.click(screen.getByRole('button', { name: 'Mikrofon testen' }));
    await screen.findByRole('meter');
    await act(async () => {
      vi.advanceTimersByTime(MIC_TEST_MAX_MS + 100);
    });
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Kein Signal gehört');
    expect(allTracksStopped()).toBe(true);
  });

  it('verweigerter Zugriff: verständliche Meldung, nichts bleibt offen', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    const user = userEvent.setup();
    render(<MicTest microphoneId={null} />);
    await user.click(screen.getByRole('button', { name: 'Mikrofon testen' }));
    expect(await screen.findByText(/Zugriff auf das Mikrofon ist verweigert/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mikrofon testen' })).toBeEnabled();
  });

  it('gewähltes Mikrofon fehlt: eigene Meldung', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'OverconstrainedError' }));
    const user = userEvent.setup();
    render(<MicTest microphoneId="weg" />);
    await user.click(screen.getByRole('button', { name: 'Mikrofon testen' }));
    expect(await screen.findByText(/Dieses Mikrofon wurde nicht gefunden/)).toBeInTheDocument();
  });

  it('läuft eine Session im Tab: Knopf gesperrt mit Grund, getUserMedia wird nie gerufen', async () => {
    rec.phase = 'laeuft';
    render(<MicTest microphoneId={null} />);
    expect(screen.getByRole('button', { name: 'Mikrofon testen' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/Gesperrt: In diesem Tab läuft gerade eine Session/);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('beginnt eine Session während des Tests, wird das Mikrofon sofort freigegeben', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MicTest microphoneId={null} />);
    await user.click(screen.getByRole('button', { name: 'Mikrofon testen' }));
    await screen.findByRole('meter');
    rec.phase = 'laeuft';
    rerender(<MicTest microphoneId={null} />);
    await waitFor(() => expect(screen.queryByRole('meter')).toBeNull());
    expect(allTracksStopped()).toBe(true);
    expect(screen.getByRole('button', { name: 'Mikrofon testen' })).toBeDisabled();
  });

  it('beim Verlassen der Seite wird das Mikrofon freigegeben', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<MicTest microphoneId={null} />);
    await user.click(screen.getByRole('button', { name: 'Mikrofon testen' }));
    await screen.findByRole('meter');
    unmount();
    expect(allTracksStopped()).toBe(true);
  });

  it('Seite verlassen, während der Browser-Dialog offen ist: Spur wird nachträglich freigegeben', async () => {
    let answer: (s: MediaStream) => void = () => undefined;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          answer = resolve;
        }),
    );
    const user = userEvent.setup();
    const { unmount } = render(<MicTest microphoneId={null} />);
    await user.click(screen.getByRole('button', { name: 'Mikrofon testen' }));
    unmount();
    const late = fakeStream();
    await act(async () => answer(late));
    expect(late.tracks[0]!.stop).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// Backup-Hinweis auf „Heute“
// ---------------------------------------------------------------------------------------------

const DAY = 86_400_000;
function stubBackups(status: Record<string, unknown> | 'fehler') {
  const fetchSpy = vi.fn(async (input: string) => {
    if (!String(input).includes('/backups') || status === 'fehler')
      return Response.json({ error: { code: 'not_found', message: 'x' } }, { status: 404 });
    return Response.json({
      status: {
        target: '/Volumes/Backup',
        last_success_at: new Date(Date.now() - 5 * DAY).toISOString(),
        next_run_at: null,
        stale: true,
        running: false,
        restore_test: null,
        ...status,
      },
      items: [],
      next_cursor: null,
    });
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}
function hint(sessions: Session[] = []) {
  return render(
    <QueryProvider>
      <BackupHint sessions={sessions} />
    </QueryProvider>,
  );
}

describe('Backup-Hinweis (UX-10)', () => {
  it('Ziel gesetzt, letztes Backup älter als 3 Tage: ruhige Zeile mit Link zu Einstellungen → Daten', async () => {
    stubBackups({});
    hint();
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent(/älter als 3 Tage/);
    expect(screen.getByRole('link', { name: 'Daten und Backups' })).toHaveAttribute(
      'href',
      '/einstellungen?bereich=daten',
    );
  });

  it('Ziel gesetzt, noch nie gesichert: eigener Text', async () => {
    stubBackups({ last_success_at: null });
    hint();
    expect(await screen.findByText(/noch kein erfolgreiches Backup/)).toBeInTheDocument();
  });

  it('frisches Backup: kein Hinweis', async () => {
    const fetchSpy = stubBackups({ stale: false, last_success_at: new Date().toISOString() });
    hint();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('kein Ziel (bewusst kein Backup): kein Hinweis', async () => {
    const fetchSpy = stubBackups({ target: null, last_success_at: null });
    hint();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Core antwortet mit Fehler: kein Hinweis', async () => {
    const fetchSpy = stubBackups('fehler');
    hint();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('nie während einer Session (laufende Session in der Liste oder im Tab)', async () => {
    const fetchSpy = stubBackups({});
    const { unmount } = hint([makeSession({ state: 'pausiert' })]);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByRole('status')).toBeNull();
    unmount();

    rec.phase = 'laeuft';
    hint();
    await act(async () => undefined);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
