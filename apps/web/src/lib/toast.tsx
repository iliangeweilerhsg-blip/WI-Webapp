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
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastApi {
  show: (toast: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION_MS = 6_000;

/** Ruhige Rückmeldung unten mittig. Höchstens ein Toast gleichzeitig, der neueste ersetzt den alten. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const counter = useRef(0);

  const show = useCallback((options: ToastOptions) => {
    counter.current += 1;
    setToast({ ...options, id: counter.current });
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => setToast((current) => (current?.id === toast.id ? null : current)),
      toast.durationMs ?? DEFAULT_DURATION_MS,
    );
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] -translate-x-1/2">
        {toast ? (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex items-center gap-4 rounded-lg border border-border-strong bg-surface-raised px-4 py-3 text-sm shadow-lg"
          >
            <span>{toast.message}</span>
            {toast.actionLabel ? (
              <button
                type="button"
                onClick={() => {
                  toast.onAction?.();
                  setToast(null);
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
