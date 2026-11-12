# Plan: iPad-Notizbücher, Seiten, Schreibmodi (T1-11 Rest, T1-13, #199)

Stand: 11. November 2026 · Basis: `main` (`29b3603`) **plus PR #214** (`feat/ipad-bindung-ablauf`).
Den Code schreibt Sonnet, ein frischer Opus-Subagent reviewt. Der Plan ist so geschrieben, dass keine Rückfragen nötig sind.

Quellen: `docs/spezifikation/04-FUNKTIONEN.md` (F-INK-02, -03, -14), `07-UX.md` §4, `10-UMSETZUNG.md` §5, `docs/VERTRAEGE.md` §6, §7.2, §7.4, §11, §14.2, `docs/ux/STUDIENALLTAG.md` (UX-19, UX-30, UX-31, Branch `claude/ux-studienalltag`), Issue #199.

---

## 1. Ziel und Abgrenzung

### 1.1 Ziel

1. **Notizbuch-Liste je Modul auf dem iPad (T1-11 Rest, UX-30).** Der Startbildschirm zeigt alle Module mit ihren Notizbüchern. Die Wahl ist frei. Sie geht auch ohne Verbindung, aus einem lokalen Stand.
2. **Seiten (T1-13).** Ein Notizbuch hat viele Seiten: anlegen, blättern, umsortieren, löschen. Seitenleiste mit Vorschaubildern.
3. **Vorlagen (T1-13).** Blanko, liniert, kariert, Punktraster. iPad und Web zeichnen sie gleich.
4. **Schreibmodi (F-INK-03).** „Freie Seite“ und „Auf die Folie schreiben“. Die Wahl gilt pro Modul.
5. **Folie als Hintergrund.** Das iPad lädt das Folien-PDF vom Mac und zeigt die aktuelle Folie unter der Schrift. Die Web-App zeigt dieselbe Folie in der Notizen-Spalte.
6. **#199.** iPad und Web nehmen bei Übung und Tutorium dasselbe Notizbuch. Der Core entscheidet.

### 1.2 Was heute schon da ist (nicht neu bauen)

| Baustein | Stand |
|---|---|
| Schemas `Notebook`, `Page`, `PageTemplate`, `PageCreateData`, `PageUpdateData`, `PageDeleteData`, `NotebookCreateData`, `InkMode`, `ModuleSettings` | vollständig in `packages/schemas` |
| Core: `page.create`, `page.update`, `page.delete`, `notebook.create` | vollständig in `services/core/src/sync/handlers/ink.ts` |
| Core: `GET /notebooks`, `GET /notebooks/{id}/pages`, `GET /modules`, `PATCH /modules/{id}`, `GET /slide-decks/{id}`, `GET /slide-decks/{id}/file`, `GET /sessions/{id}/snapshot` | vorhanden, aus dem Netz mit Geräte-Token erreichbar |
| iPad: Schreibfläche, Warteschlange, Uhrabgleich, Abgleich einer Seite, `presence` | T1-12, T1-14, #214 |
| Web: Notizen-Spalte folgt `presence.page_id`, lädt die Seitenliste bei `page.*` neu | T1-16 |

Folge: **keine DB-Migration, keine Änderung an `packages/schemas`.** Neu sind ein Lese-Endpunkt im Core, Vertragstext und iPad-/Web-Code.

### 1.3 Was nicht dazu gehört

| Thema | Wohin |
|---|---|
| Marker-Stempel, Tafel-Foto, Folie blättern per Wisch, Lasso-Extras | T1-15 |
| Folien **ohne** Verbindung wählen und blättern (isoliertes Uni-WLAN) | T1-15, siehe Frage 4 in §5 |
| Cornell-Vorlage | Phase 2 (F-INK-12) |
| Endlos-Scrollen über Seiten | eigenes Ticket, siehe Frage 1 in §5 |
| Notizbücher auf dem iPad umbenennen, verschieben, löschen | später, siehe Frage 3 in §5 |
| Seiten vom Mac aufs iPad holen (Neuinstallation, zweites iPad), `pkdrawing`-Upload | eigenes Ticket zu F-INK-14 („vollständiger Abzug“) |
| Start-Karte „Gleich“ auf dem iPad (UX-29) | eigenes Ticket |
| Händigkeit und Stift-Einstellungen aus `Settings` | T1-19 |

---

## 2. Verträge

### 2.1 Entscheidungen (kurz begründet)

| # | Entscheidung | Grund |
|---|---|---|
| E1 | **#199: neuer Endpunkt `GET /sessions/{id}/notebook`.** Kein neues Feld an `Session`. | `Session` steckt in `session.updated`, `SessionList`, `SessionSnapshot` und in vielen Beispielen. Ein Pflichtfeld bräche alte Clients und alle Testdaten. Der Endpunkt ist rein additiv und liefert den vorhandenen Typ `Notebook`. |
| E2 | Die Web-App nutzt denselben Endpunkt. `pickSessionNotebook` entfällt. | Eine Quelle für die Regel. Die Web-App spart den Abruf des Termins. |
| E3 | Die Notizen-Spalte folgt `presence.notebook_id` des iPads, wenn das Notizbuch zum Modul der Session gehört. | Mit freier Wahl (UX-30) schreibt das iPad auch in freie Notizbücher. Ohne diese Regel bliebe die Spalte leer. `presence` trägt das Feld schon. |
| E4 | Seiten bleiben reine Sync-Operationen (`page.create`, `page.update`, `page.delete`). Keine neuen Operationen. | Der Core kann alles. Es geht offline. |
| E5 | Umsortieren: dicht neu nummerieren, ein `page.update` je geänderter Seite. | `index` ist eine Ganzzahl und nicht eindeutig (§7.4). Notizbücher haben zehn bis wenige hundert Seiten. Lücken-Schemata wären fehleranfälliger. |
| E6 | Schreibmodus: `module.settings.ink_mode` per `PATCH /modules/{id}`, offline lokal gemerkt. | Steht so in §14.2. Ein eigener Sync-Strom wäre für ein Feld zu viel. |
| E7 | Folie als Hintergrund aus dem **PDF** (`GET /slide-decks/{id}/file`), nicht aus den PNG-Bildern. | Eine Datei je Foliensatz, danach offline vollständig. Scharf in jeder Zoomstufe. Details in §4.5. |
| E8 | Das iPad abonniert `session:<id>` nur lesend und hält keinen `seq`-Stand über Verbindungen hinweg. Nach jedem `welcome` lädt es den Snapshot neu. | Es braucht nur die aktuelle Folie. Der Snapshot ist die volle Wahrheit. Das spart die Resume-Logik. |
| E9 | Kariert und Punktraster haben 5 mm Raster. Die Web-App wird angepasst (heute 20 pt). | F-INK-02 nennt 5 mm. Beide Seiten müssen gleich zeichnen, sonst sitzt die Schrift am Mac neben den Linien. |
| E10 | Folienseiten: höchstens eine je Folie und Notizbuch, das iPad prüft das. Kein Unique-Index im Core. | Zwei Geräte offline dürfen nicht an einem Index scheitern. |

### 2.2 Migration

- **Datenbank:** keine.
- **`packages/schemas`:** keine Änderung. `pnpm schemas:check` bleibt grün, der Job Swift-Contract ist nicht betroffen.
- **iPad, lokal:** `Sync/bindings.json` (eine Seite je Notizbuch, „E1“ aus T1-14) wird einmalig in die neue Bibliothek übernommen (§3, PR 2). Die Zeichnungen in `Ink/<page_id>/page.plist` bleiben, wo sie sind.

### 2.3 Textvorschläge für `docs/VERTRAEGE.md`

Alle Texte kommen mit **PR 1** nach `main`. Danach ändern die anderen PRs die Verträge nicht mehr.

**V1 · §7.2, neue Zeile in der Tabelle nach `GET /sessions/{id}/snapshot`:**

```markdown
| `GET /sessions/{id}/notebook` | – | 200 `Notebook` | 404 `session_not_found`, 404 `notebook_not_found` (Rückfall: Modul gelöscht, Session nicht. Über `DELETE /modules` kommt das nicht vor, die Kaskade §13 löscht die Sessions mit) |
```

**V2 · §7.2, neuer Punkt unter der Tabelle:**

```markdown
- **Notizbuch der Session (#199).** Der Core ist die einzige Quelle für diese Regel, iPad und Web leiten sie nicht selbst ab. Hat die Session einen Termin mit `kind` `uebung` oder `tutorium`, ist es das Notizbuch `uebung` des Moduls. In allen anderen Fällen ist es `vorlesung`, auch ohne Termin. Ein weich gelöschter Termin zählt mit seiner Art, damit das Notizbuch nicht nachträglich wechselt. Fehlen die Standard-Notizbücher, legt der Core sie vorher an (wie `GET /notebooks?module_id`, §7.4). Die Antwort hängt nicht vom Zustand der Session ab. Gelöschte Sessions ergeben 404 `session_not_found`.
```

**V3 · §7.4, neue Punkte am Ende der Liste (nach „Der Core legt für jedes Modul …“):**

