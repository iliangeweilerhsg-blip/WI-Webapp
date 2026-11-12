// assign.save_draft und assign.submit gegen einen nachgebauten Moodle (T1-24 PR 3, Plan §4.3, §4.4, Issue #93 Punkt 4).
// NICHT GEPRÜFT: Der Fake bildet Moodle nach dem Gedächtnis nach (Plan §9). Die Tests sichern das Verhalten des Core
// gegen diese Annahme, nicht gegen das echte Moodle.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MoodleActionCatalogSchema, MoodleActionPreviewSchema, MoodleActionResultSchema } from '@sg/shared';
import { MOODLE_GATED_ACTIONS } from '../../src/config.ts';
import { createAssignHandlers, formatSize, htmlToPreviewText } from '../../src/moodle/actions/assign.ts';
import type { MoodleActionContext } from '../../src/moodle/actions.ts';
import { createMoodleServices, type MoodleServices } from '../../src/moodle/index.ts';
import { StaticTokenStore } from '../../src/moodle/token-store.ts';
import { storeUploadStream, type StoredUpload } from '../../src/moodle/uploads.ts';
import { registerErrorHandler } from '../../src/plugins/errors.ts';
import { moodleRoutes } from '../../src/routes/moodle.ts';
import { FAKE_BASE, FAKE_TOKEN, fakeFetch, json, siteInfo, type RecordedRequest } from './moodle-fake.ts';

const NOW_MS = Date.parse('2026-11-12T10:00:00Z');
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const NOW_SEC = unix('2026-11-12T10:00:00Z');
const HOUR = 3600;

// ---------- Moodle-Fake ----------

interface FakeFile {
  name: string;
  bytes: number;
  modified: number;
  hash?: string;
  /** Ordner in Moodle (`filepath`), Standard `/` */
  path?: string;
}
interface FakeSubmission {
  id: number;
  status: 'new' | 'draft' | 'submitted';
  modified: number;
  files: FakeFile[];
  text: string | null;
  attempt?: number;
}
interface FakeAssignment {
  id: number;
  course: number;
  name: string;
  duedate: number;
  cutoffdate: number;
  allowfrom: number;
  statement: boolean;
  statementText: string | null;
  /** `submissiondrafts`: Gibt es einen Einreichen-Schritt? `null`: Moodle liefert das Feld nicht */
  drafts: boolean | null;
  team: boolean;
  fileEnabled: boolean;
  textEnabled: boolean;
  maxfiles: number;
  maxbytes: number;
  filetypes: string;
  canedit: boolean;
  cansubmit: boolean;
  submission: FakeSubmission | null;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
class Gate {
  readonly started = deferred();
  readonly release = deferred();
}

class FakeMoodle {
  readonly assignments = new Map<number, FakeAssignment>();
  /** Alle Aufrufe in der Reihenfolge: `wsfunction` bzw. `upload.php` */
  readonly calls: string[] = [];
  readonly requests: RecordedRequest[] = [];
  /** Hochgeladene Dateien je `itemid` */
  readonly drafts = new Map<number, FakeFile[]>();
  readonly gates = new Map<string, Gate>();
  /** `network`: fetch wirft. `null`: Antwort `null`. `warn`: Warnliste. `exception`: Moodle-Fehlerobjekt */
  readonly fail = new Map<string, 'network' | 'null' | 'warn' | 'exception'>();
  /** N3: Speichert Moodle nur einen Teil, geht der andere verloren (Gegenprobe zur Annahme „bleibt erhalten“) */
  wipeMissingPart = false;
  uploadfiles: number | undefined = 1;
  /** Läuft zu Beginn jedes REST-Aufrufs, `n` zählt die Aufrufe dieser Funktion ab 1 (für Wettläufe zwischen Lesevorgängen) */
  beforeCall: ((fn: string, n: number) => void) | null = null;
  private nextItem = 4242;
  private modifiedAt = unix('2026-11-11T13:03:00Z');

  readonly functions: string[];
  constructor(functions: string[]) {
    this.functions = functions;
  }

  add(patch: Partial<FakeAssignment> & { id: number }): FakeAssignment {
    const assignment: FakeAssignment = {
      course: 5,
      name: 'Blatt 3',
      duedate: NOW_SEC + 48 * HOUR,
      cutoffdate: 0,
      allowfrom: 0,
      statement: false,
      statementText: null,
      drafts: true,
      team: false,
      fileEnabled: true,
      textEnabled: true,
      maxfiles: 5,
      maxbytes: 10 * 1024 * 1024,
      filetypes: '',
      canedit: true,
      cansubmit: true,
      submission: null,
      ...patch,
    };
    this.assignments.set(assignment.id, assignment);
    return assignment;
  }

  /** Ein Entwurf mit Datei(en) */
  draft(id: number, files: FakeFile[], text: string | null = null): FakeSubmission {
    const a = this.assignments.get(id)!;
    a.submission = { id: 900 + id, status: 'draft', modified: this.modifiedAt, files, text };
    return a.submission;
  }

  touch(id: number): void {
    const s = this.assignments.get(id)!.submission!;
    s.modified += 60;
  }

  gate(wsfunction: string): Gate {
    const gate = new Gate();
    this.gates.set(wsfunction, gate);
    return gate;
  }

  /** Alle Aufrufe außer der Seiteninfo */
  touched(): string[] {
    return this.calls.filter((c) => c !== 'core_webservice_get_site_info');
  }
  count(name: string): number {
    return this.calls.filter((c) => c === name).length;
  }
  bodyOf(name: string): URLSearchParams[] {
    return this.requests
      .filter((r) => !r.url.endsWith('/upload.php') && r.body.get('wsfunction') === name)
      .map((r) => r.body);
  }

  private plugins(s: FakeSubmission) {
    return [
      {
        type: 'file',
        fileareas: [
          {
            area: 'submission_files',
            files: s.files.map((f) => ({
              filename: f.name,
              filepath: f.path ?? '/',
              filesize: f.bytes,
              timemodified: f.modified,
              ...(f.hash ? { contenthash: f.hash } : {}),
            })),
          },
        ],
      },
      {
        type: 'onlinetext',
        editorfields: s.text === null ? [] : [{ name: 'onlinetext', text: s.text, format: 1 }],
      },
    ];
  }

  private status(a: FakeAssignment) {
    const s = a.submission;
    const raw = s
      ? {
          id: s.id,
          status: s.status,
          timemodified: s.modified,
          attemptnumber: s.attempt ?? 0,
          plugins: this.plugins(s),
        }
      : undefined;
    return {
      lastattempt: {
        ...(a.team ? { teamsubmission: raw } : { submission: raw }),
        canedit: a.canedit,
        cansubmit: a.cansubmit,
        graded: false,
        ...(a.statementText ? { submissionstatement: a.statementText } : {}),
      },
      warnings: [],
    };
  }

  private assignmentRaw(a: FakeAssignment) {
    const cfg = (plugin: string, name: string, value: unknown) => ({
      plugin,
      subtype: 'assignsubmission',
      name,
      value: String(value),
    });
    return {
      id: a.id,
      cmid: 70 + a.id,
      course: a.course,
      name: a.name,
      duedate: a.duedate,
      cutoffdate: a.cutoffdate,
      allowsubmissionsfromdate: a.allowfrom,
      requiresubmissionstatement: a.statement ? 1 : 0,
      ...(a.drafts === null ? {} : { submissiondrafts: a.drafts ? 1 : 0 }),
      teamsubmission: a.team ? 1 : 0,
      configs: [
        cfg('file', 'enabled', a.fileEnabled ? 1 : 0),
        cfg('onlinetext', 'enabled', a.textEnabled ? 1 : 0),
        cfg('file', 'maxfilesubmissions', a.maxfiles),
        cfg('file', 'maxsubmissionsizebytes', a.maxbytes),
        cfg('file', 'filetypeslist', a.filetypes),
      ],
    };
  }

