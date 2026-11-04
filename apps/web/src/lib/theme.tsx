'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'sg-theme';

export const SIDEBAR_KEY = 'sg-sidebar-collapsed';

/**
 * Wird im <head> vor dem ersten Rendern ausgeführt: Theme und eingeklappte Seitenleiste landen als
 * Attribute auf <html>, damit nichts blitzt oder springt. Das Seitenleisten-Aussehen steuert CSS.
 */
export const THEME_INIT_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem('${STORAGE_KEY}');if(t==='light'||t==='dark')d.setAttribute('data-theme',t);if(localStorage.getItem('${SIDEBAR_KEY}')==='1')d.setAttribute('data-sidebar','collapsed')}catch(e){}`;

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

export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'System',
  light: 'Hell',
  dark: 'Dunkel',
};
