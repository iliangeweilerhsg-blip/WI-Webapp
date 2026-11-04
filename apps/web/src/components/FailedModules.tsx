'use client';

import { dismissFailedModules, useFailedModules } from '../lib/quick-modules.ts';

/**
 * Module, die nicht angelegt werden konnten (z. B. offline): alle Namen bleiben sichtbar, ein Knopf versucht
 * sie erneut, ein zweiter verwirft sie. Nichts geht verloren, auch wenn das Eingabefeld längst geschlossen ist.
 */
export function FailedModules({
  semesterId,
  message,
  onRetry,
  className = '',
}: {
  semesterId: string;
  /** Warum es scheiterte (freundlicher Text) */
  message?: string | null;
  onRetry: () => void;
  className?: string;
}) {
  const failed = useFailedModules(semesterId);
  if (failed.length === 0) return null;
  return (
    <div className={className}>
      {message ? (
        <p role="alert" className="pb-1">
          {message}
        </p>
      ) : null}
      <ul aria-label="Nicht angelegt" className="flex flex-col gap-0.5">
        {failed.map((f) => (
          <li key={f.id} className="truncate text-sm">
            {f.name}
          </li>
        ))}
      </ul>
      <div className="mt-1 flex gap-3">
        <button type="button" onClick={onRetry} className="font-medium text-accent hover:underline">
          Erneut versuchen
        </button>
        <button
          type="button"
          onClick={() => dismissFailedModules(semesterId)}
          className="text-text-muted hover:underline"
        >
          Verwerfen
        </button>
      </div>
    </div>
  );
}
