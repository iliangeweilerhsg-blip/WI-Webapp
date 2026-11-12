import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  MoodleActionCatalogSchema,
  MoodleActionPreviewSchema,
  MoodleActionResultSchema,
  MoodleStatusSchema,
  type MoodleActionId,
} from '@sg/shared';
import { MOODLE_GATED_ACTIONS } from '../../src/config.ts';
import {
  DEFAULT_ACTION_HANDLERS,
  MOODLE_ACTION_SPECS,
  MOODLE_UNGATED_ACTIONS,
  MoodleActionRegistry,
  type MoodleActionContext,
  type MoodleActionHandlers,
} from '../../src/moodle/actions.ts';
import { HttpError } from '../../src/errors.ts';
import { WRITE_WSFUNCTIONS } from '../../src/moodle/client.ts';
import { createMoodleServices } from '../../src/moodle/index.ts';
import { StaticTokenStore } from '../../src/moodle/token-store.ts';
import { registerErrorHandler } from '../../src/plugins/errors.ts';
import { moodleRoutes } from '../../src/routes/moodle.ts';
import { FAKE_BASE, FAKE_TOKEN, fakeFetch, restHandler, siteInfo } from './moodle-fake.ts';

/** Nur die Aktionen ohne Schalter: Die Handler aus T1-24 ersetzen die Tests selbst (siehe moodle-assign.test.ts) */
const BASE_HANDLERS: MoodleActionHandlers = {
  'completion.set': DEFAULT_ACTION_HANDLERS['completion.set']!,
  'notifications.mark_read': DEFAULT_ACTION_HANDLERS['notifications.mark_read']!,
};

const ALL_FUNCTIONS = [
  'core_webservice_get_site_info',
  'mod_assign_get_assignments',
  'mod_assign_get_submission_status',
  'mod_assign_submit_for_grading',
  'core_completion_update_activity_completion_status_manually',
  'core_message_mark_all_notifications_as_read',
];

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function setup(
  options: {
    token?: string | null;
    baseUrl?: string;
    functions?: string[];
    handlers?: MoodleActionHandlers;
    responses?: Record<string, unknown>;
    now?: () => Date;
    moodleActions?: MoodleActionId[];
    lockTimeoutMs?: number;
  } = {},
) {
  const fake = fakeFetch(
    restHandler({
      core_webservice_get_site_info: siteInfo(options.functions ?? ALL_FUNCTIONS),
      ...options.responses,
    }),
  );
  const executed: unknown[] = [];
  const submitHandler: MoodleActionHandlers['assign.submit'] = {
    async preview(_ctx, params) {
      return {
        summary: `Aufgabe ${params.assignment_id} endgültig einreichen.`,
        warnings: ['Danach keine Änderungen mehr.'],
      };
    },
    async execute(_ctx, params) {
      executed.push(params);
      return { summary: 'Eingereicht.', result: { submitted: true } };
    },
  };
  const moodle = createMoodleServices({
    config: {
      moodleUrl: options.baseUrl ?? FAKE_BASE,
      dataDir: '/gibt/es/nicht',
      // Die Test-Handler stehen hinter dem Schalter (E12); ohne Angabe sind alle Aktionen aus T1-24 frei
      moodleActions: options.moodleActions ?? [...MOODLE_GATED_ACTIONS],
    },
    tokens: new StaticTokenStore(options.token === undefined ? FAKE_TOKEN : options.token),
    fetch: fake.fetch,
    handlers: options.handlers ?? { ...BASE_HANDLERS, 'assign.submit': submitHandler },
    readMeta: async () => ({ token_valid_until: '2027-01-27' }),
    ...(options.now ? { now: options.now } : {}),
    ...(options.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: options.lockTimeoutMs }),
  });
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  await app.register(moodleRoutes, { moodle });
  await app.ready();
  return { app, requests: fake.requests, executed };
}

const submitParams = { assignment_id: 12, accept_statement: true };

describe('GET /moodle/status', () => {
  it('liefert den Zustand nach Schema', async () => {
    const { app: a } = await setup();
    const res = await a.inject('/moodle/status');
    expect(res.statusCode).toBe(200);
    expect(MoodleStatusSchema.parse(res.json())).toMatchObject({
      state: 'ok',
      user_fullname: 'Erika Muster',
    });
    expect(res.body).not.toContain(FAKE_TOKEN);
  });

  it('ohne Moodle → nicht_eingerichtet', async () => {
    const { app: a } = await setup({ baseUrl: '' });
    expect((await a.inject('/moodle/status')).json()).toMatchObject({ state: 'nicht_eingerichtet' });
  });
});

describe('GET /moodle/actions', () => {
  it('zeigt alle 9 Aktionen, verfügbar nur wenn umgesetzt und freigegeben', async () => {
    const { app: a } = await setup();
    const catalog = MoodleActionCatalogSchema.parse((await a.inject('/moodle/actions')).json());
    expect(catalog.items.map((item) => item.id)).toEqual([
      'assign.save_draft',
      'assign.submit',
      'forum.create_discussion',
      'forum.reply',
      'completion.set',
      'calendar.create_event',
      'message.send',
      'notifications.mark_read',
      'files.upload_private',
    ]);
    const byId = Object.fromEntries(catalog.items.map((item) => [item.id, item]));
    expect(byId['assign.submit']).toMatchObject({
      risk: 'endgueltig',
      needs_confirmation: true,
      available: true,
    });
    expect(byId['completion.set']).toMatchObject({ needs_confirmation: false, available: true });
    // Nicht umgesetzt
    expect(byId['forum.reply']).toMatchObject({ needs_confirmation: true, available: false });
  });

  it('ohne Freigabe der Moodle-Funktion ist die Aktion nicht verfügbar', async () => {
    const { app: a } = await setup({ functions: ['core_webservice_get_site_info'] });
    const catalog = MoodleActionCatalogSchema.parse((await a.inject('/moodle/actions')).json());
    expect(catalog.items.every((item) => !item.available)).toBe(true);
  });
});

