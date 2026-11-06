import { vi } from 'vitest';
import { createHash } from 'node:crypto';
import type {
  CalendarEvent,
  Device,
  ExerciseSheet,
  Marker,
  Module,
  Recording,
  Notebook,
  PairingCode,
  PairingRequest,
  SearchDegraded,
  SearchHitSlide,
  SearchHitTranscript,
  SearchResponse,
  SearchSnippetPart,
  Semester,
  Session,
  SessionTranscript,
  Settings,
  Slide,
  SlideDeck,
  SlideEvent,
  SlideSegment,
  TranscriptInfo,
  TranscriptLine,
} from '@sg/shared';

const USER = '0190f6a2-0000-7000-8000-000000000000';
const NOW = '2026-11-04T08:00:00Z';

export function makeSemester(overrides: Partial<Semester> = {}): Semester {
  return {
    id: '0190f6a2-0000-7000-8000-0000000000b1',
    user_id: USER,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    name: 'HS 2026',
    starts_on: null,
    ends_on: null,
    is_current: true,
    archived_at: null,
    ...overrides,
  };
}

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: '0190f6a2-0000-7000-8000-0000000000e1',
    user_id: USER,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    calendar_event_id: null,
    module_id: '0190f6a2-0000-7000-8000-0000000000a1',
    slide_deck_id: null,
    number: null,
    title: null,
    state: 'laeuft',
    started_at: NOW,
    ended_at: null,
    stop_reason: null,
    started_from: null,
    processing: {},
    review_state: 'offen',
    planned_starts_at: null,
    planned_ends_at: null,
    auto_stop_extended_until: null,
    ...overrides,
  };
}

export function makeModule(overrides: Partial<Module> = {}): Module {
  return {
    id: '0190f6a2-0000-7000-8000-0000000000a1',
    user_id: USER,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    semester_id: '0190f6a2-0000-7000-8000-0000000000b1',
    name: 'Datenbanksysteme',
    short_name: 'DBS',
    color: 'mod-03',
    ects: 6,
    exam_type: 'Klausur',
    lecturer: null,
    lang: 'de',
    description_md: null,
    settings: {},
    ...overrides,
  };
}

export function makeDeck(overrides: Partial<SlideDeck> = {}): SlideDeck {
  return {
    id: '0190f6a2-0000-7000-8000-0000000000d1',
    user_id: USER,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    module_id: '0190f6a2-0000-7000-8000-0000000000a1',
    session_id: null,
    title: 'VL 01 Einführung',
    sha256: 'a'.repeat(64),
    page_count: null,
    uploaded_at: NOW,
    ingest_state: 'neu',
    ...overrides,
  };
}

export function makeSheet(overrides: Partial<ExerciseSheet> = {}): ExerciseSheet {
  return {
    id: '0190f6a2-0000-7000-8000-0000000000e1',
    user_id: USER,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    module_id: '0190f6a2-0000-7000-8000-0000000000a1',
    title: 'Blatt 1',
    number: null,
    sha256: 'b'.repeat(64),
    page_count: null,
    due_at: null,
    has_solution: false,
    ingest_state: 'neu',
    ...overrides,
  };
}

export function makeSlides(deckId: string, count: number): Slide[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `0190f6a2-0000-7000-8000-${String(5000 + i).padStart(12, '0')}`,
    user_id: USER,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    deck_id: deckId,
    index: i + 1,
    width_pt: 720,
    height_pt: 405,
    text: '',
    text_blocks: [],
    vision_summary: null,
    title: null,
    chapter: null,
  }));
}

const SEG_ID = (n: number) => `0190f6a2-0000-7000-8000-${String(9000 + n).padStart(12, '0')}`;

/** Aufnahme für den Rückblick (VERTRAEGE §18.4): `full.m4a` beginnt bei `started_ms` (Sitzungszeit) */
export function makeRecording(overrides: Partial<Recording> = {}): Recording {
  return {
    id: '0190f6a2-0000-7000-8000-0000000000f1',
    user_id: USER,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    session_id: '0190f6a2-0000-7000-8000-0000000000e1',
    mime: 'audio/webm;codecs=opus',
    codec: 'opus',
    started_ms: 0,
    duration_ms: 600_000,
    state: 'vollstaendig',
    chunks_independent: false,
    chunk_count: 20,
    last_seq: 19,
    completed_at: NOW,
    ...overrides,
  };
}

/** Eine Transkriptzeile (`TranscriptLine`): Abschnitt `n`, Folie und Zeit in Sitzungszeit */
export function makeLine(
  n: number,
  startMs: number,
  endMs: number,
  text: string,
  slide: { id: string; index: number } | null,
  overrides: Partial<TranscriptLine> = {},
): TranscriptLine {
  return {
    segment_id: SEG_ID(n),
    part: 0,
    recording_id: '0190f6a2-0000-7000-8000-0000000000f1',
    slide_id: slide?.id ?? null,
    slide_index: slide?.index ?? null,
    start_ms: startMs,
    end_ms: endMs,
    text,
    lang: 'de',
    ...overrides,
  };
}

export function makeSlideSegment(
  n: number,
  slide: { id: string; index: number },
  startMs: number,
  endMs: number,
  overrides: Partial<SlideSegment> = {},
): SlideSegment {
  return {
    id: SEG_ID(500 + n),
    user_id: USER,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    session_id: '0190f6a2-0000-7000-8000-0000000000e1',
    slide_id: slide.id,
    slide_index: slide.index,
    start_ms: startMs,
    end_ms: endMs,
    source: 'log',
    confidence: 1,
    job_id: null,
    ...overrides,
  };
}

