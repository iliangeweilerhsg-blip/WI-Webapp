'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { UploadResultSchema } from '@sg/shared';
import { ApiRequestError, apiUpload, friendlyMessage } from './api.ts';
import { KIND_WORDS, collectionPath, invalidateMaterial, type MaterialKind } from './material.ts';
import { useToast } from './toast.tsx';
import { uuidv7 } from './uuid.ts';

export type UploadStatus = 'wartet' | 'laeuft' | 'fertig' | 'dublette' | 'fehler';

export interface UploadEntry {
  id: string;
  /** Idempotency-Key: gilt für diese Datei, auch bei „Erneut versuchen“ */
  key: string;
  file: File;
  moduleId: string;
  kind: MaterialKind;
  batch: string;
  status: UploadStatus;
  /** Nur bei `fehler`: ruhiger Text */
  message?: string;
  /** Netzfehler und 5xx: Wiederholen mit demselben Schlüssel ist sinnvoll */
  retryable?: boolean;
  /** ID des neuen bzw. schon vorhandenen Objekts */
  resultId?: string;
}

/** Wohin Dateien gehören, wenn sie irgendwo ins Fenster gezogen werden. */
export interface UploadTarget {
  moduleId: string;
  /** `null`: Das Modul ist offen, aber der Tab nimmt keine PDFs an (Konzepte, Altklausuren) */
  kind: MaterialKind | null;
  /** Springt zu einem vorhandenen Dokument („Schon vorhanden“) */
  open: (kind: MaterialKind, id: string) => void;
}

interface UploadApi {
  entries: readonly UploadEntry[];
  /** Läuft gerade ein Drag mit Dateien über das Fenster? */
  dragging: boolean;
  enqueue: (files: File[], target: Omit<UploadTarget, 'kind'> & { kind: MaterialKind }) => void;
  retry: (id: string) => void;
  dismiss: (id: string) => void;
  registerTarget: (target: UploadTarget | null) => void;
}

const UploadContext = createContext<UploadApi | null>(null);

function looksLikePdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

interface Outcome {
  fresh: number;
  duplicate: number;
  failed: number;
  firstDuplicate?: UploadEntry;
  firstFailure?: UploadEntry;
}

function summarize(batch: readonly UploadEntry[]): { message: string; open?: UploadEntry } {
  const outcome: Outcome = { fresh: 0, duplicate: 0, failed: 0 };
  for (const entry of batch) {
    if (entry.status === 'fertig') outcome.fresh += 1;
    else if (entry.status === 'dublette') {
      outcome.duplicate += 1;
      outcome.firstDuplicate ??= entry;
    } else if (entry.status === 'fehler') {
      outcome.failed += 1;
      outcome.firstFailure ??= entry;
    }
  }
  const kind = batch[0]?.kind ?? 'folien';
  const words = KIND_WORDS[kind];
  if (batch.length === 1) {
    if (outcome.fresh) return { message: words.added };
    if (outcome.duplicate) return { message: 'Schon vorhanden', open: outcome.firstDuplicate };
    return { message: outcome.firstFailure?.message ?? 'Das hat nicht geklappt.' };
  }
  const parts: string[] = [];
  if (outcome.fresh) {
    parts.push(`${outcome.fresh} ${outcome.fresh === 1 ? words.one : words.many} hinzugefügt`);
  }
  if (outcome.duplicate) parts.push(`${outcome.duplicate} schon vorhanden`);
  if (outcome.failed) parts.push(`${outcome.failed} nicht hochgeladen`);
  return {
    message: parts.join(' · '),
    open: outcome.fresh === 0 && outcome.duplicate === 1 ? outcome.firstDuplicate : undefined,
  };
}

/**
 * Upload-Warteschlange (F-ORG-02/03) und Drag & Drop über das ganze Fenster. Die Dateien laufen nacheinander
 * (ruhig, Reihenfolge stabil) und gehören der App, nicht der Seite: Wer während des Hochladens das Modul
 * wechselt, verliert nichts.
 */
