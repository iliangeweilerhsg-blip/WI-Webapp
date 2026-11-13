'use client';

// Vorschläge in der Inbox (VERTRAEGE §20.10, 07 §3.11, F-NAC-06): Gruppen je Vorlesung, Annehmen und Verwerfen mit
// Tasten, Bearbeiten in der Zeile, „Alle annehmen“ mit Rückgängig (R15), ältere Einträge gesammelt. Keine Dialoge.
import Link from 'next/link';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InboxAcceptRequest, InboxItem, InboxKind, SessionRef } from '@sg/shared';
import { conceptKey, fetchConcept, sessionRefLabel } from '../../lib/concepts.ts';
import {
  INBOX_KIND_FILTERS,
  INBOX_OPEN_CAP,
  UNDO_MS,
  acceptItem,
  applyDecided,
  bulkInChunks,
  bulkTarget,
  conceptNames,
  errorCode,
  errorDetail,
  inboxErrorMessage,
  isConceptItem,
  isOlder,
  olderLabel,
  pendingConcepts,
  refreshInbox,
  rejectItem,
  reopenItem,
  undoBulk,
  unknownEndpoints,
  useInboxOverview,
  useOpenInboxItems,
  isCardBatch,
  type CardBatchItem,
  type ConceptInboxItem,
} from '../../lib/inbox.ts';
import { useToast } from '../../lib/toast.tsx';
import { rueckblickHref } from '../../lib/transcript.ts';
import { CoreHint } from '../CoreHint.tsx';
import { cardsCount } from '../../lib/cards.ts';
import { CardBatchRow } from './CardBatchRow.tsx';
import { InboxRow } from './InboxRow.tsx';

const button =
  'min-h-9 rounded-md border border-border px-3 py-1 text-sm hover:bg-surface aria-disabled:opacity-50 sg-transition';

interface Group {
  key: string;
  session: SessionRef | null;
  items: InboxItem[];
  /** Offene Einträge der Session laut Übersicht (auch ältere und ausgefilterte) */
  openCount: number;
}

/** Gruppen in der Reihenfolge der Übersicht (neueste Session zuerst), Einträge ohne Session als eigene Gruppe */
function groupItems(
  items: readonly InboxItem[],
  order: readonly { session: SessionRef | null; open_count: number }[],
): Group[] {
  const groups = new Map<string, Group>();
  for (const entry of order) {
    const key = entry.session?.id ?? '';
    groups.set(key, { key, session: entry.session, items: [], openCount: entry.open_count });
  }
  for (const item of items) {
    const key = item.session?.id ?? '';
    const group = groups.get(key) ?? { key, session: item.session, items: [], openCount: -1 };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.items.length > 0);
}

function acceptedMessage(
  item: InboxItem,
  request: InboxAcceptRequest,
  names: ReadonlyMap<string, string>,
): string {
  if (item.payload.kind === 'card_batch') {
    const dropped = new Set(request.cards?.filter((c) => !c.accept).map((c) => c.key));
    return `${cardsCount(item.payload.cards.length - dropped.size)} angenommen`;
  }
  if (item.payload.kind === 'relation') return 'Beziehung bestätigt';
  const name = request.edit?.name ?? item.payload.proposal.name;
  const merges =
    request.merge_into !== undefined || (item.payload.kind === 'concept_merge' && !request.as_new);
  if (!merges) return `„${name}“ angenommen`;
  const targetId =
    request.merge_into ?? (item.payload.kind === 'concept_merge' ? item.payload.target.concept_id : '');
  const target = names.get(targetId);
  return target ? `Mit „${target}“ zusammengeführt` : 'Zusammengeführt';
}