describe('Vorschau und Ausführen (F-MDL-05, F-MDL-06)', () => {
  it('endgültige Aktion: ohne Code 409, mit Code aus der Vorschau genau einmal', async () => {
    const { app: a, executed } = await setup();

    const without = await a.inject({
      method: 'POST',
      url: '/moodle/actions/assign.submit/execute',
      payload: { params: submitParams },
    });
    expect(without.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(without.json()).error.code).toBe('moodle_confirmation_required');
    expect(executed).toHaveLength(0);

    const preview = await a.inject({
      method: 'POST',
      url: '/moodle/actions/assign.submit/preview',
      payload: { params: submitParams },
    });
    expect(preview.statusCode).toBe(200);
    const body = MoodleActionPreviewSchema.parse(preview.json());
    expect(body).toMatchObject({
      action_id: 'assign.submit',
      risk: 'endgueltig',
      needs_confirmation: true,
      summary: 'Aufgabe 12 endgültig einreichen.',
      warnings: ['Danach keine Änderungen mehr.'],
    });
    expect(body.confirmation_token).toEqual(expect.any(String));
    expect(body.expires_at).toEqual(expect.any(String));

    const run = await a.inject({
      method: 'POST',
      url: '/moodle/actions/assign.submit/execute',
      payload: { params: submitParams, confirmation_token: body.confirmation_token },
    });
    expect(run.statusCode).toBe(200);
    expect(MoodleActionResultSchema.parse(run.json())).toEqual({
      action_id: 'assign.submit',
      summary: 'Eingereicht.',
      result: { submitted: true },
    });
    expect(executed).toEqual([submitParams]);

    const again = await a.inject({
      method: 'POST',
      url: '/moodle/actions/assign.submit/execute',
      payload: { params: submitParams, confirmation_token: body.confirmation_token },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('moodle_confirmation_invalid');
    expect(executed).toHaveLength(1);
  });

  it('Code gilt nicht für geänderte Parameter', async () => {
    const { app: a, executed } = await setup();
    const preview = MoodleActionPreviewSchema.parse(
      (
        await a.inject({
          method: 'POST',
          url: '/moodle/actions/assign.submit/preview',
          payload: { params: submitParams },
        })
      ).json(),
    );
    const res = await a.inject({
      method: 'POST',
      url: '/moodle/actions/assign.submit/execute',
      payload: {
        params: { ...submitParams, assignment_id: 13 },
        confirmation_token: preview.confirmation_token,
      },
    });
    expect(res.json().error.code).toBe('moodle_confirmation_invalid');
    expect(executed).toHaveLength(0);
  });

  it('änderbare Aktion läuft ohne Code und schreibt nach Moodle', async () => {
    const { app: a, requests } = await setup({
      responses: {
        core_completion_update_activity_completion_status_manually: { status: true, warnings: [] },
      },
    });
    const preview = MoodleActionPreviewSchema.parse(
      (
        await a.inject({
          method: 'POST',
          url: '/moodle/actions/completion.set/preview',
          payload: { params: { cmid: 5, completed: true } },
        })
      ).json(),
    );
    expect(preview).toMatchObject({ needs_confirmation: false, confirmation_token: null, expires_at: null });
    // Vorschau schreibt nichts
    expect(requests.map((r) => r.body.get('wsfunction'))).toEqual(['core_webservice_get_site_info']);

    const res = await a.inject({
      method: 'POST',
      url: '/moodle/actions/completion.set/execute',
      payload: { params: { cmid: 5, completed: true } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: { status: true } });
    const write = requests.find(
      (r) => r.body.get('wsfunction') === 'core_completion_update_activity_completion_status_manually',
    );
    expect(write?.body.get('cmid')).toBe('5');
    expect(write?.body.get('completed')).toBe('1');
  });

  it('harmlose Aktion nutzt die Nutzer-ID aus Moodle', async () => {
    const { app: a, requests } = await setup({
      responses: { core_message_mark_all_notifications_as_read: true },
    });
    const res = await a.inject({
      method: 'POST',
      url: '/moodle/actions/notifications.mark_read/execute',
      payload: { params: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: { done: true } });
    const write = requests.find(
      (r) => r.body.get('wsfunction') === 'core_message_mark_all_notifications_as_read',
    );
    expect(write?.body.get('useridto')).toBe('4711');
  });

  it('Fehlerfälle: unbekannt 404, nicht umgesetzt 501, Parameter 400, nicht eingerichtet 503, nicht freigegeben 501', async () => {
    const { app: a } = await setup();
    const post = (url: string, params: unknown) => a.inject({ method: 'POST', url, payload: { params } });

    let res = await post('/moodle/actions/quiz.start/preview', {});
    expect([res.statusCode, res.json().error.code]).toEqual([404, 'moodle_action_not_found']);

    res = await post('/moodle/actions/forum.reply/preview', { post_id: 1, message_html: 'x' });
    expect([res.statusCode, res.json().error.code]).toEqual([501, 'moodle_action_not_implemented']);

    res = await post('/moodle/actions/completion.set/execute', { cmid: 'fünf' });
    expect([res.statusCode, res.json().error.code]).toEqual([400, 'validation_failed']);
    expect(res.json().error.details.issues[0].path).toMatch(/^params\./);

    await app?.close();
    const off = await setup({ token: null });
    res = await off.app.inject({
      method: 'POST',
      url: '/moodle/actions/completion.set/execute',
      payload: { params: { cmid: 5, completed: true } },
    });
    expect([res.statusCode, res.json().error.code]).toEqual([503, 'moodle_not_configured']);

    await app?.close();
    const limited = await setup({ functions: ['core_webservice_get_site_info'] });
    res = await limited.app.inject({
      method: 'POST',
      url: '/moodle/actions/completion.set/execute',
      payload: { params: { cmid: 5, completed: true } },
    });
    expect([res.statusCode, res.json().error.code]).toEqual([501, 'moodle_function_unavailable']);
    expect(limited.requests.map((r) => r.body.get('wsfunction'))).toEqual(['core_webservice_get_site_info']);
  });

  it('Body mit unbekannten Feldern wird abgelehnt', async () => {
    const { app: a } = await setup();
    const res = await a.inject({
      method: 'POST',
      url: '/moodle/actions/completion.set/execute',
      payload: { params: { cmid: 5, completed: true }, extra: 1 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Nacharbeit Review: Bestätigung über die Route', () => {
  const replyParams = { post_id: 7, message_html: '<p>Danke!</p>' };
  function extraHandlers(executed: string[]): MoodleActionHandlers {
    return {
      ...BASE_HANDLERS,
      'forum.reply': {
        async preview() {
          return { summary: 'Antwort im Forum veröffentlichen.' };
        },
        async execute() {
          executed.push('forum.reply');
          return { summary: 'Veröffentlicht.', result: {} };
        },
      },
      'assign.save_draft': {
        // Aufgabe ohne Einreichen-Schritt: Speichern ist die Abgabe
        async requiresConfirmation(_ctx, params) {
          return params.assignment_id === 99;
        },
        async preview() {
          return { summary: 'Entwurf speichern.' };
        },
        async execute() {
          executed.push('assign.save_draft');
          return { summary: 'Gespeichert.', result: {} };
        },
      },
    };
  }
  const functions = [...ALL_FUNCTIONS, 'mod_forum_add_discussion_post', 'mod_assign_save_submission'];

  it('öffentliche Aktion braucht den Code genauso', async () => {
    const executed: string[] = [];
    const { app: a } = await setup({ handlers: extraHandlers(executed), functions });
    const res = await a.inject({
      method: 'POST',
      url: '/moodle/actions/forum.reply/execute',
      payload: { params: replyParams },
    });
    expect(res.json().error.code).toBe('moodle_confirmation_required');
    const preview = MoodleActionPreviewSchema.parse(
      (
        await a.inject({
          method: 'POST',
          url: '/moodle/actions/forum.reply/preview',
          payload: { params: replyParams },
        })
      ).json(),
    );
    expect(preview.risk).toBe('oeffentlich');
    const ok = await a.inject({
      method: 'POST',
      url: '/moodle/actions/forum.reply/execute',
      payload: { params: replyParams, confirmation_token: preview.confirmation_token },
    });
    expect(ok.statusCode).toBe(200);
    expect(executed).toEqual(['forum.reply']);
  });

  it('abgelaufener Code wird abgelehnt', async () => {
    let now = new Date('2026-11-04T10:00:00Z');
    const executed: string[] = [];
    const { app: a } = await setup({ handlers: extraHandlers(executed), functions, now: () => now });
    const preview = MoodleActionPreviewSchema.parse(
      (
        await a.inject({
          method: 'POST',
          url: '/moodle/actions/forum.reply/preview',
          payload: { params: replyParams },
        })
      ).json(),
    );
    expect(preview.expires_at).toBe('2026-11-04T10:05:00.000Z');
    now = new Date('2026-11-04T10:05:01Z');
    const res = await a.inject({
      method: 'POST',
      url: '/moodle/actions/forum.reply/execute',
      payload: { params: replyParams, confirmation_token: preview.confirmation_token },
    });
    expect(res.json().error.code).toBe('moodle_confirmation_invalid');
    expect(executed).toHaveLength(0);
  });

  it('zwei gleichzeitige Ausführungen mit demselben Code: genau eine läuft', async () => {
    const executed: string[] = [];
    const { app: a } = await setup({ handlers: extraHandlers(executed), functions });
    const preview = MoodleActionPreviewSchema.parse(
      (
        await a.inject({
          method: 'POST',
          url: '/moodle/actions/forum.reply/preview',
          payload: { params: replyParams },
        })
      ).json(),
    );
    const run = () =>
      a.inject({
        method: 'POST',
        url: '/moodle/actions/forum.reply/execute',
        payload: { params: replyParams, confirmation_token: preview.confirmation_token },
      });
    const results = await Promise.all([run(), run()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(executed).toEqual(['forum.reply']);
  });

  it('Handler kann Bestätigung im Einzelfall verlangen (assign.save_draft ohne Einreichen-Schritt)', async () => {
    const executed: string[] = [];
    const { app: a } = await setup({ handlers: extraHandlers(executed), functions });
    const normal = { assignment_id: 1, online_text_html: '<p>x</p>' };
    const direct = { assignment_id: 99, online_text_html: '<p>x</p>' };

    const plain = await a.inject({
      method: 'POST',
      url: '/moodle/actions/assign.save_draft/execute',
      payload: { params: normal },
    });
    expect(plain.statusCode).toBe(200);

    const blocked = await a.inject({
      method: 'POST',
      url: '/moodle/actions/assign.save_draft/execute',
      payload: { params: direct },
    });
    expect(blocked.json().error.code).toBe('moodle_confirmation_required');

    const preview = MoodleActionPreviewSchema.parse(
      (
        await a.inject({
          method: 'POST',
          url: '/moodle/actions/assign.save_draft/preview',
          payload: { params: direct },
        })
      ).json(),
    );
    expect(preview).toMatchObject({ risk: 'aenderbar', needs_confirmation: true });
    const ok = await a.inject({
      method: 'POST',
      url: '/moodle/actions/assign.save_draft/execute',
      payload: { params: direct, confirmation_token: preview.confirmation_token },
    });
    expect(ok.statusCode).toBe(200);
    expect(executed).toEqual(['assign.save_draft', 'assign.save_draft']);
  });
});

describe('Härtung #93: defensive Zugriffe auf Moodle-Antworten', () => {
  it.each([null, 'ok', 1, []])(
    'completion.set: Antwort %j → 200 mit status false, kein 500',
    async (body) => {
      const { app: a } = await setup({
        responses: { core_completion_update_activity_completion_status_manually: body },
      });
      const res = await a.inject({
        method: 'POST',
        url: '/moodle/actions/completion.set/execute',
        payload: { params: { cmid: 5, completed: true } },
      });
      expect(res.statusCode).toBe(200);
      const result = MoodleActionResultSchema.parse(res.json());
      expect(result).toMatchObject({
        result: { status: false },
        summary: 'Moodle hat die Änderung nicht bestätigt.',
      });
    },
  );

  it.each([null, {}, 'true'])(
    'notifications.mark_read: Antwort %j → 200 mit done false, kein 500',
    async (body) => {
      const { app: a } = await setup({
        responses: { core_message_mark_all_notifications_as_read: body },
      });
      const res = await a.inject({
        method: 'POST',
        url: '/moodle/actions/notifications.mark_read/execute',
        payload: { params: {} },
      });
      expect(res.statusCode).toBe(200);
      expect(MoodleActionResultSchema.parse(res.json())).toMatchObject({
        result: { done: false },
        summary: 'Moodle hat die Änderung nicht bestätigt.',
      });
    },
  );

  it('functions: [null] in der Seiteninfo → Status und Katalog antworten mit 200', async () => {
    const fake = fakeFetch(
      restHandler({
        core_webservice_get_site_info: {
          ...siteInfo([]),
          functions: [null, { name: 'core_completion_update_activity_completion_status_manually' }],
        },
      }),
    );
    const moodle = createMoodleServices({
      config: { moodleUrl: FAKE_BASE, dataDir: '/gibt/es/nicht' },
      tokens: new StaticTokenStore(FAKE_TOKEN),
      fetch: fake.fetch,
      handlers: BASE_HANDLERS,
      readMeta: async () => ({ token_valid_until: '2027-01-27' }),
    });
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerErrorHandler(app);
    await app.register(moodleRoutes, { moodle });
    await app.ready();

    const status = await app.inject({ method: 'GET', url: '/moodle/status' });
    expect(status.statusCode).toBe(200);
    expect(MoodleStatusSchema.parse(status.json()).state).toBe('ok');
    const catalog = await app.inject({ method: 'GET', url: '/moodle/actions' });
    expect(catalog.statusCode).toBe(200);
    const items = MoodleActionCatalogSchema.parse(catalog.json()).items;
    expect(items.find((i) => i.id === 'completion.set')?.available).toBe(true);
    expect(items.find((i) => i.id === 'notifications.mark_read')?.available).toBe(false);
  });
});

describe('Schreibende Moodle-Funktionen', () => {
  it('jede schreibende Funktion aus dem Aktionskatalog steht in WRITE_WSFUNCTIONS', () => {
    const fromCatalog = Object.values(MOODLE_ACTION_SPECS)
      .flatMap((spec) => spec.wsfunctions)
      .filter((name) => !/_get_/.test(name));
    for (const name of fromCatalog) expect(WRITE_WSFUNCTIONS.has(name), name).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// T1-24 PR 1: Rahmen und Härtung (Stand, Widerruf, Sperre, Schalter)

interface Gate {
  promise: Promise<void>;
  open(): void;
}
function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/**
 * Handler für `assign.submit` (Stand + Bereich + Sperre) und `assign.save_draft` (Sperre + Widerruf) auf derselben
 * Aufgabe, gesteuert vom Test.
 */
function frameHandlers() {
  const control = {
    /** Stand je Aufgabe, ändert der Test wie ein Eingriff direkt in Moodle */
    draft: new Map<number, string>([
      [12, 'v1'],
      [13, 'v1'],
    ]),
    submitted: [] as number[],
    drafted: [] as number[],
    stateReads: 0,
    /** hält `state()` von assign.submit zurück (nach dem Lesen des Werts) */
    stateGate: null as Gate | null,
    stateError: null as Error | null,
    /** hält `execute` von assign.save_draft zurück */
    draftGate: null as Gate | null,
    draftEntered: null as Gate | null,
    draftFails: null as Error | null,
    /** hält `execute` von assign.submit zurück */
    submitGate: null as Gate | null,
    submitEntered: null as Gate | null,
  };
  const scopeOf = (id: number) => `assign:${id}`;
  const handlers: MoodleActionHandlers = {
    'assign.submit': {
      scope: (p) => scopeOf(p.assignment_id),
      lockKey: (p) => scopeOf(p.assignment_id),
      async state(_ctx, p) {
        control.stateReads += 1;
        if (control.stateError) throw control.stateError;
        const value = control.draft.get(p.assignment_id) ?? null;
        await control.stateGate?.promise;
        return { draft: value };
      },
      async preview(_ctx, p, state) {
        return { summary: `Aufgabe ${p.assignment_id} einreichen.`, details: { state } };
      },
      async execute(_ctx, p) {
        control.submitEntered?.open();
        await control.submitGate?.promise;
        control.submitted.push(p.assignment_id);
        return { summary: 'Eingereicht.', result: {} };
      },
    },
    'assign.save_draft': {
      scope: (p) => scopeOf(p.assignment_id),
      lockKey: (p) => scopeOf(p.assignment_id),
      revokesScope: (p) => scopeOf(p.assignment_id),
      async preview() {
        return { summary: 'Entwurf speichern.' };
      },
      async execute(_ctx, p) {
        control.draftEntered?.open();
        await control.draftGate?.promise;
        if (control.draftFails) throw control.draftFails;
        control.draft.set(p.assignment_id, 'v-gespeichert');
        control.drafted.push(p.assignment_id);
        return { summary: 'Gespeichert.', result: {} };
      },
    },
  };
  return { control, handlers };
}

const FRAME_FUNCTIONS = [
  'mod_assign_get_assignments',
  'core_webservice_get_site_info',
  'mod_assign_get_submission_status',
  'mod_assign_submit_for_grading',
  'mod_assign_save_submission',
];
const draftParams = (id: number) => ({ assignment_id: id, online_text_html: '<p>x</p>' });
const submitFor = (id: number) => ({ assignment_id: id, accept_statement: true });

async function previewOf(a: FastifyInstance, action: string, params: unknown) {
  const res = await a.inject({
    method: 'POST',
    url: `/moodle/actions/${action}/preview`,
    payload: { params },
  });
  expect(res.statusCode).toBe(200);
  return MoodleActionPreviewSchema.parse(res.json());
}

function executeOf(a: FastifyInstance, action: string, params: unknown, token?: string | null) {
  return a.inject({
    method: 'POST',
    url: `/moodle/actions/${action}/execute`,
    payload: { params, ...(token ? { confirmation_token: token } : {}) },
  });
}

describe('T1-24 Rahmen: Bindung an den Stand (state_changed)', () => {
  it('unveränderter Stand: Code gilt, execute bekommt den neu gelesenen Stand', async () => {
    const { control, handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS });
    const preview = await previewOf(a, 'assign.submit', submitFor(12));
    expect(preview.details).toEqual({ state: { draft: 'v1' } });
    const run = await executeOf(a, 'assign.submit', submitFor(12), preview.confirmation_token);
    expect(run.statusCode).toBe(200);
    expect(control.submitted).toEqual([12]);
    // Vorschau und Ausführen lesen je einmal
    expect(control.stateReads).toBe(2);
  });

  it('geänderter Stand (direkt in Moodle): 409 stand_geaendert, nichts geschrieben, Code verbraucht', async () => {
    const { control, handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS });
    const preview = await previewOf(a, 'assign.submit', submitFor(12));
    control.draft.set(12, 'v2-direkt-in-moodle');

    const res = await executeOf(a, 'assign.submit', submitFor(12), preview.confirmation_token);
    expect(res.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(res.json()).error).toMatchObject({
      code: 'moodle_confirmation_invalid',
      details: { reason: 'stand_geaendert' },
    });
    expect(control.submitted).toEqual([]);

    // Der Code ist verbraucht, auch wenn der Stand wieder passt. Grund jetzt: gewöhnlich ungültig
    control.draft.set(12, 'v1');
    const again = await executeOf(a, 'assign.submit', submitFor(12), preview.confirmation_token);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('moodle_confirmation_invalid');
    expect(again.json().error.details).toBeUndefined();
    expect(control.submitted).toEqual([]);
  });

  it('andere Parameter bleiben ein gewöhnliches invalid (ohne stand_geaendert)', async () => {
    const { handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS });
    const preview = await previewOf(a, 'assign.submit', submitFor(12));
    const res = await executeOf(a, 'assign.submit', submitFor(13), preview.confirmation_token);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('moodle_confirmation_invalid');
    expect(res.json().error.details).toBeUndefined();
  });

  it('Lesen des Stands scheitert beim Ausführen (502): Code bleibt gültig', async () => {
    const { control, handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS });
    const preview = await previewOf(a, 'assign.submit', submitFor(12));
    control.stateError = new HttpError(502, 'moodle_unreachable', 'nicht erreichbar');
    const failed = await executeOf(a, 'assign.submit', submitFor(12), preview.confirmation_token);
    expect(failed.statusCode).toBe(502);
    control.stateError = null;
    const ok = await executeOf(a, 'assign.submit', submitFor(12), preview.confirmation_token);
    expect(ok.statusCode).toBe(200);
    expect(control.submitted).toEqual([12]);
  });

  it('Lesen des Stands scheitert in der Vorschau: 502 und kein Code', async () => {
    const { control, handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS });
    control.stateError = new HttpError(502, 'moodle_unreachable', 'nicht erreichbar');
    const res = await a.inject({
      method: 'POST',
      url: '/moodle/actions/assign.submit/preview',
      payload: { params: submitFor(12) },
    });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('confirmation_token');
  });
});

describe('T1-24 Rahmen: Widerruf nach eigenem Schreiben (revokeScope, Zähler)', () => {
  it('save_draft verwirft offene Codes derselben Aufgabe, andere Aufgaben bleiben gültig', async () => {
    const { control, handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS });
    const p12 = await previewOf(a, 'assign.submit', submitFor(12));
    const p13 = await previewOf(a, 'assign.submit', submitFor(13));

    expect((await executeOf(a, 'assign.save_draft', draftParams(12))).statusCode).toBe(200);

    const old = await executeOf(a, 'assign.submit', submitFor(12), p12.confirmation_token);
    expect(old.statusCode).toBe(409);
    expect(old.json().error.code).toBe('moodle_confirmation_invalid');
    // Der Code ist schon aus dem Speicher: gewöhnlich ungültig, nicht „Stand geändert“
    expect(old.json().error.details).toBeUndefined();
    const other = await executeOf(a, 'assign.submit', submitFor(13), p13.confirmation_token);
    expect(other.statusCode).toBe(200);
    expect(control.submitted).toEqual([13]);
  });

  it('Wettlauf: Vorschau liest den Stand vor dem Speichern, gibt den Code danach aus → Code ungültig', async () => {
    const { control, handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS });
    // Die Vorschau liest den Zähler und den alten Stand und hängt dann am Lesen
    control.stateGate = gate();
    const pending = previewOf(a, 'assign.submit', submitFor(12));
    // save_draft schreibt und widerruft in der Zwischenzeit
    expect((await executeOf(a, 'assign.save_draft', draftParams(12))).statusCode).toBe(200);
    control.stateGate.open();
    const preview = await pending;
    expect(preview.confirmation_token).toEqual(expect.any(String));

    // Der Code wurde ausgegeben, ist aber nie gültig geworden
    control.stateGate = null;
    control.draft.set(12, 'v1');
    const res = await executeOf(a, 'assign.submit', submitFor(12), preview.confirmation_token);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('moodle_confirmation_invalid');
    expect(control.submitted).toEqual([]);
  });

  it('Widerruf im finally: auch wenn save_draft mit Fehler endet (outcome_unknown)', async () => {
    const { control, handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS });
    const preview = await previewOf(a, 'assign.submit', submitFor(12));
    control.draftFails = new HttpError(502, 'moodle_unreachable', 'Zeitlimit', { outcome_unknown: true });
    const failed = await executeOf(a, 'assign.save_draft', draftParams(12));
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error.details).toMatchObject({ outcome_unknown: true });

    control.draftFails = null;
    const res = await executeOf(a, 'assign.submit', submitFor(12), preview.confirmation_token);
    expect(res.statusCode).toBe(409);
    expect(control.submitted).toEqual([]);
  });

  it('Widerruf im finally: auch bei einem unerwarteten Fehler im Handler (500)', async () => {
    const { control, handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS });
    const preview = await previewOf(a, 'assign.submit', submitFor(12));
    control.draftFails = new Error('kaputt');
    expect((await executeOf(a, 'assign.save_draft', draftParams(12))).statusCode).toBe(500);
    control.draftFails = null;
    const res = await executeOf(a, 'assign.submit', submitFor(12), preview.confirmation_token);
    expect(res.statusCode).toBe(409);
  });

  it('Ablehnung vor dem Schreiben (moodle_action_rejected) widerruft nichts', async () => {
    const { control, handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS });
    const preview = await previewOf(a, 'assign.submit', submitFor(12));
    control.draftFails = new HttpError(409, 'moodle_action_rejected', 'Frist vorbei', {
      reason: 'frist_vorbei',
    });
    const rejected = await executeOf(a, 'assign.save_draft', draftParams(12));
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe('moodle_action_rejected');
    control.draftFails = null;
    const res = await executeOf(a, 'assign.submit', submitFor(12), preview.confirmation_token);
    expect(res.statusCode).toBe(200);
  });

  it('save_draft und Einreichen laufen nie gleichzeitig: Widerruf liegt vor der Freigabe der Sperre', async () => {
    const { control, handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS, lockTimeoutMs: 60_000 });
    const preview = await previewOf(a, 'assign.submit', submitFor(12));
    control.draftGate = gate();
    control.draftEntered = gate();
    const draft = executeOf(a, 'assign.save_draft', draftParams(12));
    await control.draftEntered.promise;
    // Das Einreichen wartet auf die Sperre; sobald save_draft fertig ist, ist der Code schon widerrufen
    const submit = executeOf(a, 'assign.submit', submitFor(12), preview.confirmation_token);
    control.draftGate.open();
    expect((await draft).statusCode).toBe(200);
    const res = await submit;
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('moodle_confirmation_invalid');
    expect(control.submitted).toEqual([]);
  });
});

describe('T1-24 Rahmen: Widerruf nur mit Sperre', () => {
  it('ein Handler mit revokesScope ohne lockKey lässt sich nicht eintragen', () => {
    const handler = {
      revokesScope: () => 'assign:1',
      async preview() {
        return { summary: 'x' };
      },
      async execute() {
        return { summary: 'x', result: {} };
      },
    };
    expect(() =>
      createMoodleServices({
        config: { moodleUrl: FAKE_BASE, dataDir: '/gibt/es/nicht' },
        tokens: new StaticTokenStore(FAKE_TOKEN),
        handlers: { 'assign.save_draft': handler },
      }),
    ).toThrow(/revokesScope ohne lockKey/);
  });
});

describe('T1-24 Rahmen: Sperre je Aufgabe (moodle_action_busy)', () => {
  it('belegt länger als das Zeitlimit: 409 moodle_action_busy, der Handler läuft nicht', async () => {
    const { control, handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS, lockTimeoutMs: 30 });
    control.draftGate = gate();
    control.draftEntered = gate();
    const first = executeOf(a, 'assign.save_draft', draftParams(12));
    await control.draftEntered.promise;

    const busy = await executeOf(a, 'assign.save_draft', draftParams(12));
    expect(busy.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(busy.json()).error.code).toBe('moodle_action_busy');
    expect(control.drafted).toEqual([]);

    control.draftGate.open();
    expect((await first).statusCode).toBe(200);
    expect(control.drafted).toEqual([12]);
    // Danach ist die Sperre frei, und eine andere Aufgabe war nie gesperrt
    expect((await executeOf(a, 'assign.save_draft', draftParams(12))).statusCode).toBe(200);
    expect((await executeOf(a, 'assign.save_draft', draftParams(13))).statusCode).toBe(200);
  });

  it('Wartende laufen nacheinander, wenn die Sperre vor dem Zeitlimit frei wird', async () => {
    const { control, handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS, lockTimeoutMs: 60_000 });
    control.draftGate = gate();
    control.draftEntered = gate();
    const first = executeOf(a, 'assign.save_draft', draftParams(12));
    await control.draftEntered.promise;
    const second = executeOf(a, 'assign.save_draft', draftParams(12));
    control.draftGate.open();
    expect([(await first).statusCode, (await second).statusCode]).toEqual([200, 200]);
    expect(control.drafted).toEqual([12, 12]);
  });

  it('die Sperre wird auch nach einem Fehler frei', async () => {
    const { control, handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS, lockTimeoutMs: 30 });
    control.draftFails = new HttpError(502, 'moodle_error', 'abgelehnt');
    expect((await executeOf(a, 'assign.save_draft', draftParams(12))).statusCode).toBe(502);
    control.draftFails = null;
    expect((await executeOf(a, 'assign.save_draft', draftParams(12))).statusCode).toBe(200);
  });

  it('die Sperre wird auch nach einem Fehler beim Einlösen frei (Stand geändert)', async () => {
    const { control, handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS, lockTimeoutMs: 30 });
    const preview = await previewOf(a, 'assign.submit', submitFor(12));
    control.draft.set(12, 'anders');
    expect((await executeOf(a, 'assign.submit', submitFor(12), preview.confirmation_token)).statusCode).toBe(
      409,
    );
    expect((await executeOf(a, 'assign.save_draft', draftParams(12))).statusCode).toBe(200);
  });

  it('zwei gleichzeitige Einreichen: das zweite wartet und scheitert dann am Stand', async () => {
    const { control, handlers } = frameHandlers();
    const { app: a } = await setup({ handlers, functions: FRAME_FUNCTIONS, lockTimeoutMs: 60_000 });
    const p1 = await previewOf(a, 'assign.submit', submitFor(12));
    const p2 = await previewOf(a, 'assign.submit', submitFor(12));
    control.submitGate = gate();
    control.submitEntered = gate();
    const first = executeOf(a, 'assign.submit', submitFor(12), p1.confirmation_token);
    await control.submitEntered.promise;
    const second = executeOf(a, 'assign.submit', submitFor(12), p2.confirmation_token);
    // Das Einreichen ändert den Stand in Moodle; das zweite liest ihn erst nach der Sperre
    control.draft.set(12, 'eingereicht');
    control.submitGate.open();
    expect((await first).statusCode).toBe(200);
    const res = await second;
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details).toMatchObject({ reason: 'stand_geaendert' });
    expect(control.submitted).toEqual([12]);
  });

  it('ohne lockKey gibt es keine Sperre (completion.set läuft parallel)', async () => {
    const { app: a } = await setup({
      responses: { core_completion_update_activity_completion_status_manually: { status: true } },
      lockTimeoutMs: 1,
    });
    const body = { params: { cmid: 5, completed: true } };
    const results = await Promise.all([
      a.inject({ method: 'POST', url: '/moodle/actions/completion.set/execute', payload: body }),
      a.inject({ method: 'POST', url: '/moodle/actions/completion.set/execute', payload: body }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
  });
});

describe('T1-24 Rahmen: Schalter SG_MOODLE_ACTIONS (E12)', () => {
  it('leer: Aktionen aus T1-24 sind aus, auch mit Handler; alte Aktionen laufen weiter', async () => {
    const { handlers } = frameHandlers();
    const { app: a, requests } = await setup({
      handlers: { ...BASE_HANDLERS, ...handlers },
      functions: [...FRAME_FUNCTIONS, 'core_completion_update_activity_completion_status_manually'],
      moodleActions: [],
      responses: { core_completion_update_activity_completion_status_manually: { status: true } },
    });
    const catalog = MoodleActionCatalogSchema.parse((await a.inject('/moodle/actions')).json());
    const byId = Object.fromEntries(catalog.items.map((item) => [item.id, item]));
    expect(byId['assign.submit']?.available).toBe(false);
    expect(byId['assign.save_draft']?.available).toBe(false);
    expect(byId['completion.set']?.available).toBe(true);

    requests.length = 0;
    for (const action of ['assign.submit', 'assign.save_draft']) {
      const params = action === 'assign.submit' ? submitFor(12) : draftParams(12);
      for (const path of ['preview', 'execute']) {
        const res = await a.inject({
          method: 'POST',
          url: `/moodle/actions/${action}/${path}`,
          payload: { params },
        });
        expect(res.statusCode, `${action} ${path}`).toBe(501);
        expect(res.json().error.code).toBe('moodle_action_not_implemented');
      }
    }
    // 501 kommt vor jedem Aufruf an Moodle
    expect(requests).toHaveLength(0);

    // completion.set und notifications.mark_read hängen nicht am Schalter
    const done = await a.inject({
      method: 'POST',
      url: '/moodle/actions/completion.set/execute',
      payload: { params: { cmid: 5, completed: true } },
    });
    expect(done.statusCode).toBe(200);
  });

  it('eine Aktion: nur diese ist an', async () => {
    const { handlers } = frameHandlers();
    const { app: a } = await setup({
      handlers,
      functions: FRAME_FUNCTIONS,
      moodleActions: ['assign.submit'],
    });
    const catalog = MoodleActionCatalogSchema.parse((await a.inject('/moodle/actions')).json());
    const byId = Object.fromEntries(catalog.items.map((item) => [item.id, item]));
    expect(byId['assign.submit']?.available).toBe(true);
    expect(byId['assign.save_draft']?.available).toBe(false);
    expect((await executeOf(a, 'assign.save_draft', draftParams(12))).statusCode).toBe(501);
    const preview = await previewOf(a, 'assign.submit', submitFor(12));
    expect((await executeOf(a, 'assign.submit', submitFor(12), preview.confirmation_token)).statusCode).toBe(
      200,
    );
  });
});

describe('T1-24 Rahmen: Schalter fail closed (Gegen-Review)', () => {
  it('jede Kennung des Katalogs ist entweder geschaltet oder ausdrücklich ungeschaltet, nie beides', () => {
    const gated: readonly string[] = MOODLE_GATED_ACTIONS;
    const ungated: readonly string[] = MOODLE_UNGATED_ACTIONS;
    expect(gated.filter((id) => ungated.includes(id))).toEqual([]);
    expect([...gated, ...ungated].sort()).toEqual(Object.keys(MOODLE_ACTION_SPECS).sort());
  });

  it('enabled nimmt nur geschaltete Kennungen an; Prototyp-Namen finden keinen Handler', () => {
    const writing = {
      async preview() {
        return { summary: 'x' };
      },
      async execute() {
        return { summary: 'x', result: {} };
      },
    };
    const handlers: Record<string, unknown> = {};
    for (const id of Object.keys(MOODLE_ACTION_SPECS)) handlers[id] = writing;
    const registry = new MoodleActionRegistry(handlers as MoodleActionHandlers, [
      'assign.submit',
      'constructor',
      '__proto__',
    ]);
    const on = (Object.keys(MOODLE_ACTION_SPECS) as MoodleActionId[]).filter((id) =>
      registry.isImplemented(id),
    );
    expect(on.sort()).toEqual(['assign.submit', 'completion.set', 'notifications.mark_read']);
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(registry.isImplemented(id as MoodleActionId), id).toBe(false);
    }
    // Handler-Objekt mit Prototyp-Kette: geerbte Einträge zählen nicht
    const inherited = new MoodleActionRegistry(
      Object.create({ 'completion.set': writing }) as MoodleActionHandlers,
    );
    expect(inherited.isImplemented('completion.set')).toBe(false);
  });
});

