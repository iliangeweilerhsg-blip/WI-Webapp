// Issue #129: Download-Pool, Leerlauf-Zeitlimit, kein Wiederholen bei Stillstand, Abbruch per AbortSignal.
// Kein echtes Moodle: Die Antworten kommen aus selbst gesteuerten Streams. Gleichzeitigkeit und Reihenfolge
// werden über Zähler und Gates belegt, nicht über gemessene Zeit.
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../src/errors.ts';
import { abortWhenClosed } from '../../src/moodle/abort.ts';
import { MoodleClient, RequestAbortedError } from '../../src/moodle/client.ts';
import { StaticTokenStore } from '../../src/moodle/token-store.ts';
import { FAKE_BASE, FAKE_TOKEN, fakeFetch, json, type FakeHandler } from './moodle-fake.ts';

const REF = '/12/mod_resource/content/1/a.pdf';
const PDF = { 'content-type': 'application/pdf' };
const encoder = new TextEncoder();

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Wie der echte fetch: Ein Abbruch des Signals beendet das Lesen des Bodys mit dessen Grund */
function abortable(
  signal: AbortSignal | null | undefined,
  controller: ReadableStreamDefaultController,
): void {
  const onAbort = () => controller.error(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
}

/** Antwort, die nach den Headern nie ein Byte liefert (nur ein Abbruch beendet sie) */
function silentBody(init: RequestInit, headers: Record<string, string> = PDF): Response {
  return new Response(new ReadableStream({ start: (controller) => abortable(init.signal, controller) }), {
    status: 200,
    headers,
  });
}

function makeClient(
  handler: FakeHandler,
  extra: ConstructorParameters<typeof MoodleClient>[0] | object = {},
) {
  const fake = fakeFetch(handler);
  const client = new MoodleClient({
    baseUrl: FAKE_BASE,
    tokens: new StaticTokenStore(FAKE_TOKEN),
    fetch: fake.fetch,
    sleep: async () => {},
    minIntervalMs: 0,
    ...extra,
  });
  return { client, requests: fake.requests };
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('kein Fehler geworfen');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Download-Pool (Issue #129, H4)', () => {
  it('zwei hängende Downloads belegen nur den Download-Pool: REST-Aufrufe laufen weiter', async () => {
    const hangs = new AbortController();
    const { client, requests } = makeClient((request) =>
      request.url.includes('pluginfile') ? silentBody(request.init) : json({ sitename: 'X' }),
    );
    // Beide Downloads warten auf das erste Byte und halten ihren Platz
    const hanging = [REF, REF].map((ref) => client.downloadFile(ref, { signal: hangs.signal }));
    // Ein dritter wartet auf einen Download-Platz und darf Moodle noch nicht erreichen
    const third = client.downloadFile(REF, { signal: hangs.signal });
    const outcomes = Promise.allSettled([...hanging, third]);
    await settle();
    expect(requests.filter((r) => r.url.includes('pluginfile'))).toHaveLength(2);

    // REST geht trotzdem sofort durch (kein Zeitlimit abwarten)
    await expect(client.read('core_webservice_get_site_info')).resolves.toEqual({ sitename: 'X' });
    await expect(client.read('core_webservice_get_site_info')).resolves.toEqual({ sitename: 'X' });
    expect(requests.filter((r) => r.url.includes('pluginfile'))).toHaveLength(2);

    hangs.abort();
    const settled = await outcomes;
    expect(settled.every((entry) => entry.status === 'rejected')).toBe(true);
    // Der dritte hat Moodle nie erreicht
    expect(requests.filter((r) => r.url.includes('pluginfile'))).toHaveLength(2);
  });

  it('REST-Aufrufe halten den Download-Pool nicht auf', async () => {
    const gates: (() => void)[] = [];
    const { client, requests } = makeClient((request) => {
      if (request.url.includes('pluginfile')) {
        return new Response('%PDF', { status: 200, headers: PDF });
      }
      return new Promise<Response>((resolve) => gates.push(() => resolve(json({}))));
    });
    // Beide REST-Plätze sind belegt
    const rest = [client.read('a_b'), client.read('a_b')];
    await settle();
    expect(gates).toHaveLength(2);
    const file = await client.downloadFile(REF);
    file.stream.resume();
    expect(requests.filter((r) => r.url.includes('pluginfile'))).toHaveLength(1);
    for (const open of gates) open();
    await Promise.all(rest);
  });
});

describe('Leerlauf-Zeitlimit statt Gesamtlimit (Issue #129, H4)', () => {
  it('ein Download, der länger als das Zeitlimit dauert, aber nie stillsteht, läuft durch', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // Ein Stück alle 600 ms: insgesamt 2,4 s bei einem Leerlauf-Zeitlimit von 1 s
    let sent = 0;
    const { client } = makeClient(
      () =>
        new Response(
          new ReadableStream({
            async pull(controller) {
              await new Promise((resolve) => setTimeout(resolve, 600));
              sent += 1;
              controller.enqueue(encoder.encode(`%PDF-${sent}`));
              if (sent === 4) controller.close();
            },
          }),
          { status: 200, headers: PDF },
        ),
      { idleTimeoutMs: 1000 },
    );
    const download = client.downloadFile(REF);
    await vi.advanceTimersByTimeAsync(600);
    const file = await download;
    const chunks: string[] = [];
    const reading = (async () => {
      for await (const chunk of file.stream) chunks.push(Buffer.from(chunk as Uint8Array).toString());
    })();
    await vi.advanceTimersByTimeAsync(3 * 600);
    await reading;
    expect(chunks.join('')).toBe('%PDF-1%PDF-2%PDF-3%PDF-4');
  });

  it('Stillstand mitten in der Übertragung beendet den Stream mit 502 timeout und gibt den Platz frei', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let calls = 0;
    const { client } = makeClient(
      (request) => {
        calls += 1;
        if (calls > 1) return new Response('%PDF-ok', { status: 200, headers: PDF });
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('%PDF-1'));
              abortable(request.init.signal, controller);
            },
          }),
          { status: 200, headers: PDF },
        );
      },
      { idleTimeoutMs: 1000, maxConcurrentDownloads: 1 },
    );
    const file = await client.downloadFile(REF);
    const failure = failureOf(
      (async () => {
        for await (const chunk of file.stream) void chunk;
      })(),
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(file.stream.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const error = (await failure) as HttpError;
    expect([error.statusCode, error.code, error.details]).toEqual([
      502,
      'moodle_unreachable',
      { reason: 'timeout' },
    ]);
    // Der einzige Platz ist wieder frei
    const next = await client.downloadFile(REF);
    next.stream.resume();
    expect(calls).toBe(2);
  });
});

