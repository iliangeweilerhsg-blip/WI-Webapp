import { useSyncExternalStore } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

const subscribe = () => () => {};

/**
 * `false` beim Hydratisieren (wie das vorgerenderte HTML), danach `true`. React nutzt dafür den Server-Snapshot,
 * solange es die Komponente an das HTML anhängt.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * Das vorgerenderte HTML zeigt Abfragen immer als „lädt“. Hydratisiert React eine Komponente erst, nachdem eine
 * Abfrage in einem anderen Teil der Seite schon fertig ist, würde sie sonst Daten statt „lädt“ zeigen und
 * die Hydration scheitert (React #418). Bis zur Hydration gilt die Abfrage deshalb als noch nicht fertig.
 */
export function useHydrationSafe<T extends UseQueryResult<unknown, unknown>>(query: T): T {
  const hydrated = useHydrated();
  if (hydrated) return query;
  return {
    ...query,
    data: undefined,
    error: null,
    status: 'pending',
    isPending: true,
    isLoading: true,
    isSuccess: false,
    isError: false,
    isFetching: true,
  } as T;
}

// ---------------------------------------------------------------------------------------------
// Query-Parameter ohne Suspense
// ---------------------------------------------------------------------------------------------

let patched = false;

/** `pushState`/`replaceState` melden sich selbst (Next navigiert damit, ohne dass `popstate` feuert). */
function watchHistory(): void {
  if (patched || typeof window === 'undefined') return;
  patched = true;
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (...args: Parameters<History['pushState']>) => {
      original(...args);
      window.dispatchEvent(new Event('sg:locationchange'));
    };
  }
}

function subscribeToLocation(listener: () => void): () => void {
  watchHistory();
  window.addEventListener('popstate', listener);
  window.addEventListener('sg:locationchange', listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener('sg:locationchange', listener);
  };
}

/**
 * Ein Query-Parameter der Adresse. Anders als `useSearchParams` von Next braucht das keine Suspense-Grenze:
 * Die sonst nötige Grenze macht den betroffenen Teil beim Static Export clientseitig (und hat in der Seitenleiste
 * sporadisch zu Hydrationsfehlern geführt). Beim Hydratisieren gilt `null`, wie im vorgerenderten HTML.
 */
export function useQueryParam(name: string): string | null {
  return useSyncExternalStore(
    subscribeToLocation,
    () => new URLSearchParams(window.location.search).get(name),
    () => null,
  );
}
