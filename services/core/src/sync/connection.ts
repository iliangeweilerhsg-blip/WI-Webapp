// Eine Sync-Verbindung (VERTRAEGE §11): Anmeldung, Abos und Nachlieferung, Dispatcher für Operationen,
// Uhrabgleich, Keepalive, Präsenz und Schutzgrenzen.
import {
  SyncHelloSchema,
  SyncOpSchema,
  SyncPingSchema,
  SyncPresenceSchema,
  SyncSubscribeSchema,
  SyncTimeOffsetSchema,
  SyncTimePingSchema,
  SyncUnsubscribeSchema,
  UuidSchema,
  SyncStreamIdSchema,
  type SyncClientKind,
  type SyncError,
  type SyncErrorCode,
  type SyncEvent,
  type SyncOp,
  type SyncPresence,
  type SyncResume,
  type SyncServerMessage,
  type SyncStreamPosition,
} from '@sg/shared';
import type { ZodError } from 'zod';
import { appendOp, findOpById, type CommittedOp } from './append.ts';
import { getOpRegistration, SERVER_ONLY_KINDS, SyncOpError } from './handlers.ts';
import { Semaphore, type SyncHub } from './hub.ts';
import { CLOSE, syncLimits } from './limits.ts';
import {
  canonicalJson,
  computeResume,
  loadOpsAfter,
  readDbEpoch,
  readDeviceName,
  storeAppVersion,
  storeClockOffset,
} from './store.ts';

/** Was der Sync-Server vom WebSocket braucht (Teilmenge von `ws.WebSocket`, `@types/ws` ist nicht installiert) */
export interface SyncSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string, cb?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  pause(): void;
  resume(): void;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

const WS_OPEN = 1;
const MAX_INT32 = 2_147_483_647;

/** Eine auf dieser Verbindung empfangene, noch nicht mit `ack` oder `error` beantwortete Operation (§11.2) */
export interface PendingEntry {
  conn: SyncConnection;
  opId: string | null;
  stream: string | null;
  kind: string | null;
  /** Kanonisches JSON von `data`, für den Vergleich mit der gespeicherten Operation */
  dataKey: string | null;
  answered: boolean;
  timer: NodeJS.Timeout | null;
}

interface Subscription {
  stream: string;
  /** Höchste `seq`, die diese Verbindung für den Strom bekommen hat (Weitergabe oder `ack`) */
  sentSeq: number;
  /** Nachlieferung aus `sync_op` läuft. Neue Operationen warten solange in `buffer` */
  catchingUp: boolean;
  buffer: CommittedOp[];
}

type Phase = 'awaiting_hello' | 'hello' | 'open' | 'closed';

/** Rollback der Handler-Änderung, weil `appendOp` ein gleichzeitiges Duplikat erkannt hat */
class DuplicateOp extends Error {
  readonly seq: number;
  constructor(seq: number) {
    super('Duplikat');
    this.seq = seq;
  }
}

function errorMessage(code: SyncErrorCode): string {
  const texts: Partial<Record<SyncErrorCode, string>> = {
    hello_required: 'Die erste Nachricht muss innerhalb von 5 s hello sein.',
    hello_invalid: 'hello ist ungültig.',
    protocol_unsupported: 'Diese Protokollversion wird nicht unterstützt (erwartet: 1).',
    device_token_invalid: 'Das Gerät passt nicht zum Token oder ist nicht gekoppelt.',
    message_invalid: 'Die Nachricht ist ungültig.',
    too_many_pending: 'Zu viele unbestätigte Operationen auf dieser Verbindung.',
    op_id_reused: 'Diese op_id ist schon mit anderem Inhalt gespeichert.',
    op_not_allowed: 'Diese Operation darf nur der Server schreiben.',
    internal_error: 'Interner Fehler. Bitte neu verbinden und erneut senden.',
  };
  return texts[code] ?? code;
}

