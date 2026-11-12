// Aktionen `assign.save_draft` und `assign.submit` (T1-24 PR 3, Plan §4.3, §4.4, Issue #93 Punkt 4).
//
// NICHT GEPRÜFT (Plan §9): Alle Angaben zu Moodle-Funktionen, ihren Parametern und Antworten stammen aus dem
// Gedächtnis, es gab kein echtes Moodle zum Testen. Das betrifft `mod_assign_get_assignments` (Namen der Einstellungen
// in `configs`), `mod_assign_get_submission_status` (Aufbau von `lastattempt`, `plugins`, Gruppenabgabe über
// `teamsubmission`, ob `timemodified` sich bei jeder Änderung ändert, ob je Datei ein `contenthash` kommt),
// `mod_assign_save_submission` (`plugindata[...]`, ob ein fehlender Teil unverändert bleibt), `upload.php`,
// `mod_assign_submit_for_grading` (`acceptsubmissionstatement`) und `uploadfiles` in `core_webservice_get_site_info`.
// Darum liest jeder Handler defensiv, schreibt höchstens einmal je Funktion, liest danach den Stand neu und meldet
// Abweichungen als Warnung. Vor der Freigabe prüft der Owner jede Aktion einmal am echten Moodle (Plan §9.1).
import { createHash } from 'node:crypto';
import { HttpError } from '../../errors.ts';
import type {
  MoodleActionContext,
  MoodleActionHandler,
  MoodleActionOutcome,
  MoodleActionParamsMap,
  MoodleActionPreviewResult,
} from '../actions.ts';
import type { MoodleParams } from '../client.ts';
import { list, moodleId, rec, timestamp } from '../mappers.ts';
import type { StoredUpload } from '../uploads.ts';

type SaveDraftParams = MoodleActionParamsMap['assign.save_draft'];
type SubmitParams = MoodleActionParamsMap['assign.submit'];

export interface AssignHandlerOptions {
  /** Uhr in Millisekunden (Standard: `Date.now`). Nur für Tests */
  now?: () => number;
  /** Zeitzone der Anzeige in Warnungen (Standard: die des Rechners) */
  timeZone?: string;
}

// ---------- Kleine Helfer ----------

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function int(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) ? n : null;
}

