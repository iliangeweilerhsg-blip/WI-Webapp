CREATE TABLE "search_chunk" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"part" integer NOT NULL,
	"deck_id" uuid,
	"session_id" uuid,
	"slide_index" integer,
	"t_ms" bigint,
	"t_end_ms" bigint,
	"title" text,
	"text" text NOT NULL,
	"ts_config" text NOT NULL,
	"tsv" "tsvector" NOT NULL,
	"embedding" vector(1024),
	"embedding_model" text,
	"content_hash" text NOT NULL,
	"index_version" integer NOT NULL,
	"job_id" uuid,
	CONSTRAINT "search_chunk_source_uq" UNIQUE("source_kind","source_id","part"),
	CONSTRAINT "search_chunk_kind_chk" CHECK ("search_chunk"."source_kind" IN ('slide','transcript')),
	CONSTRAINT "search_chunk_ts_config_chk" CHECK ("search_chunk"."ts_config" IN ('german','english','simple')),
	CONSTRAINT "search_chunk_part_chk" CHECK ("search_chunk"."part" >= 0),
	CONSTRAINT "search_chunk_parent_chk" CHECK (("search_chunk"."source_kind" = 'slide' AND "search_chunk"."deck_id" IS NOT NULL AND "search_chunk"."session_id" IS NULL AND "search_chunk"."part" = 0
            AND "search_chunk"."slide_index" IS NOT NULL AND "search_chunk"."slide_index" >= 1 AND "search_chunk"."t_ms" IS NULL AND "search_chunk"."t_end_ms" IS NULL)
        OR ("search_chunk"."source_kind" = 'transcript' AND "search_chunk"."session_id" IS NOT NULL AND "search_chunk"."deck_id" IS NULL
            AND "search_chunk"."source_id" = "search_chunk"."session_id" AND "search_chunk"."slide_index" IS NULL AND "search_chunk"."title" IS NULL
            AND "search_chunk"."t_ms" IS NOT NULL AND "search_chunk"."t_ms" >= 0 AND "search_chunk"."t_end_ms" IS NOT NULL AND "search_chunk"."t_end_ms" >= "search_chunk"."t_ms")),
	CONSTRAINT "search_chunk_text_chk" CHECK (char_length("search_chunk"."text") BETWEEN 1 AND 8000),
	CONSTRAINT "search_chunk_content_hash_chk" CHECK ("search_chunk"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "search_chunk_embedding_model_chk" CHECK (("search_chunk"."embedding" IS NULL) = ("search_chunk"."embedding_model" IS NULL)),
	CONSTRAINT "search_chunk_index_version_chk" CHECK ("search_chunk"."index_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "search_chunk" ADD CONSTRAINT "search_chunk_deck_id_slide_deck_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."slide_deck"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_chunk" ADD CONSTRAINT "search_chunk_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_chunk_tsv_gin" ON "search_chunk" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "search_chunk_embedding_hnsw" ON "search_chunk" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "search_chunk_deck_idx" ON "search_chunk" USING btree ("deck_id");--> statement-breakpoint
CREATE INDEX "search_chunk_session_idx" ON "search_chunk" USING btree ("session_id");--> statement-breakpoint
-- Von Hand: updated_at pflegt die Datenbank (wie 0002_updated_at_trigger)
CREATE TRIGGER search_chunk_touch_updated_at BEFORE UPDATE ON search_chunk FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at();