/** `TranscriptInfo` zu einer Aufnahme */
export function makeTranscriptInfo(overrides: Partial<TranscriptInfo> = {}): TranscriptInfo {
  return {
    id: '0190f6a2-0000-7000-8000-0000000000f2',
    user_id: USER,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    session_id: '0190f6a2-0000-7000-8000-0000000000e1',
    recording_id: '0190f6a2-0000-7000-8000-0000000000f1',
    job_id: '0190f6a2-0000-7000-8000-0000000000f3',
    finalize_job_id: '0190f6a2-0000-7000-8000-0000000000f4',
    provider: 'fake',
    model: 'fake',
    language: 'de',
    segment_count: 0,
    word_count: 0,
    audio_duration_ms: 600_000,
    stale: false,
    ...overrides,
  };
}

/** Antwort von `GET /sessions/{id}/transcript` ohne Inhalt: noch nichts transkribiert, keine Folienzuordnung */
export function makeTranscript(overrides: Partial<SessionTranscript> = {}): SessionTranscript {
  return {
    session_id: '0190f6a2-0000-7000-8000-0000000000e1',
    slide_deck_id: null,
    slide_source: null,
    slide_segments: [],
    transcripts: [],
    recordings: [],
    lines: [],
    stale: false,
    ...overrides,
  };
}

export function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: '0190f6a2-0000-7000-8000-0000000000c1',
    user_id: USER,
    // Älter als 24 h: nicht „neu gekoppelt“
    created_at: '2026-10-01T08:00:00Z',
    updated_at: NOW,
    deleted_at: null,
    name: 'iPad von Ilian',
    kind: 'ipad',
    last_seen_at: NOW,
    clock_offset_ms: null,
    app_version: '1.0',
    connected: false,
    ...overrides,
  };
}

/** Kopplung im Fake-Core (VERTRAEGE §12): Fenster, Anfragen und Zustand wie der Header `SG-Pairing-State` */
export interface FakePairing {
  window: PairingCode | null;
  state:
    | 'none'
    | 'open'
    | 'qr_only'
    | 'confirming'
    | 'expired'
    | 'paired'
    | 'closed_failures'
    | 'closed'
    | 'locked';
  requests: PairingRequest[];
  /** Laufende Nummer für Code und IDs */
  opened: number;
}

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

// ---------------------------------------------------------------------------------------------
// Suche (GET /search, VERTRAEGE §19.6): einfache, deterministische Antworten aus festen Beispieldaten
// ---------------------------------------------------------------------------------------------

type FixtureText = { text: string };
/** Ein Treffer der Beispieldaten; `text` ist der volle Text, den die Route zu `snippet` zerlegt */
export type SearchFixtureHit =
  (Omit<SearchHitSlide, 'snippet'> & FixtureText) | (Omit<SearchHitTranscript, 'snippet'> & FixtureText);

const SEARCH_MODULE = {
  id: '0190f6a2-0000-7000-8000-0000000000a3',
  name: 'Datenbanksysteme',
  short_name: 'DBS',
};
const searchId = (n: number) => `0190f6a2-0000-7000-8000-${String(5000 + n).padStart(12, '0')}`;

/** Erfundene Beispieldaten: zwei Folien und zwei Stellen im Gesagten zu „Normalform“, dazu eine Folie zu Indizes */
export const SEARCH_FIXTURE: SearchFixtureHit[] = [
  {
    kind: 'slide',
    chunk_id: searchId(1),
    score: 0.0325,
    module: SEARCH_MODULE,
    text: 'Die dritte Normalform verbietet transitive Abhängigkeiten',
    deck_id: searchId(100),
    deck_title: 'VL 7 Normalisierung',
    slide_index: 14,
    slide_title: '3NF',
  },
  {
    kind: 'slide',
    chunk_id: searchId(2),
    score: 0.0301,
    module: SEARCH_MODULE,
    text: 'Zweite Normalform: jedes Nichtschlüsselattribut hängt vom ganzen Schlüssel ab',
    deck_id: searchId(100),
    deck_title: 'VL 7 Normalisierung',
    slide_index: 12,
    slide_title: '2NF',
  },
  {
    kind: 'slide',
    chunk_id: searchId(3),
    score: 0.0164,
    module: SEARCH_MODULE,
    text: 'Ein Index beschleunigt die Suche nach Schlüsselwerten',
    deck_id: searchId(101),
    deck_title: 'VL 9 Indizes',
    slide_index: 3,
    slide_title: null,
  },
  {
    kind: 'transcript',
    chunk_id: searchId(4),
    score: 0.0161,
    module: SEARCH_MODULE,
    text: '… und das ist eben die dritte Normalform, das kommt auch in der Klausur …',
    session_id: searchId(200),
    session_number: 7,
    session_title: null,
    session_started_at: '2026-11-03T07:15:00Z',
    t_ms: 2_512_000,
    t_end_ms: 2_571_000,
  },
  {
    kind: 'transcript',
    chunk_id: searchId(5),
    score: 0.0159,
    module: SEARCH_MODULE,
    text: 'Bei der Normalform merkt ihr euch: erst die Schlüssel, dann die Abhängigkeiten',
    session_id: searchId(201),
    session_number: null,
    session_title: null,
    session_started_at: '2026-11-04T08:00:00Z',
    t_ms: 95_000,
    t_end_ms: 140_000,
  },
];

/** Zerlegt `text` so, dass jedes Wort, das mit einem Suchwort beginnt, ein Treffer ist (`hit`) */
export function fixtureSnippet(text: string, words: string[]): SearchSnippetPart[] {
  const parts: SearchSnippetPart[] = [];
  for (const piece of text.split(/([\p{L}\p{N}]+)/u)) {
    if (piece === '') continue;
    const hit = words.some((w) => /^[\p{L}\p{N}]+$/u.test(piece) && piece.toLowerCase().startsWith(w));
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += piece;
    else parts.push({ text: piece, hit });
  }
  return parts;
}