  private exception() {
    return json({ exception: 'moodle_exception', errorcode: 'generalexceptionmessage', message: 'Fehler' });
  }

  readonly handle = async (request: RecordedRequest): Promise<Response> => {
    this.requests.push(request);
    if (new URL(request.url).pathname.endsWith('/upload.php')) return this.upload(request);
    const fn = request.body.get('wsfunction') ?? '';
    this.calls.push(fn);
    this.beforeCall?.(fn, this.count(fn));
    if (request.body.get('wstoken') !== FAKE_TOKEN) {
      return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Ungültig' });
    }
    const gate = this.gates.get(fn);
    if (gate) {
      this.gates.delete(fn);
      gate.started.resolve();
      await gate.release.promise;
    }
    const failure = this.fail.get(fn);
    if (failure === 'network') throw new TypeError('fetch failed');
    if (failure === 'null') return json(null);
    if (failure === 'exception') return this.exception();
    if (failure === 'warn') return json([{ item: 'x', warningcode: 'couldnotsavesubmission', message: 'm' }]);

    const id = Number(request.body.get('assignid') ?? request.body.get('assignmentid'));
    switch (fn) {
      case 'core_webservice_get_site_info':
        return json({
          ...siteInfo(this.functions),
          ...(this.uploadfiles === undefined ? {} : { uploadfiles: this.uploadfiles }),
        });
      case 'mod_assign_get_assignments': {
        const wanted = request.body.get('courseids[0]');
        const items = [...this.assignments.values()].filter(
          (a) => wanted === null || String(a.course) === wanted,
        );
        const courses = [...new Set(items.map((a) => a.course))].map((course) => ({
          id: course,
          assignments: items.filter((a) => a.course === course).map((a) => this.assignmentRaw(a)),
        }));
        return json({ courses, warnings: [] });
      }
      case 'mod_assign_get_submission_status': {
        const a = this.assignments.get(id);
        return a ? json(this.status(a)) : this.exception();
      }
      case 'mod_assign_save_submission': {
        const a = this.assignments.get(id);
        if (!a) return this.exception();
        const item = request.body.get('plugindata[files_filemanager]');
        const text = request.body.get('plugindata[onlinetext_editor][text]');
        const s: FakeSubmission = a.submission ?? {
          id: 900 + id,
          status: 'draft',
          modified: 0,
          files: [],
          text: null,
        };
        if (item !== null) s.files = this.drafts.get(Number(item)) ?? [];
        else if (this.wipeMissingPart) s.files = [];
        if (text !== null) s.text = text;
        else if (this.wipeMissingPart) s.text = null;
        s.status = a.drafts ? 'draft' : 'submitted';
        s.modified += 60;
        a.submission = s;
        return json([]);
      }
      case 'mod_assign_submit_for_grading': {
        const a = this.assignments.get(id);
        if (!a?.submission) return this.exception();
        a.submission.status = 'submitted';
        a.submission.modified += 60;
        return json([]);
      }
      default:
        return this.exception();
    }
  };

  private upload(request: RecordedRequest): Response {
    this.calls.push('upload.php');
    const form = request.form;
    if (!form || form.get('token') !== FAKE_TOKEN)
      return json({ error: 'Ungültiges Token', errorcode: 'invalidtoken' });
    if (this.fail.get('upload.php') === 'network') throw new TypeError('fetch failed');
    const sent = Number(form.get('itemid'));
    const itemid = sent > 0 ? sent : this.nextItem++;
    const file = form.get('file_1') as File;
    const list = this.drafts.get(itemid) ?? [];
    list.push({ name: file.name, bytes: file.size, modified: NOW_SEC });
    this.drafts.set(itemid, list);
    return json([{ component: 'user', filearea: 'draft', itemid, filename: file.name, filepath: '/' }]);
  }
}

// ---------- Aufbau ----------

const ALL_FUNCTIONS = [
  'core_webservice_get_site_info',
  'mod_assign_get_assignments',
  'mod_assign_get_submission_status',
  'mod_assign_save_submission',
  'mod_assign_submit_for_grading',
];

let app: FastifyInstance | undefined;
let dataDir: string;
let moodle: MoodleServices;
let fake: FakeMoodle;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sg-moodle-assign-'));
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

async function setup(
  options: { moodleActions?: readonly string[]; lockTimeoutMs?: number; functions?: string[] } = {},
) {
  fake = new FakeMoodle(options.functions ?? ALL_FUNCTIONS);
  const net = fakeFetch(fake.handle);
  fake.requests.length = 0;
  moodle = createMoodleServices({
    config: {
      moodleUrl: FAKE_BASE,
      dataDir,
      moodleActions: (options.moodleActions ?? [...MOODLE_GATED_ACTIONS]) as never,
    },
    tokens: new StaticTokenStore(FAKE_TOKEN),
    fetch: net.fetch,
    handlers: createAssignHandlers({ now: () => NOW_MS, timeZone: 'Europe/Berlin' }),
    readMeta: async () => ({ token_valid_until: '2027-01-27' }),
    now: () => new Date(NOW_MS),
    client: { minIntervalMs: 0, retryDelaysMs: [] },
    ...(options.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: options.lockTimeoutMs }),
  });
  await moodle.uploads.reset();
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  await app.register(moodleRoutes, { moodle });
  await app.ready();
  return { app, net };
}

const PDF = Buffer.from('%PDF-1.7\n%test\n');

/** Legt einen Upload an, wie die Route es tut */
async function put(name = 'loesung.pdf', content: Buffer = PDF): Promise<StoredUpload> {
  const slot = moodle.uploads.reserve(content.length);
  try {
    return await storeUploadStream(slot, {
      filename: name,
      file: Readable.from([content]) as Readable & { truncated?: boolean },
    });
  } finally {
    slot.cancel();
  }
}

function call(kind: 'preview' | 'execute', action: string, params: unknown, token?: string | null) {
  return app!.inject({
    method: 'POST',
    url: `/moodle/actions/${action}/${kind}`,
    payload: kind === 'preview' ? { params } : { params, ...(token ? { confirmation_token: token } : {}) },
  });
}
const preview = (action: string, params: unknown) => call('preview', action, params);
const execute = (action: string, params: unknown, token?: string | null) =>
  call('execute', action, params, token);

/** Vorschau, die einen Code liefern muss */
async function codeFor(action: string, params: unknown): Promise<string> {
  const res = await preview(action, params);
  expect(res.statusCode, res.body).toBe(200);
  const token = MoodleActionPreviewSchema.parse(res.json()).confirmation_token;
  expect(token).toEqual(expect.any(String));
  return token as string;
}

