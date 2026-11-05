import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  InputAborted,
  MAX_INPUT_CHARS,
  readAll,
  readLineFromTty,
  type InputStream,
} from '../src/secret-input.ts';

/** Terminal-Double: merkt sich den Raw-Modus */
function fakeTty(): { input: InputStream & PassThrough; rawModes: boolean[] } {
  const rawModes: boolean[] = [];
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode(mode: boolean) {
      rawModes.push(mode);
      return input;
    },
  });
  return { input, rawModes };
}

function fakeOutput(): { write(chunk: string): boolean; text: () => string } {
  const chunks: string[] = [];
  return {
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    text: () => chunks.join(''),
  };
}

// Testwerte zur Laufzeit gebaut und offensichtlich unecht (öffentliches Repo, Secret-Scanner)
const SECRET = ['geheim', 'unecht', 'test'].join('-');

describe('readLineFromTty (verdeckt)', () => {
  it('zeigt die Eingabe nicht an und schaltet den Raw-Modus wieder ab', async () => {
    const { input, rawModes } = fakeTty();
    const output = fakeOutput();
    const pending = readLineFromTty(input, output, 'Passwort: ', { echo: false });
    input.write(`${SECRET}\r`);
    await expect(pending).resolves.toBe(SECRET);
    // Gegenprobe: mit Echo stünde das Passwort in der Ausgabe
    expect(output.text()).toBe('Passwort: \n');
    expect(output.text()).not.toContain('geheim');
    expect(rawModes).toEqual([true, false]);
  });

  it('verarbeitet Rücktaste, Strg+U und Einfügen in Klammern (Bracketed Paste)', async () => {
    const { input } = fakeTty();
    const output = fakeOutput();
    const pending = readLineFromTty(input, output, '> ', { echo: false });
    input.write('falsch\x15ab');
    input.write('cx\x7f');
    input.write('\x1b[200~def\x1b[201~\n');
    await expect(pending).resolves.toBe('abcdef');
    expect(output.text()).toBe('> \n');
  });

  it('bricht mit Strg+C ab und stellt das Terminal wieder her', async () => {
    const { input, rawModes } = fakeTty();
    const pending = readLineFromTty(input, fakeOutput(), '> ', { echo: false });
    input.write('abc\x03');
    await expect(pending).rejects.toBeInstanceOf(InputAborted);
    expect(rawModes).toEqual([true, false]);
  });

  it('bricht bei Strg+D ohne Eingabe ab', async () => {
    const { input } = fakeTty();
    const pending = readLineFromTty(input, fakeOutput(), '> ', { echo: false });
    input.write('\x04');
    await expect(pending).rejects.toBeInstanceOf(InputAborted);
  });

  it('verweigert ohne Terminal', async () => {
    const input = new PassThrough() as InputStream;
    await expect(readLineFromTty(input, fakeOutput(), '> ', { echo: false })).rejects.toThrow('Terminal');
  });

  it('zeigt mit echo: true die Eingabe (Benutzername)', async () => {
    const { input } = fakeTty();
    const output = fakeOutput();
    const pending = readLineFromTty(input, output, 'Name: ', { echo: true });
    input.write('anna\r');
    await expect(pending).resolves.toBe('anna');
    expect(output.text()).toBe('Name: anna\n');
  });
});

describe('readAll', () => {
  it('liest die ganze Pipe', async () => {
    const input = new PassThrough();
    const pending = readAll(input);
    input.end('abc\n');
    await expect(pending).resolves.toBe('abc\n');
  });

  it('bricht bei zu langer Eingabe ab', async () => {
    const input = new PassThrough();
    const pending = readAll(input);
    input.write('x'.repeat(MAX_INPUT_CHARS + 1));
    await expect(pending).rejects.toThrow('zu lang');
  });
});
