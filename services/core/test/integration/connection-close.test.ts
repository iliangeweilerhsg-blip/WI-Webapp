// H-1 aus #191: Antworten 400/403/413/415/429 an Netzverbindungen ohne gültiges Token schließen die Verbindung.
// Mit echten Sockets: geprüft wird, ob der Server den Socket tatsächlich schließt, nicht nur der Header.
import { connect, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectionLimits } from '../../src/app.ts';
import { closesTokenlessResponse } from '../../src/plugins/security.ts';
import { sleep, startSyncApp, waitFor, type SyncTestApp } from './sync-helpers.ts';

const API = '/api/v1';
const TOKEN = 'geraete-token-h1';
const DEVICE_ID = '019a0000-0000-7000-8000-000000000001';
/** Netzadressen (nicht 127.0.0.1, das als lokal gilt) */
const NET = '127.0.0.21';
const NET_WITH_TOKEN = '127.0.0.22';
const original = { ...connectionLimits };

describe('closesTokenlessResponse (Regel)', () => {
  const net = { local: false, device: undefined };
  it('Netz ohne Token: 400, 403, 413, 415, 429 schließen; 200, 201, 404, 409, 423 nicht', () => {
    for (const statusCode of [400, 403, 413, 415, 429]) {
      expect(closesTokenlessResponse({ ...net, statusCode })).toBe(true);
    }
    for (const statusCode of [200, 201, 404, 409, 423]) {
      expect(closesTokenlessResponse({ ...net, statusCode })).toBe(false);
    }
  });
  it('lokal (null) und mit Token: nie', () => {
    expect(closesTokenlessResponse({ local: true, device: null, statusCode: 400 })).toBe(false);
    expect(closesTokenlessResponse({ local: false, device: { deviceId: 'x' }, statusCode: 429 })).toBe(false);
  });
});

describe('Connection: close für Netzverbindungen ohne Token (H-1)', () => {
  let app: SyncTestApp;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    app = await startSyncApp({
      extra: {
        verifyDeviceToken: async (token) => (token === TOKEN ? { deviceId: DEVICE_ID } : null),
      },
    });
  });
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy();
    Object.assign(connectionLimits, original);
    await app.close();
  });

  async function open(localAddress: string) {
    const socket = connect({ host: '127.0.0.1', port: app.port, localAddress });
    sockets.push(socket);
    let closed = false;
    let data = '';
    socket.on('close', () => (closed = true));
    socket.on('error', () => {});
    socket.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', reject);
    });
    return { socket, closed: () => closed, data: () => data };
  }

  /** POST pair/start mit einem Body, der die Validierung nicht besteht → 400 */
  function badPairStart(host: string, token?: string): string {
    const body = '{"kind":"toaster"}';
    return (
      `POST ${API}/devices/pair/start HTTP/1.1\r\nHost: ${host}\r\n` +
      `Content-Type: application/json\r\nContent-Length: ${body.length}\r\n` +
      (token ? `Authorization: Bearer ${token}\r\n` : '') +
      `\r\n${body}`
    );
  }

  /** Gültiges pair/start: zählt gegen das Rate-Limit (die Validierung läuft vor dem Handler und zählt nicht) */
  function validPairStart(host: string): string {
    const body = JSON.stringify({ device_name: 'iPad', kind: 'ipad', public_nonce: 'a'.repeat(30) });
    return (
      `POST ${API}/devices/pair/start HTTP/1.1\r\nHost: ${host}\r\n` +
      `Content-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`
    );
  }

  it('Netz, kein Token, 400: Header gesetzt und Socket zu', async () => {
    const conn = await open(NET);
    conn.socket.write(badPairStart(`127.0.0.1:${app.port}`));
    await waitFor(conn.closed, 3000, 'Schließen nach 400');
    expect(conn.data().startsWith('HTTP/1.1 400')).toBe(true);
    expect(conn.data().toLowerCase()).toContain('connection: close');
  });

  it('Netz, kein Token, 415 (ohne Content-Type, zählt nicht gegen das Rate-Limit): Socket zu', async () => {
    const conn = await open(NET);
    const body = 'x';
    conn.socket.write(
      `POST ${API}/devices/pair/start HTTP/1.1\r\nHost: 127.0.0.1:${app.port}\r\n` +
        `Content-Length: ${body.length}\r\n\r\n${body}`,
    );
    await waitFor(conn.closed, 3000, 'Schließen nach 415');
    expect(conn.data().startsWith('HTTP/1.1 415')).toBe(true);
    expect(conn.data().toLowerCase()).toContain('connection: close');
  });

  it('Netz, kein Token, 429 (Rate-Limit): Header gesetzt und Socket zu', async () => {
    // Das Limit (10 pro Minute und Adresse) zählt nur gültige Anfragen. Ohne offenes Fenster sind das 409
    // (`pairing_window_closed`), die die Verbindung offen halten; erst die 11. bekommt 429 und schließt
    const conn = await open(NET);
    for (let i = 0; i < 10; i++) {
      const before = conn.data().length;
      conn.socket.write(validPairStart(`127.0.0.1:${app.port}`));
      await waitFor(() => conn.data().length > before && conn.data().endsWith('}'), 3000, 'Antwort');
      expect(conn.closed()).toBe(false);
    }
    conn.socket.write(validPairStart(`127.0.0.1:${app.port}`));
    await waitFor(conn.closed, 3000, 'Schließen nach 429');
    const last = conn.data().slice(conn.data().lastIndexOf('HTTP/1.1 '));
    expect(last.startsWith('HTTP/1.1 429')).toBe(true);
    expect(last.toLowerCase()).toContain('connection: close');
  });

  it('Netz, gültiges Token, 400: Socket bleibt offen, Folgeanfrage geht', async () => {
    const conn = await open(NET_WITH_TOKEN);
    const body = '{}';
    conn.socket.write(
      `POST ${API}/notebooks HTTP/1.1\r\nHost: 127.0.0.1:${app.port}\r\n` +
        `Authorization: Bearer ${TOKEN}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
    );
    await waitFor(() => conn.data().startsWith('HTTP/1.1 400'), 3000, '400');
    await sleep(150);
    expect(conn.closed()).toBe(false);
    expect(conn.data().toLowerCase()).not.toContain('connection: close');
    conn.socket.write(
      `GET ${API}/health HTTP/1.1\r\nHost: 127.0.0.1:${app.port}\r\nAuthorization: Bearer ${TOKEN}\r\n\r\n`,
    );
    await waitFor(() => conn.data().includes('HTTP/1.1 200'), 3000, 'zweite Antwort');
    expect(conn.closed()).toBe(false);
  });

  it('lokal (Loopback), kein Token, 400: Socket bleibt offen', async () => {
    const conn = await open('127.0.0.1');
    conn.socket.write(badPairStart(`localhost:${app.port}`));
    await waitFor(() => conn.data().startsWith('HTTP/1.1 4'), 3000, 'Antwort');
    await sleep(150);
    expect(conn.closed()).toBe(false);
    expect(conn.data().toLowerCase()).not.toContain('connection: close');
  });

  it('Netz, kein Token, unbekannter Pfad: ist 401 (Wächter, schließt schon), kein 404', async () => {
    const conn = await open(NET);
    conn.socket.write(`GET ${API}/gibt-es-nicht HTTP/1.1\r\nHost: 127.0.0.1:${app.port}\r\n\r\n`);
    await waitFor(conn.closed, 3000, 'Schließen');
    expect(conn.data().startsWith('HTTP/1.1 401')).toBe(true);
  });
});
