// T1-22: Moodle-Lese-Endpunkte und Datei-Stream gegen ein nachgebautes Moodle (echter HTTP-Server).
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AddressInfo } from 'node:net';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  MoodleAssignmentListSchema,
  MoodleCourseContentsSchema,
  MoodleCourseListSchema,
  MoodleDeadlineListSchema,
  MoodleDiscussionListSchema,
  MoodleForumListSchema,
  MoodleGradeListSchema,
  MoodleNotificationListSchema,
  MoodlePostListSchema,
  MoodleQuizListSchema,
  MoodleStatusSchema,
  MoodleSubmissionStatusSchema,
} from '@sg/shared';
import { loggerOptions } from '../../src/logger.ts';
import { decodeExtValue, parseContentDisposition } from '../../src/moodle/content-disposition.ts';
import { createMoodleServices, type MoodleClientTuning } from '../../src/moodle/index.ts';
import { StaticTokenStore } from '../../src/moodle/token-store.ts';
import { registerErrorHandler } from '../../src/plugins/errors.ts';
import { moodleRoutes } from '../../src/routes/moodle.ts';
import { FAKE_TOKEN } from './moodle-fake.ts';
import { FakeMoodleServer, fileReply, HANDLED, sendJson, unix } from './moodle-server.ts';

const TOKEN = FAKE_TOKEN;
const NOW = new Date('2026-11-05T12:00:00Z');

// ---------- Testdaten: Antworten wie von Moodle 4.5 ----------

const REF = {
  slides: '/3789/mod_resource/content/7/01-Einf%C3%BChrung.pdf',
  html: '/3790/mod_folder/content/1/evil.html',
  svg: '/3790/mod_folder/content/1/grafik.svg',
  text: '/3790/mod_folder/content/1/notizen.txt',
  inject: '/3790/mod_folder/content/1/inject.pdf',
  nfkc: '/3790/mod_folder/content/1/nfkc.pdf',
  plain: '/3790/mod_folder/content/1/ohne-name.pdf',
  big: '/3790/mod_folder/content/1/gross.pdf',
  endless: '/3790/mod_folder/content/1/endlos.pdf',
  slow: '/3790/mod_folder/content/1/langsam.pdf',
  intro: '/3801/mod_assign/intro/blatt1.pdf',
  submission: '/3801/assignsubmission_file/submission_files/9/loesung.pdf',
  attachment: '/3802/mod_forum/attachment/9001/termine.pdf',
  /** Liegt im Moodle, wurde aber nie über einen Lese-Endpunkt ausgegeben */
  unlisted: '/3999/mod_resource/content/1/geheim.pdf',
  /** Nur von einem fremden Host angeboten */
  foreign: '/3790/mod_folder/content/1/fremd.pdf',
};

