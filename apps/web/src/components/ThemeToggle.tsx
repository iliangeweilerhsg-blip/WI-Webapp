'use client';

import { THEME_LABELS, useTheme, type ThemeChoice } from '../lib/theme.tsx';

const ORDER: ThemeChoice[] = ['system', 'light', 'dark'];

/** Umschalter Darstellung: System, Hell, Dunkel (07 §8). Nur in den Einstellungen. */
export function ThemeToggle() {
  const { choice, setChoice } = useTheme();

  return (
    <div
      role="group"
      aria-label="Darstellung"
      className="inline-flex gap-1 rounded-md border border-border p-1"
    >
      {ORDER.map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={choice === c}
          onClick={() => setChoice(c)}
          className={`rounded-sm px-3 py-1 text-sm sg-transition ${
            choice === c ? 'bg-accent-soft font-medium text-text' : 'text-text-muted hover:text-text'
          }`}
        >
          {THEME_LABELS[c]}
        </button>
      ))}
    </div>
  );
}
