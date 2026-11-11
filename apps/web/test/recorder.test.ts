// Recorder (T1-06): gefälschter MediaRecorder, fake-indexeddb und ein Fake-Core über `fetch`
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@sg/shared';
import {
  AudioRecorder,
  IndexedDbRecorderStore,
  MemoryRecorderStore,
  pickRecorderFormat,
  publishAudioLevel,
  resumePendingUploads,
  startLevelMeter,
  subscribeAudioLevel,
  type MediaRecorderLike,
  type RecorderStore,
  type SessionEventSource,
} from '../src/lib/recorder/index.ts';
import { sha256Hex } from '../src/lib/recorder/hash.ts';
import { SyncClient } from '../src/lib/sync/index.ts';

class FakeMediaRecorder implements MediaRecorderLike {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (m: string) => m.startsWith('audio/webm');
  state = 'inactive';
  ondataavailable: ((ev: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  timeslice: number | undefined;
  readonly stream: MediaStream;
  readonly options: { mimeType?: string; audioBitsPerSecond?: number } | undefined;
  constructor(stream: MediaStream, options?: { mimeType?: string; audioBitsPerSecond?: number }) {
    this.stream = stream;
    this.options = options;
    FakeMediaRecorder.instances.push(this);
  }
  start(timeslice?: number) {
    this.state = 'recording';
    this.timeslice = timeslice;
  }
  emit(bytes: number[]) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
  stop() {
    this.state = 'inactive';
    this.emit([9, 9]); // letzter Rest
    this.onstop?.();
  }
  requestData() {
    this.emit([5]);
  }
  /** Der Browser beendet den Recorder von sich aus */
  die() {
    this.state = 'inactive';
    this.onstop?.();
  }
}

interface FakeTrack {
  readyState: string;
  stop: () => void;
  onended: (() => void) | null;
}
function fakeStream(): MediaStream & { track: FakeTrack } {
  const track: FakeTrack = { readyState: 'live', stop: vi.fn(), onended: null };
  return { track, getTracks: () => [track] } as unknown as MediaStream & { track: FakeTrack };
}

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Fake-Core: zeichnet Aufrufe auf. `respond` darf einzelne Antworten ersetzen. */
function fakeCore(respond?: (call: Call) => Response | 'throw' | undefined) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace('http://core/api/v1', '');
    const call: Call = {
      method: init?.method ?? 'GET',
      path,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    };
    calls.push(call);
    const custom = respond?.(call);
    if (custom === 'throw') throw new TypeError('Failed to fetch');
    if (custom) return custom;
    if (call.method === 'PUT') return Response.json({ duplicate: false }, { status: 201 });
    if (path.endsWith('/recordings')) return Response.json({}, { status: 201 });
    return Response.json({}, { status: 200 });
  }) as typeof fetch;
  return { calls, fetchFn };
}

const apiError = (status: number, code: string) =>
  Response.json({ error: { code, message: code } }, { status });

interface Harness {
  recorder: AudioRecorder;
  store: RecorderStore;
  calls: Call[];
  sleeps: number[];
  mr: () => FakeMediaRecorder;
  clock: { t: number; wall: number };
  tick: () => void;
  streams: (MediaStream & { track: FakeTrack })[];
  media: { fail: boolean; constraints: unknown[] };
  visibility: { state: string; fire: () => void };
}

