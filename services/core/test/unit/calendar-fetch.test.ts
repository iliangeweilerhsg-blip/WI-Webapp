// ICS-URL-Abruf: Grenzen und Schutz vor Abrufen ins lokale Netz (SSRF, VERTRAEGE §8)
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fetchIcs,
  IcsFetchError,
  InvalidIcsUrlError,
  isPublicAddress,
  normalizeIcsUrl,
} from '../../src/services/calendar-fetch.ts';

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.168.178.20',
    '169.254.169.254', // Cloud-Metadaten
    '100.64.0.1',
    '0.0.0.0',
    '0.1.2.3',
    '192.0.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456:789a::1',
    'ff02::1',
    '::ffff:127.0.0.1', // IPv4 in IPv6
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '64:ff9b::7f00:1', // NAT64 auf 127.0.0.1
    '2002:7f00:1::1', // 6to4 auf 127.0.0.1
    '2001:db8::1',
    'nicht-eine-adresse',
    '',
  ])('%s ist nicht erlaubt', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.0.1',
    '2606:4700:4700::1111',
    '2a00:1450:4001::200e',
  ])('%s ist erlaubt', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe('normalizeIcsUrl', () => {
  it('webcal:// wird https://', () => {
    expect(normalizeIcsUrl('webcal://uni.example.edu/plan.ics').toString()).toBe(
      'https://uni.example.edu/plan.ics',
    );
    expect(normalizeIcsUrl('WEBCAL://uni.example.edu/plan.ics?x=1#frag').toString()).toBe(
      'https://uni.example.edu/plan.ics?x=1',
    );
  });

  it('http und https bleiben', () => {
    expect(normalizeIcsUrl(' https://uni.example.edu/a.ics ').protocol).toBe('https:');
    expect(normalizeIcsUrl('http://uni.example.edu/a.ics').protocol).toBe('http:');
  });

  it.each([
    'file:///etc/passwd',
    'ftp://uni.example.edu/a.ics',
    'gopher://uni.example.edu/',
    'javascript:alert(1)',
    'data:text/calendar,BEGIN:VCALENDAR',
    'https://user:geheim@uni.example.edu/a.ics',
    'nur text',
    'https://',
  ])('%s wird abgelehnt', (raw) => {
    expect(() => normalizeIcsUrl(raw)).toThrow(InvalidIcsUrlError);
  });

  it('IP-Schreibweisen werden vom URL-Parser vereinheitlicht, bevor wir prüfen', () => {
    expect(normalizeIcsUrl('http://2130706433/').hostname).toBe('127.0.0.1');
    expect(normalizeIcsUrl('http://0x7f.1/').hostname).toBe('127.0.0.1');
    expect(normalizeIcsUrl('http://0177.0.0.1/').hostname).toBe('127.0.0.1');
  });
});

// ---------------------------------------------------------------------------------------------
// Abruf gegen einen lokalen Server. Der Standard verbietet Loopback, darum erlaubt `allowLocal` hier 127.0.0.1.
// ---------------------------------------------------------------------------------------------

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let server: Server;
let base: string;
let handler: Handler = () => {};

beforeAll(async () => {
  server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const allowLocal = (address: string) => address === '127.0.0.1';

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(IcsFetchError);
    return (error as IcsFetchError).reason;
  }
  throw new Error('Es hätte scheitern müssen');
}

describe('fetchIcs: Abruf', () => {
  it('lädt den Text', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/calendar' });
      res.end(ICS);
    };
    expect(await fetchIcs(`${base}/plan.ics`, { addressPolicy: allowLocal })).toBe(ICS);
  });

  it('entpackt gzip, wenn der Server es trotz Accept-Encoding: identity schickt', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-encoding': 'gzip' });
      res.end(gzipSync(ICS));
    };
    expect(await fetchIcs(`${base}/`, { addressPolicy: allowLocal })).toBe(ICS);
  });

  it('eine gzip-Bombe scheitert mit too_large', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-encoding': 'gzip' });
      res.end(gzipSync(Buffer.alloc(2 * 1024 * 1024, 'a')));
    };
    expect(await reason(fetchIcs(`${base}/`, { addressPolicy: allowLocal, maxBytes: 100_000 }))).toBe(
      'too_large',
    );
  });

  it('fremde Kodierungen werden abgelehnt', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-encoding': 'br' });
      res.end('x');
    };
    expect(await reason(fetchIcs(`${base}/`, { addressPolicy: allowLocal }))).toBe('unsupported_encoding');
  });

  it('sendet Accept-Encoding: identity und keinen Cookie-Header', async () => {
    let seen: IncomingMessage['headers'] = {};
    handler = (req, res) => {
      seen = req.headers;
      res.end(ICS);
    };
    await fetchIcs(`${base}/`, { addressPolicy: allowLocal });
    expect(seen['accept-encoding']).toBe('identity');
    expect(seen.cookie).toBeUndefined();
  });
});

