// Bildschirm wachhalten, solange aufgenommen wird (02 §3 „Ruhezustand des Macs“, Spike S4).
// Die Wake Lock API wirkt nur im sichtbaren Tab: Wechselt der Tab in den Hintergrund, gibt der Browser die Sperre
// frei. Darum wird sie beim Zurückkehren neu angefordert, und die Oberfläche bekommt `tabHidden` für einen Hinweis.
import type { WakeLockState } from './types.ts';

export interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', fn: () => void): void;
}
export interface WakeLockNavigatorLike {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}
export interface VisibilityDocumentLike {
  visibilityState: string;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

export interface WakeLockHolderOptions {
  navigator?: WakeLockNavigatorLike | undefined;
  document?: VisibilityDocumentLike | undefined;
  onChange: (state: { wakeLock: WakeLockState; tabHidden: boolean }) => void;
}

export interface WakeLockHolder {
  /** Startet das Halten. Fordert die Sperre an und beobachtet die Sichtbarkeit des Tabs. */
  acquire(): Promise<void>;
  release(): Promise<void>;
}

export function createWakeLockHolder(options: WakeLockHolderOptions): WakeLockHolder {
  const nav = options.navigator;
  const doc = options.document;
  let sentinel: WakeLockSentinelLike | null = null;
  let wanted = false;
  let wakeLock: WakeLockState = nav?.wakeLock ? 'inactive' : 'unsupported';

  const hidden = () => doc?.visibilityState === 'hidden';
  const emit = () => options.onChange({ wakeLock, tabHidden: wanted && hidden() });

  async function request(): Promise<void> {
    if (!nav?.wakeLock || sentinel || hidden()) return;
    try {
      const lock = await nav.wakeLock.request('screen');
      if (!wanted) {
        await lock.release().catch(() => undefined);
        return;
      }
      sentinel = lock;
      wakeLock = 'active';
      lock.addEventListener('release', () => {
        if (sentinel === lock) sentinel = null;
        wakeLock = 'released';
        emit();
      });
    } catch {
      // Abgelehnt (Energiesparmodus, Berechtigung): nur der Hinweis bleibt
      wakeLock = 'released';
    }
    emit();
  }

  const onVisibility = () => {
    emit();
    if (wanted && !hidden()) void request();
  };

  return {
    async acquire() {
      if (wanted) return;
      wanted = true;
      doc?.addEventListener('visibilitychange', onVisibility);
      await request();
      emit();
    },
    async release() {
      if (!wanted) return;
      wanted = false;
      doc?.removeEventListener('visibilitychange', onVisibility);
      const current = sentinel;
      sentinel = null;
      await current?.release().catch(() => undefined);
      wakeLock = nav?.wakeLock ? 'inactive' : 'unsupported';
      emit();
    },
  };
}