const errorOf = (res: { json(): unknown }) =>
  (res.json() as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;

const A = 12;
const submitParams = (accept = false, id = A) => ({ assignment_id: id, accept_statement: accept });
const draftOf = (id = A) => ({ assignment_id: id, online_text_html: '<p>Hallo</p>' });
const FILE: FakeFile = { name: 'loesung.pdf', bytes: 1_258_291, modified: unix('2026-11-11T13:03:00Z') };

/** Aufgabe 12 mit gespeichertem Entwurf */
async function withDraft(patch: Partial<FakeAssignment> = {}, options: Parameters<typeof setup>[0] = {}) {
  await setup(options);
  fake.add({ id: A, ...patch });
  fake.draft(A, [{ ...FILE }]);
}

// ---------- assign.save_draft ----------

describe('assign.save_draft: Erfolg', () => {
  it('Dateien: Upload je Datei mit gemeinsamer itemid, ein Schreibaufruf nur mit files_filemanager', async () => {
    await setup();
    fake.add({ id: A });
    const one = await put('loesung.pdf');
    const two = await put('anhang.pdf');
    const params = { assignment_id: A, upload_ids: [one.id, two.id] };
    const prev = MoodleActionPreviewSchema.parse((await preview('assign.save_draft', params)).json());
    // Aufgabe mit Einreichen-Schritt: Speichern braucht keinen Code
    expect(prev).toMatchObject({ risk: 'aenderbar', needs_confirmation: false, confirmation_token: null });
    expect(prev.summary).toContain('2 Dateien als Entwurf in ‚Blatt 3‘ speichern');
    expect(prev.details.files).toEqual([
      { name: 'loesung.pdf', size_bytes: PDF.length },
      { name: 'anhang.pdf', size_bytes: PDF.length },
    ]);
    expect(fake.touched().filter((c) => c === 'upload.php' || c === 'mod_assign_save_submission')).toEqual(
      [],
    );

    const res = await execute('assign.save_draft', params);
    expect(res.statusCode, res.body).toBe(200);
    const result = MoodleActionResultSchema.parse(res.json()).result;
    expect(result).toMatchObject({ state: 'entwurf', verified: true, warnings: [] });
    expect(result.files).toEqual([
      { name: 'loesung.pdf', size_bytes: PDF.length },
      { name: 'anhang.pdf', size_bytes: PDF.length },
    ]);
    // Zwei Uploads, ein Schreibaufruf
    expect(fake.count('upload.php')).toBe(2);
    expect(fake.count('mod_assign_save_submission')).toBe(1);
    const uploads = fake.requests.filter((r) => r.url.endsWith('/upload.php'));
    // Erste Datei mit itemid 0, die zweite mit der gelieferten
    expect(uploads.map((r) => r.form?.get('itemid'))).toEqual(['0', '4242']);
    expect(uploads.every((r) => r.form?.get('filearea') === 'draft' && !r.url.includes('token='))).toBe(true);
    const [body] = fake.bodyOf('mod_assign_save_submission');
    expect(body?.get('assignmentid')).toBe('12');
    expect(body?.get('plugindata[files_filemanager]')).toBe('4242');
    expect([...body!.keys()].some((k) => k.startsWith('plugindata[onlinetext_editor]'))).toBe(false);
    // Benutzte Uploads sind gelöscht
    expect(() => moodle.uploads.resolve([one.id])).toThrow();
    expect(() => moodle.uploads.resolve([two.id])).toThrow();
    expect(res.body).not.toContain(FAKE_TOKEN);
  });

  it('Text: onlinetext_editor, aber kein files_filemanager', async () => {
    await setup();
    fake.add({ id: A });
    const res = await execute('assign.save_draft', draftOf());
    expect(res.statusCode, res.body).toBe(200);
    expect(fake.count('upload.php')).toBe(0);
    const [body] = fake.bodyOf('mod_assign_save_submission');
    expect(body?.get('plugindata[onlinetext_editor][text]')).toBe('<p>Hallo</p>');
    expect(body?.get('plugindata[onlinetext_editor][format]')).toBe('1');
    expect(body?.get('plugindata[onlinetext_editor][itemid]')).toBe('0');
    expect(body?.has('plugindata[files_filemanager]')).toBe(false);
  });

  it('Dateien und Text zusammen: beide Felder, derselbe itemid (Plan §4.3)', async () => {
    await setup();
    fake.add({ id: A });
    const file = await put();
    const res = await execute('assign.save_draft', {
      assignment_id: A,
      upload_ids: [file.id],
      online_text_html: '<p>Mit Datei</p>',
    });
    expect(res.statusCode, res.body).toBe(200);
    const [body] = fake.bodyOf('mod_assign_save_submission');
    expect(body?.get('plugindata[files_filemanager]')).toBe('4242');
    expect(body?.get('plugindata[onlinetext_editor][itemid]')).toBe('4242');
    expect(body?.get('plugindata[onlinetext_editor][text]')).toBe('<p>Mit Datei</p>');
  });

  it('nur Text, Moodle verliert dabei die Dateien (N3): Warnung statt stiller Verlust', async () => {
    await withDraft();
    fake.wipeMissingPart = true;
    const res = await execute('assign.save_draft', draftOf());
    expect(res.statusCode, res.body).toBe(200);
    const result = res.json().result as { warnings: string[]; files: unknown[]; verified: boolean };
    expect(result.verified).toBe(true);
    expect(result.files).toEqual([]);
    expect(result.warnings.join(' ')).toContain('Nicht mehr im Entwurf: loesung.pdf');
  });

  it('Vorschau: Warnungen für Ersetzen, Frist und Gruppenabgabe, Text als Klartext', async () => {
    await withDraft({ duedate: unix('2026-11-12T05:00:00Z'), team: true });
    const file = await put('neu.pdf');
    const res = await preview('assign.save_draft', {
      assignment_id: A,
      upload_ids: [file.id],
      online_text_html: '<p>Hallo <b>Welt</b></p><script>alert(1)</script>',
    });
    const prev = MoodleActionPreviewSchema.parse(res.json());
    expect(prev.warnings).toEqual([
      'Ersetzt den bisherigen Entwurf: loesung.pdf.',
      'Die Frist ist seit 12.11. 06:00 abgelaufen. Die Abgabe gilt als verspätet.',
      'Gruppenabgabe: Das gilt für die ganze Gruppe.',
    ]);
    expect(prev.details.text_preview).toBe('Hallo Welt');
  });
});

describe('assign.save_draft: Aufgabe ohne Einreichen-Schritt', () => {
  it('execute ohne Code → 409, nichts hochgeladen; mit Code aus der Vorschau → Erfolg', async () => {
    await setup();
    fake.add({ id: A, drafts: false });
    const file = await put();
    const params = { assignment_id: A, upload_ids: [file.id] };
    const early = await execute('assign.save_draft', params);
    expect(early.statusCode).toBe(409);
    expect(errorOf(early).code).toBe('moodle_confirmation_required');
    expect(fake.touched().filter((c) => c === 'upload.php' || c === 'mod_assign_save_submission')).toEqual(
      [],
    );

    const prev = MoodleActionPreviewSchema.parse((await preview('assign.save_draft', params)).json());
    expect(prev.needs_confirmation).toBe(true);
    expect(prev.warnings).toContain('Bei dieser Aufgabe ist Speichern schon die Abgabe.');
    const res = await execute('assign.save_draft', params, prev.confirmation_token);
    expect(res.statusCode, res.body).toBe(200);
    expect(fake.count('mod_assign_save_submission')).toBe(1);
  });
});

describe('assign.save_draft: Vorprüfungen (409 moodle_action_rejected, nichts hochgeladen, nichts geschrieben)', () => {
  const NOT_TOUCHED = ['upload.php', 'mod_assign_save_submission'];
  const cases: [string, Partial<FakeAssignment>, string][] = [
    [
      'schon_eingereicht',
      { canedit: false, submission: { id: 1, status: 'submitted', modified: 1, files: [], text: null } },
      'schon_eingereicht',
    ],
    ['frist_vorbei', { canedit: false, cutoffdate: NOW_SEC - HOUR }, 'frist_vorbei'],
    ['noch_nicht_offen', { canedit: false, allowfrom: NOW_SEC + HOUR }, 'noch_nicht_offen'],
    ['nicht_bearbeitbar', { canedit: false }, 'nicht_bearbeitbar'],
    ['Abgabeart Datei aus', { fileEnabled: false }, 'abgabeart_nicht_erlaubt'],
    ['zu_viele_dateien', { maxfiles: 1 }, 'zu_viele_dateien'],
    ['datei_zu_gross', { maxbytes: 5 }, 'datei_zu_gross'],
    ['dateityp_nicht_erlaubt', { filetypes: '.zip, .txt' }, 'dateityp_nicht_erlaubt'],
  ];

  it.each(cases)('%s', async (_name, patch, reason) => {
    await setup();
    fake.add({ id: A, ...patch });
    const files = [await put('a.pdf'), await put('b.pdf')];
    const params = { assignment_id: A, upload_ids: files.map((f) => f.id) };
    for (const kind of ['preview', 'execute'] as const) {
      const res = await call(kind, 'assign.save_draft', params);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toMatchObject({ code: 'moodle_action_rejected', details: { reason } });
    }
    expect(fake.touched().filter((c) => NOT_TOUCHED.includes(c))).toEqual([]);
    // Die Dateien bleiben liegen
    expect(moodle.uploads.resolve(files.map((f) => f.id))).toHaveLength(2);
  });

  it('Abgabeart Online-Text aus', async () => {
    await setup();
    fake.add({ id: A, textEnabled: false });
    const res = await execute('assign.save_draft', draftOf());
    expect(errorOf(res).details).toMatchObject({ reason: 'abgabeart_nicht_erlaubt' });
    expect(fake.touched().filter((c) => NOT_TOUCHED.includes(c))).toEqual([]);
  });

  it('Gruppen aus filetypeslist (document) werden nicht ausgewertet', async () => {
    await setup();
    fake.add({ id: A, filetypes: 'document, .zip' });
    const file = await put('a.pdf');
    const res = await execute('assign.save_draft', { assignment_id: A, upload_ids: [file.id] });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('uploads_nicht_freigegeben: uploadfiles ist 0', async () => {
    await setup();
    fake.add({ id: A });
    fake.uploadfiles = 0;
    const file = await put();
    const res = await execute('assign.save_draft', { assignment_id: A, upload_ids: [file.id] });
    expect(errorOf(res)).toMatchObject({
      code: 'moodle_action_rejected',
      details: { reason: 'uploads_nicht_freigegeben' },
    });
    expect(fake.touched().filter((c) => NOT_TOUCHED.includes(c))).toEqual([]);
  });

  it('nicht_gefunden: unbekannte Aufgabe', async () => {
    await setup();
    fake.add({ id: A });
    const res = await execute('assign.save_draft', draftOf(999));
    expect(errorOf(res)).toMatchObject({
      code: 'moodle_action_rejected',
      details: { reason: 'nicht_gefunden' },
    });
    expect(fake.touched().filter((c) => NOT_TOUCHED.includes(c))).toEqual([]);
  });

  it('unbekannte upload_id → 404, kein Aufruf an Moodle', async () => {
    await setup();
    fake.add({ id: A });
    const before = fake.touched().length;
    const res = await execute('assign.save_draft', {
      assignment_id: A,
      upload_ids: ['01939c3e-0000-7000-8000-000000000001'],
    });
    expect(res.statusCode).toBe(404);
    expect(errorOf(res).code).toBe('moodle_upload_not_found');
    expect(fake.touched()).toHaveLength(before);
    expect(fake.touched().filter((c) => c.startsWith('mod_assign') || c === 'upload.php')).toEqual([]);
  });
});

describe('assign.save_draft: Fehler von Moodle', () => {
  it('nicht leere Warnliste → 502 moodle_error mit warningcode, Upload bleibt liegen', async () => {
    await setup();
    fake.add({ id: A });
    fake.fail.set('mod_assign_save_submission', 'warn');
    const file = await put();
    const res = await execute('assign.save_draft', { assignment_id: A, upload_ids: [file.id] });
    expect(res.statusCode).toBe(502);
    expect(errorOf(res)).toMatchObject({
      code: 'moodle_error',
      details: { moodle_errorcode: 'couldnotsavesubmission' },
    });
    expect(moodle.uploads.resolve([file.id])).toHaveLength(1);
    expect(moodle.uploads.isInUse(file.id)).toBe(false);
  });

  it('Upload bricht ab → 502 mit outcome_unknown, kein mod_assign_save_submission, Datei bleibt', async () => {
    await setup();
    fake.add({ id: A });
    fake.fail.set('upload.php', 'network');
    const file = await put();
    const res = await execute('assign.save_draft', { assignment_id: A, upload_ids: [file.id] });
    expect(res.statusCode).toBe(502);
    expect(errorOf(res).details).toMatchObject({ outcome_unknown: true });
    expect(fake.count('mod_assign_save_submission')).toBe(0);
    // Nie wiederholt
    expect(fake.count('upload.php')).toBe(1);
    expect(moodle.uploads.resolve([file.id])).toHaveLength(1);
    expect(moodle.uploads.isInUse(file.id)).toBe(false);
  });

  it('Schreibaufruf endet im Netzfehler → 502 outcome_unknown, nur ein Versuch, Datei bleibt', async () => {
    await setup();
    fake.add({ id: A });
    fake.fail.set('mod_assign_save_submission', 'network');
    const file = await put();
    const res = await execute('assign.save_draft', { assignment_id: A, upload_ids: [file.id] });
    expect(res.statusCode).toBe(502);
    expect(errorOf(res).details).toMatchObject({ outcome_unknown: true });
    expect(fake.count('mod_assign_save_submission')).toBe(1);
    expect(moodle.uploads.resolve([file.id])).toHaveLength(1);
  });

  it('Antwort null vom Schreiben → kein 500, sondern 502 mit outcome_unknown', async () => {
    await setup();
    fake.add({ id: A });
    fake.fail.set('mod_assign_save_submission', 'null');
    const res = await execute('assign.save_draft', draftOf());
    expect(res.statusCode).toBe(502);
    expect(errorOf(res)).toMatchObject({ code: 'moodle_error', details: { outcome_unknown: true } });
  });

  it('Antwort null beim Lesen der Aufgaben bzw. des Stands → 502, nichts geschrieben', async () => {
    for (const fn of ['mod_assign_get_assignments', 'mod_assign_get_submission_status']) {
      await app?.close();
      await setup();
      fake.add({ id: A });
      fake.fail.set(fn, 'null');
      const res = await execute('assign.save_draft', draftOf());
      expect(res.statusCode, fn).toBe(502);
      expect(fake.count('mod_assign_save_submission')).toBe(0);
    }
  });

  it('Nachlesen scheitert → die Aktion gilt als gelungen, verified ist false', async () => {
    await setup();
    fake.add({ id: A });
    // Das Nachlesen ist der zweite Aufruf von get_submission_status
    const original = fake.handle;
    let reads = 0;
    const failing = fakeFetch(async (request) => {
      if (request.body.get('wsfunction') === 'mod_assign_get_submission_status' && ++reads >= 2) {
        throw new TypeError('fetch failed');
      }
      return original(request);
    });
    // Neuer Dienst auf demselben Fake
    await app?.close();
    moodle = createMoodleServices({
      config: { moodleUrl: FAKE_BASE, dataDir, moodleActions: ['assign.save_draft'] },
      tokens: new StaticTokenStore(FAKE_TOKEN),
      fetch: failing.fetch,
      handlers: createAssignHandlers({ now: () => NOW_MS }),
      readMeta: async () => ({ token_valid_until: '2027-01-27' }),
      now: () => new Date(NOW_MS),
      client: { minIntervalMs: 0, retryDelaysMs: [] },
    });
    await moodle.uploads.reset();
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerErrorHandler(app);
    await app.register(moodleRoutes, { moodle });
    await app.ready();
    const res = await execute('assign.save_draft', draftOf());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().result).toMatchObject({ verified: false, state: null });
  });
});

// ---------- assign.submit ----------

describe('assign.submit: Erfolg', () => {
  it('Vorschau mit Code, ein Schreibaufruf, Ergebnis aus dem Nachlesen', async () => {
    await withDraft();
    fake.assignments.get(A)!.submission!.text = '<p>Mein <i>Text</i></p>';
    const res = await preview('assign.submit', submitParams());
    expect(res.statusCode, res.body).toBe(200);
    const prev = MoodleActionPreviewSchema.parse(res.json());
    expect(prev).toMatchObject({ risk: 'endgueltig', needs_confirmation: true });
    expect(prev.summary).toBe(
      'Abgabe ‚Blatt 3‘ endgültig einreichen: loesung.pdf (1,2 MB), Online-Text, zuletzt geändert 11.11. 14:03. ' +
        'Danach sind keine Änderungen mehr möglich.',
    );
    // Vertrag mit der Web-App (08 §9.3): files = [{ name, size_bytes }], text_preview, statement_text nur mit Erklärung
    expect(prev.details).toMatchObject({
      files: [{ name: 'loesung.pdf', size_bytes: 1_258_291 }],
      text_preview: 'Mein Text',
      last_modified_at: '2026-11-11T13:03:00.000Z',
    });
    expect('statement_text' in prev.details).toBe(false);
    expect(fake.count('mod_assign_submit_for_grading')).toBe(0);

    const out = await execute('assign.submit', submitParams(), prev.confirmation_token);
    expect(out.statusCode, out.body).toBe(200);
    expect(MoodleActionResultSchema.parse(out.json()).result).toMatchObject({
      state: 'eingereicht',
      verified: true,
      warnings: [],
    });
    expect(fake.count('mod_assign_submit_for_grading')).toBe(1);
    const [body] = fake.bodyOf('mod_assign_submit_for_grading');
    expect(body?.get('assignmentid')).toBe('12');
    expect(body?.get('acceptsubmissionstatement')).toBe('0');
    expect(out.body).not.toContain(FAKE_TOKEN);
  });

  it('Erklärung nötig: ohne Zustimmung abgelehnt, mit Zustimmung gesendet, statement_text in der Vorschau', async () => {
    await withDraft({ statement: true, statementText: '<p>Ich habe das <b>selbst</b> verfasst.</p>' });
    const rejected = await preview('assign.submit', submitParams(false));
    expect(rejected.statusCode).toBe(409);
    expect(errorOf(rejected)).toMatchObject({
      code: 'moodle_action_rejected',
      details: { reason: 'erklaerung_fehlt' },
    });

    const prev = MoodleActionPreviewSchema.parse((await preview('assign.submit', submitParams(true))).json());
    expect(prev.details).toMatchObject({
      statement_text: 'Ich habe das selbst verfasst.',
      requires_statement: true,
    });
    const out = await execute('assign.submit', submitParams(true), prev.confirmation_token);
    expect(out.statusCode, out.body).toBe(200);
    expect(fake.bodyOf('mod_assign_submit_for_grading')[0]?.get('acceptsubmissionstatement')).toBe('1');
  });

  it('Gruppenabgabe: Stand und Dateien kommen aus teamsubmission, Warnung in der Vorschau', async () => {
    await withDraft({ team: true });
    const prev = MoodleActionPreviewSchema.parse((await preview('assign.submit', submitParams())).json());
    expect(prev.warnings).toContain('Gruppenabgabe: Das gilt für die ganze Gruppe.');
    expect(prev.details.files).toEqual([{ name: 'loesung.pdf', size_bytes: 1_258_291 }]);
    // Ändert sich die Gruppenabgabe, gilt der Code nicht mehr
    fake.touch(A);
    const out = await execute('assign.submit', submitParams(), prev.confirmation_token);
    expect(out.statusCode).toBe(409);
    expect(errorOf(out).details).toMatchObject({ reason: 'stand_geaendert' });
    expect(fake.count('mod_assign_submit_for_grading')).toBe(0);
  });

  it('abgelaufene Frist ohne Sperre: Warnung „verspätet“, Einreichen bleibt möglich', async () => {
    await withDraft({ duedate: unix('2026-11-12T05:00:00Z') });
    const prev = MoodleActionPreviewSchema.parse((await preview('assign.submit', submitParams())).json());
    expect(prev.warnings).toEqual([
      'Die Frist ist seit 12.11. 06:00 abgelaufen. Die Abgabe gilt als verspätet.',
    ]);
    expect((await execute('assign.submit', submitParams(), prev.confirmation_token)).statusCode).toBe(200);
  });
});

describe('assign.submit: Gegenprobe zu #93 Punkt 4 (Bindung an den Stand)', () => {
  it('timemodified ändert sich zwischen Vorschau und Ausführen → 409 stand_geaendert, nichts eingereicht', async () => {
    await withDraft();
    const token = await codeFor('assign.submit', submitParams());
    fake.touch(A);
    const res = await execute('assign.submit', submitParams(), token);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: 'moodle_confirmation_invalid',
      details: { reason: 'stand_geaendert' },
    });
    expect(fake.count('mod_assign_submit_for_grading')).toBe(0);
    // Der Code ist verbraucht, auch bei einem Fehlschlag
    const again = await execute('assign.submit', submitParams(), token);
    expect(again.statusCode).toBe(409);
    expect(fake.count('mod_assign_submit_for_grading')).toBe(0);
  });

  it('Dateiliste ändert sich bei gleichem timemodified → 409 stand_geaendert', async () => {
    await withDraft();
    const token = await codeFor('assign.submit', submitParams());
    const submission = fake.assignments.get(A)!.submission!;
    submission.files = [{ ...FILE, name: 'ganz-anders.pdf' }];
    const res = await execute('assign.submit', submitParams(), token);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).details).toMatchObject({ reason: 'stand_geaendert' });
    expect(fake.count('mod_assign_submit_for_grading')).toBe(0);
  });

  it('Text ändert sich bei gleichem timemodified → 409 stand_geaendert', async () => {
    await withDraft();
    fake.assignments.get(A)!.submission!.text = '<p>alt</p>';
    const token = await codeFor('assign.submit', submitParams());
    fake.assignments.get(A)!.submission!.text = '<p>neu</p>';
    const res = await execute('assign.submit', submitParams(), token);
    expect(errorOf(res).details).toMatchObject({ reason: 'stand_geaendert' });
    expect(fake.count('mod_assign_submit_for_grading')).toBe(0);
  });

  it('Inhalt der Datei ändert sich (contenthash), sonst alles gleich → 409 stand_geaendert', async () => {
    await setup();
    fake.add({ id: A });
    fake.draft(A, [{ ...FILE, hash: 'aa'.repeat(20) }]);
    const token = await codeFor('assign.submit', submitParams());
    fake.assignments.get(A)!.submission!.files[0]!.hash = 'bb'.repeat(20);
    const res = await execute('assign.submit', submitParams(), token);
    expect(errorOf(res).details).toMatchObject({ reason: 'stand_geaendert' });
  });

  it('save_draft derselben Aufgabe verwirft den Code zu submit, ein Code für eine andere Aufgabe bleibt gültig', async () => {
    await withDraft();
    fake.add({ id: 13, name: 'Blatt 4' });
    fake.draft(13, [{ ...FILE }]);
    const token12 = await codeFor('assign.submit', submitParams(false, 12));
    const token13 = await codeFor('assign.submit', submitParams(false, 13));
    expect((await execute('assign.save_draft', draftOf(12))).statusCode).toBe(200);
    const old = await execute('assign.submit', submitParams(false, 12), token12);
    expect(old.statusCode).toBe(409);
    expect(errorOf(old).code).toBe('moodle_confirmation_invalid');
    expect(fake.count('mod_assign_submit_for_grading')).toBe(0);
    const other = await execute('assign.submit', submitParams(false, 13), token13);
    expect(other.statusCode, other.body).toBe(200);
    expect(fake.count('mod_assign_submit_for_grading')).toBe(1);
  });

  it('auch ein save_draft ohne Änderung am Stand (Moodle ignoriert ihn) verwirft den Code', async () => {
    // Der Stand allein würde den Code halten; erst der Widerruf (E1a) macht ihn ungültig
    await withDraft();
    const token = await codeFor('assign.submit', submitParams());
    fake.fail.set('mod_assign_save_submission', 'network');
    const saved = await execute('assign.save_draft', draftOf());
    expect(saved.statusCode).toBe(502);
    expect(errorOf(saved).details).toMatchObject({ outcome_unknown: true });
    fake.fail.delete('mod_assign_save_submission');
    const res = await execute('assign.submit', submitParams(), token);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('moodle_confirmation_invalid');
    // Kein „stand_geaendert“: Der Stand ist gleich, der Code wurde widerrufen
    expect(errorOf(res).details).toBeUndefined();
    expect(fake.count('mod_assign_submit_for_grading')).toBe(0);
  });

  it('Wettlauf Vorschau gegen Speichern: Vorschau liest vor dem Speichern, gibt den Code danach aus → ungültig', async () => {
    await withDraft();
    const gate = fake.gate('mod_assign_get_submission_status');
    const slow = preview('assign.submit', submitParams());
    await gate.started.promise;
    // Dazwischen speichert jemand über den Core
    expect((await execute('assign.save_draft', draftOf())).statusCode).toBe(200);
    gate.release.resolve();
    const prev = MoodleActionPreviewSchema.parse((await slow).json());
    expect(prev.confirmation_token).toEqual(expect.any(String));
    const res = await execute('assign.submit', submitParams(), prev.confirmation_token);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('moodle_confirmation_invalid');
    expect(fake.count('mod_assign_submit_for_grading')).toBe(0);
  });

  it('Code zweimal → 409; Code mit anderem accept_statement → 409, nichts eingereicht', async () => {
    await withDraft({ statement: true });
    const token = await codeFor('assign.submit', submitParams(true));
    const wrong = await execute('assign.submit', submitParams(false), token);
    expect(wrong.statusCode).toBe(409);
    expect(errorOf(wrong).code).toBe('moodle_confirmation_invalid');
    expect(fake.count('mod_assign_submit_for_grading')).toBe(0);

    const second = await codeFor('assign.submit', submitParams(true));
    expect((await execute('assign.submit', submitParams(true), second)).statusCode).toBe(200);
    const replay = await execute('assign.submit', submitParams(true), second);
    expect(replay.statusCode).toBe(409);
    expect(fake.count('mod_assign_submit_for_grading')).toBe(1);
  });

  it('ohne Code → 409 moodle_confirmation_required, Moodle sieht nur Lesezugriffe', async () => {
    await withDraft();
    const res = await execute('assign.submit', submitParams());
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('moodle_confirmation_required');
    expect(fake.touched().filter((c) => c.includes('submit') || c === 'upload.php')).toEqual([]);
  });

  it('Scheitert das Neulesen beim Ausführen (502), bleibt der Code gültig', async () => {
    await withDraft();
    const token = await codeFor('assign.submit', submitParams());
    fake.fail.set('mod_assign_get_submission_status', 'exception');
    const broken = await execute('assign.submit', submitParams(), token);
    expect(broken.statusCode).toBe(502);
    expect(fake.count('mod_assign_submit_for_grading')).toBe(0);
    fake.fail.delete('mod_assign_get_submission_status');
    const ok = await execute('assign.submit', submitParams(), token);
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('Neulesen scheitert in der Vorschau (502) → kein Code', async () => {
    await withDraft();
    fake.fail.set('mod_assign_get_submission_status', 'exception');
    const res = await preview('assign.submit', submitParams());
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('confirmation_token":"');
  });
});