describe('Kein Wiederholen bei Stillstand (Issue #129, H-a)', () => {
  it('Stillstand vor dem ersten Byte: genau eine Anfrage, 502 timeout', async () => {
    const { client, requests } = makeClient((request) => silentBody(request.init), { idleTimeoutMs: 30 });
    const error = (await failureOf(client.downloadFile(REF))) as HttpError;
    expect([error.statusCode, error.code, error.details]).toEqual([
      502,
      'moodle_unreachable',
      { reason: 'timeout' },
    ]);
    expect(requests).toHaveLength(1);
  });

  it('keine Antwort-Header innerhalb des Zeitlimits: ebenfalls keine Wiederholung', async () => {
    const { client, requests } = makeClient(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.init.signal?.addEventListener('abort', () => reject(request.init.signal?.reason), {
            once: true,
          });
        }),
      { idleTimeoutMs: 30 },
    );
    const error = (await failureOf(client.downloadFile(REF))) as HttpError;
    expect(error.details).toEqual({ reason: 'timeout' });
    expect(requests).toHaveLength(1);
  });

  it('5xx und Netzwerkfehler werden weiter wiederholt', async () => {
    let calls = 0;
    const { client } = makeClient(() => {
      calls += 1;
      if (calls === 1) return new Response('kaputt', { status: 502 });
      if (calls === 2) throw new TypeError('fetch failed');
      return new Response('%PDF', { status: 200, headers: PDF });
    });
    (await client.downloadFile(REF)).stream.resume();
    expect(calls).toBe(3);
  });

  it('REST-Aufrufe wiederholen ein Zeitlimit weiterhin (08 §9.1)', async () => {
    let calls = 0;
    const { client } = makeClient(() => {
      calls += 1;
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    });
    await failureOf(client.read('core_webservice_get_site_info'));
    expect(calls).toBe(3);
  });
});

