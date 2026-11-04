import type { ReactNode } from 'react';

/** Leerer Zustand: ein Satz und höchstens eine Aktion (07 §5 R16, §6). */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong px-6 py-8 text-center">
      <p className="text-md text-text-muted">{children}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Ruhiger Platzhalter für Bildschirme, die erst in einer späteren Phase kommen. Kein Schuld-UI (R11, R13). */
export function PlaceholderScreen({
  title,
  phase,
  children,
}: {
  title: string;
  phase: number;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="text-xxl font-semibold">
        {title}
      </h1>
      <div className="mt-6">
        <EmptyState>
          <span className="block text-text">Kommt in Phase {phase}</span>
          {children ? <span className="mt-1 block">{children}</span> : null}
        </EmptyState>
      </div>
    </section>
  );
}
