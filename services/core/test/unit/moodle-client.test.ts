import { describe, expect, it } from 'vitest';
import { HttpError } from '../../src/errors.ts';
import {
  fileRefFromUrl,
  filenameFrom,
  flattenParams,
  isValidFileRef,
  MoodleClient,
  RESERVED_FIELDS,
  sanitizeFilename,
} from '../../src/moodle/client.ts';
import { StaticTokenStore } from '../../src/moodle/token-store.ts';
import { FAKE_BASE, FAKE_TOKEN, fakeFetch, json, restHandler } from './moodle-fake.ts';

const noSleep = async () => {};

function client(handler: Parameters<typeof fakeFetch>[0], token: string | null = FAKE_TOKEN, extra = {}) {
  const fake = fakeFetch(handler);
  const tokens = new StaticTokenStore(token);
  const c = new MoodleClient({
    baseUrl: FAKE_BASE,
    tokens,
    fetch: fake.fetch,
    sleep: noSleep,
    minIntervalMs: 0,
    ...extra,
  });
  return { client: c, requests: fake.requests, tokens };
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

describe('flattenParams', () => {
  it('schreibt verschachtelte Parameter wie Moodle', () => {
    expect(
      flattenParams({
        courseid: 5,
        options: [{ name: 'excludecontents', value: true }],
        nested: { a: { b: 'x' } },
        skip: null,
        missing: undefined,
        off: false,
      }),
    ).toEqual([
      ['courseid', '5'],
      ['options[0][name]', 'excludecontents'],
      ['options[0][value]', '1'],
      ['nested[a][b]', 'x'],
      ['off', '0'],
    ]);
  });
});

describe('MoodleClient.call', () => {
  it('schickt Token und Funktion im Body, nie in der URL', async () => {
    const { client: c, requests } = client(restHandler({ core_webservice_get_site_info: { sitename: 'X' } }));
    await expect(c.read('core_webservice_get_site_info')).resolves.toEqual({ sitename: 'X' });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`${FAKE_BASE}/webservice/rest/server.php`);
    expect(requests[0]?.url).not.toContain(FAKE_TOKEN);
    expect(requests[0]?.body.get('wstoken')).toBe(FAKE_TOKEN);
    expect(requests[0]?.body.get('moodlewsrestformat')).toBe('json');
  });

  it('ohne URL oder Token → 503 moodle_not_configured, ohne Anfrage', async () => {
    const { client: c, requests } = client(restHandler({}), null);
    const error = await httpError(c.read('core_webservice_get_site_info'));
    expect([error.statusCode, error.code]).toEqual([503, 'moodle_not_configured']);
    expect(requests).toHaveLength(0);

    const off = new MoodleClient({
      baseUrl: '',
      tokens: new StaticTokenStore(FAKE_TOKEN),
      fetch: fakeFetch(restHandler({})).fetch,
    });
    expect((await httpError(off.read('x'))).code).toBe('moodle_not_configured');
  });

  it('invalidtoken → 409 moodle_token_invalid und Token-Zwischenspeicher verworfen', async () => {
    const { client: c, tokens } = client(restHandler({}), 'ffffffffffffffffffffffffffffffff');
    const error = await httpError(c.read('core_webservice_get_site_info'));
    expect([error.statusCode, error.code]).toEqual([409, 'moodle_token_invalid']);
    expect(error.message).not.toContain('ffff');
    expect(tokens.invalidations).toBe(1);
  });

  it('accessexception und unbekannte Funktion → 501 moodle_function_unavailable', async () => {
    const { client: c } = client((req) =>
      req.body.get('wsfunction') === 'core_cohort_get_cohorts'
        ? json({
            exception: 'webservice_access_exception',
            errorcode: 'accessexception',
            message: 'Access Control Exception',
          })
        : restHandler({})(req),
    );
    for (const fn of ['core_cohort_get_cohorts', 'core_gibt_es_nicht']) {
      const error = await httpError(c.read(fn));
      expect([error.statusCode, error.code]).toEqual([501, 'moodle_function_unavailable']);
      expect(error.details).toMatchObject({ wsfunctions: [fn] });
    }
  });

  it('andere Moodle-Ausnahme → 502 moodle_error mit Fehlercode in details', async () => {
    const { client: c } = client(() =>
      json({
        exception: 'invalid_parameter_exception',
        errorcode: 'invalidparameter',
        message: 'Ungültiger Parameterwert',
      }),
    );
    const error = await httpError(c.read('core_course_get_contents', { courseid: 1 }));
    expect([error.statusCode, error.code]).toEqual([502, 'moodle_error']);
    expect(error.details).toEqual({
      wsfunction: 'core_course_get_contents',
      moodle_errorcode: 'invalidparameter',
      moodle_message: 'Ungültiger Parameterwert',
    });
  });

  it('lesende Aufrufe: 2 Wiederholungen bei 5xx/Netzwerk, dann 502 moodle_unreachable', async () => {
    const delays: number[] = [];
    const { client: c, requests } = client(() => new Response('kaputt', { status: 503 }), FAKE_TOKEN, {
      sleep: async (ms: number) => {
        delays.push(ms);
      },
    });
    const error = await httpError(c.read('core_webservice_get_site_info'));
    expect([error.statusCode, error.code]).toEqual([502, 'moodle_unreachable']);
    expect(requests).toHaveLength(3);
    expect(delays).toEqual([1000, 4000]);
  });

  it('Wiederholung nach Netzwerkfehler gelingt', async () => {
    let calls = 0;
    const { client: c } = client(() => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return json([]);
    });
    await expect(c.read('core_enrol_get_users_courses')).resolves.toEqual([]);
    expect(calls).toBe(2);
  });

  it('schreibende Aufrufe werden nie wiederholt', async () => {
    const { client: c, requests } = client(() => new Response('kaputt', { status: 500 }));
    const error = await httpError(c.write('mod_forum_add_discussion_post', {}));
    expect(error.code).toBe('moodle_unreachable');
    expect(requests).toHaveLength(1);
  });

  it('Antwort ohne JSON → 502 moodle_unreachable', async () => {
    const { client: c } = client(() => new Response('<html>Wartung</html>', { status: 200 }));
    const error = await httpError(c.read('core_webservice_get_site_info'));
    expect(error.details).toEqual({ reason: 'no_json' });
  });

  it('höchstens 2 Anfragen gleichzeitig, Starts mit Mindestabstand', async () => {
    // Echte Zeit: Starts im Abstand von mindestens minIntervalMs (kleine Toleranz für Timer)
    let active = 0;
    let maxActive = 0;
    const starts: number[] = [];
    const fake = fakeFetch(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      starts.push(performance.now());
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return json({});
    });
    const c = new MoodleClient({
      baseUrl: FAKE_BASE,
      tokens: new StaticTokenStore(FAKE_TOKEN),
      fetch: fake.fetch,
      minIntervalMs: 40,
    });
    await Promise.all(Array.from({ length: 6 }, () => c.read('core_webservice_get_site_info')));
    expect(fake.requests).toHaveLength(6);
    expect(maxActive).toBeLessThanOrEqual(2);
    // Der i-te Start liegt frühestens i × 40 ms nach dem ersten (Timer dürfen sich nur verspäten)
    for (let i = 1; i < starts.length; i += 1) {
      expect((starts[i] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(i * 40 - 5);
    }
  });
});