function fixtures(base: string): Record<string, unknown> {
  // Moodle hängt den Token an Download-Adressen. Er darf nie in einer Antwort des Core landen
  const pf = (ref: string) => `${base}/webservice/pluginfile.php${ref}?forcedownload=1&token=${TOKEN}`;
  const file = (ref: string, filename: string, mimetype: string, filesize = 1000) => ({
    type: 'file',
    filename,
    filepath: '/',
    filesize,
    fileurl: pf(ref),
    timemodified: unix('2026-10-20T10:00:00Z'),
    mimetype,
  });
  return {
    core_webservice_get_site_info: {
      sitename: 'Moodle Test',
      fullname: 'Erika Muster',
      userid: 4711,
      functions: [],
    },
    core_enrol_get_users_courses: [
      {
        id: 101,
        shortname: 'WI1',
        fullname: 'Wirtschaftsinformatik 1',
        // Mitternacht Berliner Zeit = 22:00 UTC am Vortag
        startdate: unix('2026-10-11T22:00:00Z'),
        enddate: unix('2027-03-31T22:00:00Z'),
        lastaccess: unix('2026-11-04T08:15:00Z'),
        showgrades: true,
      },
      {
        id: 102,
        shortname: 'MA',
        fullname: 'Mathematik',
        startdate: 0,
        enddate: 0,
        lastaccess: null,
        showgrades: false,
      },
      { id: 'kaputt', shortname: 'X' },
    ],
    core_course_get_contents: (params: URLSearchParams) =>
      params.get('courseid') !== '101'
        ? []
        : [
            { id: 1, name: 'Allgemeines', visible: 1, section: 0, uservisible: true, modules: [] },
            {
              id: 2,
              name: 'Woche 1',
              visible: 1,
              section: 1,
              modules: [
                {
                  id: 501,
                  url: `${base}/mod/resource/view.php?id=501`,
                  name: 'Folien Woche 1',
                  instance: 77,
                  modname: 'resource',
                  visible: 1,
                  uservisible: true,
                  description: `<p>Siehe <a href="${pf(REF.slides)}">Folien</a></p>`,
                  completion: 1,
                  completiondata: { state: 1, isautomatic: false },
                  contents: [file(REF.slides, '01-Einführung.pdf', 'application/pdf', 15)],
                },
                {
                  id: 502,
                  url: `${base}/mod/folder/view.php?id=502`,
                  name: 'Material',
                  instance: 78,
                  modname: 'folder',
                  visible: 1,
                  completion: 2,
                  completiondata: { state: 0, isautomatic: true },
                  contents: [
                    file(REF.html, 'evil.html', 'text/html'),
                    file(REF.svg, 'grafik.svg', 'image/svg+xml'),
                    file(REF.text, 'notizen.txt', 'text/plain'),
                    file(REF.inject, 'inject.pdf', 'application/pdf'),
                    file(REF.nfkc, 'nfkc.pdf', 'application/pdf'),
                    file(REF.plain, 'ohne-name.pdf', 'application/pdf'),
                    file(REF.big, 'gross.pdf', 'application/pdf'),
                    file(REF.endless, 'endlos.pdf', 'application/pdf'),
                    file(REF.slow, 'langsam.pdf', 'application/pdf'),
                    {
                      ...file(REF.foreign, 'fremd.pdf', 'application/pdf'),
                      fileurl: `https://evil.example/webservice/pluginfile.php${REF.foreign}`,
                    },
                    { type: 'url', filename: 'Link', fileurl: 'https://example.org/' },
                  ],
                },
                {
                  id: 503,
                  url: 'javascript:alert(1)',
                  name: 'Link',
                  modname: 'url',
                  visible: 0,
                  completion: 0,
                },
                { name: 'ohne ID', modname: 'label' },
              ],
            },
          ],
    mod_assign_get_assignments: {
      courses: [
        {
          id: 101,
          assignments: [
            {
              id: 701,
              cmid: 601,
              course: 101,
              name: 'Übungsblatt 1',
              duedate: unix('2026-11-12T22:59:00Z'),
              cutoffdate: 0,
              allowsubmissionsfromdate: unix('2026-11-01T00:00:00Z'),
              intro: '<p>Bitte als PDF.</p>',
              introfiles: [{ ...file(REF.intro, 'blatt1.pdf', 'application/pdf'), type: undefined }],
              introattachments: [],
              configs: [
                { plugin: 'file', subtype: 'assignsubmission', name: 'enabled', value: '1' },
                { plugin: 'onlinetext', subtype: 'assignsubmission', name: 'enabled', value: '0' },
                { plugin: 'comments', subtype: 'assignsubmission', name: 'enabled', value: '1' },
              ],
              requiresubmissionstatement: 1,
              submissiondrafts: 1,
            },
          ],
        },
      ],
      warnings: [],
    },
    mod_assign_get_submission_status: {
      lastattempt: {
        submission: {
          id: 1,
          status: 'draft',
          timemodified: unix('2026-11-04T18:00:00Z'),
          plugins: [
            {
              type: 'file',
              fileareas: [
                { area: 'submission_files', files: [file(REF.submission, 'loesung.pdf', 'application/pdf')] },
              ],
            },
            { type: 'onlinetext', editorfields: [{ name: 'onlinetext', text: '<p>Text</p>', format: 1 }] },
          ],
        },
        graded: false,
        canedit: true,
        cansubmit: true,
      },
      feedback: {
        gradefordisplay: '8,00 / 10,00',
        plugins: [{ type: 'comments', editorfields: [{ name: 'comments', text: '<p>Gut gemacht</p>' }] }],
      },
      warnings: [],
    },
    mod_forum_get_forums_by_courses: [
      { id: 801, course: 101, type: 'news', name: 'Ankündigungen', cmid: 602, cancreatediscussions: false },
      { id: 802, course: 101, type: 'general', name: 'Fragen', cmid: 603, cancreatediscussions: true },
    ],
    mod_forum_get_forum_discussions: {
      discussions: [
        {
          id: 9001,
          discussion: 901,
          name: 'Klausur',
          subject: 'Klausurtermin',
          userfullname: 'Prof. X',
          created: unix('2026-11-01T09:00:00Z'),
          timemodified: unix('2026-11-02T09:00:00Z'),
          numreplies: 3,
          pinned: true,
        },
      ],
      warnings: [],
    },
    mod_forum_get_discussion_posts: {
      posts: [
        {
          id: 9001,
          subject: 'Klausurtermin',
          message: '<p>Am 10.02.</p>',
          author: { id: 5, fullname: 'Prof. X' },
          discussionid: 901,
          hasparent: false,
          parentid: null,
          timecreated: unix('2026-11-01T09:00:00Z'),
          capabilities: { reply: true },
          attachments: [
            {
              filename: 'termine.pdf',
              filesize: 300,
              url: `${base}/pluginfile.php${REF.attachment}`,
              mimetype: 'application/pdf',
              timemodified: unix('2026-11-01T09:00:00Z'),
              isdir: false,
            },
          ],
        },
        {
          id: 9002,
          subject: 'Re: Klausurtermin',
          message: '<p>Danke</p>',
          author: { id: 6, fullname: 'Erika Muster' },
          discussionid: 901,
          hasparent: true,
          parentid: 9001,
          timecreated: unix('2026-11-01T10:00:00Z'),
          capabilities: { reply: false },
          attachments: [],
        },
      ],
      warnings: [],
    },
    core_calendar_get_action_events_by_timesort: {
      events: [
        {
          id: 3001,
          name: 'Übungsblatt 1 ist fällig',
          courseid: 101,
          modulename: 'assign',
          timestart: unix('2026-11-12T22:59:00Z'),
          timesort: unix('2026-11-12T22:59:00Z'),
          url: `${base}/mod/assign/view.php?id=601`,
          action: {
            name: 'Abgabe hinzufügen',
            url: `${base}/mod/assign/view.php?id=601&action=editsubmission`,
            actionable: true,
          },
        },
        {
          id: 3002,
          name: 'Selbsttest schließt',
          course: { id: 101 },
          modulename: 'quiz',
          timesort: unix('2026-11-20T12:00:00Z'),
          url: 'javascript:alert(1)',
        },
        { id: 3003, name: 'ohne Zeit' },
      ],
      firstid: 3001,
      lastid: 3002,
    },
    gradereport_user_get_grade_items: (params: URLSearchParams) => ({
      usergrades: [
        {
          courseid: Number(params.get('courseid')),
          userid: 4711,
          gradeitems: [
            {
              id: 1,
              itemname: 'Übungsblatt 1',
              itemtype: 'mod',
              itemmodule: 'assign',
              cmid: 601,
              gradeformatted: '8,00',
              rangeformatted: '0,00–10,00',
              percentageformatted: '80,00 %',
              feedback: '<p>Gut</p>',
            },
            { id: 2, itemname: null, itemtype: 'course', gradeformatted: '-', feedback: '' },
          ],
        },
      ],
      warnings: [],
    }),
    mod_quiz_get_quizzes_by_courses: {
      quizzes: [
        {
          id: 1001,
          course: 101,
          coursemodule: 604,
          name: 'Selbsttest',
          timeopen: unix('2026-11-01T00:00:00Z'),
          timeclose: 0,
          timelimit: 1800,
          attempts: 0,
        },
      ],
      warnings: [],
    },
    message_popup_get_popup_notifications: {
      notifications: [
        {
          id: 1,
          subject: 'Neue Bewertung',
          smallmessage: 'Übungsblatt 1 wurde bewertet',
          fullmessage: 'Lang',
          contexturl: `${base}/mod/assign/view.php?id=601&token=${TOKEN}`,
          timecreated: unix('2026-11-04T09:00:00Z'),
          read: false,
          timeread: null,
        },
        {
          id: 2,
          subject: 'Forum',
          smallmessage: '',
          fullmessage: 'Neuer Beitrag',
          contexturl: null,
          timecreated: unix('2026-11-03T09:00:00Z'),
          read: true,
        },
      ],
      unreadcount: 1,
    },
  };
}

