'use client';

// Notizen-Spalte (F-DSH-04): zeigt die Seite des iPads live. Lädt Seiten und Striche per REST (VERTRAEGE §7.4),
// hält sie über den Sync-Strom `notebook:<id>` aktuell (§11.1) und sendet selbst nichts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Page, PageElement, Stroke, SyncOp } from '@sg/shared';
import { friendlyMessage } from '../../lib/api.ts';
import { fetchNotebookPages, fetchPageDetail, fetchPageStrokes, notebookStream } from '../../lib/ink.ts';
import type { SyncClient } from '../../lib/sync/client.ts';
import type { StreamPosition } from '../../lib/sync/types.ts';
import { InkPage } from './InkPage.tsx';

/** Was die Spalte vom Sync-Client braucht (der echte `SyncClient` passt). */
export type InkSyncSource = Pick<SyncClient, 'subscribe' | 'onEvent' | 'connectionState'>;

export interface InkColumnProps {
  notebookId: string;
  client: InkSyncSource;
  className?: string;
}

interface PageData {
  pageId: string;
  strokes: Map<string, Stroke>;
  elements: Map<string, PageElement>;
  /** `stream_seq` der REST-Stände: Operationen bis dahin sind schon enthalten */
  strokesSeq: number;
  elementsSeq: number;
}

interface Snapshot {
  seq: number;
  opId: string | null;
}

/** Wendet eine Seiten-Operation auf den Stand an. Gibt `true` zurück, wenn sich etwas geändert hat. */
function applyOp(data: PageData, op: SyncOp): boolean {
  const seq = op.seq ?? Number.POSITIVE_INFINITY;
  switch (op.kind) {
    case 'stroke.add':
      if (op.data.page_id !== data.pageId || seq <= data.strokesSeq) return false;
      data.strokes.set(op.data.stroke.client_id, op.data.stroke);
      return true;
    case 'stroke.remove': {
      if (op.data.page_id !== data.pageId || seq <= data.strokesSeq) return false;
      let changed = false;
      for (const id of op.data.client_ids) changed = data.strokes.delete(id) || changed;
      return changed;
    }
    case 'element.upsert':
      if (op.data.page_id !== data.pageId || seq <= data.elementsSeq) return false;
      data.elements.set(op.data.element.element_id, op.data.element);
      return true;
    case 'element.remove':
      if (op.data.page_id !== data.pageId || seq <= data.elementsSeq) return false;
      return data.elements.delete(op.data.element_id);
    default:
      return false;
  }
}

const PAGE_KINDS = new Set(['page.create', 'page.update', 'page.delete', 'page.restore']);

const navButton =
  'rounded-md border border-border px-2 py-1 text-sm hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent';

