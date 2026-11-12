'use client';

// Erste Schritte (UX-14): fünf Punkte nach der Einrichtung von Semester und Modulen. Jeder Punkt hakt sich aus einer
// vorhandenen Abfrage selbst ab. Nur der Mikrofon-Test lässt sich nicht ablesen: den hakt man selbst ab (nur in diesem
// Browser). Die Liste verschwindet, wenn alles erledigt ist oder wenn man sie ausblendet, und erscheint nie während
// einer Session. Solange eine Abfrage nicht geantwortet hat, bleibt sie ganz weg (kein Flackern, kein falsches „offen“).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useBackups } from '../../lib/data.ts';
import { useCalendarSources } from '../../lib/calendar.ts';
import { useDevices } from '../../lib/devices.ts';
import { useMoodleStatus } from '../../lib/moodle.ts';
import { useActiveSession } from '../../lib/sessions.ts';

export const FIRST_STEPS_HIDDEN_KEY = 'sg.ersteSchritte.ausgeblendet';
export const FIRST_STEPS_MIC_KEY = 'sg.ersteSchritte.mikrofon';

export interface FirstStepsState {
  hasCalendar: boolean;
  moodleSetUp: boolean;
  micChecked: boolean;
  hasBackupTarget: boolean;
  hasIpad: boolean;
}

export interface FirstStep {
  id: 'kalender' | 'moodle' | 'mikrofon' | 'backup' | 'ipad';
  label: string;
  hint: string;
  href: string;
  linkLabel: string;
  done: boolean;
}

/** Die fünf Punkte in fester Reihenfolge */
export function firstSteps(state: FirstStepsState): FirstStep[] {
  return [
    {
      id: 'kalender',
      label: 'Stundenplan eintragen',
      hint: 'Mit dem Stundenplan weiß „Heute“, welche Vorlesung als Nächstes kommt.',
      href: '/kalender',
      linkLabel: 'Zum Kalender',
      done: state.hasCalendar,
    },
    {
      id: 'moodle',
      label: 'Moodle verbinden',
      hint: 'Fristen und Material kommen dann von selbst.',
      href: '/einstellungen?bereich=moodle',
      linkLabel: 'Zu Moodle',
      done: state.moodleSetUp,
    },
    {
      id: 'mikrofon',
      label: 'Mikrofon testen',
      hint: 'Prüfe das Mikrofon vor der ersten echten Aufnahme.',
      href: '/einstellungen?bereich=vorlesung',
      linkLabel: 'Zu Vorlesung',
      done: state.micChecked,
    },
    {
      id: 'backup',
      label: 'Backup-Ziel wählen',
      hint: 'Ohne Ziel gibt es kein Backup.',
      href: '/einstellungen?bereich=daten',
      linkLabel: 'Zu Daten',
      done: state.hasBackupTarget,
    },
    {
      id: 'ipad',
      label: 'iPad koppeln',
      hint: 'Für die Handschrift in der Vorlesung.',
      href: '/einstellungen?bereich=geraete',
      linkLabel: 'Zu Geräte',
      done: state.hasIpad,
    },
  ];
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    /* ohne Speicher gilt die Wahl nur bis zum Neuladen */
  }
}

const textLink = 'whitespace-nowrap text-text-muted underline underline-offset-2 hover:text-text';

export function FirstStepsCard() {
  const active = useActiveSession();
  const calendar = useCalendarSources();
  const moodle = useMoodleStatus();
  const backups = useBackups();
  const devices = useDevices();
  const [hidden, setHidden] = useState(true);
  const [micChecked, setMicChecked] = useState(false);

  // localStorage gibt es erst im Browser; bis dahin bleibt die Liste weg
  useEffect(() => {
    setHidden(readFlag(FIRST_STEPS_HIDDEN_KEY));
    setMicChecked(readFlag(FIRST_STEPS_MIC_KEY));
  }, []);

  if (hidden) return null;
  if (active.data !== null) return null; // läuft eine Session, oder der Stand ist noch unbekannt
  if (!calendar.data || !moodle.data || !backups.data || !devices.data) return null;

  const steps = firstSteps({
    hasCalendar: calendar.data.length > 0,
    moodleSetUp: moodle.data.state !== 'nicht_eingerichtet',
    micChecked,
    hasBackupTarget: backups.data.status.target !== null,
    hasIpad: devices.data.some((d) => d.kind === 'ipad' && d.deleted_at === null),
  });
  if (steps.every((s) => s.done)) return null;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section
      aria-labelledby="erste-schritte"
      className="rounded-lg border border-border bg-surface px-4 py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="erste-schritte" className="text-lg font-semibold">
          Erste Schritte
        </h2>
        <p className="text-sm text-text-muted">{`${doneCount} von ${steps.length} erledigt`}</p>
      </div>
      <ul className="mt-3 space-y-3">
        {steps.map((step) => (
          <li key={step.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span aria-hidden="true" className="w-5 shrink-0 text-md">
              {step.done ? '✓' : '○'}
            </span>
            <span className="min-w-0 flex-1 basis-56">
              <span className={step.done ? 'text-md text-text-muted line-through' : 'text-md'}>
                {step.label}
              </span>
              <span className="sr-only">{step.done ? ' (erledigt)' : ' (offen)'}</span>
              {step.done ? null : <span className="block text-sm text-text-muted">{step.hint}</span>}
            </span>
            {step.done ? null : (
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <Link href={step.href} className={textLink}>
                  {step.linkLabel}
                </Link>
                {step.id === 'mikrofon' ? (
                  <button
                    type="button"
                    className={`${textLink} min-h-11`}
                    onClick={() => {
                      writeFlag(FIRST_STEPS_MIC_KEY);
                      setMicChecked(true);
                    }}
                  >
                    Habe ich getestet
                  </button>
                ) : null}
              </span>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={`${textLink} mt-3 min-h-11 text-sm`}
        onClick={() => {
          writeFlag(FIRST_STEPS_HIDDEN_KEY);
          setHidden(true);
        }}
      >
        Ausblenden
      </button>
    </section>
  );
}
