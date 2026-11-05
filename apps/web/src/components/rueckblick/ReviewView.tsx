'use client';

// Rückblick einer Vorlesung (T2-03, F-NAC-02, 07 §3.4): links die Folie, daneben, was dazu gesagt wurde. Ein Klick
// auf einen Abschnitt spielt die Aufnahme ab dieser Stelle. Dazu der Verarbeitungsstand als ruhige Schrittliste.
// Route `/rueckblick?id=<session_id>` (Static Export: Query-Parameter, VERTRAEGE §5). Zustände: VERTRAEGE §18.9.
// Noch nicht Teil dieses Schnitts: Notizseiten, Marker und Fotos (rechte Spalte aus 07 §3.4).
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, SessionTranscript, TranscriptLine } from '@sg/shared';
import { ApiRequestError, friendlyMessage } from '../../lib/api.ts';
import { useDeckDetail } from '../../lib/material.ts';
import { moduleColorVar, useModules } from '../../lib/modules.ts';
import { moduleHref } from '../../lib/nav.ts';
import { isEditableTarget } from '../../lib/shortcuts.ts';
import { sessionHref } from '../../lib/sessions.ts';
import {
  NO_SLIDE,
  activeLineIndex,
  hasSlideMapping,
  isFailed,
  isPending,
  lineSlideKey,
  recordingAudioUrl,
  reviewState,
  slideAt,
  stepRows,
  timelineBounds,
  useReprocess,
  useTranscript,
  type ReprocessAction,
  type ReviewState,
} from '../../lib/transcript.ts';
import { useSessionData } from '../dashboard/use-session.ts';
import { EmptyState } from '../Placeholder.tsx';
import { StepList } from '../processing/StepList.tsx';
import { PlayerBar } from './PlayerBar.tsx';
import { SlideColumn, type SlideItem } from './SlideColumn.tsx';
import { TranscriptList, lineKey } from './TranscriptList.tsx';
import { SKIP_MS, usePlayer } from './use-player.ts';

const action =
  'inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised aria-disabled:opacity-60';

