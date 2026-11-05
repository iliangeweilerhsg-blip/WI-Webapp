# 08 · Schnittstellen

**Quelle der Wahrheit für alle Datenformate** ist `packages/schemas/` (JSON Schema, Draft 2020-12). Daraus werden erzeugt:
- TypeScript-Typen + Zod-Validatoren (Core, Web)
- Swift-`Codable`-Structs (iPad)
- Pydantic-Modelle (Worker)

Ein Formatwechsel ist erst fertig, wenn alle drei Generate-Schritte und Contract-Tests grün sind.

## 1. REST-API

- Basis: `http://<mac>:4710/api/v1`, JSON (UTF-8), Zeitangaben ISO 8601 UTC (Ausnahme: in WebSocket-Umschlägen (`at`) und im Strich-Format (§4.1, `created_at`) werden Epochen-Millisekunden als Integer verwendet).
- **Authentifizierung:** Anfragen von `localhost` ohne Token. Aus dem Netz `Authorization: Bearer <device_token>`.
- **Fehlerformat:** `{ "error": { "code": "slide_deck_not_found", "message": "…", "details": {} } }` mit passendem HTTP-Status.
- **Listen:** Cursor-Paginierung `?cursor=…&limit=…`.
- **Idempotenz:** `POST` mit `Idempotency-Key`-Header (UUID). Wiederholte Anfragen liefern das erste Ergebnis.
- **OpenAPI-Beschreibung:** wird aus den Fastify-Routen erzeugt (`/api/v1/openapi.json`).

| Bereich | Endpunkte (Auszug, vollständig in OpenAPI) |
|---|---|
| Semester & Module | `GET/POST /semesters` · `GET/PATCH /semesters/{id}` · `GET/POST /modules` · `GET/PATCH/DELETE /modules/{id}` |
| Kalender | `POST /calendar/sources` (ICS-Datei/URL) · `POST /calendar/sources/{id}/sync` · `GET /calendar/events?from&to` · `PATCH /calendar/events/{id}` (Modul, Art) |
| Material | `POST /slide-decks` (multipart, `module_id`, `session_id?`) · `GET /slide-decks/{id}` · `GET /slides/{id}` · `GET /slides/{id}/image` · `POST /exercise-sheets` · `GET /tasks/{id}` · `PATCH /task-slide-links/{id}` |
| Sessions | `GET /sessions?module_id&state` · `POST /sessions` (spontan) · `POST /sessions/{id}/start` · `/pause` · `/resume` · `/stop` · `/extend` · `GET /sessions/{id}/snapshot` (Live-Stand) · `GET /sessions/{id}/timeline` (Segmente, Marker, Striche-Dichte, Phase 2) · `POST /sessions/{id}/import-media` |
| Audio | `POST /sessions/{id}/recordings` · `PUT /recordings/{id}/chunks/{seq}` (Rohdaten, `X-Start-Ms`, `X-Duration-Ms`, `X-Sha256`) · `POST /recordings/{id}/complete` · `GET /recordings/{id}/audio?from_ms&to_ms` (Range-fähig) |
| Transkript | `GET /sessions/{id}/transcript?slide_id` |
| Notizen | `GET/POST /notebooks` · `PATCH/DELETE /notebooks/{id}` · `GET /notebooks/{id}/pages` · `GET /pages/{id}` · `GET /pages/{id}/strokes` · `PUT/GET /pages/{id}/pkdrawing` · `PUT /photos/{id}/file` (Rohdaten, `photo_id` vom iPad) · `GET /photos/{id}/file` |
| Wissen | `GET/POST /concepts` · `GET/PATCH /concepts/{id}` · `POST /concepts/{id}/merge` · `POST /concepts/{id}/split` · `GET/POST/DELETE /concept-relations` · `GET /concepts/{id}/evidence` · `GET /graph?module_id&semester_id` |
| Inbox | `GET /inbox?status=offen&session_id` · `POST /inbox/{id}/accept` (optional geänderte Nutzlast) · `POST /inbox/{id}/reject` · `POST /inbox/bulk` |
| Lernen | `GET /review/queue?context=taeglich` · `POST /reviews` · `GET/POST/PATCH /cards` · `POST /cards/from-selection` · `POST /learn-sessions` · `PATCH /learn-sessions/{id}` · `POST /grade/open` · `GET /readiness?module_id` · `GET /mastery?concept_id` |
| Prüfungen | `GET/POST /exams` · `POST /past-exams` · `POST /mock-exams` (Probeklausur erzeugen) · `POST /mock-exams/{id}/submit` |
| Planer | `GET /plan?from&to` · `GET /plan/now` · `PATCH /study-blocks/{id}` (verschieben, pin, skip) · `POST /study-blocks` · `GET/PATCH /preferences` |
| Suche & Fragen | `GET /search?q&filters` · `POST /ask` (Frag deine Vorlesung, Antwort per Server-Sent Events) |
| Videos | `GET /videos?concept_id` · `POST /videos` (anfordern) · `GET /videos/{id}/file` |
| System | `GET /jobs?session_id` · `POST /jobs/{id}/retry` · `GET /costs?month` · `POST /backup` · `GET /backups` · `POST /export` · `GET/PATCH /settings` · `GET/DELETE /devices` · `POST /devices/pairings` · `GET /devices/pairings/requests` · `POST /devices/pair/start` · `POST /devices/pair/confirm` · `GET /trash` · `POST /trash/{id}/restore` |

