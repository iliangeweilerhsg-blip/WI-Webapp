CREATE TABLE "calendar_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"source_id" uuid,
	"external_uid" text,
	"module_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"recurrence_id" text,
	"cancelled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "calendar_event_kind_chk" CHECK ("calendar_event"."kind" IN ('vorlesung','uebung','tutorium','pruefung','fest','lernblock_export'))
);
--> statement-breakpoint
CREATE TABLE "calendar_source" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"kind" text NOT NULL,
	"url" text,
	"last_synced_at" timestamp with time zone,
	"readonly" boolean DEFAULT true NOT NULL,
	CONSTRAINT "calendar_source_kind_chk" CHECK ("calendar_source"."kind" IN ('ics_file','ics_url','google'))
);
--> statement-breakpoint
CREATE TABLE "module" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"semester_id" uuid NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"color" text NOT NULL,
	"ects" numeric,
	"exam_type" text,
	"lecturer" text,
	"lang" text,
	"description_md" text,
	CONSTRAINT "module_color_chk" CHECK ("module"."color" ~ '^mod-(0[1-9]|1[0-2])$'),
	CONSTRAINT "module_lang_chk" CHECK ("module"."lang" IS NULL OR "module"."lang" IN ('de','en','mixed'))
);
--> statement-breakpoint
CREATE TABLE "semester" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"is_current" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"calendar_event_id" uuid,
	"module_id" uuid NOT NULL,
	"slide_deck_id" uuid,
	"number" integer,
	"title" text,
	"state" text DEFAULT 'geplant' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"stop_reason" text,
	"started_from" text,
	"processing" jsonb,
	"review_state" text DEFAULT 'offen' NOT NULL,
	CONSTRAINT "session_state_chk" CHECK ("session"."state" IN ('geplant','bereit','laeuft','pausiert','beendet','verarbeitet','verpasst')),
	CONSTRAINT "session_stop_reason_chk" CHECK ("session"."stop_reason" IS NULL OR "session"."stop_reason" IN
      ('manuell','kalenderende','stille','maximaldauer','absturz_wiederhergestellt')),
	CONSTRAINT "session_started_from_chk" CHECK ("session"."started_from" IS NULL OR "session"."started_from" IN ('mac','ipad')),
	CONSTRAINT "session_review_state_chk" CHECK ("session"."review_state" IN ('offen','in_arbeit','erledigt'))
);
--> statement-breakpoint
CREATE TABLE "exercise_sheet" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"module_id" uuid NOT NULL,
	"title" text NOT NULL,
	"number" integer,
	"file_path" text NOT NULL,
	"sha256" text NOT NULL,
	"page_count" integer,
	"due_at" timestamp with time zone,
	"solution_file_path" text,
	"ingest_state" text DEFAULT 'neu' NOT NULL,
	CONSTRAINT "exercise_sheet_ingest_chk" CHECK ("exercise_sheet"."ingest_state" IN ('neu','verarbeitet','fehler'))
);
--> statement-breakpoint
CREATE TABLE "slide" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deck_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"image_path" text,
	"thumb_path" text,
	"width_pt" real NOT NULL,
	"height_pt" real NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"text_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vision_summary" text,
	"title" text,
	"chapter" text,
	"embedding" vector(1024),
	CONSTRAINT "slide_index_chk" CHECK ("slide"."index" >= 1)
);
--> statement-breakpoint
CREATE TABLE "slide_deck" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"module_id" uuid NOT NULL,
	"session_id" uuid,
	"title" text NOT NULL,
	"file_path" text NOT NULL,
	"sha256" text NOT NULL,
	"page_count" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ingest_state" text DEFAULT 'neu' NOT NULL,
	CONSTRAINT "slide_deck_ingest_chk" CHECK ("slide_deck"."ingest_state" IN ('neu','verarbeitet','fehler'))
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sheet_id" uuid NOT NULL,
	"label" text NOT NULL,
	"page_index" integer NOT NULL,
	"bbox" jsonb,
	"text" text DEFAULT '' NOT NULL,
	"solution_text" text,
	"embedding" vector(1024)
);
--> statement-breakpoint
CREATE TABLE "task_slide_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"task_id" uuid NOT NULL,
	"slide_id" uuid NOT NULL,
	"relevance" real NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "task_slide_link_relevance_chk" CHECK ("task_slide_link"."relevance" BETWEEN 0 AND 1),
	CONSTRAINT "task_slide_link_source_chk" CHECK ("task_slide_link"."source" IN ('auto','manuell'))
);
--> statement-breakpoint
CREATE TABLE "backup_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"target" text NOT NULL,
	"size_bytes" bigint,
	"state" text NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "cost_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"job_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"task" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"audio_seconds" real DEFAULT 0 NOT NULL,
	"cost_estimate_eur" numeric DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"clock_offset_ms" integer DEFAULT 0 NOT NULL,
	"app_version" text,
	CONSTRAINT "device_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'wartet' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"depends_on" uuid[] DEFAULT '{}' NOT NULL,
	"session_id" uuid,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"error" text,
	"result" jsonb,
	"run_after" timestamp with time zone,
	CONSTRAINT "job_state_chk" CHECK ("job"."state" IN ('wartet','laeuft','fertig','fehler','abgebrochen'))
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_source_id_calendar_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."calendar_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module" ADD CONSTRAINT "module_semester_id_semester_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semester"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_calendar_event_id_calendar_event_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_slide_deck_id_slide_deck_id_fk" FOREIGN KEY ("slide_deck_id") REFERENCES "public"."slide_deck"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_sheet" ADD CONSTRAINT "exercise_sheet_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slide" ADD CONSTRAINT "slide_deck_id_slide_deck_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."slide_deck"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slide_deck" ADD CONSTRAINT "slide_deck_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slide_deck" ADD CONSTRAINT "slide_deck_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_sheet_id_exercise_sheet_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."exercise_sheet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_slide_link" ADD CONSTRAINT "task_slide_link_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_slide_link" ADD CONSTRAINT "task_slide_link_slide_id_slide_id_fk" FOREIGN KEY ("slide_id") REFERENCES "public"."slide"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_event_starts_idx" ON "calendar_event" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "calendar_event_module_idx" ON "calendar_event" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "calendar_event_source_uid_idx" ON "calendar_event" USING btree ("source_id","external_uid");--> statement-breakpoint
CREATE INDEX "module_semester_idx" ON "module" USING btree ("semester_id");--> statement-breakpoint
CREATE UNIQUE INDEX "semester_current_uq" ON "semester" USING btree ("user_id") WHERE "semester"."is_current" AND "semester"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "session_module_idx" ON "session" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "session_event_idx" ON "session" USING btree ("calendar_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_one_running_uq" ON "session" USING btree ("user_id") WHERE "session"."state" = 'laeuft' AND "session"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "exercise_sheet_module_idx" ON "exercise_sheet" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "exercise_sheet_sha_idx" ON "exercise_sheet" USING btree ("module_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "slide_deck_index_uq" ON "slide" USING btree ("deck_id","index") WHERE "slide"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "slide_embedding_hnsw" ON "slide" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "slide_deck_module_idx" ON "slide_deck" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "slide_deck_sha_idx" ON "slide_deck" USING btree ("module_id","sha256");--> statement-breakpoint
CREATE INDEX "task_sheet_idx" ON "task" USING btree ("sheet_id");--> statement-breakpoint
CREATE INDEX "task_embedding_hnsw" ON "task" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "task_slide_link_uq" ON "task_slide_link" USING btree ("task_id","slide_id") WHERE "task_slide_link"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "task_slide_link_slide_idx" ON "task_slide_link" USING btree ("slide_id");--> statement-breakpoint
CREATE INDEX "cost_entry_job_idx" ON "cost_entry" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "cost_entry_created_idx" ON "cost_entry" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "job_pick_idx" ON "job" USING btree ("priority" DESC NULLS FIRST,"created_at") WHERE "job"."state" = 'wartet' AND "job"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "job_session_idx" ON "job" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "job_created_idx" ON "job" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);