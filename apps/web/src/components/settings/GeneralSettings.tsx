'use client';

import type { Appearance, Lang } from '@sg/shared';
import { useTheme, type ThemeChoice } from '../../lib/theme.tsx';
import { AreaForm, SelectField, TextReadOnlyField, useAreaForm } from './form.tsx';

const LANGS: readonly { value: Lang; label: string }[] = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'Englisch' },
  { value: 'mixed', label: 'Gemischt (Deutsch und Englisch)' },
];

const APPEARANCES: readonly { value: Appearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'hell', label: 'Hell' },
  { value: 'dunkel', label: 'Dunkel' },
];

const THEME_OF: Record<Appearance, ThemeChoice> = { system: 'system', hell: 'light', dunkel: 'dark' };

/** Einstellungen → Allgemein (F-EIN-01): Inhaltssprache, Standard-Darstellung, Datenordner (nur lesbar). */
export function GeneralSettingsForm() {
  const { setChoice } = useTheme();
  const form = useAreaForm('general', 'Allgemeine Einstellungen gespeichert', (saved) =>
    setChoice(THEME_OF[saved.general.appearance]),
  );
  const v = form.values;
  return (
    <AreaForm title="Allgemein" intro="Sprache der Inhalte, Darstellung und Ort deiner Daten." form={form}>
      {v ? (
        <>
          <SelectField
            label="Sprache der Inhalte"
            hint="Gilt für neue Module, Zusammenfassungen und Lernmaterial."
            value={v.content_lang}
            options={LANGS}
            onChange={(x) => form.set('content_lang', x)}
          />
          <SelectField
            label="Standard-Darstellung"
            hint="Gilt auch für das iPad. Beim Speichern übernimmt dieses Gerät sie ebenfalls."
            value={v.appearance}
            options={APPEARANCES}
            onChange={(x) => form.set('appearance', x)}
          />
          <TextReadOnlyField
            label="Datenordner"
            hint="Nur lesbar. Ändern geht über SG_DATA_DIR in der Umgebung und einen Neustart."
            value={v.data_dir}
          />
        </>
      ) : null}
    </AreaForm>
  );
}
