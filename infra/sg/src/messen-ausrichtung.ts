// `sg messen ausrichtung <datei>`: Anteil der richtig zugeordneten Zeit gegen einen goldenen Datensatz
// (Abnahme Phase 2: Ausrichtung ≥ 85 %, docs/spezifikation/10-UMSETZUNG.md §3). Nur lesend.
//
// Der goldene Datensatz ist eine JSON-Datei, die der Nutzer selbst schreibt (Format: docs/anleitungen/MESSEN.md):
// je Session die Zeitspannen, in denen welche Folie lief. Verglichen wird mit `slide_segment` (Quelle `log`).
// Maß: Summe der Zeit, in der die gemessene Folie der goldenen entspricht, geteilt durch die goldene Zeit.
import type { MessenIo } from './messen-pipeline.ts';
import type { PgAccess } from './pg.ts';

export const ALIGN_GOAL = 0.85;
export const MAX_GOLDEN_BYTES = 1024 * 1024;
const MAX_SESSIONS = 50;
const MAX_SEGMENTS = 2000;
const SOURCES = ['log', 'ausrichtung', 'manuell'] as const;
export type AlignSource = (typeof SOURCES)[number];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const ALIGN_USAGE = 'Aufruf: messen ausrichtung <datei.json> [--quelle log|ausrichtung|manuell]';

export interface Span {
  slide: number;
  startMs: number;
  endMs: number;
}

export interface GoldenSession {
  sessionId: string;
  spans: Span[];
}

export type AlignArgs = { ok: true; file: string; source: AlignSource } | { ok: false; message: string };

export function parseAlignArgs(rest: string[]): AlignArgs {
  let file: string | undefined;
  let source: AlignSource = 'log';
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] as string;
    if (arg === '--quelle') {
      const value = rest[i + 1];
      if (!SOURCES.includes(value as AlignSource)) {
        return { ok: false, message: `--quelle erwartet ${SOURCES.join(' | ')}.` };
      }
      source = value as AlignSource;
      i += 1;
    } else if (arg.startsWith('--')) {
      return { ok: false, message: `Unbekannte Option "${arg}". Erlaubt: --quelle.` };
    } else if (file === undefined) {
      file = arg;
    } else {
      return { ok: false, message: 'Es darf nur eine Datei angegeben werden.' };
    }
  }
  if (file === undefined) return { ok: false, message: 'Die JSON-Datei mit dem goldenen Datensatz fehlt.' };
  return { ok: true, file, source };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

export type GoldenResult = { ok: true; sessions: GoldenSession[] } | { ok: false; message: string };

/** Prüft die Datei streng und meldet den ersten Fehler mit Pfad, damit man ihn in der Datei findet */
export function parseGolden(text: string): GoldenResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: 'Die Datei ist kein gültiges JSON.' };
  }
  if (!isRecord(data)) return { ok: false, message: 'Oberste Ebene muss ein Objekt sein.' };
  if (data.version !== 1) return { ok: false, message: '"version" muss 1 sein.' };
  const list = data.sessions;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_SESSIONS) {
    return { ok: false, message: `"sessions" muss eine Liste mit 1 bis ${MAX_SESSIONS} Einträgen sein.` };
  }
  const sessions: GoldenSession[] = [];
  const seen = new Set<string>();
  for (const [si, entry] of list.entries()) {
    const at = `sessions[${si}]`;
    if (!isRecord(entry)) return { ok: false, message: `${at} muss ein Objekt sein.` };
    const id = entry.session_id;
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return { ok: false, message: `${at}.session_id muss eine UUID in Kleinbuchstaben sein.` };
    }
    if (seen.has(id)) return { ok: false, message: `${at}.session_id kommt doppelt vor.` };
    seen.add(id);
    const segments = entry.segments;
    if (!Array.isArray(segments) || segments.length === 0 || segments.length > MAX_SEGMENTS) {
      return {
        ok: false,
        message: `${at}.segments muss eine Liste mit 1 bis ${MAX_SEGMENTS} Einträgen sein.`,
      };
    }
    const spans: Span[] = [];
    for (const [gi, seg] of segments.entries()) {
      const where = `${at}.segments[${gi}]`;
      if (!isRecord(seg)) return { ok: false, message: `${where} muss ein Objekt sein.` };
      const { slide_index: slide, start_ms: start, end_ms: end } = seg;
      if (!isInt(slide) || slide < 1)
        return { ok: false, message: `${where}.slide_index muss eine ganze Zahl ≥ 1 sein.` };
      if (!isInt(start) || start < 0)
        return { ok: false, message: `${where}.start_ms muss eine ganze Zahl ≥ 0 sein.` };
      if (!isInt(end) || end <= start)
        return { ok: false, message: `${where}.end_ms muss größer als start_ms sein.` };
      spans.push({ slide, startMs: start, endMs: end });
    }
    const sorted = [...spans].sort((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < sorted.length; i += 1) {
      if ((sorted[i] as Span).startMs < (sorted[i - 1] as Span).endMs) {
        return {
          ok: false,
          message: `${at}: Segmente überlappen sich (bei ${(sorted[i] as Span).startMs} ms).`,
        };
      }
    }
    sessions.push({ sessionId: id, spans: sorted });
  }
  return { ok: true, sessions };
}

