CREATE TABLE "moodle_course_decided" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"moodle_course_id" bigint NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "moodle_course_decided_reason_chk" CHECK ("moodle_course_decided"."reason" IN ('auto','manuell','geloest','entfernt'))
);
--> statement-breakpoint
ALTER TABLE "moodle_course_link" ADD COLUMN "auto" text;--> statement-breakpoint
CREATE UNIQUE INDEX "moodle_course_decided_course_uq" ON "moodle_course_decided" USING btree ("moodle_course_id");--> statement-breakpoint
ALTER TABLE "moodle_course_link" ADD CONSTRAINT "moodle_course_link_auto_chk" CHECK ("moodle_course_link"."auto" IS NULL OR "moodle_course_link"."auto" IN ('zugeordnet','angelegt'));--> statement-breakpoint
-- Von Hand: updated_at pflegt die Datenbank (wie 0002_updated_at_trigger)
CREATE TRIGGER "moodle_course_decided_touch_updated_at" BEFORE UPDATE ON "moodle_course_decided" FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at();--> statement-breakpoint
-- Von Hand: Bestehende Zuordnungen bleiben „von Hand“ (auto = NULL) und gelten als entschieden, damit die Automatik
-- diese Kurse auch nach einem endgültig gelöschten Modul nie anfasst (#141)
INSERT INTO "moodle_course_decided" ("id", "user_id", "moodle_course_id", "reason")
SELECT gen_random_uuid(), "user_id", "moodle_course_id", 'manuell' FROM "moodle_course_link"
ON CONFLICT ("moodle_course_id") DO NOTHING;
