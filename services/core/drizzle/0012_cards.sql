CREATE TABLE "card" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"concept_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"stage" integer DEFAULT 2 NOT NULL,
	"front" jsonb NOT NULL,
	"back" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"origin" text NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"inbox_item_id" uuid,
	CONSTRAINT "card_kind_chk" CHECK ("card"."kind" IN ('basic','cloze')),
	CONSTRAINT "card_stage_chk" CHECK ("card"."stage" BETWEEN 1 AND 4),
	CONSTRAINT "card_front_chk" CHECK (jsonb_typeof("card"."front") = 'object'),
	CONSTRAINT "card_back_chk" CHECK (jsonb_typeof("card"."back") = 'object'),
	CONSTRAINT "card_sources_chk" CHECK (jsonb_typeof("card"."sources") = 'array' AND jsonb_array_length("card"."sources") BETWEEN 1 AND 6),
	CONSTRAINT "card_origin_chk" CHECK ("card"."origin" IN ('ki','manuell')),
	CONSTRAINT "card_inbox_item_chk" CHECK ("card"."origin" = 'ki' OR "card"."inbox_item_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "card_state" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"card_id" uuid NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"stability" double precision DEFAULT 0 NOT NULL,
	"difficulty" double precision DEFAULT 0 NOT NULL,
	"elapsed_days" integer DEFAULT 0 NOT NULL,
	"scheduled_days" integer DEFAULT 0 NOT NULL,
	"learning_steps" integer DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"last_review" timestamp with time zone,
	CONSTRAINT "card_state_card_uq" UNIQUE("card_id"),
	CONSTRAINT "card_state_state_chk" CHECK ("card_state"."state" IN ('new','learning','review','relearning')),
	CONSTRAINT "card_state_numbers_chk" CHECK ("card_state"."stability" >= 0 AND "card_state"."difficulty" >= 0 AND "card_state"."elapsed_days" >= 0 AND "card_state"."scheduled_days" >= 0
        AND "card_state"."learning_steps" >= 0 AND "card_state"."reps" >= 0 AND "card_state"."lapses" >= 0),
	CONSTRAINT "card_state_new_chk" CHECK (("card_state"."state" = 'new') = ("card_state"."last_review" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "review_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"card_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"rating" integer NOT NULL,
	"rating_source" text DEFAULT 'nutzer' NOT NULL,
	"duration_ms" integer NOT NULL,
	"context" text DEFAULT 'taeglich' NOT NULL,
	"state_before" jsonb NOT NULL,
	"state_after" jsonb NOT NULL,
	CONSTRAINT "review_log_rating_chk" CHECK ("review_log"."rating" BETWEEN 1 AND 4),
	CONSTRAINT "review_log_rating_source_chk" CHECK ("review_log"."rating_source" IN ('nutzer')),
	CONSTRAINT "review_log_duration_chk" CHECK ("review_log"."duration_ms" BETWEEN 0 AND 3600000),
	CONSTRAINT "review_log_context_chk" CHECK ("review_log"."context" IN ('taeglich')),
	CONSTRAINT "review_log_states_chk" CHECK (jsonb_typeof("review_log"."state_before") = 'object' AND jsonb_typeof("review_log"."state_after") = 'object')
);
--> statement-breakpoint
ALTER TABLE "inbox_item" DROP CONSTRAINT "inbox_item_kind_chk";--> statement-breakpoint
ALTER TABLE "inbox_item" DROP CONSTRAINT "inbox_item_refs_chk";--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "card_concept_id" uuid;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_concept_id_concept_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concept"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_state" ADD CONSTRAINT "card_state_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_log" ADD CONSTRAINT "review_log_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_concept_idx" ON "card" USING btree ("concept_id") WHERE "card"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "card_state_due_idx" ON "card_state" USING btree ("due") WHERE "card_state"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "review_log_card_idx" ON "review_log" USING btree ("card_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "review_log_reviewed_idx" ON "review_log" USING btree ("reviewed_at") WHERE "review_log"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_card_concept_id_concept_id_fk" FOREIGN KEY ("card_concept_id") REFERENCES "public"."concept"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_item_card_batch_uq" ON "inbox_item" USING btree ("card_concept_id","session_id") WHERE "inbox_item"."card_concept_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_kind_chk" CHECK ("inbox_item"."kind" IN ('concept_new','concept_merge','relation','card_batch'));--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_refs_chk" CHECK (("inbox_item"."kind" = 'concept_new' AND "inbox_item"."concept_id" IS NOT NULL AND "inbox_item"."target_concept_id" IS NULL AND "inbox_item"."relation_id" IS NULL AND "inbox_item"."card_concept_id" IS NULL)
        OR ("inbox_item"."kind" = 'concept_merge' AND "inbox_item"."concept_id" IS NOT NULL AND "inbox_item"."target_concept_id" IS NOT NULL AND "inbox_item"."relation_id" IS NULL AND "inbox_item"."card_concept_id" IS NULL)
        OR ("inbox_item"."kind" = 'relation' AND "inbox_item"."relation_id" IS NOT NULL AND "inbox_item"."concept_id" IS NULL AND "inbox_item"."target_concept_id" IS NULL AND "inbox_item"."card_concept_id" IS NULL)
        OR ("inbox_item"."kind" = 'card_batch' AND "inbox_item"."card_concept_id" IS NOT NULL AND "inbox_item"."session_id" IS NOT NULL AND "inbox_item"."concept_id" IS NULL AND "inbox_item"."target_concept_id" IS NULL AND "inbox_item"."relation_id" IS NULL));--> statement-breakpoint
-- Von Hand: updated_at pflegt die Datenbank (wie 0002_updated_at_trigger)
CREATE TRIGGER card_touch_updated_at BEFORE UPDATE ON card FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at();--> statement-breakpoint
CREATE TRIGGER card_state_touch_updated_at BEFORE UPDATE ON card_state FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at();--> statement-breakpoint
CREATE TRIGGER review_log_touch_updated_at BEFORE UPDATE ON review_log FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at();
