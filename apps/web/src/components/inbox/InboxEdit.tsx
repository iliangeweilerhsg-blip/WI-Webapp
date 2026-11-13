'use client';

// Bearbeiten in der Zeile (§20.10, Taste E): Name, Aliase, One-Liner und Art, bei Beziehungen die Art der Beziehung.
// Kein Dialog. Das Ziel zum Zusammenführen kommt aus einer Konzeptsuche (`GET /concepts?q`).
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { ConceptEdit, ConceptKind, ConceptRelationKind, InboxAcceptRequest } from '@sg/shared';
import {
  CONCEPT_KINDS,
  KIND_LABELS,
  MAX_CONCEPT_QUERY,
  RELATION_KINDS,
  relationSentence,
  useConcepts,
} from '../../lib/concepts.ts';
import { parseAliases, type ConceptInboxItem as InboxItem } from '../../lib/inbox.ts';

const input =
  'mt-1 w-full rounded-md border border-border-strong bg-bg px-3 py-2 text-md aria-[invalid=true]:border-2 aria-[invalid=true]:border-text';
const button =
  'min-h-9 rounded-md border border-border px-3 py-1 text-sm hover:bg-surface aria-disabled:opacity-50 sg-transition';
const primary =
  'min-h-9 rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-contrast aria-disabled:opacity-50';

const SEARCH_DEBOUNCE_MS = 150;

export interface InboxEditProps {
  item: InboxItem;
  names: ReadonlyMap<string, string>;
  busy: boolean;
  onAccept: (request: InboxAcceptRequest) => void;
  onCancel: () => void;
}

/** Nur die geänderten Felder (§20.6 A1: `edit`) */
export function conceptEdit(
  before: { name: string; aliases: readonly string[]; one_liner: string | null; kind: ConceptKind | null },
  after: { name: string; aliases: string; oneLiner: string; kind: ConceptKind | '' },
): ConceptEdit {
  const edit: ConceptEdit = {};
  const name = after.name.trim().replace(/\s+/g, ' ');
  if (name !== before.name) edit.name = name;
  const aliases = parseAliases(after.aliases);
  if (JSON.stringify(aliases) !== JSON.stringify(before.aliases)) edit.aliases = aliases;
  const oneLiner = after.oneLiner.trim() === '' ? null : after.oneLiner.trim();
  if (oneLiner !== before.one_liner) edit.one_liner = oneLiner;
  const kind = after.kind === '' ? null : after.kind;
  if (kind !== before.kind) edit.kind = kind;
  return edit;
}

