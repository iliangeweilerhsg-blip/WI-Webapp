'use client';

// T1-24 PR 4 (Plan §6.2): Seite „Abgabe“. Dateien vormerken, als Entwurf speichern, endgültig einreichen.
// Ruhig und ehrlich: Zustände stehen als Text in der Seite, ohne Toast.
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { MoodleUpload } from '@sg/shared';
import { isUnreachable } from '../../lib/api.ts';
import {
  formatBytes,
  formatDue,
  isMoodleNotConfigured,
  isWebUrl,
  MOODLE_UPLOAD_ACCEPT,
  moodleErrorMessage,
  removeMoodleUpload,
  uploadMoodleFile,
  useMoodleAssignments,
  useMoodleStatus,
  useMoodleSubmission,
  useRefreshSubmission,
} from '../../lib/moodle.ts';
import { moduleHref } from '../../lib/nav.ts';
import { CoreHint } from '../CoreHint.tsx';
import { MoodleAccessHint } from '../MoodleAccessHint.tsx';
import { MoodleActionButton } from './MoodleActionButton.tsx';

function parseId(value: string | null): number | null {
  if (value === null || !/^[1-9]\d{0,9}$/.test(value)) return null;
  return Number(value);
}

const STATE_TEXT = {
  keine: 'Kein Entwurf.',
  entwurf: 'Entwurf gespeichert, noch nicht eingereicht.',
  eingereicht: 'Eingereicht.',
} as const;

interface PendingFile {
  key: number;
  name: string;
  upload: MoodleUpload | null;
  error: string | null;
}

