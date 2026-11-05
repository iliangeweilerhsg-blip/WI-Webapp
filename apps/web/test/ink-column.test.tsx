// Notizen-Spalte: REST-Stand laden, Live-Updates über den echten SyncClient gegen den Fake-Sync-Server.
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Page, PageElement, Stroke, SyncOp } from '@sg/shared';
import { InkColumn, type InkSyncSource } from '../src/components/ink/InkColumn.tsx';
import { SyncClient } from '../src/lib/sync/client.ts';
import { MemoryQueueStore } from '../src/lib/sync/store.ts';
import { installCanvasMock, type CanvasLog } from './canvas-mock.ts';
import { loadFixtures } from './ink-fixtures.ts';
import { FakeServer, nbStream, uid } from './sync-fake-server.ts';

const fixtures = loadFixtures();
const strokesA = fixtures[0]!.strokes; // 14 Striche
const strokesB = fixtures[3]!.strokes; // 15 Striche

const NB = 1;
const NB2 = 2;
const PAGE_A = uid(101);
const PAGE_B = uid(102);
const PAGE_C = uid(103);

const makePage = (id: string, index: number, nb = NB): Page => ({
  id,
  user_id: uid(1000),
  created_at: '2026-11-04T08:00:00Z',
  updated_at: '2026-11-04T08:00:00Z',
  deleted_at: null,
  notebook_id: uid(nb),
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

const pageCreateData = (pageId: string, index: number, nb = NB) => ({
  page_id: pageId,
  notebook_id: uid(nb),
  session_id: null,
  index,
  template: 'liniert',
  width_pt: 595,
  height_pt: 842,
  background_slide_id: null,
  attached_slide_id: null,
});

let server: FakeServer;
let client: SyncClient;
let log: CanvasLog;

/** Core, der jeden REST-Stand zum Zeitpunkt der Antwort aus dem Strom des Fake-Servers ableitet (wie §11.1). */
class Core {
  pages = new Map<string, Page[]>([[uid(NB), [makePage(PAGE_A, 1), makePage(PAGE_B, 2)]]]);
  strokes = new Map<string, Stroke[]>([
    [PAGE_A, [...strokesA]],
    [PAGE_B, [...strokesB]],
  ]);
  elements = new Map<string, PageElement[]>();
  calls: string[] = [];
  down = false;
  /** Hook vor der Antwort (darf warten und den Strom ändern) */
  before: (path: string) => Promise<void> | void = () => undefined;
  /** Hook nach Berechnung der Antwort (darf den Strom ändern; die Antwort trägt noch den alten Kopf) */
  after: (path: string) => void = () => undefined;

  head(nb: number) {
    const list = server.streams.get(nbStream(nb)) ?? [];
    return { stream_seq: list.length, stream_op_id: list[list.length - 1]?.op_id ?? null };
  }

  fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const path = String(input).replace(/^\/api\/v1/, '');
    this.calls.push(path);
    if (this.down) throw new TypeError('Failed to fetch');
    await this.before(path);
    let body: unknown;
    let m: RegExpExecArray | null;
    if ((m = /^\/notebooks\/([^/]+)\/pages$/.exec(path))) {
      const nb = m[1] === uid(NB2) ? NB2 : NB;
      body = { notebook_id: m[1], items: this.pages.get(m[1]!) ?? [], ...this.head(nb) };
    } else if ((m = /^\/pages\/([^/]+)\/strokes$/.exec(path))) {
      body = { page_id: m[1], strokes: [...(this.strokes.get(m[1]!) ?? [])], ...this.head(NB) };
    } else if ((m = /^\/pages\/([^/]+)$/.exec(path))) {
      const page = [...this.pages.values()].flat().find((p) => p.id === m![1]);
      body = { page, elements: [...(this.elements.get(m[1]!) ?? [])], ...this.head(NB) };
    } else {
      return new Response('{}', { status: 404 });
    }
    this.after(path);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
let core: Core;

/** Schreibt eine Operation in den Strom des Fake-Servers und verteilt sie live. */
function addOp(kind: string, data: object, push = true, nb = NB) {
  const msg = server.addForeign(nbStream(nb), kind, { data });
  if (push && server.sockets.length) server.last.push(msg);
  return msg;
}

const textEl = (id: number, text: string): PageElement =>
  ({
    element_id: uid(id),
    kind: 'text',
    frame: [20, 20, 200, 40],
    z: 1,
    t_ms: null,
    payload: { text, size: 'm' },
  }) as PageElement;

const under = () => document.querySelector<HTMLCanvasElement>('canvas[data-layer="under"]')!;
const ink = () => document.querySelector<HTMLCanvasElement>('canvas[data-layer="ink"]')!;
const strokeCount = () => Number(under().dataset.strokeCount);
const drawnTexts = () => log.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastSubscribe = () => {
  const msgs = server.sockets.flatMap((s) => [...s.of('hello'), ...s.of('subscribe')]);
  return msgs.at(-1)!.streams as { stream: string; last_seq: number; last_op_id: string | null }[];
};

const internals = () =>
  client as unknown as {
    subs: Map<string, { receivers: Set<unknown> }>;
    listeners: Map<string, Set<unknown>>;
  };

beforeEach(() => {
  log = installCanvasMock();
  server = new FakeServer();
  core = new Core();
  vi.stubGlobal('fetch', core.fetch);
  client = new SyncClient({
    url: 'ws://test/sync',
    store: new MemoryQueueStore(),
    webSocketFactory: server.factory,
    random: () => 0,
    leaderLock: () => null,
  });
  addOp('page.create', pageCreateData(PAGE_A, 1), false);
  addOp('page.create', pageCreateData(PAGE_B, 2), false);
});

afterEach(() => {
  client.disconnect();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  const view = render(<InkColumn notebookId={uid(NB)} client={client} />);
  await waitFor(() => expect(under()).toBeInTheDocument());
  await client.connect();
  return view;
}

describe('<InkColumn> laden und blättern', () => {
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

  it('überspringt einen Strich mit unbekanntem Werkzeug im REST-Stand, die Seite bleibt sichtbar', async () => {
    core.strokes.set(PAGE_B, [
      ...strokesB,
      { ...strokesA[0]!, client_id: uid(7400), tool: 'brush' } as unknown as Stroke,
    ]);
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
  });
});

describe('<InkColumn> Live-Updates', () => {
  it('stroke.add erscheint live, stroke.remove entfernt, element.upsert/remove wirken', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    const extra = strokesA[0]!;
    const fresh = { ...extra, client_id: uid(7001), created_at: 9_000_000_000_000 } as Stroke;

    await act(async () => void addOp('stroke.add', { page_id: PAGE_B, stroke: fresh }));
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length + 1));
    expect(ink().dataset.paint).toBe('incremental');

    // Upsert derselben client_id (Lasso): keine zusätzlichen Striche, Tinte-Ebene wird neu gezeichnet
    await act(
      async () =>
        void addOp('stroke.add', { page_id: PAGE_B, stroke: { ...fresh, transform: [1, 0, 0, 1, 20, 0] } }),
    );
    await waitFor(() => expect(ink().dataset.paint).toBe('partial'));
    expect(strokeCount()).toBe(strokesB.length + 1);

    // Strich auf anderer Seite: ignoriert
    await act(
      async () => void addOp('stroke.add', { page_id: PAGE_A, stroke: { ...extra, client_id: uid(7002) } }),
    );
    expect(strokeCount()).toBe(strokesB.length + 1);

    await act(
      async () =>
        void addOp('stroke.remove', {
          page_id: PAGE_B,
          client_ids: [fresh.client_id, strokesB[0]!.client_id],
        }),
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
    await act(async () => void addOp('element.upsert', { page_id: PAGE_B, element: stamp }));
    await waitFor(() =>
      expect(document.querySelector<HTMLCanvasElement>('canvas[data-layer="top"]')!.dataset.paint).toBe(
        'full',
      ),
    );
    expect(drawnTexts()).toContain('?');
    // ein neuer Strich zeichnet mit Stempel darüber nur die Tinte nach
    log.reset();
    await act(
      async () =>
        void addOp('stroke.add', {
          page_id: PAGE_B,
          stroke: { ...extra, client_id: uid(7003), created_at: 9_000_000_000_001 },
        }),
    );
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    expect(ink().dataset.paint).toBe('incremental');
    expect(log.fills).toHaveLength(1);
    expect(log.count('fillText')).toBe(0);
    await act(async () => void addOp('element.remove', { page_id: PAGE_B, element_id: stamp.element_id }));
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
  });

  it('page.create lädt die Seitenliste neu', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    core.pages.set(uid(NB), [...core.pages.get(uid(NB))!, makePage(PAGE_C, 3)]);
    core.strokes.set(PAGE_C, []);
    await act(async () => void addOp('page.create', pageCreateData(PAGE_C, 3)));
    await waitFor(() => expect(screen.getByText('Seite 3 von 3')).toBeInTheDocument());
  });

  it('fasst viele page.update zu wenigen Anfragen zusammen', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    const before = core.calls.filter((c) => c.endsWith('/pages')).length;
    const fields = {
      index: 1,
      template: 'liniert',
      session_id: null,
      background_slide_id: null,
      attached_slide_id: null,
    };
    await act(async () => {
      for (let i = 0; i < 40; i++) addOp('page.update', { page_id: PAGE_A, fields, version: i + 2 });
      await sleep(100);
    });
    const pagesCalls = core.calls.filter((c) => c.endsWith('/pages')).length - before;
    expect(pagesCalls).toBeLessThanOrEqual(3);
    expect(pagesCalls).toBeGreaterThanOrEqual(1);
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

  it('unbekannte Operation und unbekannter Enum-Wert: kein Fehler, die Folgeoperation kommt an', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    await act(async () => void addOp('foo.bar', { x: 1 }));
    await act(
      async () =>
        void addOp('stroke.add', {
          page_id: PAGE_B,
          stroke: { ...strokesA[0]!, client_id: uid(7300), tool: 'brush' },
        }),
    );
    await act(
      async () =>
        void addOp('stroke.add', { page_id: PAGE_B, stroke: { ...strokesA[0]!, client_id: uid(7301) } }),
    );
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length + 1));
  });
});