describe('Dateiverweise', () => {
  it('isValidFileRef akzeptiert Moodle-Pfade', () => {
    expect(isValidFileRef('/3789172/mod_resource/content/7/01-Einfuehrung.pdf')).toBe(true);
    expect(isValidFileRef('/12/mod_folder/content/0/Unterordner/u05.pdf')).toBe(true);
    expect(isValidFileRef('/12/mod_resource/content/1/Einf%C3%BChrung%20Teil%201.pdf')).toBe(true);
  });

  it.each([
    ['ohne Schrägstrich', '12/mod_resource/content/1/a.pdf'],
    ['zu kurz', '/12/mod_resource/a.pdf'],
    ['contextid keine Zahl', '/x/mod_resource/content/1/a.pdf'],
    ['Punkt-Punkt', '/12/mod_resource/content/../../a.pdf'],
    ['kodiertes Punkt-Punkt', '/12/mod_resource/content/%2e%2e/a.pdf'],
    ['kodierter Schrägstrich', '/12/mod_resource/content/1/a%2F..%2Fb.pdf'],
    ['Query', '/12/mod_resource/content/1/a.pdf?token=x'],
    ['Fragment', '/12/mod_resource/content/1/a.pdf#x'],
    ['Backslash', '/12/mod_resource/content/1/..\\a.pdf'],
    ['leeres Segment', '/12/mod_resource//1/a.pdf'],
    ['kaputte Kodierung', '/12/mod_resource/content/1/%E0%A4%A.pdf'],
    ['Steuerzeichen', '/12/mod_resource/content/1/a%00.pdf'],
    ['fremde Adresse', '//evil.example/x/y/z'],
  ])('lehnt ab: %s', (_label, ref) => {
    expect(isValidFileRef(ref)).toBe(false);
  });

  it('fileRefFromUrl nimmt nur Adressen der eigenen Instanz', () => {
    expect(
      fileRefFromUrl(
        FAKE_BASE,
        `${FAKE_BASE}/webservice/pluginfile.php/3789172/mod_resource/content/7/01-Einfuehrung.pdf?forcedownload=1`,
      ),
    ).toBe('/3789172/mod_resource/content/7/01-Einfuehrung.pdf');
    expect(fileRefFromUrl(FAKE_BASE, `${FAKE_BASE}/pluginfile.php/12/mod_page/content/3/bild.png`)).toBe(
      '/12/mod_page/content/3/bild.png',
    );
    expect(
      fileRefFromUrl(FAKE_BASE, 'https://evil.example/webservice/pluginfile.php/12/a/b/c.pdf'),
    ).toBeNull();
    expect(fileRefFromUrl(FAKE_BASE, `${FAKE_BASE}/mod/resource/view.php?id=1`)).toBeNull();
  });
});