describe('T1-24 Rahmen: Katalog-Test (§5.1) endgültig und öffentlich nur mit Code', () => {
  it('ohne Code sieht der Fake bei execute keinen Schreibaufruf und kein upload.php', async () => {
    const writes = [...WRITE_WSFUNCTIONS];
    const allFunctions = [
      'core_webservice_get_site_info',
      ...Object.values(MOODLE_ACTION_SPECS).flatMap((spec) => spec.wsfunctions),
    ];
    // Für jede Aktion ein Handler, der beim Ausführen in Moodle schreibt
    const writing = {
      async preview() {
        return { summary: 'x' };
      },
      async execute(ctx: MoodleActionContext) {
        await ctx.client.write('mod_assign_submit_for_grading', { assignmentid: 1 });
        return { summary: 'x', result: {} };
      },
    };
    const handlers: Record<string, unknown> = {};
    for (const id of Object.keys(MOODLE_ACTION_SPECS)) handlers[id] = writing;
    const { app: a, requests } = await setup({
      handlers: handlers as MoodleActionHandlers,
      functions: allFunctions,
      responses: { mod_assign_submit_for_grading: [] },
    });
    const params: Record<string, unknown> = {
      'assign.submit': submitFor(12),
      'forum.create_discussion': { forum_id: 1, subject: 'a', message_html: '<p>b</p>' },
      'forum.reply': { post_id: 1, message_html: '<p>b</p>' },
      'message.send': { to_user_id: 5, text: 'Hallo' },
    };
    const checked: string[] = [];
    for (const [id, spec] of Object.entries(MOODLE_ACTION_SPECS)) {
      if (spec.risk !== 'endgueltig' && spec.risk !== 'oeffentlich') continue;
      checked.push(id);
      requests.length = 0;
      const res = await executeOf(a, id, params[id]);
      expect(res.statusCode, id).toBe(409);
      expect(res.json().error.code, id).toBe('moodle_confirmation_required');
      const sent = requests.filter(
        (r) => writes.includes(r.body.get('wsfunction') ?? '') || r.url.includes('upload.php'),
      );
      expect(sent, id).toEqual([]);
    }
    expect(checked.sort()).toEqual([
      'assign.submit',
      'forum.create_discussion',
      'forum.reply',
      'message.send',
    ]);
  });
});
