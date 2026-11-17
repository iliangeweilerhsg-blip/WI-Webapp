// Fake-Core: Folien in der Vorlesung (VERTRAEGE §22.2 bis §22.5), streng nach Vertrag.
// `GET /modules/{id}/deck-options`, die Regeln für `PATCH /sessions/{id}` (22.4), `slide_deck_id` bei Anlegen und Start
// und der Upload mit `session_id` (22.5). Die Routen in `fake-core.ts` rufen nur diese Funktionen.
import type { DeckLock, DeckOption, DeckOptions, Module, Session, SlideDeck, SlideEvent } from '@sg/shared';

/** Der Teil des Fake-Core, den dieser Baustein braucht */
export interface DeckCore {
  modules: Module[];
  decks: SlideDeck[];
  sessions: Session[];
  slideEvents: SlideEvent[];
  /** Herkunft und Verfügbarkeit je Satz (`moodle_item`); ohne Eintrag: Upload, `available_at = uploaded_at` */
  deckMeta: Record<string, { moodle?: boolean; available_at?: string }>;
}

export interface DeckResult {
  status: number;
  body: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLOSED = ['beendet', 'verarbeitet', 'verpasst'];
/** Sessions, die einen Satz belegen (22.2): `verpasst` belegt nicht */
const OCCUPYING = ['geplant', 'bereit', 'laeuft', 'pausiert', 'beendet', 'verarbeitet'];

const fail = (status: number, code: string, details?: Record<string, unknown>): DeckResult => ({
  status,
  body: { error: { code, message: 'x', ...(details ? { details } : {}) } },
});

const live = (d: SlideDeck | undefined): d is SlideDeck => d !== undefined && d.deleted_at === null;

function liveEvents(core: DeckCore, sessionId: string): number {
  return core.slideEvents.filter((e) => e.session_id === sessionId && e.deleted_at === null).length;
}

/** Der nicht gelöschte Satz einer Session, sonst `null` (gelöscht zählt wie „kein Satz“, 22.2) */
function currentDeck(core: DeckCore, session: Session): SlideDeck | null {
  const deck = core.decks.find((d) => d.id === session.slide_deck_id);
  return live(deck) ? deck : null;
}

function availableAt(core: DeckCore, deck: SlideDeck): string {
  return core.deckMeta[deck.id]?.available_at ?? deck.uploaded_at;
}

function byAvailable(core: DeckCore) {
  return (a: SlideDeck, b: SlideDeck) =>
    Date.parse(availableAt(core, b)) - Date.parse(availableAt(core, a)) || b.id.localeCompare(a.id);
}

/** Sessions, die den Satz belegen, ohne die anfragende (22.3: `used_by` und `free`) */
function occupants(core: DeckCore, deckId: string, exceptSessionId: string | null): Session[] {
  return core.sessions
    .filter(
      (s) =>
        s.deleted_at === null &&
        s.id !== exceptSessionId &&
        s.slide_deck_id === deckId &&
        OCCUPYING.includes(s.state),
    )
    .sort(
      (a, b) =>
        Date.parse(b.started_at ?? b.created_at) - Date.parse(a.started_at ?? a.created_at) ||
        b.id.localeCompare(a.id),
    );
}

function toOption(core: DeckCore, deck: SlideDeck, sessionId: string | null): DeckOption {
  const users = occupants(core, deck.id, sessionId);
  return {
    deck: structuredClone(deck),
    available_at: availableAt(core, deck),
    source: core.deckMeta[deck.id]?.moodle ? 'moodle' : 'upload',
    free: users.length === 0,
    used_by: users.slice(0, 3).map((s) => ({ session_id: s.id, number: s.number, title: s.title })),
  };
}

/** `GET /modules/{id}/deck-options?session_id` (22.3) */
export function deckOptions(core: DeckCore, moduleId: string, url: URL): DeckResult {
  const module = core.modules.find((m) => m.id === moduleId && m.deleted_at === null);
  if (!module) return fail(404, 'module_not_found');
  const raw = url.searchParams.get('session_id');
  // Ein leerer Wert gilt als nicht gesetzt, eine ungültige UUID ergibt 400
  const sessionId = raw === null || raw === '' ? null : raw;
  if (sessionId !== null && !UUID.test(sessionId)) return fail(400, 'validation_failed');
  const session =
    sessionId === null
      ? null
      : (core.sessions.find((s) => s.id === sessionId && s.deleted_at === null) ?? null);
  if (sessionId !== null && !session) return fail(404, 'session_not_found');
  if (session && session.module_id !== moduleId) return fail(400, 'session_module_mismatch');

  const current = session ? currentDeck(core, session) : null;
  const closed = session ? CLOSED.includes(session.state) : false;
  const selectable = core.decks
    .filter((d) => live(d) && d.module_id === moduleId && d.ingest_state !== 'fehler')
    .sort(byAvailable(core));
  const withOptions = selectable.map((d) => toOption(core, d, sessionId));
  const hasDeck = current !== null;
  const suggested = hasDeck || closed ? null : (withOptions.find((o) => o.free) ?? null);

  // Der aktuelle Satz und der Vorschlag sind immer dabei (auch jenseits der 50 und bei `fehler`)
  const items = withOptions.slice(0, 50);
  for (const must of [current, suggested?.deck ?? null]) {
    if (must && !items.some((o) => o.deck.id === must.id)) items.push(toOption(core, must, sessionId));
  }
  items.sort((a, b) => byAvailable(core)(a.deck, b.deck));

  let lock: DeckLock | null = null;
  if (session && closed) lock = 'abgeschlossen';
  else if (session && session.slide_deck_id !== null && liveEvents(core, session.id) > 0) {
    lock = 'folienwechsel';
  }

  const body: DeckOptions = {
    module_id: moduleId,
    session_id: sessionId,
    current_deck_id: current?.id ?? null,
    suggested_deck_id: suggested?.deck.id ?? null,
    lock,
    items,
  };
  return { status: 200, body };
}

/** Prüft einen neuen Satz für eine Session des Moduls (404 `slide_deck_not_found`, 400 `slide_deck_module_mismatch`) */
export function checkNewDeck(core: DeckCore, deckId: string, moduleId: string): DeckResult | null {
  const deck = core.decks.find((d) => d.id === deckId);
  if (!live(deck)) return fail(404, 'slide_deck_not_found');
  if (deck.module_id !== moduleId) return fail(400, 'slide_deck_module_mismatch');
  return null;
}

/**
 * `PATCH /sessions/{id}` (22.4): `title` allein gilt in jedem Zustand. Mit `slide_deck_id` gilt die erste zutreffende
 * Zeile der Tabelle. Alles oder nichts: `updated_at` ändert sich nur, wenn sich etwas geändert hat.
 */
export function patchSession(
  core: DeckCore,
  session: Session,
  body: Record<string, unknown> | null,
): DeckResult {
  const patch = body ?? {};
  const hasTitle = 'title' in patch;
  const hasDeck = 'slide_deck_id' in patch;
  if (hasTitle && patch.title !== null && typeof patch.title !== 'string')
    return fail(400, 'validation_failed');
  const wanted = patch.slide_deck_id;
  if (hasDeck && wanted !== null && (typeof wanted !== 'string' || !UUID.test(wanted))) {
    return fail(400, 'validation_failed');
  }
  let changed = false;
  let nextDeck: string | null = session.slide_deck_id;
  if (hasDeck) {
    const value = (wanted ?? null) as string | null;
    if (value !== session.slide_deck_id) {
      if (CLOSED.includes(session.state)) {
        return fail(409, 'slide_deck_session_closed', { state: session.state });
      }
      const events = liveEvents(core, session.id);
      if (session.slide_deck_id !== null && events > 0) {
        return fail(409, 'slide_deck_locked', { slide_deck_id: session.slide_deck_id, slide_events: events });
      }
      if (value !== null) {
        const rejected = checkNewDeck(core, value, session.module_id);
        if (rejected) return rejected;
      }
      nextDeck = value;
      changed = true;
    }
  }
  if (hasTitle && (patch.title ?? null) !== session.title) changed = true;
  if (!changed) return { status: 200, body: structuredClone(session) };

  const old = core.decks.find((d) => d.id === session.slide_deck_id);
  if (nextDeck !== session.slide_deck_id) {
    // Alter Satz: `slide_deck.session_id` wird leer, wenn es auf diese Session zeigte (22.1)
    if (old && old.session_id === session.id) old.session_id = null;
    const fresh = nextDeck ? core.decks.find((d) => d.id === nextDeck) : undefined;
    if (fresh && fresh.session_id === null) fresh.session_id = session.id;
    session.slide_deck_id = nextDeck;
  }
  if (hasTitle) session.title = (patch.title ?? null) as string | null;
  session.updated_at = new Date().toISOString();
  return { status: 200, body: structuredClone(session) };
}

/**
 * `slide_deck_id` bei `POST /sessions` und `POST /sessions/{id}/start` (22.4): prüft den Satz. Ein leerer Wert lässt den
 * vorhandenen stehen. Gibt den Fehler zurück oder `null`; gesetzt wird mit {@link applyDeck}.
 */
export function checkDeckField(
  core: DeckCore,
  moduleId: string,
  value: unknown,
  session?: Session,
): DeckResult | null {
  if (value === undefined || value === null || value === '') return null;
  // Hat die Session schon einen gültigen Satz, ignoriert der Core das Feld: keine Prüfung, kein Fehler (22.4)
  if (session && hasValidDeck(core, session)) return null;
  if (typeof value !== 'string' || !UUID.test(value)) return fail(400, 'validation_failed');
  return checkNewDeck(core, value, moduleId);
}

/** Gültiger Satz: Zeiger gesetzt, Satz nicht gelöscht und aus dem Modul der Session (22.4) */
function hasValidDeck(core: DeckCore, session: Session): boolean {
  const deck = currentDeck(core, session);
  return deck !== null && deck.module_id === session.module_id;
}

export function applyDeck(core: DeckCore, session: Session, value: unknown): void {
  if (typeof value !== 'string' || value === '') return;
  if (hasValidDeck(core, session)) return;
  session.slide_deck_id = value;
  const deck = core.decks.find((d) => d.id === value);
  if (deck && deck.session_id === null) deck.session_id = session.id;
}

/** `POST /slide-decks` mit `session_id`: Vorprüfung vor dem Ablegen der Datei (22.5) */
export function checkUploadSession(
  core: DeckCore,
  moduleId: string,
  sessionId: string,
): { session: Session } | DeckResult {
  const session = core.sessions.find((s) => s.id === sessionId && s.deleted_at === null);
  if (!session) return fail(404, 'session_not_found');
  if (session.module_id !== moduleId) return fail(400, 'session_module_mismatch');
  if (CLOSED.includes(session.state)) {
    return fail(409, 'slide_deck_session_closed', { state: session.state });
  }
  return { session };
}

/**
 * Hängt den hochgeladenen Satz (oder die Dublette) an die Session, wenn sie keinen Satz hat (22.5). Ersetzt nie.
 * Ein Zeiger auf einen gelöschten Satz ohne `slide_event` zählt als „kein Satz“.
 */
export function attachUpload(core: DeckCore, session: Session, deck: SlideDeck): void {
  const pointed = core.decks.find((d) => d.id === session.slide_deck_id);
  const free = session.slide_deck_id === null || (!live(pointed) && liveEvents(core, session.id) === 0);
  if (!free) return;
  if (pointed && pointed.session_id === session.id) pointed.session_id = null;
  session.slide_deck_id = deck.id;
  session.updated_at = new Date().toISOString();
  if (deck.session_id === null) deck.session_id = session.id;
}