export function AbgabeView() {
  const params = useSearchParams();
  const assignmentId = parseId(params.get('aufgabe'));
  const moduleId = params.get('modul');
  const status = useMoodleStatus();
  const assignments = useMoodleAssignments(assignmentId !== null);
  const submission = useMoodleSubmission(assignmentId);
  const refresh = useRefreshSubmission();
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const counter = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const assignment = assignments.data?.find((a) => a.moodle_id === assignmentId);
  const back = moduleId ? moduleHref(moduleId) : '/';

  if (assignmentId === null) {
    return (
      <Shell back={back}>
        <p className="text-md text-text-muted">
          Diese Seite braucht eine Aufgabe. Öffne sie über die Fristen eines Moduls.
        </p>
      </Shell>
    );
  }
  if (status.data?.state === 'nicht_eingerichtet' || isMoodleNotConfigured(submission.error)) {
    return (
      <Shell back={back}>
        <p className="text-md text-text-muted">
          Moodle ist noch nicht eingerichtet. Ohne Zugang gibt es hier nichts abzugeben.
        </p>
      </Shell>
    );
  }

  const sub = submission.data;
  const ready = files.filter((f) => f.upload !== null);
  const uploading = files.some((f) => f.upload === null && f.error === null);
  const uploadIds = ready.flatMap((f) => (f.upload ? [f.upload.upload_id] : []));
  const submitted = sub?.state === 'eingereicht';
  const mayEdit = sub?.can_edit === true && !submitted;
  const requiresSubmit = assignment?.requires_submit ?? true;
  // Unbekannt (Aufgabe nicht geladen) gilt als „verlangt“: Das Häkchen steht dann in der Rückfrage, nie vorausgefüllt
  const needsStatement = assignment?.requires_statement ?? true;

  function add(list: FileList | File[]) {
    for (const file of Array.from(list)) {
      const key = ++counter.current;
      setFiles((current) => [...current, { key, name: file.name, upload: null, error: null }]);
      uploadMoodleFile(file).then(
        (upload) => setFiles((c) => c.map((f) => (f.key === key ? { ...f, upload } : f))),
        (error: unknown) =>
          setFiles((c) => c.map((f) => (f.key === key ? { ...f, error: moodleErrorMessage(error) } : f))),
      );
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) add(event.target.files);
    event.target.value = '';
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (mayEdit) add(event.dataTransfer.files);
  }

  function remove(file: PendingFile) {
    setRemoveError(null);
    if (!file.upload) {
      setFiles((c) => c.filter((f) => f.key !== file.key));
      return;
    }
    removeMoodleUpload(file.upload.upload_id).then(
      () => setFiles((c) => c.filter((f) => f.key !== file.key)),
      (error: unknown) => setRemoveError(moodleErrorMessage(error)),
    );
  }

  const moodleLink =
    status.data?.site_url && assignment && isWebUrl(status.data.site_url)
      ? `${status.data.site_url.replace(/\/+$/, '')}/mod/assign/view.php?id=${assignment.cmid}`
      : null;

  return (
    <Shell back={back} title={assignment?.name ?? 'Abgabe'}>
      <MoodleAccessHint withLink />
      {submission.error && !isMoodleNotConfigured(submission.error) ? (
        isUnreachable(submission.error) ? (
          <CoreHint error={submission.error} />
        ) : (
          <p role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
            {moodleErrorMessage(submission.error)}
          </p>
        )
      ) : null}

      <section aria-label="Aufgabe" className="space-y-1 text-sm text-text-muted">
        {assignment?.due_at ? <p>Frist: {formatDue(assignment.due_at)}</p> : null}
        {moodleLink ? (
          <a
            href={moodleLink}
            target="_blank"
            rel="noreferrer noopener"
            className="underline-offset-2 hover:text-text hover:underline"
          >
            In Moodle öffnen
          </a>
        ) : null}
      </section>

      <section aria-labelledby="abgabe-stand" className="space-y-2">
        <h2 id="abgabe-stand" className="text-sm font-medium text-text-muted">
          Stand in Moodle
        </h2>
        {sub ? (
          <>
            <p className="text-md">
              {STATE_TEXT[sub.state]}
              {sub.last_modified_at ? ` Zuletzt geändert ${formatDue(sub.last_modified_at)}.` : ''}
            </p>
            {sub.files.length > 0 ? (
              <ul className="space-y-0.5 text-sm">
                {sub.files.map((file) => (
                  <li key={file.ref} className="break-words">
                    {file.filename} <span className="text-text-muted">({formatBytes(file.size_bytes)})</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : submission.isPending ? (
          <p className="text-sm text-text-muted">Wird geladen …</p>
        ) : null}
      </section>

      <section aria-labelledby="abgabe-dateien" className="space-y-3">
        <h2 id="abgabe-dateien" className="text-sm font-medium text-text-muted">
          Dateien für den Entwurf
        </h2>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="rounded-lg border border-dashed border-border-strong px-4 py-5 text-sm"
        >
          <p className="text-text-muted">Ziehe Dateien hierher oder wähle sie aus.</p>
          <p className="text-text-muted">PDF, PNG, JPEG, ZIP oder Text (.txt, .md, .csv).</p>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept={MOODLE_UPLOAD_ACCEPT}
            onChange={onPick}
            aria-label="Dateien wählen"
          />
          <button
            type="button"
            disabled={!mayEdit}
            onClick={() => input.current?.click()}
            className="mt-2 min-h-9 rounded-md border border-border px-3 hover:bg-surface disabled:opacity-50"
          >
            Dateien wählen
          </button>
          {sub && !mayEdit ? (
            <p className="mt-2 text-text-muted">
              {submitted ? 'Die Aufgabe ist schon eingereicht.' : 'Moodle erlaubt gerade keine Änderung.'}
            </p>
          ) : null}
        </div>
        {files.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {files.map((file) => (
              <li key={file.key} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1 break-words">{file.name}</span>
                <span className="text-text-muted">
                  {file.upload
                    ? formatBytes(file.upload.size_bytes)
                    : file.error
                      ? file.error
                      : 'Wird hochgeladen …'}
                </span>
                <button
                  type="button"
                  onClick={() => remove(file)}
                  aria-label={`${file.name} entfernen`}
                  className="min-h-9 rounded-md px-2 text-text-muted hover:bg-surface hover:text-text"
                >
                  Entfernen
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {removeError ? (
          <p role="alert" className="text-sm">
            {removeError}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="abgabe-aktionen" className="space-y-4">
        <h2 id="abgabe-aktionen" className="text-sm font-medium text-text-muted">
          Aktionen
        </h2>
        <MoodleActionButton
          action="assign.save_draft"
          params={{ assignment_id: assignmentId, upload_ids: uploadIds }}
          label="Als Entwurf speichern"
          // Der Core fragt beim Speichern nur nach, wenn es (vielleicht) schon die Abgabe ist: ohne Einreichen-Schritt
          // oder unbekannt (Plan §6.2, 08 §9.3). Das gilt auch, wenn die Aufgabenliste hier noch fehlt oder veraltet ist
          confirmLabel="Speichern und abgeben"
          disabled={!mayEdit || uploading || uploadIds.length === 0}
          disabledReason={
            !mayEdit
              ? undefined
              : uploading
                ? 'Die Dateien werden noch hochgeladen.'
                : 'Wähle zuerst mindestens eine Datei.'
          }
          onDone={() => {
            setFiles([]);
            void refresh();
          }}
          onUncertain={() => void refresh()}
        />

        {requiresSubmit ? (
          <div className="space-y-2">
            {/* Die Erklärung steht mit ihrem Text und einem leeren Häkchen in der Rückfrage (Plan §6.2). Die
                Vorschau braucht `accept_statement`, sie ändert aber nichts; ausgeführt wird erst mit Häkchen */}
            <MoodleActionButton
              action="assign.submit"
              params={{ assignment_id: assignmentId, accept_statement: needsStatement }}
              label="Endgültig einreichen"
              confirmLabel="Endgültig einreichen"
              acknowledge={needsStatement ? 'Ich habe die Erklärung gelesen und bestätige sie.' : undefined}
              disabled={sub?.state !== 'entwurf' || sub.can_submit !== true}
              disabledReason={
                !sub
                  ? undefined
                  : sub.state === 'eingereicht'
                    ? 'Schon eingereicht.'
                    : sub.state === 'entwurf'
                      ? 'Moodle erlaubt das Einreichen gerade nicht.'
                      : 'Speichere zuerst einen Entwurf.'
              }
              onDone={() => void refresh()}
              onUncertain={() => void refresh()}
            />
            <p className="text-sm text-text-muted">
              Nach dem Einreichen lässt sich die Abgabe nicht mehr ändern.
            </p>
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            Bei dieser Aufgabe ist Speichern schon die Abgabe. Einen Einreichen-Schritt gibt es nicht.
          </p>
        )}
      </section>
    </Shell>
  );
}

function Shell({
  back,
  title = 'Abgabe',
  children,
}: {
  back: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={back}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          Zurück zum Modul
        </Link>
        <h1 id="screen-title" className="mt-2 text-xxl font-semibold">
          {title}
        </h1>
      </div>
      {children}
    </div>
  );
}
