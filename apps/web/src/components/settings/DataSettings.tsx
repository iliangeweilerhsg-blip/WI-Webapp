'use client';

import { useState, type FormEvent } from 'react';
import type { BackupRun } from '@sg/shared';
import { friendlyMessage } from '../../lib/api.ts';
import { useBackups, useSettings, useStartBackup, useUpdateSettings } from '../../lib/data.ts';
import { useToast } from '../../lib/toast.tsx';
import { CoreHint } from '../CoreHint.tsx';

const smallButton = 'rounded-md border border-border px-3 py-1 text-sm hover:bg-surface disabled:opacity-50';
const input = 'rounded-md border border-border bg-surface px-3 py-1 text-sm';

const STATE_LABEL: Record<BackupRun['state'], string> = {
  laeuft: 'läuft',
  fertig: 'fertig',
  fehler: 'Fehler',
};

export function formatSize(bytes: number | null): string {
  if (bytes === null) return '–';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Einstellungen → Daten (F-DAT-01): Backup-Ziel, Uhrzeit, Status, Läufe, „Jetzt sichern“. */
export function DataSettings() {
  const backups = useBackups();
  const settings = useSettings();
  const start = useStartBackup();
  const update = useUpdateSettings();
  const toast = useToast();
  const [target, setTarget] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);

  if (backups.isPending || settings.isPending) return <p className="text-sm text-text-muted">Lädt …</p>;
  if (backups.isError) return <CoreHint error={backups.error} />;
  if (settings.isError) return <CoreHint error={settings.error} />;

  const { status, items } = backups.data;
  const data = settings.data.data;
  const targetValue = target ?? data.backup_target ?? '';
  const timeValue = time ?? data.backup_time;
  const fail = (error: unknown) => toast.show({ message: friendlyMessage(error) });

  const save = (event: FormEvent) => {
    event.preventDefault();
    update.mutate(
      {
        data: {
          backup_target: targetValue.trim() === '' ? null : targetValue.trim(),
          backup_time: timeValue,
        },
      },
      {
        onSuccess: () => {
          setTarget(null);
          setTime(null);
          toast.show({ message: 'Gespeichert' });
        },
        onError: fail,
      },
    );
  };

  return (
    <section aria-labelledby="data-title" className="space-y-4">
      <h2 id="data-title" className="text-lg font-semibold">
        Daten und Backups
      </h2>
      <p className="text-sm" role="status">
        {status.target === null
          ? 'Kein Backup-Ziel eingerichtet: Es werden keine Backups angelegt.'
          : status.last_success_at
            ? `Letztes Backup: ${new Date(status.last_success_at).toLocaleString('de-DE')}`
            : 'Noch kein Backup gelaufen.'}
        {status.stale && status.target !== null ? (
          <span className="ml-2 rounded-sm bg-accent-soft px-2 py-0.5 text-xs">
            veraltet (älter als 3 Tage)
          </span>
        ) : null}
        {status.next_run_at ? ` · nächstes: ${new Date(status.next_run_at).toLocaleString('de-DE')}` : ''}
      </p>

      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
          Backup-Ziel (absoluter Ordnerpfad)
          <input
            className={input}
            value={targetValue}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="/Volumes/Backup/StudienGehirn"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Uhrzeit
          <input className={input} type="time" value={timeValue} onChange={(e) => setTime(e.target.value)} />
        </label>
        <button type="submit" disabled={update.isPending} className={smallButton}>
          Speichern
        </button>
        <button
          type="button"
          disabled={start.isPending || status.running || status.target === null}
          className={smallButton}
          onClick={() => start.mutate(undefined, { onError: fail })}
        >
          {status.running ? 'Backup läuft …' : 'Jetzt sichern'}
        </button>
      </form>

      {items.length > 0 ? (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Letzte Backups</caption>
          <thead>
            <tr className="text-text-muted">
              <th scope="col" className="py-1 font-normal">
                Start
              </th>
              <th scope="col" className="font-normal">
                Auslöser
              </th>
              <th scope="col" className="font-normal">
                Status
              </th>
              <th scope="col" className="font-normal">
                Größe
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((run) => (
              <tr key={run.id} className="border-t border-border">
                <td className="py-1">{new Date(run.started_at).toLocaleString('de-DE')}</td>
                <td>{run.trigger.replace('_', ' ')}</td>
                <td>
                  {STATE_LABEL[run.state]}
                  {run.error ? `: ${run.error}` : ''}
                </td>
                <td>{formatSize(run.size_bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
