// REST-Funktionen für Sessions (VERTRAEGE §7.2). Hier nur, was T1-07 braucht: Stopp und Verlängerung.
import { SessionSchema, type Session, type StopReason } from '@sg/shared';
import { apiSend } from './api.ts';

/** `POST /sessions/{id}/stop`. Ohne Grund gilt `manuell`. Gleicher Zielzustand ist kein Fehler (§9.1). */
export function stopSession(id: string, reason?: StopReason): Promise<Session> {
  return apiSend('POST', `/sessions/${id}/stop`, SessionSchema, {
    body: reason ? { reason } : {},
  });
}

/**
 * `POST /sessions/{id}/extend` (§9.4): `auto_stop_extended_until = max(jetzt, bisheriger Wert) + minutes`.
 * Ohne `minutes` nimmt der Core `lecture.auto_stop_extend_min`. 409 `session_not_active`, wenn die Session nicht läuft.
 */
export function extendSession(id: string, minutes?: number): Promise<Session> {
  return apiSend('POST', `/sessions/${id}/extend`, SessionSchema, {
    body: minutes === undefined ? {} : { minutes },
  });
}
