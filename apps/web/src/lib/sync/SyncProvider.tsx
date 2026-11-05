'use client';

// App-weiter SyncClient (docs/VERTRAEGE.md §11): genau ein Client pro Tab.
// `connect()` beim Mount, `disconnect()` beim Unmount. Unter StrictMode läuft der Effekt doppelt
// (connect, disconnect, connect); die Instanz bleibt dieselbe, der Client verwirft die abgebrochene Sitzung selbst.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { SyncClient } from './client.ts';

const SyncContext = createContext<SyncClient | null>(null);

export interface SyncProviderProps {
  children: ReactNode;
  /** Nur für Tests: fertiger Client statt des Standard-Clients */
  client?: SyncClient;
}

export function SyncProvider({ children, client: injected }: SyncProviderProps) {
  const created = useRef<SyncClient | null>(null);
  const [client, setClient] = useState<SyncClient | null>(injected ?? null);

  useEffect(() => {
    // Erst im Effekt anlegen (nicht beim Rendern): kein IndexedDB-/WebSocket-Zugriff beim Server-Rendern,
    // und ein verworfener StrictMode-Render erzeugt keinen zweiten Client.
    const c = injected ?? (created.current ??= new SyncClient());
    setClient(c);
    void c.connect().catch(() => undefined);
    return () => c.disconnect();
  }, [injected]);

  return <SyncContext.Provider value={client}>{children}</SyncContext.Provider>;
}

/** Der Sync-Client dieses Tabs; `null` vor dem ersten Effekt (Server-Render, erster Paint). */
export function useSyncClient(): SyncClient | null {
  return useContext(SyncContext);
}