function TargetSearch({
  excludeId,
  busy,
  onChoose,
}: {
  excludeId: string | null;
  busy: boolean;
  onChoose: (id: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const results = useConcepts({ q, status: 'aktiv', limit: 8 }, { enabled: q !== '' });
  const hits = (results.data ?? []).filter((hit) => hit.concept.id !== excludeId);
  return (
    <div className="min-w-0 sm:col-span-2">
      <label htmlFor={id} className="block text-sm font-medium">
        Stattdessen zusammenführen mit
      </label>
      <input
        id={id}
        type="search"
        autoComplete="off"
        maxLength={MAX_CONCEPT_QUERY}
        placeholder="Konzept suchen"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className={input}
      />
      {q !== '' ? (
        <div aria-live="polite" className="mt-2">
          {results.isError ? (
            <p className="text-sm text-text-muted">Die Suche ist gerade nicht erreichbar.</p>
          ) : !results.data ? (
            <p className="text-sm text-text-muted">Sucht …</p>
          ) : hits.length === 0 ? (
            <p className="text-sm text-text-muted">Kein Konzept gefunden.</p>
          ) : (
            <ul aria-label="Gefundene Konzepte" className="flex flex-wrap gap-2">
              {hits.map((hit) => (
                <li key={hit.concept.id}>
                  <button
                    type="button"
                    className={button}
                    aria-disabled={busy}
                    aria-label={`Mit ${hit.concept.name} zusammenführen`}
                    onClick={() => {
                      if (!busy) onChoose(hit.concept.id);
                    }}
                  >
                    {hit.concept.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function InboxEdit({ item, names, busy, onAccept, onCancel }: InboxEditProps) {
  const base = useId();
  const first = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);

  const payload = item.payload;
  const proposal = payload.kind === 'relation' ? null : payload.proposal;
  const [name, setName] = useState(proposal?.name ?? '');
  const [aliases, setAliases] = useState(proposal?.aliases.join(', ') ?? '');
  const [oneLiner, setOneLiner] = useState(proposal?.one_liner ?? '');
  const [kind, setKind] = useState<ConceptKind | ''>(proposal?.kind ?? '');
  const [relationKind, setRelationKind] = useState<ConceptRelationKind>(
    payload.kind === 'relation' ? payload.relation_kind : 'verwandt',
  );
  const nameMissing = proposal !== null && name.trim() === '';

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || nameMissing) return;
    if (payload.kind === 'relation') {
      onAccept(relationKind === payload.relation_kind ? {} : { relation_kind: relationKind });
      return;
    }
    const edit = conceptEdit(payload.proposal, { name, aliases, oneLiner, kind });
    const withEdit = Object.keys(edit).length > 0 ? { edit } : {};
    onAccept(payload.kind === 'concept_merge' ? { ...withEdit, as_new: true } : withEdit);
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
      aria-label="Vorschlag bearbeiten"
      className="mt-3 basis-full rounded-md border border-border bg-surface p-3"
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {payload.kind === 'relation' ? (
          <div className="min-w-0 sm:col-span-2">
            <label htmlFor={`${base}-rel`} className="block text-sm font-medium">
              Art der Beziehung
            </label>
            <select
              id={`${base}-rel`}
              ref={(el) => {
                first.current = el;
              }}
              value={relationKind}
              onChange={(e) => setRelationKind(e.target.value as ConceptRelationKind)}
              className={input}
            >
              {RELATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {relationSentence(
                    k,
                    names.get(payload.from_concept_id) ?? 'A',
                    names.get(payload.to_concept_id) ?? 'B',
                  )}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div className="min-w-0">
              <label htmlFor={`${base}-name`} className="block text-sm font-medium">
                Name
              </label>
              <input
                id={`${base}-name`}
                ref={(el) => {
                  first.current = el;
                }}
                type="text"
                autoComplete="off"
                maxLength={200}
                aria-invalid={nameMissing ? true : undefined}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={input}
              />
              {nameMissing ? (
                <p className="mt-1 text-xs font-medium">Ein Konzept braucht einen Namen.</p>
              ) : null}
            </div>
            <div className="min-w-0">
              <label htmlFor={`${base}-kind`} className="block text-sm font-medium">
                Art
              </label>
              <select
                id={`${base}-kind`}
                value={kind}
                onChange={(e) => setKind(e.target.value as ConceptKind | '')}
                className={input}
              >
                <option value="">Keine Angabe</option>
                {CONCEPT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <label htmlFor={`${base}-aliases`} className="block text-sm font-medium">
                Aliase
              </label>
              <input
                id={`${base}-aliases`}
                type="text"
                autoComplete="off"
                aria-describedby={`${base}-aliases-hint`}
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                className={input}
              />
              <p id={`${base}-aliases-hint`} className="mt-1 text-xs text-text-muted">
                Weitere Namen, durch Komma getrennt.
              </p>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <label htmlFor={`${base}-one`} className="block text-sm font-medium">
                In einem Satz
              </label>
              <textarea
                id={`${base}-one`}
                rows={2}
                maxLength={500}
                value={oneLiner}
                onChange={(e) => setOneLiner(e.target.value)}
                className={input}
              />
            </div>
            <TargetSearch
              excludeId={item.concept_id}
              busy={busy}
              onChoose={(id) => onAccept({ merge_into: id })}
            />
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className={primary} aria-disabled={busy || nameMissing}>
          {payload.kind === 'concept_merge' ? 'Als neues Konzept annehmen' : 'Annehmen'}
        </button>
        <button type="button" className={button} onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
