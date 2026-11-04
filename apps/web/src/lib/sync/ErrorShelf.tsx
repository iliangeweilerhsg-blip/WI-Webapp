'use client';

// Fehlerablage-Anzeige (VERTRAEGE §11.2): Zähler, Liste, Export als JSON-Datei.
// Wiedereinspielen gibt es in Phase 1 bewusst nicht. Einhängen (Statusleiste) macht der Lead.
import { useCallback, useEffect, useState } from 'react';
import type { SyncClient } from './client.ts';
import type { ShelfEntry } from './types.ts';

export type ShelfSource = Pick<SyncClient, 'listShelf' | 'onEvent'>;

/** JSON für den Export. */
export function shelfToJson(entries: readonly ShelfEntry[], exportedAt: number = Date.now()): string {
  return JSON.stringify(
    { format: 'sg-sync-error-shelf', version: 1, exported_at: new Date(exportedAt).toISOString(), entries },
    null,
    2,
  );
}

/** Löst den Datei-Download im Browser aus. */
export function downloadShelf(entries: readonly ShelfEntry[]): void {
  const blob = new Blob([shelfToJson(entries)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sync-fehlerablage-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const KIND_LABEL: Record<ShelfEntry['reason']['kind'], string> = {
  rejected: 'abgelehnt',
  dependent: 'abhängig von einer abgelehnten Operation',
  poison: 'wiederholt fehlgeschlagen',
  conflict_unresolved: 'Versionskonflikt nicht aufgelöst',
};

export function ErrorShelf({ client }: { client: ShelfSource }) {
  const [entries, setEntries] = useState<ShelfEntry[]>([]);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    client.listShelf().then(setEntries, () => undefined);
  }, [client]);

  useEffect(() => {
    refresh();
    return client.onEvent('shelf', refresh);
  }, [client, refresh]);

  if (entries.length === 0) return null;

  return (
    <div className="sync-error-shelf">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Sync-Fehlerablage ({entries.length})
      </button>
      {open && (
        <div role="region" aria-label="Sync-Fehlerablage">
          <p>
            Diese Änderungen konnten nicht an den Core übertragen werden. Sie werden nie automatisch gelöscht.
            Du kannst sie als Datei exportieren; Wiedereinspielen ist noch nicht möglich.
          </p>
          <button type="button" onClick={() => downloadShelf(entries)}>
            Als JSON exportieren
          </button>
          <ul>
            {entries.map((e) => (
              <li key={e.id}>
                <strong>{e.op.kind}</strong> – {KIND_LABEL[e.reason.kind]} ({e.reason.code}):{' '}
                {e.reason.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
