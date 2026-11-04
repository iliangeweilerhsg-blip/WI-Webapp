'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ComingSoon } from './settings/ComingSoon.tsx';
import { GeneralSettingsForm } from './settings/GeneralSettings.tsx';
import { LectureSettingsForm } from './settings/LectureSettings.tsx';
import { PenSettingsForm } from './settings/PenSettings.tsx';
import { SemesterSettings } from './SemesterSettings.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

/** Darstellung dieses Geräts (07 §8) und Semester aus Phase 0, dazu die allgemeinen Einstellungen (T1-19). */
function GeneralTab() {
  return (
    <>
      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-lg font-medium">Darstellung</h2>
        <p className="mt-1 text-sm text-text-muted">
          „System“ folgt deinem Mac. Hell oder Dunkel gilt dann immer, bis du es änderst.
        </p>
        <div className="mt-3">
          <ThemeToggle />
        </div>
      </div>
      <GeneralSettingsForm />
      <SemesterSettings />
    </>
  );
}

interface SettingsTab {
  id: string;
  label: string;
  panel: () => ReactNode;
}

/**
 * Die Reiter der Einstellungen (07 §3.13, F-EIN-01), jeder mit genau einer Komponente.
 * Geräte (T1-10) und Daten/Papierkorb (T1-18) ersetzen ihren Platzhalter durch eine Zeile:
 * `panel: () => <DevicesSettings />` bzw. `panel: () => <DataSettings />`.
 */
const TABS: readonly SettingsTab[] = [
  { id: 'allgemein', label: 'Allgemein', panel: () => <GeneralTab /> },
  { id: 'vorlesung', label: 'Vorlesung', panel: () => <LectureSettingsForm /> },
  { id: 'stift', label: 'Stift', panel: () => <PenSettingsForm /> },
  { id: 'geraete', label: 'Geräte', panel: () => <ComingSoon title="Geräte" ticket="T1-10" /> },
  {
    id: 'daten',
    label: 'Daten und Papierkorb',
    panel: () => <ComingSoon title="Daten und Papierkorb" ticket="T1-18" />,
  },
];

/** Einstellungen (07 §3.13): links die Bereiche, rechts das Formular; auf schmalen Bildschirmen eine Reiterleiste. */
export function SettingsView() {
  const [active, setActive] = useState(TABS[0]?.id ?? '');
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const focused = (event.target as HTMLElement).id.replace('settings-tab-', '');
    const index = Math.max(
      0,
      TABS.findIndex((t) => t.id === focused),
    );
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    const tab = TABS[next];
    if (!tab) return;
    setActive(tab.id);
    refs.current[tab.id]?.focus();
  }

  const current = TABS.find((t) => t.id === active) ?? TABS[0];

  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="text-xxl font-semibold">
        Einstellungen
      </h1>
      <div
        role="tablist"
        aria-label="Bereiche der Einstellungen"
        onKeyDown={onKeyDown}
        className="mt-4 flex max-w-full gap-1 overflow-x-auto border-b border-border"
      >
        {TABS.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[tab.id] = el;
              }}
              id={`settings-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="settings-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              className={`-mb-px shrink-0 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm sg-transition ${
                selected
                  ? 'border-accent font-medium text-text'
                  : 'border-transparent text-text-muted hover:text-text'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        id="settings-panel"
        role="tabpanel"
        aria-labelledby={current ? `settings-tab-${current.id}` : undefined}
        className="min-w-0"
      >
        {current?.panel()}
      </div>
    </section>
  );
}