describe('fetchIcs: Grenzen (502 ics_fetch_failed, details.reason)', () => {
  it('Größe: Content-Length über dem Limit', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-length': String(6 * 1024 * 1024) });
      res.write('x');
    };
    expect(await reason(fetchIcs(`${base}/`, { addressPolicy: allowLocal }))).toBe('too_large');
  });

  it('Größe: ohne Content-Length (chunked) wird beim Überschreiten abgebrochen', async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      const chunk = Buffer.alloc(64 * 1024, 'a');
      const timer = setInterval(() => {
        if (res.destroyed) return clearInterval(timer);
        res.write(chunk);
      }, 1);
      res.on('close', () => clearInterval(timer));
    };
    expect(await reason(fetchIcs(`${base}/`, { addressPolicy: allowLocal, maxBytes: 200_000 }))).toBe(
      'too_large',
    );
  });

  it('Größe: genau am Limit geht noch', async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      res.end(Buffer.alloc(1000, 'a'));
    };
    expect(await fetchIcs(`${base}/`, { addressPolicy: allowLocal, maxBytes: 1000 })).toHaveLength(1000);
  });

  it('Zeit: ein Server, der nicht antwortet, endet mit timeout', async () => {
    handler = () => {};
    const started = Date.now();
    expect(await reason(fetchIcs(`${base}/`, { addressPolicy: allowLocal, timeoutMs: 200 }))).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('Zeit: ein Server, der tröpfelt, endet mit timeout (Gesamtzeit)', async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      const timer = setInterval(() => res.write('a'), 50);
      res.on('close', () => clearInterval(timer));
    };
    expect(await reason(fetchIcs(`${base}/`, { addressPolicy: allowLocal, timeoutMs: 300 }))).toBe('timeout');
  });

  it('Status: 404 und 500', async () => {
    handler = (_req, res) => {
      res.writeHead(404);
      res.end('nein');
    };
    expect(await reason(fetchIcs(`${base}/`, { addressPolicy: allowLocal }))).toBe('status_404');
    handler = (_req, res) => {
      res.writeHead(500);
      res.end();
    };
    expect(await reason(fetchIcs(`${base}/`, { addressPolicy: allowLocal }))).toBe('status_500');
  });

  it('Weiterleitungen: bis zu drei werden verfolgt, die vierte nicht', async () => {
    handler = (req, res) => {
      const hop = Number(new URL(req.url ?? '/', base).searchParams.get('hop') ?? '0');
      if (hop < 3) {
        res.writeHead(302, { location: `/?hop=${hop + 1}` });
        res.end();
      } else {
        res.end(ICS);
      }
    };
    expect(await fetchIcs(`${base}/`, { addressPolicy: allowLocal })).toBe(ICS);
    handler = (req, res) => {
      const hop = Number(new URL(req.url ?? '/', base).searchParams.get('hop') ?? '0');
      res.writeHead(302, { location: `/?hop=${hop + 1}` });
      res.end();
    };
    expect(await reason(fetchIcs(`${base}/`, { addressPolicy: allowLocal }))).toBe('too_many_redirects');
  });

  it('Weiterleitungen: Endlosschleife endet', async () => {
    handler = (_req, res) => {
      res.writeHead(301, { location: '/' });
      res.end();
    };
    expect(await reason(fetchIcs(`${base}/`, { addressPolicy: allowLocal }))).toBe('too_many_redirects');
  });

  it('Weiterleitungen: nur auf http/https', async () => {
    for (const target of [
      'file:///etc/passwd',
      'ftp://example.com/x',
      'gopher://127.0.0.1/',
      'webcal://example.com/x',
    ]) {
      handler = (_req, res) => {
        res.writeHead(302, { location: target });
        res.end();
      };
      expect(await reason(fetchIcs(`${base}/`, { addressPolicy: allowLocal })), target).toBe('invalid_url');
    }
  });

  it('Weiterleitungen: Zugangsdaten im Ziel werden abgelehnt', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: 'http://a:b@127.0.0.1/' });
      res.end();
    };
    expect(await reason(fetchIcs(`${base}/`, { addressPolicy: allowLocal }))).toBe('invalid_url');
  });

  it('Weiterleitung ohne Ziel', async () => {
    handler = (_req, res) => {
      res.writeHead(302);
      res.end();
    };
    expect(await reason(fetchIcs(`${base}/`, { addressPolicy: allowLocal }))).toBe('status_302');
  });

  it('nicht erreichbar: network_error', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expect(await reason(fetchIcs(`http://127.0.0.1:${port}/`, { addressPolicy: allowLocal }))).toBe(
      'network_error',
    );
  });
});

