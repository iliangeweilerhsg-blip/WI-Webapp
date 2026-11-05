CREATE TABLE "slide_segment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"session_id" uuid NOT NULL,
	"slide_id" uuid NOT NULL,
	"slide_index" integer NOT NULL,
	"start_ms" bigint NOT NULL,
	"end_ms" bigint NOT NULL,
	"source" text NOT NULL,
	"confidence" real NOT NULL,
	"job_id" uuid,
	CONSTRAINT "slide_segment_index_chk" CHECK ("slide_segment"."slide_index" >= 1),
	CONSTRAINT "slide_segment_time_chk" CHECK ("slide_segment"."start_ms" >= 0 AND "slide_segment"."end_ms" > "slide_segment"."start_ms"),
	CONSTRAINT "slide_segment_source_chk" CHECK ("slide_segment"."source" IN ('log','ausrichtung','manuell')),
	CONSTRAINT "slide_segment_confidence_chk" CHECK ("slide_segment"."confidence" >= 0 AND "slide_segment"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "transcript" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"session_id" uuid NOT NULL,
	"recording_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"finalize_job_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"language" text,
	"initial_prompt" text,
	"input_hash" text NOT NULL,
	"audio_sha256" text NOT NULL,
	"audio_duration_ms" bigint NOT NULL,
	"segment_count" integer NOT NULL,
	"word_count" integer NOT NULL,
	CONSTRAINT "transcript_recording_uq" UNIQUE("recording_id"),
	CONSTRAINT "transcript_provider_chk" CHECK ("transcript"."provider" IN ('mlx-whisper','fake')),
	CONSTRAINT "transcript_language_chk" CHECK ("transcript"."language" IS NULL OR "transcript"."language" ~ '^[a-z]{2,3}$'),
	CONSTRAINT "transcript_initial_prompt_chk" CHECK ("transcript"."initial_prompt" IS NULL OR char_length("transcript"."initial_prompt") <= 600),
	CONSTRAINT "transcript_input_hash_chk" CHECK ("transcript"."input_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "transcript_audio_sha256_chk" CHECK ("transcript"."audio_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "transcript_duration_chk" CHECK ("transcript"."audio_duration_ms" >= 0),
	CONSTRAINT "transcript_counts_chk" CHECK ("transcript"."segment_count" >= 0 AND "transcript"."word_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "transcript_segment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"transcript_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"recording_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"start_ms" bigint NOT NULL,
	"end_ms" bigint NOT NULL,
	"text" text NOT NULL,
	"lang" text,
	"speaker" text,
	"avg_logprob" real,
	"no_speech_prob" real,
	"words" jsonb,
	"embedding" vector(1024),
	CONSTRAINT "transcript_segment_seq_uq" UNIQUE("transcript_id","seq"),
	CONSTRAINT "transcript_segment_seq_chk" CHECK ("transcript_segment"."seq" >= 0),
	CONSTRAINT "transcript_segment_time_chk" CHECK ("transcript_segment"."start_ms" >= 0 AND "transcript_segment"."end_ms" >= "transcript_segment"."start_ms"),
	CONSTRAINT "transcript_segment_lang_chk" CHECK ("transcript_segment"."lang" IS NULL OR "transcript_segment"."lang" ~ '^[a-z]{2,3}$')
);
--> statement-breakpoint
ALTER TABLE "slide_segment" ADD CONSTRAINT "slide_segment_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript" ADD CONSTRAINT "transcript_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript" ADD CONSTRAINT "transcript_recording_id_recording_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recording"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segment" ADD CONSTRAINT "transcript_segment_transcript_id_transcript_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."transcript"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segment" ADD CONSTRAINT "transcript_segment_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slide_segment_session_idx" ON "slide_segment" USING btree ("session_id","source","start_ms");--> statement-breakpoint
CREATE INDEX "transcript_session_idx" ON "transcript" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "transcript_segment_session_idx" ON "transcript_segment" USING btree ("session_id","start_ms");--> statement-breakpoint
-- Von Hand: updated_at pflegt die Datenbank (wie 0002_updated_at_trigger)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transcript', 'transcript_segment', 'slide_segment'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION sg_touch_updated_at()',
      t || '_touch_updated_at', t);
  END LOOP;
END;
$$;
