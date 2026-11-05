// Aufnahme nur im Leader-Tab (Issue #106): Leader-Wechsel mitten in der Aufnahme, nie zwei Tabs gleichzeitig.
// Zwei „Tabs“ = zwei echte AudioRecorder mit gefälschtem MediaRecorder; die Sperre und die Leader-Rolle werden
// von Hand gesteuert, wie es `FakeLocks` in den Sync-Tests tut.
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { AudioRecorder, LeaderRecording, MemoryRecorderStore } from '../src/lib/recorder/index.ts';
import {
  FakeWebLocks,
  fakeStream,
  makeFakeMediaRecorder,
  type FakeStream,
  type FakeTrack,
  type SharedRunning,
} from './recording-fakes.ts';

const SESSION = '0190f6a2-0000-7000-8000-0000000000e1';

/** Ein Tab. `slowStop`: Der Browser braucht eine Weile, bis der MediaRecorder wirklich still ist. */
function makeTab(shared: SharedRunning, locks: FakeWebLocks, opts: { slowStop?: boolean } = {}) {
  const mr = makeFakeMediaRecorder(shared);
  if (opts.slowStop) {
    const stop = mr.prototype.stop;
    mr.prototype.stop = function (this: InstanceType<typeof mr>) {
      setTimeout(() => stop.call(this), 30);
    };
  }
  const store = new MemoryRecorderStore();
  const calls: string[] = [];
  const tracks: FakeTrack[] = [];
  const recorder = new AudioRecorder({
    sessionId: SESSION,
    sessionMs: () => 0,
    store,
    getUserMedia: async () => {
      const stream: FakeStream = fakeStream();
      tracks.push(...stream.tracks);
      return stream;
    },
    MediaRecorder: mr,
    level: { createContext: () => null },
    navigator: {},
    uploader: {
      baseUrl: 'http://core/api/v1',
      fetch: (async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname.replace('/api/v1', '')}`);
        return Response.json({}, { status: 201 });
      }) as unknown as typeof fetch,
    },
  });
  const control = new LeaderRecording({ recorder, acquireLock: locks.acquire });
  return { mr, store, recorder, control, calls, tracks };
}

const lead = (tab: ReturnType<typeof makeTab>, leader: boolean) =>
  tab.control.set({ leader, phase: 'laeuft', allowed: true });

describe('Aufnahme nur im Leader-Tab', () => {
  it('ein Folge-Tab nimmt nie auf', async () => {
    const shared = { running: new Set<object>(), maxRunning: 0 };
    const locks = new FakeWebLocks();
    const a = makeTab(shared, locks);
    const b = makeTab(shared, locks);
    lead(a, true);
    lead(b, false);
    await a.control.idle();
    await b.control.idle();
    expect(a.recorder.getStatus().state).toBe('recording');
    expect(b.recorder.getStatus().state).toBe('idle');
    expect(b.mr.instances).toHaveLength(0);
    expect(shared.maxRunning).toBe(1);
  });

  it('Leader-Wechsel: der alte Tab schließt seine Aufnahme ab (letzter Chunk), erst dann nimmt der neue auf; nie zwei gleichzeitig', async () => {
    const shared = { running: new Set<object>(), maxRunning: 0 };
    const locks = new FakeWebLocks();
    // Der alte Tab ist langsam: ohne die Sperre würde der neue schon aufnehmen, bevor er still ist
    const a = makeTab(shared, locks, { slowStop: true });
    const b = makeTab(shared, locks);
    lead(a, true);
    lead(b, false);
    await a.control.idle();
    a.mr.instances[0]?.emit(16);
    await vi.waitFor(() => expect(a.recorder.getStatus().chunkCount).toBe(1));

    // takeOver: B wird Leader, A verliert die Rolle (im selben Augenblick)
    lead(b, true);
    lead(a, false);
    await Promise.all([a.control.idle(), b.control.idle()]);

    expect(a.recorder.getStatus().state).toBe('stopped');
    expect(b.recorder.getStatus().state).toBe('recording');
    expect(shared.maxRunning).toBe(1);
    // A: beide Chunks (16 Byte laufend, 4 Byte beim Stopp) sind beim Core angekommen und die Aufnahme ist abgeschlossen
    await vi.waitFor(() =>
      expect(a.calls.filter((c) => /^POST \/recordings\/.+\/complete$/.test(c))).toHaveLength(1),
    );
    expect(
      a.calls.filter((c) => /^PUT \/recordings\/.+\/chunks\/\d+$/.test(c)).map((c) => c.split('/').pop()),
    ).toEqual(['0', '1']);
    expect(b.mr.instances).toHaveLength(1);
  });

  it('Tab geschlossen (Sperre frei): der Folge-Tab wird Leader und nimmt auf', async () => {
    const shared = { running: new Set<object>(), maxRunning: 0 };
    const locks = new FakeWebLocks();
    const a = makeTab(shared, locks);
    const b = makeTab(shared, locks);
    lead(a, true);
    await a.control.idle();
    lead(b, false);
    // A wird geschlossen: die Aufnahme endet, B bekommt die Rolle
    a.control.dispose();
    await a.control.idle();
    lead(b, true);
    await b.control.idle();
    expect(b.recorder.getStatus().state).toBe('recording');
    expect(shared.maxRunning).toBe(1);
  });

  it('Pause stoppt die Aufnahme, Fortsetzen beginnt eine neue; Beenden schließt ab', async () => {
    const shared = { running: new Set<object>(), maxRunning: 0 };
    const a = makeTab(shared, new FakeWebLocks());
    lead(a, true);
    await a.control.idle();
    a.control.set({ phase: 'pausiert' });
    await a.control.idle();
    expect(a.recorder.getStatus().state).toBe('paused');
    expect(shared.running.size).toBe(0);
    a.control.set({ phase: 'laeuft' });
    await a.control.idle();
    expect(a.recorder.getStatus().state).toBe('recording');
    expect(a.mr.instances).toHaveLength(2);
    a.control.set({ phase: 'andere' });
    await a.control.idle();
    expect(a.recorder.getStatus().state).toBe('stopped');
    expect(shared.running.size).toBe(0);
  });

  it('ohne Erlaubnis bleibt das Mikrofon zu, bis die Nutzeraktion kommt', async () => {
    const shared = { running: new Set<object>(), maxRunning: 0 };
    const a = makeTab(shared, new FakeWebLocks());
    a.control.set({ leader: true, phase: 'laeuft', allowed: false });
    await a.control.idle();
    expect(a.recorder.getStatus().state).toBe('idle');
    a.control.retry();
    await a.control.idle();
    expect(a.recorder.getStatus().state).toBe('recording');
  });

  it('ein Fehler beim Öffnen führt nicht zu einer Schleife; „Erneut versuchen“ versucht es noch einmal', async () => {
    const shared = { running: new Set<object>(), maxRunning: 0 };
    const mr = makeFakeMediaRecorder(shared);
    const getUserMedia = vi.fn(async () => {
      throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
    });
    const recorder = new AudioRecorder({
      sessionId: SESSION,
      sessionMs: () => 0,
      store: new MemoryRecorderStore(),
      getUserMedia,
      MediaRecorder: mr,
      level: { createContext: () => null },
      navigator: {},
    });
    const control = new LeaderRecording({ recorder, acquireLock: new FakeWebLocks().acquire });
    control.set({ leader: true, phase: 'laeuft', allowed: true });
    await control.idle();
    control.set({ phase: 'laeuft', allowed: false });
    control.set({ allowed: true });
    await control.idle();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(recorder.getStatus().micIssue).toBe('denied');
    control.retry();
    await control.idle();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  describe('Mikrofon wird freigegeben (track.stop)', () => {
    it('nach dem Stopp der Session', async () => {
      const a = makeTab({ running: new Set(), maxRunning: 0 }, new FakeWebLocks());
      lead(a, true);
      await a.control.idle();
      expect(a.tracks).toHaveLength(1);
      expect(a.tracks[0]?.stop).not.toHaveBeenCalled();
      a.control.set({ phase: 'andere' });
      await a.control.idle();
      expect(a.tracks[0]?.stop).toHaveBeenCalledTimes(1);
    });

    it('nach dem Verlust der Leader-Rolle', async () => {
      const a = makeTab({ running: new Set(), maxRunning: 0 }, new FakeWebLocks());
      lead(a, true);
      await a.control.idle();
      lead(a, false);
      await a.control.idle();
      expect(a.tracks[0]?.stop).toHaveBeenCalledTimes(1);
    });

    it('nach dem Entfernen (Unmount): sauberer Stopp, dann Aufräumen', async () => {
      const a = makeTab({ running: new Set(), maxRunning: 0 }, new FakeWebLocks());
      lead(a, true);
      await a.control.idle();
      a.control.dispose();
      await a.control.idle();
      expect(a.tracks[0]?.stop).toHaveBeenCalled();
      a.recorder.dispose();
    });

    it('bei Pause bleibt es offen (§9.1), erst der Stopp gibt frei', async () => {
      const a = makeTab({ running: new Set(), maxRunning: 0 }, new FakeWebLocks());
      lead(a, true);
      await a.control.idle();
      a.control.set({ phase: 'pausiert' });
      await a.control.idle();
      expect(a.tracks).toHaveLength(1);
      expect(a.tracks[0]?.stop).not.toHaveBeenCalled();
    });
  });

  it('wartender neuer Leader: isWaiting, solange ein anderer Tab die Aufnahme-Sperre hält', async () => {
    const locks = new FakeWebLocks();
    const holder = await locks.acquire(new AbortController().signal);
    const b = makeTab({ running: new Set(), maxRunning: 0 }, locks);
    const seen: boolean[] = [];
    b.control.subscribe(() => seen.push(b.control.isWaiting()));
    lead(b, true);
    await vi.waitFor(() => expect(b.control.isWaiting()).toBe(true));
    expect(b.recorder.getStatus().state).toBe('idle');
    holder?.();
    await b.control.idle();
    expect(b.control.isWaiting()).toBe(false);
    expect(b.recorder.getStatus().state).toBe('recording');
    expect(seen).toEqual([true, false]);
  });
});
