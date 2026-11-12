// MoodleClient.uploadDraft (T1-24 PR 2, Plan §3.5 und §5.4) gegen den Fake und einmal gegen einen echten HTTP-Server
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../src/errors.ts';
import { MoodleClient, type MoodleLogger } from '../../src/moodle/client.ts';
import { StaticTokenStore } from '../../src/moodle/token-store.ts';
import {
  byPath,
  FAKE_BASE,
  FAKE_TOKEN,
  fakeFetch,
  json,
  restHandler,
  uploadHandler,
  type FakeHandler,
} from './moodle-fake.ts';

const dir = mkdtempSync(join(tmpdir(), 'sg-moodle-upload-client-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let counter = 0;
function tmpFile(content: string | Buffer): { path: string; filename: string; sizeBytes: number } {
  counter += 1;
  const path = join(dir, `datei-${counter}`);
  const data = typeof content === 'string' ? Buffer.from(content) : content;
  writeFileSync(path, data);
  return { path, filename: `blatt-${counter}.pdf`, sizeBytes: data.length };
}

interface LogLine {
  level: 'debug' | 'warn';
  obj: Record<string, unknown>;
  msg: string;
}

function setup(handler: FakeHandler, extra: Record<string, unknown> = {}, token: string | null = FAKE_TOKEN) {
  const fake = fakeFetch(handler);
  const lines: LogLine[] = [];
  const logger: MoodleLogger = {
    debug: (obj, msg) => lines.push({ level: 'debug', obj, msg }),
    warn: (obj, msg) => lines.push({ level: 'warn', obj, msg }),
  };
  const tokens = new StaticTokenStore(token);
  const client = new MoodleClient({
    baseUrl: FAKE_BASE,
    tokens,
    fetch: fake.fetch,
    logger,
    sleep: async () => {},
    minIntervalMs: 0,
    ...extra,
  });
  return { client, requests: fake.requests, lines, tokens };
}

async function httpError(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error('kein Fehler geworfen');
}

describe('uploadDraft gegen den Fake', () => {
  it('schickt multipart an upload.php: Token nur im Feld, nie in der URL, ohne Weiterleitung', async () => {
    const { client, requests } = setup(uploadHandler({ itemid: 777 }));
    const file = tmpFile('%PDF-1.7 Lösung');
    const result = await client.uploadDraft([{ ...file, filename: 'loesung.pdf' }]);
    expect(result).toEqual({ itemid: 777 });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe(`${FAKE_BASE}/webservice/upload.php`);
    expect(request?.url).not.toContain('token=');
    expect(request?.url).not.toContain(FAKE_TOKEN);
    expect(request?.init.method).toBe('POST');
    expect(request?.init.redirect).toBe('manual');
    // Kein eigener content-type: fetch setzt ihn mit der Grenze
    expect(JSON.stringify(request?.init.headers ?? {}).toLowerCase()).not.toContain('content-type');
    const form = request?.form;
    expect(form?.get('token')).toBe(FAKE_TOKEN);
    expect(form?.get('filearea')).toBe('draft');
    expect(form?.get('itemid')).toBe('0');
    const sent = form?.get('file_1') as File;
    expect(sent.name).toBe('loesung.pdf');
    expect(await sent.text()).toBe('%PDF-1.7 Lösung');
  });

  it('mehrere Dateien nacheinander: die erste mit itemid 0, die weiteren mit der gelieferten', async () => {
    const { client, requests } = setup(uploadHandler({ itemid: 31337 }));
    const result = await client.uploadDraft([tmpFile('eins'), tmpFile('zwei'), tmpFile('drei')]);
    expect(result).toEqual({ itemid: 31337 });
    expect(requests.map((r) => r.form?.get('itemid'))).toEqual(['0', '31337', '31337']);
    expect(await Promise.all(requests.map((r) => (r.form?.get('file_1') as File).text()))).toEqual([
      'eins',
      'zwei',
      'drei',
    ]);
  });

  it('liefert Moodle bei der zweiten Datei eine andere itemid, ist das ein Fehler', async () => {
    let calls = 0;
    const { client } = setup(() => {
      calls += 1;
      return json([{ itemid: calls === 1 ? 5 : 6 }]);
    });
    const error = await httpError(client.uploadDraft([tmpFile('a'), tmpFile('b')]));
    expect(error).toMatchObject({ statusCode: 502, code: 'moodle_error' });
    expect(error.details).toMatchObject({ moodle_errorcode: 'upload_itemid_mismatch' });
  });

  it('maskiert Anführungszeichen und Zeilenumbrüche im Dateinamen (Header-Injection)', async () => {
    const { client, requests } = setup(uploadHandler());
    await client.uploadDraft([{ ...tmpFile('x'), filename: 'a"b\r\n.pdf' }]);
    const form = requests[0]?.form as FormData;
    const wire = new Response(form);
    const text = await wire.text();
    expect(text).toContain('filename="a%22b%0D%0A.pdf"');
    // Weder das rohe Anführungszeichen noch ein Zeilenumbruch im Namen
    expect(text).not.toContain('a"b');
    expect(text).not.toMatch(/filename="[^"]*[\r\n]/);
    // Gegenprobe: ein harmloser Name bleibt unverändert
    const second = setup(uploadHandler());
    await second.client.uploadDraft([{ ...tmpFile('x'), filename: 'blatt 1.pdf' }]);
    expect(await new Response(second.requests[0]?.form as FormData).text()).toContain(
      'filename="blatt 1.pdf"',
    );
  });

  it('wiederholt nie: 5xx → 502 moodle_unreachable mit outcome_unknown, genau eine Anfrage', async () => {
    const { client, requests } = setup(() => new Response('kaputt', { status: 503 }));
    const error = await httpError(client.uploadDraft([tmpFile('x')]));
    expect(error).toMatchObject({ statusCode: 502, code: 'moodle_unreachable' });
    expect(error.details).toMatchObject({ reason: 'http_503', outcome_unknown: true });
    expect(requests).toHaveLength(1);
  });

  it('wiederholt nie: Netzwerkfehler → outcome_unknown, genau eine Anfrage', async () => {
    const { client, requests } = setup(() => {
      throw new TypeError('fetch failed');
    });
    const error = await httpError(client.uploadDraft([tmpFile('x')]));
    expect(error).toMatchObject({ statusCode: 502, code: 'moodle_unreachable' });
    expect(error.details).toMatchObject({ reason: 'network', outcome_unknown: true });
    expect(requests).toHaveLength(1);
  });

  it('Zeitlimit → outcome_unknown, keine Wiederholung', async () => {
    const hang: FakeHandler = ({ init }) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    const { client, requests } = setup(hang, { uploadTimeoutMs: 20 });
    const error = await httpError(client.uploadDraft([tmpFile('x')]));
    expect(error.details).toMatchObject({ reason: 'timeout', outcome_unknown: true });
    expect(requests).toHaveLength(1);
  });

  it('das Zeitlimit wächst mit der Dateigröße (mindestens 64 KiB/s), kurz für kleine Dateien', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    try {
      const { client } = setup(uploadHandler(), { uploadTimeoutMs: 20 });
      await client.uploadDraft([tmpFile('klein')]);
      await client.uploadDraft([tmpFile(Buffer.alloc(1024 * 1024, 1))]);
      // 1 MiB bei 64 KiB/s = 16 s, weit über dem Mindest-Zeitlimit von 20 ms
      expect(spy.mock.calls.map((call) => call[0])).toEqual([20, 16_000]);
      // Standard: mindestens 120 s
      spy.mockClear();
      const standard = setup(uploadHandler());
      await standard.client.uploadDraft([tmpFile('klein')]);
      expect(spy.mock.calls.map((call) => call[0])).toEqual([120_000]);
    } finally {
      spy.mockRestore();
    }
  });

  it('folgt keiner Weiterleitung', async () => {
    const { client, requests } = setup(
      () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
    );
    const error = await httpError(client.uploadDraft([tmpFile('x')]));
    expect(error.details).toMatchObject({ reason: 'redirect' });
    expect(requests).toHaveLength(1);
  });

  it('Antwort ohne JSON → 502 moodle_unreachable (no_json) mit outcome_unknown', async () => {
    const { client } = setup(() => new Response('<html>Anmeldung</html>', { status: 200 }));
    const error = await httpError(client.uploadDraft([tmpFile('x')]));
    expect(error.details).toMatchObject({ reason: 'no_json', outcome_unknown: true });
  });

  it('invalidtoken → 409 moodle_token_invalid und der Token gilt als abgelehnt', async () => {
    const { client, tokens } = setup(uploadHandler(), {}, 'cd'.repeat(16));
    let rejected = 0;
    client.onTokenRejected(() => (rejected += 1));
    const error = await httpError(client.uploadDraft([tmpFile('x')]));
    expect(error).toMatchObject({ statusCode: 409, code: 'moodle_token_invalid' });
    expect(tokens.invalidations).toBe(1);
    expect(rejected).toBe(1);
  });

  it('Fehlerobjekt je Datei (Array) → 502 moodle_error; Fehler ohne errorcode ebenfalls', async () => {
    const inArray = setup(() => json([{ error: 'Datei zu groß', errorcode: 'uploadlimit' }]));
    const first = await httpError(inArray.client.uploadDraft([tmpFile('x')]));
    expect(first).toMatchObject({ statusCode: 502, code: 'moodle_error' });
    expect(first.details).toMatchObject({ moodle_errorcode: 'uploadlimit' });
    const bare = setup(() => json({ error: 'Nicht erlaubt' }));
    const second = await httpError(bare.client.uploadDraft([tmpFile('x')]));
    expect(second).toMatchObject({ statusCode: 502, code: 'moodle_error' });
    expect(second.details).toMatchObject({ moodle_errorcode: 'uploaderror' });
  });

  it.each([
    ['leeres Array', []],
    ['Zahl', 7],
    ['null', null],
    ['ohne itemid', [{ filename: 'x' }]],
    ['itemid 0', [{ itemid: 0 }]],
    ['itemid Text', [{ itemid: 'abc' }]],
    ['zwei Einträge', [{ itemid: 1 }, { itemid: 2 }]],
  ])('unbrauchbare Antwort (%s) → 502 moodle_error, nie ein Absturz', async (_name, body) => {
    const { client } = setup(() => json(body));
    const error = await httpError(client.uploadDraft([tmpFile('x')]));
    expect(error).toMatchObject({ statusCode: 502, code: 'moodle_error' });
    expect(error.details).toMatchObject({ moodle_errorcode: 'upload_response_invalid' });
  });

  it('itemid als Zahl in Textform ist gültig (Gegenprobe)', async () => {
    const { client } = setup(() => json([{ itemid: '4711' }]));
    await expect(client.uploadDraft([tmpFile('x')])).resolves.toEqual({ itemid: 4711 });
  });

  it('der Token steht nach einem Fehler weder in der Meldung noch in den Details noch im Log', async () => {
    const { client, lines } = setup(() =>
      json([{ error: `Token ${FAKE_TOKEN.toUpperCase()} abgelehnt für geheimes-blatt.pdf`, errorcode: 'x' }]),
    );
    const error = await httpError(client.uploadDraft([{ ...tmpFile('x'), filename: 'geheimes-blatt.pdf' }]));
    const everything = JSON.stringify({ message: error.message, details: error.details, lines });
    expect(everything.toLowerCase()).not.toContain(FAKE_TOKEN);
    // Das Log nennt weder Dateinamen noch Inhalt
    expect(JSON.stringify(lines)).not.toContain('geheimes-blatt');
  });

  it('der Token steht auch beim Netzwerkfehler nicht im Log; das Log nennt Dauer, Anzahl und Byte', async () => {
    const failing = setup(() => {
      throw new TypeError(`fetch failed: ${FAKE_TOKEN}`);
    });
    await httpError(failing.client.uploadDraft([tmpFile('x')]));
    expect(JSON.stringify(failing.lines)).not.toContain(FAKE_TOKEN);

    const ok = setup(uploadHandler());
    await ok.client.uploadDraft([{ ...tmpFile('12345'), filename: 'privat.pdf' }, tmpFile('678')]);
    const line = ok.lines.find((l) => l.obj.wsfunction === 'upload.php');
    expect(line?.obj).toMatchObject({ wsfunction: 'upload.php', files: 2, bytes: 8 });
    expect(typeof line?.obj.duration_ms).toBe('number');
    expect(JSON.stringify(ok.lines)).not.toContain('privat');
    expect(JSON.stringify(ok.lines)).not.toContain(FAKE_TOKEN);
  });

  it('fehlende oder veränderte Datei → 404 moodle_upload_not_found, Moodle wird nicht angefragt', async () => {
    const { client, requests } = setup(uploadHandler());
    const gone = await httpError(
      client.uploadDraft([{ path: join(dir, 'gibt-es-nicht'), filename: 'a.pdf', sizeBytes: 3 }]),
    );
    expect(gone).toMatchObject({ statusCode: 404, code: 'moodle_upload_not_found' });
    const changed = await httpError(client.uploadDraft([{ ...tmpFile('abc'), sizeBytes: 99 }]));
    expect(changed).toMatchObject({ statusCode: 404, code: 'moodle_upload_not_found' });
    expect(requests).toHaveLength(0);
  });

  it('ohne Moodle oder Token: 503 moodle_not_configured, ohne Anfrage', async () => {
    const noToken = setup(uploadHandler(), {}, null);
    expect(await httpError(noToken.client.uploadDraft([tmpFile('x')]))).toMatchObject({
      statusCode: 503,
      code: 'moodle_not_configured',
    });
    expect(noToken.requests).toHaveLength(0);
    const noUrl = new MoodleClient({ baseUrl: '', tokens: new StaticTokenStore(FAKE_TOKEN) });
    expect(await httpError(noUrl.uploadDraft([tmpFile('x')]))).toMatchObject({
      code: 'moodle_not_configured',
    });
  });

  it('ohne Datei ist es ein Programmierfehler', async () => {
    const { client } = setup(uploadHandler());
    await expect(client.uploadDraft([])).rejects.toThrow(/mindestens eine Datei/);
  });

  it('zählt im REST-Pool: bei maxConcurrent 1 wartet ein Aufruf, bis der Upload fertig ist', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: (() => void) | undefined;
    const uploadStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const rest = restHandler({ core_webservice_get_site_info: { userid: 1 } });
    const upload: FakeHandler = async () => {
      started?.();
      await gate;
      return json([{ itemid: 9 }]);
    };
    const { client, requests } = setup(byPath(rest, upload), { maxConcurrent: 1 });
    const uploading = client.uploadDraft([tmpFile('x')]);
    await uploadStarted;
    const reading = client.read('core_webservice_get_site_info');
    // Eine Runde der Ereignisschleife: der Upload hängt, der lesende Aufruf darf noch nicht losgehen
    await new Promise((resolve) => setImmediate(resolve));
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual(['/webservice/upload.php']);
    release?.();
    await uploading;
    await reading;
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      '/webservice/upload.php',
      '/webservice/rest/server.php',
    ]);
  });
});

