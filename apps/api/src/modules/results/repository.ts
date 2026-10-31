import type { IngestQuery, ResultStatus } from "@testpulse/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db, Queryable } from "../../db/client.js";
import { projects, runs, testCases, testResults } from "../../db/schema.js";
import { touchToken } from "../tokens/auth.js";
import { FLAKY_WINDOW } from "./domain/flaky.js";
import type { ParsedReport, ParsedResult } from "./domain/junit.js";

/** Jumlah run terbaru yang disimpan per project (spec Tahap 2 §4, retensi). */
export const RUN_RETENTION = 200;

/**
 * Baris per INSERT/SELECT. `test_results` punya 7 kolom berparameter → 7.000 parameter per statement, jauh di bawah
 * batas 65.535 parameter Postgres, bahkan untuk laporan 20.000 testcase.
 */
const CHUNK_SIZE = 1000;

export interface Totals {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
}

/** Total run dari hasil yang sudah digabung (satu hasil per test). */
export function computeTotals(results: readonly ParsedResult[]): Totals {
  const totals: Totals = { total: results.length, passed: 0, failed: 0, skipped: 0, flaky: 0 };
  for (const result of results) {
    totals[result.status] += 1;
    if (result.flakyInRun) totals.flaky += 1;
  }
  return totals;
}

const identityKey = (test: { suite: string; name: string }) => `${test.suite}\u0000${test.name}`;

function compareIdentity(a: ParsedResult, b: ParsedResult): number {
  if (a.suite !== b.suite) return a.suite < b.suite ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return 0;
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Menyimpan satu run beserta hasilnya dalam satu transaksi:
 * 1. insert `runs` (dengan total);
 * 2. per potongan: upsert `test_cases` (`ON CONFLICT DO NOTHING`, lalu select id) dan insert `test_results`;
 * 3. hapus run di luar RUN_RETENTION terbaru project ini (cascade ke `test_results`);
 * 4. catat pemakaian token (`last_used_at`), agar run yang tersimpan tidak pernah diikuti kegagalan terpisah.
 *
 * Upload paralel aman: insert `test_cases` yang bentrok menunggu transaksi lain lalu tidak melakukan apa-apa, dan
 * select berikutnya (READ COMMITTED) melihat barisnya. Hasil diurutkan menurut (suite, name) agar semua transaksi
 * mengunci baris unik dalam urutan yang sama (tanpa deadlock). Sebelum retensi, baris project dikunci
 * (`FOR NO KEY UPDATE`, tidak memblokir insert anak) sehingga upload serentak menjalankan retensi bergantian dan
 * masing-masing melihat run yang sudah di-commit — tersisa tepat RUN_RETENTION run.
 */
export async function insertRun(
  db: Db,
  input: { projectId: string; tokenId: string; query: IngestQuery; report: ParsedReport },
): Promise<{ runId: string; totals: Totals }> {
  const { projectId, tokenId, query, report } = input;
  const totals = computeTotals(report.results);
  const results = [...report.results].sort(compareIdentity);

  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(runs)
      .values({
        projectId,
        branch: query.branch,
        commitSha: "commitSha" in query ? query.commitSha : null,
        ciUrl: query.ciUrl ?? null,
        name: query.name ?? null,
        durationMs: report.durationMs,
        ...totals,
        tokenId,
      })
      .returning({ id: runs.id });
    if (!run) throw new Error("insert run tidak mengembalikan baris");

    for (const chunk of chunked(results, CHUNK_SIZE)) {
      await tx
        .insert(testCases)
        .values(chunk.map((r) => ({ projectId, suite: r.suite, name: r.name })))
        .onConflictDoNothing({ target: [testCases.projectId, testCases.suite, testCases.name] });

      const identities = sql.join(
        chunk.map((r) => sql`(${r.suite}, ${r.name})`),
        sql`, `,
      );
      const rows = await tx
        .select({ id: testCases.id, suite: testCases.suite, name: testCases.name })
        .from(testCases)
        .where(and(eq(testCases.projectId, projectId), sql`(${testCases.suite}, ${testCases.name}) in (${identities})`));
      const ids = new Map(rows.map((row) => [identityKey(row), row.id]));

      await tx.insert(testResults).values(
        chunk.map((r) => {
          const testCaseId = ids.get(identityKey(r));
          if (!testCaseId) throw new Error("test_case hilang setelah upsert");
          return {
            runId: run.id,
            testCaseId,
            status: r.status,
            flakyInRun: r.flakyInRun,
            retries: r.retries,
            durationMs: r.durationMs,
            message: r.message,
          };
        }),
      );
    }

    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("no key update");
    const beyondRetention = tx
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.projectId, projectId))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .offset(RUN_RETENTION);
    await tx.delete(runs).where(inArray(runs.id, beyondRetention));

    await touchToken(tx, tokenId);

    return { runId: run.id, totals };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Baca hasil (spec Tahap 2 §7). Query run memakai indeks (project_id[, branch], created_at desc).