describe('<InkColumn> Filter und Puffer', () => {
  /** Client-Attrappe: gibt `onOp` heraus, damit Operationen mit beliebiger `seq` eingespeist werden können. */
  function stubClient() {
    let onOp: (op: SyncOp) => void = () => undefined;
    const subscribe = vi.fn((_stream: string, _from: unknown, cb: (op: SyncOp) => void) => {
      onOp = cb;
      return () => undefined;
    });
    const source = {
      subscribe,
      onEvent: () => () => undefined,
      connectionState: 'online',
    } as unknown as InkSyncSource;
    return { source, subscribe, push: (op: object) => onOp(op as SyncOp) };
  }
  const strokeOp = (seq: number, stroke: Stroke) => ({
    type: 'op',
    op_id: uid(9000 + seq),
    stream: nbStream(NB),
    kind: 'stroke.add',
    at: 1,
    clock_uncertain: false,
    seq,
    data: { page_id: PAGE_B, stroke },
  });

  it('verwirft Operationen, die schon im REST-Stand stecken (seq <= stream_seq), und übernimmt neuere', async () => {
    const stub = stubClient();
    addOp('page.update', {}, false); // Kopf 3: REST-Stände tragen stream_seq 3
    render(<InkColumn notebookId={uid(NB)} client={stub.source} />);
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    await waitFor(() => expect(stub.subscribe).toHaveBeenCalled());
    const x = { ...strokesA[0]!, client_id: uid(7500) } as Stroke;
    await act(async () => stub.push(strokeOp(3, x))); // gleich alt wie der Stand: schon enthalten
    expect(strokeCount()).toBe(strokesB.length);
    await act(async () => stub.push(strokeOp(2, x)));
    expect(strokeCount()).toBe(strokesB.length);
    await act(async () => stub.push(strokeOp(4, x))); // neuer
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length + 1));
  });

  it('Puffer: Operationen, die während des Ladens eintreffen, gehen nicht verloren (stroke.remove)', async () => {
    const stub = stubClient();
    const victim = strokesB[0]!;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    core.before = async (path) => {
      if (path.endsWith(`/pages/${PAGE_B}/strokes`)) await gate;
    };
    render(<InkColumn notebookId={uid(NB)} client={stub.source} />);
    await waitFor(() => expect(stub.subscribe).toHaveBeenCalled());
    // Der Strich-Stand ist unterwegs (enthält `victim`); jetzt kommt die Löschung (seq 3) und danach ein Neuer (seq 4)
    await act(async () => {
      stub.push({
        ...strokeOp(3, victim),
        kind: 'stroke.remove',
        data: { page_id: PAGE_B, client_ids: [victim.client_id] },
      });
      stub.push(strokeOp(4, { ...strokesA[0]!, client_id: uid(7600) } as Stroke));
    });
    // REST-Stand ist von seq 2 (vor der Löschung), enthält `victim` noch
    release();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length)); // -1 (victim) +1 (neuer)
    // und victim ist wirklich weg: ein weiteres Entfernen ändert nichts mehr
    await act(async () =>
      stub.push({
        ...strokeOp(5, victim),
        kind: 'stroke.remove',
        data: { page_id: PAGE_B, client_ids: [victim.client_id] },
      }),
    );
    expect(strokeCount()).toBe(strokesB.length);
  });

  it('Live-Operationen zwischen Seitenliste und Strich-Stand (echter Client)', async () => {
    const x = { ...strokesA[0]!, client_id: uid(7100) } as Stroke;
    let first = true;
    core.before = async (path) => {
      if (first && path.endsWith('/strokes')) {
        // seq 3: nach der Seitenliste (seq 2), vor dem Strich-Stand
        addOp('stroke.add', { page_id: PAGE_B, stroke: x });
        core.strokes.set(PAGE_B, [...strokesB, x]);
        await sleep(30);
      }
    };
    core.after = (path) => {
      if (first && path.endsWith('/strokes')) {
        first = false;
        // seq 4: nach dem Strich-Stand, kommt während die Antwort unterwegs ist
        addOp('stroke.remove', { page_id: PAGE_B, client_ids: [strokesB[0]!.client_id, x.client_id] });
        core.strokes.set(PAGE_B, strokesB.slice(1));
      }
    };
    await client.connect();
    render(<InkColumn notebookId={uid(NB)} client={client} />);
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length - 1));
  });
});