/** Antwort der Route: `fach:<kurzname>`, `typ:folie|gesagtes` und Wörter (Präfix nur am letzten Wort, wie §19.6) */
export function fixtureSearch(
  q: string,
  limit: number,
  fixtures: readonly SearchFixtureHit[],
  options: { degraded?: SearchDegraded } = {},
): SearchResponse {
  const tokens = q.normalize('NFC').split(/\s+/).filter(Boolean);
  const unresolved: string[] = [];
  const kinds: ('slide' | 'transcript')[] = [];
  const fach: string[] = [];
  const rest: string[] = [];
  for (const token of tokens) {
    const m = /^(fach|typ):(.*)$/i.exec(token);
    if (!m) rest.push(token);
    else if (m[1]!.toLowerCase() === 'typ') {
      const v = m[2]!.toLowerCase();
      if (v === 'folie') kinds.push('slide');
      else if (v === 'gesagtes') kinds.push('transcript');
      else unresolved.push(token);
    } else if (fixtures.some((f) => f.module.short_name?.toLowerCase() === m[2]!.toLowerCase())) {
      fach.push(m[2]!.toLowerCase());
    } else unresolved.push(token);
  }
  const words = (rest.join(' ').match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map((w) => w.toLowerCase());
  const prefixLast = !/\s$/.test(q);
  const matches = (text: string) => {
    const tokensOfText = (text.match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w.toLowerCase());
    return words.every((w, i) =>
      tokensOfText.some((t) => (i === words.length - 1 && prefixLast ? t.startsWith(w) : t === w)),
    );
  };
  const hits =
    unresolved.length > 0 || words.length === 0
      ? []
      : fixtures
          .filter((f) => kinds.length === 0 || kinds.includes(f.kind))
          .filter((f) => fach.length === 0 || fach.includes((f.module.short_name ?? '').toLowerCase()))
          .filter((f) => matches(f.text))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map(({ text, ...hit }) => ({ ...hit, snippet: fixtureSnippet(text, words) }));
  const degraded = options.degraded ?? null;
  return {
    query: rest.join(' '),
    mode: degraded ? 'text' : 'hybrid',
    degraded,
    filters: { module_ids: [], kinds, unresolved },
    hits: hits as SearchResponse['hits'],
    took_ms: 3,
  };
}

export interface FakeCore {
  semesters: Semester[];
  modules: Module[];
  decks: SlideDeck[];
  sheets: ExerciseSheet[];
  slides: Record<string, Slide[]>;
  /** Sessions für GET /sessions und POST /sessions/{id}/start|pause|resume|stop|extend (VERTRAEGE §7.2, §9.4) */
  sessions: Session[];
  /** Notizbücher für GET /notebooks?module_id (VERTRAEGE §7.4) */
  notebooks: Notebook[];
  /** Termine für GET /calendar/events/{id} (VERTRAEGE §7.3) */
  events: CalendarEvent[];
  /** GET /notebooks scheitert mit 500, solange true */
  failNotebooks: boolean;
  /** Antwort von GET /sessions/{id}/transcript je Session (VERTRAEGE §18.4); ohne Eintrag ein leeres Transkript */
  transcripts: Record<string, SessionTranscript>;
  /** GET /sessions/{id}/transcript scheitert mit 500, solange true */
  failTranscript: boolean;
  /** Treffer für GET /search (Standard: `SEARCH_FIXTURE`) */
  searchFixtures: SearchFixtureHit[];
  /** GET /search liefert nur die Wortsuche mit diesem Grund (`mode = text`) */
  searchDegraded: SearchDegraded;
  /** GET /search scheitert mit 500, solange true */
  failSearch: boolean;
  /** Für GET /sessions/{id}/snapshot (VERTRAEGE §7.2): Folienwechsel und Marker, `stream_seq`/`stream_op_id` */
  slideEvents: SlideEvent[];
  markers: Marker[];
  streamSeq: number;
  streamOpId: string | null;
  /** Die nächste Anfrage an eine Session-Aktion wird mit diesem Fehler abgelehnt */
  rejectNextSession: null | { status: number; code: string };
  /** Lässt das nächste `POST /sessions` (Anlegen) mit diesem Fehler scheitern */
  rejectNextCreate: null | { status: number; code: string };
  requests: RecordedRequest[];
  /** Der nächste Upload scheitert wie bei einer abgerissenen Verbindung; `after` = der Core hat ihn davor verarbeitet */
  failNextUpload: null | 'before' | 'after';
  /** Der nächste Upload wird mit diesem Fehler abgelehnt */
  rejectNextUpload: null | { status: number; code: string };
  /** Der nächste Upload wird als Dublette dieses Eintrags gemeldet (ID) */
  nextUploadDuplicateOf: string | null;
  /** Antworten auf POST mit Idempotency-Key (Replay wie beim echten Core) */
  idempotent: Map<string, { status: number; body: unknown }>;
  /** Setzt einen Foliensatz/ein Blatt auf `verarbeitet` und legt Folien an */
  finishIngest: (id: string, pages?: number) => void;
  /** Setzt einen Foliensatz/ein Blatt auf `fehler` (Einlesen gescheitert, Datei bleibt gespeichert) */
  failIngest: (id: string) => void;
  /** Solange true, scheitern alle Anfragen wie bei einem nicht laufenden Core */
  down: boolean;
  /** Hält `GET /sessions/{id}` an, bis das Promise erfüllt ist; die Antwort zeigt den Stand von vorher. `null` = nicht angehalten */
  getGate: Promise<void> | null;
  /** Halten GET /settings bzw. GET /calendar/events/{id} an, bis das Promise erfüllt ist. `null` = nicht angehalten */
  settingsGate: Promise<void> | null;
  eventGate: Promise<void> | null;
  /** Hält alle POSTs an, bis das Promise erfüllt ist (deterministisch statt Zeitfenster). `null` = nicht angehalten */
  postGate: Promise<void> | null;
  /** Stand von GET/PATCH /settings (Standards aus VERTRAEGE §14.1) */
  settings: Settings;
  /** Das nächste PATCH /settings wird mit diesem Fehler abgelehnt */
  rejectNextSettings: null | { status: number; code: string; message: string };
  /** Gekoppelte Geräte (GET/DELETE /devices) */
  devices: Device[];
  pairing: FakePairing;
  /** Ein Gerät fragt über pair/start an (Bonjour-Weg) */
  addPairingRequest: (name: string) => PairingRequest;
  /** Das iPad bestätigt mit dem richtigen Code: Gerät anlegen, Fenster `paired` */
  completePairing: (name?: string) => Device;
}

export function makeSettings(): Settings {
  return {
    general: { data_dir: '/Users/ich/Studien-Gehirn', content_lang: 'de', appearance: 'system' },
    lecture: {
      microphone_id: null,
      auto_stop_after_end_min: 10,
      auto_stop_quiet_window_min: 3,
      auto_stop_hard_after_end_min: 30,
      auto_stop_silence_min: 15,
      auto_stop_max_duration_min: 240,
      auto_stop_warning_s: 60,
      auto_stop_extend_min: 15,
      default_layout: 'standard',
      default_ink_mode: 'freie_seite',
      toolbar_side: 'rechts',
    },
    pen: {
      double_tap: 'radierer',
      squeeze: 'werkzeugpalette',
      shape_recognition: false,
      favorite_colors: [
        '#1E2A44FF',
        '#C92A2AFF',
        '#1864ABFF',
        '#2B8A3EFF',
        '#E67700FF',
        '#5F3DC4FF',
        '#495057FF',
        '#000000FF',
      ],
    },
    data: { backup_target: null, backup_encryption: false, backup_time: '03:00' },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Kleiner In-Memory-Core für die Web-Tests: /health, /semesters und /modules mit den Regeln des echten Core
 * (erstes Semester wird aktuell, is_current höchstens einmal, Farbvergabe, Soft-Delete). Ersetzt `fetch`.
 */
export function installFakeCore(
  initial: Partial<Pick<FakeCore, 'semesters' | 'modules' | 'decks' | 'sheets' | 'sessions' | 'down'>> = {},
) {
  let counter = 100;
  const newId = () => `0190f6a2-0000-7000-8000-${String(++counter).padStart(12, '0')}`;
  const core: FakeCore = {
    semesters: structuredClone(initial.semesters ?? []),
    modules: structuredClone(initial.modules ?? []),
    decks: structuredClone(initial.decks ?? []),
    sheets: structuredClone(initial.sheets ?? []),
    slides: {},
    sessions: structuredClone(initial.sessions ?? []),
    notebooks: [],
    events: [],
    failNotebooks: false,
    transcripts: {},
    failTranscript: false,
    searchFixtures: structuredClone(SEARCH_FIXTURE),
    searchDegraded: null,
    failSearch: false,
    slideEvents: [],
    markers: [],
    streamSeq: 0,
    streamOpId: null,
    rejectNextSession: null,
    rejectNextCreate: null,
    requests: [],
    failNextUpload: null,
    rejectNextUpload: null,
    nextUploadDuplicateOf: null,
    idempotent: new Map(),
    finishIngest(id, pages = 3) {
      const deck = core.decks.find((d) => d.id === id);
      if (deck) {
        deck.ingest_state = 'verarbeitet';
        deck.page_count = pages;
        core.slides[id] = makeSlides(id, pages);
      }
      const sheet = core.sheets.find((x) => x.id === id);
      if (sheet) {
        sheet.ingest_state = 'verarbeitet';
        sheet.page_count = pages;
      }
    },
    failIngest(id) {
      for (const item of [...core.decks, ...core.sheets]) if (item.id === id) item.ingest_state = 'fehler';
    },
    down: initial.down ?? false,
    postGate: null,
    getGate: null,
    settingsGate: null,
    eventGate: null,
    settings: makeSettings(),
    rejectNextSettings: null,
    devices: [],
    pairing: { window: null, state: 'none', requests: [], opened: 0 },
    addPairingRequest(name) {
      const request: PairingRequest = {
        request_id: newId(),
        pairing_id: '0190f6a2-0000-7000-8000-00000000ffff',
        device_name: name,
        kind: 'ipad',
        requested_at: new Date().toISOString(),
      };
      core.pairing.requests.push(request);
      return request;
    },
    completePairing(name = 'Neues iPad') {
      const now = new Date().toISOString();
      const created = makeDevice({ id: newId(), name, created_at: now, last_seen_at: now });
      core.devices.push(created);
      core.pairing.state = 'paired';
      core.pairing.requests = [];
      return created;
    },
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (core.down) throw new TypeError('Failed to fetch');
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname.replace(/^\/api\/v1/, '');
      const method = init?.method ?? 'GET';
      const form = init?.body instanceof FormData ? init.body : null;
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      core.requests.push({ method, path: path + url.search, body, headers });

      if (method === 'POST' && core.postGate) await core.postGate;
      if (core.down) throw new TypeError('Failed to fetch');

      const materialResponse = await handleMaterial(core, { path, method, url, body, form, headers, newId });
      if (materialResponse) return materialResponse;

      if (path === '/health') return json({ status: 'ok', db: 'ok', version: '0.0.0' });
      // GET /search (§19.6): 400 ohne Suchtext, sonst Treffer aus `core.searchFixtures`
      if (path === '/search' && method === 'GET') {
        if (core.failSearch) return json({ error: { code: 'internal', message: 'x' } }, 500);
        const q = url.searchParams.get('q') ?? '';
        const limit = Number(url.searchParams.get('limit') ?? 20);
        if (q.trim() === '' || q.trim().length > 200 || !(limit >= 1 && limit <= 50)) {
          return json({ error: { code: 'validation_failed', message: 'x' } }, 400);
        }
        return json(fixtureSearch(q, limit, core.searchFixtures, { degraded: core.searchDegraded }));
      }
      // Daten/Papierkorb (T1-18): leere Antworten, damit das gerenderte Panel nicht ins Leere fragt
      if (path === '/backups' && method === 'GET') {
        return json({
          status: {
            target: null,
            last_success_at: null,
            next_run_at: null,
            stale: false,
            running: false,
            restore_test: null,
          },
          items: [],
          next_cursor: null,
        });
      }
      if (path === '/trash' && method === 'GET') return json({ items: [], next_cursor: null });

      const devicesResponse = handleDevices(core, path, method, url);
      if (devicesResponse) return devicesResponse;

      if (path === '/settings' && method === 'GET') {
        if (core.settingsGate) await core.settingsGate;
        return json(core.settings);
      }
      if (path === '/settings' && method === 'PATCH') {
        if (core.rejectNextSettings) {
          const { status, code, message } = core.rejectNextSettings;
          core.rejectNextSettings = null;
          return json({ error: { code, message } }, status);
        }
        for (const [area, patch] of Object.entries(body ?? {})) {
          Object.assign((core.settings as unknown as Record<string, object>)[area] ?? {}, patch);
        }
        return json(core.settings);
      }

      if (path === '/semesters' && method === 'GET') {
        return json({ items: core.semesters.filter((s) => !s.deleted_at), next_cursor: null });
      }
      if (path === '/semesters' && method === 'POST') {
        const first = core.semesters.length === 0;
        const created = makeSemester({
          id: newId(),
          name: String(body?.name),
          is_current: (body?.is_current as boolean | undefined) ?? first,
        });
        if (created.is_current) core.semesters.forEach((s) => (s.is_current = false));
        core.semesters.unshift(created);
        return json(created, 201);
      }
      const semesterMatch = /^\/semesters\/([^/]+)$/.exec(path);
      if (semesterMatch && method === 'PATCH') {
        const target = core.semesters.find((s) => s.id === semesterMatch[1]);
        if (!target) return json({ error: { code: 'semester_not_found', message: 'x' } }, 404);
        if (body?.name !== undefined) target.name = String(body.name);
        if (body?.archived !== undefined) {
          target.archived_at = body.archived ? NOW : null;
          if (body.archived) target.is_current = false;
        }
        if (body?.is_current === true) {
          core.semesters.forEach((s) => (s.is_current = false));
          target.is_current = true;
        }
        return json(target);
      }

      if (path === '/modules' && method === 'GET') {
        const semesterId = url.searchParams.get('semester_id');
        return json({
          items: core.modules.filter((m) => !m.deleted_at && (!semesterId || m.semester_id === semesterId)),
          next_cursor: null,
        });
      }
      if (path === '/modules' && method === 'POST') {
        const used = new Set<string>(
          core.modules.filter((m) => m.semester_id === body?.semester_id).map((m) => m.color),
        );
        const free = Array.from({ length: 12 }, (_, i) => `mod-${String(i + 1).padStart(2, '0')}`).find(
          (c) => !used.has(c),
        );
        const created = makeModule({
          id: typeof body?.id === 'string' ? body.id : newId(),
          semester_id: String(body?.semester_id),
          name: String(body?.name),
          short_name: null,
          color: (body?.color as Module['color'] | undefined) ?? (free as Module['color']) ?? 'mod-01',
          ects: null,
          exam_type: null,
        });
        core.modules.push(created);
        return json(created, 201);
      }
      const moduleMatch = /^\/modules\/([^/]+)$/.exec(path);
      if (moduleMatch && method === 'PATCH') {
        const target = core.modules.find((m) => m.id === moduleMatch[1] && !m.deleted_at);
        if (!target) return json({ error: { code: 'module_not_found', message: 'x' } }, 404);
        // `settings` wird Schlüssel für Schlüssel zusammengeführt, `null` entfernt einen Schlüssel (VERTRAEGE §14.2)
        const { settings: patchSettings, ...rest } = (body ?? {}) as { settings?: Record<string, unknown> };
        Object.assign(target, rest, { updated_at: new Date().toISOString() });
        if (patchSettings) {
          const merged: Record<string, unknown> = { ...target.settings };
          for (const [k, v] of Object.entries(patchSettings)) {
            if (v === null) delete merged[k];
            else merged[k] = v;
          }
          target.settings = merged as Module['settings'];
        }
        return json(target);
      }
      if (moduleMatch && method === 'DELETE') {
        const target = core.modules.find((m) => m.id === moduleMatch[1] && !m.deleted_at);
        if (!target) return json({ error: { code: 'module_not_found', message: 'x' } }, 404);
        target.deleted_at = new Date().toISOString();
        return new Response(null, { status: 204 });
      }

      // GET /sessions?from&to&state&module_id (VERTRAEGE §7.2): from/to filtern auf coalesce(started_at, planned_starts_at, created_at)
      if (path === '/sessions' && method === 'GET') {
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        const states = url.searchParams.get('state')?.split(',');
        const moduleId = url.searchParams.get('module_id');
        const anchor = (x: Session) => Date.parse(x.started_at ?? x.planned_starts_at ?? x.created_at);
        const items = core.sessions
          .filter((x) => !x.deleted_at)
          .filter((x) => !states || states.includes(x.state))
          .filter((x) => !moduleId || x.module_id === moduleId)
          .filter((x) => !from || anchor(x) >= Date.parse(from))
          .filter((x) => !to || anchor(x) < Date.parse(to))
          .sort((a, b) => anchor(a) - anchor(b) || a.id.localeCompare(b.id));
        return json({ items, next_cursor: null });
      }

      // POST /sessions (§7.2): spontane Session im Zustand `bereit`
      if (path === '/sessions' && method === 'POST') {
        if (core.rejectNextCreate) {
          const { status, code } = core.rejectNextCreate;
          core.rejectNextCreate = null;
          return json({ error: { code, message: 'x' } }, status);
        }
        const moduleId = body?.module_id as string | undefined;
        if (!core.modules.some((m) => m.id === moduleId && !m.deleted_at)) {
          return json({ error: { code: 'module_not_found', message: 'x' } }, 404);
        }
        const id = (body?.id as string | undefined) ?? crypto.randomUUID();
        if (core.sessions.some((x) => x.id === id)) {
          return json({ error: { code: 'session_exists', message: 'x' } }, 409);
        }
        const stamp = new Date().toISOString();
        const created = makeSession({
          id,
          module_id: moduleId as string,
          state: 'bereit',
          started_at: null,
          created_at: stamp,
          updated_at: stamp,
        });
        core.sessions.push(created);
        return json(created, 201);
      }

      // GET /sessions/{id}/transcript (§18.4): `slide_id` filtert, Wörter nur mit `include_words=true`
      const transcriptOne = /^\/sessions\/([^/]+)\/transcript$/.exec(path);
      if (transcriptOne && method === 'GET') {
        const found = core.sessions.find((x) => x.id === transcriptOne[1] && !x.deleted_at);
        if (!found) return json({ error: { code: 'session_not_found', message: 'x' } }, 404);
        if (core.failTranscript) return json({ error: { code: 'internal', message: 'x' } }, 500);
        const stored = core.transcripts[found.id] ?? makeTranscript({ session_id: found.id });
        const result = structuredClone(stored);
        const slideId = url.searchParams.get('slide_id');
        if (slideId) result.lines = result.lines.filter((l) => l.slide_id === slideId);
        if (url.searchParams.get('include_words') !== 'true') for (const l of result.lines) delete l.words;
        return json(result);
      }

      // POST /sessions/{id}/reprocess (§18.5): die Schritte ab `from_step` stehen danach auf `wartet`
      const reprocessOne = /^\/sessions\/([^/]+)\/reprocess$/.exec(path);
      if (reprocessOne && method === 'POST') {
        const found = core.sessions.find((x) => x.id === reprocessOne[1] && !x.deleted_at);
        if (!found) return json({ error: { code: 'session_not_found', message: 'x' } }, 404);
        if (found.state !== 'beendet' && found.state !== 'verarbeitet') {
          return json(
            { error: { code: 'session_not_ended', message: 'x', details: { state: found.state } } },
            409,
          );
        }
        const steps = ['audio.finalize', 'transcribe', 'align.log'];
        const from = (body?.from_step as string | undefined) ?? 'transcribe';
        if (!steps.includes(from)) return json({ error: { code: 'validation_failed', message: 'x' } }, 400);
        const recordings = core.transcripts[found.id]?.recordings ?? [];
        if (from !== 'align.log' && !recordings.some((r) => r.chunk_count > 0)) {
          return json({ error: { code: 'session_no_audio', message: 'x' } }, 409);
        }
        for (const step of steps.slice(steps.indexOf(from))) found.processing[step] = 'wartet';
        found.updated_at = new Date().toISOString();
        return json({ session: structuredClone(found), jobs: [] }, 202);
      }

      // GET /sessions/{id}/snapshot (§7.2)
      const snapshotOne = /^\/sessions\/([^/]+)\/snapshot$/.exec(path);
      if (snapshotOne && method === 'GET') {
        const found = core.sessions.find((x) => x.id === snapshotOne[1] && !x.deleted_at);
        if (!found) return json({ error: { code: 'session_not_found', message: 'x' } }, 404);
        return json({
          session: structuredClone(found),
          slide_events: structuredClone(core.slideEvents.filter((e) => e.session_id === found.id)),
          markers: structuredClone(core.markers.filter((m) => m.session_id === found.id && !m.deleted_at)),
          photos: [],
          recordings: [],
          stream_seq: core.streamSeq,
          stream_op_id: core.streamOpId,
        });
      }

      // GET /sessions/{id}
      const sessionOne = /^\/sessions\/([^/]+)$/.exec(path);
      if (sessionOne && method === 'GET') {
        // Wie der echte Core: eine ID, die keine UUID ist, ergibt 400
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sessionOne[1] ?? '')) {
          return json({ error: { code: 'validation_failed', message: 'x' } }, 400);
        }
        const found = core.sessions.find((x) => x.id === sessionOne[1] && !x.deleted_at);
        // Die Antwort zeigt den Stand beim EINGANG der Anfrage (wie ein langsames Netz), auch wenn sie später kommt
        const snapshot = found ? structuredClone(found) : undefined;
        if (core.getGate) await core.getGate;
        return snapshot ? json(snapshot) : json({ error: { code: 'session_not_found', message: 'x' } }, 404);
      }

      // GET /calendar/events/{id} (§7.3)
      const eventOne = /^\/calendar\/events\/([^/]+)$/.exec(path);
      if (eventOne && method === 'GET') {
        if (core.eventGate) await core.eventGate;
        const found = core.events.find((x) => x.id === eventOne[1] && !x.deleted_at);
        return found
          ? json(structuredClone(found))
          : json({ error: { code: 'calendar_event_not_found', message: 'x' } }, 404);
      }

      // DELETE /sessions/{id} (§7.2): weich löschen; 409 `session_active`, wenn sie läuft oder pausiert
      if (sessionOne && method === 'DELETE') {
        const found = core.sessions.find((x) => x.id === sessionOne[1] && !x.deleted_at);
        if (!found) return json({ error: { code: 'session_not_found', message: 'x' } }, 404);
        if (found.state === 'laeuft' || found.state === 'pausiert') {
          return json({ error: { code: 'session_active', message: 'x' } }, 409);
        }
        found.deleted_at = new Date().toISOString();
        return new Response(null, { status: 204 });
      }

      // GET /notebooks?module_id (§7.4)
      if (path === '/notebooks' && method === 'GET') {
        if (core.failNotebooks) return json({ error: { code: 'internal', message: 'x' } }, 500);
        const moduleId = url.searchParams.get('module_id');
        return json({
          items: core.notebooks.filter((n) => !moduleId || n.module_id === moduleId),
          next_cursor: null,
        });
      }

      const sessionMatch = /^\/sessions\/([^/]+)\/(start|pause|resume|stop|extend)$/.exec(path);
      if (sessionMatch && method === 'POST') {
        if (core.rejectNextSession) {
          const { status, code } = core.rejectNextSession;
          core.rejectNextSession = null;
          return json({ error: { code, message: 'x' } }, status);
        }
        const target = core.sessions.find((x) => x.id === sessionMatch[1] && !x.deleted_at);
        if (!target) return json({ error: { code: 'session_not_found', message: 'x' } }, 404);
        const active = target.state === 'laeuft' || target.state === 'pausiert';
        const now = Date.now();
        const invalid = () => json({ error: { code: 'session_transition_invalid', message: 'x' } }, 409);
        const touch = () => (target.updated_at = new Date(now).toISOString());
        if (sessionMatch[2] === 'start') {
          // Gleicher Zielzustand ist kein Fehler (§9.1)
          if (target.state === 'laeuft' || target.state === 'pausiert') {
            return json({ session: target, ended_session: null });
          }
          if (target.state !== 'geplant' && target.state !== 'bereit' && target.state !== 'verpasst') {
            return invalid();
          }
          // Wie der Core: ein verpasster Termin lässt sich nur vor dem Terminende starten
          if (
            target.state === 'verpasst' &&
            target.planned_ends_at &&
            now >= Date.parse(target.planned_ends_at)
          ) {
            return invalid();
          }
          // Eine andere aktive Session endet vorher am Kalenderende, spätestens jetzt (§9.1)
          const other = core.sessions.find(
            (x) => x.id !== target.id && !x.deleted_at && (x.state === 'laeuft' || x.state === 'pausiert'),
          );
          if (other) {
            const plannedEnd = other.planned_ends_at
              ? Date.parse(other.planned_ends_at)
              : Number.POSITIVE_INFINITY;
            other.state = 'beendet';
            other.ended_at = new Date(Math.min(plannedEnd, now)).toISOString();
            other.stop_reason = 'kalenderende';
            other.updated_at = new Date(now).toISOString();
          }
          target.state = 'laeuft';
          target.started_at = new Date(now).toISOString();
          target.started_from = (body?.started_from as Session['started_from'] | undefined) ?? 'mac';
          touch();
          return json({ session: target, ended_session: other ?? null });
        }
        if (sessionMatch[2] === 'pause' || sessionMatch[2] === 'resume') {
          const [from, next] =
            sessionMatch[2] === 'pause'
              ? (['laeuft', 'pausiert'] as const)
              : (['pausiert', 'laeuft'] as const);
          if (target.state === next) return json(target);
          if (target.state !== from) return invalid();
          target.state = next;
          touch();
          return json(target);
        }
        if (sessionMatch[2] === 'stop') {
          if (active) {
            target.state = 'beendet';
            target.ended_at = new Date(now).toISOString();
            target.stop_reason = (body?.reason as Session['stop_reason'] | undefined) ?? 'manuell';
            target.updated_at = new Date(now).toISOString();
          } else if (target.state !== 'beendet' && target.state !== 'verarbeitet') {
            return json({ error: { code: 'session_transition_invalid', message: 'x' } }, 409);
          }
          return json(target);
        }
        if (!active) return json({ error: { code: 'session_not_active', message: 'x' } }, 409);
        const base = Math.max(now, Date.parse(target.auto_stop_extended_until ?? '') || 0);
        const minutes = (body?.minutes as number | undefined) ?? core.settings.lecture.auto_stop_extend_min;
        target.auto_stop_extended_until = new Date(base + minutes * 60_000).toISOString();
        target.updated_at = new Date(now).toISOString();
        return json(target);
      }

      return json({ error: { code: 'not_found', message: 'x' } }, 404);
    }),
  );
  return core;
}