## 2. Sync-Protokoll (WebSocket)

Endpunkt: `ws://<mac>:4710/sync`. Nachrichten als JSON-Text-Frames. Geräte aus dem Netz melden sich beim Upgrade mit `Authorization: Bearer <device_token>` an, die lokale Web-App ohne Token.

### 2.1 Verbindungsaufbau
```jsonc
// Client → Server
{ "type": "hello", "protocol": 1, "client": "ipad", "device_id": "…", "app_version": "1.0.0",
  "streams": [ { "stream": "notebook:<id>", "last_seq": 1832, "last_op_id": "…" },
               { "stream": "session:<id>",  "last_seq": 77, "last_op_id": "…" } ] }
// Server → Client
{ "type": "welcome", "protocol": 1, "server_time": 1730707200123, "server_version": "…",
  "db_epoch": "…", "device_id": "…",
  "resume": [ { "stream": "notebook:<id>", "from_seq": 1833, "head_seq": 1840, "reset": false } ] }
```
Danach sendet der Server fehlende Operationen ab `from_seq`. Passt `last_op_id` nicht zur Operation `last_seq` oder hat sich `db_epoch` geändert (Wiederherstellung), kommt `reset`: Der Client gleicht per REST ab und sendet fehlende eigene Daten erneut. Anschließend: **Uhrabgleich**, und erst danach die Ausgangswarteschlange
```jsonc
{ "type": "time.ping", "t0": 1730707200456 }             // Client
{ "type": "time.pong", "t0": 1730707200456, "ts": 1730707200470 }  // Server
```
5 Runden, Median-Versatz, Wiederholung alle 5 min.

Die vollständigen Nachrichten (u. a. `protocol`, `client`, `subscribe`, `presence`, `time.offset`, `error`) stehen als `SyncClientMessage` bzw. `SyncServerMessage` in `packages/schemas`. Abläufe, Fehler und Grenzen regelt `docs/VERTRAEGE.md` §11.

### 2.2 Ströme
| Strom | Inhalt | Schreiber |
|---|---|---|
| `notebook:<id>` | Notizbuch anlegen, Seiten anlegen/ändern, Striche hinzufügen/entfernen, Elemente | iPad |
| `session:<id>` | Start/Stopp/Pause, Folienwechsel, Marker, Fotos | iPad, Mac |
| `user` | Abonnements (aktive Session, aktuelle Seite), Plan-Änderungen, Review-Warteschlange (Phase 3) | Server |

