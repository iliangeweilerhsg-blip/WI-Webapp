import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  MoodleActionCatalogSchema,
  MoodleActionPreviewSchema,
  MoodleActionResultSchema,
  MoodleStatusSchema,
} from '@sg/shared';
import { DEFAULT_ACTION_HANDLERS, type MoodleActionHandlers } from '../../src/moodle/actions.ts';
import { createMoodleServices } from '../../src/moodle/index.ts';
import { StaticTokenStore } from '../../src/moodle/token-store.ts';
import { registerErrorHandler } from '../../src/plugins/errors.ts';
import { moodleRoutes } from '../../src/routes/moodle.ts';
import { FAKE_BASE, FAKE_TOKEN, fakeFetch, restHandler, siteInfo } from './moodle-fake.ts';

const ALL_FUNCTIONS = [
  'core_webservice_get_site_info',
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
    config: { moodleUrl: options.baseUrl ?? FAKE_BASE, dataDir: '/gibt/es/nicht' },
    tokens: new StaticTokenStore(options.token === undefined ? FAKE_TOKEN : options.token),
    fetch: fake.fetch,
    handlers: options.handlers ?? { ...DEFAULT_ACTION_HANDLERS, 'assign.submit': submitHandler },
    readMeta: async () => ({ token_valid_until: '2027-01-27' }),
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
