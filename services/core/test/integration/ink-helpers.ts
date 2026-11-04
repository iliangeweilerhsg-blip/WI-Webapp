// Gemeinsame Hilfen der Core-Ink-Tests: Opfer-Daten, Ops und Aufruf der Handler in einer Transaktion
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SINGLE_USER_ID, type Stroke, type SyncOp } from '@sg/shared';
import type { Db } from '../../src/db/client.ts';
import { courseModule, semester, session } from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { createInkHandlers, type InkOpKind } from '../../src/sync/handlers/ink.ts';
import type { OpHandlerContext } from '../../src/sync/handlers.ts';

export const AT = 1_793_800_000_000;

const FIXTURES = fileURLToPath(new URL('../../../../tests/fixtures/strokes', import.meta.url));

/** Alle Striche aus `tests/fixtures/strokes/*.json`, je Datei */
export function loadStrokeFixtures(): { file: string; strokes: Stroke[] }[] {
  return readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((file) => ({
      file,
      strokes: JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as Stroke[],
    }));
}

export interface Seed {
  semesterId: string;
  moduleId: string;
}

/** Semester und Modul direkt anlegen (ohne Standard-Notizbücher, wie ein älteres Modul) */
export async function seedModule(db: Db): Promise<Seed> {
  const semesterId = uuidv7();
  const moduleId = uuidv7();
  await db.insert(semester).values({ id: semesterId, userId: SINGLE_USER_ID, name: 'HS 2026' });
  await db
    .insert(courseModule)
    .values({ id: moduleId, userId: SINGLE_USER_ID, semesterId, name: 'Datenbanksysteme', color: 'mod-01' });
  return { semesterId, moduleId };
}

export async function seedSession(db: Db, moduleId: string, deletedAt: Date | null = null): Promise<string> {
  const id = uuidv7();
  await db.insert(session).values({
    id,
    userId: SINGLE_USER_ID,
    deletedAt,
    moduleId,
    state: 'beendet',
    startedFrom: 'ipad',
  } as typeof session.$inferInsert);
  return id;
}

type Envelope = { op_id: string; at: number; clock_uncertain: boolean };

/** Operation mit Umschlag. `kind`, `stream` und `data` bestimmen den Rest */
export function makeOp(
  kind: SyncOp['kind'],
  stream: string,
  data: unknown,
  extra: Partial<Envelope> = {},
): SyncOp {
  return {
    type: 'op',
    op_id: uuidv7(),
    stream,
    kind,
    at: AT,
    clock_uncertain: false,
    data,
    ...extra,
  } as SyncOp;
}

export const ctxDevice: OpHandlerContext = { deviceId: null, origin: 'ipad' };

/** Handler `kind` direkt in einer Transaktion ausführen (wie der Dispatcher, ohne WebSocket) */
export function runHandler(db: Db, dataDir: string, op: SyncOp, ctx: OpHandlerContext = ctxDevice) {
  const handler = createInkHandlers({ dataDir })[op.kind as InkOpKind];
  return db.transaction((tx) => handler(tx, op, ctx));
}

export const nbStream = (notebookId: string) => `notebook:${notebookId}`;

export function pageCreateData(notebookId: string, overrides: Record<string, unknown> = {}) {
  return {
    page_id: uuidv7(),
    notebook_id: notebookId,
    session_id: null,
    index: 1,
    template: 'liniert',
    width_pt: 595,
    height_pt: 842,
    background_slide_id: null,
    attached_slide_id: null,
    ...overrides,
  };
}

export function notebookCreateData(moduleId: string, overrides: Record<string, unknown> = {}) {
  return {
    notebook_id: uuidv7(),
    module_id: moduleId,
    title: 'Mein Notizbuch',
    created_at: AT,
    ...overrides,
  };
}
