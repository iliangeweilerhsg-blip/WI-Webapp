import { describe, expect, it } from 'vitest';
import { COMMANDS, helpText, parseArgs } from '../src/cli.ts';

describe('parseArgs', () => {
  it('zeigt die Hilfe ohne Argumente und mit --help', () => {
    expect(parseArgs([])).toEqual({ kind: 'help' });
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
    expect(parseArgs(['start', '--help'])).toEqual({ kind: 'help' });
  });

  it('erkennt alle Befehle', () => {
    for (const command of Object.keys(COMMANDS)) {
      expect(parseArgs([command])).toEqual({ kind: 'command', command, rest: [] });
    }
  });

  it('meldet unbekannte Befehle (auch Prototyp-Namen)', () => {
    expect(parseArgs(['foo']).kind).toBe('error');
    expect(parseArgs(['toString']).kind).toBe('error');
  });

  it('reicht weitere Argumente durch', () => {
    expect(parseArgs(['start', '--x'])).toEqual({ kind: 'command', command: 'start', rest: ['--x'] });
  });
});

describe('helpText', () => {
  it('listet alle Befehle', () => {
    const text = helpText();
    for (const command of Object.keys(COMMANDS)) expect(text).toContain(command);
  });
});
