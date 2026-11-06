// Client für den Loopback-Endpunkt des Workers (VERTRAEGE §19.4, W-04 Option A). Ticket T2-12.
//
// - Ziel ist fest `http://127.0.0.1:<SG_WORKER_PORT>`, nie `localhost` (der Name könnte auf eine andere Adresse zeigen).
// - Das Token liegt in `$SG_DATA_DIR/run/worker.token`. Es wird bei Bedarf gelesen und im Speicher gehalten. Nach einer
//   `401` wird es einmal neu gelesen und die Anfrage wiederholt (der Worker könnte neu gestartet sein).
// - Das Token steht nie in Logs oder Fehlermeldungen.
// - Eigener `http.Agent` statt `fetch`: So greift keine Proxy-Konfiguration aus der Umgebung, das Token geht nur an
//   127.0.0.1.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { Agent, request as httpRequest } from 'node:http';
import { join } from 'node:path';
import {
  EmbedResponseSchema,
  WorkerHealthSchema,
  type EmbedRequest,
  type EmbedResponse,
  type WorkerHealth,
} from '@sg/shared';

/** Standard-Port des Workers (VERTRAEGE §1) */
export const DEFAULT_WORKER_PORT = 4711;
/** Zeitlimit für `POST /embed` aus `GET /search` (§19.6 Schritt 4), gilt für den ganzen Aufruf samt Wiederholung */
export const EMBED_TIMEOUT_MS = 800;
/** Zeitlimit für `GET /health` (Nachholen, §19.5) */
export const HEALTH_TIMEOUT_MS = 2000;
/** Antworten des Workers sind klein (16 Vektoren à 1024 Zahlen ≈ 400 KB). Mehr wird nicht gelesen */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** `secrets.token_hex(32)` im Worker */
const TOKEN_RE = /^[0-9a-f]{64}$/;

/** Fehlercodes der Suche (§19.6 Schritt 4): `503 embedder_not_ready` → nicht bereit, alles andere → nicht verfügbar */
export type WorkerErrorCode = 'embedder_not_ready' | 'embedder_unavailable';

export class WorkerError extends Error {
  readonly code: WorkerErrorCode;

  constructor(code: WorkerErrorCode, message: string) {
    super(message);
    this.name = 'WorkerError';
    this.code = code;
  }
}

/** `SG_WORKER_PORT` (VERTRAEGE §1), Standard 4711. Ein ungültiger Wert fällt auf den Standard zurück */
export function workerPortFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SG_WORKER_PORT?.trim();
  if (!raw) return DEFAULT_WORKER_PORT;
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_WORKER_PORT;
}

export interface WorkerClientOptions {
  /** Datenordner (`SG_DATA_DIR`), darin `run/worker.token` */
  dataDir: string;
  /** Standard: `SG_WORKER_PORT` beim Anlegen */
  port?: number;
  embedTimeoutMs?: number;
  healthTimeoutMs?: number;
}

interface RawResponse {
  status: number;
  body: unknown;
}

/** Kein Keep-Alive: der Worker schließt Verbindungen nach 5 s, ein Neuaufbau über Loopback kostet fast nichts */
const agent = new Agent({ keepAlive: false });

export class WorkerClient {
  readonly port: number;
  private readonly tokenPath: string;
  private readonly embedTimeoutMs: number;
  private readonly healthTimeoutMs: number;
  /** Zuletzt gelesenes Token. `null`: beim nächsten Aufruf lesen */
  private token: string | null = null;

  constructor(options: WorkerClientOptions) {
    this.port = options.port ?? workerPortFromEnv();
    this.tokenPath = join(options.dataDir, 'run', 'worker.token');
    this.embedTimeoutMs = options.embedTimeoutMs ?? EMBED_TIMEOUT_MS;
    this.healthTimeoutMs = options.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
  }

