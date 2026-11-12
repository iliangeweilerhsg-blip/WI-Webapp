'use client';

// Aufnahme an der App-Shell (Issue #210 Teil 3, Plan docs/plaene/210-AUFNAHME-APPSHELL.md): ein Recorder und ein
// Auto-Stopp je Tab, die der AKTIVEN Session folgen (VERTRAEGE §11.8). Die Logik stammt aus dem früheren
// `useSessionRecording` (Issue #106, F-AUD-01/-02) und ist nur umgezogen: Nur der Sync-Leader-Tab nimmt auf, die Pegel
// gehen über `subscribeAudioLevel` an den Auto-Stopp (T1-07). Der Browser-Dialog für das Mikrofon öffnet sich nur nach
// einer Nutzeraktion („Aufnahme starten“) oder wenn die Berechtigung schon erteilt ist.
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Session } from '@sg/shared';
import {
  useAutoStop,
  type AutoStopApi,
  type AutoStopControllerOptions,
  type UseAutoStopResult,
} from '../autostop';
import {
  AudioRecorder,
  LeaderRecording,
  createWebLocksRecordingLock,
  hasMicIntent,
  isLeaderState,
  notifyUploadsPending,
  useConnectionState,
  type AcquireRecordingLock,
  type RecorderOptions,
  type RecorderStatus,
} from '../recorder';
import { applyActiveSession, extendSession, getSession, stopSession } from '../sessions.ts';
import { useSettings } from '../settings.ts';
import { useSyncClient } from '../sync/SyncProvider.tsx';
import { usePausedSince } from './paused-since.ts';
import { useTrackedSessionState, type TrackedPhase } from './tracked-session.ts';

/**
 * Schalter für Teil 2 (Plan E11): Solange er gilt, wird nur aufgenommen und automatisch gestoppt, wenn das Dashboard
 * der verfolgten Session offen ist (altes Verhalten). Teil 3 löscht ihn.
 */
const ROUTE_GATE = true;

/** Anzeige-Zustand der Aufnahme */
export type RecordingKind =
  | 'rec' // nimmt auf
  | 'starting' // Mikrofon wird geöffnet
  | 'waiting' // wartet darauf, dass der bisherige Aufnahme-Tab fertig wird
  | 'paused' // Session pausiert
  | 'needs-start' // Nutzeraktion nötig, um das Mikrofon zu öffnen
  | 'mic-denied'
  | 'mic-missing'
  | 'error'
  | 'other-tab' // Folge-Tab: der Leader nimmt auf
  | 'inactive'; // Session ist nicht aktiv

type Permission = 'granted' | 'denied' | 'prompt' | 'unknown';

/** Nur für Tests: gefälschte Browser-Schnittstellen */
export interface RecordingEnv {
  recorder?: Partial<RecorderOptions>;
  acquireLock?: AcquireRecordingLock;
  /** Standard: `navigator.permissions.query({ name: 'microphone' })` */
  permission?: () => Promise<Permission>;
  /** Nach so vielen ms Warten auf die Aufnahme-Sperre erscheint der Hinweis (Standard 1500) */
  waitHintMs?: number;
  /** So lange lädt der Wechsel der Session höchstens noch hoch, bevor der Rest dem app-weiten Uploader bleibt (Standard 8000) */
  flushMs?: number;
  /** Nur für Tests: Uhr, REST und Pegelquelle des Auto-Stopps */
  autoStop?: Pick<AutoStopControllerOptions, 'api' | 'now' | 'voice' | 'subscribeLevel'>;
}

export interface RecordingView {
  /** Verfolgte Session; `null`, solange es nie eine aktive gab */
  sessionId: string | null;
  session: Session | null;
  phase: TrackedPhase;
  kind: RecordingKind;
  /** Erklärung zum Zustand (verständlich, deutsch) */
  message: string | null;
  status: RecorderStatus;
  /** „Aufnahme starten“ bzw. „Erneut versuchen“. Setzt die Tab-Erlaubnis (E6). */
  start: () => void;
  /** Beginn der Pause in Epochen-ms, sonst `null` */
  pausedSince: number | null;
  autoStop: UseAutoStopResult;
  /** `lecture.auto_stop_extend_min`, Standard 15 */
  extendMinutes: number;
  /** Ein Dashboard zeigt die verfolgte Session: Die Leiste bleibt weg */
  shownByDashboard: boolean;
}

