'use client';

import Link from 'next/link';
import type { KeyboardEvent } from 'react';
import type { InboxAcceptRequest, InboxItem } from '@sg/shared';
import { conceptHref, sessionRefLabel } from '../../lib/concepts.ts';
import { INBOX_KIND_LABELS, INBOX_KIND_SYMBOLS, blockedHint, relationText } from '../../lib/inbox.ts';
import { isEditableTarget } from '../../lib/shortcuts.ts';
import { SourceChips } from '../concepts/SourceChips.tsx';
import { InboxEdit } from './InboxEdit.tsx';

const button =
  'min-h-9 rounded-md border border-border px-3 py-1 text-sm hover:bg-surface aria-disabled:opacity-50 sg-transition';

export interface InboxRowProps {
  item: InboxItem;
  names: ReadonlyMap<string, string>;
  /** Konzepte, die noch als offener Vorschlag in der Inbox liegen */
  pending: ReadonlySet<string>;
  busy: boolean;
  editing: boolean;
  /** Bei gesammelten älteren Einträgen: die Vorlesung steht in der Zeile */
  showSession?: boolean;
  onAccept: (item: InboxItem, request: InboxAcceptRequest) => void;
  onReject: (item: InboxItem) => void;
  onEdit: (item: InboxItem | null) => void;
  /** Fokus auf die Zeile davor (−1) oder danach (+1) */
  onMove: (item: InboxItem, delta: -1 | 1) => void;
}

/** Was „Annehmen“ ohne Bearbeiten heißt */
function acceptLabel(item: InboxItem): string {
  return item.kind === 'concept_merge' ? 'Zusammenführen' : 'Annehmen';
}

function title(item: InboxItem, names: ReadonlyMap<string, string>): string {
  if (item.payload.kind === 'relation') return relationText(item, names);
  return item.payload.proposal.name;
}

/** Ein Vorschlag: Typ-Symbol, Kurzbeschreibung, ✦, Quellen-Chips, Aktionen. Tasten → ← E, ↑ ↓ wechseln die Zeile. */
export function InboxRow({
  item,
  names,
  pending,
  busy,
  editing,
  showSession = false,
  onAccept,
  onReject,
  onEdit,
  onMove,
}: InboxRowProps) {
  const payload = item.payload;
  const hint = blockedHint(item, names, pending);
  const blocked = item.blocked !== null;
  const heading = title(item, names);

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditableTarget(event.target) || editing) return;
    const key = event.key;
    if (key === 'ArrowRight') {
      event.preventDefault();
      if (!busy && !blocked) onAccept(item, {});
    } else if (key === 'ArrowLeft') {
      event.preventDefault();
      if (!busy) onReject(item);
    } else if (key === 'e' || key === 'E') {
      event.preventDefault();
      if (!blocked) onEdit(item);
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      onMove(item, key === 'ArrowDown' ? 1 : -1);
    }
  }

  return (
    <li
      tabIndex={0}
      data-inbox-item={item.id}
      data-kind={item.kind}
      data-blocked={blocked ? 'true' : undefined}
      aria-label={`${INBOX_KIND_LABELS[item.kind]}: ${heading}`}
      aria-keyshortcuts="ArrowRight ArrowLeft E"
      onKeyDown={onKeyDown}
      className="relative flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-md px-2 py-3"
    >
      <div className={`min-w-0 flex-1 basis-72 ${blocked ? 'opacity-60' : ''}`}>
        <p className="break-words">
          <span aria-hidden="true" className="mr-2 inline-block w-4 text-center text-text-muted">
            {INBOX_KIND_SYMBOLS[item.kind]}
          </span>
          {payload.kind === 'relation' ? (
            <span>{heading}</span>
          ) : (
            <span className="font-medium">{heading}</span>
          )}
          {payload.kind === 'concept_merge' ? (
            <span>
              {' – gleich wie '}
              <Link href={conceptHref(payload.target.concept_id)} className="underline underline-offset-2">
                {payload.target.name}
              </Link>
              ?
            </span>
          ) : null}
          <span aria-hidden="true" title="Vorschlag der KI" className="ml-2 text-text-muted">
            ✦
          </span>
          <span className="sr-only"> (Vorschlag der KI)</span>
          {payload.kind !== 'relation' && payload.proposal.exam_hint ? (
            <span className="ml-2 rounded-sm border border-border px-1 text-xs text-text-muted">Klausur</span>
          ) : null}
        </p>
        {payload.kind === 'relation' ? (
          <p className="mt-1 break-words text-sm text-text-muted">{payload.why}</p>
        ) : payload.proposal.one_liner ? (
          <p className="mt-1 break-words text-sm text-text-muted">{payload.proposal.one_liner}</p>
        ) : null}
        {payload.kind === 'concept_merge' && payload.reason ? (
          <p className="mt-1 break-words text-sm text-text-muted">{payload.reason}</p>
        ) : null}
        {hint ? (
          <p data-testid="inbox-blocked" className="mt-1 text-sm text-text-muted">
            {hint}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {payload.kind !== 'relation' ? (
            <SourceChips sources={payload.evidence} label={`Quellen zu ${heading}`} />
          ) : null}
          {showSession ? (
            <span className="text-xs text-text-muted">{sessionRefLabel(item.session)}</span>
          ) : null}
        </div>
      </div>
      {editing ? null : (
        <div className="flex flex-wrap gap-2" role="group" aria-label={`Entscheidung für ${heading}`}>
          <button
            type="button"
            className={button}
            aria-disabled={busy || blocked}
            onClick={() => {
              if (!busy && !blocked) onAccept(item, {});
            }}
          >
            {acceptLabel(item)}
          </button>
          <button
            type="button"
            className={button}
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onReject(item);
            }}
          >
            Verwerfen
          </button>
          {item.kind === 'concept_merge' ? (
            <button
              type="button"
              className={button}
              aria-disabled={busy}
              onClick={() => {
                if (!busy) onAccept(item, { as_new: true });
              }}
            >
              Als neues Konzept
            </button>
          ) : null}
          <button
            type="button"
            className={button}
            aria-disabled={blocked}
            aria-expanded={false}
            onClick={() => {
              if (!blocked) onEdit(item);
            }}
          >
            Bearbeiten
          </button>
        </div>
      )}
      {editing ? (
        <InboxEdit
          item={item}
          names={names}
          busy={busy}
          onAccept={(request) => onAccept(item, request)}
          onCancel={() => onEdit(null)}
        />
      ) : null}
    </li>
  );
}
