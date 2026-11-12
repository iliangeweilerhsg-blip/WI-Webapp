// Aktionskatalog (F-MDL-05, 08 §9.3). Der Katalog ist fest: Kennung, Text, Risiko, Parameter und die
// nötigen Moodle-Funktionen stehen hier. Die Umsetzung je Aktion (Vorschau + Ausführen) wird als
// Handler eingehängt. Neue Buttons in der Web-App brauchen so keinen neuen Core-Code.
import { z } from 'zod';
import {
  MoodleActionParamsAssignSaveDraftSchema,
  MoodleActionParamsAssignSubmitSchema,
  MoodleActionParamsCalendarCreateEventSchema,
  MoodleActionParamsCompletionSetSchema,
  MoodleActionParamsFilesUploadPrivateSchema,
  MoodleActionParamsForumCreateDiscussionSchema,
  MoodleActionParamsForumReplySchema,
  MoodleActionParamsMessageSendSchema,
  type MoodleActionCatalog,
  type MoodleActionId,
  type MoodleActionRisk,
} from '@sg/shared';
import { MOODLE_GATED_ACTIONS } from '../config.ts';
import { HttpError } from '../errors.ts';
import type { MoodleClient } from './client.ts';
import { createAssignHandlers } from './actions/assign.ts';
import type { MoodleUploadStore } from './uploads.ts';

export interface MoodleActionSpec<P> {
  label: string;
  description: string;
  risk: MoodleActionRisk;
  /** Moodle-Funktionen, die für den Token freigegeben sein müssen */
  wsfunctions: readonly string[];
  params: z.ZodType<P>;
}

export interface MoodleActionContext {
  client: MoodleClient;
  /** Moodle-Nutzer-ID des Token-Inhabers */
  userId(): Promise<number>;
  /** Löst `upload_ids` auf (`acquire`/`release`). Unbekannt oder verfallen → 404 `moodle_upload_not_found` */
  uploads: MoodleUploadStore;
  /**
   * Kurs-ID einer Aufgabe aus `moodle_deadline` (lokal, ohne Moodle). `null`, wenn unbekannt oder ohne Datenbank.
   * Spart den großen Aufruf von `mod_assign_get_assignments` über alle Kurse.
   */
  courseIdOfAssignment(assignmentId: number): Promise<number | null>;
}

export interface MoodleActionPreviewResult {
  /** Ein Satz in Klartext, was passieren wird */
  summary: string;
  warnings?: string[];
  details?: Record<string, unknown>;
}

export interface MoodleActionOutcome {
  summary: string;
  result: Record<string, unknown>;
}

export interface MoodleActionHandler<P> {
  /**
   * Optional: verlangt im Einzelfall eine Bestätigung, obwohl das Risiko der Aktion keine vorsieht
   * (z. B. `assign.save_draft` bei Aufgaben ohne Einreichen-Schritt: Speichern ist dort die Abgabe).
   * Darf nur verschärfen, nie lockern. Wird bei Vorschau und Ausführen gleich ausgewertet.
   */
  requiresConfirmation?(ctx: MoodleActionContext, params: P): Promise<boolean>;
  /**
   * Stand, an den der Bestätigungscode gebunden wird. Nur Lesen. Muss bei gleichem Stand in Moodle dasselbe JSON
   * liefern (keine Uhrzeit, keine Zufallswerte, Listen sortiert). Fehlt die Methode, gilt `null`. Scheitert das Lesen,
   * gibt es keinen Code (Vorschau) bzw. der Code bleibt offen (Ausführen), denn es wurde nichts geschrieben.
   */
  state?(ctx: MoodleActionContext, params: P): Promise<unknown>;
  /** Aktionen mit gleichem Schlüssel laufen im Core nacheinander, z. B. `assign:42`. `null` = keine Sperre */
  lockKey?(params: P): string | null;
  /**
   * Geltungsbereich, dessen offene Codes verfallen, sobald diese Aktion zu schreiben versucht hat (auch bei Fehler
   * und `outcome_unknown`, denn der Stand kann sich dann schon geändert haben). Eine Ablehnung vor dem Schreiben
   * (`409 moodle_action_rejected`) widerruft nichts.
   */
  revokesScope?(params: P): string | null;
  /** Geltungsbereich des eigenen Codes, z. B. `assign:42` */
  scope?(params: P): string | null;
  /** Darf Moodle lesen, aber nie schreiben. `state` ist der schon gelesene Stand (`null` ohne `state()`) */
  preview(ctx: MoodleActionContext, params: P, state: unknown): Promise<MoodleActionPreviewResult>;
  execute(ctx: MoodleActionContext, params: P, state: unknown): Promise<MoodleActionOutcome>;
}

