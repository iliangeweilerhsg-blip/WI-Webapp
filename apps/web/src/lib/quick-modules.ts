'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Module } from '@sg/shared';
import { friendlyMessage } from './api.ts';
import { useCreateModule } from './modules.ts';
import { uuidv7 } from './uuid.ts';

export interface QuickModule {
  /** Client-ID, geht als `id` an den Core */
  id: string;
  name: string;
  status: 'pending' | 'done';
  module?: Module;
}

/** Ein Modul, das nicht angelegt werden konnte (z. B. offline). Der Name geht nie verloren. */
export interface FailedModule {
  id: string;
  semesterId: string;
  name: string;
}

// Gescheiterte Namen leben außerhalb der Komponenten: Wird das Eingabefeld geschlossen, während die
// Warteschlange noch läuft, bleiben alle Namen trotzdem erhalten und die Seitenleiste zeigt sie an.
let failed: readonly FailedModule[] = [];
const listeners = new Set<() => void>();

function setFailed(next: readonly FailedModule[]): void {
  failed = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Alle gescheiterten Module eines Semesters in der Reihenfolge, in der sie eingegeben wurden. */
export function useFailedModules(semesterId: string | null): readonly FailedModule[] {
  const all = useSyncExternalStore(
    subscribe,
    () => failed,
    () => failed,
  );
  return useMemo(() => all.filter((f) => f.semesterId === semesterId), [all, semesterId]);
}

export function dismissFailedModules(semesterId: string): void {
  setFailed(failed.filter((f) => f.semesterId !== semesterId));
}

/** Nur für Tests. */
export function resetFailedModules(): void {
  setFailed([]);
}

interface Options {
  /** Semester, in dem angelegt wird; ohne Semester passiert nichts */
  semesterId: string | null;
  /** Fertige Einträge in der Liste behalten (Einrichtungsdialog) oder entfernen (Seitenleiste) */
  keepDone: boolean;
}

/**
 * Schnelles Anlegen von Modulen (Einrichtungsdialog und Seitenleiste). Das Eingabefeld leert der Aufrufer
 * sofort. Jeder Name bekommt eine Client-ID und läuft in eine Warteschlange: Die Anfragen gehen nacheinander
 * raus, damit Reihenfolge und automatische Farbe stimmen, und blockieren das Tippen nicht.
 * Scheitert ein Name, landet er in der Liste der gescheiterten (`useFailedModules`), auch nach Unmount.
 */
export function useQuickModules({ semesterId, keepDone }: Options) {
  const create = useCreateModule();
  const [entries, setEntries] = useState<QuickModule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const enqueue = useCallback(
    (name: string, id: string, semester: string) => {
      setError(null);
      setEntries((list) => [...list, { id, name, status: 'pending' }]);
      chain.current = chain.current.then(async () => {
        try {
          const module = await create.mutateAsync({ id, semester_id: semester, name });
          if (!mounted.current) return;
          setEntries((list) =>
            keepDone
              ? list.map((e) => (e.id === id ? { ...e, status: 'done', module } : e))
              : list.filter((e) => e.id !== id),
          );
        } catch (failure) {
          // Ergebnis nie verwerfen, auch wenn das Feld inzwischen geschlossen ist
          setFailed([...failed.filter((f) => f.id !== id), { id, semesterId: semester, name }]);
          if (!mounted.current) return;
          setEntries((list) => list.filter((e) => e.id !== id));
          setError(friendlyMessage(failure));
        }
      });
    },
    [create, keepDone],
  );

  const add = useCallback(
    (rawName: string) => {
      const name = rawName.trim();
      if (!name || !semesterId) return;
      enqueue(name, uuidv7(), semesterId);
    },
    [enqueue, semesterId],
  );

  /** Alle gescheiterten Namen dieses Semesters noch einmal versuchen (gleiche IDs, gleiche Reihenfolge). */
  const retryFailed = useCallback(() => {
    if (!semesterId) return;
    const again = failed.filter((f) => f.semesterId === semesterId);
    if (again.length === 0) return;
    setFailed(failed.filter((f) => f.semesterId !== semesterId));
    for (const f of again) enqueue(f.name, f.id, semesterId);
  }, [enqueue, semesterId]);

  const clearError = useCallback(() => setError(null), []);
  return { entries, add, error, clearError, retryFailed };
}