function setup(
  opts: { respond?: (c: Call) => Response | 'throw' | undefined; events?: SessionEventSource } = {},
): Harness {
  FakeMediaRecorder.instances = [];
  const { calls, fetchFn } = fakeCore(opts.respond);
  const store = new MemoryRecorderStore();
  const sleeps: number[] = [];
  const clock = { t: 0, wall: 1_000_000 };
  let tickFn: () => void = () => undefined;
  const streams: (MediaStream & { track: FakeTrack })[] = [];
  const media = { fail: false, constraints: [] as unknown[] };
  const handlers = new Set<() => void>();
  const visibility = { state: 'visible', fire: () => handlers.forEach((fn) => fn()) };
  const recorder = new AudioRecorder({
    sessionId: '01a1a874-0759-7058-a15c-e5d0adae8e74',
    sessionMs: () => 5_000,
    ...(opts.events ? { events: opts.events } : {}),
    store,
    uploader: {
      baseUrl: 'http://core/api/v1',
      fetch: fetchFn,
      sleep: async (ms) => {
        sleeps.push(ms);
        await new Promise((r) => setTimeout(r, 0)); // Macrotask, sonst verhungern Timer
      },
      random: () => 0.5,
    },
    getUserMedia: async (c) => {
      media.constraints.push(c);
      if (media.fail) throw new Error('kein Mikrofon');
      const stream = fakeStream();
      streams.push(stream);
      return stream;
    },
    MediaRecorder: FakeMediaRecorder,
    level: { createContext: () => null },
    navigator: {},
    document: {
      get visibilityState() {
        return visibility.state;
      },
      addEventListener: (_t: string, fn: () => void) => handlers.add(fn),
      removeEventListener: (_t: string, fn: () => void) => handlers.delete(fn),
    },
    clock: () => clock.t,
    wallClock: () => clock.wall,
    setInterval: (fn) => {
      tickFn = fn;
      return 1;
    },
    clearInterval: () => undefined,
  });
  return {
    recorder,
    store,
    calls,
    sleeps,
    clock,
    mr: () => FakeMediaRecorder.instances.at(-1)!,
    tick: () => tickFn(),
    streams,
    media,
    visibility,
  };
}

const settle = async (h: Harness) => {
  // Chunk-Verarbeitung und Upload-Schleife abwarten
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  await (h.recorder as unknown as { uploader: { drain(): Promise<void> } }).uploader.drain();
};

describe('Codec-Wahl', () => {
  it('Chrome: Opus/WebM, Safari: AAC/MP4, sonst null', () => {
    expect(pickRecorderFormat((m) => m.startsWith('audio/webm'))).toEqual({
      mime: 'audio/webm;codecs=opus',
      codec: 'opus',
    });
    expect(pickRecorderFormat((m) => m.startsWith('audio/mp4'))).toEqual({
      mime: 'audio/mp4;codecs=mp4a.40.2',
      codec: 'aac',
    });
    expect(pickRecorderFormat((m) => m === 'audio/mp4')).toEqual({ mime: 'audio/mp4', codec: 'aac' });
    expect(pickRecorderFormat((m) => m.startsWith('audio/ogg'))).toBeNull();
    expect(pickRecorderFormat(undefined)).toBeNull();
  });
});

describe('IndexedDbRecorderStore', () => {
  it('puffert Chunks über ein neues Store-Objekt hinweg (Neuladen), patcht atomar', async () => {
    const factory = new IDBFactory();
    const a = new IndexedDbRecorderStore('t', factory);
    const meta = {
      id: 'r1',
      sessionId: 's',
      mime: 'audio/webm',
      codec: 'opus' as const,
      startedMs: 0,
      chunksIndependent: false,
      created: false,
      nextSeq: 0,
      recordedMs: 0,
      lastActivityAt: 1,
      complete: null,
    };
    await a.putRecording(meta);
    const chunk = (seq: number) => ({
      recordingId: 'r1',
      seq,
      startMs: seq * 10,
      durationMs: 10,
      sha256: 'x',
      data: new Uint8Array([seq]).buffer,
      attempts: 0,
    });
    await a.addChunk(chunk(1), { nextSeq: 2 });
    await a.addChunk(chunk(0), { nextSeq: 2 });
    await a.patchRecording('r1', { created: true });
    await a.close();

    const b = new IndexedDbRecorderStore('t', factory);
    expect((await b.listChunks('r1')).map((c) => c.seq)).toEqual([0, 1]);
    expect(await b.getRecording('r1')).toMatchObject({ created: true, nextSeq: 2 });
    await b.shelveChunk({ ...chunk(0), status: 409, code: 'chunk_conflict', message: 'm', shelvedAt: 1 });
    expect((await b.listChunks('r1')).map((c) => c.seq)).toEqual([1]);
    expect(await b.listShelf()).toHaveLength(1);
    await b.deleteRecording('r1');
    expect(await b.listChunks('r1')).toEqual([]);
    expect(await b.patchRecording('r1', { created: false })).toBeNull();
    await b.close();
  });
});

