// Upload-Durchgänge im Tab serialisieren (Issue #262): ein Durchgang je Ablage, kein doppelter Upload, nichts verwaist
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  AudioRecorder,
  ChunkUploader,
  IndexedDbRecorderStore,
  MemoryRecorderStore,
  type RecorderStore,
} from '../src/lib/recorder/index.ts';

const REC = '0190f6a2-0000-7000-8000-0000000000a1';
const SESSION = '0190f6a2-0000-7000-8000-0000000000e1';

async function seed(store: RecorderStore, chunks = 3, complete = true) {
  await store.putRecording({
    id: REC,
    sessionId: SESSION,
    mime: 'audio/webm;codecs=opus',
    codec: 'opus',
    startedMs: 0,
    chunksIndependent: false,
    created: true,
    nextSeq: chunks,
    recordedMs: chunks * 1000,
    lastActivityAt: Date.now(),
    complete: complete ? { lastSeq: chunks - 1, durationMs: chunks * 1000 } : null,
  });
  for (let seq = 0; seq < chunks; seq++) {
    await store.putChunk({
      recordingId: REC,
      seq,
      startMs: seq * 1000,
      durationMs: 1000,
      sha256: 'a'.repeat(64),
      data: new ArrayBuffer(4),
      attempts: 0,
    });
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function core(delayMs = 5) {
  const calls: string[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname.replace('/api/v1', '')}`);
    await new Promise((r) => setTimeout(r, delayMs));
    return Response.json({}, { status: 201 });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

function uploader(store: RecorderStore, fetchFn: typeof fetch) {
  return new ChunkUploader({
    store,
    baseUrl: 'http://core/api/v1',
    fetch: fetchFn,
    sleep: () => tick(),
    random: () => 0.5,
  });
}

describe('Upload-Durchgänge serialisieren (#262)', () => {
  it('Wechsel A→B: Flush von A und Uploader von B schicken jeden Chunk und complete genau einmal', async () => {
    const store = new MemoryRecorderStore();
    await seed(store);
    const { calls, fetchFn } = core();
    const a = uploader(store, fetchFn);
    const b = uploader(store, fetchFn);
    a.kick();
    b.kick();
    await Promise.all([a.drain(), b.drain()]);
    expect(calls.filter((c) => c.startsWith('PUT')).sort()).toEqual([
      `PUT /recordings/${REC}/chunks/0`,
      `PUT /recordings/${REC}/chunks/1`,
      `PUT /recordings/${REC}/chunks/2`,
    ]);
    expect(calls.filter((c) => c.endsWith('/complete'))).toEqual([`POST /recordings/${REC}/complete`]);
    expect(await store.listChunks(REC)).toEqual([]);
    expect(await store.getRecording(REC)).toBeNull();
  });

  it('gilt auch für zwei Store-Objekte auf derselben IndexedDB', async () => {
    const factory = new IDBFactory();
    const s1 = new IndexedDbRecorderStore('sg-lock', factory);
    const s2 = new IndexedDbRecorderStore('sg-lock', factory);
    await seed(s1);
    const { calls, fetchFn } = core();
    const a = uploader(s1, fetchFn);
    const b = uploader(s2, fetchFn);
    a.kick();
    b.kick();
    await Promise.all([a.drain(), b.drain()]);
    expect(calls.filter((c) => c.startsWith('PUT'))).toHaveLength(3);
    expect(calls.filter((c) => c.endsWith('/complete'))).toHaveLength(1);
  });

  it('Durchgänge laufen nie gleichzeitig', async () => {
    const store = new MemoryRecorderStore();
    await seed(store, 4);
    let inFlight = 0;
    let max = 0;
    const fetchFn = (async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return Response.json({}, { status: 201 });
    }) as unknown as typeof fetch;
    const a = uploader(store, fetchFn);
    const b = uploader(store, fetchFn);
    a.kick();
    b.kick();
    await Promise.all([a.drain(), b.drain()]);
    expect(max).toBe(1);
  });

  it('Netzfehler, nachdem die Aufnahme anderweitig abgeschlossen und gelöscht wurde: kein verwaister Chunk', async () => {
    const store = new MemoryRecorderStore();
    await seed(store, 1);
    const failing = (async () => {
      await store.deleteRecording(REC);
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    const a = new ChunkUploader({
      store,
      baseUrl: 'http://core/api/v1',
      fetch: failing,
      sleep: () => new Promise(() => undefined),
    });
    a.kick();
    for (let i = 0; i < 20; i++) await tick();
    expect(await store.listChunks(REC)).toEqual([]);
    expect(await store.listRecordings()).toEqual([]);
    a.dispose();
  });

  it('Netzfehler ohne gelöschte Aufnahme: der Chunk bleibt mit höherem attempts erhalten', async () => {
    const store = new MemoryRecorderStore();
    await seed(store, 1, false);
    const fetchFn = (async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    const a = new ChunkUploader({
      store,
      baseUrl: 'http://core/api/v1',
      fetch: fetchFn,
      sleep: () => new Promise(() => undefined),
    });
    a.kick();
    for (let i = 0; i < 20; i++) await tick();
    expect((await store.listChunks(REC)).map((c) => c.attempts)).toEqual([1]);
    a.dispose();
  });

  it('flushUploads hält die Frist ein, auch hinter einem hängenden Durchgang eines anderen Uploaders', async () => {
    const store = new MemoryRecorderStore();
    await seed(store, 1, false);
    // Der app-weite Uploader hängt an einer Anfrage und hält die Sperre
    const hang = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const blocker = uploader(store, hang);
    blocker.kick();
    await tick();
    const recorder = new AudioRecorder({
      sessionId: SESSION,
      sessionMs: () => 0,
      store,
      pageEvents: { addEventListener: () => undefined, removeEventListener: () => undefined },
      uploader: { baseUrl: 'http://core/api/v1', fetch: core().fetchFn },
    });
    const t0 = Date.now();
    await recorder.flushUploads(80);
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(70);
    expect(took).toBeLessThan(1000);
    recorder.dispose();
    blocker.dispose();
  });
});
