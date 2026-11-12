'use client';
// Beginn der Pause einer Session, einmal gemessen und von Statusleiste und Aufnahme-Leiste gemeinsam gelesen.
import { useEffect, useRef, useState } from 'react';
import type { Session } from '@sg/shared';

const pausedKey = (id: string) => `sg.session.pausedSince.${id}`;

function readPaused(id: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(pausedKey(id));
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writePaused(id: string, value: number | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(pausedKey(id));
    else window.sessionStorage.setItem(pausedKey(id), String(value));
  } catch {
    // Speicher gesperrt: die Anzeige gilt dann nur bis zum Neuladen
  }
}

/**
 * Seit wann ist die Session pausiert (ms seit Epoche)? Der Core kennt die Pause nicht als Zeitraum (kein `paused_at`).
 * Beginn der Pause ist `updated_at` der ERSTEN Fassung mit `pausiert`, die dieser Tab sieht: Der Wechsel nach
 * `pausiert` setzt `updated_at`. So zählt auch ein Folge-Tab oder eine Pause vom iPad richtig, obwohl der Tab sie erst
 * später bemerkt. `Date.now()` gilt nur, wenn `updated_at` fehlt oder nicht lesbar ist. Der Wert steht je Tab in
 * `sessionStorage` (überlebt das Neuladen); in anderen Zuständen entfällt der Eintrag.
 */
export function usePausedSince(session: Session | undefined): number | null {
  const id = session?.id ?? null;
  const paused = session?.state === 'pausiert';
  const updatedAtRef = useRef(session?.updated_at ?? null);
  updatedAtRef.current = session?.updated_at ?? null;
  const [since, setSince] = useState<number | null>(null);
  useEffect(() => {
    if (id === null) return;
    if (!paused) {
      writePaused(id, null);
      setSince(null);
      return;
    }
    let value = readPaused(id);
    if (value === null) {
      const parsed = updatedAtRef.current ? Date.parse(updatedAtRef.current) : NaN;
      value = Number.isFinite(parsed) ? parsed : Date.now();
      writePaused(id, value);
    }
    setSince(value);
  }, [id, paused]);
  return paused ? since : null;
}
