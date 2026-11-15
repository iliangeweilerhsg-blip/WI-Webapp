'use client';

import { useQueryClient } from '@tanstack/react-query';
import { REVIEW_KEY } from '../../lib/cards.ts';
import { AreaForm, NumberField, useAreaForm } from './form.tsx';

/**
 * Einstellungen → Lernen (VERTRAEGE §21.9/§21.10): Zeitbudget für „Heute wiederholen“ und neue Karten je Tag.
 * Nach dem Speichern wird die Warteschlange (`GET /review/queue`) als veraltet markiert, damit Heute und
 * `/lernen` beim nächsten Laden die neuen Werte nutzen.
 */
export function LearningSettingsForm() {
  const client = useQueryClient();
  const form = useAreaForm('learning', 'Lern-Einstellungen gespeichert', () => {
    void client.invalidateQueries({ queryKey: REVIEW_KEY });
  });
  return (
    <AreaForm
      title="Lernen"
      intro="Wie viel Zeit und wie viele neue Karten „Heute wiederholen“ pro Tag vorsieht."
      form={form}
    >
      {form.values ? (
        <>
          <NumberField
            label="Zeitbudget für Heute wiederholen"
            unit="Minuten"
            hint="Zwischen 5 und 120. Was nicht in den Block passt, bleibt fällig und kommt morgen dran."
            field={form.numberField('review_budget_minutes', 5, 120)}
          />
          <NumberField
            label="Neue Karten pro Tag"
            unit="Karten"
            hint="Zwischen 0 und 100. 0 pausiert neue Karten, Wiederholungen laufen weiter."
            field={form.numberField('new_cards_per_day', 0, 100)}
          />
        </>
      ) : null}
    </AreaForm>
  );
}
