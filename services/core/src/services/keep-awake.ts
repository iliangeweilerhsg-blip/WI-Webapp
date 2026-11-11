// Mac während der Vorlesung wach halten (UX-04, VERTRAEGE §9.1).
// Solange eine Session in `laeuft` oder `pausiert` steht, hält der Core unter macOS `caffeinate -i -s -w <Core-PID>`
// als Kindprozess. Der Bildschirm darf ausgehen. Mit dem Core endet auch `caffeinate` (`-w`). Andere Systeme: No-op.
import { spawn as nodeSpawn } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { Db } from '../db/client.ts';
import { hasActiveSession } from './sessions.ts';

export const KEEP_AWAKE_INTERVAL_MS = 15_000;
const CAFFEINATE = '/usr/bin/caffeinate';

/** Der Teil von `ChildProcess`, den der Dienst braucht (Tests geben ein Fake vor) */
export interface KeepAwakeChild {
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'exit', listener: (...args: unknown[]) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}
export type KeepAwakeSpawn = (
  command: string,
  args: string[],
  options: { stdio: 'ignore' },
) => KeepAwakeChild;

export interface KeepAwake {
  set(active: boolean): void;
  isActive(): boolean;
  stop(): void;
}

export function createKeepAwake(deps: {
  logger: Logger;
  platform?: NodeJS.Platform;
  spawn?: KeepAwakeSpawn;
  pid?: number;
}): KeepAwake {
  const { logger } = deps;
  const platform = deps.platform ?? process.platform;
  const spawn: KeepAwakeSpawn = deps.spawn ?? ((c, a, o) => nodeSpawn(c, a, o));
  const pid = deps.pid ?? process.pid;
  let child: KeepAwakeChild | null = null;
  let disabled = false;
  let announcedNoop = false;

  function start(): void {
    const args = ['-i', '-s', '-w', String(pid)];
    let started: KeepAwakeChild;
    try {
      started = spawn(CAFFEINATE, args, { stdio: 'ignore' });
    } catch (error) {
      disabled = true;
      logger.warn({ err: error }, 'caffeinate lässt sich nicht starten, der Mac wird nicht wach gehalten');
      return;
    }
    child = started;
    started.on('error', (error) => {
      if (child === started) child = null;
      disabled = true;
      logger.warn({ err: error }, 'caffeinate lässt sich nicht starten, der Mac wird nicht wach gehalten');
    });
    started.on('exit', () => {
      if (child !== started) return;
      child = null;
      logger.warn('caffeinate wurde beendet, der nächste Abgleich startet es neu');
    });
  }

  function endChild(): void {
    const running = child;
    child = null;
    running?.kill('SIGTERM');
  }

  return {
    set(active) {
      if (platform !== 'darwin') {
        if (!announcedNoop) {
          announcedNoop = true;
          logger.info({ platform }, 'Mac wach halten ist nur unter macOS aktiv');
        }
        return;
      }
      if (disabled) return;
      if (active) {
        if (!child) start();
      } else {
        endChild();
      }
    },
    isActive: () => child !== null,
    stop: endChild,
  };
}

/** Abgleich beim Start (nach `listen`) und alle `intervalMs`; Stopp mit dem Core */
export function registerKeepAwake(
  app: FastifyInstance,
  deps: {
    db: Db;
    logger: Logger;
    intervalMs?: number;
    platform?: NodeJS.Platform;
    spawn?: KeepAwakeSpawn;
  },
): void {
  const logger = deps.logger.child({ module: 'keep-awake' });
  const awake = createKeepAwake({
    logger,
    ...(deps.platform ? { platform: deps.platform } : {}),
    ...(deps.spawn ? { spawn: deps.spawn } : {}),
  });
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  async function sync(): Promise<void> {
    try {
      const active = await hasActiveSession(deps.db);
      if (!stopped) awake.set(active);
    } catch (error) {
      logger.error({ err: error }, 'Abgleich von Mac wach halten fehlgeschlagen');
    }
  }

  app.addHook('onListen', async () => {
    if (timer) return;
    stopped = false;
    timer = setInterval(() => void sync(), deps.intervalMs ?? KEEP_AWAKE_INTERVAL_MS);
    timer.unref();
    await sync();
  });
  app.addHook('onClose', async () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = undefined;
    awake.stop();
  });
}
