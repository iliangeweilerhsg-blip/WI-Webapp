'use client';

import { useState } from 'react';
import type { CalendarSource, IcsImportResult } from '@sg/shared';
import {
  calendarErrorMessage,
  formatStamp,
  summarizeImport,
  useCalendarSources,
  useDeleteSource,
  useSyncSource,
} from '../lib/calendar.ts';
import { useToast } from '../lib/toast.tsx';
import { CoreHint } from './CoreHint.tsx';

const smallButton = 'rounded-md border border-border px-3 py-1 text-sm hover:bg-surface disabled:opacity-50';

function SourceRow({
  source,
  busy,
  onSync,
  onDelete,
}: {
  source: CalendarSource;
  busy: boolean;
  onSync: (source: CalendarSource, file?: File) => void;
  onDelete: (source: CalendarSource) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const isUrl = source.kind === 'ics_url';
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="font-medium">{source.name}</span>
          <span className="ml-2 text-sm text-text-muted">
            {source.event_count} {source.event_count === 1 ? 'Termin' : 'Termine'} ·{' '}
            {isUrl ? 'abonniert' : 'Datei'}
          </span>
          <p className="mt-0.5 text-sm text-text-muted">
            {source.last_synced_at
              ? `Zuletzt abgeglichen: ${formatStamp(source.last_synced_at)}`
              : 'Noch nicht abgeglichen'}
          </p>
          {source.last_error ? (
            <p role="status" className="mt-1 text-sm">
              Der letzte Abgleich hat nicht geklappt. Die bisherigen Termine bleiben. {source.last_error}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {isUrl ? (
            <button
              type="button"
              disabled={busy}
              aria-label={`${source.name} jetzt abgleichen`}
              onClick={() => onSync(source)}
              className={smallButton}
            >
              Jetzt abgleichen
            </button>
          ) : (
            <label className={`${smallButton} cursor-pointer`}>
              Neue Fassung
              <input
                type="file"
                accept=".ics,text/calendar"
                aria-label={`Neue Fassung für ${source.name} hochladen`}
                disabled={busy}
                className="sr-only"
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  e.target.value = '';
                  if (picked) onSync(source, picked);
                }}
              />
            </label>
          )}
          {confirming ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  onDelete(source);
                }}
                aria-label={`${source.name} wirklich entfernen`}
                className={smallButton}
              >
                Ja, entfernen
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={smallButton}>
                Abbrechen
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              aria-label={`${source.name} entfernen`}
              onClick={() => setConfirming(true)}
              className={smallButton}
            >
              Entfernen
            </button>
          )}
        </div>
      </div>
      {confirming ? (
        <p className="mt-2 text-sm text-text-muted">
          Die Quelle und ihre Termine verschwinden aus dem Kalender. Aufgenommene Sessions bleiben erhalten.
        </p>
      ) : null}
    </li>
  );
}

/** Die eingerichteten Kalenderquellen: abgleichen, neue Fassung hochladen, entfernen. */
export function CalendarSources({ onResult }: { onResult: (result: IcsImportResult) => void }) {
  const sources = useCalendarSources();
  const sync = useSyncSource();
  const remove = useDeleteSource();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const busy = sync.isPending || remove.isPending;

  async function onSync(source: CalendarSource, file?: File) {
    setError(null);
    try {
      const result = await sync.mutateAsync(file ? { source, file } : { source });
      toast.show({ message: `${source.name}: ${summarizeImport(result)}` });
      if (result.module_suggestions.length > 0 || result.warnings.length > 0) onResult(result);
    } catch (failure) {
      setError(`${source.name}: ${calendarErrorMessage(failure)}`);
    }
  }

  async function onDelete(source: CalendarSource) {
    setError(null);
    try {
      await remove.mutateAsync(source);
      toast.show({ message: `${source.name} entfernt` });
    } catch (failure) {
      setError(calendarErrorMessage(failure));
    }
  }

  if (sources.isError) return <CoreHint error={sources.error} />;
  if (!sources.isSuccess || sources.data.length === 0) return null;

  return (
    <div className="rounded-lg border border-border p-4">
      <h2 className="text-lg font-medium">Quellen</h2>
      <ul aria-label="Kalenderquellen" className="mt-2 divide-y divide-border">
        {sources.data.map((source) => (
          <SourceRow key={source.id} source={source} busy={busy} onSync={onSync} onDelete={onDelete} />
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-text-muted">
          {error}
        </p>
      ) : null}
    </div>
  );
}