describe('assign.submit: gleichzeitige Aufrufe (Sperre je Aufgabe)', () => {
  it('zwei execute: das zweite wartet und scheitert dann am Stand, eingereicht wird einmal', async () => {
    await withDraft();
    const first = await codeFor('assign.submit', submitParams());
    const second = await codeFor('assign.submit', submitParams());
    const gate = fake.gate('mod_assign_submit_for_grading');
    const a = execute('assign.submit', submitParams(), first);
    await gate.started.promise;
    const b = execute('assign.submit', submitParams(), second);
    gate.release.resolve();
    expect((await a).statusCode).toBe(200);
    const late = await b;
    expect(late.statusCode).toBe(409);
    expect(errorOf(late).details).toMatchObject({ reason: 'stand_geaendert' });
    expect(fake.count('mod_assign_submit_for_grading')).toBe(1);
  });

  it('hält die erste länger als das Zeitlimit: 409 moodle_action_busy, kein Schreibaufruf der zweiten', async () => {
    await withDraft({}, { lockTimeoutMs: 30 });
    const first = await codeFor('assign.submit', submitParams());
    const second = await codeFor('assign.submit', submitParams());
    const gate = fake.gate('mod_assign_submit_for_grading');
    const a = execute('assign.submit', submitParams(), first);
    await gate.started.promise;
    const busy = await execute('assign.submit', submitParams(), second);
    expect(busy.statusCode).toBe(409);
    expect(errorOf(busy).code).toBe('moodle_action_busy');
    gate.release.resolve();
    expect((await a).statusCode).toBe(200);
    expect(fake.count('mod_assign_submit_for_grading')).toBe(1);
  });

  it('submit und save_draft derselben Aufgabe laufen nie gleichzeitig', async () => {
    await withDraft();
    const token = await codeFor('assign.submit', submitParams());
    const gate = fake.gate('mod_assign_submit_for_grading');
    const submitting = execute('assign.submit', submitParams(), token);
    await gate.started.promise;
    const statusReads = fake.count('mod_assign_get_submission_status');
    const saving = execute('assign.save_draft', draftOf());
    // Solange eingereicht wird, liest save_draft nicht einmal den Stand (es wartet auf die Sperre). Ohne Sperre
    // hätte es in dieser Zeit längst gelesen und geschrieben
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fake.count('mod_assign_get_submission_status')).toBe(statusReads);
    expect(fake.count('mod_assign_save_submission')).toBe(0);
    gate.release.resolve();
    expect((await submitting).statusCode).toBe(200);
    // Danach läuft das Speichern (im Fake bleibt canedit true, Moodle selbst würde es ablehnen)
    expect((await saving).statusCode).toBe(200);
    const order = fake.calls.filter((c) => c.startsWith('mod_assign_s'));
    expect(order.indexOf('mod_assign_submit_for_grading')).toBeLessThan(
      order.indexOf('mod_assign_save_submission'),
    );
    expect(fake.count('mod_assign_submit_for_grading')).toBe(1);
  });
});

