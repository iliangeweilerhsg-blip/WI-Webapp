'use client';

import { useRef, useState, type FormEvent } from 'react';
import type { IcsImportResult, IcsModuleSuggestion } from '@sg/shared';
import {
  MAX_ICS_BYTES,
  calendarErrorMessage,
  summarizeImport,
  useImportFile,
  useImportUrl,
  useUpdateEvent,
} from '../lib/calendar.ts';
import { friendlyMessage } from '../lib/api.ts';
import { useCreateModule } from '../lib/modules.ts';
import { pickCurrentSemester, useSemesters } from '../lib/semesters.ts';

const field = 'mt-1 w-full rounded-md border border-border-strong bg-bg px-3 py-2 text-md font-normal';
const primaryButton =
  'rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast disabled:opacity-50';
const smallButton = 'rounded-md border border-border px-3 py-1 text-sm hover:bg-surface disabled:opacity-50';

/** Stundenplan importieren (F-KAL-01): ICS-Datei hochladen oder eine ICS-URL abonnieren. */
export function CalendarImport({ onResult }: { onResult: (result: IcsImportResult) => void }) {
  const importFile = useImportFile();
  const importUrl = useImportUrl();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  function onPick(next: File | null) {
    setFileError(null);
    if (next && next.size > MAX_ICS_BYTES) {
      setFile(null);
      setFileError('Die Datei ist zu groß (höchstens 5 MB).');
      return;
    }
    setFile(next);
  }

  async function onUploadFile(e: FormEvent) {
    e.preventDefault();
    if (!file || importFile.isPending) return;
    setFileError(null);
    try {
      const result = await importFile.mutateAsync({ file });
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      onResult(result);
    } catch (failure) {
      setFileError(calendarErrorMessage(failure));
    }
  }

  async function onSubscribe(e: FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || importUrl.isPending) return;
    setUrlError(null);
    try {
      const result = await importUrl.mutateAsync({ url: trimmed });
      setUrl('');
      onResult(result);
    } catch (failure) {
      setUrlError(calendarErrorMessage(failure));
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <h2 className="text-lg font-medium">Stundenplan importieren</h2>
      <p className="mt-1 text-sm text-text-muted">
        Lade eine ICS-Datei hoch oder abonniere die Adresse deines Stundenplans. Wiederholungen und Ausnahmen
        werden aufgelöst, abonnierte Adressen gleicht der Core alle 6 Stunden ab.
      </p>

      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <form onSubmit={onUploadFile} aria-label="ICS-Datei importieren">
          <label className="block text-sm font-medium">
            ICS-Datei
            <input
              ref={fileInput}
              type="file"
              accept=".ics,text/calendar"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm font-normal file:mr-3 file:rounded-md file:border file:border-border file:bg-bg file:px-3 file:py-2 file:text-sm"
            />
          </label>
          {fileError ? (
            <p role="alert" className="mt-2 text-sm text-text-muted">
              {fileError}
            </p>
          ) : null}
          <button type="submit" disabled={!file || importFile.isPending} className={`${primaryButton} mt-3`}>
            {importFile.isPending ? 'Importiere …' : 'Datei importieren'}
          </button>
        </form>

        <form onSubmit={onSubscribe} aria-label="ICS-URL abonnieren">
          <label className="block text-sm font-medium">
            Adresse (https:// oder webcal://)
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="webcal://stundenplan.example.edu/plan.ics"
              className={field}
            />
          </label>
          {urlError ? (
            <p role="alert" className="mt-2 text-sm text-text-muted">
              {urlError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={!url.trim() || importUrl.isPending}
            className={`${primaryButton} mt-3`}
          >
            {importUrl.isPending ? 'Rufe ab …' : 'Abonnieren'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Ergebnis
// ---------------------------------------------------------------------------------------------

/**
 * Ergebnis eines Imports oder Abgleichs: Zusammenfassung, Hinweise des Core und der Vorschlag „neues Modul anlegen?“
 * für Titel, die zu keinem Modul passen (F-KAL-02).
 */
export function CalendarImportResult({
  result,
  onDismiss,
}: {
  result: IcsImportResult;
  onDismiss: () => void;
}) {
  const semesters = useSemesters();
  const createModule = useCreateModule();
  const updateEvent = useUpdateEvent();
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const semester = semesters.data ? pickCurrentSemester(semesters.data) : undefined;
  const open = result.module_suggestions.filter((s) => !done.has(s.name));
  const { counts } = result;

  async function create(suggestion: IcsModuleSuggestion): Promise<boolean> {
    if (!semester) return false;
    try {
      const created = await createModule.mutateAsync({ semester_id: semester.id, name: suggestion.name });
      // Nach POST /modules: eine Serie nach der anderen dem neuen Modul zuordnen (IcsModuleSuggestion)
      for (const eventId of suggestion.series_event_ids) {
        await updateEvent.mutateAsync({ id: eventId, patch: { module_id: created.id, scope: 'serie' } });
      }
      setDone((previous) => new Set(previous).add(suggestion.name));
      return true;
    } catch (failure) {
      setError(`„${suggestion.name}“ ließ sich nicht anlegen. ${friendlyMessage(failure)}`);
      return false;
    }
  }

  async function createOne(suggestion: IcsModuleSuggestion) {
    if (busy) return;
    setBusy(true);
    setError(null);
    await create(suggestion);
    setBusy(false);
  }

  async function createAll() {
    if (busy) return;
    setBusy(true);
    setError(null);
    for (const suggestion of open) {
      if (!(await create(suggestion))) break;
    }
    setBusy(false);
  }

  return (
    <div
      role="region"
      aria-label="Ergebnis des Imports"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">{result.source.name}</h2>
          <p className="mt-1 text-sm">{summarizeImport(result)}</p>
          <p className="mt-1 text-sm text-text-muted">
            {counts.zugeordnet > 0
              ? `${counts.zugeordnet} automatisch einem Modul zugeordnet`
              : 'Noch nichts einem Modul zugeordnet'}
            {counts.ohne_modul > 0 ? ` · ${counts.ohne_modul} ohne Modul` : ''}
          </p>
        </div>
        <button type="button" onClick={onDismiss} className={smallButton}>
          Schließen
        </button>
      </div>

      {result.warnings.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-sm font-medium">Hinweise</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-text-muted">
            {result.warnings.map((warning, index) => (
              <li key={`${warning.code}-${warning.external_uid ?? ''}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {open.length > 0 ? (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Neues Modul anlegen?</h3>
            {open.length > 1 && semester ? (
              <button type="button" onClick={createAll} disabled={busy} className={smallButton}>
                Alle anlegen
              </button>
            ) : null}
          </div>
          {semester ? (
            <p className="mt-1 text-sm text-text-muted">
              Diese Titel passen zu keinem Modul in {semester.name}. Beim Anlegen werden die Termine der Serie
              zugeordnet.
            </p>
          ) : (
            <p className="mt-1 text-sm text-text-muted">
              Lege zuerst in den Einstellungen ein Semester an, dann kannst du hier Module aus dem Stundenplan
              anlegen.
            </p>
          )}
          <ul aria-label="Modulvorschläge" className="mt-2 divide-y divide-border">
            {open.map((suggestion) => (
              <li key={suggestion.name} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <span className="font-medium">{suggestion.name}</span>
                  <span className="ml-2 text-sm text-text-muted">
                    {suggestion.event_count} {suggestion.event_count === 1 ? 'Termin' : 'Termine'}
                  </span>
                </div>
                {semester ? (
                  <button
                    type="button"
                    onClick={() => createOne(suggestion)}
                    disabled={busy}
                    aria-label={`Modul ${suggestion.name} anlegen`}
                    className={smallButton}
                  >
                    Anlegen
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-text-muted">
          {error}
        </p>
      ) : null}
    </div>
  );
}
