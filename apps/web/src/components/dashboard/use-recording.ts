'use client';

// Aufnahme im Live-Dashboard (Issue #106, F-AUD-01/-02): verdrahtet den Recorder (T1-06) mit der Session und der
// Leader-Rolle (VERTRAEGE §11.8). Nur der Sync-Leader-Tab nimmt auf; die Pegel gehen über `subscribeAudioLevel`
// an den Auto-Stopp (T1-07). Der Browser-Dialog für das Mikrofon öffnet sich nur nach einer Nutzeraktion
// („Aufnahme starten“) oder wenn die Berechtigung schon erteilt ist.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Session } from '@sg/shared';
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
} from '../../lib/recorder';
import type { SyncClient } from '../../lib/sync/client.ts';

/** Anzeige-Zustand der Aufnahme für die Statusleiste */
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

export interface RecordingView {
  kind: RecordingKind;
  /** Erklärung zum Zustand (verständlich, deutsch) */
  message: string | null;
  status: RecorderStatus;
  /** „Aufnahme starten“ bzw. „Erneut versuchen“ (Nutzeraktion) */
  start: () => void;
}

type Permission = 'granted' | 'denied' | 'prompt' | 'unknown';

/** Nur für Tests: gefälschte Browser-Schnittstellen */
export interface RecordingEnv {
  recorder?: Partial<RecorderOptions>;
  acquireLock?: AcquireRecordingLock;
  /** Standard: `navigator.permissions.query({ name: 'microphone' })` */
  permission?: () => Promise<Permission>;
  /** Nach so vielen ms Warten auf die Aufnahme-Sperre erscheint der Hinweis (Standard 1500) */
  waitHintMs?: number;
  /** So lange lädt der Unmount höchstens noch hoch, bevor der Rest dem app-weiten Uploader bleibt (Standard 8000) */
  flushMs?: number;
}
export const RecordingEnvContext = createContext<RecordingEnv>({});

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
const noopSubscribe = () => () => undefined;

export { isLeaderState };

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

/**
 * Eine Aufnahme je Session-Ansicht. Der Recorder entsteht im Effekt (StrictMode-fest) und wird beim Verlassen nach
 * dem sauberen Stopp entsorgt. `sessionMs` ist die Zeit seit `started_at`, die Pause bleibt so als Lücke erhalten.
 */
export function useSessionRecording(session: Session, client: SyncClient | null): RecordingView {
  const env = useContext(RecordingEnvContext);
  const envRef = useRef(env);
  envRef.current = env;
  const startedAt = session.started_at ? Date.parse(session.started_at) : null;
  const startedRef = useRef(startedAt);
  startedRef.current = startedAt;

  const connection = useConnectionState(client);
  const leader = isLeaderState(connection);
  const permission = usePermission(env.permission);
  const [userStarted, setUserStarted] = useState(() => hasMicIntent());
  const [parts, setParts] = useState<{ recorder: AudioRecorder; control: LeaderRecording } | null>(null);

  const sessionId = session.id;
  useEffect(() => {
    const e = envRef.current;
    const recorder = new AudioRecorder({
      ...e.recorder,
      // Hochladen darf nur der Leader (Issue #115); der Effekt unten schaltet es mit der Rolle ein
      uploadsEnabled: false,
      sessionId,
      sessionMs: () => Math.max(0, Date.now() - (startedRef.current ?? Date.now())),
    });
    const control = new LeaderRecording({
      recorder,
      acquireLock: e.acquireLock ?? createWebLocksRecordingLock(),
    });
    setParts({ recorder, control });
    return () => {
      // Erst sauber beenden (letzter Chunk, `complete`), dann den Recorder entsorgen
      control.dispose();
      void control
        .idle()
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

  const recorder = parts?.recorder ?? null;
  const control = parts?.control ?? null;
  const status = useSyncExternalStore(
    recorder ? recorder.subscribe : noopSubscribe,
    () => recorder?.getStatus() ?? IDLE_STATUS,
    () => IDLE_STATUS,
  );

  const phase = session.state === 'laeuft' ? 'laeuft' : session.state === 'pausiert' ? 'pausiert' : 'andere';
  const allowed = userStarted || permission === 'granted';
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
    setUserStarted(true);
    control?.retry();
  }, [control]);

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
  } else if (permission === 'denied' && !userStarted) {
    kind = 'mic-denied';
    message = MESSAGES.denied;
  } else if (!allowed) {
    kind = 'needs-start';
    message = MESSAGES.needsStart;
  } else kind = 'starting';

  return { kind, message, status, start };
}
