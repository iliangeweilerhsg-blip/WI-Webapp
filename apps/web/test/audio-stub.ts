// jsdom spielt kein Audio ab (`play`/`pause` werfen „not implemented“, `currentTime` bleibt 0). Dieser Stub macht
// `<audio>` für Tests steuerbar: `currentTime` ist beschreibbar, `play`/`pause` setzen `paused` und senden die Ereignisse.
import { vi } from 'vitest';

export interface AudioStub {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  /** Alle `play`-Aufrufe als `{ id, at }` (Aufnahme-ID, `currentTime` beim Start) */
  started: { id: string | null; at: number; rate: number }[];
  load: ReturnType<typeof vi.fn>;
  /** Aufnahme-IDs, deren Datei nicht lädt: `play()` endet mit `error` und lehnt ab, bis sie wieder da ist */
  unavailable: Set<string>;
  /** Solange true, sendet `play()` nur `play`, nicht `playing` (die Wiedergabe hängt noch im Laden) */
  stall: { value: boolean };
  restore: () => void;
}

type MediaState = { _ct?: number; _paused?: boolean; _rate?: number; _error?: object | null };

export function installAudioStub(): AudioStub {
  const proto = HTMLMediaElement.prototype;
  const original = {
    play: proto.play,
    pause: proto.pause,
    ct: Object.getOwnPropertyDescriptor(proto, 'currentTime'),
    paused: Object.getOwnPropertyDescriptor(proto, 'paused'),
    rate: Object.getOwnPropertyDescriptor(proto, 'playbackRate'),
  };
  const started: AudioStub['started'] = [];
  const unavailable = new Set<string>();
  const stall = { value: false };
  const load = vi.fn(function (this: HTMLMediaElement & MediaState) {
    this._error = null;
  });
  const play = vi.fn(function (this: HTMLMediaElement & MediaState) {
    const id = this.getAttribute('data-recording');
    // Wie im Browser: Im Fehlerzustand (`error` gesetzt) lädt `play()` nichts nach und lehnt ab
    if (this._error)
      return Promise.reject(Object.assign(new Error('nicht unterstützt'), { name: 'NotSupportedError' }));
    if (id && unavailable.has(id)) {
      this._error = { code: 4 };
      this.dispatchEvent(new Event('error'));
      return Promise.reject(Object.assign(new Error('nicht unterstützt'), { name: 'NotSupportedError' }));
    }
    this._paused = false;
    started.push({ id: this.getAttribute('data-recording'), at: this._ct ?? 0, rate: this._rate ?? 1 });
    this.dispatchEvent(new Event('play'));
    if (!stall.value) this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  });
  const pause = vi.fn(function (this: HTMLMediaElement & MediaState) {
    if (this._paused === false) {
      this._paused = true;
      this.dispatchEvent(new Event('pause'));
    }
  });
  proto.play = play as unknown as typeof proto.play;
  proto.pause = pause as unknown as typeof proto.pause;
  const originalLoad = proto.load;
  proto.load = load as unknown as typeof proto.load;
  Object.defineProperty(proto, 'error', {
    configurable: true,
    get(this: MediaState) {
      return this._error ?? null;
    },
  });
  Object.defineProperty(proto, 'currentTime', {
    configurable: true,
    get(this: MediaState) {
      return this._ct ?? 0;
    },
    set(this: MediaState, value: number) {
      this._ct = value;
    },
  });
  Object.defineProperty(proto, 'paused', {
    configurable: true,
    get(this: MediaState) {
      return this._paused ?? true;
    },
  });
  Object.defineProperty(proto, 'playbackRate', {
    configurable: true,
    get(this: MediaState) {
      return this._rate ?? 1;
    },
    set(this: MediaState, value: number) {
      this._rate = value;
    },
  });
  return {
    play,
    pause,
    started,
    load,
    unavailable,
    stall,
    restore() {
      proto.load = originalLoad;
      delete (proto as unknown as Record<string, unknown>).error;
      proto.play = original.play;
      proto.pause = original.pause;
      for (const [name, d] of [
        ['currentTime', original.ct],
        ['paused', original.paused],
        ['playbackRate', original.rate],
      ] as const) {
        if (d) Object.defineProperty(proto, name, d);
        else delete (proto as unknown as Record<string, unknown>)[name];
      }
    },
  };
}
