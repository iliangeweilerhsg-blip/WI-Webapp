// Fake-Sync-Server für die Client-Tests (der echte Server T1-08 existiert noch nicht).
// Hält Ströme mit lückenlosen seq, beantwortet hello/subscribe nach der Resume-Tabelle (VERTRAEGE §11.1).
import type { WebSocketLike } from '../src/lib/sync/client.ts';

export const uid = (n: number): string => `019a4e14-0000-7000-8000-${String(n).padStart(12, '0')}`;
export const nbStream = (n: number): string => `notebook:${uid(n)}`;
export const sessStream = (n: number): string => `session:${uid(n)}`;

type Msg = Record<string, unknown>;

export class FakeSocket implements WebSocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  received: Msg[] = [];
  closedByClient: number | null = null;
  private readonly server: FakeServer;

  constructor(server: FakeServer) {
    this.server = server;
  }

  send(data: string): void {
    const msg = JSON.parse(data) as Msg;
    this.received.push(msg);
    queueMicrotask(() => this.server.onClientMessage(this, msg));
  }

  close(code = 1000): void {
    this.closedByClient = code;
    this.readyState = 3;
  }

  // Server-Seite
  push(msg: unknown): void {
    queueMicrotask(() => this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) }));
  }

  serverClose(code: number): void {
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code }));
  }

  open(): void {
    this.readyState = 1;
    queueMicrotask(() => this.onopen?.({}));
  }

  /** Gesendete Nachrichten eines Typs. */
  of(type: string): Msg[] {
    return this.received.filter((m) => m.type === type);
  }
}

export interface StoredOp {
  op_id: string;
  seq: number;
  stream: string;
  msg: Msg;
}

export type OpDecision =
  | { ack: true }
  | { error: { code: string; retryable: boolean; fatal: boolean; details?: Msg }; close?: number }
  | { ignore: true };

export class FakeServer {
  sockets: FakeSocket[] = [];
  streams = new Map<string, StoredOp[]>();
  dbEpoch = uid(9000);
  skewMs = 0;
  /** Antwortet auf nichts (Keepalive-Test) */
  mute = false;
  /** Entscheidet je Operation; Standard: bestätigen. */
  decide: (op: Msg, socket: FakeSocket) => OpDecision = () => ({ ack: true });
  /** Empfangene Operationen (op_id) in Reihenfolge, über alle Verbindungen */
  opLog: string[] = [];
  /** Eingeschleuste Nachrichten direkt nach `welcome` (z. B. fremde Operationen) */
  afterWelcome: ((socket: FakeSocket) => void) | null = null;

  factory = (): FakeSocket => {
    const s = new FakeSocket(this);
    this.sockets.push(s);
    s.open();
    return s;
  };

  get last(): FakeSocket {
    const s = this.sockets[this.sockets.length - 1];
    if (!s) throw new Error('keine Verbindung');
    return s;
  }

  head(stream: string): number {
    return this.streams.get(stream)?.length ?? 0;
  }

  /** Legt eine fremde Operation im Strom ab (seq = nächste) und liefert sie. */
  addForeign(stream: string, kind: string, extra: Msg = {}): Msg {
    const list = this.streams.get(stream) ?? [];
    const seq = list.length + 1;
    const op_id = uid(5000 + Math.floor(Math.random() * 1e6));
    const msg: Msg = {
      type: 'op',
      op_id,
      stream,
      kind,
      at: 1762240000000,
      clock_uncertain: false,
      data: {},
      seq,
      origin: 'ipad',
      ...extra,
    };
    list.push({ op_id, seq, stream, msg });
    this.streams.set(stream, list);
    return msg;
  }

  private resume(positions: Msg[]): Msg[] {
    return positions.map((p) => {
      const stream = p.stream as string;
      const n = p.last_seq as number;
      const x = p.last_op_id as string | null;
      const list = this.streams.get(stream) ?? [];
      const head = list.length;
      if (n === 0) return { stream, from_seq: 1, head_seq: head, reset: false };
      if (head < n || list[n - 1]?.op_id !== x) return { stream, from_seq: 1, head_seq: head, reset: true };
      return { stream, from_seq: n + 1, head_seq: head, reset: false };
    });
  }

  private replay(socket: FakeSocket, resume: Msg[]): void {
    for (const r of resume) {
      if (r.reset) continue;
      for (const o of this.streams.get(r.stream as string) ?? []) {
        if (o.seq >= (r.from_seq as number)) socket.push(o.msg);
      }
    }
  }

  onClientMessage(socket: FakeSocket, msg: Msg): void {
    if (this.mute) return;
    switch (msg.type) {
      case 'hello': {
        const resume = this.resume(msg.streams as Msg[]);
        socket.push({
          type: 'welcome',
          protocol: 1,
          server_time: Date.now() + this.skewMs,
          server_version: 'fake',
          db_epoch: this.dbEpoch,
          device_id: null,
          resume,
        });
        this.replay(socket, resume);
        this.afterWelcome?.(socket);
        return;
      }
      case 'subscribe': {
        const resume = this.resume(msg.streams as Msg[]);
        socket.push({ type: 'subscribed', resume });
        this.replay(socket, resume);
        return;
      }
      case 'time.ping':
        socket.push({ type: 'time.pong', t0: msg.t0, ts: Date.now() + this.skewMs });
        return;
      case 'ping':
        socket.push({ type: 'pong' });
        return;
      case 'op':
        this.onOp(socket, msg);
        return;
      default:
        return;
    }
  }

  private onOp(socket: FakeSocket, op: Msg): void {
    const op_id = op.op_id as string;
    const stream = op.stream as string;
    this.opLog.push(op_id);
    const d = this.decide(op, socket);
    if ('ignore' in d) return;
    if ('error' in d) {
      socket.push({ type: 'error', message: d.error.code, op_id, stream, ...d.error });
      if (d.close !== undefined) socket.serverClose(d.close);
      return;
    }
    const list = this.streams.get(stream) ?? [];
    let stored = list.find((o) => o.op_id === op_id);
    if (!stored) {
      stored = { op_id, seq: list.length + 1, stream, msg: { ...op, seq: list.length + 1, origin: 'web' } };
      list.push(stored);
      this.streams.set(stream, list);
    }
    socket.push({ type: 'ack', op_id, stream, seq: stored.seq });
  }
}
