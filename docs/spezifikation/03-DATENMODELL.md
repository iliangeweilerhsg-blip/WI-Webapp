# 03 · Datenmodell

## 1. Allgemeine Regeln

| Regel | Festlegung |
|---|---|
| IDs | **UUIDv7** (zeitlich sortierbar). Clients (iPad, Web) dürfen IDs selbst erzeugen, damit offline angelegte Objekte sofort referenzierbar sind. Immer in Kleinbuchstaben mit Bindestrichen; der Server normalisiert nicht. |
| Pflichtfelder jeder Tabelle | `id`, `user_id`, `created_at`, `updated_at`, `deleted_at` (NULL = aktiv) |
| Löschen | Immer **weich** (`deleted_at` setzen). Endgültiges Löschen nach 30 Tagen durch einen nächtlichen Job (Papierkorb, F-DAT-04). |
| Zeitstempel | `timestamptz` in UTC. Zeitpunkte innerhalb einer Session zusätzlich als `t_ms` (Sitzungszeit, `int8`). |
| Texte | UTF-8, Sprache pro Inhalt in `lang` (`de`, `en`, `mixed`) |
| Embeddings | `vector(1024)` (bge-m3), Index: HNSW, Cosinus |
| Versionierung | Tabellen mit konfliktträchtigen Feldern haben `version int` (optimistisches Sperren) |
| JSON | `jsonb` nur für klar abgegrenzte, schemageprüfte Nutzlasten (Schemas in `packages/schemas`) |
| Notation | Die Tabellendefinitionen unten sind Pseudo-SQL. Spalten ohne `not null` sind optional (`NULL` erlaubt); explizites `NULL` steht nur zur Betonung bei optionalen Fremdschlüsseln und Feldern. |

## 2. Überblick

```
semester 1─n module 1─n calendar_event 1─0..1 session
                 │                               │
                 ├─n slide_deck 1─n slide ◄──────┼── slide_event (n)
                 │                    ▲          ├── recording 1─n audio_chunk
                 │                    │          ├── transcript_segment (n)
                 ├─n exercise_sheet 1─n task ────┤   slide_segment (n)  ← Ausrichtung
                 │          task_slide_link (n─m)├── marker (n)
                 │                               ├── photo (n)
                 ├─n exam                        └── notebook 1─n page 1─n stroke
                 └─n past_exam 1─n past_exam_question        page 1─n page_element

concept n─m concept (concept_relation) · concept 1─n evidence → (slide | transcript_segment |
        page-Bereich | task | photo) · concept n─m module (concept_module)
concept 1─n card 1─1 card_state · card 1─n review_log · review_log 0..1─1 error_record
inbox_item → schlägt Änderungen an concept / relation / card / slide_segment / marker vor
study_block → (session | concept[] | card-Menge | exam | task) · video → concept
job · cost_entry · device · backup_run · setting · search_chunk
```

## 3. Organisation

```sql
semester(            -- z. B. „HS 2026"
  name text, starts_on date, ends_on date, is_current bool)

module(              -- Lehrveranstaltung
  semester_id → semester, name text, short_name text,      -- „Datenbanksysteme", „DBS"
  color text,                                               -- Token aus der Palette, nicht frei
  ects numeric, exam_type text,                             -- schriftlich|mündlich|Projekt|…
  lecturer text, lang text,
  description_md text,                                      -- aus Modulbeschreibung (F-KAL-04)
  settings jsonb default '{}')                              -- Modul-Einstellungen (W-06): Layout und Spaltenbreiten (F-DSH-01),
                                                            -- Schreibmodus (F-INK-03); Schema ModuleSettings in packages/schemas

calendar_source(
  kind text,            -- ics_file | ics_url | google
  url text, last_synced_at timestamptz, readonly bool default true)

calendar_event(       -- Termin
  source_id → calendar_source NULL,   -- NULL = manuell
  external_uid text,                  -- UID aus ICS/Google, für Abgleich
  module_id → module NULL,            -- Zuordnung automatisch (F-KAL-02) oder manuell
  kind text,            -- vorlesung | uebung | tutorium | pruefung | fest | lernblock_export
  title text, location text,
  starts_at timestamptz, ends_at timestamptz,
  recurrence_id text NULL, cancelled bool default false)

session(              -- Durchführung eines Termins
  calendar_event_id → calendar_event NULL,   -- NULL = spontane Session
  module_id → module,
  slide_deck_id → slide_deck NULL,           -- NULL = folienloser Modus
  number int,                                -- VL-Nummer im Modul (VL 7)
  title text,
  state text,          -- siehe Zustandsautomat F-SES-01
  started_at timestamptz, ended_at timestamptz,
  stop_reason text,    -- manuell | kalenderende | stille | maximaldauer | absturz_wiederhergestellt
  started_from text,   -- mac | ipad
  processing jsonb,    -- Fortschritt der Pipeline-Schritte {step: status}
  review_state text,   -- offen | in_arbeit | erledigt   (Nacharbeitung, F-NAC-05)
  start_offsets jsonb default '[]',   -- [{device_id, offset_ms}]: abweichender Offline-Start (VERTRAEGE §9.3)
  auto_stop_extended_until timestamptz NULL)   -- „weiter aufnehmen“ (F-SES-03)
```

