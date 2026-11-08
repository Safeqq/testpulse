import type {
  BugDto,
  BugListQuery,
  BugPriority,
  BugResolution,
  BugSeverity,
  BugStatus,
  BugSummaryDto,
  ResultStatus,
  TestHintDto,
} from "@testpulse/shared";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Queryable } from "../../db/client.js";
import { bugLabels, bugLinks, bugs, manualRunCases, manualRuns, testCases, users } from "../../db/schema.js";
import { listTestHistory } from "../results/repository.js";
import type { BugCursor, BugSort } from "./cursor.js";

const assigneeUser = alias(users, "assignee");
const reporterUser = alias(users, "reporter");

/** Peringkat prioritas untuk `sort=priority` (urgent dulu); sama dengan `rank` di cursor. */
const priorityRank = sql<number>`(case ${bugs.priority} when 'urgent' then 4 when 'high' then 3 when 'medium' then 2 else 1 end)`;

/** Waktu sebagai teks ISO UTC berpresisi mikrodetik (presisi penuh kolom), untuk cursor keyset. */
export const microIso = (column: SQLWrapper) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export const bugByNumber = (projectId: string, number: number) =>
  and(eq(bugs.projectId, projectId), eq(bugs.number, number));

/**
 * Urutan label yang deterministik di semua lingkungan: urutan code unit (label hanya `[a-z0-9-]`), dihitung di JS,
 * bukan `ORDER BY` yang bergantung pada collation database.
 */
export const sortLabels = (labels: readonly string[]): string[] => labels.toSorted();

// ---------------------------------------------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------------------------------------------

const summaryColumns = {
  id: bugs.id,
  number: bugs.number,
  title: bugs.title,
  status: bugs.status,
  resolution: bugs.resolution,
  priority: bugs.priority,
  severity: bugs.severity,
  assigneeId: bugs.assigneeId,
  assigneeName: assigneeUser.name,
  createdAt: bugs.createdAt,
  updatedAt: bugs.updatedAt,
};