### 2.3 Operationen
```jsonc
{ "type": "op", "op_id": "<uuidv7>", "stream": "notebook:<id>",
  "kind": "stroke.add",
  "at": 1730707260123,                // synchronisierte Zeit, zu der die Operation auf dem Gerät entstand
  "clock_uncertain": false,
  "data": { … } }
// Server → alle Clients des Stroms (inkl. Bestätigung an den Absender)
{ "type": "ack", "op_id": "…", "stream": "…", "seq": 1834 }
{ "type": "op", "seq": 1834, … }     // Weitergabe an andere Clients
```

| `kind` | `data` |
|---|---|
| `notebook.create` | `{ notebook_id, module_id, title, kind?, created_at }` im Strom `notebook:<notebook_id>`. Idempotent über `notebook_id`. Umbenennen und Löschen nur per REST |
| `notebook.update` / `notebook.delete` / `notebook.restore` | nur Server: `{ notebook_id, fields: { title, module_id } }` bzw. `{ notebook_id }` nach REST-Änderung oder Papierkorb |
| `page.create` | `{ page_id, notebook_id, session_id?, index, template, width_pt, height_pt, background_slide_id?, attached_slide_id? }` |
| `page.update` | `{ page_id, fields: { index, template, session_id, background_slide_id, attached_slide_id }, version }`, immer vollständiger Stand |
| `page.delete` | `{ page_id }` |
| `page.restore` | nur Server: `{ page_id }` nach Wiederherstellung aus dem Papierkorb |
| `stroke.add` | `{ page_id, stroke: Stroke }` (§4). Upsert über `client_id`, auch für Lasso und Umfärben |
| `stroke.remove` | `{ page_id, client_ids: [ … ] }` |
| `element.upsert` | `{ page_id, element: PageElement }` (§4.4) |
| `element.remove` | `{ page_id, element_id }` |
| `drawing.snapshot` | `{ page_id, pkdrawing_ref }` (Datei per HTTP über `PUT /pages/{id}/pkdrawing` hochgeladen, nur fürs iPad) |
| `session.start` | `{ session_id, module_id, calendar_event_id?, slide_deck_id?, started_from: "ipad"\|"mac", started_at }` |
| `session.pause` / `.resume` / `.stop` | `{ session_id, reason? }` |
| `slide.change` | `{ event_id, session_id, slide_id?, slide_index, t_ms, device: "ipad"\|"mac" }` |
| `marker.add` | `{ marker_id, session_id, kind, t_ms, page_id?, position?, note?, source: "ipad"\|"mac" }` |
| `marker.remove` | `{ marker_id }` |
| `photo.add` | `{ photo_id, session_id, t_ms, page_id?, file_ref: { sha256, mime: image/heic\|image/jpeg, size_bytes } }` |
| `review.add` (Phase 3) | `{ review_id, card_id, rating, answer?, duration_ms, reviewed_at }` |

**Regeln**
- `t_ms` ist die Sitzungszeit beim Ereignis auf dem Gerät, nicht beim Senden; verspätet gesendete Operationen behalten sie.
- Der Server ordnet pro Strom fortlaufende `seq` zu. Bereits bekannte `op_id` werden mit dem vorhandenen `ack` beantwortet (idempotent).
- Clients senden höchstens 200 offene (unbestätigte) Operationen gleichzeitig.
- Felder mit `?` sind im Sync **Pflichtfelder mit Wert `null`**, nicht weglassbar (eindeutige Kodierung in Swift).
- Reihenfolge pro Verbindung ist garantiert, der Client sendet Eltern vor Kindern. Der Server hält nichts zurück. Inhalte für weich gelöschte Eltern werden angenommen und mit deren Löschzustand gespeichert. Nie existierende Eltern ergeben einen nicht wiederholbaren Fehler, und der Client legt die Operation samt abhängigen in eine Fehlerablage (`docs/VERTRAEGE.md` §11.2).
- Ein wiederholbarer Fehler schließt die Verbindung. Der Client verbindet neu und sendet in Originalreihenfolge.
- Keine Löschung ist endgültig: `stroke.remove` setzt `deleted_at`.
- **Keepalive:** `{"type":"ping"}` alle 15 s. Nach 45 s ohne Antwort trennt der Client und verbindet neu (exponentielles Warten bis max. 30 s).

