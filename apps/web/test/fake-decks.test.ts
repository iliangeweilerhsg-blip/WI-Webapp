// Der Fake-Core für Folien muss dem Vertrag §22 folgen, sonst beweisen die Oberflächen-Tests nichts.
// Hier stehen die Zeilen der Tabelle aus 22.4, die Vorschlagsregel aus 22.2/22.3 und die Vorprüfung des Uploads (22.5).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeckOptions, Session } from '@sg/shared';
import { DeckOptionsSchema } from '@sg/shared';
import {
  installFakeCore,
  makeDeck,
  makeModule,
  makeSession,
  makeSlides,
  type FakeCore,
} from './fake-core.ts';

const MOD = makeModule();
const OTHER = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a2', name: 'Statistik' });
const id = (n: number) => `0190f6a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const S = id(0xe1);
const [A, B, C, FOREIGN] = [id(0xd1), id(0xd2), id(0xd3), id(0xd4)];

let core: FakeCore;

function setup(sessions: Session[] = [makeSession({ id: S, state: 'laeuft', slide_deck_id: null })]) {
  core = installFakeCore({
    modules: [MOD, OTHER],
    sessions,
    decks: [
      makeDeck({ id: A, title: 'A alt', ingest_state: 'verarbeitet', uploaded_at: '2026-10-01T08:00:00Z' }),
      makeDeck({ id: B, title: 'B neu', ingest_state: 'verarbeitet', uploaded_at: '2026-11-01T08:00:00Z' }),
      makeDeck({ id: C, title: 'C kaputt', ingest_state: 'fehler', uploaded_at: '2026-11-02T08:00:00Z' }),
      makeDeck({ id: FOREIGN, module_id: OTHER.id, title: 'Fremd', ingest_state: 'verarbeitet' }),
    ],
  });
  core.slides[A] = makeSlides(A, 2);
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = res.status === 204 ? null : ((await res.json()) as Record<string, unknown>);
  return { status: res.status, json };
}
const options = async (query = `?session_id=${S}`): Promise<DeckOptions> => {
  const { status, json } = await call('GET', `/modules/${MOD.id}/deck-options${query}`);
  expect(status).toBe(200);
  return DeckOptionsSchema.parse(json);
};
const code = (r: { json: Record<string, unknown> | null }) => (r.json?.error as { code: string }).code;

afterEach(() => vi.unstubAllGlobals());

describe('Fake-Core: deck-options (22.3)', () => {
  it('entspricht dem Schema; fehlerhafte Sätze und fremde Module stehen nicht in der Liste', async () => {
    setup();
    const result = await options();
    expect(result.items.map((i) => i.deck.id)).toEqual([B, A]);
    expect(result.suggested_deck_id).toBe(B);
    expect(result.current_deck_id).toBeNull();
    expect(result.lock).toBeNull();
  });

  it('der aktuelle Satz ist immer dabei, auch bei fehler; ohne Vorschlag, wenn die Session einen hat', async () => {
    setup([makeSession({ id: S, state: 'laeuft', slide_deck_id: C })]);
    const result = await options();
    expect(result.items.map((i) => i.deck.id)).toContain(C);
    expect(result.current_deck_id).toBe(C);
    expect(result.suggested_deck_id).toBeNull();
  });

  it('belegte Sätze sind nicht frei (used_by), verpasst belegt nicht, die eigene Session zählt nie', async () => {
    setup([
      makeSession({ id: S, state: 'laeuft', slide_deck_id: null }),
      makeSession({ id: id(0xe6), number: 6, state: 'beendet', slide_deck_id: B }),
      makeSession({ id: id(0xe5), number: 5, state: 'verpasst', slide_deck_id: A }),
    ]);
    const result = await options();
    const byId = Object.fromEntries(result.items.map((i) => [i.deck.id, i]));
    expect(byId[B]).toMatchObject({ free: false, used_by: [{ session_id: id(0xe6), number: 6 }] });
    expect(byId[A]).toMatchObject({ free: true, used_by: [] });
    expect(result.suggested_deck_id).toBe(A);
    // Die Session, die B trägt, sieht ihn als frei
    const own = await options(`?session_id=${id(0xe6)}`);
    expect(own.items.find((i) => i.deck.id === B)?.free).toBe(true);
  });

  it('available_at: Moodle-Datum vor uploaded_at, Reihenfolge absteigend', async () => {
    setup();
    core.deckMeta[A] = { moodle: true, available_at: '2026-11-10T08:00:00Z' };
    const result = await options();
    expect(result.items.map((i) => i.deck.id)).toEqual([A, B]);
    expect(result.items[0]).toMatchObject({ source: 'moodle', available_at: '2026-11-10T08:00:00Z' });
    expect(result.suggested_deck_id).toBe(A);
  });

  it('ein gelöschter Satz an der Session gilt als „kein Satz“ (Vorschlag möglich), der Zeiger sperrt bei Folienwechsel', async () => {
    setup([makeSession({ id: S, state: 'laeuft', slide_deck_id: A })]);
    core.decks.find((d) => d.id === A)!.deleted_at = '2026-11-04T08:00:00Z';
    let result = await options();
    expect(result.current_deck_id).toBeNull();
    expect(result.suggested_deck_id).toBe(B);
    expect(result.lock).toBeNull();
    core.slideEvents = [
      {
        id: id(0x5e1),
        user_id: id(0),
        created_at: '2026-11-04T08:00:00Z',
        updated_at: '2026-11-04T08:00:00Z',
        deleted_at: null,
        session_id: S,
        slide_id: null,
        slide_index: 2,
        t_ms: 1000,
        device: 'mac',
        source: 'manuell_mac',
      },
    ];
    result = await options();
    expect(result.lock).toBe('folienwechsel');
  });

  it('abgeschlossene Session: lock abgeschlossen, kein Vorschlag', async () => {
    setup([makeSession({ id: S, state: 'beendet', slide_deck_id: null })]);
    const result = await options();
    expect(result.lock).toBe('abgeschlossen');
    expect(result.suggested_deck_id).toBeNull();
  });

  it('ohne session_id: kein aktueller Satz, kein lock; leerer Wert gilt als nicht gesetzt', async () => {
    setup();
    for (const query of ['', '?session_id=']) {
      const result = await options(query);
      expect(result).toMatchObject({ session_id: null, current_deck_id: null, lock: null });
    }
  });

  it('Fehler: module_not_found, session_not_found, session_module_mismatch, validation_failed', async () => {
    setup();
    expect(code(await call('GET', `/modules/${id(0x99)}/deck-options`))).toBe('module_not_found');
    expect(code(await call('GET', `/modules/${MOD.id}/deck-options?session_id=${id(0x99)}`))).toBe(
      'session_not_found',
    );
    expect(code(await call('GET', `/modules/${OTHER.id}/deck-options?session_id=${S}`))).toBe(
      'session_module_mismatch',
    );
    const bad = await call('GET', `/modules/${MOD.id}/deck-options?session_id=nope`);
    expect([bad.status, code(bad)]).toEqual([400, 'validation_failed']);
  });
});

describe('Fake-Core: PATCH /sessions/{id} (22.4)', () => {
  const patch = (body: unknown) => call('PATCH', `/sessions/${S}`, body);

  it('setzt, wechselt und leert vor dem ersten Folienwechsel; gleicher Wert ändert nichts', async () => {
    setup();
    const before = core.sessions[0]!.updated_at;
    expect((await patch({ slide_deck_id: A })).json).toMatchObject({ slide_deck_id: A });
    expect(core.decks.find((d) => d.id === A)?.session_id).toBe(S);
    expect((await patch({ slide_deck_id: B })).json).toMatchObject({ slide_deck_id: B });
    // slide_deck.session_id zeigte auf die Session und wird beim Wechsel leer (22.1)
    expect(core.decks.find((d) => d.id === A)?.session_id).toBeNull();
    const same = core.sessions[0]!.updated_at;
    expect(same).not.toBe(before);
    expect((await patch({ slide_deck_id: B })).status).toBe(200);
    expect(core.sessions[0]!.updated_at).toBe(same);
    expect((await patch({ slide_deck_id: null })).json).toMatchObject({ slide_deck_id: null });
  });

  it('abgeschlossen: 409 slide_deck_session_closed mit state, gleicher Wert bleibt 200, title geht immer', async () => {
    setup([makeSession({ id: S, state: 'beendet', slide_deck_id: A })]);
    const closed = await patch({ slide_deck_id: B });
    expect([closed.status, code(closed)]).toEqual([409, 'slide_deck_session_closed']);
    expect((closed.json?.error as { details: unknown }).details).toEqual({ state: 'beendet' });
    expect((await patch({ slide_deck_id: A })).status).toBe(200);
    expect((await patch({ title: 'Neu' })).json).toMatchObject({ title: 'Neu' });
  });

  it('gesperrt: 409 slide_deck_locked mit slide_deck_id und slide_events, auch beim Leeren', async () => {
    setup([makeSession({ id: S, state: 'laeuft', slide_deck_id: A })]);
    core.slideEvents = [
      {
        id: id(0x5e1),
        user_id: id(0),
        created_at: '2026-11-04T08:00:00Z',
        updated_at: '2026-11-04T08:00:00Z',
        deleted_at: null,
        session_id: S,
        slide_id: null,
        slide_index: 2,
        t_ms: 1000,
        device: 'mac',
        source: 'manuell_mac',
      },
    ];
    for (const value of [B, null]) {
      const locked = await patch({ slide_deck_id: value });
      expect([locked.status, code(locked)]).toEqual([409, 'slide_deck_locked']);
      expect((locked.json?.error as { details: unknown }).details).toEqual({
        slide_deck_id: A,
        slide_events: 1,
      });
    }
    expect((await patch({ slide_deck_id: A })).status).toBe(200);
  });

  it('von „kein Satz“ aus gibt es keine Sperre, auch mit slide_event', async () => {
    setup();
    core.slideEvents = [
      {
        id: id(0x5e1),
        user_id: id(0),
        created_at: '2026-11-04T08:00:00Z',
        updated_at: '2026-11-04T08:00:00Z',
        deleted_at: null,
        session_id: S,
        slide_id: null,
        slide_index: 2,
        t_ms: 1000,
        device: 'ipad',
        source: 'manuell_ipad',
      },
    ];
    expect((await patch({ slide_deck_id: A })).status).toBe(200);
  });

  it('404 slide_deck_not_found (fehlt oder gelöscht), 400 slide_deck_module_mismatch, fehler-Satz erlaubt', async () => {
    setup();
    expect(code(await patch({ slide_deck_id: id(0x99) }))).toBe('slide_deck_not_found');
    core.decks.find((d) => d.id === B)!.deleted_at = '2026-11-04T08:00:00Z';
    expect(code(await patch({ slide_deck_id: B }))).toBe('slide_deck_not_found');
    const mismatch = await patch({ slide_deck_id: FOREIGN });
    expect([mismatch.status, code(mismatch)]).toEqual([400, 'slide_deck_module_mismatch']);
    expect((await patch({ slide_deck_id: C })).status).toBe(200);
  });

  it('title und slide_deck_id zusammen: alles oder nichts', async () => {
    setup([makeSession({ id: S, state: 'laeuft', slide_deck_id: null })]);
    const failed = await patch({ title: 'Titel', slide_deck_id: id(0x99) });
    expect(failed.status).toBe(404);
    expect(core.sessions[0]!.title).toBeNull();
    const ok = await patch({ title: 'Titel', slide_deck_id: A });
    expect(ok.json).toMatchObject({ title: 'Titel', slide_deck_id: A });
  });
});

describe('Fake-Core: slide_deck_id bei Anlegen und Start (22.4) und Upload (22.5)', () => {
  it('POST /sessions und Start prüfen den Satz; ein leerer Wert lässt den vorhandenen stehen', async () => {
    setup([makeSession({ id: S, state: 'bereit', started_at: null, slide_deck_id: null })]);
    expect(code(await call('POST', `/sessions/${S}/start`, { slide_deck_id: id(0x99) }))).toBe(
      'slide_deck_not_found',
    );
    expect(code(await call('POST', `/sessions/${S}/start`, { slide_deck_id: FOREIGN }))).toBe(
      'slide_deck_module_mismatch',
    );
    expect(core.sessions[0]!.state).toBe('bereit');
    await call('POST', `/sessions/${S}/start`, { started_from: 'mac' });
    expect(core.sessions[0]).toMatchObject({ state: 'laeuft', slide_deck_id: null });
    // Ein Start auf laeuft ändert den Satz nicht
    await call('POST', `/sessions/${S}/start`, { slide_deck_id: B });
    expect(core.sessions[0]!.slide_deck_id).toBeNull();
    const created = await call('POST', '/sessions', { id: id(0xe9), module_id: MOD.id, slide_deck_id: B });
    expect(created.json).toMatchObject({ slide_deck_id: B });
    expect(
      code(await call('POST', '/sessions', { id: id(0xea), module_id: MOD.id, slide_deck_id: FOREIGN })),
    ).toBe('slide_deck_module_mismatch');
  });

  it('Start mit Feld bei Session mit gültigem Satz: ignoriert, auch veraltet oder gelöscht (200, Satz bleibt)', async () => {
    setup([makeSession({ id: S, state: 'bereit', started_at: null, slide_deck_id: A })]);
    // B gelöscht: ein veralteter Vorschlag lässt den Start nicht scheitern
    core.decks.find((d) => d.id === B)!.deleted_at = '2026-11-02T08:00:00Z';
    const res = await call('POST', `/sessions/${S}/start`, { slide_deck_id: B, started_from: 'mac' });
    expect(res.status).toBe(200);
    expect(core.sessions[0]).toMatchObject({ state: 'laeuft', slide_deck_id: A });
  });

  it('Start mit Feld bei Session ohne gültigen Satz (null, gelöscht, anderes Modul): setzt und prüft', async () => {
    setup([makeSession({ id: S, state: 'bereit', started_at: null, slide_deck_id: A })]);
    core.decks.find((d) => d.id === A)!.deleted_at = '2026-11-02T08:00:00Z';
    expect(code(await call('POST', `/sessions/${S}/start`, { slide_deck_id: id(0x99) }))).toBe(
      'slide_deck_not_found',
    );
    expect((await call('POST', `/sessions/${S}/start`, { slide_deck_id: B })).status).toBe(200);
    expect(core.sessions[0]!.slide_deck_id).toBe(B);
    // Zeiger auf einen Satz eines anderen Moduls zählt wie „kein Satz“
    setup([makeSession({ id: S, state: 'bereit', started_at: null, slide_deck_id: FOREIGN })]);
    expect((await call('POST', `/sessions/${S}/start`, { slide_deck_id: B })).status).toBe(200);
    expect(core.sessions[0]!.slide_deck_id).toBe(B);
  });

  async function upload(sessionId: string, name = 'x.pdf') {
    const form = new FormData();
    form.set('file', new File([new Uint8Array(500)], name, { type: 'application/pdf' }));
    form.set('module_id', MOD.id);
    form.set('session_id', sessionId);
    const res = await fetch('/api/v1/slide-decks', {
      method: 'POST',
      body: form,
      headers: { 'Idempotency-Key': name },
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  it('Upload mit session_id: hängt nur an, ersetzt nie; abgeschlossen, unbekannt, fremdes Modul scheitern vorher', async () => {
    setup([
      makeSession({ id: S, state: 'laeuft', slide_deck_id: null }),
      makeSession({ id: id(0xe2), state: 'beendet' }),
      makeSession({ id: id(0xe3), state: 'laeuft', module_id: OTHER.id }),
    ]);
    const decksBefore = core.decks.length;
    expect(code(await upload(id(0xe2), 'a.pdf'))).toBe('slide_deck_session_closed');
    expect(code(await upload(id(0x99), 'b.pdf'))).toBe('session_not_found');
    expect(code(await upload(id(0xe3), 'c.pdf'))).toBe('session_module_mismatch');
    expect(core.decks).toHaveLength(decksBefore);

    const first = await upload(S, 'd.pdf');
    expect(first.status).toBe(201);
    expect(core.sessions[0]!.slide_deck_id).toBe(first.json.id);
    // Die Session hat nun einen Satz: Ein zweiter Upload legt nur an
    const second = await upload(S, 'e.pdf');
    expect(second.status).toBe(201);
    expect(core.sessions[0]!.slide_deck_id).toBe(first.json.id);
  });
});
