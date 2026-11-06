/* GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen */

/**
 * F-EIN-01 KI „automatisch annehmen“: aus, nur Beziehungen, alles mit Konfidenz ≥ 0,9
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AutoAcceptMode".
 */
export type AutoAcceptMode = ("aus" | "nur_beziehungen" | "alles_ab_0_9")
/**
 * Warum die KI nicht eingerichtet ist (VERTRAEGE §20.5)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "LlmIssue".
 */
export type LlmIssue = ("kein_schluessel" | "env_offen" | "unbekannter_anbieter")
/**
 * log: aus Folienwechseln. ohne_wechsel: Foliensatz, aber kein verwertbarer Wechsel (ganze Session auf Folie 1). folienlos: kein Foliensatz, keine Segmente
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AlignLogMode".
 */
export type AlignLogMode = ("log" | "ohne_wechsel" | "folienlos")
/**
 * UUIDv7 (03 §1), Kleinbuchstaben
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Uuid".
 */
export type Uuid = string
/**
 * Sitzungszeit in ms seit session.started_at (02 §5). Clients setzen negative Werte (Uhrversatz) auf 0.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionMs".
 */
export type SessionMs = number
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Appearance".
 */
export type Appearance = ("hell" | "dunkel" | "system")
/**
 * SHA-256, hex, Kleinbuchstaben
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Sha256".
 */
export type Sha256 = string
/**
 * ISO 8601, UTC
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Timestamp".
 */
export type Timestamp = string
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AudioCodec".
 */
export type AudioCodec = ("opus" | "aac")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "RecordingState".
 */
export type RecordingState = ("laeuft" | "vollstaendig" | "mit_luecken")
/**
 * fehlender_chunk: seq fehlt. zeitluecke: start_ms springt (z. B. Recorder neu gestartet)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AudioGapReason".
 */
export type AudioGapReason = ("fehlender_chunk" | "zeitluecke")
/**
 * [x, y, w, h] in pt
 * 
 * @minItems 4
 * @maxItems 4
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "BBox".
 */
export type BBox = number[]
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "RestoreTestState".
 */
export type RestoreTestState = ("laeuft" | "ok" | "fehler")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "RestoreTestTrigger".
 */
export type RestoreTestTrigger = ("zeitplan" | "manuell")
/**
 * Grund eines fehlgeschlagenen Restore-Tests, die Oberfläche leitet daraus die Handlungsempfehlung ab
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "RestoreTestReason".
 */
export type RestoreTestReason = ("kein_ziel" | "kein_backup" | "ziel_nicht_erreichbar" | "nicht_authentisch" | "beschaedigt" | "dateien_abweichend" | "tabellen_fehlen" | "restore_fehlgeschlagen" | "abgebrochen" | "intern")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "BackupState".
 */
export type BackupState = ("laeuft" | "fertig" | "fehler")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "BackupTrigger".
 */
export type BackupTrigger = ("zeitplan" | "manuell" | "vor_migration")
/**
 * auto: Modul und Art hat der Abgleich gesetzt und darf sie ändern. manuell: vom Nutzer gesetzt, der Abgleich ändert module_id und kind nie mehr (F-KAL-02).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarAssignment".
 */
export type CalendarAssignment = ("auto" | "manuell")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarEventKind".
 */
export type CalendarEventKind = ("vorlesung" | "uebung" | "tutorium" | "pruefung" | "fest" | "lernblock_export")
/**
 * serie: alle Termine derselben Quelle mit gleicher external_uid (F-KAL-02). einzeln: nur dieser Termin.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarUpdateScope".
 */
export type CalendarUpdateScope = ("serie" | "einzeln")
/**
 * google erst ab Phase 4 (F-KAL-03)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarSourceKind".
 */
export type CalendarSourceKind = ("ics_file" | "ics_url" | "google")
/**
 * Gerät, auf dem ein Ereignis entstanden ist
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ClientDevice".
 */
export type ClientDevice = ("mac" | "ipad")
/**
 * Spaltenbreiten Folie | Übung | Notizen in Prozent, Summe 100
 * 
 * @minItems 3
 * @maxItems 3
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ColumnWidths".
 */
export type ColumnWidths = number[]
/**
 * Art eines Konzepts (05 §P7a, W-02 Option A: concept.kind)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ConceptKind".
 */
export type ConceptKind = ("definition" | "verfahren" | "modell" | "satz" | "beispiel")
/**
 * concept.status (03 §7). vorschlag: nur als Inbox-Vorschlag, zusammengefuehrt: merged_into gesetzt (Invariante 5)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ConceptStatus".
 */
export type ConceptStatus = ("vorschlag" | "aktiv" | "zusammengefuehrt")
/**
 * Verweis auf eine Quelle, unterschieden über kind (anyOf statt oneOf, damit Zod einen typisierten Union erzeugt)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "EvidenceRef".
 */
export type EvidenceRef = (EvidenceRefSlide | EvidenceRefTranscript)
/**
 * Beziehungstyp (03 §7). „A baut_auf B“: B ist Voraussetzung von A. gegensatz und verwandt sind symmetrisch
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ConceptRelationKind".
 */
export type ConceptRelationKind = ("baut_auf" | "beispiel_fuer" | "gegensatz" | "angewendet_in" | "verwandt")
/**
 * Herkunft einer Beziehung (03 §7)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ConceptRelationSource".
 */
export type ConceptRelationSource = ("ki" | "manuell" | "wikilink")
/**
 * Layout-Vorlagen F-DSH-01
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "DashboardLayout".
 */
export type DashboardLayout = ("standard" | "folie_gross" | "notizen_gross" | "fokus")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "DeviceKind".
 */
export type DeviceKind = ("ipad" | "iphone")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookStreamId".
 */
export type NotebookStreamId = string
/**
 * Epochen-Millisekunden (UTC) nach der synchronisierten Uhr (02 §5). Nur im Sync-Protokoll und im Strich-Format (08 §1).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "EpochMs".
 */
export type EpochMs = number
/**
 * Wer die Operation erzeugt hat (vom Server gesetzt)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncOrigin".
 */
export type SyncOrigin = ("ipad" | "web" | "server")
/**
 * Seitenelement (08 §4.4), unterschieden über kind. frame [x, y, w, h] in pt. crop bei image: [x, y, w, h] relativ zum Bild (0–1), null = ganzes Bild. Phase 1 nutzt image (Tafel-Foto) und stamp (Marker-Stempel).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageElement".
 */
export type PageElement = (TextElement | ImageElement | ShapeElement | TapeElement | StampElement)
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TextSize".
 */
export type TextSize = ("s" | "m" | "l")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ShapeKind".
 */
export type ShapeKind = ("rectangle" | "ellipse" | "line" | "arrow" | "triangle" | "diamond")
/**
 * [x, y] in pt
 * 
 * @minItems 2
 * @maxItems 2
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Point2".
 */
export type Point2 = number[]
/**
 * RGBA als #RRGGBBAA
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "HexColor".
 */
export type HexColor = string
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MarkerKind".
 */
export type MarkerKind = ("frage" | "klausur" | "verknuepfung")
/**
 * Zustand des Embedders im Worker (VERTRAEGE §19.2)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "EmbedderState".
 */
export type EmbedderState = ("bereit" | "laedt" | "nicht_verfuegbar")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "IngestState".
 */
export type IngestState = ("neu" | "verarbeitet" | "fehler")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Lang".
 */
export type Lang = ("de" | "en" | "mixed")
/**
 * Warum eine Beziehung noch nicht annehmbar ist: ein Endpunkt ist noch Vorschlag bzw. wurde abgelehnt
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxBlockedReason".
 */
export type InboxBlockedReason = ("endpunkt_offen" | "endpunkt_abgelehnt")
/**
 * Art eines Inbox-Eintrags (03 §8). Weitere Arten (card_batch, slide_correction, …) kommen mit ihren Tickets
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxKind".
 */
export type InboxKind = ("concept_new" | "concept_merge" | "relation")
/**
 * Status eines Inbox-Eintrags (03 §8). automatisch: nach der Einstellung ai.auto_accept angenommen
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxStatus".
 */
export type InboxStatus = ("offen" | "angenommen" | "abgelehnt" | "automatisch")
/**
 * Schemageprüfte Nutzlast eines Inbox-Eintrags (03 §8), unterschieden über kind
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxPayload".
 */
export type InboxPayload = (InboxPayloadConceptNew | InboxPayloadConceptMerge | InboxPayloadRelation)
/**
 * Entscheidung im Abgleich (05 §P8, Band 0,75–0,88). Abbildung auf Inbox-Arten: VERTRAEGE §20.3
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ResolveVerdict".
 */
export type ResolveVerdict = ("gleich" | "teil_von" | "verwandt" | "verschieden")
/**
 * Grund eines concept_merge-Vorschlags: ki = KI-Entscheidung „gleich“, name = gleicher Name/Alias ohne Embedder (degradiert)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MergeBasis".
 */
export type MergeBasis = ("ki" | "name")
/**
 * Schreibmodus F-INK-03
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InkMode".
 */
export type InkMode = ("freie_seite" | "auf_folie")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "IsoDate".
 */
export type IsoDate = string
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "JobType".
 */
export type JobType = ("pdf.ingest" | "embed.slides" | "embed.tasks" | "sheet.split" | "match.tasks_slides" | "audio.finalize" | "transcribe" | "align.log" | "align.content" | "detect.exam_hints" | "ocr.photos" | "ocr.ink" | "concepts.extract" | "concepts.resolve" | "summary.write" | "cards.generate" | "cornell.questions" | "explain.questions" | "vault.write" | "prereq.check" | "past_exam.analyze" | "grade.open" | "grade.analyze_error" | "feynman.evaluate" | "solution.compare" | "search.index" | "rag.answer" | "video.v0" | "video.v1" | "video.v2" | "fsrs.optimize" | "maintenance.nightly")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "JobState".
 */
export type JobState = ("wartet" | "laeuft" | "fertig" | "fehler" | "abgebrochen")
/**
 * Von Whisper erkannte Sprache, ISO 639-1 (z. B. de, en)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "LanguageCode".
 */
export type LanguageCode = string
/**
 * Händigkeit: Seite der Werkzeugleiste auf dem iPad
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ToolbarSide".
 */
export type ToolbarSide = ("links" | "rechts")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MarkerSource".
 */
export type MarkerSource = ("ipad" | "mac" | "detektor")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStreamId".
 */
export type SessionStreamId = string
/**
 * Token aus der festen Palette mit 12 Tönen (07 §8), Werte in packages/ui-tokens
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ModuleColor".
 */
export type ModuleColor = ("mod-01" | "mod-02" | "mod-03" | "mod-04" | "mod-05" | "mod-06" | "mod-07" | "mod-08" | "mod-09" | "mod-10" | "mod-11" | "mod-12")
/**
 * Aktionskatalog (F-MDL-05, 08 §9.3)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionId".
 */
export type MoodleActionId = ("assign.save_draft" | "assign.submit" | "forum.create_discussion" | "forum.reply" | "completion.set" | "calendar.create_event" | "message.send" | "notifications.mark_read" | "files.upload_private")
/**
 * endgueltig und oeffentlich brauchen eine Bestätigung (F-MDL-06)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionRisk".
 */
export type MoodleActionRisk = ("harmlos" | "aenderbar" | "endgueltig" | "oeffentlich")
/**
 * Erledigt-Status einer Aktivität
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleCompletion".
 */
export type MoodleCompletion = ("offen" | "erledigt")
/**
 * Zustand des Moodle-Zugangs (F-MDL-01)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleConnectionState".
 */
export type MoodleConnectionState = ("nicht_eingerichtet" | "ok" | "laeuft_bald_ab" | "abgelaufen" | "ungueltig" | "nicht_erreichbar")
/**
 * aktuell = wird vorgeschlagen. organisatorisch (z. B. „Klausurtermine …“) und alt (Start vor dem aktuellen Semester) werden standardmäßig nicht vorgeschlagen (F-MDL-03)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleCourseCategory".
 */
export type MoodleCourseCategory = ("aktuell" | "organisatorisch" | "alt")
/**
 * Automatische Zuordnung (#141): zugeordnet = eindeutig passendes Modul, angelegt = Modul aus dem Kursnamen angelegt
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleLinkAuto".
 */
export type MoodleLinkAuto = ("zugeordnet" | "angelegt")
/**
 * Einordnung einer Datei aus Moodle (F-MDL-04). offen = wartet auf die Entscheidung in der Inbox
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleItemKind".
 */
export type MoodleItemKind = ("folien" | "uebung" | "ignoriert" | "offen")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleSubmissionState".
 */
export type MoodleSubmissionState = ("keine" | "entwurf" | "eingereicht")
/**
 * Anlass eines Abgleichs
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleSyncTrigger".
 */
export type MoodleSyncTrigger = ("start" | "zeitplan" | "manuell" | "entscheidung" | "zuordnung")
/**
 * aus = Moodle nicht eingerichtet. pausiert = Token ungültig oder abgelaufen (F-MDL-01), der Abgleich wartet auf einen neuen Token
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleSyncState".
 */
export type MoodleSyncState = ("aus" | "bereit" | "laeuft" | "pausiert")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookKind".
 */
export type NotebookKind = ("vorlesung" | "uebung" | "frei")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageTemplate".
 */
export type PageTemplate = ("blanko" | "liniert" | "kariert" | "punktraster" | "cornell" | "folie")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StrokeTool".
 */
export type StrokeTool = ("pen" | "pencil" | "marker" | "monoline" | "fountain")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StrokeLayer".
 */
export type StrokeLayer = ("ink" | "highlight")
/**
 * Affine Transformation [a, b, c, d, e, f] (CGAffineTransform): x' = a·x + c·y + e, y' = b·x + d·y + f
 * 
 * @minItems 6
 * @maxItems 6
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Transform".
 */
export type Transform = number[]
/**
 * pdf.ingest: entweder ein Foliensatz oder ein Übungsblatt (genau eine ID). Ergänzung zu 08 §5: Übungsblätter laufen über denselben Job.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PdfIngestPayload".
 */
export type PdfIngestPayload = (PdfIngestDeckPayload | PdfIngestSheetPayload)
/**
 * system = Einstellung von iPadOS übernehmen
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PencilDoubleTapAction".
 */
export type PencilDoubleTapAction = ("radierer" | "letztes_werkzeug" | "farbpalette" | "system" | "aus")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PencilSqueezeAction".
 */
export type PencilSqueezeAction = ("werkzeugpalette" | "radierer" | "system" | "aus")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PhotoMime".
 */
export type PhotoMime = ("image/heic" | "image/jpeg")
/**
 * Schritte der Kette nach dem Session-Ende (05 §2, VERTRAEGE §18.2 und §20.2). Reihenfolge = Anzeige-Reihenfolge
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PipelineStep".
 */
export type PipelineStep = ("audio.finalize" | "transcribe" | "align.log" | "concepts.extract" | "concepts.resolve" | "summary.write")
/**
 * Nacharbeitung (F-NAC-05, Phase 2)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ReviewState".
 */
