'use client';

// Live-Dashboard (T1-04, F-DSH-01 und F-DSH-06, 07 §3.3): der Bildschirm während einer Session.
// Route `/session?id=<session_id>` (Static Export: Query-Parameter statt dynamischem Segment, VERTRAEGE §5).
// Folie (T1-05) und Marker (T1-17) sind Platzhalter unter `slides/` und `markers/`.
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { ApiRequestError, friendlyMessage } from '../../lib/api.ts';
import { moduleColorVar, useModules } from '../../lib/modules.ts';
import { isEditableTarget, isMacPlatform } from '../../lib/shortcuts.ts';
import { useSyncClient } from '../../lib/sync/SyncProvider.tsx';
import { EmptyState } from '../Placeholder.tsx';
import { Columns, useIsWide } from './Columns.tsx';
import { ExerciseColumn } from './ExerciseColumn.tsx';
import { NotesColumn } from './NotesColumn.tsx';
import { StatusBar } from './StatusBar.tsx';
import { StopConfirm } from './StopConfirm.tsx';
import { LAYOUTS } from './layout.ts';
import { SlidesPanel } from './slides/SlidesPanel.tsx';
import { useDashboardLayout } from './use-layout.ts';
import { useSessionTheme } from './use-session-theme.ts';
import { useSessionActions, useSessionData } from './use-session.ts';
import { isActive } from '../../lib/sessions.ts';

function Missing({ children, retry }: { children: string; retry?: () => void }) {
  return (
    <section aria-labelledby="screen-title" className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
      <h1 id="screen-title" className="text-xxl font-semibold">
        Session
      </h1>
      <div className="mt-6">
        <EmptyState
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {retry ? (
                <button
                  type="button"
                  onClick={retry}
                  className="inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised"
                >
                  Erneut versuchen
                </button>
              ) : null}
              <Link
                href="/"
                className="inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised"
              >
                Zu Heute
              </Link>
            </div>
          }
        >
          {children}
        </EmptyState>
      </div>
    </section>
  );
}

