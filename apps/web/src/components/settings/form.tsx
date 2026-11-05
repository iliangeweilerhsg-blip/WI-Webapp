'use client';

import { createContext, useContext, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type { Settings, SettingsUpdate } from '@sg/shared';
import { friendlyMessage } from '../../lib/api.ts';
import { useSettings, useUpdateSettings } from '../../lib/settings.ts';
import { useToast } from '../../lib/toast.tsx';
import { CoreHint } from '../CoreHint.tsx';

export type AreaKey = 'general' | 'lecture' | 'pen';

const inputClass =
  'mt-1 w-full rounded-md border border-border-strong bg-bg px-3 py-2 text-md font-normal aria-[invalid=true]:border-2 aria-[invalid=true]:border-text';

/**
 * Zustand eines Formulars für einen Einstellungsbereich: Entwurf über dem Stand vom Core, Speichern sendet
 * nur die geänderten Felder (`PATCH /settings`). Zahlenfelder halten ihren Text, bis er gültig ist.
 */
export function useAreaForm<K extends AreaKey>(
  area: K,
  successMessage: string,
  onSaved?: (s: Settings) => void,
) {
  const query = useSettings();
  const update = useUpdateSettings();
  const toast = useToast();
  const [draft, setDraft] = useState<Partial<Settings[K]>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const server = query.data?.[area] as Settings[K] | undefined;
  const values = server ? ({ ...server, ...draft } as Settings[K]) : undefined;

  const changed = (server ? Object.keys(draft).filter((key) => differs(server, draft, key)) : []) as string[];
  const invalid = Object.keys(texts).length > 0;

  function set<F extends keyof Settings[K] & string>(field: F, value: Settings[K][F]) {
    setError(null);
    setDraft((current) => ({ ...current, [field]: value }));
  }

  /** Zahlenfeld: gültige ganze Zahlen ≥ `min` gehen in den Entwurf, alles andere bleibt als Text samt Fehler */
  function numberField<F extends keyof Settings[K] & string>(field: F, min: number) {
    const raw = texts[field];
    const current = values ? (values[field] as unknown as number) : 0;
    const text = raw ?? String(current);
    const message = raw === undefined ? null : `Bitte eine ganze Zahl ab ${min} eingeben.`;
    return {
      text,
      error: message,
      onChange(next: string) {
        const n = Number(next);
        if (next.trim() !== '' && Number.isInteger(n) && n >= min) {
          setTexts((t) => withoutKey(t, field));
          set(field, n as Settings[K][F]);
        } else {
          setError(null);
          setTexts((t) => ({ ...t, [field]: next }));
        }
      },
    };
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!server || changed.length === 0 || invalid || update.isPending) return;
    setError(null);
    const patch = Object.fromEntries(changed.map((key) => [key, (draft as Record<string, unknown>)[key]]));
    try {
      const saved = await update.mutateAsync({ [area]: patch } as SettingsUpdate);
      setDraft({});
      toast.show({ message: successMessage });
      onSaved?.(saved);
    } catch (failure) {
      const message = friendlyMessage(failure);
      setError(message);
      // Auch auf einem verborgenen Reiter sichtbar machen
      toast.show({ message: `Nicht gespeichert: ${message}` });
    }
  }

  function discard() {
    setDraft({});
    setTexts({});
    setError(null);
  }

  const dirty = changed.length > 0 || invalid;
  const hasError = error !== null;
  const { report } = useContext(SettingsTabContext);
  useEffect(() => {
    report({ error: hasError, dirty });
  }, [report, hasError, dirty]);

  const disabledReason = update.isPending
    ? null
    : invalid
      ? 'Bitte zuerst die markierten Felder korrigieren.'
      : changed.length === 0
        ? 'Keine Änderungen zu speichern.'
        : null;

  return {
    query,
    values,
    set,
    numberField,
    save,
    discard,
    saving: update.isPending,
    dirty,
    canSave: changed.length > 0 && !invalid && !update.isPending,
    disabledReason,
    error,
  };
}

/** Meldung eines Formulars an seinen Reiter: ungespeicherte Änderungen und Speicherfehler */
export interface TabMark {
  error: boolean;
  dirty: boolean;
}

/** Der Reiter, in dem ein Formular steht. Ohne Reiter (z. B. in Tests) passiert nichts. */
export const SettingsTabContext = createContext<{ report: (mark: TabMark) => void }>({ report: () => {} });

