'use client';

// Hinweis „in einem anderen Tab aktiv“ (docs/VERTRAEGE.md §11.8): Nur ein Tab synchronisiert.
// Einhängen (AppShell) macht der Lead. `onTakeOver` ist die Nutzeraktion „Hier übernehmen“ für die Aufnahme.
import { useEffect, useState } from 'react';
import type { SyncClient } from './client.ts';

export type OtherTabSource = Pick<SyncClient, 'onEvent' | 'takeOver' | 'connectionState'>;

export function OtherTabBanner({
  client,
  onTakeOver,
}: {
  client: OtherTabSource;
  /** Wird vor `takeOver()` synchron gerufen: Der Klick ist eine Nutzeraktion (z. B. für das Mikrofon, Plan 210 §4.4) */
  onTakeOver?: () => void;
}) {
  const [otherTab, setOtherTab] = useState(client.connectionState === 'other_tab');

  useEffect(() => {
    setOtherTab(client.connectionState === 'other_tab');
    return client.onEvent('connection', (c) => setOtherTab(c.state === 'other_tab'));
  }, [client]);

  if (!otherTab) return null;
  return (
    <div role="status" className="sync-other-tab-banner">
      <span>Studien-Gehirn ist in einem anderen Tab aktiv.</span>{' '}
      <button
        type="button"
        onClick={() => {
          onTakeOver?.();
          client.takeOver();
        }}
      >
        Hier übernehmen
      </button>
    </div>
  );
}
