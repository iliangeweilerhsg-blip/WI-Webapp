import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  statSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { hasOpenPermissions } from '../../src/config.ts';
import {
  createLogger,
  enforceLogSizeLimits,
  initialLogDay,
  loggerOptions,
  redactUrl,
  rotateLogs,
} from '../../src/logger.ts';
import { registerErrorHandler } from '../../src/plugins/errors.ts';

const DAY = 24 * 60 * 60 * 1000;

function touch(file: string, mtime: Date): void {
  writeFileSync(file, 'x');
  utimesSync(file, mtime, mtime);
}

describe('rotateLogs', () => {
  const now = new Date('2026-11-04T12:00:00Z');

  it('benennt core.log vom Vortag in core-<Tag>.log um und meldet den neuen Tag', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-log-'));
    touch(join(dir, 'core.log'), new Date(now.getTime() - DAY));
    expect(rotateLogs(dir, '2026-11-03', now)).toBe('2026-11-04');
    expect(existsSync(join(dir, 'core.log'))).toBe(false);
    expect(existsSync(join(dir, 'core-2026-11-03.log'))).toBe(true);
  });

  it('rotiert auch, wenn nach Mitternacht schon geschrieben wurde (mtime ist heute)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-log-'));
    const file = join(dir, 'core.log');
    writeFileSync(file, 'zeile von gestern\n');
    appendFileSync(file, 'zeile von heute 00:30\n');
    const afterMidnight = new Date('2026-11-04T00:30:00Z');
    utimesSync(file, afterMidnight, afterMidnight);
    expect(rotateLogs(dir, '2026-11-03', new Date('2026-11-04T00:45:00Z'))).toBe('2026-11-04');
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(join(dir, 'core-2026-11-03.log'), 'utf8')).toContain('zeile von gestern');
  });

  it('lässt die Datei des heutigen Tages in Ruhe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-log-'));
    touch(join(dir, 'core.log'), new Date(now.getTime() - 60_000));
    expect(rotateLogs(dir, '2026-11-04', now)).toBe('2026-11-04');
    expect(existsSync(join(dir, 'core.log'))).toBe(true);
  });

  it('löscht Archive, die älter als 14 Tage sind, und behält jüngere', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-log-'));
    touch(join(dir, 'core-2026-10-01.log'), new Date(now.getTime() - 34 * DAY));
    touch(join(dir, 'core-2026-10-25.log'), new Date(now.getTime() - 10 * DAY));
    touch(join(dir, 'worker.log'), new Date(now.getTime() - 99 * DAY)); // fremde Datei bleibt
    rotateLogs(dir, '2026-11-04', now);
    expect(existsSync(join(dir, 'core-2026-10-01.log'))).toBe(false);
    expect(existsSync(join(dir, 'core-2026-10-25.log'))).toBe(true);
    expect(existsSync(join(dir, 'worker.log'))).toBe(true);
  });

  it('legt den Ordner an, wenn er fehlt', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sg-core-log-')), 'logs');
    expect(rotateLogs(dir, '2026-11-04', now)).toBe('2026-11-04');
    expect(existsSync(dir)).toBe(true);
  });
});

describe('initialLogDay', () => {
  it('nimmt den mtime-Tag einer vorhandenen Datei, sonst heute', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-log-'));
    const now = new Date('2026-11-04T12:00:00Z');
    expect(initialLogDay(dir, now)).toBe('2026-11-04');
    touch(join(dir, 'core.log'), new Date('2026-11-01T08:00:00Z'));
    expect(initialLogDay(dir, now)).toBe('2026-11-01');
  });
});

describe('hasOpenPermissions', () => {
  it('erkennt .env-Dateien, die nicht 600 sind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-perm-'));
    const file = join(dir, '.env');
    writeFileSync(file, 'A=1');
    chmodSync(file, 0o600);
    expect(hasOpenPermissions(file)).toBe(false);
    chmodSync(file, 0o644);
    expect(hasOpenPermissions(file)).toBe(true);
  });
});

