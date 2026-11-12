'use client';

// Suche (⌘K, 07 §3.12, VERTRAEGE §19.7): Overlay mit Eingabe, Treffern in den Gruppen „Folien“, „Gesagtes“ und „Konzepte“ und
// Tastatursteuerung. Mittig, 640 px breit, schmal volle Breite mit 16 px Rand. Im Live-Dashboard (`/session`) liegt es
// über der Notizen-Spalte, die Folie bleibt sichtbar (F-DSH-07).
import { useRouter, usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ConceptListItem, SearchHit } from '@sg/shared';
import {
  JUMP_EVENT,
  conceptHitHref,
  conceptModulesLabel,
  MAX_QUERY_LENGTH,
  degradedLine,
  flatHits,
  formatMmSs,
  groupHits,
  hitHref,
  sessionLabel,
  slideLabel,
} from '../../lib/search.ts';
import { isMacPlatform, matchShortcut } from '../../lib/shortcuts.ts';
import { Icon } from '../Icon.tsx';
import { Snippet } from './Snippet.tsx';
import { useSearch } from './use-search.ts';

/** Eine auswählbare Zeile: Folie oder Gesagtes (aus `/search`) oder Konzept (aus `/concepts`, UX-309) */
type Row = { type: 'hit'; hit: SearchHit } | { type: 'concept'; item: ConceptListItem };

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Notizen-Spalte des Live-Dashboards (`data-column="notizen"`), solange sie sichtbar ist */
function notesRect(): Rect | null {
  const el = document.querySelector<HTMLElement>('[data-column="notizen"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
}

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <Overlay onClose={onClose} /> : null;
}

