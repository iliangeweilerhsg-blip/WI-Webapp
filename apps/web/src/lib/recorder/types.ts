// Gemeinsame Typen des Recorders (VERTRAEGE §10, §16.2, Ticket T1-06).
import type { AudioCodec } from '@sg/shared';

/** Länge eines Chunks (`MediaRecorder.start(timeslice)`). Spike S4 empfahl 30 s; 10 s begrenzt den Verlust beim Neuladen */
export const TIMESLICE_MS = 10_000;

/** Aufnahme-Metadaten in IndexedDB. Bleibt, bis die Aufnahme auf dem Core abgeschlossen ist. */
export interface RecordingMeta {
  id: string;
  sessionId: string;
  mime: string;
  codec: AudioCodec;
  /** Sitzungszeit des Aufnahmebeginns (`RecordingCreate.started_ms`) */
  startedMs: number;
  chunksIndependent: boolean;
  /** `POST /sessions/{id}/recordings` ist angekommen (oder die Aufnahme gab es schon) */
  created: boolean;
  /** Nächste freie `seq`. Chunks sind lückenlos ab 0 */
  nextSeq: number;
  /** Summe der Chunk-Längen */
  recordedMs: number;
  /** Wanduhr (Epochen-ms) des letzten gespeicherten Chunks bzw. des Starts. Erkennt verwaiste Aufnahmen. */
  lastActivityAt: number;
  /** Gesetzt, sobald die Aufnahme zu Ende ist. Dann folgt `POST …/complete`, sobald alle Chunks hochgeladen sind. */
  complete: { lastSeq: number; durationMs: number } | null;
  /** Der Core hat die Aufnahme abgelehnt (Session zu alt). Die Chunks liegen in der Fehlerablage, die Metadaten bleiben. */
  rejected?: string;
}

/** Ein gepufferter Chunk. Die Daten liegen als `ArrayBuffer` in IndexedDB (Blobs sind in Safari unzuverlässig). */
export interface ChunkRecord {
  recordingId: string;
  seq: number;
  startMs: number;
  durationMs: number;
  sha256: string;
  data: ArrayBuffer;
  /** Fehlgeschlagene Versuche seit dem Speichern (nur zur Anzeige) */
  attempts: number;
}

/** Fehlerablage: Chunks, die der Core dauerhaft ablehnt (409, 422 …). Die Daten bleiben erhalten. */
export interface ShelfRecord {
  id?: number;
  recordingId: string;
  /** Session der Aufnahme. Fehlt bei älteren Einträgen: die zählen für keine Session (`UploaderOptions.sessionId`) */
  sessionId?: string;
  seq: number;
  startMs: number;
  durationMs: number;
  sha256: string;
  data: ArrayBuffer;
  /** HTTP-Status der Ablehnung */
  status: number | null;
  /** Fehlercode des Core, z. B. `chunk_conflict` */
  code: string | null;
  message: string;
  shelvedAt: number;
}

export interface RecorderStore {
  putRecording(meta: RecordingMeta): Promise<void>;
  getRecording(id: string): Promise<RecordingMeta | null>;
  listRecordings(): Promise<RecordingMeta[]>;
  /** Löscht die Aufnahme samt noch gepufferten Chunks */
  deleteRecording(id: string): Promise<void>;
  /**
   * Ändert einzelne Felder der Aufnahme (lesen und schreiben in einem Schritt, sonst überschreiben sich Recorder
   * und Uploader gegenseitig). Gibt den neuen Stand zurück, oder `null`, wenn es die Aufnahme nicht mehr gibt.
   */
  patchRecording(id: string, patch: Partial<Omit<RecordingMeta, 'id'>>): Promise<RecordingMeta | null>;
  /** Speichert den Chunk und ändert die Aufnahme in einem Schritt (wie `patchRecording`) */
  addChunk(chunk: ChunkRecord, patch: Partial<Omit<RecordingMeta, 'id'>>): Promise<RecordingMeta | null>;
  /** Chunks einer Aufnahme, aufsteigend nach `seq` */
  listChunks(recordingId: string): Promise<ChunkRecord[]>;
  putChunk(chunk: ChunkRecord): Promise<void>;
  deleteChunk(recordingId: string, seq: number): Promise<void>;
  /** Verschiebt den Chunk in die Fehlerablage (Ablegen und Entfernen gemeinsam) */
  shelveChunk(entry: ShelfRecord): Promise<void>;
  listShelf(): Promise<ShelfRecord[]>;
}

export type WakeLockState = 'unsupported' | 'inactive' | 'active' | 'released';

export interface UploaderStatus {
  /** Chunks, die noch auf den Core warten (alle Aufnahmen) */
  pendingChunks: number;
  /** Intern: abgeschlossene Aufnahmen, deren `POST …/complete` noch aussteht (zählt nicht in `pendingChunks`) */
  pendingCompletes?: number;
  /** Chunks dieser Session in der Fehlerablage (nur mit gesetzter `sessionId`, sonst alle) */
  shelvedChunks: number;
  /** Letzter Versuch scheiterte an Netz oder Core (5xx) */
  offline: boolean;
  /** Wartezeit bis zum nächsten Versuch */
  retryInMs: number | null;
}

export type RecorderState =
  'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'stopped' | 'error' | 'unsupported';

/** Warum das Mikrofon nicht geöffnet werden konnte (für eine verständliche Anzeige) */
export type MicIssue = 'denied' | 'missing';

export interface RecorderStatus {
  state: RecorderState;
  /** Aktuelle bzw. zuletzt laufende Aufnahme */
  recordingId: string | null;
  /** Chunks der aktuellen Aufnahme (gespeichert) */
  chunkCount: number;
  /** Aufgenommene Länge der aktuellen Aufnahme */
  recordedMs: number;
  /** Wie oft die Aufnahme nach einem Fehler oder Ruhezustand neu begonnen wurde */
  restarts: number;
  /** Der Tab ist im Hintergrund (Hinweis nötig: Wake Lock wirkt nur im sichtbaren Tab) */
  tabHidden: boolean;
  wakeLock: WakeLockState;
  upload: UploaderStatus;
  /** Verständliche Fehlermeldung, wenn `state = 'error'` oder ein Teilproblem vorliegt */
  error: string | null;
  /** Gesetzt, wenn `getUserMedia` scheiterte: Zugriff verweigert bzw. kein Mikrofon da */
  micIssue: MicIssue | null;
}
