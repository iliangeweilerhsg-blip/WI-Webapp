// Gemeinsame Typen des Web-Sync-Clients (VERTRAEGE §11, §16.2).
import type {
  NotebookDeleteOp,
  NotebookRestoreOp,
  NotebookUpdateOp,
  PageRestoreOp,
  PageUpdateFields,
  SyncAck,
  SyncEvent,
  SyncOp,
} from '@sg/shared';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Operationen, die ein Client schreiben darf. `notebook.update/.delete/.restore` und `page.restore` sind Server-only (§11.2). */
export type ClientSyncOp = Exclude<
  SyncOp,
  NotebookUpdateOp | NotebookDeleteOp | NotebookRestoreOp | PageRestoreOp
>;

/** Operation in der Ausgangswarteschlange: ohne `seq` und `origin` (die setzt nur der Server). */
export type QueuedOp = DistributiveOmit<ClientSyncOp, 'seq' | 'origin'>;

/** Eingabe für `send`. `op_id`, `at` und `clock_uncertain` ergänzt der Client, wenn sie fehlen. */
export type SendOpInput = DistributiveOmit<QueuedOp, 'type' | 'op_id' | 'at' | 'clock_uncertain'> & {
  type?: 'op';
  op_id?: string;
  at?: number;
  clock_uncertain?: boolean;
};

export type { SyncAck };

/** Warum eine Operation in der Fehlerablage gelandet ist. */
export type ShelfReasonKind =
  /** vom Server endgültig abgelehnt (`retryable = false`) */
  | 'rejected'
  /** verwendet eine ID, die erst durch eine abgelehnte Operation entstanden wäre (transitiv) */
  | 'dependent'
  /** dieselbe `op_id` scheiterte 5-mal mit `internal_error` */
  | 'poison'
  /** der Fachcode konnte einen `page_version_conflict` nicht auflösen */
  | 'conflict_unresolved';

export interface ShelfReason {
  kind: ShelfReasonKind;
  /** Fehlercode des Servers (String, auch unbekannte Codes) */
  code: string;
  message: string;
  /** `op_id` der Operation, die die Ablage ausgelöst hat (bei `dependent`) */
  causedBy: string | null;
}

export interface QueueEntry {
  /** Aufsteigender Schlüssel = Entstehungsreihenfolge. Wird nie wiederverwendet. */
  key: number;
  op: QueuedOp;
  /** Anzahl `internal_error` für diese `op_id` (Giftige Operation, §11.2) */
  failures: number;
  /** Anzahl aufgelöster `page_version_conflict` für diese `op_id` */
  conflicts: number;
  /** Wurde schon einmal gesendet? Dann wird sie nicht mehr uhrkorrigiert (§11.5), sonst gäbe es `op_id_reused` */
  sent: boolean;
}

export interface ShelfEntry {
  id: number;
  shelvedAt: number;
  op: QueuedOp;
  reason: ShelfReason;
}

export type NewShelfEntry = Omit<ShelfEntry, 'id'>;

/** Strom-Position, die der Fachcode beim Abonnieren bzw. nach einem `reset` liefert. */
export interface StreamPosition {
  lastSeq: number;
  lastOpId: string | null;
}

export type ResetReason = 'unknown_position' | 'db_epoch_changed';

export interface ResetInfo {
  stream: string;
  reason: ResetReason;
  /** `head_seq` laut Server (bei `db_epoch_changed` ohne Aussage über den Strom: 0) */
  headSeq: number;
}

/**
 * Wird bei `reset` aufgerufen (§11.1): Strom per REST laden, lokalen Stand abgleichen, fehlende eigene Daten
 * über `client.send` erneut senden, entfernte löschen. Liefert `stream_seq`/`stream_op_id` des Snapshots.
 */
export type ResetHandler = (info: ResetInfo) => Promise<StreamPosition>;

export interface PageConflictContext {
  /** Die abgelehnte `page.update`-Operation */
  op: Extract<QueuedOp, { kind: 'page.update' }>;
  message: string;
}

/**
 * Hook des Fachcodes für `page_version_conflict` (§11.2): Seite per REST neu laden, die eigenen geänderten Felder
 * auf den Serverstand legen und beides zurückgeben. `version` ist die aktuelle Version des Servers. `null` oder ein
 * Fehler: die Operation kommt in die Fehlerablage.
 */
export type PageConflictResolver = (
  ctx: PageConflictContext,
) => Promise<{ fields: PageUpdateFields; version: number } | null>;

export type ConnectionState =
  'idle' | 'other_tab' | 'connecting' | 'syncing' | 'online' | 'backoff' | 'failed' | 'closed';

export interface ClockInfo {
  offsetMs: number;
  rttMs: number;
  /** Versatz so groß, dass etwas nicht stimmt (Web-App und Core teilen sich eine Uhr) */
  suspicious: boolean;
}

/** Ereignisse des Clients. Server-Ereignisse (§11.6) heißen wie `SyncEvent['name']`. */
export interface ClientEventMap {
  'session.updated': Extract<SyncEvent, { name: 'session.updated' }>['data'];
  presence: Extract<SyncEvent, { name: 'presence' }>['data'];
  'device.connection': Extract<SyncEvent, { name: 'device.connection' }>['data'];
  'pairing.requested': Extract<SyncEvent, { name: 'pairing.requested' }>['data'];
  /** Verbindungszustand */
  connection: { state: ConnectionState; retryInMs: number | null; closeCode: number | null };
  /** Ein Strom hat `reset` gemeldet (§11.1) */
  reset: ResetInfo;
  /** Der `onReset`-Handler ist gescheitert oder fehlt; der Strom bleibt stumm, bis neu abonniert wird */
  'reset.failed': { stream: string; error: unknown };
  /** Uhrabgleich fertig */
  clock: ClockInfo;
  /** Die Fehlerablage hat sich geändert (neue Zahl) */
  shelf: { count: number };
  /** Zahl der unbestätigten Operationen hat sich geändert */
  queue: { pending: number };
  /** Die Warteschlange wurde auf eine bestehende Session umgeschrieben (4409) */
  'session.superseded': { oldSessionId: string; newSessionId: string };
  /** Dauerhafter Fehler (Anmeldung/Protokoll): der Client verbindet nicht mehr von selbst */
  fatal: { code: string; message: string };
  /** Ein anderer Tab meldet einen Leader-Wechsel: Zustand neu laden (REST) */
  'leader.changed': Record<string, never>;
  /** Eine eingehende Operation wurde übersprungen (unbekannte Art oder Enum-Wert), `seq` zählt trotzdem */
  'op.skipped': { stream: string; seq: number; kind: string | null };
}

export type ClientEventName = keyof ClientEventMap;
