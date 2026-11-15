'use client';

// Karten verwalten `/lernen/karten` (VERTRAEGE §21.14, F-LRN-16 in schmaler Form): alle Karten mit Filtern, Suche und
// Massenaktionen. Die Filter stehen in der Adresse (teilbar, Zurück-Taste). Keine Gesamtzahl, kein Rückstand (LP9).
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { CardBulkAction, CardListItem } from '@sg/shared';
import {
  BULK_MAX,
  DEFAULT_FILTERS,
  KIND_OPTIONS,
  MAX_CARD_QUERY,
  ORIGIN_OPTIONS,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  bulkCards,
  bulkMessage,
  hasActiveFilter,
  isHardCard,
  updateCardFilters,
  useCardFilters,
  useCardList,
  type CardFilters,
} from '../../lib/card-list.ts';
import {
  CARDS_KEY,
  CARD_KIND_LABELS,
  REVIEW_KEY,
  cardErrorMessage,
  cardFrontText,
  cardStateText,
  restoreCard,
} from '../../lib/cards.ts';
import { conceptHref, useConceptDetail } from '../../lib/concepts.ts';
import { UNDO_MS } from '../../lib/inbox.ts';
import { useModules } from '../../lib/modules.ts';
import { isEditableTarget } from '../../lib/shortcuts.ts';
import { useToast } from '../../lib/toast.tsx';
import { CoreHint } from '../CoreHint.tsx';
import { EmptyState } from '../Placeholder.tsx';
import { CardFront } from './CardFace.tsx';
import { CardEditFields } from './CardEditFields.tsx';
import { CardMenu } from './CardMenu.tsx';
import { CardSourceChips } from './CardSourceChips.tsx';
import { useCardActions } from './use-card-actions.ts';

const SEARCH_DEBOUNCE_MS = 250;

const button =
  'inline-flex min-h-9 items-center rounded-md border border-border px-3 py-1 text-sm hover:bg-surface aria-disabled:opacity-50 sg-transition';
const fieldClass = 'mt-1 block min-h-9 w-full rounded-md border border-border-strong bg-bg px-2 py-1 text-md';

// ---------------------------------------------------------------------------------------------
// Filterleiste
// ---------------------------------------------------------------------------------------------

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-36 flex-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={fieldClass}>
        {children}
      </select>
    </div>
  );
}

function ConceptChip({ conceptId }: { conceptId: string }) {
  const detail = useConceptDetail(conceptId);
  const name = detail.data?.concept.name ?? 'Konzept';
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <span className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border-strong bg-surface-raised pl-3">
        <span className="break-words">Konzept: {name}</span>
        <button
          type="button"
          aria-label={`Konzept-Filter entfernen: ${name}`}
          className="min-h-9 min-w-9 rounded-md px-2 hover:bg-surface sg-transition"
          onClick={() => updateCardFilters({ concept_id: null })}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </span>
    </p>
  );
}