describe('Abbruch per AbortSignal (Issue #129, H5)', () => {
  it('abgebrochen, während der Aufruf auf einen Platz wartet: Moodle wird nie angefragt', async () => {
    const holder = new AbortController();
    let calls = 0;
    const { client, requests } = makeClient(
      (request) => {
        calls += 1;
        return calls === 1 ? silentBody(request.init) : new Response('%PDF', { status: 200, headers: PDF });
      },
      { maxConcurrentDownloads: 1 },
    );
    const first = client.downloadFile(REF, { signal: holder.signal });
    first.catch(() => {});
    await settle();
    expect(requests).toHaveLength(1);

    const waiting = new AbortController();
    const second = client.downloadFile(REF, { signal: waiting.signal });
    await settle();
    waiting.abort();
    expect(await failureOf(second)).toBeInstanceOf(RequestAbortedError);

    // Der Platz wird frei, nachfolgende Aufrufe kommen dran. Der abgebrochene darf nicht mehr starten
    holder.abort();
    await failureOf(first);
    const third = await client.downloadFile(REF).then(
      (file) => file,
      () => null,
    );
    third?.stream.destroy();
    expect(requests).toHaveLength(2);
  });

  it('schon abgebrochenes Signal: gar keine Anfrage', async () => {
    const { client, requests } = makeClient(() => json({}));
    const aborted = new AbortController();
    aborted.abort();
    expect(await failureOf(client.downloadFile(REF, { signal: aborted.signal }))).toBeInstanceOf(
      RequestAbortedError,
    );
    expect(requests).toHaveLength(0);
  });

  it('Abbruch vor den Headern: keine Wiederholung, Platz frei', async () => {
    const controller = new AbortController();
    const { client, requests } = makeClient(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.init.signal?.addEventListener('abort', () => reject(request.init.signal?.reason), {
            once: true,
          });
        }),
      { maxConcurrentDownloads: 1 },
    );
    const pending = client.downloadFile(REF, { signal: controller.signal });
    await settle();
    controller.abort();
    expect(await failureOf(pending)).toBeInstanceOf(RequestAbortedError);
    expect(requests).toHaveLength(1);
  });

  it('Abbruch während der Übertragung zerstört den Stream und gibt den Platz frei', async () => {
    let calls = 0;
    let cancelled = false;
    const { client } = makeClient(
      (request) => {
        calls += 1;
        if (calls > 1) return new Response('%PDF-ok', { status: 200, headers: PDF });
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('%PDF-1'));
              abortable(request.init.signal, controller);
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 200, headers: PDF },
        );
      },
      { maxConcurrentDownloads: 1 },
    );
    const controller = new AbortController();
    const file = await client.downloadFile(REF, { signal: controller.signal });
    const reading = failureOf(
      (async () => {
        for await (const chunk of file.stream) void chunk;
      })(),
    );
    await settle();
    controller.abort();
    expect(await reading).toBeInstanceOf(RequestAbortedError);
    expect(cancelled).toBe(true);
    // Der einzige Platz ist frei
    (await client.downloadFile(REF)).stream.resume();
    expect(calls).toBe(2);
  });
});

/** Körper, der alle `everyMs` `bytes` Byte liefert (Fake-Timer), ohne je zu enden */
function trickle(everyMs: number, bytes: number, init: RequestInit): Response {
  return new Response(
    new ReadableStream({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, everyMs));
        controller.enqueue(new Uint8Array(bytes).fill(0x41));
      },
      start: (controller) => abortable(init.signal, controller),
    }),
    { status: 200, headers: PDF },
  );
}

