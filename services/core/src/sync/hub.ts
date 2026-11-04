// Zentrale des Sync-Servers (VERTRAEGE §11, §16.2): alle Verbindungen, Abos, unbeantwortete Operationen und der
// geordnete Versand nach dem Commit.
//
// Reihenfolge: `listenCommittedOps` (append.ts) ruft `onOpCommitted` für alle Ströme nacheinander auf, je Strom
// lückenlos in `seq`-Reihenfolge. Weitergaben an Abonnenten UND das `ack` an den Absender laufen beide hier durch.
// So kommt `ack n+1` nie vor der Operation `n` beim Client an (§11.2). Server-Ereignisse aus `publishAfterCommit`
// laufen über dieselbe Kette (Kanal `sg_event`, siehe server.ts).
import type { FastifyBaseLogger } from 'fastify';
import type { SyncEvent } from '@sg/shared';
import type { Db } from '../db/client.ts';
import type { CommittedOp } from './append.ts';
import type { PendingEntry, SyncConnection } from './connection.ts';

export interface SyncHubOptions {
  db: Db;
  logger: FastifyBaseLogger;
  version: string;
}

interface CursorWaiter {
  seq: number;
  resolve: (reached: boolean) => void;
  timer: NodeJS.Timeout;
}

export class SyncHub {
  readonly db: Db;
  readonly logger: FastifyBaseLogger;
  readonly version: string;
  /** true, sobald `listenCommittedOps` läuft und der Hook gesetzt ist. Vorher lehnt der Server `hello` ab (4503) */
  listenerReady = false;

  private readonly connections = new Set<SyncConnection>();
  private readonly subscribers = new Map<string, Set<SyncConnection>>();
  /** Unbeantwortete Operationen aller Verbindungen nach `op_id`, damit der Hook das `ack` zuordnen kann */
  private readonly inflight = new Map<string, Set<PendingEntry>>();
  /** Höchste `seq` je Strom, die der Hook ausgeliefert hat (bzw. beim Start schon da war) */
  private readonly delivered = new Map<string, number>();
  private readonly cursorWaiters = new Map<string, Set<CursorWaiter>>();

  constructor(options: SyncHubOptions) {
    this.db = options.db;
    this.logger = options.logger;
    this.version = options.version;
  }

  /** Startwerte der Cursor: Was beim Start schon committet war, gilt als ausgeliefert */
  initDelivered(heads: Map<string, number>): void {
    for (const [stream, seq] of heads) {
      if (seq > (this.delivered.get(stream) ?? 0)) this.delivered.set(stream, seq);
    }
  }

  // ---- Verbindungen --------------------------------------------------------------------------------------

  add(conn: SyncConnection): void {
    this.connections.add(conn);
  }

  remove(conn: SyncConnection): void {
    this.connections.delete(conn);
    for (const set of this.subscribers.values()) set.delete(conn);
  }

  /** Verbindungen nach `welcome` (für Präsenz, Ereignisse, `isDeviceConnected`) */
  openConnections(): SyncConnection[] {
    return [...this.connections].filter((c) => c.isOpen());
  }

  isDeviceConnected(deviceId: string): boolean {
    return this.openConnections().some((c) => c.deviceId === deviceId);
  }

  closeDeviceConnections(deviceId: string, code: number): void {
    for (const conn of [...this.connections]) {
      if (conn.deviceId === deviceId) conn.closeWith(code, 'device_closed');
    }
  }

  /** Alle Verbindungen schließen (Herunterfahren) */
  closeAll(code: number, reason: string): void {
    for (const conn of [...this.connections]) conn.closeWith(code, reason);
  }

  addSubscriber(stream: string, conn: SyncConnection): void {
    let set = this.subscribers.get(stream);
    if (!set) {
      set = new Set();
      this.subscribers.set(stream, set);
    }
    set.add(conn);
  }

