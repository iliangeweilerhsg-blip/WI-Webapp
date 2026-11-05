'use client';

// Layout pro Modul (F-DSH-01, W-06): gespeichert in `module.settings` (`layout`, `column_widths`) über
// `PATCH /modules/{id}`. Der Core führt `settings` Schlüssel für Schlüssel zusammen und `null` entfernt einen Schlüssel
// (VERTRAEGE §14.2); das iPad schreibt `ink_mode` daneben, ohne dass sich beide überschreiben.
//
// Die Wahl gilt sofort (optimistisch). Scheitert das Speichern, bleibt sie für diese Ansicht erhalten, und die
// Leiste weist darauf hin; ein Neuladen zeigt dann wieder den gespeicherten Stand.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Module, ModuleUpdate } from '@sg/shared';
import { friendlyMessage } from '../../lib/api.ts';
import { useUpdateModule } from '../../lib/modules.ts';
import { useSettings } from '../../lib/settings.ts';
import { presetOf, resolveLayout, type LayoutId, type ResolvedLayout, type Widths } from './layout.ts';

export interface DashboardLayoutState extends ResolvedLayout {
  /** Vorlage wählen; setzt gezogene Breiten zurück */
  choose: (layout: LayoutId) => void;
  /** Breiten während des Ziehens (nur Anzeige) */
  preview: (widths: Widths) => void;
  /** Breiten übernehmen und speichern */
  commit: (widths: Widths) => void;
  /** Meldung, wenn das Speichern gescheitert ist */
  saveError: string | null;
}

export function useDashboardLayout(module: Module | undefined): DashboardLayoutState {
  const settings = useSettings();
  const update = useUpdateModule();
  const stored = resolveLayout(module?.settings, settings.data?.lecture.default_layout);
  const [local, setLocal] = useState<ResolvedLayout | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Wechselt das Modul, gilt wieder der gespeicherte Stand
  const moduleId = module?.id;
  useEffect(() => {
    setLocal(null);
    setSaveError(null);
  }, [moduleId]);

  // Läuft ein Speichern, überholt eine spätere Wahl die frühere: nur die neueste setzt `local` zurück
  const generation = useRef(0);

  const save = useCallback(
    (next: ResolvedLayout, patch: NonNullable<ModuleUpdate['settings']>) => {
      if (!moduleId) return;
      const mine = ++generation.current;
      setLocal(next);
      setSaveError(null);
      update.mutateAsync({ id: moduleId, patch: { settings: patch } }).then(
        () => {
          if (generation.current === mine) setLocal(null);
        },
        (cause: unknown) => {
          if (generation.current === mine) {
            setSaveError(`Layout nicht gespeichert: ${friendlyMessage(cause)}`);
          }
        },
      );
    },
    [moduleId, update.mutateAsync],
  );

  const choose = useCallback(
    (layout: LayoutId) => {
      const preset = presetOf(layout);
      save({ layout: preset.id, widths: [...preset.widths] }, { layout: preset.id, column_widths: null });
    },
    [save],
  );

  const current = local ?? stored;
  const layoutRef = useRef(current.layout);
  layoutRef.current = current.layout;

  const preview = useCallback((widths: Widths) => {
    setLocal({ layout: layoutRef.current, widths });
  }, []);

  const commit = useCallback(
    (widths: Widths) => {
      if (layoutRef.current === 'fokus') return;
      save({ layout: layoutRef.current, widths }, { column_widths: widths });
    },
    [save],
  );

  return { layout: current.layout, widths: current.widths, choose, preview, commit, saveError };
}