describe('MoodleClient.downloadFile', () => {
  const ref = '/3789172/mod_resource/content/7/01-Einfuehrung.pdf';

  it('lädt per POST mit Token im Body und streamt die Datei', async () => {
    const { client: c, requests } = client(
      () =>
        new Response('%PDF-1.7 Inhalt', {
          status: 200,
          headers: {
            'content-type': 'application/pdf',
            'content-length': '15',
            'content-disposition': 'inline; filename="01-Einfuehrung.pdf"',
          },
        }),
    );
    const file = await c.downloadFile(ref);
    expect(requests[0]?.url).toBe(`${FAKE_BASE}/webservice/pluginfile.php${ref}`);
    expect(requests[0]?.url).not.toContain(FAKE_TOKEN);
    expect(requests[0]?.body.get('token')).toBe(FAKE_TOKEN);
    expect(file).toMatchObject({
      contentType: 'application/pdf',
      contentLength: 15,
      filename: '01-Einfuehrung.pdf',
    });
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(Buffer.from(chunk as Uint8Array));
    expect(Buffer.concat(chunks).toString()).toBe('%PDF-1.7 Inhalt');
  });

  it('ungültiger Verweis → 400 moodle_file_ref_invalid, ohne Anfrage', async () => {
    const { client: c, requests } = client(() => json({}));
    const error = await httpError(c.downloadFile('/12/mod_resource/content/../../../etc/passwd'));
    expect([error.statusCode, error.code]).toEqual([400, 'moodle_file_ref_invalid']);
    expect(requests).toHaveLength(0);
  });

  it('JSON-Fehler von pluginfile.php werden erkannt', async () => {
    const invalid = client(() => json({ error: 'Ungültiges Token', errorcode: 'invalidtoken' }));
    expect((await httpError(invalid.client.downloadFile(ref))).code).toBe('moodle_token_invalid');

    const missing = client(() => json({ error: 'Datei nicht gefunden', errorcode: 'filenotfound' }, 404));
    const error = await httpError(missing.client.downloadFile(ref));
    expect([error.statusCode, error.code]).toEqual([404, 'moodle_file_not_found']);
  });

  it('eine echte JSON-Datei wird ausgeliefert', async () => {
    const { client: c } = client(() => json({ hallo: 'welt' }));
    const file = await c.downloadFile('/12/mod_resource/content/1/daten.json');
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(Buffer.from(chunk as Uint8Array));
    expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual({ hallo: 'welt' });
  });
});