/** Gesamtlänge der Vereinigung von Intervallen */
function unionLength(intervals: Array<[number, number]>): number {
  const sorted = [...intervals].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curStart = 0;
  let curEnd = -1;
  for (const [a, b] of sorted) {
    if (curEnd < 0 || a > curEnd) {
      if (curEnd >= 0) total += curEnd - curStart;
      curStart = a;
      curEnd = b;
    } else if (b > curEnd) {
      curEnd = b;
    }
  }
  if (curEnd >= 0) total += curEnd - curStart;
  return total;
}

export interface AlignScore {
  goldenMs: number;
  /** Zeit, in der die gemessene Folie der goldenen entspricht */
  correctMs: number;
  /** Zeit mit einer anderen Folie */
  wrongMs: number;
  /** Goldene Zeit ohne jedes gemessene Segment */
  missingMs: number;
}

export function scoreAlignment(golden: Span[], measured: Span[]): AlignScore {
  let goldenMs = 0;
  let correctMs = 0;
  let coveredMs = 0;
  for (const g of golden) {
    goldenMs += g.endMs - g.startMs;
    const clip = (m: Span): [number, number] => [Math.max(g.startMs, m.startMs), Math.min(g.endMs, m.endMs)];
    correctMs += unionLength(measured.filter((m) => m.slide === g.slide).map(clip));
    coveredMs += unionLength(measured.map(clip));
  }
  return {
    goldenMs,
    correctMs,
    wrongMs: Math.max(0, coveredMs - correctMs),
    missingMs: Math.max(0, goldenMs - coveredMs),
  };
}

export function addScores(a: AlignScore, b: AlignScore): AlignScore {
  return {
    goldenMs: a.goldenMs + b.goldenMs,
    correctMs: a.correctMs + b.correctMs,
    wrongMs: a.wrongMs + b.wrongMs,
    missingMs: a.missingMs + b.missingMs,
  };
}

/** `91,3 %` */
export function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return '–';
  return `${((part / whole) * 100).toFixed(1).replace('.', ',')} %`;
}

export async function readMeasuredSpans(
  pg: Pick<PgAccess, 'query'>,
  sessionId: string,
  source: AlignSource,
): Promise<Span[]> {
  const rows = await pg.query(
    `BEGIN READ ONLY;
SELECT slide_index, start_ms, end_ms FROM slide_segment
WHERE session_id = :'sid'::uuid AND source = :'src' AND deleted_at IS NULL
ORDER BY start_ms, id;
COMMIT;
`,
    { sid: sessionId, src: source },
  );
  return rows.map((r) => ({ slide: Number(r[0]), startMs: Number(r[1]), endMs: Number(r[2]) }));
}

export async function runAlignmentReport(
  pg: Pick<PgAccess, 'query'>,
  golden: GoldenSession[],
  source: AlignSource,
  io: MessenIo,
): Promise<number> {
  let total: AlignScore = { goldenMs: 0, correctMs: 0, wrongMs: 0, missingMs: 0 };
  let withData = 0;
  io.out(`Gemessene Quelle: slide_segment.source = '${source}'`);
  for (const session of golden) {
    const measured = await readMeasuredSpans(pg, session.sessionId, source);
    const score = scoreAlignment(session.spans, measured);
    if (measured.length > 0) withData += 1;
    total = addScores(total, score);
    const note = measured.length === 0 ? '  (keine gemessenen Segmente)' : '';
    io.out(
      `Session ${session.sessionId}: richtig ${formatPercent(score.correctMs, score.goldenMs)}, ` +
        `andere Folie ${formatPercent(score.wrongMs, score.goldenMs)}, ` +
        `ohne Zuordnung ${formatPercent(score.missingMs, score.goldenMs)}${note}`,
    );
  }
  if (withData === 0) {
    io.out(
      `Zu keiner Session der Datei gibt es Segmente mit source = '${source}'. Session-IDs und --quelle prüfen.`,
    );
    return 1;
  }
  const ratio = total.correctMs / total.goldenMs;
  io.out(
    `Gesamt (nach Zeit gewichtet): ${formatPercent(total.correctMs, total.goldenMs)} richtig ` +
      `(Ziel ≥ ${Math.round(ALIGN_GOAL * 100)} %: ${ratio >= ALIGN_GOAL ? 'erreicht' : 'verfehlt'})`,
  );
  return 0;
}