// ---------- Aufbau ----------

let app: FastifyInstance | undefined;
let moodle: FakeMoodleServer | undefined;
afterEach(async () => {
  await app?.close();
  await moodle?.stop();
  app = undefined;
  moodle = undefined;
});

interface Setup {
  moodle: FakeMoodleServer;
  url: string;
  logs: string[];
  bodies: string[];
  get: (path: string, init?: RequestInit) => Promise<Response>;
  json: (path: string) => Promise<{ status: number; body: unknown }>;
}

async function setup(
  options: { token?: string | null; tuning?: MoodleClientTuning; validUntil?: string } = {},
): Promise<Setup> {
  moodle = await new FakeMoodleServer(TOKEN).start();
  moodle.rest = fixtures(moodle.baseUrl);
  // Echte Log-Konfiguration des Core, Stufe trace: Alles, was je geloggt würde, landet hier
  const logs: string[] = [];
  const logger = pino(loggerOptions({ logLevel: 'trace' }), {
    write: (line: string) => void logs.push(line),
  });
  const services = createMoodleServices({
    config: { moodleUrl: moodle.baseUrl, dataDir: '/gibt/es/nicht' },
    tokens: new StaticTokenStore(options.token === undefined ? TOKEN : options.token),
    logger: logger.child({ module: 'moodle' }),
    readMeta: async () => ({ token_valid_until: options.validUntil ?? '2027-03-31' }),
    now: () => NOW,
    timeZone: 'Europe/Berlin',
    client: { minIntervalMs: 0, retryDelaysMs: [0, 0], timeoutMs: 2000, ...options.tuning },
  });
  // forceCloseConnections: fetch öffnet nach einem Abbruch vorsorglich eine Verbindung ohne Anfrage.
  // Node zählt sie als aktiv, app.close() würde sonst bis zum Keep-Alive-Ende des Clients warten
  const server: FastifyInstance = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    forceCloseConnections: true,
  });
  app = server;
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(server);
  await server.register(moodleRoutes, { moodle: services });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
  const bodies: string[] = [];
  const get = (path: string, init?: RequestInit) => fetch(`${url}${path}`, init);
  const json = async (path: string) => {
    const response = await get(path);
    const text = await response.text();
    bodies.push(text, JSON.stringify([...response.headers]));
    return { status: response.status, body: JSON.parse(text) as unknown };
  };
  return { moodle, url, logs, bodies, get, json };
}

const fileUrl = (ref: string) => `/moodle/file?ref=${encodeURIComponent(ref)}`;

async function errorOf(s: Setup, path: string) {
  const { status, body } = await s.json(path);
  const parsed = ApiErrorSchema.parse(body);
  return { status, ...parsed.error };
}

// ---------- Lese-Endpunkte ----------

