import { describe, expect, it } from 'vitest';
import { HttpError } from '../../src/errors.ts';
import { fileRefFromUrl, flattenParams, isValidFileRef, MoodleClient } from '../../src/moodle/client.ts';
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
    await expect(c.call('core_webservice_get_site_info')).resolves.toEqual({ sitename: 'X' });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`${FAKE_BASE}/webservice/rest/server.php`);
    expect(requests[0]?.url).not.toContain(FAKE_TOKEN);
    expect(requests[0]?.body.get('wstoken')).toBe(FAKE_TOKEN);
    expect(requests[0]?.body.get('moodlewsrestformat')).toBe('json');
  });

  it('ohne URL oder Token → 503 moodle_not_configured, ohne Anfrage', async () => {
    const { client: c, requests } = client(restHandler({}), null);
    const error = await httpError(c.call('core_webservice_get_site_info'));
    expect([error.statusCode, error.code]).toEqual([503, 'moodle_not_configured']);
    expect(requests).toHaveLength(0);

    const off = new MoodleClient({
      baseUrl: '',
      tokens: new StaticTokenStore(FAKE_TOKEN),
      fetch: fakeFetch(restHandler({})).fetch,
    });
    expect((await httpError(off.call('x'))).code).toBe('moodle_not_configured');
  });

  it('invalidtoken → 409 moodle_token_invalid und Token-Zwischenspeicher verworfen', async () => {
    const { client: c, tokens } = client(restHandler({}), 'ffffffffffffffffffffffffffffffff');
    const error = await httpError(c.call('core_webservice_get_site_info'));
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
      const error = await httpError(c.call(fn));
      expect([error.statusCode, error.code]).toEqual([501, 'moodle_function_unavailable']);
      expect(error.details).toMatchObject({ wsfunction: fn });
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
    const error = await httpError(c.call('core_course_get_contents', { courseid: 1 }));
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
    const error = await httpError(c.call('core_webservice_get_site_info'));
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
    await expect(c.call('core_enrol_get_users_courses')).resolves.toEqual([]);
    expect(calls).toBe(2);
  });

  it('schreibende Aufrufe werden nie wiederholt', async () => {
    const { client: c, requests } = client(() => new Response('kaputt', { status: 500 }));
    const error = await httpError(c.call('mod_forum_add_discussion_post', {}, { write: true }));
    expect(error.code).toBe('moodle_unreachable');
    expect(requests).toHaveLength(1);
  });

  it('Antwort ohne JSON → 502 moodle_unreachable', async () => {
    const { client: c } = client(() => new Response('<html>Wartung</html>', { status: 200 }));
    const error = await httpError(c.call('core_webservice_get_site_info'));
    expect(error.details).toEqual({ reason: 'no_json' });
  });

  it('höchstens 2 Anfragen gleichzeitig, Starts mit Mindestabstand', async () => {
    let active = 0;
    let maxActive = 0;
    let clock = 0;
    const starts: number[] = [];
    const { client: c } = client(
      async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        starts.push(clock);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return json({});
      },
      FAKE_TOKEN,
      {
        minIntervalMs: 250,
        now: () => clock,
        sleep: async (ms: number) => {
          clock += ms;
        },
      },
    );
    await Promise.all(Array.from({ length: 6 }, () => c.call('core_webservice_get_site_info')));
    expect(maxActive).toBeLessThanOrEqual(2);
    for (let i = 1; i < starts.length; i += 1) {
      expect((starts[i] ?? 0) - (starts[i - 1] ?? 0)).toBeGreaterThanOrEqual(250);
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