function Overlay({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const onSession = /^\/session\/?$/.test(pathname);
  const uid = useId();
  const listId = `${uid}-liste`;
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const { response, concepts, failed, slow } = useSearch(query);
  const [rect, setRect] = useState<Rect | null>(null);
  const mac = useMemo(() => isMacPlatform(), []);

  // Fokus ins Feld, beim Schließen zurück auf das vorherige Element
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus?.();
    };
  }, []);

  // Auf dem Live-Dashboard über der Notizen-Spalte, sonst mittig über der ganzen Seite
  useLayoutEffect(() => {
    if (!onSession) {
      setRect(null);
      return;
    }
    const measure = () =>
      setRect((old) => {
        const next = notesRect();
        const same =
          old === next ||
          (old &&
            next &&
            old.left === next.left &&
            old.top === next.top &&
            old.width === next.width &&
            old.height === next.height);
        return same ? old : next;
      });
    measure();
    window.addEventListener('resize', measure);
    // Layoutwechsel, Trennlinie ziehen, Seitenleiste, später erscheinende Zeilen: Spalte und Container beobachten
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      const el = document.querySelector('[data-column="notizen"]');
      if (el) observer.observe(el);
      if (el?.parentElement) observer.observe(el.parentElement);
      observer.observe(document.body);
    }
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [onSession]);

  // Fokus verlässt den Dialog nie (sonst erreichen Tasten das Dashboard dahinter)
  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      if (dialogRef.current && e.target instanceof Node && !dialogRef.current.contains(e.target)) {
        inputRef.current?.focus();
      }
    }
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  const groups = useMemo(() => (response ? groupHits(response.hits) : null), [response]);
  const hits = useMemo<Row[]>(
    () => [
      ...(groups ? flatHits(groups) : []).map((hit): Row => ({ type: 'hit', hit })),
      ...concepts.map((item): Row => ({ type: 'concept', item })),
    ],
    [groups, concepts],
  );
  useEffect(() => setActive(0), [response, concepts]);

  const optionId = (i: number) => `${uid}-opt-${i}`;
  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  }, [active, hits]);

  const openHit = useCallback(
    (row: Row, newTab: boolean) => {
      const href = row.type === 'concept' ? conceptHitHref(row.item) : hitHref(row.hit);
      const hit = row.type === 'hit' ? row.hit : null;
      // Läuft eine Session, bleibt die Aufnahme ungestört: immer in einem neuen Tab (§19.7)
      if (newTab || onSession) {
        window.open(href, '_blank', 'noopener');
        return;
      }
      onClose();
      // Steht der Rückblick schon auf genau diesem Ziel, ändert ein Push nichts: der Sprung geht per Ereignis
      if (hit?.kind === 'transcript' && href === window.location.pathname + window.location.search) {
        window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { t: hit.t_ms } }));
        return;
      }
      router.push(href);
    },
    [onSession, onClose, router],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    // Tasten gehören dem Overlay: Dashboard und Seite dahinter bekommen sie nicht (außer ⌘/Strg+K zum Umschalten)
    if (matchShortcut(e.nativeEvent, mac) !== 'search') e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      // Fokusfalle: Tab wandert zwischen Eingabefeld und Schließen-Knopf
      const items = dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not([disabled])');
      const first = items?.[0];
      const last = items?.[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (e.target !== inputRef.current) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      const row = hits[active];
      if (!row) return;
      e.preventDefault();
      openHit(row, e.metaKey || e.ctrlKey);
    }
  }

  const trimmed = query.trim();
  const unresolved = response?.filters.unresolved ?? [];
  const degraded = response ? degradedLine(response) : null;
  const empty = trimmed === '';
  const noHits = !empty && !failed && response !== null && hits.length === 0;
  const slideRows = groups?.slides ?? [];
  const spokenRows = groups?.spoken ?? [];

  let index = 0;
  const renderConcept = (item: ConceptListItem) => {
    const i = index++;
    const selected = i === active;
    const modules = conceptModulesLabel(item);
    const detail = item.concept.one_liner?.trim();
    return (
      <div
        key={item.concept.id}
        id={optionId(i)}
        role="option"
        aria-selected={selected}
        data-kind="concept"
        onMouseMove={() => setActive(i)}
        onClick={(e) => openHit({ type: 'concept', item }, e.metaKey || e.ctrlKey)}
        className={`flex cursor-pointer items-start gap-3 rounded-md border-l-2 px-3 py-2 ${
          selected ? 'border-accent bg-accent-soft' : 'border-transparent'
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-2 text-sm">
            <span className="min-w-0 truncate font-medium">{item.concept.name}</span>
            {modules ? <span className="ml-auto shrink-0 text-xs text-text-muted">{modules}</span> : null}
          </p>
          {detail ? (
            <p className="mt-0.5 line-clamp-2 break-words text-sm text-text-muted">{detail}</p>
          ) : null}
        </div>
      </div>
    );
  };

  const renderRow = (hit: SearchHit) => {
    const i = index++;
    const selected = i === active;
    const moduleName = hit.module.short_name ?? hit.module.name;
    return (
      <div
        key={hit.chunk_id}
        id={optionId(i)}
        role="option"
        aria-selected={selected}
        data-kind={hit.kind}
        onMouseMove={() => setActive(i)}
        onClick={(e) => openHit({ type: 'hit', hit }, e.metaKey || e.ctrlKey)}
        className={`flex cursor-pointer items-start gap-3 rounded-md border-l-2 px-3 py-2 ${
          selected ? 'border-accent bg-accent-soft' : 'border-transparent'
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-2 text-sm">
            <span className="min-w-0 truncate font-medium">
              {hit.kind === 'slide' ? slideLabel(hit) : sessionLabel(hit)}
            </span>
            {hit.kind === 'transcript' ? (
              <span className="shrink-0 tabular-nums text-text-muted">{formatMmSs(hit.t_ms)}</span>
            ) : null}
            <span className="ml-auto shrink-0 text-xs text-text-muted">{moduleName}</span>
          </p>
          <p className="mt-0.5 line-clamp-2 break-words text-sm text-text-muted">
            <Snippet parts={hit.snippet} />
          </p>
        </div>
        {hit.kind === 'transcript' ? (
          <span aria-hidden="true" className="shrink-0 pt-0.5 text-sm text-text-muted">
            ▶
          </span>
        ) : null}
      </div>
    );
  };

  const modifier = mac ? '⌘' : 'Strg+';
  const containerStyle = rect
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : { inset: 0 };

  return (
    <div
      className="fixed inset-0 z-50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="absolute flex items-start justify-center bg-black/30 px-4 pt-[min(15vh,6rem)]"
        style={containerStyle}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Suche"
          onKeyDown={onKeyDown}
          onMouseDown={(e) => {
            // Klicks ins Leere des Dialogs nehmen dem Feld den Fokus nicht (sonst läge er auf <body>)
            if (!(e.target as HTMLElement).closest('input, button')) e.preventDefault();
          }}
          className="flex max-h-[min(34rem,calc(100dvh-8rem))] w-full max-w-[640px] flex-col rounded-lg border border-border bg-surface-raised shadow-lg"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <span aria-hidden="true" className="text-text-muted">
              <Icon name="search" />
            </span>
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-label="Suchbegriff"
              aria-expanded={hits.length > 0}
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={hits.length > 0 ? optionId(active) : undefined}
              autoComplete="off"
              spellCheck={false}
              maxLength={MAX_QUERY_LENGTH}
              placeholder="Folien, Gesagtes und Konzepte durchsuchen …"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-h-9 min-w-0 flex-1 bg-transparent text-md outline-none placeholder:text-text-muted [&::-webkit-search-cancel-button]:hidden"
            />
            <span role="status" className="shrink-0 text-xs text-text-muted">
              {slow ? 'Sucht …' : <kbd className="hidden sm:inline">Esc</kbd>}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" onMouseDown={(e) => e.preventDefault()}>
            {empty ? (
              <div className="px-3 py-2 text-sm text-text-muted">
                <p>Durchsucht Folien, Gesagtes und Konzepte aus deinen Vorlesungen.</p>
                <p className="mt-2">
                  Eingrenzen mit <code className="font-mono text-text">fach:DBS</code>,{' '}
                  <code className="font-mono text-text">typ:folie</code> oder{' '}
                  <code className="font-mono text-text">typ:gesagtes</code>.
                </p>
              </div>
            ) : null}
            {!empty && failed ? (
              <p role="status" className="px-3 py-2 text-sm text-text-muted">
                Suche gerade nicht erreichbar
              </p>
            ) : null}
            {!empty && !failed && response ? (
              <>
                {degraded ? (
                  <p role="status" className="px-3 pb-1 text-xs text-text-muted">
                    {degraded}
                  </p>
                ) : null}
                {unresolved.length > 0 ? (
                  <p role="status" className="px-3 py-2 text-sm text-text-muted">
                    {`Unbekannter Filter: ${unresolved.join(', ')}`}
                  </p>
                ) : null}
                {noHits && unresolved.length === 0 ? (
                  <p role="status" className="px-3 py-2 text-sm text-text-muted">
                    Nichts gefunden
                  </p>
                ) : null}
              </>
            ) : null}
            {!empty && !failed && response && hits.length > 0 ? (
              <div id={listId} role="listbox" aria-label="Treffer">
                {slideRows.length > 0 ? (
                  <div role="group" aria-labelledby={`${uid}-folien`}>
                    <div id={`${uid}-folien`} className="px-3 pb-1 pt-2 text-xs font-medium text-text-muted">
                      Folien
                    </div>
                    {slideRows.map(renderRow)}
                  </div>
                ) : null}
                {spokenRows.length > 0 ? (
                  <div role="group" aria-labelledby={`${uid}-gesagtes`}>
                    <div
                      id={`${uid}-gesagtes`}
                      className="px-3 pb-1 pt-2 text-xs font-medium text-text-muted"
                    >
                      Gesagtes
                    </div>
                    {spokenRows.map(renderRow)}
                  </div>
                ) : null}
                {concepts.length > 0 ? (
                  <div role="group" aria-labelledby={`${uid}-konzepte`}>
                    <div
                      id={`${uid}-konzepte`}
                      className="px-3 pb-1 pt-2 text-xs font-medium text-text-muted"
                    >
                      Konzepte
                    </div>
                    {concepts.map(renderConcept)}
                  </div>
                ) : null}
              </div>
            ) : (
              <div id={listId} role="listbox" aria-label="Treffer" hidden />
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs text-text-muted">
            <span className="hidden sm:inline">
              {onSession
                ? '↑↓ wählen · Enter öffnet in neuem Tab'
                : `↑↓ wählen · Enter öffnen · ${modifier}Enter neuer Tab`}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto min-h-8 rounded-md px-3 py-1 text-sm text-text hover:bg-surface"
            >
              Schließen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
