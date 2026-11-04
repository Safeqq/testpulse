CREATE TABLE "bug_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bug_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bug_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bug_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bug_labels" (
	"bug_id" uuid NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "bug_labels_bug_id_label_pk" PRIMARY KEY("bug_id","label")
);
--> statement-breakpoint
CREATE TABLE "bug_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bug_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"url" text NOT NULL,
	"title" text
);
--> statement-breakpoint
CREATE TABLE "bugs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"severity" text DEFAULT 'major' NOT NULL,
	"assignee_id" uuid,
	"reporter_id" uuid NOT NULL,
	"test_case_id" uuid,
	"run_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "bugs_project_number_unique" UNIQUE("project_id","number"),
	CONSTRAINT "bugs_status_check" CHECK ("bugs"."status" in ('open', 'in_progress', 'resolved', 'closed')),
	CONSTRAINT "bugs_resolution_check" CHECK ("bugs"."resolution" is null or "bugs"."resolution" in ('fixed', 'wont_fix', 'duplicate', 'cannot_reproduce')),
	CONSTRAINT "bugs_priority_check" CHECK ("bugs"."priority" in ('low', 'medium', 'high', 'urgent')),
	CONSTRAINT "bugs_severity_check" CHECK ("bugs"."severity" in ('minor', 'major', 'critical', 'blocker'))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "bug_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "version" text;--> statement-breakpoint
ALTER TABLE "bug_comments" ADD CONSTRAINT "bug_comments_bug_id_bugs_id_fk" FOREIGN KEY ("bug_id") REFERENCES "public"."bugs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_comments" ADD CONSTRAINT "bug_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_events" ADD CONSTRAINT "bug_events_bug_id_bugs_id_fk" FOREIGN KEY ("bug_id") REFERENCES "public"."bugs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_events" ADD CONSTRAINT "bug_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_labels" ADD CONSTRAINT "bug_labels_bug_id_bugs_id_fk" FOREIGN KEY ("bug_id") REFERENCES "public"."bugs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_links" ADD CONSTRAINT "bug_links_bug_id_bugs_id_fk" FOREIGN KEY ("bug_id") REFERENCES "public"."bugs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bug_comments_bug_created_idx" ON "bug_comments" USING btree ("bug_id","created_at");--> statement-breakpoint
CREATE INDEX "bug_events_bug_created_idx" ON "bug_events" USING btree ("bug_id","created_at");--> statement-breakpoint
CREATE INDEX "bugs_project_status_updated_idx" ON "bugs" USING btree ("project_id","status","updated_at" desc);--> statement-breakpoint
CREATE INDEX "bugs_project_assignee_idx" ON "bugs" USING btree ("project_id","assignee_id");--> statement-breakpoint
CREATE INDEX "bugs_test_case_open_idx" ON "bugs" USING btree ("test_case_id") WHERE "bugs"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "runs_project_branch_version_idx" ON "runs" USING btree ("project_id","branch","version");