describe('Request-Log schwärzt geheime Query-Parameter (Issue #91)', () => {
  const SECRET = '00000000-0000-4000-8000-000000000091';

  it('redactUrl: nur geheime Namen, Rest und Reihenfolge bleiben', () => {
    expect(redactUrl('/devices/pairings?pairing_id=abc')).toBe('/devices/pairings?pairing_id=[Redacted]');
    expect(redactUrl('/x?limit=5&Token=a&code=1&cursor=z')).toBe(
      '/x?limit=5&Token=[Redacted]&code=[Redacted]&cursor=z',
    );
    expect(redactUrl('/x?pairing%5Fid=a&device_token=b')).toBe(
      '/x?pairing%5Fid=[Redacted]&device_token=[Redacted]',
    );
    expect(redactUrl('/x?pairing_id=a&pairing_id=b#f')).toBe(
      '/x?pairing_id=[Redacted]&pairing_id=[Redacted]',
    );
    expect(redactUrl('/devices')).toBe('/devices');
    expect(redactUrl('/x?')).toBe('/x?');
  });

  it('zerlegt die Query wie Fastify: Wert bis zum nächsten &, auch über # und ? hinweg (Issue #100)', () => {
    // Fastify liest hier pairing_id = „GEHEIM#frag“ bzw. „GEHEIM?x=1“: nichts davon darf stehen bleiben
    expect(redactUrl('/p?pairing_id=GEHEIM#frag')).toBe('/p?pairing_id=[Redacted]');
    expect(redactUrl('/p?pairing_id=GEHEIM?x=1&y=2')).toBe('/p?pairing_id=[Redacted]&y=2');
    expect(redactUrl('/p?x=1#&pairing_id=GEHEIM')).toBe('/p?x=1#&pairing_id=[Redacted]');
    // & im Pfad: die Query beginnt erst beim ersten ?
    expect(redactUrl('/p&a=b?pairing_id=GEHEIM')).toBe('/p&a=b?pairing_id=[Redacted]');
    // Ein zweites ? trennt nichts: Für Fastify ist das der Wert von a, kein pairing_id
    expect(redactUrl('/p?a=b?pairing_id=x')).toBe('/p?a=b?pairing_id=x');
    // Meldungstext: endet am Leerraum, mehrere URLs in einer Zeile
    expect(redactUrl('Route DELETE:/p?pairing_id=GEHEIM not found, vorher /q?token=GEHEIM2 x')).toBe(
      'Route DELETE:/p?pairing_id=[Redacted] not found, vorher /q?token=[Redacted] x',
    );
    // Ohne = und mit leerem Namen bleibt alles, wie es ist
    expect(redactUrl('/p?pairing_id&=x')).toBe('/p?pairing_id&=x');
  });

  it('die Query beginnt auch bei einem # vor dem ersten ? (find-my-way, Issue #100)', () => {
    expect(redactUrl('/p#pairing_id=GEHEIM')).toBe('/p#pairing_id=[Redacted]');
    expect(redactUrl('/p#x=1&pairing_id=GEHEIM')).toBe('/p#x=1&pairing_id=[Redacted]');
    expect(redactUrl('/p#?pairing_id=GEHEIM')).toBe('/p#?pairing_id=[Redacted]');
    expect(redactUrl('/p#a?pairing_id=GEHEIM&token=GEHEIM2')).toBe('/p#a?pairing_id=GEHEIM&token=[Redacted]');
  });

  it('zerlegt genauso wie Fastify: was Fastify als geheimen Parameter liest, ist geschwärzt (Issue #100)', async () => {
    const lines: string[] = [];
    const app = Fastify({
      loggerInstance: pino(loggerOptions({ logLevel: 'info' }), { write: (c: string) => void lines.push(c) }),
    });
    app.delete('/p', async (request) => ({ query: request.query, url: request.url }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    // Roh über TCP: inject bzw. ein HTTP-Client könnten `#` vorher abschneiden
    const send = (path: string) =>
      new Promise<{ query: Record<string, string>; url: string }>((resolve, reject) => {
        const socket = connect(port, '127.0.0.1', () =>
          socket.write(`DELETE ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`),
        );
        let data = '';
        socket.on('data', (chunk) => (data += chunk.toString('utf8')));
        socket.on('error', reject);
        socket.on('end', () => {
          const body = data.slice(data.indexOf('\r\n\r\n') + 4);
          resolve(JSON.parse(body) as { query: Record<string, string>; url: string });
        });
      });
    const cases: { path: string; secret: string | null }[] = [
      { path: `/p?pairing_id=${SECRET}`, secret: SECRET },
      { path: `/p#pairing_id=${SECRET}`, secret: SECRET },
      { path: `/p#x=1&pairing_id=${SECRET}`, secret: SECRET },
      { path: `/p#?pairing_id=${SECRET}`, secret: null }, // Fastify-Schlüssel ist `?pairing_id`
      { path: `/p?x=1#&pairing_id=${SECRET}`, secret: SECRET },
      { path: `/p?pairing_id=${SECRET}#frag`, secret: `${SECRET}#frag` },
      { path: `/p?pairing_id=${SECRET}?x=1&y=2`, secret: `${SECRET}?x=1` },
      { path: `/p#pairing_id=${SECRET}?x=1`, secret: `${SECRET}?x=1` },
    ];
    try {
      for (const { path, secret } of cases) {
        const res = await send(path);
        expect(res.url).toBe(path);
        expect(res.query.pairing_id ?? null).toBe(secret);
        if (secret !== null) {
          const redacted = redactUrl(path);
          expect(redacted).not.toContain(SECRET);
          // Auch der Rest des Werts, den Fastify liest (`#frag`, `?x=1`), ist weg
          const rest = secret.slice(SECRET.length);
          if (rest) expect(redacted).not.toContain(rest);
          expect(redacted).toContain('pairing_id=[Redacted]');
        }
      }
    } finally {
      await app.close();
    }
    const log = lines.join('');
    expect(log).toContain('incoming request');
    // Auch `?pairing_id` (kein geheimer Name für Fastify) wird geschwärzt: lieber zu viel als zu wenig
    expect(log).not.toContain(SECRET);
  });

  it('Namensgrenzen: harmlose Parameter bleiben lesbar, geheime werden geschwärzt', () => {
    for (const name of ['author', 'keyword', 'sort_key', 'session_id', 'limit', 'codec', 'tokens']) {
      expect(redactUrl(`/x?${name}=v`)).toBe(`/x?${name}=v`);
    }
    for (const name of [
      'pairing_id',
      'PAIRING_ID',
      'pairing%5Fid',
      'token',
      'access_token',
      'wstoken',
      'device-token',
      'code',
      'api_key',
      'secret',
    ]) {
      expect(redactUrl(`/x?a=1&${name}=v`)).toBe(`/x?a=1&${name}=[Redacted]`);
    }
  });

  it('printf-Argumente und Fehlerobjekte werden geschwärzt', () => {
    const lines: string[] = [];
    const logger = pino(loggerOptions({ logLevel: 'trace' }), { write: (c: string) => void lines.push(c) });
    logger.info('Route %s', '/x?pairing_id=GEHEIM1');
    logger.info({ a: 1 }, 'Route %s und %s', 'ok', '/y?token=GEHEIM2');
    logger.error(new Error('kaputt bei /z?pairing_id=GEHEIM3'));
    logger.error({ err: new Error('bei /z?access_token=GEHEIM4') }, 'Fehler');
    const log = lines.join('');
    expect(log).not.toMatch(/GEHEIM/);
    expect(log).toContain('"msg":"Route /x?pairing_id=[Redacted]"');
  });

  it('die pairing_id taucht im echten Log-Strom nicht auf (Request- und Fehlerzeilen)', async () => {
    const lines: string[] = [];
    const stream = { write: (chunk: string) => void lines.push(chunk) };
    const logger = pino(loggerOptions({ logLevel: 'trace' }), stream);
    const app = Fastify({ loggerInstance: logger });
    app.delete('/devices/pairings', async (request) => {
      request.log.info('handler');
      return {};
    });
    await app.inject({ method: 'DELETE', url: `/devices/pairings?pairing_id=${SECRET}&x=1` });
    await app.inject({ method: 'GET', url: `/unbekannt?pairing_id=${SECRET}` });
    await app.close();
    const log = lines.join('');
    expect(log).toContain('incoming request');
    expect(log).toContain('request completed');
    expect(log).not.toContain(SECRET);
    expect(log).toContain('pairing_id=[Redacted]&x=1');
  });
});

describe('Suchtexte im Request-Log werden geschwärzt (#167)', () => {
  const SEARCH = 'vertrauliche Prüfungsfrage';

  it('redactUrl: q, query und search (mit Klammer-Anhang), ähnliche Namen bleiben lesbar', () => {
    expect(redactUrl('/api/v1/search?q=abc&module_id=m1&limit=5')).toBe(
      '/api/v1/search?q=[Redacted]&module_id=m1&limit=5',
    );
    for (const name of ['q', 'Q', 'query', 'search', 'search_query', 'q[]', 'q%5B0%5D', 'q%5b%5d']) {
      expect(redactUrl(`/x?a=1&${name}=v`)).toBe(`/x?a=1&${name}=[Redacted]`);
    }
    for (const name of ['sequence', 'quality', 'qq', 'research', 'search_after', 'seq']) {
      expect(redactUrl(`/x?${name}=v`)).toBe(`/x?${name}=v`);
    }
  });

  it('im echten Log-Strom: kein Suchtext, Pfad und Statuscode bleiben', async () => {
    const lines: string[] = [];
    const app = Fastify({
      loggerInstance: pino(loggerOptions({ logLevel: 'info' }), { write: (c: string) => void lines.push(c) }),
    });
    app.get('/api/v1/search', async () => ({ items: [] }));
    const encoded = encodeURIComponent(SEARCH);
    const ok = await app.inject({ method: 'GET', url: `/api/v1/search?q=${encoded}&limit=5` });
    expect(ok.statusCode).toBe(200);
    // Auch der Not-Found-Weg („Route GET:/…?q=… not found“) und Klammer- bzw. Großschreibung
    await app.inject({ method: 'GET', url: `/api/v1/suche?q=${encoded}` });
    await app.inject({ method: 'GET', url: `/api/v1/search?q[]=${encoded}&Q=${encoded}` });
    await app.close();
    const log = lines.join('');
    expect(log).toContain('incoming request');
    expect(log).not.toContain(encoded);
    expect(log).not.toContain(SEARCH);
    expect(log).not.toContain('Pr%C3%BCfungsfrage');
    expect(log).toContain('"url":"/api/v1/search?q=[Redacted]&limit=5"');
    expect(log).toContain('"statusCode":200');
    expect(log).toContain('"statusCode":404');
  });

  it('500 nach DB-Fehler: die Parameter der Abfrage (Suchtext) stehen nicht im Log, auch nicht in cause', async () => {
    const lines: string[] = [];
    const app = Fastify({
      loggerInstance: pino(loggerOptions({ logLevel: 'info' }), {
        write: (c: string) => void lines.push(c),
      }) as FastifyBaseLogger,
    });
    registerErrorHandler(app);
    const timeout = new Error('canceling statement due to statement timeout');
    app.get('/api/v1/search', async (request) => {
      const q = (request.query as { q: string }).q;
      // Wie search.ts: `to_tsquery(…, $1)` mit dem Suchtext; Drizzle hängt ihn an Meldung und Feld `params`
      throw new DrizzleQueryError(`select … to_tsquery('german'::regconfig, $1)`, [`${q}:*`, q], timeout);
    });
    app.get('/api/v1/wrapped', async () => {
      throw new Error('Transaktion fehlgeschlagen', {
        cause: new DrizzleQueryError('insert … values ($1)', [SEARCH], timeout),
      });
    });
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/search?q=${encodeURIComponent(SEARCH)}` })).statusCode,
    ).toBe(500);
    expect((await app.inject({ method: 'GET', url: '/api/v1/wrapped' })).statusCode).toBe(500);
    await app.close();
    const log = lines.join('');
    expect(log).not.toContain('Prüfungsfrage');
    const errors = lines.map((l) => JSON.parse(l) as { err?: Record<string, unknown> }).filter((l) => l.err);
    expect(errors).toHaveLength(2);
    // Die Abfrage selbst und der Grund bleiben lesbar
    expect(errors[0]!.err!.message).toBe(
      `Failed query: select … to_tsquery('german'::regconfig, $1)\nparams: [Redacted]: canceling statement due to statement timeout`,
    );
    expect(errors[0]!.err!.params).toBe('[Redacted]');
    expect(errors[0]!.err!.query).toContain('to_tsquery');
    expect(String(errors[1]!.err!.stack)).toContain('params: [Redacted]');
  });
});

describe('Log-Schwärzung Moodle-Token (08 §9.1)', () => {
  it('schwärzt wstoken und token, auch eine Ebene tiefer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-log-'));
    const logger = createLogger({ dataDir: dir, logLevel: 'info' });
    logger.info({ wstoken: 'geheim-eins', token: 'geheim-zwei', req: { token: 'geheim-drei' } }, 'test');
    const text = readFileSync(join(dir, 'logs', 'core.log'), 'utf8');
    expect(text).toContain('[Redacted]');
    expect(text).not.toMatch(/geheim-/);
  });
});

describe('Größengrenzen für core.log (Issue #87)', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const limits = { maxFileBytes: 1000, maxTotalBytes: 2500 };

  it('rotiert core.log ab der Dateigrenze, darunter nicht', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-log-'));
    writeFileSync(join(dir, 'core.log'), 'x'.repeat(999));
    expect(enforceLogSizeLimits(dir, limits, now)).toBe(false);
    expect(existsSync(join(dir, 'core.log'))).toBe(true);
    writeFileSync(join(dir, 'core.log'), 'x'.repeat(1000));
    expect(enforceLogSizeLimits(dir, limits, now)).toBe(true);
    expect(existsSync(join(dir, 'core.log'))).toBe(false);
    expect(existsSync(join(dir, `core-2026-11-04-${now.getTime()}.log`))).toBe(true);
  });

  it('löscht die ältesten Archive, bis die Gesamtgrenze eingehalten ist, und lässt core.log in Ruhe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-log-'));
    for (const [name, age] of [
      ['core-2026-11-01.log', 3],
      ['core-2026-11-02.log', 2],
      ['core-2026-11-03.log', 1],
    ] as const) {
      writeFileSync(join(dir, name), 'x'.repeat(900));
      utimesSync(join(dir, name), new Date(now.getTime() - age * DAY), new Date(now.getTime() - age * DAY));
    }
    writeFileSync(join(dir, 'core.log'), 'x'.repeat(500));
    writeFileSync(join(dir, 'worker.log'), 'x'.repeat(5000)); // fremde Datei zählt nicht
    expect(enforceLogSizeLimits(dir, limits, now)).toBe(false);
    // 3 x 900 + 500 = 3200 > 2500: das älteste Archiv geht, dann sind es 2300
    expect(existsSync(join(dir, 'core-2026-11-01.log'))).toBe(false);
    expect(existsSync(join(dir, 'core-2026-11-02.log'))).toBe(true);
    expect(existsSync(join(dir, 'core-2026-11-03.log'))).toBe(true);
    expect(existsSync(join(dir, 'core.log'))).toBe(true);
    expect(existsSync(join(dir, 'worker.log'))).toBe(true);
  });

  it('createLogger hält Datei und Gesamtgröße beim Schreiben ein', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-log-'));
    const logger = createLogger(
      { dataDir: dir, logLevel: 'info' },
      { limits: { maxFileBytes: 20_000, maxTotalBytes: 60_000 } },
    );
    for (let i = 0; i < 2000; i++) logger.info({ i }, 'x'.repeat(100));
    const logs = join(dir, 'logs');
    const files = readdirSync(logs).filter((name) => /^core.*\.log$/.test(name));
    const sizes = files.map((name) => statSync(join(logs, name)).size);
    expect(files.length).toBeGreaterThan(1);
    // Je Datei höchstens Grenze plus die Prüfspanne (1/8 der Grenze), insgesamt etwa die Gesamtgrenze
    for (const size of sizes) expect(size).toBeLessThanOrEqual(20_000 * 1.25);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60_000 + 20_000 * 1.25);
  });
});
