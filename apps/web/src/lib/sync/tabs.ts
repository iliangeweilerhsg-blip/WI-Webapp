// Mehrere Tabs: Nur ein Tab (Leader) hält die WebSocket-Verbindung. Die anderen Tabs schreiben in die gemeinsame
// Warteschlange (IndexedDB) und melden das per BroadcastChannel; der Leader sendet, bestätigt und verteilt eingehende
// Operationen und Ereignisse zurück (siehe `SyncClient`).

export interface TabMessage {
  t: string;
  /** Absender (Tab-ID) */
  from: string;
  [key: string]: unknown;
}

export interface TabCoordinator {
  /** Ruft `onLeader` auf, sobald dieser Tab Leader ist (kann sofort oder später sein, z. B. wenn der Leader schließt). */
  acquire(onLeader: () => void): void;
  /** Gibt die Leader-Rolle frei bzw. bricht das Warten ab und schließt den Kanal. */
  release(): void;
  /** Sendet an alle anderen Tabs (nicht an den eigenen). */
  post(msg: TabMessage): void;
  onMessage(fn: (msg: TabMessage) => void): () => void;
}

/** Leader-Lock über `navigator.locks` und Kanal über `BroadcastChannel`; `null`, wenn eines davon fehlt. */
export function createWebLocksCoordinator(name = 'sg-sync'): TabCoordinator | null {
  if (typeof navigator === 'undefined' || !navigator.locks || typeof BroadcastChannel === 'undefined')
    return null;
  const channel = new BroadcastChannel(name);
  const listeners = new Set<(msg: TabMessage) => void>();
  channel.onmessage = (ev: MessageEvent) => {
    for (const fn of [...listeners]) fn(ev.data as TabMessage);
  };
  let abort: AbortController | null = null;
  let free: (() => void) | null = null;
  return {
    acquire(onLeader) {
      abort = new AbortController();
      navigator.locks
        .request(`${name}-leader`, { signal: abort.signal }, () => {
          onLeader();
          return new Promise<void>((resolve) => {
            free = resolve;
          });
        })
        .catch(() => undefined); // abgebrochen
    },
    release() {
      abort?.abort();
      free?.();
      free = null;
      channel.close();
    },
    post(msg) {
      try {
        channel.postMessage(msg);
      } catch {
        // Kanal geschlossen
      }
    },
    onMessage(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
