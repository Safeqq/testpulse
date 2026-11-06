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
    // Penghitung nomor bug per project (spec Tahap 3 §5): dinaikkan di dalam transaksi pembuatan bug.
    bugSeq: integer("bug_seq").notNull().default(0),
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
    // Versi aplikasi yang diuji (spec Tahap 3 §4.1); NULL untuk run lama / tanpa versi.
    version: text("version"),
  },
  (t) => [
    index("runs_project_branch_created_idx").on(t.projectId, t.branch, sql`${t.createdAt} desc`),
    index("runs_project_created_idx").on(t.projectId, sql`${t.createdAt} desc`),
    index("runs_project_branch_version_idx").on(t.projectId, t.branch, t.version),
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

export const bugs = pgTable(
  "bugs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("open"),
    resolution: text("resolution"),
    priority: text("priority").notNull().default("medium"),
    severity: text("severity").notNull().default("major"),
    // Tanpa cascade: mengosongkan penanggung jawab saat anggota dikeluarkan adalah logika aplikasi (Tahap 3 Task 4).
    assigneeId: uuid("assignee_id").references(() => users.id),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id),
    testCaseId: uuid("test_case_id").references(() => testCases.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    // Penghitung konkurensi optimistis (409 BUG_CONFLICT), bukan versi aplikasi.
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    unique("bugs_project_number_unique").on(t.projectId, t.number),
    index("bugs_project_status_updated_idx").on(t.projectId, t.status, sql`${t.updatedAt} desc`),
    index("bugs_project_assignee_idx").on(t.projectId, t.assigneeId),
    // FK `ON DELETE SET NULL`: hapus run/test mencari bug lewat kolom ini (bug tertutup juga, jadi bukan indeks parsial).
    index("bugs_run_idx").on(t.runId),
    index("bugs_test_case_idx").on(t.testCaseId),
    // Lencana bug per test hanya menghitung bug yang belum ditutup. Tetap dipakai walau ada `bugs_test_case_idx`:
    // EXPLAIN pada data uji (90% bug closed) memilih indeks parsial ini dan membaca ~3× lebih sedikit blok.
    index("bugs_test_case_open_idx")
      .on(t.testCaseId)
      .where(sql`${t.status} <> 'closed'`),
    check("bugs_status_check", sql`${t.status} in ('open', 'in_progress', 'resolved', 'closed')`),
    check(
      "bugs_resolution_check",
      sql`${t.resolution} is null or ${t.resolution} in ('fixed', 'wont_fix', 'duplicate', 'cannot_reproduce')`,
    ),
    check("bugs_priority_check", sql`${t.priority} in ('low', 'medium', 'high', 'urgent')`),
    check("bugs_severity_check", sql`${t.severity} in ('minor', 'major', 'critical', 'blocker')`),
  ],
);

export const bugLabels = pgTable(
  "bug_labels",
  {
    bugId: uuid("bug_id")
      .notNull()
      .references(() => bugs.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
  },
  (t) => [primaryKey({ columns: [t.bugId, t.label] })],
);

export const bugLinks = pgTable(
  "bug_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bugId: uuid("bug_id")
      .notNull()
      .references(() => bugs.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    url: text("url").notNull(),
    title: text("title"),
  },
  // Detail bug membaca link urut posisi; juga dipakai CASCADE saat bug dihapus.
  (t) => [index("bug_links_bug_position_idx").on(t.bugId, t.position)],
);

export const bugComments = pgTable(
  "bug_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bugId: uuid("bug_id")
      .notNull()
      .references(() => bugs.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("bug_comments_bug_created_idx").on(t.bugId, t.createdAt)],
);

export const bugEvents = pgTable(
  "bug_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    bugId: uuid("bug_id")
      .notNull()
      .references(() => bugs.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    createdAt: createdAt(),
  },
  (t) => [index("bug_events_bug_created_idx").on(t.bugId, t.createdAt)],
);
