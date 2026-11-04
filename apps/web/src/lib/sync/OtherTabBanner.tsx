'use client';

// Hinweis „in einem anderen Tab aktiv“ (VERTRAEGE §11, Mehr-Tab-Regel): Nur ein Tab synchronisiert.
// Einhängen (AppShell) macht der Lead.
import { useEffect, useState } from 'react';
import type { SyncClient } from './client.ts';

export type OtherTabSource = Pick<SyncClient, 'onEvent' | 'takeOver' | 'connectionState'>;

export function OtherTabBanner({ client }: { client: OtherTabSource }) {
  const [otherTab, setOtherTab] = useState(client.connectionState === 'other_tab');

  useEffect(() => {
    setOtherTab(client.connectionState === 'other_tab');
    return client.onEvent('connection', (c) => setOtherTab(c.state === 'other_tab'));
  }, [client]);

  if (!otherTab) return null;
  return (
    <div role="status" className="sync-other-tab-banner">
      <span>Studien-Gehirn ist in einem anderen Tab aktiv.</span>{' '}
      <button type="button" onClick={() => client.takeOver()}>
        Hier übernehmen
      </button>
    </div>
  );
}