describe('Lese-Endpunkte (F-MDL-02): Erfolg, Antwort nach Schema', () => {
  it('GET /moodle/courses: Kurse des Nutzers, Daten in Ortszeit, kaputte Einträge ausgelassen', async () => {
    const s = await setup();
    const { status, body } = await s.json('/moodle/courses');
    expect(status).toBe(200);
    const list = MoodleCourseListSchema.parse(body);
    expect(list.items).toEqual([
      {
        moodle_id: 101,
        short_name: 'WI1',
        full_name: 'Wirtschaftsinformatik 1',
        start_date: '2026-10-12',
        end_date: '2027-04-01',
        url: `${s.moodle.baseUrl}/course/view.php?id=101`,
        last_access_at: '2026-11-04T08:15:00.000Z',
        module_id: null,
      },
      {
        moodle_id: 102,
        short_name: 'MA',
        full_name: 'Mathematik',
        start_date: null,
        end_date: null,
        url: `${s.moodle.baseUrl}/course/view.php?id=102`,
        last_access_at: null,
        module_id: null,
      },
    ]);
    expect(s.moodle.calls('core_enrol_get_users_courses')[0]?.params.get('userid')).toBe('4711');
  });

  it('GET /moodle/courses/{id}/contents: Abschnitte, Aktivitäten, Dateien; fremde Hosts und Token fallen weg', async () => {
    const s = await setup();
    const { status, body } = await s.json('/moodle/courses/101/contents');
    expect(status).toBe(200);
    const contents = MoodleCourseContentsSchema.parse(body);
    expect(contents.course_id).toBe(101);
    expect(contents.sections.map((section) => [section.index, section.name])).toEqual([
      [0, 'Allgemeines'],
      [1, 'Woche 1'],
    ]);
    const [resource, folder, link, ...rest] = contents.sections[1]?.activities ?? [];
    expect(rest).toEqual([]);
    expect(resource).toMatchObject({
      cmid: 501,
      type: 'resource',
      visible: true,
      completion: 'erledigt',
      completion_manual: true,
      instance_id: 77,
      files: [
        {
          ref: REF.slides,
          filename: '01-Einführung.pdf',
          mime_type: 'application/pdf',
          size_bytes: 15,
          modified_at: '2026-10-20T10:00:00.000Z',
        },
      ],
    });
    // Token aus der Beschreibung entfernt
    expect(resource?.description_html).toContain('token=[Redacted]');
    expect(folder).toMatchObject({ cmid: 502, completion: 'offen', completion_manual: false });
    const refs = folder?.files.map((file) => file.ref) ?? [];
    expect(refs).toContain(REF.html);
    // Datei von fremdem Host und Link-Inhalt sind keine Moodle-Dateien
    expect(refs).not.toContain(REF.foreign);
    expect(refs).toHaveLength(9);
    expect(link).toMatchObject({ cmid: 503, url: null, visible: false, completion: null, files: [] });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(JSON.stringify(body)).not.toContain('evil.example');
  });

  it('GET /moodle/assignments: alle Kurse oder ein Kurs, Abgabearten und Erklärung', async () => {
    const s = await setup();
    const all = await s.json('/moodle/assignments');
    const list = MoodleAssignmentListSchema.parse(all.body);
    expect(list.items).toEqual([
      {
        moodle_id: 701,
        cmid: 601,
        course_id: 101,
        name: 'Übungsblatt 1',
        due_at: '2026-11-12T22:59:00.000Z',
        cutoff_at: null,
        opens_at: '2026-11-01T00:00:00.000Z',
        intro_html: '<p>Bitte als PDF.</p>',
        intro_files: [expect.objectContaining({ ref: REF.intro, filename: 'blatt1.pdf' })],
        submission_types: ['file'],
        requires_statement: true,
        requires_submit: true,
      },
    ]);
    expect(s.moodle.calls('mod_assign_get_assignments')[0]?.params.has('courseids[0]')).toBe(false);
    await s.json('/moodle/assignments?course_id=101');
    expect(s.moodle.calls('mod_assign_get_assignments')[1]?.params.get('courseids[0]')).toBe('101');
  });

  it('GET /moodle/assignments/{id}/submission: Entwurf mit Dateien, Text, Bewertung', async () => {
    const s = await setup();
    const { status, body } = await s.json('/moodle/assignments/701/submission');
    expect(status).toBe(200);
    expect(MoodleSubmissionStatusSchema.parse(body)).toEqual({
      assignment_id: 701,
      state: 'entwurf',
      graded: false,
      grade: '8,00 / 10,00',
      feedback_html: '<p>Gut gemacht</p>',
      last_modified_at: '2026-11-04T18:00:00.000Z',
      can_edit: true,
      can_submit: true,
      files: [expect.objectContaining({ ref: REF.submission, filename: 'loesung.pdf' })],
      online_text_html: '<p>Text</p>',
    });
    expect(s.moodle.calls('mod_assign_get_submission_status')[0]?.params.get('assignid')).toBe('701');
  });

  it('Foren, Diskussionen und Beiträge (mit Anhang unter /pluginfile.php)', async () => {
    const s = await setup();
    const forums = MoodleForumListSchema.parse((await s.json('/moodle/forums?course_id=101')).body);
    expect(forums.items.map((forum) => [forum.moodle_id, forum.type, forum.can_post])).toEqual([
      [801, 'news', false],
      [802, 'general', true],
    ]);
    const discussions = MoodleDiscussionListSchema.parse(
      (await s.json('/moodle/forums/802/discussions')).body,
    );
    expect(discussions.items).toEqual([
      {
        moodle_id: 901,
        forum_id: 802,
        first_post_id: 9001,
        subject: 'Klausurtermin',
        author_name: 'Prof. X',
        created_at: '2026-11-01T09:00:00.000Z',
        modified_at: '2026-11-02T09:00:00.000Z',
        reply_count: 3,
        pinned: true,
      },
    ]);
    const posts = MoodlePostListSchema.parse((await s.json('/moodle/discussions/901/posts')).body);
    expect(posts.items.map((post) => [post.moodle_id, post.parent_id, post.can_reply])).toEqual([
      [9001, null, true],
      [9002, 9001, false],
    ]);
    expect(posts.items[0]?.attachments).toEqual([
      {
        ref: REF.attachment,
        filename: 'termine.pdf',
        mime_type: 'application/pdf',
        size_bytes: 300,
        modified_at: '2026-11-01T09:00:00.000Z',
      },
    ]);
  });

  it('GET /moodle/deadlines: from und limit gehen an Moodle, cmid aus der Adresse, unsichere Adressen fallen weg', async () => {
    const s = await setup();
    const { body } = await s.json('/moodle/deadlines?from=2026-11-05T00:00:00Z&limit=5');
    const list = MoodleDeadlineListSchema.parse(body);
    expect(list.items).toEqual([
      {
        event_id: 3001,
        course_id: 101,
        cmid: 601,
        activity_type: 'assign',
        name: 'Übungsblatt 1 ist fällig',
        due_at: '2026-11-12T22:59:00.000Z',
        url: `${s.moodle.baseUrl}/mod/assign/view.php?id=601`,
        action_required: true,
      },
      {
        event_id: 3002,
        course_id: 101,
        cmid: null,
        activity_type: 'quiz',
        name: 'Selbsttest schließt',
        due_at: '2026-11-20T12:00:00.000Z',
        url: null,
        action_required: false,
      },
    ]);
    const call = s.moodle.calls('core_calendar_get_action_events_by_timesort')[0];
    expect(call?.params.get('timesortfrom')).toBe(String(unix('2026-11-05T00:00:00Z')));
    expect(call?.params.get('limitnum')).toBe('5');
    // Standard: ab jetzt, 20 Einträge
    await s.json('/moodle/deadlines');
    expect(s.moodle.calls('core_calendar_get_action_events_by_timesort')[1]?.params.get('limitnum')).toBe(
      '20',
    );
  });

  it('GET /moodle/grades: ein Kurs oder alle Kurse mit sichtbaren Noten', async () => {
    const s = await setup();
    const one = MoodleGradeListSchema.parse((await s.json('/moodle/grades?course_id=101')).body);
    expect(one.items).toEqual([
      {
        course_id: 101,
        name: 'Übungsblatt 1',
        item_type: 'mod',
        cmid: 601,
        grade: '8,00',
        range: '0,00–10,00',
        percentage: '80,00 %',
        feedback_html: '<p>Gut</p>',
      },
      {
        course_id: 101,
        name: '',
        item_type: 'course',
        cmid: null,
        grade: '-',
        range: null,
        percentage: null,
        feedback_html: null,
      },
    ]);
    expect(s.moodle.calls('gradereport_user_get_grade_items')[0]?.params.get('userid')).toBe('4711');
    // Ohne course_id: jeder Kurs einzeln, Kurs 102 blendet Noten aus
    const all = MoodleGradeListSchema.parse((await s.json('/moodle/grades')).body);
    expect(all.items).toHaveLength(2);
    const courseIds = s.moodle.calls('gradereport_user_get_grade_items').map((c) => c.params.get('courseid'));
    expect(courseIds).toEqual(['101', '101']);
  });

  it('GET /moodle/quizzes und /moodle/notifications', async () => {
    const s = await setup();
    const quizzes = MoodleQuizListSchema.parse((await s.json('/moodle/quizzes')).body);
    expect(quizzes.items).toEqual([
      {
        moodle_id: 1001,
        cmid: 604,
        course_id: 101,
        name: 'Selbsttest',
        opens_at: '2026-11-01T00:00:00.000Z',
        closes_at: null,
        attempts_allowed: 0,
        time_limit_minutes: 30,
        url: `${s.moodle.baseUrl}/mod/quiz/view.php?id=604`,
      },
    ]);
    const notes = MoodleNotificationListSchema.parse((await s.json('/moodle/notifications?limit=10')).body);
    expect(notes).toEqual({
      items: [
        {
          moodle_id: 1,
          subject: 'Neue Bewertung',
          text: 'Übungsblatt 1 wurde bewertet',
          created_at: '2026-11-04T09:00:00.000Z',
          read: false,
          url: `${s.moodle.baseUrl}/mod/assign/view.php?id=601`,
        },
        {
          moodle_id: 2,
          subject: 'Forum',
          text: 'Neuer Beitrag',
          created_at: '2026-11-03T09:00:00.000Z',
          read: true,
          url: null,
        },
      ],
      unread_count: 1,
    });
    const call = s.moodle.calls('message_popup_get_popup_notifications')[0];
    expect([call?.params.get('useridto'), call?.params.get('limit')]).toEqual(['4711', '10']);
  });

  it('ungültige Parameter → 400 validation_failed, ohne Anfrage an Moodle', async () => {
    const s = await setup();
    for (const path of [
      '/moodle/courses/0/contents',
      '/moodle/courses/abc/contents',
      '/moodle/assignments?course_id=-1',
      '/moodle/assignments/1.5/submission',
      '/moodle/deadlines?from=gestern',
      '/moodle/deadlines?limit=51',
      '/moodle/notifications?limit=0',
      '/moodle/file',
    ]) {
      const error = await errorOf(s, path);
      expect([path, error.status, error.code]).toEqual([path, 400, 'validation_failed']);
    }
    expect(s.moodle.requests).toHaveLength(0);
  });

  it('ohne Token → 503 moodle_not_configured an allen Lese-Endpunkten, ohne Anfrage', async () => {
    const s = await setup({ token: null });
    for (const path of [
      '/moodle/courses',
      '/moodle/courses/101/contents',
      '/moodle/assignments',
      '/moodle/assignments/701/submission',
      '/moodle/forums',
      '/moodle/forums/802/discussions',
      '/moodle/discussions/901/posts',
      '/moodle/deadlines',
      '/moodle/grades',
      '/moodle/quizzes',
      '/moodle/notifications',
      fileUrl(REF.slides),
    ]) {
      const error = await errorOf(s, path);
      expect([path, error.status, error.code]).toEqual([path, 503, 'moodle_not_configured']);
    }
    expect(s.moodle.requests).toHaveLength(0);
  });
});

