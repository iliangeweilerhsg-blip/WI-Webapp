// Moodle-Rohantworten → eigene Formate aus packages/schemas (F-MDL-02, 08 §9.2).
// Alles defensiv gelesen: Ein fehlendes oder falsch typisiertes Feld führt nie zu einem 500, Einträge
// ohne Pflicht-ID werden ausgelassen. Adressen von Moodle gehen nie ungeprüft an die Web-App.
import type {
  MoodleActivity,
  MoodleAssignment,
  MoodleCourse,
  MoodleDeadline,
  MoodleDiscussion,
  MoodleFile,
  MoodleForum,
  MoodleGradeItem,
  MoodleNotification,
  MoodlePost,
  MoodleQuiz,
  MoodleSection,
  MoodleSubmissionStatus,
} from '@sg/shared';
import { FALLBACK_FILENAME, sanitizeFilename } from './content-disposition.ts';
import { fileRefFromUrl } from './client.ts';

export interface MapContext {
  /** `SG_MOODLE_URL` ohne Schrägstrich am Ende */
  baseUrl: string;
  /** Zeitzone für Kalenderdaten (Kursbeginn/-ende), z. B. `Europe/Berlin` */
  timeZone: string;
  /** Jede ausgegebene Datei wird gemeldet. Nur gemeldete Dateien liefert `GET /moodle/file` aus */
  onFile?: (file: MoodleFile) => void;
}

type Raw = Record<string, unknown>;

export function rec(value: unknown): Raw | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : null;
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function integer(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d{1,15}$/.test(value)) return Number(value);
  return null;
}

/** Moodle-ID: ganze Zahl ≥ 1, sonst null */
export function moodleId(value: unknown): number | null {
  const number = integer(value);
  return number !== null && number >= 1 ? number : null;
}

