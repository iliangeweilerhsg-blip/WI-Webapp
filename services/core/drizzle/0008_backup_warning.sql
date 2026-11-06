ALTER TABLE "backup_run" ADD COLUMN "thin_left" text[];--> statement-breakpoint
ALTER TABLE "backup_run" ADD COLUMN "warning" text;--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_warning_chk" CHECK ("backup_run"."warning" IS NULL OR char_length("backup_run"."warning") <= 500);