// Gemeinsamer Web-Sync-Client (VERTRAEGE §11, §16.2, Ticket T1-WS).
//
// Ein Client, eine Verbindung, eine globale Warteschlange. GitHub-unabhängig getestet gegen einen Fake-Server
// (apps/web/test/sync-fake-server.ts), weil der Server-Teil (T1-08) noch fehlt.
import {
  SyncOpSchema,
  SyncServerMessageSchema,
  SyncStreamIdSchema,
  type SyncAck,
  type SyncOp,
  type SyncServerMessage,
} from '@sg/shared';
import { uuidv7 } from '../uuid.ts';
import { correctClock, dependentsOf, isServerOnlyKind, rewriteSessionId } from './ops.ts';
import { createWebLocksLeader, type LeaderLock } from './tabs.ts';
import { createDefaultStore, MemoryQueueStore, type QueueStore } from './store.ts';
import type {
  ClientEventMap,
  ClientEventName,
  ConnectionState,
  NewShelfEntry,
  PageConflictResolver,
  QueueEntry,
  QueuedOp,
  ResetHandler,
  ResetInfo,
  SendOpInput,
  ShelfEntry,
  ShelfReasonKind,
  StreamPosition,
} from './types.ts';

/** Teilmenge von `WebSocket`, die der Client braucht (Tests liefern einen Fake). */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

const WS_OPEN = 1;

export const KEEPALIVE_PING_MS = 15_000;
export const KEEPALIVE_DEAD_MS = 45_000;
export const CLOCK_ROUNDS = 5;
export const CLOCK_RESYNC_MS = 5 * 60_000;
export const MAX_IN_FLIGHT = 200;
export const BACKOFF_START_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
export const POISON_LIMIT = 5;
export const MAX_FRAME_BYTES = 1_000_000;
const MAX_CONFLICT_RETRIES = 5;
const PONG_TIMEOUT_MS = 5_000;

export interface SyncClientOptions {
  /** `ws(s)://…/sync`. Standard: `NEXT_PUBLIC_SG_SYNC_URL`, sonst aus `NEXT_PUBLIC_SG_API_BASE` bzw. dem Seitenursprung. */
  url?: string;
  /** Speicher der Warteschlange. Standard: IndexedDB, ohne IndexedDB Arbeitsspeicher. */
  store?: QueueStore;
  webSocketFactory?: (url: string) => WebSocketLike;
  appVersion?: string;
  /** Nur zur Gegenprobe (`hello.device_id`); die Web-App läuft lokal ohne Token. */
  deviceId?: string;
  /** Fachcode-Hook für `page_version_conflict` (§11.2). Fehlt er, kommt die Operation in die Fehlerablage. */
  onPageVersionConflict?: PageConflictResolver;
  /**
   * Gemessenen Uhrversatz auf Zeitstempel anwenden? Standard `false`: Die Web-App läuft auf dem Mac des Cores und
   * nutzt Versatz 0 (§11.5). Gemessen und an den Server gemeldet wird immer.
   */
  applyClockOffset?: boolean;
  /** Hat eine fremde Uhr (Server/Mac) diese Session gestartet? Nur dann werden `t_ms` korrigiert (§11.5). */
  isForeignSession?: (sessionId: string) => boolean;
  now?: () => number;
  /** Zufallsquelle für den Jitter der Wartezeit, `[0, 1)` */
  random?: () => number;
  /** Wartezeit auf eine fehlende `seq`, bevor neu abonniert wird (§11.2) */
  gapWaitMs?: number;
  maxInFlight?: number;
  /** Höchstzeit bis `welcome` nach dem Öffnen; danach trennen und neu verbinden */
  welcomeTimeoutMs?: number;
  /**
   * Leader-Lock für mehrere Tabs: nur der Leader-Tab synchronisiert. Standard: Web Locks, falls vorhanden.
   * Die Funktion liefert pro `connect()` ein neues Lock; `null` bedeutet immer Leader.
   */
  leaderLock?: () => LeaderLock | null;
  /** Höchstzeit für den ersten Uhrabgleich; danach wird die Warteschlange trotzdem gesendet */
  clockSyncTimeoutMs?: number;
}

/** Dieser Tab ist nicht der Sync-Tab (ein anderer Tab hält die Verbindung). */
export class SyncNotLeaderError extends Error {
  constructor(message = 'Studien-Gehirn ist in einem anderen Tab aktiv.') {
    super(message);
    this.name = 'SyncNotLeaderError';
  }
}

/** Die Operation wurde endgültig abgelehnt und liegt in der Fehlerablage. */
export class SyncRejectedError extends Error {
  readonly code: string;
  readonly opId: string;
  readonly kind: ShelfReasonKind;

  constructor(opts: { code: string; message: string; opId: string; kind: ShelfReasonKind }) {
    super(opts.message);
    this.name = 'SyncRejectedError';
    this.code = opts.code;
    this.opId = opts.opId;
    this.kind = opts.kind;
  }
}

interface SeqItem {
  seq: number;
  opId: string;
  /** `null` für eigene Operationen (nur `ack`) und übersprungene Operationen */
  op: SyncOp | null;
}

interface Receiver {
  onOp: (op: SyncOp) => void;
  onReset: ResetHandler | undefined;
}

interface Subscription {
  stream: string;
  lastSeq: number;
  lastOpId: string | null;
  /** Mehrere Empfänger je Strom; Position, Lücken und `reset` gelten einmal pro Strom */
  receivers: Set<Receiver>;
  buffer: Map<number, SeqItem>;
  gapTimer: ReturnType<typeof setTimeout> | null;
  /** Reset läuft oder ist offen: eingehende Operationen des Stroms werden ignoriert */
  resetting: boolean;
  resetRequested: boolean;
  resetInfo: ResetInfo | null;
}

