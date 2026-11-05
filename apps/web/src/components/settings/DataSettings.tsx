'use client';

import { useState, type FormEvent } from 'react';
import type { BackupRun, RestoreTest } from '@sg/shared';
import { friendlyMessage } from '../../lib/api.ts';
import {
  useBackups,
  useSettings,
  useStartBackup,
  useStartRestoreTest,
  useUpdateSettings,
} from '../../lib/data.ts';
import { useToast } from '../../lib/toast.tsx';
import { CoreHint } from '../CoreHint.tsx';

const smallButton = 'rounded-md border border-border px-3 py-1 text-sm hover:bg-surface disabled:opacity-50';
const input = 'rounded-md border border-border bg-surface px-3 py-1 text-sm';

const STATE_LABEL: Record<BackupRun['state'], string> = {
  laeuft: 'läuft',
  fertig: 'fertig',
  fehler: 'Fehler',
};

/** Verständlicher Hinweis mit Handlungsempfehlung je Fehlergrund des Restore-Tests (F-DAT-02) */
const RESTORE_ADVICE: Record<NonNullable<RestoreTest['reason']>, string> = {
  kein_backup:
    'Es gab noch kein Backup, das sich testen lässt. Lege mit „Jetzt sichern“ ein Backup an und teste danach erneut.',
  ziel_nicht_erreichbar:
    'Das Backup-Ziel ist nicht erreichbar. Schließe den Datenträger an bzw. prüfe den Ordnerpfad und teste erneut.',
  nicht_authentisch:
    'Der Stand im Backup-Ziel passt nicht zu deinem protokollierten Backup und wurde aus Sicherheitsgründen nicht geprüft. Jemand oder etwas hat das Ziel verändert. Prüfe das Ziel und lege mit „Jetzt sichern“ ein neues Backup an.',
  beschaedigt:
    'Der Stand im Backup-Ziel ist beschädigt. Lege mit „Jetzt sichern“ ein neues Backup an und prüfe den Datenträger.',
  dateien_abweichend:
    'Fotos, Aufnahmen oder Notizen im Backup sind unvollständig. Lege mit „Jetzt sichern“ ein neues Backup an und prüfe den Datenträger.',
  tabellen_fehlen:
    'Im Backup fehlen Daten der Datenbank. Lege mit „Jetzt sichern“ ein neues Backup an. Tritt es erneut auf, melde es.',
  restore_fehlgeschlagen:
    'Das Backup ließ sich nicht einspielen. Lege mit „Jetzt sichern“ ein neues Backup an und teste erneut. Prüfe, ob PostgreSQL läuft und genug Platz frei ist.',
  abgebrochen:
    'Der Test wurde nicht beendet (Mac ausgeschaltet oder Programm beendet). Starte ihn mit „Jetzt testen“ erneut.',
  intern: 'Der Test konnte nicht ausgeführt werden. Starte ihn mit „Jetzt testen“ erneut.',
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
  const startTest = useStartRestoreTest();
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

      <RestoreTestStatus
        test={status.restore_test}
        disabled={startTest.isPending || status.running || status.target === null}
        onStart={() => startTest.mutate(undefined, { onError: fail })}
      />

      {data.backup_encryption && data.backup_target !== null ? (
        <div role="status" className="space-y-2 rounded-md border border-border bg-accent-soft p-3 text-sm">
          <p>
            „Backup verschlüsseln“ ist noch eingeschaltet, Verschlüsselung ist aber noch nicht verfügbar.
            Deshalb schlagen Backups fehl, es wird nie unverschlüsselt gesichert, solange die Option an ist.
          </p>
          <button
            type="button"
            disabled={update.isPending}
            className={smallButton}
            onClick={() =>
              update.mutate(
                { data: { backup_encryption: false } },
                {
                  onSuccess: () =>
                    toast.show({
                      message: 'Backups laufen jetzt unverschlüsselt',
                    }),
                  onError: fail,
                },
              )
            }
          >
            Ohne Verschlüsselung sichern
          </button>
        </div>
      ) : null}

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

function RestoreTestStatus(props: { test: RestoreTest | null; disabled: boolean; onStart: () => void }) {
  const { test } = props;
  const running = test?.state === 'laeuft';
  const date = test ? new Date(test.finished_at ?? test.started_at).toLocaleString('de-DE') : '';
  return (
    <div className="space-y-1 text-sm" role="status" aria-label="Restore-Test">
      <p>
        {test === null
          ? 'Restore-Test: noch nicht gelaufen. Er prüft einmal im Monat automatisch, ob sich dein jüngstes Backup wiederherstellen lässt.'
          : test.state === 'laeuft'
            ? 'Restore-Test läuft …'
            : test.state === 'ok'
              ? `Letzter Restore-Test: ${date}, erfolgreich`
              : `Letzter Restore-Test: ${date}, fehlgeschlagen`}
        <button
          type="button"
          disabled={props.disabled || running}
          className={`${smallButton} ml-3`}
          onClick={props.onStart}
        >
          {running ? 'Test läuft …' : 'Jetzt testen'}
        </button>
      </p>
      {test?.state === 'fehler' && test.reason ? (
        <div className="rounded-md border border-border bg-accent-soft p-3">
          <p>{RESTORE_ADVICE[test.reason]}</p>
          {test.error ? <p className="mt-1 text-xs text-text-muted">Technisch: {test.error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
