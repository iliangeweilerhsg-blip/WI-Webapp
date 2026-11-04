'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { CoreHint } from './CoreHint.tsx';
import { EmptyState } from './Placeholder.tsx';
import { moduleColorVar, useModules } from '../lib/modules.ts';

function ModuleView() {
  const id = useSearchParams().get('id');
  const modules = useModules();
  const module = id ? modules.data?.find((m) => m.id === id) : undefined;

  if (!id) {
    return (
      <>
        <h1 id="screen-title" className="text-xxl font-semibold">
          Modul
        </h1>
        <div className="mt-6">
          <EmptyState>Wähle links ein Modul aus.</EmptyState>
        </div>
      </>
    );
  }
  if (modules.isError) {
    return (
      <>
        <h1 id="screen-title" className="text-xxl font-semibold">
          Modul
        </h1>
        <div className="mt-6">
          <CoreHint error={modules.error} />
        </div>
      </>
    );
  }
  if (modules.isPending) {
    return (
      <h1 id="screen-title" className="text-xxl font-semibold">
        Modul
      </h1>
    );
  }
  if (!module) {
    return (
      <>
        <h1 id="screen-title" className="text-xxl font-semibold">
          Modul
        </h1>
        <div className="mt-6">
          <EmptyState>Dieses Modul gibt es nicht (mehr). Wähle links ein anderes aus.</EmptyState>
        </div>
      </>
    );
  }

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
          <span className="block text-text">Kommt mit den nächsten Schritten</span>
          <span className="mt-1 block">Folien, Übungen, Vorlesungen und Konzepte erscheinen hier.</span>
        </EmptyState>
      </div>
    </>
  );
}

/** Modul-Übersicht (07 §3.2) – Route mit Query-Parameter `?id=` (VERTRAEGE §5). */
export function ModulView() {
  return (
    <section aria-labelledby="screen-title">
      <Suspense fallback={null}>
        <ModuleView />
      </Suspense>
    </section>
  );
}
