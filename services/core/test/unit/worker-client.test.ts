// T2-12: Client für den Loopback-Endpunkt des Workers (VERTRAEGE §19.4, §19.6 Schritt 4) gegen einen echten
// Test-Server auf 127.0.0.1 mit Token-Datei.
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKER_PORT,
  WorkerClient,
  WorkerError,
  workerPortFromEnv,
} from '../../src/lib/worker-client.ts';
import { FAKE_MODEL, FakeWorker, fakeEmbed } from './worker-fake.ts';

let dataDir: string;
let worker: FakeWorker;
let client: WorkerClient;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'sg-worker-client-'));
  worker = await new FakeWorker(dataDir).start();
  client = new WorkerClient({ dataDir, port: worker.port });
});
afterEach(async () => {
  await worker.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    expect(error).toBeInstanceOf(WorkerError);
    // Das Token steht nie in einer Fehlermeldung
    expect((error as Error).message).not.toContain(worker.token);
    return (error as WorkerError).code;
  }
}

describe('workerPortFromEnv', () => {
  it('liest SG_WORKER_PORT, sonst 4711', () => {
    expect(workerPortFromEnv({})).toBe(DEFAULT_WORKER_PORT);
    expect(workerPortFromEnv({ SG_WORKER_PORT: '5123' })).toBe(5123);
    expect(workerPortFromEnv({ SG_WORKER_PORT: 'abc' })).toBe(DEFAULT_WORKER_PORT);
    expect(workerPortFromEnv({ SG_WORKER_PORT: '70000' })).toBe(DEFAULT_WORKER_PORT);
  });
});

describe('WorkerClient', () => {
  it('embed: 127.0.0.1 mit Host, Bearer-Token, JSON und Content-Length; Antwort nach Schema', async () => {
    const result = await client.embed(['dritte normalform']);
    expect(result.model).toBe(FAKE_MODEL);
    expect(result.vectors[0]).toEqual(fakeEmbed('dritte normalform'));
    const [request] = worker.requests;
    expect(request).toMatchObject({
      method: 'POST',
      path: '/embed',
      host: `127.0.0.1:${worker.port}`,
      authorization: `Bearer ${worker.token}`,
      contentType: 'application/json',
      body: { texts: ['dritte normalform'] },
    });
    expect(Number(request!.contentLength)).toBeGreaterThan(0);
  });

  it('health: WorkerHealth nach Schema', async () => {
    worker.healthState = 'laedt';
    expect((await client.health()).embedder).toMatchObject({ model: FAKE_MODEL, state: 'laedt' });
    expect(worker.requests[0]).toMatchObject({ method: 'GET', path: '/health' });
  });

  it('liest das Token nur bei Bedarf und behält es im Speicher', async () => {
    await client.embed(['a b']);
    // Datei weg: das Token im Speicher gilt weiter
    unlinkSync(join(dataDir, 'run', 'worker.token'));
    await client.embed(['a b']);
    expect(worker.requests).toHaveLength(2);
  });

  it('401 nach Neustart des Workers: Token einmal neu lesen und wiederholen', async () => {
    await client.embed(['eins']);
    const fresh = worker.rotateToken();
    const result = await client.embed(['zwei']);
    expect(result.vectors).toHaveLength(1);
    expect(worker.requests.map((r) => r.authorization)).toEqual([
      expect.not.stringContaining(fresh),
      expect.not.stringContaining(fresh),
      `Bearer ${fresh}`,
    ]);
  });

  it('401 auch mit frischem Token → embedder_unavailable, höchstens eine Wiederholung', async () => {
    worker.mode = 'unauthorized';
    expect(await code(client.embed(['x y']))).toBe('embedder_unavailable');
    expect(worker.requests).toHaveLength(2);
  });

  it('503 embedder_not_ready → embedder_not_ready, andere 503 und 500 → embedder_unavailable', async () => {
    worker.mode = 'not_ready';
    expect(await code(client.embed(['x y']))).toBe('embedder_not_ready');
    worker.mode = 'unavailable';
    expect(await code(client.embed(['x y']))).toBe('embedder_unavailable');
    worker.mode = 'busy';
    expect(await code(client.embed(['x y']))).toBe('embedder_unavailable');
    worker.mode = 'server_error';
    expect(await code(client.embed(['x y']))).toBe('embedder_unavailable');
  });

  it('Antwort, die nicht zum Schema passt → embedder_unavailable', async () => {
    worker.mode = 'bad_schema';
    expect(await code(client.embed(['x y']))).toBe('embedder_unavailable');
  });

  it('Zeitlimit (800 ms) → embedder_unavailable, ohne auf die Antwort zu warten', async () => {
    worker.mode = 'slow';
    worker.delayMs = 3000;
    const started = Date.now();
    expect(await code(client.embed(['x y']))).toBe('embedder_unavailable');
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(700);
    expect(elapsed).toBeLessThan(1500);
  });

  it('Worker aus (Port zu) → embedder_unavailable', async () => {
    await worker.stop();
    expect(await code(client.embed(['x y']))).toBe('embedder_unavailable');
    expect(await code(client.health())).toBe('embedder_unavailable');
  });

  it('Token-Datei fehlt, hat ein falsches Format oder ist ein Symlink → embedder_unavailable ohne Anfrage', async () => {
    const file = join(dataDir, 'run', 'worker.token');
    unlinkSync(file);
    expect(await code(client.embed(['x y']))).toBe('embedder_unavailable');
    writeFileSync(file, 'kein token\n');
    expect(await code(client.embed(['x y']))).toBe('embedder_unavailable');
    unlinkSync(file);
    const elsewhere = join(dataDir, 'anderswo.token');
    writeFileSync(elsewhere, worker.token);
    symlinkSync(elsewhere, file);
    expect(await code(client.embed(['x y']))).toBe('embedder_unavailable');
    expect(worker.requests).toHaveLength(0);
  });

  it('Token mit Zeilenumbruch am Ende wird angenommen', async () => {
    worker.writeTokenFile(`${worker.token}\n`);
    expect((await client.embed(['x y'])).vectors).toHaveLength(1);
  });
});
