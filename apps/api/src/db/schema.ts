import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    visibility: text("visibility").notNull().default("private"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [check("projects_visibility_check", sql`${t.visibility} in ('private', 'public')`)],
);

export const memberships = pgTable(
  "memberships",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    check("memberships_role_check", sql`${t.role} in ('admin', 'tester', 'viewer')`),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    role: text("role").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [check("invitations_role_check", sql`${t.role} in ('tester', 'viewer')`)],
);

export const projectTokens = pgTable("project_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    branch: text("branch").notNull(),
    commitSha: text("commit_sha"),
    ciUrl: text("ci_url"),
    name: text("name"),
    createdAt: createdAt(),
    durationMs: integer("duration_ms").notNull(),
    total: integer("total").notNull(),
    passed: integer("passed").notNull(),
    failed: integer("failed").notNull(),
    skipped: integer("skipped").notNull(),
    flaky: integer("flaky").notNull(),
    tokenId: uuid("token_id").references(() => projectTokens.id, { onDelete: "set null" }),
  },
  (t) => [
    index("runs_project_branch_created_idx").on(t.projectId, t.branch, sql`${t.createdAt} desc`),
    index("runs_project_created_idx").on(t.projectId, sql`${t.createdAt} desc`),
  ],
);

export const testCases = pgTable(
  "test_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    suite: text("suite").notNull(),
    name: text("name").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("test_cases_project_suite_name_unique").on(t.projectId, t.suite, t.name)],
);

export const testResults = pgTable(
  "test_results",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    testCaseId: uuid("test_case_id")
      .notNull()
      .references(() => testCases.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    flakyInRun: boolean("flaky_in_run").notNull(),
    retries: integer("retries").notNull(),
    durationMs: integer("duration_ms").notNull(),
    message: text("message"),
  },
  (t) => [
    unique("test_results_run_test_case_unique").on(t.runId, t.testCaseId),
    index("test_results_test_case_run_idx").on(t.testCaseId, t.runId),
    // Detail run: `where run_id = ? and id > cursor order by id limit 101` dibaca langsung berurutan dari indeks,
    // tanpa mengurutkan hingga 20.000 hasil per halaman.
    index("test_results_run_id_idx").on(t.runId, t.id),
    check("test_results_status_check", sql`${t.status} in ('passed', 'failed', 'skipped')`),
  ],
);