describe('AudioRecorder', () => {
  it('startet mit timeslice 10 s, 48 kbit/s mono, legt die Aufnahme an und lädt Chunks der Reihe nach hoch', async () => {
    const h = setup();
    await h.recorder.start();
    expect(h.mr().timeslice).toBe(10_000);
    expect(h.mr().options?.audioBitsPerSecond).toBe(48_000);
    expect(h.media.constraints[0]).toEqual({ audio: { channelCount: 1 } });
    expect(h.mr().options?.mimeType).toBe('audio/webm;codecs=opus');
    const create = h.calls[0]!;
    expect(create).toMatchObject({ method: 'POST' });
    expect(JSON.parse(create.body as string)).toMatchObject({
      mime: 'audio/webm;codecs=opus',
      codec: 'opus',
      started_ms: 5000,
      chunks_independent: false,
    });

    h.clock.t = 30_000;
    h.mr().emit([1, 2, 3]);
    h.clock.t = 60_500;
    h.mr().emit([4, 5]);
    await settle(h);

    const puts = h.calls.filter((c) => c.method === 'PUT');
    expect(puts.map((c) => c.path.split('/chunks/')[1])).toEqual(['0', '1']);
    expect(puts[0]!.headers).toMatchObject({
      'Content-Type': 'audio/webm',
      'X-Start-Ms': '5000',
      'X-Duration-Ms': '30000',
      'X-Sha256': await sha256Hex(new Uint8Array([1, 2, 3]).buffer),
    });
    expect(puts[1]!.headers).toMatchObject({ 'X-Start-Ms': '35000', 'X-Duration-Ms': '30500' });
    expect(h.recorder.getStatus()).toMatchObject({ state: 'recording', chunkCount: 2 });
    expect(await h.store.listChunks(h.recorder.getStatus().recordingId!)).toEqual([]);
    await h.recorder.stop();
  });

  it('stop: letzter Chunk, dann complete mit last_seq und Dauer; Puffer wird geleert', async () => {
    const h = setup();
    await h.recorder.start();
    h.clock.t = 30_000;
    h.mr().emit([1]);
    h.clock.t = 40_000;
    await h.recorder.stop();
    await settle(h);
    const complete = h.calls.find((c) => c.path.endsWith('/complete'))!;
    expect(JSON.parse(complete.body as string)).toEqual({ last_seq: 1, duration_ms: 40_000 });
    expect(h.recorder.getStatus().state).toBe('stopped');
    expect(await h.store.listRecordings()).toEqual([]);
  });

  it('session.updated (beendet) schließt die Aufnahme ab; andere Sessions und Zustände nicht', async () => {
    let handler: ((s: Session) => void) | undefined;
    const off = vi.fn();
    const events: SessionEventSource = {
      onEvent: (_name, fn) => {
        handler = fn;
        return off;
      },
    };
    const h = setup({ events });
    await h.recorder.start();
    const base = { id: '01a1a874-0759-7058-a15c-e5d0adae8e74', state: 'laeuft' } as Session;
    handler!({ ...base, id: 'other', state: 'beendet' });
    handler!({ ...base, id: 'other', state: 'pausiert' });
    expect(h.recorder.getStatus().state).toBe('recording');
    handler!({ ...base, state: 'beendet' });
    await settle(h);
    expect(h.recorder.getStatus().state).toBe('stopped');
    expect(h.calls.some((c) => c.path.endsWith('/complete'))).toBe(true);
    expect(off).toHaveBeenCalled();
  });

  it('lässt sich an den echten SyncClient hängen (Typprüfung)', () => {
    const client: SessionEventSource = new SyncClient({
      webSocketFactory: () => {
        throw new Error('nicht verbinden');
      },
    });
    expect(typeof client.onEvent).toBe('function');
  });

  it('Netzfehler und 5xx: Wiederholung mit Backoff 1 s, 2 s, 4 s; Chunk bleibt bis zum Erfolg im Puffer', async () => {
    let puts = 0;
    const h = setup({
      respond: (c) => {
        if (c.method !== 'PUT') return undefined;
        puts += 1;
        if (puts === 1) return 'throw';
        if (puts === 2) return apiError(503, 'unavailable');
        if (puts === 3) return apiError(500, 'boom');
        return undefined;
      },
    });
    await h.recorder.start();
    h.clock.t = 30_000;
    h.mr().emit([7]);
    await settle(h);
    expect(h.sleeps).toEqual([1000, 2000, 4000]);
    expect(puts).toBe(4);
    expect(await h.store.listChunks(h.recorder.getStatus().recordingId!)).toEqual([]);
    expect(h.recorder.getStatus().upload.offline).toBe(false);
    await h.recorder.stop();
  });

  it('Backoff ist auf 30 s begrenzt', async () => {
    let puts = 0;
    const h = setup({
      respond: (c) => (c.method === 'PUT' && ++puts <= 8 ? 'throw' : undefined),
    });
    await h.recorder.start();
    h.clock.t = 30_000;
    h.mr().emit([7]);
    await settle(h);
    expect(h.sleeps).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    await h.recorder.stop();
  });

  it('409 und 422: nie wiederholen, Chunk samt Daten in die Fehlerablage', async () => {
    const h = setup({
      respond: (c) => {
        if (c.path.endsWith('/chunks/0')) return apiError(409, 'chunk_conflict');
        if (c.path.endsWith('/chunks/1')) return apiError(422, 'checksum_mismatch');
        return undefined;
      },
    });
    await h.recorder.start();
    h.clock.t = 30_000;
    h.mr().emit([1]);
    h.clock.t = 60_000;
    h.mr().emit([2]);
    h.clock.t = 90_000;
    h.mr().emit([3]);
    await settle(h);
    expect(h.calls.filter((c) => c.method === 'PUT')).toHaveLength(3);
    expect(h.sleeps).toEqual([]);
    const shelf = await h.store.listShelf();
    expect(shelf.map((s) => [s.seq, s.status, s.code])).toEqual([
      [0, 409, 'chunk_conflict'],
      [1, 422, 'checksum_mismatch'],
    ]);
    expect(new Uint8Array(shelf[0]!.data)).toEqual(new Uint8Array([1]));
    expect(h.recorder.getStatus().upload.shelvedChunks).toBe(2);
    await h.recorder.stop();
  });

  describe('Fehlerablage: nur die eigene Session zählt', () => {
    const OLD = {
      recordingId: 'alt',
      seq: 0,
      startMs: 0,
      durationMs: 10_000,
      sha256: 'x',
      data: new Uint8Array([9]).buffer,
      status: 409,
      code: 'chunk_conflict',
      message: 'm',
      shelvedAt: 1,
    };

    it('Teil einer früheren Session (und Altbestand ohne sessionId) löst bei neuer Session nichts aus', async () => {
      const h = setup();
      await h.store.shelveChunk({ ...OLD, sessionId: '01b2b985-1860-7058-a15c-e5d0adae8e75' });
      await h.store.shelveChunk({ ...OLD, recordingId: 'alt2' });
      await h.recorder.start();
      h.clock.t = 30_000;
      h.mr().emit([1]);
      await settle(h);
      expect(await h.store.listShelf()).toHaveLength(2);
      expect(h.recorder.getStatus().upload.shelvedChunks).toBe(0);
      await h.recorder.stop();
    });

    it('abgelehnter Teil der aktuellen Session zählt trotz Altbestand', async () => {
      const h = setup({
        respond: (c) => (c.path.endsWith('/chunks/0') ? apiError(409, 'chunk_conflict') : undefined),
      });
      await h.store.shelveChunk({ ...OLD, sessionId: '01b2b985-1860-7058-a15c-e5d0adae8e75' });
      await h.recorder.start();
      h.clock.t = 30_000;
      h.mr().emit([1]);
      await settle(h);
      expect(await h.store.listShelf()).toHaveLength(2);
      expect(h.recorder.getStatus().upload.shelvedChunks).toBe(1);
      await h.recorder.stop();
    });
  });

  it('Core beim Start nicht erreichbar: Aufnahme läuft, Anlegen und Chunks folgen später', async () => {
    let down = true;
    const h = setup({ respond: () => (down ? 'throw' : undefined) });
    await h.recorder.start();
    expect(h.recorder.getStatus().state).toBe('recording');
    h.clock.t = 30_000;
    h.mr().emit([1]);
    await new Promise((r) => setTimeout(r, 10));
    down = false;
    (h.recorder as unknown as { uploader: { retryNow(): void } }).uploader.retryNow();
    await settle(h);
    const order = h.calls
      .filter((c) => !c.path.endsWith('/complete'))
      .map((c) => `${c.method} ${c.path.split('/').slice(-2).join('/')}`);
    expect(order.at(-2)).toMatch(/^POST sessions|^POST .*recordings/);
    expect(h.calls.filter((c) => c.method === 'PUT').at(-1)!.path).toMatch(/chunks\/0$/);
    await h.recorder.stop();
  });

  it('Core lehnt die Aufnahme beim Start ab (Session läuft nicht): Fehler, kein Mikrofon offen', async () => {
    const h = setup({
      respond: (c) => (c.method === 'POST' ? apiError(409, 'session_not_active') : undefined),
    });
    await expect(h.recorder.start()).rejects.toThrow();
    expect(h.recorder.getStatus().state).toBe('error');
    expect(await h.store.listRecordings()).toEqual([]);
  });

  it('ohne unterstützten Typ: unsupported', async () => {
    const h = setup();
    FakeMediaRecorder.isTypeSupported = () => false;
    await expect(h.recorder.start()).rejects.toThrow();
    expect(h.recorder.getStatus().state).toBe('unsupported');
    FakeMediaRecorder.isTypeSupported = (m) => m.startsWith('audio/webm');
  });

  it('Ruhezustand (Wanduhr springt): neue Aufnahme mit eigener ID, alte wird abgeschlossen', async () => {
    const h = setup();
    await h.recorder.start();
    const first = h.recorder.getStatus().recordingId!;
    h.clock.t = 30_000;
    h.mr().emit([1]);
    h.clock.wall += 60_000 + 3_600_000; // 1 h Schlaf, monotone Uhr stand still
    h.clock.t += 1000;
    h.tick();
    await settle(h);
    await vi.waitFor(() => expect(h.recorder.getStatus().restarts).toBe(1));
    const second = h.recorder.getStatus().recordingId!;
    expect(second).not.toBe(first);
    expect(FakeMediaRecorder.instances).toHaveLength(2);
    expect(h.calls.some((c) => c.path === `/recordings/${first}/complete`)).toBe(true);
    expect(h.recorder.getStatus().state).toBe('recording');
    await h.recorder.stop();
  });

  it('Neuladen: gepufferte Chunks werden hochgeladen, eine verwaiste Aufnahme wird abgeschlossen', async () => {
    const store = new MemoryRecorderStore();
    await store.putRecording({
      id: 'rec-old',
      sessionId: 's',
      mime: 'audio/webm;codecs=opus',
      codec: 'opus',
      startedMs: 0,
      chunksIndependent: false,
      created: true,
      nextSeq: 2,
      recordedMs: 61_000,
      lastActivityAt: 1_000,
      complete: null,
    });
    for (const seq of [0, 1]) {
      await store.addChunk(
        {
          recordingId: 'rec-old',
          seq,
          startMs: seq * 30_000,
          durationMs: 30_000,
          sha256: 'a'.repeat(64),
          data: new Uint8Array([seq]).buffer,
          attempts: 0,
        },
        {},
      );
    }
    const { calls, fetchFn } = fakeCore();
    const uploader = resumePendingUploads({
      store,
      baseUrl: 'http://core/api/v1',
      fetch: fetchFn,
      now: () => 10_000_000,
    });
    await uploader.drain();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'PUT /recordings/rec-old/chunks/0',
      'PUT /recordings/rec-old/chunks/1',
      'POST /recordings/rec-old/complete',
    ]);
    expect(JSON.parse(calls[2]!.body as string)).toEqual({ last_seq: 1, duration_ms: 61_000 });
    expect(await store.listRecordings()).toEqual([]);
  });

  it('frische Aufnahme eines anderen Tabs wird nicht als verwaist abgeschlossen', async () => {
    const store = new MemoryRecorderStore();
    await store.putRecording({
      id: 'rec-live',
      sessionId: 's',
      mime: 'audio/webm',
      codec: 'opus',
      startedMs: 0,
      chunksIndependent: false,
      created: true,
      nextSeq: 0,
      recordedMs: 0,
      lastActivityAt: 9_999_000,
      complete: null,
    });
    const { calls, fetchFn } = fakeCore();
    await resumePendingUploads({
      store,
      baseUrl: 'http://core/api/v1',
      fetch: fetchFn,
      now: () => 10_000_000,
    }).drain();
    expect(calls).toEqual([]);
    expect(await store.listRecordings()).toHaveLength(1);
  });

  it('complete mit recording_seq_conflict übernimmt last_seq des Core', async () => {
    const store = new MemoryRecorderStore();
    await store.putRecording({
      id: 'r',
      sessionId: 's',
      mime: 'audio/webm',
      codec: 'opus',
      startedMs: 0,
      chunksIndependent: false,
      created: true,
      nextSeq: 1,
      recordedMs: 10,
      lastActivityAt: 1,
      complete: { lastSeq: 0, durationMs: 10 },
    });
    let first = true;
    const { calls, fetchFn } = fakeCore((c) => {
      if (c.path.endsWith('/complete') && first) {
        first = false;
        return apiError(409, 'recording_seq_conflict');
      }
      if (c.method === 'GET') return Response.json({ last_seq: 3 });
      return undefined;
    });
    await resumePendingUploads({ store, baseUrl: 'http://core/api/v1', fetch: fetchFn }).drain();
    const completes = calls
      .filter((c) => c.path.endsWith('/complete'))
      .map((c) => JSON.parse(c.body as string));
    expect(completes).toEqual([
      { last_seq: 0, duration_ms: 10 },
      { last_seq: 3, duration_ms: 10 },
    ]);
  });
});

