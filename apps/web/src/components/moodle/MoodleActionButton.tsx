'use client';

// T1-24 PR 4 (Plan §6.3, §6.4): Eine Moodle-Aktion auslösen. Vorschau → (Rückfrage) → Ausführen.
// Standard der Rückfrage ist „Abbrechen“. In einer laufenden Vorlesung (R1) steht die Rückfrage in der Seite:
// kein Dialog, kein Toast, kein Ton.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { MoodleActionId, MoodleActionPreview, MoodleActionResult } from '@sg/shared';
import {
  executeMoodleAction,
  formatBytes,
  formatClock,
  isActionNotImplemented,
  isConfirmationInvalid,
  isOutcomeUnknown,
  isStateChanged,
  moodleErrorMessage,
  previewMoodleAction,
  useMoodleActionCatalog,
  useSingleFlight,
  type MoodleActionParams,
} from '../../lib/moodle.ts';
import { useActiveSession } from '../../lib/sessions.ts';
import { trapTab } from '../SetupDialog.tsx';

export interface MoodleActionButtonProps {
  action: MoodleActionId;
  params: MoodleActionParams;
  /** Standard: Beschriftung aus dem Katalog */
  label?: string;
  /** Beschriftung des Bestätigens in der Rückfrage (Standard: „Bestätigen“) */
  confirmLabel?: string;
  disabled?: boolean;
  /** Grund, warum der Knopf aus ist; steht als Text daneben */
  disabledReason?: string;
  onDone?(result: MoodleActionResult): void;
  /** `outcome_unknown`: Moodle hat es vielleicht übernommen. Die Seite lädt den Stand neu */
  onUncertain?(): void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'confirm'; preview: MoodleActionPreview; notice: string | null }
  | { kind: 'done'; summary: string }
  | { kind: 'error'; message: string }
  | { kind: 'unavailable' };

interface FileLine {
  name: string;
  bytes: number | null;
}

/** Dateien aus `details.files`, tolerant gegenüber der genauen Form (Plan §4.4 legt sie nicht fest) */
function filesOf(details: Record<string, unknown>): FileLine[] {
  const raw = details.files;
  if (!Array.isArray(raw)) return [];
  const lines: FileLine[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry === 'string') lines.push({ name: entry, bytes: null });
    else if (typeof entry === 'object' && entry !== null) {
      const o = entry as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name : typeof o.filename === 'string' ? o.filename : null;
      const bytes =
        typeof o.bytes === 'number' ? o.bytes : typeof o.size_bytes === 'number' ? o.size_bytes : null;
      if (name) lines.push({ name, bytes });
    }
  }
  return lines;
}

