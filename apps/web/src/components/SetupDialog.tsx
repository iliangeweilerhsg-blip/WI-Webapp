'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Module } from '@sg/shared';
import { friendlyMessage } from '../lib/api.ts';
import { moduleColorVar, useCreateModule } from '../lib/modules.ts';
import { suggestSemesterName, useCreateSemester } from '../lib/semesters.ts';

export const SETUP_SKIPPED_KEY = 'sg-setup-skipped';

type Step = 'semester' | 'module';

interface SetupDialogProps {
  open: boolean;
  /** „Später“ oder Esc: der Dialog erscheint nicht von selbst wieder */
  onSkip: () => void;
  /** „Fertig“ */
  onDone: () => void;
}

/**
 * Einrichtungsdialog beim ersten Start (F-ORG-01, 07 §7): Schritt 1 Semester, Schritt 2 Module.
 * Name genügt, Enter legt an, die Liste wächst, die Farbe vergibt der Core. Kein Zwang: „Später“ jederzeit.
 */
export function SetupDialog({ open, onSkip, onDone }: SetupDialogProps) {
  const [step, setStep] = useState<Step>('semester');
  const [semesterName, setSemesterName] = useState('');
  const [semesterId, setSemesterId] = useState<string | null>(null);
  const [moduleName, setModuleName] = useState('');
  const [created, setCreated] = useState<Module[]>([]);
  const [error, setError] = useState<string | null>(null);
  const semesterInput = useRef<HTMLInputElement>(null);
  const moduleInput = useRef<HTMLInputElement>(null);
  const createSemester = useCreateSemester();
  const createModule = useCreateModule();

  // Beim Öffnen frisch starten; der Vorschlag kommt aus dem aktuellen Datum (erst im Browser bekannt)
  useEffect(() => {
    if (!open) return;
    setStep('semester');
    setSemesterName(suggestSemesterName());
    setSemesterId(null);
    setModuleName('');
    setCreated([]);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const input = step === 'semester' ? semesterInput.current : moduleInput.current;
    input?.focus();
    if (step === 'semester') input?.select();
  }, [open, step]);

  if (!open) return null;

  async function submitSemester(e: FormEvent) {
    e.preventDefault();
    const name = semesterName.trim();
    if (!name || createSemester.isPending) return;
    setError(null);
    try {
      const semester = await createSemester.mutateAsync({ name });
      setSemesterId(semester.id);
      setStep('module');
    } catch (failure) {
      setError(friendlyMessage(failure));
    }
  }

  async function submitModule(e: FormEvent) {
    e.preventDefault();
    const name = moduleName.trim();
    if (!name || !semesterId || createModule.isPending) return;
    setError(null);
    try {
      const module = await createModule.mutateAsync({ semester_id: semesterId, name });
      setCreated((list) => [...list, module]);
      setModuleName('');
      moduleInput.current?.focus();
    } catch (failure) {
      setError(friendlyMessage(failure));
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onSkip();
    }
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
        <p className="text-xs text-text-muted">Schritt {step === 'semester' ? 1 : 2} von 2</p>

        {step === 'semester' ? (
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
        ) : (
          <div className="mt-1">
            <h2 id="setup-title" className="text-xl font-semibold">
              Welche Module belegst du?
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Tippe einen Namen und drücke Enter. Die Farbe wählt die App für dich.
            </p>
            <form onSubmit={submitModule} className="mt-4">
              <label htmlFor="setup-module" className="block text-sm font-medium">
                Modulname
              </label>
              <input
                id="setup-module"
                ref={moduleInput}
                value={moduleName}
                onChange={(e) => setModuleName(e.target.value)}
                autoComplete="off"
                placeholder="z. B. Datenbanksysteme"
                className="mt-1 w-full rounded-md border border-border-strong bg-bg px-3 py-2 text-md"
              />
            </form>
            {error ? (
              <p role="alert" className="mt-2 text-sm text-text-muted">
                {error}
              </p>
            ) : null}
            {created.length > 0 ? (
              <ul aria-label="Angelegte Module" className="mt-3 flex flex-col gap-1">
                {created.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-sm">
                    <span
                      aria-hidden="true"
                      className="size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: moduleColorVar(m.color) }}
                    />
                    {m.name}
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
        )}
      </div>
    </div>
  );
}