export function InkColumn({ notebookId, client, className }: InkColumnProps) {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);
  const [presencePage, setPresencePage] = useState<string | null>(null);
  const [ipadConnected, setIpadConnected] = useState<boolean | null>(null);
  const [syncState, setSyncState] = useState(client.connectionState);
  const [loadingPage, setLoadingPage] = useState(false);
  const [pageError, setPageError] = useState<unknown>(null);
  const [rev, setRev] = useState(0);

  const dataRef = useRef<PageData | null>(null);
  /** Ops, die während des Ladens einer Seite eintreffen */
  const bufferRef = useRef<{ pageId: string; ops: SyncOp[] } | null>(null);
  const snapshotRef = useRef<Snapshot>({ seq: 0, opId: null });
  const loadPagesRef = useRef<() => Promise<void>>(async () => undefined);
  const loadPageRef = useRef<(pageId: string) => Promise<void>>(async () => undefined);
  const currentPageRef = useRef<string | null>(null);
  const lastPresenceRef = useRef<string | null>(null);

  const effectivePageId = useMemo(() => {
    if (!pages || pages.length === 0) return null;
    const has = (id: string | null) => id !== null && pages.some((p) => p.id === id);
    if (following && has(presencePage)) return presencePage;
    if (has(selected)) return selected;
    return pages[pages.length - 1]!.id;
  }, [pages, selected, following, presencePage]);
  currentPageRef.current = effectivePageId;

  const keepSnapshot = useCallback((s: Snapshot) => {
    if (s.seq >= snapshotRef.current.seq) snapshotRef.current = s;
  }, []);

  // Seiten laden und den Strom abonnieren
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    dataRef.current = null;
    bufferRef.current = null;
    setPages(null);
    setSelected(null);
    setError(null);

    const loadPages = async (): Promise<void> => {
      try {
        const res = await fetchNotebookPages(notebookId);
        if (cancelled) return;
        setPages([...res.items].sort((a, b) => a.index - b.index));
        setError(null);
        keepSnapshot({ seq: res.stream_seq, opId: res.stream_op_id });
      } catch (e) {
        if (!cancelled) setError(e);
        throw e;
      }
    };
    loadPagesRef.current = () => loadPages().catch(() => undefined);

    const onOp = (op: SyncOp) => {
      if (PAGE_KINDS.has(op.kind)) {
        void loadPagesRef.current();
        return;
      }
      const buf = bufferRef.current;
      if (buf) {
        buf.ops.push(op);
        return;
      }
      const data = dataRef.current;
      if (data && applyOp(data, op)) setRev((r) => r + 1);
    };

    const start = async () => {
      snapshotRef.current = { seq: 0, opId: null };
      try {
        await loadPages();
      } catch {
        // Fehler steht im State; der Strom wird trotzdem abonniert (Position 0), damit nichts verloren geht
      }
      if (cancelled) return;
      const from: StreamPosition = { lastSeq: snapshotRef.current.seq, lastOpId: snapshotRef.current.opId };
      unsubscribe = client.subscribe(notebookStream(notebookId), from, onOp, {
        // Bei `reset` den REST-Stand neu laden und dessen Position melden (§11.1)
        onReset: async () => {
          snapshotRef.current = { seq: 0, opId: null };
          await loadPages();
          const id = currentPageRef.current;
          if (id) await loadPageRef.current(id);
          return { lastSeq: snapshotRef.current.seq, lastOpId: snapshotRef.current.opId };
        },
      });
    };
    void start();

    const offs = [
      client.onEvent('connection', (c) => {
        setSyncState(c.state);
        // Nach einem Verbindungsfehler beim Start (Core war nicht da) neu laden, sobald es wieder geht
        if (c.state === 'online') void loadPagesRef.current();
      }),
      client.onEvent('device.connection', (d) => {
        if (d.client === 'ipad') setIpadConnected(d.connected);
      }),
      client.onEvent('presence', (d) => {
        if (d.client !== 'ipad' || d.notebook_id !== notebookId || !d.page_id) return;
        setPresencePage(d.page_id);
        if (lastPresenceRef.current !== d.page_id) {
          lastPresenceRef.current = d.page_id;
          setFollowing(true); // „bis zum nächsten Seitenwechsel auf dem iPad“ (F-DSH-04)
        }
      }),
      client.onEvent('leader.changed', () => {
        void loadPagesRef.current();
        const id = currentPageRef.current;
        if (id) void loadPageRef.current(id);
      }),
    ];
    setSyncState(client.connectionState);

    return () => {
      cancelled = true;
      unsubscribe?.();
      for (const off of offs) off();
    };
  }, [notebookId, client, keepSnapshot]);

  // Strich- und Elementestand der angezeigten Seite laden
  useEffect(() => {
    const pageId = effectivePageId;
    if (!pageId) {
      dataRef.current = null;
      setRev((r) => r + 1);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    const load = async (id: string): Promise<void> => {
      bufferRef.current = { pageId: id, ops: [] };
      setLoadingPage(true);
      try {
        const [strokes, detail] = await Promise.all([
          fetchPageStrokes(id, controller.signal),
          fetchPageDetail(id, controller.signal),
        ]);
        if (cancelled) return;
        const data: PageData = {
          pageId: id,
          strokes: new Map(strokes.strokes.map((s) => [s.client_id, s])),
          elements: new Map(detail.elements.map((e) => [e.element_id, e])),
          strokesSeq: strokes.stream_seq,
          elementsSeq: detail.stream_seq,
        };
        // Der Stand mit der höheren `seq` ist der neuere Anker für das Abonnement
        keepSnapshot(
          strokes.stream_seq >= detail.stream_seq
            ? { seq: strokes.stream_seq, opId: strokes.stream_op_id }
            : { seq: detail.stream_seq, opId: detail.stream_op_id },
        );
        const buffered = bufferRef.current?.pageId === id ? bufferRef.current.ops : [];
        bufferRef.current = null;
        for (const op of buffered) applyOp(data, op);
        dataRef.current = data;
        setPageError(null);
        setRev((r) => r + 1);
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        bufferRef.current = null;
        setPageError(e);
        throw e;
      } finally {
        if (!cancelled) setLoadingPage(false);
      }
    };
    loadPageRef.current = (id) => load(id).catch(() => undefined);
    void loadPageRef.current(pageId);

    return () => {
      cancelled = true;
      controller.abort();
      if (bufferRef.current?.pageId === pageId) bufferRef.current = null;
    };
  }, [effectivePageId, keepSnapshot]);

  const strokes = useMemo(() => {
    void rev;
    const data = dataRef.current;
    if (!data || data.pageId !== effectivePageId) return [];
    // Stabil nach Entstehung sortieren (Server liefert so, Live-Operationen kommen meist schon in Reihenfolge)
    return [...data.strokes.values()].sort((a, b) => a.created_at - b.created_at);
  }, [rev, effectivePageId]);
  const elements = useMemo(() => {
    void rev;
    const data = dataRef.current;
    if (!data || data.pageId !== effectivePageId) return [];
    return [...data.elements.values()].sort((a, b) => a.z - b.z);
  }, [rev, effectivePageId]);

  const index = pages && effectivePageId ? pages.findIndex((p) => p.id === effectivePageId) : -1;
  const page = index >= 0 ? pages![index]! : null;
  const go = (delta: number) => {
    const next = pages?.[index + delta];
    if (!next) return;
    setSelected(next.id);
    setFollowing(false);
  };
  const followIpad = () => {
    setFollowing(true);
    setSelected(null);
  };

  const offline = ipadConnected === false;
  const noLive = syncState !== 'online' && syncState !== 'syncing';

  return (
    <section aria-label="Notizen" className={`flex min-h-0 flex-col gap-2 ${className ?? ''}`}>
      <header className="flex items-center gap-2 text-sm">
        <button
          type="button"
          className={navButton}
          aria-label="Vorherige Seite"
          disabled={index <= 0}
          onClick={() => go(-1)}
        >
          ‹
        </button>
        <span aria-live="polite" className="min-w-[5.5rem] text-center text-text-muted">
          {page && pages ? `Seite ${index + 1} von ${pages.length}` : 'Notizen'}
        </span>
        <button
          type="button"
          className={navButton}
          aria-label="Nächste Seite"
          disabled={!pages || index < 0 || index >= pages.length - 1}
          onClick={() => go(1)}
        >
          ›
        </button>
        {!following && presencePage ? (
          <button type="button" className={`${navButton} ml-auto`} onClick={followIpad}>
            Zur iPad-Seite
          </button>
        ) : null}
      </header>

      {offline || noLive ? (
        <p role="status" className="text-xs text-text-muted">
          {offline ? 'iPad nicht verbunden – letzter Stand' : 'Keine Live-Verbindung – letzter Stand'}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {error && !pages ? (
          <p role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
            {friendlyMessage(error)}
          </p>
        ) : pages === null ? (
          <p role="status" className="text-sm text-text-muted">
            Notizen werden geladen …
          </p>
        ) : pages.length === 0 ? (
          <p
            role="status"
            className="rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-sm text-text-muted"
          >
            Noch keine Seite. Sobald du auf dem iPad schreibst, erscheint sie hier.
          </p>
        ) : (
          <>
            <InkPage
              strokes={strokes}
              elements={elements}
              page={page ?? undefined}
              aria-label={page ? `Notizseite ${index + 1}` : 'Notizseite'}
            />
            {pageError ? (
              <p role="status" className="mt-2 text-xs text-text-muted">
                {friendlyMessage(pageError)}
              </p>
            ) : loadingPage && strokes.length === 0 ? (
              <p role="status" className="mt-2 text-xs text-text-muted">
                Seite wird geladen …
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