describe('AudioRecorder: Mikrofon, Pause, Verlust', () => {
  const SID = '01a1a874-0759-7058-a15c-e5d0adae8e74';
  const sessionEvents = () => {
    let handler: ((s: Session) => void) | undefined;
    const events: SessionEventSource = {
      onEvent: (_n, fn) => {
        handler = fn;
        return () => undefined;
      },
    };
    return { events, send: (state: string) => handler!({ id: SID, state } as Session) };
  };

  it('B1: Mikrofon-Spur endet, neues Mikrofon: neue Aufnahme, restarts = 1', async () => {
    const h = setup();
    await h.recorder.start();
    const first = h.recorder.getStatus().recordingId;
    h.streams[0]!.track.readyState = 'ended';
    h.streams[0]!.track.onended?.();
    await vi.waitFor(() => expect(h.recorder.getStatus().restarts).toBe(1));
    expect(h.recorder.getStatus().state).toBe('recording');
    expect(h.recorder.getStatus().recordingId).not.toBe(first);
    expect(h.streams).toHaveLength(2);
    await h.recorder.stop();
  });

  it('B1: Spur endet und kein Mikrofon mehr: sichtbarer Fehlerzustand', async () => {
    const h = setup();
    await h.recorder.start();
    h.media.fail = true;
    h.streams[0]!.track.readyState = 'ended';
    h.streams[0]!.track.onended?.();
    await vi.waitFor(() => expect(h.recorder.getStatus().state).toBe('error'));
    expect(h.recorder.getStatus().error).toMatch(/Mikrofon/);
  });

  it('B1: unerwarteter Stopp des MediaRecorders löst einen Neustart aus', async () => {
    const h = setup();
    await h.recorder.start();
    h.clock.t = 10_000;
    h.mr().emit([1]);
    h.mr().die();
    await vi.waitFor(() => expect(h.recorder.getStatus().restarts).toBe(1));
    expect(FakeMediaRecorder.instances).toHaveLength(2);
    expect(h.mr().state).toBe('recording');
    await h.recorder.stop();
  });

  it('B3: Pause schließt die Aufnahme ab, Fortsetzen beginnt eine neue mit aktueller Sitzungszeit', async () => {
    const { events, send } = sessionEvents();
    const h = setup({ events });
    await h.recorder.start();
    const first = h.recorder.getStatus().recordingId!;
    h.clock.t = 10_000;
    h.mr().emit([1]);
    send('pausiert');
    await vi.waitFor(() => expect(h.recorder.getStatus().state).toBe('paused'));
    await settle(h);
    expect(h.streams[0]!.track.readyState).toBe('live'); // Mikrofon bleibt offen
    expect(h.calls.some((c) => c.path === `/recordings/${first}/complete`)).toBe(true);
    send('laeuft');
    await vi.waitFor(() => expect(h.recorder.getStatus().state).toBe('recording'));
    expect(h.recorder.getStatus().recordingId).not.toBe(first);
    expect(FakeMediaRecorder.instances).toHaveLength(2);
    expect(h.streams).toHaveLength(1);
    await settle(h);
    const creates = h.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/recordings'));
    expect(creates.length).toBeGreaterThanOrEqual(1);
    await h.recorder.stop();
  });

  it('Aufnahme ohne Chunk wird nicht per complete abgeschlossen', async () => {
    const h = setup();
    await h.recorder.start();
    h.mr().stop = function () {
      this.state = 'inactive';
      this.onstop?.();
    };
    await h.recorder.stop();
    await settle(h);
    expect(h.calls.some((c) => c.path.endsWith('/complete'))).toBe(false);
    expect(await h.store.listRecordings()).toEqual([]);
  });

  it('chunkCount nach stop() zählt den letzten Chunk mit', async () => {
    const h = setup();
    await h.recorder.start();
    h.clock.t = 10_000;
    h.mr().emit([1]);
    await h.recorder.stop();
    expect(h.recorder.getStatus().chunkCount).toBe(2);
  });

  it('Tab im Hintergrund: requestData holt den laufenden Chunk heraus', async () => {
    const h = setup();
    await h.recorder.start();
    h.visibility.state = 'hidden';
    h.visibility.fire();
    await settle(h);
    expect(h.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    await h.recorder.stop();
  });

  it('Aufnahme aus IndexedDB gelöscht: neue Chunks kommen in die Fehlerablage statt verloren zu gehen', async () => {
    const h = setup();
    await h.recorder.start();
    await h.store.deleteRecording(h.recorder.getStatus().recordingId!);
    h.clock.t = 10_000;
    h.mr().emit([1, 2]);
    await settle(h);
    const shelf = await h.store.listShelf();
    expect(shelf.length).toBeGreaterThanOrEqual(1);
    expect(shelf[0]).toMatchObject({ code: 'recording_missing', seq: 0 });
    expect(h.recorder.getStatus().error).toMatch(/Zwischenspeicher/);
    await h.recorder.stop();
  });

  it('B2: abgelehnte Aufnahme (session_not_active beim Nachreichen) behält die Metadaten, Chunks liegen in der Ablage', async () => {
    const store = new MemoryRecorderStore();
    await store.putRecording({
      id: 'rec-late',
      sessionId: 's',
      mime: 'audio/webm;codecs=opus',
      codec: 'opus',
      startedMs: 1234,
      chunksIndependent: false,
      created: false,
      nextSeq: 1,
      recordedMs: 10,
      lastActivityAt: 1,
      complete: { lastSeq: 0, durationMs: 10 },
    });
    await store.addChunk(
      {
        recordingId: 'rec-late',
        seq: 0,
        startMs: 1234,
        durationMs: 10,
        sha256: 'a'.repeat(64),
        data: new Uint8Array([1]).buffer,
        attempts: 0,
      },
      {},
    );
    const { calls, fetchFn } = fakeCore((c) =>
      c.method === 'POST' ? apiError(409, 'session_not_active') : undefined,
    );
    const uploader = resumePendingUploads({ store, baseUrl: 'http://core/api/v1', fetch: fetchFn });
    await uploader.drain();
    const meta = await store.getRecording('rec-late');
    expect(meta).toMatchObject({
      mime: 'audio/webm;codecs=opus',
      codec: 'opus',
      startedMs: 1234,
      rejected: 'recording_rejected',
    });
    expect((await store.listShelf()).map((e) => e.seq)).toEqual([0]);
    expect(await store.listChunks('rec-late')).toEqual([]);
    expect(calls).toHaveLength(1);
    // Ihr `complete` geht nie an den Core: zählt nicht als „wird gesichert“ (UX-08)
    expect(uploader.getStatus()).toMatchObject({ pendingChunks: 0, pendingCompletes: 0 });
    uploader.kick();
    await uploader.drain();
    expect(calls).toHaveLength(1);
  });

  it('UX-08: ein älterer Zählvorgang aus `kick()` überschreibt den neueren Stand nicht', async () => {
    class GatedStore extends MemoryRecorderStore {
      gate: Promise<void> | null = null;
      override async listShelf() {
        const gate = this.gate;
        this.gate = null;
        if (gate) await gate;
        return super.listShelf();
      }
    }
    const store = new GatedStore();
    await store.putRecording({
      id: 'rec-race',
      sessionId: 's',
      mime: 'audio/webm;codecs=opus',
      codec: 'opus',
      startedMs: 0,
      chunksIndependent: false,
      created: true,
      nextSeq: 1,
      recordedMs: 10,
      lastActivityAt: Date.now(),
      complete: null,
    });
    await store.addChunk(
      {
        recordingId: 'rec-race',
        seq: 0,
        startMs: 0,
        durationMs: 10,
        sha256: 'a'.repeat(64),
        data: new Uint8Array([1]).buffer,
        attempts: 0,
      },
      {},
    );
    let releasePut: () => void = () => undefined;
    const putGate = new Promise<void>((r) => (releasePut = r));
    let putStarted: () => void = () => undefined;
    const putSeen = new Promise<void>((r) => (putStarted = r));
    const { fetchFn } = fakeCore();
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putStarted();
        await putGate;
      }
      return fetchFn(input, init);
    }) as typeof globalThis.fetch;
    const uploader = resumePendingUploads({ store, baseUrl: 'http://core/api/v1', fetch });
    await putSeen;
    // Zählvorgang A: sieht den Chunk noch und hängt danach
    let releaseShelf: () => void = () => undefined;
    store.gate = new Promise<void>((r) => (releaseShelf = r));
    uploader.kick();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    // Der Durchgang lädt den Chunk hoch und zählt neu (B): nichts wartet mehr
    releasePut();
    await uploader.drain();
    expect(uploader.getStatus().pendingChunks).toBe(0);
    // A wird erst jetzt fertig und darf den Stand nicht auf 1 zurücksetzen
    releaseShelf();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(uploader.getStatus().pendingChunks).toBe(0);
    uploader.dispose();
  });

  it('Pegel: ein angehaltener AudioContext meldet nichts (statt 0)', () => {
    let tick: () => void = () => undefined;
    const ctx = {
      state: 'suspended',
      createMediaStreamSource: () => ({ connect: () => undefined, disconnect: () => undefined }),
      createAnalyser: () => ({ fftSize: 0, getFloatTimeDomainData: (a: Float32Array) => a.fill(0) }),
      resume: vi.fn(async () => undefined),
      close: async () => undefined,
    };
    const stop = startLevelMeter({} as MediaStream, {
      createContext: () => ctx,
      setInterval: (fn) => {
        tick = fn;
        return 1;
      },
      clearInterval: () => undefined,
    });
    const fn = vi.fn();
    const off = subscribeAudioLevel(fn);
    tick();
    expect(fn).not.toHaveBeenCalled();
    ctx.state = 'running';
    tick();
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ rms: 0 }));
    off();
    stop();
  });
});