describe('fetchIcs: Schutz vor Abrufen ins lokale Netz (SSRF)', () => {
  let hits = 0;
  beforeAll(() => {
    handler = (_req, res) => {
      hits += 1;
      res.end(ICS);
    };
  });

  it('der Standard verbietet Loopback, auch wenn dort ein Server antwortet', async () => {
    hits = 0;
    handler = (_req, res) => {
      hits += 1;
      res.end(ICS);
    };
    expect(await reason(fetchIcs(`${base}/plan.ics`))).toBe('blocked_address');
    expect(hits).toBe(0);
  });

  it.each([
    'http://127.0.0.1/',
    'http://127.0.0.1:5432/',
    'http://[::1]/',
    'http://localhost/',
    'http://localhost:4710/api/v1/health',
    'http://0.0.0.0/',
    'http://10.0.0.5/plan.ics',
    'http://192.168.1.1/',
    'http://172.16.5.5/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[fe80::1]/',
    'http://[fd00::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:a00:1]/',
    'http://2130706433/', // 127.0.0.1 als Zahl
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://127.1/',
    'https://127.0.0.1/',
    'webcal://127.0.0.1/plan.ics',
  ])('%s wird nicht abgerufen', async (url) => {
    expect(await reason(fetchIcs(url, { timeoutMs: 3000 }))).toBe('blocked_address');
  });

  it('Weiterleitung auf eine private Adresse wird gestoppt, auch wenn der erste Schritt erlaubt war', async () => {
    hits = 0;
    handler = (req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: base.replace('127.0.0.1', '127.0.0.2') + '/geheim' });
        res.end();
      } else {
        hits += 1;
        res.end('geheim');
      }
    };
    expect(await reason(fetchIcs(`${base}/start`, { addressPolicy: allowLocal }))).toBe('blocked_address');
    expect(hits).toBe(0);
  });

  it('Weiterleitung auf eine IP-Adresse im lokalen Netz wird gestoppt', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    };
    expect(await reason(fetchIcs(`${base}/`, { addressPolicy: allowLocal }))).toBe('blocked_address');
  });

  it('ein Hostname, der auf Loopback zeigt, wird nach der DNS-Auflösung gestoppt', async () => {
    // localhost löst zu 127.0.0.1 bzw. ::1 auf: die Sperre greift bei der Verbindung, nicht am Namen
    expect(await reason(fetchIcs(`http://localhost:${new URL(base).port}/`, { timeoutMs: 3000 }))).toBe(
      'blocked_address',
    );
  });
});
