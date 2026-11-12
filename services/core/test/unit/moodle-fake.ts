// Nachgebautes Moodle für Unit-Tests. Spricht nie mit einem echten Moodle.
import type { FetchFn } from '../../src/moodle/client.ts';

export const FAKE_BASE = 'https://moodle.example.org';
// Platzhalter im Token-Format (32 Hex-Zeichen), zur Laufzeit gebaut, damit kein Secret-Scanner anschlägt
export const FAKE_TOKEN = 'ab'.repeat(16);

export interface RecordedRequest {
  url: string;
  /** Formularfelder (urlencoded) bzw. nur die Textfelder eines multipart-Bodys. Dateien stehen in `form` */
  body: URLSearchParams;
  /** Nur bei `multipart/form-data` (`upload.php`): der `FormData`-Body samt Dateien */
  form?: FormData;
  init: RequestInit;
}

export type FakeHandler = (request: RecordedRequest) => Response | Promise<Response>;

export function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** fetch-Ersatz, der alle Anfragen aufzeichnet und an `handler` weitergibt */
export function fakeFetch(handler: FakeHandler): { fetch: FetchFn; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetch: FetchFn = async (url, init) => {
    const request: RecordedRequest =
      init.body instanceof FormData
        ? {
            url,
            // Textfelder wie bei urlencoded; Dateien nur über `form`
            body: new URLSearchParams(
              [...init.body.entries()].filter((e): e is [string, string] => typeof e[1] === 'string'),
            ),
            form: init.body,
            init,
          }
        : { url, body: new URLSearchParams(String(init.body ?? '')), init };
    requests.push(request);
    return handler(request);
  };
  return { fetch, requests };
}

/** Antwortet auf `wsfunction` mit dem passenden Eintrag, sonst wie Moodle mit `invalidrecord` */
export function restHandler(responses: Record<string, unknown>): FakeHandler {
  return ({ body }) => {
    const fn = body.get('wsfunction') ?? '';
    if (body.get('wstoken') !== FAKE_TOKEN) {
      return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Ungültiges Token' });
    }
    if (fn in responses) {
      const value = responses[fn];
      return json(typeof value === 'function' ? (value as (b: URLSearchParams) => unknown)(body) : value);
    }
    return json({
      exception: 'dml_missing_record_exception',
      errorcode: 'invalidrecord',
      message: 'Der Datensatz kann nicht in der Datenbanktabelle external_functions gefunden werden.',
    });
  };
}

export function siteInfo(functions: string[]): Record<string, unknown> {
  return {
    sitename: 'Moodle Beispiel',
    fullname: 'Erika Muster',
    userid: 4711,
    functions: functions.map((name) => ({ name, version: '2024100700' })),
  };
}

/**
 * `upload.php`: prüft das Formularfeld `token` und antwortet wie Moodle mit einem Array je Datei. Die erste Datei
 * (`itemid = 0`) bekommt `options.itemid`, weitere die gelieferte `itemid`.
 */
export function uploadHandler(options: { itemid?: number } = {}): FakeHandler {
  return ({ form }) => {
    if (!form || form.get('token') !== FAKE_TOKEN) {
      return json({ error: 'Ungültiges Token', errorcode: 'invalidtoken' });
    }
    const sent = Number(form.get('itemid'));
    const itemid = sent > 0 ? sent : (options.itemid ?? 4242);
    const file = form.get('file_1');
    return json([
      {
        component: 'user',
        filearea: 'draft',
        itemid,
        filename: typeof file === 'object' && file !== null ? (file as File).name : '',
        filepath: '/',
      },
    ]);
  };
}

/** Verteilt nach Pfad der Adresse: `upload.php` an `upload`, alles andere an `rest` */
export function byPath(rest: FakeHandler, upload: FakeHandler): FakeHandler {
  return (request) =>
    new URL(request.url).pathname.endsWith('/upload.php') ? upload(request) : rest(request);
}