function spec<P>(value: MoodleActionSpec<P>): MoodleActionSpec<P> {
  return value;
}

export const MOODLE_ACTION_SPECS = {
  'assign.save_draft': spec({
    label: 'Als Entwurf speichern',
    description:
      'Dateien oder Text als Entwurf in einer Moodle-Aufgabe speichern. Ersetzt den bisherigen Entwurf.',
    risk: 'aenderbar',
    // Lesende Funktionen des Handlers gehören dazu (Plan §4.1), sonst wäre die Aktion „verfügbar“ und scheitert dann
    wsfunctions: [
      'mod_assign_get_assignments',
      'mod_assign_get_submission_status',
      'mod_assign_save_submission',
    ],
    params: MoodleActionParamsAssignSaveDraftSchema.refine(
      (p) => p.upload_ids !== undefined || p.online_text_html !== undefined,
      { message: 'upload_ids oder online_text_html angeben' },
    ),
  }),
  'assign.submit': spec({
    label: 'Endgültig einreichen',
    description: 'Den Entwurf zur Bewertung einreichen. Danach sind keine Änderungen mehr möglich.',
    risk: 'endgueltig',
    wsfunctions: [
      'mod_assign_get_assignments',
      'mod_assign_get_submission_status',
      'mod_assign_submit_for_grading',
    ],
    params: MoodleActionParamsAssignSubmitSchema,
  }),
  'forum.create_discussion': spec({
    label: 'Diskussion starten',
    description: 'Neue Diskussion in einem Moodle-Forum. Für alle im Kurs sichtbar.',
    risk: 'oeffentlich',
    wsfunctions: ['mod_forum_add_discussion'],
    params: MoodleActionParamsForumCreateDiscussionSchema,
  }),
  'forum.reply': spec({
    label: 'Antworten',
    description: 'Antwort auf einen Forumsbeitrag. Für alle im Kurs sichtbar.',
    risk: 'oeffentlich',
    wsfunctions: ['mod_forum_add_discussion_post'],
    params: MoodleActionParamsForumReplySchema,
  }),
  'completion.set': spec({
    label: 'Als erledigt markieren',
    description: 'Aktivität in Moodle als erledigt oder nicht erledigt markieren.',
    risk: 'aenderbar',
    wsfunctions: ['core_completion_update_activity_completion_status_manually'],
    params: MoodleActionParamsCompletionSetSchema,
  }),
  'calendar.create_event': spec({
    label: 'Termin anlegen',
    description: 'Eigenen Termin im Moodle-Kalender anlegen. Nur für dich sichtbar.',
    risk: 'aenderbar',
    wsfunctions: ['core_calendar_submit_create_update_form'],
    params: MoodleActionParamsCalendarCreateEventSchema,
  }),
  'message.send': spec({
    label: 'Nachricht senden',
    description: 'Persönliche Nachricht an eine Person in Moodle senden.',
    risk: 'oeffentlich',
    wsfunctions: ['core_message_send_instant_messages'],
    params: MoodleActionParamsMessageSendSchema,
  }),
  'notifications.mark_read': spec({
    label: 'Alle als gelesen markieren',
    description: 'Alle Moodle-Benachrichtigungen als gelesen markieren.',
    risk: 'harmlos',
    wsfunctions: ['core_message_mark_all_notifications_as_read'],
    params: z.object({}).strict(),
  }),
  'files.upload_private': spec({
    label: 'In „Meine Dateien“ hochladen',
    description: 'Dateien in den privaten Dateibereich in Moodle hochladen.',
    risk: 'aenderbar',
    wsfunctions: ['core_user_add_user_private_files'],
    params: MoodleActionParamsFilesUploadPrivateSchema,
  }),
} satisfies Record<MoodleActionId, MoodleActionSpec<unknown>>;