```markdown
- **Seiten vom iPad (T1-13).**
  - Neue Seiten hängt das iPad hinten an: `index` = höchster bekannter `index` des Notizbuchs + 1 (lokal und laut `GET /notebooks/{id}/pages`).
  - Umsortieren: Das iPad nummeriert die Seiten dicht neu (1 … n) und sendet je Seite, deren `index` sich ändert, ein `page.update`. Nach `page.delete` bleiben Lücken stehen.
  - Vorlage wechseln: `page.update` mit neuem `template`. Zwischen `folie` und den anderen Vorlagen wird nicht gewechselt.
  - `page.session_id` setzt das iPad nur beim Anlegen: die laufende oder pausierte Session, wenn ihr Modul das Modul des Notizbuchs ist, sonst `null`.
- **Seitenformate (F-INK-02, F-INK-03).**
  - Freie Seite: 595 × 842 pt, `template` ≠ `folie`, `background_slide_id = null`. `attached_slide_id` ist die Folie, die beim Anlegen lief, sonst `null`.
  - Folienseite: `width_pt`/`height_pt` der Folie (`Slide.width_pt`, `Slide.height_pt`), `template = folie`, `background_slide_id` = Folie, `attached_slide_id = null`.
  - Je Notizbuch und Folie gibt es höchstens eine Folienseite. Das iPad sucht vor dem Anlegen eine nicht gelöschte Seite mit diesem `background_slide_id` und öffnet sie. Der Core erzwingt das nicht. Gibt es doch mehrere, gilt die mit dem kleinsten `index`.
- **Vorlagen-Geometrie.** iPad und Web zeichnen gleich. Ursprung oben links, Einheit pt, `w`/`h` = Seitengröße, Linienstärke 0,7 pt, Papier `#FAF9F5`, Linien `#E3E5E8`, Rand der Cornell-Vorlage `#E8B4B4`. Raster `r` = 5 mm = 14,173 pt.

  | `template` | Zeichnung |
  |---|---|
  | `blanko`, `folie` | nur Papier. Bei `folie` liegt die Folie darüber (`GET /slides/{id}/image` bzw. das PDF) |
  | `liniert` | waagerechte Linien bei y = 60, 90, 120 … solange y < h − 20, von x = 40 bis w − 40 |
  | `kariert` | waagerechte Linien bei y = r, 2r … < h und senkrechte bei x = r, 2r … < w, über die ganze Seite |
  | `punktraster` | Punkte (1,2 pt) auf allen Kreuzungen des Rasters `r` |
  | `cornell` | wie bisher in der Web-App (`render.ts`). Das iPad bietet sie in Phase 1 nicht an |
```

**V4 · §11.6, neue Punkte nach dem ersten Punkt („Das iPad sendet `presence` …“):**

```markdown
- **`presence.session_id` des iPads** ist die laufende oder pausierte Session, wenn ihr Modul das Modul des offenen Notizbuchs ist, sonst `null`.
- **Notizbuch der Notizen-Spalte.** Standard ist `GET /sessions/{id}/notebook` (§7.2). Meldet ein iPad per `presence` ein `notebook_id`, das zum Modul der Session gehört (`Notebook.module_id` = `Session.module_id`), zeigt die Spalte dieses Notizbuch. Meldet das iPad `notebook_id = null` oder ein Notizbuch eines anderen Moduls, gilt wieder der Standard. Trennt sich das iPad, bleibt die Spalte beim zuletzt gezeigten Notizbuch. So erscheinen auch Striche aus einem frei gewählten Notizbuch (UX-30).
```

**V5 · §11.7, neuer Punkt 7 nach „UUIDs klein“:**

```markdown
7. **Folien verfolgen:** Das iPad abonniert `session:<id>` der laufenden Session nur lesend. In `hello.streams` meldet es nichts. Nach jedem `welcome` lädt es `GET /sessions/{id}/snapshot` und abonniert mit `stream_seq` und `stream_op_id` daraus. Die aktuelle Folie ist das letzte `slide_event` des Snapshots, danach jedes `slide.change` mit der nächsten `seq`. Bei `reset` oder einer Lücke lädt es den Snapshot neu und abonniert erneut. Einen `seq`-Stand über Verbindungen hinweg speichert es nicht.
```

**V6 · §14.2, neuer Satz am Ende des dritten Punktes:**

```markdown
Ohne Verbindung merkt sich das iPad die Wahl lokal und sendet sie bei der nächsten Verbindung. Der letzte Stand gewinnt.
```

**V7 · §16.3, neue Zeile unter „T1-11 bis T1-15“:**

```markdown
| T1-11 Rest, T1-13, #199 | Notizbücher, Seiten, Schreibmodi | Zuschnitt und Schnittstellen in `docs/plaene/T1-11-13-NOTIZBUECHER.md` | #214 |
```

### 2.4 Sync-Operationen für Seiten (alle vorhanden, §11.3)

| Aktion am iPad | Operation(en) | Inhalt | Lokal |
|---|---|---|---|
| Notizbuch anlegen | `notebook.create` im Strom `notebook:<neu>` | `kind = frei`, `created_at` | vor allen `page.create` dieses Notizbuchs einreihen |
| Seite anlegen | `page.create` | Felder nach V3, `index` = max + 1 | `version = 1` |
| Umsortieren | je geänderter Seite ein `page.update` | `fields` vollständig, nur `index` neu, `version` = lokale Version | lokale Version je Operation + 1 |
| Vorlage setzen | ein `page.update` | `fields` vollständig, nur `template` neu | lokale Version + 1 |
| Seite löschen | ein `page.delete` | `page_id` | Dateien bleiben 30 Tage auf dem iPad |

Regeln dazu:

- **Reihenfolge in der Warteschlange:** `notebook.create` → `page.create` → `stroke.*` / `page.update` → `page.delete`. Das ergibt sich aus der Entstehungsreihenfolge. Nichts umsortieren.
- **`page_version_conflict`** (§11.2): nicht in die Fehlerablage. Ablauf in PR 3.
- **Abhängigkeiten in der Fehlerablage:** Wird `notebook.create` abgelehnt, wandern alle wartenden Operationen desselben Stroms mit. Bei `page.create` wie heute alle mit dieser `page_id`.
- **`db_epoch` neu:** jede lokale Seite braucht einen Abgleich (heute schon so). Er sendet bei Bedarf `page.create` erneut (idempotent) und danach die Striche.

---

## 3. PR-Zuschnitt

Fünf PRs. Reihenfolge und Parallelität:

```
PR 1 (Vertrag, Core, Web, iPad klein)  ──┬──▶ PR 2 (iPad Bibliothek) ──▶ PR 3 (iPad Seiten) ──▶ PR 4 (iPad Schreibmodi, Folie)
                                         └──▶ PR 5 (Web: Folie, Raster)     parallel zu PR 2 bis PR 4