  /** Vektoren für `texts` (§19.4 `POST /embed`). Wirft `WorkerError` */
  async embed(texts: string[]): Promise<EmbedResponse> {
    const body: EmbedRequest = { texts };
    const response = await this.call('POST', '/embed', body, this.embedTimeoutMs);
    if (response.status === 503) {
      const code = (response.body as { code?: unknown } | null)?.code;
      if (code === 'embedder_not_ready') {
        throw new WorkerError('embedder_not_ready', 'Der Embedder lädt noch.');
      }
      throw new WorkerError('embedder_unavailable', `Der Embedder ist nicht verfügbar (${String(code)}).`);
    }
    if (response.status !== 200) {
      throw new WorkerError('embedder_unavailable', `Unerwartete Antwort des Workers (${response.status}).`);
    }
    const parsed = EmbedResponseSchema.safeParse(response.body);
    if (!parsed.success || parsed.data.vectors.length !== texts.length) {
      throw new WorkerError('embedder_unavailable', 'Antwort des Workers passt nicht zum Schema.');
    }
    return parsed.data;
  }

  /** `GET /health` (§19.4). Wirft `WorkerError` (`embedder_unavailable`), wenn der Worker nicht antwortet */
  async health(): Promise<WorkerHealth> {
    const response = await this.call('GET', '/health', undefined, this.healthTimeoutMs);
    if (response.status !== 200) {
      throw new WorkerError('embedder_unavailable', `Unerwartete Antwort des Workers (${response.status}).`);
    }
    const parsed = WorkerHealthSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new WorkerError('embedder_unavailable', 'Antwort des Workers passt nicht zum Schema.');
    }
    return parsed.data;
  }

  /**
   * Anfrage mit Token. Nach `401` einmal das Token neu lesen und wiederholen. Das Zeitlimit gilt für alles zusammen.
   * Netzfehler, Zeitlimit und eine fehlende Token-Datei werden zu `embedder_unavailable`.
   */
  private async call(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<RawResponse> {
    const deadline = Date.now() + timeoutMs;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = attempt === 0 && this.token !== null ? this.token : await this.readToken();
      const response = await this.send(method, path, payload, token, deadline);
      if (response.status !== 401) return response;
      // Worker neu gestartet (neues Token) oder Datei veraltet: einmal neu lesen
      this.token = null;
    }
    throw new WorkerError('embedder_unavailable', 'Der Worker lehnt das Token ab.');
  }

  /** Liest das Token ohne Symlinks zu folgen. Fehlt die Datei oder hat sie ein falsches Format: `embedder_unavailable` */
  private async readToken(): Promise<string> {
    let text: string;
    try {
      const handle = await open(this.tokenPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        text = await handle.readFile({ encoding: 'utf8' });
      } finally {
        await handle.close();
      }
    } catch {
      this.token = null;
      throw new WorkerError('embedder_unavailable', 'Token-Datei des Workers fehlt oder ist nicht lesbar.');
    }
    const token = text.trim();
    if (!TOKEN_RE.test(token)) {
      this.token = null;
      throw new WorkerError('embedder_unavailable', 'Token-Datei des Workers hat ein unerwartetes Format.');
    }
    this.token = token;
    return token;
  }

  private send(
    method: 'GET' | 'POST',
    path: string,
    payload: string | undefined,
    token: string,
    deadline: number,
  ): Promise<RawResponse> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return Promise.reject(new WorkerError('embedder_unavailable', 'Zeitlimit des Workers überschritten.'));
    }
    return new Promise<RawResponse>((resolve, reject) => {
      const headers: Record<string, string | number> = {
        host: `127.0.0.1:${this.port}`,
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      };
      if (payload !== undefined) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = Buffer.byteLength(payload);
      }
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        req.destroy();
        reject(new WorkerError('embedder_unavailable', message));
      };
      const req = httpRequest({ host: '127.0.0.1', port: this.port, method, path, headers, agent }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            fail('Antwort des Workers ist zu groß.');
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', () => fail('Verbindung zum Worker abgebrochen.'));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      });
      const timer = setTimeout(() => fail('Zeitlimit des Workers überschritten.'), remaining);
      req.on('error', () => fail('Worker nicht erreichbar.'));
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }
}
