CREATE TABLE "audio_chunk" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"recording_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"start_ms" bigint NOT NULL,
	"duration_ms" bigint NOT NULL,
	"file_path" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_chunk_recording_seq_uq" UNIQUE("recording_id","seq"),
	CONSTRAINT "audio_chunk_seq_chk" CHECK ("audio_chunk"."seq" >= 0),
	CONSTRAINT "audio_chunk_start_ms_chk" CHECK ("audio_chunk"."start_ms" >= 0),
	CONSTRAINT "audio_chunk_duration_chk" CHECK ("audio_chunk"."duration_ms" >= 1),
	CONSTRAINT "audio_chunk_size_chk" CHECK ("audio_chunk"."size_bytes" >= 1)
);
--> statement-breakpoint
CREATE TABLE "marker" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"t_ms" bigint NOT NULL,
	"page_id" uuid,
	"position" jsonb,
	"source" text NOT NULL,
	"note" text,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "marker_kind_chk" CHECK ("marker"."kind" IN ('frage','klausur','verknuepfung')),
	CONSTRAINT "marker_t_ms_chk" CHECK ("marker"."t_ms" >= 0),
	CONSTRAINT "marker_source_chk" CHECK ("marker"."source" IN ('ipad','mac','detektor'))
);
--> statement-breakpoint
CREATE TABLE "photo" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"session_id" uuid NOT NULL,
	"t_ms" bigint NOT NULL,
	"page_id" uuid,
	"file_path" text,
	"ocr_text" text,
	"mime" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	CONSTRAINT "photo_t_ms_chk" CHECK ("photo"."t_ms" >= 0),
	CONSTRAINT "photo_mime_chk" CHECK ("photo"."mime" IN ('image/heic','image/jpeg')),
	CONSTRAINT "photo_size_chk" CHECK ("photo"."size_bytes" >= 1)
);
--> statement-breakpoint
CREATE TABLE "recording" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"session_id" uuid NOT NULL,
	"mime" text NOT NULL,
	"codec" text NOT NULL,
	"started_ms" bigint NOT NULL,
	"duration_ms" bigint,
	"state" text DEFAULT 'laeuft' NOT NULL,
	"chunks_independent" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_last_seq" integer,
	"completed_duration_ms" bigint,
	CONSTRAINT "recording_codec_chk" CHECK ("recording"."codec" IN ('opus','aac')),
	CONSTRAINT "recording_state_chk" CHECK ("recording"."state" IN ('laeuft','vollstaendig','mit_luecken')),
	CONSTRAINT "recording_started_ms_chk" CHECK ("recording"."started_ms" >= 0),
	CONSTRAINT "recording_completed_last_seq_chk" CHECK ("recording"."completed_last_seq" IS NULL OR "recording"."completed_last_seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "slide_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"session_id" uuid NOT NULL,
	"slide_id" uuid,
	"slide_index" integer NOT NULL,
	"t_ms" bigint NOT NULL,
	"device" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "slide_event_index_chk" CHECK ("slide_event"."slide_index" >= 1),
	CONSTRAINT "slide_event_t_ms_chk" CHECK ("slide_event"."t_ms" >= 0),
	CONSTRAINT "slide_event_device_chk" CHECK ("slide_event"."device" IN ('mac','ipad')),
	CONSTRAINT "slide_event_source_chk" CHECK ("slide_event"."source" IN ('manuell_mac','manuell_ipad','korrektur'))
);
--> statement-breakpoint
CREATE TABLE "notebook" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"module_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'frei' NOT NULL,
	CONSTRAINT "notebook_kind_chk" CHECK ("notebook"."kind" IN ('vorlesung','uebung','frei'))
);
--> statement-breakpoint
CREATE TABLE "page" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"notebook_id" uuid NOT NULL,
	"session_id" uuid,
	"index" integer NOT NULL,
	"template" text NOT NULL,
	"background_slide_id" uuid,
	"attached_slide_id" uuid,
	"width_pt" real NOT NULL,
	"height_pt" real NOT NULL,
	"pkdrawing_path" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "page_index_chk" CHECK ("page"."index" >= 1),
	CONSTRAINT "page_version_chk" CHECK ("page"."version" >= 1),
	CONSTRAINT "page_template_chk" CHECK ("page"."template" IN ('blanko','liniert','kariert','punktraster','cornell','folie'))
);
--> statement-breakpoint
CREATE TABLE "page_element" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"page_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"frame" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"t_ms" bigint,
	"z" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "page_element_kind_chk" CHECK ("page_element"."kind" IN ('text','image','shape','tape','stamp'))
);
--> statement-breakpoint
CREATE TABLE "stroke" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"page_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"tool" text NOT NULL,
	"layer" text NOT NULL,
	"color" text NOT NULL,
	"width" real NOT NULL,
	"t_start_ms" bigint,
	"t_end_ms" bigint,
	"transform" real[] DEFAULT '{1,0,0,1,0,0}' NOT NULL,
	"bbox" jsonb NOT NULL,
	"points" "bytea" NOT NULL,
	"clock_uncertain" boolean DEFAULT false NOT NULL,
	CONSTRAINT "stroke_page_client_uq" UNIQUE("page_id","client_id"),
	CONSTRAINT "stroke_tool_chk" CHECK ("stroke"."tool" IN ('pen','pencil','marker','monoline','fountain')),
	CONSTRAINT "stroke_layer_chk" CHECK ("stroke"."layer" IN ('ink','highlight')),
	CONSTRAINT "stroke_transform_chk" CHECK (cardinality("stroke"."transform") = 6)
);
--> statement-breakpoint
CREATE TABLE "sync_meta" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"db_epoch" uuid NOT NULL,
	CONSTRAINT "sync_meta_single_row_chk" CHECK ("sync_meta"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "sync_op" (
	"stream" text NOT NULL,
	"seq" bigint NOT NULL,
	"op_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" bigint NOT NULL,
	"clock_uncertain" boolean NOT NULL,
	"data" jsonb NOT NULL,
	"origin" text NOT NULL,
	"device_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_op_pkey" PRIMARY KEY("stream","seq"),
	CONSTRAINT "sync_op_op_id_uq" UNIQUE("op_id"),
	CONSTRAINT "sync_op_seq_chk" CHECK ("sync_op"."seq" >= 1),
	CONSTRAINT "sync_op_origin_chk" CHECK ("sync_op"."origin" IN ('ipad','web','server'))
);
--> statement-breakpoint
CREATE TABLE "sync_stream" (
	"stream" text PRIMARY KEY NOT NULL,
	"head_seq" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DROP INDEX "session_one_running_uq";--> statement-breakpoint
ALTER TABLE "device" ALTER COLUMN "clock_offset_ms" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "device" ALTER COLUMN "clock_offset_ms" DROP NOT NULL;--> statement-breakpoint
-- Von Hand: Die 0 aus Phase 0 war kein Messwert. NULL = noch nicht gemessen (VERTRAEGE §11.5)
UPDATE "device" SET "clock_offset_ms" = NULL;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD COLUMN "all_day" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD COLUMN "assigned_by" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_source" ADD COLUMN "name" text;--> statement-breakpoint
-- Von Hand: vorhandene Quellen bekommen die URL bzw. „Kalender“ als Namen
UPDATE "calendar_source" SET "name" = coalesce(nullif("url", ''), 'Kalender') WHERE "name" IS NULL;--> statement-breakpoint
ALTER TABLE "calendar_source" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_source" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "module" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "start_offsets" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "auto_stop_extended_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "backup_run" ADD COLUMN "trigger" text;--> statement-breakpoint
-- Von Hand: vorhandene Läufe gelten als manuell
UPDATE "backup_run" SET "trigger" = 'manuell' WHERE "trigger" IS NULL;--> statement-breakpoint
ALTER TABLE "backup_run" ALTER COLUMN "trigger" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_run" ADD COLUMN "stand" text;--> statement-breakpoint
ALTER TABLE "audio_chunk" ADD CONSTRAINT "audio_chunk_recording_id_recording_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recording"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marker" ADD CONSTRAINT "marker_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording" ADD CONSTRAINT "recording_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slide_event" ADD CONSTRAINT "slide_event_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook" ADD CONSTRAINT "notebook_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_notebook_id_notebook_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_element" ADD CONSTRAINT "page_element_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stroke" ADD CONSTRAINT "stroke_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_op" ADD CONSTRAINT "sync_op_stream_sync_stream_stream_fk" FOREIGN KEY ("stream") REFERENCES "public"."sync_stream"("stream") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marker_session_idx" ON "marker" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "photo_session_idx" ON "photo" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "recording_session_idx" ON "recording" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "slide_event_session_idx" ON "slide_event" USING btree ("session_id","t_ms");--> statement-breakpoint
CREATE INDEX "notebook_module_idx" ON "notebook" USING btree ("module_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notebook_default_uq" ON "notebook" USING btree ("module_id","kind") WHERE "notebook"."kind" IN ('vorlesung','uebung') AND "notebook"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "page_notebook_idx" ON "page" USING btree ("notebook_id","index");--> statement-breakpoint
CREATE INDEX "page_session_idx" ON "page" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "page_element_page_idx" ON "page_element" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_sync_uq" ON "calendar_event" USING btree ("source_id","external_uid","recurrence_id") NULLS NOT DISTINCT WHERE "calendar_event"."source_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "session_one_active_uq" ON "session" USING btree ("user_id") WHERE "session"."state" IN ('laeuft','pausiert') AND "session"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_assigned_by_chk" CHECK ("calendar_event"."assigned_by" IN ('auto','manuell'));--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_state_chk" CHECK ("backup_run"."state" IN ('laeuft','fertig','fehler'));--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_trigger_chk" CHECK ("backup_run"."trigger" IN ('zeitplan','manuell','vor_migration'));--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_kind_chk" CHECK ("device"."kind" IN ('ipad','iphone'));--> statement-breakpoint
-- Von Hand: NULLS NOT DISTINCT im Index calendar_event_sync_uq (oben), Drizzle 0.45 kennt es nur bei Constraints.
-- Von Hand: Epoche für welcome.db_epoch (VERTRAEGE §11.1). Genau eine Zeile, sg restore setzt sie neu.
INSERT INTO "sync_meta" ("id", "db_epoch") VALUES (1, gen_random_uuid()) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Von Hand: updated_at pflegt die Datenbank (wie 0002_updated_at_trigger)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'slide_event', 'marker', 'photo', 'recording', 'audio_chunk',
    'notebook', 'page', 'stroke', 'page_element'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at()',
      t || '_touch_updated_at', t);
  END LOOP;
END;
$$;
