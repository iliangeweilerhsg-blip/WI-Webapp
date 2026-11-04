// ICS auflösen mit hartem Zeitbudget (VERTRAEGE §8). `parseIcs` läuft in einem Worker-Thread, der bei Überschreiten
// beendet wird. Nur so lässt sich auch eine Regel abbrechen, die innerhalb von ical.js nicht zurückkehrt.
import { Worker } from 'node:worker_threads';
import {
  DEFAULT_DEADLINE_MS,
  IcsParseError,
  IcsTooComplexError,
  type ParseOptions,
  type ParseResult,
} from './calendar-ics.ts';

/** Zeit über das Budget hinaus, bis der Worker hart beendet wird (er prüft das Budget selbst bei jedem Schritt) */
const GRACE_MS = 500;

type Message =
  { ok: true; result: ParseResult } | { ok: false; kind: 'invalid' | 'complex' | 'error'; message: string };

/** Wie `parseIcs`, aber mit hartem Limit. Wirft `IcsParseError` und `IcsTooComplexError`. */
export function parseIcsIsolated(text: string, options: ParseOptions): Promise<ParseResult> {
  const budget = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  return new Promise<ParseResult>((resolve, reject) => {
    const worker = new Worker(new URL('./calendar-ics-worker.ts', import.meta.url), {
      workerData: { text, options },
    });
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      action();
    };
    const timer = setTimeout(() => finish(() => reject(new IcsTooComplexError())), budget + GRACE_MS);
    worker.once('message', (message: Message) =>
      finish(() => {
        if (message.ok) resolve(message.result);
        else if (message.kind === 'invalid') reject(new IcsParseError(message.message));
        else if (message.kind === 'complex') reject(new IcsTooComplexError(message.message));
        else reject(new Error(message.message));
      }),
    );
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) =>
      finish(() => reject(new Error(`Der Auflöse-Thread wurde unerwartet beendet (Code ${code}).`))),
    );
  });
}
