// Op-Handler für Handschrift und Fotos (VERTRAEGE §11.3): notebook.*, page.*, stroke.*, element.*,
// drawing.snapshot, photo.add.
//
// Regeln (VERTRAEGE §11.2):
// - Doppelte `op_id` prüft der Dispatcher zentral, bevor ein Handler läuft. Die Handler prüfen das nie selbst.
// - Den Strom-Eintrag der Client-Operation (`seq`, `ack`) schreibt der Dispatcher mit `appendOp` in derselben
//   Transaktion. Die Handler ändern nur den fachlichen Zustand. Server-Operationen schreibt der Core selbst
//   (REST in services/notebooks.ts).
// - Weich gelöschte Eltern: Die Operation wird angenommen, das Objekt übernimmt `deleted_at` des Elternobjekts.
//   Eltern, die es nie gab: nicht wiederholbarer Fehler (`*_not_found`).
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { SINGLE_USER_ID, type PageUpdateFields, type Stroke, type SyncOp } from '@sg/shared';
import type { Tx } from '../../db/client.ts';
import { notebook, page, pageElement, stroke, courseModule } from '../../db/schema/index.ts';
import { HttpError } from '../../errors.ts';
import { uuidv7 } from '../../lib/uuid7.ts';
import { upsertPhotoMeta } from '../../services/photos.ts';
import { softDelete } from '../../services/trash.ts';
import { registerOpHandler, SyncOpError, type OpHandler } from '../handlers.ts';

/** Op-Arten dieses Handlers */
export type InkOpKind =
  | 'notebook.create'
  | 'notebook.update'
  | 'notebook.delete'
  | 'notebook.restore'
  | 'page.create'
  | 'page.update'
  | 'page.delete'
  | 'page.restore'
  | 'stroke.add'
  | 'stroke.remove'
  | 'element.upsert'
  | 'element.remove'
  | 'drawing.snapshot'
  | 'photo.add';

type OpOf<K extends InkOpKind> = Extract<SyncOp, { kind: K }>;

export interface InkHandlerDeps {
  /** Datenordner (`SG_DATA_DIR`), nur für `photo.add` */
  dataDir: string;
}

/** Ein Strich ist höchstens so groß wie eine Nachricht (1 MB, VERTRAEGE §11) abzüglich Umschlag, Base64 eingerechnet */
export const MAX_STROKE_POINT_BYTES = 750_000;
const POINT_BYTES = 24;

const notebookStreamPrefix = 'notebook:';

/** Notizbuch-ID aus dem Strom, `null` bei einem anderen Strom */
function notebookIdOfStream(stream: string): string | null {
  return stream.startsWith(notebookStreamPrefix) ? stream.slice(notebookStreamPrefix.length) : null;
}

function streamMismatch(details: Record<string, unknown>): SyncOpError {
  return new SyncOpError('stream_mismatch', false, details);
}

function messageInvalid(reason: string): SyncOpError {
  return new SyncOpError('message_invalid', false, { reason });
}

/** Seite (auch weich gelöscht) mit Sperre. Fehlt sie ganz: `page_not_found`. Gehört sie zu einem anderen Strom: `stream_mismatch` */
async function lockPageForStream(tx: Tx, op: SyncOp, pageId: string) {
  const [row] = await tx.select().from(page).where(eq(page.id, pageId)).for('update');
  if (!row) throw new SyncOpError('page_not_found', false, { page_id: pageId });
  if (notebookIdOfStream(op.stream) !== row.notebookId) {
    throw streamMismatch({ stream: op.stream, page_id: pageId, notebook_id: row.notebookId });
  }
  return row;
}

/**
 * Prüft `points` (08 §4.2): Base64, mindestens ein Punkt, ein Vielfaches von 24 Byte, höchstens
 * `MAX_STROKE_POINT_BYTES`. Liefert die rohen Bytes.
 */
export function decodeStrokePoints(points: string): Buffer {
  if (points.length === 0 || points.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(points)) {
    throw messageInvalid('points ist kein gültiges Base64');
  }
  const bytes = Buffer.from(points, 'base64');
  if (bytes.length === 0 || bytes.length % POINT_BYTES !== 0) {
    throw messageInvalid('points muss aus ganzen Punkten à 24 Byte bestehen');
  }
  if (bytes.length > MAX_STROKE_POINT_BYTES) throw messageInvalid('points ist zu groß');
  return bytes;
}

