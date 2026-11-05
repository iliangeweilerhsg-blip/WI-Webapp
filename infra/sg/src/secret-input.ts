// Eingaben im Terminal: Zeile mit oder ohne Echo (Passwort, Token) und Standardeingabe als Ganzes.
// Verdeckt heißt: Das Terminal läuft im Raw-Modus, die Zeichen werden nicht angezeigt.
// So landet das Geheimnis weder auf dem Bildschirm noch in der Shell-History oder in argv.

/** Eingabestrom, der ein Terminal sein kann (process.stdin oder ein Test-Double) */
export interface InputStream extends NodeJS.ReadableStream {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
}

export interface OutputStream {
  write(chunk: string): unknown;
}

/** Abbruch durch Strg+C oder Strg+D bei leerer Eingabe */
export class InputAborted extends Error {
  constructor() {
    super('Eingabe abgebrochen.');
    this.name = 'InputAborted';
  }
}

/** Höchstlänge einer Eingabe. Länger ist kein Passwort und kein Token, sondern ein Versehen */
export const MAX_INPUT_CHARS = 4096;

const CTRL_C = '\x03';
const CTRL_D = '\x04';
const BACKSPACE = '\x08';
const CTRL_U = '\x15';
const DELETE = '\x7f';
// Steuerfolgen des Terminals verwerfen (Pfeiltasten, Bracketed Paste ESC[200~ ... ESC[201~)
// eslint-disable-next-line no-control-regex -- ESC ist hier gewollt
const ESCAPE_SEQUENCE = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|O[@-~]|[@-Z\\-_])?/g;

/**
 * Liest eine Zeile von einem Terminal im Raw-Modus. Mit `echo: false` erscheint nichts von der Eingabe,
 * auch keine Sternchen (die Länge des Passworts bleibt so verborgen). Strg+C bricht ab.
 */
export function readLineFromTty(
  input: InputStream,
  output: OutputStream,
  prompt: string,
  options: { echo: boolean },
): Promise<string> {
  if (input.isTTY !== true || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('Keine Terminal-Eingabe verfügbar.'));
  }
  const setRawMode = input.setRawMode.bind(input);
  return new Promise<string>((resolve, reject) => {
    let value = '';
    let finished = false;
    const finish = (error: Error | null): void => {
      if (finished) return;
      finished = true;
      input.removeListener('data', onData);
      input.removeListener('error', onError);
      input.removeListener('end', onEnd);
      try {
        setRawMode(false);
      } finally {
        input.pause();
        output.write('\n');
      }
      if (error) reject(error);
      else resolve(value);
    };
    const onError = (): void => finish(new Error('Eingabe konnte nicht gelesen werden.'));
    const onEnd = (): void => finish(value === '' ? new InputAborted() : null);
    const onData = (chunk: Buffer | string): void => {
      const text = (typeof chunk === 'string' ? chunk : chunk.toString('utf8')).replace(ESCAPE_SEQUENCE, '');
      for (const char of text) {
        if (char === '\r' || char === '\n') return finish(null);
        if (char === CTRL_C) return finish(new InputAborted());
        if (char === CTRL_D) return finish(value === '' ? new InputAborted() : null);
        if (char === DELETE || char === BACKSPACE) {
          if (value.length > 0) {
            value = Array.from(value).slice(0, -1).join('');
            if (options.echo) output.write('\b \b');
          }
          continue;
        }
        if (char === CTRL_U) {
          if (options.echo) output.write('\b \b'.repeat(Array.from(value).length));
          value = '';
          continue;
        }
        // Übrige Steuerzeichen ignorieren
        if (char < ' ') continue;
        if (value.length >= MAX_INPUT_CHARS) return finish(new Error('Eingabe ist zu lang.'));
        value += char;
        if (options.echo) output.write(char);
      }
    };
    output.write(prompt);
    setRawMode(true);
    input.on('data', onData);
    input.once('error', onError);
    input.once('end', onEnd);
    input.resume();
  });
}

/** Liest die ganze Standardeingabe (Pipe), höchstens `MAX_INPUT_CHARS` Zeichen */
export function readAll(input: InputStream): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const cleanup = (): void => {
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
    };
    const onData = (chunk: Buffer | string): void => {
      value += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (value.length > MAX_INPUT_CHARS) {
        cleanup();
        input.pause();
        reject(new Error('Eingabe ist zu lang.'));
      }
    };
    const onEnd = (): void => {
      cleanup();
      resolve(value);
    };
    const onError = (): void => {
      cleanup();
      reject(new Error('Eingabe konnte nicht gelesen werden.'));
    };
    input.on('data', onData);
    input.once('end', onEnd);
    input.once('error', onError);
    input.resume();
  });
}
