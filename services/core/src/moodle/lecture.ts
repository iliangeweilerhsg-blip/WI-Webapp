// Abgleich zur Vorlesung (VERTRAEGE 17.8, 22.6): Der Takt der Sessions meldet Module, die Folien brauchen. `LectureSync`
// drosselt je Modul (10 min), prüft den Zugang und die Kurse und stößt `MoodleSync.runForLecture` an. Es verknüpft nichts
// und läuft nie in einer Transaktion. Nichts darf werfen: Der Anstoß darf Takt, Start und Übergang nie stören.
import type { Db } from '../db/client.ts';
import type { MoodleStatusService } from './status.ts';
import { activeCourseIdsOfModule } from './store.ts';
import type { MoodleSync } from './sync.ts';

/** Mindestabstand zwischen zwei Anstößen für dasselbe Modul */
export const LECTURE_SYNC_THROTTLE_MS = 10 * 60 * 1000;

export type LectureSyncOutcome =
  'gedrosselt' | 'kein_zugang' | 'kein_kurs' | 'gedeckt' | 'angehaengt' | 'gestartet' | 'gestoppt' | 'fehler';

/** Gleiche Form wie `SessionTickResult`, ohne Import aus `services/sessions.ts` */
export interface LectureDemand {
  becameReady: readonly string[];
  activeWithoutDeck: readonly string[];
}

export interface LectureSyncOptions {
  db: Db;
  sync: Pick<MoodleSync, 'runForLecture'>;
  status: Pick<MoodleStatusService, 'getStatus'>;
  logger?: { debug: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
  now?: () => Date;
  throttleMs?: number;
  /** Kurse des Moduls, Standard: `activeCourseIdsOfModule(db, moduleId)` (nur für Tests ersetzbar) */
  coursesOf?: (moduleId: string) => Promise<number[]>;
}

export class LectureSync {
  private readonly sync: LectureSyncOptions['sync'];
  private readonly status: LectureSyncOptions['status'];
  private readonly logger: LectureSyncOptions['logger'];
  private readonly now: () => Date;
  private readonly throttleMs: number;
  private readonly coursesOf: (moduleId: string) => Promise<number[]>;
  /** Zeitpunkt (ms) des letzten Anstoßes je Modul */
  private readonly last = new Map<string, number>();

  constructor(options: LectureSyncOptions) {
    this.sync = options.sync;
    this.status = options.status;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.throttleMs = options.throttleMs ?? LECTURE_SYNC_THROTTLE_MS;
    const db = options.db;
    this.coursesOf = options.coursesOf ?? ((moduleId) => activeCourseIdsOfModule(db, moduleId));
  }

  /** Nimmt das Ergebnis eines Takts. Wirft nie, wartet auf nichts. Der Start-Takt stößt nichts an */
  onTick(demand: LectureDemand, options: { startup?: boolean } = {}): void {
    try {
      if (options.startup === true) return;
      const modules = [...new Set([...demand.becameReady, ...demand.activeWithoutDeck])].sort();
      for (const moduleId of modules) void this.request(moduleId).catch(() => {});
    } catch (error) {
      this.warn(error, undefined);
    }
  }

  /** Ein Modul. Erfüllt sich mit der Entscheidung, nicht mit dem Ende des Laufs. Wird nie verworfen */
  async request(moduleId: string): Promise<LectureSyncOutcome> {
    const outcome = await this.decide(moduleId);
    try {
      this.logger?.debug({ module_id: moduleId, outcome }, 'Abgleich zur Vorlesung');
    } catch {
      // Das Protokoll darf nie werfen
    }
    return outcome;
  }

  /** Zahl der Module in der Drossel (nur für Tests) */
  get tracked(): number {
    return this.last.size;
  }

  private warn(error: unknown, moduleId: string | undefined): void {
    try {
      this.logger?.warn(
        { err: error, ...(moduleId !== undefined ? { module_id: moduleId } : {}) },
        'Abgleich zur Vorlesung nicht angestoßen',
      );
    } catch {
      // Das Protokoll darf nie werfen
    }
  }

  private async decide(moduleId: string): Promise<LectureSyncOutcome> {
    try {
      // Die Zeit wird sofort gemerkt, vor dem ersten `await`: Zwei gleichzeitige Anfragen ergeben einen Anstoß.
      // Sie zählt auch bei kein_zugang, kein_kurs, gedeckt und Fehlern (keine Lawine, auch nicht im Protokoll)
      const nowMs = this.now().getTime();
      this.prune(nowMs);
      const previous = this.last.get(moduleId);
      if (previous !== undefined && nowMs - previous < this.throttleMs) return 'gedrosselt';
      this.last.set(moduleId, nowMs);
      const state = (await this.status.getStatus()).state;
      // `nicht_erreichbar` zählt nicht als fehlender Zugang: Im Hörsaal kommt das Netz oft gerade wieder
      if (state === 'nicht_eingerichtet' || state === 'ungueltig' || state === 'abgelaufen') {
        return 'kein_zugang';
      }
      const courses = [...(await this.coursesOf(moduleId))].sort((a, b) => a - b);
      if (courses.length === 0) return 'kein_kurs';
      return this.sync.runForLecture(courses);
    } catch (error) {
      this.warn(error, moduleId);
      return 'fehler';
    }
  }

  /** Entfernt Einträge, die nicht mehr drosseln: Alter mindestens `throttleMs` oder Zeit in der Zukunft */
  private prune(nowMs: number): void {
    for (const [moduleId, at] of this.last) {
      if (nowMs - at >= this.throttleMs || at > nowMs) this.last.delete(moduleId);
    }
  }
}
