// F3a (VERTRAEGE 17.8): `LectureSync` ohne Datenbank, mit Attrappen für `sync`, `status`, `coursesOf` und die Uhr.
import { describe, expect, it, vi } from 'vitest';
import type { MoodleConnectionState } from '@sg/shared';
import type { Db } from '../../src/db/client.ts';
import {
  LECTURE_SYNC_THROTTLE_MS,
  LectureSync,
  type LectureSyncOptions,
  type LectureSyncOutcome,
} from '../../src/moodle/lecture.ts';
import type { LectureRunResult } from '../../src/moodle/sync.ts';

const T0 = Date.parse('2026-11-17T09:00:00Z');
const MIN = 60_000;

interface Rig {
  lecture: LectureSync;
  setNow: (ms: number) => void;
  runForLecture: ReturnType<typeof vi.fn<(courses: readonly number[]) => LectureRunResult>>;
  getStatus: ReturnType<typeof vi.fn<() => Promise<{ state: MoodleConnectionState }>>>;
  coursesOf: ReturnType<typeof vi.fn<(moduleId: string) => Promise<number[]>>>;
  warn: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
}

function rig(
  options: {
    state?: MoodleConnectionState;
    courses?: Record<string, number[]>;
    result?: LectureRunResult;
  } = {},
): Rig {
  let nowMs = T0;
  const runForLecture = vi.fn<(courses: readonly number[]) => LectureRunResult>(
    () => options.result ?? 'gestartet',
  );
  const getStatus = vi.fn<() => Promise<{ state: MoodleConnectionState }>>(async () => ({
    state: options.state ?? 'ok',
  }));
  const courses = options.courses ?? { A: [30, 10, 20], B: [5], C: [6] };
  const coursesOf = vi.fn<(moduleId: string) => Promise<number[]>>(async (id) => courses[id] ?? []);
  const warn = vi.fn();
  const debug = vi.fn();
  const lecture = new LectureSync({
    db: {} as Db,
    sync: { runForLecture },
    status: { getStatus } as unknown as LectureSyncOptions['status'],
    logger: { warn, debug },
    now: () => new Date(nowMs),
    coursesOf,
  });
  return {
    lecture,
    setNow: (ms) => {
      nowMs = ms;
    },
    runForLecture,
    getStatus,
    coursesOf,
    warn,
    debug,
  };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('LectureSync.request (VERTRAEGE 17.8)', () => {
  it('1: der erste Anstoß ruft runForLecture mit den Kursen des Moduls, aufsteigend', async () => {
    const r = rig();
    expect(await r.lecture.request('A')).toBe('gestartet');
    expect(r.runForLecture).toHaveBeenCalledTimes(1);
    expect(r.runForLecture).toHaveBeenCalledWith([10, 20, 30]);
  });

  it('2: nach 9 min 59 s gedrosselt (kein Aufruf von status und sync), nach 10 min wieder ein Aufruf', async () => {
    const r = rig();
    await r.lecture.request('A');
    r.setNow(T0 + LECTURE_SYNC_THROTTLE_MS - 1_000);
    expect(await r.lecture.request('A')).toBe('gedrosselt');
    expect(r.getStatus).toHaveBeenCalledTimes(1);
    expect(r.coursesOf).toHaveBeenCalledTimes(1);
    expect(r.runForLecture).toHaveBeenCalledTimes(1);
    r.setNow(T0 + LECTURE_SYNC_THROTTLE_MS);
    expect(await r.lecture.request('A')).toBe('gestartet');
    expect(r.getStatus).toHaveBeenCalledTimes(2);
    expect(r.runForLecture).toHaveBeenCalledTimes(2);
  });

  it('3: zwei Module drosseln sich nicht gegenseitig', async () => {
    const r = rig();
    expect(await r.lecture.request('A')).toBe('gestartet');
    expect(await r.lecture.request('B')).toBe('gestartet');
    expect(r.runForLecture.mock.calls).toEqual([[[10, 20, 30]], [[5]]]);
  });

  it('4: zwei gleichzeitige request für dasselbe Modul: genau ein Aufruf', async () => {
    const r = rig();
    const [first, second] = await Promise.all([r.lecture.request('A'), r.lecture.request('A')]);
    expect([first, second].sort()).toEqual(['gedrosselt', 'gestartet']);
    expect(r.runForLecture).toHaveBeenCalledTimes(1);
    expect(r.getStatus).toHaveBeenCalledTimes(1);
  });

  it.each(['nicht_eingerichtet', 'ungueltig', 'abgelaufen'] as const)(
    '5: Zugang %s: kein_zugang, kein runForLecture, der folgende Anstoß ist gedrosselt',
    async (state) => {
      const r = rig({ state });
      expect(await r.lecture.request('A')).toBe('kein_zugang');
      expect(r.runForLecture).not.toHaveBeenCalled();
      r.setNow(T0 + MIN);
      expect(await r.lecture.request('A')).toBe('gedrosselt');
      expect(r.getStatus).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['nicht_erreichbar', 'laeuft_bald_ab'] as const)(
    '6: Zugang %s: runForLecture wird gerufen',
    async (state) => {
      const r = rig({ state });
      expect(await r.lecture.request('A')).toBe('gestartet');
      expect(r.runForLecture).toHaveBeenCalledTimes(1);
    },
  );

  it('7: kein Kurs: kein_kurs, kein runForLecture, danach gedrosselt, kein warn', async () => {
    const r = rig();
    expect(await r.lecture.request('ohne-kurs')).toBe('kein_kurs');
    expect(r.runForLecture).not.toHaveBeenCalled();
    r.setNow(T0 + MIN);
    expect(await r.lecture.request('ohne-kurs')).toBe('gedrosselt');
    expect(r.coursesOf).toHaveBeenCalledTimes(1);
    expect(r.warn).not.toHaveBeenCalled();
  });

  it('8: status.getStatus wirft: fehler, ein warn, nicht verworfen, der nächste Anstoß ist gedrosselt', async () => {
    const r = rig();
    r.getStatus.mockRejectedValueOnce(new Error('Datenbank nicht erreichbar'));
    await expect(r.lecture.request('A')).resolves.toBe('fehler');
    expect(r.warn).toHaveBeenCalledTimes(1);
    expect(r.warn.mock.calls[0]?.[0]).toMatchObject({ module_id: 'A' });
    expect(r.runForLecture).not.toHaveBeenCalled();
    r.setNow(T0 + MIN);
    expect(await r.lecture.request('A')).toBe('gedrosselt');
  });

  it('12: coursesOf wirft: fehler, ein warn, nicht verworfen, kein runForLecture, danach gedrosselt', async () => {
    const r = rig();
    r.coursesOf.mockRejectedValueOnce(new Error('Datenbank nicht erreichbar'));
    await expect(r.lecture.request('A')).resolves.toBe('fehler');
    expect(r.warn).toHaveBeenCalledTimes(1);
    expect(r.runForLecture).not.toHaveBeenCalled();
    r.setNow(T0 + MIN);
    expect(await r.lecture.request('A')).toBe('gedrosselt');
  });

  it('runForLecture wirft (darf nie, aber sicher ist sicher): fehler, ein warn', async () => {
    const r = rig();
    r.runForLecture.mockImplementationOnce(() => {
      throw new Error('kaputt');
    });
    await expect(r.lecture.request('A')).resolves.toBe('fehler');
    expect(r.warn).toHaveBeenCalledTimes(1);
  });

  it('10: Uhr zurückgestellt: nicht gedrosselt', async () => {
    const r = rig();
    await r.lecture.request('A');
    r.setNow(T0 - 30 * MIN);
    expect(await r.lecture.request('A')).toBe('gestartet');
    expect(r.runForLecture).toHaveBeenCalledTimes(2);
  });

  it.each(['gestoppt', 'gedeckt', 'angehaengt', 'gestartet'] as const)(
    '11: runForLecture liefert %s: request reicht es durch, ohne warn',
    async (result) => {
      const r = rig({ result });
      expect(await r.lecture.request('A')).toBe(result satisfies LectureSyncOutcome);
      expect(r.warn).not.toHaveBeenCalled();
    },
  );

  it('die Zeit zählt auch bei gedeckt: der nächste Anstoß innerhalb von 10 min ist gedrosselt', async () => {
    const r = rig({ result: 'gedeckt' });
    expect(await r.lecture.request('A')).toBe('gedeckt');
    r.setNow(T0 + MIN);
    expect(await r.lecture.request('A')).toBe('gedrosselt');
    expect(r.runForLecture).toHaveBeenCalledTimes(1);
  });

  it('jede Entscheidung steht auf debug (module_id, outcome)', async () => {
    const r = rig();
    await r.lecture.request('A');
    await r.lecture.request('A');
    expect(r.debug.mock.calls.map((c) => c[0])).toEqual([
      { module_id: 'A', outcome: 'gestartet' },
      { module_id: 'A', outcome: 'gedrosselt' },
    ]);
    expect(r.warn).not.toHaveBeenCalled();
  });

  it('13: Aufräumen: nach Anstößen für A und B und 10 min später einem Anstoß für C ist tracked = 1', async () => {
    const r = rig();
    await r.lecture.request('A');
    await r.lecture.request('B');
    expect(r.lecture.tracked).toBe(2);
    r.setNow(T0 + LECTURE_SYNC_THROTTLE_MS);
    await r.lecture.request('C');
    expect(r.lecture.tracked).toBe(1);
  });

  it('13: ein Eintrag mit Zeit in der Zukunft ist nach dem nächsten request eines anderen Moduls entfernt', async () => {
    const r = rig();
    r.setNow(T0 + 60 * MIN);
    await r.lecture.request('A');
    expect(r.lecture.tracked).toBe(1);
    r.setNow(T0);
    await r.lecture.request('B');
    expect(r.lecture.tracked).toBe(1);
  });
});

describe('LectureSync.onTick (VERTRAEGE 17.8)', () => {
  it('9: startup: true stößt nichts an', async () => {
    const r = rig();
    r.lecture.onTick({ becameReady: ['A'], activeWithoutDeck: ['B'] }, { startup: true });
    await flush();
    expect(r.getStatus).not.toHaveBeenCalled();
    expect(r.runForLecture).not.toHaveBeenCalled();
    expect(r.lecture.tracked).toBe(0);
  });

  it('9: ohne startup: Module aus beiden Listen, ein Modul in beiden nur einmal, aufsteigend', async () => {
    const r = rig();
    r.lecture.onTick({ becameReady: ['B', 'A'], activeWithoutDeck: ['A', 'C'] });
    await flush();
    expect(r.runForLecture.mock.calls).toEqual([[[10, 20, 30]], [[5]], [[6]]]);
    r.lecture.onTick({ becameReady: [], activeWithoutDeck: ['A'] }, { startup: false });
    await flush();
    expect(r.runForLecture).toHaveBeenCalledTimes(3);
  });

  it('9: wirft nie und wartet auf nichts, auch wenn request scheitert', async () => {
    const r = rig();
    r.getStatus.mockRejectedValue(new Error('kaputt'));
    expect(() => r.lecture.onTick({ becameReady: ['A'], activeWithoutDeck: ['B'] })).not.toThrow();
    await flush();
    expect(r.warn).toHaveBeenCalledTimes(2);
  });

  it('9: wirft nie, auch bei einem kaputten Logger oder einer kaputten Liste', async () => {
    const r = rig();
    r.warn.mockImplementation(() => {
      throw new Error('Logger kaputt');
    });
    r.getStatus.mockRejectedValue(new Error('kaputt'));
    expect(() => r.lecture.onTick({ becameReady: ['A'], activeWithoutDeck: [] })).not.toThrow();
    await flush();
    expect(() =>
      r.lecture.onTick({ becameReady: undefined, activeWithoutDeck: [] } as unknown as {
        becameReady: string[];
        activeWithoutDeck: string[];
      }),
    ).not.toThrow();
  });
});
