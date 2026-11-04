'use client';

import { useEffect, useState } from 'react';
import { useSemesters } from '../lib/semesters.ts';
import { SETUP_SKIPPED_KEY, SetupDialog } from './SetupDialog.tsx';

function wasSkipped(): boolean {
  try {
    return window.localStorage.getItem(SETUP_SKIPPED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSkipped(): void {
  try {
    window.localStorage.setItem(SETUP_SKIPPED_KEY, '1');
  } catch {
    // Speicher nicht verfügbar – der Dialog kommt dann beim nächsten Laden noch einmal
  }
}

/**
 * Öffnet den Einrichtungsdialog beim ersten Start, also wenn der Core noch kein Semester kennt (F-ORG-01).
 * Einmal geöffnet, bleibt er offen, bis jemand „Fertig“ oder „Später“ wählt – auch wenn das Semester
 * schon angelegt ist. `requested` zählt hoch, wenn jemand ihn über „Einrichten“ in der Seitenleiste ruft.
 */
export function SetupHost({ requested }: { requested: number }) {
  const semesters = useSemesters();
  const [open, setOpen] = useState(false);
  const firstRun = semesters.isSuccess && semesters.data.length === 0;

  useEffect(() => {
    if (firstRun && !wasSkipped()) setOpen(true);
  }, [firstRun]);

  useEffect(() => {
    if (requested > 0) setOpen(true);
  }, [requested]);

  return (
    <SetupDialog
      open={open}
      onSkip={() => {
        rememberSkipped();
        setOpen(false);
      }}
      onDone={() => setOpen(false)}
    />
  );
}