describe('assign.submit: Vorprüfungen (409 moodle_action_rejected, nichts geschrieben)', () => {
  const cases: [string, Partial<FakeAssignment>, string][] = [
    ['ohne Einreichen-Schritt', { drafts: false }, 'nichts_einzureichen'],
    [
      'schon eingereicht',
      { submission: { id: 1, status: 'submitted', modified: 5, files: [{ ...FILE }], text: null } },
      'schon_eingereicht',
    ],
    ['kein Entwurf', { submission: null }, 'nichts_einzureichen'],
    [
      'leerer Entwurf',
      { submission: { id: 1, status: 'draft', modified: 5, files: [], text: null } },
      'nichts_einzureichen',
    ],
    [
      'Frist vorbei',
      {
        cansubmit: false,
        cutoffdate: NOW_SEC - HOUR,
        submission: { id: 1, status: 'draft', modified: 5, files: [{ ...FILE }], text: null },
      },
      'frist_vorbei',
    ],
    [
      'noch nicht offen',
      {
        cansubmit: false,
        allowfrom: NOW_SEC + HOUR,
        submission: { id: 1, status: 'draft', modified: 5, files: [{ ...FILE }], text: null },
      },
      'noch_nicht_offen',
    ],
    [
      'sonst nicht möglich',
      {
        cansubmit: false,
        submission: { id: 1, status: 'draft', modified: 5, files: [{ ...FILE }], text: null },
      },
      'nicht_bearbeitbar',
    ],
  ];

  it.each(cases)('%s', async (_name, patch, reason) => {
    await setup();
    fake.add({ id: A, ...patch });
    const res = await preview('assign.submit', submitParams());
    expect(res.statusCode, res.body).toBe(409);
    expect(errorOf(res)).toMatchObject({ code: 'moodle_action_rejected', details: { reason } });
    expect(res.body).not.toContain('confirmation_token":"');
    const out = await execute('assign.submit', submitParams(), 'x'.repeat(20));
    expect(out.statusCode).toBe(409);
    expect(fake.count('mod_assign_submit_for_grading')).toBe(0);
  });

  it('unbekannte Aufgabe → nicht_gefunden', async () => {
    await setup();
    fake.add({ id: A });
    const res = await preview('assign.submit', submitParams(false, 404));
    expect(errorOf(res).details).toMatchObject({ reason: 'nicht_gefunden' });
  });

  it('Frist läuft zwischen Vorschau und Ausführen ab: Ablehnung statt Schreibaufruf', async () => {
    await withDraft();
    const token = await codeFor('assign.submit', submitParams());
    // can_submit gehört nicht zum Stand: Der Code gilt noch, die Vorprüfung im Handler greift
    const a = fake.assignments.get(A)!;
    a.cansubmit = false;
    a.cutoffdate = NOW_SEC - HOUR;
    const res = await execute('assign.submit', submitParams(), token);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: 'moodle_action_rejected',
      details: { reason: 'frist_vorbei' },
    });
    expect(fake.count('mod_assign_submit_for_grading')).toBe(0);
  });
});

