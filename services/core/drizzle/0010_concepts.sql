CREATE TABLE "concept" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"kind" text,
	"one_liner" text,
	"status" text NOT NULL,
	"merged_into" uuid,
	"proposal_session_id" uuid,
	"exam_relevant" boolean DEFAULT false NOT NULL,
	"importance_base" real DEFAULT 1 NOT NULL,
	"embedding" vector(1024),
	"embedding_model" text,
	CONSTRAINT "concept_name_chk" CHECK (char_length("concept"."name") BETWEEN 1 AND 200 AND "concept"."name" !~ '[[:cntrl:]]'),
	CONSTRAINT "concept_aliases_chk" CHECK (cardinality("concept"."aliases") <= 20),
	CONSTRAINT "concept_kind_chk" CHECK ("concept"."kind" IS NULL OR "concept"."kind" IN ('definition','verfahren','modell','satz','beispiel')),
	CONSTRAINT "concept_one_liner_chk" CHECK ("concept"."one_liner" IS NULL OR char_length("concept"."one_liner") BETWEEN 1 AND 500),
	CONSTRAINT "concept_status_chk" CHECK ("concept"."status" IN ('vorschlag','aktiv','zusammengefuehrt')),
	CONSTRAINT "concept_merged_chk" CHECK (("concept"."status" = 'zusammengefuehrt') = ("concept"."merged_into" IS NOT NULL) AND "concept"."merged_into" IS DISTINCT FROM "concept"."id"),
	CONSTRAINT "concept_proposal_chk" CHECK (("concept"."status" <> 'vorschlag' OR "concept"."proposal_session_id" IS NOT NULL) AND ("concept"."status" <> 'aktiv' OR "concept"."proposal_session_id" IS NULL)),
	CONSTRAINT "concept_importance_chk" CHECK ("concept"."importance_base" > 0 AND "concept"."importance_base" <= 2),
	CONSTRAINT "concept_embedding_model_chk" CHECK (("concept"."embedding" IS NULL) = ("concept"."embedding_model" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "concept_module" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"concept_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	CONSTRAINT "concept_module_uq" UNIQUE("concept_id","module_id")
);
--> statement-breakpoint
CREATE TABLE "concept_relation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"confidence" real,
	"confirmed" boolean DEFAULT false NOT NULL,
	"why" text,
	"proposal_session_id" uuid,
	"job_id" uuid,
	CONSTRAINT "concept_relation_kind_chk" CHECK ("concept_relation"."kind" IN ('baut_auf','beispiel_fuer','gegensatz','angewendet_in','verwandt')),
	CONSTRAINT "concept_relation_source_chk" CHECK ("concept_relation"."source" IN ('ki','manuell','wikilink')),
	CONSTRAINT "concept_relation_self_chk" CHECK ("concept_relation"."from_id" <> "concept_relation"."to_id"),
	CONSTRAINT "concept_relation_symmetric_chk" CHECK ("concept_relation"."kind" NOT IN ('gegensatz','verwandt') OR "concept_relation"."from_id" < "concept_relation"."to_id"),
	CONSTRAINT "concept_relation_confirmed_chk" CHECK ("concept_relation"."confirmed" = ("concept_relation"."proposal_session_id" IS NULL)),
	CONSTRAINT "concept_relation_confidence_chk" CHECK ("concept_relation"."confidence" IS NULL OR "concept_relation"."confidence" BETWEEN 0 AND 1),
	CONSTRAINT "concept_relation_why_chk" CHECK ("concept_relation"."why" IS NULL OR char_length("concept_relation"."why") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"concept_id" uuid NOT NULL,
	"session_id" uuid,
	"kind" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"t_start_ms" bigint,
	"t_end_ms" bigint,
	"region" jsonb,
	"quote" text,
	"weight" real DEFAULT 1 NOT NULL,
	"auto" boolean DEFAULT false NOT NULL,
	"job_id" uuid,
	CONSTRAINT "evidence_kind_chk" CHECK ("evidence"."kind" IN ('slide','transcript','ink','task','photo','past_exam_question')),
	CONSTRAINT "evidence_times_chk" CHECK (("evidence"."kind" = 'transcript' AND "evidence"."session_id" IS NOT NULL AND "evidence"."ref_id" = "evidence"."session_id"
            AND "evidence"."t_start_ms" IS NOT NULL AND "evidence"."t_start_ms" >= 0 AND "evidence"."t_end_ms" IS NOT NULL AND "evidence"."t_end_ms" >= "evidence"."t_start_ms")
        OR ("evidence"."kind" <> 'transcript' AND "evidence"."t_start_ms" IS NULL AND "evidence"."t_end_ms" IS NULL)),
	CONSTRAINT "evidence_quote_chk" CHECK ("evidence"."quote" IS NULL OR char_length("evidence"."quote") BETWEEN 1 AND 300),
	CONSTRAINT "evidence_weight_chk" CHECK ("evidence"."weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "inbox_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"kind" text NOT NULL,
	"session_id" uuid,
	"job_id" uuid,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"decided_at" timestamp with time zone,
	"decision" jsonb,
	"priority" integer DEFAULT 0 NOT NULL,
	"concept_id" uuid,
	"target_concept_id" uuid,
	"relation_id" uuid,
	CONSTRAINT "inbox_item_kind_chk" CHECK ("inbox_item"."kind" IN ('concept_new','concept_merge','relation')),
	CONSTRAINT "inbox_item_status_chk" CHECK ("inbox_item"."status" IN ('offen','angenommen','abgelehnt','automatisch')),
	CONSTRAINT "inbox_item_refs_chk" CHECK (("inbox_item"."kind" = 'concept_new' AND "inbox_item"."concept_id" IS NOT NULL AND "inbox_item"."target_concept_id" IS NULL AND "inbox_item"."relation_id" IS NULL)
        OR ("inbox_item"."kind" = 'concept_merge' AND "inbox_item"."concept_id" IS NOT NULL AND "inbox_item"."target_concept_id" IS NOT NULL AND "inbox_item"."relation_id" IS NULL)
        OR ("inbox_item"."kind" = 'relation' AND "inbox_item"."relation_id" IS NOT NULL AND "inbox_item"."concept_id" IS NULL AND "inbox_item"."target_concept_id" IS NULL)),
	CONSTRAINT "inbox_item_decided_chk" CHECK (("inbox_item"."status" = 'offen') = ("inbox_item"."decided_at" IS NULL) AND ("inbox_item"."status" <> 'offen' OR "inbox_item"."decision" IS NULL)),
	CONSTRAINT "inbox_item_payload_kind_chk" CHECK ("inbox_item"."payload"->>'kind' = "inbox_item"."kind")
);
--> statement-breakpoint
CREATE TABLE "session_summary" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"session_id" uuid NOT NULL,
	"lang" text,
	"sentences" jsonb NOT NULL,
	"outline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"job_id" uuid,
	CONSTRAINT "session_summary_session_uq" UNIQUE("session_id"),
	CONSTRAINT "session_summary_lang_chk" CHECK ("session_summary"."lang" IS NULL OR "session_summary"."lang" IN ('de','en','mixed')),
	CONSTRAINT "session_summary_sentences_chk" CHECK (jsonb_typeof("session_summary"."sentences") = 'array' AND jsonb_array_length("session_summary"."sentences") BETWEEN 1 AND 5),
	CONSTRAINT "session_summary_outline_chk" CHECK (jsonb_typeof("session_summary"."outline") = 'array' AND jsonb_array_length("session_summary"."outline") <= 30),
	CONSTRAINT "session_summary_input_hash_chk" CHECK ("session_summary"."input_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "cost_entry" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_entry" ADD COLUMN "cache_creation_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_entry" ADD COLUMN "cache_read_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_entry" ADD COLUMN "cost_estimate_usd" numeric DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_entry" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "concept" ADD CONSTRAINT "concept_merged_into_concept_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."concept"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept" ADD CONSTRAINT "concept_proposal_session_id_session_id_fk" FOREIGN KEY ("proposal_session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_module" ADD CONSTRAINT "concept_module_concept_id_concept_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concept"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_module" ADD CONSTRAINT "concept_module_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_relation" ADD CONSTRAINT "concept_relation_from_id_concept_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."concept"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_relation" ADD CONSTRAINT "concept_relation_to_id_concept_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."concept"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_relation" ADD CONSTRAINT "concept_relation_proposal_session_id_session_id_fk" FOREIGN KEY ("proposal_session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_concept_id_concept_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concept"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_concept_id_concept_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concept"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_target_concept_id_concept_id_fk" FOREIGN KEY ("target_concept_id") REFERENCES "public"."concept"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_relation_id_concept_relation_id_fk" FOREIGN KEY ("relation_id") REFERENCES "public"."concept_relation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_summary" ADD CONSTRAINT "session_summary_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concept_status_idx" ON "concept" USING btree ("status") WHERE "concept"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "concept_proposal_session_idx" ON "concept" USING btree ("proposal_session_id");--> statement-breakpoint
CREATE INDEX "concept_merged_into_idx" ON "concept" USING btree ("merged_into");--> statement-breakpoint
CREATE INDEX "concept_embedding_hnsw" ON "concept" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "concept_module_module_idx" ON "concept_module" USING btree ("module_id");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_relation_uq" ON "concept_relation" USING btree ("from_id","to_id","kind") WHERE "concept_relation"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "concept_relation_to_idx" ON "concept_relation" USING btree ("to_id");--> statement-breakpoint
CREATE INDEX "concept_relation_proposal_session_idx" ON "concept_relation" USING btree ("proposal_session_id");--> statement-breakpoint
CREATE INDEX "evidence_concept_idx" ON "evidence" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "evidence_session_idx" ON "evidence" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_dedupe_uq" ON "evidence" USING btree ("concept_id","kind","ref_id",coalesce("t_start_ms", -1),coalesce("t_end_ms", -1),coalesce("session_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "evidence"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "inbox_item_open_idx" ON "inbox_item" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "inbox_item"."status" = 'offen' AND "inbox_item"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "inbox_item_session_idx" ON "inbox_item" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_item_concept_uq" ON "inbox_item" USING btree ("concept_id") WHERE "inbox_item"."concept_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_item_relation_uq" ON "inbox_item" USING btree ("relation_id") WHERE "inbox_item"."relation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "inbox_item_target_idx" ON "inbox_item" USING btree ("target_concept_id");--> statement-breakpoint
CREATE INDEX "cost_entry_session_idx" ON "cost_entry" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_tokens_chk" CHECK ("cost_entry"."input_tokens" >= 0 AND "cost_entry"."output_tokens" >= 0 AND "cost_entry"."cache_creation_input_tokens" >= 0 AND "cost_entry"."cache_read_input_tokens" >= 0);--> statement-breakpoint
ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_cost_chk" CHECK ("cost_entry"."cost_estimate_usd" >= 0 AND "cost_entry"."cost_estimate_eur" >= 0);--> statement-breakpoint
ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_request_id_chk" CHECK ("cost_entry"."request_id" IS NULL OR char_length("cost_entry"."request_id") <= 200);--> statement-breakpoint
-- Von Hand: updated_at pflegt die Datenbank (wie 0002_updated_at_trigger)
CREATE TRIGGER concept_touch_updated_at BEFORE UPDATE ON concept FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at();--> statement-breakpoint
CREATE TRIGGER concept_module_touch_updated_at BEFORE UPDATE ON concept_module FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at();--> statement-breakpoint
CREATE TRIGGER concept_relation_touch_updated_at BEFORE UPDATE ON concept_relation FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at();--> statement-breakpoint
CREATE TRIGGER evidence_touch_updated_at BEFORE UPDATE ON evidence FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at();--> statement-breakpoint
CREATE TRIGGER inbox_item_touch_updated_at BEFORE UPDATE ON inbox_item FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at();--> statement-breakpoint
CREATE TRIGGER session_summary_touch_updated_at BEFORE UPDATE ON session_summary FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at();
