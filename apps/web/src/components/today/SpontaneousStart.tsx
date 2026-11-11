'use client';

// Session ohne Kalendertermin starten (F-SES-04, Issue #120): auf Heute mit Modulauswahl, auf der Modulseite
// für genau dieses Modul. Nach dem Start öffnet sich direkt das Live-Dashboard.
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Module, Session } from '@sg/shared';
import { ApiRequestError, friendlyMessage } from '../../lib/api.ts';
import {
  ACTIVE_SESSION_KEY,
  createAndStartSession,
  deleteSession,
  findActiveSession,
  isActive,
  readLastModuleId,
  rememberLastModuleId,
  sessionAnchor,
  sessionHref,
  useActiveSession,
} from '../../lib/sessions.ts';
import { noteMicIntent } from '../../lib/recorder/mic-intent.ts';
import { useToast } from '../../lib/toast.tsx';
import { uuidv7 } from '../../lib/uuid.ts';

const primary =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-6 py-2 text-md font-medium text-accent-contrast aria-disabled:opacity-50';
const secondary =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised aria-disabled:opacity-50';

/**
 * Startet eine Session für `moduleId` und navigiert zum Dashboard. Bei 409 sucht der Hook die laufende Session und
 * führt dorthin; sonst steht eine deutsche Meldung in `error`.
 */
function useSpontaneousStart(onSession?: (session: Session) => void) {
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Dieselbe ID bei Wiederholung nach einem Fehler, damit keine verwaiste Session zurückbleibt
  const pending = useRef<{ moduleId: string; id: string } | null>(null);

  // Eine angelegte, aber nie gestartete Session (Start gescheitert) räumt der Hook best effort wieder weg
  function discard(entry: { id: string } | null) {
    if (entry) void deleteSession(entry.id).catch(() => undefined);
  }
  useEffect(
    () => () => {
      if (!busyRef.current) discard(pending.current);
    },
    [],
  );

  async function start(moduleId: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    if (pending.current && pending.current.moduleId !== moduleId) discard(pending.current);
    const id = pending.current?.moduleId === moduleId ? pending.current.id : uuidv7();
    pending.current = { moduleId, id };
    try {
      noteMicIntent(id);
      const result = await createAndStartSession(moduleId, id);
      pending.current = null;
      rememberLastModuleId(moduleId);
      onSession?.(result.session);
      if (result.ended_session) {
        onSession?.(result.ended_session);
        toast.show({ message: 'Die laufende Session wurde beendet.' });
      }
      void client.invalidateQueries({ queryKey: ACTIVE_SESSION_KEY });
      router.push(sessionHref(result.session.id));
    } catch (cause) {
      // Die Session gibt es nicht (mehr): Beim nächsten Versuch mit neuer ID anlegen
      if (cause instanceof ApiRequestError && cause.status === 404) pending.current = null;
      if (
        cause instanceof ApiRequestError &&
        cause.status === 409 &&
        cause.code !== 'session_transition_invalid'
      ) {
        // Es läuft schon eine Session (session_one_active): dorthin führen statt einen Fehler zu zeigen
        const active = await findActiveSession().catch(() => null);
        if (active) {
          discard(pending.current);
          pending.current = null;
          void client.invalidateQueries({ queryKey: ACTIVE_SESSION_KEY });
          router.push(sessionHref(active.id));
          return;
        }
      }
      setError(friendlyMessage(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return { start, busy, error };
}

export interface SpontaneousStartCardProps {
  modules: readonly Module[];
  /** Sessions des Tages; das Modul der jüngsten dient als Vorauswahl, wenn nichts gespeichert ist */
  sessions: readonly Session[];
  onSession: (session: Session) => void;
}

/** Heute: „Session starten“ mit Modulauswahl. Erscheint nur, wenn keine Session läuft oder pausiert. */
export function SpontaneousStartCard({ modules, sessions, onSession }: SpontaneousStartCardProps) {
  const { start, busy, error } = useSpontaneousStart(onSession);
  const [chosen, setChosen] = useState<string | null>(null);
  const [stored, setStored] = useState<string | null>(null);
  useEffect(() => setStored(readLastModuleId()), []);

  if (modules.length === 0 || sessions.some(isActive)) return null;
  const known = (id: string | null | undefined): id is string => !!id && modules.some((m) => m.id === id);
  const latest = [...sessions].sort((a, b) => sessionAnchor(b) - sessionAnchor(a))[0]?.module_id;
  const selected = [chosen, stored, latest].find(known) ?? modules[0]?.id ?? '';

  return (
    <section aria-labelledby="spontan-title" className="rounded-lg border border-border bg-surface px-4 py-4">
      <h2 id="spontan-title" className="text-lg font-semibold">
        Session ohne Termin
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Für Übungen, Tutorien oder Lerngruppen. Es braucht keinen Kalendertermin.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block text-sm font-medium">
          Modul
          <select
            value={selected}
            onChange={(e) => setChosen(e.target.value)}
            className="mt-1 block min-h-11 rounded-md border border-border-strong bg-bg px-3 py-2 text-md"
          >
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={primary}
          aria-disabled={busy}
          aria-busy={busy}
          onClick={() => void start(selected)}
        >
          {busy ? 'Wird gestartet …' : 'Session starten'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Modulseite: „Session starten“ für genau dieses Modul, bei laufender Session „Zur laufenden Session“. */
export function ModuleSessionButton({ moduleId }: { moduleId: string }) {
  const active = useActiveSession();
  const { start, busy, error } = useSpontaneousStart();
  if (active.isPending) return null;
  const running = active.data ?? null;

  return (
    <div className="mt-4">
      {running ? (
        <Link href={sessionHref(running.id)} className={primary}>
          Zur laufenden Session
        </Link>
      ) : (
        <button
          type="button"
          className={secondary}
          aria-disabled={busy}
          aria-busy={busy}
          onClick={() => void start(moduleId)}
        >
          {busy ? 'Wird gestartet …' : 'Session starten'}
        </button>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