export type MoodleActionParamsMap = {
  [K in MoodleActionId]: z.infer<(typeof MOODLE_ACTION_SPECS)[K]['params']>;
};

export type MoodleActionHandlers = {
  [K in MoodleActionId]?: MoodleActionHandler<MoodleActionParamsMap[K]>;
};

/** endgueltig und oeffentlich brauchen Vorschau + Bestätigungscode (F-MDL-06) */
export function needsConfirmation(risk: MoodleActionRisk): boolean {
  return risk === 'endgueltig' || risk === 'oeffentlich';
}

export function isMoodleActionId(id: string): id is MoodleActionId {
  return Object.hasOwn(MOODLE_ACTION_SPECS, id);
}

/**
 * Die einzigen Aktionen, die **nicht** am Schalter `SG_MOODLE_ACTIONS` hängen (E12). Alle anderen brauchen einen
 * Eintrag, auch eine später neu in den Katalog aufgenommene Kennung: Fehlt sie in {@link MOODLE_GATED_ACTIONS}, lässt
 * sie sich nicht freischalten und bleibt aus (fail closed), statt ungefragt zu laufen.
 */
export const MOODLE_UNGATED_ACTIONS = [
  'completion.set',
  'notifications.mark_read',
] as const satisfies readonly MoodleActionId[];
const UNGATED_ACTIONS: ReadonlySet<string> = new Set(MOODLE_UNGATED_ACTIONS);
/** Nur diese Kennungen nimmt `enabled` an (Schutz vor Tippfehlern in Tests und Aufrufern) */
const GATED_ACTIONS: ReadonlySet<string> = new Set(MOODLE_GATED_ACTIONS);

export class MoodleActionRegistry {
  private readonly handlers: MoodleActionHandlers;
  private readonly enabled: ReadonlySet<string>;

  /**
   * `enabled`: die Aktionen aus `SG_MOODLE_ACTIONS` (E12). Eine Aktion aus T1-24 ohne Eintrag gilt als nicht
   * umgesetzt, auch wenn ihr Handler im Code steht. `completion.set` und `notifications.mark_read` hängen nicht daran.
   */
  constructor(handlers: MoodleActionHandlers, enabled: Iterable<string> = []) {
    // Der Widerruf muss unter der Sperre laufen (08 §9.3): Sonst löst ein paralleles `execute` dazwischen noch einen
    // alten Code ein. Ein Handler mit `revokesScope` braucht darum `lockKey`
    for (const [id, handler] of Object.entries(handlers) as [
      string,
      MoodleActionHandler<unknown> | undefined,
    ][]) {
      if (handler?.revokesScope && !handler.lockKey) {
        throw new Error(`Moodle-Aktion ${id}: revokesScope ohne lockKey`);
      }
    }
    this.handlers = handlers;
    this.enabled = new Set([...enabled].filter((id) => GATED_ACTIONS.has(id)));
  }

  spec(id: MoodleActionId): MoodleActionSpec<unknown> {
    return MOODLE_ACTION_SPECS[id] as MoodleActionSpec<unknown>;
  }

  isImplemented(id: MoodleActionId): boolean {
    // Nur eigene Einträge: keine Kennung darf über den Prototyp (`constructor`, `__proto__`) einen Handler finden
    if (!Object.hasOwn(MOODLE_ACTION_SPECS, id) || !Object.hasOwn(this.handlers, id)) return false;
    return this.handlers[id] !== undefined && (UNGATED_ACTIONS.has(id) || this.enabled.has(id));
  }

  /** Fehlende Moodle-Funktionen, leer = alles da. Unbekannte Freigaben (null) zählen als vorhanden */
  missingFunctions(id: MoodleActionId, available: ReadonlySet<string> | null): string[] {
    if (available === null) return [];
    return this.spec(id).wsfunctions.filter((name) => !available.has(name));
  }

