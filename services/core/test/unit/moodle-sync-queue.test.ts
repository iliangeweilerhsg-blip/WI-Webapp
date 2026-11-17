// T1-23, Review #133 (S2, S3): Warteschlange und Herunterfahren des Moodle-Abgleichs, ohne Datenbank.
// Der eigentliche Lauf (`syncAll`) wird durch eine kontrollierbare Attrappe ersetzt.
import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/client.ts';
import { MoodleSync, type MoodleSyncOptions, type SyncRun } from '../../src/moodle/sync.ts';

interface Probe {
  sync: MoodleSync;
  active: () => number;
  maxActive: () => number;
  started: number[][];
  /** Anlass je gestartetem Lauf */
  triggers: string[];
  /** Lässt den nächsten Lauf scheitern */
  failNext: () => void;
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
  const triggers: string[] = [];
  let failing = false;
  const releases: (() => void)[] = [];
  const result: Probe = {
    sync,
    active: () => active,
    maxActive: () => maxActive,
    started,
    triggers,
    failNext: () => {
      failing = true;
    },
    release: () => releases.shift()?.(),
    waitForStarts: async (count) => {
      while (started.length < count) await new Promise((r) => setTimeout(r, 1));
    },
    files: options.files ?? 0,
  };
  const internals = sync as unknown as {
    syncAll: (run: SyncRun, scope: ReadonlySet<number> | null) => Promise<void>;
    checkStopped: () => void;
  };
  internals.syncAll = async (run, scope) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    started.push(scope ? [...scope].sort((a, b) => a - b) : []);
    triggers.push(run.trigger);
    try {
      await new Promise<void>((resolve) => releases.push(resolve));
      if (failing) {
        failing = false;
        throw new Error('Moodle nicht erreichbar');
      }
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
    let third: Promise<SyncRun> | undefined;
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

/** Wartet auf den Start des n-ten Laufs, beendet ihn und wartet auf `run` */
async function finish(p: Probe, run: Promise<unknown>, starts: number): Promise<void> {
  await p.waitForStarts(starts);
  p.release();
  await run;
}

describe('MoodleSync.runForLecture (VERTRAEGE 17.8)', () => {
  it('1: ohne laufenden Lauf gestartet, Umfang = die Kurse, danach lastLectureRun mit Anlass vorlesung', async () => {
    const p = probe();
    expect(p.sync.lastLectureRun).toBeNull();
    expect(p.sync.runForLecture([7, 3])).toBe('gestartet');
    await p.waitForStarts(1);
    expect(p.started).toEqual([[3, 7]]);
    expect(p.triggers).toEqual(['vorlesung']);
    p.release();
    await p.sync.idle();
    expect(p.sync.lastLectureRun).toMatchObject({ trigger: 'vorlesung', ok: true });
  });

  it('2: ein voller Lauf läuft: gedeckt, es startet kein zweiter Lauf', async () => {
    const p = probe();
    const full = p.sync.run('manuell');
    await p.waitForStarts(1);
    expect(p.sync.runForLecture([1, 2])).toBe('gedeckt');
    p.release();
    await full;
    await p.sync.idle();
    expect(p.started).toEqual([[]]);
  });

  it('3: Lauf für A läuft, Anstoß für B angehängt, Anstoß für A währenddessen gedeckt', async () => {
    const p = probe();
    const first = p.sync.run('manuell', [1]);
    await p.waitForStarts(1);
    expect(p.sync.runForLecture([2])).toBe('angehaengt');
    expect(p.sync.runForLecture([1])).toBe('gedeckt');
    p.release();
    await first;
    await p.waitForStarts(2);
    p.release();
    await p.sync.idle();
    expect(p.started).toEqual([[1], [2]]);
  });

  it('4: angehängter voller Lauf deckt; angehängter Lauf für A: Anstoß für A und B hängt an, Umfang A und B', async () => {
    const p = probe();
    const first = p.sync.run('manuell', [9]);
    await p.waitForStarts(1);
    const queuedFull = p.sync.run('zeitplan');
    expect(p.sync.runForLecture([1, 2])).toBe('gedeckt');
    p.release();
    await first;
    await finish(p, queuedFull, 2);
    expect(p.started).toEqual([[9], []]);

    const q = probe();
    const running = q.sync.run('manuell', [9]);
    await q.waitForStarts(1);
    expect(q.sync.runForLecture([1])).toBe('angehaengt');
    expect(q.sync.runForLecture([1])).toBe('gedeckt');
    expect(q.sync.runForLecture([1, 2])).toBe('angehaengt');
    q.release();
    await running;
    await q.waitForStarts(2);
    q.release();
    await q.sync.idle();
    expect(q.started).toEqual([[9], [1, 2]]);
  });

  it('5: angehängter Lauf vorlesung, danach manuell: ein Lauf, voller Umfang, Anlass manuell, schreibt last_run', async () => {
    const p = probe();
    const running = p.sync.run('zeitplan', [9]);
    await p.waitForStarts(1);
    expect(p.sync.runForLecture([1])).toBe('angehaengt');
    const manual = p.sync.run('manuell');
    p.release();
    await running;
    await p.waitForStarts(2);
    p.release();
    await manual;
    expect(p.started).toEqual([[9], []]);
    expect(p.triggers).toEqual(['zeitplan', 'manuell']);
    expect((await p.sync.status()).last_run?.trigger).toBe('manuell');
    expect(p.sync.lastLectureRun).toBeNull();
  });

  it('5: umgekehrt (angehängt manuell für A, Anstoß für B) bleibt manuell und schreibt last_run', async () => {
    const p = probe();
    const running = p.sync.run('zeitplan', [9]);
    await p.waitForStarts(1);
    const manual = p.sync.run('manuell', [1]);
    expect(p.sync.runForLecture([2])).toBe('angehaengt');
    p.release();
    await running;
    await p.waitForStarts(2);
    p.release();
    await manual;
    expect(p.started).toEqual([[9], [1, 2]]);
    expect(p.triggers).toEqual(['zeitplan', 'manuell']);
    expect((await p.sync.status()).last_run?.trigger).toBe('manuell');
    expect(p.sync.lastLectureRun).toBeNull();
  });

  it('6: nach stop() gestoppt, leere Liste gedeckt', async () => {
    const p = probe();
    expect(p.sync.runForLecture([])).toBe('gedeckt');
    expect(p.started).toEqual([]);
    await p.sync.stop(50);
    expect(p.sync.runForLecture([1])).toBe('gestoppt');
    expect(p.started).toEqual([]);
    expect(p.sync.lastLectureRun).toBeNull();
  });

  it('7: Anstöße für fünf Kurse während eines Laufs ergeben danach genau einen Lauf mit allen fünf', async () => {
    const p = probe();
    const first = p.sync.run('manuell', [100]);
    await p.waitForStarts(1);
    const results = [1, 2, 3, 4, 5].map((id) => p.sync.runForLecture([id]));
    expect(results).toEqual(['angehaengt', 'angehaengt', 'angehaengt', 'angehaengt', 'angehaengt']);
    p.release();
    await first;
    await p.waitForStarts(2);
    p.release();
    await p.sync.idle();
    expect(p.started).toEqual([[100], [1, 2, 3, 4, 5]]);
    expect(p.maxActive()).toBe(1);
  });

  it('7: zehn gemischte Aufrufe: nie mehr als ein Lauf gleichzeitig, nie mehr als ein angehängter', async () => {
    const p = probe();
    const runs: Promise<unknown>[] = [];
    for (let i = 0; i < 10; i += 1) {
      if (i % 2 === 0) runs.push(p.sync.run(i % 4 === 0 ? 'manuell' : 'zuordnung', [i]));
      else p.sync.runForLecture([i]);
    }
    await p.waitForStarts(1);
    p.release();
    await p.waitForStarts(2);
    p.release();
    await p.sync.idle();
    await Promise.all(runs);
    expect(p.maxActive()).toBe(1);
    expect(p.started).toHaveLength(2);
  });

  it('8: last_run bleibt: erst ein Lauf manuell (voll), dann ein Lauf vorlesung', async () => {
    const p = probe();
    await finish(p, p.sync.run('manuell'), 1);
    const before = (await p.sync.status()).last_run;
    expect(before).toMatchObject({ trigger: 'manuell', ok: true });
    await new Promise((r) => setTimeout(r, 5));
    expect(p.sync.runForLecture([4])).toBe('gestartet');
    await finish(p, p.sync.idle(), 2);
    const after = (await p.sync.status()).last_run;
    expect(after?.started_at).toBe(before?.started_at);
    expect(after?.trigger).toBe('manuell');
    expect(p.sync.lastLectureRun?.trigger).toBe('vorlesung');
    expect(p.sync.lastLectureRun?.started_at).not.toBe(before?.started_at);
  });

  it('9: gescheiterter Lauf vorlesung nach gutem vollen Lauf: last_run.ok bleibt true, lastLectureRun.ok = false', async () => {
    const p = probe();
    p.failNext();
    p.sync.runForLecture([1]);
    await finish(p, p.sync.idle(), 1);
    expect((await p.sync.status()).last_run).toBeNull();
    expect(p.sync.lastLectureRun).toMatchObject({ ok: false, trigger: 'vorlesung' });

    await finish(p, p.sync.run('start'), 2);
    p.failNext();
    p.sync.runForLecture([1]);
    await finish(p, p.sync.idle(), 3);
    expect((await p.sync.status()).last_run).toMatchObject({ ok: true, trigger: 'start' });
    expect(p.sync.lastLectureRun?.ok).toBe(false);
  });

  it('10: der gemerkte Umfang wird beim Ende gelöscht, auch nach einem Fehler', async () => {
    const p = probe();
    expect(p.sync.runForLecture([1])).toBe('gestartet');
    await finish(p, p.sync.idle(), 1);
    expect(p.sync.runForLecture([1])).toBe('gestartet');
    await finish(p, p.sync.idle(), 2);

    p.failNext();
    expect(p.sync.runForLecture([1])).toBe('gestartet');
    await finish(p, p.sync.idle(), 3);
    expect(p.sync.runForLecture([1])).toBe('gestartet');
    await finish(p, p.sync.idle(), 4);
  });

  it('11: decken nur beide zusammen (laufend A, angehängt B): Anstoß für A und B hängt an, Umfang A und B', async () => {
    const p = probe();
    const first = p.sync.run('manuell', [1]);
    await p.waitForStarts(1);
    expect(p.sync.runForLecture([2])).toBe('angehaengt');
    expect(p.sync.runForLecture([1, 2])).toBe('angehaengt');
    p.release();
    await first;
    await p.waitForStarts(2);
    p.release();
    await p.sync.idle();
    expect(p.started).toEqual([[1], [1, 2]]);
  });

  it('12: während eines Laufs vorlesung ist status().state = laeuft', async () => {
    const p = probe();
    p.sync.runForLecture([1]);
    await p.waitForStarts(1);
    expect((await p.sync.status()).state).toBe('laeuft');
    p.release();
    await p.sync.idle();
    expect((await p.sync.status()).state).toBe('bereit');
  });

  it('ein nach stop() verworfener angehängter Lauf vorlesung setzt lastLectureRun nicht', async () => {
    const p = probe({ files: 50 });
    const running = p.sync.run('manuell', [9]);
    expect(p.sync.runForLecture([1])).toBe('angehaengt');
    await p.waitForStarts(1);
    p.release();
    await p.sync.stop(2_000);
    await running;
    expect(p.sync.lastLectureRun).toBeNull();
  });
});
