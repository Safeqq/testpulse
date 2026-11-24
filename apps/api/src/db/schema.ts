import type {
  CasePriority,
  CaseStep,
  CrowdReportStatus,
  CrowdSeverity,
  CycleStatus,
  ParticipantStatus,
  RejectReason,
  StepResult,
} from "@testpulse/shared";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
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
    // Penghitung nomor TC-<n> dan TR-<n> (spec Tahap 4 §6): dinaikkan di dalam transaksi pembuatan, tidak pernah dipakai ulang.
    caseSeq: integer("case_seq").notNull().default(0),
    manualRunSeq: integer("manual_run_seq").notNull().default(0),
    // Penghitung nomor CY-<n> dan CR-<n> per project (spec Tahap 5 §7).
    cycleSeq: integer("cycle_seq").notNull().default(0),
    crowdReportSeq: integer("crowd_report_seq").notNull().default(0),
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
    // Asal manual (spec Tahap 4 §6): run case tempat bug ditemukan. `manualRunCases` dideklarasikan setelah `bugs`
    // (dan merujuk balik ke tabel lain), jadi tipe referensinya dieksplisitkan dengan `AnyPgColumn`.
    manualRunCaseId: uuid("manual_run_case_id").references((): AnyPgColumn => manualRunCases.id, { onDelete: "set null" }),
    // Asal crowd (spec Tahap 5 §5.3): laporan yang diterima menjadi bug ini; tautan baliknya `crowd_reports.bug_id`.
    crowdReportId: uuid("crowd_report_id").references((): AnyPgColumn => crowdReports.id, { onDelete: "set null" }),
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
    // FK `ON DELETE SET NULL` dari `manual_run_cases`: hapus run case mencari bug lewat kolom ini, termasuk bug tertutup,
    // jadi indeks parsial di bawah tidak bisa dipakai (pola sama dengan `bugs_test_case_idx`).
    index("bugs_manual_run_case_idx").on(t.manualRunCaseId),
    // Badge bug per run case hanya menghitung bug yang belum ditutup.
    index("bugs_manual_run_case_open_idx")
      .on(t.manualRunCaseId)
      .where(sql`${t.status} <> 'closed'`),
    // FK `ON DELETE SET NULL` dari `crowd_reports` (pelajaran Tahap 4: indeks penuh, bukan parsial).
    index("bugs_crowd_report_idx").on(t.crowdReportId),
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

// ---- Test manual (spec Tahap 4 §6) ----

const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const caseSuites = pgTable(
  "case_suites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    position: integer("position").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Nama suite unik per project tanpa peka huruf besar/kecil ("Login" dan "login" bentrok).
    uniqueIndex("case_suites_project_lower_name_unique").on(t.projectId, sql`lower(${t.name})`),
    index("case_suites_project_position_idx").on(t.projectId, t.position),
  ],
);

