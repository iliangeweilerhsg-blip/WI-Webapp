// Worker-Thread für `parseIcs` (siehe calendar-parse.ts). Läuft in einem eigenen Thread, damit eine Wiederholungsregel,
// die in ical.js nie zurückkehrt (z. B. FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30), nur diesen Thread blockiert.
import { parentPort, workerData } from 'node:worker_threads';
import { IcsParseError, IcsTooComplexError, parseIcs, type ParseOptions } from './calendar-ics.ts';

interface Input {
  text: string;
  options: ParseOptions;
}

const { text, options } = workerData as Input;
try {
  parentPort?.postMessage({ ok: true, result: parseIcs(text, options) });
} catch (error) {
  const kind =
    error instanceof IcsParseError ? 'invalid' : error instanceof IcsTooComplexError ? 'complex' : 'error';
  parentPort?.postMessage({
    ok: false,
    kind,
    message: error instanceof Error ? error.message : String(error),
  });
}