const IDLE_STATUS: RecorderStatus = {
  state: 'idle',
  recordingId: null,
  chunkCount: 0,
  recordedMs: 0,
  restarts: 0,
  tabHidden: false,
  wakeLock: 'inactive',
  upload: { pendingChunks: 0, shelvedChunks: 0, offline: false, retryInMs: null },
  error: null,
  micIssue: null,
};
const IDLE_AUTO: UseAutoStopResult = {
  status: { state: 'inaktiv' },
  extending: false,
  extendError: null,
  stopping: false,
  stopError: null,
  extend: async () => undefined,
};
const DEFAULT_EXTEND_MINUTES = 15;

const INACTIVE_VIEW: RecordingView = {
  sessionId: null,
  session: null,
  phase: 'andere',
  kind: 'inactive',
  message: null,
  status: IDLE_STATUS,
  start: () => undefined,
  pausedSince: null,
  autoStop: IDLE_AUTO,
  extendMinutes: DEFAULT_EXTEND_MINUTES,
  shownByDashboard: false,
};
const STARTING_VIEW: RecordingView = { ...INACTIVE_VIEW, kind: 'starting' };

const noopSubscribe = () => () => undefined;

interface ViewContextValue {
  view: RecordingView;
  /** Die Abfrage der aktiven Session hat noch keine Antwort */
  pending: boolean;
}
interface ActionsContextValue {
  claim: (sessionId: string) => () => void;
  noteIntent: () => void;
}
const ViewContext = createContext<ViewContextValue>({ view: INACTIVE_VIEW, pending: false });
const ActionsContext = createContext<ActionsContextValue>({
  claim: () => () => undefined,
  noteIntent: () => undefined,
});

/** Ohne Provider: ein fester, untätiger Stand (`kind: 'inactive'`). Komponenten laufen so auch ohne Shell. */
export function useRecordingView(): RecordingView {
  return useContext(ViewContext).view;
}

/**
 * Wie `useRecordingView`, aber untätig (`kind: 'inactive'`), wenn `sessionId` nicht die verfolgte Session ist.
 * Ausnahme: Solange die aktive Session noch lädt, liefert sie `kind: 'starting'`. Sonst stünde in der Statusleiste
 * einer laufenden Session kurz „Nicht gestartet“.
 */
export function useRecordingFor(sessionId: string): RecordingView {
  const { view, pending } = useContext(ViewContext);
  if (view.sessionId === sessionId) return view;
  return pending && view.sessionId === null ? STARTING_VIEW : INACTIVE_VIEW;
}

/** Das Dashboard meldet: „Ich zeige diese Session.“ (meldet sich beim Unmount ab) */
export function useClaimRecordingDisplay(sessionId: string | null): void {
  const { claim } = useContext(ActionsContext);
  // Vor dem Zeichnen, sonst blitzt die Leiste beim Öffnen des Dashboards einen Frame lang auf
  useLayoutEffect(() => (sessionId === null ? undefined : claim(sessionId)), [claim, sessionId]);
}

/** Vermerkt eine Nutzeraktion als Tab-Erlaubnis, ohne etwas zu starten (für „Hier übernehmen“). */
export function useNoteRecordingIntent(): () => void {
  return useContext(ActionsContext).noteIntent;
}

function usePermission(query: RecordingEnv['permission']): Permission {
  const [permission, setPermission] = useState<Permission>('unknown');
  useEffect(() => {
    let alive = true;
    let status: PermissionStatus | null = null;
    const onChange = () => {
      if (status && alive) setPermission(status.state as Permission);
    };
    const read =
      query ??
      (async (): Promise<Permission> => {
        const perms = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
        if (!perms) return 'unknown';
        status = await perms.query({ name: 'microphone' as PermissionName });
        status.addEventListener('change', onChange);
        return status.state as Permission;
      });
    read().then(
      (p) => {
        if (alive) setPermission(p);
      },
      () => undefined, // Safari kennt die Abfrage für das Mikrofon nicht: dann ist eine Nutzeraktion nötig
    );
    return () => {
      alive = false;
      status?.removeEventListener('change', onChange);
    };
  }, [query]);
  return permission;
}

const MESSAGES = {
  denied:
    'Zugriff auf das Mikrofon verweigert. Die Session läuft weiter, Notizen gehen. Erlaube das Mikrofon in den Browser-Einstellungen.',
  missing: 'Kein Mikrofon gefunden. Die Session läuft weiter, Notizen gehen. Schließe ein Mikrofon an.',
  needsStart: 'Mikrofon noch nicht freigegeben. „Aufnahme starten“ öffnet die Browser-Abfrage.',
  otherTab: 'Die Aufnahme läuft in einem anderen Tab.',
  waiting:
    'Wartet auf den anderen Tab: Dort ist die Aufnahme noch offen (Mikrofon-Abfrage?). Schließe sie dort oder den Tab.',
};

