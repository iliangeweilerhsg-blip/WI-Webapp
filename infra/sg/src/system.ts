// Echte Systemaufrufe. Die Doctor-Logik bekommt stattdessen das Interface `System`, damit sie ohne Docker testbar ist.
import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface System {
  nodeVersion: string;
  platform: string;
  arch: string;
  run(cmd: string, args: string[]): Promise<RunResult>;
  /** true, wenn der Port frei ist. */
  portFree(port: number, host: string): Promise<boolean>;
  /** true, wenn der Ordner (bzw. der nächste vorhandene Elternordner) beschreibbar ist. */
  dirWritable(path: string): boolean;
}

export function run(cmd: string, args: string[], timeoutMs = 15000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ ok: error === null, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

export function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

export function dirWritable(path: string): boolean {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  try {
    accessSync(current, constants.W_OK);
    // Tatsächlich schreiben, access() sagt z. B. auf Read-only-Mounts die Unwahrheit.
    const probe = mkdtempSync(join(current, '.sg-probe-'));
    rmSync(probe, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export function realSystem(): System {
  return {
    nodeVersion: process.versions.node,
    platform: platform(),
    arch: arch(),
    run: (cmd, args) => run(cmd, args),
    portFree,
    dirWritable,
  };
}
