'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { Module, MoodleCourse, MoodleCourseLink, MoodleSyncStatus } from '@sg/shared';
import { useRestoreTrashItem } from '../../lib/data.ts';
import { useVisibleModules } from '../../lib/modules.ts';
import {
  formatSyncedAt,
  formatValidUntil,
  hasCurrentSemester,
  isMoodleNotConfigured,
  isMoodleTokenInvalid,
  moodleErrorMessage,
  useAutoAssign,
  useLinkCourse,
  useMoodleCourses,
  useMoodleLinks,
  useMoodleStatus,
  useMoodleSync,
  useMoodleSyncWithRefresh,
  useRemoveAutoModule,
  useSingleFlight,
  useStartSync,
  useUnlinkCourse,
} from '../../lib/moodle.ts';
import { useSemesters } from '../../lib/semesters.ts';
import { useToast } from '../../lib/toast.tsx';
import { CoreHint } from '../CoreHint.tsx';
import { MoodleAccessHint } from '../MoodleAccessHint.tsx';

const smallButton =
  'min-h-9 rounded-md border border-border px-3 py-1 text-sm hover:bg-surface disabled:opacity-50 sg-transition';
const primaryButton =
  'min-h-9 rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-contrast disabled:opacity-50 sg-transition';
const selectClass = 'min-h-9 max-w-full rounded-md border border-border-strong bg-bg px-2 py-1 text-sm';
const textLink = 'whitespace-nowrap text-text-muted underline underline-offset-2 hover:text-text';

/** Vermerk der automatischen Zuordnung (#141, R15: sichtbar und umkehrbar) */
const AUTO_NOTE = { zugeordnet: 'automatisch zugeordnet', angelegt: 'Modul automatisch angelegt' } as const;

/**
 * Ohne aktuelles Semester legt die automatische Zuordnung keine Module an (#141). Ein ruhiger Hinweis mit Link zu den
 * Semestern (Einstellungen › Allgemein). Ein `next/link`, kein rohes `<a>`: Ein harter Seitenwechsel würde die Aufnahme
 * beenden (Issue #210). `SettingsView` folgt `?bereich=` bei jeder Änderung der Query.
 */
function SemesterHint({ empty }: { empty: boolean }) {
  return (
    <p role="status" className="mt-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      {empty ? 'Lege zuerst das Semester an.' : 'Wähle zuerst das aktuelle Semester.'}{' '}
      <Link href="/einstellungen?bereich=allgemein" className={textLink}>
        Zu den Semestern
      </Link>
      <span className="mt-1 block text-text-muted">
        Danach ordnet die App deine Kurse automatisch Modulen zu und legt fehlende Module an.
      </span>
    </p>
  );
}

/** Ruhiger Satz zum letzten Abgleich (R13: sachlich, ohne Alarm) */
function lastRunText(status: MoodleSyncStatus): string {
  const run = status.last_run;
  if (status.state === 'laeuft') return 'Gleicht gerade ab …';
  if (!run?.finished_at) return 'Noch nicht abgeglichen.';
  const when = `Zuletzt abgeglichen ${formatSyncedAt(run.finished_at)}`;
  if (run.error_code === 'moodle_token_invalid') return `${when}. Moodle hat den Zugang abgelehnt.`;
  const parts = [`${run.courses} ${run.courses === 1 ? 'Kurs' : 'Kurse'}`];
  if (run.files_imported > 0) parts.push(`${run.files_imported} übernommen`);
  if (run.inbox_new > 0) parts.push(`${run.inbox_new} in der Inbox`);
  const failed = run.failed_courses.length;
  if (failed > 0)
    parts.push(`${failed} ${failed === 1 ? 'Kurs' : 'Kurse'} nicht erreicht, nächster Versuch folgt`);
  return `${when} · ${parts.join(' · ')}`;
}

