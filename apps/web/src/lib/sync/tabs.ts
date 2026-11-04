// Mehrere Tabs: Nur ein Tab (Leader) verbindet, sendet und empfängt. Die anderen Tabs synchronisieren nicht; sie zeigen
// „in einem anderen Tab aktiv“ (OtherTabBanner) und können die Rolle per „Hier übernehmen“ (Web Locks `steal`) holen.
// Der BroadcastChannel meldet nur „Leader hat gewechselt“, es werden keine Operationen weitergeleitet.

export interface LeaderLockHandlers {
  /** Dieser Tab ist jetzt Leader */
  onLeader(): void;
  /** Das Lock wurde uns entzogen (anderer Tab hat übernommen) */
  onLost(): void;
  /** Ein anderer Tab meldet einen Leader-Wechsel (Zustand neu laden) */
  onChanged(): void;
}

export interface LeaderLock {
  /** Wartet auf die Leader-Rolle (wird Leader, sobald das Lock frei ist). */
  start(handlers: LeaderLockHandlers): void;
  /** Holt die Leader-Rolle sofort von einem anderen Tab. */
  steal(): void;
  /** Gibt Lock und Kanal frei. Danach ist dieses Objekt tot; `connect()` legt ein neues an. */
  stop(): void;
}

/** Leader-Lock über `navigator.locks`; `null`, wenn die Web Locks API fehlt (dann ist der Tab immer Leader). */
export function createWebLocksLeader(name = 'sg-sync'): LeaderLock | null {
  if (typeof navigator === 'undefined' || !navigator.locks) return null;
  const lockName = `${name}-leader`;
  let channel: BroadcastChannel | null = null;
  let stopped = false;
  let held = false;
  let waiting: AbortController | null = null;
  let free: (() => void) | null = null;
  let handlers: LeaderLockHandlers | null = null;

  const request = (steal: boolean): void => {
    waiting = steal ? null : new AbortController();
    const options: LockOptions = steal ? { steal: true } : { signal: waiting!.signal };
    navigator.locks
      .request(lockName, options, () => {
        if (stopped) return undefined;
        held = true;
        handlers?.onLeader();
        try {
          channel?.postMessage('leader');
        } catch {
          // Kanal zu
        }
        return new Promise<void>((resolve) => {
          free = resolve;
        });
      })
      .then(
        () => undefined,
        () => {
          // Lock entzogen (steal) oder Warten abgebrochen
          if (stopped || !held) return;
          held = false;
          free = null;
          handlers?.onLost();
          request(false); // wieder anstellen: wird Leader, wenn der andere Tab schließt
        },
      );
  };

  return {
    start(h) {
      handlers = h;
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(name);
        channel.onmessage = () => {
          if (!stopped && !held) handlers?.onChanged();
        };
      }
      request(false);
    },
    steal() {
      if (stopped || held) return;
      waiting?.abort();
      request(true);
    },
    stop() {
      stopped = true;
      waiting?.abort();
      free?.();
      free = null;
      held = false;
      channel?.close();
      channel = null;
    },
  };
}
