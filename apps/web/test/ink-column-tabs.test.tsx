// Notizen-Spalte mit mehreren Tabs (Owner-Meldung vom 17.11.: Notizen erscheinen nur nach Verlassen und erneutem
// Öffnen der Session). Die Vorlesungsansicht liegt oft nicht im Leader-Tab. Sie muss die Operationen von
// `notebook:<id>` trotzdem live bekommen, auch nach einem Leader-Wechsel (VERTRAEGE §11.8, Mitlese-Verbindung).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { Page, Stroke } from '@sg/shared';
import { InkColumn } from '../src/components/ink/InkColumn.tsx';
import { SyncClient } from '../src/lib/sync/client.ts';
import { MemoryQueueStore } from '../src/lib/sync/store.ts';
import type { LeaderLock, LeaderLockHandlers } from '../src/lib/sync/tabs.ts';
import { installCanvasMock } from './canvas-mock.ts';
import { loadFixtures } from './ink-fixtures.ts';
import { FakeServer, nbStream, uid } from './sync-fake-server.ts';

const fixtures = loadFixtures();
const strokesA = fixtures[0]!.strokes;
const strokesB = fixtures[3]!.strokes;
const NB = 1;
const PAGE_A = uid(101);
const PAGE_B = uid(102);

const makePage = (id: string, index: number): Page => ({
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
});

/** Web Locks im Kleinen: ein Halter, wartende Tabs übernehmen beim Schließen, `steal` für „Hier übernehmen“ */
class Locks {
  holder: Lock | null = null;
  waiting: Lock[] = [];
  create = (): LeaderLock => new Lock(this);
}
class Lock implements LeaderLock {
  handlers: LeaderLockHandlers | null = null;
  private readonly owner: Locks;
  constructor(owner: Locks) {
    this.owner = owner;
  }
  start(h: LeaderLockHandlers): void {
    this.handlers = h;
    this.enqueue();
  }
  private enqueue(): void {
    if (!this.owner.holder) {
      this.owner.holder = this;
      this.handlers?.onLeader();
    } else {
      this.owner.waiting.push(this);
      this.handlers?.onOtherTab();
    }
  }
  steal(): void {
    const old = this.owner.holder;
    if (old === this) return;
    this.owner.waiting = this.owner.waiting.filter((w) => w !== this);
    this.owner.holder = this;
    old?.handlers?.onLost();
    if (old) this.owner.waiting.push(old);
    this.handlers?.onLeader();
  }
  stop(): void {
    this.owner.waiting = this.owner.waiting.filter((w) => w !== this);
    if (this.owner.holder !== this) return;
    this.owner.holder = null;
    const next = this.owner.waiting.shift();
    if (next) {
      this.owner.holder = next;
      next.handlers?.onLeader();
    }
  }
}

let server: FakeServer;
let locks: Locks;
let clients: SyncClient[];
const strokes = new Map<string, Stroke[]>();

function head() {
  const list = server.streams.get(nbStream(NB)) ?? [];
  return { stream_seq: list.length, stream_op_id: list[list.length - 1]?.op_id ?? null };
}