export const manualCases = pgTable(
  "manual_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Nomor TC-<n> dari `projects.case_seq`.
    number: integer("number").notNull(),
    // RESTRICT: suite hanya bisa dihapus bila kosong (termasuk case arsip); diperiksa juga di aplikasi (409 SUITE_NOT_EMPTY).
    suiteId: uuid("suite_id")
      .notNull()
      .references(() => caseSuites.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    preconditions: text("preconditions").notNull().default(""),
    steps: jsonb("steps").$type<CaseStep[]>().notNull(),
    priority: text("priority").$type<CasePriority>().notNull().default("medium"),
    automatedTestId: uuid("automated_test_id").references(() => testCases.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    // Penghitung konkurensi optimistis (409 CASE_CONFLICT), bukan versi aplikasi.
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("manual_cases_project_number_unique").on(t.projectId, t.number),
    index("manual_cases_project_suite_number_idx").on(t.projectId, t.suiteId, t.number),
    // FK `ON DELETE SET NULL` + hitung cakupan otomasi: hanya case yang tertaut yang perlu diindeks.
    index("manual_cases_automated_test_idx")
      .on(t.automatedTestId)
      .where(sql`${t.automatedTestId} is not null`),
    check("manual_cases_priority_check", sql`${t.priority} in ('low', 'medium', 'high', 'urgent')`),
  ],
);

export const manualCaseLabels = pgTable(
  "manual_case_labels",
  {
    caseId: uuid("case_id")
      .notNull()
      .references(() => manualCases.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
  },
  (t) => [primaryKey({ columns: [t.caseId, t.label] })],
);

export const manualRuns = pgTable(
  "manual_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Nomor TR-<n> dari `projects.manual_run_seq`.
    number: integer("number").notNull(),
    name: text("name").notNull(),
    // Versi aplikasi yang diuji (cocok dengan `runs.version`); NULL bila tanpa versi. Bukan konkurensi: itu `version`.
    appVersion: text("app_version"),
    status: text("status").notNull().default("open"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    completedBy: uuid("completed_by").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Penghitung konkurensi optimistis (409 MANUAL_RUN_CONFLICT).
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("manual_runs_project_number_unique").on(t.projectId, t.number),
    index("manual_runs_project_created_idx").on(t.projectId, sql`${t.createdAt} desc`),
    index("manual_runs_project_app_version_idx").on(t.projectId, t.appVersion),
    check("manual_runs_status_check", sql`${t.status} in ('open', 'completed')`),
  ],
);

export const manualRunCases = pgTable(
  "manual_run_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => manualRuns.id, { onDelete: "cascade" }),
    // SET NULL: menghapus case sumber tidak menghapus hasil; snapshot di bawah tetap utuh.
    caseId: uuid("case_id").references(() => manualCases.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    // Snapshot case saat run dibuat (spec §4.2); tidak ikut berubah bila case sumber diubah.
    caseNumber: integer("case_number").notNull(),
    suiteName: text("suite_name").notNull(),
    suitePosition: integer("suite_position").notNull(),
    title: text("title").notNull(),
    preconditions: text("preconditions").notNull().default(""),
    steps: jsonb("steps").$type<CaseStep[]>().notNull(),
    priority: text("priority").$type<CasePriority>().notNull(),
    // Hasil eksekusi.
    status: text("status").notNull().default("untested"),
    stepResults: jsonb("step_results").$type<StepResult[]>().notNull(),
    note: text("note").notNull().default(""),
    // SET NULL bila pengguna dihapus; mengeluarkan anggota dari project mengosongkan assignee lewat logika aplikasi.
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    executedBy: uuid("executed_by").references(() => users.id, { onDelete: "set null" }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    // Penghitung konkurensi optimistis (409 MANUAL_RUN_CONFLICT).
    version: integer("version").notNull().default(1),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("manual_run_cases_run_position_idx").on(t.runId, t.position),
    index("manual_run_cases_run_status_idx").on(t.runId, t.status),
    // FK `ON DELETE SET NULL`: menghapus case sumber mencari run case lewat kolom ini; juga riwayat hasil per case.
    index("manual_run_cases_case_idx").on(t.caseId),
    check("manual_run_cases_status_check", sql`${t.status} in ('untested', 'passed', 'failed', 'blocked', 'skipped')`),
  ],
);

// --- Crowdtesting (spec Tahap 5 §7) ---------------------------------------------------------------------------
// Urutan kunci di repository: project → cycle → peserta → laporan.

export const crowdCycles = pgTable(
  "crowd_cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Nomor CY-<n> dari `projects.cycle_seq`.
    number: integer("number").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    instructions: text("instructions").notNull().default(""),
    inScope: text("in_scope").notNull().default(""),
    outOfScope: text("out_of_scope").notNull().default(""),
    appVersion: text("app_version"),
    status: text("status").$type<CycleStatus>().notNull().default("draft"),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    // Penghitung konkurensi optimistis (409 CYCLE_CONFLICT).
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("crowd_cycles_project_number_unique").on(t.projectId, t.number),
    // Direktori publik: cycle non-draft, urut dibuka terbaru.
    index("crowd_cycles_status_opened_idx").on(t.status, sql`${t.openedAt} desc`),
    index("crowd_cycles_project_created_idx").on(t.projectId, sql`${t.createdAt} desc`),
    check("crowd_cycles_status_check", sql`${t.status} in ('draft', 'open', 'closed')`),
  ],
);

export const crowdCycleLinks = pgTable(
  "crowd_cycle_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => crowdCycles.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    url: text("url").notNull(),
    label: text("label").notNull(),
  },
  (t) => [index("crowd_cycle_links_cycle_position_idx").on(t.cycleId, t.position)],
);

export const crowdCycleEnvironments = pgTable(
  "crowd_cycle_environments",
  {
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => crowdCycles.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cycleId, t.position] }),
    uniqueIndex("crowd_cycle_environments_cycle_label_unique").on(t.cycleId, sql`lower(${t.label})`),
  ],
);

