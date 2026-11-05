import { vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { ExerciseSheet, Module, Semester, Session, Settings, Slide, SlideDeck } from '@sg/shared';

const USER = '0190f6a2-0000-7000-8000-000000000000';
const NOW = '2026-11-04T08:00:00Z';

export function makeSemester(overrides: Partial<Semester> = {}): Semester {
  return {
    id: '0190f6a2-0000-7000-8000-0000000000b1',
    user_id: USER,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    name: 'HS 2026',
    starts_on: null,
    ends_on: null,
    is_current: true,
    archived_at: null,
    ...overrides,
  };
}

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: '0190f6a2-0000-7000-8000-0000000000e1',
    user_id: USER,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    calendar_event_id: null,
    module_id: '0190f6a2-0000-7000-8000-0000000000a1',
    slide_deck_id: null,
    number: null,
    title: null,
    state: 'laeuft',
    started_at: NOW,
    ended_at: null,
    stop_reason: null,
    started_from: null,
    processing: {},
    review_state: 'offen',
    planned_starts_at: null,
    planned_ends_at: null,
    auto_stop_extended_until: null,
    ...overrides,
  };
}

export function makeModule(overrides: Partial<Module> = {}): Module {
  return {
    id: '0190f6a2-0000-7000-8000-0000000000a1',
    user_id: USER,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    semester_id: '0190f6a2-0000-7000-8000-0000000000b1',
    name: 'Datenbanksysteme',
    short_name: 'DBS',
    color: 'mod-03',
    ects: 6,
    exam_type: 'Klausur',
    lecturer: null,
    lang: 'de',
    description_md: null,
    settings: {},
    ...overrides,
  };
}

export function makeDeck(overrides: Partial<SlideDeck> = {}): SlideDeck {
  return {
    id: '0190f6a2-0000-7000-8000-0000000000d1',
    user_id: USER,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    module_id: '0190f6a2-0000-7000-8000-0000000000a1',
    session_id: null,
    title: 'VL 01 Einführung',
    sha256: 'a'.repeat(64),
    page_count: null,
    uploaded_at: NOW,
    ingest_state: 'neu',
    ...overrides,
  };
}

export function makeSheet(overrides: Partial<ExerciseSheet> = {}): ExerciseSheet {
  return {
    id: '0190f6a2-0000-7000-8000-0000000000e1',
    user_id: USER,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    module_id: '0190f6a2-0000-7000-8000-0000000000a1',
    title: 'Blatt 1',
    number: null,
    sha256: 'b'.repeat(64),
    page_count: null,
    due_at: null,
    has_solution: false,
    ingest_state: 'neu',
    ...overrides,
  };
}

export function makeSlides(deckId: string, count: number): Slide[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `0190f6a2-0000-7000-8000-${String(5000 + i).padStart(12, '0')}`,
    user_id: USER,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    deck_id: deckId,
    index: i + 1,
    width_pt: 720,
    height_pt: 405,
    text: '',
    text_blocks: [],
    vision_summary: null,
    title: null,
    chapter: null,
  }));
}

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

