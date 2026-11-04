# Prüfbericht zur Produktspezifikation „Studien-Gehirn" (WI-Webapp)

| | |
|---|---|
| **Geprüfte Dokumente** | `docs/spezifikation/00-UEBERSICHT.md` bis `10-UMSETZUNG.md`, `docs/FEATURE-KATALOG.md`, `docs/referenz-analysen/{README,goodnotes,quizlet,studysmarter}.md` |
| **Datum** | 04.11.2026 |
| **Prüfer** | Argon (`Gemini 4 Argon (Medium)`) |
| **Status** | Blocker B-01 bis B-07 eingearbeitet (Issue #21); ursprünglich erstellt in Issue #8 |

---

## Top 10 der wichtigsten Befunde

| Rang | ID | Einstufung | Status | Kurzbeschreibung | Fundstelle A | Fundstelle B |
|---|---|---|---|---|---|---|
| 1 | **B-01** | **Blocker** | **Eingearbeitet (#21)** (Pkt. 3 durch Konvention erledigt) | **`stroke`-Schema unvollständig:** `transform` fehlt in der DB-Tabelle; `bbox` hat widersprüchliche Typen (`jsonb` vs. `[x,y,w,h]`), `created_at` (`timestamptz` vs. `int` ms). | `03-DATENMODELL.md` §6 (`stroke`, Z. 173–181) | `08-SCHNITTSTELLEN.md` §4.1 (`Stroke`, Z. 118–132) |
| 2 | **B-02** | **Blocker** | **Eingearbeitet (#21)** | **`page.template`-Werte widersprüchlich:** „Punktraster" ist in F-INK-02 gefordert, fehlt aber in der DB-Aufzählung von `page.template`. | `03-DATENMODELL.md` §6 (`page`, Z. 166) | `04-FUNKTIONEN.md` (`F-INK-02`, Z. 276) |
| 3 | **B-03** | **Blocker** | **Eingearbeitet (#21)** | **Fehlendes Ticket & fehlender REST-Endpunkt für Vault-Export (`F-DAT-03`, P0 Phase 1):** `F-DAT-03 (Vault)` ist als P0 in Phase 1 eingestuft, fehlt aber komplett im Phase-1-Backlog (`T1-18` nennt nur `F-DAT-01, -02, -04`). | `04-FUNKTIONEN.md` (`F-DAT-03`, Z. 840–846, Z. 884) | `10-UMSETZUNG.md` §5 (`T1-18`, Z. 106) |
| 4 | **B-04** | **Blocker** | **Eingearbeitet (#21)** | **WebSocket-Sync vs. Offline-Architektur:** WS-Operationen `slide.change`, `marker.add`, `session.start/.stop` übertragen weder `t_ms` noch `started_at`; bei verspätetem Offline-Sync (F-SYN-03) oder iPad-Offline-Start (F-SES-02) gehen die echten Ereigniszeiten verloren. | `08-SCHNITTSTELLEN.md` §2.3 (Z. 67–92) | `02-ARCHITEKTUR.md` §5–6 (Z. 102–115), `03-DATENMODELL.md` §5 (Z. 117–154) |
| 5 | **B-05** | **Blocker** | **Eingearbeitet (#21)** | **Kein Schreib-Endpunkt / keine WS-Op zum Anlegen von `notebook` und zum Hochladen von `.pkdrawing`:** Das iPad soll freie Notizbücher anlegen (`F-INK-02`) und `.pkdrawing` per HTTP hochladen (`drawing.snapshot`), aber in REST existieren nur `GET /notebooks` und kein Upload-Endpunkt für `.pkdrawing`. | `04-FUNKTIONEN.md` (`F-INK-02`, Z. 274; `F-INK-14`, Z. 349) | `08-SCHNITTSTELLEN.md` §1 (Z. 27) & §2.3 (Z. 86) |
| 6 | **B-06** | **Blocker** | **Eingearbeitet (#21)** | **Audio-Format-Bruch zwischen Safari, Core und Worker:** Chrome liefert `.webm` (Opus), Safari `.mp4` (AAC). Die Dateiablage legt Chunks aber fest als `chunks/<seq>.webm` und die Gesamtdatei als `full.m4a` an (`ffmpeg concat` ohne Transcodierung scheitert bei WebM→M4A). | `04-FUNKTIONEN.md` (`F-AUD-01`, Z. 394–397) | `08-SCHNITTSTELLEN.md` §7 (Z. 230) |
| 7 | **B-07** | **Blocker** | **Eingearbeitet (#21)** (Pkt. 1 durch Konvention erledigt) | **Phase-0-Umfang für `T0-05` / `F-ORG-02` vs. Embeddings:** `F-ORG-02` stößt laut `02 §4.2` und `05 §2` nach `pdf.ingest` sofort `embed.slides` an. In `02 §7` und `T0-05` fehlt jedoch `Embedder` im Phase-0-Ticket, und in `03 §4` ist `slide.embedding` nicht als `NULL`-fähig deklariert. | `02-ARCHITEKTUR.md` §4.2 (Z. 94), `05-KI-PIPELINE.md` §2 (Z. 20) | `10-UMSETZUNG.md` §5 (`T0-05`, `T0-08`, Z. 78–81), `03-DATENMODELL.md` §4 (Z. 93) |
| 8 | **W-01** | **Wichtig** | Offen (Phase 3) | **Fehlende Referenz `docs/LERNMODELL.md` §2.7 bei Fehleranalyse (`F-LRN-06`):** Für 3 von 5 Fehlertypen (`verfahren`, `nur_auswendig`, `fluechtig`) ist die Systemreaktion nirgends in `04` oder `06` spezifiziert, da nur auf das fehlende Dokument verwiesen wird. | `04-FUNKTIONEN.md` (`F-LRN-06`, Z. 643–646) | `03-DATENMODELL.md` §9 (`error_record`, Z. 267–270), `06-LERNMODELL-PLANER.md` |
| 9 | **W-02** | **Wichtig** | Offen (Phase 2) | **Datenmodell-Lücken für Phase 2 (`concept.kind`, Block-Hashes, Ausschlussliste, `explain.questions`):** Mehrere in Pipeline (05), Lernmodell (06) und Vault (08) zwingend benötigte Felder existieren im Datenmodell (03) nicht. | `03-DATENMODELL.md` §5, §7, §8 | `05-KI-PIPELINE.md` §P7a/b, `06-LERNMODELL-PLANER.md` §2.1, `08-SCHNITTSTELLEN.md` §5 & §8.2–8.3 |
| 10 | **W-03** | **Wichtig** | Offen (Phase 3) | **Widersprüchliches Stufenschema für `open`-Karten und Deckel-Formel:** `F-LRN-01` stuft `open` als Stufe `2–3` ein; `06 §2.1` deckelt `verfahren`/`modell`-Konzepte bei `0,60`, solange keine Stufe-3-Karte richtig war, während `F-LRN-04` Stufe 3 erst freischaltet, wenn alle Stufe-2-Karten richtig waren. | `04-FUNKTIONEN.md` (`F-LRN-01`, Z. 600; `F-LRN-04`, Z. 630) | `06-LERNMODELL-PLANER.md` §2.1 (Z. 25–35) |

---

## 1. Blocker (behindern Phase 0 oder Phase 1)

### B-01 · `stroke`-Datenmodell vs. JSON-Schnittstelle (Fehlende Spalte `transform`, Typkonflikte)
- **Status:** **Eingearbeitet (Issue #21)** – Punkte 1 und 2 in `03 §6` und `08 §1` umgesetzt; Punkt 3 (`NULL`-Freigabe) **durch Konvention erledigt** (`03 §1` Notation: Spalten ohne `not null` sind optional).
- **Einstufung:** Blocker (Phase 0 `T0-02` Schemas / Phase 1 `T1-14`, `T1-16`)
- **Fundstellen:**
  - `docs/spezifikation/03-DATENMODELL.md` §6 (`stroke`, Z. 173–181)
  - `docs/spezifikation/08-SCHNITTSTELLEN.md` §4.1 (`Stroke`, Z. 118–132) & §4.3 (Z. 145)
- **Befund:**
  1. Im JSON-Format (`08 §4.1`) besitzt jeder Strich `"transform": [1,0,0,1,0,0]` für affine Transformationen durch das Lasso-Werkzeug (`04 F-INK-07`). In der DB-Tabelle `stroke` (`03 §6`) fehlt eine Spalte `transform` komplett. Gleichzeitig besagt `08 §4.3` (Z. 145), dass bei einer Lasso-Verschiebung `stroke.remove` + `stroke.add` gesendet wird – ohne `transform`-Spalte in der DB geht die Transformation beim Speichern im Core verloren (sofern die Punkte nicht vorab umgerechnet werden, wogegen `transform` im JSON spricht).
  2. `created_at` ist in `03 §6` als `timestamptz` definiert, in `08 §4.1` und `08 §2.3` (`at`) jedoch als Unix-Millisekunden-Integer (`1730707260123`), während `08 §1` (Z. 12) für die REST-API „Zeitangaben ISO 8601 UTC" vorschreibt.
  3. `t_start_ms` und `t_end_ms` sind in `08 §4.1` (Z. 127) ausdrücklich `null` ohne Session („null ohne Session"), in `03 §6` (Z. 178) fehlt jedoch die `NULL`-Freigabe (`t_start_ms int8, t_end_ms int8`).
- **Lösungsvorschlag:**
  - In `03 §6` bei `stroke` ergänzen: `transform real[6] default '{1,0,0,1,0,0}'` (oder `jsonb`) sowie `t_start_ms int8 NULL, t_end_ms int8 NULL`.
  - In `packages/schemas` verbindlich festlegen, ob Zeitstempel in WebSocket/JSON-Payloads als Epochen-Millisekunden (`int8`) oder ISO-8601-Strings übertragen werden (Empfehlung: in WS/Stroke-Payloads `int8` ms für kompakte Serialisierung, in DB Konvertierung nach `timestamptz`).

### B-02 · Fehlende Vorlage `punktraster` in `page.template`
- **Status:** **Eingearbeitet (Issue #21)** – `punktraster` in `03 §6` (`page.template`) ergänzt.
- **Einstufung:** Blocker (Phase 0 `T0-02` / Phase 1 `T1-13`)
- **Fundstellen:**
  - `docs/spezifikation/03-DATENMODELL.md` §6 (`page`, Z. 166)
  - `docs/spezifikation/04-FUNKTIONEN.md` (`F-INK-02`, Z. 276)
- **Befund:**
  `F-INK-02` fordert als Seitenvorlagen: *„blanko, liniert, kariert (5 mm), Punktraster, Cornell"*. Im Datenmodell (`03 §6`, Z. 166) sind als erlaubte Werte für `page.template` aber nur `blanko | liniert | kariert | cornell | folie` aufgeführt (`punktraster` fehlt).
- **Lösungsvorschlag:**
  Die Enum-Werte für `page.template` in `03 §6` und `packages/schemas` auf `blanko | liniert | kariert | punktraster | cornell | folie` erweitern.

### B-03 · `F-DAT-03` (Vault-Export, P0 Phase 1) hat kein Ticket in Phase 1 und keinen klaren API-Vertrag
- **Status:** **Eingearbeitet (Issue #21)** – Vault-Teil von `F-DAT-03` nach Phase 2 (`E-BIB`) verschoben (`04` und `10 §5`).
- **Einstufung:** Blocker (Phase 1 Planung / Vollständigkeit)
- **Fundstellen:**
  - `docs/spezifikation/04-FUNKTIONEN.md` (`F-DAT-03`, Z. 840–846 & Phasenübersicht Z. 884)
  - `docs/spezifikation/10-UMSETZUNG.md` §5 (`T1-18`, Z. 106)
  - `docs/spezifikation/08-SCHNITTSTELLEN.md` §1 (Z. 35)
- **Befund:**
  In `04` (Z. 841 und Z. 884) ist `F-DAT-03` zweigeteilt: `P0 (Vault) / P1 (voll) · Phase 1 / 3`, und `F-DAT-01 bis -04` stehen alle in Phase 1. Im Backlog (`10 §5`, Z. 106) deckt Ticket `T1-18` jedoch nur `F-DAT-01, -02, -04` ab – `F-DAT-03` fehlt in der Ticket-Tabelle. Zudem entsteht der Vault (`F-BIB-01`, `vault.write`) laut Phasenplan erst in **Phase 2**, sodass in Phase 1 noch gar keine Konzeptnotizen im Vault liegen.
- **Lösungsvorschlag:**
  Entweder `F-DAT-03` insgesamt nach Phase 2 (Vault-Export mit `E-BIB`) und Phase 3 (Vollexport/PDF-Paket) verschieben, oder in `T1-18` präzisieren, dass in Phase 1 `POST /export` bereits den Rohdaten-/Notizbuch-Export bereitstellt.

### B-04 · WebSocket-Operationen im Sync-Protokoll fehlen Ereigniszeitstempel (`t_ms`) und Offline-Felder
- **Status:** **Eingearbeitet (Issue #21)** – Nutzlasten und `t_ms`-Regel in `08 §2.3` ergänzt.
- **Einstufung:** Blocker (Phase 1 `T1-08`, `T1-14`, `T1-15`)
- **Fundstellen:**
  - `docs/spezifikation/08-SCHNITTSTELLEN.md` §2.3 (Z. 67–92)
  - `docs/spezifikation/02-ARCHITEKTUR.md` §5 (Z. 102–107) & §6 (Z. 114)
  - `docs/spezifikation/04-FUNKTIONEN.md` (`F-SES-02`, Z. 132; `F-SYN-03`, Z. 385)
- **Befund:**
  1. Wenn das iPad im Uni-WLAN isoliert ist (`02 §6`) und die Session offline auf dem iPad gestartet wird (`F-SES-02` Z. 132), werden `session.start`, `slide.change`, `marker.add` und `photo.add` erst bis zu 90 min später über die Ausgangswarteschlange (`F-INK-14`, `F-SYN-03`) an den Core gesendet.
  2. Im Umschlag einer WS-Operation (`08 §2.3` Z. 69) gibt es zwar `"at": 1730707260123`, aber in den Nutzlasten (`data`, Z. 87–91) für `slide.change`, `marker.add` und `photo.add` fehlt `t_ms` (Sitzungszeit), und bei `session.start` fehlen `module_id`, `calendar_event_id`, `slide_deck_id` und `started_from` (falls die `session_id` vom iPad offline als UUIDv7 erzeugt wurde).
  3. Außerdem fehlt in `08 §2.3` (Z. 89) bei `marker.add` das optionale Feld `note`, das in `03 §5` (`marker.note`, Z. 148) vorgesehen ist, sowie die Angabe von `source` (`ipad | mac`).
- **Lösungsvorschlag:**
  In `08 §2.3` verbindlich ergänzen:
  - `session.start`: `{ session_id, module_id, calendar_event_id?, slide_deck_id?, started_from: "ipad"|"mac", started_at }`
  - `slide.change`: `{ event_id, session_id, slide_id?, slide_index, t_ms, device: "ipad"|"mac" }`
  - `marker.add`: `{ marker_id, session_id, kind, t_ms, page_id?, position?, note?, source: "ipad"|"mac" }`
  - `photo.add`: `{ photo_id, session_id, t_ms, page_id?, file_ref }`

### B-05 · Fehlende REST-/Sync-Endpunkte für Notizbücher, `.pkdrawing`-Uploads und Erst-Abzug
- **Status:** **Eingearbeitet (Issue #21)** – Endpunkte in `08 §1` und Verweis in `08 §2.3` (`drawing.snapshot`) ergänzt.
- **Einstufung:** Blocker (Phase 1 `T1-08`, `T1-11`, `T1-14`)
- **Fundstellen:**
  - `docs/spezifikation/08-SCHNITTSTELLEN.md` §1 (Z. 27) & §2.3 (Z. 79–86)
  - `docs/spezifikation/04-FUNKTIONEN.md` (`F-INK-02`, Z. 274; `F-INK-14`, Z. 349–352)
- **Befund:**
  1. Laut `F-INK-02` sind neben den automatischen Notizbüchern („Vorlesung", „Übung") *„weitere frei anlegbar"*. In `08 §1` (Z. 27) existiert jedoch nur `GET /notebooks?module_id` (kein `POST /notebooks`, `PATCH /notebooks/{id}`, `DELETE /notebooks/{id}`), und auch in `08 §2.3` gibt es keine `notebook.create`-Operation.
  2. Laut `08 §2.3` (Z. 86) verweist `drawing.snapshot` auf `{ page_id, pkdrawing_ref }`, wobei die Datei *„per HTTP hochgeladen"* wird. In `08 §1` (Z. 27) fehlt jedoch der zugehörige HTTP-Endpunkt (z. B. `PUT /pages/{id}/pkdrawing` und `GET /pages/{id}/pkdrawing` für den Erst-Abzug nach Neuinstallation laut `F-INK-14` Z. 352).
  3. Ebenso fehlt `GET /photos/{id}/file` (für die Anzeige von Tafel-Fotos in der Web-App und beim iPad-Abzug).
- **Lösungsvorschlag:**
  In `08 §1` (Bereich „Notizen") ergänzen:
  - `GET/POST /notebooks` · `PATCH/DELETE /notebooks/{id}`
  - `PUT/GET /pages/{id}/pkdrawing`
  - `GET /photos/{id}/file`

### B-06 · Audio-Container- und Dateiendungs-Konflikt (`.webm` vs. `.mp4`/`.m4a`)
- **Status:** **Eingearbeitet (Issue #21)** – Chunk-Endung und AAC-Transcodierung in `04 F-AUD-01` und `08 §7` sowie Prüfpunkt in Spike `S4` (`10 §4`) ergänzt.
- **Einstufung:** Blocker (Phase 1 `T1-06`)
- **Fundstellen:**
  - `docs/spezifikation/04-FUNKTIONEN.md` (`F-AUD-01`, Z. 394–397)
  - `docs/spezifikation/08-SCHNITTSTELLEN.md` §1 (Z. 25) & §7 (Z. 230)
- **Befund:**
  - `F-AUD-01` legt fest: *„Opus in WebM (Chrome) bzw. MP4/AAC (Safari)"* und *„erzeugt nach Session-Ende eine zusammengefügte Datei (`ffmpeg concat`, Lücken als Stille mit korrekter Länge)"*.
  - `08 §7` (Z. 230) definiert die Ablage jedoch starr als `recordings/<recording_id>/chunks/<seq>.webm, full.m4a`.
  - Problem 1: Wenn Safari aufnimmt, sind die Chunks MP4/AAC (nicht `.webm`).
  - Problem 2: Wenn Chrome aufnimmt (`.webm` mit Opus), kann `ffmpeg -f concat -c copy` keinen `.m4a`-(MP4-)Container ohne Re-Encoding schreiben, da Opus in MP4/M4A von Apple-Playern/Safari oft nicht nativ unterstützt wird bzw. reines Stream-Copy fehlschlägt, wenn Stille-Segmente eingefügt werden.
  - Problem 3: Bei `PUT /recordings/{id}/chunks/{seq}` (`08 §1` Z. 25) beachten Browser-Implementierungen von `MediaRecorder.start(timeslice)`: Ab Chunk `seq >= 1` enthalten `ondataavailable`-Blobs in WebM/MP4 oft **keinen eigenen Container-Header** (nur Cluster/moof-Fragmente), sondern sind nur zusammen mit Chunk 0 oder bei Stop/Start je Chunk eigenständig abspielbar.
- **Lösungsvorschlag:**
  - Dateiendung der Chunks aus `recording.mime` ableiten (`<seq>.webm` oder `<seq>.m4a`).
  - In `audio.finalize` (`T1-06`) mit `ffmpeg` einheitlich nach `full.m4a` (AAC 48 kHz mono) transcodieren (dauert auf Apple Silicon für 90 min Audio < 5 s und löst sowohl das Stille-Einfügen als auch die Safari/iPad-Wiedergabekompatibilität).
  - Für `MediaRecorder` in `T1-06` festlegen, wie Chunks geschnitten werden (entweder Header-Chunk `seq=0` beim Concat voranstellen oder Recorder alle 30 s rotieren), und dies in Spike **S4** explizit testen.

### B-07 · Phase-0-Abgrenzung bei `F-ORG-02` (`pdf.ingest` ohne Vision vs. `embed.slides`)
- **Status:** **Eingearbeitet (Issue #21)** – Punkt 1 (`NULL`-Freigabe für `embedding`) **durch Konvention erledigt** (`03 §1` Notation); Punkt 2 in `10 §5` (`T0-08`) ergänzt.
- **Einstufung:** Blocker (Phase 0 `T0-04`, `T0-05`, `T0-08`)
- **Fundstellen:**
  - `docs/spezifikation/10-UMSETZUNG.md` §5 (`T0-05`, `T0-08`, Z. 78–81)
  - `docs/spezifikation/02-ARCHITEKTUR.md` §4.2 (Z. 94) & §7 (Z. 120–145)
  - `docs/spezifikation/05-KI-PIPELINE.md` §2 (Z. 20)
  - `docs/spezifikation/03-DATENMODELL.md` §4 (`slide`, Z. 93; `task`, Z. 104)
- **Befund:**
  1. In `03 §4` sind `slide.embedding vector(1024)` (Z. 93) und `task.embedding vector(1024)` (Z. 104) ohne `NULL` definiert. `pdf.ingest` erzeugt aber noch keine Embeddings – das macht erst der Folge-Job `embed.slides` (`05 §2`, Z. 20). Ohne `NULL`-Freigabe schlägt das Anlegen der `slide`-Zeilen in `pdf.ingest` fehl.
  2. In `10 §5` umfasst `T0-08` nur *„Folien-Upload, Zuordnung, `pdf.ingest` (ohne Vision)"* und `T0-05` nur *„Job-Schleife, Logging, LLM-Schnittstelle"*. Es ist unklar, ob `embed.slides` (lokales `bge-m3`-Modell, ~2 GB Download) schon in Phase 0 laufen soll oder erst in Phase 2 (`E-NAC` / `E-SUC`).
- **Lösungsvorschlag:**
  - In `03 §4` und `03 §5` und `03 §7` alle `embedding vector(1024)`-Spalten (`slide`, `task`, `transcript_segment`, `concept`, `search_chunk`) explizit als `vector(1024) NULL` definieren.
  - In `10 §5` (`T0-08`) klarstellen, dass in Phase 0 nur `pdf.ingest` (Seiten rendern + Textlayer extrahieren) läuft und `embed.slides` sowie Vision-Beschreibungen erst in Phase 2 aktiviert werden.

---

## 2. Wichtige Befunde (spätere Phasen 2–5 oder Architektur-Konsistenz)

### W-01 · Fehlende Datei `docs/LERNMODELL.md` hinterlässt Lücke bei Fehleranalyse-Reaktionen (`F-LRN-06`)
- **Einstufung:** Wichtig (Phase 3 `E-LRN` / `F-LRN-06`)
- **Fundstellen:**
  - `docs/spezifikation/04-FUNKTIONEN.md` (`F-LRN-06`, Z. 643–646)
  - `docs/spezifikation/03-DATENMODELL.md` §9 (`error_record`, Z. 267–270)
  - `docs/spezifikation/00-UEBERSICHT.md` (Z. 13), `06-LERNMODELL-PLANER.md` (Z. 3)
- **Befund:**
  `docs/KONZEPT.md`, `docs/STUDIENALLTAG.md` und `docs/LERNMODELL.md` werden in `00`, `01`, `04`, `06`, `FEATURE-KATALOG.md` und `referenz-analysen/` referenziert, existieren aber nicht im Repo.
  - Bei `KONZEPT.md` und `STUDIENALLTAG.md` ist das **unkritisch**, weil alle 13 Alltagsmomente (`M1–M13`) in `01 §8` und alle Architekturentscheidungen in `02` vollständig übernommen wurden.
  - Bei `docs/LERNMODELL.md` gibt es jedoch **eine echte Spezifikationslücke**: `F-LRN-06` (Z. 643) verweist für die Reaktionen auf Fehlertypen auf *„Reaktionen laut `docs/LERNMODELL.md` §2.7, z. B.:"* und nennt nur 2 der 5 Fehlertypen aus `03 §9` (`verwechslung`, `voraussetzung_fehlt`). Was bei `verfahren`, `nur_auswendig` und `fluechtig` konkret passieren soll (z. B. Stufe-3-Übungskarte vorschlagen, Feynman-Aufgabe anstoßen, keine Straf-Abwertung), steht nirgends in `04`, `05` oder `06`.
- **Lösungsvorschlag:**
  In `04-FUNKTIONEN.md` (`F-LRN-06`) oder `06-LERNMODELL-PLANER.md` eine vollständige 5-zeilige Tabelle aller `error_record.kind`-Werte (`verwechslung`, `voraussetzung_fehlt`, `verfahren`, `nur_auswendig`, `fluechtig`) mit ihrer jeweiligen Reaktion ergänzen.

### W-02 · Fehlende Felder im Datenmodell (`03`) gegenüber Pipeline (`05`), Lernmodell (`06`) und Vault (`08`)
- **Einstufung:** Wichtig (Phase 2 `E-NAC`, `E-BIB`)
- **Fundstellen:**
  - `docs/spezifikation/03-DATENMODELL.md` §5, §7, §8
  - `docs/spezifikation/05-KI-PIPELINE.md` §P7a (Z. 103, 108), §P7b (Z. 118), `06-LERNMODELL-PLANER.md` §2.1 (Z. 34)
  - `docs/spezifikation/08-SCHNITTSTELLEN.md` §5 (Z. 181), §8.2 (Z. 259), §8.3 (Z. 305)
- **Befund:**
  Mehrere fachlich wichtige Attribute werden in den Kapiteln 04, 05, 06 und 08 vorausgesetzt, fehlen aber im Datenbankschema (`03`):
  1. **`concept.kind` (`art`):** `05 §P7a` (Z. 103) extrahiert `"kind": "definition | verfahren | modell | satz | beispiel"`, `06 §2.1` (Z. 34) nutzt `Konzeptart verfahren oder modell` für den 0,60-Beherrschungs-Deckel, und `08 §8.2` (Z. 259) schreibt `art: verfahren` ins Vault-Frontmatter. In `03 §7` (`concept`, Z. 192–201) fehlt die Spalte `kind text` jedoch!
  2. **`concept` Block-Hashes:** `08 §8.3` (Z. 305) verlangt *„Hash pro Block in der Datenbank"* für die 4 `<!-- sg:auto:<name> -->`-Blöcke (`einsatz`, `fehler`, `zusammenhaenge`, `belege`), um manuelle Änderungen in App-Blöcken zu erkennen (`F-BIB-01` Z. 505). `03 §7` (Z. 201) hat aber nur ein einzelnes `content_hash text` für die gesamte Datei.
  3. **Erklärungen zu ❓-Markern (`explain.questions`):** `04 F-NAC-05` (Schritt 1, Z. 464) und `08 §5` (Z. 181) sehen vor, dass der Job `explain.questions` KI-Erklärungen mit Quellen zu jedem ❓-Marker für Schritt 1 der Nacharbeitung erzeugt. In `03 §5` (`marker`, Z. 144–150) gibt es aber kein Feld (z. B. `explanation jsonb NULL`) und auch keinen passenden `inbox_item.kind` dafür.
  4. **Bezug `marker` ↔ `concept`:** `06 §2.3` (Z. 52, 55) berechnet `Importance(K)` aus *„Anzahl ⚠️-Marker mit Bezug zu K"* und *„Anzahl offener ❓ zu K"*, und `05 §P7b` (Z. 120) verknüpft Detektor-Marker mit einem Konzept. In `03 §5` (`marker`, Z. 144–150) fehlt jedoch `concept_id → concept NULL` (oder `concept_ids uuid[]`).
  5. **Ausschlussliste für Klausurhinweis-Detektor (`F-NAC-07`):** Laut `04 F-NAC-07` (Z. 486) und `05 §P7b` (Z. 118) kommen verworfene Treffer auf eine Ausschlussliste. Dafür fehlt ein Speicherort (z. B. `marker.dismissed bool` oder ein Schlüssel in `setting`).
- **Lösungsvorschlag:**
  Im Datenmodell (`03`) ergänzen:
  - `concept`: `kind text` (`definition | verfahren | modell | satz | beispiel`) und `block_hashes jsonb`
  - `marker`: `concept_id → concept NULL`, `explanation jsonb NULL` (mit Text + Belegen für ❓)

### W-03 · Stufen-Zuordnung und Freischaltlogik bei Karten (`F-LRN-01`, `F-LRN-04`, `06 §2.1`)
- **Einstufung:** Wichtig (Phase 3 `E-LRN`)
- **Fundstellen:**
  - `docs/spezifikation/04-FUNKTIONEN.md` (`F-LRN-01`, Z. 594–605; `F-LRN-04`, Z. 630)
  - `docs/spezifikation/06-LERNMODELL-PLANER.md` §2.1 (Z. 25–35)
  - `docs/spezifikation/05-KI-PIPELINE.md` §P10 (Z. 141)
- **Befund:**
  1. In `F-LRN-01` (Z. 600) hat der Kartentyp `open` die Stufe `2–3`. In `03 §9` (`card.stage int`, Z. 247) muss jede Karte eine eindeutige Ganzzahl `1..4` haben. Es fehlt die Regel, wann eine `open`-Karte Stufe 2 (Abrufen/Erklären) und wann Stufe 3 (Anwenden/Transfer) erhält.
  2. Laut `05 §P10` (Z. 141) bekommt jedes Konzept mindestens eine Karte Stufe 2, aber nur `verfahren`/`modell`-Konzepte zwingend eine Karte Stufe 3 (und möglicherweise gar keine Karte Stufe 1, da MC nicht Pflicht ist). Wenn ein Konzept keine Stufe-2-Karten hat (oder diese noch in der Inbox liegen), blockiert `F-LRN-04` (Z. 630: *„Stufe 3 wird freigeschaltet, wenn die Stufe-2-Karten des Konzepts einmal richtig waren"*).
- **Lösungsvorschlag:**
  - In `05 §P10` klarstellen, dass `cards.generate` für jede erzeugte `open`-Karte explizit `stage: 2` (Verständnisfrage) oder `stage: 3` (Fall-/Anwendungsfrage) vergibt.
  - In `F-LRN-04` ergänzen: Falls für ein Konzept keine Stufe-2-Karten existieren, ist Stufe 3 sofort freigeschaltet.

### W-04 · Widersprüchliche Job-Bezeichnungen und Payloads zwischen `02`, `05` und `08`
- **Einstufung:** Wichtig (Phase 2–3 Worker-Verträge)
- **Fundstellen:**
  - `docs/spezifikation/05-KI-PIPELINE.md` §2 (Z. 20–38) & §3 (Z. 46–190)
  - `docs/spezifikation/08-SCHNITTSTELLEN.md` §5 (Z. 164–194)
  - `docs/spezifikation/02-ARCHITEKTUR.md` §4.2 (Z. 94) & §7 (Z. 144)
- **Befund:**
  1. **Fehlende Job-Verträge in `08 §5`:** Für mehrere KI-Funktionen aus `04` existieren gar keine Job-Typen in `08 §5`:
     - `F-ORG-05` (Musterlösung hochladen und Aufgaben zuordnen, `05 §P2` Z. 55) → kein Job `sheet.match_solution` und kein REST-Endpunkt (z. B. `POST /exercise-sheets/{id}/solution`) in `08 §1`.
     - `F-KAL-04` (Modulbeschreibung PDF/Text analysieren: ECTS, Prüfungsform, Lernziele extrahieren) → kein Job und kein Endpunkt in `08`.
     - `F-LRN-07` / `F-INK-11` (`POST /cards/from-selection` / Lasso → Karte) und `F-LRN-08` (KI-Vorschlag für Bildverdeckung) → kein `task`-Name / Job-Vertrag in `05` und `08 §5`.
     - `F-LRN-11` (`POST /mock-exams` erzeugt neue Aufgaben im Stil der Altklausuren) → kein `task`-Name in `05` und `08 §5`.
  2. **Synchrone vs. asynchrone „Jobs":** In `08 §5` stehen `grade.open` (*„synchron über Core, Timeout 3 s"*, Z. 185) und `rag.answer` (*„Streaming über Core"*, Z. 190) in der Job-Tabelle, obwohl die Architektur (`02 §1–2`) zwischen Core und Worker nur die PostgreSQL-Job-Tabelle + `LISTEN/NOTIFY` vorsieht (keine direkte HTTP/IPC-Streaming-Strecke vom Worker zum Core für SSE-Streaming in `POST /ask`).
  3. **Payload-Inkonsistenz:** `pdf.ingest` hat in `08 §5` (Z. 166) `{ slide_deck_id }`, der direkte Folge-Job `embed.slides` (Z. 167) aber `{ deck_id }`.
- **Lösungsvorschlag:**
  - Einheitliche Feldnamen in allen Job-Payloads (`slide_deck_id`, `exercise_sheet_id`).
  - Für synchrone/streamende KI-Aufrufe (`POST /grade/open` mit 3-s-Timeout, `POST /ask` mit SSE, `POST /cards/from-selection`) in `02` und `08` festlegen, ob der Core für diese latenzkritischen Einzelaufrufe das Anthropic-SDK direkt aufruft oder der Worker einen lokalen internen HTTP/Unix-Socket-Endpunkt auf `127.0.0.1` anbietet (über die DB-Tabelle ist Token-Streaming für SSE unnötig kompliziert).
  - Fehlende REST-Endpunkte `POST /exercise-sheets/{id}/solution` und `POST /modules/{id}/parse-description` in `08 §1` ergänzen.

### W-05 · `concept.importance_base` in `03` vs. `Importance(K)`-Formel in `06` vs. `importance: 1-3` in `05`
- **Einstufung:** Wichtig (Phase 2 / Phase 3)
- **Fundstellen:**
  - `docs/spezifikation/03-DATENMODELL.md` §7 (`concept`, Z. 199: `importance_base real default 1.0`)
  - `docs/spezifikation/05-KI-PIPELINE.md` §P7a (Z. 106: `"importance": 1-3`)
  - `docs/spezifikation/06-LERNMODELL-PLANER.md` §2.3 (Z. 50: `Importance(K) = 1,0 + …`)
- **Befund:**
  `05 §P7a` lässt das LLM pro Konzept `"importance": 1-3` schätzen. `03 §7` speichert `importance_base real default 1.0`. Die Formel in `06 §2.3` startet jedoch mit einer festen Konstante `1,0 + …` und ignoriert `concept.importance_base` komplett!
- **Lösungsvorschlag:**
  In `06 §2.3` den Startterm `1,0` durch `importance_base(K)` ersetzen und in `05 §P7a` / `P8` festlegen, wie `importance: 1..3` auf `importance_base` abgebildet wird (z. B. `1 → 0.8`, `2 → 1.0`, `3 → 1.3`).

### W-06 · `F-DSH-01` Spaltenbreiten „pro Modul gespeichert" ohne Feld im Datenmodell
- **Einstufung:** Wichtig (Phase 1 `T1-04` / `T1-19`)
- **Fundstellen:**
  - `docs/spezifikation/04-FUNKTIONEN.md` (`F-DSH-01`, Z. 189; `F-INK-03`, Z. 288; `F-EIN-01`, Z. 868)
  - `docs/spezifikation/03-DATENMODELL.md` §3 (`module`, Z. 44–49)
- **Befund:**
  Sowohl die Layout-Wahl/Spaltenbreiten im Live-Dashboard (`F-DSH-01` Z. 189) als auch der Standard-Schreibmodus auf dem iPad (`F-INK-03` Z. 288, `F-EIN-01` Z. 868) werden **pro Modul** gespeichert. In der Tabelle `module` (`03 §3`) gibt es dafür jedoch keine Spalten (z. B. `default_layout jsonb`, `default_ink_mode text`).
- **Lösungsvorschlag:**
  Entweder `module` in `03 §3` um `settings jsonb default '{}'` erweitern oder in `03 §13` festlegen, dass modulspezifische Einstellungen über strukturierte Schlüssel in `setting` (z. B. `module:<id>:layout`) gespeichert werden.

### W-07 · `F-PLN-07` Selbstauskunft für Ziel Z1 hat keinen Speicherort
- **Einstufung:** Wichtig (Phase 4 `E-PLN`)
- **Fundstellen:**
  - `docs/spezifikation/01-PRODUKT.md` §4 (`Z1`, Z. 40)
  - `docs/spezifikation/04-FUNKTIONEN.md` (`F-PLN-07`, Z. 770)
  - `docs/spezifikation/03-DATENMODELL.md` §3 (`session`, Z. 64–75)
- **Befund:**
  Im Tagesabschluss (`F-PLN-07`) wird zur Messung von Ziel `Z1` gefragt: *„Heute in der Vorlesung eine andere App gebraucht? ja/nein"*. Weder in `session` noch in einer Tagesabschluss-Tabelle gibt es ein Feld, um diese Antwort für den Wochenrückblick zu speichern.
- **Lösungsvorschlag:**
  In `session` (`03 §3`) ein optionales Feld `used_other_app bool NULL` ergänzen.

### W-08 · Abdeckband-Bewertung: „Nochmal/Gut" (`F-INK-10`) vs. 4-stufiges FSRS (`06 §1`)
- **Einstufung:** Wichtig (Phase 3 `F-INK-10`, `F-LRN-09`)
- **Fundstellen:**
  - `docs/spezifikation/04-FUNKTIONEN.md` (`F-INK-10`, Z. 329; `F-LRN-09`, Z. 662)
  - `docs/referenz-analysen/goodnotes.md` (Z. 8)
  - `docs/spezifikation/06-LERNMODELL-PLANER.md` §1 (Z. 16)
- **Befund:**
  Beim direkten Aufdecken eines Abdeckbands im Notizbuch (`F-INK-10` Z. 329) wird nur zweistufig nach *„Nochmal/Gut"* gefragt (ebenso beim Wischen auf dem iPad in `07 §4.4` Z. 186: *„links Nochmal, rechts Gut"*). `06 §1` (Z. 16) definiert die Abbildung auf FSRS-Ratings (1–4) zwar für automatisch bewertete Typen, erwähnt aber nicht explizit, dass im 2-Knopf-/Wisch-Modus „Nochmal" = `1` und „Gut" = `3` gesetzt wird.
- **Lösungsvorschlag:**
  In `06 §1` (Z. 16) einen Halbsatz ergänzen: *„Bei Zweifach-Auswahl (Wisch auf dem iPad, Abdeckband): Nochmal → 1, Gut → 3."*

---

## 3. Kosmetische Befunde & Kleinigkeiten

### K-01 · Modellnamen in `02-ARCHITEKTUR.md` §7
- **Einstufung:** Kosmetisch
- **Fundstellen:**
  - `docs/spezifikation/02-ARCHITEKTUR.md` §7 (Z. 144)
- **Befund:**
  In `02 §7` stehen als Beispiel-Modell-IDs `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`. Da sich API-Modellstrings der Anthropic-API ändern können, ist die Festlegung *„Zuordnung in den Einstellungen änderbar"* (Z. 144) bereits vorhanden; beim Bau von `T0-05` sollten die realen API-Modell-IDs als konfigurierbare Defaults in `config/.env` bzw. `setting` hinterlegt werden.
- **Lösungsvorschlag:**
  In `T0-05` Modell-IDs über Konfigurationskonstanten kapseln.

### K-02 · `00-UEBERSICHT.md` Lesereihenfolge vs. Bereichskürzel
- **Einstufung:** Kosmetisch
- **Fundstellen:**
  - `docs/spezifikation/00-UEBERSICHT.md` (Z. 51–70)
  - `docs/spezifikation/04-FUNKTIONEN.md` (Z. 5)
- **Befund:**
  In `00-UEBERSICHT.md` (Z. 62–67) ist die Reihenfolge der Kürzel `BIB, LRN, PLN, VID, SUC`, während `04-FUNKTIONEN.md` die Reihenfolge `BIB, SUC, LRN, PLN, VID` verwendet.
- **Lösungsvorschlag:**
  Reihenfolge in `00-UEBERSICHT.md` bei Gelegenheit an Kapitel 04 angleichen.

### K-03 · Tote Links auf `KONZEPT.md`, `STUDIENALLTAG.md` und `LERNMODELL.md`
- **Einstufung:** Kosmetisch (mit Ausnahme von **W-01**)
- **Fundstellen:**
  - `docs/FEATURE-KATALOG.md` (Z. 4, 48, 77, 88, 101)
  - `docs/referenz-analysen/README.md` (Z. 6), `quizlet.md` (Z. 8)
  - `docs/spezifikation/00-UEBERSICHT.md` (Z. 13), `01-PRODUKT.md` (Z. 98), `06-LERNMODELL-PLANER.md` (Z. 3)
- **Befund:**
  Mehrere relative Markdown-Links (`[Studienalltag](STUDIENALLTAG.md)`, `[Lernmodell](LERNMODELL.md)`) zeigen auf Dateien, die nicht im Repository liegen. Abgesehen von **W-01** (`LERNMODELL.md` §2.7) sind alle Inhalte jedoch vollständig in `docs/spezifikation/01–10` enthalten.
- **Lösungsvorschlag:**
  In `FEATURE-KATALOG.md` die Links auf die entsprechenden Kapitel unter `docs/spezifikation/` (`01-PRODUKT.md#8-alltagsmomente-kurzfassung`, `06-LERNMODELL-PLANER.md`) umbiegen.

---

## 4. Zusammenfassung der Querschnittsprüfungen

| Prüfbereich laut Issue #8 | Ergebnis |
|---|---|
| **Datenmodell (03) ↔ Schnittstellen (08)** | Grundstruktur sehr sauber; **B-01** (`stroke.transform`, `t_start_ms NULL`), **B-02** (`punktraster`), **B-04** (WS-Sync-Zeitstempel für Offline-Betrieb), **B-05** (`POST /notebooks`, `PUT /pages/{id}/pkdrawing`), **B-06** (Audio-Dateiendungen) und **W-02** (`concept.kind`, `block_hashes`, `marker.explanation`) sollten vor bzw. beim Bau der Schemas (`T0-02` / Phase 1) geklärt werden. |
| **Funktionen (04) ↔ UX (07)** | Hohe Übereinstimmung. Alle 13 Mac-Ansichten und 4 iPad-Ansichten aus `07` decken die Funktionen aus `04` und die Interaktionsregeln `R1–R18` widerspruchsfrei ab (lediglich **W-06** für die Persistenz der modulspezifischen Layout-/Schreibmodus-Wahl ergänzen). |
| **Funktionen (04) ↔ Umsetzung (10)** | Alle Phase-0-Funktionen (`F-ORG-01` bis `-04`) haben eigene Tickets (`T0-07` bis `T0-10`). In Phase 1 sind alle Funktionen durch `T1-01` bis `T1-20` abgedeckt **außer `F-DAT-03 (Vault)`** (**B-03**). Abgrenzung von `embed.slides` in Phase 0 siehe **B-07**. |
| **NFA (09) ↔ Architektur (02)** | Alle Zielwerte aus `09 §1–2` (Latenzen, 30-s-Audio-Chunks, IndexedDB-Puffer, Ausgangswarteschlange, lokales Whisper/bge-m3 auf Metal, Geräte-Token) werden durch die Architektur in `02` getragen. Einziger Punkt für Phase 2/3 ist der Streaming-/Synchron-Kanal zwischen Core und Worker für `< 3 s` Bewertung und SSE-Chat (**W-04**). |
| **Fehlende Dokumente (`KONZEPT.md`, `STUDIENALLTAG.md`, `LERNMODELL.md`)** | Behindern Phase 0 und Phase 1 **nicht**. Einzige echte Informationslücke für Phase 3 ist `docs/LERNMODELL.md` §2.7 bei `F-LRN-06` (**W-01**). |
