// Moodle-Anbindung zusammensetzen (08 §9)
import type { MoodleActionId } from '@sg/shared';
import type { Config } from '../config.ts';
import { DEFAULT_ACTION_HANDLERS, MoodleActionRegistry, type MoodleActionHandlers } from './actions.ts';
import { MoodleClient, type FetchFn, type MoodleClientOptions, type MoodleLogger } from './client.ts';
import { ConfirmationStore } from './confirmations.ts';
import { KeyedMutex } from './locks.ts';
import { readMoodleMeta, type MoodleMeta } from './meta.ts';
import { MoodleFileRegistry, MoodleReader } from './reader.ts';
import { MoodleStatusService, type RecheckClock } from './status.ts';
import { MoodleUploadStore } from './uploads.ts';
import { KeychainTokenStore, type MoodleTokenStore } from './token-store.ts';

export interface MoodleServices {
  client: MoodleClient;
  status: MoodleStatusService;
  actions: MoodleActionRegistry;
  confirmations: ConfirmationStore;
  /** Sperre je Aufgabe o. Ä. für `execute` (08 §9.3) */
  locks: KeyedMutex;
  /** Uploads für Aktionen (08 §9.3), nur im Speicher des Core, Dateien unter `tmp/moodle-uploads/` */
  uploads: MoodleUploadStore;
  /**
   * `POST /moodle/uploads` ist nur offen, wenn eine freigeschaltete Aktion `upload_ids` annimmt (E12). Sonst
   * `501 moodle_action_not_implemented`.
   */
  uploadsEnabled: boolean;
  /** Lese-Endpunkte (F-MDL-02) */
  reader: MoodleReader;
  /** Über die Lese-Endpunkte ausgegebene Dateiverweise, nur diese liefert GET /moodle/file */
  files: MoodleFileRegistry;
}

/** Stellschrauben des Clients, z. B. für Tests (Zeitlimits, Größen, Drosselung) */
export type MoodleClientTuning = Partial<
  Pick<
    MoodleClientOptions,
    | 'maxConcurrent'
    | 'minIntervalMs'
    | 'timeoutMs'
    | 'uploadTimeoutMs'
    | 'maxConcurrentDownloads'
    | 'idleTimeoutMs'
    | 'retryDelaysMs'
    | 'maxResponseBytes'
    | 'maxFileBytes'
  >
>;

export interface CreateMoodleServicesOptions {
  /** `moodleActions` fehlt = keine Aktion aus T1-24 freigeschaltet (E12) */
  config: Pick<Config, 'moodleUrl' | 'dataDir'> & Partial<Pick<Config, 'moodleActions'>>;
  logger?: MoodleLogger;
  tokens?: MoodleTokenStore;
  fetch?: FetchFn;
  handlers?: MoodleActionHandlers;
  readMeta?: () => Promise<MoodleMeta>;
  now?: () => Date;
  client?: MoodleClientTuning;
  /** Mindestabstand und Uhr für `POST /moodle/recheck` (nur für Tests) */
  recheck?: { minGapMs?: number; clock?: RecheckClock };
  /** Wartezeit auf die Sperre, Standard 10 s (nur für Tests) */
  lockTimeoutMs?: number;
  /** Zeitzone für Kursdaten, Standard: die des Rechners */
  timeZone?: string;
}

/** Freischaltbare Aktionen, deren Parameter `upload_ids` enthalten */
const UPLOAD_ACTIONS: readonly MoodleActionId[] = [
  'assign.save_draft',
  'forum.create_discussion',
  'forum.reply',
  'files.upload_private',
];

export function createMoodleServices(options: CreateMoodleServicesOptions): MoodleServices {
  const client = new MoodleClient({
    baseUrl: options.config.moodleUrl,
    tokens: options.tokens ?? new KeychainTokenStore(),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    ...options.client,
  });
  const status = new MoodleStatusService({
    client,
    readMeta: options.readMeta ?? (() => readMoodleMeta(options.config.dataDir)),
    ...(options.now ? { now: options.now } : {}),
    ...(options.recheck?.minGapMs !== undefined ? { recheckMinGapMs: options.recheck.minGapMs } : {}),
    ...(options.recheck?.clock ? { recheckClock: options.recheck.clock } : {}),
  });
  const now = options.now;
  const files = new MoodleFileRegistry();
  const enabled = options.config.moodleActions ?? [];
  return {
    client,
    status,
    actions: new MoodleActionRegistry(
      options.handlers ?? DEFAULT_ACTION_HANDLERS,
      options.config.moodleActions ?? [],
    ),
    confirmations: new ConfirmationStore(now ? { now: () => now().getTime() } : {}),
    locks: new KeyedMutex(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }),
    uploads: new MoodleUploadStore({
      dataDir: options.config.dataDir,
      ...(now ? { now: () => now().getTime() } : {}),
    }),
    // Aktionen, die `upload_ids` annehmen (Schemas `MoodleActionParams*`)
    uploadsEnabled: UPLOAD_ACTIONS.some((id) => enabled.includes(id)),
    reader: new MoodleReader({
      client,
      status,
      files,
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    }),
    files,
  };
}

export { MoodleClient } from './client.ts';
export type { MoodleTokenStore } from './token-store.ts';