export interface FakeCore {
  semesters: Semester[];
  modules: Module[];
  decks: SlideDeck[];
  sheets: ExerciseSheet[];
  slides: Record<string, Slide[]>;
  /** Sessions für GET /sessions und POST /sessions/{id}/start|pause|resume|stop|extend (VERTRAEGE §7.2, §9.4) */
  sessions: Session[];
  /** Die nächste Anfrage an eine Session-Aktion wird mit diesem Fehler abgelehnt */
  rejectNextSession: null | { status: number; code: string };
  requests: RecordedRequest[];
  /** Der nächste Upload scheitert wie bei einer abgerissenen Verbindung; `after` = der Core hat ihn davor verarbeitet */
  failNextUpload: null | 'before' | 'after';
  /** Der nächste Upload wird mit diesem Fehler abgelehnt */
  rejectNextUpload: null | { status: number; code: string };
  /** Der nächste Upload wird als Dublette dieses Eintrags gemeldet (ID) */
  nextUploadDuplicateOf: string | null;
  /** Antworten auf POST mit Idempotency-Key (Replay wie beim echten Core) */
  idempotent: Map<string, { status: number; body: unknown }>;
  /** Setzt einen Foliensatz/ein Blatt auf `verarbeitet` und legt Folien an */
  finishIngest: (id: string, pages?: number) => void;
  /** Setzt einen Foliensatz/ein Blatt auf `fehler` (Einlesen gescheitert, Datei bleibt gespeichert) */
  failIngest: (id: string) => void;
  /** Solange true, scheitern alle Anfragen wie bei einem nicht laufenden Core */
  down: boolean;
  /** Hält alle POSTs an, bis das Promise erfüllt ist (deterministisch statt Zeitfenster). `null` = nicht angehalten */
  postGate: Promise<void> | null;
  /** Stand von GET/PATCH /settings (Standards aus VERTRAEGE §14.1) */
  settings: Settings;
  /** Das nächste PATCH /settings wird mit diesem Fehler abgelehnt */
  rejectNextSettings: null | { status: number; code: string; message: string };
}