function SyncPanel() {
  const sync = useMoodleSyncWithRefresh();
  const start = useStartSync();
  const once = useSingleFlight();
  const toast = useToast();
  const status = sync.data;
  if (!status) return null;
  const paused = status.state === 'pausiert';
  return (
    <div className="mt-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium">Abgleich</h3>
          <p role="status" className="mt-1 text-sm text-text-muted">
            {lastRunText(status)}
          </p>
          {/* Pausiert: der Hinweis zum Zugang steht schon oben, hier kein zweiter (Review #134, M1) */}
          {paused ? null : (
            <p className="mt-1 text-sm text-text-muted">
              Läuft beim Start und alle 2 Stunden. Neue Folien und Übungsblätter landen im zugeordneten Modul.
            </p>
          )}
        </div>
        <button
          type="button"
          className={primaryButton}
          disabled={status.state !== 'bereit' || start.isPending}
          onClick={() =>
            once((done) =>
              start.mutate(undefined, {
                onSettled: done,
                onError: (error) => toast.show({ message: moodleErrorMessage(error) }),
              }),
            )
          }
        >
          {status.state === 'laeuft' ? 'Gleicht ab …' : 'Jetzt abgleichen'}
        </button>
      </div>
    </div>
  );
}

function CourseRow({
  course,
  link,
  modules,
}: {
  course: MoodleCourse;
  link: MoodleCourseLink | undefined;
  modules: readonly Module[];
}) {
  const linked = course.module_id;
  const [choice, setChoice] = useState<string>(linked ?? course.suggested_module_id ?? '');
  // Ändert sich die Zuordnung von außen (Automatik beim Abgleich, #141), folgt die Auswahl
  const [shownLink, setShownLink] = useState(linked);
  if (shownLink !== linked) {
    setShownLink(linked);
    setChoice(linked ?? course.suggested_module_id ?? '');
  }
  const linkMutation = useLinkCourse();
  const unlink = useUnlinkCourse();
  const removeModule = useRemoveAutoModule();
  const restore = useRestoreTrashItem();
  const toast = useToast();
  const selectId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  // Fokus auf die Auswahl erst, wenn sie nicht mehr gesperrt ist (#135); ein gesperrtes Feld nimmt keinen Fokus an
  const [focusSelect, setFocusSelect] = useState(false);
  // Eine Sperre für alle Aktionen der Zeile: Zuordnen, Schalter, Lösen (Review #134, N1)
  const once = useSingleFlight();
  const busy = linkMutation.isPending || unlink.isPending || removeModule.isPending;
  useEffect(() => {
    if (!focusSelect || busy) return;
    selectRef.current?.focus();
    setFocusSelect(false);
  }, [focusSelect, busy]);
  const onError = (error: unknown) => toast.show({ message: moodleErrorMessage(error) });
  const suggested = !linked && course.suggested_module_id && choice === course.suggested_module_id;
  // Die Zuordnung aus /moodle/links passt nur, solange sie dasselbe Modul meint wie die Kursliste
  const current = linked && link?.module_id === linked ? link : undefined;
  const autoNote = current?.auto ? AUTO_NOTE[current.auto] : null;

  function remove() {
    if (!linked) return;
    const moduleId = linked;
    const name = modules.find((m) => m.id === moduleId)?.name ?? 'Das Modul';
    once((done) =>
      removeModule.mutate(course.moodle_id, {
        onSettled: done,
        onError,
        onSuccess: () => {
          setChoice('');
          toast.show({
            message: `${name} entfernt. Das Modul liegt im Papierkorb.`,
            actionLabel: 'Rückgängig',
            durationMs: 10_000,
            onAction: () => restore.mutate(moduleId, { onError }),
          });
          setFocusSelect(true);
        },
      }),
    );
  }

  function assign() {
    if (!choice) return;
    const name = modules.find((m) => m.id === choice)?.name ?? 'Modul';
    once((done) =>
      linkMutation.mutate(
        { courseId: course.moodle_id, moduleId: choice },
        {
          onSettled: done,
          onError,
          onSuccess: () => {
            toast.show({ message: `Zugeordnet zu ${name}. Der Abgleich startet.` });
            // Der Knopf verschwindet: Fokus auf die Auswahl der Zeile (Review #134, N3)
            setFocusSelect(true);
          },
        },
      ),
    );
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-60">
          <p className="break-words font-medium">{course.full_name || course.short_name}</p>
          <p className="text-sm text-text-muted">
            {[
              course.short_name,
              autoNote,
              link?.last_synced_at ? `abgeglichen ${formatSyncedAt(link.last_synced_at)}` : null,
              link && !link.sync_enabled ? 'Abgleich aus' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={selectId} className="sr-only">
            Modul für {course.full_name || course.short_name}
          </label>
          <select
            ref={selectRef}
            id={selectId}
            className={selectClass}
            value={choice}
            disabled={busy}
            onChange={(e) => setChoice(e.target.value)}
          >
            <option value="">Kein Modul</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {suggested ? (
            <span className="rounded-sm border border-border-strong px-1.5 text-xs font-medium">
              Vorschlag
            </span>
          ) : null}
          {choice && choice !== linked ? (
            <button type="button" className={primaryButton} disabled={busy} onClick={assign}>
              {linked ? 'Ändern' : 'Zuordnen'}
            </button>
          ) : null}
          {linked ? (
            <>
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={link?.sync_enabled ?? true}
                  disabled={busy}
                  onChange={(e) => {
                    const syncEnabled = e.target.checked;
                    once((done) =>
                      linkMutation.mutate(
                        { courseId: course.moodle_id, moduleId: linked, syncEnabled },
                        { onSettled: done, onError },
                      ),
                    );
                  }}
                />
                Abgleichen
              </label>
              <button
                type="button"
                className={smallButton}
                disabled={busy}
                onClick={() =>
                  once((done) =>
                    unlink.mutate(course.moodle_id, {
                      onSettled: done,
                      onError,
                      onSuccess: () => {
                        setChoice('');
                        toast.show({
                          message:
                            'Zuordnung gelöst. Übernommenes Material bleibt im Modul, automatisch wird der Kurs nicht wieder zugeordnet.',
                        });
                        setFocusSelect(true);
                      },
                    }),
                  )
                }
              >
                Lösen
              </button>
              {current?.module_removable ? (
                <button type="button" className={smallButton} disabled={busy} onClick={remove}>
                  Modul entfernen
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function CourseList({
  courses,
  links,
  modules,
}: {
  courses: readonly MoodleCourse[];
  links: ReadonlyMap<number, MoodleCourseLink>;
  modules: readonly Module[];
}) {
  return (
    <ul className="divide-y divide-border">
      {courses.map((course) => (
        <CourseRow
          key={course.moodle_id}
          course={course}
          link={links.get(course.moodle_id)}
          modules={modules}
        />
      ))}
    </ul>
  );
}

/**
 * Einstellungen › Moodle (F-MDL-03/-04, #141): Zugang, Abgleich und Zuordnung der Kurse zu Modulen. Neue Kurse des
 * aktuellen Semesters ordnet der Core automatisch zu bzw. legt das Modul an, mit Vermerk in der Zeile. Mehrdeutige
 * bleiben Vorschläge, abgeglichen wird erst nach „Zuordnen“. Organisatorische und alte Kurse stehen eingeklappt unter
 * „Weitere Kurse“.
 */
export function MoodleSettings() {
  const status = useMoodleStatus();
  const configured = status.data ? status.data.state !== 'nicht_eingerichtet' : false;
  const courses = useMoodleCourses(configured);
  const sync = useMoodleSync();
  const { modules } = useVisibleModules();
  const semesters = useSemesters();
  // Die Zuordnung steckt schon in course.module_id; Abgleich-Schalter und Zeitpunkt kommen aus /moodle/links
  const linkList = useMoodleLinks();
  const links = new Map((linkList.data ?? []).map((link) => [link.moodle_course_id, link]));
  // Beim Öffnen einmal die automatische Zuordnung anstoßen (#141). Der Abgleich im Core macht das zusätzlich beim
  // Start und alle 2 h. Fehler bleiben still: Zugang und Erreichbarkeit zeigt die Seite ohnehin an
  const autoAssign = useAutoAssign();
  const autoStarted = useRef(false);
  const autoState = status.data?.state;
  useEffect(() => {
    if (autoStarted.current || !autoState || autoState === 'nicht_eingerichtet') return;
    autoStarted.current = true;
    autoAssign.mutate();
  }, [autoState, autoAssign]);

  if (status.isError) return <CoreHint error={status.error} />;
  if (!status.data) return null;

  const state = status.data;
  const current = (courses.data ?? []).filter((c) => c.category === 'aktuell' || c.module_id !== null);
  const other = (courses.data ?? []).filter((c) => c.category !== 'aktuell' && c.module_id === null);
  // Ohne Kursliste (Moodle lehnt ab oder antwortet nicht): die bestehenden Zuordnungen aus /moodle/links,
  // damit Schalter und „Lösen“ erreichbar bleiben (Review #134, M1)
  // Nur bei Fehler ohne Kursliste: solange sie lädt, kein Zwischenstand „Zugeordnete Kurse“; schlägt ein Neuladen
  // fehl, bleiben die alten Daten stehen (TanStack behält `data`) und die Kurse erscheinen nicht doppelt (#135)
  const linkedOnly: MoodleCourse[] =
    courses.isError && !courses.data ? (linkList.data ?? []).map(courseFromLink) : [];
  const noCurrentSemester = semesters.data !== undefined && !hasCurrentSemester(semesters.data);
  const showValidUntil =
    (state.state === 'ok' || state.state === 'laeuft_bald_ab') && state.token_valid_until;

  return (
    <div>
      <h2 className="text-lg font-medium">Moodle</h2>
      {!configured ? (
        <div className="mt-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          <p className="font-medium">Moodle ist noch nicht eingerichtet</p>
          <p className="mt-1 text-text-muted">
            Richte den Zugang einmal am Mac mit <code className="font-mono">pnpm sg moodle login</code> ein.
            Danach erscheinen hier deine Kurse.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-text-muted">
            {[
              state.site_name,
              state.user_fullname,
              showValidUntil ? `Zugang gültig bis ${formatValidUntil(showValidUntil)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-3 empty:hidden">
            <MoodleAccessHint />
          </div>
          {sync.data ? <SyncPanel /> : null}

          <div className="mt-6">
            <h3 className="font-medium">Kurse und Module</h3>
            <p className="mt-1 text-sm text-text-muted">
              Jeder Kurs gehört zu höchstens einem Modul. Neue Kurse ordnet die App automatisch zu und legt
              fehlende Module an. Nach „Lösen“ bleibt es bei deiner Entscheidung.
            </p>
            {noCurrentSemester ? <SemesterHint empty={semesters.data?.length === 0} /> : null}
            {/* Bei abgelehntem Zugang steht der Grund schon im Hinweis oben */}
            {courses.isError &&
            !isMoodleNotConfigured(courses.error) &&
            !isMoodleTokenInvalid(courses.error) ? (
              <p role="status" className="mt-3 text-sm text-text-muted">
                {moodleErrorMessage(courses.error)} Die Kursliste kommt, sobald Moodle antwortet.
              </p>
            ) : null}
            {courses.isPending && courses.fetchStatus !== 'idle' ? (
              <p role="status" aria-busy="true" className="mt-3 text-sm text-text-muted">
                Lädt die Kurse aus Moodle …
              </p>
            ) : null}
            {courses.data && courses.data.length === 0 ? (
              <p className="mt-3 text-sm text-text-muted">Moodle meldet keine Kurse für deinen Zugang.</p>
            ) : null}
            {current.length > 0 ? (
              <div className="mt-2">
                <CourseList courses={current} links={links} modules={modules ?? []} />
              </div>
            ) : null}
            {linkedOnly.length > 0 ? (
              <div className="mt-2">
                <p className="text-sm text-text-muted">Zugeordnete Kurse:</p>
                <CourseList courses={linkedOnly} links={links} modules={modules ?? []} />
              </div>
            ) : null}
            {other.length > 0 ? (
              <details className="mt-4 rounded-lg border border-border px-4 py-2">
                <summary className="cursor-pointer py-1 text-sm text-text-muted">
                  Weitere Kurse ({other.length}): organisatorisch oder aus früheren Semestern
                </summary>
                <CourseList courses={other} links={links} modules={modules ?? []} />
              </details>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/** Platzhalter-Kurs aus einer Zuordnung, wenn Moodle die Kursliste gerade nicht liefert */
function courseFromLink(link: MoodleCourseLink): MoodleCourse {
  return {
    moodle_id: link.moodle_course_id,
    short_name: '',
    full_name: `Moodle-Kurs ${link.moodle_course_id}`,
    start_date: null,
    end_date: null,
    url: '',
    last_access_at: null,
    module_id: link.module_id,
    suggested_module_id: null,
    category: 'aktuell',
  };
}
