# Plan T1-24: Moodle-Aktionen aus dem Katalog, Uploads

Stand: 12. November 2026 · Basis: `main` (`3d22da3`).
Den Code schreibt Sonnet. **Die PRs 1 bis 3 sind sicherheitskritisch (Stufe A): Ein frischer Opus-Subagent reviewt, ein zweiter frischer Opus-Subagent macht das Gegen-Review** (CLAUDE.md, Merge-Regeln). PR 4 (Web) ist Stufe A, weil er Uploads und die Bestätigung bedient. Dieser Plan geht vor der Umsetzung durch ein Opus-Review. **Das Review ist eingearbeitet (12.11.2026).** B1 und B2 sind vorgezogen und in einem eigenen PR behoben (#290). PR 1 baut auf ihm auf.

Quellen: `docs/spezifikation/04-FUNKTIONEN.md` (F-MDL-05, F-MDL-06), `08-SCHNITTSTELLEN.md` §9.1 und §9.3, `07-UX.md` (R1), `10-UMSETZUNG.md` (T1-24, T1-25), `docs/VERTRAEGE.md` §5 und §17, Issue #93 Punkt 4, Code in `services/core/src/moodle/`, `services/core/src/routes/moodle.ts`, `apps/web/src`.

**Wichtig zur Beweislage:** In diesem Container gibt es kein Moodle. Alle Angaben zu Moodle-Funktionen, ihren Parametern und Antworten stammen aus dem Gedächtnis. Sie sind im Text mit **„nicht geprüft“** markiert und stehen gesammelt in §9. Darum baut jeder Handler defensiv (§4.1) und jede Aktion wird vor der Freigabe einmal gegen das echte Moodle geprüft (§9.1).

---

## 1. Ziel und Abgrenzung

### 1.1 Ziel

- Die sieben fehlenden Aktionen aus dem Katalog bekommen Handler: `assign.save_draft`, `assign.submit`, `forum.create_discussion`, `forum.reply`, `message.send`, `calendar.create_event`, `files.upload_private`.
- Es gibt die Upload-Route `POST /moodle/uploads`.
- Der Bestätigungscode hängt zusätzlich am Stand in Moodle (#93 Punkt 4).
- Die Web-App bekommt die Abgabe als ersten Ort, an dem der Nutzer eine Aktion auslöst.

### 1.2 Was heute da ist (mit Beleg)

| Thema | Stand | Beleg |
|---|---|---|
| Katalog | Alle 9 Aktionen stehen mit Text, Risiko, Schema und `wsfunctions` drin | `moodle/actions.ts`, `MOODLE_ACTION_SPECS` |
| Handler | Nur `completion.set` und `notifications.mark_read` | `DEFAULT_ACTION_HANDLERS` |
| Fehlende Handler | `501 moodle_action_not_implemented`, im Katalog `available: false` | `MoodleActionRegistry.handler`, `catalog` |
| Vorschau, Ausführen | Vorhanden. Reihenfolge: umgesetzt → Parameter → eingerichtet → Funktionen freigegeben → Bestätigung | `routes/moodle.ts`, `prepare` |
| Bestätigungscode | 128 bit, 5 min, einmal, gebunden an Aktion und Parameter. Jeder Versuch verbraucht ihn | `moodle/confirmations.ts` |
| Verschärfung im Einzelfall | Schnittstelle `requiresConfirmation` ist da, nutzt noch niemand | `MoodleActionHandler` |
| **Upload-Route** | **Fehlt.** `POST /moodle/uploads` steht nur im Vertrag (08 §9.3). Das Schema `MoodleUpload` gibt es | `grep uploads routes/moodle.ts` ist leer |
| Upload zu Moodle | **Fehlt.** Der Client kann nur `read`, `write` (Formular) und Downloads | `moodle/client.ts` |
| Reservierte Felder | `wstoken`, `wsfunction`, `moodlewsrestformat` sind gesperrt und stehen am Ende des Bodys | `RESERVED_FIELDS`, `flattenParams`, `call` |
| Schreibschutz für `read()` | Alle Schreibfunktionen des Katalogs stehen in `WRITE_WSFUNCTIONS` | `client.ts` |
| Web-App | Ruft noch **keine** Aktion auf. Es gibt keinen `MoodleActionButton` | `grep moodle/actions apps/web` ist leer |
| Fristen in der Web-App | Die Modulseite listet Moodle-Fristen, Aufgaben tragen `assignment_id` | `MoodleDeadlines.tsx`, `MoodleSyncedDeadline` |

### 1.3 Befunde aus der Prüfung (gehen in PR 1)

- **B1 · Aktionen sind aus dem Netz erreichbar.** **Behoben in #290.** Die Moodle-Routen tragen kein `sgAccess: 'local'`. Ein gekoppeltes iPad kann mit seinem Geräte-Token Vorschau und Ausführen aufrufen. Die iPad-App tut das nicht. Ein gestohlenes Geräte-Token könnte aber im Namen des Nutzers abgeben oder posten. Das gilt auch für Aktionen mit Code, denn den Code liefert die Vorschau. Betroffen sind das WLAN und der Tunnel-Eingang (#274). Siehe E2.
- **B2 · Der Code kann in der Datenbank landen.** **Behoben in #290.** Die Vorschau hat kein `idempotency: false`. Schickt ein Client `Idempotency-Key` mit, speichert das Plugin die Antwort samt `confirmation_token` in Postgres. Ein Replay mit demselben Schlüssel gibt denselben Code noch einmal aus. Der Vertrag sagt „nur im Speicher des Core“. Siehe E3.
- **B3 · Keine KI-Stelle schlägt Moodle-Aktionen vor.** Geprüft: Der Worker kennt Moodle nicht (`grep -i moodle services/worker` ist leer). Der LLM-Aufruf hat keine Werkzeuge (`ai/llm.py` filtert `tool_use` nur als internen Blocktyp heraus). Der Core ruft selbst kein Modell auf, und außer `routes/moodle.ts` ruft nur `moodle/actions.ts` `client.write` auf. Die Vorschläge der Inbox sind `concept_new`, `concept_merge` und `relation`. `MoodleInbox` ordnet nur Dateien lokal ein. Das bleibt so und wird per Test abgesichert (§5.6).
- **B4 · Blatt und Aufgabe sind nicht dauerhaft verknüpft.** `matchSheets` überträgt nur das Abgabedatum. Am Übungsblatt steht keine `assignment_id`. Siehe E9.

### 1.4 Was nicht dazu gehört

- Quiz-Versuche, Gruppenwahl, alles, was andere Personen verwaltet (F-MDL-05).
- Aktionen von der iPad-App aus.
- Entwürfe von Texten durch eine KI.
- Ein Editor für formatierten Text. Die Web-App schickt schlichten Text.
- Statushinweis zum Token (Rest von T1-25).

---

## 2. Entscheidungen des Leads

| Nr. | Entscheidung | Grund |
|---|---|---|
| E1 | **Der Code hängt an Aktion, Parametern und Stand.** Jeder Handler kann einen Stand liefern (`state`). Er fließt in den Hash ein und wird beim Ausführen neu gelesen (§3.2). | #93 P4, empfohlene Variante. Erfasst auch Änderungen direkt in Moodle |
| E1a | **Zusätzlich** verwirft `assign.save_draft` alle offenen Codes derselben Aufgabe, sobald es zu schreiben versucht hat. Das gilt auch bei Fehlern und `outcome_unknown`. Umgesetzt wird das über einen Zähler je Bereich (§3.2), damit auch eine Vorschau verfällt, die gerade parallel läuft. Ausführen zur selben Aufgabe läuft im Core nacheinander (Sperre je Aufgabe). | Zweite Linie für eigene Aufrufe. Die erste Linie ist die Standprüfung (E1), sie erfasst auch Änderungen direkt in Moodle |
| E2 | `POST /moodle/uploads`, `DELETE /moodle/uploads/{id}`, `preview` und `execute` bekommen `sgAccess: 'local'`. Aus dem Netz: `403 local_only`. **`preview` und `execute`: erledigt in #290.** Die Upload-Routen folgen in PR 2. | B1. Moodle-Schreiben gehört an den Mac |
| E3 | `preview` und die Upload-Routen bekommen `idempotency: false`. `execute` behält `Idempotency-Key`. **`preview`: erledigt in #290.** | B2. Die Antwort von `execute` enthält kein Geheimnis |
| E4 | Uploads leben nur im Speicher des Core (Verzeichnis plus Liste im Speicher). Beim Start wird `tmp/moodle-uploads/` geleert. | Kein neues Schema, keine Reste. Ein Neustart macht auch alle Codes ungültig |
| E5 | Der Inhalt eines Uploads ist unveränderlich. `sha256`, Größe und Name jedes Uploads gehören zum Stand (E1). | Der Code gilt für genau diese Dateien |
| E6 | Neuer Fehlercode `409 moodle_action_rejected` mit `details.reason` für fachliche Ablehnungen vor dem Schreiben (§4.2). | Die Web-App braucht klare Gründe statt `502 moodle_error` |
| E7 | `calendar.create_event` nutzt `core_calendar_create_calendar_events` statt `core_calendar_submit_create_update_form`. | Nimmt einen Unix-Zeitstempel. Das Formular rechnet in der Moodle-Zeitzone des Nutzers und braucht Formularfelder. **Nicht geprüft**, ob die Funktion freigegeben ist. Der Katalog zeigt es zur Laufzeit |
| E8 | In einer laufenden Session zeigt die Web-App die Bestätigung **in der Seite**, nicht als Dialog. Kein Toast. Außerhalb einer Session bleibt der Dialog aus F-MDL-06. | R1 verbietet Dialoge und Popups. Eine Frist kann aber in eine Vorlesung fallen. Siehe Owner-Frage F3 |
| E9 | Einstieg in die Abgabe ist die Fristenliste der Modulseite, nicht das Übungsblatt. | B4. Der Weg vom Blatt braucht eine gespeicherte Verknüpfung, das ist ein eigenes Ticket |
| E10 | Reihenfolge: zuerst `assign.*`, dann die Web-Abgabe. `forum.*` und der Rest erst nach der Antwort des Owners (F1). | Abgaben sind der Kernnutzen. Öffentliches Posten ist das größere Risiko |
| E11 | Handler lesen alles, was sie für Vorschau und Prüfung brauchen, selbst und roh aus Moodle. Die Schemas `Moodle*` der Lese-Endpunkte bleiben unverändert. | Kein Vertragsbruch für die Web-App |
| E12 | Neuer Schalter `SG_MOODLE_ACTIONS` **(kommt mit PR 1)**: kommagetrennte Liste der Aktionen aus T1-24, die der Core anbietet. Standard leer. Eine unbekannte Kennung bricht den Start mit einer Meldung ab. Nicht gelistete Aktionen bleiben `available: false` und antworten mit `501 moodle_action_not_implemented`, auch wenn ihr Handler im Code steht. `completion.set` und `notifications.mark_read` hängen nicht daran. Solange keine gelistete Aktion `upload_ids` annimmt, antwortet `POST /moodle/uploads` ebenfalls mit `501 moodle_action_not_implemented`. Kommt in die Tabelle der Umgebungsvariablen in `docs/VERTRAEGE.md` §1. | Handler lassen sich mergen, bevor sie gegen das echte Moodle geprüft sind (§9.1). Der Owner schaltet jede Aktion einzeln frei. Standardmäßig ist alles aus, auch die Upload-Route |

---

## 3. Schnittstellen (festgelegt, bevor gebaut wird)

### 3.1 Handler (`moodle/actions.ts`, PR 1)

```ts
export interface MoodleActionHandler<P> {
  requiresConfirmation?(ctx: MoodleActionContext, params: P): Promise<boolean>;
  /**
   * Stand, an den der Bestätigungscode gebunden wird. Nur Lesen. Muss bei gleichem Stand in Moodle
   * dasselbe JSON liefern (keine Uhrzeit, keine Zufallswerte). Fehlt die Methode, gilt `null`.
   */
  state?(ctx: MoodleActionContext, params: P): Promise<unknown>;
  /** Aktionen mit gleichem Schlüssel laufen im Core nacheinander, z. B. `assign:42` */
  lockKey?(params: P): string | null;
  /** Codes mit diesem Geltungsbereich verfallen, wenn diese Aktion erfolgreich war */
  revokesScope?(params: P): string | null;
  /** Geltungsbereich des eigenen Codes, z. B. `assign:42` */
  scope?(params: P): string | null;
  preview(ctx: MoodleActionContext, params: P, state: unknown): Promise<MoodleActionPreviewResult>;
  execute(ctx: MoodleActionContext, params: P, state: unknown): Promise<MoodleActionOutcome>;
}

export interface MoodleActionContext {
  client: MoodleClient;
  userId(): Promise<number>;
  /** PR 2. Löst `upload_ids` auf. Unbekannt oder verfallen → 404 `moodle_upload_not_found` */
  uploads: MoodleUploadStore;
  /** PR 3. Kurs-ID einer Aufgabe aus `moodle_deadline` (lokal, ohne Moodle). `null`, wenn unbekannt oder ohne DB */
  courseIdOfAssignment(assignmentId: number): Promise<number | null>;
}
```

`preview` und `execute` bekommen den schon gelesenen Stand. So liest ein Handler Moodle je Aufruf nur einmal.

### 3.2 Bestätigungscodes (`moodle/confirmations.ts`, PR 1)

```ts
export type ConsumeResult = 'ok' | 'invalid' | 'state_changed';

/** Stand des Zählers für diesen Bereich. Die Vorschau liest ihn, **bevor** sie den Stand aus Moodle liest */
epoch(scope: string): number;
issue(actionId: string, params: unknown, binding?: { state?: unknown; scope?: string | null; epoch?: number }):
  { token: string; expiresAt: Date };
consume(token: string, actionId: string, params: unknown, state?: unknown): ConsumeResult;
/** Erhöht den Zähler des Bereichs und verwirft alle offenen Codes mit diesem Bereich. Liefert die Anzahl */
revokeScope(scope: string): number;
```

- Gespeichert werden zwei Hashes: `paramsHash(actionId, params)` wie heute und `stateHash = sha256(canonicalJson(state ?? null))`.
- **Zähler je Bereich:** `issue` mit `scope` vergleicht `binding.epoch` mit dem aktuellen Zähler. Ist er inzwischen gestiegen, lief zwischen Lesen und Ausgeben ein `revokeScope`. Dann wird der Code gar nicht erst gültig: `issue` gibt ihn aus, `consume` liefert aber `invalid`. Ohne den Zähler käme eine Vorschau durch, die den Stand vor einem parallelen `save_draft` gelesen und den Code erst nach dessen Widerruf ausgegeben hat. Der Zähler lebt im Speicher wie die Codes.
- `consume` löscht den Code immer zuerst. Dann: abgelaufen oder falscher Parameter-Hash → `invalid`. Parameter gleich, Stand anders → `state_changed`. Beide Vergleiche mit `timingSafeEqual`.
- Beide Fälle bleiben `409 moodle_confirmation_invalid`. Bei `state_changed` kommt `details.reason = "stand_geaendert"` dazu. Die Web-App holt dann eine neue Vorschau.
- Aufrufe ohne `binding` verhalten sich wie heute. Die Tests aus T1-21 bleiben grün.

### 3.3 Ablauf in `routes/moodle.ts` (PR 1)

Vorschau:
1. `prepare` wie heute.
2. `scope = handler.scope?.(params) ?? null`, `epoch = scope ? confirmations.epoch(scope) : 0`.
3. `state = await handler.state?.(ctx, params) ?? null`.
4. `preview(ctx, params, state)`.
5. Bei `confirm`: `confirmations.issue(id, params, { state, scope, epoch })`.

Die Vorschau nimmt keine Sperre. Ein langer Upload in `save_draft` soll die Vorschau nicht blockieren. Den Wettlauf deckt der Zähler ab.

Ausführen:
1. `prepare` wie heute.
2. Sperre nehmen, wenn `lockKey` einen Schlüssel liefert (`KeyedMutex` im Speicher, neue Datei `moodle/locks.ts`). Höchstens 10 s warten, sonst `409 moodle_action_busy` („Für diese Aufgabe läuft gerade eine andere Aktion.“). Ein Upload kann viele Minuten dauern, die Anfrage soll nicht so lange hängen.
3. `state` neu lesen. **Erst danach** den Code einlösen: `consume(token, id, params, state)`.
4. `execute(ctx, params, state)`.
5. Hat `execute` begonnen, wird `revokesScope` ausgewertet und `revokeScope` aufgerufen, **im `finally`**. Das gilt auch bei Fehler und `outcome_unknown`, denn der Entwurf kann sich dann schon geändert haben. Lehnt eine Vorprüfung im Handler ab (`409 moodle_action_rejected`, nichts geschrieben), darf der Widerruf entfallen.
6. Sperre immer freigeben (`finally`).

Scheitert Schritt 3 am Lesen von Moodle, bleibt der Code offen. Das ist gewollt: Es wurde nichts geschrieben.

### 3.4 Upload-Speicher (`moodle/uploads.ts`, PR 2)

```ts
export interface StoredUpload {
  id: string;            // UUIDv7, vom Core vergeben
  path: string;          // <dataDir>/tmp/moodle-uploads/<id>, nie aus einer Eingabe gebaut
  filename: string;      // bereinigt (sanitizeFilename), höchstens 255 Byte
  sizeBytes: number;
  sha256: string;
  kind: 'pdf' | 'png' | 'jpeg' | 'zip' | 'text';
  expiresAt: Date;       // + 24 h
}

export class MoodleUploadStore {
  constructor(options: { dataDir: string; now?: () => number });
  /** Leert das Verzeichnis. Beim Start des Core */
  reset(): Promise<void>;
  add(file: Omit<StoredUpload, 'expiresAt'>): StoredUpload;
  /** Wirft 404 `moodle_upload_not_found`, wenn eine ID fehlt oder verfallen ist. Doppelte IDs → 400 */
  resolve(ids: readonly string[]): StoredUpload[];
  remove(id: string): Promise<boolean>;
  /** Löscht Verfallenes. Stündlich und vor jedem `add` */
  sweep(): Promise<void>;
  /** Markiert Uploads als „in Benutzung“, solange eine Aktion sie liest. `release` im `finally` */
  acquire(ids: readonly string[]): StoredUpload[];
  release(ids: readonly string[]): void;
}
```

- **In Benutzung:** `sweep` und `remove` lassen Uploads in Benutzung liegen. `DELETE /moodle/uploads/{id}` antwortet dann mit `409 moodle_upload_in_use`. Sonst kann ein Verfall oder ein „Entfernen“ in der Web-App die Datei mitten im Hochladen zu Moodle löschen. Dasselbe gilt, wenn zwei Aktionen dieselbe `upload_id` nutzen und die erste sie nach Erfolg löscht. Gelöscht wird nach Erfolg nur, was danach nicht mehr in Benutzung ist.
- **Plätze vor dem Schreiben:** Anzahl (20) und Byte (500 MB) werden **vor** dem Streamen reserviert, laufende Uploads zählen mit. Sonst überschreiten 20 gleichzeitige Uploads die Grenze, bevor einer fertig ist. Bricht ein Upload ab, wird der Platz frei.
- **Nie ausliefern:** Der Core liefert den Inhalt eines Uploads nie zurück. Es gibt kein `GET` dafür. Damit spielen Polyglot-Dateien (z. B. PNG, das auch ZIP ist) für den Core keine Rolle.

### 3.5 Upload zu Moodle (`moodle/client.ts`, PR 2)

```ts
/** Lädt Dateien nacheinander in einen Entwurfsbereich. Liefert dessen `itemid` */
uploadDraft(files: readonly { path: string; filename: string; sizeBytes: number }[]): Promise<{ itemid: number }>;
```

- `POST <basis>/webservice/upload.php`, `multipart/form-data`. Felder: `token`, `filearea=draft`, `itemid` (erste Datei `0`, danach die gelieferte `itemid`), `file_1`. **Nicht geprüft.**
- Der Token steht im Formularfeld, nie in der URL. `redirect: 'manual'`.
- Eine Datei je Anfrage. Der Inhalt wird gestreamt (`fs.openAsBlob`), nie ganz in den Speicher geladen.
- Zählt in Drosselung und REST-Pool. Zeitlimit: 120 s, bei großen Dateien länger (mindestens 64 KiB/s gerechnet).
- **Nie wiederholen.** Netzwerkfehler, Zeitlimit, `5xx` → `502 moodle_unreachable` mit `details.outcome_unknown = true`.
- Antwort ist ein Array mit einem Objekt je Datei. Ein Objekt mit `error` oder eine Antwort `{ error, errorcode }` ist ein Fehler: `invalidtoken` → `409 moodle_token_invalid`, sonst `502 moodle_error`. **Nicht geprüft.**
- Log: `upload.php`, Dauer, Anzahl, Byte. Kein Dateiname, kein Token.

### 3.6 Routen (PR 2)

| Endpunkt | Body | Antwort | Fehler |
|---|---|---|---|
| `POST /moodle/uploads` | multipart, genau ein Feld `file` | `201 MoodleUpload` | `415 multipart_required`, `413 file_too_large` (beide wie in `routes/material.ts`), `400 moodle_upload_type_invalid`, `409 moodle_upload_limit`, `403 local_only` |
| `DELETE /moodle/uploads/{upload_id}` | – | `204` | `404 moodle_upload_not_found`, `403 local_only` |

Beide antworten auch ohne eingerichtetes Moodle. Sie sprechen Moodle nicht an.

### 3.7 Textvorschläge für die Verträge

**08 §9.3** (mit PR 1):
> - **Bindung an den Stand:** Der Code hängt außerdem am Stand in Moodle, den die Aktion verändert (z. B. Entwurf einer Aufgabe: Status, `timemodified`, Dateien, Text). Der Core liest den Stand beim Ausführen neu. Weicht er ab, antwortet er mit `409 moodle_confirmation_invalid` und `details.reason = "stand_geaendert"`. Speichert `assign.save_draft` erfolgreich, verfallen alle offenen Codes derselben Aufgabe.
> - **Nur lokal:** `POST /moodle/uploads`, `DELETE /moodle/uploads/{upload_id}`, `preview` und `execute` sind nur vom Mac selbst erreichbar (`403 local_only`). `preview` und die Upload-Routen speichern nichts unter einem `Idempotency-Key`.

**08 §9.3** (mit PR 2):
> - **Uploads:** eine Datei je Anfrage, höchstens 100 MB. Erlaubt sind PDF, PNG, JPEG, ZIP und Text (UTF-8). Der Core prüft Endung und Anfangsbytes. Höchstens 20 offene Uploads und 500 MB zusammen. Ein Neustart des Core verwirft alle Uploads. Der Dateiname wird bereinigt und nie als Pfad verwendet.

**08 §9.1, Fehlercodes:**
> | 409 | `moodle_action_rejected` | Die Aktion ist nach dem Stand in Moodle nicht möglich. `details.reason` nennt den Grund |
> | 404 | `moodle_upload_not_found` | Unbekannte oder verfallene `upload_id` |
> | 409 | `moodle_upload_limit` | Zu viele oder zu große offene Uploads |
> | 409 | `moodle_upload_in_use` | Upload wird gerade von einer Aktion gelesen und lässt sich nicht entfernen |
> | 409 | `moodle_action_busy` | Für dieselbe Aufgabe läuft gerade eine andere Aktion (Sperre länger als 10 s belegt) |
> | 400 | `moodle_upload_type_invalid` | Dateityp nicht erlaubt, Endung passt nicht zum Inhalt oder Datei leer |

**08 §9.3, Tabelle der Parameter:** bei `calendar.create_event` die Funktion auf `core_calendar_create_calendar_events` ändern (E7). Bei allen Aktionen die lesenden Funktionen aus §4 ergänzen.

---

## 4. Die Aktionen

### 4.1 Regeln für alle Handler

- Nur `ctx.client.read` und `ctx.client.write`. Kein eigenes `fetch`.
- Jede lesende Funktion, die ein Handler braucht, steht in `wsfunctions` des Katalogs. Sonst wäre die Aktion „verfügbar“ und scheitert dann.
- Antworten von Moodle nie blind vertrauen. `null`, fehlende Felder und falsche Typen führen nie zu `500`.
- Moodle meldet Erfolg oft als leere Warnliste. Eine nicht leere Liste ist ein Fehler: `502 moodle_error` mit dem ersten `warningcode` in `details.moodle_errorcode`.
- Nach dem Schreiben den Stand neu lesen und im Ergebnis melden, was Moodle wirklich zeigt. Scheitert nur dieses Nachlesen, gilt die Aktion als gelungen. Das Ergebnis trägt dann `verified: false`.
- Texte der Vorschau sind Klartext. Namen aus Moodle (Kurs, Aufgabe, Person) werden auf 120 Zeichen gekürzt und von Steuerzeichen befreit.
- HTML aus Parametern geht unverändert an Moodle. Für die Vorschau entfernt der Core alle Tags und zeigt die ersten 500 Zeichen als `details.text_preview`.
- `execute` schreibt höchstens einmal je Schreibfunktion. Kein Wiederholen.

### 4.2 Gründe für `409 moodle_action_rejected`

`nicht_bearbeitbar`, `frist_vorbei`, `noch_nicht_offen`, `schon_eingereicht`, `nichts_einzureichen`, `erklaerung_fehlt`, `abgabeart_nicht_erlaubt`, `zu_viele_dateien`, `datei_zu_gross`, `dateityp_nicht_erlaubt`, `uploads_nicht_freigegeben`, `forum_gesperrt`, `empfaenger_nicht_erreichbar`, `nicht_gefunden`.

### 4.3 `assign.save_draft` (PR 3)

| Punkt | Inhalt |
|---|---|
| Moodle | Lesen: `mod_assign_get_assignments` (Einstellungen), `mod_assign_get_submission_status` (`assignid`). Schreiben: `upload.php`, dann `mod_assign_save_submission` mit `assignmentid`, `plugindata[files_filemanager]=<itemid>`, `plugindata[onlinetext_editor][text]`, `[format]=1`, `[itemid]=<itemid>`. **Nicht geprüft** |
| Stand | `{ submission_id, status, timemodified, attemptnumber, dateien: [{ name, bytes, timemodified }] sortiert, text_sha256, requires_submit, uploads: [{ sha256, bytes, name }] }` |
| Risiko | `aenderbar`. **Mit Code**, wenn `requires_submit = false` (Speichern ist dort die Abgabe) |
| Sperre, Bereich | `lockKey = scope = revokesScope = "assign:<id>"` |
| Vorschau | „2 Dateien als Entwurf in ‚Blatt 3‘ (Kurs …) speichern: loesung.pdf (1,2 MB), anhang.zip (300 KB).“ |
| Warnungen | „Ersetzt den bisherigen Entwurf: alt.pdf.“ · „Bei dieser Aufgabe ist Speichern schon die Abgabe.“ · „Die Frist ist seit … abgelaufen. Die Abgabe gilt als verspätet.“ · „Gruppenabgabe: Das gilt für die ganze Gruppe.“ |
| Ergebnis | `{ state, files: [...], last_modified_at, verified }` |

Vorprüfungen (alle → `409 moodle_action_rejected`, bevor irgendetwas hochgeladen wird):
- Aufgabe nicht gefunden → `nicht_gefunden`.
- `canedit` falsch → `schon_eingereicht` (Status `submitted`), `frist_vorbei` (nach `cutoffdate`), `noch_nicht_offen`, sonst `nicht_bearbeitbar`.
- Dateien geschickt, aber Abgabeart „Datei“ aus, oder Text geschickt, aber „Online-Text“ aus → `abgabeart_nicht_erlaubt`.
- Mehr Dateien als `maxfilesubmissions`, Datei größer als `maxsubmissionsizebytes`, Endung nicht in `filetypeslist` → passender Grund. Die Werte stehen in `configs` der Aufgabe. **Nicht geprüft.**
- `uploadfiles` in `core_webservice_get_site_info` ist nicht `1` → `uploads_nicht_freigegeben`. **Nicht geprüft.**

Fallstricke:
- **Nur schicken, was der Nutzer angibt.** Fehlt `upload_ids`, bleibt `files_filemanager` weg. Fehlt der Text, bleibt `onlinetext_editor` weg. **Nicht geprüft**, ob Moodle den fehlenden Teil dann unverändert lässt. Darum liest der Handler danach den Stand und meldet verlorene Dateien als Warnung im Ergebnis. Vor der Freigabe gegen das echte Moodle prüfen (§9.1).
- Die Aufgabe ohne Kurs-ID zu finden kostet einen großen Aufruf über alle Kurse. Zuerst `ctx.courseIdOfAssignment` fragen (§3.1), sonst `mod_assign_get_assignments` ohne `courseids` lesen.
- Der Stand wird **vor** dem Upload gelesen. Der Upload ändert den Entwurf noch nicht.
- Nach Erfolg die benutzten Uploads löschen. Bei `outcome_unknown` bleiben sie liegen.

Tests mit dem Fake:
- Erfolg mit Dateien, mit Text, mit beidem. Der Fake prüft die Felder von `upload.php` und `plugindata`.
- Kein `files_filemanager`, wenn nur Text kommt.
- `requires_submit = false`: `execute` ohne Code → `409 moodle_confirmation_required`. Mit Code aus der Vorschau → Erfolg.
- Jede Vorprüfung einzeln. Der Fake sieht dabei keinen Schreibaufruf und keinen Upload.
- Unbekannte `upload_id` → `404`, kein Aufruf an Moodle.
- Warnliste nicht leer → `502 moodle_error`.
- Upload bricht ab → `502` mit `outcome_unknown`, kein `mod_assign_save_submission`.
- Antwort `null` → kein `500`.

### 4.4 `assign.submit` (PR 3, schließt #93 P4)

| Punkt | Inhalt |
|---|---|
| Moodle | Lesen: `mod_assign_get_assignments`, `mod_assign_get_submission_status`. Schreiben: `mod_assign_submit_for_grading` mit `assignmentid`, `acceptsubmissionstatement` (0/1). **Nicht geprüft** |
| Stand | Wie bei `assign.save_draft`, ohne `uploads`, dazu `requires_statement` |
| Risiko | `endgueltig`. **Immer mit Code** |
| Sperre, Bereich | `lockKey = scope = "assign:<id>"` |
| Vorschau | „Abgabe ‚Blatt 3‘ in ‚Kurs …‘ endgültig einreichen: loesung.pdf (1,2 MB), zuletzt geändert 12.11. 14:03. Danach sind keine Änderungen mehr möglich.“ |
| `details` | `files`, `text_preview`, `last_modified_at`, `due_at`, `statement_text` (Klartext der Erklärung, wenn Moodle sie liefert) |
| Warnungen | Verspätung, Gruppenabgabe, „Der Entwurf ist leer“ führt nicht zur Warnung, sondern zur Ablehnung |
| Ergebnis | `{ state: "eingereicht", last_modified_at, verified }` |

Vorprüfungen:
- `requires_submit = false` → `nichts_einzureichen` (dort gibt es keinen Einreichen-Schritt).
- Status `submitted` → `schon_eingereicht`. Kein Entwurf, keine Datei und kein Text → `nichts_einzureichen`.
- `cansubmit` falsch → `frist_vorbei` bzw. `nicht_bearbeitbar`.
- `requires_statement` und `accept_statement` ist `false` → `erklaerung_fehlt`.

**#93 Punkt 4, ausdrücklich:**
1. Vorschau liest den Entwurf und bindet den Code daran (E1).
2. `execute` liest den Entwurf neu. Hat jemand ihn geändert, in der App oder direkt in Moodle, kommt `409 moodle_confirmation_invalid` mit `stand_geaendert`. Es wird nichts eingereicht.
3. Ein `assign.save_draft` über den Core verwirft offene Codes derselben Aufgabe sofort (E1a).
4. Speichern und Einreichen derselben Aufgabe laufen nie gleichzeitig (Sperre).

**Restrisiko, ehrlich:** Zwischen dem Neulesen und `mod_assign_submit_for_grading` liegen Millisekunden. Ändert jemand den Entwurf genau dann direkt in Moodle, wird der neue Stand eingereicht. Moodle bietet kein „einreichen, wenn unverändert“. Der Handler liest danach den Stand und meldet eine Abweichung als Warnung.

Tests mit dem Fake:
- Erfolg. Der Fake sieht genau einen Schreibaufruf.
- **Gegenprobe #93:** Vorschau, dann ändert der Fake `timemodified` → `409` mit `stand_geaendert`, kein Schreibaufruf.
- Gleiche Gegenprobe mit geänderter Dateiliste bei gleichem `timemodified`.
- Vorschau für `submit`, dann `save_draft` derselben Aufgabe → der alte Code ist `invalid`. Ein Code für eine andere Aufgabe bleibt gültig.
- Zwei `execute` gleichzeitig (Fake hält die erste Antwort zurück): Die zweite wartet und scheitert dann am Stand. Hält die erste länger als 10 s: `409 moodle_action_busy`, kein Schreibaufruf der zweiten.
- **Wettlauf Vorschau gegen Speichern:** Die Vorschau zu `submit` liest den Stand, bevor `save_draft` schreibt, und gibt ihren Code erst danach aus (Fake hält das Lesen zurück). Der Code ist `invalid`.
- `save_draft` endet mit `502` und `outcome_unknown`. Offene Codes zu `submit` derselben Aufgabe sind danach `invalid`.
- Code ein zweites Mal → `409`. Code mit `accept_statement` anders → `409`.
- Jede Vorprüfung einzeln.
- Scheitert das Neulesen (`502`), ist der Code danach noch gültig.

### 4.5 `forum.create_discussion` (PR 5)

| Punkt | Inhalt |
|---|---|
| Moodle | Lesen: `mod_forum_get_forums_by_courses` (Name, Kurs), `mod_forum_can_add_discussion` (`forumid`). Schreiben: optional `upload.php`, dann `mod_forum_add_discussion` mit `forumid`, `subject`, `message`, `options[0][name]=attachmentsid`, `options[0][value]=<itemid>`. **Nicht geprüft** |
| Stand | `{ forum_id, uploads }`. Ein Forum hat keinen Stand, der sich leise ändert |
| Risiko | `oeffentlich`. **Immer mit Code** |
| Vorschau | „Neue Diskussion ‚Frage zu Blatt 3‘ im Forum ‚…‘ (Kurs …) veröffentlichen. Alle im Kurs sehen deinen Namen und den Text.“ |
| `details` | `subject`, `text_preview`, `files`, `forum_name`, `course_name` |
| Fehler | `forum_gesperrt` (`can_add_discussion` falsch, z. B. Ankündigungen), `nicht_gefunden`, `uploads_nicht_freigegeben` |
| Ergebnis | `{ discussion_id }` |

Tests: Erfolg mit und ohne Anhang. Ohne Code → `409`. Geänderter Betreff mit altem Code → `409`. `forum_gesperrt` ohne Schreibaufruf. Betreff mit Zeilenumbruch wird abgewiesen (`400`).

### 4.6 `forum.reply` (PR 5)

| Punkt | Inhalt |
|---|---|
| Moodle | Lesen: `mod_forum_get_discussion_post` (`postid`) für Betreff, Autor, Diskussion. Schreiben: `mod_forum_add_discussion_post` mit `postid`, `subject`, `message`, `messageformat=1`, optional `attachmentsid`. **Nicht geprüft**, auch nicht, ob die Lesefunktion freigegeben ist |
| Stand | `{ post_id, parent_timemodified, uploads }`. Ändert der Autor den Beitrag, gilt der Code nicht mehr |
| Risiko | `oeffentlich`. **Immer mit Code** |
| Vorschau | „Antwort auf ‚…‘ von … im Kurs … veröffentlichen. Alle im Kurs sehen deinen Namen und den Text.“ |
| Fehler | `nicht_gefunden`, `forum_gesperrt` (Diskussion gesperrt, Antworten nicht erlaubt) |
| Ergebnis | `{ post_id }` |

Fehlt `subject`, setzt der Handler „Re: <Betreff des Beitrags>“. Nie `private` oder ähnliche Optionen schicken.

Tests: wie 4.5, dazu Betreff aus dem Elternbeitrag und `stand_geaendert` nach Änderung des Elternbeitrags.

### 4.7 `message.send` (PR 6)

| Punkt | Inhalt |
|---|---|
| Moodle | Lesen: `core_message_get_member_info` (`referenceuserid`, `userids[0]`) für Name und `canmessage`. Schreiben: `core_message_send_instant_messages` mit `messages[0][touserid]`, `[text]`, `[textformat]=2` (Klartext). **Nicht geprüft** |
| Stand | `{ to_user_id, fullname }`. Der Code gilt für genau die Person, die die Vorschau gezeigt hat |
| Risiko | `oeffentlich`. **Immer mit Code** |
| Vorschau | „Nachricht an **Vorname Nachname** senden. Die Person sieht deinen Namen.“ mit `text_preview` |
| Fehler | `empfaenger_nicht_erreichbar` (unbekannt, blockiert, `canmessage` falsch). `to_user_id` gleich eigener ID → `400` |
| Ergebnis | `{ message_id }`. Liefert Moodle `msgid = -1`, ist das `502 moodle_error` mit `errormessage` |

Tests: Erfolg, falscher Empfänger nach Vorschau (anderer `to_user_id` → `409`), `msgid = -1`, Empfänger blockiert ohne Schreibaufruf.

### 4.8 `calendar.create_event` (PR 6)

| Punkt | Inhalt |
|---|---|
| Moodle | Schreiben: `core_calendar_create_calendar_events` mit `events[0][name]`, `[timestart]` (Unix), `[timeduration]` (Sekunden), `[eventtype]=user`, `[description]`, `[format]=1`. E7. **Nicht geprüft.** Die Funktion kommt in `WRITE_WSFUNCTIONS` |
| Stand | keiner |
| Risiko | `aenderbar`. **Ohne Code** |
| Vorschau | „Termin ‚Lerngruppe‘ am 14.11. um 16:00 (90 min) im Moodle-Kalender anlegen. Nur für dich sichtbar.“ |
| Fehler | `start_at` mehr als 5 Jahre entfernt → `400`. Warnliste nicht leer → `502 moodle_error` |
| Ergebnis | `{ event_id }` |

Fallstrick: Ein doppelter Klick legt zwei Termine an. Die Web-App schickt darum immer `Idempotency-Key`. Das hilft nicht nach `502` mit `outcome_unknown`: Antworten ab `500` speichert das Plugin nicht, der Schlüssel wird wieder frei. Darum wiederholt die Web-App dann nie von selbst (§6.2).
Tests: Erfolg, Zeitstempel in Sekunden und UTC, `eventtype` ist immer `user` und lässt sich nicht überschreiben.

### 4.9 `files.upload_private` (PR 6)

| Punkt | Inhalt |
|---|---|
| Moodle | Schreiben: `upload.php`, dann `core_user_add_user_private_files` mit `draftid`. Lesen danach: `core_user_get_private_files_info`, wenn freigegeben. **Nicht geprüft** |
| Stand | `{ uploads }` |
| Risiko | Katalog: `aenderbar`. **Bis zur Prüfung in §9.1 verlangt der Handler immer einen Code** (`requiresConfirmation` liefert `true`) |
| Vorschau | „2 Dateien in ‚Meine Dateien‘ in Moodle hochladen: …“ |
| Warnung | „Gleichnamige Dateien können überschrieben werden.“ |
| Ergebnis | `{ uploaded: n }` |

**Größtes offenes Risiko dieser Aktion:** Ältere Moodle-Versionen ersetzen mit dieser Funktion den **ganzen** privaten Dateibereich durch den Entwurf. Neuere führen zusammen. Welche Variante gilt, ist **nicht geprüft**. Die Aktion bleibt `available: false`, bis der Owner den Test in §9.1 gemacht hat.

Tests: Erfolg, Upload-Fehler ohne `add_user_private_files`, Code-Pflicht.

---

## 5. Sicherheit

### 5.1 Endgültig und öffentlich nur mit Code

- `needsConfirmation(risk)` bleibt die einzige Quelle für die Pflicht. Handler dürfen nur verschärfen.
- Neuer Test über den ganzen Katalog: Für jede Aktion mit `endgueltig` oder `oeffentlich` sieht der Fake bei `execute` ohne Code **keinen** Aufruf, auch kein `upload.php`.
- Der Code beweist nur, dass vorher eine Vorschau lief. Er beweist keinen Menschen. Den Menschen sichern §5.5 und §5.6.

### 5.2 Bindung des Codes

| Gebunden an | Wie |
|---|---|
| Aktion und Parameter | wie heute (`paramsHash`) |
| Inhalt der Dateien | `sha256`, Größe, Name jedes Uploads im Stand (E5) |
| Stand in Moodle | `state` je Handler (§4), neu gelesen vor dem Einlösen |
| Eigene Änderungen | `revokeScope` samt Zähler nach jedem Schreibversuch von `assign.save_draft` (E1a) |
| Zeit, Einmaligkeit, Neustart | wie heute |

Der Stand darf keine Uhrzeit und keine Reihenfolge enthalten, die Moodle zufällig wählt. Listen werden sortiert. Sonst scheitert jede Bestätigung.

**Was der Stand nicht sieht:** Moodle liefert zu Dateien der Abgabe nach unserem Wissen keinen Inhalts-Hash, nur Name, Größe und `timemodified` (**nicht geprüft**, N4). Tauscht jemand direkt in Moodle eine Datei gegen eine gleich große mit gleichem Namen in derselben Sekunde, erkennt der Stand das nicht. Liefert Moodle `contenthash` doch, gehört er in den Stand. Fehlt ein Feld in der Antwort (z. B. `timemodified`), steht `null` im Stand. Liefert Moodle gar keinen Entwurf, ist der Stand `{ submission_id: null, … }` und nicht `null`, damit „kein Entwurf“ und „Lesen fehlgeschlagen“ getrennt bleiben. Scheitert das Lesen, gibt es `502` und keinen Code.

### 5.3 Uploads

- **Größe:** 100 MB je Datei (Vertrag). Der Parser bricht beim Überschreiten ab und löscht die Teildatei. Höchstens 20 offene Uploads und 500 MB zusammen, sonst `409 moodle_upload_limit`.
- **Typen:** PDF, PNG, JPEG, ZIP, Text. Geprüft werden Endung **und** Anfangsbytes (`%PDF` wie in `routes/material.ts`, PNG- und JPEG-Signatur, `PK`, bei Text gültiges UTF-8 ohne NUL). Passt die Endung nicht zum Inhalt: `400 moodle_upload_type_invalid`. Der `Content-Type` des Browsers zählt nicht.
- **Leere Dateien** werden abgewiesen.
- **Pfade:** Die Datei liegt unter `<dataDir>/tmp/moodle-uploads/<uuid>`. Die UUID vergibt der Core. `upload_ids` werden nur über die Liste im Speicher aufgelöst, nie zu einem Pfad zusammengesetzt. Der Dateiname geht durch `sanitizeFilename` und dient nur der Anzeige und als Name bei Moodle.
- **Dateirechte:** Verzeichnis `0700`, Dateien `0600`.
- **Multipart:** `files: 1`, keine weiteren Felder nötig, `parts` klein halten.
- **Verfall:** 24 h, beim Start alles löschen (E4), nach erfolgreicher Aktion löschen.
- **Backup:** Geprüft: `sg backup` sichert nur die Datenbank, `media/` und `vault/` (VERTRAEGE §13). `tmp/moodle-uploads/` landet also nicht im Backup. In PR 2 kommt ein Test dazu, der das festhält: Ein Upload liegt nicht unter `media/` oder `vault/`. Hinweis: Material-Uploads liegen heute unter `media/.tmp` (`uploadTmpDir`), der Vertrag nennt für Moodle `tmp/moodle-uploads/`. Es bleibt beim Vertrag.
- **Name bei Moodle:** `FormData` maskiert Anführungszeichen und Zeilenumbrüche im Dateinamen. Dazu ein Test mit `a"b\r\n.pdf`.

### 5.4 Kein Token in Logs, reservierte Felder

- `uploadDraft` nutzt denselben Logger und `scrubToken` wie `call`. Test: Nach einem Upload mit Fehler steht der Token in keiner Logzeile und in keiner Fehlermeldung.
- Das Feld heißt bei `upload.php` `token`. Es steht nie in der URL. Test: Die URL im Fake enthält kein `token=`.
- Bei `upload.php` setzt nur der Client die Felder `token`, `filearea`, `itemid`. Kein Parameter einer Aktion fließt in Feldnamen.
- Für REST gilt weiter `RESERVED_FIELDS`. Neuer Test: Kein Handler baut Parameterschlüssel aus Nutzereingaben. Alle Schlüssel sind Konstanten.
- Logs nennen Aktion, Funktion, Dauer und Fehlercode. Keine Betreffs, keine Texte, keine Dateinamen, keine Namen von Personen.
- `execute` speichert unter `Idempotency-Key` nur die Antwort. Sie enthält kein Geheimnis. Texte aus `summary` landen dabei für 24 h in Postgres. Das ist vertretbar, steht aber im PR.

### 5.5 Herkunft der Anfrage

- Nur lokal (E2). Der Origin-Schutz für schreibende Anfragen gilt weiter (VERTRAEGE §5).
- Dateien aus Moodle laufen weiter mit `Content-Security-Policy: sandbox`. Ein Skript in einem Forenanhang kann so keine Vorschau auslösen.
- Lokale Programme auf dem Mac gelten als vertrauenswürdig (VERTRAEGE §5). Das ändert dieser Plan nicht.

### 5.6 Keine KI ohne Nutzerklick

Heute gibt es keine Stelle (B3). Damit das so bleibt:
- **Regel für den Vertrag:** Vorschau und Ausführen werden nur von einem Klick-Handler der Web-App aufgerufen. Kein Job, kein Abgleich, kein Vorschlag der Inbox und kein Ergebnis eines Modells ruft sie auf.
- **Architekturtest Core:** `moodle/actions.ts` und `client.write` werden nur von `routes/moodle.ts` und `moodle/index.ts` erreicht. Job-Handler, `sync.ts` und alles unter `routes/` außer `moodle.ts` importieren sie nicht.
- **Architekturtest Core, HTTP:** Unter `services/core/src` gibt es kein `app.inject` und keinen Aufruf des eigenen Ports. Die Zeichenfolge `moodle/actions` steht nur in `routes/moodle.ts`. Ein Import-Test allein sieht das nicht. Ein Aufruf über `127.0.0.1` gilt aber als lokal und kommt ohne Token durch.
- **Architekturtest Worker:** Im Worker kommt die Zeichenfolge `/moodle/` nicht vor. Kein Aufruf eines Modells übergibt `tools`. Der Test sucht nach `tools=` bzw. dem Schlüssel `"tools"` in `services/worker`.
- **Grenze, ehrlich:** Lokale Programme auf dem Mac gelten als vertrauenswürdig (§5.5). Ein fremdes Programm am Mac kann Vorschau und Ausführen aufrufen, das kann kein Test verhindern. Die Tests sichern nur, dass **unser** Code das nie ohne Klick tut.
- **Web-App:** `executeMoodleAction` wird nur aus `MoodleActionButton` aufgerufen (Lint-Regel oder Test über Importe). Kein `useEffect` löst eine Aktion aus.
- **Später:** Schlägt eine KI einmal einen Text vor, füllt sie nur das Textfeld. Der Nutzer liest, klickt und bestätigt wie sonst. Texte aus Moodle (Forenbeiträge, Aufgabentexte) sind fremde Eingaben und dürfen nie als Anweisung an ein Modell gelten.

---

## 6. Web-Oberfläche (PR 4)

### 6.1 Wo löst der Nutzer was aus?

| Aktion | Ort | PR |
|---|---|---|
| `assign.save_draft`, `assign.submit` | Neue Seite „Abgabe“. Einstieg: Zeile einer Aufgabe in der Fristenliste der Modulseite (`MoodleDeadlines`) | 4 |
| `forum.*` | Später: Forenansicht am Modul. Gibt es heute nicht | 5 |
| `message.send`, `calendar.create_event`, `files.upload_private` | Kein Ort geplant, bis der Owner sie will (F1) | 6 |
| `completion.set`, `notifications.mark_read` | Nicht Teil dieses Plans (T1-25) | – |

### 6.2 Seite „Abgabe“ (`/abgabe?aufgabe=<assignment_id>&modul=<module_id>`)

- Kopf: Name der Aufgabe, Kurs, Frist, Link „In Moodle öffnen“.
- Stand aus `GET /moodle/assignments/{id}/submission`: „Kein Entwurf“, „Entwurf vom …“ mit Dateien, „Eingereicht am …“.
- Dateien wählen oder hineinziehen. Jede Datei geht sofort an `POST /moodle/uploads` und erscheint mit Name und Größe. „Entfernen“ ruft `DELETE`.
- Knopf **„Als Entwurf speichern“** (`assign.save_draft`). Ohne Rückfrage, Erfolg als Zeile in der Seite. Antwortet der Core mit `409 moodle_confirmation_required`, folgt die Rückfrage wie beim Einreichen.
- Knopf **„Endgültig einreichen“** (`assign.submit`), nur aktiv bei vorhandenem Entwurf. Verlangt die Aufgabe eine Erklärung, steht ihr Text mit einem Häkchen in der Rückfrage.
- Nach `outcome_unknown`: kein Wiederholen. Text „Unklar, ob Moodle es übernommen hat“, der Stand wird neu geladen.
- Ohne Moodle-Zugang oder bei `available: false`: Knöpfe aus, mit Grund.

### 6.3 `<MoodleActionButton>` (`components/moodle/MoodleActionButton.tsx`)

```ts
interface MoodleActionButtonProps {
  action: MoodleActionId;
  params: Record<string, unknown>;
  label?: string;                       // Standard: Label aus dem Katalog
  disabled?: boolean;
  onDone?(result: MoodleActionResult): void;
}
```

Ablauf:
1. Klick → `preview`. Ohne `needs_confirmation`: direkt `execute`.
2. Mit `needs_confirmation`: Rückfrage mit `summary`, `warnings`, Dateien und Textauszug. Standard ist „Abbrechen“. Die Rückfrage zeigt, wie lange der Code noch gilt, und schließt sich danach.
3. „Einreichen“ → `execute` mit Code und frischem `Idempotency-Key`.
4. `409 moodle_confirmation_invalid`: neue Vorschau holen und die Rückfrage neu zeigen. Bei `stand_geaendert` mit dem Satz „Der Entwurf hat sich geändert. Bitte prüfe ihn noch einmal.“ **Nie** automatisch ausführen.
5. Der Knopf ist während des Aufrufs gesperrt (`useSingleFlight` aus `lib/moodle.ts`).

Texte aus dem Core werden als Text gesetzt, nie als HTML.

### 6.4 R1: keine Dialoge in der Vorlesung

- Läuft eine Session (`useActiveSession`), öffnet der Knopf **keinen** Dialog. Die Rückfrage erscheint als Bereich in der Seite, direkt unter dem Knopf, mit denselben Inhalten und „Abbrechen“ als Standard.
- Kein Toast, kein Ton, keine Benachrichtigung. Erfolg und Fehler stehen als Zeile in der Seite.
- Die Web-App öffnet die Abgabe-Seite nie von selbst. Kein Hinweis auf Fristen während der Session.
- Startet eine Session, während ein Dialog offen ist, schließt er sich. Die Rückfrage steht danach in der Seite. Der Code bleibt gültig.

Tests (Vitest, Testing Library): Ablauf ohne und mit Bestätigung, `Escape` bricht ab, doppelter Klick schickt einmal, `stand_geaendert` zeigt neue Vorschau, in einer Session gibt es kein Element mit `role="dialog"`, Upload zu groß zeigt die Meldung des Core.

---

## 7. PR-Zuschnitt

Jeder PR ist für sich lauffähig. Die Schnittstellen aus §3 gelten ab PR 1.

### PR 0 · B1 und B2 (Core, Stufe A): #290

- `preview` und `execute` nur lokal, `preview` ohne `Idempotency-Key`. Vorgezogen, weil beide Befunde schon auf `main` bestehen.

### PR 1 · Rahmen und Härtung (Core, Stufe A)

- Scope: `moodle/actions.ts` (Schnittstelle), `moodle/confirmations.ts`, neu `moodle/locks.ts`, `routes/moodle.ts`, `moodle/index.ts`, `config.ts` (`SG_MOODLE_ACTIONS`), Tests `moodle-core.test.ts`, `moodle-routes.test.ts`, Architekturtests, `08-SCHNITTSTELLEN.md` §9.1 und §9.3, `docs/VERTRAEGE.md` §1.
- Inhalt: §3.1 bis §3.3, E12, §5.6 (Tests), Katalog-Test aus §5.1.
- Abhängig von #290.
- Kein neuer Handler. `completion.set` und `notifications.mark_read` laufen unverändert.
- Abnahme: Alte Tests grün. Neue Tests für `state_changed`, `revokeScope` samt Zähler, Sperre mit Zeitlimit, `SG_MOODLE_ACTIONS` (leer, eine Aktion, unbekannte Kennung).

### PR 2 · Uploads (Core, Stufe A)

- Scope: neu `moodle/uploads.ts`, `moodle/client.ts` (`uploadDraft`), `moodle/index.ts`, `routes/moodle.ts`, `test/unit/moodle-fake.ts` (multipart), neue Tests, `08` §9.3.
- Inhalt: §3.4 bis §3.6, §5.3, §5.4.
- Abhängig von PR 1.
- Abnahme: Datei hochladen, auflösen, löschen, verfallen, „in Benutzung“. Alle Grenzen aus §5.3 mit Gegenprobe, auch gleichzeitige Uploads. `uploadDraft` gegen den Fake. Noch keine Aktion nutzt Uploads. Darum antwortet `POST /moodle/uploads` mit leerem `SG_MOODLE_ACTIONS` mit `501` (E12). Der Test schaltet die Route über die Konfiguration frei. Die Upload-Routen sind lokal und ohne Idempotenz (E2, E3), Test wie in #290.

### PR 3 · `assign.save_draft` und `assign.submit` (Core, Stufe A)

- Scope: neu `moodle/actions/assign.ts`, `moodle/actions.ts` (eintragen), Tests, `08` §9.3.
- Inhalt: §4.3, §4.4, E6.
- Abhängig von PR 2. **Schließt Punkt 4 von #93.**
- Abnahme: Tests aus §4.3 und §4.4. Danach Test am echten Moodle durch den Owner (§9.1). Vorher bleibt die Aktion hinter `SG_MOODLE_ACTIONS` (E12, seit PR 1). So kann der PR gemergt werden, ohne dass die Aktion ungeprüft sichtbar ist.

### PR 4 · Web: Abgabe (Stufe A)

- Scope: `apps/web/src/components/moodle/`, `app/abgabe/page.tsx`, `lib/moodle.ts`, `MoodleDeadlines.tsx` (Link), Tests.
- Inhalt: §6.
- Abhängig von PR 1 für die Verträge. Lässt sich parallel zu PR 2 und PR 3 gegen den Fake-Core bauen. Merge nach PR 3.
- Screenshot im PR: Abgabe-Seite, Dialog, Rückfrage in der Seite während einer Session.

### Später, nach Antwort des Owners (F1)

- **PR 5 · `forum.*`:** Handler (§4.5, §4.6) und eine Forenansicht am Modul.
- **PR 6 · Rest:** `message.send`, `calendar.create_event`, `files.upload_private` (§4.7 bis §4.9). Nur was der Owner will.

---

## 8. Fallstricke für den Worker

- `consume` verbraucht den Code auch beim Fehlschlag. Darum **erst** den Stand lesen, **dann** einlösen.
- Die Sperre immer in `finally` freigeben. Ein Zeitlimit von Moodle darf sie nicht hängen lassen.
- `state` muss stabil sein. Listen sortieren, Zeitstempel als Zahl aus Moodle, nie `Date.now()`.
- Der Fake parst den Body heute als `URLSearchParams`. Für `upload.php` braucht er einen zweiten Weg (`FormData`). Die alten Tests dürfen sich nicht ändern.
- `client.read` verweigert Schreibfunktionen. Neue Schreibfunktionen in `WRITE_WSFUNCTIONS` eintragen (E7).
- Schemas `MoodleActionParams*` gibt es schon. Nicht ändern. Neue Fehlercodes in die Liste der Fehlercodes in `packages/schemas` eintragen, falls dort geführt.
- Kein Handler darf beim Import Moodle ansprechen oder Dateien anlegen.
- `prepare` prüft die Parameter vor allem anderen. Das bleibt so (F-MDL-05).
- Bei Gruppenabgaben steht der Entwurf unter `teamsubmission`. Der Mapper der Lese-Endpunkte macht das schon so. Der Stand muss dieselbe Quelle nehmen.

---

## 9. Nicht geprüft

Alles hier ist nur gegen das echte Moodle klärbar.

| Nr. | Offen | Folge, wenn es anders ist |
|---|---|---|
| N1 | Welche Schreibfunktionen der Token wirklich darf | Aktion bleibt `available: false`. Sichtbar in `GET /moodle/actions` |
| N2 | Felder und Antwort von `upload.php`, Freigabe von Uploads (`uploadfiles`), Größenlimit des Moodle | `uploadDraft` anpassen |
| N3 | `mod_assign_save_submission`: Bleiben Dateien erhalten, wenn nur Text gespeichert wird, und umgekehrt? | Handler muss den anderen Teil mitschicken oder die Warnung ändern |
| N4 | Ändert sich `timemodified` der Abgabe bei jeder Änderung an Dateien und Text, auch bei Gruppenabgaben? Liefert `mod_assign_get_submission_status` je Datei einen `contenthash`? | Der Stand trägt darum auch Dateiliste und Text-Hash. Mit `contenthash` wird die Bindung lückenlos (§5.2) |
| N5 | Namen der Einstellungen einer Aufgabe (`maxfilesubmissions`, `maxsubmissionsizebytes`, `filetypeslist`) und der Text der Erklärung | Vorprüfung entfällt, Moodle lehnt dann selbst ab (`502 moodle_error`) |
| N6 | Verhalten bei Verspätung, Fristverlängerung, neuem Versuch nach Rückgabe | Warnungen und Gründe anpassen |
| N7 | `mod_forum_can_add_discussion`, `mod_forum_get_discussion_post`: freigegeben? Gruppenforen, anonyme Foren | Vorschau ohne Namen bzw. Aktion nicht verfügbar |
| N8 | `core_message_get_member_info` freigegeben? Antwort bei blockierten Personen | Vorschau zeigt nur die ID. Dann bleibt `message.send` aus |
| N9 | `core_calendar_create_calendar_events` freigegeben (E7)? | Zurück zum Formular-Aufruf mit Zeitzonen-Umrechnung |
| N10 | `core_user_add_user_private_files`: ersetzt oder ergänzt? | Bei „ersetzt“ wird die Aktion gestrichen |
| N11 | Drosselung und Zeitlimit bei großen Uploads über das Uni-Netz | Zeitlimit anpassen |
| N12 | Safari: Dialog, Dateiauswahl, Ziehen von Dateien | Nacharbeit in PR 4 |

### 9.1 Test am echten Moodle (Owner, je Aktion einmal)

Nur in einem Kurs oder einer Aufgabe, in der ein Versuch nichts kostet. Nichts davon gehört ins Repo: keine Adressen, keine Kursnamen, keine Screenshots mit Namen.

1. `GET /moodle/actions` aufrufen und notieren, welche Aktionen `available` sind.
2. Abgabe: Datei als Entwurf speichern. In Moodle nachsehen. Dann nur Text speichern und prüfen, ob die Datei noch da ist (N3).
3. Vorschau zum Einreichen holen, den Entwurf direkt in Moodle ändern, dann bestätigen. Erwartet: Ablehnung mit „Der Entwurf hat sich geändert“.
4. Einreichen in einer Aufgabe, bei der das folgenlos ist.
5. Private Dateien: erst eine unwichtige Datei von Hand in „Meine Dateien“ legen, dann eine zweite über die App. Sind beide da (N10)?

---

## 10. Fragen an den Owner

Als Issue mit Label `entscheidung`, verlinkt in #188. Keine blockiert PR 1 und PR 2.

| Nr. | Frage | Empfehlung |
|---|---|---|
| F1 | Welche Aktionen brauchst du wirklich? | Jetzt nur **Abgaben** (`assign.*`). Foren später, wenn du in der App mitlesen willst. `message.send`, `calendar.create_event` und `files.upload_private` streichen oder zurückstellen: wenig Nutzen, eigenes Risiko |
| F2 | Welche Dateitypen gibst du ab? | Start mit PDF, PNG, JPEG, ZIP und Text. Weitere (z. B. Quellcode, Office) nur auf Wunsch |
| F3 | Darf man während einer laufenden Vorlesung abgeben? | Ja, aber ohne Dialog: Die Rückfrage steht in der Seite (E8). Sonst blockiert eine Vorlesung eine Frist |
| F4 | Soll Einreichen auch vom iPad gehen? | Nein. Nur am Mac (E2). Ist mit #290 schon so umgesetzt. Ein „Ja“ hieße: eigene Absicherung für Geräte (z. B. Bestätigung am Mac), eigenes Ticket |
| F5 | Keine Entscheidung, sondern eine Bitte: Gibt es für den ersten Test am echten Moodle (§9.1) eine Aufgabe, in der ein Versuch folgenlos ist? | Ohne solchen Test bleibt `assign.submit` ausgeschaltet |

---

## 11. Größte Risiken

1. **Falsche Abgabe.** Eingereicht wird etwas anderes als gezeigt. Antwort: Bindung an den Stand, Sperre, Widerruf, Nachlesen. Restrisiko im Millisekunden-Fenster (§4.4).
2. **Annahmen über Moodle stimmen nicht** (§9). Antwort: defensive Handler, Schalter `SG_MOODLE_ACTIONS`, Test durch den Owner vor der Freigabe.
3. **Datenverlust in Moodle** durch „ersetzt statt ergänzt“ (N3, N10). Antwort: Warnung in der Vorschau, Nachlesen, `files.upload_private` bleibt aus.
4. **Öffentlicher Beitrag aus Versehen.** Antwort: immer Code, Vorschau mit Forum, Kurs und Text, „Abbrechen“ als Standard, Foren erst nach F1.
5. **Uploads als Angriffsfläche** (Pfade, Größe, Typ). Antwort: §5.3, nur lokal, Review Stufe A.
6. **Unklarer Ausgang** bei Netzfehlern. Antwort: nie wiederholen, `outcome_unknown`, Stand neu laden.

---

## 12. Abnahme

- [ ] Ohne Vorschau lässt sich keine `endgueltig`- oder `oeffentlich`-Aktion ausführen, auch nicht per `curl` (F-MDL-06).
- [ ] Ein Code gilt nicht für geänderte Parameter, geänderte Dateien oder einen geänderten Entwurf (#93 P4).
- [ ] Jede Aktion prüft ihre Parameter, bevor sie Moodle anspricht (F-MDL-05).
- [ ] Eine Ablehnung von Moodle liefert eine verständliche Meldung mit dem Moodle-Fehlercode in `details`.
- [ ] Der Token steht in keiner URL, keinem Log und keiner Antwort.
- [ ] Aus dem Netz sind Uploads, Vorschau und Ausführen gesperrt (Vorschau und Ausführen: #290).
- [ ] Ein Bestätigungscode steht nie in Postgres, auch nicht mit `Idempotency-Key` (#290).
- [ ] Mit leerem `SG_MOODLE_ACTIONS` bietet der Core keine Aktion aus T1-24 an und nimmt keine Uploads an.
- [ ] In einer laufenden Session erscheint kein Dialog und kein Toast.
- [ ] Kein Job und kein Modell erreicht Vorschau oder Ausführen (Architekturtests).