const DEFAULT_AUTO_API: AutoStopApi = { stop: stopSession, extend: extendSession, get: getSession };

/** Antworten des Auto-Stopps gehen zusätzlich in den Cache der aktiven Session (kein Warten aufs Polling) */
function withCache(api: AutoStopApi, client: QueryClient): AutoStopApi {
  const { get: baseGet } = api;
  return {
    stop: async (...args) => {
      const session = await api.stop(...args);
      applyActiveSession(client, session);
      return session;
    },
    extend: async (...args) => {
      const session = await api.extend(...args);
      applyActiveSession(client, session);
      return session;
    },
    ...(baseGet
      ? {
          get: async (...args: Parameters<typeof getSession>) => {
            const session = await baseGet(...args);
            applyActiveSession(client, session);
            return session;
          },
        }
      : {}),
  };
}

interface AutoStopReport {
  auto: UseAutoStopResult;
  extendMinutes: number;
}
const IDLE_REPORT: AutoStopReport = { auto: IDLE_AUTO, extendMinutes: DEFAULT_EXTEND_MINUTES };

/**
 * Der Auto-Stopp-Controller (T1-07) der Shell. Wird nur gerendert, solange die Session läuft oder pausiert ist: So
 * lädt die Shell `GET /settings` nicht auf jeder Seite. Meldet seinen Stand an den Provider.
 */
const AutoStopHost = memo(function AutoStopHost({
  session,
  overrides,
  events,
  report,
}: {
  session: Session;
  overrides: RecordingEnv['autoStop'];
  events: ReturnType<typeof useSyncClient>;
  report: (value: AutoStopReport) => void;
}) {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const baseApi = overrides?.api ?? DEFAULT_AUTO_API;
  const api = useMemo(() => withCache(baseApi, queryClient), [baseApi, queryClient]);
  const lecture = settings.data?.lecture;
  const auto = useAutoStop({ ...overrides, api, session, lecture, events: events ?? undefined });
  const { status, extending, extendError, stopping, stopError, extend } = auto;
  const extendMinutes = lecture?.auto_stop_extend_min ?? DEFAULT_EXTEND_MINUTES;
  // Ein stabiler Wert, sonst meldet jedes Rendern einen „neuen“ Stand und die Shell rendert endlos
  const value = useMemo<AutoStopReport>(
    () => ({
      auto: { status, extending, extendError, stopping, stopError, extend },
      extendMinutes,
    }),
    [status, extending, extendError, stopping, stopError, extend, extendMinutes],
  );
  useEffect(() => report(value), [report, value]);
  // Beim Aushängen den Stand zurücksetzen: Ein neuer Host (andere Session) zeigt nie den alten Hinweis
  useEffect(() => () => report(IDLE_REPORT), [report]);
  return null;
});

/**
 * Hält den Recorder und den Auto-Stopp der Shell. Muss innerhalb von `QueryProvider` und `SyncProvider` liegen.
 * Der Kontextwert ist mit `useMemo` gebaut und `children` kommen als Prop: Die Seiten rendern bei einem neuen
 * Recorder-Stand nicht neu, nur wer den Kontext liest (Statusleiste).
 */