describe('assign.submit: Fehler von Moodle', () => {
  it('Netzfehler beim Einreichen → 502 outcome_unknown, genau ein Versuch', async () => {
    await withDraft();
    const token = await codeFor('assign.submit', submitParams());
    fake.fail.set('mod_assign_submit_for_grading', 'network');
    const res = await execute('assign.submit', submitParams(), token);
    expect(res.statusCode).toBe(502);
    expect(errorOf(res).details).toMatchObject({ outcome_unknown: true });
    expect(fake.count('mod_assign_submit_for_grading')).toBe(1);
  });

  it('Warnliste → 502 moodle_error mit warningcode; Antwort null → outcome_unknown', async () => {
    await withDraft();
    fake.fail.set('mod_assign_submit_for_grading', 'warn');
    const warn = await execute(
      'assign.submit',
      submitParams(),
      await codeFor('assign.submit', submitParams()),
    );
    expect(warn.statusCode).toBe(502);
    expect(errorOf(warn)).toMatchObject({
      code: 'moodle_error',
      details: { moodle_errorcode: 'couldnotsavesubmission' },
    });
    fake.fail.set('mod_assign_submit_for_grading', 'null');
    const none = await execute(
      'assign.submit',
      submitParams(),
      await codeFor('assign.submit', submitParams()),
    );
    expect(none.statusCode).toBe(502);
    expect(errorOf(none).details).toMatchObject({ outcome_unknown: true });
  });

  it('Entwurf ändert sich genau beim Einreichen (Restrisiko): Warnung im Ergebnis', async () => {
    await withDraft();
    const token = await codeFor('assign.submit', submitParams());
    const gate = fake.gate('mod_assign_submit_for_grading');
    const running = execute('assign.submit', submitParams(), token);
    await gate.started.promise;
    fake.assignments.get(A)!.submission!.files.push({ ...FILE, name: 'nachgeschoben.pdf' });
    gate.release.resolve();
    const res = await running;
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json().result as { warnings: string[] }).warnings.join(' ')).toContain(
      'kurz vor dem Einreichen geändert',
    );
  });
});