describe('Nacharbeit Review: Weiterleitungen, read/write, Zeitlimits, Downloads', () => {
  const ref = '/12/mod_resource/content/1/a.pdf';
  const timeoutError = () =>
    Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

  it('folgt keiner Weiterleitung (echter fetch, zwei lokale Server): Token erreicht das Ziel nie', async () => {
    const { createServer } = await import('node:http');
    let leaked = '';
    const evil = createServer((req, res) => {
      req.on('data', (chunk: Buffer) => (leaked += chunk.toString()));
      req.on('end', () => res.end('{}'));
    });
    await new Promise<void>((resolve) => evil.listen(0, '127.0.0.1', resolve));
    const evilPort = (evil.address() as { port: number }).port;
    const moodle = createServer((req, res) => {
      req.resume();
      res.writeHead(307, { location: `http://127.0.0.1:${evilPort}${req.url}` });
      res.end();
    });
    await new Promise<void>((resolve) => moodle.listen(0, '127.0.0.1', resolve));
    const moodlePort = (moodle.address() as { port: number }).port;
    try {
      const real = new MoodleClient({
        baseUrl: `http://127.0.0.1:${moodlePort}`,
        tokens: new StaticTokenStore(FAKE_TOKEN),
        minIntervalMs: 0,
        sleep: noSleep,
      });
      const rest = await httpError(real.read('core_webservice_get_site_info'));
      expect([rest.statusCode, rest.code, rest.details]).toEqual([
        502,
        'moodle_unreachable',
        { reason: 'redirect' },
      ]);
      const file = await httpError(real.downloadFile(ref));
      expect(file.details).toEqual({ reason: 'redirect' });
      expect(leaked).toBe('');
    } finally {
      moodle.close();
      evil.close();
    }
  });

  it('setzt redirect: manual bei REST und Datei', async () => {
    const { client: c, requests } = client(
      () => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }),
    );
    await c.read('core_webservice_get_site_info').catch(() => {});
    await c.downloadFile(ref);
    expect(requests.map((r) => r.init.redirect)).toEqual(['manual', 'manual']);
  });

  it('read() verweigert schreibende Funktionen', async () => {
    const { client: c, requests } = client(() => json({}));
    await expect(c.read('mod_assign_submit_for_grading')).rejects.toThrow(/write\(\)/);
    expect(requests).toHaveLength(0);
  });

  it('write() mit Zeitlimit: kein zweiter Versuch, Ausgang unbekannt', async () => {
    const { client: c, requests } = client(() => {
      throw timeoutError();
    });
    const error = await httpError(c.write('mod_forum_add_discussion_post', { postid: 1 }));
    expect(error.details).toEqual({ reason: 'timeout', outcome_unknown: true });
    expect(requests).toHaveLength(1);
  });

  it('Zeitlimit beim Lesen der Antwort heißt timeout, nicht network', async () => {
    const { client: c } = client(
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(timeoutError());
            },
          }),
          { status: 200 },
        ),
      FAKE_TOKEN,
      { retryDelaysMs: [] },
    );
    expect((await httpError(c.read('core_webservice_get_site_info'))).details).toEqual({ reason: 'timeout' });
  });

  it('abgelehnter Token benachrichtigt Zuhörer', async () => {
    const { client: c } = client(restHandler({}), 'ffffffffffffffffffffffffffffffff');
    let called = 0;
    c.onTokenRejected(() => (called += 1));
    await c.read('core_webservice_get_site_info').catch(() => {});
    expect(called).toBe(1);
  });

  it('Download wird bei 5xx wiederholt', async () => {
    let calls = 0;
    const { client: c } = client(() => {
      calls += 1;
      return calls < 3
        ? new Response('kaputt', { status: 502 })
        : new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } });
    });
    const file = await c.downloadFile(ref);
    file.stream.resume();
    expect(calls).toBe(3);
  });

  it('Download belegt seinen Platz, bis der Stream endet', async () => {
    const { client: c, requests } = client(
      () => new Response('%PDF-Inhalt', { status: 200, headers: { 'content-type': 'application/pdf' } }),
      FAKE_TOKEN,
      { maxConcurrent: 1 },
    );
    const first = await c.downloadFile(ref);
    const second = c.downloadFile(ref);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests).toHaveLength(1);
    for await (const chunk of first.stream) void chunk;
    const file = await second;
    expect(requests).toHaveLength(2);
    file.stream.destroy();
    // Ein zerstörter Stream gibt den Platz ebenfalls frei
    (await c.downloadFile(ref)).stream.resume();
    expect(requests).toHaveLength(3);
  });

  it('nie gelesener Stream gibt den Platz nach dem Zeitlimit frei', async () => {
    const { client: c, requests } = client(
      () => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }),
      FAKE_TOKEN,
      { maxConcurrent: 1, fileTimeoutMs: 50 },
    );
    const abandoned = await c.downloadFile(ref);
    const errors: unknown[] = [];
    abandoned.stream.on('error', (error) => errors.push(error));
    const next = c.downloadFile(ref);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests).toHaveLength(1);
    (await next).stream.resume();
    expect(requests).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });

  it('Zeitlimit ohne Fehler-Listener lässt den Prozess nicht abstürzen', async () => {
    const { client: c } = client(
      () => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }),
      FAKE_TOKEN,
      { maxConcurrent: 1, fileTimeoutMs: 20 },
    );
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on('uncaughtException', onUncaught);
    try {
      const abandoned = await c.downloadFile(ref);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(abandoned.stream.destroyed).toBe(true);
      expect(uncaught).toEqual([]);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });

  it('destroy() gibt den Platz sofort frei, auch wenn Moodle gerade nichts sendet', async () => {
    const { client: c, requests } = client(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('%PDF'));
              // danach kommt nichts mehr
            },
          }),
          { status: 200, headers: { 'content-type': 'application/pdf' } },
        ),
      FAKE_TOKEN,
      { maxConcurrent: 1 },
    );
    const first = await c.downloadFile(ref);
    first.stream.resume();
    await new Promise((resolve) => setTimeout(resolve, 10));
    first.stream.destroy();
    const second = await Promise.race([
      c.downloadFile(ref),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 200)),
    ]);
    expect(second).not.toBeNull();
    expect(requests).toHaveLength(2);
    second?.stream.destroy();
  });

  it('große JSON-Datei ohne Content-Length wird gestreamt, nicht als Fehler gelesen', async () => {
    const big = JSON.stringify({ daten: 'x'.repeat(200 * 1024) });
    const { client: c } = client(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const bytes = new TextEncoder().encode(big);
              for (let i = 0; i < bytes.length; i += 16 * 1024)
                controller.enqueue(bytes.slice(i, i + 16 * 1024));
              controller.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const file = await c.downloadFile('/12/mod_resource/content/1/gross.json');
    expect(file.contentLength).toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(Buffer.from(chunk as Uint8Array));
    expect(Buffer.concat(chunks).toString()).toBe(big);
  });
});