/** REST des Cores: Seiten und Striche, Stand aus dem Strom des Fake-Servers */
const fetchFake = async (input: RequestInfo | URL): Promise<Response> => {
  const path = String(input).replace(/^\/api\/v1/, '');
  let body: unknown;
  let m: RegExpExecArray | null;
  if (/^\/notebooks\/[^/]+\/pages$/.test(path)) {
    body = { notebook_id: uid(NB), items: [makePage(PAGE_A, 1), makePage(PAGE_B, 2)], ...head() };
  } else if ((m = /^\/pages\/([^/]+)\/strokes$/.exec(path))) {
    body = { page_id: m[1], strokes: [...(strokes.get(m[1]!) ?? [])], ...head() };
  } else if ((m = /^\/pages\/([^/]+)$/.exec(path))) {
    body = { page: makePage(m[1]!, m[1] === PAGE_A ? 1 : 2), elements: [], ...head() };
  } else {
    return new Response('{}', { status: 404 });
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

function tab(): SyncClient {
  const c = new SyncClient({
    url: 'ws://test/sync',
    store: new MemoryQueueStore(),
    webSocketFactory: server.factory,
    random: () => 0,
    leaderLock: locks.create,
  });
  clients.push(c);
  return c;
}

/** Das iPad schreibt einen Strich: der Core verteilt ihn an alle Abonnenten des Stroms */
let nextStroke = 7000;
function ipadStroke(pageId: string): void {
  const stroke = { ...strokesA[0]!, client_id: uid(++nextStroke), created_at: 9_000_000_000_000 } as Stroke;
  strokes.get(pageId)!.push(stroke);
  server.fanOut(server.addForeign(nbStream(NB), 'stroke.add', { data: { page_id: pageId, stroke } }));
}

function ipadPresence(pageId: string): void {
  server.fanOut({
    type: 'event',
    name: 'presence',
    data: {
      client: 'ipad',
      device_id: uid(50),
      device_name: 'iPad',
      session_id: null,
      notebook_id: uid(NB),
      page_id: pageId,
    },
  });
}

const strokeCount = () =>
  Number(document.querySelector<HTMLCanvasElement>('canvas[data-layer="under"]')!.dataset.strokeCount);

beforeEach(() => {
  installCanvasMock();
  server = new FakeServer();
  locks = new Locks();
  clients = [];
  strokes.set(PAGE_A, [...strokesA]);
  strokes.set(PAGE_B, [...strokesB]);
  vi.stubGlobal('fetch', fetchFake);
  for (const [pageId, index] of [
    [PAGE_A, 1],
    [PAGE_B, 2],
  ] as const) {
    server.addForeign(nbStream(NB), 'page.create', {
      data: {
        page_id: pageId,
        notebook_id: uid(NB),
        session_id: null,
        index,
        template: 'liniert',
        width_pt: 595,
        height_pt: 842,
        background_slide_id: null,
        attached_slide_id: null,
      },
    });
  }
});

afterEach(() => {
  for (const c of clients) c.disconnect();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Tab „Heute“ ist Leader, die Vorlesungsansicht liegt im Folge-Tab */
async function followerView() {
  const leader = tab();
  await leader.connect();
  await waitFor(() => expect(leader.connectionState).toBe('online'));
  const follower = tab();
  await follower.connect();
  expect(follower.connectionState).toBe('other_tab');
  render(<InkColumn notebookId={uid(NB)} client={follower} />);
  await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
  return { leader, follower };
}

describe('<InkColumn> im Folge-Tab (Vorlesungsansicht nicht im Leader-Tab)', () => {
  it('Striche vom iPad erscheinen live, ohne die Ansicht neu zu öffnen', async () => {
    const { follower } = await followerView();
    await act(async () => ipadStroke(PAGE_B));
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length + 1));
    await act(async () => ipadStroke(PAGE_B));
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length + 2));
    // Kein Hinweis „Keine Live-Verbindung“: Der Tab liest über seine eigene Verbindung mit
    expect(follower.linkState).toBe('online');
    expect(screen.queryByText(/Keine Live-Verbindung/)).toBeNull();
  });

  it('folgt der Seite des iPads (presence) auch im Folge-Tab', async () => {
    await followerView();
    await act(async () => ipadPresence(PAGE_A));
    await waitFor(() => expect(screen.getByText('Seite 1 von 2')).toBeInTheDocument());
    await waitFor(() => expect(strokeCount()).toBe(strokesA.length));
    await act(async () => ipadStroke(PAGE_A));
    await waitFor(() => expect(strokeCount()).toBe(strokesA.length + 1));
  });

  it('nach „Hier übernehmen“ im Vorlesungs-Tab: weiter live', async () => {
    const { leader, follower } = await followerView();
    follower.takeOver();
    await waitFor(() => expect(follower.connectionState).toBe('online'));
    expect(leader.connectionState).toBe('other_tab');
    await act(async () => ipadStroke(PAGE_B));
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length + 1));
  });

  it('der andere Tab holt sich die Leader-Rolle zurück: die Vorlesungsansicht bleibt live', async () => {
    const { leader, follower } = await followerView();
    follower.takeOver();
    await waitFor(() => expect(follower.connectionState).toBe('online'));
    leader.takeOver();
    await waitFor(() => expect(leader.connectionState).toBe('online'));
    expect(follower.connectionState).toBe('other_tab');
    await act(async () => ipadStroke(PAGE_B));
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length + 1));
    expect(follower.linkState).toBe('online');
  });

  it('der Leader-Tab schließt: der Vorlesungs-Tab übernimmt und bleibt live', async () => {
    const { leader, follower } = await followerView();
    leader.disconnect();
    await waitFor(() => expect(follower.connectionState).toBe('online'));
    await act(async () => ipadStroke(PAGE_B));
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length + 1));
  });
});