describe('Pegel', () => {
  it('subscribeAudioLevel verteilt Messwerte und lässt sich abmelden', () => {
    const fn = vi.fn();
    const off = subscribeAudioLevel(fn);
    publishAudioLevel({ at: 1, rms: 0.5 });
    off();
    publishAudioLevel({ at: 2, rms: 0.1 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ at: 1, rms: 0.5 });
  });

  it('Messer liefert alle 250 ms den RMS-Wert', () => {
    let tick: () => void = () => undefined;
    let interval = 0;
    const closed = vi.fn(async () => undefined);
    const stop = startLevelMeter({} as MediaStream, {
      createContext: () => ({
        createMediaStreamSource: () => ({ connect: () => undefined, disconnect: () => undefined }),
        createAnalyser: () => ({
          fftSize: 0,
          getFloatTimeDomainData: (a: Float32Array) => a.fill(0.5),
        }),
        close: closed,
      }),
      setInterval: (fn, ms) => {
        tick = fn;
        interval = ms;
        return 1;
      },
      clearInterval: () => undefined,
      now: () => 42,
    });
    const fn = vi.fn();
    const off = subscribeAudioLevel(fn);
    tick();
    off();
    stop();
    expect(interval).toBe(250);
    expect(fn).toHaveBeenCalledWith({ at: 42, rms: 0.5 });
    expect(closed).toHaveBeenCalled();
  });
});