export function makeSettings(): Settings {
  return {
    general: { data_dir: '/Users/ich/Studien-Gehirn', content_lang: 'de', appearance: 'system' },
    lecture: {
      microphone_id: null,
      auto_stop_after_end_min: 10,
      auto_stop_quiet_window_min: 3,
      auto_stop_hard_after_end_min: 30,
      auto_stop_silence_min: 15,
      auto_stop_max_duration_min: 240,
      auto_stop_warning_s: 60,
      auto_stop_extend_min: 15,
      default_layout: 'standard',
      default_ink_mode: 'freie_seite',
      toolbar_side: 'rechts',
    },
    pen: {
      double_tap: 'radierer',
      squeeze: 'werkzeugpalette',
      shape_recognition: false,
      favorite_colors: [
        '#1E2A44FF',
        '#C92A2AFF',
        '#1864ABFF',
        '#2B8A3EFF',
        '#E67700FF',
        '#5F3DC4FF',
        '#495057FF',
        '#000000FF',
      ],
    },
    data: { backup_target: null, backup_encryption: false, backup_time: '03:00' },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Kleiner In-Memory-Core für die Web-Tests: /health, /semesters und /modules mit den Regeln des echten Core
 * (erstes Semester wird aktuell, is_current höchstens einmal, Farbvergabe, Soft-Delete). Ersetzt `fetch`.
 */
export function installFakeCore(
  initial: Partial<Pick<FakeCore, 'semesters' | 'modules' | 'decks' | 'sheets' | 'sessions' | 'down'>> = {},
) {
  const core: FakeCore = {
    semesters: structuredClone(initial.semesters ?? []),
    modules: structuredClone(initial.modules ?? []),
    decks: structuredClone(initial.decks ?? []),
    sheets: structuredClone(initial.sheets ?? []),
    slides: {},
    sessions: structuredClone(initial.sessions ?? []),
    rejectNextSession: null,
    requests: [],
    failNextUpload: null,
    rejectNextUpload: null,
    nextUploadDuplicateOf: null,
    idempotent: new Map(),
    finishIngest(id, pages = 3) {
      const deck = core.decks.find((d) => d.id === id);
      if (deck) {
        deck.ingest_state = 'verarbeitet';
        deck.page_count = pages;
        core.slides[id] = makeSlides(id, pages);
      }
      const sheet = core.sheets.find((x) => x.id === id);
      if (sheet) {
        sheet.ingest_state = 'verarbeitet';
        sheet.page_count = pages;
      }
    },
    failIngest(id) {
      for (const item of [...core.decks, ...core.sheets]) if (item.id === id) item.ingest_state = 'fehler';
    },
    down: initial.down ?? false,
    postGate: null,
    settings: makeSettings(),
    rejectNextSettings: null,
  };
  let counter = 100;
  const newId = () => `0190f6a2-0000-7000-8000-${String(++counter).padStart(12, '0')}`;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (core.down) throw new TypeError('Failed to fetch');
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname.replace(/^\/api\/v1/, '');
      const method = init?.method ?? 'GET';
      const form = init?.body instanceof FormData ? init.body : null;
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      core.requests.push({ method, path: path + url.search, body, headers });

      if (method === 'POST' && core.postGate) await core.postGate;
      if (core.down) throw new TypeError('Failed to fetch');

      const materialResponse = await handleMaterial(core, { path, method, url, body, form, headers, newId });
      if (materialResponse) return materialResponse;

      if (path === '/health') return json({ status: 'ok', db: 'ok', version: '0.0.0' });
      // Daten/Papierkorb (T1-18): leere Antworten, damit das gerenderte Panel nicht ins Leere fragt
      if (path === '/backups' && method === 'GET') {
        return json({
          status: { target: null, last_success_at: null, next_run_at: null, stale: false, running: false },
          items: [],
          next_cursor: null,
        });
      }
      if (path === '/trash' && method === 'GET') return json({ items: [], next_cursor: null });

      if (path === '/settings' && method === 'GET') return json(core.settings);
      if (path === '/settings' && method === 'PATCH') {
        if (core.rejectNextSettings) {
          const { status, code, message } = core.rejectNextSettings;
          core.rejectNextSettings = null;
          return json({ error: { code, message } }, status);
        }
        for (const [area, patch] of Object.entries(body ?? {})) {
          Object.assign((core.settings as unknown as Record<string, object>)[area] ?? {}, patch);
        }
        return json(core.settings);
      }

      if (path === '/semesters' && method === 'GET') {
        return json({ items: core.semesters.filter((s) => !s.deleted_at), next_cursor: null });
      }
      if (path === '/semesters' && method === 'POST') {
        const first = core.semesters.length === 0;
        const created = makeSemester({
          id: newId(),
          name: String(body?.name),
          is_current: (body?.is_current as boolean | undefined) ?? first,
        });
        if (created.is_current) core.semesters.forEach((s) => (s.is_current = false));
        core.semesters.unshift(created);
        return json(created, 201);
      }
      const semesterMatch = /^\/semesters\/([^/]+)$/.exec(path);
      if (semesterMatch && method === 'PATCH') {
        const target = core.semesters.find((s) => s.id === semesterMatch[1]);
        if (!target) return json({ error: { code: 'semester_not_found', message: 'x' } }, 404);
        if (body?.name !== undefined) target.name = String(body.name);
        if (body?.archived !== undefined) {
          target.archived_at = body.archived ? NOW : null;
          if (body.archived) target.is_current = false;
        }
        if (body?.is_current === true) {
          core.semesters.forEach((s) => (s.is_current = false));
          target.is_current = true;
        }
        return json(target);
      }

      if (path === '/modules' && method === 'GET') {
        const semesterId = url.searchParams.get('semester_id');
        return json({
          items: core.modules.filter((m) => !m.deleted_at && (!semesterId || m.semester_id === semesterId)),
          next_cursor: null,
        });
      }
      if (path === '/modules' && method === 'POST') {
        const used = new Set<string>(
          core.modules.filter((m) => m.semester_id === body?.semester_id).map((m) => m.color),
        );
        const free = Array.from({ length: 12 }, (_, i) => `mod-${String(i + 1).padStart(2, '0')}`).find(
          (c) => !used.has(c),
        );
        const created = makeModule({
          id: typeof body?.id === 'string' ? body.id : newId(),
          semester_id: String(body?.semester_id),
          name: String(body?.name),
          short_name: null,
          color: (body?.color as Module['color'] | undefined) ?? (free as Module['color']) ?? 'mod-01',
          ects: null,
          exam_type: null,
        });
        core.modules.push(created);
        return json(created, 201);
      }
      const moduleMatch = /^\/modules\/([^/]+)$/.exec(path);
      if (moduleMatch && method === 'PATCH') {
        const target = core.modules.find((m) => m.id === moduleMatch[1] && !m.deleted_at);
        if (!target) return json({ error: { code: 'module_not_found', message: 'x' } }, 404);
        Object.assign(target, body, { updated_at: new Date().toISOString() });
        return json(target);
      }
      if (moduleMatch && method === 'DELETE') {
        const target = core.modules.find((m) => m.id === moduleMatch[1] && !m.deleted_at);
        if (!target) return json({ error: { code: 'module_not_found', message: 'x' } }, 404);
        target.deleted_at = new Date().toISOString();
        return new Response(null, { status: 204 });
      }

      // GET /sessions?from&to&state&module_id (VERTRAEGE §7.2): from/to filtern auf coalesce(started_at, planned_starts_at, created_at)
      if (path === '/sessions' && method === 'GET') {
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        const states = url.searchParams.get('state')?.split(',');
        const moduleId = url.searchParams.get('module_id');
        const anchor = (x: Session) => Date.parse(x.started_at ?? x.planned_starts_at ?? x.created_at);
        const items = core.sessions
          .filter((x) => !x.deleted_at)
          .filter((x) => !states || states.includes(x.state))
          .filter((x) => !moduleId || x.module_id === moduleId)
          .filter((x) => !from || anchor(x) >= Date.parse(from))
          .filter((x) => !to || anchor(x) < Date.parse(to))
          .sort((a, b) => anchor(a) - anchor(b) || a.id.localeCompare(b.id));
        return json({ items, next_cursor: null });
      }

      const sessionMatch = /^\/sessions\/([^/]+)\/(start|pause|resume|stop|extend)$/.exec(path);
      if (sessionMatch && method === 'POST') {
        if (core.rejectNextSession) {
          const { status, code } = core.rejectNextSession;
          core.rejectNextSession = null;
          return json({ error: { code, message: 'x' } }, status);
        }
        const target = core.sessions.find((x) => x.id === sessionMatch[1]);
        if (!target) return json({ error: { code: 'session_not_found', message: 'x' } }, 404);
        const active = target.state === 'laeuft' || target.state === 'pausiert';
        const now = Date.now();
        const invalid = () => json({ error: { code: 'session_transition_invalid', message: 'x' } }, 409);
        const touch = () => (target.updated_at = new Date(now).toISOString());
        if (sessionMatch[2] === 'start') {
          if (target.state === 'laeuft') return json({ session: target, ended_session: null });
          if (target.state !== 'geplant' && target.state !== 'bereit' && target.state !== 'verpasst') {
            return invalid();
          }
          // Eine andere aktive Session endet vorher (VERTRAEGE §9.1)
          const other = core.sessions.find(
            (x) => x.id !== target.id && (x.state === 'laeuft' || x.state === 'pausiert'),
          );
          if (other) {
            other.state = 'beendet';
            other.ended_at = new Date(now).toISOString();
            other.stop_reason = 'kalenderende';
            other.updated_at = new Date(now).toISOString();
          }
          target.state = 'laeuft';
          target.started_at = new Date(now).toISOString();
          target.started_from = (body?.started_from as Session['started_from'] | undefined) ?? 'mac';
          touch();
          return json({ session: target, ended_session: other ?? null });
        }
        if (sessionMatch[2] === 'pause' || sessionMatch[2] === 'resume') {
          const [from, next] =
            sessionMatch[2] === 'pause'
              ? (['laeuft', 'pausiert'] as const)
              : (['pausiert', 'laeuft'] as const);
          if (target.state === next) return json(target);
          if (target.state !== from) return invalid();
          target.state = next;
          touch();
          return json(target);
        }
        if (sessionMatch[2] === 'stop') {
          if (active) {
            target.state = 'beendet';
            target.ended_at = new Date(now).toISOString();
            target.stop_reason = (body?.reason as Session['stop_reason'] | undefined) ?? 'manuell';
            target.updated_at = new Date(now).toISOString();
          } else if (target.state !== 'beendet' && target.state !== 'verarbeitet') {
            return json({ error: { code: 'session_transition_invalid', message: 'x' } }, 409);
          }
          return json(target);
        }
        if (!active) return json({ error: { code: 'session_not_active', message: 'x' } }, 409);
        const base = Math.max(now, Date.parse(target.auto_stop_extended_until ?? '') || 0);
        const minutes = (body?.minutes as number | undefined) ?? core.settings.lecture.auto_stop_extend_min;
        target.auto_stop_extended_until = new Date(base + minutes * 60_000).toISOString();
        target.updated_at = new Date(now).toISOString();
        return json(target);
      }

      return json({ error: { code: 'not_found', message: 'x' } }, 404);
    }),
  );
  return core;
}