interface MaterialCall {
  path: string;
  method: string;
  url: URL;
  body: Record<string, unknown> | null;
  form: FormData | null;
  headers: Record<string, string>;
  newId: () => string;
}

/** /slide-decks und /exercise-sheets des Fake-Core: Upload (multipart), Dublette, Listen, Detail, PATCH, DELETE. */
async function handleMaterial(core: FakeCore, call: MaterialCall): Promise<Response | null> {
  const { path, method, url, body, form, headers } = call;
  const kinds = [
    { prefix: '/slide-decks', list: core.decks as (SlideDeck | ExerciseSheet)[], deck: true },
    { prefix: '/exercise-sheets', list: core.sheets as (SlideDeck | ExerciseSheet)[], deck: false },
  ];
  for (const { prefix, list, deck } of kinds) {
    if (path === prefix && method === 'POST' && form) {
      const key = headers['Idempotency-Key'] ?? '';
      const stored = core.idempotent.get(key);
      if (stored) return json(stored.body, stored.status);
      if (core.failNextUpload === 'before') {
        core.failNextUpload = null;
        throw new TypeError('Failed to fetch');
      }
      if (core.rejectNextUpload) {
        const { status, code } = core.rejectNextUpload;
        core.rejectNextUpload = null;
        return json({ error: { code, message: 'x' } }, status);
      }
      const file = form.get('file') as File;
      const moduleId = String(form.get('module_id'));
      const sha256 = createHash('sha256').update(`${file.name}:${file.size}`).digest('hex');
      const forced = core.nextUploadDuplicateOf;
      core.nextUploadDuplicateOf = null;
      const existing = forced
        ? list.find((x) => x.id === forced)
        : list.find((x) => x.sha256 === sha256 && x.module_id === moduleId && !x.deleted_at);
      let status = 200;
      let result = { id: existing?.id ?? '', duplicate: true };
      if (!existing) {
        const sent = form.get('title');
        const title = typeof sent === 'string' && sent !== '' ? sent : file.name.replace(/\.pdf$/i, '');
        const id = call.newId();
        list.unshift(
          deck
            ? makeDeck({ id, module_id: moduleId, title, sha256 })
            : makeSheet({ id, module_id: moduleId, title, sha256 }),
        );
        status = 201;
        result = { id, duplicate: false };
      }
      core.idempotent.set(key, { status, body: result });
      if (core.failNextUpload === 'after') {
        core.failNextUpload = null;
        throw new TypeError('Failed to fetch');
      }
      return json(result, status);
    }
    if (path === prefix && method === 'GET') {
      const moduleId = url.searchParams.get('module_id');
      return json({
        items: list.filter((x) => !x.deleted_at && (!moduleId || x.module_id === moduleId)),
        next_cursor: null,
      });
    }
    const match = new RegExp(`^${prefix}/([^/]+)$`).exec(path);
    if (match) {
      const target = list.find((x) => x.id === match[1] && !x.deleted_at);
      if (!target) return json({ error: { code: 'not_found', message: 'x' } }, 404);
      if (method === 'GET') {
        return json(deck ? { deck: target, slides: core.slides[target.id] ?? [] } : target);
      }
      if (method === 'PATCH') {
        Object.assign(target, body);
        return json(target);
      }
      if (method === 'DELETE') {
        target.deleted_at = new Date().toISOString();
        return new Response(null, { status: 204 });
      }
    }
  }
  return null;
}

