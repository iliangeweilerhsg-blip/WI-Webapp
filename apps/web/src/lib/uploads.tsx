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
import {
  KIND_WORDS,
  POLL_INTERVAL_MS,
  cachedMaterialTitle,
  collectionPath,
  fetchIngest,
  invalidateMaterial,
  titleFromFile,
  unscheduleMaterialDelete,
  pendingDeleteMessage,
  type MaterialKind,
} from './material.ts';
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
  /** Die Datei war zum Löschen vorgemerkt (Rückgängig-Fenster) und ist wieder da: Titel des Eintrags */
  restoredTitle?: string;
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

/** So lange wird ein Eintrag nach dem Hochladen beobachtet (Einlesen dauert selten länger) */
const WATCH_MAX_MS = 10 * 60_000;
const WATCH_MAX_DELAY_MS = 10_000;

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
  restored: number;
  firstDuplicate?: UploadEntry;
  firstFailure?: UploadEntry;
}

function summarize(batch: readonly UploadEntry[]): { message: string; open?: UploadEntry } {
  const outcome: Outcome = { fresh: 0, duplicate: 0, failed: 0, restored: 0 };
  for (const entry of batch) {
    if (entry.status === 'fertig') outcome.fresh += 1;
    else if (entry.status === 'dublette' && entry.restoredTitle !== undefined) outcome.restored += 1;
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
    if (outcome.restored) return { message: `„${batch[0]?.restoredTitle}“ ist wieder da.` };
    if (outcome.fresh) return { message: words.added };
    if (outcome.duplicate) return { message: 'Schon vorhanden', open: outcome.firstDuplicate };
    return { message: outcome.firstFailure?.message ?? 'Das hat nicht geklappt.' };
  }
  const parts: string[] = [];
  if (outcome.fresh) {
    parts.push(`${outcome.fresh} ${outcome.fresh === 1 ? words.one : words.many} hinzugefügt`);
  }
  if (outcome.restored) parts.push(`${outcome.restored} wieder da`);
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
      // „Ist wieder da“ geht in den noch offenen „Rückgängig“-Toast, statt hinter ihm bis zu seinem Ablauf zu warten
      const rest = pendingDeleteMessage();
      const allRestored = group.every((e) => e.status === 'dublette' && e.restoredTitle !== undefined);
      const merged = allRestored && rest !== null && toast.amend('material-delete', `${rest} · ${message}`);
      if (!merged)
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

  // Frisch hochgeladene Einträge im Blick behalten, bis das Einlesen durch ist: Scheitert es (`neu` → `fehler`),
  // sagt ein ruhiger Toast es, auch wenn man inzwischen woanders ist. Die Datei bleibt gespeichert.
  const watched = useRef(new Map<string, { kind: MaterialKind; since: number }>());
  const watchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const polling = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (watchTimer.current) clearTimeout(watchTimer.current);
      watchTimer.current = null;
    };
  }, []);

  const rounds = useRef(0);
  /** Pausen zwischen den Runden werden länger (2 s → höchstens 10 s), das Einlesen dauert meist nur Sekunden */
  const nextDelay = useCallback(
    () => Math.min(WATCH_MAX_DELAY_MS, POLL_INTERVAL_MS * 1.5 ** rounds.current++),
    [],
  );

  const pollWatched = useCallback(async () => {
    watchTimer.current = null;
    polling.current = true;
    const failed: MaterialKind[] = [];
    let failedTitle = '';
    for (const [id, { kind, since }] of [...watched.current]) {
      try {
        const { state, title } = await fetchIngest(client, kind, id);
        if (state === 'neu') {
          if (Date.now() - since > WATCH_MAX_MS) watched.current.delete(id);
          continue;
        }
        watched.current.delete(id);
        void invalidateMaterial(client);
        if (state === 'fehler') {
          failed.push(kind);
          failedTitle = title;
        }
      } catch (failure) {
        // Gelöscht (404): nichts mehr zu beobachten. Sonst Core gerade nicht erreichbar: nach Ablauf der Frist aufgeben
        const gone = failure instanceof ApiRequestError && failure.status === 404;
        if (gone || Date.now() - since > WATCH_MAX_MS) watched.current.delete(id);
      }
    }
    polling.current = false;
    // Mehrere Fehler derselben Runde teilen sich einen Toast (der neueste würde sonst die anderen ersetzen)
    if (failed.length > 0 && alive.current) {
      const one = failed.length === 1;
      const sameKind = failed.every((k) => k === failed[0]);
      const noun = sameKind ? KIND_WORDS[failed[0] ?? 'folien'].many : 'Dateien';
      toast.show({
        message: one
          ? `„${failedTitle}“ ließ sich nicht lesen. Die Datei ist gespeichert.`
          : `${failed.length} ${noun} ließen sich nicht lesen. Die Dateien sind gespeichert.`,
      });
    }
    if (alive.current && watched.current.size > 0) {
      watchTimer.current = setTimeout(() => void pollWatched(), nextDelay());
    }
  }, [client, toast, nextDelay]);

  const watchIngest = useCallback(
    (kind: MaterialKind, id: string) => {
      watched.current.set(id, { kind, since: Date.now() });
      // Ein neuer Eintrag setzt die Pausen auf 2 s zurück (sonst wartet er auf eine Runde mit 10 s Abstand)
      rounds.current = 0;
      // Läuft gerade eine Runde, plant sie die nächste selbst (mit der zurückgesetzten Pause)
      if (!polling.current) {
        if (watchTimer.current) clearTimeout(watchTimer.current);
        watchTimer.current = setTimeout(() => void pollWatched(), nextDelay());
      }
    },
    [pollWatched, nextDelay],
  );

  const run = useCallback(
    async (id: string) => {
      const entry = entriesRef.current.find((e) => e.id === id);
      if (!entry || entry.status === 'fertig' || entry.status === 'dublette') return;
      patch(id, { status: 'laeuft', message: undefined, retryable: undefined });
      try {
        const fields: Record<string, string> = { module_id: entry.moduleId };
        // Lesbarer Titel statt Dateiname: „Mikro_Vorlesung_70.pdf“ → „Mikro Vorlesung 70“
        const title = titleFromFile(entry.file.name);
        if (title) fields.title = title;
        const result = await apiUpload(collectionPath(entry.kind), UploadResultSchema, {
          file: entry.file,
          fields,
          idempotencyKey: entry.key,
        });
        // Dieselbe Datei im Rückgängig-Fenster erneut hochgeladen: Die Dublette ist die vorgemerkte Löschung.
        // Sie wird zurückgenommen, sonst ginge das DELETE später raus und „Anzeigen“ zeigte auf ein gelöschtes Blatt.
        const restoredTitle =
          result.duplicate && unscheduleMaterialDelete(entry.kind, result.id)
            ? (cachedMaterialTitle(client, entry.kind, entry.moduleId, result.id) ??
              titleFromFile(entry.file.name))
            : undefined;
        if (restoredTitle !== undefined) {
          const rest = pendingDeleteMessage();
          // Letzte Löschung zurückgenommen: Toast weg. Sonst die Zahl im Rest-Toast nachziehen (Timer und Fokus bleiben).
          if (rest === null) toast.dismissGroup('material-delete');
          else toast.amend('material-delete', rest);
        }
        await invalidateMaterial(client);
        patch(id, {
          status: result.duplicate ? 'dublette' : 'fertig',
          resultId: result.id,
          ...(restoredTitle !== undefined ? { restoredTitle } : {}),
        });
        if (!result.duplicate) watchIngest(entry.kind, result.id);
      } catch (failure) {
        const retryable =
          failure instanceof ApiRequestError &&
          (failure.kind === 'unreachable' ||
            // 409: Derselbe Schlüssel ist noch in Arbeit (erster Versuch lief weiter), später gleicher Key
            failure.status === 409 ||
            (failure.status !== null && failure.status >= 500));
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
    [client, finishBatch, patch, watchIngest, toast],
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
