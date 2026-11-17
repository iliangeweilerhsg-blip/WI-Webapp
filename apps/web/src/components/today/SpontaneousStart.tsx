'use client';

// Session ohne Kalendertermin starten (F-SES-04, Issue #120): auf Heute mit Modulauswahl, auf der Modulseite
// für genau dieses Modul. Nach dem Start öffnet sich direkt das Live-Dashboard.
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Module, Session } from '@sg/shared';
import { ApiRequestError, friendlyMessage } from '../../lib/api.ts';
import { DECK_POLL_MS, useDeckOptions } from '../../lib/material.ts';
import {
  ACTIVE_SESSION_KEY,
  applyActiveSession,
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

  async function start(moduleId: string, slideDeckId?: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    if (pending.current && pending.current.moduleId !== moduleId) discard(pending.current);
    const id = pending.current?.moduleId === moduleId ? pending.current.id : uuidv7();
    pending.current = { moduleId, id };
    try {
      noteMicIntent(id);
      const result = await createAndStartSession(moduleId, id, slideDeckId);
      pending.current = null;
      rememberLastModuleId(moduleId);
      // Auch auf der Modulseite (ohne `onSession`) soll der Tab die neue Session sofort kennen
      if (result.ended_session) applyActiveSession(client, result.ended_session);
      applyActiveSession(client, result.session);
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

/**
 * Folien beim spontanen Start (VERTRAEGE §22.7): `deck-options` ohne Session für das gewählte Modul. Der Vorschlag steht
 * als Zeile unter dem Modul und geht als `slide_deck_id` in `POST /sessions` mit; „Ohne Folien“ ist ein Klick.
 * Keine Liste: Wer einen anderen Satz will, wählt ihn in der Live-Ansicht. Der Start wartet nie auf die Abfrage.
 */
function useSpontaneousDeck(moduleId: string, enabled = true, busy = false) {
  // Wie auf der Start-Karte (§22.7): neuer Satz beim Sichtbarwerden und alle 60 s im sichtbaren Tab, nicht beim Anlegen
  const poll = enabled && !busy;
  const query = useDeckOptions(moduleId, null, {
    enabled,
    refetchOnVisible: poll,
    refetchInterval: poll ? DECK_POLL_MS : false,
  });
  const [none, setNone] = useState(false);
  useEffect(() => setNone(false), [moduleId]);
  const suggestedId = query.data?.suggested_deck_id ?? null;
  const suggestion = query.data?.items.find((item) => item.deck.id === suggestedId) ?? null;
  return {
    suggestion,
    none,
    setNone,
    /** Satz für `POST /sessions`; `undefined` = ohne das Feld */
    deckId: !none && suggestion ? suggestion.deck.id : undefined,
  };
}

const linkButton =
  'inline-flex min-h-11 items-center rounded-md px-3 text-md text-text-muted underline underline-offset-4 hover:bg-surface-raised hover:text-text';

function SpontaneousDeckRow({ deck }: { deck: ReturnType<typeof useSpontaneousDeck> }) {
  const { suggestion } = deck;
  if (!suggestion) return null;
  return (
    <div data-testid="spontan-deck" className="mt-2 flex flex-wrap items-center gap-x-1">
      <p className="text-md">
        {deck.none ? (
          'Ohne Folien'
        ) : (
          <>
            Folien: <span className="font-medium">{suggestion.deck.title}</span>
            {suggestion.source === 'moodle' ? <span className="text-text-muted"> aus Moodle</span> : null}
          </>
        )}
      </p>
      <button type="button" className={linkButton} onClick={() => deck.setNone(!deck.none)}>
        {deck.none ? 'Folien nehmen' : 'Ohne Folien'}
      </button>
    </div>
  );
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
    <SpontaneousCardBody
      modules={modules}
      selected={selected}
      onChoose={setChosen}
      start={start}
      busy={busy}
      error={error}
    />
  );
}

interface BodyProps {
  modules: readonly Module[];
  selected: string;
  onChoose: (id: string) => void;
  start: (moduleId: string, slideDeckId?: string) => Promise<void>;
  busy: boolean;
  error: string | null;
}

function SpontaneousCardBody({ modules, selected, onChoose, start, busy, error }: BodyProps) {
  const deck = useSpontaneousDeck(selected, true, busy);

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
            onChange={(e) => onChoose(e.target.value)}
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
          onClick={() => void start(selected, deck.deckId)}
        >
          {busy ? 'Wird gestartet …' : 'Session starten'}
        </button>
      </div>
      <SpontaneousDeckRow deck={deck} />
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
  const running = active.data ?? null;
  // Läuft schon eine Session, gibt es hier nichts zu starten und nichts abzufragen
  const deck = useSpontaneousDeck(moduleId, !active.isPending && running === null, busy);
  if (active.isPending) return null;

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
          onClick={() => void start(moduleId, deck.deckId)}
        >
          {busy ? 'Wird gestartet …' : 'Session starten'}
        </button>
      )}
      {running ? null : <SpontaneousDeckRow deck={deck} />}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
