'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Appearance } from '@sg/shared';
import { useSettings } from './settings.ts';
import { DEFAULT_KEY, SIDEBAR_KEY, STORAGE_KEY } from './theme-init.ts';

export type ThemeChoice = 'system' | 'light' | 'dark';

export { SIDEBAR_KEY };

function readStored(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
}

interface ThemeContextValue {
  choice: ThemeChoice;
  setChoice: (c: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue>({ choice: 'system', setChoice: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>('system');

  useEffect(() => {
    const stored = readStored();
    setChoiceState(stored);
    apply(stored);
  }, []);

  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c);
    apply(c);
    try {
      if (c === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, c);
    } catch {
      // Speicher nicht verfügbar – Auswahl gilt nur für diese Sitzung
    }
  }, []);

  const value = useMemo(() => ({ choice, setChoice }), [choice, setChoice]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

const APPEARANCE_THEME: Record<Appearance, ThemeChoice> = { system: 'system', hell: 'light', dunkel: 'dark' };

/**
 * Wendet `general.appearance` (Standard-Darstellung, VERTRAEGE §14.1) an, solange auf diesem Gerät keine eigene
 * Wahl gilt („Wie Standard“). Sie wartet nie auf den Core: bis die Einstellungen geladen sind, gilt das System.
 */
export function AppearanceDefault() {
  const { choice } = useTheme();
  const appearance = useSettings().data?.general.appearance;
  useEffect(() => {
    if (choice !== 'system' || appearance === undefined) return;
    const theme = APPEARANCE_THEME[appearance];
    apply(theme);
    try {
      if (theme === 'system') window.localStorage.removeItem(DEFAULT_KEY);
      else window.localStorage.setItem(DEFAULT_KEY, theme);
    } catch {
      // Speicher nicht verfügbar – dann gilt der Standard erst nach dem Laden
    }
  }, [choice, appearance]);
  return null;
}

export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'Wie Standard',
  light: 'Hell',
  dark: 'Dunkel',
};
