'use client';
// Leader-Rolle dieses Tabs aus dem Verbindungszustand des SyncClient (VERTRAEGE §11.8, Issue #106/#115).
import { useEffect, useState } from 'react';
import type { SyncClient } from '../sync/client.ts';
import type { ConnectionState } from '../sync/types.ts';

/** Leader ist, wer verbunden ist oder es versucht; `idle`, `acquiring`, `other_tab` und `closed` sind es nicht */
export function isLeaderState(state: ConnectionState): boolean {
  return state !== 'idle' && state !== 'acquiring' && state !== 'other_tab' && state !== 'closed';
}

export function useConnectionState(client: SyncClient | null): ConnectionState {
  const [state, setState] = useState<ConnectionState>(client?.connectionState ?? 'idle');
  useEffect(() => {
    if (!client) return;
    setState(client.connectionState);
    return client.onEvent('connection', (c) => setState(c.state));
  }, [client]);
  return client ? state : 'idle';
}
