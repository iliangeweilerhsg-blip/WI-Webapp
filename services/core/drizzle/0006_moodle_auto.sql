CREATE TABLE "moodle_course_manual" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"moodle_course_id" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "moodle_course_link" ADD COLUMN "auto" text;--> statement-breakpoint
CREATE UNIQUE INDEX "moodle_course_manual_course_uq" ON "moodle_course_manual" USING btree ("moodle_course_id");--> statement-breakpoint
ALTER TABLE "moodle_course_link" ADD CONSTRAINT "moodle_course_link_auto_chk" CHECK ("moodle_course_link"."auto" IS NULL OR "moodle_course_link"."auto" IN ('zugeordnet','angelegt'));--> statement-breakpoint
-- Von Hand: updated_at pflegt die Datenbank (wie 0002_updated_at_trigger). Bestehende Zuordnungen bleiben „von Hand“ (auto = NULL)
CREATE TRIGGER "moodle_course_manual_touch_updated_at" BEFORE UPDATE ON "moodle_course_manual" FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at();
