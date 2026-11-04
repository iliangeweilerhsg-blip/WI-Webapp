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
   * Ein Toast anderer Gruppe hat diesen ersetzt, bevor er ablief. Ein neuer Toast derselben Gruppe
   * (z. B. die nächste Löschung) führt den alten fort, dann kommt kein `onReplace`.
   */
  onReplace?: () => void;
  group?: string;
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastApi {
  show: (toast: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION_MS = 6_000;

/**
 * Ruhige Rückmeldung unten mittig. Höchstens ein Toast gleichzeitig, der neueste ersetzt den alten.
 * Der Timer pausiert, solange die Maus darüber ist oder der Fokus darin liegt (WCAG 2.2.1).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const [paused, setPaused] = useState(false);
  const counter = useRef(0);
  const current = useRef<ToastItem | null>(null);
  const remaining = useRef(0);
  const actionRef = useRef<HTMLButtonElement>(null);

  const show = useCallback((options: ToastOptions) => {
    const old = current.current;
    if (old?.onReplace && old.group !== options.group) old.onReplace();
    counter.current += 1;
    const next = { ...options, id: counter.current };
    current.current = next;
    remaining.current = options.durationMs ?? DEFAULT_DURATION_MS;
    setPaused(false);
    setToast(next);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  const dismiss = useCallback((id: number) => {
    if (current.current?.id !== id) return;
    current.current = null;
    setToast(null);
  }, []);

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
            role="status"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
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
