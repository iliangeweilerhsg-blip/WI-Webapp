CREATE TABLE "moodle_course_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"module_id" uuid NOT NULL,
	"moodle_course_id" bigint NOT NULL,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "moodle_deadline" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"source" text NOT NULL,
	"moodle_course_id" bigint NOT NULL,
	"module_id" uuid NOT NULL,
	"moodle_assignment_id" bigint,
	"moodle_event_id" bigint,
	"cmid" bigint,
	"name" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"url" text,
	"exercise_sheet_id" uuid,
	"removed_in_moodle_at" timestamp with time zone,
	CONSTRAINT "moodle_deadline_source_chk" CHECK (("moodle_deadline"."source" = 'aufgabe' AND "moodle_deadline"."moodle_assignment_id" IS NOT NULL) OR ("moodle_deadline"."source" = 'termin' AND "moodle_deadline"."moodle_event_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "moodle_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"moodle_course_id" bigint NOT NULL,
	"cmid" bigint NOT NULL,
	"activity_name" text NOT NULL,
	"filename" text NOT NULL,
	"file_ref" text NOT NULL,
	"mime_type" text,
	"timemodified" timestamp with time zone,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"kind" text NOT NULL,
	"kind_source" text DEFAULT 'auto' NOT NULL,
	"slide_deck_id" uuid,
	"exercise_sheet_id" uuid,
	"removed_in_moodle_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "moodle_item_kind_chk" CHECK ("moodle_item"."kind" IN ('folien','uebung','ignoriert','offen')),
	CONSTRAINT "moodle_item_kind_source_chk" CHECK ("moodle_item"."kind_source" IN ('auto','manuell')),
	CONSTRAINT "moodle_item_sha256_chk" CHECK ("moodle_item"."sha256" IS NULL OR "moodle_item"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "moodle_course_link" ADD CONSTRAINT "moodle_course_link_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moodle_deadline" ADD CONSTRAINT "moodle_deadline_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moodle_deadline" ADD CONSTRAINT "moodle_deadline_exercise_sheet_id_exercise_sheet_id_fk" FOREIGN KEY ("exercise_sheet_id") REFERENCES "public"."exercise_sheet"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moodle_item" ADD CONSTRAINT "moodle_item_slide_deck_id_slide_deck_id_fk" FOREIGN KEY ("slide_deck_id") REFERENCES "public"."slide_deck"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moodle_item" ADD CONSTRAINT "moodle_item_exercise_sheet_id_exercise_sheet_id_fk" FOREIGN KEY ("exercise_sheet_id") REFERENCES "public"."exercise_sheet"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "moodle_course_link_course_uq" ON "moodle_course_link" USING btree ("moodle_course_id");--> statement-breakpoint
CREATE INDEX "moodle_course_link_module_idx" ON "moodle_course_link" USING btree ("module_id");--> statement-breakpoint
CREATE UNIQUE INDEX "moodle_deadline_assignment_uq" ON "moodle_deadline" USING btree ("moodle_assignment_id") WHERE "moodle_deadline"."moodle_assignment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "moodle_deadline_event_uq" ON "moodle_deadline" USING btree ("moodle_event_id") WHERE "moodle_deadline"."moodle_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "moodle_deadline_module_due_idx" ON "moodle_deadline" USING btree ("module_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "moodle_item_file_ref_uq" ON "moodle_item" USING btree ("file_ref");--> statement-breakpoint
CREATE INDEX "moodle_item_course_idx" ON "moodle_item" USING btree ("moodle_course_id","cmid");--> statement-breakpoint
-- Von Hand: updated_at pflegt die Datenbank (wie 0002_updated_at_trigger)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['moodle_course_link', 'moodle_item', 'moodle_deadline'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at()',
      t || '_touch_updated_at', t);
  END LOOP;
END;
$$;