describe('<InkColumn> Abo und Reset', () => {
  /** Reset über geänderte db_epoch erzwingen (wie nach `sg restore`). */
  async function forceReset() {
    server.dbEpoch = uid(9999);
    client.disconnect();
    await client.connect();
  }

  it('Reset: der Anker ist der ÄLTERE REST-Stand, ein Element zwischen Detail und Strichen geht nicht verloren', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    let phase = true;
    core.before = async (path) => {
      if (phase && path.endsWith('/strokes')) await sleep(30); // Detail kommt zuerst
    };
    core.after = (path) => {
      if (phase && path === `/pages/${PAGE_B}`) {
        phase = false; // Detail trägt seq 2; danach entsteht seq 3, die Strich-Antwort trägt schon seq 3
        core.elements.set(PAGE_B, [textEl(8100, 'NACH-DETAIL')]);
        addOp('element.upsert', { page_id: PAGE_B, element: textEl(8100, 'NACH-DETAIL') }, false);
      }
    };
    await forceReset();
    await sleep(100);
    expect(lastSubscribe()[0]!.last_seq).toBe(2); // der ältere Stand, nicht 3
    // Das Element wird über den Abo-Replay (seq 3) angewendet und gezeichnet
    await act(
      async () =>
        void addOp('stroke.add', { page_id: PAGE_B, stroke: { ...strokesA[0]!, client_id: uid(7777) } }),
    );
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length + 1));
    await waitFor(() => expect(drawnTexts()).toContain('NACH-DETAIL'));
  });

  it('Reset: page.create zwischen Seitenliste und Strich-Stand geht nicht verloren', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    let phase = true;
    core.after = (path) => {
      if (phase && path === `/notebooks/${uid(NB)}/pages`) {
        phase = false; // Seitenliste trägt seq 2, danach entsteht Seite C (seq 3)
        core.pages.set(uid(NB), [makePage(PAGE_A, 1), makePage(PAGE_B, 2), makePage(PAGE_C, 3)]);
        core.strokes.set(PAGE_C, []);
        addOp('page.create', pageCreateData(PAGE_C, 3), false);
      }
    };
    await forceReset();
    await waitFor(() => expect(screen.getByText('Seite 3 von 3')).toBeInTheDocument(), { timeout: 2000 });
    expect(lastSubscribe()[0]!.last_seq).toBe(2);
  });

  it('Reset: lädt den REST-Stand neu und meldet die neue Position (verschiedene Köpfe je Antwort)', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    const calls = core.calls.length;
    core.strokes.set(PAGE_B, [...strokesB, { ...strokesA[0]!, client_id: uid(7020) } as Stroke]);
    addOp('stroke.add', { page_id: PAGE_B, stroke: strokesA[0]! }, false);
    await forceReset();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length + 1));
    expect(core.calls.length).toBeGreaterThan(calls);
    await waitFor(() => expect(lastSubscribe()[0]!.last_seq).toBe(3));
  });

  it('Start: scheitert die Seitenliste, wird NICHT mit last_seq 0 abonniert, sondern mit Wartezeit neu geladen', async () => {
    for (let i = 0; i < 40; i++) addOp('page.update', { page_id: PAGE_A }, false);
    core.down = true;
    const subscribe = vi.spyOn(client, 'subscribe');
    render(<InkColumn notebookId={uid(NB)} client={client} />);
    await client.connect();
    await sleep(60);
    expect(screen.getByText(/Core nicht erreichbar|Der Core/)).toBeInTheDocument();
    expect(subscribe).not.toHaveBeenCalled();
    core.down = false;
    await waitFor(() => expect(subscribe).toHaveBeenCalledOnce(), { timeout: 3000 });
    expect(subscribe.mock.calls[0]![1]).toMatchObject({ lastSeq: 42 });
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    // kein Abspielen von 42 Operationen mit je einer Seitenlisten-Anfrage
    expect(core.calls.filter((c) => c.endsWith('/pages')).length).toBeLessThan(5);
  });

  it('reset.failed: Hinweis, automatischer neuer Versuch, danach läuft der Live-Strom wieder', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    core.down = true; // der REST-Abgleich im Reset scheitert
    await forceReset();
    expect(await screen.findByText(/Live-Abgleich gescheitert/)).toBeInTheDocument();
    core.down = false;
    await waitFor(() => expect(screen.queryByText(/Live-Abgleich gescheitert/)).not.toBeInTheDocument(), {
      timeout: 4000,
    });
    await waitFor(() => expect(internals().subs.get(nbStream(NB))?.receivers.size).toBe(1));
    await act(
      async () =>
        void addOp('stroke.add', { page_id: PAGE_B, stroke: { ...strokesA[0]!, client_id: uid(7800) } }),
    );
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length + 1));
  });

  it('StrictMode: genau ein Abo; nach dem Unmount keine Abos und keine Listener mehr', async () => {
    const before = new Map([...internals().listeners].map(([k, v]) => [k, v.size]));
    const view = render(
      <StrictMode>
        <InkColumn notebookId={uid(NB)} client={client} />
      </StrictMode>,
    );
    await client.connect();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    expect(internals().subs.get(nbStream(NB))!.receivers.size).toBe(1);
    view.unmount();
    expect(internals().subs.size).toBe(0);
    for (const [k, v] of internals().listeners) expect(v.size, k).toBe(before.get(k) ?? 0);
  });

  it('Unmount vor dem Abonnieren: es wird nie abonniert', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    core.before = async (path) => {
      if (path.endsWith('/pages')) await gate;
    };
    const subscribe = vi.spyOn(client, 'subscribe');
    const view = render(<InkColumn notebookId={uid(NB)} client={client} />);
    view.unmount();
    release();
    await sleep(30);
    expect(subscribe).not.toHaveBeenCalled();
    expect(internals().subs.size).toBe(0);
  });

  it('Seitenwechsel: Abort-Listener sammeln sich nicht an', async () => {
    let net = 0;
    const add = AbortSignal.prototype.addEventListener;
    const remove = AbortSignal.prototype.removeEventListener;
    vi.spyOn(AbortSignal.prototype, 'addEventListener').mockImplementation(function (
      this: AbortSignal,
      type: string,
      ...rest: [EventListenerOrEventListenerObject, (boolean | AddEventListenerOptions)?]
    ) {
      if (type === 'abort') net++;
      return add.call(this, type, ...rest);
    } as typeof add);
    vi.spyOn(AbortSignal.prototype, 'removeEventListener').mockImplementation(function (
      this: AbortSignal,
      type: string,
      ...rest: [EventListenerOrEventListenerObject, (boolean | EventListenerOptions)?]
    ) {
      if (type === 'abort') net--;
      return remove.call(this, type, ...rest);
    } as typeof remove);
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    const baseline = net;
    for (let i = 0; i < 4; i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Vorherige Seite' }));
      await waitFor(() => expect(strokeCount()).toBe(strokesA.length));
      await userEvent.click(screen.getByRole('button', { name: 'Nächste Seite' }));
      await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    }
    expect(core.calls.filter((c) => c.endsWith('/strokes')).length).toBeGreaterThan(8);
    expect(net).toBe(baseline);
  });

  it('Abbruch während der Wiederholung: nach dem Unmount entsteht kein neuer Timer', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    core.before = async (path) => {
      if (path.endsWith('/pages')) {
        await gate;
        throw new TypeError('Failed to fetch');
      }
    };
    const view = render(<InkColumn notebookId={uid(NB)} client={client} />);
    view.unmount();
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    release();
    await sleep(30);
    expect(timeout.mock.calls.filter((c) => c[1] === 1_000)).toHaveLength(0);
  });

  it('Notizbuchwechsel: nur das neue ist abonniert, keine fremden Striche, Folgen/Presence zurückgesetzt', async () => {
    core.pages.set(uid(NB2), [makePage(uid(201), 1, NB2)]);
    core.strokes.set(uid(201), [...strokesA.slice(0, 3)]);
    addOp('page.create', pageCreateData(uid(201), 1, NB2), false, NB2);
    await client.connect();
    const view = render(<InkColumn notebookId={uid(NB)} client={client} />);
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    // das iPad zeigt im ersten Notizbuch Seite A, der Nutzer blättert weg
    await act(async () =>
      server.last.push({
        type: 'event',
        name: 'presence',
        data: {
          client: 'ipad',
          device_id: uid(50),
          device_name: 'iPad',
          session_id: null,
          notebook_id: uid(NB),
          page_id: PAGE_A,
        },
      }),
    );
    await waitFor(() => expect(strokeCount()).toBe(strokesA.length));
    view.rerender(<InkColumn notebookId={uid(NB2)} client={client} />);
    await waitFor(() => expect(strokeCount()).toBe(3));
    await sleep(60);
    expect([...internals().subs.keys()]).toEqual([nbStream(NB2)]);
    expect(screen.getByText('Seite 1 von 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zur iPad-Seite' })).not.toBeInTheDocument();
  });
});

describe('<InkColumn> Hinweise', () => {
  it('zeigt Hinweise: iPad nicht verbunden', async () => {
    await mount();
    await waitFor(() => expect(strokeCount()).toBe(strokesB.length));
    const ev = (connected: boolean) =>
      server.last.push({
        type: 'event',
        name: 'device.connection',
        data: { client: 'ipad', device_id: uid(50), connected },
      });
    await act(async () => ev(false));
    expect(await screen.findByText(/iPad nicht verbunden/)).toBeInTheDocument();
    await act(async () => ev(true));
    await waitFor(() => expect(screen.queryByText(/iPad nicht verbunden/)).not.toBeInTheDocument());
  });

  it('zeigt einen ruhigen Hinweis, wenn der Core nicht antwortet', async () => {
    core.down = true;
    render(<InkColumn notebookId={uid(NB)} client={client} />);
    expect(await screen.findByText(/Core/)).toBeInTheDocument();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('zeigt eine leere Mappe freundlich an', async () => {
    core.pages.set(uid(NB), []);
    render(<InkColumn notebookId={uid(NB)} client={client} />);
    expect(await screen.findByText(/Noch keine Seite/)).toBeInTheDocument();
  });
});
