// Nachgebautes Moodle für Unit-Tests. Spricht nie mit einem echten Moodle.
import type { FetchFn } from '../../src/moodle/client.ts';

export const FAKE_BASE = 'https://moodle.example.org';
export const FAKE_TOKEN = '0123456789abcdef0123456789abcdef';

export interface RecordedRequest {
  url: string;
  body: URLSearchParams;
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
    const request = { url, body: new URLSearchParams(String(init.body ?? '')), init };
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
