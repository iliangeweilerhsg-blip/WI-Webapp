// Verbindungsgrenzen des Core (#84 M-1): Leerlauf-Sockets werden geschlossen, Verbindungen aus dem Netz sind je
// Quelle begrenzt. Normale Anfragen, langsame Uploads und der WebSocket /sync dürfen dadurch nicht brechen.
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { SINGLE_USER_ID, UploadResultSchema } from '@sg/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { connectionLimits } from '../../src/app.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { startTestApp, type TestApp } from './helpers.ts';
import {
  networkAddress,
  sleep,
  startSyncApp,
  TestClient,
  waitFor,
  type SyncTestApp,
} from './sync-helpers.ts';

const API = '/api/v1';
const original = { ...connectionLimits };

function restoreLimits(): void {
  Object.assign(connectionLimits, original);
}

/** Roher TCP-Socket; `closed` wird wahr, sobald der Server ihn schließt */
async function openSocket(host: string, port: number): Promise<{ socket: Socket; closed: () => boolean }> {
  const socket = connect(port, host);
  let closed = false;
  socket.on('close', () => (closed = true));
  socket.on('error', () => {});
  socket.on('data', () => {});
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', reject);
  });
  return { socket, closed: () => closed };
}

describe('Zeitgrenzen für Verbindungen', () => {
  let t: TestApp;
  let port: number;
  let moduleId: string;

  beforeAll(async () => {
    Object.assign(connectionLimits, { connectionTimeoutMs: 300, keepAliveTimeoutMs: 200 });
    t = await startTestApp();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    port = (t.app.server.address() as AddressInfo).port;
    const semesterId = uuidv7();
    moduleId = uuidv7();
    await t.handle
      .sql`INSERT INTO semester (id, user_id, name) VALUES (${semesterId}, ${SINGLE_USER_ID}, 'Verbindungen')`;
    await t.handle
      .sql`INSERT INTO module (id, user_id, semester_id, name, color) VALUES (${moduleId}, ${SINGLE_USER_ID}, ${semesterId}, 'Netze', 'mod-01')`;
  });
  afterAll(async () => {
    restoreLimits();
    await t.close();
  });

  it('ein Socket, der nie etwas sendet, wird nach connectionTimeout geschlossen', async () => {
    const started = Date.now();
    const idle = await openSocket('127.0.0.1', port);
    await waitFor(idle.closed, 3000, 'Schließen des Leerlauf-Sockets');
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  it('normale Anfrage geht, danach schließt keepAliveTimeout die Keep-Alive-Verbindung', async () => {
    const conn = await openSocket('127.0.0.1', port);
    let response = '';
    conn.socket.on('data', (chunk: Buffer) => (response += chunk.toString('utf8')));
    conn.socket.write(`GET ${API}/health HTTP/1.1\r\nHost: localhost:${t.config.port}\r\n\r\n`);
    await waitFor(() => response.includes('\r\n\r\n'), 3000, 'Antwort');
    expect(response.startsWith('HTTP/1.1 200')).toBe(true);
    expect(response.toLowerCase()).toContain('connection: keep-alive');
    await waitFor(conn.closed, 3000, 'Schließen nach keepAliveTimeout');
  });

  it('ein langsamer Upload, der länger dauert als connectionTimeout, kommt vollständig an', async () => {
    const boundary = `----sgconn${randomBytes(6).toString('hex')}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="module_id"\r\n\r\n${moduleId}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="langsam.pdf"\r\n` +
        `Content-Type: application/pdf\r\n\r\n%PDF-1.4\n`,
    );
    const pieces = Array.from({ length: 10 }, () => Buffer.from(`% ${randomBytes(2048).toString('hex')}\n`));
    const tail = Buffer.from(`%%EOF\n\r\n--${boundary}--\r\n`);
    const length = head.length + pieces.reduce((sum, p) => sum + p.length, 0) + tail.length;
    const started = Date.now();
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `${API}/slide-decks`,
        headers: {
          host: `localhost:${t.config.port}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'content-length': String(length),
        },
      });
      req.on('error', reject);
      req.on('response', (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.write(head);
      // Alle 100 ms ein Stück: insgesamt gut 1 s, also länger als connectionTimeout (300 ms)
      void (async () => {
        for (const piece of pieces) {
          await sleep(100);
          req.write(piece);
        }
        await sleep(100);
        req.end(tail);
      })();
    });
    expect(Date.now() - started).toBeGreaterThan(1000);
    expect(result.status).toBe(201);
    expect(UploadResultSchema.parse(JSON.parse(result.body)).duplicate).toBe(false);
  });
});

describe('maxRequestsPerSocket und maxConnections', () => {
  let t: TestApp;
  let port: number;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    Object.assign(connectionLimits, { maxRequestsPerSocket: 2, maxConnections: 3, keepAliveTimeoutMs: 200 });
    t = await startTestApp();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    port = (t.app.server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy();
    await sleep(100);
  });
  afterAll(async () => {
    restoreLimits();
    await t.close();
  });

  // Node schließt den Socket dabei nicht sofort (es setzt nur `Connection: close` und beantwortet weitere Anfragen
  // mit 503). Ein Client, der ihn trotzdem offen hält, fällt unter keepAliveTimeout (plus 1 s Puffer von Node)
  it('nach maxRequestsPerSocket Anfragen: Connection: close, danach 503, dann schließt keepAliveTimeout', async () => {
    const conn = await openSocket('127.0.0.1', port);
    sockets.push(conn.socket);
    let response = '';
    conn.socket.on('data', (chunk: Buffer) => (response += chunk.toString('utf8')));
    const get = `GET ${API}/health HTTP/1.1\r\nHost: localhost:${t.config.port}\r\n\r\n`;
    conn.socket.write(get);
    await waitFor(() => response.split('HTTP/1.1 200').length === 2, 3000, 'erste Antwort');
    expect(response.toLowerCase()).toContain('connection: keep-alive');
    response = '';
    conn.socket.write(get);
    await waitFor(() => response.includes('HTTP/1.1 200'), 3000, 'zweite Antwort');
    expect(response.toLowerCase()).toContain('connection: close');
    response = '';
    conn.socket.write(get);
    await waitFor(() => response.includes('\r\n\r\n'), 3000, 'dritte Antwort');
    expect(response.startsWith('HTTP/1.1 503')).toBe(true);
    await waitFor(conn.closed, 3000, 'Schließen nach keepAliveTimeout');
  });

  it('über maxConnections hinaus werden Verbindungen sofort geschlossen, auch über Loopback', async () => {
    const allowed = [];
    for (let i = 0; i < 3; i++) {
      const conn = await openSocket('127.0.0.1', port);
      sockets.push(conn.socket);
      allowed.push(conn);
    }
    await sleep(100);
    const extra = await openSocket('127.0.0.1', port);
    sockets.push(extra.socket);
    await waitFor(extra.closed, 2000, 'Schließen über maxConnections');
    expect(allowed.map((c) => c.closed())).toEqual([false, false, false]);
  });
});

describe('WebSocket /sync bleibt über die HTTP-Zeitgrenzen hinaus offen', () => {
  let app: SyncTestApp;
  beforeAll(async () => {
    Object.assign(connectionLimits, { connectionTimeoutMs: 300, keepAliveTimeoutMs: 200 });
    app = await startSyncApp();
  });
  afterAll(async () => {
    restoreLimits();
    await app.close();
  });

  it('nach dem Upgrade gelten connectionTimeout und keepAliveTimeout nicht', async () => {
    const client = await TestClient.open(`ws://127.0.0.1:${app.port}/sync`, {
      host: `localhost:${app.config.port}`,
    });
    try {
      expect((await client.hello()).type).toBe('welcome');
      // Deutlich länger still als beide Grenzen
      await sleep(1200);
      expect(client.closeCode).toBeNull();
      client.send({ type: 'ping' });
      expect((await client.next((m) => m.type === 'pong')).type).toBe('pong');
    } finally {
      client.close();
    }
  });
});

