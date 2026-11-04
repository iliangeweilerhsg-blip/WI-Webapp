'use client';

import type { HexColor, PencilDoubleTapAction, PencilSqueezeAction } from '@sg/shared';
import { AreaForm, CheckboxField, SelectField, useAreaForm } from './form.tsx';

const DOUBLE_TAP: readonly { value: PencilDoubleTapAction; label: string }[] = [
  { value: 'radierer', label: 'Radierer' },
  { value: 'letztes_werkzeug', label: 'Letztes Werkzeug' },
  { value: 'farbpalette', label: 'Farbpalette' },
  { value: 'system', label: 'Wie in iPadOS eingestellt' },
  { value: 'aus', label: 'Aus' },
];

const SQUEEZE: readonly { value: PencilSqueezeAction; label: string }[] = [
  { value: 'werkzeugpalette', label: 'Werkzeugpalette' },
  { value: 'radierer', label: 'Radierer' },
  { value: 'system', label: 'Wie in iPadOS eingestellt' },
  { value: 'aus', label: 'Aus' },
];

const MAX_COLORS = 8;
const NEW_COLOR = '#1864ABFF' as HexColor;

/** `#RRGGBBAA` → `#rrggbb` für das Farbfeld; die Deckkraft bleibt beim Ändern erhalten. */
const rgbOf = (hex: HexColor) => hex.slice(0, 7).toLowerCase();
const alphaOf = (hex: HexColor) => hex.slice(7, 9);

/** Einstellungen → Stift (F-EIN-01, F-INK-09): Apple-Pencil-Gesten, Formerkennung, Lieblingsfarben. */
export function PenSettingsForm() {
  const form = useAreaForm('pen', 'Stift-Einstellungen gespeichert');
  const v = form.values;
  const colors = v?.favorite_colors ?? [];
  const setColor = (index: number, rgb: string) =>
    form.set(
      'favorite_colors',
      colors.map((c, i) => (i === index ? (`${rgb.toUpperCase()}${alphaOf(c)}` as HexColor) : c)),
    );
  return (
    <AreaForm
      title="Stift"
      intro="Gesten des Apple Pencil und die Farben in deiner Werkzeugleiste auf dem iPad."
      form={form}
    >
      {v ? (
        <>
          <SelectField
            label="Doppeltippen"
            hint="Was passiert, wenn du zweimal auf die Pencil-Spitze tippst."
            value={v.double_tap}
            options={DOUBLE_TAP}
            onChange={(x) => form.set('double_tap', x)}
          />
          <SelectField
            label="Drücken (Pencil Pro)"
            hint="Was passiert, wenn du den Pencil zusammendrückst."
            value={v.squeeze}
            options={SQUEEZE}
            onChange={(x) => form.set('squeeze', x)}
          />
          <CheckboxField
            label="Formen erkennen"
            hint="Gezeichnete Linien und Kreise werden begradigt. Kommt erst in einer späteren Phase."
            checked={v.shape_recognition}
            onChange={(x) => form.set('shape_recognition', x)}
          />
          <fieldset className="min-w-0 sm:col-span-2">
            <legend className="text-sm font-medium">Lieblingsfarben</legend>
            <p id="pen-colors-hint" className="mt-1 text-xs text-text-muted">
              Bis zu {MAX_COLORS} Farben, die du auf dem iPad mit einem Tipp erreichst.
            </p>
            <ul className="mt-2 flex flex-wrap gap-3" aria-describedby="pen-colors-hint">
              {colors.map((color, index) => (
                <li key={index} className="flex items-center gap-1 rounded-md border border-border p-1">
                  <input
                    type="color"
                    aria-label={`Farbe ${index + 1}`}
                    value={rgbOf(color)}
                    onChange={(e) => setColor(index, e.target.value)}
                    className="size-8 cursor-pointer rounded-sm border border-border bg-bg p-0"
                  />
                  <button
                    type="button"
                    aria-label={`Farbe ${index + 1} entfernen`}
                    onClick={() =>
                      form.set(
                        'favorite_colors',
                        colors.filter((_, i) => i !== index),
                      )
                    }
                    className="rounded-sm px-2 py-1 text-sm text-text-muted hover:bg-surface hover:text-text"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={colors.length >= MAX_COLORS}
              onClick={() => form.set('favorite_colors', [...colors, NEW_COLOR])}
              className="mt-3 rounded-md border border-border px-3 py-1 text-sm hover:bg-surface disabled:opacity-50"
            >
              Farbe hinzufügen
            </button>
          </fieldset>
        </>
      ) : null}
    </AreaForm>
  );
}
