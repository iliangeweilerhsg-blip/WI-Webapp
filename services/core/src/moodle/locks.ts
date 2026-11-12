// Sperre je Schlüssel für Moodle-Aktionen (08 §9.3): Aktionen mit gleichem Schlüssel (z. B. `assign:42`) laufen im
// Core nacheinander. Nur im Speicher, ein Neustart gibt alles frei.

/** So lange wartet `execute` höchstens auf die Sperre, danach `409 moodle_action_busy` */
export const LOCK_WAIT_MS = 10_000;

export type ReleaseLock = () => void;

export interface KeyedMutexOptions {
  /** Wartezeit je `acquire` */
  timeoutMs?: number;
}

interface Waiter {
  grant(): void;
}

/**
 * Wartende kommen der Reihe nach dran. Nach `timeoutMs` gibt `acquire` `null` zurück, und der Wartende ist aus der
 * Schlange. Die Freigabe ist einmalig: ein zweiter Aufruf von `release` tut nichts.
 */
export class KeyedMutex {
  /** Vorhandener Schlüssel = gesperrt. Der Wert sind die Wartenden */
  private readonly held = new Map<string, Waiter[]>();
  private readonly timeoutMs: number;

  constructor(options: KeyedMutexOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? LOCK_WAIT_MS;
  }

  acquire(key: string): Promise<ReleaseLock | null> {
    const queue = this.held.get(key);
    if (!queue) {
      this.held.set(key, []);
      return Promise.resolve(this.releaser(key));
    }
    return new Promise((resolve) => {
      const waiter: Waiter = {
        grant: () => {
          clearTimeout(timer);
          resolve(this.releaser(key));
        },
      };
      const timer = setTimeout(() => {
        const index = queue.indexOf(waiter);
        if (index >= 0) queue.splice(index, 1);
        resolve(null);
      }, this.timeoutMs);
      queue.push(waiter);
    });
  }

  /** Ob der Schlüssel gerade gesperrt ist (für Tests) */
  isLocked(key: string): boolean {
    return this.held.has(key);
  }

  private releaser(key: string): ReleaseLock {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const queue = this.held.get(key);
      const next = queue?.shift();
      // Mit Wartenden bleibt der Schlüssel gesperrt und geht direkt an den nächsten
      if (next) next.grant();
      else this.held.delete(key);
    };
  }
}
