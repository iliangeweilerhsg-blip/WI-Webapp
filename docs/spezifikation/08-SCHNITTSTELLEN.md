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
| Moodle (§9) | `GET /moodle/status` · `GET /moodle/courses` · `GET /moodle/courses/{id}/contents` · `GET /moodle/assignments` · `GET /moodle/deadlines` · `GET /moodle/file?ref` · `GET /moodle/actions` · `POST /moodle/uploads` · `POST /moodle/actions/{id}/preview` · `POST /moodle/actions/{id}/execute` · Abgleich (§9.4): `GET /moodle/links` · `PUT/DELETE /moodle/links/{course_id}` · `GET /moodle/items` · `PATCH /moodle/items/{id}` · `GET/POST /moodle/sync` · `GET /moodle/synced-deadlines` |
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
├── config/            .env (Schlüssel, Rechte 600), moodle.json (ohne Token, §9.1), settings-Export
├── media/
│   ├── decks/<deck_id>/original.pdf, slides/<index>.png, thumbs/<index>.webp
│   ├── sheets/<sheet_id>/original.pdf, solution.pdf
│   ├── recordings/<recording_id>/chunks/<seq>.webm|.mp4 (Endung aus recording.mime), full.m4a (AAC, 48 kHz, mono; Lücken als Stille)
│   ├── photos/<photo_id>.heic|jpg
│   ├── pages/<page_id>.pkdrawing (vom iPad hochgeladene Sicherung)
│   ├── imports/<session_id>/…
│   └── videos/<video_id>.mp4, <video_id>.vtt
├── vault/             (§8)
├── tmp/moodle-uploads/<upload_id>  (Uploads für Moodle-Aktionen, verfallen nach 24 h, §9.3)
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

## 9. Moodle-Anbindung

Funktionen: F-MDL-01 bis F-MDL-06 (Kap. 04). Datenformate: `packages/schemas/src/moodle.schema.json`.

### 9.1 Zugang

| Thema | Festlegung |
|---|---|
| Instanz | `SG_MOODLE_URL`, z. B. `https://moodle2.uni-potsdam.de`. Leer = Moodle-Anbindung aus (`GET /moodle/status` → `nicht_eingerichtet`, `GET /moodle/actions` → alle Aktionen `available: false`, Endpunkte, die Moodle aufrufen → `503 moodle_not_configured`; lokale Endpunkte (§9.4) antworten immer). |
| Token | macOS-Schlüsselbund, Dienst `studiengehirn-moodle`. Der Core liest ihn mit `security find-generic-password -s studiengehirn-moodle -w` und hält ihn nur im Speicher. |
| Metadaten | `config/moodle.json`: `{ "site_url", "user_id", "token_valid_until" (Datum), "created_at" }`. Enthält keinen Token. |
| Moodle-API | `POST <SG_MOODLE_URL>/webservice/rest/server.php` mit `wstoken`, `wsfunction`, `moodlewsrestformat=json`, Parameter im Body (`application/x-www-form-urlencoded`, verschachtelt als `a[0][b]=…`). Der Token steht **nie** in einer URL. |
| Dateien | Download über `webservice/pluginfile.php/…`. Der Token geht als Formularfeld `token` per `POST` mit, nicht in der URL. Upload über `webservice/upload.php` (Entwurfsbereich), danach Verwendung in der jeweiligen Aktion. |
| Drosselung | Höchstens 4 Anfragen pro Sekunde, höchstens 2 gleichzeitig, Zeitlimit 30 s (Dateien 120 s). Lesende Aufrufe werden bei Netzwerkfehlern und `5xx` bis zu 2-mal wiederholt (1 s, 4 s). Schreibende Aufrufe werden **nie** automatisch wiederholt (der Client trennt `read()` und `write()`; `read()` verweigert bekannte schreibende Funktionen). Scheitert ein schreibender Aufruf an Netzwerk, Zeitlimit oder `5xx`, ist offen, ob Moodle ihn übernommen hat: `502 moodle_unreachable` mit `details.outcome_unknown = true`. Die Web-App wiederholt dann nicht selbst, sondern lässt den Stand neu laden. Ein Datei-Download belegt seinen Platz, bis die Übertragung endet. |
| Weiterleitungen | Der Core folgt **keiner** HTTP-Weiterleitung von Moodle (`redirect: manual`), sonst ginge der Token im Body an das neue Ziel. Eine `3xx`-Antwort → `502 moodle_unreachable` mit `details.reason = "redirect"`. `SG_MOODLE_URL` muss daher die endgültige Adresse sein. |
| Logs | Token, `wstoken` und `token` werden redigiert. Geloggt werden Funktionsname, Dauer und Moodle-Fehlercode. |

