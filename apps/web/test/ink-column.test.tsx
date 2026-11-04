// Notizen-Spalte: REST-Stand laden, Live-Updates über den echten SyncClient gegen den Fake-Sync-Server.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Page, PageElement, Stroke } from '@sg/shared';
import { InkColumn } from '../src/components/ink/InkColumn.tsx';
import { SyncClient } from '../src/lib/sync/client.ts';
import { MemoryQueueStore } from '../src/lib/sync/store.ts';
import { installCanvasMock } from './canvas-mock.ts';
import { loadFixtures } from './ink-fixtures.ts';
import { FakeServer, nbStream, uid } from './sync-fake-server.ts';

const fixtures = loadFixtures();
const strokesA = fixtures[0]!.strokes; // 14 Striche
const strokesB = fixtures[3]!.strokes; // 15 Striche

const NB = 1;
const PAGE_A = uid(101);
const PAGE_B = uid(102);

const makePage = (id: string, index: number, over: Partial<Page> = {}): Page => ({
  id,
  user_id: uid(1000),
  created_at: '2026-11-04T08:00:00Z',
  updated_at: '2026-11-04T08:00:00Z',
  deleted_at: null,
  notebook_id: uid(NB),
  session_id: null,
  index,
  template: 'liniert',
  background_slide_id: null,
  attached_slide_id: null,
  width_pt: 595,
  height_pt: 842,
  version: 1,
  has_pkdrawing: false,
  ...over,
});

/** Minimaler Core: hält Seiten, Striche und Elemente, antwortet wie §7.4 und zählt die Aufrufe. */
class FakeCore {
  pages: Page[] = [makePage(PAGE_A, 1), makePage(PAGE_B, 2)];
  strokes = new Map<string, Stroke[]>([
    [PAGE_A, [...strokesA]],
    [PAGE_B, [...strokesB]],
  ]);
  elements = new Map<string, PageElement[]>();
  /** Zustand des Notizbuch-Stroms zum Zeitpunkt der Antworten */
  head = { seq: 0, opId: null as string | null };
  calls: string[] = [];
  down = false;

  fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const path = String(input).replace(/^\/api\/v1/, '');
    this.calls.push(path);
    if (this.down) throw new TypeError('Failed to fetch');
    const stream = { stream_seq: this.head.seq, stream_op_id: this.head.opId };
    let body: unknown;
    let m: RegExpExecArray | null;
    if ((m = /^\/notebooks\/([^/]+)\/pages$/.exec(path))) {
      body = { notebook_id: m[1], items: this.pages, ...stream };
    } else if ((m = /^\/pages\/([^/]+)\/strokes$/.exec(path))) {
      body = { page_id: m[1], strokes: this.strokes.get(m[1]!) ?? [], ...stream };
    } else if ((m = /^\/pages\/([^/]+)$/.exec(path))) {
      body = {
        page: this.pages.find((p) => p.id === m![1]),
        elements: this.elements.get(m[1]!) ?? [],
        ...stream,
      };
    } else {
      return new Response('{}', { status: 404 });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

let server: FakeServer;
let core: FakeCore;
let client: SyncClient;

/** Schreibt eine Operation in den Fake-Server-Strom und verteilt sie live. */
function live(kind: string, data: object, push = true): void {
  const msg = server.addForeign(nbStream(NB), kind, { data });
  const list = server.streams.get(nbStream(NB))!;
  core.head = { seq: list.length, opId: list[list.length - 1]!.op_id };
  if (push) server.last.push(msg);
}

const pageCreateData = (pageId: string, index: number) => ({
  page_id: pageId,
  notebook_id: uid(NB),
  session_id: null,
  index,
  template: 'liniert',
  width_pt: 595,
  height_pt: 842,
  background_slide_id: null,
  attached_slide_id: null,
});

/** Seedet den Strom so, dass REST-Stand und Strom zusammenpassen (Snapshot = Kopf des Stroms). */
function seed(): void {
  live('page.create', pageCreateData(PAGE_A, 1), false);
  live('page.create', pageCreateData(PAGE_B, 2), false);
}

const canvas = () => document.querySelector('canvas')!;
const strokeCount = () => Number(canvas().dataset.strokeCount);

beforeEach(() => {
  installCanvasMock();
  server = new FakeServer();
  core = new FakeCore();
  vi.stubGlobal('fetch', core.fetch);
  client = new SyncClient({
    url: 'ws://test/sync',
    store: new MemoryQueueStore(),
    webSocketFactory: server.factory,
    random: () => 0,
    leaderLock: () => null,
  });
  seed();
});

afterEach(() => {
  client.disconnect();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  const view = render(<InkColumn notebookId={uid(NB)} client={client} />);
  await waitFor(() => expect(canvas()).toBeInTheDocument());
  await client.connect();
  return view;
}

describe('<InkColumn>', () => {
  it('lädt Seiten und Striche per REST und zeigt die neueste Seite', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    expect(screen.getByText('Seite 2 von 2')).toBeInTheDocument();
    expect(core.calls).toEqual(
      expect.arrayContaining([`/notebooks/${uid(NB)}/pages`, `/pages/${PAGE_B}/strokes`, `/pages/${PAGE_B}`]),
    );
  });

  it('blättert manuell zwischen den Seiten', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    await userEvent.click(screen.getByRole('button', { name: 'Vorherige Seite' }));
    await waitFor(() => expect(strokeCount()).toBe(strokesA.length));
    expect(screen.getByText('Seite 1 von 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vorherige Seite' })).toBeDisabled();
  });

  it('stroke.add erscheint live, stroke.remove entfernt, element.upsert/remove wirken', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    const extra = fixtures[0]!.strokes[0]!;
    const fresh = { ...extra, client_id: uid(7001) } as Stroke;

    await act(async () => live('stroke.add', { page_id: PAGE_B, stroke: fresh }));
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length + 1));
    expect(canvas().dataset.paint).toBe('incremental');