## 4. Material

```sql
slide_deck(
  module_id → module, session_id → session NULL,
  title text, file_path text, sha256 text, page_count int,
  uploaded_at timestamptz, ingest_state text)       -- neu | verarbeitet | fehler

slide(
  deck_id → slide_deck, index int,                   -- 1-basiert
  image_path text, thumb_path text, width_pt real, height_pt real,
  text text,                                          -- Textlayer
  text_blocks jsonb,   -- [{text, bbox:[x,y,w,h]}] für Hervorhebungen in Videos & Karten
  vision_summary text NULL,                           -- wenn kein Textlayer / viel Grafik
  title text NULL, chapter text NULL,
  embedding vector(1024))

exercise_sheet(
  module_id → module, title text, number int NULL,
  file_path text, sha256 text, due_at timestamptz NULL,   -- Abgabe
  solution_file_path text NULL)                            -- Musterlösung (F-LRN-14)

task(                  -- Teilaufgabe
  sheet_id → exercise_sheet, label text,                   -- „2b"
  page_index int, bbox jsonb NULL,
  text text, solution_text text NULL,
  embedding vector(1024))

task_slide_link(
  task_id → task, slide_id → slide,
  relevance real,      -- 0..1
  reason text,         -- 1 Satz Begründung
  source text,         -- auto | manuell
  confirmed bool default false)
```

## 5. Session-Daten

```sql
slide_event(           -- Folienwechsel
  session_id → session, slide_id → slide NULL,   -- NULL im folienlosen Modus
  slide_index int, t_ms int8,
  device text, source text)    -- manuell_mac | manuell_ipad | korrektur

slide_segment(         -- Ergebnis der Ausrichtung: welche Folie lief wann
  session_id → session, slide_id → slide,
  start_ms int8, end_ms int8,
  source text,         -- log | ausrichtung | manuell
  confidence real)

recording(
  session_id → session, mime text, codec text,
  started_ms int8, duration_ms int8,
  state text)          -- laeuft | vollstaendig | mit_luecken

audio_chunk(
  recording_id → recording, seq int, start_ms int8, duration_ms int8,
  file_path text, sha256 text, received_at timestamptz)
  -- UNIQUE(recording_id, seq)

transcript_segment(
  session_id → session, start_ms int8, end_ms int8,
  text text, lang text, speaker text NULL,
  avg_logprob real, words jsonb NULL,       -- Wort-Zeitstempel, falls vorhanden
  embedding vector(1024))

marker(
  session_id → session, kind text,          -- frage | klausur | verknuepfung
  t_ms int8, page_id → page NULL, position jsonb NULL,   -- wo auf der Seite gestempelt
  source text,          -- ipad | mac | detektor
  note text NULL,
  resolved_at timestamptz NULL)              -- bei ❓: in der Nacharbeitung geklärt

photo(                  -- Tafel-Foto
  session_id → session, t_ms int8, page_id → page NULL,
  file_path text, ocr_text text NULL)
```

## 6. Handschrift

```sql
notebook(
  module_id → module, title text,
  kind text)            -- vorlesung | uebung | frei

page(
  notebook_id → notebook, session_id → session NULL,
  index int,                                    -- Reihenfolge im Notizbuch
  template text,        -- blanko | liniert | kariert | punktraster | cornell | folie
  background_slide_id → slide NULL,             -- Modus „auf die Folie schreiben"
  attached_slide_id → slide NULL,               -- freie Seite, an Folie geheftet
  width_pt real, height_pt real,
  pkdrawing_path text,  -- verlustfreie PencilKit-Kopie (nur vom iPad gelesen/geschrieben)
  version int)

stroke(                 -- neutrales Strich-Format, Kap. 08 §4
  page_id → page, client_id text,               -- vom iPad vergebene, stabile ID
  tool text,            -- pen | pencil | marker | monoline | fountain
  layer text,           -- ink | highlight (Textmarker-Ebene liegt unter der Schrift)
  color text, width real,
  t_start_ms int8, t_end_ms int8,               -- Sitzungszeit
  created_at timestamptz,                       -- absolute Zeit (synchronisierte Uhr; aus created_at (ms) des Strich-Formats umgerechnet)
  transform real[],                             -- 6 Werte (affin a,b,c,d,e,f), Standard Identität {1,0,0,1,0,0}
  bbox jsonb, points bytea,                     -- gepackte Punkte (Kap. 08 §4)
  clock_uncertain bool default false)

page_element(
  page_id → page, kind text,   -- text | image | shape | tape | stamp
  frame jsonb,                 -- [x, y, w, h] in pt (PageElement.frame, VERTRAEGE §6.1)
  payload jsonb,               -- je nach kind, Kap. 08 §4.4
  t_ms int8 NULL, z int)
```

