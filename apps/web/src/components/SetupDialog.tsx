'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { friendlyMessage } from '../lib/api.ts';
import { moduleColorVar } from '../lib/modules.ts';
import { FailedModules } from './FailedModules.tsx';
import { useQuickModules } from '../lib/quick-modules.ts';
import { suggestSemesterName, useCreateSemester } from '../lib/semesters.ts';

export const SETUP_SKIPPED_KEY = 'sg-setup-skipped';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])';

/** Tab und Shift+Tab bleiben im Dialog */
export function trapTab(e: ReactKeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Tab') return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !e.currentTarget.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !e.currentTarget.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

/** Fokus zurück an die Stelle vor dem Dialog, sonst in den Hauptbereich */
function restoreFocus(previous: HTMLElement | null): void {
  if (previous && previous !== document.body && document.contains(previous)) previous.focus();
  else document.getElementById('main')?.focus();
}

interface SetupDialogProps {
  open: boolean;
  /** „Später“ oder Esc: der Dialog erscheint nicht von selbst wieder */
  onSkip: () => void;
  /** „Fertig“ */
  onDone: () => void;
}

function ModuleStep({
  semesterId,
  error: outerError,
  onSkip,
  onDone,
}: {
  semesterId: string;
  error: string | null;
  onSkip: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const quick = useQuickModules({ semesterId, keepDone: true });

  useEffect(() => input.current?.focus(), []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    quick.add(name);
    setName(''); // sofort leeren: schnelles Weitertippen verklebt nichts
    input.current?.focus();
  }

  return (
    <div className="mt-1">
      <h2 id="setup-title" className="text-xl font-semibold">
        Welche Module belegst du?
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Tippe einen Namen und drücke Enter. Die Farbe wählt die App für dich.
      </p>
      <form onSubmit={onSubmit} className="mt-4">
        <label htmlFor="setup-module" className="block text-sm font-medium">
          Modulname
        </label>
        <input
          id="setup-module"
          ref={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          placeholder="z. B. Datenbanksysteme"
          className="mt-1 w-full rounded-md border border-border-strong bg-bg px-3 py-2 text-md"
        />
      </form>
      {outerError ? (
        <p role="alert" className="mt-2 text-sm text-text-muted">
          {outerError}
        </p>
      ) : null}
      <FailedModules
        semesterId={semesterId}
        message={quick.error}
        onRetry={quick.retryFailed}
        className="mt-2 text-sm text-text-muted"
      />
      {quick.entries.length > 0 ? (
        <ul aria-label="Angelegte Module" className="mt-3 flex flex-col gap-1">
          {quick.entries.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full border border-border-strong"
                style={
                  m.module
                    ? { backgroundColor: moduleColorVar(m.module.color), borderColor: 'transparent' }
                    : {}
                }
              />
              <span className={m.status === 'pending' ? 'text-text-muted' : ''}>{m.name}</span>
              {m.status === 'pending' ? (
                <span className="text-xs text-text-muted">wird angelegt …</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-5 flex items-center justify-between">
        <button
          type="button"
          onClick={onSkip}
          className="rounded-md px-3 py-2 text-sm text-text-muted hover:bg-surface"
        >
          Später
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast"
        >
          Fertig
        </button>
      </div>
    </div>
  );
}

/**
 * Einrichtungsdialog beim ersten Start (F-ORG-01, 07 §7): Schritt 1 Semester, Schritt 2 Module.
 * Name genügt, Enter legt an, die Liste wächst, die Farbe vergibt der Core. Kein Zwang: „Später“ jederzeit.
 */
export function SetupDialog({ open, onSkip, onDone }: SetupDialogProps) {
  const [semesterName, setSemesterName] = useState('');
  const [semesterId, setSemesterId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const semesterInput = useRef<HTMLInputElement>(null);
  const createSemester = useCreateSemester();

  // Beim Öffnen frisch starten; der Vorschlag kommt aus dem aktuellen Datum (erst im Browser bekannt)
  useEffect(() => {
    if (!open) return;
    setSemesterName(suggestSemesterName());
    setSemesterId(null);
    setError(null);
    const previous = document.activeElement as HTMLElement | null;
    semesterInput.current?.focus();
    semesterInput.current?.select();
    return () => restoreFocus(previous);
  }, [open]);

  if (!open) return null;

  async function submitSemester(e: FormEvent) {
    e.preventDefault();
    const name = semesterName.trim();
    if (!name || createSemester.isPending) return;
    setError(null);
    try {
      const semester = await createSemester.mutateAsync({ name });
      setSemesterId(semester.id);
    } catch (failure) {
      setError(friendlyMessage(failure));
    }
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onSkip();
      return;
    }
    trapTab(e);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
        onKeyDown={onKeyDown}
        className="w-full max-w-[480px] rounded-lg border border-border bg-surface-raised p-6 shadow-lg"
      >
        <p className="text-xs text-text-muted">Schritt {semesterId ? 2 : 1} von 2</p>

        {semesterId ? (
          <ModuleStep semesterId={semesterId} error={error} onSkip={onSkip} onDone={onDone} />
        ) : (
          <form onSubmit={submitSemester} className="mt-1">
            <h2 id="setup-title" className="text-xl font-semibold">
              Willkommen. In welchem Semester bist du?
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Der Name genügt. Alles andere kannst du später ergänzen.
            </p>
            <label htmlFor="setup-semester" className="mt-4 block text-sm font-medium">
              Semester
            </label>
            <input
              id="setup-semester"
              ref={semesterInput}
              value={semesterName}
              onChange={(e) => setSemesterName(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-border-strong bg-bg px-3 py-2 text-md"
            />
            {error ? (
              <p role="alert" className="mt-2 text-sm text-text-muted">
                {error}
              </p>
            ) : null}
            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                onClick={onSkip}
                className="rounded-md px-3 py-2 text-sm text-text-muted hover:bg-surface"
              >
                Später
              </button>
              <button
                type="submit"
                disabled={!semesterName.trim() || createSemester.isPending}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast disabled:opacity-50"
              >
                Weiter
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
