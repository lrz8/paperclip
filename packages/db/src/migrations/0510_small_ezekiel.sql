ALTER TABLE "heartbeat_runs" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "log_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "task_archived_at" timestamp with time zone;