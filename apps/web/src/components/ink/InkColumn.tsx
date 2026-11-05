'use client';

// Notizen-Spalte (F-DSH-04): zeigt die Seite des iPads live. Lädt Seiten und Striche per REST (VERTRAEGE §7.4),
// hält sie über den Sync-Strom `notebook:<id>` aktuell (§11.1) und sendet selbst nichts.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Page, PageElement, Stroke, SyncOp } from '@sg/shared';
import { friendlyMessage } from '../../lib/api.ts';
import { fetchNotebookPages, fetchPageDetail, fetchPageStrokes, notebookStream } from '../../lib/ink.ts';
import type { SyncClient } from '../../lib/sync/client.ts';
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

/** Wartezeit bei Fehlern beim Laden: 1 s, 2 s, 4 s … höchstens 15 s */
export const RETRY_START_MS = 1_000;
const RETRY_MAX_MS = 15_000;

/** Sammelzeit für Seiten-Operationen, bevor die Seitenliste neu geladen wird */
const PAGES_DEBOUNCE_MS = 50;

/** Der ältere von zwei Ständen. Nur ab dort ist garantiert, dass keine Operation zwischen den Ständen fehlt. */
function olderSnapshot(a: Snapshot, b: Snapshot): Snapshot {
  return b.seq < a.seq ? b : a;
}

interface Selection {
  selected: string | null;
  following: boolean;
  presencePage: string | null;
}

/** Welche Seite angezeigt wird: iPad-Seite (wenn gefolgt), sonst die gewählte, sonst die neueste. */
function chooseId(pages: readonly Page[] | null, sel: Selection): string | null {
  if (!pages || pages.length === 0) return null;
  const has = (id: string | null) => id !== null && pages.some((p) => p.id === id);
  if (sel.following && has(sel.presencePage)) return sel.presencePage;
  if (has(sel.selected)) return sel.selected;
  return pages[pages.length - 1]!.id;
}

/** Laufendes Laden einer Seite: Operationen, die währenddessen eintreffen, werden danach angewendet. */
interface PageLoad {
  pageId: string;
  ops: SyncOp[];
  controller: AbortController;
}