## 7. Wissen

```sql
concept(
  name text, aliases text[],                    -- inkl. englischer Begriff
  one_liner text,                               -- „In einem Satz"
  vault_path text,                              -- Konzepte/Normalisierung (Datenbanken).md
  status text,          -- vorschlag | aktiv | zusammengefuehrt
  merged_into → concept NULL,
  exam_relevant bool default false,
  importance_base real default 1.0,
  embedding vector(1024),
  content_hash text)    -- Hash der Markdown-Datei, erkennt Änderungen aus Obsidian

concept_module(concept_id → concept, module_id → module)      -- n:m, Konzepte gehören keinem Fach allein

concept_relation(
  from_id → concept, to_id → concept,
  kind text,            -- baut_auf | beispiel_fuer | gegensatz | angewendet_in | verwandt
  source text,          -- ki | manuell | wikilink
  confidence real, confirmed bool)
  -- „A baut_auf B" heißt: B ist Voraussetzung von A

evidence(
  concept_id → concept,
  kind text,            -- slide | transcript | ink | task | photo | past_exam_question
  ref_id uuid,          -- ID des Ziels
  t_start_ms int8 NULL, t_end_ms int8 NULL,    -- für Transkript/Audio
  region jsonb NULL,                             -- Bereich auf Seite/Folie
  quote text NULL,      -- kurzes Zitat für die Anzeige
  weight real)

search_chunk(           -- einheitlicher Suchindex (F-SUC-01)
  source_kind text, source_id uuid, module_id uuid NULL,
  text text, tsv tsvector, embedding vector(1024),
  t_ms int8 NULL)
```

## 8. Inbox

```sql
inbox_item(
  kind text,      -- concept_new | concept_merge | relation | card_batch | slide_correction |
                  -- exam_hint | summary | task_link | error_insight
  session_id → session NULL, job_id → job NULL,
  payload jsonb,  -- schemageprüfter Vorschlag inkl. Belegen
  status text,    -- offen | angenommen | abgelehnt | automatisch
  decided_at timestamptz NULL,
  priority int)   -- Reihenfolge in der geführten Nacharbeitung
```

## 9. Lernen

```sql
card(
  concept_id → concept,                 -- jede Karte gehört zu genau einem Hauptkonzept
  related_concept_ids uuid[],           -- bei Zusammenhangs-Karten
  kind text,      -- basic | reverse | cloze | mc | open | calc | relation | image_occlusion | tape
  stage int,      -- 1 Erkennen · 2 Abrufen · 3 Anwenden · 4 Verknüpfen
  front jsonb, back jsonb,              -- strukturiert je kind (Kap. 08 §6)
  source_evidence_ids uuid[],           -- mind. 1 (LP8)
  origin text,    -- ki | manuell | markierung | lasso | tape | feynman | uebung
  suspended bool default false, starred bool default false)

card_state(       -- FSRS-Zustand, 1:1 zu card
  card_id → card, state text,           -- new | learning | review | relearning
  due timestamptz, stability real, difficulty real,
  elapsed_days int, scheduled_days int, reps int, lapses int,
  last_review timestamptz NULL)

review_log(
  card_id → card, reviewed_at timestamptz,
  rating int,                           -- 1 Nochmal · 2 Schwer · 3 Gut · 4 Leicht
  rating_source text,                   -- nutzer | ki_vorschlag_bestaetigt | ki_vorschlag_geaendert
  answer jsonb NULL,                    -- getippte/gesprochene Antwort
  duration_ms int, context text,        -- taeglich | lernsitzung | probeklausur | schwaeche | unterwegs
  state_before jsonb, state_after jsonb)

error_record(
  review_log_id → review_log, concept_id → concept,
  kind text,      -- verwechslung | voraussetzung_fehlt | verfahren | nur_auswendig | fluechtig
  explanation text, confused_with_concept_id uuid NULL)

learn_session(    -- unterbrechbare Lerneinheit (LP7)
  kind text,      -- lernsitzung | taeglich | schwaeche | probeklausur | feynman | uebung | nacharbeitung
  scope jsonb,    -- Konzepte/Karten/Session/Prüfung
  state jsonb,    -- Runde, Warteschlange, Zähler „zweimal richtig"
  status text,    -- laeuft | pausiert | fertig
  study_block_id → study_block NULL,
  started_at timestamptz, finished_at timestamptz NULL)

mastery_snapshot( -- täglich, für Verläufe und Prognosen
  concept_id → concept, day date, mastery real, uncertainty real)
```

