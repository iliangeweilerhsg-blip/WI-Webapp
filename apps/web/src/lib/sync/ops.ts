// Reine Funktionen auf Operationen: Abhängigkeiten, Umschreiben, Uhrkorrektur (VERTRAEGE §9.2, §11.2, §11.5).
import type { QueuedOp } from './types.ts';

type Json = Record<string, unknown>;

const SERVER_ONLY_KINDS: ReadonlySet<string> = new Set([
  'notebook.update',
  'notebook.delete',
  'notebook.restore',
  'page.restore',
]);

export function isServerOnlyKind(kind: string): boolean {
  return SERVER_ONLY_KINDS.has(kind);
}

const asRecord = (v: unknown): Json | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** IDs, die erst durch diese Operation entstehen würden. */
export function createdIds(op: QueuedOp): string[] {
  const data = asRecord(op.data) ?? {};
  const out: (string | null)[] = [];
  switch (op.kind) {
    case 'notebook.create':
      out.push(str(data.notebook_id));
      break;
    case 'page.create':
      out.push(str(data.page_id));
      break;
    case 'session.start':
      out.push(str(data.session_id));
      break;
    case 'stroke.add':
      out.push(str(asRecord(data.stroke)?.client_id));
      break;
    case 'element.upsert':
      out.push(str(asRecord(data.element)?.element_id));
      break;
    case 'marker.add':
      out.push(str(data.marker_id));
      break;
    case 'photo.add':
      out.push(str(data.photo_id));
      break;
    case 'slide.change':
      out.push(str(data.event_id));
      break;
    default:
      break;
  }
  return out.filter((x): x is string => x !== null);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function collectUuids(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (UUID_RE.test(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectUuids(v, into);
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) collectUuids(v, into);
  }
}

/** Alle IDs, die die Operation verwendet: Strom und beliebige UUIDs in `data`. */
export function referencedIds(op: QueuedOp): Set<string> {
  const ids = new Set<string>();
  const m = /^(?:notebook|session):(.+)$/.exec(op.stream);
  if (m?.[1]) ids.add(m[1]);
  collectUuids(op.data, ids);
  return ids;
}

/**
 * Operationen, die von der abgelehnten abhängen: jede spätere, die eine ID verwendet, die erst durch die
 * abgelehnte (oder eine schon abhängige) Operation entstanden wäre, transitiv (§11.2).
 * `later` in Warteschlangenreihenfolge, ohne die abgelehnte selbst.
 */
export function dependentsOf<T extends { op: QueuedOp }>(rejected: QueuedOp, later: readonly T[]): T[] {
  const poisoned = new Set<string>(createdIds(rejected));
  const out: T[] = [];
  if (poisoned.size === 0) return out;
  for (const entry of later) {
    let hit = false;
    for (const id of referencedIds(entry.op)) {
      if (poisoned.has(id)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      out.push(entry);
      for (const id of createdIds(entry.op)) poisoned.add(id);
    }
  }
  return out;
}

function replaceDeep(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string') return value === from ? to : value;
  if (Array.isArray(value)) return value.map((v) => replaceDeep(v, from, to));
  if (value !== null && typeof value === 'object') {
    const out: Json = {};
    for (const [k, v] of Object.entries(value)) out[k] = replaceDeep(v, from, to);
    return out;
  }
  return value;
}

/**
 * `session_superseded` (§9.2): Strom `session:<alt>` und jede Verwendung der alten ID in den Daten
 * (`session_id`, auch `page.session_id` in `page.create`/`page.update`) auf die bestehende Session umschreiben.
 */
export function rewriteSessionId(op: QueuedOp, oldId: string, newId: string): QueuedOp {
  const stream = op.stream === `session:${oldId}` ? `session:${newId}` : op.stream;
  const data = replaceDeep(op.data, oldId, newId);
  return { ...op, stream, data } as QueuedOp;
}

/**
 * Uhrkorrektur noch nicht gesendeter Operationen mit `clock_uncertain = true` (§11.5).
 * `at`, `stroke.created_at` und `session.start.started_at` immer; `t_ms` nur für Sessions einer fremden Uhr.
 */
export function correctClock(
  op: QueuedOp,
  offsetMs: number,
  isForeignSession: (sessionId: string) => boolean,
): QueuedOp {
  if (!op.clock_uncertain) return op;
  const data = asRecord(op.data) ?? {};
  let nextData: Json = data;
  switch (op.kind) {
    case 'stroke.add': {
      const stroke = asRecord(data.stroke);
      if (stroke && typeof stroke.created_at === 'number') {
        nextData = { ...data, stroke: { ...stroke, created_at: stroke.created_at + offsetMs } };
      }
      break;
    }
    case 'session.start':
      if (typeof data.started_at === 'number') nextData = { ...data, started_at: data.started_at + offsetMs };
      break;
    case 'slide.change':
    case 'marker.add':
    case 'photo.add': {
      const sessionId = str(data.session_id);
      if (sessionId && typeof data.t_ms === 'number' && isForeignSession(sessionId)) {
        nextData = { ...data, t_ms: data.t_ms + offsetMs };
      }
      break;
    }
    default:
      break;
  }
  return { ...op, at: op.at + offsetMs, clock_uncertain: false, data: nextData } as unknown as QueuedOp;
}
