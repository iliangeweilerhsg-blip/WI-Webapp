'use client';

// Rechte Spalte des Rückblicks (07 §3.4, F-NAC-02): meine Notizseiten zu dieser Folie, Marker und Fotos. Leere
// Bereiche bleiben ruhige Textzeilen. Tipp auf einen Strich, einen Marker oder ein Foto-Datum spielt die Aufnahme
// 3 s davor ab (F-NAC-04, ohne Wiedergabe-Modus).
import { useState } from 'react';
import type { Marker, MarkerKind, Photo } from '@sg/shared';
import { photoFileUrl } from '../../lib/review-notes.ts';
import { clockAt } from '../../lib/transcript.ts';
import { NotePage } from './NotePage.tsx';
import { playbackStart, sessionTimeOf, type ReviewNotes } from './notes.ts';

const MARKER_LABELS: Record<MarkerKind, { icon: string; label: string }> = {
  frage: { icon: '❓', label: 'Frage' },
  klausur: { icon: '⚠️', label: 'Klausur' },
  verknuepfung: { icon: '🔗', label: 'Verknüpfung' },
};

export interface NotesColumnProps {
  notes: ReviewNotes;
  startedAt: string | null;
  /** Es gibt Audio zum Abspielen */
  canPlay: boolean;
  onPlay: (tMs: number) => void;
  /** Seiten oder Snapshot werden noch geladen */
  loading: boolean;
  /** Text, wenn Seiten oder Snapshot nicht ladbar waren */
  error: string | null;
  onRetry: () => void;
}

const muted = 'text-md text-text-muted';
const heading = 'text-md font-medium';

function MarkerRow({
  marker,
  startedAt,
  canPlay,
  onPlay,
}: {
  marker: Marker;
  startedAt: string | null;
  canPlay: boolean;
  onPlay: (tMs: number) => void;
}) {
  const { icon, label } = MARKER_LABELS[marker.kind];
  const at = sessionTimeOf(marker);
  const time = clockAt(startedAt, at, true);
  const done = marker.resolved_at !== null;
  const content = (
    <>
      <span aria-hidden="true">{icon}</span>
      <span className="tabular-nums text-text-muted">{time}</span>
      <span className="min-w-0 flex-1 break-words">
        {label}
        {marker.note ? `: ${marker.note}` : ''}
        {done ? ' (erledigt)' : ''}
      </span>
    </>
  );
  const box = `flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-md ${done ? 'opacity-60' : ''}`;
  return (
    <li>
      {canPlay ? (
        <button
          type="button"
          data-testid="note-marker"
          aria-label={`${label} um ${time}${marker.note ? `: ${marker.note}` : ''}. Ab hier abspielen`}
          onClick={() => onPlay(playbackStart(at))}
          className={`${box} hover:bg-surface-raised`}
        >
          {content}
        </button>
      ) : (
        <div data-testid="note-marker" className={box}>
          {content}
        </div>
      )}
    </li>
  );
}

function PhotoItem({
  photo,
  startedAt,
  canPlay,
  onPlay,
}: {
  photo: Photo;
  startedAt: string | null;
  canPlay: boolean;
  onPlay: (tMs: number) => void;
}) {
  const [failed, setFailed] = useState(false);
  const at = sessionTimeOf(photo);
  const time = clockAt(startedAt, at, true);
  return (
    <li data-testid="note-photo" className="min-w-0">
      {photo.has_file && !failed ? (
        <a
          href={photoFileUrl(photo.id)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Foto von ${time} öffnen`}
        >
          <img
            src={photoFileUrl(photo.id)}
            alt={`Tafel-Foto von ${time}`}
            loading="lazy"
            draggable={false}
            onError={() => setFailed(true)}
            className="block max-h-48 w-full rounded-md border border-border object-cover"
          />
        </a>
      ) : (
        <p className="grid min-h-24 place-items-center rounded-md border border-border px-2 text-center text-sm text-text-muted">
          {photo.has_file ? 'Das Foto lässt sich nicht anzeigen.' : 'Das Foto kommt noch.'}
        </p>
      )}
      {canPlay ? (
        <button
          type="button"
          aria-label={`Aufnahme ab Foto von ${time} abspielen`}
          onClick={() => onPlay(playbackStart(at))}
          className="mt-1 inline-flex min-h-11 items-center rounded-md px-2 text-sm tabular-nums text-text-muted hover:bg-surface-raised hover:text-text"
        >
          {`▶ ${time}`}
        </button>
      ) : (
        <p className="mt-1 text-sm tabular-nums text-text-muted">{time}</p>
      )}
    </li>
  );
}

export function NotesColumn({
  notes,
  startedAt,
  canPlay,
  onPlay,
  loading,
  error,
  onRetry,
}: NotesColumnProps) {
  const { pages, markers, photos } = notes;
  const empty = pages.length === 0 && markers.length === 0 && photos.length === 0;
  return (
    <div data-testid="review-notes" className="flex min-w-0 flex-col gap-4">
      {error ? (
        <p role="alert" className={muted}>
          {`Die Notizen sind gerade nicht erreichbar: ${error} `}
          <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:text-text">
            Erneut versuchen
          </button>
        </p>
      ) : null}
      {loading && empty ? (
        <p role="status" className={muted}>
          Notizen werden geladen …
        </p>
      ) : null}

      <section aria-labelledby="notes-pages">
        <h2 id="notes-pages" className={heading}>{`Meine Notizen (${pages.length})`}</h2>
        {pages.length > 0 ? (
          <>
            {canPlay ? (
              <p className="mt-1 text-sm text-text-muted">Tipp auf einen Strich spielt ab dort.</p>
            ) : null}
            <ul className="mt-2 flex flex-col gap-4">
              {pages.map((page) => (
                <li key={page.id}>
                  <NotePage page={page} startedAt={startedAt} canPlay={canPlay} onPlay={onPlay} />
                </li>
              ))}
            </ul>
          </>
        ) : error || loading ? null : (
          <p className={`mt-1 ${muted}`}>Dazu gibt es keine Notizseite.</p>
        )}
      </section>

      <section aria-labelledby="notes-markers">
        <h2 id="notes-markers" className={heading}>{`Marker (${markers.length})`}</h2>
        {markers.length > 0 ? (
          <ul aria-labelledby="notes-markers" className="mt-1 flex flex-col">
            {markers.map((marker) => (
              <MarkerRow
                key={marker.id}
                marker={marker}
                startedAt={startedAt}
                canPlay={canPlay}
                onPlay={onPlay}
              />
            ))}
          </ul>
        ) : error || loading ? null : (
          <p className={`mt-1 ${muted}`}>Keine Marker.</p>
        )}
      </section>

      <section aria-labelledby="notes-photos">
        <h2 id="notes-photos" className={heading}>{`Fotos (${photos.length})`}</h2>
        {photos.length > 0 ? (
          <ul className="mt-2 grid grid-cols-2 gap-3">
            {photos.map((photo) => (
              <PhotoItem
                key={photo.id}
                photo={photo}
                startedAt={startedAt}
                canPlay={canPlay}
                onPlay={onPlay}
              />
            ))}
          </ul>
        ) : error || loading ? null : (
          <p className={`mt-1 ${muted}`}>Keine Fotos.</p>
        )}
      </section>
    </div>
  );
}