// ---------- Rahmen ----------

describe('Gegenprobe: jedes Feld des Stands zählt (Review #303)', () => {
  type Change = (a: FakeAssignment, s: FakeSubmission) => void;
  const cases: [string, Change][] = [
    ['Abgabe-ID', (_a, s) => (s.id += 1)],
    ['Status', (_a, s) => (s.status = 'new')],
    ['Versuch', (_a, s) => (s.attempt = 1)],
    ['Größe einer Datei', (_a, s) => (s.files[0]!.bytes += 1)],
    ['timemodified einer Datei', (_a, s) => (s.files[0]!.modified += 1)],
    ['Ordner einer Datei', (_a, s) => (s.files[0]!.path = '/neu/')],
    ['Einreichen-Schritt (submissiondrafts)', (a) => (a.drafts = false)],
    ['Erklärung verlangt', (a) => (a.statement = true)],
  ];
  for (const [label, change] of cases) {
    it(`${label} ändert sich, sonst alles gleich → 409 stand_geaendert, nichts eingereicht`, async () => {
      await withDraft();
      const token = await codeFor('assign.submit', submitParams(true));
      const a = fake.assignments.get(A)!;
      change(a, a.submission!);
      const res = await execute('assign.submit', submitParams(true), token);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: 'moodle_confirmation_invalid',
        details: { reason: 'stand_geaendert' },
      });
      expect(fake.count('mod_assign_submit_for_grading')).toBe(0);
    });
  }

  it('Langer Dateiname: eine Umbenennung hinter Zeichen 120 zählt', async () => {
    await setup();
    fake.add({ id: A });
    fake.draft(A, [{ ...FILE, name: `${'a'.repeat(130)}-1.pdf` }]);
    const token = await codeFor('assign.submit', submitParams());
    fake.assignments.get(A)!.submission!.files[0]!.name = `${'a'.repeat(130)}-2.pdf`;
    const res = await execute('assign.submit', submitParams(), token);
    expect(errorOf(res).details).toMatchObject({ reason: 'stand_geaendert' });
    expect(fake.count('mod_assign_submit_for_grading')).toBe(0);
  });

  it('Gruppenabgabe: ein Teammitglied ändert nur die Dateiliste → 409 stand_geaendert', async () => {
    await withDraft({ team: true });
    const token = await codeFor('assign.submit', submitParams());
    fake.assignments.get(A)!.submission!.files.push({ ...FILE, name: 'vom-team.pdf' });
    const res = await execute('assign.submit', submitParams(), token);
    expect(errorOf(res).details).toMatchObject({ reason: 'stand_geaendert' });
    expect(fake.count('mod_assign_submit_for_grading')).toBe(0);
  });

  it('save_draft: der Stand enthält sha256, Größe und Namen der Uploads (E5) und ist deterministisch', async () => {
    await withDraft({ drafts: false });
    const one = await put('b.pdf');
    const two = await put('a.pdf', Buffer.from('%PDF-1.7\n%anders\n'));
    const handler = createAssignHandlers({ now: () => NOW_MS })['assign.save_draft'];
    const ctx: MoodleActionContext = {
      client: moodle.client,
      userId: async () => 1,
      uploads: moodle.uploads,
      courseIdOfAssignment: async () => null,
    };
    const params = { assignment_id: A, upload_ids: [one.id, two.id] };
    const first = (await handler.state!(ctx, params)) as { uploads: unknown };
    const reversed = await handler.state!(ctx, { assignment_id: A, upload_ids: [two.id, one.id] });
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(first));
    expect(first.uploads).toEqual(
      [one, two]
        .map((u) => ({ sha256: u.sha256, bytes: u.sizeBytes, name: u.filename }))
        .sort((x, y) => (x.sha256 < y.sha256 ? -1 : 1)),
    );
  });

  it('save_draft: submissiondrafts fehlt in der Antwort → nur mit Code (streng)', async () => {
    await setup();
    fake.add({ id: A, drafts: null });
    const prev = MoodleActionPreviewSchema.parse((await preview('assign.save_draft', draftOf())).json());
    expect(prev.needs_confirmation).toBe(true);
    expect(prev.confirmation_token).toEqual(expect.any(String));
    const res = await execute('assign.save_draft', draftOf());
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('moodle_confirmation_required');
    expect(fake.count('mod_assign_save_submission')).toBe(0);
  });

  it('save_draft: Aufgabe stellt zwischen Code-Prüfung und Stand auf „ohne Einreichen-Schritt“ um → kein Schreiben', async () => {
    await setup();
    fake.add({ id: A });
    const file = await put();
    // 1. Lesen der Aufgabe: Code-Pflicht wird entschieden (nein). 2. Lesen: Stand unter der Sperre
    fake.beforeCall = (fn, n) => {
      if (fn === 'mod_assign_get_assignments' && n === 2) fake.assignments.get(A)!.drafts = false;
    };
    const res = await execute('assign.save_draft', { assignment_id: A, upload_ids: [file.id] });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('moodle_confirmation_required');
    expect(fake.touched().filter((c) => c === 'upload.php' || c === 'mod_assign_save_submission')).toEqual(
      [],
    );
  });
});