function zodSummary(error: ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '(Wurzel)'}: ${i.message}`)
    .join('; ');
}

function rawToText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return String(data);
}

function rawLength(data: unknown): number {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (Buffer.isBuffer(data)) return data.length;
  if (Array.isArray(data)) return (data as Buffer[]).reduce((n, b) => n + b.length, 0);
  if (data instanceof ArrayBuffer) return data.byteLength;
  return 0;
}

const isUuid = (v: unknown): v is string => UuidSchema.safeParse(v).success;
const isStream = (v: unknown): v is string => SyncStreamIdSchema.safeParse(v).success;

export class SyncConnection {
  readonly deviceId: string | null;
  client: SyncClientKind = 'web';
  deviceName: string | null = null;
  presence: Omit<SyncPresence, 'type'> | null = null;

  private readonly hub: SyncHub;
  private readonly socket: SyncSocket;
  private phase: Phase = 'awaiting_hello';
  /** Keine neuen Nachrichten mehr annehmen (z. B. nach `too_many_pending`, schon eingereihte laufen weiter) */
  private stopReading = false;
  /** Keine Operation mehr bearbeiten (nach einem fatalen Fehler) */
  private halted = false;
  private readonly subs = new Map<string, Subscription>();
  /** Unbeantwortete Operationen in Empfangsreihenfolge */
  private readonly pending: PendingEntry[] = [];
  private readonly pendingWaiters = new Set<() => void>();
  private opChain: Promise<void> = Promise.resolve();
  private subChain: Promise<void> = Promise.resolve();
  private readonly queuedBeforeWelcome: { msg: unknown; bytes: number }[] = [];
  private queuedBytesBeforeWelcome = 0;
  /** Ereignisse, die hinter einer laufenden Nachlieferung warten (§11.6) */
  private readonly deferredEvents: SyncEvent[] = [];
  private readonly catchUpQueries = new Semaphore(() => syncLimits.maxCatchUpQueriesPerConnection);
  private inboundBytes = 0;
  private paused = false;
  private tokens = syncLimits.controlBurst;
  private lastRefill = Date.now();
  private helloTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private killTimer: NodeJS.Timeout | null = null;

  constructor(hub: SyncHub, socket: SyncSocket, deviceId: string | null) {
    this.hub = hub;
    this.socket = socket;
    this.deviceId = deviceId;
  }

  start(): void {
    this.hub.add(this);
    this.socket.on('message', (data, isBinary) => {
      try {
        this.onMessage(data, isBinary);
      } catch (error) {
        this.unexpected(error);
      }
    });
    this.socket.on('close', () => this.dispose());
    this.socket.on('error', (error) => {
      this.hub.logger.debug({ err: error }, 'Sync: Socket-Fehler');
    });
    this.helloTimer = setTimeout(() => {
      if (this.phase === 'awaiting_hello') this.fatal('hello_required', CLOSE.helloMissing);
    }, syncLimits.helloTimeoutMs);
    this.resetIdle();
  }

  isOpen(): boolean {
    return this.phase === 'open';
  }

  /** Als Methode, damit TypeScript den Zustand nach einem `await` nicht falsch einengt */
  private isClosed(): boolean {
    return this.phase === 'closed';
  }

  // ---- Senden und Schließen ------------------------------------------------------------------------------

  /** Nachricht senden. Ist der Puffer des Clients übervoll, wird getrennt (er holt beim Neuverbinden nach) */
  send(message: SyncServerMessage): void {
    if (this.phase === 'closed' || this.socket.readyState !== WS_OPEN) return;
    if (this.socket.bufferedAmount > syncLimits.maxBufferedBytes) {
      this.hub.logger.warn(
        { deviceId: this.deviceId },
        'Sync: Client liest zu langsam, Verbindung wird getrennt',
      );
      this.terminate();
      return;
    }
    this.socket.send(JSON.stringify(message), (error) => {
      if (error) this.terminate();
    });
  }

  /**
   * Ereignis senden (§11.6). Läuft für einen Strom dieser Verbindung noch eine Nachlieferung, wartet es dahinter:
   * Operationen, die vor dem Ereignis committet wurden, kommen so immer vor ihm an.
   */
  sendEvent(event: SyncEvent): void {
    if (this.phase === 'closed') return;
    if (!this.anyCatchingUp()) {
      this.send(event);
      return;
    }
    if (this.deferredEvents.length >= syncLimits.maxDeferredEvents) {
      this.hub.logger.warn(
        { deviceId: this.deviceId },
        'Sync: zu viele wartende Ereignisse, Verbindung wird getrennt',
      );
      this.terminate();
      return;
    }
    this.deferredEvents.push(event);
  }

  private anyCatchingUp(): boolean {
    for (const sub of this.subs.values()) if (sub.catchingUp) return true;
    return false;
  }

  /** Wartende Ereignisse senden, sobald keine Nachlieferung mehr läuft */
  private flushDeferredEvents(): void {
    if (this.deferredEvents.length === 0 || this.anyCatchingUp() || this.phase !== 'open') return;
    for (const event of this.deferredEvents.splice(0)) this.send(event);
  }

  /**
   * Wartet, bis der Puffer des Clients unter 1 MiB ist (Nachlieferung großer Ströme). Liest der Client länger als
   * `maxDrainWaitMs` nicht, wird getrennt (`false`), er holt beim Neuverbinden nach.
   */
  private async drained(): Promise<boolean> {
    const deadline = Date.now() + syncLimits.maxDrainWaitMs;
    while (this.phase !== 'closed' && this.socket.bufferedAmount > 1024 * 1024) {
      if (Date.now() > deadline) {
        this.hub.logger.warn(
          { deviceId: this.deviceId },
          'Sync: Client liest nicht, Verbindung wird getrennt',
        );
        this.terminate();
        return false;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    return this.phase !== 'closed';
  }

  closeWith(code: number, reason: string): void {
    if (this.phase === 'closed') return;
    this.stopReading = true;
    this.halted = true;
    try {
      this.socket.close(code, reason);
    } catch {
      this.terminate();
      return;
    }
    // Antwortet der Client nicht auf das Close-Frame, hart trennen
    this.killTimer ??= setTimeout(() => this.terminate(), 5_000);
    this.killTimer.unref?.();
  }

  terminate(): void {
    try {
      this.socket.terminate();
    } catch {
      // schon zu
    }
    this.dispose();
  }

  private sendError(
    code: SyncErrorCode,
    options: {
      retryable?: boolean;
      fatal?: boolean;
      opId?: string | null;
      stream?: string | null;
      message?: string;
      details?: Record<string, unknown>;
    } = {},
  ): void {
    const error: SyncError = {
      type: 'error',
      code,
      message: options.message ?? errorMessage(code),
      retryable: options.retryable ?? false,
      fatal: options.fatal ?? false,
      ...(options.opId ? { op_id: options.opId } : {}),
      ...(options.stream ? { stream: options.stream } : {}),
      ...(options.details ? { details: options.details } : {}),
    };
    this.send(error);
  }

  /** Fataler Fehler ohne Operation: senden, schließen, nichts mehr bearbeiten */
  private fatal(
    code: SyncErrorCode,
    closeCode: number,
    options: { retryable?: boolean; message?: string; details?: Record<string, unknown> } = {},
  ): void {
    if (this.phase === 'closed') return;
    this.stopReading = true;
    this.halted = true;
    this.sendError(code, { ...options, fatal: true });
    this.closeWith(closeCode, code);
  }

  /** Unerwarteter Fehler im Server: nie abstürzen, Verbindung mit 4503 neu aufbauen lassen */
  private unexpected(error: unknown): void {
    this.hub.logger.error({ err: error }, 'Sync: unerwarteter Fehler');
    this.fatal('internal_error', CLOSE.retry, { retryable: true });
  }

  private dispose(): void {
    if (this.phase === 'closed') return;
    const wasOpen = this.phase === 'open';
    this.phase = 'closed';
    this.stopReading = true;
    this.halted = true;
    for (const t of [this.helloTimer, this.idleTimer, this.killTimer]) if (t) clearTimeout(t);
    for (const entry of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      this.hub.unregisterInflight(entry);
    }
    this.pending.length = 0;
    this.notifyPending();
    for (const stream of this.subs.keys()) this.hub.removeSubscriber(stream, this);
    this.subs.clear();
    this.hub.remove(this);
    if (wasOpen) {
      this.hub.broadcastEvent({
        type: 'event',
        name: 'device.connection',
        data: { client: this.client, device_id: this.deviceId, connected: false },
      });
    }
  }

  private resetIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => this.closeWith(CLOSE.goingAway, 'idle_timeout'),
      syncLimits.idleTimeoutMs,
    );
  }

  // ---- Empfang -------------------------------------------------------------------------------------------

  private onMessage(data: unknown, isBinary: boolean): void {
    if (this.stopReading || this.phase === 'closed') return;
    this.resetIdle();
    if (isBinary) {
      this.fatal('message_invalid', CLOSE.unsupportedData, { message: 'Nur Text-Frames sind erlaubt.' });
      return;
    }
    const bytes = rawLength(data);
    let msg: unknown;
    try {
      msg = JSON.parse(rawToText(data));
    } catch {
      msg = undefined;
    }

    if (this.phase === 'awaiting_hello') {
      this.handleHello(msg).catch((error: unknown) => this.unexpected(error));
      return;
    }
    if (this.phase === 'hello') {
      if (
        this.queuedBeforeWelcome.length >= syncLimits.maxQueuedBeforeWelcome ||
        this.queuedBytesBeforeWelcome + bytes > syncLimits.maxQueuedBytesBeforeWelcome
      ) {
        this.fatal('message_invalid', CLOSE.policyViolation, {
          message: 'Zu viele Nachrichten vor welcome.',
        });
        return;
      }
      this.queuedBeforeWelcome.push({ msg, bytes });
      this.queuedBytesBeforeWelcome += bytes;
      return;
    }
    this.route(msg, bytes);
  }

  private takeControlToken(): boolean {
    const now = Date.now();
    this.tokens = Math.min(
      syncLimits.controlBurst,
      this.tokens + ((now - this.lastRefill) / 1000) * syncLimits.controlPerSecond,
    );
    this.lastRefill = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private route(msg: unknown, bytes: number): void {
    if (this.stopReading || this.phase !== 'open') return;
    const type = msg !== null && typeof msg === 'object' ? (msg as { type?: unknown }).type : undefined;
    if (type === 'op') {
      this.receiveOp(msg as Record<string, unknown>, bytes);
      return;
    }
    if (!this.takeControlToken()) {
      this.fatal('message_invalid', CLOSE.policyViolation, { message: 'Zu viele Nachrichten.' });
      return;
    }
    const invalid = (detail: string) =>
      this.sendError('message_invalid', { message: `Die Nachricht ist ungültig: ${detail}` });

    switch (type) {
      case 'ping': {
        if (!SyncPingSchema.safeParse(msg).success) return invalid('ping');
        this.send({ type: 'pong' });
        return;
      }
      case 'time.ping': {
        const parsed = SyncTimePingSchema.safeParse(msg);
        if (!parsed.success) return invalid(zodSummary(parsed.error));
        this.send({ type: 'time.pong', t0: parsed.data.t0, ts: Date.now() });
        return;
      }
      case 'time.offset': {
        const parsed = SyncTimeOffsetSchema.safeParse(msg);
        if (!parsed.success) return invalid(zodSummary(parsed.error));
        if (Math.abs(parsed.data.offset_ms) > MAX_INT32) return invalid('offset_ms zu groß');
        // Lokale Web-App: Versatz 0, nichts zu speichern (§11.5)
        if (this.deviceId) {
          storeClockOffset(this.hub.db, this.deviceId, parsed.data.offset_ms).catch((error: unknown) =>
            this.hub.logger.warn({ err: error }, 'Sync: time.offset nicht gespeichert'),
          );
        }
        return;
      }
      case 'presence': {
        const parsed = SyncPresenceSchema.safeParse(msg);
        if (!parsed.success) return invalid(zodSummary(parsed.error));
        const { session_id, notebook_id, page_id } = parsed.data;
        this.presence = { session_id, notebook_id, page_id };
        this.hub.broadcastEvent(this.presenceEvent(), { exclude: this });
        return;
      }
      case 'subscribe': {
        const parsed = SyncSubscribeSchema.safeParse(msg);
        if (!parsed.success) return invalid(zodSummary(parsed.error));
        const streams = parsed.data.streams;
        this.subChain = this.subChain
          .then(() => this.handleSubscribe(streams))
          .catch((error: unknown) => this.unexpected(error));
        return;
      }
      case 'unsubscribe': {
        const parsed = SyncUnsubscribeSchema.safeParse(msg);
        if (!parsed.success) return invalid(zodSummary(parsed.error));
        const streams = parsed.data.streams;
        this.subChain = this.subChain.then(() => {
          for (const stream of streams) this.dropSubscription(stream);
        });
        return;
      }
      case 'hello':
        return invalid('hello ist nur einmal pro Verbindung erlaubt');
      default:
        return invalid('unbekannter Nachrichtentyp');
    }
  }

  // ---- Anmeldung (§11.1) ---------------------------------------------------------------------------------

  private async handleHello(msg: unknown): Promise<void> {
    this.phase = 'hello';
    if (this.helloTimer) clearTimeout(this.helloTimer);
    const obj = msg !== null && typeof msg === 'object' ? (msg as Record<string, unknown>) : null;
    if (!obj || obj.type !== 'hello') return this.fatal('hello_required', CLOSE.helloMissing);
    if (obj.protocol !== 1) return this.fatal('protocol_unsupported', CLOSE.protocol);
    const parsed = SyncHelloSchema.safeParse(obj);
    if (!parsed.success) {
      // Lücke im Vertrag: kein Schließcode für hello_invalid. 4408 = „kein gültiges hello“
      return this.fatal('hello_invalid', CLOSE.helloMissing, {
        message: `hello ist ungültig: ${zodSummary(parsed.error)}`,
      });
    }
    const hello = parsed.data;
    const positions = dedupePositions(hello.streams);
    if (positions.length > syncLimits.maxStreamsPerConnection) {
      return this.fatal('hello_invalid', CLOSE.helloMissing, { message: 'Zu viele Ströme.' });
    }
    // Gegenprobe (§11.1). Lokal gibt es kein Token, also nichts zu vergleichen: device_id wird ignoriert
    if (this.deviceId !== null && hello.device_id !== undefined && hello.device_id !== this.deviceId) {
      return this.fatal('device_token_invalid', CLOSE.tokenInvalid);
    }
    if (!this.hub.listenerReady) {
      return this.fatal('internal_error', CLOSE.retry, {
        retryable: true,
        message: 'Der Sync-Server ist noch nicht bereit. Bitte später neu verbinden.',
      });
    }

    let dbEpoch: string;
    let resume: SyncResume[];
    try {
      dbEpoch = await readDbEpoch(this.hub.db);
      resume = await computeResume(this.hub.db, positions);
      if (this.deviceId) {
        this.deviceName = await readDeviceName(this.hub.db, this.deviceId);
        await storeAppVersion(
          this.hub.db,
          this.deviceId,
          hello.app_version.slice(0, syncLimits.maxAppVersionLength),
        );
      }
    } catch (error) {
      this.hub.logger.error({ err: error }, 'Sync: hello gescheitert');
      return this.fatal('internal_error', CLOSE.retry, { retryable: true });
    }
    if (this.isClosed()) return;

    this.client = hello.client;
    const started = this.applyResume(resume);
    this.phase = 'open';
    this.send({
      type: 'welcome',
      protocol: 1,
      server_time: Date.now(),
      server_version: this.hub.version,
      db_epoch: dbEpoch,
      device_id: this.deviceId,
      resume,
    });
    this.hub.broadcastEvent(
      {
        type: 'event',
        name: 'device.connection',
        data: { client: this.client, device_id: this.deviceId, connected: true },
      },
      { exclude: this },
    );
    const catchUps = started.map((sub) => this.runCatchUp(sub));
    for (const { msg: queued, bytes } of this.queuedBeforeWelcome.splice(0)) this.route(queued, bytes);

    // Erst die fehlenden Operationen, dann der aktuelle Stand der anderen Clients (§11.1)
    await Promise.all(catchUps);
    if (this.phase !== 'open') return;
    for (const other of this.hub.openConnections()) {
      if (other === this) continue;
      this.send({
        type: 'event',
        name: 'device.connection',
        data: { client: other.client, device_id: other.deviceId, connected: true },
      });
      if (other.presence) this.send(other.presenceEvent());
    }
  }

  presenceEvent(): SyncEvent {
    return {
      type: 'event',
      name: 'presence',
      data: {
        client: this.client,
        device_id: this.deviceId,
        device_name: this.deviceName,
        session_id: this.presence?.session_id ?? null,
        notebook_id: this.presence?.notebook_id ?? null,
        page_id: this.presence?.page_id ?? null,
      },
    };
  }

  // ---- Abos und Nachlieferung ----------------------------------------------------------------------------

  /** Abos nach der Resume-Prüfung setzen. Bei `reset` sendet der Server für den Strom nichts (kein Abo) */
  private applyResume(resume: SyncResume[]): Subscription[] {
    const started: Subscription[] = [];
    for (const r of resume) {
      this.dropSubscription(r.stream);
      if (r.reset) continue;
      const sub: Subscription = { stream: r.stream, sentSeq: r.from_seq - 1, catchingUp: true, buffer: [] };
      this.subs.set(r.stream, sub);
      this.hub.addSubscriber(r.stream, this);
      started.push(sub);
    }
    return started;
  }

  private dropSubscription(stream: string): void {
    if (!this.subs.delete(stream)) return;
    this.hub.removeSubscriber(stream, this);
    this.flushDeferredEvents();
  }

  private async handleSubscribe(streams: SyncStreamPosition[]): Promise<void> {
    if (this.phase !== 'open') return;
    const positions = dedupePositions(streams);
    const total = new Set([...this.subs.keys(), ...positions.map((p) => p.stream)]).size;
    if (total > syncLimits.maxStreamsPerConnection) {
      this.sendError('message_invalid', { message: 'Zu viele abonnierte Ströme.' });
      return;
    }
    let resume: SyncResume[];
    try {
      resume = await computeResume(this.hub.db, positions);
    } catch (error) {
      this.hub.logger.error({ err: error }, 'Sync: subscribe gescheitert');
      return this.fatal('internal_error', CLOSE.retry, { retryable: true });
    }
    if (this.phase !== 'open') return;
    const started = this.applyResume(resume);
    this.send({ type: 'subscribed', resume });
    for (const sub of started) void this.runCatchUp(sub);
  }

  /**
   * Liefert die Operationen nach `sub.sentSeq` aus `sync_op` nach. Was der Hook währenddessen bringt, wartet in
   * `sub.buffer`. Das Ende (Puffer leer, `catchingUp = false`) passiert ohne `await` dazwischen, so geht nichts
   * verloren und nichts kommt doppelt.
   */
  private async runCatchUp(sub: Subscription): Promise<void> {
    const current = () => this.phase === 'open' && this.subs.get(sub.stream) === sub;
    try {
      for (;;) {
        if (!current()) return;
        // Begrenzt pro Verbindung und global, damit viele Abos den DB-Pool nicht belegen
        const rows = await this.catchUpQueries.run(() =>
          this.hub.catchUpQueries.run(() =>
            current()
              ? loadOpsAfter(this.hub.db, sub.stream, sub.sentSeq, syncLimits.catchUpBatch)
              : Promise.resolve(null),
          ),
        );
        if (!rows || !current()) return;
        for (const row of rows) this.deliver(row, true);
        if (rows.length === syncLimits.catchUpBatch) {
          if (!(await this.drained())) return;
          continue;
        }
        sub.buffer.sort((a, b) => a.seq - b.seq);
        while (sub.buffer.length > 0) {
          const next = sub.buffer[0]!;
          if (next.seq <= sub.sentSeq) sub.buffer.shift();
          else if (next.seq === sub.sentSeq + 1) this.deliver(sub.buffer.shift()!, true);
          else break;
        }
        if (sub.buffer.length === 0) {
          sub.catchingUp = false;
          this.flushDeferredEvents();
          return;
        }
        // Lücke vor dem Puffer: Die fehlenden Operationen sind committet, die nächste Abfrage findet sie
      }
    } catch (error) {
      this.hub.logger.error({ err: error, stream: sub.stream }, 'Sync: Nachlieferung gescheitert');
      this.fatal('internal_error', CLOSE.retry, { retryable: true });
    }
  }

  /**
   * Eine committete Operation an diese Verbindung: als `ack`, wenn sie hier unbeantwortet ist, sonst als
   * Weitergabe an Abonnenten. Pro Strom in `seq`-Reihenfolge (§11.2).
   */
  deliver(op: CommittedOp, fromCatchUp: boolean): void {
    if (this.phase === 'closed') return;
    const sub = this.subs.get(op.stream);
    if (sub) {
      if (op.seq <= sub.sentSeq) return;
      if (sub.catchingUp && !fromCatchUp) {
        sub.buffer.push(op);
        return;
      }
      if (op.seq !== sub.sentSeq + 1) {
        // Lücke (sollte nicht vorkommen): aus der Datenbank nachliefern
        sub.buffer.push(op);
        if (!sub.catchingUp) {
          sub.catchingUp = true;
          void this.runCatchUp(sub);
        }
        return;
      }
      sub.sentSeq = op.seq;
    }
    const entry = this.matchPending(op);
    if (entry) {
      this.send({ type: 'ack', op_id: op.opId, stream: op.stream, seq: op.seq });
      this.answer(entry);
      return;
    }
    if (!sub) return;
    this.send({
      type: 'op',
      op_id: op.opId,
      stream: op.stream,
      kind: op.kind,
      at: op.at,
      clock_uncertain: op.clockUncertain,
      data: op.data,
      seq: op.seq,
      origin: op.origin,
    } as SyncOp);
  }

  private matchPending(op: CommittedOp): PendingEntry | null {
    let dataKey: string | null = null;
    for (const entry of this.pending) {
      if (entry.answered || entry.opId !== op.opId) continue;
      if (entry.stream !== op.stream || entry.kind !== op.kind) continue;
      dataKey ??= canonicalJson(op.data);
      if (entry.dataKey === dataKey) return entry;
    }
    return null;
  }

  // ---- Operationen (§11.2, §16.2) ------------------------------------------------------------------------

  private receiveOp(msg: Record<string, unknown>, bytes: number): void {
    const entry: PendingEntry = {
      conn: this,
      opId: isUuid(msg.op_id) ? msg.op_id : null,
      stream: isStream(msg.stream) ? msg.stream : null,
      kind: null,
      dataKey: null,
      answered: false,
      timer: null,
    };
    this.pending.push(entry);

    if (this.pending.length > syncLimits.maxPendingOps) {
      // Die schon empfangenen Operationen laufen noch durch, danach Fehler und 4503
      this.stopReading = true;
      this.opChain = this.opChain.then(async () => {
        if (this.halted) return;
        await this.failOp(entry, 'too_many_pending', { retryable: true, closeCode: CLOSE.retry });
      });
      return;
    }

    this.inboundBytes += bytes;
    if (!this.paused && this.inboundBytes > syncLimits.inboundPauseBytes) {
      this.paused = true;
      this.socket.pause();
    }
    this.opChain = this.opChain
      .then(() => this.processOp(msg, entry))
      .catch((error: unknown) => {
        this.hub.logger.error({ err: error }, 'Sync: Fehler im Dispatcher');
        return this.failOp(entry, 'internal_error', { retryable: true, closeCode: CLOSE.retry });
      })
      .finally(() => {
        this.inboundBytes -= bytes;
        if (this.paused && this.inboundBytes < syncLimits.inboundResumeBytes && this.phase !== 'closed') {
          this.paused = false;
          this.socket.resume();
        }
      });
  }

  private async processOp(msg: Record<string, unknown>, entry: PendingEntry): Promise<void> {
    if (this.halted || entry.answered) return;

    // seq und origin setzt nur der Server (§11.2)
    if ('seq' in msg || 'origin' in msg) {
      return this.rejectOp(entry, 'message_invalid', 'seq und origin setzt nur der Server.');
    }
    if (typeof msg.kind === 'string' && SERVER_ONLY_KINDS.has(msg.kind as SyncOp['kind'])) {
      return this.rejectOp(entry, 'op_not_allowed');
    }
    const parsed = SyncOpSchema.safeParse(msg);
    if (!parsed.success) {
      const known = SyncOpSchema.options.some((o) => o.shape.kind.value === msg.kind);
      return this.rejectOp(
        entry,
        'message_invalid',
        known
          ? `Operation ungültig: ${zodSummary(parsed.error)}`
          : `Unbekannte Operation: ${String(msg.kind)}`,
      );
    }
    const op = parsed.data;
    entry.opId = op.op_id;
    entry.stream = op.stream;
    entry.kind = op.kind;
    entry.dataKey = canonicalJson(op.data);
    // Ab hier kann der Hook das ack zuordnen (auch für ein gleichzeitiges Duplikat einer anderen Verbindung)
    this.hub.registerInflight(entry);

    // Duplikate zentral vor dem Handler (§16.2)
    const existing = await findOpById(this.hub.db, op.op_id);
    if (this.halted || entry.answered) return;
    if (existing) {
      const same =
        existing.stream === op.stream &&
        existing.kind === op.kind &&
        canonicalJson(existing.data) === entry.dataKey;
      if (!same) return this.rejectOp(entry, 'op_id_reused', undefined, { op_id: op.op_id });
      return this.duplicateAck(entry, existing.stream, existing.seq);
    }

    const registration = getOpRegistration(op.kind);
    if (!registration) {
      // Server-Lücke, kein Fehler des Clients: wiederholbar (der Client legt sie nach 5 Versuchen ab, §11.2)
      this.hub.logger.error({ kind: op.kind }, 'Sync: kein Handler registriert');
      return this.failOp(entry, 'internal_error', {
        retryable: true,
        closeCode: CLOSE.retry,
        details: { reason: 'handler_missing', kind: op.kind },
      });
    }

    const origin = this.client;
    try {
      await this.hub.db.transaction(async (tx) => {
        // Reihenfolge (§16.2): Sperren des Handlers, dann sync_stream (appendOp), dann der Handler
        if (registration.preLock) await registration.preLock(tx, op);
        const result = await appendOp(tx, op.stream, {
          kind: op.kind,
          data: op.data,
          at: op.at,
          clockUncertain: op.clock_uncertain,
          origin,
          opId: op.op_id,
          deviceId: this.deviceId,
        });
        // Gleichzeitiges Duplikat: nichts geschrieben, Rollback, ursprüngliches ack
        if (result.duplicate) throw new DuplicateOp(result.seq);
        await registration.handler(tx, op, { deviceId: this.deviceId, origin });
      });
    } catch (error) {
      if (error instanceof DuplicateOp) return this.duplicateAck(entry, op.stream, error.seq);
      if (error instanceof SyncOpError) {
        if (error.retryable) {
          return this.failOp(entry, error.code, {
            retryable: true,
            closeCode: CLOSE.retry,
            details: error.details,
          });
        }
        // session_superseded ist immer fatal (§11.2, §9.2), auch wenn der Handler fatal nicht setzt
        if (error.code === 'session_superseded' || error.fatal) {
          const closeCode =
            error.code === 'session_superseded'
              ? CLOSE.superseded
              : error.code === 'device_token_invalid'
                ? CLOSE.tokenInvalid
                : CLOSE.policyViolation;
          return this.failOp(entry, error.code, {
            retryable: false,
            closeCode,
            details: error.details,
          });
        }
        return this.rejectOp(entry, error.code, undefined, error.details);
      }
      this.hub.logger.error({ err: error, kind: op.kind, opId: op.op_id }, 'Sync: Operation gescheitert');
      return this.failOp(entry, 'internal_error', { retryable: true, closeCode: CLOSE.retry });
    }
    // Committet: Das ack kommt über den Hook. Bleibt es aus, ist die Auslieferung gestört
    this.armAckWatchdog(entry);
  }

  private armAckWatchdog(entry: PendingEntry): void {
    if (entry.answered || entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (entry.answered || this.phase === 'closed') return;
      this.hub.logger.warn({ opId: entry.opId }, 'Sync: ack blieb aus, Verbindung wird neu aufgebaut');
      this.stopReading = true;
      this.halted = true;
      this.sendError('internal_error', {
        retryable: true,
        fatal: true,
        opId: entry.opId,
        stream: entry.stream,
        details: { reason: 'ack_timeout' },
      });
      this.answer(entry);
      this.closeWith(CLOSE.retry, 'internal_error');
    }, syncLimits.ackTimeoutMs);
  }

  /**
   * Erneutes `ack` für eine schon gespeicherte Operation. Erst wenn der Versand des Stroms die ursprüngliche
   * `seq` erreicht hat, sonst könnte es vor früheren Operationen ankommen (§16.2).
   */
  private async duplicateAck(entry: PendingEntry, stream: string, seq: number): Promise<void> {
    if (entry.answered) return;
    const sub = this.subs.get(stream);
    if (sub && sub.sentSeq < seq) {
      // Abonniert und noch nicht so weit: `deliver` beantwortet die Operation, sobald sie an der Reihe ist
      // (Nachlieferung oder Hook, beide laufen bis mindestens `seq`)
      this.armAckWatchdog(entry);
      return;
    }
    if (!sub) {
      const reached = await this.hub.waitForCursor(stream, seq, syncLimits.ackTimeoutMs);
      if (entry.answered || this.halted) return;
      if (!reached) {
        return this.failOp(entry, 'internal_error', {
          retryable: true,
          closeCode: CLOSE.retry,
          details: { reason: 'ack_timeout' },
        });
      }
    }
    if (!(await this.waitPrior(entry)) || entry.answered) return;
    this.send({ type: 'ack', op_id: entry.opId!, stream, seq });
    this.answer(entry);
  }

  /** Nicht wiederholbarer Fehler einer Operation, die Verbindung bleibt offen */
  private async rejectOp(
    entry: PendingEntry,
    code: SyncErrorCode,
    message?: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    if (!(await this.waitPrior(entry)) || entry.answered) return;
    this.sendError(code, {
      retryable: false,
      fatal: false,
      opId: entry.opId,
      stream: entry.stream,
      ...(message ? { message } : {}),
      ...(details ? { details } : {}),
    });
    this.answer(entry);
  }

  /**
   * Fataler Fehler einer Operation: Vorher bekommen alle früheren Operationen dieser Verbindung ihr `ack`
   * (sonst schriebe der Client nach `session_superseded` auch schon gespeicherte Operationen um), dann
   * `error` mit `fatal = true` und Schließen. Danach wird nichts mehr bearbeitet.
   */
  private async failOp(
    entry: PendingEntry,
    code: SyncErrorCode,
    options: { retryable: boolean; closeCode: number; details?: Record<string, unknown> | undefined },
  ): Promise<void> {
    if (this.phase === 'closed') return;
    this.halted = true;
    this.stopReading = true;
    await this.waitPrior(entry);
    if (this.isClosed()) return;
    this.sendError(code, {
      retryable: options.retryable,
      fatal: true,
      opId: entry.opId,
      stream: entry.stream,
      ...(options.details ? { details: options.details } : {}),
    });
    this.answer(entry);
    this.closeWith(options.closeCode, code);
  }

  /** Wartet, bis alle vor `entry` empfangenen Operationen beantwortet sind. `false` bei Zeitüberschreitung oder Ende */
  private waitPrior(entry: PendingEntry): Promise<boolean> {
    const ready = () => this.pending.indexOf(entry) <= 0;
    if (ready()) return Promise.resolve(this.phase !== 'closed');
    return new Promise((resolve) => {
      const check = () => {
        if (this.phase === 'closed') {
          finish(false);
        } else if (ready()) {
          finish(true);
        }
      };
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        this.pendingWaiters.delete(check);
        resolve(ok);
      };
      const timer = setTimeout(() => {
        this.pendingWaiters.delete(check);
        if (this.phase !== 'closed') {
          this.hub.logger.warn(
            'Sync: frühere Operationen blieben unbeantwortet, Verbindung wird neu aufgebaut',
          );
          this.stopReading = true;
          this.halted = true;
          this.sendError('internal_error', {
            retryable: true,
            fatal: true,
            details: { reason: 'ack_timeout' },
          });
          this.closeWith(CLOSE.retry, 'internal_error');
        }
        resolve(false);
      }, syncLimits.ackTimeoutMs);
      this.pendingWaiters.add(check);
    });
  }

  private answer(entry: PendingEntry): void {
    if (entry.answered) return;
    entry.answered = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    this.hub.unregisterInflight(entry);
    const index = this.pending.indexOf(entry);
    if (index >= 0) this.pending.splice(index, 1);
    this.notifyPending();
  }

  private notifyPending(): void {
    for (const check of [...this.pendingWaiters]) check();
  }
}

/** Doppelte Ströme in einer Liste: der letzte Eintrag gilt */
function dedupePositions(positions: SyncStreamPosition[]): SyncStreamPosition[] {
  const map = new Map<string, SyncStreamPosition>();
  for (const p of positions) map.set(p.stream, p);
  return [...map.values()];
}