## 10. Prüfungen

```sql
exam(
  module_id → module, starts_at timestamptz, kind text,
  allowed_aids text NULL,               -- „1 Formelblatt A4" → F-LRN-20
  calendar_event_id → calendar_event NULL)

past_exam(module_id → module, title text, year int NULL, file_path text)

past_exam_question(
  past_exam_id → past_exam, label text, text text, points real NULL,
  concept_ids uuid[], style text)       -- rechnen | definieren | erklaeren | anwenden | mc
```

## 11. Planung

```sql
preferences(      -- genau eine Zeile pro Nutzer
  daily_max_minutes int default 120,
  review_budget_minutes int default 20,
  min_block_minutes int default 10, max_block_minutes int default 50,
  windows jsonb,      -- erlaubte Lernzeiten je Wochentag
  peak_windows jsonb, -- „Hochleistungszeiten"
  no_study_days int[], evening_light_after time default '20:00',
  buffer_before_lecture_minutes int default 10,
  export_to_google bool default false)

study_block(
  kind text,      -- nacharbeitung | vorbereitung | wiederholung | schwaeche | uebung |
                  -- klausur | lernsitzung | probeklausur
  starts_at timestamptz, ends_at timestamptz, estimated_minutes int,
  target jsonb,   -- {session_id} | {concept_ids[]} | {exam_id} | {sheet_id}
  priority real, reason text,           -- „VL 8 baut auf Relationaler Algebra auf (45 %)"
  status text,    -- geplant | laeuft | erledigt | verpasst | verschoben
  plan_run_id → plan_run, pinned bool default false)   -- vom Nutzer fixiert

plan_run(triggered_by text, ran_at timestamptz, horizon_days int, stats jsonb)
```

## 12. Videos

```sql
video(
  concept_id → concept NULL, session_id → session NULL,
  level text,     -- v0_clip | v1_recap | v2_schwaeche
  title text, file_path text, duration_ms int,
  script_md text NULL, sources jsonb,   -- Belege je Abschnitt (LP8)
  state text,     -- geplant | rendert | fertig | fehler
  watched_at timestamptz NULL)

video_chapter(video_id → video, t_ms int8, title text, concept_id uuid NULL)
```

## 13. System

```sql
job(
  type text,      -- Kap. 05 / 08 §5
  payload jsonb, state text,            -- wartet | laeuft | fertig | fehler | abgebrochen
  priority int, attempts int, max_attempts int default 3,
  depends_on uuid[], session_id uuid NULL,
  locked_by text NULL, locked_at timestamptz NULL,
  error text NULL, result jsonb NULL,
  run_after timestamptz)                -- z. B. warten auf Internet

cost_entry(job_id → job, provider text, model text, task text,
  input_tokens int, output_tokens int, audio_seconds real, cost_estimate_eur numeric)

device(name text, kind text, token_hash text, last_seen_at timestamptz,
  clock_offset_ms int, app_version text)

backup_run(started_at timestamptz, finished_at timestamptz, target text,
  size_bytes int8, state text, error text NULL,
  files_sha256 text NULL)               -- SHA-256 der Prüfsummenliste files.sha256 (64 Hex), Vertrauensanker für media/ und vault/

setting(key text primary key, value jsonb)
```

## 14. Invarianten (MÜSSEN durch Code und Tests abgesichert sein)

1. Eine Session im Zustand `laeuft` oder `pausiert` existiert höchstens einmal gleichzeitig.
2. `audio_chunk.seq` ist pro Aufnahme lückenlos aufsteigend. Fehlende Nummern werden als Lücke im `recording.state = mit_luecken` sichtbar.
3. Jede `card` hat mindestens einen Eintrag in `source_evidence_ids` (LP8).
4. Jeder `concept_relation` vom Typ `baut_auf` erzeugt keinen Zyklus. Beim Anlegen wird geprüft. Ein Zyklus wird als Inbox-Konflikt gemeldet, nicht gespeichert.
5. Ein Konzept mit `status = zusammengefuehrt` hat `merged_into` gesetzt. Alle Belege, Karten und Relationen sind auf das Zielkonzept umgehängt.
6. `stroke.client_id` ist pro Seite eindeutig. Erneutes Senden desselben Strichs ist idempotent.
7. Benutzerbearbeitete Abschnitte einer Vault-Datei werden nie automatisch überschrieben (Kap. 08 §8).
8. `study_block` mit `pinned = true` wird von der Neuplanung nicht verschoben.
