// Rückblick, rechte Spalte (A1, F-NAC-02 Rest, F-NAC-04 ohne Wiedergabe-Modus): Notizseiten, Marker und Fotos je Folie,
// Tipp auf einen Strich spielt ab `t_start_ms − 3 s`, nur sichtbare Seiten laden und zeichnen (#79). Alle Daten sind erfunden.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Page, Stroke } from '@sg/shared';
import { ReviewView } from '../src/components/rueckblick/ReviewView.tsx';
import {
  PRE_ROLL_MS,
  notesForSlide,
  pageSlideKey,
  playbackStart,
} from '../src/components/rueckblick/notes.ts';
import { buildHitIndex, hitTest } from '../src/components/rueckblick/stroke-hit.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { SyncProvider } from '../src/lib/sync/SyncProvider.tsx';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { installAudioStub, type AudioStub } from './audio-stub.ts';
import { installCanvasMock } from './canvas-mock.ts';
import {
  installFakeCore,
  makeDeck,
  makeLine,
  makeMarker,
  makeModule,
  makeNotePage,
  makeNotebook,
  makePhoto,
  makeRecording,
  makeSemester,
  makeSession,
  makeSlideSegment,
  makeSlides,
  makeTranscript,
  makeTranscriptInfo,
  type FakeCore,
} from './fake-core.ts';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/rueckblick',
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn() }),
}));

