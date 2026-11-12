'use client';

import { useEffect, useState } from 'react';
import type { DashboardLayout, InkMode, ToolbarSide } from '@sg/shared';
import { MicTest } from './MicTest.tsx';
import { AreaForm, NumberField, SelectField, useAreaForm } from './form.tsx';

const LAYOUTS: readonly { value: DashboardLayout; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'folie_gross', label: 'Folie groß' },
  { value: 'notizen_gross', label: 'Notizen groß' },
  { value: 'fokus', label: 'Fokus' },
];

const INK_MODES: readonly { value: InkMode; label: string }[] = [
  { value: 'freie_seite', label: 'Freie Seite' },
  { value: 'auf_folie', label: 'Auf der Folie' },
];

const SIDES: readonly { value: ToolbarSide; label: string }[] = [
  { value: 'rechts', label: 'Rechts' },
  { value: 'links', label: 'Links' },
];

/** Wert der Auswahl „Standardmikrofon“ (gespeichert wird dafür `null`) */
const DEFAULT_MIC = '';

/** Mikrofone des Browsers (ohne Berechtigung ohne Namen). Fehlt die API, bleibt nur das Standardmikrofon. */
function useMicrophones(): { id: string; label: string }[] {
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    let alive = true;
    media
      .enumerateDevices()
      .then((all) => {
        if (!alive) return;
        setDevices(
          all
            .filter((d) => d.kind === 'audioinput' && d.deviceId !== '' && d.deviceId !== 'default')
            .map((d, i) => ({ id: d.deviceId, label: d.label || `Mikrofon ${i + 1}` })),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return devices;
}

/** Einstellungen → Vorlesung (F-EIN-01, F-SES-03): Mikrofon, Auto-Stopp, Layout, Schreibmodus, Werkzeugleiste. */
export function LectureSettingsForm() {
  const form = useAreaForm('lecture', 'Vorlesungs-Einstellungen gespeichert');
  const mics = useMicrophones();
  const v = form.values;
  const savedMic = v?.microphone_id ?? null;
  const micOptions = [
    { value: DEFAULT_MIC, label: 'Standardmikrofon' },
    ...mics.map((m) => ({ value: m.id, label: m.label })),
    ...(savedMic !== null && !mics.some((m) => m.id === savedMic)
      ? [{ value: savedMic, label: 'Gespeichertes Mikrofon (derzeit nicht gefunden)' }]
      : []),
  ];
  return (
    <AreaForm
      title="Vorlesung"
      intro="Aufnahme, automatisches Beenden und Voreinstellungen für das Live-Dashboard und das iPad."
      form={form}
    >
      {v ? (
        <>
          <SelectField
            label="Mikrofon"
            hint="Die Namen erscheinen, sobald der Browser Zugriff aufs Mikrofon hatte."
            value={savedMic ?? DEFAULT_MIC}
            options={micOptions}
            onChange={(x) => form.set('microphone_id', x === DEFAULT_MIC ? null : x)}
          />
          <MicTest microphoneId={savedMic} />
          <div className="sm:col-span-2">
            <h3 className="text-sm font-semibold">Automatisch beenden</h3>
            <p className="mt-1 text-xs text-text-muted">
              Die Aufnahme stoppt von selbst, sobald eine dieser Regeln greift.
            </p>
          </div>
          <NumberField
            label="Nach Kalenderende"
            unit="Minuten"
            hint="Stopp, wenn das Ende im Kalender so lange vorbei ist und niemand mehr spricht."
            field={form.numberField('auto_stop_after_end_min', 1)}
          />
          <NumberField
            label="Ruhe ohne Sprache"
            unit="Minuten"
            hint="So lange darf nach dem Kalenderende keine Sprache zu hören sein."
            field={form.numberField('auto_stop_quiet_window_min', 1)}
          />
          <NumberField
            label="Spätestens nach Kalenderende"
            unit="Minuten"
            hint="Stopp auf jeden Fall, auch wenn noch gesprochen wird."
            field={form.numberField('auto_stop_hard_after_end_min', 1)}
          />
          <NumberField
            label="Stille"
            unit="Minuten"
            hint="Stopp nach so langer Stille, außerhalb der Pause."
            field={form.numberField('auto_stop_silence_min', 1)}
          />
          <NumberField
            label="Höchstdauer"
            unit="Minuten"
            hint="Eine Aufnahme endet spätestens nach dieser Zeit."
            field={form.numberField('auto_stop_max_duration_min', 1)}
          />
          <NumberField
            label="Hinweis vor dem Stopp"
            unit="Sekunden"
            hint="So lange vorher erscheint „weiter aufnehmen?“. 0 stoppt ohne Hinweis."
            field={form.numberField('auto_stop_warning_s', 0)}
          />
          <NumberField
            label="Verlängerung per Tipp"
            unit="Minuten"
            hint="Um so viel verschiebt „weiter aufnehmen“ den Stopp."
            field={form.numberField('auto_stop_extend_min', 1)}
          />
          <div className="sm:col-span-2">
            <h3 className="text-sm font-semibold">Voreinstellungen</h3>
          </div>
          <SelectField
            label="Layout des Dashboards"
            hint="Gilt für Module, die kein eigenes Layout haben."
            value={v.default_layout}
            options={LAYOUTS}
            onChange={(x) => form.set('default_layout', x)}
          />
          <SelectField
            label="Schreibmodus"
            hint="Gilt für Module ohne eigenen Schreibmodus."
            value={v.default_ink_mode}
            options={INK_MODES}
            onChange={(x) => form.set('default_ink_mode', x)}
          />
          <SelectField
            label="Werkzeugleiste auf dem iPad"
            hint="Für Rechtshänder rechts, für Linkshänder links."
            value={v.toolbar_side}
            options={SIDES}
            onChange={(x) => form.set('toolbar_side', x)}
          />
        </>
      ) : null}
    </AreaForm>
  );
}
