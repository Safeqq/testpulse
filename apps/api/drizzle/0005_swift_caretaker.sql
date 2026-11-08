CREATE TABLE "case_suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_case_labels" (
	"case_id" uuid NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "manual_case_labels_case_id_label_pk" PRIMARY KEY("case_id","label")
);
--> statement-breakpoint
CREATE TABLE "manual_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"suite_id" uuid NOT NULL,
	"title" text NOT NULL,
	"preconditions" text DEFAULT '' NOT NULL,
	"steps" jsonb NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"automated_test_id" uuid,
	"archived_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_cases_project_number_unique" UNIQUE("project_id","number"),
	CONSTRAINT "manual_cases_priority_check" CHECK ("manual_cases"."priority" in ('low', 'medium', 'high', 'urgent'))
);
--> statement-breakpoint
CREATE TABLE "manual_run_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_id" uuid,
	"position" integer NOT NULL,
	"case_number" integer NOT NULL,
	"suite_name" text NOT NULL,
	"suite_position" integer NOT NULL,
	"title" text NOT NULL,
	"preconditions" text DEFAULT '' NOT NULL,
	"steps" jsonb NOT NULL,
	"priority" text NOT NULL,
	"status" text DEFAULT 'untested' NOT NULL,
	"step_results" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"assignee_id" uuid,
	"executed_by" uuid,
	"executed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_run_cases_status_check" CHECK ("manual_run_cases"."status" in ('untested', 'passed', 'failed', 'blocked', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "manual_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"app_version" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" uuid NOT NULL,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_runs_project_number_unique" UNIQUE("project_id","number"),
	CONSTRAINT "manual_runs_status_check" CHECK ("manual_runs"."status" in ('open', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "bugs" ADD COLUMN "manual_run_case_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "case_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "manual_run_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "case_suites" ADD CONSTRAINT "case_suites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_case_labels" ADD CONSTRAINT "manual_case_labels_case_id_manual_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."manual_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_cases" ADD CONSTRAINT "manual_cases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_cases" ADD CONSTRAINT "manual_cases_suite_id_case_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."case_suites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_cases" ADD CONSTRAINT "manual_cases_automated_test_id_test_cases_id_fk" FOREIGN KEY ("automated_test_id") REFERENCES "public"."test_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_cases" ADD CONSTRAINT "manual_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_cases" ADD CONSTRAINT "manual_cases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_run_cases" ADD CONSTRAINT "manual_run_cases_run_id_manual_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."manual_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_run_cases" ADD CONSTRAINT "manual_run_cases_case_id_manual_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."manual_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_run_cases" ADD CONSTRAINT "manual_run_cases_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_run_cases" ADD CONSTRAINT "manual_run_cases_executed_by_users_id_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_runs" ADD CONSTRAINT "manual_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_runs" ADD CONSTRAINT "manual_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_runs" ADD CONSTRAINT "manual_runs_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_suites_project_lower_name_unique" ON "case_suites" USING btree ("project_id",lower("name"));--> statement-breakpoint
CREATE INDEX "case_suites_project_position_idx" ON "case_suites" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "manual_cases_project_suite_number_idx" ON "manual_cases" USING btree ("project_id","suite_id","number");--> statement-breakpoint
CREATE INDEX "manual_cases_automated_test_idx" ON "manual_cases" USING btree ("automated_test_id") WHERE "manual_cases"."automated_test_id" is not null;--> statement-breakpoint
CREATE INDEX "manual_run_cases_run_position_idx" ON "manual_run_cases" USING btree ("run_id","position");--> statement-breakpoint
CREATE INDEX "manual_run_cases_run_status_idx" ON "manual_run_cases" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "manual_run_cases_case_idx" ON "manual_run_cases" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "manual_runs_project_created_idx" ON "manual_runs" USING btree ("project_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "manual_runs_project_app_version_idx" ON "manual_runs" USING btree ("project_id","app_version");--> statement-breakpoint
ALTER TABLE "bugs" ADD CONSTRAINT "bugs_manual_run_case_id_manual_run_cases_id_fk" FOREIGN KEY ("manual_run_case_id") REFERENCES "public"."manual_run_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bugs_manual_run_case_open_idx" ON "bugs" USING btree ("manual_run_case_id") WHERE "bugs"."status" <> 'closed';