describe('Härtung #93: Dateiname aus Content-Disposition', () => {
  it.each([
    // [Header, erwarteter Name]
    ['attachment; filename="../../etc/passwd"', 'passwd'],
    // Im Quoted-String ist `\x` ein Escape für `x` (RFC 6266/9110 quoted-pair), kein Pfadtrenner (T1-22)
    ['attachment; filename="..\\..\\windows\\win.ini"', 'windowswin.ini'],
    ['attachment; filename="a\\b"', 'ab'],
    // Ohne Quotes ist `\` kein tchar → Header ungültig, kein Name
    ['attachment; filename=..\\..\\win.ini', null],
    ['attachment; filename="/etc/passwd"', 'passwd'],
    ["attachment; filename*=UTF-8''..%2F..%2Ftest.pdf", 'test.pdf'],
    ["attachment; filename*=UTF-8''%2e%2e%2F%2e%2e%2Fsecret.txt", 'secret.txt'],
    ["attachment; filename*=UTF-8''%2e%2e%5C%2e%2e%5Cboot.ini", 'boot.ini'],
    ["attachment; filename*=UTF-8''%2E%2E", null],
    ["attachment; filename*=UTF-8''%2e%2e%2F", null],
    ["attachment; filename*=UTF-8''bericht%0D%0ASet-Cookie%3A%20x.pdf", 'berichtSet-Cookie_ x.pdf'],
    ["attachment; filename*=UTF-8''a%00b%07c%1Fd%7F%C2%85.pdf", 'abcd.pdf'],
    ["attachment; filename*=UTF-8''rechnung%E2%80%AEfdp.exe", 'rechnungfdp.exe'],
    // Unsichtbare Zeichen (Review S3): U+2066, U+200B, U+FEFF
    ["attachment; filename*=UTF-8''a%E2%81%A6b%E2%80%8Bc%EF%BB%BF.pdf", 'abc.pdf'],
    // U+200E, U+200F, U+2067, U+2068, U+2069
    ["attachment; filename*=UTF-8''x%E2%80%8Ey%E2%80%8Fz%E2%81%A7%E2%81%A8%E2%81%A9.pdf", 'xyz.pdf'],
    // U+00AD, U+061C, U+180E, U+FFF9, U+FFFA, U+FFFB
    [
      "attachment; filename*=UTF-8''s%C2%ADo%D8%9Cf%E1%A0%8Et%EF%BF%B9w%EF%BF%BAa%EF%BF%BBre.pdf",
      'software.pdf',
    ],
    // Leerzeichen am Ende fallen weg
    ["attachment; filename*=UTF-8''a.pdf%20%20", 'a.pdf'],
    ['attachment; filename="a.pdf   "', 'a.pdf'],
    // Zeichen aus 08 §8.1 werden zu _ (Review S2): kein zweites filename= im späteren Header
    ["attachment; filename*=UTF-8''a%22%3B%20filename%3Dx.html", 'a_; filename=x.html'],
    ["attachment; filename*=UTF-8''%3C%3E%7C%3A%2A%3F%22.pdf", '_______.pdf'],
    ["attachment; filename*=UTF-8''C%3Avorlesung.pdf", 'C_vorlesung.pdf'],
    ["attachment; filename*=UTF-8''%3F", '_'],
    ['attachment; filename="..."', null],
    ['attachment; filename=". . ."', null],
    ['attachment; filename="   "', null],
    ['attachment; filename="/"', null],
    ['attachment; filename=""', null],
    ['attachment; filename=".bashrc"', 'bashrc'],
    ["attachment; filename*=UTF-8'de'Skript%20%C3%84.pdf", 'Skript Ä.pdf'],
    // filename* ist nach dem Bereinigen leer → bereinigtes filename= als Ersatz
    ['attachment; filename*=UTF-8\'\'%2e%2e; filename="ersatz.pdf"', 'ersatz.pdf'],
    ['attachment; filename*=UTF-8\'\'%2e%2e; filename="../.."', null],
    // ungültige Prozent-Kodierung → filename=, ebenfalls bereinigt
    ['attachment; filename*=UTF-8\'\'%E0%A4%A; filename="x/../y.pdf"', 'y.pdf'],
    ['inline', null],
  ])('%s → %s', (header, expected) => {
    expect(filenameFrom(header)).toBe(expected);
  });

  it('sanitizeFilename: Steuerzeichen, nur Punkte, nur Leerzeichen; normale Namen bleiben', () => {
    expect(sanitizeFilename('a\u0000\r\n\tb.pdf')).toBe('ab.pdf');
    expect(sanitizeFilename('..')).toBeNull();
    expect(sanitizeFilename('.')).toBeNull();
    expect(sanitizeFilename('....')).toBeNull();
    expect(sanitizeFilename('    ')).toBeNull();
    expect(sanitizeFilename('.\u0000.')).toBeNull();
    expect(sanitizeFilename('Übung 3 – Lösung (v2).pdf')).toBe('Übung 3 – Lösung (v2).pdf');
  });

  it('sanitizeFilename: nie " < > | : * ? im Ergebnis; ; % und Umlaute bleiben (für RFC 5987)', () => {
    const name = sanitizeFilename('a"b<c>d|e:f*g?h;i%j ä€.pdf');
    expect(name).toBe('a_b_c_d_e_f_g_h;i%j ä€.pdf');
    expect(name).not.toMatch(/["<>|:*?]/);
  });

  it('downloadFile liefert nur den bereinigten Namen', async () => {
    const { client: c } = client(
      () =>
        new Response('x', {
          status: 200,
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': "attachment; filename*=UTF-8''..%2F..%2F.ssh%2Fauthorized_keys%0A",
          },
        }),
    );
    const file = await c.downloadFile('/12/mod_forum/attachment/3/anhang.pdf');
    expect(file.filename).toBe('authorized_keys');
    file.stream.destroy();
  });

  it('downloadFile: Name nur aus Pfadanteilen → filename null', async () => {
    const { client: c } = client(
      () =>
        new Response('x', {
          status: 200,
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': "attachment; filename*=UTF-8''%2e%2e%2F%2e%2e%2F",
          },
        }),
    );
    const file = await c.downloadFile('/12/mod_forum/attachment/3/anhang.pdf');
    expect(file.filename).toBeNull();
    file.stream.destroy();
  });
});

