// Grenzen des Sync-Servers (VERTRAEGE §11). Werte aus dem Vertrag sind markiert, der Rest ist Schutz.
// Tests dürfen das Objekt vor dem Start der App ändern (kürzere Zeiten).

export interface SyncLimits {
  /** §11: höchstens 1 MB pro Nachricht. Als 1 MiB gelesen, damit beide Lesarten des Clients passen */
  maxMessageBytes: number;
  /** §11.1: `hello` innerhalb von 5 s */
  helloTimeoutMs: number;
  /** §11.4: Der Server schließt Verbindungen, von denen 60 s nichts kam */
  idleTimeoutMs: number;
  /** §11.2: Ein Client mit höchstens 200 unbeantworteten Operationen bekommt `too_many_pending` nie */
  maxPendingOps: number;
  /** Abonnierte Ströme pro Verbindung (Schutz, nicht im Vertrag) */
  maxStreamsPerConnection: number;
  /** Nicht-Op-Nachrichten (ping, presence, subscribe …): Eimer mit `controlBurst` Marken, `controlPerSecond` nachgefüllt */
  controlPerSecond: number;
  controlBurst: number;
  /** Nachrichten, die während der Bearbeitung von `hello` ankommen und warten (Schutz): Anzahl und Bytes */
  maxQueuedBeforeWelcome: number;
  maxQueuedBytesBeforeWelcome: number;
  /** Ereignisse, die pro Verbindung hinter einer laufenden Nachlieferung warten (§11.6). Darüber: Trennen */
  maxDeferredEvents: number;
  /** Gleichzeitige Abfragen der Nachlieferung: global und pro Verbindung (DB-Pool hat 10 Verbindungen) */
  maxCatchUpQueries: number;
  maxCatchUpQueriesPerConnection: number;
  /** Längste Wartezeit, bis ein Client seinen Puffer während der Nachlieferung leert. Danach: Trennen */
  maxDrainWaitMs: number;
  /** `hello.app_version` wird auf diese Länge gekürzt gespeichert */
  maxAppVersionLength: number;
  /** Empfangene, noch nicht bearbeitete Op-Bytes: darüber pausiert der Server das Lesen, darunter liest er weiter */
  inboundPauseBytes: number;
  inboundResumeBytes: number;
  /** Ausgehender Puffer eines Clients: darüber wird die Verbindung getrennt (langsamer Client, Neuverbinden holt nach) */
  maxBufferedBytes: number;
  /** Nachlieferung aus `sync_op` in Paketen */
  catchUpBatch: number;
  /**
   * Längste Wartezeit auf das `ack` einer committeten Operation bzw. auf den Cursor (Duplikat). Danach gilt die
   * Auslieferung als gestört: `internal_error`, Code 4503, der Client sendet erneut.
   */
  ackTimeoutMs: number;
}

export const syncLimits: SyncLimits = {
  maxMessageBytes: 1024 * 1024,
  helloTimeoutMs: 5_000,
  idleTimeoutMs: 60_000,
  maxPendingOps: 200,
  maxStreamsPerConnection: 2_000,
  controlPerSecond: 50,
  controlBurst: 200,
  maxQueuedBeforeWelcome: 1_000,
  maxQueuedBytesBeforeWelcome: 8 * 1024 * 1024,
  maxDeferredEvents: 10_000,
  maxCatchUpQueries: 4,
  maxCatchUpQueriesPerConnection: 2,
  maxDrainWaitMs: 30_000,
  maxAppVersionLength: 64,
  inboundPauseBytes: 8 * 1024 * 1024,
  inboundResumeBytes: 2 * 1024 * 1024,
  maxBufferedBytes: 32 * 1024 * 1024,
  catchUpBatch: 500,
  ackTimeoutMs: 30_000,
};

/** WebSocket-Schließcodes (VERTRAEGE §15) */
export const CLOSE = {
  /** Token ungültig oder widerrufen */
  tokenInvalid: 4401,
  /** kein (gültiges) `hello` */
  helloMissing: 4408,
  /** Protokollversion */
  protocol: 4426,
  /** nach `session_superseded` */
  superseded: 4409,
  /** nach einem wiederholbaren Fehler */
  retry: 4503,
  /** Standardcodes (RFC 6455) */
  goingAway: 1001,
  unsupportedData: 1003,
  policyViolation: 1008,
} as const;
