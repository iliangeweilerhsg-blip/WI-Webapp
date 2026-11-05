// ICS auflösen mit hartem Zeitbudget (VERTRAEGE §8). `parseIcs` läuft in einem Worker-Thread, der bei Überschreiten
// beendet wird. Nur so lässt sich auch eine Regel abbrechen, die innerhalb von ical.js nicht zurückkehrt.
//
// Begrenzung: höchstens {@link MAX_PARALLEL_WORKERS} Worker gleichzeitig, weitere Aufrufe warten in einer Schlange.
// Das Zeitbudget läuft erst ab dem Start des Workers. Jeder Worker darf höchstens 256 MB Heap belegen
// (20 parallele 5-MB-Dateien belegten sonst fast 3 GB).
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
export const MAX_PARALLEL_WORKERS = 2;
export const WORKER_HEAP_MB = 256;

type Message =
  { ok: true; result: ParseResult } | { ok: false; kind: 'invalid' | 'complex' | 'error'; message: string };

// Semaphor mit Warteschlange
let running = 0;
const queue: (() => void)[] = [];

function acquire(): Promise<void> {
  if (running < MAX_PARALLEL_WORKERS) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => queue.push(resolve));
}

function release(): void {
  const next = queue.shift();
  // Der Platz geht direkt an den nächsten Wartenden
  if (next) next();
  else running -= 1;
}

/** Anzahl laufender und wartender Aufrufe (für Tests) */
export function parseLoad(): { running: number; waiting: number } {
  return { running, waiting: queue.length };
}

function runWorker(text: string, options: ParseOptions): Promise<ParseResult> {
  const budget = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  return new Promise<ParseResult>((resolve, reject) => {
    const worker = new Worker(new URL('./calendar-ics-worker.ts', import.meta.url), {
      workerData: { text, options },
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
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
    worker.once('error', (error) =>
      finish(() => {
        // Der Heap-Deckel ist erreicht: die Datei ist zu groß für das Auflösen
        if ((error as { code?: string }).code === 'ERR_WORKER_OUT_OF_MEMORY')
          reject(new IcsTooComplexError());
        else reject(error);
      }),
    );
    worker.once('exit', (code) =>
      finish(() => reject(new Error(`Der Auflöse-Thread wurde unerwartet beendet (Code ${code}).`))),
    );
  });
}

/** Wie `parseIcs`, aber mit hartem Limit. Wirft `IcsParseError` und `IcsTooComplexError`. */
export async function parseIcsIsolated(text: string, options: ParseOptions): Promise<ParseResult> {
  await acquire();
  try {
    return await runWorker(text, options);
  } finally {
    release();
  }
}