// ---------------------------------------------------------------------------------------------------------------

export type RunRecord = typeof runs.$inferSelect;
export type ResultFilter = "failed" | "flaky" | "all";

const newestFirst = [desc(runs.createdAt), desc(runs.id)] as const;

/** Run terbaru per branch, diurutkan dari branch dengan run paling baru. */
export async function listBranchHeads(db: Db, projectId: string): Promise<RunRecord[]> {
  const heads = db
    .selectDistinctOn([runs.branch])
    .from(runs)
    .where(eq(runs.projectId, projectId))
    .orderBy(runs.branch, ...newestFirst)
    .as("heads");
  return db.select().from(heads).orderBy(desc(heads.createdAt), desc(heads.id));
}

/** Branch dari run terbaru project, atau `null` bila belum ada run. */
export async function latestBranch(db: Queryable, projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ branch: runs.branch })
    .from(runs)
    .where(eq(runs.projectId, projectId))
    .orderBy(...newestFirst)
    .limit(1);
  return row?.branch ?? null;
}

/**
 * Satu halaman run (`created_at desc, id desc`), dimulai setelah posisi cursor `after`.
 *
 * Posisi dibaca ulang dari baris run cursor bila masih ada: `created_at` di DB berpresisi mikrodetik, sedangkan
 * `Date` di cursor hanya milidetik — tanpa ini run dalam milidetik yang sama bisa terlewat. Bila run cursor sudah
 * dihapus, `createdAt` dari cursor menjadi cadangan.
 */
export async function listRuns(
  db: Db,
  projectId: string,
  opts: { branch?: string; after?: { createdAt: Date; id: string }; limit: number },
): Promise<RunRecord[]> {
  const conditions = [eq(runs.projectId, projectId)];
  if (opts.branch !== undefined) conditions.push(eq(runs.branch, opts.branch));
  if (opts.after) {
    const { createdAt, id } = opts.after;
    const position = sql`coalesce(
      (select cursor_run.created_at from runs cursor_run
        where cursor_run.id = ${id}::uuid and cursor_run.project_id = ${projectId}),
      ${createdAt.toISOString()}::timestamptz)`;
    // `created_at <= posisi` tersirat dari perbandingan baris, tetapi membuat indeks created_at terpakai.
    conditions.push(
      sql`${runs.createdAt} <= ${position}`,
      sql`(${runs.createdAt}, ${runs.id}) < (${position}, ${id}::uuid)`,
    );
  }
  return db
    .select()
    .from(runs)
    .where(and(...conditions))
    .orderBy(...newestFirst)
    .limit(opts.limit);
}

export async function findRun(db: Queryable, projectId: string, runId: string): Promise<RunRecord | undefined> {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.id, runId)));
  return run;
}

/** Hasil test satu run, urut `id` (= urutan suite/nama saat disimpan), mulai setelah hasil ber-id `afterId`. */
export async function listRunResults(
  db: Queryable,
  runId: string,
  opts: { filter: ResultFilter; afterId?: number; limit: number },
) {
  const conditions = [eq(testResults.runId, runId)];
  if (opts.filter === "failed") conditions.push(eq(testResults.status, "failed"));
  if (opts.filter === "flaky") conditions.push(eq(testResults.flakyInRun, true));
  if (opts.afterId !== undefined) conditions.push(sql`${testResults.id} > ${opts.afterId}`);
  return db
    .select({
      id: testResults.id,
      testCaseId: testResults.testCaseId,
      suite: testCases.suite,
      name: testCases.name,
      status: testResults.status,
      flakyInRun: testResults.flakyInRun,
      retries: testResults.retries,
      durationMs: testResults.durationMs,
      message: testResults.message,
    })
    .from(testResults)
    .innerJoin(testCases, eq(testCases.id, testResults.testCaseId))
    .where(and(...conditions))
    .orderBy(asc(testResults.id))
    .limit(opts.limit);
}

/** Menghapus run milik project (hasilnya ikut terhapus lewat cascade); `false` bila tidak ada. */
export async function deleteRun(db: Db, projectId: string, runId: string): Promise<boolean> {
  const deleted = await db
    .delete(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.id, runId)))
    .returning({ id: runs.id });
  return deleted.length > 0;
}

/** `limit` run terbaru di branch, urut dari yang terbaru. */
export async function listRecentRuns(db: Queryable, projectId: string, branch: string, limit: number): Promise<RunRecord[]> {
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.branch, branch)))
    .orderBy(...newestFirst)
    .limit(limit);
}