export const crowdParticipants = pgTable(
  "crowd_participants",
  {
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => crowdCycles.id, { onDelete: "cascade" }),
    // Tanpa cascade: menghapus pengguna bukan fitur; laporan dan poinnya tetap milik pengguna itu.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").$type<ParticipantStatus>().notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    rulesAcceptedAt: timestamp("rules_accepted_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id, { onDelete: "set null" }),
    removalReason: text("removal_reason"),
  },
  (t) => [
    primaryKey({ columns: [t.cycleId, t.userId] }),
    index("crowd_participants_user_idx").on(t.userId),
    index("crowd_participants_removed_by_idx").on(t.removedBy),
    check("crowd_participants_status_check", sql`${t.status} in ('active', 'left', 'removed')`),
  ],
);

export const crowdReports = pgTable(
  "crowd_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => crowdCycles.id, { onDelete: "cascade" }),
    // Nomor CR-<n> dari `projects.crowd_report_seq`.
    number: integer("number").notNull(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    steps: text("steps").notNull(),
    expected: text("expected").notNull(),
    actual: text("actual").notNull(),
    environment: text("environment").notNull(),
    suggestedSeverity: text("suggested_severity").$type<CrowdSeverity>().notNull(),
    status: text("status").$type<CrowdReportStatus>().notNull().default("submitted"),
    // Hasil triase (spec §5.3). Poin dikunci saat diterima.
    finalSeverity: text("final_severity").$type<CrowdSeverity>(),
    points: integer("points").notNull().default(0),
    rejectReason: text("reject_reason").$type<RejectReason>(),
    triageNote: text("triage_note"),
    duplicateOfId: uuid("duplicate_of_id").references((): AnyPgColumn => crowdReports.id, { onDelete: "set null" }),
    bugId: uuid("bug_id").references((): AnyPgColumn => bugs.id, { onDelete: "set null" }),
    hideFromKnownIssues: boolean("hide_from_known_issues").notNull().default(false),
    triagedBy: uuid("triaged_by").references(() => users.id, { onDelete: "set null" }),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
    // Penghitung konkurensi optimistis (409 REPORT_CONFLICT).
    version: integer("version").notNull().default(1),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("crowd_reports_project_number_unique").on(t.projectId, t.number),
    // Antrian triase per cycle & status.
    index("crowd_reports_cycle_status_submitted_idx").on(t.cycleId, t.status, t.submittedAt),
    // Batas harian & profil per pelapor.
    index("crowd_reports_reporter_submitted_idx").on(t.reporterId, sql`${t.submittedAt} desc`),
    // Batas per cycle per pelapor.
    index("crowd_reports_cycle_reporter_status_idx").on(t.cycleId, t.reporterId, t.status),
    // Leaderboard: hanya laporan diterima.
    index("crowd_reports_accepted_reporter_idx")
      .on(t.reporterId)
      .where(sql`${t.status} = 'accepted'`),
    // FK `ON DELETE SET NULL` (pelajaran Tahap 4: indeks penuh).
    index("crowd_reports_duplicate_of_idx").on(t.duplicateOfId),
    index("crowd_reports_bug_idx").on(t.bugId),
    index("crowd_reports_triaged_by_idx").on(t.triagedBy),
    check(
      "crowd_reports_status_check",
      sql`${t.status} in ('submitted', 'accepted', 'rejected', 'duplicate', 'withdrawn')`,
    ),
    check(
      "crowd_reports_suggested_severity_check",
      sql`${t.suggestedSeverity} in ('minor', 'major', 'critical', 'blocker')`,
    ),
    check(
      "crowd_reports_final_severity_check",
      sql`${t.finalSeverity} is null or ${t.finalSeverity} in ('minor', 'major', 'critical', 'blocker')`,
    ),
    check(
      "crowd_reports_reject_reason_check",
      sql`${t.rejectReason} is null or ${t.rejectReason} in ('not_reproducible', 'out_of_scope', 'not_a_bug', 'insufficient_info', 'other')`,
    ),
  ],
);

export const crowdReportLinks = pgTable(
  "crowd_report_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => crowdReports.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    url: text("url").notNull(),
    title: text("title"),
  },
  (t) => [index("crowd_report_links_report_position_idx").on(t.reportId, t.position)],
);

export const crowdReportEvents = pgTable(
  "crowd_report_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => crowdReports.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    fromStatus: text("from_status").$type<CrowdReportStatus>(),
    toStatus: text("to_status").$type<CrowdReportStatus>().notNull(),
    detail: text("detail"),
    createdAt: createdAt(),
  },
  (t) => [index("crowd_report_events_report_created_idx").on(t.reportId, t.createdAt)],
);

export const crowdReportComments = pgTable(
  "crowd_report_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => crowdReports.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("crowd_report_comments_report_created_idx").on(t.reportId, t.createdAt)],
);
