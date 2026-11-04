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
  /** Bei zusammengefassten „Rückgängig“-Toasts: die einzelnen offenen Löschungen */
  parts?: ToastOptions[];
}

export interface ToastApi {
  show: (toast: ToastOptions) => void;
  /** Nimmt die Toasts einer Gruppe zurück, ohne `onAction`/`onExpire` auszulösen (z. B. weil die Löschung zurückgenommen wurde) */
  dismissGroup: (group: string) => void;
  /**
   * Ändert die Meldung der Gruppe im sichtbaren Toast, ohne Timer, Fokus oder Aktion anzutasten (z. B. neue Zahl nach
   * teilweisem Rückgängig). Hat der sichtbare Toast die Gruppe nicht, passiert nichts und die Antwort ist `false`.
   */
  amend: (group: string, message: string) => boolean;
}

/** Fasst offene Löschungen zu einem Toast zusammen: ein Klick macht alle rückgängig, alle laufen gemeinsam ab. */
function combine(parts: ToastOptions[], newest: ToastOptions): ToastOptions {
  const messages = [...new Set(parts.map((p) => p.message))];
  return {
    ...newest,
    message: messages.join(' · '),
    onAction: () => parts.forEach((p) => p.onAction?.()),
    onExpire: () => parts.forEach((p) => p.onExpire?.()),
    parts,
  } as ToastOptions;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION_MS = 5_000;

/** So viele Toasts warten höchstens hinter dem sichtbaren. Ältere bloße Meldungen verfallen zuerst. */
export const MAX_WAITING_TOASTS = 3;

/**
 * Ruhige Rückmeldung unten mittig, eine Meldung zur Zeit (07 §7). Geschützt ist nur ein Toast mit `onExpire`, also
 * eine offene Löschung („Rückgängig“): Er wird von nichts vorzeitig beendet, das Löschen löst nie eine andere Meldung aus.
 * - Alles andere (bloße Meldungen, Toasts mit Aktion wie „Anzeigen“) wartet hinter einem geschützten Toast
 *   (höchstens {@link MAX_WAITING_TOASTS}, die ältesten bloßen Meldungen verfallen) und wird sonst vom neuesten ersetzt.
 * - Ein neuer „Rückgängig“-Toast verdrängt sofort jeden Toast ohne `onExpire`. Hatte der verdrängte eine Aktion, geht er
 *   vorne in die Schlange zurück, bloße Meldungen verfallen. So sind Rückgängig-Toasts nie hinter anderen versteckt.
 * - Mehrere offene Löschungen (auch verschiedener Gruppen) werden zu einem Toast zusammengefasst („Foliensatz gelöscht ·
 *   Modul gelöscht“): Ein Klick macht alle rückgängig, alle laufen zusammen ab. Das hält es bei einer Meldung zur Zeit
 *   und jede Löschung bleibt erreichbar. Jede neue Löschung startet die 10 s neu, der Fokus geht auf den Knopf.
 * Der Timer pausiert, solange die Maus darüber ist. Der Fokus pausiert nicht: Er liegt nach dem Löschen automatisch auf der
 * Aktion, Tastaturnutzer erreichen „Rückgängig“ sofort (WCAG 2.2.1).
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
      if (options.onExpire) {
        // Offene Löschung: sofort sichtbar, nie in der Schlange
        if (old?.onExpire) {
          const parts = [...(old.parts ?? [old])];
          const same = options.group ? parts.findIndex((p) => p.group === options.group) : -1;
          if (same >= 0) parts[same] = options;
          else parts.push(options);
          display(combine(parts, options));
          return;
        }
        if (old?.actionLabel) {
          const { id: _id, parts: _parts, ...back } = old;
          waiting.unshift(back);
        }
        display(options);
        return;
      }
      // Gleiche Gruppe: fortführen (der wartende bzw. sichtbare Toast wird ersetzt, nichts läuft ab)
      const sameWaiting = options.group ? waiting.findIndex((w) => w.group === options.group) : -1;
      if (sameWaiting >= 0) {
        waiting[sameWaiting] = options;
        return;
      }
      if (old?.onExpire || (old && waiting.length > 0)) {
        waiting.push(options);
        // Zu viele Wartende: die ältesten bloßen Meldungen verfallen, bevor Toasts mit Aktion verfallen
        while (waiting.length > MAX_WAITING_TOASTS) {
          const stale = waiting.findIndex((w) => !w.actionLabel);
          waiting.splice(stale < 0 ? 0 : stale, 1);
        }
        return;
      }
      display(options);
    },
    [display],
  );

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

  /** Tauscht den sichtbaren Toast gegen einen neuen mit derselben `id`: Element, Fokus und Restzeit bleiben erhalten. */
  const replaceCurrent = useCallback((next: ToastItem) => {
    current.current = next;
    setToast(next);
  }, []);

  const amend = useCallback(
    (group: string, message: string) => {
      const old = current.current;
      if (!old) return false;
      if (old.parts) {
        if (!old.parts.some((p) => p.group === group)) return false;
        const parts = old.parts.map((p) => (p.group === group ? { ...p, message } : p));
        const { id, parts: _parts, ...base } = old;
        replaceCurrent({ ...combine(parts, { ...base, focusAction: false }), id } as ToastItem);
      } else if (old.group === group) replaceCurrent({ ...old, message, focusAction: false });
      else return false;
      return true;
    },
    [replaceCurrent],
  );

  const dismissGroup = useCallback(
    (group: string) => {
      queued.current = queued.current.filter((w) => w.group !== group);
      const old = current.current;
      if (!old) return;
      if (old.parts) {
        const parts = old.parts.filter((p) => p.group !== group);
        if (parts.length === old.parts.length) return;
        const newest = parts.at(-1);
        if (newest) {
          // An Ort und Stelle: Der Rest-Toast behält Restzeit und Fokus (kein Sprung auf #main, keine neuen 10 s)
          const { id, parts: _parts, ...base } = old;
          replaceCurrent({ ...combine(parts, { ...base, ...newest, focusAction: false }), id } as ToastItem);
          return;
        }
      } else if (old.group !== group) return;
      dismiss(old.id);
    },
    [dismiss, replaceCurrent],
  );

  const api = useMemo(() => ({ show, dismissGroup, amend }), [show, dismissGroup, amend]);

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
      {/* Dauerhafte Live-Region: Screenreader sagen nur Inhalt an, der in eine schon vorhandene Region kommt */}
      <div
        aria-live="polite"
        aria-atomic="true"
        data-testid="toast-live"
        className="pointer-events-none fixed bottom-4 left-1/2 z-[70] -translate-x-1/2"
      >
        {toast ? (
          <div
            key={toast.id}
            ref={elementRef}
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