    // Upsert derselben client_id (Lasso): keine zusätzlichen Striche
    await act(async () =>
      live('stroke.add', { page_id: PAGE_B, stroke: { ...fresh, transform: [1, 0, 0, 1, 20, 0] } }),
    );
    await waitFor(() => expect(canvas().dataset.paint).toBe('full'));
    expect(strokeCount()).toBe(strokesB.length + 1);

    // Strich auf anderer Seite: ignoriert
    await act(async () =>
      live('stroke.add', { page_id: PAGE_A, stroke: { ...extra, client_id: uid(7002) } }),
    );
    expect(strokeCount()).toBe(strokesB.length + 1);

    await act(async () =>
      live('stroke.remove', { page_id: PAGE_B, client_ids: [fresh.client_id, strokesB[0]!.client_id] }),
    );
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length - 1));

    const stamp = {
      element_id: uid(8001),
      kind: 'stamp',
      frame: [10, 10, 24, 24],
      z: 1,
      t_ms: null,
      payload: { marker_id: uid(8002), marker_kind: 'frage' },
    };
    const painted = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    await act(async () => live('element.upsert', { page_id: PAGE_B, element: stamp }));
    await waitFor(() => expect(canvas().dataset.paint).toBe('full'));
    expect(painted).toHaveBeenCalled();
    await act(async () => live('element.remove', { page_id: PAGE_B, element_id: stamp.element_id }));
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length - 1));
  });

  it('wendet Operationen nicht doppelt an, die schon im REST-Stand stecken (seq <= stream_seq)', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    const stale = { ...strokesA[0]!, client_id: uid(7010) } as Stroke;
    // Operation mit seq unter dem Snapshot: wird übersprungen
    const msg = server.addForeign(nbStream(NB), 'stroke.add', { data: { page_id: PAGE_B, stroke: stale } });
    await act(async () => server.last.push({ ...msg, seq: 1 }));
    expect(strokeCount()).toBe(strokesB.length);
  });

  it('page.create lädt die Seitenliste neu', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    const PAGE_C = uid(103);
    core.pages = [...core.pages, makePage(PAGE_C, 3)];
    core.strokes.set(PAGE_C, []);
    await act(async () => live('page.create', pageCreateData(PAGE_C, 3)));
    await waitFor(() => expect(screen.getByText('Seite 3 von 3')).toBeInTheDocument());
  });

  it('folgt der Seite des iPads (presence) und entkoppelt beim manuellen Blättern', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    const presence = (page: string) =>
      server.last.push({
        type: 'event',
        name: 'presence',
        data: {
          client: 'ipad',
          device_id: uid(50),
          device_name: 'iPad',
          session_id: null,
          notebook_id: uid(NB),
          page_id: page,
        },
      });
    await act(async () => presence(PAGE_A));
    await waitFor(() => expect(screen.getByText('Seite 1 von 2')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Nächste Seite' }));
    await waitFor(() => expect(screen.getByText('Seite 2 von 2')).toBeInTheDocument());
    // gleiche iPad-Seite noch einmal gemeldet: bleibt entkoppelt
    await act(async () => presence(PAGE_A));
    expect(screen.getByText('Seite 2 von 2')).toBeInTheDocument();
    // Wechsel auf dem iPad koppelt wieder an
    await act(async () => presence(PAGE_B));
    await act(async () => presence(PAGE_A));
    await waitFor(() => expect(screen.getByText('Seite 1 von 2')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Nächste Seite' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Zur iPad-Seite' }));
    await waitFor(() => expect(screen.getByText('Seite 1 von 2')).toBeInTheDocument());
  });

  it('bei reset wird der REST-Stand neu geladen und die neue Position gemeldet', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    const calls = core.calls.length;
    // Core hat jetzt einen anderen Stand (z. B. nach sg restore): zusätzlicher Strich, neuer Strom-Kopf
    core.strokes.set(PAGE_B, [...strokesB, { ...strokesA[0]!, client_id: uid(7020) } as Stroke]);
    live('stroke.add', { page_id: PAGE_B, stroke: strokesA[0]! }, false);
    server.dbEpoch = uid(9999);
    client.disconnect();
    await client.connect();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length + 1));
    expect(core.calls.length).toBeGreaterThan(calls);
    const sub = server.last.of('subscribe').at(-1) ?? server.last.of('hello')[0]!;
    expect(JSON.stringify(sub)).toContain(core.head.opId!);
  });

  it('zeigt Hinweise: iPad nicht verbunden, Core nicht erreichbar', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    await act(async () =>
      server.last.push({
        type: 'event',
        name: 'device.connection',
        data: { client: 'ipad', device_id: uid(50), connected: false },
      }),
    );
    expect(await screen.findByText(/iPad nicht verbunden/)).toBeInTheDocument();
    await act(async () =>
      server.last.push({
        type: 'event',
        name: 'device.connection',
        data: { client: 'ipad', device_id: uid(50), connected: true },
      }),
    );
    await waitFor(() => expect(screen.queryByText(/iPad nicht verbunden/)).not.toBeInTheDocument());
  });

  it('zeigt einen ruhigen Hinweis, wenn der Core nicht antwortet', async () => {
    core.down = true;
    render(<InkColumn notebookId={uid(NB)} client={client} />);
    expect(await screen.findByText(/Core/)).toBeInTheDocument();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('zeigt eine leere Mappe freundlich an', async () => {
    core.pages = [];
    render(<InkColumn notebookId={uid(NB)} client={client} />);
    expect(await screen.findByText(/Noch keine Seite/)).toBeInTheDocument();
  });
});
