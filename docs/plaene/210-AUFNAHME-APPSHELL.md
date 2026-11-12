# Plan: Recorder in die App-Shell (#210 Teil 3, UX-01, UX-59)

Stand: 12. November 2026 · Basis: `main` (`f045634`) **plus PR #246** (`claude/vertrag-aufnahme-app-weit`, Vertrag §11.8).
Den Code schreibt Sonnet, ein frischer Opus-Subagent reviewt. Der Plan ist so geschrieben, dass keine Rückfragen nötig sind.

Quellen: Issue #210 mit beiden Kommentaren, `docs/VERTRAEGE.md` §9.1, §9.4, §10.1, §11.8, §16.2, §16.3 (Fassung aus #246), `docs/ux/STUDIENALLTAG-2.md` (UX-01, UX-59), `docs/anleitungen/VORLESUNGSTAG.md`.

Alle Pfade ohne Präfix liegen unter `apps/web/`.

---

## 1. Ziel und Abgrenzung

### 1.1 Ziel

1. Die Aufnahme hängt an der App-Shell. Sie folgt der **aktiven** Session und läuft beim Navigieren weiter (UX-01).
2. Außerhalb des Dashboards zeigt eine schmale **Aufnahme-Leiste** den Zustand, „Aufnahme starten“, die Rückfrage des Auto-Stopps und den Link „Zur Vorlesung“.
3. Wer für Einstellungen → Geräte das Dashboard verlässt, verliert keine Aufnahme mehr (UX-59).
4. Der Auto-Stopp läuft in jedem Tab, auf jeder Route.
5. „Heute“ sagt die Wahrheit über die Aufnahme. Der Fall „Leader-Tab liegt auf Heute, niemand nimmt auf“ (#210, Kommentar 2) verschwindet.

### 1.2 Was heute da ist (mit Beleg)

| Baustein | Stand heute | Beleg |
|---|---|---|
| Recorder je Dashboard | `useSessionRecording(session, client)` legt im Effekt `AudioRecorder` und `LeaderRecording` an, Schlüssel ist `session.id`. Beim Unmount: `control.dispose()`, `idle()`, `flushUploads(8000)`, `notifyUploadsPending()`, `recorder.dispose()`. | `src/components/dashboard/use-recording.ts` |
| Aufrufer | Nur `StatusBar`. Dort auch `useAutoStop`, `usePausedSince`, Upload-Status, sr-Status. | `src/components/dashboard/StatusBar.tsx` |
| Abgleich Soll/Ist | `LeaderRecording.set({ leader, phase, allowed })`. Alle Wechsel laufen in einer Kette (`chain`). Die Sperre `sg-recording` wird vor `start()` geholt und in `halt()` erst **nach** `recorder.stop()` freigegeben. | `src/lib/recorder/leader-recording.ts` |
| Leader-Rolle | `isLeaderState`, `useConnectionState`. | `src/lib/recorder/leader-state.ts` |
| Mikrofon-Erlaubnis | `usePermission` (`navigator.permissions`, Safari wirft → `unknown`), `userStarted`, `hasMicIntent(session.id)` (60 s, nur dieser Tab). | `use-recording.ts`, `src/lib/recorder/mic-intent.ts` |
| `beforeunload` | In `useSessionRecording`, solange `recording`, `starting` oder `paused`. | `use-recording.ts` |
| `visibilitychange` | Nur im Recorder: `requestData()` bei `hidden`. **`pagehide` fehlt.** | `AudioRecorder.start()` in `src/lib/recorder/recorder.ts` |
| Pegel | Modulweiter Verteiler, also je Tab. Nur ein aufnehmender Recorder speist ihn. | `src/lib/recorder/level.ts` |
| Auto-Stopp | `AutoStopController`: ein Stopp je Session (`stopSentFor`), `extend` mit Schonfrist. Ohne Pegel ist die Stille „unbekannt“ (`SilenceTracker.silentSince` liefert `null`), die Regeln 1 und 3 greifen dann nicht. | `src/lib/autostop/controller.ts`, `voice.ts`, `rules.ts` |
| Aktive Session | `useActiveSession()` gibt es schon: `GET /sessions?state=laeuft,pausiert`, hört auf `session.updated`, lädt nach einem Abbruch neu, fragt **immer** alle 30 s nach. Genutzt von `SpontaneousStart`, `ReviewView`, `lib/inbox.ts`. | `src/lib/sessions.ts` |
| Pausendauer | `usePausedSince`: `sessionStorage` je Tab, sonst `updated_at`, beim beobachteten Wechsel `Date.now()`. | `src/components/dashboard/use-session.ts` |
| Shell | `AppShell` → `SyncProvider` → `Shell`. `Shell` ruft `useResumePendingUploads(sync)`. Reihenfolge in der Inhaltsspalte: schmaler Kopf, `OtherTabBanner`, `ErrorShelf`, `main`. `fullBleed` für `/dokument`, `/session`, `/rueckblick`. Bei offenem Drawer ist die Spalte `inert`. | `src/components/AppShell.tsx` |
| „Heute“ | `heading()`, `statusText()`, `detail()` sagen „Läuft · ohne Aufnahme“ und „Die Aufnahme läuft nur in der Vorlesungs-Ansicht.“ Der Punkt ist immer hohl. | `src/components/today/StartCard.tsx` |
| Tests | `recording.test.tsx` (28 Tests) und `dashboard.test.tsx` (ein `boot()`) hängen an `RecordingEnvContext`. `recording-fakes.ts` importiert `RecordingEnv` aus `use-recording.ts`. | `test/` |

### 1.3 Was nicht dazu gehört

| Thema | Wohin |
|---|---|
| `paused_at` im Schema `Session` | eigenes Ticket (Schema, Core, iPad). Dieser Plan macht die Näherung besser, siehe §2 E9 |
| „Mikrofon testen“ in `LectureSettings.tsx` (UX-03 Rest) | eigenes Ticket |
| Pause und Beenden in der Leiste | nicht im Vertrag, siehe Owner-Frage 1 |
| Core lehnt einen Auto-Stopp vor `auto_stop_extended_until` ab | nicht nötig, siehe E7. Wäre eine Änderung an T1-02 |
| Session-Ereignisse zwischen Tabs weiterreichen | nicht nötig, siehe E3 |

---

## 2. Entscheidungen des Leads

Diese Punkte entscheidet der Plan. Die Fragen des Vertrags-Reviewers sind in §4 einzeln beantwortet.

| # | Entscheidung | Grund |
|---|---|---|
| E1 | Neuer Ordner **`src/lib/recording/`** für Provider und Hooks, **`src/components/recording/`** für die Leiste. Beide gehören dem Lead. Nicht `lib/recorder/`. | `lib/recorder/**` ist der Baustein von T1-06 und kennt weder Sessions noch React Query noch den Auto-Stopp. `lib/autostop` importiert schon `lib/recorder/level.ts`. Läge der Provider in `lib/recorder`, hingen beide Ordner gegenseitig voneinander ab. |
| E2 | Quelle ist das vorhandene `useActiveSession()`. Darüber liegt `useTrackedSession()`: Es behält die letzte aktive Session als Ziel, auch nach ihrem Ende. | Nach „Beenden“ muss der Recorder weiterleben, bis alles hochgeladen ist („Wird gesichert …“, „Gesichert“ in `StatusBar`). |
| E3 | Abfrage: **Ereignis, wenn der Tab online ist. Polling nur ohne Live-Verbindung** (Folge-Tab, `backoff`, `failed`). 10 s mit aktiver Session, 30 s ohne. | Gleiches Muster wie `useTodayData` und `useSessionData` (`refetchInterval: online ? false : POLL_MS`). Der Leader-Tab fragt online gar nicht nach. |
| E4 | Das Dashboard meldet sich beim Provider an (`useClaimRecordingDisplay(sessionId)`). Die Leiste zeigt sich, solange **kein** Dashboard die verfolgte Session zeigt. Kein `useSearchParams` in der Shell. | `useSearchParams` braucht im Static Export eine `Suspense`-Grenze. Drei Suiten mit `AppShell` mocken `next/navigation` ohne `useSearchParams` (etwa `appshell.test.tsx`). Die Anmeldung ist außerdem genauer: Lädt das Dashboard noch, steht die Leiste. |
| E5 | Die Leiste sitzt **unten** in der Inhaltsspalte, unter `main`. | Gleicher Platz wie die Statusleiste. REC steht in der ganzen App an derselben Stelle. |
| E6 | Die Nutzer-Erlaubnis („Aufnahme starten“, „Hier übernehmen“) gilt **für den Tab**, nicht je Session. Sie überlebt kein Neuladen. | Mit erteilter Browser-Berechtigung startet die Aufnahme laut Vertrag ohnehin von selbst. Die Tab-Erlaubnis verhält sich gleich. Siehe Owner-Frage 2. |
| E7 | **Vorab-Abgleich vor jedem Auto-Stopp:** Der Controller liest die Session per `GET /sessions/{id}` und wertet neu aus. Erst dann sendet er den Stopp. | Folge-Tabs bekommen kein `session.updated`. Ein Tab mit altem Stand würde eine Session stoppen, die ein anderer Tab gerade verlängert hat. Der Core nimmt jeden Stopp an. |
| E8 | bfcache: Bei `pageshow` mit `persisted = true` lädt die App neu (`window.location.reload()`). | Mikrofon, Sperren und WebSocket sind nach dem Einfrieren in unbekanntem Zustand. Neuladen ist der Weg, den der Vertrag schon beschreibt. |
| E9 | Beginn der Pause = `updated_at` der **ersten** Fassung mit `pausiert`, die der Tab sieht. `Date.now()` nur, wenn `updated_at` fehlt. Gemessen wird einmal im Provider. | Der Wechsel nach `pausiert` setzt `updated_at`. So zählt auch ein Folge-Tab oder eine Pause vom iPad richtig, obwohl der Tab sie bis zu 10 s später bemerkt (#210, Kommentar 1). |
| E10 | „Heute“ bekommt bei „ohne Aufnahme“ einen eigenen Knopf „Aufnahme starten“ in der Karte. | Die Karte steht oben, die Leiste unten. Der Knopf gehört dorthin, wo der Hinweis steht. |
| E11 | Umstellung in zwei Schritten: erst Umzug mit altem Verhalten (Schalter „nur bei offenem Dashboard“), dann Umschalten mit Leiste. | Kein Zwischenstand auf `main`, in dem ohne Anzeige aufgenommen wird. |

### 2.1 Textvorschläge für `docs/VERTRAEGE.md` (kommen mit PR 1)

**V1 · §11.8, „Ein Recorder je Tab, an der aktiven Session“, neuer Satz am Ende:**

```markdown
Folge-Tabs und Tabs ohne Live-Verbindung bekommen kein `session.updated`. Sie fragen `GET /sessions?state=laeuft,pausiert` ab: alle 10 s, solange eine Session aktiv ist, sonst alle 30 s. Der Leader-Tab fragt online nicht nach.
```

**V2 · §11.8, „Auto-Stopp“, neuer Satz am Ende:**

```markdown
Vor jedem Stopp liest der Controller die Session per `GET /sessions/{id}` neu und wertet die Regeln mit diesem Stand aus. So stoppt ein Tab mit altem Stand keine Session, die ein anderer Tab gerade verlängert hat. Ist die Session nicht mehr aktiv oder unbekannt (404), sendet er keinen Stopp. Scheitert der Abruf, gilt das wie ein gescheiterter Stopp. In Folge-Tabs kommt ein Verlängern oder Stoppen aus einem anderen Tab nicht über `session.updated` an, sondern über die Abfrage (höchstens 10 s später).
```

**V3 · §16.3, neue Zeile nach „T1-11 Rest, T1-13, #199“:**

```markdown
| #210 Teil 3 | Aufnahme an der App-Shell | `apps/web/src/lib/recording/**`, `apps/web/src/components/recording/**` (Lead). Einmalige Eingriffe in fremde Dateien laut `docs/plaene/210-AUFNAHME-APPSHELL.md` | #246 |
```

---

## 3. Schnittstellen (festgelegt, bevor gebaut wird)

### 3.1 `src/lib/sessions.ts` (PR 1)

```ts
/** Abstand der Abfrage ohne Live-Verbindung, solange eine Session aktiv ist */
export const ACTIVE_POLL_MS = 10_000;
/** … und ohne aktive Session */
export const ACTIVE_IDLE_POLL_MS = 30_000;

/** Neue Fassung einer Session in den Cache `ACTIVE_SESSION_KEY` übernehmen (Ereignis oder REST-Antwort). */
export function applyActiveSession(client: QueryClient, incoming: Session): void;

/** Signatur unverändert. Neu: Polling nur ohne Live-Verbindung, auch im Hintergrund, auch ohne Netz. */
export function useActiveSession(): UseQueryResult<Session | null>;
```

- `applyActiveSession` enthält die Logik, die heute im `session.updated`-Hörer von `useActiveSession` steht. Der Hörer ruft sie auf.
- **Neu darin, weil jetzt auch REST-Antworten hineinlaufen:** Eine aktive Fassung mit **anderer** ID ersetzt die bekannte aktive Session nur, wenn ihr `updated_at` nicht älter ist. Sonst ist sie veraltet (z. B. eine verspätete Antwort für A, nachdem B gestartet wurde und der Core A beendet hat) und ändert nichts. Test: Cache B, danach `applyActiveSession` mit A (`laeuft`, älter) → B bleibt.
- Abfrage-Optionen:
  - `refetchInterval: (q) => online ? false : q.state.data ? ACTIVE_POLL_MS : ACTIVE_IDLE_POLL_MS`
  - `online` = `useConnectionState(sync) === 'online'` (`lib/recorder/leader-state.ts`). Der Wert ist stabil, er springt nicht zwischen `connecting` und `backoff`.
  - `refetchIntervalInBackground: true`. Der Vorlesungs-Tab liegt oft im Hintergrund.
  - `networkMode: 'always'`. Der Core ist lokal. Ohne WLAN meldet der Browser `navigator.onLine = false`, React Query würde die Abfrage sonst anhalten.
- Zusätzlich neu laden bei `leader.changed`.
- `useTodayData().apply` und `useSessionData().apply` rufen zusätzlich `applyActiveSession` (darüber laufen auch die Aktionen der `StartCard`, der Statusleiste und von `SpontaneousStartCard` auf „Heute“). `useSpontaneousStart` ruft es selbst für `result.session` und `result.ended_session`, **unabhängig von `onSession`**: Auf der Modulseite (`ModuleSessionButton`) fehlt `onSession`. So kennt auch ein Folge-Tab den eigenen Start, die eigene Pause und den eigenen Stopp sofort.

### 3.2 `src/lib/autostop/controller.ts` (PR 1)

```ts
export interface AutoStopApi {
  stop: typeof stopSession;
  extend: typeof extendSession;
  /** Frischer Stand vor dem Stopp. Fehlt die Funktion, stoppt der Controller ohne Abgleich (alte Tests). */
  get?: typeof getSession;
}
export interface AutoStopControllerOptions {
  // … wie bisher. `subscribeLevel` gibt es schon; `useAutoStop` reicht es neu durch.
}
```

Ablauf in `tick()`, wenn `status.state === 'stoppen'` und nichts zurückhält:

1. `stopSentFor = session.id` (sperrt weitere Versuche, wie heute).
2. `fresh = await api.get(id)`.
   - Netzfehler oder 5xx: wie ein gescheiterter Stopp. `stopSentFor = null`, `retryAt = now + retryMs`.
   - 404: nichts tun (wie heute bei 404 auf den Stopp).
3. `fresh` nicht mehr aktiv: `setSession(fresh)`, fertig. Kein `POST`.
4. `evaluateAutoStop` mit `fresh` und der aktuellen Stille. Ergebnis nicht `stoppen`: `stopSentFor = null`, `setSession(fresh)`, fertig.
5. Läuft inzwischen ein `extend` (Klick während des `GET`) oder gilt eine Schonfrist (`graceUntil`), ebenfalls kein Stopp: `stopSentFor = null`, der nächste Takt entscheidet.
6. Sonst `api.stop(id, reason)` wie heute.

Während des `GET` zeigt der Controller wie heute beim laufenden Stopp `inaktiv` (`stopSentFor` ist gesetzt). Der Hinweis kann dabei für die Dauer des Abrufs verschwinden. Das ist hingenommen.

Der Standard für `api` wird `{ stop: stopSession, extend: extendSession, get: getSession }`.

### 3.3 `src/lib/recorder/recorder.ts` (PR 1)

```ts
export interface RecorderOptions {
  // … wie bisher
  /** Standard: `window`. Für `pagehide` (Tests liefern einen Fake). */
  pageEvents?: {
    addEventListener(type: 'pagehide', fn: () => void): void;
    removeEventListener(type: 'pagehide', fn: () => void): void;
  };
}
```

`AudioRecorder.start()` meldet neben `visibilitychange` auch `pagehide` an. Beide rufen `this.run?.recorder.requestData?.()`. `teardown()` meldet beide ab.

### 3.4 `src/lib/recording/` (PR 2)

```ts
// tracked-session.ts
export type TrackedPhase = 'laeuft' | 'pausiert' | 'andere';
export interface TrackedSession {
  /** Letzte bekannte Fassung. Nach dem Ende bleibt die letzte aktive Fassung stehen. */
  session: Session;
  phase: TrackedPhase;
}
/** Die aktive Session; nach ihrem Ende dieselbe mit `phase = 'andere'`, bis eine neue aktiv wird. */
export function useTrackedSession(): TrackedSession | null;

// paused-since.ts  (zieht schon in PR 1 aus components/dashboard/use-session.ts um, Regel E9)
export function usePausedSince(session: Session | undefined): number | null;

// RecordingProvider.tsx
export type RecordingKind = /* unverändert, 10 Werte aus use-recording.ts */;
export interface RecordingEnv {
  recorder?: Partial<RecorderOptions>;
  acquireLock?: AcquireRecordingLock;
  permission?: () => Promise<'granted' | 'denied' | 'prompt' | 'unknown'>;
  waitHintMs?: number;
  flushMs?: number;
  /** Nur für Tests: Uhr, REST und Pegelquelle des Auto-Stopps */
  autoStop?: Pick<AutoStopControllerOptions, 'api' | 'now' | 'voice' | 'subscribeLevel'>;
}
export interface RecordingView {
  /** Verfolgte Session; `null`, solange es nie eine aktive gab */
  sessionId: string | null;
  session: Session | null;
  phase: TrackedPhase;
  kind: RecordingKind;
  message: string | null;
  status: RecorderStatus;
  /** „Aufnahme starten“ bzw. „Erneut versuchen“. Setzt die Tab-Erlaubnis (E6). */
  start: () => void;
  /** Beginn der Pause in Epochen-ms, sonst `null` */
  pausedSince: number | null;
  autoStop: UseAutoStopResult;
  /** `lecture.auto_stop_extend_min`, Standard 15 */
  extendMinutes: number;
  /** Ein Dashboard zeigt die verfolgte Session: Die Leiste bleibt weg */
  shownByDashboard: boolean;
}

export function RecordingProvider(props: { children: ReactNode; env?: RecordingEnv }): JSX.Element;
/** Ohne Provider: ein fester, untätiger Stand (`kind: 'inactive'`). Komponenten laufen so auch in Tests ohne Shell. */
export function useRecordingView(): RecordingView;
/**
 * Wie `useRecordingView`, aber untätig (`kind: 'inactive'`), wenn `sessionId` nicht die verfolgte Session ist.
 * Ausnahme: Solange `useActiveSession` noch lädt (`isPending`), liefert sie `kind: 'starting'`. Sonst stünde in der
 * Statusleiste einer laufenden Session kurz „Nicht gestartet“ (`RUNNING_LABEL.inactive`).
 */
export function useRecordingFor(sessionId: string): RecordingView;
/** Das Dashboard meldet: „Ich zeige diese Session.“ (`useLayoutEffect`, meldet sich beim Unmount ab) */
export function useClaimRecordingDisplay(sessionId: string | null): void;
/** Vermerkt eine Nutzeraktion als Tab-Erlaubnis, ohne etwas zu starten (für „Hier übernehmen“). */
export function useNoteRecordingIntent(): () => void;
```

Regeln im Provider:

- **Ein Recorder je verfolgter Session.** Der Effekt mit `AudioRecorder` und `LeaderRecording` zieht unverändert aus `useSessionRecording` um. Schlüssel bleibt die Session-ID. `sessionMs` rechnet mit `started_at` der verfolgten Session.
- **Der Recorder entsteht erst, wenn es eine verfolgte Session gibt.** Ohne aktive Session legt die Shell nichts an (kein IndexedDB-Zugriff auf Seiten ohne Vorlesung).
- **Soll-Zustand:** `control.set({ leader, phase, allowed })` mit `phase` aus `useTrackedSession`. `allowed = tabErlaubt || permission === 'granted'`.
- **Tab-Erlaubnis:** `tabErlaubt` wird `true` durch `start()`, durch `useNoteRecordingIntent()` und, wenn `hasMicIntent(id)` gilt, sobald eine Session mit dieser ID verfolgt wird. Der letzte Fall wird im Effekt beim Wechsel der ID geprüft, nicht nur beim Mount.
- **`beforeunload`** zieht unverändert um.
- **`pagehide` und `visibilitychange` (verborgen):** Solange aufgenommen wird, ruft der Provider `notifyUploadsPending()`. Das Herausgeben der Daten macht der Recorder selbst (§3.3).
- **Auto-Stopp:** Eine innere Komponente (`AutoStopHost`) wird nur gerendert, solange die Phase `laeuft` oder `pausiert` ist. Nur sie ruft `useSettings()` und `useAutoStop({ session, lecture, events: client, ...env.autoStop })`. So lädt die Shell `GET /settings` nicht auf jeder Seite.
- **Antworten des Auto-Stopps in den Cache:** `AutoStopHost` umhüllt die API (`env.autoStop.api` oder den Standard): Die Antworten von `stop`, `extend` und `get` gehen zusätzlich an `applyActiveSession`. Sonst nimmt ein Leader ohne Live-Verbindung nach dem eigenen Auto-Stopp bis zu 10 s weiter auf, und ein Folge-Tab zeigt nach dem eigenen Verlängern bis zu 10 s den alten Stand.
- **Der Kontextwert wird mit `useMemo` gebaut.** `children` kommen als Prop, die Seiten rendern bei einem neuen Recorder-Stand nicht neu. Nur `StatusBar`, Leiste und `StartCard` lesen den Kontext.
- **Schalter für PR 2 (E11):** `const ROUTE_GATE = true`. Solange er gilt, bekommen `LeaderRecording` und der Auto-Stopp `phase = 'andere'` bzw. `session = null`, wenn `shownByDashboard` falsch ist. PR 3 löscht den Schalter.

### 3.5 Komponenten

```ts
// src/components/recording/labels.ts  (PR 2, aus StatusBar herausgezogen)
export const RECORDING_LABEL: Record<RecordingKind, string>;   // heute RUNNING_LABEL
export function recordingStatusText(view: Pick<RecordingView, 'phase' | 'kind' | 'message'>, pauseHint: boolean): string;
export function RecordDot(props: { filled: boolean; record?: boolean }): JSX.Element;

// src/components/recording/RecordingBar.tsx  (PR 3)
export function RecordingBar(): JSX.Element | null;   // keine Props, liest useRecordingView()

// src/components/AppShell.tsx
export function AppShell(props: { children: ReactNode; syncClient?: SyncClient; recordingEnv?: RecordingEnv }): JSX.Element;

// src/lib/sync/OtherTabBanner.tsx  (PR 3)
export function OtherTabBanner(props: { client: OtherTabSource; onTakeOver?: () => void }): JSX.Element | null;

// src/components/dashboard/StatusBar.tsx: Props unverändert
```

---

## 4. Antworten auf die Fragen des Vertrags-Reviewers

### 4.1 Datei-Besitz (§16.3)

- **Wohin zieht der Provider?** Nach `src/lib/recording/` (E1), Besitz Lead. `components/dashboard/use-recording.ts` entfällt in PR 2.
- **`AppShell.tsx`** gehört dem Lead. Der Worker ändert sie im Auftrag dieses Plans, in PR 2 und PR 3. Der Scope steht in den PRs.
- **`StatusBar`** (`components/dashboard/**`, T1-04) baut der Worker von PR 2 um. **`StartCard`** (`components/today/**`, T1-03) baut der Worker von PR 3 um. Beide Tickets sind abgeschlossen. Der Lead gibt die Eingriffe mit diesem Plan frei, V3 schreibt das in §16.3 fest.
- Weitere einmalige Eingriffe: `lib/recorder/recorder.ts` (T1-06, nur `pagehide`), `lib/autostop/controller.ts` und `useAutoStop.ts` (T1-07, Vorab-Abgleich, `subscribeLevel` durchreichen), `lib/sync/OtherTabBanner.tsx` (T1-WS, eine Prop).

### 4.2 `useActiveSession`: Polling oder Ereignis?

Beides, nach E3. Wie schnell `beendet` ankommt:

| Lage des Tabs | Weg | Dauer |
|---|---|---|
| Leader, online | `session.updated` | unter 1 s |
| Leader in `backoff`/`connecting`/`failed`, REST geht | Polling | höchstens 10 s |
| Leader, Core nicht erreichbar | nichts kommt an. Die Aufnahme läuft lokal weiter (gewollt, §10.1). Beim Wiederverbinden lädt `useActiveSession` sofort neu. | bis zur Verbindung |
| Folge-Tab | Polling | höchstens 10 s. Er nimmt ohnehin nicht auf. |
| Eigene Aktion in diesem Tab | `applyActiveSession` nach der REST-Antwort | sofort |

Bis zu 10 s Aufnahme nach dem Ende sind unschädlich: Chunks und `complete` sind nach `beendet` erlaubt (§10.1). Heute sind es im selben Fall bis zu 30 s (`POLL_MS` in `useSessionData`).

**Zähl-Tests:**

- Online fragt die Shell genau **einmal** `GET /sessions?state=laeuft%2Cpausiert&limit=10` ab, beim Start. Kein Intervall.
- `dashboard.test.tsx` zählt `GET /sessions/{id}` und `GET /devices?limit=200`. Der Provider ruft keins von beiden auf. `useTrackedSession` lädt die Session bewusst **nicht** per ID nach.
- Der Vorab-Abgleich (E7) ruft `GET /sessions/{id}` nur direkt vor einem Auto-Stopp. Die Zähl-Tests lösen keinen aus.
- `heute.test.tsx` zählt in vier Tests `r.path.startsWith('/sessions?')` mit `toBeGreaterThan`. Die Abfrage der Shell hat denselben Pfad wie die zweite Abfrage von `useTodayData`. Der Test „ohne Live-Verbindung fragt die Liste alle 30 s nach“ würde durch das neue Polling auch dann grün, wenn die Liste nicht mehr nachfragt. **PR 2 stellt diese Zähler auf `/sessions?from=` um** (nur `useTodayData` sendet `from`).
- `GET /settings` kommt nur mit aktiver Session dazu (`AutoStopHost`).

### 4.3 Wechsel der aktiven Session im laufenden Betrieb

Ablauf, wenn Session B startet, während A aufgenommen wird (§9.1: Der Core beendet A):

1. `applyActiveSession` setzt B in den Cache, egal in welcher Reihenfolge die beiden Ereignisse kommen. `useTrackedSession` liefert B.
2. Der Effekt für A räumt auf: `control.dispose()` plant `halt()` ein. `halt()` wartet auf `recorder.stop()` (letzter Chunk, `complete` in IndexedDB) und gibt **danach** die Sperre frei. Dann `flushUploads`, `notifyUploadsPending`, `recorder.dispose()`.
3. Der Effekt für B legt Recorder und `LeaderRecording` neu an und ruft `set(...)`. `reconcile()` wartet in `acquireLock` auf `sg-recording`.
4. Web Locks vergibt die Sperre je Anfrage, nicht je Tab. B bekommt sie erst, wenn A sie in Schritt 2 freigegeben hat. **Die Sperre ist nie doppelt gehalten**, auch ohne zusätzlichen Code.
5. B startet mit `started_ms` = Sitzungszeit von B.

Besonderheiten:

- Ist bei A noch die Mikrofon-Abfrage offen, wartet Schritt 2 auf `recorder.start()` (höchstens 30 s, `getUserMediaTimeoutMs`). So lange zeigt B nach 1,5 s „Wartet auf anderen Tab“. Der Text passt hier nicht ganz, der Fall ist selten. Kein eigener Zustand.
- Ohne Web Locks gibt es keine Sperre. Dann könnten A und B kurz zugleich aufnehmen. Darum wartet der Effekt für B zusätzlich auf ein Promise `previousStopped`, das der Aufräumer von A erfüllt (ein `useRef<Promise<void>>` im Provider). Das gilt mit und ohne Web Locks.
  - **Umsetzung:** B bekommt eine umhüllte Sperre: `acquireLock: (signal) => previousStopped.then(() => (signal.aborted ? null : baseAcquire(signal)))`. So zeigt B während des Wartens wie gewohnt `isWaiting()` und nach 1,5 s „Wartet auf anderen Tab“, und ein Abbruch per `signal` wirkt auch hier.
  - `previousStopped` löst auf, sobald `control.idle()` von A durch ist (Aufnahme gestoppt, Mikrofon frei), **nicht** erst nach `flushUploads` (bis zu 8 s). Es lehnt nie ab (`.catch(() => undefined)`).
- Die Tab-Erlaubnis bleibt (E6). Wurde B am iPad gestartet und ist die Browser-Berechtigung nicht erteilt, steht in der Leiste „Aufnahme starten“.

### 4.4 Mikrofon nach „Hier übernehmen“ im Folge-Tab

- Der Klick ruft **synchron** `onTakeOver()` → `useNoteRecordingIntent()` und danach `client.takeOver()`. Damit ist `allowed` wahr, bevor die Rolle wechselt.
- Danach läuft alles asynchron: Rolle kommt, `LeaderRecording` wartet auf `sg-recording`, dann `getUserMedia`. Zwischen Klick und `getUserMedia` können Sekunden liegen.
- **Chrome und Firefox** verlangen für `getUserMedia` keine frische Nutzeraktion. Die Abfrage erscheint auch später. Der Klick reicht.
- **Safari** kennt `permissions.query` für das Mikrofon nicht (`usePermission` liefert `unknown`). Ohne Tab-Erlaubnis stünde dort nach jeder Übernahme „Aufnahme starten“. Mit der Tab-Erlaubnis wird `getUserMedia` aufgerufen. Ob Safari die späte Abfrage zulässt, ist **nicht geprüft** (§8).
- **Rückfall, falls Safari ablehnt:** `AudioRecorder.start()` meldet `NotAllowedError` als `micIssue = 'denied'`. Leiste und Statusleiste zeigen „Zugriff verweigert“ mit „Erneut versuchen“. Dieser Klick ist eine frische Nutzeraktion. Es geht also nie ohne Ausweg schief.
- **Pegel:** Der `AudioContext` kann in Safari ohne frische Nutzeraktion `suspended` bleiben. `startLevelMeter` meldet dann nichts, die Stille gilt als unbekannt, Regel 1 und 3 greifen nicht. Das ist die sichere Richtung. Die harten Grenzen gelten weiter.

### 4.5 bfcache

Ja, wie beim Neuladen, und zwar wörtlich (E8): `Shell` hört auf `pageshow`. Ist `event.persisted` wahr, ruft sie `window.location.reload()`. Vorher hat `pagehide` schon die Daten herausgegeben (§3.3). Nach dem Neuladen gilt der Vertrag „Nach dem Neuladen“.

Ob die Seite überhaupt in den bfcache kommt, ist offen (gehaltene Web Locks, offener WebSocket, `beforeunload`). Siehe §8.

### 4.6 Auto-Stopp in mehreren Tabs

- Jeder Tab hat einen Controller im Provider (`AutoStopHost`).
- **Regel 3 und 1 nur im aufnehmenden Tab:** Der Pegel-Verteiler in `level.ts` ist Modulzustand je Tab. Ein Folge-Tab bekommt nie einen Messwert, `silentSince` bleibt `null`. Kein zusätzlicher Schalter nötig. Ein Test hält das fest.
- **Gleichzeitige Stopps:** Mehrere Tabs erreichen dieselbe harte Grenze. Jeder macht den Vorab-Abgleich. Wer zuerst stoppt, gewinnt. Die anderen sehen `beendet` und senden nichts, oder sie senden und bekommen 200 (§9.1, gleicher Zielzustand).
- **Verlängern in Tab B, alter Stand in Tab C:** C erreicht die Grenze, liest die Session neu, sieht `auto_stop_extended_until` und stoppt nicht (E7).
- **Verlängern in Tab B, Leader A online:** A bekommt `session.updated`, der Hinweis verschwindet.
- Die Rückfrage steht in jedem Tab: im Dashboard der Session in der Statusleiste, sonst in der Leiste. Nie beides.
- In einem Folge-Tab kann der Hinweis bis zu 10 s nach der Verlängerung stehen bleiben (Polling). Ein zweiter Klick verlängert dann noch einmal um dieselbe Zeit. Das ist hingenommen.

### 4.7 Leiste

**Wo sie sitzt.** In `Shell`, in der Inhaltsspalte, als letztes Kind nach `<div className="flex min-h-0 flex-1">…main…</div>`. Klasse `shrink-0`.

- Normale Seiten: `main` scrollt, die Leiste bleibt unten stehen.
- `fullBleed` (`/dokument`, `/rueckblick`, `/session` mit einer **anderen** Session): `main` ist `min-h-0 flex-1 overflow-hidden` und wird um die Höhe der Leiste kleiner. Die Seiten füllen `h-full`, nichts wird verdeckt.
- `/session` mit der verfolgten Session: keine Leiste (`shownByDashboard`).
- Schmal (unter 768 px): Die Leiste bricht um (`flex-wrap`). Knöpfe und Link haben `min-h-11`. Ist der Drawer offen, ist die ganze Spalte `inert`, also auch die Leiste. Sie liegt hinter dem Hintergrund des Drawers. Nichts weiter nötig.

**Aufbau** (eine Zeile, Texte höchstens drei Wörter, keine Animation, Rot nur für den Punkt):

| Zustand (`phase`, `kind`) | Punkt | Text | Dazu |
|---|---|---|---|
| `laeuft`, `rec` | rot | „REC“ + Laufzeit | – |
| `laeuft`, `starting` | hohl | „Startet“ | – |
| `laeuft`, `waiting` | hohl | „Wartet auf anderen Tab“ | Hinweiszeile |
| `laeuft`, `needs-start` | hohl | „Keine Aufnahme“ | Knopf „Aufnahme starten“, Hinweiszeile |
| `laeuft`, `mic-denied` / `mic-missing` / `error` | hohl | „Zugriff verweigert“ / „Mikrofon fehlt“ / „Aufnahme gestört“ | Knopf „Erneut versuchen“, Hinweiszeile |
| `laeuft`, `other-tab` | hohl | „Aufnahme in anderem Tab“ | – |
| `pausiert` | hohl | „Pausiert“ + Pausendauer, ab 20 min „Noch Pause?“ | – |

Rechts immer der Link „Zur Vorlesung“ (`sessionHref(view.sessionId)`), davor der `AutoStopHint`. Ohne aktive Session (`phase = 'andere'` oder keine Session) gibt es keine Leiste.

**Zusammenspiel mit `OtherTabBanner`.**

- Der Banner steht oben, die Leiste unten. Der Banner sagt, wer synchronisiert. Die Leiste sagt, wer aufnimmt.
- „Hier übernehmen“ gibt es nur im Banner. Die Leiste bekommt keinen zweiten Knopf dafür.
- Im Zustand `other-tab` zeigt die Leiste keine Hinweiszeile (wie heute die Statusleiste: `rec.kind !== 'other-tab'`).

**Screenreader.**

- Rahmen: `<aside aria-label="Aufnahme">`.
- Ein `role="status"`-Satz, nur für Screenreader. Er ändert sich nur beim Zustandswechsel, nicht jede Sekunde:

| Zustand | Satz |
|---|---|
| `rec` | „Die Aufnahme läuft.“ |
| `starting` | „Die Aufnahme startet.“ |
| `needs-start`, `mic-*`, `error`, `waiting` | „Es wird nicht aufgenommen.“ + `message` |
| `other-tab` | „Für die Aufnahme ist ein anderer Tab zuständig.“ |
| `pausiert` | „Die Session ist pausiert.“, ab 20 min „Die Session ist seit über 20 Minuten pausiert.“ |

- Laufzeit und Pausendauer haben ein unsichtbares Wort davor („Laufzeit“, „Pausendauer“) und stehen **außerhalb** des Status-Bereichs.
- Die Hinweiszeile ist sichtbarer Text ohne eigene Rolle. Der Satz oben enthält sie schon.
- Der `AutoStopHint` bringt sein eigenes `role="status"` mit („Aufnahme stoppt gleich.“).
- Auf „Heute“ sagt die Karte nur noch den Zustand der **Session** an, die Leiste den der **Aufnahme** (§4.9). So wird nichts doppelt vorgelesen.

### 4.8 Pausendauer

- `usePausedSince` liegt ab PR 1 in `lib/recording/paused-since.ts` und läuft ab PR 2 **einmal** im Provider. Leiste und Statusleiste lesen `view.pausedSince`. Beide zeigen denselben Wert, egal welche gerade eingehängt ist.
- Regel E9 ersetzt `Date.now()` beim beobachteten Wechsel durch `updated_at` der ersten pausierten Fassung. `seenOther` entfällt.
- `sessionStorage` bleibt (je Tab, überlebt Neuladen). Jeder Tab kommt mit E9 selbst auf denselben Wert.
- Grenze bleibt: Ändert sich `updated_at` während der Pause aus anderem Grund (verschobener Termin, `ensurePlannedSessions`) und lädt ein Tab erst danach, zählt er ab dieser Änderung. Exakt wird es erst mit `paused_at` (§1.3).

### 4.9 „Heute“: neue Texte

`StartCard` liest `useRecordingFor(session.id)`. Die Prop `otherTab` entfällt, `HeuteScreen` übergibt sie nicht mehr. Nur der Zustand `laeuft` ändert sich:

| `kind` | Überschrift | Punkt | Detail nach „Seit 10:15 Uhr.“ |
|---|---|---|---|
| `rec` | „Läuft · Aufnahme“ | rot | „Die Aufnahme läuft, auch wenn du die Seite wechselst.“ |
| `starting` | „Läuft · Aufnahme startet“ | hohl | „Das Mikrofon wird geöffnet.“ |
| `waiting` | „Läuft · wartet“ | hohl | „Die Aufnahme wartet auf einen anderen Tab.“ |
| `needs-start` | „Läuft · ohne Aufnahme“ | hohl | „Es wird nicht aufgenommen.“ + Knopf „Aufnahme starten“ (E10) |
| `mic-denied` | „Läuft · ohne Aufnahme“ | hohl | „Der Zugriff auf das Mikrofon ist verweigert.“ + Knopf „Erneut versuchen“ |
| `mic-missing` | „Läuft · ohne Aufnahme“ | hohl | „Es wurde kein Mikrofon gefunden.“ + Knopf „Erneut versuchen“ |
| `error` | „Läuft · ohne Aufnahme“ | hohl | „Die Aufnahme ist gestört.“ + Knopf „Erneut versuchen“ |
| `other-tab` | „Läuft · anderer Tab“ | hohl | „Für die Aufnahme ist ein anderer Tab zuständig.“ |
| `inactive` (ohne Provider, erster Paint) | „Läuft“ | hohl | – |

- sr-Status der Karte bei `laeuft`: nur noch „Die Session läuft.“ Den Rest sagt die Leiste.
- `StopConfirm` auf „Heute“: `cancelLabel` ist „Weiter aufnehmen“, wenn `kind === 'rec'`, sonst wie bisher „Weiterlaufen lassen“.
- Der Kommentar über `dot` („Auf Heute läuft nie eine Aufnahme“) wird gestrichen.
- `pausiert` und alle anderen Zustände bleiben unverändert.

### 4.10 Tests

Siehe die Testlisten in §5. Kurz:

- `RecordingEnvContext` entfällt. `recording.test.tsx` und `dashboard.test.tsx` hüllen in `<RecordingProvider env={…}>`, **innerhalb** von `QueryProvider` und `SyncProvider`. Geändert wird je Datei nur `boot()` und der Import. `recording-fakes.ts` importiert `RecordingEnv` aus `lib/recording`.
- Die 28 Tests in `recording.test.tsx` bleiben inhaltlich. Der Unmount des ganzen Baums ist jetzt „Tab weg“ und räumt wie bisher auf. Die drei Tests zu „Seite verlassen“ und „Rückstau beim Verlassen“ bekommen diesen Namen.
- Neu: `pagehide`, `beforeunload` am Provider, Wechsel der Session, Navigation, Übernahme, Auto-Stopp in mehreren Tabs.

### 4.11 Anleitung

`docs/anleitungen/VORLESUNGSTAG.md`, Abschnitt „Aufnahme“ (PR 3):

- **Schritt 2:** „…erscheint in der Statusleiste **Aufnahme starten**“ → „…erscheint unten **Aufnahme starten**“ (Statusleiste oder Aufnahme-Leiste).
- **Schritt 6** neu: „Schließe den Tab nicht und lade ihn nicht neu. Ohne den Tab wird nichts aufgenommen, die Session läuft ohne Ton weiter. Der Browser fragt vorher nach. Arbeite in **einem** Tab.“
- **Schritt 7** neu: „**Du kannst die Vorlesungs-Ansicht verlassen.** Die Aufnahme läuft weiter, auch auf **Heute**, in den Einstellungen oder in einem Modul. Unten steht dann eine schmale Leiste mit **REC** und der Laufzeit. **Zur Vorlesung** bringt dich zurück. Steht dort etwas anderes als **REC**, wird nicht aufgenommen. Zeigt die Leiste **Aufnahme starten**, klicke darauf.“
- **„Wenn der Mac neu startet“, Schritt 3 und 4:** „Dort steht ‚Läuft · ohne Aufnahme‘. Klicke **Zur Vorlesung**.“ → „Steht dort ‚Läuft · ohne Aufnahme‘, klicke in der Karte **Aufnahme starten**. Danach steht ‚Läuft · Aufnahme‘ und unten **REC**.“
- Dazu `docs/ux/STUDIENALLTAG-2.md`: UX-01 und UX-59 auf „erledigt“ mit Verweis auf die PRs.

---

## 5. PR-Zuschnitt

Drei PRs, nacheinander. Jeder ist für sich lauffähig.

```
#246 (Vertrag) ──▶ PR 1 (Vorarbeiten) ──▶ PR 2 (Umzug, Verhalten wie bisher) ──▶ PR 3 (Umschalten, Leiste, Heute, Anleitung)
```

Für alle gilt: PR-Beschreibung nach `AGENTS.md`, keine neuen Abhängigkeiten, `pnpm lint`, `pnpm typecheck`, `pnpm test` grün. Modell: Sonnet 5.5 schreibt, Opus 5.5 reviewt (Logik, Sperren, Sync).

---

### PR 1 · Vorarbeiten

**Branch:** `feat/aufnahme-vorarbeiten` · **Größe:** M · **Abhängig von:** #246 gemergt

Vier kleine Änderungen. Jede ist schon heute richtig und ändert für den Nutzer fast nichts.

**Scope**
- `docs/VERTRAEGE.md` (V1 bis V3, wörtlich)
- `src/lib/sessions.ts`
- `src/components/today/use-today.ts`, `src/components/dashboard/use-session.ts`, `src/components/today/SpontaneousStart.tsx` (je nur der Aufruf von `applyActiveSession`)
- neu `src/lib/recording/paused-since.ts`: `usePausedSince` zieht mit seinen Helfern (`pausedKey`, `readPaused`, `writePaused`) aus `use-session.ts` hierher und bekommt Regel E9. `src/components/dashboard/StatusBar.tsx` ändert nur den Import. So bleibt in PR 2 ein reiner Umzug weniger.
- `src/lib/autostop/controller.ts`, `src/lib/autostop/useAutoStop.ts`
- `src/lib/recorder/recorder.ts`
- Tests: `test/autostop-controller.test.ts`, `test/recorder.test.ts`, `test/dashboard.test.tsx` (Pausendauer), neu `test/active-session.test.tsx`

**Schnittstellen:** §3.1, §3.2, §3.3.

**Schritte**
1. `applyActiveSession` herausziehen, `useActiveSession` auf E3 umstellen, `leader.changed` anhängen.
2. Die drei Aufrufer ergänzen.
3. Vorab-Abgleich im Controller. `useAutoStop` reicht `subscribeLevel` durch.
4. `pagehide` im Recorder.
5. `usePausedSince` nach `lib/recording/paused-since.ts` umziehen und auf E9 umstellen. Der Test „zeigt die Dauer ab dem Wechsel“ stellt die Fassung mit passendem `updated_at` bereit.
6. Vertragstext.

**Tests**
- `useActiveSession`:
  - online: genau eine Abfrage, 90 s später keine weitere (Fake-Uhr für `setInterval`, wie in `dashboard.test.tsx` „online wird nicht nachgefragt“).
  - `backoff` mit aktiver Session: Abfrage alle 10 s. Ohne aktive Session: alle 30 s.
  - Wechsel `connecting`/`backoff` im 3-s-Takt: Es wird trotzdem nachgefragt (stabiler Wert).
  - `session.updated` mit `beendet` für die aktive Session: Cache wird `null`. Ältere Fassung: keine Änderung.
  - Start von B, Ereignisse in beiden Reihenfolgen (A beendet zuerst, B läuft zuerst): Am Ende steht B.
  - `applyActiveSession` nach einer REST-Antwort im Folge-Tab: sofort sichtbar, ohne Abfrage.
  - Verspätete Antwort für A (`laeuft`, älteres `updated_at`), während B im Cache steht: B bleibt.
  - Start auf der Modulseite (ohne `onSession`): Der Cache kennt die neue Session sofort.
- Controller:
  - Grenze erreicht, `get` liefert verlängerte Session: kein `POST …/stop`, Hinweis weg.
  - `get` liefert `beendet`: kein `POST`, Zustand `inaktiv`.
  - `get` scheitert am Netz: neuer Versuch nach `retryMs`, höchstens einer zugleich.
  - `get` liefert unveränderten Stand: genau ein `POST` mit dem richtigen Grund.
  - Klick auf „Verlängern“, während `get` noch läuft: kein `POST …/stop`.
  - Ohne `api.get`: Verhalten wie bisher. Die vorhandenen Tests mit eigener `api` bleiben unverändert grün. Der Test gegen den Fake-Core nutzt den Standard und sieht einen zusätzlichen `GET`.
- Recorder: `pagehide` ruft `requestData()` genau einmal je Ereignis. Nach `stop()` ist der Hörer abgemeldet. Ohne laufende Aufnahme passiert nichts.
- Pausendauer: Pause vom anderen Gerät, der Tab sieht sie 20 s später → die Dauer zählt ab `updated_at`. Die drei vorhandenen Tests (UX-07) bleiben grün.

**Risiken**
- `SpontaneousStart`, `ReviewView` und `lib/inbox.ts` verlieren das feste 30-s-Polling, wenn der Tab online ist. Sie leben dann von `session.updated`. Die Suiten `spontan`, `rueckblick`, `konzepte`, `inbox-folgen` müssen grün bleiben.
- Der Vorab-Abgleich kostet einen `GET` je Auto-Stopp. Zwischen `GET` und `POST` bleibt ein Fenster von Millisekunden.
- `networkMode: 'always'` gilt nur für diese eine Abfrage. Der Rest der App pausiert Abfragen weiter, wenn der Browser „offline“ meldet (§8).

**Review:** Opus, Stufe A (Nebenläufigkeit im Controller). Gegenproben: Vorab-Abgleich entfernen → der Test „verlängerte Session“ muss rot werden. `online` durch `live` ersetzen → der Test „stabiler Wert“ muss rot werden.

**Akzeptanzkriterien**
- [ ] Online gibt es kein Intervall auf `GET /sessions?state=…`.
- [ ] Kein Auto-Stopp ohne frischen Stand, wenn `api.get` gesetzt ist.
- [ ] V1 bis V3 stehen wörtlich im Vertrag.

---

### PR 2 · Umzug in die Shell, Verhalten wie bisher

**Branch:** `feat/aufnahme-provider` · **Größe:** L · **Abhängig von:** PR 1

Die Architektur zieht um. Der Schalter `ROUTE_GATE` hält das alte Verhalten: Aufgenommen und automatisch gestoppt wird nur, solange das Dashboard der Session offen ist.

**Scope**
- `src/lib/recording/` (neu: `RecordingProvider.tsx`, `tracked-session.ts`, `index.ts`; `paused-since.ts` liegt seit PR 1 dort)
- neu `src/components/recording/labels.ts`
- `src/components/AppShell.tsx` (Provider einhängen, Prop `recordingEnv`)
- `src/components/dashboard/StatusBar.tsx`
- `src/components/dashboard/use-recording.ts` (löschen)
- Tests: `test/recording-fakes.ts`, `test/recording.test.tsx`, `test/dashboard.test.tsx`, `test/heute.test.tsx` (Zähler, `recordingEnv`), neu `test/recording-provider.test.tsx`, bei Bedarf weitere Suiten mit `AppShell` und aktiver Session (nur `recordingEnv` ergänzen)

**Schnittstellen:** §3.4, §3.5 (`labels.ts`, `AppShell`).

**Schritte**
1. `useTrackedSession` anlegen.
2. `RecordingProvider` bauen. Die Logik aus `useSessionRecording` zieht zeilenweise um (Recorder-Effekt, `usePermission`, Upload-Schalter mit `wasLeader`, Warte-Hinweis, `beforeunload`, Bestimmung von `kind`). Neu sind: Tab-Erlaubnis, `previousStopped` (§4.3), `AutoStopHost`, `shownByDashboard`, `ROUTE_GATE`, `notifyUploadsPending` bei `pagehide` und verborgenem Tab.
3. `AppShell`: `<SyncProvider><RecordingProvider env={recordingEnv}><Shell>…`. `QueryProvider` liegt in `app/layout.tsx` schon darüber.
4. `StatusBar`: `useSessionRecording`, `useAutoStop`, `usePausedSince` und `useSettings` raus. Stattdessen `useRecordingFor(session.id)` und `useClaimRecordingDisplay(session.id)`. `RUNNING_LABEL`, `Dot` und die sr-Sätze kommen aus `labels.ts`. Props, Testkennungen und Texte bleiben gleich.
5. Tests umbauen (§4.10), `heute.test.tsx`-Zähler auf `/sessions?from=`.

**Tests**
- Alle 28 Tests in `recording.test.tsx` und alle in `dashboard.test.tsx` grün, nur mit neuem Rahmen.
- `recording-provider.test.tsx` (Shell mit Fake-Core, Fake-Sync, `fakeRecording`):
  - Ohne aktive Session: kein Recorder, kein `GET /settings`, kein `getUserMedia`.
  - Aktive Session, Dashboard offen: REC. Dashboard hängt aus, Provider bleibt: Aufnahme stoppt sauber (letzter Chunk, `complete`, Spur gestoppt). Dashboard wieder da: neue Aufnahme. *(Dieser Test kehrt sich in PR 3 um.)*
  - `beforeunload` wird bei REC abgefangen, im Folge-Tab und ohne Aufnahme nicht, nach dem Ende nicht mehr.
  - `pagehide` bei REC: `notifyUploadsPending` geht auf den Kanal `sg-recorder-uploads`, der `FakeMR` bekommt `requestData`. Ohne Aufnahme: nichts.
  - **Wechsel der Session:** A nimmt auf, B startet (Fake-Core beendet A). A bekommt den letzten Chunk und `complete`. B beginnt eine neue Aufnahme mit eigener `recordingId`. `shared.maxRunning` bleibt 1. `FakeWebLocks` war nie doppelt vergeben (Zähler im Fake ergänzen).
  - Derselbe Wechsel **ohne** Sperre (`acquireLock` liefert sofort): `maxRunning` bleibt 1 (`previousStopped`).
  - Wechsel, während A in der Mikrofon-Abfrage hängt: B wartet, nach der Antwort gibt A das Mikrofon frei, B startet.
  - Session endet: Recorder bleibt, „Wird gesichert …“ wird „Gesichert“, danach keine Aufnahme mehr.
  - `useRecordingFor` mit fremder ID liefert `inactive`. Das Dashboard einer beendeten Session zeigt „Beendet“, während eine andere läuft.
  - StrictMode: Mount, Unmount, Mount ergibt genau einen laufenden Recorder.
- Pausendauer: Statusleiste zeigt `view.pausedSince`. Die drei UX-07-Tests bleiben.

**Risiken**
- **Größter Umbau des Plans.** Regel für den Worker: Logik umziehen, nicht neu schreiben. Der Diff von `use-recording.ts` zum Provider soll lesbar bleiben.
- Jede Suite mit `AppShell` löst jetzt eine Abfrage `GET /sessions?state=…` aus. Bei gestubbtem `fetch`, das wirft, bleibt der Provider untätig. Mit aktiver Session im Fake-Core braucht die Suite `recordingEnv`, sonst entsteht ein echter `AudioRecorder` in jsdom.
- Der Kontext darf die Seiten nicht bei jedem Chunk neu rendern (Wert mit `useMemo`, `children` als Prop).
- `ROUTE_GATE` darf nicht dazu führen, dass der Recorder beim Aushängen des Dashboards **entsorgt** wird. Er stoppt nur. Das Hochladen läuft im Leader weiter.

**Review:** Opus, Stufe A (Sperren, Nebenläufigkeit). Gegenproben: `previousStopped` entfernen → Test „ohne Sperre“ rot. Schalter entfernen → Test „Dashboard hängt aus“ rot. Im Browser: zwei Tabs, Start, „Hier übernehmen“, Tab schließen.

**Akzeptanzkriterien**
- [ ] Für den Nutzer ändert sich nichts außer der genaueren Pausendauer und einer Folge von E6: Wer im Tab einmal „Aufnahme starten“ geklickt hat, dem startet die Aufnahme beim erneuten Öffnen des Dashboards ohne neuen Klick. Die PR-Beschreibung nennt das.
- [ ] `use-recording.ts` und `RecordingEnvContext` gibt es nicht mehr.
- [ ] Es gibt je Tab höchstens einen `AudioRecorder` und einen `AutoStopController`.

---

### PR 3 · Umschalten: Aufnahme app-weit, Leiste, „Heute“, Anleitung

**Branch:** `feat/aufnahme-app-weit` · **Größe:** M · **Abhängig von:** PR 2 · **Closes #210** (Teil 3)

**Scope**
- `src/lib/recording/RecordingProvider.tsx` (`ROUTE_GATE` löschen)
- neu `src/components/recording/RecordingBar.tsx`
- `src/components/AppShell.tsx` (Leiste, `onTakeOver`, `pageshow`)
- `src/lib/sync/OtherTabBanner.tsx` (Prop `onTakeOver`)
- `src/components/today/StartCard.tsx`, `src/components/today/HeuteScreen.tsx`
- `src/components/settings/MoodleSettings.tsx` (nur der Link „Allgemein“, siehe Schritt 6)
- `docs/anleitungen/VORLESUNGSTAG.md`, `docs/ux/STUDIENALLTAG-2.md`
- Tests: `test/recording-provider.test.tsx`, neu `test/recording-bar.test.tsx`, `test/heute.test.tsx`, `test/sync-banner.test.tsx`, `test/appshell.test.tsx`

**Schnittstellen:** §3.5 (`RecordingBar`, `OtherTabBanner`), Texte aus §4.7 und §4.9.

**Schritte**
1. Schalter löschen. Der Test „Dashboard hängt aus“ wird umgedreht.
2. `RecordingBar` nach §4.7 bauen und in `Shell` einhängen.
3. `OtherTabBanner`: `onClick={() => { onTakeOver?.(); client.takeOver(); }}`. `Shell` übergibt `useNoteRecordingIntent()`.
4. `pageshow` in `Shell` (E8).
5. `StartCard` nach §4.9, `HeuteScreen` ohne `otherTab`.
6. Harte Seitenwechsel innerhalb der App entfernen: `MoodleSettings.tsx` verlinkt `/einstellungen?bereich=allgemein` mit einem rohen `<a href>`. Das lädt die Seite neu und beendet die Aufnahme. Ersetzen durch `next/link`. Stand 12.11. ist das die einzige Stelle (`grep -rn '<a' src` ohne `target="_blank"` und Sprungmarken).
7. Anleitung und UX-Stand nach §4.11.

**Tests**
- Navigation: REC im Dashboard, Dashboard hängt aus → **dieselbe** `recordingId` läuft weiter, `getUserMedia` wurde genau einmal gerufen, die Leiste zeigt „REC“ mit Laufzeit. Zurück ins Dashboard → Leiste weg, Statusleiste zeigt REC, weiter dieselbe Aufnahme.
- Leiste:
  - je Zeile der Tabelle in §4.7 ein Test für Text, Punkt und Knopf.
  - ohne aktive Session: nicht im Dokument.
  - Link „Zur Vorlesung“ zeigt auf `sessionHref(id)`.
  - `role="status"` ändert sich nicht, wenn die Laufzeit tickt (Fake-Uhr, 5 s).
  - „Aufnahme starten“ in der Leiste öffnet das Mikrofon. Danach REC.
  - Pausiert vom anderen Gerät: „Pausiert“ mit Dauer, die Aufnahme ist abgeschlossen.
  - `beendet` kommt per Ereignis, während der Nutzer auf „Heute“ ist: Aufnahme stoppt, Leiste verschwindet.
  - Dashboard einer **anderen** Session offen: Leiste bleibt, Aufnahme unverändert.
- Übernahme: Folge-Tab mit `permission: 'prompt'`. Klick auf „Hier übernehmen“, Rolle wechselt, Sperre wird erst später frei → `getUserMedia` wird ohne weiteren Klick gerufen. Ohne den Klick (Rolle kommt, weil der andere Tab schließt) → „Keine Aufnahme“ mit Knopf.
- Übernahme, `getUserMedia` lehnt mit `NotAllowedError` ab → „Zugriff verweigert“, „Erneut versuchen“ startet.
- #210 Kommentar 2: Tab A mit „Heute“ ist Leader und nimmt auf (REC in der Leiste). Tab B mit dem Dashboard zeigt „Aufnahme in anderem Tab“. `maxRunning` bleibt 1.
- **Auto-Stopp in mehreren Tabs** (zwei Bäume, je eigener `QueryClient` und Fake-Sync, ein Fake-Core, Pegelquelle je Baum über `env.autoStop.subscribeLevel`):
  - Beide erreichen Regel 4 zugleich: Die Session endet einmal. Es gibt höchstens zwei `POST …/stop`, beide 200, kein Fehlertext.
  - Tab B verlängert. Tab A (Leader) bekommt `session.updated`: Hinweis weg, kein Stopp.
  - Tab B verlängert. Tab C (Folge-Tab, alter Stand) erreicht die Grenze: `GET /sessions/{id}`, kein Stopp.
  - Der Leader bekommt 15 min stille Pegel, der Folge-Tab keine: Nur der Leader zeigt den Hinweis und stoppt mit `stille`. Der Folge-Tab stoppt nicht wegen Stille.
  - Die Rückfrage steht auf „Heute“ in der Leiste, im Dashboard in der Statusleiste, nie doppelt (`getAllByTestId('autostop-hint')` hat Länge 1).
- bfcache: `pageshow` mit `persisted: true` ruft `location.reload` (gestubbt), mit `false` nicht.
- „Heute“: je Zeile der Tabelle in §4.9 ein Test. Roter Punkt nur bei `rec`. Knopf in der Karte startet die Aufnahme. `StopConfirm` sagt bei REC „Weiter aufnehmen“. Die vorhandenen Tests zu „Läuft · ohne Aufnahme“ und „Läuft · anderer Tab“ (um Zeile 400) werden angepasst.
- `appshell.test.tsx`: Die Leiste liegt in der Inhaltsspalte nach `main`. Bei offenem Drawer ist sie `inert`.

**Risiken**
- Ab hier nimmt die App auf Seiten auf, auf denen der Nutzer es nicht erwartet. Die Leiste ist die einzige Anzeige. Fehlt sie durch einen Fehler, wird unsichtbar aufgenommen. Darum der Test „Dashboard einer anderen Session“ und „Dashboard lädt noch“.
- Safari bei der Übernahme (§8). Der Rückfall „Erneut versuchen“ muss da sein.
- Zwei Knöpfe „Aufnahme starten“ auf „Heute“ (Karte und Leiste). Tests greifen mit `within(...)` zu.
- `location.reload()` nach bfcache verwirft ungespeicherte Eingaben der Seite. Das betrifft nur die Rückkehr von einer fremden Seite.

**Review:** Opus, Stufe A. Im Browser (Chrome): Start auf „Heute“, durch alle Seiten der Seitenleiste klicken, `/dokument` und `/rueckblick` öffnen, schmal stellen, Drawer öffnen. Zwei Tabs, Auto-Stopp-Hinweis mit kurzer Grenze in den Einstellungen. Doku-Teile prüft derselbe Reviewer mit.

**Akzeptanzkriterien**
- [ ] Die Aufnahme läuft über jede SPA-Navigation weiter, mit derselben `recordingId`.
- [ ] Kein Link innerhalb der App lädt die Seite neu (kein rohes `<a href="/…">`).
- [ ] Außerhalb des Dashboards der aktiven Session steht die Leiste, im Dashboard nicht.
- [ ] „Heute“ zeigt bei laufender Aufnahme „Läuft · Aufnahme“ mit rotem Punkt.
- [ ] Kein Text in App und Anleitung sagt noch, die Aufnahme laufe nur in der Vorlesungs-Ansicht.
- [ ] UX-01 und UX-59 sind in `STUDIENALLTAG-2.md` als erledigt geführt.

---

## 6. Fallstricke für den Worker

1. **Nicht nach ID nachladen.** `useTrackedSession` darf `GET /sessions/{id}` nicht aufrufen. Sonst kippen die Zähl-Tests im Dashboard.
2. **`refetchInterval` an `online` binden, nicht an `live`.** Siehe Kommentar an `useLiveState` in `use-today.ts`.
3. **Recorder nur im Effekt anlegen** (StrictMode), wie heute. Kein Recorder beim Rendern.
4. **`LeaderRecording.dispose()` vor `recorder.dispose()`**, und dazwischen `await control.idle()`. Die Reihenfolge aus `use-recording.ts` bleibt.
5. **Pegel in Tests:** `subscribeAudioLevel` ist Modulzustand. Zwei „Tabs“ in einem Testprozess teilen ihn. Darum `env.autoStop.subscribeLevel` je Baum.
6. **`hasMicIntent` wird gelesen, nicht verbraucht** (StrictMode). Der Test „Startgeste für eine andere Session zählt nicht“ bleibt gültig: `noteMicIntent(andereId)` setzt die Tab-Erlaubnis **nicht**.
7. **`useLayoutEffect` für die Anmeldung des Dashboards**, sonst blitzt die Leiste beim Öffnen des Dashboards einen Frame lang auf.
8. **Kein `useSearchParams` in `AppShell`.**
9. **Texte der Statusleiste bleiben wörtlich.** Viele Tests suchen „REC“, „Keine Aufnahme“, „Aufnahme in anderem Tab“.
10. **Kein „Nicht gestartet“ für eine laufende Session.** Solange `useActiveSession` lädt, liefert `useRecordingFor` `starting` (§3.4).
11. **`previousStopped` an `control.idle()` hängen, nicht an `flushUploads`** (§4.3).

---

## 7. Punkte für den Owner (zur Info, kein Blocker)

Beide Punkte entscheidet der Lead mit der Empfehlung. Frage 1 legt der Vertrag (#246, „Aufnahme-Leiste“) schon fest. Frage 2 folgt aus dem Vertrag („Nutzeraktion“, „startet von selbst bei erteilter Berechtigung“) und aus E6. Der Lead nennt beide im Stand in #188. Ein Issue mit Label `entscheidung` gibt es nur, wenn der Owner etwas anders haben will. Die Umsetzung wartet nicht.

**Frage 1 · Soll die Leiste auch „Pause“ und „Beenden“ haben?**

| Option | Folge |
|---|---|
| A · Nein, nur Zustand, „Aufnahme starten“, Auto-Stopp-Rückfrage und „Zur Vorlesung“ | So steht es im Vertrag (#246). Die Leiste bleibt schmal. Für Pause und Beenden geht man ins Dashboard oder auf „Heute“. |
| B · Nur „Pause“/„Fortsetzen“ | Ein Knopf mehr. Pause geht von jeder Seite. |
| C · Beides | „Beenden“ braucht die Rückfrage (UX-06), die Leiste wird zum zweiten Bedienfeld. |

Empfehlung: **A**. Ein versehentliches Beenden von einer fremden Seite wäre teurer als zwei Klicks.

**Frage 2 · Gilt „Aufnahme starten“ für den ganzen Tab?**

Fall: Du klickst einmal „Aufnahme starten“. Später startet eine andere Vorlesung, etwa vom iPad. Soll derselbe Tab dann von selbst aufnehmen?

| Option | Folge |
|---|---|
| A · Ja, bis zum Neuladen des Tabs | Kein zweiter Klick. Verhält sich wie ein Browser mit erteilter Mikrofon-Berechtigung. |
| B · Nein, je Vorlesung neu klicken | Mehr Kontrolle. Wer den Klick vergisst, hat eine Vorlesung ohne Ton. |

Empfehlung: **A** (E6). Die Leiste zeigt REC auf jeder Seite, unbemerkt wird nichts aufgenommen.

---

## 8. Nicht geprüft

Diese Punkte lassen sich nur im echten Browser klären. Die Tests laufen in jsdom mit Fakes.

| Punkt | Was unklar ist | Wer prüft |
|---|---|---|
| Safari: `getUserMedia` nach „Hier übernehmen“ | Ob die Abfrage erscheint, wenn zwischen Klick und Aufruf Sekunden liegen. Rückfall „Erneut versuchen“ ist eingebaut (§4.4). | Owner, Safari am Mac |
| Safari: `AudioContext` ohne frische Nutzeraktion | Ob Pegel kommen. Ohne Pegel gelten nur die harten Grenzen. | Owner |
| Safari: Mikrofon beim Wechsel der Session | Ob Safari beim zweiten `getUserMedia` im selben Tab erneut fragt. | Owner |
| bfcache | Ob Chrome, Safari und Firefox die Seite mit gehaltenen Web Locks, offenem WebSocket und `beforeunload` überhaupt einfrieren. Und ob `pageshow` mit `persisted` dann kommt. | Reviewer in Chrome, Owner in Safari |
| `pagehide` | Ob der mit `requestData()` herausgegebene Rest noch in IndexedDB landet, bevor der Tab stirbt (Hash und Schreiben sind asynchron). Der Vertrag sagt „nur nach Möglichkeit“. | Reviewer, Tab schließen bei REC, danach Chunks zählen |
| `beforeunload` | Ob die Rückfrage erscheint. Das entscheidet der Browser. | Reviewer |
| Tab im Hintergrund | Ob Timer-Drosselung das 10-s-Polling und den 1-s-Takt des Auto-Stopps streckt. Ein Tab mit offenem Mikrofon wird meist nicht gedrosselt, ein Folge-Tab schon. | Reviewer, Tab 10 min verdeckt |
| Lange Aufnahme über viele Seitenwechsel | Ob `MediaRecorder` über Stunden und viele Navigationen stabil bleibt. | Owner (§16.3: lange Aufnahmen kann nur der Owner testen) |
| Mac ohne Netz | React Query (5.105) pausiert Abfragen und Mutationen, sobald der Browser das Ereignis `offline` meldet (WLAN fällt weg, während die App offen ist). Dieser Plan stellt nur die Abfrage der aktiven Session auf `networkMode: 'always'`. Betroffen bleibt hier `GET /settings` im `AutoStopHost`: Fehlt der Stand im Cache, bleibt der Auto-Stopp still, bis der Browser wieder `online` meldet. Eigenes Ticket für den Lead (`networkMode: 'always'` app-weit in `makeQueryClient`), möglichst vor PR 3. | Lead |
| Zwei echte Tabs | Web Locks `steal`, während im alten Tab die Mikrofon-Abfrage offen ist. | Reviewer in Chrome |

---

## 9. Reihenfolge und Abhängigkeiten

1. #246 mergen (Vertrag).
2. PR 1, Review, Merge.
3. PR 2, Review, Merge.
4. PR 3, Review, Merge. Danach #210 schließen. Offen bleiben daraus „Mikrofon testen“ und `paused_at` als eigene Tickets.

Parallel geht nichts: Alle drei PRs fassen dieselben Dateien an (`StatusBar.tsx`, `AppShell.tsx`, den Provider).