```

- PR 1 zuerst, nach dem Merge von #214.
- PR 2, 3, 4 **nacheinander**. Alle drei fassen `SyncEngine.swift` und `InkPageView.swift` an.
- PR 5 läuft parallel zu PR 2 bis 4. Der Scope ist disjunkt (`apps/web/**`).
- #211 (`fix/web-sync-spaetes-abo`) ändert `InkColumn.tsx` und `lib/sync/client.ts`. PR 1 und PR 5 starten erst nach dessen Merge. PR 1 braucht dessen `SyncClient.devicePresence` (letzte `presence` des iPads), ein Rebase auf den offenen Branch reicht nicht.

Für alle PRs gilt: Branch `feat/<kurz>`, PR-Beschreibung nach `AGENTS.md`, Checkliste aus `10-UMSETZUNG.md` §6, keine neuen Abhängigkeiten.

---

### PR 1 · Notizbuch der Session vom Core (#199) und Vertragstext

**Branch:** `feat/session-notizbuch` · **Größe:** S · **Closes #199**

**Scope**
- `docs/VERTRAEGE.md` (V1 bis V7, wörtlich)
- `services/core/src/services/notebooks.ts`, `services/core/src/routes/sessions.ts`
- `services/core/test/integration/ink-rest.test.ts` (oder `sessions.test.ts`)
- `apps/web/src/lib/ink.ts`, `apps/web/src/components/dashboard/NotesColumn.tsx`, `apps/web/src/lib/session-notebook.ts` (löschen), zugehörige Tests in `apps/web/test/`. `InkColumn.tsx` bleibt unverändert (siehe unten).
- `apps/ipad/Sources/Core/CoreClient.swift`, `apps/ipad/Sources/Sync/SyncEngine.swift` (nur `lookupLecture`), `apps/ipad/Tests/CoreClientSyncTests.swift`, `apps/ipad/Tests/SyncEngineTests.swift`

**Schnittstellen**

Core:
```ts
// services/notebooks.ts
export async function sessionNotebook(db: Db, sessionId: string): Promise<Notebook>;
```
1. Session lesen (nicht gelöscht), sonst 404 `session_not_found`.
2. In einer Transaktion `ensureDefaultNotebooks(tx, moduleId)`.
3. Art bestimmen: `calendar_event.kind` über `session.calendar_event_id`, **ohne** Filter auf `deleted_at`. `uebung` oder `tutorium` → `uebung`, sonst `vorlesung`.
4. Notizbuch mit `module_id`, `kind`, `deleted_at IS NULL` und `moduleIsActive` lesen, sonst 404 `notebook_not_found`.

Route `GET /sessions/:id/notebook` in `routes/sessions.ts`, Antwort `NotebookSchema`, ohne `sgAccess` (aus dem Netz mit Token erlaubt).

Web:
```ts
// lib/ink.ts
export function fetchSessionNotebook(sessionId: string, signal?: AbortSignal): Promise<Notebook>;
// NotesColumn: Props
{ session: Pick<Session, 'id' | 'module_id'>; client: SyncClient | null }
```
- `NotesColumn` lädt `fetchSessionNotebook` (Query-Schlüssel `['sessions', id, 'notebook']`) und weiter `fetchNotebooks(moduleId)`. Der Abruf des Termins entfällt.
- `NotesColumn` hört selbst auf `presence` (`client.onEvent`). Startwert beim Einhängen: `client.devicePresence('ipad')` (kommt mit #211). Zustand `ipad: { notebookId } | null`. Regel V4: `notebookId` aus `presence`, wenn das Notizbuch zum Modul der Session gehört, sonst das Standard-Notizbuch.
- Modul prüfen: Steht `notebookId` in der geladenen Liste, entscheidet deren `module_id`. Fehlt es dort (frisch auf dem iPad angelegt oder jenseits der ersten 50), fragt `NotesColumn` einmal `GET /notebooks/{id}` (neuer Helfer `fetchNotebook` in `lib/ink.ts`, Query-Schlüssel `['notebooks', 'one', id]`). 404 oder anderes Modul → Standard.
- `InkColumn` bekommt `key={notebook.id}`. So startet sie beim Wechsel frisch (`following = true`, keine alte Seitenliste) und liest die aktuelle iPad-Seite selbst über `devicePresence` (#211). Eine neue Prop ist dafür nicht nötig.
- Alle Aufrufer von `NotesColumn` übergeben `session.id`.

iPad:
```swift
// CoreClient
/// `GET /sessions/{id}/notebook`. `nil` bei 404 (älterer Core oder Modul gelöscht).
func sessionNotebook(endpoint: CoreEndpoint, token: String, sessionID: String) async throws -> Notebook?
```
- `SyncEngine.lookupLecture` fragt zuerst `sessionNotebook`. Bei `nil` gilt die alte Regel (erstes „Vorlesung“ aus `GET /notebooks?module_id`). So läuft ein neues iPad auch gegen einen alten Core.

**Testfälle**
- Core (Integration): Session ohne Termin → `vorlesung`. Termin `uebung` → `uebung`. Termin `tutorium` → `uebung`. Termin `pruefung` → `vorlesung`. Termin weich gelöscht, Art `uebung` → `uebung`. Modul ohne Standard-Notizbücher (direkt in der DB angelegt) → werden angelegt, 200. Session gelöscht → 404 `session_not_found`. Modul per `DELETE /modules/{id}` gelöscht → 404 `session_not_found` (Kaskade). Nur `module.deleted_at` direkt in der DB gesetzt → 404 `notebook_not_found`. Ungültige ID → 400. Aus dem Netz ohne Token → 401, mit Geräte-Token → 200.
- Web: Übung zeigt „Übung“. `presence` mit freiem Notizbuch desselben Moduls → Spalte wechselt und zeigt die gemeldete Seite. `presence` vor dem Einhängen (nur über `devicePresence`) → Spalte zeigt gleich das gemeldete Notizbuch. Notizbuch nicht in der Liste, `GET /notebooks/{id}` liefert dasselbe Modul → Wechsel. `presence` mit Notizbuch eines anderen Moduls → kein Wechsel. `presence` mit `notebook_id = null` → zurück zum Standard. Fehler des Endpunkts → Hinweis mit „Erneut versuchen“.
- iPad: `lookupLecture` nimmt das Notizbuch des Endpunkts (Fake liefert „Übung“). 404 → alte Regel. Pfad und Methode in `CoreClientSyncTests`.

**Akzeptanzkriterien**
- [ ] In einer Übung erscheinen die Striche des iPads in der Notizen-Spalte.
- [ ] `pickSessionNotebook` und sein Test sind entfernt. Nichts im Web leitet die Regel noch selbst ab.
- [ ] V1 bis V7 stehen wörtlich in `docs/VERTRAEGE.md`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, Integrationstests und der CI-Job `ipad` sind grün.

---

### PR 2 · iPad: Notizbuch-Bibliothek und freie Wahl (T1-11 Rest, UX-30)

**Branch:** `feat/ipad-notizbuch-liste` · **Größe:** L · **Abhängig von:** PR 1

**Scope**
- neu: `apps/ipad/Sources/Library/**`
- `apps/ipad/Sources/Home/HomeView.swift`, `Ink/InkPageView.swift`, `Ink/InkPageTitle.swift`, `App/AppModel.swift`, `App/StudienGehirnApp.swift`
- `apps/ipad/Sources/Sync/SyncEngine.swift`, `InkOpBuilder.swift`, `InkBindingStore.swift`, `SyncOutbox.swift`
- `apps/ipad/Sources/Core/CoreClient.swift`
- `apps/ipad/Tests/**`, `docs/anleitungen/IPAD.md`

**Schnittstellen**

Lokale Typen (`Library/InkLibrary.swift`). Die Namen kollidieren nicht mit `Schemas.swift`:
```swift
struct LibraryModule: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var shortName: String?
    /// Wahl des Schreibmodus, `nil` = globaler Standard (PR 4 nutzt das)
    var inkMode: InkMode?
    /// Lokal geändert, noch nicht per PATCH gesendet
    var inkModeDirty: Bool
}

struct LibraryNotebook: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var moduleID: String
    var title: String
    var kind: NotebookKind
    var createdAtMS: Int
    /// Der Core kennt das Notizbuch (aus GET /notebooks). `false` bei lokal angelegten, bis zum ersten Abgleich
    var knownOnServer: Bool
    /// Am Mac gelöscht: nicht mehr anzeigen, Dateien bleiben
    var hidden: Bool
    var lastPageID: String?
    /// Höchster `index` laut GET /notebooks/{id}/pages, auch von Seiten, die das iPad nicht hat
    var remoteMaxIndex: Int
    /// Seiten am Mac, die dieses iPad nicht hat (nur Anzeige)
    var remoteOnlyPageCount: Int
}

struct LibraryPage: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var notebookID: String
    var index: Int
    var template: PageTemplate
    var widthPt: Double
    var heightPt: Double
    var sessionID: String?
    var backgroundSlideID: String?
    var attachedSlideID: String?
    /// Version, auf der die nächste `page.update` beruht
    var version: Int
    /// `page.create` ist eingereiht oder gesendet
    var createQueued: Bool
    var needsReconcile: Bool
    /// Lokal gelöscht (PR 3). Dateien bleiben bis `deletedAtMS` + 30 Tage
    var deletedAtMS: Int?
    /// `page.delete` ist eingereiht (PR 3). `false` in der Löschfrist von 5 s
    var deleteQueued: Bool
}

/// Laufende oder pausierte Session, wie der Dienst sie kennt
struct RunningSession: Equatable, Sendable {
    var id: String
    var moduleID: String
    var startMS: Int?
    var slideDeckID: String?
    /// Aus `GET /sessions/{id}/notebook`, `nil` wenn der Abruf scheitert
    var notebookID: String?
}
```

Ablage (`Library/InkLibraryStore.swift`), Datei `Application Support/Sync/library.json`, atomar geschrieben, mit `schemaVersion = 1`:
```swift
@MainActor
protocol InkLibraryStore: AnyObject {
    var modules: [LibraryModule] { get }
    var lastNotebookID: String? { get }
    var dbEpoch: String? { get }
    var refreshedAt: Date? { get }

    func notebooks(inModule moduleID: String) -> [LibraryNotebook]      // ohne `hidden`, nach createdAtMS, dann id
    func notebook(_ id: String) -> LibraryNotebook?
    func pages(inNotebook notebookID: String) -> [LibraryPage]          // ohne gelöschte, nach index, dann id
    func page(_ id: String) -> LibraryPage?

    func mergeModules(_ server: [ModuleBrief], at: Date)
    func mergeNotebooks(_ server: [Notebook], moduleID: String)
    func mergePages(_ server: [Page], notebookID: String, pendingUpdatePageIDs: Set<String>, pendingDeletePageIDs: Set<String>)

    func upsert(_ notebook: LibraryNotebook)
    func upsert(_ page: LibraryPage)
    func setLast(notebookID: String, pageID: String?)
    func removeNotebook(_ id: String)        // `notebook.create` endgültig abgelehnt
    func removePage(_ id: String)            // `page.create` endgültig abgelehnt

    func setDBEpoch(_ epoch: String)
    func markAllNeedReconcile()
    func clearNeedsReconcile(pageID: String)
    func setModuleInkMode(_ mode: InkMode?, moduleID: String, dirty: Bool)
}
```

Regeln für das Zusammenführen (genau so umsetzen und testen):
- **Module:** Die Liste des Core ersetzt die lokale. Ausnahme: `inkMode` bleibt lokal, solange `inkModeDirty`. Ein Modul, das am Core fehlt, bleibt nur stehen, solange es ein Notizbuch mit `knownOnServer == false` hat.
- **Notizbücher eines Moduls:** Jedes Notizbuch des Core wird übernommen (`title`, `kind`, `moduleID`, `knownOnServer = true`, `hidden = false`). Ein lokales Notizbuch, das am Core fehlt: mit `knownOnServer == false` bleibt es (wartet noch), sonst `hidden = true`.
- **Seiten eines Notizbuchs:**
  - Seite lokal und am Core: `index`, `template`, `version`, `sessionID`, Folien-IDs vom Core übernehmen, **außer** die Seite steht in `pendingUpdatePageIDs`. War sie lokal gelöscht und steht nicht in `pendingDeletePageIDs`: `deletedAtMS = nil` (am Mac wiederhergestellt).
  - Seite nur am Core: **nicht** als `LibraryPage` anlegen. Nur `remoteMaxIndex` und `remoteOnlyPageCount` des Notizbuchs setzen.
  - Seite nur lokal: unverändert lassen.
  - **Die beiden Mengen ermittelt der Dienst vor dem Abruf und vereinigt sie mit dem Stand danach.** Sonst setzt ein `ack`, das während des Abrufs eintrifft, eine veraltete Antwort durch: Eine gerade gelöschte Seite käme zurück, ein gerade bestätigtes Umsortieren würde zurückgedreht. Seiten in der Löschfrist (`deletedAtMS != nil`, `deleteQueued == false`, PR 3) zählen zu `pendingDeletePageIDs`.

Migration (`Library/InkLibraryMigration.swift`): Gibt es `bindings.json` und keine `library.json`, wird je `InkBinding` ein `LibraryNotebook` (`title = "Vorlesung"`, `kind = .vorlesung`, `knownOnServer = true`) und eine `LibraryPage` (A4, `blanko`, `index = 1`, `version = 1`, `createQueued = pageCreated`, `needsReconcile`) angelegt. `moduleName` wird zu einem `LibraryModule` (fehlt er, wie bei Bindungen vor #214: Name „Modul“ bis zum ersten Abruf). `lastNotebookID` und `dbEpoch` wandern mit. Danach wird `bindings.json` in `bindings.migriert.json` umbenannt. Der nächste Abgleich mit dem Core korrigiert Titel, Art, `index` und `version`.

Dienst (`Library/InkLibraryService.swift`), `@MainActor @Observable`:
```swift
final class InkLibraryService {
    init(store: any InkLibraryStore, sync: SyncEngine, client: CoreClient)

    var modules: [LibraryModule] { get }
    var refreshedAt: Date? { get }
    /// Laufende oder pausierte Session laut letztem Abruf, `nil` ohne Verbindung oder ohne Session
    private(set) var running: RunningSession?

    func notebooks(inModule moduleID: String) -> [LibraryNotebook]
    /// Module, Notizbücher und laufende Session vom Core holen. Ohne Verbindung passiert nichts.
    func refresh() async
    /// Seiten eines Notizbuchs mit dem Core zusammenführen (beim Öffnen, wenn erreichbar)
    func refreshPages(notebookID: String) async
    /// Freies Notizbuch anlegen: lokal speichern, `notebook.create` einreihen. `nil`, wenn das Schreiben scheitert.
    func createNotebook(moduleID: String, title: String) -> LibraryNotebook?
    /// Schreibziel für ein Notizbuch: letzte Seite, sonst die mit dem höchsten `index`, sonst eine neue.
    func openTarget(notebookID: String) -> InkBinding?
    /// Aktuelles Schreibziel der Seite mit frischer Session-Zuordnung
    func target(forPage pageID: String) -> InkBinding?
}
```
- `InkBinding` bleibt der Werttyp für das Schreibziel (Felder wie nach #214). Er wird nicht mehr gespeichert, sondern aus der Bibliothek gebaut. `sessionID` und `sessionStartMS` sind nur gesetzt, wenn `running.moduleID == notebook.moduleID`.
- `SyncEngine` bekommt statt `bindings: any InkBindingStore` die Ablage `library: any InkLibraryStore`. `resolveBinding`, `runningLectureNotebookID` und `lookupLecture` ziehen in den Dienst um. `FileInkBindingStore` bleibt nur als Leser für die Migration.
- `SyncEngine` neu:
  ```swift
  /// Reiht fertige Operationen ein (Notizbuch, Seite). `false`, wenn das Schreiben scheitert.
  @discardableResult func enqueue(drafts: [OutboxDraft]) -> Bool
  /// Zugang für REST-Abrufe des Dienstes. `nil` ohne Kopplung.
  func restAccess() -> (endpoint: CoreEndpoint, token: String)?
  func reportRESTError(_ error: Error)      // 401 → tokenInvalid, wie heute
  var clockOffsetForDrafts: Int? { get }
  ```
- `InkOpBuilder` neu: `notebookCreate(notebook:nowMS:offsetMS:makeID:)`, `pageCreate(page:nowMS:offsetMS:makeID:)` (ersetzt die A4-Variante, alle Felder aus der `LibraryPage`). `correct(_:offsetMS:)` behandelt **alle** Arten, die das iPad sendet: `notebook.create` (`at` und `data.created_at` + Versatz), `page.create`, `page.update`, `page.delete` (`at` + Versatz). Heute liefert `default` dort `nil`, und die Operation landet als `local_op_invalid` in der Fehlerablage. **Ebenso `opID(of:)`:** Es kennt heute nur dieselben drei Arten, `makeDraft` liefert für jede andere `nil`, und die neue Operation entstünde gar nicht. `notebook.create` hat `pageID = nil` im `OutboxDraft`.
- `SyncEngine.reconcile`: Fehlt die Seite am Core (404), sendet es `page.create` mit den Feldern der `LibraryPage` (`index`, `template`, Format, Folien-IDs), nicht mehr A4/`blanko` mit `pages.count + 1`. Sonst käme eine Folienseite nach einer Wiederherstellung als leere A4-Seite zurück.
- `SyncOutbox`: `mark(forPage:)` zählt nur `stroke.add` und `stroke.remove` (heute ist nur `page.create` ausgenommen). Sonst löst jede Seiten-Operation einen unnötigen Abgleich aus.
- `SyncEngine.deadLetter`: bei `notebook.create` alle wartenden Operationen mit demselben `stream` mitnehmen und `library.removeNotebook` aufrufen. Bei `page.create` wie heute, mit `library.removePage`. Beide entfernen nur den Eintrag der Bibliothek. Die Dateien unter `Ink/<page_id>/` bleiben (wie heute bei `removeBinding`).
- `CoreClient` neu: `modules(endpoint:token:)` (`GET /modules?limit=200`, `next_cursor` folgen). Dekodiert wird in einen schlanken eigenen Typ `ModuleBrief` (`id`, `name`, `short_name`, `settings.ink_mode` als `String?`, über `InkMode(rawValue:)`), nicht in das generierte `Module`/`ModuleList`. Grund: Der Swift-Contract prüft `ModuleList` nicht, und ein neuer Enum-Wert in `color` oder `settings.layout` ließe sonst den ganzen Abruf scheitern (Muster wie `ModuleNameResponse`). `mergeModules` nimmt `[ModuleBrief]`.
- `CoreClient.notebooks(…)` fragt mit `limit=200` und folgt `next_cursor`. Die Regel „fehlt am Core → `hidden`“ braucht die vollständige Liste.
- „+ Notizbuch“: Titel getrimmt, leer → Knopf aus. Ein leerer Titel ergäbe `message_invalid` und die Fehlerablage.
- `presence`: nach V4.

Oberfläche:
- **Startbildschirm** (07 §4.2): Die Karten „Notizbücher“ und „Schreibfläche“ weichen einer Liste. Je Modul eine Karte mit Namen und den Notizbüchern als Knöpfe (≥ 44 pt), dazu „+ Notizbuch“. Module alphabetisch.
- Läuft eine Vorlesung, steht oben eine Karte „Läuft gerade: <Modul>“. Sie öffnet das Notizbuch aus `running.notebookID`.
- Ohne Verbindung: eine ruhige Zeile „Offline · Stand von <Zeit>“. Leere Bibliothek ohne Verbindung: „Noch keine Notizbücher geladen. Verbinde das iPad einmal mit dem Mac.“
- „+ Notizbuch“: kleiner Dialog mit Titel. Geht offline (`notebook.create`). Der Startbildschirm liegt außerhalb der Schreibansicht, R1 ist nicht berührt.
- **Schreibfläche:** `InkPageView(library:notebookID:)`. Titel „<Modul> · <Notizbuch>“. Die Offline-Zeile und der Knopf „Zur laufenden Vorlesung“ aus #214 bleiben. Der Knopf vergleicht mit `running.notebookID`.
- `onStrokeChanges` liest das Schreibziel bei jedem Aufruf neu (`library.target(forPage:)`). Sonst fehlt die Session, wenn die Vorlesung erst nach dem Öffnen startet.
- `refresh()` läuft bei jedem neuen `welcomeCount` und beim Erscheinen des Startbildschirms, höchstens alle 30 s.

**Testfälle** (alle als Unit-Tests mit Fakes, kein Netz)
- Zusammenführen: jede Regel oben einzeln. Dazu: lokal angelegtes Notizbuch übersteht einen Abruf, in dem es noch fehlt. `inkModeDirty` schützt die lokale Wahl. `page.update` bzw. `page.delete` wird während des Abrufs bestätigt (Fake-Engine), die Antwort zeigt noch den alten Stand → lokaler `index` bleibt, gelöschte Seite bleibt gelöscht. Modul mit unbekanntem `color`-Wert im JSON → Abruf gelingt.
- Migration: zwei Bindungen → zwei Notizbücher mit je einer Seite, `lastNotebookID` und `dbEpoch` erhalten, zweiter Start migriert nicht erneut, kaputte `bindings.json` → leere Bibliothek ohne Absturz.
- `openTarget`: ohne Seite wird eine angelegt und `page.create` eingereiht, `index = max(lokal, remoteMaxIndex) + 1`. Mit `lastPageID` wird diese genommen. Kein zweites `page.create` beim zweiten Öffnen.
- Offline: Bibliothek aus der Datei, Notizbuch wählen, schreiben → Operationen liegen in der Warteschlange, `session_id = null`, `t_start_ms = null`.
- Session-Zuordnung: Session im selben Modul → `sessionID` gesetzt. Session in anderem Modul → `nil`, `presence.session_id = null`.
- `notebook.create`: Operation dekodiert als `SGSyncOp.notebookCreate`, Strom `notebook:<id>`, steht vor `page.create`. Uhrkorrektur ändert `at` und `created_at`. Ablehnung (`module_not_found`) nimmt alle Operationen des Stroms mit.
- `correct` für `page.update` und `page.delete` liefert nie `nil`. Jeder neue Builder liefert einen `OutboxDraft` (nicht `nil`).
- Abgleich einer Folienseite, die der Core nicht kennt → `page.create` mit `template = folie`, Format und `index` der `LibraryPage`.
- `mark(forPage:)` ändert sich durch `page.create` nicht.
- Alle vorhandenen Tests aus T1-14 und #214 laufen weiter (auf die neue Ablage umgestellt).

**Akzeptanzkriterien**
- [ ] Ohne Verbindung lässt sich jedes bekannte Notizbuch jedes Moduls öffnen und beschreiben (UX-30). Titel und Offline-Zeile nennen Modul und Notizbuch.
- [ ] Nach dem Verbinden kommen alle Striche im gewählten Notizbuch am Mac an.
- [ ] Ein Update von einer App mit `bindings.json` verliert keine Seite und keine wartende Operation.
- [ ] Ein offline angelegtes freies Notizbuch erscheint nach dem Verbinden am Mac.
- [ ] Der CI-Job `ipad` ist grün.

---

### PR 3 · iPad: Seiten und Vorlagen (T1-13, Teil 1)

**Branch:** `feat/ipad-seiten-vorlagen` · **Größe:** L · **Abhängig von:** PR 2

**Scope**
- `apps/ipad/Sources/Ink/**` (neu u. a. `InkNotebookView.swift`, `InkPageSidebar.swift`, `InkPaperView.swift`, `InkTemplateGeometry.swift`, `InkThumbnails.swift`)
- `apps/ipad/Sources/Library/**`, `Sync/InkOpBuilder.swift`, `Sync/SyncEngine.swift` (nur Konfliktbehandlung), `Sync/SyncOutbox.swift` (`discard`)
- `apps/ipad/Tests/**`, `docs/anleitungen/IPAD.md`

**Schnittstellen**

```swift
// InkLibraryService, neu
func pages(inNotebook notebookID: String) -> [LibraryPage]
/// Hängt eine Seite an. Vorlage und Format wie übergeben. Reiht `page.create` ein.
func addPage(notebookID: String, template: PageTemplate, size: CGSize,
             backgroundSlideID: String?, attachedSlideID: String?) -> LibraryPage?
/// Setzt die Vorlage (nicht von oder nach `.folie`). Reiht ein `page.update` ein.
func setTemplate(pageID: String, _ template: PageTemplate) -> Bool
/// Verschiebt eine Seite. Nummeriert dicht neu, ein `page.update` je geänderter Seite.
func movePage(notebookID: String, from: Int, to: Int) -> Bool
/// Löscht mit Frist: sofort unsichtbar, `page.delete` erst nach 5 s oder beim Verlassen.
func deletePage(pageID: String)
func undoDelete(pageID: String)                  // nur innerhalb der Frist
func flushPendingDeletes()                       // beim Verlassen, im Hintergrund, beim Start

// InkOpBuilder, neu
static func pageUpdate(page: LibraryPage, nowMS: Int, offsetMS: Int?, makeID: () -> String) -> OutboxDraft?
static func pageDelete(page: LibraryPage, nowMS: Int, offsetMS: Int?, makeID: () -> String) -> OutboxDraft?

// SyncOutbox, neu
/// Entfernt wartende Operationen ohne Bestätigung und ohne Fehlerablage (ersetzt durch eine neuere)
func discard(opIDs: [String]) throws

// InkTemplateGeometry: reine Funktionen, Zahlen aus VERTRAEGE §7.4
static func lines(for template: PageTemplate, size: CGSize) -> [InkTemplateLine]
static func dots(for template: PageTemplate, size: CGSize) -> [CGPoint]
```

Verhalten:
- **Version:** `page.update` trägt `page.version`. Nach dem Einreihen `version += 1` in der Bibliothek. So beruht jede weitere Offline-Änderung auf der vorigen (§11.2).
- **`page_version_conflict`** in `SyncEngine.onError`: Operation **nicht** in die Fehlerablage. Stattdessen `onPageVersionConflict?(pageID)`. Der Dienst:
  1. läuft für diese Seite schon eine Auflösung, nichts tun;
  2. `GET /pages/{id}`: bei 404 alle wartenden `page.update` der Seite verwerfen und aufhören;
  3. `version` = Version des Core, alle wartenden `page.update` dieser Seite mit `discard` entfernen;
  4. weichen die lokalen Felder vom Core ab, **ein** neues `page.update` mit den lokalen Feldern und der Version des Core einreihen.
  Scheitert der Abruf, bleibt ein Merker stehen. Der nächste `welcome` versucht es erneut. Fehler für Operationen, die nicht mehr in der Warteschlange stehen, ignoriert die Engine schon heute.
- **Löschen ohne Dialog (R1):** Die Seite verschwindet sofort. Unten erscheint 5 s lang eine Leiste „Seite gelöscht · Rückgängig“. Erst danach wird `page.delete` eingereiht. Merker `deletedAtMS` plus `deleteQueued` in der Bibliothek: Stürzt die App in der Frist ab, reiht der nächste Start nach. Die letzte Seite eines Notizbuchs lässt sich löschen, danach legt `openTarget` eine neue an. `openTarget` überspringt ein `lastPageID`, das auf eine gelöschte Seite zeigt. Zeichnung und Vorschaubild bleiben 30 Tage auf dem iPad.
- **Blättern:** Eine Seite ist sichtbar. Oben „‹ Seite 3 / 12 ›“ mit zwei Knöpfen (≥ 44 pt). Dazu ein Ein-Finger-Wisch nach links oder rechts, nur wenn nicht gezoomt ist. Auf der letzten Seite legt „›“ bzw. der Wisch eine neue Seite an, aber nur, wenn die aktuelle Seite mindestens einen Strich hat. Die neue Seite erbt die Vorlage der aktuellen (bei `folie`: `blanko`).
- **Seitenwechsel:** alte Seite `saveNow()`, neues `InkPageModel` und neuer `InkCanvasContainerView(pageSize:)`. Es lebt immer nur **eine** Seite mit ihren zwei `PKCanvasView`. Nach dem Wechsel `setPresence`, `setLast` und, wenn nötig, Abgleich.
- **Seitenleiste** („Seiten ▤“ unten rechts, 07 §4.3): Raster mit Vorschaubildern und Seitenzahl. Tipp springt. Ziehen sortiert um. Kontextmenü: „Vorlage ▸“, „Löschen“. Knopf „+“ mit Vorlagenwahl. Fußzeile, wenn `remoteOnlyPageCount > 0`: „N weitere Seiten liegen nur am Mac.“
- **Vorschaubilder:** 240 px breit, JPEG, `Ink/<page_id>/thumb.jpg`. Erzeugt beim Speichern der Seite, außerhalb des Main-Actors aus den beiden `PKDrawing`-Daten. Die Leiste lädt sie träge.
- **Vorlage zeichnen:** `InkPaperView` ersetzt die einfarbige `paper`-Ansicht in `InkCanvasContainerView`. Sie zeichnet in Seitenkoordinaten und skaliert mit dem Rahmen (`contentMode = .redraw`), damit Linien beim Zoomen scharf bleiben. Farben nach §7.4, in Hell und Dunkel gleich.
- **Vorlagenwahl:** Blanko, Liniert, Kariert, Punktraster. `cornell` und `folie` stehen nicht zur Wahl. Eine vom Core kommende `cornell`-Seite wird wie `liniert` gezeichnet.

**Testfälle**
- `InkTemplateGeometry`: A4 liniert → erste Linie y = 60, Abstand 30, letzte < 822, x von 40 bis 555. Kariert → Abstand 14,173 (±0,001), keine Linie auf dem Rand. Punktraster → Anzahl = ⌊(w − ε)/r⌋ × ⌊(h − ε)/r⌋. Blanko und Folie → leer. Querformat 960 × 540.
- `addPage`: `index` fortlaufend, auch mit `remoteMaxIndex`. Operation dekodiert als `page.create` mit allen Pflichtfeldern, `null` ausgeschrieben.
- `movePage`: 5 Seiten, Seite 5 nach vorn → 5 Operationen. Seite 2 und 3 tauschen → 2 Operationen. Verschieben auf denselben Platz → 0. Versionen steigen je Operation um 1.
- `setTemplate`: ein `page.update`, `fields` vollständig. Von und nach `.folie` → `false`, keine Operation.
- Löschen: innerhalb der Frist rückgängig → keine Operation. Nach der Frist → genau ein `page.delete`. Neustart in der Frist → Operation wird nachgereiht. Striche nach `page.delete` gibt es nicht (Seite ist zu).
- Konflikt: zwei wartende `page.update`, der erste wird abgelehnt → beide verworfen, eine neue Operation mit Version des Core. Zweite Ablehnung derselben Seite währenddessen → kein zweiter Abruf. 404 → verworfen, nichts Neues. Kein Eintrag in der Fehlerablage.
- Zusammenführen mit wartendem `page.update`: lokaler `index` bleibt.
- Seitenwechsel: `saveNow` der alten Seite vor dem Laden der neuen, `presence` trägt die neue `page_id`.
- Wisch auf der letzten leeren Seite legt keine Seite an.

**Akzeptanzkriterien**
- [ ] 20 Seiten anlegen, umsortieren, drei löschen, alles offline. Nach dem Verbinden zeigt die Notizen-Spalte dieselbe Reihenfolge und dieselben Vorlagen.
- [ ] Die Schrift sitzt am Mac an derselben Stelle der Linien wie auf dem iPad (liniert und kariert, Sichtprüfung mit Bildschirmfoto im PR). Für kariert und Punktraster gilt das erst zusammen mit PR 5.
- [ ] In der Schreibansicht gibt es keinen modalen Dialog (R1).
- [ ] App direkt nach „+“ beenden → Seite ist nach dem Neustart da und wird gesendet.
- [ ] Der CI-Job `ipad` ist grün.

---

### PR 4 · iPad: Schreibmodi und Folie als Hintergrund (T1-13, Teil 2)

**Branch:** `feat/ipad-schreibmodi-folie` · **Größe:** L · **Abhängig von:** PR 3

**Scope**
- neu: `apps/ipad/Sources/Slides/**`, `apps/ipad/Sources/Sync/SessionFollower.swift`
- `apps/ipad/Sources/Sync/SyncEngine.swift`, `Core/CoreClient.swift` (inkl. `HTTPTransport`), `Library/**`, `Ink/**`
- `apps/ipad/Tests/**`, `docs/anleitungen/IPAD.md`

**Schnittstellen**

```swift
// SyncEngine: eingehende Nachrichten nach außen, als Sendable-Werte
struct SessionBrief: Equatable, Sendable {
    var id: String; var moduleID: String; var state: String
    var startedAtMS: Int?; var slideDeckID: String?; var deleted: Bool; var updatedAtMS: Int
}
enum SyncInbound: Equatable, Sendable {
    case sessionUpdated(SessionBrief)
    case subscribed(stream: String, reset: Bool)
    /// `slide` ist nur bei `slide.change` gesetzt. Jede Operation des Stroms kommt hier an, auch unbekannte.
    case op(stream: String, seq: Int, slide: SlideBrief?)
}
struct SlideBrief: Equatable, Sendable { var slideID: String?; var index: Int }

var onInbound: (@MainActor (SyncInbound) -> Void)?
func subscribe(stream: String, lastSeq: Int, lastOpID: String?)
func unsubscribe(stream: String)

// SessionFollower (@MainActor @Observable)
private(set) var running: SessionBrief?
private(set) var currentSlide: SlideBrief?
func start()                       // hängt sich an onInbound und welcomeCount

// CoreClient / HTTPTransport
func download(_ request: URLRequest, to file: URL) async throws -> HTTPURLResponse
func sessionSnapshot(endpoint:token:sessionID:) async throws -> SessionSnapshot
func slideDeck(endpoint:token:deckID:) async throws -> SlideDeckInfo        // schlanker eigener Decodable-Typ
func downloadSlideDeckFile(endpoint:token:deckID:to:) async throws
func lectureDefaults(endpoint:token:) async throws -> InkMode               // GET /settings → lecture.default_ink_mode
func patchModuleInkMode(endpoint:token:moduleID:mode:) async throws         // PATCH /modules/{id}

// Slides/
struct SlideRef: Codable, Equatable, Sendable { var id: String; var index: Int; var widthPt: Double; var heightPt: Double }
struct SlideDeckInfo: Codable, Equatable, Sendable { var deckID: String; var sha256: String; var slides: [SlideRef] }

@MainActor final class SlideDeckStore {
    /// Metadaten und PDF holen, falls sie fehlen. Mehrere Aufrufe für denselben Satz teilen sich einen Ladevorgang.
    func ensure(deckID: String) async -> SlideDeckInfo?
    func info(forSlide slideID: String) -> (deck: SlideDeckInfo, slide: SlideRef)?
    func pdfURL(deckID: String) -> URL?
}
enum SlideRenderer {
    /// Rendert eine PDF-Seite außerhalb des Main-Actors. `maxPixel` = längste Kante.
    static func image(pdf: URL, pageNumber: Int, maxPixel: Int) async -> UIImage?
}
```

Verhalten:
- **Session verfolgen (V5):** Nach jedem `welcome`: `GET /sessions?state=laeuft,pausiert`, jüngste Session, `GET …/snapshot`, aktuelle Folie = letztes `slide_event` (nach `t_ms`, dann `created_at`), dann `subscribe` mit `stream_seq`/`stream_op_id`. `subscribed` mit `reset` → Snapshot neu, erneut abonnieren, höchstens alle 5 s. Operation mit `seq == letzte + 1` anwenden, `seq ≤ letzte` verwerfen, Lücke → Snapshot neu. `session.updated`: ältere Fassung (`updated_at`) verwerfen. Session beendet oder gelöscht → `unsubscribe`, `running = nil`. Neue laufende Session → verfolgen. `InkLibraryService.running` speist sich ab jetzt aus dem Follower. Die Abfrage aus PR 2 entfällt.
- `SGServerMessage` verlässt `SyncEngine.parse` weiterhin nie (nicht `Sendable`, §11.7). `parse` baut `SyncInbound` aus einfachen Werten.
- **Folie auflösen:** `slide_id` aus dem Ereignis. Ist sie `null`, über `slide_index` in `SlideDeckInfo.slides` suchen. Ohne Treffer bleibt die Seite stehen.
- **Modus:** `module.inkMode ?? lecture.default_ink_mode ?? .freieSeite`. Umschalter in der Werkzeugleiste (ein Tipp, R2). Er ist nur aktiv, wenn `running` zum Modul gehört, einen Foliensatz hat und die aktuelle Folie bekannt ist. Sonst ausgegraut mit Beschriftung „Folien brauchen eine laufende Vorlesung mit Foliensatz“. Die Wahl wird lokal gespeichert (`setModuleInkMode(…, dirty: true)`) und bei Verbindung per `PATCH` gesendet. Nach Erfolg `dirty = false`.
- **Freie Seite:** Neue Seiten bekommen `attached_slide_id` = aktuelle Folie (wenn `running` zum Modul gehört), sonst `null`. Ein Folienwechsel ändert die offene Seite nicht.
- **Auf die Folie schreiben:** Beim Einschalten und bei jedem Folienwechsel: Seite des Notizbuchs mit `backgroundSlideID == Folie` öffnen, sonst anlegen (`template = .folie`, Größe der Folie, hinten anhängen). Läuft gerade ein Strich (`onToolUseBegan` bis `onToolUseEnded`), wartet der Wechsel bis zum Absetzen. Es gilt die letzte Folie. Blättert der Nutzer von Hand weg, bleibt das bis zum nächsten Folienwechsel.
- **Anzeige:** Seiten mit `backgroundSlideID` zeigen die Folie immer, auch ohne laufende Vorlesung, wenn das PDF im Speicher liegt. Fehlt es: Papier und eine kleine Zeile „Folie wird geladen …“ bzw. offline „Folie nicht auf dem iPad“. Schreiben geht trotzdem.
- **Folienleiste** oben (07 §4.3): nur Anzeige „Folie 23 / 48“. Blättern kommt mit T1-15.
- **Laden und Speicher:** siehe §4.5. Zielwerte dort sind verbindlich.

**Testfälle**
- `SessionFollower` mit Fake-Engine: Snapshot → Folie. `slide.change` mit nächster `seq` → neue Folie. Doppelte `seq` → ignoriert. Lücke → Snapshot wird neu geladen. `reset` → neu abonniert, kein Dauerfeuer (zweiter `reset` innerhalb von 5 s wartet). `session.updated` mit `beendet` → `unsubscribe`. Ältere `session.updated` → ignoriert. Neue Verbindung → alter `seq`-Stand vergessen.
- `parse`: `op` mit `slide.change`, mit unbekannter Art (zählt `seq`), `event session.updated`, `subscribed`.
- Modus: Auflösung über die drei Stufen. Wechsel offline → `dirty`, bei Verbindung genau ein `PATCH` mit `{"settings":{"ink_mode":…}}`. Abruf der Module überschreibt eine `dirty`-Wahl nicht.
- Folienseite: erste Folie → `page.create` mit `template = folie`, `background_slide_id`, Größe der Folie, `attached_slide_id = null`. Zurück zur selben Folie → keine neue Seite. Zwei Folienseiten für dieselbe Folie (Altbestand) → die mit kleinerem `index`. `slide_id = null` und `slide_index = 3` → dritte Folie des Satzes.
- Freie Seite: neue Seite trägt `attached_slide_id` der aktuellen Folie. Folienwechsel → Seite bleibt.
- Aufgeschobener Wechsel: zwei Folienwechsel während eines Strichs → nach dem Absetzen genau ein Seitenwechsel zur letzten Folie.
- `SlideDeckStore`: Datei wird nach `sha256` geprüft, falsche Summe → verworfen. Zweiter `ensure` ohne Netz liefert aus dem Speicher. Zwei gleichzeitige `ensure` → ein Download. Obergrenze: ältester Satz fliegt raus.
- `SlideRenderer`: PDF wird **im Test erzeugt** (`UIGraphicsPDFRenderer`, zwei Seiten, verschiedene Formate). Geprüft: Bildgröße ≤ `maxPixel`, Seitenverhältnis, Seite außerhalb → `nil`. **Keine echten Folien im Repo.**

**Akzeptanzkriterien**
- [ ] Mac blättert → das iPad zeigt im Modus „Auf die Folie“ binnen 1 s die neue Folienseite. Notizen auf früheren Folien bleiben erhalten.
- [ ] Der Moduswechsel kostet einen Tipp, gilt pro Modul und übersteht einen Neustart, auch offline.
- [ ] Ein Foliensatz mit 100 Seiten: Blättern bleibt flüssig, der Speicher der App wächst beim Durchblättern nicht mit (Instruments oder Xcode-Anzeige, Wert im PR nennen).
- [ ] Verbindung trennen, App neu starten → schon geladene Folien erscheinen weiter unter den Notizen.
- [ ] Der CI-Job `ipad` ist grün.

---

### PR 5 · Web: Folie in der Notizen-Spalte und 5-mm-Raster

**Branch:** `feat/web-notizen-folie` · **Größe:** S · **Abhängig von:** PR 1 · **parallel** zu PR 2 bis 4

**Scope**
- `apps/web/src/components/ink/**`, `apps/web/test/` (Tests zu `ink`)

**Schnittstellen**
- `render.ts`: Konstante `GRID_PT = 14.173`. `kariert` und `punktraster` nach V3. `liniert` und `cornell` bleiben.
- `InkPage.tsx`: Hat die Seite `background_slide_id`, liegt unter dem Canvas das Folienbild (`GET /api/v1/slides/{id}/image`, vorhandener Helfer in `lib/material.ts`), eingepasst auf `width_pt` × `height_pt`. Der Canvas zeichnet dann kein deckendes Papier. Schlägt das Bild fehl (404, Folie gelöscht), bleibt Papier. Kein Fehlertext in der Spalte.
- Keine Änderung an Props nach außen.

**Testfälle**
- `drawPaper` kariert: Linienabstand 14,173. Punktraster: erster Punkt bei (r, r).
- Seite mit `background_slide_id`: `<img>` mit der richtigen Adresse, Canvas transparent. Ohne: wie bisher. Bildfehler → Papier.
- Seitenwechsel von Folienseite zu freier Seite entfernt das Bild.

**Akzeptanzkriterien**
- [ ] Eine Folienseite des iPads zeigt am Mac die Folie mit den Notizen an der richtigen Stelle (Bildschirmfoto im PR, mit einer selbst erzeugten Test-Folie, keine Vorlesungsinhalte).
- [ ] Kariert und Punktraster haben 5 mm Raster.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` sind grün.

---

## 4. Fallstricke

### 4.1 Swift 6, strict concurrency

- Alles mit Zustand ist `@MainActor` (`SyncEngine`, Dienst, Ablagen, Follower). Neue Typen folgen dem Muster.
- Über Isolationsgrenzen gehen nur eigene `Sendable`-Werte (`SyncInbound`, `SessionBrief`, `SlideRef`, `Data`, `URL`, `UIImage`). Generierte Sync-Typen (`SGServerMessage`, `SGSyncOp`, auch mit `JSONAny` in `SyncError.details`) sind seit #97 ebenfalls `Sendable` (Probe in `swift-support/check.sh`).
- `CGPDFDocument`, `PKCanvasView` und `UIView` sind nicht `Sendable`. `SlideRenderer` öffnet das PDF **innerhalb** der abgetrennten Aufgabe und gibt nur das fertige Bild zurück.
- `PKDrawing` ist ein Wert. Für Vorschaubilder die `Data` übergeben und die Zeichnung in der Hintergrundaufgabe neu aufbauen.
- Closures, die über `await` hinweg leben (`onInbound`, `onStrokeChanges`, `onPageVersionConflict`), als `@MainActor`-Closures deklarieren und `[weak self]` fangen.
- Nach jedem `await` den Zustand neu prüfen (Seite gewechselt? Verbindung dieselbe? `_Concurrency.Task.isCancelled`?). #214 hatte genau so ein Rennen beim Wechsel.

### 4.2 Namen aus `Schemas.swift`

- `Schemas.swift` liegt im App-Modul und definiert unter anderem `Task`, `Page`, `Stroke`, `Session`, `Notebook`, `Module`, `Slide`, `SlideDeck`, `SlideEvent`, `Settings`, `Photo`, `Marker`.
- Darum **immer `_Concurrency.Task`** schreiben, auch bei `Task.sleep`, `Task.detached` und `Task.isCancelled`.
- Eigene Typen heißen `Library…`, `Slide…Info`, `SlideRef`, `SessionBrief`, `ModuleBrief`. Keinen der Namen oben neu vergeben, auch nicht verschachtelt.
- Kodieren von Operationen nur über `SGSyncOp` und `SGSync.encoder()` (§11.7). Pflichtfelder mit `null` müssen im JSON stehen (`session_id`, `background_slide_id`, `attached_slide_id`). Die Tests prüfen das am JSON-Text.
- UUIDs immer über `InkID.uuidV7()` (klein).

### 4.3 Kein Swift im Container

- Im Cloud-Container gibt es keinen Swift-Compiler für iOS. Nur der CI-Job `ipad` (macOS, Simulator) baut und testet.
- Arbeitsweise: klein committen, pushen, Job-Log lesen (`mcp__github__pull_request_read` mit `get_check_runs`, dann `mcp__github__get_job_logs`), beheben. Mit mehreren Runden rechnen.
- Logik in reine Funktionen und `@MainActor`-Klassen mit Fakes legen (wie `SyncFakes.swift`, `Fakes.swift`). SwiftUI-Ansichten dünn halten. Sie sind nur über den Build geprüft.
- XcodeGen nimmt neue Dateien unter `Sources/` und `Tests/` von selbst auf. `project.yml` nicht ändern.
- Im Simulator gibt es keinen Stift (`drawingPolicy = .anyInput`). Gesten und Schreibgefühl prüft der Owner auf dem Gerät. Was nicht am Gerät geprüft wurde, steht im PR unter „Offene Punkte“.
- Der Job läuft nur, wenn `apps/ipad/**` oder die Swift-Schemas geändert sind.

### 4.4 Offline-Puffer, Outbox, Reconcile, `db_epoch`

- **Erst die Bibliothek, dann die Operation.** Wie heute bei der Bindung: Bricht die App dazwischen ab, reiht der nächste Start nach (`createQueued == false` → `page.create` einreihen). Umgekehrt gäbe es Operationen ohne lokale Seite.
- **`correct` kennt heute nur drei Arten.** Jede neue Art ohne Zweig landet als `local_op_invalid` in der Fehlerablage (PR 2 schließt das für alle vier neuen Arten auf einmal).
- **Abgleich nur für Seiten, die dieses iPad angelegt hat.** `InkReconciler.plan` entfernt am Core alle Striche, die lokal fehlen. Auf einer Seite, die nur am Mac existiert, löschte das alles. Darum legt `mergePages` für solche Seiten keine `LibraryPage` an.
- **`db_epoch` neu:** `markAllNeedReconcile` setzt jede lokale Seite. Der Abgleich läuft je Seite beim Öffnen, nicht für alle auf einmal. Für nie wieder geöffnete Seiten: Beim Öffnen eines Notizbuchs zusätzlich für jede Seite mit `needsReconcile` und ohne Treffer in `GET /notebooks/{id}/pages` ein `page.create` einreihen (idempotent). Die Striche folgen beim Öffnen der Seite.
- **`db_epoch` neu, Notizbücher (PR 2):** Ein freies Notizbuch, das nach dem Backup angelegt wurde, fehlt dem Core danach. Ohne Gegenmittel setzte der nächste Abruf es auf `hidden` (es war ja `knownOnServer`), und jedes erneute `page.create` scheiterte mit `notebook_not_found`. Darum in `onWelcome` bei neuer `db_epoch`: alle Notizbücher `knownOnServer = false`, und für jedes Notizbuch mit `kind == .frei` und mindestens einer lokalen Seite `notebook.create` erneut einreihen (neue `op_id`, `created_at` aus der Bibliothek). Das ist idempotent: Kennt der Core die ID, auch im Papierkorb, kommt `ack` ohne Änderung. Es steht in der Warteschlange vor allen `page.create` aus dem Abgleich. Test: neue `db_epoch` → ein `notebook.create` je freiem Notizbuch mit Seiten, keins für `vorlesung`/`uebung`, nichts wird ausgeblendet.
- **Nach `db_epoch` stimmt `version` nicht mehr.** `mergePages` übernimmt die Version des Core, wenn kein `page.update` wartet. Wartet eines, löst der Konfliktweg aus PR 3 es auf.
- **Reihenfolge nach einer Wiederherstellung:** `mergePages` übernimmt `index` und `template` des Core, also den Stand des Backups. Umsortierungen und Vorlagenwechsel nach dem Backup gehen dabei verloren, Striche nicht. Bewusste Lücke, im PR von PR 3 nennen.
- **Seite am Mac gelöscht:** Das iPad merkt es in Phase 1 nicht. Striche auf diese Seite nimmt der Core an und legt sie in den Papierkorb (§11.2). Bewusste Lücke, im PR nennen.
- **Fenster von 200 Operationen:** Umsortieren großer Notizbücher erzeugt viele kleine Operationen. Das Fenster und die Paketbildung der Engine regeln das. Nichts bündeln.
- **`mark(forPage:)`** nur für Striche zählen (PR 2), sonst gleicht jede Seite nach jeder Seiten-Operation unnötig ab.
- **Löschfrist:** `page.delete` nie vor Ablauf der 5 s einreihen. Ein eingereihtes `page.delete` lässt sich vom iPad nicht zurücknehmen (`page.restore` ist eine Server-Operation).
- **Zwei Schreibwege für `running`** gibt es nur zwischen PR 2 und PR 4. PR 4 entfernt die Abfrage aus PR 2 vollständig.

### 4.5 Folien-PDF als Hintergrund (iPad Air M2, 8 GB RAM)

- **Laden:** `GET /slide-decks/{id}` für die Folienliste. Die Antwort enthält Text und Textblöcke aller Folien. Mit einem schlanken eigenen `Decodable` lesen (nur `id`, `index`, `width_pt`, `height_pt`, dazu `deck.sha256`). Das PDF mit `URLSession.download` **in eine Datei** laden, nie als `Data` in den Speicher. Zeitgrenze 120 s. Danach `sha256` der Datei stückweise prüfen (CryptoKit) und erst dann an den Zielort verschieben.
- **Ablage:** `Application Support/Slides/<deck_id>/deck.pdf` und `info.json`. Ordner mit `isExcludedFromBackup`. Nicht `Caches`: iPadOS darf dort mitten in der Vorlesung löschen. Obergrenze 1 GB, ältester Zugriff fliegt zuerst. Der Satz der laufenden Session nie.
- **Rendern:** außerhalb des Main-Actors, längste Kante 2048 px. Das sind höchstens rund 12 MB je Bild im Speicher. Im Speicher bleiben höchstens **drei** Bilder (aktuelle Folie, vorige, nächste). Bei `UIApplication.didReceiveMemoryWarningNotification` alle bis auf das sichtbare verwerfen.
- **Schnelles Blättern:** Ein neuer Auftrag bricht den laufenden ab. Es zählt die letzte Folie. Bis das Bild da ist, steht Papier.
- **PDF-Eigenheiten:** `getDrawingTransform(.cropBox, …)` nutzen, Drehung der Seite beachten. Die Seitengröße der Notizseite kommt aus `Slide.width_pt`/`height_pt` des Core, nicht aus dem PDF. Weicht das Verhältnis ab, die Folie einpassen und mittig setzen.
- **Zoom:** Das Bild wird mit der Seite skaliert. Über etwa 2× wird es weich. Das ist für Phase 1 in Ordnung. Nachschärfen nach dem Zoomen ist ein späteres Ticket.
- **Zwei `PKCanvasView` plus Folie:** Es lebt immer nur eine Seite. Beim Seitenwechsel die alte Ansicht wirklich freigeben (kein Halten in Closures).
- **Öffentliches Repo:** keine echten Folien, keine Bildschirmfotos mit Vorlesungsinhalten. Test-PDFs entstehen im Test.
- **Isoliertes Uni-WLAN:** Ohne Verbindung im Hörsaal kennt das iPad die aktuelle Folie nicht. „Auf die Folie“ geht dann erst mit T1-15 (lokal blättern) und vorab geladenen Sätzen. Siehe Frage 4.

### 4.6 Sonstiges

- **R1:** In der Schreibansicht kein Dialog, kein Sheet, das den Stift blockiert. Die Seitenleiste ist ein seitliches Panel und schließt mit einem Tipp. Der Dialog „+ Notizbuch“ liegt auf dem Startbildschirm.
- **Gesten:** Zwei-Finger-Tipp (Rückgängig) und Drei-Finger-Tipp (Wiederholen) bleiben. Der Zwei-Finger-Wisch ist für T1-15 reserviert. Der Ein-Finger-Wisch zum Blättern darf das Scrollen der Seite nicht stören: nur waagerecht, nur ungezoomt. Stört er am Gerät, bleibt es bei den Knöpfen, und das steht im PR.
- **Web-Tests** mit vollständigen `Page`-Objekten: Das Schema ist streng (`additionalProperties: false`).
- **#211** ändert den Web-Sync. PR 1 und PR 5 bauen darauf auf und fassen `lib/sync/client.ts` nicht an.

---

## 5. Offene Fragen an den Owner

Keine Frage blockiert PR 1 und PR 2. Der Plan folgt jeweils der Empfehlung, bis der Owner anders entscheidet.

| # | Frage | Optionen | Empfehlung |
|---|---|---|---|
| 1 | **Blättern oder endlos scrollen?** F-INK-02 nennt „Endlos-Scrollen wie in GoodNotes“. | a) Eine Seite sichtbar, Blättern per Knopf und Wisch. b) Alle Seiten untereinander, endlos scrollen. | **a) jetzt, b) als eigenes Ticket.** b) braucht viele gleichzeitige Zeichenflächen und birgt Risiken für Speicher und Schreibgefühl. a) ändert am Schreibgefühl nichts. |
| 2 | **Seite löschen: wie absichern?** In der Vorlesung sind Dialoge verboten (R1). | a) Sofort löschen, 5 s „Rückgängig“-Leiste, danach Papierkorb am Mac. b) Rückfrage per Dialog, in laufender Vorlesung gesperrt. | **a).** Ein Tipp, kein Dialog, ein Versehen ist sofort korrigierbar. |
| 3 | **Notizbücher auf dem iPad verwalten?** | a) Nur anlegen (geht offline). Umbenennen und Löschen später. b) Auch umbenennen und löschen, nur mit Verbindung (REST). | **a).** Der Vertrag erlaubt b) nur mit Verbindung. Das ist im Hörsaal oft nicht gegeben und selten nötig. |
| 4 | **Folien vorab aufs iPad laden?** Wichtig für das isolierte Uni-WLAN. | a) Nur den Satz der laufenden Vorlesung, bei Verbindung. b) Zu Hause automatisch alle Sätze der Module, bis 1 GB. c) Nur Sätze der letzten 14 Tage. | **a) in T1-13, c) zusammen mit T1-15.** Ohne lokales Blättern (T1-15) nützen vorab geladene Folien im Hörsaal noch nichts. |

Selbst entschieden und oben begründet: Endpunkt statt Feld an `Session` (E1), PDF statt PNG (E7), 5-mm-Raster nach Spezifikation (E9), Folienwechsel folgt automatisch und wartet nur auf das Ende des Strichs (F-INK-03), neue Seiten erben die Vorlage, Module alphabetisch ohne Semesterfilter.