describe('Härtung #93: reservierte Formularfelder', () => {
  it('RESERVED_FIELDS enthält genau die drei Felder aus call()', () => {
    expect([...RESERVED_FIELDS].sort()).toEqual(['moodlewsrestformat', 'wsfunction', 'wstoken']);
  });

  it.each([
    ['oben', { wstoken: 'x' }],
    ['oben, andere Schreibweise', { WSFunction: 'core_user_delete_users' }],
    ['oben, Format', { moodlewsrestformat: 'xml' }],
    ['im Unterobjekt', { options: { wstoken: 'x' } }],
    ['tief im Unterobjekt', { a: { b: { wsfunction: 'core_user_delete_users' } } }],
    ['im Array', { options: [{ name: 'x', wstoken: 'x' }] }],
    ['im Array im Array', { a: [[{ moodlewsrestformat: 'xml' }]] }],
    ['führendes Leerzeichen (PHP entfernt es)', { ' wstoken': 'x' }],
    ['Klammern im Schlüssel', { 'wstoken[0]': 'x' }],
    ['Klammer bricht die Schreibweise auf', { a: { 'b][wstoken': 'x' } }],
    ['Gleichheitszeichen und Und im Schlüssel', { 'a&wstoken=x': 1 }],
    ['leerer Schlüssel', { '': 1 }],
  ])('flattenParams weist ab: %s', (_name, params) => {
    expect(() => flattenParams(params)).toThrow(/Unzulässiger Moodle-Parameter/);
  });

  it('Fehlermeldung nennt nur den Schlüssel, nie den Wert', () => {
    let message = '';
    try {
      flattenParams({ a: { wstoken: FAKE_TOKEN } });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('"wstoken"');
    expect(message).not.toContain(FAKE_TOKEN);
  });

  it('call() mit reserviertem Feld in den Parametern schickt nichts an Moodle', async () => {
    const { client: c, requests } = client(restHandler({ core_user_get_users: [] }));
    await expect(c.read('core_user_get_users', { criteria: [{ key: 'id', wstoken: 'x' }] })).rejects.toThrow(
      /Unzulässiger Moodle-Parameter/,
    );
    await expect(
      c.write('mod_forum_add_discussion', { wsfunction: 'core_user_delete_users' }),
    ).rejects.toThrow(/Unzulässiger Moodle-Parameter/);
    expect(requests).toHaveLength(0);
  });

  it('reservierte Felder stehen genau einmal und am Ende des Bodys', async () => {
    const { client: c, requests } = client(restHandler({ core_course_get_contents: [] }));
    await c.read('core_course_get_contents', { courseid: 5, options: [{ name: 'x', value: true }] });
    const keys = [...new URLSearchParams(String(requests[0]?.init.body)).keys()];
    expect(keys.slice(-3)).toEqual(['wstoken', 'wsfunction', 'moodlewsrestformat']);
    for (const field of RESERVED_FIELDS) expect(keys.filter((k) => k === field)).toHaveLength(1);
    expect(keys.slice(0, -3)).toEqual(['courseid', 'options[0][name]', 'options[0][value]']);
  });
});

describe('Nacharbeit Review #128: unvollständiger Download', () => {
  const ref = '/12/mod_resource/content/1/a.pdf';

  it('Moodle kündigt mehr Byte an, als kommen: Stream endet mit 502 incomplete', async () => {
    const { client: c } = client(
      () =>
        new Response('abc', {
          status: 200,
          headers: { 'content-type': 'application/pdf', 'content-length': '1000' },
        }),
    );
    const file = await c.downloadFile(ref);
    const chunks: Buffer[] = [];
    const error = await httpError(
      (async () => {
        for await (const chunk of file.stream) chunks.push(Buffer.from(chunk as Uint8Array));
      })(),
    );
    expect([error.statusCode, error.code, error.details?.reason]).toEqual([
      502,
      'moodle_unreachable',
      'incomplete',
    ]);
    expect(Buffer.concat(chunks).toString()).toBe('abc');
  });

  it('leerer Body trotz Content-Length → 502 incomplete, bevor ein Stream entsteht', async () => {
    const { client: c } = client(
      () =>
        new Response('', {
          status: 200,
          headers: { 'content-type': 'application/pdf', 'content-length': '5' },
        }),
    );
    const error = await httpError(c.downloadFile(ref));
    expect([error.statusCode, error.code, error.details?.reason]).toEqual([
      502,
      'moodle_unreachable',
      'incomplete',
    ]);
  });

  it('genau angekündigte Länge endet normal', async () => {
    const { client: c } = client(
      () =>
        new Response('abc', {
          status: 200,
          headers: { 'content-type': 'application/pdf', 'content-length': '3' },
        }),
    );
    const file = await c.downloadFile(ref);
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(Buffer.from(chunk as Uint8Array));
    expect(Buffer.concat(chunks).toString()).toBe('abc');
  });
});