function FilterBar({ filters }: { filters: CardFilters }) {
  const searchId = useId();
  const modules = useModules();
  const [text, setText] = useState(filters.q);
  // Was zuletzt in die Adresse geschrieben wurde: Nur andere Änderungen (Zurück-Taste) setzen das Feld neu
  const written = useRef(filters.q);

  useEffect(() => {
    if (filters.q !== written.current) {
      written.current = filters.q;
      setText(filters.q);
    }
  }, [filters.q]);

  useEffect(() => {
    const q = text.trim();
    if (q === written.current) return;
    const timer = setTimeout(() => {
      written.current = q;
      updateCardFilters({ q }, 'replace');
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const moduleList = modules.data ?? [];
  const unknownModule = filters.module_id !== null && !moduleList.some((m) => m.id === filters.module_id);

  return (
    <form
      role="search"
      aria-label="Karten filtern"
      className="space-y-3"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="flex flex-wrap gap-3">
        <SelectField
          label="Fach"
          value={filters.module_id ?? ''}
          onChange={(value) => updateCardFilters({ module_id: value === '' ? null : value })}
        >
          <option value="">Alle Fächer</option>
          {unknownModule ? <option value={filters.module_id ?? ''}>Anderes Fach</option> : null}
          {moduleList.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Typ"
          value={filters.kind ?? ''}
          onChange={(value) =>
            updateCardFilters({ kind: KIND_OPTIONS.find((o) => o.value === value)?.value ?? null })
          }
        >
          <option value="">Alle Typen</option>
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Herkunft"
          value={filters.origin ?? ''}
          onChange={(value) =>
            updateCardFilters({ origin: ORIGIN_OPTIONS.find((o) => o.value === value)?.value ?? null })
          }
        >
          <option value="">Alle</option>
          {ORIGIN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Status"
          value={filters.status}
          onChange={(value) =>
            updateCardFilters({
              status: STATUS_OPTIONS.find((o) => o.value === value)?.value ?? DEFAULT_FILTERS.status,
            })
          }
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Sortierung"
          value={filters.sort}
          onChange={(value) =>
            updateCardFilters({
              sort: SORT_OPTIONS.find((o) => o.value === value)?.value ?? DEFAULT_FILTERS.sort,
            })
          }
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="max-w-md">
        <label htmlFor={searchId} className="block text-sm font-medium">
          Karten suchen
        </label>
        <input
          id={searchId}
          type="search"
          autoComplete="off"
          maxLength={MAX_CARD_QUERY}
          placeholder="Frage, Antwort oder Erklärung"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={fieldClass}
        />
      </div>
      {filters.concept_id ? <ConceptChip conceptId={filters.concept_id} /> : null}
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Zeile
// ---------------------------------------------------------------------------------------------

interface RowProps {
  item: CardListItem;
  selected: boolean;
  onToggle: (id: string) => void;
}

function CardListRow({ item, selected, onToggle }: RowProps) {
  const { card, concept, modules } = item;
  const actions = useCardActions();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const front = cardFrontText(card.content);
  const checkboxId = useId();

  function startEdit() {
    setError(null);
    setEditing(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (editing || isEditableTarget(event.target)) return;
    const own = event.target === event.currentTarget;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = [
        ...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[data-card-row]') ?? []),
      ];
      const next = rows[rows.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)];
      next?.focus();
    } else if (event.key === ' ' && own) {
      event.preventDefault();
      onToggle(card.id);
    } else if ((event.key === 'e' || event.key === 'E') && own) {
      event.preventDefault();
      startEdit();
    }
  }

  return (
    <li
      tabIndex={0}
      data-card-row={card.id}
      data-card-id={card.id}
      aria-label={`Karte: ${front}`}
      aria-keyshortcuts="ArrowUp ArrowDown Space E"
      onKeyDown={onKeyDown}
      className="flex items-start gap-3 rounded-md px-2 py-3"
    >
      <input
        id={checkboxId}
        type="checkbox"
        checked={selected}
        aria-label={`Karte auswählen: ${front}`}
        className="mt-1 size-5 shrink-0"
        onChange={() => onToggle(card.id)}
      />
      {editing ? (
        <div className="min-w-0 flex-1">
          <CardEditFields
            content={card.content}
            busy={actions.busy}
            error={error}
            onCancel={() => setEditing(false)}
            onSave={(content) => {
              void actions.saveContent(card, content).then((result) => {
                if (result.ok) setEditing(false);
                else setError(result.message);
              });
            }}
          />
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <div className="break-words">
              <CardFront content={card.content} compact />
              {card.origin === 'ki' ? (
                <>
                  <span aria-hidden="true" title="Vorschlag der KI" className="ml-2 text-text-muted">
                    ✦
                  </span>
                  <span className="sr-only"> (Vorschlag der KI)</span>
                </>
              ) : null}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
              <Link
                href={conceptHref(concept.id)}
                className="text-text underline-offset-2 hover:underline"
                data-testid="card-concept"
              >
                {concept.name}
              </Link>
              {modules.length > 0 ? (
                <span data-testid="card-modules">
                  {modules.map((m) => m.short_name ?? m.name).join(', ')}
                </span>
              ) : null}
              <span>{CARD_KIND_LABELS[card.content.kind]}</span>
              <span data-testid="card-state">
                {cardStateText(card)}
                {!card.suspended && isHardCard(card) ? <span data-testid="card-hard"> · schwer</span> : null}
              </span>
            </p>
            <div className="mt-2">
              <CardSourceChips sources={card.sources} label="Quellen dieser Karte" />
            </div>
          </div>
          <CardMenu
            suspended={card.suspended}
            label={front}
            busy={actions.busy}
            onEdit={startEdit}
            onToggleSuspended={() => void actions.setSuspended(card, !card.suspended)}
            onDelete={() => void actions.remove(card)}
          />
        </>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Seite
// ---------------------------------------------------------------------------------------------

const BULK_ACTIONS: readonly { action: CardBulkAction; label: string }[] = [
  { action: 'suspend', label: 'Pausieren' },
  { action: 'resume', label: 'Fortsetzen' },
  { action: 'delete', label: 'Löschen' },
];

export function CardManager() {
  const filters = useCardFilters();
  const query = useCardList(filters);
  const client = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const selectAllId = useId();

  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  // Andere Filter, andere Karten: die Auswahl gehört zu dem, was gerade zu sehen ist
  useEffect(() => {
    setSelected((current) => {
      const present = new Set(items.map((i) => i.card.id));
      const kept = [...current].filter((id) => present.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [items]);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: CARDS_KEY });
    void client.invalidateQueries({ queryKey: REVIEW_KEY });
  };

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectable = items.slice(0, BULK_MAX);
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.card.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.map((i) => i.card.id)));
  }

  async function runBulk(action: CardBulkAction) {
    if (bulkBusy || selected.size === 0) return;
    setBulkBusy(true);
    try {
      const result = await bulkCards([...selected], action);
      setSelected(new Set());
      refresh();
      const message = bulkMessage(action, result);
      if (action === 'delete' && result.changed.length > 0) {
        const ids = result.changed;
        toast.show({
          message,
          actionLabel: 'Rückgängig',
          durationMs: UNDO_MS,
          focusAction: true,
          onAction: () => {
            void Promise.allSettled(ids.map((id) => restoreCard(id))).then((results) => {
              refresh();
              const failed = results.find((r) => r.status === 'rejected');
              if (failed && failed.status === 'rejected') {
                toast.show({ message: cardErrorMessage(failed.reason) });
              }
            });
          },
        });
      } else {
        toast.show({ message });
      }
    } catch (error) {
      toast.show({ message: cardErrorMessage(error) });
    } finally {
      setBulkBusy(false);
    }
  }

  let body;
  if (query.isError && !query.data) body = <CoreHint error={query.error} />;
  else if (!query.data) {
    body = (
      <p role="status" aria-busy="true" className="text-md text-text-muted">
        Lädt …
      </p>
    );
  } else if (items.length === 0) {
    body = hasActiveFilter(filters) ? (
      <EmptyState
        action={
          <button
            type="button"
            className={button}
            onClick={() =>
              updateCardFilters({
                module_id: null,
                concept_id: null,
                kind: null,
                origin: null,
                status: 'alle',
                q: '',
              })
            }
          >
            Filter zurücksetzen
          </button>
        }
      >
        Keine Karten für diese Filter.
      </EmptyState>
    ) : (
      <EmptyState
        action={
          <Link href="/inbox" className={button}>
            Zur Inbox
          </Link>
        }
      >
        Noch keine Karten. Sie entstehen als Vorschlag nach einer Vorlesung oder von Hand in der
        Konzeptansicht.
      </EmptyState>
    );
  } else {
    body = (
      <>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-h-9 items-center gap-2">
            <input
              id={selectAllId}
              type="checkbox"
              className="size-5"
              checked={allSelected}
              onChange={toggleAll}
            />
            <label htmlFor={selectAllId} className="text-sm">
              Alle auf dieser Seite
            </label>
          </div>
          {selected.size > 0 ? (
            <div role="toolbar" aria-label="Auswahl" className="flex flex-wrap items-center gap-2">
              <span data-testid="selection-count" role="status" className="text-sm text-text-muted">
                {selected.size} ausgewählt
              </span>
              {BULK_ACTIONS.map(({ action, label }) => (
                <button
                  key={action}
                  type="button"
                  className={button}
                  aria-disabled={bulkBusy}
                  onClick={() => void runBulk(action)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {items.length > BULK_MAX ? (
          <p className="mt-1 text-xs text-text-muted">Eine Auswahl umfasst höchstens {BULK_MAX} Karten.</p>
        ) : null}
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border px-2">
          {items.map((item) => (
            <CardListRow
              key={item.card.id}
              item={item}
              selected={selected.has(item.card.id)}
              onToggle={toggle}
            />
          ))}
        </ul>
        {query.isError ? (
          <p role="status" className="mt-3 text-sm text-text-muted">
            Weitere Karten lassen sich gerade nicht laden.
          </p>
        ) : null}
        {query.hasNextPage ? (
          <div className="mt-4">
            <button
              type="button"
              className={button}
              aria-disabled={query.isFetchingNextPage}
              onClick={() => {
                if (!query.isFetchingNextPage) void query.fetchNextPage();
              }}
            >
              {query.isFetchingNextPage ? 'Lädt …' : 'Mehr laden'}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby="screen-title" className="mx-auto max-w-4xl">
      <h1 id="screen-title" tabIndex={-1} className="text-xxl font-semibold focus:outline-none">
        Karten verwalten
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        <Link href="/lernen" className="underline-offset-2 hover:text-text hover:underline">
          Zurück zu Lernen
        </Link>
        <span aria-hidden="true"> · </span>
        Pfeiltasten wählen eine Zeile, Leertaste markiert, E bearbeitet.
      </p>
      <div className="mt-5">
        <FilterBar filters={filters} />
      </div>
      <div className="mt-6">{body}</div>
    </section>
  );
}
