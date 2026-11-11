// Nachgebauter Loopback-Endpunkt des Workers (VERTRAEGE §19.4) als echter HTTP-Server auf 127.0.0.1, für die Tests
// von T2-12. Der echte Worker (T2-11) wird parallel gebaut; die Tests hängen nicht von ihm ab.
// Dazu der Fake-Embedder aus §19.2 in TypeScript: dieselben Wörter ergeben dieselben Vektoren, so können Tests
// `search_chunk.embedding` selbst schreiben und die Anfrage über den Fake-Server einbetten.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

export const FAKE_MODEL = 'fake-embed-1';
export const DIM = 1024;

/** Fake-Embedder nach §19.2: Wörter (≥ 2 Zeichen) aus NFC + casefold, je Wort ±1 an einer Position, L2-normiert */
export function fakeEmbed(text: string): number[] {
  const vector = new Array<number>(DIM).fill(0);
  // `casefold` gibt es in JS nicht; `toLowerCase` reicht für die Testtexte
  const words = (
    text
      .normalize('NFC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((w) => [...w].length >= 2);
  for (const word of words) {
    const h = createHash('sha256').update(word, 'utf8').digest();
    const pos = h.readUInt32BE(0) % DIM;
    vector[pos]! += h[4]! % 2 === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? vector : vector.map((x) => x / norm);
}

export const newToken = (): string => randomBytes(32).toString('hex');

export type EmbedMode =
  'ok' | 'not_ready' | 'unavailable' | 'busy' | 'slow' | 'bad_schema' | 'unauthorized' | 'server_error';

export interface RecordedRequest {
  method: string;
  path: string;
  host: string | undefined;
  authorization: string | undefined;
  contentType: string | undefined;
  contentLength: string | undefined;
  body: unknown;
}

export class FakeWorker {
  readonly dataDir: string;
  /** Token, das der Server annimmt */
  token: string;
  mode: EmbedMode = 'ok';
  /** Zustand für `GET /health` */
  healthState: 'bereit' | 'laedt' | 'nicht_verfuegbar' = 'bereit';
  model = FAKE_MODEL;
  /** Feld `llm` in `GET /health` (§20.5). `undefined`: Feld fehlt (älterer Worker) */
  llm: unknown = undefined;
  /** Verzögerung von `GET /health` in ms (Zeitlimit von `GET /ai/status`) */
  healthDelayMs = 0;
  /** Verzögerung bei `mode = slow` */
  delayMs = 1500;
  /** Eigene Vektoren statt des Fakes (z. B. für exakte Ähnlichkeiten) */
  vectorFor: ((text: string) => number[]) | null = null;
  readonly requests: RecordedRequest[] = [];
  private server: Server | null = null;
  port = 0;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.token = newToken();
  }

  /** Token-Datei schreiben (wie der Worker nach dem Binden) */
  writeTokenFile(token: string = this.token): void {
    mkdirSync(join(this.dataDir, 'run'), { recursive: true, mode: 0o700 });
    writeFileSync(join(this.dataDir, 'run', 'worker.token'), token, { mode: 0o600 });
  }

  /** Worker „neu gestartet“: neues Token im Server und in der Datei */
  rotateToken(): string {
    this.token = newToken();
    this.writeTokenFile();
    return this.token;
  }

  async start(port = 0): Promise<this> {
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
    this.writeTokenFile();
    return this;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    this.requests.push({
      method: req.method ?? '',
      path: req.url ?? '',
      host: req.headers.host,
      authorization: req.headers.authorization,
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      body,
    });
    const send = (status: number, payload: unknown) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.headers.host !== `127.0.0.1:${this.port}`) return send(400, { code: 'bad_host' });
    if (req.headers.authorization !== `Bearer ${this.token}` || this.mode === 'unauthorized') {
      return send(401, { code: 'unauthorized' });
    }
    if (req.method === 'GET' && req.url === '/health') {
      if (this.healthDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.healthDelayMs));
      return send(200, {
        ...(this.llm === undefined ? {} : { llm: this.llm }),
        embedder: {
          provider: 'fake',
          model: this.model,
          dim: DIM,
          state: this.healthState,
          error: this.healthState === 'nicht_verfuegbar' ? 'Test: nicht verfügbar' : null,
        },
      });
    }
    if (req.method === 'POST' && req.url === '/embed') {
      switch (this.mode) {
        case 'not_ready':
          return send(503, { code: 'embedder_not_ready' });
        case 'unavailable':
          return send(503, { code: 'embedder_unavailable' });
        case 'busy':
          return send(503, { code: 'busy' });
        case 'server_error':
          return send(500, { code: 'kaputt' });
        case 'slow':
          await new Promise((resolve) => setTimeout(resolve, this.delayMs));
          break;
        default:
          break;
      }
      const texts = (body as { texts: string[] }).texts;
      if (this.mode === 'bad_schema') return send(200, { model: this.model, dim: 3, vectors: [[1, 2, 3]] });
      const embed = this.vectorFor ?? fakeEmbed;
      return send(200, { model: this.model, dim: DIM, vectors: texts.map((t) => embed(t)) });
    }
    return send(404, { code: 'not_found' });
  }
}