export function RecordingProvider({ children, env = {} }: { children: ReactNode; env?: RecordingEnv }) {
  const envRef = useRef(env);
  envRef.current = env;
  const sync = useSyncClient();
  const { tracked, pending } = useTrackedSessionState();
  const session = tracked?.session ?? null;
  const sessionId = session?.id ?? null;
  const startedAt = session?.started_at ? Date.parse(session.started_at) : null;
  const startedRef = useRef(startedAt);
  startedRef.current = startedAt;

  const connection = useConnectionState(sync);
  const leader = isLeaderState(connection);
  const permission = usePermission(env.permission);

  // Tab-Erlaubnis (E6): gilt für den Tab, nicht je Session, und überlebt kein Neuladen
  const [tabAllowed, setTabAllowed] = useState(false);
  const noteIntent = useCallback(() => setTabAllowed(true), []);
  useEffect(() => {
    // Startgeste kurz zuvor für DIESE Session (gelesen, nicht verbraucht: StrictMode)
    if (sessionId !== null && hasMicIntent(sessionId)) setTabAllowed(true);
  }, [sessionId]);

  // Welches Dashboard zeigt welche Session?
  const [claims, setClaims] = useState<readonly string[]>([]);
  const claim = useCallback((id: string) => {
    setClaims((c) => [...c, id]);
    return () =>
      setClaims((c) => {
        const i = c.indexOf(id);
        return i < 0 ? c : [...c.slice(0, i), ...c.slice(i + 1)];
      });
  }, []);
  const shownByDashboard = sessionId !== null && claims.includes(sessionId);

  // Beim Wechsel der Session wartet der neue Recorder, bis der alte gestoppt ist (auch ohne Web Locks, Plan §4.3)
  const previousStopped = useRef<Promise<void>>(Promise.resolve());
  const [parts, setParts] = useState<{
    sessionId: string;
    recorder: AudioRecorder;
    control: LeaderRecording;
  } | null>(null);

  useEffect(() => {
    if (sessionId === null) return;
    const e = envRef.current;
    const recorder = new AudioRecorder({
      ...e.recorder,
      // Hochladen darf nur der Leader (Issue #115); der Effekt unten schaltet es mit der Rolle ein
      uploadsEnabled: false,
      sessionId,
      sessionMs: () => Math.max(0, Date.now() - (startedRef.current ?? Date.now())),
    });
    const baseLock = e.acquireLock ?? createWebLocksRecordingLock();
    const waitFor = previousStopped.current;
    const control = new LeaderRecording({
      recorder,
      acquireLock: (signal) =>
        new Promise((resolve) => {
          let settled = false;
          const settle = (release: (() => void) | null) => {
            // Kommt die Sperre erst nach dem Abbruch, wird sie sofort wieder frei (sonst bliebe sie gehalten)
            if (settled) return release?.();
            settled = true;
            resolve(release);
          };
          if (signal.aborted) return settle(null);
          signal.addEventListener('abort', () => settle(null), { once: true });
          void waitFor
            .then(() => (signal.aborted ? null : baseLock(signal)))
            .then(settle, () => settle(null));
        }),
    });
    setParts({ sessionId, recorder, control });
    return () => {
      // Erst sauber beenden (letzter Chunk, `complete`), dann den Recorder entsorgen
      control.dispose();
      const stopped = control.idle();
      // Auch alle Vorgänger: Wartet dieser Recorder selbst noch (A → B → C), ist er schnell „gestoppt“, A aber nicht
      previousStopped.current = Promise.all([waitFor, stopped]).then(() => undefined);
      void stopped
        .then(() => recorder.flushUploads(envRef.current.flushMs ?? 8000))
        .then(() => {
          // Bleibt etwas liegen (Core weg, langer Rückstau), holt der app-weite Uploader des Leaders es ab. Die Nachricht
          // erreicht auch andere Instanzen im selben Tab.
          notifyUploadsPending();
        })
        .then(() => recorder.dispose());
      setParts(null);
    };
  }, [sessionId]);

  // Nur die Teile der aktuellen Session: Im Rendern direkt nach dem Wechsel stehen noch die alten (schon entsorgten)
  // im Zustand. Ein `set` auf sie würde den alten Recorder nach dem Stopp wieder starten.
  const current = parts !== null && parts.sessionId === sessionId ? parts : null;
  const recorder = current?.recorder ?? null;
  const control = current?.control ?? null;
  const status = useSyncExternalStore(
    recorder ? recorder.subscribe : noopSubscribe,
    () => recorder?.getStatus() ?? IDLE_STATUS,
    () => IDLE_STATUS,
  );

  // Soll-Zustand. Solange der Schalter gilt, zählt nur ein offenes Dashboard der Session: sonst stoppt der Recorder
  // (er wird nicht entsorgt, das Hochladen läuft im Leader weiter).
  const gated = ROUTE_GATE && !shownByDashboard;
  const phase: TrackedPhase = gated || !tracked ? 'andere' : tracked.phase;
  const allowed = tabAllowed || permission === 'granted';
  useEffect(() => {
    control?.set({ leader, phase, allowed });
  }, [control, leader, phase, allowed]);

  // Seite schließen oder neu laden, solange aufgenommen wird: der Browser fragt nach (UX-02). Wie weit er das zeigt,
  // entscheidet er selbst; der Handler ist nur die Bitte darum.
  const live = status.state === 'recording' || status.state === 'starting' || status.state === 'paused';
  useEffect(() => {
    if (!live) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [live]);

  // `pagehide` und verborgener Tab: Der Recorder gibt gepufferte Daten heraus (requestData), hier kommt die Meldung
  // „Chunks liegen bereit“. Beides nur nach Möglichkeit (VERTRAEGE §11.8).
  useEffect(() => {
    if (!live) return;
    const onPageHide = () => notifyUploadsPending();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') notifyUploadsPending();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [live]);

  // Nur der Leader lädt hoch. Wer die Rolle verliert, meldet nach dem Stopp, dass Chunks bereitliegen.
  const wasLeader = useRef(false);
  useEffect(() => {
    if (!recorder || !control) return;
    recorder.setUploading(leader);
    if (leader) {
      wasLeader.current = true;
      return;
    }
    if (!wasLeader.current) return;
    wasLeader.current = false;
    let alive = true;
    void control.idle().then(() => {
      if (alive) notifyUploadsPending();
    });
    return () => {
      alive = false;
    };
  }, [recorder, control, leader]);

  const waiting = useSyncExternalStore(
    control ? control.subscribe : noopSubscribe,
    () => control?.isWaiting() ?? false,
    () => false,
  );
  const [waitingLong, setWaitingLong] = useState(false);
  const waitHintMs = env.waitHintMs ?? 1500;
  useEffect(() => {
    if (!waiting) {
      setWaitingLong(false);
      return;
    }
    const timer = setTimeout(() => setWaitingLong(true), waitHintMs);
    return () => clearTimeout(timer);
  }, [waiting, waitHintMs]);

  const start = useCallback(() => {
    setTabAllowed(true);
    control?.retry();
  }, [control]);

  // Pausendauer (UX-07), einmal gemessen. Nach dem Ende zählt die Session nicht mehr als pausiert.
  const pausedInput = useMemo(
    () =>
      session === null
        ? undefined
        : tracked?.phase === 'andere' && session.state === 'pausiert'
          ? { ...session, state: 'beendet' as const }
          : session,
    [session, tracked?.phase],
  );
  const pausedSince = usePausedSince(pausedInput);

  // Auto-Stopp: der Host läuft nur bei laufender oder pausierter Session (und, solange der Schalter gilt, offenem Dashboard)
  const hostSession = tracked && phase !== 'andere' ? tracked.session : null;
  const [autoReport, setAutoReport] = useState<AutoStopReport>(IDLE_REPORT);
  const report = setAutoReport;
  const autoStop = hostSession ? autoReport.auto : IDLE_AUTO;
  const extendMinutes = hostSession ? autoReport.extendMinutes : DEFAULT_EXTEND_MINUTES;

  const decided = connection !== 'idle' && connection !== 'acquiring';
  let kind: RecordingKind;
  let message: string | null = null;
  if (phase === 'andere') kind = 'inactive';
  else if (phase === 'pausiert') kind = 'paused';
  else if (connection === 'other_tab') {
    kind = 'other-tab';
    message = MESSAGES.otherTab;
  } else if (!decided) kind = 'starting';
  else if (waitingLong && status.state !== 'recording') {
    kind = 'waiting';
    message = MESSAGES.waiting;
  } else if (status.state === 'recording') kind = 'rec';
  else if (status.state === 'error' || status.state === 'unsupported') {
    if (status.micIssue === 'denied') {
      kind = 'mic-denied';
      message = MESSAGES.denied;
    } else if (status.micIssue === 'missing') {
      kind = 'mic-missing';
      message = MESSAGES.missing;
    } else {
      kind = 'error';
      message = status.error;
    }
  } else if (permission === 'denied' && !tabAllowed) {
    kind = 'mic-denied';
    message = MESSAGES.denied;
  } else if (!allowed) {
    kind = 'needs-start';
    message = MESSAGES.needsStart;
  } else kind = 'starting';

  const trackedPhase = tracked?.phase ?? 'andere';
  const view = useMemo<RecordingView>(
    () => ({
      sessionId,
      session,
      phase: trackedPhase,
      kind,
      message,
      status,
      start,
      pausedSince,
      autoStop,
      extendMinutes,
      shownByDashboard,
    }),
    [
      sessionId,
      session,
      trackedPhase,
      kind,
      message,
      status,
      start,
      pausedSince,
      autoStop,
      extendMinutes,
      shownByDashboard,
    ],
  );
  const viewValue = useMemo<ViewContextValue>(() => ({ view, pending }), [view, pending]);
  const actions = useMemo<ActionsContextValue>(() => ({ claim, noteIntent }), [claim, noteIntent]);

  return (
    <ActionsContext.Provider value={actions}>
      <ViewContext.Provider value={viewValue}>
        {children}
        {hostSession ? (
          <AutoStopHost
            key={hostSession.id}
            session={hostSession}
            overrides={env.autoStop}
            events={sync}
            report={report}
          />
        ) : null}
      </ViewContext.Provider>
    </ActionsContext.Provider>
  );
}