describe('Fehler von Moodle (Fake-Moodle)', () => {
  it('Moodle-Ausnahme → 502 moodle_error, fehlende Freigabe → 501', async () => {
    const s = await setup();
    s.moodle.rest.core_course_get_contents = {
      exception: 'moodle_exception',
      errorcode: 'invalidcourseid',
      message: 'Kurs nicht gefunden',
    };
    const error = await errorOf(s, '/moodle/courses/999/contents');
    expect([error.status, error.code]).toEqual([502, 'moodle_error']);
    expect(error.details).toMatchObject({
      moodle_errorcode: 'invalidcourseid',
      moodle_message: 'Kurs nicht gefunden',
    });

    s.moodle.rest.mod_quiz_get_quizzes_by_courses = {
      exception: 'webservice_access_exception',
      errorcode: 'accessexception',
      message: 'Zugriffskontrollausnahme',
    };
    const denied = await errorOf(s, '/moodle/quizzes');
    expect([denied.status, denied.code]).toEqual([501, 'moodle_function_unavailable']);
    delete s.moodle.rest.mod_forum_get_forums_by_courses;
    const unknown = await errorOf(s, '/moodle/forums');
    expect([unknown.status, unknown.code]).toEqual([501, 'moodle_function_unavailable']);
  });

  it('kaputtes JSON → 502 moodle_unreachable (no_json)', async () => {
    const s = await setup();
    s.moodle.rest.core_enrol_get_users_courses = (
      _params: URLSearchParams,
      res: import('node:http').ServerResponse,
    ) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"id": 101, "fullname": "abgeschnit');
      return HANDLED;
    };
    const error = await errorOf(s, '/moodle/courses');
    expect([error.status, error.code, error.details?.reason]).toEqual([502, 'moodle_unreachable', 'no_json']);
  });

  it('Zeitüberschreitung → 502 moodle_unreachable (timeout), lesend 2-mal wiederholt', async () => {
    const s = await setup({ tuning: { timeoutMs: 150 } });
    s.moodle.rest.mod_assign_get_assignments = async (
      _params: URLSearchParams,
      res: import('node:http').ServerResponse,
    ) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (!res.destroyed) sendJson(res, { courses: [] });
      return HANDLED;
    };
    const error = await errorOf(s, '/moodle/assignments');
    expect([error.status, error.code, error.details?.reason]).toEqual([502, 'moodle_unreachable', 'timeout']);
    expect(s.moodle.calls('mod_assign_get_assignments')).toHaveLength(3);
  });

  it('zu große Antwort → 502 moodle_unreachable (too_large), mit und ohne Content-Length', async () => {
    const s = await setup({ tuning: { maxResponseBytes: 10_000 } });
    const big = { courses: [{ id: 101, assignments: [], padding: 'x'.repeat(20_000) }] };
    s.moodle.rest.mod_assign_get_assignments = big;
    const declared = await errorOf(s, '/moodle/assignments');
    expect([declared.status, declared.code, declared.details?.reason]).toEqual([
      502,
      'moodle_unreachable',
      'too_large',
    ]);

    // Ohne Content-Length (chunked): Abbruch beim Lesen, nicht erst nach der ganzen Antwort
    let written = 0;
    s.moodle.rest.mod_forum_get_forums_by_courses = async (
      _params: URLSearchParams,
      res: import('node:http').ServerResponse,
    ) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('[');
      while (!res.destroyed && written < 500) {
        res.write(`{"id":${written + 1},"name":"${'y'.repeat(1000)}"},`);
        written += 1;
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      if (!res.destroyed) res.end('{}]');
      return HANDLED;
    };
    const chunked = await errorOf(s, '/moodle/forums');
    expect([chunked.status, chunked.code, chunked.details?.reason]).toEqual([
      502,
      'moodle_unreachable',
      'too_large',
    ]);
    // Nicht wiederholt (keine 3 Versuche) und die Übertragung wurde abgebrochen
    expect(s.moodle.calls('mod_forum_get_forums_by_courses')).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(written).toBeLessThan(500);
  });

  it('Token abgelaufen: 409 moodle_token_invalid, danach Status „abgelaufen“', async () => {
    const s = await setup({ validUntil: '2026-11-01' });
    const before = MoodleStatusSchema.parse((await s.json('/moodle/status')).body);
    expect(before.state).toBe('laeuft_bald_ab');
    expect((await s.json('/moodle/courses')).status).toBe(200);

    s.moodle.tokenValid = false;
    const error = await errorOf(s, '/moodle/courses/101/contents');
    expect([error.status, error.code]).toEqual([409, 'moodle_token_invalid']);
    const after = MoodleStatusSchema.parse((await s.json('/moodle/status')).body);
    expect(after.state).toBe('abgelaufen');
    // Endpunkte mit Nutzer-ID melden den abgelehnten Token ebenfalls als 409, nicht als 502
    const courses = await errorOf(s, '/moodle/courses');
    expect([courses.status, courses.code]).toEqual([409, 'moodle_token_invalid']);
    const file = await errorOf(s, fileUrl(REF.slides));
    expect([file.status, file.code]).toEqual([404, 'moodle_file_not_found']);
  });
});

