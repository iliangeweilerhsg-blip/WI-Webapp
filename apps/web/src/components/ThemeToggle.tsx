'use client';

import { THEME_LABELS, useTheme, type ThemeChoice } from '../lib/theme.tsx';

const ORDER: ThemeChoice[] = ['system', 'light', 'dark'];

/** Umschalter Darstellung: System, Hell, Dunkel (07 §8). */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { choice, setChoice } = useTheme();

  if (compact) {
    const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]!;
    return (
      <button
        type="button"
        onClick={() => setChoice(next)}
        aria-label={`Darstellung: ${THEME_LABELS[choice]}. Wechseln zu ${THEME_LABELS[next]}`}
        title={`Darstellung: ${THEME_LABELS[choice]}`}
        className="sg-nav-link w-full"
      >
        <span aria-hidden="true">◐</span>
      </button>
    );
  }

  return (
    <div role="radiogroup" aria-label="Darstellung" className="inline-flex gap-1 rounded-md bg-surface p-1">
      {ORDER.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={choice === c}
          onClick={() => setChoice(c)}
          className={`rounded-sm px-3 py-1 text-sm sg-transition ${
            choice === c ? 'bg-accent text-accent-contrast' : 'text-text-muted hover:text-text'
          }`}
        >
          {THEME_LABELS[c]}
        </button>
      ))}
    </div>
  );
}
