'use client';

import { SemesterSettings } from './SemesterSettings.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

/** Einstellungen (07 §3.13). Vorerst nur die Darstellung; jede Option mit einem Satz Erklärung. */
export function SettingsView() {
  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="text-xxl font-semibold">
        Einstellungen
      </h1>
      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-lg font-medium">Darstellung</h2>
        <p className="mt-1 text-sm text-text-muted">
          „System“ folgt deinem Mac. Hell oder Dunkel gilt dann immer, bis du es änderst.
        </p>
        <div className="mt-3">
          <ThemeToggle />
        </div>
      </div>
      <SemesterSettings />
      <p className="mt-6 text-sm text-text-muted">Weitere Einstellungen kommen mit Phase 1.</p>
    </section>
  );
}