function checkStroke(s: Stroke): Buffer {
  const finite = (values: readonly number[]) => values.every((v) => Number.isFinite(v));
  if (s.transform.length !== 6 || !finite(s.transform))
    throw messageInvalid('transform braucht 6 endliche Zahlen');
  if (s.bbox.length !== 4 || !finite(s.bbox)) throw messageInvalid('bbox braucht 4 endliche Zahlen');
  if (!Number.isFinite(s.width) || s.width <= 0) throw messageInvalid('width muss größer als 0 sein');
  return decodeStrokePoints(s.points);
}

// ---------- notebook / page ----------

async function notebookCreate(tx: Tx, op: OpOf<'notebook.create'>): Promise<void> {
  const data = op.data;
  if (op.stream !== `notebook:${data.notebook_id}`) {
    throw streamMismatch({ stream: op.stream, notebook_id: data.notebook_id });
  }
  if (data.kind !== undefined && data.kind !== 'frei') throw messageInvalid('Nur freie Notizbücher');
  const title = data.title.trim();
  if (title === '' || title.length > 300) throw messageInvalid('title muss 1 bis 300 Zeichen lang sein');

  const [existing] = await tx
    .select({ id: notebook.id })
    .from(notebook)
    .where(eq(notebook.id, data.notebook_id));
  if (existing) return;
  const [mod] = await tx
    .select({ deletedAt: courseModule.deletedAt })
    .from(courseModule)
    .where(eq(courseModule.id, data.module_id));
  if (!mod) throw new SyncOpError('module_not_found', false, { module_id: data.module_id });

  await tx
    .insert(notebook)
    .values({
      id: data.notebook_id,
      userId: SINGLE_USER_ID,
      moduleId: data.module_id,
      title,
      kind: 'frei',
      createdAt: new Date(data.created_at),
      deletedAt: mod.deletedAt,
    })
    .onConflictDoNothing();
}

async function pageCreate(tx: Tx, op: OpOf<'page.create'>): Promise<void> {
  const data = op.data;
  if (op.stream !== `notebook:${data.notebook_id}`) {
    throw streamMismatch({ stream: op.stream, notebook_id: data.notebook_id });
  }
  const [existing] = await tx.select({ id: page.id }).from(page).where(eq(page.id, data.page_id));
  if (existing) return;
  const [parent] = await tx
    .select({ deletedAt: notebook.deletedAt })
    .from(notebook)
    .where(eq(notebook.id, data.notebook_id));
  if (!parent) throw new SyncOpError('notebook_not_found', false, { notebook_id: data.notebook_id });

  await tx
    .insert(page)
    .values({
      id: data.page_id,
      userId: SINGLE_USER_ID,
      createdAt: new Date(op.at),
      deletedAt: parent.deletedAt,
      notebookId: data.notebook_id,
      sessionId: data.session_id,
      index: data.index,
      template: data.template,
      backgroundSlideId: data.background_slide_id,
      attachedSlideId: data.attached_slide_id,
      widthPt: data.width_pt,
      heightPt: data.height_pt,
      version: 1,
    })
    .onConflictDoNothing();
}

async function pageUpdate(tx: Tx, op: OpOf<'page.update'>): Promise<void> {
  const { page_id: pageId, version } = op.data;
  const fields: PageUpdateFields = op.data.fields;
  const row = await lockPageForStream(tx, op, pageId);
  if (row.version !== version) {
    throw new SyncOpError('page_version_conflict', false, { page_id: pageId, current_version: row.version });
  }
  await tx
    .update(page)
    .set({
      index: fields.index,
      template: fields.template,
      sessionId: fields.session_id,
      backgroundSlideId: fields.background_slide_id,
      attachedSlideId: fields.attached_slide_id,
      version: row.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(page.id, pageId));
}

async function pageDelete(tx: Tx, op: OpOf<'page.delete'>): Promise<void> {
  const row = await lockPageForStream(tx, op, op.data.page_id);
  if (row.deletedAt !== null) return; // schon im Papierkorb: bestätigen
  try {
    await softDelete(tx, 'page', row.id);
  } catch (error) {
    if (error instanceof HttpError && error.code === 'page_not_found') {
      throw new SyncOpError('page_not_found', false, { page_id: row.id });
    }
    throw error;
  }
}

// ---------- stroke / element ----------

async function strokeAdd(tx: Tx, op: OpOf<'stroke.add'>): Promise<void> {
  const s = op.data.stroke;
  const points = checkStroke(s);
  const parent = await lockPageForStream(tx, op, op.data.page_id);
  const values = {
    tool: s.tool,
    layer: s.layer,
    color: s.color,
    width: s.width,
    tStartMs: s.t_start_ms,
    tEndMs: s.t_end_ms,
    transform: s.transform,
    bbox: s.bbox,
    points,
    clockUncertain: op.clock_uncertain,
    createdAt: new Date(s.created_at),
    // Upsert belebt einen gelöschten Strich wieder. In einer gelöschten Seite übernimmt er deren Löschzeitpunkt
    deletedAt: parent.deletedAt,
  };
  await tx
    .insert(stroke)
    .values({
      id: uuidv7(),
      userId: SINGLE_USER_ID,
      pageId: parent.id,
      clientId: s.client_id,
      ...values,
    })
    .onConflictDoUpdate({
      target: [stroke.pageId, stroke.clientId],
      set: { ...values, updatedAt: new Date() },
    });
}

async function strokeRemove(tx: Tx, op: OpOf<'stroke.remove'>): Promise<void> {
  const parent = await lockPageForStream(tx, op, op.data.page_id);
  // Unbekannte client_ids werden ignoriert, bereits gelöschte behalten ihren Zeitpunkt
  await tx
    .update(stroke)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(stroke.pageId, parent.id),
        inArray(stroke.clientId, op.data.client_ids),
        isNull(stroke.deletedAt),
      ),
    );
}