  removeSubscriber(stream: string, conn: SyncConnection): void {
    const set = this.subscribers.get(stream);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) this.subscribers.delete(stream);
  }

  // ---- Unbeantwortete Operationen ------------------------------------------------------------------------

  registerInflight(entry: PendingEntry): void {
    if (!entry.opId) return;
    let set = this.inflight.get(entry.opId);
    if (!set) {
      set = new Set();
      this.inflight.set(entry.opId, set);
    }
    set.add(entry);
  }

  unregisterInflight(entry: PendingEntry): void {
    if (!entry.opId) return;
    const set = this.inflight.get(entry.opId);
    if (!set) return;
    set.delete(entry);
    if (set.size === 0) this.inflight.delete(entry.opId);
  }

  // ---- Versand nach dem Commit ---------------------------------------------------------------------------

  /**
   * Hook für `setOnOpCommitted`. Wirft nie: Fehler beim Senden behandelt jede Verbindung selbst (sie trennt
   * sich dann, der Client holt beim Neuverbinden nach). Sonst bliebe der Cursor in `listenCommittedOps` stehen
   * und alle anderen Clients bekämen die Operation mehrfach.
   */
  readonly onOpCommitted = (op: CommittedOp): void => {
    try {
      const targets = new Set<SyncConnection>(this.subscribers.get(op.stream));
      for (const entry of this.inflight.get(op.opId) ?? []) targets.add(entry.conn);
      for (const conn of targets) {
        try {
          conn.deliver(op, false);
        } catch (error) {
          this.logger.warn({ err: error, stream: op.stream, seq: op.seq }, 'Sync: Auslieferung gescheitert');
          conn.terminate();
        }
      }
    } catch (error) {
      this.logger.error({ err: error, stream: op.stream, seq: op.seq }, 'Sync: Fehler im Versand-Hook');
    } finally {
      this.advanceCursor(op.stream, op.seq);
    }
  };

  private advanceCursor(stream: string, seq: number): void {
    if (seq <= (this.delivered.get(stream) ?? 0)) return;
    this.delivered.set(stream, seq);
    const waiters = this.cursorWaiters.get(stream);
    if (!waiters) return;
    for (const w of [...waiters]) {
      if (w.seq <= seq) {
        clearTimeout(w.timer);
        waiters.delete(w);
        w.resolve(true);
      }
    }
    if (waiters.size === 0) this.cursorWaiters.delete(stream);
  }

  /**
   * Wartet, bis der Versand des Stroms `seq` erreicht hat (erneutes `ack` eines Duplikats, §16.2).
   * `false` nach `timeoutMs`.
   */
  waitForCursor(stream: string, seq: number, timeoutMs: number): Promise<boolean> {
    if ((this.delivered.get(stream) ?? 0) >= seq) return Promise.resolve(true);
    return new Promise((resolve) => {
      let set = this.cursorWaiters.get(stream);
      if (!set) {
        set = new Set();
        this.cursorWaiters.set(stream, set);
      }
      const waiter: CursorWaiter = {
        seq,
        resolve,
        timer: setTimeout(() => {
          set.delete(waiter);
          resolve(false);
        }, timeoutMs),
      };
      set.add(waiter);
    });
  }

  // ---- Ereignisse ----------------------------------------------------------------------------------------

  /** Ereignis an alle offenen Verbindungen. `localOnly`: nur lokale Clients (ohne Gerät). `exclude`: nicht an diese */
  broadcastEvent(event: SyncEvent, options: { localOnly?: boolean; exclude?: SyncConnection } = {}): void {
    for (const conn of this.openConnections()) {
      if (conn === options.exclude) continue;
      if (options.localOnly && conn.deviceId !== null) continue;
      try {
        conn.send(event);
      } catch (error) {
        this.logger.warn({ err: error }, 'Sync: Ereignis konnte nicht gesendet werden');
        conn.terminate();
      }
    }
  }

  /** Aufräumen beim Herunterfahren: wartende Duplikate geben auf */
  dispose(): void {
    for (const set of this.cursorWaiters.values()) {
      for (const w of set) {
        clearTimeout(w.timer);
        w.resolve(false);
      }
    }
    this.cursorWaiters.clear();
  }
}

let activeHub: SyncHub | null = null;

/** Der laufende Sync-Server (eine Core-Instanz pro Prozess). `null` ohne Sync, z. B. in Unit-Tests */
export function getActiveHub(): SyncHub | null {
  return activeHub;
}

export function setActiveHub(hub: SyncHub | null): void {
  activeHub = hub;
}
