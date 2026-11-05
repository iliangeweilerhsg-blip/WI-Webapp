// T1-23, Review #133 (S2, S3): Warteschlange und Herunterfahren des Moodle-Abgleichs, ohne Datenbank.
// Der eigentliche Lauf (`syncAll`) wird durch eine kontrollierbare Attrappe ersetzt.
import { describe, expect, it } from 'vitest';
import type { MoodleSyncRun } from '@sg/shared';
import type { Db } from '../../src/db/client.ts';
import { MoodleSync, type MoodleSyncOptions } from '../../src/moodle/sync.ts';

interface Probe {
  sync: MoodleSync;
  active: () => number;
  maxActive: () => number;
  started: number[][];
  /** Beendet den ältesten laufenden Abgleich */
  release: () => void;
  /** Wartet, bis so viele Läufe gestartet sind */
  waitForStarts: (count: number) => Promise<void>;
  /** Simuliert Dateien: ruft vor jeder „Datei“ die Abbruchprüfung auf */
  files: number;
}

function probe(options: { files?: number } = {}): Probe {
  const moodle = {
    status: { getStatus: async () => ({ state: 'ok' }) },
  } as unknown as MoodleSyncOptions['moodle'];
  const sync = new MoodleSync({ db: {} as Db, dataDir: '/gibt/es/nicht', moodle });
  let active = 0;
  let maxActive = 0;
  const started: number[][] = [];
  const releases: (() => void)[] = [];
  const result: Probe = {
    sync,
    active: () => active,
    maxActive: () => maxActive,
    started,
    release: () => releases.shift()?.(),
    waitForStarts: async (count) => {
      while (started.length < count) await new Promise((r) => setTimeout(r, 1));
    },
    files: options.files ?? 0,
  };
  const internals = sync as unknown as {
    syncAll: (run: MoodleSyncRun, scope: ReadonlySet<number> | null) => Promise<void>;
    checkStopped: () => void;
  };
  internals.syncAll = async (run, scope) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    started.push(scope ? [...scope].sort() : []);
    try {
      await new Promise<void>((resolve) => releases.push(resolve));
      for (let i = 0; i < result.files; i += 1) {
        internals.checkStopped();
        run.files_imported += 1;
        await new Promise((r) => setTimeout(r, 1));
      }
    } finally {
      active -= 1;
    }
  };
  return result;
}

describe('MoodleSync: Warteschlange (Review #133, S2)', () => {
  it('ein Aufruf zwischen Ende des laufenden und Start des angehängten Laufs startet keinen zweiten', async () => {
    const p = probe();
    const first = p.sync.run('manuell', [1]);
    // Wird im selben Mikrotask-Fenster wie der Start des angehängten Laufs aufgerufen
    let third: Promise<MoodleSyncRun> | undefined;
    void first.then(() => {
      third = p.sync.run('manuell', [3]);
    });
    const second = p.sync.run('manuell', [2]);
    await p.waitForStarts(1);
    p.release();
    await first;
    await p.waitForStarts(2);
    expect(p.maxActive()).toBe(1);
    p.release();
    await second;
    await third;
    expect(p.maxActive()).toBe(1);
    // Der dritte Aufruf ist im angehängten Lauf aufgegangen: zwei Läufe, Kurse zusammengefasst
    expect(p.started).toEqual([[1], [2, 3]]);
    expect(third).toBe(second);
  });

  it('weitere Aufrufe während eines Laufs ergeben genau einen angehängten Lauf', async () => {
    const p = probe();
    const runs = [p.sync.run('manuell', [1]), p.sync.run('manuell', [2]), p.sync.run('manuell')];
    await p.waitForStarts(1);
    p.release();
    await p.waitForStarts(2);
    p.release();
    await Promise.all(runs);
    expect(p.started).toEqual([[1], []]);
    expect(p.maxActive()).toBe(1);
  });
});

describe('MoodleSync: Herunterfahren (Review #133, S3)', () => {
  it('stop() verwirft den angehängten Lauf und bricht den laufenden zwischen zwei Dateien ab', async () => {
    const p = probe({ files: 50 });
    const running = p.sync.run('manuell');
    const queued = p.sync.run('zeitplan');
    await p.waitForStarts(1);
    p.release();
    await new Promise((r) => setTimeout(r, 5));
    await p.sync.stop(2_000);
    const [first, second] = await Promise.all([running, queued]);
    expect(first).toMatchObject({ ok: false, error_code: 'abgebrochen' });
    expect(first.files_imported).toBeLessThan(50);
    expect(second).toMatchObject({ ok: false, error_code: 'abgebrochen', trigger: 'zeitplan' });
    expect(p.started).toHaveLength(1);
    // Nach stop() startet nichts mehr
    expect(await p.sync.run('manuell')).toMatchObject({ error_code: 'abgebrochen' });
    expect(p.started).toHaveLength(1);
  });

  it('stop() wartet höchstens die vorgegebene Zeit', async () => {
    const p = probe();
    void p.sync.run('manuell');
    await p.waitForStarts(1);
    const before = Date.now();
    await p.sync.stop(50);
    expect(Date.now() - before).toBeLessThan(1_000);
    expect(p.active()).toBe(1);
    p.release();
    await p.sync.idle();
  });
});