interface PagesResult {
  snap: Snapshot;
  pages: Page[];
}

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
  const [liveFailed, setLiveFailed] = useState(false);
  const [rev, setRev] = useState(0);

  const dataRef = useRef<PageData | null>(null);
  const loadPageRef = useRef<(pageId: string) => Promise<Snapshot | null>>(async () => null);
  const reloadRef = useRef<() => void>(() => undefined);
  const currentPageRef = useRef<string | null>(null);
  const lastPresenceRef = useRef<string | null>(null);
  const selectionRef = useRef<Selection>({ selected: null, following: true, presencePage: null });
  selectionRef.current = { selected, following, presencePage };

  const effectivePageId = useMemo(
    () => chooseId(pages, { selected, following, presencePage }),
    [pages, selected, following, presencePage],
  );
  currentPageRef.current = effectivePageId;

  // Seiten laden und den Strom abonnieren
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let recovering = false;
    /** Ein Laden ist gescheitert: bei der nächsten funktionierenden Verbindung neu laden */
    let needsReload = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const rootController = new AbortController();
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          timers.delete(t);
          resolve();
        }, ms);
        timers.add(t);
      });

    // Alles zurücksetzen, was zum vorigen Notizbuch gehörte
    dataRef.current = null;
    lastPresenceRef.current = null;
    setPages(null);
    setSelected(null);
    setFollowing(true);
    setPresencePage(null);
    setError(null);
    setPageError(null);
    setLiveFailed(false);
    setRev((r) => r + 1);

    // ---- Seitenliste: höchstens eine Anfrage gleichzeitig, danach eine einzige Folgeanfrage für alle, die
    // währenddessen etwas geändert haben (40 `page.update` ergeben so 2 statt 40 Anfragen).
    let inflight: Promise<PagesResult> | null = null;
    let queued: Promise<PagesResult> | null = null;
    const runPages = async (): Promise<PagesResult> => {
      try {
        const res = await fetchNotebookPages(notebookId, rootController.signal);
        const list = [...res.items].sort((a, b) => a.index - b.index);
        if (!cancelled) {
          setPages(list);
          setError(null);
          needsReload = false;
        }
        return { snap: { seq: res.stream_seq, opId: res.stream_op_id }, pages: list };
      } catch (e) {
        if (!cancelled) {
          setError(e);
          needsReload = true;
        }
        throw e;
      }
    };
    const startRun = (): Promise<PagesResult> => {
      const run: Promise<PagesResult> = runPages().finally(() => {
        if (inflight === run) inflight = null;
      });
      inflight = run;
      return run;
    };
    /** Liefert das Ergebnis einer Anfrage, die NACH diesem Aufruf gestartet wurde. */
    const refreshPages = (): Promise<PagesResult> => {
      if (!inflight) return startRun();
      if (!queued) {
        queued = inflight
          .catch(() => undefined)
          .then(() => {
            queued = null;
            return startRun();
          });
      }
      return queued;
    };

    // ---- Eine Seite laden (Striche und Elemente). Nur die jüngste Anfrage gilt.
    let activeLoad: PageLoad | null = null;
    const loadPage = async (id: string): Promise<Snapshot | null> => {
      activeLoad?.controller.abort();
      const load: PageLoad = { pageId: id, ops: [], controller: new AbortController() };
      activeLoad = load;
      // Abbruch des Notizbuchs gilt auch für diesen Ladevorgang. Der Listener wird nach dem Laden wieder entfernt,
      // sonst bliebe je Seitenwechsel einer am `rootController` hängen (`AbortSignal.any` fehlt in Safari < 17.4).
      const onRootAbort = () => load.controller.abort();
      rootController.signal.addEventListener('abort', onRootAbort, { once: true });
      setLoadingPage(true);
      try {
        const [strokes, detail] = await Promise.all([
          fetchPageStrokes(id, load.controller.signal),
          fetchPageDetail(id, load.controller.signal),
        ]);
        if (cancelled || activeLoad !== load) return null; // überholt
        const data: PageData = {
          pageId: id,
          strokes: new Map(strokes.strokes.map((s) => [s.client_id, s])),
          elements: new Map(detail.elements.map((e) => [e.element_id, e])),
          strokesSeq: strokes.stream_seq,
          elementsSeq: detail.stream_seq,
        };
        for (const op of load.ops) applyOp(data, op);
        activeLoad = null;
        dataRef.current = data;
        setPageError(null);
        setRev((r) => r + 1);
        setLoadingPage(false);
        // Der ÄLTERE der beiden Stände ist der sichere Anker für das Abonnement (Operationen dazwischen werden
        // erneut geliefert und über `seq` aussortiert)
        return olderSnapshot(
          { seq: strokes.stream_seq, opId: strokes.stream_op_id },
          { seq: detail.stream_seq, opId: detail.stream_op_id },
        );
      } catch (e) {
        if (cancelled || activeLoad !== load || (e instanceof DOMException && e.name === 'AbortError'))
          return null;
        activeLoad = null;
        needsReload = true;
        setPageError(e);
        setLoadingPage(false);
        throw e;
      } finally {
        rootController.signal.removeEventListener('abort', onRootAbort);
      }
    };
    loadPageRef.current = loadPage;

    // Seiten-Operationen kommen oft gebündelt (Replay nach Neuverbinden): kurz sammeln, dann einmal laden
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        timers.delete(timer);
        refreshPages().catch(() => undefined);
      }, PAGES_DEBOUNCE_MS);
      const timer = refreshTimer;
      timers.add(timer);
    };

    const onOp = (op: SyncOp) => {
      if (PAGE_KINDS.has(op.kind)) {
        scheduleRefresh();
        return;
      }
      if (activeLoad) {
        activeLoad.ops.push(op);
        return;
      }
      const data = dataRef.current;
      if (data && applyOp(data, op)) setRev((r) => r + 1);
    };

    /** Seitenliste (und, wenn gewünscht, die angezeigte Seite) neu laden; liefert den sicheren Abo-Anker. */
    const reloadAll = async (withPage: boolean): Promise<Snapshot> => {
      const { snap, pages: list } = await refreshPages();
      let anchor = snap;
      if (withPage) {
        const id = chooseId(list, selectionRef.current);
        if (id) {
          const s = await loadPage(id);
          if (s) anchor = olderSnapshot(anchor, s);
        }
      }
      return anchor;
    };

    const subscribeFrom = (anchor: Snapshot) => {
      unsubscribe = client.subscribe(
        notebookStream(notebookId),
        { lastSeq: anchor.seq, lastOpId: anchor.opId },
        onOp,
        {
          // Bei `reset` den REST-Stand neu laden und dessen Position melden (§11.1)
          onReset: async () => {
            const a = await reloadAll(true);
            return { lastSeq: a.seq, lastOpId: a.opId };
          },
        },
      );
    };

    /**
     * Erst laden, dann abonnieren; bei Fehlern mit Wartezeit wiederholen. Nie mit `last_seq = 0` abonnieren, das
     * würde den ganzen Strom abspielen.
     */
    const establish = async (withPage: boolean): Promise<void> => {
      if (recovering) return;
      recovering = true;
      unsubscribe?.();
      unsubscribe = null;
      let delay = RETRY_START_MS;
      try {
        while (!cancelled) {
          try {
            const anchor = await reloadAll(withPage);
            if (cancelled) return;
            subscribeFrom(anchor);
            setLiveFailed(false);
            return;
          } catch {
            if (cancelled) return; // nach dem Abbruch keinen neuen Timer mehr anlegen
            await sleep(delay);
            delay = Math.min(delay * 2, RETRY_MAX_MS);
          }
        }
      } finally {
        recovering = false;
      }
    };
    void establish(false);

    reloadRef.current = () => {
      refreshPages().catch(() => undefined);
      const id = currentPageRef.current;
      if (id) loadPage(id).catch(() => undefined);
    };

    const offs = [
      client.onEvent('connection', (c) => {
        setSyncState(c.state);
        // Nach einem Verbindungsfehler (Core war nicht da) neu laden, sobald es wieder geht
        if (c.state === 'online' && needsReload && !recovering) reloadRef.current();
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
      client.onEvent('leader.changed', () => reloadRef.current()),
      // Der Abgleich nach einem `reset` ist gescheitert: der Strom bleibt stumm, bis neu abonniert wird
      client.onEvent('reset.failed', (f) => {
        if (f.stream !== notebookStream(notebookId)) return;
        setLiveFailed(true);
        void establish(true);
      }),
    ];
    setSyncState(client.connectionState);

    return () => {
      cancelled = true;
      rootController.abort();
      for (const t of timers) clearTimeout(t);
      unsubscribe?.();
      for (const off of offs) off();
    };
  }, [notebookId, client]);

  // Strich- und Elementestand der angezeigten Seite laden
  useEffect(() => {
    if (!effectivePageId) {
      dataRef.current = null;
      setRev((r) => r + 1);
      return;
    }
    loadPageRef.current(effectivePageId).catch(() => undefined);
  }, [effectivePageId]);

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
    <section aria-label="Notizen" className={`flex w-full min-w-0 min-h-0 flex-col gap-2 ${className ?? ''}`}>
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

      {liveFailed ? (
        <p role="status" className="text-xs text-text-muted">
          Live-Abgleich gescheitert – wird erneut versucht
        </p>
      ) : offline || noLive ? (
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