const uid = (n: number) => `0190f6a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const DBS = makeModule({ id: uid(0xa3), name: 'Datenbanksysteme' });
const SESSION_ID = uid(0xe1);
const DECK_ID = uid(0xd1);
const R1 = uid(0xf1);
const NB = uid(0xb1);
const STARTED = '2026-11-04T08:00:00Z';
const S = makeSlides(DECK_ID, 3).map((s) => ({ id: s.id, index: s.index }));
const [S1, S2, S3] = S as [(typeof S)[0], (typeof S)[0], (typeof S)[0]];

// ── Striche (erfunden) ────────────────────────────────────────────────────────────────────────────────────────────

/** Ein Strich aus Punkten (x, y); `t0` = Beginn in Sitzungszeit (ms) oder `null` (außerhalb einer Session) */
function stroke(
  n: number,
  pts: [number, number][],
  t0: number | null,
  layer: Stroke['layer'] = 'ink',
): Stroke {
  const raw = new Float32Array(pts.length * 6);
  pts.forEach(([x, y], i) => raw.set([x, y, i === 0 ? 0 : 10, 0.5, 0, 1.2], i * 6));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    client_id: uid(100_000 + n),
    tool: layer === 'highlight' ? 'highlighter' : 'pen',
    layer,
    color: '#1E2A44FF',
    width: layer === 'highlight' ? 14 : 2,
    created_at: 1_762_246_500_000 + n,
    t_start_ms: t0,
    t_end_ms: t0 === null ? null : t0 + 10 * (pts.length - 1),
    transform: [1, 0, 0, 1, 0, 0],
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    points: Buffer.from(raw.buffer).toString('base64'),
  } as unknown as Stroke;
}

/** Waagerechte Linie bei Höhe `y` von `x0` bis `x1` */
const line = (n: number, y: number, t0: number | null, x0 = 50, x1 = 250, layer: Stroke['layer'] = 'ink') =>
  stroke(
    n,
    [
      [x0, y],
      [(x0 + x1) / 2, y],
      [x1, y],
    ],
    t0,
    layer,
  );

describe('Notizen: Hilfen', () => {
  it('beginnt die Wiedergabe 3 s vor dem Strich, nie unter 0', () => {
    expect(PRE_ROLL_MS).toBe(3000);
    expect(playbackStart(300_000)).toBe(297_000);
    expect(playbackStart(2_000)).toBe(0);
    expect(playbackStart(0)).toBe(0);
  });

  it('ordnet Seiten über die angeheftete Folie zu, sonst über den Hintergrund, sonst „ohne Folie“', () => {
    expect(pageSlideKey({ attached_slide_id: S1.id, background_slide_id: S2.id })).toBe(S1.id);
    expect(pageSlideKey({ attached_slide_id: null, background_slide_id: S2.id })).toBe(S2.id);
    expect(pageSlideKey({ attached_slide_id: null, background_slide_id: null })).toBe('none');
  });

  it('ordnet Marker und Fotos über ihre Seite, sonst über die Folie zur Zeit zu', () => {
    const pages = [makeNotePage({ id: uid(1), attached_slide_id: S2.id })];
    const segments = [makeSlideSegment(1, S1, 0, 100_000), makeSlideSegment(2, S2, 100_000, 200_000)];
    const markers = [
      makeMarker({ id: uid(11), t_ms: 10_000 }), // Zeit → Folie 1
      makeMarker({ id: uid(12), t_ms: 20_000, page_id: uid(1) }), // Seite → Folie 2, trotz Zeit auf Folie 1
      makeMarker({ id: uid(13), t_ms: 150_000 }), // Zeit → Folie 2
      makeMarker({ id: uid(14), t_ms: 250_000 }), // nach der letzten Folie → ohne Folie
    ];
    const photos = [makePhoto({ id: uid(21), t_ms: 150_000 })];
    const all = { pages, markers, photos };
    expect(notesForSlide(S1.id, all, segments).markers.map((m) => m.id)).toEqual([uid(11)]);
    expect(notesForSlide(S2.id, all, segments).markers.map((m) => m.id)).toEqual([uid(12), uid(13)]);
    expect(notesForSlide(S2.id, all, segments).photos).toHaveLength(1);
    expect(notesForSlide('none', all, segments).markers.map((m) => m.id)).toEqual([uid(14)]);
    expect(notesForSlide(null, all, segments).markers).toHaveLength(4);
    expect(notesForSlide(S1.id, all, segments).pages).toHaveLength(0);
  });

  it('lässt gelöschte Marker und Fotos weg', () => {
    const all = {
      pages: [],
      markers: [makeMarker({ deleted_at: '2026-11-05T08:00:00Z' })],
      photos: [makePhoto({ deleted_at: '2026-11-05T08:00:00Z' })],
    };
    const r = notesForSlide(null, all, []);
    expect(r.markers).toHaveLength(0);
    expect(r.photos).toHaveLength(0);
  });
});

describe('Notizen: Treffer auf Striche', () => {
  it('trifft den Strich unter dem Tipp, auch knapp daneben, aber nicht weit weg', () => {
    const index = buildHitIndex([line(1, 100, 1000), line(2, 300, 2000)]);
    expect(hitTest(index, 150, 102, 8)?.t).toBe(1000);
    expect(hitTest(index, 150, 305, 8)?.t).toBe(2000);
    expect(hitTest(index, 150, 200, 8)).toBeNull();
    expect(hitTest(index, 400, 100, 8)).toBeNull();
  });

  it('überspringt Striche ohne Zeit und sortiert die übrigen nach Zeit', () => {
    const index = buildHitIndex([line(1, 100, 5000), line(2, 200, null), line(3, 300, 1000)]);
    expect(index.timed.map((e) => e.t)).toEqual([1000, 5000]);
    expect(hitTest(index, 150, 200, 8)).toBeNull();
  });

  it('bevorzugt Tinte vor einem Textmarker darunter', () => {
    const index = buildHitIndex([line(1, 100, 1000, 50, 250, 'highlight'), line(2, 104, 2000)]);
    expect(hitTest(index, 150, 102, 8)?.t).toBe(2000);
    // Wo nur der Textmarker liegt, trifft er
    expect(hitTest(index, 150, 96, 2)?.t).toBe(1000);
  });

  it('bleibt bei 20 000 Strichen schnell', () => {
    const many: Stroke[] = [];
    for (let i = 0; i < 20_000; i++) {
      const y = 20 + (i % 80) * 10;
      const x0 = 20 + Math.floor(i / 80) * 2;
      many.push(line(i, y, i * 10, x0, x0 + 40));
    }
    const index = buildHitIndex(many);
    expect(index.timed).toHaveLength(20_000);
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) hitTest(index, 100 + i, 100, 6);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

// ── Bildschirm ────────────────────────────────────────────────────────────────────────────────────────────────────

const nowIO: { instances: FakeIO[] } = { instances: [] };
class FakeIO {
  disconnected = false;
  els = new Set<Element>();
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    nowIO.instances.push(this);
  }
  observe(el: Element) {
    this.els.add(el);
  }
  unobserve(el: Element) {
    this.els.delete(el);
  }
  disconnect() {
    this.disconnected = true;
    this.els.clear();
  }
  takeRecords() {
    return [];
  }
  fire(el: Element, isIntersecting: boolean) {
    this.cb(
      [{ target: el, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function fakeSync() {
  return {
    connectionState: 'online',
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    onEvent: vi.fn(() => () => undefined),
    takeOver: vi.fn(),
    listShelf: vi.fn(async () => []),
    subscribe: vi.fn(),
  } as unknown as SyncClient;
}

let core: FakeCore;
let stub: AudioStub;
let restoreRect: (() => void) | null = null;

function boot(setup?: (core: FakeCore) => void) {
  nav.search = `id=${SESSION_ID}`;
  core = installFakeCore({
    semesters: [makeSemester()],
    modules: [DBS],
    decks: [makeDeck({ id: DECK_ID })],
    sessions: [
      makeSession({
        id: SESSION_ID,
        module_id: DBS.id,
        number: 7,
        state: 'verarbeitet',
        started_at: STARTED,
        ended_at: '2026-11-04T09:00:00Z',
        slide_deck_id: DECK_ID,
        processing: { 'audio.finalize': 'fertig', transcribe: 'fertig', 'align.log': 'fertig' },
      }),
    ],
  });
  core.finishIngest(DECK_ID, 3);
  core.notebooks.push(makeNotebook({ id: NB, module_id: DBS.id, kind: 'vorlesung', title: 'Vorlesung' }));
  core.transcripts[SESSION_ID] = makeTranscript({
    session_id: SESSION_ID,
    slide_deck_id: DECK_ID,
    slide_source: 'log',
    slide_segments: [
      makeSlideSegment(1, S1, 10_000, 200_000),
      makeSlideSegment(2, S2, 200_000, 500_000),
      makeSlideSegment(3, S3, 500_000, 600_000),
    ],
    recordings: [makeRecording({ id: R1, started_ms: 0, duration_ms: 600_000 })],
    transcripts: [makeTranscriptInfo()],
    lines: [
      makeLine(1, 10_000, 20_000, 'Heute geht es um Normalformen.', S1),
      makeLine(2, 200_000, 230_000, 'Die dritte Normalform ist klausurrelevant.', S2),
    ],
  });
  setup?.(core);
  return render(
    <QueryProvider>
      <SyncProvider client={fakeSync()}>
        <ReviewView />
      </SyncProvider>
    </QueryProvider>,
  );
}

const audio = () =>
  document.querySelector<HTMLAudioElement>(`audio[data-recording="${R1}"]`) as HTMLAudioElement;
const notePage = (id: number): Page => makeNotePage({ id: uid(id), notebook_id: NB, session_id: SESSION_ID });
const strokeGets = () =>
  core.requests.filter((r) => r.method === 'GET' && /\/pages\/[^/]+\/strokes/.test(r.path));

beforeEach(() => {
  stub = installAudioStub();
  installCanvasMock();
  nowIO.instances = [];
  // jsdom hat keine Größen: Die Notizseite misst 595 × 842 Pixel = 1 Pixel je pt
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 595,
      height: 842,
      right: 595,
      bottom: 842,
      toJSON: () => ({}),
    };
  };
  restoreRect = () => {
    Element.prototype.getBoundingClientRect = original;
  };
});
afterEach(() => {
  stub.restore();
  restoreRect?.();
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Rückblick: rechte Spalte', () => {
  it('zeigt zur gewählten Folie Notizseiten, Marker und Fotos und wechselt mit der Folie', async () => {
    boot((c) => {
      c.pages.push(
        { ...notePage(1), index: 1, attached_slide_id: S1.id },
        { ...notePage(2), index: 2, attached_slide_id: S2.id },
        { ...notePage(3), index: 3, attached_slide_id: S1.id },
      );
      c.markers.push(
        makeMarker({ id: uid(11), session_id: SESSION_ID, t_ms: 15_000, kind: 'frage', note: 'Warum 3NF?' }),
        makeMarker({ id: uid(12), session_id: SESSION_ID, t_ms: 210_000, kind: 'klausur' }),
      );
      c.photos.push(makePhoto({ id: uid(21), session_id: SESSION_ID, t_ms: 12_000 }));
    });
    expect(await screen.findByRole('heading', { name: 'Meine Notizen (2)' })).toBeVisible();
    expect(screen.getAllByTestId('note-page')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Marker (1)' })).toBeVisible();
    expect(screen.getByTestId('note-marker')).toHaveTextContent('Frage: Warum 3NF?');
    expect(screen.getByRole('heading', { name: 'Fotos (1)' })).toBeVisible();
    expect(screen.getByRole('img', { name: /Tafel-Foto/ })).toHaveAttribute(
      'src',
      expect.stringContaining(`/photos/${uid(21)}/file`),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Nächste Folie' }));
    expect(await screen.findByRole('heading', { name: 'Meine Notizen (1)' })).toBeVisible();
    expect(screen.getByTestId('note-marker')).toHaveTextContent('Klausur');
    expect(screen.getByRole('heading', { name: 'Fotos (0)' })).toBeVisible();
    expect(screen.getByText('Keine Fotos.')).toBeVisible();
  });

  it('zeigt leere Bereiche als ruhige Zeilen', async () => {
    boot();
    expect(await screen.findByText('Dazu gibt es keine Notizseite.')).toBeVisible();
    expect(screen.getByText('Keine Marker.')).toBeVisible();
    expect(screen.getByText('Keine Fotos.')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ein Tipp auf einen Strich spielt die Aufnahme 3 s davor ab', async () => {
    boot((c) => {
      c.pages.push({ ...notePage(1), attached_slide_id: S1.id });
      c.strokes[uid(1)] = [line(1, 100, 100_000), line(2, 300, 150_000)];
    });
    const hit = await screen.findByTestId('note-hit');
    // Tipp auf den zweiten Strich (y = 300)
    fireEvent.click(hit, { clientX: 150, clientY: 302 });
    await waitFor(() => expect(stub.started.at(-1)).toMatchObject({ id: R1, at: 147 }));
    expect(audio().currentTime).toBe(147);
    expect(screen.getByTestId('note-picked-box')).toBeInTheDocument();
    // Tipp ins Leere ändert nichts und wählt ab
    const plays = stub.started.length;
    fireEvent.click(hit, { clientX: 500, clientY: 600 });
    expect(stub.started).toHaveLength(plays);
    expect(screen.queryByTestId('note-picked-box')).toBeNull();
  });

  it('beginnt bei einem Strich in den ersten Sekunden bei 0', async () => {
    boot((c) => {
      c.pages.push({ ...notePage(1), attached_slide_id: S1.id });
      c.strokes[uid(1)] = [line(1, 100, 1_500)];
    });
    fireEvent.click(await screen.findByTestId('note-hit'), { clientX: 150, clientY: 100 });
    await waitFor(() => expect(stub.started.at(-1)).toMatchObject({ id: R1, at: 0 }));
  });

  it('bedient Striche mit der Tastatur: Pfeile wählen, Enter spielt ab', async () => {
    boot((c) => {
      c.pages.push({ ...notePage(1), attached_slide_id: S1.id });
      c.strokes[uid(1)] = [line(2, 300, 150_000), line(1, 100, 100_000)];
    });
    const hit = await screen.findByTestId('note-hit');
    hit.focus();
    expect(hit).toHaveFocus();
    // Nach Zeit sortiert: erst der Strich bei 100 s
    fireEvent.keyDown(hit, { key: 'ArrowRight' });
    expect(screen.getByTestId('note-picked')).toBeInTheDocument();
    expect(screen.getByText(/Strich 1 von 2/)).toBeInTheDocument();
    fireEvent.keyDown(hit, { key: 'ArrowRight' });
    expect(screen.getByText(/Strich 2 von 2/)).toBeInTheDocument();
    fireEvent.keyDown(hit, { key: 'ArrowLeft' });
    fireEvent.keyDown(hit, { key: 'Enter' });
    await waitFor(() => expect(stub.started.at(-1)).toMatchObject({ id: R1, at: 97 }));
    fireEvent.keyDown(hit, { key: 'Escape' });
    expect(screen.queryByTestId('note-picked')).toBeNull();
  });

  it('Marker und Foto-Zeit spielen 3 s davor ab', async () => {
    boot((c) => {
      c.markers.push(makeMarker({ id: uid(11), session_id: SESSION_ID, t_ms: 15_000 }));
      c.photos.push(makePhoto({ id: uid(21), session_id: SESSION_ID, t_ms: 12_000 }));
    });
    fireEvent.click(await screen.findByTestId('note-marker'));
    await waitFor(() => expect(stub.started.at(-1)).toMatchObject({ at: 12 }));
    fireEvent.click(screen.getByRole('button', { name: /Aufnahme ab Foto/ }));
    await waitFor(() => expect(stub.started.at(-1)).toMatchObject({ at: 9 }));
  });

  it('zeigt Fotos ohne Datei als ruhigen Hinweis', async () => {
    boot((c) => {
      c.photos.push(makePhoto({ id: uid(21), session_id: SESSION_ID, t_ms: 12_000, has_file: false }));
    });
    expect(await screen.findByText('Das Foto kommt noch.')).toBeVisible();
  });

  it('meldet, wenn die Notizen nicht ladbar sind, mit „Erneut versuchen“', async () => {
    boot((c) => {
      c.failNotebooks = true;
    });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
    // Die Transkript-Spalte bleibt bedienbar
    expect(screen.getByTestId('transcript-line')).toBeVisible();
  });
});

describe('Rückblick: Leistung bei vielen Seiten und Strichen (#79)', () => {
  it('lädt und zeichnet nur sichtbare Seiten und trennt die Beobachter beim Abräumen', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIO);
    const many = Array.from({ length: 6 }, (_, i) => i + 1);
    const view = boot((c) => {
      for (const i of many) {
        c.pages.push({ ...notePage(i), index: i, attached_slide_id: S1.id });
        // 3000 erfundene Striche je Seite
        c.strokes[uid(i)] = Array.from({ length: 3000 }, (_, k) =>
          line(i * 10_000 + k, 20 + (k % 80) * 10, k * 10, 20 + Math.floor(k / 80), 60 + Math.floor(k / 80)),
        );
      }
    });
    const cards = await screen.findAllByTestId('note-page');
    expect(cards).toHaveLength(6);
    // Noch ist keine Seite sichtbar: keine Strichabfrage, kein Canvas
    expect(strokeGets()).toHaveLength(0);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);

    // Zwei Seiten kommen ins Bild
    const boxes = cards.map((c) => c.querySelector('div.relative') as HTMLElement);
    const observerOf = (el: Element) => nowIO.instances.find((o) => o.els.has(el))!;
    act(() => {
      observerOf(boxes[0]!).fire(boxes[0]!, true);
      observerOf(boxes[1]!).fire(boxes[1]!, true);
    });
    await waitFor(() => expect(strokeGets()).toHaveLength(2));
    await waitFor(() => expect(document.querySelectorAll('canvas').length).toBe(6)); // 2 Seiten × 3 Ebenen
    expect(cards.filter((c) => c.getAttribute('data-in-view') === 'true')).toHaveLength(2);

    // Eine verlässt das Bild: Canvas weg, die Abfrage bleibt bei zwei
    act(() => observerOf(boxes[0]!).fire(boxes[0]!, false));
    await waitFor(() => expect(document.querySelectorAll('canvas').length).toBe(3));
    expect(strokeGets()).toHaveLength(2);

    view.unmount();
    expect(nowIO.instances.length).toBeGreaterThanOrEqual(6);
    expect(nowIO.instances.every((o) => o.disconnected)).toBe(true);
  });

  it('wechselt die Folie, ohne Beobachter zurückzulassen', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIO);
    boot((c) => {
      c.pages.push(
        { ...notePage(1), attached_slide_id: S1.id },
        { ...notePage(2), index: 2, attached_slide_id: S2.id },
      );
    });
    await screen.findAllByTestId('note-page');
    const before = nowIO.instances.length;
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Folie' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Meine Notizen (1)' })).toBeVisible());
    // Alle Beobachter der verschwundenen Seite sind getrennt; aktiv ist höchstens einer je sichtbarer Seite
    const live = nowIO.instances.filter((o) => !o.disconnected);
    expect(live.length).toBeLessThanOrEqual(1);
    expect(nowIO.instances.length).toBeGreaterThan(before - 1);
  });
});
