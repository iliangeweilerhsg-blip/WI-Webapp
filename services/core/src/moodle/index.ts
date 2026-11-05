// Moodle-Anbindung zusammensetzen (08 §9)
import type { Config } from '../config.ts';
import { DEFAULT_ACTION_HANDLERS, MoodleActionRegistry, type MoodleActionHandlers } from './actions.ts';
import { MoodleClient, type FetchFn, type MoodleClientOptions, type MoodleLogger } from './client.ts';
import { ConfirmationStore } from './confirmations.ts';
import { readMoodleMeta, type MoodleMeta } from './meta.ts';
import { MoodleFileRegistry, MoodleReader } from './reader.ts';
import { MoodleStatusService } from './status.ts';
import { KeychainTokenStore, type MoodleTokenStore } from './token-store.ts';

export interface MoodleServices {
  client: MoodleClient;
  status: MoodleStatusService;
  actions: MoodleActionRegistry;
  confirmations: ConfirmationStore;
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
    | 'maxConcurrentDownloads'
    | 'idleTimeoutMs'
    | 'retryDelaysMs'
    | 'maxResponseBytes'
    | 'maxFileBytes'
  >
>;

export interface CreateMoodleServicesOptions {
  config: Pick<Config, 'moodleUrl' | 'dataDir'>;
  logger?: MoodleLogger;
  tokens?: MoodleTokenStore;
  fetch?: FetchFn;
  handlers?: MoodleActionHandlers;
  readMeta?: () => Promise<MoodleMeta>;
  now?: () => Date;
  client?: MoodleClientTuning;
  /** Zeitzone für Kursdaten, Standard: die des Rechners */
  timeZone?: string;
}

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
  });
  const now = options.now;
  const files = new MoodleFileRegistry();
  return {
    client,
    status,
    actions: new MoodleActionRegistry(options.handlers ?? DEFAULT_ACTION_HANDLERS),
    confirmations: new ConfirmationStore(now ? { now: () => now().getTime() } : {}),
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