type SummaryRow = {
  number: number;
  title: string;
  status: string;
  resolution: string | null;
  priority: string;
  severity: string;
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Kolom enum dibatasi CHECK constraint (spec §5). Email user tidak pernah dipilih.
function toSummary(row: SummaryRow, labels: string[]): BugSummaryDto {
  return {
    number: row.number,
    title: row.title,
    status: row.status as BugStatus,
    resolution: row.resolution as BugResolution | null,
    priority: row.priority as BugPriority,
    severity: row.severity as BugSeverity,
    assignee: row.assigneeId !== null && row.assigneeName !== null ? { id: row.assigneeId, name: row.assigneeName } : null,
    labels,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Label per bug (urutan `sortLabels`) dengan satu query. */
export async function labelsByBug(db: Queryable, bugIds: string[]): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>(bugIds.map((id) => [id, []]));
  if (bugIds.length === 0) return grouped;
  const rows = await db
    .select({ bugId: bugLabels.bugId, label: bugLabels.label })
    .from(bugLabels)
    .where(inArray(bugLabels.bugId, bugIds));
  for (const row of rows) grouped.get(row.bugId)?.push(row.label);
  return new Map([...grouped].map(([id, labels]) => [id, sortLabels(labels)]));
}

/** Jumlah hasil terbaru pada petunjuk status test (spec §6.2). */
export const TEST_HINT_LENGTH = 20;

/**
 * Petunjuk status test asal bug (spec §6.2): `TEST_HINT_LENGTH` hasil terbaru test itu di branch run asal (lama →
 * baru). Bila run asal sudah dihapus (atau bug tidak pernah menyimpan run), branch = branch hasil terbaru test itu;
 * `branch: null` bila test tidak punya hasil lagi. `consecutivePasses` = jumlah `passed` berturut-turut dari hasil
 * terbaru (berhenti di hasil pertama yang bukan `passed`, termasuk `skipped`).
 */
async function loadTestHint(
  db: Queryable,
  projectId: string,
  testCaseId: string,
  runId: string | null,
): Promise<TestHintDto> {
  const found = await db.execute<{ branch: string | null }>(sql`
    select coalesce(
      (select r.branch from runs r where r.id = ${runId}::uuid and r.project_id = ${projectId}),
      (select r.branch from test_results tr join runs r on r.id = tr.run_id
        where tr.test_case_id = ${testCaseId} and r.project_id = ${projectId}
        order by r.created_at desc, r.id desc limit 1)
    ) as branch
  `);
  const branch = found.rows[0]?.branch ?? null;
  if (branch === null) return { branch: null, results: [], consecutivePasses: 0, lastStatus: null };

  const newestFirst = await listTestHistory(db, projectId, testCaseId, branch, TEST_HINT_LENGTH);
  const firstNotPassed = newestFirst.findIndex((row) => row.status !== "passed");
  return {
    branch,
    results: newestFirst.toReversed().map((row) => ({
      runId: row.runId,
      createdAt: row.createdAt.toISOString(),
      status: row.status as ResultStatus,
    })),
    consecutivePasses: firstNotPassed === -1 ? newestFirst.length : firstNotPassed,
    lastStatus: (newestFirst[0]?.status as ResultStatus | undefined) ?? null,
  };
}

/**
 * Detail bug (spec §6), termasuk `testHint` bila bug tertaut ke test dan `manualOrigin` (Tahap 4 §5.4) dari run case
 * asal: nomor & nama run serta nomor & judul case dari snapshot run case. Run yang dihapus menghapus run case-nya
 * dan mengosongkan `manual_run_case_id`, sehingga `manualOrigin` menjadi `null`.
 */
export async function loadBugDto(db: Queryable, bugId: string): Promise<BugDto> {
  const [row] = await db
    .select({
      ...summaryColumns,
      projectId: bugs.projectId,
      description: bugs.description,
      reporterId: bugs.reporterId,
      reporterName: reporterUser.name,
      testCaseId: testCases.id,
      testCaseSuite: testCases.suite,
      testCaseName: testCases.name,
      runId: bugs.runId,
      version: bugs.version,
      resolvedAt: bugs.resolvedAt,
      closedAt: bugs.closedAt,
      originRunNumber: manualRuns.number,
      originRunName: manualRuns.name,
      originCaseNumber: manualRunCases.caseNumber,
      originCaseTitle: manualRunCases.title,
    })
    .from(bugs)
    .innerJoin(reporterUser, eq(reporterUser.id, bugs.reporterId))
    .leftJoin(assigneeUser, eq(assigneeUser.id, bugs.assigneeId))
    .leftJoin(testCases, eq(testCases.id, bugs.testCaseId))
    .leftJoin(manualRunCases, eq(manualRunCases.id, bugs.manualRunCaseId))
    .leftJoin(manualRuns, eq(manualRuns.id, manualRunCases.runId))
    .where(eq(bugs.id, bugId));
  if (!row) throw new Error("bug hilang di tengah transaksi");

  const labels = (await labelsByBug(db, [bugId])).get(bugId) ?? [];
  const links = await db
    .select({ url: bugLinks.url, title: bugLinks.title })
    .from(bugLinks)
    .where(eq(bugLinks.bugId, bugId))
    .orderBy(asc(bugLinks.position));

  return {
    ...toSummary(row, labels),
    description: row.description,
    reporter: { id: row.reporterId, name: row.reporterName },
    links,
    testCase:
      row.testCaseId !== null && row.testCaseSuite !== null && row.testCaseName !== null
        ? { id: row.testCaseId, suite: row.testCaseSuite, name: row.testCaseName }
        : null,
    runId: row.runId,
    version: row.version,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    testHint: row.testCaseId === null ? null : await loadTestHint(db, row.projectId, row.testCaseId, row.runId),
    manualOrigin:
      row.originRunNumber !== null && row.originRunName !== null && row.originCaseNumber !== null && row.originCaseTitle !== null
        ? {
            runNumber: row.originRunNumber,
            runName: row.originRunName,
            caseNumber: row.originCaseNumber,
            caseTitle: row.originCaseTitle,
          }
        : null,
  };
}

export async function findBugByNumber(db: Queryable, projectId: string, number: number): Promise<BugDto | null> {
  const [row] = await db.select({ id: bugs.id }).from(bugs).where(bugByNumber(projectId, number));
  return row ? loadBugDto(db, row.id) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Daftar
// ---------------------------------------------------------------------------------------------------------------

const STATUS_FILTER: Record<string, readonly BugStatus[]> = {
  active: ["open", "in_progress"],
  done: ["resolved", "closed"],
};

/** `%`, `_` dan `\` dicocokkan literal pada ILIKE (escape `\`). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export interface ListBugsOptions {
  projectId: string;
  /** User yang login (untuk `assignee=me`); anonim + `me` = tidak ada bug yang cocok. */
  userId: string | null;
  query: Omit<BugListQuery, "cursor">;
  after?: BugCursor;
  limit: number;
}

/**
 * Satu halaman daftar bug sesuai filter & urutan (spec §6), dengan posisi keyset tiap bug untuk cursor.
 * Urutan: `updated` = `updated_at desc, id desc`; `created` = `created_at desc, id desc`;
 * `priority` = peringkat desc, `updated_at desc, id desc`.
 */
export async function listBugs(
  db: Queryable,
  opts: ListBugsOptions,
): Promise<{ bug: BugSummaryDto; position: BugCursor }[]> {
  const { query } = opts;
  const conditions: SQL[] = [eq(bugs.projectId, opts.projectId)];

  if (query.status !== "all") {
    const statuses = STATUS_FILTER[query.status] ?? [query.status];
    conditions.push(inArray(bugs.status, [...statuses]));
  }
  if (query.assignee === "none") conditions.push(isNull(bugs.assigneeId));
  else if (query.assignee === "me") conditions.push(opts.userId ? eq(bugs.assigneeId, opts.userId) : sql`false`);
  else if (query.assignee !== undefined) conditions.push(eq(bugs.assigneeId, query.assignee));
  if (query.priority !== undefined) conditions.push(eq(bugs.priority, query.priority));
  if (query.severity !== undefined) conditions.push(eq(bugs.severity, query.severity));
  if (query.label !== undefined) {
    conditions.push(
      sql`exists (select 1 from ${bugLabels} where ${bugLabels.bugId} = ${bugs.id} and ${bugLabels.label} = ${query.label})`,
    );
  }
  if (query.q !== undefined) conditions.push(sql`${bugs.title} ilike ${`%${escapeLike(query.q)}%`} escape '\\'`);

  const sort: BugSort = query.sort;
  const timeColumn = sort === "created" ? bugs.createdAt : bugs.updatedAt;
  if (opts.after) {
    const { at, id, rank } = opts.after;
    conditions.push(
      sort === "priority"
        ? sql`(${priorityRank}, ${timeColumn}, ${bugs.id}) < (${rank}::int, ${at}::timestamptz, ${id}::uuid)`
        : sql`(${timeColumn}, ${bugs.id}) < (${at}::timestamptz, ${id}::uuid)`,
    );
  }

  const order = sort === "priority" ? [desc(priorityRank), desc(timeColumn), desc(bugs.id)] : [desc(timeColumn), desc(bugs.id)];
  const rows = await db
    .select({ ...summaryColumns, at: microIso(timeColumn), rank: priorityRank })
    .from(bugs)
    .leftJoin(assigneeUser, eq(assigneeUser.id, bugs.assigneeId))
    .where(and(...conditions))
    .orderBy(...order)
    .limit(opts.limit);

  const labels = await labelsByBug(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    bug: toSummary(row, labels.get(row.id) ?? []),
    position: sort === "priority" ? { at: row.at, id: row.id, rank: Number(row.rank) } : { at: row.at, id: row.id },
  }));
}

/**
 * Label yang dipakai bug project ini, unik dan urut abjad. `COLLATE "C"` (urutan byte = urutan `sortLabels` untuk
 * `[a-z0-9-]`) agar urutan dan potongan `limit` sama di semua lingkungan.
 */
export async function listLabels(db: Queryable, projectId: string, limit: number): Promise<string[]> {
  const rows = await db
    .select({ label: bugLabels.label })
    .from(bugLabels)
    .innerJoin(bugs, eq(bugs.id, bugLabels.bugId))
    .where(eq(bugs.projectId, projectId))
    .groupBy(bugLabels.label)
    .orderBy(sql`${bugLabels.label} collate "C"`)
    .limit(limit);
  return rows.map((row) => row.label);
}
