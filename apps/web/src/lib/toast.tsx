'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface ToastOptions {
  message: string;
  /** Beschriftung der Aktion, z. B. „Rückgängig“ */
  actionLabel?: string;
  onAction?: () => void;
  /** Anzeigedauer in ms (R15: 10 s für Rückgängig) */
  durationMs?: number;
  /** Fokus beim Erscheinen auf die Aktion setzen (Tastaturbedienung nach dem Löschen) */
  focusAction?: boolean;
  /** Der Toast ist von selbst abgelaufen */
  onExpire?: () => void;
  /**
   * Toasts derselben Gruppe führen einander fort (z. B. die nächste Löschung): Der neue ersetzt den
   * sichtbaren bzw. wartenden alten, ohne dass dieser abläuft.
   */
  group?: string;
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastApi {
  show: (toast: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION_MS = 5_000;

/** So viele Toasts warten höchstens hinter dem sichtbaren. Ältere bloße Meldungen verfallen zuerst. */
export const MAX_WAITING_TOASTS = 3;

/** „Rückgängig“ (hat `onExpire`) und Toasts mit Aktion werden nie von einer anderen Meldung verdrängt. */
function isProtected(toast: ToastOptions): boolean {
  return Boolean(toast.onExpire || toast.actionLabel);
}

/**
 * Ruhige Rückmeldung unten mittig, eine Meldung zur Zeit (07 §7). Neue Meldungen verdrängen nur eine bloße
 * Meldung ohne Aktion. Ein sichtbarer Toast mit Aktion, vor allem „Rückgängig“, läuft immer zu Ende: Alles
 * andere reiht sich dahinter ein (höchstens {@link MAX_WAITING_TOASTS}, die ältesten bloßen Meldungen verfallen
 * zuerst, Toasts mit `onExpire` nie, sie tragen eine offene Löschung). Eine Dublette-Meldung löst so nie ein
 * Löschen vorzeitig aus. Der Timer pausiert, solange die Maus darüber ist. Der Fokus pausiert nicht: Er liegt
 * nach dem Löschen automatisch auf der Aktion, Tastaturnutzer erreichen „Rückgängig“ sofort (WCAG 2.2.1).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const [paused, setPaused] = useState(false);
  const counter = useRef(0);
  const current = useRef<ToastItem | null>(null);
  const remaining = useRef(0);
  const actionRef = useRef<HTMLButtonElement>(null);
  const elementRef = useRef<HTMLDivElement>(null);
  const queued = useRef<ToastOptions[]>([]);

  /** Lag der Fokus im Toast (z. B. auf „Rückgängig“), geht er in den Hauptbereich, statt auf <body> zu fallen. */
  const rescueFocus = useCallback(() => {
    const el = elementRef.current;
    if (el && document.activeElement && el.contains(document.activeElement)) {
      document.getElementById('main')?.focus();
    }
  }, []);

  const display = useCallback(
    (options: ToastOptions) => {
      if (!options.focusAction) rescueFocus();
      counter.current += 1;
      const next = { ...options, id: counter.current };
      current.current = next;
      remaining.current = options.durationMs ?? DEFAULT_DURATION_MS;
      setPaused(false);
      setToast(next);
    },
    [rescueFocus],
  );

  const show = useCallback(
    (options: ToastOptions) => {
      const old = current.current;
      const waiting = queued.current;
      // Gleiche Gruppe: fortführen (der wartende bzw. sichtbare Toast wird ersetzt, nichts läuft ab)
      const sameWaiting = options.group ? waiting.findIndex((w) => w.group === options.group) : -1;
      if (sameWaiting >= 0) {
        waiting[sameWaiting] = options;
        return;
      }
      if (old && options.group && old.group === options.group) {
        display(options);
        return;
      }
      if (old && (isProtected(old) || waiting.length > 0)) {
        waiting.push(options);
        // Zu viele Wartende: die ältesten bloßen Meldungen verfallen, offene Löschungen nie
        while (waiting.length > MAX_WAITING_TOASTS) {
          const stale = waiting.findIndex((w) => !w.onExpire);
          if (stale < 0) break;
          waiting.splice(stale, 1);
        }
        return;
      }
      display(options);
    },
    [display],
  );

  const api = useMemo(() => ({ show }), [show]);

  const dismiss = useCallback(
    (id: number) => {
      if (current.current?.id !== id) return;
      rescueFocus();
      current.current = null;
      setToast(null);
      const next = queued.current.shift();
      if (next) display(next);
    },
    [rescueFocus, display],
  );

  useEffect(() => {
    if (!toast || paused) return;
    const started = Date.now();
    const timer = setTimeout(() => {
      if (current.current?.id !== toast.id) return;
      toast.onExpire?.();
      dismiss(toast.id);
    }, remaining.current);
    return () => {
      clearTimeout(timer);
      // Nur für den noch aktuellen Toast Restzeit merken (ein neuer hat seine eigene Dauer)
      if (current.current?.id === toast.id) {
        remaining.current = Math.max(0, remaining.current - (Date.now() - started));
      }
    };
  }, [toast, paused, dismiss]);

  useEffect(() => {
    if (toast?.focusAction) actionRef.current?.focus();
  }, [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] -translate-x-1/2">
        {toast ? (
          <div
            key={toast.id}
            ref={elementRef}
            role="status"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            className="pointer-events-auto flex items-center gap-4 rounded-lg border border-border-strong bg-surface-raised px-4 py-3 text-sm shadow-lg"
          >
            <span>{toast.message}</span>
            {toast.actionLabel ? (
              <button
                ref={actionRef}
                type="button"
                onClick={() => {
                  toast.onAction?.();
                  dismiss(toast.id);
                }}
                className="rounded-md px-2 py-1 font-medium text-accent hover:bg-accent-soft"
              >
                {toast.actionLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast braucht einen ToastProvider');
  return api;
}
