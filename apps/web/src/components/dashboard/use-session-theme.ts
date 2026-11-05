'use client';

// In der Session ist die Darstellung standardmäßig dunkel (07-UX §3.3). „Standardmäßig“ heißt: Eine eigene Wahl auf
// diesem Gerät (Hell/Dunkel) und die Standard-Darstellung „hell“ aus den Einstellungen gehen vor. Beim Verlassen der
// Session gilt wieder, was ohne Dashboard gälte. Gespeichert wird nichts; das Init-Skript (`lib/theme-init.ts`) setzt
// dasselbe schon vor dem ersten Paint.
import { useEffect } from 'react';
import type { Appearance } from '@sg/shared';
import { useSettings } from '../../lib/settings.ts';
import { DEFAULT_KEY } from '../../lib/theme-init.ts';
import { useTheme, type ThemeChoice } from '../../lib/theme.tsx';

/** Was ohne Dashboard gälte: die eigene Wahl, sonst die Standard-Darstellung, sonst das System */
export function baseTheme(choice: ThemeChoice, appearance: Appearance | undefined): ThemeChoice {
  if (choice !== 'system') return choice;
  return appearance === 'hell' ? 'light' : appearance === 'dunkel' ? 'dark' : 'system';
}

/** Was in der Session gilt: dunkel, außer die Wahl bzw. der Standard sagt ausdrücklich „hell“ */
export function sessionTheme(choice: ThemeChoice, appearance: Appearance | undefined): 'light' | 'dark' {
  return baseTheme(choice, appearance) === 'light' ? 'light' : 'dark';
}

/** Bis die Einstellungen geladen sind, gilt der zuletzt bekannte Standard (wie im Init-Skript) */
function storedAppearance(): Appearance | undefined {
  try {
    const v = window.localStorage.getItem(DEFAULT_KEY);
    return v === 'light' ? 'hell' : v === 'dark' ? 'dunkel' : undefined;
  } catch {
    return undefined;
  }
}

function apply(theme: ThemeChoice) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function useSessionTheme(): void {
  const { choice } = useTheme();
  const loaded = useSettings().data?.general.appearance;
  useEffect(() => {
    const appearance = loaded ?? storedAppearance();
    // ThemeProvider und AppearanceDefault sitzen weiter oben und setzen ihr Attribut in ihren Effekten NACH diesem
    // (Kinder zuerst). Darum erst nach allen Effekten dieses Durchlaufs anwenden.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) apply(sessionTheme(choice, appearance));
    });
    return () => {
      cancelled = true;
      apply(baseTheme(choice, appearance));
    };
  }, [choice, loaded]);
}