### 2.4 Server-Ereignisse an die Web-App
Phase 1 (`SyncEvent` in `packages/schemas`): `session.updated` (Session), `presence` (was ein anderes Gerät zeigt), `device.connection` (Gerät verbunden/getrennt), `pairing.requested` (nur an lokale Web-Clients). Ereignisse haben keine `seq` und werden nicht nachgeliefert.

Ab Phase 2 geplant:
```jsonc
{ "type": "event", "name": "session.processing", "data": { "session_id": "…", "step": "transcribe", "state": "fertig" } }
{ "type": "event", "name": "plan.updated", "data": { "from": "…", "to": "…" } }
{ "type": "event", "name": "inbox.count", "data": { "open": 12 } }
```

## 3. Kopplung von Geräten

1. Unter *Einstellungen → Geräte* öffnet die Web-App ein **Kopplungsfenster** (`POST /devices/pairings`, nur lokal, 5 min, höchstens eins offen). Sie zeigt einen 6-stelligen Code und einen **QR-Code**. Der Core kündigt sich per Bonjour an (`_studiengehirn._tcp`, TXT-Record `v=1`, `name=<Macname>`).
2. Das iPad meldet sich mit `POST /api/v1/devices/pair/start` `{ device_name, kind, public_nonce }` am offenen Fenster an und bekommt `request_id` und `pairing_id`, aber nicht den Code. Das belegt das Fenster nicht exklusiv, aber es gibt höchstens 10 offene Anfragen pro Fenster (danach `429 pairing_requests_full`). Die Web-App listet die Anfragen (Ereignis `pairing.requested`, nach dem Neuladen `GET /devices/pairings/requests`) und kann fremde ablehnen. Sie empfiehlt den QR-Weg, weil Gerätenamen frei wählbar sind (Phishing).
3. Der Nutzer tippt den Code am iPad ein → `POST /devices/pair/confirm` `{ pairing_id, code, device_name, kind, public_nonce }` → Server antwortet mit `device_token` (256 Bit, zufällig). Gespeichert wird nur `token_hash` (SHA-256). Der Code liegt nur im Speicher des Core. Fehlversuche sind pro Fenster und global begrenzt, ein neues lokal geöffnetes Fenster setzt die Zähler zurück (`docs/VERTRAEGE.md` §12).
4. QR-Code-Variante: QR enthält `sg://pair?v=1&host=…&port=4710&pairing_id=…&code=…`, also dieselben Daten, die die Web-App auch als Text zeigt. Scannen ersetzt Schritt 2 und das Eintippen in Schritt 3.
5. Gerät entfernen widerruft das Token sofort.

## 4. Strich-Format

### 4.1 Stroke (JSON)
```jsonc
{
  "client_id": "01J…",          // UUIDv7, auf dem iPad vergeben, stabil
  "tool": "pen",                // pen | pencil | marker | monoline | fountain
  "layer": "ink",               // ink | highlight
  "color": "#1E2A44FF",         // RGBA
  "width": 2.4,                 // Grundbreite in pt
  "created_at": 1730707260123,  // synchronisierte Zeit, Beginn
  "t_start_ms": 2531123,        // Sitzungszeit (null ohne Session)
  "t_end_ms": 2531980,
  "transform": [1,0,0,1,0,0],   // affine Transformation (Lasso-Verschiebung)
  "bbox": [x, y, w, h],         // in Seitenkoordinaten (pt, Ursprung oben links)
  "points": "<base64>"          // gepackt, siehe 4.2
}
```

### 4.2 Punkt-Packung
Pro Punkt 6 Werte als `Float32` little-endian, hintereinander:
`x`, `y` (pt) · `dt` (ms seit `created_at`) · `force` (0–1, normiert) · `azimuth` (rad) · `altitude` (rad).
Optionaler Glättung wird beim Rendern angewendet, nie beim Speichern. Ein durchschnittlicher Strich hat 40–150 Punkte (≈ 1–4 KB).

