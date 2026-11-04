'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { CoreHint } from '../../components/CoreHint.tsx';
import { EmptyState } from '../../components/Placeholder.tsx';
import { moduleColorVar, useModules } from '../../lib/modules.ts';

function ModuleView() {
  const id = useSearchParams().get('id');
  const modules = useModules();
  const module = id ? modules.data?.find((m) => m.id === id) : undefined;

  if (!id) {
    return <EmptyState>Wähle links ein Modul aus.</EmptyState>;
  }
  if (modules.isError) return <CoreHint error={modules.error} />;
  if (modules.isPending) return <p className="text-sm text-text-muted">Lädt …</p>;
  if (!module)
    return <EmptyState>Dieses Modul gibt es nicht (mehr). Wähle links ein anderes aus.</EmptyState>;

  return (
    <>
      <h1 id="screen-title" className="flex items-center gap-3 text-xxl font-semibold">
        <span
          aria-hidden="true"
          className="size-4 shrink-0 rounded-full"
          style={{ backgroundColor: moduleColorVar(module.color) }}
        />
        {module.name}
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        {[module.exam_type, module.ects != null ? `${module.ects} ECTS` : null, module.lecturer]
          .filter(Boolean)
          .join(' · ') || 'Noch keine Angaben'}
      </p>
      <div className="mt-6">
        <EmptyState>
          <span className="block text-text">Kommt in Phase 1</span>
          <span className="mt-1 block">Vorlesungen, Übungen, Konzepte und Altklausuren erscheinen hier.</span>
        </EmptyState>
      </div>
    </>
  );
}

/** Modul-Übersicht (07 §3.2) – Route mit Query-Parameter `?id=` (VERTRAEGE §5). */
export default function ModulPage() {
  return (
    <section aria-labelledby="screen-title">
      <Suspense fallback={null}>
        <ModuleView />
      </Suspense>
    </section>
  );
}