async function elementUpsert(tx: Tx, op: OpOf<'element.upsert'>): Promise<void> {
  const parent = await lockPageForStream(tx, op, op.data.page_id);
  const el = op.data.element;
  const [existing] = await tx
    .select({ pageId: pageElement.pageId })
    .from(pageElement)
    .where(eq(pageElement.id, el.element_id));
  if (existing && existing.pageId !== parent.id) {
    // Dieselbe element_id auf einer anderen Seite: nie stillschweigend verschieben
    throw streamMismatch({ element_id: el.element_id, page_id: parent.id });
  }
  const values = {
    kind: el.kind,
    frame: el.frame,
    payload: el.payload as unknown as Record<string, unknown>,
    tMs: el.t_ms,
    z: el.z,
    deletedAt: parent.deletedAt,
  };
  await tx
    .insert(pageElement)
    .values({ id: el.element_id, userId: SINGLE_USER_ID, pageId: parent.id, ...values })
    .onConflictDoUpdate({ target: pageElement.id, set: { ...values, updatedAt: new Date() } });
}

async function elementRemove(tx: Tx, op: OpOf<'element.remove'>): Promise<void> {
  const parent = await lockPageForStream(tx, op, op.data.page_id);
  await tx
    .update(pageElement)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(pageElement.id, op.data.element_id),
        eq(pageElement.pageId, parent.id),
        isNull(pageElement.deletedAt),
      ),
    );
}

/** Operationen, die nur der Server erzeugt. Ein Client bekommt `op_not_allowed` (VERTRAEGE §11.2) */
const serverOnly: OpHandler = async (_tx, op) => {
  throw new SyncOpError('op_not_allowed', false, { kind: op.kind });
};

/** Alle Handler dieses Bereichs, nach Op-Art. Direkt aufrufbar: `handlers[kind](tx, op, ctx)` */
export function createInkHandlers(deps: InkHandlerDeps): Record<InkOpKind, OpHandler> {
  const typed =
    <K extends InkOpKind>(fn: (tx: Tx, op: OpOf<K>) => Promise<void>): OpHandler =>
    (tx, op) =>
      fn(tx, op as OpOf<K>);
  return {
    'notebook.create': typed<'notebook.create'>(notebookCreate),
    'notebook.update': serverOnly,
    'notebook.delete': serverOnly,
    'notebook.restore': serverOnly,
    'page.create': typed<'page.create'>(pageCreate),
    'page.update': typed<'page.update'>(pageUpdate),
    'page.delete': typed<'page.delete'>(pageDelete),
    'page.restore': serverOnly,
    'stroke.add': typed<'stroke.add'>(strokeAdd),
    'stroke.remove': typed<'stroke.remove'>(strokeRemove),
    'element.upsert': typed<'element.upsert'>(elementUpsert),
    'element.remove': typed<'element.remove'>(elementRemove),
    // Nur ein Hinweis an andere iPads: Der Core bestätigt immer (Datei kommt per PUT /pages/{id}/pkdrawing)
    'drawing.snapshot': async () => {},
    'photo.add': typed<'photo.add'>(async (tx, op) => {
      if (op.stream !== `session:${op.data.session_id}`) {
        throw streamMismatch({ stream: op.stream, session_id: op.data.session_id });
      }
      await upsertPhotoMeta(tx, op.data, { dataDir: deps.dataDir });
    }),
  };
}

/** Meldet alle Handler dieses Bereichs an der Registry an. Der Lead hängt das beim Start ein (nach T1-08). */
export function registerInkHandlers(deps: InkHandlerDeps): void {
  for (const [kind, handler] of Object.entries(createInkHandlers(deps)) as [InkOpKind, OpHandler][]) {
    registerOpHandler(kind, handler);
  }
}
