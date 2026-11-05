'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ComingSoon } from './settings/ComingSoon.tsx';
import { SettingsTabContext, type TabMark } from './settings/form.tsx';
import { GeneralSettingsForm } from './settings/GeneralSettings.tsx';
import { LectureSettingsForm } from './settings/LectureSettings.tsx';
import { PenSettingsForm } from './settings/PenSettings.tsx';
import { SemesterSettings } from './SemesterSettings.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

/** Allgemeine Einstellungen (T1-19), Darstellung dieses Geräts (07 §8) und Semester aus Phase 0. */
function GeneralTab() {
  return (
    <>
      <GeneralSettingsForm />
      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-lg font-medium">Darstellung auf diesem Gerät</h2>
        <p className="mt-1 text-sm text-text-muted">
          „Wie Standard“ folgt der Standard-Darstellung oben. Hell oder Dunkel gilt nur auf diesem Gerät, bis
          du es änderst.
        </p>
        <div className="mt-3">
          <ThemeToggle />
        </div>
      </div>
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

/** Ab `md` (Tailwind, 768 px) steht die Tabliste links und senkrecht, sonst oben und waagerecht. */
function useVerticalTabs(): boolean {
  const [vertical, setVertical] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(min-width: 768px)');
    const update = () => setVertical(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return vertical;
}

/** Stellt einem Panel die Meldung an „seinen“ Reiter bereit (Speicherfehler, ungespeicherte Änderungen). */
function PanelScope({
  tabId,
  active,
  onReport,
  children,
}: {
  tabId: string;
  active: boolean;
  onReport: (tabId: string, mark: TabMark) => void;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ report: (mark: TabMark) => onReport(tabId, mark), active }),
    [tabId, active, onReport],
  );
  return <SettingsTabContext.Provider value={value}>{children}</SettingsTabContext.Provider>;
}

/**
 * Einstellungen (07 §3.13): ab `md` links die Bereiche, rechts das Formular; auf schmalen Bildschirmen eine
 * Reiterleiste. Alle Bereiche bleiben gerendert (`hidden`), damit ungespeicherte Eingaben beim Wechsel erhalten
 * bleiben.
 */
export function SettingsView() {
  const [active, setActive] = useState(TABS[0]?.id ?? '');
  const [marks, setMarks] = useState<Record<string, TabMark>>({});
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const vertical = useVerticalTabs();

  const report = useCallback((tabId: string, mark: TabMark) => {
    setMarks((current) => {
      const old = current[tabId];
      return old && old.error === mark.error && old.dirty === mark.dirty
        ? current
        : { ...current, [tabId]: mark };
    });
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const focused = (event.target as HTMLElement).id.replace('settings-tab-', '');
    const index = Math.max(
      0,
      TABS.findIndex((t) => t.id === focused),
    );
    const forward = vertical ? 'ArrowDown' : 'ArrowRight';
    const backward = vertical ? 'ArrowUp' : 'ArrowLeft';
    let next: number;
    if (event.key === forward) next = (index + 1) % TABS.length;
    else if (event.key === backward) next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    const tab = TABS[next];
    if (!tab) return;
    setActive(tab.id);
    refs.current[tab.id]?.focus();
  }

  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="text-xxl font-semibold">
        Einstellungen
      </h1>
      <div className="mt-4 md:flex md:items-start md:gap-8">
        <div
          role="tablist"
          aria-label="Bereiche der Einstellungen"
          aria-orientation={vertical ? 'vertical' : 'horizontal'}
          onKeyDown={onKeyDown}
          className="flex max-w-full gap-1 overflow-x-auto border-b border-border md:w-56 md:shrink-0 md:flex-col md:overflow-visible md:border-b-0"
        >
          {TABS.map((tab) => {
            const selected = tab.id === active;
            const mark = marks[tab.id];
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
                aria-controls={`settings-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(tab.id)}
                className={`-mb-px shrink-0 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-left text-sm sg-transition md:mb-0 md:rounded-md md:border-b-0 md:border-l-2 md:rounded-l-none ${
                  selected
                    ? 'border-accent font-medium text-text md:bg-accent-soft'
                    : 'border-transparent text-text-muted hover:text-text'
                }`}
              >
                {tab.label}
                {mark?.error || mark?.dirty ? ' ' : null}
                {mark?.error ? (
                  <>
                    <span aria-hidden="true">⚠ </span>
                    <span className="sr-only">(nicht gespeichert, Fehler)</span>
                  </>
                ) : mark?.dirty ? (
                  <>
                    <span aria-hidden="true">• </span>
                    <span className="sr-only">(ungespeicherte Änderungen)</span>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="min-w-0 md:flex-1">
          {TABS.map((tab) => (
            <div
              key={tab.id}
              id={`settings-panel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`settings-tab-${tab.id}`}
              hidden={tab.id !== active}
              className="min-w-0"
            >
              <PanelScope tabId={tab.id} active={tab.id === active} onReport={report}>
                {tab.panel()}
              </PanelScope>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