export function SuggestionInbox() {
  const client = useQueryClient();
  const toast = useToast();
  const overview = useInboxOverview();
  const open = useOpenInboxItems();
  const [filter, setFilter] = useState<InboxKind | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [focusAfter, setFocusAfter] = useState<{ next: string | null } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  // Ein fester Zeitpunkt je Besuch: Die Grenze „älter als 14 Tage“ wandert nicht während des Entscheidens
  const [now] = useState(() => Date.now());

  const all = open.data;
  const items = useMemo(() => all ?? [], [all]);

  // Namen der Endpunkte von Beziehungen: aus den offenen Einträgen, sonst aus dem Konzept selbst
  const itemNames = useMemo(() => conceptNames(items), [items]);
  const missing = useMemo(() => unknownEndpoints(items, itemNames), [items, itemNames]);
  const lookups = useQueries({
    queries: missing.map((id) => ({
      queryKey: conceptKey(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchConcept(id, signal),
      retry: false,
    })),
  });
  const lookupNames = lookups.map((q) => q.data?.concept.name ?? '').join('\u0000');
  const names = useMemo(() => {
    const map = new Map(itemNames);
    lookupNames.split('\u0000').forEach((name, i) => {
      const id = missing[i];
      if (id && name) map.set(id, name);
    });
    return map;
  }, [itemNames, missing, lookupNames]);
  const pending = useMemo(() => pendingConcepts(items), [items]);

  const shown = useMemo(() => (filter ? items.filter((i) => i.kind === filter) : items), [items, filter]);
  const recent = useMemo(() => shown.filter((i) => !isOlder(i, now)), [shown, now]);
  const older = useMemo(() => shown.filter((i) => isOlder(i, now)), [shown, now]);
  const groups = useMemo(() => groupItems(recent, overview.data?.sessions ?? []), [recent, overview.data]);

  // Nach einer Entscheidung: Fokus auf den nächsten Vorschlag, sonst auf die Überschrift
  useEffect(() => {
    if (!focusAfter || !all) return;
    const next = focusAfter.next;
    const row =
      next !== null ? container.current?.querySelector<HTMLElement>(`[data-inbox-item="${next}"]`) : null;
    if (row) row.focus();
    else document.getElementById('inbox-suggestions-title')?.focus();
    setFocusAfter(null);
  }, [focusAfter, all]);

  const rowIds = useCallback(
    () =>
      [...(container.current?.querySelectorAll<HTMLElement>('[data-inbox-item]') ?? [])].map(
        (el) => el.dataset.inboxItem ?? '',
      ),
    [],
  );

  function moveFocus(item: InboxItem, delta: -1 | 1) {
    const ids = rowIds();
    const next = ids[ids.indexOf(item.id) + delta];
    if (next) container.current?.querySelector<HTMLElement>(`[data-inbox-item="${next}"]`)?.focus();
  }

  function focusNextAfter(id: string) {
    const ids = rowIds();
    const at = ids.indexOf(id);
    setFocusAfter({ next: ids[at + 1] ?? ids[at - 1] ?? null });
  }

  const setItemBusy = (id: string, on: boolean) =>
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  function showUndo(message: string, id: string) {
    toast.show({
      message,
      actionLabel: 'Rückgängig',
      durationMs: UNDO_MS,
      onAction: () => {
        reopenItem(id)
          .then(() => refreshInbox(client))
          .catch((error: unknown) => toast.show({ message: inboxErrorMessage(error, names) }));
      },
    });
  }

  async function decide(item: InboxItem, request: InboxAcceptRequest | null) {
    if (busy.has(item.id)) return;
    setItemBusy(item.id, true);
    try {
      const result = request ? await acceptItem(item.id, request) : await rejectItem(item.id);
      focusNextAfter(item.id);
      setEditing((current) => (current === item.id ? null : current));
      // Mitentschiedene Folge-Einträge (`also_changed`) verschwinden sofort mit, wie bei der Massenaktion
      applyDecided(client, [item.id, ...result.also_changed]);
      showUndo(request ? acceptedMessage(item, request, names) : 'Verworfen', item.id);
    } catch (error) {
      const code = errorCode(error);
      const existing = errorDetail(error, 'concept_id');
      if (code === 'concept_exists' && existing && isConceptItem(item) && item.payload.kind !== 'relation') {
        // Kein Dialog: Der Toast bietet das Zusammenführen mit dem vorhandenen Konzept an (§20.10)
        const name = request?.edit?.name ?? item.payload.proposal.name;
        toast.show({
          message: `„${name}“ gibt es schon.`,
          actionLabel: 'Zusammenführen',
          durationMs: UNDO_MS,
          focusAction: true,
          onAction: () => void decide(item, { merge_into: existing }),
        });
      } else {
        if (code === 'inbox_item_decided' || code === 'inbox_item_not_found') refreshInbox(client);
        toast.show({ message: inboxErrorMessage(error, names) });
      }
    } finally {
      setItemBusy(item.id, false);
    }
  }

  async function acceptAll(group: Group) {
    if (bulkBusy || group.items.length === 0) return;
    setBulkBusy(true);
    try {
      const target = bulkTarget(group.items, group.session?.id ?? null, group.openCount);
      const result = await bulkInChunks({ action: 'accept', ...target });
      applyDecided(client, result.decided);
      document.getElementById('inbox-suggestions-title')?.focus();
      const left = result.skipped.length;
      const message = `${result.decided.length} angenommen${left > 0 ? ` · ${left} offen geblieben` : ''}`;
      if (result.decided.length === 0) {
        toast.show({
          message: left > 0 ? `Nichts angenommen · ${left} offen geblieben` : 'Nichts anzunehmen',
        });
        return;
      }
      toast.show({
        message,
        actionLabel: 'Rückgängig',
        durationMs: UNDO_MS,
        focusAction: true,
        onAction: () => {
          undoBulk(result.decided)
            .then((undone) => {
              refreshInbox(client);
              if (undone.skipped.length > 0) {
                toast.show({ message: `${undone.skipped.length} ließen sich nicht zurücknehmen.` });
              }
            })
            .catch((error: unknown) => toast.show({ message: inboxErrorMessage(error, names) }));
        },
      });
    } catch (error) {
      toast.show({ message: inboxErrorMessage(error, names) });
    } finally {
      setBulkBusy(false);
    }
  }

  const row = (item: InboxItem, showSession = false) =>
    isCardBatch(item) ? (
      <CardBatchRow
        key={item.id}
        item={item}
        busy={busy.has(item.id) || bulkBusy}
        showSession={showSession}
        onAccept={(target: CardBatchItem, request) => void decide(target, request)}
        onReject={(target: CardBatchItem) => void decide(target, null)}
        onMove={moveFocus}
      />
    ) : (
      <InboxRow
        key={item.id}
        item={item as ConceptInboxItem}
        names={names}
        pending={pending}
        busy={busy.has(item.id) || bulkBusy}
        editing={editing === item.id}
        showSession={showSession}
        onAccept={(target, request) => void decide(target, request)}
        onReject={(target) => void decide(target, null)}
        onEdit={(target) => {
          setEditing(target?.id ?? null);
          if (target === null) {
            container.current?.querySelector<HTMLElement>(`[data-inbox-item="${item.id}"]`)?.focus();
          }
        }}
        onMove={moveFocus}
      />
    );

  let body;
  if (open.isError) body = <CoreHint error={open.error} />;
  else if (!all) {
    body =
      open.running === true ? (
        <p role="status" className="text-md text-text-muted">
          Während der Vorlesung kommen hier keine neuen Vorschläge. Danach geht es weiter.
        </p>
      ) : (
        <p role="status" aria-busy="true" className="text-md text-text-muted">
          Lädt …
        </p>
      );
  } else if (items.length === 0) {
    body = (
      <p className="rounded-lg border border-dashed border-border-strong px-6 py-6 text-center text-md text-text-muted">
        Keine offenen Vorschläge. Nach einer Vorlesung stehen hier neue Konzepte, Beziehungen und Karten.
      </p>
    );
  } else {
    body = (
      <>
        {open.running === true ? (
          <p role="status" className="mb-3 text-sm text-text-muted">
            Während der Vorlesung kommen keine neuen Vorschläge dazu.
          </p>
        ) : null}
        {items.length >= INBOX_OPEN_CAP ? (
          <p data-testid="inbox-capped" className="mb-3 text-sm text-text-muted">
            Es stehen nur die ersten {INBOX_OPEN_CAP} offenen Vorschläge da. Entscheide sie, dann kommen
            weitere.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Nach Art filtern">
          <button
            type="button"
            className={button}
            aria-pressed={filter === null}
            onClick={() => setFilter(null)}
          >
            Alle
          </button>
          {INBOX_KIND_FILTERS.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              className={button}
              aria-pressed={filter === entry.kind}
              onClick={() => setFilter(entry.kind)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Tasten in der Zeile: → annehmen · ← verwerfen · E bearbeiten · ↑ ↓ wechseln
        </p>
        {shown.length === 0 ? (
          <p className="mt-4 text-md text-text-muted">Keine Vorschläge dieser Art.</p>
        ) : null}
        <div className="mt-4 space-y-6">
          {groups.map((group) => {
            const headingId = `inbox-group-${group.key || 'ohne'}`;
            const label = sessionRefLabel(group.session);
            return (
              <section key={group.key} aria-labelledby={headingId} data-inbox-group={group.key || 'ohne'}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id={headingId} className="flex items-center gap-2 text-sm font-medium text-text-muted">
                    {group.session ? (
                      <Link
                        href={rueckblickHref(group.session.id)}
                        className="hover:text-text hover:underline"
                      >
                        {label}
                      </Link>
                    ) : (
                      <span>{label}</span>
                    )}
                    <span className="tabular-nums">{group.items.length}</span>
                  </h3>
                  <button
                    type="button"
                    className={button}
                    aria-disabled={bulkBusy}
                    aria-label={`Alle annehmen: ${label}`}
                    onClick={() => void acceptAll(group)}
                  >
                    Alle annehmen
                  </button>
                </div>
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border px-2">
                  {group.items.map((item) => row(item))}
                </ul>
              </section>
            );
          })}
          {older.length > 0 ? (
            <details data-testid="inbox-older" className="rounded-lg border border-border px-2">
              <summary className="cursor-pointer px-2 py-3 text-sm text-text-muted">
                {olderLabel(older.length)}
              </summary>
              <ul className="divide-y divide-border border-t border-border">
                {older.map((item) => row(item, true))}
              </ul>
            </details>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <section aria-labelledby="inbox-suggestions-title">
      <h2 id="inbox-suggestions-title" tabIndex={-1} className="text-lg font-medium focus:outline-none">
        Vorschläge
      </h2>
      <div ref={container} className="mt-3">
        {body}
      </div>
    </section>
  );
}