describe('Schalter SG_MOODLE_ACTIONS und Katalog', () => {
  it('ohne Freischaltung: beide 501, Moodle sieht nichts', async () => {
    await setup({ moodleActions: [] });
    fake.add({ id: A });
    for (const [id, params] of [
      ['assign.save_draft', draftOf()],
      ['assign.submit', submitParams()],
    ] as const) {
      for (const kind of ['preview', 'execute'] as const) {
        const res = await call(kind, id, params);
        expect(res.statusCode).toBe(501);
        expect(errorOf(res).code).toBe('moodle_action_not_implemented');
      }
    }
    expect(fake.touched()).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it('Katalog: verfügbar nur freigeschaltet und mit allen drei Funktionen', async () => {
    await setup({ moodleActions: ['assign.submit'] });
    const items = MoodleActionCatalogSchema.parse((await app!.inject('/moodle/actions')).json()).items;
    const byId = Object.fromEntries(items.map((i) => [i.id, i.available]));
    expect(byId['assign.submit']).toBe(true);
    expect(byId['assign.save_draft']).toBe(false);
    await app?.close();
    await setup({
      moodleActions: ['assign.submit', 'assign.save_draft'],
      functions: ALL_FUNCTIONS.filter((f) => f !== 'mod_assign_get_assignments'),
    });
    const noRead = MoodleActionCatalogSchema.parse((await app!.inject('/moodle/actions')).json()).items;
    expect(noRead.find((i) => i.id === 'assign.submit')?.available).toBe(false);
    expect(noRead.find((i) => i.id === 'assign.save_draft')?.available).toBe(false);
  });
});

describe('Kurs-ID der Aufgabe aus dem Kontext (courseIdOfAssignment)', () => {
  function context(course: number | null): MoodleActionContext {
    return {
      client: moodle.client,
      userId: async () => 1,
      uploads: moodle.uploads,
      courseIdOfAssignment: async () => course,
    };
  }

  it('bekannte Kurs-ID: nur dieser Kurs wird gelesen', async () => {
    await setup();
    fake.add({ id: A });
    const handler = createAssignHandlers({ now: () => NOW_MS })['assign.submit'];
    await handler.state!(context(5), submitParams());
    expect(fake.bodyOf('mod_assign_get_assignments').map((b) => b.get('courseids[0]'))).toEqual(['5']);
  });

  it('unbekannt: alle Kurse; veraltete Kurs-ID: zweiter Versuch über alle Kurse', async () => {
    await setup();
    fake.add({ id: A });
    const handler = createAssignHandlers({ now: () => NOW_MS })['assign.submit'];
    await handler.state!(context(null), submitParams());
    expect(fake.bodyOf('mod_assign_get_assignments').map((b) => b.get('courseids[0]'))).toEqual([null]);
    await handler.state!(context(99), submitParams());
    expect(
      fake
        .bodyOf('mod_assign_get_assignments')
        .map((b) => b.get('courseids[0]'))
        .slice(1),
    ).toEqual(['99', null]);
  });

  it('Fehler beim Nachschlagen zählt als unbekannt', async () => {
    await setup();
    fake.add({ id: A });
    const handler = createAssignHandlers({ now: () => NOW_MS })['assign.submit'];
    const ctx: MoodleActionContext = {
      ...context(null),
      courseIdOfAssignment: async () => {
        throw new Error('DB weg');
      },
    };
    await expect(handler.state!(ctx, submitParams())).resolves.toBeTruthy();
  });
});

describe('Hilfsfunktionen', () => {
  it('htmlToPreviewText: Tags weg, Skripte weg, Entitäten, 500 Zeichen', () => {
    expect(htmlToPreviewText('<p>a &amp; b</p><p>c<br>d</p><style>x{}</style>')).toBe('a & b\nc\nd');
    expect(htmlToPreviewText('<p>&lt;b&gt;</p>')).toBe('<b>');
    const long = htmlToPreviewText(`<p>${'ä'.repeat(600)}</p>`);
    expect([...long]).toHaveLength(501);
    expect(long.endsWith('…')).toBe(true);
    expect(htmlToPreviewText('x\u0000y\u0007z')).toBe('x y z');
  });

  it('formatSize wie in der Web-App', () => {
    expect(formatSize(900)).toBe('900 B');
    expect(formatSize(300 * 1024)).toBe('300 KB');
    expect(formatSize(1_258_291)).toBe('1,2 MB');
  });

  it('Namen aus Moodle: Steuerzeichen raus, auf 120 Zeichen gekürzt', async () => {
    await setup();
    fake.add({ id: A, name: `Blatt\u0007 ${'x'.repeat(200)}` });
    fake.draft(A, [{ ...FILE }]);
    const prev = MoodleActionPreviewSchema.parse((await preview('assign.submit', submitParams())).json());
    const name = prev.details.assignment_name as string;
    // eslint-disable-next-line no-control-regex -- prüft ausdrücklich auf Steuerzeichen
    expect(name).not.toMatch(/[\u0000-\u001f]/);
    expect([...name].length).toBeLessThanOrEqual(121);
  });
});