/** Fehlernachricht in lockerer Form: auch unbekannte Fehlercodes (neuere Server-Version) werden verstanden. */
interface LooseError {
  code: string;
  message: string;
  opId: string | null;
  stream: string | null;
  retryable: boolean;
  fatal: boolean;
  details: Record<string, unknown> | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function looseError(v: unknown): LooseError | null {
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.type !== 'error' || typeof o.code !== 'string') return null;
  const opId = typeof o.op_id === 'string' && UUID_RE.test(o.op_id) ? o.op_id : null;
  const details =
    o.details !== null && typeof o.details === 'object' ? (o.details as Record<string, unknown>) : null;
  return {
    code: o.code,
    message: typeof o.message === 'string' ? o.message : o.code,
    opId,
    stream: typeof o.stream === 'string' ? o.stream : null,
    retryable: o.retryable === true,
    fatal: o.fatal === true,
    details,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Standard-URL: `NEXT_PUBLIC_SG_SYNC_URL`, sonst aus der API-Basis bzw. dem Seitenursprung. Der Pfad ist `/sync` (§11.1). */
export function defaultSyncUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SG_SYNC_URL;
  if (explicit) return explicit;
  const apiBase = process.env.NEXT_PUBLIC_SG_API_BASE;
  if (apiBase && /^https?:\/\//.test(apiBase)) {
    const origin = new URL(apiBase).origin;
    return `${origin.replace(/^http/, 'ws')}/sync`;
  }
  const loc = globalThis.location;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/sync`;
}

export class SyncClient {
  private readonly url: string | undefined;
  private store: QueueStore;
  private readonly factory: (url: string) => WebSocketLike;
  private readonly opts: SyncClientOptions;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly gapWaitMs: number;
  private readonly maxInFlight: number;
  private readonly clockSyncTimeoutMs: number;
  private readonly welcomeTimeoutMs: number;

  private persistent = true;
  private readonly ready: Promise<void>;
  private lock: Promise<unknown> = Promise.resolve();
  private inbox: Promise<void> = Promise.resolve();

  private queue: QueueEntry[] = [];
  private byOpId = new Map<string, QueueEntry>();
  private inFlight = new Set<string>();
  /** Operationen, die vorübergehend nicht gesendet werden (Konfliktauflösung, abhängig von unklaren Operationen) */
  private held = new Set<string>();
  /** Schon gesendete Operationen, deren Elternoperation abgelehnt wurde: ihre eigene Antwort entscheidet (opId -> Auslöser) */
  private suspects = new Map<string, string>();
  /** Noch nicht gesendete Operationen hinter einer unklaren Operation (opId -> unklare opId) */
  private deferred = new Map<string, string>();
  private conflictChain = new Map<string, Promise<void>>();
  private pending = new Map<string, { resolve: (ack: SyncAck) => void; reject: (err: unknown) => void }>();
  private shelfCount = 0;

  private subs = new Map<string, Subscription>();
  private resetPromises = new Map<string, Promise<boolean>>();
  private listeners = new Map<string, Set<(data: never) => void>>();
  private lastPresence: {
    session_id: string | null;
    notebook_id: string | null;
    page_id: string | null;
  } | null = null;

  private ws: WebSocketLike | null = null;
  private state: ConnectionState = 'idle';
  private wanted = false;
  private connId = 0;
  private fatalCode: string | null = null;
  private sessionSuperseded = false;
  private supersededStreak = 0;
  private backoffAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private welcomeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReceivedAt = 0;
  private welcomed = false;
  private sending = false;

  private clockTimer: ReturnType<typeof setTimeout> | null = null;
  private clockTimeout: ReturnType<typeof setTimeout> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private clockSamples: { offset: number; rtt: number }[] = [];
  private clockPingT0: number | null = null;
  private clockPingSeq = 0;
  private clockLost = 0;
  private clockKnown = false;
  private measuredOffset = 0;

  // Mehrere Tabs: nur der Leader synchronisiert
  private leaderLock: LeaderLock | null = null;
  private isLeader = true;
  private connectGen = 0;

  constructor(options: SyncClientOptions = {}) {
    this.opts = options;
    this.url = options.url;
    this.store = options.store ?? createDefaultStore();
    this.factory = options.webSocketFactory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.gapWaitMs = options.gapWaitMs ?? 1_000;
    this.maxInFlight = options.maxInFlight ?? MAX_IN_FLIGHT;
    this.clockSyncTimeoutMs = options.clockSyncTimeoutMs ?? 10_000;
    this.welcomeTimeoutMs = options.welcomeTimeoutMs ?? 10_000;
    this.ready = this.load();
  }

  // ------------------------------------------------------------------ öffentliche Schnittstelle

  /**
   * Lädt die Warteschlange und baut die Verbindung auf. Verbindet danach von selbst neu (§11.2, §11.4).
   * Mit mehreren Tabs verbindet nur der Leader-Tab; die anderen schreiben in die gemeinsame Warteschlange.
   */
  async connect(): Promise<void> {
    const gen = ++this.connectGen;
    await this.ready;
    // `disconnect()` oder ein weiteres `connect()` während des Wartens (z. B. React StrictMode): dieses hier verfällt
    if (gen !== this.connectGen) return;
    this.wanted = true;
    this.fatalCode = null;
    if (this.leaderLock || this.ws || this.reconnectTimer) return;
    // Kanal und Lock werden bei jedem connect() neu angelegt (nach disconnect() sind sie geschlossen)
    const lock = (this.opts.leaderLock ?? createWebLocksLeader)();
    if (!lock) {
      this.isLeader = true;
      this.openSocket();
      return;
    }
    this.leaderLock = lock;
    this.isLeader = false;
    this.setState('other_tab');
    lock.start({
      onLeader: () => void this.becomeLeader(lock),
      onLost: () => this.loseLeadership(lock),
      onChanged: () => this.emit('leader.changed', {}),
    });
  }

  /** Hier übernehmen: holt die Leader-Rolle von einem anderen Tab (Web Locks `steal`). */
  takeOver(): void {
    if (this.isLeader) return;
    this.leaderLock?.steal();
  }

  /** Trennt und verbindet nicht mehr. Die Warteschlange bleibt erhalten. */
  disconnect(): void {
    this.wanted = false;
    this.connId++;
    this.clearReconnect();
    const ws = this.ws;
    if (ws) {
      this.detach(ws);
      try {
        ws.close(1000, 'client');
      } catch {
        // schon zu
      }
      this.afterClose();
    }
    this.connectGen++;
    if (this.leaderLock) {
      const lock = this.leaderLock;
      this.leaderLock = null;
      lock.stop();
    }
    this.isLeader = true;
    this.setState('closed');
  }

  /** Zustand der Verbindung. */
  get connectionState(): ConnectionState {
    return this.state;
  }

  /** Anzahl unbestätigter Operationen. */
  get pendingCount(): number {
    return this.queue.length;
  }

  /** Anzahl Einträge in der Fehlerablage. */
  get shelved(): number {
    return this.shelfCount;
  }

  /** `false`, wenn IndexedDB nicht nutzbar war und die Warteschlange nur im Arbeitsspeicher liegt. */
  get isPersistent(): boolean {
    return this.persistent;
  }

  /** Hält dieser Tab die Verbindung? (Ohne Tab-Koordination immer `true`.) */
  get leader(): boolean {
    return this.isLeader;
  }

  /** Aktuell gemessener (nicht unbedingt angewandter) Uhrversatz, `null` vor dem ersten Abgleich. */
  get clockOffsetMs(): number | null {
    return this.clockKnown ? this.measuredOffset : null;
  }

  /** Wartet, bis die Verbindung angemeldet und der Uhrabgleich fertig ist. `signal` räumt den Listener auf. */
  whenOnline(signal?: AbortSignal): Promise<void> {
    if (this.state === 'online') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        off();
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException('abgebrochen', 'AbortError'));
      };
      const off = this.onEvent('connection', (c) => {
        if (c.state === 'online') {
          cleanup();
          resolve();
        }
      });
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Abonniert einen Strom. `from` stammt aus `stream_seq`/`stream_op_id` des REST-Stands (§11.1); `last_seq = 0` nur
   * für Ströme, die der Client selbst anlegt. `onOp` bekommt Operationen lückenlos in `seq`-Reihenfolge.
   *
   * Mehrere Abos je Strom sind erlaubt: Alle Empfänger bekommen jede Operation, Position und `reset` gelten einmal
   * pro Strom. Abonniert ein weiterer Empfänger mit einer älteren Position, gilt die ältere (Operationen werden dann
   * erneut geliefert; sie sind idempotent). Bei `reset` werden alle `onReset`-Handler aufgerufen; die älteste gelieferte
   * Position gilt. Rückgabe: dieses Abo beenden.
   */
  subscribe(
    stream: string,
    from: StreamPosition,
    onOp: (op: SyncOp) => void,
    opts: { onReset?: ResetHandler } = {},
  ): () => void {
    if (!SyncStreamIdSchema.safeParse(stream).success) throw new TypeError(`Ungültiger Strom: ${stream}`);
    const receiver: Receiver = { onOp, onReset: opts.onReset };
    this.addReceiver(stream, from, receiver);
    return () => this.removeReceiver(stream, receiver);
  }

  /**
   * Reiht eine Operation ein und sendet sie, sobald die Verbindung steht. Die Warteschlange ist global, append-only
   * und liegt im Speicher (IndexedDB). Die Antwort kommt mit dem `ack`; wird die Operation endgültig abgelehnt,
   * schlägt sie mit `SyncRejectedError` fehl (sie liegt dann in der Fehlerablage).
   */
  async send(input: SendOpInput): Promise<SyncAck> {
    await this.ready;
    // Folge-Tabs schreiben nichts in die Warteschlange; die Operation ginge sonst beim Tab-Wechsel verloren
    if (!this.isLeader) throw new SyncNotLeaderError();
    const op = this.buildOp(input);
    if (this.byOpId.has(op.op_id)) throw new Error(`op_id ${op.op_id} ist schon in der Warteschlange`);
    return new Promise<SyncAck>((resolve, reject) => {
      this.pending.set(op.op_id, { resolve, reject });
      this.locked(async () => {
        const entry = await this.store.append(op);
        this.queue.push(entry);
        this.byOpId.set(op.op_id, entry);
        this.emit('queue', { pending: this.queue.length });
        this.pump();
      }).catch((err: unknown) => {
        this.pending.delete(op.op_id);
        reject(err);
      });
    });
  }

  /** Abonniert Server-Ereignisse (§11.6) und Client-Ereignisse (`ClientEventMap`). Rückgabe: abmelden. */
  onEvent<K extends ClientEventName>(name: K, fn: (data: ClientEventMap[K]) => void): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    const handler = fn as (data: never) => void;
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  /** Meldet, was dieser Client gerade zeigt. Wird nach dem Neuverbinden erneut gesendet. */
  setPresence(p: { session_id: string | null; notebook_id: string | null; page_id: string | null }): void {
    this.lastPresence = p;
    if (this.welcomed) this.sendJson({ type: 'presence', ...p });
  }

  /** Inhalt der Fehlerablage (nie automatisch geleert, §11.2). */
  async listShelf(): Promise<ShelfEntry[]> {
    await this.ready;
    return this.store.listShelf();
  }

  /** Unbestätigte Operationen in Reihenfolge (nur lesen, z. B. für Anzeigen und Tests). */
  pendingOps(): QueuedOp[] {
    return this.queue.map((e) => e.op);
  }

  // ------------------------------------------------------------------ Start, Speicher

  private async load(): Promise<void> {
    try {
      const [queue, shelf] = await Promise.all([this.store.list(), this.store.listShelf()]);
      this.setQueue(queue);
      this.shelfCount = shelf.length;
    } catch {
      // IndexedDB unbrauchbar: mit Arbeitsspeicher weiterarbeiten statt gar nicht zu synchronisieren
      this.store = new MemoryQueueStore();
      this.persistent = false;
    }
  }

  private setQueue(entries: QueueEntry[]): void {
    this.queue = entries;
    this.byOpId = new Map(entries.map((e) => [e.op.op_id, e]));
  }

  /** Warteschlange vollständig aus dem Speicher lesen (bei der Übernahme der Leader-Rolle). */
  private async reloadQueue(): Promise<void> {
    this.setQueue(await this.store.list());
    this.inFlight.clear();
    this.held.clear();
    this.suspects.clear();
    this.deferred.clear();
  }

  /** Speicherzugriffe laufen nacheinander, damit Reihenfolge und Zähler stimmen. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private buildOp(input: SendOpInput): QueuedOp {
    const raw = input as unknown as Record<string, unknown>;
    if ('seq' in raw || 'origin' in raw) throw new TypeError('seq und origin setzt nur der Server (§11.2)');
    if (isServerOnlyKind(String(raw.kind)))
      throw new TypeError(`${String(raw.kind)} darf nur der Server schreiben`);
    let at = input.at ?? this.now();
    let uncertain = input.clock_uncertain;
    if (uncertain === undefined) {
      if (this.clockKnown) {
        if (input.at === undefined) at += this.effectiveOffset();
        uncertain = false;
      } else {
        uncertain = true;
      }
    }
    const op = {
      ...raw,
      type: 'op',
      op_id: input.op_id ?? uuidv7(this.now()),
      at,
      clock_uncertain: uncertain,
    };
    const parsed = SyncOpSchema.safeParse(op);
    if (!parsed.success) throw new TypeError(`Ungültige Operation: ${parsed.error.message}`);
    if (new TextEncoder().encode(JSON.stringify(op)).length > MAX_FRAME_BYTES) {
      throw new RangeError('Operation größer als 1 MB (§11)');
    }
    return op as unknown as QueuedOp;
  }

  private effectiveOffset(): number {
    return this.opts.applyClockOffset ? this.measuredOffset : 0;
  }

  // ------------------------------------------------------------------ Verbindung

  private setState(
    state: ConnectionState,
    retryInMs: number | null = null,
    closeCode: number | null = null,
  ): void {
    this.state = state;
    this.emit('connection', { state, retryInMs, closeCode });
  }

  private openSocket(): void {
    this.clearReconnect();
    this.connId++;
    this.welcomed = false;
    this.sessionSuperseded = false;
    this.setState('connecting');
    let ws: WebSocketLike;
    try {
      ws = this.factory(this.url ?? defaultSyncUrl());
    } catch {
      this.scheduleReconnect(null);
      return;
    }
    this.ws = ws;
    const id = this.connId;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.lastReceivedAt = this.now();
      this.startKeepalive(ws);
      // `welcome` muss kommen; sonst trennen und neu verbinden
      this.welcomeTimer = setTimeout(() => {
        if (this.ws === ws && !this.welcomed) this.forceClose(ws, 4000);
      }, this.welcomeTimeoutMs);
      this.sendJson({
        type: 'hello',
        protocol: 1,
        client: 'web',
        ...(this.opts.deviceId ? { device_id: this.opts.deviceId } : {}),
        app_version: this.opts.appVersion ?? '0.0.0',
        streams: [...this.subs.values()].map((s) => ({
          stream: s.stream,
          last_seq: s.lastSeq,
          last_op_id: s.lastOpId,
        })),
      });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastReceivedAt = this.now();
      this.enqueueInbox(() => this.handleRaw(ev.data, id));
    };
    ws.onerror = () => {
      // Das Schließen folgt; hier gibt es nichts zu tun
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.detach(ws);
      this.enqueueInbox(() => this.handleClose(ws, ev.code));
    };
  }

  private detach(ws: WebSocketLike): void {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
  }

  /** Verbindung von uns aus beenden (Keepalive, `welcome` fehlt) und wie ein Schließen behandeln. */
  private forceClose(ws: WebSocketLike, code: number): void {
    this.detach(ws);
    try {
      ws.close(code, 'client');
    } catch {
      // schon zu
    }
    this.enqueueInbox(() => this.handleClose(ws, code));
  }

  /** Nachrichten und Schließen laufen strikt nacheinander in Empfangsreihenfolge. */
  private enqueueInbox(fn: () => Promise<void>): void {
    this.inbox = this.inbox.then(fn).catch(() => undefined);
  }

  private startKeepalive(ws: WebSocketLike): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.ws !== ws) return;
      if (this.now() - this.lastReceivedAt >= KEEPALIVE_DEAD_MS) {
        // 45 s Funkstille: trennen und neu verbinden (§11.4)
        this.forceClose(ws, 4000);
        return;
      }
      this.sendJson({ type: 'ping' });
    }, KEEPALIVE_PING_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
    if (this.welcomeTimer) clearTimeout(this.welcomeTimer);
    this.welcomeTimer = null;
  }

  /** Aufräumen nach dem Schließen, gemeinsam für `disconnect` und `handleClose`. */
  private afterClose(): void {
    this.ws = null;
    this.welcomed = false;
    this.stopKeepalive();
    this.stopClockSync();
    this.inFlight.clear();
    this.clockPingT0 = null;
    for (const s of this.subs.values()) {
      if (s.gapTimer) clearTimeout(s.gapTimer);
      s.gapTimer = null;
      s.buffer.clear();
    }
  }

  private async handleClose(ws: WebSocketLike, code: number): Promise<void> {
    if (this.ws !== ws) return;
    this.afterClose();
    if (!this.wanted) {
      this.setState('closed', null, code);
      return;
    }
    if (code === 4401 || code === 4426 || this.fatalCode) {
      this.fail(this.fatalCode ?? (code === 4401 ? 'device_token_invalid' : 'protocol_unsupported'), code);
      return;
    }
    if (code === 4409 || this.sessionSuperseded) {
      // Warteschlange ist umgeschrieben (§9.2): beim ersten Mal sofort, danach mit Wartezeit gegen enge Schleifen
      this.supersededStreak += 1;
      this.scheduleReconnect(this.supersededStreak <= 1 ? 0 : null, code);
      return;
    }
    // 4503, 4408, Netzfehler, Keepalive: exponentielle Wartezeit mit Jitter
    this.scheduleReconnect(null, code);
  }

  private fail(code: string, closeCode: number | null): void {
    this.wanted = false;
    this.setState('failed', null, closeCode);
    this.emit('fatal', { code, message: `Sync-Verbindung dauerhaft abgelehnt (${code})` });
  }

  /** 1 s, 2 s, 4 s … höchstens 30 s. Der Zufallsanteil verkürzt die Wartezeit um bis zu 25 %, nie darüber hinaus. */
  private backoffDelay(): number {
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** this.backoffAttempt);
    this.backoffAttempt = Math.min(this.backoffAttempt + 1, 16);
    return Math.min(BACKOFF_MAX_MS, Math.round(base * (1 - this.random() * 0.25)));
  }

  private scheduleReconnect(delay: number | null, closeCode: number | null = null): void {
    this.clearReconnect();
    const wait = delay ?? this.backoffDelay();
    this.setState('backoff', wait, closeCode);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wanted) this.openSocket();
    }, wait);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private sendJson(msg: unknown): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  // ------------------------------------------------------------------ eingehende Nachrichten

  private async handleRaw(data: unknown, connId: number): Promise<void> {
    if (connId !== this.connId || typeof data !== 'string') return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = SyncServerMessageSchema.safeParse(json);
    if (!parsed.success) {
      await this.handleUnknown(json);
      return;
    }
    const msg: SyncServerMessage = parsed.data;
    switch (msg.type) {
      case 'welcome':
        await this.onWelcome(msg, connId);
        return;
      case 'subscribed':
        this.applyResume(msg.resume, 'unknown_position');
        return;
      case 'ack':
        await this.onAck(msg);
        return;
      case 'op':
        this.onServerOp(msg);
        return;
      case 'time.pong':
        this.onTimePong(msg.t0, msg.ts);
        return;
      case 'pong':
        return;
      case 'error': {
        const err = looseError(msg);
        if (err) await this.onError(err);
        return;
      }
      case 'event':
        this.emit(msg.name, msg.data as never);
        return;
    }
  }

  /**
   * Nachrichten, die das Schema nicht kennt (§11.2): unbekannte Operationen und Operationen mit unbekannten
   * Enum-Werten überspringen, `seq` aber als empfangen zählen. Unbekannte Fehlercodes behandeln wir über ihre Flags.
   * Alles andere ignorieren.
   */
  private async handleUnknown(json: unknown): Promise<void> {
    if (json === null || typeof json !== 'object') return;
    const o = json as Record<string, unknown>;
    if (o.type === 'error') {
      const err = looseError(json);
      if (err) await this.onError(err);
      return;
    }
    if (o.type !== 'op') return;
    const streamOk = typeof o.stream === 'string' && SyncStreamIdSchema.safeParse(o.stream).success;
    if (!streamOk || typeof o.seq !== 'number' || !Number.isInteger(o.seq) || o.seq < 1) return;
    if (typeof o.op_id !== 'string' || !UUID_RE.test(o.op_id)) return;
    const stream = o.stream as string;
    this.emit('op.skipped', { stream, seq: o.seq, kind: typeof o.kind === 'string' ? o.kind : null });
    const sub = this.subs.get(stream);
    if (sub && !sub.resetting) this.acceptSeq(sub, { seq: o.seq, opId: o.op_id, op: null });
  }

  private onServerOp(op: SyncOp): void {
    if (op.seq === undefined) return;
    const sub = this.subs.get(op.stream);
    if (!sub || sub.resetting) return;
    this.acceptSeq(sub, { seq: op.seq, opId: op.op_id, op });
  }

  // ------------------------------------------------------------------ Abos, Ströme

  private newSub(stream: string, pos: StreamPosition): Subscription {
    return {
      stream,
      lastSeq: pos.lastSeq,
      lastOpId: pos.lastOpId,
      receivers: new Set(),
      buffer: new Map(),
      gapTimer: null,
      resetting: false,
      resetRequested: false,
      resetInfo: null,
    };
  }

  private setPosition(sub: Subscription, pos: StreamPosition): void {
    sub.lastSeq = pos.lastSeq;
    sub.lastOpId = pos.lastOpId;
    sub.buffer.clear();
    if (sub.gapTimer) clearTimeout(sub.gapTimer);
    sub.gapTimer = null;
  }

  private addReceiver(stream: string, from: StreamPosition, receiver: Receiver): void {
    let sub = this.subs.get(stream);
    if (!sub) {
      sub = this.newSub(stream, from);
      sub.receivers.add(receiver);
      this.subs.set(stream, sub);
      this.sendSubscribe([sub]);
      return;
    }
    sub.receivers.add(receiver);
    if (sub.resetting) {
      if (this.resetPromises.has(stream)) {
        // Reset läuft: der neue Empfänger bekommt seinen Handler in einer weiteren Runde
        sub.resetRequested = true;
      } else {
        // früherer Reset ist gescheitert oder hatte keinen Handler: die frische REST-Position übernimmt
        sub.resetting = false;
        this.setPosition(sub, from);
        this.sendSubscribe([sub]);
      }
    } else if (from.lastSeq < sub.lastSeq) {
      this.setPosition(sub, from);
      this.sendSubscribe([sub]);
    }
  }

  private removeReceiver(stream: string, receiver: Receiver): void {
    const sub = this.subs.get(stream);
    if (!sub || !sub.receivers.delete(receiver)) return;
    if (sub.receivers.size > 0) return;
    if (sub.gapTimer) clearTimeout(sub.gapTimer);
    this.subs.delete(stream);
    this.sendJson({ type: 'unsubscribe', streams: [stream] });
  }

  /** Lückenlose Auslieferung je Strom: `last_seq` ist die höchste `seq`, bis zu der alles angewendet ist (§11.2). */
  private acceptSeq(sub: Subscription, item: SeqItem): void {
    if (item.seq <= sub.lastSeq) return;
    const existing = sub.buffer.get(item.seq);
    if (!existing || (existing.op === null && item.op !== null)) sub.buffer.set(item.seq, item);
    this.drain(sub);
  }

  private drain(sub: Subscription): void {
    for (;;) {
      const next = sub.buffer.get(sub.lastSeq + 1);
      if (!next) break;
      sub.buffer.delete(next.seq);
      sub.lastSeq = next.seq;
      sub.lastOpId = next.opId;
      if (next.op) {
        for (const r of [...sub.receivers]) {
          try {
            r.onOp(next.op);
          } catch (err) {
            console.error('Sync: Fehler im onOp-Handler', err);
          }
        }
      }
    }
    if (sub.buffer.size === 0) {
      if (sub.gapTimer) clearTimeout(sub.gapTimer);
      sub.gapTimer = null;
    } else if (!sub.gapTimer) {
      // Lücke: kurz warten, dann ab `last_seq` neu abonnieren (§11.2)
      sub.gapTimer = setTimeout(() => {
        sub.gapTimer = null;
        if (this.subs.get(sub.stream) !== sub || sub.buffer.size === 0) return;
        this.sendSubscribe([sub]);
        this.drain(sub);
      }, this.gapWaitMs);
    }
  }

  private sendSubscribe(subs: Subscription[]): void {
    if (subs.length === 0) return;
    if (!this.welcomed) return;
    this.sendJson({
      type: 'subscribe',
      streams: subs.map((s) => ({ stream: s.stream, last_seq: s.lastSeq, last_op_id: s.lastOpId })),
    });
  }

  private async onWelcome(w: Extract<SyncServerMessage, { type: 'welcome' }>, connId: number): Promise<void> {
    if (this.state !== 'connecting') return;
    this.welcomed = true;
    if (this.welcomeTimer) clearTimeout(this.welcomeTimer);
    this.welcomeTimer = null;
    this.setState('syncing');
    const stored = await this.store.getMeta('db_epoch').catch(() => null);
    if (connId !== this.connId) return;
    const epochChanged = stored !== null && stored !== w.db_epoch;
    const resets = this.collectResets(
      w.resume,
      epochChanged ? 'db_epoch_changed' : 'unknown_position',
      epochChanged,
    );
    if (stored === null) await this.store.setMeta('db_epoch', w.db_epoch).catch(() => undefined);
    if (this.lastPresence) this.sendJson({ type: 'presence', ...this.lastPresence });
    this.startResets(resets, epochChanged ? w.db_epoch : null);
    this.startClockSync(connId);
  }

  /** `subscribed`: dieselbe Resume-Behandlung wie bei `welcome`, ohne Epochen-Vergleich. */
  private applyResume(
    resume: { stream: string; head_seq: number; reset: boolean }[],
    reason: ResetInfo['reason'],
  ): void {
    this.startResets(this.collectResets(resume, reason, false), null);
  }

  private collectResets(
    resume: { stream: string; head_seq: number; reset: boolean }[],
    reason: ResetInfo['reason'],
    all: boolean,
  ): { sub: Subscription; info: ResetInfo }[] {
    const byStream = new Map(resume.map((r) => [r.stream, r]));
    const out: { sub: Subscription; info: ResetInfo }[] = [];
    for (const sub of this.subs.values()) {
      const r = byStream.get(sub.stream);
      // Bei geänderter `db_epoch` gelten alle Ströme als `reset`, auch ohne Eintrag in `resume` (§11.1)
      if (all || r?.reset) out.push({ sub, info: { stream: sub.stream, reason, headSeq: r?.head_seq ?? 0 } });
    }
    return out;
  }

  /**
   * `reset` (§11.1): Daten werden NICHT verworfen. Der Fachcode lädt per REST, gleicht ab und liefert die neue
   * Position; danach abonniert der Client den Strom neu. Die Operationen aus der Warteschlange gehen wie gewohnt raus.
   */
  private startResets(resets: { sub: Subscription; info: ResetInfo }[], epochToStore: string | null): void {
    for (const { sub, info } of resets) {
      sub.resetting = true;
      sub.buffer.clear();
      if (sub.gapTimer) clearTimeout(sub.gapTimer);
      sub.gapTimer = null;
      this.emit('reset', info);
    }
    void (async () => {
      const results = await Promise.all(resets.map(({ sub, info }) => this.requestReset(sub, info)));
      if (epochToStore && results.every(Boolean)) {
        await this.store.setMeta('db_epoch', epochToStore).catch(() => undefined);
      }
    })();
  }

  /** Pro Strom läuft höchstens ein Reset; weitere Anforderungen führen zu einer weiteren Runde danach. */
  private requestReset(sub: Subscription, info: ResetInfo): Promise<boolean> {
    sub.resetInfo = info;
    sub.resetRequested = true;
    let p = this.resetPromises.get(sub.stream);
    if (!p) {
      const run = this.resetLoop(sub).finally(() => {
        if (this.resetPromises.get(sub.stream) === run) this.resetPromises.delete(sub.stream);
      });
      p = run;
      this.resetPromises.set(sub.stream, run);
    }
    return p;
  }

  private async resetLoop(sub: Subscription): Promise<boolean> {
    for (;;) {
      sub.resetRequested = false;
      const info = sub.resetInfo;
      const handlers = [...sub.receivers].filter((r) => r.onReset);
      if (!info || handlers.length === 0) {
        this.emit('reset.failed', { stream: sub.stream, error: new Error('kein onReset-Handler') });
        return false;
      }
      let positions: StreamPosition[];
      try {
        positions = await Promise.all(handlers.map((r) => r.onReset!(info)));
      } catch (error) {
        this.emit('reset.failed', { stream: sub.stream, error });
        return false;
      }
      if (this.subs.get(sub.stream) !== sub) return false;
      if (sub.resetRequested) continue; // neuer Empfänger oder neuer Reset: noch eine Runde
      const oldest = positions.reduce((a, b) => (b.lastSeq < a.lastSeq ? b : a));
      this.setPosition(sub, oldest);
      sub.resetting = false;
      this.sendSubscribe([sub]);
      return true;
    }
  }

  // ------------------------------------------------------------------ Uhrabgleich (§11.5)

  private startClockSync(connId: number): void {
    this.stopClockSync();
    this.clockSamples = [];
    this.clockLost = 0;
    if (this.state === 'syncing') {
      this.clockTimeout = setTimeout(() => {
        // Server antwortet nicht auf time.ping: Warteschlange trotzdem senden (ohne Versatz bleibt clock_uncertain)
        this.clockTimeout = null;
        if (connId === this.connId && this.state === 'syncing') this.goOnline();
      }, this.clockSyncTimeoutMs);
    }
    this.sendClockPing();
  }

  private stopClockSync(): void {
    if (this.clockTimer) clearTimeout(this.clockTimer);
    if (this.clockTimeout) clearTimeout(this.clockTimeout);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.clockTimer = null;
    this.clockTimeout = null;
    this.pongTimer = null;
  }

  private sendClockPing(): void {
    const seq = ++this.clockPingSeq;
    this.clockPingT0 = this.now();
    this.sendJson({ type: 'time.ping', t0: this.clockPingT0 });
    if (this.pongTimer) clearTimeout(this.pongTimer);
    // Verlorenes time.pong: nach 5 s weiter; nach 3 Verlusten mit dem Vorhandenen abschließen
    this.pongTimer = setTimeout(() => {
      if (seq !== this.clockPingSeq || this.clockPingT0 === null) return;
      this.clockPingT0 = null;
      this.clockLost += 1;
      if (this.clockLost > 3) this.finishClock();
      else this.sendClockPing();
    }, PONG_TIMEOUT_MS);
  }

  private onTimePong(t0: number, ts: number): void {
    if (this.clockPingT0 === null || t0 !== this.clockPingT0) return;
    this.clockPingT0 = null;
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = null;
    const t1 = this.now();
    this.clockSamples.push({ offset: ts - (t0 + t1) / 2, rtt: t1 - t0 });
    if (this.clockSamples.length < CLOCK_ROUNDS) {
      this.sendClockPing();
      return;
    }
    this.finishClock();
  }

  private finishClock(): void {
    const samples = this.clockSamples;
    this.clockSamples = [];
    const connId = this.connId;
    this.clockTimer = setTimeout(() => this.startClockSync(this.connId), CLOCK_RESYNC_MS);
    if (samples.length > 0) {
      const offset = Math.round(median(samples.map((s) => s.offset)));
      const rtt = Math.max(0, Math.round(median(samples.map((s) => s.rtt))));
      this.sendJson({ type: 'time.offset', offset_ms: offset, rtt_ms: rtt });
      this.measuredOffset = offset;
      this.clockKnown = true;
      this.emit('clock', { offsetMs: offset, rttMs: rtt, suspicious: Math.abs(offset) > 2_000 });
    }
    if (this.clockTimeout) clearTimeout(this.clockTimeout);
    this.clockTimeout = null;
    // Noch nicht gesendete Operationen mit unsicherer Uhr korrigieren, dann erst die Warteschlange senden
    void this.locked(() => this.correctPending()).then(() => {
      if (connId === this.connId && this.state === 'syncing') this.goOnline();
    });
  }

  /** Nur Operationen, die noch nie gesendet wurden (§11.5); sonst gäbe dieselbe `op_id` mit anderem Inhalt `op_id_reused`. */
  private async correctPending(): Promise<void> {
    if (!this.clockKnown) return;
    const foreign = this.opts.isForeignSession ?? (() => false);
    const offset = this.effectiveOffset();
    const changed: QueueEntry[] = [];
    for (const e of this.queue) {
      if (e.sent || !e.op.clock_uncertain) continue;
      e.op = correctClock(e.op, offset, foreign);
      changed.push(e);
    }
    await this.store.putMany(changed);
  }

  private goOnline(): void {
    if (this.clockTimeout) clearTimeout(this.clockTimeout);
    this.clockTimeout = null;
    this.setState('online');
    if (this.queue.length === 0) this.backoffAttempt = 0;
    this.pump();
  }

  // ------------------------------------------------------------------ Senden, ack, Fehler

  /** Sendet unbestätigte Operationen in Originalreihenfolge, höchstens `maxInFlight` ohne Antwort (§11.2). */
  private pump(): void {
    if (this.state !== 'online' || this.sending || !this.isLeader) return;
    this.sending = true;
    const fresh: QueueEntry[] = [];
    try {
      // Updates einer Seite bleiben hinter einer festgehaltenen (Konflikt) derselben Seite
      const blockedPages = new Set<string>();
      for (const e of this.queue) {
        if (this.inFlight.size >= this.maxInFlight) break;
        const id = e.op.op_id;
        const page = e.op.kind === 'page.update' ? e.op.data.page_id : null;
        if (this.held.has(id)) {
          if (page) blockedPages.add(page);
          continue;
        }
        if (this.inFlight.has(id) || (page && blockedPages.has(page))) continue;
        if (!this.sendJson(e.op)) break;
        this.inFlight.add(id);
        if (!e.sent) {
          e.sent = true;
          fresh.push(e);
        }
      }
    } finally {
      this.sending = false;
    }
    if (fresh.length > 0) void this.locked(() => this.store.putMany(fresh)).catch(() => undefined);
  }

  private async onAck(ack: SyncAck): Promise<void> {
    const sub = this.subs.get(ack.stream);
    if (sub && !sub.resetting) this.acceptSeq(sub, { seq: ack.seq, opId: ack.op_id, op: null });
    this.inFlight.delete(ack.op_id);
    const entry = this.byOpId.get(ack.op_id);
    if (!entry) return; // doppelter ack oder schon in der Fehlerablage
    this.backoffAttempt = 0;
    this.supersededStreak = 0;
    this.releaseSuspect(ack.op_id);
    // Im Arbeitsspeicher sofort entfernen, damit `pump` die Operation nicht noch einmal sendet
    this.dropEntries([entry]);
    await this.locked(() => this.store.removeMany([entry.key]));
    this.pending.get(ack.op_id)?.resolve(ack);
    this.pending.delete(ack.op_id);
    this.emit('queue', { pending: this.queue.length });
    this.pump();
  }

  private dropEntries(entries: QueueEntry[]): void {
    const keys = new Set(entries.map((e) => e.key));
    this.queue = this.queue.filter((e) => !keys.has(e.key));
    for (const e of entries) {
      this.byOpId.delete(e.op.op_id);
      this.inFlight.delete(e.op.op_id);
      this.held.delete(e.op.op_id);
      this.suspects.delete(e.op.op_id);
      this.deferred.delete(e.op.op_id);
    }
  }

  /** Eine unklare Operation wurde bestätigt: ihre zurückgestellten Nachfolger dürfen gesendet werden. */
  private releaseSuspect(opId: string): void {
    if (!this.suspects.delete(opId)) return;
    for (const [id, by] of [...this.deferred]) {
      if (by !== opId) continue;
      this.deferred.delete(id);
      this.held.delete(id);
    }
  }

  private async onError(err: LooseError): Promise<void> {
    if (err.code === 'device_token_invalid' || err.code === 'protocol_unsupported') this.fatalCode = err.code;
    if (err.code === 'session_superseded') {
      await this.onSuperseded(err);
      return;
    }
    if (!err.opId) return;
    const entry = this.byOpId.get(err.opId);
    if (!entry) return; // schon bestätigt oder abgelegt
    this.inFlight.delete(err.opId);
    if (err.code === 'page_version_conflict' && !err.retryable) {
      this.startConflict(entry, err);
      return;
    }
    if (err.retryable) {
      // Verbindung wird geschlossen (4503); danach ab dieser Operation erneut senden. Giftige Operation zählen.
      if (err.code !== 'internal_error') return;
      entry.failures += 1;
      if (entry.failures >= POISON_LIMIT) {
        await this.shelveWithDependents(entry, 'poison', err);
      } else {
        await this.locked(() => this.store.putMany([entry]));
      }
      return;
    }
    // Eine unklare Operation, deren Elternoperation abgelehnt wurde, gilt jetzt als abhängig
    const cause = this.suspects.get(err.opId) ?? null;
    await this.shelveWithDependents(entry, cause ? 'dependent' : 'rejected', err, cause);
  }

  /**
   * Operation und abhängige Operationen in die Fehlerablage verschieben (§11.2). Abhängige, die schon gesendet sind,
   * bleiben zunächst stehen: ihre eigene Antwort entscheidet (Fehler: ablegen, `ack`: normal).
   */
  private async shelveWithDependents(
    root: QueueEntry,
    kind: ShelfReasonKind,
    err: Pick<LooseError, 'code' | 'message'>,
    causedBy: string | null = null,
  ): Promise<void> {
    // `session.start` mit `session_transition_invalid`: die Session existiert, also ist nichts davon abhängig
    const noDeps = root.op.kind === 'session.start' && err.code === 'session_transition_invalid';
    const later = this.queue.filter((e) => e.key > root.key);
    const deps = noDeps ? [] : dependentsOf(root.op, later);
    const items: { entry: QueueEntry; kind: ShelfReasonKind; causedBy: string | null }[] = [
      { entry: root, kind, causedBy },
    ];
    let unclear: string | null = null;
    for (const d of deps) {
      const id = d.op.op_id;
      if (unclear === null && this.inFlight.has(id)) {
        unclear = id;
        this.suspects.set(id, root.op.op_id);
      } else if (unclear !== null) {
        this.deferred.set(id, unclear);
        this.held.add(id);
      } else {
        items.push({ entry: d, kind: 'dependent', causedBy: root.op.op_id });
      }
    }
    await this.shelveEntries(items, err);
  }

  private async shelveEntries(
    items: { entry: QueueEntry; kind: ShelfReasonKind; causedBy: string | null }[],
    err: Pick<LooseError, 'code' | 'message'>,
  ): Promise<void> {
    const now = this.now();
    const shelved: NewShelfEntry[] = items.map((i) => ({
      shelvedAt: now,
      op: i.entry.op,
      reason: { kind: i.kind, code: err.code, message: err.message, causedBy: i.causedBy },
    }));
    const all = items.map((i) => i.entry);
    await this.locked(async () => {
      await this.store.shelve(
        all.map((e) => e.key),
        shelved,
      );
      this.dropEntries(all);
      this.shelfCount += all.length;
    });
    for (const i of items) {
      const p = this.pending.get(i.entry.op.op_id);
      this.pending.delete(i.entry.op.op_id);
      const error = new SyncRejectedError({
        code: err.code,
        message: err.message,
        opId: i.entry.op.op_id,
        kind: i.kind,
      });
      p?.reject(error);
    }
    this.emit('shelf', { count: this.shelfCount });
    this.emit('queue', { pending: this.queue.length });
    this.pump();
  }

  /** `page_version_conflict` je Seite nacheinander in Warteschlangenreihenfolge auflösen (§11.2). */
  private startConflict(entry: QueueEntry, err: LooseError): void {
    this.held.add(entry.op.op_id); // sofort, damit spätere Updates derselben Seite nicht vorbeiziehen
    const page = entry.op.kind === 'page.update' ? entry.op.data.page_id : entry.op.op_id;
    const prev = this.conflictChain.get(page) ?? Promise.resolve();
    const next = prev
      .then(() => this.resolveConflict(entry, err))
      .catch(() => undefined)
      .finally(() => {
        if (this.conflictChain.get(page) === next) this.conflictChain.delete(page);
      });
    this.conflictChain.set(page, next);
  }

  /** Fachcode lädt die Seite neu und legt die eigenen Felder auf den Serverstand. */
  private async resolveConflict(entry: QueueEntry, err: LooseError): Promise<void> {
    if (this.byOpId.get(entry.op.op_id) !== entry) return;
    const resolver = this.opts.onPageVersionConflict;
    const current = entry.op;
    if (!resolver || current.kind !== 'page.update' || entry.conflicts >= MAX_CONFLICT_RETRIES) {
      this.held.delete(current.op_id);
      await this.shelveWithDependents(entry, 'conflict_unresolved', err);
      return;
    }
    const result = await resolver({ op: current, message: err.message }).catch(() => null);
    if (this.byOpId.get(current.op_id) !== entry) return; // inzwischen bestätigt oder abgelegt
    this.held.delete(current.op_id);
    if (!result) {
      await this.shelveWithDependents(entry, 'conflict_unresolved', err);
      return;
    }
    entry.conflicts += 1;
    // Die Operation kann inzwischen umgeschrieben worden sein (4409): vom aktuellen Stand ausgehen
    const latest = entry.op as typeof current;
    entry.op = { ...latest, data: { ...latest.data, fields: result.fields, version: result.version } };
    await this.locked(() => this.store.putMany([entry]));
    this.pump();
  }

  /** `session_superseded` (§9.2): alle unbestätigten Operationen auf die bestehende Session umschreiben, neu verbinden. */
  private async onSuperseded(err: LooseError): Promise<void> {
    const entry = err.opId ? this.byOpId.get(err.opId) : undefined;
    const newId = typeof err.details?.session_id === 'string' ? err.details.session_id : null;
    const streamId = err.stream ?? entry?.op.stream ?? null;
    const oldId = streamId?.startsWith('session:') ? streamId.slice('session:'.length) : null;
    if (!newId || !oldId || !UUID_RE.test(newId)) {
      if (entry) await this.shelveWithDependents(entry, 'rejected', err);
      return;
    }
    this.sessionSuperseded = true;
    await this.locked(async () => {
      for (const e of this.queue) e.op = rewriteSessionId(e.op, oldId, newId);
      await this.store.putMany(this.queue);
    });
    this.emit('session.superseded', { oldSessionId: oldId, newSessionId: newId });
  }

  // ------------------------------------------------------------------ Mehrere Tabs

  /** Dieser Tab hat das Lock bekommen: Warteschlange vollständig aus dem Speicher lesen, dann verbinden. */
  private async becomeLeader(lock: LeaderLock): Promise<void> {
    await this.ready;
    await this.locked(() => this.reloadQueue()).catch(() => undefined);
    if (this.leaderLock !== lock || !this.wanted) return; // inzwischen getrennt
    this.isLeader = true;
    this.emit('queue', { pending: this.queue.length });
    if (!this.ws) this.openSocket();
  }

  /**
   * Ein anderer Tab hat die Leader-Rolle übernommen: sauber trennen. Die Warteschlange liegt im Speicher und wird
   * vom neuen Leader gesendet; offene `send()`-Versprechen dieses Tabs enden mit `SyncNotLeaderError`.
   */
  private loseLeadership(lock: LeaderLock): void {
    if (this.leaderLock !== lock || !this.isLeader) return;
    this.isLeader = false;
    this.connId++;
    this.clearReconnect();
    const ws = this.ws;
    if (ws) {
      this.detach(ws);
      try {
        ws.close(1000, 'leader-wechsel');
      } catch {
        // schon zu
      }
      this.afterClose();
    }
    for (const [id, p] of this.pending) {
      p.reject(
        new SyncNotLeaderError(
          'Ein anderer Tab hat die Synchronisation übernommen; die Operation bleibt in der Warteschlange und wird dort gesendet.',
        ),
      );
      this.pending.delete(id);
    }
    this.setState('other_tab');
  }

  // ------------------------------------------------------------------ Ereignisse

  private emit<K extends ClientEventName>(name: K, data: ClientEventMap[K]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as (d: ClientEventMap[K]) => void)(data);
      } catch (err) {
        console.error(`Sync: Fehler im Ereignis-Handler (${name})`, err);
      }
    }
  }
}