const lan = networkAddress();

describe.skipIf(!lan)('Obergrenze offener Verbindungen aus dem Netz', () => {
  let app: SyncTestApp;
  const sockets: Socket[] = [];
  beforeAll(async () => {
    Object.assign(connectionLimits, { maxPerSource: 3, maxNetwork: 256 });
    app = await startSyncApp({ host: '0.0.0.0' });
  });
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy();
    connectionLimits.maxPerSource = 3;
    connectionLimits.maxNetwork = 256;
    // Der Server zählt erst nach seinem `close` herunter
    await sleep(100);
  });
  afterAll(async () => {
    restoreLimits();
    await app.close();
  });

  async function open(host: string) {
    const conn = await openSocket(host, app.port);
    sockets.push(conn.socket);
    return conn;
  }

  it('je Quelle höchstens maxPerSource, Loopback ist ausgenommen, ein freier Platz wird wieder vergeben', async () => {
    const allowed = [await open(lan!), await open(lan!), await open(lan!)];
    const extra = await open(lan!);
    await waitFor(extra.closed, 2000, 'Schließen der überzähligen Verbindung');
    // Loopback zählt nicht mit, auch weit über der Grenze
    const local = await Promise.all(Array.from({ length: 6 }, () => open('127.0.0.1')));
    await sleep(200);
    expect(allowed.map((c) => c.closed())).toEqual([false, false, false]);
    expect(local.some((c) => c.closed())).toBe(false);

    // Wird eine Verbindung frei, bekommt die Quelle wieder einen Platz
    allowed[0]!.socket.destroy();
    await waitFor(allowed[0]!.closed, 2000, 'Schließen');
    await sleep(50);
    const again = await open(lan!);
    await sleep(200);
    expect(again.closed()).toBe(false);
  });

  it('auch eine normale Anfrage aus dem Netz geht innerhalb der Grenze weiter (401 ohne Token)', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      // Ohne Keep-Alive, damit die Verbindung den nächsten Test nicht mitzählt
      const req = httpRequest({
        host: lan!,
        port: app.port,
        path: `${API}/health`,
        agent: false,
        headers: { host: `${lan}:${app.port}`, connection: 'close' },
      });
      req.on('response', (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(401);
  });

  it('maxNetwork begrenzt alle Netzverbindungen zusammen', async () => {
    connectionLimits.maxPerSource = 100;
    connectionLimits.maxNetwork = 2;
    const allowed = [await open(lan!), await open(lan!)];
    const extra = await open(lan!);
    await waitFor(extra.closed, 2000, 'Schließen über maxNetwork');
    expect(allowed.map((c) => c.closed())).toEqual([false, false]);
  });
});
