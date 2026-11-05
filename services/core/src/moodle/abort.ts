// Abbruch einer Antwort, wenn die Web-App die Verbindung schließt (GET /moodle/file, Issue #129).
import type { ServerResponse } from 'node:http';

export interface CloseAbort {
  /** Wird ausgelöst, wenn die Verbindung zu ist, bevor die Antwort fertig geschrieben war */
  signal: AbortSignal;
  /** Hört nicht mehr auf `close` (Erfolgsweg: Ab jetzt zerstört der Server den Stream selbst) */
  stop: () => void;
}

export function abortWhenClosed(raw: ServerResponse): CloseAbort {
  const controller = new AbortController();
  const onClose = () => {
    if (!raw.writableFinished) controller.abort();
  };
  raw.once('close', onClose);
  // War die Verbindung schon zu, bevor wir zuhörten, kommt kein `close` mehr
  if (raw.destroyed) controller.abort();
  return { signal: controller.signal, stop: () => raw.off('close', onClose) };
}