/**
 * Sidik data flaky satu branch: run terbaru dan jumlah run. Hasil test sebuah run tidak pernah berubah setelah
 * disimpan, dan run baru selalu menjadi run terbaru; jadi upload (termasuk retensi), hapus run, maupun hapus project
 * mengubah sidik ini. Dihitung dari indeks `(project_id, branch, created_at desc)` (maks. 200 run per project).
 * `null` bila branch belum punya run.
 */
export async function flakyFingerprint(db: Queryable, projectId: string, branch: string): Promise<string | null> {
  const result = await db.execute<{ newest_id: string | null; run_count: number }>(sql`
    select
      (select r.id from runs r where r.project_id = ${projectId} and r.branch = ${branch}
        order by r.created_at desc, r.id desc limit 1) as newest_id,
      (select count(*)::int from runs r where r.project_id = ${projectId} and r.branch = ${branch}) as run_count
  `);
  const row = result.rows[0];
  return row?.newest_id ? `${row.newest_id}:${row.run_count}` : null;
}

export interface FlakyRow {
  testCaseId: string;
  suite: string;
  name: string;
  score: number;
  lastStatus: ResultStatus;
}

/**
 * Daftar test flaky di branch, dihitung seluruhnya di SQL dengan rumus spec §6 (paritas dengan `flakyScore`):
 * per test, ambil hasil dari `FLAKY_WINDOW` run terakhir branch yang memuat test itu (window function), abaikan
 * `skipped`, lalu skor = min(100, round(100 × (flip + flakyRuns) / n)). `round(numeric)` membulatkan setengah
 * menjauhi nol, sama dengan `Math.round` untuk bilangan positif (Ruling T2-c). Skor 0 dibuang; urut skor turun lalu
 * nama (suite dan id sebagai pemutus seri). `lastStatus` = hasil terbaru di jendela, termasuk `skipped`.
 */
export async function listFlakyTests(db: Queryable, projectId: string, branch: string, limit: number): Promise<FlakyRow[]> {
  const result = await db.execute<{
    test_case_id: string;
    suite: string;
    name: string;
    score: number;
    last_status: ResultStatus;
  }>(sql`
    with windowed as (
      select tr.test_case_id, tr.status, tr.flaky_in_run,
             row_number() over (partition by tr.test_case_id order by r.created_at desc, r.id desc) as recency
      from runs r
      join test_results tr on tr.run_id = r.id
      where r.project_id = ${projectId} and r.branch = ${branch}
    ),
    recent as (
      select * from windowed where recency <= ${FLAKY_WINDOW}
    ),
    executed as (
      select test_case_id, status, flaky_in_run,
             lag(status) over (partition by test_case_id order by recency desc) as previous_status
      from recent
      where status <> 'skipped'
    ),
    scored as (
      select test_case_id,
             least(100, round(
               100 * (count(*) filter (where previous_status <> status) + count(*) filter (where flaky_in_run))::numeric
               / count(*)
             ))::int as score
      from executed
      group by test_case_id
    )
    select s.test_case_id, tc.suite, tc.name, s.score, latest.status as last_status
    from scored s
    join test_cases tc on tc.id = s.test_case_id
    join recent latest on latest.test_case_id = s.test_case_id and latest.recency = 1
    where s.score > 0
    order by s.score desc, tc.name asc, tc.suite asc, tc.id asc
    limit ${limit}
  `);
  return result.rows.map((row) => ({
    testCaseId: row.test_case_id,
    suite: row.suite,
    name: row.name,
    score: row.score,
    lastStatus: row.last_status,
  }));
}

export async function findTestCase(db: Queryable, projectId: string, testCaseId: string) {
  const [testCase] = await db
    .select({ id: testCases.id, suite: testCases.suite, name: testCases.name })
    .from(testCases)
    .where(and(eq(testCases.projectId, projectId), eq(testCases.id, testCaseId)));
  return testCase;
}

/** `limit` hasil terbaru satu test di branch, urut dari yang terbaru. */
export async function listTestHistory(
  db: Queryable,
  projectId: string,
  testCaseId: string,
  branch: string,
  limit: number,
) {
  return db
    .select({
      runId: runs.id,
      createdAt: runs.createdAt,
      status: testResults.status,
      flakyInRun: testResults.flakyInRun,
      retries: testResults.retries,
      durationMs: testResults.durationMs,
    })
    .from(testResults)
    .innerJoin(runs, eq(runs.id, testResults.runId))
    .where(and(eq(testResults.testCaseId, testCaseId), eq(runs.projectId, projectId), eq(runs.branch, branch)))
    .orderBy(...newestFirst)
    .limit(limit);
}
