'use client';

import { friendlyMessage, isUnreachable } from '../lib/api.ts';

/** Ruhiger Hinweis, wenn der Core nicht antwortet. Kein Absturz, kein Alarm (07 §6, R14). */
export function CoreHint({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="status" className="mb-6 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      {isUnreachable(error) ? (
        <>
          <p className="font-medium">Core nicht erreichbar</p>
          <p className="mt-1 text-text-muted">
            Sobald der Core läuft, verbindet sich die App automatisch. Starten kannst du ihn mit{' '}
            <code className="font-mono">pnpm sg start</code>.
          </p>
        </>
      ) : (
        <p>{friendlyMessage(error)}</p>
      )}
    </div>
  );
}