**Klarstellungen (Testdaten `tests/fixtures/strokes`, PR #39):**
- `points` enthält die Rohkoordinaten **vor** `transform`, wie `PKStrokePoint.location` im Pfad-Koordinatensystem. `bbox` gilt **nach** `transform` und schließt die halbe Strichbreite (`width / 2`) ein. Bei einer Lasso-Verschiebung ändern sich also `transform` und `bbox`, `points` bleibt gleich.
- `dt` des ersten Punkts ist `0`, `dt` steigt monoton. `t_end_ms − t_start_ms` entspricht dem `dt` des letzten Punkts.
- Ein Punkt hat genau 24 Byte, also 32 Base64-Zeichen. `points` hat darum nie Padding und mindestens einen Punkt.

### 4.3 Zuordnung PencilKit ↔ neutrales Format (iPad)
- **Quelle der Wahrheit auf dem iPad** ist `PKDrawing` (verlustfrei). Das neutrale Format wird daraus abgeleitet.
- **Stabile IDs:** PencilKit-Striche haben keine ID. Das iPad hält pro Seite eine Zuordnung `Fingerabdruck → client_id`. Fingerabdruck = Hash aus `path.creationDate`, Punktanzahl und den ersten 3 Punkten (vor Transformation). Bei jeder Änderung (`canvasViewDrawingDidChange`) wird der Strichbestand mit der Zuordnung verglichen:
  - neue Fingerabdrücke → `stroke.add`
  - verschwundene → `stroke.remove`
  - gleicher Fingerabdruck, aber geänderte Eigenschaften (Lasso: `transform`; Umfärben: `color`; Skalieren) → nur `stroke.add` mit **gleicher** `client_id` und unveränderter Zeit. Der Server macht daraus ein Upsert.
  - Gleiche Fingerabdrücke auf einer Seite (z. B. kopierte Striche) werden nach ihrem Vorkommen in `PKDrawing.strokes` durchgezählt: Der Schlüssel ist `Fingerabdruck#n`. So bekommt jede Kopie eine eigene `client_id`.
- **Werkzeuge:** `PKInkingTool.InkType` wird auf `tool` abgebildet, `PKInk.color` auf `color`. Die Breite kommt aus dem Werkzeug und der Punktgröße.
- Der Radierer im Pixelmodus teilt Striche in Teilstücke. Die Teilstücke werden zu neuen Strichen mit eigener `client_id`, aber der ursprünglichen `created_at`.

### 4.4 PageElement
```jsonc
{ "element_id": "…", "kind": "text",  "frame": [x,y,w,h], "z": 3, "t_ms": 2533000,
  "payload": { "text": "…", "size": "m" } }
{ "kind": "image", "payload": { "photo_id": "…", "crop": [..] } }
{ "kind": "shape", "payload": { "shape": "rectangle|ellipse|line|arrow|triangle|diamond",
                                "points": [[x,y],…], "color": "…", "width": 2 } }
{ "kind": "tape",  "payload": { "color": "#9AA0A6FF", "covered": true, "card_id": null } }
{ "kind": "stamp", "payload": { "marker_id": "…", "marker_kind": "frage" } }
```

## 5. Job-Verträge

Jeder Job: `{ type, payload, priority, depends_on[], run_after }`. Ergebnisse schreibt der Worker direkt in die Zieltabellen und setzt `job.result` auf eine Zusammenfassung.

| Typ | Payload | Ergebnis / schreibt |
|---|---|---|
| `pdf.ingest` | `{ slide_deck_id }` | `slide.*`, `slide_deck.ingest_state` |
| `embed.slides` / `embed.tasks` | `{ deck_id }` / `{ sheet_id }` | `slide.embedding` / `task.embedding` |
| `sheet.split` | `{ sheet_id }` | `task.*` |
| `match.tasks_slides` | `{ module_id, sheet_id? , deck_id? }` | `task_slide_link` |
| `audio.finalize` | `{ recording_id }` | Gesamtdatei, `recording.state` |
| `transcribe` | `{ session_id, provider? }` | `transcript_segment` |
| `align.log` | `{ session_id }` | `slide_segment(source=log)` |
| `align.content` | `{ session_id }` | `slide_segment(source=ausrichtung)` bzw. `inbox_item(slide_correction)` |
| `detect.exam_hints` | `{ session_id }` | `marker(source=detektor)` |
| `ocr.photos` / `ocr.ink` | `{ session_id }` / `{ page_id }` | `photo.ocr_text` / `search_chunk` |
| `concepts.extract` | `{ session_id }` | Zwischenergebnis in `job.result` |
| `concepts.resolve` | `{ session_id, extract_job_id }` | `inbox_item(concept_new/merge/relation)`, automatisch: `evidence` |
| `summary.write` | `{ session_id }` | Vorlesungsnotiz im Vault, `inbox_item(summary)` |
| `cards.generate` | `{ concept_ids[], session_id? }` | `inbox_item(card_batch)` |
| `cornell.questions` | `{ page_ids[] }` | `page_element(text)` |
| `explain.questions` | `{ session_id }` | Erklärungen zu ❓-Markern (für Nacharbeitung Schritt 1) |
| `vault.write` | `{ concept_ids[] }` | Markdown-Dateien |
| `prereq.check` | `{ session_id (zukünftig) }` | Ergebnis an Planer |
| `past_exam.analyze` | `{ past_exam_id }` | `past_exam_question` |
| `grade.open` | `{ card_id, answer }` (synchron über Core, Timeout 3 s) | `{ rating_suggestion, missing_points, feedback }` |
| `grade.analyze_error` | `{ review_log_id }` | `error_record` |
| `feynman.evaluate` | `{ concept_id, text | audio_ref }` | Ergebnis + `inbox_item(card_batch)` |
| `solution.compare` | `{ task_id, page_id | text }` | Ergebnis + `error_record` |
| `search.index` | `{ source_kind, source_ids[] }` | `search_chunk` |
| `rag.answer` | `{ question, scope }` (Streaming über Core) | Antworttext mit Beleg-IDs |
| `video.v0` / `video.v1` / `video.v2` | `{ concept_id }` / `{ session_id }` / `{ concept_id }` | `video`, `video_chapter` |
| `fsrs.optimize` | `{}` | neue Gewichte in `setting` |
| `maintenance.nightly` | `{}` | Papierkorb leeren (> 30 Tage), Schnappschüsse, Dubletten-Vorschläge |

## 6. Kartenformat (`card.front` / `card.back`)

```jsonc
// basic / reverse
{ "front": { "text_md": "Was besagt die 3NF?" },
  "back":  { "text_md": "…", "explanation_md": "…" } }
// cloze
{ "front": { "text_md": "Eine Relation ist in 3NF, wenn sie in {{c1::2NF}} ist und …" },
  "back":  { "answers": { "c1": ["2NF", "zweite Normalform"] } } }
// mc
{ "front": { "text_md": "…", "options": ["…","…","…","…"], "shuffle": true },
  "back":  { "correct": [2], "explanation_md": "…" } }
// open
{ "front": { "text_md": "Erkläre, warum …" },
  "back":  { "model_answer_md": "…", "criteria": ["nennt transitive Abhängigkeit", "…"] } }
// calc
{ "front": { "text_md": "…", "given": {"…": "…"} },
  "back":  { "steps_md": ["…"], "result": "…", "tolerance": 0.01 } }
// relation
{ "front": { "text_md": "Wie hängen *Funktionale Abhängigkeit* und *3NF* zusammen?" },
  "back":  { "key_points": ["…","…"] } }
// image_occlusion / tape
{ "front": { "image_ref": "slide:<id>" | "page:<id>", "masks": [[x,y,w,h]], "active_mask": 0 },
  "back":  { "labels": ["…"] } }
```
Texte in Markdown mit LaTeX (`$…$`, `$$…$$`).

## 7. Dateiablage

```
~/StudienGehirn/
├── config/            .env (Schlüssel, Rechte 600), settings-Export
├── media/
│   ├── decks/<deck_id>/original.pdf, slides/<index>.png, thumbs/<index>.webp
│   ├── sheets/<sheet_id>/original.pdf, solution.pdf
│   ├── recordings/<recording_id>/chunks/<seq>.webm|.mp4 (Endung aus recording.mime), full.m4a (AAC, 48 kHz, mono; Lücken als Stille)
│   ├── photos/<photo_id>.heic|jpg
│   ├── pages/<page_id>.pkdrawing (vom iPad hochgeladene Sicherung)
│   ├── imports/<session_id>/…
│   └── videos/<video_id>.mp4, <video_id>.vtt
├── vault/             (§8)
└── logs/              core.log, worker.log (rotierend, 14 Tage)
```

## 8. Vault-Format

### 8.1 Ordner
```
vault/
├── Konzepte/<Konzeptname>.md           flach, fachübergreifend
├── Fächer/<Modul>/_Fach.md
├── Fächer/<Modul>/Vorlesungen/VL<nn> – <Titel>.md
├── Fächer/<Modul>/Übungen/Blatt <nn>.md
├── Klausuren/<Modul> <Datum>.md
└── Inbox/                               nur lesend für Obsidian: offene Vorschläge als Liste
```
Dateinamen: Konzeptname mit Klammerzusatz zur Unterscheidung („Normalisierung (Datenbanken)"). Unzulässige Zeichen (`/ \ : * ? " < > |`) werden durch `–` ersetzt.

### 8.2 Konzeptnotiz
```markdown
---
sg_id: 01J8Z…                     # Pflicht, verbindet Datei und Datenbank
typ: konzept
art: verfahren                    # definition | verfahren | modell | satz | beispiel
faecher: [Datenbanksysteme]
aliases: [Normalization]
baut_auf: ["[[Funktionale Abhängigkeit]]", "[[Relation]]"]
beispiel_fuer: []
gegensatz: []
angewendet_in: ["[[Datenbankentwurf]]"]
klausurrelevant: true
beherrschung: 0.62                # von der App gepflegt, nur lesend gedacht
---
# Normalisierung (Datenbanken)

<!-- sg:auto:einsatz -->
> **In einem Satz:** Tabellen so zerlegen, dass keine Daten doppelt gespeichert werden und keine Anomalien entstehen.
<!-- /sg:auto -->

## Kernidee – in meinen Worten
<!-- sg:mine -->

## Wofür brauche ich das?
<!-- sg:mine -->

## Beispiel
<!-- sg:mine -->

## Typische Fehler & Verwechslungen
<!-- sg:auto:fehler -->
- Verwechselt mit [[Denormalisierung]] (2×)
<!-- /sg:auto -->

## Zusammenhänge
<!-- sg:auto:zusammenhaenge -->
- baut auf: [[Funktionale Abhängigkeit]], [[Relation]]
- verwandt aus anderem Fach: [[Redundanz (Informationstheorie)]]
<!-- /sg:auto -->

## Belege
<!-- sg:auto:belege -->
- 📄 [DBS VL07 · Folie 14](sg://slide/01J…) · 🎧 [08:41](sg://audio/01J…?t=2512000) · ✍️ [Notiz S. 3](sg://page/01J…) · 📝 [Blatt 4 · 2b](sg://task/01J…)
<!-- /sg:auto -->

## Offene Fragen ❓
<!-- sg:mine -->
```

### 8.3 Regeln
- Blöcke `<!-- sg:auto:<name> --> … <!-- /sg:auto -->` gehören der App. Sie werden nur ersetzt, wenn ihr Inhalt dem zuletzt von der App geschriebenen Stand entspricht (Hash pro Block in der Datenbank). Sonst entsteht ein Inbox-Vorschlag mit Unterschiedsansicht.
- Abschnitte mit `<!-- sg:mine -->` gehören dem Nutzer und werden nie verändert.
- Links `sg://…` öffnen die Web-App (registriertes URL-Schema über eine kleine Hilfs-App, P1). In Obsidian sind sie anklickbare Links. Fallback: `http://localhost:4710/open/…`.
- Frontmatter-Schlüssel für Beziehungen werden in beide Richtungen synchronisiert (F-BIB-05).
- Schreibzugriffe der App erfolgen atomar (temporäre Datei + Umbenennen), damit Obsidian nie halbe Dateien liest.