// ---------- Datei-Stream ----------

async function readAll(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

/** Kursinhalt laden: Erst danach sind die Dateiverweise bekannt */
async function withContents(options: Parameters<typeof setup>[0] = {}): Promise<Setup> {
  const s = await setup(options);
  expect((await s.json('/moodle/courses/101/contents')).status).toBe(200);
  return s;
}

describe('GET /moodle/file: Stream, Header, nur bekannte Dateien', () => {
  it('liefert eine bekannte Datei mit Sicherheits-Headern und sicherem Content-Disposition', async () => {
    const s = await withContents();
    s.moodle.files.set(
      REF.slides,
      fileReply({
        body: '%PDF-1.7 Inhalt',
        // Moodle schickt den Namen roh in UTF-8 (über fetch als ISO-8859-1 gelesen)
        disposition: `inline; filename="${Buffer.from('01-Einführung.pdf').toString('latin1')}"`,
      }),
    );
    const response = await s.get(fileUrl(REF.slides));
    expect(response.status).toBe(200);
    expect((await readAll(response)).toString()).toBe('%PDF-1.7 Inhalt');
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-length')).toBe('15');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe('sandbox');
    expect(response.headers.get('content-disposition')).toBe(
      `inline; filename="01-Einf_hrung.pdf"; filename*=UTF-8''01-Einf%C3%BChrung.pdf`,
    );
    const call = s.moodle.calls('pluginfile')[0];
    expect(call?.path).toBe(`/webservice/pluginfile.php${REF.slides}`);
    expect(call?.params.get('token')).toBe(TOKEN);
  });

  it('HTML, SVG und Unbekanntes nur als Download (octet-stream, attachment); text/plain inline', async () => {
    const s = await withContents();
    s.moodle.files.set(REF.html, fileReply({ body: '<script>alert(1)</script>', contentType: 'text/html' }));
    s.moodle.files.set(
      REF.svg,
      fileReply({ body: '<svg onload="alert(1)"/>', contentType: 'image/svg+xml' }),
    );
    s.moodle.files.set(REF.text, fileReply({ body: 'Hallo', contentType: 'text/plain; charset=ISO-8859-1' }));
    for (const ref of [REF.html, REF.svg]) {
      const response = await s.get(fileUrl(ref));
      await readAll(response);
      expect(response.headers.get('content-type')).toBe('application/octet-stream');
      expect(response.headers.get('content-disposition')).toMatch(/^attachment; /);
      expect(response.headers.get('content-security-policy')).toBe('sandbox');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }
    const text = await s.get(fileUrl(REF.text));
    await readAll(text);
    expect(text.headers.get('content-type')).toBe('text/plain; charset=ISO-8859-1');
    expect(text.headers.get('content-disposition')).toBe(
      `inline; filename="notizen.txt"; filename*=UTF-8''notizen.txt`,
    );
  });

  it('Header-Kodierung: Moodle-Name wird nie roh eingesetzt (kein zweiter Parameter, kein Header-Bruch)', async () => {
    const s = await withContents();
    // Name aus Moodle: ä€ "; filename=evil.html CRLF X-Injected: 1 ' ( ) * %41.pdf
    const evil =
      'a%C3%A4%E2%82%AC%22%3B%20filename%3Devil.html%0D%0AX-Injected%3A%201%20%27%28%29%2A%2541.pdf';
    s.moodle.files.set(
      REF.inject,
      fileReply({ body: 'x', disposition: `attachment; filename*=UTF-8''${evil}` }),
    );
    const response = await s.get(fileUrl(REF.inject));
    await readAll(response);
    expect(response.headers.get('x-injected')).toBeNull();
    const header = response.headers.get('content-disposition') ?? '';
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    const parsed = parseContentDisposition(header);
    expect(parsed?.type).toBe('inline');
    expect([...(parsed?.params.keys() ?? [])]).toEqual(['filename', 'filename*']);
    // filename* trägt den vollständigen, bereinigten Namen (Steuerzeichen weg, " : * zu _)
    expect(decodeExtValue(parsed?.params.get('filename*') ?? '')).toBe(
      "a\u00e4\u20ac_; filename=evil.htmlX-Injected_ 1 '()_%41.pdf",
    );
    // ASCII-Ersatz ohne Nicht-ASCII, ohne " \ und %
    expect(parsed?.params.get('filename')).toBe("a___; filename=evil.htmlX-Injected_ 1 '()__41.pdf");
    expect(header).toBe(
      `inline; filename="a___; filename=evil.htmlX-Injected_ 1 '()__41.pdf"; ` +
        `filename*=UTF-8''a%C3%A4%E2%82%AC_%3B%20filename%3Devil.htmlX-Injected_%201%20%27%28%29_%2541.pdf`,
    );
  });

  it('keine NFKC-Normalisierung: ．．／ bleibt Vollbreite, wird nie zu ../', async () => {
    const s = await withContents();
    // U+FF0E U+FF0E U+FF0F, zweimal, dann geheim.pdf
    const fullwidth = '%EF%BC%8E%EF%BC%8E%EF%BC%8F'.repeat(2);
    s.moodle.files.set(
      REF.nfkc,
      fileReply({ body: 'x', disposition: `attachment; filename*=UTF-8''${fullwidth}geheim.pdf` }),
    );
    const response = await s.get(fileUrl(REF.nfkc));
    await readAll(response);
    const header = response.headers.get('content-disposition') ?? '';
    const name = decodeExtValue(parseContentDisposition(header)?.params.get('filename*') ?? '');
    expect(name).toBe('\uff0e\uff0e\uff0f\uff0e\uff0e\uff0fgeheim.pdf');
    expect(name).not.toContain('../');
    expect(header).toContain(`filename="______geheim.pdf"`);
  });

  it('ohne Content-Disposition von Moodle: Name aus dem Verweis', async () => {
    const s = await withContents();
    s.moodle.files.set(REF.plain, fileReply({ body: 'x' }));
    const response = await s.get(fileUrl(REF.plain));
    await readAll(response);
    expect(response.headers.get('content-disposition')).toBe(
      `inline; filename="ohne-name.pdf"; filename*=UTF-8''ohne-name.pdf`,
    );
  });

  it('unbekannter Verweis → 404 unknown_ref, ohne Anfrage an Moodle (kein Proxy für beliebige Pfade)', async () => {
    const s = await withContents();
    s.moodle.files.set(REF.unlisted, fileReply({ body: 'geheim' }));
    const error = await errorOf(s, fileUrl(REF.unlisted));
    expect([error.status, error.code, error.details?.reason]).toEqual([
      404,
      'moodle_file_not_found',
      'unknown_ref',
    ]);
    // Nur von fremdem Host angeboten: nie bekannt, nie abgerufen
    const foreign = await errorOf(s, fileUrl(REF.foreign));
    expect([foreign.status, foreign.code]).toEqual([404, 'moodle_file_not_found']);
    expect(s.moodle.calls('pluginfile')).toHaveLength(0);
  });

  it('fremde Hosts, URLs und Pfad-Tricks → 400 moodle_file_ref_invalid, ohne Anfrage', async () => {
    const s = await withContents();
    for (const ref of [
      'https://evil.example/webservice/pluginfile.php/1/mod_resource/content/1/a.pdf',
      '//evil.example/1/mod_resource/content/1/a.pdf',
      '/1/mod_resource/content/../../../../etc/passwd',
      '/1/mod_resource/content/%2e%2e/a.pdf',
      '/1/mod_resource/content/1/a.pdf?token=x',
      '/1/mod_resource/content/1/a%2Fb.pdf',
      '@evil.example/1/mod_resource/content/1/a.pdf',
      `${REF.slides}#x`,
    ]) {
      const error = await errorOf(s, fileUrl(ref));
      expect([ref, error.status, error.code]).toEqual([ref, 400, 'moodle_file_ref_invalid']);
    }
    expect(s.moodle.calls('pluginfile')).toHaveLength(0);
  });

  it('Dateien aus Aufgaben, Abgaben und Forenanhängen sind nach dem Abruf bekannt', async () => {
    const s = await setup();
    for (const ref of [REF.intro, REF.submission, REF.attachment]) {
      s.moodle.files.set(ref, fileReply({ body: 'pdf' }));
      expect((await errorOf(s, fileUrl(ref))).status).toBe(404);
    }
    await s.json('/moodle/assignments');
    await s.json('/moodle/assignments/701/submission');
    await s.json('/moodle/discussions/901/posts');
    for (const ref of [REF.intro, REF.submission, REF.attachment]) {
      const response = await s.get(fileUrl(ref));
      expect([ref, response.status, (await readAll(response)).toString()]).toEqual([ref, 200, 'pdf']);
    }
  });

  it('Moodle-Fehler beim Download: filenotfound → 404, abgelehnter Token → 409', async () => {
    const s = await withContents();
    const missing = await errorOf(s, fileUrl(REF.plain));
    expect([missing.status, missing.code]).toEqual([404, 'moodle_file_not_found']);
    s.moodle.files.set(REF.plain, fileReply({ body: 'x' }));
    s.moodle.tokenValid = false;
    const invalid = await errorOf(s, fileUrl(REF.plain));
    expect([invalid.status, invalid.code]).toEqual([409, 'moodle_token_invalid']);
  });

  it('Größenlimit: Content-Length über dem Limit → 502 too_large, ohne die Datei zu übertragen', async () => {
    const s = await withContents({ tuning: { maxFileBytes: 100_000 } });
    s.moodle.files.set(REF.big, fileReply({ body: Buffer.alloc(200_000, 0x41) }));
    const error = await errorOf(s, fileUrl(REF.big));
    expect([error.status, error.code, error.details?.reason]).toEqual([
      502,
      'moodle_unreachable',
      'too_large',
    ]);
  });

  it('Größenlimit: JSON-Datei ohne Content-Length schon im geprüften Anfang zu groß → 502, Platz wieder frei', async () => {
    const s = await withContents({ tuning: { maxFileBytes: 1000, maxConcurrent: 1 } });
    s.moodle.files.set(
      REF.big,
      fileReply({
        body: JSON.stringify({ daten: 'x'.repeat(5000) }),
        contentType: 'application/json',
        contentLength: false,
      }),
    );
    const error = await errorOf(s, fileUrl(REF.big));
    expect([error.status, error.code, error.details?.reason]).toEqual([
      502,
      'moodle_unreachable',
      'too_large',
    ]);
    // Mit nur einem Platz hinge diese Anfrage, wenn der Fehlerpfad den Platz behalten hätte
    const started = Date.now();
    expect((await s.json('/moodle/quizzes')).status).toBe(200);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('Größenlimit: ohne Content-Length bricht der Stream beim Limit ab, Moodle-Verbindung wird getrennt', async () => {
    const s = await withContents({ tuning: { maxFileBytes: 100_000 } });
    let written = 0;
    let upstreamClosed = false;
    s.moodle.files.set(REF.endless, async (res) => {
      res.on('close', () => (upstreamClosed = true));
      res.writeHead(200, { 'content-type': 'application/pdf' });
      while (!res.destroyed && written < 200) {
        res.write(Buffer.alloc(16 * 1024, 0x41));
        written += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      if (!res.destroyed) res.end();
    });
    const response = await s.get(fileUrl(REF.endless));
    expect(response.status).toBe(200);
    let received = 0;
    const reader = response.body?.getReader();
    let failed = false;
    try {
      for (;;) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        received += chunk.value.byteLength;
      }
    } catch {
      failed = true;
    }
    // Übertragung endet mit Fehler (kein scheinbar vollständiger Download) und nie über dem Limit
    expect(failed).toBe(true);
    expect(received).toBeLessThanOrEqual(100_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(upstreamClosed).toBe(true);
    expect(written).toBeLessThan(200);
  });

  it('Streaming: Der erste Teil kommt an, bevor Moodle den Rest geschickt hat (keine Pufferung)', async () => {
    const s = await withContents();
    const part = 64 * 1024;
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => (openGate = resolve));
    s.moodle.files.set(REF.slow, async (res) => {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': 2 * part });
      res.write(Buffer.alloc(part, 0x41));
      await gate;
      res.end(Buffer.alloc(part, 0x42));
    });
    const response = await s.get(fileUrl(REF.slow));
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    let received = 0;
    const firstPart = (async () => {
      while (received < part) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        received += chunk.value.byteLength;
      }
      return received;
    })();
    const timeout = new Promise<'zu spät'>((resolve) => setTimeout(() => resolve('zu spät'), 2000));
    // Moodle hält den Rest zurück: Mit Pufferung käme hier nichts an
    expect(await Promise.race([firstPart, timeout])).toBe(part);
    openGate();
    for (;;) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) break;
      received += chunk.value.byteLength;
    }
    expect(received).toBe(2 * part);
  });

  it('Abbruch durch die Web-App gibt den Platz in der Drosselung sofort frei', async () => {
    const s = await withContents({ tuning: { maxConcurrent: 1, fileTimeoutMs: 30_000 } });
    let upstreamClosed = false;
    s.moodle.files.set(REF.slow, async (res) => {
      res.on('close', () => (upstreamClosed = true));
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': 1_000_000 });
      res.write(Buffer.alloc(1024, 0x41));
      // Rest kommt nie
    });
    const controller = new AbortController();
    const response = await s.get(fileUrl(REF.slow), { signal: controller.signal });
    await response.body?.getReader().read();
    controller.abort();
    // Mit nur einem Platz ginge diese Anfrage erst nach dem Zeitlimit (30 s) durch
    const started = Date.now();
    expect((await s.json('/moodle/quizzes')).status).toBe(200);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(upstreamClosed).toBe(true);
  });
});