function withoutKey(record: Record<string, string>, key: string) {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function differs(server: object, draft: object, key: string): boolean {
  return (
    JSON.stringify((server as Record<string, unknown>)[key]) !==
    JSON.stringify((draft as Record<string, unknown>)[key])
  );
}

/** Der Teil von `useAreaForm`, den der Rahmen braucht (unabhängig vom Bereich) */
export interface AreaFormState {
  query: { isError: boolean; isPending: boolean; error: unknown };
  values: object | undefined;
  save: (event?: FormEvent) => Promise<void>;
  discard: () => void;
  saving: boolean;
  dirty: boolean;
  canSave: boolean;
  /** Warum „Speichern“ gesperrt ist (null, wenn es nicht gesperrt ist oder gerade gespeichert wird) */
  disabledReason: string | null;
  error: string | null;
}

/** Rahmen eines Bereichs: Überschrift, Erklärung, Ladezustand, Fehler, Speichern. */
export function AreaForm({
  title,
  intro,
  form,
  children,
}: {
  title: string;
  intro: string;
  form: AreaFormState;
  children: ReactNode;
}) {
  const headingId = useId();
  const reasonId = useId();
  return (
    <form
      onSubmit={form.save}
      aria-labelledby={headingId}
      className="mt-6 rounded-lg border border-border p-4"
      noValidate
    >
      <h2 id={headingId} className="text-lg font-medium">
        {title}
      </h2>
      <p className="mt-1 text-sm text-text-muted">{intro}</p>
      {form.query.isError ? (
        <div className="mt-3">
          <CoreHint error={form.query.error} />
        </div>
      ) : null}
      {form.query.isPending ? (
        <p role="status" className="mt-3 text-sm text-text-muted">
          Einstellungen werden geladen …
        </p>
      ) : null}
      {form.values ? (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={!form.canSave}
              aria-describedby={form.disabledReason ? reasonId : undefined}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast disabled:opacity-50"
            >
              {form.saving ? 'Speichert …' : 'Speichern'}
            </button>
            <button
              type="button"
              onClick={form.discard}
              disabled={!form.dirty || form.saving}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-surface disabled:opacity-50"
            >
              Änderungen verwerfen
            </button>
            {form.disabledReason ? (
              <p id={reasonId} className="text-xs text-text-muted">
                {form.disabledReason}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
      {form.error ? (
        <p role="alert" className="mt-3 text-sm font-medium">
          <span aria-hidden="true">⚠ </span>
          {form.error}
        </p>
      ) : null}
    </form>
  );
}

interface FieldShellProps {
  label: string;
  hint: string;
  error?: string | null | undefined;
  /** Feld über die ganze Breite */
  wide?: boolean;
  children: (ids: { id: string; describedBy: string }) => ReactNode;
}

/** Beschriftung, Erklärung (ein Satz, 07 §3.13) und Fehler eines Feldes, sichtbar und per `aria-describedby` verknüpft. */
function FieldShell({ label, hint, error, wide, children }: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className={wide ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children({ id, describedBy: error ? `${hintId} ${errorId}` : hintId })}
      <p id={hintId} className="mt-1 text-xs text-text-muted">
        {hint}
      </p>
      {error ? (
        <p id={errorId} className="mt-1 text-xs font-medium">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <FieldShell label={label} hint={hint}>
      {({ id, describedBy }) => (
        <select
          id={id}
          aria-describedby={describedBy}
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className={inputClass}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

export function NumberField({
  label,
  hint,
  unit,
  field,
}: {
  label: string;
  hint: string;
  /** Einheit, wird an die Beschriftung gehängt (z. B. „Minuten“) */
  unit: string;
  field: { text: string; error: string | null; onChange: (text: string) => void };
}) {
  return (
    <FieldShell label={`${label} (${unit})`} hint={hint} error={field.error}>
      {({ id, describedBy }) => (
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-describedby={describedBy}
          aria-invalid={field.error ? true : undefined}
          value={field.text}
          onChange={(e) => field.onChange(e.target.value)}
          className={inputClass}
        />
      )}
    </FieldShell>
  );
}

export function CheckboxField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="min-w-0 sm:col-span-2">
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
        <input
          id={id}
          type="checkbox"
          aria-describedby={hintId}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="size-4"
        />
        {label}
      </label>
      <p id={hintId} className="mt-1 text-xs text-text-muted">
        {hint}
      </p>
    </div>
  );
}

export function TextReadOnlyField({ label, hint, value }: { label: string; hint: string; value: string }) {
  return (
    <FieldShell label={label} hint={hint} wide>
      {({ id, describedBy }) => (
        <input
          id={id}
          type="text"
          readOnly
          aria-describedby={describedBy}
          value={value}
          className={`${inputClass} bg-surface font-mono text-sm`}
        />
      )}
    </FieldShell>
  );
}