  catalog(available: ReadonlySet<string> | null): MoodleActionCatalog {
    const ids = Object.keys(MOODLE_ACTION_SPECS) as MoodleActionId[];
    return {
      items: ids.map((id) => {
        const s = this.spec(id);
        return {
          id,
          label: s.label,
          description: s.description,
          risk: s.risk,
          needs_confirmation: needsConfirmation(s.risk),
          // Ohne bekannte Freigaben (Moodle aus oder nicht erreichbar) ist nichts verfügbar
          available:
            this.isImplemented(id) && available !== null && this.missingFunctions(id, available).length === 0,
        };
      }),
    };
  }

  /** Prüft die Parameter, bevor Moodle angesprochen wird. Fehler → 400 `validation_failed` */
  parseParams(id: MoodleActionId, raw: unknown): unknown {
    const parsed = this.spec(id).params.safeParse(raw);
    if (!parsed.success) {
      throw new HttpError(400, 'validation_failed', 'Die Parameter der Aktion sind ungültig.', {
        in: 'body',
        issues: parsed.error.issues.map((issue) => ({
          path: ['params', ...issue.path.map(String)].join('.'),
          message: issue.message,
        })),
      });
    }
    return parsed.data;
  }

  handler(id: MoodleActionId): MoodleActionHandler<unknown> {
    const handler = this.isImplemented(id)
      ? (this.handlers[id] as MoodleActionHandler<unknown> | undefined)
      : undefined;
    if (!handler) {
      throw new HttpError(
        501,
        'moodle_action_not_implemented',
        `Die Aktion ${id} ist noch nicht umgesetzt.`,
        {
          action_id: id,
        },
      );
    }
    return handler;
  }
}

// ---------------------------------------------------------------------------------------------
// Umgesetzte Aktionen. `assign.*` steht in `actions/assign.ts`. Weitere (forum.*, message.send, calendar.*, files.*)
// folgen mit T1-24 und bleiben hinter `SG_MOODLE_ACTIONS`.

const completionSet: MoodleActionHandler<MoodleActionParamsMap['completion.set']> = {
  async preview(_ctx, params) {
    return {
      summary: params.completed
        ? `Aktivität ${params.cmid} in Moodle als erledigt markieren.`
        : `Aktivität ${params.cmid} in Moodle als nicht erledigt markieren.`,
      details: { cmid: params.cmid, completed: params.completed },
    };
  },
  async execute(ctx, params) {
    // Antwort nicht blind vertrauen: `null` oder ein Nicht-Objekt von Moodle darf nicht zum 500 führen
    const response = await ctx.client.write<{ status?: unknown } | null | undefined>(
      'core_completion_update_activity_completion_status_manually',
      { cmid: params.cmid, completed: params.completed },
    );
    const status = response?.status === true;
    return {
      summary: !status
        ? 'Moodle hat die Änderung nicht bestätigt.'
        : params.completed
          ? 'Als erledigt markiert.'
          : 'Als nicht erledigt markiert.',
      result: { status },
    };
  },
};

const notificationsMarkRead: MoodleActionHandler<MoodleActionParamsMap['notifications.mark_read']> = {
  async preview() {
    return { summary: 'Alle Moodle-Benachrichtigungen als gelesen markieren.' };
  },
  async execute(ctx) {
    const response = await ctx.client.write<unknown>('core_message_mark_all_notifications_as_read', {
      useridto: await ctx.userId(),
    });
    const done = response === true;
    return {
      summary: done
        ? 'Alle Benachrichtigungen sind als gelesen markiert.'
        : 'Moodle hat die Änderung nicht bestätigt.',
      result: { done },
    };
  },
};

/** Handler, die der Core heute mitbringt */
export const DEFAULT_ACTION_HANDLERS: MoodleActionHandlers = {
  ...createAssignHandlers(),
  'completion.set': completionSet,
  'notifications.mark_read': notificationsMarkRead,
};