describe('Mindestrate gegen Slow Loris (Issue #129)', () => {
  it('alle 29 s ein Byte: kein Leerlauf, aber unter 64 KiB je 60 s -> 502 too_slow, Platz frei', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    let calls = 0;
    const { client } = makeClient(
      (request) => {
        calls += 1;
        return calls === 1
          ? trickle(29_000, 1, request.init)
          : new Response('%PDF', { status: 200, headers: PDF });
      },
      { maxConcurrentDownloads: 1 },
    );
    const pending = client.downloadFile(REF);
    await vi.advanceTimersByTimeAsync(29_000);
    const file = await pending;
    const failure = failureOf(
      (async () => {
        for await (const chunk of file.stream) void chunk;
      })(),
    );
    // Der Leerlauf-Zeitlimit (30 s) schlägt nie an: alle 29 s kommt ein Byte. Das Zeitfenster endet bei 60 s
    await vi.advanceTimersByTimeAsync(30_999);
    expect(file.stream.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const error = (await failure) as HttpError;
    expect([error.statusCode, error.code, error.details]).toEqual([
      502,
      'moodle_unreachable',
      { reason: 'too_slow' },
    ]);
    // Der einzige Platz ist wieder frei
    (await client.downloadFile(REF)).stream.resume();
    expect(calls).toBe(2);
  });

  it('Gegenstück: genug Daten je Zeitfenster bleiben unbehelligt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const { client } = makeClient((request) => trickle(400, 5, request.init), {
      idleTimeoutMs: 500,
      minRateBytes: 10,
      rateWindowMs: 1000,
    });
    const pending = client.downloadFile(REF);
    await vi.advanceTimersByTimeAsync(400);
    const file = await pending;
    file.stream.resume();
    // 5 Byte alle 400 ms = 12 oder 13 Byte je 1000 ms: über der Mindestrate, auch nach vielen Fenstern
    await vi.advanceTimersByTimeAsync(10_000);
    expect(file.stream.destroyed).toBe(false);
    file.stream.destroy();
  });
});

describe('Retry-Pause und Pacer-Wartezeit sind abbrechbar (Issue #129)', () => {
  it('Abbruch während der Pause nach einem 503: das Promise endet sofort, kein zweiter Versuch', async () => {
    // sleep hängt für immer: Nur der Abbruch kann die Pause beenden
    const { client, requests } = makeClient(() => new Response('weg', { status: 503 }), {
      sleep: () => new Promise<void>(() => {}),
    });
    const controller = new AbortController();
    const pending = client.downloadFile(REF, { signal: controller.signal });
    const outcome = failureOf(pending);
    await settle();
    expect(requests).toHaveLength(1);
    controller.abort();
    expect(await outcome).toBeInstanceOf(RequestAbortedError);
    expect(requests).toHaveLength(1);
  });

  it('Abbruch während der Pacer-Wartezeit: Moodle wird nicht angefragt, der Platz bleibt frei', async () => {
    let sleeps = 0;
    let openGate: () => void = () => {};
    const sleep = (): Promise<void> => {
      sleeps += 1;
      // Nur das erste Warten (Abstand zum ersten Start) hängt an einem Gate
      return sleeps === 1 ? new Promise<void>((resolve) => (openGate = resolve)) : Promise.resolve();
    };
    const { client, requests } = makeClient(() => new Response('%PDF', { status: 200, headers: PDF }), {
      sleep,
      minIntervalMs: 40,
      maxConcurrentDownloads: 1,
      // virtuelle Uhr: der Abstand wird nie verstreichen
      now: () => 0,
    });
    // Erster Download startet ohne Wartezeit, danach gibt er den Platz frei
    const first = await client.downloadFile(REF);
    first.stream.destroy();
    expect(requests).toHaveLength(1);

    const controller = new AbortController();
    const second = failureOf(client.downloadFile(REF, { signal: controller.signal }));
    await settle();
    expect(sleeps).toBe(1);
    controller.abort();
    openGate();
    expect(await second).toBeInstanceOf(RequestAbortedError);
    expect(requests).toHaveLength(1);

    // Platz wurde zurückgegeben: der nächste Download geht durch
    (await client.downloadFile(REF)).stream.resume();
    expect(requests).toHaveLength(2);
  });
});

describe('abortWhenClosed (GET /moodle/file, Issue #129)', () => {
  const response = () => new ServerResponse(new IncomingMessage(new Socket()));

  it('Verbindung schließt sich vor dem Ende der Antwort: Abbruch', () => {
    const res = response();
    const closed = abortWhenClosed(res);
    expect(closed.signal.aborted).toBe(false);
    res.emit('close');
    expect(closed.signal.aborted).toBe(true);
  });

  it('auf dem Erfolgsweg: stop() entfernt den Listener, ein spätes close löst nichts aus', () => {
    const res = response();
    const closed = abortWhenClosed(res);
    expect(res.listenerCount('close')).toBe(1);
    closed.stop();
    expect(res.listenerCount('close')).toBe(0);
    res.emit('close');
    expect(closed.signal.aborted).toBe(false);
  });

  it('Verbindung war beim Registrieren schon zu: sofort abgebrochen', () => {
    const res = response();
    res.destroy();
    expect(res.destroyed).toBe(true);
    expect(abortWhenClosed(res).signal.aborted).toBe(true);
  });
});