// ---------- Token ----------

describe('Token nie in Logs oder Antworten', () => {
  it('über alle Endpunkte, Fehlerfälle und Downloads (Log-Stufe trace)', async () => {
    const s = await withContents({ tuning: { timeoutMs: 150 } });
    // Moodle bzw. ein Proxy schickt den Token in Fehlermeldungen und Adressen zurück
    s.moodle.rest.mod_forum_get_forum_discussions = {
      exception: 'moodle_exception',
      errorcode: `fehler_${TOKEN}`,
      message: `Ungültiger Parameter wstoken=${TOKEN}`,
    };
    s.moodle.rest.mod_quiz_get_quizzes_by_courses = (
      _params: URLSearchParams,
      res: import('node:http').ServerResponse,
    ) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(`kein JSON ${TOKEN}`);
      return HANDLED;
    };
    s.moodle.rest.gradereport_user_get_grade_items = async (
      _p: URLSearchParams,
      res: import('node:http').ServerResponse,
    ) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!res.destroyed) sendJson(res, {});
      return HANDLED;
    };
    s.moodle.files.set(
      REF.plain,
      fileReply({ body: 'x', disposition: `attachment; filename*=UTF-8''${TOKEN}.pdf` }),
    );
    for (const path of [
      '/moodle/status',
      '/moodle/courses',
      '/moodle/courses/101/contents',
      '/moodle/assignments',
      '/moodle/assignments/701/submission',
      '/moodle/forums',
      '/moodle/forums/802/discussions',
      '/moodle/discussions/901/posts',
      '/moodle/deadlines',
      '/moodle/grades?course_id=101',
      '/moodle/quizzes',
      '/moodle/notifications',
      fileUrl(REF.slides),
      fileUrl(REF.unlisted),
      fileUrl('/1/a/b/../c'),
    ]) {
      await s.json(path).catch(() => undefined);
    }
    const download = await s.get(fileUrl(REF.plain));
    s.bodies.push((await readAll(download)).toString(), JSON.stringify([...download.headers]));
    s.moodle.tokenValid = false;
    await s.json('/moodle/courses/101/contents');

    // Der Test hat wirklich geloggt und Moodle wirklich den Token geschickt
    const log = s.logs.join('\n');
    expect(log).toContain('core_course_get_contents');
    expect(log).toContain('Moodle nicht erreichbar');
    expect(s.moodle.requests.some((request) => request.params.get('wstoken') === TOKEN)).toBe(true);
    expect(log).not.toContain(TOKEN);
    expect(s.bodies.join('\n')).not.toContain(TOKEN);
  });
});
