// Wählbare Foliensätze eines Moduls und Vorschlag für eine Session (VERTRAEGE §22.2, §22.3).
// Nur lesend, keine Sperre: Die Antwort ist eine Momentaufnahme. Verbindlich prüft erst `PATCH /sessions/{id}`.
import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { DeckLock, DeckOption, DeckOptions, DeckUse } from '@sg/shared';
import type { DbOrTx } from '../db/client.ts';
import { courseModule, moodleItem, notDeleted, session, slideDeck, slideEvent } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { toApiDeck } from './material.ts';
import { CLOSED_SESSION_STATES, OCCUPYING_SESSION_STATES } from './sessions.ts';

/** Höchstens so viele Sätze in `items` (der aktuelle Satz und der Vorschlag kommen immer dazu) */
export const DECK_OPTIONS_LIMIT = 50;
/** Höchstens so viele Sessions in `used_by` */
const USED_BY_LIMIT = 3;

export async function getDeckOptions(
  db: DbOrTx,
  moduleId: string,
  sessionId: string | undefined,
): Promise<DeckOptions> {
  const [mod] = await db
    .select({ id: courseModule.id })
    .from(courseModule)
    .where(and(eq(courseModule.id, moduleId), notDeleted(courseModule)));
  if (!mod) throw new HttpError(404, 'module_not_found', 'Das Modul wurde nicht gefunden.');

  let own: { state: string; slideDeckId: string | null } | undefined;
  if (sessionId) {
    const [row] = await db
      .select({ moduleId: session.moduleId, state: session.state, slideDeckId: session.slideDeckId })
      .from(session)
      .where(and(eq(session.id, sessionId), notDeleted(session)));
    if (!row) throw new HttpError(404, 'session_not_found', 'Die Session wurde nicht gefunden.');
    if (row.moduleId !== moduleId) {
      throw new HttpError(400, 'session_module_mismatch', 'Die Session gehört zu einem anderen Modul.');
    }
    own = row;
  }

  // Wählbar: nicht gelöscht, nicht `fehler`. Der aktuelle Satz der Session kommt immer dazu (auch bei `fehler`).
  const pointer = own?.slideDeckId ?? null;
  const deckRows = await db
    .select()
    .from(slideDeck)
    .where(
      and(
        eq(slideDeck.moduleId, moduleId),
        notDeleted(slideDeck),
        pointer
          ? sql`(${slideDeck.ingestState} <> 'fehler' OR ${slideDeck.id} = ${pointer})`
          : ne(slideDeck.ingestState, 'fehler'),
      ),
    );
  const deckIds = deckRows.map((d) => d.id);

  // Verfügbar seit: größtes `timemodified` der Moodle-Dateien (NULL zählt nicht), sonst `uploaded_at`
  const moodle = new Map<string, Date | null>();
  if (deckIds.length > 0) {
    const rows = await db
      .select({
        deckId: moodleItem.slideDeckId,
        latest: sql<Date | null>`max(${moodleItem.timemodified})`.mapWith(moodleItem.timemodified),
      })
      .from(moodleItem)
      .where(and(isNotNull(moodleItem.slideDeckId), inArray(moodleItem.slideDeckId, deckIds)))
      .groupBy(moodleItem.slideDeckId);
    for (const r of rows) if (r.deckId) moodle.set(r.deckId, r.latest);
  }

  // Wer belegt die Sätze? Andere nicht gelöschte Sessions in einem belegenden Zustand (`verpasst` belegt nicht)
  const usedBy = new Map<string, DeckUse[]>();
  if (deckIds.length > 0) {
    const users = await db
      .select({
        id: session.id,
        deckId: session.slideDeckId,
        number: session.number,
        title: session.title,
      })
      .from(session)
      .where(
        and(
          inArray(session.slideDeckId, deckIds),
          inArray(session.state, [...OCCUPYING_SESSION_STATES]),
          notDeleted(session),
          sessionId ? ne(session.id, sessionId) : undefined,
        ),
      )
      .orderBy(sql`coalesce(${session.startedAt}, ${session.createdAt}) desc`, desc(session.id));
    for (const u of users) {
      if (!u.deckId) continue;
      const list = usedBy.get(u.deckId) ?? [];
      list.push({ session_id: u.id, number: u.number, title: u.title });
      usedBy.set(u.deckId, list);
    }
  }

  const all = deckRows
    .map((row) => {
      const latest = moodle.get(row.id);
      const availableAt = latest ?? row.uploadedAt;
      const used = usedBy.get(row.id) ?? [];
      const option: DeckOption & { _at: number } = {
        deck: toApiDeck(row),
        available_at: availableAt.toISOString(),
        source: moodle.has(row.id) ? 'moodle' : 'upload',
        free: used.length === 0,
        used_by: used.slice(0, USED_BY_LIMIT),
        _at: availableAt.getTime(),
      };
      return option;
    })
    .sort((a, b) => b._at - a._at || (a.deck.id < b.deck.id ? 1 : -1));

  const closed = own ? (CLOSED_SESSION_STATES as readonly string[]).includes(own.state) : false;
  const currentRow = pointer ? deckRows.find((d) => d.id === pointer) : undefined;
  const currentDeckId = currentRow ? currentRow.id : null;
  const suggested = !own || closed || currentDeckId ? null : (all.find((o) => o.free)?.deck.id ?? null);

  // Die ersten 50, dazu der aktuelle Satz und der Vorschlag, falls sie dahinter liegen
  const items = all.filter(
    (o, i) => i < DECK_OPTIONS_LIMIT || o.deck.id === currentDeckId || o.deck.id === suggested,
  );

  return {
    module_id: moduleId,
    session_id: sessionId ?? null,
    current_deck_id: currentDeckId,
    suggested_deck_id: suggested,
    lock: own ? await predictLock(db, sessionId as string, own) : null,
    items: items.map(({ _at: _unused, ...rest }) => rest),
  };
}

/** `lock` wie `PATCH /sessions/{id}` entscheiden würde (§22.4): `abgeschlossen`, `folienwechsel` oder `null` */
async function predictLock(
  db: DbOrTx,
  sessionId: string,
  own: { state: string; slideDeckId: string | null },
): Promise<DeckLock | null> {
  if ((CLOSED_SESSION_STATES as readonly string[]).includes(own.state)) return 'abgeschlossen';
  // Maßgeblich ist der Zeiger, auch wenn der Satz gelöscht ist
  if (!own.slideDeckId) return null;
  const [ev] = await db
    .select({ id: slideEvent.id })
    .from(slideEvent)
    .where(and(eq(slideEvent.sessionId, sessionId), notDeleted(slideEvent)))
    .limit(1);
  return ev ? 'folienwechsel' : null;
}
