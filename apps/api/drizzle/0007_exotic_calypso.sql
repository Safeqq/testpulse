CREATE TABLE "crowd_cycle_environments" (
	"cycle_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "crowd_cycle_environments_cycle_id_position_pk" PRIMARY KEY("cycle_id","position")
);
--> statement-breakpoint
CREATE TABLE "crowd_cycle_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"url" text NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crowd_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"in_scope" text DEFAULT '' NOT NULL,
	"out_of_scope" text DEFAULT '' NOT NULL,
	"app_version" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"ends_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crowd_cycles_project_number_unique" UNIQUE("project_id","number"),
	CONSTRAINT "crowd_cycles_status_check" CHECK ("crowd_cycles"."status" in ('draft', 'open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "crowd_participants" (
	"cycle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rules_accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"removal_reason" text,
	CONSTRAINT "crowd_participants_cycle_id_user_id_pk" PRIMARY KEY("cycle_id","user_id"),
	CONSTRAINT "crowd_participants_status_check" CHECK ("crowd_participants"."status" in ('active', 'left', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "crowd_report_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "crowd_report_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crowd_report_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"url" text NOT NULL,
	"title" text
);
--> statement-breakpoint
CREATE TABLE "crowd_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"reporter_id" uuid NOT NULL,
	"title" text NOT NULL,
	"steps" text NOT NULL,
	"expected" text NOT NULL,
	"actual" text NOT NULL,
	"environment" text NOT NULL,
	"suggested_severity" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"final_severity" text,
	"points" integer DEFAULT 0 NOT NULL,
	"reject_reason" text,
	"triage_note" text,
	"duplicate_of_id" uuid,
	"bug_id" uuid,
	"hide_from_known_issues" boolean DEFAULT false NOT NULL,
	"triaged_by" uuid,
	"triaged_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crowd_reports_project_number_unique" UNIQUE("project_id","number"),
	CONSTRAINT "crowd_reports_status_check" CHECK ("crowd_reports"."status" in ('submitted', 'accepted', 'rejected', 'duplicate', 'withdrawn')),
	CONSTRAINT "crowd_reports_suggested_severity_check" CHECK ("crowd_reports"."suggested_severity" in ('minor', 'major', 'critical', 'blocker')),
	CONSTRAINT "crowd_reports_final_severity_check" CHECK ("crowd_reports"."final_severity" is null or "crowd_reports"."final_severity" in ('minor', 'major', 'critical', 'blocker')),
	CONSTRAINT "crowd_reports_reject_reason_check" CHECK ("crowd_reports"."reject_reason" is null or "crowd_reports"."reject_reason" in ('not_reproducible', 'out_of_scope', 'not_a_bug', 'insufficient_info', 'other'))
);
--> statement-breakpoint
ALTER TABLE "bugs" ADD COLUMN "crowd_report_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cycle_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "crowd_report_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crowd_cycle_environments" ADD CONSTRAINT "crowd_cycle_environments_cycle_id_crowd_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."crowd_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_cycle_links" ADD CONSTRAINT "crowd_cycle_links_cycle_id_crowd_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."crowd_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_cycles" ADD CONSTRAINT "crowd_cycles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_cycles" ADD CONSTRAINT "crowd_cycles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_participants" ADD CONSTRAINT "crowd_participants_cycle_id_crowd_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."crowd_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_participants" ADD CONSTRAINT "crowd_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_participants" ADD CONSTRAINT "crowd_participants_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_report_comments" ADD CONSTRAINT "crowd_report_comments_report_id_crowd_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."crowd_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_report_comments" ADD CONSTRAINT "crowd_report_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_report_events" ADD CONSTRAINT "crowd_report_events_report_id_crowd_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."crowd_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_report_events" ADD CONSTRAINT "crowd_report_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_report_links" ADD CONSTRAINT "crowd_report_links_report_id_crowd_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."crowd_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_reports" ADD CONSTRAINT "crowd_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_reports" ADD CONSTRAINT "crowd_reports_cycle_id_crowd_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."crowd_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_reports" ADD CONSTRAINT "crowd_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_reports" ADD CONSTRAINT "crowd_reports_duplicate_of_id_crowd_reports_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."crowd_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_reports" ADD CONSTRAINT "crowd_reports_bug_id_bugs_id_fk" FOREIGN KEY ("bug_id") REFERENCES "public"."bugs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_reports" ADD CONSTRAINT "crowd_reports_triaged_by_users_id_fk" FOREIGN KEY ("triaged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crowd_cycle_environments_cycle_label_unique" ON "crowd_cycle_environments" USING btree ("cycle_id",lower("label"));--> statement-breakpoint
CREATE INDEX "crowd_cycle_links_cycle_position_idx" ON "crowd_cycle_links" USING btree ("cycle_id","position");--> statement-breakpoint
CREATE INDEX "crowd_cycles_status_opened_idx" ON "crowd_cycles" USING btree ("status","opened_at" desc);--> statement-breakpoint
CREATE INDEX "crowd_cycles_project_created_idx" ON "crowd_cycles" USING btree ("project_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "crowd_participants_user_idx" ON "crowd_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "crowd_participants_removed_by_idx" ON "crowd_participants" USING btree ("removed_by");--> statement-breakpoint
CREATE INDEX "crowd_report_comments_report_created_idx" ON "crowd_report_comments" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "crowd_report_events_report_created_idx" ON "crowd_report_events" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "crowd_report_links_report_position_idx" ON "crowd_report_links" USING btree ("report_id","position");--> statement-breakpoint
CREATE INDEX "crowd_reports_cycle_status_submitted_idx" ON "crowd_reports" USING btree ("cycle_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "crowd_reports_reporter_submitted_idx" ON "crowd_reports" USING btree ("reporter_id","submitted_at" desc);--> statement-breakpoint
CREATE INDEX "crowd_reports_cycle_reporter_status_idx" ON "crowd_reports" USING btree ("cycle_id","reporter_id","status");--> statement-breakpoint
CREATE INDEX "crowd_reports_accepted_reporter_idx" ON "crowd_reports" USING btree ("reporter_id") WHERE "crowd_reports"."status" = 'accepted';--> statement-breakpoint
CREATE INDEX "crowd_reports_duplicate_of_idx" ON "crowd_reports" USING btree ("duplicate_of_id");--> statement-breakpoint
CREATE INDEX "crowd_reports_bug_idx" ON "crowd_reports" USING btree ("bug_id");--> statement-breakpoint
CREATE INDEX "crowd_reports_triaged_by_idx" ON "crowd_reports" USING btree ("triaged_by");--> statement-breakpoint
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_crowd_report_id_crowd_reports_id_fk" FOREIGN KEY ("crowd_report_id") REFERENCES "public"."crowd_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bugs_crowd_report_idx" ON "bugs" USING btree ("crowd_report_id");