**Fehler von Moodle** (geprüft am 04.11.2026 gegen Moodle 4.5): Die REST-Schnittstelle antwortet auch bei Fehlern mit HTTP 200 und `{ "exception", "errorcode", "message" }`. `webservice/pluginfile.php` antwortet bei Fehlern mit JSON `{ "error", "errorcode" }`, HTTP 200 (z. B. `invalidtoken`) bzw. 404 (`filenotfound`).

**Ergänzungen zur Drosselung (Issue #129):**
- **Eigener Download-Pool:** Datei-Downloads haben 2 eigene Plätze, getrennt von den 2 Plätzen der REST-Aufrufe. Zwei hängende Downloads halten Status, Fristen und Kursinhalte nicht auf. Die Grenze von 4 Anfragen pro Sekunde gilt für beide Pools zusammen.
- **Leerlauf-Zeitlimit statt Gesamtlimit:** Für Dateien gilt statt „120 s“ ein Leerlauf-Zeitlimit von 30 s. Gemeint sind 30 s ohne neue Daten, schon vor den Headern und vor dem ersten Byte. Die Dauer der ganzen Übertragung ist nicht begrenzt (nur die Dateigröße, §9.2). Für REST-Aufrufe bleibt es bei 30 s für die ganze Antwort.
- **Mindestrate als Reserve:** Ein Server, der alle 29 s ein Byte schickt, umgeht das Leerlauf-Zeitlimit. Darum müssen bei einem Datei-Download in jedem Zeitfenster von 60 s mindestens 64 KiB ankommen (gemessen ab dem Start der Anfrage). Sonst bricht der Core ab: `502 moodle_unreachable` mit `details.reason = "too_slow"`, ohne Wiederholung.
- **Kein Wiederholen bei Stillstand:** Ein Datei-Download, der am Zeitlimit scheitert, wird nicht wiederholt (`502 moodle_unreachable`, `details.reason = "timeout"`). Netzwerkfehler und `5xx` werden wie bei REST bis zu 2-mal wiederholt.
- **Abbruch:** Bricht die Web-App ab oder fährt der Core herunter, wird die Moodle-Verbindung geschlossen und der Platz frei. Wartet die Anfrage noch auf einen Platz, wird Moodle nie angefragt.
- **`SG_MOODLE_URL` prüft der Core beim Start wie die CLI:** nur `https`, keine Zugangsdaten, kein Query und Fragment, kein Backslash, Leer- oder Steuerzeichen. Intern zählt nur die normalisierte Form (`origin + pathname`, ohne Schrägstrich am Ende). Ein ungültiger Wert verhindert den Start des Core.

**Fehlercodes des Core**

| HTTP | `code` | Wann |
|---|---|---|
| 503 | `moodle_not_configured` | `SG_MOODLE_URL` leer oder kein Token im Schlüsselbund (nur Endpunkte, die Moodle aufrufen) |
| 409 | `moodle_token_invalid` | Moodle meldet `invalidtoken` oder `invalidtimedtoken` (Token unbekannt oder abgelaufen) |
| 502 | `moodle_unreachable` | Netzwerkfehler, Zeitlimit, Antwort ist kein JSON |
| 502 | `moodle_error` | Moodle meldet eine Ausnahme. `details.moodle_errorcode` und `details.moodle_message` |
| 501 | `moodle_function_unavailable` | Die nötige `wsfunction` ist für den Token nicht freigegeben (Moodle: `accessexception`, unbekannte Funktion: `invalidrecord` auf `external_functions`) |
| 501 | `moodle_action_not_implemented` | Aktion steht im Katalog, ist im Core aber noch nicht umgesetzt |
| 404 | `moodle_file_not_found` | Moodle findet die Datei zu `ref` nicht (`filenotfound`) |
| 400 | `moodle_file_ref_invalid` | `ref` zeigt nicht auf `webservice/pluginfile.php` der Instanz |
| 404 | `moodle_action_not_found` | Unbekannte Aktionskennung |
| 409 | `moodle_confirmation_required` | Aktion braucht Bestätigung, Code fehlt |
| 409 | `moodle_confirmation_invalid` | Code abgelaufen, schon benutzt oder für andere Aktion/Parameter |
| 404 | `moodle_link_not_found` | Kurs ist keinem Modul zugeordnet (`DELETE /moodle/links/{course_id}`, `POST /moodle/sync` mit `course_id`) |
| 409 | `moodle_link_disabled` | Kurs ist zugeordnet, aber der Abgleich ist ausgeschaltet (`sync_enabled = false`): `POST /moodle/sync` mit `course_id`. Es wird nichts angestoßen |
| 404 | `moodle_item_not_found` | Unbekannte Moodle-Datei (`PATCH /moodle/items/{id}`) |

### 9.2 Lese-Endpunkte

Alle unter `/api/v1/moodle`. Antworten in eigenen Formaten (Schema-Namen in Klammern). Zeitangaben ISO 8601 UTC, Moodle-IDs als Integer.

| Endpunkt | Antwort | Moodle-Funktionen |
|---|---|---|
| `GET /moodle/status` | `MoodleStatus` | `core_webservice_get_site_info` (höchstens alle 5 min, sonst Zwischenspeicher) |
| `GET /moodle/courses` | `MoodleCourseList` | `core_enrol_get_users_courses` |
| `GET /moodle/courses/{course_id}/contents` | `MoodleCourseContents` | `core_course_get_contents` |
| `GET /moodle/assignments?course_id` | `MoodleAssignmentList` | `mod_assign_get_assignments` |
| `GET /moodle/assignments/{assignment_id}/submission` | `MoodleSubmissionStatus` | `mod_assign_get_submission_status` |
| `GET /moodle/forums?course_id` | `MoodleForumList` | `mod_forum_get_forums_by_courses` |
| `GET /moodle/forums/{forum_id}/discussions` | `MoodleDiscussionList` | `mod_forum_get_forum_discussions` |
| `GET /moodle/discussions/{discussion_id}/posts` | `MoodlePostList` | `mod_forum_get_discussion_posts` |
| `GET /moodle/deadlines?from&limit` | `MoodleDeadlineList` | `core_calendar_get_action_events_by_timesort` |
| `GET /moodle/grades?course_id` | `MoodleGradeList` | `gradereport_user_get_grade_items` |
| `GET /moodle/quizzes?course_id` | `MoodleQuizList` | `mod_quiz_get_quizzes_by_courses` |
| `GET /moodle/notifications?limit` | `MoodleNotificationList` | `message_popup_get_popup_notifications` |
| `GET /moodle/file?ref` | Datei (Stream, `Content-Length` von Moodle, Sicherheits-Header siehe unten) | `webservice/pluginfile.php` |

`ref` ist der Pfad hinter `pluginfile.php`, wie er in `MoodleFile.ref` steht, z. B. `/123/mod_resource/content/4/01-Einfuehrung.pdf`. Ohne `course_id` gelten Listen für alle Kurse des Nutzers.

**Ergänzungen (T1-22/T1-23, VERTRAEGE §17.1):**
- `GET /moodle/file` liefert nur bekannte Dateien: aus Kursinhalt, Aufgaben-Intro, eigener Abgabe und Forenanhängen (im Speicher) sowie dauerhaft alle `moodle_item.file_ref`. Ein unbekannter `ref` → `404 moodle_file_not_found` mit `details.reason = "unknown_ref"`.
- Zu große Antworten → `502 moodle_unreachable` mit `details.reason = "too_large"`. Grenzen: JSON 16 MiB, Datei 512 MiB, `limit` 1–50 (Standard 20), `from` Standard „jetzt“.
- Ein `ref` ist höchstens 2.048 Zeichen lang. Längere sind ungültig (`400 moodle_file_ref_invalid`) und kommen nie in die Liste der bekannten Dateien.
- Beim Abbruch durch die Web-App (Anfrage geschlossen, bevor die Antwort fertig ist) bricht auch der Abruf bei Moodle ab (§9.1).
- `MoodleCourse.module_id` ist die bestätigte Zuordnung. Dazu kommen `suggested_module_id` und `category` (`aktuell`/`organisatorisch`/`alt`, §9.4).

**Sicherheits-Header für `GET /moodle/file`:** Dateien aus Moodle stammen auch von anderen Personen (z. B. Forenanhänge). Sie dürfen nie als aktive Inhalte im Origin des Core laufen, sonst könnte ein Skript Vorschau und Ausführen ohne Klick auslösen. Darum immer `X-Content-Type-Options: nosniff` und `Content-Security-Policy: sandbox`. `Content-Type` wird nur für eine Allowlist übernommen (`application/pdf`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `text/plain`). Alles andere, ausdrücklich auch HTML und SVG, geht als `application/octet-stream` mit `Content-Disposition: attachment`.

**Prüfung `Content-Security-Policy: sandbox` und PDF-Viewer (Issue #129, H8):** Der eingebaute Viewer von Google Chrome 153 zeigt ein PDF mit genau diesen Headern an, sowohl beim direkten Öffnen als auch eingebettet per `<iframe>` und `<object>` (Prüfung am 05.11.2026, Chrome for Testing 153, mit Anzeige unter Xvfb). Die Anpassung von §9.2 ist für Chrome nicht nötig. **Safari wurde nicht geprüft** (nicht verfügbar in dieser Umgebung), das bleibt vor T1-25 offen.

### 9.3 Aktionen

| Endpunkt | Body | Antwort |
|---|---|---|
| `GET /moodle/actions` | – | `MoodleActionCatalog` |
| `POST /moodle/uploads` | multipart, eine Datei (≤ 100 MB) | `MoodleUpload` |
| `POST /moodle/actions/{action_id}/preview` | `MoodleActionRequest` | `MoodleActionPreview` |
| `POST /moodle/actions/{action_id}/execute` | `MoodleActionExecute` | `MoodleActionResult` |

- **Uploads:** Dateien für Aktionen (z. B. die Lösung als PDF) werden zuerst zum Core hochgeladen und liegen unter `tmp/moodle-uploads/<upload_id>`. Aktionen verweisen über `upload_ids`. Uploads verfallen nach 24 h. Kein Pfad aus dem Dateisystem wird als Parameter angenommen.
- **Vorschau** ist für jede Aktion erlaubt, auch ohne Bestätigungspflicht (z. B. um den Text vorher zu zeigen). Sie verändert nichts in Moodle.
- **Bestätigungscode:** zufällig (128 bit, base64url), gebunden an `action_id` + SHA-256 der kanonischen Parameter (Schlüssel sortiert), gültig 5 min, einmal verwendbar, nur im Speicher des Core. Ein Neustart des Core macht alle Codes ungültig.
- **Ausführen** mit Risiko `endgueltig`/`oeffentlich` ohne Code → `409 moodle_confirmation_required`, mit abgelaufenem, benutztem oder fremdem Code → `409 moodle_confirmation_invalid`. Mit Risiko `harmlos`/`aenderbar` wird ein mitgeschickter Code ignoriert, außer bei Verschärfung im Einzelfall (nächster Punkt).
- **Verschärfung im Einzelfall:** Ein Handler darf für bestimmte Parameter zusätzlich eine Bestätigung verlangen (nie weniger). Pflichtfall: `assign.save_draft` bei Aufgaben ohne Einreichen-Schritt (`requires_submit = false`), denn dort gilt Speichern in Moodle sofort als Abgabe. Die Vorschau warnt dann und liefert einen Code. Der Katalog zeigt `needs_confirmation` nur nach Risiko: Die Web-App muss daher bei jeder Aktion mit `409 moodle_confirmation_required` rechnen und dann den Vorschau-Dialog zeigen.
- **Idempotenz:** `execute` beachtet `Idempotency-Key` (08 §1). So schickt ein doppelter Klick nichts zweimal ab.

**Parameter je Aktion** (Schema `MoodleActionParams<Name>`)

| Aktion | Parameter | Moodle-Funktionen |
|---|---|---|
| `assign.save_draft` | `assignment_id`, `upload_ids?`, `online_text_html?` (mindestens eins) | `webservice/upload.php`, `mod_assign_save_submission` |
| `assign.submit` | `assignment_id`, `accept_statement` (Pflicht, `true`, wenn die Aufgabe eine Erklärung verlangt) | `mod_assign_get_submission_status`, `mod_assign_submit_for_grading` |
| `forum.create_discussion` | `forum_id`, `subject`, `message_html`, `upload_ids?` | `mod_forum_add_discussion` |
| `forum.reply` | `post_id`, `subject?`, `message_html`, `upload_ids?` | `mod_forum_add_discussion_post` |
| `completion.set` | `cmid`, `completed` | `core_completion_update_activity_completion_status_manually` |
| `calendar.create_event` | `name`, `start_at`, `duration_minutes?`, `description_html?` | `core_calendar_submit_create_update_form` |
| `message.send` | `to_user_id`, `text` | `core_message_send_instant_messages` |
| `notifications.mark_read` | – | `core_message_mark_all_notifications_as_read` |
| `files.upload_private` | `upload_ids` | `webservice/upload.php`, `core_user_add_user_private_files` |

### 9.4 Abgleich (F-MDL-04)

Der Abgleich läuft **im Core** (er braucht den Token), nicht im Worker. Für jede übernommene PDF legt er wie beim Upload einen Foliensatz bzw. ein Übungsblatt an und erzeugt den Job `pdf.ingest`. Tabellen (Core, Migration mit T1-23):

| Tabelle | Inhalt |
|---|---|
| `moodle_course_link` | `module_id`, `moodle_course_id` (eindeutig), `sync_enabled`, `last_synced_at`, `auto` (#141) |
| `moodle_course_decided` | `moodle_course_id` (eindeutig), `reason`: schon entschieden, die Automatik behandelt jeden Kurs genau einmal (#141) |
| `moodle_item` | `moodle_course_id`, `cmid`, `file_ref` (eindeutig), `timemodified`, `size_bytes`, `sha256`, `kind` (`folien`/`uebung`/`ignoriert`/`offen`), `slide_deck_id?`, `exercise_sheet_id?`, `removed_in_moodle_at?` |
| `moodle_deadline` | `moodle_event_id` bzw. `assignment_id`, `module_id`, `name`, `due_at`, `exercise_sheet_id?` |

Ergänzende Spalten, Endpunkte und Ablauf: VERTRAEGE §17. Kurz:
- **Zuordnung (F-MDL-03):** `GET /moodle/links`, `PUT`/`DELETE /moodle/links/{course_id}`, `DELETE /moodle/links/{course_id}/module` („Modul entfernen“), `POST /moodle/auto-assign` (automatische Zuordnung). Ein Vorschlag ist keine Zuordnung.
- **Automatische Zuordnung (#141, Abweichung von F-MDL-03 auf Wunsch des Owners):** Beim Abgleich und auf `POST /moodle/auto-assign` (Web-App beim Öffnen von Einstellungen › Moodle) werden aktuelle Kurse ohne Zuordnung sicher passenden Modulen zugeordnet bzw. bekommen ein neues Modul im aktuellen Semester. Unsicher oder mehrdeutig: keine Automatik. Jeder Kurs wird genau einmal behandelt. Ohne aktuelles Semester: nichts. „Lösen“ gilt dauerhaft. Details: VERTRAEGE §17.7. Kurse, die mehr als 30 Tage vor dem Beginn des aktuellen Semesters starten (`SEMESTER_START_TOLERANCE_DAYS`), gelten als `alt` und werden wie organisatorische Kurse nicht vorgeschlagen.
- **Abgleich:** `GET`/`POST /moodle/sync`, Ergebnis `MoodleSyncStatus`. Immer nur ein Lauf gleichzeitig. Beim Beenden des Core bricht er zwischen zwei Dateien ab.
- **Inbox:** bis Phase 2 über `moodle_item.kind = offen` (`GET /moodle/items?kind=offen`, Entscheidung per `PATCH /moodle/items/{id}`). Danach wechselt sie zu `inbox_item`. Musterlösungen landen in der Inbox, nicht als Übungsblatt.
- **Fristen:** `GET /moodle/synced-deadlines`.
- **Sichtbarkeit:** Dateien und Fristen erscheinen nur für zugeordnete Kurse mit eingeschaltetem Abgleich.
- **Listen und Zugang:** Listen ohne Cursor, mit `limit`. Diese Endpunkte sind lokal und antworten auch ohne Moodle-Zugang (§9.1).
- **Neue Revision:** Eine neue Revision im Dateipfad (`…/content/<rev>/…`) ergibt einen neuen `file_ref` und damit eine neue Datei. Die alte gilt dann als „in Moodle entfernt“.