function nonNegative(value: unknown): number | null {
  const number = integer(value);
  return number !== null && number >= 0 ? number : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Text oder null, leerer Text gilt als null */
function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

/** Größter Unix-Zeitstempel, den `toISOString()` sicher darstellt (Jahr 9999) */
const MAX_UNIX = 253_402_300_799;

/** Unix-Sekunden → ISO 8601 UTC. 0, negative und unplausible Werte → null (Moodle: 0 = „nicht gesetzt“) */
export function timestamp(value: unknown): string | null {
  const seconds = integer(value);
  if (seconds === null || seconds <= 0 || seconds > MAX_UNIX) return null;
  return new Date(seconds * 1000).toISOString();
}

/** Unix-Sekunden → Kalenderdatum `YYYY-MM-DD` in `timeZone`. Moodle legt Kursdaten auf Mitternacht Ortszeit */
export function calendarDate(value: unknown, timeZone: string): string | null {
  const iso = timestamp(value);
  if (iso === null) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** Query-Parameter, die nie an die Web-App gehen (Moodle hängt den Token an Download-Adressen) */
const SECRET_QUERY = new Set(['token', 'wstoken']);

/**
 * Adresse für die Web-App: nur http(s), ohne Zugangsdaten und ohne `token`/`wstoken` in der Query.
 * Alles andere (z. B. `javascript:`) → null.
 */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value === '' || value.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.username = '';
  url.password = '';
  for (const key of [...url.searchParams.keys()]) {
    if (SECRET_QUERY.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  return url.toString();
}

/** Letztes Segment eines Dateiverweises, dekodiert */
export function nameFromRef(ref: string): string {
  const last = ref.split('/').pop() ?? '';
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    // isValidFileRef lässt das nicht durch; zur Sicherheit roh weiter
  }
  return sanitizeFilename(decoded) ?? FALLBACK_FILENAME;
}

/**
 * Datei aus Moodle (`fileurl` bzw. `url`). Nur Dateien der eigenen Instanz unter `pluginfile.php`.
 * Fremde Hosts, Ordner und alles ohne gültigen Verweis werden ausgelassen.
 */
export function mapFile(raw: unknown, ctx: MapContext): MoodleFile | null {
  const r = rec(raw);
  if (!r || r.isdir === true) return null;
  const address = text(r.fileurl) ?? text(r.url);
  const ref = address ? fileRefFromUrl(ctx.baseUrl, address) : null;
  if (!ref) return null;
  const file: MoodleFile = {
    ref,
    filename: sanitizeFilename(text(r.filename) ?? '') ?? nameFromRef(ref),
    mime_type: nonEmpty(r.mimetype),
    size_bytes: nonNegative(r.filesize) ?? 0,
    modified_at: timestamp(r.timemodified),
  };
  ctx.onFile?.(file);
  return file;
}

function mapFiles(raws: unknown[], ctx: MapContext): MoodleFile[] {
  const seen = new Set<string>();
  const out: MoodleFile[] = [];
  for (const raw of raws) {
    const file = mapFile(raw, ctx);
    if (file && !seen.has(file.ref)) {
      seen.add(file.ref);
      out.push(file);
    }
  }
  return out;
}

function compact<T>(items: (T | null)[]): T[] {
  return items.filter((item): item is T => item !== null);
}

// ---------- Kurse ----------

/**
 * `core_enrol_get_users_courses` → MoodleCourse. `module_id`, `suggested_module_id` und `category` ergänzt die
 * Route aus der Kurszuordnung (T1-23, `annotateCourses`), hier nur die Standardwerte
 */
export function mapCourse(raw: unknown, ctx: MapContext): MoodleCourse | null {
  const r = rec(raw);
  const id = moodleId(r?.id);
  if (!r || id === null) return null;
  return {
    moodle_id: id,
    short_name: text(r.shortname) ?? '',
    full_name: text(r.fullname) ?? text(r.displayname) ?? '',
    start_date: calendarDate(r.startdate, ctx.timeZone),
    end_date: calendarDate(r.enddate, ctx.timeZone),
    url: `${ctx.baseUrl}/course/view.php?id=${id}`,
    last_access_at: timestamp(r.lastaccess),
    module_id: null,
    suggested_module_id: null,
    category: 'aktuell',
  };
}

export function mapCourses(raw: unknown, ctx: MapContext): MoodleCourse[] {
  return compact(list(raw).map((item) => mapCourse(item, ctx)));
}

// ---------- Kursinhalt ----------

/** Moodle-Completion: 0 = keine, 1 = manuell, 2 = automatisch. Zustand 1/2 = erledigt (auch „bestanden“) */
function completionOf(r: Raw): { completion: MoodleActivity['completion']; manual: boolean } {
  const tracking = integer(r.completion) ?? 0;
  if (tracking === 0) return { completion: null, manual: false };
  const state = integer(rec(r.completiondata)?.state);
  return { completion: state === 1 || state === 2 ? 'erledigt' : 'offen', manual: tracking === 1 };
}

export function mapActivity(raw: unknown, ctx: MapContext): MoodleActivity | null {
  const r = rec(raw);
  const cmid = moodleId(r?.id);
  if (!r || cmid === null) return null;
  const { completion, manual } = completionOf(r);
  return {
    cmid,
    type: text(r.modname) ?? '',
    name: text(r.name) ?? '',
    url: safeUrl(r.url),
    visible: integer(r.visible) !== 0 && r.uservisible !== false,
    description_html: nonEmpty(r.description),
    completion,
    completion_manual: manual,
    instance_id: moodleId(r.instance),
    files: mapFiles(
      list(r.contents).filter((item) => rec(item)?.type === 'file'),
      ctx,
    ),
  };
}

export function mapSection(raw: unknown, ctx: MapContext): MoodleSection | null {
  const r = rec(raw);
  const id = moodleId(r?.id);
  if (!r || id === null) return null;
  return {
    moodle_id: id,
    index: nonNegative(r.section) ?? 0,
    name: text(r.name) ?? '',
    visible: integer(r.visible) !== 0 && r.uservisible !== false,
    activities: compact(list(r.modules).map((item) => mapActivity(item, ctx))),
  };
}

export function mapSections(raw: unknown, ctx: MapContext): MoodleSection[] {
  return compact(list(raw).map((item) => mapSection(item, ctx)));
}

// ---------- Aufgaben ----------

const SUBMISSION_TYPES = ['file', 'onlinetext'] as const;

export function mapAssignment(
  raw: unknown,
  courseId: number | null,
  ctx: MapContext,
): MoodleAssignment | null {
  const r = rec(raw);
  const id = moodleId(r?.id);
  const cmid = moodleId(r?.cmid);
  const course = moodleId(r?.course) ?? courseId;
  if (!r || id === null || cmid === null || course === null) return null;
  const configs = list(r.configs).map(rec);
  const enabled = (plugin: string) =>
    configs.some(
      (config) =>
        config?.subtype === 'assignsubmission' &&
        config.plugin === plugin &&
        config.name === 'enabled' &&
        String(config.value) === '1',
    );
  return {
    moodle_id: id,
    cmid,
    course_id: course,
    name: text(r.name) ?? '',
    due_at: timestamp(r.duedate),
    cutoff_at: timestamp(r.cutoffdate),
    opens_at: timestamp(r.allowsubmissionsfromdate),
    intro_html: nonEmpty(r.intro),
    intro_files: mapFiles([...list(r.introfiles), ...list(r.introattachments)], ctx),
    submission_types: SUBMISSION_TYPES.filter(enabled),
    requires_statement: flag(r.requiresubmissionstatement),
    requires_submit: flag(r.submissiondrafts),
  };
}

/** `mod_assign_get_assignments` → `{ courses: [{ id, assignments: [...] }] }` */
export function mapAssignments(raw: unknown, ctx: MapContext): MoodleAssignment[] {
  return list(rec(raw)?.courses).flatMap((course) => {
    const c = rec(course);
    const courseId = moodleId(c?.id);
    return compact(list(c?.assignments).map((item) => mapAssignment(item, courseId, ctx)));
  });
}

function editorText(plugin: Raw | null, field?: string): string | null {
  const fields = list(plugin?.editorfields).map(rec);
  const match = field ? fields.find((entry) => entry?.name === field) : fields[0];
  return nonEmpty(match?.text);
}

/** `mod_assign_get_submission_status` → MoodleSubmissionStatus. Bei Gruppenabgabe zählt die Gruppenabgabe */
export function mapSubmissionStatus(
  raw: unknown,
  assignmentId: number,
  ctx: MapContext,
): MoodleSubmissionStatus {
  const r = rec(raw);
  const last = rec(r?.lastattempt);
  const submission = rec(last?.teamsubmission) ?? rec(last?.submission);
  const status = text(submission?.status);
  const plugins = list(submission?.plugins).map(rec);
  const filePlugin = plugins.find((plugin) => plugin?.type === 'file') ?? null;
  const files = list(filePlugin?.fileareas).flatMap((area) => list(rec(area)?.files));
  const feedback = rec(r?.feedback);
  const comments = list(feedback?.plugins)
    .map(rec)
    .find((plugin) => plugin?.type === 'comments');
  return {
    assignment_id: assignmentId,
    state: status === 'submitted' ? 'eingereicht' : status === 'draft' ? 'entwurf' : 'keine',
    graded: flag(last?.graded),
    grade: nonEmpty(feedback?.gradefordisplay),
    feedback_html: editorText(comments ?? null, 'comments'),
    last_modified_at: timestamp(submission?.timemodified),
    can_edit: flag(last?.canedit),
    can_submit: flag(last?.cansubmit),
    files: mapFiles(files, ctx),
    online_text_html: editorText(plugins.find((plugin) => plugin?.type === 'onlinetext') ?? null),
  };
}

// ---------- Foren ----------

export function mapForums(raw: unknown): MoodleForum[] {
  return compact(
    list(raw).map((item) => {
      const r = rec(item);
      const id = moodleId(r?.id);
      const cmid = moodleId(r?.cmid);
      const course = moodleId(r?.course);
      if (!r || id === null || cmid === null || course === null) return null;
      return {
        moodle_id: id,
        cmid,
        course_id: course,
        name: text(r.name) ?? '',
        type: text(r.type) ?? '',
        can_post: r.cancreatediscussions === true,
      };
    }),
  );
}

/**
 * `mod_forum_get_forum_discussions` → `{ discussions: [...] }`. Achtung: Dort ist `id` der erste
 * Beitrag und `discussion` die Diskussion.
 */
export function mapDiscussions(raw: unknown, forumId: number): MoodleDiscussion[] {
  return compact(
    list(rec(raw)?.discussions).map((item) => {
      const r = rec(item);
      const id = moodleId(r?.discussion);
      const firstPost = moodleId(r?.id);
      const created = timestamp(r?.created) ?? timestamp(r?.timemodified);
      if (!r || id === null || firstPost === null || created === null) return null;
      return {
        moodle_id: id,
        forum_id: forumId,
        first_post_id: firstPost,
        subject: text(r.subject) ?? text(r.name) ?? '',
        author_name: nonEmpty(r.userfullname),
        created_at: created,
        modified_at: timestamp(r.timemodified) ?? timestamp(r.modified) ?? created,
        reply_count: nonNegative(r.numreplies) ?? 0,
        pinned: r.pinned === true,
      };
    }),
  );
}

/** `mod_forum_get_discussion_posts` → `{ posts: [...] }` */
export function mapPosts(raw: unknown, discussionId: number, ctx: MapContext): MoodlePost[] {
  return compact(
    list(rec(raw)?.posts).map((item) => {
      const r = rec(item);
      const id = moodleId(r?.id);
      const created = timestamp(r?.timecreated);
      if (!r || id === null || created === null) return null;
      return {
        moodle_id: id,
        discussion_id: moodleId(r.discussionid) ?? discussionId,
        parent_id: moodleId(r.parentid),
        subject: text(r.subject) ?? '',
        message_html: text(r.message) ?? '',
        author_name: nonEmpty(rec(r.author)?.fullname),
        created_at: created,
        can_reply: rec(r.capabilities)?.reply === true,
        attachments: mapFiles(list(r.attachments), ctx),
      };
    }),
  );
}

// ---------- Fristen ----------

/** cmid aus einer Moodle-Adresse `…/mod/<typ>/view.php?id=<cmid>` (Kalenderereignisse haben kein cmid-Feld) */
function cmidFromUrl(url: string | null): number | null {
  if (!url) return null;
  const parsed = new URL(url);
  return /\/mod\/[a-z0-9_]+\/view\.php$/.test(parsed.pathname)
    ? moodleId(parsed.searchParams.get('id'))
    : null;
}

/** `core_calendar_get_action_events_by_timesort` → `{ events: [...] }`. Frist = `timesort` */
export function mapDeadlines(raw: unknown): MoodleDeadline[] {
  return compact(
    list(rec(raw)?.events).map((item) => {
      const r = rec(item);
      const id = moodleId(r?.id);
      const due = timestamp(r?.timesort) ?? timestamp(r?.timestart);
      if (!r || id === null || due === null) return null;
      const url = safeUrl(r.url) ?? safeUrl(rec(r.action)?.url);
      return {
        event_id: id,
        course_id: moodleId(r.courseid) ?? moodleId(rec(r.course)?.id),
        cmid: cmidFromUrl(url),
        activity_type: nonEmpty(r.modulename),
        name: text(r.name) ?? '',
        due_at: due,
        url,
        action_required: rec(r.action)?.actionable === true,
      };
    }),
  );
}

// ---------- Noten ----------

/** `gradereport_user_get_grade_items` → `{ usergrades: [{ courseid, gradeitems: [...] }] }` */
export function mapGradeItems(raw: unknown, courseId: number): MoodleGradeItem[] {
  return list(rec(raw)?.usergrades).flatMap((entry) => {
    const user = rec(entry);
    const course = moodleId(user?.courseid) ?? courseId;
    return compact(
      list(user?.gradeitems).map((item) => {
        const r = rec(item);
        if (!r) return null;
        return {
          course_id: course,
          name: text(r.itemname) ?? '',
          item_type: text(r.itemtype) ?? '',
          cmid: moodleId(r.cmid),
          grade: nonEmpty(r.gradeformatted),
          range: nonEmpty(r.rangeformatted),
          percentage: nonEmpty(r.percentageformatted),
          feedback_html: nonEmpty(r.feedback),
        };
      }),
    );
  });
}

// ---------- Quizze ----------

/** `mod_quiz_get_quizzes_by_courses` → `{ quizzes: [...] }`. Nur zur Anzeige (F-MDL-05) */
export function mapQuizzes(raw: unknown, ctx: MapContext): MoodleQuiz[] {
  return compact(
    list(rec(raw)?.quizzes).map((item) => {
      const r = rec(item);
      const id = moodleId(r?.id);
      const cmid = moodleId(r?.coursemodule);
      const course = moodleId(r?.course);
      if (!r || id === null || cmid === null || course === null) return null;
      const limit = nonNegative(r.timelimit);
      return {
        moodle_id: id,
        cmid,
        course_id: course,
        name: text(r.name) ?? '',
        opens_at: timestamp(r.timeopen),
        closes_at: timestamp(r.timeclose),
        attempts_allowed: nonNegative(r.attempts) ?? 0,
        time_limit_minutes: limit ? Math.ceil(limit / 60) : null,
        url: `${ctx.baseUrl}/mod/quiz/view.php?id=${cmid}`,
      };
    }),
  );
}

// ---------- Benachrichtigungen ----------

/** `message_popup_get_popup_notifications` → `{ notifications: [...], unreadcount }`. `text` ist Klartext */
export function mapNotifications(raw: unknown): { items: MoodleNotification[]; unread_count: number } {
  const r = rec(raw);
  const items = compact(
    list(r?.notifications).map((item) => {
      const n = rec(item);
      const id = moodleId(n?.id);
      const created = timestamp(n?.timecreated);
      if (!n || id === null || created === null) return null;
      return {
        moodle_id: id,
        subject: text(n.subject) ?? '',
        text: nonEmpty(n.smallmessage) ?? text(n.fullmessage) ?? '',
        created_at: created,
        read: n.read === true || timestamp(n.timeread) !== null,
        url: safeUrl(n.contexturl),
      };
    }),
  );
  return {
    items,
    unread_count: nonNegative(r?.unreadcount) ?? items.filter((item) => !item.read).length,
  };
}