/** Moodle liefert Wahrheitswerte als `true`/`false` oder als 0/1 (auch als Text) */
function flag(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

/** Unix-Sekunden, `0` und Unsinn → `null` (Moodle: 0 = nicht gesetzt) */
function seconds(value: unknown): number | null {
  const n = int(value);
  return n !== null && n > 0 ? n : null;
}

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

/** Vergleich nach Codepunkten, unabhängig von Sprache und Rechner (der Stand muss stabil sein) */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// eslint-disable-next-line no-control-regex -- Steuerzeichen werden bewusst entfernt
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** Namen aus Moodle: Steuerzeichen raus, höchstens 120 Zeichen (Plan §4.1) */
function cleanName(value: string): string {
  const text = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...text];
  return chars.length > 120 ? `${chars.slice(0, 120).join('')}…` : text;
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** HTML → Klartext für die Vorschau: alle Tags weg, die ersten 500 Zeichen (Plan §4.1) */
export function htmlToPreviewText(html: string): string {
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(CONTROL, (c) => (c === '\n' ? c : ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const chars = [...text];
  return chars.length > 500 ? `${chars.slice(0, 500).join('')}…` : text;
}

const sizeFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
/** „1,2 MB“, „300 KB“ (wie in der Web-App) */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${sizeFormat.format(bytes / 1024 / 1024)} MB`;
}

function reject(reason: string, message: string): HttpError {
  return new HttpError(409, 'moodle_action_rejected', message, { reason });
}

function invalidResponse(wsfunction: string): HttpError {
  return new HttpError(502, 'moodle_error', 'Moodle hat nicht in der erwarteten Form geantwortet.', {
    wsfunction,
    moodle_errorcode: 'response_invalid',
  });
}

/**
 * Antwort einer Schreibfunktion: Moodle meldet Erfolg als leere Warnliste. Eine nicht leere Liste ist ein Fehler.
 * Etwas anderes als eine Liste ist unklar, ob geschrieben wurde: `outcome_unknown`, damit die Web-App den Stand
 * neu lädt und nichts wiederholt.
 */
function assertNoWarnings(response: unknown, wsfunction: string): void {
  if (!Array.isArray(response)) {
    throw new HttpError(
      502,
      'moodle_error',
      'Moodle hat nicht in der erwarteten Form geantwortet. Ob die Änderung übernommen wurde, ist unklar.',
      { wsfunction, moodle_errorcode: 'response_invalid', outcome_unknown: true },
    );
  }
  if (response.length > 0) {
    const code = str(rec(response[0])?.warningcode);
    throw new HttpError(502, 'moodle_error', 'Moodle hat die Änderung abgelehnt.', {
      wsfunction,
      moodle_errorcode: code !== null && code !== '' ? code.slice(0, 100) : 'warning',
    });
  }
}

// ---------- Lesen aus Moodle ----------

interface AssignmentInfo {
  id: number;
  name: string;
  /** Unix-Sekunden, `null` = nicht gesetzt */
  dueDate: number | null;
  cutoffDate: number | null;
  allowFrom: number | null;
  requiresStatement: boolean;
  /** `submissiondrafts`: Gibt es einen Einreichen-Schritt? `null` = Moodle hat es nicht gemeldet */
  requiresSubmit: boolean | null;
  teamSubmission: boolean;
  /** `null` = unbekannt (Moodle lieferte keine `configs`) */
  fileEnabled: boolean | null;
  textEnabled: boolean | null;
  maxFiles: number | null;
  maxBytes: number | null;
  /** Nur Endungen in Kleinbuchstaben ohne Punkt; `null` = keine Einschränkung oder nicht auswertbar */
  fileTypes: string[] | null;
}

function parseAssignment(raw: unknown): AssignmentInfo | null {
  const r = rec(raw);
  const id = moodleId(r?.id);
  if (!r || id === null) return null;
  const configs = list(r.configs).map(rec);
  const config = (plugin: string, name: string): unknown =>
    configs.find((c) => c?.subtype === 'assignsubmission' && c.plugin === plugin && c.name === name)?.value;
  const known = configs.length > 0;
  const enabled = (plugin: string): boolean | null => (known ? flag(config(plugin, 'enabled')) : null);
  const positive = (value: unknown): number | null => {
    const n = int(value);
    return n !== null && n > 0 ? n : null;
  };
  // `filetypeslist`: nur auswerten, wenn jeder Eintrag eine Endung ist. Gruppen („document“) und MIME-Typen nicht
  const entries = (str(config('file', 'filetypeslist')) ?? '').split(/[\s,;]+/).filter((e) => e !== '');
  const fileTypes =
    entries.length > 0 && entries.every((e) => /^\.[a-z0-9]{1,16}$/i.test(e))
      ? entries.map((e) => e.slice(1).toLowerCase())
      : null;
  return {
    id,
    name: cleanName(str(r.name) ?? ''),
    dueDate: seconds(r.duedate),
    cutoffDate: seconds(r.cutoffdate),
    allowFrom: seconds(r.allowsubmissionsfromdate),
    requiresStatement: flag(r.requiresubmissionstatement),
    requiresSubmit:
      r.submissiondrafts === undefined || r.submissiondrafts === null ? null : flag(r.submissiondrafts),
    teamSubmission: flag(r.teamsubmission),
    fileEnabled: enabled('file'),
    textEnabled: enabled('onlinetext'),
    maxFiles: positive(config('file', 'maxfilesubmissions')),
    maxBytes: positive(config('file', 'maxsubmissionsizebytes')),
    fileTypes,
  };
}

async function readAssignments(ctx: MoodleActionContext, courseId: number | null): Promise<AssignmentInfo[]> {
  const raw: unknown = await ctx.client.read(
    'mod_assign_get_assignments',
    courseId === null ? {} : { courseids: [courseId] },
  );
  const root = rec(raw);
  if (!root) throw invalidResponse('mod_assign_get_assignments');
  return list(root.courses).flatMap((course) =>
    list(rec(course)?.assignments).flatMap((item) => parseAssignment(item) ?? []),
  );
}

/** Zuerst über die Kurs-ID aus der lokalen Datenbank (kleiner Aufruf), sonst über alle Kurse */
async function findAssignment(ctx: MoodleActionContext, assignmentId: number): Promise<AssignmentInfo> {
  const course = await ctx.courseIdOfAssignment(assignmentId).catch(() => null);
  let found = (await readAssignments(ctx, course)).find((a) => a.id === assignmentId);
  if (!found && course !== null)
    found = (await readAssignments(ctx, null)).find((a) => a.id === assignmentId);
  if (!found) throw reject('nicht_gefunden', 'Diese Aufgabe gibt es in Moodle nicht (mehr).');
  return found;
}

interface DraftFile {
  /** Für die Anzeige bereinigt und gekürzt */
  name: string;
  /** Roh aus Moodle, nur für den Stand: Ordner plus Name (ungekürzt, damit jede Umbenennung zählt) */
  key: string;
  bytes: number;
  modified: number | null;
  /** Nur, wenn Moodle einen liefert (N4) */
  contenthash: string | null;
}

interface SubmissionInfo {
  submissionId: number | null;
  status: string | null;
  timemodified: number | null;
  attempt: number | null;
  files: DraftFile[];
  /** Roher HTML-Text der Online-Text-Abgabe, `null` ohne Text */
  text: string | null;
  canEdit: boolean;
  canSubmit: boolean;
  /** Text der Erklärung, falls Moodle ihn liefert (N5), als Klartext */
  statementText: string | null;
}

async function readSubmission(ctx: MoodleActionContext, assignmentId: number): Promise<SubmissionInfo> {
  const raw: unknown = await ctx.client.read('mod_assign_get_submission_status', { assignid: assignmentId });
  const root = rec(raw);
  if (!root) throw invalidResponse('mod_assign_get_submission_status');
  const last = rec(root.lastattempt);
  // Bei Gruppenabgaben zählt die Gruppenabgabe, wie im Mapper der Lese-Endpunkte
  const submission = rec(last?.teamsubmission) ?? rec(last?.submission);
  const plugins = list(submission?.plugins).map(rec);
  const filePlugin = plugins.find((p) => p?.type === 'file') ?? null;
  const textPlugin = plugins.find((p) => p?.type === 'onlinetext') ?? null;
  const files = list(filePlugin?.fileareas).flatMap((area) => list(rec(area)?.files));
  const draftFiles: DraftFile[] = files.flatMap((item) => {
    const f = rec(item);
    const name = str(f?.filename);
    if (!f || name === null || name === '') return [];
    return [
      {
        name: cleanName(name),
        key: `${str(f.filepath) ?? '/'}${name}`,
        bytes: Math.max(0, int(f.filesize) ?? 0),
        modified: seconds(f.timemodified),
        contenthash: str(f.contenthash) || null,
      },
    ];
  });
  const textField = list(textPlugin?.editorfields).map(rec)[0];
  const text = str(textField?.text);
  const statement = str(last?.submissionstatement) ?? str(root.submissionstatement);
  return {
    submissionId: moodleId(submission?.id),
    status: str(submission?.status),
    timemodified: seconds(submission?.timemodified),
    attempt: int(submission?.attemptnumber),
    files: draftFiles,
    text: text !== null && text.trim() !== '' ? text : null,
    canEdit: flag(last?.canedit),
    canSubmit: flag(last?.cansubmit),
    statementText: statement !== null && statement.trim() !== '' ? htmlToPreviewText(statement) : null,
  };
}

/** `uploadfiles` aus `core_webservice_get_site_info`: `false` nur, wenn Moodle es ausdrücklich verneint */
async function uploadsAllowed(ctx: MoodleActionContext): Promise<boolean> {
  const raw: unknown = await ctx.client.read('core_webservice_get_site_info');
  const value = rec(raw)?.uploadfiles;
  return value === undefined || value === null ? true : flag(value);
}

// ---------- Stand (E1, Plan §5.2) ----------

function draftFilesState(files: readonly DraftFile[]) {
  return files
    .map((f) => ({ name: f.key, bytes: f.bytes, timemodified: f.modified, contenthash: f.contenthash }))
    .sort(
      (a, b) =>
        byText(a.name, b.name) ||
        a.bytes - b.bytes ||
        (a.timemodified ?? 0) - (b.timemodified ?? 0) ||
        byText(a.contenthash ?? '', b.contenthash ?? ''),
    );
}

/**
 * Stand des Entwurfs. Keine Uhrzeit, Listen sortiert. Liefert Moodle keinen Entwurf, ist `submission_id` `null`, der
 * Stand selbst aber nie `null` (so bleiben „kein Entwurf“ und „Lesen fehlgeschlagen“ getrennt).
 */
function submissionState(a: AssignmentInfo, s: SubmissionInfo) {
  return {
    submission_id: s.submissionId,
    status: s.status,
    timemodified: s.timemodified,
    attemptnumber: s.attempt,
    dateien: draftFilesState(s.files),
    text_sha256: s.text === null ? null : sha256(s.text),
    requires_submit: a.requiresSubmit,
  };
}

/** Was in diesem Aufruf gelesen wurde. Gehört zu genau einem Stand-Objekt (siehe `snapshots`) */
interface Snapshot {
  assignment: AssignmentInfo;
  submission: SubmissionInfo;
  uploads: StoredUpload[];
  /** `false`: Moodle verneint Uploads ausdrücklich (nur gelesen, wenn Dateien kommen) */
  uploadsAllowed: boolean;
}

/**
 * Die Route reicht dasselbe Stand-Objekt an `preview` und `execute` weiter. So liest ein Aufruf Moodle nur einmal,
 * und Vorprüfung und Code-Bindung sehen denselben Stand. Fehlt der Eintrag (direkter Aufruf), wird neu gelesen.
 */
const snapshots = new WeakMap<object, Snapshot>();

/**
 * `assign.save_draft`: Was `requiresConfirmation` für genau dieses Parameter-Objekt ergeben hat. Die Route reicht
 * dasselbe Objekt an `requiresConfirmation`, `state` und `execute`. Hat sich die Aufgabe zwischen beiden Lesevorgängen
 * auf „ohne Einreichen-Schritt“ umgestellt, wäre das Speichern sonst eine Abgabe ohne Code.
 */
const confirmationDecided = new WeakMap<object, boolean>();

function uploadsOf(ctx: MoodleActionContext, ids: readonly string[] | undefined): StoredUpload[] {
  // Unbekannt oder verfallen → 404, bevor Moodle angesprochen wird
  return ids === undefined ? [] : ctx.uploads.resolve(ids);
}

async function snapshotOf(
  ctx: MoodleActionContext,
  assignmentId: number,
  uploads: StoredUpload[],
): Promise<Snapshot> {
  const assignment = await findAssignment(ctx, assignmentId);
  const submission = await readSubmission(ctx, assignmentId);
  return {
    assignment,
    submission,
    uploads,
    uploadsAllowed: uploads.length > 0 ? await uploadsAllowed(ctx) : true,
  };
}

async function snapshotFor(
  ctx: MoodleActionContext,
  state: unknown,
  assignmentId: number,
  ids: readonly string[] | undefined,
): Promise<Snapshot> {
  if (typeof state === 'object' && state !== null) {
    const known = snapshots.get(state);
    if (known) return known;
  }
  return snapshotOf(ctx, assignmentId, uploadsOf(ctx, ids));
}

function remember(state: object, snapshot: Snapshot): void {
  snapshots.set(state, snapshot);
}

// ---------- Vorprüfungen (409 `moodle_action_rejected`, bevor etwas geschrieben wird) ----------

function whyNotEditable(a: AssignmentInfo, s: SubmissionInfo, nowSec: number): HttpError {
  if (s.status === 'submitted') return reject('schon_eingereicht', 'Diese Aufgabe ist schon eingereicht.');
  if (a.cutoffDate !== null && nowSec > a.cutoffDate) {
    return reject('frist_vorbei', 'Die Frist ist vorbei, Moodle nimmt keine Abgabe mehr an.');
  }
  if (a.allowFrom !== null && nowSec < a.allowFrom) {
    return reject('noch_nicht_offen', 'Die Abgabe ist noch nicht geöffnet.');
  }
  return reject('nicht_bearbeitbar', 'Diese Abgabe lässt sich gerade nicht bearbeiten.');
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

function assertCanSave(params: SaveDraftParams, snap: Snapshot, nowSec: number): void {
  const { assignment: a, submission: s, uploads } = snap;
  if (!s.canEdit) throw whyNotEditable(a, s, nowSec);
  const notAllowed = () =>
    reject('abgabeart_nicht_erlaubt', 'Diese Aufgabe nimmt diese Art der Abgabe nicht an.');
  if (params.upload_ids !== undefined && a.fileEnabled === false) throw notAllowed();
  if (params.online_text_html !== undefined && a.textEnabled === false) throw notAllowed();
  if (a.maxFiles !== null && uploads.length > a.maxFiles) {
    throw reject('zu_viele_dateien', 'Das sind mehr Dateien, als die Aufgabe erlaubt.');
  }
  if (a.maxBytes !== null && uploads.some((u) => u.sizeBytes > a.maxBytes!)) {
    throw reject('datei_zu_gross', 'Eine Datei ist größer, als die Aufgabe erlaubt.');
  }
  const types = a.fileTypes;
  if (types !== null && uploads.some((u) => !types.includes(extensionOf(u.filename)))) {
    throw reject('dateityp_nicht_erlaubt', 'Diese Aufgabe nimmt diesen Dateityp nicht an.');
  }
  if (!snap.uploadsAllowed) {
    throw reject('uploads_nicht_freigegeben', 'Dein Moodle-Zugang erlaubt keine Uploads.');
  }
}

function hasDraft(s: SubmissionInfo): boolean {
  return s.status === 'draft' && (s.files.length > 0 || s.text !== null);
}

function assertCanSubmit(params: SubmitParams, snap: Snapshot, nowSec: number): void {
  const { assignment: a, submission: s } = snap;
  // Ohne Einreichen-Schritt ist Speichern schon die Abgabe
  if (a.requiresSubmit === false) {
    throw reject('nichts_einzureichen', 'Bei dieser Aufgabe gibt es keinen Einreichen-Schritt.');
  }
  if (s.status === 'submitted') throw reject('schon_eingereicht', 'Diese Aufgabe ist schon eingereicht.');
  if (!hasDraft(s)) {
    throw reject('nichts_einzureichen', 'Es gibt nichts einzureichen. Speichere zuerst einen Entwurf.');
  }
  if (!s.canSubmit) throw whyNotEditable(a, s, nowSec);
  if (a.requiresStatement && !params.accept_statement) {
    throw reject('erklaerung_fehlt', 'Die Erklärung zur Eigenständigkeit muss bestätigt sein.');
  }
}

// ---------- Vorschau ----------

const fileLines = (files: readonly { name: string; bytes: number }[]) =>
  files.map((f) => ({ name: f.name, size_bytes: f.bytes }));

function listFiles(files: readonly { name: string; bytes: number }[]): string {
  return files.map((f) => `${f.name} (${formatSize(f.bytes)})`).join(', ');
}

function iso(sec: number | null): string | null {
  return sec === null ? null : timestamp(sec);
}

function sameContent(a: SubmissionInfo, b: SubmissionInfo): boolean {
  return (
    JSON.stringify(draftFilesState(a.files)) === JSON.stringify(draftFilesState(b.files)) &&
    (a.text === null ? null : sha256(a.text)) === (b.text === null ? null : sha256(b.text))
  );
}

function stateName(s: SubmissionInfo): 'eingereicht' | 'entwurf' | 'keine' {
  return s.status === 'submitted' ? 'eingereicht' : s.status === 'draft' ? 'entwurf' : 'keine';
}

export function createAssignHandlers(options: AssignHandlerOptions = {}): {
  'assign.save_draft': MoodleActionHandler<SaveDraftParams>;
  'assign.submit': MoodleActionHandler<SubmitParams>;
} {
  const nowMs = options.now ?? Date.now;
  const nowSec = () => Math.floor(nowMs() / 1000);
  const clock = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });
  /** „12.11. 14:03“ */
  const moment = (sec: number): string => {
    const part = (type: string) =>
      clock.formatToParts(new Date(sec * 1000)).find((p) => p.type === type)?.value;
    return `${part('day')}.${part('month')}. ${part('hour')}:${part('minute')}`;
  };

  /** Warnungen, die für Speichern und Einreichen gleich gelten */
  function commonWarnings(a: AssignmentInfo): string[] {
    const out: string[] = [];
    if (a.dueDate !== null && nowSec() > a.dueDate) {
      out.push(`Die Frist ist seit ${moment(a.dueDate)} abgelaufen. Die Abgabe gilt als verspätet.`);
    }
    if (a.teamSubmission) out.push('Gruppenabgabe: Das gilt für die ganze Gruppe.');
    return out;
  }

  const saveDraft: MoodleActionHandler<SaveDraftParams> = {
    // Ohne Einreichen-Schritt ist Speichern schon die Abgabe: dann nur mit Code. Unbekannt zählt als „ja“
    async requiresConfirmation(ctx, params) {
      uploadsOf(ctx, params.upload_ids);
      const needed = (await findAssignment(ctx, params.assignment_id)).requiresSubmit !== true;
      confirmationDecided.set(params, needed);
      return needed;
    },
    async state(ctx, params) {
      const snap = await snapshotOf(ctx, params.assignment_id, uploadsOf(ctx, params.upload_ids));
      const state = {
        ...submissionState(snap.assignment, snap.submission),
        // Der Inhalt eines Uploads ist unveränderlich (E5): Der Code gilt für genau diese Dateien
        uploads: snap.uploads
          .map((u) => ({ sha256: u.sha256, bytes: u.sizeBytes, name: u.filename }))
          .sort((x, y) => byText(x.sha256, y.sha256) || byText(x.name, y.name)),
      };
      remember(state, snap);
      return state;
    },
    lockKey: (params) => `assign:${params.assignment_id}`,
    scope: (params) => `assign:${params.assignment_id}`,
    revokesScope: (params) => `assign:${params.assignment_id}`,

    async preview(ctx, params, state): Promise<MoodleActionPreviewResult> {
      const snap = await snapshotFor(ctx, state, params.assignment_id, params.upload_ids);
      assertCanSave(params, snap, nowSec());
      const { assignment: a, submission: s, uploads } = snap;
      const name = a.name || 'Aufgabe';
      const files = uploads.map((u) => ({ name: cleanName(u.filename), bytes: u.sizeBytes }));
      const what = [
        files.length > 0 ? (files.length === 1 ? '1 Datei' : `${files.length} Dateien`) : null,
        params.online_text_html !== undefined ? 'Text' : null,
      ]
        .filter((p) => p !== null)
        .join(' und ');
      const warnings: string[] = [];
      if (s.files.length > 0 && files.length > 0) {
        warnings.push(`Ersetzt den bisherigen Entwurf: ${s.files.map((f) => f.name).join(', ')}.`);
      } else if (s.files.length > 0) {
        warnings.push(
          `Bisherige Dateien: ${s.files.map((f) => f.name).join(', ')}. Nach dem Speichern wird geprüft, ob sie noch da sind.`,
        );
      }
      if (a.requiresSubmit !== true) warnings.push('Bei dieser Aufgabe ist Speichern schon die Abgabe.');
      warnings.push(...commonWarnings(a));
      const text = params.online_text_html === undefined ? null : htmlToPreviewText(params.online_text_html);
      return {
        summary:
          `${what} als Entwurf in ‚${name}‘ speichern` + (files.length > 0 ? `: ${listFiles(files)}.` : '.'),
        warnings,
        details: {
          assignment_id: a.id,
          assignment_name: name,
          files: fileLines(files),
          ...(text !== null ? { text_preview: text } : {}),
          last_modified_at: iso(s.timemodified),
          due_at: iso(a.dueDate),
        },
      };
    },

    async execute(ctx, params, state): Promise<MoodleActionOutcome> {
      const snap = await snapshotFor(ctx, state, params.assignment_id, params.upload_ids);
      assertCanSave(params, snap, nowSec());
      // Ohne Code freigegeben, aber jetzt ist Speichern die Abgabe: nichts schreiben, die Web-App holt die Vorschau
      if (confirmationDecided.get(params) === false && snap.assignment.requiresSubmit !== true) {
        throw new HttpError(
          409,
          'moodle_confirmation_required',
          'Bei dieser Aufgabe ist Speichern schon die Abgabe. Bitte zuerst die Vorschau abrufen.',
        );
      }
      const ids = params.upload_ids ?? [];
      // Als „in Benutzung“ markieren, solange die Dateien gelesen werden (kein Löschen mittendrin)
      const used = ids.length > 0 ? ctx.uploads.acquire(ids) : [];
      try {
        // Der Stand wurde schon gelesen. Der Upload ändert den Entwurf noch nicht
        let itemid: number | null = null;
        if (used.length > 0) {
          itemid = (
            await ctx.client.uploadDraft(
              used.map((u) => ({ path: u.path, filename: u.filename, sizeBytes: u.sizeBytes })),
            )
          ).itemid;
        }
        // Nur schicken, was die Nutzerin angibt (N3): Fehlt ein Teil, bleibt sein Feld weg
        const plugindata: { [key: string]: number | { text: string; format: number; itemid: number } } = {};
        if (itemid !== null) plugindata.files_filemanager = itemid;
        if (params.online_text_html !== undefined) {
          plugindata.onlinetext_editor = { text: params.online_text_html, format: 1, itemid: itemid ?? 0 };
        }
        const request: MoodleParams = { assignmentid: params.assignment_id, plugindata };
        assertNoWarnings(
          await ctx.client.write('mod_assign_save_submission', request),
          'mod_assign_save_submission',
        );
      } finally {
        ctx.uploads.release(ids);
      }
      if (used.length > 0) await ctx.uploads.removeUnused(ids).catch(() => {});

      // Nachlesen: melden, was Moodle wirklich zeigt. Scheitert nur das, gilt die Aktion als gelungen
      const after = await readSubmission(ctx, params.assignment_id).catch(() => null);
      if (after === null) {
        return {
          summary:
            'Entwurf gespeichert. Der neue Stand konnte nicht gelesen werden, bitte prüfe ihn in Moodle.',
          result: { state: null, files: null, last_modified_at: null, verified: false, warnings: [] },
        };
      }
      const warnings: string[] = [];
      const present = new Set(after.files.map((f) => f.name));
      if (used.length > 0) {
        const missing = used.map((u) => cleanName(u.filename)).filter((n) => !present.has(n));
        if (missing.length > 0) warnings.push(`Nicht im Entwurf gefunden: ${missing.join(', ')}.`);
      } else {
        const lost = snap.submission.files.map((f) => f.name).filter((n) => !present.has(n));
        if (lost.length > 0) {
          warnings.push(
            `Nicht mehr im Entwurf: ${lost.join(', ')}. Moodle hat die Dateien beim Speichern entfernt.`,
          );
        }
      }
      if (params.online_text_html === undefined && snap.submission.text !== null && after.text === null) {
        warnings.push('Der bisherige Text fehlt jetzt im Entwurf.');
      }
      return {
        summary: warnings.length > 0 ? 'Entwurf gespeichert, aber mit Abweichungen.' : 'Entwurf gespeichert.',
        result: {
          state: stateName(after),
          files: fileLines(after.files),
          last_modified_at: iso(after.timemodified),
          verified: true,
          warnings,
        },
      };
    },
  };

  const submit: MoodleActionHandler<SubmitParams> = {
    async state(ctx, params) {
      const snap = await snapshotOf(ctx, params.assignment_id, []);
      const state = {
        ...submissionState(snap.assignment, snap.submission),
        requires_statement: snap.assignment.requiresStatement,
      };
      remember(state, snap);
      return state;
    },
    lockKey: (params) => `assign:${params.assignment_id}`,
    scope: (params) => `assign:${params.assignment_id}`,

    async preview(ctx, params, state): Promise<MoodleActionPreviewResult> {
      const snap = await snapshotFor(ctx, state, params.assignment_id, undefined);
      assertCanSubmit(params, snap, nowSec());
      const { assignment: a, submission: s } = snap;
      const name = a.name || 'Aufgabe';
      const parts = [
        ...(s.files.length > 0 ? [listFiles(s.files)] : []),
        ...(s.text !== null ? ['Online-Text'] : []),
      ].join(', ');
      const changed = s.timemodified !== null ? `, zuletzt geändert ${moment(s.timemodified)}` : '';
      const text = s.text === null ? null : htmlToPreviewText(s.text);
      return {
        summary: `Abgabe ‚${name}‘ endgültig einreichen: ${parts}${changed}. Danach sind keine Änderungen mehr möglich.`,
        warnings: commonWarnings(a),
        details: {
          assignment_id: a.id,
          assignment_name: name,
          files: fileLines(s.files),
          ...(text !== null && text !== '' ? { text_preview: text } : {}),
          last_modified_at: iso(s.timemodified),
          due_at: iso(a.dueDate),
          requires_statement: a.requiresStatement,
          ...(a.requiresStatement && s.statementText !== null ? { statement_text: s.statementText } : {}),
        },
      };
    },

    async execute(ctx, params, state): Promise<MoodleActionOutcome> {
      const snap = await snapshotFor(ctx, state, params.assignment_id, undefined);
      assertCanSubmit(params, snap, nowSec());
      assertNoWarnings(
        await ctx.client.write('mod_assign_submit_for_grading', {
          assignmentid: params.assignment_id,
          acceptsubmissionstatement: params.accept_statement,
        }),
        'mod_assign_submit_for_grading',
      );
      const after = await readSubmission(ctx, params.assignment_id).catch(() => null);
      if (after === null) {
        return {
          summary: 'Eingereicht. Der neue Stand konnte nicht gelesen werden, bitte prüfe ihn in Moodle.',
          result: { state: 'eingereicht', last_modified_at: null, verified: false, warnings: [] },
        };
      }
      const warnings: string[] = [];
      // Restrisiko (Plan §4.4): Zwischen Neulesen und Einreichen kann jemand den Entwurf direkt in Moodle ändern
      if (!sameContent(snap.submission, after)) {
        warnings.push(
          'Der Entwurf hat sich kurz vor dem Einreichen geändert. Eingereicht ist der aktuelle Stand.',
        );
      }
      if (after.status !== 'submitted') {
        warnings.push(
          'Moodle zeigt die Aufgabe nach dem Einreichen nicht als eingereicht. Bitte prüfe sie in Moodle.',
        );
      }
      return {
        summary: warnings.length > 0 ? 'Eingereicht, aber mit Abweichungen.' : 'Endgültig eingereicht.',
        result: {
          state: after.status === 'submitted' ? 'eingereicht' : stateName(after),
          last_modified_at: iso(after.timemodified),
          verified: true,
          warnings,
        },
      };
    },
  };

  return { 'assign.save_draft': saveDraft, 'assign.submit': submit };
}
