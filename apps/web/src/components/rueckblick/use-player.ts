'use client';

// Wiedergabe im Rückblick (VERTRAEGE §18.9): ein `<audio>` je Aufnahme, Position in der Datei = `t − started_ms`.
// `t` ist die Sitzungszeit in ms. Zwischen Aufnahmen springt der Player zum Beginn der nächsten. Geschwindigkeit 1–2×,
// ±15 s. Die `<audio>`-Elemente rendert der Aufrufer (`audioProps`), damit sie im DOM stehen und Tests sie erreichen.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Recording } from '@sg/shared';
import { locatePlayback, playableRecordings, timelineBounds } from '../../lib/transcript.ts';

export const SKIP_MS = 15_000;
export const RATES = [1, 1.25, 1.5, 1.75, 2] as const;

export interface Player {
  recordings: Recording[];
  /** Sitzungszeit der Abspielposition in ms */
  t: number;
  playing: boolean;
  rate: number;
  /** Eine Aufnahme ließ sich nicht laden oder abspielen */
  failed: boolean;
  bounds: { start: number; end: number } | null;
  /** Springt zu `t` (Sitzungszeit); mit `play` läuft die Wiedergabe von dort. Ohne Angabe bleibt es beim bisherigen Zustand. */
  seek: (t: number, play?: boolean) => void;
  toggle: () => void;
  skip: (deltaMs: number) => void;
  setRate: (rate: number) => void;
  audioProps: (recording: Recording) => {
    ref: (el: HTMLAudioElement | null) => void;
    onTimeUpdate: () => void;
    onEnded: () => void;
    onPlay: () => void;
    onPause: () => void;
    onError: () => void;
  };
}

export function usePlayer(allRecordings: readonly Recording[], initialT: number): Player {
  const recordings = useMemo(() => playableRecordings(allRecordings), [allRecordings]);
  const bounds = useMemo(() => timelineBounds(recordings), [recordings]);
  const elements = useRef(new Map<string, HTMLAudioElement>());
  const currentId = useRef<string | null>(null);
  const [t, setT] = useState(initialT);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const [failed, setFailed] = useState(false);

  // Zustand für Handler, die nicht bei jedem Rendern neu entstehen sollen
  const live = useRef({ recordings, rate, t, playing });
  live.current = { recordings, rate, t, playing };

  const startPlayback = useCallback((el: HTMLAudioElement) => {
    el.playbackRate = live.current.rate;
    try {
      const result = el.play() as Promise<void> | undefined;
      // Der Browser kann das Abspielen ablehnen (z. B. ohne vorherige Eingabe): dann bleibt die Wiedergabe aus
      result?.catch(() => setPlaying(false));
    } catch {
      setPlaying(false);
    }
  }, []);

  const seek = useCallback(
    (target: number, play?: boolean) => {
      const spot = locatePlayback(live.current.recordings, target);
      if (!spot) return;
      const wantPlay = play ?? live.current.playing;
      const el = elements.current.get(spot.recording.id);
      if (!el) return;
      for (const [id, other] of elements.current) {
        if (id !== spot.recording.id && !other.paused) other.pause();
      }
      currentId.current = spot.recording.id;
      el.currentTime = spot.offsetS;
      setT(spot.recording.started_ms + Math.round(spot.offsetS * 1000));
      if (wantPlay) {
        setPlaying(true);
        startPlayback(el);
      } else {
        el.pause();
        setPlaying(false);
      }
    },
    [startPlayback],
  );

  const toggle = useCallback(() => {
    if (live.current.playing) {
      const el = currentId.current ? elements.current.get(currentId.current) : undefined;
      el?.pause();
      setPlaying(false);
      return;
    }
    // Ohne laufende Aufnahme beginnt es bei der Position `t`
    seek(live.current.t, true);
  }, [seek]);

  const skip = useCallback(
    (deltaMs: number) => {
      const { recordings: list, t: now } = live.current;
      const edges = timelineBounds(list);
      if (!edges) return;
      seek(Math.min(Math.max(now + deltaMs, edges.start), edges.end));
    },
    [seek],
  );

  const setRate = useCallback((next: number) => {
    setRateState(next);
    for (const el of elements.current.values()) el.playbackRate = next;
  }, []);

  // Nach dem Verlassen der Ansicht darf nichts weiterlaufen
  useEffect(() => {
    const map = elements.current;
    return () => {
      for (const el of map.values()) el.pause();
    };
  }, []);

  const audioProps = useCallback(
    (recording: Recording) => ({
      ref: (el: HTMLAudioElement | null) => {
        if (el) elements.current.set(recording.id, el);
        else elements.current.delete(recording.id);
      },
      onTimeUpdate: () => {
        if (currentId.current !== recording.id) return;
        const el = elements.current.get(recording.id);
        if (el) setT(recording.started_ms + Math.round(el.currentTime * 1000));
      },
      onEnded: () => {
        if (currentId.current !== recording.id) return;
        const list = live.current.recordings;
        const next = list[list.findIndex((r) => r.id === recording.id) + 1];
        if (next) seek(next.started_ms, true);
        else setPlaying(false);
      },
      onPlay: () => {
        if (currentId.current === recording.id) setPlaying(true);
      },
      onPause: () => {
        // `pause` feuert auch am Dateiende; dort entscheidet `onEnded`
        const el = elements.current.get(recording.id);
        if (currentId.current === recording.id && !el?.ended) setPlaying(false);
      },
      onError: () => setFailed(true),
    }),
    [seek],
  );

  return { recordings, t, playing, rate, failed, bounds, seek, toggle, skip, setRate, audioProps };
}
