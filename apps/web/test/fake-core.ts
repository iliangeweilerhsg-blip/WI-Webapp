import { vi } from 'vitest';
import type { Module, Semester } from '@sg/shared';

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
    ...overrides,
  };
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
  requests: RecordedRequest[];
  /** Solange true, scheitern alle Anfragen wie bei einem nicht laufenden Core */
  down: boolean;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Kleiner In-Memory-Core für die Web-Tests: /health, /semesters und /modules mit den Regeln des echten Core
 * (erstes Semester wird aktuell, is_current höchstens einmal, Farbvergabe, Soft-Delete). Ersetzt `fetch`.
 */
export function installFakeCore(initial: Partial<Pick<FakeCore, 'semesters' | 'modules' | 'down'>> = {}) {
  const core: FakeCore = {
    semesters: initial.semesters ?? [],
    modules: initial.modules ?? [],
    requests: [],
    down: initial.down ?? false,
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
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      core.requests.push({ method, path: path + url.search, body, headers });

      if (path === '/health') return json({ status: 'ok', db: 'ok', version: '0.0.0' });

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
          id: newId(),
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

      return json({ error: { code: 'not_found', message: 'x' } }, 404);
    }),
  );
  return core;
}