interface MaterialCall {
  path: string;
  method: string;
  url: URL;
  body: Record<string, unknown> | null;
  form: FormData | null;
  headers: Record<string, string>;
  newId: () => string;
}

/** /slide-decks und /exercise-sheets des Fake-Core: Upload (multipart), Dublette, Listen, Detail, PATCH, DELETE. */
async function handleMaterial(core: FakeCore, call: MaterialCall): Promise<Response | null> {
  const { path, method, url, body, form, headers } = call;
  const kinds = [
    { prefix: '/slide-decks', list: core.decks as (SlideDeck | ExerciseSheet)[], deck: true },
    { prefix: '/exercise-sheets', list: core.sheets as (SlideDeck | ExerciseSheet)[], deck: false },
  ];
  for (const { prefix, list, deck } of kinds) {
    if (path === prefix && method === 'POST' && form) {
      const key = headers['Idempotency-Key'] ?? '';
      const stored = core.idempotent.get(key);
      if (stored) return json(stored.body, stored.status);
      if (core.failNextUpload === 'before') {
        core.failNextUpload = null;
        throw new TypeError('Failed to fetch');
      }
      if (core.rejectNextUpload) {
        const { status, code } = core.rejectNextUpload;
        core.rejectNextUpload = null;
        return json({ error: { code, message: 'x' } }, status);
      }
      const file = form.get('file') as File;
      const moduleId = String(form.get('module_id'));
      const sha256 = createHash('sha256').update(`${file.name}:${file.size}`).digest('hex');
      const forced = core.nextUploadDuplicateOf;
      core.nextUploadDuplicateOf = null;
      const existing = forced
        ? list.find((x) => x.id === forced)
        : list.find((x) => x.sha256 === sha256 && x.module_id === moduleId && !x.deleted_at);
      let status = 200;
      let result = { id: existing?.id ?? '', duplicate: true };
      if (!existing) {
        const sent = form.get('title');
        const title = typeof sent === 'string' && sent !== '' ? sent : file.name.replace(/\.pdf$/i, '');
        const id = call.newId();
        list.unshift(
          deck
            ? makeDeck({ id, module_id: moduleId, title, sha256 })
            : makeSheet({ id, module_id: moduleId, title, sha256 }),
        );
        status = 201;
        result = { id, duplicate: false };
      }
      core.idempotent.set(key, { status, body: result });
      if (core.failNextUpload === 'after') {
        core.failNextUpload = null;
        throw new TypeError('Failed to fetch');
      }
      return json(result, status);
    }
    if (path === prefix && method === 'GET') {
      const moduleId = url.searchParams.get('module_id');
      return json({
        items: list.filter((x) => !x.deleted_at && (!moduleId || x.module_id === moduleId)),
        next_cursor: null,
      });
    }
    const match = new RegExp(`^${prefix}/([^/]+)$`).exec(path);
    if (match) {
      const target = list.find((x) => x.id === match[1] && !x.deleted_at);
      if (!target) return json({ error: { code: 'not_found', message: 'x' } }, 404);
      if (method === 'GET') {
        return json(deck ? { deck: target, slides: core.slides[target.id] ?? [] } : target);
      }
      if (method === 'PATCH') {
        Object.assign(target, body);
        return json(target);
      }
      if (method === 'DELETE') {
        target.deleted_at = new Date().toISOString();
        return new Response(null, { status: 204 });
      }
    }
  }
  return null;
}