export function UploadProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const toast = useToast();
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const entriesRef = useRef<UploadEntry[]>([]);
  const target = useRef<UploadTarget | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const openers = useRef(new Map<string, UploadTarget['open']>());

  const commit = useCallback((next: UploadEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const patch = useCallback(
    (id: string, change: Partial<UploadEntry>) =>
      commit(entriesRef.current.map((e) => (e.id === id ? { ...e, ...change } : e))),
    [commit],
  );

  const finishBatch = useCallback(
    (batch: string) => {
      const group = entriesRef.current.filter((e) => e.batch === batch);
      if (group.some((e) => e.status === 'wartet' || e.status === 'laeuft')) return;
      const { message, open } = summarize(group);
      const open_ = openers.current.get(batch);
      const opener = open && open.resultId && open_ ? () => open_(open.kind, open.resultId as string) : null;
      toast.show({
        message,
        ...(opener ? { actionLabel: 'Anzeigen', onAction: opener } : {}),
      });
      // Fertige Einträge verschwinden aus der Fortschrittsliste (die Liste des Moduls zeigt sie jetzt);
      // Fehler bleiben stehen, bis man sie schließt.
      commit(entriesRef.current.filter((e) => e.batch !== batch || e.status === 'fehler'));
      if (!entriesRef.current.some((e) => e.batch === batch)) openers.current.delete(batch);
    },
    [commit, toast],
  );

  const run = useCallback(
    async (id: string) => {
      const entry = entriesRef.current.find((e) => e.id === id);
      if (!entry || entry.status === 'fertig' || entry.status === 'dublette') return;
      patch(id, { status: 'laeuft', message: undefined, retryable: undefined });
      try {
        const fields: Record<string, string> = { module_id: entry.moduleId };
        const result = await apiUpload(collectionPath(entry.kind), UploadResultSchema, {
          file: entry.file,
          fields,
          idempotencyKey: entry.key,
        });
        await invalidateMaterial(client);
        patch(id, { status: result.duplicate ? 'dublette' : 'fertig', resultId: result.id });
      } catch (failure) {
        const retryable =
          failure instanceof ApiRequestError &&
          (failure.kind === 'unreachable' || (failure.status !== null && failure.status >= 500));
        patch(id, {
          status: 'fehler',
          retryable,
          message:
            failure instanceof ApiRequestError && failure.kind === 'unreachable'
              ? 'Core nicht erreichbar. Versuch es noch einmal, sobald er läuft.'
              : friendlyMessage(failure),
        });
      }
      finishBatch(entry.batch);
    },
    [client, finishBatch, patch],
  );

  const enqueue = useCallback<UploadApi['enqueue']>(
    (files, to) => {
      if (files.length === 0) return;
      const batch = uuidv7();
      openers.current.set(batch, to.open);
      const created: UploadEntry[] = files.map((file) => ({
        id: uuidv7(),
        key: globalThis.crypto.randomUUID(),
        file,
        moduleId: to.moduleId,
        kind: to.kind,
        batch,
        status: looksLikePdf(file) ? 'wartet' : 'fehler',
        ...(looksLikePdf(file) ? {} : { message: 'Das ist kein PDF. Wähle eine PDF-Datei.' }),
      }));
      commit([...entriesRef.current, ...created]);
      let queued = false;
      for (const entry of created) {
        if (entry.status !== 'wartet') continue;
        queued = true;
        chain.current = chain.current.then(() => run(entry.id));
      }
      if (!queued) finishBatch(batch);
    },
    [commit, finishBatch, run],
  );

  const retry = useCallback(
    (id: string) => {
      const entry = entriesRef.current.find((e) => e.id === id);
      if (!entry || entry.status !== 'fehler') return;
      // Eigener Stapel für das Wiederholen, damit genau dieser Versuch einen Toast bekommt. Der Schlüssel bleibt.
      const batch = uuidv7();
      const original = openers.current.get(entry.batch);
      if (original) openers.current.set(batch, original);
      patch(id, { status: 'wartet', batch, message: undefined });
      chain.current = chain.current.then(() => run(id));
    },
    [patch, run],
  );

  const dismiss = useCallback(
    (id: string) => commit(entriesRef.current.filter((e) => e.id !== id)),
    [commit],
  );

  const registerTarget = useCallback((next: UploadTarget | null) => {
    target.current = next;
  }, []);

  // Drag & Drop über das ganze Fenster (F-ORG-02: „irgendwo ins Fenster“)
  useEffect(() => {
    let depth = 0;
    const onEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth += 1;
      setDragging(true);
    };
    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // Sonst öffnet der Browser das PDF in einem Tab
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      const current = target.current;
      if (!current) {
        toast.show({ message: 'Öffne zuerst ein Modul, dann zieh die PDFs dorthin.' });
        return;
      }
      if (!current.kind) {
        toast.show({ message: 'Wechsle zum Tab Vorlesungen oder Übungen, dann zieh die PDFs hinein.' });
        return;
      }
      enqueue(files, { moduleId: current.moduleId, kind: current.kind, open: current.open });
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [enqueue, toast]);

  const api = useMemo<UploadApi>(
    () => ({ entries, dragging, enqueue, retry, dismiss, registerTarget }),
    [entries, dragging, enqueue, retry, dismiss, registerTarget],
  );
  return <UploadContext.Provider value={api}>{children}</UploadContext.Provider>;
}

export function useUploads(): UploadApi {
  const api = useContext(UploadContext);
  if (!api) throw new Error('useUploads braucht einen UploadProvider');
  return api;
}

/** Meldet die offene Modulseite als Ziel für Dateien, die irgendwo ins Fenster fallen. */
export function useUploadTarget(target: UploadTarget | null): void {
  const { registerTarget } = useUploads();
  const moduleId = target?.moduleId ?? null;
  const kind = target?.kind ?? null;
  const open = target?.open;
  useEffect(() => {
    registerTarget(moduleId && open ? { moduleId, kind, open } : null);
    return () => registerTarget(null);
  }, [registerTarget, moduleId, kind, open]);
}