export type ReviewState = ("offen" | "in_arbeit" | "erledigt")
/**
 * Warum nur Wortsuche lief. null bei mode = hybrid oder ohne Wörter
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SearchDegraded".
 */
export type SearchDegraded = (("embedder_not_ready" | "embedder_unavailable") | null)
/**
 * Treffer, unterschieden über kind (anyOf statt oneOf, damit Zod einen typisierten Union erzeugt; kind schließt sich gegenseitig aus)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SearchHit".
 */
export type SearchHit = (SearchHitSlide | SearchHitTranscript)
/**
 * Ziel eines search.index-Jobs: ein Foliensatz (Folien) oder eine Session (Transkript-Fenster)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SearchIndexScope".
 */
export type SearchIndexScope = ("deck" | "session")
/**
 * UUIDv7 (03 §1), Kleinbuchstaben
 */
export type Uuid1 = string
/**
 * Art eines Sucheintrags (search_chunk.source_kind). Konzepte, Notizen, Aufgaben, Karten und Fotos kommen mit ihren Tickets als neue Werte dazu
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SearchKind".
 */
export type SearchKind = ("slide" | "transcript")
/**
 * Zustandsautomat F-SES-01, Übergänge in docs/VERTRAEGE.md
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionState".
 */
export type SessionState = ("geplant" | "bereit" | "laeuft" | "pausiert" | "beendet" | "verpasst" | "verarbeitet")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StopReason".
 */
export type StopReason = ("manuell" | "kalenderende" | "stille" | "maximaldauer" | "absturz_wiederhergestellt")
/**
 * Schritte der Kette nach dem Session-Ende (05 §2, VERTRAEGE §18.2 und §20.2). Reihenfolge = Anzeige-Reihenfolge
 */
export type PipelineStep1 = ("audio.finalize" | "transcribe" | "align.log" | "concepts.extract" | "concepts.resolve" | "summary.write")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideEventSource".
 */
export type SlideEventSource = ("manuell_mac" | "manuell_ipad" | "korrektur")
/**
 * Herkunft (03 §5). Phase 2 erster Schnitt: nur log (align.log)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideSegmentSource".
 */
export type SlideSegmentSource = ("log" | "ausrichtung" | "manuell")
/**
 * UUIDv7 (03 §1), Kleinbuchstaben
 */
export type Uuid2 = string
/**
 * UUIDv7 (03 §1), Kleinbuchstaben
 */
export type Uuid3 = string
/**
 * Transcriber im Worker (02 §7). fake nur für CI und Linux (VERTRAEGE §18.6). Cloud-Anbieter kommen als neue Werte
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TranscriptProvider".
 */
export type TranscriptProvider = ("mlx-whisper" | "fake")
/**
 * UUIDv7 (03 §1), Kleinbuchstaben
 */
export type Uuid4 = string
/**
 * Strom (08 §2.2): notebook:<id>, session:<id> oder user
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncStreamId".
 */
export type SyncStreamId = string
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncClientKind".
 */
export type SyncClientKind = ("ipad" | "web")
/**
 * Alle Nachrichten Client → Server
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncClientMessage".
 */
export type SyncClientMessage = (SyncHello | SyncSubscribe | SyncUnsubscribe | SyncTimePing | SyncTimeOffset | SyncPing | SyncPresence | SyncOp)
/**
 * Operation (08 §2.3), unterschieden über kind. Client → Server ohne seq/origin, Server → Client mit seq und origin.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncOp".
 */
export type SyncOp = (NotebookCreateOp | PageCreateOp | PageUpdateOp | PageDeleteOp | NotebookUpdateOp | NotebookDeleteOp | NotebookRestoreOp | PageRestoreOp | StrokeAddOp | StrokeRemoveOp | ElementUpsertOp | ElementRemoveOp | DrawingSnapshotOp | SessionStartOp | SessionPauseOp | SessionResumeOp | SessionStopOp | SlideChangeOp | MarkerAddOp | MarkerRemoveOp | PhotoAddOp)
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncErrorCode".
 */
export type SyncErrorCode = ("protocol_unsupported" | "hello_required" | "hello_invalid" | "device_token_invalid" | "message_invalid" | "too_many_pending" | "op_id_reused" | "stream_mismatch" | "module_not_found" | "session_not_found" | "session_transition_invalid" | "notebook_not_found" | "notebook_kind_exists" | "page_not_found" | "page_version_conflict" | "op_not_allowed" | "session_superseded" | "internal_error")
/**
 * Server-Ereignisse (08 §2.4) an alle verbundenen Clients, ohne seq, nicht nachgeliefert
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncEvent".
 */
export type SyncEvent = (SyncSessionUpdatedEvent | SyncPresenceEvent | SyncConnectionEvent | SyncPairingEvent)
/**
 * Alle Nachrichten Server → Client
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncServerMessage".
 */
export type SyncServerMessage = (SyncWelcome | SyncSubscribed | SyncAck | SyncOp | SyncTimePong | SyncPong | SyncError | SyncEvent)
/**
 * transkribiert: neu geschrieben. unveraendert: gleicher input_hash, übersprungen. ohne_audio: keine full.m4a (altes Transkript entfernt)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TranscribeOutcome".
 */
export type TranscribeOutcome = ("transkribiert" | "unveraendert" | "ohne_audio")
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TrashKind".
 */
export type TrashKind = ("semester" | "module" | "slide_deck" | "exercise_sheet" | "calendar_source" | "session" | "notebook" | "page" | "marker" | "photo")

/**
 * GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen
 */
/**
 * Monatsbudget (F-DAT-05). Monat = Kalendermonat in Ortszeit
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AiBudgetStatus".
 */
export interface AiBudgetStatus {
month: string
/**
 * Euro (Schätzung, VERTRAEGE §20.5)
 */
spent_eur: number
/**
 * Euro (Schätzung, VERTRAEGE §20.5)
 */
budget_eur: number
/**
 * spent_eur ≥ budget_eur: KI-Jobs enden mit fehler
 */
reached: boolean
/**
 * spent_eur ≥ 80 % von budget_eur
 */
warn: boolean
}
/**
 * Einstellungen KI (F-EIN-01, VERTRAEGE §20.7). Bereich ai in setting
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AiSettings".
 */
export interface AiSettings {
/**
 * Monatsbudget in Euro, Standard 10. 0 schaltet Cloud-KI ab
 */
monthly_budget_eur: number
auto_accept: AutoAcceptMode
}
/**
 * Teil von SettingsUpdate.ai
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AiSettingsUpdate".
 */
export interface AiSettingsUpdate {
monthly_budget_eur?: number
auto_accept?: AutoAcceptMode
}
/**
 * GET /ai/status
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AiStatus".
 */
export interface AiStatus {
worker_reachable: boolean
llm: (WorkerLlmStatus | null)
budget: AiBudgetStatus
}
/**
 * KI-Anbieter des Workers (GET /health des Workers, Feld llm). Nie der Schlüssel selbst
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "WorkerLlmStatus".
 */
export interface WorkerLlmStatus {
/**
 * anthropic | fake (SG_LLM)
 */
provider: string
/**
 * true: Aufrufe möglich (Schlüssel vorhanden bzw. Fake)
 */
configured: boolean
issue: (LlmIssue | null)
}
/**
 * align.log (08 §5, VERTRAEGE §18.3)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AlignLogPayload".
 */
export interface AlignLogPayload {
session_id: Uuid
}
/**
 * job.result von align.log
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AlignLogResult".
 */
export interface AlignLogResult {
session_id: Uuid
slide_deck_id: (Uuid | null)
mode: AlignLogMode
timeline_end_ms: SessionMs
/**
 * Gelesene slide_event
 */
event_count: number
/**
 * Durchgänge (Standzeit unter 1,5 s)
 */
skipped_events: number
/**
 * slide_index ohne Folie im Foliensatz
 */
unresolved_events: number
segment_count: number
session_deleted: boolean
job_duration_ms: number
}
/**
 * Fehlerformat der REST-API (08 §1)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ApiError".
 */
