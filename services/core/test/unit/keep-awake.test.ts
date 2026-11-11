// UX-04: Mac während der Vorlesung wach halten. Fake-`spawn`, nie ein echtes `caffeinate`.
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { createKeepAwake, type KeepAwakeChild, type KeepAwakeSpawn } from '../../src/services/keep-awake.ts';

class FakeChild implements KeepAwakeChild {
  readonly kill = vi.fn((_signal?: NodeJS.Signals) => true);
  private handlers = new Map<string, (...args: never[]) => void>();
  on(event: string, listener: (...args: never[]) => void): this {
    this.handlers.set(event, listener);
    return this;
  }
  emit(event: string, ...args: unknown[]): void {
    (this.handlers.get(event) as ((...a: unknown[]) => void) | undefined)?.(...args);
  }
}

function setup(platform: NodeJS.Platform = 'darwin') {
  const children: FakeChild[] = [];
  const spawn = vi.fn((_c: string, _a: string[], _o: { stdio: 'ignore' }) => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  const warn = vi.fn();
  const info = vi.fn();
  const logger = { warn, info, error: vi.fn() } as unknown as Logger;
  const awake = createKeepAwake({ logger, platform, spawn: spawn as KeepAwakeSpawn, pid: 4242 });
  return { awake, spawn, children, warn, info };
}

describe('createKeepAwake', () => {
  it('darwin: set(true) startet genau einen caffeinate mit -i -s -w <pid>, ein zweites set(true) keinen weiteren', () => {
    const { awake, spawn } = setup();
    awake.set(true);
    awake.set(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith('/usr/bin/caffeinate', ['-i', '-s', '-w', '4242'], {
      stdio: 'ignore',
    });
    expect(awake.isActive()).toBe(true);
  });

  it('set(false) schickt SIGTERM; ohne Kind kein kill', () => {
    const { awake, children } = setup();
    awake.set(false);
    expect(children).toHaveLength(0);
    awake.set(true);
    awake.set(false);
    expect(children[0]?.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    expect(awake.isActive()).toBe(false);
  });

  it('linux: nie spawn, ein info', () => {
    const { awake, spawn, info } = setup('linux');
    awake.set(true);
    awake.set(true);
    expect(spawn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    expect(awake.isActive()).toBe(false);
  });

  it('beendet sich das Kind, startet das nächste set(true) neu und warnt', () => {
    const { awake, spawn, children, warn } = setup();
    awake.set(true);
    children[0]?.emit('exit', 1, null);
    expect(awake.isActive()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    awake.set(true);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('ENOENT: ein warn, danach kein weiterer Versuch', () => {
    const { awake, spawn, children, warn } = setup();
    awake.set(true);
    children[0]?.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
    expect(warn).toHaveBeenCalledTimes(1);
    awake.set(true);
    awake.set(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stop() beendet das Kind', () => {
    const { awake, children } = setup();
    awake.set(true);
    awake.stop();
    expect(children[0]?.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    expect(awake.isActive()).toBe(false);
  });
});
