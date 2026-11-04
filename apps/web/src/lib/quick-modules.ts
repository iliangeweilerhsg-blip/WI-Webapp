'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

interface Options {
  /** Semester, in dem angelegt wird; ohne Semester passiert nichts */
  semesterId: string | null;
  /** Fertige Einträge in der Liste behalten (Einrichtungsdialog) oder entfernen (Seitenleiste) */
  keepDone: boolean;
  /** Nur bei Fehler: Der Text kommt zurück, damit nichts verloren geht */
  onRestore: (name: string) => void;
}

/**
 * Schnelles Anlegen von Modulen (Einrichtungsdialog und Seitenleiste). Das Eingabefeld leert der Aufrufer
 * sofort. Jeder Name bekommt eine Client-ID und läuft in eine Warteschlange: Die Anfragen gehen nacheinander
 * raus, damit Reihenfolge und automatische Farbe stimmen, und blockieren das Tippen nicht.
 */
export function useQuickModules({ semesterId, keepDone, onRestore }: Options) {
  const create = useCreateModule();
  const [entries, setEntries] = useState<QuickModule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const restore = useRef(onRestore);
  restore.current = onRestore;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const add = useCallback(
    (rawName: string) => {
      const name = rawName.trim();
      if (!name || !semesterId) return;
      const id = uuidv7();
      setError(null);
      setEntries((list) => [...list, { id, name, status: 'pending' }]);
      chain.current = chain.current.then(async () => {
        try {
          const module = await create.mutateAsync({ id, semester_id: semesterId, name });
          if (!mounted.current) return;
          setEntries((list) =>
            keepDone
              ? list.map((e) => (e.id === id ? { ...e, status: 'done', module } : e))
              : list.filter((e) => e.id !== id),
          );
        } catch (failure) {
          if (!mounted.current) return;
          setEntries((list) => list.filter((e) => e.id !== id));
          setError(friendlyMessage(failure));
          restore.current(name);
        }
      });
    },
    [create, keepDone, semesterId],
  );

  const clearError = useCallback(() => setError(null), []);
  return { entries, add, error, clearError };
}