export interface ApiError {
error: ApiErrorBody
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ApiErrorBody".
 */
export interface ApiErrorBody {
code: string
message: string
details?: {
[k: string]: any
}
}
/**
 * Antwort auf PUT /recordings/{id}/chunks/{seq}
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AudioChunk".
 */
export interface AudioChunk {
recording_id: Uuid
seq: number
start_ms: SessionMs
duration_ms: number
sha256: Sha256
size_bytes: number
received_at: Timestamp
/**
 * true: identischer Chunk lag schon vor (200 statt 201)
 */
duplicate: boolean
}
/**
 * Geparste Metadaten von PUT /recordings/{id}/chunks/{seq}: Header X-Start-Ms, X-Duration-Ms (Dezimalzahlen), X-Sha256 (hex des Bodys)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AudioChunkMeta".
 */
export interface AudioChunkMeta {
/**
 * Pfad {seq}, 0-basiert, lückenlos (Invariante 2)
 */
seq: number
start_ms: SessionMs
duration_ms: number
sha256: Sha256
}
/**
 * audio.finalize (08 §5)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AudioFinalizePayload".
 */
export interface AudioFinalizePayload {
recording_id: Uuid
}
/**
 * job.result von audio.finalize. state ist nie laeuft
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AudioFinalizeResult".
 */
export interface AudioFinalizeResult {
recording_id: Uuid
state: RecordingState
/**
 * Länge von full.m4a
 */
audio_duration_ms: number
chunk_count: number
missing_seqs: number[]
gaps: AudioGap[]
file_size_bytes: number
/**
 * Laufzeit des Jobs
 */
job_duration_ms: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "AudioGap".
 */
export interface AudioGap {
start_ms: SessionMs
duration_ms: number
reason: AudioGapReason
}
/**
 * GET /backups: Status und Läufe, neueste zuerst
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "BackupOverview".
 */
export interface BackupOverview {
status: BackupStatus
items: BackupRun[]
next_cursor: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "BackupStatus".
 */
export interface BackupStatus {
/**
 * null = kein Ziel eingestellt, Backups pausieren
 */
target: (string | null)
last_success_at: (Timestamp | null)
next_run_at: (Timestamp | null)
/**
 * Letztes erfolgreiches Backup älter als 3 Tage (F-DAT-01)
 */
stale: boolean
running: boolean
/**
 * Letzter automatischer oder manueller Restore-Test (F-DAT-02), null = noch keiner gelaufen
 */
restore_test: (RestoreTest | null)
}
/**
 * Ergebnis des Restore-Tests (F-DAT-02): Stand des eigenen Backups in eine Wegwerf-Datenbank einspielen, Objekte zählen, aufräumen
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "RestoreTest".
 */
export interface RestoreTest {
state: RestoreTestState
trigger: RestoreTestTrigger
started_at: Timestamp
/**
 * null solange der Test läuft
 */
finished_at: (Timestamp | null)
/**
 * Getesteter Stand, null wenn keiner gefunden wurde
 */
stand: (string | null)
/**
 * true = der getestete Stand war zum Testzeitpunkt der jüngste erfolgreiche Lauf, false = ein älterer (der jüngste ließ sich nicht testen), null = unbekannt (läuft noch oder kein Stand gewählt)
 */
is_latest: (boolean | null)
/**
 * Nur bei state = fehler
 */
reason: (RestoreTestReason | null)
/**
 * Technischer Fehlertext (ohne Zugangsdaten und Datenordner), nur bei state = fehler
 */
error: (string | null)
}
/**
 * Ein Backup-Lauf (03 §13 backup_run)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "BackupRun".
 */
export interface BackupRun {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
started_at: Timestamp
finished_at: (Timestamp | null)
/**
 * Absoluter Pfad des Ziels
 */
target: string
size_bytes: (number | null)
state: BackupState
error: (string | null)
trigger: BackupTrigger
/**
 * Name des Stands für sg restore <stand>, z. B. 20261104T030012Z. null solange er läuft oder bei Fehler
 */
stand: (string | null)
/**
 * Warnung zum Lauf, z. B. ein alter Stand, der sich seit mehreren Läufen nicht aus dem Ziel entfernen lässt (VERTRAEGE §13). null = keine
 */
warning: (string | null)
}
/**
 * Termin. session_id ist abgeleitet: die nicht gelöschte Session zu diesem Termin.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarEvent".
 */
export interface CalendarEvent {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
source_id: (Uuid | null)
/**
 * UID aus der Quelle, null bei manuellen Terminen
 */
external_uid: (string | null)
/**
 * Kennung des Vorkommens: ISO 8601 mit Offset der Ortszeit (2026-10-20T10:15:00+02:00) bzw. Datum (2026-11-01) bei ganztägigen Serien. null bei Einzelterminen. Abgleichschlüssel: (source_id, external_uid, recurrence_id)
 */
recurrence_id: (string | null)
module_id: (Uuid | null)
kind: CalendarEventKind
assigned_by: CalendarAssignment
title: string
location: (string | null)
/**
 * DESCRIPTION aus der Quelle. Ergänzung zu 03 §3
 */
description: (string | null)
starts_at: Timestamp
ends_at: Timestamp
/**
 * Ganztägig (VALUE=DATE). starts_at/ends_at sind dann 00:00 UTC des Datums (wie tests/fixtures/ics/08). Ergänzung zu 03 §3
 */
all_day: boolean
cancelled: boolean
session_id: (Uuid | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarEventList".
 */
export interface CalendarEventList {
items: CalendarEvent[]
next_cursor: (string | null)
}
/**
 * PATCH /calendar/events/{id}. Setzt assigned_by=manuell. scope fehlt = serie. Antwort: CalendarEventList mit allen geänderten Terminen.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarEventUpdate".
 */
export interface CalendarEventUpdate {
module_id?: (Uuid | null)
kind?: CalendarEventKind
scope?: CalendarUpdateScope
}
/**
 * Antwort auf POST /calendar/reassign (lokal): Neuzuordnung aller Termine mit assigned_by=auto, z. B. nach dem Anlegen eines Moduls.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarReassignResult".
 */
export interface CalendarReassignResult {
/**
 * Termine, deren Modul oder Art sich geändert hat
 */
changed: number
/**
 * Nicht abgesagte automatisch zugeordnete Termine ohne Modul danach
 */
ohne_modul: number
}
/**
 * Kalenderquelle
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarSource".
 */
export interface CalendarSource {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
kind: CalendarSourceKind
/**
 * Anzeigename. Ergänzung zu 03 §3. Standard: Dateiname bzw. Host der URL
 */
name: string
/**
 * Nur bei ics_url (webcal:// wird als https:// gespeichert)
 */
url: (string | null)
last_synced_at: (Timestamp | null)
/**
 * Fehler des letzten Abgleichs, null nach Erfolg. Ergänzung zu 03 §3
 */
last_error: (string | null)
readonly: boolean
/**
 * Abgeleitet: Termine dieser Quelle (ohne gelöschte)
 */
event_count: number
}
/**
 * JSON-Body von POST /calendar/sources für eine ICS-URL. Eine ICS-Datei kommt stattdessen als multipart (Felder file, name). Antwort: IcsImportResult.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarSourceCreate".
 */
export interface CalendarSourceCreate {
id?: Uuid
/**
 * ICS-URL (Abo, Abgleich alle 6 h und beim Start)
 */
url: string
name?: string
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CalendarSourceList".
 */
export interface CalendarSourceList {
items: CalendarSource[]
next_cursor: (string | null)
}
/**
 * Konzept (03 §7). Gehört keinem Fach allein (concept_module). Ohne embedding, vault_path und block_hashes (kommen mit dem Vault)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Concept".
 */
export interface Concept {
id: Uuid
created_at: Timestamp
updated_at: Timestamp
/**
 * NFC, getrimmt, Leerraum zusammengefasst, ohne Steuerzeichen
 */
name: string
/**
 * weitere Namen, z. B. der englische Begriff (05 §1 Sprache)
 * 
 * @maxItems 20
 */
aliases: string[]
kind: (ConceptKind | null)
/**
 * „In einem Satz“
 */
one_liner: (string | null)
status: ConceptStatus
merged_into: (Uuid | null)
exam_relevant: boolean
/**
 * Startwert der Wichtigkeit (W-05: importance 1|2|3 → 0,8|1,0|1,3)
 */
importance_base: number
}
/**
 * GET /concepts/{id}
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ConceptDetail".
 */
export interface ConceptDetail {
concept: Concept
modules: SearchModuleRef[]
/**
 * nicht gelöschte Belege, neueste Session zuerst, höchstens 200
 */
evidence: EvidenceView[]
/**
 * nur bestätigte Beziehungen zu nicht gelöschten Konzepten
 */
relations: ConceptRelationView[]
inbox_item_id: (Uuid | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SearchModuleRef".
 */
export interface SearchModuleRef {
id: Uuid
name: string
short_name: (string | null)
}
/**
 * Gespeicherter Beleg (Tabelle evidence) mit Anzeigeangaben
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "EvidenceView".
 */
export interface EvidenceView {
id: Uuid
ref: EvidenceRef
session: (SessionRef | null)
/**
 * nur bei slide: Titel der Folie, sonst null
 */
slide_title: (string | null)
/**
 * true: Ziel gelöscht (Folie bzw. Foliensatz), der Beleg ist nicht mehr anspringbar
 */
missing: boolean
/**
 * kurzes Zitat für die Anzeige
 */
quote: (string | null)
/**
 * true: beim Abgleich automatisch an ein vorhandenes Konzept gehängt (§20.3)
 */
auto: boolean
}
/**
 * Beleg auf eine Folie. Ziel: /dokument?typ=folien&id=<deck_id>&seite=<slide_index>
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "EvidenceRefSlide".
 */
export interface EvidenceRefSlide {
kind: "slide"
slide_id: Uuid
deck_id: Uuid
/**
 * Index der Folie im Foliensatz, ab 1
 */
slide_index: number
}
/**
 * Beleg auf einen Zeitraum des Gesagten (Sitzungszeit, §18.1). t_end_ms ≥ t_start_ms prüft der Schreiber. Ziel: /rueckblick?id=<session_id>&t=<t_start_ms>
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "EvidenceRefTranscript".
 */
export interface EvidenceRefTranscript {
kind: "transcript"
session_id: Uuid
t_start_ms: SessionMs
t_end_ms: SessionMs
}
/**
 * Kurzangabe einer Session für Listen (Anzeige „VL 7 · Titel“ bzw. Datum)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionRef".
 */
export interface SessionRef {
id: Uuid
/**
 * VL-Nummer (Session.number)
 */
number: (number | null)
title: (string | null)
started_at: (Timestamp | null)
module: SearchModuleRef
}
/**
 * Bestätigte Beziehung aus Sicht eines Konzepts
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ConceptRelationView".
 */
export interface ConceptRelationView {
id: Uuid
kind: ConceptRelationKind
/**
 * ausgehend: dieses Konzept ist from_id
 */
direction: ("ausgehend" | "eingehend")
other: {
id: Uuid
/**
 * NFC, getrimmt, Leerraum zusammengefasst, ohne Steuerzeichen
 */
name: string
status: ConceptStatus
}
source: ConceptRelationSource
confidence: (number | null)
/**
 * Fächerbrücke (05 §P8.4): die beiden Konzepte haben kein gemeinsames Modul
 */
cross_module: boolean
}
/**
 * Änderungen beim Annehmen eines Konzept-Vorschlags
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ConceptEdit".
 */
export interface ConceptEdit {
/**
 * NFC, getrimmt, Leerraum zusammengefasst, ohne Steuerzeichen
 */
name?: string
/**
 * weitere Namen, z. B. der englische Begriff (05 §1 Sprache)
 * 
 * @maxItems 20
 */
aliases?: string[]
/**
 * „In einem Satz“
 */
one_liner?: (string | null)
kind?: (ConceptKind | null)
}
/**
 * GET /concepts
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ConceptList".
 */
export interface ConceptList {
items: ConceptListItem[]
next_cursor: (string | null)
}
/**
 * Eintrag in GET /concepts
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ConceptListItem".
 */
export interface ConceptListItem {
concept: Concept
modules: SearchModuleRef[]
evidence_count: number
/**
 * Sessions mit mindestens einem Beleg
 */
session_count: number
}
/**
 * Ein von der KI gefundenes Konzept (05 §P7a), nach Prüfung der Belege
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ConceptProposal".
 */
export interface ConceptProposal {
/**
 * NFC, getrimmt, Leerraum zusammengefasst, ohne Steuerzeichen
 */
name: string
/**
 * weitere Namen, z. B. der englische Begriff (05 §1 Sprache)
 * 
 * @maxItems 20
 */
aliases: string[]
/**
 * „In einem Satz“
 */
one_liner: (string | null)
kind: (ConceptKind | null)
/**
 * 1–3 (05 §P7a)
 */
importance: number
/**
 * Die KI hat einen Klausurhinweis erkannt
 */
exam_hint: boolean
/**
 * Kernaussage des Profs in 1–2 Sätzen
 */
prof_explanation: (string | null)
/**
 * Selbsteinschätzung der KI, 0..1
 */
confidence: number
}
/**
 * concepts.extract (VERTRAEGE §20.2). job.session_id ist gesetzt
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ConceptsExtractPayload".
 */
export interface ConceptsExtractPayload {
session_id: Uuid
/**
 * true: auch bei gleichem input_hash neu aufrufen
 */
force?: boolean
}
/**
 * Ergebnis von concepts.extract (job.result). concepts.resolve liest es über extract_job_id
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ConceptsExtractResult".
 */
export interface ConceptsExtractResult {
session_id: Uuid
/**
 * true: Session weich gelöscht, nichts aufgerufen
 */
session_deleted: boolean
/**
 * true: weder Folien noch Transkript, kein Aufruf
 */
empty: boolean
/**
 * true: gleicher input_hash wie das letzte fertige Ergebnis, übernommen statt aufgerufen
 */
unchanged: boolean
input_hash: (string | null)
/**
 * z. B. concepts.extract/v1
 */
prompt_version: (string | null)
/**
 * Modell der Antwort (nach einem Refusal-Fallback das tatsächlich genutzte)
 */
model: (string | null)
/**
 * Anzahl der Aufrufe (Kapitel), 0 ohne Aufruf
 */
chapters: number
/**
 * @maxItems 30
 */
concepts: ExtractedConcept[]
/**
 * @maxItems 60
 */
relations: ExtractedRelation[]
/**
 * verworfen, weil kein Beleg gültig war
 */
dropped_concepts: number
dropped_evidence: number
dropped_relations: number
/**
 * Euro (Schätzung, VERTRAEGE §20.5)
 */
cost_eur: number
}
/**
 * Konzept im Ergebnis von concepts.extract mit mindestens einem gültigen Beleg (LP8)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ExtractedConcept".
 */
export interface ExtractedConcept {
/**
 * Schlüssel innerhalb des Ergebnisses (c1, c2, …)
 */
key: string
proposal: ConceptProposal
/**
 * @minItems 1
 * @maxItems 12
 */
evidence: EvidenceRef[]
}
/**
 * Beziehung zwischen zwei Konzepten derselben Vorlesung
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ExtractedRelation".
 */
export interface ExtractedRelation {
from: string
to: string
kind: ConceptRelationKind
why: string
/**
 * Selbsteinschätzung der KI, 0..1
 */
confidence: number
}
/**
 * concepts.resolve (VERTRAEGE §20.3). job.session_id ist gesetzt
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ConceptsResolvePayload".
 */
export interface ConceptsResolvePayload {
session_id: Uuid
extract_job_id: Uuid
/**
 * true: auch bei unverändertem Extrakt neu abgleichen
 */
force?: boolean
}
/**
 * Ergebnis von concepts.resolve
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ConceptsResolveResult".
 */
export interface ConceptsResolveResult {
session_id: Uuid
extract_job_id: Uuid
extract_input_hash: (string | null)
/**
 * RESOLVE_VERSION des Workers
 */
resolve_version: number
session_deleted: boolean
/**
 * true: gleicher Extrakt wie beim letzten fertigen Abgleich, nichts geschrieben
 */
unchanged: boolean
/**
 * Konzepte, deren Belege automatisch an ein vorhandenes Konzept gingen
 */
auto_merged: number
proposed_new: number
proposed_merge: number
proposed_relations: number
/**
 * Einträge mit Status automatisch
 */
auto_accepted: number
/**
 * nicht erneut vorgeschlagen, weil für diese Session abgelehnt
 */
skipped_rejected: number
/**
 * baut_auf-Vorschläge, die einen Kreis bilden würden
 */
dropped_cycles: number
/**
 * nachgeholte Vektoren aktiver Konzepte
 */
embedded_concepts: number
embedding_model: (string | null)
embedding_error: (string | null)
/**
 * null ohne KI-Aufruf
 */
prompt_version: (string | null)
model: (string | null)
/**
 * Euro (Schätzung, VERTRAEGE §20.5)
 */
cost_eur: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CostByModel".
 */
export interface CostByModel {
provider: string
model: string
calls: number
input_tokens: number
output_tokens: number
cache_creation_input_tokens: number
cache_read_input_tokens: number
/**
 * Euro (Schätzung, VERTRAEGE §20.5)
 */
eur: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CostBySession".
 */
export interface CostBySession {
session_id: Uuid
session: (SessionRef | null)
calls: number
/**
 * Euro (Schätzung, VERTRAEGE §20.5)
 */
eur: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CostByTask".
 */
export interface CostByTask {
task: string
calls: number
/**
 * Euro (Schätzung, VERTRAEGE §20.5)
 */
eur: number
}
/**
 * GET /costs/summary (F-DAT-05): ein Monat, je Aufgabe, je Session (höchstens 20), je Modell
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "CostSummary".
 */
export interface CostSummary {
budget: AiBudgetStatus
calls: number
by_task: CostByTask[]
/**
 * @maxItems 20
 */
by_session: CostBySession[]
by_model: CostByModel[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "DataSettings".
 */
export interface DataSettings {
/**
 * Absoluter Pfad, null = keine Backups
 */
backup_target: (string | null)
/**
 * age mit Passphrase (P1). Die Passphrase steht nie in den Einstellungen
 */
backup_encryption: boolean
/**
 * Ortszeit des Macs (Standard 03:00)
 */
backup_time: string
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "DataSettingsUpdate".
 */
export interface DataSettingsUpdate {
/**
 * Absoluter Pfad, null = keine Backups
 */
backup_target?: (string | null)
/**
 * age mit Passphrase (P1). Die Passphrase steht nie in den Einstellungen
 */
backup_encryption?: boolean
/**
 * Ortszeit des Macs (Standard 03:00)
 */
backup_time?: string
}
/**
 * Gekoppeltes Gerät. Das Token selbst gibt die API nie aus (gespeichert nur token_hash).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Device".
 */
export interface Device {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
name: string
kind: DeviceKind
last_seen_at: (Timestamp | null)
clock_offset_ms: (number | null)
app_version: (string | null)
/**
 * Abgeleitet: hat gerade eine Sync-Verbindung
 */
connected: boolean
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "DeviceList".
 */
export interface DeviceList {
items: Device[]
next_cursor: (string | null)
}
/**
 * Datei vorher per PUT /pages/{id}/pkdrawing hochgeladen, nur fürs iPad
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "DrawingSnapshotData".
 */
export interface DrawingSnapshotData {
page_id: Uuid
pkdrawing_ref: FileRef
}
/**
 * Verweis auf eine Datei, die getrennt per HTTP hochgeladen wird (08 §2.3 file_ref / pkdrawing_ref). Der Core prüft sha256 beim Upload.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "FileRef".
 */
export interface FileRef {
sha256: Sha256
mime: string
size_bytes: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "DrawingSnapshotOp".
 */
export interface DrawingSnapshotOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "drawing.snapshot"
at: EpochMs
clock_uncertain: boolean
data: DrawingSnapshotData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ElementRemoveData".
 */
export interface ElementRemoveData {
page_id: Uuid
element_id: Uuid
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ElementRemoveOp".
 */
export interface ElementRemoveOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "element.remove"
at: EpochMs
clock_uncertain: boolean
data: ElementRemoveData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ElementUpsertData".
 */
export interface ElementUpsertData {
page_id: Uuid
element: PageElement
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TextElement".
 */
export interface TextElement {
element_id: Uuid
kind: "text"
frame: BBox
z: number
t_ms: (SessionMs | null)
payload: TextElementPayload
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TextElementPayload".
 */
export interface TextElementPayload {
text: string
size: TextSize
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ImageElement".
 */
export interface ImageElement {
element_id: Uuid
kind: "image"
frame: BBox
z: number
t_ms: (SessionMs | null)
payload: ImageElementPayload
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ImageElementPayload".
 */
export interface ImageElementPayload {
photo_id: Uuid
crop: (BBox | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ShapeElement".
 */
export interface ShapeElement {
element_id: Uuid
kind: "shape"
frame: BBox
z: number
t_ms: (SessionMs | null)
payload: ShapeElementPayload
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ShapeElementPayload".
 */
export interface ShapeElementPayload {
shape: ShapeKind
/**
 * @minItems 2
 */
points: Point2[]
color: HexColor
width: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TapeElement".
 */
export interface TapeElement {
element_id: Uuid
kind: "tape"
frame: BBox
z: number
t_ms: (SessionMs | null)
payload: TapeElementPayload
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TapeElementPayload".
 */
export interface TapeElementPayload {
color: HexColor
covered: boolean
card_id: (Uuid | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StampElement".
 */
export interface StampElement {
element_id: Uuid
kind: "stamp"
frame: BBox
z: number
t_ms: (SessionMs | null)
payload: StampElementPayload
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StampElementPayload".
 */
export interface StampElementPayload {
marker_id: Uuid
marker_kind: MarkerKind
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ElementUpsertOp".
 */
export interface ElementUpsertOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "element.upsert"
at: EpochMs
clock_uncertain: boolean
data: ElementUpsertData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * POST /embed des Loopback-Endpunkts (VERTRAEGE §19.4). Body höchstens 256 KB
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "EmbedRequest".
 */
export interface EmbedRequest {
/**
 * @minItems 1
 * @maxItems 16
 */
texts: string[]
}
/**
 * Antwort von POST /embed: ein L2-normierter Vektor je Text, in derselben Reihenfolge
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "EmbedResponse".
 */
export interface EmbedResponse {
model: string
dim: 1024
/**
 * @minItems 1
 * @maxItems 16
 */
vectors: number[][]
}
/**
 * Übungsblatt. Ergänzung zu 03 §4: ingest_state zeigt den Fortschritt von pdf.ingest für das Blatt.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ExerciseSheet".
 */
export interface ExerciseSheet {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
module_id: Uuid
title: string
number: (number | null)
sha256: string
page_count: (number | null)
/**
 * Abgabe, geht in den Planer
 */
due_at: (Timestamp | null)
/**
 * Musterlösung hinterlegt (F-ORG-05, Phase 3)
 */
has_solution: boolean
ingest_state: IngestState
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ExerciseSheetList".
 */
export interface ExerciseSheetList {
items: ExerciseSheet[]
next_cursor: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ExerciseSheetUpdate".
 */
export interface ExerciseSheetUpdate {
title?: string
number?: (number | null)
due_at?: (Timestamp | null)
}
/**
 * Antwort auf PUT /photos/{id}/file und PUT /pages/{id}/pkdrawing
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "FileReceipt".
 */
export interface FileReceipt {
id: Uuid
sha256: Sha256
size_bytes: number
received_at: Timestamp
/**
 * true: dieselbe Datei (gleiches sha256) lag schon vor, nichts geändert
 */
duplicate: boolean
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "GeneralSettings".
 */
export interface GeneralSettings {
/**
 * SG_DATA_DIR, nur lesbar (Änderung über die Umgebung und Neustart)
 */
data_dir: string
content_lang: Lang
appearance: Appearance
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "GeneralSettingsUpdate".
 */
export interface GeneralSettingsUpdate {
content_lang?: Lang
appearance?: Appearance
}
/**
 * Antwort von GET /api/v1/health (docs/VERTRAEGE.md §2)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Health".
 */
export interface Health {
status: "ok"
db: ("ok" | "fehler")
version: string
}
/**
 * Termin in einem Abgleichergebnis (Schlüssel wie tests/fixtures/ics/11-abgleich-erwartung.json)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "IcsEventRef".
 */
export interface IcsEventRef {
event_id: Uuid
external_uid: string
recurrence_id: (string | null)
title: string
starts_at: Timestamp
module_id: (Uuid | null)
kind: CalendarEventKind
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "IcsImportCounts".
 */
export interface IcsImportCounts {
neu: number
geaendert: number
entfallen: number
unveraendert: number
/**
 * In diesem Lauf automatisch einem Modul zugeordnet
 */
zugeordnet: number
/**
 * Nicht abgesagte Termine der Quelle ohne Modul nach dem Lauf
 */
ohne_modul: number
}
/**
 * Antwort auf POST /calendar/sources (201) und POST /calendar/sources/{id}/sync (200). Der Abgleich läuft synchron im Core, nicht als Job.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "IcsImportResult".
 */
export interface IcsImportResult {
source: CalendarSource
counts: IcsImportCounts
neu: IcsEventRef[]
geaendert: IcsEventRef[]
entfallen: IcsEventRef[]
zugeordnet: IcsEventRef[]
module_suggestions: IcsModuleSuggestion[]
warnings: IcsWarning[]
}
/**
 * Vorschlag „neues Modul anlegen?" für unbekannte Titel (F-KAL-02)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "IcsModuleSuggestion".
 */
export interface IcsModuleSuggestion {
/**
 * Vorgeschlagener Modulname, aus dem Titel bereinigt
 */
name: string
kind: CalendarEventKind
/**
 * Kürzel, wenn die Titel dasselbe Modul abgekürzt nennen (Stat I / Statistik I). Fehlt, wenn es keins gibt. Gehört in short_name des neuen Moduls, damit der Abgleich beide Schreibweisen zuordnet.
 */
short?: string
event_count: number
/**
 * Je Serie ein Termin. Nach POST /modules: PATCH /calendar/events/{id} mit module_id, scope=serie
 * 
 * @minItems 1
 */
series_event_ids: Uuid[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "IcsWarning".
 */
export interface IcsWarning {
code: string
message: string
external_uid: (string | null)
}
/**
 * POST /inbox/{id}/accept (§20.6). Welche Felder zu welcher Art passen, regelt der Vertrag (sonst 400 inbox_action_invalid)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxAcceptRequest".
 */
export interface InboxAcceptRequest {
edit?: ConceptEdit
merge_into?: Uuid
/**
 * concept_merge: als neues Konzept annehmen statt zusammenführen
 */
as_new?: boolean
relation_kind?: ConceptRelationKind
}
/**
 * POST /inbox/bulk. Genau eins von ids und session_id (sonst 400 validation_failed)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxBulkRequest".
 */
export interface InboxBulkRequest {
/**
 * Massenaktion
 */
action: ("accept" | "reject" | "reopen")
/**
 * @minItems 1
 * @maxItems 500
 */
ids?: Uuid[]
session_id?: Uuid
}
/**
 * Antwort auf POST /inbox/bulk
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxBulkResult".
 */
export interface InboxBulkResult {
/**
 * geänderte Einträge in Bearbeitungsreihenfolge
 */
decided: Uuid[]
skipped: {
id: Uuid
code: string
}[]
}
/**
 * Was eine Annahme geändert hat (inbox_item.decision). Grundlage für „Rückgängig“ (POST /inbox/{id}/reopen, §20.6)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxDecision".
 */
export interface InboxDecision {
/**
 * Wirkung
 */
action: ("angenommen_neu" | "zusammengefuehrt" | "beziehung_bestaetigt" | "abgelehnt")
concept_id: (Uuid | null)
merged_into: (Uuid | null)
moved_evidence_ids: Uuid[]
added_aliases: string[]
added_module_ids: Uuid[]
previous: (ConceptEdit | null)
relation_kind_before: (ConceptRelationKind | null)
/**
 * mit derselben Entscheidung geänderte Beziehungs-Einträge
 */
cascade_item_ids: Uuid[]
/**
 * A2/A3: vorhandene Beziehung, mit der die umgehängte (A2) bzw. umgewidmete (A3) Beziehung zusammenfiel. Die Zeile des Eintrags bleibt unbestätigt liegen (§20.6)
 */
duplicate_of: (Uuid | null)
/**
 * Eintrag, dessen Entscheidung diesen mitentschieden hat (A1: bestätigte Beziehung, A2: umgehängte Dublette, A3: bestätigte vorhandene Beziehung). Wieder öffnen nur über diesen Eintrag (§20.6)
 */
triggered_by: (Uuid | null)
}
/**
 * Antwort auf accept, reject und reopen
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxDecisionResult".
 */
export interface InboxDecisionResult {
item: InboxItem
concept: (Concept | null)
}
/**
 * Inbox-Eintrag (03 §8, F-NAC-06)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxItem".
 */
export interface InboxItem {
id: Uuid
created_at: Timestamp
updated_at: Timestamp
kind: InboxKind
status: InboxStatus
session: (SessionRef | null)
job_id: (Uuid | null)
/**
 * kleiner = früher (Reihenfolge der geführten Nacharbeitung)
 */
priority: number
decided_at: (Timestamp | null)
payload: InboxPayload
concept_id: (Uuid | null)
target_concept_id: (Uuid | null)
relation_id: (Uuid | null)
blocked: (InboxBlockedReason | null)
}
/**
 * Nutzlast concept_new (neues Konzept)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxPayloadConceptNew".
 */
export interface InboxPayloadConceptNew {
kind: "concept_new"
proposal: ConceptProposal
/**
 * @minItems 1
 * @maxItems 12
 */
evidence: EvidenceRef[]
/**
 * @maxItems 3
 */
similar: InboxSimilarConcept[]
prompt_version: string
model: string
}
/**
 * Ähnliches vorhandenes Konzept („gleich wie X?“, 07 §3.5)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxSimilarConcept".
 */
export interface InboxSimilarConcept {
concept_id: Uuid
/**
 * NFC, getrimmt, Leerraum zusammengefasst, ohne Steuerzeichen
 */
name: string
/**
 * Cosinus-Ähnlichkeit, null ohne Embedder
 */
similarity: (number | null)
verdict: (ResolveVerdict | null)
}
/**
 * Nutzlast concept_merge (Vorschlag: dasselbe wie ein vorhandenes Konzept)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxPayloadConceptMerge".
 */
export interface InboxPayloadConceptMerge {
kind: "concept_merge"
proposal: ConceptProposal
/**
 * @minItems 1
 * @maxItems 12
 */
evidence: EvidenceRef[]
target: {
concept_id: Uuid
/**
 * NFC, getrimmt, Leerraum zusammengefasst, ohne Steuerzeichen
 */
name: string
}
basis: MergeBasis
similarity: (number | null)
/**
 * Begründung der KI, null bei basis = name
 */
reason: (string | null)
/**
 * null bei basis = name (kein KI-Aufruf)
 */
prompt_version: (string | null)
model: (string | null)
}
/**
 * Nutzlast relation (Beziehung zwischen zwei Konzepten)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxPayloadRelation".
 */
export interface InboxPayloadRelation {
kind: "relation"
from_concept_id: Uuid
to_concept_id: Uuid
relation_kind: ConceptRelationKind
why: string
/**
 * Selbsteinschätzung der KI, 0..1
 */
confidence: number
prompt_version: string
model: string
}
/**
 * GET /inbox
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxItemList".
 */
export interface InboxItemList {
items: InboxItem[]
next_cursor: (string | null)
}
/**
 * GET /inbox/overview: Zähler für Navigation und Gruppen (F-NAC-06)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxOverview".
 */
export interface InboxOverview {
open_count: number
/**
 * offene Einträge älter als 14 Tage („12 ältere Vorschläge“)
 */
older_count: number
/**
 * Gruppen mit offenen Einträgen, neueste Session zuerst
 */
sessions: InboxOverviewSession[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "InboxOverviewSession".
 */
export interface InboxOverviewSession {
session: (SessionRef | null)
open_count: number
oldest_at: Timestamp
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Job".
 */
export interface Job {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
type: JobType
/**
 * Je nach type, z. B. PdfIngestPayload
 */
payload: {
[k: string]: any
}
state: JobState
/**
 * Höher = früher
 */
priority: number
attempts: number
max_attempts: number
depends_on: Uuid[]
session_id: (Uuid | null)
locked_by: (string | null)
locked_at: (Timestamp | null)
error: (string | null)
result: ({
[k: string]: any
} | null)
run_after: (Timestamp | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "JobList".
 */
export interface JobList {
items: Job[]
next_cursor: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "LectureSettings".
 */
export interface LectureSettings {
/**
 * deviceId aus MediaDevices, null = Standardmikrofon
 */
microphone_id: (string | null)
/**
 * Regel 1: Kalenderende + X min … (Standard 10)
 */
auto_stop_after_end_min: number
/**
 * … und X min keine Sprache (Standard 3)
 */
auto_stop_quiet_window_min: number
/**
 * Regel 2: Kalenderende + X min (Standard 30)
 */
auto_stop_hard_after_end_min: number
/**
 * Regel 3: Stille ≥ X min (Standard 15)
 */
auto_stop_silence_min: number
/**
 * Regel 4: Maximaldauer (Standard 240)
 */
auto_stop_max_duration_min: number
/**
 * Hinweis vor dem Stopp (Standard 60)
 */
auto_stop_warning_s: number
/**
 * Verlängerung per Tipp (Standard 15)
 */
auto_stop_extend_min: number
default_layout: DashboardLayout
default_ink_mode: InkMode
toolbar_side: ToolbarSide
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "LectureSettingsUpdate".
 */
export interface LectureSettingsUpdate {
/**
 * deviceId aus MediaDevices, null = Standardmikrofon
 */
microphone_id?: (string | null)
/**
 * Regel 1: Kalenderende + X min … (Standard 10)
 */
auto_stop_after_end_min?: number
/**
 * … und X min keine Sprache (Standard 3)
 */
auto_stop_quiet_window_min?: number
/**
 * Regel 2: Kalenderende + X min (Standard 30)
 */
auto_stop_hard_after_end_min?: number
/**
 * Regel 3: Stille ≥ X min (Standard 15)
 */
auto_stop_silence_min?: number
/**
 * Regel 4: Maximaldauer (Standard 240)
 */
auto_stop_max_duration_min?: number
/**
 * Hinweis vor dem Stopp (Standard 60)
 */
auto_stop_warning_s?: number
/**
 * Verlängerung per Tipp (Standard 15)
 */
auto_stop_extend_min?: number
default_layout?: DashboardLayout
default_ink_mode?: InkMode
toolbar_side?: ToolbarSide
}
/**
 * maintenance.nightly (08 §5, T1-18). Phase 1: Papierkorb leeren, verwaiste Dateien, sync_op gelöschter Ströme
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MaintenanceNightlyPayload".
 */
export interface MaintenanceNightlyPayload {
/**
 * Standard 30 (F-DAT-04)
 */
purge_older_than_days?: number
/**
 * Nur zählen, nichts löschen
 */
dry_run?: boolean
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MaintenanceNightlyResult".
 */
export interface MaintenanceNightlyResult {
purged_count: number
/**
 * Endgültig gelöschte Objekte je Tabelle
 */
purged_by_kind: {
[k: string]: number
}
orphan_files_removed: number
sync_ops_removed: number
job_duration_ms: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Marker".
 */
export interface Marker {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
session_id: Uuid
kind: MarkerKind
t_ms: SessionMs
page_id: (Uuid | null)
position: (MarkerPosition | null)
source: MarkerSource
note: (string | null)
resolved_at: (Timestamp | null)
}
/**
 * Stelle auf der Seite in pt (Ursprung oben links)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MarkerPosition".
 */
export interface MarkerPosition {
x: number
y: number
}
/**
 * Marker vom iPad (F-INK-05) und vom Mac (F-DSH-05, source=mac)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MarkerAddData".
 */
export interface MarkerAddData {
marker_id: Uuid
session_id: Uuid
kind: MarkerKind
t_ms: SessionMs
page_id: (Uuid | null)
position: (MarkerPosition | null)
note: (string | null)
source: ClientDevice
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MarkerAddOp".
 */
export interface MarkerAddOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "marker.add"
at: EpochMs
clock_uncertain: boolean
data: MarkerAddData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * Rückgängig (⌘Z, F-DSH-05) bzw. Löschen
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MarkerRemoveData".
 */
export interface MarkerRemoveData {
marker_id: Uuid
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MarkerRemoveOp".
 */
export interface MarkerRemoveOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "marker.remove"
at: EpochMs
clock_uncertain: boolean
data: MarkerRemoveData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Module".
 */
export interface Module {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
semester_id: Uuid
name: string
short_name: (string | null)
color: ModuleColor
ects: (number | null)
exam_type: (string | null)
lecturer: (string | null)
lang: (Lang | null)
description_md: (string | null)
settings: ModuleSettings
}
/**
 * module.settings (W-06 Option A, 03 §3). Fehlender Schlüssel = globaler Standard aus Settings.lecture
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ModuleSettings".
 */
export interface ModuleSettings {
layout?: DashboardLayout
column_widths?: ColumnWidths
ink_mode?: InkMode
}
/**
 * Name genügt, alles andere optional (F-ORG-01). Ohne Farbe vergibt der Core die nächste freie Palettenfarbe. id ist optional und darf vom Client erzeugt werden (03 §1).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ModuleCreate".
 */
export interface ModuleCreate {
id?: Uuid
semester_id: Uuid
name: string
short_name?: (string | null)
color?: ModuleColor
ects?: (number | null)
exam_type?: (string | null)
lecturer?: (string | null)
lang?: (Lang | null)
description_md?: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ModuleList".
 */
export interface ModuleList {
items: Module[]
next_cursor: (string | null)
}
/**
 * Teil von ModuleUpdate.settings: Schlüssel für Schlüssel zusammenführen, null entfernt den Schlüssel
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ModuleSettingsUpdate".
 */
export interface ModuleSettingsUpdate {
layout?: (DashboardLayout | null)
column_widths?: (ColumnWidths | null)
ink_mode?: (InkMode | null)
}
/**
 * PATCH /modules/{id}. settings wird Schlüssel für Schlüssel zusammengeführt, null entfernt einen Schlüssel (docs/VERTRAEGE.md §14.2)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "ModuleUpdate".
 */
export interface ModuleUpdate {
semester_id?: Uuid
name?: string
short_name?: (string | null)
color?: ModuleColor
ects?: (number | null)
exam_type?: (string | null)
lecturer?: (string | null)
lang?: (Lang | null)
description_md?: (string | null)
settings?: ModuleSettingsUpdate
}
/**
 * Antwort von GET /moodle/actions
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionCatalog".
 */
export interface MoodleActionCatalog {
items: MoodleActionInfo[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionInfo".
 */
export interface MoodleActionInfo {
id: MoodleActionId
label: string
description: string
risk: MoodleActionRisk
needs_confirmation: boolean
/**
 * false = nötige wsfunction für den Token nicht freigegeben
 */
available: boolean
}
/**
 * Body von POST /moodle/actions/{action_id}/execute
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionExecute".
 */
export interface MoodleActionExecute {
params: {
[k: string]: any
}
confirmation_token?: (string | null)
}
/**
 * assign.save_draft: mindestens upload_ids oder online_text_html
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsAssignSaveDraft".
 */
export interface MoodleActionParamsAssignSaveDraft {
/**
 * Moodle-ID
 */
assignment_id: number
/**
 * @minItems 1
 * @maxItems 20
 */
upload_ids?: Uuid[]
online_text_html?: string
}
/**
 * assign.submit
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsAssignSubmit".
 */
export interface MoodleActionParamsAssignSubmit {
/**
 * Moodle-ID
 */
assignment_id: number
accept_statement: boolean
}
/**
 * calendar.create_event (Nutzertermin)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsCalendarCreateEvent".
 */
export interface MoodleActionParamsCalendarCreateEvent {
name: string
start_at: Timestamp
duration_minutes?: number
description_html?: string
}
/**
 * completion.set
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsCompletionSet".
 */
export interface MoodleActionParamsCompletionSet {
/**
 * Moodle-ID
 */
cmid: number
completed: boolean
}
/**
 * files.upload_private
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsFilesUploadPrivate".
 */
export interface MoodleActionParamsFilesUploadPrivate {
/**
 * @minItems 1
 * @maxItems 20
 */
upload_ids: Uuid[]
}
/**
 * forum.create_discussion
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsForumCreateDiscussion".
 */
export interface MoodleActionParamsForumCreateDiscussion {
/**
 * Moodle-ID
 */
forum_id: number
subject: string
message_html: string
/**
 * @minItems 1
 * @maxItems 20
 */
upload_ids?: Uuid[]
}
/**
 * forum.reply
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsForumReply".
 */
export interface MoodleActionParamsForumReply {
/**
 * Moodle-ID
 */
post_id: number
subject?: string
message_html: string
/**
 * @minItems 1
 * @maxItems 20
 */
upload_ids?: Uuid[]
}
/**
 * message.send
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionParamsMessageSend".
 */
export interface MoodleActionParamsMessageSend {
/**
 * Moodle-ID
 */
to_user_id: number
text: string
}
/**
 * Antwort der Vorschau. confirmation_token nur bei needs_confirmation
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionPreview".
 */
export interface MoodleActionPreview {
action_id: MoodleActionId
risk: MoodleActionRisk
needs_confirmation: boolean
/**
 * Ein Satz in Klartext, was passieren wird
 */
summary: string
warnings: string[]
details: {
[k: string]: any
}
confirmation_token: (string | null)
expires_at: (Timestamp | null)
}
/**
 * Body von POST /moodle/actions/{action_id}/preview. params nach MoodleActionParams<Name>
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionRequest".
 */
export interface MoodleActionRequest {
params: {
[k: string]: any
}
}
/**
 * Antwort von execute bei Erfolg
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActionResult".
 */
export interface MoodleActionResult {
action_id: MoodleActionId
summary: string
result: {
[k: string]: any
}
}
/**
 * Element eines Kursabschnitts
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleActivity".
 */
export interface MoodleActivity {
/**
 * Moodle-ID
 */
cmid: number
/**
 * Moodle-modname, z. B. resource, folder, assign, forum, quiz, url, page, label
 */
type: string
name: string
url: (string | null)
visible: boolean
description_html: (string | null)
completion: (MoodleCompletion | null)
/**
 * true = der Nutzer darf den Status selbst setzen (completion.set)
 */
completion_manual: boolean
instance_id: (number | null)
files: MoodleFile[]
}
/**
 * Datei in Moodle (Aktivität, Anhang, Abgabe)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleFile".
 */
export interface MoodleFile {
/**
 * Pfad hinter webservice/pluginfile.php, für GET /moodle/file?ref
 */
ref: string
filename: string
mime_type: (string | null)
size_bytes: number
modified_at: (Timestamp | null)
}
/**
 * Aufgabe mit Abgabe
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleAssignment".
 */
export interface MoodleAssignment {
/**
 * Moodle-ID
 */
moodle_id: number
/**
 * Moodle-ID
 */
cmid: number
/**
 * Moodle-ID
 */
course_id: number
name: string
due_at: (Timestamp | null)
cutoff_at: (Timestamp | null)
opens_at: (Timestamp | null)
intro_html: (string | null)
intro_files: MoodleFile[]
submission_types: ("file" | "onlinetext")[]
/**
 * Einreichen verlangt die Erklärung zur Eigenständigkeit (accept_statement)
 */
requires_statement: boolean
/**
 * true = Entwurf muss ausdrücklich eingereicht werden (assign.submit)
 */
requires_submit: boolean
}
/**
 * Antwort von GET /moodle/assignments
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleAssignmentList".
 */
export interface MoodleAssignmentList {
items: MoodleAssignment[]
}
/**
 * Antwort von POST /moodle/auto-assign (#141): was die automatische Kurszuordnung in diesem Lauf getan hat
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleAutoAssignResult".
 */
export interface MoodleAutoAssignResult {
/**
 * Kurse, die einem bestehenden Modul zugeordnet wurden
 */
assigned: number
/**
 * Neu angelegte Module
 */
created: number
}
/**
 * Kurs, in den der Nutzer eingeschrieben ist. module_id: Zuordnung zu einem Modul, von Hand oder automatisch (F-MDL-03, T1-23, #141)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleCourse".
 */
export interface MoodleCourse {
/**
 * Moodle-ID
 */
moodle_id: number
short_name: string
full_name: string
start_date: (IsoDate | null)
end_date: (IsoDate | null)
url: string
last_access_at: (Timestamp | null)
module_id: (Uuid | null)
/**
 * Vorschlag über Titelähnlichkeit, nur ohne bestätigte Zuordnung und nur für aktuelle Kurse (F-MDL-03)
 */
suggested_module_id: (Uuid | null)
category: MoodleCourseCategory
}
/**
 * Antwort von GET /moodle/courses/{course_id}/contents
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleCourseContents".
 */
export interface MoodleCourseContents {
/**
 * Moodle-ID
 */
course_id: number
sections: MoodleSection[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleSection".
 */
export interface MoodleSection {
/**
 * Moodle-ID
 */
moodle_id: number
index: number
name: string
visible: boolean
activities: MoodleActivity[]
}
/**
 * Zuordnung Moodle-Kurs → Modul, von Hand bestätigt oder automatisch (F-MDL-03, #141, 08 §9.4 moodle_course_link)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleCourseLink".
 */
export interface MoodleCourseLink {
/**
 * Moodle-ID
 */
moodle_course_id: number
module_id: Uuid
/**
 * false = Kurs bleibt zugeordnet, wird aber nicht abgeglichen
 */
sync_enabled: boolean
/**
 * Letzter erfolgreicher Abgleich dieses Kurses
 */
last_synced_at: (Timestamp | null)
/**
 * Wie die Zuordnung entstand: null = von Hand, sonst automatisch (#141)
 */
auto: (MoodleLinkAuto | null)
/**
 * true nur bei auto = angelegt, solange das Modul leer ist: DELETE /moodle/links/{course_id}/module legt es in den Papierkorb
 */
module_removable: boolean
created_at: Timestamp
updated_at: Timestamp
}
/**
 * Antwort von GET /moodle/links
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleCourseLinkList".
 */
export interface MoodleCourseLinkList {
items: MoodleCourseLink[]
}
/**
 * Body von PUT /moodle/links/{course_id}: Zuordnung bestätigen oder ändern
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleCourseLinkUpdate".
 */
export interface MoodleCourseLinkUpdate {
module_id: Uuid
/**
 * Standard: true beim Anlegen, sonst unverändert
 */
sync_enabled?: boolean
}
/**
 * Antwort von GET /moodle/courses
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleCourseList".
 */
export interface MoodleCourseList {
items: MoodleCourse[]
}
/**
 * Kommende Frist aus dem Moodle-Kalender
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleDeadline".
 */
export interface MoodleDeadline {
/**
 * Moodle-ID
 */
event_id: number
course_id: (number | null)
cmid: (number | null)
activity_type: (string | null)
name: string
due_at: Timestamp
url: (string | null)
/**
 * Moodle erwartet noch eine Handlung (z. B. Abgabe fehlt)
 */
action_required: boolean
}
/**
 * Antwort von GET /moodle/deadlines
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleDeadlineList".
 */
export interface MoodleDeadlineList {
items: MoodleDeadline[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleDiscussion".
 */
export interface MoodleDiscussion {
/**
 * Moodle-ID
 */
moodle_id: number
/**
 * Moodle-ID
 */
forum_id: number
/**
 * Moodle-ID
 */
first_post_id: number
subject: string
author_name: (string | null)
created_at: Timestamp
modified_at: Timestamp
reply_count: number
pinned: boolean
}
/**
 * Antwort von GET /moodle/forums/{forum_id}/discussions
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleDiscussionList".
 */
export interface MoodleDiscussionList {
items: MoodleDiscussion[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleForum".
 */
export interface MoodleForum {
/**
 * Moodle-ID
 */
moodle_id: number
/**
 * Moodle-ID
 */
cmid: number
/**
 * Moodle-ID
 */
course_id: number
name: string
/**
 * Moodle-Forumtyp, z. B. news, general, qanda
 */
type: string
can_post: boolean
}
/**
 * Antwort von GET /moodle/forums
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleForumList".
 */
export interface MoodleForumList {
items: MoodleForum[]
}
/**
 * Zeile aus der Notenübersicht. Werte als Text, wie Moodle sie formatiert
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleGradeItem".
 */
export interface MoodleGradeItem {
/**
 * Moodle-ID
 */
course_id: number
name: string
/**
 * course, mod, category, manual
 */
item_type: string
cmid: (number | null)
grade: (string | null)
range: (string | null)
percentage: (string | null)
feedback_html: (string | null)
}
/**
 * Antwort von GET /moodle/grades
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleGradeList".
 */
export interface MoodleGradeList {
items: MoodleGradeItem[]
}
/**
 * Datei aus einem zugeordneten Kurs (08 §9.4 moodle_item). Wiedererkannt über file_ref
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleItem".
 */
export interface MoodleItem {
id: Uuid
/**
 * Moodle-ID
 */
moodle_course_id: number
/**
 * Modul aus der aktuellen Kurszuordnung, null ohne Zuordnung
 */
module_id: (Uuid | null)
/**
 * Moodle-ID
 */
cmid: number
activity_name: string
/**
 * Bereinigter Moodle-Dateiname, höchstens 255 Byte (UTF-8), Endung bleibt. Nur zur Anzeige
 */
filename: string
/**
 * Für GET /moodle/file?ref
 */
file_ref: string
mime_type: (string | null)
/**
 * Nur PDFs werden übernommen, andere Dateien nur aufgelistet
 */
is_pdf: boolean
size_bytes: number
/**
 * timemodified der zuletzt verarbeiteten Fassung
 */
modified_at: (Timestamp | null)
kind: MoodleItemKind
/**
 * manuell = Entscheidung in der Inbox, gilt für die ganze Aktivität
 */
kind_source: ("auto" | "manuell")
slide_deck_id: (Uuid | null)
exercise_sheet_id: (Uuid | null)
/**
 * In Moodle gelöscht oder versteckt. Lokal wird nie gelöscht
 */
removed_in_moodle_at: (Timestamp | null)
/**
 * Warum die Datei zuletzt nicht übernommen wurde. Ein späterer Abgleich versucht es erneut (außer kein_pdf)
 */
last_error: (("kein_pdf" | "zu_gross" | "nicht_gefunden" | "download_fehlgeschlagen") | null)
created_at: Timestamp
updated_at: Timestamp
}
/**
 * Antwort von GET /moodle/items
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleItemList".
 */
export interface MoodleItemList {
items: MoodleItem[]
}
/**
 * Body von PATCH /moodle/items/{id}: Entscheidung aus der Inbox („Als Folien / Übung / ignorieren“, gilt für die ganze Aktivität). offen = Entscheidung rückgängig machen (R15)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleItemUpdate".
 */
export interface MoodleItemUpdate {
kind: ("folien" | "uebung" | "ignoriert" | "offen")
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleNotification".
 */
export interface MoodleNotification {
/**
 * Moodle-ID
 */
moodle_id: number
subject: string
text: string
created_at: Timestamp
read: boolean
url: (string | null)
}
/**
 * Antwort von GET /moodle/notifications
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleNotificationList".
 */
export interface MoodleNotificationList {
items: MoodleNotification[]
unread_count: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodlePost".
 */
export interface MoodlePost {
/**
 * Moodle-ID
 */
moodle_id: number
/**
 * Moodle-ID
 */
discussion_id: number
parent_id: (number | null)
subject: string
message_html: string
author_name: (string | null)
created_at: Timestamp
can_reply: boolean
attachments: MoodleFile[]
}
/**
 * Antwort von GET /moodle/discussions/{discussion_id}/posts
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodlePostList".
 */
export interface MoodlePostList {
items: MoodlePost[]
}
/**
 * Quiz, nur zur Anzeige. Versuche laufen nie über die App (F-MDL-05)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleQuiz".
 */
export interface MoodleQuiz {
/**
 * Moodle-ID
 */
moodle_id: number
/**
 * Moodle-ID
 */
cmid: number
/**
 * Moodle-ID
 */
course_id: number
name: string
opens_at: (Timestamp | null)
closes_at: (Timestamp | null)
/**
 * 0 = unbegrenzt
 */
attempts_allowed: number
time_limit_minutes: (number | null)
url: string
}
/**
 * Antwort von GET /moodle/quizzes
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleQuizList".
 */
export interface MoodleQuizList {
items: MoodleQuiz[]
}
/**
 * Antwort von GET /moodle/status (08 §9.2)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleStatus".
 */
export interface MoodleStatus {
state: MoodleConnectionState
site_url: (string | null)
site_name: (string | null)
user_fullname: (string | null)
token_valid_until: (IsoDate | null)
checked_at: (Timestamp | null)
}
/**
 * Antwort von GET /moodle/assignments/{assignment_id}/submission
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleSubmissionStatus".
 */
export interface MoodleSubmissionStatus {
/**
 * Moodle-ID
 */
assignment_id: number
state: MoodleSubmissionState
graded: boolean
grade: (string | null)
feedback_html: (string | null)
last_modified_at: (Timestamp | null)
can_edit: boolean
can_submit: boolean
files: MoodleFile[]
online_text_html: (string | null)
}
/**
 * Body von POST /moodle/sync („Jetzt abgleichen“). Ohne course_id alle zugeordneten Kurse
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleSyncRequest".
 */
export interface MoodleSyncRequest {
/**
 * Moodle-ID
 */
course_id?: number
}
/**
 * Ergebnis eines Abgleichs (F-MDL-04)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleSyncRun".
 */
export interface MoodleSyncRun {
trigger: MoodleSyncTrigger
started_at: Timestamp
finished_at: (Timestamp | null)
/**
 * false = mindestens ein Kurs oder die Fristen konnten nicht abgeglichen werden
 */
ok: boolean
/**
 * Fehlercode des Core (08 §9.1), z. B. moodle_unreachable, oder abgebrochen (Core wurde beendet)
 */
error_code: (string | null)
/**
 * Abgeglichene Kurse
 */
courses: number
files_new: number
files_changed: number
/**
 * Als Foliensatz oder Übungsblatt übernommen (inkl. Verknüpfung mit schon vorhandener Datei)
 */
files_imported: number
/**
 * Neue Dateien mit kind = offen
 */
inbox_new: number
/**
 * Aktuelle Fristen nach dem Abgleich
 */
deadlines: number
/**
 * Items: Moodle-ID
 */
failed_courses: number[]
}
/**
 * Antwort von GET und POST /moodle/sync
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleSyncStatus".
 */
export interface MoodleSyncStatus {
state: MoodleSyncState
connection: MoodleConnectionState
last_run: (MoodleSyncRun | null)
/**
 * Nächster geplanter Abgleich (alle 2 h), null ohne Zeitplan
 */
next_run_at: (Timestamp | null)
}
/**
 * Frist aus dem Abgleich (08 §9.4 moodle_deadline). aufgabe = Moodle-Aufgabe mit Abgabedatum, termin = Kalenderereignis
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleSyncedDeadline".
 */
export interface MoodleSyncedDeadline {
id: Uuid
source: ("aufgabe" | "termin")
/**
 * Moodle-ID
 */
moodle_course_id: number
module_id: Uuid
assignment_id: (number | null)
event_id: (number | null)
cmid: (number | null)
name: string
due_at: Timestamp
url: (string | null)
/**
 * Übungsblatt, das dieses Abgabedatum bekommen hat
 */
exercise_sheet_id: (Uuid | null)
removed_in_moodle_at: (Timestamp | null)
}
/**
 * Antwort von GET /moodle/synced-deadlines
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleSyncedDeadlineList".
 */
export interface MoodleSyncedDeadlineList {
items: MoodleSyncedDeadline[]
}
/**
 * Antwort von POST /moodle/uploads
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "MoodleUpload".
 */
export interface MoodleUpload {
upload_id: Uuid
filename: string
size_bytes: number
expires_at: Timestamp
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Notebook".
 */
export interface Notebook {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
module_id: Uuid
title: string
kind: NotebookKind
/**
 * Abgeleitet
 */
page_count: number
}
/**
 * POST /notebooks. kind fehlt = frei
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookCreate".
 */
export interface NotebookCreate {
id?: Uuid
module_id: Uuid
title: string
kind?: NotebookKind
}
/**
 * Freies Notizbuch offline anlegen (F-INK-02, F-INK-14). Strom notebook:<notebook_id>, idempotent über notebook_id.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookCreateData".
 */
export interface NotebookCreateData {
notebook_id: Uuid
module_id: Uuid
title: string
/**
 * Nur frei. Die Notizbücher vorlesung/uebung legt der Core an
 */
kind?: "frei"
created_at: EpochMs
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookCreateOp".
 */
export interface NotebookCreateOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "notebook.create"
at: EpochMs
clock_uncertain: boolean
data: NotebookCreateData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem Papierkorb
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookDeleteOp".
 */
export interface NotebookDeleteOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "notebook.delete"
at: EpochMs
clock_uncertain: boolean
data: NotebookRefData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookRefData".
 */
export interface NotebookRefData {
notebook_id: Uuid
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookList".
 */
export interface NotebookList {
items: Notebook[]
next_cursor: (string | null)
}
/**
 * GET /notebooks/{id}/pages, nach index sortiert, ohne gelöschte Seiten
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookPages".
 */
export interface NotebookPages {
notebook_id: Uuid
/**
 * seq des Stroms notebook:<id> zu diesem Stand
 */
stream_seq: number
/**
 * op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id senden
 */
stream_op_id: (Uuid | null)
items: Page[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Page".
 */
export interface Page {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
notebook_id: Uuid
session_id: (Uuid | null)
/**
 * Reihenfolge im Notizbuch, 1-basiert
 */
index: number
template: PageTemplate
background_slide_id: (Uuid | null)
attached_slide_id: (Uuid | null)
width_pt: number
height_pt: number
version: number
/**
 * Abgeleitet: PencilKit-Sicherung liegt vor (GET /pages/{id}/pkdrawing)
 */
has_pkdrawing: boolean
}
/**
 * Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem Papierkorb
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookRestoreOp".
 */
export interface NotebookRestoreOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "notebook.restore"
at: EpochMs
clock_uncertain: boolean
data: NotebookRefData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * PATCH /notebooks/{id}
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookUpdate".
 */
export interface NotebookUpdate {
title?: string
module_id?: Uuid
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookUpdateData".
 */
export interface NotebookUpdateData {
notebook_id: Uuid
fields: NotebookUpdateFields
}
/**
 * Aktueller Stand der per REST änderbaren Felder
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookUpdateFields".
 */
export interface NotebookUpdateFields {
title: string
module_id: Uuid
}
/**
 * Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem Papierkorb
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "NotebookUpdateOp".
 */
export interface NotebookUpdateOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "notebook.update"
at: EpochMs
clock_uncertain: boolean
data: NotebookUpdateData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageCreateData".
 */
export interface PageCreateData {
page_id: Uuid
notebook_id: Uuid
session_id: (Uuid | null)
index: number
template: PageTemplate
width_pt: number
height_pt: number
background_slide_id: (Uuid | null)
attached_slide_id: (Uuid | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageCreateOp".
 */
export interface PageCreateOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "page.create"
at: EpochMs
clock_uncertain: boolean
data: PageCreateData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageDeleteData".
 */
export interface PageDeleteData {
page_id: Uuid
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageDeleteOp".
 */
export interface PageDeleteOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "page.delete"
at: EpochMs
clock_uncertain: boolean
data: PageDeleteData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * GET /pages/{id}: Seite mit Elementen (ohne gelöschte, nach z sortiert)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageDetail".
 */
export interface PageDetail {
page: Page
elements: PageElement[]
stream_seq: number
/**
 * op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id senden
 */
stream_op_id: (Uuid | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageRefData".
 */
export interface PageRefData {
page_id: Uuid
}
/**
 * Nur vom Server (origin = server) nach REST-Änderung oder Wiederherstellung aus dem Papierkorb
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageRestoreOp".
 */
export interface PageRestoreOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "page.restore"
at: EpochMs
clock_uncertain: boolean
data: PageRefData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * GET /pages/{id}/strokes: alle nicht gelöschten Striche, nach created_at sortiert
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageStrokes".
 */
export interface PageStrokes {
page_id: Uuid
/**
 * seq des Stroms notebook:<id> zu diesem Stand
 */
stream_seq: number
/**
 * op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id senden
 */
stream_op_id: (Uuid | null)
strokes: Stroke[]
}
/**
 * Neutrales Strich-Format (08 §4.1/4.2). points sind Rohkoordinaten VOR transform, bbox gilt NACH transform inklusive halber Breite. dt des ersten Punkts ist 0; t_end_ms − t_start_ms entspricht dem letzten dt. t_start_ms/t_end_ms null außerhalb einer Session.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Stroke".
 */
export interface Stroke {
client_id: Uuid
tool: StrokeTool
layer: StrokeLayer
color: HexColor
/**
 * Grundbreite in pt
 */
width: number
created_at: EpochMs
t_start_ms: (SessionMs | null)
t_end_ms: (SessionMs | null)
transform: Transform
bbox: BBox
/**
 * Base64 (ohne Zeilenumbrüche) von n ≥ 1 Punkten à 24 Byte: x, y, dt, force, azimuth, altitude als Float32 little-endian (08 §4.2). 24 Byte = genau 32 Base64-Zeichen, daher nie Padding
 */
points: string
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageUpdateData".
 */
export interface PageUpdateData {
page_id: Uuid
fields: PageUpdateFields
/**
 * Version, auf der die Änderung beruht. Der Core setzt danach version + 1
 */
version: number
}
/**
 * Alle änderbaren Felder der Seite mit ihrem neuen Stand. Kein Teil-Update: im Sync gibt es keine optionalen nullbaren Felder (VERTRAEGE §11.7)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageUpdateFields".
 */
export interface PageUpdateFields {
index: number
template: PageTemplate
session_id: (Uuid | null)
background_slide_id: (Uuid | null)
attached_slide_id: (Uuid | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PageUpdateOp".
 */
export interface PageUpdateOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "page.update"
at: EpochMs
clock_uncertain: boolean
data: PageUpdateData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * POST /devices/pair/confirm (aus dem Netz ohne Token erlaubt). Geheimnis ist der Code. public_nonce verknüpft die Bestätigung mit einer eigenen pair/start-Anfrage; gehört sie zu einer abgelehnten Anfrage, wird abgelehnt.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PairConfirmRequest".
 */
export interface PairConfirmRequest {
pairing_id: Uuid
code: string
device_name: string
kind: DeviceKind
public_nonce: string
app_version?: string
}
/**
 * Antwort auf POST /devices/pair/confirm (201)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PairResponse".
 */
export interface PairResponse {
device: Device
/**
 * 256 Bit Zufall, base64url ohne Padding. Wird nur dieses eine Mal ausgegeben
 */
device_token: string
}
/**
 * POST /devices/pair/start (aus dem Netz ohne Token erlaubt). Nur bei offenem Kopplungsfenster; belegt es nicht exklusiv
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PairStartRequest".
 */
export interface PairStartRequest {
device_name: string
kind: DeviceKind
/**
 * Zufallswert des iPads (base64url, ≥ 128 Bit)
 */
public_nonce: string
}
/**
 * pair/start: request_id der eigenen Anfrage und pairing_id des offenen Fensters. Der Code steht NICHT in der Antwort
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PairStartResponse".
 */
export interface PairStartResponse {
request_id: Uuid
pairing_id: Uuid
expires_at: Timestamp
}
/**
 * Offenes Kopplungsfenster für die Anzeige in der Web-App (Antwort von POST /devices/pairings, nur lokal). Anfragen von Geräten liefern das Ereignis pairing.requested und GET /devices/pairings/requests (PairingRequestList)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PairingCode".
 */
export interface PairingCode {
pairing_id: Uuid
code: string
expires_at: Timestamp
/**
 * Adresse des Macs im lokalen Netz (IPv4 der aktiven Schnittstelle), zur Anzeige und für die manuelle Eingabe
 */
host: string
port: number
/**
 * Inhalt des QR-Codes: dieselben Daten wie host, port, pairing_id und code
 */
qr_url: string
}
/**
 * Anfrage eines Geräts über pair/start (Nutzlast des Ereignisses pairing.requested). Die Web-App listet sie und kann sie ablehnen (DELETE /devices/pairings/requests/{request_id}). Gerätenamen sind frei wählbar, die Web-App empfiehlt darum den QR-Weg
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PairingRequest".
 */
export interface PairingRequest {
request_id: Uuid
pairing_id: Uuid
device_name: string
kind: DeviceKind
requested_at: Timestamp
}
/**
 * GET /devices/pairings/requests (nur lokal): offene (nicht abgelehnte) Anfragen des aktuellen Kopplungsfensters, älteste zuerst. Ohne offenes Fenster leer. Höchstens 10, danach antwortet pair/start mit 429 pairing_requests_full
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PairingRequestList".
 */
export interface PairingRequestList {
/**
 * @maxItems 10
 */
items: PairingRequest[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PdfIngestDeckPayload".
 */
export interface PdfIngestDeckPayload {
slide_deck_id: Uuid
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PdfIngestSheetPayload".
 */
export interface PdfIngestSheetPayload {
exercise_sheet_id: Uuid
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PdfIngestResult".
 */
export interface PdfIngestResult {
page_count: number
pages_with_text: number
duration_ms: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PenSettings".
 */
export interface PenSettings {
double_tap: PencilDoubleTapAction
squeeze: PencilSqueezeAction
/**
 * Formerkennung (F-INK-09, ab Phase 3)
 */
shape_recognition: boolean
/**
 * @maxItems 8
 */
favorite_colors: HexColor[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PenSettingsUpdate".
 */
export interface PenSettingsUpdate {
double_tap?: PencilDoubleTapAction
squeeze?: PencilSqueezeAction
/**
 * Formerkennung (F-INK-09, ab Phase 3)
 */
shape_recognition?: boolean
/**
 * @maxItems 8
 */
favorite_colors?: HexColor[]
}
/**
 * Tafel-Foto (Metadaten). Datei: GET /photos/{id}/file
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Photo".
 */
export interface Photo {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
session_id: Uuid
t_ms: SessionMs
page_id: (Uuid | null)
mime: PhotoMime
sha256: Sha256
size_bytes: number
/**
 * false, bis PUT /photos/{id}/file angekommen ist
 */
has_file: boolean
ocr_text: (string | null)
}
/**
 * Datei per PUT /photos/{photo_id}/file, Reihenfolge egal
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PhotoAddData".
 */
export interface PhotoAddData {
photo_id: Uuid
session_id: Uuid
t_ms: SessionMs
page_id: (Uuid | null)
file_ref: PhotoFileRef
}
/**
 * Datei eines Tafel-Fotos, hochgeladen per PUT /photos/{photo_id}/file
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PhotoFileRef".
 */
export interface PhotoFileRef {
sha256: Sha256
mime: PhotoMime
size_bytes: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "PhotoAddOp".
 */
export interface PhotoAddOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "photo.add"
at: EpochMs
clock_uncertain: boolean
data: PhotoAddData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * Eine Aufnahme = ein MediaRecorder-Strom. Nach einem Neuladen beginnt eine neue Aufnahme derselben Session (F-SES-05).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Recording".
 */
export interface Recording {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
session_id: Uuid
mime: string
codec: AudioCodec
started_ms: SessionMs
/**
 * Länge der Gesamtdatei, gesetzt von audio.finalize
 */
duration_ms: (number | null)
state: RecordingState
/**
 * true: jeder Chunk ist eine eigenständige Datei (Recorder je Chunk neu gestartet). false: Chunks ergeben in seq-Reihenfolge einen Bytestrom. Ergänzung, offen bis Spike S4
 */
chunks_independent: boolean
/**
 * Abgeleitet: empfangene Chunks
 */
chunk_count: number
/**
 * Abgeleitet: höchste empfangene seq
 */
last_seq: (number | null)
completed_at: (Timestamp | null)
}
/**
 * POST /recordings/{id}/complete: der Client hat den letzten Chunk hochgeladen. Der Core stellt audio.finalize ein.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "RecordingComplete".
 */
export interface RecordingComplete {
last_seq: number
/**
 * Aufgenommene Länge laut Client
 */
duration_ms: number
}
/**
 * POST /sessions/{id}/recordings
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "RecordingCreate".
 */
export interface RecordingCreate {
id?: Uuid
mime: string
codec: AudioCodec
started_ms: SessionMs
chunks_independent?: boolean
}
/**
 * Treffer auf einer Folie. Ziel: /dokument?typ=folien&id=<deck_id>&seite=<slide_index>
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SearchHitSlide".
 */
export interface SearchHitSlide {
kind: "slide"
chunk_id: Uuid
score: number
module: SearchModuleRef
snippet: SearchSnippetPart[]
deck_id: Uuid
deck_title: string
slide_index: number
slide_title: (string | null)
}
/**
 * Teil eines Ausschnitts. hit = Treffer-Wort (als <mark> darstellen). Immer als Text rendern, nie als HTML
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SearchSnippetPart".
 */
export interface SearchSnippetPart {
text: string
hit: boolean
}
/**
 * Treffer im Gesagten (Transkript-Fenster). Ziel: /rueckblick?id=<session_id>&t=<t_ms>
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SearchHitTranscript".
 */
export interface SearchHitTranscript {
kind: "transcript"
chunk_id: Uuid
score: number
module: SearchModuleRef
snippet: SearchSnippetPart[]
session_id: Uuid
/**
 * VL-Nummer (Session.number)
 */
session_number: (number | null)
session_title: (string | null)
session_started_at: (Timestamp | null)
t_ms: SessionMs
t_end_ms: SessionMs
}
/**
 * search.index (VERTRAEGE §19.3). job.session_id bleibt NULL, auch bei scope = session
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SearchIndexPayload".
 */
export interface SearchIndexPayload {
scope: SearchIndexScope
id: Uuid1
}
/**
 * Ergebnis von search.index (VERTRAEGE §19.3)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SearchIndexResult".
 */
export interface SearchIndexResult {
scope: SearchIndexScope
id: Uuid
/**
 * Einträge des Ziels nach dem Lauf
 */
chunk_count: number
/**
 * neu eingebettete Einträge
 */
embedded_count: number
/**
 * Einträge, deren Vektor wiederverwendet wurde (gleicher Text, gleiches Modell, gleiche Version)
 */
reused_count: number
/**
 * hart gelöschte Einträge, die es im Ziel nicht mehr gibt
 */
removed_count: number
/**
 * Modell der Vektoren. null: Embedder nicht verfügbar, Einträge ohne Vektor geschrieben (§19.3 Schritt 4)
 */
embedding_model: (string | null)
/**
 * Grund, warum ohne Vektoren geschrieben wurde. Ohne Pfade und ohne Geheimnisse
 */
embedding_error: (string | null)
/**
 * SEARCH_INDEX_VERSION des Workers beim Lauf
 */
index_version: number
/**
 * true: Ziel ist weich gelöscht, nichts geschrieben
 */
deleted: boolean
/**
 * true: Ziel existiert nicht (mehr), nichts geschrieben
 */
missing: boolean
}
/**
 * GET /search (VERTRAEGE §19.6)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SearchResponse".
 */
export interface SearchResponse {
/**
 * Suchtext ohne Filter-Präfixe
 */
query: string
mode: ("hybrid" | "text")
degraded: SearchDegraded
filters: {
/**
 * aufgelöste Module aus fach: und module_id. Leer = alle
 */
module_ids: Uuid[]
/**
 * aus typ:. Leer = alle
 */
kinds: SearchKind[]
/**
 * Präfixe, die nichts trafen (wörtlich, z. B. fach:XYZ). Nicht leer → hits leer
 */
unresolved: string[]
}
/**
 * @maxItems 50
 */
hits: SearchHit[]
took_ms: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Semester".
 */
export interface Semester {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
name: string
starts_on: (IsoDate | null)
ends_on: (IsoDate | null)
/**
 * Höchstens ein Semester ist aktuell
 */
is_current: boolean
/**
 * Archiviert = nur in der Navigation ausgeblendet, bleibt durchsuchbar und lernbar (F-ORG-01). Ergänzung zu 03 §3.
 */
archived_at: (Timestamp | null)
}
/**
 * id ist optional und darf vom Client erzeugt werden (03 §1).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SemesterCreate".
 */
export interface SemesterCreate {
id?: Uuid
name: string
starts_on?: (IsoDate | null)
ends_on?: (IsoDate | null)
is_current?: boolean
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SemesterList".
 */
export interface SemesterList {
items: Semester[]
next_cursor: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SemesterUpdate".
 */
export interface SemesterUpdate {
name?: string
starts_on?: (IsoDate | null)
ends_on?: (IsoDate | null)
is_current?: boolean
/**
 * true = archivieren, false = wiederherstellen
 */
archived?: boolean
}
/**
 * Durchführung eines Termins. planned_starts_at/planned_ends_at sind abgeleitet aus dem Kalendertermin (null bei spontanen Sessions).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Session".
 */
export interface Session {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
calendar_event_id: (Uuid | null)
module_id: Uuid
slide_deck_id: (Uuid | null)
/**
 * VL-Nummer im Modul (VL 7), Regeln in docs/VERTRAEGE.md
 */
number: (number | null)
title: (string | null)
state: SessionState
started_at: (Timestamp | null)
ended_at: (Timestamp | null)
stop_reason: (StopReason | null)
started_from: (ClientDevice | null)
processing: SessionProcessing
review_state: ReviewState
planned_starts_at: (Timestamp | null)
planned_ends_at: (Timestamp | null)
auto_stop_extended_until: (Timestamp | null)
/**
 * Abweichende Startzeiten von Geräten (VERTRAEGE §9.3). Fehlt oder leer = keine Abweichung
 */
start_offsets?: SessionStartOffset[]
}
/**
 * Fortschritt der Pipeline (03 §3 session.processing): Job-Typ → Zusammenfassung aller Jobs dieses Typs der Session (VERTRAEGE §3). Schritte und Anzeige: VERTRAEGE §18.2
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionProcessing".
 */
export interface SessionProcessing {
[k: string]: JobState
}
/**
 * Ein Gerät hat die Session offline mit eigenem started_at begonnen. offset_ms = started_at des Geräts − started_at der Session (ms). Die t_ms der Operationen dieses Geräts bleiben unverändert; Sitzungszeit nach Serveruhr = t_ms + offset_ms (für die Ausrichtung in Phase 2).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStartOffset".
 */
export interface SessionStartOffset {
device_id: Uuid
offset_ms: number
}
/**
 * Konzept mit Belegen aus genau dieser Session
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionConceptItem".
 */
export interface SessionConceptItem {
concept: Concept
evidence: EvidenceView[]
inbox_item_id: (Uuid | null)
inbox_status: (InboxStatus | null)
}
/**
 * GET /sessions/{id}/concepts: aktive und vorgeschlagene Konzepte mit Belegen aus der Session
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionConcepts".
 */
export interface SessionConcepts {
session_id: Uuid
items: SessionConceptItem[]
}
/**
 * POST /sessions: spontane Session ohne Termin (F-SES-04). Ergebnis im Zustand bereit, danach /start.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionCreate".
 */
export interface SessionCreate {
id?: Uuid
module_id: Uuid
slide_deck_id?: (Uuid | null)
title?: (string | null)
}
/**
 * POST /sessions/{id}/extend: Auto-Stopp aufschieben (F-SES-03). minutes fehlt = lecture.auto_stop_extend_min
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionExtendRequest".
 */
export interface SessionExtendRequest {
minutes?: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionList".
 */
export interface SessionList {
items: Session[]
next_cursor: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionPauseOp".
 */
export interface SessionPauseOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "session.pause"
at: EpochMs
clock_uncertain: boolean
data: SessionRefData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * session.pause / session.resume
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionRefData".
 */
export interface SessionRefData {
session_id: Uuid
}
/**
 * POST /sessions/{id}/reprocess: Kette ab from_step neu anstoßen (VERTRAEGE §18.5)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionReprocessRequest".
 */
export interface SessionReprocessRequest {
from_step?: PipelineStep1
/**
 * Standard false. true: auch unveränderte Eingaben neu verarbeiten
 */
force?: boolean
}
/**
 * Antwort von POST /sessions/{id}/reprocess (202)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionReprocessResult".
 */
export interface SessionReprocessResult {
session: Session
/**
 * Angelegte oder wiederverwendete Jobs in Ketten-Reihenfolge
 */
jobs: Job[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionResumeOp".
 */
export interface SessionResumeOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "session.resume"
at: EpochMs
clock_uncertain: boolean
data: SessionRefData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * GET /sessions/{id}/snapshot: Live-Stand für Dashboard und iPad (ohne gelöschte Objekte, nach t_ms sortiert)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionSnapshot".
 */
export interface SessionSnapshot {
session: Session
slide_events: SlideEvent[]
markers: Marker[]
photos: Photo[]
recordings: Recording[]
/**
 * seq des Stroms session:<id>, zu der dieser Stand gehört. Danach per Sync ab stream_seq + 1
 */
stream_seq: number
/**
 * op_id der Operation stream_seq, null bei stream_seq = 0. Beim Abonnieren als last_op_id senden
 */
stream_op_id: (Uuid | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideEvent".
 */
export interface SlideEvent {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
session_id: Uuid
slide_id: (Uuid | null)
slide_index: number
t_ms: SessionMs
device: ClientDevice
source: SlideEventSource
}
/**
 * Unbekannte session_id: der Core legt die Session an (Start offline auf dem iPad, F-SES-02 Schritt 3)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStartData".
 */
export interface SessionStartData {
session_id: Uuid
module_id: Uuid
calendar_event_id: (Uuid | null)
slide_deck_id: (Uuid | null)
started_from: ClientDevice
started_at: EpochMs
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStartOp".
 */
export interface SessionStartOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "session.start"
at: EpochMs
clock_uncertain: boolean
data: SessionStartData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * POST /sessions/{id}/start. started_at setzt der Core (Serverzeit).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStartRequest".
 */
export interface SessionStartRequest {
started_from: ClientDevice
slide_deck_id?: (Uuid | null)
}
/**
 * ended_session: eine andere Session, die wegen des Starts automatisch beendet wurde (F-SES-02)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStartResult".
 */
export interface SessionStartResult {
session: Session
ended_session: (Session | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStopData".
 */
export interface SessionStopData {
session_id: Uuid
reason?: StopReason
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStopOp".
 */
export interface SessionStopOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "session.stop"
at: EpochMs
clock_uncertain: boolean
data: SessionStopData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * POST /sessions/{id}/stop. reason fehlt = manuell. absturz_wiederhergestellt setzt nur der Core.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionStopRequest".
 */
export interface SessionStopRequest {
reason?: StopReason
}
/**
 * Zusammenfassung einer Session (Tabelle session_summary, F-NAC-08 ohne Vault). Direkt sichtbar, kein Inbox-Vorschlag (§20.4)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionSummary".
 */
export interface SessionSummary {
id: Uuid
session_id: Uuid
created_at: Timestamp
updated_at: Timestamp
lang: (Lang | null)
/**
 * @minItems 1
 * @maxItems 5
 */
sentences: SummarySentence[]
/**
 * @minItems 0
 * @maxItems 30
 */
outline: SummaryOutlineItem[]
model: string
prompt_version: string
job_id: (Uuid | null)
}
/**
 * Ein Satz der Kurzfassung mit Belegen (LP8)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SummarySentence".
 */
export interface SummarySentence {
text: string
/**
 * @minItems 1
 * @maxItems 6
 */
sources: EvidenceRef[]
}
/**
 * Ein Gliederungspunkt (Kapitel aus den Folien)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SummaryOutlineItem".
 */
export interface SummaryOutlineItem {
title: string
/**
 * @minItems 0
 * @maxItems 6
 */
sources: EvidenceRef[]
}
/**
 * GET /sessions/{id}/summary. summary = null: (noch) keine Zusammenfassung
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionSummaryView".
 */
export interface SessionSummaryView {
session_id: Uuid
summary: (SessionSummary | null)
}
/**
 * GET /sessions/{id}/transcript: alles für den Rückblick einer Session (F-NAC-02). Listen nach start_ms sortiert
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionTranscript".
 */
export interface SessionTranscript {
session_id: Uuid
slide_deck_id: (Uuid | null)
/**
 * Quelle der gelieferten slide_segments: manuell vor ausrichtung vor log. null = keine Zuordnung
 */
slide_source: (SlideSegmentSource | null)
slide_segments: SlideSegment[]
transcripts: TranscriptInfo[]
recordings: Recording[]
lines: TranscriptLine[]
/**
 * true: mindestens eine Aufnahme mit fertigem audio.finalize hat kein oder ein veraltetes Transkript
 */
stale: boolean
}
/**
 * Welche Folie lief wann (03 §5). Zeiten in Sitzungszeit, end_ms ausschließlich
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideSegment".
 */
export interface SlideSegment {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
session_id: Uuid
slide_id: Uuid
slide_index: number
start_ms: SessionMs
end_ms: SessionMs
source: SlideSegmentSource
confidence: number
job_id: (Uuid | null)
}
/**
 * Ein Transkript je Aufnahme (VERTRAEGE §18.1), ohne Segmente
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TranscriptInfo".
 */
export interface TranscriptInfo {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
session_id: Uuid
recording_id: Uuid
job_id: Uuid2
finalize_job_id: Uuid3
provider: TranscriptProvider
model: string
language: (LanguageCode | null)
segment_count: number
word_count: number
audio_duration_ms: number
/**
 * true: Der neueste fertige audio.finalize-Job der Aufnahme ist nicht finalize_job_id (Audio wurde danach neu erzeugt)
 */
stale: boolean
}
/**
 * Ein Transkript-Abschnitt bzw. sein Teil auf einer Folie (VERTRAEGE §18.4). Ein Abschnitt über eine Foliengrenze ergibt mehrere Zeilen mit gleicher segment_id
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TranscriptLine".
 */
export interface TranscriptLine {
segment_id: Uuid
/**
 * 0, 1, … innerhalb des Abschnitts
 */
part: number
recording_id: Uuid4
slide_id: (Uuid | null)
slide_index: (number | null)
start_ms: SessionMs
end_ms: SessionMs
text: string
lang: (LanguageCode | null)
/**
 * Nur mit include_words=true: genau die Wörter dieser Zeile, [] wenn der Abschnitt keine Wort-Zeitstempel hat (VERTRAEGE §18.4)
 */
words?: TranscriptWord[]
}
/**
 * Wort mit Zeitstempel (05 §P4). Zeiten in Sitzungszeit. text ohne führende und abschließende Leerzeichen, Satzzeichen bleiben am Wort
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TranscriptWord".
 */
export interface TranscriptWord {
text: string
start_ms: SessionMs
end_ms: SessionMs
/**
 * Wahrscheinlichkeit laut Whisper
 */
prob: number
}
/**
 * PATCH /sessions/{id}
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SessionUpdate".
 */
export interface SessionUpdate {
title?: (string | null)
slide_deck_id?: (Uuid | null)
}
/**
 * GET /settings: alle Phase-1-Bereiche, fehlende Werte mit Standard aufgefüllt. Geräte stehen unter /devices.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Settings".
 */
export interface Settings {
general: GeneralSettings
lecture: LectureSettings
pen: PenSettings
data: DataSettings
}
/**
 * PATCH /settings: nur die angegebenen Felder ändern sich. Antwort: Settings
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SettingsUpdate".
 */
export interface SettingsUpdate {
general?: GeneralSettingsUpdate
lecture?: LectureSettingsUpdate
pen?: PenSettingsUpdate
data?: DataSettingsUpdate
}
/**
 * Eine Seite eines Foliensatzes. Bilder über GET /slides/{id}/image bzw. /thumb.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Slide".
 */
export interface Slide {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
deck_id: Uuid
/**
 * 1-basiert
 */
index: number
width_pt: number
height_pt: number
/**
 * Textlayer, leer wenn keiner vorhanden
 */
text: string
text_blocks: TextBlock[]
vision_summary: (string | null)
title: (string | null)
chapter: (string | null)
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TextBlock".
 */
export interface TextBlock {
text: string
bbox: BBox
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideChangeData".
 */
export interface SlideChangeData {
event_id: Uuid
session_id: Uuid
slide_id: (Uuid | null)
slide_index: number
t_ms: SessionMs
device: ClientDevice
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideChangeOp".
 */
export interface SlideChangeOp {
type: "op"
op_id: Uuid
stream: SessionStreamId
kind: "slide.change"
at: EpochMs
clock_uncertain: boolean
data: SlideChangeData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideDeck".
 */
export interface SlideDeck {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
module_id: Uuid
session_id: (Uuid | null)
title: string
sha256: string
/**
 * null bis pdf.ingest gelaufen ist
 */
page_count: (number | null)
uploaded_at: Timestamp
ingest_state: IngestState
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideDeckDetail".
 */
export interface SlideDeckDetail {
deck: SlideDeck
slides: Slide[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideDeckList".
 */
export interface SlideDeckList {
items: SlideDeck[]
next_cursor: (string | null)
}
/**
 * PATCH /slide-decks/{id}
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SlideDeckUpdate".
 */
export interface SlideDeckUpdate {
title?: string
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StrokeAddData".
 */
export interface StrokeAddData {
page_id: Uuid
stroke: Stroke
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StrokeAddOp".
 */
export interface StrokeAddOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "stroke.add"
at: EpochMs
clock_uncertain: boolean
data: StrokeAddData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StrokeRemoveData".
 */
export interface StrokeRemoveData {
page_id: Uuid
/**
 * @minItems 1
 */
client_ids: Uuid[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "StrokeRemoveOp".
 */
export interface StrokeRemoveOp {
type: "op"
op_id: Uuid
stream: NotebookStreamId
kind: "stroke.remove"
at: EpochMs
clock_uncertain: boolean
data: StrokeRemoveData
/**
 * Nur Server → Client
 */
seq?: number
origin?: SyncOrigin
}
/**
 * summary.write (VERTRAEGE §20.4, nur die Zusammenfassung, ohne vault.write). job.session_id ist gesetzt
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SummaryWritePayload".
 */
export interface SummaryWritePayload {
session_id: Uuid
force?: boolean
}
/**
 * Ergebnis von summary.write
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SummaryWriteResult".
 */
export interface SummaryWriteResult {
session_id: Uuid
session_deleted: boolean
/**
 * true: weder Folien noch Transkript, eine alte Zusammenfassung wurde entfernt
 */
skipped: boolean
unchanged: boolean
input_hash: (string | null)
sentence_count: number
outline_count: number
dropped_sentences: number
prompt_version: (string | null)
model: (string | null)
/**
 * Euro (Schätzung, VERTRAEGE §20.5)
 */
cost_eur: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncAck".
 */
export interface SyncAck {
type: "ack"
op_id: Uuid
stream: SyncStreamId
seq: number
}
/**
 * Erste Nachricht des Clients (08 §2.1). Das Gerätetoken steht nicht hier, sondern beim Upgrade im Header Authorization: Bearer (VERTRAEGE §11.1). device_id nur zur Gegenprobe.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncHello".
 */
export interface SyncHello {
type: "hello"
protocol: 1
client: SyncClientKind
device_id?: Uuid
app_version: string
streams: SyncStreamPosition[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncStreamPosition".
 */
export interface SyncStreamPosition {
stream: SyncStreamId
/**
 * Höchste lückenlos empfangene und angewandte seq, 0 = nichts
 */
last_seq: number
/**
 * op_id der Operation mit last_seq, null bei last_seq = 0. Der Server prüft das Paar, sonst reset
 */
last_op_id: (Uuid | null)
}
/**
 * Weitere Ströme abonnieren, ohne neu zu verbinden. Antwort: subscribed. Ergänzung zu 08 §2
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncSubscribe".
 */
export interface SyncSubscribe {
type: "subscribe"
/**
 * @minItems 1
 */
streams: SyncStreamPosition[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncUnsubscribe".
 */
export interface SyncUnsubscribe {
type: "unsubscribe"
/**
 * @minItems 1
 */
streams: SyncStreamId[]
}
/**
 * t0 = lokale Uhr des Clients beim Senden (F-SYN-02)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncTimePing".
 */
export interface SyncTimePing {
type: "time.ping"
t0: EpochMs
}
/**
 * Ergebnis des Uhrabgleichs an den Server (device.clock_offset_ms). Ergänzung zu 08 §2.1
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncTimeOffset".
 */
export interface SyncTimeOffset {
type: "time.offset"
/**
 * Gemessener Versatz Server − Client
 */
offset_ms: number
/**
 * Median der Umlaufzeit
 */
rtt_ms: number
}
/**
 * Keepalive des Clients alle 15 s
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncPing".
 */
export interface SyncPing {
type: "ping"
}
/**
 * Was der Client gerade zeigt (ersetzt den vorigen Stand). Das iPad sendet sie bei jedem Seitenwechsel, die Notizen-Spalte folgt ihr (F-DSH-04). Ergänzung zu 08 §2
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncPresence".
 */
export interface SyncPresence {
type: "presence"
session_id: (Uuid | null)
notebook_id: (Uuid | null)
page_id: (Uuid | null)
}
/**
 * Ein Client hat sich verbunden oder getrennt (iPad-Status, F-DSH-06)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncConnectionEvent".
 */
export interface SyncConnectionEvent {
type: "event"
name: "device.connection"
data: SyncConnectionInfo
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncConnectionInfo".
 */
export interface SyncConnectionInfo {
client: SyncClientKind
device_id: (Uuid | null)
connected: boolean
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncError".
 */
export interface SyncError {
type: "error"
code: SyncErrorCode
message: string
op_id?: Uuid
stream?: SyncStreamId
/**
 * Nur mit op_id: true = Verbindung wird geschlossen, neu verbinden und ab dieser Operation erneut senden. false = endgültig abgelehnt: Operation samt abhängigen in die Fehlerablage (VERTRAEGE §11.2). Ausnahmen: session_superseded (umschreiben) und page_version_conflict (neu laden)
 */
retryable: boolean
/**
 * true: der Server schließt die Verbindung direkt danach und verarbeitet keine weitere Nachricht
 */
fatal: boolean
details?: {
[k: string]: any
}
}
/**
 * Zustand oder Felder einer Session haben sich geändert (auch zeitgesteuert: bereit, verpasst, verarbeitet)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncSessionUpdatedEvent".
 */
export interface SyncSessionUpdatedEvent {
type: "event"
name: "session.updated"
data: Session
}
/**
 * Weitergabe von presence eines anderen Clients
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncPresenceEvent".
 */
export interface SyncPresenceEvent {
type: "event"
name: "presence"
data: SyncPresenceInfo
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncPresenceInfo".
 */
export interface SyncPresenceInfo {
client: SyncClientKind
device_id: (Uuid | null)
device_name: (string | null)
session_id: (Uuid | null)
notebook_id: (Uuid | null)
page_id: (Uuid | null)
}
/**
 * Ein Gerät hat pair/start aufgerufen. Nur an lokale Web-Clients (VERTRAEGE §12)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncPairingEvent".
 */
export interface SyncPairingEvent {
type: "event"
name: "pairing.requested"
data: PairingRequest
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncPong".
 */
export interface SyncPong {
type: "pong"
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncResume".
 */
export interface SyncResume {
stream: SyncStreamId
/**
 * Ab dieser seq sendet der Server die fehlenden Operationen
 */
from_seq: number
/**
 * Aktuell höchste seq des Stroms. Ergänzung zu 08 §2.1
 */
head_seq: number
/**
 * true: der Server kennt die gemeldete Position nicht (last_op_id passt nicht, seq zu hoch, z. B. nach einer Wiederherstellung) und sendet für diesen Strom nichts. Der Client verwirft seine Daten NICHT, sondern gleicht per REST ab, sendet fehlende eigene Daten erneut und abonniert ab stream_seq/stream_op_id (VERTRAEGE §11.1).
 */
reset: boolean
}
/**
 * db_epoch ändert sich bei jeder Wiederherstellung der Datenbank. Weicht sie vom gespeicherten Wert ab, behandelt der Client alle Ströme wie reset (VERTRAEGE §11.1).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncWelcome".
 */
export interface SyncWelcome {
type: "welcome"
protocol: 1
server_time: EpochMs
server_version: string
db_epoch: Uuid
device_id: (Uuid | null)
resume: SyncResume[]
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncSubscribed".
 */
export interface SyncSubscribed {
type: "subscribed"
resume: SyncResume[]
}
/**
 * ts = Serveruhr beim Antworten. Versatz = Median über 5 Runden von ts − (t0 + t1) / 2
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "SyncTimePong".
 */
export interface SyncTimePong {
type: "time.pong"
t0: EpochMs
ts: EpochMs
}
/**
 * Teilaufgabe eines Übungsblatts. Zerlegung erst ab Phase 2 (F-ORG-03).
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "Task".
 */
export interface Task {
id: Uuid
user_id: Uuid
created_at: Timestamp
updated_at: Timestamp
deleted_at: (Timestamp | null)
sheet_id: Uuid
label: string
page_index: number
bbox: (BBox | null)
text: string
solution_text: (string | null)
}
/**
 * transcribe (08 §5, VERTRAEGE §18.2). Den Anbieter wählt der Worker (SG_TRANSCRIBER)
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TranscribePayload".
 */
export interface TranscribePayload {
session_id: Uuid
/**
 * true: auch Aufnahmen mit unverändertem input_hash neu transkribieren
 */
force?: boolean
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TranscribeRecordingResult".
 */
export interface TranscribeRecordingResult {
recording_id: Uuid
transcript_id: (Uuid | null)
outcome: TranscribeOutcome
segment_count: number
word_count: number
audio_duration_ms: number
language: (LanguageCode | null)
/**
 * Laufzeit des Transcribers, 0 bei unveraendert
 */
transcribe_ms: number
}
/**
 * job.result von transcribe
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TranscribeResult".
 */
export interface TranscribeResult {
session_id: Uuid
provider: TranscriptProvider
model: string
recordings: TranscribeRecordingResult[]
/**
 * Entfernte Transkripte gelöschter Aufnahmen bzw. von Aufnahmen ohne Audio
 */
removed_transcripts: number
/**
 * Summe über alle Transkripte der Session nach dem Lauf
 */
segment_count: number
word_count: number
/**
 * true: Session war gelöscht, nichts geschrieben
 */
session_deleted: boolean
job_duration_ms: number
}
/**
 * Direkt gelöschtes Objekt im Papierkorb (F-DAT-04). Mitgelöschte Teile erscheinen nicht einzeln.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TrashItem".
 */
export interface TrashItem {
id: Uuid
kind: TrashKind
/**
 * Anzeigename (Titel, Name oder z. B. „Seite 3")
 */
title: string
deleted_at: Timestamp
purge_at: Timestamp
parent: (TrashParent | null)
/**
 * Mitgelöschte abhängige Objekte, die der Nutzer kennt und die mit wiederhergestellt werden. Maschinenausgaben (transcript, transcript_segment, slide_segment, search_chunk) werden mitgelöscht und mitwiederhergestellt, aber nicht mitgezählt (VERTRAEGE §13)
 */
dependent_count: number
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TrashParent".
 */
export interface TrashParent {
id: Uuid
kind: TrashKind
title: string
}
/**
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TrashList".
 */
export interface TrashList {
items: TrashItem[]
next_cursor: (string | null)
}
/**
 * POST /trash/{id}/restore, auch für „Rückgängig" im Toast
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "TrashRestoreResult".
 */
export interface TrashRestoreResult {
id: Uuid
kind: TrashKind
/**
 * Alle wiederhergestellten Zeilen samt Objekt selbst, auch Maschinenausgaben (anders als dependent_count, VERTRAEGE §13)
 */
restored_count: number
}
/**
 * Antwort auf POST /slide-decks und POST /exercise-sheets. duplicate=true: Datei mit gleichem sha256 existiert schon, es wurde nichts angelegt (F-ORG-02 Sonderfall). id ist die ID des neuen bzw. bereits vorhandenen Objekts.
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "UploadResult".
 */
export interface UploadResult {
id: Uuid
duplicate: boolean
}
/**
 * GET /health des Loopback-Endpunkts im Worker (VERTRAEGE §19.4). Nur 127.0.0.1, mit Token. llm ab §20.5, optional, damit ein älterer Worker gültig bleibt
 * 
 * This interface was referenced by `SchemaBundle`'s JSON-Schema
 * via the `definition` "WorkerHealth".
 */
export interface WorkerHealth {
embedder: {
provider: string
model: string
dim: 1024
state: EmbedderState
/**
 * Grund bei nicht_verfuegbar, sonst null
 */
error: (string | null)
}
llm?: WorkerLlmStatus
}