describe('uploadDraft gegen einen echten HTTP-Server (fetch, multipart auf dem Draht)', () => {
  const received: { fields: Record<string, string>; file?: { name: string; data: Buffer; mime: string } }[] =
    [];
  const paths: string[] = [];
  const server = Fastify({ logger: false });
  let baseUrl = '';

  beforeAll(async () => {
    await server.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
    server.post('/webservice/upload.php', async (request) => {
      paths.push(request.url);
      const fields: Record<string, string> = {};
      let file: { name: string; data: Buffer; mime: string } | undefined;
      for await (const part of request.parts()) {
        if (part.type === 'field') fields[part.fieldname] = String(part.value);
        else file = { name: part.filename, data: await part.toBuffer(), mime: part.mimetype };
      }
      received.push({ fields, ...(file ? { file } : {}) });
      return [{ itemid: 5150, filename: file?.name }];
    });
    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });
  afterAll(async () => {
    await server.close();
  });

  it('der Server sieht Felder und Dateiinhalt, der Token steht nicht in der URL', async () => {
    const client = new MoodleClient({ baseUrl, tokens: new StaticTokenStore(FAKE_TOKEN), minIntervalMs: 0 });
    const content = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300_000, 7)]);
    const file = { ...tmpFile(content), filename: 'groß ü.pdf' };
    await expect(client.uploadDraft([file])).resolves.toEqual({ itemid: 5150 });
    expect(paths).toEqual(['/webservice/upload.php']);
    const [got] = received;
    expect(got?.fields).toEqual({ token: FAKE_TOKEN, filearea: 'draft', itemid: '0' });
    expect(got?.file?.name).toBe('groß ü.pdf');
    expect(got?.file?.data.equals(content)).toBe(true);
  });

  it('ein Name mit Anführungszeichen und Zeilenumbruch kommt als ein einziger Dateiname an', async () => {
    received.length = 0;
    const client = new MoodleClient({ baseUrl, tokens: new StaticTokenStore(FAKE_TOKEN), minIntervalMs: 0 });
    await client.uploadDraft([{ ...tmpFile('x'), filename: 'a"b\r\nContent-Type: text/html.pdf' }]);
    expect(received).toHaveLength(1);
    expect(Object.keys(received[0]?.fields ?? {}).sort()).toEqual(['filearea', 'itemid', 'token']);
    expect(received[0]?.file?.mime).not.toBe('text/html');
  });
});