function textOf(details: Record<string, unknown>, key: string): string | null {
  const value = details[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Inhalt der Rückfrage. Alles aus dem Core wird als Text gesetzt, nie als HTML */
function ConfirmBody({
  preview,
  notice,
  confirmLabel,
  busy,
  titleId,
  cancelRef,
  onConfirm,
  onCancel,
}: {
  preview: MoodleActionPreview;
  notice: string | null;
  confirmLabel: string;
  busy: boolean;
  titleId: string;
  cancelRef: RefObject<HTMLButtonElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const files = filesOf(preview.details);
  const excerpt = textOf(preview.details, 'text_preview');
  const statement = textOf(preview.details, 'statement_text');
  return (
    <div className="space-y-3">
      <h3 id={titleId} className="text-md font-medium">
        {preview.summary}
      </h3>
      {notice ? <p className="text-sm">{notice}</p> : null}
      {preview.warnings.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-text-muted">
          {preview.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {files.length > 0 ? (
        <ul className="space-y-0.5 text-sm">
          {files.map((file, index) => (
            <li key={index} className="break-words">
              {file.name}
              {file.bytes !== null ? (
                <span className="text-text-muted"> ({formatBytes(file.bytes)})</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {excerpt ? (
        <p className="whitespace-pre-wrap break-words rounded-md border border-border px-3 py-2 text-sm text-text-muted">
          {excerpt}
        </p>
      ) : null}
      {statement ? (
        <p className="whitespace-pre-wrap break-words text-sm text-text-muted">{statement}</p>
      ) : null}
      {preview.expires_at ? (
        <p className="text-sm text-text-muted">
          Diese Bestätigung gilt bis {formatClock(preview.expires_at)}.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="min-h-9 rounded-md border border-border-strong px-3 text-sm font-medium hover:bg-surface"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="min-h-9 rounded-md border border-border px-3 text-sm text-text-muted hover:bg-surface hover:text-text disabled:opacity-50"
        >
          {busy ? 'Einen Moment …' : confirmLabel}
        </button>
      </div>
    </div>
  );
}

export function MoodleActionButton({
  action,
  params,
  label,
  confirmLabel = 'Bestätigen',
  disabled = false,
  disabledReason,
  onDone,
  onUncertain,
}: MoodleActionButtonProps) {
  const catalog = useMoodleActionCatalog();
  const active = useActiveSession();
  const inSession = Boolean(active.data);
  const info = catalog.data?.find((item) => item.id === action);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [executing, setExecuting] = useState(false);
  const singleFlight = useSingleFlight();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirming = phase.kind === 'confirm';
  const expiresAt = phase.kind === 'confirm' ? phase.preview.expires_at : null;
  // Die Rückfrage schließt sich, wenn der Code abläuft (ein einziger Timer, kein Polling)
  useEffect(() => {
    if (!expiresAt) return;
    const wait = Math.max(0, new Date(expiresAt).getTime() - Date.now());
    const timer = setTimeout(() => {
      setPhase({ kind: 'error', message: 'Die Bestätigung ist abgelaufen. Starte noch einmal.' });
    }, wait);
    return () => clearTimeout(timer);
  }, [expiresAt]);

  // Der Fokus liegt zuerst auf „Abbrechen“ (Standard); nach dem Abbrechen zurück auf dem Knopf
  const returnFocus = useRef(false);
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming, inSession]);

  const cancel = useCallback(() => {
    returnFocus.current = true;
    setPhase({ kind: 'idle' });
  }, []);

  const fail = useCallback(
    (error: unknown) => {
      if (isActionNotImplemented(error)) setPhase({ kind: 'unavailable' });
      else if (isOutcomeUnknown(error)) {
        setPhase({
          kind: 'error',
          message: 'Unklar, ob Moodle es übernommen hat. Der Stand wird neu geladen. Bitte prüfe ihn.',
        });
        onUncertain?.();
      } else setPhase({ kind: 'error', message: moodleErrorMessage(error) });
    },
    [onUncertain],
  );

  function start() {
    singleFlight((done) => {
      setPhase({ kind: 'busy' });
      void (async () => {
        try {
          const preview = await previewMoodleAction(action, params);
          if (preview.needs_confirmation && preview.confirmation_token) {
            setPhase({ kind: 'confirm', preview, notice: null });
            return;
          }
          const result = await executeMoodleAction(action, params, null);
          setPhase({ kind: 'done', summary: result.summary });
          onDone?.(result);
        } catch (error) {
          fail(error);
        } finally {
          done();
        }
      })();
    });
  }

  function confirm() {
    if (phase.kind !== 'confirm') return;
    const { preview } = phase;
    singleFlight((done) => {
      setExecuting(true);
      void (async () => {
        try {
          const result = await executeMoodleAction(action, params, preview.confirmation_token);
          setPhase({ kind: 'done', summary: result.summary });
          onDone?.(result);
        } catch (error) {
          if (isConfirmationInvalid(error)) {
            // Neue Vorschau holen und die Rückfrage neu zeigen. Nie automatisch ausführen
            try {
              const fresh = await previewMoodleAction(action, params);
              if (fresh.needs_confirmation && fresh.confirmation_token) {
                setPhase({
                  kind: 'confirm',
                  preview: fresh,
                  notice: isStateChanged(error)
                    ? 'Der Entwurf hat sich geändert. Bitte prüfe ihn noch einmal.'
                    : 'Die Bestätigung galt nicht mehr. Hier ist der aktuelle Stand.',
                });
              } else {
                setPhase({ kind: 'error', message: 'Der Stand hat sich geändert. Starte noch einmal.' });
              }
            } catch (previewError) {
              fail(previewError);
            }
          } else fail(error);
        } finally {
          setExecuting(false);
          done();
        }
      })();
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancel();
    } else if (!inSession) trapTab(event);
  }

  const heading = label ?? info?.label ?? action;
  const unavailable = phase.kind === 'unavailable';
  const notAllowed = info !== undefined && !info.available;
  const off = disabled || phase.kind === 'busy' || confirming || unavailable || notAllowed;
  const reason = unavailable
    ? 'Das ist noch nicht freigeschaltet.'
    : notAllowed
      ? 'Dein Moodle-Zugang erlaubt das nicht.'
      : disabled
        ? (disabledReason ?? null)
        : null;

  const body =
    phase.kind === 'confirm' ? (
      <ConfirmBody
        preview={phase.preview}
        notice={phase.notice}
        confirmLabel={confirmLabel}
        busy={executing}
        titleId={titleId}
        cancelRef={cancelRef}
        onConfirm={confirm}
        onCancel={cancel}
      />
    ) : null;

  return (
    <div className="space-y-2">
      <button
        ref={triggerRef}
        type="button"
        disabled={off}
        aria-busy={phase.kind === 'busy'}
        onClick={start}
        className="min-h-9 rounded-md border border-border-strong px-3 text-sm font-medium hover:bg-surface disabled:opacity-50"
      >
        {phase.kind === 'busy' ? 'Einen Moment …' : heading}
      </button>
      {reason ? <p className="text-sm text-text-muted">{reason}</p> : null}
      {phase.kind === 'done' ? (
        <p role="status" className="text-sm">
          {phase.summary}
        </p>
      ) : null}
      {phase.kind === 'error' ? (
        <p role="alert" className="text-sm">
          {phase.message}
        </p>
      ) : null}
      {body && inSession ? (
        // R1: In der Vorlesung kein Dialog, die Rückfrage steht in der Seite
        <section
          aria-labelledby={titleId}
          onKeyDown={onKeyDown}
          className="rounded-lg border border-border bg-surface px-4 py-3"
        >
          {body}
        </section>
      ) : null}
      {body && !inSession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={onKeyDown}
            className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-border bg-bg px-5 py-4 shadow-lg"
          >
            {body}
          </div>
        </div>
      ) : null}
    </div>
  );
}
