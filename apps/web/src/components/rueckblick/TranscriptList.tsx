'use client';

// Transkript einer Folie bzw. der ganzen Vorlesung (F-NAC-02): Zeit und Text je Abschnitt. Klick oder Enter spielt
// die Aufnahme ab dieser Stelle ab, die Leertaste (global, siehe ReviewView) pausiert. Der Abschnitt an der
// Abspielposition ist dezent markiert (`aria-current`, Randlinie und Hintergrund, nicht nur Farbe).
import { Fragment, memo, useEffect, useRef } from 'react';
import type { TranscriptLine } from '@sg/shared';
import { clockAt, isoAt } from '../../lib/transcript.ts';
import { gapText, type RecordingGap } from './gaps.ts';

/** Eine Zeile ist durch Abschnitt und Teil bestimmt (VERTRAEGE §18.4) */
export const lineKey = (line: Pick<TranscriptLine, 'segment_id' | 'part'>): string =>
  `${line.segment_id}:${line.part}`;

interface LineProps {
  line: TranscriptLine;
  startedAt: string | null;
  active: boolean;
  /** Sprache des Moduls: weicht die Zeile ab, bekommt sie `lang` (Aussprache bei Screenreadern) */
  lang: string | null;
  onPlay: (line: TranscriptLine) => void;
}

const LineRow = memo(function LineRow({ line, startedAt, active, lang, onPlay }: LineProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Beim Abspielen bleibt die aktive Zeile im Blick. `nearest`: nur scrollen, wenn sie hinausragt.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  return (
    <li>
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        data-testid="transcript-line"
        data-active={active ? 'true' : undefined}
        aria-current={active ? 'true' : undefined}
        aria-label={`${clockAt(startedAt, line.start_ms, true)}, ${line.text}. Ab hier abspielen`}
        onClick={() => onPlay(line)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
          e.preventDefault();
          onPlay(line);
        }}
        className={`group flex min-h-11 cursor-pointer gap-3 rounded-md border-l-2 px-3 py-2 text-md ${
          active
            ? 'border-accent bg-accent-soft'
            : 'border-transparent hover:bg-surface-raised focus-visible:bg-surface-raised'
        }`}
      >
        <time
          className="w-16 shrink-0 pt-px text-sm tabular-nums text-text-muted"
          dateTime={isoAt(startedAt, line.start_ms) ?? undefined}
        >
          {clockAt(startedAt, line.start_ms, true)}
        </time>
        <span
          className="min-w-0 flex-1 break-words"
          lang={line.lang && line.lang !== lang ? line.lang : undefined}
        >
          {line.text}
        </span>
        <span
          aria-hidden="true"
          className={`shrink-0 text-sm text-text-muted ${active ? '' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}
        >
          ▶
        </span>
      </div>
    </li>
  );
});

export interface TranscriptListProps {
  lines: readonly TranscriptLine[];
  startedAt: string | null;
  /** Schlüssel (`lineKey`) der aktiven Zeile, `null` = keine */
  activeKey: string | null;
  lang: string | null;
  onPlay: (line: TranscriptLine) => void;
  label: string;
  /** Lücken zwischen Aufnahmen (UX-310): Eine Zeile "Keine Aufnahme ..." steht zwischen den Zeilen davor und danach */
  gaps?: readonly RecordingGap[];
}

/** Die Lücken vor der Zeile `index`: zwischen der Zeile davor und dieser (nie vor der ersten angezeigten Zeile) */
function gapsBefore(lines: readonly TranscriptLine[], index: number, gaps: readonly RecordingGap[]) {
  const prev = lines[index - 1];
  const line = lines[index];
  if (!prev || !line) return [];
  return gaps.filter((g) => g.start_ms >= prev.start_ms && g.end_ms <= line.start_ms);
}

export function TranscriptList({
  lines,
  startedAt,
  activeKey,
  lang,
  onPlay,
  label,
  gaps = [],
}: TranscriptListProps) {
  return (
    <ol aria-label={label} className="flex flex-col gap-0.5">
      {lines.map((line, i) => (
        <Fragment key={lineKey(line)}>
          {gapsBefore(lines, i, gaps).map((gap) => (
            <li
              key={`gap-${gap.start_ms}`}
              data-testid="recording-gap"
              className="my-1 px-3 py-1 text-sm italic text-text-muted"
            >
              {gapText(gap, startedAt)}
            </li>
          ))}
          <LineRow
            line={line}
            startedAt={startedAt}
            active={lineKey(line) === activeKey}
            lang={lang}
            onPlay={onPlay}
          />
        </Fragment>
      ))}
    </ol>
  );
}
