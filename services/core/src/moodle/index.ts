// Moodle-Anbindung zusammensetzen (08 §9)
import type { Config } from '../config.ts';
import { DEFAULT_ACTION_HANDLERS, MoodleActionRegistry, type MoodleActionHandlers } from './actions.ts';
import { MoodleClient, type FetchFn, type MoodleLogger } from './client.ts';
import { ConfirmationStore } from './confirmations.ts';
import { readMoodleMeta, type MoodleMeta } from './meta.ts';
import { MoodleStatusService } from './status.ts';
import { KeychainTokenStore, type MoodleTokenStore } from './token-store.ts';

export interface MoodleServices {
  client: MoodleClient;
  status: MoodleStatusService;
  actions: MoodleActionRegistry;
  confirmations: ConfirmationStore;
}

export interface CreateMoodleServicesOptions {
  config: Pick<Config, 'moodleUrl' | 'dataDir'>;
  logger?: MoodleLogger;
  tokens?: MoodleTokenStore;
  fetch?: FetchFn;
  handlers?: MoodleActionHandlers;
  readMeta?: () => Promise<MoodleMeta>;
  now?: () => Date;
}

export function createMoodleServices(options: CreateMoodleServicesOptions): MoodleServices {
  const client = new MoodleClient({
    baseUrl: options.config.moodleUrl,
    tokens: options.tokens ?? new KeychainTokenStore(),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  });
  const status = new MoodleStatusService({
    client,
    readMeta: options.readMeta ?? (() => readMoodleMeta(options.config.dataDir)),
    ...(options.now ? { now: options.now } : {}),
  });
  const now = options.now;
  return {
    client,
    status,
    actions: new MoodleActionRegistry(options.handlers ?? DEFAULT_ACTION_HANDLERS),
    confirmations: new ConfirmationStore(now ? { now: () => now().getTime() } : {}),
  };
}

export { MoodleClient } from './client.ts';
export type { MoodleTokenStore } from './token-store.ts';