function Notice({
  children,
  retry,
  to,
}: {
  children: string;
  retry?: () => void;
  to?: { href: string; label: string };
}) {
  return (
    <section aria-labelledby="screen-title" className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
      <h1 id="screen-title" className="text-xxl font-semibold">
        Rückblick
      </h1>
      <div className="mt-6">
        <EmptyState
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {retry ? (
                <button type="button" onClick={retry} className={action}>
                  Erneut versuchen
                </button>
              ) : null}
              <Link href={to?.href ?? '/'} className={action}>
                {to?.label ?? 'Zu Heute'}
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

function Loading() {
  return (
    <section aria-labelledby="screen-title" className="px-4 py-6 md:px-8 md:py-8">
      <h1 id="screen-title" className="text-xxl font-semibold">
        Rückblick
      </h1>
      <p role="status" className="mt-4 text-md text-text-muted">
        Wird geladen …
      </p>
    </section>
  );
}

function ReviewScreen() {
  const params = useSearchParams();
  const id = params.get('id') || null;
  const data = useSessionData(id);
  const modules = useModules();
  const session = data.session;
  const transcript = useTranscript(id, session?.processing);
  const reprocess = useReprocess(id ?? '', data.apply);

  if (id === null) return <Notice>Keine Session ausgewählt.</Notice>;
  if (!session) {
    if (data.loading) return <Loading />;
    // Eine ungültige ID beantwortet der Core mit 400, eine unbekannte mit 404: beides ruhig, ohne „Erneut versuchen“
    if (
      data.error instanceof ApiRequestError &&
      data.error.kind === 'api' &&
      (data.error.status === 404 || data.error.status === 400)
    ) {
      return <Notice>Diese Session gibt es nicht (mehr).</Notice>;
    }
    return <Notice retry={data.refetch}>{`Session nicht erreichbar: ${friendlyMessage(data.error)}`}</Notice>;
  }
  if (session.deleted_at !== null) return <Notice>Diese Session wurde gelöscht.</Notice>;

  const module = modules.data?.find((m) => m.id === session.module_id);
  const title =
    session.title ?? (session.number !== null ? `Vorlesung ${session.number}` : 'Spontane Session');
  const heading = [module?.name, title].filter(Boolean).join(' · ');

  let body;
  if (session.state !== 'beendet' && session.state !== 'verarbeitet') {
    body = (
      <EmptyState
        action={
          <Link href={sessionHref(session.id)} className={action}>
            Zur Vorlesung
          </Link>
        }
      >
        Diese Session läuft noch. Den Rückblick gibt es danach.
      </EmptyState>
    );
  } else if (!transcript.data) {
    body = transcript.isPending ? (
      <p role="status" className="text-md text-text-muted">
        Wird geladen …
      </p>
    ) : (
      <EmptyState
        action={
          <button type="button" onClick={() => void transcript.refetch()} className={action}>
            Erneut versuchen
          </button>
        }
      >
        {`Das Transkript ist gerade nicht erreichbar: ${friendlyMessage(transcript.error)}`}
      </EmptyState>
    );
  } else {
    body = (
      <ReviewBody
        session={session}
        transcript={transcript.data}
        state={reviewState(session, transcript.data)}
        reprocess={reprocess}
        moduleHrefValue={moduleHref(session.module_id)}
        lang={module?.lang ?? null}
      />
    );
  }

  return (
    <section aria-labelledby="screen-title" className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-x-4 gap-y-1 px-4 pb-2 pt-4 md:px-8">
        <div className="min-w-0">
          <p className="text-sm text-text-muted">Rückblick</p>
          <h1 id="screen-title" className="flex min-w-0 items-center gap-2 text-lg font-semibold">
            {module ? (
              <span
                aria-hidden="true"
                className="inline-block size-3 shrink-0 rounded-full"
                style={{ backgroundColor: moduleColorVar(module.color) }}
              />
            ) : null}
            <span className="min-w-0 break-words">{heading}</span>
          </h1>
        </div>
        <Link href={moduleHref(session.module_id)} className="text-sm text-text-muted hover:text-text">
          Zum Modul
        </Link>
      </header>
      {data.hint ? (
        <p role="status" className="shrink-0 px-4 pb-1 text-sm text-text-muted md:px-8">
          Keine Live-Verbindung – der Stand wird regelmäßig neu geholt.
        </p>
      ) : null}
      {body}
    </section>
  );
}

interface BodyProps {
  session: Session;
  transcript: SessionTranscript;
  state: ReviewState;
  reprocess: ReprocessAction;
  moduleHrefValue: string;
  lang: string | null;
}

function ReviewBody({ session, transcript, state, reprocess, moduleHrefValue, lang }: BodyProps) {
  const { lines, slide_segments: segments } = transcript;
  const mapped = hasSlideMapping(transcript);
  const startedAt = session.started_at;
  const deckId = session.slide_deck_id;
  const rows = stepRows(session.processing);
  const showSteps = rows.some((row) => row.state !== 'fertig');

  const firstStart = lines[0]?.start_ms ?? timelineBounds(transcript.recordings)?.start ?? 0;
  const player = usePlayer(transcript.recordings, firstStart);
  const initialT = useRef(firstStart);
  const everPlayed = useRef(false);
  if (player.playing) everPlayed.current = true;
  // Markiert wird erst, wenn abgespielt oder gesprungen wurde (vorher steht der Player am Anfang)
  const engaged = player.playing || everPlayed.current || player.t !== initialT.current;

  // Folien: aus dem Foliensatz, solange der nicht geladen ist aus den Segmenten
  const deck = useDeckDetail(deckId ?? '', { enabled: deckId !== null && mapped });
  const slides = useMemo<SlideItem[]>(() => {
    const fromDeck = (deck.data?.slides ?? [])
      .filter((s) => s.deleted_at === null)
      .sort((a, b) => a.index - b.index)
      .map((s) => ({ id: s.id, index: s.index, width: s.width_pt, height: s.height_pt }));
    if (fromDeck.length > 0) return fromDeck;
    const seen = new Map<string, SlideItem>();
    for (const s of segments) {
      if (!seen.has(s.slide_id))
        seen.set(s.slide_id, { id: s.slide_id, index: s.slide_index, width: 16, height: 9 });
    }
    return [...seen.values()].sort((a, b) => a.index - b.index);
  }, [deck.data, segments]);

  const hasNone = mapped && lines.some((l) => l.slide_id === null);
  const spoken = useMemo(() => new Set(lines.flatMap((l) => (l.slide_id ? [l.slide_id] : []))), [lines]);
  const validKeys = useMemo(
    () => new Set([...(hasNone ? [NO_SLIDE] : []), ...slides.map((s) => s.id)]),
    [hasNone, slides],
  );
  const defaultKey = segments[0]?.slide_id ?? slides[0]?.id ?? NO_SLIDE;

  // Aktive Zeile und Folie an der Abspielposition; die Ansicht folgt beim Abspielen
  const activeIndex = activeLineIndex(lines, player.t);
  const activeLine = engaged && activeIndex >= 0 ? (lines[activeIndex] ?? null) : null;
  const followKey = !engaged
    ? null
    : activeLine
      ? lineSlideKey(activeLine)
      : (slideAt(segments, player.t)?.slide_id ?? null);
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    if (followKey !== null && validKeys.has(followKey)) setChosen(followKey);
  }, [followKey, validKeys]);
  const selected = chosen !== null && validKeys.has(chosen) ? chosen : defaultKey;

  const shownLines = useMemo(
    () => (mapped ? lines.filter((l) => lineSlideKey(l) === selected) : lines),
    [mapped, lines, selected],
  );
  const playLine = (line: TranscriptLine) => player.seek(line.start_ms, true);

  // Tasten (07 §10): Leertaste Abspielen/Pause, J −15 s, L +15 s. Nicht in Eingabefeldern; ein Positionsregler zählt nicht
  // als Eingabefeld. Schaltflächen, Links und Auswahlfelder behalten ihre eigene Leertaste.
  const { toggle, skip } = player;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const slider = target instanceof HTMLInputElement && target.type === 'range';
      if (isEditableTarget(target) && !slider) return;
      if (e.key === ' ') {
        if (target?.closest?.('button, a, summary, select')) return;
        e.preventDefault();
        toggle();
      } else if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        skip(-SKIP_MS);
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        skip(SKIP_MS);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle, skip]);

  const transcriptFailed = isFailed(session.processing.transcribe ?? 'fertig');
  const transcriptPending = isPending(session.processing.transcribe ?? 'fertig');
  const hasContent = lines.length > 0 || mapped;
  const slide = slides.find((s) => s.id === selected);
  const columnTitle = slide ? `Transkript zu Folie ${slide.index}` : 'Transkript vor der ersten Folie';

  const notices = (
    <>
      {showSteps ? (
        <StepList
          processing={session.processing}
          busy={reprocess.busy}
          error={reprocess.error}
          onRetry={(step) => void reprocess.run(step)}
        />
      ) : null}
      {state === 'offen' && (transcriptPending || transcript.transcripts.length === 0) ? (
        <p role="status" className="text-md text-text-muted">
          Transkript kommt noch.
        </p>
      ) : null}
      {state === 'veraltet' ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3">
          <p className="min-w-0 flex-1 basis-56 text-md">Seit dem Transkript ist neues Audio dazugekommen.</p>
          <button
            type="button"
            className={action}
            aria-disabled={reprocess.busy}
            onClick={() => {
              if (!reprocess.busy) void reprocess.run('transcribe');
            }}
          >
            Transkript aktualisieren
          </button>
          {!showSteps && reprocess.error ? (
            <p role="alert" className="basis-full text-sm text-text-muted">
              {reprocess.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );

  let content;
  if (state === 'nicht_beendet') content = null;
  else if (state === 'keine_aufnahme') {
    // Steht ein Schritt auf „nicht fertig“, ist die Aufnahme womöglich nur noch nicht verarbeitet: dann sagt das die
    // Schrittliste mit ihren Aktionen, nicht der Satz „keine Aufnahme“
    content = rows.some((row) => isFailed(row.state)) ? null : (
      <EmptyState
        action={
          <Link href={moduleHrefValue} className={action}>
            Zum Modul
          </Link>
        }
      >
        Zu dieser Session gibt es keine Aufnahme.
      </EmptyState>
    );
  } else if (!hasContent) content = null;
  else if (!mapped) {
    content = (
      <div className="mx-auto w-full max-w-3xl">
        <p className="text-sm text-text-muted">
          {deckId === null
            ? 'Ohne Folien: Das Transkript steht als eine Liste.'
            : 'Die Folien sind noch nicht zugeordnet. Das Transkript steht als eine Liste.'}
        </p>
        <h2 className="mt-3 text-md font-medium">Transkript</h2>
        <div className="mt-1">
          <TranscriptList
            label="Transkript"
            lines={lines}
            startedAt={startedAt}
            activeKey={activeLine ? lineKey(activeLine) : null}
            lang={lang}
            onPlay={playLine}
          />
        </div>
      </div>
    );
  } else {
    content = (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)] lg:gap-8">
        <div className="min-w-0 lg:sticky lg:top-0 lg:self-start">
          <SlideColumn
            deckId={deckId}
            slides={slides}
            selected={selected}
            onSelect={setChosen}
            hasNone={hasNone}
            spoken={spoken}
          />
        </div>
        <div className="min-w-0">
          <h2 className="text-md font-medium">{columnTitle}</h2>
          {shownLines.length > 0 ? (
            <div className="mt-1">
              <TranscriptList
                label={columnTitle}
                lines={shownLines}
                startedAt={startedAt}
                activeKey={activeLine ? lineKey(activeLine) : null}
                lang={lang}
                onPlay={playLine}
              />
            </div>
          ) : (
            <p className="mt-2 text-md text-text-muted">
              {transcriptFailed
                ? 'Transkript nicht fertig.'
                : lines.length === 0
                  ? 'Hier erscheint das Transkript, sobald es fertig ist.'
                  : 'Zu dieser Folie wurde nichts gesagt.'}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          {notices}
          {content}
        </div>
      </div>
      {/* Die Audio-Elemente stehen immer im DOM (ein Element je Aufnahme), auch wenn der Player ausgeblendet ist */}
      {player.recordings.map((recording) => (
        <audio
          key={recording.id}
          preload="none"
          src={recordingAudioUrl(recording.id)}
          data-recording={recording.id}
          {...player.audioProps(recording)}
        />
      ))}
      {state !== 'keine_aufnahme' && state !== 'nicht_beendet' && player.recordings.length > 0 ? (
        <PlayerBar player={player} startedAt={startedAt} />
      ) : null}
    </>
  );
}

export function ReviewView() {
  return (
    <Suspense fallback={null}>
      <ReviewScreen />
    </Suspense>
  );
}