function SessionScreen() {
  const params = useSearchParams();
  const id = params.get('id') || null;
  const sync = useSyncClient();
  const wide = useIsWide();
  const data = useSessionData(id);
  const modules = useModules();
  const session = data.session;
  const module = session ? modules.data?.find((m) => m.id === session.module_id) : undefined;
  const layout = useDashboardLayout(module);
  const actions = useSessionActions(session, data.apply, data.refetch);
  useSessionTheme();

  // Layoutwechsel per Taste 1 bis 4, ohne Maus (F-DSH-01). Nicht beim Tippen und nicht mit Strg/Cmd/Alt.
  const choose = layout.choose;
  useEffect(() => {
    if (!wide) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isEditableTarget(e.target)) return;
      // Physische Taste (`Digit1` bis `Digit4`): gilt auch bei anderen Tastaturbelegungen
      const preset = LAYOUTS.find((l) => e.code === `Digit${l.key}`);
      if (!preset) return;
      e.preventDefault();
      choose(preset.id);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [wide, choose]);

  // Tastenkürzel der Session (07 §10): `P` Pause/Fortsetzen, ⌘⇧S (Mac) bzw. Strg+Umschalt+S Stopp mit Bestätigung.
  // Nicht beim Tippen, nicht bei gehaltener Taste; nur solange die Session läuft oder pausiert.
  const [confirmStop, setConfirmStop] = useState(false);
  const confirmStopRef = useRef(false);
  confirmStopRef.current = confirmStop;
  const run = actions.run;
  const state = session?.state;
  useEffect(() => {
    if (state !== 'laeuft' && state !== 'pausiert') {
      setConfirmStop(false);
      return;
    }
    const mac = isMacPlatform();
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.repeat || e.isComposing || isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'p' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (!confirmStopRef.current) void run(state === 'pausiert' ? 'resume' : 'pause');
      } else if (
        key === 's' &&
        e.shiftKey &&
        !e.altKey &&
        (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)
      ) {
        e.preventDefault();
        setConfirmStop(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, run]);

  if (id === null) return <Missing>Keine Session ausgewählt.</Missing>;
  if (!session) {
    if (data.loading) {
      return (
        <section aria-labelledby="screen-title" className="px-4 py-6 md:px-8 md:py-8">
          <h1 id="screen-title" className="text-xxl font-semibold">
            Session
          </h1>
          <p role="status" className="mt-4 text-md text-text-muted">
            Wird geladen …
          </p>
        </section>
      );
    }
    if (data.error instanceof ApiRequestError && data.error.kind === 'api' && data.error.status === 404) {
      return <Missing>Diese Session gibt es nicht (mehr).</Missing>;
    }
    return (
      <Missing retry={data.refetch}>{`Session nicht erreichbar: ${friendlyMessage(data.error)}`}</Missing>
    );
  }
  if (session.deleted_at !== null) return <Missing>Diese Session wurde gelöscht.</Missing>;

  const active = isActive(session);
  const title =
    session.title ?? (session.number !== null ? `Vorlesung ${session.number}` : 'Spontane Session');
  const focus = layout.layout === 'fokus';

  return (
    <section aria-labelledby="screen-title" className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2">
        <h1 id="screen-title" className="flex min-w-0 items-center gap-2 text-lg font-semibold">
          {module ? (
            <span
              aria-hidden="true"
              className="inline-block size-3 shrink-0 rounded-full"
              style={{ backgroundColor: moduleColorVar(module.color) }}
            />
          ) : null}
          <span className="min-w-0 break-words">{[module?.name, title].filter(Boolean).join(' · ')}</span>
        </h1>
        {wide ? (
          <div role="group" aria-label="Layout" className="flex gap-1">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={layout.layout === l.id}
                aria-keyshortcuts={l.key}
                title={`${l.label} (Taste ${l.key})`}
                onClick={() => layout.choose(l.id)}
                className={`min-h-9 rounded-md px-3 text-sm ${
                  layout.layout === l.id
                    ? 'bg-surface-raised font-medium text-text'
                    : 'text-text-muted hover:bg-surface-raised hover:text-text'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        ) : null}
      </header>
      {layout.saveError ? (
        <p role="status" className="shrink-0 px-3 pb-1 text-sm text-text-muted">
          {layout.saveError}
        </p>
      ) : null}
      {data.hint ? (
        <p role="status" className="shrink-0 px-3 pb-1 text-sm text-text-muted">
          Keine Live-Verbindung – der Stand wird regelmäßig neu geholt.
        </p>
      ) : null}

      <div className="min-h-0 flex-1 px-3 pb-2">
        <Columns
          wide={wide}
          focus={focus}
          widths={layout.widths}
          onPreview={layout.preview}
          onCommit={layout.commit}
          panels={{
            folie: (
              <SlidesPanel
                sessionId={session.id}
                moduleId={session.module_id}
                slideDeckId={session.slide_deck_id}
                active={active}
                startedAt={session.started_at ? Date.parse(session.started_at) : null}
                client={sync}
              />
            ),
            uebung: <ExerciseColumn />,
            notizen: <NotesColumn session={session} client={sync} />,
          }}
        />
      </div>

      {confirmStop && active ? (
        <StopConfirm
          onCancel={() => setConfirmStop(false)}
          onConfirm={() => {
            setConfirmStop(false);
            void actions.run('stop');
          }}
        />
      ) : null}

      <StatusBar
        session={session}
        client={sync}
        moduleId={session.module_id}
        offline={data.hint}
        otherTab={data.otherTab}
        actions={actions}
      />
    </section>
  );
}

export function SessionView() {
  return (
    <Suspense fallback={null}>
      <SessionScreen />
    </Suspense>
  );
}