/** /devices und /devices/pairings* des Fake-Core (VERTRAEGE §7.5, §12) */
function handleDevices(core: FakeCore, path: string, method: string, url: URL): Response | null {
  if (path === '/devices/pairings' && method === 'DELETE') {
    const only = url.searchParams.get('pairing_id');
    const open = core.pairing.state === 'open' || core.pairing.state === 'qr_only';
    if (open && (!only || only === core.pairing.window?.pairing_id)) {
      core.pairing.state = 'closed';
      core.pairing.requests = [];
    }
    return new Response(null, { status: 204 });
  }
  if (path === '/devices' && method === 'GET') {
    return json({ items: core.devices.filter((d) => !d.deleted_at), next_cursor: null });
  }
  const deviceMatch = /^\/devices\/([0-9a-f-]{36})$/.exec(path);
  if (deviceMatch && method === 'DELETE') {
    const target = core.devices.find((d) => d.id === deviceMatch[1] && !d.deleted_at);
    if (!target) return json({ error: { code: 'device_not_found', message: 'x' } }, 404);
    target.deleted_at = new Date().toISOString();
    return new Response(null, { status: 204 });
  }
  if (path === '/devices/pairings' && method === 'POST') {
    const n = ++core.pairing.opened;
    // Zufälliger Teil: ein Schließen aus einem vorigen Test trifft so nie das Fenster dieses Tests
    const random = Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
    const pairingId = `0190f6a2-0000-4000-8000-${random}${String(n).padStart(4, '0')}`;
    const code = String(482913 + n)
      .padStart(6, '0')
      .slice(-6);
    const window: PairingCode = {
      pairing_id: pairingId,
      code,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      host: '192.168.1.20',
      port: 4710,
      qr_url: `sg://pair?v=1&host=192.168.1.20&port=4710&pairing_id=${pairingId}&code=${code}`,
    };
    core.pairing.window = window;
    core.pairing.state = 'open';
    core.pairing.requests = [];
    return json(window, 201);
  }
  if (path === '/devices/pairings/requests' && method === 'GET') {
    const open = core.pairing.state === 'open' || core.pairing.state === 'qr_only';
    return new Response(JSON.stringify({ items: open ? core.pairing.requests : [] }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'SG-Pairing-State': core.pairing.state,
        ...(core.pairing.window ? { 'SG-Pairing-Id': core.pairing.window.pairing_id } : {}),
      },
    });
  }
  const requestMatch = /^\/devices\/pairings\/requests\/([0-9a-f-]{36})$/.exec(path);
  if (requestMatch && method === 'DELETE') {
    const before = core.pairing.requests.length;
    core.pairing.requests = core.pairing.requests.filter((r) => r.request_id !== requestMatch[1]);
    if (core.pairing.requests.length === before) {
      return json({ error: { code: 'pairing_request_not_found', message: 'x' } }, 404);
    }
    return new Response(null, { status: 204 });
  }
  return null;
}
