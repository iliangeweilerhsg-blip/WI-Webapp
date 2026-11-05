// Nachgebautes Moodle als echter lokaler HTTP-Server (T1-22). Der Core spricht es über echtes fetch an,
// so laufen Weiterleitungs-, Zeitlimit-, Größen- und Streaming-Verhalten wie gegen ein echtes Moodle.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Rückgabe eines Handlers, der die Antwort schon selbst geschrieben hat */
export const HANDLED = Symbol('handled');

export type RestHandler = (params: URLSearchParams, res: ServerResponse) => unknown;
export type FileHandler = (res: ServerResponse, req: IncomingMessage) => void | Promise<void>;

export interface RecordedMoodleRequest {
  path: string;
  params: URLSearchParams;
}

export class FakeMoodleServer {
  readonly token: string;
  readonly requests: RecordedMoodleRequest[] = [];
  /** REST-Antworten je `wsfunction`: Wert (als JSON) oder Funktion */
  rest: Record<string, unknown> = {};
  /** Dateien je Verweis (Pfad hinter `webservice/pluginfile.php`) */
  files = new Map<string, FileHandler>();
  /** false = Moodle lehnt den Token ab (abgelaufen) */
  tokenValid = true;
  private server: Server | null = null;
  baseUrl = '';

  constructor(token: string) {
    this.token = token;
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;
    return this;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.server = null;
  }

  /** Anfragen an eine Moodle-Funktion bzw. an pluginfile.php */
  calls(name: string): RecordedMoodleRequest[] {
    return this.requests.filter((request) =>
      name === 'pluginfile'
        ? request.path.startsWith('/webservice/pluginfile.php/')
        : request.params.get('wsfunction') === name,
    );
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    this.requests.push({ path, params });

    if (req.method === 'POST' && path === '/webservice/rest/server.php') {
      if (params.get('wstoken') !== this.token || !this.tokenValid) {
        return sendJson(res, {
          exception: 'moodle_exception',
          errorcode: this.tokenValid ? 'invalidtoken' : 'invalidtimedtoken',
          message: 'Ungültiges Token - Token nicht gefunden',
        });
      }
      const fn = params.get('wsfunction') ?? '';
      if (!(fn in this.rest)) {
        return sendJson(res, {
          exception: 'dml_missing_record_exception',
          errorcode: 'invalidrecord',
          message: 'Der Datensatz kann nicht in der Datenbanktabelle external_functions gefunden werden.',
        });
      }
      const entry = this.rest[fn];
      const value = typeof entry === 'function' ? await (entry as RestHandler)(params, res) : entry;
      if (value === HANDLED) return;
      return sendJson(res, value);
    }

    const prefix = '/webservice/pluginfile.php';
    if (req.method === 'POST' && path.startsWith(`${prefix}/`)) {
      if (params.get('token') !== this.token || !this.tokenValid) {
        return sendJson(res, { error: 'Ungültiges Token', errorcode: 'invalidtoken' });
      }
      const handler = this.files.get(path.slice(prefix.length));
      if (!handler) return sendJson(res, { error: 'Datei nicht gefunden', errorcode: 'filenotfound' }, 404);
      return handler(res, req);
    }

    res.writeHead(404).end();
  }
}

export function sendJson(res: ServerResponse, value: unknown, status = 200): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

export interface FileReply {
  body: string | Buffer;
  contentType?: string;
  disposition?: string;
  /** false = ohne Content-Length (chunked) */
  contentLength?: number | false;
}

/** Einfache Datei-Antwort wie von pluginfile.php */
export function fileReply(reply: FileReply): FileHandler {
  return (res) => {
    const body = typeof reply.body === 'string' ? Buffer.from(reply.body) : reply.body;
    const headers: Record<string, string | number> = {
      'content-type': reply.contentType ?? 'application/pdf',
    };
    if (reply.disposition) headers['content-disposition'] = reply.disposition;
    if (reply.contentLength !== false) headers['content-length'] = reply.contentLength ?? body.length;
    res.writeHead(200, headers);
    res.end(body);
  };
}

/** Moodle-Zeitstempel (Unix-Sekunden) */
export function unix(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}
