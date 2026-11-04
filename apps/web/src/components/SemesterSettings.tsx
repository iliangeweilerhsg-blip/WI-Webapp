'use client';

import { useState, type FormEvent } from 'react';
import type { Semester, SemesterUpdate } from '@sg/shared';
import { friendlyMessage } from '../lib/api.ts';
import { useToast } from '../lib/toast.tsx';
import { suggestSemesterName, useCreateSemester, useSemesters, useUpdateSemester } from '../lib/semesters.ts';
import { CoreHint } from './CoreHint.tsx';

const smallButton = 'rounded-md border border-border px-3 py-1 text-sm hover:bg-surface disabled:opacity-50';

function SemesterRow({
  semester,
  busy,
  onChange,
}: {
  semester: Semester;
  busy: boolean;
  onChange: (id: string, patch: SemesterUpdate) => void;
}) {
  const archived = semester.archived_at !== null;
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <span className="font-medium">{semester.name}</span>
        {semester.is_current ? (
          <span className="ml-2 rounded-sm bg-accent-soft px-2 py-0.5 text-xs">aktuell</span>
        ) : null}
        {archived ? <span className="ml-2 text-xs text-text-muted">archiviert</span> : null}
      </div>
      <div className="flex shrink-0 gap-2">
        {!archived && !semester.is_current ? (
          <button
            type="button"
            disabled={busy}
            aria-label={`${semester.name} als aktuell setzen`}
            onClick={() => onChange(semester.id, { is_current: true })}
            className={smallButton}
          >
            Als aktuell setzen
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          aria-label={archived ? `${semester.name} wiederherstellen` : `${semester.name} archivieren`}
          onClick={() => onChange(semester.id, { archived: !archived })}
          className={smallButton}
        >
          {archived ? 'Wiederherstellen' : 'Archivieren'}
        </button>
      </div>
    </li>
  );
}

/** Einstellungen → Semester (F-ORG-01): anlegen, als aktuell setzen, archivieren und wiederherstellen. */
export function SemesterSettings() {
  const semesters = useSemesters();
  const create = useCreateSemester();
  const update = useUpdateSemester();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || create.isPending) return;
    setError(null);
    try {
      await create.mutateAsync({ name: trimmed });
      setName('');
    } catch (failure) {
      setError(friendlyMessage(failure));
    }
  }

  async function onChange(id: string, patch: SemesterUpdate) {
    setError(null);
    const target = semesters.data?.find((s) => s.id === id);
    try {
      await update.mutateAsync({ id, patch });
      if (patch.archived === true && target) {
        // Das aktuelle Semester wurde archiviert: das neueste nicht archivierte rückt nach
        const next = target.is_current
          ? semesters.data?.find((s) => s.id !== id && s.archived_at === null)
          : undefined;
        if (next) {
          await update.mutateAsync({ id: next.id, patch: { is_current: true } });
          toast.show({ message: `${target.name} archiviert · ${next.name} ist jetzt aktuell` });
        } else if (target.is_current) {
          toast.show({ message: `${target.name} archiviert · Es gibt kein aktuelles Semester mehr` });
        }
      }
    } catch (failure) {
      setError(friendlyMessage(failure));
    }
  }

  const active = semesters.data?.filter((s) => s.archived_at === null) ?? [];
  const archived = semesters.data?.filter((s) => s.archived_at !== null) ?? [];

  return (
    <div className="mt-6 rounded-lg border border-border p-4">
      <h2 className="text-lg font-medium">Semester</h2>
      <p className="mt-1 text-sm text-text-muted">
        Die Seitenleiste zeigt die Module des aktuellen Semesters. Archivierte Semester verschwinden dort,
        ihre Inhalte bleiben durchsuchbar und lernbar.
      </p>

      {semesters.isError ? (
        <div className="mt-3">
          <CoreHint error={semesters.error} />
        </div>
      ) : null}
      {semesters.isSuccess && semesters.data.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">Noch kein Semester. Lege unten das erste an.</p>
      ) : null}

      {active.length > 0 ? (
        <ul aria-label="Semester" className="mt-3 divide-y divide-border">
          {active.map((s) => (
            <SemesterRow key={s.id} semester={s} busy={update.isPending} onChange={onChange} />
          ))}
        </ul>
      ) : null}

      {archived.length > 0 ? (
        <>
          <h3 className="mt-4 text-sm font-medium text-text-muted">Archiviert</h3>
          <ul aria-label="Archivierte Semester" className="mt-1 divide-y divide-border">
            {archived.map((s) => (
              <SemesterRow key={s.id} semester={s} busy={update.isPending} onChange={onChange} />
            ))}
          </ul>
        </>
      ) : null}

      <form onSubmit={onCreate} className="mt-4 flex items-end gap-2">
        <label className="block flex-1 text-sm font-medium">
          Neues Semester
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={suggestSemesterName(
              new Date(),
              semesters.data?.map((s) => s.name),
            )}
            autoComplete="off"
            className="mt-1 w-full rounded-md border border-border-strong bg-bg px-3 py-2 text-md font-normal"
          />
        </label>
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast disabled:opacity-50"
        >
          Anlegen
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-text-muted">
          {error}
        </p>
      ) : null}
    </div>
  );
}
