// Moodle-Lese-Endpunkte (F-MDL-02, 08 §9.2): ruft Moodle lesend auf und liefert eigene Formate.
import type {
  MoodleAssignmentList,
  MoodleCourseContents,
  MoodleCourseList,
  MoodleDeadlineList,
  MoodleDiscussionList,
  MoodleForumList,
  MoodleGradeList,
  MoodleNotificationList,
  MoodlePostList,
  MoodleQuizList,
  MoodleSubmissionStatus,
} from '@sg/shared';
import { MAX_REF_LENGTH, type MoodleClient } from './client.ts';
import {
  list,
  mapAssignments,
  mapCourses,
  mapDeadlines,
  mapDiscussions,
  mapForums,
  mapGradeItems,
  mapNotifications,
  mapPosts,
  mapQuizzes,
  mapSections,
  mapSubmissionStatus,
  moodleId,
  rec,
  type MapContext,
} from './mappers.ts';
import type { MoodleStatusService } from './status.ts';

/** Höchstens so viele Dateiverweise merkt sich der Core (älteste fallen zuerst heraus) */
export const MAX_KNOWN_FILES = 50_000;

/**
 * Dateiverweise, die der Core selbst über die Lese-Endpunkte ausgegeben hat. Nur diese liefert
 * `GET /moodle/file` aus: kein Abruf beliebiger Pfade, auch nicht innerhalb der Instanz.
 * Liegt nur im Speicher. Nach einem Neustart lädt die Web-App den Kursinhalt neu.
 */
export class MoodleFileRegistry {
  private readonly refs = new Set<string>();
  private readonly max: number;

  constructor(max: number = MAX_KNOWN_FILES) {
    this.max = max;
  }

  add(ref: string): void {
    // Längere Verweise gelten nirgends als gültig (isValidFileRef): nicht merken, damit die Registry klein bleibt
    if (ref.length > MAX_REF_LENGTH) return;
    // Neu einsortieren, damit häufig gesehene Verweise nicht als älteste herausfallen
    this.refs.delete(ref);
    this.refs.add(ref);
    if (this.refs.size > this.max) {
      const oldest = this.refs.values().next();
      if (!oldest.done) this.refs.delete(oldest.value);
    }
  }

  has(ref: string): boolean {
    return this.refs.has(ref);
  }

  get size(): number {
    return this.refs.size;
  }
}

/** Zeitzone des Rechners, wie beim Kalender (Kursdaten sind Mitternacht Ortszeit) */
function defaultTimeZone(): string {
  return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Gültige IANA-Zeitzone oder UTC. Eine falsche `TZ` darf keinen 500 auslösen */
export function validTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

export interface MoodleReaderOptions {
  client: MoodleClient;
  status: MoodleStatusService;
  files: MoodleFileRegistry;
  timeZone?: string;
}

export class MoodleReader {
  private readonly client: MoodleClient;
  private readonly status: MoodleStatusService;
  private readonly files: MoodleFileRegistry;
  readonly timeZone: string;

  constructor(options: MoodleReaderOptions) {
    this.client = options.client;
    this.status = options.status;
    this.files = options.files;
    this.timeZone = validTimeZone(options.timeZone ?? defaultTimeZone());
  }

  private context(): MapContext {
    return {
      baseUrl: this.client.baseUrl,
      timeZone: this.timeZone,
      onFile: (file) => this.files.add(file.ref),
    };
  }

  private async rawCourses(): Promise<unknown> {
    const userid = await this.status.userId();
    return this.client.read('core_enrol_get_users_courses', { userid });
  }

  async courses(): Promise<MoodleCourseList> {
    return { items: mapCourses(await this.rawCourses(), this.context()) };
  }

  async courseContents(courseId: number): Promise<MoodleCourseContents> {
    const raw = await this.client.read('core_course_get_contents', { courseid: courseId });
    return { course_id: courseId, sections: mapSections(raw, this.context()) };
  }

  async assignments(courseId?: number): Promise<MoodleAssignmentList> {
    const raw = await this.client.read(
      'mod_assign_get_assignments',
      courseId ? { courseids: [courseId] } : {},
    );
    return { items: mapAssignments(raw, this.context()) };
  }

  async submission(assignmentId: number): Promise<MoodleSubmissionStatus> {
    const raw = await this.client.read('mod_assign_get_submission_status', { assignid: assignmentId });
    return mapSubmissionStatus(raw, assignmentId, this.context());
  }

  async forums(courseId?: number): Promise<MoodleForumList> {
    const raw = await this.client.read(
      'mod_forum_get_forums_by_courses',
      courseId ? { courseids: [courseId] } : {},
    );
    return { items: mapForums(raw) };
  }

  async discussions(forumId: number): Promise<MoodleDiscussionList> {
    const raw = await this.client.read('mod_forum_get_forum_discussions', { forumid: forumId });
    return { items: mapDiscussions(raw, forumId) };
  }

  async posts(discussionId: number): Promise<MoodlePostList> {
    const raw = await this.client.read('mod_forum_get_discussion_posts', { discussionid: discussionId });
    return { items: mapPosts(raw, discussionId, this.context()) };
  }

  async deadlines(from: Date, limit: number): Promise<MoodleDeadlineList> {
    const raw = await this.client.read('core_calendar_get_action_events_by_timesort', {
      timesortfrom: Math.floor(from.getTime() / 1000),
      limitnum: limit,
    });
    return { items: mapDeadlines(raw) };
  }

  /**
   * Noten. `gradereport_user_get_grade_items` braucht eine Kurs-ID: Ohne `courseId` wird jeder Kurs
   * des Nutzers einzeln abgefragt, außer Kurse, die Noten ausblenden (`showgrades = 0`). Kurse mit
   * Fehler fallen dann weg; scheitern alle, gilt der erste Fehler.
   */
  async grades(courseId?: number): Promise<MoodleGradeList> {
    const userid = await this.status.userId();
    const gradesOf = async (id: number) =>
      mapGradeItems(await this.client.read('gradereport_user_get_grade_items', { courseid: id, userid }), id);
    if (courseId) return { items: await gradesOf(courseId) };
    const courseIds = list(await this.rawCourses())
      .map(rec)
      .filter((course) => course !== null && course.showgrades !== false && course.showgrades !== 0)
      .map((course) => moodleId(course?.id))
      .filter((id): id is number => id !== null);
    const results = await Promise.allSettled(courseIds.map(gradesOf));
    const ok = results.filter((result) => result.status === 'fulfilled');
    const failed = results.find((result) => result.status === 'rejected');
    if (ok.length === 0 && failed) throw failed.reason;
    return { items: ok.flatMap((result) => result.value) };
  }

  async quizzes(courseId?: number): Promise<MoodleQuizList> {
    const raw = await this.client.read(
      'mod_quiz_get_quizzes_by_courses',
      courseId ? { courseids: [courseId] } : {},
    );
    return { items: mapQuizzes(raw, this.context()) };
  }

  async notifications(limit: number): Promise<MoodleNotificationList> {
    const useridto = await this.status.userId();
    const raw = await this.client.read('message_popup_get_popup_notifications', {
      useridto,
      newestfirst: 1,
      limit,
      offset: 0,
    });
    return mapNotifications(raw);
  }
}
